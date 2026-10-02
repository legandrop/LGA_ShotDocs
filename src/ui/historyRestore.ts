import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { yUndoPluginKey, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import * as Y from 'yjs';
import { sameShape, yShape, type ContentShape } from '../sync/history';
import { CONTENT_FRAGMENT } from '../sync/structure';
import type { RestoreOutcome } from './historyUi';

// Restaurar una versión del historial (P.18, Docs/Doc_Historial.md, sección 6): una edición nueva POR EL EDITOR, la
// misma vía que escribir. Una sola transacción de ProseMirror reemplaza el contenido de la página; y-prosemirror (con
// sus parches) la pasa a Yjs comparando con lo que hay, así lo que no cambió queda igual (los ids de los bloques, y
// con ellos los comentarios), se deshace con Ctrl/⌘+Z en un paso y sube como cualquier edición. Nunca borra historia:
// lo de antes sigue en las filas de `page_updates`. El mapa de colapsar, el título y el formato no se tocan.

/** La forma del nodo de ProseMirror (la misma cuenta que `yShape`: bloques, texto y nodos). */
export function pmShape(doc: PMNode): ContentShape {
  const ids: string[] = [];
  let text = 0;
  let nodes = 0;
  doc.descendants((node) => {
    if (node.isText) {
      text += node.text?.length ?? 0;
      return false;
    }
    nodes++;
    if (node.type.name === 'blockContainer') ids.push(String(node.attrs.id ?? ''));
    return true;
  });
  return { ids, text, nodes };
}

/**
 * El nodo de ProseMirror de una versión, y si pasó la ida y vuelta. y-prosemirror, cuando no puede armar un bloque, lo
 * borra de su documento y sigue sin avisar: por eso se arma sobre una copia y se compara la forma (ids, texto, nodos)
 * con la de la versión en Yjs. Si no coincide, algo se perdería: no se muestra como completa ni se restaura.
 */
export function versionNode(version: Y.Doc, schema: Schema): { node: PMNode | null; complete: boolean } {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(version));
  const expected = yShape(copy);
  try {
    const node = yXmlFragmentToProseMirrorRootNode(copy.getXmlFragment(CONTENT_FRAGMENT), schema);
    return { node, complete: sameShape(expected, pmShape(node)) };
  } catch {
    return { node: null, complete: false };
  } finally {
    copy.destroy();
  }
}

interface UndoState {
  undoManager?: Y.UndoManager;
}

/** El deshacer de y-prosemirror del editor (el mismo de Ctrl/⌘+Z). */
export function editorUndo(view: EditorView): Y.UndoManager | null {
  return (yUndoPluginKey.getState(view.state as never) as UndoState | undefined)?.undoManager ?? null;
}

/** Restaura la versión en el editor (editable) de la página. `onEdit` avisa la próxima edición (para el **Undo**). */
export function restoreInEditor(
  view: EditorView,
  version: Y.Doc,
  onEdit: (fn: () => void) => () => void = () => () => undefined,
): RestoreOutcome {
  if (!view.editable) return { ok: false, reason: 'notEditable' };
  const { node, complete } = versionNode(version, view.state.schema);
  if (!node || !complete) return { ok: false, reason: 'shape' };
  const undo = editorUndo(view);
  try {
    // Un paso propio de deshacer: ni se junta con lo escrito antes ni con lo que se escriba después.
    undo?.stopCapturing();
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, node.content).setMeta('addToHistory', true));
    undo?.stopCapturing();
  } catch {
    return { ok: false, reason: 'failed' };
  }
  const size = undo?.undoStack.length ?? 0;
  return { ok: true, undo: () => undoRestore(view, size), onEdit };
}

/** Deshace la restauración (el aviso con **Undo**): solo si lo último del deshacer sigue siendo ella. */
export function undoRestore(view: EditorView, stackSize: number): boolean {
  const undo = editorUndo(view);
  if (!undo || undo.undoStack.length !== stackSize) return false;
  undo.undo();
  return true;
}
