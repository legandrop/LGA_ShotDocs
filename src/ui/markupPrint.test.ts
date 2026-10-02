// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { addShape, PHOTO_MARKUP_MAP } from '../media/markup';
import { attachMarkupOverlay, fitPrintedMarkup } from './markupOverlay';

// El grosor mínimo de 1 px en el PDF (roadmap, auditoría O2 de la entrega 1): la copia de impresión traía el `<svg>`
// dibujado con el mínimo de la caja en PANTALLA. Ahora se redibuja con el de su caja impresa, y una foto que en
// pantalla no tenía dibujo (la imagen no había cargado) lo tiene en el papel.

const ID = '0f8fad5b-d9cb-469f-a165-708677289501';

function photoDom(): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = `<p><span class="sd-photo" data-url="sdmedia://${ID}"><img class="bn-visual-media" src="blob:x"></span></p>`;
  document.body.append(root);
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('las anotaciones en la vista de impresión', () => {
  it('se redibujan con el mínimo de 1 px de la caja impresa (no el de la pantalla)', () => {
    const doc = new Y.Doc();
    // Un trazo finísimo: 0,5 px del marco en una foto de 4000 de ancho.
    addShape(doc, ID, 'l', { type: 'line', zValue: 1, posX: 0, posY: 0, startX: 0, startY: 0, endX: 4000, endY: 0, strokeWidth: 0.5 }, { w: 4000, h: 3000 });
    // En pantalla (un teléfono), la foto mide 100 px: el mínimo es 40 unidades del marco.
    const width = new Map<Element, number>();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const w = width.get(this) ?? 0;
      return { x: 0, y: 0, left: 0, top: 0, width: w, height: (w * 3) / 4, right: w, bottom: (w * 3) / 4, toJSON: () => ({}) } as DOMRect;
    });
    const live = photoDom();
    width.set(live.querySelector('.sd-photo')!, 100);
    const overlay = attachMarkupOverlay(live, doc.getMap(PHOTO_MARKUP_MAP));
    overlay.flush();
    const screenLine = live.querySelector('svg.sd-markup line')!;
    expect(Number(screenLine.getAttribute('stroke-width'))).toBeCloseTo(40, 3);
    // La copia de impresión: la misma foto, a 500 px en la hoja.
    const print = live.cloneNode(true) as HTMLElement;
    document.body.append(print);
    width.set(print.querySelector('.sd-photo')!, 500);
    fitPrintedMarkup(print);
    expect(Number(print.querySelector('svg.sd-markup line')!.getAttribute('stroke-width'))).toBeCloseTo(8, 3);
    // Una foto que en pantalla no tenía dibujo lo tiene en la copia.
    print.querySelector('svg.sd-markup')!.remove();
    fitPrintedMarkup(print);
    expect(print.querySelectorAll('svg.sd-markup').length).toBe(1);
    // La tarjeta de la cola (un SVG `data:`) no lleva dibujo, como en pantalla.
    print.querySelector('img')!.setAttribute('src', 'data:image/svg+xml,card');
    fitPrintedMarkup(print);
    expect(print.querySelectorAll('svg.sd-markup').length).toBe(0);
    overlay.stop();
    // Sin una página abierta (nadie que sepa las anotaciones), no toca nada.
    const again = live.cloneNode(true) as HTMLElement;
    fitPrintedMarkup(again);
    expect(again.querySelector('svg.sd-markup line')!.getAttribute('stroke-width')).toBe(screenLine.getAttribute('stroke-width'));
  });
});
