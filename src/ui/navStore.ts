import { useSyncExternalStore } from 'react';

// Si el cajón de la barra lateral del teléfono está abierto. Vive afuera del Shell para que la recorrida
// (Docs/Doc_Tutorial.md, sección 4) lo pueda abrir antes de señalar algo que está adentro.

let open = false;
const listeners = new Set<() => void>();
/** Cuánto estaba desplazada la página al abrir el cajón ("Mostrame" vuelve ahí aunque algo la mueva con el cajón abierto). */
let scrollAtOpen: number | null = null;

export function setNavOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  scrollAtOpen = next && typeof document !== 'undefined' ? (document.querySelector<HTMLElement>('.main')?.scrollTop ?? null) : null;
  for (const fn of listeners) fn();
}

export function isNavOpen(): boolean {
  return open;
}

/** Con el cajón abierto, cuánto estaba desplazada la página al abrirlo; si no, `null`. */
export function pageScrollAtNavOpen(): number | null {
  return open ? scrollAtOpen : null;
}

export function useNavOpen(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => open,
  );
}
