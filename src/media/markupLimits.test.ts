import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addShape, PHOTO_MARKUP_MAP, updateShape } from './markup';
import { DEFAULT_STYLES, lineShape, textShape, roughMeasure } from './markupEdit';
import {
  limitState,
  measureLimits,
  PAGE_BASE_CAP,
  PAGE_MARKUP_CAP,
  pageBaseBytes,
  pageMarkupBytes,
  PHOTO_MARKUP_CAP,
  photoMarkupBytes,
} from './markupLimits';

// Los topes de las anotaciones en bytes codificados (P.20, Docs/Doc_Anotar_Fotos.md, sección 10): por foto, por
// página y la base de la página (que también ve los huecos de lo pisado).

const A = '0f8fad5b-d9cb-469f-a165-708677289501';
const B = '0f8fad5b-d9cb-469f-a165-708677289502';
const FRAME = { v: 1, w: 6000, h: 4000 };

function arrows(doc: Y.Doc, fileId: string, n: number, from = 0) {
  for (let i = from; i < from + n; i++) {
    addShape(doc, fileId, `a${i}`, lineShape('arrow', { x: 100 + i, y: 200 }, { x: 900, y: 700 + i }, DEFAULT_STYLES.arrow, FRAME, i + 1), FRAME);
  }
}

describe('lo que pesan las anotaciones', () => {
  it('por foto: solo sus claves; por página: todas', () => {
    const doc = new Y.Doc();
    const map = doc.getMap<unknown>(PHOTO_MARKUP_MAP);
    expect(photoMarkupBytes(map, A)).toBe(0);
    arrows(doc, A, 10);
    const one = photoMarkupBytes(map, A);
    // Una flecha del anotador pesa unos 300 bytes (la auditoría midió 320 con 12 campos).
    expect(one / 10).toBeGreaterThan(150);
    expect(one / 10).toBeLessThan(400);
    arrows(doc, B, 5);
    expect(photoMarkupBytes(map, A)).toBe(one);
    expect(pageMarkupBytes(map)).toBeGreaterThan(one + photoMarkupBytes(map, B) * 0.9);
  });

  it('lo pisado no pesa en lo vivo pero sí en la base (los huecos): por eso hay tope de base', () => {
    const doc = new Y.Doc();
    const map = doc.getMap<unknown>(PHOTO_MARKUP_MAP);
    arrows(doc, A, 1);
    const live0 = photoMarkupBytes(map, A);
    const base0 = pageBaseBytes(doc);
    for (let i = 0; i < 200; i++) updateShape(doc, A, 'a0', { posX: 100 + i, posY: 200 + i });
    expect(Math.abs(photoMarkupBytes(map, A) - live0)).toBeLessThan(16);
    expect(pageBaseBytes(doc) - base0).toBeGreaterThan(200 * 4);
  });

  it('un mapa con tipos anidados (que la app nunca escribe) se cuenta igual, sin romper', () => {
    const doc = new Y.Doc();
    const map = doc.getMap<unknown>(PHOTO_MARKUP_MAP);
    doc.transact(() => {
      const shape = new Y.Map<unknown>();
      map.set(`${A}/raro`, shape);
      const inner = new Y.Array<number>();
      inner.push([1, 2, 3]);
      shape.set('points', inner);
      map.set(`${A}/texto`, new Y.Text('hola'));
    });
    expect(photoMarkupBytes(map, A)).toBeGreaterThan(0);
  });

  it('el estado de los topes: aviso al 80 %, lleno al 100 %; manda el primero lleno', () => {
    expect(limitState({ photo: 0, page: 0, base: 0 })).toEqual({ state: 'ok', which: null });
    expect(limitState({ photo: PHOTO_MARKUP_CAP * 0.8, page: 0, base: 0 })).toEqual({ state: 'warn', which: 'photo' });
    expect(limitState({ photo: PHOTO_MARKUP_CAP * 0.85, page: PAGE_MARKUP_CAP, base: 0 })).toEqual({ state: 'full', which: 'page' });
    expect(limitState({ photo: 0, page: 0, base: PAGE_BASE_CAP })).toEqual({ state: 'full', which: 'base' });
    expect(PHOTO_MARKUP_CAP).toBe(96 * 1024);
    expect(PAGE_MARKUP_CAP).toBe(512 * 1024);
    expect(PAGE_BASE_CAP).toBe(2.5 * 1024 * 1024);
  });

  it('cuánto entra: unas 300 flechas o 40 textos de 2000 letras por foto (medido)', () => {
    const doc = new Y.Doc();
    let n = 0;
    while (measureLimits(doc, A).photo < PHOTO_MARKUP_CAP) {
      arrows(doc, A, 25, n);
      n += 25;
    }
    expect(n).toBeGreaterThan(200);
    expect(n).toBeLessThan(700);
    const doc2 = new Y.Doc();
    let t = 0;
    while (measureLimits(doc2, B).photo < PHOTO_MARKUP_CAP) {
      addShape(doc2, B, `t${t}`, textShape({ x: 10, y: 10 }, 'x'.repeat(2000), DEFAULT_STYLES.text, FRAME, t + 1, roughMeasure, 'x'), FRAME);
      t++;
    }
    expect(t).toBeGreaterThan(30);
    expect(t).toBeLessThan(60);
  });
});
