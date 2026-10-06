import { afterEach, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import * as Y from 'yjs';
import { PageHistory, type HistoryRow } from './history';
import { createHistoryEngine, type WorkerLike } from './historyClient';
import { HistoryCore, type HistoryRequest } from './historyCore';
import { CONTENT_FRAGMENT } from './structure';
import { LINE_FIELDS, lineProbe, observeLineRecovery, recoveryCurrent, recoveryPreview } from './historyMapWitness';

const file = '0f8fad5b-d9cb-469f-a165-708677289501', key = `${file}/s1`;
const basal = { type: 'line', zValue: 1, posX: 10, posY: 10, startX: 0, startY: 0, endX: 50, endY: 50, strokeColor: '#FF0000' };
const documents: Y.Doc[] = [];
const make = (bytes?: Uint8Array) => { const doc = new Y.Doc(); documents.push(doc); if (bytes) Y.applyUpdate(doc, bytes); return doc; };
const values = (doc: Y.Doc) => doc.getMap('photoMarkup').get(key) as Y.Map<unknown>;
function fixture() {
  const live = make(), rows: HistoryRow[] = [];
  live.on('update', data => rows.push({ id: rows.length + 1, seq: rows.length + 1, data: data.slice(), createdAt: new Date(rows.length * 31 * 60_000).toISOString(), createdBy: 'A' }));
  live.transact(() => {
    const photo = new Y.XmlElement('image'); photo.setAttribute('url', `sdmedia://${file}`);
    live.getXmlFragment(CONTENT_FRAGMENT).insert(0, [photo]);
    live.getMap('photoMarkup').set(file, { v: 1, w: 4000, h: 3000 });
    live.getMap('photoMarkup').set(key, new Y.Map(Object.entries(basal)));
  });
  const before = Y.encodeStateAsUpdate(live), offline = make(before);
  values(offline).set('posX', 47);
  const late = Y.encodeStateAsUpdate(offline, Y.encodeStateVector(live));
  const remove = () => live.transact(() => LINE_FIELDS.forEach(f => values(live).delete(f)));
  const deliver = () => Y.applyUpdate(live, late);
  const observe = () => {
    const h = new PageHistory(rows), bytes = Y.encodeStateAsUpdate(live), original = Y.encodeStateAsUpdate(h.doc);
    try {
      const result = observeLineRecovery(h.doc, rows, bytes, key);
      expect(Y.encodeStateAsUpdate(live)).toEqual(bytes);
      expect(Y.encodeStateAsUpdate(h.doc)).toEqual(original);
      return result;
    } finally { h.destroy(); }
  };
  return { live, rows, offline, late, before, remove, deliver, observe };
}
class ProtocolWorker implements WorkerLike {
  core = new HistoryCore();
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  postMessage(message: unknown) {
    const { id, req } = structuredClone(message) as { id: number; req: HistoryRequest };
    queueMicrotask(() => {
      try { this.onmessage?.({ data: structuredClone({ id, ok: true, reply: this.core.handle(req) }) }); }
      catch (error) { this.onmessage?.({ data: { id, ok: false, error: String(error) } }); }
    });
  }
  terminate() { this.core.destroy(); }
}
afterEach(() => { documents.splice(0).forEach(doc => doc.destroy()); });
describe('LINE9 pública', () => {
  it('N1 overwrite no es retiro D', () => {
    const f = fixture(); values(f.live).set('strokeColor', '#00FF00'); values(f.live).set('posX', 47);
    expect(f.observe()).toBeNull();
  });
  it('N2 sameparent y todos los campos vivos encima; fuentes inmóviles', () => {
    const f = fixture(), parent = lineProbe(f.live, key); f.remove(); f.deliver();
    const dto = f.observe()!;
    expect(dto.parent).toBe(parent); expect(dto.fill).toEqual(LINE_FIELDS.filter(v => v !== 'posX'));
    expect(recoveryPreview(dto).posX, 'C47_PREVIEW').toBe(47);
    expect(recoveryCurrent(f.live, dto)).toBe(true);
  });
  it('N3 nueva escritura luego borrada invalida y no rellena basal', () => {
    const f = fixture(); f.remove(); f.deliver(); const dto = f.observe()!;
    values(f.live).set('startX', 99); values(f.live).delete('startX');
    expect(recoveryCurrent(f.live, dto)).toBe(false); expect(f.observe()).toBeNull();
  });
  it('N4 partial→empty es barrera aunque SV no cambie', () => {
    const f = fixture(); f.remove(); f.deliver(); const sv = Y.encodeStateVector(f.live);
    values(f.live).delete('posX'); expect(Y.encodeStateVector(f.live)).toEqual(sv);
    values(f.live).set('posY', 50); expect(f.observe()).toBeNull();
  });
  it('dos overwrites concurrentes iguales con basal distinto, oracle SVDS y D', () => {
    const f = fixture(), left = make(f.before), right = make(f.before), sv = Y.encodeStateVector(f.live);
    values(left).set('strokeColor', '#00FF00'); values(right).set('strokeColor', '#00FF00');
    const a = Y.encodeStateAsUpdate(left, sv), b = Y.encodeStateAsUpdate(right, sv);
    Y.applyUpdate(f.live, a); Y.applyUpdate(f.live, b);
    const snapshot = Y.snapshot(f.live), probe = lineProbe(f.live, key, 'strokeColor');
    const candidates = [Y.decodeUpdate(f.before).structs.find(v => v instanceof Y.Item && v.parentSub === 'strokeColor')!, ...Y.decodeUpdate(a).structs, ...Y.decodeUpdate(b).structs].filter((v): v is Y.Item => v instanceof Y.Item);
    const visible = candidates.filter(item => (snapshot.sv.get(item.id.client) ?? 0) >= item.id.clock + item.length && !(snapshot.ds.clients.get(item.id.client) ?? []).some(r => r.clock <= item.id.clock && r.clock + r.len >= item.id.clock + item.length));
    expect(visible).toHaveLength(1); expect(probe).toBe(`${visible[0].id.client}:${visible[0].id.clock}`);
    if (process.env.RESTORE_B_OUT) {
      for (const [name, bytes] of Object.entries({ basal: f.before, left: a, right: b, beforeD: Y.encodeStateAsUpdate(f.live) })) writeFileSync(`${process.env.RESTORE_B_OUT}/concurrent-${name}.bin`, bytes);
      writeFileSync(`${process.env.RESTORE_B_OUT}/concurrent-oracle.json`, JSON.stringify({ probe, sv: [...snapshot.sv], ds: [...snapshot.ds.clients], candidates: candidates.map(v => ({ id: v.id, length: v.length, value: v.content.getContent() })), winner: visible[0].id }, null, 2));
    }
    f.remove(); f.deliver(); const dto = f.observe()!;
    expect(dto.baseline.strokeColor).toBe('#00FF00'); expect(dto.baseline.strokeColor).not.toBe(basal.strokeColor);
    expect(recoveryPreview(dto).posX).toBe(47);
  });
  it('missing H, opaco y frame incompatible rechazan sin escribir', () => {
    const f = fixture(); f.remove(); f.deliver();
    const missing = new PageHistory(f.rows.slice(1));
    expect(() => observeLineRecovery(missing.doc, f.rows.slice(1), Y.encodeStateAsUpdate(f.live), key)).toThrow('UNOBSERVABLE'); missing.destroy();
    values(f.live).set('opaque', new Y.Text('x')); expect(() => f.observe()).toThrow('UNOBSERVABLE');
    values(f.live).delete('opaque'); f.live.getMap('photoMarkup').set(file, { v: 1, w: 5000, h: 3000 });
    expect(() => f.observe()).toThrow('UNOBSERVABLE');
  });
  it('frame cambiado, padre reemplazado, prefijo parcial y paquete mezclado no autorizan D', () => {
    const frame = fixture(); frame.remove(); frame.deliver(); frame.live.getMap('photoMarkup').set(file, { v: 1, w: 5000, h: 3000 }); expect(frame.observe()).toBeNull();
    const parent = fixture(); parent.remove(); parent.deliver(); parent.live.getMap('photoMarkup').set(key, new Y.Map([['posX', 47]])); expect(parent.observe()).toBeNull();
    const partial = fixture(); values(partial.live).delete('type'); partial.remove(); partial.deliver(); expect(partial.observe()).toBeNull();
    const mixed = fixture(); mixed.live.transact(() => { values(mixed.live).set('startX', 99); mixed.remove(); }); mixed.deliver(); expect(mixed.observe()).toBeNull();
  });
  it('ID interior y corte SV/DS parcial del DTO rechazan; pérdida de prefijos GC no da autoridad', () => {
    const f = fixture(); f.remove(); f.deliver(); const dto = f.observe()!, original = Y.encodeStateAsUpdate(f.live);
    const [client, clock] = dto.items.posX.split(':').map(Number);
    expect(recoveryCurrent(f.live, { ...dto, items: { ...dto.items, posX: `${client}:${clock + 1}` } })).toBe(false);
    const cut = Y.decodeSnapshot(dto.snapshot); cut.sv.set(client, clock);
    expect(recoveryCurrent(f.live, { ...dto, snapshot: Y.encodeSnapshot(cut) })).toBe(false);
    const combined = Y.mergeUpdates(f.rows.map(row => row.data)), row = { ...f.rows[0], data: combined };
    const h = new PageHistory([row]); expect(observeLineRecovery(h.doc, [row], original, key)).toBeNull(); h.destroy();
    const gc = new PageHistory([{ ...row, data: original }]); expect(observeLineRecovery(gc.doc, gc.rows, original, key)).toBeNull(); gc.destroy();
    expect(Y.encodeStateAsUpdate(f.live)).toEqual(original);
  });
  it('sin ACK y reply antiguo tras append delete-only o fallback no autoriza escritura', async () => {
    const f = fixture(); f.remove(); f.deliver(); const w = new ProtocolWorker(), engine = createHistoryEngine(() => w);
    const load = engine.load(f.rows, 'page'); await expect(engine.recoverLine(Y.encodeStateAsUpdate(f.live), 's', 1)).rejects.toThrow('history_pending'); await load;
    let delayed: (() => void) | undefined;
    const deliver = w.onmessage; w.onmessage = event => { const data = event.data as { reply?: { candidates?: unknown[] } }; if (data.reply?.candidates) delayed = () => deliver?.(event); else deliver?.(event); };
    const old = engine.recoverLine(Y.encodeStateAsUpdate(f.live), 's', 2), rejected = expect(old).rejects.toThrow('selection_changed');
    await Promise.resolve(); values(f.live).delete('posX'); await engine.append([f.rows.at(-1)!]); delayed!(); await rejected;
    const f2 = fixture(); f2.remove(); f2.deliver(); await engine.load(f2.rows, 'page');
    const epoch = engine.epoch(), pending = engine.recoverLine(Y.encodeStateAsUpdate(f2.live), 's', 3), failed = expect(pending).rejects.toThrow('selection_changed');
    await Promise.resolve(); w.onerror?.({ preventDefault() {} }); await failed; expect(engine.kind()).toBe('main'); expect(engine.epoch()).not.toBe(epoch);
    const next = await engine.recoverLine(Y.encodeStateAsUpdate(f2.live), 's', 4); expect(next.candidates).toHaveLength(1); engine.destroy();
  });
  for (const route of ['protocol-worker', 'fallback'] as const) it(`${route}: corte ACK, C47 y append delete-only invalida`, async () => {
    const f = fixture(); f.remove(); f.deliver(); const worker = route === 'protocol-worker' ? new ProtocolWorker() : null;
    const engine = createHistoryEngine(() => worker);
    try {
      await engine.load(f.rows, 'page'); const epoch = engine.epoch();
      const reply = await engine.recoverLine(Y.encodeStateAsUpdate(f.live), 'scope', 1);
      expect(recoveryPreview(reply.candidates[0]).posX, 'C47_PREVIEW').toBe(47);
      values(f.live).delete('posX'); await engine.append([f.rows.at(-1)!]); expect(engine.epoch()).not.toBe(epoch);
      const after = await engine.recoverLine(Y.encodeStateAsUpdate(f.live), 'scope', 2); expect(after.candidates).toHaveLength(0);
    } finally { engine.destroy(); }
  });
});
