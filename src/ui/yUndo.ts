import { createExtension } from '@blocknote/core';
import { redoCommand, undoCommand, yUndoPlugin } from '@y/prosemirror';
import * as Y from '@y/y';

/**
 * Deshacer y rehacer con Yjs 14. La entrada `@blocknote/core/y` de BlockNote 0.55 no trae extensión de
 * deshacer (desactiva la historia de ProseMirror y `editor.undo()` tira "No undo plugin found"); esta es la
 * que usa el editor. La clave `yUndo` es la que busca BlockNote para `undo()`/`redo()` (Mod-z).
 */
export const yUndoExtension = (fragment: Y.Type) =>
  createExtension(() => {
    const undoManager = new Y.UndoManager(fragment, { trackedOrigins: new Set() });
    return { key: 'yUndo', prosemirrorPlugins: [yUndoPlugin(undoManager)], undoCommand, redoCommand, undoManager } as const;
  })();
