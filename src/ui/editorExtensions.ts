import { collapseExtension, headingBackspaceExtension, type CollapseOptions } from './collapseEditor';
import { pageBreakExtension } from './editorSchema';
import { findExtension } from './findEditor';
import { inlinePhotoSpotsExtension } from './inlinePhotoCreate';
import { inlinePhotoExtensions } from './inlinePhotoEditor';
import { undoGuardExtension } from './undoGuard';

/**
 * Las extensiones del editor de una página, en un solo lugar: las usan la página (PageEditor.tsx), la página de
 * práctica y la prueba que compara los atajos del editor real con el registro (shortcuts.test.ts). Buscar y
 * reemplazar (findEditor.ts) y colapsar (collapseEditor.ts) van con decoraciones, sin tocar el documento.
 * `collapse` en `null`: el navegador no puede esconder (`collapseSupported`), sin colapsar.
 */
export function pageEditorExtensions(collapse: CollapseOptions | null) {
  return [
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
    ...(collapse ? [collapseExtension(collapse)] : []),
  ];
}
