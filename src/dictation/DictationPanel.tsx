import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useT } from '../i18n';
import '../i18n/lazy/assistant';
import { usePermissions, useServices, useSyncStatus } from '../services';
import { builtinTexts } from '../templates/builtin';
import { CloseIcon, SettingsIcon } from '../ui/icons';
import { IS_MAC, modPressed } from '../ui/findUi';
import { shortcutLabel } from '../ui/shortcuts';
import { errorText } from '../assistant/errorText';
import { openAssistantSettings, useAssistantTarget, useAssistantUi } from '../assistant/assistantUi';
import { loadSettings, readKey, type AssistantSettings } from '../assistant/keyStore';
import { fetchPolicy, policyAllows, type AssistantPolicy } from '../assistant/policy';
import { complete, isLocalProvider, PROVIDER_NAMES, type Usage } from '../assistant/providers';
import '../assistant/assistant.css';
import { shotTemplate, validateAnswer, type AskOption, type Change, type Plan } from './answer';
import { addToSummary, applyChanges, undoApplied, type UndoHandle } from './applyPlan';
import { closeDictation } from './dictationUi';
import { loadDraft, saveDraft, type PendingItem } from './drafts';
import { buildPageMap, type PageMap } from './pageMap';
import { buildPlaceRequest, type RecentChange } from './prompt';
import './dictation.css';

// La hoja *Dictate to report* (Docs/Doc_Dictado.md, entrega V1, secciones 5 a 8): se escribe la nota (o se dicta con el
// micrófono del teclado del sistema), *Place* la manda con el mapa de la página al proveedor de la persona, la respuesta
// se valida y se muestra cambio por cambio con su casilla, y *Apply* aplica lo tildado en un paso de deshacer, con la
// guarda. Lo que no se ubicó y lo destildado quedan en *Couldn't place*, guardados en el dispositivo hasta que la persona
// los resuelve. La vista previa se dibuja con texto, nunca como HTML: nada que el navegador vaya a buscar afuera.

type Phase =
  | { kind: 'compose'; note?: string }
  | { kind: 'running' }
  | { kind: 'ask'; question: string; options: AskOption[] }
  | { kind: 'preview'; plan: Plan }
  /** Recién aplicado: *Undo* mientras sea lo último que se hizo en la página. */
  | { kind: 'applied'; count: number; undo: UndoHandle | null; note: string; added: string[]; at: number; message?: string }
  | { kind: 'error'; message: string; retry: boolean };

interface Run {
  note: string;
  map: PageMap;
  answered?: { question: string; answer: string };
}

/** Lo aplicado en cada página en esta sesión (para las correcciones: «no, era un 35»), con la hora. */
const recentByPage = new Map<string, (RecentChange & { at: number })[]>();
const RECENT_MS = 10 * 60 * 1000;

/** Lo que dura el resguardo contra el doble toque después de *Apply* (N1 de la re-verificación de V1). */
export const DOUBLE_TAP_MS = 600;

function recentOf(pageId: string): RecentChange[] {
  const now = Date.now();
  const list = (recentByPage.get(pageId) ?? []).filter((r) => now - r.at < RECENT_MS);
  recentByPage.set(pageId, list);
  return list.map(({ where, before, after }) => ({ where, before, after }));
}

/** Para las pruebas: olvida lo aplicado. */
export function forgetRecent(): void {
  recentByPage.clear();
}

interface Box {
  id: number;
  top: number;
  left: number;
  width: number;
  height: number;
}

/** El elemento de la página donde está el lugar de un cambio (la celda entera, o el bloque). */
function elementOf(view: { domAtPos: (pos: number) => { node: Node } } | null, c: Change): HTMLElement | null {
  const t = c.target;
  if (!view || !t) return null;
  try {
    const { node } = view.domAtPos(t.start);
    const el = (node.nodeType === 1 ? node : node.parentElement) as HTMLElement | null;
    return (el?.closest(t.kind === 'cell' ? 'td, th' : '.bn-block-content') as HTMLElement | null) ?? el;
  } catch {
    return null;
  }
}

/**
 * Los recuadros de los lugares de la vista previa sobre la página (no tocan el documento: van encima, sin recibir
 * toques). Se vuelven a medir al desplazar y al cambiar el tamaño de la ventana. Una celda vacía también se ve.
 */
function useMarks(view: { domAtPos: (pos: number) => { node: Node } } | null, changes: Change[]): Box[] {
  const [boxes, setBoxes] = useState<Box[]>([]);
  useEffect(() => {
    if (!view || changes.length === 0) {
      setBoxes([]);
      return;
    }
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const out: Box[] = [];
        for (const c of changes) {
          const r = elementOf(view, c)?.getBoundingClientRect();
          if (r && r.width > 0) out.push({ id: c.id, top: r.top, left: r.left, width: r.width, height: r.height });
        }
        setBoxes(out);
      });
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [view, changes]);
  return boxes;
}

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).toString();

export function DictationPanel({ pageId }: { pageId: string }) {
  const { user, workspace, client, tree } = useServices();
  const status = useSyncStatus();
  const perms = usePermissions();
  const target = useAssistantTarget(pageId);
  const { settings: settingsOpen } = useAssistantUi();
  const tr = useT();
  const workspaceKey = workspace.config.localKey || workspace.config.url;
  const [settings, setSettings] = useState<AssistantSettings | null | undefined>(undefined);
  const [policy, setPolicy] = useState<AssistantPolicy | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'compose' });
  const [text, setText] = useState('');
  const [pending, setPending] = useState<PendingItem[]>([]);
  // La última nota aplicada (B1): a la vista hasta *Done* o *New note*. El ref la lleva a lo que se guarda.
  const [applied, setAppliedState] = useState('');
  const appliedRef = useRef('');
  const setApplied = (value: string) => {
    appliedRef.current = value;
    setAppliedState(value);
  };
  const [loaded, setLoaded] = useState(false);
  const [unchecked, setUnchecked] = useState<Set<number>>(new Set());
  const [usage, setUsage] = useState<Usage | null>(null);
  const [confirm, setConfirm] = useState<'discardNote' | 'done' | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const run = useRef<Run | null>(null);
  /** Cuándo se aplicó (N1): los botones que aparecen en el lugar de *Apply* no toman el segundo toque de un doble toque. */
  const appliedAt = useRef(0);
  const tooSoon = () => Date.now() - appliedAt.current < DOUBLE_TAP_MS;
  const abort = useRef<AbortController | null>(null);
  const root = useRef<HTMLElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  // Los ajustes del asistente (proveedor, clave, modelo): otra vez al cerrar la ventana de ajustes.
  useEffect(() => {
    if (settingsOpen) return;
    let live = true;
    void loadSettings(user.email)
      .then((s) => live && setSettings(s))
      .catch(() => live && setSettings(null));
    return () => {
      live = false;
    };
  }, [user.email, settingsOpen]);

  // La política del workspace cubre también el dictado (DI9): se mira al abrir y otra vez al mandar.
  useEffect(() => {
    if (settingsOpen) return;
    let live = true;
    void fetchPolicy(client, workspaceKey).then((p) => live && setPolicy(p));
    return () => {
      live = false;
    };
  }, [client, workspaceKey, settingsOpen]);

  // El borrador guardado en el dispositivo: la nota y lo que quedó sin ubicar.
  useEffect(() => {
    let live = true;
    void loadDraft(user.email, workspaceKey, pageId)
      .then((d) => {
        if (!live) return;
        if (d) {
          setText((t) => t || d.text);
          setPending(d.pending);
          appliedRef.current = d.applied ?? '';
          setAppliedState(d.applied ?? '');
        }
        setLoaded(true);
      })
      .catch(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, [user.email, workspaceKey, pageId]);

  // Se guarda mientras se escribe (cerrar la hoja o la app no la pierde).
  const persist = useCallback(
    (nextText: string, nextPending: PendingItem[]) => {
      void saveDraft(user.email, workspaceKey, pageId, nextText, nextPending, appliedRef.current).catch((err) => console.error('Dictado: no se pudo guardar la nota en el dispositivo', err));
    },
    [user.email, workspaceKey, pageId],
  );
  useEffect(() => {
    if (!loaded) return;
    const id = setTimeout(() => persist(text, pending), 250);
    return () => clearTimeout(id);
  }, [text, pending, applied, loaded, persist]);

  // Cerrar la hoja o cambiar de página corta el pedido.
  useEffect(() => () => abort.current?.abort(), []);

  const plan = phase.kind === 'preview' ? phase.plan : null;
  // Los lugares de la vista previa, marcados en la página (los destildados no).
  const marked = useMemo(() => (plan ? plan.changes.filter((c) => !unchecked.has(c.id) && c.target) : []), [plan, unchecked]);
  const boxes = useMarks(target?.view() ?? null, marked);

  // En el teléfono la hoja va anclada abajo: con el teclado abierto (iOS no achica la página), se sube por encima del
  // teclado y no pasa del alto que queda a la vista (como la de los comentarios).
  useEffect(() => {
    const vv = window.visualViewport;
    const el = root.current;
    if (!vv || !el) return;
    const update = () => {
      el.style.setProperty('--kb-inset', `${Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))}px`);
      el.style.setProperty('--vv-height', `${Math.round(vv.height)}px`);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  const canEdit = perms.canEditPage(pageId) && (target?.editable() ?? false);
  const config = settings ? { provider: settings.provider, baseUrl: settings.baseUrl, model: settings.model } : null;
  const ready = !!settings && (settings.hasKey || settings.provider === 'compatible') && !!settings.model;
  const local = config ? isLocalProvider(config) : false;
  const allowed = policy === null || !config ? true : policyAllows(policy, config);
  const offline = !status.online && !local;
  const providerName = settings ? PROVIDER_NAMES[settings.provider] : '';
  const blocked = !ready || !allowed || offline;

  const words = useMemo(
    () => ({
      row: (n: number) => tr('dictation.row', { n }),
      newRow: (slate: string) => tr('dictation.newRow', { slate }),
      addRow: (after: string) => tr('dictation.addRow', { after }),
      newSection: (title: string) => tr('dictation.newSection', { title }),
    }),
    [tr],
  );

  /** La plantilla de fábrica de la sección de un plano, en el idioma de la página. */
  const builtinShot = (lang: 'en' | 'es') => {
    const t = builtinTexts(lang).onset;
    return { word: t.shot.trim(), checks: t.shotChecks };
  };

  /** Manda la nota con una foto nueva de la página (también después de *ask* y en *Try again*). */
  const place = async (note: string, answered?: Run['answered']) => {
    if (!settings || !config || phase.kind === 'running') return;
    if (!note.trim()) return;
    const view = target?.view();
    if (!view) return;
    // La política se mira otra vez al mandar (el dueño la pudo cambiar).
    const now = await fetchPolicy(client, workspaceKey);
    setPolicy(now);
    if (!policyAllows(now, config)) return;
    const map = buildPageMap(view.state, tree.get(pageId)?.title ?? '', { fallbackLang: tr.lang === 'es' ? 'es' : 'en' });
    if (typeof map === 'string') {
      setPhase({ kind: 'error', message: tr(map === 'empty' ? 'dictation.pageEmpty' : 'dictation.pageTooLong'), retry: false });
      return;
    }
    run.current = { note, map, answered };
    const controller = new AbortController();
    abort.current?.abort();
    abort.current = controller;
    setUsage(null);
    setFocused(null);
    setPhase({ kind: 'running' });
    const request = buildPlaceRequest(map, note, { recent: recentOf(pageId), answered });
    try {
      // La clave se descifra recién acá y queda solo en esta llamada.
      const answer = await complete(config, await readKey(user.email, config), request, { signal: controller.signal });
      if (abort.current !== controller) return;
      setUsage(answer.usage);
      const result = answer.cut ? 'unreadable' : validateAnswer(answer.text, map, { note, words }, builtinShot(map.lang));
      if (result === 'unreadable') {
        setPhase({ kind: 'error', message: tr('dictation.unreadable'), retry: true });
        return;
      }
      if (result.ask && result.ask.options.length > 0) {
        setPhase({ kind: 'ask', question: result.ask.question || tr('dictation.whichShot'), options: result.ask.options });
        return;
      }
      setUnchecked(new Set());
      setPhase({ kind: 'preview', plan: result });
    } catch (err) {
      if (abort.current !== controller) return;
      setPhase({ kind: 'error', message: errorText(err, providerName, tr), retry: true });
    }
  };

  const stop = () => {
    abort.current?.abort();
    abort.current = null;
    setPhase({ kind: 'compose', note: tr('assistant.stopped') });
  };

  const backToNote = () => {
    abort.current?.abort();
    abort.current = null;
    setFocused(null);
    setPhase({ kind: 'compose' });
    requestAnimationFrame(() => field.current?.focus({ preventScroll: true }));
  };

  const removePending = (id: string) => setPending((list) => list.filter((p) => p.id !== id));

  const apply = () => {
    if (phase.kind !== 'preview' || !run.current) return;
    const current = run.current;
    const view = target?.view() ?? null;
    const editor = target?.editor?.() ?? null;
    // El permiso se mira otra vez al aplicar (pudo cambiar mientras se veía la vista previa).
    const writable = perms.canEditPage(pageId) && (target?.editable() ?? false);
    if (!view) return;
    const chosen = phase.plan.changes.filter((c) => !unchecked.has(c.id));
    const left = phase.plan.changes.filter((c) => unchecked.has(c.id));
    if (chosen.length === 0) return;
    const res = applyChanges(view, editor, current.map, chosen, writable, shotTemplate(current.map, builtinShot(current.map.lang)));
    if (!res.ok) {
      setPhase({
        kind: 'error',
        message: tr(res.reason === 'changed' ? 'dictation.changed' : res.reason === 'readOnly' ? 'dictation.readOnly' : 'assistant.failed'),
        retry: res.reason !== 'readOnly',
      });
      return;
    }
    // Lo destildado y lo que no se ubicó no se pierde: va a *Couldn't place* (C1).
    const added = [...phase.plan.unplaced, ...left.map((c) => c.text)].filter((t) => t.trim()).map((t) => ({ id: newId(), text: t }));
    const nextPending = [...pending, ...added];
    setPending(nextPending);
    // La nota original NO se borra al aplicar (B1 de la auditoría): si el modelo se salteó una parte sin decirlo, la
    // persona todavía la tiene. Se vacía solo con *New note* o *Done*.
    setText('');
    setApplied(current.note);
    persist('', nextPending);
    const at = Date.now();
    const list = recentByPage.get(pageId) ?? [];
    for (const c of chosen) list.push({ where: c.where.join(' › '), before: c.before, after: c.after, at });
    recentByPage.set(pageId, list);
    run.current = null;
    setFocused(null);
    appliedAt.current = Date.now();
    setPhase({ kind: 'applied', count: res.changed, undo: res.undo, note: current.note, added: added.map((a) => a.id), at });
  };

  const undo = () => {
    if (phase.kind !== 'applied' || tooSoon()) return;
    if (!undoApplied(target?.view() ?? null, phase.undo)) {
      setPhase({ ...phase, message: tr('dictation.undoLater', { undo: shortcutLabel('undo') }) });
      return;
    }
    // Deshecho: la nota vuelve al campo y lo que había agregado a *Couldn't place* sale (no se pierde nada).
    const nextPending = pending.filter((p) => !phase.added.includes(p.id));
    const nextText = text.trim() ? `${phase.note}\n${text}` : phase.note;
    setApplied('');
    // Lo deshecho ya no es una corrección posible: sale de lo reciente.
    recentByPage.set(pageId, (recentByPage.get(pageId) ?? []).filter((r) => r.at !== phase.at));
    setPending(nextPending);
    setText(nextText);
    persist(nextText, nextPending);
    setPhase({ kind: 'compose', note: tr('dictation.undone') });
  };

  /** *Add to Summary* de un pedazo sin ubicar: como párrafo al final de *Summary* (o de la página). */
  const addPending = (item: PendingItem) => {
    const view = target?.view() ?? null;
    const editor = target?.editor?.() ?? null;
    const writable = perms.canEditPage(pageId) && (target?.editable() ?? false);
    const map = view ? buildPageMap(view.state, '') : null;
    const summaryId = map && typeof map !== 'string' ? (map.summary?.blockId ?? null) : null;
    if (!addToSummary(view, editor, summaryId, item.text, writable)) {
      setPhase({ kind: 'compose', note: tr('dictation.addFailed') });
      return;
    }
    removePending(item.id);
  };

  const copy = (value: string) => {
    if (value) void navigator.clipboard?.writeText(value).catch(() => undefined);
  };

  const previewText = (p: Plan) =>
    [
      ...p.changes.filter((c) => !unchecked.has(c.id)).map((c) => `${c.where.join(' › ')}: ${c.after}`),
      ...p.unplaced,
    ].join('\n');

  /** *New note*: la nota ya aplicada se vacía (lo que no se ubicó sigue en *Couldn't place*). */
  const newNote = () => {
    if (tooSoon()) return;
    setApplied('');
    persist(text, pending);
    backToNote();
  };

  const done = () => {
    if (phase.kind === 'applied' && tooSoon()) return;
    if (pending.length > 0) {
      setConfirm('done');
      return;
    }
    // *Done*: la nota aplicada se vacía (la persona ya la revisó).
    setApplied('');
    persist(text, []);
    closeDictation();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (confirm) setConfirm(null);
      else if (phase.kind === 'running') stop();
      else if (phase.kind === 'compose' || phase.kind === 'applied') closeDictation();
      else backToNote();
      return;
    }
    if (e.key === 'Enter' && modPressed(e, IS_MAC)) {
      if (phase.kind === 'compose' && !blocked && text.trim()) {
        e.preventDefault();
        void place(text);
      } else if (phase.kind === 'preview' && canEdit) {
        e.preventDefault();
        apply();
      }
    }
  };

  // Al abrir (cuando el campo aparece: los ajustes y el borrador se leen primero), el foco va a la nota. En el teléfono
  // abre el teclado, con su micrófono.
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (focusedOnce.current || !ready || !loaded || phase.kind !== 'compose') return;
    focusedOnce.current = true;
    field.current?.focus({ preventScroll: true });
  }, [ready, loaded, phase.kind]);
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) root.current?.focus({ preventScroll: true });
  }, [phase.kind]);

  /** Lleva la página al lugar de un cambio y lo resalta. */
  const show = (c: Change) => {
    setFocused(c.id);
    const el = elementOf(target?.view() ?? null, c);
    if (!el) return;
    try {
      const phone = typeof matchMedia === 'function' && matchMedia('(max-width: 760px)').matches;
      el.scrollIntoView?.({ block: phone ? 'start' : 'center', behavior: 'smooth' });
    } catch {
      // Sin DOM para ese lugar: queda el resaltado.
    }
  };

  // Con la vista previa, la página va al primer cambio (la fila resaltada queda a la vista, detrás de la hoja).
  useEffect(() => {
    const first = plan?.changes.find((c) => c.target);
    if (first) show(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  const notice = !allowed
    ? tr(policy === 'off' ? 'dictation.policyOff' : 'dictation.policyLocal')
    : offline
      ? tr('dictation.offline')
      : null;

  const pendingBox = pending.length > 0 && (
    <section className="dictation-pending" aria-label={tr('dictation.couldntPlace')}>
      <p className="mono-label">{tr('dictation.couldntPlace')}</p>
      <ul>
        {pending.map((p) => (
          <li key={p.id}>
            <span className="dictation-pending-text">“{p.text}”</span>
            <span className="dictation-pending-actions">
              <button disabled={!canEdit} onClick={() => addPending(p)}>
                {tr('dictation.addToSummary')}
              </button>
              <button onClick={() => copy(p.text)}>{tr('assistant.copy')}</button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );

  const confirmBox =
    confirm === 'done' ? (
      <div className="dictation-confirm" role="alertdialog" aria-label={tr('dictation.discardPending', { count: pending.length })}>
        <p>{tr('dictation.discardPending', { count: pending.length })}</p>
        <div className="assistant-buttons">
          <button
            className="danger"
            onClick={() => {
              setPending([]);
              // *Done* también vacía la nota aplicada (ya se revisó); la que se está escribiendo queda.
              setApplied('');
              persist(text, []);
              setConfirm(null);
              closeDictation();
            }}
          >
            {tr('assistant.discard')}
          </button>
          <button onClick={() => setConfirm(null)}>{tr('dictation.keep')}</button>
        </div>
      </div>
    ) : confirm === 'discardNote' ? (
      <div className="dictation-confirm" role="alertdialog" aria-label={tr('dictation.discardNote')}>
        <p>{tr('dictation.discardNote')}</p>
        <div className="assistant-buttons">
          <button
            className="danger"
            onClick={() => {
              setText('');
              persist('', pending);
              setConfirm(null);
              field.current?.focus();
            }}
          >
            {tr('assistant.discard')}
          </button>
          <button onClick={() => setConfirm(null)}>{tr('dictation.keep')}</button>
        </div>
      </div>
    ) : null;

  /** La última nota aplicada, tal como se escribió (B1): para revisar que no haya quedado nada afuera. */
  const keptBox = applied ? (
    <div className="dictation-kept">
      <p className="dictation-heard dictation-note">
        <span className="mono-label">{tr('dictation.yourNote')}</span> “{applied}”
      </p>
      <p className="muted assistant-small">{tr('dictation.noteKept')}</p>
      <div className="assistant-buttons">
        <button onClick={() => copy(applied)}>{tr('assistant.copy')}</button>
      </div>
    </div>
  ) : null;

  const changeRow = (c: Change) => {
    const off = unchecked.has(c.id);
    return (
      <li key={c.id} className={`dictation-change${off ? ' off' : ''}${focused === c.id ? ' focused' : ''}`}>
        <input
          type="checkbox"
          checked={!off}
          aria-label={c.where.join(' › ')}
          onChange={() =>
            setUnchecked((s) => {
              const next = new Set(s);
              if (next.has(c.id)) next.delete(c.id);
              else next.add(c.id);
              return next;
            })
          }
        />
        <div className="dictation-change-body">
          <button type="button" className="dictation-where" onClick={() => show(c)}>
            {c.where.join(' › ')}
          </button>
          <p className="dictation-diff">
            {c.op === 'addRow' || c.op === 'addShotSection' || c.op === 'appendText' ? (
              <ins>{c.after}</ins>
            ) : (
              <>
                {/* Tachado solo si saca algo; si solo agrega (o tilda), lo de antes queda como estaba. */}
                {!c.before.trim() ? <span className="dictation-empty">—</span> : c.replaces || c.op === 'uncheck' ? <del>{c.before}</del> : <span className="dictation-before">{c.before}</span>}
                <span className="dictation-arrow" aria-hidden="true">
                  {' → '}
                </span>
                <ins>{c.after || '—'}</ins>
              </>
            )}
          </p>
          {c.replaces && <p className="assistant-warning dictation-flag">{tr('dictation.replaces', { text: c.replaces })}</p>}
          {c.chosen && <p className="assistant-warning dictation-flag">{tr('dictation.chosen')}</p>}
          {c.why && <p className="muted dictation-why">{c.why}</p>}
        </div>
      </li>
    );
  };

  return (
    <aside ref={root} className="assistant-panel dictation-panel" role="complementary" aria-label={tr('dictation.title')} tabIndex={-1} onKeyDown={onKeyDown}>
      <header className="assistant-head">
        <h2>{tr('dictation.title')}</h2>
        <button className="icon-button" aria-label={tr('assistant.settings')} data-tip={tr('assistant.settings')} onClick={openAssistantSettings}>
          <SettingsIcon size={18} />
        </button>
        <button className="icon-button" aria-label={tr('dictation.close')} onClick={closeDictation}>
          <CloseIcon size={18} />
        </button>
      </header>
      {boxes.map((b) => (
        <div key={b.id} className={`dictation-mark${focused === b.id ? ' focused' : ''}`} style={{ top: b.top, left: b.left, width: b.width, height: b.height }} aria-hidden="true" />
      ))}
      <div className="assistant-body">
        {settings === undefined ? null : !ready ? (
          <div className="assistant-setup">
            <p>{tr('dictation.setupText')}</p>
            <button className="primary" onClick={openAssistantSettings}>
              {tr('assistant.setup')}
            </button>
            {pendingBox}
          </div>
        ) : (
          <>
            {notice && (
              <p className="assistant-notice" role="status">
                {notice}
              </p>
            )}
            {!canEdit && (perms.known || target?.editable() === false) && <p className="assistant-notice">{tr('dictation.readOnlyNotice')}</p>}
            {phase.kind === 'compose' && (
              <div className="dictation-compose">
                <textarea
                  ref={field}
                  className="dictation-field"
                  value={text}
                  rows={4}
                  maxLength={2000}
                  placeholder={tr('dictation.placeholder')}
                  aria-label={tr('dictation.note')}
                  onChange={(e) => setText(e.target.value)}
                />
                <div className="assistant-buttons">
                  <button className="primary dictation-big" disabled={blocked || !text.trim()} data-tip={shortcutLabel('dictationPlace')} onClick={() => void place(text)}>
                    {tr('dictation.place')}
                  </button>
                  {offline && text.trim() && (
                    <button className="dictation-big" onClick={() => closeDictation()}>
                      {tr('dictation.saveForLater')}
                    </button>
                  )}
                  {text.trim() && (
                    <button className="link" onClick={() => setConfirm('discardNote')}>
                      {tr('assistant.discard')}
                    </button>
                  )}
                </div>
                <p className="muted assistant-hint" role="status">
                  {phase.note ?? tr('dictation.hint')}
                </p>
                {keptBox}
                {confirmBox}
                {pendingBox}
                {(pending.length > 0 || !!applied) && (
                  <div className="assistant-buttons">
                    <button onClick={done}>{tr('dictation.done')}</button>
                  </div>
                )}
              </div>
            )}
            {phase.kind === 'running' && (
              <div className="assistant-result">
                <p className="mono-label" role="status">
                  {tr('dictation.placing')}
                </p>
                <div className="assistant-stream">{run.current?.note}</div>
                <div className="assistant-buttons">
                  <button onClick={stop}>{tr('assistant.stop')}</button>
                </div>
              </div>
            )}
            {phase.kind === 'ask' && (
              <div className="assistant-result">
                <p className="dictation-question">{phase.question}</p>
                <div className="dictation-options">
                  {phase.options.map((o) => (
                    <button key={o.answer} className="dictation-big" disabled={blocked} onClick={() => void place(run.current?.note ?? text, { question: phase.question, answer: o.answer })}>
                      {o.label}
                    </button>
                  ))}
                </div>
                <div className="assistant-buttons">
                  <button className="link" onClick={backToNote}>
                    {tr('assistant.back')}
                  </button>
                </div>
              </div>
            )}
            {phase.kind === 'error' && (
              <div className="assistant-result">
                <p className="assistant-error" role="alert">
                  {phase.message}
                </p>
                <div className="assistant-buttons">
                  {phase.retry && run.current && (
                    <button className="primary" disabled={blocked} onClick={() => void place(run.current!.note, run.current!.answered)}>
                      {tr('assistant.tryAgain')}
                    </button>
                  )}
                  <button className="link" onClick={backToNote}>
                    {tr('assistant.back')}
                  </button>
                </div>
              </div>
            )}
            {phase.kind === 'preview' && run.current && (
              <div className="assistant-result">
                {/* La nota tal como la escribió o dictó la persona: si el modelo se salteó algo, se nota acá. */}
                <p className="dictation-heard dictation-note">
                  <span className="mono-label">{tr('dictation.yourNote')}</span> “{run.current.note}”
                </p>
                {phase.plan.heard && (
                  <p className="dictation-heard">
                    <span className="mono-label">{tr('dictation.heard')}</span> “{phase.plan.heard}”
                  </p>
                )}
                {phase.plan.changes.length > 0 ? (
                  <ul className="dictation-changes" aria-label={tr('assistant.preview')}>
                    {phase.plan.changes.map(changeRow)}
                  </ul>
                ) : (
                  <p className="assistant-notice">{tr('dictation.nothing')}</p>
                )}
                {run.current.map.trimmed && <p className="assistant-warning">{tr('dictation.trimmed')}</p>}
                {phase.plan.linksRemoved && <p className="assistant-warning">{tr('assistant.linksRemoved')}</p>}
                {phase.plan.unplaced.length > 0 && (
                  <section className="dictation-pending">
                    <p className="mono-label">{tr('dictation.couldntPlace')}</p>
                    <ul>
                      {phase.plan.unplaced.map((u, i) => (
                        <li key={i}>
                          <span className="dictation-pending-text">“{u}”</span>
                        </li>
                      ))}
                    </ul>
                    <p className="muted assistant-small">{tr('dictation.unplacedHint')}</p>
                  </section>
                )}
                <div className="assistant-buttons">
                  <button
                    className="primary dictation-big"
                    disabled={!canEdit || phase.plan.changes.every((c) => unchecked.has(c.id))}
                    data-tip={shortcutLabel('assistantApply')}
                    onClick={apply}
                  >
                    {tr('assistant.apply')}
                  </button>
                  <button onClick={backToNote} data-tip={shortcutLabel('menusClose')}>
                    {tr('assistant.discard')}
                  </button>
                  <button disabled={blocked} onClick={() => void place(run.current!.note, run.current!.answered)}>
                    {tr('assistant.tryAgain')}
                  </button>
                  <button onClick={() => copy(previewText(phase.plan))}>{tr('assistant.copy')}</button>
                </div>
              </div>
            )}
            {phase.kind === 'applied' && (
              <div className="assistant-result">
                <p className="assistant-ok" role="status">
                  {tr('dictation.applied', { count: phase.count })}
                </p>
                {phase.message && <p className="assistant-notice">{phase.message}</p>}
                {keptBox}
                <div className="assistant-buttons">
                  {/* *Done* primero y *Undo* al final, lejos de donde estaba *Apply* (N1). */}
                  <button className="primary dictation-big" onClick={done}>
                    {tr('dictation.done')}
                  </button>
                  <button onClick={newNote}>{tr('dictation.another')}</button>
                  <button className="dictation-big" onClick={undo}>
                    {tr('dictation.undo')}
                  </button>
                </div>
                {confirmBox}
                {pendingBox}
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

