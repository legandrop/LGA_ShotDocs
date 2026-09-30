// El margen izquierdo de cada bloque (Docs/Doc_Colapsar.md, sección 3): [puntos] [triángulo] [texto] en los
// títulos y [puntos] [texto] en lo demás, con el mismo espacio a la vista entre cada cosa. Los puntos van
// centrados en el primer renglón del bloque y el triángulo en el primer renglón del título. Un solo lugar para las
// medidas: el triángulo (CollapseToggles.tsx) y los puntos (BlockSideMenu.tsx) se ubican con estas funciones.

/** El espacio que se ve entre los puntos, el triángulo y el texto (px). */
export const GUTTER_GAP = 6;
/** El botón de los puntos (px): angosto, así entra en el margen del teléfono (20 px) sin tapar el texto. */
export const DOTS_BUTTON = { width: 14, height: 24 };
/**
 * Los puntos van contra el borde derecho de su botón (a 1 px): así la zona del clic de los puntos no pisa la del
 * triángulo (cada una tiene menos de `GUTTER_GAP` de aire hacia la otra).
 */
const DOTS_RIGHT_PAD = 1;
/** Lo que ocupa el triángulo abierto (apunta abajo) dentro de su dibujo: del 10 % al 90 % del ancho. */
const GLYPH_INSET = 0.1;

/** El alto del primer renglón de un texto (px). */
function firstLine(el: Element, rect: DOMRect): number {
  const style = getComputedStyle(el);
  const fontSize = parseFloat(style.fontSize) || 16;
  const line = parseFloat(style.lineHeight) || fontSize * 1.3;
  return Math.min(line, rect.height || line);
}

export interface TriangleBox {
  /** El lado del dibujo (px): más grande en los títulos más grandes. */
  size: number;
  /** El lado de la zona del clic (px). */
  box: number;
  /** La esquina de la zona del clic, en coordenadas de la ventana. */
  left: number;
  top: number;
}

/**
 * El triángulo de un título: del tamaño de las minúsculas del título (la mitad del cuerpo, entre 10 y 20 px),
 * con su borde derecho a `GUTTER_GAP` del texto y centrado en el primer renglón. Nunca pisa el texto ni sale del
 * editor (`editorLeft`): en el teléfono (20 px de margen) se achica para entrar.
 */
export function triangleBox(text: Element, editorLeft: number): TriangleBox {
  const r = text.getBoundingClientRect();
  const fontSize = parseFloat(getComputedStyle(text).fontSize) || 16;
  let size = Math.max(10, Math.min(20, Math.round(fontSize * 0.5)));
  let box = Math.max(18, size + 6);
  const room = Math.max(0, r.left - editorLeft);
  if (box > room) {
    box = Math.max(12, Math.floor(room));
    size = Math.min(size, box - 4);
  }
  const center = r.left - GUTTER_GAP + GLYPH_INSET * size - size / 2;
  const left = Math.min(Math.max(center - box / 2, r.left - room), r.left - box);
  return { size, box, left, top: r.top + firstLine(text, r) / 2 - box / 2 };
}

/** Dónde empieza a verse el triángulo (su borde izquierdo), a partir de su dibujo en pantalla. */
export function triangleVisibleLeft(svg: Element): number {
  const r = svg.getBoundingClientRect();
  return r.left + GLYPH_INSET * r.width;
}

export interface HandlePlace {
  /** El borde derecho del botón de los puntos, en coordenadas de la ventana. */
  right: number;
  /** El centro del primer renglón del bloque, en coordenadas de la ventana. */
  centerY: number;
  /** Si el botón entra sin salir del editor (en un título del teléfono, no: ahí va solo el triángulo). */
  fits: boolean;
}

/** El texto de un bloque (el título, el renglón) o, si no tiene (una foto), su contenido. */
function textOf(block: Element): Element | null {
  const content = block.querySelector(':scope > .bn-block-content');
  if (!content) return null;
  return content.querySelector('h1, h2, h3, h4, h5, h6') ?? content.querySelector('.bn-inline-content') ?? content;
}

/**
 * Los puntos de un bloque: a `GUTTER_GAP` del triángulo (si el bloque tiene uno a la vista) o del texto, y
 * centrados en su primer renglón.
 */
export function handlePlace(block: Element, triangle: Element | null): HandlePlace | null {
  const text = textOf(block);
  if (!text) return null;
  const r = text.getBoundingClientRect();
  const editor = block.closest('.bn-editor');
  const editorLeft = editor ? editor.getBoundingClientRect().left : -Infinity;
  const glyphRight = (triangle ? triangleVisibleLeft(triangle) : r.left) - GUTTER_GAP;
  const right = glyphRight + DOTS_RIGHT_PAD;
  return { right, centerY: r.top + firstLine(text, r) / 2, fits: right - DOTS_BUTTON.width >= editorLeft - 0.5 };
}
