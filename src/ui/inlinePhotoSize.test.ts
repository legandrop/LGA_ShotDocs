// @vitest-environment jsdom
// El tamaño de las fotos en línea elegidas y "Arrange in rows" sobre ellas (Docs/Doc_Fotos_En_Linea.md, entrega 2).
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { DOMParser, DOMSerializer } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { editorSchemaOptions } from './editorSchema';
import { arrangeRows } from './imageRows';
import { rowsOfTextblock } from './inlinePhotoEditor';
import { PHOTO } from './inlinePhoto';
import { toolbarSpot } from './PhotoToolbar';
import {
  arrangeTarget,
  arrangeWidths,
  areAdjacent,
  onlyPhotosSelected,
  runAround,
  selectedPhotos,
  setPhotoWidths,
} from './inlinePhotoSize';

const editors: BlockNoteEditor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.unmount();
  document.body.replaceChildren();
});

function mount(blocks: PartialBlock[]): BlockNoteEditor {
  const editor = BlockNoteEditor.create(editorSchemaOptions) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.append(el);
  editor.mount(el);
  editors.push(editor);
  editor.replaceBlocks(editor.document, blocks as never);
  return editor;
}

const view = (e: BlockNoteEditor) => e.prosemirrorView!;
const ph = (name: string, w = 0) => ({ type: 'photo', props: { url: `https://example.invalid/${name}.jpg`, name, w } });
const p = (id: string, ...content: unknown[]): PartialBlock =>
  ({ id, type: 'paragraph', content: content.map((c) => (typeof c === 'string' ? { type: 'text', text: c, styles: {} } : c)) }) as never;

function pos(e: BlockNoteEditor, name: string): number {
  let found = -1;
  view(e).state.doc.descendants((n, at) => {
    if (n.type.name === PHOTO && n.attrs.name === name) found = at;
    return found < 0;
  });
  return found;
}

const widths = (e: BlockNoteEditor, names: string[]) => names.map((n) => +Number(view(e).state.doc.nodeAt(pos(e, n))!.attrs.w).toFixed(4));
const choose = (e: BlockNoteEditor, name: string) => view(e).dispatch(view(e).state.tr.setSelection(NodeSelection.create(view(e).state.doc, pos(e, name))));
const range = (e: BlockNoteEditor, from: number, to: number) => view(e).dispatch(view(e).state.tr.setSelection(TextSelection.create(view(e).state.doc, from, to)));

describe('qué fotos están elegidas', () => {
  it('la elegida, o las que abarca una selección de texto; solo fotos o con letras', () => {
    const E = mount([p('a', 'x', ph('F1'), ph('F2'), 'y', ph('F3'))]);
    choose(E, 'F2');
    expect(selectedPhotos(view(E).state)).toEqual([pos(E, 'F2')]);
    expect(onlyPhotosSelected(view(E).state)).toBe(true);
    range(E, pos(E, 'F1'), pos(E, 'F2') + 1);
    expect(selectedPhotos(view(E).state)).toEqual([pos(E, 'F1'), pos(E, 'F2')]);
    expect(onlyPhotosSelected(view(E).state)).toBe(true);
    range(E, pos(E, 'F1') - 1, pos(E, 'F3') + 1);
    expect(selectedPhotos(view(E).state)).toHaveLength(3);
    expect(onlyPhotosSelected(view(E).state)).toBe(false);
  });

  it('seguidas: sin letras en el medio, en el mismo renglón', () => {
    const E = mount([p('a', ph('F1'), ph('F2'), ph('F3'), 'y', ph('F4')), p('b', ph('F5'))]);
    const doc = view(E).state.doc;
    expect(runAround(doc, pos(E, 'F2'))).toEqual(['F1', 'F2', 'F3'].map((n) => pos(E, n)));
    expect(areAdjacent(doc, [pos(E, 'F2'), pos(E, 'F3')])).toBe(true);
    expect(areAdjacent(doc, [pos(E, 'F3'), pos(E, 'F4')])).toBe(false);
    expect(areAdjacent(doc, [pos(E, 'F4'), pos(E, 'F5')])).toBe(false);
  });

  it('qué acomoda: con una elegida, las seguidas de su renglón; con varias, esas (avisa si no están seguidas)', () => {
    const E = mount([p('a', ph('F1'), ph('F2'), ph('F3'), 'y', ph('F4'))]);
    choose(E, 'F2');
    expect(arrangeTarget(view(E).state)).toEqual({ positions: ['F1', 'F2', 'F3'].map((n) => pos(E, n)), adjacent: true });
    choose(E, 'F4');
    expect(arrangeTarget(view(E).state)).toBeNull();
    range(E, pos(E, 'F2'), pos(E, 'F3') + 1);
    expect(arrangeTarget(view(E).state)).toEqual({ positions: [pos(E, 'F2'), pos(E, 'F3')], adjacent: true });
    range(E, pos(E, 'F3'), pos(E, 'F4') + 1);
    expect(arrangeTarget(view(E).state)?.adjacent).toBe(false);
  });
});

describe('los tamaños rápidos', () => {
  it('valen para todas las elegidas, en un solo cambio; el texto no se toca', () => {
    const E = mount([p('a', 'x', ph('F1'), ph('F2'), 'y', ph('F3'))]);
    range(E, pos(E, 'F1') - 1, pos(E, 'F3') + 1);
    setPhotoWidths(view(E), selectedPhotos(view(E).state), 1 / 3);
    expect(widths(E, ['F1', 'F2', 'F3'])).toEqual([0.3333, 0.3333, 0.3333]);
    expect((E.getBlock('a')!.content as unknown[]).map((c) => (c as { text?: string }).text ?? '•').join('')).toBe('x••y•');
  });
});

describe('acomodar las elegidas', () => {
  const run = (names: string[], ws: number[]) => p('a', ...names.map((n, i) => ph(n, ws[i])));
  const aspects = (map: Record<string, number>) => (e: BlockNoteEditor) => (at: number) => map[String(view(e).state.doc.nodeAt(at)!.attrs.name)] ?? 1.5;
  const rowsOf = (e: BlockNoteEditor) => {
    const doc = view(e).state.doc;
    let rows: string[][] = [];
    doc.descendants((n, at) => {
      if (n.isTextblock && rows.length === 0) rows = rowsOfTextblock(n, at).map((r) => r.positions.map((x) => String(doc.nodeAt(x)!.attrs.name)));
      return !n.isTextblock;
    });
    return rows;
  };

  it('toda la tanda: lo mismo que arrangeRows, y la primera empieza fila', () => {
    const names = ['A', 'B', 'C', 'D', 'E'];
    const E = mount([run(names, [0, 0, 0, 0, 0])]);
    const a = { A: 1.5, B: 0.67, C: 1.5, D: 1, E: 1.78 };
    const got = arrangeWidths(view(E).state.doc, names.map((n) => pos(E, n)), aspects(a)(E), 8 / 700);
    expect(names.map((n) => got.get(pos(E, n))!.w)).toEqual(arrangeRows(Object.values(a), { gapRatio: 8 / 700 }));
    expect(names.map((n) => got.get(pos(E, n))!.rowStart)).toEqual([true, null, null, null, null]);
  });

  it('SOLO las elegidas: las de antes y la de después no cambian de ancho; las elegidas quedan en filas propias', () => {
    // Cinco a 1/3 (filas 21 22 23 / 24 25); se eligen 23, 24 y 25 (el caso de la auditoría).
    const names = ['F21', 'F22', 'F23', 'F24', 'F25', 'F26'];
    const E = mount([run(names, [1 / 3, 1 / 3, 1 / 3, 1 / 3, 1 / 3, 1 / 3])]);
    range(E, pos(E, 'F23'), pos(E, 'F25') + 1);
    // En jsdom no hay imágenes: se acomoda con la cuenta (las proporciones, 3:2).
    const chosen = ['F23', 'F24', 'F25'];
    const got = arrangeWidths(view(E).state.doc, chosen.map((n) => pos(E, n)), aspects({})(E), 8 / 700);
    const v = view(E);
    const tr = v.state.tr;
    for (const [at, c] of got) {
      if (c.w !== undefined) tr.setNodeAttribute(at, 'w', c.w);
      tr.setNodeAttribute(at, 'rowStart', c.rowStart);
    }
    v.dispatch(tr);
    expect(widths(E, ['F21', 'F22', 'F26'])).toEqual([0.3333, 0.3333, 0.3333]);
    expect(got.get(pos(E, 'F26'))).toEqual({ rowStart: true });
    // Filas: 21 22 (no llena: el margen completa el renglón) | 23 24 25 (lo de arrangeRows) | 26.
    expect(rowsOf(E)).toEqual([['F21', 'F22'], ['F23', 'F24', 'F25'], ['F26']]);
  });

  it('dos verticales elegidas con otra foto después: no se estiran (la última fila con su altura, como la foto-bloque)', () => {
    const E = mount([run(['A', 'B', 'C'], [0.25, 0.25, 0.25])]);
    const got = arrangeWidths(view(E).state.doc, ['A', 'B'].map((n) => pos(E, n)), aspects({ A: 0.67, B: 0.67 })(E), 8 / 700);
    const ws = ['A', 'B'].map((n) => got.get(pos(E, n))!.w!);
    expect(ws).toEqual(arrangeRows([0.67, 0.67], { gapRatio: 8 / 700 }));
    expect(ws[0] + ws[1]).toBeLessThan(0.75);
    expect(got.get(pos(E, 'C'))).toEqual({ rowStart: true });
  });

  it('las filas se cortan donde una foto empieza fila (y en un párrafo sin marcas, como siempre)', () => {
    const E = mount([p('a', ph('A', 0.25), ph('B', 0.25), { type: 'photo', props: { url: 'https://example.invalid/C.jpg', name: 'C', w: 0.25 } })]);
    expect(rowsOf(E)).toEqual([['A', 'B', 'C']]);
    view(E).dispatch(view(E).state.tr.setNodeAttribute(pos(E, 'B'), 'rowStart', true));
    expect(rowsOf(E)).toEqual([['A'], ['B', 'C']]);
    // Va y vuelve por el HTML de la app (copiar y pegar).
    const schemaOf = view(E).state.schema;
    const node = view(E).state.doc.nodeAt(pos(E, 'B'))!;
    const dom = DOMSerializer.fromSchema(schemaOf).serializeNode(node) as HTMLElement;
    expect(dom.getAttribute('data-row-start')).toBe('true');
    const wrap = document.createElement('p');
    wrap.append(dom);
    const back = DOMParser.fromSchema(schemaOf).parseSlice(wrap).content.firstChild!.firstChild ?? DOMParser.fromSchema(schemaOf).parseSlice(wrap).content.firstChild!;
    expect(back.type.name === 'photo' ? back.attrs.rowStart : back.firstChild?.attrs.rowStart).toBe(true);
  });
});

describe('dónde va la barra', () => {
  it('arriba de las fotos; abajo si arriba no entra; adentro de la pantalla', () => {
    const vp = { width: 800, height: 600 };
    expect(toolbarSpot({ top: 200, bottom: 400, left: 100 }, { width: 300, height: 40 }, vp)).toEqual({ top: 150, left: 100 });
    expect(toolbarSpot({ top: 20, bottom: 300, left: 100 }, { width: 300, height: 40 }, vp)).toEqual({ top: 310, left: 100 });
    expect(toolbarSpot({ top: 200, bottom: 400, left: 700 }, { width: 300, height: 40 }, vp)).toEqual({ top: 150, left: 492 });
  });
});
