// Dónde va un globo al lado de un elemento sin salirse de la pantalla: lo comparten los tooltips (Tooltip.tsx) y
// los globitos de la recorrida (tutorial/TourLayer.tsx). Solo cálculo, sin DOM.

export type Side = 'below' | 'above' | 'right' | 'left';

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Placement {
  left: number;
  top: number;
  side: Side;
  /** Dónde apunta la flecha, desde el borde del globo (horizontal arriba o abajo, vertical a los costados). */
  arrow: number;
}

/**
 * La posición de un globo de `size` junto a `target`, probando los lados en el orden de `sides`: el primero donde
 * entra entero; si no entra en ninguno, el primero, corrido para que quede adentro. `gap`: la separación con el
 * elemento; `edge`: el margen con el borde de la pantalla.
 */
export function placeNear(
  target: Rect,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  { sides = ['below', 'above'] as Side[], gap = 13, edge = 8 } = {},
): Placement {
  const fits: Record<Side, boolean> = {
    below: target.top + target.height + gap + size.height <= viewport.height - edge,
    above: target.top - gap - size.height >= edge,
    right: target.left + target.width + gap + size.width <= viewport.width - edge,
    left: target.left - gap - size.width >= edge,
  };
  const side = sides.find((s) => fits[s]) ?? sides[0];
  const clampX = (x: number) => Math.min(Math.max(edge, x), viewport.width - edge - size.width);
  const clampY = (y: number) => Math.min(Math.max(edge, y), viewport.height - edge - size.height);
  const cx = target.left + target.width / 2;
  const cy = target.top + target.height / 2;
  if (side === 'below' || side === 'above') {
    const left = clampX(cx - size.width / 2);
    const top = side === 'below' ? target.top + target.height + gap : target.top - gap - size.height;
    return { left, top, side, arrow: Math.min(Math.max(14, cx - left), size.width - 14) };
  }
  const top = clampY(cy - size.height / 2);
  const left = side === 'right' ? target.left + target.width + gap : target.left - gap - size.width;
  return { left, top, side, arrow: Math.min(Math.max(14, cy - top), size.height - 14) };
}
