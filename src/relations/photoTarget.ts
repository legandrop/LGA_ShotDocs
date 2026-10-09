// La foto exacta de un «ir al lugar» (Docs/Doc_Relaciones.md, sección 13): las fotos de un reporte suelen ir varias en
// un mismo párrafo (en línea, `.sd-photo`), y llevar la vista al bloque mostraba otra foto. `goToPlace` anota acá qué
// foto se pidió; `showPlace` (placeFlash.ts, que va con el editor) la toma al mostrar ese bloque, la lleva a la vista
// y resalta solo esa foto. Sin dependencias: lo importa la cabecera (primera carga) y el editor.

interface Target {
  pageId: string;
  blockId: string;
  mediaId: string;
  at: number;
}

/** Lo que vale un pedido sin usar (por si la página tarda en abrir). */
const TARGET_MS = 60_000;

let target: Target | null = null;

/** La foto que tiene que mostrar el próximo `showPlace` de ese bloque. */
export function aimAtPhoto(pageId: string, blockId: string, mediaId: string): void {
  target = { pageId, blockId, mediaId, at: Date.now() };
}

/** Olvida la foto pedida (un «ir al lugar» que no es de una foto). */
export function clearPhotoAim(): void {
  target = null;
}

/** La foto pedida para ese bloque, si hay una y está vigente; se usa una sola vez. */
export function takePhotoAim(pageId: string, blockId: string): string | null {
  const t = target;
  if (!t || t.pageId !== pageId || t.blockId !== blockId) return null;
  target = null;
  return Date.now() - t.at <= TARGET_MS ? t.mediaId : null;
}
