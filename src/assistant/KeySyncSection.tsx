import { useCallback, useEffect, useRef, useState, type FormEvent, type MutableRefObject, type ReactNode } from 'react';
import { useT, type Key, type Translate } from '../i18n';
import '../i18n/lazy/assistant';
import { useServices, useSyncStatus, type Services } from '../services';
import { loadSettings, syncEntries, syncFor, type AssistantSettings as Saved } from './keyStore';
import { generatePassphrase, keyEnding, ownPassphraseOk, type KeyPayload } from './keySync';
import {
  adoptUnlocked,
  alsoSync,
  changePassphrase,
  needsAnswer,
  outcomeOf,
  replaceSync,
  stopSync,
  turnOnSync,
  unlockSync,
  updateSync,
  type SyncContext,
  type SyncOutcome,
  type Unlocked,
} from './keySyncFlow';
import { fetchSyncMeta, type KeySyncClient, type SyncFailure, type SyncMeta } from './keySyncRemote';
import { fetchPolicy, type AssistantPolicy } from './policy';
import { PROVIDER_NAMES } from './providers';

// *Sync across my devices*, en los ajustes del asistente (Docs/Doc_Clave_Sincronizada.md, secciones 2 y 9; entrega
// S1 y S2): prender la copia cifrada, abrirla en otro dispositivo con la frase (y guardarla o no en el dispositivo),
// actualizarla, reemplazarla con una frase nueva, cambiar la frase, subir otra copia a este workspace y dejar de
// sincronizar. Los pasos están en keySyncFlow.ts; esto solo los muestra.
//
// Los campos de la frase son `input` NO controlados (4.4): se leen por `ref` al tocar el botón y se vacían. La frase
// generada vive en una `ref` y se escribe directo en la página; nunca en el estado de React. Lo mismo la clave abierta
// mientras se pregunta si se usa (regla 6).

/** El host de una dirección, o la dirección tal cual si no se entiende. */
function hostOf(url: string | undefined): string {
  try {
    return new URL((url ?? '').trim()).host || (url ?? '');
  } catch {
    return url ?? '';
  }
}

/** A dónde va la clave de un sobre abierto: el host en uno compatible, el nombre del proveedor en los demás. */
export function destinationLabel(p: Pick<KeyPayload, 'provider' | 'baseUrl'>): string {
  return p.provider === 'compatible' ? hostOf(p.baseUrl) : PROVIDER_NAMES[p.provider];
}

/** *Unlocked: Anthropic key ending in …a1B2.* (con el host en uno compatible), y a dónde va la de *Voice* si viene. */
export function unlockedText(p: KeyPayload, tr: Translate): string {
  const main =
    p.provider === 'compatible'
      ? tr('assistant.sync.unlockedAt', { provider: PROVIDER_NAMES.compatible, host: hostOf(p.baseUrl), end: keyEnding(p.apiKey) })
      : tr('assistant.sync.unlocked', { provider: PROVIDER_NAMES[p.provider], end: keyEnding(p.apiKey) });
  const v = p.voice;
  if (!v) return main;
  const voice =
    v.provider === 'compatible'
      ? tr('assistant.sync.voiceUnlockedAt', { provider: PROVIDER_NAMES.compatible, host: hostOf(v.baseUrl), end: keyEnding(v.apiKey) })
      : tr('assistant.sync.voiceUnlocked', { provider: PROVIDER_NAMES[v.provider], end: keyEnding(v.apiKey) });
  return `${main} ${voice}`;
}

/** Lo que se pregunta antes de usar una copia abierta (regla 6 y O2), para la clave y para la de *Voice*. */
function questionFor(u: Unlocked, tr: Translate): string {
  const parts: string[] = [];
  if (u.decision === 'ask') parts.push(tr('assistant.sync.ask', { host: destinationLabel(u.payload) }));
  if (u.decision === 'replace') parts.push(tr('assistant.sync.askReplace', { local: u.localEnding ?? '', synced: keyEnding(u.payload.apiKey) }));
  if (u.voiceAsk === 'destination' && u.payload.voice) parts.push(tr('assistant.sync.askVoice', { host: destinationLabel(u.payload.voice) }));
  if (u.voiceAsk === 'key' && u.payload.voice)
    parts.push(tr('assistant.sync.askVoiceReplace', { local: u.voiceLocalEnding ?? '', synced: keyEnding(u.payload.voice.apiKey) }));
  return parts.join(' ');
}

function dateText(iso: string | number, lang: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(lang === 'es' ? 'es' : 'en', { dateStyle: 'medium', timeStyle: 'short' });
}

const PHRASE_FIELD = { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false } as const;

type Remote = { kind: 'loading' } | { kind: 'ok'; meta: SyncMeta | null } | { kind: 'fail'; failure: SyncFailure };
type View =
  | { kind: 'main' }
  | { kind: 'turnOn'; overwrite?: { generation: number; updatedAt?: string } }
  | { kind: 'update' }
  | { kind: 'replace' }
  | { kind: 'change' }
  | { kind: 'also' }
  | { kind: 'stop' }
  | { kind: 'ask'; question: string; unlocked: string };
type Message = { ok: boolean; text: string; reload?: boolean };

interface Props {
  /** Los ajustes del dispositivo (sin la clave). */
  saved: Saved | null;
  /** Cambió lo guardado en el dispositivo (se abrió una copia, o cambió la anotación de la copia). */
  onSaved: (next: Saved | null) => void;
}

/** Sin el cliente o el workspace (algunas pruebas arman los servicios a mano), no se muestra. */
export function KeySyncSection(props: Props) {
  const s = useServices() as Partial<Services>;
  if (!s.client || !s.workspace || !s.user) return null;
  return s.engine ? <WithEngine {...props} /> : <Section {...props} online />;
}

function WithEngine(props: Props) {
  const status = useSyncStatus();
  return <Section {...props} online={status.online} />;
}

function errorKey(outcome: SyncOutcome, unlocking: boolean): Key {
  switch (outcome) {
    case 'wrong':
      return 'assistant.sync.wrong';
    case 'newer':
      return 'assistant.sync.newer';
    case 'tooLong':
      return 'assistant.sync.tooLong';
    case 'noLocalKey':
      return 'assistant.sync.needKey';
    case 'offline':
      return unlocking ? 'assistant.sync.unlockOffline' : 'assistant.sync.offline';
    case 'missing':
      return 'assistant.sync.missing';
    case 'conflict':
      return 'assistant.sync.conflict';
    case 'older':
      return 'assistant.sync.older';
    default:
      return 'assistant.sync.failed';
  }
}

function Section({ saved, onSaved, online }: Props & { online: boolean }) {
  const { client, user, workspace } = useServices();
  const tr = useT();
  const ref = workspace.config.localKey || workspace.config.url;
  const name = workspace.config.name || hostOf(workspace.config.url);
  const ctx: SyncContext = { client: client as unknown as KeySyncClient, email: user.email, userId: user.id, ref, name };
  const [remote, setRemote] = useState<Remote>({ kind: 'loading' });
  const [policy, setPolicy] = useState<AssistantPolicy | null>(null);
  const [view, setView] = useState<View>({ kind: 'main' });
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);
  const unlockField = useRef<HTMLInputElement>(null);
  const currentField = useRef<HTMLInputElement>(null);
  const repeatField = useRef<HTMLInputElement>(null);
  /** *Keep the key on this device* (tildada de fábrica; CS7). No es un secreto: va en el estado. */
  const [keepHere, setKeepHere] = useState(true);
  /** Lo que dijo la casilla al tocar *Unlock*, para cuando la persona contesta la pregunta (regla 6). */
  const keepAtUnlock = useRef(true);
  /** La copia abierta mientras se pregunta si se usa (regla 6): en una `ref`, nunca en el estado. */
  const pending = useRef<Unlocked | null>(null);
  const newPhrase = useRef<PhraseHandle | null>(null);
  const root = useRef<HTMLElement>(null);
  const [phraseReady, setPhraseReady] = useState(false);

  const refresh = useCallback(async () => {
    if (!online) {
      setRemote({ kind: 'fail', failure: 'offline' });
      return;
    }
    setRemote({ kind: 'loading' });
    try {
      setRemote({ kind: 'ok', meta: await fetchSyncMeta(client as unknown as KeySyncClient, user.id) });
    } catch (err) {
      const o = outcomeOf(err);
      setRemote({ kind: 'fail', failure: o === 'offline' || o === 'missing' || o === 'denied' ? o : 'error' });
    }
  }, [client, user.id, online]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let live = true;
    void fetchPolicy(client, ref).then((p) => live && setPolicy(p));
    return () => {
      live = false;
    };
  }, [client, ref]);

  // Al salir de una vista, la copia abierta que esperaba respuesta se suelta. Al entrar en una, se ve entera (la
  // ventana de ajustes es larga y en el teléfono la sección queda abajo).
  useEffect(() => {
    if (view.kind !== 'ask') pending.current = null;
    if (view.kind !== 'main') root.current?.scrollIntoView?.({ block: 'nearest' });
  }, [view.kind]);

  const reload = async () => {
    onSaved(await loadSettings(user.email).catch(() => saved));
  };

  const fail = (err: unknown, unlocking = false) => {
    const outcome = outcomeOf(err);
    setMessage({ ok: false, text: tr(errorKey(outcome, unlocking)), reload: outcome === 'conflict' });
  };

  /** Corre un paso con los botones apagados; los campos de la frase se vacían siempre. */
  const step = async (fn: () => Promise<void>, unlocking = false) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (err) {
      fail(err, unlocking);
    } finally {
      for (const f of [unlockField, currentField, repeatField]) if (f.current) f.current.value = '';
      setBusy(false);
    }
  };

  const hasLocal = !!saved && !!saved.model && (saved.hasKey || saved.provider === 'compatible');
  const meta = remote.kind === 'ok' ? remote.meta : null;
  /** Lo que este dispositivo anotó de la copia de ESTE workspace (puede tener otras, de otros workspaces). */
  const entry = syncFor(saved, ref, user.id);
  const fromHere = !!meta && !!entry;
  // La copia cambió en otro dispositivo después de que este la abrió (*Update*, *Replace* o *Change passphrase* allá):
  // se vuelve a pedir la frase para tomar la nueva; hasta entonces la clave de este dispositivo sigue andando (regla 5).
  const changed = fromHere && meta.generation > entry.generation;
  const opened = fromHere && !changed;
  const other = entry ? undefined : syncEntries(saved)[0];
  const elsewhere = other ? other.name || other.ref : null;
  const off = policy === 'off';
  const disabled = busy || !online;

  const unlock = (e: FormEvent) => {
    e.preventDefault();
    const phrase = unlockField.current?.value ?? '';
    if (!phrase.trim()) return;
    keepAtUnlock.current = keepHere;
    void step(async () => {
      const unlocked = await unlockSync(ctx, phrase);
      if (!unlocked) {
        await refresh();
        return;
      }
      if (needsAnswer(unlocked)) {
        pending.current = unlocked;
        // A dónde va y el final de la clave (nunca la clave) quedan a la vista mientras se pregunta: otro destino
        // (regla 6), o el mismo con otra clave que el dispositivo no sacó de esta copia (regla 5); lo mismo con *Voice*.
        setView({ kind: 'ask', question: questionFor(unlocked, tr), unlocked: unlockedText(unlocked.payload, tr) });
        return;
      }
      onSaved(await adoptUnlocked(ctx, unlocked, { tabOnly: !keepAtUnlock.current }));
      setMessage({ ok: true, text: unlockedText(unlocked.payload, tr) });
    }, true);
  };

  const useIt = () =>
    void step(async () => {
      const unlocked = pending.current;
      pending.current = null;
      setView({ kind: 'main' });
      if (!unlocked) return;
      onSaved(await adoptUnlocked(ctx, unlocked, { tabOnly: !keepAtUnlock.current }));
      setMessage({ ok: true, text: unlockedText(unlocked.payload, tr) });
    });

  const keepMine = () => {
    pending.current = null;
    setView({ kind: 'main' });
    setMessage({ ok: true, text: tr('assistant.sync.kept') });
  };

  const turnOn = (e: FormEvent) => {
    e.preventDefault();
    if (view.kind !== 'turnOn') return;
    const phrase = newPhrase.current?.read();
    if (!phrase) return;
    const overwrite = view.overwrite;
    void step(async () => {
      await turnOnSync(ctx, phrase, overwrite);
      newPhrase.current?.clear();
      setView({ kind: 'main' });
      setMessage({ ok: true, text: tr('assistant.sync.done', { workspace: name }) });
      await reload();
      await refresh();
    });
  };

  const update = (e: FormEvent) => {
    e.preventDefault();
    const phrase = currentField.current?.value ?? '';
    if (!phrase.trim()) return;
    void step(async () => {
      await updateSync(ctx, phrase);
      setView({ kind: 'main' });
      setMessage({ ok: true, text: tr('assistant.sync.updated') });
      await reload();
      await refresh();
    });
  };

  const replace = (e: FormEvent) => {
    e.preventDefault();
    const current = currentField.current?.value ?? '';
    if (!current.trim()) return;
    const next = newPhrase.current?.read();
    if (!next) return;
    void step(async () => {
      await replaceSync(ctx, current, next);
      newPhrase.current?.clear();
      setView({ kind: 'main' });
      setMessage({ ok: true, text: tr('assistant.sync.replaced') });
      await reload();
      await refresh();
    });
  };

  const change = (e: FormEvent) => {
    e.preventDefault();
    const current = currentField.current?.value ?? '';
    if (!current.trim()) return;
    const next = newPhrase.current?.read();
    if (!next) return;
    void step(async () => {
      await changePassphrase(ctx, current, next);
      newPhrase.current?.clear();
      setView({ kind: 'main' });
      setMessage({ ok: true, text: tr('assistant.sync.passphraseChanged') });
      await reload();
      await refresh();
    });
  };

  const also = (e: FormEvent) => {
    e.preventDefault();
    const a = currentField.current?.value ?? '';
    const b = repeatField.current?.value ?? '';
    if (!a.trim()) return;
    // La copia de allá no se puede abrir desde acá: la frase se escribe dos veces (regla 7) y tiene que servir de frase.
    if (!ownPassphraseOk(a)) {
      setMessage({ ok: false, text: tr('assistant.sync.ownRule') });
      return;
    }
    if (a !== b) {
      for (const f of [currentField, repeatField]) if (f.current) f.current.value = '';
      setMessage({ ok: false, text: tr('assistant.sync.mismatch') });
      return;
    }
    void step(async () => {
      await alsoSync(ctx, a);
      setView({ kind: 'main' });
      setMessage({ ok: true, text: tr('assistant.sync.done', { workspace: name }) });
      await reload();
      await refresh();
    });
  };

  const stop = () =>
    void step(async () => {
      await stopSync(ctx);
      setView({ kind: 'main' });
      setMessage({ ok: true, text: tr('assistant.sync.stopped') });
      await reload();
      await refresh();
    });

  const cancel = () => {
    setView({ kind: 'main' });
    setMessage(null);
  };

  const back = (
    <button type="button" className="link" disabled={busy} onClick={cancel}>
      {tr('common.cancel')}
    </button>
  );

  let body: ReactNode;
  if (view.kind === 'turnOn' || view.kind === 'replace' || view.kind === 'change') {
    const isReplace = view.kind === 'replace' || view.kind === 'change';
    body = (
      <form className="assistant-sync-form" onSubmit={view.kind === 'replace' ? replace : view.kind === 'change' ? change : turnOn}>
        {/* El usuario oculto: así el gestor de contraseñas la guarda con nombre propio (4.4). */}
        <input className="sr-only" type="text" name="username" autoComplete="username" value="Shot Docs assistant key" readOnly tabIndex={-1} aria-hidden="true" />
        {isReplace && (
          <>
            <p className="muted assistant-small">{tr(view.kind === 'change' ? 'assistant.sync.changeText' : 'assistant.sync.replaceText')}</p>
            <label className="assistant-field">
              <span className="pref-label">{tr('assistant.sync.currentPassphrase')}</span>
              <input ref={currentField} type="password" name="current-passphrase" autoComplete="current-password" {...PHRASE_FIELD} />
            </label>
            <span className="pref-label">{tr('assistant.sync.newPassphrase')}</span>
          </>
        )}
        <NewPassphrase handle={newPhrase} onReadyChange={setPhraseReady} onMessage={setMessage} />
        <div className="modal-actions">
          {back}
          <button type="submit" className="primary" disabled={disabled || !phraseReady}>
            {tr(view.kind === 'replace' ? 'assistant.sync.replaceButton' : view.kind === 'change' ? 'assistant.sync.changeButton' : 'assistant.sync.turnOnButton')}
          </button>
        </div>
        <p className="muted assistant-small">{tr('assistant.sync.footnote', { workspace: name })}</p>
      </form>
    );
  } else if (view.kind === 'update') {
    body = (
      <form className="assistant-sync-form" onSubmit={update}>
        <input className="sr-only" type="text" name="username" autoComplete="username" value="Shot Docs assistant key" readOnly tabIndex={-1} aria-hidden="true" />
        <p className="muted assistant-small">{tr('assistant.sync.updateText')}</p>
        <label className="assistant-field">
          <span className="pref-label">{tr('assistant.sync.passphrase')}</span>
          <input ref={currentField} type="password" name="passphrase" autoComplete="current-password" {...PHRASE_FIELD} />
        </label>
        <div className="modal-actions">
          {back}
          <button type="submit" className="primary" disabled={disabled}>
            {tr('assistant.sync.update')}
          </button>
        </div>
      </form>
    );
  } else if (view.kind === 'also') {
    body = (
      <form className="assistant-sync-form" onSubmit={also}>
        <input className="sr-only" type="text" name="username" autoComplete="username" value="Shot Docs assistant key" readOnly tabIndex={-1} aria-hidden="true" />
        <p className="muted assistant-small">{tr('assistant.sync.alsoText', { other: elsewhere ?? '', workspace: name })}</p>
        <label className="assistant-field">
          <span className="pref-label">{tr('assistant.sync.passphrase')}</span>
          <input ref={currentField} type="password" name="passphrase" autoComplete="current-password" {...PHRASE_FIELD} />
        </label>
        <label className="assistant-field">
          <span className="pref-label">{tr('assistant.sync.repeat')}</span>
          <input ref={repeatField} type="password" name="passphrase-repeat" autoComplete="current-password" {...PHRASE_FIELD} />
        </label>
        <button type="button" className="link" disabled={busy} onClick={() => (setMessage(null), setView({ kind: 'turnOn' }))}>
          {tr('assistant.sync.useNewPassphrase')}
        </button>
        <div className="modal-actions">
          {back}
          <button type="submit" className="primary" disabled={disabled}>
            {tr('assistant.sync.alsoButton')}
          </button>
        </div>
        <p className="muted assistant-small">{tr('assistant.sync.footnote', { workspace: name })}</p>
      </form>
    );
  } else if (view.kind === 'stop') {
    body = (
      <>
        <p>{tr('assistant.sync.stopText', { workspace: name })}</p>
        <div className="modal-actions">
          {back}
          <button type="button" className="primary danger" disabled={disabled} onClick={stop}>
            {tr('assistant.sync.deleteCopy')}
          </button>
        </div>
      </>
    );
  } else if (view.kind === 'ask') {
    body = (
      <>
        <p className="assistant-ok" role="status">
          {view.unlocked}
        </p>
        <p className="assistant-warning">{view.question}</p>
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={keepMine}>
            {tr('assistant.sync.keepMine')}
          </button>
          <button type="button" className="primary" disabled={busy} onClick={useIt}>
            {tr('assistant.sync.useIt')}
          </button>
        </div>
      </>
    );
  } else if (!online || (remote.kind === 'fail' && remote.failure === 'offline')) {
    body = <p className="muted assistant-small">{tr('assistant.sync.offline')}</p>;
  } else if (remote.kind === 'loading') {
    body = null;
  } else if (remote.kind === 'fail') {
    body =
      remote.failure === 'missing' ? (
        <p className="muted assistant-small">{tr('assistant.sync.missing')}</p>
      ) : (
        <div className="assistant-row">
          <p className="assistant-error">{tr('assistant.sync.failed')}</p>
          <button type="button" onClick={() => void refresh()}>
            {tr('assistant.sync.reload')}
          </button>
        </div>
      );
  } else if (!meta) {
    body = !hasLocal ? (
      <p className="muted assistant-small">{tr('assistant.sync.needKey')}</p>
    ) : off ? (
      <p className="muted assistant-small">{tr('assistant.sync.policyOff')}</p>
    ) : elsewhere ? (
      // La clave ya está sincronizada en otro workspace (CS2): acá se puede subir otra copia, con la misma frase.
      <div className="assistant-row assistant-sync-row">
        <p className="muted assistant-small">{tr('assistant.sync.elsewhere', { workspace: elsewhere })}</p>
        <button type="button" disabled={disabled || policy === null} onClick={() => (setMessage(null), setView({ kind: 'also' }))}>
          {tr('assistant.sync.alsoSync')}
        </button>
      </div>
    ) : (
      <div className="assistant-row assistant-sync-row">
        <p className="muted assistant-small">{tr('assistant.sync.onlyHere')}</p>
        <button type="button" disabled={disabled || policy === null} onClick={() => (setMessage(null), setView({ kind: 'turnOn' }))}>
          {tr('assistant.sync.turnOn')}
        </button>
      </div>
    );
  } else if (opened) {
    body = (
      <>
        <p className="muted assistant-small">{tr('assistant.sync.synced', { workspace: name, date: dateText(meta.updatedAt, tr.lang) })}</p>
        {saved?.tabOnly && <p className="muted assistant-small">{tr('assistant.sync.tabOnly')}</p>}
        {entry.localChanged && hasLocal && <p className="assistant-warning">{tr('assistant.sync.localChanged')}</p>}
        <div className="modal-actions assistant-sync-actions">
          <button type="button" className="link danger" disabled={disabled} onClick={() => (setMessage(null), setView({ kind: 'stop' }))}>
            {tr('assistant.sync.stop')}
          </button>
          <button type="button" disabled={disabled} onClick={() => (setMessage(null), setView({ kind: 'change' }))}>
            {tr('assistant.sync.change')}
          </button>
          {hasLocal && (
            <button type="button" disabled={disabled} onClick={() => (setMessage(null), setView({ kind: 'replace' }))}>
              {tr('assistant.sync.replace')}
            </button>
          )}
          {entry.localChanged && hasLocal && (
            <button type="button" className="primary" disabled={disabled} onClick={() => (setMessage(null), setView({ kind: 'update' }))}>
              {tr('assistant.sync.update')}
            </button>
          )}
        </div>
      </>
    );
  } else {
    // Hay copia y este dispositivo no la abrió (o cambió desde que la abrió): se pide la frase. *Forgot it?* no se ofrece
    // si la persona tiene la copia en otro workspace (una fila plantada acá) ni si la copia cambió en otro dispositivo y
    // la clave de este no se tocó: pisaría la nueva con la vieja (quizás la revocada de un dispositivo perdido).
    const canForget = !elsewhere && (!changed || !!entry?.localChanged);
    body = (
      <form className="assistant-sync-form" onSubmit={unlock}>
        <input className="sr-only" type="text" name="username" autoComplete="username" value="Shot Docs assistant key" readOnly tabIndex={-1} aria-hidden="true" />
        <p className="muted assistant-small">
          {elsewhere
            ? tr('assistant.sync.elsewhere', { workspace: elsewhere })
            : changed
              ? tr('assistant.sync.changed')
              : tr('assistant.sync.locked', { date: dateText(meta.updatedAt, tr.lang) })}
        </p>
        <div className="assistant-field">
          <label className="pref-label" htmlFor="assistant-sync-passphrase">
            {tr('assistant.sync.passphrase')}
          </label>
          <div className="assistant-row">
            <input id="assistant-sync-passphrase" ref={unlockField} type="password" name="passphrase" autoComplete="current-password" {...PHRASE_FIELD} />
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void navigator.clipboard
                  .readText()
                  .then((text) => {
                    if (unlockField.current && text) unlockField.current.value = text.trim();
                  })
                  .catch(() => setMessage({ ok: false, text: tr('assistant.settings.pasteFailed') }))
              }
            >
              {tr('assistant.settings.paste')}
            </button>
          </div>
        </div>
        <label className="folder-check" data-tip={tr('assistant.sync.keepHereTip')}>
          <input type="checkbox" checked={keepHere} onChange={(e) => setKeepHere(e.target.checked)} /> {tr('assistant.sync.keepHere')}
        </label>
        {canForget && <p className="muted assistant-small">{tr('assistant.sync.forgot')}</p>}
        <div className="modal-actions assistant-sync-actions">
          <button type="button" className="link danger" disabled={disabled} onClick={() => (setMessage(null), setView({ kind: 'stop' }))}>
            {tr('assistant.sync.stop')}
          </button>
          {canForget && hasLocal && !off && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => (setMessage(null), setView({ kind: 'turnOn', overwrite: { generation: meta.generation, updatedAt: meta.updatedAt } }))}
            >
              {tr('assistant.sync.newPassphraseButton')}
            </button>
          )}
          <button type="submit" className="primary" disabled={disabled}>
            {tr('assistant.sync.unlock')}
          </button>
        </div>
      </form>
    );
  }

  return (
    <section ref={root} className="assistant-sync" aria-labelledby="assistant-sync-title">
      <h3 id="assistant-sync-title" className="pref-label">
        {tr('assistant.sync.title')}
      </h3>
      {body}
      {message && (
        <div className="assistant-row">
          <p className={message.ok ? 'assistant-ok' : 'assistant-error'} role="status">
            {message.text}
          </p>
          {message.reload && (
            <button
              type="button"
              onClick={() => {
                setMessage(null);
                setView({ kind: 'main' });
                void reload();
                void refresh();
              }}
            >
              {tr('assistant.sync.reload')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// --- La frase nueva: la generada (de fábrica) o una propia ---------------------------------------------------------

interface PhraseHandle {
  /** La frase elegida, o `null` (con el error a la vista) si todavía no sirve. */
  read: () => string | null;
  /** Suelta la frase y vacía los campos. */
  clear: () => void;
}

function NewPassphrase({
  handle,
  onReadyChange,
  onMessage,
}: {
  handle: MutableRefObject<PhraseHandle | null>;
  onReadyChange: (ready: boolean) => void;
  onMessage: (m: Message | null) => void;
}) {
  const tr = useT();
  const [own, setOwn] = useState(false);
  const [savedIt, setSavedIt] = useState(false);
  const phrase = useRef('');
  const out = useRef<HTMLOutputElement | null>(null);
  const hidden = useRef<HTMLInputElement | null>(null);
  const own1 = useRef<HTMLInputElement>(null);
  const own2 = useRef<HTMLInputElement>(null);

  if (!phrase.current) phrase.current = generatePassphrase();

  const show = () => {
    if (out.current) out.current.textContent = phrase.current;
    if (hidden.current) hidden.current.value = phrase.current;
  };

  useEffect(() => {
    onReadyChange(own || savedIt);
  }, [own, savedIt, onReadyChange]);

  useEffect(() => {
    handle.current = {
      read: () => {
        if (!own) return savedIt && phrase.current ? phrase.current : null;
        const a = own1.current?.value ?? '';
        const b = own2.current?.value ?? '';
        if (!ownPassphraseOk(a)) {
          onMessage({ ok: false, text: tr('assistant.sync.ownRule') });
          return null;
        }
        if (a !== b) {
          onMessage({ ok: false, text: tr('assistant.sync.mismatch') });
          return null;
        }
        return a;
      },
      clear: () => {
        phrase.current = '';
        for (const f of [own1, own2, hidden]) if (f.current) f.current.value = '';
        if (out.current) out.current.textContent = '';
      },
    };
    return () => {
      handle.current = null;
    };
  }, [handle, own, savedIt, onMessage, tr]);

  // Al desmontar (Cancel, cerrar la ventana), la frase generada se suelta.
  useEffect(
    () => () => {
      phrase.current = '';
    },
    [],
  );

  if (own) {
    return (
      <>
        <p className="assistant-warning">{tr('assistant.sync.ownWarning')}</p>
        <label className="assistant-field">
          <span className="pref-label">{tr('assistant.sync.passphrase')}</span>
          <input ref={own1} type="password" name="new-passphrase" autoComplete="new-password" {...PHRASE_FIELD} />
          <span className="muted assistant-small">{tr('assistant.sync.ownRule')}</span>
        </label>
        <label className="assistant-field">
          <span className="pref-label">{tr('assistant.sync.repeat')}</span>
          <input ref={own2} type="password" name="new-passphrase-repeat" autoComplete="new-password" {...PHRASE_FIELD} />
        </label>
        <button type="button" className="link" onClick={() => (onMessage(null), setOwn(false))}>
          {tr('assistant.sync.useGenerated')}
        </button>
      </>
    );
  }
  return (
    <>
      <div className="assistant-field">
        <span className="pref-label">{tr('assistant.sync.yourPassphrase')}</span>
        <div className="assistant-row">
          <output
            className="assistant-phrase"
            ref={(el) => {
              out.current = el;
              show();
            }}
          />
          <button
            type="button"
            onClick={() =>
              void navigator.clipboard
                .writeText(phrase.current)
                .then(() => onMessage({ ok: true, text: tr('assistant.sync.copied') }))
                .catch(() => undefined)
            }
          >
            {tr('assistant.sync.copy')}
          </button>
          <button
            type="button"
            onClick={() => {
              phrase.current = generatePassphrase();
              show();
              setSavedIt(false);
              onMessage(null);
            }}
          >
            {tr('assistant.sync.newOne')}
          </button>
        </div>
        {/* La misma frase en un campo de contraseña escondido: al tocar el botón, el navegador ofrece guardarla. */}
        <input
          className="sr-only"
          type="password"
          name="new-passphrase"
          autoComplete="new-password"
          tabIndex={-1}
          aria-hidden="true"
          readOnly
          ref={(el) => {
            hidden.current = el;
            show();
          }}
        />
      </div>
      <p className="muted assistant-small">{tr('assistant.sync.saveIt')}</p>
      <button type="button" className="link" onClick={() => (onMessage(null), setSavedIt(false), setOwn(true))}>
        {tr('assistant.sync.useOwn')}
      </button>
      <label className="folder-check">
        <input type="checkbox" checked={savedIt} onChange={(e) => setSavedIt(e.target.checked)} /> {tr('assistant.sync.saved')}
      </label>
    </>
  );
}
