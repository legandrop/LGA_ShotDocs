// @vitest-environment jsdom
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { beforeAll, afterAll, afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { writeBlocks } from '../export/testProject';
import { folderSource } from '../export/zipReader';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { SHARED_COLLAPSE_MAP } from '../ui/collapseEditor';
import { PHOTO_MARKUP_MAP } from '../media/markup';
import { ARCHIVE_COMMENTS_SCHEMA_VERSION } from '../sync/comments';
import { archiveJournal, importArchive, openArchive, type ArchiveImportDeps } from './shotdocsImport';
import { exactValue, normalizeImport, type ImportCommit } from './importCommit';

const controls = vi.hoisted(() => ({ omitRecognition: false }));
vi.mock('./codaImport', async (original) => {
  const m = await original<typeof import('./codaImport')>();
  return { ...m, writePage: ((docs, page, blocks, recovery, extra) => m.writePage(docs, page, blocks,
    controls.omitRecognition && recovery && typeof recovery === 'object' ? { ...recovery, commit: undefined } : recovery, extra)) as typeof m.writePage };
});
const output = process.env.LGA_IMPORT_QA_OUT;
const originalUint8Binding = Uint8Array;
const records: unknown[] = [];
const save = () => { if (output) writeFileSync(`${output}/RAW.json`, JSON.stringify(records, null, 2)); };
const hash = (v: Uint8Array) => createHash('sha256').update(v).digest('hex');
function recordConstructorBinding(raw: unknown, operation: string) {
  const journal = raw as { pages?: Record<string, { commit?: ImportCommit }> } | undefined;
  for (const [page, entry] of Object.entries(journal?.pages ?? {})) {
    const target = entry.commit?.targetUpdate;
    if (!target) continue;
    const clone = structuredClone(target);
    const describe = (value: Uint8Array) => ({ tag: Object.prototype.toString.call(value), constructor: value.constructor.name,
      isView: ArrayBuffer.isView(value), instanceofBinding: value instanceof Uint8Array, constructorIsBinding: value.constructor === Uint8Array,
      prototypeIsBinding: Object.getPrototypeOf(value) === Uint8Array.prototype, bytes: value.byteLength, sha256: hash(value) });
    records.push({ binding: operation, page, phase: entry.commit?.phase, target: describe(target), literalClone: describe(clone) }); save();
    expect(target instanceof Uint8Array, 'target pertenece al binding elegido').toBe(true);
    expect(clone instanceof Uint8Array, 'clone literal pertenece al binding elegido').toBe(true);
    expect(clone.length).toBe(target.length);
    expect(target.every((byte, i) => byte === clone[i]), 'bytes íntegros del clone literal').toBe(true);
    if (output) { writeFileSync(`${output}/binding-${records.length}-target.bin`, target); writeFileSync(`${output}/binding-${records.length}-clone.bin`, clone); }
  }
}
function diagnose(store: ReturnType<typeof archiveJournal>) {
  const observe = (error: unknown) => {
    const e = error as { message?: string; reason?: string; raw?: { pages?: Record<string, { commit?: ImportCommit }> } };
    const commit = e.raw?.pages?.[sourcePage]?.commit;
    const target = commit?.targetUpdate;
    const describe = (v: unknown) => ({ tag: Object.prototype.toString.call(v), constructor: (v as { constructor?: { name?: string } })?.constructor?.name,
      isArray: Array.isArray(v), isView: ArrayBuffer.isView(v), isUint8: v instanceof Uint8Array, sameUint8Prototype: !!v && Object.getPrototypeOf(v) === Uint8Array.prototype });
    let normalized: unknown, bytesSHA: string | undefined, bytes: number[] | undefined;
    if (target) {
      try { normalized = { bytes: normalizeImport(target).length, sha256: hash(normalizeImport(target)) }; } catch (failure) { normalized = { error: String(failure) }; }
      try { bytesSHA = hash(target); bytes = Array.from(target); if (output) writeFileSync(`${output}/rejected-${records.length}.bin`, target); } catch (failure) { normalized = { normalized, byteReadError: String(failure) }; }
    }
    records.push({ diagnostic: 'rejected-real-raw', error: e.message, reason: e.reason, raw: e.raw, rootKeys: e.raw ? Object.keys(e.raw) : [],
      commitKeys: commit ? Object.keys(commit) : [], phase: commit?.phase, planReady: commit?.planReady,
      target: describe(target), notes: describe(commit?.notes), comments: describe(commit?.commentsPlan), currentRealm: describe(new Uint8Array([1, 2])),
      literalClone: target ? describe(structuredClone(target)) : null, bytesSHA, bytes, normalized }); save();
  };
  return {
    get: async (...args: Parameters<typeof store.get>) => { try { const raw = await store.get(...args); recordConstructorBinding(raw, 'DB-get'); return raw; } catch (e) { observe(e); throw e; } },
    put: async (...args: Parameters<typeof store.put>) => { try { await store.put(...args); recordConstructorBinding(args[0], 'put-input'); } catch (e) { observe(e); throw e; } },
    remove: async (...args: Parameters<typeof store.remove>) => { try { return await store.remove(...args); } catch (e) { observe(e); throw e; } },
  };
}
beforeAll(async () => {
  if (output) {
    writeFileSync(`${output}/worker-pid.json`, JSON.stringify({ pid: process.pid, argv: process.argv, execPath: process.execPath, cwd: process.cwd() }));
    const until = Date.now() + 45000;
    while (!existsSync(`${output}/worker-ack.json`)) { if (Date.now() > until) throw new Error('Worker ACK timeout'); await new Promise(r => setTimeout(r, 25)); }
  }
  const previousUint8 = Uint8Array;
  vi.stubGlobal('Uint8Array',structuredClone(new Uint8Array([1,2])).constructor);
  records.push({ binding: 'beforeAll', changed: previousUint8 !== Uint8Array, constructor: Uint8Array.name, receptionConstructorSame: structuredClone(new Uint8Array([1, 2])).constructor === Uint8Array }); save();
  const wrongTypes = [[], new DataView(new ArrayBuffer(2)), new Uint16Array([1, 2]), { constructor: { name: 'Uint8Array' }, [Symbol.toStringTag]: 'Uint8Array', length: 2, 0: 0, 1: 0 }];
  for (const value of wrongTypes) {
    expect(value instanceof Uint8Array).toBe(false);
    expect(() => normalizeImport(value as unknown as Uint8Array)).toThrow('Import pending: invalid');
    records.push({ typeRejection: Object.prototype.toString.call(value), constructor: value.constructor.name, isView: ArrayBuffer.isView(value), instanceofBinding: value instanceof Uint8Array }); save();
  }
  vi.stubGlobal('Blob', NodeBlob); vi.stubGlobal('File', NodeFile);
  vi.stubGlobal('fetch', () => { throw new Error('Red no autorizada'); });
  window.matchMedia ??= ((media: string) => ({ matches: false, media, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })) as never;
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
}, 45000);
afterAll(() => {
  vi.unstubAllGlobals();
  records.push({ binding: 'afterAll', restored: Uint8Array === originalUint8Binding });
  save();
});
const liveDevices = new Set<Device>();
afterEach(async () => { controls.omitRecognition = false; for (const d of liveDevices) { d.offline.stop(); await d.engine.stop(); d.docs.dispose(); await d.docs.flush(); d.db.close(); d.mediaDb.close(); d.commentsDb.close(); } liveDevices.clear(); vi.restoreAllMocks(); save(); });
const sourcePage = '10000000-0000-4000-8000-000000000001';
async function fixture(two = false, comments = false, bad = false, userEmail?: string) {
  const ids = two ? [sourcePage, '10000000-0000-4000-8000-000000000002'] : [sourcePage];
  const files: Record<string, string> = { '_shotdocs/manifest.json': JSON.stringify({ format: 1, id: crypto.randomUUID(), title: 'Recovery', pages: ids.map((id, order) => ({ id, parent: null, title: `Page ${order}`, order, json: `_shotdocs/pages/${order}.json`, complete: true })) }) };
  for (const [i, id] of ids.entries()) files[`_shotdocs/pages/${i}.json`] = bad ? '{broken' : JSON.stringify({ id, blocks: [{ type: 'paragraph', props: { textColor: 'red' }, content: 'IMPORTADO_R1' }], collapsedForAll: [] });
  if (comments) files['_shotdocs/comments.json'] = JSON.stringify({ threads: [{ page: sourcePage, id: 'thread', block: null, comments: [{ id: 'comment', mine: true, body: 'Comentario importado', author: 'Autor', createdAt: '2026-09-01T12:00:00Z' }] }] });
  if (comments && userEmail) {
    const salt = 'abcdef0123456789';
    const manifest = JSON.parse(files['_shotdocs/manifest.json']);
    manifest.exporter = { salt, hash: hash(new TextEncoder().encode(`shotdocs-author:${salt}:${userEmail.trim().toLowerCase()}`)) };
    files['_shotdocs/manifest.json'] = JSON.stringify(manifest);
  }
  const source = folderSource(Object.entries(files).map(([p, text]) => Object.assign(new NodeFile([text], p.split('/').pop()!), { webkitRelativePath: `R/${p}` }) as unknown as File));
  return Object.freeze({ archive: await openArchive(source), sourceHash: hash(new TextEncoder().encode(JSON.stringify(files))), sourceJSON: JSON.stringify(files) });
}
async function device(server: FakeServer, name: string) { const d = await makeDevice(server, name); liveDevices.add(d); return d; }
function deps(d: Device, extra: Partial<ArchiveImportDeps> = {}): ArchiveImportDeps {
  return { tree: d.tree, docs: d.docs, media: d.media, journal: archiveJournal(d.db), comments: d.comments, schemaVersion: ARCHIVE_COMMENTS_SCHEMA_VERSION, ...extra };
}
function capture(doc: Y.Doc, label: string) {
  const raw = Y.encodeStateAsUpdate(doc), n = normalizeImport(raw), xml = doc.getXmlFragment(CONTENT_FRAGMENT).toString();
  const decoded = Y.decodeUpdate(raw), clocks = Y.parseUpdateMeta(raw);
  const value = { label, xml, own: xml.split('PROPIO_R1').length - 1, imported: xml.split('IMPORTADO_R1').length - 1, normalizedSHA: hash(n), rawSHA: hash(raw), bytes: raw.length,
    ds: [...decoded.ds.clients], clocks: { from: [...clocks.from], to: [...clocks.to] }, collapse: doc.getMap(SHARED_COLLAPSE_MAP).toJSON(), markup: doc.getMap(PHOTO_MARKUP_MAP).toJSON() };
  if (output) { writeFileSync(`${output}/${label}-raw.bin`, raw); writeFileSync(`${output}/${label}-N.bin`, n); } records.push(value); save(); return { ...value, n };
}
function observeHandles() {
  const handles: IDBDatabase[] = [], transactions = new Set<IDBTransaction>();
  const open = IDBFactory.prototype.open, tx = IDBDatabase.prototype.transaction;
  IDBFactory.prototype.open = function (...args) { const r = open.apply(this, args); r.addEventListener('success', () => handles.push(r.result)); return r; };
  IDBDatabase.prototype.transaction = function (...args) { const r = tx.apply(this, args); transactions.add(r); for (const event of ['complete', 'abort']) r.addEventListener(event, () => transactions.delete(r)); return r; };
  return { handles, transactions, restore: () => { IDBFactory.prototype.open = open; IDBDatabase.prototype.transaction = tx; } };
}
async function closeAll(d: Device, doc: Y.Doc | undefined, page: string, observed: ReturnType<typeof observeHandles>) {
  d.offline.stop(); await d.engine.stop(); await d.docs.flush();
  if (doc) { const destroyed = new Promise<void>(resolve => doc.once('destroy', () => resolve())); d.docs.close(page); await destroyed; }
  d.docs.dispose(); await d.docs.flush(); d.db.close(); d.mediaDb.close(); d.commentsDb.close(); liveDevices.delete(d);
  const until = Date.now() + 3000; while (observed.transactions.size && Date.now() < until) await new Promise(r => setTimeout(r, 5));
  expect(observed.transactions.size).toBe(0);
  for (const h of observed.handles) { h.close(); expect(() => h.transaction(h.objectStoreNames[0])).toThrow(); }
  records.push({ closedHandles: observed.handles.length, transactions: observed.transactions.size }); save();
}
function abortDocuments(dbName: string) {
  let enabled = false, aborted = 0, sequence = 0;
  let received!: () => void;
  const event = new Promise<void>(resolve => { received = resolve; });
  const original = IDBDatabase.prototype.transaction;
  const spy = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args) {
    const tx = original.apply(this, args);
    if (enabled && this.name === dbName && Array.isArray(args[0]) && args[0].includes('docUpdates') && args[0].includes('meta') && args[1] === 'readwrite') {
      const id = `${dbName}:${++sequence}`, stores = [...tx.objectStoreNames];
      const publicDone = (tx as IDBTransaction & { done?: Promise<void> }).done;
      records.push({ diagnostic: 'abort-tx-created', id, db: this.name, stores, mode: tx.mode, at: new Date().toISOString(), doneAvailable: !!publicDone }); save();
      publicDone?.then(() => { records.push({ diagnostic: 'abort-tx-done-resolved', id }); save(); }, error => { records.push({ diagnostic: 'abort-tx-done-rejected', id, error: String(error) }); save(); });
      tx.commit = () => { records.push({ diagnostic: 'commit-neutralized', id, at: new Date().toISOString() }); save(); };
      tx.addEventListener('abort', () => { aborted++; received(); records.push({ diagnostic: 'real-abort-event', id, stores, at: new Date().toISOString(), error: String(tx.error) }); save(); });
      queueMicrotask(() => {
        try { records.push({ diagnostic: 'abort-request', id, at: new Date().toISOString() }); tx.abort(); save(); }
        catch (error) {
          if ((error as DOMException).name !== 'InvalidStateError') throw error;
          records.push({ diagnostic: 'abort-attempt-too-late-or-closed', id, name: (error as DOMException).name }); save();
        }
      });
    }
    return tx;
  });
  const wait = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([event, new Promise<void>((_, reject) => { timer = setTimeout(() => reject(new Error('Own abort event timeout')), 3000); })]); }
    finally { if (timer !== undefined) clearTimeout(timer); }
  };
  return { arm: () => { enabled = true; }, release: () => { enabled = false; }, count: () => aborted, wait, restore: () => spy.mockRestore() };
}

async function waitSaved(d: Device, page: string) {
  const deadline = Date.now() + 10000;
  for (;;) {
    if (Date.now() >= deadline) throw new Error(`Own durable retry timeout: ${d.docs.getWriteError()}`);
    if (d.docs.isSaved(page)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

it('H1 conserva diario sin Done; quitar sólo isSaved falla la misma aserción', async () => {
  const unfinished = (r: Awaited<ReturnType<typeof importArchive>>) => assert.equal(r.resumable, true);
  for (const guard of [true, false, true]) {
    const server = new FakeServer(); server.online = false;
    const name = `H1-${crypto.randomUUID()}`, d = await device(server, name), f = await fixture();
    let page = '';
    const base = diagnose(archiveJournal(d.db)), abort = abortDocuments(name);
    const journal = { ...base, put: async (...args: Parameters<typeof base.put>) => { await base.put(...args); const entry = args[0].pages[sourcePage]; if (entry) page = entry.pageId; if (Object.values(args[0].pages).some(p => p.commit?.phase === 'planned')) abort.arm(); } };
    const actualSaved = d.docs.isSaved.bind(d.docs);
    const r = await importArchive(f.archive, deps(d, { journal, docs: { open: d.docs.open.bind(d.docs), close: d.docs.close.bind(d.docs), flush: d.docs.flush.bind(d.docs), isSaved: id => guard ? actualSaved(id) : true } }));
    await abort.wait(); expect(abort.count()).toBeGreaterThan(0);
    if (guard) {
      unfinished(r); expect(await base.get(f.archive.key)).toMatchObject({ recoveryVersion: 2 });
      const fresh = await device(server, name), cold = await fresh.docs.open(page);
      expect(capture(cold, `H1-${records.length}-fresh-before-retry`).imported).toBe(0);
      fresh.docs.close(page);
    }
    else { let error: unknown; try { unfinished(r); } catch (e) { error = e; } expect(error).toBeInstanceOf(assert.AssertionError); records.push({ causal: 'H1', expectedAssertion: String(error) }); }
    records.push({ case: 'H1', guard, result: r, journal: await base.get(f.archive.key) }); save();
    abort.release(); await d.docs.flush(); abort.restore();
  }
}, 30000);

it('B1 dos positivos: Retry durable, cierre total, Resume y segunda fresh preservan unicidad', async () => {
  const unique = (c: ReturnType<typeof capture>) => { assert.equal(c.own, 1); assert.equal(c.imported, 1); };
  const f = await fixture(), source = { key: f.archive.key, hash: f.sourceHash, sourcePage, files: f.sourceJSON };
  records.push({ causal: 'B1', status: 'DEFERIDO/NOEJECUTADO', reason: 'La API recovery no expone prepare/extra reales del contexto actual; source.original05.test.tsx conserva el control anterior sin crédito.' }); save();
  for (const round of [1, 2]) {
    const omit = false;
    expect(f.archive.key).toBe(source.key); expect(hash(new TextEncoder().encode(f.sourceJSON))).toBe(source.hash);
    const observed = observeHandles(), server = new FakeServer(); server.online = false;
    const name = `B1-${crypto.randomUUID()}`; let d = await device(server, name);
    const base = diagnose(archiveJournal(d.db)), abort = abortDocuments(name); let injected = false, page = '';
    const journal = { ...base, put: async (...args: Parameters<typeof base.put>) => {
      const entry = args[0].pages[sourcePage];
      if (entry && !entry.commit && !injected) { injected = true; page = entry.pageId; await writeBlocks(d.docs, page, [{ type: 'paragraph', content: 'PROPIO_R1' }]); const own = await d.docs.open(page); own.getMap(PHOTO_MARKUP_MAP).set('own', { color: 'red', points: [1, 2] }); d.docs.close(page); await d.docs.flush(page); }
      await base.put(...args); if (entry?.commit?.phase === 'planned') abort.arm();
    } };
    try {
      const first = await importArchive(f.archive, deps(d, { journal })); expect(first.resumable).toBe(true); await abort.wait(); expect(abort.count()).toBeGreaterThan(0);
      const planned = (await base.get(f.archive.key))!.pages[sourcePage].commit!; expect(planned.phase).toBe('planned');
      abort.release(); await d.docs.flush(page);
      await waitSaved(d, page);
      expect(d.docs.isSaved(page)).toBe(true);
      let doc = await d.docs.open(page); const before = capture(doc, `B1-${omit}-${records.length}-retry`); unique(before);
      expect(exactValue(before.n, normalizeImport(planned.targetUpdate))).toBe(true); abort.restore(); await closeAll(d, doc, page, observed);
      d = await device(server, name); controls.omitRecognition = omit;
      const resumed = await importArchive(f.archive, deps(d), { resume: true }); expect(resumed.resumable).toBe(false); controls.omitRecognition = false;
      doc = await d.docs.open(page); const after = capture(doc, `B1-${omit}-${records.length}-resume`);
      unique(after); expect(exactValue(after.n, before.n)).toBe(true); expect(after.markup).toEqual(before.markup);
      expect(resumed.projectId).toBe(first.projectId); await closeAll(d, doc, page, observed);
      d = await device(server, name); doc = await d.docs.open(page); const fresh = capture(doc, `B1-${omit}-${records.length}-fresh2`);
      expect(exactValue(fresh.n, after.n)).toBe(true); if (!omit) unique(fresh); await closeAll(d, doc, page, observed);
      records.push({ case: 'B1', round, source, sourceHash: f.sourceHash, first, resumed, handles: observed.handles.length }); save();
    } finally { controls.omitRecognition = false; abort.release(); abort.restore(); observed.restore(); }
  }
}, 45000);

it('preparación inválida y namespaces conservan raw sin plan ni página reescrita', async () => {
  const server = new FakeServer(); server.online = false; const d = await device(server, `meta-${crypto.randomUUID()}`);
  const f = await fixture(false, false, true), store = archiveJournal(d.db);
  const r = await importArchive(f.archive, deps(d)); expect(r.resumable).toBe(true);
  const j = (await store.get(f.archive.key))!; expect(j.pages[sourcePage].commit).toBeUndefined();
  const legacy = { projectId: 'other', pages: { old: { written: 'weak', done: true } }, media: { original: 'kept' } };
  await d.db.put('meta', legacy, `shotdocsImport:${f.archive.key}`);
  await expect(store.get(f.archive.key)).rejects.toMatchObject({ reason: 'namespaceConflict' });
  expect(await d.db.get('meta', `shotdocsImport2:${f.archive.key}`)).toEqual(j); expect(await d.db.get('meta', `shotdocsImport:${f.archive.key}`)).toEqual(legacy);
  await expect(store.put(j, j)).rejects.toMatchObject({ reason: 'namespaceConflict' }); await expect(store.remove(f.archive.key, j)).rejects.toMatchObject({ reason: 'namespaceConflict' });
  for (const raw of [{ recoveryVersion: 99 }, { recoveryVersion: 2, pages: null }]) {
    const key = crypto.randomUUID(); await d.db.put('meta', raw, `shotdocsImport2:${key}`); await expect(store.get(key)).rejects.toMatchObject({ reason: 'invalid' }); expect(await d.db.get('meta', `shotdocsImport2:${key}`)).toEqual(raw);
  }
  const key = crypto.randomUUID(); await d.db.put('meta', legacy, `shotdocsImport:${key}`); await expect(store.get(key)).rejects.toMatchObject({ reason: 'legacy' }); expect(await d.db.get('meta', `shotdocsImport:${key}`)).toBeUndefined(); expect(await d.db.get('meta', `shotdocsImport2:${key}`)).toEqual({ recoveryVersion: 2, legacy });
  records.push({ case: 'namespaces', rawLegacy: legacy, journal: j }); save();
});

it('delete-only durante planned.put cancela cuerpo; rechazo put no aplica', async () => {
  for (const kind of ['text', 'map', 'put']) {
    const server = new FakeServer(); server.online = false; const d = await device(server, `seal-${crypto.randomUUID()}`), f = await fixture();
    const base = diagnose(archiveJournal(d.db)); let page = '', injected = false, priorSV: Uint8Array | undefined, nextSV: Uint8Array | undefined;
    const journal = { ...base, put: async (...args: Parameters<typeof base.put>) => {
      const entry = args[0].pages[sourcePage];
      if (entry && !injected) { injected = true; page = entry.pageId; await writeBlocks(d.docs, page, [{ type: 'paragraph', content: 'PROPIO_R1' }]); const doc = await d.docs.open(page); doc.getMap(PHOTO_MARKUP_MAP).set('own', 'value'); d.docs.close(page); await d.docs.flush(page); }
      if (entry?.commit?.phase === 'planned') {
        if (kind === 'put') throw new Error('Checkpoint rejected');
        await base.put(...args); const doc = await d.docs.open(page); priorSV = Y.encodeStateVector(doc);
        if (kind === 'map') doc.getMap(PHOTO_MARKUP_MAP).delete('own');
        else { const text = ((doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlElement; (text.get(0) as Y.XmlText).delete(0, 1); }
        nextSV = Y.encodeStateVector(doc); d.docs.close(page); return;
      }
      await base.put(...args);
    } };
    const r = await importArchive(f.archive, deps(d, { journal })); expect(r.resumable).toBe(true);
    const doc = await d.docs.open(page); const c = capture(doc, `seal-${kind}`); expect(c.imported).toBe(0);
    if (kind !== 'put') expect([...nextSV!]).toEqual([...priorSV!]); if (kind === 'map') expect(doc.getMap(PHOTO_MARKUP_MAP).has('own')).toBe(false);
    const j = (await base.get(f.archive.key))!; expect(j.pages[sourcePage].done).toBeUndefined(); if (kind === 'put') expect(j.pages[sourcePage].commit).toBeUndefined(); else expect(j.pages[sourcePage].commit!.phase).toBe('planned');
    d.docs.close(page); await d.docs.flush(page); records.push({ case: 'seal', kind, result: r, journal: j }); save();
  }
});

it('confirmed + comments TX abortada conserva edición y borrado de mapa; recibo no reinserta', async () => {
  const observed = observeHandles();
  try {
  const server = new FakeServer(); server.enableImportedComments(); server.settings!.schemaVersion = ARCHIVE_COMMENTS_SCHEMA_VERSION; server.online = false; const name = `comments-${crypto.randomUUID()}`, d = await device(server, name), f = await fixture(false, true, false, d.remote.email);
  const observeComments = async (label: string) => { records.push({ commentsObservation: label, settings: server.settings, ready: d.comments.ready, commentsStatus: d.comments.status(), engineStatus: d.engine.getStatus(), rows: await d.commentsDb.getAll('outbox') }); save(); };
  await observeComments('before-abort');
  const base = diagnose(archiveJournal(d.db)); let plan: ImportCommit | undefined;
  const journal = { ...base, put: async (...args: Parameters<typeof base.put>) => { await base.put(...args); if (args[0].pages[sourcePage]?.commit?.phase === 'confirmed') plan = args[0].pages[sourcePage].commit; } };
  const original = IDBDatabase.prototype.transaction; let abortComments = true;
  const abort = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args) {
    const tx = original.apply(this, args);
    if (abortComments && tx.mode === 'readwrite' && Array.from(tx.objectStoreNames).includes('outbox')) {
      tx.addEventListener('abort', () => { records.push({ diagnostic: 'comments-real-abort-event', db: this.name, stores: [...tx.objectStoreNames], at: new Date().toISOString() }); save(); });
      queueMicrotask(() => tx.abort());
    }
    return tx;
  });
  const first = await importArchive(f.archive, deps(d, { journal, userEmail: d.remote.email })); expect(first.resumable).toBe(true); expect(plan!.phase).toBe('confirmed'); expect(plan!.commentsPlan.length).toBe(1); expect(await d.commentsDb.getAll('outbox')).toHaveLength(0);
  await observeComments('after-abort');
  abortComments = false; abort.mockRestore(); const page = (await base.get(f.archive.key))!.pages[sourcePage].pageId;
  const doc = await d.docs.open(page); await writeBlocks(d.docs, page, [{ type: 'paragraph', content: 'PROPIO_R1 + IMPORTADO_R1' }]); doc.getMap(PHOTO_MARKUP_MAP).set('removed', true); doc.getMap(PHOTO_MARKUP_MAP).delete('removed'); await d.docs.flush(page); const before = capture(doc, 'comments-own');
  const resumed = await importArchive(f.archive, deps(d, { userEmail: d.remote.email }), { resume: true }); expect(resumed.resumable).toBe(false); const after = capture(doc, 'comments-resumed'); expect(exactValue(after.n, before.n)).toBe(true);
  const imported = plan!.commentsPlan[0], receipt = await d.commentsDb.get('meta', `importReceipt2:${imported.id}`); expect(receipt).toMatchObject({ pageId: page, source: 'shotdocs', threadId: null });
  await observeComments('before-ACK');
  server.online = true; await d.engine.syncNow(); await d.comments.run();
  await observeComments('after-ACK');
  expect(await d.commentsDb.getAll('outbox')).toHaveLength(0);
  expect(imported.authorName).toBeNull();
  expect(server.comments.get(imported.id)?.author_id).toBe(d.remote.userId);
  await d.comments.edit(page, imported.id, 'Edición propia'); await d.comments.run(); await d.comments.remove(page, imported.id); await d.comments.run();
  await observeComments('after-edit-delete');
  await d.comments.importComments([{ ...imported, body: 'NO REINSERTAR', blockId: null }]); expect(await d.commentsDb.getAll('outbox')).toHaveLength(0); expect(await d.commentsDb.get('meta', `importReceipt2:${imported.id}`)).toEqual(receipt);
  await observeComments('after-reimport');
  records.push({ case: 'comments', first, resumed, receipt, normalizedBefore: hash(before.n), normalizedAfter: hash(after.n) }); save();
  await waitSaved(d, page);
  await closeAll(d, doc, page, observed);
  const fresh = await device(server, name);
  const freshDoc = await fresh.docs.open(page);
  const freshState = capture(freshDoc, 'comments-fresh-after-ACK');
  expect(exactValue(freshState.n, after.n)).toBe(true);
  expect(freshState.markup).toEqual(after.markup);
  expect(freshState.own).toBe(1);
  expect(freshState.imported).toBe(1);
  expect(await fresh.commentsDb.get('meta', `importReceipt2:${imported.id}`)).toEqual(receipt);
  expect(await fresh.commentsDb.getAll('outbox')).toHaveLength(0);
  await fresh.comments.importComments([{ ...imported, body: 'NO REINSERTAR', blockId: null }]);
  expect(await fresh.commentsDb.getAll('outbox')).toHaveLength(0);
  expect(await fresh.commentsDb.get('meta', `importReceipt2:${imported.id}`)).toEqual(receipt);
  await closeAll(fresh, freshDoc, page, observed);
  } finally { observed.restore(); }
});
