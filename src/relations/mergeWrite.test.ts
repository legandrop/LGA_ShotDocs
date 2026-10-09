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
import { blockIds, blocksToCopy, blockSignature, copyIntoDoc, derivedId, intactCopy, missingFrom, planCopy, separatorBlock, separatorId, skippedSignatures, undoCopyInDoc, type CopyRecord } from './mergeWrite';

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
    // Aunque el plan no los traiga (A cambió entre el plan y la copia), nunca dos bloques con el mismo id.
    const a2 = pageA();
    copy(a2, pageB('a2'), []);
    const all: string[] = [];
    const walk = (n: Y.XmlElement) => n.toArray().forEach((c) => c instanceof Y.XmlElement && (c.nodeName === 'blockContainer' && all.push(c.getAttribute('id') as string), walk(c)));
    walk(a2.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement);
    expect(all.filter((id) => id === 'a2')).toHaveLength(1);
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

// --- Qué se copia (D707): lo idéntico a lo que A ya tiene no se repite, y nunca se pierde texto ---------------------

type Spec = Record<string, unknown>;

/** Un documento con los bloques dados (ids propios o sin ellos: la firma no los mira). */
function docOf(blocks: Spec[]): Y.Doc {
  const doc = new Y.Doc();
  const e = mount(doc);
  e.replaceBlocks(e.document, blocks as never);
  return doc;
}

const para = (text: string, extra: Spec = {}): Spec => ({ type: 'paragraph', content: text, ...extra });
const head = (text: string): Spec => ({ type: 'heading', props: { level: 1 }, content: text });
const bold = (text: string): Spec => ({ type: 'paragraph', content: [{ type: 'text', text, styles: { bold: true } }] });
const topTexts = (doc: Y.Doc) => texts(doc).filter(Boolean);

function copyWith(a: Y.Doc, b: Y.Doc, key = B_ID): CopyRecord | 'already' | 'empty' {
  const plan = planCopy(a, b);
  return copyIntoDoc(a, b, { from: key, remap: plan.remap, separator: () => separatorBlock('Merged', separatorId(key)) });
}

describe('lo que A ya tiene idéntico no se copia (D707)', () => {
  it('O3: lo que las dos traen de la plantilla no se duplica; lo escrito en B sí pasa', () => {
    const template = [head('Notes'), para('Director:'), para('Art:'), para('')];
    const a = docOf([...template, para('Lo que escribió A.')]);
    const b = docOf([...template, para('Lo que escribió B.')]);
    const plan = planCopy(a, b);
    // El título «Notes» viaja con lo que B escribió debajo (D713); «Director:» y «Art:», idénticos, no.
    expect(plan).toMatchObject({ nothing: false, blocks: 2 });
    const rec = copyWith(a, b);
    expect(typeof rec).not.toBe('string');
    expect(topTexts(a)).toEqual(['Notes', 'Director:', 'Art:', 'Lo que escribió A.', 'Merged', 'Notes', 'Lo que escribió B.']);
    // *Undo* saca solo lo copiado.
    undoCopyInDoc(a, rec as CopyRecord);
    expect(topTexts(a)).toEqual(['Notes', 'Director:', 'Art:', 'Lo que escribió A.']);
  });

  it('O6: unir otra vez la misma página (Restore y algo nuevo) copia solo lo nuevo', () => {
    const a = docOf([head('Notas'), para('De A.')]);
    const b = docOf([head('Plano'), para('Texto de B.'), para('Otro renglón de B.')]);
    expect(typeof copyWith(a, b, 'B:uno')).not.toBe('string');
    const once = topTexts(a);
    // Con la primera copia en A, B no agrega nada.
    expect(planCopy(a, b)).toMatchObject({ nothing: true, blocks: 0 });
    expect(copyWith(a, b, 'B:dos')).toBe('empty');
    expect(topTexts(a)).toEqual(once);
    // Alguien escribe un renglón nuevo en B: la segunda unión trae solo ese.
    const e = mount(b);
    e.insertBlocks([para('Lo nuevo de B.')] as never, e.document[e.document.length - 1].id, 'after');
    expect(planCopy(a, b)).toMatchObject({ nothing: false, blocks: 2 });
    expect(typeof copyWith(a, b, 'B:tres')).not.toBe('string');
    expect(topTexts(a)).toEqual([...once, 'Merged', 'Plano', 'Lo nuevo de B.']);
  });

  it('O7: el mismo texto con otras mayúsculas o con otro formato no es lo mismo: se copia', () => {
    const a = docOf([head('Notes'), para('Director: Ana')]);
    expect(planCopy(a, docOf([head('Notes'), para('director: ana')])).nothing).toBe(false);
    expect(planCopy(a, docOf([head('Notes'), bold('Director: Ana')])).nothing).toBe(false);
    expect(planCopy(a, docOf([head('Notes'), para('Director: Ana', { props: { textColor: 'red' } })])).nothing).toBe(false);
    // Idéntico, o con un renglón en blanco de más al final: nada.
    expect(planCopy(a, docOf([head('Notes'), para('Director: Ana'), para('')])).nothing).toBe(true);
    // Mutación «sin mirar el formato»: dos firmas distintas.
    expect(blockSignature(blocksToCopy(a, docOf([bold('Director: Ana')]))[0])).not.toBe(blockSignature(blocksToCopy(docOf([]), docOf([para('Director: Ana')]))[0]));
  });

  it('cuenta cuántas veces: si B tiene dos iguales y A una, la otra se copia', () => {
    const a = docOf([para('Igual')]);
    const b = docOf([para('Igual'), para('Igual')]);
    expect(planCopy(a, b)).toMatchObject({ nothing: false, blocks: 1 });
  });

  it('los renglones en blanco de en medio se copian (el ritmo de B); los del principio y el final, no', () => {
    const a = docOf([para('De A.')]);
    const b = docOf([para(''), para('Uno'), para(''), para('Dos'), para('')]);
    expect(blocksToCopy(a, b).length).toBe(3);
    copyWith(a, b);
    const top = (a.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement).toArray();
    expect(top.length).toBe(1 + 1 + 3);
  });

  it('las fotos del plan son solo las de lo que se copia', () => {
    const photoBlock = (id: string): Spec => ({ type: 'image', props: { url: `sdmedia://${id}` } });
    const P1 = '0000000b-aaaa-4bbb-8ccc-dddddddddddd';
    const a = docOf([photoBlock(PHOTO)]);
    const b = docOf([photoBlock(PHOTO), photoBlock(P1)]);
    expect(planCopy(a, b).photos).toEqual([P1]);
  });

  it('nunca se pierde texto: con cualquier mezcla, todo bloque de B queda en A (o es un renglón en blanco)', () => {
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const pool: Spec[] = [
      head('Notes'),
      para('Director:'),
      para('Art:'),
      para('director:'),
      bold('Director:'),
      para(''),
      para('Algo de A'),
      para('Algo de B'),
      { type: 'bulletListItem', content: 'Item', children: [para('Hijo')] },
      { type: 'image', props: { url: `sdmedia://${PHOTO}`, caption: 'La curva' } },
    ];
    const pick = (): Spec[] => Array.from({ length: rnd(6) }, () => pool[rnd(pool.length)]);
    const sigs = (doc: Y.Doc) => ((doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement | undefined)?.toArray() ?? []).map((c) => blockSignature(c as Y.XmlElement));
    const blank = sigs(docOf([para('')]))[0];
    for (let round = 0; round < 40; round++) {
      const a = docOf(pick());
      const b = docOf(pick());
      const before = sigs(a);
      copyWith(a, b);
      const after = sigs(a);
      const count = (list: string[], s: string) => list.filter((x) => x === s).length;
      // A conserva todo lo suyo, en su lugar.
      expect(after.slice(0, before.length)).toEqual(before);
      for (const s of new Set(sigs(b))) {
        if (s === blank) continue;
        expect(count(after, s)).toBeGreaterThanOrEqual(count(sigs(b), s));
      }
    }
  });
});

describe('un título idéntico viaja con su sección (D713)', () => {
  const h = (text: string, level = 1): Spec => ({ type: 'heading', props: { level }, content: text });

  it('un reporte del día: lo que B escribió bajo «Escena 105_027b» llega con su título y las secciones iguales no se repiten', () => {
    const a = docOf([h('Info general'), para('Llamado 7:00.'), h('Escena 105_027b'), para('Texto de A.')]);
    const b = docOf([h('Info general'), para('Llamado 7:00.'), h('Escena 105_027b'), para('Texto de B en la escena.')]);
    expect(blocksToCopy(a, b).length).toBe(2);
    copyWith(a, b);
    expect(topTexts(a)).toEqual(['Info general', 'Llamado 7:00.', 'Escena 105_027b', 'Texto de A.', 'Merged', 'Escena 105_027b', 'Texto de B en la escena.']);
  });

  it('con dos escenas: solo viaja el título de la que tiene algo de más; un título idéntico sin nada nuevo debajo se saltea', () => {
    const a = docOf([h('Escena 105_027'), para('Igual.'), h('Escena 105_029'), para('A.')]);
    const b = docOf([h('Escena 105_027'), para('Igual.'), h('Escena 105_029'), para('A.'), para('Nuevo de B.')]);
    copyWith(a, b);
    // «105_029»: su sección tiene algo nuevo, va con el título; «105_027»: idéntica entera, no se copia.
    expect(topTexts(a)).toEqual(['Escena 105_027', 'Igual.', 'Escena 105_029', 'A.', 'Merged', 'Escena 105_029', 'Nuevo de B.']);
  });

  it('un título de nivel 1 se queda con todo lo de adentro, también los títulos más chicos; uno chico no arrastra al grande', () => {
    const a = docOf([h('Escena', 1), h('Plano', 2), para('Igual.')]);
    const b = docOf([h('Escena', 1), h('Plano', 2), para('Igual.'), h('Otro plano', 2), para('Nuevo.')]);
    copyWith(a, b);
    expect(topTexts(a)).toEqual(['Escena', 'Plano', 'Igual.', 'Merged', 'Escena', 'Otro plano', 'Nuevo.']);
    const c = docOf([h('Escena', 1), para('Igual.'), h('Plano', 2), para('Igual.')]);
    const d = docOf([h('Escena', 1), para('Igual.'), h('Plano', 2), para('Igual.'), para('Nuevo bajo el plano.')]);
    copyWith(c, d);
    // «Escena» incluye la sección «Plano»: algo nuevo en ella la arrastra también.
    expect(topTexts(c)).toEqual(['Escena', 'Igual.', 'Plano', 'Igual.', 'Merged', 'Escena', 'Plano', 'Nuevo bajo el plano.']);
  });

  it('nunca se pierde un título con algo de debajo que se copia (al azar, con títulos de dos niveles)', () => {
    let seed = 11;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const pool: Spec[] = [h('Info'), h('Escena 1'), h('Escena 2'), h('Plano', 2), para('Igual'), para('Otro'), para('Solo de B'), para('')];
    const pick = (): Spec[] => Array.from({ length: 1 + rnd(7) }, () => pool[rnd(pool.length)]);
    const sigs = (doc: Y.Doc) => ((doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement | undefined)?.toArray() ?? []).map((c) => blockSignature(c as Y.XmlElement));
    const levelOfSig = (sig: string) => /<heading \{[^}]*"level":"?(\d)/.exec(sig)?.[1];
    for (let round = 0; round < 40; round++) {
      const a = docOf(pick());
      const b = docOf(pick());
      const copied = blocksToCopy(a, b).map((x) => blockSignature(x));
      const all = sigs(b);
      // Cada bloque copiado que no es un título tiene antes, en lo copiado, el último título de B que lo precede.
      all.forEach((sig, i) => {
        if (!copied.includes(sig) || levelOfSig(sig)) return;
        for (let j = i - 1; j >= 0; j--) {
          if (levelOfSig(all[j])) {
            expect(copied.includes(all[j])).toBe(true);
            return;
          }
        }
      });
    }
  });
});

describe('la misma foto en las dos, anotada solo en una (D715)', () => {
  const photo = (): Spec => ({ type: 'image', props: { url: `sdmedia://${PHOTO}`, caption: 'La curva' } });
  const annotate = (doc: Y.Doc, shapeId: string, x: number) => {
    const m = doc.getMap<unknown>(PHOTO_MARKUP_MAP);
    if (!m.has(PHOTO)) m.set(PHOTO, { v: 1, w: 1920, h: 1080 });
    const shape = new Y.Map<unknown>();
    for (const [k, v] of Object.entries({ t: 'rect', x, y: 10, w: 100, h: 50, c: '#85DC53' })) shape.set(k, v);
    m.set(`${PHOTO}/${shapeId}`, shape);
  };

  it('B anotó y A no: el bloque se copia y las formas pasan; si las dos tienen las mismas, no se copia', () => {
    const a = docOf([para('De A'), photo()]);
    const b = docOf([para('De B'), photo()]);
    annotate(b, 's1', 10);
    expect(blocksToCopy(a, b).map((x) => blockSignature(x)).length).toBe(2);
    copyWith(a, b);
    expect(a.getMap<unknown>(PHOTO_MARKUP_MAP).has(`${PHOTO}/s1`)).toBe(true);
    // Con las mismas formas en las dos (una segunda unión), la foto ya está cubierta: solo viaja lo que cambió.
    const c = docOf([para('De A'), photo()]);
    annotate(c, 's1', 10);
    const d = docOf([para('De B'), photo()]);
    annotate(d, 's1', 10);
    expect(blocksToCopy(c, d).length).toBe(1);
    // A anotó de más (B no anotó nada): tampoco hay nada que llevar de B.
    const e = docOf([photo()]);
    annotate(e, 's1', 10);
    expect(planCopy(e, docOf([photo()])).nothing).toBe(true);
    // Otra forma con el mismo id pero otros campos: no está cubierta.
    const f = docOf([photo()]);
    annotate(f, 's1', 99);
    expect(planCopy(f, (() => { const g = docOf([photo()]); annotate(g, 's1', 10); return g; })()).nothing).toBe(false);
  });
});

describe('volver a mirar lo salteado (D714)', () => {
  it('missingFrom cuenta lo que A ya no tiene de lo que se saltó, contando cuántas veces', () => {
    const a = docOf([para('Igual'), para('Igual'), para('De A')]);
    const b = docOf([para('Igual'), para('Igual'), para('De B')]);
    const skipped = skippedSignatures(a, b);
    expect(skipped.length).toBe(2);
    expect(missingFrom(a, skipped)).toBe(0);
    // Otro dispositivo borra uno de los renglones de A: falta uno.
    const e = mount(a);
    e.removeBlocks([e.document[0]] as never);
    expect(missingFrom(a, skipped)).toBe(1);
    // Un renglón en blanco no cuenta como salteado.
    expect(skippedSignatures(docOf([para('x')]), docOf([para('x'), para('')])).length).toBe(1);
  });
});
