import { localize, stored, t } from '../i18n';
import { FileRejected } from '../sync/files';
import type { MediaRemote } from '../sync/remote';
import { errorMessage, isNetworkError, isTimeout, RemoteError } from '../sync/types';
import { attachmentCardUrl, cleanFileName, EXTENSION_MIME, fileKind, mimeFromName, type FileKind } from './attachments';
import type { KnownFile, MediaDb, MediaLink, MediaRecord } from './mediaDb';
import { AlreadySentError, PorteroError, UploadError, localDay, type Portero, type UploadProgress } from './portero';
import {
  deletedLabel,
  deletedUrl,
  dimension,
  requestedLabel,
  placeholderUrl,
  probeMedia,
  seconds,
  THUMB_SIDE,
  VIEW_GAIN,
  VIEW_SIDE,
  VIEW_SIDE_SMALL,
  viewImage,
  withPlayMark,
  type MediaKind,
  type Probe,
} from './probe';
import type { DueFileRow, MediaFileRow } from '../sync/types';
import { HeicError, heicFailure, isHeicFile, isHeicType, jpegName, JPEG_TYPE } from './heic';

// La cola de fotos y videos (paso 6 de Docs/Plan_Workspaces.md; Docs/Doc_Sincronizacion.md, "Archivos
// grandes"). El archivo se guarda primero en el dispositivo (base `<base local>:media`) y en la página queda
// un bloque `image` con `sdmedia://<id>`. Después, cuando hay red y con su propio ciclo (una subida de
// minutos no frena al texto): `register_file` → miniatura a `thumbs` + `set_file_thumb` → portero, por
// partes y retomando lo que ya llegó → subido cuando el portero responde `done`. Cada paso es idempotente
// y queda anotado, así que se puede cortar en cualquier momento. Nada se descarta: un error queda a la
// vista y el archivo sigue en el dispositivo.

/** Dirección de un archivo grande en el documento. No depende de ningún servidor. */
export const MEDIA_SCHEME = 'sdmedia://';
/** La imagen nítida de la página se guarda en `thumbs` con esta clave delante del id (ver `MediaQueue.view`). */
export const VIEW_PREFIX = 'view:';
/** La chica (1024 px), para una foto que se ve chica (un teléfono): menos lugar y menos memoria. */
export const VIEW_SMALL_PREFIX = 'view1024:';
/** Los tamaños de la imagen nítida, de mayor a menor. */
const VIEW_SIDES = [VIEW_SIDE, VIEW_SIDE_SMALL];
/** La clave de la imagen nítida guardada. */
export function viewKey(id: string, side: number): string {
  return (side === VIEW_SIDE_SMALL ? VIEW_SMALL_PREFIX : VIEW_PREFIX) + id;
}
/** Dónde se anotan (en `meta`) las imágenes nítidas guardadas, en el orden en que se usaron. */
const VIEW_INDEX_KEY = 'viewIndex';
/** Lo más que ocupan en el dispositivo las imágenes nítidas guardadas: las más viejas se borran. */
export const VIEW_STORE_MAX_BYTES = 150 * 1024 * 1024;
export const VIEW_STORE_MAX_COUNT = 800;
/** Cuántas direcciones de imágenes nítidas se guardan en memoria (las que no se muestran se sueltan). */
export const VIEW_URLS_MAX = 60;

/** Una imagen nítida lista: su dirección y el lado mayor para el que se hizo. */
export interface SharpView {
  url: string;
  side: number;
}
/** Lo más grande que se baja del portero para hacer la imagen nítida de la página (el carrete baja cualquiera). */
export const VIEW_FETCH_MAX_BYTES = 25 * 1024 * 1024;
/** Fotos que todos los navegadores abren: las demás (HEIC, TIFF, RAW) no se bajan para la página. */
export const VIEW_FETCH_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/bmp']);
/** Después de una bajada que falló, cuánto se espera para volver a probar (la primera vez; después, ×4). */
export const VIEW_RETRY_MS = 60_000;
/** Lo más que se espera entre intentos de bajar el mismo original. */
export const VIEW_RETRY_MAX_MS = 60 * 60_000;
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

/**
 * El tipo como lo pide la base: minúsculas, `tipo/subtipo`, sin parámetros. Si el navegador no lo da, sale
 * de la extensión (fotos, videos y los adjuntos conocidos: PDF, ZIP, RAR, NK...); si tampoco,
 * `application/octet-stream`.
 */
export function normalizeMime(type: string | undefined, name = ''): string {
  const base = (type ?? '').split(';')[0].trim().toLowerCase();
  if (base.length <= 200 && MIME.test(base) && base !== 'application/octet-stream') return base;
  return mimeFromName(name) ?? 'application/octet-stream';
}

/** Fotos y videos que se muestran; SVG (puede traer scripts), PSD, EXR y compañía son adjuntos. */
export function isMediaFile(file: { type: string; name?: string }): boolean {
  return fileKind(normalizeMime(file.type, file.name), file.name) !== 'file';
}

/** El id de una dirección `sdmedia://<id>`, o `null` si no es una. */
export function mediaIdOf(url: string | undefined | null): string | null {
  if (!url?.startsWith(MEDIA_SCHEME)) return null;
  const id = url.slice(MEDIA_SCHEME.length).toLowerCase();
  return UUID.test(id) ? id : null;
}

/**
 * El nombre para la base (1 a 250 caracteres), limpio (`cleanFileName`) y conservando la extensión si hay que
 * cortarlo. Sin nombre, uno genérico con la extensión del tipo (`image.jpg`, `file.pdf`).
 */
function cleanName(name: string | undefined, mime: string): string {
  const clean = cleanFileName(name ?? '');
  if (clean !== 'file.bin' || /file\.bin$/i.test((name ?? '').trim())) return clean;
  const ext = Object.entries(EXTENSION_MIME).find(([, m]) => m === mime)?.[0] ?? 'bin';
  return `${fileKind(mime)}.${ext}`;
}

/** Desde este peso, antes de guardar se pregunta cuánto lugar queda. */
const BIG_FILE = 50 * 1024 * 1024;
/**
 * Lo que se deja libre siempre: el texto de las páginas vive en la misma cuota, y quedarse sin lugar ahí es
 * mucho peor que no poder agregar un archivo.
 */
const ROOM_MARGIN = 200 * 1024 * 1024;

/** El almacenamiento del navegador, si lo expone. */
function storageManager(): StorageManager | undefined {
  try {
    return (globalThis as { navigator?: Navigator }).navigator?.storage;
  } catch {
    return undefined;
  }
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

/**
 * Cada tantas trabadas seguidas sin que la subida avance (`MediaRecord.stalls`), al retomarla se abre otra si
 * la que hay todavía no recibió nada (`renewIfEmpty` del portero). Dos y no una: la primera puede ser un
 * corte de la red, y retomar la misma no cuesta nada.
 */
export const STALLS_BEFORE_RENEW = 2;

/** Qué hacer con un error: esperar la red, reintentar más tarde, o dejarlo a la vista hasta "Retry". */
export function classify(err: unknown): Outcome {
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
    // 507: el Drive del dueño está lleno (portero desde v0.048). Mandar otra vez 8 MiB cada tanto no lo
    // arregla: queda a la vista con el aviso hasta que el dueño haga lugar y se toque "Retry".
    if (err.status === 507) return 'blocked';
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
  if (message === 'page_not_found') return stored('queue.pageNotFound');
  if (message === 'file_other_project') return stored('queue.otherProject');
  return message;
}

/**
 * Lo mínimo del portero que usa la cola (las pruebas usan uno en memoria). `passInfo`, si el cliente lo tiene:
 * el pase con la marca `named` de un portero que ya sirve los archivos con su nombre.
 */
export type MediaPortero = Pick<Portero, 'upload' | 'pass' | 'trash'> & {
  passInfo?: (target: { file: string }) => Promise<{ url: string; named: boolean }>;
};

export interface MediaQueueOptions {
  /** El cliente del portero para una dirección (`workspace_settings.media_url`). */
  portero: (baseUrl: string) => MediaPortero;
  /** El proyecto de una página (se guarda con el archivo). */
  projectOf?: (pageId: string) => string | undefined;
  probe?: (file: Blob, mime: string) => Promise<Probe>;
  playMark?: (thumb: Blob) => Promise<Blob>;
  /** La imagen para la página cuando la miniatura queda chica (ver `MediaQueue.view`), de lado mayor `side`. */
  viewImage?: (file: Blob, mime: string, side: number) => Promise<Blob | null>;
  /** Tope de lo que ocupan las imágenes nítidas guardadas (por defecto `VIEW_STORE_MAX_BYTES`; las pruebas). */
  viewStoreMaxBytes?: number;
  /** Si una dirección de imagen nítida se está mostrando (por defecto, las imágenes del documento). */
  viewInUse?: (url: string) => boolean;
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
  /**
   * Pasa un HEIC a JPEG (por defecto, `heicConvert.ts`, que se carga recién cuando llega un HEIC). Tira un
   * `HeicError` si no se pudo. Las pruebas ponen uno propio.
   */
  convertHeic?: (file: Blob) => Promise<Blob>;
}

/** El conversor de verdad, cargado con `import()` la primera vez que llega un HEIC. */
async function loadAndConvertHeic(file: Blob): Promise<Blob> {
  let mod: typeof import('./heicConvert');
  try {
    mod = await import('./heicConvert');
  } catch (err) {
    throw new HeicError('unavailable', `The HEIC converter could not be loaded (${errorMessage(err)}).`);
  }
  return mod.convertHeic(file);
}

/** Lo que dice en la página, en el lugar de una foto HEIC que no se ve (ver `MediaRecord.heic`). */
export function heicNotice(mark: MediaRecord['heic'] | null): string {
  if (mark === 'retry') return t('queue.heicPending');
  if (mark === 'failed') return t('queue.heicFailed');
  return t('queue.heicNoPreview');
}

/** Lo que se ve en una página en lugar de una foto o un video de otro proyecto. */
export function foreignPlaceholder(): string {
  return t('queue.foreignPlaceholder');
}

/** Lo que se avisa al pegar una foto o un video de otro proyecto (con el nombre, si se sabe). */
export function foreignFileNotice(name: string | null): string {
  return name ? t('queue.foreignNoticeNamed', { name }) : t('queue.foreignNotice');
}

/**
 * Una página de este dispositivo usa el archivo y todavía no se sincronizó: mandarlo a la papelera de Drive
 * podría llevarse algo que se sigue viendo. Se saltea.
 */
export class UnsentUseError extends Error {
  constructor() {
    super(t('queue.unsentUse'));
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
  /** Foto o video; `null` si es un adjunto o no se sabe (ver `mime` y `fileInfo`). */
  kind: MediaKind | null;
  name: string;
  /** El original, si está en este dispositivo. */
  original: Blob | null;
  /** El tipo (`files.mime`), si se sabe. */
  mime?: string;
}

/** Lo que se sabe de un archivo sin esperar a nada (ver `MediaQueue.fileInfo`). */
export interface FileInfo {
  kind: FileKind;
  mime: string;
  name: string;
  size: number | null;
  /** El original está en este dispositivo. */
  local: boolean;
}

/** Foto o video, o `null` para un adjunto: lo que entiende el visor. */
function viewKind(mime: string, name: string): MediaKind | null {
  const kind = fileKind(mime, name);
  return kind === 'file' ? null : kind;
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
  /** Adjuntos de otros dispositivos que todavía no terminaron de llegar a Drive: se vuelve a preguntar. */
  private readonly unfinished = new Set<string>();
  private missingCheckedAt = 0;
  /** Las tarjetas de los adjuntos ya dibujadas (no se vuelve a preguntar nada en cada dibujo). */
  private readonly cards = new Map<string, string>();
  /** Lo que se sabe de cada archivo que pasó por acá (ver `fileInfo`). */
  private readonly infos = new Map<string, FileInfo>();
  private persistAsked = false;
  private readonly thumbListeners = new Set<(id: string) => void>();
  private readonly probe: (file: Blob, mime: string) => Promise<Probe>;
  private readonly playMark: (thumb: Blob) => Promise<Blob>;
  private readonly makeView: (file: Blob, mime: string, side: number) => Promise<Blob | null>;
  private readonly heic: (file: Blob) => Promise<Blob>;
  /** Los HEIC que se guardaron como JPEG en esta sesión: id → nombre del JPEG (ver `convertedName`). */
  private readonly converted = new Map<string, string>();
  private readonly now: () => number;
  /** Las imágenes nítidas de la página ya listas en esta sesión (ver `view`): `<lado>:<id>` → dirección. */
  private readonly views = new Map<string, string>();
  private readonly viewing = new Map<string, Promise<SharpView | null>>();
  /** Archivos para los que no hay imagen nítida en esta sesión (no se vuelve a bajar ni a decodificar). */
  private readonly noView = new Set<string>();
  /** Cuándo falló por última vez (sin red, el portero): no se vuelve a pedir enseguida. */
  private readonly viewFailedAt = new Map<string, { at: number; count: number }>();

  /** `db` en `null`: la base de archivos no se pudo abrir y la cola queda apagada (ver `unavailable`). */
  constructor(
    private readonly db: MediaDb | null,
    private readonly remote: MediaRemote,
    private readonly options: MediaQueueOptions,
  ) {
    this.probe = options.probe ?? probeMedia;
    this.playMark = options.playMark ?? withPlayMark;
    this.makeView = options.viewImage ?? viewImage;
    this.heic = options.convertHeic ?? loadAndConvertHeic;
    this.now = options.now ?? Date.now;
  }

  /** Por qué la cola está apagada en este dispositivo, o `null` si anda. */
  get unavailable(): string | null {
    return this.db ? null : (this.options.unavailable ?? stored('queue.storage'));
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
   * Guarda el archivo (foto, video o, con portero, cualquier otro) en el dispositivo y lo pone en la cola.
   * Devuelve la dirección para el bloque `image`; recién cuando esto termina el archivo está a salvo. Medidas
   * y miniatura se sacan después, del archivo ya guardado (ver `ensureProbed`).
   *
   * Una foto HEIC (las del iPhone; Chrome no las muestra) se pasa antes a JPEG (`toJpeg`): lo que se guarda y se
   * sube es el JPEG. Si no se puede, se guarda el HEIC tal cual, anotado; nunca se pierde.
   */
  async add(pageId: string, file: Blob & { name?: string }): Promise<string> {
    this.adding++;
    try {
      const ready = this.db ? await this.toJpeg(file) : { file };
      const url = await this.save(pageId, ready.file, ready.heic);
      if (ready.file !== file && ready.file.name) this.converted.set(url.slice(MEDIA_SCHEME.length), ready.file.name);
      return url;
    } finally {
      this.adding--;
    }
  }

  /**
   * El nombre con que se guardó un archivo que se agregó como HEIC y se pasó a JPEG en esta sesión
   * (`IMG_1234.jpg`), o `null`. Para que el bloque de la página lleve el mismo nombre que el archivo.
   */
  convertedName(url: string): string | null {
    const id = mediaIdOf(url);
    return id ? (this.converted.get(id) ?? null) : null;
  }

  /**
   * Un HEIC (por la firma o por el tipo) pasa a JPEG: tamaño completo, derecho y con su perfil de color, nombre
   * `.jpg` (Docs/Doc_Imagenes.md, "Fotos HEIC"). Cualquier otro archivo vuelve tal cual, sin cargar el
   * conversor. Si no se pudo convertir, vuelve el HEIC con su marca: `retry` si faltó el decodificador (sin
   * red), `failed` si no.
   */
  private async toJpeg(file: Blob & { name?: string }): Promise<{ file: Blob & { name?: string }; heic?: 'retry' | 'failed' }> {
    if (file.size <= 0 || !(await isHeicFile(file))) return { file };
    try {
      const jpeg = await this.heic(file);
      if (!(jpeg.size > 0)) throw new HeicError('failed', 'The HEIC converter returned an empty file.');
      return { file: new File([jpeg], jpegName(file.name), { type: JPEG_TYPE }) };
    } catch (err) {
      return { file, heic: heicFailure(err) === 'unavailable' ? 'retry' : 'failed' };
    }
  }

  /** Hay un archivo a medio guardar en el dispositivo: cerrar la app ahora lo perdería. */
  hasUnsavedWrites(): boolean {
    return this.adding > 0;
  }

  private async save(pageId: string, file: Blob & { name?: string }, heic?: 'retry' | 'failed'): Promise<string> {
    if (!this.db) throw new FileRejected(t('queue.cannotAdd', { reason: localize(this.unavailable ?? '') }));
    if (file.size <= 0) throw new FileRejected(t('queue.empty'));
    const mime = normalizeMime(file.type, file.name);
    const name = cleanName(file.name, mime);
    // Un adjunto solo va por el portero (sin él, las fotos siguen por el camino de antes).
    if (!this.enabled && fileKind(mime, name) === 'file') throw new FileRejected(t('queue.needsDrive'));
    await this.checkRoom(file.size);
    this.askPersist();
    const id = crypto.randomUUID();
    const record: MediaRecord = {
      id,
      pageId,
      projectId: this.options.projectOf?.(pageId) ?? null,
      name,
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
      ...(heic ? { heic } : {}),
    };
    // Todo junto: o queda el archivo con su registro, o no queda nada.
    try {
      const tx = this.db.transaction(['files', 'blobs'], 'readwrite');
      await Promise.all([tx.objectStore('blobs').put(file, id), tx.objectStore('files').put(record), tx.done]);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'QuotaExceededError') {
        throw new FileRejected(t('queue.noSpace'));
      }
      throw err;
    }
    this.seenLinks.add(`${pageId}:${id}`);
    this.remember(id, record, true);
    this.onQueued?.();
    // Medidas y miniatura, sin esperarlas: el archivo ya está a salvo. La cola no lo registra antes.
    void this.ensureProbed(id);
    return MEDIA_SCHEME + id;
  }

  /**
   * Antes de guardar algo grande: si con el archivo no queda el margen libre en la cuota del navegador, no se
   * guarda (se avisa). Si el navegador no dice cuánto hay, se prueba igual.
   */
  private async checkRoom(size: number): Promise<void> {
    if (size <= BIG_FILE) return;
    const storage = storageManager();
    if (typeof storage?.estimate !== 'function') return;
    let estimate: StorageEstimate;
    try {
      estimate = await storage.estimate();
    } catch {
      return;
    }
    const quota = estimate.quota;
    if (typeof quota === 'number' && quota > 0 && (estimate.usage ?? 0) + size + ROOM_MARGIN > quota) {
      // Primero se hace lugar con las imágenes nítidas (se vuelven a hacer cuando hagan falta).
      if ((await this.clearViews().catch(() => 0)) > 0) {
        const again = await storage.estimate().catch(() => estimate);
        if (!((again.usage ?? 0) + size + ROOM_MARGIN > (again.quota ?? quota))) return;
      }
      throw new FileRejected(t('queue.noRoom'));
    }
  }

  /** Pide una vez que el navegador no borre lo guardado cuando le falte lugar (si no lo da, sigue igual). */
  private askPersist(): void {
    if (this.persistAsked) return;
    this.persistAsked = true;
    try {
      void storageManager()?.persist?.().catch(() => false);
    } catch {
      // Un navegador sin `persist`.
    }
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
    // A un adjunto (también un PSD o un SVG) no se le sacan medidas ni miniatura: se ve como tarjeta.
    const kind = fileKind(record.mime, record.name);
    const none: Probe = { width: null, height: null, duration: null, thumb: null };
    const probe = blob && kind !== 'file' ? await this.probe(blob, record.mime).catch(() => none) : none;
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
    this.cards.delete(id);
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
        // proyecto también se manda (la base lo guarda como uso ajeno); acá solo se avisa.
        foreign = this.isForeign(pageId, own?.projectId ?? known?.projectId);
        await tx.objectStore('links').put({ ...newLink(pageId, fileId, 1), ...(foreign ? { foreign: true } : {}) });
        added = true;
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
    const tx = this.db.transaction(['links', 'files'], 'readwrite');
    const store = tx.objectStore('links');
    const [links, records] = await Promise.all([
      store.getAll(IDBKeyRange.bound(`${pageId}:`, `${pageId}:\uffff`)),
      tx.objectStore('files').getAll(),
    ]);
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
      } else {
        // También uno de otro proyecto: la base lo guarda como uso ajeno (ver `linkOne`).
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
   * detenido, esperando o sin permiso), o es un archivo agregado acá y todavía sin registrar.
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
    for (const url of this.views.values()) URL.revokeObjectURL(url);
    this.objectUrls.clear();
    this.views.clear();
    this.cards.clear();
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
      if (link.blocked || link.waiting === 'denied' || link.retryAt > this.now() || skipPage(link.pageId)) continue;
      if (link.removed) {
        // Sin la papelera en la base no se manda (la función no existe todavía).
        if (!this.trashReady) continue;
        // Mientras este dispositivo tenga otro uso del mismo archivo sin confirmar (por mandar, detenido,
        // esperando o sin permiso; también un archivo propio sin registrar, que `register_file` volvería a
        // colgar de la página), no se quita: lo mandaría a la papelera mientras se ve en otra página. Se lee
        // después de mandar los usos nuevos de esta vuelta.
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
   * cada tanto se pregunta si ya la tienen, y si llegó, se baja y se avisa al editor. Lo mismo con los que
   * todavía no estaban en la base y resultan ser adjuntos (no tienen miniatura: la tarjeta sale de la fila), y
   * con los adjuntos que todavía no habían terminado de llegar a Drive.
   */
  private async refreshMissing(): Promise<void> {
    const ids = [...new Set([...this.missing, ...this.unfinished])];
    if (ids.length === 0 || this.now() - this.missingCheckedAt < 60_000) return;
    this.missingCheckedAt = this.now();
    const rows = await this.remote.fetchMediaFiles(ids);
    // Una bajada no llegó (sin red, o Storage no contestó a tiempo): en esta pasada no se pide ninguna más.
    let noDownloads = false;
    for (const row of rows) {
      if (fileKind(row.mime, row.name) === 'file') {
        // Sigue sin llegar a Drive: la tarjeta que se ve ya es la de "todavía no".
        if (this.unfinished.has(row.id) && !row.drive_id && !isDeletedRow(row)) continue;
        const known = this.knownFrom(row);
        await this.store.put('known', known);
        this.remember(row.id, known, this.infos.get(row.id)?.local ?? false);
        this.unfinished.delete(row.id);
        this.thumbReady(row.id);
        continue;
      }
      if (!row.thumb_at || noDownloads) continue;
      let thumb: Blob;
      try {
        thumb = await this.remote.downloadThumb(row.id);
      } catch (err) {
        if (isNetworkError(err)) {
          // Sin red, o Storage no contestó a tiempo (la bajada tiene tope): no se piden las demás. Cada una
          // esperaría su tope entero, y mientras esta vuelta no termina no empieza otra: no se sube nada.
          // Las que faltan siguen anotadas; el bucle sigue solo por los adjuntos, que no piden nada a Storage.
          noDownloads = true;
          // La espera para volver a preguntar se cuenta desde acá y no desde que se preguntó: el tope de la
          // bajada dura más que esa espera, y la vuelta siguiente volvería a pedir enseguida y a esperar otro
          // tope entero.
          this.missingCheckedAt = this.now();
        }
        continue;
      }
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
    // Trabadas seguidas sin que la subida avance (un registro de una versión anterior no lo trae).
    let stalls = start.stalls ?? 0;
    // Fallas seguidas, también sin avance: de esto sale cuánto se espera para volver a intentar.
    let failed = start.failures;
    // La subida del portero que se está usando y hasta dónde confirmó: para saber cuándo avanza de verdad.
    let savedId = start.uploadId;
    let confirmed = start.sent;
    // Storage no contestó a tiempo al subir la miniatura (el tope de `uploadThumb`).
    let thumbStalled = false;
    try {
      // Un HEIC que no se pudo convertir sin red: antes de registrarlo se vuelve a probar (después el archivo ya
      // existe como HEIC en la base y en Drive, y queda así).
      if (record.heic === 'retry' && !record.registered) record = await this.retryHeic(record);
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
        if (record.heic === 'retry') {
          // Se registró como HEIC: ya no se convierte. El aviso de la página cambia.
          record = await this.patch(record.id, { registered: true, heic: 'failed' });
          this.thumbReady(record.id);
        } else {
          record = await this.patch(record.id, { registered: true });
        }
      }
      if (record.thumb === 'local') {
        const thumb = await this.store.get('thumbs', record.id);
        try {
          if (thumb) {
            await this.remote.uploadThumb(record.id, thumb).catch((err: unknown) => {
              thumbStalled = isTimeout(err);
              throw err;
            });
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
        await this.patch(record.id, { error: stored('queue.originalMissing'), blocked: true });
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
              error: stored('queue.unknownToServer'),
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
      savedId = record.uploadId;
      confirmed = record.sent;
      this.setUploading({ name: record.name, sent: record.sent, total: record.size });
      const onProgress = (p: UploadProgress) => {
        this.setUploading({ name: record.name, sent: p.sent, total: p.total });
        const other = p.uploadId !== savedId;
        // Otra subida empieza de cero: lo que tenía la anterior no cuenta.
        if (other) confirmed = 0;
        if (!other && p.sent === confirmed) return;
        const changes: Partial<MediaRecord> = { uploadId: p.uploadId, sent: p.sent };
        // Las trabadas y las fallas se cuentan seguidas y sin avance: vuelven a cero recién cuando el portero
        // confirma más bytes (abrir otra subida no es avanzar). Si no, un video largo al que le llega una
        // parte más en cada vuelta esperaría cada vez más para seguir, aunque esté avanzando.
        if (p.sent > confirmed) {
          if (stalls > 0) changes.stalls = stalls = 0;
          if (failed > 0) changes.failures = failed = 0;
        }
        savedId = p.uploadId;
        confirmed = p.sent;
        saving = saving.then(() => this.patch(record.id, changes)).catch(() => undefined);
      };
      let result;
      try {
        // El portero corta un pedido que deja de moverse (`STALL_MS`, `CONTROL_TIMEOUT_MS`): la subida
        // termina con un error para reintentar y la cola sigue con los demás archivos. Sin eso, un pedido
        // que nunca contestaba (sin error de red) dejaba la cola entera clavada, porque se sube de a uno.
        result = await portero.upload(file, {
          appFile: { id: record.id, day: record.day },
          resume: record.uploadId,
          // Cada `STALLS_BEFORE_RENEW` trabadas seguidas, y solo si la que hay no recibió nada.
          renewIfEmpty: stalls > 0 && stalls % STALLS_BEFORE_RENEW === 0,
          // Cada trabada seguida le da más plazo a la respuesta de la parte: lento termina pasando.
          stalledBefore: stalls,
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
          error: stored('queue.serverUpdate'),
        });
        this.onChange?.();
        return 'blocked';
      }
      record = await this.patch(record.id, { driveId: result.id, uploadId: null, sent: record.size });
      return this.waitForDatabase(record);
    } catch (err) {
      let outcome = classify(err);
      if (outcome === 'cancelled') return outcome;
      // Una miniatura que Storage no contestó a tiempo es como una subida trabada del portero: el archivo
      // vuelve a la cola con su espera y la vuelta sigue con los demás. Tratada como "sin red" cortaría la
      // vuelta, y la siguiente empezaría otra vez por este archivo (van por orden de llegada): con Storage
      // colgado solo para él, los demás no subirían nunca. No se marca nada: la miniatura sigue por subir y
      // el original, en el dispositivo.
      if (thumbStalled) outcome = 'retry';
      const failures = failed + 1;
      // El servidor dice que el archivo no existe aunque acá figura registrado (por ejemplo, se restauró la
      // base): se vuelve a registrar en vez de detenerlo. Si sigue igual después de varias veces, se detiene.
      const notThere =
        record.registered &&
        ((err instanceof PorteroError && err.status === 404) || errorMessage(err) === 'file_not_found');
      const lost = notThere ? (record.lost ?? 0) + 1 : 0;
      if (notThere) outcome = lost >= 3 ? 'blocked' : 'retry';
      const hasThumb = notThere && (await this.store.count('thumbs', record.id).catch(() => 0)) > 0;
      const changes: Partial<MediaRecord> = {
        error: thumbStalled ? stored('portero.stalled') : friendly(err),
        blocked: outcome === 'blocked',
        failures,
        // Sin red no se espera: se vuelve a probar en la próxima sincronización (al volver la red).
        retryAt: outcome === 'offline' || outcome === 'blocked' ? 0 : this.now() + backoff(failures),
        lost,
        // Se vuelve a registrar y a marcar la miniatura (los dos son idempotentes).
        ...(notThere ? { registered: false, thumb: hasThumb ? 'local' : 'none' } : {}),
      };
      // Una subida que el portero ya no tiene se empieza de nuevo.
      if (err instanceof UploadError) {
        // Si se cortó al preguntarle cuánto llegó, el error no lo sabe (dice 0): lo que esa misma subida
        // ya había confirmado sigue ahí. Bajarlo haría pasar por avance la próxima pregunta que conteste.
        const sent = err.uploadId && err.uploadId === savedId ? Math.max(err.sent, confirmed) : err.sent;
        Object.assign(changes, { uploadId: err.uploadId, sent: err.uploadId ? sent : 0 });
        // Una trabada más (si la subida avanzó en este intento, la cuenta ya volvió a cero y esta es la primera).
        if (err.stalled) changes.stalls = stalls + 1;
      }
      await this.patch(record.id, changes).catch(() => undefined);
      this.onChange?.();
      return outcome === 'waiting' ? 'retry' : outcome;
    }
  }

  /**
   * Vuelve a probar de pasar a JPEG un HEIC guardado sin convertir (`heic: 'retry'`), todavía sin registrar. Si
   * anda, el JPEG reemplaza al HEIC en el dispositivo en una sola transacción (nombre, tipo, peso; medidas y
   * miniatura se vuelven a sacar) y la página lo muestra; el bloque sigue apuntando al mismo id. Si el
   * decodificador sigue sin estar, queda para la próxima; si la foto no se puede convertir, queda `failed`.
   * Nunca falla: con cualquier problema sigue el HEIC.
   */
  private async retryHeic(record: MediaRecord): Promise<MediaRecord> {
    try {
      const blob = await this.store.get('blobs', record.id);
      if (!blob) return record;
      let jpeg: Blob;
      try {
        jpeg = await this.heic(blob);
        if (!(jpeg.size > 0)) throw new HeicError('failed', 'The HEIC converter returned an empty file.');
      } catch (err) {
        if (heicFailure(err) === 'unavailable') return record;
        const failed = await this.patch(record.id, { heic: 'failed' });
        this.thumbReady(record.id);
        return failed;
      }
      const name = jpegName(record.name);
      const tx = this.store.transaction(['files', 'blobs', 'thumbs'], 'readwrite');
      const current = await tx.objectStore('files').get(record.id);
      // Mientras tanto se registró (otra vuelta) o ya no está: no se toca.
      if (!current || current.registered || current.heic !== 'retry') {
        await tx.done;
        return current ?? record;
      }
      const next: MediaRecord = {
        ...current,
        name,
        mime: JPEG_TYPE,
        size: jpeg.size,
        width: null,
        height: null,
        thumb: 'none',
        probed: false,
        thumbError: null,
      };
      delete next.heic;
      await Promise.all([
        tx.objectStore('blobs').put(new File([jpeg], name, { type: JPEG_TYPE }), record.id),
        tx.objectStore('files').put(next),
        // Una miniatura hecha del HEIC (Safari lo abre) se rehace del JPEG.
        tx.objectStore('thumbs').delete(record.id),
        tx.done,
      ]);
      this.converted.set(record.id, name);
      this.remember(record.id, next, true);
      this.noView.delete(record.id);
      await this.ensureProbed(record.id);
      // La página deja el aviso y muestra la foto (con o sin miniatura).
      this.thumbReady(record.id);
      return (await this.store.get('files', record.id)) ?? next;
    } catch {
      return record;
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
      error: stored('queue.waitingDb'),
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
      stalls: 0,
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
      } else if ((await this.remote.linkPageFile(link.pageId, link.fileId)) === 'foreign') {
        // Se pegó un bloque de otro proyecto: la base guardó el uso como ajeno (cuenta para la papelera, así
        // el archivo no se va mientras se ve acá, pero no da permiso) y lo dice con `'file_other_project'`.
        // Queda confirmado, sin reintentar; se avisa una vez y en la página se ve el marcador de otro proyecto.
        await this.patchLink(
          link.key,
          { pending: 0, foreign: true, waiting: null, error: null, blocked: false, failures: 0, retryAt: 0 },
          link.rev ?? 0,
        );
        // Lo que la base sabe del archivo (el nombre, y su proyecto para la próxima vez).
        const meta = await this.fetchMeta(link.fileId).catch(() => null);
        const name = meta?.name ?? (await this.store.get('known', link.fileId).catch(() => undefined))?.name ?? null;
        // Si ya se sabía al pegarlo, ya se avisó.
        if (!link.foreign) this.options.onForeignFile?.(name);
        this.onChange?.();
        return 'done';
      }
      await this.patchLink(link.key, { pending: 0, waiting: null, error: null, blocked: false, failures: 0, retryAt: 0 }, link.rev ?? 0);
      return 'done';
    } catch (err) {
      const outcome = classify(err);
      if (outcome === 'offline') return outcome;
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
      error: errors.length > 0 ? localize(errors[errors.length - 1].error ?? '') || null : null,
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
      .map((r) => ({ id: r.id, name: r.name, error: r.error ? localize(r.error) : t('queue.unknownError') }));
    for (const l of links.filter((x) => x.blocked)) {
      const name = (await this.db.get('files', l.fileId))?.name ?? (await this.db.get('known', l.fileId))?.name ?? l.fileId;
      const what = l.removed ? t('queue.removedFromPage') : t('queue.copiedToPage');
      out.push({ id: l.key, name: `${name} (${what})`, error: l.error ? localize(l.error) : t('queue.unknownError') });
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
   *
   * Un adjunto (ver `fileKind`) se ve como una tarjeta con el ícono del tipo, el nombre y el peso.
   *
   * `pageId`: la página donde se muestra. Si el archivo es de otro proyecto (se pegó el bloque desde otro
   * proyecto), se ve el marcador *Photo from another project* (o la tarjeta de un archivo de otro proyecto) en
   * vez de la imagen, en todos los dispositivos.
   */
  resolve(url: string, pageId?: string): Promise<string> {
    const id = mediaIdOf(url);
    if (!id) return Promise.resolve(url);
    if (pageId) {
      return this.foreignTo(id, pageId).then((kind) => {
        if (kind === false) return this.resolveOwn(id);
        if (kind === 'file') {
          const info = this.infos.get(id);
          return attachmentCardUrl({ name: info?.name ?? '', mime: info?.mime ?? '', size: info?.size, state: 'foreign' });
        }
        return placeholderUrl(kind, foreignPlaceholder());
      });
    }
    return this.resolveOwn(id);
  }

  /**
   * Si el archivo es de otro proyecto que la página: `false` si no (o si no se sabe), o el tipo (foto, video o
   * adjunto) para el marcador. Mira lo que sabe el dispositivo y, si no sabe el proyecto, le pregunta a la base.
   */
  private async foreignTo(id: string, pageId: string): Promise<FileKind | null | false> {
    const pageProject = this.options.projectOf?.(pageId);
    if (!pageProject) return false;
    try {
      // La base ya dijo que en esta página es un uso ajeno (quien no ve el archivo no sabe su proyecto).
      const row = this.db ? await this.db.get('links', `${pageId}:${id}`) : undefined;
      if (row?.foreign && !row.removed && row.pending === 0) {
        const meta = (this.db ? await this.db.get('known', id) : undefined) ?? null;
        if (!meta) return null;
        this.remember(id, meta, false);
        return fileKind(meta.mime, meta.name);
      }
      const own = this.db ? await this.db.get('files', id) : undefined;
      if (own) this.remember(id, own, true);
      if (own?.projectId) return own.projectId !== pageProject && fileKind(own.mime, own.name);
      let known = this.db ? await this.db.get('known', id) : undefined;
      if (!known || known.projectId === undefined) known = (await this.fetchMeta(id).catch(() => null)) ?? known;
      if (!known?.projectId) return false;
      this.remember(id, known, !!own);
      return known.projectId !== pageProject && fileKind(known.mime, known.name);
    } catch {
      return false;
    }
  }

  private resolveOwn(id: string): Promise<string> {
    const cached = this.objectUrls.get(id) ?? this.cards.get(id);
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

  /** La tarjeta de un adjunto, guardada para los próximos dibujos (hasta que algo cambie: `thumbReady`). */
  private card(id: string, info: Parameters<typeof attachmentCardUrl>[0]): string {
    const url = attachmentCardUrl(info);
    this.cards.set(id, url);
    return url;
  }

  private async display(id: string): Promise<string> {
    try {
      const db = this.store;
      // Mandado a la papelera de Drive (papelera de archivos): ni roto ni pendiente, borrado, con la
      // miniatura si la hay.
      const cached = await db.get('known', id);
      if (cached?.deleted) return await this.deletedDisplay(id, cached);
      // Lo que se sabía puede ser de antes: se pregunta una vez por sesión y, si resulta borrado, el editor
      // cambia la imagen (como cuando llega una miniatura).
      void this.checkDeleted(id);
      const own = await db.get('files', id);
      if (own) {
        this.remember(id, own, true);
        const kind = viewKind(own.mime, own.name);
        if (!kind) return this.card(id, { name: own.name, mime: own.mime, size: own.size });
        const thumb = await db.get('thumbs', id);
        if (thumb) return this.keep(id, kind === 'video' ? await this.playMark(thumb).catch(() => thumb) : thumb);
        // Una foto HEIC que no se pudo pasar a JPEG: el ícono dice por qué no se ve.
        if (kind === 'image' && (own.heic || isHeicType(own.mime))) return placeholderUrl(kind, own.name, heicNotice(own.heic ?? null));
        // Si todavía se está sacando, `subscribeThumbs` avisa cuando llega.
        return placeholderUrl(kind, own.name);
      }
      let thumb = await db.get('thumbs', id);
      let meta = await db.get('known', id);
      const attachment = !!meta && fileKind(meta.mime, meta.name) === 'file';
      // Un adjunto no tiene miniatura: se pregunta solo si todavía no había llegado a Drive.
      if (!meta || (attachment ? !meta.driveId : !thumb && !meta.thumbAt)) {
        meta = (await this.fetchMeta(id).catch(() => null)) ?? meta;
      }
      if (meta) this.remember(id, meta, false);
      if (meta && fileKind(meta.mime, meta.name) === 'file') {
        if (meta.deleted) return await this.deletedDisplay(id, meta);
        // No va a `missing`: no hay miniatura que esperar. Si todavía no llegó a Drive, se vuelve a preguntar.
        if (meta.driveId) this.unfinished.delete(id);
        else this.unfinished.add(id);
        return this.card(id, { name: meta.name, mime: meta.mime, size: meta.size, state: meta.driveId ? 'ok' : 'pending' });
      }
      if (!thumb && meta?.thumbAt) {
        thumb = await this.remote.downloadThumb(id).catch(() => undefined);
        if (thumb) await db.put('thumbs', thumb, id);
      }
      const kind = meta ? viewKind(meta.mime, meta.name) : null;
      if (meta?.deleted) return await this.deletedDisplay(id, meta);
      if (thumb) return this.keep(id, kind === 'video' ? await this.playMark(thumb).catch(() => thumb) : thumb);
      // Sin miniatura todavía (otro dispositivo la está subiendo, o no hay red): se vuelve a preguntar.
      this.missing.add(id);
      // Un HEIC subido sin convertir (otro dispositivo, o una versión anterior de la app) no tiene miniatura.
      if (meta && kind === 'image' && isHeicType(meta.mime)) return placeholderUrl(kind, meta.name, heicNotice(null));
      return placeholderUrl(kind, meta?.name ?? t('queue.notYet'));
    } catch {
      return placeholderUrl(null, t('queue.notOnDevice'));
    }
  }

  /** La foto, el video o el adjunto que un dueño o admin mandó a la papelera de Drive. */
  private async deletedDisplay(id: string, meta: KnownFile): Promise<string> {
    this.forgetView(id);
    // Pedido y confirmado por el portero, o solo pedido (Drive falló: se puede volver a pedir desde la
    // papelera). Sin el dato (guardado antes), se lo da por confirmado.
    const notice = meta.inDriveTrash === false ? requestedLabel() : deletedLabel();
    const kind = viewKind(meta.mime, meta.name);
    if (!kind) return this.card(id, { name: meta.name, mime: meta.mime, size: meta.size, state: 'deleted', notice });
    const thumb = this.db ? await this.db.get('thumbs', id).catch(() => undefined) : undefined;
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
          const known = this.knownFrom(row);
          found.set(row.id, known);
          this.remember(row.id, known, this.infos.get(row.id)?.local ?? false);
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

  /** Una fila de `files` como se guarda en el dispositivo. */
  private knownFrom(row: MediaFileRow): KnownFile {
    return {
      id: row.id,
      name: row.name,
      mime: row.mime,
      size: row.size ?? null,
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
  }

  /** Anota lo que se sabe del archivo para `fileInfo`. */
  private remember(id: string, file: { mime: string; name: string; size?: number | null }, local: boolean): void {
    this.infos.set(id, {
      kind: fileKind(file.mime, file.name),
      mime: file.mime,
      name: file.name,
      size: typeof file.size === 'number' ? file.size : (this.infos.get(id)?.size ?? null),
      local,
    });
  }

  /**
   * Lo que ya se sabe del archivo (tipo, nombre, peso, si está en este dispositivo), sin esperar a nada:
   * `null` si todavía no pasó por `resolve`, `source` o la base. Para decidir en el acto (un clic, "Acomodar",
   * el carrete) si es un adjunto.
   */
  fileInfo(id: string): FileInfo | null {
    return this.infos.get(id.toLowerCase()) ?? null;
  }

  /** El original (si está en el dispositivo), el tipo y el nombre, para el visor. */
  async source(id: string): Promise<MediaSource> {
    if (!this.db) {
      // Sin base de archivos: el tipo y el nombre salen del servidor (no hay original en el dispositivo).
      const meta = await this.fetchMeta(id).catch(() => null);
      if (!meta) return { kind: null, name: '', original: null };
      return { kind: viewKind(meta.mime, meta.name), name: meta.name, original: null, mime: meta.mime };
    }
    const db = this.db;
    const own = await db.get('files', id);
    if (own) {
      this.remember(id, own, true);
      return { kind: viewKind(own.mime, own.name), name: own.name, original: (await db.get('blobs', id)) ?? null, mime: own.mime };
    }
    const meta = (await db.get('known', id)) ?? (await this.fetchMeta(id).catch(() => null));
    if (!meta) return { kind: null, name: '', original: null };
    this.remember(id, meta, false);
    return { kind: viewKind(meta.mime, meta.name), name: meta.name, original: null, mime: meta.mime };
  }

  /**
   * La foto original si está en este dispositivo, o `null` (un video, un adjunto, o no está). Solo lee lo
   * guardado acá, nunca la red: la usa la impresión (src/ui/printPage.ts).
   */
  async localImage(id: string): Promise<Blob | null> {
    if (!this.db) return null;
    try {
      const own = await this.db.get('files', id);
      if (!own || fileKind(own.mime, own.name) !== 'image') return null;
      return (await this.db.get('blobs', id)) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * El original guardado en este dispositivo, de cualquier tipo y tal cual, o `null` si no está. Nunca la
   * red. Ojo: antes de darle una dirección `blob:`, envolverlo con `safeBlob`.
   */
  async localOriginal(id: string): Promise<Blob | null> {
    if (!this.db) return null;
    try {
      return (await this.db.get('blobs', id.toLowerCase())) ?? null;
    } catch {
      return null;
    }
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

  // --- nítida en la página --------------------------------------------------------------------------

  /**
   * La dirección con la que la página muestra la foto (la miniatura, `resolve`) es esta: `true` si `src` es la
   * miniatura de una foto propia de este proyecto (no un ícono, un marcador ni un borrado), la que `view` puede
   * cambiar por una más nítida.
   */
  isThumbUrl(id: string, src: string): boolean {
    const key = id.toLowerCase();
    return !!src && this.objectUrls.get(key) === src && this.infos.get(key)?.kind === 'image';
  }

  /** La imagen nítida ya lista en esta sesión (sin esperar a nada; la más grande que haya), o `null`. */
  viewUrl(id: string): string | null {
    return this.viewOf(id)?.url ?? null;
  }

  /** Como `viewUrl`, con el lado mayor para el que se hizo (`VIEW_SIDE` o `VIEW_SIDE_SMALL`). */
  viewOf(id: string): SharpView | null {
    const key = id.toLowerCase();
    for (const side of VIEW_SIDES) {
      const url = this.views.get(`${side}:${key}`);
      if (url) return { url, side };
    }
    return null;
  }

  /**
   * Una imagen más nítida que la miniatura para mostrar en la página (Docs/Doc_Imagenes.md, "Calidad en la
   * página"): lado mayor de hasta `side` (2048, `VIEW_SIDE`, o 1024, `VIEW_SIDE_SMALL`, si la foto se ve chica),
   * hecha en este dispositivo y guardada acá (en `thumbs`, con la clave `view:<id>` o `view1024:<id>`, las más
   * viejas se borran pasado `VIEW_STORE_MAX_BYTES`), así se hace una sola vez por dispositivo. Sale, en este
   * orden, de la ya guardada (una de 2048 sirve para 1024), del original si está en el dispositivo (anda sin
   * red), o, con `download`, del original bajado con un pase del portero (solo una foto que el navegador abre,
   * ya en Drive y de hasta `maxBytes`). `null` si no hay nada mejor que la miniatura (un video, un adjunto, una
   * foto chica, un formato que el navegador no abre, sin red). Lo que no se pudo hacer (el navegador no la
   * abrió, tardó demasiado, pesa de más) no se vuelve a intentar en la sesión; una bajada que falló, recién a
   * `VIEW_RETRY_MS`. Nunca falla. Nada de esto se sube ni cambia el documento.
   */
  view(
    id: string,
    options: { download?: (id: string) => Promise<Blob>; side?: number; maxBytes?: number } = {},
  ): Promise<SharpView | null> {
    const key = id.toLowerCase();
    const side = options.side === VIEW_SIDE_SMALL ? VIEW_SIDE_SMALL : VIEW_SIDE;
    const ready = this.readyView(key, side);
    if (ready) return Promise.resolve(ready);
    if (this.noView.has(key)) return Promise.resolve(null);
    // Una sola a la vez por archivo (nunca dos decodificaciones del mismo original): si hay una en curso, se
    // espera y después se ve si sirve.
    const running = this.viewing.get(key);
    if (running) return running.then(() => this.readyView(key, side));
    const pending = this.makeViewFor(key, side, options.download, options.maxBytes ?? VIEW_FETCH_MAX_BYTES).finally(() =>
      this.viewing.delete(key),
    );
    this.viewing.set(key, pending);
    return pending;
  }

  /** La ya hecha en esta sesión que sirve para `side` (una más grande también), renovada en el orden de uso. */
  private readyView(id: string, side: number): SharpView | null {
    for (const s of VIEW_SIDES) {
      if (s < side) continue;
      const url = this.views.get(`${s}:${id}`);
      if (url) {
        this.views.delete(`${s}:${id}`);
        this.views.set(`${s}:${id}`, url);
        return { url, side: s };
      }
    }
    return null;
  }

  private async makeViewFor(
    id: string,
    side: number,
    download: ((id: string) => Promise<Blob>) | undefined,
    maxBytes: number,
  ): Promise<SharpView | null> {
    const db = this.db;
    if (!db) return null;
    try {
      const own = await db.get('files', id);
      const meta = own ?? (await db.get('known', id));
      if (!meta || fileKind(meta.mime, meta.name) !== 'image') return null;
      if ('deleted' in meta && meta.deleted) return null;
      const long = Math.max(meta.width ?? 0, meta.height ?? 0);
      if (long > 0 && long <= THUMB_SIDE * VIEW_GAIN) return this.noSharp(id);
      for (const s of VIEW_SIDES) {
        if (s < side) continue;
        const saved = await db.get('thumbs', viewKey(id, s));
        if (saved) {
          void this.indexView(viewKey(id, s), saved.size);
          return this.keepView(id, s, saved);
        }
      }
      const original = await db.get('blobs', id);
      if (original) {
        const view = await this.makeView(original, meta.mime, side).catch(() => null);
        if (!view) return this.noSharp(id);
        // Un JPEG que ya servía tal cual es el mismo original: no se guarda dos veces.
        if (view !== original) await this.storeView(id, side, view);
        return this.keepView(id, side, view);
      }
      if (!download || own || !meta.driveId || !VIEW_FETCH_TYPES.has(meta.mime)) return null;
      if (typeof meta.size === 'number' && meta.size > maxBytes) return null;
      // Después de una bajada que falló se espera 1 minuto, después 4, 16 y hasta una hora (una página abierta
      // no insiste cada minuto con un portero que no responde).
      const failed = this.viewFailedAt.get(id);
      if (failed && this.now() - failed.at < Math.min(VIEW_RETRY_MS * 4 ** (failed.count - 1), VIEW_RETRY_MAX_MS)) return null;
      let fetched: Blob;
      try {
        fetched = await download(id);
      } catch {
        this.viewFailedAt.set(id, { at: this.now(), count: (failed?.count ?? 0) + 1 });
        return null;
      }
      this.viewFailedAt.delete(id);
      // Lo bajado no se vuelve a bajar en esta sesión si no sirvió (pesa de más, el navegador no lo abre).
      if (fetched.size > maxBytes) return this.noSharp(id);
      const typed = fetched.type === meta.mime ? fetched : new Blob([fetched], { type: meta.mime });
      const view = await this.makeView(typed, meta.mime, side).catch(() => null);
      if (!view) return this.noSharp(id);
      await this.storeView(id, side, view);
      return this.keepView(id, side, view);
    } catch {
      return null;
    }
  }

  private noSharp(id: string): null {
    this.noView.add(id);
    return null;
  }

  private keepView(id: string, side: number, blob: Blob): SharpView {
    const key = `${side}:${id}`;
    const old = this.views.get(key);
    if (old) URL.revokeObjectURL(old);
    this.views.delete(key);
    const url = URL.createObjectURL(blob);
    this.views.set(key, url);
    // No se guardan todas las direcciones de la sesión: las más viejas que ninguna imagen muestra se sueltan.
    if (this.views.size > VIEW_URLS_MAX) {
      for (const [k, u] of this.views) {
        if (this.views.size <= VIEW_URLS_MAX) break;
        if (k === key || this.viewInUse(u)) continue;
        URL.revokeObjectURL(u);
        this.views.delete(k);
      }
    }
    return { url, side };
  }

  /** Guarda la imagen nítida en el dispositivo y la anota en el índice (las más viejas se borran). */
  private async storeView(id: string, side: number, blob: Blob): Promise<void> {
    if (!this.db) return;
    try {
      await this.db.put('thumbs', blob, viewKey(id, side));
      // Con la grande, la chica ya no hace falta.
      if (side === VIEW_SIDE) await this.dropView(viewKey(id, VIEW_SIDE_SMALL));
      await this.indexView(viewKey(id, side), blob.size);
    } catch {
      // Sin lugar: se muestra igual, sin guardarla.
    }
  }

  private viewIndex: { key: string; bytes: number }[] | null = null;

  private async loadViewIndex(): Promise<{ key: string; bytes: number }[]> {
    if (this.viewIndex) return this.viewIndex;
    const saved = this.db ? await this.db.get('meta', VIEW_INDEX_KEY).catch(() => undefined) : undefined;
    this.viewIndex = Array.isArray(saved) ? (saved as { key: string; bytes: number }[]) : [];
    return this.viewIndex;
  }

  /** Anota (o renueva) una imagen nítida guardada y borra las más viejas si se pasa del tope. */
  private async indexView(key: string, bytes: number): Promise<void> {
    if (!this.db) return;
    const index = await this.loadViewIndex();
    const at = index.findIndex((e) => e.key === key);
    if (at >= 0) index.splice(at, 1);
    index.push({ key, bytes });
    let total = index.reduce((n, e) => n + e.bytes, 0);
    const maxBytes = this.options.viewStoreMaxBytes ?? VIEW_STORE_MAX_BYTES;
    while (index.length > 1 && (total > maxBytes || index.length > VIEW_STORE_MAX_COUNT)) {
      const gone = index.shift()!;
      total -= gone.bytes;
      await this.db.delete('thumbs', gone.key).catch(() => undefined);
    }
    await this.db.put('meta', index, VIEW_INDEX_KEY).catch(() => undefined);
  }

  private async dropView(key: string): Promise<void> {
    if (!this.db) return;
    await this.db.delete('thumbs', key).catch(() => undefined);
    const index = await this.loadViewIndex();
    const at = index.findIndex((e) => e.key === key);
    if (at >= 0) {
      index.splice(at, 1);
      await this.db.put('meta', index, VIEW_INDEX_KEY).catch(() => undefined);
    }
  }

  /** Borra todas las imágenes nítidas guardadas (falta lugar para un archivo nuevo). Devuelve cuántas. */
  async clearViews(): Promise<number> {
    if (!this.db) return 0;
    const index = await this.loadViewIndex();
    const keys = index.splice(0).map((e) => e.key);
    for (const key of keys) await this.db.delete('thumbs', key).catch(() => undefined);
    await this.db.put('meta', index, VIEW_INDEX_KEY).catch(() => undefined);
    return keys.length;
  }

  /** Si alguna imagen del documento muestra esa dirección (no se suelta: la vista de impresión la copia). */
  private viewInUse(url: string): boolean {
    if (this.options.viewInUse) return this.options.viewInUse(url);
    if (typeof document === 'undefined') return false;
    for (const img of document.images) if (img.getAttribute('src') === url) return true;
    return false;
  }

  /** Olvida la imagen nítida (el archivo se mandó a la papelera de Drive). */
  private forgetView(id: string): void {
    for (const side of VIEW_SIDES) {
      const url = this.views.get(`${side}:${id}`);
      if (url) URL.revokeObjectURL(url);
      this.views.delete(`${side}:${id}`);
      void this.dropView(viewKey(id, side));
    }
  }

  /** Un pase del portero para ver el archivo entero (vence a las 8 horas). */
  async pass(id: string): Promise<string> {
    if (!this.url) throw new Error(t('queue.noServer'));
    return this.porteroFor(this.url).pass({ file: id });
  }

  /**
   * El pase y si el portero lo sirve con el nombre del archivo (`named`, de un portero actualizado). Con un
   * portero anterior, el mismo pase con `named: false`: se baja igual, con un nombre feo.
   */
  async passInfo(id: string): Promise<{ url: string; named: boolean }> {
    if (!this.url) throw new Error(t('queue.noServer'));
    const portero = this.porteroFor(this.url);
    if (portero.passInfo) {
      const info = await portero.passInfo({ file: id });
      return { url: info.url, named: info.named === true };
    }
    return { url: await portero.pass({ file: id }), named: false };
  }

  // --- papelera de archivos -------------------------------------------------------------------------

  /**
   * Pide al portero que mande un archivo de la papelera a la papelera de Drive (`POST /trash`; solo dueño y
   * admins, lo decide la base). Nunca lo borra: Drive lo guarda 30 días. Tira `PorteroError` con el estado
   * del portero (409: una página lo volvió a usar).
   */
  async trash(id: string): Promise<void> {
    if (!this.url) throw new PorteroError(t('queue.noServer'), 0);
    // Una página de este dispositivo que lo usa y todavía no se sincronizó: se saltea (y se avisa).
    if (await this.hasUnsentUse(id)) throw new UnsentUseError();
    try {
      await this.porteroFor(this.url).trash(id);
    } catch (err) {
      // Drive falló después de que la base lo marcó como pedido: en las páginas se ve "pedido".
      if (err instanceof PorteroError && err.status >= 500 && err.code !== 'drive_not_connected') await this.refreshDeleted(id);
      throw err;
    }
    await this.refreshDeleted(id, true);
  }

  /**
   * Vuelve a leer de la base el estado del archivo en la papelera (queda guardado) y avisa al editor para
   * que lo vuelva a mostrar. `done`: el portero confirmó; si la base no responde, se marca lo que había.
   */
  private async refreshDeleted(id: string, done = false): Promise<void> {
    this.deletedChecked.add(id);
    if (done) this.forgetView(id);
    const meta = await this.fetchMeta(id).catch(() => null);
    if (!meta && done && this.db) {
      const known = await this.db.get('known', id).catch(() => undefined);
      if (known) await this.db.put('known', { ...known, deleted: true, inDriveTrash: true }).catch(() => undefined);
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
