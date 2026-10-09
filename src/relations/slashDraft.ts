import { useSyncExternalStore } from 'react';

// Lo que se está tipeando en el menú `/` de escenas (Docs/Doc_Relaciones.md, sección 15; O7 de la auditoría de E7,
// D568). Mientras el menú está abierto, la consulta («/e 105_141») está escrita en el documento y el índice la lee como
// un número que no existe: *Map › Pending* y el contador de la barra lateral lo sumaban hasta elegir. Acá se anota, solo
// en este dispositivo y solo mientras el menú está abierto, qué números de qué bloque son esa consulta, para que el mapa
// no los cuente. Al cerrar el menú (elegir, Esc, tocar afuera) se borra: si quedó escrito, vuelve a contar.

export interface SlashDraft {
  pageId: string;
  blockId: string;
  /** Los números que la consulta nombra y no existen (como los lee el índice). */
  codes: string[];
}

let current: SlashDraft | null = null;
const listeners = new Set<() => void>();

const same = (a: SlashDraft | null, b: SlashDraft | null) =>
  a === b || (!!a && !!b && a.pageId === b.pageId && a.blockId === b.blockId && a.codes.join() === b.codes.join());

/** Anota (o borra, con `null`) la consulta abierta. Solo avisa si cambió. */
export function setSlashDraft(next: SlashDraft | null): void {
  const value = next && next.codes.length ? next : null;
  if (same(current, value)) return;
  current = value;
  for (const l of listeners) l();
}

export function slashDraft(): SlashDraft | null {
  return current;
}

export function subscribeSlashDraft(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Para volver a dibujar el mapa y el contador cuando se abre o se cierra la consulta. */
export function useSlashDraft(): SlashDraft | null {
  return useSyncExternalStore(subscribeSlashDraft, slashDraft, slashDraft);
}

/**
 * Los números que no existen sin las menciones que son la consulta abierta: en el bloque de la consulta, esos números
 * no cuentan; si un número queda sin ningún lugar, sale de la lista.
 */
export function withoutDraft<T extends { ref: string; pages: { pageId: string; blockIds: string[] }[] }>(list: T[], draft: SlashDraft | null = current): T[] {
  if (!draft) return list;
  const out: T[] = [];
  for (const p of list) {
    if (!draft.codes.includes(p.ref)) {
      out.push(p);
      continue;
    }
    const pages = p.pages
      .map((x) => (x.pageId === draft.pageId ? { ...x, blockIds: x.blockIds.filter((b) => b !== draft.blockId) } : x))
      .filter((x) => x.blockIds.length);
    if (pages.length) out.push({ ...p, pages });
  }
  return out;
}
