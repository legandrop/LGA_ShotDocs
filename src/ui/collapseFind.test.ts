// @vitest-environment jsdom
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import { yUndoPluginKey } from 'y-prosemirror';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { collapseExtension, collapseState, setCollapsed } from './collapseEditor';
import { schema } from './editorSchema';
import { findExtension, getFindState, hiddenCount, replaceAll, setFind, stepFind } from './findEditor';

// Colapsar (Docs/Doc_Colapsar.md) con la búsqueda en la página (Docs/Doc_Buscar.md), con el editor real y las dos
// extensiones: la búsqueda cuenta lo que está en secciones colapsadas, ir a una coincidencia escondida la abre
// para vos, y "Reemplazar todo" (que escribe en el Y.Doc) y su deshacer y rehacer no abren nada.

const editors: BlockNoteEditor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.unmount();
  document.body.replaceChildren();
});

function page(blocks: PartialBlock[]) {
  const doc = new Y.Doc();
  const editor = BlockNoteEditor.create(
    withCollaboration({
      schema,
      extensions: [findExtension, collapseExtension({})],
      collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
    }),
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  editor.mount(el);
  editors.push(editor);
  editor.replaceBlocks(editor.document, blocks as never);
  return { editor, doc };
}

const h = (text: string) => ({ type: 'heading', props: { level: 2 }, content: text }) as PartialBlock;
const p = (text: string) => ({ type: 'paragraph', content: text }) as PartialBlock;
const view = (e: BlockNoteEditor) => e.prosemirrorView!;
const tick = () => new Promise((r) => setTimeout(r, 30));
const texts = (e: BlockNoteEditor) => e.document.map((b) => (Array.isArray(b.content) ? b.content.map((c) => ('text' in c ? c.text : '')).join('') : ''));
const hiddenTexts = (e: BlockNoteEditor) => {
  const hidden = collapseState(view(e).state)!.analysis.hidden;
  return e.document.filter((b) => hidden.has(b.id)).map((b) => (Array.isArray(b.content) ? b.content.map((c) => ('text' in c ? c.text : '')).join('') : ''));
};

describe('buscar con secciones colapsadas', () => {
  it('cuenta lo escondido y, al ir a una coincidencia escondida, abre solo esa sección (para vos)', () => {
    const { editor } = page([h('T'), p('uno escondido'), h('U'), p('uno visible'), h('V'), p('nada')]);
    setCollapsed(view(editor), [editor.document[0].id, editor.document[4].id], true);
    editor.setTextCursorPosition(editor.document[3].id, 'start');
    setFind(view(editor), 'uno', {});
    const state = getFindState(view(editor).state);
    expect(state.matches).toHaveLength(2);
    expect(hiddenCount(state.matches, view(editor))).toBe(1);
    stepFind(view(editor), 1);
    expect(hiddenTexts(editor)).toEqual(['nada']);
    expect(hiddenCount(getFindState(view(editor).state).matches, view(editor))).toBe(0);
  });

  it('"Reemplazar todo" en secciones colapsadas las deja colapsadas; deshacer y rehacer también', async () => {
    const { editor } = page([h('T'), p('uno uno'), h('U'), p('otro uno'), h('V'), p('uno')]);
    await tick();
    const um = (yUndoPluginKey.getState(view(editor).state as never) as { undoManager: Y.UndoManager }).undoManager;
    um.stopCapturing();
    setCollapsed(view(editor), [editor.document[0].id, editor.document[2].id], true);
    const before = hiddenTexts(editor);
    expect(before).toEqual(['uno uno', 'otro uno']);
    setFind(view(editor), 'uno', {});
    const result = replaceAll(editor, 'dos');
    expect(result.replaced).toBe(4);
    expect(texts(editor)).toEqual(['T', 'dos dos', 'U', 'otro dos', 'V', 'dos']);
    expect(hiddenTexts(editor)).toEqual(['dos dos', 'otro dos']);
    um.undo();
    await tick();
    expect(texts(editor)).toEqual(['T', 'uno uno', 'U', 'otro uno', 'V', 'uno']);
    expect(hiddenTexts(editor)).toEqual(['uno uno', 'otro uno']);
    um.redo();
    await tick();
    expect(texts(editor)).toEqual(['T', 'dos dos', 'U', 'otro dos', 'V', 'dos']);
    expect(hiddenTexts(editor)).toEqual(['dos dos', 'otro dos']);
  });

  it('los enganches son de cada editor: abrir otro y cerrarlo no se los saca al primero', () => {
    const one = page([h('T'), p('uno'), h('U')]);
    const two = page([h('T'), p('uno'), h('U')]);
    two.editor.unmount();
    editors.splice(editors.indexOf(two.editor), 1);
    setCollapsed(view(one.editor), [one.editor.document[0].id], true);
    setFind(view(one.editor), 'uno', {});
    expect(hiddenCount(getFindState(view(one.editor).state).matches, view(one.editor))).toBe(1);
    stepFind(view(one.editor), 1);
    expect(hiddenTexts(one.editor)).toEqual([]);
  });
});
