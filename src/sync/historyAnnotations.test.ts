import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { PageHistory, type HistoryRow } from './history';
import { CONTENT_FRAGMENT } from './structure';
import { PHOTO_MARKUP_MAP } from '../media/markup';

const file = '00000000-0000-4000-8000-000000000001';
const key = `${file}/shape-1`;
const row = (data: Uint8Array, seq: number, who = 'a', minute = seq * 60): HistoryRow => ({
  id: seq, seq, createdBy: who, createdAt: new Date(Date.UTC(2026, 9, 4, 0, minute)).toISOString(), data,
});
function capture(doc: Y.Doc, fn: () => void): Uint8Array {
  const before = Y.encodeStateVector(doc);
  doc.transact(fn);
  return Y.encodeStateAsUpdate(doc, before);
}
function photo(name = 'plate.jpg', node = 'image'): Y.XmlElement {
  const p = new Y.XmlElement(node);
  p.setAttribute('url', `sdmedia://${file}`);
  p.setAttribute('name', name);
  return p;
}
function initial(node = 'image') {
  const doc = new Y.Doc({ gc: false });
  const p = photo('plate.jpg', node);
  const seed = capture(doc, () => doc.getXmlFragment(CONTENT_FRAGMENT).insert(0, [p]));
  return { doc, p, seed };
}
function twoSessions(history: PageHistory) {
  expect(history.sessions).toHaveLength(2);
  expect(history.sessions[1]).toMatchObject({ authors: ['b', 'c', 'a'], annotation: { name: 'plate.jpg' } });
}

describe('sesiones de anotaciones', () => {
  it('mismos bytes con inserción y primer borrado pendientes: load y dos append conservan autores, cortes y dueños', () => {
    const { doc, seed } = initial();
    const shape = new Y.Map<unknown>();
    const base = capture(doc, () => doc.getMap(PHOTO_MARKUP_MAP).set(key, shape));
    const b = new Y.Doc({ gc: false });
    Y.applyUpdate(b, Y.encodeStateAsUpdate(doc));
    const changed = capture(b, () => (b.getMap(PHOTO_MARKUP_MAP).get(key) as Y.Map<unknown>).set('text', 'nota'));
    const c = new Y.Doc({ gc: false });
    Y.applyUpdate(c, Y.encodeStateAsUpdate(b));
    const deleted = capture(c, () => (c.getMap(PHOTO_MARKUP_MAP).get(key) as Y.Map<unknown>).delete('text'));
    const rows = [row(seed, 1, 'seed', 0), row(changed, 2, 'b', 60), row(deleted, 3, 'c', 61), row(base, 4, 'a', 62)];
    const full = new PageHistory(rows);
    const incremental = new PageHistory(rows.slice(0, 2));
    incremental.append(rows.slice(2, 3));
    incremental.append(rows.slice(3));
    twoSessions(full);
    twoSessions(incremental);
    expect(incremental.sessions).toEqual(full.sessions);
    expect(incremental.fresh).toEqual(full.fresh);
    const text = (b.getMap(PHOTO_MARKUP_MAP).get(key) as Y.Map<unknown>)._map.get('text')!;
    expect(incremental.insertRow(text.id.client, text.id.clock)).toBe(1);
    expect(incremental.deleteRow(text.id.client, text.id.clock)).toBe(2);
    for (const h of [full, incremental]) h.setBreaks([2], [4]);
    expect(incremental.sessions).toEqual(full.sessions);
    const stable = structuredClone(incremental.sessions);
    expect(incremental.append(rows)).toBe(0);
    expect(incremental.sessions).toEqual(stable);
    for (const h of [full, incremental]) h.destroy();
    for (const d of [doc, b, c]) d.destroy();
  });

  it.each(['image', 'inlinePhoto', 'tableCell'])('rótulo del snapshot %s aunque después cambie o se borre la referencia', (node) => {
    const { doc, p, seed } = initial(node);
    const annotation = capture(doc, () => doc.getMap(PHOTO_MARKUP_MAP).set(file, { v: 999 }));
    const renamed = capture(doc, () => p.setAttribute('name', 'later.jpg'));
    const removed = capture(doc, () => doc.getXmlFragment(CONTENT_FRAGMENT).delete(0, 1));
    const h = new PageHistory([row(seed, 1), row(annotation, 2), row(renamed, 3), row(removed, 4)]);
    expect(h.sessions[1].annotation).toEqual({ name: 'plate.jpg' });
    expect(h.sessions[2].annotation).toBeUndefined();
    h.destroy(); doc.destroy();
  });

  it('claves futuras cuentan; UUID ausente, múltiples o nombres ambiguos quedan genéricos, sin buscar fuera de la página', () => {
    const { doc, seed } = initial();
    const future = capture(doc, () => doc.getMap(PHOTO_MARKUP_MAP).set('future-key', { future: true }));
    const missing = capture(doc, () => doc.getMap(PHOTO_MARKUP_MAP).set('00000000-0000-4000-8000-000000000002', {}));
    const own = capture(doc, () => doc.getMap(PHOTO_MARKUP_MAP).set(file, {}));
    const ambiguous = capture(doc, () => doc.getXmlFragment(CONTENT_FRAGMENT).insert(1, [photo('other.jpg')]));
    const changed = capture(doc, () => doc.getMap(PHOTO_MARKUP_MAP).set(file, { v: 2 }));
    const h = new PageHistory([row(seed, 1), row(future, 2), row(missing, 3), row(own, 4), row(ambiguous, 5), row(changed, 6)]);
    expect(h.sessions[1].annotation).toEqual({ name: null });
    expect(h.sessions[2].annotation).toEqual({ name: null });
    expect(h.sessions[3].annotation).toEqual({ name: 'plate.jpg' });
    expect(h.sessions[5].annotation).toEqual({ name: null });
    h.destroy(); doc.destroy();
  });

  it('texto y anotación juntos no llevan rótulo automático; colapsar y una subida duplicada no agregan autor', () => {
    const { doc, p, seed } = initial();
    const mixed = capture(doc, () => p.setAttribute('name', 'mixed.jpg'));
    const annotation = capture(doc, () => doc.getMap(PHOTO_MARKUP_MAP).set(file, {}));
    const collapse = capture(doc, () => doc.getMap('collapsedHeadings').set('x', true));
    const h = new PageHistory([row(seed, 1, 'seed', 0), row(mixed, 2, 'writer', 60), row(annotation, 3, 'annotator', 61), row(collapse, 4, 'view', 62), row(mixed, 5, 'duplicate', 63)]);
    expect(h.sessions).toHaveLength(2);
    expect(h.sessions[1].annotation).toBeUndefined();
    expect(h.sessions[1].authors).toEqual(['writer', 'annotator']);
    h.destroy(); doc.destroy();
  });

  it('deshacer anotación y tombstone conservan autor aunque no quede ninguna forma visible', () => {
    const { doc, seed } = initial();
    const map = doc.getMap(PHOTO_MARKUP_MAP);
    const undo = new Y.UndoManager(map);
    const inserted = capture(doc, () => map.set(file, { v: 1 }));
    const undone = capture(doc, () => undo.undo());
    const h = new PageHistory([row(seed, 1), row(inserted, 2, 'b'), row(undone, 3, 'c')]);
    expect(h.sessions[2]).toMatchObject({ authors: ['c'], annotation: { name: 'plate.jpg' } });
    const version = h.version(2);
    expect(version.getMap(PHOTO_MARKUP_MAP).size).toBe(0);
    version.destroy();
    h.destroy(); undo.destroy(); doc.destroy();
  });

  it('varios sujetos, referencia ausente y URL externa no inventan el nombre; redo cuenta como edición', () => {
    const { doc, seed } = initial();
    const many = capture(doc, () => { const map = doc.getMap(PHOTO_MARKUP_MAP); map.set(file, {}); map.set('00000000-0000-4000-8000-000000000002', {}); });
    const gone = capture(doc, () => doc.getXmlFragment(CONTENT_FRAGMENT).delete(0, 1));
    const absent = capture(doc, () => doc.getMap(PHOTO_MARKUP_MAP).set(file, { v: 2 }));
    const external = photo('external.jpg');
    external.setAttribute('url', `https://example.invalid/${file}`);
    const reference = capture(doc, () => doc.getXmlFragment(CONTENT_FRAGMENT).insert(0, [external]));
    const map = doc.getMap(PHOTO_MARKUP_MAP), undo = new Y.UndoManager(map);
    const inserted = capture(doc, () => map.set(file, { v: 3 }));
    // UndoManager necesita terminar su propia transacción antes de redo (sin envolverlo en otra).
    let before = Y.encodeStateVector(doc);
    undo.undo();
    const undone = Y.encodeStateAsUpdate(doc, before);
    before = Y.encodeStateVector(doc);
    undo.redo();
    const redone = Y.encodeStateAsUpdate(doc, before);
    const h = new PageHistory([seed, many, gone, absent, reference, inserted, undone, redone].map((data, i) => row(data, i + 1)));
    for (const i of [1, 3, 5, 6, 7]) expect(h.sessions[i].annotation).toEqual({ name: null });
    expect(h.sessions[7].authors).toEqual(['a']);
    h.destroy(); undo.destroy(); doc.destroy();
  });

  it('coste representativo: 1000 filas y append de 100 conservan el resumen completo', () => {
    const { doc, seed } = initial();
    const rows = [row(seed, 1, 'seed', 0)];
    for (let i = 2; i <= 1100; i++) rows.push(row(capture(doc, () => doc.getMap(PHOTO_MARKUP_MAP).set(file, { v: 1, w: i, h: 240 })), i, 'b', 60 + i + Math.floor(i / 100) * 60));
    const before = performance.now();
    const full = new PageHistory(rows);
    const fullMs = performance.now() - before;
    const partial = new PageHistory(rows.slice(0, 1000));
    const start = performance.now();
    partial.append(rows.slice(1000));
    const appendMs = performance.now() - start;
    expect(partial.sessions).toEqual(full.sessions);
    console.log(JSON.stringify({ corpus: '1100 filas, append100, una foto', fullMs, appendMs, sessions: full.sessions.length }));
    full.destroy(); partial.destroy(); doc.destroy();
  });
});
