import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addShape, deleteShape, PHOTO_MARKUP_MAP } from '../media/markup';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { annotationUnitsFromYDoc } from './annotationExtract';

const A = '12345678-1234-1234-1234-123456789001';
const B = '12345678-1234-1234-1234-123456789002';
const C = '12345678-1234-1234-1234-123456789003';
const fields = (text: string) => ({ type: 'text', text, posX: 20, posY: 20, rectX: 0, rectY: 0, rectW: 5, rectH: 5, fontSize: 32 });
const el = (type: string, attrs: Record<string, string> = {}, children: Y.XmlElement[] = []) => {
  const node = new Y.XmlElement(type);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.insert(0, children);
  return node;
};
const photo = (id: string, type = 'photo') => el(type, { url: `sdmedia://${id}` });
const block = (id: string, node: Y.XmlElement, nested: Y.XmlElement[] = []) => el('blockContainer', { id }, [node, ...(nested.length ? [el('blockGroup', {}, nested)] : [])]);
const setup = (blocks: Y.XmlElement[]) => {
  const doc = new Y.Doc();
  doc.getXmlFragment(CONTENT_FRAGMENT).insert(0, [el('blockGroup', {}, blocks)]);
  for (const id of [A, B, C]) addShape(doc, id, 'label', fields(`Cámara ${id.slice(-1)} clipped`), { w: 640, h: 480 });
  return doc;
};

describe('texto guardado de anotaciones de fotos actuales', () => {
  it('bloque, fotos en línea, celdas y anidados; una unidad por UUID/forma en orden actual', () => {
    const doc = setup([
      block('image', photo(A, 'image')),
      block('inline', el('paragraph', {}, [photo(A), photo(B)])),
      block('table', el('table', {}, [el('tableRow', {}, [el('tableCell', {}, [el('tableParagraph', {}, [photo(C)])])])])),
      block('parent', el('heading'), [block('child', photo(B, 'image'))]),
    ]);
    addShape(doc, A, 'above', { ...fields('Otro texto'), zValue: -1 }, { w: 640, h: 480 });
    const before = Y.encodeStateAsUpdate(doc);
    const updates: Uint8Array[] = [];
    doc.on('update', (u: Uint8Array) => updates.push(u));
    const units = annotationUnitsFromYDoc(doc);
    expect(units.map(({ blockId, fileId, shapeId }) => [blockId, fileId, shapeId])).toEqual([
      ['image', A, 'above'], ['image', A, 'label'], ['inline', B, 'label'], ['table', C, 'label'],
    ]);
    expect(units[1].text).toContain('clipped');
    expect(updates).toEqual([]);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    doc.destroy();
  });

  it('retirar la referencia o la forma saca el resultado sin podar el mapa', () => {
    const doc = setup([block('image', photo(A, 'image'))]);
    expect(annotationUnitsFromYDoc(doc)).toHaveLength(1);
    const map = doc.getMap(PHOTO_MARKUP_MAP);
    const original = JSON.stringify(map.toJSON());
    doc.getXmlFragment(CONTENT_FRAGMENT).delete(0, 1);
    expect(annotationUnitsFromYDoc(doc)).toEqual([]);
    expect(JSON.stringify(map.toJSON())).toBe(original);
    doc.getXmlFragment(CONTENT_FRAGMENT).insert(0, [el('blockGroup', {}, [block('restored', photo(A, 'image'))])]);
    deleteShape(doc, A, 'label');
    expect(annotationUnitsFromYDoc(doc)).toEqual([]);
    doc.destroy();
  });

  it('no interpreta tipos futuros, URLs externas, sdfile ni mapas huérfanos', () => {
    const doc = setup([
      block('future', el('futureBlock', {}, [photo(A)])),
      block('external', el('image', { url: `https://example.invalid/${A}` })),
      block('file', el('image', { url: `sdfile://${B}` })),
      block('unknown-inline', el('paragraph', {}, [el('futurePhoto', { url: `sdmedia://${C}` })])),
    ]);
    expect(annotationUnitsFromYDoc(doc)).toEqual([]);
    doc.destroy();
  });

  it('reusa el lector: tipos inválidos, texto vacío y marco inválido quedan fuera; newer conserva lo conocido', () => {
    const doc = setup([block('a', photo(A, 'image')), block('b', photo(B, 'image'))]);
    const map = doc.getMap(PHOTO_MARKUP_MAP);
    map.set(B, { v: 1, w: 0, h: 480 });
    map.set(A, { v: 7, w: 640, h: 480 });
    addShape(doc, A, 'unknown', { type: 'future', text: 'No buscar' }, { w: 640, h: 480 });
    addShape(doc, A, 'empty', fields('   '), { w: 640, h: 480 });
    map.set(A, { v: 7, w: 640, h: 480 });
    expect(annotationUnitsFromYDoc(doc).map((u) => u.shapeId)).toEqual(['label']);
    doc.destroy();
  });
});
