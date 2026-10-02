// @vitest-environment jsdom
// Restaurar con las extensiones REALES de la página (colapsar, la guarda del deshacer…): las pruebas de la auditoría de
// la entrega 1 (Docs/Doc_Historial.md, "Correcciones de la auditoría de la entrega 1").
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { yUndoPluginKey } from 'y-prosemirror';
import { PageHistory, type HistoryRow } from '../sync/history';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { yText } from './collabHarness';
import { SHARED_COLLAPSE_MAP } from './collapseEditor';
import { schema } from './editorSchema';
import { pageEditorExtensions } from './editorExtensions';
import { restoreInEditor } from './historyRestore';
import { createExtension } from '@blocknote/core';
import { Plugin } from '@tiptap/pm/state';

Range.prototype.getClientRects ??= (() => []) as never;
Range.prototype.getBoundingClientRect ??= (() => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 })) as never;

const editors: BlockNoteEditor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.unmount();
  document.body.replaceChildren();
});

function mount(doc: Y.Doc, withCollapse = true): BlockNoteEditor {
  const editor = BlockNoteEditor.create(
    withCollaboration({
      schema,
      collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
      extensions: pageEditorExtensions(withCollapse ? { shared: doc.getMap(SHARED_COLLAPSE_MAP), canShare: () => true, save: () => undefined } : null) as never,
    }),
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  editor.mount(el);
  editors.push(editor);
  return editor;
}
const view = (e: BlockNoteEditor) => e.prosemirrorView!;
const um = (e: BlockNoteEditor) => (yUndoPluginKey.getState(view(e).state as never) as { undoManager: Y.UndoManager }).undoManager;
const settle = () => new Promise((r) => setTimeout(r, 0));

function recorder(doc: Y.Doc) {
  const rows: HistoryRow[] = [];
  let clock = Date.parse('2026-10-01T10:00:00Z');
  doc.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin === 'remote') return;
    clock += 60 * 60_000;
    rows.push({ id: rows.length + 1, seq: rows.length + 1, createdBy: 'a', createdAt: new Date(clock).toISOString(), data: u });
  });
  return { rows, version: () => { const h = new PageHistory(rows); return h.version(h.sessions.length - 1); } };
}

const p = (id: string, text: string) => ({ id, type: 'paragraph', content: text }) as PartialBlock;


function mountFiltered(doc: Y.Doc, dropId: string): BlockNoteEditor {
  // Un plugin que descarta cualquier transacción que saque el bloque `dropId` (como haría colapsar sin la marca).
  const guard = createExtension({ key: 'zz-drop', prosemirrorPlugins: [new Plugin({ filterTransaction: (tr, state) => {
    if (!tr.docChanged) return true;
    let had = false; let has = false;
    state.doc.descendants((n) => { if (n.attrs?.id === dropId) had = true; });
    tr.doc.descendants((n) => { if (n.attrs?.id === dropId) has = true; });
    return !(had && !has);
  } })] });
  const editor = BlockNoteEditor.create(
    withCollaboration({
      schema,
      collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
      extensions: [...(pageEditorExtensions(null) as never[]), guard] as never,
    }),
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  editor.mount(el);
  editors.push(editor);
  return editor;
}

describe('restaurar: la comprobación final', () => {
  it('si un plugin descarta un tramo, se deshace lo aplicado y no dice restaurada', async () => {
    const doc = new Y.Doc();
    const ed = mountFiltered(doc, 'y');
    const rec = recorder(doc);
    ed.replaceBlocks(ed.document, [p('a', 'A'), p('b', 'B'), p('c', 'C')] as never);
    um(ed).stopCapturing();
    await settle();
    const v = rec.version();
    ed.insertBlocks([p('x', 'X')] as never, 'a', 'after');
    um(ed).stopCapturing();
    ed.insertBlocks([p('y', 'Y')] as never, 'c', 'after');
    um(ed).stopCapturing();
    ed.updateBlock('b', { content: 'B cambiado' } as never);
    um(ed).stopCapturing();
    await settle();
    const now = yText(doc);
    const stack = um(ed).undoStack.length;
    const out = restoreInEditor(view(ed), v);
    await settle();
    console.log('falla parcial:', JSON.stringify(out), '| ahora', yText(doc), '| antes', now, '| pila', stack, um(ed).undoStack.length, 'redo', um(ed).redoStack.length);
    expect(out).toEqual({ ok: false, reason: 'failed' });
    expect(yText(doc)).toBe(now);
    expect(um(ed).undoStack.length).toBe(stack);
    // Ctrl+Z después sigue deshaciendo lo de la persona (el cambio de B), no algo de la restauración fallida.
    um(ed).undo();
    expect(yText(doc)).toContain('A | X | B | C | Y');
  });

  it('dos tramos: Ctrl+Z (el deshacer del editor) también deshace todo en un paso, y rehacer lo vuelve a poner', async () => {
    const doc = new Y.Doc();
    const ed = mount(doc);
    const rec = recorder(doc);
    ed.replaceBlocks(ed.document, [p('a', 'A'), p('b', 'B'), p('c', 'C'), p('d', 'D')] as never);
    um(ed).stopCapturing();
    await settle();
    const v = rec.version();
    for (const [id, after] of [['x', 'a'], ['y', 'b'], ['z', 'd']]) {
      ed.insertBlocks([p(id, id.toUpperCase())] as never, after, 'after');
      um(ed).stopCapturing();
    }
    await settle();
    const now = yText(doc);
    const out = restoreInEditor(view(ed), v);
    expect(out.ok).toBe(true);
    expect(yText(doc)).toBe(yText(v));
    ed.undo();
    expect(yText(doc)).toBe(now);
    ed.redo();
    expect(yText(doc)).toBe(yText(v));
  });
});
