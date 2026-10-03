import { useSyncExternalStore } from 'react';
import { metaOf, ProjectReplace, type OpHeader, type RedoResult, type SavedOp, type UndoResult } from '../search/projectReplace';
import { t } from '../i18n';
import { useServices, type Services } from '../services';
import { Permissions } from '../sync/access';
import { navigate, pagePath } from '../router';
import { blockElement, revealBlock } from './commentsUi';
import { notify, type NoticeAction } from './notice';
import { shortcutLabel } from './shortcuts';
import { undoTimelineFor, type UndoTimeline } from './undoTimeline';

// Reemplazar en todo el proyecto (Docs/Doc_Buscar.md, "Reemplazar en el proyecto"): lo que vive siempre cargado. El
// motor (`ProjectReplace`, uno por instancia de servicios, como la búsqueda) y lo que el panel recuerda mientras
// dura la sesión: si el reemplazo está desplegado, lo escrito, *Aa*, palabra entera y lo sacado de la lista. El
// panel se baja aparte; el reemplazo sigue corriendo aunque se cierre (y Workspace.tsx pide confirmación antes de
// cerrar la pestaña o de cambiar de workspace mientras corre).

export interface ReplaceUiState {
  /** El renglón del reemplazo, desplegado. */
  open: boolean;
  replacement: string;
  matchCase: boolean;
  wholeWord: boolean;
  /** Coincidencias sacadas de la lista (por los ids de sus caracteres) y páginas sacadas enteras. */
  excluded: ReadonlyMap<string, ReadonlySet<string>>;
  excludedPages: ReadonlySet<string>;
}

const EMPTY: ReplaceUiState = {
  open: false,
  replacement: '',
  matchCase: false,
  wholeWord: false,
  excluded: new Map(),
  excludedPages: new Set(),
};

export class ReplaceSession {
  readonly engine: ProjectReplace;
  private state: ReplaceUiState = EMPTY;
  private readonly listeners = new Set<() => void>();
  /** El último reemplazo hecho desde el panel, hasta que se escriba en un campo del panel (DH9). */
  private armed: string | null = null;
  private readonly timelineOf: () => UndoTimeline;

  constructor(services: Pick<Services, 'tree' | 'docs' | 'db' | 'engine' | 'access' | 'user'>) {
    const { tree, docs, db, engine, access, user } = services;
    // La línea de tiempo de deshacer de esta instancia de servicios (se pide cada vez: se suelta al cerrar sesión).
    this.timelineOf = () => undoTimelineFor({ docs, tree });
    const timelineOf = this.timelineOf;
    this.engine = new ProjectReplace({
      tree,
      docs,
      meta: metaOf(db),
      perms: () => new Permissions(tree, access.get(), user.id),
      online: () => engine.getStatus().online,
      sync: () => engine.syncNow(),
      get history() {
        return timelineOf();
      },
    });
  }

  get timeline(): UndoTimeline {
    return this.timelineOf();
  }

  /** Recién reemplazado desde el panel: ⌘Z ahí deshace el reemplazo hasta que se escriba en un campo (DH9). */
  arm(opId: string): void {
    this.armed = opId;
  }

  disarm(): void {
    this.armed = null;
  }

  /** El reemplazo que ⌘Z (o ⌘⇧Z) en el panel deshace (o rehace) ahora, o `null`: ahí sigue el deshacer del campo. */
  armedFor(kind: 'undo' | 'redo'): string | null {
    return this.armed && this.timeline.replaceIsNext(this.armed, kind) ? this.armed : null;
  }

  get = (): ReplaceUiState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  update(patch: Partial<ReplaceUiState>): void {
    // Escribir en el campo del reemplazo: ⌘Z ahí vuelve a ser del campo (DH9).
    if ('replacement' in patch && patch.replacement !== this.state.replacement) this.armed = null;
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  /** Lo sacado de la lista vale para una búsqueda: al cambiar lo buscado o las opciones, vuelve todo. */
  clearExcluded(): void {
    if (this.state.excluded.size === 0 && this.state.excludedPages.size === 0) return;
    this.update({ excluded: new Map(), excludedPages: new Set() });
  }
}

const sessions = new WeakMap<object, ReplaceSession>();
/** Todas las sesiones de esta pestaña (para cerrar sesión desde una pantalla sin servicios). */
const every = new Set<ReplaceSession>();

/** El reemplazo de una instancia de servicios. */
export function replaceSession(services: Pick<Services, 'tree' | 'docs' | 'db' | 'engine' | 'access' | 'user'>): ReplaceSession {
  let session = sessions.get(services.docs);
  if (!session) {
    session = new ReplaceSession(services);
    sessions.set(services.docs, session);
    every.add(session);
  }
  return session;
}

/** Si hay un reemplazo (o su deshacer) corriendo en esta instancia de servicios. */
export function replaceRunning(services: { docs: object }): boolean {
  return sessions.get(services.docs)?.engine.isRunning() ?? false;
}

/**
 * Si hay un reemplazo (o su deshacer) corriendo en esta pestaña: cerrar sesión lo dejaría escribiendo en una base
 * cerrada (Docs/Doc_Buscar.md, auditoría de la entrega 3, hallazgo 4). Avisa y devuelve `true` si hay que esperar.
 */
export function replaceBlocksLeaving(): boolean {
  if (![...every].some((s) => s.engine.isRunning())) return false;
  alert(t('replace.runningLeave'));
  return true;
}

// --- Deshacer y rehacer un reemplazo (Docs/Doc_Deshacer.md, 3.3, DH3, DH5 y DH10) -----------------------------------

/** "“Cámara” → “Camera” in 12 pages" (o "deleting “Cámara” in 12 pages" con el reemplazo vacío). */
function what(header: Pick<OpHeader, 'query' | 'replacement'>, pages: number): { what: string; pages: string } {
  return {
    what: header.replacement ? t('undo.replaceWhat', { from: header.query, to: header.replacement }) : t('undo.replaceWhatDelete', { from: header.query }),
    pages: t('undo.pages', { count: pages }),
  };
}

/** Lo que no salió (otro lo cambió, no se pudo ahora, no se pudo guardar), para sumar al aviso. */
function leftParts(r: { changed: number; remaining: number; unsaved: boolean }): string[] {
  const parts: string[] = [];
  if (r.changed > 0) parts.push(t('replace.undoChanged', { count: r.changed }));
  if (r.remaining > 0) parts.push(t('replace.undoRemaining', { count: r.remaining }));
  if (r.unsaved) parts.push(t('replace.unsaved'));
  return parts;
}

/** Dónde había cambiado algo que deshacer no tocó (un lugar por bloque, en orden). */
type Place = { pageId: string; blockId: string };

export interface ShowDeps {
  go: (pageId: string) => void;
  /** Lleva la vista al bloque y lo resalta; `false` si todavía no está en pantalla. */
  reveal: (blockId: string) => boolean;
  notify: typeof notify;
  waitMs?: number;
}

const showDeps: ShowDeps = {
  go: (pageId) => navigate(pagePath(pageId)),
  reveal: (blockId) => (blockElement(blockId) ? revealBlock(blockId) : false),
  notify,
};

/**
 * *Show* (Docs/Doc_Buscar.md: "con *Show*: la página y el fragmento de cada una, para arreglarlas a mano"): lleva al
 * primer lugar que había cambiado y lo muestra; con más de uno, un aviso con *Next* lleva al siguiente.
 */
export function showChanged(changedAt: readonly Place[], deps: ShowDeps = showDeps, at = 0): void {
  const seen = new Set<string>();
  const places = changedAt.filter((p) => {
    const key = `${p.pageId}/${p.blockId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const place = places[at];
  if (!place) return;
  deps.go(place.pageId);
  // La página puede tardar en abrir: se espera a que el bloque esté (hasta `waitMs`).
  const started = Date.now();
  const tryReveal = () => {
    if (deps.reveal(place.blockId) || Date.now() - started > (deps.waitMs ?? 10000)) return;
    setTimeout(tryReveal, 50);
  };
  tryReveal();
  if (places.length > 1) {
    deps.notify(
      t('undo.changedHere', { n: at + 1, total: places.length }),
      at + 1 < places.length ? { label: t('undo.nextChanged'), run: () => showChanged(places, deps, at + 1) } : undefined,
    );
  }
}

/** El botón *Show* del aviso, si algo había cambiado. */
function showAction(result: UndoResult): NoticeAction | undefined {
  if (result.changed === 0 || result.changedAt.length === 0) return undefined;
  const places = [...result.changedAt];
  return { label: t('undo.showChanged'), run: () => showChanged(places) };
}

/**
 * Deshace un reemplazo y avisa. Si es el próximo ⌘Z de la línea de tiempo (⌘Z, o *Undo* cuando es lo último), queda
 * para rehacer: "Undid “Cámara” → “Camera” in 12 pages · Redo". Si no (DH10), en las páginas con historia se deshace
 * su paso de la pila aunque no sea el de arriba, en las demás por las anclas, y no se rehace.
 */
export async function undoReplace(session: ReplaceSession, opId: string): Promise<UndoResult> {
  const timeline = session.timeline;
  const inOrder = timeline.replaceIsNext(opId, 'undo');
  const saved = timeline.replaceSaved(opId) as SavedOp | null;
  const result = await session.engine.undo(opId, { inOrder });
  if (inOrder && saved) {
    if (result.pages === 0) {
      notify([t('undo.nothingThere', { undo: shortcutLabel('undo') }), ...leftParts(result)].join(' · '));
    } else {
      const canRedo = timeline.replaceIsNext(opId, 'redo');
      notify(
        [t('undo.replaceUndone', what(saved.header, result.pages)), ...leftParts(result)].join(' · '),
        canRedo ? { label: t('undo.redoAction'), run: () => void redoReplace(session, opId) } : undefined,
        showAction(result),
      );
    }
    return result;
  }
  const parts = [t('replace.undone', { count: result.undone }), ...leftParts(result)];
  notify(parts.join(' · '), showAction(result));
  return result;
}

/** Rehace un reemplazo deshecho con ⌘Z y avisa: "Redid “Cámara” → “Camera” in 12 pages · Undo". */
export async function redoReplace(session: ReplaceSession, opId: string): Promise<RedoResult> {
  const timeline = session.timeline;
  const saved = timeline.replaceSaved(opId) as SavedOp | null;
  if (!saved || !timeline.replaceIsNext(opId, 'redo')) return { redone: 0, changed: 0, pages: 0, remaining: 0, unsaved: false };
  const result = await session.engine.redo(opId);
  if (result.pages === 0) {
    notify([t('undo.nothingThereRedo', { redo: shortcutLabel('redo') }), ...leftParts(result)].join(' · '));
  } else {
    const canUndo = timeline.replaceIsNext(opId, 'undo');
    notify(
      [t('undo.replaceRedone', what(saved.header, result.pages)), ...leftParts(result)].join(' · '),
      canUndo ? { label: t('undo.undoAction'), run: () => void undoReplace(session, opId) } : undefined,
    );
  }
  return result;
}

export function useReplaceSession(): { session: ReplaceSession; ui: ReplaceUiState } {
  const session = replaceSession(useServices());
  const ui = useSyncExternalStore(session.subscribe, session.get);
  useSyncExternalStore(session.engine.subscribe, session.engine.getVersion);
  return { session, ui };
}
