import { ySyncPluginKey } from 'y-prosemirror';

// Si el editor no pudo dibujar un cambio que llegó de otro dispositivo (tiró un error adentro de
// y-prosemirror), el cambio está en el documento de Yjs pero el editor sigue mostrando lo de antes. En la
// próxima tecla, el editor escribe esa versión vieja encima y deshace el cambio para todos. Esto lo vuelve
// a dibujar entero desde el documento, en el momento (antes de que llegue otra tecla). Ver
// Docs/Doc_Colaboracion.md.

interface EditorWithView {
  prosemirrorView?: { state: unknown } | null;
  isEditable?: boolean;
}

interface SyncBinding {
  _forceRerender: () => void;
}

/**
 * Vuelve a dibujar el editor desde el documento de Yjs. Devuelve false si no pudo: entonces el editor queda
 * en solo lectura (para que no escriba lo viejo encima) y quien lo llamó lo tiene que volver a montar.
 */
export function redrawFromYjs(editor: EditorWithView): boolean {
  try {
    const view = editor.prosemirrorView;
    const state = view ? (ySyncPluginKey.getState(view.state as never) as { binding?: SyncBinding } | undefined) : undefined;
    const binding = state?.binding;
    if (!binding || typeof binding._forceRerender !== 'function') throw new Error('No sync binding');
    binding._forceRerender();
    return true;
  } catch (err) {
    console.warn('Could not redraw the editor from the document.', err);
    try {
      editor.isEditable = false;
    } catch {
      // Ya desmontado.
    }
    return false;
  }
}
