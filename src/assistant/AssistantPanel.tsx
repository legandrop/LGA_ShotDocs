import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useT, type Translate } from '../i18n';
import '../i18n/lazy/assistant';
import { usePermissions, useServices, useSyncStatus } from '../services';
import { CloseIcon, SettingsIcon } from '../ui/icons';
import { IS_MAC, modPressed } from '../ui/findUi';
import { shortcutLabel } from '../ui/shortcuts';
import { applySuggestion, retakeSnapshot, takeSnapshot, type Snapshot } from './apply';
import { closeAssistant, openAssistantSettings, useAssistantTarget, useAssistantUi } from './assistantUi';
import { loadSettings, readKey, rememberLanguage, type AssistantSettings } from './keyStore';
import { cleanAnswer, diffKeys, parseAnswer, plainNew, type NewUnit, type OldUnit, type Parsed } from './markup';
import { fetchPolicy, policyAllows, type AssistantPolicy } from './policy';
import { ACTIONS, buildRequest, EDIT_ONLY, LANGUAGES, type Action } from './prompt';
import { complete, isLocalProvider, PROVIDER_NAMES, ProviderError, type Usage } from './providers';
import './assistant.css';

// El panel del asistente (Docs/Doc_Asistente.md, entrega A1, secciones 6 y 11): las acciones sobre lo elegido, la
// respuesta por partes, la vista previa y *Apply* / *Discard* / *Try again* / *Copy* / *Stop*. A la derecha, como los
// comentarios; en el teléfono, una hoja desde abajo. No es un diálogo: la página sigue a mano mientras el modelo piensa.
//
// La vista previa se dibuja con lo ya convertido y validado (markup.ts), nunca con el Markdown como HTML: sin imágenes,
// sin links, sin nada que el navegador vaya a buscar afuera (6.1, paso 4).

type Phase =
  | { kind: 'idle'; note?: string }
  | { kind: 'running'; action: Action; text: string }
  /** `retake`: lo elegido cambió; *Try again* pide sobre lo que hay hoy en el mismo lugar. */
  | { kind: 'error'; action: Action; message: string; text?: string; retake?: boolean }
  | { kind: 'preview'; action: Action; parsed: Parsed; warnings: string[] };

interface Run {
  action: Action;
  snapshot: Snapshot;
  language?: string;
  instruction?: string;
}

/** El nombre de la clave CSS de lo elegido resaltado en la página (la API de resaltados: no toca el documento). */
const HIGHLIGHT = 'sd-assistant';

/** Resalta lo elegido en la página mientras se ve la vista previa (si el navegador sabe). Devuelve cómo sacarlo. */
function highlight(view: { domAtPos: (pos: number) => { node: Node; offset: number } } | null, from: number, to: number): () => void {
  const css = globalThis.CSS as unknown as { highlights?: Map<string, unknown> } | undefined;
  const H = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (!view || !css?.highlights || !H) return () => undefined;
  try {
    const a = view.domAtPos(from);
    const b = view.domAtPos(to);
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    css.highlights.set(HIGHLIGHT, new H(range));
  } catch {
    return () => undefined;
  }
  return () => css.highlights?.delete(HIGHLIGHT);
}

export function errorText(err: unknown, provider: string, tr: Translate): string {
  if (!(err instanceof ProviderError)) return tr('assistant.error.other', { provider, message: String((err as Error)?.message ?? err) });
  switch (err.kind) {
    case 'auth':
      return tr('assistant.error.auth', { provider });
    case 'forbidden':
      return tr('assistant.error.forbidden', { provider, message: err.message });
    case 'rateLimit':
      return err.retryAfter !== null ? tr('assistant.error.rateLimitIn', { seconds: err.retryAfter }) : tr('assistant.error.rateLimit');
    case 'spendTier':
      return tr('assistant.error.spendTier', { provider });
    case 'spendOwn':
      return tr('assistant.error.spendOwn', { provider });
    case 'model':
      return tr('assistant.error.model', { message: err.message });
    case 'network':
      return tr('assistant.error.network', { provider });
    case 'server':
      return tr('assistant.error.server', { provider, message: err.message });
    case 'aborted':
      return tr('assistant.stopped');
    default:
      return tr('assistant.error.other', { provider, message: err.message });
  }
}

const actionLabel = (a: Action, tr: Translate) =>
  tr(a === 'fix' ? 'assistant.fix' : a === 'improve' ? 'assistant.improve' : a === 'shorter' ? 'assistant.shorter' : a === 'translate' ? 'assistant.translate' : 'assistant.ask');

/** Una unidad dibujada con su formato (sin links ni imágenes de verdad). */
function Unit({ u }: { u: { text: string; marks: string[]; link: number | null; atom?: string } }) {
  if (u.atom === 'photo') return <span className="assistant-chip">▣</span>;
  if (u.atom === 'br' || u.text === '\n') return <br />;
  const cls = [...u.marks.map((m) => `md-${m}`), u.link !== null ? 'md-link' : ''].filter(Boolean).join(' ');
  return cls ? <span className={cls}>{u.text}</span> : <>{u.text}</>;
}

/** Lo de antes y lo de después de un pedazo, con lo sacado tachado y lo agregado subrayado (por palabras). */
function PieceDiff({ before, after }: { before: OldUnit[]; after: NewUnit[] }) {
  // Para leer, dos cambios separados solo por un espacio se muestran juntos ("el kamara" → "La cámara"); aplicar
  // igual deja ese espacio como estaba.
  const hunks: { a0: number; a1: number; b0: number; b1: number }[] = [];
  const space = (u: { text: string }) => u.text.trim() === '' && u.text !== '\n';
  for (const h of diffKeys(
    before.map((u) => u.key),
    after.map((u) => u.key),
  )) {
    const prev = hunks[hunks.length - 1];
    if (prev && before.slice(prev.a1, h.a0).every(space) && after.slice(prev.b1, h.b0).every(space)) {
      prev.a1 = h.a1;
      prev.b1 = h.b1;
    } else hunks.push({ ...h });
  }
  const out: ReactNode[] = [];
  const asView = (u: NewUnit) => {
    const first = u.atoms[0];
    if (!first || first.t === 'photo') return { text: '', marks: [], link: null, atom: 'photo' };
    if (first.t === 'br') return { text: '\n', marks: [], link: null, atom: 'br' };
    return { text: u.text, marks: first.marks as string[], link: first.link };
  };
  let i = 0;
  let k = 0;
  for (const h of [...hunks, { a0: before.length, a1: before.length, b0: after.length, b1: after.length }]) {
    for (; i < h.a0; i++) out.push(<Unit key={`e${k++}`} u={before[i]} />);
    if (h.a1 > h.a0) out.push(<del key={`d${k++}`}>{before.slice(h.a0, h.a1).map((u, n) => <Unit key={n} u={u} />)}</del>);
    if (h.b1 > h.b0) out.push(<ins key={`i${k++}`}>{after.slice(h.b0, h.b1).map((u, n) => <Unit key={n} u={asView(u)} />)}</ins>);
    i = h.a1;
  }
  return <p className="assistant-diff-block">{out}</p>;
}

export function AssistantPanel({ pageId }: { pageId: string }) {
  const services = useServices();
  const { user, workspace, client } = services;
  const status = useSyncStatus();
  const perms = usePermissions();
  const target = useAssistantTarget(pageId);
  const { settings: settingsOpen } = useAssistantUi();
  const tr = useT();
  const [settings, setSettings] = useState<AssistantSettings | null | undefined>(undefined);
  const [policy, setPolicy] = useState<AssistantPolicy | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [usage, setUsage] = useState<Usage | null>(null);
  const [language, setLanguage] = useState('en');
  const [instruction, setInstruction] = useState('');
  const run = useRef<Run | null>(null);
  const abort = useRef<AbortController | null>(null);
  const root = useRef<HTMLElement>(null);

  // Los ajustes se vuelven a leer al cerrar la ventana de ajustes (pudo cambiar el proveedor o la clave).
  useEffect(() => {
    if (settingsOpen) return;
    let live = true;
    void loadSettings(user.email)
      .then((s) => {
        if (!live) return;
        setSettings(s);
        if (s?.translateTo) setLanguage(s.translateTo);
      })
      .catch(() => live && setSettings(null));
    return () => {
      live = false;
    };
  }, [user.email, settingsOpen]);

  useEffect(() => {
    let live = true;
    void fetchPolicy(client, workspace.config.localKey || workspace.config.url).then((p) => live && setPolicy(p));
    return () => {
      live = false;
    };
  }, [client, workspace.config.localKey, workspace.config.url]);

  // Cerrar el panel, cambiar de página o recargar descarta la sugerencia y corta el pedido (6.5).
  useEffect(() => () => abort.current?.abort(), []);

  // Lo elegido, resaltado en la página mientras se ve la sugerencia.
  const snapshotRange = run.current?.snapshot.selected;
  const showing = phase.kind === 'preview' || phase.kind === 'running';
  useEffect(() => {
    if (!showing || !snapshotRange) return;
    return highlight(target?.view() ?? null, snapshotRange.from, snapshotRange.to);
  }, [showing, snapshotRange, target]);

  const canEdit = perms.canEditPage(pageId) && (target?.editable() ?? false);
  const config = settings ? { provider: settings.provider, baseUrl: settings.baseUrl, model: settings.model } : null;
  const ready = !!settings && (settings.hasKey || settings.provider === 'compatible') && !!settings.model;
  const local = config ? isLocalProvider(config) : false;
  const allowed = policy === null || !config ? true : policyAllows(policy, config);
  const offline = !status.online && !local;
  const providerName = settings ? PROVIDER_NAMES[settings.provider] : '';
  const busy = phase.kind === 'running';

  const start = useCallback(
    async (action: Action, again?: Run, retake = false) => {
      if (!settings || !config || busy) return;
      const view = target?.view();
      if (!view) return;
      let next: Run;
      if (again && retake) {
        // Lo elegido cambió: se pide de nuevo sobre lo que hay hoy en el mismo lugar.
        const snapshot = retakeSnapshot(view.state, again.snapshot);
        if (snapshot === 'empty' || snapshot === 'tooLong') {
          run.current = null;
          setPhase({ kind: 'idle', note: tr(snapshot === 'empty' ? 'assistant.nothingSelected' : 'assistant.tooLong') });
          return;
        }
        next = { ...again, snapshot };
      } else if (again) next = again;
      else {
        const snapshot = takeSnapshot(view.state);
        if (snapshot === 'empty' || snapshot === 'tooLong') {
          setPhase({ kind: 'idle', note: tr(snapshot === 'empty' ? 'assistant.nothingSelected' : 'assistant.tooLong') });
          return;
        }
        const lang = LANGUAGES.find((l) => l.id === language) ?? LANGUAGES[0];
        next = { action, snapshot, language: lang.english, instruction: action === 'ask' ? instruction : undefined };
        if (action === 'translate') void rememberLanguage(user.email, lang.id).catch(() => undefined);
      }
      run.current = next;
      const controller = new AbortController();
      abort.current?.abort();
      abort.current = controller;
      setUsage(null);
      setPhase({ kind: 'running', action: next.action, text: '' });
      const request = buildRequest(next.action, next.snapshot.selected, { language: next.language, instruction: next.instruction });
      try {
        // La clave se descifra recién acá y queda solo en esta llamada.
        const answer = await complete(config, await readKey(user.email, config), request, {
          signal: controller.signal,
          onText: (text) => {
            if (abort.current === controller) setPhase({ kind: 'running', action: next.action, text });
          },
        });
        if (abort.current !== controller) return;
        setUsage(answer.usage);
        if (answer.cut || !cleanAnswer(answer.text)) {
          setPhase({ kind: 'error', action: next.action, message: tr('assistant.cutOff'), text: answer.text });
          return;
        }
        const parsed = parseAnswer(answer.text, next.snapshot.selected);
        if (typeof parsed === 'string') {
          const message =
            parsed === 'marker' ? tr('assistant.invalid.marker') : parsed === 'structure' ? tr('assistant.invalid.structure') : tr('assistant.cutOff');
          setPhase({ kind: 'error', action: next.action, message, text: answer.text });
          return;
        }
        setPhase({ kind: 'preview', action: next.action, parsed, warnings: warningsOf(next, parsed, tr) });
      } catch (err) {
        if (abort.current !== controller) return;
        setPhase({ kind: 'error', action: next.action, message: errorText(err, providerName, tr) });
      }
    },
    [settings, config, busy, target, language, instruction, user.email, tr, providerName],
  );

  const stop = () => {
    abort.current?.abort();
    abort.current = null;
    setPhase((p) => (p.kind === 'running' ? { kind: 'error', action: p.action, message: tr('assistant.stopped'), text: p.text } : p));
  };

  const discard = () => {
    abort.current?.abort();
    abort.current = null;
    run.current = null;
    setPhase({ kind: 'idle' });
  };

  const apply = () => {
    if (phase.kind !== 'preview' || !run.current) return;
    const view = target?.view();
    if (!view) {
      setPhase({ kind: 'error', action: phase.action, message: tr('assistant.readOnly') });
      return;
    }
    // El permiso se mira otra vez al aplicar (7.1): pudo cambiar mientras se veía la sugerencia.
    const allowed = perms.canEditPage(pageId) && (target?.editable() ?? false);
    const outcome = applySuggestion(view, run.current.snapshot, phase.parsed, allowed);
    if (!outcome.ok) {
      const message = outcome.reason === 'changed' ? tr('assistant.changed') : outcome.reason === 'readOnly' ? tr('assistant.readOnly') : tr('assistant.failed');
      setPhase({ kind: 'error', action: phase.action, message, retake: outcome.reason === 'changed' });
      return;
    }
    run.current = null;
    setPhase({ kind: 'idle', note: tr('assistant.applied', { undo: shortcutLabel('undo') }) });
    view.focus();
  };

  const copy = () => {
    const text =
      phase.kind === 'preview'
        ? plainNew(phase.parsed.blocks)
        : phase.kind === 'error' || phase.kind === 'running'
          ? cleanAnswer(phase.text ?? '').replace(/⟦\/?(?:photo|link|block)(?::\d+)?⟧/g, '')
          : '';
    if (text) void navigator.clipboard?.writeText(text).catch(() => undefined);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (phase.kind === 'idle') closeAssistant();
      else if (phase.kind === 'running') stop();
      else discard();
      return;
    }
    if (e.key === 'Enter' && modPressed(e, IS_MAC) && phase.kind === 'preview' && canEdit) {
      e.preventDefault();
      apply();
    }
  };

  // Al abrir, el foco va al panel (Esc lo cierra); la página sigue a mano.
  useEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, []);

  // El botón que se tocó desaparece al pedir (y otra vez con la respuesta) y el foco queda en la nada: vuelve al panel,
  // así Esc y Ctrl/⌘+Enter andan sin hacer clic. Si la persona siguió escribiendo en la página, el foco queda donde está.
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) root.current?.focus({ preventScroll: true });
  }, [phase.kind]);

  const notice = !allowed
    ? tr(policy === 'off' ? 'assistant.policyOff' : 'assistant.policyLocal')
    : offline
      ? tr('assistant.offline')
      : null;
  const blocked = !ready || !allowed || offline;

  return (
    <aside
      ref={root}
      className="assistant-panel"
      role="complementary"
      aria-label={tr('assistant.title')}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <header className="assistant-head">
        <h2>{tr('assistant.title')}</h2>
        <button className="icon-button" aria-label={tr('assistant.settings')} data-tip={tr('assistant.settings')} onClick={openAssistantSettings}>
          <SettingsIcon size={18} />
        </button>
        <button className="icon-button" aria-label={tr('assistant.close')} onClick={closeAssistant}>
          <CloseIcon size={18} />
        </button>
      </header>
      <div className="assistant-body">
        {settings === undefined ? null : !ready ? (
          <div className="assistant-setup">
            <p>{tr('assistant.setupText')}</p>
            <button className="primary" onClick={openAssistantSettings}>
              {tr('assistant.setup')}
            </button>
          </div>
        ) : (
          <>
            {notice && (
              <p className="assistant-notice" role="status">
                {notice}
              </p>
            )}
            {!canEdit && (perms.known || target?.editable() === false) && <p className="assistant-notice">{tr('assistant.readOnly')}</p>}
            {phase.kind === 'idle' && (
              <div className="assistant-actions">
                {ACTIONS.filter((a) => a !== 'translate' && a !== 'ask').map((a) => (
                  <button key={a} className="assistant-action" disabled={blocked || (EDIT_ONLY.has(a) && !canEdit)} onClick={() => void start(a)}>
                    {actionLabel(a, tr)}
                  </button>
                ))}
                <div className="assistant-row">
                  <button className="assistant-action" disabled={blocked} onClick={() => void start('translate')}>
                    {tr('assistant.translate')}
                  </button>
                  <select aria-label={tr('assistant.language')} value={language} onChange={(e) => setLanguage(e.target.value)} disabled={blocked}>
                    {LANGUAGES.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.native}
                      </option>
                    ))}
                  </select>
                </div>
                <form
                  className="assistant-ask"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (instruction.trim()) void start('ask');
                  }}
                >
                  <input
                    type="text"
                    value={instruction}
                    placeholder={tr('assistant.askPlaceholder')}
                    aria-label={tr('assistant.ask')}
                    maxLength={500}
                    disabled={blocked}
                    onChange={(e) => setInstruction(e.target.value)}
                  />
                  <button type="submit" disabled={blocked || !instruction.trim()}>
                    {tr('assistant.send')}
                  </button>
                </form>
                <p className="muted assistant-hint">{phase.note ?? tr('assistant.hint')}</p>
              </div>
            )}
            {phase.kind === 'running' && (
              <div className="assistant-result">
                <p className="mono-label">{tr('assistant.thinking', { action: actionLabel(phase.action, tr) })}</p>
                {/* Lo que llega, como texto: nada se interpreta hasta el final. */}
                <div className="assistant-stream">{phase.text}</div>
                <div className="assistant-buttons">
                  <button onClick={stop}>{tr('assistant.stop')}</button>
                </div>
              </div>
            )}
            {phase.kind === 'error' && (
              <div className="assistant-result">
                <p className="assistant-error" role="alert">
                  {phase.message}
                </p>
                {phase.text && <div className="assistant-stream">{cleanAnswer(phase.text)}</div>}
                <div className="assistant-buttons">
                  {run.current && (
                    <button className="primary" disabled={blocked} onClick={() => void start(run.current!.action, run.current!, phase.retake)}>
                      {tr('assistant.tryAgain')}
                    </button>
                  )}
                  {phase.text && <button onClick={copy}>{tr('assistant.copy')}</button>}
                  <button className="link" onClick={discard}>
                    {tr('assistant.back')}
                  </button>
                </div>
              </div>
            )}
            {phase.kind === 'preview' && run.current && (
              <div className="assistant-result">
                <p className="mono-label">{actionLabel(phase.action, tr)}</p>
                <div className="assistant-diff" aria-label={tr('assistant.preview')}>
                  {run.current.snapshot.selected.pieces.map((piece, i) =>
                    piece.kind === 'block' ? (
                      <p key={i} className="assistant-diff-block">
                        <span className="assistant-chip">{tr('assistant.blockChip')}</span>
                      </p>
                    ) : (
                      <PieceDiff key={i} before={piece.units} after={phase.parsed.blocks[i] ?? []} />
                    ),
                  )}
                </div>
                {phase.warnings.map((w) => (
                  <p key={w} className="assistant-warning">
                    {w}
                  </p>
                ))}
                <div className="assistant-buttons">
                  <button className="primary" disabled={!canEdit} data-tip={shortcutLabel('assistantApply')} onClick={apply}>
                    {tr('assistant.apply')}
                  </button>
                  <button onClick={discard} data-tip={shortcutLabel('menusClose')}>
                    {tr('assistant.discard')}
                  </button>
                  <button disabled={blocked} onClick={() => void start(phase.action, run.current!)}>
                    {tr('assistant.tryAgain')}
                  </button>
                  <button onClick={copy}>{tr('assistant.copy')}</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {settings && ready && (
        <footer className="assistant-foot mono-label">
          {providerName} · {settings.model}
          {usage && (usage.input !== null || usage.output !== null) && (
            <> · {tr('assistant.tokens', { input: (usage.input ?? 0).toLocaleString(tr.lang === 'es' ? 'es-AR' : 'en-US'), output: (usage.output ?? 0).toLocaleString(tr.lang === 'es' ? 'es-AR' : 'en-US') })}</>
          )}
        </footer>
      )}
    </aside>
  );
}

/** Los avisos de la vista previa (6.4): links sacados y un largo muy distinto en *Fix* o *Improve*. */
function warningsOf(run: Run, parsed: Parsed, tr: Translate): string[] {
  const out: string[] = [];
  if (parsed.linksRemoved) out.push(tr('assistant.linksRemoved'));
  if (run.action === 'fix' || run.action === 'improve') {
    const before = run.snapshot.selected.plain.length;
    const after = plainNew(parsed.blocks).length;
    if (before > 0 && after > before * 3) out.push(tr('assistant.muchLonger'));
    else if (before > 0 && after * 3 < before) out.push(tr('assistant.muchShorter'));
  }
  return out;
}

