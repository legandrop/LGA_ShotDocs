import { beginImportGeneration, generationStore, pendingImport, type RecoveryStore, type ImportRunOptions } from './importCommit';
import { normalizeProjectName } from '../sync/tree';
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import * as Y from 'yjs';
import { t } from '../i18n';
import '../i18n/lazy/importArchive';
import { mediaIdsInBlocks } from '../export/pageContent';
import { ZipReadError, subSource, type ArchiveSource } from '../export/zipReader';
import { carryMarkup, type CopiedPhoto } from '../media/markupClipboard';
import { mediaIdOf, type MediaQueue } from '../media/queue';
import { ARCHIVE_COMMENTS_SCHEMA_VERSION, type CommentQueue, type ImportedComment } from '../sync/comments';
import type { PageDocs } from '../sync/docs';
import { FileRejected } from '../sync/files';
import type { LocalDb } from '../sync/localDb';
import { CONTENT_FRAGMENT } from '../sync/structure';
import type { PageTree } from '../sync/tree';
import type { PageRow, PageSettings } from '../sync/types';
import { entityMark, holdsMark } from '../relations/kind';
import { BUILTIN_ALL } from '../templates/builtinIds';
import { SHARED_COLLAPSE_MAP } from '../ui/collapseEditor';
import { editorSchemaOptions } from '../ui/editorSchema';
import { PAGE_SIZES } from '../ui/pageFormat';
import { cleanArchiveBlocks, textOnlyBlocks, type NoteKey } from './archiveBlocks';
import { HIDDEN_IMAGE, treePlan, writePage, type CodaManifestPage } from './codaImport';
import type { PageBlock } from './codaComments';
import { cutText } from '../lib/graphemes';
import { closeCommit, forgetReviewed, ImportPending, importPendingText, openCommit, recoveryStore, type ClosedCommit, type ImportCommit, type ImportNote, type PendingTexts } from './importCommit';

// Volver a Shot Docs desde el zip que arma la app (P.22, entrega 3; Docs/Doc_Exportar.md, sección 3 y "Cómo quedó la
// entrega 3"). Siempre a un PROYECTO NUEVO: nunca encima de uno que existe (regla 5). Por los mismos caminos que la
// importación de Coda (codaImport.ts), que funcionan sin red: `tree.createProject` y `tree.create` para el árbol (en
// el orden del manifest), `media.add` para cada foto y archivo (queda en el dispositivo y la sincronización lo sube al
// Drive del workspace de destino, por su portero) y un editor sin pantalla para el contenido, que sale del JSON de
// cada página (los bloques de BlockNote, revisados por archiveBlocks.ts: nunca el HTML ni el Markdown del zip).
//
// Después de los bloques, en el mismo documento: el colapsado para todos (`collapsedHeadings`) y las anotaciones de
// las fotos (`photoMarkup`, con los ids de archivo nuevos, como pegar una foto anotada: `carryMarkup`). Después, el
// árbol: los ajustes de hoja y de títulos, el ícono y las marcas de plantilla (O6 de v0.129) con los ids nuevos. Los
// comentarios, con `import_comment` (origen `'shotdocs'`, base 18 o más), cada uno con un id nuevo derivado del
// proyecto nuevo: reintentar no duplica y dos importaciones del mismo zip no chocan.
//
// Sigue donde quedó (registro en `meta`, clave `shotdocsImport2:<id del archivo>:<SHA-256 del manifest>`, con una
// generación por cada importación de ese archivo: importCommit.ts): ni las páginas, ni los archivos, ni los
// comentarios se repiten, y lo que la persona escribió mientras tanto nunca se pisa. El registro de una importación
// hecha con una versión anterior (clave `shotdocsImport:…`) no se sigue: queda archivado tal cual (D304).

export const MANIFEST_PATH = '_shotdocs/manifest.json';
export const COMMENTS_PATH = '_shotdocs/comments.json';
/** El formato de `_shotdocs/` que esta versión entiende (el que escribe `exportZip.ts`). */
export const READ_FORMAT = 1;

/** Topes de lo que se lee del zip (uno de la app pesa mucho menos: el manifest de 300 páginas, unos cientos de KB). */
export const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
export const MAX_PAGE_JSON_BYTES = 32 * 1024 * 1024;
export const MAX_COMMENTS_BYTES = 64 * 1024 * 1024;
export const MAX_PAGES = 20_000;
export const MAX_FILES = 200_000;

const ERRORS = {
  notArchive: 'importArchive.error.notArchive',
  newer: 'importArchive.error.newer',
  badManifest: 'importArchive.error.badManifest',
  notZip: 'importArchive.error.notZip',
  damaged: 'importArchive.error.damaged',
  tooBig: 'importArchive.error.tooBig',
  needsDrive: 'importArchive.error.needsDrive',
} as const;

const SKIPPED = {
  unsafe: 'importArchive.note.skipped.unsafe',
  encrypted: 'importArchive.note.skipped.encrypted',
  method: 'importArchive.note.skipped.method',
  duplicate: 'importArchive.note.skipped.duplicate',
  range: 'importArchive.note.skipped.range',
} as const;

const BLOCK_NOTES = {
  missingFile: 'importArchive.block.missingFile',
  unknownBlock: 'importArchive.block.unknownBlock',
  unknownInline: 'importArchive.block.unknownInline',
  unknownProp: 'importArchive.block.unknownProp',
  badProp: 'importArchive.block.badProp',
  badUrl: 'importArchive.block.badUrl',
  badLink: 'importArchive.block.badLink',
  outsideLink: 'importArchive.block.outsideLink',
  externalImage: 'importArchive.block.externalImage',
  duplicateId: 'importArchive.block.duplicateId',
  tooDeep: 'importArchive.block.tooDeep',
  tooMany: 'importArchive.block.tooMany',
} as const satisfies Record<NoteKey, string>;

/** Por qué no se puede importar un archivo (el texto, en el idioma de la app). */
export class ArchiveError extends Error {
  constructor(readonly code: keyof typeof ERRORS) {
    super(t(ERRORS[code]));
    this.name = 'ArchiveError';
  }
}

export interface ArchivePage {
  id: string;
  parent: string | null;
  order: number;
  title: string;
  icon: string | null;
  settings: Record<string, unknown>;
  templateId: string | null;
  json: string;
  complete: boolean;
}

export interface ArchiveFileEntry {
  id: string;
  name: string;
  mime: string;
  kind: 'image' | 'video' | 'file';
  size: number | null;
  original: string | null;
  view: string | null;
}

export interface ArchiveManifest {
  format: number;
  id: string;
  app: string;
  exportedAt: string | null;
  title: string;
  /** El nombre del proyecto (solo si se exportó el proyecto entero). */
  projectName: string | null;
  exporter: { salt: string; hash: string } | null;
  pages: ArchivePage[];
  files: ArchiveFileEntry[];
}

export interface ShotDocsArchive {
  source: ArchiveSource;
  manifest: ArchiveManifest;
  /** `<id>:<SHA-256 del manifest>`: la clave del diario. */
  key: string;
  /** Lo que se encontró al leer (entradas raras del zip, páginas repetidas…). */
  notes: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
// eslint-disable-next-line no-control-regex
// Sin cortar en 500: lo corta el árbol, que pasa lo que sobra al principio de la página (tree.ts, `TitleRest`).
const cleanTitle = (v: unknown) => cutText(typeof v === 'string' ? v : '', 2000).replace(/[\u0000-\u001f\u007f]/g, ' ');

async function sha256Hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Un error de lectura del zip, como error del archivo. */
function zipError(err: unknown): never {
  if (err instanceof ZipReadError) {
    if (err.code === 'notZip') throw new ArchiveError('notZip');
    if (err.code === 'tooBig' || err.code === 'tooMany') throw new ArchiveError('tooBig');
    throw new ArchiveError('damaged');
  }
  throw err;
}

/**
 * El manifest con la forma que espera la importación. Un `format` más nuevo se rechaza ("Update the app"); sin
 * `format` o sin páginas no es un archivo de Shot Docs. Una página o un archivo con algo que no corresponde se saltea o
 * queda con un valor seguro, anotado.
 */
export function checkArchiveManifest(raw: unknown, notes: string[] = []): ArchiveManifest {
  if (!isObj(raw) || typeof raw.format !== 'number' || !Array.isArray(raw.pages)) throw new ArchiveError('notArchive');
  if (raw.format > READ_FORMAT) throw new ArchiveError('newer');
  if (raw.format !== READ_FORMAT) throw new ArchiveError('notArchive');
  const id = str(raw.id, 100);
  if (!id) throw new ArchiveError('badManifest');
  if (raw.pages.length > MAX_PAGES) throw new ArchiveError('tooBig');
  const files = Array.isArray(raw.files) ? raw.files : [];
  if (files.length > MAX_FILES) throw new ArchiveError('tooBig');
  const pages: ArchivePage[] = [];
  const seen = new Set<string>();
  for (const [i, item] of raw.pages.entries()) {
    if (!isObj(item) || typeof item.id !== 'string' || !UUID.test(item.id)) {
      notes.push(t('importArchive.note.badPage', { n: i + 1 }));
      continue;
    }
    const pid = item.id.toLowerCase();
    if (seen.has(pid)) {
      notes.push(t('importArchive.note.duplicatePage', { title: cleanTitle(item.title) || pid }));
      continue;
    }
    seen.add(pid);
    pages.push({
      id: pid,
      parent: typeof item.parent === 'string' && UUID.test(item.parent) ? item.parent.toLowerCase() : null,
      order: typeof item.order === 'number' && Number.isFinite(item.order) ? item.order : i,
      title: cleanTitle(item.title),
      icon: typeof item.icon === 'string' && item.icon.length <= 32 ? item.icon : null,
      settings: isObj(item.settings) ? item.settings : {},
      templateId: typeof item.templateId === 'string' && UUID.test(item.templateId) ? item.templateId.toLowerCase() : null,
      json: str(item.json, 1000),
      complete: item.complete !== false,
    });
  }
  const fileList: ArchiveFileEntry[] = [];
  const seenFiles = new Set<string>();
  for (const item of files) {
    if (!isObj(item) || typeof item.id !== 'string' || !UUID.test(item.id)) continue;
    const fid = item.id.toLowerCase();
    if (seenFiles.has(fid)) continue;
    seenFiles.add(fid);
    const kind = item.kind === 'image' || item.kind === 'video' ? item.kind : 'file';
    const mime = typeof item.mime === 'string' && /^[\w.+-]{1,80}\/[\w.+-]{1,120}$/.test(item.mime) ? item.mime.toLowerCase() : '';
    fileList.push({
      id: fid,
      name: str(item.name, 255).replace(/[\u0000-\u001f\u007f/\\]/g, '_') || 'file', // eslint-disable-line no-control-regex
      mime,
      kind,
      size: typeof item.size === 'number' && Number.isFinite(item.size) && item.size >= 0 ? item.size : null,
      original: typeof item.original === 'string' && item.original ? item.original.slice(0, 2000) : null,
      view: typeof item.view === 'string' && item.view ? item.view.slice(0, 2000) : null,
    });
  }
  const exporter =
    isObj(raw.exporter) && typeof raw.exporter.salt === 'string' && /^[0-9a-f]{8,128}$/i.test(raw.exporter.salt) && typeof raw.exporter.hash === 'string' && /^[0-9a-f]{64}$/i.test(raw.exporter.hash)
      ? { salt: raw.exporter.salt, hash: raw.exporter.hash.toLowerCase() }
      : null;
  const project = isObj(raw.project) ? cleanTitle(raw.project.name).trim() : '';
  return {
    format: raw.format,
    id,
    app: str(raw.app, 40),
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt.slice(0, 40) : null,
    title: cleanTitle(raw.title).trim(),
    projectName: project || null,
    exporter,
    pages,
    files: fileList,
  };
}

/**
 * Abre el archivo: busca `_shotdocs/manifest.json` arriba de todo o adentro de una sola carpeta (el zip que alguien
 * descomprimió y volvió a comprimir) y lo revisa. Un zip de otra app, roto o de una versión más nueva es un error claro;
 * nada se crea.
 */
export async function openArchive(source: ArchiveSource): Promise<ShotDocsArchive> {
  let src = source;
  if (!source.has(MANIFEST_PATH)) {
    const found = source.paths().filter((p) => p.endsWith(`/${MANIFEST_PATH}`) && p.split('/').length === 3);
    if (found.length !== 1) throw new ArchiveError('notArchive');
    src = subSource(source, found[0].slice(0, -(MANIFEST_PATH.length + 1)));
  }
  let text: string;
  try {
    text = await src.text(MANIFEST_PATH, MAX_MANIFEST_BYTES);
  } catch (err) {
    zipError(err);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ArchiveError('badManifest');
  }
  const notes: string[] = [];
  for (const s of source.skipped.slice(0, 50)) notes.push(t(SKIPPED[s.why], { name: s.name.slice(0, 120) }));
  if (source.skipped.length > 50) notes.push(t('importArchive.note.skippedMore', { count: source.skipped.length - 50 }));
  const manifest = checkArchiveManifest(raw, notes);
  const hash = await sha256Hex(new TextEncoder().encode(text));
  return { source: src, manifest, key: `${manifest.id}:${hash}`, notes };
}

// --- Lo que pesa ---------------------------------------------------------------------------------------------------

/** Qué se va a guardar de un archivo: el original, la vista JPEG (una foto sin original) o nada. */
function chosenBlob(archive: ShotDocsArchive, f: ArchiveFileEntry): { path: string; preview: boolean } | null {
  const usable = (path: string | null): path is string => !!path && archive.source.has(path) && !archive.source.tooBig(path);
  if (usable(f.original)) return { path: f.original, preview: false };
  if (f.kind === 'image' && usable(f.view)) return { path: f.view, preview: true };
  return null;
}

/** El original está en el zip pero vuelto a comprimir y más grande que el tope: no se lee (O2 de la auditoría). */
function recompressed(archive: ShotDocsArchive, f: ArchiveFileEntry): boolean {
  return !!f.original && archive.source.has(f.original) && archive.source.tooBig(f.original);
}

/** Cuántos archivos se van a guardar en el dispositivo y cuánto pesan (para el espacio, antes de empezar). */
export function archiveWeight(archive: ShotDocsArchive): { files: number; bytes: number; previews: number; missing: number; tooBig: number } {
  let files = 0;
  let bytes = 0;
  let previews = 0;
  let missing = 0;
  let tooBig = 0;
  for (const f of archive.manifest.files) {
    const big = recompressed(archive, f);
    if (big) tooBig++;
    const got = chosenBlob(archive, f);
    if (!got) {
      // Uno vuelto a comprimir y más grande que el tope ya se cuenta aparte (`tooBig`), no como "no está en el zip".
      if (!big) missing++;
      continue;
    }
    files++;
    if (got.preview) previews++;
    bytes += archive.source.size(got.path);
  }
  return { files, bytes, previews, missing, tooBig };
}

// --- Comentarios ---------------------------------------------------------------------------------------------------

interface ArchiveComment {
  id: string;
  deleted: boolean;
  author: string;
  mine: boolean;
  createdAt: string;
  body: string;
}

interface ArchiveThread {
  id: string;
  page: string;
  block: string | null;
  resolved: boolean;
  resolvedAt: string | null;
  comments: ArchiveComment[];
}

/** Los hilos de `comments.json`, por página vieja. Sin correos: un autor que es un correo queda con lo de antes de la `@`. */
export function parseArchiveComments(raw: unknown): Map<string, ArchiveThread[]> {
  if (!isObj(raw) || !Array.isArray(raw.threads)) throw new Error('bad');
  const out = new Map<string, ArchiveThread[]>();
  for (const th of raw.threads) {
    if (!isObj(th) || typeof th.page !== 'string' || !UUID.test(th.page) || typeof th.id !== 'string' || !th.id) continue;
    const comments: ArchiveComment[] = [];
    for (const c of Array.isArray(th.comments) ? th.comments : []) {
      if (!isObj(c) || typeof c.id !== 'string' || !c.id || c.id.length > 100) continue;
      const author = str(c.author, 400).replace(/\s+/g, ' ').trim();
      comments.push({
        id: c.id,
        deleted: c.deleted === true || typeof c.body !== 'string' || !/\S/.test(c.body),
        // Nunca un correo (EX8): un zip armado a mano que lo traiga queda con la parte de antes de la `@`.
        author: cutText(author.includes('@') ? author.slice(0, author.indexOf('@')) : author, 200).trim(),
        mine: c.mine === true,
        createdAt: typeof c.createdAt === 'string' ? c.createdAt : '',
        body: typeof c.body === 'string' ? c.body : '',
      });
    }
    const page = th.page.toLowerCase();
    const list = out.get(page) ?? [];
    list.push({
      id: th.id,
      page,
      block: typeof th.block === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(th.block) ? th.block : null,
      resolved: th.resolved === true,
      resolvedAt: typeof th.resolvedAt === 'string' ? th.resolvedAt : null,
      comments,
    });
    out.set(page, list);
  }
  return out;
}

/** El id nuevo y estable de un comentario en el proyecto nuevo (Docs/Doc_Exportar.md, sección 3). */
export async function archiveCommentId(projectId: string, oldId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`shotdocs-comment:${projectId}:${oldId}`));
  const b = new Uint8Array(digest).slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const MIN_DATE = Date.parse('2000-01-01T00:00:00Z');
/** Una fecha que acepta la base (ni antes de 2000 ni en el futuro), o `null`. */
const validDate = (iso: string | null, now: number): string | null => {
  const ms = iso ? Date.parse(iso) : NaN;
  return ms >= MIN_DATE && ms <= now ? new Date(ms).toISOString() : null;
};

/** Quien importa es quien exportó: la huella con sal de su correo coincide (sección 4). */
export async function isExporter(exporter: ArchiveManifest['exporter'], email: string | undefined): Promise<boolean> {
  if (!exporter || !email) return false;
  const hash = await sha256Hex(new TextEncoder().encode(`shotdocs-author:${exporter.salt}:${email.trim().toLowerCase()}`));
  return hash === exporter.hash;
}

/**
 * Los comentarios de una página, listos para la cola: el hilo en su mismo bloque si quedó en la página (si no, en la
 * página); un hilo cuyo primer comentario se borró, con la primera respuesta viva arriba. Los de quien exportó quedan
 * a nombre de quien importa solo si es la misma persona; los demás, con su nombre y sin correo.
 */
export async function buildArchiveComments(
  threads: readonly ArchiveThread[],
  options: { projectId: string; pageId: string; blockIds: ReadonlySet<string>; mine: boolean; now?: number },
): Promise<{ comments: ImportedComment[]; promoted: number; unanchored: number; redated: number }> {
  const now = options.now ?? Date.now();
  const comments: ImportedComment[] = [];
  let promoted = 0;
  let unanchored = 0;
  let redated = 0;
  for (const th of threads) {
    const live = th.comments.filter((c) => !c.deleted);
    if (!live.length) continue;
    if (th.comments[0].deleted) promoted++;
    const root = live[0];
    const rootId = await archiveCommentId(options.projectId, root.id);
    let block = th.block && options.blockIds.has(th.block) ? th.block : null;
    if (th.block && !block) unanchored++;
    if (!th.block) block = null;
    for (const [i, c] of live.entries()) {
      let created = validDate(c.createdAt, now);
      if (!created) {
        redated++;
        created = new Date(now).toISOString();
      }
      const own = c.mine && options.mine;
      comments.push({
        id: i === 0 ? rootId : await archiveCommentId(options.projectId, c.id),
        pageId: options.pageId,
        blockId: i === 0 ? block : null,
        threadId: i === 0 ? null : rootId,
        body: c.body,
        createdAt: created,
        resolvedAt: i === 0 && th.resolved ? (validDate(th.resolvedAt, now) ?? new Date(now).toISOString()) : null,
        source: 'shotdocs',
        authorName: own ? null : c.author || t('importArchive.someone'),
        authorEmail: null,
      });
    }
  }
  return { comments, promoted, unanchored, redated };
}

// --- Ajustes y plantillas --------------------------------------------------------------------------------------------

const BUILTIN = new Set(BUILTIN_ALL);
const SETTINGS_MAX = 1900;

/**
 * Los ajustes de una página con los ids nuevos: hoja, encabezado, títulos cortos y las marcas de plantilla (la página
 * es una plantilla propia, la carpeta *Templates*, la carpeta de reportes con su plantilla). Lo que no tiene la forma
 * de la app no se escribe.
 */
export function archiveSettings(raw: Record<string, unknown>, page: (oldId: string) => string | null): PageSettings {
  const out: PageSettings = {};
  const f = raw.format;
  if (isObj(f) && typeof f.size === 'string' && (f.size === 'free' || f.size in PAGE_SIZES)) {
    out.format = typeof f.landscape === 'boolean' ? { size: f.size, landscape: f.landscape } : { size: f.size };
  }
  const h = raw.header;
  const level = (v: unknown) => v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100);
  if (isObj(h) && level(h.levels)) {
    out.header = { levels: h.levels as number | null };
    if ('last' in h && level(h.last)) out.header.last = h.last as number | null;
  }
  if (typeof raw.split === 'boolean') out.split = raw.split;
  if (raw.templatesFolder === true) out.templatesFolder = true;
  // Fuera de las relaciones en vivo (D387).
  if (raw.graph === false) out.graph = false;
  const tpl = raw.template;
  if (tpl === false) out.template = false;
  else if (isObj(tpl)) {
    const own: { description?: string; dayReport?: true } = {};
    if (typeof tpl.description === 'string') own.description = tpl.description.slice(0, 1000);
    if (tpl.dayReport === true) own.dayReport = true;
    out.template = own;
  }
  const reports = raw.dayReports;
  if (reports === false) out.dayReports = false;
  else if (isObj(reports)) {
    const now = typeof reports.template === 'string' ? page(reports.template.toLowerCase()) : null;
    out.dayReports = now ? { template: now } : {};
  }
  // El tipo de la página y de la carpeta (Doc_Estructura_Proyecto.md): solo con la forma que conoce esta versión.
  const entity = entityMark({ settings: raw } as unknown as PageRow);
  if (entity === false) out.entity = false;
  else if (entity && entity !== 'other') out.entity = entity;
  const holds = holdsMark({ settings: raw } as unknown as PageRow);
  if (holds !== null && holds !== 'other') out.holds = holds;
  // La base pide menos de 2000 letras: lo primero que se acorta es la descripción de la plantilla.
  if (JSON.stringify(out).length > SETTINGS_MAX && isObj(out.template)) out.template = { ...out.template, description: (out.template.description ?? '').slice(0, 200) };
  return out;
}

/** La plantilla de la que salió la página: una de fábrica queda; una del archivo, la nueva; otra, ninguna. */
export function archiveTemplateId(id: string | null, page: (oldId: string) => string | null): string | null {
  if (!id) return null;
  if (BUILTIN.has(id)) return id;
  return page(id);
}

// --- El diario -------------------------------------------------------------------------------------------------------

export interface ArchiveJournalPage {
  pageId: string;
  /** El plan de la página mientras no terminó; de una terminada queda solo que se confirmó. */
  commit?: ImportCommit | ClosedCommit;
  /** El árbol (ajustes, ícono, plantilla) ya quedó. */
  meta?: true;
  /** La huella de lo que escribió la importación, y la que iba a escribir (antes de escribir). */
  written?: string;
  expected?: string;
  done?: true;
  files?: number;
  comments?: number;
}

export interface ArchiveJournal {
  recoveryVersion: 2;
  key: string;
  projectId: string;
  projectName: string;
  pages: Record<string, ArchiveJournalPage>;
  /** Por archivo viejo: la dirección nueva y el nombre (y si es la vista JPEG en lugar del original). */
  media: Record<string, { url: string; name: string; preview?: true }>;
  /** El id reservado para cada archivo que todavía no quedó en `media`, con la misma clave (importCommit.ts). */
  reserved?: Record<string, string>;
}

export interface ArchiveJournalStore extends RecoveryStore<ArchiveJournal> {
  get(key: string): Promise<ArchiveJournal | undefined>;
  put(journal: ArchiveJournal, expected?: ArchiveJournal): Promise<void>;
  remove(key: string, expected?: ArchiveJournal): Promise<void>;
}

/** El diario en `meta` de la base local (la tabla ya existe: la base no cambia). */
export function archiveJournal(db: Pick<LocalDb, 'transaction'>): ArchiveJournalStore {
  return recoveryStore<ArchiveJournal>(db, 'shotdocsImport', (j) => j.key);
}

// --- Importar --------------------------------------------------------------------------------------------------------

export interface ArchiveImportDeps {
  tree: Pick<PageTree, 'create' | 'createProject' | 'project' | 'get' | 'isTrashed' | 'setPatch' | 'dropFresh'>;
  docs: Pick<PageDocs, 'open' | 'close' | 'flush' | 'isSaved'>;
  media: Pick<MediaQueue, 'add' | 'enabled'>;
  journal?: ArchiveJournalStore;
  comments?: Pick<CommentQueue, 'importComments'>;
  /** El correo de quien importa: sus propios comentarios vuelven a su nombre (si exportó él). */
  userEmail?: string;
  /** La versión de la base del workspace (`null` si no se sabe todavía: sin red al empezar). */
  schemaVersion?: number | null;
}

export interface ArchiveProgress {
  done: number;
  total: number;
  page: string;
}

export interface ArchiveImportResult {
  projectId: string;
  pages: number;
  /** Archivos guardados (se suben con la sincronización), de esos cuántos con la vista JPEG en lugar del original. */
  files: number;
  previews: number;
  comments: number;
  problems: string[];
  resumable: boolean;
}

export interface ArchiveResumable {
  projectId: string;
  projectName: string;
  done: number;
  total: number;
}

/** Si hay una importación cortada de este archivo cuyo proyecto sigue estando, cuánto llegó a hacer. */
export async function findArchiveResumable(archive: ShotDocsArchive, deps: Pick<ArchiveImportDeps, 'tree' | 'journal'>): Promise<ArchiveResumable | null> {
  const pending = deps.journal ? await pendingImport(deps.journal, archive.key) : {};
  if (pending.complete) return null;
  const journal = pending.journal;
  if (!journal && pending.reservation) return { projectId: pending.reservation.projectId, projectName: pending.reservation.projectName, done: 0, total: archive.manifest.pages.length };
  if (!journal) return null;
  const project = deps.tree.project(journal.projectId);
  if (!project) return null;
  const done = archive.manifest.pages.filter((p) => journal.pages[p.id]?.done).length;
  return { projectId: journal.projectId, projectName: project.name, done, total: archive.manifest.pages.length };
}

/** El texto de un error de la importación de un archivo para la persona (`where`: ver `PendingTexts`). */
export function archiveProblemText(err: unknown, where: keyof PendingTexts = 'page'): string {
  return importPendingText(err, where, {
    job: { changed: t('importArchive.pending.job.changed'), unreadable: t('importArchive.pending.job.unreadable') },
    page: { unsaved: t('importArchive.pending.page.unsaved'), changed: t('importArchive.pending.page.changed'), mismatch: t('importArchive.pending.page.mismatch'), invalid: t('importArchive.pending.page.invalid') },
    close: t('importArchive.pending.close'),
  });
}

/** La página queda para seguir y el motivo ya está anotado: no suma otro renglón a la lista. */
const LATER = new Error('later');

/** Le da un respiro al navegador entre página y página. */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** La huella que va a tener la página con esos bloques (en un documento aparte, antes de escribir la de verdad). */
function validateBlocks(blocks: PartialBlock<any, any, any>[]): void {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment(CONTENT_FRAGMENT);
  const editor = BlockNoteEditor.create(
    withCollaboration({ ...editorSchemaOptions, resolveFileUrl: async () => HIDDEN_IMAGE, collaboration: { fragment, user: { name: 'Import', color: '#888888' } } }),
  ) as unknown as BlockNoteEditor<any, any, any>;
  const host = document.createElement('div');
  host.style.display = 'none';
  document.body.appendChild(host);
  try {
    editor.mount(host);
    if (blocks.length) editor.replaceBlocks(editor.document, blocks);

  } finally {
    editor.unmount();
    host.remove();
    doc.destroy();
  }
}

/** Las anotaciones de un JSON de página, revisadas (lo demás lo revisa `carryMarkup` al escribir). */
function readMarkup(raw: unknown): CopiedPhoto[] {
  if (!Array.isArray(raw)) return [];
  const out: CopiedPhoto[] = [];
  for (const p of raw.slice(0, 10_000)) {
    if (!isObj(p) || typeof p.fileId !== 'string' || !UUID.test(p.fileId) || !isObj(p.frame) || !Array.isArray(p.shapes)) continue;
    const frame = p.frame;
    if (typeof frame.v !== 'number' || typeof frame.w !== 'number' || typeof frame.h !== 'number') continue;
    const shapes = p.shapes.filter((s): s is [string, Record<string, unknown>] => Array.isArray(s) && typeof s[0] === 'string' && isObj(s[1]));
    out.push({ fileId: p.fileId.toLowerCase(), frame: { v: frame.v, w: frame.w, h: frame.h }, shapes });
  }
  return out;
}

const NOTE_ORDER = Object.keys(BLOCK_NOTES) as NoteKey[];

export async function importArchive(
  archive: ShotDocsArchive,
  deps: ArchiveImportDeps,
  options: ImportRunOptions & { projectName?: string; onProgress?: (p: ArchiveProgress) => void } = {},
): Promise<ArchiveImportResult> {
  try {
    return await runArchiveImport(archive, deps, options);
  } finally {
    // Termine o se corte: lo que se recordó para revisar los planes de esta importación ya no hace falta.
    forgetReviewed();
  }
}

async function runArchiveImport(
  archive: ShotDocsArchive,
  deps: ArchiveImportDeps,
  options: ImportRunOptions & { projectName?: string; onProgress?: (p: ArchiveProgress) => void },
): Promise<ArchiveImportResult> {
  const { manifest, source } = archive;
  const weight = archiveWeight(archive);
  if (weight.files > 0 && !deps.media.enabled) throw new ArchiveError('needsDrive');
  const problems: string[] = [...archive.notes];
  const plan = treePlan(
    manifest.pages.map((p): CodaManifestPage => ({ id: p.id, name: p.title, parentId: p.parent, order: p.order, contentType: '', file: '', media: [] })),
  );
  const byId = new Map(manifest.pages.map((p) => [p.id, p]));
  const pages = plan.pages.map((p) => ({ ...byId.get(p.id)!, parent: p.parentId }));
  const titleOf = (p: ArchivePage) => p.title.trim() || t('common.untitled');
  for (const p of plan.reattached) problems.push(`${p.name.trim() || t('common.untitled')}: ${t('importArchive.note.reattached')}`);
  const filesById = new Map(manifest.files.map((f) => [f.id, f]));

  const store = deps.journal;
  if (!store) throw new ImportPending('invalid');
  const generations = generationStore<ArchiveJournal>(store);
  const session = await beginImportGeneration<ArchiveJournal>(generations, archive.key, normalizeProjectName(options.projectName || manifest.projectName || manifest.title || t('project.untitled')), options, deps.tree,
    (projectId, projectName) => ({ recoveryVersion: 2, key: archive.key, projectId, projectName, pages: {}, media: {} }));
  let snapshot = session.snapshot;
  const journal = session.journal;
  let durable = structuredClone(journal);
  const state = journal;
  const save = async () => {
    try {
      snapshot = await generations.saveGeneration(snapshot, session.generationId, state);
      durable = structuredClone(state);
    } catch (err) {
      if (durable) {
        Object.assign(state, structuredClone(durable));
        if (!Object.hasOwn(durable, 'reserved')) delete state.reserved;
      }
      throw err;
    }
  };
  await save();

  // Los comentarios: sin `comments.json` no hay; uno roto se anota y la importación sigue sin ellos.
  let threads: Map<string, ArchiveThread[]> | null = null;
  if (source.has(COMMENTS_PATH)) {
    try {
      threads = parseArchiveComments(JSON.parse(await source.text(COMMENTS_PATH, MAX_COMMENTS_BYTES)));
    } catch {
      problems.push(t('importArchive.note.badComments'));
    }
  }
  if (threads && !deps.comments) {
    problems.push(t('importArchive.note.commentsOff'));
    threads = null;
  }
  // Con una base que todavía no acepta el origen `'shotdocs'`: los comentarios esperan y la importación queda para seguir.
  const commentsWait = !!threads && deps.schemaVersion != null && deps.schemaVersion < ARCHIVE_COMMENTS_SCHEMA_VERSION;
  if (commentsWait) problems.push(t('importArchive.note.commentsWait'));
  const mine = await isExporter(manifest.exporter, deps.userEmail);

  const live = (pageId: string | undefined): pageId is string => !!pageId && !!deps.tree.get(pageId) && !deps.tree.isTrashed(pageId);
  const newPage = (oldId: string): string | null => state.pages[oldId]?.pageId ?? null;

  // Primero todas las páginas, en el orden del árbol: los links y las marcas de plantilla tienen adónde ir. El id de
  // cada una se anota en el registro antes de crearla, como el del proyecto: si el guardado falla, no se crea nada; si
  // la app se corta entre anotar y crear, al seguir se crea con ese mismo id (y crear dos veces con el mismo id es
  // crear una). Una anotada que nunca llegó a crearse (solo tiene su id) lo usa; la que la persona mandó a la
  // papelera, o una que ya tenía algo hecho y no está más en el árbol, se reemplaza por otra, con un id nuevo y desde
  // cero.
  const create = async (p: (typeof pages)[number]): Promise<string> => {
    const entry = state.pages[p.id];
    let pageId = entry?.pageId;
    if (!entry || !pageId || deps.tree.get(pageId) || Object.keys(entry).length !== 1) {
      pageId = crypto.randomUUID();
      state.pages[p.id] = { pageId };
      await save();
    }
    const parent = p.parent ? state.pages[p.parent]?.pageId : undefined;
    const made = await deps.tree.create(live(parent) ? parent : null, p.title, state.projectId, { id: pageId });
    if (made !== pageId) {
      state.pages[p.id] = { pageId: made };
      await save();
    }
    // Una página sin título no es "recién creada": no ofrece las plantillas.
    if (!p.title) await deps.tree.dropFresh(made).catch(() => undefined);
    return made;
  };
  const planned = new Set(pages.map((p) => p.id));
  for (const [i, p] of pages.entries()) {
    if (i > 0 && i % 20 === 0) await breathe();
    const entry = state.pages[p.id];
    if (entry?.done || live(entry?.pageId)) continue;
    const mother = p.parent && planned.has(p.parent) ? state.pages[p.parent] : undefined;
    if (p.parent && planned.has(p.parent) && !live(mother?.pageId)) continue;
    await create(p).catch(() => undefined);
  }

  let files = 0;
  let previews = 0;
  let comments = 0;

  for (const [i, p] of pages.entries()) {
    if (i > 0) await breathe();
    const title = titleOf(p);
    options.onProgress?.({ done: i, total: pages.length, page: title });
    const entry = state.pages[p.id];
    if (entry?.done) {
      files += entry.files ?? 0;
      comments += entry.comments ?? 0;
      continue;
    }
    const pageNotes: string[] = [];
    try {
      const pageId = live(entry?.pageId) ? entry.pageId : await create(p);
      const current = state.pages[p.id];
      const notes: ImportNote[] = [];
      const note = (key: string, args?: ImportNote['args']) => { notes.push({ key, ...(args ? { args } : {}) }); };
      const checkpoint = async (commit: ImportCommit) => {
        const before = current.commit;
        current.commit = commit;
        try { await save(); } catch (err) { current.commit = before; throw err; }
      };
      const valid = () => !!deps.tree.project(state.projectId) && deps.tree.get(pageId)?.workspace_id === state.projectId && !deps.tree.isTrashed(pageId);
      const finish = async (commit: ImportCommit) => {
        if (!valid()) throw new ImportPending('changed');
        for (const n of commit.notes) pageNotes.push(t(n.key as Parameters<typeof t>[0], n.args));
        // Con la base sin la migración, la página ya quedó escrita y sus comentarios esperan: se suman al seguir.
        if (commit.commentsPlan.length && commentsWait) throw LATER;
        if (commit.commentsPlan.length) {
          try {
            await deps.comments!.importComments(commit.commentsPlan);
          } catch (err) {
            // La página ya quedó escrita; sus comentarios se reintentan al seguir (el mismo id no se repite).
            pageNotes.push(t('importArchive.note.commentsFailed', { reason: archiveProblemText(err) }));
            throw LATER;
          }
        }
        current.comments = commit.commentsPlan.length;
        comments += current.comments;
        // Terminada: no se vuelve a escribir, así que del plan queda solo que se confirmó.
        current.commit = closeCommit();
        current.done = true;
        await save();
      };
      const discard = async () => {
        const before = current.commit;
        delete current.commit;
        try { await save(); } catch (err) { current.commit = before; throw err; }
      };
      // Con el plan ya anotado, la página no se vuelve a armar; salvo que el plan nunca le haya llegado (`replan`).
      const plan = openCommit(current.commit);
      const earlier = plan ? await writePage(deps.docs, pageId, [], { commit: plan, checkpoint, valid, discard, prepare: async () => { throw new ImportPending('invalid'); } }) : null;
      if (earlier && earlier.result !== 'replan') {
        files += current.files ?? 0;
        await finish(earlier.commit!);
        for (const n of pageNotes) problems.push(`${title}: ${n}`);
        continue;
      }

      // El árbol: ajustes, ícono y plantilla con los ids nuevos (una vez).
      if (!current.meta) {
        const settings = archiveSettings(p.settings, newPage);
        const templateId = archiveTemplateId(p.templateId, newPage);
        const patch: Parameters<ArchiveImportDeps['tree']['setPatch']>[1] = {};
        if (Object.keys(settings).length) patch.settings = settings;
        if (p.icon) patch.icon = p.icon;
        if (templateId) patch.template_id = templateId;
        if (Object.keys(patch).length) await deps.tree.setPatch(pageId, patch);
        current.meta = true;
        await save();
      }

      // El contenido, del JSON de la página.
      let rawBlocks: unknown = [];
      let collapsed: string[] = [];
      let markup: CopiedPhoto[] = [];
      // Solo lo que se puede reintentar deja la página para seguir (un archivo que no se pudo guardar ahora). Lo que
      // falta en el archivo no vuelve por reintentar: se anota y la página entra con lo que hay.
      let complete = true;
      if (!p.json || !source.has(p.json)) {
        pageNotes.push(t('importArchive.note.noContent'));
      } else {
        let parsed: unknown;
        try {
          parsed = JSON.parse(await source.text(p.json, MAX_PAGE_JSON_BYTES));
        } catch (err) {
          if (err instanceof ZipReadError && err.code === 'crc') throw new Error(t('importArchive.note.damagedFile', { path: p.json }));
          if (err instanceof ZipReadError && err.code === 'tooBig') throw new Error(t('importArchive.note.recompressedTotal'));
          throw new Error(t('importArchive.note.badPageJson'));
        }
        if (!isObj(parsed) || (typeof parsed.id === 'string' && parsed.id.toLowerCase() !== p.id)) throw new Error(t('importArchive.note.badPageJson'));
        rawBlocks = parsed.blocks;
        collapsed = Array.isArray(parsed.collapsedForAll) ? parsed.collapsedForAll.filter((x): x is string => typeof x === 'string').slice(0, 50_000) : [];
        markup = readMarkup(parsed.photoMarkup);
      }
      if (!p.complete) pageNotes.push(t('importArchive.note.incomplete'));

      // Los archivos que usa la página: los que ya se guardaron (para otra página o en una vuelta anterior) se reusan.
      let pageFiles = 0;
      // El id de cada archivo que falta guardar se anota antes de guardar ninguno (un solo guardado del registro por
      // página): si la app se corta entre guardar un archivo y anotarlo, al seguir se guarda con el mismo id, y guardar
      // dos veces con el mismo id es guardar una. Así no queda un archivo de más en el dispositivo.
      const ids = { ...(state.reserved ?? {}) };
      let fresh = false;
      for (const oldId of mediaIdsInBlocks(rawBlocks)) {
        const f = filesById.get(oldId);
        if (state.media[oldId] || ids[oldId] || !f || !chosenBlob(archive, f)) continue;
        ids[oldId] = crypto.randomUUID();
        fresh = true;
      }
      if (fresh) {
        state.reserved = ids;
        await save();
      }
      for (const oldId of mediaIdsInBlocks(rawBlocks)) {
        if (state.media[oldId]) continue;
        const f = filesById.get(oldId);
        if (f && recompressed(archive, f)) note('importArchive.note.recompressed', { name: f.name });
        const got = f ? chosenBlob(archive, f) : null;
        if (!f || !got) continue;
        try {
          const blob = await source.blob(got.path, got.preview ? 'image/jpeg' : f.mime || undefined);
          const name = got.preview ? `${f.name.replace(/\.[^.]{1,6}$/, '')}.jpg` : f.name;
          const reserved = state.reserved?.[oldId];
          const url = await deps.media.add(pageId, new File([blob], name, { type: got.preview ? 'image/jpeg' : f.mime || blob.type }), reserved ? { id: reserved } : undefined);
          state.media[oldId] = got.preview ? { url, name, preview: true } : { url, name };
          if (state.reserved) delete state.reserved[oldId];
          await save();
          pageFiles++;
          if (got.preview) {
            previews++;
            note('importArchive.note.preview', { name: f.name });
          }
        } catch (err) {
          // Solo lo que se puede reintentar deja la página para seguir (sin lugar, el tope de lo que se descomprime de
          // una vez, el registro que no se pudo guardar). Un archivo dañado en el zip, o que el dispositivo rechaza por
          // lo que es (vacío), no entra por reintentar: se anota y su nombre queda en su lugar, como uno que falta.
          const permanent = (err instanceof ZipReadError && err.code !== 'tooBig') || (err instanceof FileRejected && err.permanent);
          if (!permanent) complete = false;
          const why =
            err instanceof ZipReadError && err.code === 'tooBig'
              ? t('importArchive.note.recompressedTotal')
              : err instanceof ZipReadError
                ? t('importArchive.note.damagedFile', { path: got.path })
                : archiveProblemText(err);
          pageNotes.push(`${f.name}: ${why}`);
        }
      }
      files += pageFiles;
      current.files = (current.files ?? 0) + pageFiles;
      if (!complete) {
        // La página no se escribe a medias: al seguir se escribe entera, una sola vez. Lo anotado de los archivos que
        // sí se guardaron se muestra ahora (al seguir ya no se vuelven a mirar).
        for (const n of notes) pageNotes.push(t(n.key as Parameters<typeof t>[0], n.args));
        await save();
        throw LATER;
      }

      // Los bloques, revisados y con los ids nuevos.
      const counts = new Map<NoteKey, { n: number; details: Set<string> }>();
      const blocks = cleanArchiveBlocks(rawBlocks, {
        media: (oldId) => {
          const m = state.media[oldId];
          return m ? { url: m.url, name: m.name } : null;
        },
        page: newPage,
        note: (key, detail) => {
          const c = counts.get(key) ?? { n: 0, details: new Set<string>() };
          c.n++;
          if (detail && c.details.size < 5) c.details.add(detail);
          counts.set(key, c);
        },
      });
      for (const key of NOTE_ORDER) {
        const c = counts.get(key);
        if (c) note(BLOCK_NOTES[key], { count: c.n, list: [...c.details].join(', ') });
      }

      let toWrite = blocks;
      try { validateBlocks(blocks); }
      catch {
        note('importArchive.note.textOnly');
        toWrite = textOnlyBlocks(blocks);
        validateBlocks(toWrite);
      }
      const newIds = new Set(mediaIdsInBlocks(toWrite));
      const extra = (doc: Y.Doc, written: PageBlock[]) => {
        const ids = new Set(written.map((b) => b.id));
        const map = doc.getMap(SHARED_COLLAPSE_MAP);
        for (const id of collapsed) if (ids.has(id) && map.get(id) !== true) map.set(id, true);
        const photos: CopiedPhoto[] = [];
        for (const m of markup) {
          const nowId = mediaIdOf(state.media[m.fileId]?.url);
          if (nowId && newIds.has(nowId)) photos.push({ ...m, fileId: nowId });
        }
        if (photos.length) {
          const carried = carryMarkup(doc, photos, newIds, 'sd-archive-import');
          if (carried.skipped.some((s) => s.reason !== 'notInContent')) note('importArchive.note.markupSkipped', { count: carried.skipped.length });
        }
      };
      const outcome = await writePage(deps.docs, pageId, toWrite, {
        checkpoint,
        valid,
        prepare: async (written, appended) => {
          if (appended) note('importArchive.note.appended');
          const built = await buildArchiveComments(threads?.get(p.id) ?? [], {
            projectId: state.projectId, pageId, blockIds: new Set(written.map((b) => b.id)), mine,
          });
          if (built.promoted) note('importArchive.note.promoted', { count: built.promoted });
          if (built.unanchored) note('importArchive.note.unanchored', { count: built.unanchored });
          if (built.redated) note('importArchive.note.redated', { count: built.redated });
          return { notes, commentsPlan: built.comments };
        },
      }, extra);
      if (outcome.result === 'unsupported') {
        pageNotes.push(t('importArchive.note.unsupported'));
        throw LATER;
      }
      await finish(outcome.commit!);
    } catch (err) {
      if (err !== LATER) pageNotes.push(archiveProblemText(err));
    }
    for (const n of pageNotes) problems.push(`${title}: ${n}`);
  }

  let resumable = pages.some((p) => !state.pages[p.id]?.done);
  if (!resumable) try { await generations.completeGeneration(snapshot, session.generationId, pages.map((p) => p.id)); } catch (err) { resumable = true; problems.push(archiveProblemText(err, 'close')); }
  options.onProgress?.({ done: pages.length, total: pages.length, page: '' });
  return { projectId: state.projectId, pages: pages.filter((p) => state.pages[p.id]?.done).length, files, previews, comments, problems: [...new Set(problems)], resumable: resumable && !!store };
}
