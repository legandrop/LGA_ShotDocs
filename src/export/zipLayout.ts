import { cutText } from '../lib/graphemes';
import { NameSpace, safeName } from '../media/zipNames';
import type { ExportPlanPage } from './exportPages';

// Cómo se ordena el zip de exportar (P.22, Docs/Doc_Exportar.md, sección 2.3; entrega 2). Funciones sin estado: una
// carpeta por página, anidadas como el árbol, con el número de orden adelante y el título limpio sin espacios (EX11),
// topada en 60 letras (el Explorador de Windows no pasa de 260 caracteres por ruta); las rutas relativas entre páginas
// y archivos, para que todo se abra con doble clic y sin red.

/** Lo más largo de la carpeta de una página (en letras: grafemas enteros), con su número de orden. */
export const PAGE_FOLDER_MAX = 60;
/** La carpeta de los archivos de cada página y la de sus vistas JPEG. */
export const FILES_DIR = 'Files';
export const VIEW_DIR = '_view';
/** La carpeta de lo que necesita Shot Docs para volver a importar. */
export const SHOTDOCS_DIR = '_shotdocs';

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

/** El nombre limpio de la carpeta de arriba del zip (y del zip): el título de la raíz exportada. */
export function rootFolderName(title: string): string {
  const clean = underscored(safeName(title.trim(), 'Export')).replace(/^_+|_+$/g, '');
  return cutText(clean || 'Export', PAGE_FOLDER_MAX).replace(/[._ ]+$/, '') || 'Export';
}

/**
 * La carpeta de una página: `03_Rodaje`, con los ceros que hagan falta para ordenar bien entre `count` hermanas
 * (`001_` con más de 99), topada en `PAGE_FOLDER_MAX` letras sin partir un grafema.
 */
export function pageFolderName(order: number, count: number, title: string): string {
  const digits = Math.max(2, String(count).length);
  const number = String(order).padStart(digits, '0');
  const clean = underscored(safeName(title.trim(), 'Untitled')).replace(/^_+|_+$/g, '') || 'Untitled';
  const name = cutText(`${number}_${clean}`, PAGE_FOLDER_MAX);
  // Sin punto, espacio ni guion bajo al final (Windows saca los puntos y dos nombres chocarían).
  return name.replace(/[._ ]+$/, '') || number;
}

/** Dónde va cada página: su carpeta (ruta adentro del zip, sin la de arriba) y su nombre de archivo (sin extensión). */
export interface PageSlot {
  id: string;
  /** `02_Rodaje/01_Dia_1`. */
  dir: string;
  /** `01_Dia_1` (el `.html` y el `.md` llevan el mismo nombre que su carpeta). */
  name: string;
  /** El número de orden entre sus hermanas (1, 2…). */
  order: number;
}

/** Las carpetas de todas las páginas del plan (que viene en el orden del árbol, con `parent` adentro de lo exportado). */
export function pageSlots(plan: readonly ExportPlanPage[]): Map<string, PageSlot> {
  const children = new Map<string | null, ExportPlanPage[]>();
  for (const p of plan) {
    const list = children.get(p.parent) ?? [];
    list.push(p);
    children.set(p.parent, list);
  }
  const out = new Map<string, PageSlot>();
  for (const p of plan) {
    const siblings = children.get(p.parent)!;
    const order = siblings.indexOf(p) + 1;
    const name = pageFolderName(order, siblings.length, p.title);
    const up = p.parent ? out.get(p.parent) : undefined;
    out.set(p.id, { id: p.id, dir: up ? `${up.dir}/${name}` : name, name, order });
  }
  return out;
}

/**
 * Los nombres de los archivos de cada carpeta `Files/` (y su `_view/`): el nombre del Drive limpio y, si ya hay uno
 * igual en esa carpeta (sin distinguir mayúsculas), « (2)». La vista JPEG lleva el nombre del original con `.jpg`.
 */
export class FileNames {
  private readonly names = new NameSpace();

  /** El nombre del original en `Files/` de la carpeta `dir`. */
  original(dir: string, name: string): string {
    const files = `${dir}/${FILES_DIR}`;
    // `_view` es de las vistas: ningún archivo se llama así.
    this.names.reserve(files, VIEW_DIR);
    return this.names.take(files, name, 'file');
  }

  /** El nombre de una vista en `Files/_view/` de la carpeta `dir`: el del original con la extensión `ext`. */
  view(dir: string, name: string, ext = 'jpg'): string {
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    return this.names.take(`${dir}/${FILES_DIR}/${VIEW_DIR}`, `${stem || 'file'}.${ext}`, `file.${ext}`);
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
    .map((part) => (part === '..' ? part : encodeURIComponent(part)))
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
