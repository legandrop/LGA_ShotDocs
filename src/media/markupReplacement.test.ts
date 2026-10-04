import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { PHOTO_MARKUP_MAP, shapeKey } from './markup';
import { replacementAspect, replacementMarkup, writeReplacementMarkup } from './markupClipboard';

const A = '12345678-1234-1234-1234-123456789012', B = '12345678-1234-1234-1234-123456789013';
function source() {
  const doc = new Y.Doc(), map = doc.getMap<unknown>(PHOTO_MARKUP_MAP);
  map.set(A, { v: 1, w: 4000, h: 3000, future: { frame: ['intacto'] } });
  map.set(shapeKey(A, 'future'), new Y.Map(Object.entries({ type: 'future-tool', caption: 'De otra versión', future: [{ x: 1, unknown: true }] })));
  return { doc, map };
}
describe('Reemplazar con anotaciones, copia completa', () => {
  it('conserva marco y JSON futuro, con formas independientes y origen intacto', () => {
    const { doc, map } = source(), before = map.toJSON();
    const plan = replacementMarkup(map, A)!;
    writeReplacementMarkup(map, B, plan);
    expect(map.get(B)).toEqual(before[A]);
    expect((map.get(shapeKey(B, 'future')) as Y.Map<unknown>).toJSON()).toEqual(before[shapeKey(A, 'future')]);
    (map.get(shapeKey(B, 'future')) as Y.Map<unknown>).set('caption', 'Nueva');
    expect((map.get(shapeKey(A, 'future')) as Y.Map<unknown>).toJSON()).toEqual(before[shapeKey(A, 'future')]);
    expect(map.get(A)).toEqual(before[A]); doc.destroy();
  });
  it('no omite tipos anidados ilegibles ni claves malformadas', () => {
    const { doc, map } = source();
    (map.get(shapeKey(A, 'future')) as Y.Map<unknown>).set('nested', new Y.Map([['secret', 1]]));
    expect(replacementMarkup(map, A)).toBeNull();
    (map.get(shapeKey(A, 'future')) as Y.Map<unknown>).delete('nested');
    map.set(`${A}/bad/extra`, { x: 1 });
    expect(replacementMarkup(map, A)).toBeNull(); doc.destroy();
  });
  it('acepta escalado exacto y rechaza un píxel, fracción, orientación desigual o marco ajeno', () => {
    const { doc, map } = source(), plan = replacementMarkup(map, A)!;
    expect(replacementAspect(plan, { width: 4000, height: 3000 }, { width: 2000, height: 1500 })).toBe(true);
    for (const candidate of [{ width: 2001, height: 1500 }, { width: 2000.1, height: 1500 }, { width: 1500, height: 2000 }, { width: 0, height: 0 }]) expect(replacementAspect(plan, { width: 4000, height: 3000 }, candidate)).toBe(false);
    expect(replacementAspect(plan, { width: 4000, height: 3001 }, { width: 2000, height: 1500 })).toBe(false);
    map.set(A, { v: 1, w: 4000.1, h: 3000 }); expect(replacementMarkup(map, A)).toBeNull(); doc.destroy();
  });
});
