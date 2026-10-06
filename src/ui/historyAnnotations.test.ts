import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addShape, deleteShape, updateShape, writeFrame, PHOTO_MARKUP_MAP, MAX_TEXT, type ShapeFields } from '../media/markup';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { PageHistory, type HistoryRow } from '../sync/history';
import { AnnotationAttempt, compareAnnotations } from './historyAnnotations';

const id = '00000000-0000-4000-8000-000000000001';
const documents: Y.Doc[] = [];
const doc = () => { const d = new Y.Doc({ gc: false }); documents.push(d); return d; };
afterEach(() => documents.splice(0).forEach((d) => d.destroy()));
function reference(d: Y.Doc, name = 'plate.jpg', url = `sdmedia://${id}`) {
  const el = new Y.XmlElement('image'); el.setAttribute('url', url); el.setAttribute('name', name);
  const fragment = d.getXmlFragment(CONTENT_FRAGMENT);
  if (!fragment.length) fragment.insert(0, [new Y.XmlElement('blockGroup')]);
  const block = new Y.XmlElement('blockContainer'); block.setAttribute('id', crypto.randomUUID()); block.insert(0, [el]);
  (fragment.get(0) as Y.XmlElement).insert(0, [block]);
}
function copy(d: Y.Doc) { const out = doc(); Y.applyUpdate(out, Y.encodeStateAsUpdate(d)); return out; }
const shapes: ShapeFields[] = [
  { type: 'rectangle', rectX: 1, rectY: 2, rectW: 30, rectH: 20 },
  { type: 'ellipse', rectX: 1, rectY: 2, rectW: 30, rectH: 20 },
  { type: 'arrow', startX: 0, startY: 0, endX: 40, endY: 20 },
  { type: 'line', startX: 0, startY: 0, endX: 40, endY: 20 },
  { type: 'freehand_pencil', points: [1, 2, 10, 20] },
  { type: 'freehand_marker', points: [1, 2, 10, 20] },
  { type: 'text', text: 'Lente 35 mm', fontSize: 12 },
  { type: 'numbered_marker', number: 3, fontSize: 12 },
];
function drawing(d: Y.Doc) {
  writeFrame(d, id, 1920, 1080);
  shapes.forEach((shape, i) => addShape(d, id, `s${i}`, shape));
}
describe('dibujos históricos de sólo lectura', () => {
  it('los ocho tipos viajan por snapshots reales; compara identidad y campos sin tocar documentos', () => {
    const live = doc(); reference(live); drawing(live);
    const first = Y.encodeStateAsUpdate(live), vector = Y.encodeStateVector(live);
    updateShape(live, id, 's0', { posX: 45, strokeColor: '#123456' });
    updateShape(live, id, 's6', { text: 'Lente 50 mm' });
    deleteShape(live, id, 's1'); addShape(live, id, 'new', shapes[2]);
    const row = (seq: number, data: Uint8Array): HistoryRow => ({ id: seq, seq, data, createdBy: seq === 1 ? 'ana' : 'bea', createdAt: new Date(seq * 3600_000).toISOString() });
    const history = new PageHistory([row(1, first), row(2, Y.encodeStateAsUpdate(live, vector))]);
    const before = history.version(0), selected = history.version(1); documents.push(before, selected);
    const a = Y.encodeStateAsUpdate(before), b = Y.encodeStateAsUpdate(selected), c = Y.encodeStateAsUpdate(live);
    const result = compareAnnotations(before, selected);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({ added: 1, removed: 1, changed: 2, counts: true, partial: false });
    expect(result.cards[0].before.photo?.shapes).toHaveLength(8);
    expect(result.cards[0].selected.photo?.shapes.find((s) => s.type === 'text')).toMatchObject({ text: 'Lente 50 mm' });
    expect(result.cards[0]).not.toHaveProperty('author');
    expect(Y.encodeStateAsUpdate(before)).toEqual(a); expect(Y.encodeStateAsUpdate(selected)).toEqual(b); expect(Y.encodeStateAsUpdate(live)).toEqual(c);
    history.destroy();
  });
  it('primera sesión contra vacío, sin tolerancia geométrica, y frame sin formas', () => {
    const a = doc(), b = doc(); reference(b); drawing(b);
    expect(compareAnnotations(a, b).cards[0]).toMatchObject({ added: 8, counts: true });
    const c = copy(b); updateShape(c, id, 's0', { posX: 0.000001 });
    expect(compareAnnotations(b, c).cards[0].changed).toBe(1);
    const frame = doc(); reference(frame); writeFrame(frame, id, 100, 50);
    expect(compareAnnotations(a, frame).cards[0]).toMatchObject({ frameChanged: true, added: 0 });
    expect(compareAnnotations(b, copy(b)).cards).toEqual([]);
  });
  it('deduplica apariciones, conserva nombres ambiguos y no dibuja un mapa huérfano', () => {
    const a = doc(); reference(a); reference(a); drawing(a);
    const b = copy(a); reference(b, 'otro.jpg'); updateShape(b, id, 's0', { rotation: 10 });
    const result = compareAnnotations(a, b);
    expect(result.cards).toHaveLength(1); expect(result.cards[0].before.name).toBe('plate.jpg'); expect(result.cards[0].selected.name).toBeNull();
    const gone = copy(b); (gone.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement).delete(0, 3);
    expect(compareAnnotations(a, gone).cards[0]).toMatchObject({ selected: { referenced: false, photo: null }, counts: false });
    const external = doc(); reference(external, 'plate.jpg', `https://example.invalid/${id}`); drawing(external);
    expect(compareAnnotations(doc(), external).cards).toEqual([]);
    expect(compareAnnotations(gone, copy(gone)).cards).toEqual([]);
  });
  it.each(['future', 'badFrame', 'unknownShape', 'unknownField', 'textLimit', 'pointsLimit', 'drawnTextLimit', 'shapeLimit', 'unknownKey'])('el caso %s declara parcial sin cuentas inventadas', (kind) => {
    const a = doc(); reference(a); drawing(a); const b = copy(a), map = b.getMap(PHOTO_MARKUP_MAP);
    if (kind === 'future') map.set(id, { v: 2, w: 1920, h: 1080 });
    if (kind === 'badFrame') map.set(id, { v: 1, w: NaN, h: 1080 });
    if (kind === 'unknownShape') updateShape(b, id, 's0', { type: 'future-shape' });
    if (kind === 'unknownField') updateShape(b, id, 's0', { futureColor: '#ffffff' });
    if (kind === 'textLimit') updateShape(b, id, 's6', { text: 'x'.repeat(MAX_TEXT + 1) });
    if (kind === 'pointsLimit') updateShape(b, id, 's4', { points: Array.from({ length: 10002 }, () => 5) });
    if (kind === 'drawnTextLimit') for (let i = 0; i < 11; i++) addShape(b, id, `text-${i}`, { type: 'text', text: 'x'.repeat(2000) });
    if (kind === 'shapeLimit') for (let i = 0; i < 2001; i++) addShape(b, id, `new-${i}`, shapes[0]);
    if (kind === 'unknownKey') map.set('bad/file/key', {});
    const result = compareAnnotations(a, b);
    if (kind === 'unknownKey') expect(result.partial).toBe(true);
    else expect(result.cards[0]).toMatchObject({ partial: true, counts: false });
    expect(map.size).toBeGreaterThan(0);
  });
  it('borrar, deshacer y rehacer vuelve a los mismos dibujos, sin restaurar mapas', () => {
    const a = doc(); reference(a); drawing(a); const b = copy(a);
    const undo = new Y.UndoManager(b.getMap(PHOTO_MARKUP_MAP), { trackedOrigins: new Set([`sd-markup:${id}`]) });
    deleteShape(b, id, 's0'); expect(compareAnnotations(a, b).cards[0].removed).toBe(1);
    undo.undo(); expect(compareAnnotations(a, b).cards).toEqual([]);
    undo.redo(); expect(compareAnnotations(a, b).cards[0].removed).toBe(1); undo.destroy();
  });
  it('invalida síncronamente el par previo; volver a la misma sesión exige otro intento', () => {
    const attempt = new AnnotationAttempt(), old = attempt.start();
    attempt.invalidate(); expect(attempt.current(old)).toBe(false);
    const fresh = attempt.start(); expect(attempt.current(fresh)).toBe(true); expect(attempt.current(old)).toBe(false);
  });
});
