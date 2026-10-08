// Resaltar un bloque de la página abierta desde afuera del editor («Ir al bloque» de los comentarios), sin cargar el
// editor: el resaltado de verdad es una decoración de ProseMirror (relations/placeFlash.ts), que se registra acá al
// cargarse con el editor. Una clase puesta a mano en el DOM no sirve: ProseMirror vuelve a dibujar el bloque y la borra
// en menos de 250 ms.

let flasher: ((blockId: string) => boolean) | null = null;

export function setBlockFlasher(fn: (blockId: string) => boolean): void {
  flasher = fn;
}

/** Resalta un bloque con la decoración del editor; `false` si no hay editor con ese bloque. */
export function flashBlock(blockId: string): boolean {
  return flasher?.(blockId) ?? false;
}
