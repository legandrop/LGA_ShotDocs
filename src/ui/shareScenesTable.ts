import { sceneTitleOf } from '../relations/dayLive';
import { sceneLive, type LiveSource } from '../relations/liveView';
import { sceneLabel, type Registry } from '../relations/reader';
import type { SceneItem } from './projectScenes';
import { sceneTitleName } from './sceneTitle';

// La tabla de *Share scenes* (Docs/Doc_Compartir_Escenas.md, sección 2; v0.330): cada escena con su número, su nombre
// sin el número, su locación, su decorado y su INT/EXT, y cómo se ordena y se filtra. La locación, el decorado y el
// INT/EXT salen del índice de relaciones del proyecto abierto (`sceneLive`, lo mismo que el índice de una carpeta de
// escenas): con otro proyecto, o antes de que el índice termine su primera pasada, no hay y las columnas no se muestran.
// Esto solo arma lo que se ve: qué se comparte lo decide la ventana y lo vuelve a controlar la base.
// Desde la v0.331 (vendors, D852) el estado es el del vendor elegido, la columna *Vendors* muestra los chips de cada
// escena y las vistas son: todas, las del vendor, sin vendor, con dos o más vendors con correo, y las bloqueadas.

export interface SceneRow extends SceneItem {
  /** El número como se muestra (la forma de la post: `1013`). */
  label: string;
  /** El título sin el número de adelante (desde D849 el título de una escena empieza con él). */
  name: string;
  locations: string[];
  sets: string[];
  intExt: string[];
}

/** El nombre de la escena sin su número: `1013 | Plaza` → `Plaza` (la forma nueva) o `013 | Plaza | 101_013` (la vieja). */
export function sceneName(title: string, code: string, registry?: Pick<Registry, 'epByDigit'> | null): string {
  const label = sceneLabel(code, registry);
  return (sceneTitleName(title, label) ?? sceneTitleName(title, code) ?? sceneTitleOf(title)).trim();
}

const unique = (list: string[]) => [...new Set(list.map((x) => x.trim()).filter(Boolean))];

/** Las filas de la tabla. `src` es el índice del proyecto (o `null`: sin locación, decorado ni INT/EXT). */
export function sceneRows(items: SceneItem[], src: LiveSource | null): SceneRow[] {
  const registry = src?.snap.registry ?? null;
  return items.map((s) => {
    const row: SceneRow = { ...s, label: sceneLabel(s.code, registry), name: sceneName(s.title, s.code, registry), locations: [], sets: [], intExt: [] };
    // Solo si el índice tiene esta escena en esta misma página (un código repetido apunta a la primera).
    if (!src || registry?.scenes.get(s.code)?.pageId !== s.pageId) return row;
    const v = sceneLive(src, s.code);
    row.locations = unique(v.plannedAt.map((l) => l.title));
    row.sets = unique(v.sets.map((x) => x.title));
    row.intExt = unique(v.intExt);
    return row;
  });
}

export type SortKey = 'code' | 'name' | 'location' | 'set' | 'intExt' | 'vendors' | 'status';
export interface Sort {
  key: SortKey;
  /** 1 de menor a mayor, -1 al revés. */
  dir: 1 | -1;
}

/**
 * El estado de una fila para el vendor elegido (también es el orden de la columna *Status*): se le asigna, se le saca, la
 * ven (el vendor tiene correos), asignada sin correos (solo planificación), nada, o bloqueada.
 */
export type RowStatus = 'adding' | 'removing' | 'shared' | 'planned' | 'none' | 'blocked';
const STATUS_ORDER: RowStatus[] = ['adding', 'removing', 'shared', 'planned', 'none', 'blocked'];

export interface RowFacts {
  status(id: string): RowStatus;
  /** Los códigos de los vendors que la tienen asignada, en orden (vacío: ninguno). */
  vendors(id: string): string;
  /** Cuántos vendors con correo la ven (dos o más: se ven entre sí). */
  seenBy(id: string): number;
  /** Si el vendor elegido la tiene asignada (la vista *De <vendor>*). */
  mine(id: string): boolean;
}

const byCode = (a: SceneRow, b: SceneRow) => a.code.localeCompare(b.code, 'en', { numeric: true });
const text = (list: string[]) => list.join(', ');

/** El valor de una columna; `null` es vacío y va siempre al final, ordene como ordene. */
// (Se llama `column` y no como la tecla de un evento: la prueba de los atajos tomaría cada `case` por una tecla.)
function value(row: SceneRow, column: SortKey, facts: RowFacts): string | number | null {
  switch (column) {
    case 'code':
      return null;
    case 'name':
      return row.name || null;
    case 'location':
      return text(row.locations) || null;
    case 'set':
      return text(row.sets) || null;
    case 'intExt':
      return text(row.intExt) || null;
    case 'vendors':
      return facts.vendors(row.pageId) || null;
    case 'status':
      return STATUS_ORDER.indexOf(facts.status(row.pageId));
  }
}

/** Ordena las filas por una columna; los empates, por número de escena. */
export function sortRows(rows: SceneRow[], sort: Sort, facts: RowFacts): SceneRow[] {
  return [...rows].sort((a, b) => {
    if (sort.key === 'code') return byCode(a, b) * sort.dir;
    const va = value(a, sort.key, facts);
    const vb = value(b, sort.key, facts);
    if (va === null || vb === null) return va === vb ? byCode(a, b) : va === null ? 1 : -1;
    const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' });
    return c !== 0 ? c * sort.dir : byCode(a, b);
  });
}

export type View = 'all' | 'mine' | 'none' | 'multi' | 'blocked';

export interface Filter {
  text: string;
  view: View;
  /** Una locación o un decorado elegidos (vacío: todos). */
  location: string;
  set: string;
}

/** Las filas que pasan el buscador (número, nombre, locación, decorado, vendor), la vista y la locación y el decorado. */
export function filterRows(rows: SceneRow[], f: Filter, facts: RowFacts): SceneRow[] {
  const needle = f.text.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.location && !r.locations.includes(f.location)) return false;
    if (f.set && !r.sets.includes(f.set)) return false;
    if (f.view === 'mine' && !facts.mine(r.pageId)) return false;
    if (f.view === 'none' && facts.vendors(r.pageId) !== '') return false;
    if (f.view === 'multi' && facts.seenBy(r.pageId) < 2) return false;
    if (f.view === 'blocked' && !r.blocked) return false;
    if (!needle) return true;
    return [r.code, r.label, r.title, facts.vendors(r.pageId), ...r.locations, ...r.sets].some((x) => x.toLowerCase().includes(needle));
  });
}

/** Las locaciones o los decorados de todas las filas, para los desplegables. */
export function optionsOf(rows: SceneRow[], key: 'locations' | 'sets'): string[] {
  return unique(rows.flatMap((r) => r[key])).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}
