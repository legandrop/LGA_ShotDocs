// @vitest-environment jsdom
// Copiar y pegar una foto con sus anotaciones (P.20, D46; Docs/Doc_Anotar_Fotos.md, "Copiar y pegar con las anotaciones").
// Con el editor de verdad (el esquema de hoy, Yjs, el copiar y pegar de BlockNote): copiar en una página y pegar en
// otra lleva las formas de la foto a la página de destino; al portapapeles no va nada nuevo; pegar dos veces o en la
// misma página no duplica; cortar también lleva; un solo ⌘Z saca la foto y sus flechas; la poda no las borra; otro
// proyecto u otro workspace no las recibe; una versión vieja pega la foto limpia sin perder texto.
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { addShape, PHOTO_MARKUP_MAP, readFrame, shapeKey, updateShape, type ShapeFields } from '../media/markup';
import { carryMarkup, clipKey, clipScope, mediaIdsInText, snapshotMarkup } from '../media/markupClipboard';
import { PAGE_MARKUP_CAP, pageMarkupBytes } from '../media/markupLimits';
import { createMarkupPruner, PRUNE_AFTER_MS } from '../media/markupPrune';
import { mediaIdsInDoc } from '../media/usage';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { connect, editors, mountEditor, tick, undoManager, unmountAll, view, yText } from './collabHarness';
import { schema } from './editorSchema';
import { schema as previousPublished } from './fixtures/editorSchemaAnterior';
import { schema as publishedSchema } from './fixtures/editorSchemaMain';
import { clipFor, markupClipboardExtension, pasteWithMarkup, rememberClip, resetMarkupClipboard } from './markupClipboardEditor';

// jsdom no tiene ClipboardEvent (ProseMirror arma uno para pegar HTML).
const g = globalThis as { ClipboardEvent?: unknown };
g.ClipboardEvent ??= class extends Event {
  clipboardData = null;
};

const ID = (n: number) => `0f8fad5b-d9cb-469f-a165-7086772895${String(n).padStart(2, '0')}`;
const URL_OF = (n: number) => `sdmedia://${ID(n)}`;
const text = (t: string) => ({ type: 'text', text: t, styles: {} });
const inline = (n: number, w = 0.3) => ({ type: 'photo', props: { url: URL_OF(n), name: `F${n}.jpg`, w } });
const FRAME = { w: 4000, h: 3000 };
const WS = 'wanka';
const SCOPE = clipScope(WS, 'proyecto-1');

/** La página de origen: una foto-bloque (1) y una foto en línea (2) anotadas, y una foto sin anotar (3). */
const SOURCE: PartialBlock[] = [
  { id: 'antes', type: 'paragraph', content: 'Antes de la foto' },
  { id: 'blk', type: 'image', props: { url: URL_OF(1), name: 'F1.jpg' } },
  { id: 'par', type: 'paragraph', content: [text('Plano 12 '), inline(2), text(' y '), inline(3), text(' fin')] },
] as never;

const SHAPES: [string, ShapeFields][] = [
  ['flecha', { type: 'arrow', zValue: 1, posX: 2000, posY: 2000, startX: 0, startY: 0, endX: 900, endY: -600, strokeColor: '#FF3B30', strokeWidth: 9 }],
  ['texto', { type: 'text', zValue: 2, posX: 150, posY: 700, rectX: 0, rectY: 0, rectW: 1400, rectH: 200, text: 'Borrar el poste', fontSize: 90 }],
  ['trazo', { type: 'freehand_pencil', zValue: 3, posX: 2500, posY: 500, points: [0, 0, 40, 30, 120, 60] }],
];

/** Un portapapeles como el del navegador (solo texto: lo que pone el editor). */
class Clip {
  store = new Map<string, string>();
  files: File[] = [];
  items: unknown[] = [];
  get types() {
    return [...this.store.keys()];
  }
  setData(type: string, value: string) {
    this.store.set(type, value);
  }
  getData(type: string) {
    return this.store.get(type) ?? '';
  }
  clearData() {
    this.store.clear();
  }
}

const mapOf = (doc: Y.Doc) => doc.getMap<unknown>(PHOTO_MARKUP_MAP);

/** Un editor de página como el de la app: el copiar de las anotaciones y el pegar de PageEditor.tsx. */
function mountPage(doc: Y.Doc, scope: () => string = () => SCOPE, blocks: PartialBlock[] | null = null, onLimit?: () => void): BlockNoteEditor {
  const editor = BlockNoteEditor.create(
    withCollaboration({
      schema,
      collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
      extensions: [markupClipboardExtension({ doc, scope })],
      pasteHandler: (ctx) =>
        pasteWithMarkup({ data: ctx.event.clipboardData, view: ctx.editor.prosemirrorView, doc, scope: scope(), run: () => ctx.defaultPasteHandler(), onLimit }),
    }),
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  editor.mount(el);
  editors.push(editor);
  if (blocks) editor.replaceBlocks(editor.document, blocks as never);
  return editor;
}

function annotate(doc: Y.Doc, n: number, shapes = SHAPES): void {
  for (const [id, fields] of shapes) addShape(doc, ID(n), id, fields, FRAME);
}

/** Copia (o corta) lo elegido como el navegador: el evento llega al editor y devuelve lo que quedó en el portapapeles. */
function copy(E: BlockNoteEditor, kind: 'copy' | 'cut' = 'copy'): Clip {
  const data = new Clip();
  const event = new Event(kind, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: data });
  view(E).dom.dispatchEvent(event);
  return data;
}

/** Pega lo que hay en `data` donde está el cursor. */
function paste(E: BlockNoteEditor, data: Clip): void {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: data });
  view(E).dom.dispatchEvent(event);
}

/** Elige el bloque de la foto (como un clic en ella). */
function selectBlock(E: BlockNoteEditor, id: string): void {
  const v = view(E);
  let pos = -1;
  v.state.doc.descendants((node, p) => {
    if (pos < 0 && node.type.name === 'blockContainer' && node.attrs.id === id) pos = p;
    return pos < 0;
  });
  v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, pos)));
}

/** Elige de `from` a `to` (texto, con lo que haya en el medio). */
function selectText(E: BlockNoteEditor, fromBlock: string, toBlock: string): void {
  const v = view(E);
  const ends: Record<string, [number, number]> = {};
  v.state.doc.descendants((node, p) => {
    if (node.type.name === 'blockContainer') {
      const content = node.firstChild!;
      ends[node.attrs.id as string] = [p + 2, p + 2 + content.content.size];
    }
    return true;
  });
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, ends[fromBlock][0], ends[toBlock][1])));
}

/** Las claves del mapa de una foto, con sus valores en JSON. */
function photoKeys(doc: Y.Doc, n: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(mapOf(doc).toJSON())) if (k.startsWith(ID(n))) out[k] = v;
  return out;
}

async function sourcePage(scope?: () => string): Promise<{ doc: Y.Doc; E: BlockNoteEditor }> {
  const doc = new Y.Doc();
  const E = mountPage(doc, scope, SOURCE);
  await tick(10);
  annotate(doc, 1);
  annotate(doc, 2, SHAPES.slice(0, 2));
  return { doc, E };
}

async function destPage(scope?: () => string, onLimit?: () => void): Promise<{ doc: Y.Doc; E: BlockNoteEditor }> {
  const doc = new Y.Doc();
  const E = mountPage(doc, scope, [{ id: 'd1', type: 'paragraph', content: 'Destino' }] as never, onLimit);
  await tick(10);
  E.setTextCursorPosition('d1', 'end');
  return { doc, E };
}

beforeEach(() => resetMarkupClipboard());
afterEach(() => {
  unmountAll();
  resetMarkupClipboard();
});

describe('copiar y pegar en otra página del mismo proyecto', () => {
  it('la foto-bloque llega con su marco y todas sus formas, campo por campo; la de origen no cambia', async () => {
    const A = await sourcePage();
    const B = await destPage();
    const before = photoKeys(A.doc, 1);
    selectBlock(A.E, 'blk');
    const data = copy(A.E);
    paste(B.E, data);
    await tick(10);
    expect(mediaIdsInDoc(B.doc).has(ID(1))).toBe(true);
    expect(photoKeys(B.doc, 1)).toEqual(before);
    expect(readFrame(mapOf(B.doc).get(ID(1)))).toEqual({ v: 1, ...FRAME });
    expect(photoKeys(A.doc, 1)).toEqual(before);
    // Solo se llevó lo de la foto copiada.
    expect(Object.keys(photoKeys(B.doc, 2))).toEqual([]);
  });

  it('al portapapeles va lo mismo que sin anotaciones: ni las formas ni sus textos salen de la app', async () => {
    const A = await sourcePage();
    selectText(A.E, 'antes', 'par');
    const withMarkup = copy(A.E);
    expect(withMarkup.types.sort()).toEqual(['blocknote/html', 'text/html', 'text/plain']);
    for (const type of withMarkup.types) {
      expect(withMarkup.getData(type)).not.toContain('Borrar el poste');
      expect(withMarkup.getData(type)).not.toContain('FF3B30');
      expect(withMarkup.getData(type)).not.toContain(PHOTO_MARKUP_MAP);
    }
    // Lo mismo que copia un editor sin esta función (el de la versión publicada, con el mismo contenido).
    const plainDoc = new Y.Doc();
    Y.applyUpdate(plainDoc, Y.encodeStateAsUpdate(A.doc));
    const P = mountEditor(plainDoc, 'sin', schema);
    await tick(10);
    selectText(P, 'antes', 'par');
    const plain = copy(P);
    for (const type of plain.types) expect(withMarkup.getData(type)).toBe(plain.getData(type));
    // Nada en el almacenamiento del navegador.
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('texto y varias fotos en la misma selección: llegan las anotadas con lo suyo, la sin anotar limpia, y el texto entero', async () => {
    const A = await sourcePage();
    const B = await destPage();
    selectText(A.E, 'antes', 'par');
    paste(B.E, copy(A.E));
    await tick(10);
    expect(yText(B.doc)).toContain('Antes de la foto');
    expect(yText(B.doc)).toContain('Plano 12');
    expect(yText(B.doc)).toContain('fin');
    expect([...mediaIdsInDoc(B.doc)].sort()).toEqual([ID(1), ID(2), ID(3)].sort());
    expect(photoKeys(B.doc, 1)).toEqual(photoKeys(A.doc, 1));
    expect(photoKeys(B.doc, 2)).toEqual(photoKeys(A.doc, 2));
    expect(Object.keys(photoKeys(B.doc, 3))).toEqual([]);
    expect(mapOf(B.doc).size).toBe(1 + 3 + 1 + 2);
  });

  it('cortar y pegar: la foto deja la página de origen y llega con sus anotaciones', async () => {
    const A = await sourcePage();
    const B = await destPage();
    const before = photoKeys(A.doc, 1);
    selectBlock(A.E, 'blk');
    const data = copy(A.E, 'cut');
    await tick(10);
    expect(mediaIdsInDoc(A.doc).has(ID(1))).toBe(false);
    paste(B.E, data);
    await tick(10);
    expect(photoKeys(B.doc, 1)).toEqual(before);
    // En el origen quedan hasta la poda (10 minutos afuera).
    expect(photoKeys(A.doc, 1)).toEqual(before);
  });

  it('pegar dos veces no duplica nada (las mismas claves) y lo movido después de pegar queda movido', async () => {
    const A = await sourcePage();
    const B = await destPage();
    selectBlock(A.E, 'blk');
    const data = copy(A.E);
    paste(B.E, data);
    await tick(10);
    updateShape(B.doc, ID(1), 'flecha', { posX: 10, posY: 20 });
    const writes: unknown[] = [];
    mapOf(B.doc).observeDeep((_, tr) => writes.push(tr.origin));
    B.E.setTextCursorPosition('d1', 'end');
    paste(B.E, data);
    await tick(10);
    expect(B.E.document.filter((b) => b.type === 'image')).toHaveLength(2);
    expect(writes).toEqual([]);
    expect(mapOf(B.doc).size).toBe(1 + 3);
    expect((mapOf(B.doc).get(shapeKey(ID(1), 'flecha')) as Y.Map<unknown>).get('posX')).toBe(10);
  });

  it('pegar en la misma página (duplicar la foto): las dos comparten el dibujo y el mapa no se toca', async () => {
    const A = await sourcePage();
    const before = mapOf(A.doc).toJSON();
    const writes: unknown[] = [];
    mapOf(A.doc).observeDeep((_, tr) => writes.push(tr.origin));
    selectBlock(A.E, 'blk');
    const data = copy(A.E);
    A.E.setTextCursorPosition('antes', 'end');
    paste(A.E, data);
    await tick(10);
    expect(A.E.document.filter((b) => b.type === 'image')).toHaveLength(2);
    expect(writes).toEqual([]);
    expect(mapOf(A.doc).toJSON()).toEqual(before);
  });

  it('si la página ya tiene la foto con sus propias formas, se suman las copiadas y las suyas quedan', async () => {
    const A = await sourcePage();
    const B = await destPage();
    B.E.insertBlocks([{ type: 'image', props: { url: URL_OF(1), name: 'F1.jpg' } }] as never, 'd1', 'after');
    addShape(B.doc, ID(1), 'propia', { type: 'ellipse', zValue: 9, posX: 1, posY: 1, rectX: 0, rectY: 0, rectW: 10, rectH: 10 }, FRAME);
    selectBlock(A.E, 'blk');
    B.E.setTextCursorPosition('d1', 'end');
    paste(B.E, copy(A.E));
    await tick(10);
    expect(Object.keys(photoKeys(B.doc, 1)).sort()).toEqual([ID(1), ...['flecha', 'propia', 'texto', 'trazo'].map((s) => shapeKey(ID(1), s))].sort());
  });

  it('con otro marco para la misma foto en el destino, esa foto no se lleva nada (las coordenadas no coincidirían)', () => {
    const src = new Y.Doc();
    for (const [id, f] of SHAPES) addShape(src, ID(1), id, f, FRAME);
    const dst = new Y.Doc();
    addShape(dst, ID(1), 'x', { type: 'line', posX: 0, posY: 0, startX: 0, startY: 0, endX: 5, endY: 5 }, { w: 1000, h: 750 });
    const res = carryMarkup(dst, snapshotMarkup(mapOf(src), [ID(1)]), new Set([ID(1)]));
    expect(res.skipped).toEqual([{ fileId: ID(1), reason: 'frame' }]);
    expect(mapOf(dst).size).toBe(2);
  });
});

describe('lo que no viaja', () => {
  it('a otro proyecto del workspace la foto llega como hoy y sin anotaciones', async () => {
    const A = await sourcePage();
    const B = await destPage(() => clipScope(WS, 'proyecto-2'));
    selectBlock(A.E, 'blk');
    paste(B.E, copy(A.E));
    await tick(10);
    expect(mediaIdsInDoc(B.doc).has(ID(1))).toBe(true);
    expect(mapOf(B.doc).size).toBe(0);
  });

  it('a otro workspace (otra isla) tampoco; y sin proyecto conocido nada viaja', async () => {
    const A = await sourcePage();
    const B = await destPage(() => clipScope('otro-ws', 'proyecto-1'));
    selectBlock(A.E, 'blk');
    const data = copy(A.E);
    paste(B.E, data);
    await tick(10);
    expect(mapOf(B.doc).size).toBe(0);
    expect(clipScope(WS, undefined)).toBe('');
    expect(clipFor(data, '')).toBeNull();
  });

  it('si después se copió otra cosa (o el portapapeles cambió afuera), pegar la foto vieja no trae anotaciones', async () => {
    const A = await sourcePage();
    const B = await destPage();
    selectBlock(A.E, 'blk');
    const first = copy(A.E);
    // Otra copia, sin fotos anotadas: olvida la anterior.
    selectText(A.E, 'antes', 'antes');
    copy(A.E);
    paste(B.E, first);
    await tick(10);
    expect(mediaIdsInDoc(B.doc).has(ID(1))).toBe(true);
    expect(mapOf(B.doc).size).toBe(0);
    // Lo mismo si el portapapeles trae otra cosa que lo copiado (por ejemplo, lo copiado en otra app).
    selectBlock(A.E, 'blk');
    const again = copy(A.E);
    const other = new Clip();
    other.setData('text/html', again.getData('text/html') + ' ');
    expect(clipFor(other, SCOPE)).toBeNull();
    expect(clipFor(again, SCOPE)).not.toBeNull();
  });

  it('una foto que no queda en el contenido (pegada como texto en un bloque de código) no deja anotaciones huérfanas', () => {
    const src = new Y.Doc();
    annotate(src, 1);
    const dst = new Y.Doc();
    const res = carryMarkup(dst, snapshotMarkup(mapOf(src), [ID(1)]), new Set());
    expect(res.skipped).toEqual([{ fileId: ID(1), reason: 'notInContent' }]);
    expect(mapOf(dst).size).toBe(0);
  });

  it('si la página de destino está llena, la foto llega limpia y se avisa', async () => {
    const A = await sourcePage();
    const onLimit = vi.fn();
    const B = await destPage(undefined, onLimit);
    // Una página con anotaciones casi al tope (otra foto con un texto grande por forma).
    let i = 0;
    while (pageMarkupBytes(mapOf(B.doc)) < PAGE_MARKUP_CAP - 600) {
      addShape(B.doc, ID(9), `t${i++}`, { type: 'text', posX: 0, posY: 0, text: 'x'.repeat(1900) }, FRAME);
    }
    selectBlock(A.E, 'blk');
    paste(B.E, copy(A.E));
    await tick(10);
    expect(mediaIdsInDoc(B.doc).has(ID(1))).toBe(true);
    expect(Object.keys(photoKeys(B.doc, 1))).toEqual([]);
    expect(onLimit).toHaveBeenCalledTimes(1);
  });
});

describe('deshacer y la poda', () => {
  it('un solo ⌘Z saca la foto pegada y sus flechas; rehacer trae las dos; lo escrito antes es otro paso', async () => {
    const A = await sourcePage();
    const B = await destPage();
    B.E.insertInlineContent(' escrito');
    selectBlock(A.E, 'blk');
    paste(B.E, copy(A.E));
    await tick(10);
    expect(mapOf(B.doc).size).toBe(4);
    const um = undoManager(B.E);
    um.undo();
    await tick(10);
    expect(mediaIdsInDoc(B.doc).has(ID(1))).toBe(false);
    expect(mapOf(B.doc).size).toBe(0);
    expect(yText(B.doc)).toContain('Destino escrito');
    um.redo();
    await tick(10);
    expect(mediaIdsInDoc(B.doc).has(ID(1))).toBe(true);
    expect(photoKeys(B.doc, 1)).toEqual(photoKeys(A.doc, 1));
  });

  it('el ⌘Z de la página sigue sin deshacer lo dibujado con el anotador (solo lo pegado)', async () => {
    const A = await sourcePage();
    const B = await destPage();
    selectBlock(A.E, 'blk');
    paste(B.E, copy(A.E));
    await tick(10);
    undoManager(B.E).stopCapturing();
    addShape(B.doc, ID(1), 'nueva', { type: 'line', posX: 0, posY: 0, startX: 0, startY: 0, endX: 5, endY: 5 });
    B.E.setTextCursorPosition('d1', 'end');
    B.E.insertInlineContent('!');
    await tick(10);
    undoManager(B.E).undo();
    await tick(10);
    // Deshizo el texto; la forma del anotador sigue.
    expect(mapOf(B.doc).has(shapeKey(ID(1), 'nueva'))).toBe(true);
    expect(mapOf(B.doc).size).toBe(5);
  });

  it('la poda no borra lo recién pegado (a los 10 minutos sigue), y sí lo de un pegado deshecho', async () => {
    const A = await sourcePage();
    const B = await destPage();
    let now = 1_000_000;
    const pruner = createMarkupPruner(B.doc, () => now);
    selectBlock(A.E, 'blk');
    paste(B.E, copy(A.E));
    await tick(10);
    expect(pruner.check()).toEqual([]);
    now += PRUNE_AFTER_MS + 60_000;
    expect(pruner.check()).toEqual([]);
    expect(mapOf(B.doc).size).toBe(4);
    // Deshecho el pegado, la foto no está ni sus formas (el deshacer ya las sacó: no quedan huérfanas que podar).
    undoManager(B.E).undo();
    await tick(10);
    expect(mapOf(B.doc).size).toBe(0);
    expect(pruner.check()).toEqual([]);
  });

  it('sin red: lo pegado en un dispositivo llega al otro con la foto y sus formas, y ninguna poda lo borra', async () => {
    const A = await sourcePage();
    const B1 = await destPage();
    const doc2 = new Y.Doc();
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(B1.doc));
    const net = connect(B1.doc, doc2, 'async');
    net.offline();
    selectBlock(A.E, 'blk');
    paste(B1.E, copy(A.E));
    await tick(10);
    expect(mapOf(doc2).size).toBe(0);
    let now = 0;
    const pruners = [createMarkupPruner(B1.doc, () => now), createMarkupPruner(doc2, () => now)];
    net.online();
    await tick(10);
    for (const p of pruners) p.check();
    now += PRUNE_AFTER_MS * 2;
    for (const p of pruners) expect(p.check()).toEqual([]);
    expect(mediaIdsInDoc(doc2).has(ID(1))).toBe(true);
    expect(photoKeys(doc2, 1)).toEqual(photoKeys(A.doc, 1));
  });
});

describe('versiones viejas (la regla de degradar)', () => {
  const versions = [
    ['la versión publicada', publishedSchema],
    ['la versión anterior', previousPublished],
  ] as const;

  for (const [name, old] of versions) {
    it(`${name} pega lo copiado en la de hoy: la foto llega limpia y no se pierde texto`, async () => {
      const A = await sourcePage();
      selectText(A.E, 'antes', 'par');
      const data = copy(A.E);
      const doc = new Y.Doc();
      const O = mountEditor(doc, 'vieja', old);
      await tick(10);
      O.replaceBlocks(O.document, [{ id: 'o1', type: 'paragraph', content: 'Vieja' }] as never);
      O.setTextCursorPosition('o1', 'end');
      paste(O, data);
      await tick(10);
      expect(yText(doc)).toContain('Antes de la foto');
      expect(yText(doc)).toContain('Plano 12');
      expect(yText(doc)).toContain('fin');
      expect([...mediaIdsInDoc(doc)].sort()).toEqual([ID(1), ID(2), ID(3)].sort());
      expect(mapOf(doc).size).toBe(0);
    });

    it(`${name} abre la página con lo pegado, la edita y saca la foto: las formas pegadas siguen intactas`, async () => {
      const A = await sourcePage();
      const B = await destPage();
      selectText(A.E, 'antes', 'par');
      paste(B.E, copy(A.E));
      await tick(10);
      const before = mapOf(B.doc).toJSON();
      unmountAll();
      const O = mountEditor(B.doc, 'vieja', old);
      await tick(20);
      O.insertBlocks([{ type: 'paragraph', content: 'nota de la vieja' }] as never, O.document[0].id, 'after');
      const img = O.document.find((b) => b.type === 'image');
      if (img) O.removeBlocks([img.id]);
      await tick(20);
      expect(yText(B.doc)).toContain('nota de la vieja');
      expect(mapOf(B.doc).toJSON()).toEqual(before);
    });
  }
});

describe('las piezas', () => {
  it('los archivos que nombra lo copiado, sin repetir y en minúscula; nada que no sea un id', () => {
    const html = `<img src="${URL_OF(1)}"><span data-url="${URL_OF(1).toUpperCase().replace('SDMEDIA', 'sdmedia')}"></span> sdmedia://no-es-un-id ${URL_OF(2)}`;
    expect(mediaIdsInText(html)).toEqual([ID(1), ID(2)]);
  });

  it('la copia toma los campos que esta versión no conoce, y no comparte objetos con el mapa', () => {
    const doc = new Y.Doc();
    annotate(doc, 1);
    updateShape(doc, ID(1), 'trazo', { futuro: 7 });
    const snap = snapshotMarkup(mapOf(doc), [ID(1), ID(2)]);
    expect(snap).toHaveLength(1);
    const trazo = snap[0].shapes.find(([id]) => id === 'trazo')![1];
    expect(trazo.futuro).toBe(7);
    (trazo.points as number[]).push(999);
    expect(((mapOf(doc).get(shapeKey(ID(1), 'trazo')) as Y.Map<unknown>).get('points') as number[]).length).toBe(6);
  });

  it('la clave de una copia es lo que puso el editor: el HTML propio, si no el común, si no el texto', () => {
    const c = new Clip();
    expect(clipKey(c)).toBe('');
    c.setData('text/plain', 'a');
    expect(clipKey(c)).toBe('text/plain\na');
    c.setData('text/html', '<p>a</p>');
    expect(clipKey(c)).toBe('text/html\n<p>a</p>');
    c.setData('blocknote/html', '<p data-x>a</p>');
    expect(clipKey(c)).toBe('blocknote/html\n<p data-x>a</p>');
  });

  it('otra pestaña de la app recibe la copia (copiar en una ventana y pegar en otra) y una basura no la pisa con algo raro', async () => {
    const other = new BroadcastChannel('sd-markup-clip');
    const got: unknown[] = [];
    other.onmessage = (e) => got.push(e.data);
    const doc = new Y.Doc();
    annotate(doc, 1);
    const data = new Clip();
    data.setData('blocknote/html', `<img src="${URL_OF(1)}">`);
    // Esta pestaña abre el canal con su primer editor.
    mountPage(new Y.Doc());
    rememberClip({ key: clipKey(data), scope: SCOPE, photos: snapshotMarkup(mapOf(doc), [ID(1)]) });
    await vi.waitFor(() => expect(got).toHaveLength(1));
    // Lo que llega de otra pestaña reemplaza la copia de esta.
    resetMarkupClipboard();
    mountPage(new Y.Doc());
    expect(clipFor(data, SCOPE)).toBeNull();
    other.postMessage(got[0]);
    await vi.waitFor(() => expect(clipFor(data, SCOPE)?.photos[0].fileId).toBe(ID(1)));
    other.postMessage({ key: 5 });
    await vi.waitFor(() => expect(clipFor(data, SCOPE)).toBeNull());
    other.close();
  });
});
