// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { schema } from '../ui/editorSchema';
import type { LinkTarget } from './pageRelations';
import { prepareInDoc, undoInDoc, type PrepareOptions } from './prepareDay';
import { buildRegistry } from './reader';

// Los casos de la auditoría de *Prepare* (Docs/Doc_Relaciones.md, sección 11; D436, D437), sobre dos Y.Doc: un título a
// mano nunca se saca (B4), y ni *Undo* ni la limpieza de repetidos pierden lo que otro escribe a la vez, también con dos o
// más secciones (R1, R2: el borrado va directo en el Y.Doc, bloque por bloque).

const editors: BlockNoteEditor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.unmount();
  document.body.innerHTML = '';
});

const PAGES: Record<string, string> = {
  '104_008': '11111111-1111-4111-8111-111111111111',
  '104_009': '22222222-2222-4222-8222-222222222222',
  '105_029': '33333333-3333-4333-8333-333333333333',
  '105_027': '44444444-4444-4444-8444-444444444444',
};
const registry = buildRegistry({ scenes: Object.entries(PAGES).map(([code, pageId]) => ({ code, pageId })), locations: [] });
const byPage = new Map(Object.entries(PAGES).map(([code, id]) => [id, code]));
const linkTarget: LinkTarget = (id) => (byPage.has(id) ? { kind: 'scene', ref: byPage.get(id)! } : null);
const opts = (codes: string[]): PrepareOptions => ({ scenes: codes.map((code) => ({ code, pageId: PAGES[code] })), registry, linkTarget, word: 'Escena', level: 1 });

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

/** Un reporte del día con una sección ya escrita («Escena 105_029a», sin link) y un renglón vacío al final. */
function report(): Y.Doc {
  const doc = new Y.Doc();
  const e = mount(doc);
  e.replaceBlocks(e.document, [
    { type: 'heading', props: { level: 1 }, content: 'Info general' },
    { type: 'paragraph', content: 'Llamado 7:00.' },
    { type: 'heading', props: { level: 1 }, content: 'Escena 105_029a' },
    { type: 'paragraph', content: 'Primer plano, luz de atardecer.' },
    { type: 'paragraph', content: '' },
  ] as never);
  return doc;
}

type Shown = { type: string; text: string; href?: string };
function read(doc: Y.Doc): Shown[] {
  const e = mount(doc);
  const out = e.document.map((b) => {
    const content = (Array.isArray(b.content) ? b.content : []) as { type: string; text?: string; href?: string; content?: { text: string }[] }[];
    const text = content.map((c) => (c.type === 'link' ? (c.content ?? []).map((x) => x.text).join('') : (c.text ?? ''))).join('');
    const link = content.find((c) => c.type === 'link');
    return { type: b.type === 'heading' ? `h${(b.props as { level: number }).level}` : b.type, text, ...(link ? { href: link.href } : {}) };
  });
  editors.splice(editors.indexOf(e), 1);
  e.unmount();
  return out;
}

/** Escribe en el renglón de abajo de un título (como en el set). */
function writeUnder(doc: Y.Doc, headingId: string, text: string): void {
  const e = mount(doc);
  const i = e.document.findIndex((b) => b.id === headingId);
  e.updateBlock(e.document[i + 1], { content: text } as never);
  editors.splice(editors.indexOf(e), 1);
  e.unmount();
}
void writeUnder;

const headings = (doc: Y.Doc) => read(doc).filter((b) => b.type === 'h1').map((b) => b.text);
const sync = (a: Y.Doc, b: Y.Doc) => {
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
};
const fork = (doc: Y.Doc) => { const b = new Y.Doc(); Y.applyUpdate(b, Y.encodeStateAsUpdate(doc)); return b; };
function writeIn(doc: Y.Doc, id: string, text: string) { const e = mount(doc); e.updateBlock(id, { content: text } as never); editors.splice(editors.indexOf(e), 1); e.unmount(); }

describe('Prepare con dos dispositivos: los casos de la auditoría', () => {
  it('prueba 5 (B4): título a mano «Escena [105_029]» vacío + «Escena 105_029a» escrita: preparar no lo saca', () => {
    const doc = report();
    const e = mount(doc);
    e.insertBlocks([
      { type: 'heading', props: { level: 1 }, content: [{ type: 'text', text: 'Escena ', styles: {} }, { type: 'link', href: `/p/${PAGES['105_029']}`, content: '105_029' }] },
      { type: 'paragraph', content: '' },
    ] as never, e.document[1].id, 'after');
    editors.splice(editors.indexOf(e), 1); e.unmount();
    const before = headings(doc);
    const out = prepareInDoc(doc, opts(['104_008']));
    expect(out.merged).toBe(0);
    expect(headings(doc)).toEqual([...before, 'Escena 104_008']);
  });
  it('B4 sin romper D436: el par de dos dispositivos se sigue limpiando', () => {
    const a = report(); const b = fork(a);
    prepareInDoc(a, opts(['104_008'])); prepareInDoc(b, opts(['104_008'])); sync(a, b);
    expect(prepareInDoc(a, opts(['104_008'])).merged).toBe(1);
    expect(headings(a).filter((h) => h === 'Escena 104_008')).toHaveLength(1);
  });
  it('B4: dos títulos a mano iguales con la forma de Prepare, vacíos', () => {
    const doc = report();
    const e = mount(doc);
    const h = { type: 'heading', props: { level: 1 }, content: [{ type: 'text', text: 'Escena ', styles: {} }, { type: 'link', href: `/p/${PAGES['105_027']}`, content: '105_027' }] };
    e.insertBlocks([h, { type: 'paragraph', content: '' }, h, { type: 'paragraph', content: '' }] as never, e.document[1].id, 'after');
    editors.splice(editors.indexOf(e), 1); e.unmount();
    const out = prepareInDoc(doc, opts(['104_008']));
    // No se distinguen de un par de Prepare: se juntan (D436, anotado).
    expect(out.merged).toBe(1);
  });
  it('prueba 3b (O1) con DOS secciones preparadas y titleOnly: B escribe bajo la primera, A deshace solo títulos', () => {
    const a = report();
    const out = prepareInDoc(a, opts(['104_008', '104_009']));
    const b = fork(a);
    writeIn(b, out.added[0].paragraphId, 'Texto de B bajo 104_008.');
    expect(undoInDoc(a, out.added, linkTarget, { titleOnly: true }).removed).toBe(out.added.length);
    sync(a, b);
    expect(read(a).map((x) => x.text)).toContain('Texto de B bajo 104_008.');
  });
  it('prueba 3c (O1) con DOS secciones, B escribe bajo la segunda', () => {
    const a = report();
    const out = prepareInDoc(a, opts(['104_008', '104_009']));
    const b = fork(a);
    writeIn(b, out.added[1].paragraphId, 'Texto de B bajo 104_009.');
    expect(undoInDoc(a, out.added, linkTarget, { titleOnly: true }).removed).toBe(out.added.length);
    sync(a, b);
    expect(read(a).map((x) => x.text)).toContain('Texto de B bajo 104_009.');
  });
  it('D436 con dos escenas: A limpia el par mientras C, sin red, escribe bajo el 104_008 repetido que A saca', () => {
    const a = report();
    const b = fork(a);
    prepareInDoc(a, opts(['104_008', '104_009']));
    prepareInDoc(b, opts(['104_008', '104_009']));
    sync(a, b);
    // los títulos 104_008 en orden del documento: el segundo es el que la limpieza saca (deja el primero)
    const e = mount(a); const docs = e.document; editors.splice(editors.indexOf(e), 1); e.unmount();
    const idx = docs.map((x, i) => [x, i] as const).filter(([x]) => x.type === 'heading' && JSON.stringify(x.content).includes('104_008')).map(([, i]) => i);
    const c = fork(a);
    writeIn(c, docs[idx[1] + 1].id, 'Texto de C bajo el segundo 104_008.');
    expect(prepareInDoc(a, opts(['104_008', '104_009'])).merged).toBe(2);
    sync(a, c);
    expect(read(a).map((x) => x.text)).toContain('Texto de C bajo el segundo 104_008.');
  });
  it('prueba 3 (O1) con titleOnly: B ya recibió y escribe en el renglón, A deshace solo títulos → el texto de B queda', () => {
    const a = report();
    const out = prepareInDoc(a, opts(['104_008']));
    const b = fork(a);
    writeIn(b, out.added[0].paragraphId, 'Texto de B en el set.');
    expect(undoInDoc(a, out.added, linkTarget, { titleOnly: true }).removed).toBe(out.added.length);
    sync(a, b);
    expect(read(a).map((x) => x.text)).toContain('Texto de B en el set.');
  });
});

describe('tres secciones: lo que otro escribe bajo la primera, la del medio o la última no se pierde', () => {
  const three = ['104_008', '104_009', '105_027'];
  for (const k of [0, 1, 2]) {
    it(`Undo (solo títulos) con B escribiendo bajo la sección ${k + 1}`, () => {
      const a = report();
      const out = prepareInDoc(a, opts(three));
      const b = fork(a);
      writeIn(b, out.added[k].paragraphId, `B bajo ${three[k]}.`);
      expect(undoInDoc(a, out.added, linkTarget, { titleOnly: true })).toEqual({ removed: 3, kept: 0 });
      sync(a, b);
      expect(read(a)).toEqual(read(b));
      expect(read(a).map((x) => x.text)).toContain(`B bajo ${three[k]}.`);
      expect(headings(a)).toEqual(['Info general', 'Escena 105_029a']);
    });
    it(`Undo completo (sin subir) deja el reporte como estaba (${k + 1})`, () => {
      const a = report();
      const before = read(a);
      const out = prepareInDoc(a, opts(three));
      expect(undoInDoc(a, out.added, linkTarget)).toEqual({ removed: 3, kept: 0 });
      expect(read(a)).toEqual(before);
    });
    it(`D436 con C escribiendo bajo el repetido de la escena ${k + 1}`, () => {
      const a = report();
      const b = fork(a);
      prepareInDoc(a, opts(three));
      prepareInDoc(b, opts(three));
      sync(a, b);
      const e = mount(a);
      const docs = e.document;
      editors.splice(editors.indexOf(e), 1);
      e.unmount();
      const idx = docs.map((x, i) => [x, i] as const).filter(([x]) => x.type === 'heading' && JSON.stringify(x.content).includes(three[k])).map(([, i]) => i);
      const c = fork(a);
      writeIn(c, docs[idx[1] + 1].id, `C bajo el repetido de ${three[k]}.`);
      const again = prepareInDoc(a, opts(three));
      expect(again.merged).toBe(3);
      sync(a, c);
      expect(read(a)).toEqual(read(c));
      expect(read(a).map((x) => x.text)).toContain(`C bajo el repetido de ${three[k]}.`);
      for (const code of three) expect(headings(a).filter((h) => h === `Escena ${code}`)).toHaveLength(1);
    });
  }
  it('si la estructura no es la esperada (el título quedó adentro de otro bloque), Undo no borra nada y lo dice', () => {
    const doc = new Y.Doc();
    const e = mount(doc);
    const HID = 'aaaaaaaa-0000-4000-8000-000000000001';
    const PID = 'aaaaaaaa-0000-4000-8000-000000000002';
    e.replaceBlocks(e.document, [
      { type: 'paragraph', content: 'Arriba', children: [{ id: HID, type: 'heading', props: { level: 1 }, content: [{ type: 'text', text: 'Escena ', styles: {} }, { type: 'link', href: `/p/${PAGES['104_008']}`, content: '104_008' }] }] },
      { id: PID, type: 'paragraph', content: '' },
    ] as never);
    editors.splice(editors.indexOf(e), 1);
    e.unmount();
    const before = Y.encodeStateVector(doc);
    const u = undoInDoc(doc, [{ code: '104_008', headingId: HID, paragraphId: PID, text: 'Escena 104_008' }], linkTarget);
    expect(u).toEqual({ removed: 0, kept: 1, unexpected: true });
    expect(Y.encodeStateVector(doc)).toEqual(before);
  });
});
