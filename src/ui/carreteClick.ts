// Cuándo un clic o un toque en una foto del editor abre el carrete (Docs/Doc_Imagenes.md, Doc_Carrete.md).
// Se decide en dos tiempos: al apretar (antes de que el editor elija la foto, al soltar) y en el clic.

/** Al apretar con el mouse: abre si la página es de solo lectura o si esa foto ya estaba elegida. */
export function mousePressOpens(p: { editable: boolean; focused: boolean; selectedId: string | null; targetId: string | null }): boolean {
  return !p.editable || (p.focused && p.targetId !== null && p.selectedId === p.targetId);
}

/**
 * En el clic. Con el mouse, el primer clic solo elige: abre si al apretar ya estaba elegida o si es un
 * doble clic, nunca con ⌘/Ctrl (ese clic elige el bloque de afuera). Con el dedo o el lápiz, como siempre:
 * abre, salvo el toque que empezó sobre la foto ya elegida (ese muestra su barra).
 */
export function clickOpens(p: {
  kind: string;
  mouseOpens: boolean;
  pressedSelected: boolean;
  detail: number;
  modifier: boolean;
}): boolean {
  if (p.kind === 'mouse') return !p.modifier && (p.mouseOpens || p.detail >= 2);
  return !p.pressedSelected;
}

/**
 * Shift+clic en una foto en línea elige el texto hasta ella (inlinePhotoEditor.ts, Docs/Doc_Fotos_En_Linea.md): ese
 * clic no abre el carrete. Solo si la página se puede editar: en solo lectura no hay nada que elegir y el clic
 * abre, como en una foto-bloque.
 */
export function shiftSelects(p: { editable: boolean; shiftKey: boolean; inlinePhoto: boolean }): boolean {
  return p.editable && p.shiftKey && p.inlinePhoto;
}
