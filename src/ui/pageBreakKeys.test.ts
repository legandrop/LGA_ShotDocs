// @vitest-environment jsdom
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { Slice } from '@tiptap/pm/model';
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

  it('Supr en un salto vacío que es el último hijo de un bloque: lo saca y lo de abajo no se mueve', async () => {
    const { e } = page([p('Madre', [p('hija'), br()]), p('Dos')]);
    caret(e, 2, 0);
    expect(press(e, 'Delete')).toBe(true);
    expect(show(e)).toEqual(['paragraph:Madre', 'paragraph:hija', 'paragraph:Dos']);
    // "Dos" sigue en su nivel (no sube adentro de "Madre" ni del salto) y el cursor queda al principio.
    expect(e.document.map((b) => textOf(b as never)).slice(0, 2)).toEqual(['Madre', 'Dos']);
    expect(e.document[0].children.map((b) => textOf(b as never))).toEqual(['hija']);
    expect(e.getTextCursorPosition().block.id).toBe(e.document[1].id);
    await tick();
    e.undo();
    await tick();
    expect(show(e)).toEqual(['paragraph:Madre', 'paragraph:hija', 'BR:', 'paragraph:Dos']);
    // Hijo único, y en el último bloque de la página (sin nada después): sin el salto, el renglón queda.
    const b = page([p('Madre', [br()]), p('Dos')]).e;
    caret(b, 1, 0);
    press(b, 'Delete');
    expect(show(b)).toEqual(['paragraph:Madre', 'paragraph:Dos']);
    expect(b.document[0].children).toHaveLength(0);
    const c = page([p('Uno'), br()]).e;
    caret(c, 1, 0);
    expect(press(c, 'Delete')).toBe(true);
    expect(flat(c).map((x) => `${x.k}:${x.t}`)).toEqual(['paragraph:Uno', 'paragraph:']);
  });

  it('Supr en un salto vacío último hijo de un hijo: sube los dos niveles y "Dos" no se mueve', () => {
    const { e } = page([p('L1', [p('L2', [p('x'), br()])]), p('Dos')]);
    caret(e, 3, 0);
    expect(press(e, 'Delete')).toBe(true);
    expect(show(e)).toEqual(['paragraph:L1', 'paragraph:L2', 'paragraph:x', 'paragraph:Dos']);
    expect(textOf(e.document[1] as never)).toBe('Dos');
    expect(e.getTextCursorPosition().block.id).toBe(e.document[1].id);
  });

  it('Supr en un salto vacío último hijo con un título colapsado afuera: no queda un renglón vacío adentro', async () => {
    const { e } = page([p('Madre', [br()]), h(2, 'Escena'), p('s1'), p('fin')]);
    setCollapsed(e.prosemirrorView!, [flat(e)[2].id], true);
    await tick();
    caret(e, 1, 0);
    expect(press(e, 'Delete')).toBe(true);
    await tick();
    expect(show(e)).toEqual(['paragraph:Madre', 'heading:Escena', 'paragraph:s1', 'paragraph:fin']);
    expect(e.document[0].children).toHaveLength(0);
    expect(e.getTextCursorPosition().block.id).toBe(e.document[1].id);
    expect(collapseState(e.prosemirrorState)!.analysis.hidden.has(flat(e)[2].id)).toBe(true);
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

  it('en el medio de un título colapsado o con una parte elegida: no lo parte ni abre la sección', async () => {
    for (const how of ['medio', 'elegido'] as const) {
      const { e } = page([p('top'), h(2, 'Escena'), p('s1'), p('s2'), h(2, 'G'), p('g1')]);
      setCollapsed(e.prosemirrorView!, [flat(e)[1].id], true);
      await tick();
      if (how === 'medio') caret(e, 1, 3);
      else select(e, 1, 1, 1, 4);
      expect(modEnter(e)).toBe(true);
      await tick();
      expect(show(e), how).toEqual(['paragraph:top', 'heading:Escena', 'paragraph:s1', 'paragraph:s2', 'BR:', 'heading:G', 'paragraph:g1']);
      const st = collapseState(e.prosemirrorState)!;
      expect(st.analysis.hidden.has(flat(e)[2].id), how).toBe(true);
      expect(st.analysis.hidden.has(e.getTextCursorPosition().block.id), how).toBe(false);
      e.undo();
      await tick();
      expect(show(e), how).toEqual(['paragraph:top', 'heading:Escena', 'paragraph:s1', 'paragraph:s2', 'heading:G', 'paragraph:g1']);
      expect(collapseState(e.prosemirrorState)!.analysis.hidden.has(flat(e)[2].id), how).toBe(true);
    }
  });

  it('con una selección que empieza en un título colapsado y sigue abajo (para los dos lados): no lo abre ni borra nada', async () => {
    for (const back of [false, true]) {
      const { e } = page([p('top'), h(2, 'Escena'), p('s1'), h(2, 'G'), p('g1')]);
      setCollapsed(e.prosemirrorView!, [flat(e)[1].id], true);
      await tick();
      if (back) select(e, 3, 1, 1, 3);
      else select(e, 1, 3, 3, 1);
      expect(modEnter(e)).toBe(true);
      await tick();
      expect(show(e), String(back)).toEqual(['paragraph:top', 'heading:Escena', 'paragraph:s1', 'BR:', 'heading:G', 'paragraph:g1']);
      expect(collapseState(e.prosemirrorState)!.analysis.hidden.has(flat(e)[2].id), String(back)).toBe(true);
    }
  });

  it('al principio de un título colapsado: el salto va antes y la sección sigue colapsada', async () => {
    const { e } = page([p('top'), h(2, 'Escena'), p('s1'), h(2, 'G')]);
    setCollapsed(e.prosemirrorView!, [flat(e)[1].id], true);
    await tick();
    caret(e, 1, 0);
    expect(modEnter(e)).toBe(true);
    await tick();
    expect(show(e)).toEqual(['paragraph:top', 'BR:', 'heading:Escena', 'paragraph:s1', 'heading:G']);
    expect(collapseState(e.prosemirrorState)!.analysis.hidden.has(flat(e)[3].id)).toBe(true);
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

  it('lo pegado que ya trae saltos los conserva, y el salto donde se pegó queda una sola vez', async () => {
    const a = page([p('A'), br(), p('B'), br('Con texto'), p('C')]).e;
    const html = await a.blocksToFullHTML(a.document.slice(0, 5));
    // En un salto vacío y sobre el texto elegido de un salto: lo pegado arriba, con sus saltos, y el salto al final.
    const vacio = page([p('Uno'), br(), p('Dos')]).e;
    caret(vacio, 1, 0);
    vacio.pasteHTML(html, true);
    expect(show(vacio)).toEqual(['paragraph:Uno', 'paragraph:A', 'BR:', 'paragraph:B', 'BR:Con texto', 'BR:C', 'paragraph:Dos']);
    const elegido = page([p('Uno'), br('Nota'), p('Dos')]).e;
    select(elegido, 1, 0, 1, 4);
    elegido.pasteHTML(html, true);
    expect(show(elegido)).toEqual(['paragraph:Uno', 'paragraph:A', 'BR:', 'paragraph:B', 'BR:Con texto', 'BR:C', 'paragraph:Dos']);
    // En el medio del texto de un salto: el primero pegado se junta con "No" y no hereda el salto.
    const medio = page([p('Uno'), br('Nota'), p('Dos')]).e;
    caret(medio, 1, 2);
    medio.pasteHTML(html, true);
    expect(show(medio)).toEqual(['paragraph:Uno', 'paragraph:NoA', 'BR:', 'paragraph:B', 'BR:Con texto', 'BR:Cta', 'paragraph:Dos']);
    // Un solo Ctrl+Z deshace el pegado y el arreglo del salto.
    await tick();
    medio.undo();
    await tick();
    expect(show(medio)).toEqual(['paragraph:Uno', 'BR:Nota', 'paragraph:Dos']);
  });

  it('si lo pegado termina en un salto, no se duplica; uno pegado de afuera también se conserva', async () => {
    const a = page([p('A'), br()]).e;
    const html = await a.blocksToFullHTML(a.document.slice(0, 2));
    const b = page([p('Uno'), br(), p('Dos')]).e;
    caret(b, 1, 0);
    b.pasteHTML(html, true);
    expect(show(b)).toEqual(['paragraph:Uno', 'paragraph:A', 'BR:', 'paragraph:Dos']);
    const c = page([p('Uno'), br(), p('Dos')]).e;
    caret(c, 1, 0);
    c.pasteHTML('<p>A</p><p style="break-after: page"></p><p>B</p>');
    expect(show(c)).toEqual(['paragraph:Uno', 'paragraph:A', 'BR:', 'BR:B', 'paragraph:Dos']);
  });

  it('si lo último pegado es Script, el salto va en un renglón vacío debajo (no van juntos)', async () => {
    const a = page([p('A'), { type: 'paragraph', props: paragraphProps('script'), content: 'INT. CASA - DÍA' } as PartialBlock]).e;
    const html = await a.blocksToFullHTML(a.document.slice(0, 2));
    const { e } = page([p('Uno'), br(), p('Dos')]);
    caret(e, 1, 0);
    e.pasteHTML(html, true);
    expect(show(e)).toEqual(['paragraph:Uno', 'paragraph:A', 'paragraph:INT. CASA - DÍA', 'BR:', 'paragraph:Dos']);
    const script = e.document.find((b) => textOf(b as never) === 'INT. CASA - DÍA')!;
    expect(script.props).toMatchObject({ script: true, [PAGE_BREAK_PROP]: false });
  });

  it('si no se sabe qué bloque pegado es cuál (cantidades distintas), queda un solo salto', () => {
    const { e } = page([p('Uno'), br(), p('Dos')]);
    const view = e.prosemirrorView!;
    // Bloques de otra página, pasados al esquema de esta (cada editor tiene el suyo).
    const blocksOf = (blocks: PartialBlock[]) => {
      const group = page(blocks).e.prosemirrorState.doc.firstChild!;
      return Slice.fromJSON(view.state.schema, new Slice(group.content, 0, 0).toJSON());
    };
    const recorded = blocksOf([p('A'), br(), p('B'), p('C')]);
    const inserted = blocksOf([p('X'), p('Y'), p('Z')]);
    caret(e, 1, 0);
    // Lo que anota el pegado es de un contenido y lo que entra es otro: no se puede emparejar.
    view.someProp('transformPasted', (f) => {
      f(recorded, view, false);
    });
    view.dispatch(view.state.tr.replaceSelection(inserted).setMeta('paste', true).setMeta('uiEvent', 'paste'));
    expect(breaks(e), show(e).join('|')).toHaveLength(1);
    expect(show(e).filter((x) => /X|Y|Z/.test(x))).toEqual(['paragraph:X', 'paragraph:Y', 'BR:Z']);
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

  it('lo que dejan pegar con saltos, Supr en un hijo y Ctrl/⌘+Enter en un título colapsado: la versión anterior lo abre sin cambios', async () => {
    const src = page([p('A'), br(), p('B'), br('Con texto'), p('C')]).e;
    const html = await src.blocksToFullHTML(src.document.slice(0, 5));
    const { e, doc } = page([p('Uno'), br(), p('Madre', [p('hija'), br()]), h(2, 'Escena'), p('s1'), p('Dos')]);
    caret(e, 1, 0);
    e.pasteHTML(html, true);
    caret(e, flat(e).findIndex((x) => x.t === 'hija') + 1, 0);
    press(e, 'Delete');
    setCollapsed(e.prosemirrorView!, [flat(e).find((x) => x.t === 'Escena')!.id], true);
    await tick();
    caret(e, flat(e).findIndex((x) => x.t === 'Escena'), 3);
    modEnter(e);
    await tick();
    const docOld = new Y.Doc();
    Y.applyUpdate(docOld, Y.encodeStateAsUpdate(doc));
    const updates: Uint8Array[] = [];
    docOld.on('update', (u: Uint8Array) => updates.push(u));
    const old = mount(docOld, previousSchema, false);
    await tick();
    expect(updates).toHaveLength(0);
    expect(flat(old).map((x) => x.t).filter(Boolean)).toEqual(['Uno', 'A', 'B', 'Con texto', 'C', 'Madre', 'hija', 'Escena', 's1', 'Dos']);
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
