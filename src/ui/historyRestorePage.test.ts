// @vitest-environment jsdom
// Restaurar con las extensiones REALES de la página (colapsar, la guarda del deshacer…): las pruebas de la auditoría de
// la entrega 1 (Docs/Doc_Historial.md, "Correcciones de la auditoría de la entrega 1").
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { yUndoPluginKey } from 'y-prosemirror';
import { PageHistory, yShape, type HistoryRow } from '../sync/history';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { connect, yText } from './collabHarness';
import { collapseState, setCollapsed, SHARED_COLLAPSE_MAP } from './collapseEditor';
import { schema } from './editorSchema';
import { pageEditorExtensions } from './editorExtensions';
import { restoreInEditor } from './historyRestore';

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

const h = (id: string, text: string) => ({ id, type: 'heading', props: { level: 2 }, content: text }) as PartialBlock;
const p = (id: string, text: string) => ({ id, type: 'paragraph', content: text }) as PartialBlock;

describe('restaurar con las extensiones de la página', () => {
  it('con una sección colapsada cuyo contenido cambió: la página queda igual a la versión', async () => {
    const doc = new Y.Doc();
    const ed = mount(doc);
    const rec = recorder(doc);
    ed.replaceBlocks(ed.document, [p('top', 'Arriba'), h('S', 'Sección'), p('s1', 'Uno'), p('s2', 'Dos'), h('T', 'Otra'), p('t1', 'Tres')] as never);
    um(ed).stopCapturing();
    await settle();
    const v = rec.version();
    // Después de la versión: se agrega un bloque dentro de S y se cambia otro, y se colapsa S.
    ed.insertBlocks([p('s3', 'Agregado en S')] as never, 's2', 'after');
    ed.updateBlock('s1', { content: 'Uno cambiado' } as never);
    ed.updateBlock('top', { content: 'Arriba cambiado' } as never);
    um(ed).stopCapturing();
    setCollapsed(view(ed), ['S'], true);
    await settle();
    expect([...collapseState(view(ed).state)!.analysis.hidden.keys()].sort()).toEqual(['s1', 's2', 's3']);
    const before = yText(doc);
    const out = restoreInEditor(view(ed), v);
    await settle();
    await settle();
    console.log('colapsada: ok=', out.ok, '\n  ahora  :', yText(doc), '\n  version:', yText(v), '\n  antes  :', before);
    expect(out.ok).toBe(true);
    expect(yText(doc)).toBe(yText(v));
    expect(yShape(doc).ids).toEqual(yShape(v).ids);
  });

  it('sin colapsar (mismo caso, control)', async () => {
    const doc = new Y.Doc();
    const ed = mount(doc);
    const rec = recorder(doc);
    ed.replaceBlocks(ed.document, [p('top', 'Arriba'), h('S', 'Sección'), p('s1', 'Uno'), p('s2', 'Dos'), h('T', 'Otra'), p('t1', 'Tres')] as never);
    um(ed).stopCapturing();
    await settle();
    const v = rec.version();
    ed.insertBlocks([p('s3', 'Agregado en S')] as never, 's2', 'after');
    ed.updateBlock('s1', { content: 'Uno cambiado' } as never);
    ed.updateBlock('top', { content: 'Arriba cambiado' } as never);
    um(ed).stopCapturing();
    const out = restoreInEditor(view(ed), v);
    expect(out.ok).toBe(true);
    expect(yText(doc)).toBe(yText(v));
  });

  it('dos tramos que sacan bloques con la guarda del deshacer: el Undo del aviso deshace TODO en un paso', async () => {
    const doc = new Y.Doc();
    const ed = mount(doc);
    const rec = recorder(doc);
    ed.replaceBlocks(ed.document, [p('a', 'A'), p('b', 'B'), p('c', 'C'), p('d', 'D'), p('e', 'E')] as never);
    um(ed).stopCapturing();
    await settle();
    const v = rec.version();
    ed.insertBlocks([p('x', 'X')] as never, 'a', 'after');
    um(ed).stopCapturing();
    ed.insertBlocks([p('y', 'Y')] as never, 'c', 'after');
    um(ed).stopCapturing();
    ed.insertBlocks([p('z', 'Z')] as never, 'e', 'after');
    um(ed).stopCapturing();
    await settle();
    const now = yText(doc);
    const out = restoreInEditor(view(ed), v);
    expect(out.ok).toBe(true);
    expect(yText(doc)).toBe(yText(v));
    await settle();
    expect(out.ok && out.undo()).toBe(true);
    await settle();
    console.log('undo un paso: ahora', yText(doc), '| esperado', now);
    expect(yText(doc)).toBe(now);
  });

  it('restaurar una versión igual a lo actual: el Undo del aviso no deshace lo que la persona escribió antes', async () => {
    const doc = new Y.Doc();
    const ed = mount(doc);
    const rec = recorder(doc);
    ed.replaceBlocks(ed.document, [p('a', 'Hola')] as never);
    um(ed).stopCapturing();
    await settle();
    // La persona escribe y lo borra (dos pasos): el contenido queda igual a la versión de la sesión anterior.
    ed.updateBlock('a', { content: 'Hola mundo' } as never);
    um(ed).stopCapturing();
    const v = rec.version();
    ed.updateBlock('a', { content: 'Hola' } as never);
    um(ed).stopCapturing();
    await settle();
    // v = "Hola mundo"; ahora "Hola". Restauro una versión igual a lo actual: la de antes del "mundo".
    const h0 = new PageHistory(rec.rows);
    const same = h0.version(0);
    expect(yText(same)).toBe(yText(doc));
    const out = restoreInEditor(view(ed), same);
    expect(out.ok).toBe(true);
    const undone = out.ok && out.undo();
    console.log('no-op: undo() devolvió', undone, '; texto después del Undo:', yText(doc), '(antes: Hola)');
    expect(yText(doc)).toBe('Hola');
    void v;
  });

  it('con un salto de hoja y una tabla: queda igual a la versión', async () => {
    const doc = new Y.Doc();
    const ed = mount(doc);
    const rec = recorder(doc);
    ed.replaceBlocks(ed.document, [
      p('a', 'Antes'),
      { id: 'br', type: 'paragraph', props: { pageBreak: true }, content: '' } as never,
      { id: 'tb', type: 'table', content: { type: 'tableContent', rows: [{ cells: ['1', '2'] }, { cells: ['3', '4'] }] } } as never,
      p('z', 'Después'),
    ] as never);
    um(ed).stopCapturing();
    await settle();
    const v = rec.version();
    ed.removeBlocks(['br']);
    ed.updateBlock('tb', { content: { type: 'tableContent', rows: [{ cells: ['1', 'cambiado'] }, { cells: ['3', '4'] }] } } as never);
    um(ed).stopCapturing();
    const out = restoreInEditor(view(ed), v);
    expect(out.ok).toBe(true);
    expect(yText(doc)).toBe(yText(v));
    expect(yShape(doc)).toEqual(yShape(v));
    const brNode = doc.getXmlFragment(CONTENT_FRAGMENT).toString();
    expect(brNode).toContain('pageBreak="true"');
  });

  it('otro escribe en una sección colapsada (para A) mientras A restaura', async () => {
    const da = new Y.Doc();
    const dbb = new Y.Doc();
    const link = connect(da, dbb, 'async');
    const a = mount(da);
    const rec = recorder(da);
    a.replaceBlocks(a.document, [p('top', 'Arriba'), h('S', 'Sección'), p('s1', 'Uno'), p('s2', 'Dos')] as never);
    um(a).stopCapturing();
    link.flush();
    const b = mount(dbb);
    await settle();
    const v = rec.version();
    a.updateBlock('top', { content: 'Arriba cambiado' } as never);
    um(a).stopCapturing();
    link.flush();
    await settle();
    setCollapsed(view(a), ['S'], true);
    link.offline();
    b.updateBlock('s2', { content: 'Dos. Escrito por B.' } as never);
    const out = restoreInEditor(view(a), v);
    expect(out.ok).toBe(true);
    link.online();
    link.flush();
    await settle();
    expect(yText(da)).toBe(yText(dbb));
    expect(yText(da)).toContain('Escrito por B');
    expect(yText(da)).toContain('Arriba | ');
  });
});
