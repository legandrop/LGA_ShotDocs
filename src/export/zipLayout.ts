import { cutText, graphemesOf } from '../lib/graphemes';
import { NameSpace, safeName } from '../media/zipNames';
import type { ExportPlanPage } from './exportPages';

// Cómo se ordena el zip de exportar (P.22, Docs/Doc_Exportar.md, sección 2.3; entrega 2). Funciones sin estado: una
// carpeta por página, anidadas como el árbol, con el número de orden adelante y el título limpio sin espacios (EX11);
// las rutas relativas entre páginas y archivos, para que todo se abra con doble clic y sin red.
//
// Las rutas largas de Windows (auditoría O1): el Explorador no abre ni descomprime una ruta de más de 260 caracteres,
// contando la carpeta donde se descomprime (`C:\Users\<usuario>\Downloads\<nombre del zip>\`). Por eso: el zip no repite
// su nombre adentro (sin carpeta de arriba; la rama exportada deja su página raíz arriba de todo), y cada carpeta de
// página y cada nombre de archivo se acortan con un presupuesto (`pathLimit`): ninguna ruta pasa `SAFE_PATH` con una
// carpeta de destino típica. Las carpetas más hondas reciben su parte: una página reparte lo que queda entre ella y los
// niveles que tiene abajo.

/** Lo más largo de la carpeta de una página (en letras: grafemas enteros), con su número de orden. */
export const PAGE_FOLDER_MAX = 60;
/** Lo más largo del nombre del zip (y de la página raíz de una rama, que queda arriba de todo). */
export const ROOT_NAME_MAX = 40;
/** El tope de una ruta entera, con la carpeta de destino, en unidades UTF-16 (como cuenta Windows): 260 menos margen. */
export const SAFE_PATH = 180;
/** La carpeta de destino típica, sin el nombre del zip: `C:\Users\` + un usuario de 20 letras + `\Downloads\`. */
export const TYPICAL_BASE = `C:\\Users\\${'u'.repeat(20)}\\Downloads\\`;
/** La carpeta de los archivos de cada página y la de sus vistas JPEG. */
export const FILES_DIR = 'Files';
export const VIEW_DIR = '_view';
/** La carpeta de lo que necesita Shot Docs para volver a importar. */
export const SHOTDOCS_DIR = '_shotdocs';
/** Lo que se aparta en cada carpeta de página para sus archivos (`Files/_view/` y un nombre de 32). */
const FILE_RESERVE = `${FILES_DIR}/${VIEW_DIR}/`.length + 32;
/** Lo menos que lleva una carpeta de página (el número y unas letras del título). */
const SEGMENT_MIN = 8;
/** Lo menos y lo más que lleva el nombre de un archivo. */
const FILE_NAME_MIN = 12;
const FILE_NAME_MAX = 80;
/** Lo que puede sumar « (12)» a un nombre repetido. */
const DUP_SUFFIX = 5;

/**
 * Un nombre sin espacios (guiones bajos, como las carpetas de la app en el Drive) y sin tildes en las letras latinas
 * (`Día` → `Dia`, como el ejemplo del diseño: un zip viaja a herramientas que no leen bien UTF-8). Las marcas de otras
 * escrituras (el dakuten japonés) quedan: sacarlas cambiaría la palabra.
 */
export function underscored(name: string): string {
  return name
    .normalize('NFD')
    .replace(/([A-Za-z])\p{M}+/gu, '$1')
    .normalize('NFC')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_');
}

/** El principio de `text` sin partir un grafema, de `max` unidades UTF-16 como mucho (un emoji cuenta 2 o más). */
export function cutUnits(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = '';
  for (const g of graphemesOf(text)) {
    if (out.length + g.length > max) break;
    out += g;
  }
  return out;
}

/** El nombre limpio del zip (y de la página raíz de una rama): el título de la raíz exportada. */
export function rootFolderName(title: string): string {
  const clean = underscored(safeName(title.trim(), 'Export')).replace(/^_+|_+$/g, '');
  return cutUnits(clean || 'Export', ROOT_NAME_MAX).replace(/[._ ]+$/, '') || 'Export';
}

/** Lo que puede medir una ruta adentro del zip para que, descomprimido en `TYPICAL_BASE<zip>\`, no pase `SAFE_PATH`. */
export function pathLimit(root: string): number {
  return SAFE_PATH - TYPICAL_BASE.length - root.length - 1;
}

/**
 * La carpeta de una página: `03_Rodaje`, con los ceros que hagan falta para ordenar bien entre `count` hermanas
 * (`001_` con más de 99), topada en `max` unidades (y nunca más de `PAGE_FOLDER_MAX` letras) sin partir un grafema. Dos
 * hermanas nunca chocan: el número va adelante.
 */
export function pageFolderName(order: number, count: number, title: string, max = PAGE_FOLDER_MAX): string {
  const digits = Math.max(2, String(count).length);
  const number = String(order).padStart(digits, '0');
  const clean = underscored(safeName(title.trim(), 'Untitled')).replace(/^_+|_+$/g, '') || 'Untitled';
  const name = cutUnits(cutText(`${number}_${clean}`, PAGE_FOLDER_MAX), Math.max(max, number.length + 2));
  // Sin punto, espacio ni guion bajo al final (Windows saca los puntos y dos nombres chocarían).
  return name.replace(/[._ ]+$/, '') || number;
}

/** Dónde va cada página: su carpeta (ruta adentro del zip; `''` arriba de todo) y su nombre de archivo (sin extensión). */
export interface PageSlot {
  id: string;
  /** `02_Rodaje/01_Dia_1`, o `''` (la página raíz de una rama, arriba de todo). */
  dir: string;
  /** `01_Dia_1` (el `.html` y el `.md` llevan el mismo nombre que su carpeta). */
  name: string;
  /** El número de orden entre sus hermanas (1, 2…). */
  order: number;
}

/** Una ruta adentro del zip: `dir/rest`, o `rest` arriba de todo. */
export function joinPath(dir: string, rest: string): string {
  return dir ? `${dir}/${rest}` : rest;
}

/**
 * Las carpetas de todas las páginas del plan (que viene en el orden del árbol, con `parent` adentro de lo exportado).
 * Con `flatRoot` (una rama: una sola raíz), la raíz queda arriba de todo con el nombre del zip (`root`) y sus hijas
 * son las carpetas de arriba. Cada carpeta se acorta con el presupuesto de `limit` (`pathLimit`).
 */
export function pageSlots(plan: readonly ExportPlanPage[], opts: { flatRoot?: boolean; root?: string; limit?: number } = {}): Map<string, PageSlot> {
  const children = new Map<string | null, ExportPlanPage[]>();
  for (const p of plan) {
    const list = children.get(p.parent) ?? [];
    list.push(p);
    children.set(p.parent, list);
  }
  // Los niveles de carpetas que tiene abajo cada página.
  const height = new Map<string, number>();
  for (let i = plan.length - 1; i >= 0; i--) {
    const p = plan[i]!;
    const kids = children.get(p.id) ?? [];
    height.set(p.id, kids.length ? 1 + Math.max(...kids.map((k) => height.get(k.id) ?? 0)) : 0);
  }
  const limit = opts.limit ?? Infinity;
  const flat = !!opts.flatRoot && (children.get(null)?.length ?? 0) === 1;
  const out = new Map<string, PageSlot>();
  for (const p of plan) {
    const siblings = children.get(p.parent)!;
    const order = siblings.indexOf(p) + 1;
    if (flat && p.parent === null) {
      const root = opts.root ?? rootFolderName(p.title);
      // `index.html` es el índice del zip: la raíz no lo pisa.
      out.set(p.id, { id: p.id, dir: '', name: root.toLowerCase() === 'index' ? `${root}_page` : root, order });
      continue;
    }
    const up = p.parent ? out.get(p.parent) : undefined;
    const parentLen = up?.dir ? up.dir.length + 1 : 0;
    // Lo que queda, repartido entre esta carpeta y las de abajo (las que quedan cortas le dejan más a las siguientes).
    const avail = limit - parentLen - FILE_RESERVE;
    // Y el `.html` de la página repite el nombre de su carpeta: `carpeta/carpeta.html` entra entero.
    const own = Math.floor((limit - parentLen - '/.html'.length) / 2);
    const share = Math.min(own, Math.floor(avail / ((height.get(p.id) ?? 0) + 1)) - 1);
    const name = pageFolderName(order, siblings.length, p.title, Math.max(SEGMENT_MIN, Math.min(PAGE_FOLDER_MAX, share)));
    out.set(p.id, { id: p.id, dir: joinPath(up?.dir ?? '', name), name, order });
  }
  return out;
}

/** Un nombre de archivo de `max` unidades como mucho, conservando la extensión. */
export function cutFileName(name: string, max: number): string {
  if (name.length <= max) return name;
  const ext = /\.[^.\s]{1,16}$/.exec(name)?.[0] ?? '';
  const stem = cutUnits(name.slice(0, name.length - ext.length), Math.max(1, max - ext.length)).replace(/[. ]+$/, '');
  return `${stem || 'file'}${ext}`;
}

/**
 * Los nombres de los archivos de cada carpeta `Files/` (y su `_view/`): el nombre del Drive limpio y, si ya hay uno
 * igual en esa carpeta (sin distinguir mayúsculas), « (2)». La vista JPEG lleva el nombre del original con `.jpg`. Con
 * `limit` (`pathLimit`), cada nombre se acorta para que su ruta entera entre (entre 12 y 80 letras).
 */
export class FileNames {
  private readonly names = new NameSpace();

  constructor(private readonly limit = Infinity) {}

  private cap(folder: string): number {
    const room = this.limit - folder.length - 1 - DUP_SUFFIX;
    return Math.max(FILE_NAME_MIN, Math.min(FILE_NAME_MAX, room));
  }

  /** El nombre del original en `Files/` de la carpeta `dir`. */
  original(dir: string, name: string): string {
    const files = joinPath(dir, FILES_DIR);
    // `_view` es de las vistas: ningún archivo se llama así.
    this.names.reserve(files, VIEW_DIR);
    return this.names.take(files, cutFileName(safeName(name, 'file'), this.cap(files)), 'file');
  }

  /** El nombre de una vista en `Files/_view/` de la carpeta `dir`: el del original con la extensión `ext`. */
  view(dir: string, name: string, ext = 'jpg'): string {
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const folder = joinPath(dir, `${FILES_DIR}/${VIEW_DIR}`);
    return this.names.take(folder, cutFileName(safeName(`${stem || 'file'}.${ext}`, `file.${ext}`), this.cap(folder)), `file.${ext}`);
  }
}

/** La ruta relativa de `to` vista desde la carpeta `fromDir` (las dos adentro del zip, sin la carpeta de arriba). */
export function relativePath(fromDir: string, to: string): string {
  const from = fromDir ? fromDir.split('/') : [];
  const target = to.split('/');
  let common = 0;
  while (common < from.length && common < target.length - 1 && from[common] === target[common]) common++;
  return [...from.slice(common).map(() => '..'), ...target.slice(common)].join('/');
}

/** La ruta como dirección de un link (`href`, `src`): cada parte codificada (un `#` o un `%` en un nombre no la rompe). */
export function hrefOf(path: string): string {
  return path
    .split('/')
    // También los paréntesis: un `)` suelto corta el link en Markdown (« (2)» de un nombre repetido).
    .map((part) => (part === '..' ? part : encodeURIComponent(part).replace(/[()]/g, (c) => (c === '(' ? '%28' : '%29'))))
    .join('/');
}

/** La extensión de una imagen por su tipo (`jpg` si no se sabe). */
export function imageExt(type: string): string {
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  if (type === 'image/gif') return 'gif';
  if (type === 'image/avif') return 'avif';
  if (type === 'image/svg+xml') return 'svg';
  return 'jpg';
}
