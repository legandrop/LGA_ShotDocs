// Cómo compara la búsqueda (Docs/Doc_Buscar.md, sección 4 y corrección 10). La usan la barra de la página
// y, más adelante, la búsqueda del proyecto: las dos cuentan igual.
//
// - Sin *Aa*: sin mayúsculas ni tildes ("camara" encuentra "Cámara"; la ñ vale como n). Cada punto de código
//   se pasa a NFD, se le sacan las marcas combinadas (`\p{M}`) y se pasa a minúsculas (`toLowerCase`, no la
//   del idioma). NFD no separa ligaduras, ø ni ł: esas quedan como están. "ß" no es "ss".
// - Con *Aa*: mayúsculas y tildes exactas. Igual se pasa a NFD, así una "Í" pegada desde macOS (I + tilde
//   combinada) y una "Í" de un solo carácter son lo mismo.
// - Los espacios seguidos (también el de no separar) cuentan como uno.
//
// Todo con un mapa de cada carácter normalizado a su lugar en el texto original, para resaltar justo lo que
// se encontró.

export interface SearchOptions {
  /** *Aa*: mayúsculas y tildes exactas. */
  matchCase?: boolean;
  /** Solo palabras enteras (lo de antes y lo de después no es una letra ni un número). */
  wholeWord?: boolean;
}

export interface Normalized {
  text: string;
  /** Para cada carácter de `text`, dónde empieza en el original lo que lo produjo; al final, el largo del original. */
  map: number[];
}

const MARK = /\p{M}/u;
const MARKS = /\p{M}/gu;
const SPACE = /\s/u;
const WORD = /[\p{L}\p{N}]/u;

/** Normaliza un texto para buscar en él, con el mapa al original. */
export function normalize(text: string, { matchCase = false }: SearchOptions = {}): Normalized {
  let out = '';
  const map: number[] = [];
  let index = 0;
  for (const cp of text) {
    let piece: string;
    if (SPACE.test(cp)) {
      piece = out.endsWith(' ') ? '' : ' ';
    } else {
      piece = cp.normalize('NFD');
      if (!matchCase) piece = piece.replace(MARKS, '').toLowerCase().normalize('NFD').replace(MARKS, '');
    }
    for (let k = 0; k < piece.length; k++) map.push(index);
    out += piece;
    index += cp.length;
  }
  map.push(text.length);
  return { text: out, map };
}

/** Lo buscado, normalizado igual que el texto y sin espacios en las puntas. */
export function normalizeQuery(query: string, options: SearchOptions = {}): string {
  return normalize(query.trim(), options).text;
}

/** Las coincidencias en un texto ya normalizado: `[inicio, fin)` en el texto normalizado. */
export function findIn(norm: string, query: string, { matchCase = false, wholeWord = false }: SearchOptions = {}): [number, number][] {
  const out: [number, number][] = [];
  if (!query) return out;
  let from = 0;
  for (;;) {
    const at = norm.indexOf(query, from);
    if (at < 0) return out;
    const end = at + query.length;
    // Con *Aa* las tildes quedan como marcas combinadas: "I" no encuentra la "I" de una "Í" descompuesta.
    const cutsLetter = matchCase && end < norm.length && MARK.test(norm[end]);
    const whole = !wholeWord || (!isWordChar(norm, at - 1) && !isWordChar(norm, end));
    if (!cutsLetter && whole) {
      out.push([at, end]);
      from = end;
    } else {
      from = at + 1;
    }
  }
}

function isWordChar(norm: string, i: number): boolean {
  if (i < 0 || i >= norm.length) return false;
  // Una marca combinada es parte de la letra de antes.
  if (MARK.test(norm[i])) return true;
  // La segunda mitad de un par sustituto: se mira el punto de código entero.
  const start = /[\uDC00-\uDFFF]/.test(norm[i]) && i > 0 ? i - 1 : i;
  return WORD.test(String.fromCodePoint(norm.codePointAt(start) ?? 0));
}

/**
 * Las coincidencias de `query` en `text`, en posiciones del texto original (`[inicio, fin)`). El final se
 * extiende sobre las marcas combinadas que siguen (una tilde descompuesta queda adentro del resaltado).
 */
export function searchText(text: string, query: string, options: SearchOptions = {}): [number, number][] {
  const q = normalizeQuery(query, options);
  if (!q) return [];
  const norm = normalize(text, options);
  return findIn(norm.text, q, options).map(([s, e]) => [norm.map[s], extendOverMarks(text, norm.map[e])]);
}

function extendOverMarks(text: string, end: number): number {
  while (end < text.length && MARK.test(text[end])) end++;
  return end;
}
