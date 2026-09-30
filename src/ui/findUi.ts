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
  /** El resultado del último reemplazo ("2 reemplazos · Deshacer"): sigue aunque la barra se vuelva a montar. */
  status: FindStatus | null;
}

export interface FindStatus {
  text: string;
  /** El paso de deshacer de "Reemplazar todo" (el *Deshacer* solo sirve mientras sea el último). */
  undoItem?: unknown;
}

let state: FindUiState = {
  open: false,
  expanded: false,
  query: '',
  replacement: '',
  matchCase: false,
  wholeWord: false,
  focus: 0,
  status: null,
};
/** El último pedido de foco ya atendido: la barra no vuelve a robar el foco al montarse otra vez. */
let focusHandled = 0;
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
  if (state.open) set({ open: false, status: null });
}

/** Si hay un pedido de foco sin atender (y lo marca como atendido). */
export function takeFocusRequest(): boolean {
  if (state.focus <= focusHandled) return false;
  focusHandled = state.focus;
  return true;
}

export function updateFindUi(patch: Partial<Omit<FindUiState, 'open' | 'focus'>>): void {
  set(patch);
}

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

interface KeyLike {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  key: string;
  code?: string;
}

/** ⌘ en la Mac, Ctrl en el resto (`mac` para probar las dos). */
export function modPressed(e: { ctrlKey: boolean; metaKey: boolean }, mac = IS_MAC): boolean {
  return mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}

/**
 * Si la tecla es esa letra. Se mira la letra que escribe la tecla (con Dvorak, Ctrl+F está en otro lugar); la
 * posición (`code`) solo si la tecla no da una letra latina (un teclado ruso, griego…).
 */
export function isLetter(e: { key: string; code?: string }, letter: string): boolean {
  if (/^[a-z]$/i.test(e.key)) return e.key.toLowerCase() === letter;
  return e.code === `Key${letter.toUpperCase()}`;
}

/** Ctrl/⌘+F, sin Alt ni Shift. */
export function isFindShortcut(e: KeyLike, mac = IS_MAC): boolean {
  return modPressed(e, mac) && !e.altKey && !e.shiftKey && isLetter(e, 'f');
}

/** F3 o Ctrl/⌘+G: siguiente (con Shift, anterior). */
export function isStepShortcut(e: KeyLike, mac = IS_MAC): boolean {
  if (e.key === 'F3' && !e.ctrlKey && !e.metaKey && !e.altKey) return true;
  return modPressed(e, mac) && !e.altKey && isLetter(e, 'g');
}

/** El atajo como se ve en los tooltips. */
export const FIND_SHORTCUT_LABEL = IS_MAC ? '⌘F' : 'Ctrl+F';

/** Un diálogo o el carrete abiertos (no todos los diálogos tienen `aria-modal`). */
const MODAL = '[aria-modal="true"], .modal, .modal-backdrop, .carrete, dialog[open]';

function modalOpen(doc: Document): boolean {
  return !!doc.querySelector(MODAL);
}

/** Un campo de texto fuera del editor (el título, el panel de comentarios, un diálogo). */
function otherField(el: Element | null): boolean {
  return !!el && !el.closest('.bn-editor') && (!!el.closest('input, textarea, select') || (el as HTMLElement).isContentEditable);
}

/**
 * Si Ctrl/⌘+F lo toma la app (abre la barra) o se deja pasar al navegador. Se deja pasar con el foco en la
 * barra (la segunda vez sale la búsqueda del navegador), en un campo de texto fuera del editor (el título, los
 * comentarios) y con un diálogo o el carrete abiertos.
 */
export function takesFindShortcut(target: EventTarget | null, doc: Document = document): boolean {
  const el = target instanceof Element ? target : null;
  if (el?.closest('.find-bar')) return false;
  if (modalOpen(doc)) return false;
  return !otherField(el);
}

/** Si F3 o Ctrl/⌘+G van a la coincidencia siguiente: desde la barra o el editor, sin un diálogo abierto. */
export function takesStepShortcut(target: EventTarget | null, doc: Document = document): boolean {
  const el = target instanceof Element ? target : null;
  if (modalOpen(doc)) return false;
  if (el?.closest('.find-bar')) return true;
  return !otherField(el);
}
