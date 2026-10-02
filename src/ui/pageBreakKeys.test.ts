// @vitest-environment jsdom
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { yUndoPluginKey } from 'y-prosemirror';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { collapseState, setCollapsed } from './collapseEditor';
import { pageEditorExtensions } from './editorExtensions';
import { PAGE_BREAK_PROP, paragraphProps, schema } from './editorSchema';
import { schema as previousSchema } from './fixtures/editorSchemaAnterior';

// El salto de hoja con el teclado y el pegado del editor de la página (Docs/Doc_Hojas_PDF.md): lo que hacen Enter,
// Retroceso, Supr y Ctrl/⌘+Enter alrededor de un salto, en tablas, títulos colapsados y listas, y lo que pasa al
// pegar adentro de un salto. Ninguno pierde texto, y el salto queda una sola vez donde corresponde.

Range.prototype.getClientRects ??= (() => []) as never;
Range.prototype.getBoundingClientRect ??= (() => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 })) as never;
// jsdom no tiene `ClipboardEvent` (pegar de ProseMirror lo usa).
(globalThis as { ClipboardEvent?: unknown }).ClipboardEvent ??= class extends Event {
  clipboardData: unknown = null;
};

const editors: BlockNoteEditor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.unmount();
  document.body.replaceChildren();
});

function mount(doc = new Y.Doc(), withSchema: unknown = schema, ext = true): BlockNoteEditor {
  const editor = BlockNoteEditor.create(
    withCollaboration({
      schema: withSchema as typeof schema,
      collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
      ...(ext ? { extensions: pageEditorExtensions({}) } : {}),
    } as never),
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  editor.mount(el);
  editors.push(editor);
  return editor;
}

const p = (text: string, children: PartialBlock[] = []) => ({ type: 'paragraph', content: text, children }) as PartialBlock;
const h = (level: number, text: string) => ({ type: 'heading', props: { level }, content: text }) as PartialBlock;
const br = (text = '') => ({ type: 'paragraph', props: paragraphProps('pageBreak'), content: text }) as PartialBlock;
const table = (rows: string[][]) => ({ type: 'table', content: { type: 'tableContent', rows: rows.map((cells) => ({ cells })) } }) as never;

function textOf(b: { content?: unknown; type: string }): string {
  if (!Array.isArray(b.content)) return `<${b.type}>`;
  return b.content.map((c: { type: string; text?: string }) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('');
}
function flat(editor: BlockNoteEditor) {
  const out: { id: string; t: string; k: string }[] = [];
  const walk = (blocks: typeof editor.document) => {
    for (const b of blocks) {
      const props = b.props as Record<string, unknown>;
      out.push({ id: b.id, t: textOf(b as never), k: b.type === 'paragraph' && props[PAGE_BREAK_PROP] ? 'BR' : b.type });
      walk(b.children);
    }
  };
  walk(editor.document);
  return out;
}
/** Cada bloque como `tipo:texto` (BR es un salto), sin los párrafos vacíos comunes. */
const show = (e: BlockNoteEditor) => flat(e).map((x) => `${x.k}:${x.t}`).filter((s) => s !== 'paragraph:');
const breaks = (e: BlockNoteEditor) => show(e).filter((s) => s.startsWith('BR'));

function posIn(editor: BlockNoteEditor, index: number, offset: number): number {
  const id = flat(editor)[index].id;
  let at = -1;
  editor.prosemirrorView!.state.doc.descendants((n, pos) => {
    if (at >= 0) return false;
    if (n.type.name === 'blockContainer' && n.attrs.id === id) at = pos + 2 + offset;
    return at < 0;
  });
  return at;
}
function caret(editor: BlockNoteEditor, index: number, offset = 0): void {
  const v = editor.prosemirrorView!;
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, posIn(editor, index, offset))));
}
function select(editor: BlockNoteEditor, i1: number, o1: number, i2: number, o2: number): void {
  const v = editor.prosemirrorView!;
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, posIn(editor, i1, o1), posIn(editor, i2, o2))));
}
/** El cursor al principio de la celda número `n` (desde 1) de la primera tabla. */
function caretInCell(editor: BlockNoteEditor, n: number): void {
  const v = editor.prosemirrorView!;
  let seen = 0;
  let at = -1;
  v.state.doc.descendants((node, pos) => {
    if (at >= 0) return false;
    if (node.type.name === 'tableParagraph' && ++seen === n) at = pos + 1;
    return true;
  });
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, at)));
}
function press(editor: BlockNoteEditor, key: string, init: KeyboardEventInit = {}): boolean {
  const view = editor.prosemirrorView!;
  return !!view.someProp('handleKeyDown', (f) => f(view, new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })));
}
const mac = /Mac|iPhone|iPad/.test(navigator.platform);
const modEnter = (e: BlockNoteEditor) => press(e, 'Enter', mac ? { metaKey: true } : { ctrlKey: true });
const tick = () => new Promise((r) => setTimeout(r, 30));
function page(blocks: PartialBlock[]): { e: BlockNoteEditor; doc: Y.Doc } {
  const doc = new Y.Doc();
  const e = mount(doc);
  e.replaceBlocks(e.document, blocks as never);
  (yUndoPluginKey.getState(e.prosemirrorView!.state as never) as { undoManager: Y.UndoManager }).undoManager.stopCapturing();
  return { e, doc };
}

describe('Retroceso en una tabla debajo de un salto', () => {
  it('al principio de cualquier celda no saca el salto de arriba de la tabla', () => {
    for (const cell of [1, 2, 4]) {
      const { e } = page([p('Uno'), br(), table([['a', 'b'], ['c', 'd']]), p('Dos')]);
      caretInCell(e, cell);
      press(e, 'Backspace');
      expect(breaks(e), `celda ${cell}`).toEqual(['BR:']);
    }
  });

  it('vaciar una celda con un Retroceso de más tampoco (ni le saca el salto a uno con texto)', () => {
    const { e } = page([p('Uno'), br('Nota'), table([['a', '']])]);
    caretInCell(e, 2);
    press(e, 'Backspace');
    expect(breaks(e)).toEqual(['BR:Nota']);
  });
});

describe('Enter, Retroceso y Supr alrededor de un salto', () => {
  it('Enter al principio de un salto con texto: un renglón común arriba y un solo salto', () => {
    const { e } = page([p('Uno'), br('Nota'), p('Dos')]);
    caret(e, 1, 0);
    expect(press(e, 'Enter')).toBe(true);
    expect(flat(e).slice(0, 4).map((x) => `${x.k}:${x.t}`)).toEqual(['paragraph:Uno', 'paragraph:', 'BR:Nota', 'paragraph:Dos']);
    expect(e.getTextCursorPosition().block.id).toBe(flat(e)[2].id);
  });

  it('Enter en el medio o al final de un salto con texto: la parte nueva es un párrafo común', () => {
    const a = page([p('Uno'), br('Nota final'), p('Dos')]).e;
    caret(a, 1, 4);
    press(a, 'Enter');
    expect(show(a)).toEqual(['paragraph:Uno', 'BR:Nota', 'paragraph: final', 'paragraph:Dos']);
    const b = page([p('Uno'), br('Nota'), p('Dos')]).e;
    caret(b, 1, 4);
    press(b, 'Enter');
    expect(breaks(b)).toEqual(['BR:Nota']);
  });

  it('Supr en un salto vacío lo saca (no sube el renglón de abajo adentro del salto)', () => {
    const { e } = page([p('Uno'), br(), p('Dos')]);
    caret(e, 1, 0);
    expect(press(e, 'Delete')).toBe(true);
    expect(show(e)).toEqual(['paragraph:Uno', 'paragraph:Dos']);
    expect(e.getTextCursorPosition().block.id).toBe(flat(e)[1].id);
  });

  it('Supr al final de un salto con texto y Retroceso en un salto: hacen lo de siempre, sin perder texto', () => {
    const a = page([p('Uno'), br('Nota'), p('Dos')]).e;
    caret(a, 1, 4);
    press(a, 'Delete');
    expect(show(a).map((s) => s.split(':')[1]).join('|')).toContain('NotaDos');
    const b = page([p('Uno'), br('Nota'), p('Dos')]).e;
    caret(b, 1, 0);
    press(b, 'Backspace');
    expect(show(b).join('|')).toContain('UnoNota');
  });

  it('Retroceso después de un salto, en un título o un hijo: saca el salto y el texto queda', () => {
    const a = page([p('Uno'), br(), h(2, 'Escena'), p('Dos')]).e;
    caret(a, 2, 0);
    press(a, 'Backspace');
    expect(show(a)).toEqual(['paragraph:Uno', 'heading:Escena', 'paragraph:Dos']);
    const b = page([p('Madre', [br(), p('hija')]), p('Dos')]).e;
    caret(b, 2, 0);
    press(b, 'Backspace');
    expect(show(b)).toEqual(['paragraph:Madre', 'paragraph:hija', 'paragraph:Dos']);
  });
});

describe('Ctrl/⌘+Enter en otros lugares', () => {
  it('con una selección no borra lo elegido; en una casilla no la marca', () => {
    const a = page([p('Uno dos tres')]).e;
    select(a, 0, 4, 0, 7);
    expect(modEnter(a)).toBe(true);
    expect(show(a)).toEqual(['paragraph:Uno dos tres', 'BR:']);
    const b = page([{ type: 'checkListItem', props: { checked: false }, content: 'tarea' } as never]).e;
    caret(b, 0, 5);
    modEnter(b);
    expect((b.document[0].props as { checked?: boolean }).checked).toBe(false);
    expect(breaks(b)).toEqual(['BR:']);
  });

  it('al final de un título colapsado: el salto va después de lo escondido y la sección sigue colapsada', async () => {
    const { e } = page([p('top'), h(2, 'S'), p('s1'), p('s2'), h(2, 'G'), p('g1')]);
    setCollapsed(e.prosemirrorView!, [flat(e)[1].id], true);
    await tick();
    caret(e, 1, 1);
    expect(modEnter(e)).toBe(true);
    await tick();
    expect(show(e)).toEqual(['paragraph:top', 'heading:S', 'paragraph:s1', 'paragraph:s2', 'BR:', 'heading:G', 'paragraph:g1']);
    const st = collapseState(e.prosemirrorState)!;
    expect(st.analysis.hidden.has(flat(e)[2].id)).toBe(true);
    expect(st.analysis.hidden.has(e.getTextCursorPosition().block.id)).toBe(false);
  });

  it('deshacer: un solo paso, en el medio y al final', async () => {
    const { e } = page([p('Primera mitad segunda mitad'), p('fin')]);
    caret(e, 0, 13);
    modEnter(e);
    await tick();
    e.undo();
    await tick();
    expect(show(e)).toEqual(['paragraph:Primera mitad segunda mitad', 'paragraph:fin']);
    caret(e, 1, 3);
    modEnter(e);
    await tick();
    e.undo();
    await tick();
    expect(show(e)).toEqual(['paragraph:Primera mitad segunda mitad', 'paragraph:fin']);
  });

  it('mover una sección colapsada que tiene un salto adentro lo conserva, y deshacer también', async () => {
    const { e, doc } = page([h(2, 'S'), p('s1'), br(), p('s2'), h(2, 'G'), p('g1'), p('fin')]);
    setCollapsed(e.prosemirrorView!, [flat(e)[0].id], true);
    await tick();
    caret(e, 0, 1);
    press(e, 'ArrowDown', { shiftKey: true, ...(mac ? { metaKey: true } : { ctrlKey: true }) });
    await tick();
    expect(show(e)).toEqual(['heading:G', 'heading:S', 'paragraph:s1', 'BR:', 'paragraph:s2', 'paragraph:g1', 'paragraph:fin']);
    expect(breaks(mount(doc))).toHaveLength(1);
    e.undo();
    await tick();
    expect(breaks(e)).toHaveLength(1);
  });
});

describe('pegar adentro de un salto', () => {
  it('texto plano en un salto vacío: queda arriba de la línea, con el salto', () => {
    const { e } = page([p('Uno'), br(), p('Dos')]);
    caret(e, 1, 0);
    e.pasteText('Pegado plano');
    expect(show(e)).toEqual(['paragraph:Uno', 'BR:Pegado plano', 'paragraph:Dos']);
  });

  it('varios párrafos en un salto vacío: el salto queda una vez, después del último', () => {
    const { e } = page([p('Uno'), br(), p('Dos')]);
    caret(e, 1, 0);
    e.pasteHTML('<p>A</p><p>B</p><p>C</p>');
    expect(show(e)).toEqual(['paragraph:Uno', 'paragraph:A', 'paragraph:B', 'BR:C', 'paragraph:Dos']);
  });

  it('si lo último pegado es un título, el salto va en un renglón vacío debajo', () => {
    const { e } = page([p('Uno'), br(), p('Dos')]);
    caret(e, 1, 0);
    e.pasteHTML('<p>A</p><h2>Título</h2>');
    expect(show(e)).toEqual(['paragraph:Uno', 'paragraph:A', 'heading:Título', 'BR:', 'paragraph:Dos']);
  });

  it('sobre todo el texto elegido de un salto: el salto sigue', () => {
    const { e } = page([p('Uno'), br('Nota'), p('Dos')]);
    select(e, 1, 0, 1, 4);
    e.pasteHTML('<p>Nuevo</p>');
    expect(show(e)).toEqual(['paragraph:Uno', 'BR:Nuevo', 'paragraph:Dos']);
  });

  it('en el medio del texto de un salto, varios párrafos: un solo salto, después de lo pegado', () => {
    const { e } = page([p('Uno'), br('Nota'), p('Dos')]);
    caret(e, 1, 2);
    e.pasteHTML('<p>A</p><p>B</p>');
    expect(breaks(e)).toHaveLength(1);
    expect(show(e).join('|')).toMatch(/No.*A.*B.*ta/);
    expect(show(e).at(-1)).toBe('paragraph:Dos');
  });

  it('copiar con el formato de la app entre dos páginas conserva los saltos', async () => {
    const a = page([p('Uno'), br(), br('Con texto'), p('Dos')]).e;
    const html = await a.blocksToFullHTML(a.document.slice(0, 4));
    const b = page([p('X'), p('')]).e;
    caret(b, 1, 0);
    b.pasteHTML(html, true);
    expect(breaks(b)).toHaveLength(2);
  });
});

describe('la versión anterior (esquema publicado) sobre una página con saltos', () => {
  it('al abrirla no sube ningún cambio', async () => {
    const doc = new Y.Doc();
    const e = mount(doc);
    e.replaceBlocks(e.document, [p('Uno'), br(), p('Dos'), br('Nota')] as never);
    await tick();
    const docOld = new Y.Doc();
    Y.applyUpdate(docOld, Y.encodeStateAsUpdate(doc));
    const updates: Uint8Array[] = [];
    docOld.on('update', (u: Uint8Array) => updates.push(u));
    mount(docOld, previousSchema, false);
    await tick();
    expect(updates).toHaveLength(0);
  });

  it('Enter y Retroceso sobre un salto en la versión anterior: se pierde a lo sumo el salto, nunca el texto', async () => {
    const doc = new Y.Doc();
    const e = mount(doc);
    e.replaceBlocks(e.document, [p('Uno'), br(), p('Dos'), br('Nota'), p('Tres')] as never);
    await tick();
    const docOld = new Y.Doc();
    Y.applyUpdate(docOld, Y.encodeStateAsUpdate(doc));
    const updates: Uint8Array[] = [];
    docOld.on('update', (u: Uint8Array) => updates.push(u));
    const old = mount(docOld, previousSchema, false);
    await tick();
    caret(old, 3, 4);
    press(old, 'Enter');
    old.insertInlineContent('nuevo');
    caret(old, 2, 0);
    press(old, 'Backspace');
    await tick();
    for (const u of updates) Y.applyUpdate(doc, u);
    await tick();
    const all = flat(e).map((x) => x.t).join('|');
    for (const w of ['Uno', 'Dos', 'Nota', 'Tres', 'nuevo']) expect(all).toContain(w);
  });
});
