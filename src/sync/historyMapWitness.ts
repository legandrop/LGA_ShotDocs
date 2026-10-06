import * as Y from 'yjs';
import { PHOTO_MARKUP_MAP, parseMarkupKey } from '../media/markup';
import { mediaIdsInDoc } from '../media/usage';
import { CONTENT_FRAGMENT } from './structure';
import type { HistoryRow } from './history';

export const LINE_FIELDS = ['type', 'zValue', 'posX', 'posY', 'startX', 'startY', 'endX', 'endY', 'strokeColor'] as const;
export type LineValues = Record<string, string | number>;
export interface LineRecovery {
  key: string;
  parent: string;
  removedAt: number;
  baseline: LineValues;
  live: LineValues;
  fill: string[];
  items: Record<string, string>;
  snapshot: Uint8Array;
  frame: unknown;
}
const fail = (): never => { throw new Error('UNOBSERVABLE'); };
const id = (v: Y.ID | null) => v ? `${v.client}:${v.clock}` : null;
const shape = (doc: Y.Doc, key: string) => {
  const value = doc.getMap(PHOTO_MARKUP_MAP).get(key);
  return value instanceof Y.Map ? value : fail();
};
export function rawLine(map: Y.Map<unknown>, complete = false): LineValues {
  const out: LineValues = {};
  for (const [key, value] of map) {
    if (!LINE_FIELDS.some(f => f === key)) fail();
    if (key === 'type' ? value !== 'line' : key === 'strokeColor' ? typeof value !== 'string' : typeof value !== 'number' || !Number.isFinite(value)) fail();
    out[key] = value as string | number;
  }
  if (complete && LINE_FIELDS.some(key => !(key in out))) fail();
  return out;
}
// Igualdad cruda: no defaults, clamps ni lectura de render.
export function rawEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (a instanceof Y.AbstractType || b instanceof Y.AbstractType) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every(key => Object.hasOwn(b, key) && rawEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}
const xml = (doc: Y.Doc) => doc.getXmlFragment(CONTENT_FRAGMENT).toString();
const items = (bytes: Uint8Array) => Y.decodeUpdate(bytes).structs.filter((s): s is Y.Item => s instanceof Y.Item);
function clone(bytes: Uint8Array, gc = true): Y.Doc {
  const doc = new Y.Doc({ gc });
  Y.applyUpdate(doc, bytes);
  return doc;
}
// Un sentinel en una copia prístina observa parent/origin; nunca toca la fuente.
export function lineProbe(doc: Y.Doc, key: string, field?: string): string {
  const bytes = Y.encodeStateAsUpdate(doc), copy = clone(bytes);
  try {
    if (!Y.equalSnapshots(Y.snapshot(doc), Y.snapshot(copy)) || xml(doc) !== xml(copy) || !rawEqual(rawLine(shape(doc, key)), rawLine(shape(copy, key)))) fail();
    const map = shape(copy, key), probeKey = field ?? `probe-${crypto.randomUUID()}`;
    if (!field && map.has(probeKey)) fail();
    let update: Uint8Array | null = null;
    copy.on('update', u => { if (update) fail(); update = u; });
    map.set(probeKey, `sentinel-${crypto.randomUUID()}`);
    const got = update ? items(update) : [];
    if (got.length !== 1 || got[0].length !== 1) fail();
    const item = got[0];
    if (field) return id(item.origin) ?? fail();
    if (!(item.parent instanceof Y.ID) || item.parentSub !== probeKey || item.origin !== null) fail();
    return id(item.parent instanceof Y.ID ? item.parent : null) ?? fail();
  } finally { copy.destroy(); }
}
function coverage(snapshot: Y.Snapshot, item: Y.Item): 'live' | 'deleted' | 'future' {
  if (item.length !== 1) fail();
  const end = item.id.clock + item.length, sv = snapshot.sv.get(item.id.client) ?? 0;
  if (sv > item.id.clock && sv < end) fail();
  const ranges = snapshot.ds.clients.get(item.id.client) ?? [];
  const overlaps = ranges.filter(r => r.clock < end && r.clock + r.len > item.id.clock);
  if (overlaps.some(r => r.clock > item.id.clock || r.clock + r.len < end)) fail();
  return sv < end ? 'future' : overlaps.length ? 'deleted' : 'live';
}
function belongs(item: Y.Item, inventory: Map<string, Y.Item>, trail = new Set<string>()): { parent: string; field: string } | null {
  const key = id(item.id)!;
  if (trail.has(key)) fail();
  trail.add(key);
  if (item.parent instanceof Y.ID && typeof item.parentSub === 'string') return { parent: id(item.parent)!, field: item.parentSub };
  if (item.parent instanceof Y.ID && item.parentSub === null) return null;
  if (typeof item.parent === 'string') return null;
  const links = [item.origin, item.rightOrigin].filter((v): v is Y.ID => v !== null);
  if (!links.length) fail();
  const found = links.map(link => belongs(inventory.get(id(link)!) ?? fail(), inventory, new Set(trail)));
  if (found.every(v => v === null)) return null;
  if (!found[0] || found.some(v => !v || v.parent !== found[0]!.parent || v.field !== found[0]!.field)) fail();
  return found[0];
}
export function recoveryPreview(dto: LineRecovery): LineValues {
  return { ...dto.baseline, ...dto.live };
}
export function observeLineRecovery(history: Y.Doc, rows: readonly HistoryRow[], liveBytes: Uint8Array, key: string): LineRecovery | null {
  const live = clone(liveBytes), cursor = new Y.Doc({ gc: false });
  try {
    const parsed = parseMarkupKey(key);
    if (!parsed?.shapeId || !mediaIdsInDoc(live).has(parsed.fileId)) return fail();
    const parent = lineProbe(live, key), current = rawLine(shape(live, key));
    if (!Object.keys(current).length || Object.keys(current).length === LINE_FIELDS.length) return null;
    const frame = live.getMap(PHOTO_MARKUP_MAP).get(parsed.fileId);
    if (!frame || typeof frame !== 'object' || frame instanceof Y.AbstractType) fail();
    const dimensions = frame as { v?: number; w?: number; h?: number };
    if (dimensions.v !== 1 || !Number.isFinite(dimensions.w) || !Number.isFinite(dimensions.h) || dimensions.w! <= 0 || dimensions.h! <= 0) fail();
    const inventory = new Map<string, Y.Item>();
    const first = new Map<string, number>();
    for (const row of rows) for (const item of items(row.data)) {
      if (!inventory.has(id(item.id)!)) { inventory.set(id(item.id)!, item); first.set(id(item.id)!, row.seq); }
    }
    const relevant = [...inventory.values()].filter(item => belongs(item, inventory)?.parent === parent);
    if (relevant.some(item => item.length !== 1 || !LINE_FIELDS.some(f => f === belongs(item, inventory)?.field))) fail();
    const winner = (snapshot: Y.Snapshot, field: string) => {
      const found = relevant.filter(item => belongs(item, inventory)?.field === field && coverage(snapshot, item) === 'live');
      return found.length === 1 ? found[0] : fail();
    };
    let candidate: LineRecovery | null = null;
    for (const row of rows) {
      const beforeSnapshot = Y.snapshot(cursor);
      const beforeValue = cursor.getMap(PHOTO_MARKUP_MAP).get(key);
      const before = beforeValue instanceof Y.Map ? rawLine(beforeValue) : {};
      const beforeFrame = cursor.getMap(PHOTO_MARKUP_MAP).get(parsed.fileId);
      const beforeParent = beforeValue instanceof Y.Map ? lineProbe(cursor, key) : null;
      const beforeRef = mediaIdsInDoc(cursor).has(parsed.fileId);
      const beforeOrigins = Object.keys(before).length === LINE_FIELDS.length ? Object.fromEntries(LINE_FIELDS.map(field => [field, lineProbe(cursor, key, field)])) : {};
      Y.applyUpdate(cursor, row.data);
      const integrated = Y.snapshot(cursor), meta = Y.decodeUpdate(row.data);
      if (meta.structs.some(item => (integrated.sv.get(item.id.client) ?? 0) < item.id.clock + item.length) || [...meta.ds.clients].some(([client, ranges]) => ranges.some(r => (integrated.sv.get(client) ?? 0) < r.clock + r.len))) fail();
      const afterValue = cursor.getMap(PHOTO_MARKUP_MAP).get(key);
      const after = afterValue instanceof Y.Map ? rawLine(afterValue) : {};
      const same = afterValue instanceof Y.Map && beforeParent === parent && lineProbe(cursor, key) === parent && beforeRef && mediaIdsInDoc(cursor).has(parsed.fileId) && rawEqual(beforeFrame, cursor.getMap(PHOTO_MARKUP_MAP).get(parsed.fileId));
      if (!same || Object.keys(before).length && !Object.keys(after).length) candidate = null;
      if (!same || Object.keys(before).length !== LINE_FIELDS.length || Object.keys(after).length) continue;
      const decoded = Y.decodeUpdate(row.data), at = Y.snapshot(cursor);
      if (relevant.some(item => first.get(id(item.id)!) === row.seq)) continue;
      const basal: Record<string, string> = {};
      let eligible = true;
      for (const field of LINE_FIELDS) {
        const item = winner(beforeSnapshot, field);
        if (beforeOrigins[field] !== id(item.id)) fail();
        const delta = new Y.Snapshot(decoded.ds, at.sv);
        if (coverage(at, item) !== 'deleted' || coverage(delta, item) !== 'deleted' || lineProbeBeforeMismatch(item, before[field])) eligible = false;
        basal[field] = id(item.id)!;
      }
      if (relevant.some(item => coverage(beforeSnapshot, item) === 'deleted' && coverage(new Y.Snapshot(decoded.ds, at.sv), item) === 'deleted')) eligible = false;
      if (eligible) candidate = { key, parent, removedAt: row.seq, baseline: before, live: current, fill: [], items: basal, snapshot: Y.encodeSnapshot(Y.snapshot(live)), frame: structuredClone(frame) };
    }
    if (!Y.equalSnapshots(Y.snapshot(cursor), Y.snapshot(history)) || !Y.equalSnapshots(Y.snapshot(cursor), Y.snapshot(live)) || xml(cursor) !== xml(live) || !rawEqual(rawLine(shape(cursor, key)), current)) fail();
    if (!candidate || !rawEqual(candidate.frame, frame)) return null;
    const liveInventory = new Map(items(liveBytes).map(item => [id(item.id)!, item]));
    let late = false;
    for (const field of LINE_FIELDS) {
      const last = lineProbe(live, key, field), item = inventory.get(last) ?? fail();
      if (!liveInventory.has(last) || belongs(item, inventory)?.parent !== parent || belongs(item, inventory)?.field !== field) fail();
      if (field in current) {
        if (id(winner(Y.snapshot(live), field).id) !== last || lineProbeBeforeMismatch(item, current[field])) fail();
        late ||= (first.get(last) ?? -1) > candidate.removedAt;
      } else {
        if (last !== candidate.items[field] || coverage(Y.snapshot(live), item) !== 'deleted' || relevant.some(v => belongs(v, inventory)?.field === field && (first.get(id(v.id)!) ?? -1) > candidate!.removedAt)) return null;
        candidate.fill.push(field);
      }
      candidate.items[field] = last;
    }
    return late ? candidate : null;
  } finally { live.destroy(); cursor.destroy(); }
}
function lineProbeBeforeMismatch(item: Y.Item, value: string | number): boolean {
  return !(item.content instanceof Y.ContentAny) || item.content.getContent().length !== 1 || !Object.is(item.content.getContent()[0], value);
}
export function recoveryCurrent(doc: Y.Doc, dto: LineRecovery): boolean {
  try {
    const parsed = parseMarkupKey(dto.key);
    return !!parsed && mediaIdsInDoc(doc).has(parsed.fileId) && rawEqual(doc.getMap(PHOTO_MARKUP_MAP).get(parsed.fileId), dto.frame) && Y.equalSnapshots(Y.snapshot(doc), Y.decodeSnapshot(dto.snapshot)) && lineProbe(doc, dto.key) === dto.parent && rawEqual(rawLine(shape(doc, dto.key)), dto.live) && LINE_FIELDS.every(field => lineProbe(doc, dto.key, field) === dto.items[field]);
  } catch { return false; }
}
