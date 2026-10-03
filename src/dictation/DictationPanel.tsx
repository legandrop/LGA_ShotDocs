import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useT } from '../i18n';
import '../i18n/lazy/assistant';
import { usePermissions, useServices, useSyncStatus } from '../services';
import { builtinTexts } from '../templates/builtin';
import { CloseIcon, MicIcon, SettingsIcon } from '../ui/icons';
import { IS_MAC, modPressed } from '../ui/findUi';
import { shortcutLabel } from '../ui/shortcuts';
import { errorText } from '../assistant/errorText';
import { isKeyRejected, SyncedKeyHint } from '../assistant/SyncedKeyHint';
import { openAssistantSettings, useAssistantTarget, useAssistantUi } from '../assistant/assistantUi';
import { loadSettings, readKey, type AssistantSettings } from '../assistant/keyStore';
import { fetchPolicy, policyAllows, type AssistantPolicy } from '../assistant/policy';
import { complete, isLocalProvider, PROVIDER_NAMES, type Usage } from '../assistant/providers';
import '../assistant/assistant.css';
import { shotTemplate, validateAnswer, type AskOption, type Change, type Plan } from './answer';
import { addToSummary, applyChanges, undoApplied, type UndoHandle } from './applyPlan';
import { closeDictation, takeQueuedRequest, useQueuedRequest } from './dictationUi';
import { loadDraft, saveDraft, type PendingItem } from './drafts';
import { addNote, getNote, removeNote, restoreNote, updateNote, useQueuedNotes, type QueuedNote } from './queue';
import { noteSnippet, noteTime } from './VoiceNotes';
import '../i18n/lazy/dictation';
import { insertAtCursor, refreshSpot, spotOf, type CursorSpot } from './caretInsert';
import { canRecord, NoteRecorder, WARN_MS, MAX_MS, type RecorderError, type RecorderState, type RecordingResult } from './recorder';
import { voiceHints } from './transcribe';
import { failureText, queueRecordingStore, transcribeNote } from './voiceQueue';
import { resolveVoice, type VoiceConfig } from './voiceSettings';
import { VoiceSettingsDialog } from './VoiceSettingsDialog';
import { buildPageMap, type PageMap } from './pageMap';
import { buildPlaceRequest } from './prompt';
import { loadActiveShot, saveActiveShot, sameShot, shotOfApplied, shotsOnPage } from './activeShot';
import { recentForRequest, type AppliedEntry } from './corrections';
import { applyShotPages, proposeShotPages, undoShotPages, type ShotPageChange, type ShotPageDeps, type ShotPageNote } from './shotPage';
import { takeDictateLink, useDictateLink } from './dictateLink';
import { useCommentAccess } from '../ui/CommentsToggle';
import { useLinkMode } from '../linkMode';
import './dictation.css';

// La hoja *Dictate to report* (Docs/Doc_Dictado.md, entrega V1, secciones 5 a 8): se escribe la nota (o se dicta con el
// micrófono del teclado del sistema), *Place* la manda con el mapa de la página al proveedor de la persona, la respuesta
// se valida y se muestra cambio por cambio con su casilla, y *Apply* aplica lo tildado en un paso de deshacer, con la
// guarda. Lo que no se ubicó y lo destildado quedan en *Couldn't place*, guardados en el dispositivo hasta que la persona
// los resuelve. La vista previa se dibuja con texto, nunca como HTML: nada que el navegador vaya a buscar afuera.

type Phase =
  | { kind: 'compose'; note?: string }
  | { kind: 'running' }
  /** La grabación se está pasando a texto (V3). */
  | { kind: 'transcribing' }
  | { kind: 'ask'; question: string; options: AskOption[] }
  /** `extra`: lo que se propone además en las páginas de los planos (V4), destildado; `extraNotes`, lo que no. */
  | { kind: 'preview'; plan: Plan; extra: ShotPageChange[]; extraNotes: ShotPageNote[] }
  /**
   * Recién aplicado: *Undo* mientras sea lo último que se hizo en la página. `queued`: la nota venía de la cola (V2).
   * `commented`: se agregó como comentario (V4, quien solo comenta). `extra`: lo escrito en las páginas de los planos.
   */
  | {
      kind: 'applied';
      count: number;
      undo: UndoHandle | null;
      note: string;
      added: string[];
      at: number;
      message?: string;
      queued?: QueuedNote;
      commented?: boolean;
      extra?: ShotPageChange[];
    }
  | { kind: 'error'; message: string; retry: boolean; keyRejected?: boolean };

interface Run {
  note: string;
  map: PageMap;
  answered?: { question: string; answer: string };
  /** La nota viene de la cola (V2): al aplicar pasa al borrador de la página y sale de la cola. */
  queued?: QueuedNote;
}

/** Lo aplicado en cada página en esta sesión (para las correcciones: «no, era un 35»), con la hora y el lugar. */
const recentByPage = new Map<string, AppliedEntry[]>();
const RECENT_MS = 10 * 60 * 1000;

/** Lo que dura el resguardo contra el doble toque después de *Apply* (N1 de la re-verificación de V1). */
export const DOUBLE_TAP_MS = 600;

function recentOf(pageId: string): AppliedEntry[] {
  const now = Date.now();
  const list = (recentByPage.get(pageId) ?? []).filter((r) => now - r.at < RECENT_MS);
  recentByPage.set(pageId, list);
  return list;
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

/** `m:ss`. */
const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).toString();

export function DictationPanel({ pageId }: { pageId: string }) {
  const { user, workspace, client, tree, docs, comments } = useServices();
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
  /** Lo propuesto en las páginas de los planos que la persona tildó (destildado de fábrica, DI8). */
  const [extraOn, setExtraOn] = useState<Set<number>>(new Set());
  // Quien solo comenta (V4); un visitante de un link público no dicta (la tabla de la sección 7).
  const access = useCommentAccess(pageId);
  const linkMode = useLinkMode();
  const commentAccess = { canComment: access.canComment && !linkMode };
  // El plano activo (V4): fijo entre notas hasta cambiarlo; se pone solo con el plano de lo último aplicado.
  const [activeShot, setActiveShotState] = useState<string | null>(() => loadActiveShot(user.email, workspaceKey, pageId));
  const setActiveShot = (shot: string | null) => {
    setActiveShotState(shot);
    saveActiveShot(user.email, workspaceKey, pageId, shot);
  };
  const [shotOptions, setShotOptions] = useState<string[]>([]);
  /** Lo que se escribe en las páginas de los planos después de *Apply* (*Undo* lo espera). */
  const extraWork = useRef<Promise<ShotPageChange[]>>(Promise.resolve([]));
  const [usage, setUsage] = useState<Usage | null>(null);
  const [confirm, setConfirm] = useState<'discardNote' | 'done' | 'discardQueued' | null>(null);
  // La nota de la cola que se está ubicando (V2): se muestra en lugar del campo, y el campo conserva lo suyo.
  const [queued, setQueued] = useState<QueuedNote | null>(null);
  const queueRequest = useQueuedRequest();
  const savedNotes = useQueuedNotes(user.email, workspaceKey).filter((n) => n.pageId === pageId && n.id !== queued?.id);
  /**
   * Lo que se escribe en la cola, en orden: sacar una nota al aplicar y devolverla con *Undo* no se pueden cruzar (si
   * se cruzaran, *Undo* la devolvería y la escritura de *Apply* la sacaría después).
   */
  const queueWork = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = (op: () => Promise<unknown>) => {
    const next = queueWork.current.then(op);
    queueWork.current = next.catch((err) => console.error('Dictado: no se pudo cambiar la cola de notas', err));
    return next;
  };
  const [focused, setFocused] = useState<number | null>(null);
  const run = useRef<Run | null>(null);
  /**
   * Cuándo se tocó *Apply* (N1): los botones que aparecen en su lugar no toman el segundo toque de un doble toque. Solo
   * con un clic o un toque sobre *Apply*: aplicado con Ctrl/⌘+Enter no hay doble toque que frenar, y un *Undo* a
   * propósito enseguida tiene que andar.
   */
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

  // Una nota de la cola que se pidió ubicar en esta página (desde la lista del indicador de sincronización).
  useEffect(() => {
    const id = takeQueuedRequest(pageId);
    if (!id) return;
    void getNote(id).then((n) => {
      if (!n) return;
      abort.current?.abort();
      abort.current = null;
      setConfirm(null);
      setQueued(n);
      setPhase({ kind: 'compose' });
    });
  }, [pageId, queueRequest]);

  // --- El micrófono propio (V3) ---
  /** Con qué se transcribe (`null`: no hay cómo; `undefined`: leyendo). */
  const [voice, setVoice] = useState<VoiceConfig | null | undefined>(undefined);
  const [voiceSettings, setVoiceSettings] = useState(false);
  const [rec, setRec] = useState<{ state: RecorderState; error?: RecorderError; ms: number }>({ state: 'idle', ms: 0 });
  const recorder = useRef<NoteRecorder | null>(null);
  const levelBar = useRef<HTMLSpanElement>(null);
  /** El último campo donde se escribía fuera de la hoja (para *Insert at cursor*). */
  const spot = useRef<CursorSpot | null>(null);
  const editTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (settingsOpen || voiceSettings) return;
    let live = true;
    void resolveVoice(user.email)
      .then((v) => live && setVoice(v))
      .catch(() => live && setVoice(null));
    return () => {
      live = false;
    };
  }, [user.email, settingsOpen, voiceSettings]);

  // El foco fuera de la hoja: el último campo de texto (un comentario) o la página.
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      if (root.current?.contains(e.target as Node)) return;
      const s = spotOf(e.target);
      if (s) spot.current = s;
    };
    document.addEventListener('focusin', onFocus);
    return () => document.removeEventListener('focusin', onFocus);
  }, []);

  // Cerrar la hoja o cambiar de página mientras graba corta y guarda (la nota queda en la cola).
  useEffect(
    () => () => {
      void recorder.current?.stop('cut');
      recorder.current = null;
      if (editTimer.current) clearTimeout(editTimer.current);
    },
    [],
  );

  // Se guarda mientras se escribe (cerrar la hoja o la app no la pierde).
  /** Lo que el guardado demorado todavía no guardó (al cerrar la hoja se guarda ya: lo de los últimos 250 ms). */
  const pendingSave = useRef<(() => void) | null>(null);
  const persist = useCallback(
    (nextText: string, nextPending: PendingItem[]) => {
      pendingSave.current = null;
      void saveDraft(user.email, workspaceKey, pageId, nextText, nextPending, appliedRef.current).catch((err) => console.error('Dictado: no se pudo guardar la nota en el dispositivo', err));
    },
    [user.email, workspaceKey, pageId],
  );
  useEffect(() => {
    if (!loaded) return;
    const save = () => persist(text, pending);
    pendingSave.current = save;
    const id = setTimeout(save, 250);
    return () => clearTimeout(id);
  }, [text, pending, applied, loaded, persist]);
  useEffect(() => () => pendingSave.current?.(), []);

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
  // Para escribir en las páginas de los planos (V4): los permisos de ahora, cada vez que se piden.
  const permsRef = useRef(perms);
  permsRef.current = perms;
  const shotDeps = useMemo<ShotPageDeps>(() => ({ tree, docs, perms: () => permsRef.current }), [tree, docs]);
  /** El destino de un cambio en la página de un plano, en palabras (lo arma la app: el título de la página y la fila). */
  const extraWhere = (x: ShotPageChange) => [tr('dictation.shotPage'), x.pageTitle || x.shot, x.label];
  const config = settings ? { provider: settings.provider, baseUrl: settings.baseUrl, model: settings.model } : null;
  const ready = !!settings && (settings.hasKey || settings.provider === 'compatible') && !!settings.model;
  const local = config ? isLocalProvider(config) : false;
  const allowed = policy === null || !config ? true : policyAllows(policy, config);
  const offline = !status.online && !local;
  const providerName = settings ? PROVIDER_NAMES[settings.provider] : '';
  const blocked = !ready || !allowed || offline;
  const voiceLocal = voice ? voice.provider === 'compatible' && isLocalProvider({ provider: 'compatible', baseUrl: voice.baseUrl }) : false;
  const voiceAllowed = policy === null || !voice ? true : policyAllows(policy, voice);
  /** Se puede transcribir ahora (con red o un servidor local, y la política). */
  const canTranscribe = !!voice && voiceAllowed && (status.online || voiceLocal);
  const recording = rec.state === 'starting' || rec.state === 'recording' || rec.state === 'stopping';

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
  const place = async (note: string, answered?: Run['answered'], fromQueue?: QueuedNote) => {
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
    run.current = { note, map, answered, queued: fromQueue };
    const controller = new AbortController();
    abort.current?.abort();
    abort.current = controller;
    setUsage(null);
    setFocused(null);
    setPhase({ kind: 'running' });
    // Lo aplicado hace un rato, con la dirección que cada lugar tiene en este mapa (las correcciones encadenadas, V4).
    const { recent, addrs } = recentForRequest(recentOf(pageId), map, view.state);
    const shot = activeShot;
    const request = buildPlaceRequest(map, note, { recent, answered, activeShot: shot });
    try {
      // La clave se descifra recién acá y queda solo en esta llamada.
      const answer = await complete(config, await readKey(user.email, config), request, { signal: controller.signal });
      if (abort.current !== controller) return;
      setUsage(answer.usage);
      const result = answer.cut ? 'unreadable' : validateAnswer(answer.text, map, { note, words, activeShot: shot, recent: addrs }, builtinShot(map.lang));
      if (result === 'unreadable') {
        setPhase({ kind: 'error', message: tr('dictation.unreadable'), retry: true });
        return;
      }
      if (result.ask && result.ask.options.length > 0) {
        setPhase({ kind: 'ask', question: result.ask.question || tr('dictation.whichShot'), options: result.ask.options });
        return;
      }
      // La página *Shot Breakdown* de cada plano (V4): se lee recién acá, solo las que nombran un plano de los cambios.
      let extra: { changes: ShotPageChange[]; notes: ShotPageNote[] } = { changes: [], notes: [] };
      try {
        extra = await proposeShotPages(shotDeps, pageId, map, result.changes, 1000);
      } catch (err) {
        console.warn('Dictado: no se pudieron buscar las páginas de los planos', err);
      }
      if (abort.current !== controller) return;
      setUnchecked(new Set());
      setExtraOn(new Set());
      setPhase({ kind: 'preview', plan: result, extra: extra.changes, extraNotes: extra.notes });
    } catch (err) {
      if (abort.current !== controller) return;
      setPhase({ kind: 'error', message: errorText(err, providerName, tr), retry: true, keyRejected: isKeyRejected(err) });
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

  /** `tap`: con un clic o un toque sobre *Apply* (solo entonces corre el resguardo contra el doble toque, N1). */
  const apply = (tap = false) => {
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
    setApplied(current.note);
    if (current.queued) {
      // De la cola (V2): el campo conserva lo suyo. La nota pasa al borrador de la página (*Your note* y *Couldn't
      // place*) y recién cuando eso quedó guardado sale de la cola: si guardarlo falla, sigue en la cola.
      const from = current.queued;
      const keepText = text;
      void enqueue(async () => {
        await saveDraft(user.email, workspaceKey, pageId, keepText, nextPending, current.note);
        await removeNote(from.id);
      });
      setQueued(null);
    } else {
      setText('');
      persist('', nextPending);
    }
    const at = Date.now();
    const list = recentByPage.get(pageId) ?? [];
    // Con el lugar (la foto), para encontrarlo en la página de la próxima nota aunque se corra (V4).
    for (const c of chosen) list.push({ where: c.where.join(' › '), before: c.before, after: c.after, at, ...(c.target && (c.op === 'setCell' || c.op === 'setText' || c.op === 'check' || c.op === 'uncheck') ? { target: c.target } : {}) });
    recentByPage.set(pageId, list);
    // El plano activo pasa a ser el de lo aplicado (V4): las próximas notas sin plano van a ese.
    const shot = shotOfApplied(chosen, current.map);
    if (shot) setActiveShot(shot);
    run.current = null;
    setFocused(null);
    appliedAt.current = tap ? Date.now() : 0;
    // Lo tildado en las páginas de los planos, solo si su cambio del reporte también se aplicó. Se escribe después (otra
    // página, con su candado y su guarda): lo del reporte ya quedó.
    const chosenIds = new Set(chosen.map((c) => c.id));
    const extra = phase.extra.filter((x) => extraOn.has(x.id) && chosenIds.has(x.from));
    setPhase({ kind: 'applied', count: res.changed, undo: res.undo, note: current.note, added: added.map((a) => a.id), at, queued: current.queued, extra: [] });
    if (extra.length > 0) {
      const work = applyShotPages(shotDeps, pageId, extra).then(({ written, failed }) => {
        setPhase((p) =>
          p.kind === 'applied' && p.at === at
            ? {
                ...p,
                count: p.count + written.length,
                extra: written,
                message: failed.length > 0 ? tr('dictation.shotPageFailed', { where: failed.map((f) => extraWhere(f).join(' › ')).join('; ') }) : p.message,
              }
            : p,
        );
        return written;
      });
      extraWork.current = work.catch(() => []);
    } else extraWork.current = Promise.resolve([]);
  };

  const undoing = useRef(false);
  const undo = async () => {
    if (phase.kind !== 'applied' || phase.commented || tooSoon() || undoing.current) return;
    undoing.current = true;
    try {
      await undoNow(phase);
    } finally {
      undoing.current = false;
    }
  };
  const undoNow = async (phase: Extract<Phase, { kind: 'applied' }>) => {
    if (!undoApplied(target?.view() ?? null, phase.undo)) {
      setPhase({ ...phase, message: tr('dictation.undoLater', { undo: shortcutLabel('undo') }) });
      return;
    }
    // Lo escrito en las páginas de los planos (V4) se deshace también, solo donde nadie lo cambió después.
    const written = await extraWork.current;
    let extraNote: string | null = null;
    if (written.length > 0) {
      const { kept } = await undoShotPages(shotDeps, pageId, written);
      if (kept.length > 0) extraNote = tr('dictation.shotPageKept', { where: kept.map((k) => extraWhere(k).join(' › ')).join('; ') });
    }
    extraWork.current = Promise.resolve([]);
    // Deshecho: la nota vuelve al campo y lo que había agregado a *Couldn't place* sale (no se pierde nada).
    const nextPending = pending.filter((p) => !phase.added.includes(p.id));
    if (phase.queued) {
      // Venía de la cola: vuelve a la cola (después de que *Apply* terminó de sacarla) y a la hoja; el campo no se toca.
      const back = phase.queued;
      setApplied('');
      recentByPage.set(pageId, (recentByPage.get(pageId) ?? []).filter((r) => r.at !== phase.at));
      setPending(nextPending);
      const keepText = text;
      void enqueue(async () => {
        await saveDraft(user.email, workspaceKey, pageId, keepText, nextPending, '');
        await restoreNote(back);
      });
      setQueued(back);
      setPhase({ kind: 'compose', note: extraNote ?? tr('dictation.undoneQueued') });
      return;
    }
    const nextText = text.trim() ? `${phase.note}\n${text}` : phase.note;
    setApplied('');
    // Lo deshecho ya no es una corrección posible: sale de lo reciente.
    recentByPage.set(pageId, (recentByPage.get(pageId) ?? []).filter((r) => r.at !== phase.at));
    setPending(nextPending);
    setText(nextText);
    persist(nextText, nextPending);
    setPhase({ kind: 'compose', note: extraNote ?? tr('dictation.undone') });
  };

  /**
   * *Add as comment* (V4): quien puede comentar pero no editar deja la nota y la ubicación propuesta como un comentario
   * en la página (en el bloque del primer cambio), para que quien edita la pase. Lo destildado va a *Couldn't place*.
   */
  const [commenting, setCommenting] = useState(false);
  const addAsComment = async () => {
    if (phase.kind !== 'preview' || !run.current || !commentAccess.canComment || commenting) return;
    const current = run.current;
    const chosen = phase.plan.changes.filter((c) => !unchecked.has(c.id));
    const left = phase.plan.changes.filter((c) => unchecked.has(c.id));
    const lines = [
      tr('dictation.commentHead', { note: current.note.trim() }),
      ...chosen.map((c) => `• ${c.where.join(' › ')}: ${c.before.trim() || '—'} → ${c.after.trim() || '—'}`),
      ...(phase.plan.unplaced.length > 0 ? [tr('dictation.commentUnplaced'), ...phase.plan.unplaced.map((u) => `• ${u}`)] : []),
    ];
    const blockId = chosen.find((c) => c.target)?.target?.blockId ?? null;
    setCommenting(true);
    try {
      await comments.add(pageId, blockId && /^[A-Za-z0-9_-]{1,128}$/.test(blockId) ? blockId : null, lines.join('\n').slice(0, 9_000));
    } catch (err) {
      console.error('Dictado: no se pudo agregar el comentario', err);
      setCommenting(false);
      setPhase({ kind: 'error', message: tr('dictation.commentFailed'), retry: false });
      return;
    }
    setCommenting(false);
    const added = left.map((c) => c.text).filter((t) => t.trim()).map((t) => ({ id: newId(), text: t }));
    const nextPending = [...pending, ...added];
    setPending(nextPending);
    setApplied(current.note);
    if (current.queued) {
      const from = current.queued;
      const keepText = text;
      void enqueue(async () => {
        await saveDraft(user.email, workspaceKey, pageId, keepText, nextPending, current.note);
        await removeNote(from.id);
      });
      setQueued(null);
    } else {
      setText('');
      persist('', nextPending);
    }
    run.current = null;
    setFocused(null);
    appliedAt.current = 0;
    setPhase({ kind: 'applied', count: chosen.length, undo: null, note: current.note, added: added.map((a) => a.id), at: Date.now(), commented: true });
  };

  // El texto de un Atajo de iOS (`/dictate#…`, V4): va al campo, sin mandar nada; la persona lo revisa y toca *Place*.
  const link = useDictateLink();
  const textRef = useRef(text);
  textRef.current = text;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => {
    if (!loaded || link === null) return;
    const incoming = takeDictateLink();
    if (incoming === null) return;
    if (incoming) {
      // Se guarda ya (no es algo que se está escribiendo): cerrar la hoja enseguida no lo pierde.
      const now = textRef.current;
      const next = (now.trim() ? `${now.trimEnd()}\n${incoming}` : incoming).slice(0, 2000);
      setText(next);
      persist(next, pendingRef.current);
    }
    setQueued(null);
    setPhase({ kind: 'compose', note: tr(incoming ? 'dictation.fromShortcut' : 'dictation.fromShortcutEmpty') });
    requestAnimationFrame(() => field.current?.focus({ preventScroll: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, link]);

  /** Los planos de la página para la chapita (se leen al abrir, al volver a escribir y al tocar la chapita). */
  const refreshShots = useCallback(() => {
    const view = target?.view();
    if (!view) return;
    const map = buildPageMap(view.state, '');
    if (typeof map !== 'string') setShotOptions(shotsOnPage(map));
  }, [target]);
  useEffect(() => {
    if (phase.kind === 'compose') refreshShots();
  }, [phase.kind, refreshShots]);

  /**
   * *Save for later* (V2): la nota del campo pasa a la cola del dispositivo y el campo se vacía, recién cuando la cola
   * confirmó que la guardó. Si no se pudo guardar, el campo queda como estaba (y su borrador también).
   */
  const [saving, setSaving] = useState(false);
  const saveForLater = async () => {
    const note = text;
    if (!note.trim() || saving) return;
    setSaving(true);
    try {
      await addNote({ email: user.email, workspace: workspaceKey, pageId, pageTitle: tree.get(pageId)?.title ?? '', text: note });
    } catch (err) {
      console.error('Dictado: no se pudo guardar la nota para después', err);
      setSaving(false);
      setPhase({ kind: 'compose', note: tr('dictation.saveFailed') });
      return;
    }
    setSaving(false);
    // Si mientras se guardaba se escribió algo más, eso queda en el campo.
    setText((now) => (now === note ? '' : now.startsWith(note) ? now.slice(note.length).trimStart() : now));
    abort.current?.abort();
    abort.current = null;
    run.current = null;
    setPhase({ kind: 'compose', note: tr('dictation.savedForLater') });
    requestAnimationFrame(() => field.current?.focus({ preventScroll: true }));
  };

  /**
   * Pasa a texto una nota con audio de la cola y, si salió algo, la ubica (R1: *Transcribing…* y después *Placing…*).
   * Sin red, sin voz o sin la política, no manda nada: la nota queda guardada.
   */
  const transcribeAndPlace = async (noteId: string, autoPlace: boolean) => {
    const view = target?.view();
    const map = view ? buildPageMap(view.state, tree.get(pageId)?.title ?? '', { fallbackLang: tr.lang === 'es' ? 'es' : 'en' }) : null;
    setFocused(null);
    setPhase({ kind: 'transcribing' });
    let out = await transcribeNote(noteId, {
      email: user.email,
      client,
      workspaceKey,
      hints: voiceHints(map && typeof map !== 'string' ? map : null),
      online: status.online,
    });
    // La está transcribiendo la cola (al volver la red): se espera a que termine.
    for (let i = 0; out === 'busy' && i < 120; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const n = await getNote(noteId);
      if (n && n.state !== 'saved') out = n;
    }
    if (typeof out === 'string') {
      const n = await getNote(noteId);
      setQueued(n);
      setPhase({ kind: 'compose', note: tr(out === 'policy' ? 'dictation.voicePolicy' : out === 'noVoice' ? 'dictation.voiceSetupText' : 'dictation.recordedOffline') });
      return;
    }
    setQueued(out);
    if (out.state === 'ready' && autoPlace && ready && allowed && !offline) {
      await place(out.text, undefined, out);
      return;
    }
    setPhase({ kind: 'compose' });
  };

  /** La grabación terminó (la persona, el tope o un corte): queda en la cola y, si se puede, se transcribe. */
  const afterRecording = async (result: RecordingResult) => {
    recorder.current = null;
    setRec({ state: 'idle', ms: 0 });
    if (!result.noteId) {
      setPhase({ kind: 'compose', note: tr('dictation.nothingRecorded') });
      return;
    }
    if (!canTranscribe) {
      setQueued(null);
      setPhase({ kind: 'compose', note: tr(voice && !voiceAllowed ? 'dictation.voicePolicy' : 'dictation.recordedOffline') });
      return;
    }
    await transcribeAndPlace(result.noteId, true);
  };

  /** El botón grande: tocar para empezar, tocar para cortar (no hay que mantenerlo apretado). */
  const toggleRecord = async () => {
    const current = recorder.current;
    if (current) {
      if (rec.state === 'stopping') return;
      await afterRecording(await current.stop('user'));
      return;
    }
    // Sin cómo transcribir, el botón abre la explicación y los ajustes; no graba.
    if (!voice) {
      setVoiceSettings(true);
      return;
    }
    if (!voiceAllowed) {
      setPhase({ kind: 'compose', note: tr('dictation.voicePolicy') });
      return;
    }
    setConfirm(null);
    setQueued(null);
    const r = new NoteRecorder({
      store: queueRecordingStore({ email: user.email, workspace: workspaceKey, pageId, pageTitle: tree.get(pageId)?.title ?? '' }),
      onState: (state, error) => setRec((s) => ({ ...s, state, error })),
      onTick: (ms) => setRec((s) => (Math.floor(s.ms / 1000) === Math.floor(ms / 1000) ? s : { ...s, ms })),
      onLevel: (level) => {
        if (levelBar.current) levelBar.current.style.transform = `scaleX(${Math.max(0.03, level).toFixed(3)})`;
      },
      onAutoStop: (result) => {
        if (recorder.current === r) void afterRecording(result);
      },
    });
    recorder.current = r;
    setRec({ state: 'starting', ms: 0 });
    setPhase({ kind: 'compose' });
    await r.start();
    if (r.state === 'error') recorder.current = null;
  };

  /** *Insert at cursor* (V3): la transcripción donde estaba el cursor (la página o un campo); escrita, sale de la cola. */
  const insertQueuedAtCursor = () => {
    if (!queued?.text.trim()) return;
    const writable = perms.canEditPage(pageId) && (target?.editable() ?? false);
    if (!insertAtCursor(queued.text, refreshSpot(spot.current), target?.view() ?? null, writable)) {
      setPhase({ kind: 'compose', note: tr('dictation.cursorFailed') });
      return;
    }
    const id = queued.id;
    void enqueue(() => removeNote(id));
    setQueued(null);
    setPhase({ kind: 'compose', note: tr('dictation.insertedAtCursor') });
  };

  /** Corregir la transcripción antes de ubicarla: se guarda en la nota de la cola. */
  const editQueued = (value: string) => {
    if (!queued) return;
    const next = { ...queued, text: value };
    setQueued(next);
    if (editTimer.current) clearTimeout(editTimer.current);
    editTimer.current = setTimeout(() => void updateNote(next.id, { text: value }).catch((err) => console.error('Dictado: no se pudo guardar la corrección', err)), 250);
  };

  /** Abre una nota guardada de esta página en la hoja. */
  const openQueued = (n: QueuedNote) => {
    abort.current?.abort();
    abort.current = null;
    setConfirm(null);
    setFocused(null);
    setQueued(n);
    setPhase({ kind: 'compose' });
  };

  /** *Insert as text* (V2): la nota guardada, como párrafo al final de la página; recién escrita, sale de la cola. */
  const insertQueued = () => {
    if (!queued) return;
    const view = target?.view() ?? null;
    const editor = target?.editor?.() ?? null;
    const writable = perms.canEditPage(pageId) && (target?.editable() ?? false);
    if (!addToSummary(view, editor, null, queued.text, writable)) {
      setPhase({ kind: 'compose', note: tr('dictation.addFailed') });
      return;
    }
    const id = queued.id;
    void enqueue(() => removeNote(id));
    setQueued(null);
    setPhase({ kind: 'compose', note: tr('dictation.inserted') });
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
      // Con una ventana de arriba abierta (*Voice*, *Assistant…*), Esc es de esa ventana: cierra solo esa.
      if (voiceSettings || settingsOpen) return;
      e.preventDefault();
      if (confirm) setConfirm(null);
      else if (phase.kind === 'running') stop();
      else if (phase.kind === 'compose' || phase.kind === 'applied') closeDictation();
      else backToNote();
      return;
    }
    if (e.key === 'Enter' && modPressed(e, IS_MAC)) {
      if (phase.kind === 'compose' && queued) {
        e.preventDefault();
        if (!blocked && queued.text.trim()) void place(queued.text, undefined, queued);
      } else if (phase.kind === 'compose' && !blocked && text.trim()) {
        e.preventDefault();
        void place(text);
      } else if (phase.kind === 'preview' && canEdit) {
        e.preventDefault();
        apply(false);
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
    ) : confirm === 'discardQueued' && queued ? (
      <div className="dictation-confirm" role="alertdialog" aria-label={tr('dictation.discardSaved')}>
        <p>{tr('dictation.discardSaved')}</p>
        <div className="assistant-buttons">
          <button
            className="danger"
            onClick={() => {
              const id = queued.id;
              setConfirm(null);
              setQueued(null);
              void enqueue(() => removeNote(id));
              setPhase({ kind: 'compose', note: tr('dictation.discardedSaved') });
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

  const recordText = (): string => {
    if (rec.state === 'error') {
      const e = rec.error ?? 'failed';
      return tr(e === 'denied' ? 'dictation.micDenied' : e === 'noMic' ? 'dictation.micNone' : e === 'unsupported' ? 'dictation.micUnsupported' : e === 'storage' ? 'dictation.micStorage' : 'dictation.micFailed');
    }
    if (rec.state === 'starting') return tr('dictation.micStarting');
    if (rec.state === 'stopping') return tr('dictation.micSaving');
    if (rec.state === 'recording') return rec.ms >= WARN_MS ? tr('dictation.micEnding', { time: clock(rec.ms), max: clock(MAX_MS) }) : tr('dictation.micRecording', { time: clock(rec.ms) });
    if (voice === null) return tr('dictation.voiceSetupText');
    return tr('dictation.micIdle');
  };

  /** El micrófono grande (V3): tocar y tocar, el nivel, el tiempo y el tope. */
  const micBox = canRecord() ? (
    <div className={`dictation-mic${recording ? ' on' : ''}`}>
      <button
        className="dictation-record"
        aria-pressed={recording}
        aria-label={tr(recording ? 'dictation.micStop' : 'dictation.micStart')}
        disabled={rec.state === 'stopping' || (!recording && voice === undefined)}
        onClick={() => void toggleRecord()}
      >
        {recording ? <span className="dictation-stop-square" aria-hidden="true" /> : <MicIcon size={30} />}
      </button>
      <div className="dictation-mic-text">
        <p className={rec.state === 'error' ? 'assistant-error' : 'dictation-mic-status'} role="status">
          {recordText()}
        </p>
        {rec.state === 'recording' && (
          <span className="dictation-level" aria-hidden="true">
            <span ref={levelBar} />
          </span>
        )}
        <button className="link" onClick={() => setVoiceSettings(true)}>
          {tr('dictation.voice.title')}
        </button>
      </div>
    </div>
  ) : null;

  /** La chapita del plano activo (V4): *Shot: 12_010 ▾*, fija entre notas hasta cambiarla. */
  const options = activeShot && !shotOptions.some((o) => sameShot(o, activeShot)) ? [activeShot, ...shotOptions] : shotOptions;
  const shotChip =
    options.length > 0 ? (
      <label className={`dictation-shot${activeShot ? ' on' : ''}`} data-tip={tr('dictation.shotTip')}>
        <span className="mono-label">{tr('dictation.shot')}</span>
        <select
          value={activeShot ? (options.find((o) => sameShot(o, activeShot)) ?? activeShot) : ''}
          aria-label={tr('dictation.shotLabel')}
          onFocus={refreshShots}
          onChange={(e) => setActiveShot(e.target.value || null)}
        >
          <option value="">{tr('dictation.shotNone')}</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    ) : null;

  /** Las notas guardadas para esta página (V2): se ubican de a una. */
  const savedBox = savedNotes.length > 0 && (
    <section className="dictation-pending dictation-saved" aria-label={tr('dictation.savedNotes')}>
      <p className="mono-label">{tr('dictation.savedNotes')}</p>
      <ul>
        {savedNotes.map((n) => (
          <li key={n.id}>
            <span className="dictation-pending-text">
              <span className="muted">{noteTime(n.createdAt, tr.lang)}</span> “{noteSnippet(n.text || tr('dictation.audioNote'))}”
            </span>
            <span className="dictation-pending-actions">
              <button onClick={() => openQueued(n)}>{tr('dictation.openSaved')}</button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );

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
          {c.corrects && <p className="muted dictation-why">{tr('dictation.corrects')}</p>}
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
            {!canEdit && (perms.known || target?.editable() === false) && <p className="assistant-notice">{tr(commentAccess.canComment ? 'dictation.commentNotice' : 'dictation.readOnlyNotice')}</p>}
            {phase.kind === 'compose' && queued && (
              <div className="dictation-compose dictation-queued">
                <p className="mono-label">{tr('dictation.savedNote', { time: noteTime(queued.createdAt, tr.lang) })}</p>
                {shotChip}
                {queued.audio && queued.state !== 'ready' ? (
                  <>
                    <p className={queued.state === 'failed' ? 'assistant-error' : 'dictation-heard'} role="status">
                      {queued.state === 'failed' ? failureText(queued.error) : tr('dictation.audioSaved', { duration: clock(queued.audio.durationMs) })}
                    </p>
                    <div className="assistant-buttons">
                      <button className="primary dictation-big" disabled={!canTranscribe} onClick={() => void transcribeAndPlace(queued.id, true)}>
                        {tr(queued.state === 'failed' ? 'assistant.tryAgain' : 'dictation.transcribe')}
                      </button>
                    </div>
                  </>
                ) : queued.audio ? (
                  <textarea className="dictation-field" value={queued.text} rows={3} maxLength={2000} aria-label={tr('dictation.transcript')} onChange={(e) => editQueued(e.target.value)} />
                ) : (
                  <p className="dictation-heard dictation-note">“{queued.text}”</p>
                )}
                <div className="assistant-buttons">
                  <button className="primary dictation-big" disabled={blocked || !queued.text.trim()} data-tip={shortcutLabel('dictationPlace')} onClick={() => void place(queued.text, undefined, queued)}>
                    {tr('dictation.place')}
                  </button>
                  {queued.audio && (
                    <button className="dictation-big" disabled={!queued.text.trim()} onClick={insertQueuedAtCursor}>
                      {tr('dictation.insertAtCursor')}
                    </button>
                  )}
                  <button className="dictation-big" disabled={!canEdit || !queued.text.trim()} onClick={insertQueued}>
                    {tr('dictation.insertAsText')}
                  </button>
                  <button disabled={!queued.text.trim()} onClick={() => copy(queued.text)}>
                    {tr('assistant.copy')}
                  </button>
                  <button className="link" onClick={() => setConfirm('discardQueued')}>
                    {tr('assistant.discard')}
                  </button>
                </div>
                <p className="muted assistant-hint" role="status">
                  {phase.note ?? tr('dictation.savedNoteHint')}
                </p>
                {confirmBox}
                <div className="assistant-buttons">
                  <button className="link" onClick={() => setQueued(null)}>
                    {tr('assistant.back')}
                  </button>
                </div>
                {pendingBox}
              </div>
            )}
            {phase.kind === 'compose' && !queued && (
              <div className="dictation-compose">
                {micBox}
                {shotChip}
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
                    <button className="dictation-big" disabled={saving} onClick={() => void saveForLater()}>
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
                {savedBox}
                {(pending.length > 0 || !!applied) && (
                  <div className="assistant-buttons">
                    <button onClick={done}>{tr('dictation.done')}</button>
                  </div>
                )}
              </div>
            )}
            {phase.kind === 'transcribing' && (
              <div className="assistant-result">
                <p className="mono-label" role="status">
                  {tr('dictation.transcribing')}
                </p>
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
                    <button key={o.answer} className="dictation-big" disabled={blocked} onClick={() => void place(run.current?.note ?? text, { question: phase.question, answer: o.answer }, run.current?.queued)}>
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
                    <button className="primary" disabled={blocked} onClick={() => void place(run.current!.note, run.current!.answered, run.current!.queued)}>
                      {tr('assistant.tryAgain')}
                    </button>
                  )}
                  {/* Sin red a mitad del pedido: la nota del campo se puede guardar para después (la de la cola ya está). */}
                  {phase.retry && run.current && !run.current.queued && text.trim() && (
                    <button disabled={saving} onClick={() => void saveForLater()}>
                      {tr('dictation.saveForLater')}
                    </button>
                  )}
                  <SyncedKeyHint show={!!phase.keyRejected} />
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
                {(phase.extra.length > 0 || phase.extraNotes.length > 0) && (
                  <section className="dictation-extra" aria-label={tr('dictation.shotPageTitle')}>
                    <p className="mono-label">{tr('dictation.shotPageTitle')}</p>
                    {phase.extra.length > 0 && (
                      <ul className="dictation-changes">
                        {phase.extra.map((x) => {
                          const on = extraOn.has(x.id) && !unchecked.has(x.from);
                          return (
                            <li key={x.id} className={`dictation-change${on ? '' : ' off'}`}>
                              <input
                                type="checkbox"
                                checked={on}
                                disabled={unchecked.has(x.from)}
                                aria-label={extraWhere(x).join(' › ')}
                                onChange={() =>
                                  setExtraOn((s) => {
                                    const next = new Set(s);
                                    if (next.has(x.id)) next.delete(x.id);
                                    else next.add(x.id);
                                    return next;
                                  })
                                }
                              />
                              <div className="dictation-change-body">
                                <p className="dictation-where dictation-where-static">{extraWhere(x).join(' › ')}</p>
                                <p className="dictation-diff">
                                  {x.before.trim() ? <del>{x.before}</del> : <span className="dictation-empty">—</span>}
                                  <span className="dictation-arrow" aria-hidden="true">
                                    {' → '}
                                  </span>
                                  <ins>{x.after || '—'}</ins>
                                </p>
                                <p className="muted dictation-why">{tr('dictation.shotPageHint')}</p>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {phase.extraNotes.map((n, i) => (
                      <p key={i} className="muted assistant-small">
                        {n.kind === 'differs'
                          ? tr('dictation.shotPageDiffers', { where: [tr('dictation.shotPage'), n.pageTitle ?? n.shot, n.label ?? ''].join(' › '), text: n.text ?? '' })
                          : n.kind === 'notText'
                            ? tr('dictation.shotPageNotText', { where: [tr('dictation.shotPage'), n.pageTitle ?? n.shot, n.label ?? ''].join(' › ') })
                            : n.kind === 'ambiguous'
                              ? tr('dictation.shotPageAmbiguous', { shot: n.shot })
                              : n.kind === 'unavailable'
                                ? tr('dictation.shotPageUnavailable', { page: n.pageTitle ?? n.shot })
                                : tr('dictation.shotPageReadOnly', { page: n.pageTitle ?? n.shot })}
                      </p>
                    ))}
                  </section>
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
                  {!canEdit && commentAccess.canComment && (
                    <button
                      className="primary dictation-big"
                      disabled={commenting || (phase.plan.changes.every((c) => unchecked.has(c.id)) && phase.plan.unplaced.length === 0)}
                      onClick={() => void addAsComment()}
                    >
                      {tr('dictation.addAsComment')}
                    </button>
                  )}
                  <button
                    className={canEdit || !commentAccess.canComment ? 'primary dictation-big' : 'dictation-big'}
                    disabled={!canEdit || phase.plan.changes.every((c) => unchecked.has(c.id))}
                    data-tip={shortcutLabel('assistantApply')}
                    onClick={() => apply(true)}
                  >
                    {tr('assistant.apply')}
                  </button>
                  <button onClick={backToNote} data-tip={shortcutLabel('menusClose')}>
                    {tr('assistant.discard')}
                  </button>
                  <button disabled={blocked} onClick={() => void place(run.current!.note, run.current!.answered, run.current!.queued)}>
                    {tr('assistant.tryAgain')}
                  </button>
                  <button onClick={() => copy(previewText(phase.plan))}>{tr('assistant.copy')}</button>
                </div>
              </div>
            )}
            {phase.kind === 'applied' && (
              <div className="assistant-result">
                <p className="assistant-ok" role="status">
                  {phase.commented ? tr('dictation.commented') : tr('dictation.applied', { count: phase.count })}
                </p>
                {phase.message && <p className="assistant-notice">{phase.message}</p>}
                {keptBox}
                <div className="assistant-buttons">
                  {/* *Done* primero y *Undo* al final, lejos de donde estaba *Apply* (N1). */}
                  <button className="primary dictation-big" onClick={done}>
                    {tr('dictation.done')}
                  </button>
                  <button onClick={newNote}>{tr('dictation.another')}</button>
                  {!phase.commented && (
                    <button className="dictation-big" onClick={() => void undo()}>
                      {tr('dictation.undo')}
                    </button>
                  )}
                </div>
                {confirmBox}
                {pendingBox}
              </div>
            )}
          </>
        )}
      </div>
      {voiceSettings && <VoiceSettingsDialog email={user.email} assistant={settings ?? null} onClose={() => setVoiceSettings(false)} />}
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

