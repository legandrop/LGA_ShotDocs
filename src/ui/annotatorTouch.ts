// El dedo y el lápiz en el anotador (P.20, entrega 3; Docs/Doc_Anotar_Fotos.md, sección 2 y AN8), separado de la
// pantalla para poder probarlo sin un teléfono:
//   - Un dedo dibuja con la herramienta elegida; dos dedos amplían y mueven, NUNCA dibujan: el segundo dedo descarta lo
//     que el primero estaba dibujando (todavía no se escribió nada: se escribe al soltar).
//   - En un iPad o una tableta con lápiz, apenas se usa el lápiz (`pointerType: 'pen'`) el lápiz dibuja y el dedo mueve,
//     como en Notas. Mientras el lápiz dibuja, los dedos (la palma apoyada) no hacen nada.
//   - El mouse sigue como en la compu (entrega 2).

export type InputType = 'mouse' | 'touch' | 'pen';

/** Con qué se apoyó el puntero. Un tipo que el navegador no dice se trata como el mouse (lo de la compu). */
export function inputOf(pointerType: string | undefined | null): InputType {
  return pointerType === 'touch' || pointerType === 'pen' ? pointerType : 'mouse';
}

/** Qué hace un puntero que se apoya: la herramienta, ampliar con dos dedos, mover la foto, o nada. */
export type Route = 'tool' | 'pinch' | 'pan' | 'ignore';

export interface RouteInput {
  input: InputType;
  /** Solo el lápiz dibuja (se usó un lápiz en este dispositivo y no se volvió a pedir el dedo). */
  penOnly: boolean;
  /** Cuántos dedos hay apoyados, contando este. */
  touches: number;
  /** Con qué se está dibujando o eligiendo ahora (`null`: nada, o un gesto de dedos). */
  drawing: InputType | null;
}

export function routeDown({ input, penOnly, touches, drawing }: RouteInput): Route {
  if (input !== 'touch') return 'tool';
  // La palma apoyada mientras el lápiz dibuja.
  if (drawing === 'pen') return 'ignore';
  if (touches >= 2) return 'pinch';
  return penOnly ? 'pan' : 'tool';
}

/**
 * Cuánto se acepta errarle a una forma y a un tirador, y cuánto hay que mover para que sea un arrastre, en píxeles de
 * pantalla. Con el dedo, más (la yema tapa lo que toca); el lápiz, entre los dos.
 */
export const TOLERANCES: Record<InputType, { hit: number; handle: number; slop: number }> = {
  mouse: { hit: 6, handle: 9, slop: 3 },
  pen: { hit: 8, handle: 14, slop: 4 },
  touch: { hit: 16, handle: 22, slop: 8 },
};

/** Los puntos de un movimiento, con los que el navegador juntó en un solo evento (el lápiz manda hasta 240 por segundo). */
export function movePoints(e: { clientX: number; clientY: number; getCoalescedEvents?: () => { clientX: number; clientY: number }[] }): { x: number; y: number }[] {
  let list: { clientX: number; clientY: number }[] = [];
  try {
    list = e.getCoalescedEvents?.() ?? [];
  } catch {
    list = [];
  }
  if (list.length === 0) return [{ x: e.clientX, y: e.clientY }];
  return list.map((c) => ({ x: c.clientX, y: c.clientY }));
}

/** La distancia y el punto medio de dos dedos. */
export function twoFingers(a: { x: number; y: number }, b: { x: number; y: number }): { distance: number; mid: { x: number; y: number } } {
  return { distance: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
}
