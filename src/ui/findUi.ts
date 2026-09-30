import { useSyncExternalStore } from 'react';

// El estado de la barra de buscar y reemplazar en la página (Docs/Doc_Buscar.md, sección 5). Vive afuera del
// editor: el editor se vuelve a montar (al terminar de bajar la página, al cambiar el permiso o el idioma) y
// la barra sigue abierta con lo mismo. La lupa de la barra de arriba (siempre cargada) solo la abre; la barra
// se dibuja con el editor.

export interface FindUiState {
  open: boolean;
  /** El renglón de reemplazar a la vista (solo se ofrece a quien puede editar). */
  expanded: boolean;
  query: string;
  replacement: string;
  matchCase: boolean;
  wholeWord: boolean;
  /** Sube cada vez que se pide llevar el foco al campo (abrir, o Ctrl/⌘+F con la barra ya abierta). */
  focus: number;
}

let state: FindUiState = {
  open: false,
  expanded: false,
  query: '',
  replacement: '',
  matchCase: false,
  wholeWord: false,
  focus: 0,
};
const listeners = new Set<() => void>();

function set(patch: Partial<FindUiState>): void {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}

export function getFindUi(): FindUiState {
  return state;
}

export function useFindUi(): FindUiState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );
}

/** Abre la barra (o, si ya está abierta, lleva el foco al campo). La barra toma lo elegido en el editor. */
export function openFindBar(): void {
  set({ open: true, focus: state.focus + 1 });
}

export function closeFindBar(): void {
  if (state.open) set({ open: false });
}

export function updateFindUi(patch: Partial<Omit<FindUiState, 'open' | 'focus'>>): void {
  set(patch);
}

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** ⌘ en la Mac, Ctrl en el resto. */
export function modPressed(e: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}

/** Ctrl/⌘+F, sin Alt ni Shift. */
export function isFindShortcut(e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; key: string; code?: string }): boolean {
  return modPressed(e) && !e.altKey && !e.shiftKey && (e.key.toLowerCase() === 'f' || e.code === 'KeyF');
}

/** El atajo como se ve en los tooltips. */
export const FIND_SHORTCUT_LABEL = IS_MAC ? '⌘F' : 'Ctrl+F';

/**
 * Si Ctrl/⌘+F lo toma la app (abre la barra) o se deja pasar al navegador. Se deja pasar con el foco en la
 * barra (la segunda vez sale la búsqueda del navegador), en un campo de texto fuera del editor (el título, los
 * comentarios) y con un diálogo o el carrete abiertos.
 */
export function takesFindShortcut(target: EventTarget | null, doc: Document = document): boolean {
  const el = target instanceof Element ? target : null;
  if (el?.closest('.find-bar')) return false;
  if (doc.querySelector('[aria-modal="true"], .carrete, dialog[open]')) return false;
  if (el && !el.closest('.bn-editor') && (el.closest('input, textarea, select') || (el as HTMLElement).isContentEditable)) return false;
  return true;
}
