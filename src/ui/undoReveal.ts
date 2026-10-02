import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { revealBlock } from './collapseEditor';

// Mostrar lo que cambió un deshacer de la línea de tiempo (P.26, Docs/Doc_Deshacer.md, 3.4): un paso de antes de cambiar
// de página no guarda la selección de este editor (se borra con el editor viejo, 3.2), así que el cursor no vuelve solo.
// Se busca dónde empieza la diferencia entre el documento de antes y el de ahora, se abre la sección colapsada que lo
// esconde (el mismo `revealBlock` de "ir al bloque" de los comentarios) y se lleva ahí el cursor o, con el foco afuera
// del editor, solo la vista.

/** Dónde empieza la diferencia entre dos documentos (`null`: son iguales). */
export function changeStart(before: PMNode, after: PMNode): number | null {
  const pos = before.content.findDiffStart(after.content);
  return pos === null || pos === undefined ? null : Math.min(pos, after.content.size);
}

export function revealChange(view: EditorView, before: PMNode, { moveCursor }: { moveCursor: boolean }): void {
  if (view.isDestroyed) return;
  const pos = changeStart(before, view.state.doc);
  if (pos === null) return;
  // La sección colapsada que esconde el cambio se abre (solo para vos, como "ir al bloque").
  const $pos = view.state.doc.resolve(pos);
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === 'blockContainer' && node.attrs.id) {
      try {
        revealBlock(view, String(node.attrs.id));
      } catch {
        // Sin colapsar en este navegador: no hay nada que abrir.
      }
      break;
    }
  }
  const at = Math.min(pos, view.state.doc.content.size);
  if (moveCursor) {
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at))).scrollIntoView());
    view.focus();
    return;
  }
  try {
    const { node } = view.domAtPos(at);
    const el = node instanceof Element ? node : node.parentElement;
    el?.scrollIntoView?.({ block: 'nearest' });
  } catch {
    // La posición no tiene un elemento a la vista.
  }
}
