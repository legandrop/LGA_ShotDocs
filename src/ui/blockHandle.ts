import { NodeSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

// Los puntos a la izquierda de cada bloque (BlockSideMenu.tsx): un clic elige el bloque entero, como hace
// BlockNote al empezar a arrastrarlo (una `NodeSelection` del `blockContainer`). Con el bloque elegido aparece la
// barra de formato entera (tipo de bloque, colores…), y Retroceso, Supr o Cortar lo borran; un título colapsado
// elegido así se va con su sección entera (Docs/Doc_Colapsar.md, sección 5, (A)).

/** La posición del `blockContainer` con ese id, o -1. */
export function blockPos(view: EditorView, blockId: string): number {
  let at = -1;
  view.state.doc.descendants((node, pos) => {
    if (at >= 0) return false;
    if (node.type.name === 'blockContainer') {
      if (node.attrs.id === blockId) {
        at = pos;
        return false;
      }
      return true;
    }
    return node.type.name === 'blockGroup' || node.type.name === 'doc';
  });
  return at;
}

/** Elige el bloque entero y deja el foco en el editor (así Ctrl+Z, Retroceso y Supr van al editor). */
export function selectWholeBlock(view: EditorView, blockId: string): boolean {
  const pos = blockPos(view, blockId);
  if (pos < 0) return false;
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
  view.focus();
  return true;
}
