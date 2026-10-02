// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readShape, type MarkupFrame, type MarkupShape, type PhotoMarkup } from '../media/markup';
import { contrastInk, createMarkupSvg, drawMarkup, headHalfWidth, headLength, numberInk, wrapLines } from './markupSvg';

// El dibujo de cada forma (Docs/Doc_Anotar_Fotos.md, sección 4): las cuentas de FrameRev a la escala del marco.

const FRAME: MarkupFrame = { v: 1, w: 1920, h: 1080 };

function draw(fields: Record<string, unknown>, options: Parameters<typeof drawMarkup>[2] = {}, frame = FRAME): SVGSVGElement {
  const shape = readShape('s', fields, frame) as MarkupShape;
  const photo: PhotoMarkup = { fileId: '6f1c2a4e-0b7d-4c8e-9f10-112233445566', frame, shapes: [shape], newer: false };
  const svg = createMarkupSvg();
  drawMarkup(svg, photo, options);
  return svg;
}

describe('la flecha', () => {
  it('la cabeza de FrameRev: 4 veces el grosor (mínimo 10 px a 1920), media abertura de 22°', () => {
    expect(headLength(3, 100, 1)).toBe(12);
    expect(headLength(1, 100, 1)).toBe(10);
    expect(headLength(1, 25, 1)).toBe(6);
    expect(headLength(9, 200, 1)).toBe(72);
    // En una foto de 6000 px (3,125 veces la referencia) los mínimos crecen igual.
    expect(headLength(1, 100, 6000 / 1920)).toBeCloseTo(31.25);
    expect(headHalfWidth(12, 3, 1)).toBeCloseTo(Math.max(12 * Math.tan((22 * Math.PI) / 180), 1.5 + 2));
  });

  it('llena: el cuerpo termina en la base y la cabeza es un triángulo del color del trazo', () => {
    const svg = draw({ type: 'arrow', posX: 10, posY: 20, startX: 0, startY: 0, endX: 100, endY: 0, strokeWidth: 3, strokeColor: '#ff3b30' });
    const g = svg.querySelector('g')!;
    expect(g.getAttribute('transform')).toBe('translate(10 20)');
    const shaft = g.querySelector('line')!;
    expect(Number(shaft.getAttribute('x2'))).toBeCloseTo(100 - 12 * 0.9);
    const tri = g.querySelector('polygon')!;
    expect(tri.getAttribute('fill')).toBe('#FF3B30');
    expect(tri.getAttribute('points')!.split(' ')[1]).toBe('100,0');
  });

  it('abierta en las dos puntas: dos V y el cuerpo entero', () => {
    const svg = draw({ type: 'arrow', startX: 0, startY: 0, endX: 100, endY: 0, headStyle: 1, headPosition: 1 });
    expect(svg.querySelectorAll('polyline').length).toBe(2);
    expect(svg.querySelectorAll('polygon').length).toBe(0);
    const shaft = svg.querySelector('line')!;
    expect([shaft.getAttribute('x1'), shaft.getAttribute('x2')]).toEqual(['0', '100']);
  });

  it('Banner (todavía no en la web) se dibuja como la llena', () => {
    const svg = draw({ type: 'arrow', startX: 0, startY: 0, endX: 100, endY: 0, headStyle: 2 });
    expect(svg.querySelectorAll('polygon').length).toBe(1);
  });
});

describe('texto y número', () => {
  it('la tinta automática con el umbral de FrameRev (128) y la del número (0,6)', () => {
    expect(contrastInk('#FFD60A')).toBe('#000000');
    expect(contrastInk('#0A84FF')).toBe('#FFFFFF');
    expect(contrastInk('#828282')).toBe('#000000');
    expect(contrastInk('#7D7D7D')).toBe('#FFFFFF');
    expect(numberInk('#85DC53')).toBe('#000000');
    expect(numberInk('#808080')).toBe('#FFFFFF');
  });

  it('con caja y fondo: la tinta por contraste y el texto recortado en la caja; sin fondo, el color del trazo', () => {
    const boxed = draw({ type: 'text', text: 'Hola', rectX: 0, rectY: 0, rectW: 200, rectH: 50, fillMode: 3, fillColor: '#000000', padding: 6 });
    expect(boxed.querySelector('rect')!.getAttribute('fill')).toBe('#000000');
    const clip = boxed.querySelector('g > svg')!;
    expect(clip.getAttribute('overflow')).toBe('hidden');
    expect(clip.querySelector('text')!.getAttribute('fill')).toBe('#FFFFFF');
    const plain = draw({ type: 'text', text: 'Hola', strokeColor: '#ff2daa' });
    expect(plain.querySelector('rect')).toBeNull();
    expect(plain.querySelector('text')!.getAttribute('fill')).toBe('#FF2DAA');
    const chosen = draw({ type: 'text', text: 'Hola', textColor: '#32d7f0', fillMode: 3 });
    expect(chosen.querySelector('text')!.getAttribute('fill')).toBe('#32D7F0');
  });

  it('los renglones: los saltos del texto y, si se puede medir, el ancho de la caja', () => {
    expect(wrapLines('uno\ndos', null, '', null)).toEqual(['uno', 'dos']);
    const measure = (t: string) => t.length * 10;
    expect(wrapLines('borrar el poste de luz', 100, '', measure)).toEqual(['borrar el', 'poste de', 'luz']);
    const svg = draw({ type: 'text', text: 'borrar el poste\nde luz', rectX: 0, rectY: 0, rectW: 100, rectH: 400, fontSize: 20 }, { measure });
    expect([...svg.querySelectorAll('tspan')].map((t) => t.textContent)).toEqual(['borrar el', 'poste', 'de luz']);
  });

  it('el número: un círculo relleno con su número; sin caja, del doble de la letra', () => {
    const svg = draw({ type: 'numbered_marker', number: 7, fontSize: 16 });
    const e = svg.querySelector('ellipse')!;
    expect([e.getAttribute('rx'), e.getAttribute('ry')]).toEqual(['16', '16']);
    expect(e.getAttribute('fill')).toBe('#85DC53');
    expect(svg.querySelector('text')!.textContent).toBe('7');
  });
});

describe('trazos', () => {
  it('el grosor nunca por debajo del mínimo de pantalla (salvo 0: sin trazo)', () => {
    const thin = draw({ type: 'line', startX: 0, startY: 0, endX: 10, endY: 0, strokeWidth: 3 }, { minStroke: 20 });
    expect(thin.querySelector('line')!.getAttribute('stroke-width')).toBe('20');
    const none = draw({ type: 'rectangle', rectX: 0, rectY: 0, rectW: 10, rectH: 10, strokeWidth: 0 }, { minStroke: 20 });
    expect(none.querySelector('rect')!.getAttribute('stroke')).toBe('none');
  });

  it('el marcador: semitransparente y grueso por defecto (18 px a 1920, al 50 %)', () => {
    const svg = draw({ type: 'freehand_marker', points: [0, 0, 10, 10, 20, 0] });
    const line = svg.querySelector('polyline')!;
    expect([line.getAttribute('stroke-width'), line.getAttribute('stroke-opacity')]).toEqual(['18', '0.5']);
  });

  it('un toque sin mover del lápiz es un punto', () => {
    const svg = draw({ type: 'freehand_pencil', points: [5, 5] });
    expect(svg.querySelector('circle')!.getAttribute('r')).toBe('1.5');
  });

  it('los modos de relleno de FrameRev (0 nada, 1 trazo, 2 trazo y relleno, 3 relleno)', () => {
    const modes = [0, 1, 2, 3].map((fillMode) => {
      const r = draw({ type: 'rectangle', rectX: 0, rectY: 0, rectW: 10, rectH: 10, fillMode, fillOpacity: 60 }).querySelector('rect')!;
      return [r.getAttribute('stroke') !== 'none', r.getAttribute('fill') !== 'none'];
    });
    expect(modes).toEqual([
      [false, false],
      [true, false],
      [true, true],
      [false, true],
    ]);
  });

  it('girada: alrededor del centro de su caja (como FrameRev)', () => {
    const svg = draw({ type: 'rectangle', posX: 100, posY: 50, rectX: 0, rectY: 0, rectW: 40, rectH: 20, rotation: 450 });
    expect(svg.querySelector('g')!.getAttribute('transform')).toBe('translate(100 50) rotate(90 20 10)');
  });
});
