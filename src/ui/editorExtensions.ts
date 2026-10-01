import { collapseExtension, headingBackspaceExtension, type CollapseOptions } from './collapseEditor';
import { findExtension } from './findEditor';
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
    findExtension,
    // Cada borrado es un solo Ctrl+Z, y el deshacer del navegador nunca edita la página (undoGuard.ts).
    undoGuardExtension(),
    // Retroceso al principio de un título "sube la línea", en todos los navegadores (también sin colapsar).
    headingBackspaceExtension,
    ...(collapse ? [collapseExtension(collapse)] : []),
  ];
}
