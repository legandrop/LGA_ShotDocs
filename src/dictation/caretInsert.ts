import { TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

// *Insert at cursor* (Docs/Doc_Dictado.md, 4.2 y 6; entrega V3): escribe lo dictado donde estaba el cursor antes de ir
// a la hoja, sin abrir el teclado. Sirve en la página (una celda, un párrafo) y en un campo de texto de la app (un
// comentario). La hoja recuerda el último campo donde estuvo el foco fuera de ella.

/** El último lugar donde se escribía fuera de la hoja: un campo de texto con su selección, o la página. */
export interface CursorSpot {
  el: HTMLElement;
  start?: number;
  end?: number;
}

const isField = (el: Element): el is HTMLTextAreaElement | HTMLInputElement =>
  el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && /^(text|search|url|email|)$/.test(el.type));

/** Lo que se recuerda de un elemento que recibió el foco (o `null` si no es un lugar donde se escribe). */
export function spotOf(el: EventTarget | null): CursorSpot | null {
  if (!(el instanceof HTMLElement)) return null;
  if (isField(el)) return el.readOnly || el.disabled ? null : { el, start: el.selectionStart ?? el.value.length, end: el.selectionEnd ?? el.value.length };
  const editable = el.closest('[contenteditable="true"]') as HTMLElement | null;
  return editable ? { el: editable } : null;
}

/** Actualiza la selección recordada de un campo (cambia mientras se escribe). */
export function refreshSpot(spot: CursorSpot | null): CursorSpot | null {
  if (!spot || !isField(spot.el) || !spot.el.isConnected) return spot;
  return { el: spot.el, start: spot.el.selectionStart ?? spot.start, end: spot.el.selectionEnd ?? spot.end };
}

/** Un espacio antes y después si hace falta, para no pegar la palabra a la de al lado. */
function padded(before: string, text: string, after: string): string {
  const pre = before && !/\s$/.test(before) ? ' ' : '';
  const post = after && !/^[\s.,;:!?)]/.test(after) ? ' ' : '';
  return `${pre}${text}${post}`;
}

/**
 * Escribe `text` en el lugar recordado. En la página (o sin un campo recordado): en la selección del editor, que se
 * conserva mientras el foco está en la hoja, como una edición más (se deshace con ⌘Z). Devuelve si lo escribió.
 *
 * Nunca reemplaza lo elegido (O2 de la auditoría de V2/V3): si había texto elegido, lo dictado va después de él. En el
 * teléfono un doble toque elige una palabra sin querer, y en un comentario el deshacer del navegador puede no devolverla.
 */
export function insertAtCursor(text: string, spot: CursorSpot | null, view: EditorView | null, canEditPage: boolean): boolean {
  const clean = text.trim();
  if (!clean) return false;
  if (spot && spot.el.isConnected && isField(spot.el) && !(view && view.dom.contains(spot.el))) {
    const field = spot.el;
    if (field.readOnly || field.disabled) return false;
    // Después de lo elegido, sin borrarlo.
    const start = Math.min(Math.max(spot.end ?? spot.start ?? field.value.length, spot.start ?? 0), field.value.length);
    const end = start;
    const insert = padded(field.value.slice(0, start), clean, field.value.slice(end));
    const value = field.value.slice(0, start) + insert + field.value.slice(end);
    if (field.maxLength > 0 && value.length > field.maxLength) return false;
    // El setter nativo y un `input`: un campo de React se entera como si se hubiera escrito.
    const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    try {
      field.setSelectionRange(start + insert.length, start + insert.length);
    } catch {
      // Un campo sin selección.
    }
    return true;
  }
  if (!view || !canEditPage || !view.editable) return false;
  const { selection, doc } = view.state;
  if (!(selection instanceof TextSelection) || !selection.$from.parent.isTextblock || !selection.$from.sameParent(selection.$to)) return false;
  // Después de lo elegido, sin borrarlo.
  const parent = selection.$to.parent;
  const before = parent.textBetween(0, selection.$to.parentOffset, '\n', ' ');
  const after = parent.textBetween(selection.$to.parentOffset, parent.content.size, '\n', ' ');
  const insert = padded(before, clean, after);
  const tr = view.state.tr.insertText(insert, selection.to, selection.to);
  if (tr.doc.eq(doc)) return false;
  view.dispatch(tr.scrollIntoView());
  return true;
}
