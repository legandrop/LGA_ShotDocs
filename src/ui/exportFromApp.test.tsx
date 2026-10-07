// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { settled } from '../test/settle';
import { ExportEditor } from '../export/exportEditor';
import { writeBlocks } from '../export/testProject';
import { openZip } from '../export/zipReader';
import type { ImportResult } from '../import/codaImport';
import { importJobFor } from '../import/importJob';
import { formatSize } from '../media/fileTrash';
import { pagePath } from '../router';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { openExport } from './ExportHost';
import { reloadTimings } from './lazyPart';
import { replaceSession } from './replaceUi';
import { Shell } from './Workspace';

// La ventana *Export* abierta desde la app montada entera (Docs/Doc_Exportar.md, sección 7): el guardado local que espera
// antes de exportar es el que registra la app, no uno armado por la prueba. Con la página abierta y nada pendiente
// exporta; una carpeta subiendo no la frena (su tarjeta sale sin la nota de avance); una importación o un reemplazo en
// curso sí, con su causa y sin esperar; un título que todavía se está guardando se espera y sale en el PDF, y uno que no
// se pudo guardar se avisa en el acto.

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

const UNSAVED = 'Some of your latest edits are not saved on this device yet. Wait a moment and try again.';
const IMPORTING = 'An import is still running in this workspace, so the export would come out half written. Export again when it finishes.';
const REPLACING = 'Replacing in the project is still running, so the export would come out half written. Export again when it finishes, or press Stop.';
/** Con la causa ya conocida no se espera el guardado: si se esperara, las pruebas de abajo no llegarían al aviso. */
const NO_WAIT_MS = 10 * 60_000;
const READY = /Ready: \d+ PDF pages?\./;

const roots: Root[] = [];
const devices: Device[] = [];
const notices: string[] = [];
const onNotice = (e: Event) => {
  const detail = (e as CustomEvent<string | { message: string }>).detail;
  notices.push(typeof detail === 'string' ? detail : detail.message);
};
const saveWaitMs = reloadTimings.saveWaitMs;
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
  reloadTimings.saveWaitMs = saveWaitMs;
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
function deferred<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => (release = resolve));
  return { promise, release };
}

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

async function openWindow(page: string) {
  act(() => openExport('page', page));
  await until(() => button('Export PDF'), 'la ventana Export');
}

async function chooseZip() {
  await act(async () => document.querySelectorAll<HTMLInputElement>('input[name="export-format"]')[1]!.click());
  await until(() => button('Prepare .zip') && !button('Prepare .zip')!.disabled, 'el zip medido');
}

it('con la página abierta y nada pendiente, Export PDF arma el PDF', async () => {
  const { page } = await app();
  await openWindow(page);
  await click('Export PDF');
  await until(() => READY.test(shown()) || notices.length > 0, 'el PDF o un aviso');
  expect(notices).toEqual([]);
  expect(shown()).toMatch(READY);
  expect(document.querySelectorAll('.sd-export-book')).toHaveLength(1);
});

it('una carpeta subiendo no frena el PDF ni el zip, su tarjeta sale sin la nota de avance (con su nombre y su peso) y cerrar la pestaña sigue pidiendo confirmación', async () => {
  // Si exportar la esperara, fallaría enseguida en vez de a los 8 s.
  reloadTimings.saveWaitMs = 600;
  // jsdom no carga imágenes: la tarjeta (un SVG) cuenta como cargada y lo demás no se espera de más.
  const complete = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'complete')!.get!;
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockImplementation(function (this: HTMLImageElement) {
    return this.getAttribute('src')?.startsWith('data:image/svg') ? true : complete.call(this);
  });
  const create = ExportEditor.create.bind(ExportEditor);
  vi.spyOn(ExportEditor, 'create').mockImplementation((options) => create({ ...options, imageTimeoutMs: 200, copyTimeoutMs: 200 }));
  const server = new FakeServer();
  server.enableMedia();
  // La subida de carpetas necesita el Drive: acá, lo que la app le pregunta mientras hay una subiendo.
  const folders = { busy: () => true, all: () => [], progress: () => undefined, has: () => false, subscribe: () => () => undefined, getRevision: () => 0 };
  let folderUrl = '';
  const { d, page } = await app({
    server,
    extra: { folders },
    // La carpeta en la página, como queda mientras se sube: su tarjeta con la nota de avance.
    prepare: async (d, id) => {
      const folder = await d.media.addFolder(id, 'Rushes', 5_000_000);
      await writeBlocks(d.docs, id, [{ type: 'image', props: { url: folder.url, name: 'Rushes' } }]);
      d.media.setFolderNote(folder.id, 'Uploading 3 of 10');
      folderUrl = folder.url;
    },
  });
  await openWindow(page);
  await click('Export PDF');
  await until(() => READY.test(shown()) || notices.length > 0, 'el PDF o un aviso');
  expect(notices).toEqual([]);
  expect(shown()).toMatch(READY);
  // Lo de adentro de la carpeta no va en el PDF: solo su tarjeta, como va a quedar (la nota de avance es de este
  // momento y de este dispositivo, y en la página abierta sigue viéndose).
  const cards = [...document.querySelectorAll<HTMLImageElement>('.sd-export-book img')].map((img) => decodeURIComponent(img.getAttribute('src') ?? ''));
  expect(cards.filter((card) => card.includes('>Rushes<'))).toHaveLength(1);
  const card = cards.find((c) => c.includes('>Rushes<'))!;
  expect(card).not.toContain('Uploading');
  expect(card).toContain(`>Google Drive folder · ${formatSize(5_000_000)}<`);
  expect(decodeURIComponent(await d.media.resolve(folderUrl))).toContain('>Uploading 3 of 10<');
  await click('Close');

  await openWindow(page);
  await chooseZip();
  await click('Prepare .zip');
  await until(() => shown().includes('The zip is ready.') || notices.length > 0, 'el zip o un aviso');
  expect(notices).toEqual([]);
  expect(shown()).toContain('The zip is ready.');
  // Lo mismo en el zip: ni la página para abrir en el navegador ni su texto traen la nota de avance.
  const saved: Blob[] = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => (saved.push(blob as Blob), 'blob:zip'));
  // jsdom no navega: el clic del link de descarga no hace nada acá.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Save '))!.click());
  expect(saved).toHaveLength(1);
  const zip = await openZip(saved[0]);
  const pages = zip.paths().filter((path) => /\.(html|md)$/.test(path));
  expect(pages.some((path) => path.endsWith('.html'))).toBe(true);
  const texts = await Promise.all(pages.map((path) => zip.text(path, 5_000_000)));
  expect(texts.join(' ')).toContain('Rushes');
  expect(texts.join(' ')).not.toContain('Uploading');

  // Cerrar la pestaña cortaría la subida: eso no cambió.
  const leaving = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(leaving);
  expect(leaving.defaultPrevented).toBe(true);
});

it('con una importación en curso no exporta y avisa la causa en el acto, sin esperar el guardado', async () => {
  reloadTimings.saveWaitMs = NO_WAIT_MS;
  const { d, page } = await app();
  const importing = deferred<ImportResult>();
  const job = importJobFor(d.tree);
  let run!: Promise<void>;
  act(() => {
    run = job.run(() => importing.promise);
  });
  expect(job.get().running).toBe(true);
  await openWindow(page);
  await click('Export PDF');
  await until(() => notices.length > 0 || READY.test(shown()), 'el aviso');
  expect(notices).toEqual([IMPORTING]);
  expect(shown()).not.toMatch(READY);
  expect(document.querySelectorAll('.sd-export-book')).toHaveLength(0);
  // Vuelve a la ventana como estaba: se puede intentar de nuevo cuando termine.
  await until(() => button('Export PDF'), 'la ventana otra vez');
  await act(async () => {
    importing.release({} as ImportResult);
    await run;
  });
  await click('Export PDF');
  await until(() => READY.test(shown()), 'el PDF, con la importación terminada');
  expect(notices).toEqual([IMPORTING]);
});

it('con un reemplazo en curso no exporta el PDF ni el zip y avisa la causa en el acto; cuando termina, exporta', async () => {
  reloadTimings.saveWaitMs = NO_WAIT_MS;
  const { page, services: provided } = await app();
  // Un reemplazo de verdad recorre y escribe el proyecto: acá, lo que la app le pregunta mientras hay uno corriendo.
  const running = vi.spyOn(replaceSession(provided).engine, 'isRunning').mockReturnValue(true);
  await openWindow(page);
  await click('Export PDF');
  await until(() => notices.length > 0 || READY.test(shown()), 'el aviso');
  expect(notices).toEqual([REPLACING]);
  expect(shown()).not.toMatch(READY);
  expect(document.querySelectorAll('.sd-export-book')).toHaveLength(0);
  await until(() => button('Export PDF'), 'la ventana otra vez');
  await chooseZip();
  await click('Prepare .zip');
  await until(() => notices.length > 1 || shown().includes('The zip is ready.'), 'el segundo aviso');
  expect(notices).toEqual([REPLACING, REPLACING]);
  expect(shown()).not.toContain('The zip is ready.');
  // Terminó: el mismo botón ahora arma el archivo.
  running.mockReturnValue(false);
  await until(() => button('Prepare .zip') && !button('Prepare .zip')!.disabled, 'la ventana otra vez');
  await click('Prepare .zip');
  await until(() => shown().includes('The zip is ready.') || notices.length > 2, 'el zip, con el reemplazo terminado');
  expect(notices).toEqual([REPLACING, REPLACING]);
  expect(shown()).toContain('The zip is ready.');
});

it('un título que todavía se está guardando se espera y sale en el PDF', async () => {
  const { d, page } = await app();
  // El guardado del título en el dispositivo, demorado.
  const saving = deferred<void>();
  const save = d.tree.saveTitleDraft.bind(d.tree);
  vi.spyOn(d.tree, 'saveTitleDraft').mockImplementation((id, text) => saving.promise.then(() => save(id, text)));
  const title = document.querySelector<HTMLTextAreaElement>('textarea.page-title')!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    title.focus();
    setValue.call(title, 'Título recién escrito');
    title.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await openWindow(page);
  await click('Export PDF');
  await wait(300);
  expect(shown()).toContain('Saving changes on this device before export…');
  expect(shown()).not.toMatch(READY);
  expect(d.tree.get(page)?.title).toBe('Raíz');
  await act(async () => saving.release());
  await until(() => READY.test(shown()) || notices.length > 0, 'el PDF o un aviso');
  expect(notices).toEqual([]);
  expect(d.tree.get(page)?.title).toBe('Título recién escrito');
  expect(document.querySelector('.sd-export-book')?.textContent).toContain('Título recién escrito');
});

it('un título que no se pudo guardar se avisa en el acto, sin esperar el guardado, y el PDF no se arma', async () => {
  reloadTimings.saveWaitMs = NO_WAIT_MS;
  const { d, page } = await app();
  vi.spyOn(d.tree, 'saveTitleDraft').mockRejectedValue(new Error('sin espacio en el dispositivo'));
  const title = document.querySelector<HTMLTextAreaElement>('textarea.page-title')!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    title.focus();
    setValue.call(title, 'Título que no entra');
    title.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await openWindow(page);
  await click('Export PDF');
  await until(() => notices.includes(UNSAVED) || READY.test(shown()), 'el aviso');
  expect(notices).toContain(UNSAVED);
  expect(shown()).not.toMatch(READY);
  expect(document.querySelectorAll('.sd-export-book')).toHaveLength(0);
  expect(d.tree.get(page)?.title).toBe('Raíz');
  await until(() => button('Export PDF'), 'la ventana otra vez');
});
