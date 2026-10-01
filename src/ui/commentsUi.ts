import { useSyncExternalStore } from 'react';
import { t } from '../i18n';
import { revealCollapsed } from './collapseControl';
import { IS_MAC, modPressed } from './findUi';

// Lo que comparten el botón de comentarios de la barra de arriba, el panel (o la hoja en el teléfono), el
// margen del editor y los botones "Comment" del editor: si el panel está abierto y qué mostrar. Vive en
// memoria (no se guarda en el dispositivo).

export type CommentsTarget =
  /** Un hilo en particular (se lo muestra y se lo marca). */
  | { kind: 'thread'; threadId: string }
  /** Los hilos de un bloque; si no hay ninguno abierto, se escribe uno nuevo. `answer`: es una pregunta. */
  | { kind: 'block'; blockId: string; answer?: boolean }
  /** Escribir un hilo nuevo en un bloque, o en la página entera (`blockId: null`). */
  | { kind: 'new'; blockId: string | null; answer?: boolean };

export interface CommentsUiState {
  open: boolean;
  target: CommentsTarget | null;
  /** Sube con cada pedido, para volver a llevar la vista al mismo hilo. */
  nonce: number;
}

let state: CommentsUiState = { open: false, target: null, nonce: 0 };
const listeners = new Set<() => void>();

function set(next: Partial<CommentsUiState>): void {
  state = { ...state, ...next };
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useCommentsUi(): CommentsUiState {
  return useSyncExternalStore(subscribe, () => state);
}

export function toggleComments(): void {
  if (state.open) requestCloseComments();
  else set({ open: true, target: null });
}

export function closeComments(): void {
  drafts.clear();
  set({ open: false, target: null });
}

// Lo escrito a medias en el panel (una respuesta, un hilo nuevo, una edición). Vive en memoria.
const drafts = new Set<symbol>();

export function setDraft(key: symbol, dirty: boolean): void {
  if (dirty) drafts.add(key);
  else drafts.delete(key);
}

export function hasDrafts(): boolean {
  return drafts.size > 0;
}

/** Cierra el panel; si hay algo escrito sin mandar, pregunta antes. Devuelve si lo cerró. */
export function requestCloseComments(): boolean {
  if (drafts.size > 0 && !confirm(t('comments.discardDraft'))) return false;
  closeComments();
  return true;
}

/** Copia un texto (el de un cambio rechazado, antes de descartarlo). Devuelve si pudo. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Sin permiso para el portapapeles: el camino viejo.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

/** Abre el panel en lo que se pida. */
export function showComments(target: CommentsTarget | null = null): void {
  set({ open: true, target, nonce: state.nonce + 1 });
}

/** El botón "Comment" del editor (barra de formato, menú del bloque, margen o Ctrl/⌘+Alt+M). */
export function commentOnBlock(blockId: string | null): void {
  showComments(blockId ? { kind: 'block', blockId } : { kind: 'new', blockId: null });
}

/** El botón "Answer" de una pregunta. */
export function answerQuestion(blockId: string): void {
  showComments({ kind: 'block', blockId, answer: true });
}

export function clearCommentsTarget(): void {
  if (state.target) set({ target: null });
}

// --- Los bloques de la página abierta ------------------------------------------------------------------
//
// El panel muestra a qué bloque apunta cada hilo y los ordena como en la página. Eso lo sabe el editor: lo
// registra acá y avisa cuando cambia el documento.

export interface BlockInfo {
  text: string;
  question: boolean;
}

export interface BlockSource {
  pageId: string;
  describe(blockId: string): BlockInfo | null;
  /** La posición de cada bloque en la página. */
  order(): Map<string, number>;
}

let source: BlockSource | null = null;
let sourceRevision = 0;
const sourceListeners = new Set<() => void>();

function notifySource(): void {
  sourceRevision++;
  for (const fn of sourceListeners) fn();
}

export function setBlockSource(next: BlockSource | null): void {
  source = next;
  notifySource();
}

/** Lo registra el editor que lo puso (al cerrarse), sin borrar el de otro editor que abrió después. */
export function clearBlockSource(owner: BlockSource): void {
  if (source === owner) setBlockSource(null);
}

export function blocksChanged(): void {
  notifySource();
}

export function useBlockSource(pageId: string): BlockSource | null {
  useSyncExternalStore(
    (fn) => {
      sourceListeners.add(fn);
      return () => sourceListeners.delete(fn);
    },
    () => sourceRevision,
  );
  return source?.pageId === pageId ? source : null;
}

// Ids de BlockNote: uuid, o `initialBlockId` en la semilla (lo mismo que acepta la base).
const BLOCK_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** El elemento de un bloque en la página abierta. */
export function blockElement(blockId: string, root: ParentNode = document): HTMLElement | null {
  if (!BLOCK_ID.test(blockId)) return null;
  return root.querySelector<HTMLElement>(`.editor [data-node-type="blockContainer"][data-id="${blockId}"]`);
}

/** Lleva la vista al bloque y lo resalta un momento. Devuelve si lo encontró. */
export function revealBlock(blockId: string): boolean {
  // Si está en una sección colapsada, primero se abre para vos (P.11, Docs/Doc_Colapsar.md).
  revealCollapsed(blockId);
  const el = blockElement(blockId);
  if (!el) return false;
  el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  el.classList.remove('comment-flash');
  void el.offsetWidth;
  el.classList.add('comment-flash');
  setTimeout(() => el.classList.remove('comment-flash'), 1800);
  return true;
}

/** En el teléfono el panel es una hoja desde abajo (misma medida que el CSS). */
export function isPhoneLayout(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(max-width: 760px)').matches;
}

/**
 * Ctrl+Alt+M (⌘⌥M en la Mac: nunca Ctrl en la Mac). Con AltGr (en Windows llega como Ctrl+Alt) no: en algunos
 * teclados escribe un carácter. `mac` para probar las dos.
 */
export function isCommentShortcut(
  e: {
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    code: string;
    key: string;
    getModifierState?: (key: string) => boolean;
  },
  mac = IS_MAC,
): boolean {
  if (e.getModifierState?.('AltGraph')) return false;
  // Con Alt la tecla escribe otra cosa (en la Mac, ⌥M es "µ"): se mira también la posición.
  return modPressed(e, mac) && e.altKey && !e.shiftKey && (e.code === 'KeyM' || e.key.toLowerCase() === 'm');
}

/** Mandar un comentario: Ctrl+Enter (⌘Enter en la Mac). */
export function isSendShortcut(e: { key: string; ctrlKey: boolean; metaKey: boolean }, mac = IS_MAC): boolean {
  return e.key === 'Enter' && modPressed(e, mac);
}
