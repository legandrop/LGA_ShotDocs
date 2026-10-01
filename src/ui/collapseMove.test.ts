// @vitest-environment jsdom
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { yUndoPluginKey } from 'y-prosemirror';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { selectWholeBlock } from './blockHandle';
import type { HeadingRecord } from './collapse';
import { pmFromY } from './collabHarness';
import { collapseExtension, collapseState, dropSection, endSectionDrag, headingBackspaceExtension, setCollapsed, startSectionDrag } from './collapseEditor';
import { schema } from './editorSchema';

// Mover la sección entera (P.11, entrega 1b; Docs/Doc_Colapsar.md, "Mover la sección entera") con el editor real:
// Shift+Ctrl+↑/↓ y arrastrar los puntos de un título colapsado mueven su sección, los demás bloques saltan una
// sección colapsada como si fuera uno, se esconde lo mismo que antes, deshacer es un solo paso, y Yjs queda igual
// al editor. Lo que pasa con dos editores a la vez está en collabMove.test.ts.

Range.prototype.getClientRects ??= (() => []) as never;
Range.prototype.getBoundingClientRect ??= (() => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 })) as never;

const editors: BlockNoteEditor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.unmount();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function mount(doc = new Y.Doc(), initial?: ReadonlyMap<string, HeadingRecord>) {
  const editor = BlockNoteEditor.create(
    withCollaboration({
      schema,
      collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
      extensions: [collapseExtension({ initial }), headingBackspaceExtension],
    }),
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  editor.mount(el);
  editors.push(editor);
  return { editor, doc };
}

const h = (level: number, text: string, children: PartialBlock[] = []) => ({ type: 'heading', props: { level }, content: text, children }) as PartialBlock;
const p = (text: string, children: PartialBlock[] = []) => ({ type: 'paragraph', content: text, children }) as PartialBlock;
const view = (editor: BlockNoteEditor) => editor.prosemirrorView!;
const settle = () => new Promise((r) => setTimeout(r, 0));

function page(blocks: PartialBlock[]) {
  const m = mount();
  m.editor.replaceBlocks(m.editor.document, blocks as never);
  undoManager(m.editor).stopCapturing();
  return m;
}

const textOf = (b: { content?: unknown; type: string }) => (Array.isArray(b.content) ? b.content.map((c) => ('text' in c ? c.text : '')).join('') : b.type);

function idOf(editor: BlockNoteEditor, text: string): string {
  let found = '';
  const walk = (blocks: typeof editor.document) => {
    for (const b of blocks) {
      if (textOf(b) === text) found ||= b.id;
      walk(b.children);
    }
  };
  walk(editor.document);
  if (!found) throw new Error(`sin bloque "${text}"`);
  return found;
}

/** Todos los bloques en orden, con los hijos entre corchetes. */
function outline(editor: BlockNoteEditor): string {
  const walk = (blocks: typeof editor.document): string =>
    blocks.map((b) => textOf(b) + (b.children.length ? `[${walk(b.children)}]` : '')).join(' ');
  return walk(editor.document);
}

function visible(editor: BlockNoteEditor): string[] {
  const state = collapseState(editor.prosemirrorState)!;
  const out: string[] = [];
  const walk = (blocks: typeof editor.document) => {
    for (const b of blocks) {
      if (!state.analysis.hidden.has(b.id)) out.push(textOf(b));
      walk(b.children);
    }
  };
  walk(editor.document);
  return out;
}

const collapse = (editor: BlockNoteEditor, ...names: string[]) => setCollapsed(view(editor), names.map((n) => idOf(editor, n)), true);

function caret(editor: BlockNoteEditor, text: string, offset = 0) {
  const v = view(editor);
  const id = idOf(editor, text);
  let at = -1;
  v.state.doc.descendants((n, pos) => {
    if (at >= 0) return false;
    if (n.type.name === 'blockContainer' && n.attrs.id === id) at = pos + 2 + offset;
    return at < 0;
  });
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, at)));
}

function press(editor: BlockNoteEditor, key: string, init: KeyboardEventInit = {}) {
  view(editor).dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}
const moveKey = (editor: BlockNoteEditor, dir: 'up' | 'down') => press(editor, dir === 'up' ? 'ArrowUp' : 'ArrowDown', { shiftKey: true, ctrlKey: true });

const undoManager = (editor: BlockNoteEditor) => (yUndoPluginKey.getState(view(editor).state as never) as { undoManager: Y.UndoManager }).undoManager;

/** El editor muestra lo que dice Yjs (el mover se escribió bien en las dos pasadas). */
const inSync = (editor: BlockNoteEditor, doc: Y.Doc) => view(editor).state.doc.eq(pmFromY(editor as never, doc));

const caretText = (editor: BlockNoteEditor) => textOf(editor.getTextCursorPosition().block as never);

describe('Shift+Ctrl+↑/↓ con secciones colapsadas', () => {
  it('un título colapsado baja con su sección, saltando un bloque; Yjs queda igual y deshacer es un paso', async () => {
    const { editor, doc } = page([p('top'), h(2, 'S'), p('s1'), p('s2'), h(2, 'G'), p('end')]);
    collapse(editor, 'S');
    caret(editor, 'S', 1);
    moveKey(editor, 'down');
    await settle();
    expect(outline(editor)).toBe('top G S s1 s2 end');
    // G (un título abierto) quedó arriba: S esconde lo mismo que antes ("end" sigue a la vista, por el fin).
    expect(visible(editor)).toEqual(['top', 'G', 'S', 'end']);
    expect(caretText(editor)).toBe('S');
    expect(inSync(editor, doc)).toBe(true);
    editor.undo();
    await settle();
    expect(outline(editor)).toBe('top S s1 s2 G end');
    expect(visible(editor)).toEqual(['top', 'S', 'G', 'end']);
    expect(inSync(editor, doc)).toBe(true);
    editor.redo();
    await settle();
    expect(outline(editor)).toBe('top G S s1 s2 end');
    expect(visible(editor)).toEqual(['top', 'G', 'S', 'end']);
  });

  it('salta una sección colapsada entera, de bajada y de subida', async () => {
    const { editor, doc } = page([h(1, 'A'), p('a1'), h(1, 'B'), p('b1'), p('b2'), h(1, 'C'), p('c1')]);
    collapse(editor, 'A', 'B');
    caret(editor, 'A');
    moveKey(editor, 'down');
    await settle();
    expect(outline(editor)).toBe('B b1 b2 A a1 C c1');
    expect(visible(editor)).toEqual(['B', 'A', 'C', 'c1']);
    moveKey(editor, 'down');
    await settle();
    // C no está colapsado: A baja un bloque (entra en la sección de C, sin esconder c1: el fin).
    expect(outline(editor)).toBe('B b1 b2 C A a1 c1');
    expect(visible(editor)).toEqual(['B', 'C', 'A', 'c1']);
    moveKey(editor, 'up');
    moveKey(editor, 'up');
    await settle();
    expect(outline(editor)).toBe('A a1 B b1 b2 C c1');
    expect(visible(editor)).toEqual(['A', 'B', 'C', 'c1']);
    expect(inSync(editor, doc)).toBe(true);
  });

  it('un párrafo salta una sección colapsada como si fuera un bloque', async () => {
    const { editor } = page([p('x'), h(2, 'S'), p('s1'), p('s2'), h(2, 'T')]);
    collapse(editor, 'S');
    caret(editor, 'x');
    moveKey(editor, 'down');
    await settle();
    expect(outline(editor)).toBe('S s1 s2 x T');
    expect(visible(editor)).toEqual(['S', 'x', 'T']);
    moveKey(editor, 'up');
    await settle();
    expect(outline(editor)).toBe('x S s1 s2 T');
    expect(visible(editor)).toEqual(['x', 'S', 'T']);
  });

  it('sin nada colapsado en juego mueve BlockNote, como siempre', async () => {
    const { editor } = page([p('a'), p('b'), h(2, 'S'), p('s1')]);
    collapse(editor, 'S');
    caret(editor, 'a');
    moveKey(editor, 'down');
    await settle();
    expect(outline(editor)).toBe('b a S s1');
  });

  it('arriba o abajo de todo no hace nada', async () => {
    const { editor } = page([h(2, 'S'), p('s1'), p('x')]);
    collapse(editor, 'S');
    caret(editor, 'S');
    moveKey(editor, 'up');
    await settle();
    expect(outline(editor)).toBe('S s1 x');
  });

  it('una selección de varios bloques con un título colapsado se mueve con toda su sección', async () => {
    const { editor } = page([p('top'), p('x'), h(2, 'S'), p('s1'), h(2, 'T'), p('t1')]);
    collapse(editor, 'S', 'T');
    const v = view(editor);
    const from = v.state.doc.resolve(0);
    void from;
    caret(editor, 'x');
    const anchor = v.state.selection.anchor;
    caret(editor, 'S', 1);
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, anchor, v.state.selection.head)));
    moveKey(editor, 'down');
    await settle();
    expect(outline(editor)).toBe('top T t1 x S s1');
    expect(visible(editor)).toEqual(['top', 'T', 'x', 'S']);
  });

  it('en solo lectura no mueve nada (tampoco BlockNote)', async () => {
    const { editor, doc } = page([p('a'), p('b'), h(2, 'S'), p('s1')]);
    collapse(editor, 'S');
    const before = Y.encodeStateVector(doc);
    editor.isEditable = false;
    caret(editor, 'a');
    moveKey(editor, 'down');
    caret(editor, 'S');
    moveKey(editor, 'up');
    await settle();
    expect(outline(editor)).toBe('a b S s1');
    expect(Y.encodeStateVector(doc)).toEqual(before);
  });

  it('un título colapsado anidado al final de su grupo sale al de afuera con su sección', async () => {
    const { editor, doc } = page([p('padre', [p('hijo'), h(3, 'S'), p('s1')]), p('después')]);
    collapse(editor, 'S');
    caret(editor, 'S');
    moveKey(editor, 'down');
    await settle();
    expect(outline(editor)).toBe('padre[hijo] S s1 después');
    expect(visible(editor)).toEqual(['padre', 'hijo', 'S', 'después']);
    expect(inSync(editor, doc)).toBe(true);
  });
});

describe('arrastrar un título colapsado', () => {
  /** Lo que hace el tirador al empezar: BlockNote elige el bloque, y después la sección. */
  function drag(editor: BlockNoteEditor, text: string): boolean {
    selectWholeBlock(view(editor), idOf(editor, text));
    return startSectionDrag(view(editor), null);
  }
  const posBefore = (editor: BlockNoteEditor, text: string) => {
    caret(editor, text);
    return view(editor).state.selection.from - 2;
  };

  it('arrastra la sección entera y la suelta en otro lugar: un paso de deshacer', async () => {
    const { editor, doc } = page([h(2, 'S'), p('s1'), p('s2'), p('x'), h(2, 'T'), p('t1'), p('y')]);
    collapse(editor, 'S');
    // "x" está en la sección de S (hasta el próximo H2): S esconde s1, s2 y x.
    expect(visible(editor)).toEqual(['S', 'T', 't1', 'y']);
    expect(drag(editor, 'S')).toBe(true);
    expect(view(editor).state.selection.toJSON().type).toBe('sd-section');
    expect(dropSection(view(editor), posBefore(editor, 'y'))).toBe(true);
    await settle();
    expect(outline(editor)).toBe('T t1 S s1 s2 x y');
    expect(visible(editor)).toEqual(['T', 't1', 'S', 'y']);
    expect(inSync(editor, doc)).toBe(true);
    editor.undo();
    await settle();
    expect(outline(editor)).toBe('S s1 s2 x T t1 y');
    expect(visible(editor)).toEqual(['S', 'T', 't1', 'y']);
  });

  it('soltarla en su mismo lugar no hace nada; un título abierto lo arrastra BlockNote', async () => {
    const { editor, doc } = page([h(2, 'S'), p('s1'), h(2, 'T'), p('t1')]);
    collapse(editor, 'S');
    const before = Y.encodeStateVector(doc);
    expect(drag(editor, 'S')).toBe(true);
    expect(dropSection(view(editor), posBefore(editor, 's1'))).toBe(true);
    expect(Y.encodeStateVector(doc)).toEqual(before);
    expect(drag(editor, 'T')).toBe(false);
    endSectionDrag(view(editor));
    expect(dropSection(view(editor), 1)).toBe(false);
  });

  it('un bloque elegido entero que no es un título colapsado no cambia nada', () => {
    const { editor } = page([p('a'), h(2, 'S'), p('s1')]);
    collapse(editor, 'S');
    selectWholeBlock(view(editor), idOf(editor, 'a'));
    expect(startSectionDrag(view(editor), null)).toBe(false);
    expect(view(editor).state.selection).toBeInstanceOf(NodeSelection);
  });
});
