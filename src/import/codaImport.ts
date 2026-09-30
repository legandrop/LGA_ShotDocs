import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import type { MediaQueue } from '../media/queue';
import type { PageDocs } from '../sync/docs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import type { PageTree } from '../sync/tree';
import { editorSchemaOptions } from '../ui/editorSchema';
import { finishBlocks, prepareCodaHtml, type CodaMedia, type LooseBlock } from './codaHtml';

// Importa a un proyecto nuevo la carpeta que arma `scripts/coda-export.mjs` (Docs/Doc_Importar_Coda.md):
// `manifest.json` con el árbol de páginas, `pages/<n>_<id>.html` con el HTML de Coda y `media/bl-….<ext>`.
// Todo va por los mismos caminos que usa la app al escribir: `tree.create` para cada página, `media.add`
// para cada archivo (queda en el dispositivo y la sincronización lo sube al Drive por el portero) y el
// documento de la página con un editor sin pantalla. Por eso funciona sin red y no se pierde nada si se
// corta: lo que ya se guardó en el dispositivo se sube solo.

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
}

/** La carpeta exportada. Las rutas son relativas a ella (`pages/…`, `media/…`). */
export interface CodaFolder {
  manifest: CodaManifest;
  has(path: string): boolean;
  /** Todas las rutas de la carpeta. */
  paths(): string[];
  text(path: string): Promise<string>;
  file(path: string): Promise<Blob>;
}

export interface ImportDeps {
  tree: Pick<PageTree, 'create' | 'createProject'>;
  docs: Pick<PageDocs, 'open' | 'close' | 'flush'>;
  media: Pick<MediaQueue, 'add' | 'enabled'>;
}

export interface ImportProgress {
  done: number;
  total: number;
  page: string;
}

export interface ImportResult {
  projectId: string;
  pages: number;
  files: number;
  /** Lo que no se pudo traer, por página. */
  problems: string[];
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
  if (!manifestFile) throw new Error('This folder has no manifest.json. Choose the folder made by coda-export.');
  const manifest = JSON.parse(await manifestFile.text()) as CodaManifest;
  const get = (path: string) => {
    const f = byPath.get(path);
    if (!f) throw new Error(`Missing in the folder: ${path}`);
    return f;
  };
  return { manifest, has: (p) => byPath.has(p), paths: () => [...byPath.keys()], text: (p) => get(p).text(), file: async (p) => get(p) };
}

/** Las páginas en el orden del árbol: cada padre antes que sus hijas, las hermanas en su orden. */
export function treeOrder(pages: CodaManifestPage[]): CodaManifestPage[] {
  const ids = new Set(pages.map((p) => p.id));
  const children = new Map<string | null, CodaManifestPage[]>();
  for (const p of pages) {
    const parent = p.parentId && ids.has(p.parentId) ? p.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), p]);
  }
  for (const list of children.values()) list.sort((a, b) => a.order - b.order);
  const out: CodaManifestPage[] = [];
  const walk = (parent: string | null) => {
    for (const p of children.get(parent) ?? []) {
      out.push(p);
      walk(p.id);
    }
  };
  walk(null);
  return out;
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

export async function importCoda(
  folder: CodaFolder,
  deps: ImportDeps,
  options: { projectName?: string; onProgress?: (p: ImportProgress) => void } = {},
): Promise<ImportResult> {
  if (!deps.media.enabled) throw new Error('Connect Google Drive first: imported photos go to your Drive.');
  const { manifest } = folder;
  const pages = treeOrder(manifest.pages);
  const projectId = await deps.tree.createProject(options.projectName ?? manifest.doc.name);
  const parser = BlockNoteEditor.create(editorSchemaOptions) as unknown as BlockNoteEditor<any, any, any>;
  const idOf = new Map<string, string>();
  const problems: string[] = [];
  let files = 0;

  for (const [i, page] of pages.entries()) {
    options.onProgress?.({ done: i, total: pages.length, page: page.name });
    const title = page.name.replace(/\s+/g, ' ').trim();
    const pageId = await deps.tree.create(idOf.get(page.parentId ?? '') ?? null, title, projectId);
    idOf.set(page.id, pageId);
    // Una página que falla queda creada (vacía o a medias) y anotada; las demás siguen.
    try {
      files += await importPage(folder, deps, parser, page, pageId, title, problems);
    } catch (err) {
      problems.push(`${title}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  options.onProgress?.({ done: pages.length, total: pages.length, page: '' });
  return { projectId, pages: pages.length, files, problems };
}

async function importPage(
  folder: CodaFolder,
  deps: ImportDeps,
  parser: BlockNoteEditor<any, any, any>,
  page: CodaManifestPage,
  pageId: string,
  title: string,
  problems: string[],
): Promise<number> {
  if (!folder.has(`pages/${page.file}`)) {
    if (page.contentType === 'canvas') problems.push(`${title}: the page was not exported`);
    return 0;
  }

  const { html, media } = prepareCodaHtml(await folder.text(`pages/${page.file}`));
  // Cada archivo, a la cola de la app (en el dispositivo; se sube solo).
  let files = 0;
  const urls = new Map<number, string>();
  const names = new Map<number, string>();
  for (const m of media) {
    const stored = findStored(folder, page, m);
    if (!stored) {
      problems.push(`${title}: missing file ${m.blobId || m.src}`);
      continue;
    }
    try {
      const blob = await folder.file(`media/${stored}`);
      const type = m.mime || blob.type;
      const file = new File([blob], fileName(m, stored), { type });
      urls.set(m.index, await deps.media.add(pageId, file));
      names.set(m.index, file.name);
      files++;
    } catch (err) {
      problems.push(`${title}: ${fileName(m, stored)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const imageOf = (index: number): LooseBlock | null => {
    const url = urls.get(index);
    if (!url) return null;
    const m = media[index];
    const width = m.width > 0 && m.width < FULL_WIDTH ? m.width : undefined;
    return { type: 'image', props: { url, name: names.get(index) ?? '', ...(width ? { previewWidth: width } : {}) }, children: [] };
  };
  const placed = new Set<number>();
  const parsed = (await parser.tryParseHTMLToBlocks(html)) as unknown as LooseBlock[];
  const blocks = finishBlocks(parsed, (index) => {
    placed.add(index);
    return imageOf(index);
  });
  // Red de seguridad: una foto ya guardada que la conversión no ubicó va al final, anotada; nunca se pierde.
  for (const index of urls.keys()) {
    if (placed.has(index)) continue;
    blocks.push(imageOf(index)!);
    problems.push(`${title}: ${names.get(index)} went to the end of the page`);
  }
  if (page.subtitle?.trim()) {
    blocks.unshift({ type: 'paragraph', content: [{ type: 'text', text: page.subtitle.trim(), styles: { italic: true } }], children: [] });
  }
  await writePage(deps.docs, pageId, blocks as PartialBlock<any, any, any>[]);
  return files;
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

/** Escribe los bloques en el documento de la página, como lo haría el editor de la app. */
async function writePage(docs: ImportDeps['docs'], pageId: string, blocks: PartialBlock<any, any, any>[]): Promise<void> {
  const doc = await docs.open(pageId, { seed: true });
  const editor = BlockNoteEditor.create(
    withCollaboration({
      ...editorSchemaOptions,
      collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'Import', color: '#888888' } },
    }),
  ) as unknown as BlockNoteEditor<any, any, any>;
  // y-prosemirror escribe en el documento compartido desde la vista: el editor necesita estar montado.
  const host = document.createElement('div');
  host.style.display = 'none';
  document.body.appendChild(host);
  try {
    editor.mount(host);
    if (blocks.length) editor.replaceBlocks(editor.document, blocks);
    await docs.flush(pageId);
  } finally {
    editor.unmount();
    host.remove();
    docs.close(pageId);
  }
}
