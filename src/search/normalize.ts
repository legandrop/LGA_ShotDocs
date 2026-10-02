// Cómo compara la búsqueda (Docs/Doc_Buscar.md, sección 4 y corrección 10). La usan la barra de la página
// y, más adelante, la búsqueda del proyecto: las dos cuentan igual.
//
// - Sin *Aa*: sin mayúsculas ni tildes ("camara" encuentra "Cámara"; la ñ es otra letra, D12). Cada punto de código
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
const SPACE = /\s/u;
const WORD = /[\p{L}\p{N}]/u;

/** La tilde de la ñ (U+0303 después de una n): la ñ es otra letra, no una n con tilde (decisión D12, 2026-10-01). */
const ENYE_MARK = '̃';

/**
 * Saca las marcas combinadas y pasa a minúsculas, salvo la tilde de la ñ (`prev`: lo que va antes en el texto ya
 * normalizado, para una ñ descompuesta que llega como "n" y la tilde aparte, como pega macOS).
 */
function fold(piece: string, prev: string): string {
  let out = '';
  for (const ch of piece.normalize('NFD').toLowerCase().normalize('NFD')) {
    if (!MARK.test(ch)) out += ch;
    else if (ch === ENYE_MARK && (out || prev).endsWith('n')) out += ch;
  }
  return out;
}

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
      piece = matchCase ? cp.normalize('NFD') : fold(cp, out);
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

/**
 * Las coincidencias en un texto ya normalizado: `[inicio, fin)` en el texto normalizado. Con el mapa, una
 * coincidencia tiene que empezar y terminar en el borde de lo que produjo un carácter del original: NFD separa
 * una sílaba coreana en letras ("한" → ᄒ ᅡ ᆫ), y "하" no puede encontrar la mitad de "한".
 */
export function findIn(
  norm: string,
  query: string,
  { wholeWord = false }: SearchOptions = {},
  map?: number[],
): [number, number][] {
  const out: [number, number][] = [];
  if (!query) return out;
  let from = 0;
  for (;;) {
    const at = norm.indexOf(query, from);
    if (at < 0) return out;
    const end = at + query.length;
    // Con *Aa* las tildes quedan como marcas combinadas: "I" no encuentra la "I" de una "Í" descompuesta. Sin *Aa*
    // la única que queda es la de la ñ: "an" no encuentra el principio de "año".
    const cutsLetter = end < norm.length && MARK.test(norm[end]);
    const whole = !wholeWord || (!isWordChar(norm, at - 1) && !isWordChar(norm, end));
    const edges = !map || ((at === 0 || map[at] !== map[at - 1]) && (end === norm.length || map[end] !== map[end - 1]));
    if (!cutsLetter && whole && edges) {
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
 * extiende sobre lo que sigue pegado al último carácter: marcas combinadas (una tilde descompuesta), el
 * selector de variante, el tono de piel de un emoji y lo que se une con un ZWJ (👩‍💻), así no queda nada suelto.
 */
export function searchText(text: string, query: string, options: SearchOptions = {}): [number, number][] {
  return searchNormalized(text, normalize(text, options), normalizeQuery(query, options), options);
}

/** Como `searchText`, con el texto ya normalizado (con las mismas opciones) y lo buscado ya normalizado. */
export function searchNormalized(text: string, norm: Normalized, query: string, options: SearchOptions = {}): [number, number][] {
  if (!query) return [];
  const out: [number, number][] = [];
  for (const [s, e] of findIn(norm.text, query, options, norm.map)) {
    const from = norm.map[s];
    const to = extendEnd(text, norm.map[e]);
    if (to > from) out.push([from, to]);
  }
  return out;
}

const MODIFIER = /\p{M}|\p{Emoji_Modifier}|\uFE0F/u;
const ZWJ = '\u200D';

function extendEnd(text: string, end: number): number {
  while (end < text.length) {
    const cp = String.fromCodePoint(text.codePointAt(end) ?? 0);
    if (MODIFIER.test(cp)) {
      end += cp.length;
    } else if (cp === ZWJ && end + 1 < text.length) {
      // El ZWJ y lo que une.
      const next = String.fromCodePoint(text.codePointAt(end + 1) ?? 0);
      end += 1 + next.length;
    } else {
      break;
    }
  }
  return end;
}
