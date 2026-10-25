// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { settled } from '../test/settle';
import { writeBlocks } from '../export/testProject';
import { openZip } from '../export/zipReader';
import { pagePath } from '../router';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { openExportPages } from './ExportHost';
import { Shell } from './Workspace';

// Exportar las páginas que hablan de una escena (Doc_Relaciones.md, sección 21): desde el mapa, un grupo de páginas
// sueltas en un solo PDF o zip. Cada una sale sola (sin las de adentro), sin repetidas ni las de la papelera, y el PDF y
// el zip llevan el nombre del grupo.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// Monta el editor: con la máquina cargada, en jsdom tarda.
vi.setConfig({ testTimeout: 120_000 });

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as never;
  const empty = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) });
  Range.prototype.getClientRects ??= (() => []) as never;
  Range.prototype.getBoundingClientRect ??= empty as never;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

const READY = /Ready: \d+ PDF pages?\./;

const roots: Root[] = [];
const devices: Device[] = [];
const notices: string[] = [];
const onNotice = (e: Event) => {
  const detail = (e as CustomEvent<string | { message: string }>).detail;
  notices.push(typeof detail === 'string' ? detail : detail.message);
};
afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const d of devices.splice(0)) {
    await d.docs.flush();
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  window.removeEventListener('shotdocs:notice', onNotice);
  notices.length = 0;
  document.body.innerHTML = '';
  localStorage.clear();
  history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// El rato pedido y, después, a que termine lo que quedó en marcha (src/test/settle.ts).
const wait = (ms = 30) => act(() => settled(ms));
async function until(check: () => unknown, what: string, tries = 400): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (check()) return;
    await wait(40);
  }
  throw new Error(`no llegó: ${what} (avisos: ${JSON.stringify(notices)})`);
}
const shown = () => document.body.textContent ?? '';
const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === label);
const click = (label: string) => act(async () => button(label)!.click());

function services(d: Device, extra: Partial<Record<keyof Services, unknown>> = {}): Services {
  return {
    workspace: { config: { url: 'https://x.supabase.co', publishableKey: 'k', name: 'W', localKey: WANKA_LOCAL_KEY, storage: legacyStorageNames(WANKA_LOCAL_KEY) }, client: {} },
    client: { auth: { signOut: vi.fn(), getSession: async () => ({ data: { session: null } }) } },
    user: { id: d.remote.userId, email: 'a@test' },
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
    shutdown: async () => undefined,
    ...extra,
  } as unknown as Services;
}

/** La app con la página «Raíz» abierta (y dos adentro), ya sincronizada. */
async function app(options: { extra?: Partial<Record<keyof Services, unknown>>; server?: FakeServer; prepare?: (d: Device, page: string) => Promise<void> } = {}) {
  const d = await makeDevice(options.server ?? new FakeServer());
  devices.push(d);
  const page = await d.tree.create(null, 'Raíz');
  await d.tree.create(page, 'A');
  await d.tree.create(page, 'B');
  await d.engine.syncNow();
  await options.prepare?.(d, page);
  vi.stubGlobal('print', vi.fn());
  window.addEventListener('shotdocs:notice', onNotice);
  history.replaceState(null, '', pagePath(page));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const provided = services(d, options.extra);
  act(() => root.render(<ServicesContext.Provider value={provided}><Shell /></ServicesContext.Provider>));
  await until(() => document.querySelector('textarea.page-title'), 'el título de la página abierta');
  return { d, page, services: provided };
}


/** La app con «Raíz» (con «A» y «B» adentro; «A» lleva el texto de hijo), «Suelta» y «Borrada» (en la papelera). */
async function setup() {
  return app({
    prepare: async (d, page) => {
      const hijo = d.tree.children(page)[0]!.id;
      await writeBlocks(d.docs, page, [{ type: 'paragraph', content: 'texto de raíz' }]);
      await writeBlocks(d.docs, hijo, [{ type: 'paragraph', content: 'texto de hijo' }]);
    },
  });
}

async function group(d: Device, page: string) {
  const suelta = await d.tree.create(null, 'Suelta');
  const borrada = await d.tree.create(null, 'Borrada');
  await writeBlocks(d.docs, suelta, [{ type: 'paragraph', content: 'texto de suelta' }]);
  await d.tree.trash(borrada);
  await d.engine.syncNow();
  // Repetida a propósito: sale una sola vez.
  act(() => openExportPages('scene:1', 'Scene 1', [page, suelta, page, borrada]));
  await until(() => button('Export PDF'), 'la ventana Export');
}

it('el PDF lleva las páginas del grupo, cada una sin las de adentro, sin repetidas ni las de la papelera', async () => {
  const { d, page } = await setup();
  await group(d, page);
  expect(document.querySelector('[role="dialog"] h2')!.textContent).toBe('Export “Scene 1”');
  expect(shown()).toContain('2 pages, each without the pages inside it');
  await click('Export PDF');
  await until(() => READY.test(shown()) || notices.length > 0, 'el PDF o un aviso');
  expect(notices).toEqual([]);
  const book = document.querySelector('.sd-export-book')!.textContent ?? '';
  expect(book).toContain('texto de raíz');
  expect(book).toContain('texto de suelta');
  expect(book).not.toContain('texto de hijo');
  expect(book).not.toContain('Borrada');
});

it('el zip lleva las mismas páginas y el nombre del grupo', async () => {
  const { d, page } = await setup();
  await group(d, page);
  await act(async () => document.querySelectorAll<HTMLInputElement>('input[name="export-format"]')[1]!.click());
  await until(() => button('Prepare .zip') && !button('Prepare .zip')!.disabled, 'el zip medido');
  await click('Prepare .zip');
  await until(() => shown().includes('The zip is ready.') || notices.length > 0, 'el zip o un aviso');
  expect(notices).toEqual([]);
  const saved: Blob[] = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => (saved.push(blob as Blob), 'blob:zip'));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  const save = [...document.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Save '))!;
  expect(save.textContent).toContain('Scene_1.zip');
  await act(async () => save.click());
  expect(saved).toHaveLength(1);
  const zip = await openZip(saved[0]);
  const pages = zip.paths().filter((path) => path.endsWith('.md'));
  const texts = (await Promise.all(pages.map((path) => zip.text(path, 5_000_000)))).join(' ');
  expect(pages).toHaveLength(2);
  expect(texts).toContain('texto de raíz');
  expect(texts).toContain('texto de suelta');
  expect(texts).not.toContain('texto de hijo');
  // El manifiesto: un zip de páginas, sin proyecto, con las dos como raíz.
  const manifest = JSON.parse(await zip.text('_shotdocs/manifest.json', 5_000_000)) as { kind: string; project: unknown; title: string; pages: { title: string; parent: string | null }[] };
  expect(manifest).toMatchObject({ kind: 'page', project: null, title: 'Scene 1' });
  expect(manifest.pages.map((p) => [p.title, p.parent])).toEqual([['Raíz', null], ['Suelta', null]]);
});

it('con una sola página, el zip la guarda con su título (no con el del grupo)', async () => {
  const { page } = await setup();
  act(() => openExportPages('scene:2', 'Scene 2', [page]));
  await until(() => button('Export PDF'), 'la ventana Export');
  await act(async () => document.querySelectorAll<HTMLInputElement>('input[name="export-format"]')[1]!.click());
  await until(() => button('Prepare .zip') && !button('Prepare .zip')!.disabled, 'el zip medido');
  await click('Prepare .zip');
  await until(() => shown().includes('The zip is ready.') || notices.length > 0, 'el zip o un aviso');
  expect(notices).toEqual([]);
  const saved: Blob[] = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => (saved.push(blob as Blob), 'blob:zip'));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Save '))!.click());
  const zip = await openZip(saved[0]);
  const pages = zip.paths().filter((path) => path.endsWith('.md'));
  expect(pages).toHaveLength(1);
  // En su carpeta numerada y con su título (los nombres de archivo van sin tildes).
  expect(pages[0]).toBe('01_Raiz/01_Raiz.md');
});
