import { useSyncExternalStore } from 'react';
import type { EditorView } from '@tiptap/pm/view';
import { IS_MAC, isLetter, modPressed } from '../ui/findUi';

// El asistente (Docs/Doc_Asistente.md, entrega A1): si el panel o los ajustes están abiertos, y el editor de la página
// abierta, que se anota acá al montarse. Va en la primera carga y es chico: el panel, los ajustes y los proveedores se
// bajan aparte, la primera vez que se abren.

interface AssistantUiState {
  /** El panel, abierto para esa página (`null`: cerrado). */
  pageId: string | null;
  /** La ventana de ajustes (proveedor, clave, modelo). */
  settings: boolean;
  /** Salir de la cuenta con una clave del asistente guardada: la ventana con la casilla de olvidarla. */
  signOut: { email: string; run: () => Promise<unknown> } | null;
}

let state: AssistantUiState = { pageId: null, settings: false, signOut: null };
const listeners = new Set<() => void>();

function set(next: Partial<AssistantUiState>): void {
  state = { ...state, ...next };
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useAssistantUi(): AssistantUiState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Abre el panel para la página del editor anotado (si no hay una página abierta, no hace nada). */
export function openAssistant(): boolean {
  const target = currentTarget();
  if (!target) return false;
  set({ pageId: target.pageId });
  return true;
}

export function closeAssistant(): void {
  if (state.pageId !== null) set({ pageId: null });
}

export function assistantOpen(): boolean {
  return state.pageId !== null;
}

export function openAssistantSettings(): void {
  set({ settings: true });
}

export function closeAssistantSettings(): void {
  if (state.settings) set({ settings: false });
}

/**
 * Salir con una clave guardada (Docs/Doc_Asistente.md, sección 4): la ventana de salir suma la casilla *Also forget my
 * assistant key on this device*, destildada. `run` sale de la cuenta.
 */
export function askSignOut(email: string, run: () => Promise<unknown>): void {
  set({ signOut: { email, run } });
}

export function closeSignOut(): void {
  if (state.signOut) set({ signOut: null });
}

/**
 * Ctrl+Alt+J (⌘⌥J en la Mac: nunca Ctrl en la Mac). Con AltGr (en Windows llega como Ctrl+Alt) no: en algunos teclados
 * escribe un carácter. Con Alt la tecla escribe otra cosa (en la Mac, ⌥J es "∆"): se mira también la posición.
 */
export function isAssistantShortcut(
  e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; key: string; code?: string; getModifierState?: (key: string) => boolean },
  mac = IS_MAC,
): boolean {
  if (e.getModifierState?.('AltGraph')) return false;
  return modPressed(e, mac) && e.altKey && !e.shiftKey && isLetter(e, 'j');
}

// --- El editor de la página ----------------------------------------------------------------------------------------

/** Lo que el panel usa del editor de la página: su vista de ProseMirror y si se puede editar ahora. */
export interface AssistantTarget {
  pageId: string;
  view: () => EditorView | null;
  editable: () => boolean;
}

let target: AssistantTarget | null = null;
const targetListeners = new Set<() => void>();

/** El editor de la página abierta se anota acá; devuelve cómo darse de baja. */
export function registerAssistantTarget(next: AssistantTarget): () => void {
  target = next;
  for (const fn of targetListeners) fn();
  return () => {
    if (target !== next) return;
    target = null;
    for (const fn of targetListeners) fn();
  };
}

export function currentTarget(): AssistantTarget | null {
  return target;
}

/** El editor anotado para esa página (o `null` si se cerró o se volvió a crear y todavía no se anotó). */
export function useAssistantTarget(pageId: string): AssistantTarget | null {
  return useSyncExternalStore(
    (fn) => {
      targetListeners.add(fn);
      return () => targetListeners.delete(fn);
    },
    () => (target?.pageId === pageId ? target : null),
  );
}
