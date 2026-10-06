// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Buffer, Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { editorSchemaOptions } from '../ui/editorSchema';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { IDBObjectStore, IDBDatabase } from 'fake-indexeddb';
import type { IDBPDatabase } from 'idb';
import { metaJournal, importCoda, findResumable, type CodaFolder, type ImportJournal } from './codaImport';
import { archiveJournal, findArchiveResumable, openArchive, MANIFEST_PATH, type ShotDocsArchive } from './shotdocsImport';
import { folderSource } from '../export/zipReader';
import { newImportReservation, type ImportEnvelope, type ImportReservation, type GenerationStore } from './importCommit';
import { projectOwnerKey, projectReceiptKey } from '../sync/importIdentity';
import { importJobFor } from './importJob';
import { ImportCodaDialog } from '../ui/ImportCodaDialog';
import { ImportArchiveDialog } from '../ui/ImportArchiveDialog';
let services: Device;
vi.mock('../services', () => ({ useServices: () => ({ ...services, dbName: services.db.name, user: { email: 'local@example.test' } }), useSyncStatus: () => ({ schemaVersion: 999, online: false }) }));
vi.mock('../ui/project', () => ({ useSwitchProject: () => () => undefined }));
const devices: Device[] = []; const roots: Root[] = [];
const active = new Set<IDBTransaction>(); const nativeTransaction = IDBDatabase.prototype.transaction;
IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...args: Parameters<typeof nativeTransaction>) {
  const tx = nativeTransaction.apply(this, args);
  active.add(tx);
  const closed = () => active.delete(tx);
  tx.addEventListener('complete', closed, { once: true });
  tx.addEventListener('abort', closed, { once: true });
  return tx;
};
afterAll(() => {
  expect(active.size).toBe(0);
  IDBDatabase.prototype.transaction = nativeTransaction;
});
beforeAll(() => {
  vi.stubGlobal('Uint8Array', Object.getPrototypeOf(Buffer.prototype).constructor);
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('File', NodeFile);
  vi.stubGlobal('crypto', webcrypto);
  Object.defineProperty(HTMLInputElement.prototype, 'webkitdirectory', { value: true, configurable: true });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.restoreAllMocks();
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.docs.dispose();
    d.media.dispose();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  await vi.waitFor(() => expect(active.size).toBe(0));
});
async function device(server = new FakeServer(), name?: string) {
  server.enableMedia();
  server.enableComments();
  const d = await makeDevice(server, name, '0.206');
  devices.push(d);
  if (!name) await d.engine.syncNow(); else await d.media.configure(server.settings!.mediaUrl, server.settings!.schemaVersion);
  server.online = false;
  return d;
}
function png() {
  return new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' });
}
function folder(id = 'GEN-CODA', withMedia = false): CodaFolder {
  const url = 'https://codahosted.io/docs/GEN/blobs/bl-old/image';
  const html = '<p>Texto importado</p>' + (withMedia ? `<img src="${url}">` : '');
  const files = new Map([['pages/a.html', new Blob([html], { type: 'text/html' })]]);
  if (withMedia) files.set('media/bl-old.png', png());
  return { manifest: { doc: { id, name: 'Generation' }, pages: [{ id: 'a', name: 'A', parentId: null, order: 0, contentType: 'canvas', file: 'a.html', media: withMedia ? [{ url, file: 'bl-old.png' }] : [] }] }, has: p => files.has(p), paths: () => [...files.keys()], size: p => files.get(p)?.size ?? 0, text: async p => (await files.get(p)!.text()), file: async p => files.get(p)! };
}
async function archive(withMedia = false): Promise<ShotDocsArchive> {
  const page = crypto.randomUUID();
  const fileId = crypto.randomUUID();
  const photo = png();
  const manifest = { format: 1, id: crypto.randomUUID(), app: 'LGA Shot Docs', exportedAt: null, title: 'Archive', projectName: 'Archive', exporter: null, pages: [{ id: page, parent: null, order: 0, title: 'A', icon: null, settings: {}, templateId: null, json: '_shotdocs/pages/a.json', complete: true }], files: withMedia ? [{ id: fileId, name: 'old.png', mime: 'image/png', kind: 'image', size: photo.size, original: '_shotdocs/media/old.png', view: null }] : [] };
  const content = [{ type: 'text', text: 'Archivo importado', styles: {} }, ...(withMedia ? [{ type: 'photo', props: { url: `sdmedia://${fileId}`, name: 'old.png', w: 1 } }] : [])];
  const entries = new Map<string, string | Blob>([[MANIFEST_PATH, JSON.stringify(manifest)], ['_shotdocs/pages/a.json', JSON.stringify({ id: page, blocks: [{ id: crypto.randomUUID(), type: 'paragraph', content, children: [] }] })]]);
  if (withMedia) entries.set('_shotdocs/media/old.png', photo);
  return openArchive(folderSource([...entries].map(([path, value]) => {
    const f = new File([value], path, { type: value instanceof Blob ? value.type : 'application/json' });
    Object.defineProperty(f, 'webkitRelativePath', { value: `package/${path}` });
    return f;
  })));
}
function deps(d: Device) {
  return { tree: d.tree, docs: d.docs, media: d.media, comments: d.comments, journal: metaJournal(d.db) };
}
function initial(r: ImportReservation): ImportJournal {
  return { recoveryVersion: 2, docId: r.sourceKey, projectId: r.projectId, projectName: r.projectName, pages: {}, media: {} };
}
function envelope(raw: unknown) {
  return raw as ImportEnvelope<ImportJournal>;
}
async function dump(d: Device) {
  const result: Record<string, [IDBValidKey, unknown][]> = {};
  for (const [index, db] of [d.db, d.mediaDb, d.commentsDb].entries()) for (const name of db.objectStoreNames) {
    const tx = (db as IDBPDatabase).transaction(name, 'readonly');
    const label = `${index}:${name}`;
    result[label] = (await tx.store.getAllKeys()).map((key, i) => [key, i]);
    const values = await tx.store.getAll();
    for (let i = 0; i < values.length; i++) if (values[i] instanceof Blob) {
      const blob = values[i] as Blob;
      values[i] = { mime: blob.type, size: blob.size, bytes: [...new Uint8Array(await blob.arrayBuffer())] };
    }
    result[label].forEach((row, i) => {
      row[1] = values[i];
    });
    await tx.done;
  }
  return result;
}
function closeDevice(d: Device) {
  d.engine.stop();
  d.docs.dispose();
  d.media.dispose();
  d.db.close();
  d.mediaDb.close();
  d.commentsDb.close();
}
async function ownContent(d: Device, pageId: string) {
  const doc = await d.docs.open(pageId);
  const editor = BlockNoteEditor.create(withCollaboration({ ...editorSchemaOptions, collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'Local', color: '#888888' } } }));
  const host = document.createElement('div');
  document.body.append(host);
  try {
    editor.mount(host);
    editor.insertBlocks([{ type: 'paragraph', content: 'Nota propia conservada' }], editor.document.at(-1)!, 'after');
    expect(doc.getXmlFragment(CONTENT_FRAGMENT).toString()).toContain('Nota propia conservada');
    expect(doc.getXmlFragment(CONTENT_FRAGMENT).toString()).toContain('sdmedia://');
    await d.docs.flush(pageId);
    expect(d.docs.isSaved(pageId)).toBe(true);
  } finally {
    editor.unmount();
    host.remove();
    d.docs.close(pageId);
  }
  const commentId = await d.comments.add(pageId, null, 'Comentario propio conservado');
  expect(commentId).toBeTruthy();
}
function retainedRows(before: Awaited<ReturnType<typeof dump>>, after: Awaited<ReturnType<typeof dump>>, journalKey: string) {
  expect(before['0:docState'].length).toBeGreaterThan(0);
  expect(before['1:files'].length).toBeGreaterThan(0);
  expect((before['1:blobs'][0][1] as { bytes: number[] }).bytes.length).toBeGreaterThan(0);
  expect(before['2:outbox'].length).toBeGreaterThan(0);
  for (const [name, rows] of Object.entries(before)) for (const [key, value] of rows) {
    if (name !== '0:meta' || key !== journalKey) expect(after[name].find(row => JSON.stringify(row[0]) === JSON.stringify(key))?.[1]).toEqual(value);
  }
}
async function stableProducer(d: Device, r: ImportReservation) {
  return d.tree.createProject(r.projectName, { projectId: r.projectId, operationId: r.projectOperationId! });
}
function abortPut(key: string) {
  const original = IDBObjectStore.prototype.put;
  return vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, k) {
    const request = original.call(this, value, k);
    if (k === key) request.addEventListener('success', () => this.transaction.abort(), { once: true });
    return request;
  });
}

describe('el proyecto de cada importación y sus generaciones', () => {
  it('reservar la importación y crear su proyecto vuelven recién cuando la transacción terminó; si se aborta, no queda ninguna fila a medias', async () => {
    const d = await device();
    const store = metaJournal(d.db) as GenerationStore<ImportJournal>;
    const r = newImportReservation('ABORT', 'A');
    const before = await dump(d);
    const abort = abortPut('codaImport2:ABORT');
    await expect(store.reserveNew(await store.loadState('ABORT'), r)).rejects.toThrow();
    abort.mockRestore();
    expect(await dump(d)).toEqual(before);
    const s = await store.reserveNew(await store.loadState('ABORT'), r);
    const abortTree = abortPut(projectOwnerKey(r.projectId));
    const reserved = await dump(d);
    await expect(stableProducer(d, r)).rejects.toThrow();
    abortTree.mockRestore();
    expect(await dump(d)).toEqual(reserved);
    const abortReceipt = abortPut(projectReceiptKey(r.projectOperationId!));
    await expect(stableProducer(d, r)).rejects.toThrow();
    abortReceipt.mockRestore();
    expect(await dump(d)).toEqual(reserved);
    await stableProducer(d, r);
    const ready = await store.saveGeneration(s, r.generationId, initial(r));
    expect(envelope(ready.raw).generations[r.generationId].phase).toBe('ready');
    expect((await d.db.getAll('ops')).filter(q => q.opId === r.projectOperationId)).toHaveLength(1);
    expect(await d.db.get('meta', projectOwnerKey(r.projectId))).toEqual({ ownerVersion: 1, projectId: r.projectId, operationId: r.projectOperationId });
  });
  it('con un corte entre crear el proyecto y anotarlo, el reintento usa el mismo proyecto y la misma operación, sin duplicar, también al reabrir la app', async () => {
    const server = new FakeServer();
    const d = await device(server);
    const name = d.db.name;
    const r = newImportReservation('CUT', 'Generation');
    const load = vi.spyOn(d.tree, 'load').mockRejectedValueOnce(new Error('corte local'));
    await expect(importCoda(folder('CUT'), deps(d), { reservation: r })).rejects.toThrow('corte local');
    load.mockRestore();
    const raw = envelope((await metaJournal(d.db).loadState!('CUT')).raw);
    expect(raw.generations[r.generationId].phase).toBe('reserved');
    d.engine.stop();
    d.docs.dispose();
    d.media.dispose();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
    const fresh1 = await device(server, name);
    await importCoda(folder('CUT'), deps(fresh1), { reservation: r });
    const before = await dump(fresh1);
    fresh1.engine.stop();
    fresh1.docs.dispose();
    fresh1.media.dispose();
    fresh1.db.close();
    fresh1.mediaDb.close();
    fresh1.commentsDb.close();
    const fresh2 = await device(server, name);
    expect(await dump(fresh2)).toEqual(before);
    expect(fresh2.tree.project(r.projectId)?.name).toBe('Generation');
    expect((await fresh2.db.getAll('ops')).filter(q => q.opId === r.projectOperationId)).toHaveLength(1);
    expect(envelope((await metaJournal(fresh2.db).loadState!('CUT')).raw).generations[r.generationId].phase).toBe('complete');
  });
  it('después de subir el proyecto y de mandarlo a la papelera, su recibo y su dueño siguen guardados: otra fuente u otra operación no puede quedarse con ese proyecto', async () => {
    const server = new FakeServer();
    const d = await device(server);
    const first = newImportReservation('ONE', 'A');
    await stableProducer(d, first);
    server.online = true;
    await d.engine.syncNow();
    expect((await d.db.getAll('ops')).find(q => q.opId === first.projectOperationId)).toBeUndefined();
    const receipt = await d.db.get('meta', projectReceiptKey(first.projectOperationId!));
    await d.tree.forgetProject(first.projectId);
    const before = await dump(d);
    await expect(stableProducer(d, { ...newImportReservation('TWO', 'A'), projectId: first.projectId })).rejects.toThrow('changed');
    expect(await dump(d)).toEqual(before);
    await stableProducer(d, first);
    expect(await d.db.get('meta', projectReceiptKey(first.projectOperationId!))).toEqual(receipt);
    expect(await d.db.getAll('ops')).toHaveLength(0);
  });
  it.each(['opId', 'owner', 'name', 'future', 'partial', 'ownerOnly', 'ownerFuture', 'ownerMalformed', 'receiptMalformed'] as const)('un recibo de proyecto alterado (%s) se rechaza y lo guardado queda como estaba', async kind => {
    const d = await device();
    const r = newImportReservation('BAD', 'A');
    await stableProducer(d, r);
    const key = projectReceiptKey(r.projectOperationId!);
    const receipt = await d.db.get('meta', key) as Record<string, unknown>;
    if (kind === 'partial') await d.db.delete('meta', projectOwnerKey(r.projectId));
    else if (kind === 'ownerOnly') await d.db.delete('meta', key);
    else if (kind === 'owner' || kind === 'ownerFuture' || kind === 'ownerMalformed') await d.db.put('meta', kind === 'ownerMalformed' ? [] : { ownerVersion: kind === 'ownerFuture' ? 2 : 1, projectId: r.projectId, operationId: kind === 'owner' ? crypto.randomUUID() : r.projectOperationId }, projectOwnerKey(r.projectId));
    else await d.db.put('meta', kind === 'receiptMalformed' ? [] : { ...receipt, ...(kind === 'opId' ? { opId: crypto.randomUUID() } : kind === 'future' ? { receiptVersion: 2 } : { op: { kind: 'createProject', project: { id: r.projectId, name: 'Otro' } } }) }, key);
    const before = await dump(d);
    await expect(stableProducer(d, r)).rejects.toThrow('changed');
    expect(await dump(d)).toEqual(before);
    const store = metaJournal(d.db) as GenerationStore<ImportJournal>;
    const s = await store.reserveNew(await store.loadState('BAD'), r);
    const beforeSave = await dump(d);
    await expect(store.saveGeneration(s, r.generationId, initial(r))).rejects.toThrow('changed');
    expect(await dump(d)).toEqual(beforeSave);
  });
  it('dos reservas a la vez del mismo proyecto: gana una sola; y un proyecto que no nació de una importación nunca se puede reservar', async () => {
    const d = await device();
    const first = newImportReservation('SOURCE1', 'A');
    const second = { ...newImportReservation('SOURCE2', 'A'), projectId: first.projectId };
    const settled = await Promise.allSettled([stableProducer(d, first), stableProducer(d, second)]);
    expect(settled.filter(v => v.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter(v => v.status === 'rejected')).toHaveLength(1);
    const ops = (await d.db.getAll('ops')).filter(q => q.op.kind === 'createProject' && q.op.project.id === first.projectId);
    expect(ops).toHaveLength(1);
    const owner = await d.db.get('meta', projectOwnerKey(first.projectId)) as { operationId: string };
    expect(owner.operationId).toBe(ops[0].opId);
    const legacy = await d.tree.createProject('Legacy');
    const before = await dump(d);
    await expect(stableProducer(d, { ...newImportReservation('LEGACY', 'Legacy'), projectId: legacy })).rejects.toThrow('changed');
    expect(await dump(d)).toEqual(before);
    expect(await d.db.get('meta', projectOwnerKey(legacy))).toBeUndefined();
  });
  it('el registro solo se reemplaza si sigue exactamente como se leyó (valor entero y revisión); uno de una versión más nueva se rechaza y uno de una anterior no bloquea ni se toca al leer', async () => {
    const d = await device();
    const s = metaJournal(d.db) as GenerationStore<ImportJournal>;
    const empty = await s.loadState('CAS');
    const r = newImportReservation('CAS', 'A');
    const first = await s.reserveNew(empty, r);
    const saved = await dump(d);
    await expect(s.reserveNew(empty, newImportReservation('CAS', 'A'))).rejects.toThrow('changed');
    expect(await dump(d)).toEqual(saved);
    await d.db.put('meta', { ...envelope(first.raw), revision: 2 }, 'codaImport2:CAS');
    const changed = await dump(d);
    await expect(s.saveGeneration(first, r.generationId, initial(r))).rejects.toThrow('changed');
    expect(await dump(d)).toEqual(changed);
    await d.db.put('meta', { future: true, recoveryVersion: 9 }, 'codaImport2:FUTURE');
    const future = await dump(d);
    await expect(s.loadState('FUTURE')).rejects.toThrow();
    expect(await dump(d)).toEqual(future);
    // Un registro de una versión anterior no bloquea (D304): leer no lo toca, y con uno de esta versión vale ese.
    await d.db.put('meta', { legacy: { x: 1 }, recoveryVersion: 2 }, 'codaImport2:EARLIER');
    const earlier = await dump(d);
    expect((await s.loadState('EARLIER')).raw).toBeUndefined();
    expect(await dump(d)).toEqual(earlier);
    await d.db.put('meta', { untouched: true }, 'codaImport:CAS');
    const conflict = await dump(d);
    expect((await s.loadState('CAS')).raw).toEqual(await d.db.get('meta', 'codaImport2:CAS'));
    expect(await dump(d)).toEqual(conflict);
  });
  it('un registro de un solo diario cuyo proyecto existe pasa a ser una generación, sin inventarle recibo ni dueño, y al empezar otra importación queda guardada tal cual', async () => {
    const d = await device();
    const s = metaJournal(d.db) as GenerationStore<ImportJournal>;
    const projectId = await d.tree.createProject('Old');
    const old = { ...initial(newImportReservation('OLD', 'Old')), projectId };
    await d.db.put('meta', old, 'codaImport2:OLD');
    const gen = crypto.randomUUID();
    const adopted = await s.adoptV2(await s.loadState('OLD'), gen);
    expect(envelope(adopted.raw).generations[gen].journal).toEqual(old);
    expect(envelope(adopted.raw).generations[gen].reservation.projectOperationId).toBeNull();
    expect(await d.db.get('meta', projectOwnerKey(projectId))).toBeUndefined();
    const done = await s.completeGeneration(adopted, gen);
    const retained = structuredClone(envelope(done.raw).generations[gen]);
    const next = newImportReservation('OLD', 'New');
    const active = await s.reserveNew(done, next);
    expect(envelope(active.raw).generations[gen]).toEqual(retained);
    await expect(s.saveGeneration(active, gen, old)).rejects.toThrow('changed');
    expect((await s.readGeneration('OLD', gen))).toEqual(retained);
  });
  it('importar a un proyecto nuevo no toca nada del anterior: sus páginas con su contenido, lo colapsado, las anotaciones, los comentarios, los archivos y sus recibos', async () => {
    const server = new FakeServer();
    const d = await device(server);
    const f = folder();
    const url = 'https://codahosted.io/docs/GEN/blobs/bl-old/image';
    const png = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' });
    const text = '<p>Texto importado</p><img src="' + url + '">';
    const files = new Map([['pages/a.html', new Blob([text])], ['media/bl-old.png', png]]);
    f.manifest.pages[0].media = [{ url, file: 'bl-old.png' }];
    f.has = p => files.has(p);
    f.size = p => files.get(p)?.size ?? 0;
    f.paths = () => [...files.keys()];
    f.text = async p => files.get(p)!.text();
    f.file = async p => files.get(p)!;
    const result = await importCoda(f, deps(d));
    expect(result.files).toBe(1);
    expect(result.problems).toEqual([]);
    const s = metaJournal(d.db) as GenerationStore<ImportJournal>;
    const oldState = envelope((await s.loadState(f.manifest.doc.id)).raw);
    const old = structuredClone(oldState.generations[oldState.activeGenerationId]);
    const pageId = old.journal!.pages.a.pageId;
    const doc = await d.docs.open(pageId);
    const editor = BlockNoteEditor.create(withCollaboration({ ...editorSchemaOptions, collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'Local', color: '#888888' } } }));
    const host = document.createElement('div');
    document.body.append(host);
    try {
      editor.mount(host);
      editor.insertBlocks([{ type: 'paragraph', content: 'Nota propia conservada' }], editor.document.at(-1)!, 'after');
      expect(doc.getXmlFragment(CONTENT_FRAGMENT).toString()).toContain('Nota propia conservada');
      await d.docs.flush(pageId);
      expect(d.docs.isSaved(pageId)).toBe(true);
    } finally {
      editor.unmount();
      host.remove();
      d.docs.close(pageId);
    }
    const commentId = crypto.randomUUID();
    expect(await d.comments.importComments([{ id: commentId, pageId, blockId: null, threadId: null, body: 'Comentario propio conservado', createdAt: '2026-01-01T00:00:00.000Z', resolvedAt: null, source: 'coda', authorName: null, authorEmail: null }])).toBe(1);
    const before = await dump(d);
    const next = await importCoda(f, deps(d), { intent: 'new' });
    expect(next.projectId).not.toBe(result.projectId);
    const after = await dump(d);
    expect(before['0:docState'].length).toBeGreaterThan(0);
    expect(before['1:files'].length).toBeGreaterThan(0);
    expect((before['1:blobs'][0][1] as { bytes: number[] }).bytes.length).toBeGreaterThan(0);
    expect(before['2:outbox'].length).toBeGreaterThan(0);
    expect(Object.keys(old.journal!.media).length).toBeGreaterThan(0);
    for (const [name, rows] of Object.entries(before)) for (const [key, value] of rows) if (name !== '0:meta' || key !== 'codaImport2:GEN-CODA') expect(after[name].find(row => JSON.stringify(row[0]) === JSON.stringify(key))?.[1]).toEqual(value);
    expect(await s.readGeneration(f.manifest.doc.id, oldState.activeGenerationId)).toEqual(old);
    expect(await findResumable(f, { tree: d.tree, journal: s })).toBeNull();
    d.engine.stop();
    d.docs.dispose();
    d.media.dispose();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
    const fresh1 = await device(server, d.db.name);
    expect(await dump(fresh1)).toEqual(after);
    fresh1.engine.stop();
    fresh1.docs.dispose();
    fresh1.media.dispose();
    fresh1.db.close();
    fresh1.mediaDb.close();
    fresh1.commentsDb.close();
    const fresh2 = await device(server, d.db.name);
    expect(await dump(fresh2)).toEqual(after);
  });
});

describe('los dos diálogos, montados', () => {
  it.each(['coda', 'archive'] as const)('%s: Import, Resume e Import into a new project crean y siguen proyectos de verdad; el reintento y el doble clic no crean otro proyecto, tampoco si el diálogo se desmonta en el medio', async kind => {
    const server = new FakeServer();
    const d = await device(server);
    services = d;
    const job = importJobFor(d.tree);
    const f = folder(`UI-${kind}`, true);
    const a = await archive(true);
    const sourceKey = kind === 'coda' ? f.manifest.doc.id : a.key;
    const store = (kind === 'coda' ? metaJournal(d.db) : archiveJournal(d.db)) as GenerationStore<ImportJournal>;
    job.show(kind);
    job.set(kind === 'coda' ? { folder: f, name: 'Generation' } : { archive: a, name: 'Archive' });
    const mount = async () => {
      const host = document.createElement('div');
      document.body.append(host);
      const root = createRoot(host);
      roots.push(root);
      await act(async () => root.render(kind === 'coda' ? <ImportCodaDialog /> : <ImportArchiveDialog />));
      return { root, host };
    };
    const click = async (host: HTMLElement, text: string) => {
      const button = [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!;
      expect(button).toBeDefined();
      await act(async () => {
        button.click();
        button.click();
      });
    };
    const settle = async () => {
      await act(async () => {
        await vi.waitFor(() => expect(job.get().running).toBe(false), { timeout: 20000 });
      });
    };
    const load = vi.spyOn(d.tree, 'load').mockRejectedValueOnce(new Error('corte handler'));
    let view = await mount();
    await click(view.host, 'Import');
    await act(async () => view.root.unmount());
    roots.splice(roots.indexOf(view.root), 1);
    await settle();
    load.mockRestore();
    expect(job.get().error).toContain('corte handler');
    const reserved = envelope((await store.loadState(sourceKey)).raw);
    const reservation = reserved.generations[reserved.activeGenerationId].reservation;
    expect(reserved.generations[reserved.activeGenerationId].phase).toBe('reserved');
    view = await mount();
    // Después de un error el diálogo ofrece lo que quedó guardado: el reintento de esa misma importación es Resume.
    expect([...view.host.querySelectorAll('button')].map(b => b.textContent?.trim())).toEqual(expect.arrayContaining(['Resume', 'Import into a new project']));
    await click(view.host, 'Resume');
    await settle();
    expect(job.get().error).toBeNull();
    expect((await d.db.getAll('ops')).filter(q => q.opId === reservation.projectOperationId)).toHaveLength(1);
    const complete = envelope((await store.loadState(sourceKey)).raw);
    expect(complete.generations[reservation.generationId].phase).toBe('complete');
    const oldJournal = complete.generations[reservation.generationId].journal!;
    expect(Object.keys(oldJournal.media).length).toBeGreaterThan(0);
    const oldPage = Object.values(oldJournal.pages)[0].pageId;
    await ownContent(d, oldPage);
    const oldRows = await dump(d);
    const journalKey = `${kind === 'coda' ? 'codaImport2' : 'shotdocsImport2'}:${sourceKey}`;
    await act(async () => job.set(kind === 'coda' ? { result: null, resumable: null } : { archiveResult: null, archiveResumable: null }));
    await click(view.host, 'Import');
    await settle();
    expect(job.get().error).toBeNull();
    const repeated = envelope((await store.loadState(sourceKey)).raw);
    expect(repeated.activeGenerationId).not.toBe(reservation.generationId);
    expect(repeated.revision).toBeGreaterThan(complete.revision);
    expect(repeated.generations[repeated.activeGenerationId].phase).toBe('complete');
    expect(repeated.generations[repeated.activeGenerationId].reservation.projectId).not.toBe(reservation.projectId);
    expect(repeated.generations[repeated.activeGenerationId].reservation.projectOperationId).not.toBe(reservation.projectOperationId);
    expect(repeated.generations[reservation.generationId]).toEqual(complete.generations[reservation.generationId]);
    retainedRows(oldRows, await dump(d), journalKey);
    const r = newImportReservation(sourceKey, kind === 'coda' ? 'Generation' : 'Archive');
    await store.reserveNew(await store.loadState(sourceKey), r);
    const resumable = kind === 'coda' ? await findResumable(f, { tree: d.tree, journal: metaJournal(d.db) }) : await findArchiveResumable(a, { tree: d.tree, journal: archiveJournal(d.db) });
    await act(async () => {
      job.set(kind === 'coda' ? { result: null, resumable: resumable as never } : { archiveResult: null, archiveResumable: resumable as never });
    });
    const beforeGeneration = structuredClone(envelope((await store.loadState(sourceKey)).raw).generations[r.generationId]);
    await click(view.host, 'Import into a new project');
    await settle();
    expect(job.get().error).toBeNull();
    const newer = envelope((await store.loadState(sourceKey)).raw);
    expect(newer.activeGenerationId).not.toBe(r.generationId);
    expect(newer.generations[r.generationId]).toEqual(beforeGeneration);
    expect(newer.generations[reservation.generationId]).toEqual(complete.generations[reservation.generationId]);
    const pending = newImportReservation(sourceKey, kind === 'coda' ? 'Generation' : 'Archive');
    await store.reserveNew(await store.loadState(sourceKey), pending);
    const resumed = kind === 'coda' ? await findResumable(f, { tree: d.tree, journal: metaJournal(d.db) }) : await findArchiveResumable(a, { tree: d.tree, journal: archiveJournal(d.db) });
    await act(async () => job.set(kind === 'coda' ? { result: null, resumable: resumed as never } : { archiveResult: null, archiveResumable: resumed as never }));
    await click(view.host, 'Resume');
    await settle();
    expect(job.get().error).toBeNull();
    expect(envelope((await store.loadState(sourceKey)).raw).activeGenerationId).toBe(pending.generationId);
    const other = kind === 'coda' ? folder('UI-CHANGED') : await archive();
    await act(async () => job.set(kind === 'coda' ? { folder: other as CodaFolder, result: null, resumable: null } : { archive: other as ShotDocsArchive, archiveResult: null, archiveResumable: null }));
    await click(view.host, 'Import');
    await settle();
    expect(job.get().error).toBeNull();
    expect(envelope((await store.loadState(sourceKey)).raw).activeGenerationId).toBe(pending.generationId);
    const otherKey = kind === 'coda' ? (other as CodaFolder).manifest.doc.id : (other as ShotDocsArchive).key;
    const otherState = envelope((await store.loadState(otherKey)).raw);
    expect(otherState.generations[otherState.activeGenerationId].phase).toBe('complete');
    expect(otherState.generations[otherState.activeGenerationId].reservation.projectId).not.toBe(pending.projectId);
    const failedInput = kind === 'coda' ? folder('UI-INTENT') : await archive();
    const failedKey = kind === 'coda' ? (failedInput as CodaFolder).manifest.doc.id : (failedInput as ShotDocsArchive).key;
    const loader = () => kind === 'coda' ? findResumable(failedInput as CodaFolder, { tree: d.tree, journal: metaJournal(d.db) }) : findArchiveResumable(failedInput as ShotDocsArchive, { tree: d.tree, journal: archiveJournal(d.db) });
    const cutInitial = vi.spyOn(d.tree, 'load').mockRejectedValueOnce(new Error('corte antes de cambiar intención'));
    await act(async () => job.set(kind === 'coda' ? { folder: failedInput as CodaFolder, result: null, resumable: null } : { archive: failedInput as ShotDocsArchive, archiveResult: null, archiveResumable: null }));
    await click(view.host, 'Import');
    await settle();
    cutInitial.mockRestore();
    expect(job.get().error).toContain('corte antes de cambiar intención');
    const initialFailed = envelope((await store.loadState(failedKey)).raw);
    const oldId = initialFailed.activeGenerationId;
    const oldGeneration = structuredClone(initialFailed.generations[oldId]);
    const showPending = async () => {
      const value = await loader();
      await act(async () => job.set(kind === 'coda' ? { resumable: value as never } : { archiveResumable: value as never }));
    };
    await showPending();
    const cutNew = vi.spyOn(d.tree, 'load').mockRejectedValueOnce(new Error('corte de nueva intención'));
    await click(view.host, 'Import into a new project');
    await settle();
    cutNew.mockRestore();
    expect(job.get().error).toContain('corte de nueva intención');
    const newFailed = envelope((await store.loadState(failedKey)).raw);
    const newId = newFailed.activeGenerationId;
    const newReservation = newFailed.generations[newId].reservation;
    expect(newId).not.toBe(oldId);
    expect(newReservation.projectId).not.toBe(oldGeneration.reservation.projectId);
    expect(newReservation.projectOperationId).not.toBe(oldGeneration.reservation.projectOperationId);
    expect(newFailed.generations[oldId]).toEqual(oldGeneration);
    await showPending();
    await click(view.host, 'Import into a new project');
    await settle();
    expect(job.get().error).toBeNull();
    const retriedNew = envelope((await store.loadState(failedKey)).raw);
    expect(retriedNew.activeGenerationId).toBe(newId);
    expect(retriedNew.generations[newId].phase).toBe('complete');
    expect(retriedNew.generations[oldId]).toEqual(oldGeneration);
    expect((await d.db.getAll('ops')).filter(q => q.opId === newReservation.projectOperationId)).toHaveLength(1);
    const finalRows = await dump(d);
    retainedRows(oldRows, finalRows, journalKey);
    const dbName = d.db.name;
    closeDevice(d);
    const fresh1 = await device(server, dbName);
    expect(await dump(fresh1)).toEqual(finalRows);
    const freshDoc = await fresh1.docs.open(oldPage);
    expect(freshDoc.getXmlFragment(CONTENT_FRAGMENT).toString()).toContain('Nota propia conservada');
    expect(freshDoc.getXmlFragment(CONTENT_FRAGMENT).toString()).toContain('sdmedia://');
    fresh1.docs.close(oldPage);
    closeDevice(fresh1);
    const fresh2 = await device(server, dbName);
    expect(await dump(fresh2)).toEqual(finalRows);
  });
});
