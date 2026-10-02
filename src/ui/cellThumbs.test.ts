// @vitest-environment jsdom
// El alto de las miniaturas de una tabla (Docs/Doc_Fotos_En_Linea.md, "Alto de las miniaturas (D27 → B)"): una propiedad
// más de la tabla (`thumbHeight`: 64, 96 o 160 px; de fábrica 96), no un tipo nuevo. Acá: el valor de fábrica, cambiarlo
// sin tocar las fotos y en un solo deshacer, lo que se ve en el bloque, copiar y pegar, dos a la vez y la versión
// publicada (que la ignora y, si edita la tabla, vuelve a 96 sin perder nada).
import { BlockNoteEditor, selectedFragmentToHTML, type PartialBlock } from '@blocknote/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import {
  DEFAULT_THUMB_HEIGHT,
  setThumbHeight,
  tableAt,
  tableHasPhotos,
  tablesOf,
  THUMB_HEIGHT_ATTR,
  THUMB_HEIGHT_PROP,
  thumbHeightOf,
  thumbHeightOfTables,
} from './cellThumbs';
import { connect, mountEditor, tick, undoManager, unmountAll, view as viewOf } from './collabHarness';
import { editorSchemaOptions } from './editorSchema';
import { schema as previousPublished } from './fixtures/editorSchemaAnterior';
import { schema as publishedSchema } from './fixtures/editorSchemaMain';
import { PHOTO } from './inlinePhoto';
import { brokenGaps, storedPhotos } from './photoHarness';

afterEach(unmountAll);
// jsdom no tiene `ClipboardEvent` (pegar de ProseMirror lo usa).
(globalThis as { ClipboardEvent?: unknown }).ClipboardEvent ??= class extends Event {
  clipboardData: unknown = null;
};

const ID = (n: number) => `0f8fad5b-d9cb-469f-a165-7086772895${String(n).padStart(2, '0')}`;
const text = (t: string) => ({ type: 'text', text: t, styles: {} });
const sdPhoto = (n: number, w = 0) => ({ type: 'photo', props: { url: `sdmedia://${ID(n)}`, name: `F${n}.jpg`, w } });

/** Una tabla de 2 × 2 con tres miniaturas y una foto agrandada (`w = 0,5`), y otra tabla sin fotos. */
const page = (height?: number): PartialBlock[] =>
  [
    { id: 'a', type: 'paragraph', content: [text('Antes')] },
    {
      id: 'tb',
      type: 'table',
      ...(height ? { props: { [THUMB_HEIGHT_PROP]: height } } : {}),
      content: {
        type: 'tableContent',
        rows: [{ cells: [[text('Plano')], [sdPhoto(1), sdPhoto(2)]] }, { cells: [[text('1A'), sdPhoto(3)], [sdPhoto(4, 0.5)]] }],
      },
    },
    { id: 'tc', type: 'table', content: { type: 'tableContent', rows: [{ cells: [[text('sin fotos')], [text('x')]] }] } },
  ] as never;

function mounted(height?: number, doc = new Y.Doc()): BlockNoteEditor {
  const E = mountEditor(doc);
  E.replaceBlocks(E.document, page(height));
  return E;
}

/** Las posiciones de las tablas, en orden. */
function tables(E: BlockNoteEditor): number[] {
  const out: number[] = [];
  viewOf(E).state.doc.descendants((n, pos) => {
    if (n.type.name === 'table') out.push(pos);
    return n.type.name !== 'table';
  });
  return out;
}

/** Las fotos de la página: `nombre@w`. */
function photos(E: BlockNoteEditor): string[] {
  const out: string[] = [];
  viewOf(E).state.doc.descendants((n) => {
    if (n.type.name === PHOTO) out.push(`${n.attrs.name}@${n.attrs.w}`);
    return true;
  });
  return out;
}

const tableProp = (E: BlockNoteEditor, id = 'tb') => (E.getBlock(id)?.props as Record<string, unknown>)[THUMB_HEIGHT_PROP];
/** El atributo del bloque de la tabla en pantalla (lo que lee styles.css), o `null`. */
const shown = (E: BlockNoteEditor, n = 0) =>
  E.domElement!.querySelectorAll('.bn-block-content[data-content-type="table"]')[n]?.getAttribute(THUMB_HEIGHT_ATTR) ?? null;
/** El alto guardado en Yjs en cada tabla (`undefined` si no está). */
function storedHeights(doc: Y.Doc): unknown[] {
  const out: unknown[] = [];
  const walk = (el: Y.XmlElement | Y.XmlFragment) => {
    for (const c of el.toArray()) {
      if (!(c instanceof Y.XmlElement)) continue;
      if (c.nodeName === 'table') out.push(c.getAttribute(THUMB_HEIGHT_PROP));
      else walk(c);
    }
  };
  walk(doc.getXmlFragment(CONTENT_FRAGMENT));
  return out;
}

/** La posición del principio (o del final, con `end`) del texto de la celda `r`, `c` de la primera tabla. */
function cellPos(E: BlockNoteEditor, r: number, c: number, end = false): number {
  let at = -1;
  let i = 0;
  viewOf(E).state.doc.descendants((n, pos) => {
    if (n.type.name === 'tableParagraph') {
      if (i === r * 2 + c) at = pos + 1 + (end ? n.content.size : 0);
      i++;
    }
    return at < 0;
  });
  return at;
}

describe('el valor y dónde se guarda', () => {
  it('thumbHeightOf: solo 64, 96 o 160; cualquier otra cosa es 96', () => {
    expect([64, 96, 160, '160', ' 64 ', 128, 0, null, undefined, 'x', '', NaN].map(thumbHeightOf)).toEqual([64, 96, 160, 160, 64, 96, 96, 96, 96, 96, 96, 96]);
  });

  it('de fábrica 96: una tabla nueva lo tiene y en pantalla no lleva el atributo', () => {
    const E = mounted();
    expect(tableProp(E)).toBe(DEFAULT_THUMB_HEIGHT);
    expect(tableProp(E, 'tc')).toBe(96);
    expect(shown(E)).toBeNull();
  });

  it('cambiarlo toca solo el atributo de la tabla: las fotos (y la agrandada) quedan igual; se ve en el bloque de la tabla', () => {
    const E = mounted();
    const before = photos(E);
    const [tb] = tables(E);
    expect(setThumbHeight(viewOf(E), [tb], 160)).toBe(true);
    expect(tableProp(E)).toBe(160);
    expect(photos(E)).toEqual(before);
    expect(before).toContain('F4.jpg@0.5');
    expect(shown(E)).toBe('160');
    // La otra tabla, igual.
    expect(tableProp(E, 'tc')).toBe(96);
    expect(shown(E, 1)).toBeNull();
    setThumbHeight(viewOf(E), [tb], 64);
    expect(shown(E)).toBe('64');
    // Volver a 96 saca el atributo (es el de fábrica).
    setThumbHeight(viewOf(E), [tb], 96);
    expect(shown(E)).toBeNull();
    // Sin cambio, nada.
    expect(setThumbHeight(viewOf(E), [tb], 96)).toBe(false);
  });

  it('un solo paso de deshacer; rehacer lo vuelve a poner', async () => {
    const E = mounted();
    const um = undoManager(E);
    um.stopCapturing();
    setThumbHeight(viewOf(E), tables(E), 160);
    expect(tableProp(E)).toBe(160);
    um.undo();
    await tick();
    expect(tableProp(E)).toBe(96);
    expect(shown(E)).toBeNull();
    um.redo();
    await tick();
    expect(tableProp(E)).toBe(160);
    expect(shown(E)).toBe('160');
  });

  it('una tabla escrita con el alto (de otro dispositivo, al abrir la página) se ve con su alto', () => {
    const doc = new Y.Doc();
    mounted(64, doc);
    unmountAll();
    const E = mountEditor(doc);
    expect(tableProp(E)).toBe(64);
    expect(shown(E)).toBe('64');
  });

  it('las tablas de unas fotos, su alto común y si tienen fotos', () => {
    const E = mounted();
    const [tb, tc] = tables(E);
    const doc = viewOf(E).state.doc;
    const photoPositions: number[] = [];
    doc.descendants((n, pos) => {
      if (n.type.name === PHOTO) photoPositions.push(pos);
      return true;
    });
    expect(photoPositions.map((p) => tableAt(doc, p))).toEqual([tb, tb, tb, tb]);
    expect(tablesOf(doc, photoPositions)).toEqual([tb]);
    expect(tableAt(doc, 1)).toBeNull();
    expect(tableHasPhotos(doc.nodeAt(tb)!)).toBe(true);
    expect(tableHasPhotos(doc.nodeAt(tc)!)).toBe(false);
    expect(thumbHeightOfTables(doc, [tb, tc])).toBe(96);
    setThumbHeight(viewOf(E), [tb], 160);
    expect(thumbHeightOfTables(viewOf(E).state.doc, [tb, tc])).toBeNull();
    // Las dos a la vez, en un solo cambio.
    setThumbHeight(viewOf(E), [tb, tc], 64);
    expect([tableProp(E), tableProp(E, 'tc')]).toEqual([64, 64]);
  });
});

describe('copiar y pegar', () => {
  it('copiar la tabla y pegarla dentro de la app conserva el alto (y las fotos); una de 96 llega con 96', () => {
    const E = mounted(160);
    const v = viewOf(E);
    const blockPos = tables(E)[0] - 1;
    v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, blockPos)));
    const { clipboardHTML } = selectedFragmentToHTML(v, E as never);
    expect(clipboardHTML).toContain(`${THUMB_HEIGHT_ATTR}="160"`);

    const target = BlockNoteEditor.create(editorSchemaOptions) as unknown as BlockNoteEditor;
    const el = document.createElement('div');
    document.body.append(el);
    target.mount(el);
    target.replaceBlocks(target.document, [{ type: 'paragraph' }] as never);
    target.pasteHTML(clipboardHTML, true);
    const pasted = target.document.find((b) => b.type === 'table');
    expect(pasted).toBeDefined();
    expect((pasted!.props as Record<string, unknown>)[THUMB_HEIGHT_PROP]).toBe(160);
    expect(photos(target)).toEqual(['F1.jpg@0', 'F2.jpg@0', 'F3.jpg@0', 'F4.jpg@0.5']);

    // Una tabla de 96 no lleva el atributo en el HTML y llega con 96.
    v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, tables(E)[1] - 1)));
    const plain = selectedFragmentToHTML(v, E as never).clipboardHTML;
    expect(plain).not.toContain(THUMB_HEIGHT_ATTR);
    target.pasteHTML(plain, true);
    const second = target.document.filter((b) => b.type === 'table')[1];
    expect((second.props as Record<string, unknown>)[THUMB_HEIGHT_PROP]).toBe(96);
    target.unmount();
  });
});

describe('dos a la vez', () => {
  it('uno cambia el alto mientras el otro escribe y agrega una foto en la misma tabla: quedan las dos cosas, iguales en los dos', async () => {
    const docA = new Y.Doc();
    const A = mounted(undefined, docA);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const B = mountEditor(docB, 'b');
    const net = connect(docA, docB, 'async');
    setThumbHeight(viewOf(A), tables(A), 160);
    const vb = viewOf(B);
    vb.dispatch(vb.state.tr.insertText(' nota', cellPos(B, 0, 0, true)));
    vb.dispatch(vb.state.tr.insert(cellPos(B, 1, 1, true), vb.state.schema.nodes[PHOTO].create({ url: `sdmedia://${ID(5)}`, name: 'F5.jpg', w: 0 })));
    net.flush();
    await tick(20);
    for (const E of [A, B]) {
      expect(tableProp(E)).toBe(160);
      expect(shown(E)).toBe('160');
      expect(photos(E)).toEqual(['F1.jpg@0', 'F2.jpg@0', 'F3.jpg@0', 'F4.jpg@0.5', 'F5.jpg@0']);
      expect(E.domElement!.textContent).toContain('Plano nota');
    }
    expect(storedHeights(docA)).toEqual(storedHeights(docB));
  });
});

describe('versiones publicadas (D98)', () => {
  const copyOf = (doc: Y.Doc) => {
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    const updates: Uint8Array[] = [];
    copy.on('update', (u: Uint8Array) => updates.push(u));
    return { doc: copy, updates };
  };

  /** Una página con la tabla en Large, escrita por esta versión. */
  function largePage(): Y.Doc {
    const doc = new Y.Doc();
    const E = mounted(undefined, doc);
    setThumbHeight(viewOf(E), tables(E), 160);
    unmountAll();
    return doc;
  }

  const versions = [
    ['la versión publicada', publishedSchema],
    ['la versión publicada de v0.083 a v0.092', previousPublished],
  ] as const;
  for (const [name, published] of versions) {
    it(`${name} abre la página sin escribir nada; al editar la tabla no pierde ninguna foto ni texto, y la tabla vuelve a 96`, async () => {
      const shared = largePage();
      const before = storedPhotos(shared);
      expect(storedHeights(shared)[0]).toBe(160);
      const { doc, updates } = copyOf(shared);
      const old = mountEditor(doc, 'old', published);
      await tick(20);
      // No conoce la propiedad: no la escribe ni la saca al abrir.
      expect(updates).toEqual([]);
      expect(storedHeights(doc)[0]).toBe(160);
      expect(viewOf(old).state.schema.nodes.table.spec.attrs?.[THUMB_HEIGHT_PROP]).toBeUndefined();
      // Escribe en una celda con fotos y en otra.
      const ov = viewOf(old);
      ov.dispatch(ov.state.tr.insertText(' nota', cellPos(old, 1, 0, true)));
      ov.dispatch(ov.state.tr.insertText('!', cellPos(old, 0, 0, true)));
      await tick(20);
      expect(storedPhotos(doc)).toEqual(before);
      expect(brokenGaps(doc)).toEqual([]);
      // Al editar la tabla, y-prosemirror le saca los atributos que su esquema no tiene: pierde solo el alto.
      expect(storedHeights(doc)[0]).toBeUndefined();
      unmountAll();
      const now = mountEditor(doc);
      expect(tableProp(now)).toBe(96);
      expect(photos(now)).toEqual(['F1.jpg@0', 'F2.jpg@0', 'F3.jpg@0', 'F4.jpg@0.5']);
      expect(now.domElement!.textContent).toContain('Plano!');
      expect(now.domElement!.textContent).toContain('1A nota');
    });
  }

  it('esta versión abre una página de la versión publicada (tablas sin la propiedad) sin escribir nada, con 96', async () => {
    const shared = new Y.Doc();
    const old = mountEditor(shared, 'old', publishedSchema);
    old.replaceBlocks(old.document, page());
    unmountAll();
    expect(storedHeights(shared)).toEqual([undefined, undefined]);
    const { doc, updates } = copyOf(shared);
    const E = mountEditor(doc);
    await tick(20);
    expect(updates).toEqual([]);
    expect(tableProp(E)).toBe(96);
    expect(shown(E)).toBeNull();
  });

  it('con la página abierta en las dos versiones a la vez: el cambio de alto llega a la vieja sin romper nada', async () => {
    const docA = new Y.Doc();
    const A = mounted(undefined, docA);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const old = mountEditor(docB, 'old', publishedSchema);
    const net = connect(docA, docB, 'sync');
    setThumbHeight(viewOf(A), tables(A), 64);
    await tick(20);
    expect(storedHeights(docB)[0]).toBe(64);
    // La vieja sigue igual (no conoce el alto) y escribe en la tabla.
    const ov = viewOf(old);
    ov.dispatch(ov.state.tr.setSelection(TextSelection.create(ov.state.doc, cellPos(old, 0, 1, true))));
    ov.dispatch(ov.state.tr.insertText(' ok'));
    net.flush();
    await tick(20);
    expect(photos(A)).toEqual(['F1.jpg@0', 'F2.jpg@0', 'F3.jpg@0', 'F4.jpg@0.5']);
    expect(storedPhotos(docA)).toEqual(storedPhotos(docB));
    expect(A.domElement!.textContent).toContain(' ok');
    // La vieja editó la tabla: le sacó el alto, que vuelve a 96 también en la nueva (lo único que se pierde).
    expect(tableProp(A)).toBe(96);
    // La otra tabla (no la tocó) conserva el suyo.
    expect(storedHeights(docA)).toEqual([undefined, 64]);
    expect(tableProp(A, 'tc')).toBe(64);
  });
});
