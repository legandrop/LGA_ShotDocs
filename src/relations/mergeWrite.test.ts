// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { PHOTO_MARKUP_MAP } from '../media/markup';
import { unitsFromYDoc } from '../search/extract';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { SHARED_COLLAPSE_MAP } from '../ui/collapseEditor';
import { schema } from '../ui/editorSchema';
import { schema as publishedSchema } from '../ui/fixtures/editorSchemaMain';
import { findUnknownContent } from '../ui/unknownContent';
import { blockIds, copyIntoDoc, derivedId, intactCopy, planCopy, separatorBlock, separatorId, undoCopyInDoc, type CopyRecord } from './mergeWrite';

// La copia de *Merge* en el Y.Doc (E16, D645, D649, C4, C5, C8): exacta, con los mismos ids, al final y solo agregando;
// los ids que A ya tenía, derivados también adentro; repetir no duplica; *Undo* saca solo lo intacto; con el editor
// abierto en A no se repara nada; y una versión publicada que abre A no pierde nada.

const editors: BlockNoteEditor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.unmount();
  document.body.innerHTML = '';
});

function mount(doc: Y.Doc, withSchema: unknown = schema): BlockNoteEditor {
  const editor = BlockNoteEditor.create(
    withCollaboration({ schema: withSchema as typeof schema, collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } } }),
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  editor.mount(el);
  editors.push(editor);
  return editor;
}

const PHOTO = '0000000a-aaaa-4bbb-8ccc-dddddddddddd';
const B_ID = 'bbbbbbbb-0000-4000-8000-000000000000';

function pageA(): Y.Doc {
  const doc = new Y.Doc();
  const e = mount(doc);
  e.replaceBlocks(e.document, [
    { id: 'a1', type: 'heading', props: { level: 1 }, content: 'Notas' },
    { id: 'a2', type: 'paragraph', content: 'Lo de la primera página.' },
  ] as never);
  return doc;
}

function pageB(shared?: string): Y.Doc {
  const doc = new Y.Doc();
  const e = mount(doc);
  e.replaceBlocks(e.document, [
    { id: 'b1', type: 'heading', props: { level: 2 }, content: 'Plano general' },
    { id: 'b2', type: 'paragraph', content: 'Texto de la segunda.', children: [{ id: shared ?? 'b3', type: 'paragraph', content: 'Anidado' }] },
    { id: 'b4', type: 'image', props: { url: `sdmedia://${PHOTO}`, caption: 'La curva' } },
  ] as never);
  doc.getMap(SHARED_COLLAPSE_MAP).set('b1', true);
  const markup = doc.getMap<unknown>(PHOTO_MARKUP_MAP);
  markup.set(PHOTO, { v: 1, w: 1920, h: 1080 });
  const shape = new Y.Map<unknown>();
  for (const [k, v] of Object.entries({ t: 'rect', x: 10, y: 10, w: 100, h: 50, c: '#85DC53' })) shape.set(k, v);
  markup.set(`${PHOTO}/s1`, shape);
  return doc;
}

const texts = (doc: Y.Doc) => unitsFromYDoc(doc).map((u) => u.text);
const topIds = (doc: Y.Doc) => ((doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement).toArray() as Y.XmlElement[]).map((c) => c.getAttribute('id'));

function copy(a: Y.Doc, b: Y.Doc, remap?: string[]): CopyRecord {
  const plan = planCopy(a, b);
  const out = copyIntoDoc(a, b, { from: B_ID, remap: remap ?? plan.remap, separator: () => separatorBlock('Merged from the other page', separatorId(B_ID)) });
  if (typeof out === 'string') throw new Error(out);
  return out;
}

/** Lo que un segundo dispositivo hace sobre su copia de A, y llega a A. */
function remote(a: Y.Doc, edit: (doc: Y.Doc) => void): void {
  const other = new Y.Doc();
  Y.applyUpdate(other, Y.encodeStateAsUpdate(a));
  const before = Y.encodeStateVector(other);
  edit(other);
  Y.applyUpdate(a, Y.encodeStateAsUpdate(other, before));
}

const containerOf = (doc: Y.Doc, id: string): Y.XmlElement => {
  const walk = (n: Y.XmlElement): Y.XmlElement | null => {
    for (const c of n.toArray()) {
      if (!(c instanceof Y.XmlElement)) continue;
      if (c.nodeName === 'blockContainer' && c.getAttribute('id') === id) return c;
      const f = walk(c);
      if (f) return f;
    }
    return null;
  };
  return walk(doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement)!;
};
const textIn = (el: Y.XmlElement) => (el.toArray()[0] as Y.XmlElement).toArray()[0] as Y.XmlText;

describe('copiar a la que queda', () => {
  it('al final, los mismos ids, exacto, con las anotaciones y los colapsados; A no cambia; repetir no duplica', () => {
    const a = pageA();
    const b = pageB();
    const before = texts(a);
    const beforeB = Y.encodeStateAsUpdate(b);
    const rec = copy(a, b);
    expect(topIds(a)).toEqual(['a1', 'a2', separatorId(B_ID), 'b1', 'b2', 'b4']);
    expect(texts(a)).toEqual([...before, 'Merged from the other page', 'Plano general', 'Texto de la segunda.', 'Anidado', 'La curva']);
    expect(blockIds(a).has('b3')).toBe(true);
    expect(rec.photos).toEqual([PHOTO]);
    expect(a.getMap<unknown>(PHOTO_MARKUP_MAP).has(`${PHOTO}/s1`)).toBe(true);
    expect(a.getMap(SHARED_COLLAPSE_MAP).get('b1')).toBe(true);
    // B no se tocó.
    expect(Y.encodeStateAsUpdate(b)).toEqual(beforeB);
    // Repetir (retomar, o un segundo toque) no copia nada.
    expect(copyIntoDoc(a, b, { from: B_ID, remap: [], separator: () => separatorBlock('x', separatorId(B_ID)) })).toBe('already');
    expect(topIds(a).length).toBe(6);
  });

  it('C4: un id de B que A ya tenía (también anidado) va con un id derivado, el mismo en otro dispositivo', () => {
    const a = pageA();
    const b = pageB('a2');
    const plan = planCopy(a, b);
    expect(plan.remap).toEqual(['a2']);
    copy(a, b);
    const ids = [...blockIds(a)];
    // Dentro de A nunca dos bloques con el mismo id.
    expect(ids.filter((id) => id === 'a2')).toHaveLength(1);
    expect(blockIds(a).has(derivedId(B_ID, 'a2'))).toBe(true);
    expect(derivedId(B_ID, 'a2')).toBe(derivedId(B_ID, 'a2'));
    expect(derivedId(B_ID, 'a2')).not.toBe(derivedId('otra', 'a2'));
    // Mutación «sin saltear ids»: con remap vacío, A queda con dos bloques `a2`.
    const a2 = pageA();
    copy(a2, pageB('a2'), []);
    const all: string[] = [];
    const walk = (n: Y.XmlElement) => n.toArray().forEach((c) => c instanceof Y.XmlElement && (c.nodeName === 'blockContainer' && all.push(c.getAttribute('id') as string), walk(c)));
    walk(a2.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement);
    expect(all.filter((id) => id === 'a2')).toHaveLength(2);
  });

  it('D646: con la plantilla sola (lo mismo en las dos), B no agrega nada', () => {
    const one = new Y.Doc();
    const e1 = mount(one);
    e1.replaceBlocks(e1.document, [{ type: 'heading', props: { level: 1 }, content: 'Notes' }, { type: 'paragraph', content: 'Director:' }] as never);
    const two = new Y.Doc();
    const e2 = mount(two);
    e2.replaceBlocks(e2.document, [{ type: 'heading', props: { level: 1 }, content: 'Notes' }, { type: 'paragraph', content: 'Director:' }, { type: 'paragraph', content: '' }] as never);
    expect(planCopy(one, two).nothing).toBe(true);
    expect(planCopy(one, pageB()).nothing).toBe(false);
  });

  it('otro dispositivo escribiendo en A a la vez: lo suyo queda donde lo escribió, la copia al final', () => {
    const a = pageA();
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(a));
    // El otro escribe en el último renglón y agrega un bloque al final, sin red.
    const before = Y.encodeStateVector(other);
    textIn(containerOf(other, 'a2')).insert(24, ' Y algo más.');
    const e = mount(other);
    e.insertBlocks([{ id: 'x1', type: 'paragraph', content: 'Del otro dispositivo' }] as never, e.document[e.document.length - 1].id, 'after');
    copy(a, pageB());
    Y.applyUpdate(a, Y.encodeStateAsUpdate(other, before));
    Y.applyUpdate(other, Y.encodeStateAsUpdate(a));
    expect(texts(a)).toEqual(texts(other));
    const t = texts(a);
    expect(t).toContain('Lo de la primera página. Y algo más.');
    expect(t).toContain('Del otro dispositivo');
    expect(t).toContain('Texto de la segunda.');
  });
});

describe('Undo de la copia (C5)', () => {
  it('sin nadie tocando, saca todo lo copiado y el separador; A queda como antes', () => {
    const a = pageA();
    const before = texts(a);
    const rec = copy(a, pageB());
    expect(undoCopyInDoc(a, rec)).toEqual({ removed: 3, kept: 0 });
    expect(texts(a)).toEqual(before);
  });

  it('un bloque editado, uno con un carácter borrado, uno con un hijo nuevo o un atributo cambiado: quedan (y el separador)', () => {
    for (const touch of [
      (d: Y.Doc) => textIn(containerOf(d, 'b1')).insert(0, '¡'),
      (d: Y.Doc) => textIn(containerOf(d, 'b1')).delete(0, 1),
      (d: Y.Doc) => ((containerOf(d, 'b2').toArray()[1] as Y.XmlElement).insert(0, [new Y.XmlElement('blockContainer')])),
      (d: Y.Doc) => containerOf(d, 'b4').setAttribute('textColor', 'red'),
      (d: Y.Doc) => ((containerOf(d, 'b4').toArray()[0] as Y.XmlElement).setAttribute('caption', 'Otra')),
    ]) {
      const a = pageA();
      const rec = copy(a, pageB());
      remote(a, touch);
      const out = undoCopyInDoc(a, rec);
      expect(out).toEqual({ removed: 2, kept: 1 });
      expect(blockIds(a).has(separatorId(B_ID))).toBe(true);
    }
  });

  it('mutación «sin el chequeo de intacto»: sacar por id se llevaría lo que escribió otro', () => {
    const a = pageA();
    const rec = copy(a, pageB());
    remote(a, (d) => textIn(containerOf(d, 'b1')).insert(0, 'Escrito por otro: '));
    expect(intactCopy(containerOf(a, 'b1'), rec)).toBe(false);
    expect(intactCopy(containerOf(a, 'b2'), rec)).toBe(true);
    undoCopyInDoc(a, rec);
    expect(texts(a).some((x) => x.startsWith('Escrito por otro'))).toBe(true);
  });

  it('con el editor abierto en A (riesgo 1 del plan): la copia se dibuja sin reparar nada y sigue intacta', async () => {
    const a = pageA();
    const editor = mount(a);
    const rec = copy(a, pageB());
    await new Promise((r) => setTimeout(r, 30));
    expect(editor.document.map((x) => x.id)).toEqual(['a1', 'a2', separatorId(B_ID), 'b1', 'b2', 'b4']);
    for (const id of rec.ids) expect(intactCopy(containerOf(a, id), rec)).toBe(true);
    expect(undoCopyInDoc(a, rec).removed).toBe(3);
    await new Promise((r) => setTimeout(r, 30));
    expect(editor.document.map((x) => x.id)).toEqual(['a1', 'a2']);
  });
});

describe('una versión vieja abierta a la vez (C8, D659)', () => {
  it('A unida, abierta con el esquema publicado: no hay nada desconocido y no se pierde nada, ni al escribir', async () => {
    const a = pageA();
    copy(a, pageB());
    expect(findUnknownContent(a)).toBeNull();
    const before = texts(a);
    const old = new Y.Doc();
    Y.applyUpdate(old, Y.encodeStateAsUpdate(a));
    const editor = mount(old, publishedSchema);
    await new Promise((r) => setTimeout(r, 30));
    editor.insertBlocks([{ type: 'paragraph', content: 'Desde la versión vieja' }] as never, editor.document[editor.document.length - 1].id, 'after');
    await new Promise((r) => setTimeout(r, 30));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(old));
    expect(texts(a)).toEqual([...before, 'Desde la versión vieja']);
    expect(topIds(a).slice(0, 6)).toEqual(['a1', 'a2', separatorId(B_ID), 'b1', 'b2', 'b4']);
  });
});
