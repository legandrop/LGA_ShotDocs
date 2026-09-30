import { FileRejected } from '../sync/files';
import type { MediaRemote } from '../sync/remote';
import { errorMessage, RemoteError } from '../sync/types';
import type { KnownFile, MediaDb, MediaLink, MediaRecord } from './mediaDb';
import { AlreadySentError, PorteroError, UploadError, localDay, type Portero, type UploadProgress } from './portero';
import {
  DELETED_LABEL,
  deletedUrl,
  dimension,
  REQUESTED_LABEL,
  mediaKind,
  placeholderUrl,
  probeMedia,
  seconds,
  withPlayMark,
  type MediaKind,
  type Probe,
} from './probe';
import type { DueFileRow, MediaFileRow } from '../sync/types';

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
/** La versión de la base con la papelera de archivos (`unlink_page_file`, `trashed_files`, paso 11). */
export const TRASH_SCHEMA_VERSION = 6;
/**
 * Un archivo agregado en este dispositivo que el documento de su página nunca mostró (se agregó y se borró
 * enseguida, o el editor no llegó a poner el bloque) se da por quitado recién pasado este tiempo: entre
 * guardar el archivo y que el bloque aparezca en el documento pasa un instante.
 */
const OWN_GRACE_MS = 5 * 60_000;

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

/** Una fila nueva de usos: la página usa el archivo (`pending` 1: falta mandarlo). */
function newLink(pageId: string, fileId: string, pending: 0 | 1): MediaLink {
  return {
    key: `${pageId}:${fileId}`,
    pageId,
    fileId,
    pending,
    waiting: null,
    error: null,
    blocked: false,
    failures: 0,
    retryAt: 0,
    removed: false,
    rev: 0,
  };
}

/** Un bloque de otro proyecto pegado en la página: se anota, pero no se manda (se ve roto ahí). */
function foreignLink(pageId: string, fileId: string): MediaLink {
  return { ...newLink(pageId, fileId, 1), waiting: 'other_project' };
}

/** La misma fila con lo contrario por mandar (usado o quitado), desde cero y con otra revisión. */
function flipLink(link: MediaLink, removed: boolean): MediaLink {
  return {
    ...link,
    removed,
    rev: (link.rev ?? 0) + 1,
    pending: 1,
    waiting: null,
    error: null,
    blocked: false,
    failures: 0,
    retryAt: 0,
  };
}

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
    // La base apunta a otro archivo de Drive: no se arregla solo, lo tiene que ver el dueño.
    if (err.status === 409 && /different Drive file/i.test(err.message)) return 'blocked';
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
export type MediaPortero = Pick<Portero, 'upload' | 'pass' | 'trash'>;

export interface MediaQueueOptions {
  /** El cliente del portero para una dirección (`workspace_settings.media_url`). */
  portero: (baseUrl: string) => MediaPortero;
  /** El proyecto de una página (se guarda con el archivo). */
  projectOf?: (pageId: string) => string | undefined;
  probe?: (file: Blob, mime: string) => Promise<Probe>;
  playMark?: (thumb: Blob) => Promise<Blob>;
  now?: () => number;
  /**
   * La base de archivos del dispositivo no se pudo abrir: la cola queda apagada (las fotos y videos no se
   * pueden agregar) y este es el aviso. El resto de la app sigue.
   */
  unavailable?: string;
  /**
   * Se pegó en una página una foto o un video de otro proyecto: se ve roto ahí y no se registra como uso.
   * Para avisarle a la persona (con el nombre del archivo, si se sabe).
   */
  onForeignFile?: (name: string | null) => void;
}

/** Lo que se avisa al pegar una foto o un video de otro proyecto. */
export const FOREIGN_FILE_NOTICE = 'This photo belongs to another project: it will show broken here.';

/**
 * Una página de este dispositivo usa el archivo y todavía no se sincronizó: mandarlo a la papelera de Drive
 * podría llevarse algo que se sigue viendo. Se saltea.
 */
export class UnsentUseError extends Error {
  constructor() {
    super('A page on this device uses this file and has not synced yet, so it was skipped.');
    this.name = 'UnsentUseError';
  }
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
  /** La base tiene la papelera de archivos (versión 6): se puede mandar `unlink_page_file`. */
  private trashReady = false;
  /**
   * Por página, qué versión del documento ya se comparó con sus archivos (`<ediciones>:<cursor>:<quitar>`):
   * mientras no cambie, no se vuelve a leer. Se guarda en la base del dispositivo.
   */
  private usageMarks: Record<string, string> = {};
  /** Ver `isVerified`. Se guarda en la base del dispositivo. */
  private verified: Record<string, boolean> = {};
  /** Archivos cuyo estado en la papelera ya se preguntó en esta sesión (para mostrarlos como borrados). */
  private readonly deletedChecked = new Set<string>();
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
  /** Medidas y miniatura que se están sacando (una sola vez por archivo). */
  private readonly probing = new Map<string, Promise<void>>();
  /** Archivos de otros dispositivos que se mostraron sin miniatura: se vuelve a preguntar cada tanto. */
  private readonly missing = new Set<string>();
  private missingCheckedAt = 0;
  private readonly thumbListeners = new Set<(id: string) => void>();
  private readonly probe: (file: Blob, mime: string) => Promise<Probe>;
  private readonly playMark: (thumb: Blob) => Promise<Blob>;
  private readonly now: () => number;

  /** `db` en `null`: la base de archivos no se pudo abrir y la cola queda apagada (ver `unavailable`). */
  constructor(
    private readonly db: MediaDb | null,
    private readonly remote: MediaRemote,
    private readonly options: MediaQueueOptions,
  ) {
    this.probe = options.probe ?? probeMedia;
    this.playMark = options.playMark ?? withPlayMark;
    this.now = options.now ?? Date.now;
  }

  /** Por qué la cola está apagada en este dispositivo, o `null` si anda. */
  get unavailable(): string | null {
    return this.db ? null : (this.options.unavailable ?? 'The storage for photos and videos could not be opened.');
  }

  private get store(): MediaDb {
    if (!this.db) throw new Error(this.unavailable ?? 'unavailable');
    return this.db;
  }

  /** Lee lo que se sabía del workspace la última vez (para agregar archivos sin red). */
  async load(): Promise<void> {
    if (!this.db) return;
    this.url = ((await this.db.get('meta', 'mediaUrl')) as string | null | undefined) ?? null;
    this.schemaReady = (await this.db.get('meta', 'schemaReady')) === true;
    this.trashReady = (await this.db.get('meta', 'trashReady')) === true;
    const marks = await this.db.get('meta', 'usageMarks');
    this.usageMarks = marks && typeof marks === 'object' ? { ...(marks as Record<string, string>) } : {};
    const verified = await this.db.get('meta', 'verifiedPages');
    this.verified = verified && typeof verified === 'object' ? { ...(verified as Record<string, boolean>) } : {};
  }

  /**
   * Los ajustes del workspace, en cada sincronización: la dirección del portero y si la base ya tiene la
   * tabla de archivos. Se guardan para saber sin red si se puede agregar una foto o un video.
   */
  async configure(mediaUrl: string | null, schemaVersion: number): Promise<void> {
    const url = mediaUrl ? mediaUrl.replace(/\/+$/, '') : null;
    const ready = schemaVersion >= MEDIA_SCHEMA_VERSION;
    const trash = schemaVersion >= TRASH_SCHEMA_VERSION;
    if (!this.db || (url === this.url && ready === this.schemaReady && trash === this.trashReady)) return;
    this.url = url;
    this.schemaReady = ready;
    this.trashReady = trash;
    const tx = this.db.transaction('meta', 'readwrite');
    await Promise.all([
      tx.store.put(url, 'mediaUrl'),
      tx.store.put(ready, 'schemaReady'),
      tx.store.put(trash, 'trashReady'),
      tx.done,
    ]);
    this.onChange?.();
  }

  /** El workspace tiene portero y la base tiene la tabla de archivos: las fotos y videos van por acá. */
  get enabled(): boolean {
    return !!this.db && !!this.url && this.schemaReady;
  }

  get mediaUrl(): string | null {
    return this.url;
  }

  /** Se lleva la cuenta de qué archivos usa cada página (hay base de archivos y la base tiene `files`). */
  get tracksUsage(): boolean {
    return !!this.db && this.schemaReady;
  }

  /** La base tiene la papelera de archivos (versión 6). */
  get trashEnabled(): boolean {
    return !!this.db && this.schemaReady && this.trashReady;
  }

  // --- agregar --------------------------------------------------------------------------------------

  /**
   * Guarda la foto o el video en el dispositivo y lo pone en la cola. Devuelve la dirección para el bloque
   * `image`; recién cuando esto termina el archivo está a salvo. Medidas y miniatura se sacan después, del
   * archivo ya guardado (ver `ensureProbed`).
   */
  async add(pageId: string, file: Blob & { name?: string }): Promise<string> {
    this.adding++;
    try {
      return await this.save(pageId, file);
    } finally {
      this.adding--;
    }
  }

  /** Hay un archivo a medio guardar en el dispositivo: cerrar la app ahora lo perdería. */
  hasUnsavedWrites(): boolean {
    return this.adding > 0;
  }

  private async save(pageId: string, file: Blob & { name?: string }): Promise<string> {
    if (!this.db) throw new FileRejected(`Photos and videos cannot be added on this device right now: ${this.unavailable}`);
    const mime = normalizeMime(file.type, file.name);
    const kind = mediaKind(mime);
    if (!kind || mime === 'image/svg+xml') throw new FileRejected('Only photos and videos can be added.');
    if (file.size <= 0) throw new FileRejected('This file is empty.');
    const id = crypto.randomUUID();
    const record: MediaRecord = {
      id,
      pageId,
      projectId: this.options.projectOf?.(pageId) ?? null,
      name: cleanName(file.name, mime),
      mime,
      size: file.size,
      width: null,
      height: null,
      duration: null,
      day: localDay(new Date(this.now())),
      createdAt: this.now(),
      pending: 1,
      registered: false,
      thumb: 'none',
      probed: false,
      thumbError: null,
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
      const tx = this.db.transaction(['files', 'blobs'], 'readwrite');
      await Promise.all([tx.objectStore('blobs').put(file, id), tx.objectStore('files').put(record), tx.done]);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'QuotaExceededError') {
        throw new FileRejected('There is not enough free storage on this device for this file.');
      }
      throw err;
    }
    this.seenLinks.add(`${pageId}:${id}`);
    this.onQueued?.();
    // Medidas y miniatura, sin esperarlas: el archivo ya está a salvo. La cola no lo registra antes.
    void this.ensureProbed(id);
    return MEDIA_SCHEME + id;
  }

  /**
   * Saca medidas, duración y miniatura del archivo guardado, una sola vez (también si la app se cerró en
   * el medio: la cola lo hace antes de registrarlo). Nunca falla: lo que no se pudo sacar queda en `null`.
   */
  ensureProbed(id: string): Promise<void> {
    let running = this.probing.get(id);
    if (!running) {
      running = this.probeNow(id)
        .catch(() => undefined)
        .finally(() => this.probing.delete(id));
      this.probing.set(id, running);
    }
    return running;
  }

  /** Espera a que terminen las medidas y miniaturas en curso. */
  async idle(): Promise<void> {
    await Promise.all([...this.probing.values()]);
  }

  private async probeNow(id: string): Promise<void> {
    const db = this.store;
    const record = await db.get('files', id);
    if (!record || record.probed !== false) return;
    const blob = await db.get('blobs', id);
    const kind = mediaKind(record.mime);
    const none: Probe = { width: null, height: null, duration: null, thumb: null };
    const probe = blob ? await this.probe(blob, record.mime).catch(() => none) : none;
    const tx = db.transaction(['files', 'thumbs'], 'readwrite');
    const current = await tx.objectStore('files').get(id);
    if (current) {
      if (probe.thumb) await tx.objectStore('thumbs').put(probe.thumb, id);
      await tx.objectStore('files').put({
        ...current,
        width: dimension(probe.width),
        height: dimension(probe.height),
        duration: kind === 'video' ? seconds(probe.duration) : null,
        thumb: probe.thumb ? 'local' : 'none',
        probed: true,
      });
    }
    await tx.done;
    if (probe.thumb) this.thumbReady(id);
  }

  /**
   * Avisa cuando llega la miniatura de un archivo que ya se mostró sin ella (BlockNote resuelve la dirección
   * una sola vez: el editor cambia la imagen a mano). Devuelve la función para dejar de escuchar.
   */
  subscribeThumbs(fn: (id: string) => void): () => void {
    this.thumbListeners.add(fn);
    return () => this.thumbListeners.delete(fn);
  }

  private thumbReady(id: string): void {
    const old = this.objectUrls.get(id);
    if (old) URL.revokeObjectURL(old);
    this.objectUrls.delete(id);
    this.missing.delete(id);
    for (const fn of this.thumbListeners) fn(id);
  }

  /**
   * La página usa estos archivos. Los que todavía no están registrados para ella (se copió o se pegó el
   * bloque de otra página) entran a la cola de `link_page_file`, y uno que la página había dejado de usar
   * (se deshizo el borrado, se volvió a pegar) vuelve a la cola para reactivarlo. Lo ya visto no se vuelve
   * a pedir.
   */
  async ensureLinks(pageId: string, fileIds: string[]): Promise<void> {
    if (!this.db) return;
    let added = false;
    for (const fileId of new Set(fileIds.map((id) => id.toLowerCase()))) {
      const key = `${pageId}:${fileId}`;
      if (this.seenLinks.has(key) || !UUID.test(fileId)) continue;
      const tx = this.db.transaction(['links', 'files', 'known'], 'readwrite');
      const [link, own, known] = await Promise.all([
        tx.objectStore('links').get(key),
        tx.objectStore('files').get(fileId),
        tx.objectStore('known').get(fileId),
      ]);
      let foreign = false;
      if (link?.removed) {
        await tx.objectStore('links').put(flipLink(link, false));
        added = true;
      } else if (!link && own?.pageId !== pageId) {
        // El archivo que se agregó en esta página se registra con ella (`register_file`). Uno de otro
        // proyecto no se registra: se anota para esperar, sin mandar nada.
        foreign = this.isForeign(pageId, own?.projectId ?? known?.projectId);
        await tx.objectStore('links').put(foreign ? foreignLink(pageId, fileId) : newLink(pageId, fileId, 1));
        added = !foreign;
      }
      await tx.done;
      this.seenLinks.add(key);
      if (foreign) this.options.onForeignFile?.(own?.name ?? known?.name ?? null);
    }
    if (added) this.onQueued?.();
  }

  // --- qué archivos usa cada página (papelera de archivos) ------------------------------------------

  /**
   * Compara los archivos del documento de una página (`docIds`, ver `usage.ts`) con lo que este dispositivo
   * sabe que el servidor tiene, y pone en la cola la diferencia: lo nuevo, `link_page_file`; lo que ya no
   * está, `unlink_page_file`. Una sola fila por par, así que si el documento vuelve a tener el archivo antes
   * de mandar nada (deshacer), la fila vuelve a "usado" y nada se pisa.
   *
   * `unlink`: SOLO si el documento está completo y al día con el servidor. Un documento a medio bajar (o
   * que esta versión no puede leer entero) no dice que un archivo se quitó, dice que todavía no llegó:
   * entonces se suman los usos nuevos y nunca se quita ninguno. Devuelve si puso algo por mandar.
   */
  async reconcilePage(
    pageId: string,
    docIds: ReadonlySet<string>,
    { unlink, seenSeq }: { unlink: boolean; seenSeq?: number },
  ): Promise<boolean> {
    if (!this.db || !this.schemaReady) return false;
    const allowUnlink = unlink && this.trashReady;
    const tx = this.db.transaction(['links', 'files', 'known'], 'readwrite');
    const store = tx.objectStore('links');
    const [links, records, known] = await Promise.all([
      store.getAll(IDBKeyRange.bound(`${pageId}:`, `${pageId}:\uffff`)),
      tx.objectStore('files').getAll(),
      Promise.all([...docIds].map((id) => tx.objectStore('known').get(id))),
    ]);
    const projectOf = new Map<string, string | null | undefined>(records.map((r) => [r.id, r.projectId]));
    for (const k of known) if (k && !projectOf.has(k.id)) projectOf.set(k.id, k.projectId);
    const byFile = new Map(links.map((l) => [l.fileId, l]));
    const own = records.filter((r) => r.pageId === pageId);
    const ownIds = new Set(own.map((r) => r.id));
    const writes: MediaLink[] = [];
    for (const id of docIds) {
      const link = byFile.get(id);
      if (link) {
        if (link.removed) writes.push(flipLink(link, false));
      } else if (ownIds.has(id)) {
        // Lo registra `register_file` con esta página: solo se anota que el documento lo tiene, para saber
        // después si se quitó. No hay nada que mandar.
        writes.push(newLink(pageId, id, 0));
      } else if (this.isForeign(pageId, projectOf.get(id))) {
        // De otro proyecto (se pegó el bloque): se ve roto y no se registra como uso.
        writes.push(foreignLink(pageId, id));
      } else {
        writes.push(newLink(pageId, id, 1));
      }
    }
    if (allowUnlink) {
      for (const link of links) {
        if (!link.removed && !docIds.has(link.fileId)) writes.push({ ...flipLink(link, true), seenSeq });
      }
      // Agregado acá pero el documento nunca lo tuvo (se borró enseguida): pasado un rato, se quita.
      for (const r of own) {
        if (docIds.has(r.id) || byFile.has(r.id) || this.now() - r.createdAt < OWN_GRACE_MS) continue;
        writes.push({ ...newLink(pageId, r.id, 1), removed: true, rev: 1, seenSeq });
      }
    }
    await Promise.all([...writes.map((w) => store.put(w)), tx.done]);
    for (const w of writes) {
      if (w.removed) this.seenLinks.delete(w.key);
      else this.seenLinks.add(w.key);
    }
    return writes.some((w) => w.pending === 1 && !w.waiting);
  }

  /** El archivo es de otro proyecto que la página (si se saben los dos). */
  private isForeign(pageId: string, fileProject: string | null | undefined): boolean {
    const pageProject = this.options.projectOf?.(pageId);
    return !!fileProject && !!pageProject && fileProject !== pageProject;
  }

  /**
   * Algún uso del archivo en este dispositivo todavía no está confirmado por el servidor (por mandar,
   * detenido, esperando, sin permiso o de otro proyecto), o es un archivo agregado acá y todavía sin
   * registrar.
   */
  async hasUnsentUse(fileId: string, pending?: MediaLink[]): Promise<boolean> {
    if (!this.db) return false;
    const rows = pending ?? (await this.db.getAllFromIndex('links', 'pending', 1));
    if (rows.some((l) => l.fileId === fileId && !l.removed)) return true;
    const own = await this.db.get('files', fileId);
    return !!own && !own.registered;
  }

  /** Se vuelve a comparar la página con sus archivos en la próxima sincronización. */
  async forgetUsageMark(pageId: string): Promise<void> {
    if (!this.db || !(pageId in this.usageMarks)) return;
    const next = { ...this.usageMarks };
    delete next[pageId];
    await this.db.put('meta', next, 'usageMarks');
    this.usageMarks = next;
  }

  /**
   * Páginas cuyo historial entero en el servidor ya se comprobó legible con esta versión (ver
   * `SyncEngine.reconcileMedia`): una versión anterior pudo descartar un update ilegible sin anotarlo.
   */
  isVerified(pageId: string): boolean {
    return this.verified[pageId] === true;
  }

  async setVerified(pageId: string): Promise<void> {
    if (!this.db) return;
    const next = { ...this.verified, [pageId]: true };
    await this.db.put('meta', next, 'verifiedPages');
    this.verified = next;
  }

  /**
   * Si comparar la página con estos archivos quitaría alguno (para comprobar antes lo que haga falta). No
   * cambia nada.
   */
  async wouldUnlink(pageId: string, docIds: ReadonlySet<string>): Promise<boolean> {
    if (!this.db || !this.trashReady) return false;
    const [links, records] = await Promise.all([
      this.db.getAll('links', IDBKeyRange.bound(`${pageId}:`, `${pageId}:\uffff`)),
      this.db.getAll('files'),
    ]);
    if (links.some((l) => !l.removed && !docIds.has(l.fileId))) return true;
    const linked = new Set(links.map((l) => l.fileId));
    return records.some(
      (r) => r.pageId === pageId && !docIds.has(r.id) && !linked.has(r.id) && this.now() - r.createdAt >= OWN_GRACE_MS,
    );
  }

  /** Qué versión del documento de la página ya se comparó con sus archivos (`reconcilePage`). */
  usageMark(pageId: string): string | undefined {
    return this.usageMarks[pageId];
  }

  /** Anota las versiones ya comparadas, todas juntas. */
  async setUsageMarks(marks: Record<string, string>): Promise<void> {
    if (!this.db || Object.keys(marks).length === 0) return;
    const next = { ...this.usageMarks, ...marks };
    await this.db.put('meta', next, 'usageMarks');
    this.usageMarks = next;
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
    const db = this.store;
    const records = (await db.getAllFromIndex('files', 'pending', 1)).sort((a, b) => a.createdAt - b.createdAt);
    for (const record of records) {
      if (this.stopped) return;
      if (record.blocked || record.retryAt > this.now() || skipPage(record.pageId)) continue;
      const outcome = await this.process(record, portero);
      if (outcome === 'offline' || outcome === 'cancelled') return;
    }
    // Primero los usos nuevos y después los que se quitaron: un archivo que se cortó de una página y se pegó
    // en otra no pasa por la papelera en el medio.
    const links = (await db.getAllFromIndex('links', 'pending', 1)).sort((a, b) => Number(!!a.removed) - Number(!!b.removed));
    let stillPending: MediaLink[] | null = null;
    for (const link of links) {
      if (this.stopped) return;
      const waits = link.waiting === 'denied' || link.waiting === 'other_project';
      if (link.blocked || waits || link.retryAt > this.now() || skipPage(link.pageId)) continue;
      if (link.removed) {
        // Sin la papelera en la base no se manda (la función no existe todavía).
        if (!this.trashReady) continue;
        // Mientras este dispositivo tenga otro uso del mismo archivo sin confirmar (por mandar, detenido,
        // esperando, sin permiso o de otro proyecto; también un archivo propio sin registrar, que
        // `register_file` volvería a colgar de la página), no se quita: lo mandaría a la papelera mientras
        // se ve en otra página. Se lee después de mandar los usos nuevos de esta vuelta.
        stillPending ??= await db.getAllFromIndex('links', 'pending', 1);
        if (await this.hasUnsentUse(link.fileId, stillPending)) {
          if (link.waiting !== 'held') await this.patchLink(link.key, { waiting: 'held', error: null }, link.rev ?? 0);
          continue;
        }
      }
      if ((await this.linkOne(link)) === 'offline') return;
    }
    await this.refreshMissing().catch(() => undefined);
  }

  /**
   * Los archivos de otros dispositivos que se mostraron con un ícono porque todavía no tenían miniatura:
   * cada tanto se pregunta si ya la tienen, y si llegó, se baja y se avisa al editor.
   */
  private async refreshMissing(): Promise<void> {
    if (this.missing.size === 0 || this.now() - this.missingCheckedAt < 60_000) return;
    this.missingCheckedAt = this.now();
    const rows = await this.remote.fetchMediaFiles([...this.missing]);
    for (const row of rows) {
      if (!row.thumb_at) continue;
      const thumb = await this.remote.downloadThumb(row.id).catch(() => undefined);
      if (!thumb) continue;
      await this.store.put('thumbs', thumb, row.id);
      const known = await this.store.get('known', row.id);
      if (known) await this.store.put('known', { ...known, thumbAt: row.thumb_at, fetchedAt: this.now() });
      this.thumbReady(row.id);
    }
  }

  private async process(start: MediaRecord, portero: MediaPortero): Promise<Outcome | 'done'> {
    let record = start;
    // Lo que el progreso guarda (la subida para retomar) va en orden, antes del resultado final.
    let saving: Promise<unknown> = Promise.resolve();
    try {
      if (record.probed === false) {
        await this.ensureProbed(record.id);
        record = (await this.store.get('files', record.id)) ?? record;
      }
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
        const thumb = await this.store.get('thumbs', record.id);
        try {
          if (thumb) {
            await this.remote.uploadThumb(record.id, thumb);
            await this.remote.setFileThumb(record.id);
          }
          record = await this.patch(record.id, { thumb: thumb ? 'done' : 'none' });
        } catch (err) {
          // Si la miniatura no se puede subir nunca (por ejemplo, el bucket la rechaza), se sigue con el
          // original sin ella: queda anotado y en la página se ve la del dispositivo.
          if (classify(err) !== 'blocked') throw err;
          record = await this.patch(record.id, { thumb: 'none', thumbError: friendly(err) });
        }
      }

      const blob = await this.store.get('blobs', record.id);
      if (!blob) {
        await this.patch(record.id, { error: 'The original file is missing on this device.', blocked: true });
        return 'blocked';
      }
      const file = new File([blob], record.name, { type: record.mime });

      // Ya llegó a Drive en un intento anterior y solo falta que la base se entere: nunca se vuelve a
      // mandar. Se le pregunta al portero (que le avisa a la base) sin abrir una subida nueva.
      if (record.driveId) {
        if (!(await this.confirmed(record.id))) {
          try {
            await portero.upload(file, { appFile: { id: record.id, day: record.day }, onlyIfSent: true });
          } catch (err) {
            if (!(err instanceof AlreadySentError)) throw err;
            // El portero no sabe que llegó: se detiene. Recién con "Retry" se vuelve a subir entero.
            await this.patch(record.id, {
              driveId: null,
              uploadId: null,
              sent: 0,
              blocked: true,
              error: 'The media server does not know this file reached Google Drive. Retry uploads it again.',
            });
            this.onChange?.();
            return 'blocked';
          }
          if (!(await this.confirmed(record.id))) return this.waitForDatabase(record);
        }
        return this.markUploaded(record, record.driveId);
      }

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
      // Ya está en Drive. Se da por subido recién cuando la base lo confirma (`files.drive_id`), no por lo
      // que diga el portero. Si la base no se enteró (`linked: false`), el portero le vuelve a avisar cuando
      // se le pregunta de nuevo por el archivo (arriba, sin volver a subirlo).
      if (await this.confirmed(record.id)) return this.markUploaded(record, result.id);
      if (result.linked === undefined) {
        // Un portero anterior al paso 6: no manda `linked`, no le avisa a la base y lo que subió no sirve
        // (va a `Media_Test`, sin la marca del archivo). Se detiene: cada reintento lo subiría entero otra
        // vez. Con "Retry", después de actualizar el portero, se sube bien.
        await this.patch(record.id, {
          driveId: null,
          uploadId: null,
          sent: 0,
          blocked: true,
          error: 'The media server needs an update: the file reached Google Drive but the workspace was not told.',
        });
        this.onChange?.();
        return 'blocked';
      }
      record = await this.patch(record.id, { driveId: result.id, uploadId: null, sent: record.size });
      return this.waitForDatabase(record);
    } catch (err) {
      let outcome = classify(err);
      if (outcome === 'cancelled') return outcome;
      const failures = record.failures + 1;
      // El servidor dice que el archivo no existe aunque acá figura registrado (por ejemplo, se restauró la
      // base): se vuelve a registrar en vez de detenerlo. Si sigue igual después de varias veces, se detiene.
      const notThere =
        record.registered &&
        ((err instanceof PorteroError && err.status === 404) || errorMessage(err) === 'file_not_found');
      const lost = notThere ? (record.lost ?? 0) + 1 : 0;
      if (notThere) outcome = lost >= 3 ? 'blocked' : 'retry';
      const hasThumb = notThere && (await this.store.count('thumbs', record.id).catch(() => 0)) > 0;
      const changes: Partial<MediaRecord> = {
        error: friendly(err),
        blocked: outcome === 'blocked',
        failures,
        // Sin red no se espera: se vuelve a probar en la próxima sincronización (al volver la red).
        retryAt: outcome === 'offline' || outcome === 'blocked' ? 0 : this.now() + backoff(failures),
        lost,
        // Se vuelve a registrar y a marcar la miniatura (los dos son idempotentes).
        ...(notThere ? { registered: false, thumb: hasThumb ? 'local' : 'none' } : {}),
      };
      // Una subida que el portero ya no tiene se empieza de nuevo.
      if (err instanceof UploadError) Object.assign(changes, { uploadId: err.uploadId, sent: err.uploadId ? err.sent : 0 });
      await this.patch(record.id, changes).catch(() => undefined);
      this.onChange?.();
      return outcome === 'waiting' ? 'retry' : outcome;
    }
  }

  /** La base ya tiene el id de Drive del archivo. */
  private async confirmed(id: string): Promise<boolean> {
    const rows = await this.remote.fetchMediaFiles([id]);
    return !!rows.find((r) => r.id === id)?.drive_id;
  }

  /** En Drive, pero la base todavía no se enteró: se vuelve a preguntar más tarde. */
  private async waitForDatabase(record: MediaRecord): Promise<Outcome> {
    const failures = record.failures + 1;
    await this.patch(record.id, {
      error: 'Uploaded to Google Drive; waiting for the database to confirm it.',
      failures,
      retryAt: this.now() + backoff(failures),
    });
    this.onChange?.();
    return 'retry';
  }

  private async markUploaded(record: MediaRecord, driveId: string): Promise<'done'> {
    await this.patch(record.id, {
      pending: 0,
      lost: 0,
      driveId,
      uploadId: null,
      sent: record.size,
      error: null,
      blocked: false,
      failures: 0,
      retryAt: 0,
    });
    this.onChange?.();
    return 'done';
  }

  /** Manda un uso (`link_page_file`) o que se dejó de usar (`unlink_page_file`), según la fila. */
  private async linkOne(link: MediaLink): Promise<Outcome | 'done'> {
    try {
      if (link.removed) {
        const done = await this.remote.unlinkPageFile(link.pageId, link.fileId, link.seenSeq ?? null);
        if (!done) {
          // La página cambió en el servidor después del documento con el que se decidió: la base no hizo nada
          // (el uso sigue). Se vuelve a comparar con el documento nuevo en la próxima sincronización.
          await this.patchLink(
            link.key,
            { removed: false, rev: (link.rev ?? 0) + 1, pending: 0, waiting: null, error: null, blocked: false, failures: 0, retryAt: 0 },
            link.rev ?? 0,
          );
          await this.forgetUsageMark(link.pageId);
          return 'done';
        }
      } else {
        await this.remote.linkPageFile(link.pageId, link.fileId);
      }
      await this.patchLink(link.key, { pending: 0, waiting: null, error: null, blocked: false, failures: 0, retryAt: 0 }, link.rev ?? 0);
      return 'done';
    } catch (err) {
      const outcome = classify(err);
      if (outcome === 'offline') return outcome;
      if (!link.removed && errorMessage(err) === 'file_other_project') {
        // Se pegó un bloque de otro proyecto: se ve roto y no se registra como uso. No es un error por
        // reintentar; se avisa una vez.
        await this.patchLink(link.key, { waiting: 'other_project', error: null, blocked: false }, link.rev ?? 0);
        const name = (await this.store.get('known', link.fileId).catch(() => undefined))?.name ?? null;
        this.options.onForeignFile?.(name);
        this.onChange?.();
        return 'done';
      }
      const failures = link.failures + 1;
      const denied = errorMessage(err) === 'page_not_found';
      // Un archivo de este dispositivo que figura registrado pero el servidor no tiene (se restauró la base):
      // vuelve a la cola para registrarlo de nuevo.
      if (outcome === 'waiting') await this.requeueOwn(link.fileId);
      await this.patchLink(
        link.key,
        {
          // Que el archivo todavía no llegó (lo registra otro dispositivo) o que no se puede editar la página
          // no es un error de esta persona: se espera, sin contarlo como pendiente.
          waiting: outcome === 'waiting' ? 'file_not_found' : denied ? 'denied' : null,
          error: outcome === 'waiting' || denied ? null : friendly(err),
          blocked: outcome === 'blocked' && !denied,
          failures,
          retryAt: outcome === 'blocked' ? 0 : this.now() + backoff(failures),
        },
        link.rev ?? 0,
      );
      this.onChange?.();
      return outcome;
    }
  }

  private async requeueOwn(fileId: string): Promise<void> {
    const own = await this.store.get('files', fileId);
    if (!own?.registered) return;
    const hasThumb = (await this.store.count('thumbs', fileId)) > 0;
    await this.patch(fileId, {
      pending: 1,
      registered: false,
      thumb: hasThumb ? 'local' : 'none',
      driveId: null,
      blocked: false,
      retryAt: 0,
    });
  }

  private async patch(id: string, changes: Partial<MediaRecord>): Promise<MediaRecord> {
    const tx = this.store.transaction('files', 'readwrite');
    const current = await tx.store.get(id);
    if (!current) throw new Error('The file is not in the queue anymore.');
    const next = { ...current, ...changes };
    await tx.store.put(next);
    await tx.done;
    return next;
  }

  /**
   * Cambia una fila de usos. Con `rev`, solo si la fila no cambió mientras tanto (el documento volvió a
   * tener o dejó de tener el archivo mientras viajaba el pedido): lo nuevo sigue pendiente.
   */
  private async patchLink(key: string, changes: Partial<MediaLink>, rev?: number): Promise<void> {
    const tx = this.store.transaction('links', 'readwrite');
    const current = await tx.store.get(key);
    if (current && (rev === undefined || (current.rev ?? 0) === rev)) await tx.store.put({ ...current, ...changes });
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
    if (!this.db) return { pending: 0, failed: 0, error: null, uploading: null };
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
    if (!this.db) return [];
    const [records, links] = await Promise.all([
      this.db.getAllFromIndex('files', 'pending', 1),
      this.db.getAllFromIndex('links', 'pending', 1),
    ]);
    const out: MediaFailure[] = records
      .filter((r) => r.blocked)
      .map((r) => ({ id: r.id, name: r.name, error: r.error ?? 'Unknown error' }));
    for (const l of links.filter((x) => x.blocked)) {
      const name = (await this.db.get('files', l.fileId))?.name ?? (await this.db.get('known', l.fileId))?.name ?? l.fileId;
      const what = l.removed ? 'removed from a page' : 'copied to another page';
      out.push({ id: l.key, name: `${name} (${what})`, error: l.error ?? 'Unknown error' });
    }
    return out;
  }

  /** Lo detenido por un error se vuelve a intentar (al abrir la app y con "Retry"). */
  async clearBlocked(): Promise<void> {
    if (!this.db) return;
    const tx = this.db.transaction(['files', 'links'], 'readwrite');
    const files = tx.objectStore('files');
    for (const r of await files.index('pending').getAll(1)) {
      // Lo detenido se vuelve a registrar (`register_file` es idempotente): puede que el servidor lo haya
      // perdido (una copia restaurada).
      if (r.blocked) await files.put({ ...r, blocked: false, retryAt: 0, registered: false, failures: 0, lost: 0 });
      else if (r.retryAt > 0) await files.put({ ...r, retryAt: 0 });
    }
    const links = tx.objectStore('links');
    for (const l of await links.index('pending').getAll(1)) {
      // Un bloque de otro proyecto no se vuelve a intentar: el servidor lo rechazaría igual (y se avisaría otra vez).
      if (l.waiting === 'other_project') continue;
      if (l.blocked || l.waiting || l.retryAt > 0) await links.put({ ...l, blocked: false, waiting: null, retryAt: 0 });
    }
    await tx.done;
    this.onChange?.();
  }

  /**
   * La generación del workspace (sube al restaurar una copia de seguridad). La cola guarda la última que vio
   * en su propia base: si cambió, hace su parte (`resetForRestore`) y recién después guarda la nueva. Así,
   * si su base falla o está cerrada, lo hace en la próxima sincronización o al abrirse, sin frenar el texto.
   * Sin generación guardada vale 1, como en el árbol. Devuelve cuántas cosas volvieron a la cola.
   */
  async syncGeneration(generation: number): Promise<number> {
    if (!this.db) return 0;
    const known = ((await this.db.get('meta', 'generation')) as number | undefined) ?? 1;
    if (known === generation) return 0;
    const count = await this.resetForRestore();
    await this.db.put('meta', generation, 'generation');
    return count;
  }

  /**
   * La base se restauró desde una copia de seguridad: lo registrado después de la copia ya no figura.
   * Todo lo de este dispositivo vuelve a la cola (los pasos son idempotentes; el portero recuerda lo que ya
   * subió a Drive y no lo vuelve a subir). Devuelve cuántas cosas volvieron.
   */
  async resetForRestore(): Promise<number> {
    if (!this.db) return 0;
    let count = 0;
    const tx = this.db.transaction(['files', 'links', 'thumbs', 'known'], 'readwrite');
    // Todos, también los que estaban a medio subir: lo que ya habían registrado puede no estar más.
    const files = tx.objectStore('files');
    for (let cursor = await files.openCursor(); cursor; cursor = await cursor.continue()) {
      const r = cursor.value;
      const hasThumb = (await tx.objectStore('thumbs').count(r.id)) > 0;
      await cursor.update({
        ...r,
        pending: 1,
        registered: false,
        thumb: hasThumb ? 'local' : 'none',
        driveId: null,
        blocked: false,
        failures: 0,
        lost: 0,
        error: null,
        retryAt: 0,
      });
      count++;
    }
    const links = tx.objectStore('links');
    for (let cursor = await links.openCursor(); cursor; cursor = await cursor.continue()) {
      await cursor.update({ ...cursor.value, pending: 1, waiting: null, blocked: false, error: null, failures: 0, retryAt: 0 });
      count++;
    }
    await tx.objectStore('known').clear();
    await tx.done;
    this.seenLinks.clear();
    // Cada página se vuelve a comparar con sus archivos.
    this.usageMarks = {};
    await this.db.delete('meta', 'usageMarks');
    return count;
  }

  // --- mostrar --------------------------------------------------------------------------------------

  /**
   * Convierte `sdmedia://<id>` en algo que un `<img>` pueda mostrar en la página: la miniatura (la hecha
   * acá o la bajada del bucket `thumbs`; en un video, con una marca de "play") o, si no hay, un ícono con el
   * nombre. El original solo lo muestra el carrete. Nunca falla. Otra dirección vuelve tal cual.
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
      const db = this.store;
      // Mandado a la papelera de Drive (papelera de archivos): ni roto ni pendiente, borrado, con la
      // miniatura si la hay.
      const cached = await db.get('known', id);
      if (cached?.deleted) return await this.deletedDisplay(id, cached, mediaKind(cached.mime));
      // Lo que se sabía puede ser de antes: se pregunta una vez por sesión y, si resulta borrado, el editor
      // cambia la imagen (como cuando llega una miniatura).
      void this.checkDeleted(id);
      const own = await db.get('files', id);
      if (own) {
        const kind = mediaKind(own.mime);
        const thumb = await db.get('thumbs', id);
        if (thumb) return this.keep(id, kind === 'video' ? await this.playMark(thumb).catch(() => thumb) : thumb);
        // Si todavía se está sacando, `subscribeThumbs` avisa cuando llega.
        return placeholderUrl(kind, own.name);
      }
      let thumb = await db.get('thumbs', id);
      let meta = await db.get('known', id);
      if (!meta || (!thumb && !meta.thumbAt)) meta = (await this.fetchMeta(id).catch(() => null)) ?? meta;
      if (!thumb && meta?.thumbAt) {
        thumb = await this.remote.downloadThumb(id).catch(() => undefined);
        if (thumb) await db.put('thumbs', thumb, id);
      }
      const kind = meta ? mediaKind(meta.mime) : null;
      if (meta?.deleted) return await this.deletedDisplay(id, meta, kind);
      if (thumb) return this.keep(id, kind === 'video' ? await this.playMark(thumb).catch(() => thumb) : thumb);
      // Sin miniatura todavía (otro dispositivo la está subiendo, o no hay red): se vuelve a preguntar.
      this.missing.add(id);
      return placeholderUrl(kind, meta?.name ?? 'Not available yet');
    } catch {
      return placeholderUrl(null, 'Not available on this device');
    }
  }

  /** La foto o el video que un dueño o admin mandó a la papelera de Drive. */
  private async deletedDisplay(id: string, meta: KnownFile, kind: MediaKind | null): Promise<string> {
    const thumb = this.db ? await this.db.get('thumbs', id).catch(() => undefined) : undefined;
    // Pedido y confirmado por el portero, o solo pedido (Drive falló: se puede volver a pedir desde la
    // papelera). Sin el dato (guardado antes), se lo da por confirmado.
    const notice = meta.inDriveTrash === false ? REQUESTED_LABEL : DELETED_LABEL;
    return deletedUrl(kind, meta.name, thumb ?? null, notice);
  }

  /**
   * Pregunta a la base (una vez por sesión y por archivo, junto con los demás de la misma pasada) si el
   * archivo se mandó a la papelera de Drive; si sí, avisa al editor para que lo vuelva a mostrar.
   */
  private async checkDeleted(id: string): Promise<void> {
    if (this.deletedChecked.has(id)) return;
    this.deletedChecked.add(id);
    try {
      const meta = await this.fetchMeta(id);
      if (!meta?.deleted) return;
      // Si se está mostrando justo ahora, se espera a que termine para que no quede la imagen de antes.
      await this.resolving.get(id)?.catch(() => undefined);
      this.thumbReady(id);
    } catch {
      // Sin red: se vuelve a preguntar la próxima vez que se muestre.
      this.deletedChecked.delete(id);
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
            deleted: isDeletedRow(row),
            inDriveTrash: !!row.drive_trashed_at,
            projectId: row.project_id ?? null,
            fetchedAt: this.now(),
          };
          found.set(row.id, known);
          // Sin base de archivos en el dispositivo se usa igual, sin guardarlo.
          if (this.db) await this.db.put('known', known);
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
    if (!this.db) {
      // Sin base de archivos: el tipo y el nombre salen del servidor (no hay original en el dispositivo).
      const meta = await this.fetchMeta(id).catch(() => null);
      return { kind: meta ? mediaKind(meta.mime) : null, name: meta?.name ?? '', original: null };
    }
    const db = this.db;
    const own = await db.get('files', id);
    if (own) return { kind: mediaKind(own.mime), name: own.name, original: (await db.get('blobs', id)) ?? null };
    const meta = (await db.get('known', id)) ?? (await this.fetchMeta(id).catch(() => null));
    return { kind: meta ? mediaKind(meta.mime) : null, name: meta?.name ?? '', original: null };
  }

  /**
   * La miniatura tal cual, sin la marca de "play" (el carrete la muestra mientras carga la foto grande, y
   * de póster del video), o `null` si no hay. No baja nada que `resolve` no baje.
   */
  async thumbnail(id: string): Promise<string | null> {
    await this.resolve(MEDIA_SCHEME + id);
    const key = `thumb:${id}`;
    const cached = this.objectUrls.get(key);
    if (cached) return cached;
    const thumb = this.db ? await this.db.get('thumbs', id).catch(() => undefined) : undefined;
    return thumb ? this.keep(key, thumb) : null;
  }

  /** Un pase del portero para ver el archivo entero (vence a las 8 horas). */
  async pass(id: string): Promise<string> {
    if (!this.url) throw new Error('This workspace has no media server.');
    return this.porteroFor(this.url).pass({ file: id });
  }

  // --- papelera de archivos -------------------------------------------------------------------------

  /**
   * Pide al portero que mande un archivo de la papelera a la papelera de Drive (`POST /trash`; solo dueño y
   * admins, lo decide la base). Nunca lo borra: Drive lo guarda 30 días. Tira `PorteroError` con el estado
   * del portero (409: una página lo volvió a usar).
   */
  async trash(id: string): Promise<void> {
    if (!this.url) throw new PorteroError('This workspace has no media server.', 0);
    await this.porteroFor(this.url).trash(id);
    // En este dispositivo, desde ya se muestra como borrado si alguna página lo vuelve a tener: se vuelve a
    // leer de la base (queda guardado) y, si eso falla, se marca lo que había.
    this.deletedChecked.add(id);
    const meta = await this.fetchMeta(id).catch(() => null);
    if (!meta?.deleted && this.db) {
      const known = await this.db.get('known', id).catch(() => undefined);
      if (known) await this.db.put('known', { ...known, deleted: true }).catch(() => undefined);
    }
    this.thumbReady(id);
  }

  /**
   * El borrado automático a los 30 días (paso 11), armado y APAGADO: con `enabled` en `false`
   * (`workspace_settings.auto_purge_files`, hoy siempre) no pregunta ni manda nada. Prendido, pide a la
   * base los vencidos de cada proyecto (`files_due_for_purge`, solo dueño y admins) y se los pasa al
   * portero de a uno; un error no corta los demás. Devuelve cuántos mandó.
   */
  async autoPurge(enabled: boolean, projectIds: string[]): Promise<number> {
    if (!this.url) return 0;
    return autoPurgeFiles({
      enabled,
      projectIds,
      due: (projectId) => this.remote.filesDueForPurge(projectId),
      trash: (id) => this.trash(id),
    });
  }
}

/** Un dueño o admin lo mandó a la papelera de Drive (pedido o ya confirmado por el portero). */
export function isDeletedRow(row: Pick<MediaFileRow, 'purged_at' | 'drive_trashed_at'>): boolean {
  return !!(row.purged_at || row.drive_trashed_at);
}

export interface AutoPurgeOptions {
  /** `workspace_settings.auto_purge_files`. Apagado, no se llama a nada. */
  enabled: boolean;
  projectIds: string[];
  due: (projectId: string) => Promise<DueFileRow[]>;
  trash: (fileId: string) => Promise<unknown>;
}

/**
 * Manda a la papelera de Drive los archivos que cumplieron 30 días en la papelera, de a uno. Detrás del
 * interruptor: si está apagado vuelve sin llamar a nada. Un proyecto que la base no deja (`not_allowed`) o
 * un archivo que falla no cortan el resto. Devuelve cuántos mandó.
 */
export async function autoPurgeFiles({ enabled, projectIds, due, trash }: AutoPurgeOptions): Promise<number> {
  if (enabled !== true) return 0;
  let sent = 0;
  for (const projectId of projectIds) {
    const rows = await due(projectId).catch(() => [] as DueFileRow[]);
    for (const row of rows) {
      try {
        await trash(row.id);
        sent++;
      } catch {
        // Queda para la próxima vez que se abra la app.
      }
    }
  }
  return sent;
}
