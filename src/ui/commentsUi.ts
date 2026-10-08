import { useSyncExternalStore } from 'react';
import { t, type Key } from '../i18n';
import { revealCollapsed } from './collapseControl';
import { flashBlock } from './flashControl';
import { IS_MAC, modPressed } from './findUi';
import { noticeVisible, notify } from './notice';

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

/** Si ese cuadro (por la clave con la que se anota) tiene algo escrito sin mandar. */
export function hasDraft(key: symbol): boolean {
  return drafts.has(key);
}

// Los cuadros con algo escrito que se cerraron solos en el mismo momento (al cambiar de página se desmontan todos
// juntos): van en un solo aviso. La pantalla muestra un aviso a la vez, y con uno por cuadro el texto del primero ya no
// se podía copiar. Cada uno con la cuenta que lo escribió y si la persona ya había aceptado perderlo (`acceptDraftLoss`).
let closed: { text: string; owner: string | null; accepted: boolean }[] = [];

// La cuenta de la app abierta (la anota `Workspace` al montarse; sin sesión, queda la última). Lo tipeado es de esa
// cuenta: nada de lo que quedó de una puede llegar a la app de otra que entra en la misma ventana.
let owner: string | null = null;

// Lo que quedó de los cuadros que se cerraron cuando la app se reemplazó sola (otra pestaña tomó el control, sacaron a
// la persona del workspace, se quedó sin proyectos, un error frenó la app, venció la sesión): la pantalla que dibuja
// los avisos se desmontó con ellos, así que el aviso no lo ve nadie. Lo tipeado queda acá, en memoria, y lo muestra un
// cartel que está por encima de todo eso (LeftDrafts.tsx) hasta que la persona lo copia o lo descarta.
export interface LeftDrafts {
  /** En el orden en que estaban en el panel. */
  texts: readonly string[];
  /** La persona ya copió exactamente estos textos. */
  copied: boolean;
}

let left: LeftDrafts = { texts: [], copied: false };
const leftListeners = new Set<() => void>();

// Mientras haya algo en el cartel sin copiar, cerrar o recargar la ventana pregunta. Vive acá y no en el cartel: si el
// cartel mismo fallara, la pregunta sigue. La anula solo un «sí» de la app cuya pregunta contó el cartel tal como está
// (`acceptDraftLoss(true)`): el de *Reload* o forzar la actualización cuenta solo los cuadros abiertos.
function onBeforeUnloadLeft(e: BeforeUnloadEvent): void {
  if (!left.texts.length || left.copied || acceptedLeft === left) return;
  e.preventDefault();
  e.returnValue = '';
}

function setLeft(next: LeftDrafts): void {
  const had = left.texts.length > 0;
  left = next;
  if (!had && next.texts.length) window.addEventListener('beforeunload', onBeforeUnloadLeft);
  if (had && !next.texts.length) window.removeEventListener('beforeunload', onBeforeUnloadLeft);
  for (const fn of leftListeners) fn();
}

function subscribeLeft(fn: () => void): () => void {
  leftListeners.add(fn);
  return () => leftListeners.delete(fn);
}

/** Lo tipeado en los cuadros que se cerraron sin que quedara una pantalla para avisarlo. */
export function useLeftDrafts(): LeftDrafts {
  return useSyncExternalStore(subscribeLeft, () => left);
}

/** Lo mismo, fuera de React (el respaldo de la barrera del cartel). */
export function leftDraftsNow(): LeftDrafts {
  return left;
}

/** Cuántos textos del cartel no se copiaron: cuentan en las preguntas de salir como un comentario a medio escribir. */
export function leftUncopied(): number {
  return left.copied ? 0 : left.texts.length;
}

/** Se copiaron esos textos (si mientras tanto llegó otro, no cuenta). */
export function markLeftCopied(texts: readonly string[]): void {
  if (left.texts === texts && !left.copied) setLeft({ texts, copied: true });
}

/** La persona lo copió y lo descartó, lo descartó, o salió de la cuenta diciendo que sí a perderlo. */
export function dropLeftDrafts(): void {
  if (left.texts.length) setLeft({ texts: [], copied: false });
}

/**
 * Entra a la app una cuenta (`Workspace`). Si es otra que la de antes, lo que quedó de la anterior se descarta: no se
 * esconde, no queda en memoria a mano de otra cuenta.
 */
export function setDraftOwner(id: string): void {
  if (id !== owner) dropLeftDrafts();
  owner = id;
}

function announceClosed(): void {
  // Lo de otra cuenta (la app de otra persona se montó en el mismo paso, `<Workspace key>` en App.tsx) se descarta: ni
  // aviso ni cartel.
  const mine = closed.filter((c) => c.owner === owner);
  closed = [];
  if (!mine.length) return;
  const texts = mine.map((c) => c.text);
  // Para este momento ya se desmontó todo lo que se iba a desmontar: si no quedó quien dibuje el aviso, lo tipeado se
  // suma al cartel. Lo que la persona aceptó perder (salió de la cuenta diciendo que sí) no se guarda.
  const keep = mine.filter((c) => !c.accepted).map((c) => c.text);
  if (!noticeVisible() && keep.length) {
    setLeft({ texts: [...left.texts, ...keep], copied: false });
    // Un «sí» anterior no vale para lo que acaba de llegar al cartel.
    draftRevision++;
  }
  const many = texts.length > 1;
  notify(many ? t('comments.draftsClosed', { count: texts.length }) : t('comments.draftClosed'), {
    label: many ? t('comments.copyAllTexts', { count: texts.length }) : t('sync.copyText'),
    // Todos, en el orden en que estaban en el panel, separados por una línea en blanco.
    run: () => void copyText(texts.join('\n\n')),
    // Es lo único que queda de lo tipeado: ningún otro aviso lo saca de la vista antes de su tiempo (notice.ts, D356).
    keep: true,
  });
}

/**
 * El cuadro se desmontó. `byPerson`: lo cerró quien escribía (mandó, canceló, o confirmó descartarlo). Si no fue así y
 * tenía algo escrito que nadie descartó (se cambió de página, la página dejó de verse), lo tipeado no se va en
 * silencio: un aviso lo dice y lo deja copiar mientras está a la vista. El aviso sale al terminar la tanda en curso,
 * uno solo por todos los cuadros que se cerraron juntos. Si para entonces no queda una pantalla que dibuje el aviso (la
 * app se reemplazó sola), lo tipeado queda además para el cartel de `LeftDrafts.tsx`.
 */
export function closeDraft(key: symbol, byPerson: boolean): void {
  const draft = drafts.get(key);
  if (!draft) return;
  const accepted = draftLossAccepted();
  drafts.delete(key);
  draftRevision++;
  // El «sí» sigue valiendo para los demás cuadros que se cierran con la misma salida.
  if (accepted) acceptedRevision = draftRevision;
  if (byPerson || !draft.text.trim()) return;
  closed.push({ text: draft.text, owner, accepted });
  if (closed.length === 1) queueMicrotask(announceClosed);
}

/** La confirmación de descarte vale sólo para la revisión que se vio. */
export function getDraftRevision(): number { return draftRevision; }

// La persona ya contestó que sí a una pregunta de la app que decía que lo escrito se iba a perder (recargar, forzar la
// actualización, cambiar o quitar el workspace, salir de la cuenta). Vale para lo escrito tal como estaba al contestar:
// cualquier cambio en un cuadro lo deja sin efecto, y quien preguntó lo retira si la salida no ocurre. Mientras vale, la
// pregunta del navegador al salir no repite la de la app (`beforeunload`, Workspace.tsx), y lo que se cierra con esa
// salida no queda para el cartel de `LeftDrafts.tsx`.
let acceptedRevision = -1;
// El cartel tal como estaba cuando la pregunta lo contó (`unsentCount`); si después cambia, el «sí» no lo cubre.
let acceptedLeft: LeftDrafts | null = null;

/** `withLeft`: la pregunta contó también lo que quedó en el cartel sin copiar. */
export function acceptDraftLoss(withLeft = false): void {
  acceptedRevision = draftRevision;
  acceptedLeft = withLeft ? left : null;
}

/** La salida que se había aceptado no ocurrió: la próxima vuelve a preguntar. */
export function withdrawDraftLoss(): void {
  acceptedRevision = -1;
  acceptedLeft = null;
}

export function draftLossAccepted(): boolean {
  return acceptedRevision === draftRevision;
}

/**
 * Sale de la cuenta, cosa que la persona ya aceptó aunque se lleve lo escrito a medias y lo que quedó en el cartel (se
 * le preguntó contándolos). Se anota recién acá, cuando la salida se ejecuta: si antes se cancela la ventana de salir,
 * no queda nada anotado. Si la salida falla, el «sí» deja de valer.
 */
export async function signOutAccepted<T>(run: () => Promise<T>): Promise<T> {
  acceptDraftLoss(true);
  try {
    const result = await run();
    // El cartel se descarta recién cuando la salida ocurrió: si falla, la persona sigue adentro con su texto.
    if ((result as { error?: unknown } | undefined)?.error) withdrawDraftLoss();
    else dropLeftDrafts();
    return result;
  } catch (err) {
    withdrawDraftLoss();
    throw err;
  }
}

/**
 * Pregunta antes de una salida que se lleva lo escrito a medias (sin nada escrito, no pregunta). Con un «sí», lo anota
 * (`acceptDraftLoss`). Devuelve si se puede seguir.
 */
export function confirmDraftLoss(question: string): boolean {
  if (drafts.size === 0) return true;
  if (!window.confirm(question)) return false;
  acceptDraftLoss();
  return true;
}

export function hasDrafts(): boolean {
  return drafts.size > 0;
}

/** Cuántos cuadros tienen algo escrito sin mandar (para decirlo antes de salir de la cuenta o de quitar el workspace). */
export function draftCount(): number {
  return drafts.size;
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
  // Con el editor: una decoración (una clase puesta a mano la borraba ProseMirror en menos de 250 ms y no se veía).
  if (flashBlock(blockId)) return true;
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
