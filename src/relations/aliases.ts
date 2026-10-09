import { fieldValues, emptyValue, type PageFields } from './fields';
import { fold, recognizedAlone, type AliasNote, type LocationInput } from './reader';

// Los nombres de una locación (Docs/Doc_Relaciones.md, «Otros nombres de una locación»; D526–D537). Puro: sin Yjs ni
// React. Junta, en un solo lugar, lo que sale del título (el nombre, sus partes, el nombre sin paréntesis: D416, D417) y
// lo que la gente escribió en la página de la locación, en el campo «Otros nombres» / «Also known as» (D526), y decide
// dónde vale cada uno y qué pasa si dos locaciones dicen lo mismo:
//
// - Lo escrito, en tres niveles (D529): dos palabras o más, en todos lados (texto); una palabra, solo donde se espera un
//   lugar (el título de un día, el valor de un campo de locación: D530), por palabra; una palabra genérica («Estudio»,
//   «Europa») o corta en minúsculas, solo ahí y como parte entera (D531).
// - Conflictos (D533): el nombre de una locación nunca se le da a otra; dos escritos iguales no cuentan para ninguna; un
//   escrito tapa a un derivado igual de otra locación (nadie escribió el derivado). Los conflictos de lo escrito quedan
//   como notas para la cabecera (D534).
//
// La app no inventa nombres: las abreviaturas de los títulos de día («Edif Ministe Hall») se resuelven solo si alguien
// las escribió (D532). Escribirlos en un documento: `aliasWrite.ts`.

/** Un nombre escrito tiene como mucho esto (más largo, es una oración: no cuenta). */
const NAME_MAX = 60;
/** Cuántos nombres escritos cuentan por locación. */
const NAMES_MAX = 40;

/** La forma para comparar: sin tildes ni mayúsculas, un solo espacio. */
export const nameKey = (s: string): string => fold(s).replace(/\s+/g, ' ').trim();

/** Comillas que se sacan de los bordes de un nombre escrito. */
const QUOTES = /^["'«»“”‘’„]+|["'«»“”‘’„]+$/g;

/** Un nombre escrito, limpio: sin viñeta, comillas ni `?` del final; vacío si no sirve (D527). */
function cleanName(raw: string): string {
  let t = raw.replace(/\s+/g, ' ').trim();
  t = t.replace(/^(?:[-*•–—]\s+)+/, '');
  for (let k = 0; k < 3; k++) t = t.replace(QUOTES, '').replace(/[\s?¿]+$/, '').replace(/^[\s¿]+/, '').trim();
  if (!t || emptyValue(t) || t.length > NAME_MAX) return '';
  if ((t.match(/\p{L}/gu) ?? []).length < 2) return '';
  return t;
}

/**
 * Un texto que se quiere escribir como un solo nombre en «Otros nombres» (D527), tal como el lector lo va a leer: limpio, o
 * vacío si no puede ser UN nombre (con coma, punto y coma, viñeta o « · » se partiría en varios; de más de 60 caracteres o
 * con menos de dos letras, el lector lo ignora). Así lo que se escribe nunca queda sin contar sin avisar (D662).
 */
export function writableName(raw: string): string {
  const pieces = raw.split(/[,;\n•]|\s·\s/).filter((p) => p.trim());
  return pieces.length === 1 ? cleanName(pieces[0]) : '';
}

/**
 * Los nombres escritos en los campos de una página (D527): rótulo «Otros nombres», «Also known as», «aka»… en un
 * renglón, una fila de tabla o un título con una lista abajo. Se separan por coma, punto y coma, renglón, viñeta y « · »
 * (`|` y `/` quedan adentro: «Estudio | Autos» es un nombre). Sin vacíos, «—», números solos, el nombre propio ni
 * repetidos; como mucho 40.
 */
export function aliasesFromFields(page: PageFields | null | undefined, name?: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>(name ? [nameKey(name)] : []);
  for (const f of fieldValues(page, 'aliases')) {
    for (const piece of f.text.split(/[,;\n•]|\s·\s/)) {
      const t = cleanName(piece);
      const k = nameKey(t);
      if (!t || seen.has(k)) continue;
      seen.add(k);
      out.push(t);
      if (out.length >= NAMES_MAX) return out;
    }
  }
  return out;
}

// --- Lo que sale del título (D416, D417) -----------------------------------------------------------------------------

/** El nombre sin lo que va entre paréntesis. */
export const withoutParens = (name: string): string => name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * El nombre sin el paréntesis, si puede ser alias (D416): de dos palabras o más («La Arenera» de `La Arenera (estudio)`,
 * «Bar Berlin» de `Bar Berlin (Claridge)`). Una sola palabra suele ser la ciudad o el sustantivo que el guion usa para la
 * historia («Lübben» de `Lübben (Europa)`: «un auto que viene de Berlín hacia Lübben» es el decorado, no donde se
 * filmó), y no cuenta en el texto. Además, se descarta si lo comparte otra locación.
 */
export function bareLocationName(name: string): string | null {
  const bare = withoutParens(name);
  return bare && bare !== name.trim() && bare.split(' ').length >= 2 ? bare : null;
}

/**
 * Suma a cada locación su nombre sin el paréntesis cuando ninguna otra locación lo comparte (como nombre o igual). De
 * dos palabras o más es alias en todos lados (D416); de una sola, solo donde se espera un lugar (D417):
 * «2026-03-11 | Día 73 | Inquilinato» es el lugar del día, «…hacia Lübben» en un párrafo no nombra a `Lübben (Europa)`.
 */
export function withBareNames(locations: LocationInput[]): LocationInput[] {
  const uses = new Map<string, number>();
  const count = (s: string) => uses.set(fold(s).trim(), (uses.get(fold(s).trim()) ?? 0) + 1);
  for (const l of locations) {
    count(l.name);
    const bare = withoutParens(l.name);
    if (bare && bare !== l.name) count(bare);
  }
  return locations.map((l) => {
    const bare = withoutParens(l.name);
    if (!bare || bare === l.name.trim() || uses.get(fold(bare).trim()) !== 1) return l;
    if (bareLocationName(l.name)) return { ...l, aliases: [...new Set([...(l.aliases ?? [l.name]), bare])] };
    return { ...l, dayTitleAliases: [bare] };
  });
}

// --- Todo junto (D529, D533) -----------------------------------------------------------------------------------------

/** Una locación con lo de su título y lo escrito en su página. */
export interface NameSource extends LocationInput {
  /** Lo escrito en «Otros nombres» de la página de la locación (`aliasesFromFields`). */
  written?: string[];
}

/** El nivel de un nombre escrito (D529): texto, lugar por palabra o lugar como parte entera. */
export function writtenLevel(name: string): 'text' | 'place' | 'whole' {
  if (name.trim().split(/\s+/).length >= 2) return 'text';
  return recognizedAlone(name) ? 'place' : 'whole';
}

/**
 * Los nombres de todas las locaciones, listos para `buildRegistry`: lo del título (como hasta ahora) más lo escrito,
 * cada uno en su nivel, y las notas de lo que no cuenta por un conflicto. Sin nada escrito, lo mismo que antes.
 */
export function resolveLocationNames(locs: NameSource[]): { inputs: LocationInput[]; notes: AliasNote[] } {
  const strip = ({ written: _w, ...l }: NameSource): LocationInput => l;
  const derived = withBareNames(locs.map(strip));
  const notes: AliasNote[] = [];
  if (!locs.some((l) => l.written?.length)) return { inputs: derived, notes };

  // Quién tiene cada forma: como nombre y como escrito.
  const names = new Map<string, string[]>();
  const written = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, k: string, name: string) => {
    const list = map.get(k) ?? [];
    if (!list.includes(name)) list.push(name);
    map.set(k, list);
  };
  for (const l of locs) add(names, nameKey(l.name), l.name.trim());
  const writtenOf = locs.map((l) => {
    const seen = new Set<string>([nameKey(l.name)]);
    const list: string[] = [];
    for (const w of l.written ?? []) {
      const k = nameKey(w);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      list.push(w.trim());
      add(written, k, l.name.trim());
    }
    return list;
  });

  const inputs = derived.map((l, i) => {
    const name = l.name.trim();
    if (!writtenOf[i].length && ![...(l.aliases ?? []), ...(l.dayTitleAliases ?? [])].some((a) => (written.get(nameKey(a)) ?? []).some((n) => n !== name))) return l;
    // Un escrito de otra locación tapa al derivado igual de esta (el nombre propio nunca se tapa).
    const coveredByOther = (a: string) => nameKey(a) !== nameKey(name) && (written.get(nameKey(a)) ?? []).some((n) => n !== name);
    const text = (l.aliases ?? [l.name]).filter((a) => !coveredByOther(a));
    const place = (l.dayTitleAliases ?? []).filter((a) => !coveredByOther(a));
    const whole: string[] = [];
    for (const w of writtenOf[i]) {
      const k = nameKey(w);
      const otherNames = (names.get(k) ?? []).filter((n) => n !== name);
      if (otherNames.length) {
        notes.push({ loc: name, alias: w, kind: 'name', others: otherNames });
        continue;
      }
      const otherWriters = (written.get(k) ?? []).filter((n) => n !== name);
      if (otherWriters.length) {
        notes.push({ loc: name, alias: w, kind: 'shared', others: otherWriters });
        continue;
      }
      const level = writtenLevel(w);
      if (level === 'text') {
        if (!text.some((a) => nameKey(a) === k)) text.push(w);
      } else if (level === 'place') {
        if (!place.some((a) => nameKey(a) === k)) place.push(w);
      } else whole.push(w);
    }
    const out: LocationInput = { name: l.name, aliases: text.length ? text : [l.name], pageId: l.pageId };
    if (place.length) out.dayTitleAliases = place;
    if (whole.length) out.wholeAliases = whole;
    return out;
  });
  return { inputs, notes };
}
