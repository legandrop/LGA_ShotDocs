import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { stored, t } from '../i18n';
import { isNetworkError } from '../sync/types';
import { normalizeMime } from './queue';
import { sortDirs, type FolderFile, type FolderSource } from './folderRead';
import { PorteroError, UploadError, type FolderPrepared, type FolderSession, type FolderSessionItem, type UploadOptions, type UploadResult } from './portero';

// La cola de las carpetas (P.9, Docs/Doc_Carpetas.md, sección 5). Una carpeta soltada en una página es una sola
// fila de `files` (la registra `MediaQueue.addFolder`); lo de adentro va al Drive del dueño por el portero, sin
// copia en el dispositivo: la carpeta original sigue en el disco. Lo único que se guarda acá es la lista de
// trabajo (qué archivo, a qué subcarpeta, si ya llegó y su subida), sin bytes, en una base aparte
// (`<base local>:folders`, que una versión vieja nunca abre). Si la pestaña se cierra, al volver a soltar la
// carpeta en su tarjeta se compara por ruta y peso y se sube solo lo que falta.
//
// Va por un camino propio, que nunca frena a las fotos y adjuntos de las páginas: hasta 3 archivos a la vez,
// pausa por carpeta, un error por archivo que no frena a los demás, y si Drive pide ir más despacio, espera.

/** Archivos a la vez. */
export const FOLDER_CONCURRENCY = 3;
/** Lo que se pide al portero en un pedido (subcarpetas o subidas): lo mismo que acepta (`FOLDER_BATCH`). */
export const FOLDER_BATCH = 30;
/** Intentos de un archivo antes de dejarlo con su error a la vista (se vuelve a probar con "Retry"). */
export const FOLDER_TRIES = 5;
/** Cada cuánto se vuelve a dibujar la tarjeta mientras sube. */
const NOTE_EVERY_MS = 1000;

/** Lo que usa del portero (las pruebas usan uno en memoria). */
export interface FolderPortero {
  folderPrepare(file: string, name: string, dirs?: string[], parents?: Record<string, string>): Promise<FolderPrepared>;
  folderSessions(file: string, items: FolderSessionItem[]): Promise<FolderSession[]>;
  upload(file: Blob & { name?: string }, options?: UploadOptions): Promise<UploadResult>;
}

/** Un archivo de la lista de trabajo (sin bytes). */
export interface FolderItem {
  /** `<carpeta>\u0000<ruta>` */
  key: string;
  job: string;
  path: string;
  size: number;
  mime: string;
  /** La subida abierta por el portero (su id cifrado); `null` hasta pedirla. */
  uploadId: string | null;
  done: boolean;
  tries: number;
  /** El último error, a la vista; con `FOLDER_TRIES` intentos queda detenido hasta "Retry". */
  error: string | null;
}

/** Una carpeta que se sube desde este dispositivo. */
export interface FolderJob {
  /** El id de la fila de `files` de la carpeta. */
  id: string;
  pageId: string;
  name: string;
  createdAt: number;
  /** Las subcarpetas, primero las de arriba. */
  dirs: string[];
  /** Ruta → id de Drive (`''`: la carpeta misma). */
  dirIds: Record<string, string>;
  paused: boolean;
  /** Cuántos se saltearon al leerla (ocultos, del sistema, ilegibles). */
  skipped: number;
}

interface FoldersSchema extends DBSchema {
  jobs: { key: string; value: FolderJob };
  items: { key: string; value: FolderItem; indexes: { job: string } };
}

export type FoldersDb = IDBPDatabase<FoldersSchema>;

/** El nombre de la base de las carpetas que acompaña a una base local. */
export function foldersDbName(localDbName: string): string {
  return `${localDbName}:folders`;
}

export function openFoldersDb(name: string): Promise<FoldersDb> {
  return openDB<FoldersSchema>(name, 1, {
    upgrade(db) {
      db.createObjectStore('jobs', { keyPath: 'id' });
      db.createObjectStore('items', { keyPath: 'key' }).createIndex('job', 'job');
    },
  });
}

/** Cómo va una carpeta, para la ventana y la tarjeta. */
export interface FolderProgress {
  id: string;
  pageId: string;
  name: string;
  state: 'preparing' | 'uploading' | 'paused' | 'waiting' | 'missing' | 'done' | 'failed';
  files: number;
  doneFiles: number;
  bytes: number;
  doneBytes: number;
  /** Segundos que faltan (estimado), o `null`. */
  eta: number | null;
  /** Archivos detenidos con su error. */
  errors: { path: string; error: string }[];
  /** Archivos que faltan subir y no están en el dispositivo (se cerró la pestaña): hay que volver a soltarla. */
  missing: number;
  skipped: number;
  /** Lo que frena a toda la carpeta (sin red, el portero no deja), o `null`. */
  problem: string | null;
}

interface Running {
  job: FolderJob;
  items: FolderItem[];
  files: Map<string, File>;
  active: Map<string, { sent: number; abort: AbortController }>;
  loop: Promise<void> | null;
  problem: string | null;
  waitingUntil: number;
  startedAt: number;
  bytesAtStart: number;
  noteAt: number;
  wake: (() => void) | null;
}

export interface FolderUploadsOptions {
  /** El portero del workspace, o `null` si no hay. */
  portero: () => FolderPortero | null;
  /** Lo que dice la tarjeta de la carpeta en la página. */
  note?: (id: string, note: string | null) => void;
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class FolderUploads {
  private readonly running = new Map<string, Running>();
  private readonly listeners = new Set<() => void>();
  private revision = 0;
  private readonly wait: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(
    private readonly db: FoldersDb | null,
    private readonly options: FolderUploadsOptions,
  ) {
    this.wait = options.wait ?? sleep;
    this.now = options.now ?? Date.now;
  }

  /** Lee las carpetas que quedaron a medias (la pestaña se cerró): quedan esperando que se vuelvan a soltar. */
  async load(): Promise<void> {
    if (!this.db) return;
    for (const job of await this.db.getAll('jobs')) {
      if (this.running.has(job.id)) continue;
      const items = await this.db.getAllFromIndex('items', 'job', job.id);
      // Terminada, pero la lista no se llegó a borrar: se borra ahora.
      if (items.every((i) => i.done) && job.dirs.every((d) => d in job.dirIds)) {
        await this.drop(job.id);
        continue;
      }
      this.running.set(job.id, this.fresh(job, items, new Map()));
      this.note(job.id, true);
    }
    this.emit();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getRevision = (): number => this.revision;

  /** Hay algo subiendo: cerrar la pestaña lo corta (se retoma volviendo a soltar la carpeta). */
  busy(): boolean {
    return [...this.running.values()].some((r) => r.loop !== null);
  }

  has(id: string): boolean {
    return this.running.has(id);
  }

  /**
   * Empieza a subir una carpeta ya registrada (`MediaQueue.addFolder`): anota la lista de trabajo y sigue sola.
   */
  async start(id: string, pageId: string, source: FolderSource): Promise<void> {
    const job: FolderJob = {
      id,
      pageId,
      name: source.name,
      createdAt: this.now(),
      dirs: sortDirs([...source.dirs, ...source.files.map((f) => parentOf(f.path)).filter(Boolean)]),
      dirIds: {},
      paused: false,
      skipped: source.skipped.length,
    };
    const items: FolderItem[] = source.files.map((f) => ({
      key: itemKey(id, f.path),
      job: id,
      path: f.path,
      size: f.file.size,
      mime: normalizeMime(f.file.type, f.file.name),
      uploadId: null,
      done: false,
      tries: 0,
      error: null,
    }));
    if (this.db) {
      const tx = this.db.transaction(['jobs', 'items'], 'readwrite');
      await Promise.all([tx.objectStore('jobs').put(job), ...items.map((i) => tx.objectStore('items').put(i)), tx.done]);
    }
    const files = new Map(source.files.map((f) => [f.path, f.file]));
    this.running.set(id, this.fresh(job, items, files));
    this.kick(id);
  }

  /**
   * Se volvió a soltar la carpeta (después de cerrar la pestaña): cada archivo que falta se toma de ahí si tiene
   * la misma ruta y el mismo peso. Devuelve cuántos se encontraron.
   */
  resumeWith(id: string, source: FolderSource): number {
    const r = this.running.get(id);
    if (!r) return 0;
    const byPath = new Map<string, FolderFile>(source.files.map((f) => [f.path, f]));
    let found = 0;
    for (const item of r.items) {
      if (item.done) continue;
      const f = byPath.get(item.path);
      if (f && f.file.size === item.size) {
        r.files.set(item.path, f.file);
        found++;
      }
    }
    if (found > 0) {
      r.job.paused = false;
      void this.saveJob(r.job);
      this.kick(id);
    }
    this.emit();
    return found;
  }

  pause(id: string): void {
    const r = this.running.get(id);
    if (!r) return;
    r.job.paused = true;
    void this.saveJob(r.job);
    for (const a of r.active.values()) a.abort.abort();
    r.wake?.();
    this.note(id, true);
    this.emit();
  }

  resume(id: string): void {
    const r = this.running.get(id);
    if (!r) return;
    r.job.paused = false;
    void this.saveJob(r.job);
    this.kick(id);
  }

  /** Vuelve a probar los archivos detenidos con su error. */
  retry(id: string): void {
    const r = this.running.get(id);
    if (!r) return;
    for (const item of r.items) {
      if (!item.done && item.tries >= FOLDER_TRIES) {
        item.tries = 0;
        item.error = null;
        void this.saveItem(item);
      }
    }
    r.problem = null;
    r.job.paused = false;
    this.kick(id);
  }

  /** Deja de seguir una carpeta en este dispositivo (lo que subió queda en Drive). */
  async forget(id: string): Promise<void> {
    const r = this.running.get(id);
    if (r) {
      r.job.paused = true;
      for (const a of r.active.values()) a.abort.abort();
      r.wake?.();
    }
    this.running.delete(id);
    await this.drop(id);
    this.options.note?.(id, null);
    this.emit();
  }

  /** Para todo (se cierra la app): lo enviado queda en Drive y la lista, en el dispositivo. */
  stop(): void {
    for (const r of this.running.values()) {
      for (const a of r.active.values()) a.abort.abort();
      r.wake?.();
    }
    this.stopped = true;
  }

  private stopped = false;

  progress(id: string): FolderProgress | null {
    const r = this.running.get(id);
    return r ? this.progressOf(r) : null;
  }

  all(): FolderProgress[] {
    return [...this.running.values()].map((r) => this.progressOf(r));
  }

  // --- adentro ---------------------------------------------------------------------------------------

  private fresh(job: FolderJob, items: FolderItem[], files: Map<string, File>): Running {
    return {
      job,
      items,
      files,
      active: new Map(),
      loop: null,
      problem: null,
      waitingUntil: 0,
      startedAt: 0,
      bytesAtStart: 0,
      noteAt: 0,
      wake: null,
    };
  }

  private progressOf(r: Running): FolderProgress {
    let doneFiles = 0;
    let doneBytes = 0;
    let bytes = 0;
    let missing = 0;
    const errors: { path: string; error: string }[] = [];
    for (const item of r.items) {
      bytes += item.size;
      if (item.done) {
        doneFiles++;
        doneBytes += item.size;
        continue;
      }
      doneBytes += r.active.get(item.path)?.sent ?? 0;
      if (item.tries >= FOLDER_TRIES) errors.push({ path: item.path, error: item.error ?? t('queue.unknownError') });
      else if (!r.files.has(item.path)) missing++;
    }
    const finished = doneFiles === r.items.length;
    let state: FolderProgress['state'];
    if (finished && r.loop === null) state = 'done';
    else if (r.job.paused) state = 'paused';
    else if (r.loop === null && missing > 0) state = 'missing';
    else if (r.loop === null && errors.length > 0) state = 'failed';
    else if (r.waitingUntil > this.now()) state = 'waiting';
    else if (Object.keys(r.job.dirIds).length === 0 || r.job.dirs.some((d) => !(d in r.job.dirIds))) state = 'preparing';
    else state = 'uploading';
    let eta: number | null = null;
    const seconds = r.startedAt ? (this.now() - r.startedAt) / 1000 : 0;
    const speed = seconds > 5 ? (doneBytes - r.bytesAtStart) / seconds : 0;
    if (speed > 0 && r.loop) eta = Math.round((bytes - doneBytes) / speed);
    return {
      id: r.job.id,
      pageId: r.job.pageId,
      name: r.job.name,
      state,
      files: r.items.length,
      doneFiles,
      bytes,
      doneBytes,
      eta,
      errors,
      missing,
      skipped: r.job.skipped,
      problem: r.problem,
    };
  }

  private emit(): void {
    this.revision++;
    for (const fn of this.listeners) fn();
  }

  /** Lo que dice la tarjeta (a lo sumo una vez por segundo, salvo `now`). */
  private note(id: string, now = false): void {
    const r = this.running.get(id);
    if (!r || !this.options.note) return;
    if (!now && this.now() - r.noteAt < NOTE_EVERY_MS) return;
    r.noteAt = this.now();
    const p = this.progressOf(r);
    let text: string | null;
    if (p.state === 'done') text = null;
    else if (p.state === 'missing') text = t('folder.cardMissing', { count: p.files - p.doneFiles - p.errors.length });
    else if (p.state === 'failed') text = t('folder.cardErrors', { count: p.errors.length });
    else if (p.state === 'paused') text = t('folder.cardPaused', { done: p.doneFiles, total: p.files });
    else text = t('folder.cardUploading', { done: p.doneFiles, total: p.files });
    this.options.note(id, text);
  }

  private kick(id: string): void {
    const r = this.running.get(id);
    if (!r || r.loop || this.stopped) {
      this.emit();
      return;
    }
    r.startedAt = this.now();
    r.bytesAtStart = this.progressOf(r).doneBytes;
    r.loop = this.drain(r)
      .catch((err: unknown) => {
        r.problem = describe(err);
      })
      .finally(() => {
        r.loop = null;
        void this.finishIfDone(r);
        this.note(r.job.id, true);
        this.emit();
      });
    this.note(id, true);
    this.emit();
  }

  private async finishIfDone(r: Running): Promise<void> {
    if (r.items.length > 0 && !r.items.every((i) => i.done)) return;
    if (!r.job.dirs.every((d) => d in r.job.dirIds)) return;
    // Terminada: la lista de trabajo ya no hace falta. La ventana la muestra como lista hasta que se cierre.
    await this.drop(r.job.id);
  }

  /** Espera `ms`, o hasta que se pause o se pare. */
  private async pauseFor(r: Running, ms: number): Promise<void> {
    r.waitingUntil = this.now() + ms;
    this.emit();
    await Promise.race([this.wait(ms), new Promise<void>((resolve) => (r.wake = resolve))]);
    r.wake = null;
    r.waitingUntil = 0;
    this.emit();
  }

  private async drain(r: Running): Promise<void> {
    const portero = this.options.portero();
    if (!portero) throw new PorteroError(stored('queue.needsDrive'), 0);
    let waits = 0;
    // 1. La carpeta y sus subcarpetas, en orden.
    while (!r.job.paused && !this.stopped && (!('' in r.job.dirIds) || r.job.dirs.some((d) => !(d in r.job.dirIds)))) {
      const batch = r.job.dirs.filter((d) => !(d in r.job.dirIds)).slice(0, FOLDER_BATCH);
      const parents: Record<string, string> = {};
      for (const d of batch) {
        const up = parentOf(d);
        if (up && !batch.includes(up) && r.job.dirIds[up]) parents[up] = r.job.dirIds[up]!;
      }
      try {
        const res = await portero.folderPrepare(r.job.id, r.job.name, batch, parents);
        r.job.dirIds = { ...r.job.dirIds, '': res.root.id, ...res.dirs };
        r.problem = null;
        waits = 0;
        await this.saveJob(r.job);
        this.emit();
      } catch (err) {
        if (!(await this.waitIfPassing(r, err, ++waits))) throw err;
      }
    }
    // 2. Los archivos: hasta 3 a la vez, pidiendo las subidas de a tandas.
    const running = new Set<Promise<void>>();
    for (;;) {
      if (r.job.paused || this.stopped) break;
      const ready = r.items.filter((i) => !i.done && i.tries < FOLDER_TRIES && r.files.has(i.path) && !r.active.has(i.path));
      if (ready.length === 0 && running.size === 0) break;
      if (ready.length === 0 || r.active.size >= FOLDER_CONCURRENCY) {
        await Promise.race(running);
        continue;
      }
      const next = ready[0]!;
      if (!next.uploadId) {
        const batch = ready.filter((i) => !i.uploadId).slice(0, FOLDER_BATCH);
        try {
          await this.openSessions(r, portero, batch);
          waits = 0;
        } catch (err) {
          if (!(await this.waitIfPassing(r, err, ++waits))) {
            r.problem = describe(err);
            break;
          }
        }
        continue;
      }
      const task = this.uploadOne(r, portero, next).finally(() => running.delete(task));
      running.add(task);
    }
    await Promise.all(running);
  }

  /**
   * Un error que pasa solo (sin red, el portero o Drive un momento, Drive que pide ir más despacio): espera cada
   * vez un poco más (hasta 2 minutos) y devuelve `true` para seguir. Otro error: `false`.
   */
  private async waitIfPassing(r: Running, err: unknown, waits: number): Promise<boolean> {
    const passing = err instanceof PorteroError ? err.retryable || err.status === 0 : isNetworkError(err);
    if (!passing || r.job.paused || this.stopped) return false;
    r.problem = describe(err);
    await this.pauseFor(r, Math.min(5000 * 2 ** Math.min(waits - 1, 5), 120_000));
    return true;
  }

  private async openSessions(r: Running, portero: FolderPortero, batch: FolderItem[]): Promise<void> {
    const sessions = await portero.folderSessions(
      r.job.id,
      batch.map((i) => {
        const dir = parentOf(i.path);
        return { dir: dir ? (r.job.dirIds[dir] ?? null) : null, name: nameOf(i.path), mime: i.mime, size: i.size };
      }),
    );
    let slowDown = false;
    batch.forEach((item, n) => {
      const s = sessions[n];
      if (!s) return;
      if ('uploadId' in s) item.uploadId = s.uploadId;
      else if ('done' in s) item.done = true;
      else if (s.error === 'rate') slowDown = true;
      else {
        item.tries++;
        item.error = s.error === 'gone' ? stored('folder.dirGone') : stored('folder.driveFailed');
      }
      void this.saveItem(item);
    });
    this.note(r.job.id);
    this.emit();
    if (slowDown) await this.pauseFor(r, 10_000);
  }

  private async uploadOne(r: Running, portero: FolderPortero, item: FolderItem): Promise<void> {
    const file = r.files.get(item.path);
    if (!file || !item.uploadId) return;
    const abort = new AbortController();
    const slot = { sent: 0, abort };
    r.active.set(item.path, slot);
    try {
      await portero.upload(file, {
        resume: item.uploadId,
        noOpen: true,
        signal: abort.signal,
        onProgress: (p) => {
          slot.sent = p.sent;
          this.note(r.job.id);
          this.emit();
        },
      });
      item.done = true;
      item.error = null;
    } catch (err) {
      if (err instanceof UploadError && err.cancelled) return;
      // El portero ya no tiene la subida (o venció): se pide otra en la próxima tanda.
      if (err instanceof UploadError && !err.uploadId) item.uploadId = null;
      const offline = err instanceof PorteroError && err.status === 0;
      if (!offline) item.tries++;
      item.error = describe(err);
      if (offline || (err instanceof PorteroError && err.retryable)) await this.pauseFor(r, offline ? 15_000 : 5_000);
    } finally {
      r.active.delete(item.path);
      await this.saveItem(item);
      this.note(r.job.id, item.done && r.items.every((i) => i.done));
      this.emit();
    }
  }

  private async saveJob(job: FolderJob): Promise<void> {
    await this.db?.put('jobs', job).catch(() => undefined);
  }

  private async saveItem(item: FolderItem): Promise<void> {
    if (!this.db) return;
    // Una carpeta olvidada no vuelve a aparecer por una respuesta que llegó tarde.
    if (!this.running.has(item.job)) return;
    await this.db.put('items', item).catch(() => undefined);
  }

  private async drop(id: string): Promise<void> {
    if (!this.db) return;
    try {
      const tx = this.db.transaction(['jobs', 'items'], 'readwrite');
      const keys = await tx.objectStore('items').index('job').getAllKeys(id);
      await Promise.all([tx.objectStore('jobs').delete(id), ...keys.map((k) => tx.objectStore('items').delete(k)), tx.done]);
    } catch {
      // Queda en el dispositivo: se vuelve a leer como terminada y se borra la próxima vez.
    }
  }
}

function itemKey(job: string, path: string): string {
  return `${job}\u0000${path}`;
}

export function parentOf(path: string): string {
  const at = path.lastIndexOf('/');
  return at < 0 ? '' : path.slice(0, at);
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
