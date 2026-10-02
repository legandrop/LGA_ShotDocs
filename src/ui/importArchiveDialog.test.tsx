// @vitest-environment jsdom
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { importJobFor } from '../import/importJob';
import { BlobSink } from '../media/folderZip';
import { ZipWriter } from '../media/zipWriter';
import { prefs } from '../prefs';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { ImportArchiveDialog } from './ImportArchiveDialog';
import { ProjectSwitcher } from './ProjectSwitcher';

// La ventana *Import Shot Docs archive…* (P.22, entrega 3): la entrada del selector de proyectos solo para quien crea
// proyectos (dueño y admins), elegir un zip, lo que dice antes de empezar (páginas, archivos, lo que falta, sin Drive)
// y el resultado; un zip roto o de una versión más nueva avisa sin crear nada.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('File', NodeFile);
});

const roots: Root[] = [];
const devices: Device[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  act(() => prefs.set({ language: 'en' }));
});

function services(d: Device, userId: string, email = `${userId}@test`): Services {
  const config = { url: 'https://znlvpuddswymxpffgvbz.supabase.co', publishableKey: 'sb_publishable_test', name: 'Wanka', localKey: WANKA_LOCAL_KEY, storage: legacyStorageNames(WANKA_LOCAL_KEY) };
  const client = { auth: { getSession: async () => ({ data: { session: null } }) } } as never;
  return {
    workspace: { config, client },
    client,
    user: { id: userId, email },
    db: d.db,
    tree: d.tree,
    docs: d.docs,
    files: d.files,
    media: d.media,
    engine: d.engine,
    access: d.access,
    remote: d.remote as unknown as SupabaseRemote,
    dbName: 'test',
    mediaDb: d.mediaDb,
    comments: d.comments,
    commentsDb: d.commentsDb,
    sizes: d.sizes,
    offline: d.offline,
    shutdown: async () => undefined,
  };
}

const PAGE = '00000000-0000-4000-8000-000000000001';
const FILE = '00000000-0000-4000-8000-000000000009';

/** Un zip de la app chiquito: una página con un texto y, si se pide, una foto con su original. */
async function smallZip(options: { format?: number; photo?: boolean } = {}): Promise<File> {
  const sink = new BlobSink();
  const zip = new ZipWriter(sink);
  const add = async (path: string, text: string) => {
    const bytes = new TextEncoder().encode(text);
    await zip.addFile(path, bytes.length, new Date(), (async function* () {
      yield bytes;
    })());
  };
  const blocks = [{ id: 'b1', type: 'paragraph', content: [{ type: 'text', text: 'Hola desde el archivo', styles: {} }] }];
  if (options.photo) blocks.push({ id: 'b2', type: 'image', props: { url: `sdmedia://${FILE}`, name: 'IMG_1.JPG' } } as never);
  await add('_shotdocs/pages/0001.json', JSON.stringify({ format: 1, id: PAGE, blocks }));
  if (options.photo) await add('01_Escena/Files/IMG_1.JPG', 'JPEGDATA');
  await add(
    '_shotdocs/manifest.json',
    JSON.stringify({
      format: options.format ?? 1,
      id: 'zip-chico',
      title: 'Reporte chico',
      project: { name: 'Reporte chico' },
      pages: [{ id: PAGE, parent: null, order: 1, title: 'Escena', icon: null, settings: {}, templateId: null, json: '_shotdocs/pages/0001.json', complete: true }],
      files: options.photo ? [{ id: FILE, name: 'IMG_1.JPG', mime: 'image/jpeg', kind: 'image', size: 8, original: '01_Escena/Files/IMG_1.JPG', view: null }] : [],
    }),
  );
  await zip.finish();
  return new NodeFile([sink.blob() as never], 'Reporte_chico.zip', { type: 'application/zip' }) as unknown as File;
}

async function mountDialog(value: Services): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<ServicesContext.Provider value={value}>{<ImportArchiveDialog />}</ServicesContext.Provider>));
  return host;
}

const button = (host: HTMLElement, label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label);

/** Elige un archivo en el `<input type="file">` del zip y espera a que lo lea. */
async function pick(host: HTMLElement, file: File) {
  const input = host.querySelector<HTMLInputElement>('input[type="file"][accept]')!;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  for (let i = 0; i < 50 && host.textContent?.includes('Reading the archive'); i++) await act(async () => new Promise((r) => setTimeout(r, 20)));
  await act(async () => new Promise((r) => setTimeout(r, 20)));
}

async function device(server: FakeServer, user: { id?: string; email?: string } = {}) {
  const d = await makeDevice(server, crypto.randomUUID(), '0.021', {}, undefined, user);
  devices.push(d);
  await d.engine.syncNow();
  return d;
}

describe('la ventana Import Shot Docs archive', () => {
  it('elegir el zip, ver lo que trae y crear el proyecto nuevo', async () => {
    const server = new FakeServer();
    server.enableMedia();
    const d = await device(server);
    const job = importJobFor(d.tree);
    act(() => job.show('archive'));
    const host = await mountDialog(services(d, server.ownerId));
    expect(host.textContent).toContain('It becomes a new project in this workspace');
    expect(button(host, 'Import')!.disabled).toBe(true);
    await pick(host, await smallZip({ photo: true }));
    expect(host.textContent).toContain('“Reporte chico”: 1 pages and 1 files');
    expect(host.querySelector<HTMLInputElement>('#import-archive-name')!.value).toBe('Reporte chico');
    expect(button(host, 'Import')!.disabled).toBe(false);
    await act(async () => button(host, 'Import')!.click());
    for (let i = 0; i < 100 && !host.textContent?.includes('Imported'); i++) await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(host.textContent).toContain('Imported 1 pages and 1 files.');
    const projectId = job.get().archiveResult!.projectId;
    expect(d.tree.project(projectId)?.name).toBe('Reporte chico');
    expect(d.tree.roots(projectId).map((p) => p.title)).toEqual(['Escena']);
    expect(button(host, 'Open project')).toBeDefined();
    act(() => job.close());
  });

  it('un archivo que no es zip, uno de una versión más nueva o sin el Drive: avisa y no deja importar', async () => {
    const server = new FakeServer();
    const d = await device(server);
    const before = d.tree.projects().length;
    const job = importJobFor(d.tree);
    act(() => job.show('archive'));
    const host = await mountDialog(services(d, server.ownerId));
    await pick(host, new NodeFile(['hola, esto es un texto y no un zip de verdad'], 'nota.zip') as unknown as File);
    expect(host.textContent).toContain('This file is not a zip.');
    await pick(host, await smallZip({ format: 2 }));
    expect(host.textContent).toContain('Update the app to import this archive');
    // Sin el Drive conectado: lo dice y no deja empezar (el archivo trae una foto).
    await pick(host, await smallZip({ photo: true }));
    expect(host.textContent).toContain('Connect Google Drive first');
    expect(button(host, 'Import')!.disabled).toBe(true);
    // Uno sin fotos sí se puede importar sin Drive.
    await pick(host, await smallZip());
    expect(host.textContent).not.toContain('Connect Google Drive first');
    expect(button(host, 'Import')!.disabled).toBe(false);
    expect(d.tree.projects().length).toBe(before);
    act(() => job.close());
  });
});

describe('la entrada del selector de proyectos', () => {
  async function openSwitcher(value: Services): Promise<void> {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<ServicesContext.Provider value={value}><ProjectSwitcher /></ServicesContext.Provider>));
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    await act(async () => host.querySelector<HTMLButtonElement>('.project-button')!.click());
  }
  const entry = () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Import Shot Docs archive…');

  it('el dueño la ve y abre la ventana del archivo (no la de Coda)', async () => {
    const server = new FakeServer();
    server.enableMedia();
    const d = await device(server);
    await openSwitcher(services(d, server.ownerId));
    expect(entry()).toBeDefined();
    act(() => entry()!.click());
    expect(importJobFor(d.tree).get()).toMatchObject({ open: true, kind: 'archive' });
    act(() => importJobFor(d.tree).close());
  });

  it('un miembro (no crea proyectos) no la ve', async () => {
    const server = new FakeServer();
    server.enableTrash();
    server.addMember('mia', 'member', 'mia@estudio.test');
    server.grant('mia', { projectId: server.workspaceId }, 'edit');
    const d = await device(server, { id: 'mia', email: 'mia@estudio.test' });
    await d.engine.syncNow();
    await openSwitcher(services(d, 'mia', 'mia@estudio.test'));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(entry()).toBeUndefined();
  });
});
