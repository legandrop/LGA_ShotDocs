// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { TextSelection } from '@tiptap/pm/state';
import { Fragment } from '@tiptap/pm/model';
import { appendFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { ySyncPluginKey } from 'y-prosemirror';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { blockReorderExtension, installBlockReorder, type BlockReorderStats } from './blockReorder';
import { applyLikeApp, editors, posOf, sameDocs, showsDoc, undoManager, unmountAll, view } from './collabHarness';
import { schema } from './editorSchema';
import { asOneUndoStep } from './undoGuard';

afterEach(unmountAll);

vi.mock('y-prosemirror', async (importOriginal) => {
  const actual = await importOriginal<typeof import('y-prosemirror')>();
  return { ...actual, updateYFragment: vi.fn(actual.updateYFragment) };
});

function mounted(extension = false, doc = new Y.Doc()) {
  const editor = BlockNoteEditor.create(withCollaboration({ schema,
    collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
    extensions: extension ? [blockReorderExtension] : [],
  })) as unknown as BlockNoteEditor;
  const host = document.createElement('div');
  document.body.appendChild(host);
  editor.mount(host); editors.push(editor);
  return { doc, editor };
}

function drag(editor: BlockNoteEditor, id: string, beforeId: string) {
  const v = view(editor), from = posOf(editor, id), target = posOf(editor, beforeId);
  const node = v.state.doc.nodeAt(from)!;
  const tr = v.state.tr.delete(from, from + node.nodeSize);
  tr.insert(tr.mapping.map(target), node);
  v.dispatch(tr);
}

it('5000 bloques: veinte letras no leen el árbol Yjs ni agregan más de 1 ms por letra', () => {
  const { doc, editor } = mounted();
  editor.replaceBlocks(editor.document, Array.from({ length: 5000 }, (_, i) => ({ id: `p${i}`, type: 'paragraph', content: `linea ${i}` })) as never);
  const stats: BlockReorderStats = { calls: 0, triggered: 0, ms: 0, yVisits: 0, pmVisits: 0 };
  installBlockReorder(view(editor), stats);
  const v = view(editor), p = posOf(editor, 'p2500');
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, p + 3)));
  stats.calls = stats.ms = stats.yVisits = stats.pmVisits = 0;
  for (let i = 0; i < 20; i++) {
    const visits = stats.yVisits;
    const pmVisits = stats.pmVisits ?? 0;
    v.dispatch(v.state.tr.insertText('x'));
    expect(stats.yVisits - visits).toBeLessThanOrEqual(10);
    expect((stats.pmVisits ?? 0) - pmVisits).toBeLessThanOrEqual(10);
  }
  console.info(`guarda 5000 bloques: ${stats.ms.toFixed(3)} ms/20 letras, ${(stats.ms / 20).toFixed(3)} ms/letra, ${stats.yVisits} visitas Yjs`);
  if (process.env.BLOCK_REORDER_LOG) appendFileSync(process.env.BLOCK_REORDER_LOG, JSON.stringify({ blocks: 5000, letters: 20, ...stats, meanMs: stats.ms / 20 }) + '\n');
  expect(stats.calls).toBe(20);
  expect(stats.ms / 20).toBeLessThanOrEqual(1);
  expect(stats.triggered).toBe(0);
  expect(showsDoc(editor, doc)).toBe(true);
}, 120000);

it('la extensión escribe las dos pasadas en una sola actualización y deshace solo el mover', () => {
  const { doc, editor } = mounted(true);
  editor.replaceBlocks(editor.document, ['a', 'b', 'c'].map((id) => ({ id, type: 'paragraph', content: id })) as never);
  const v = view(editor);
  v.dispatch(v.state.tr.insertText('ZZZ', posOf(editor, 'c') + 2));
  const before = v.state.doc;
  let updates = 0;
  doc.on('update', () => updates++);
  drag(editor, 'c', 'a');
  expect(updates).toBe(1);
  const after = v.state.doc;
  expect(showsDoc(editor, doc)).toBe(true);
  editor.undo();
  expect(v.state.doc.eq(before)).toBe(true);
  expect(v.state.doc.textContent).toContain('ZZZ');
  editor.redo();
  expect(v.state.doc.eq(after)).toBe(true);
  expect(showsDoc(editor, doc)).toBe(true);
  v.dispatch(v.state.tr.insertText('YYY', posOf(editor, 'a') + 2));
  editor.undo();
  expect(v.state.doc.eq(after)).toBe(true);
});

it.each([1, 2])('empate %s sobre el mismo peso conserva todos los nodos cambiados por el teclado', (count) => {
  const { doc, editor } = mounted(true);
  editor.replaceBlocks(editor.document, ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, type: 'paragraph', content: id })) as never);
  const root = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
  const oldY = root.toArray();
  const v = view(editor), group = v.state.doc.firstChild!;
  const mapping = (ySyncPluginKey.getState(v.state as never) as { binding: { mapping: Map<unknown, unknown> } }).binding.mapping;
  expect(mapping.get(root)).toBe(group);
  const children = Array.from({ length: group.childCount }, (_, i) => group.child(i));
  const moved = children.slice(count, count * 2).map((node) => node.type.create(node.attrs, node.content, node.marks));
  const next = group.copy(Fragment.from([...moved, ...children.slice(0, count), ...children.slice(count * 2)]));
  v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, next));
  for (let i = 0; i < count; i++) expect(root.get(i)).toBe(oldY[count + i]);
  for (let i = 0; i < count; i++) expect(root.get(count + i)).not.toBe(oldY[i]);
  expect(showsDoc(editor, doc)).toBe(true);
});

it('el peso conserva un bloque con tres hijos al saltar un párrafo', () => {
  const { doc, editor } = mounted(true);
  editor.replaceBlocks(editor.document, [
    { id: 'a', type: 'paragraph', content: 'a' },
    { id: 'b', type: 'paragraph', content: 'b', children: ['x', 'y', 'z'].map((id) => ({ id, type: 'paragraph', content: id })) },
  ] as never);
  const root = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement, old = root.get(1);
  drag(editor, 'b', 'a');
  expect(root.get(0)).toBe(old);
  expect(showsDoc(editor, doc)).toBe(true);
});

it('el teclado real conserva el contenedor del bloque movido en un empate', () => {
  const { doc, editor } = mounted(true);
  editor.replaceBlocks(editor.document, ['a', 'b', 'c'].map((id) => ({ id, type: 'paragraph', content: id })) as never);
  const root = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement, old = root.get(1);
  const v = view(editor);
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, posOf(editor, 'b') + 2)));
  v.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  expect(editor.document.map((block) => block.id)).toEqual(['b', 'a', 'c']);
  expect(root.get(0)).toBe(old);
  expect(showsDoc(editor, doc)).toBe(true);
});

it('deshacer y rehacer un mover con hijos no toca lo escrito justo antes en el hijo', () => {
  const { doc, editor } = mounted(true);
  editor.replaceBlocks(editor.document, [
    { id: 'a', type: 'paragraph', content: 'a' },
    { id: 'b', type: 'paragraph', content: 'b', children: [{ id: 'kid', type: 'paragraph', content: 'hijo' }] },
  ] as never);
  const v = view(editor);
  v.dispatch(v.state.tr.insertText('ZZZ', posOf(editor, 'kid') + 2));
  const before = v.state.doc;
  drag(editor, 'b', 'a');
  const after = v.state.doc;
  editor.undo();
  expect(v.state.doc.eq(before)).toBe(true);
  expect(showsDoc(editor, doc)).toBe(true);
  editor.redo();
  expect(v.state.doc.eq(after)).toBe(true);
  expect(showsDoc(editor, doc)).toBe(true);
});

it('desmontar la extensión libera la guarda y volver a montar envuelve una sola vez', () => {
  const { editor } = mounted(true), v = view(editor);
  const binding = (ySyncPluginKey.getState(v.state as never) as { binding: { _prosemirrorChanged: unknown } }).binding;
  const wrapped = binding._prosemirrorChanged;
  editor.unmount();
  expect(binding._prosemirrorChanged).not.toBe(wrapped);
  const host = document.createElement('div');
  document.body.appendChild(host); editor.mount(host);
  const current = (ySyncPluginKey.getState(view(editor).state as never) as { binding: { _prosemirrorChanged: unknown } }).binding;
  const remounted = current._prosemirrorChanged;
  const release = installBlockReorder(view(editor));
  expect(current._prosemirrorChanged).toBe(remounted);
  release();
  expect(current._prosemirrorChanged).toBe(remounted);
});

it('un fallo tras el borrado restaura antes y completa el cambio en la misma actualización', () => {
  const { doc, editor } = mounted(true);
  editor.replaceBlocks(editor.document, ['a', 'b', 'c'].map((id) => ({ id, type: 'paragraph', content: id })) as never);
  const root = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
  const real = root.delete.bind(root);
  let injected = false;
  const error = vi.spyOn(console, 'error');
  vi.spyOn(root, 'delete').mockImplementationOnce((...args) => {
    real(...args);
    injected = true;
    throw new Error('fallo de prueba después del borrado');
  });
  let updates = 0;
  doc.on('update', () => updates++);
  drag(editor, 'c', 'a');
  expect(injected).toBe(true);
  expect(error).toHaveBeenCalledWith('reordenar bloques: las dos pasadas fallaron; se restaura antes de escribir el cambio', expect.any(Error));
  expect(updates).toBe(1);
  expect(editor.document.map((block) => block.id)).toEqual(['c', 'a', 'b']);
  expect(showsDoc(editor, doc)).toBe(true);
  error.mockRestore();
});

it('instalar y liberar dos veces conserva una sola envoltura y restaura el método original', () => {
  const { editor } = mounted();
  const binding = (ySyncPluginKey.getState(view(editor).state as never) as { binding: { _prosemirrorChanged: unknown } }).binding;
  const original = binding._prosemirrorChanged;
  const releaseA = installBlockReorder(view(editor));
  const wrapped = binding._prosemirrorChanged;
  const releaseB = installBlockReorder(view(editor));
  expect(binding._prosemirrorChanged).toBe(wrapped);
  releaseA(); releaseA();
  expect(binding._prosemirrorChanged).toBe(wrapped);
  releaseB(); releaseB();
  expect(binding._prosemirrorChanged).toBe(original);
});

it.each(['a', 'b', 'c', 'd'])('dos intercambios en una transacción preservan los vecinos al borrar %s', (victim) => {
  const { doc: a, editor: ae } = mounted(true);
  ae.replaceBlocks(ae.document, ['a', 'b', 'c', 'd'].map((id) => ({ id, type: 'paragraph', content: `word-${id}` })) as never);
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(a));
  const { doc: b, editor: be } = mounted(true, copy);
  const rootB = b.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
  const oldY = rootB.toArray();
  const svA = Y.encodeStateVector(a), svB = Y.encodeStateVector(b);
  const bv = view(be), group = bv.state.doc.firstChild!;
  const after = group.copy(Fragment.from([group.child(1), group.child(0), group.child(3), group.child(2)]));
  bv.dispatch(bv.state.tr.replaceWith(0, bv.state.doc.content.size, after));
  // El óptimo conserva a y c, en sus mismos contenedores Yjs, aunque los borrados b y d no sean contiguos.
  expect(rootB.get(1)).toBe(oldY[0]);
  expect(rootB.get(3)).toBe(oldY[2]);
  const rootA = a.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
  rootA.delete(['a', 'b', 'c', 'd'].indexOf(victim), 1);
  const fromA = Y.encodeStateAsUpdate(a, svA), fromB = Y.encodeStateAsUpdate(b, svB);
  applyLikeApp(a, fromB); applyLikeApp(b, fromA);
  for (const id of ['a', 'b', 'c', 'd'].filter((id) => id !== victim)) {
    expect(ae.document.some((block) => block.id === id)).toBe(true);
    expect(be.document.some((block) => block.id === id)).toBe(true);
  }
  expect(sameDocs(a, b)).toBe(true);
  expect(showsDoc(ae, a) && showsDoc(be, b)).toBe(true);
});

it('reordenar, agregar, borrar y editar a la vez preserva la identidad de la subsecuencia conservada', () => {
  const { doc, editor } = mounted(true);
  editor.replaceBlocks(editor.document, ['a', 'b', 'c', 'd'].map((id) => ({ id, type: 'paragraph', content: `word-${id}` })) as never);
  const root = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement, oldY = root.toArray();
  const v = view(editor), before = v.state.doc, group = before.firstChild!;
  const copy = (i: number) => { const node = group.child(i); return node.type.create(node.attrs, node.content, node.marks); };
  const edited = group.child(1).type.create(group.child(1).attrs,
    group.child(1).firstChild!.type.create(group.child(1).firstChild!.attrs, v.state.schema.text('word-b EDIT')));
  const added = group.child(0).type.create({ ...group.child(0).attrs, id: 'newx' },
    group.child(0).firstChild!.type.create(group.child(0).firstChild!.attrs, v.state.schema.text('added')));
  const next = group.copy(Fragment.from([edited, copy(0), added, copy(2)]));
  let updates = 0; doc.on('update', () => updates++);
  v.dispatch(v.state.tr.replaceWith(0, before.content.size, next));
  expect(updates).toBe(1);
  expect(root.get(1)).toBe(oldY[0]);
  expect(root.get(3)).toBe(oldY[2]);
  expect(editor.document.map((block) => block.id)).toEqual(['b', 'a', 'newx', 'c']);
  expect(v.state.doc.textContent).toBe('word-b EDITword-aaddedword-c');
  const after = v.state.doc;
  expect(showsDoc(editor, doc)).toBe(true);
  editor.undo(); expect(v.state.doc.eq(before)).toBe(true);
  editor.redo(); expect(v.state.doc.eq(after)).toBe(true);
  expect(showsDoc(editor, doc)).toBe(true);
});

it('intercambios dispersos en hijos conservan el padre y la rama exterior', () => {
  const { doc, editor } = mounted(true);
  editor.replaceBlocks(editor.document, [
    { id: 'outside', type: 'paragraph', content: 'outside' },
    { id: 'parent', type: 'paragraph', content: 'parent', children: ['a', 'b', 'c', 'd'].map((id) => ({ id, type: 'paragraph', content: id })) },
  ] as never);
  const root = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
  const outside = root.get(0), parentY = root.get(1) as Y.XmlElement;
  const childrenY = parentY.get(1) as Y.XmlElement, oldY = childrenY.toArray();
  const v = view(editor), outer = v.state.doc.firstChild!, parent = outer.child(1), children = parent.lastChild!;
  const nextChildren = children.copy(Fragment.from([children.child(1), children.child(0), children.child(3), children.child(2)]));
  const nextParent = parent.copy(Fragment.from([parent.firstChild!, nextChildren]));
  v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, outer.copy(Fragment.from([outer.child(0), nextParent]))));
  expect(root.get(0)).toBe(outside); expect(root.get(1)).toBe(parentY);
  expect(childrenY.get(1)).toBe(oldY[0]); expect(childrenY.get(3)).toBe(oldY[2]);
  expect(editor.document[1].children.map((block) => block.id)).toEqual(['b', 'a', 'd', 'c']);
  expect(showsDoc(editor, doc)).toBe(true);
});

it('los hijos de un bloque recién recreado vuelven a reordenarse con sus identidades vinculadas', () => {
  const { doc, editor } = mounted(true);
  editor.replaceBlocks(editor.document, [
    ...Array.from({ length: 6 }, (_, i) => ({ id: `skip${i}`, type: 'paragraph', content: `skip${i}` })),
    { id: 'parent', type: 'paragraph', content: 'parent', children: ['a', 'b', 'c', 'd'].map((id) => ({ id, type: 'paragraph', content: id })) },
  ] as never);
  drag(editor, 'parent', 'skip0');
  const root = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement, parentY = root.get(0) as Y.XmlElement;
  const childrenY = parentY.get(1) as Y.XmlElement, oldY = childrenY.toArray();
  const v = view(editor), outer = v.state.doc.firstChild!, parent = outer.child(0), children = parent.lastChild!;
  const nextChildren = children.copy(Fragment.from([children.child(1), children.child(0), children.child(3), children.child(2)]));
  const nextParent = parent.copy(Fragment.from([parent.firstChild!, nextChildren]));
  const nodes = Array.from({ length: outer.childCount }, (_, i) => i === 0 ? nextParent : outer.child(i));
  v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, outer.copy(Fragment.from(nodes))));
  expect(root.get(0)).toBe(parentY);
  expect(childrenY.get(1)).toBe(oldY[0]); expect(childrenY.get(3)).toBe(oldY[2]);
  expect(showsDoc(editor, doc)).toBe(true);
});

it('una excepción tras la traducción final realmente restaura y completa en una sola actualización', () => {
  const { doc, editor } = mounted();
  editor.replaceBlocks(editor.document, ['a', 'b', 'c', 'd'].map((id) => ({ id, type: 'paragraph', content: id })) as never);
  const v = view(editor);
  const binding = (ySyncPluginKey.getState(v.state as never) as { binding: { _prosemirrorChanged: (doc: typeof v.state.doc) => void } }).binding;
  const original = binding._prosemirrorChanged;
  let injected = false, calls = 0;
  const error = vi.spyOn(console, 'error');
  binding._prosemirrorChanged = function (final) {
    calls++; original.call(binding, final);
    if (!injected) { injected = true; throw new Error('fallo después de escribir el final'); }
  };
  const release = installBlockReorder(v);
  let updates = 0; doc.on('update', () => updates++);
  const group = v.state.doc.firstChild!;
  v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size,
    group.copy(Fragment.from([group.child(1), group.child(0), group.child(3), group.child(2)]))));
  expect(injected).toBe(true); expect(calls).toBe(2);
  expect(error).toHaveBeenCalledWith('reordenar bloques: las dos pasadas fallaron; se restaura antes de escribir el cambio', expect.any(Error));
  expect(updates).toBe(1); expect(editor.document.map((block) => block.id)).toEqual(['b', 'a', 'd', 'c']);
  expect(showsDoc(editor, doc)).toBe(true);
  release(); error.mockRestore();
});

it('un mapeo con el mismo contenido y otra referencia PM conserva las identidades Yjs', () => {
  const { doc, editor } = mounted(true);
  editor.replaceBlocks(editor.document, ['a', 'b', 'c'].map((id) => ({ id, type: 'paragraph', content: id })) as never);
  const v = view(editor), root = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement, oldY = root.toArray();
  const binding = (ySyncPluginKey.getState(v.state as never) as { binding: { mapping: Map<unknown, unknown> } }).binding;
  const old = v.state.doc.firstChild!.child(0), equivalent = old.type.create(old.attrs, old.content, old.marks);
  expect(equivalent).not.toBe(old); expect(equivalent.eq(old)).toBe(true);
  binding.mapping.set(oldY[0], equivalent);
  drag(editor, 'c', 'a');
  expect(root.get(1)).toBe(oldY[0]); expect(root.get(2)).toBe(oldY[1]);
  expect(showsDoc(editor, doc)).toBe(true);
});

it.each(['asOneUndoStep', 'compose'])('dos movimientos internos respetan la agrupación explícita de %s', (way) => {
  const { doc, editor } = mounted(true);
  editor.replaceBlocks(editor.document, ['a', 'b', 'c', 'd'].map((id) => ({ id, type: 'paragraph', content: id })) as never);
  const v = view(editor), um = undoManager(editor), before = v.state.doc;
  um.stopCapturing();
  const count = um.undoStack.length;
  const moves = () => { drag(editor, 'b', 'a'); drag(editor, 'd', 'c'); };
  if (way === 'asOneUndoStep') asOneUndoStep(v.state, moves);
  else {
    // El mismo contrato por editor que usa undoTimeline.compose, sin cambiar la pila ni el historial.
    const timeout = um.captureTimeout;
    um.captureTimeout = Number.MAX_SAFE_INTEGER;
    try { moves(); } finally { um.captureTimeout = timeout; um.stopCapturing(); }
  }
  expect(um.undoStack.length - count).toBe(1);
  expect(showsDoc(editor, doc)).toBe(true);
  editor.undo(); expect(v.state.doc.eq(before)).toBe(true);
  expect(showsDoc(editor, doc)).toBe(true);
});
