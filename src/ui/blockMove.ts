import { Slice, type Node as PMNode } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { updateYFragment, ySyncPluginKey, yUndoPluginKey } from 'y-prosemirror';
import type * as Y from 'yjs';

// Mover bloques enteros sin exponer lo que no se mueve (P.11, entrega 1b; Docs/Doc_Colapsar.md, "Mover la sección
// entera").
//
// Lo que costó descubrir: en Yjs (13) no existe mover. y-prosemirror traduce cada cambio del editor comparando por
// posición (`updateYFragment`): deja el principio y el final que coinciden y REESCRIBE en su lugar cada bloque del
// medio (le cambia el id y el contenido). Mover k bloques por encima de m reescribe los k + m: si otro escribe a la
// vez en uno de ellos, su texto aparece en otro bloque o se pierde (si cambia el tipo), y si otro borra uno, se
// pierde otro bloque que nadie tocó.
//
// Acá el mover se escribe en Yjs en dos pasadas, dentro de una sola transacción de Yjs (un solo cambio que se sube,
// un solo paso de deshacer): primero el documento sin el lado que se recrea (un borrado limpio) y después el
// documento final (una inserción limpia). Se recrea el lado más chico: los bloques que se mueven o los que se
// saltan. El otro lado no se toca: lo que otro escriba ahí a la vez queda donde lo escribió.

/** Un mover: los bloques hermanos de `from` a `to` van a `insertAt` (posiciones del documento de antes). */
export interface BlockMove {
  from: number;
  to: number;
  /** Entre dos bloques, antes de `from` o después de `to` (en el mismo grupo o en otro). */
  insertAt: number;
}

/** Qué lado se recrea en Yjs (las pruebas miden los tres; la app usa `smaller`). */
export type Recreate = 'smaller' | 'moved' | 'skipped';

/** La transacción del editor: borra los bloques y los inserta en su lugar nuevo, los mismos nodos. */
export function moveTransaction(state: EditorState, move: BlockMove): Transaction {
  return buildMove(state, move).tr;
}

/**
 * Lo que se borra para sacar los bloques: ellos, o su grupo entero si son todos sus hijos (un grupo de hijos no
 * puede quedar vacío: ProseMirror lo rellenaría con un párrafo nuevo; auditoría de la 1b, M-1).
 */
export function deletionRange(doc: PMNode, move: BlockMove): { from: number; to: number } {
  const $from = doc.resolve(move.from);
  if ($from.depth > 1 && $from.parent.type.name === 'blockGroup' && move.from === $from.start() && move.to === $from.end()) {
    return { from: move.from - 1, to: move.to + 1 };
  }
  return { from: move.from, to: move.to };
}

/** Lo mismo, con dónde quedó lo movido (el principio, en el documento de después). */
export function buildMove(state: EditorState, move: BlockMove): { tr: Transaction; at: number } {
  const content = state.doc.slice(move.from, move.to).content;
  const del = deletionRange(state.doc, move);
  const tr = state.tr.delete(del.from, del.to);
  const at = tr.mapping.map(move.insertAt);
  tr.insert(at, content);
  return { tr, at };
}

/** Cuántos bloques hay en un tramo (con los anidados). */
function countBlocks(doc: PMNode, from: number, to: number): number {
  let n = 0;
  doc.nodesBetween(from, to, (node) => {
    if (node.type.name === 'blockContainer') n++;
    return node.type.name !== 'blockContainer' || node.childCount > 1;
  });
  return n;
}

/**
 * El tramo que se recrea en Yjs (posiciones del documento de antes). Los que se saltan son los hermanos entre el
 * tramo y su lugar nuevo; si el lugar nuevo es de otro grupo (sale de un bloque o entra en otro), se recrea lo
 * que se mueve.
 */
export function recreatedRange(doc: PMNode, move: BlockMove, recreate: Recreate = 'smaller'): { from: number; to: number } {
  const moved = deletionRange(doc, move);
  if (recreate === 'moved') return moved;
  const $from = doc.resolve(move.from);
  const $at = doc.resolve(move.insertAt);
  if ($at.depth !== $from.depth || $at.parent !== $from.parent) return moved;
  const skipped = move.insertAt > move.to ? { from: move.to, to: move.insertAt } : { from: move.insertAt, to: move.from };
  if (skipped.to <= skipped.from) return moved;
  if (recreate === 'skipped') return skipped;
  // Empate: lo que se salta.
  return countBlocks(doc, moved.from, moved.to) < countBlocks(doc, skipped.from, skipped.to) ? moved : skipped;
}

/** Mientras se escribe un mover en Yjs (para marcar su paso de deshacer). */
let moving = false;
export const movingBlocks = (): boolean => moving;

interface Binding {
  mux: (fn: () => void) => void;
  doc: Y.Doc;
  type: Y.XmlFragment;
  prosemirrorView: EditorView | null;
  _prosemirrorChanged: (doc: PMNode) => void;
}

function bindingOf(state: EditorState): Binding | null {
  const b = (ySyncPluginKey.getState(state as never) as { binding?: Binding } | undefined)?.binding;
  return b && b.prosemirrorView ? b : null;
}

function stopCapturing(state: EditorState): void {
  (yUndoPluginKey.getState(state as never) as { undoManager?: Y.UndoManager } | undefined)?.undoManager?.stopCapturing();
}

/**
 * Despacha un mover: en el editor, la transacción tal cual (los plugins la ven como cualquier otra); en Yjs, las dos
 * pasadas. Sin Yjs (un editor sin colaboración), un despacho común. Es su propio paso de deshacer.
 */
export function dispatchMove(view: EditorView, tr: Transaction, removed: { from: number; to: number }): void {
  const binding = bindingOf(view.state);
  if (!binding) return view.dispatch(tr);
  const before = view.state.doc;
  let middle: PMNode;
  try {
    middle = before.replace(removed.from, removed.to, Slice.empty);
  } catch {
    return view.dispatch(tr);
  }
  stopCapturing(view.state);
  binding.mux(() => {
    // Adentro del `mux`, y-prosemirror no traduce el despacho (lo hacemos acá, en dos pasadas).
    view.dispatch(tr);
    const after = view.state.doc;
    if (after === before) return;
    moving = true;
    try {
      binding.doc.transact(() => {
        try {
          updateYFragment(binding.doc, binding.type, middle as never, binding as never);
          binding._prosemirrorChanged(after);
        } catch (err) {
          // Si algo falla en el medio, Yjs no queda con el lado recreado borrado: vuelve a "antes" y se escribe el
          // final como un despacho común (auditoría de la 1b, M-2).
          console.error('mover bloques: las dos pasadas fallaron; se escribe como un despacho común', err);
          updateYFragment(binding.doc, binding.type, before as never, binding as never);
          binding._prosemirrorChanged(after);
        }
      }, ySyncPluginKey);
    } finally {
      moving = false;
    }
  });
  stopCapturing(view.state);
}
