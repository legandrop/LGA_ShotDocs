// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { GUTTER_GAP, DOTS_BUTTON, handlePlace, triangleBox, triangleVisibleLeft } from './gutterLayout';

// El margen de cada bloque (Docs/Doc_Colapsar.md, "El margen del bloque y deshacer"): el triángulo crece con el
// título, [puntos] [triángulo] [texto] con el mismo espacio a la vista, todo centrado en el primer renglón, y en el
// teléfono (20 px de margen) nada pisa el texto. jsdom no mide: cada elemento dice su rectángulo.

afterEach(() => {
  document.body.replaceChildren();
});

function rect(el: Element, x: number, y: number, width: number, height: number) {
  el.getBoundingClientRect = () => new DOMRect(x, y, width, height);
}

/** Un editor con un bloque (título o párrafo) cuyo texto empieza en `textLeft`. */
function block(opts: { heading?: number; fontSize: number; lineHeight: number; editorLeft: number; textLeft: number; top?: number }) {
  const editor = document.createElement('div');
  editor.className = 'bn-editor';
  const container = document.createElement('div');
  container.setAttribute('data-node-type', 'blockContainer');
  const content = document.createElement('div');
  content.className = 'bn-block-content';
  const text = document.createElement(opts.heading ? `h${opts.heading}` : 'p');
  if (!opts.heading) text.className = 'bn-inline-content';
  text.style.fontSize = `${opts.fontSize}px`;
  text.style.lineHeight = `${opts.lineHeight}px`;
  content.appendChild(text);
  container.appendChild(content);
  editor.appendChild(container);
  document.body.appendChild(editor);
  const top = opts.top ?? 100;
  rect(editor, opts.editorLeft, 0, 800, 1000);
  // Dos renglones: se centra en el primero.
  rect(text, opts.textLeft, top, 400, opts.lineHeight * 2);
  return { editor, container, text, top };
}

/** El dibujo del triángulo donde lo pone CollapseToggles.tsx: centrado en su zona del clic. */
function drawnTriangle(box: ReturnType<typeof triangleBox>) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.appendChild(svg);
  rect(svg, box.left + box.box / 2 - box.size / 2, box.top + box.box / 2 - box.size / 2, box.size, box.size);
  return svg;
}

describe('el triángulo de un título', () => {
  it('crece con el título: la mitad del cuerpo, entre 10 y 20 px', () => {
    const sizes = [14, 22, 32, 48].map((fontSize) => triangleBox(block({ heading: 2, fontSize, lineHeight: fontSize * 1.3, editorLeft: 0, textLeft: 60 }).text, 0).size);
    expect(sizes).toEqual([10, 11, 16, 20]);
  });

  it(`queda a ${GUTTER_GAP} px del texto a la vista, centrado en el primer renglón, sin pisar el texto`, () => {
    const { text, top } = block({ heading: 1, fontSize: 32, lineHeight: 40, editorLeft: 100, textLeft: 160 });
    const g = triangleBox(text, 100);
    const svg = drawnTriangle(g);
    // El triángulo abierto (apunta abajo) ocupa del 10 % al 90 % del ancho de su dibujo.
    const visibleRight = svg.getBoundingClientRect().left + svg.getBoundingClientRect().width * 0.9;
    expect(160 - visibleRight).toBeCloseTo(GUTTER_GAP, 5);
    expect(g.top + g.box / 2).toBeCloseTo(top + 20, 5);
    expect(g.left + g.box).toBeLessThanOrEqual(160);
    expect(g.left).toBeGreaterThanOrEqual(100);
  });

  it('en el teléfono (20 px de margen) se achica y entra entero en el margen', () => {
    const { text } = block({ heading: 1, fontSize: 28, lineHeight: 36, editorLeft: 0, textLeft: 20 });
    const g = triangleBox(text, 0);
    expect(g.box).toBeLessThanOrEqual(20);
    expect(g.size).toBeLessThanOrEqual(g.box - 4);
    expect(g.left).toBeGreaterThanOrEqual(0);
    expect(g.left + g.box).toBeLessThanOrEqual(20);
  });
});

describe('los puntos', () => {
  it('en un título: [puntos] [triángulo] [texto] con el mismo espacio y a la misma altura', () => {
    const { container, text, top } = block({ heading: 2, fontSize: 24, lineHeight: 32, editorLeft: 0, textLeft: 60 });
    const g = triangleBox(text, 0);
    const svg = drawnTriangle(g);
    const place = handlePlace(container, svg)!;
    // Los puntos van a 1 px del borde derecho de su botón.
    const dotsRight = place.right - 1;
    const triLeft = triangleVisibleLeft(svg);
    const triRight = svg.getBoundingClientRect().left + svg.getBoundingClientRect().width * 0.9;
    expect(triLeft - dotsRight).toBeCloseTo(GUTTER_GAP, 5);
    expect(60 - triRight).toBeCloseTo(GUTTER_GAP, 5);
    expect(place.centerY).toBeCloseTo(top + 16, 5);
    expect(g.top + g.box / 2).toBeCloseTo(place.centerY, 5);
    expect(place.fits).toBe(true);
  });

  it(`en un párrafo: a ${GUTTER_GAP} px del texto, centrados en el primer renglón`, () => {
    const { container, top } = block({ fontSize: 16, lineHeight: 24, editorLeft: 0, textLeft: 54 });
    const place = handlePlace(container, null)!;
    expect(54 - (place.right - 1)).toBeCloseTo(GUTTER_GAP, 5);
    expect(place.centerY).toBeCloseTo(top + 12, 5);
    expect(place.fits).toBe(true);
  });

  it('en un título del teléfono no entran al lado del triángulo (va solo el triángulo); en un párrafo sí', () => {
    const heading = block({ heading: 1, fontSize: 28, lineHeight: 36, editorLeft: 0, textLeft: 20 });
    const svg = drawnTriangle(triangleBox(heading.text, 0));
    expect(handlePlace(heading.container, svg)!.fits).toBe(false);
    document.body.replaceChildren();
    const para = block({ fontSize: 16, lineHeight: 24, editorLeft: 0, textLeft: 20 });
    const place = handlePlace(para.container, null)!;
    expect(place.fits).toBe(true);
    expect(place.right - DOTS_BUTTON.width).toBeGreaterThanOrEqual(0);
  });
});
