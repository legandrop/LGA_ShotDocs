import { locale, t } from '../i18n';
import '../i18n/lazy/exportPdf';
import '../i18n/lazy/exportZip';
import { fileKind, isFolderMime, type FileKind } from '../media/attachments';
import { isAbort, runDownload, type DownloadProgress, type DownloadTarget, type MissingItem, type PlanFile } from '../media/folderZip';
import type { MediaDb } from '../media/mediaDb';
import { getCopy, readOfflineView } from '../media/offlineStore';
import { THUMB_ESTIMATE } from '../media/offlinePlan';
import { mediaIdOf, VIEW_PREFIX, VIEW_SMALL_PREFIX, type MediaQueue } from '../media/queue';
import { mediaIdsInDoc } from '../media/usage';
import { VIEW_SIDE } from '../media/probe';
import { ZipWriter } from '../media/zipWriter';
import { prefs, type Contrast } from '../prefs';
import type { Role } from '../sync/access';
import type { CommentThread, CommentView } from '../sync/comments';
import type { PageRow } from '../sync/types';
import { archiveStyles, blocksForArchive, indexHtml, pageHtml, pageMarkdown, type ImagePlan, type MdMedia } from './archiveHtml';
import { authorLabel, commentsSection, type CommentSource } from './exportComments';
import { ExportCancelled, type ExportEditor } from './exportEditor';
import { browserResizer, type Resizer } from './exportImages';
import { renderPages, type ContentGap, type ExportPlanPage, type ExportSource } from './exportPages';
import { BUILTIN_ONSET, BUILTIN_PREPRO, BUILTIN_SHOT } from '../templates/builtinIds';
import { FILES_DIR, FileNames, imageExt, joinPath, pageSlots, pathLimit, rootFolderName, SHOTDOCS_DIR, VIEW_DIR, type PageSlot } from './zipLayout';

// El zip de exportar (P.22, Docs/Doc_Exportar.md, sección 2.3; entrega 2): para ARCHIVAR una rama o un proyecto.
//
// Por cada página, en el orden del árbol: se dibuja con el editor de exportación (el mismo del PDF, sin colaboración,
// sobre una COPIA de lo guardado), y se escriben su `.html` (la vista de impresión, sin JavaScript), su `.md`, sus
// bloques en `_shotdocs/pages/<n>.json` y los archivos que usa por primera vez: la vista JPEG de cada foto y video
// (`Files/_view/`, siempre) y los originales que piden las casillas (`Files/`), del dispositivo o bajados del Drive por
// el portero (`runDownload` de *Download all*, con sus reintentos, `Range` y la espera sin red). Un archivo usado en
// varias páginas va una sola vez, en la primera. Al final: `index.html`, `style.css`, `_shotdocs/manifest.json`,
// `_shotdocs/comments.json` y `MISSING_FILES.txt` si falta algo.
//
// Lo que nunca sale: lo borrado (se exportan los bloques, no el documento Yjs: EX5, D14), la papelera, lo de arriba de
// la rama, los correos (ni del equipo ni de los autores importados: EX8; quien exporta se reconoce por una huella con
// sal). Exportar no escribe nada en los documentos, el árbol, los comentarios ni el Drive.

/** La versión del formato de `_shotdocs/` (la entrega 3 rechaza uno más nuevo). */
export const ARCHIVE_FORMAT = 1;

/** El nombre de la lista de lo que falta (en inglés, como el de *Download all*; el texto va en el idioma de la app). */
export const MISSING_FILE = 'MISSING_FILES.txt';

/** Lo que el zip necesita saber de un archivo del workspace. */
export interface ArchiveFile {
  name: string;
  mime: string;
  kind: FileKind;
  size: number | null;
  /** Cuándo se agregó (si este dispositivo lo sabe), en milisegundos. */
  created: number | null;
  /** Un dueño o admin lo mandó a la papelera de Drive: en la página se ve como borrado. */
  deleted: boolean;
  /** Una carpeta de Drive (P.9): lo de adentro queda para la entrega 4. */
  folder: boolean;
}

/** De dónde salen los archivos (en la app, la cola de fotos y su base: `appArchiveMedia`). */
export interface ArchiveMedia {
  /** Averigua lo que no se sabe todavía de esos archivos (lo guardado y, con red, la base). */
  learn?(ids: readonly string[]): Promise<void>;
  meta(id: string): Promise<ArchiveFile | null>;
  /** Si el original entero está en este dispositivo (propio o bajado). */
  hasOriginal(id: string): Promise<boolean>;
  /** El original de este dispositivo, o `null`. Nunca la red. */
  original(id: string): Promise<Blob | null>;
  /** La mejor vista sin el original: la nítida guardada (2048) o la miniatura. Nunca la red. */
  preview(id: string): Promise<Blob | null>;
  /** Un pase del portero para bajar el original. */
  pass(id: string): Promise<string>;
  /** El original entero en memoria, por el portero (solo para hacer la vista de un HEIC que no tiene ninguna). */
  download?(id: string): Promise<Blob>;
}

/** Lo de la cola de fotos y su base, solo leído (exportar no guarda nada). */
export function appArchiveMedia(
  media: Pick<MediaQueue, 'learnInfo' | 'fileInfo' | 'localOriginal' | 'pass'>,
  db: MediaDb | null,
  download?: (id: string) => Promise<Blob>,
): ArchiveMedia {
  return {
    learn: (ids) => media.learnInfo(ids),
    async meta(id) {
      const own = db ? await db.get('files', id).catch(() => undefined) : undefined;
      const known = own || !db ? undefined : await db.get('known', id).catch(() => undefined);
      const info = media.fileInfo(id);
      const name = own?.name ?? known?.name ?? info?.name;
      const mime = own?.mime ?? known?.mime ?? info?.mime;
      if (name === undefined || mime === undefined) return null;
      return {
        name,
        mime,
        kind: fileKind(mime, name),
        size: own?.size ?? (typeof known?.size === 'number' ? known.size : null) ?? info?.size ?? null,
        created: own?.createdAt ?? null,
        deleted: !!known?.deleted,
        folder: isFolderMime(mime),
      };
    },
    async hasOriginal(id) {
      if (!db) return false;
      try {
        if (await db.getKey('blobs', id)) return true;
        return !!(await getCopy(db, id))?.orig?.complete;
      } catch {
        return false;
      }
    },
    original: (id) => media.localOriginal(id),
    async preview(id) {
      if (!db) return null;
      try {
        return (
          (await readOfflineView(db, id).catch(() => null)) ??
          (await db.get('thumbs', `${VIEW_PREFIX}${id}`)) ??
          (await db.get('thumbs', `${VIEW_SMALL_PREFIX}${id}`)) ??
          (await db.get('thumbs', id)) ??
          null
        );
      } catch {
        return null;
      }
    },
    pass: (id) => media.pass(id),
    download,
  };
}

/**
 * Quién exporta el zip (D60, Lega 2026-10-02): solo el dueño y los admins del workspace. El PDF sigue para cualquiera
 * que vea la página. Sin datos de permisos (una base sin el equipo), la única persona es el dueño.
 */
export function zipAllowed(perms: { known: boolean; role: Role | null }): boolean {
  return !perms.known || perms.role === 'owner' || perms.role === 'admin';
}

/** Qué originales van (las vistas JPEG van siempre) y si van los comentarios. */
export interface ZipInclude {
  originals: boolean;
  attachments: boolean;
  videos: boolean;
  comments: boolean;
}

/** Si el original de un archivo de ese tipo va en el zip. */
export function wantsOriginal(kind: FileKind, include: Pick<ZipInclude, 'originals' | 'attachments' | 'videos'>): boolean {
  return kind === 'image' ? include.originals : kind === 'video' ? include.videos : include.attachments;
}

// --- Lo que pesa, antes de empezar ------------------------------------------------------------------------------

export interface KindWeight {
  count: number;
  bytes: number;
  /** Los que no están enteros en el dispositivo (se bajan por el portero) y lo que pesan. */
  remote: number;
  remoteBytes: number;
  /** Sin peso conocido. */
  unknown: number;
}

export interface ZipEstimate {
  pages: number;
  files: number;
  byKind: Record<FileKind, KindWeight>;
  /** Lo que se estima que pesan las vistas JPEG. */
  previews: number;
}

const emptyWeight = (): KindWeight => ({ count: 0, bytes: 0, remote: 0, remoteBytes: 0, unknown: 0 });

/** Lo que va a pesar el zip de esas páginas, por tipo de archivo, sin bajar nada (salvo lo que la base sabe). */
export async function estimateZip(plan: readonly ExportPlanPage[], source: ExportSource, media: ArchiveMedia | null, signal?: AbortSignal): Promise<ZipEstimate> {
  const ids = new Set<string>();
  for (const page of plan) {
    if (signal?.aborted) throw new ExportCancelled();
    try {
      const snap = await source.snapshot(page.id);
      try {
        for (const id of mediaIdsInDoc(snap.doc)) ids.add(id);
      } finally {
        snap.doc.destroy();
      }
    } catch {
      // Una página que no se puede leer suma lo que tiene: nada.
    }
  }
  const out: ZipEstimate = { pages: plan.length, files: 0, byKind: { image: emptyWeight(), video: emptyWeight(), file: emptyWeight() }, previews: 0 };
  if (!media) return out;
  await media.learn?.([...ids]).catch(() => undefined);
  for (const id of ids) {
    if (signal?.aborted) throw new ExportCancelled();
    const meta = await media.meta(id);
    if (!meta || meta.folder || meta.deleted) continue;
    const w = out.byKind[meta.kind];
    out.files++;
    w.count++;
    if (meta.size === null) w.unknown++;
    w.bytes += meta.size ?? 0;
    if (!(await media.hasOriginal(id))) {
      w.remote++;
      w.remoteBytes += meta.size ?? 0;
    }
    if (meta.kind !== 'file') out.previews += THUMB_ESTIMATE;
  }
  return out;
}

/** Lo que se va a bajar por el portero con esas casillas: archivos y bytes. */
export function remoteOf(estimate: ZipEstimate, include: ZipInclude): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  for (const kind of ['image', 'video', 'file'] as const) {
    if (!wantsOriginal(kind, include)) continue;
    files += estimate.byKind[kind].remote;
    bytes += estimate.byKind[kind].remoteBytes;
  }
  return { files, bytes };
}

/** Lo que pesa el zip con esas casillas (originales elegidos + vistas). */
export function totalOf(estimate: ZipEstimate, include: ZipInclude): { files: number; bytes: number } {
  let files = 0;
  let bytes = estimate.previews;
  for (const kind of ['image', 'video', 'file'] as const) {
    if (!wantsOriginal(kind, include)) continue;
    files += estimate.byKind[kind].count;
    bytes += estimate.byKind[kind].bytes;
  }
  return { files, bytes };
}

/**
 * Los pedidos al portero que gasta bajar `files` originales (Docs/Doc_Exportar.md, sección 5): un `/pass` y un `/m/` al
 * Worker por archivo, y unos 4 llamados al Durable Object, que es el cupo que manda (100 000 por día).
 */
export function porteroCost(files: number): { requests: number; percent: number } {
  return { requests: files * 2, percent: Math.ceil((files * 4 * 100) / 100_000) };
}

// --- Escribir ----------------------------------------------------------------------------------------------------

/** Por qué falta algo (cada uno con su texto en `MISSING_FILES.txt`). */
export type MissingWhy = 'offline' | 'failed' | 'incomplete' | 'deleted' | 'noView' | 'unknown' | 'pageOutdated' | 'pageUnknown' | 'pageFailed' | 'comments';

export interface ZipMissing {
  /** La ruta adentro del zip (sin la carpeta de arriba). */
  path: string;
  why: MissingWhy;
  detail?: string;
}

/** Un renglón de la lista de lo que falta: la ruta y el motivo (la fecha de lo último sincronizado, para los comentarios). */
export function missingLine(item: ZipMissing, lastSync: number | null, now: Date = new Date()): string {
  const syncDate = new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(lastSync ?? now.getTime());
  const why = item.why === 'comments' ? t('exportZip.why.comments', { date: syncDate }) : t(`exportZip.why.${item.why}`);
  return `${item.path} — ${why}${item.detail ? ` (${item.detail})` : ''}`;
}

/** El texto de `MISSING_FILES.txt` (con BOM y fin de renglón de Windows, como el de *Download all*). */
export function missingText(items: readonly ZipMissing[], root: string, now: Date, lastSync: number | null): string {
  const lines = [t('exportZip.missingHead', { name: root, date: now.toLocaleString(locale()) }), ''];
  for (const item of items) lines.push(missingLine(item, lastSync, now));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** Cómo va. */
export interface ZipProgress {
  step: 'comments' | 'pages';
  done: number;
  total: number;
  title: string;
  /** Los originales bajados por el portero hasta ahora (y lo que se estimó, si se sabe). */
  files: { done: number; total: number; bytesDone: number; bytes: number };
  /** Esperando que vuelva la conexión. */
  offline: boolean;
}

export interface ZipOptions {
  /** El título de la raíz de lo exportado (el proyecto, o la página raíz de la rama: nunca nada de arriba). */
  title: string;
  kind: 'page' | 'project';
  /** El proyecto, solo si se exporta entero (una rama no lo nombra: regla 2). */
  project?: { id: string; name: string } | null;
  plan: ExportPlanPage[];
  /** Las filas del árbol (los ajustes y el ícono de cada página). */
  rows: (id: string) => Pick<PageRow, 'icon' | 'settings' | 'template_id'> | undefined;
  source: ExportSource;
  editor: ExportEditor;
  media: ArchiveMedia | null;
  include: ZipInclude;
  comments?: CommentSource | null;
  /** Quien exporta: su id (para `mine`) y su correo (solo para la huella con sal; nunca se escribe). */
  me: { id: string; email?: string | null };
  gap?: (pageId: string) => ContentGap;
  /** Hay red al empezar: sin red, los originales que no están en el dispositivo quedan en la lista, sin esperar. */
  online: boolean;
  target: DownloadTarget;
  /** Para bajar los originales (`runDownload`): las pruebas ponen el portero en memoria. */
  download?: { fetch?: typeof fetch; online?: () => boolean; whenOnline?: (signal?: AbortSignal) => Promise<void>; wait?: (ms: number, signal?: AbortSignal) => Promise<void> };
  /** Lo que se estimó (para el avance). */
  expected?: { files: number; bytes: number };
  appVersion: string;
  now?: Date;
  lastSync?: number | null;
  /** El contraste del texto de las páginas `.html` (por defecto, el de quien exporta: `prefs.contrast`). */
  contrast?: Contrast;
  /** Los estilos y sus letras (por defecto, los del documento: `archiveStyles`). */
  styles?: { css: string; fonts: { url: string; name: string }[] };
  /** Pasar un HEIC a JPEG (por defecto, el convertidor de la app). */
  convertHeic?: (file: Blob) => Promise<Blob>;
  resizer?: Resizer;
  signal?: AbortSignal;
  onProgress?: (p: ZipProgress) => void;
}

export interface ManifestPage {
  id: string;
  parent: string | null;
  order: number;
  title: string;
  icon: string | null;
  settings: Record<string, unknown>;
  /**
   * De qué plantilla salió (`template_id`, v0.124): una de fábrica o una página de adentro de lo exportado; `null` si no
   * salió de ninguna o si la plantilla quedó afuera (nunca el id de una página de afuera).
   */
  templateId: string | null;
  dir: string;
  html: string;
  md: string;
  json: string;
  /** La página estaba completa y legible en el dispositivo. */
  complete: boolean;
}

export interface ManifestFile {
  id: string;
  name: string;
  mime: string;
  kind: FileKind;
  size: number | null;
  md5: string | null;
  modified: string | null;
  /** La ruta del original adentro del zip (sin la carpeta de arriba), o `null` si no está. */
  original: string | null;
  view: string | null;
}

export interface Manifest {
  format: number;
  id: string;
  app: string;
  exportedAt: string;
  lastSyncAt: string | null;
  kind: 'page' | 'project';
  project: { id: string; name: string } | null;
  title: string;
  /** Quien exportó, sin su correo: una sal al azar y `SHA-256("shotdocs-author:" + sal + ":" + correo)`. */
  exporter: { salt: string; hash: string } | null;
  include: ZipInclude;
  pages: ManifestPage[];
  files: ManifestFile[];
}

export interface ZipResult {
  /** La carpeta de arriba del zip (y el nombre del zip). */
  root: string;
  /** La última sincronización del dispositivo (la fecha de "como estaba en este dispositivo"). */
  lastSync: number | null;
  pages: number;
  /** Archivos escritos (originales y vistas) y lo que bajó por el portero. */
  files: number;
  downloaded: { files: number; bytes: number };
  missing: ZipMissing[];
  manifest: Manifest;
}

const encoder = new TextEncoder();

async function sha256Hex(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** La huella de quien exporta (sección 4): nunca su correo. */
export async function exporterHash(salt: string, email: string): Promise<string> {
  return sha256Hex(`shotdocs-author:${salt}:${email.trim().toLowerCase()}`);
}

/** Los pedazos de un `Blob`, de a 4 MB (sin cargarlo entero si es grande). */
async function* blobChunks(blob: Blob): AsyncGenerator<Uint8Array> {
  const step = 4 * 1024 * 1024;
  for (let at = 0; at < blob.size; at += step) yield new Uint8Array(await blob.slice(at, at + step).arrayBuffer());
}

/** Adónde se escribe: el zip (con la carpeta de arriba) o la carpeta del disco. */
class ArchiveOut {
  readonly zip: ZipWriter | null;
  written = 0;

  constructor(
    private readonly target: DownloadTarget,
    readonly root: string,
  ) {
    this.zip = target.kind === 'zip' ? new ZipWriter(target.sink, { crc: target.crc }) : null;
  }

  /** Sin carpeta de arriba: el zip no repite su nombre adentro (Windows lo descomprime en `<nombre del zip>\`). */
  async start(): Promise<void> {}

  /** Un archivo entero (texto, bytes o un `Blob`). Un error del destino sube y frena todo. */
  async file(path: string, data: string | Uint8Array | Blob, modified?: Date | null): Promise<void> {
    const blob = typeof data === 'string' ? new Blob([data]) : data instanceof Uint8Array ? new Blob([data as BlobPart]) : data;
    if (this.zip) {
      const r = await this.zip.addFile(path, blob.size, modified ?? new Date(), blobChunks(blob));
      if (r.error !== undefined) throw r.error;
    } else if (this.target.kind === 'dir') {
      const out = await this.target.makeFile(path);
      try {
        for await (const chunk of blobChunks(blob)) await out.write(chunk);
        await out.close();
      } catch (err) {
        await out.abort().catch(() => undefined);
        throw err;
      }
    }
    this.written++;
  }

  async finish(): Promise<void> {
    await this.zip?.finish();
  }
}

/** Una foto, un video o un adjunto del zip. */
interface FileEntry {
  id: string;
  meta: ArchiveFile | null;
  /** La página dueña: la primera que lo usa en el orden del árbol. */
  owner: string;
  original: string | null;
  view: string | null;
  /** El original va (lo pidió su casilla), aunque todavía falte bajarlo. */
  wanted: boolean;
}

/** Las imágenes de la vista con su id de archivo (o su `src` suelto). */
function viewImages(view: HTMLElement): { img: HTMLImageElement; id: string | null; block: boolean; card: boolean }[] {
  return Array.from(view.querySelectorAll<HTMLImageElement>('img')).map((img) => {
    const holder = img.closest('[data-url]');
    return {
      img,
      id: mediaIdOf(holder?.getAttribute('data-url')),
      block: !!holder && !holder.classList.contains('sd-photo'),
      card: !!img.closest('.drive-card'),
    };
  });
}

/** Los ids de archivos que usan los bloques (cualquier `url` con `sdmedia://`, también en las fotos en línea). */
function mediaInBlocks(blocks: unknown, out: string[] = []): string[] {
  if (Array.isArray(blocks)) for (const b of blocks) mediaInBlocks(b, out);
  else if (blocks && typeof blocks === 'object') {
    for (const [k, v] of Object.entries(blocks)) {
      if (k === 'url' && typeof v === 'string') {
        const id = mediaIdOf(v);
        if (id && !out.includes(id)) out.push(id);
      } else if (typeof v === 'object') mediaInBlocks(v, out);
    }
  }
  return out;
}

async function fetchBlob(src: string): Promise<Blob | null> {
  try {
    const res = await fetch(src);
    return res.ok ? await res.blob() : null;
  } catch {
    return null;
  }
}

const HEIC = /^image\/hei[cf]/;

/**
 * Arma el zip (o la carpeta) en `options.target`. Termina con lo que falta (también en `MISSING_FILES.txt`); cancelar
 * tira `ExportCancelled` y un error del destino (el disco) sube. En los dos casos quien llama descarta lo escrito.
 */
export async function buildZip(options: ZipOptions): Promise<ZipResult> {
  const now = options.now ?? new Date();
  const signal = options.signal;
  const check = () => {
    if (signal?.aborted) throw new ExportCancelled();
  };
  const plan = options.plan;
  const root = rootFolderName(options.title);
  // Las rutas largas de Windows (O1): cada carpeta y cada nombre se acortan para entrar en `pathLimit`.
  const limit = pathLimit(root);
  const slots = pageSlots(plan, { flatRoot: options.kind === 'page', root, limit });
  const inside = new Set(plan.map((p) => p.id));
  const names = new FileNames(limit);
  const out = new ArchiveOut(options.target, root);
  const media = options.media;
  const resizer = options.resizer ?? browserResizer;
  const convertHeic = options.convertHeic ?? (async (blob: Blob) => (await import('../media/heicConvert')).convertHeic(blob));
  const missing: ZipMissing[] = [];
  const files = new Map<string, FileEntry>();
  const manifestPages: ManifestPage[] = [];
  const threadsOut: unknown[] = [];
  const progress: ZipProgress = {
    step: 'pages',
    done: 0,
    total: plan.length,
    title: plan[0]?.title ?? '',
    files: { done: 0, total: options.expected?.files ?? 0, bytesDone: 0, bytes: options.expected?.bytes ?? 0 },
    offline: false,
  };
  const report = () => options.onProgress?.({ ...progress, files: { ...progress.files } });
  const downloaded = { files: 0, bytes: 0 };
  let loose = 0;
  const lang = locale();
  // El contraste de quien exporta (Doc_Contraste.md): el mismo del PDF, no uno fijo.
  const contrast = options.contrast ?? prefs.get().contrast;
  const dates = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' });
  const asOf = options.lastSync ? t('exportPdf.asOf', { date: dates.format(options.lastSync) }) : '';
  const footer = [t('exportPdf.exported', { date: new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(now) }), asOf].filter(Boolean).join(' · ');
  const htmlOf = (slot: PageSlot) => joinPath(slot.dir, `${slot.name}.html`);
  const mdOf = (slot: PageSlot) => joinPath(slot.dir, `${slot.name}.md`);

  await out.start();

  // Los comentarios de los demás, al día (con red), antes de dibujar: lo mismo que el PDF.
  let commentsStale = 0;
  const comments = options.include.comments ? (options.comments ?? null) : null;
  if (comments?.prepare) {
    progress.step = 'comments';
    report();
    commentsStale = await comments.prepare(
      plan.map((p) => p.id),
      { signal, onProgress: (done, total) => options.onProgress?.({ ...progress, step: 'comments', done, total, title: '' }) },
    );
    check();
    progress.step = 'pages';
  }
  if (commentsStale > 0) missing.push({ path: SHOTDOCS_DIR + '/comments.json', why: 'comments' });

  /** Escribe la vista JPEG de un archivo (si hay alguna) y devuelve su ruta. */
  const writeView = async (entry: FileEntry, dir: string, shown: string | null, heicSource: Blob | null): Promise<string | null> => {
    const meta = entry.meta;
    // Un adjunto se ve con su tarjeta (una imagen `data:` que va tal cual en el `.html`): no lleva vista.
    if (!media || !meta || meta.folder || meta.deleted || meta.kind === 'file') return null;
    let blob: Blob | null = null;
    // Un video: el cuadro que se ve en la página (con la marca de "play"); una foto: la nítida o la miniatura.
    if (meta.kind === 'video' && shown && shown.startsWith('blob:')) blob = await fetchBlob(shown);
    blob ??= await media.preview(entry.id);
    if (!blob && shown && shown.startsWith('blob:')) blob = await fetchBlob(shown);
    // Un HEIC sin ninguna vista: se pasa a JPEG en el dispositivo (Chrome y Firefox no lo abren).
    if (!blob && heicSource) blob = await convertHeic(heicSource).catch(() => null);
    if (!blob) {
      missing.push({ path: joinPath(dir, `${FILES_DIR}/${VIEW_DIR}/${meta.name}`), why: 'noView' });
      return null;
    }
    // Siempre una JPEG (la nítida guardada puede ser WebP), de 2048 como mucho.
    if (blob.type !== 'image/jpeg') {
      const decoded = await resizer.open(blob).catch(() => null);
      if (decoded) {
        try {
          const scale = Math.min(1, VIEW_SIDE / Math.max(decoded.width, decoded.height));
          const jpeg = await decoded.draw(Math.max(1, Math.round(decoded.width * scale)), Math.max(1, Math.round(decoded.height * scale)));
          if (jpeg) blob = jpeg;
        } finally {
          decoded.close();
        }
      }
    }
    if (blob.type === 'image/svg+xml') return null;
    const name = names.view(dir, meta.name, imageExt(blob.type));
    const path = joinPath(dir, `${FILES_DIR}/${VIEW_DIR}/${name}`);
    await out.file(path, blob, meta.created ? new Date(meta.created) : null);
    return path;
  };

  /** Los archivos que una página usa por primera vez: sus vistas y sus originales. */
  const placeFiles = async (page: ExportPlanPage, slot: PageSlot, ids: string[], shown: Map<string, string>) => {
    const owned: FileEntry[] = [];
    const fresh = ids.filter((id) => !files.has(id));
    if (fresh.length && media?.learn) await media.learn(fresh).catch(() => undefined);
    for (const id of ids) {
      if (files.has(id)) continue;
      const meta = media ? await media.meta(id) : null;
      const entry: FileEntry = { id, meta, owner: page.id, original: null, view: null, wanted: !!meta && !meta.folder && wantsOriginal(meta.kind, options.include) };
      files.set(id, entry);
      owned.push(entry);
    }
    const queue: PlanFile[] = [];
    for (const entry of owned) {
      check();
      const meta = entry.meta;
      // Un archivo que este dispositivo no conoce todavía (nunca lo vio, y sin red): queda en la lista, con su id.
      if (media && !meta) missing.push({ path: joinPath(slot.dir, `${FILES_DIR}/${entry.id}`), why: 'unknown' });
      if (!media || !meta || meta.folder) continue;
      if (meta.deleted) {
        if (entry.wanted) missing.push({ path: joinPath(slot.dir, `${FILES_DIR}/${meta.name}`), why: 'deleted' });
        continue;
      }
      let local = entry.wanted || HEIC.test(meta.mime) ? await media.original(entry.id) : null;
      // La vista de un HEIC que no tiene ninguna sale del original: si no está en el dispositivo, se baja ahora.
      let heicSource: Blob | null = null;
      if (HEIC.test(meta.mime) && !(await media.preview(entry.id))) {
        if (!local && options.online && media.download) local = await media.download(entry.id).catch(() => null);
        heicSource = local;
      }
      entry.view = await writeView(entry, slot.dir, shown.get(entry.id) ?? null, heicSource);
      if (!entry.wanted) continue;
      const name = names.original(slot.dir, meta.name);
      const path = joinPath(slot.dir, `${FILES_DIR}/${name}`);
      if (local) {
        await out.file(path, local, meta.created ? new Date(meta.created) : null);
        entry.original = path;
      } else if (!options.online) {
        missing.push({ path, why: 'offline' });
      } else {
        queue.push({ path, id: entry.id, dirId: null, name: meta.name, size: meta.size ?? 0, url: '', modified: meta.created ? new Date(meta.created).toISOString() : null });
      }
    }
    if (!queue.length || !media) return;
    // Los que faltan, por el portero, con lo de *Download all* (reintentos, `Range`, esperar la red, cancelar).
    const base = { ...progress.files };
    const result = await runDownload(
      { root: '', dirs: [], files: queue, skipped: [], bytes: queue.reduce((n, f) => n + f.size, 0) },
      options.target,
      {
        ...options.download,
        passFor: (f) => media.pass(f.id),
        refresh: (f) => media.pass(f.id).catch(() => null),
        missingText: () => '',
      },
      {
        signal,
        part: { zip: out.zip },
        onProgress: (p: DownloadProgress) => {
          progress.files.done = base.done + p.filesDone;
          progress.files.bytesDone = base.bytesDone + p.bytesDone;
          progress.offline = p.offline;
          report();
        },
      },
    ).catch((err: unknown) => {
      if (isAbort(err)) throw new ExportCancelled();
      throw err;
    });
    progress.offline = false;
    const failed = new Map<string, MissingItem>(result.missing.map((m) => [m.path, m]));
    for (const f of queue) {
      const entry = files.get(f.id)!;
      const miss = failed.get(f.path);
      if (miss) missing.push({ path: f.path, why: miss.reason === 'incomplete' ? 'incomplete' : 'failed', detail: miss.detail });
      else {
        entry.original = f.path;
        out.written++;
      }
    }
    downloaded.files += result.done;
    downloaded.bytes += result.bytes;
  };

  try {
    let index = 0;
    await renderPages(plan, options.source, options.editor, {
      signal,
      onProgress: (p) => {
        progress.done = p.done;
        progress.title = p.title;
        report();
      },
      onPage: async (rendered, content, page, exported) => {
        const view = rendered.view.root;
        try {
          const slot = slots.get(page.id)!;
          const n = ++index;
          const gap = options.gap?.(page.id) ?? null;
          const outdated = gap !== null || exported.unreadable;
          const unknown = content.unknown !== null;
          const notes = [outdated ? t('exportPdf.outdated') : '', unknown ? t('exportPdf.unknown') : ''].filter(Boolean);
          if (outdated) missing.push({ path: htmlOf(slot), why: 'pageOutdated' });
          if (unknown) missing.push({ path: htmlOf(slot), why: 'pageUnknown' });

          // Las imágenes que se ven (para las vistas de los videos y lo que no tiene otra).
          const images = viewImages(view);
          const shown = new Map<string, string>();
          for (const i of images) if (i.id && !shown.has(i.id)) shown.set(i.id, i.img.getAttribute('src') ?? '');
          const ids = mediaInBlocks(content.blocks);
          for (const i of images) if (i.id && !ids.includes(i.id)) ids.push(i.id);
          await placeFiles(page, slot, ids, shown);
          check();

          // Lo que hace el `.html` con cada imagen.
          const plans: ImagePlan[] = [];
          for (const i of images) {
            if (i.card) {
              plans.push({ kind: 'drop' });
              continue;
            }
            const entry = i.id ? files.get(i.id) : undefined;
            if (entry?.meta && !entry.meta.deleted && !entry.meta.folder && (entry.view || entry.original)) {
              plans.push({
                kind: 'media',
                view: entry.view,
                original: entry.original,
                name: entry.meta.name,
                video: entry.meta.kind === 'video',
                attachment: entry.meta.kind === 'file',
                block: i.block,
              });
              continue;
            }
            const src = i.img.getAttribute('src') ?? '';
            if (!i.id && src.startsWith('blob:')) {
              // Una imagen del dispositivo que no es un archivo del workspace (una imagen vieja): va copiada.
              const blob = await fetchBlob(src);
              if (blob && blob.type !== 'image/svg+xml') {
                const path = joinPath(slot.dir, `${FILES_DIR}/${VIEW_DIR}/${names.view(slot.dir, `image_${++loose}`, imageExt(blob.type))}`);
                await out.file(path, blob);
                plans.push({ kind: 'file', path });
                continue;
              }
            }
            plans.push({ kind: 'keep' });
          }

          const threads = comments ? await comments.threads(page.id) : [];
          const section = comments ? commentsSection(threads, content.blocks, comments) : null;
          const pathTitles: { title: string; html: string | null }[] = [];
          for (let p: ExportPlanPage | undefined = page; p; p = p.parent ? plan.find((x) => x.id === p!.parent) : undefined) {
            const s = slots.get(p.id)!;
            pathTitles.unshift({ title: p.title, html: htmlOf(s) });
          }
          const html = pageHtml({
            view,
            title: page.title,
            dir: slot.dir,
            format: page.format,
            images: plans,
            pageHref: (id) => (inside.has(id) ? htmlOf(slots.get(id)!) : null),
            path: pathTitles,
            notes,
            footer,
            comments: section,
            lang,
            contrast,
          });
          await out.file(htmlOf(slot), html);
          const md = pageMarkdown({
            blocks: content.blocks as never,
            title: page.title,
            dir: slot.dir,
            pageMd: (id) => (inside.has(id) ? mdOf(slots.get(id)!) : null),
            media: (id): MdMedia | null => {
              const e = files.get(id);
              return e?.meta && !e.meta.folder && !e.meta.deleted ? { name: e.meta.name, view: e.view, original: e.original } : null;
            },
            notes,
            comments: comments ? { threads, source: comments } : null,
          });
          await out.file(mdOf(slot), md);
          const json = `${SHOTDOCS_DIR}/pages/${String(n).padStart(4, '0')}.json`;
          await out.file(
            json,
            JSON.stringify({
              format: ARCHIVE_FORMAT,
              id: page.id,
              title: page.title,
              blocks: blocksForArchive(content.blocks as never, inside),
              collapsedForAll: content.collapsedForAll,
              // Las anotaciones de las fotos de la página (entrega 3): campo nuevo del mismo formato 1, opcional al volver.
              photoMarkup: content.photoMarkup,
            }),
          );
          if (comments) {
            for (const th of threads) if (!th.root.deleted || th.replies.some((r) => !r.deleted)) threadsOut.push(threadJson(th, comments, options.me.id));
          }
          const row = options.rows(page.id);
          manifestPages.push({
            id: page.id,
            parent: page.parent,
            order: slot.order,
            title: page.title,
            icon: row?.icon ?? null,
            settings: settingsOf(row?.settings, page, inside),
            templateId: templateIdOf(row?.template_id, inside),
            dir: slot.dir,
            html: htmlOf(slot),
            md: mdOf(slot),
            json,
            complete: !outdated && !unknown,
          });
        } finally {
          view.remove();
        }
      },
      onFailed: async (page) => {
        const slot = slots.get(page.id)!;
        ++index;
        missing.push({ path: htmlOf(slot), why: 'pageFailed' });
        manifestPages.push({
          id: page.id,
          parent: page.parent,
          order: slot.order,
          title: page.title,
          icon: options.rows(page.id)?.icon ?? null,
          settings: settingsOf(options.rows(page.id)?.settings, page, inside),
          templateId: templateIdOf(options.rows(page.id)?.template_id, inside),
          dir: slot.dir,
          html: htmlOf(slot),
          md: mdOf(slot),
          json: '',
          complete: false,
        });
      },
    });
    check();

    // Lo de la raíz.
    const salt = randomHex(16);
    const manifest: Manifest = {
      format: ARCHIVE_FORMAT,
      id: crypto.randomUUID(),
      app: options.appVersion,
      exportedAt: now.toISOString(),
      lastSyncAt: options.lastSync ? new Date(options.lastSync).toISOString() : null,
      kind: options.kind,
      // Una rama no nombra el proyecto (regla 2).
      project: options.kind === 'project' && options.project ? { id: options.project.id, name: options.project.name } : null,
      title: options.title,
      exporter: options.me.email ? { salt, hash: await exporterHash(salt, options.me.email) } : null,
      include: { ...options.include },
      pages: manifestPages,
      files: [...files.values()]
        .filter((f) => f.meta && !f.meta.folder)
        .map((f) => ({
          id: f.id,
          name: f.meta!.name,
          mime: f.meta!.mime,
          kind: f.meta!.kind,
          size: f.meta!.size,
          md5: null,
          modified: f.meta!.created ? new Date(f.meta!.created).toISOString() : null,
          original: f.original,
          view: f.view,
        })),
    };
    await out.file(`${SHOTDOCS_DIR}/manifest.json`, JSON.stringify(manifest, null, 1));
    if (comments) await out.file(`${SHOTDOCS_DIR}/comments.json`, JSON.stringify({ format: ARCHIVE_FORMAT, threads: threadsOut }, null, 1));
    const styles = options.styles ?? archiveStyles();
    await out.file('style.css', styles.css);
    // Las letras de la app, para que el archivo se vea igual sin red (una que no llega queda afuera: cae a otra).
    for (const font of styles.fonts) {
      check();
      const blob = await fetchBlob(font.url);
      if (blob) await out.file(`fonts/${font.name}`, blob);
    }
    await out.file(
      'index.html',
      indexHtml({
        title: options.title,
        meta: footer,
        rows: plan.map((p) => ({ title: p.title, depth: p.depth, html: htmlOf(slots.get(p.id)!) })),
        missing: missing.length > 0,
        lang,
      }),
    );
    if (missing.length) await out.file(MISSING_FILE, missingText(missing, root, now, options.lastSync ?? null));
    await out.finish();
    return { root, lastSync: options.lastSync ?? null, pages: plan.length, files: out.written, downloaded, missing, manifest };
  } catch (err) {
    if (isAbort(err)) throw new ExportCancelled();
    throw err;
  }
}

/**
 * Los ajustes que vuelven: hoja, encabezado, títulos cortos y las marcas de plantilla de v0.124 (auditoría O6): la
 * página es una plantilla propia (`template`), la carpeta *Templates* (`templatesFolder`) y la carpeta de reportes del
 * día (`dayReports`, con su plantilla solo si también se exporta). Nunca uno que nombre una página de afuera. La raíz,
 * con la hoja heredada.
 */
export function settingsOf(settings: PageRow['settings'] | undefined, page: Pick<ExportPlanPage, 'parent' | 'format'>, inside: ReadonlySet<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const s = (settings ?? {}) as Record<string, unknown>;
  for (const key of ['format', 'header', 'split', 'template', 'templatesFolder']) if (s[key] !== undefined) out[key] = s[key];
  const reports = s.dayReports;
  if (reports === false) out.dayReports = false;
  else if (reports && typeof reports === 'object') {
    const template = (reports as { template?: unknown }).template;
    out.dayReports = typeof template === 'string' && inside.has(template) ? { template } : {};
  }
  // La raíz de lo exportado no tiene a quién heredarle la hoja: va la que tenía.
  if (page.parent === null && out.format === undefined && page.format.size !== 'free') out.format = { size: page.format.size, landscape: page.format.landscape };
  return out;
}

/** La plantilla de la que salió una página, si es de fábrica o se exporta también (nunca una página de afuera). */
function templateIdOf(id: string | null | undefined, inside: ReadonlySet<string>): string | null {
  if (!id) return null;
  return [BUILTIN_PREPRO, BUILTIN_ONSET, BUILTIN_SHOT].includes(id) || inside.has(id) ? id : null;
}

/** Un hilo para `comments.json`: nombres, nunca correos; `mine` si lo escribió quien exporta. */
function threadJson(th: CommentThread, source: Pick<CommentSource, 'nameOf'>, me: string): unknown {
  const one = (c: CommentView) =>
    c.deleted
      ? { id: c.id, deleted: true, createdAt: c.createdAt }
      : {
          id: c.id,
          author: authorLabel(c, source),
          mine: !!c.authorId && c.authorId === me && !c.importedAuthor && !c.linkAuthor,
          viaLink: !!c.linkAuthor,
          imported: !!c.importedAuthor,
          createdAt: c.createdAt,
          editedAt: c.editedAt,
          body: c.body,
        };
  return {
    id: th.id,
    page: th.pageId,
    block: th.blockId,
    resolved: th.resolved,
    resolvedAt: th.resolvedAt,
    comments: [one(th.root), ...th.replies.filter((r) => !r.deleted).map(one)],
  };
}
