import { useSyncExternalStore } from 'react';

// Si el cajón de la barra lateral del teléfono está abierto. Vive afuera del Shell para que la recorrida
// (Docs/Doc_Tutorial.md, sección 4) lo pueda abrir antes de señalar algo que está adentro.

let open = false;
const listeners = new Set<() => void>();

export function setNavOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  for (const fn of listeners) fn();
}

export function isNavOpen(): boolean {
  return open;
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
