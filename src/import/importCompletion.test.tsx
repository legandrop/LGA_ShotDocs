// @vitest-environment jsdom
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
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
import { findResumable, importCoda, metaJournal, type CodaFolder, type ImportDeps, type ImportJournal } from './codaImport';
import { archiveJournal, findArchiveResumable, importArchive, openArchive, type ArchiveImportDeps, type ArchiveJournal } from './shotdocsImport';
import { closeCommit, exactValue, newImportReservation, normalizeImport, openCommit, type ImportCommit, type ImportEnvelope } from './importCommit';
import { activeJournal, hookableJournal } from './importTesting';

const hash = (v: Uint8Array) => createHash('sha256').update(v).digest('hex');
const devices = new Set<Device>(), held = new Map<Device, Map<string, Y.Doc>>();
const handles: IDBDatabase[] = [], transactions = new Set<IDBTransaction>();
let abortMeta: { name: string; aborts: number; commitsNeutralized: number; onAbort?: () => void } | undefined;
beforeAll(async () => {
  // En jsdom, lo que vuelve de IndexedDB es de otro contexto: se usa su `Uint8Array` para que los `instanceof` de
  // estas pruebas hablen del mismo tipo.
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
    tx.addEventListener('abort', () => { state.aborts++; state.onAbort?.(); });
    queueMicrotask(() => tx.abort());
  }
  return tx;
  });
}, 45000);
afterAll(() => { vi.restoreAllMocks();
vi.unstubAllGlobals();
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
  return { manifest: { doc: { id: docId, name: 'Doc de Coda' }, pages }, has: p => files.has(p), paths: () => [...files.keys()],
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

it('Coda: con la segunda página cortada, la primera queda terminada; al reabrir la app y seguir, la primera y su comentario no cambian, el archivo se guarda una sola vez y todo sigue igual al abrir otra vez', async () => {
  const server = new FakeServer();
  server.enableMedia();
  server.enableImportedComments();
  server.online = false;
  const name = crypto.randomUUID(), folder = codaFolder(), d = await device(server, name), base = hookableJournal(metaJournal(d.db));
  let own = false, planA: ImportCommit | undefined;
  const journal = { ...base, put: async (...args: Parameters<typeof base.put>) => {
    const a = args[0].pages.a;
    if (openCommit(a?.commit)?.phase === 'confirmed') planA = structuredClone(openCommit(a.commit));
    if (a && !a.commit && !own) { own = true;
    await writeBlocks(d.docs, a.pageId, [{ id: 'owned-a', type: 'paragraph', props: { script: true } as never, content: 'PROPIO' }]);
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
  // Terminada: del plan queda solo que se confirmó (sus bytes y sus comentarios ya no hacen falta).
  expect(pending.pages.a.commit).toEqual(closeCommit());
  expect(planA!.phase).toBe('confirmed');
  expect(pending.pages.b.commit).toBeUndefined();
  const original = snapshot(await openDoc(d, pending.pages.a.pageId), 'coda-first');
  expect(original.xml.match(/PROPIO/g)).toHaveLength(1);
  expect(original.xml.match(/CODA_A/g)).toHaveLength(1);
  expect(exactValue(original.normalized, normalizeImport(planA!.targetUpdate))).toBe(true);
  const comment = planA!.commentsPlan[0];
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
  try { expect(copy.getXmlFragment(CONTENT_FRAGMENT).toString()).toContain('PROPIO');
  expect(copy.getXmlFragment(CONTENT_FRAGMENT).toString()).toContain('CODA_A');
  expect(copy.getMap(PHOTO_MARKUP_MAP).toJSON()).toEqual(original.markup);
  } finally { editor.unmount();
  host.remove();
  copy.destroy();
  }

}, 30000);

it('Coda: lo que falta en la carpeta (HTML, un archivo, comentarios ilegibles o sin cola) se anota y la página entra', async () => {
  for (const mode of ['missingHTML', 'missingMedia', 'brokenComments', 'commentsOff']) {
    const server = new FakeServer();
    server.enableMedia();
    server.enableImportedComments();
    server.online = false;
    const d = await device(server), folder = codaFolder(mode);
    await enableDrive(d, server);
    const result = await importCoda(folder, { ...codaDeps(d), comments: mode === 'commentsOff' ? undefined : d.comments });
    expect(result.resumable).toBe(false);
    const journal = (await activeJournal(metaJournal(d.db), folder.manifest.doc.id))!;
    expect(journal.pages.a.commit!.phase).toBe('confirmed');
    expect(journal.pages.a.done).toBe(true);
    const doc = snapshot(await openDoc(d, journal.pages.a.pageId), `readiness-${mode}`);
    if (mode === 'missingHTML') {
      expect(doc.xml).not.toContain('CODA_A');
      expect(result.problems).toContain('a: the page was not exported');
    } else expect(doc.xml.match(/CODA_A/g)).toHaveLength(1);
    if (mode === 'missingMedia') {
      expect(result.problems).toEqual(['a: missing file bl-pic']);
      expect(doc.xml).not.toContain('sdmedia://');
    }
    if (mode === 'brokenComments') expect(result.problems).toEqual(["The comments.json in this folder can't be read: the comments were not imported."]);
    if (mode === 'commentsOff') expect(result.problems.join(' | ')).toContain("can't be saved");
    // Los comentarios que se pueden leer entran igual (sin su texto en la página, van a la página entera).
    const queued = (await d.commentsDb.getAll('outbox')).filter(e => e.op.kind === 'import');
    expect(queued).toHaveLength(mode === 'missingHTML' || mode === 'missingMedia' ? 1 : 0);
    expect(result.comments).toBe(queued.length);

    await closeOwn(d);
  }
}, 30000);

async function archiveFixture(mode: string, userEmail?: string) {
  const page = crypto.randomUUID(), files: Record<string, string> = { '_shotdocs/manifest.json': JSON.stringify({ format: 1, id: crypto.randomUUID(), title: 'Archivo', pages: [{ id: page, parent: null, order: 0, title: 'Page', json: '_shotdocs/pages/p.json', complete: mode !== 'incomplete' }] }) };
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
it('Archivo: un valor que el editor no acepta, una página exportada incompleta y un archivo que falta entran anotados; con la base sin migrar la página entra y sus comentarios esperan', async () => {
  for (const mode of ['intentional', 'incomplete', 'missingMedia', 'oldSchema']) {
    const server = new FakeServer();
    server.enableComments();
    server.online = false;
    const d = await device(server), f = await archiveFixture(mode), base = hookableJournal(archiveJournal(d.db));
    let page = '';
    const journal = { ...base, put: async (...args: Parameters<typeof base.put>) => { await base.put(...args);
    page = args[0].pages[f.page]?.pageId ?? page;
    } };
    const result = await importArchive(f.archive, { ...archiveDeps(d), journal, schemaVersion: mode === 'oldSchema' ? 5 : ARCHIVE_COMMENTS_SCHEMA_VERSION });
    const actual = snapshot(await openDoc(d, page), `readiness-archive-${mode}`);
    // En todos los casos el texto de la página entra, una sola vez.
    expect(actual.xml.match(/ARCHIVE_TEXT/g)).toHaveLength(1);
    expect(result.problems.length).toBeGreaterThan(0);
    if (mode === 'oldSchema') {
      // La página quedó escrita y confirmada; sus comentarios esperan a la base y la importación queda para seguir.
      expect(result.resumable).toBe(true);
      expect(result.comments).toBe(0);
      expect(result.problems.join(' | ')).toContain('database');
      const pending = (await base.get(f.archive.key))!;
      expect(pending.pages[f.page].commit!.phase).toBe('confirmed');
      expect(openCommit(pending.pages[f.page].commit)!.commentsPlan).toHaveLength(1);
      expect(pending.pages[f.page].done).not.toBe(true);
      expect(await d.commentsDb.getAll('outbox')).toHaveLength(0);
    } else {
      expect(result.resumable).toBe(false);
      expect(await base.get(f.archive.key)).toBeUndefined();
      const done = (await activeJournal(base, f.archive.key))!;
      expect(done.pages[f.page].commit!.phase).toBe('confirmed');
      expect(done.pages[f.page].done).toBe(true);
      if (mode === 'incomplete') expect(result.problems).toContain('Page: it may have been out of date on the device that exported it');
      if (mode === 'missingMedia') expect(result.problems.join(' | ')).toContain('was not in the archive');
    }

    await closeOwn(d);
  }
}, 30000);

it('Importación sin terminar cuyo proyecto ya no está (papelera): no se ofrece seguir y volver a importar empieza otro proyecto', async () => {
  // Las tres formas de volver a apretar Import: en otra sesión (reserva nueva), en la misma (la reserva de antes) y
  // la llamada sin opciones.
  for (const mode of ['otra sesión', 'misma reserva', 'sin opciones']) {
    const server = new FakeServer();
    const d = await device(server), f = await archiveFixture('intentional'), store = archiveJournal(d.db), key = f.archive.key;
    await d.engine.syncNow();
    const stored = async () => (await store.loadState!(key)).raw as ImportEnvelope<ArchiveJournal>;
    const offered = () => findArchiveResumable(f.archive, { tree: d.tree, journal: store });
    const reservation = newImportReservation(key, 'Reserva');
    const cut = { ...archiveDeps(d), docs: { open: async () => { throw new Error('corte'); }, close: d.docs.close.bind(d.docs), flush: d.docs.flush.bind(d.docs), isSaved: d.docs.isSaved.bind(d.docs) } };
    const first = await importArchive(f.archive, cut, { intent: 'initial', reservation });
    expect(first.resumable).toBe(true);
    await d.engine.syncNow();
    expect(await offered()).toMatchObject({ projectId: first.projectId });
    // Mientras el proyecto está, otro intento de Import no crea un segundo proyecto: hay que seguir o pedir uno nuevo.
    const projects = d.tree.projects().length;
    await expect(importArchive(f.archive, archiveDeps(d), { intent: 'initial', reservation: newImportReservation(key, 'Reserva') })).rejects.toMatchObject({ reason: 'changed' });
    await expect(importArchive(f.archive, archiveDeps(d))).rejects.toMatchObject({ reason: 'changed' });
    expect(d.tree.projects()).toHaveLength(projects);
    const before = structuredClone((await stored()).generations[reservation.generationId]);

    await d.tree.forgetProject(first.projectId);
    expect(d.tree.project(first.projectId)).toBeUndefined();
    expect(await offered()).toBeNull();
    const again = newImportReservation(key, 'Reserva');
    const options = mode === 'otra sesión' ? { intent: 'initial' as const, reservation: again } : mode === 'misma reserva' ? { intent: 'initial' as const, reservation } : {};
    const second = await importArchive(f.archive, archiveDeps(d), options);
    expect(second.resumable).toBe(false);
    expect(second.projectId).not.toBe(first.projectId);
    expect(d.tree.project(second.projectId)).toBeDefined();
    expect(d.tree.projects()).toHaveLength(projects);
    // Lo anterior quedó guardado como estaba; lo nuevo es otra generación, con otro proyecto.
    const after = await stored();
    expect(after.generations[reservation.generationId]).toEqual(before);
    expect(after.activeGenerationId).not.toBe(reservation.generationId);
    expect(after.generations[after.activeGenerationId]).toMatchObject({ phase: 'complete', reservation: { projectId: second.projectId } });
    const page = after.generations[after.activeGenerationId].journal!.pages[f.page].pageId;
    expect(snapshot(await openDoc(d, page), `trashed-${mode}`).xml.match(/ARCHIVE_TEXT/g)).toHaveLength(1);
    // Repetir la reserva de una importación que ya terminó nunca crea otro proyecto.
    if (mode === 'otra sesión') {
      await expect(importArchive(f.archive, archiveDeps(d), options)).rejects.toMatchObject({ reason: 'changed' });
      expect(d.tree.projects()).toHaveLength(projects);
    }
    await closeOwn(d);
  }
}, 30000);

/** Lo que la persona escribe en la página: un texto al principio del primer renglón. */
function typeInto(doc: Y.Doc, text: string) {
  const first = ((doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlElement;
  first.insert(0, [new Y.XmlText(text)]);
}

it('Archivo: un plan anotado que nunca llegó a la página se planifica de nuevo al seguir; nada se duplica ni se pisa', async () => {
  // `escribió`: la persona escribe en la página entre que se anota el plan y se aplica. `corte`: la app se cierra ahí.
  for (const mode of ['escribió', 'corte']) {
    const server = new FakeServer();
    server.enableImportedComments();
    server.settings!.schemaVersion = ARCHIVE_COMMENTS_SCHEMA_VERSION;
    server.online = false;
    const name = crypto.randomUUID(), d = await device(server, name);
    const f = await archiveFixture('oldSchema', d.remote.email), base = hookableJournal(archiveJournal(d.db));
    let page = '', hit = false;
    const journal = { ...base, put: async (...args: Parameters<typeof base.put>) => {
      await base.put(...args);
      const entry = args[0].pages[f.page];
      if (entry?.commit?.phase !== 'planned' || hit) return;
      hit = true;
      page = entry.pageId;
      if (mode === 'corte') throw new Error('corte');
      typeInto(await openDoc(d, page), 'ESCRITO_ANTES');
    } };
    const first = await importArchive(f.archive, { ...archiveDeps(d), journal, userEmail: d.remote.email });
    expect(first.resumable).toBe(true);
    expect((await activeJournal(base, f.archive.key))!.pages[f.page].commit!.phase).toBe('planned');
    expect(snapshot(await openDoc(d, page), `replan-${mode}-first`).xml).not.toContain('ARCHIVE_TEXT');
    expect(await d.commentsDb.getAll('outbox')).toHaveLength(0);
    await closeOwn(d);

    const fresh = await device(server, name), freshBase = hookableJournal(archiveJournal(fresh.db));
    let confirmed: ImportCommit | undefined;
    const watch = { ...freshBase, put: async (...args: Parameters<typeof freshBase.put>) => {
      const open = openCommit(args[0].pages[f.page]?.commit);
      if (open?.phase === 'confirmed') confirmed = structuredClone(open);
      await freshBase.put(...args);
    } };
    const resumed = await importArchive(f.archive, { ...archiveDeps(fresh), journal: watch, userEmail: fresh.remote.email }, { resume: true });
    expect(resumed.resumable).toBe(false);
    expect(resumed.projectId).toBe(first.projectId);
    expect(resumed.comments).toBe(1);
    const after = snapshot(await openDoc(fresh, page), `replan-${mode}-resumed`);
    expect(after.xml.match(/ARCHIVE_TEXT/g)).toHaveLength(1);
    if (mode === 'escribió') {
      expect(after.xml.match(/ESCRITO_ANTES/g)).toHaveLength(1);
      expect(after.xml.indexOf('ESCRITO_ANTES')).toBeLessThan(after.xml.indexOf('ARCHIVE_TEXT'));
      expect(resumed.problems).toContain('Page: it already had other text; the imported content went below');
    } else expect(resumed.problems.some(p => p.includes('Import pending'))).toBe(false);
    const done = (await activeJournal(archiveJournal(fresh.db), f.archive.key))!;
    expect(done.pages[f.page]).toMatchObject({ done: true, commit: closeCommit() });
    expect(exactValue(after.normalized, normalizeImport(confirmed!.targetUpdate))).toBe(true);
    expect((await fresh.commentsDb.getAll('outbox')).filter(e => e.op.kind === 'import')).toHaveLength(1);
    await closeOwn(fresh);
  }
}, 30000);

it('Archivo: un plan que sí llegó a la página y no se alcanzó a confirmar vale como aplicado aunque después se edite', async () => {
  const server = new FakeServer();
  server.online = false;
  const d = await device(server), f = await archiveFixture('intentional'), base = hookableJournal(archiveJournal(d.db));
  let page = '', hit = false;
  const journal = { ...base, put: async (...args: Parameters<typeof base.put>) => {
    const entry = args[0].pages[f.page];
    if (entry?.commit?.phase === 'confirmed' && !hit) { hit = true; page = entry.pageId; throw new Error('corte'); }
    await base.put(...args);
  } };
  const first = await importArchive(f.archive, { ...archiveDeps(d), journal });
  expect(first.resumable).toBe(true);
  expect((await activeJournal(base, f.archive.key))!.pages[f.page].commit!.phase).toBe('planned');
  const doc = await openDoc(d, page);
  expect(doc.getXmlFragment(CONTENT_FRAGMENT).toString().match(/ARCHIVE_TEXT/g)).toHaveLength(1);
  typeInto(doc, 'EDITADO_DESPUES');
  doc.getMap(PHOTO_MARKUP_MAP).set('propio', { color: 'red', points: [1, 2] });
  await d.docs.flush(page);
  const before = snapshot(doc, 'applied-edited-before');
  const resumed = await importArchive(f.archive, archiveDeps(d), { resume: true });
  expect(resumed.resumable).toBe(false);
  expect(resumed.problems.some(p => p.includes('Import pending'))).toBe(false);
  const after = snapshot(doc, 'applied-edited-after');
  expect(exactValue(after.normalized, before.normalized)).toBe(true);
  expect(after.xml.match(/ARCHIVE_TEXT/g)).toHaveLength(1);
  expect(after.xml.match(/EDITADO_DESPUES/g)).toHaveLength(1);
  expect((await activeJournal(base, f.archive.key))!.pages[f.page]).toMatchObject({ done: true, commit: { phase: 'confirmed' } });
});

it('Coda: un plan anotado que nunca llegó a la página se planifica de nuevo al seguir, con lo escrito arriba y el comentario una vez', async () => {
  const server = new FakeServer();
  server.enableMedia();
  server.enableImportedComments();
  server.online = false;
  const d = await device(server), folder = codaFolder(), base = hookableJournal(metaJournal(d.db));
  let page = '', hit = false;
  const journal = { ...base, put: async (...args: Parameters<typeof base.put>) => {
    await base.put(...args);
    const entry = args[0].pages.a;
    if (entry?.commit?.phase !== 'planned' || hit) return;
    hit = true;
    page = entry.pageId;
    typeInto(await openDoc(d, page), 'ESCRITO_ANTES');
  } };
  await enableDrive(d, server);
  const first = await importCoda(folder, { ...codaDeps(d), journal });
  expect(first.resumable).toBe(true);
  expect(snapshot(await openDoc(d, page), 'coda-replan-first').xml).not.toContain('CODA_A');
  const resumed = await importCoda(folder, codaDeps(d), { resume: true });
  expect(resumed.resumable).toBe(false);
  expect(resumed.problems).toEqual(['a: was edited after the import stopped: your text stays and the import went below it']);
  const after = snapshot(await openDoc(d, page), 'coda-replan-resumed');
  expect(after.xml.match(/CODA_A/g)).toHaveLength(1);
  expect(after.xml.match(/ESCRITO_ANTES/g)).toHaveLength(1);
  expect(after.xml.indexOf('ESCRITO_ANTES')).toBeLessThan(after.xml.indexOf('CODA_A'));
  expect((await activeJournal(base, folder.manifest.doc.id))!.pages.a).toMatchObject({ done: true, commit: { phase: 'confirmed' } });
  expect((await d.commentsDb.getAll('outbox')).filter(e => e.op.kind === 'import')).toHaveLength(1);
}, 30000);

it('Archivo, todo o nada por página (D305): con un archivo sin guardar la página no se escribe; lo que la persona escribió queda y al seguir lo importado entra entero debajo', async () => {
  const server = new FakeServer();
  server.enableMedia();
  server.online = false;
  const d = await device(server);
  await enableDrive(d, server);
  const page = crypto.randomUUID(), other = crypto.randomUUID(), fileId = '20000000-0000-4000-8000-000000000009';
  const entry = (id: string, order: number, title: string) => ({ id, parent: null, order, title, json: `_shotdocs/pages/${order}.json`, complete: true });
  const files: Record<string, string> = {
    '_shotdocs/manifest.json': JSON.stringify({ format: 1, id: crypto.randomUUID(), title: 'Archivo', pages: [entry(page, 0, 'Con foto'), entry(other, 1, 'Sin foto')],
      files: [{ id: fileId, name: 'foto.png', mime: 'image/png', kind: 'image', size: 600, original: 'files/foto.png', view: null }] }),
    '_shotdocs/pages/0.json': JSON.stringify({ id: page, blocks: [{ id: 'texto', type: 'paragraph', content: 'ARCHIVE_TEXT' }, { id: 'foto', type: 'image', props: { url: `sdmedia://${fileId}`, name: 'foto.png' } }] }),
    '_shotdocs/pages/1.json': JSON.stringify({ id: other, blocks: [{ id: 'otra', type: 'paragraph', content: 'OTRA_PAGINA' }] }),
    'files/foto.png': 'P'.repeat(600),
  };
  const archive = await openArchive(folderSource(Object.entries(files).map(([path, text]) => Object.assign(new NodeFile([text], path.split('/').pop()!), { webkitRelativePath: `R/${path}` }) as unknown as File)));
  let fail = true;
  const media = { get enabled() { return d.media.enabled; }, add: async (...args: Parameters<typeof d.media.add>) => {
    if (fail) throw new Error('No space left on this device.');
    return d.media.add(...args);
  } };
  const first = await importArchive(archive, { ...archiveDeps(d), media });
  expect(first.resumable).toBe(true);
  // El resumen cuenta las páginas que entraron, no las del archivo.
  expect(first.pages).toBe(1);
  expect(first.problems).toEqual(['Con foto: foto.png: No space left on this device.']);
  const pending = (await activeJournal(archiveJournal(d.db), archive.key))!;
  const pageId = pending.pages[page].pageId;
  expect(pending.pages[page].commit).toBeUndefined();
  expect(pending.pages[other]).toMatchObject({ done: true, commit: { phase: 'confirmed' } });
  const doc = await openDoc(d, pageId);
  expect(doc.getXmlFragment(CONTENT_FRAGMENT).toString()).not.toContain('ARCHIVE_TEXT');
  await writeBlocks(d.docs, pageId, [{ type: 'paragraph', content: 'ESCRITO_POR_LA_PERSONA' }]);

  fail = false;
  const resumed = await importArchive(archive, { ...archiveDeps(d), media }, { resume: true });
  expect(resumed.resumable).toBe(false);
  expect(resumed.pages).toBe(2);
  expect(resumed.files).toBe(1);
  expect(resumed.problems).toEqual(['Con foto: it already had other text; the imported content went below']);
  const after = snapshot(doc, 'd305-archive-resumed');
  expect(after.xml.match(/ESCRITO_POR_LA_PERSONA/g)).toHaveLength(1);
  expect(after.xml.match(/ARCHIVE_TEXT/g)).toHaveLength(1);
  expect(after.xml.match(/sdmedia:\/\//g)).toHaveLength(1);
  expect(after.xml).not.toContain(fileId);
  expect(after.xml.indexOf('ESCRITO_POR_LA_PERSONA')).toBeLessThan(after.xml.indexOf('ARCHIVE_TEXT'));
  expect(snapshot(await openDoc(d, pending.pages[other].pageId), 'd305-archive-other').xml.match(/OTRA_PAGINA/g)).toHaveLength(1);
  expect(await d.mediaDb.getAll('files')).toHaveLength(1);
}, 30000);

it('Coda: un archivo vacío no se va a poder guardar nunca: se anota y la página entra con su texto y lo demás; sin lugar, en cambio, espera', async () => {
  const server = new FakeServer();
  server.enableMedia();
  server.online = false;
  const d = await device(server);
  await enableDrive(d, server);
  const picture = (blob: string) => `<span style="display: inline-block"><img data-coda-blob-id="${blob}" data-coda-mime-type="image/png" src="https://codahosted.io/docs/DOC/blobs/${blob}/abc" width="100"></span>`;
  const files = new Map<string, string | Uint8Array>([['pages/a.html', `<p>CODA_A</p>${picture('bl-vacia')}${picture('bl-buena')}`], ['media/bl-vacia.png', new Uint8Array(0)], ['media/bl-buena.png', new Uint8Array(900).fill(7)]]);
  const media = ['bl-vacia', 'bl-buena'].map(blob => ({ url: `https://codahosted.io/docs/DOC/blobs/${blob}/abc`, file: `${blob}.png` }));
  const folder: CodaFolder = { manifest: { doc: { id: crypto.randomUUID(), name: 'Vacío' }, pages: [{ id: 'a', name: 'a', parentId: null, order: 0, contentType: 'canvas', file: 'a.html', media }] },
    has: p => files.has(p), paths: () => [...files.keys()], text: async p => files.get(p) as string,
    file: async p => new Blob([files.get(p) as Uint8Array<ArrayBuffer>], { type: 'image/png' }), size: p => files.get(p)?.length ?? 0 };
  // Primero sin lugar para el otro archivo: eso sí se puede reintentar, y la página espera sin escribirse.
  let room = false;
  const tight = { get enabled() { return d.media.enabled; }, add: async (...args: Parameters<typeof d.media.add>) => {
    if (!room && args[1].size > 0) throw new Error('No space left on this device.');
    return d.media.add(...args);
  } };
  const waiting = await importCoda(folder, { ...codaDeps(d), media: tight });
  expect(waiting.resumable).toBe(true);
  expect(waiting.pages).toBe(0);
  expect(waiting.problems).toEqual(['a: bl-vacia.png: This file is empty.', 'a: bl-buena.png: No space left on this device.']);
  const pageId = (await activeJournal(metaJournal(d.db), folder.manifest.doc.id))!.pages.a.pageId;
  expect((await openDoc(d, pageId)).getXmlFragment(CONTENT_FRAGMENT).toString()).not.toContain('CODA_A');
  // Con lugar: el archivo vacío sigue sin poder guardarse, y eso ya no frena la página.
  room = true;
  const result = await importCoda(folder, { ...codaDeps(d), media: tight }, { resume: true });
  expect(result).toMatchObject({ resumable: false, pages: 1, files: 1 });
  expect(result.problems).toEqual(['a: bl-vacia.png: This file is empty.']);
  const xml = snapshot(await openDoc(d, pageId), 'coda-empty-file').xml;
  expect(xml.match(/CODA_A/g)).toHaveLength(1);
  expect(xml.match(/sdmedia:\/\//g)).toHaveLength(1);
  expect(await d.mediaDb.getAll('files')).toHaveLength(1);
  // Y de entrada, en un dispositivo limpio, entra de una sola pasada.
  const other = await device(server);
  await enableDrive(other, server);
  const direct = await importCoda(folder, codaDeps(other));
  expect(direct).toMatchObject({ resumable: false, pages: 1, files: 1, problems: ['a: bl-vacia.png: This file is empty.'] });
}, 30000);

it.each(['coda', 'archive'] as const)('%s: si el guardado del registro falla al crear una página, la página no se crea dos veces y la importación no termina como si nada', async kind => {
  // `una vez`: falla solo el primer guardado que anota una página. `siempre`: fallan todos los que anotan páginas.
  for (const mode of ['una vez', 'siempre']) {
    const server = new FakeServer();
    server.enableMedia();
    server.online = false;
    const d = await device(server);
    await enableDrive(d, server);
    const folder = codaFolder('missingHTML'), f = await archiveFixture('intentional');
    const base = hookableJournal<ImportJournal | ArchiveJournal>((kind === 'coda' ? metaJournal(d.db) : archiveJournal(d.db)) as never);
    let failed = 0;
    const journal = { ...base, put: async (...args: Parameters<typeof base.put>) => {
      if (Object.keys(args[0].pages).length && (mode === 'siempre' || !failed)) { failed++; throw new Error('el registro no se pudo guardar'); }
      await base.put(...args);
    } };
    const result = kind === 'coda' ? await importCoda(folder, { ...codaDeps(d), journal: journal as never }) : await importArchive(f.archive, { ...archiveDeps(d), journal: journal as never });
    expect(failed).toBeGreaterThan(0);
    // Una sola página en el proyecto: la que se creó, no otra más por haberla olvidado.
    expect(d.tree.roots(result.projectId)).toHaveLength(1);
    if (mode === 'una vez') {
      // El alta que no se pudo anotar entró con el guardado siguiente: quedó todo, y en el registro también.
      expect(result).toMatchObject({ resumable: false, pages: 1 });
      const stored = (await activeJournal(base, kind === 'coda' ? folder.manifest.doc.id : f.archive.key))!;
      expect(Object.values(stored.pages)).toEqual([expect.objectContaining({ pageId: d.tree.roots(result.projectId)[0].id, done: true })]);
    } else {
      // No se pudo anotar nada: queda para seguir y lo dice.
      expect(result).toMatchObject({ resumable: true, pages: 0 });
      expect(result.problems.join(' | ')).toContain('el registro no se pudo guardar');
    }
    await closeOwn(d);
  }
}, 30000);

it('Un nombre de proyecto largo que al cortarse termina en un espacio se importa igual', async () => {
  const server = new FakeServer();
  server.online = false;
  const d = await device(server), f = await archiveFixture('intentional');
  const result = await importArchive(f.archive, archiveDeps(d), { projectName: `${'x'.repeat(199)} cola que no entra` });
  expect(result).toMatchObject({ resumable: false, pages: 1 });
  expect(d.tree.project(result.projectId)?.name).toBe('x'.repeat(199));
  expect(d.tree.projects().filter(p => p.name.startsWith('xxx'))).toHaveLength(1);
});

it('Registro de una versión anterior (D304): no bloquea ni se ofrece seguir; Import crea otro proyecto y el registro queda archivado tal cual', async () => {
  const server = new FakeServer();
  server.enableMedia();
  server.online = false;
  const d = await device(server), folder = codaFolder('legacy'), project = await d.tree.createProject('Legacy'), page = await d.tree.create(null, 'Owned', project);
  await writeBlocks(d.docs, page, [{ type: 'paragraph', content: 'PROPIO_LEGACY' }]);
  const before = snapshot(await openDoc(d, page), 'legacy-before');
  const key = folder.manifest.doc.id, oldKey = `codaImport:${key}`, newKey = `codaImport2:${key}`, raw = { docId: key, projectId: project, projectName: 'Legacy', pages: { a: { pageId: page, written: 'weak', done: false } }, media: {} };
  await d.db.put('meta', raw, oldKey);
  const rawBytes = serialize(await d.db.get('meta', oldKey));
  await enableDrive(d, server);
  // Los registros archivados de esta fuente: cada uno en su clave, con su valor tal cual.
  const archived = async (prefix = 'codaImport', source = key) => {
    const out: { key: string; value: unknown; bytes: Buffer }[] = [];
    for (const k of (await d.db.getAllKeys('meta')).map(String).filter(k => k.startsWith(`${prefix}Earlier1:${source}:`)).sort()) {
      const value = await d.db.get('meta', k);
      out.push({ key: k, value, bytes: serialize(value) });
    }
    return out;
  };
  const offered = () => findResumable(folder, { tree: d.tree, journal: metaJournal(d.db) });

  // No se ofrece seguir; pedirlo igual no encuentra nada que seguir y no toca nada.
  expect(await offered()).toBeNull();
  await expect(importCoda(folder, codaDeps(d), { resume: true })).rejects.toMatchObject({ reason: 'changed' });
  expect(await d.db.get('meta', oldKey)).toEqual(raw);
  expect(await d.db.get('meta', newKey)).toBeUndefined();
  expect(await archived()).toEqual([]);

  // Import: un proyecto nuevo. El registro anterior pasa entero a su clave de archivo, sin convertirse.
  const first = await importCoda(folder, codaDeps(d));
  expect(first.resumable).toBe(false);
  expect(first.projectId).not.toBe(project);
  expect(await d.db.get('meta', oldKey)).toBeUndefined();
  const kept = await archived();
  expect(kept).toHaveLength(1);
  expect(kept[0].value).toEqual(raw);
  expect(kept[0].bytes.equals(rawBytes)).toBe(true);
  expect(d.tree.project(project)?.name).toBe('Legacy');
  expect(exactValue(snapshot(await openDoc(d, page), 'legacy-after-import').normalized, before.normalized)).toBe(true);

  // Una segunda importación no lo pisa ni suma otro.
  const second = await importCoda(folder, codaDeps(d));
  expect(second.projectId).not.toBe(first.projectId);
  expect(await archived()).toEqual(kept);

  // Una pestaña con la versión anterior vuelve a escribir su clave: vale el registro de esta versión, y el de ella se
  // archiva aparte en la próxima escritura.
  const oldReaderRaw = { ...raw, projectName: 'Created by old reader' };
  await d.db.put('meta', oldReaderRaw, oldKey);
  const current = await d.db.get('meta', newKey);
  expect((await metaJournal(d.db).loadState!(key)).raw).toEqual(current);
  expect(await offered()).toBeNull();
  expect(await d.db.get('meta', oldKey)).toEqual(oldReaderRaw);
  const third = await importCoda(folder, codaDeps(d));
  expect(third.resumable).toBe(false);
  expect(new Set([project, first.projectId, second.projectId, third.projectId]).size).toBe(4);
  expect(await d.db.get('meta', oldKey)).toBeUndefined();
  const both = await archived();
  expect(both).toHaveLength(2);
  expect(both.find(r => r.key === kept[0].key)).toEqual(kept[0]);
  expect(both.find(r => r.key !== kept[0].key)!.value).toEqual(oldReaderRaw);
  expect(exactValue(snapshot(await openDoc(d, page), 'legacy-after').normalized, before.normalized)).toBe(true);

  // Lo mismo con un archivo de Shot Docs, como lo llama el diálogo (Import, con su reserva).
  const f = await archiveFixture('intentional'), oldArchive = { key: f.archive.key, projectId: project, projectName: 'Legacy', pages: {}, media: {} };
  await d.db.put('meta', oldArchive, `shotdocsImport:${f.archive.key}`);
  const archiveBytes = serialize(await d.db.get('meta', `shotdocsImport:${f.archive.key}`));
  expect(await findArchiveResumable(f.archive, { tree: d.tree, journal: archiveJournal(d.db) })).toBeNull();
  const fromArchive = await importArchive(f.archive, archiveDeps(d), { intent: 'initial', reservation: newImportReservation(f.archive.key, 'Reserva') });
  expect(fromArchive.resumable).toBe(false);
  expect(fromArchive.projectId).not.toBe(project);
  expect(await d.db.get('meta', `shotdocsImport:${f.archive.key}`)).toBeUndefined();
  const keptArchive = await archived('shotdocsImport', f.archive.key);
  expect(keptArchive).toHaveLength(1);
  expect(keptArchive[0].bytes.equals(archiveBytes)).toBe(true);

  // El mismo registro anterior, ya pasado a la clave de esta versión y marcado como anterior: igual, se archiva tal cual.
  const marked = codaFolder('legacy'), markedKey = marked.manifest.doc.id, markedRaw = { recoveryVersion: 2, legacy: { ...raw, docId: markedKey } };
  await d.db.put('meta', markedRaw, `codaImport2:${markedKey}`);
  const markedBytes = serialize(await d.db.get('meta', `codaImport2:${markedKey}`));
  expect(await findResumable(marked, { tree: d.tree, journal: metaJournal(d.db) })).toBeNull();
  expect((await importCoda(marked, codaDeps(d))).resumable).toBe(false);
  const keptMarked = await archived('codaImport', markedKey);
  expect(keptMarked).toHaveLength(1);
  expect(keptMarked[0].bytes.equals(markedBytes)).toBe(true);

  // Un registro de esta versión que no se puede leer sigue rechazado, y queda como estaba.
  const malformedKey = crypto.randomUUID(), malformed = { recoveryVersion: 2, docId: malformedKey, projectId: project, projectName: 'Malformed', pages: { a: { pageId: page, commit: null } }, media: [] };
  await d.db.put('meta', malformed, `codaImport2:${malformedKey}`);
  await expect(metaJournal(d.db).get(malformedKey)).rejects.toThrow('Import pending: invalid');
  await expect(metaJournal(d.db).loadState!(malformedKey)).rejects.toMatchObject({ reason: 'invalid' });
  expect(await d.db.get('meta', `codaImport2:${malformedKey}`)).toEqual(malformed);

}, 30000);

it('El registro de un solo diario solo se reemplaza o se borra si sigue exactamente como se leyó (también en campos que esta versión no conoce); un guardado abortado lo deja byte a byte como estaba', async () => {
  const server = new FakeServer();
  server.online = false;
  const d = await device(server), f = await archiveFixture('incomplete'), store = archiveJournal(d.db);
  await importArchive(f.archive, archiveDeps(d));
  const metaKey = `shotdocsImport2:${f.archive.key}`;
  // El registro de un solo diario (sin generaciones), que es lo que prueba este CAS, se siembra con el de la importación.
  await d.db.put('meta', (await activeJournal(store, f.archive.key))!, metaKey);
  const expected = (await store.get(f.archive.key))!;
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
  await store.put({ ...current, projectName: 'Accepted' }, current);
  const accepted = (await store.get(f.archive.key))!;
  expect(accepted).toMatchObject({ projectName: 'Accepted', futureField: concurrent.futureField });
  await store.remove(f.archive.key, accepted);
  expect(await d.db.get('meta', metaKey)).toBeUndefined();

});

it('Un comentario importado de un archivo entra una sola vez: después de subir, de editarse y de borrarse, y al reabrir la app dos veces, volver a importarlo no lo suma de nuevo ni acepta que cambie de página, origen o hilo', async () => {
  const server = new FakeServer();
  server.enableImportedComments();
  server.settings!.schemaVersion = ARCHIVE_COMMENTS_SCHEMA_VERSION;
  server.online = false;
  const name = crypto.randomUUID(), d = await device(server, name);
  const f = await archiveFixture('oldSchema', d.remote.email);
  const base = hookableJournal(archiveJournal(d.db));
  let imported: ImportedComment | undefined, page = '';
  const journal = { ...base, put: async (...args: Parameters<typeof base.put>) => {
    await base.put(...args);
    const entry = args[0].pages[f.page];
    const open = openCommit(entry?.commit);
    if (open?.phase === 'confirmed') { imported = open.commentsPlan[0]; page = entry.pageId; }
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
  await d.comments.edit(page, imported!.id, 'Edición del usuario');
  await d.comments.run();
  await d.comments.remove(page, imported!.id);
  await d.comments.run();
  const afterDelete = await d.commentsDb.getAll('outbox');
  expect(afterDelete).toHaveLength(0);
  expect(await d.commentsDb.get('meta', receiptKey)).toEqual(receipt);
  await closeOwn(d);
  for (let round = 0; round < 2; round++) {
    const fresh = await device(server, name);
    await fresh.comments.importComments([{ ...imported!, body: 'Texto externo cambiado', blockId: null }]);
    expect(await fresh.commentsDb.getAll('outbox')).toHaveLength(0);
    expect(await fresh.commentsDb.get('meta', receiptKey)).toEqual(receipt);
    for (const identity of [{ pageId: crypto.randomUUID() }, { source: 'coda' as const }, { threadId: crypto.randomUUID() }]) {
      await expect(fresh.comments.importComments([{ ...imported!, ...identity }])).rejects.toThrow('no longer matches the page or thread');
      expect(await fresh.commentsDb.getAll('outbox')).toHaveLength(0);
      expect(await fresh.commentsDb.get('meta', receiptKey)).toEqual(receipt);
    }

    await closeOwn(fresh);
  }
}, 30000);

it('El registro de un solo diario acepta objetos de otro contexto y rechaza todo lo que no tiene la forma esperada, sin tocar lo guardado', async () => {
  const server = new FakeServer();
  server.online = false;
  const d = await device(server), f = await archiveFixture('intentional'), store = archiveJournal(d.db);
  const hooked = hookableJournal(store);
  const journal = { ...hooked, put: async (...args: Parameters<typeof hooked.put>) => {
    if (args[0].pages[f.page]?.done === true) throw new Error('Retener checkpoint confirmed real');
    await hooked.put(...args);
  } };
  expect((await importArchive(f.archive, { ...archiveDeps(d), journal })).resumable).toBe(true);
  const seed = (await hooked.get(f.archive.key))!, metaKey = `shotdocsImport2:${f.archive.key}`;
  // La matriz prueba el registro de un solo diario (sin generaciones): se siembra con el de la importación.
  await d.db.put('meta', seed, metaKey);
  expect(seed.pages[f.page].commit!.phase).toBe('confirmed');
  const full = snapshot(await openDoc(d, seed.pages[f.page].pageId), 'matrix-seed');
  expect(exactValue(full.normalized, normalizeImport(openCommit(seed.pages[f.page].commit)!.targetUpdate))).toBe(true);
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
        await expect(store.get(f.archive.key)).rejects.toMatchObject({ reason: 'invalid' });
        expect(await d.db.get('meta', metaKey)).toStrictEqual(received);
        await expect(store.put(seed, expected)).rejects.toMatchObject({ reason: 'invalid' });
        expect(await d.db.get('meta', metaKey)).toStrictEqual(received);
        await expect(store.remove(f.archive.key, expected)).rejects.toMatchObject({ reason: 'invalid' });
        expect(await d.db.get('meta', metaKey)).toStrictEqual(received);
        expect(serialize(await d.db.get('meta', metaKey))).toEqual(serialize(received));

      }
    }
    await d.db.put('meta', seed, metaKey);
    expect(exactValue(snapshot(await openDoc(d, seed.pages[f.page].pageId), 'matrix-after').normalized, full.normalized)).toBe(true);
  }
});