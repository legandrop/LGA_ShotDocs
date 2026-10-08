// @vitest-environment jsdom
import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { schema } from '../ui/editorSchema';
import type { LinkTarget } from './pageRelations';
import { prepareInDoc, undoInDoc, type PrepareOptions } from './prepareDay';
import { buildRegistry } from './reader';

// *Prepare tomorrow's report* sobre el Y.Doc (Docs/Doc_Relaciones.md, sección 11): solo agrega, no duplica, no pisa lo
// escrito, *Undo* saca solo lo vacío, una versión vieja lo abre igual, y dos dispositivos que preparan a la vez sin red
// se juntan sin perder nada (D436).

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

const headings = (doc: Y.Doc) => read(doc).filter((b) => b.type === 'h1').map((b) => b.text);
const sync = (a: Y.Doc, b: Y.Doc) => {
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
};

describe('Prepare tomorrow’s report', () => {
  it('agrega al final una sección por escena sin sección, con el número como link y sin el título de la escena', () => {
    const doc = report();
    const out = prepareInDoc(doc, opts(['104_008', '104_009', '105_029']));
    expect(out.added.map((a) => a.code)).toEqual(['104_008', '104_009']);
    // 105_029 ya tiene «Escena 105_029a» (parte A): no se repite.
    expect(out.skipped).toEqual(['105_029']);
    const blocks = read(doc);
    // Lo de antes, igual y en su lugar; lo nuevo al final, antes del renglón vacío de cierre.
    expect(blocks.slice(0, 4).map((b) => b.text)).toEqual(['Info general', 'Llamado 7:00.', 'Escena 105_029a', 'Primer plano, luz de atardecer.']);
    expect(blocks.slice(4)).toEqual([
      { type: 'h1', text: 'Escena 104_008', href: `/p/${PAGES['104_008']}` },
      { type: 'paragraph', text: '' },
      { type: 'h1', text: 'Escena 104_009', href: `/p/${PAGES['104_009']}` },
      { type: 'paragraph', text: '' },
      { type: 'paragraph', text: '' },
    ]);
  });

  it('preparar de nuevo no duplica ni pisa lo escrito: solo agrega lo que falta', () => {
    const doc = report();
    const first = prepareInDoc(doc, opts(['104_008', '104_009']));
    writeUnder(doc, first.added[0].headingId, 'Se hizo con grúa.');
    const again = prepareInDoc(doc, opts(['104_008', '104_009', '105_027']));
    expect(again.added.map((a) => a.code)).toEqual(['105_027']);
    expect(again.skipped).toEqual(['104_008', '104_009']);
    expect(again.merged).toBe(0);
    expect(headings(doc)).toEqual(['Info general', 'Escena 105_029a', 'Escena 104_008', 'Escena 104_009', 'Escena 105_027']);
    expect(read(doc).map((b) => b.text)).toContain('Se hizo con grúa.');
    // Nada que agregar: el documento no cambia.
    const before = Y.encodeStateVector(doc);
    const none = prepareInDoc(doc, opts(['104_008']));
    expect(none.added).toEqual([]);
    expect(Y.encodeStateVector(doc)).toEqual(before);
  });

  it('una escena nombrada de otra forma en un título (5-29, un link) cuenta como sección', () => {
    const doc = new Y.Doc();
    const e = mount(doc);
    e.replaceBlocks(e.document, [
      { type: 'heading', props: { level: 2 }, content: 'Escena 4-8' },
      { type: 'heading', props: { level: 2 }, content: [{ type: 'link', href: `/p/${PAGES['104_009']}`, content: 'la del auto' }] },
    ] as never);
    const out = prepareInDoc(doc, opts(['104_008', '104_009', '105_027']));
    expect(out.skipped).toEqual(['104_008', '104_009']);
    expect(out.added.map((a) => a.code)).toEqual(['105_027']);
  });

  it('Undo saca solo lo agregado que sigue vacío; un título con algo debajo o cambiado queda', () => {
    const doc = report();
    const out = prepareInDoc(doc, opts(['104_008', '104_009', '105_027']));
    writeUnder(doc, out.added[0].headingId, 'Tres tomas.');
    // El título de 105_027 cambiado a mano: ya no es el que puso Prepare.
    const e = mount(doc);
    e.updateBlock(out.added[2].headingId, { content: [{ type: 'text', text: 'Escena ', styles: {} }, { type: 'link', href: `/p/${PAGES['105_027']}`, content: '105_027' }, { type: 'text', text: ' (si sobra tiempo)', styles: {} }] } as never);
    editors.splice(editors.indexOf(e), 1);
    e.unmount();
    const undo = undoInDoc(doc, out.added, linkTarget);
    expect(undo).toEqual({ removed: 1, kept: 2 });
    expect(headings(doc)).toEqual(['Info general', 'Escena 105_029a', 'Escena 104_008', 'Escena 105_027 (si sobra tiempo)']);
    expect(read(doc).map((b) => b.text)).toContain('Tres tomas.');
    // Sin nada escrito: Undo deja el documento como estaba.
    const clean = report();
    const before = read(clean);
    const out2 = prepareInDoc(clean, opts(['104_008', '104_009']));
    expect(undoInDoc(clean, out2.added, linkTarget)).toEqual({ removed: 2, kept: 0 });
    expect(read(clean)).toEqual(before);
  });

  it('una foto o un bloque nuevo debajo de una sección preparada también la deja en Undo', () => {
    const doc = report();
    const out = prepareInDoc(doc, opts(['104_008']));
    const e = mount(doc);
    e.insertBlocks([{ type: 'bulletListItem', content: 'grúa' }] as never, out.added[0].paragraphId, 'after');
    editors.splice(editors.indexOf(e), 1);
    e.unmount();
    expect(undoInDoc(doc, out.added, linkTarget)).toEqual({ removed: 0, kept: 1 });
    expect(headings(doc)).toContain('Escena 104_008');
  });

  it('una versión con el esquema anterior abre el reporte preparado sin perder el título, el link ni lo escrito', () => {
    const doc = report();
    const out = prepareInDoc(doc, opts(['104_008']));
    writeUnder(doc, out.added[0].headingId, 'Se hizo con grúa.');
    // El esquema de BlockNote sin lo propio de la app (lo más viejo que puede abrirlo): título, párrafo y link son de siempre.
    const { audio: _a, file: _f, video: _v, ...oldSpecs } = defaultBlockSpecs;
    const old = mount(doc, BlockNoteSchema.create({ blockSpecs: oldSpecs }));
    const texts = old.document.map((b) => (Array.isArray(b.content) ? (b.content as { type: string; text?: string; content?: { text: string }[] }[]).map((c) => c.text ?? (c.content ?? []).map((x) => x.text).join('')).join('') : ''));
    expect(texts).toEqual(expect.arrayContaining(['Escena 104_008', 'Se hizo con grúa.']));
    const heading = old.document.find((b) => b.id === out.added[0].headingId)!;
    expect((heading.content as { type: string; href?: string }[]).find((c) => c.type === 'link')?.href).toBe(`/p/${PAGES['104_008']}`);
    editors.splice(editors.indexOf(old), 1);
    old.unmount();
    expect(read(doc).map((b) => b.text)).toEqual(expect.arrayContaining(['Escena 104_008', 'Se hizo con grúa.']));
  });
});

describe('B4: preparar nunca saca un título escrito a mano', () => {
  it('«Escena [105_029]» con link y vacío, al lado de «Escena 105_029a» escrita: preparar otra escena no lo toca', () => {
    const doc = new Y.Doc();
    const e = mount(doc);
    e.replaceBlocks(e.document, [
      { type: 'heading', props: { level: 1 }, content: 'Info general' },
      { type: 'heading', props: { level: 1 }, content: [{ type: 'text', text: 'Escena ', styles: {} }, { type: 'link', href: `/p/${PAGES['105_029']}`, content: '105_029' }] },
      { type: 'paragraph', content: '' },
      { type: 'heading', props: { level: 1 }, content: 'Escena 105_029a' },
      { type: 'paragraph', content: 'Primer plano.' },
    ] as never);
    editors.splice(editors.indexOf(e), 1);
    e.unmount();
    const out = prepareInDoc(doc, opts(['104_008']));
    expect(out.merged).toBe(0);
    expect(headings(doc)).toEqual(['Info general', 'Escena 105_029', 'Escena 105_029a', 'Escena 104_008']);
  });
});

describe('dos dispositivos preparan a la vez, sin red (D436)', () => {
  /** Dos copias del mismo reporte (como dos dispositivos que lo bajaron antes de quedarse sin red). */
  function twoDevices(): [Y.Doc, Y.Doc] {
    const base = report();
    const a = new Y.Doc();
    const b = new Y.Doc();
    Y.applyUpdate(a, Y.encodeStateAsUpdate(base));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(base));
    return [a, b];
  }

  it('al juntarse quedan títulos repetidos; preparar de nuevo saca los vacíos y conserva todo lo escrito', () => {
    const [a, b] = twoDevices();
    const pa = prepareInDoc(a, opts(['104_008', '104_009']));
    const pb = prepareInDoc(b, opts(['104_008', '104_009']));
    // En B se escribe en el set debajo de su 104_008, todavía sin red.
    writeUnder(b, pb.added[0].headingId, 'B: se hizo con grúa.');
    sync(a, b);
    // Yjs no puede fundir dos títulos insertados por separado: quedan los dos de cada escena, en el mismo orden en los dos.
    expect(headings(a)).toEqual(headings(b));
    expect(headings(a).filter((h) => h === 'Escena 104_008')).toHaveLength(2);
    expect(headings(a).filter((h) => h === 'Escena 104_009')).toHaveLength(2);
    // La cabecera del día ya los cuenta una sola vez (dayLive); preparar de nuevo, en cualquiera de los dos, los resuelve.
    const again = prepareInDoc(a, opts(['104_008', '104_009']));
    expect(again.added).toEqual([]);
    expect(again.merged).toBe(2);
    sync(a, b);
    // Cada escena una vez (el orden de las dos tandas depende de qué dispositivo Yjs pone primero).
    expect(headings(a).slice(0, 2)).toEqual(['Info general', 'Escena 105_029a']);
    expect(headings(a).slice(2).sort()).toEqual(['Escena 104_008', 'Escena 104_009']);
    expect(read(a)).toEqual(read(b));
    // De 104_008 quedó la de B, la que tiene algo escrito; la vacía de A se fue.
    const blocks = read(a);
    expect(blocks.map((x) => x.text)).toContain('B: se hizo con grúa.');
    const i = blocks.findIndex((x) => x.text === 'Escena 104_008');
    expect(blocks[i + 1].text).toBe('B: se hizo con grúa.');
    // Nada de lo de antes se tocó.
    expect(blocks.slice(0, 4).map((x) => x.text)).toEqual(['Info general', 'Llamado 7:00.', 'Escena 105_029a', 'Primer plano, luz de atardecer.']);
    expect(pa.added).toHaveLength(2);
  });

  it('si los dos escribieron debajo de su copia, no se saca ninguna: las dos secciones quedan', () => {
    const [a, b] = twoDevices();
    const pa = prepareInDoc(a, opts(['104_008']));
    const pb = prepareInDoc(b, opts(['104_008']));
    writeUnder(a, pa.added[0].headingId, 'A: dos tomas.');
    writeUnder(b, pb.added[0].headingId, 'B: una toma más.');
    sync(a, b);
    const again = prepareInDoc(a, opts(['104_008']));
    expect(again.merged).toBe(0);
    sync(a, b);
    const texts = read(b).map((x) => x.text);
    expect(texts.filter((t) => t === 'Escena 104_008')).toHaveLength(2);
    expect(texts).toEqual(expect.arrayContaining(['A: dos tomas.', 'B: una toma más.']));
  });

  it('dos dispositivos que resuelven los repetidos a la vez sacan los mismos (el primero queda)', () => {
    const [a, b] = twoDevices();
    prepareInDoc(a, opts(['104_009']));
    prepareInDoc(b, opts(['104_009']));
    sync(a, b);
    const ra = prepareInDoc(a, opts(['104_009']));
    const rb = prepareInDoc(b, opts(['104_009']));
    expect([ra.merged, rb.merged]).toEqual([1, 1]);
    sync(a, b);
    expect(headings(a).filter((h) => h === 'Escena 104_009')).toHaveLength(1);
    expect(read(a)).toEqual(read(b));
  });

  it('O1: Undo mientras otro, que ya recibió lo preparado, escribe en ese renglón (sin que llegue todavía): no se pierde', () => {
    const [a, b] = twoDevices();
    const pa = prepareInDoc(a, opts(['104_008', '104_009']));
    sync(a, b);
    // B escribe debajo de 104_009; su cambio todavía no llegó a A. A deshace: como lo preparado ya salió, solo títulos.
    writeUnder(b, pa.added[1].headingId, 'B: escrito durante el Undo.');
    expect(undoInDoc(a, pa.added, linkTarget, { titleOnly: true })).toEqual({ removed: 2, kept: 0 });
    sync(a, b);
    expect(read(a)).toEqual(read(b));
    expect(read(a).map((x) => x.text)).toContain('B: escrito durante el Undo.');
    expect(headings(a)).toEqual(['Info general', 'Escena 105_029a']);
    // Contraprueba: sacar también el renglón (como antes) se lleva el texto de B con el bloque.
    const [c, d] = twoDevices();
    const pc = prepareInDoc(c, opts(['104_009']));
    sync(c, d);
    writeUnder(d, pc.added[0].headingId, 'D: se pierde con el bloque.');
    undoInDoc(c, pc.added, linkTarget);
    sync(c, d);
    expect(read(c).map((x) => x.text)).not.toContain('D: se pierde con el bloque.');
  });

  it('lo que alguien escribe sin red en la copia que otro saca al mismo tiempo no se pierde', () => {
    const [a, b] = twoDevices();
    prepareInDoc(a, opts(['104_009']));
    prepareInDoc(b, opts(['104_009']));
    sync(a, b);
    // Los dos ven las dos copias vacías. A prepara de nuevo (saca la segunda) mientras B, sin red, escribe en la segunda.
    const e = mount(b);
    const second = e.document.filter((x) => x.type === 'heading').map((x) => x.id)[3];
    editors.splice(editors.indexOf(e), 1);
    e.unmount();
    prepareInDoc(a, opts(['104_009']));
    writeUnder(b, second, 'B: escrito en la copia que se saca.');
    sync(a, b);
    // Se saca solo el título: el renglón de B queda, con su texto, debajo de la sección que quedó (la misma escena).
    expect(read(a)).toEqual(read(b));
    const blocks = read(a);
    expect(blocks.map((x) => x.text)).toContain('B: escrito en la copia que se saca.');
    expect(headings(a).filter((h) => h === 'Escena 104_009')).toHaveLength(1);
    const i = blocks.findIndex((x) => x.text === 'Escena 104_009');
    expect(blocks.slice(i + 1).map((x) => x.type)).not.toContain('h1');
  });
});
