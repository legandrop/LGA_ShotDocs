import { useSyncExternalStore } from 'react';
import { t, type Key } from '../i18n';
import { revealCollapsed } from './collapseControl';
import { IS_MAC, modPressed } from './findUi';
import { notify } from './notice';

// Lo que comparten el botón de comentarios de la barra de arriba, el panel (o la hoja en el teléfono), el
// margen del editor y los botones "Comment" del editor: si el panel está abierto y qué mostrar. Vive en
// memoria (no se guarda en el dispositivo).

export type CommentsTarget =
  /** Un hilo en particular (se lo muestra y se lo marca). `resolved`: se sabe que está resuelto (se despliegan). */
  | { kind: 'thread'; threadId: string; resolved?: boolean }
  /** Los hilos de un bloque; si no hay ninguno abierto, se escribe uno nuevo. `answer`: es una pregunta. */
  | { kind: 'block'; blockId: string; answer?: boolean }
  /** Escribir un hilo nuevo en un bloque, o en la página entera (`blockId: null`). */
  | { kind: 'new'; blockId: string | null; answer?: boolean };

export interface CommentsUiState {
  open: boolean;
  target: CommentsTarget | null;
  /** Sube con cada pedido, para volver a llevar la vista al mismo hilo. */
  nonce: number;
  /**
   * La página para la que es el pedido (la campana de las menciones abre un hilo de otra página): al salir de la
   * página de antes, el pedido no se borra, y el panel de otra página no lo toma.
   */
  targetPage?: string | null;
}

let state: CommentsUiState = { open: false, target: null, nonce: 0, targetPage: null };
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
  if (drafts.size) draftRevision++;
  drafts.clear();
  set({ open: false, target: null, targetPage: null });
}

// Lo escrito a medias en el panel (una respuesta, un hilo nuevo, una edición). Vive en memoria.
export interface Draft {
  /** Lo tipeado hasta ahora. */
  text: string;
  /**
   * La pregunta antes de descartarlo, si no es la de siempre: desde ese cuadro no se puede guardar (el comentario
   * tiene otra edición esperando decisión, o ya no está) y la pregunta dice que hay que copiarlo antes.
   */
  question?: Key;
}

const drafts = new Map<symbol, Draft>();
let draftRevision = 0;

export function setDraft(key: symbol, dirty: boolean, draft: Draft = { text: '' }): void {
  if (dirty) { drafts.set(key, draft); draftRevision++; }
  else if (drafts.delete(key)) draftRevision++;
}

/**
 * El cuadro se desmontó. `byPerson`: lo cerró quien escribía (mandó, canceló, o confirmó descartarlo). Si no fue así y
 * tenía algo escrito que nadie descartó (se cambió de página, la página dejó de verse, se pidió otra cosa al panel),
 * lo tipeado no se va en silencio: un aviso lo dice y lo deja copiar mientras está a la vista.
 */
export function closeDraft(key: symbol, byPerson: boolean): void {
  const draft = drafts.get(key);
  if (!draft) return;
  drafts.delete(key);
  draftRevision++;
  if (!byPerson && draft.text.trim()) {
    notify(t('comments.draftClosed'), { label: t('sync.copyText'), run: () => void copyText(draft.text) });
  }
}

/** La confirmación de descarte vale sólo para la revisión que se vio. */
export function getDraftRevision(): number { return draftRevision; }

export function hasDrafts(): boolean {
  return drafts.size > 0;
}

/** La pregunta antes de descartar lo escrito a medias: la del cuadro que no puede guardar, si hay alguno. */
function discardQuestion(): string {
  for (const d of drafts.values()) if (d.question) return t(d.question);
  return t('comments.discardDraft');
}

/** Cierra el panel; si hay algo escrito sin mandar, pregunta antes. Devuelve si lo cerró. */
export function requestCloseComments(): boolean {
  if (drafts.size > 0 && !confirm(discardQuestion())) return false;
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

/** Abre el panel en lo que se pida; con `pageId`, en esa página (que se está abriendo). */
export function showComments(target: CommentsTarget | null = null, pageId: string | null = null): void {
  set({ open: true, target, nonce: state.nonce + 1, targetPage: pageId });
}

/** El botón "Comment" del editor (barra de formato, menú del bloque, margen o Ctrl/⌘+Alt+M). */
export function commentOnBlock(blockId: string | null): void {
  showComments(blockId ? { kind: 'block', blockId } : { kind: 'new', blockId: null });
}

/** El botón "Answer" de una pregunta. */
export function answerQuestion(blockId: string): void {
  showComments({ kind: 'block', blockId, answer: true });
}

/** Al salir de una página, lo pedido para ella no sigue (lo pedido para otra, sí). */
export function clearCommentsTarget(pageId: string | null = null): void {
  if (state.target && (!state.targetPage || !pageId || state.targetPage === pageId)) set({ target: null, targetPage: null });
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
