// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { createHash } from 'node:crypto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as Y from 'yjs';
import { translate, type Key } from '../i18n';
import { prefs } from '../prefs';
import { ARCHIVE_COMMENTS_SCHEMA_VERSION } from '../sync/comments';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { writeBlocks } from '../export/testProject';
import { folderSource } from '../export/zipReader';
import { ImportArchiveDialog } from '../ui/ImportArchiveDialog';
import { ImportCodaDialog } from '../ui/ImportCodaDialog';
import { folderFromFiles, importCoda, metaJournal, type CodaFolder, type ImportDeps } from './codaImport';
import { ImportPending, newImportReservation, openCommit, type GenerationStore, type ImportEnvelope } from './importCommit';
import { importJobFor } from './importJob';
import { activeJournal, hookableJournal } from './importTesting';
import { archiveJournal, importArchive, openArchive, type ArchiveImportDeps, type ArchiveJournal, type ShotDocsArchive } from './shotdocsImport';

// Lo que la persona lee cuando una importación no puede seguir: en el diálogo (el error) y en la lista del final.
// Cada caso se arma por su recorrido (el corte, la otra pestaña, lo que la persona escribió), y lo que queda en la
// pantalla es siempre el texto del diccionario: nunca el mensaje interno de un error de la importación.

let services: Device;
vi.mock('../services', () => ({ useServices: () => ({ ...services, dbName: services.db.name, user: { email: 'local@example.test' } }), useSyncStatus: () => ({ schemaVersion: 999, online: false }) }));
vi.mock('../ui/project', () => ({ useSwitchProject: () => () => undefined }));

/** Los mensajes internos que no tienen que verse nunca. */
const RAW = /Import pending|ImportPending|namespaceConflict|durable receipt|identity changed|\[object /;
const en = (key: Key, params?: Record<string, string | number>) => translate('en', key, params);

const devices: Device[] = [];
const roots: Root[] = [];
beforeAll(() => {
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('File', NodeFile);
  Object.defineProperty(HTMLInputElement.prototype, 'webkitdirectory', { value: true, configurable: true });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia ??= ((media: string) => ({ matches: false, media, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })) as never;
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
});
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  act(() => prefs.set({ language: 'en' }));
  vi.restoreAllMocks();
  for (const d of devices.splice(0)) {
    d.offline.stop();
    await d.engine.stop();
    d.docs.dispose();
    await d.docs.flush();
    d.media.dispose();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
});

async function device() {
  const server = new FakeServer();
  server.enableMedia();
  server.enableImportedComments();
  server.settings!.schemaVersion = ARCHIVE_COMMENTS_SCHEMA_VERSION;
  const d = await makeDevice(server);
  devices.push(d);
  await d.engine.syncNow();
  server.online = false;
  return d;
}

const asFiles = (files: Record<string, string>) =>
  Object.entries(files).map(([path, text]) => Object.assign(new NodeFile([text], path.split('/').pop()!), { webkitRelativePath: `Carpeta/${path}` }) as unknown as File);

/** Los archivos de una carpeta de Coda con una página. */
function codaFiles(docId: string = crypto.randomUUID()) {
  return asFiles({
    'manifest.json': JSON.stringify({ doc: { id: docId, name: 'Doc' }, pages: [{ id: 'a', name: 'A', parentId: null, order: 0, contentType: 'canvas', file: 'a.html', media: [] }] }),
    'pages/a.html': '<p>CODA_TEXT</p>',
  });
}

/** Los archivos de un archivo de Shot Docs con una página (y, si se pide, un comentario de quien importa). */
function archiveFiles(userEmail?: string) {
  const page = crypto.randomUUID();
  const manifest: Record<string, unknown> = { format: 1, id: crypto.randomUUID(), title: 'Archivo', pages: [{ id: page, parent: null, order: 0, title: 'Page', json: '_shotdocs/pages/p.json', complete: true }] };
  const files: Record<string, string> = { '_shotdocs/pages/p.json': JSON.stringify({ id: page, blocks: [{ id: 'archive-block', type: 'paragraph', content: 'ARCHIVE_TEXT' }] }) };
  if (userEmail) {
    const salt = 'abcdef0123456789';
    manifest.exporter = { salt, hash: createHash('sha256').update(`shotdocs-author:${salt}:${userEmail.trim().toLowerCase()}`).digest('hex') };
    files['_shotdocs/comments.json'] = JSON.stringify({ threads: [{ page, id: 'thread', block: null, comments: [{ id: 'comment', mine: true, body: 'Comentario', author: 'Autor', createdAt: '2026-09-01T12:00:00Z' }] }] });
  }
  files['_shotdocs/manifest.json'] = JSON.stringify(manifest);
  return { page, files: asFiles(files) };
}

const docsOf = (d: Device, over: Partial<ArchiveImportDeps['docs']> = {}): ArchiveImportDeps['docs'] => ({
  open: d.docs.open.bind(d.docs), close: d.docs.close.bind(d.docs), flush: d.docs.flush.bind(d.docs), isSaved: d.docs.isSaved.bind(d.docs), ...over,
});
const archiveDeps = (d: Device, over: Partial<ArchiveImportDeps> = {}): ArchiveImportDeps => ({
  tree: d.tree, docs: d.docs, media: d.media, comments: d.comments, journal: archiveJournal(d.db), userEmail: d.remote.email ?? undefined, schemaVersion: ARCHIVE_COMMENTS_SCHEMA_VERSION, ...over,
});
const codaDeps = (d: Device, over: Partial<ImportDeps> = {}): ImportDeps => ({ tree: d.tree, docs: d.docs, media: d.media, comments: d.comments, journal: metaJournal(d.db), ...over });
/** Un corte al abrir la página para escribirla: el proyecto y la página quedan creados y la importación, para seguir. */
const cut = (d: Device) => docsOf(d, { open: async () => { throw new Error('corte'); } });

/** Lo que la persona escribe en la página: un texto al principio del primer renglón. */
function typeInto(doc: Y.Doc, text: string) {
  const first = ((doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlElement;
  first.insert(0, [new Y.XmlText(text)]);
}

describe('la lista del final: cada página que no entró dice por qué, en el idioma de la app', () => {
  it('no se pudo guardar en el dispositivo (también en castellano)', async () => {
    for (const lang of ['en', 'es'] as const) {
      act(() => prefs.set({ language: lang }));
      const d = await device(), f = archiveFiles();
      const result = await importArchive(await openArchive(folderSource(f.files)), archiveDeps(d, { docs: docsOf(d, { isSaved: () => false }) }));
      expect(result.resumable).toBe(true);
      expect(result.problems).toEqual([`Page: ${translate(lang, 'importArchive.pending.page.unsaved')}`]);
      const coda = await importCoda(await folderFromFiles(codaFiles()), codaDeps(d, { docs: docsOf(d, { isSaved: () => false }) }));
      expect(coda.resumable).toBe(true);
      expect(coda.problems).toEqual([`A: ${translate(lang, 'import.pending.page.unsaved')}`]);
      expect([...result.problems, ...coda.problems].join('\n')).not.toMatch(RAW);
    }
    expect(translate('es', 'importArchive.pending.page.unsaved')).toBe('todavía no se pudo guardar en este dispositivo; seguí la importación');
  });

  it('la página cambió mientras se importaba; y al seguir entra, con lo escrito arriba', async () => {
    const d = await device(), f = archiveFiles(), archive = await openArchive(folderSource(f.files));
    const base = hookableJournal(archiveJournal(d.db));
    let typed = false;
    const journal = { ...base, put: async (...args: Parameters<typeof base.put>) => {
      await base.put(...args);
      const entry = args[0].pages[f.page];
      if (entry?.commit?.phase !== 'planned' || typed) return;
      typed = true;
      const doc = await d.docs.open(entry.pageId);
      typeInto(doc, 'ESCRITO');
      d.docs.close(entry.pageId);
    } };
    const first = await importArchive(archive, archiveDeps(d, { journal }));
    expect(first.problems).toEqual([`Page: ${en('importArchive.pending.page.changed')}`]);
    const resumed = await importArchive(archive, archiveDeps(d), { resume: true });
    expect(resumed.resumable).toBe(false);
    expect(resumed.problems).toEqual([`Page: ${en('importArchive.note.appended')}`]);
  });

  it('un plan que quedó a medias en la página no se toca, y el renglón dice cómo salir', async () => {
    const d = await device(), f = archiveFiles(), archive = await openArchive(folderSource(f.files));
    const base = hookableJournal(archiveJournal(d.db));
    let stop = true;
    const journal = { ...base, put: async (...args: Parameters<typeof base.put>) => {
      if (stop && args[0].pages[f.page]?.commit?.phase === 'confirmed') throw new Error('corte');
      await base.put(...args);
    } };
    const first = await importArchive(archive, archiveDeps(d, { journal }));
    expect(first.problems).toEqual(['Page: corte']);
    stop = false;
    // El registro dice que el plan sumaba más de lo que el documento tiene de esa misma mano: ni ausente ni entero.
    const store = archiveJournal(d.db) as GenerationStore<ArchiveJournal>;
    const state = await store.loadState(archive.key), stored = state.raw as ImportEnvelope<ArchiveJournal>;
    const pending = structuredClone(stored.generations[stored.activeGenerationId].journal!);
    const pageId = pending.pages[f.page].pageId;
    const doc = await d.docs.open(pageId), ahead = new Y.Doc();
    Y.applyUpdate(ahead, Y.encodeStateAsUpdate(doc));
    ahead.clientID = [...Y.decodeStateVector(Y.encodeStateVector(doc)).keys()][0];
    ahead.getMap('otro').set('k', 1);
    pending.pages[f.page].commit = { ...pending.pages[f.page].commit!, targetUpdate: Y.encodeStateAsUpdate(ahead) };
    await store.saveGeneration(state, stored.activeGenerationId, pending);
    const before = Y.encodeStateAsUpdate(doc);
    d.docs.close(pageId);
    const resumed = await importArchive(archive, archiveDeps(d), { resume: true });
    expect(resumed.resumable).toBe(true);
    expect(resumed.problems).toEqual([`Page: ${en('importArchive.pending.page.mismatch')}`]);
    const after = await d.docs.open(pageId);
    expect([...Y.encodeStateAsUpdate(after)]).toEqual([...before]);
    d.docs.close(pageId);
  });

  it('un bloque importado con el id de uno que la persona ya tiene en la página: no se pisa y queda anotado', async () => {
    const d = await device(), f = archiveFiles(), archive = await openArchive(folderSource(f.files));
    const first = await importArchive(archive, archiveDeps(d, { docs: cut(d) }));
    expect(first.problems).toEqual(['Page: corte']);
    const pageId = (await activeJournal(archiveJournal(d.db), archive.key))!.pages[f.page].pageId;
    await writeBlocks(d.docs, pageId, [{ id: 'archive-block', type: 'paragraph', content: 'PROPIO' }]);
    const resumed = await importArchive(archive, archiveDeps(d), { resume: true });
    expect(resumed.problems).toEqual([`Page: ${en('importArchive.pending.page.invalid')}`]);
    const doc = await d.docs.open(pageId), xml = doc.getXmlFragment(CONTENT_FRAGMENT).toString();
    d.docs.close(pageId);
    expect(xml).toContain('PROPIO');
    expect(xml).not.toContain('ARCHIVE_TEXT');
  });

  it('entró todo pero no se pudo anotar como terminada', async () => {
    const d = await device(), f = archiveFiles(), archive = await openArchive(folderSource(f.files));
    const journal = { ...archiveJournal(d.db), completeGeneration: async () => { throw new ImportPending('changed'); } };
    const result = await importArchive(archive, archiveDeps(d, { journal }));
    expect(result.resumable).toBe(true);
    expect(result.problems).toEqual([en('importArchive.pending.close')]);
    const coda = await importCoda(await folderFromFiles(codaFiles()), codaDeps(d, { journal: { ...metaJournal(d.db), completeGeneration: async () => { throw new ImportPending('changed'); } } }));
    expect(coda.problems).toEqual([en('import.pending.close')]);
    // Al seguir, se anota y no queda nada pendiente.
    expect((await importArchive(archive, archiveDeps(d), { resume: true })).problems).toEqual([]);
  });

  it('los comentarios de una página que la cola no acepta: el motivo sale del diccionario', async () => {
    const d = await device(), f = archiveFiles(d.remote.email ?? 'local@example.test'), archive = await openArchive(folderSource(f.files));
    const base = hookableJournal(archiveJournal(d.db));
    let stop = true;
    const journal = { ...base, put: async (...args: Parameters<typeof base.put>) => {
      if (stop && args[0].pages[f.page]?.done === true) throw new Error('corte');
      await base.put(...args);
    } };
    const first = await importArchive(archive, archiveDeps(d, { journal }));
    expect(first.problems).toEqual(['Page: corte']);
    stop = false;
    const entry = (await activeJournal(base, archive.key))!.pages[f.page];
    const comment = openCommit(entry.commit)!.commentsPlan[0];
    const receiptKey = `importReceipt2:${comment.id}`, receipt = await d.commentsDb.get('meta', receiptKey);
    expect(await d.commentsDb.getAll('outbox')).toHaveLength(1);
    // En la cola desde antes, sin su recibo (como lo dejaba una versión anterior).
    await d.commentsDb.delete('meta', receiptKey);
    const noReceipt = await importArchive(archive, archiveDeps(d), { resume: true });
    expect(noReceipt.resumable).toBe(true);
    expect(noReceipt.problems).toEqual([`Page: ${en('importArchive.note.commentsFailed', { reason: en('commentError.importEarlier') })}`]);
    // Con un recibo de otra página.
    await d.commentsDb.put('meta', { ...(receipt as object), pageId: crypto.randomUUID() }, receiptKey);
    const moved = await importArchive(archive, archiveDeps(d), { resume: true });
    expect(moved.problems).toEqual([`Page: ${en('importArchive.note.commentsFailed', { reason: en('commentError.importMoved') })}`]);
    expect([...noReceipt.problems, ...moved.problems].join('\n')).not.toMatch(RAW);
    // Con su recibo, al seguir entra sin repetirse.
    await d.commentsDb.put('meta', receipt, receiptKey);
    const done = await importArchive(archive, archiveDeps(d), { resume: true });
    expect(done).toMatchObject({ resumable: false, problems: [], comments: 1 });
    expect(await d.commentsDb.getAll('outbox')).toHaveLength(1);
  });
});

describe('el diálogo: el error se lee y siempre hay con qué seguir', () => {
  const kinds = ['coda', 'archive'] as const;
  type Kind = (typeof kinds)[number];

  async function open(kind: Kind, d: Device, files: File[]) {
    services = d;
    const job = importJobFor(d.tree);
    job.show(kind);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(kind === 'coda' ? <ImportCodaDialog /> : <ImportArchiveDialog />));
    // Elegir la carpeta, como la persona: por el selector de archivos del diálogo.
    const inputs = host.querySelectorAll<HTMLInputElement>('input[type=file]');
    const input = inputs[inputs.length - 1];
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await vi.waitFor(() => expect(job.get().folder ?? job.get().archive ?? job.get().error).toBeTruthy(), { timeout: 10000 });
    });
    const buttons = () => [...host.querySelectorAll('button')].map((b) => b.textContent?.trim());
    const click = async (text: string) => {
      const button = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
      expect(button, `${text} entre ${buttons().join(' | ')}`).toBeDefined();
      await act(async () => {
        button!.click();
        await vi.waitFor(() => expect(job.get().running).toBe(false), { timeout: 20000 });
      });
    };
    const shown = () => host.querySelector('.error')?.textContent ?? null;
    return { job, host, buttons, click, shown };
  }
  const filesOf = (kind: Kind) => (kind === 'coda' ? codaFiles() : archiveFiles().files);
  const sourceOf = async (kind: Kind, files: File[]): Promise<{ folder: CodaFolder } | { archive: ShotDocsArchive }> =>
    kind === 'coda' ? { folder: await folderFromFiles(files) } : { archive: await openArchive(folderSource(files)) };
  /** Lo que deja otra pestaña: una importación de la misma fuente, cortada, con su proyecto. */
  async function otherTab(kind: Kind, d: Device, files: File[]) {
    const source = await sourceOf(kind, files);
    const result = 'folder' in source
      ? await importCoda(source.folder, codaDeps(d, { docs: cut(d) }), { intent: 'initial', reservation: newImportReservation(source.folder.manifest.doc.id, 'Otra pestaña') })
      : await importArchive(source.archive, archiveDeps(d, { docs: cut(d) }), { intent: 'initial', reservation: newImportReservation(source.archive.key, 'Otra pestaña') });
    expect(result.resumable).toBe(true);
    return result.projectId;
  }

  it.each(kinds)('%s: falló, cambié el nombre y volví a importar: ofrece seguir o un proyecto nuevo, y el nuevo entra con el nombre nuevo', async (kind) => {
    const d = await device(), ui = await open(kind, d, filesOf(kind));
    expect(ui.buttons()).toContain('Import');
    vi.spyOn(d.tree, 'load').mockRejectedValueOnce(new Error('se cortó la luz'));
    await ui.click('Import');
    expect(ui.shown()).toBe('se cortó la luz');
    expect(ui.buttons()).toEqual(expect.arrayContaining(['Resume', 'Import into a new project']));
    expect(ui.buttons()).not.toContain('Import');
    await act(async () => ui.job.set({ name: 'Otro nombre' }));
    await ui.click('Import into a new project');
    expect(ui.shown()).toBeNull();
    const result = ui.job.get().result ?? ui.job.get().archiveResult;
    expect(result).toMatchObject({ resumable: false, problems: [] });
    expect(d.tree.project(result!.projectId)?.name).toBe('Otro nombre');
    expect(ui.host.textContent).not.toMatch(RAW);
  });

  it.each(kinds)('%s: otra pestaña dejó una importación sin terminar: el aviso se entiende y ofrece seguirla', async (kind) => {
    const lang = kind === 'coda' ? 'en' : 'es';
    act(() => prefs.set({ language: lang }));
    const label = (key: Key) => translate(lang, key);
    const d = await device(), files = filesOf(kind), ui = await open(kind, d, files);
    const projectId = await otherTab(kind, d, files);
    await ui.click(label(kind === 'coda' ? 'import.start' : 'importArchive.start'));
    expect(ui.shown()).toBe(label(kind === 'coda' ? 'import.pending.job.changed' : 'importArchive.pending.job.changed'));
    expect(ui.host.textContent).not.toMatch(RAW);
    expect(d.tree.projects().filter((p) => p.name === 'Otra pestaña')).toHaveLength(1);
    await ui.click(label(kind === 'coda' ? 'import.resume' : 'importArchive.resume'));
    expect(ui.shown()).toBeNull();
    expect(ui.job.get().result ?? ui.job.get().archiveResult).toMatchObject({ projectId, resumable: false, problems: [] });
  });

  it.each(kinds)('%s: un registro de importación que esta versión no puede leer: lo dice al elegir la carpeta', async (kind) => {
    const d = await device(), files = filesOf(kind), source = await sourceOf(kind, files);
    const key = 'folder' in source ? `codaImport2:${source.folder.manifest.doc.id}` : `shotdocsImport2:${source.archive.key}`;
    await d.db.put('meta', { recoveryVersion: 9, future: true }, key);
    const ui = await open(kind, d, files);
    expect(ui.shown()).toBe(en(kind === 'coda' ? 'import.pending.job.unreadable' : 'importArchive.pending.job.unreadable'));
    expect(ui.host.textContent).not.toMatch(RAW);
    expect(await d.db.get('meta', key)).toEqual({ recoveryVersion: 9, future: true });
  });

  it('coda: una carpeta cuyo manifest no trae el id del doc no se importa aunque se llame a la importación sin pasar por el diálogo, y dice qué hacer', async () => {
    const d = await device();
    await expect(importCoda(await folderFromFiles(codaFiles('')), codaDeps(d))).rejects.toThrow(en('import.noDocId'));
    expect(d.tree.projects().filter((p) => p.name === 'Doc')).toHaveLength(0);
    expect((await d.db.getAllKeys('meta')).filter((key) => String(key).startsWith('codaImport'))).toEqual([]);
  });

  it('coda: una carpeta sin el id del doc lo dice apenas se elige, sin esperar a Import, y no deja importarla', async () => {
    const d = await device(), ui = await open('coda', d, codaFiles(''));
    expect(ui.shown()).toBe(en('import.noDocId'));
    expect(ui.job.get().folder).toBeNull();
    const start = [...ui.host.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Import')!;
    expect(start.disabled).toBe(true);
    expect(d.tree.projects().filter((p) => p.name === 'Doc')).toHaveLength(0);
    // Elegir después una carpeta buena saca el aviso.
    const input = ui.host.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', { value: codaFiles(), configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await vi.waitFor(() => expect(ui.job.get().folder).toBeTruthy(), { timeout: 10000 });
    });
    expect(ui.shown()).toBeNull();
  });

  it.each(kinds)('%s: entró todo y solo faltó cerrarla: la lista no dice que algo no se pudo importar, y al elegir la fuente otra vez se ofrece cerrarla, sin contar páginas', async (kind) => {
    for (const lang of ['en', 'es'] as const) {
      act(() => prefs.set({ language: lang }));
      const label = (key: Key, params?: Record<string, string | number>) => translate(lang, key, params);
      const d = await device(), files = filesOf(kind), source = await sourceOf(kind, files);
      const closing = async () => { throw new ImportPending('changed'); };
      const stuck = 'folder' in source
        ? await importCoda(source.folder, codaDeps(d, { journal: { ...metaJournal(d.db), completeGeneration: closing } }), { projectName: 'Casi' })
        : await importArchive(source.archive, archiveDeps(d, { journal: { ...archiveJournal(d.db), completeGeneration: closing } }), { projectName: 'Casi' });
      expect(stuck).toMatchObject({ resumable: true, pages: 1 });
      const ui = await open(kind, d, files);
      const text = ui.host.textContent ?? '';
      expect(text).toContain(label(kind === 'coda' ? 'import.resumeClose' : 'importArchive.resumeClose', { name: 'Casi' }));
      expect(text).not.toMatch(/1 of 1|1 de 1|did not finish|no terminó/);
      await ui.click(label(kind === 'coda' ? 'import.resume' : 'importArchive.resume'));
      expect(ui.job.get().result ?? ui.job.get().archiveResult).toMatchObject({ projectId: stuck.projectId, resumable: false, problems: [] });
    }
    // El encabezado de la lista del final, con ese renglón debajo, no lo contradice.
    for (const key of ['import.problems', 'importArchive.problems'] as const) {
      expect(en(key, { count: 1 })).toBe('1 thing to check:');
      expect(translate('es', key, { count: 1 })).toBe('1 cosa para revisar:');
      expect(translate('es', key, { count: 2 })).toBe('2 cosas para revisar:');
    }
  });

  it.each(kinds)('%s: con una sola página, lo encontrado y el resumen del final lo dicen en singular, en inglés y en castellano', async (kind) => {
    for (const lang of ['en', 'es'] as const) {
      act(() => prefs.set({ language: lang }));
      const d = await device(), ui = await open(kind, d, filesOf(kind));
      const found = lang === 'en' ? '1 page and 0 files' : '1 página y 0 archivos';
      expect(ui.host.textContent).toContain(found);
      await ui.click(translate(lang, kind === 'coda' ? 'import.start' : 'importArchive.start'));
      expect(ui.host.textContent).toContain(lang === 'en' ? 'Imported 1 page and 0 files.' : 'Se importaron 1 página y 0 archivos.');
      expect(ui.host.textContent).not.toMatch(/1 pages|1 páginas/);
    }
  });
});
