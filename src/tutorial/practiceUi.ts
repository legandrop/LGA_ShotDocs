import { useSyncExternalStore } from 'react';
import { navigate, PRACTICE_PATH } from '../router';

// La entrada a la página de práctica (Docs/Doc_Tutorial.md, sección 3), en la primera carga: la ayuda
// (*Practicar*), la recorrida y el aviso de la página la piden. La práctica en sí se baja aparte.

/** Sube cada vez que se pide la práctica de cero: la página arma su documento de nuevo. */
let fresh = 0;
const listeners = new Set<() => void>();

/** Abre la página de práctica armada de cero (si ya estaba abierta, la vuelve a armar). */
export function openPractice(): void {
  fresh++;
  for (const fn of listeners) fn();
  navigate(PRACTICE_PATH);
}

export function usePracticeFresh(): number {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => fresh,
  );
}
