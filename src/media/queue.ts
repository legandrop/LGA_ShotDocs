import { FileRejected } from '../sync/files';
import type { MediaRemote } from '../sync/remote';
import { errorMessage, RemoteError } from '../sync/types';
import type { KnownFile, MediaDb, MediaLink, MediaRecord } from './mediaDb';
import { PorteroError, UploadError, localDay, type Portero, type UploadProgress } from './portero';
import { dimension, mediaKind, placeholderUrl, probeMedia, seconds, withPlayMark, type MediaKind, type Probe } from './probe';

// La cola de fotos y videos (paso 6 de Docs/Plan_Workspaces.md; Docs/Doc_Sincronizacion.md, "Archivos
// grandes"). El archivo se guarda primero en el dispositivo (base `<base local>:media`) y en la página queda
// un bloque `image` con `sdmedia://<id>`. Después, cuando hay red y con su propio ciclo (una subida de
// minutos no frena al texto): `register_file` → miniatura a `thumbs` + `set_file_thumb` → portero, por
// partes y retomando lo que ya llegó → subido cuando el portero responde `done`. Cada paso es idempotente
// y queda anotado, así que se puede cortar en cualquier momento. Nada se descarta: un error queda a la
// vista y el archivo sigue en el dispositivo.

/** Dirección de un archivo grande en el documento. No depende de ningún servidor. */
export const MEDIA_SCHEME = 'sdmedia://';
/** La versión de la base con `files`, `register_file` y el bucket `thumbs`. */
export const MEDIA_SCHEMA_VERSION = 3;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// La misma forma que pide la base (`files.mime`).
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
const MAX_BACKOFF_MS = 10 * 60_000;

/** Tipos por extensión, para lo que el navegador entrega sin tipo (pasa con .mov y .heic en Windows). */
const EXTENSION_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  dng: 'image/x-adobe-dng',
  mov: 'video/quicktime',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  mts: 'video/mp2t',
  '3gp': 'video/3gpp',
};

/**
 * El tipo como lo pide la base: minúsculas, `tipo/subtipo`, sin parámetros. Si el navegador no lo da, sale
 * de la extensión; si tampoco, `application/octet-stream`.
 */
export function normalizeMime(type: string | undefined, name = ''): string {
  const base = (type ?? '').split(';')[0].trim().toLowerCase();
  if (base.length <= 200 && MIME.test(base) && base !== 'application/octet-stream') return base;
  const ext = /\.([a-z0-9]+)$/i.exec(name.trim())?.[1]?.toLowerCase();
  return (ext && EXTENSION_MIME[ext]) || 'application/octet-stream';
}

/** Fotos y videos; SVG no (puede traer scripts). */
export function isMediaFile(file: { type: string; name?: string }): boolean {
  const mime = normalizeMime(file.type, file.name);
  return mediaKind(mime) !== null && mime !== 'image/svg+xml';
}

/** El id de una dirección `sdmedia://<id>`, o `null` si no es una. */
export function mediaIdOf(url: string | undefined | null): string | null {
  if (!url?.startsWith(MEDIA_SCHEME)) return null;
  const id = url.slice(MEDIA_SCHEME.length).toLowerCase();
  return UUID.test(id) ? id : null;
}

/** El nombre para la base (1 a 250 caracteres), conservando la extensión si hay que cortarlo. */
function cleanName(name: string | undefined, mime: string): string {
  // eslint-disable-next-line no-control-regex
  const trimmed = (name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!trimmed) {
    const ext = Object.entries(EXTENSION_MIME).find(([, m]) => m === mime)?.[0] ?? 'bin';
    return `${mediaKind(mime) ?? 'file'}.${ext}`;
  }
  if (trimmed.length <= 250) return trimmed;
  const ext = /\.[A-Za-z0-9]{1,10}$/.exec(trimmed)?.[0] ?? '';
  return trimmed.slice(0, 250 - ext.length) + ext;
}

function backoff(failures: number): number {
  return Math.min(10_000 * 2 ** Math.max(0, failures - 1), MAX_BACKOFF_MS);
}

type Outcome = 'offline' | 'retry' | 'blocked' | 'waiting' | 'cancelled';

/** Qué hacer con un error: esperar la red, reintentar más tarde, o dejarlo a la vista hasta "Retry". */
function classify(err: unknown): Outcome {
  if (err instanceof UploadError && err.cancelled) return 'cancelled';
  if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
  if (err instanceof RemoteError) {
    if (err.network) return 'offline';
    if (err.message === 'file_not_found') return 'waiting';
    return err.permanent ? 'blocked' : 'retry';
  }
  if (err instanceof PorteroError) {
    if (err.status === 0) return 'offline';
    // 400: datos que no coinciden; 403: sin permiso; 404: el archivo no existe para el portero.
    if (err.status === 400 || err.status === 403 || err.status === 404) return 'blocked';
    // 401 (la sesión se está renovando), 409 (Drive sin conectar), 410, 429 y 5xx: se arreglan solos o
    // los arregla el dueño.
    return 'retry';
  }
  return 'retry';
}

function friendly(err: unknown): string {
  const message = errorMessage(err);
  if (message === 'page_not_found') return 'The page is not on the server, or you cannot edit it.';
  if (message === 'file_other_project') return 'This file belongs to another project.';
  return message;
}

/** Lo mínimo del portero que usa la cola (las pruebas usan uno en memoria). */
export type MediaPortero = Pick<Portero, 'upload' | 'pass'>;

export interface MediaQueueOptions {
  /** El cliente del portero para una dirección (`workspace_settings.media_url`). */
  portero: (baseUrl: string) => MediaPortero;
  /** El proyecto de una página (se guarda con el archivo). */
  projectOf?: (pageId: string) => string | undefined;
  probe?: (file: Blob, mime: string) => Promise<Probe>;
  playMark?: (thumb: Blob) => Promise<Blob>;
  now?: () => number;
}

export interface MediaStatus {
  /** Archivos y usos de páginas que faltan subir (sin contar los detenidos por un error). */
  pending: number;
  /** Detenidos por un error que no se arregla solo; siguen en el dispositivo. */
  failed: number;
  /** El último error de algo que se va a reintentar. */
  error: string | null;
  /** La subida en curso. */
  uploading: { name: string; sent: number; total: number } | null;
}

export interface MediaFailure {
  id: string;
  name: string;
  error: string;
}

/** Lo que el visor necesita para mostrar un archivo. */
export interface MediaSource {
  kind: MediaKind | null;
  name: string;
  /** El original, si está en este dispositivo. */
  original: Blob | null;
}

export class MediaQueue {
  /** Se agregó algo a la cola: conviene sincronizar pronto. */
  onQueued?: () => void;
  /** Cambió lo que muestra el estado (pendientes, errores, progreso). */
  onChange?: () => void;

  private url: string | null = null;
  private schemaReady = false;
  private running: Promise<void> | null = null;
  private again = false;
  private stopped = false;
  private controller: AbortController | null = null;
  private uploading: MediaStatus['uploading'] = null;
  /** Archivos elegidos que todavía se están guardando en el dispositivo. */
  private adding = 0;
  private readonly porteros = new Map<string, MediaPortero>();
  private readonly objectUrls = new Map<string, string>();
  private readonly resolving = new Map<string, Promise<string>>();
  /** Pares página:archivo ya vistos en esta sesión (en la cola o confirmados). */
  private readonly seenLinks = new Set<string>();
  private metaBatch: { ids: Set<string>; result: Promise<Map<string, KnownFile>> } | null = null;
  private readonly probe: (file: Blob, mime: string) => Promise<Probe>;
  private readonly playMark: (thumb: Blob) => Promise<Blob>;
  private readonly now: () => number;

  constructor(
    private readonly db: MediaDb,
    private readonly remote: MediaRemote,
    private readonly options: MediaQueueOptions,
  ) {
    this.probe = options.probe ?? probeMedia;
    this.playMark = options.playMark ?? withPlayMark;
    this.now = options.now ?? Date.now;
  }

  /** Lee lo que se sabía del workspace la última vez (para agregar archivos sin red). */
  async load(): Promise<void> {
    this.url = ((await this.db.get('meta', 'mediaUrl')) as string | null | undefined) ?? null;
    this.schemaReady = (await this.db.get('meta', 'schemaReady')) === true;
  }

  /**
   * Los ajustes del workspace, en cada sincronización: la dirección del portero y si la base ya tiene la
   * tabla de archivos. Se guardan para saber sin red si se puede agregar una foto o un video.
   */
  async configure(mediaUrl: string | null, schemaVersion: number): Promise<void> {
    const url = mediaUrl ? mediaUrl.replace(/\/+$/, '') : null;
    const ready = schemaVersion >= MEDIA_SCHEMA_VERSION;
    if (url === this.url && ready === this.schemaReady) return;
    this.url = url;
    this.schemaReady = ready;
    const tx = this.db.transaction('meta', 'readwrite');
    await Promise.all([tx.store.put(url, 'mediaUrl'), tx.store.put(ready, 'schemaReady'), tx.done]);
    this.onChange?.();
  }

  /** El workspace tiene portero y la base tiene la tabla de archivos: las fotos y videos van por acá. */
  get enabled(): boolean {
    return !!this.url && this.schemaReady;
  }

  get mediaUrl(): string | null {
    return this.url;
  }

  // --- agregar --------------------------------------------------------------------------------------

  /**
   * Guarda la foto o el video en el dispositivo (con medidas y miniatura) y lo pone en la cola. Devuelve
   * la dirección para el bloque `image`. Recién cuando esto termina el archivo está a salvo.
   */
  async add(pageId: string, file: Blob & { name?: string }): Promise<string> {
    this.adding++;
    try {
      return await this.store(pageId, file);
    } finally {
      this.adding--;
    }
  }

  /** Hay un archivo a medio guardar en el dispositivo: cerrar la app ahora lo perdería. */
  hasUnsavedWrites(): boolean {
    return this.adding > 0;
  }

  private async store(pageId: string, file: Blob & { name?: string }): Promise<string> {
    const mime = normalizeMime(file.type, file.name);
    const kind = mediaKind(mime);
    if (!kind || mime === 'image/svg+xml') throw new FileRejected('Only photos and videos can be added.');
    if (file.size <= 0) throw new FileRejected('This file is empty.');
    const probe = await this.probe(file, mime).catch((): Probe => ({ width: null, height: null, duration: null, thumb: null }));
    const id = crypto.randomUUID();
    const record: MediaRecord = {
      id,
      pageId,
      projectId: this.options.projectOf?.(pageId) ?? null,
      name: cleanName(file.name, mime),
      mime,
      size: file.size,
      width: dimension(probe.width),
      height: dimension(probe.height),
      duration: kind === 'video' ? seconds(probe.duration) : null,
      day: localDay(new Date(this.now())),
      createdAt: this.now(),
      pending: 1,
      registered: false,
      thumb: probe.thumb ? 'local' : 'none',
      uploadId: null,
      sent: 0,
      driveId: null,
      error: null,
      blocked: false,
      failures: 0,
      retryAt: 0,
    };
    // Todo junto: o queda el archivo con su registro, o no queda nada.
    try {
      const tx = this.db.transaction(['files', 'blobs', 'thumbs'], 'readwrite');
      await Promise.all([
        tx.objectStore('blobs').put(file, id),
        probe.thumb ? tx.objectStore('thumbs').put(probe.thumb, id) : undefined,
        tx.objectStore('files').put(record),
        tx.done,
      ]);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'QuotaExceededError') {
        throw new FileRejected('There is not enough free storage on this device for this file.');
      }
      throw err;
    }
    this.seenLinks.add(`${pageId}:${id}`);
    this.onQueued?.();
    return MEDIA_SCHEME + id;
  }

  /**
   * La página usa estos archivos. Los que todavía no están registrados para ella (se copió o se pegó el
   * bloque de otra página) entran a la cola de `link_page_file`. Lo ya visto no se vuelve a pedir.
   */
  async ensureLinks(pageId: string, fileIds: string[]): Promise<void> {
    let added = false;
    for (const fileId of new Set(fileIds.map((id) => id.toLowerCase()))) {
      const key = `${pageId}:${fileId}`;
      if (this.seenLinks.has(key) || !UUID.test(fileId)) continue;
      const tx = this.db.transaction(['links', 'files'], 'readwrite');
      const [link, own] = await Promise.all([tx.objectStore('links').get(key), tx.objectStore('files').get(fileId)]);
      // El archivo que se agregó en esta página se registra con ella (`register_file`).
      if (!link && own?.pageId !== pageId) {
        const fresh: MediaLink = { key, pageId, fileId, pending: 1, waiting: null, error: null, blocked: false, failures: 0, retryAt: 0 };
        await tx.objectStore('links').put(fresh);
        added = true;
      }
      await tx.done;
      this.seenLinks.add(key);
    }
    if (added) this.onQueued?.();
  }

  // --- subir ----------------------------------------------------------------------------------------

  /**
   * Una vuelta por la cola. Nunca hay dos a la vez: si ya hay una, se hace otra apenas termine. Nunca
   * tira. `skipPage`: páginas que todavía no existen en el servidor.
   */
  run(skipPage: (pageId: string) => boolean = () => false): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.round(skipPage).catch(() => undefined);
      } while (this.again && !this.stopped);
    })().finally(() => {
      this.running = null;
      this.uploading = null;
      this.onChange?.();
    });
    return this.running;
  }

  /** Deja de subir (otra ventana tomó el control o se cierra la app). Lo enviado queda para retomar. */
  stop(): void {
    this.stopped = true;
    this.controller?.abort();
  }

  /** Revoca las direcciones de las miniaturas en memoria. */
  dispose(): void {
    for (const url of this.objectUrls.values()) URL.revokeObjectURL(url);
    this.objectUrls.clear();
  }

  private async round(skipPage: (pageId: string) => boolean): Promise<void> {
    if (!this.enabled) return;
    const portero = this.porteroFor(this.url!);
    const records = (await this.db.getAllFromIndex('files', 'pending', 1)).sort((a, b) => a.createdAt - b.createdAt);
    for (const record of records) {
      if (this.stopped) return;
      if (record.blocked || record.retryAt > this.now() || skipPage(record.pageId)) continue;
      const outcome = await this.process(record, portero);
      if (outcome === 'offline' || outcome === 'cancelled') return;
    }
    const links = await this.db.getAllFromIndex('links', 'pending', 1);
    for (const link of links) {
      if (this.stopped) return;
      if (link.blocked || link.waiting === 'denied' || link.retryAt > this.now() || skipPage(link.pageId)) continue;
      if ((await this.linkOne(link)) === 'offline') return;
    }
  }

  private async process(start: MediaRecord, portero: MediaPortero): Promise<Outcome | 'done'> {
    let record = start;
    // Lo que el progreso guarda (la subida para retomar) va en orden, antes del resultado final.
    let saving: Promise<unknown> = Promise.resolve();
    try {
      if (!record.registered) {
        await this.remote.registerFile({
          id: record.id,
          pageId: record.pageId,
          name: record.name,
          mime: record.mime,
          size: record.size,
          width: record.width,
          height: record.height,
          duration: record.duration,
        });
        record = await this.patch(record.id, { registered: true });
      }
      if (record.thumb === 'local') {
        const thumb = await this.db.get('thumbs', record.id);
        if (thumb) {
          await this.remote.uploadThumb(record.id, thumb);
          await this.remote.setFileThumb(record.id);
        }
        record = await this.patch(record.id, { thumb: thumb ? 'done' : 'none' });
      }

      const blob = await this.db.get('blobs', record.id);
      if (!blob) {
        await this.patch(record.id, { error: 'The original file is missing on this device.', blocked: true });
        return 'blocked';
      }
      const file = new File([blob], record.name, { type: record.mime });
      const controller = new AbortController();
      this.controller = controller;
      let savedId = record.uploadId;
      this.setUploading({ name: record.name, sent: record.sent, total: record.size });
      const onProgress = (p: UploadProgress) => {
        this.setUploading({ name: record.name, sent: p.sent, total: p.total });
        if (p.uploadId !== savedId || p.sent !== record.sent) {
          savedId = p.uploadId;
          const changes = { uploadId: p.uploadId, sent: p.sent };
          saving = saving.then(() => this.patch(record.id, changes)).catch(() => undefined);
        }
      };
      let result;
      try {
        result = await portero.upload(file, {
          appFile: { id: record.id, day: record.day },
          resume: record.uploadId,
          signal: controller.signal,
          onProgress,
        });
      } finally {
        if (this.controller === controller) this.controller = null;
        await saving;
      }
      if (result.linked === false) {
        // Ya está en Drive, pero la base todavía no se enteró: el portero le vuelve a avisar cuando se le
        // pregunta de nuevo por el archivo.
        const failures = record.failures + 1;
        await this.patch(record.id, {
          driveId: result.id,
          uploadId: null,
          sent: record.size,
          error: 'Uploaded to Google Drive; waiting for the database to confirm it.',
          failures,
          retryAt: this.now() + backoff(failures),
        });
        return 'retry';
      }
      await this.patch(record.id, {
        pending: 0,
        driveId: result.id,
        uploadId: null,
        sent: record.size,
        error: null,
        blocked: false,
        failures: 0,
        retryAt: 0,
      });
      this.onChange?.();
      return 'done';
    } catch (err) {
      const outcome = classify(err);
      if (outcome === 'cancelled') return outcome;
      const failures = record.failures + 1;
      const changes: Partial<MediaRecord> = {
        error: friendly(err),
        blocked: outcome === 'blocked',
        failures,
        // Sin red no se espera: se vuelve a probar en la próxima sincronización (al volver la red).
        retryAt: outcome === 'offline' || outcome === 'blocked' ? 0 : this.now() + backoff(failures),
      };
      // Una subida que el portero ya no tiene se empieza de nuevo.
      if (err instanceof UploadError) Object.assign(changes, { uploadId: err.uploadId, sent: err.uploadId ? err.sent : 0 });
      await this.patch(record.id, changes).catch(() => undefined);
      this.onChange?.();
      return outcome === 'waiting' ? 'retry' : outcome;
    }
  }

  private async linkOne(link: MediaLink): Promise<Outcome | 'done'> {
    try {
      await this.remote.linkPageFile(link.pageId, link.fileId);
      await this.patchLink(link.key, { pending: 0, waiting: null, error: null, blocked: false, failures: 0, retryAt: 0 });
      return 'done';
    } catch (err) {
      const outcome = classify(err);
      if (outcome === 'offline') return outcome;
      const failures = link.failures + 1;
      const denied = errorMessage(err) === 'page_not_found';
      await this.patchLink(link.key, {
        // Que el archivo todavía no llegó (lo registra otro dispositivo) o que no se puede editar la página
        // no es un error de esta persona: se espera, sin contarlo como pendiente.
        waiting: outcome === 'waiting' ? 'file_not_found' : denied ? 'denied' : null,
        error: outcome === 'waiting' || denied ? null : friendly(err),
        blocked: outcome === 'blocked' && !denied,
        failures,
        retryAt: outcome === 'blocked' ? 0 : this.now() + backoff(failures),
      });
      this.onChange?.();
      return outcome;
    }
  }

  private async patch(id: string, changes: Partial<MediaRecord>): Promise<MediaRecord> {
    const tx = this.db.transaction('files', 'readwrite');
    const current = await tx.store.get(id);
    if (!current) throw new Error('The file is not in the queue anymore.');
    const next = { ...current, ...changes };
    await tx.store.put(next);
    await tx.done;
    return next;
  }

  private async patchLink(key: string, changes: Partial<MediaLink>): Promise<void> {
    const tx = this.db.transaction('links', 'readwrite');
    const current = await tx.store.get(key);
    if (current) await tx.store.put({ ...current, ...changes });
    await tx.done;
  }

  private setUploading(value: MediaStatus['uploading']): void {
    this.uploading = value;
    this.onChange?.();
  }

  private porteroFor(url: string): MediaPortero {
    let portero = this.porteros.get(url);
    if (!portero) {
      portero = this.options.portero(url);
      this.porteros.set(url, portero);
    }
    return portero;
  }

  // --- estado ---------------------------------------------------------------------------------------

  async status(): Promise<MediaStatus> {
    const [records, links] = await Promise.all([
      this.db.getAllFromIndex('files', 'pending', 1),
      this.db.getAllFromIndex('links', 'pending', 1),
    ]);
    const waiting = [...records.filter((r) => !r.blocked), ...links.filter((l) => !l.blocked && !l.waiting)];
    const errors = waiting.filter((w) => w.error);
    return {
      pending: waiting.length,
      failed: records.filter((r) => r.blocked).length + links.filter((l) => l.blocked).length,
      error: errors.length > 0 ? errors[errors.length - 1].error : null,
      uploading: this.uploading,
    };
  }

  /** Lo que quedó detenido por un error, para mostrarlo. */
  async failures(): Promise<MediaFailure[]> {
    const [records, links] = await Promise.all([
      this.db.getAllFromIndex('files', 'pending', 1),
      this.db.getAllFromIndex('links', 'pending', 1),
    ]);
    const out: MediaFailure[] = records
      .filter((r) => r.blocked)
      .map((r) => ({ id: r.id, name: r.name, error: r.error ?? 'Unknown error' }));
    for (const l of links.filter((x) => x.blocked)) {
      const name = (await this.db.get('files', l.fileId))?.name ?? (await this.db.get('known', l.fileId))?.name ?? l.fileId;
      out.push({ id: l.key, name: `${name} (copied to another page)`, error: l.error ?? 'Unknown error' });
    }
    return out;
  }

  /** Lo detenido por un error se vuelve a intentar (al abrir la app y con "Retry"). */
  async clearBlocked(): Promise<void> {
    const tx = this.db.transaction(['files', 'links'], 'readwrite');
    const files = tx.objectStore('files');
    for (const r of await files.index('pending').getAll(1)) {
      if (r.blocked || r.retryAt > 0) await files.put({ ...r, blocked: false, retryAt: 0 });
    }
    const links = tx.objectStore('links');
    for (const l of await links.index('pending').getAll(1)) {
      if (l.blocked || l.waiting || l.retryAt > 0) await links.put({ ...l, blocked: false, waiting: null, retryAt: 0 });
    }
    await tx.done;
    this.onChange?.();
  }

  /**
   * La base se restauró desde una copia de seguridad: lo registrado después de la copia ya no figura.
   * Todo lo de este dispositivo vuelve a la cola (los pasos son idempotentes; el portero recuerda lo que ya
   * subió a Drive y no lo vuelve a subir). Devuelve cuántas cosas volvieron.
   */
  async resetForRestore(): Promise<number> {
    let count = 0;
    const tx = this.db.transaction(['files', 'links', 'thumbs', 'known'], 'readwrite');
    const files = tx.objectStore('files');
    for (let cursor = await files.index('pending').openCursor(0); cursor; cursor = await cursor.continue()) {
      const r = cursor.value;
      const hasThumb = r.thumb !== 'none' && (await tx.objectStore('thumbs').count(r.id)) > 0;
      await cursor.update({ ...r, pending: 1, registered: false, thumb: hasThumb ? 'local' : 'none', driveId: null, retryAt: 0 });
      count++;
    }
    const links = tx.objectStore('links');
    for (let cursor = await links.index('pending').openCursor(0); cursor; cursor = await cursor.continue()) {
      await cursor.update({ ...cursor.value, pending: 1, waiting: null, retryAt: 0 });
      count++;
    }
    await tx.objectStore('known').clear();
    await tx.done;
    this.seenLinks.clear();
    return count;
  }

  // --- mostrar --------------------------------------------------------------------------------------

  /**
   * Convierte `sdmedia://<id>` en algo que un `<img>` pueda mostrar: una foto de este dispositivo, la
   * miniatura (guardada acá o bajada del bucket `thumbs`; en un video, con una marca de "play") o, si no
   * hay, un ícono. Nunca falla. Otra dirección vuelve tal cual.
   */
  resolve(url: string): Promise<string> {
    const id = mediaIdOf(url);
    if (!id) return Promise.resolve(url);
    const cached = this.objectUrls.get(id);
    if (cached) return Promise.resolve(cached);
    let pending = this.resolving.get(id);
    if (!pending) {
      pending = this.display(id).finally(() => this.resolving.delete(id));
      this.resolving.set(id, pending);
    }
    return pending;
  }

  private keep(id: string, blob: Blob): string {
    const url = URL.createObjectURL(blob);
    this.objectUrls.set(id, url);
    return url;
  }

  private async display(id: string): Promise<string> {
    try {
      const own = await this.db.get('files', id);
      if (own) {
        const kind = mediaKind(own.mime);
        // Una foto que el navegador pudo abrir se muestra entera, desde el dispositivo.
        if (kind === 'image' && own.thumb !== 'none') {
          const original = await this.db.get('blobs', id);
          if (original) return this.keep(id, original);
        }
        const thumb = await this.db.get('thumbs', id);
        if (thumb) return this.keep(id, kind === 'video' ? await this.playMark(thumb).catch(() => thumb) : thumb);
        return placeholderUrl(kind, own.name);
      }
      let thumb = await this.db.get('thumbs', id);
      let meta = await this.db.get('known', id);
      if (!meta || (!thumb && !meta.thumbAt)) meta = (await this.fetchMeta(id).catch(() => null)) ?? meta;
      if (!thumb && meta?.thumbAt) {
        thumb = await this.remote.downloadThumb(id).catch(() => undefined);
        if (thumb) await this.db.put('thumbs', thumb, id);
      }
      const kind = meta ? mediaKind(meta.mime) : null;
      if (thumb) return this.keep(id, kind === 'video' ? await this.playMark(thumb).catch(() => thumb) : thumb);
      return placeholderUrl(kind, meta?.name ?? 'Not available yet');
    } catch {
      return placeholderUrl(null, 'Not available on this device');
    }
  }

  /** Lo que la base sabe del archivo; los pedidos de una misma pasada van juntos. */
  private fetchMeta(id: string): Promise<KnownFile | null> {
    if (!this.metaBatch) {
      const ids = new Set<string>();
      const result = new Promise((resolve) => setTimeout(resolve, 20)).then(async () => {
        this.metaBatch = null;
        const rows = await this.remote.fetchMediaFiles([...ids]);
        const found = new Map<string, KnownFile>();
        for (const row of rows) {
          const known: KnownFile = {
            id: row.id,
            name: row.name,
            mime: row.mime,
            width: row.width,
            height: row.height,
            duration: row.duration,
            thumbAt: row.thumb_at,
            driveId: row.drive_id,
            fetchedAt: this.now(),
          };
          found.set(row.id, known);
          await this.db.put('known', known);
        }
        return found;
      });
      this.metaBatch = { ids, result };
    }
    this.metaBatch.ids.add(id);
    return this.metaBatch.result.then((found) => found.get(id) ?? null);
  }

  /** El original (si está en el dispositivo), el tipo y el nombre, para el visor. */
  async source(id: string): Promise<MediaSource> {
    const own = await this.db.get('files', id);
    if (own) return { kind: mediaKind(own.mime), name: own.name, original: (await this.db.get('blobs', id)) ?? null };
    const meta = (await this.db.get('known', id)) ?? (await this.fetchMeta(id).catch(() => null));
    return { kind: meta ? mediaKind(meta.mime) : null, name: meta?.name ?? '', original: null };
  }

  /** Un pase del portero para ver el archivo entero (vence a las 8 horas). */
  async pass(id: string): Promise<string> {
    if (!this.url) throw new Error('This workspace has no media server.');
    return this.porteroFor(this.url).pass({ file: id });
  }
}
