import type * as Y from 'yjs';
import { ORIGIN_REPLACE } from '../sync/docs';
import type { DocState } from '../sync/localDb';
import type { PageRow } from '../sync/types';
import { COLLAPSE_PREFIX } from '../ui/collapseStore';
import { findUnknownContent } from '../ui/unknownContent';
import type { SearchOptions } from './normalize';
import { treeContentGap } from '../sync/clean';
import {
  applyPlan,
  hiddenBlocks,
  planCount,
  planRedo,
  planReplace,
  planUndo,
  recordsOf,
  sameRecords,
  type CollapseRecord,
  type EditRecord,
  type PlannedMatch,
  type SkipReason,
} from './replaceDoc';

// Reemplazar en todo el proyecto (Docs/Doc_Buscar.md, "Reemplazar en el proyecto (diseño)" y "Cómo quedó (entrega
// 3)"). Sin React, como projectIndex.ts: una instancia por instancia de servicios.
//
// - **Qué páginas:** se revisa antes de abrir cada una lo que no necesita el documento (está en el árbol y en el
//   proyecto, no en la papelera, permisos conocidos y de edición, completa, legible, sin un rechazo del servidor), así
//   una página salteada no recibe nada (ni la guardia de versión ni una reparación). Con la página abierta y adentro
//   de su candado (`docs.edit`): esta versión la puede mostrar y el documento vivo no está viejo.
// - **Escribir una página:** el plan, **el registro guardado antes** (en `meta`), el plan otra vez sin esperar nada
//   (tiene que ser el mismo) y una sola transacción de Yjs por `docs.applyLocal` (la protección del editor abierto).
//   Después, `flush` y `isSaved`: si no quedó guardado en el dispositivo, se corta todo.
// - **Deshacer:** con el registro, solo donde entre las anclas sigue exactamente lo que se puso.
// - **El registro:** `replace:<op>` (el encabezado) y `replace:<op>:<página>` (los cambios), los últimos 5 por
//   proyecto. `meta` no cambia de versión; las versiones anteriores solo leen sus propias claves.

export const REPLACE_PREFIX = 'replace:';
/** Reemplazos que se guardan para deshacer, por proyecto. */
export const KEEP_PER_PROJECT = 5;
/** Lo que espera la sincronización antes de "Replace all" (con red). */
export const SYNC_WAIT_MS = 10_000;
/** Intentos de escribir una página que cambia mientras se guarda el registro. */
const ATTEMPTS = 3;

/** Por qué una página no se toca. */
export type PageBlock =
  | 'gone'
  | 'trash'
  | 'permsUnknown'
  | 'viewOnly'
  | 'missing'
  | 'unreadable'
  | 'rejected'
  | 'unsupported'
  | 'changing'
  | 'error';

export interface ReplaceTree {
  get(id: string): PageRow | undefined;
  isTrashed(id: string): boolean;
  hasUnsentCreate(pageId: string): boolean;
  /** "Al día" para este dispositivo (privacidad de lo borrado); sin él, con `update_seq`. */
  contentGap?(row: PageRow, cursor: number): 'missing' | 'preparing' | null;
}

export interface ReplaceDocs {
  edit<T>(pageId: string, fn: (doc: Y.Doc) => Promise<T> | T): Promise<T>;
  applyLocal(pageId: string, doc: Y.Doc, origin: symbol, apply: () => void): boolean;
  flush(pageId?: string): Promise<void>;
  isSaved(pageId: string): boolean;
  peek(pageId: string): Y.Doc | null;
  indexSnapshot(pageId: string): Promise<{ doc: Y.Doc; state: DocState | undefined }>;
  stateOf(pageId: string): Promise<DocState | undefined>;
}

export interface ReplaceMeta {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
}

/**
 * La línea de tiempo de deshacer (ui/undoTimeline.ts), vista desde el reemplazo (Docs/Doc_Deshacer.md, 3.3; entrega 2).
 * En las páginas con historia en la sesión, lo escrito entra como un paso de la pila de Yjs de la página y se deshace
 * y rehace con ella (`popReplace`); en las demás (`none`), con las anclas del registro.
 */
export interface ReplaceHistory {
  beginReplace(opId: string, projectId: string): void;
  /**
   * Corre `write` una vez; devuelve si entró en la pila de la página. `undo` / `redo`: lo que escriben las anclas al
   * deshacer (o rehacer) en orden, en una página que ahora tiene historia, entra como lo contrario.
   */
  writeReplace(pageId: string, doc: Y.Doc, opId: string, origin: symbol, write: () => void, as?: 'new' | 'undo' | 'redo'): boolean;
  endReplace(opId: string, saved: SavedOp | null): void;
  popReplace(pageId: string, doc: Y.Doc, opId: string, kind: 'undo' | 'redo', keep: boolean): 'done' | 'nothing' | 'failed' | 'none';
  settleReplace(opId: string, kind: 'undo' | 'redo', pages: string[], keep: boolean): void;
  /** Empieza a deshacer o rehacer (si mientras tanto se escribe algo nuevo, no queda para rehacer). */
  markReplace(opId: string): void;
  replaceSaved(opId: string): unknown;
  replacePages(opId: string): string[];
}

/** Lo que se guarda en memoria de un reemplazo para rehacerlo (y para deshacerlo si ya no está en `meta`). */
export interface SavedOp {
  header: OpHeader;
  records: Record<string, EditRecord[]>;
}

export interface ReplaceDeps {
  tree: ReplaceTree;
  docs: ReplaceDocs;
  meta: ReplaceMeta;
  /** La línea de tiempo de deshacer (sin ella, como antes: solo las anclas y sin rehacer). */
  history?: ReplaceHistory;
  /** Los permisos de la persona ahora (se piden cada vez: pueden cambiar mientras corre). */
  perms: () => { known: boolean; canEditPage(pageId: string): boolean };
  online: () => boolean;
  /** Sincroniza ya (antes de "Replace all", con red). */
  sync?: () => Promise<void>;
}

export interface ReplaceRequest {
  projectId: string;
  /** Las páginas, en el orden de la lista. */
  pageIds: string[];
  query: string;
  replacement: string;
  options: SearchOptions;
  /** Coincidencias sacadas de la lista (por sus ids). */
  exclude?: ReadonlySet<string>;
  /**
   * `all`: *Replace all*; `some`: una coincidencia o una página. Se guardan para deshacer los últimos 5 de cada uno:
   * los sueltos no le sacan el *Undo* a un *Replace all* grande.
   */
  scope?: OpScope;
  /** Solo estas coincidencias (reemplazar una). */
  only?: ReadonlySet<string>;
  /** Con el reemplazo vacío, borrar también las escondidas (la casilla). */
  deleteHidden?: boolean;
}

export type SkipCounts = Partial<Record<SkipReason, number>>;

export interface PageSummary {
  pageId: string;
  block?: PageBlock;
  /** Cuántas se cambian. */
  count: number;
  /** De esas, cuántas están en secciones colapsadas. */
  hidden: number;
  skipped: SkipCounts;
}

export interface Summary {
  pages: PageSummary[];
  /** Cuántas se cambian, en cuántas páginas. */
  count: number;
  pageCount: number;
  /** Las escondidas que se cambian (o, con el reemplazo vacío, las que se borrarían con la casilla). */
  hidden: number;
  skipped: SkipCounts;
  /** Coincidencias en páginas que no se tocan. */
  blocked: number;
  offline: boolean;
}

export type OpScope = 'all' | 'some';

export type OpStatus = 'running' | 'done' | 'stopped' | 'partial';

export interface OpHeader {
  id: string;
  projectId: string;
  at: number;
  query: string;
  replacement: string;
  options: SearchOptions;
  status: OpStatus;
  /** De qué tipo es (sin el campo, de antes: `all`). */
  scope?: OpScope;
  /** Las páginas que se escribieron (o se intentaron: el registro se guarda antes). */
  pages: string[];
  replaced: number;
  /** Cuántas páginas se iban a tocar. */
  planned: number;
}

interface PageRecord {
  pageId: string;
  edits: EditRecord[];
  /** Quedó guardado en el dispositivo (informativo: deshacer mira el documento). */
  applied: boolean;
}

export interface RunResult {
  opId: string | null;
  replaced: number;
  pages: number;
  /** Páginas que no se tocaron, por qué. */
  blocked: Partial<Record<PageBlock, number>>;
  skipped: SkipCounts;
  /** Se cortó con *Stop*. */
  stopped: boolean;
  /** Guardar en el dispositivo falló: se cortó todo. */
  unsaved: boolean;
  /** De las cambiadas, cuántas estaban escondidas en secciones colapsadas (el aviso lo dice). */
  hidden: number;
}

export interface UndoResult {
  undone: number;
  changed: number;
  notApplied: number;
  /** Páginas donde se deshizo algo. */
  pages: number;
  /** Páginas que hoy no se pudieron tocar (quedan en el registro: *Undo the rest*). */
  remaining: number;
  unsaved: boolean;
  /** Los que cambiaron: dónde (para *Show*). */
  changedAt: { pageId: string; blockId: string }[];
}

export interface RedoResult {
  redone: number;
  changed: number;
  /** Páginas donde se rehízo. */
  pages: number;
  /** Páginas que hoy no se pudieron tocar. */
  remaining: number;
  unsaved: boolean;
}

export interface Progress {
  kind: 'replace' | 'undo' | 'redo';
  done: number;
  total: number;
}

const headerKey = (op: string) => `${REPLACE_PREFIX}${op}`;
const pageKey = (op: string, pageId: string) => `${REPLACE_PREFIX}${op}:${pageId}`;

function addSkips(into: SkipCounts, matches: PlannedMatch[]): void {
  for (const m of matches) if (m.skip && m.skip !== 'excluded') into[m.skip] = (into[m.skip] ?? 0) + 1;
}

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export class ProjectReplace {
  private progress: Progress | null = null;
  private stopRequested = false;
  private current: string | null = null;
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(private readonly deps: ReplaceDeps) {}

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = (): number => this.version;

  private changed(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  /** Lo que está corriendo (reemplazar o deshacer), o `null`. */
  getProgress(): Progress | null {
    return this.progress;
  }

  /** Hay algo corriendo: cerrar la app ahora lo deja a medias. */
  isRunning(): boolean {
    return this.progress !== null;
  }

  /** *Stop*: termina la página en curso y para. */
  stop(): void {
    if (this.progress) this.stopRequested = true;
  }

  // --- Qué páginas se tocan --------------------------------------------------------------------------------

  /** Lo que se revisa antes de abrir la página (no necesita el documento). */
  async blockOf(pageId: string, projectId: string): Promise<PageBlock | null> {
    const { tree, docs } = this.deps;
    const row = tree.get(pageId);
    if (!row || row.workspace_id !== projectId) return 'gone';
    if (tree.isTrashed(pageId)) return 'trash';
    const perms = this.deps.perms();
    if (!perms.known) return 'permsUnknown';
    if (!perms.canEditPage(pageId)) return 'viewOnly';
    const state = await docs.stateOf(pageId);
    // Lo que falta bajar, o "en preparación" (un invitado con Editar sin base limpia todavía).
    if (treeContentGap(tree, row, state?.cursor ?? 0) !== null && !tree.hasUnsentCreate(pageId)) return 'missing';
    if (state?.unreadable) return 'unreadable';
    if (state?.rejected) return 'rejected';
    return null;
  }

  /** Lo que se revisa con la página abierta: esta versión la puede mostrar y el documento vivo no está viejo. */
  private docBlock(pageId: string, doc: Y.Doc): PageBlock | null {
    if (findUnknownContent(doc)) return 'unsupported';
    if (this.deps.docs.peek(pageId) !== doc) return 'unsupported';
    return null;
  }

  /** Lo colapsado para vos en la página (`collapse:<página>` en `meta`), sin tocarlo. */
  private async personalCollapse(pageId: string): Promise<Map<string, CollapseRecord>> {
    const out = new Map<string, CollapseRecord>();
    try {
      const saved = (await this.deps.meta.get(COLLAPSE_PREFIX + pageId)) as { h?: Record<string, { c?: unknown; e?: unknown }> } | undefined;
      for (const [id, r] of Object.entries(saved?.h ?? {})) {
        if (r && typeof r.c === 'boolean') out.set(id, typeof r.e === 'string' && r.e ? { c: r.c, e: r.e } : { c: r.c });
      }
    } catch {
      // Sin poder leerlo, nada colapsado para vos (lo de todos está en el documento).
    }
    return out;
  }

  /** Lee el documento de una página sin abrirla para editar: el vivo si está abierta, si no lo guardado. */
  private async readDoc<T>(pageId: string, fn: (doc: Y.Doc) => T): Promise<T> {
    const live = this.deps.docs.peek(pageId);
    if (live) return fn(live);
    const { doc } = await this.deps.docs.indexSnapshot(pageId);
    try {
      return fn(doc);
    } finally {
      doc.destroy();
    }
  }

  /** Los bloques de una página escondidos en secciones colapsadas (para marcarlos en la lista). */
  async hiddenOf(pageId: string): Promise<Set<string>> {
    const personal = await this.personalCollapse(pageId);
    return this.readDoc(pageId, (doc) => hiddenBlocks(doc, personal));
  }

  /** Las coincidencias de una página con sus ids (para identificar una de la lista: *Replace* y ×). */
  async matchesOf(pageId: string, query: string, options: SearchOptions): Promise<PlannedMatch[]> {
    return this.readDoc(pageId, (doc) => planReplace(doc, query, '\u0000', options).matches);
  }

  // --- La confirmación ---------------------------------------------------------------------------------------

  /**
   * Lo que haría "Replace all", sin escribir nada: con red, primero sincroniza (hasta 10 s) para contar con las
   * páginas al día. Las cuentas son las de la confirmación.
   */
  async prepare(request: ReplaceRequest, { sync = true }: { sync?: boolean } = {}): Promise<Summary> {
    const offline = !this.deps.online();
    if (sync && !offline && this.deps.sync) {
      await Promise.race([this.deps.sync().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, SYNC_WAIT_MS))]);
    }
    const summary: Summary = { pages: [], count: 0, pageCount: 0, hidden: 0, skipped: {}, blocked: 0, offline };
    for (const pageId of request.pageIds) {
      const page: PageSummary = { pageId, count: 0, hidden: 0, skipped: {} };
      summary.pages.push(page);
      const block = await this.blockOf(pageId, request.projectId);
      const personal = await this.personalCollapse(pageId);
      const plan = await this.readDoc(pageId, (doc) => {
        page.block = block ?? (findUnknownContent(doc) ? 'unsupported' : undefined);
        // Para contar, con las escondidas: la confirmación dice cuántas hay (y con el reemplazo vacío, la casilla).
        return planReplace(doc, request.query, request.replacement, {
          ...request.options,
          hidden: hiddenBlocks(doc, personal),
          exclude: request.exclude,
          only: request.only,
          deleteHidden: true,
        });
      });
      const changes = plan.matches.filter((m) => !m.skip);
      if (page.block) {
        summary.blocked += changes.length;
        continue;
      }
      page.hidden = changes.filter((m) => m.hidden).length;
      const deletesHidden = request.replacement === '' && !request.deleteHidden;
      page.count = deletesHidden ? changes.length - page.hidden : changes.length;
      if (deletesHidden && page.hidden > 0) page.skipped.hidden = page.hidden;
      addSkips(page.skipped, plan.matches);
      summary.count += page.count;
      summary.hidden += page.hidden;
      if (page.count > 0) summary.pageCount++;
      for (const [k, v] of Object.entries(page.skipped)) summary.skipped[k as SkipReason] = (summary.skipped[k as SkipReason] ?? 0) + (v ?? 0);
    }
    return summary;
  }

  // --- Reemplazar --------------------------------------------------------------------------------------------

  /** Reemplaza en las páginas pedidas, de a una. Guarda el registro para deshacer. */
  async run(request: ReplaceRequest): Promise<RunResult> {
    const result: RunResult = { opId: null, replaced: 0, pages: 0, blocked: {}, skipped: {}, stopped: false, unsaved: false, hidden: 0 };
    if (this.progress || !request.query) return result;
    const { docs, meta } = this.deps;
    const opId = crypto.randomUUID();
    const header: OpHeader = {
      id: opId,
      projectId: request.projectId,
      at: Date.now(),
      query: request.query,
      replacement: request.replacement,
      options: { matchCase: !!request.options.matchCase, wholeWord: !!request.options.wholeWord },
      status: 'running',
      pages: [],
      replaced: 0,
      planned: request.pageIds.length,
      scope: request.scope ?? 'all',
    };
    this.current = opId;
    this.stopRequested = false;
    this.progress = { kind: 'replace', done: 0, total: request.pageIds.length };
    this.changed();
    const block = (reason: PageBlock) => {
      result.blocked[reason] = (result.blocked[reason] ?? 0) + 1;
    };
    const history = this.deps.history;
    // Lo escrito en cada página (para rehacer y para deshacer si el registro ya no está en `meta`).
    const written: Record<string, EditRecord[]> = {};
    let begun = false;
    try {
      await meta.put(headerKey(opId), header);
      result.opId = opId;
      for (const pageId of request.pageIds) {
        if (this.stopRequested) {
          result.stopped = true;
          break;
        }
        const before = await this.blockOf(pageId, request.projectId);
        if (before) {
          block(before);
        } else {
          const personal = await this.personalCollapse(pageId);
          let outcome: { block?: PageBlock; count?: number; written?: boolean; hidden?: number };
          try {
            outcome = await docs.edit(pageId, async (doc) => {
              // Otra vez adentro del candado, justo antes de escribir: mientras se esperaba pudo llegar una bajada
              // ilegible, un rechazo del servidor, un permiso menos o la papelera (`blockOf` no toma el candado).
              const late = (await this.blockOf(pageId, request.projectId)) ?? this.docBlock(pageId, doc);
              if (late) return { block: late };
              const planOf = () =>
                planReplace(doc, request.query, request.replacement, {
                  ...request.options,
                  hidden: hiddenBlocks(doc, personal),
                  exclude: request.exclude,
                  only: request.only,
                  deleteHidden: request.deleteHidden,
                });
              let plan = planOf();
              addSkips(result.skipped, plan.matches);
              if (plan.edits.length === 0) return { count: 0 };
              for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
                const records = recordsOf(plan);
                // El registro va antes: si la app se cierra antes de escribir, deshacer lo reconoce y no hace nada.
                if (!header.pages.includes(pageId)) {
                  header.pages.push(pageId);
                  await meta.put(headerKey(opId), header);
                }
                await meta.put(pageKey(opId, pageId), { pageId, edits: records, applied: false } satisfies PageRecord);
                // Otra vez, sin esperar nada entre esto y escribir: el editor abierto pudo escribir mientras tanto.
                const again = planOf();
                if (sameRecords(recordsOf(again), records)) {
                  const write = () => docs.applyLocal(pageId, doc, ORIGIN_REPLACE, () => applyPlan(again));
                  if (history) {
                    // Algo nuevo: lo que había para rehacer se va (con el primer cambio, no antes).
                    if (!begun) history.beginReplace(opId, request.projectId);
                    begun = true;
                    // En una página con historia en la sesión, entra además en su pila de Yjs (Doc_Deshacer.md, 3.3).
                    history.writeReplace(pageId, doc, opId, ORIGIN_REPLACE, write);
                  } else write();
                  written[pageId] = records;
                  const hidden = again.matches.filter((m) => m.hidden && !m.skip).length;
                  return { count: planCount(again), written: true, hidden };
                }
                plan = again;
              }
              return { block: 'changing' as const };
            });
          } catch (err) {
            console.warn(`Replace failed on page ${pageId}`, err);
            outcome = { block: 'error' };
          }
          if (outcome.block) block(outcome.block);
          if (outcome.written) {
            await docs.flush(pageId);
            if (!docs.isSaved(pageId)) {
              // No quedó en el dispositivo (sin espacio): seguir dejaría cientos de documentos en memoria.
              result.unsaved = true;
              result.replaced += outcome.count ?? 0;
            result.hidden += outcome.hidden ?? 0;
              result.pages++;
              break;
            }
            await meta.put(pageKey(opId, pageId), {
              pageId,
              edits: ((await meta.get(pageKey(opId, pageId))) as PageRecord | undefined)?.edits ?? [],
              applied: true,
            } satisfies PageRecord);
            result.replaced += outcome.count ?? 0;
            result.hidden += outcome.hidden ?? 0;
            result.pages++;
            header.replaced = result.replaced;
          }
        }
        this.progress = { kind: 'replace', done: this.progress.done + 1, total: this.progress.total };
        this.changed();
        // Cede el hilo entre páginas.
        await nextTask();
      }
      header.replaced = result.replaced;
      header.status = result.stopped || result.unsaved ? 'stopped' : 'done';
      if (header.pages.length === 0) {
        // No se escribió nada: no ocupa lugar entre los que se pueden deshacer.
        await meta.delete(headerKey(opId));
        result.opId = null;
      } else {
        await meta.put(headerKey(opId), header);
        await this.prune(request.projectId, opId, header.scope ?? 'all');
      }
    } finally {
      // Entra en la línea de tiempo como un paso (si cambió algo).
      if (begun) history?.endReplace(opId, result.opId && result.replaced > 0 ? { header: { ...header, pages: [...header.pages] }, records: written } : null);
      this.progress = null;
      this.current = null;
      this.stopRequested = false;
      this.changed();
    }
    return result;
  }

  // --- Deshacer ----------------------------------------------------------------------------------------------

  /**
   * Deshace un reemplazo. `inOrder`: es el próximo ⌘Z de la línea de tiempo (⌘Z, o *Undo* cuando es lo último): queda
   * para rehacer. Si no (*Undo* del aviso o del panel cuando ya no es lo último, DH10), en las páginas con historia se
   * deshace igual su paso de la pila (aunque no sea el de arriba) y no queda para rehacer.
   */
  async undo(opId: string, { inOrder = false }: { inOrder?: boolean } = {}): Promise<UndoResult> {
    const result: UndoResult = { undone: 0, changed: 0, notApplied: 0, pages: 0, remaining: 0, unsaved: false, changedAt: [] };
    if (this.progress) return result;
    const { docs, meta, history } = this.deps;
    history?.markReplace(opId);
    const stored = (await meta.get(headerKey(opId))) as OpHeader | undefined;
    // Uno que ya no está en `meta` (quedó fuera de los últimos 5) pero sigue en la línea de tiempo: con lo guardado ahí.
    const saved = stored ? null : ((history?.replaceSaved(opId) ?? null) as SavedOp | null);
    const header = stored ?? saved?.header;
    if (!header) return result;
    const undonePages: string[] = [];
    this.stopRequested = false;
    this.progress = { kind: 'undo', done: 0, total: header.pages.length };
    this.current = opId;
    this.changed();
    try {
      for (const pageId of header.pages) {
        const record = saved
          ? saved.records[pageId] && { pageId, edits: saved.records[pageId], applied: true }
          : ((await meta.get(pageKey(opId, pageId))) as PageRecord | undefined);
        if (record) {
          const block = await this.blockOf(pageId, header.projectId);
          if (block) {
            result.remaining++;
          } else {
            let outcome: { block?: PageBlock; written?: boolean; undone?: boolean };
            try {
              outcome = await docs.edit(pageId, async (doc) => {
                const late = (await this.blockOf(pageId, header.projectId)) ?? this.docBlock(pageId, doc);
                if (late) return { block: late };
                // Con historia en la sesión: el paso de su pila de Yjs (vuelven las mismas letras; Doc_Deshacer.md, 3.3).
                const via = history?.popReplace(pageId, doc, opId, 'undo', inOrder) ?? 'none';
                if (via !== 'none') {
                  const n = record.edits.reduce((s, e) => s + e.count, 0);
                  if (via === 'done') {
                    result.undone += n;
                    return { written: true, undone: true };
                  }
                  // Nada que deshacer ahí (otro ya lo cambió todo) o Yjs no pudo: queda como está.
                  result.changed += n;
                  for (const e of record.edits) result.changedAt.push({ pageId, blockId: e.blockId });
                  return {};
                }
                const undo = planUndo(doc, record.edits);
                undo.outcomes.forEach((o, i) => {
                  const n = record.edits[i].count;
                  if (o === 'undone') result.undone += n;
                  else if (o === 'notApplied') result.notApplied += n;
                  else {
                    result.changed += n;
                    result.changedAt.push({ pageId, blockId: record.edits[i].blockId });
                  }
                });
                if (!undo.outcomes.includes('undone')) return {};
                const write = () => docs.applyLocal(pageId, doc, ORIGIN_REPLACE, undo.apply);
                // En orden, en una página que ahora tiene historia: entra en su pila (para rehacer con Yjs).
                if (history && inOrder) history.writeReplace(pageId, doc, opId, ORIGIN_REPLACE, write, 'undo');
                else write();
                return { written: true, undone: true };
              });
            } catch (err) {
              console.warn(`Undo replace failed on page ${pageId}`, err);
              outcome = { block: 'error' };
            }
            if (outcome.block) {
              result.remaining++;
            } else {
              if (outcome.undone) {
                undonePages.push(pageId);
                result.pages++;
              }
              if (outcome.written) {
                await docs.flush(pageId);
                if (!docs.isSaved(pageId)) {
                  result.unsaved = true;
                  result.remaining++;
                  break;
                }
              }
              await meta.delete(pageKey(opId, pageId));
            }
          }
        }
        this.progress = { kind: 'undo', done: this.progress.done + 1, total: this.progress.total };
        this.changed();
        await nextTask();
      }
      const left = await this.pagesLeft(opId);
      if (left === 0) await meta.delete(headerKey(opId));
      else await meta.put(headerKey(opId), { ...header, status: 'partial' } satisfies OpHeader);
      result.remaining = Math.max(result.remaining, left);
    } finally {
      // En orden: pasa a rehacer con las páginas deshechas. Fuera de orden: sale de la línea de tiempo.
      history?.settleReplace(opId, 'undo', undonePages, inOrder);
      this.progress = null;
      this.current = null;
      this.changed();
    }
    return result;
  }

  /**
   * Rehace un reemplazo deshecho con ⌘Z (⌘⇧Z o *Redo* del aviso): en las páginas con historia, la pila de Yjs; en las
   * demás, `planRedo` (lo nuevo vuelve solo donde entre las anclas sigue exactamente lo de antes). Vuelve a escribir su
   * registro en `meta`, igual que al reemplazar.
   */
  async redo(opId: string): Promise<RedoResult> {
    const result: RedoResult = { redone: 0, changed: 0, pages: 0, remaining: 0, unsaved: false };
    const { docs, meta, history } = this.deps;
    const saved = (history?.replaceSaved(opId) ?? null) as SavedOp | null;
    if (this.progress || !history || !saved) return result;
    const { header } = saved;
    const pages = history.replacePages(opId);
    const redonePages: string[] = [];
    this.stopRequested = false;
    this.progress = { kind: 'redo', done: 0, total: pages.length };
    this.current = opId;
    this.changed();
    try {
      for (const pageId of pages) {
        const edits = saved.records[pageId];
        if (edits) {
          const block = await this.blockOf(pageId, header.projectId);
          if (block) {
            result.remaining++;
          } else {
            let outcome: { block?: PageBlock; written?: boolean; redone?: boolean };
            try {
              outcome = await docs.edit(pageId, async (doc) => {
                const late = (await this.blockOf(pageId, header.projectId)) ?? this.docBlock(pageId, doc);
                if (late) return { block: late };
                const via = history.popReplace(pageId, doc, opId, 'redo', true);
                if (via !== 'none') {
                  const n = edits.reduce((s, e) => s + e.count, 0);
                  if (via === 'done') {
                    result.redone += n;
                    return { written: true, redone: true };
                  }
                  result.changed += n;
                  return {};
                }
                const redo = planRedo(doc, edits);
                redo.outcomes.forEach((o, i) => {
                  if (o === 'changed') result.changed += edits[i].count;
                  else result.redone += edits[i].count;
                });
                // Lo que ya estaba hecho cuenta como hecho (su registro vuelve igual).
                if (redo.outcomes.every((o) => o === 'changed')) return {};
                if (!redo.outcomes.includes('redone')) return { redone: true };
                history.writeReplace(pageId, doc, opId, ORIGIN_REPLACE, () => docs.applyLocal(pageId, doc, ORIGIN_REPLACE, redo.apply), 'redo');
                return { written: true, redone: true };
              });
            } catch (err) {
              console.warn(`Redo replace failed on page ${pageId}`, err);
              outcome = { block: 'error' };
            }
            if (outcome.block) {
              result.remaining++;
            } else if (outcome.redone) {
              if (outcome.written) {
                await docs.flush(pageId);
                if (!docs.isSaved(pageId)) {
                  result.unsaved = true;
                  result.remaining++;
                  break;
                }
              }
              await meta.put(pageKey(opId, pageId), { pageId, edits, applied: true } satisfies PageRecord);
              redonePages.push(pageId);
              result.pages++;
            }
          }
        }
        this.progress = { kind: 'redo', done: this.progress.done + 1, total: this.progress.total };
        this.changed();
        await nextTask();
      }
      // El encabezado vuelve (con *Undo* en el panel), con las páginas de siempre: las que no tienen su registro se saltean.
      if (redonePages.length > 0) await meta.put(headerKey(opId), { ...header, status: header.status === 'running' ? 'stopped' : header.status } satisfies OpHeader);
    } finally {
      history.settleReplace(opId, 'redo', redonePages, true);
      this.progress = null;
      this.current = null;
      this.changed();
    }
    return result;
  }

  private async pagesLeft(opId: string): Promise<number> {
    return (await this.deps.meta.keys(`${headerKey(opId)}:`)).length;
  }

  // --- La lista de los últimos ---------------------------------------------------------------------------------

  /**
   * Los últimos reemplazos del proyecto que se pueden deshacer, el más nuevo primero. El que está corriendo no: sus
   * cuentas están a medias (el avance se ve aparte).
   */
  async list(projectId: string): Promise<OpHeader[]> {
    const out: OpHeader[] = [];
    for (const key of await this.deps.meta.keys(REPLACE_PREFIX)) {
      if (key.slice(REPLACE_PREFIX.length).includes(':')) continue;
      const header = (await this.deps.meta.get(key)) as OpHeader | undefined;
      if (!header || header.projectId !== projectId || header.id === this.current) continue;
      // Uno que quedó "corriendo" y no es el de ahora: se cerró la app a la mitad.
      if (header.status === 'running' && header.id !== this.current) out.push({ ...header, status: 'stopped' });
      else out.push(header);
    }
    return out.sort((a, b) => b.at - a.at);
  }

  /** Deja los últimos `KEEP_PER_PROJECT` del proyecto de ese tipo (contando el nuevo). */
  private async prune(projectId: string, keep: string, scope: OpScope): Promise<void> {
    const old = (await this.list(projectId)).filter((h) => h.id !== keep && (h.scope ?? 'all') === scope).slice(KEEP_PER_PROJECT - 1);
    for (const header of old) {
      for (const key of await this.deps.meta.keys(`${headerKey(header.id)}:`)) await this.deps.meta.delete(key);
      await this.deps.meta.delete(headerKey(header.id));
    }
  }
}

/** `meta` de la base local, con las cuatro operaciones que usa el reemplazo. */
export function metaOf(db: {
  get(store: 'meta', key: string): Promise<unknown>;
  put(store: 'meta', value: unknown, key: string): Promise<unknown>;
  delete(store: 'meta', key: string): Promise<unknown>;
  getAllKeys(store: 'meta', range: IDBKeyRange): Promise<unknown[]>;
}): ReplaceMeta {
  return {
    get: (key) => db.get('meta', key),
    put: async (key, value) => {
      await db.put('meta', value, key);
    },
    delete: async (key) => {
      await db.delete('meta', key);
    },
    keys: async (prefix) => (await db.getAllKeys('meta', IDBKeyRange.bound(prefix, `${prefix}￿`))).map(String),
  };
}
