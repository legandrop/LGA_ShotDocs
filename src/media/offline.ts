import { stored as t } from '../i18n';
import type { DocState } from '../sync/localDb';
import type { MediaRemote } from '../sync/remote';
import type { PageRow, ProjectRow, MediaFileRow } from '../sync/types';
import { isNetworkError } from '../sync/types';
import { fileKind, isFolderMime } from './attachments';
import type { MediaDb, MediaRecord } from './mediaDb';
import {
  appendPart,
  cleanOrphans,
  copyReceived,
  DEFAULT_OPTIONS,
  deleteMark,
  dropCopy,
  getCopy,
  getRev,
  listCopies,
  listMarks,
  markGone,
  partKey,
  protects,
  putMark,
  putOfflineView,
  readCopy,
  touchCopy,
  type MarkFile,
  type OfflineMark,
  type OfflineOptions,
} from './offlineStore';
import { branchPages, estimateSharp, olderUrlsInDoc, wanted, weigh, type FileFacts, type Weights } from './offlinePlan';
import { PorteroError, type VerifyResult } from './portero';
import type { MediaQueue } from './queue';
import { mediaIdsInDoc } from './usage';
import type * as Y from 'yjs';

// "Available offline" y el tope del espacio en el dispositivo (Docs/Doc_Copias_Locales.md, D-25). Esta entrega
// (la 1) baja y mantiene al día lo marcado, y libera **solo** copias bajadas y nítidas, siempre después de un
// aviso con el sí de la persona. Los originales agregados en este dispositivo no se liberan acá (entrega 2): ni
// siquiera se arma su clave.

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;
/** El tope de fábrica de lo que se guarda automáticamente, por workspace (D-25). */
export const DEFAULT_LIMIT = 2 * GB;
/** Lo que se le ofrece elegir. `null`: sin tope (nunca avisa). */
export const LIMIT_CHOICES: (number | null)[] = [1 * GB, 2 * GB, 5 * GB, 10 * GB, 20 * GB, null];
/**
 * En el iPhone y el iPad, hasta medir con el disco casi lleno (sección 9.1), el total de lo marcado offline en todo
 * el dispositivo no pasa esto. Pendiente de Lega: se cambia acá.
 */
export const IOS_OFFLINE_TOTAL_MAX = 5 * GB;
/** Cada pedido de la bajada por partes. */
export const PART_BYTES = 16 * MB;
/** Cada cuánto se mira si algo de lo marcado cambió, con red. */
export const MAINTAIN_EVERY_MS = 10 * 60_000;
/** Cada cuánto se vuelven a bajar los comentarios de las páginas marcadas (sin la función por proyecto). */
export const COMMENTS_EVERY_MS = 6 * 60 * 60_000;
/** *Not now* calla el aviso del tope por esto. */
export const SNOOZE_MS = 24 * 60 * 60_000;
/** Lo que nunca usan las bajadas: lugar para fotos y videos nuevos (sección 5.7). */
export function reserveFor(quota: number): number {
  return Math.max(GB, Math.round(quota * 0.05));
}

const LIMIT_KEY = 'space:limit';
const ROLLOUT_KEY = 'space:rollout';
const SNOOZE_KEY = 'space:snooze';

/** Un archivo que hay que bajar (o hacer) para una marca. */
interface Item {
  id: string;
  what: 'orig' | 'view' | 'thumb' | 'older';
  /** Lo que va a ocupar (estimado para la nítida y lo viejo). */
  bytes: number;
  mime: string;
  size: number;
}

export interface MarkView {
  id: string;
  kind: 'page' | 'project';
  target: string;
  projectId: string;
  title: string;
  options: OfflineOptions;
  state: OfflineMark['state'];
  error: string | null;
  readyAt: number | null;
  /** Progreso de la bajada en curso (o de la última). */
  done: number;
  total: number;
  bytesDone: number;
  bytesTotal: number;
  /** Lo que ocupa en el dispositivo lo que pide. */
  bytes: number;
  /** Archivos que no están disponibles (sin permiso, borrados) o que todavía suben desde otro dispositivo. */
  unavailable: number;
  waitingFiles: number;
  /** Páginas que todavía no bajaron entero su contenido, y las que pide una versión más nueva de la app. */
  waitingPages: number;
  needsUpdate: number;
}

export interface Usage {
  /** Lo que se guarda automáticamente (cuenta para el tope): originales propios, copias y nítidas sin marcar. */
  kept: number;
  /** De eso, lo que esta entrega puede liberar (copias bajadas y nítidas sin marcar). */
  freeable: number;
  /** Originales propios que esperan subir (cuentan, no se liberan). */
  waiting: number;
  waitingCount: number;
  /** Lo que piden las marcas (no cuenta para el tope). */
  offline: number;
  /** Copias que Google Drive ya no tiene: pueden ser las únicas. */
  gone: { count: number; bytes: number; ids: string[] };
}

export interface SpacePrompt {
  /** `limit`: se pasó el tope; `mark`: una marca no tiene lugar. */
  reason: 'limit' | 'mark';
  /** Lo que ocupa lo guardado automáticamente y el tope. */
  kept: number;
  limit: number | null;
  /** Lo que se liberaría con el sí. */
  free: number;
  count: number;
  /** Lo que hacía falta (un archivo nuevo, una marca). */
  needed: number;
  /** La primera vez que aparece, la línea que presenta el tope. */
  first: boolean;
}

export interface OfflineSnapshot {
  loaded: boolean;
  marks: MarkView[];
  limit: number | null;
  usage: Usage | null;
  prompt: SpacePrompt | null;
  /** La marca que está bajando ahora. */
  active: string | null;
  /** Archivos nuevos que no entraron en el dispositivo: se ofrece guardarlos para no perderlos. */
  unsaved: { name: string; size: number }[];
}

/** Lo que se calcula para la ventana de marcar, por partes (el indicador circular espera cada una). */
export interface PlanState {
  pages: number;
  files: number;
  /** Ya se miró lo que hay en el dispositivo y lo que dice la base. */
  local: boolean;
  remote: boolean;
  weights: Weights;
  waitingPages: number;
  needsUpdate: number;
  /** Lo que ya ocupa todo lo marcado (para mostrar con el tope antes de activar). */
  offlineBytes: number;
}

export interface OfflineDeps {
  db: MediaDb | null;
  media: MediaQueue;
  tree: {
    get(id: string): PageRow | undefined;
    children(id: string | null): PageRow[];
    roots(projectId: string): PageRow[];
    isTrashed(id: string): boolean;
    project(id: string): ProjectRow | undefined;
    projects(): ProjectRow[];
    hasUnsentCreate(pageId: string): boolean;
  };
  docs: {
    states(): Promise<Map<string, DocState>>;
    snapshot(pageId: string): Promise<{ doc: Y.Doc; state: DocState; supported: boolean }>;
  };
  remote: Pick<MediaRemote, 'fetchMediaFiles'>;
  comments?: { refresh(pageId: string): Promise<void> };
  older?: { ensureStored(url: string): Promise<boolean>; isStored(url: string): Promise<boolean> };
  online: () => boolean;
  /** Otra cola está subiendo (las carpetas, P.9): las bajadas esperan, como con la cola de fotos y videos. */
  uploadsBusy?: () => boolean;
  /** `fetch` para bajar con los pases (las pruebas usan el portero en memoria). */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  storage?: () => Pick<StorageManager, 'estimate' | 'persist' | 'persisted'> | undefined;
  now?: () => number;
  /** Safari guarda la nítida en JPEG (más pesada): cambia el estimado. */
  safari?: boolean;
  /** iPhone o iPad: el tope fijo del total marcado (sección 9.1). */
  ios?: boolean;
  /** Teléfono o tableta: la nítida se hace de a una (memoria). */
  phone?: boolean;
  /** Para el total marcado de todo el dispositivo (`localStorage`, `sd:offline:<base>`). */
  dbName: string;
  local?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'> | null;
}

/** El navegador se quedó sin lugar al escribir (`QuotaExceededError`, o el `UnknownError` de Safari con el disco lleno). */
export function isNoSpace(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'QuotaExceededError' || err.name === 'UnknownError');
}

class NoSpaceError extends Error {}
class StoppedError extends Error {}

/** La respuesta de error del portero, con su `code` (nunca se decide por el número). */
async function porteroCode(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { code?: unknown };
    return typeof body.code === 'string' ? body.code : undefined;
  } catch {
    return undefined;
  }
}

/** Están todas las partes que la entrada dice tener. */
async function partsPresent(db: MediaDb, entry: { id: string; orig?: { parts: { n: number }[] } }): Promise<boolean> {
  for (const p of entry.orig?.parts ?? []) if (!(await db.getKey('blobs', partKey(entry.id, p.n)))) return false;
  return true;
}

function parseContentRange(value: string | null): { start: number; end: number; total: number } | null {
  const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value ?? '');
  return m ? { start: Number(m[1]), end: Number(m[2]), total: Number(m[3]) } : null;
}

export class OfflineManager {
  private readonly listeners = new Set<() => void>();
  private snapshot: OfflineSnapshot = { loaded: false, marks: [], limit: DEFAULT_LIMIT, usage: null, prompt: null, active: null, unsaved: [] };
  private readonly now: () => number;
  private readonly progress = new Map<string, { done: number; total: number; bytesDone: number; bytesTotal: number; unavailable: number; waiting: number; pages: number; update: number }>();
  /** Lo abierto en esta sesión: no se libera (un video que se está mirando desde un `blob:`). */
  private readonly opened = new Set<string>();
  private readonly touched = new Map<string, number>();
  private pumping: Promise<void> | null = null;
  private again = false;
  private stopped = false;
  private controller: AbortController | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private maintainTimer: ReturnType<typeof setTimeout> | null = null;
  /** Lo que pidió liberar "sin lugar" para un archivo nuevo (se ofrece en el aviso). */
  /** Lo bajado en esta vuelta, que `localStorage` todavía no cuenta (el tope del iPhone, sección 9.1). */
  private written = 0;
  /** Cuándo se miró por última vez cada marca entera, y con qué conjunto (para no consultar todo en cada vuelta). */
  private readonly checked = new Map<string, { signature: string; at: number }>();
  private features: string[] | null = null;
  private readonly cleanups: (() => void)[] = [];

  constructor(private readonly deps: OfflineDeps) {
    this.now = deps.now ?? Date.now;
  }

  // --- para la interfaz --------------------------------------------------------------------------------

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): OfflineSnapshot => this.snapshot;

  private set(changes: Partial<OfflineSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...changes };
    for (const fn of this.listeners) fn();
  }

  get available(): boolean {
    return !!this.deps.db && this.deps.media.enabled;
  }

  // --- arranque -------------------------------------------------------------------------------------------

  /** Lee las marcas y el tope, limpia partes huérfanas y estrena la versión (sección 5.6). */
  async load(): Promise<void> {
    const db = this.deps.db;
    if (!db) return this.set({ loaded: true });
    if ((await db.get('meta', ROLLOUT_KEY)) === undefined) await db.put('meta', this.now(), ROLLOUT_KEY);
    await cleanOrphans(db).catch(() => 0);
    await this.refresh();
    this.set({ loaded: true });
  }

  /** Empieza a mirar: cada tanto y cuando se agrega algo para subir (se corta la bajada en curso). */
  start(): void {
    this.cleanups.push(
      this.deps.media.subscribeQueued(() => {
        // Subir le gana a bajar: la parte en vuelo se corta y se sigue desde la última guardada.
        this.controller?.abort();
      }),
    );
    this.timer = setInterval(() => this.maintainSoon(), MAINTAIN_EVERY_MS);
    this.maintainSoon(2000);
  }

  /** Otra cola empezó a subir (las carpetas): se corta la parte en vuelo y se sigue cuando termine. */
  yieldToUploads(): void {
    this.controller?.abort();
  }

  stop(): void {
    this.stopped = true;
    this.controller?.abort();
    if (this.timer) clearInterval(this.timer);
    if (this.maintainTimer) clearTimeout(this.maintainTimer);
    for (const c of this.cleanups.splice(0)) c();
  }

  /** Después de una sincronización (o de que volvió la red): mira lo marcado en un ratito. */
  maintainSoon(delay = 1500): void {
    if (this.stopped || !this.deps.db) return;
    if (this.maintainTimer) clearTimeout(this.maintainTimer);
    this.maintainTimer = setTimeout(() => {
      this.maintainTimer = null;
      void this.maintain().catch(() => undefined);
    }, delay);
  }

  // --- el uso (sección 5.5) ---------------------------------------------------------------------------------

  /** La cola avisa que se mostró o abrió un archivo. */
  used(id: string, how: 'show' | 'open'): void {
    const key = id.toLowerCase();
    if (how === 'open') this.opened.add(key);
    const day = Math.floor(this.now() / 86_400_000);
    if (this.touched.get(key) === day) return;
    this.touched.set(key, day);
    if (this.deps.db) void touchCopy(this.deps.db, key, this.now()).catch(() => undefined);
  }

  /**
   * No entra un archivo nuevo (sección 5.7): antes de rechazarlo se libera lo que se rehace o ya está en Drive (las
   * nítidas de la página y las copias bajadas que ninguna marca pide), sin preguntar, para que una foto recién
   * sacada no se pierda. Nunca lo marcado, lo `gone`, lo abierto en la sesión ni un original propio. Devuelve lo
   * liberado; la cola vuelve a probar.
   */
  async makeRoom(bytes: number): Promise<number> {
    const freed = await this.freeBytes(bytes + 200 * MB);
    await this.refresh().catch(() => undefined);
    return freed;
  }

  /**
   * Un archivo nuevo que igual no entró: se guarda en memoria para ofrecer bajarlo o compartirlo ("Guardar imagen"
   * en el iPhone), así no se pierde una foto de "Tomar foto", que no queda en la fototeca.
   */
  rejected(file: Blob & { name?: string }): void {
    this.unsaved.push(file);
    this.set({ unsaved: this.unsaved.map((f) => ({ name: f.name ?? '', size: f.size })) });
  }

  /** El archivo que no entró, para guardarlo (y sacarlo de la lista). */
  takeUnsaved(index: number): (Blob & { name?: string }) | null {
    const [file] = this.unsaved.splice(index, 1);
    this.set({ unsaved: this.unsaved.map((f) => ({ name: f.name ?? '', size: f.size })) });
    return file ?? null;
  }

  peekUnsaved(index: number): (Blob & { name?: string }) | null {
    return this.unsaved[index] ?? null;
  }

  private readonly unsaved: (Blob & { name?: string })[] = [];

  // --- el tope ------------------------------------------------------------------------------------------

  async setLimit(limit: number | null): Promise<void> {
    if (!this.deps.db) return;
    await this.deps.db.put('meta', limit === null ? 'none' : limit, LIMIT_KEY);
    await this.refresh();
  }

  /** *Not now*: el aviso se calla un día. */
  async snooze(): Promise<void> {
    if (!this.deps.db) return;
    await this.deps.db.put('meta', this.now() + SNOOZE_MS, SNOOZE_KEY);
    this.set({ prompt: null });
  }

  private async limit(): Promise<number | null> {
    const saved = this.deps.db ? await this.deps.db.get('meta', LIMIT_KEY) : undefined;
    if (saved === 'none') return null;
    if (typeof saved === 'number' && saved > 0) return saved;
    // De fábrica, 2 GB; con un navegador que le da poco a la app, la mitad de lo que le da.
    const quota = (await this.estimate())?.quota ?? 0;
    return quota > 0 ? Math.min(DEFAULT_LIMIT, Math.floor(quota / 2)) : DEFAULT_LIMIT;
  }

  private async estimate(): Promise<StorageEstimate | null> {
    try {
      return (await this.deps.storage?.()?.estimate()) ?? null;
    } catch {
      return null;
    }
  }

  /** Cuánto ocupa cada cosa, con las sumas propias (no con `estimate()`, que tarda en bajar). */
  async usage(): Promise<Usage> {
    const db = this.deps.db;
    const out: Usage = { kept: 0, freeable: 0, waiting: 0, waitingCount: 0, offline: 0, gone: { count: 0, bytes: 0, ids: [] } };
    if (!db) return out;
    const marks = await listMarks(db);
    const records = (await db.getAll('files')) as MediaRecord[];
    for (const r of records) {
      if (!(await db.getKey('blobs', r.id))) continue;
      if (r.pending === 1) {
        out.waiting += r.size;
        out.waitingCount++;
        out.kept += r.size;
      } else if (protects(marks, r.id).orig) {
        out.offline += r.size;
      } else {
        out.kept += r.size;
      }
    }
    for (const e of await listCopies(db)) {
      const p = protects(marks, e.id);
      const orig = e.orig ? copyReceived(e) : 0;
      const view = e.view?.bytes ?? 0;
      if (e.gone) {
        out.gone.count++;
        out.gone.bytes += orig + view;
        out.gone.ids.push(e.id);
        continue;
      }
      for (const [bytes, kept] of [
        [orig, !p.orig],
        [view, !p.view],
      ] as const) {
        if (!bytes) continue;
        if (kept) {
          out.kept += bytes;
          if (!this.opened.has(e.id)) out.freeable += bytes;
        } else {
          out.offline += bytes;
        }
      }
    }
    const views = await this.deps.media.viewBytes();
    out.kept += views;
    out.freeable += views;
    return out;
  }

  /** Vuelve a contar y decide si hay que avisar (nunca libera nada sola). */
  async refresh(): Promise<void> {
    const db = this.deps.db;
    if (!db) return;
    // Lo bajado mientras se cuenta puede no estar en `usage`: se descuenta solo lo de antes (si se equivoca, cuenta de
    // más, nunca de menos, para el tope del iPhone).
    const writtenBefore = this.written;
    const [usage, limit, marks] = await Promise.all([this.usage(), this.limit(), listMarks(db)]);
    let prompt: SpacePrompt | null = null;
    const snoozed = ((await db.get('meta', SNOOZE_KEY)) as number | undefined) ?? 0;
    const first = (await db.get('meta', 'space:prompted')) === undefined;
    if (limit !== null && usage.kept > limit && usage.freeable > 0 && this.now() >= snoozed) {
      const free = Math.min(usage.freeable, usage.kept - Math.floor(limit * 0.9));
      prompt = { reason: 'limit', kept: usage.kept, limit, free, count: 0, needed: 0, first };
    }
    const stopped = marks.find((m) => m.state === 'noSpace');
    if (!prompt && stopped && usage.freeable > 0 && this.now() >= snoozed) {
      prompt = { reason: 'mark', kept: usage.kept, limit, free: usage.freeable, count: 0, needed: 0, first };
    }
    if (prompt && first) await db.put('meta', this.now(), 'space:prompted');
    // Lo bajado antes de contar ya está en `usage.offline`.
    this.written = Math.max(0, this.written - writtenBefore);
    this.saveDeviceTotal(usage.offline);
    this.set({ usage, limit, prompt, marks: marks.map((m) => this.view(m, usage)) });
  }

  private view(mark: OfflineMark, _usage: Usage): MarkView {
    const p = this.progress.get(mark.id);
    return {
      id: mark.id,
      kind: mark.kind,
      target: mark.target,
      projectId: mark.projectId,
      title: this.titleOf(mark),
      options: mark.options,
      state: mark.state,
      error: mark.error,
      readyAt: mark.readyAt,
      done: p?.done ?? 0,
      total: p?.total ?? 0,
      bytesDone: p?.bytesDone ?? 0,
      bytesTotal: p?.bytesTotal ?? 0,
      bytes: this.markBytes.get(mark.id) ?? 0,
      unavailable: p?.unavailable ?? 0,
      waitingFiles: p?.waiting ?? 0,
      waitingPages: p?.pages ?? 0,
      needsUpdate: p?.update ?? 0,
    };
  }

  private readonly markBytes = new Map<string, number>();

  private titleOf(mark: OfflineMark): string {
    if (mark.kind === 'project') return this.deps.tree.project(mark.target)?.name ?? mark.title;
    return this.deps.tree.get(mark.target)?.title || mark.title;
  }

  /**
   * Libera, con el sí de la persona, lo guardado automáticamente: primero las nítidas de la página (se rehacen
   * solas) y después las copias bajadas y las nítidas de marcas que ya no se piden, de la que hace más que no se
   * abre a la más reciente. `over`: hasta bajar al 90 % del tope; `room`: lo que hacía falta para un archivo
   * nuevo; `all`: todo (*Free up space*). Nunca toca lo marcado, lo `gone`, lo abierto en esta sesión ni un
   * original propio. Devuelve lo liberado.
   */
  async freeUp(mode: 'over' | 'all'): Promise<number> {
    const usage = await this.usage();
    const limit = await this.limit();
    const goal = mode === 'all' ? Infinity : limit === null ? 0 : usage.kept - Math.floor(limit * 0.9);
    const freed = await this.freeBytes(goal);
    // Una marca que se detuvo por falta de lugar vuelve a probar.
    const db = this.deps.db;
    if (db) for (const m of await listMarks(db)) if (m.state === 'noSpace') await putMark(db, { ...m, state: 'downloading', error: null });
    await this.refresh();
    this.kick();
    return freed;
  }

  /**
   * Lo que se ofrecería liberar, en orden (de la que hace más que no se abre a la más reciente): para "Show what".
   * Las nítidas de la página van en una sola línea (`id` vacío).
   */
  async candidates(): Promise<{ id: string; name: string; bytes: number; usedAt: number | null }[]> {
    const db = this.deps.db;
    if (!db) return [];
    const marks = await listMarks(db);
    const out: { id: string; name: string; bytes: number; usedAt: number | null }[] = [];
    const views = await this.deps.media.viewBytes();
    if (views > 0) out.push({ id: '', name: '', bytes: views, usedAt: null });
    const copies = (await listCopies(db)).filter((e) => !e.gone && !this.opened.has(e.id)).sort((a, b) => a.usedAt - b.usedAt);
    for (const e of copies) {
      const p = protects(marks, e.id);
      const bytes = (e.orig && !p.orig ? copyReceived(e) : 0) + (e.view && !p.view ? e.view.bytes : 0);
      if (bytes === 0) continue;
      const known = await db.get('known', e.id);
      out.push({ id: e.id, name: known?.name ?? e.id, bytes, usedAt: e.usedAt });
    }
    return out;
  }

  /** Libera hasta `goal` bytes de lo que se puede (ver `freeUp`). */
  private async freeBytes(goal: number): Promise<number> {
    const db = this.deps.db;
    if (!db || !(goal > 0)) return 0;
    let freed = await this.deps.media.trimViews(goal);
    goal -= freed;
    if (goal > 0) {
      const rev = await getRev(db);
      const marks = await listMarks(db);
      const copies = (await listCopies(db))
        .filter((e) => !e.gone && !this.opened.has(e.id))
        .filter((e) => {
          const p = protects(marks, e.id);
          return (e.orig && !p.orig) || (e.view && !p.view);
        })
        .sort((a, b) => a.usedAt - b.usedAt);
      // Una copia bajada se libera si la base dice que sigue en Drive (fuera de las papeleras). Sin red se usa
      // lo último que se supo; algo en una papelera puede ser la última copia y no se libera.
      const inDrive = await this.stillInDrive(copies.map((c) => c.id));
      // Con un portero que lo sabe, además se le pregunta a Drive (sin caché) antes de borrar una copia entera:
      // si Drive ya no lo tiene, la copia puede ser la única y queda `gone` (nunca se borra sola).
      const drive = await this.askDrive(copies.filter((c) => c.orig && inDrive.has(c.id)).map((c) => c.id));
      for (const entry of copies) {
        if (goal <= 0) break;
        if (entry.orig && (!inDrive.has(entry.id) || (drive && !drive.has(entry.id)))) {
          // La copia entera se queda; su nítida sí se puede liberar (se rehace de esa copia).
          if (!entry.view) continue;
          const bytes = await dropCopy(db, entry.id, { rev, what: 'view' });
          freed += bytes;
          goal -= bytes;
          continue;
        }
        // Una nítida sola se rehace del original: solo si sigue en Drive (o está el original propio). Si no, esa
        // 2048 puede ser lo mejor que queda de la foto.
        if (!entry.orig && !inDrive.has(entry.id) && !(await db.getKey('blobs', entry.id))) continue;
        const bytes = await dropCopy(db, entry.id, { rev });
        freed += bytes;
        goal -= bytes;
      }
    }
    return freed;
  }

  private async stillInDrive(ids: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    if (ids.length === 0) return out;
    try {
      if (!this.deps.online()) throw new Error('offline');
      const rows = await this.deps.remote.fetchMediaFiles(ids);
      await this.deps.media.learn(rows);
      for (const r of rows) if (r.drive_id && !r.trashed_at && !r.purged_at && !r.drive_trashed_at) out.add(r.id);
    } catch {
      for (const id of ids) {
        const known = await this.deps.db!.get('known', id);
        // Sin red, solo lo anotado como fuera de las dos papeleras (sin el dato de la de la app, no se sabe).
        if (known?.driveId && !known.deleted && known.inAppTrash === false) out.add(id);
      }
    }
    return out;
  }

  /**
   * `/verify` (si el portero lo anuncia y hay red): los que Drive tiene hoy, fuera de su papelera y con la marca de
   * ese archivo. Los que Drive ya no tiene quedan `gone`. `null`: no se pudo preguntar (se decide con la base).
   */
  private async askDrive(ids: string[]): Promise<Set<string> | null> {
    if (ids.length === 0 || !this.deps.online() || !(await this.hasFeature('verify'))) return null;
    let results: Record<string, VerifyResult>;
    try {
      results = await this.deps.media.verify(ids);
    } catch {
      return null;
    }
    const ok = new Set<string>();
    for (const id of ids) {
      const r = results[id];
      if (!r) continue;
      if ('code' in r) {
        if (r.code === 'drive_missing') await markGone(this.deps.db!, id, this.now());
        continue;
      }
      if (!r.trashed && r.marked) ok.add(id);
    }
    return ok;
  }

  /** Las copias que Google Drive ya no tiene (a mano, con el aviso de "única copia"). */
  async removeGone(ids: string[]): Promise<number> {
    const db = this.deps.db;
    if (!db) return 0;
    let freed = 0;
    for (const id of ids) freed += await dropCopy(db, id, { allowGone: true, ignoreMarks: true });
    await this.refresh();
    return freed;
  }

  /** La copia que puede ser la única, para guardarla en la computadora. */
  goneCopy(id: string): Promise<Blob | null> {
    return this.deps.db ? readCopy(this.deps.db, id) : Promise.resolve(null);
  }

  // --- marcar ---------------------------------------------------------------------------------------

  /** La marca que cubre esta página (ella o una de arriba) o este proyecto. */
  markFor(kind: 'page' | 'project', target: string): MarkView | null {
    const marks = this.snapshot.marks;
    const exact = marks.find((m) => m.kind === kind && m.target === target);
    if (exact) return exact;
    if (kind === 'page') {
      const row = this.deps.tree.get(target);
      const ancestors = new Set<string>();
      for (let p = row; p?.parent_id; p = this.deps.tree.get(p.parent_id)) ancestors.add(p.parent_id);
      return marks.find((m) => (m.kind === 'project' && m.target === row?.workspace_id) || (m.kind === 'page' && ancestors.has(m.target))) ?? null;
    }
    return null;
  }

  /**
   * Los pesos para la ventana, por partes: primero lo que se sabe en el dispositivo (sin red) y después lo que dice
   * la base. Cada parte llama a `onUpdate`.
   */
  async plan(kind: 'page' | 'project', target: string, onUpdate: (state: PlanState) => void, signal?: AbortSignal): Promise<PlanState> {
    const scan = await this.scan(kind, target, null);
    const ids = Object.keys(scan.files);
    const usage = this.snapshot.usage ?? (await this.usage());
    const base = { pages: scan.pages.length, files: ids.length, waitingPages: scan.waitingPages, needsUpdate: scan.needsUpdate, offlineBytes: usage.offline };
    let facts = await this.facts(ids, null);
    const older = await this.olderMissing(scan.older);
    const safari = !!this.deps.safari;
    let state: PlanState = { ...base, local: true, remote: false, weights: weigh(facts, older, safari) };
    if (!signal?.aborted) onUpdate(state);
    let rows: MediaFileRow[] | null = null;
    if (this.deps.online()) {
      rows = await this.deps.remote.fetchMediaFiles(ids).catch(() => null);
      if (rows) await this.deps.media.learn(rows);
    }
    facts = await this.facts(ids, rows);
    state = { ...base, local: true, remote: true, weights: weigh(facts, older, safari) };
    if (!signal?.aborted) onUpdate(state);
    return state;
  }

  private async olderMissing(urls: string[]): Promise<number> {
    if (!this.deps.older) return 0;
    let n = 0;
    for (const url of urls) if (!(await this.deps.older.isStored(url).catch(() => false))) n++;
    return n;
  }

  /** Marca una página (con sus subpáginas) o un proyecto y empieza a bajar. */
  async mark(kind: 'page' | 'project', target: string, options: OfflineOptions = DEFAULT_OPTIONS): Promise<string> {
    const db = this.deps.db;
    if (!db) throw new Error('unavailable');
    const existing = (await listMarks(db)).find((m) => m.kind === kind && m.target === target);
    const projectId = kind === 'project' ? target : (this.deps.tree.get(target)?.workspace_id ?? '');
    const title = kind === 'project' ? (this.deps.tree.project(target)?.name ?? '') : (this.deps.tree.get(target)?.title ?? '');
    const mark: OfflineMark = existing
      ? { ...existing, options: { ...options }, state: 'downloading', error: null }
      : {
          id: crypto.randomUUID(),
          kind,
          target,
          projectId,
          title,
          options: { ...options },
          createdAt: this.now(),
          pages: {},
          files: {},
          state: 'downloading',
          error: null,
          readyAt: null,
          commentsAt: null,
        };
    const scan = await this.scan(kind, target, mark);
    await putMark(db, { ...mark, pages: scan.pagesRead, files: scan.files, older: scan.older });
    this.progress.set(mark.id, { done: 0, total: 0, bytesDone: 0, bytesTotal: 0, unavailable: 0, waiting: 0, pages: scan.waitingPages, update: scan.needsUpdate });
    // Que el navegador no borre lo bajado si le falta lugar (en Safari, además, la app instalada).
    void Promise.resolve(this.deps.storage?.()?.persist?.()).catch(() => false);
    await this.refresh();
    this.kick();
    return mark.id;
  }

  /** Desmarca. Con `removeCopies`, borra en el acto las copias que ninguna otra marca pide (nunca lo `gone`). */
  async unmark(markId: string, removeCopies: boolean): Promise<void> {
    const db = this.deps.db;
    if (!db) return;
    const mark = (await listMarks(db)).find((m) => m.id === markId);
    if (!mark) return;
    if (this.snapshot.active === markId) this.controller?.abort();
    await deleteMark(db, markId);
    this.progress.delete(markId);
    if (removeCopies) {
      // Las otras marcas se leen de nuevo adentro de cada borrado: lo que piden, queda.
      for (const id of Object.keys(mark.files)) {
        await dropCopy(db, id).catch(() => 0);
        await this.dropPartial(id);
      }
    }
    await this.refresh();
  }

  /** Una copia a medio bajar (sin terminar) no sirve: se borra. */
  private async dropPartial(id: string): Promise<void> {
    const db = this.deps.db!;
    const entry = await getCopy(db, id);
    if (entry?.orig && !entry.orig.complete) await dropCopy(db, id, { ignoreMarks: true, what: 'orig' }).catch(() => 0);
  }

  /** *Update now* o *Try again*: vuelve a mirar todo y baja lo que falte. */
  async update(markId: string): Promise<void> {
    const db = this.deps.db;
    if (!db) return;
    const mark = (await listMarks(db)).find((m) => m.id === markId);
    if (!mark) return;
    await putMark(db, { ...mark, state: 'downloading', error: null, commentsAt: null });
    await this.maintain();
  }

  // --- leer la rama ----------------------------------------------------------------------------------------

  /**
   * Lee las páginas de la rama y arma el conjunto de archivos (sección 3.1): una página completa y legible deja lo
   * que usa hoy (quita lo que ya no); una incompleta, sin contenido o ilegible solo suma. `mark` en `null`: solo
   * para pesar (sin conjunto anterior).
   */
  private async scan(
    kind: 'page' | 'project',
    target: string,
    mark: OfflineMark | null,
  ): Promise<{
    pages: string[];
    pagesRead: Record<string, number>;
    files: Record<string, MarkFile>;
    older: string[];
    waitingPages: number;
    needsUpdate: number;
    vanished: string[];
  }> {
    const tree = this.deps.tree;
    const pages = branchPages(tree, kind, target);
    const inBranch = new Set(pages);
    const states = await this.deps.docs.states();
    const files: Record<string, MarkFile> = {};
    const pagesRead: Record<string, number> = {};
    const older = new Set(mark?.older ?? []);
    let waitingPages = 0;
    let needsUpdate = 0;
    // Lo de antes, sin las páginas que salieron de la rama.
    const vanished: string[] = [];
    for (const [id, f] of Object.entries(mark?.files ?? {})) {
      const keep = f.pages.filter((p) => inBranch.has(p));
      // Una página que ya no está en el árbol (permiso quitado, proyecto borrado): sus archivos quedan para
      // comprobarlos con el portero antes de borrar sus copias (sección 4).
      if (keep.length === 0 && f.pages.some((p) => !tree.get(p))) vanished.push(id);
      if (keep.length > 0) files[id] = { ...f, pages: keep };
    }
    for (const pageId of pages) {
      const row = tree.get(pageId);
      if (!row) continue;
      const state = states.get(pageId);
      // Una página sin contenido en el servidor (`update_seq` 0) que nunca se abrió no tiene nada que bajar.
      const complete = (state ? state.cursor >= row.update_seq : row.update_seq === 0) && !state?.unreadable;
      const local = tree.hasUnsentCreate(pageId);
      if (mark && (complete || local) && mark.pages[pageId] === row.update_seq) {
        // Ya leída con este contenido: queda lo que había.
        pagesRead[pageId] = row.update_seq;
        continue;
      }
      let ids: Set<string> | null = null;
      let urls: string[] = [];
      let supported = true;
      try {
        const snap = await this.deps.docs.snapshot(pageId);
        try {
          ids = mediaIdsInDoc(snap.doc);
          urls = olderUrlsInDoc(snap.doc);
          supported = snap.supported;
        } finally {
          snap.doc.destroy();
        }
      } catch {
        ids = null;
      }
      for (const url of urls) older.add(url);
      const full = (complete || local) && supported && ids !== null;
      if (!full) {
        if (state?.unreadable || !supported) needsUpdate++;
        else waitingPages++;
      }
      if (full) {
        // Lo que esta página ya no usa sale de su parte del conjunto.
        for (const [id, f] of Object.entries(files)) {
          if (!f.pages.includes(pageId) || ids!.has(id)) continue;
          const rest = f.pages.filter((p) => p !== pageId);
          if (rest.length === 0) delete files[id];
          else files[id] = { ...f, pages: rest };
        }
        pagesRead[pageId] = row.update_seq;
      }
      for (const id of ids ?? []) {
        const f = files[id];
        files[id] = f ? { ...f, pages: f.pages.includes(pageId) ? f.pages : [...f.pages, pageId] } : { pages: [pageId], kind: 'file', size: null };
      }
    }
    // El tipo y el peso de cada archivo, de lo que ya se sabe (la base, después).
    const db = this.deps.db;
    if (db) {
      const unknown: string[] = [];
      for (const [id, f] of Object.entries(files)) {
        const own = await db.get('files', id);
        const known = own ? null : await db.get('known', id);
        const meta = own ?? known;
        if (meta) files[id] = { ...f, kind: fileKind(meta.mime, meta.name), size: typeof meta.size === 'number' ? meta.size : f.size };
        if (!meta || typeof meta.size !== 'number') unknown.push(id);
      }
      // Lo que el dispositivo todavía no sabe, a la base (el tipo decide qué casilla lo protege).
      if (unknown.length > 0 && this.deps.online()) {
        const rows = await this.deps.remote.fetchMediaFiles(unknown).catch(() => [] as MediaFileRow[]);
        await this.deps.media.learn(rows);
        for (const row of rows) {
          const f = files[row.id];
          if (f) files[row.id] = { ...f, kind: fileKind(row.mime, row.name), size: row.size ?? f.size };
        }
      }
    }
    return { pages, pagesRead, files, older: [...older], waitingPages, needsUpdate, vanished };
  }

  /** Lo que se sabe de cada archivo (del dispositivo y, con `rows`, de la base). */
  private async facts(ids: string[], rows: MediaFileRow[] | null): Promise<FileFacts[]> {
    const db = this.deps.db;
    if (!db) return [];
    const byId = new Map((rows ?? []).map((r) => [r.id, r]));
    const out: FileFacts[] = [];
    for (const id of ids) {
      const own = await db.get('files', id);
      const known = await db.get('known', id);
      const row = byId.get(id);
      const meta = row ?? own ?? known;
      if (!meta) {
        out.push({ id, kind: 'file', mime: '', size: null, width: null, height: null, inDrive: false, deleted: false, ownBlob: false, copy: false, offview: false, view2048: false, thumb: false, thumbAt: false });
        continue;
      }
      // Una carpeta (P.9) no tiene original que bajar: lo de adentro está en Drive y es la casilla *Drive folders*
      // (entrega 3). No pesa en ninguna fila ni se pide un pase (el portero responde `is_folder`).
      if (isFolderMime(meta.mime)) continue;
      const entry = await getCopy(db, id);
      const size = row ? (row.size ?? null) : own ? own.size : (known?.size ?? null);
      out.push({
        id,
        kind: fileKind(meta.mime, meta.name),
        mime: meta.mime,
        size,
        width: meta.width ?? null,
        height: meta.height ?? null,
        inDrive: row ? !!row.drive_id : own ? !!own.driveId : !!known?.driveId,
        deleted: row ? !!(row.purged_at || row.drive_trashed_at) : !!known?.deleted,
        ownBlob: !!own && !!(await db.getKey('blobs', id)),
        // Una copia que dice estar completa pero perdió una parte no cuenta: se vuelve a bajar.
        copy: !!entry?.orig?.complete && (await partsPresent(db, entry)),
        offview: !!entry?.view,
        view2048: !!(await db.getKey('thumbs', `view:${id}`)),
        thumb: !!(await db.getKey('thumbs', id)),
        thumbAt: row ? !!row.thumb_at : own ? own.thumb === 'done' : !!known?.thumbAt,
      });
    }
    return out;
  }

  // --- mantener al día y bajar -------------------------------------------------------------------------

  /** Relee lo marcado que cambió y baja lo que falte (sección 3.6). */
  async maintain(): Promise<void> {
    const db = this.deps.db;
    if (!db || this.stopped) return;
    const marks = await listMarks(db);
    const projectsKnown = this.deps.tree.projects().length > 0;
    for (const mark of marks) {
      const gone =
        projectsKnown &&
        (mark.kind === 'project' ? !this.deps.tree.project(mark.target) : !this.deps.tree.get(mark.target));
      if (gone) {
        await this.forgetRemoved(mark);
        continue;
      }
      const scan = await this.scan(mark.kind, mark.target, mark);
      const latest = (await listMarks(db)).find((m) => m.id === mark.id);
      if (!latest) continue;
      await putMark(db, { ...latest, pages: scan.pagesRead, files: scan.files, older: scan.older });
      const p = this.progress.get(mark.id);
      this.progress.set(mark.id, {
        ...(p ?? { done: 0, total: 0, bytesDone: 0, bytesTotal: 0, unavailable: 0, waiting: 0 }),
        pages: scan.waitingPages,
        update: scan.needsUpdate,
      });
      await this.checkVanished(scan.vanished);
    }
    await this.refresh();
    this.kick();
  }

  /**
   * El proyecto o la página marcada ya no está en el árbol (permiso quitado o proyecto borrado): la marca se saca
   * (al volver, vuelve como online: D-25) y sus copias bajadas se borran solo si el portero confirma `not_found`.
   */
  private async forgetRemoved(mark: OfflineMark): Promise<void> {
    const db = this.deps.db!;
    await deleteMark(db, mark.id);
    this.progress.delete(mark.id);
    await this.checkVanished(Object.keys(mark.files));
  }

  /**
   * Archivos que salieron de lo marcado porque sus páginas dejaron de estar en el árbol: con la señal explícita del
   * portero (`not_found`), sus copias bajadas se borran (sección 4). Sin respuesta o con otro código, quedan como
   * están (pasan a contar para el tope). Nunca lo `gone` ni un original propio.
   */
  private async checkVanished(ids: string[]): Promise<void> {
    const db = this.deps.db!;
    if (ids.length === 0 || !this.deps.online() || !(await this.hasFeature('codes'))) return;
    const marks = await listMarks(db);
    for (const id of ids) {
      if (Object.values(marks).some((m) => m.files[id])) continue;
      if (!(await getCopy(db, id))) continue;
      try {
        await this.deps.media.pass(id);
      } catch (err) {
        if (err instanceof PorteroError && err.code === 'not_found') await dropCopy(db, id).catch(() => 0);
      }
    }
  }

  private async hasFeature(name: string): Promise<boolean> {
    if (!this.features) this.features = await this.deps.media.features().catch(() => null);
    return !!this.features?.includes(name);
  }

  /** Arranca la bajada si no está corriendo (si está, otra vuelta apenas termine). */
  kick(): void {
    if (this.stopped || !this.deps.db) return;
    if (this.pumping) {
      this.again = true;
      return;
    }
    this.pumping = (async () => {
      do {
        this.again = false;
        await this.pump().catch(() => undefined);
      } while (this.again && !this.stopped);
    })().finally(() => {
      this.pumping = null;
      this.set({ active: null });
    });
  }

  /** Espera a que termine la bajada en curso (las pruebas). */
  async idle(): Promise<void> {
    while (this.pumping) await this.pumping;
  }

  private async pump(): Promise<void> {
    const db = this.deps.db!;
    for (const mark of await listMarks(db)) {
      if (this.stopped) return;
      if (!this.deps.online()) return;
      // Subir le gana a bajar: con algo que se puede subir ahora (también una carpeta, P.9), se espera.
      if (this.deps.uploadsBusy?.()) return;
      if (await this.deps.media.hasUploadableNow()) return;
      if (mark.state === 'noSpace') continue;
      const signature = this.signature(mark);
      const seen = this.checked.get(mark.id);
      if (mark.state === 'ready' && seen?.signature === signature && this.now() - seen.at < MAINTAIN_EVERY_MS) continue;
      await this.download(mark);
      const after = (await listMarks(db)).find((m) => m.id === mark.id);
      if (after?.state === 'ready') this.checked.set(mark.id, { signature, at: this.now() });
      else this.checked.delete(mark.id);
      await this.refresh();
    }
  }

  /** Lo que define qué pide una marca: sus casillas, sus archivos y las páginas leídas. */
  private signature(mark: OfflineMark): string {
    return JSON.stringify([mark.options, Object.keys(mark.files).sort(), Object.entries(mark.pages).sort(), mark.older ?? []]);
  }

  /** Lo que falta bajar de una marca. */
  private async needed(mark: OfflineMark): Promise<{ items: Item[]; unavailable: number; waiting: number }> {
    const ids = Object.keys(mark.files);
    let rows: MediaFileRow[] | null = null;
    rows = await this.deps.remote.fetchMediaFiles(ids).catch(() => null);
    if (rows) await this.deps.media.learn(rows);
    const facts = await this.facts(ids, rows);
    const items: Item[] = [];
    let unavailable = 0;
    let waiting = 0;
    const seen = new Set(rows?.map((r) => r.id) ?? []);
    for (const f of facts) {
      if (f.deleted) continue;
      if (rows && !seen.has(f.id) && !f.ownBlob) {
        unavailable++;
        continue;
      }
      if (f.thumbAt && !f.thumb) items.push({ id: f.id, what: 'thumb', bytes: 40 * 1024, mime: f.mime, size: 0 });
      const want = wanted(f, mark.options);
      if (!want.orig && !want.view) continue;
      if (!f.inDrive && !f.ownBlob) {
        waiting++;
        continue;
      }
      // Sin el peso no se puede bajar por partes ni comprobar: se espera a que la base lo diga.
      if (want.orig && !f.ownBlob && !f.copy && f.size === null) {
        waiting++;
        continue;
      }
      if (want.orig && !f.ownBlob && !f.copy) items.push({ id: f.id, what: 'orig', bytes: f.size ?? 0, mime: f.mime, size: f.size ?? 0 });
      if (want.view && !f.offview) items.push({ id: f.id, what: 'view', bytes: estimateSharp(f, !!this.deps.safari), mime: f.mime, size: f.size ?? 0 });
    }
    for (const url of mark.older ?? []) {
      if (this.deps.older && !(await this.deps.older.isStored(url).catch(() => true))) items.push({ id: url, what: 'older', bytes: MB, mime: '', size: 0 });
    }
    // Lo liviano primero: el contador avanza y lo que más se ve llega antes.
    const order = { thumb: 0, older: 1, view: 2, orig: 3 };
    items.sort((a, b) => order[a.what] - order[b.what] || a.bytes - b.bytes);
    return { items, unavailable, waiting };
  }

  private async download(mark: OfflineMark): Promise<void> {
    const db = this.deps.db!;
    // Los comentarios de la rama, al marcar y cada 6 horas (sección 3.6).
    if (this.deps.comments && this.now() - (mark.commentsAt ?? 0) >= COMMENTS_EVERY_MS) {
      for (const pageId of branchPages(this.deps.tree, mark.kind, mark.target)) {
        if (this.stopped || !this.deps.online()) return;
        await this.deps.comments.refresh(pageId).catch(() => undefined);
      }
      const latest = (await listMarks(db)).find((m) => m.id === mark.id);
      if (latest) await putMark(db, { ...latest, commentsAt: this.now() });
    }
    const { items, unavailable, waiting } = await this.needed(mark);
    const prev = this.progress.get(mark.id);
    const progress = {
      done: 0,
      total: items.length,
      bytesDone: 0,
      bytesTotal: items.reduce((n, i) => n + i.bytes, 0),
      unavailable,
      waiting,
      pages: prev?.pages ?? 0,
      update: prev?.update ?? 0,
    };
    this.progress.set(mark.id, progress);
    const finish = async (state: OfflineMark['state'], error: string | null = null) => {
      const latest = (await listMarks(db)).find((m) => m.id === mark.id);
      if (!latest) return;
      const ready = state === 'ready';
      await putMark(db, { ...latest, state, error, readyAt: ready ? this.now() : latest.readyAt });
    };
    if (items.length === 0) {
      const complete = progress.pages === 0 && progress.update === 0;
      await finish(complete ? 'ready' : 'waiting');
      await this.measure(mark);
      return;
    }
    this.set({ active: mark.id });
    await finish('downloading');
    const controller = new AbortController();
    this.controller = controller;
    try {
      for (const item of items) {
        if (this.stopped || controller.signal.aborted) throw new StoppedError();
        if (!this.deps.online()) throw new StoppedError();
        // Empezó a subir otra cola (una carpeta, P.9): se sigue después, desde lo guardado.
        if (this.deps.uploadsBusy?.()) throw new StoppedError();
        await this.ensureRoom(item.bytes);
        try {
          await this.fetchItem(item, controller.signal);
        } catch (err) {
          if (err instanceof NoSpaceError || err instanceof StoppedError) throw err;
          if (isNoSpace(err)) throw new NoSpaceError(t('offline.noSpace'));
          if (err instanceof DOMException && err.name === 'AbortError') throw new StoppedError();
          if (isNetworkError(err) || (err instanceof PorteroError && err.status === 0)) throw new StoppedError();
          if (err instanceof PorteroError && err.code === 'drive_not_connected') {
            await finish('waiting', t('offline.waitingDrive'));
            return;
          }
          progress.unavailable++;
        }
        progress.done++;
        progress.bytesDone += item.bytes;
        this.written += item.what === 'orig' ? item.size : item.bytes;
        this.set({ marks: this.snapshot.marks.map((m) => (m.id === mark.id ? { ...m, done: progress.done, bytesDone: progress.bytesDone, total: progress.total, bytesTotal: progress.bytesTotal } : m)) });
      }
      const complete = progress.pages === 0 && progress.update === 0;
      await finish(complete ? 'ready' : 'waiting');
      await this.measure(mark);
    } catch (err) {
      if (err instanceof NoSpaceError) {
        await finish('noSpace', err.message);
        return;
      }
      if (err instanceof StoppedError) {
        await finish(this.deps.online() ? 'downloading' : 'offline');
        return;
      }
      throw err;
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }

  /** Lo que ocupa en el dispositivo lo que pide la marca (para el diálogo). */
  private async measure(mark: OfflineMark): Promise<void> {
    const db = this.deps.db!;
    let bytes = 0;
    for (const id of Object.keys(mark.files)) {
      const want = protects([mark], id);
      const entry = await getCopy(db, id);
      if (want.orig) {
        if (entry?.orig?.complete) bytes += entry.orig.total;
        else {
          const own = await db.get('files', id);
          if (own && (await db.getKey('blobs', id))) bytes += own.size;
        }
      }
      if (want.view && entry?.view) bytes += entry.view.bytes;
    }
    this.markBytes.set(mark.id, bytes);
  }

  /**
   * Antes de bajar algo: que entre en lo que el navegador le deja a la app, sin usar la reserva para lo nuevo
   * (sección 5.7), y en el iPhone, que el total marcado no pase el tope fijo (sección 9.1). Nunca libera nada
   * sola: si no entra, la marca se detiene y el aviso lo ofrece.
   */
  private async ensureRoom(bytes: number): Promise<void> {
    const estimate = await this.estimate();
    if (estimate?.quota && estimate.quota > 0) {
      const available = estimate.quota - (estimate.usage ?? 0);
      if (available - reserveFor(estimate.quota) < bytes) throw new NoSpaceError(t('offline.noSpace'));
    }
    if (this.deps.ios && this.deviceTotal() + bytes > IOS_OFFLINE_TOTAL_MAX) throw new NoSpaceError(t('offline.iosLimit'));
  }

  /** El total marcado de todos los workspaces de este dispositivo (cada uno anota el suyo). */
  deviceTotal(): number {
    const local = this.deps.local;
    const own = this.snapshot.usage?.offline ?? 0;
    if (!local) return own + this.written;
    let total = 0;
    let mine = false;
    try {
      for (let i = 0; i < local.length; i++) {
        const key = local.key(i);
        if (!key?.startsWith('sd:offline:')) continue;
        total += Number(local.getItem(key)) || 0;
        if (key === `sd:offline:${this.deps.dbName}`) mine = true;
      }
    } catch {
      return own + this.written;
    }
    // Lo de este workspace, si todavía no está anotado, y lo bajado en esta vuelta.
    return total + (mine ? 0 : own) + this.written;
  }

  private saveDeviceTotal(bytes: number): void {
    try {
      this.deps.local?.setItem(`sd:offline:${this.deps.dbName}`, String(bytes));
    } catch {
      // Sin `localStorage` (navegación privada): cuenta solo este workspace.
    }
  }

  private decoding: Promise<void> = Promise.resolve();

  private async fetchItem(item: Item, signal: AbortSignal): Promise<void> {
    const db = this.deps.db!;
    if (item.what === 'thumb') {
      await this.deps.media.ensureThumb(item.id);
      return;
    }
    if (item.what === 'older') {
      await this.deps.older?.ensureStored(item.id);
      return;
    }
    if (item.what === 'orig') {
      await this.downloadCopy(item, signal);
      return;
    }
    // La nítida: la de 2048 de la página si ya está (se mueve, sin bajar nada), o del original del dispositivo,
    // o del original bajado (en memoria, sin guardarlo). En el teléfono, de a una (memoria).
    const saved = await this.deps.media.savedView(item.id);
    if (saved) {
      await putOfflineView(db, item.id, saved, this.now());
      await this.deps.media.forgetSavedView(item.id);
      return;
    }
    const run = async () => {
      const own = await db.get('blobs', item.id);
      const source = own ?? (await readCopy(db, item.id)) ?? (await this.downloadWhole(item, signal));
      const view = await this.deps.media.makeOfflineView(source, item.mime);
      if (!view) throw new Error('cannot make the large photo');
      await putOfflineView(db, item.id, view, this.now());
    };
    if (!this.deps.phone) return run();
    const previous = this.decoding;
    let release!: () => void;
    this.decoding = new Promise((r) => (release = r));
    await previous;
    try {
      await run();
    } finally {
      release();
    }
  }

  /** Un pase nuevo si el que hay venció o no sirve (una sola vez). */
  private async passUrl(id: string, fresh = false): Promise<string> {
    if (!fresh) {
      const cached = this.passes.get(id);
      if (cached && cached.until > this.now()) return cached.url;
    }
    const url = await this.deps.media.pass(id);
    this.passes.set(id, { url, until: this.now() + 7 * 60 * 60_000 });
    return url;
  }

  private readonly passes = new Map<string, { url: string; until: number }>();

  /** Pide una parte por `Range`, con `?offline=1` (saltea la caché del arranque del portero). */
  private async requestPart(id: string, start: number, end: number, signal: AbortSignal): Promise<Response> {
    const doFetch = this.deps.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));
    for (let attempt = 0; ; attempt++) {
      const url = await this.passUrl(id, attempt > 0);
      const res = await doFetch(`${url}${url.includes('?') ? '&' : '?'}offline=1`, {
        headers: { Range: `bytes=${start}-${end}` },
        cache: 'no-store',
        signal,
      });
      if (res.ok) return res;
      const code = await porteroCode(res);
      // Un pase vencido o inválido: se pide otro una vez (nunca cuenta como "no disponible" de entrada).
      if (attempt === 0 && (code === 'pass_expired' || code === 'pass_invalid' || (!code && res.status === 403))) continue;
      throw new PorteroError(`portero ${res.status}`, res.status, res.status >= 500, code);
    }
  }

  /** Baja el archivo entero a la copia (`off:`), por partes, avanzando por el `Content-Range` real (sección 3.5). */
  private async downloadCopy(item: Item, signal: AbortSignal): Promise<void> {
    const db = this.deps.db!;
    const total = item.size;
    let entry = await getCopy(db, item.id);
    if (entry?.orig && (entry.orig.total !== total || entry.orig.mime !== item.mime || !(await partsPresent(db, entry)))) entry = undefined;
    let start = entry ? copyReceived(entry) : 0;
    let reset = !entry;
    try {
      while (start < total) {
        const end = Math.min(start + PART_BYTES, total) - 1;
        const res = await this.requestPart(item.id, start, end, signal);
        let part: Blob;
        if (res.status === 206) {
          const range = parseContentRange(res.headers.get('Content-Range'));
          if (!range || range.start !== start || range.total !== total) throw new Error('range mismatch');
          part = await res.blob();
          if (part.size !== range.end - range.start + 1) throw new Error('range mismatch');
        } else {
          // Un portero que no hizo caso del `Range`: sirve si es chico y entero; uno grande no se lee en memoria.
          if (start !== 0 || total > PART_BYTES) {
            await res.body?.cancel().catch(() => undefined);
            throw new Error('no ranges');
          }
          part = await res.blob();
          if (part.size !== total) throw new Error('size mismatch');
        }
        if (part.size === 0) throw new Error('empty part');
        if (reset) {
          // Lo que hubiera de antes con otro peso o tipo se descarta antes de la primera parte.
          await dropCopy(db, item.id, { ignoreMarks: true, what: 'orig' }).catch(() => 0);
          reset = false;
        }
        await appendPart(db, item.id, item.mime, total, start, new Blob([part], { type: item.mime }), this.now());
        start += part.size;
      }
    } catch (err) {
      if (isNoSpace(err)) {
        // Sin lugar: se borran las partes de este archivo para que el disco no quede en cero (sección 3.5).
        await dropCopy(db, item.id, { ignoreMarks: true, what: 'orig' }).catch(() => 0);
        throw err;
      }
      if (err instanceof PorteroError && err.code === 'drive_missing') await this.confirmGone(item.id);
      throw err;
    }
  }

  /** Baja el original entero en memoria (para hacer la nítida), por partes. */
  private async downloadWhole(item: Item, signal: AbortSignal): Promise<Blob> {
    const parts: Blob[] = [];
    let start = 0;
    const total = item.size;
    if (!(total > 0)) throw new Error('unknown size');
    while (start < total) {
      const end = Math.min(start + PART_BYTES, total) - 1;
      const res = await this.requestPart(item.id, start, end, signal);
      if (res.status !== 206 && (start !== 0 || total > PART_BYTES)) {
        await res.body?.cancel().catch(() => undefined);
        throw new Error('no ranges');
      }
      const part = await res.blob();
      if (res.status === 206) {
        const range = parseContentRange(res.headers.get('Content-Range'));
        if (!range || range.start !== start || part.size !== range.end - range.start + 1) throw new Error('range mismatch');
      } else if (start !== 0 || part.size !== total) {
        throw new Error('no ranges');
      }
      parts.push(part);
      start += part.size;
    }
    return new Blob(parts, { type: item.mime });
  }

  /**
   * El portero dijo `drive_missing`: si hay una copia completa, se confirma con `/verify` (Drive no lo tiene) y
   * recién ahí queda `gone` (puede ser la única copia: nada automático la borra).
   */
  private async confirmGone(id: string): Promise<void> {
    const db = this.deps.db!;
    const entry = await getCopy(db, id);
    if (!entry?.orig?.complete || !(await this.hasFeature('verify'))) return;
    const results: Record<string, VerifyResult> = await this.deps.media.verify([id]).catch(() => ({}));
    const result = results[id];
    if (result && 'code' in result && result.code === 'drive_missing') await markGone(db, id, this.now());
  }
}

