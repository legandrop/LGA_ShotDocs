// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import {
  insertPageBreak,
  insertPageBreakForSlashMenu,
  PAGE_BREAK_PROP,
  paragraphProps,
  removeBreakBefore,
  schema,
  SCRIPT_PROP,
} from './editorSchema';
import { pageEditorExtensions } from './editorExtensions';
import { schema as v083Schema } from './fixtures/editorSchemaV083';
import { paginate, PAGE_BREAK_SELECTOR, type Unit } from './pagination';
import { buildPrintView } from './printView';
import { findUnknownContent } from './unknownContent';

// El salto de hoja (Docs/Doc_Hojas_PDF.md, "Salto de hoja"): un párrafo con `pageBreak: true`, nunca un tipo de
// bloque nuevo. El cálculo de las hojas con saltos, cómo se crea y se saca en el editor, copiar y pegar, y la
// versión publicada antes del salto (v0.083, copiada en fixtures/): abre la página, no borra el párrafo ni su
// texto, y si edita esa línea pierde solo el salto.

// --- El cálculo ---------------------------------------------------------------------------------------------

const H = 1000;
const block = (key: string, top: number, height: number, extra: Partial<Unit> = {}): Unit => ({ key, top, height, ...extra });
const brk = (key: string, top: number, height = 0): Unit => ({ key, top, height, breakAfter: true });

describe('paginate con saltos de hoja', () => {
  it('lo que sigue a un salto empieza una hoja nueva, aunque entre en la anterior', () => {
    const r = paginate([block('title', 0, 60), block('b:1', 60, 100), brk('b:br', 160), block('b:2', 160, 100), block('b:3', 260, 100)], H);
    expect(r.breaks).toEqual([{ index: 3, key: 'b:2', offset: 0, sheet: 2 }]);
    expect(r.sheets).toBe(2);
  });

  it('un salto con texto ocupa su lugar en la hoja, y la hoja nueva empieza después', () => {
    const r = paginate([block('b:1', 0, 100), brk('b:br', 100, 30), block('b:2', 130, 100)], H);
    expect(r.breaks).toEqual([{ index: 2, key: 'b:2', offset: 0, sheet: 2 }]);
  });

  it('varios saltos seguidos cuentan como uno (no dejan hojas en blanco)', () => {
    const r = paginate([block('b:1', 0, 100), brk('b:a', 100), brk('b:b', 100), block('b:2', 100, 100)], H);
    expect(r.breaks).toEqual([{ index: 3, key: 'b:2', offset: 0, sheet: 2 }]);
  });

  it('un salto al final de la página no suma una hoja vacía', () => {
    expect(paginate([block('b:1', 0, 100), brk('b:br', 100)], H)).toEqual({ breaks: [], sheets: 1 });
  });

  it('si lo que sigue ya empieza una hoja (el corte natural cae justo ahí), no se suma otra', () => {
    // b:2 no entra en lo que queda de la primera hoja: pasa entero; el salto anterior no agrega otra hoja.
    const r = paginate([block('b:1', 0, 900), brk('b:br', 900), block('b:2', 900, 300), block('b:3', 1200, 50)], H);
    expect(r.breaks).toEqual([{ index: 2, key: 'b:2', offset: 0, sheet: 2 }]);
  });

  it('después de un salto, el resto pagina igual desde la hoja nueva', () => {
    const units = [block('b:1', 0, 100), brk('b:br', 100), block('b:2', 100, 600), block('b:3', 700, 600)];
    const r = paginate(units, H);
    // b:2 empieza la hoja 2 (en 100); b:3 termina en 1300 > 100 + 1000: pasa a la hoja 3.
    expect(r.breaks).toEqual([
      { index: 2, key: 'b:2', offset: 0, sheet: 2 },
      { index: 3, key: 'b:3', offset: 0, sheet: 3 },
    ]);
  });

  it('un título de sección justo antes de un salto queda en su hoja (el salto manda)', () => {
    const r = paginate([block('b:1', 0, 100), block('b:h', 100, 40, { keepWithNext: true }), brk('b:br', 140), block('b:2', 140, 100)], H);
    expect(r.breaks).toEqual([{ index: 3, key: 'b:2', offset: 0, sheet: 2 }]);
  });

  it('un bloque alto después de un salto se parte desde la hoja nueva', () => {
    const splits = Array.from({ length: 59 }, (_, i) => (i + 1) * 25);
    const r = paginate([block('b:1', 0, 100), brk('b:br', 100), block('b:long', 100, 1500, { splits })], H);
    expect(r.breaks[0]).toEqual({ index: 2, key: 'b:long', offset: 0, sheet: 2 });
    expect(r.breaks[1]).toEqual({ index: 2, key: 'b:long', offset: 1000, sheet: 3 });
  });
});

// --- El editor ----------------------------------------------------------------------------------------------

const editors: BlockNoteEditor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.unmount();
  document.body.innerHTML = '';
});

function mount(doc: Y.Doc, withSchema: unknown = schema, into?: HTMLElement, extensions?: unknown[]): BlockNoteEditor {
  const editor = BlockNoteEditor.create(
    withCollaboration({
      schema: withSchema as typeof schema,
      collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
      ...(extensions ? { extensions } : {}),
    } as never),
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  (into ?? document.body).appendChild(el);
  editor.mount(el);
  editors.push(editor);
  return editor;
}

// jsdom no tiene `ClipboardEvent` (pegar de ProseMirror lo usa).
(globalThis as { ClipboardEvent?: unknown }).ClipboardEvent ??= class extends Event {
  clipboardData: unknown = null;
};

const tick = () => new Promise((r) => setTimeout(r, 30));
const marker = (text = '') => ({ type: 'paragraph' as const, props: paragraphProps('pageBreak') as never, content: text });
const p = (text: string) => ({ type: 'paragraph' as const, content: text });
const texts = (e: BlockNoteEditor) => e.document.map((b) => (b.content as { text?: string }[] | undefined)?.map((c) => c.text).join('') ?? '');
const kinds = (e: BlockNoteEditor) =>
  e.document.map((b) => {
    const props = b.props as Record<string, unknown>;
    return b.type === 'paragraph' && props[PAGE_BREAK_PROP] ? 'break' : b.type === 'paragraph' && props[SCRIPT_PROP] ? 'script' : b.type;
  });
/** Pone el cursor en el bloque `i`, a `offset` letras del principio. */
function cursorAt(e: BlockNoteEditor, i: number, offset: number): void {
  e.setTextCursorPosition(e.document[i], 'start');
  const view = e.prosemirrorView!;
  const pos = view.state.selection.from + offset;
  e.transact((tr) => {
    tr.setSelection((view.state.selection.constructor as unknown as { near: (p: unknown) => never }).near(tr.doc.resolve(pos)));
  });
}

describe('crear y sacar un salto', () => {
  it('en un párrafo vacío: el párrafo pasa a ser el salto y se sigue en uno nuevo abajo', () => {
    const editor = mount(new Y.Doc());
    editor.replaceBlocks(editor.document, [p('Hoja uno.'), p('')]);
    editor.setTextCursorPosition(editor.document[1], 'start');
    expect(insertPageBreak(editor)).toBe(true);
    expect(kinds(editor).slice(0, 3)).toEqual(['paragraph', 'break', 'paragraph']);
    expect(editor.getTextCursorPosition().block.id).toBe(editor.document[2].id);
    // La línea: BlockNote pone el atributo en el contenido del bloque, y la clase en el párrafo.
    const el = editor.domElement!.querySelector(PAGE_BREAK_SELECTOR);
    expect(el?.querySelector('p.page-break-line')).not.toBeNull();
  });

  it('al final de un párrafo con texto: el salto va abajo; al principio, va arriba', () => {
    const editor = mount(new Y.Doc());
    editor.replaceBlocks(editor.document, [p('Uno.'), p('Dos.')]);
    editor.setTextCursorPosition(editor.document[0], 'end');
    insertPageBreak(editor);
    expect(kinds(editor).slice(0, 4)).toEqual(['paragraph', 'break', 'paragraph', 'paragraph']);
    expect(texts(editor).slice(0, 4)).toEqual(['Uno.', '', '', 'Dos.']);

    const other = mount(new Y.Doc());
    other.replaceBlocks(other.document, [p('Uno.'), p('Dos.')]);
    other.setTextCursorPosition(other.document[1], 'start');
    insertPageBreak(other);
    expect(kinds(other).slice(0, 3)).toEqual(['paragraph', 'break', 'paragraph']);
    expect(texts(other).slice(0, 3)).toEqual(['Uno.', '', 'Dos.']);
    expect(other.getTextCursorPosition().block.id).toBe(other.document[2].id);
  });

  it('en el medio de un párrafo lo parte, sin perder texto, y el salto queda entre las dos partes', () => {
    const editor = mount(new Y.Doc());
    editor.replaceBlocks(editor.document, [{ type: 'paragraph', props: paragraphProps('script') as never, content: 'INT. BAR - NOCHE' }]);
    cursorAt(editor, 0, 4);
    insertPageBreak(editor);
    expect(texts(editor).slice(0, 3)).toEqual(['INT.', '', ' BAR - NOCHE']);
    expect(kinds(editor).slice(0, 3)).toEqual(['script', 'break', 'script']);
  });

  it('en una tabla o en una foto no hace nada', () => {
    const editor = mount(new Y.Doc());
    editor.replaceBlocks(editor.document, [{ type: 'table', content: { type: 'tableContent', rows: [{ cells: ['a', 'b'] }] } } as never]);
    editor.setTextCursorPosition(editor.document[0], 'start');
    const before = JSON.stringify(editor.document);
    expect(insertPageBreak(editor)).toBe(false);
    expect(JSON.stringify(editor.document)).toBe(before);
  });

  it('el menú "/": el renglón del "/" pasa a ser el salto; en un renglón con texto, el salto va abajo', () => {
    const editor = mount(new Y.Doc());
    // El menú ya sacó el "/" y lo escrito para filtrar cuando llama al ítem.
    editor.replaceBlocks(editor.document, [p('Uno.'), p('')]);
    editor.setTextCursorPosition(editor.document[1], 'end');
    insertPageBreakForSlashMenu(editor);
    expect(kinds(editor).slice(0, 3)).toEqual(['paragraph', 'break', 'paragraph']);
    expect(texts(editor)[1]).toBe('');
    expect(editor.getTextCursorPosition().block.id).toBe(editor.document[2].id);

    editor.setTextCursorPosition(editor.document[0], 'end');
    insertPageBreakForSlashMenu(editor);
    expect(texts(editor)[0]).toBe('Uno.');
    expect(kinds(editor)[1]).toBe('break');
  });

  it('Retroceso justo después de un salto lo saca: vacío se borra; con texto queda el texto como párrafo', () => {
    const editor = mount(new Y.Doc());
    editor.replaceBlocks(editor.document, [p('Uno.'), marker(), p('Dos.')]);
    editor.setTextCursorPosition(editor.document[2], 'start');
    expect(removeBreakBefore(editor)).toBe(true);
    expect(kinds(editor).slice(0, 2)).toEqual(['paragraph', 'paragraph']);
    expect(texts(editor).slice(0, 2)).toEqual(['Uno.', 'Dos.']);

    editor.replaceBlocks(editor.document, [p('Uno.'), marker('Fin de la escena.'), p('Dos.')]);
    editor.setTextCursorPosition(editor.document[2], 'start');
    expect(removeBreakBefore(editor)).toBe(true);
    expect(kinds(editor).slice(0, 3)).toEqual(['paragraph', 'paragraph', 'paragraph']);
    expect(texts(editor).slice(0, 3)).toEqual(['Uno.', 'Fin de la escena.', 'Dos.']);

    // En el medio de un renglón, o sin un salto antes, no hace nada (lo maneja el editor).
    cursorAt(editor, 2, 2);
    expect(removeBreakBefore(editor)).toBe(false);
    editor.setTextCursorPosition(editor.document[1], 'start');
    expect(removeBreakBefore(editor)).toBe(false);
  });

  it('con el teclado del editor de la página: Ctrl/⌘+Enter lo pone y Retroceso (antes que el de BlockNote) lo saca', () => {
    const editor = mount(new Y.Doc(), schema, undefined, pageEditorExtensions({}));
    editor.replaceBlocks(editor.document, [p('Uno.')]);
    editor.setTextCursorPosition(editor.document[0], 'end');
    const view = editor.prosemirrorView!;
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    const key = (init: KeyboardEventInit) => view.someProp('handleKeyDown', (f) => f(view, new KeyboardEvent('keydown', init)));
    expect(key({ key: 'Enter', ctrlKey: !mac, metaKey: mac })).toBe(true);
    expect(kinds(editor).slice(0, 3)).toEqual(['paragraph', 'break', 'paragraph']);
    editor.insertInlineContent('Dos.');
    editor.setTextCursorPosition(editor.document[2], 'start');
    expect(key({ key: 'Backspace' })).toBe(true);
    expect(kinds(editor).slice(0, 2)).toEqual(['paragraph', 'paragraph']);
    expect(texts(editor).slice(0, 2)).toEqual(['Uno.', 'Dos.']);
  });
});

describe('copiar y pegar', () => {
  it('pegado desde la app (HTML de BlockNote) el salto sigue siendo salto, vacío o con texto', async () => {
    const a = mount(new Y.Doc());
    a.replaceBlocks(a.document, [p('Uno.'), marker(), marker('Con texto.'), p('Dos.')]);
    const html = await a.blocksToFullHTML(a.document.slice(0, 4));
    const b = mount(new Y.Doc());
    b.replaceBlocks(b.document, [p('')]);
    b.setTextCursorPosition(b.document[0], 'start');
    b.pasteHTML(html);
    expect(kinds(b)).toContain('break');
    expect(kinds(b).filter((k) => k === 'break')).toHaveLength(2);
    expect(texts(b).join('|')).toContain('Con texto.');
  });

  it('afuera de la app sale con break-after: page; pegado de vuelta, es un salto', async () => {
    const a = mount(new Y.Doc());
    a.replaceBlocks(a.document, [p('Uno.'), marker(), p('Dos.')]);
    const html = await a.blocksToHTMLLossy(a.document.slice(0, 3));
    expect(html).toMatch(/page-break-line/);
    expect(html).toMatch(/break-after:\s*page/);
    const b = mount(new Y.Doc());
    b.replaceBlocks(b.document, [p('')]);
    b.setTextCursorPosition(b.document[0], 'start');
    b.pasteHTML(html);
    expect(kinds(b).filter((k) => k === 'break')).toHaveLength(1);
    expect(texts(b).join('|')).toContain('Dos.');
    // Un <p> de otro programa con page-break-after también se toma como salto (y su texto queda).
    const c = mount(new Y.Doc());
    c.replaceBlocks(c.document, [p('')]);
    c.setTextCursorPosition(c.document[0], 'start');
    c.pasteHTML('<p>Antes</p><p style="page-break-after: always">Fin</p><p>Después</p>');
    expect(kinds(c).slice(0, 3)).toEqual(['paragraph', 'break', 'paragraph']);
    expect(texts(c).slice(0, 3)).toEqual(['Antes', 'Fin', 'Después']);
    // "No cortar acá" (avoid-page) no es un salto, ni un <p> vacío común.
    const d = mount(new Y.Doc());
    d.replaceBlocks(d.document, [p('')]);
    d.setTextCursorPosition(d.document[0], 'start');
    d.pasteHTML('<p style="break-after: avoid-page">Uno</p><p></p><p style="page-break-after: auto">Dos</p>');
    expect(kinds(d).filter((k) => k === 'break')).toHaveLength(0);
    expect(texts(d).join('|')).toContain('Uno');
    expect(texts(d).join('|')).toContain('Dos');
  });
});

describe('la vista de impresión', () => {
  it('lleva el salto, esconde el vacío (no ocupa lugar en el papel) y no cambia el Y.Doc', async () => {
    const article = document.createElement('article');
    article.className = 'page';
    const title = document.createElement('textarea');
    title.className = 'page-title';
    title.value = 'Página';
    const host = document.createElement('div');
    host.className = 'editor-host';
    article.append(title, host);
    document.body.append(article);
    const doc = new Y.Doc();
    const editor = mount(doc, schema, host);
    editor.replaceBlocks(editor.document, [p('Uno.'), marker(), marker('Con texto.'), p('Dos.')]);
    await tick();
    const before = Y.encodeStateVector(doc);
    const view = buildPrintView(article, { size: 'A4', landscape: false }, 'output');
    try {
      const breaks = view.page.querySelectorAll(PAGE_BREAK_SELECTOR);
      expect(breaks).toHaveLength(2);
      expect(breaks[0].classList.contains('print-page-break-empty')).toBe(true);
      expect(breaks[1].classList.contains('print-page-break-empty')).toBe(false);
      expect(breaks[1].textContent).toBe('Con texto.');
    } finally {
      view.root.remove();
    }
    expect(Y.encodeStateVector(doc)).toEqual(before);
  });
});

// --- La versión publicada antes del salto (v0.083) -------------------------------------------------------

function newPage(): { doc: Y.Doc; editor: BlockNoteEditor } {
  const doc = new Y.Doc();
  const editor = mount(doc);
  editor.replaceBlocks(editor.document, [p('Escena 1.'), marker(), p('Escena 2.'), marker('Nota antes del corte.'), p('Escena 3.')]);
  return { doc, editor };
}

function openInV083(doc: Y.Doc): { old: BlockNoteEditor; updates: Uint8Array[] } {
  const docOld = new Y.Doc();
  Y.applyUpdate(docOld, Y.encodeStateAsUpdate(doc));
  const updates: Uint8Array[] = [];
  docOld.on('update', (u: Uint8Array) => updates.push(u));
  return { old: mount(docOld, v083Schema), updates };
}

describe('saltos de hoja con el editor de la versión anterior (v0.083)', () => {
  it('abre la página, ve párrafos (vacío o con su texto) y al editar otro bloque no borra ni desmarca nada', async () => {
    const { doc, editor } = newPage();
    await tick();
    const ids = editor.document.map((b) => b.id);

    const { old, updates } = openInV083(doc);
    await tick();
    expect(old.document.slice(0, 5).map((b) => b.type)).toEqual(['paragraph', 'paragraph', 'paragraph', 'paragraph', 'paragraph']);
    expect(texts(old).slice(0, 5)).toEqual(['Escena 1.', '', 'Escena 2.', 'Nota antes del corte.', 'Escena 3.']);
    expect(old.document.slice(0, 5).map((b) => b.id)).toEqual(ids.slice(0, 5));
    // La versión anterior no muestra la línea (no conoce la propiedad).
    expect(old.domElement?.querySelector('[data-page-break]')).toBeNull();

    old.setTextCursorPosition(old.document[2], 'end');
    old.insertInlineContent(' Editada en la versión anterior.');
    await tick();
    for (const u of updates) Y.applyUpdate(doc, u);
    await tick();

    expect(texts(editor).slice(0, 5)).toEqual(['Escena 1.', '', 'Escena 2. Editada en la versión anterior.', 'Nota antes del corte.', 'Escena 3.']);
    expect(kinds(editor).slice(0, 5)).toEqual(['paragraph', 'break', 'paragraph', 'break', 'paragraph']);
  });

  it('si la versión anterior escribe en el salto, queda el texto y el id (se pierde, como mucho, el salto)', async () => {
    const { doc, editor } = newPage();
    await tick();
    const id = editor.document[3].id;

    const { old, updates } = openInV083(doc);
    await tick();
    old.setTextCursorPosition(old.document[3], 'end');
    old.insertInlineContent(' Y algo más.');
    await tick();
    for (const u of updates) Y.applyUpdate(doc, u);
    await tick();

    expect(texts(editor).slice(0, 5)).toEqual(['Escena 1.', '', 'Escena 2.', 'Nota antes del corte. Y algo más.', 'Escena 3.']);
    expect(editor.document[3].id).toBe(id);
    expect(editor.document[3].type).toBe('paragraph');
    // El otro salto, que nadie tocó, sigue.
    expect(kinds(editor)[1]).toBe('break');
  });

  it('la guarda contra lo desconocido no bloquea la página en la versión anterior', async () => {
    const { doc } = newPage();
    await tick();
    const probe = BlockNoteEditor.create({ schema: v083Schema });
    const names = { nodes: new Set(Object.keys(probe.pmSchema.nodes)), marks: new Set(Object.keys(probe.pmSchema.marks)) };
    expect(findUnknownContent(doc, names)).toBeNull();
  });
});
