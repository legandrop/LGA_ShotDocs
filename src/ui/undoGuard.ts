import { createExtension, type ExtensionOptions } from '@blocknote/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
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
//   afuera, el menú Edición) se cancela y hace el deshacer de la página (Yjs). Con el foco en otro campo (el
//   título, un comentario, la búsqueda, un diálogo), que se quedó sin nada para deshacer, se cancela y no hace nada.
// - Todo lo que saca bloques (los puntos y borrar, varios bloques, la sección, Ctrl+A, una selección de texto de un
//   bloque a otro, juntar dos renglones) es siempre su propio paso: la pila de Yjs junta lo hecho en medio segundo
//   (`captureTimeout`), así que antes y después se corta (`stopCapturing`). Un Ctrl+Z trae justo lo borrado; el
//   siguiente, lo escrito antes.
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

let oneStep = 0;

/**
 * Hace `fn` (varios cambios seguidos del editor) como UN solo paso de deshacer: corta antes y después, y en el medio
 * ni el tiempo (`captureTimeout`) ni sacar bloques lo parten. Lo usa "Convert photos to inline" (convertPhotos.ts).
 */
export function asOneUndoStep<T>(state: EditorState, fn: () => T): T {
  const um = (yUndoPluginKey.getState(state as never) as { undoManager?: Y.UndoManager } | undefined)?.undoManager ?? null;
  const timeout = um?.captureTimeout ?? 0;
  um?.stopCapturing();
  if (um) um.captureTimeout = Number.MAX_SAFE_INTEGER;
  oneStep++;
  try {
    return fn();
  } finally {
    oneStep--;
    if (um) {
      um.captureTimeout = timeout;
      um.stopCapturing();
    }
  }
}

/**
 * Si una transacción propia saca bloques (borrar bloques elegidos, cortar, escribir encima, una selección de texto
 * de un bloque a otro, juntar dos renglones): cada una es su propio paso de deshacer. No cuentan los cambios de
 * Yjs (de otro, deshacer y rehacer) ni lo que agregan los plugins en la misma pasada.
 */
export function removesBlocks(tr: Transaction, state: EditorState): boolean {
  if (oneStep > 0 || !tr.docChanged || tr.getMeta(ySyncPluginKey as never) || tr.getMeta('appendedTransaction')) return false;
  const after = blockIds(tr.doc);
  for (const id of blockIds(state.doc)) if (!after.has(id)) return true;
  return false;
}

/** Un lugar donde se escribe que no es el editor (el título, el comentario, la búsqueda, un diálogo). */
function otherTextField(view: EditorView, el: Element | null): boolean {
  if (!el || view.dom.contains(el)) return false;
  return el.matches('input, textarea, select') || (el as HTMLElement).isContentEditable === true;
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
        if (removesBlocks(tr, state)) {
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
          beforeinput(view, event) {
            const type = (event as InputEvent).inputType;
            if (type !== 'historyUndo' && type !== 'historyRedo') return false;
            // Si no se puede cancelar, que lo haga el navegador (ProseMirror lo toma como cualquier cambio).
            if (!event.cancelable) return false;
            event.preventDefault();
            if (!view.editable) return true;
            // Con el foco en otro campo (el título, un comentario, la búsqueda) que ya no tiene nada para deshacer,
            // el navegador sigue con el editor: se cancela y no se hace nada (si no, cada Ctrl+Z en el título iría
            // deshaciendo la página).
            if (otherTextField(view, view.dom.ownerDocument.activeElement)) return true;
            if (type === 'historyUndo') editor.undo();
            else editor.redo();
            return true;
          },
        },
      },
    }),
  ],
}));
