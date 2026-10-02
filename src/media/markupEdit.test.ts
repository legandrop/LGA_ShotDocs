import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addShape, PHOTO_MARKUP_MAP, readPhotoMarkup, readShape, type LineShape, type MarkupFrame, type MarkupShape } from './markup';
import {
  boxShape,
  cleanStyle,
  cleanStyles,
  controlsOf,
  DEFAULT_STYLES,
  dragLine,
  dragRect,
  fromFrame,
  handleFields,
  handlesOf,
  hitTest,
  lineShape,
  moveFields,
  nextNumber,
  numberShape,
  pushRecent,
  relativePoints,
  restyleFields,
  roughMeasure,
  shapeBounds,
  shapesInRect,
  simplify,
  snap45,
  strokeShape,
  styleFields,
  styleOfShape,
  textEdit,
  textShape,
  toFrame,
  TOOL_LETTERS,
  TOOLS,
  topZ,
  unitOf,
} from './markupEdit';

// El anotador sin pantalla (P.20, entrega 2; Docs/Doc_Anotar_Fotos.md): herramientas y letras de FrameRev, los valores
// de fábrica, el grosor contra la referencia de 1920 px (AN7), Shift y Alt, el lápiz simplificado, qué hay bajo el
// cursor y que editar escriba solo lo que cambia.

const F1920: MarkupFrame = { v: 1, w: 1920, h: 1080 };
const F6000: MarkupFrame = { v: 1, w: 6000, h: 4000 };
const read = (fields: Record<string, unknown>, frame = F6000, id = 's') => readShape(id, fields, frame)!;

describe('herramientas, letras y valores de fábrica (FrameRev)', () => {
  it('las nueve de AN5, en el orden de la barra, con las letras V R E A L P M T N', () => {
    expect(TOOLS).toEqual(['select', 'rectangle', 'ellipse', 'arrow', 'line', 'pencil', 'marker', 'text', 'number']);
    expect(TOOLS.map((t) => TOOL_LETTERS[t]).join('')).toBe('vrealpmtn');
  });

  it('verde #85DC53 en todas; trazo 3; Marker 18 al 50 %; texto 24 y número 16; relleno apagado salvo texto y número', () => {
    for (const s of Object.values(DEFAULT_STYLES)) expect(s.color).toBe('#85DC53');
    expect(DEFAULT_STYLES.arrow).toMatchObject({ width: 3, opacity: 100, fill: false });
    expect(DEFAULT_STYLES.marker).toMatchObject({ width: 18, opacity: 50 });
    expect(DEFAULT_STYLES.text).toMatchObject({ fontSize: 24, fillOpacity: 100, fill: false });
    expect(DEFAULT_STYLES.number).toMatchObject({ fontSize: 16, fillOpacity: 100 });
  });

  it('el estilo guardado en el dispositivo se limpia: un valor roto vuelve al de fábrica de esa herramienta', () => {
    expect(cleanStyle({ color: 'red; x', width: -5, opacity: 900, fill: 'sí', headStyle: 7, fontSize: 1e9 }, 'marker')).toEqual({
      ...DEFAULT_STYLES.marker,
      width: 0,
      opacity: 100,
      fontSize: 400,
    });
    const all = cleanStyles({ arrow: { color: '#ff3b30', width: 9 }, ellipse: 'x', __proto__: { text: { color: '#000000' } } });
    expect(all.arrow).toMatchObject({ color: '#FF3B30', width: 9 });
    // Elegir rojo en Arrow no tiñe Ellipse.
    expect(all.ellipse).toEqual(DEFAULT_STYLES.ellipse);
    expect(all.text).toEqual(DEFAULT_STYLES.text);
    expect(cleanStyles(null).pencil).toEqual(DEFAULT_STYLES.pencil);
  });

  it('los recientes: el nuevo adelante, sin repetir, como mucho 8, y solo colores #RRGGBB', () => {
    let r: string[] = [];
    for (const c of ['#111111', '#222222', '#111111', 'url(x)', '#333333']) r = pushRecent(r, c);
    expect(r).toEqual(['#333333', '#111111', '#222222']);
    for (let i = 0; i < 20; i++) r = pushRecent(r, `#0000${String(i).padStart(2, '0')}`);
    expect(r.length).toBe(8);
  });

  it('qué controles muestra la franja', () => {
    expect(controlsOf('rectangle')).toEqual({ width: true, fill: 'shape', arrow: false, font: false });
    expect(controlsOf('arrow')).toMatchObject({ arrow: true });
    expect(controlsOf('text')).toEqual({ width: false, fill: 'box', arrow: false, font: true });
    expect(controlsOf('number')).toMatchObject({ width: false, font: true });
  });
});

describe('AN7: el grosor y la letra contra el lado largo llevado a 1920 px', () => {
  it('en una captura de 1920 es FrameRev tal cual; en una foto de 6000, un 3 guarda 9,38', () => {
    expect(unitOf(F1920)).toBe(1);
    expect(toFrame(3, F1920)).toBe(3);
    expect(toFrame(3, F6000)).toBe(9.38);
    expect(fromFrame(9.38, F6000)).toBe(3);
    // Vertical: manda el lado largo.
    expect(unitOf({ w: 3000, h: 6000 })).toBe(3.125);
  });

  it('el mismo número da el mismo trazo visto en la foto, sea cual sea su resolución (incluso el marco de la miniatura)', () => {
    const big = styleFields('arrow', DEFAULT_STYLES.arrow, F6000).strokeWidth as number;
    const thumb = styleFields('arrow', DEFAULT_STYLES.arrow, { v: 1, w: 480, h: 320 }).strokeWidth as number;
    expect(big / 6000).toBeCloseTo(thumb / 480, 4);
  });

  it('los campos que se guardan son los del .frproj v2, en píxeles del marco', () => {
    const red = { ...DEFAULT_STYLES.arrow, color: '#FF3B30', headStyle: 1 as const, headPosition: 1 as const };
    expect(styleFields('arrow', red, F6000)).toEqual({ strokeColor: '#FF3B30', strokeWidth: 9.38, strokeOpacity: 100, headStyle: 1, headPosition: 1, arrowHeadSize: 100 });
    expect(styleFields('rectangle', { ...DEFAULT_STYLES.rectangle, fill: true }, F1920)).toMatchObject({ fillMode: 2, fillColor: '#85DC53', fillOpacity: 40 });
    expect(styleFields('ellipse', DEFAULT_STYLES.ellipse, F1920)).toMatchObject({ fillMode: 1 });
    expect(styleFields('text', DEFAULT_STYLES.text, F6000)).toMatchObject({ fillMode: 0, fontSize: 75 });
    expect(styleFields('text', { ...DEFAULT_STYLES.text, fill: true }, F1920)).toMatchObject({ fillMode: 3, cornerRadius: 12 });
    expect(styleFields('marker', DEFAULT_STYLES.marker, F1920)).toEqual({ strokeColor: '#85DC53', strokeWidth: 18, strokeOpacity: 50 });
  });
});

describe('Shift y Alt (como FrameRev y Photoshop)', () => {
  const a = { x: 100, y: 100 };
  it('rectángulo y elipse: normal, cuadrado con Shift, desde el centro con Alt, y los dos', () => {
    expect(dragRect(a, { x: 300, y: 160 }, { shift: false, alt: false })).toEqual({ x: 100, y: 100, w: 200, h: 60 });
    expect(dragRect(a, { x: 300, y: 160 }, { shift: true, alt: false })).toEqual({ x: 100, y: 100, w: 200, h: 200 });
    expect(dragRect(a, { x: 300, y: 160 }, { shift: false, alt: true })).toEqual({ x: -100, y: 40, w: 400, h: 120 });
    expect(dragRect(a, { x: 300, y: 160 }, { shift: true, alt: true })).toEqual({ x: -100, y: -100, w: 400, h: 400 });
    // Hacia arriba y a la izquierda: normalizado.
    expect(dragRect(a, { x: 40, y: 20 }, { shift: false, alt: false })).toEqual({ x: 40, y: 20, w: 60, h: 80 });
  });

  it('flecha y línea: de a 45° con Shift (mismo largo), desde el centro con Alt', () => {
    const p = snap45(a, { x: 200, y: 110 });
    expect(p.x).toBeCloseTo(200.5, 1);
    expect(p.y).toBeCloseTo(100, 6);
    const diag = snap45(a, { x: 190, y: 210 });
    expect(diag.x - a.x).toBeCloseTo(diag.y - a.y, 6);
    expect(Math.hypot(diag.x - a.x, diag.y - a.y)).toBeCloseTo(Math.hypot(90, 110), 6);
    expect(dragLine(a, { x: 150, y: 120 }, { shift: false, alt: true })).toEqual({ start: { x: 50, y: 80 }, end: { x: 150, y: 120 } });
  });
});

describe('el lápiz: simplificado al soltar, relativo y redondeado', () => {
  it('una recta con ruido de menos de medio píxel queda en sus dos puntas', () => {
    const pts: number[] = [];
    for (let i = 0; i <= 100; i++) pts.push(i * 10, 500 + (i % 2 ? 0.2 : -0.2));
    const out = simplify(pts, 0.5);
    expect(out).toEqual([0, 499.8, 1000, 499.8]);
  });

  it('las esquinas se quedan; un trazo de 50 000 puntos no llena la pila', () => {
    expect(simplify([0, 0, 50, 0, 100, 0, 100, 50, 100, 100], 0.5)).toEqual([0, 0, 100, 0, 100, 100]);
    const many: number[] = [];
    for (let i = 0; i < 50_000; i++) many.push(i, Math.sin(i / 50) * 100);
    const out = simplify(many, 0.5);
    expect(out.length).toBeLessThan(many.length / 4);
    expect(out.slice(0, 2)).toEqual([0, 0]);
  });

  it('relativo al primer punto, al píxel del marco, con el tope de 5000 puntos; un toque es un punto', () => {
    expect(relativePoints([10.4, 20.6, 15.2, 25.9])).toEqual({ posX: 10, posY: 21, points: [0, 0, 5, 5] });
    expect(relativePoints([10, 20, 10.2, 20.1]).points).toEqual([0, 0]);
    const long: number[] = [];
    for (let i = 0; i < 7000; i++) long.push(i, i);
    expect(relativePoints(long).points.length).toBe(10_000);
    const s = strokeShape('marker', [100, 100, 200, 150], DEFAULT_STYLES.marker, F1920, 3);
    expect(s).toMatchObject({ type: 'freehand_marker', zValue: 3, posX: 100, posY: 100, points: [0, 0, 100, 50], strokeWidth: 18, strokeOpacity: 50 });
  });
});

describe('formas nuevas', () => {
  it('cada herramienta guarda lo que dibuja la entrega 1 en el mismo lugar', () => {
    const rect = read(boxShape('rectangle', { x: 10, y: 20, w: 300, h: 200 }, DEFAULT_STYLES.rectangle, F6000, 1));
    expect(shapeBounds(rect)).toEqual({ x: 10, y: 20, w: 300, h: 200 });
    const arrow = read(lineShape('arrow', { x: 100, y: 100 }, { x: 400, y: 300 }, DEFAULT_STYLES.arrow, F6000, 2)) as LineShape;
    expect([arrow.posX + arrow.end[0], arrow.posY + arrow.end[1]]).toEqual([400, 300]);
    expect(arrow.headPosition).toBe(2);
    const n = read(numberShape({ x: 500, y: 500 }, 4, DEFAULT_STYLES.number, F1920, 3), F1920);
    expect(shapeBounds(n)).toEqual({ x: 484, y: 484, w: 32, h: 32 });
  });

  it('el texto: la primera letra donde se hizo clic, la caja con holgura y el relleno; editarlo solo cambia texto y caja', () => {
    const fields = textShape({ x: 200, y: 100 }, 'Borrar\ncable', DEFAULT_STYLES.text, F1920, 5, roughMeasure, '24px x');
    const s = read(fields, F1920);
    expect(s.type).toBe('text');
    if (s.type !== 'text') return;
    expect(s.posX + s.padding).toBeCloseTo(200, 6);
    expect(s.posY + s.padding).toBeCloseTo(100, 6);
    // 6 letras × 24 × 0,6 = 86,4, +10 %, + relleno a los dos lados.
    expect(s.rect!.w).toBeCloseTo(86.4 * 1.1 + 2 * 7.2, 1);
    expect(s.rect!.h).toBeCloseTo(2 * 24 * 1.25 + 2 * 7.2, 1);
    const edit = textEdit('Borrar el cable del poste', 24, roughMeasure, '24px x');
    expect(Object.keys(edit).sort()).toEqual(['padding', 'rectH', 'rectW', 'rectX', 'rectY', 'text']);
    // El tope de 2000 letras, sin partir un emoji.
    expect(Array.from(textShape({ x: 0, y: 0 }, '😀'.repeat(2500), DEFAULT_STYLES.text, F1920, 1, roughMeasure, 'x').text as string).length).toBe(2000);
  });

  it('número: el más alto + 1; zValue: arriba de todas', () => {
    const doc = new Y.Doc();
    const id = '0f8fad5b-d9cb-469f-a165-708677289501';
    addShape(doc, id, 'a', { type: 'numbered_marker', zValue: 2, posX: 1, posY: 1, number: 7 }, F1920);
    addShape(doc, id, 'b', { type: 'line', zValue: 9.5, posX: 1, posY: 1, startX: 0, startY: 0, endX: 5, endY: 5 });
    const shapes = readPhotoMarkup(doc.getMap(PHOTO_MARKUP_MAP), id)!.shapes;
    expect(nextNumber(shapes)).toBe(8);
    expect(nextNumber([])).toBe(1);
    expect(topZ(shapes)).toBe(10);
  });
});

describe('qué hay bajo el cursor', () => {
  const shapes: MarkupShape[] = [
    read(boxShape('rectangle', { x: 100, y: 100, w: 400, h: 300 }, DEFAULT_STYLES.rectangle, F1920, 1), F1920, 'rect'),
    read(boxShape('ellipse', { x: 1000, y: 100, w: 200, h: 200 }, DEFAULT_STYLES.ellipse, F1920, 2), F1920, 'ell'),
    read(lineShape('line', { x: 100, y: 800 }, { x: 900, y: 800 }, DEFAULT_STYLES.line, F1920, 3), F1920, 'line'),
    read(strokeShape('pencil', [1300, 700, 1400, 800, 1500, 700], DEFAULT_STYLES.pencil, F1920, 4), F1920, 'pen'),
    read(numberShape({ x: 1700, y: 900 }, 1, DEFAULT_STYLES.number, F1920, 5), F1920, 'num'),
  ];
  it('el borde de un rectángulo sin relleno, no su centro; con relleno, también el centro', () => {
    expect(hitTest(shapes, { x: 101, y: 250 }, 4)?.id).toBe('rect');
    expect(hitTest(shapes, { x: 300, y: 250 }, 4)).toBeNull();
    const filled = [read({ ...boxShape('rectangle', { x: 100, y: 100, w: 400, h: 300 }, { ...DEFAULT_STYLES.rectangle, fill: true }, F1920, 1) }, F1920, 'f')];
    expect(hitTest(filled, { x: 300, y: 250 }, 4)?.id).toBe('f');
  });

  it('la elipse por su aro, la línea y el lápiz cerca del trazo, el número adentro de su círculo; la de más arriba gana', () => {
    expect(hitTest(shapes, { x: 1000, y: 200 }, 4)?.id).toBe('ell');
    expect(hitTest(shapes, { x: 1100, y: 200 }, 4)).toBeNull();
    expect(hitTest(shapes, { x: 500, y: 803 }, 4)?.id).toBe('line');
    expect(hitTest(shapes, { x: 500, y: 820 }, 4)).toBeNull();
    expect(hitTest(shapes, { x: 1350, y: 751 }, 4)?.id).toBe('pen');
    expect(hitTest(shapes, { x: 1705, y: 905 }, 4)?.id).toBe('num');
    const top = read(boxShape('rectangle', { x: 90, y: 90, w: 30, h: 30 }, { ...DEFAULT_STYLES.rectangle, fill: true }, F1920, 9), F1920, 'top');
    expect(hitTest([...shapes, top], { x: 101, y: 101 }, 4)?.id).toBe('top');
  });

  it('el recuadro elige lo que toca', () => {
    expect(shapesInRect(shapes, { x: 0, y: 0, w: 1250, h: 450 }).map((s) => s.id)).toEqual(['rect', 'ell']);
    expect(shapesInRect(shapes, { x: 1650, y: 850, w: 50, h: 50 }).map((s) => s.id)).toEqual(['num']);
  });
});

describe('editar escribe solo lo que cambia (una propiedad por clave)', () => {
  const rect = read(boxShape('rectangle', { x: 100, y: 100, w: 400, h: 300 }, DEFAULT_STYLES.rectangle, F1920, 1), F1920, 'r');
  const arrow = read(lineShape('arrow', { x: 100, y: 100 }, { x: 500, y: 100 }, DEFAULT_STYLES.arrow, F1920, 2), F1920, 'a');

  it('mover: solo posX y posY', () => {
    expect(moveFields(rect, 10.123, -5)).toEqual({ posX: 110.12, posY: 95 });
  });

  it('los tiradores: la esquina opuesta queda quieta; en la flecha, el otro extremo (Shift: 45°)', () => {
    expect(handlesOf(rect).map((h) => h.handle)).toEqual(['nw', 'ne', 'sw', 'se']);
    expect(handleFields(rect, 'se', { x: 600, y: 500 }, { shift: false, alt: false })).toEqual({ posX: 100, posY: 100, rectX: 0, rectY: 0, rectW: 500, rectH: 400 });
    expect(handleFields(rect, 'nw', { x: 50, y: 50 }, { shift: false, alt: false })).toEqual({ posX: 50, posY: 50, rectX: 0, rectY: 0, rectW: 450, rectH: 350 });
    const end = handleFields(arrow, 'end', { x: 400, y: 390 }, { shift: true, alt: false });
    expect(end.posX).toBe(100);
    expect(end.endX as number).toBeCloseTo(end.endY as number, 1);
    const start = handleFields(arrow, 'start', { x: 0, y: 0 }, { shift: false, alt: false });
    expect(start).toEqual({ posX: 0, posY: 0, startX: 0, startY: 0, endX: 500, endY: 100 });
    expect(handlesOf(read(strokeShape('pencil', [0, 0, 5, 5], DEFAULT_STYLES.pencil, F1920, 1), F1920))).toEqual([]);
  });

  it('el estilo: el color escribe el color (y el relleno donde corresponde); el grosor, el grosor', () => {
    expect(restyleFields(arrow, { color: '#FF3B30' }, F1920)).toEqual({ strokeColor: '#FF3B30' });
    expect(restyleFields(rect, { color: '#FF3B30' }, F1920)).toEqual({ strokeColor: '#FF3B30', fillColor: '#FF3B30' });
    expect(restyleFields(rect, { width: 6 }, F6000)).toEqual({ strokeWidth: 18.75 });
    expect(restyleFields(rect, { headStyle: 1, fontSize: 30 }, F1920)).toEqual({});
    expect(restyleFields(arrow, { headPosition: 1 }, F1920)).toEqual({ headPosition: 1 });
    expect(styleOfShape(read(lineShape('arrow', { x: 0, y: 0 }, { x: 9, y: 9 }, { ...DEFAULT_STYLES.arrow, width: 7 }, F6000, 1)), F6000)).toMatchObject({ width: 7, headStyle: 0, headPosition: 2 });
  });
});
