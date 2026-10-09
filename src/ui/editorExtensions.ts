import { createExtension } from '@blocknote/core';
import { collapseExtension, enterAfterCollapsedHeading, headingBackspaceExtension, type CollapseOptions } from './collapseEditor';
import { deleteEmptyBreak, enterAtBreakStart, insertPageBreak, PAGE_BREAK_SHORTCUT, removeBreakBefore } from './editorSchema';
import { findExtension } from './findEditor';
import { inlinePhotoSpotsExtension } from './inlinePhotoCreate';
import { inlinePhotoExtensions } from './inlinePhotoEditor';
import { undoGuardExtension } from './undoGuard';
import { relLinkKeyExtension } from '../relations/relLink';
import { blockReorderExtension } from './blockReorder';

/**
 * El teclado del salto de hoja (Docs/Doc_Hojas_PDF.md). Cada tecla actúa solo en su caso y si no, sigue la del editor.
 */
export const pageBreakExtension = createExtension({
  key: 'shotdocs-page-break',
  keyboardShortcuts: {
    // Ctrl+Enter (⌘↩ en la Mac): un salto de hoja donde está el cursor. En un título colapsado (al final, en el medio
    // o con una parte elegida, no al principio), primero lo que hace Enter al final (un renglón después de lo
    // escondido, sin partir el título ni abrir la sección), y ese renglón pasa a ser el salto.
    [PAGE_BREAK_SHORTCUT]: ({ editor }) => {
      const view = editor.prosemirrorView;
      if (view) enterAfterCollapsedHeading(view);
      return insertPageBreak(editor);
    },
    // Retroceso al principio del bloque que sigue a un salto: saca el salto (no junta el texto con él).
    Backspace: ({ editor }) => removeBreakBefore(editor),
    // Enter al principio de un salto con texto: un renglón común arriba, sin duplicar el salto.
    Enter: ({ editor }) => enterAtBreakStart(editor),
    // Supr en un salto vacío: lo saca (también si es el último hijo de un bloque: lo de abajo no se mueve).
    Delete: ({ editor }) => deleteEmptyBreak(editor),
  },
});

/**
 * Las extensiones del editor de una página, en un solo lugar: las usan la página (PageEditor.tsx), la página de
 * práctica y la prueba que compara los atajos del editor real con el registro (shortcuts.test.ts). Buscar y
 * reemplazar (findEditor.ts) y colapsar (collapseEditor.ts) van con decoraciones, sin tocar el documento.
 * `collapse` en `null`: el navegador no puede esconder (`collapseSupported`), sin colapsar.
 */
export function pageEditorExtensions(collapse: CollapseOptions | null) {
  return [
    // Un mover recrea el lado menor: el borrado concurrente nunca cae sobre un bloque vecino.
    blockReorderExtension,
    // Las fotos en línea (Docs/Doc_Fotos_En_Linea.md): sus filas, la marca de la selección y su teclado.
    ...inlinePhotoExtensions,
    // El lugar (y la marca de espera) de las fotos que se están guardando (inlinePhotoCreate.ts).
    inlinePhotoSpotsExtension,
    findExtension,
    // Cada borrado es un solo Ctrl+Z, y el deshacer del navegador nunca edita la página (undoGuard.ts).
    undoGuardExtension(),
    // El salto de hoja: Ctrl/⌘+Enter lo pone y Retroceso justo después lo saca (antes que el Retroceso de los títulos).
    pageBreakExtension,
    // Retroceso al principio de un título "sube la línea", en todos los navegadores (también sin colapsar).
    headingBackspaceExtension,
    // Volver link la escena o la locación subrayada (relations/relLink.ts): sin el subrayado (la exportación) no hace nada.
    relLinkKeyExtension,
    ...(collapse ? [collapseExtension(collapse)] : []),
  ];
}
