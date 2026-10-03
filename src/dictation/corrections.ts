import type { EditorState } from '@tiptap/pm/state';
import { locate } from './applyPlan';
import type { PageMap, Target } from './pageMap';
import type { RecentChange } from './prompt';

// Las correcciones encadenadas de *Dictate to report* (Docs/Doc_Dictado.md, 5.7 y R7; entrega V4): «no, era un 35»
// corrige el último cambio, y otra corrección después corrige otra vez el mismo lugar. El pedido lleva lo aplicado en
// esta hoja en los últimos 10 minutos con la dirección que cada lugar tiene en el mapa NUEVO (el ancla de Yjs del
// lugar lo sigue aunque se agreguen filas arriba), una sola vez por lugar (lo primero de antes y lo último de después) y
// el más nuevo marcado `(last)`. Un cambio de la respuesta en uno de esos lugares es una corrección: la fila la eligió
// la persona antes, no el modelo.

/** Lo aplicado hace un rato (en memoria de la pestaña). */
export interface AppliedEntry {
  where: string;
  before: string;
  after: string;
  at: number;
  /** El lugar en la foto de entonces (para encontrarlo en la página de ahora); falta en filas y secciones nuevas. */
  target?: Target;
}

/** La dirección que tiene hoy en `map` el lugar de una foto vieja, o `null` si ya no está. */
export function addressNow(state: EditorState, map: PageMap, target: Target): string | null {
  const r = locate(state, target);
  if (!r) return null;
  for (const t of map.targets.values()) if (t.start === r.start && t.kind === target.kind) return t.addr;
  return null;
}

/**
 * Lo reciente para el pedido: un renglón por lugar, en el orden en que se tocó por última vez (el último, el más
 * nuevo), y las direcciones de esos lugares en este mapa.
 */
export function recentForRequest(entries: AppliedEntry[], map: PageMap, state: EditorState): { recent: RecentChange[]; addrs: Set<string> } {
  const byPlace = new Map<string, RecentChange>();
  for (const e of entries) {
    const addr = e.target ? addressNow(state, map, e.target) : null;
    const key = addr ?? `~${e.where}`;
    const prev = byPlace.get(key);
    // Encadenada: lo de antes es lo de la primera vez, lo de después lo de la última; pasa al final (la más nueva).
    if (prev) byPlace.delete(key);
    byPlace.set(key, { where: e.where, before: prev ? prev.before : e.before, after: e.after, ...(addr ? { addr } : {}) });
  }
  const recent = [...byPlace.values()];
  return { recent, addrs: new Set(recent.map((r) => r.addr).filter((a): a is string => !!a)) };
}
