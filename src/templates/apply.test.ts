// @vitest-environment jsdom
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { yXmlFragmentToBlocks } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { mediaIdsInDoc } from '../media/usage';
import { buildSeed, CONTENT_FRAGMENT } from '../sync/structure';
import { applyLikeApp, mountEditor, tick, typeAt, undoManager, unmountAll } from '../ui/collabHarness';
import { SHARED_COLLAPSE_MAP } from '../ui/collapseEditor';
import { schema } from '../ui/editorSchema';
import { schema as publishedSchema } from '../ui/fixtures/editorSchemaMain';
import { brokenGaps, storedPhotos } from '../ui/photoHarness';
import { findUnknownContent } from '../ui/unknownContent';
import { copyTemplateDoc, insertTemplate, insertTemplateCopy, isEmptyPage } from './apply';
import { builtinBlocks } from './builtin';

// Crear desde una plantilla es copiar (Docs/Doc_Plantillas.md, 4.2): se agrega antes del primer bloque de la página
// vacía, nunca se borra nada, la plantilla no cambia, y dos dispositivos sin red no pierden nada (a lo sumo duplican).
// La segunda mitad es la prueba de la auditoría del diseño (auditTemplateCopy), sobre `copyTemplateDoc`.

afterEach(unmountAll);

type AnyB = { id: string; type: string; props?: Record<string, unknown>; content?: unknown; children?: AnyB[] };

const reader = () => BlockNoteEditor.create({ schema }) as unknown as BlockNoteEditor;
const blocksOf = (doc: Y.Doc) => yXmlFragmentToBlocks(reader() as never, doc.getXmlFragment(CONTENT_FRAGMENT)) as unknown as AnyB[];
const strip = (blocks: AnyB[]): unknown => blocks.map((b) => ({ type: b.type, props: b.props, content: b.content, children: strip(b.children ?? []) }));
const allIds = (blocks: AnyB[]): string[] => blocks.flatMap((b) => [b.id, ...allIds(b.children ?? [])]);

function seeded(): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, buildSeed('p'));
  return doc;
}

describe('página vacía', () => {
  it('la semilla y los renglones vacíos cuentan como vacía; un texto, un título vacío o una lista, no', async () => {
    const doc = seeded();
    expect(isEmptyPage(doc)).toBe(true);
    expect(isEmptyPage(new Y.Doc())).toBe(true);
    const e = mountEditor(doc, 'a');
    e.insertBlocks([{ type: 'paragraph', content: '' }], 'initialBlockId', 'after');
    await tick();
    expect(isEmptyPage(doc)).toBe(true);
    typeAt(e, 'initialBlockId', 'start', 'x');
    expect(isEmptyPage(doc)).toBe(false);
    for (const block of [{ type: 'heading', content: '' }, { type: 'bulletListItem', content: '' }, { type: 'table', content: { type: 'tableContent', rows: [{ cells: [''] }] } }]) {
      const d = seeded();
      const ed = mountEditor(d, 'b');
      ed.replaceBlocks(ed.document, [block as never]);
      await tick();
      expect(isEmptyPage(d), block.type).toBe(false);
    }
  });
});

describe('agregar una de fábrica', () => {
  it('va antes de la semilla, que queda al final; ids nuevos y únicos; nada borrado', async () => {
    const doc = seeded();
    const e = mountEditor(doc, 'a');
    insertTemplate(e as never, builtinBlocks('shot', 'en'));
    await tick();
    const blocks = blocksOf(doc);
    expect(blocks.at(-1)!.id).toBe('initialBlockId');
    expect(blocks.length).toBe(builtinBlocks('shot', 'en').length + 1);
    const ids = allIds(blocks);
    expect(new Set(ids).size).toBe(ids.length);
    expect(isEmptyPage(doc)).toBe(false);
  });

  it('entra en el deshacer del editor: Ctrl/⌘+Z la saca entera y la página vuelve a estar vacía', async () => {
    const doc = seeded();
    const e = mountEditor(doc, 'a');
    await tick();
    insertTemplate(e as never, builtinBlocks('onset', 'es'));
    await tick();
    expect(isEmptyPage(doc)).toBe(false);
    undoManager(e).undo();
    await tick();
    expect(isEmptyPage(doc)).toBe(true);
    expect(blocksOf(doc).map((b) => b.id)).toEqual(['initialBlockId']);
  });

  it('dos dispositivos sin red: uno la elige y el otro escribe en el renglón vacío; al juntarse no se pierde nada', async () => {
    const a = seeded();
    const b = seeded();
    insertTemplate(mountEditor(a, 'a') as never, builtinBlocks('prepro', 'es'));
    typeAt(mountEditor(b, 'b'), 'initialBlockId', 'start', 'hola');
    await tick();
    applyLikeApp(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
    applyLikeApp(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
    await tick(20);
    const ba = blocksOf(a);
    expect(strip(ba)).toEqual(strip(blocksOf(b)));
    expect(JSON.stringify(ba)).toContain('hola');
    expect(ba.filter((x) => x.id === 'initialBlockId').length).toBe(1);
    expect(ba.length).toBe(builtinBlocks('prepro', 'es').length + 1);
  });

  it('dos dispositivos la eligen a la vez: queda dos veces, cada copia entera y seguida, sin perder nada', async () => {
    const a = seeded();
    const b = seeded();
    insertTemplate(mountEditor(a, 'a') as never, builtinBlocks('onset', 'en'));
    insertTemplate(mountEditor(b, 'b') as never, builtinBlocks('onset', 'en'));
    await tick();
    applyLikeApp(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
    applyLikeApp(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
    await tick(20);
    const n = builtinBlocks('onset', 'en').length;
    const ba = blocksOf(a);
    expect(ba.length).toBe(n * 2 + 1);
    const types = ba.slice(0, -1).map((x) => x.type);
    expect(types.slice(0, n)).toEqual(types.slice(n));
    expect(strip(ba)).toEqual(strip(blocksOf(b)));
  });
});

// --- Una plantilla que es una página (entrega 3; la copia de la auditoría del diseño) -------------------------------

const ID = (n: number) => `0f8fad5b-d9cb-469f-a165-7086772895${String(n).padStart(2, '0')}`;
const text = (t: string) => ({ type: 'text', text: t, styles: {} });
const sdPhoto = (n: number, w = 0) => ({ type: 'photo', props: { url: `sdmedia://${ID(n)}`, name: `F${n}.jpg`, w } });

const TEMPLATE: PartialBlock[] = [
  { id: 'h1', type: 'heading', props: { level: 2 }, content: [text('Shot list')] },
  {
    id: 'tb',
    type: 'table',
    content: {
      type: 'tableContent',
      headerRows: 1,
      rows: [
        { cells: [[text('Shot')], [text('Ref')]] },
        { cells: [[text('010')], [sdPhoto(2)]] },
      ],
    },
  },
  { id: 'kv', type: 'table', content: { type: 'tableContent', headerCols: 1, rows: [{ cells: [[text('Location')], [text('Estancia')]] }] } },
  { id: 'q', type: 'paragraph', props: { question: true }, content: [text('Director: ')] },
  { id: 's', type: 'paragraph', props: { script: true }, content: [text('INT. COCINA - NOCHE')] },
  { id: 'c', type: 'checkListItem', props: { checked: true }, content: [text('clean plate')] },
  { id: 'b', type: 'bulletListItem', content: [text('Screen:')], children: [{ id: 'bb', type: 'bulletListItem', content: [text('green')] }] },
  { id: 'img', type: 'image', props: { url: `sdmedia://${ID(3)}`, name: 'F3.jpg' } },
  { id: 'p', type: 'paragraph', content: [text('Antes '), sdPhoto(1, 0.25), text(' después')] },
] as never;

function makeTemplate(): Y.Doc {
  const doc = seeded();
  const e = mountEditor(doc, 'tpl');
  e.replaceBlocks(e.document, TEMPLATE as never);
  doc.getMap(SHARED_COLLAPSE_MAP).set('h1', true);
  return doc;
}

function copyOf(tpl: Y.Doc) {
  const copy = copyTemplateDoc(tpl);
  if (!copy.ok) throw new Error(copy.unknown);
  return copy;
}

describe('copiar una plantilla que es una página (copyTemplateDoc)', () => {
  it('copia todo, ids nuevos y únicos, plantilla intacta, semilla al final, colapsado con los ids nuevos', async () => {
    const tpl = makeTemplate();
    await tick();
    const vector = Y.encodeStateVector(tpl);
    const bytes = Y.encodeStateAsUpdate(tpl);
    const copy = copyOf(tpl);
    expect(Y.encodeStateVector(tpl)).toEqual(vector);
    expect(Y.encodeStateAsUpdate(tpl)).toEqual(bytes);

    const page = seeded();
    insertTemplateCopy(mountEditor(page, 'a') as never, page, copy);
    await tick();
    const doc = blocksOf(page);
    expect(doc.at(-1)!.id).toBe('initialBlockId');
    const tplBlocks = blocksOf(tpl).slice(0, TEMPLATE.length);
    expect(strip(doc.slice(0, -1))).toEqual(strip(tplBlocks));
    const ids = allIds(doc);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of allIds(tplBlocks)) expect(ids).not.toContain(id);
    expect([...mediaIdsInDoc(page)].sort()).toEqual([...mediaIdsInDoc(tpl)].sort());
    expect(storedPhotos(page)).toEqual(storedPhotos(tpl));
    expect(brokenGaps(page)).toEqual([]);
    expect(findUnknownContent(page)).toBeNull();
    expect([...page.getMap(SHARED_COLLAPSE_MAP).keys()]).toEqual([(copy.blocks[0] as { id: string }).id]);
  });

  it('una plantilla con algo que esta versión no conoce no se copia', async () => {
    // Sin editor encima (uno montado borraría el bloque que no conoce): la plantilla como llega de otro dispositivo.
    const made = makeTemplate();
    await tick();
    const tpl = new Y.Doc();
    Y.applyUpdate(tpl, Y.encodeStateAsUpdate(made));
    const fragment = tpl.getXmlFragment(CONTENT_FRAGMENT);
    const group = fragment.get(0) as Y.XmlElement;
    const container = new Y.XmlElement('blockContainer');
    container.setAttribute('id', 'nuevo');
    container.insert(0, [new Y.XmlElement('bloqueDelFuturo')]);
    group.insert(group.length, [container]);
    const vector = Y.encodeStateVector(tpl);
    const copy = copyTemplateDoc(tpl);
    expect(copy.ok).toBe(false);
    expect(Y.encodeStateVector(tpl)).toEqual(vector);
  });

  it('la versión publicada abre la página copiada sin escribir nada', async () => {
    const tpl = makeTemplate();
    await tick();
    const page = seeded();
    insertTemplateCopy(mountEditor(page, 'a') as never, page, copyOf(tpl));
    await tick();
    const clone = new Y.Doc();
    Y.applyUpdate(clone, Y.encodeStateAsUpdate(page));
    const before = Y.encodeStateVector(clone);
    mountEditor(clone, 'vieja', publishedSchema);
    await tick(20);
    expect(Y.encodeStateVector(clone)).toEqual(before);
  });

  it('sin red: aplicar en un dispositivo y escribir en otro, o aplicar en los dos, no pierde nada', async () => {
    const tpl = makeTemplate();
    await tick();
    const a = seeded();
    const b = seeded();
    insertTemplateCopy(mountEditor(a, 'a') as never, a, copyOf(tpl));
    typeAt(mountEditor(b, 'b'), 'initialBlockId', 'start', 'hola');
    await tick();
    applyLikeApp(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
    applyLikeApp(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
    await tick(20);
    expect(strip(blocksOf(a))).toEqual(strip(blocksOf(b)));
    expect(JSON.stringify(blocksOf(a))).toContain('hola');

    const c = seeded();
    const d = seeded();
    insertTemplateCopy(mountEditor(c, 'c') as never, c, copyOf(tpl));
    insertTemplateCopy(mountEditor(d, 'd') as never, d, copyOf(tpl));
    await tick();
    applyLikeApp(c, Y.encodeStateAsUpdate(d, Y.encodeStateVector(c)));
    applyLikeApp(d, Y.encodeStateAsUpdate(c, Y.encodeStateVector(d)));
    await tick(20);
    const bc = blocksOf(c);
    expect(bc.length).toBe(TEMPLATE.length * 2 + 1);
    const types = bc.slice(0, -1).map((x) => x.type);
    expect(types.slice(0, TEMPLATE.length)).toEqual(types.slice(TEMPLATE.length));
    expect(mediaIdsInDoc(c).size).toBe(3);
    expect(brokenGaps(c)).toEqual([]);
  });
});
