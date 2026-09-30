import { createExtension, type ExtensionOptions } from '@blocknote/core';
import { AllSelection, NodeSelection, Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { ySyncPluginKey, yUndoPluginKey } from 'y-prosemirror';
import type * as Y from 'yjs';

// Deshacer en la página: cada borrado es un solo Ctrl+Z, y Ctrl+Z nunca deshace otra cosa antes.
//
// Lo que pasaba (v0.054, "Borrar" del menú del bloque): el menú se cerraba con el bloque y el foco quedaba en la
// página (`body`), no en el editor. Ctrl+Z ahí no llega a los atajos del editor: el navegador hace su propio
// deshacer (`historyUndo`) sobre lo último que se escribió en el editor, cambia el texto en pantalla y ProseMirror
// lo toma como una edición nueva (que Yjs guarda en su pila). Así, los primeros Ctrl+Z "deshacían" letras escritas
// antes (y el siguiente las volvía a poner) hasta que por fin llegaba al borrado. El borrado en sí siempre fue un
// solo paso de la pila de Yjs (la pasada de colapsar va en la misma transacción).
//
// El arreglo:
// - El deshacer del navegador sobre el editor (`beforeinput` con `historyUndo` / `historyRedo`: Ctrl+Z con el foco
//   afuera, el menú Edición) se cancela y hace el deshacer de la página (Yjs).
// - Borrar bloques enteros elegidos (los puntos, varios bloques, la sección, Ctrl+A) es siempre su propio paso: la
//   pila de Yjs junta lo hecho en medio segundo (`captureTimeout`), así que antes y después se corta
//   (`stopCapturing`). Un Ctrl+Z trae justo lo borrado; el siguiente, lo escrito antes.
// - Los puntos dejan el foco en el editor (blockHandle.ts).

type UndoManagerLike = Pick<Y.UndoManager, 'stopCapturing'>;

function undoManagerOf(state: EditorState): UndoManagerLike | null {
  return (yUndoPluginKey.getState(state as never) as { undoManager?: UndoManagerLike } | undefined)?.undoManager ?? null;
}

function blockIds(doc: EditorState['doc']): Set<string> {
  const ids = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name === 'blockContainer') {
      if (node.attrs.id) ids.add(String(node.attrs.id));
      return true;
    }
    return node.type.name === 'blockGroup' || node.type.name === 'doc';
  });
  return ids;
}

/** Una selección de bloques enteros: el bloque elegido, varios bloques, la sección, toda la página. */
export function wholeBlocksSelected(state: EditorState): boolean {
  const sel = state.selection;
  if (sel instanceof NodeSelection || sel instanceof AllSelection) return true;
  const type = (sel.toJSON() as { type?: string }).type;
  return type === 'multiple-node' || type === 'sd-section';
}

/** Si una transacción propia saca bloques que estaban elegidos enteros (borrar, cortar, escribir encima). */
export function removesChosenBlocks(tr: Transaction, state: EditorState): boolean {
  if (!tr.docChanged || tr.getMeta(ySyncPluginKey as never) || !wholeBlocksSelected(state)) return false;
  const after = blockIds(tr.doc);
  for (const id of blockIds(state.doc)) if (!after.has(id)) return true;
  return false;
}

export const undoGuardKey = new PluginKey('shotdocs-undo-guard');

/** Va en todos los editores de página: `undoGuardExtension()`. */
export const undoGuardExtension = createExtension(({ editor }: ExtensionOptions<undefined>) => ({
  key: 'shotdocs-undo-guard',
  prosemirrorPlugins: [
    new Plugin({
      key: undoGuardKey,
      // Corre antes de que y-prosemirror escriba el cambio en Yjs (lo hace al dibujar): el borrado empieza un paso
      // nuevo, y el paso se cierra enseguida después (lo que se escriba después es otro).
      filterTransaction(tr, state) {
        if (removesChosenBlocks(tr, state)) {
          const um = undoManagerOf(state);
          if (um) {
            um.stopCapturing();
            queueMicrotask(() => um.stopCapturing());
          }
        }
        return true;
      },
      props: {
        handleDOMEvents: {
          beforeinput(_view, event) {
            const type = (event as InputEvent).inputType;
            if (type !== 'historyUndo' && type !== 'historyRedo') return false;
            event.preventDefault();
            if (type === 'historyUndo') editor.undo();
            else editor.redo();
            return true;
          },
        },
      },
    }),
  ],
}));
