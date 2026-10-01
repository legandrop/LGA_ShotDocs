import { cleanFileName } from './attachments';

// Leer una carpeta soltada en la página (P.9, Docs/Doc_Carpetas.md, sección 6). El navegador entrega una
// entrada por cada cosa soltada (`webkitGetAsEntry`, que hay que pedir en el acto: después del evento la lista
// queda vacía, pero las entradas siguen valiendo) y cada carpeta se recorre entera, con sus subcarpetas. También
// sirve la lista de un `<input webkitdirectory>` (cada archivo trae su ruta; no llegan las carpetas vacías).

/** Un archivo de la carpeta y su ruta adentro de ella (`Fotos/Dia 2/a.jpg`). */
export interface FolderFile {
  path: string;
  file: File;
}

/** Lo que se saltea, con el motivo: oculto (empieza con punto), del sistema (`Thumbs.db`…) o que no se pudo leer. */
export interface Skipped {
  path: string;
  reason: 'hidden' | 'system' | 'unreadable';
  /** El archivo, si se pudo leer (los ocultos y del sistema se pueden incluir con la casilla). */
  file?: File;
  /** Es una carpeta (oculta o del sistema): con la casilla, se crea con lo de adentro. */
  dir?: boolean;
}

/** Una carpeta leída: su nombre, sus archivos, sus subcarpetas (rutas, también las vacías) y lo salteado. */
export interface FolderSource {
  name: string;
  files: FolderFile[];
  dirs: string[];
  skipped: Skipped[];
}

/** Lo mínimo de las entradas del navegador (`FileSystemEntry`) que se usa. */
export interface EntryLike {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  file?: (ok: (f: File) => void, fail?: (err: unknown) => void) => void;
  createReader?: () => { readEntries: (ok: (list: EntryLike[]) => void, fail?: (err: unknown) => void) => void };
}

const SYSTEM_NAMES = new Set(['thumbs.db', 'ehthumbs.db', 'desktop.ini', 'icon\r', '__macosx']);

/** Por qué se saltea un nombre (`null`: no se saltea): lo oculto, lo del sistema y los bloqueos de Office. */
export function skipReason(name: string): 'hidden' | 'system' | null {
  if (name.startsWith('.')) return 'hidden';
  if (SYSTEM_NAMES.has(name.toLowerCase()) || name.startsWith('~$')) return 'system';
  return null;
}

/**
 * Lo que trae un soltar: los archivos sueltos y las carpetas (sus entradas), leídos en el acto. `supported`:
 * el navegador sabe leer carpetas (`webkitGetAsEntry`); si no, las carpetas no se pueden subir.
 */
export function takeDrop(dt: DataTransfer): { files: File[]; folders: EntryLike[]; supported: boolean } {
  const files: File[] = [];
  const folders: EntryLike[] = [];
  let supported = true;
  const items = Array.from(dt.items ?? []);
  if (items.length === 0) return { files: Array.from(dt.files ?? []), folders, supported };
  for (const item of items) {
    if (item.kind !== 'file') continue;
    const getEntry = (item as DataTransferItem & { webkitGetAsEntry?: () => EntryLike | null }).webkitGetAsEntry;
    if (typeof getEntry !== 'function') supported = false;
    const entry = getEntry?.call(item) ?? null;
    if (entry?.isDirectory) {
      folders.push(entry);
      continue;
    }
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return { files, folders, supported };
}

/** Todo lo de una carpeta: `readEntries` entrega de a tandas (Chrome, de a 100) hasta que devuelve vacío. */
async function readAll(dir: EntryLike): Promise<EntryLike[]> {
  const reader = dir.createReader?.();
  if (!reader) return [];
  const out: EntryLike[] = [];
  for (;;) {
    const batch = await new Promise<EntryLike[]>((ok, fail) => reader.readEntries(ok, fail));
    if (batch.length === 0) return out;
    out.push(...batch);
  }
}

function fileOf(entry: EntryLike): Promise<File> {
  return new Promise((ok, fail) => {
    if (!entry.file) return fail(new Error('not a file'));
    entry.file(ok, fail);
  });
}

/**
 * Recorre una carpeta soltada entera. Lo que no se puede leer queda salteado (`unreadable`); lo oculto y lo del
 * sistema, salteado con su motivo (con la casilla "Incluir archivos ocultos" se suma: `withHidden`).
 */
export async function readFolder(root: EntryLike): Promise<FolderSource> {
  const source: FolderSource = { name: cleanFileName(root.name) || 'Folder', files: [], dirs: [], skipped: [] };
  const walk = async (dir: EntryLike, prefix: string, hiddenReason: 'hidden' | 'system' | null): Promise<void> => {
    let entries: EntryLike[];
    try {
      entries = await readAll(dir);
    } catch {
      if (prefix) source.skipped.push({ path: prefix, reason: 'unreadable', dir: true });
      return;
    }
    for (const entry of entries) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const reason = hiddenReason ?? skipReason(entry.name);
      if (entry.isDirectory) {
        if (reason) source.skipped.push({ path, reason, dir: true });
        else source.dirs.push(path);
        await walk(entry, path, reason);
      } else if (entry.isFile) {
        try {
          const file = await fileOf(entry);
          if (reason) source.skipped.push({ path, reason, file });
          else source.files.push({ path, file });
        } catch {
          source.skipped.push({ path, reason: 'unreadable' });
        }
      }
    }
  };
  await walk(root, '', null);
  return source;
}

/**
 * Las carpetas de un `<input webkitdirectory>`: cada archivo trae su ruta (`Carpeta/Fotos/a.jpg`). Las
 * carpetas vacías no llegan (el navegador no las da).
 */
export function foldersFromList(list: ArrayLike<File>): FolderSource[] {
  const byRoot = new Map<string, FolderSource>();
  for (const file of Array.from(list)) {
    const rel = ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name).split('/').filter(Boolean);
    const rootName = rel.length > 1 ? rel[0]! : '';
    let source = byRoot.get(rootName);
    if (!source) {
      source = { name: cleanFileName(rootName) || 'Folder', files: [], dirs: [], skipped: [] };
      byRoot.set(rootName, source);
    }
    const parts = rel.length > 1 ? rel.slice(1) : rel;
    const path = parts.join('/');
    // La primera parte oculta o del sistema decide (un archivo adentro de `.git` es oculto).
    const reason = parts.map(skipReason).find((r) => r !== null) ?? null;
    let dir = '';
    for (const part of parts.slice(0, -1)) {
      dir = dir ? `${dir}/${part}` : part;
      const dirReason = dir.split('/').map(skipReason).find((r) => r !== null) ?? null;
      if (dirReason) {
        if (!source.skipped.some((s) => s.dir && s.path === dir)) source.skipped.push({ path: dir, reason: dirReason, dir: true });
      } else if (!source.dirs.includes(dir)) source.dirs.push(dir);
    }
    if (reason) source.skipped.push({ path, reason, file });
    else source.files.push({ path, file });
  }
  return [...byRoot.values()];
}

/**
 * La carpeta con lo oculto y lo del sistema adentro (la casilla "Incluir archivos ocultos"). Lo que no se pudo
 * leer sigue salteado.
 */
export function withHidden(source: FolderSource): FolderSource {
  const files = [...source.files];
  const dirs = [...source.dirs];
  const skipped: Skipped[] = [];
  for (const s of source.skipped) {
    if (s.reason === 'unreadable') skipped.push(s);
    else if (s.dir) dirs.push(s.path);
    else if (s.file) files.push({ path: s.path, file: s.file });
  }
  return { ...source, files, dirs: sortDirs(dirs), skipped };
}

/** Las subcarpetas con las de arriba primero (cada una después de la que la contiene). */
export function sortDirs(dirs: string[]): string[] {
  const all = new Set<string>();
  for (const d of dirs) {
    // También las de arriba de cada una (por si faltan: la lista de `webkitdirectory` no las trae todas).
    const parts = d.split('/');
    for (let i = 1; i <= parts.length; i++) all.add(parts.slice(0, i).join('/'));
  }
  return [...all].sort((a, b) => a.split('/').length - b.split('/').length || (a < b ? -1 : a > b ? 1 : 0));
}

/** El resumen para la ventana: cuántos archivos, en cuántas carpetas, cuánto pesan y por tipo. */
export interface FolderSummary {
  files: number;
  dirs: number;
  bytes: number;
  /** Por familia: fotos, videos, PDF y el resto. */
  byKind: { image: number; video: number; pdf: number; other: number };
  /** Archivos de más de 1 GB. */
  big: number;
}

export function summarize(source: FolderSource): FolderSummary {
  const byKind = { image: 0, video: 0, pdf: 0, other: 0 };
  let bytes = 0;
  let big = 0;
  for (const { file, path } of source.files) {
    bytes += file.size;
    if (file.size > 1024 ** 3) big++;
    const type = (file.type || '').toLowerCase();
    const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? '';
    if (type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'heic', 'tif', 'tiff', 'exr', 'dng', 'psd'].includes(ext)) byKind.image++;
    else if (type.startsWith('video/') || ['mov', 'mp4', 'mxf', 'r3d', 'braw', 'mkv', 'avi'].includes(ext)) byKind.video++;
    else if (type === 'application/pdf' || ext === 'pdf') byKind.pdf++;
    else byKind.other++;
  }
  return { files: source.files.length, dirs: source.dirs.length, bytes, byKind, big };
}
