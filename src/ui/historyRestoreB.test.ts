// @vitest-environment jsdom
import { writeFileSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BlockNoteEditor, defaultBlockSpecs, BlockNoteSchema } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { ySyncPluginKey } from 'y-prosemirror';
import { FakeServer, makeDevice } from '../sync/testing';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { PageHistory, type HistoryRow } from '../sync/history';
import { LINE_FIELDS, lineProbe, observeLineRecovery, recoveryPreview, type LineRecovery } from '../sync/historyMapWitness';
import { PHOTO_MARKUP_MAP, addShape } from '../media/markup';
import { schema } from './editorSchema';
import { pageEditorExtensions } from './editorExtensions';
import { trackMarkupInUndo } from './markupClipboardEditor';
import { editorUndo, restoreInEditor } from './historyRestore';
import { captureRestoreTarget, registerRestoreTarget, requestRestore } from './historyUi';
import { UndoTimeline } from './undoTimeline';
import { createUndoRunner } from './undoTimelineUi';

Range.prototype.getClientRects ??= (() => []) as never;
Range.prototype.getBoundingClientRect ??= (() => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 })) as never;
const file = '0f8fad5b-d9cb-469f-a165-708677289501', key = `${file}/s1`;
const basal = { type: 'line', zValue: 1, posX: 10, posY: 10, startX: 0, startY: 0, endX: 50, endY: 50, strokeColor: '#FF0000' };
const xml = (doc: Y.Doc) => doc.getXmlFragment(CONTENT_FRAGMENT).toString();
const shape = (doc: Y.Doc) => doc.getMap(PHOTO_MARKUP_MAP).get(key) as Y.Map<unknown>;
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).reverse().forEach(fn => fn()); document.body.replaceChildren(); });
async function mounted() {
  const server = new FakeServer(), dbName = `history-map-${crypto.randomUUID()}`;
  const d = await makeDevice(server, dbName, '0.999');
  cleanups.push(() => { d.docs.dispose(); d.engine.stop(); d.db.close(); d.mediaDb.close(); d.commentsDb.close(); });
  const pageId = await d.tree.create(null, 'Restore B'), doc = await d.docs.open(pageId, { seed: true });
  const rows: HistoryRow[] = [];
  doc.on('update', data => rows.push({ id: rows.length + 1, seq: rows.length + 1, data: data.slice(), createdAt: new Date(rows.length * 31 * 60_000).toISOString(), createdBy: 'A' }));
  // La semilla original también forma parte del prefijo público.
  rows.push({ id: 1, seq: 1, data: Y.encodeStateAsUpdate(doc), createdAt: new Date(0).toISOString(), createdBy: 'A' });
  const ed = BlockNoteEditor.create(withCollaboration({ schema, collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'A', color: '#000' } }, extensions: pageEditorExtensions(null) as never })) as unknown as BlockNoteEditor;
  const host = document.createElement('div'); document.body.append(host); ed.mount(host); cleanups.push(() => ed.unmount());
  ed.replaceBlocks(ed.document, [{ id: 'B-text', type: 'paragraph', content: 'Texto intacto' }, { id: 'B-photo', type: 'image', props: { url: `sdmedia://${file}`, name: 'Test.jpg' } }] as never);
  addShape(doc, file, 's1', basal as never, { w: 4000, h: 3000 });
  const version = new Y.Doc(); Y.applyUpdate(version, Y.encodeStateAsUpdate(doc)); cleanups.push(() => version.destroy());
  const view = ed.prosemirrorView!, manager = editorUndo(view)!;
  trackMarkupInUndo(view.state, doc);
  const timeline = new UndoTimeline({ docs: d.docs, projectOf: () => d.tree.get(pageId)!.workspace_id });
  cleanups.push(() => timeline.dispose());
  const sync = ySyncPluginKey.getState(view.state as never);
  cleanups.push(timeline.attach(pageId, doc, manager, { binding: sync.binding, editable: () => view.editable, dom: view.dom, snapshot: () => view.state.doc }));
  const binding = { doc, view, schema: view.state.schema, manager };
  const current = { binding };
  cleanups.push(registerRestoreTarget(pageId, (selected, _schema, ctx) => restoreInEditor(view, selected, undefined, ctx && { ...ctx, timeline, pageId }), () => current.binding));
  const lease = captureRestoreTarget(pageId)!;
  const runner = createUndoRunner({ timeline, currentPage: () => pageId, currentProject: () => d.tree.get(pageId)!.workspace_id, title: () => 'Restore B', blocked: () => null, go: () => undefined, notify: () => undefined });
  return { server, dbName, d, pageId, doc, rows, ed, view, manager, timeline, version, lease, current, runner };
}
function recovery(f: Awaited<ReturnType<typeof mounted>>): LineRecovery {
  const h = new PageHistory(f.rows), beforeH = Y.encodeStateAsUpdate(h.doc), beforeLive = Y.encodeStateAsUpdate(f.doc);
  try {
    const dto = observeLineRecovery(h.doc, f.rows, beforeLive, key)!;
    expect(Y.encodeStateAsUpdate(f.doc)).toEqual(beforeLive); expect(Y.encodeStateAsUpdate(h.doc)).toEqual(beforeH);
    return dto;
  } finally { h.destroy(); }
}
async function removedWithLate(f: Awaited<ReturnType<typeof mounted>>) {
  const offline = new Y.Doc(); Y.applyUpdate(offline, Y.encodeStateAsUpdate(f.doc)); cleanups.push(() => offline.destroy());
  shape(offline).set('posX', 47); shape(offline).set('startX', 12);
  const late = Y.encodeStateAsUpdate(offline, Y.encodeStateVector(f.doc));
  // Restore a una versión con mismo padre vacío produce D; no borrado del padre.
  const empty = new Y.Doc(); Y.applyUpdate(empty, Y.encodeStateAsUpdate(f.version)); cleanups.push(() => empty.destroy());
  empty.transact(() => LINE_FIELDS.forEach(field => shape(empty).delete(field)));
  const out = requestRestore(f.pageId, empty, null, { kind: 'restore', lease: f.lease, guard: () => f.lease.current() });
  expect(out.ok).toBe(true); expect(shape(f.doc).size).toBe(0);
  Y.applyUpdate(f.doc, late);
  return recovery(f);
}
it('Recover real: F, Item47, primera actualización, acción única, Undo/Redo, flush y recarga fresca', async () => {
  const f = await mounted(), dto = await removedWithLate(f);
  expect(recoveryPreview(dto).posX, 'C47_PREVIEW').toBe(47);
  expect(recoveryPreview(dto).startX).toBe(12);
  expect(dto.fill).not.toContain('posX'); expect(dto.fill).not.toContain('startX');
  const before = Y.encodeStateAsUpdate(f.doc), beforeXML = xml(f.doc), parent = shape(f.doc), parentId = lineProbe(f.doc, key), item47 = lineProbe(f.doc, key, 'posX');
  const stack = [...f.manager.undoStack], added: object[] = [], updates: Uint8Array[] = [], origins: unknown[] = [];
  const add = (e: { stackItem: object }) => added.push(e.stackItem);
  const update = (u: Uint8Array, origin: unknown) => { updates.push(u.slice()); origins.push(origin); };
  f.manager.on('stack-item-added', add); f.doc.on('update', update);
  let revision = 0; const edited = () => { revision++; }; f.doc.on('afterTransaction', edited);
  const outcome = requestRestore(f.pageId, f.version, null, { kind: 'recover-line', lease: f.lease, guard: () => revision === 0, recovery: dto });
  f.manager.off('stack-item-added', add); f.doc.off('update', update); f.doc.off('afterTransaction', edited);
  expect(outcome.ok).toBe(true); if (!outcome.ok) throw new Error(outcome.reason);
  expect(revision).toBeGreaterThan(0); expect(outcome.receipt?.doc).toBe(f.doc);
  expect(updates).toHaveLength(1); expect(added).toHaveLength(1); expect(outcome.receipt?.step).toBe(added[0]);
  expect(outcome.receipt?.origin).toBe(origins[0]); expect(outcome.receipt?.manager).toBe(f.manager);
  expect(f.manager.undoStack.slice(0, -1)).toEqual(stack);
  const replay = new Y.Doc(); cleanups.push(() => replay.destroy()); Y.applyUpdate(replay, before); Y.applyUpdate(replay, updates[0]);
  expect(shape(replay).get('posX'), 'ITEM47_FIRST_REPLAY').toBe(47); expect(shape(replay).get('startX')).toBe(12);
  expect(shape(f.doc)).toBe(parent); expect(lineProbe(f.doc, key)).toBe(parentId); expect(lineProbe(f.doc, key, 'posX')).toBe(item47);
  expect(lineProbe(replay, key, 'posX')).toBe(item47); expect(xml(f.doc)).toBe(beforeXML); expect(xml(replay)).toBe(beforeXML);
  expect(outcome.undo()).toBe(true); expect(shape(f.doc).toJSON()).toEqual({ posX: 47, startX: 12 });
  await f.runner.run('redo'); expect(shape(f.doc).size).toBe(9); expect(shape(f.doc).get('posX')).toBe(47);
  await f.runner.run('undo'); expect(shape(f.doc).toJSON()).toEqual({ posX: 47, startX: 12 });
  await f.runner.run('redo'); expect(lineProbe(f.doc, key, 'posX')).toBe(item47);
  await f.d.docs.flush(f.pageId); expect(f.d.docs.isSaved(f.pageId)).toBe(true);
  if (process.env.RESTORE_B_OUT) {
    writeFileSync(`${process.env.RESTORE_B_OUT}/first-update.bin`, updates[0]);
    writeFileSync(`${process.env.RESTORE_B_OUT}/before.bin`, before);
  }
  f.ed.unmount(); f.timeline.dispose(); f.d.docs.close(f.pageId); await f.d.docs.flush(f.pageId);
  f.d.docs.dispose(); f.d.engine.stop(); f.d.db.close(); f.d.mediaDb.close(); f.d.commentsDb.close();
  const fresh = await makeDevice(f.server, f.dbName, '0.999'); cleanups.push(() => { fresh.docs.dispose(); fresh.engine.stop(); fresh.db.close(); fresh.mediaDb.close(); fresh.commentsDb.close(); });
  const reloaded = await fresh.docs.open(f.pageId);
  expect(reloaded).not.toBe(f.doc); expect(shape(reloaded).get('posX')).toBe(47); expect(shape(reloaded).get('startX')).toBe(12);
  expect(lineProbe(reloaded, key, 'posX')).toBe(item47); expect(xml(reloaded)).toBe(beforeXML); expect(fresh.docs.isSaved(f.pageId)).toBe(true);
});
it('Restore XML y map-only usan el mismo editor y una acción; entrada vieja sin contexto mantiene comportamiento', async () => {
  const f = await mounted(); shape(f.doc).set('strokeColor', '#0000FF');
  const updates: Uint8Array[] = []; const capture = (u: Uint8Array) => updates.push(u.slice()); f.doc.on('update', capture);
  const outcome = requestRestore(f.pageId, f.version, null, { kind: 'restore', lease: f.lease, guard: () => true }); f.doc.off('update', capture);
  expect(outcome.ok).toBe(true); expect(updates).toHaveLength(1); expect(shape(f.doc).get('strokeColor')).toBe('#FF0000');
  f.ed.updateBlock('B-text', { content: 'Texto cambiado' }); shape(f.doc).set('strokeColor', '#0000FF');
  const stack = f.manager.undoStack.length;
  const both = requestRestore(f.pageId, f.version, null, { kind: 'restore', lease: f.lease, guard: () => true });
  expect(both.ok).toBe(true); expect(f.manager.undoStack.length).toBe(stack + 1); expect(shape(f.doc).get('strokeColor')).toBe('#FF0000');
  expect(xml(f.doc)).toBe(xml(f.version));
  if (both.ok) { expect(both.undo()).toBe(true); expect(xml(f.doc)).toContain('Texto cambiado'); }
  const old = BlockNoteSchema.create({ blockSpecs: { paragraph: defaultBlockSpecs.paragraph, image: defaultBlockSpecs.image } });
  const copy = new Y.Doc(); cleanups.push(() => copy.destroy()); Y.applyUpdate(copy, Y.encodeStateAsUpdate(f.doc));
  const ed = BlockNoteEditor.create(withCollaboration({ schema: old, collaboration: { fragment: copy.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'old', color: '#000' } } })) as unknown as BlockNoteEditor;
  const host = document.createElement('div'); document.body.append(host); ed.mount(host); cleanups.push(() => ed.unmount());
  expect(xml(copy)).toContain(`sdmedia://${file}`); expect(shape(copy).get('posX')).toBe(10);
});
it('guard stale, Doc/view/UM replacement y storage fail no repiten writer ni pierden pending', async () => {
  const f = await mounted(), dto = await removedWithLate(f), initial = Y.encodeStateAsUpdate(f.doc);
  const rejects = () => requestRestore(f.pageId, f.version, null, { kind: 'recover-line', lease: f.lease, guard: () => false, recovery: dto });
  expect(rejects().ok).toBe(false); expect(Y.encodeStateAsUpdate(f.doc)).toEqual(initial);
  const original = f.current.binding;
  for (const part of ['doc', 'view', 'manager'] as const) {
    f.current.binding = { ...original, [part]: {} } as typeof original;
    expect(requestRestore(f.pageId, f.version, null, { kind: 'recover-line', lease: f.lease, guard: () => true, recovery: dto }).ok).toBe(false);
    expect(Y.encodeStateAsUpdate(f.doc)).toEqual(initial);
  }
  f.current.binding = original;
  await f.d.docs.flush(f.pageId);
  const transaction = f.d.db.transaction.bind(f.d.db); let failures = 0;
  f.d.db.transaction = ((stores: string | string[], mode?: IDBTransactionMode) => {
    if (mode === 'readwrite' && [stores].flat().includes('docUpdates') && [stores].flat().includes('meta')) { failures++; throw new DOMException('Quota exceeded', 'QuotaExceededError'); }
    return transaction(stores as never, mode);
  }) as never;
  let writes = 0; f.doc.on('update', () => writes++);
  const out = requestRestore(f.pageId, f.version, null, { kind: 'recover-line', lease: f.lease, guard: () => true, recovery: dto }); expect(out.ok).toBe(true);
  await f.d.docs.flush(f.pageId); expect(f.d.docs.isSaved(f.pageId)).toBe(false); expect(f.d.docs.hasUnsavedEdits()).toBe(true);
  expect(writes).toBe(1); expect(failures).toBeGreaterThan(0); expect(shape(f.doc).get('posX')).toBe(47);
  f.d.db.transaction = transaction;
});
it('preflight cuenta bytes codificados agregados por foto y no cambia la fuente al rechazar', async () => {
  const f = await mounted();
  shape(f.doc).set('strokeColor', 'a'.repeat(50 * 1024));
  addShape(f.doc, file, 's2', { ...basal, strokeColor: 'b'.repeat(50 * 1024) } as never, { w: 4000, h: 3000 });
  const selected = new Y.Doc(); cleanups.push(() => selected.destroy()); Y.applyUpdate(selected, Y.encodeStateAsUpdate(f.doc));
  shape(selected).set('posX', 15);
  const before = Y.encodeStateAsUpdate(f.doc), stack = [...f.manager.undoStack]; let writes = 0;
  f.doc.on('update', () => writes++);
  const out = requestRestore(f.pageId, selected, null, { kind: 'restore', lease: f.lease, guard: () => true });
  expect(out.ok).toBe(false); expect(writes).toBe(0); expect(Y.encodeStateAsUpdate(f.doc)).toEqual(before); expect(f.manager.undoStack).toEqual(stack);
});
