// @vitest-environment jsdom
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { serialize } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import * as Y from 'yjs';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { ARCHIVE_COMMENTS_SCHEMA_VERSION, type ImportedComment } from '../sync/comments';
import { MEDIA_SCHEMA_VERSION } from '../media/queue';
import { writeBlocks } from '../export/testProject';
import { folderSource } from '../export/zipReader';
import { SHARED_COLLAPSE_MAP } from '../ui/collapseEditor';
import { PHOTO_MARKUP_MAP } from '../media/markup';
import { importCoda, metaJournal, type CodaFolder, type ImportDeps } from './codaImport';
import { archiveJournal, importArchive, openArchive, type ArchiveImportDeps } from './shotdocsImport';
import { exactValue, normalizeImport } from './importCommit';

const output = process.env.LGA_IMPORT_QA_OUT, records: unknown[] = [];
const save = () => { if (output) writeFileSync(`${output}/RAW.json`, JSON.stringify(records, null, 2));
};
const hash = (v: Uint8Array) => createHash('sha256').update(v).digest('hex');
const devices = new Set<Device>(), held = new Map<Device, Map<string, Y.Doc>>();
const handles: IDBDatabase[] = [], transactions = new Set<IDBTransaction>();
let abortMeta: { name: string; aborts: number; commitsNeutralized: number; onAbort?: () => void } | undefined;
beforeAll(async () => {
  if (output) {
    writeFileSync(`${output}/worker-pid.json`, JSON.stringify({ pid: process.pid, argv: process.argv, execPath: process.execPath, cwd: process.cwd() }));
    const until = Date.now() + 45000;
    while (!existsSync(`${output}/worker-ack.json`)) { if (Date.now() > until) throw new Error('Worker ACK timeout');
    await new Promise(r => setTimeout(r, 25));
    }
  }
  vi.stubGlobal('Uint8Array', structuredClone(new Uint8Array([1, 2])).constructor);
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('File', NodeFile);
  vi.stubGlobal('fetch', () => { throw new Error('Red no autorizada');
  });
  window.matchMedia ??= ((media: string) => ({ matches: false, media, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })) as never;
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
  const open = IDBFactory.prototype.open, transaction = IDBDatabase.prototype.transaction;
  vi.spyOn(IDBFactory.prototype, 'open').mockImplementation(function (this: IDBFactory, ...args) { const r = open.apply(this, args);
  r.addEventListener('success', () => handles.push(r.result));
  return r;
  });
  vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args) { const tx = transaction.apply(this, args);
  transactions.add(tx);
  for (const event of ['complete', 'abort']) tx.addEventListener(event, () => transactions.delete(tx));
  if (abortMeta && this.name === abortMeta.name && tx.mode === 'readwrite' && [...tx.objectStoreNames].join() === 'meta') {
    const state = abortMeta;
    tx.commit = () => { state.commitsNeutralized++; };
    tx.addEventListener('abort', () => { state.aborts++; records.push({ case: 'strict-put-abort', db: this.name, stores: [...tx.objectStoreNames], error: tx.error?.name }); save(); state.onAbort?.(); });
    queueMicrotask(() => tx.abort());
  }
  return tx;
  });
}, 45000);
afterAll(() => { vi.restoreAllMocks();
vi.unstubAllGlobals();
save();
});
async function openDoc(d: Device, page: string) {
  const own = held.get(d) ?? new Map<string, Y.Doc>();
  held.set(d, own);
  if (!own.has(page)) own.set(page, await d.docs.open(page));
  return own.get(page)!;
}
async function closeOwn(d: Device) {
  d.offline.stop();
  await d.engine.stop();
  await d.docs.flush();
  for (const [page, doc] of held.get(d) ?? []) { const destroyed = new Promise<void>(resolve => doc.once('destroy', () => resolve()));
  d.docs.close(page);
  await destroyed;
  }
  held.delete(d);
  d.docs.dispose();
  await d.docs.flush();
  d.db.close();
  d.mediaDb.close();
  d.commentsDb.close();
  devices.delete(d);
  const until = Date.now() + 3000;
  while (transactions.size && Date.now() < until) await new Promise(r => setTimeout(r, 5));
  expect(transactions.size).toBe(0);
  for (const h of handles) { h.close();
  expect(() => h.transaction(h.objectStoreNames[0])).toThrow();
  }
  records.push({ closedHandles: handles.length, transactions: transactions.size });
  save();
}
afterEach(async () => { for (const d of [...devices]) await closeOwn(d);
});
async function device(server: FakeServer, name = crypto.randomUUID()) { const d = await makeDevice(server, name);
devices.add(d);
return d;
}
function snapshot(doc: Y.Doc, label: string) {
  const raw = Y.encodeStateAsUpdate(doc), normalized = normalizeImport(raw), decoded = Y.decodeUpdate(raw), clocks = Y.parseUpdateMeta(raw);
  const value = { label, xml: doc.getXmlFragment(CONTENT_FRAGMENT).toString(), collapse: doc.getMap(SHARED_COLLAPSE_MAP).toJSON(), markup: doc.getMap(PHOTO_MARKUP_MAP).toJSON(), rawSHA: hash(raw), normalizedSHA: hash(normalized), clocks: { from: [...clocks.from], to: [...clocks.to] }, ds: [...decoded.ds.clients] };
  if (output) { writeFileSync(`${output}/${label}-raw.bin`, raw);
  writeFileSync(`${output}/${label}-N.bin`, normalized);
  }
  records.push(value);
  save();
  return { ...value, normalized };
}
function codaFolder(mode = 'complete'): CodaFolder {
  const docId = crypto.randomUUID(), media = [{ url: 'https://codahosted.io/docs/DOC/blobs/bl-pic/abc', file: 'bl-pic.png' }];
  const image = '<span style="display: inline-block"><img data-coda-blob-id="bl-pic" data-coda-mime-type="image/png" src="https://codahosted.io/docs/DOC/blobs/bl-pic/abc" width="100"></span>';
  const files = new Map<string, string | Uint8Array>([['pages/a.html', '<p>CODA_A</p>'], ['pages/b.html', `<p>CODA_B</p>${image}`], ['media/bl-pic.png', new Uint8Array(1000).fill(1)]]);
  const thread = { comments: [{ authorEmail: 'external@test.invalid', authorName: 'Autor', commentUri: 'comments/i-one', createdAt: 1790000000, text: 'Nota externa' }], reference: { type: 'text', referenceBlockIds: ['old'], text: 'CODA_A' }, state: 'Active', threadUri: 'threads/one' };
  files.set('comments.json', JSON.stringify({ docId, pages: { a: [thread], b: [] } }));
  if (mode === 'missingHTML') files.delete('pages/a.html');
  if (mode === 'missingMedia') { files.set('pages/a.html', `<p>CODA_A</p>${image}`);
  files.delete('media/bl-pic.png');
  }
  if (mode === 'brokenComments') files.set('comments.json', '{broken');
  const pages = ['a', ...(mode === 'complete' ? ['b'] : [])].map((id, order) => ({ id, name: id, parentId: null, order, contentType: 'canvas', file: `${id}.html`, media: id === 'b' || mode === 'missingMedia' ? media : [] }));
  return { manifest: { doc: { id: docId, name: 'R1 Coda' }, pages }, has: p => files.has(p), paths: () => [...files.keys()],
    text: async p => { const value = files.get(p);
    if (typeof value !== 'string') throw new Error('Contenido ausente');
    return value;
    },
    file: async p => new Blob([files.get(p) as Uint8Array<ArrayBuffer>], { type: 'image/png' }), size: p => files.get(p)?.length ?? 0 };
}
async function enableDrive(d: Device, server: FakeServer) {
  server.settings = { ...server.settings!, mediaUrl: 'https://portero.test' };
  await d.media.configure(server.settings!.mediaUrl, MEDIA_SCHEMA_VERSION);
  expect(d.media.enabled).toBe(true);
}
const codaDeps = (d: Device): ImportDeps => ({ ...d, comments: d.comments, journal: metaJournal(d.db) });
const archiveDeps = (d: Device): ArchiveImportDeps => ({ ...d, comments: d.comments, schemaVersion: ARCHIVE_COMMENTS_SCHEMA_VERSION, journal: archiveJournal(d.db) });

it('Coda real: segunda página interrumpida, medio único, primera y comentarios estables en dos aperturas frías', async () => {
  const server = new FakeServer();
  server.enableMedia();
  server.enableImportedComments();
  server.online = false;
  const name = crypto.randomUUID(), folder = codaFolder(), d = await device(server, name), base = metaJournal(d.db);
  let own = false;
  const journal = { ...base, put: async (...args: Parameters<typeof base.put>) => {
    const a = args[0].pages.a;
    if (a && !a.commit && !own) { own = true;
    await writeBlocks(d.docs, a.pageId, [{ id: 'owned-a', type: 'paragraph', props: { script: true } as never, content: 'PROPIO_R1' }]);
    const doc = await openDoc(d, a.pageId);
    doc.getMap(SHARED_COLLAPSE_MAP).set('owned-a', true);
    doc.getMap(PHOTO_MARKUP_MAP).set('owned-a', { color: 'red', points: [1, 2] });
    await d.docs.flush(a.pageId);
    }
    if (args[0].pages.b?.commit?.phase === 'planned') throw new Error('Second checkpoint rejected');
    await base.put(...args);
  } };
  await enableDrive(d, server);
  const first = await importCoda(folder, { ...codaDeps(d), journal });
  expect(first.resumable).toBe(true);
  const pending = (await base.get(folder.manifest.doc.id))!;
  expect(pending.pages.a.done).toBe(true);
  expect(pending.pages.a.commit!.phase).toBe('confirmed');
  expect(pending.pages.b.commit).toBeUndefined();
  const original = snapshot(await openDoc(d, pending.pages.a.pageId), 'coda-first');
  expect(original.xml.match(/PROPIO_R1/g)).toHaveLength(1);
  expect(original.xml.match(/CODA_A/g)).toHaveLength(1);
  expect(exactValue(original.normalized, normalizeImport(pending.pages.a.commit!.targetUpdate))).toBe(true);
  const comment = pending.pages.a.commit!.commentsPlan[0];
  expect(comment.source).toBe('coda');
  expect(comment.blockId).toBeTruthy();
  expect(comment.createdAt).toBeTruthy();
  const mediaURLs = Object.values(pending.media).map(m => m.url);
  expect(new Set(mediaURLs).size).toBe(1);
  await closeOwn(d);
  const fresh = await device(server, name), resumed = await importCoda(folder, codaDeps(fresh), { resume: true });
  expect(resumed.resumable).toBe(false);
  expect(resumed.projectId).toBe(first.projectId);
  const firstCold = snapshot(await openDoc(fresh, pending.pages.a.pageId), 'coda-fresh1-a'), secondCold = snapshot(await openDoc(fresh, pending.pages.b.pageId), 'coda-fresh1-b');
  expect(exactValue(firstCold.normalized, original.normalized)).toBe(true);
  expect(firstCold.collapse).toEqual(original.collapse);
  expect(firstCold.markup).toEqual(original.markup);
  expect(secondCold.xml.match(/CODA_B/g)).toHaveLength(1);
  expect(secondCold.xml).toContain(mediaURLs[0]);
  const queued = await fresh.commentsDb.getAll('outbox');
  expect(queued.filter(e => e.op.kind === 'import')).toHaveLength(1);
  expect(queued[0].op).toMatchObject({ id: comment.id, at: comment.createdAt, blockId: comment.blockId });
  await closeOwn(fresh);
  const fresh2 = await device(server, name);
  expect(exactValue(snapshot(await openDoc(fresh2, pending.pages.a.pageId), 'coda-fresh2-a').normalized, original.normalized)).toBe(true);
  expect(exactValue(snapshot(await openDoc(fresh2, pending.pages.b.pageId), 'coda-fresh2-b').normalized, secondCold.normalized)).toBe(true);
  const copy = new Y.Doc();
  Y.applyUpdate(copy, original.normalized);
  const { audio: _audio, file: _file, video: _video, ...oldSpecs } = defaultBlockSpecs;
  const editor = BlockNoteEditor.create(withCollaboration({ schema: BlockNoteSchema.create({ blockSpecs: oldSpecs }), collaboration: { fragment: copy.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'old', color: '#000' } } })) as unknown as BlockNoteEditor;
  const host = document.createElement('div');
  document.body.append(host);
  editor.mount(host);
  try { expect(copy.getXmlFragment(CONTENT_FRAGMENT).toString()).toContain('PROPIO_R1');
  expect(copy.getXmlFragment(CONTENT_FRAGMENT).toString()).toContain('CODA_A');
  expect(copy.getMap(PHOTO_MARKUP_MAP).toJSON()).toEqual(original.markup);
  } finally { editor.unmount();
  host.remove();
  copy.destroy();
  }
  records.push({ case: 'coda-integral', first, resumed, pages: pending.pages, mediaURLs, comment, queued });
  save();
}, 30000);

it('Coda: faltantes de HTML, medio, comentarios ilegibles y cola ausente bloquean planificación', async () => {
  for (const mode of ['missingHTML', 'missingMedia', 'brokenComments', 'commentsOff']) {
    const server = new FakeServer();
    server.enableMedia();
    server.enableImportedComments();
    server.online = false;
    const d = await device(server), folder = codaFolder(mode);
    await enableDrive(d, server);
    const result = await importCoda(folder, { ...codaDeps(d), comments: mode === 'commentsOff' ? undefined : d.comments });
    expect(result.resumable).toBe(true);
    const journal = (await metaJournal(d.db).get(folder.manifest.doc.id))!;
    expect(journal.pages.a.commit).toBeUndefined();
    expect(journal.pages.a.done).not.toBe(true);
    const doc = snapshot(await openDoc(d, journal.pages.a.pageId), `readiness-${mode}`);
    expect(doc.xml).not.toContain('CODA_A');
    records.push({ case: 'readiness-coda', mode, result, journal });
    save();
    await closeOwn(d);
  }
}, 30000);

async function archiveFixture(mode: string, userEmail?: string) {
  const page = crypto.randomUUID(), files: Record<string, string> = { '_shotdocs/manifest.json': JSON.stringify({ format: 1, id: crypto.randomUUID(), title: 'R1', pages: [{ id: page, parent: null, order: 0, title: 'Page', json: '_shotdocs/pages/p.json', complete: mode !== 'incomplete' }] }) };
  const blocks = [{ id: 'archive-block', type: 'paragraph', props: { textColor: 'alien' }, content: 'ARCHIVE_TEXT' }];
  if (mode === 'missingMedia') blocks.push({ id: 'missing-image', type: 'image', props: { url: 'sdmedia://20000000-0000-4000-8000-000000000001' } as never, content: '' });
  files['_shotdocs/pages/p.json'] = JSON.stringify({ id: page, blocks });
  if (mode === 'oldSchema') files['_shotdocs/comments.json'] = JSON.stringify({ threads: [{ page, id: 'thread', block: null, comments: [{ id: 'comment', body: 'Comentario', author: 'Autor', createdAt: '2026-09-01T12:00:00Z', ...(userEmail ? { mine: true } : {}) }] }] });
  if (userEmail) {
    const salt = 'abcdef0123456789';
    const manifest = JSON.parse(files['_shotdocs/manifest.json']);
    manifest.exporter = { salt, hash: hash(new TextEncoder().encode(`shotdocs-author:${salt}:${userEmail.trim().toLowerCase()}`)) };
    files['_shotdocs/manifest.json'] = JSON.stringify(manifest);
  }
  const source = folderSource(Object.entries(files).map(([p, text]) => Object.assign(new NodeFile([text], p.split('/').pop()!), { webkitRelativePath: `R/${p}` }) as unknown as File));
  return { page, archive: await openArchive(source) };
}
it('Archive: adaptación intencional conserva texto; incomplete, medio ausente y schema viejo quedan pendientes', async () => {
  for (const mode of ['intentional', 'incomplete', 'missingMedia', 'oldSchema']) {
    const server = new FakeServer();
    server.enableComments();
    server.online = false;
    const d = await device(server), f = await archiveFixture(mode), base = archiveJournal(d.db);
    let page = '';
    const journal = { ...base, put: async (...args: Parameters<typeof base.put>) => { await base.put(...args);
    page = args[0].pages[f.page]?.pageId ?? page;
    } };
    const result = await importArchive(f.archive, { ...archiveDeps(d), journal, schemaVersion: mode === 'oldSchema' ? 5 : ARCHIVE_COMMENTS_SCHEMA_VERSION });
    const actual = snapshot(await openDoc(d, page), `readiness-archive-${mode}`);
    if (mode === 'intentional') { expect(result.resumable).toBe(false);
    expect(actual.xml.match(/ARCHIVE_TEXT/g)).toHaveLength(1);
    expect(result.problems.length).toBeGreaterThan(0);
    expect(await base.get(f.archive.key)).toBeUndefined();
    }
    else { expect(result.resumable).toBe(true);
    const pending = (await base.get(f.archive.key))!;
    expect(pending.pages[f.page].commit).toBeUndefined();
    expect(pending.pages[f.page].done).not.toBe(true);
    expect(actual.xml).not.toContain('ARCHIVE_TEXT');
    }
    records.push({ case: 'readiness-archive', mode, result });
    save();
    await closeOwn(d);
  }
}, 30000);

it('Legacy Coda y lector viejo: raw/proyecto/cuerpo preservados, coexistencia y malformed v2 no sobrescriben', async () => {
  const server = new FakeServer();
  server.enableMedia();
  server.online = false;
  const d = await device(server), folder = codaFolder('legacy'), project = await d.tree.createProject('Legacy'), page = await d.tree.create(null, 'Owned', project);
  await writeBlocks(d.docs, page, [{ type: 'paragraph', content: 'PROPIO_LEGACY' }]);
  const before = snapshot(await openDoc(d, page), 'legacy-before');
  const key = folder.manifest.doc.id, oldKey = `codaImport:${key}`, newKey = `codaImport2:${key}`, raw = { docId: key, projectId: project, projectName: 'Legacy', pages: { a: { pageId: page, written: 'weak', done: false } }, media: {} };
  await d.db.put('meta', raw, oldKey);
  await enableDrive(d, server);
  await expect(importCoda(folder, codaDeps(d), { resume: true })).rejects.toThrow('Import pending: legacy');
  const envelope = await d.db.get('meta', newKey);
  expect(envelope).toEqual({ recoveryVersion: 2, legacy: raw });
  expect(await d.db.get('meta', oldKey)).toBeUndefined();
  const oldReaderRaw = { ...raw, projectName: 'Created by old reader' };
  await d.db.put('meta', oldReaderRaw, oldKey);
  await expect(importCoda(folder, codaDeps(d), { resume: true })).rejects.toThrow('Import pending: namespaceConflict');
  expect(await d.db.get('meta', oldKey)).toEqual(oldReaderRaw);
  expect(await d.db.get('meta', newKey)).toEqual(envelope);
  expect(exactValue(snapshot(await openDoc(d, page), 'legacy-after').normalized, before.normalized)).toBe(true);
  const malformedKey = crypto.randomUUID(), malformed = { recoveryVersion: 2, docId: malformedKey, projectId: project, projectName: 'Malformed', pages: { a: { pageId: page, commit: null } }, media: [] };
  await d.db.put('meta', malformed, `codaImport2:${malformedKey}`);
  await expect(metaJournal(d.db).get(malformedKey)).rejects.toThrow('Import pending: invalid');
  expect(await d.db.get('meta', `codaImport2:${malformedKey}`)).toEqual(malformed);
  records.push({ case: 'legacy', raw, envelope, oldReaderRaw, malformed, project, page });
  save();
});

it('Journal: CAS y remove comparan también campos desconocidos; put abortado conserva raw durable', async () => {
  const server = new FakeServer();
  server.online = false;
  const d = await device(server), f = await archiveFixture('incomplete'), store = archiveJournal(d.db);
  await importArchive(f.archive, archiveDeps(d));
  const expected = (await store.get(f.archive.key))!;
  const metaKey = `shotdocsImport2:${f.archive.key}`;
  const concurrent = { ...expected, futureField: { durable: 'whole-value-CAS' } };
  await d.db.put('meta', concurrent, metaKey);
  await expect(store.put({ ...expected, projectName: 'Changed' }, expected)).rejects.toMatchObject({ reason: 'changed' });
  await expect(store.remove(f.archive.key, expected)).rejects.toMatchObject({ reason: 'changed' });
  expect(await d.db.get('meta', metaKey)).toEqual(concurrent);
  const current = (await store.get(f.archive.key))!;
  const durableBefore = serialize(concurrent);
  let sawAbort!: () => void;
  const abortEvent = new Promise<void>(resolve => { sawAbort = resolve; });
  const state = { name: d.db.name, aborts: 0, commitsNeutralized: 0, onAbort: sawAbort };
  abortMeta = state;
  try { await expect(store.put({ ...current, projectName: 'Aborted' }, current)).rejects.toMatchObject({ name: 'AbortError' }); }
  finally { abortMeta = undefined; }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('real abort event timeout')), 10000);
    abortEvent.then(() => { clearTimeout(timer); resolve(); }, error => { clearTimeout(timer); reject(error); });
  });
  expect(state.aborts).toBeGreaterThan(0);
  expect(await d.db.get('meta', metaKey)).toEqual(concurrent);
  expect(serialize(await d.db.get('meta', metaKey))).toEqual(durableBefore);
  records.push({ case: 'journal-abort-v8', before: [...durableBefore], after: [...serialize(await d.db.get('meta', metaKey))] }); save();
  await store.put({ ...current, projectName: 'Accepted' }, current);
  const accepted = (await store.get(f.archive.key))!;
  expect(accepted).toMatchObject({ projectName: 'Accepted', futureField: concurrent.futureField });
  await store.remove(f.archive.key, accepted);
  expect(await d.db.get('meta', metaKey)).toBeUndefined();
  records.push({ case: 'strict-CAS-remove', expected, concurrent, accepted, ...state });
  save();
});

it('Receipt de comentario Archive sobrevive ACK, edición, borrado y dos DB frías sin otra alta', async () => {
  const server = new FakeServer();
  server.enableImportedComments();
  server.settings!.schemaVersion = ARCHIVE_COMMENTS_SCHEMA_VERSION;
  server.online = false;
  const name = crypto.randomUUID(), d = await device(server, name);
  const f = await archiveFixture('oldSchema', d.remote.email);
  const base = archiveJournal(d.db);
  let imported: ImportedComment | undefined, page = '';
  const journal = { ...base, put: async (...args: Parameters<typeof base.put>) => {
    await base.put(...args);
    const entry = args[0].pages[f.page];
    if (entry?.commit?.phase === 'confirmed') { imported = entry.commit.commentsPlan[0]; page = entry.pageId; }
  } };
  const result = await importArchive(f.archive, { ...archiveDeps(d), journal, userEmail: d.remote.email });
  expect(result.resumable).toBe(false);
  expect(imported).toBeDefined();
  await openDoc(d, page);
  const receiptKey = `importReceipt2:${imported!.id}`;
  const receipt = await d.commentsDb.get('meta', receiptKey);
  expect(receipt).toMatchObject({ pageId: page, source: 'shotdocs', threadId: null });
  const beforeACK = await d.commentsDb.getAll('outbox');
  expect(beforeACK.filter(e => e.op.kind === 'import' && e.op.id === imported!.id)).toHaveLength(1);
  server.online = true;
  await d.engine.syncNow();
  await d.comments.run();
  expect(await d.commentsDb.getAll('outbox')).toHaveLength(0);
  expect(await d.commentsDb.get('meta', receiptKey)).toEqual(receipt);
  expect(imported!.authorName).toBeNull();
  expect(server.comments.get(imported!.id)?.author_id).toBe(d.remote.userId);
  records.push({ case: 'receipt-owner-before-edit', id: imported!.id, authorName: imported!.authorName, authorMatchesCurrent: server.comments.get(imported!.id)?.author_id === d.remote.userId }); save();
  await d.comments.edit(page, imported!.id, 'Edición del usuario');
  await d.comments.run();
  await d.comments.remove(page, imported!.id);
  await d.comments.run();
  const afterDelete = await d.commentsDb.getAll('outbox');
  records.push({ case: 'receipt-after-delete', rows: afterDelete }); save();
  expect(afterDelete).toHaveLength(0);
  expect(await d.commentsDb.get('meta', receiptKey)).toEqual(receipt);
  await closeOwn(d);
  for (const round of [1, 2]) {
    const fresh = await device(server, name);
    await fresh.comments.importComments([{ ...imported!, body: 'Texto externo cambiado', blockId: null }]);
    expect(await fresh.commentsDb.getAll('outbox')).toHaveLength(0);
    expect(await fresh.commentsDb.get('meta', receiptKey)).toEqual(receipt);
    for (const identity of [{ pageId: crypto.randomUUID() }, { source: 'coda' as const }, { threadId: crypto.randomUUID() }]) {
      await expect(fresh.comments.importComments([{ ...imported!, ...identity }])).rejects.toThrow('identity changed');
      expect(await fresh.commentsDb.getAll('outbox')).toHaveLength(0);
      expect(await fresh.commentsDb.get('meta', receiptKey)).toEqual(receipt);
    }
    records.push({ case: 'receipt-fresh', round, imported, receipt, beforeACK, afterDelete, settings: server.settings });
    save();
    await closeOwn(fresh);
  }
}, 30000);

it('Journal v2: records por realm y own campos, next rechazado y current durable íntegro', async () => {
  const server = new FakeServer();
  server.online = false;
  const d = await device(server), f = await archiveFixture('intentional'), store = archiveJournal(d.db);
  const journal = { ...store, put: async (...args: Parameters<typeof store.put>) => {
    if (args[0].pages[f.page]?.done === true) throw new Error('Retener checkpoint confirmed real');
    await store.put(...args);
  } };
  expect((await importArchive(f.archive, { ...archiveDeps(d), journal })).resumable).toBe(true);
  const seed = (await store.get(f.archive.key))!, metaKey = `shotdocsImport2:${f.archive.key}`;
  expect(seed.pages[f.page].commit!.phase).toBe('confirmed');
  const full = snapshot(await openDoc(d, seed.pages[f.page].pageId), 'matrix-seed');
  expect(exactValue(full.normalized, normalizeImport(seed.pages[f.page].commit!.targetUpdate))).toBe(true);
  const ForeignObject = runInNewContext('Object') as ObjectConstructor;
  expect(ForeignObject).not.toBe(Object);
  expect(ForeignObject.prototype).not.toBe(Object.prototype);
  const build = (mutate: (v: typeof seed) => void) => {
    const v = structuredClone(seed);
    mutate(v);
    return v;
  };
  const assign = (v: typeof seed, part: string, value: unknown) => {
    if (part === 'root') return Object.assign(value as object, v) as typeof seed;
    if (part === 'entry') v.pages[f.page] = value as typeof v.pages[string];
    else (v as unknown as Record<string, unknown>)[part] = value;
    return v;
  };
  {
    for (const make of [(v: object) => structuredClone(v), (v: object) => Object.assign(new ForeignObject(), v), (v: object) => Object.assign(Object.create(null), v)]) {
      for (const part of ['root', 'pages', 'media', 'entry']) {
        const next = build(() => {}), value = part === 'root' ? next : part === 'entry' ? next.pages[f.page] : next[part as 'pages' | 'media'];
        const current = (await store.get(f.archive.key))!;
        await store.put(assign(next, part, make(value)), current);
        expect(await store.get(f.archive.key)).toEqual(seed);
      }
    }
    for (const mutate of [
      (v: typeof seed) => { delete v.pages[f.page].commit; delete v.pages[f.page].done; },
      (v: typeof seed) => { delete v.pages[f.page].commit; v.pages[f.page].done = false as (typeof v.pages)[string]['done']; },
      (v: typeof seed) => { v.pages[f.page].commit!.phase = 'planned'; v.pages[f.page].done = false as (typeof v.pages)[string]['done']; },
      (v: typeof seed) => { v.pages[f.page].done = true; },
    ]) {
      const next = build(mutate), current = (await store.get(f.archive.key))!;
      await store.put(next, current);
      expect(await store.get(f.archive.key)).toEqual(next);
      await d.db.put('meta', seed, metaKey);
    }
    const cases: Array<{ label: string; next: typeof seed; currentInvalid: boolean }> = [];
    for (const field of ['commit', 'done', 'written', 'expected']) {
      const values = field === 'commit' ? [null, undefined, false, 0] : field === 'done' ? [null, undefined, 0, '', 'done'] : [undefined, null, 'weak'];
      for (const value of values) cases.push({ label: `${field}:${String(value)}`, next: build(v => Object.assign(v.pages[f.page], { [field]: value })), currentInvalid: true });
    }
    cases.push({ label: 'done:true-with-planned', next: build(v => { Object.assign(v.pages[f.page].commit!, { phase: 'planned' }); v.pages[f.page].done = true; }), currentInvalid: true });
    cases.push({ label: 'done:true-without-confirmed', next: build(v => { delete v.pages[f.page].commit; v.pages[f.page].done = true; }), currentInvalid: true });
    const mapObjectTag = new Map([['kept', 'value']]);
    Object.defineProperty(mapObjectTag, Symbol.toStringTag, { value: 'Object' });
    for (const part of ['root', 'pages', 'media', 'entry']) {
      for (const value of [[], new Map([['kept', 'value']]), new Date(1234), new DataView(new Uint8Array([1, 2]).buffer), mapObjectTag]) {
        cases.push({ label: `${part}:${Object.prototype.toString.call(value)}`, next: assign(build(() => {}), part, value), currentInvalid: true });
      }
      cases.push({ label: `${part}:custom-proto`, next: assign(build(() => {}), part, Object.assign(Object.create({ inherited: true }), part === 'root' ? seed : part === 'entry' ? seed.pages[f.page] : seed[part as 'pages' | 'media'])), currentInvalid: false });
    }
    for (const c of cases) {
      await d.db.put('meta', seed, metaKey);
      const expected = (await store.get(f.archive.key))!;
      expect(c.next.key).toBe(seed.key);
      await expect(store.put(c.next, expected)).rejects.toMatchObject({ reason: 'invalid' });
      expect(await d.db.get('meta', metaKey)).toEqual(seed);
      if (c.currentInvalid) {
        await d.db.put('meta', c.next, metaKey);
        const received = await d.db.get('meta', metaKey);
        if (output) writeFileSync(`${output}/matrix-${records.length}-received.bin`, serialize(received));
        await expect(store.get(f.archive.key)).rejects.toMatchObject({ reason: 'invalid' });
        expect(await d.db.get('meta', metaKey)).toStrictEqual(received);
        await expect(store.put(seed, expected)).rejects.toMatchObject({ reason: 'invalid' });
        expect(await d.db.get('meta', metaKey)).toStrictEqual(received);
        await expect(store.remove(f.archive.key, expected)).rejects.toMatchObject({ reason: 'invalid' });
        expect(await d.db.get('meta', metaKey)).toStrictEqual(received);
        expect(serialize(await d.db.get('meta', metaKey))).toEqual(serialize(received));
        if (output) writeFileSync(`${output}/matrix-${records.length}-preserved.bin`, serialize(await d.db.get('meta', metaKey)));
        records.push({ case: 'matrix-current-preserved', label: c.label, received });
      }
      save();
    }
    await d.db.put('meta', seed, metaKey);
    expect(exactValue(snapshot(await openDoc(d, seed.pages[f.page].pageId), 'matrix-after').normalized, full.normalized)).toBe(true);
  }
});