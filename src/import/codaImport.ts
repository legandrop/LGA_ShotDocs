import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import * as Y from 'yjs';
import { isMediaFile, type MediaQueue } from '../media/queue';
import type { PageDocs } from '../sync/docs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import type { PageTree } from '../sync/tree';
import { t } from '../i18n';
import '../i18n/lazy/importCoda';
import type { LocalDb } from '../sync/localDb';
import { editorSchemaOptions } from '../ui/editorSchema';
import { findUnknownContent } from '../ui/unknownContent';
import type { CommentQueue } from '../sync/comments';
import { pagePath } from '../router';
import { checkForeignImages, CODA_TEXT_WIDTH, codaPhotoWidth, finishBlocks, prepareCodaHtml, type CodaMedia, type InlinePhoto, type LooseBlock } from './codaHtml';
import { buildComments, pageBlocks, parseCodaComments, type CodaComments, type PageBlock } from './codaComments';

// Importa a un proyecto nuevo la carpeta que arma `scripts/coda-export.mjs` (Docs/Doc_Importar_Coda.md):
// `manifest.json` con el árbol de páginas, `pages/<n>_<id>.html` con el HTML de Coda y `media/bl-….<ext>`.
// Todo va por los mismos caminos que usa la app al escribir: `tree.create` para cada página, `media.add`
// para cada archivo (queda en el dispositivo y la sincronización lo sube al Drive por el portero) y el
// documento de la página con un editor sin pantalla. Por eso funciona sin red y lo que ya se guardó en el
// dispositivo se sube solo. Si se corta a mitad, el diario (`ImportJournal`) deja seguir en el mismo
// proyecto sin repetir páginas ni archivos (y sin duplicarlos en el Drive). Si la carpeta tiene
// `comments.json` (los comentarios, capturados aparte: ver codaComments.ts), cada página suma los suyos a la
// cola de comentarios apenas se escribe. Primero se crean todas las páginas y después se escribe cada una:
// así un link a otra página del doc (`coda-page:<id>`, ver codaHtml.ts) siempre tiene adónde ir. El mismo
// archivo en varias páginas se guarda (y se sube) una sola vez: las demás usan la misma dirección.

/** Los comentarios capturados, en la raíz de la carpeta exportada. */
export const COMMENTS_FILE = 'comments.json';

export interface CodaManifestPage {
  id: string;
  name: string;
  subtitle?: string;
  parentId: string | null;
  order: number;
  contentType: string;
  file: string;
  media: { url: string; file: string }[];
}

export interface CodaManifest {
  doc: { id: string; name: string };
  pages: CodaManifestPage[];
  /** Lo que anotó `coda-export` (páginas que no pudo exportar, archivos que no pudo bajar). */
  problems?: string[];
}

/** La carpeta exportada. Las rutas son relativas a ella (`pages/…`, `media/…`). */
export interface CodaFolder {
  manifest: CodaManifest;
  has(path: string): boolean;
  /** Todas las rutas de la carpeta. */
  paths(): string[];
  text(path: string): Promise<string>;
  file(path: string): Promise<Blob>;
  /** Cuánto pesa un archivo de la carpeta, en bytes (0 si no está). */
  size(path: string): number;
}

/**
 * Lo que va quedando de una importación, en el dispositivo (`meta` de la base local, clave
 * `codaImport:<doc>`): si se corta (se cerró la app, se cortó la luz), la próxima vez sigue en el mismo
 * proyecto sin crear de nuevo las páginas ya creadas ni volver a guardar (y subir al Drive) los archivos ya
 * guardados. Se borra al terminar.
 */
export interface ImportJournal {
  docId: string;
  projectId: string;
  projectName: string;
  /**
   * Por página de Coda: la página de la app; `written`, la huella de lo que escribió la importación (para
   * saber al seguir si la persona la editó después); `done`, terminada (no se vuelve a tocar).
   */
  pages: Record<string, JournalPage>;
  /**
   * Por página de Coda y archivo (`<página> <blob o dirección>`): la dirección `sdmedia://` y el nombre.
   * `shared`: la página usa un archivo que se guardó para otra página (no se cuenta dos veces).
   */
  media: Record<string, JournalMedia>;
}

export interface JournalMedia {
  url: string;
  name: string;
  shared?: true;
  /** El blob o la dirección del archivo (lo que va después de `<página> ` en la clave). */
  key?: string;
}

export interface JournalPage {
  pageId: string;
  written?: string;
  done?: boolean;
  files?: number;
  /** Comentarios de Coda que quedaron en la cola. */
  comments?: number;
}

export interface JournalStore {
  get(docId: string): Promise<ImportJournal | undefined>;
  put(journal: ImportJournal): Promise<void>;
  remove(docId: string): Promise<void>;
}

const JOURNAL_PREFIX = 'codaImport:';

/** El diario de la importación en `meta` de la base local (la tabla ya existe: la base no cambia). */
export function metaJournal(db: Pick<LocalDb, 'get' | 'put' | 'delete'>): JournalStore {
  return {
    get: async (docId) => (await db.get('meta', JOURNAL_PREFIX + docId)) as ImportJournal | undefined,
    put: async (journal) => {
      await db.put('meta', journal, JOURNAL_PREFIX + journal.docId);
    },
    remove: (docId) => db.delete('meta', JOURNAL_PREFIX + docId),
  };
}

export interface ImportDeps {
  tree: Pick<PageTree, 'create' | 'createProject' | 'project' | 'get' | 'isTrashed'>;
  docs: Pick<PageDocs, 'open' | 'close' | 'flush'>;
  media: Pick<MediaQueue, 'add' | 'enabled'>;
  /** Sin diario, una importación cortada no se puede seguir (las pruebas lo omiten a veces). */
  journal?: JournalStore;
  /** La cola de comentarios, para los de `comments.json`. Sin ella, los comentarios no se importan. */
  comments?: Pick<CommentQueue, 'importComments'>;
  /** El correo de quien importa: sus propios comentarios de Coda quedan a su nombre. */
  userEmail?: string;
}

export interface ImportProgress {
  /** Páginas terminadas. */
  done: number;
  total: number;
  /** La página que se está importando ('' al terminar). */
  page: string;
}

export interface ImportResult {
  projectId: string;
  pages: number;
  files: number;
  /** Comentarios de Coda que quedaron en la cola (suben con la sincronización). */
  comments: number;
  /** Lo que no se pudo traer, por página. */
  problems: string[];
  /** Lo que anotó `coda-export` al bajar el doc (`manifest.problems`). */
  exportProblems: string[];
  /** Quedó algo para reintentar (una página que falló, un archivo que no entró): se puede seguir. */
  resumable: boolean;
}

/** Una importación de este doc que quedó cortada y se puede seguir (su proyecto sigue estando). */
export interface Resumable {
  projectId: string;
  projectName: string;
  done: number;
  total: number;
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

/**
 * Revisa el manifest y lo deja con la forma que espera la importación: sin `pages` (o sin un objeto) es un
 * error claro; una página con campos que faltan o de otro tipo queda con valores por defecto (sin nombre,
 * sin archivos, en su lugar por orden de llegada). Una página sin id o con el id repetido recibe uno propio.
 */
export function checkManifest(raw: unknown): CodaManifest {
  const obj = raw as { doc?: unknown; pages?: unknown; problems?: unknown } | null;
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.pages)) throw new Error(t('import.badManifest'));
  const doc = (obj.doc && typeof obj.doc === 'object' ? obj.doc : {}) as { id?: unknown; name?: unknown };
  // Un id que falta o que se repite sale de lo que tiene la página (nombre, padre, orden, archivo), no de su
  // lugar en la lista: el diario de una importación cortada lo reconoce aunque el manifest cambie de orden.
  // Solo pasa con un manifest roto (coda-export siempre pone el id de Coda).
  const counts = new Map<string, number>();
  for (const item of obj.pages) {
    const id = item && typeof item === 'object' ? str((item as { id?: unknown }).id) : '';
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const seen = new Set<string>();
  const pages: CodaManifestPage[] = [];
  for (const [i, item] of obj.pages.entries()) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    const own = str(p.id);
    const shape = [p.name, p.parentId, p.order, p.file, p.subtitle].map((v) => String(v ?? '')).join('\u0000');
    let id = own && counts.get(own) === 1 ? own : `${own || 'page'}#${stableHash(shape)}`;
    // Dos páginas idénticas en todo: la segunda, con un número (ahí el orden sí decide).
    for (let n = 2; seen.has(id); n++) id = `${own || 'page'}#${stableHash(shape)}-${n}`;
    seen.add(id);
    const media = Array.isArray(p.media)
      ? p.media
          .filter((m): m is { url: string; file: string } => !!m && typeof m === 'object' && typeof m.url === 'string' && typeof m.file === 'string')
          .map((m) => ({ url: m.url, file: m.file }))
      : [];
    pages.push({
      id,
      name: str(p.name),
      subtitle: str(p.subtitle),
      parentId: str(p.parentId) || null,
      order: typeof p.order === 'number' && Number.isFinite(p.order) ? p.order : i,
      contentType: str(p.contentType, 'canvas'),
      file: str(p.file),
      media,
    });
  }
  const problems = Array.isArray(obj.problems) ? obj.problems.filter((x): x is string => typeof x === 'string') : [];
  return { doc: { id: str(doc.id), name: str(doc.name).trim() || t('project.untitled') }, pages, problems };
}

/** Un hash corto y estable (FNV-1a de 32 bits), en base 36. */
function stableHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** Arma la carpeta a partir de lo que devuelve `<input type="file" webkitdirectory>`. */
export async function folderFromFiles(files: Iterable<File>): Promise<CodaFolder> {
  const byPath = new Map<string, File>();
  for (const f of files) {
    // `webkitRelativePath` empieza con el nombre de la carpeta elegida: se saca.
    const rel = (f.webkitRelativePath || f.name).split('/').slice(1).join('/') || f.name;
    byPath.set(rel, f);
  }
  const manifestFile = byPath.get('manifest.json');
  if (!manifestFile) throw new Error(t('import.noManifest'));
  let raw: unknown;
  try {
    raw = JSON.parse(await manifestFile.text());
  } catch {
    throw new Error(t('import.badManifest'));
  }
  const manifest = checkManifest(raw);
  const get = (path: string) => {
    const f = byPath.get(path);
    if (!f) throw new Error(t('import.missingFile', { path }));
    return f;
  };
  return {
    manifest,
    has: (p) => byPath.has(p),
    paths: () => [...byPath.keys()],
    text: (p) => get(p).text(),
    file: async (p) => get(p),
    size: (p) => byPath.get(p)?.size ?? 0,
  };
}

/**
 * Los comentarios de la carpeta (`comments.json`), o `null` si no tiene. Un archivo que no se puede leer, o
 * de otro doc, es un error con su motivo (la importación lo anota y sigue sin comentarios).
 */
export async function readComments(folder: CodaFolder): Promise<CodaComments | null> {
  if (!folder.has(COMMENTS_FILE)) return null;
  let parsed: CodaComments;
  try {
    parsed = parseCodaComments(JSON.parse(await folder.text(COMMENTS_FILE)));
  } catch {
    throw new Error(t('import.badComments'));
  }
  const docId = folder.manifest.doc.id;
  if (parsed.docId && docId && parsed.docId !== docId) throw new Error(t('import.commentsOtherDoc'));
  return parsed;
}

/** Cuántos comentarios trae la carpeta (0 sin `comments.json` o si no se puede leer). */
export async function countComments(folder: CodaFolder): Promise<number> {
  const found = await readComments(folder).catch(() => null);
  if (!found) return 0;
  const ids = new Set(folder.manifest.pages.map((p) => p.id));
  let n = 0;
  for (const [pageId, threads] of found.pages) if (ids.has(pageId)) for (const th of threads) n += th.comments.length;
  return n;
}

/** Cuánto pesan los archivos que se van a importar (cada uno una vez), en bytes. */
export function importSize(folder: CodaFolder): number {
  const files = new Set<string>();
  for (const p of folder.manifest.pages) for (const m of p.media) files.add(`media/${m.file}`);
  let total = 0;
  for (const path of files) total += folder.size(path);
  return total;
}

/**
 * Las páginas en el orden del árbol: cada padre antes que sus hijas, las hermanas en su orden. Una página
 * cuyo padre no está en el manifest, o que forma un círculo con otras (A dentro de B dentro de A), va al
 * primer nivel (con `parentId: null`) y queda en `reattached`: ninguna se pierde.
 */
export function treePlan(pages: CodaManifestPage[]): { pages: CodaManifestPage[]; reattached: CodaManifestPage[] } {
  const ids = new Set(pages.map((p) => p.id));
  const children = new Map<string | null, CodaManifestPage[]>();
  const reattached: CodaManifestPage[] = [];
  const moved = new Set<string>();
  for (const p of pages) {
    const known = !!p.parentId && ids.has(p.parentId) && p.parentId !== p.id;
    if (p.parentId && !known) moved.add(p.id);
    const parent = known ? p.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), p]);
  }
  for (const list of children.values()) list.sort((a, b) => a.order - b.order);
  const out: CodaManifestPage[] = [];
  const visited = new Set<string>();
  const add = (p: CodaManifestPage, root: boolean) => {
    visited.add(p.id);
    if (root && p.parentId) {
      moved.add(p.id);
      out.push({ ...p, parentId: null });
    } else {
      out.push(p);
    }
    for (const c of children.get(p.id) ?? []) if (!visited.has(c.id)) add(c, false);
  };
  for (const p of children.get(null) ?? []) add(p, true);
  // Lo que no se alcanzó desde el primer nivel está en un círculo: la primera de cada uno va arriba.
  for (const p of [...pages].sort((a, b) => a.order - b.order)) if (!visited.has(p.id)) add(p, true);
  for (const p of out) if (moved.has(p.id)) reattached.push(p);
  return { pages: out, reattached };
}

export function treeOrder(pages: CodaManifestPage[]): CodaManifestPage[] {
  return treePlan(pages).pages;
}

/** Si hay una importación cortada de este doc cuyo proyecto sigue estando, cuánto llegó a hacer. */
export async function findResumable(folder: CodaFolder, deps: Pick<ImportDeps, 'tree' | 'journal'>): Promise<Resumable | null> {
  const docId = folder.manifest.doc.id;
  if (!docId || !deps.journal) return null;
  const journal = await deps.journal.get(docId);
  if (!journal) return null;
  if (!deps.tree.project(journal.projectId)) {
    // El proyecto ya no está (se perdió el acceso, por ejemplo): no hay dónde seguir.
    await deps.journal.remove(docId).catch(() => undefined);
    return null;
  }
  const done = folder.manifest.pages.filter((p) => journal.pages[p.id]?.done).length;
  return { projectId: journal.projectId, projectName: deps.tree.project(journal.projectId)!.name, done, total: folder.manifest.pages.length };
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'application/pdf': 'pdf',
};

/** El nombre con que queda el archivo: el de Coda si es un nombre de archivo, si no `bl-….<ext>`. */
function fileName(m: CodaMedia, stored: string): string {
  const name = m.name.trim();
  if (/\.[a-z0-9]{2,5}$/i.test(name) && !/^bl-/.test(name)) return name;
  const ext = stored.split('.').pop() || EXT[m.mime] || 'bin';
  return `${m.blobId || 'file'}.${ext}`;
}

// Más ancho que esto en Coda es "a lo ancho de la página": el bloque va sin ancho propio.
const FULL_WIDTH = 700;

/** Le da un respiro al navegador entre página y página (dibujar el progreso, atender clics). */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const pageTitle = (page: CodaManifestPage) => page.name.replace(/\s+/g, ' ').trim() || t('common.untitled');

/** Una dirección larga (un `data:`) no ocupa media pantalla en la lista del final. */
const shortUrl = (url: string) => (url.length > 80 ? `${url.slice(0, 77)}…` : url) || '—';

export async function importCoda(
  folder: CodaFolder,
  deps: ImportDeps,
  options: { projectName?: string; resume?: boolean; onProgress?: (p: ImportProgress) => void } = {},
): Promise<ImportResult> {
  if (!deps.media.enabled) throw new Error(t('import.needsDrive'));
  const { manifest } = folder;
  const plan = treePlan(manifest.pages);
  const pages = plan.pages;
  const problems: string[] = [];
  for (const p of plan.reattached) problems.push(`${pageTitle(p)}: ${t('import.reattached')}`);

  const docId = manifest.doc.id;
  const store = docId ? deps.journal : undefined;
  let journal = options.resume && store ? await store.get(docId) : undefined;
  if (journal && !deps.tree.project(journal.projectId)) journal = undefined;
  if (!journal) {
    const projectName = options.projectName || manifest.doc.name;
    const projectId = await deps.tree.createProject(projectName);
    journal = { docId, projectId, projectName, pages: {}, media: {} };
  }
  const state = journal;
  // Cada paso se anota apenas queda guardado en el dispositivo. Si anotarlo falla, la importación sigue
  // igual: solo se pierde poder seguirla después de un corte.
  const save = async () => {
    await store?.put(state).catch(() => undefined);
  };
  await save();

  let codaComments: CodaComments | null = null;
  try {
    codaComments = await readComments(folder);
  } catch (err) {
    problems.push(err instanceof Error ? err.message : String(err));
  }
  if (codaComments && !deps.comments) {
    problems.push(t('import.commentsOff'));
    codaComments = null;
  }
  // Los archivos ya guardados en esta importación, por blob (de cualquier página): otra página que usa el
  // mismo, usa la misma dirección.
  const sharedMedia = new Map<string, JournalMedia>();
  // Solo los de páginas sin terminar: el archivo de una página terminada pudo quedar sin uso (la persona lo
  // borró de la página) y hasta mandarse a la papelera del Drive; reusarlo lo dejaría perdido. Esas páginas
  // guardan su propia copia, como antes.
  for (const [key, saved] of Object.entries(state.media)) {
    const codaPage = key.slice(0, key.indexOf(' '));
    if (saved.shared || state.pages[codaPage]?.done) continue;
    sharedMedia.set(saved.key ?? key.slice(key.indexOf(' ') + 1), saved);
  }
  // Un link a otra página del doc va a la página creada (aunque esté en la papelera: si vuelve, el link anda).
  const pageLink = (codaId: string) => {
    const id = state.pages[codaId]?.pageId;
    return id ? pagePath(id) : null;
  };
  const context: PageContext = { comments: codaComments, projectId: state.projectId, sharedMedia, pageLink };

  const live = (pageId: string | undefined): pageId is string => !!pageId && !!deps.tree.get(pageId) && !deps.tree.isTrashed(pageId);
  const parser = BlockNoteEditor.create(editorSchemaOptions) as unknown as BlockNoteEditor<any, any, any>;
  let files = 0;
  let comments = 0;

  // Primero, todas las páginas que faltan, en el orden del árbol (la madre antes que sus hijas): cuando se
  // escriba una, las páginas a las que apuntan sus links ya existen (también en un ciclo A ↔ B). Una que no
  // se pudo crear acá se reintenta, y se anota si vuelve a fallar, al escribirla.
  // Una hija cuya madre no se pudo crear acá espera a la segunda pasada (que reintenta la madre antes): si
  // no, quedaría en el primer nivel sin que nadie lo anote.
  const planned = new Set(pages.map((p) => p.id));
  for (const [i, page] of pages.entries()) {
    if (i > 0 && i % 20 === 0) await breathe();
    const entry = state.pages[page.id];
    if (entry?.done || live(entry?.pageId)) continue;
    const mother = page.parentId && planned.has(page.parentId) ? state.pages[page.parentId] : undefined;
    if (page.parentId && planned.has(page.parentId) && !mother?.done && !live(mother?.pageId)) continue;
    try {
      const parent = page.parentId ? state.pages[page.parentId]?.pageId : undefined;
      const pageId = await deps.tree.create(live(parent) ? parent : null, pageTitle(page), state.projectId);
      state.pages[page.id] = { pageId };
      await save();
    } catch {
      // Se reintenta al escribirla.
    }
  }

  for (const [i, page] of pages.entries()) {
    if (i > 0) await breathe();
    const entry = state.pages[page.id];
    // Sin nombre en el manifest (`checkManifest` lo deja en ''), "Untitled": nunca corta la importación.
    const title = pageTitle(page);
    options.onProgress?.({ done: i, total: pages.length, page: title });
    // Ya terminada en una vuelta anterior: no se vuelve a tocar, aunque la persona la haya mandado a la
    // papelera después (no vuelve).
    if (entry?.done) {
      files += entry.files ?? 0;
      comments += entry.comments ?? 0;
      continue;
    }
    // Una página que falla queda creada (vacía o a medias) y anotada, sin terminar: al seguir se reintenta.
    try {
      let pageId = live(entry?.pageId) ? entry.pageId : null;
      if (!pageId) {
        const parent = page.parentId ? state.pages[page.parentId]?.pageId : undefined;
        pageId = await deps.tree.create(live(parent) ? parent : null, title, state.projectId);
        state.pages[page.id] = { pageId };
        await save();
      }
      const got = await importPage(folder, deps, parser, page, pageId, title, problems, state, save, context);
      state.pages[page.id] = { pageId, files: got.files, comments: got.comments || undefined, written: got.written, done: got.complete || undefined };
      await save();
      files += got.files;
      comments += got.comments;
    } catch (err) {
      problems.push(`${title}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // Todo terminado: no hay nada que seguir. Si algo quedó sin terminar, el diario queda para seguir.
  const resumable = pages.some((p) => !state.pages[p.id]?.done);
  if (!resumable) await store?.remove(docId).catch(() => undefined);
  options.onProgress?.({ done: pages.length, total: pages.length, page: '' });
  return {
    projectId: state.projectId,
    pages: pages.length,
    files,
    comments,
    problems,
    exportProblems: manifest.problems ?? [],
    resumable: resumable && !!store,
  };
}

/** Lo que comparten todas las páginas de una importación. */
interface PageContext {
  comments: CodaComments | null;
  projectId: string;
  /** Los archivos ya guardados en esta importación, por blob o dirección. */
  sharedMedia: Map<string, JournalMedia>;
  /** La dirección de la página creada para una página de Coda, o null. */
  pageLink: (codaId: string) => string | null;
}

/**
 * Pone en la cola los comentarios de Coda de una página, cada hilo en el bloque que tiene su texto (`blocks`,
 * los de la página ya escrita) o en la página si no se encuentra. Devuelve cuántos quedaron en la cola, y si
 * algo falló (la página queda sin terminar para reintentarlo al seguir: el mismo id no se repite).
 */
async function importPageComments(
  deps: ImportDeps,
  context: PageContext,
  page: CodaManifestPage,
  pageId: string,
  title: string,
  blocks: PageBlock[],
  problems: string[],
): Promise<{ count: number; ok: boolean }> {
  const threads = context.comments?.pages.get(page.id) ?? [];
  if (threads.length === 0 || !deps.comments) return { count: 0, ok: true };
  try {
    const built = await buildComments(threads, {
      projectId: context.projectId,
      pageId,
      codaPageId: page.id,
      blocks,
      userEmail: deps.userEmail,
      capturedAt: context.comments?.capturedAt,
    });
    const count = await deps.comments.importComments(built.comments);
    if (built.lost) problems.push(`${title}: ${t('import.commentsOnPage', { count: built.lost })}`);
    return { count, ok: true };
  } catch (err) {
    problems.push(`${title}: ${t('import.commentsFailed', { reason: err instanceof Error ? err.message : String(err) })}`);
    return { count: 0, ok: false };
  }
}

async function importPage(
  folder: CodaFolder,
  deps: ImportDeps,
  parser: BlockNoteEditor<any, any, any>,
  page: CodaManifestPage,
  pageId: string,
  title: string,
  problems: string[],
  journal: ImportJournal,
  save: () => Promise<void>,
  context: PageContext,
): Promise<{ files: number; comments: number; complete: boolean; written?: string }> {
  if (!page.file || !folder.has(`pages/${page.file}`)) {
    problems.push(`${title}: ${page.contentType === 'canvas' ? t('import.notExported') : t('import.notCanvas', { type: page.contentType })}`);
    // Sin contenido, los comentarios van a la página.
    const got = await importPageComments(deps, context, page, pageId, title, [], problems);
    return { files: 0, comments: got.count, complete: got.ok };
  }

  const { html, media, embeds, brokenLinks } = prepareCodaHtml(await folder.text(`pages/${page.file}`), context.pageLink);
  for (const url of embeds) problems.push(`${title}: ${t('import.embed', { url: shortUrl(url) })}`);
  for (const link of brokenLinks) problems.push(`${title}: ${t('import.brokenPageLink', { text: link.text || link.id || '?' })}`);
  // Un archivo que no se pudo guardar (sin espacio, por ejemplo) deja la página sin terminar: al seguir se
  // reintenta. Uno que falta en la carpeta no: volver a probar no lo trae.
  let complete = true;
  // Cada archivo, a la cola de la app (en el dispositivo; se sube solo). El mismo archivo dos veces en la
  // página, o ya guardado para otra página de esta importación (el mismo blob), se guarda una vez y todos
  // los bloques usan la misma dirección (la app suma el uso de la otra página sola: `link_page_file`).
  // `files` cuenta los archivos guardados para esta página, no los que usa de otra.
  let files = 0;
  const urls = new Map<number, string>();
  const names = new Map<number, string>();
  const byKey = new Map<string, JournalMedia>();
  for (const m of media) {
    if (m.external) continue;
    const key = m.blobId || m.src;
    let saved = byKey.get(key) ?? journal.media[`${page.id} ${key}`];
    if (!saved) {
      const other = context.sharedMedia.get(key);
      if (other) {
        saved = { url: other.url, name: other.name, shared: true };
        journal.media[`${page.id} ${key}`] = saved;
        await save();
      }
    }
    if (saved) {
      urls.set(m.index, saved.url);
      names.set(m.index, saved.name);
      if (!byKey.has(key) && !saved.shared) files++;
      byKey.set(key, saved);
      continue;
    }
    const stored = findStored(folder, page, m);
    if (!stored) {
      problems.push(`${title}: ${t('import.missingMedia', { file: m.blobId || shortUrl(m.src) })}`);
      continue;
    }
    try {
      const blob = await folder.file(`media/${stored}`);
      const type = m.mime || blob.type;
      const file = new File([blob], fileName(m, stored), { type });
      const got: JournalMedia = { url: await deps.media.add(pageId, file), name: file.name, key };
      // Anotado apenas quedó guardado: si la importación se corta, al seguirla no se guarda (ni sube) otra vez.
      journal.media[`${page.id} ${key}`] = got;
      await save();
      context.sharedMedia.set(key, got);
      byKey.set(key, got);
      urls.set(m.index, got.url);
      names.set(m.index, got.name);
      files++;
    } catch (err) {
      complete = false;
      problems.push(`${title}: ${fileName(m, stored)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const imageOf = (index: number): LooseBlock | null => {
    const m = media[index];
    const width = m.width > 0 && m.width < FULL_WIDTH ? m.width : undefined;
    const size = width ? { previewWidth: width } : {};
    // Una foto de otro sitio va con su dirección; `checkForeignImages` decide si queda y la anota.
    if (m.external) return { type: 'image', props: { url: m.src, name: m.name, ...size }, children: [] };
    const url = urls.get(index);
    if (!url) return null;
    return { type: 'image', props: { url, name: names.get(index) ?? '', ...size }, children: [] };
  };
  // Una foto o un video va en línea, en su renglón y con la parte del renglón que ocupaba en Coda (entrega 4 de
  // Doc_Fotos_En_Linea.md); un adjunto (PDF, zip…) queda como bloque, la tarjeta.
  const photoOf = (index: number, line = CODA_TEXT_WIDTH): InlinePhoto | null => {
    const m = media[index];
    const w = codaPhotoWidth(m.width, line);
    // Una foto de otro sitio va con su dirección; `checkForeignImages` decide si queda y la anota.
    if (m.external) return { type: 'photo', props: { url: m.src, name: m.name, w } };
    const url = urls.get(index);
    const name = names.get(index) ?? '';
    if (!url || !isMediaFile({ type: m.mime, name })) return null;
    return { type: 'photo', props: { url, name, w } };
  };
  const placed = new Set<number>();
  const parsed = (await parser.tryParseHTMLToBlocks(html)) as unknown as LooseBlock[];
  let blocks = finishBlocks(
    parsed,
    (index) => {
      placed.add(index);
      return imageOf(index);
    },
    (index, line) => {
      const photo = photoOf(index, line);
      if (photo) placed.add(index);
      return photo;
    },
  );
  // Red de seguridad: una foto ya guardada que la conversión no ubicó va al final, anotada; nunca se pierde.
  for (const index of urls.keys()) {
    if (placed.has(index)) continue;
    const photo = photoOf(index);
    blocks.push(photo ? { type: 'paragraph', content: [photo], children: [] } : imageOf(index)!);
    problems.push(`${title}: ${t('import.movedToEnd', { file: names.get(index) ?? '' })}`);
  }
  // Las fotos que no quedaron guardadas en la app: las https quedan enlazadas, las demás se sacan.
  blocks = checkForeignImages(blocks, (url, kept) => {
    problems.push(`${title}: ${kept ? t('import.linked', { url: shortUrl(url) }) : t('import.dropped', { url: shortUrl(url) })}`);
  });
  if (page.subtitle?.trim()) {
    blocks.unshift({ type: 'paragraph', content: [{ type: 'text', text: page.subtitle.trim(), styles: { italic: true } }], children: [] });
  }
  const previous = journal.pages[page.id]?.written;
  let outcome: Awaited<ReturnType<typeof writePage>>;
  try {
    outcome = await writePage(deps.docs, pageId, blocks as PartialBlock<any, any, any>[], previous);
  } catch (err) {
    // Los archivos ya están guardados (y se van a subir); el diario los recuerda para ubicarlos al seguir.
    if (files) problems.push(`${title}: ${t('import.notPlaced', { count: files })}`);
    throw err;
  }
  // Una página con algo que esta versión no conoce no se tocó (ver `writePage`): queda sin terminar, así al
  // seguir la importación con la app al día se escribe.
  if (outcome.result === 'unsupported') {
    problems.push(`${title}: ${t('import.unsupported')}`);
    return { files, comments: 0, complete: false };
  }
  // Lo que la persona escribió en la página después del corte nunca se pisa.
  if (outcome.result === 'appended') problems.push(`${title}: ${t('import.appended')}`);
  // Los comentarios, con los bloques como quedaron (también en una página que la persona editó).
  const got = await importPageComments(deps, context, page, pageId, title, outcome.blocks, problems);
  if (outcome.result === 'kept') {
    problems.push(`${title}: ${t('import.keptEdited')}`);
    return { files, comments: got.count, complete: got.ok };
  }
  return { files, comments: got.count, complete: complete && got.ok, written: outcome.fingerprint };
}

/** El archivo bajado de una foto: por su blob (`bl-….<ext>`), o por la dirección que anotó el manifest. */
function findStored(folder: CodaFolder, page: CodaManifestPage, m: CodaMedia): string | null {
  const decode = (url: string) => url.replace(/&amp;/g, '&');
  const byBlob = (file: string) => !!m.blobId && file.startsWith(`${m.blobId}.`);
  const listed = page.media.find((x) => byBlob(x.file)) ?? page.media.find((x) => decode(x.url) === decode(m.src));
  if (listed && folder.has(`media/${listed.file}`)) return listed.file;
  const found = folder.paths().find((p) => p.startsWith('media/') && byBlob(p.slice('media/'.length)));
  return found ? found.slice('media/'.length) : null;
}

/**
 * La huella del contenido de una página: el texto (con su formato) y los elementos, en orden. Sirve para
 * saber, al seguir una importación cortada, si la página sigue como la dejó la importación.
 */
export function contentFingerprint(fragment: Y.XmlFragment): string {
  const parts: string[] = [];
  const walk = (node: Y.XmlFragment | Y.XmlElement) => {
    for (const child of node.toArray()) {
      if (child instanceof Y.XmlText) parts.push(`t:${child.toString()}`);
      else if (child instanceof Y.XmlElement) {
        parts.push(`<${child.nodeName} ${String(child.getAttribute('url') ?? '')}`);
        walk(child);
        parts.push('>');
      }
    }
  };
  walk(fragment);
  let h = 0x811c9dc5;
  const text = parts.join('\n');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${text.length}:${h.toString(36)}`;
}

// Lo que tiene una página recién creada (la raíz inicial, `buildSeed`): un párrafo vacío.
const SEED_NODES = new Set(['blockGroup', 'blockContainer', 'paragraph']);

/** La página tiene algo más que la raíz inicial: texto, una foto, un título, una lista… */
function hasContent(node: Y.XmlFragment | Y.XmlElement): boolean {
  return node.toArray().some((child) => {
    if (child instanceof Y.XmlText) return child.length > 0;
    if (child instanceof Y.XmlElement) return !SEED_NODES.has(child.nodeName) || hasContent(child);
    return false;
  });
}

/**
 * Escribe los bloques en el documento de la página, como lo haría el editor de la app. Nunca pisa lo que
 * escribió la persona: si la página está vacía o sigue como la dejó la importación (`previous`, su huella),
 * la reemplaza; si tiene otra cosa y la importación no la había escrito, agrega lo importado debajo; si la
 * importación la había escrito y la persona la cambió después, no la toca.
 *
 * Si la página tiene algo que esta versión del editor no conoce (la editó una versión más nueva de la app),
 * tampoco la toca (`unsupported`): el editor que se monta acá lo borraría del documento compartido, como en
 * la página abierta (`unknownContent.ts`), y el borrado llegaría a todos.
 */
async function writePage(
  docs: ImportDeps['docs'],
  pageId: string,
  blocks: PartialBlock<any, any, any>[],
  previous?: string,
): Promise<{ result: 'replaced' | 'appended' | 'kept' | 'unsupported'; fingerprint?: string; blocks: PageBlock[] }> {
  const doc = await docs.open(pageId, { seed: true });
  const fragment = doc.getXmlFragment(CONTENT_FRAGMENT);
  if (findUnknownContent(doc)) {
    docs.close(pageId);
    return { result: 'unsupported', blocks: [] };
  }
  const edited = hasContent(fragment) && contentFingerprint(fragment) !== previous;
  if (edited && previous) {
    const blocks = pageBlocks(fragment);
    docs.close(pageId);
    return { result: 'kept', blocks };
  }
  const editor = BlockNoteEditor.create(
    withCollaboration({
      ...editorSchemaOptions,
      collaboration: { fragment, user: { name: 'Import', color: '#888888' } },
    }),
  ) as unknown as BlockNoteEditor<any, any, any>;
  // y-prosemirror escribe en el documento compartido desde la vista: el editor necesita estar montado.
  const host = document.createElement('div');
  host.style.display = 'none';
  document.body.appendChild(host);
  try {
    editor.mount(host);
    if (blocks.length && edited) editor.insertBlocks(blocks, editor.document[editor.document.length - 1], 'after');
    else if (blocks.length) editor.replaceBlocks(editor.document, blocks);
    await docs.flush(pageId);
    return { result: edited ? 'appended' : 'replaced', fingerprint: contentFingerprint(fragment), blocks: pageBlocks(fragment) };
  } finally {
    editor.unmount();
    host.remove();
    docs.close(pageId);
  }
}
