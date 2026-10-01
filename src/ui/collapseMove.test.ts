// @vitest-environment jsdom
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { yUndoPluginKey } from 'y-prosemirror';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { selectWholeBlock } from './blockHandle';
import { dispatchMove } from './blockMove';
import type { HeadingRecord } from './collapse';
import { pmFromY } from './collabHarness';
import { collapseExtension, collapseState, dropSection, endSectionDrag, headingBackspaceExtension, setCollapsed, startSectionDrag } from './collapseEditor';
import { schema } from './editorSchema';

// Mover la sección entera (P.11, entrega 1b; Docs/Doc_Colapsar.md, "Mover la sección entera") con el editor real:
// Shift+Ctrl+↑/↓ y arrastrar los puntos de un título colapsado mueven su sección, los demás bloques saltan una
// sección colapsada como si fuera uno, se esconde lo mismo que antes, deshacer es un solo paso, y Yjs queda igual
// al editor. Lo que pasa con dos editores a la vez está en collabMove.test.ts.

// El mover en dos pasadas (blockMove.ts), espiado sin cambiarlo: la decisión 1A (Doc_Colapsar.md, "Decisiones") dice
// que se usa solo con algo colapsado en juego.
vi.mock('./blockMove', async (original) => {
  const m = await original<typeof import('./blockMove')>();
  return { ...m, dispatchMove: vi.fn(m.dispatchMove) };
});
const twoPass = vi.mocked(dispatchMove);

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
    // La selección no cambia (cambiarla en el `dragstart` cancela el arrastre en Chromium); se suelta lo arrastrado.
    expect(view(editor).state.selection).toBeInstanceOf(NodeSelection);
    expect((view(editor) as unknown as { dragging: { slice: { content: { childCount: number } } } }).dragging.slice.content.childCount).toBe(4);
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

describe('auditoría de la 1b', () => {
  const posAfter = (editor: BlockNoteEditor, text: string) => {
    const id = idOf(editor, text);
    let at = -1;
    view(editor).state.doc.descendants((n, pos) => {
      if (at < 0 && n.type.name === 'blockContainer' && n.attrs.id === id) at = pos + n.nodeSize;
      return at < 0;
    });
    return at;
  };

  it('I-1. soltar una sección justo debajo de otro título colapsado la deja después de toda su sección', async () => {
    const { editor, doc } = page([h(2, 'S'), p('s1'), h(2, 'H'), p('h1'), p('h2'), h(2, 'Z'), p('z1')]);
    collapse(editor, 'S', 'H');
    selectWholeBlock(view(editor), idOf(editor, 'S'));
    expect(startSectionDrag(view(editor), null)).toBe(true);
    expect(dropSection(view(editor), posAfter(editor, 'H'))).toBe(true);
    await settle();
    expect(outline(editor)).toBe('H h1 h2 S s1 Z z1');
    expect(visible(editor)).toEqual(['H', 'S', 'Z', 'z1']);
    expect(inSync(editor, doc)).toBe(true);
  });

  it('M-1. un título colapsado que es el único hijo sale de su bloque sin dejar un renglón vacío', async () => {
    for (const dir of ['up', 'down'] as const) {
      const { editor, doc } = page([p('padre', [h(3, 'S', [p('s-hijo')])]), p('después')]);
      collapse(editor, 'S');
      caret(editor, 'S');
      moveKey(editor, dir);
      await settle();
      expect(outline(editor)).toBe(dir === 'up' ? 'S[s-hijo] padre después' : 'padre S[s-hijo] después');
      expect(inSync(editor, doc)).toBe(true);
      editor.undo();
      await settle();
      expect(outline(editor)).toBe('padre[S[s-hijo]] después');
    }
  });

  it('M-3. un arrastre que empieza en el texto olvida la sección que se había empezado a arrastrar', () => {
    const { editor } = page([h(2, 'S'), p('s1'), p('x')]);
    collapse(editor, 'S');
    selectWholeBlock(view(editor), idOf(editor, 'S'));
    expect(startSectionDrag(view(editor), null)).toBe(true);
    view(editor).dom.dispatchEvent(new Event('dragstart', { bubbles: true }));
    expect(dropSection(view(editor), 1)).toBe(false);
  });
});

describe('decisión 1A: el mover en dos pasadas, solo con algo colapsado en juego', () => {
  /** Mueve con el teclado y dice si pasó por el mover en dos pasadas (y cómo quedó). */
  async function keyMove(blocks: PartialBlock[], collapsed: string[], at: string, dir: 'up' | 'down') {
    const { editor, doc } = page(blocks);
    if (collapsed.length) collapse(editor, ...collapsed);
    caret(editor, at);
    twoPass.mockClear();
    moveKey(editor, dir);
    await settle();
    return { twoPass: twoPass.mock.calls.length, outline: outline(editor), inSync: inSync(editor, doc) };
  }

  it('sin nada colapsado en juego, mueve BlockNote (un renglón suelto, un título abierto, colapsado lejos)', async () => {
    // Nada colapsado en la página.
    expect(await keyMove([p('a'), p('b'), p('c')], [], 'a', 'down')).toEqual({ twoPass: 0, outline: 'b a c', inSync: true });
    expect(await keyMove([h(2, 'S'), p('s1'), p('x')], [], 'S', 'down')).toEqual({ twoPass: 0, outline: 's1 S x', inSync: true });
    // Una sección colapsada en la página, pero ni se mueve ni se salta.
    expect(await keyMove([p('a'), p('b'), h(2, 'S'), p('s1')], ['S'], 'a', 'down')).toEqual({ twoPass: 0, outline: 'b a S s1', inSync: true });
    expect(await keyMove([h(2, 'S'), p('s1'), h(1, 'U'), p('a'), p('b')], ['S'], 'b', 'up')).toEqual({ twoPass: 0, outline: 'S s1 U b a', inSync: true });
    // Un título colapsado que no esconde nada (el próximo es de su nivel) no está en juego.
    expect(await keyMove([p('a'), h(2, 'S'), h(2, 'T'), p('t1')], ['S'], 'a', 'down')).toEqual({ twoPass: 0, outline: 'S a T t1', inSync: true });
  });

  it('con algo colapsado en juego, el mover en dos pasadas (una sola vez)', async () => {
    // Lo que se mueve tiene un título colapsado.
    expect(await keyMove([h(2, 'S'), p('s1'), h(2, 'G'), p('g1')], ['S'], 'S', 'down')).toEqual({ twoPass: 1, outline: 'G S s1 g1', inSync: true });
    // Un renglón suelto (o un título abierto) que salta una sección colapsada, de bajada y de subida.
    expect(await keyMove([p('x'), h(2, 'S'), p('s1'), h(2, 'T')], ['S'], 'x', 'down')).toEqual({ twoPass: 1, outline: 'S s1 x T', inSync: true });
    expect(await keyMove([h(2, 'S'), p('s1'), p('s2'), h(1, 'T'), p('x')], ['S'], 'T', 'up')).toEqual({ twoPass: 1, outline: 'T S s1 s2 x', inSync: true });
  });

  it('arrastrar: un bloque sin título colapsado lo arrastra BlockNote; un título colapsado, el mover en dos pasadas', async () => {
    const { editor, doc } = page([p('a'), h(2, 'S'), p('s1'), h(2, 'Z')]);
    collapse(editor, 'S');
    twoPass.mockClear();
    selectWholeBlock(view(editor), idOf(editor, 'a'));
    expect(startSectionDrag(view(editor), null)).toBe(false);
    expect(dropSection(view(editor), 1)).toBe(false);
    expect(twoPass).not.toHaveBeenCalled();
    selectWholeBlock(view(editor), idOf(editor, 'S'));
    expect(startSectionDrag(view(editor), null)).toBe(true);
    caret(editor, 'a');
    expect(dropSection(view(editor), view(editor).state.selection.from - 2)).toBe(true);
    await settle();
    expect(twoPass).toHaveBeenCalledTimes(1);
    expect(outline(editor)).toBe('S s1 a Z');
    expect(inSync(editor, doc)).toBe(true);
  });
});

describe('fotos en línea adentro de una sección colapsada que se mueve', () => {
  const ph = (name: string) => ({ type: 'photo', props: { url: `sdmedia://${name}`, name: `${name}.jpg`, w: 0.3 } });
  const withPhotos = (text: string, ...names: string[]) =>
    ({ type: 'paragraph', content: [{ type: 'text', text, styles: {} }, ...names.map(ph)] }) as unknown as PartialBlock;
  type Walkable = { descendants: (f: (n: { type: { name: string }; attrs: Record<string, unknown> }) => boolean | void) => void };
  const collect = (root: Walkable) => {
    const out: string[] = [];
    root.descendants((n) => {
      if (n.type.name === 'photo') out.push(String(n.attrs.url));
    });
    return out;
  };
  /** Las fotos en línea del documento, en orden: lo que muestra el editor y lo que tiene Yjs. */
  const photos = (editor: BlockNoteEditor, doc: Y.Doc) => ({
    pm: collect(view(editor).state.doc as unknown as Walkable),
    y: collect(pmFromY(editor as never, doc) as unknown as Walkable),
  });

  it('el teclado y el arrastre las llevan con la sección, sin perder ni duplicar ninguna (también del lado recreado)', async () => {
    const { editor, doc } = page([p('top'), h(2, 'S'), withPhotos('s1', 'f1', 'f2'), p('s2'), withPhotos('s3', 'f3'), h(2, 'T'), withPhotos('t1', 'f4'), h(1, 'End')]);
    collapse(editor, 'S', 'T');
    const all = ['sdmedia://f1', 'sdmedia://f2', 'sdmedia://f3', 'sdmedia://f4'];
    expect(photos(editor, doc)).toEqual({ pm: all, y: all });
    // S (4 bloques) salta la sección colapsada T (2): Yjs recrea T, con su foto.
    caret(editor, 'S');
    moveKey(editor, 'down');
    await settle();
    expect(outline(editor)).toBe('top T t1 S s1 s2 s3 End');
    const moved = ['sdmedia://f4', 'sdmedia://f1', 'sdmedia://f2', 'sdmedia://f3'];
    expect(photos(editor, doc)).toEqual({ pm: moved, y: moved });
    editor.undo();
    await settle();
    expect(outline(editor)).toBe('top S s1 s2 s3 T t1 End');
    expect(photos(editor, doc)).toEqual({ pm: all, y: all });
    // Arrastrar S arriba de todo: S (4) salta "top" (1), que se recrea.
    selectWholeBlock(view(editor), idOf(editor, 'S'));
    expect(startSectionDrag(view(editor), null)).toBe(true);
    caret(editor, 'top');
    expect(dropSection(view(editor), view(editor).state.selection.from - 2)).toBe(true);
    await settle();
    expect(outline(editor)).toBe('S s1 s2 s3 top T t1 End');
    expect(photos(editor, doc)).toEqual({ pm: all, y: all });
    expect(inSync(editor, doc)).toBe(true);
  });
});
