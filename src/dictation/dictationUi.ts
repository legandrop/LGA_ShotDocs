import { useSyncExternalStore } from 'react';
import { closeAssistant, currentTarget } from '../assistant/assistantUi';
import { IS_MAC, isLetter, modPressed } from '../ui/findUi';

// *Dictate to report* (Docs/Doc_Dictado.md, entrega V1): si la hoja está abierta y para qué página. Va en la primera
// carga y es chico: la hoja, el mapa y el validador se bajan aparte, la primera vez que se abre. Usa el editor de la
// página que se anota para el asistente (assistantUi.ts) y ocupa su mismo lugar: abrir uno cierra el otro.

let pageId: string | null = null;
const listeners = new Set<() => void>();

function set(next: string | null): void {
  pageId = next;
  for (const fn of listeners) fn();
}

export function useDictationPage(): string | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => pageId,
  );
}

/** Abre la hoja para la página del editor anotado (si no hay una página abierta, no hace nada). */
export function openDictation(): boolean {
  const target = currentTarget();
  if (!target) return false;
  closeAssistant();
  set(target.pageId);
  return true;
}

export function closeDictation(): void {
  if (pageId !== null) set(null);
}

export function dictationOpen(): boolean {
  return pageId !== null;
}

/**
 * Ctrl+Alt+Shift+D (⌘⌥⇧D en la Mac: nunca Ctrl en la Mac). Con AltGr (en Windows llega como Ctrl+Alt) no: en algunos
 * teclados escribe un carácter. Con Alt la tecla escribe otra cosa (en la Mac, ⌥⇧D es "Î"): se mira también la posición.
 */
export function isDictateShortcut(
  e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; key: string; code?: string; getModifierState?: (key: string) => boolean },
  mac = IS_MAC,
): boolean {
  if (e.getModifierState?.('AltGraph')) return false;
  return modPressed(e, mac) && e.altKey && e.shiftKey && isLetter(e, 'd');
}

// --- Abrir una nota de la cola (entrega V2) ---------------------------------------------------------------------------

/** Una nota de la cola que la persona pidió ubicar: la hoja la toma cuando se abre en su página. */
export interface QueuedRequest {
  pageId: string;
  noteId: string;
}

let request: QueuedRequest | null = null;
const requestListeners = new Set<() => void>();

function setRequest(next: QueuedRequest | null): void {
  request = next;
  for (const fn of requestListeners) fn();
}

/**
 * Pide abrir la hoja en la página de una nota de la cola, con esa nota cargada. La página tiene que estar abierta (o
 * abrirse enseguida): la hoja se abre cuando su editor se anota (DictationHost).
 */
export function requestQueuedNote(pageId: string, noteId: string): void {
  setRequest({ pageId, noteId });
}

/** La hoja de esa página toma el pedido (y lo borra). */
export function takeQueuedRequest(pageId: string): string | null {
  if (request?.pageId !== pageId) return null;
  const id = request.noteId;
  setRequest(null);
  return id;
}

export function useQueuedRequest(): QueuedRequest | null {
  return useSyncExternalStore(
    (fn) => {
      requestListeners.add(fn);
      return () => requestListeners.delete(fn);
    },
    () => request,
  );
}
