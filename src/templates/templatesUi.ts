import { navigate, pagePath } from '../router';

// Lo que une el menú de la página (*Apply template…*, en la primera carga) con la página abierta, que es la que aplica
// la plantilla (Docs/Doc_Plantillas.md, 4.1). La parte de las plantillas (la tira, la ventana) se baja con el editor:
// se registra acá al montarse, como `collapseControlFor` y `pageCameraFor`.

export interface TemplateTarget {
  /** La página no tiene contenido (solo la estructura inicial): se le puede aplicar una plantilla. */
  empty(): boolean;
  /** Abre la ventana *Templates* para esta página. */
  open(): void;
}

const targets = new Map<string, TemplateTarget>();
/** *Apply template…* sobre una página que no estaba abierta: se abre la ventana cuando la página esté lista. */
let pending: { pageId: string; at: number } | null = null;
/** Un pedido que la página no tomó en este tiempo (no se pudo abrir, se fue a otra) ya no vale. */
const PENDING_MS = 15_000;

export function registerTemplateTarget(pageId: string, target: TemplateTarget): () => void {
  targets.set(pageId, target);
  return () => {
    if (targets.get(pageId) === target) targets.delete(pageId);
  };
}

/** La página abierta y editable con ese id, o `undefined` si no está abierta. */
export function templateTargetFor(pageId: string): TemplateTarget | undefined {
  return targets.get(pageId);
}

/** *Apply template…*: con la página abierta, la ventana; si no, se abre la página y la ventana cuando esté lista. */
export function requestTemplates(pageId: string): void {
  const target = targets.get(pageId);
  if (target) {
    target.open();
    return;
  }
  pending = { pageId, at: Date.now() };
  navigate(pagePath(pageId));
}

/** La página `pageId` toma el pedido pendiente (si era para ella). */
export function takeTemplatesRequest(pageId: string): boolean {
  if (!pending || pending.pageId !== pageId) return false;
  const fresh = Date.now() - pending.at < PENDING_MS;
  pending = null;
  return fresh;
}

// Ctrl/⌘+Z justo después de elegir una plantilla. El foco queda en el título vacío (4.2, paso 5), y ahí Ctrl/⌘+Z es
// del título, que no tiene nada para deshacer (el guardián del deshacer del editor no deja que el título deshaga la
// página: undoGuard.ts). Mientras el título no se toque, Ctrl/⌘+Z y Ctrl/⌘+Shift+Z ahí deshacen y rehacen la página.
const titleUndo = new Map<string, (redo: boolean) => void>();

/** La página `pageId` acaba de recibir una plantilla con el foco en el título: su deshacer va a la página. */
export function armTitleUndo(pageId: string, run: (redo: boolean) => void): () => void {
  titleUndo.set(pageId, run);
  return () => {
    if (titleUndo.get(pageId) === run) titleUndo.delete(pageId);
  };
}

/** Lo que hace Ctrl/⌘+Z en el título de `pageId` si la página acaba de recibir una plantilla (si no, `undefined`). */
export function titleUndoFor(pageId: string): ((redo: boolean) => void) | undefined {
  return titleUndo.get(pageId);
}

/** Se escribió en el título o se fue de ahí: Ctrl/⌘+Z vuelve a ser del título. */
export function disarmTitleUndo(pageId: string): void {
  titleUndo.delete(pageId);
}
