// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { PHOTO_MARKUP_MAP } from '../media/markup';
import { replacementMarkup, writeReplacementMarkup } from '../media/markupClipboard';
import { mediaIdsInDoc } from '../media/usage';
import { mountEditor, unmountAll, view } from './collabHarness';
import { schema as oldSchema } from './fixtures/editorSchemaAnterior';
import { replacementFits } from './photoReplace';

const A = '12345678-1234-1234-1234-123456789012', B = '12345678-1234-1234-1234-123456789013';
afterEach(unmountAll);
describe('Replace con anotaciones y versiones anteriores', () => {
  for (const inline of [false, true]) it(`el esquema anterior conserva referencia ${inline ? 'en línea' : 'de bloque'} y mapa futuro al editar`, () => {
    const doc = new Y.Doc(), editor = mountEditor(doc), map = doc.getMap<unknown>(PHOTO_MARKUP_MAP);
    editor.replaceBlocks(editor.document, [{ id: 'photo', type: inline ? 'paragraph' : 'image', ...(inline ? { content: [{ type: 'photo', props: { url: `sdmedia://${A}`, name: 'Old.png', w: .4 } }] } : { props: { url: `sdmedia://${A}`, name: 'Old.png' } }), }, { id: 'text', type: 'paragraph', content: 'Texto anterior' }] as never);
    map.set(A, { v: 1, w: 640, h: 480, extra: { future: true } });
    map.set(`${A}/future`, new Y.Map(Object.entries({ type: 'unknown-shape', json: [{ unchanged: 'texto' }] })));
    const plan = replacementMarkup(map, A)!;
    const v = view(editor); let pos = 0;
    v.state.doc.descendants((node, p) => { if (node.type.name === (inline ? 'photo' : 'image')) pos = p; });
    const node = v.state.doc.nodeAt(pos)!;
    doc.transact(() => { v.dispatch(v.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, url: `sdmedia://${B}` })); writeReplacementMarkup(map, B, plan); });
    const clone = new Y.Doc(); Y.applyUpdate(clone, Y.encodeStateAsUpdate(doc));
    const before = clone.getMap(PHOTO_MARKUP_MAP).toJSON(), old = mountEditor(clone, 'vieja', oldSchema);
    old.updateBlock('text', { content: 'Edición desde la versión vieja' });
    expect(mediaIdsInDoc(clone).has(B)).toBe(true);
    expect(clone.getMap(PHOTO_MARKUP_MAP).toJSON()).toEqual(before);
    expect(old.document.some((block) => block.id === 'text')).toBe(true);
    old.unmount(); editor.unmount(); clone.destroy(); doc.destroy();
  });
  it('el preflight codificado no escribe ni copia parcialmente al superar el tope de la foto', () => {
    const doc = new Y.Doc(), editor = mountEditor(doc), map = doc.getMap<unknown>(PHOTO_MARKUP_MAP);
    editor.replaceBlocks(editor.document, [{ id: 'photo', type: 'image', props: { url: `sdmedia://${A}` } }] as never);
    map.set(A, { v: 1, w: 640, h: 480 }); map.set(`${A}/large`, new Y.Map([['future', 'x'.repeat(100 * 1024)]]));
    const before = Y.encodeStateAsUpdate(doc);
    expect(replacementFits(doc, view(editor).state.doc, B, replacementMarkup(map, A)!)).toBe(false);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    expect(map.has(B)).toBe(false); editor.unmount(); doc.destroy();
  });
});
