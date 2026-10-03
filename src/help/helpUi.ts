import { useSyncExternalStore } from 'react';
import { helpNewsFrom } from './news';

// Si la ayuda está abierta y en qué sección (Docs/Doc_Tutorial.md, sección 5). Va en la primera carga: el botón
// "?" del pie de la barra lateral y la entrada del menú de la cuenta la abren; el diálogo se baja aparte. Ninguna
// tecla la abre (decisión de Lega): ni "?" ni Ctrl/⌘+/.

export interface HelpUiState {
  open: boolean;
  /** La sección donde abre (por ejemplo, `keys` para los atajos); `null`, arriba de todo. */
  section: string | null;
  /**
   * Las novedades (entrega 3): lo último que la persona había visto al abrir, si había algo más nuevo. La ayuda las
   * lista con esto aunque al abrirse las dé por vistas (el punto del "?" se va).
   */
  news: string | null;
}

let state: HelpUiState = { open: false, section: null, news: null };
/** Lo que tenía el foco al abrir: al cerrar, el foco vuelve ahí (el botón "?" o el de la cuenta). */
let opener: HTMLElement | null = null;
const listeners = new Set<() => void>();

function set(next: HelpUiState): void {
  state = next;
  for (const fn of listeners) fn();
}

/** En el dispositivo: la ayuda ya se abrió alguna vez (el punto del "?" se va; Docs/Doc_Tutorial.md, sección 4). */
const SEEN_KEY = 'shotdocs-help-seen';

export function helpSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function openHelp(section: string | null = null, from: Element | null = null): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Sin almacenamiento, el punto vuelve a aparecer al recargar: nada más.
  }
  const active = from ?? (typeof document !== 'undefined' ? document.activeElement : null);
  opener = active instanceof HTMLElement && active !== document.body ? active : null;
  // Si ya estaba abierta (el menú de la cuenta con la ayuda abierta), las novedades que mostraba siguen.
  set({ open: true, section, news: state.open ? state.news : helpNewsFrom() });
}

export function closeHelp(): void {
  if (!state.open) return;
  set({ open: false, section: null, news: null });
  const back = opener;
  opener = null;
  if (back?.isConnected) back.focus({ preventScroll: true });
}

export function getHelpUi(): HelpUiState {
  return state;
}

export function useHelpUi(): HelpUiState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );
}
