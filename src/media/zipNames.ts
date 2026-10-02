// Los nombres de lo que se baja con "Download all" (Docs/Doc_Carpetas.md, sección 9): vienen de Drive, donde el
// dueño puede poner cualquier cosa (una barra, `..`, `CON`, un nombre que termina en punto), y terminan en el disco
// de una computadora con Windows, una Mac o un iPhone, adentro de un zip o en una carpeta. Cada parte de la ruta se
// limpia para que valga en los tres y nunca salga de la carpeta, y en cada carpeta dos nombres que solo difieren en
// mayúsculas (Drive los deja; Windows y la Mac no) se separan con « (2)».

import { graphemesOf } from '../lib/graphemes';
import { cleanFileName } from './attachments';

/** Lo más largo de cada parte de la ruta (grafemas enteros, contados en puntos de código). */
export const NAME_MAX = 200;
/**
 * Y en bytes: la Mac (APFS), Linux y Android topan un nombre en 255 bytes UTF-8 (100 letras chinas ya son 300), y
 * Windows en 255 unidades UTF-16. Un nombre más largo no se extrae ahí ("File name too long").
 */
export const NAME_MAX_BYTES = 255;

const encoder = new TextEncoder();

/** Si el nombre entra en los tres topes. */
export function nameFits(name: string): boolean {
  return Array.from(name).length <= NAME_MAX && name.length <= NAME_MAX_BYTES && encoder.encode(name).length <= NAME_MAX_BYTES;
}

/**
 * El principio de `stem` con grafemas enteros, lo más largo que entre con `suffix` atrás (la extensión, « (2)»), sin
 * punto ni espacio al final. Un grafema que solo ya no entra (cientos de marcas encimadas) se corta por punto de código.
 */
function fitStem(stem: string, suffix: string): string {
  let out = '';
  for (const g of graphemesOf(stem)) {
    if (nameFits(out + g + suffix)) {
      out += g;
      continue;
    }
    if (!out) for (const ch of g) if (nameFits(out + ch + suffix)) out += ch;
    break;
  }
  return out.replace(/[. ]+$/, '');
}

// Lo que Windows no acepta en un nombre (y la barra, que separa carpetas en todos lados).
const FORBIDDEN = /[<>:"/\\|?*]/g;
// Los nombres reservados de Windows, con o sin extensión (`CON.txt` tampoco se puede). Los superíndices (`COM¹`)
// también están reservados.
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)$/i;

/**
 * Una parte de la ruta (el nombre de un archivo o de una carpeta) que vale en Windows, la Mac y el iPhone: sin
 * controles ni marcas de dirección (`cleanFileName`), sin `<>:"/\|?*` (pasan a `_`), sin punto ni espacio al final
 * (Windows los saca solo y dos nombres distintos chocarían), `.` y `..` como `_`, los reservados de Windows con un
 * `_` adelante (`_CON.txt`) y cortada en `NAME_MAX` caracteres y 255 bytes sin partir un grafema, conservando la
 * extensión. Vacía, `fallback`.
 */
export function safeName(raw: string, fallback = '_'): string {
  let name = cleanFileName(raw ?? '', 10_000, '').normalize('NFC').replace(FORBIDDEN, '_');
  if (name === '.' || name === '..') name = '_';
  name = name.replace(/[. ]+$/, '');
  if (!name) return fallback;
  const base = name.split('.')[0]!.trimEnd();
  if (RESERVED.test(base)) name = `_${name}`;
  return cutName(name);
}

/**
 * Corta para que entre en `NAME_MAX` caracteres y 255 bytes (`nameFits`) sin partir un grafema y conservando la
 * extensión (`.mov`), sin dejar punto ni espacio al final.
 */
function cutName(name: string): string {
  if (nameFits(name)) return name;
  const ext = /\.[^.\s]{1,16}$/.exec(name)?.[0] ?? '';
  return (fitStem(name.slice(0, name.length - ext.length), ext) || '_') + ext;
}

/** `foto.jpg` → `foto (2).jpg`; `Notas` → `Notas (2)`; `.env` → `.env (2)`. */
export function numbered(name: string, n: number): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 17 ? name.slice(dot) : '';
  const stem = ext ? name.slice(0, dot) : name;
  const tail = ` (${n})`;
  // El número entra siempre: se corta el principio si hace falta.
  return fitStem(stem, tail + ext) + tail + ext;
}

/** Cómo compara nombres un disco que no distingue mayúsculas (Windows, la Mac): NFC y en minúsculas. */
function foldKey(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

/**
 * Los nombres ya usados de cada carpeta de la bajada. `take` devuelve el nombre limpio y, si ya hay uno igual (sin
 * distinguir mayúsculas) en esa carpeta, el primero libre de « (2)», « (3)»…
 */
export class NameSpace {
  private used = new Map<string, Set<string>>();

  /** `dir`: la ruta de la carpeta ya limpia (`a/b`, o `''` para la raíz). */
  take(dir: string, raw: string, fallback = '_'): string {
    const set = this.used.get(dir) ?? new Set<string>();
    this.used.set(dir, set);
    const clean = safeName(raw, fallback);
    let name = clean;
    for (let n = 2; set.has(foldKey(name)); n++) name = numbered(clean, n);
    set.add(foldKey(name));
    return name;
  }

  /** Aparta un nombre (la lista de lo que falta, en la raíz) para que nada de la carpeta lo use. */
  reserve(dir: string, name: string): void {
    const set = this.used.get(dir) ?? new Set<string>();
    this.used.set(dir, set);
    set.add(foldKey(name));
  }
}
