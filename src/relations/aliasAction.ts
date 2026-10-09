import { fold, type Registry } from './reader';
import { nameParts, withoutParens, writableName } from './aliases';
import { titlePlace } from './projectMap';

// *Link to a location…* (Docs/Doc_Relaciones.md, sección 17; D539, fase B): desde un día cuyo título nombra un lugar que
// el proyecto no reconoce («Edif Ministe Hall»), escribir ese texto en «Otros nombres» de la locación que la persona elige.
// Esto es lo puro: qué parte del título se ofrece y en qué orden van las locaciones. La regla de parecido SOLO ORDENA
// (D532): nunca elige ni escribe sola.

/** Palabras que no cuentan para el parecido (artículos y «de»). */
const STOP = new Set(['la', 'el', 'los', 'las', 'de', 'del', 'y', 'the', 'of', 'and']);

const words = (s: string): string[] =>
  fold(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !STOP.has(w));

/**
 * La parte de lugar del título de un día, la que se ofrece para escribir («2026-02-18 | Día 58 | Edif Ministe Hall» →
 * «Edif Ministe Hall»): sin la fecha, el rótulo del día ni lo de entre paréntesis («(sin reporte)», «(en blanco)»).
 * Vacía si no queda nada que tenga letras o si no puede ser UN nombre de los que el lector lee (con comas, de más de 60
 * caracteres: D662), porque escribirlo no serviría; con comillas o un `?` del final se ofrece limpio.
 */
export function titleFragment(day: { title: string; label: string; date: string | null }): string {
  const place = withoutParens(titlePlace(day));
  return /\p{L}/u.test(place) ? writableName(place) : '';
}

/**
 * Por qué no se ofrece *Link to a location…* para el lugar del título (D711), si tiene letras y no puede ser UN nombre:
 * `several` (lo parten una coma, un punto y coma, una viñeta o « · »: serían varios nombres) o `unusable` (de más de 60
 * caracteres o con menos de dos letras: el lector lo ignora). `null` si se ofrece o si no hay lugar.
 */
export function titleFragmentWhy(day: { title: string; label: string; date: string | null }): 'several' | 'unusable' | null {
  const place = withoutParens(titlePlace(day));
  if (!/\p{L}/u.test(place) || writableName(place)) return null;
  return nameParts(place).length > 1 ? 'several' : 'unusable';
}

/**
 * Cuánto se parece un nombre de locación al texto del título: cuántas palabras del texto son el comienzo de una palabra
 * del nombre (sin artículos ni «de»), de 0 a 1. «Edif Ministe Hall» → Edificio Ministerial Hall: 1; «Pasaje Bar» → El
 * Pasaje Bar: 1.
 */
export function likeness(name: string, fragment: string): number {
  const want = words(fragment);
  if (!want.length) return 0;
  const have = words(name);
  return want.filter((w) => have.some((h) => h.startsWith(w))).length / want.length;
}

export interface LocationOption {
  name: string;
  pageId: string;
  /** Se parece al texto del título (va primero). */
  similar: boolean;
}

/**
 * Las locaciones para elegir: las que la persona puede editar (`can`), filtradas por lo escrito en el buscador (el
 * nombre o cualquiera de sus formas), primero las que se parecen al texto del título y después por nombre.
 */
export function locationOptions(R: Registry, fragment: string, q: string, can: (pageId: string) => boolean, limit = 8): LocationOption[] {
  const fq = fold(q).replace(/\s+/g, ' ').trim();
  const out: (LocationOption & { score: number })[] = [];
  for (const l of R.locations.values()) {
    if (!l.pageId || !can(l.pageId)) continue;
    if (fq && !l.forms.some((f) => fold(f).includes(fq))) continue;
    const score = likeness(l.name, fragment);
    out.push({ name: l.name, pageId: l.pageId, similar: score > 0, score });
  }
  out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return out.slice(0, limit).map(({ score: _s, ...o }) => o);
}
