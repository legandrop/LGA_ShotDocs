// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ServicesContext, type Services } from '../services';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { watchTitleRests } from '../sync/titleRest';
import { ExportEditor } from '../export/exportEditor';
import * as pdf from '../export/exportPdf';
import { ExportDialog } from './ExportDialog';
import { reloadTimings, watchPendingWrites } from './lazyPart';

// Fronteras de preparación y continuidad; el render real del PDF se verifica en Chromium.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, device: Device, host: HTMLElement;
const cleanups: (() => void)[] = [];
beforeEach(() => {
  window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never;
  history.replaceState(null, '', '/');
  vi.spyOn(window, 'print').mockImplementation(() => undefined);
});
afterEach(async () => {
  if (root) act(() => root.unmount());
  for (const cleanup of cleanups.splice(0)) cleanup();
  if (device) { await device.docs.flush(); await device.engine.stop(); device.docs.dispose(); device.db.close(); device.mediaDb.close(); device.commentsDb.close(); }
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
const deferred = () => { let release!: () => void; const promise = new Promise<void>((resolve) => { release = resolve; }); return { promise, release }; };
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 125)); });
const click = async (text: string) => { await act(async () => { [...host.querySelectorAll('button')].find((button) => button.textContent === text)!.click(); }); await settle(); };

async function setup(prepare: () => Promise<void> = async () => undefined) {
  const server = new FakeServer();
  device = await makeDevice(server);
  const page = await device.tree.create(null, 'Raíz');
  const a = await device.tree.create(page, 'A');
  const b = await device.tree.create(page, 'B');
  await device.engine.syncNow(); server.online = false;
  const services = { ...device, user: { id: server.ownerId }, client: {}, workspace: { config: { url: 'https://fixture.invalid', localKey: 'export_local', storage: {} } } } as unknown as Services;
  cleanups.push(watchPendingWrites({ owner: services, current: () => true, unsaved: () => false, flush: () => device.docs.flush(), prepare }));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const mount = (value = services) => act(() => root.render(<ServicesContext.Provider value={value}><ExportDialog target={{ kind: 'page', id: page }} onClose={() => undefined} /></ServicesContext.Provider>));
  mount();
  vi.spyOn(ExportEditor, 'create').mockResolvedValue({ destroy: vi.fn() } as never);
  const books: pdf.PdfBook[] = [];
  const producer = vi.spyOn(pdf, 'buildPdf').mockImplementation(async (options) => {
    const book = { root: document.createElement('div'), css: '', pages: [], sheets: 2, total: options.plan.length, from: options.from ?? 0,
      to: Math.min((options.from ?? 0) + 2, options.plan.length), part: 1, carry: new Map(), fileTitle: options.title, destroy: vi.fn() } as unknown as pdf.PdfBook;
    books.push(book); return book;
  });
  return { page, a, b, producer, books, services, mount };
}

it('relee el título y el plan después de la escritura preparada, sin esperar al servidor', async () => {
  const gate = deferred();
  let page = '';
  const s = await setup(async () => { await gate.promise; await device.tree.rename(page, 'Título confirmado'); }); page = s.page;
  await click('Export PDF'); expect(s.producer).not.toHaveBeenCalled();
  await act(async () => gate.release()); await settle();
  expect(s.producer.mock.calls[0][0].title).toBe('Título confirmado');
  expect(s.producer.mock.calls[0][0].plan[0].title).toBe('Título confirmado');
  expect(await device.db.getAll('ops')).not.toHaveLength(0);
});

it('espera al consumidor real del sobrante, sin depender de otro render del árbol', async () => {
  const s = await setup(); const gate = deferred();
  await device.tree.rename(s.page, 'H'.repeat(500), { rest: 'REST245' });
  const edit = device.docs.edit.bind(device.docs);
  vi.spyOn(device.docs, 'edit').mockImplementation(async (...args) => { await gate.promise; return edit(...args); });
  cleanups.push(watchTitleRests(device.tree, device.docs));
  await click('Export PDF'); expect(s.producer).not.toHaveBeenCalled();
  await act(async () => gate.release()); await settle();
  expect(device.tree.titleRests()).toHaveLength(0);
  expect(s.producer).toHaveBeenCalledTimes(1);
  const snap = await device.docs.snapshot(s.page);
  expect(snap.doc.getXmlFragment('document-store').toString()).toContain('REST245'); snap.doc.destroy();
});

it('rechazo de preparación conserva la ventana y no crea un libro', async () => {
  const old = reloadTimings.saveWaitMs; reloadTimings.saveWaitMs = 30; cleanups.push(() => { reloadTimings.saveWaitMs = old; });
  const s = await setup(async () => { throw Error('Escritura rechazada'); });
  await click('Export PDF'); expect(s.producer).not.toHaveBeenCalled();
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  expect(host.textContent).toContain('Export PDF');
});

it('Cancel invalida la preparación sin cancelar la escritura aceptada', async () => {
  const gate = deferred(); const s = await setup(() => gate.promise);
  await click('Export PDF'); await click('Cancel');
  await act(async () => gate.release()); await settle(); expect(s.producer).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Export PDF');
});

it('otra identidad de Services no recibe el resultado tardío del dueño anterior', async () => {
  const s = await setup(); const gate = deferred();
  const late = { root: document.createElement('div'), destroy: vi.fn() } as unknown as pdf.PdfBook;
  s.producer.mockImplementation(async () => { await gate.promise; return late; });
  await click('Export PDF'); expect(s.producer).toHaveBeenCalledTimes(1);
  s.mount({ ...s.services, workspace: { ...s.services.workspace, config: { ...s.services.workspace.config, localKey: 'otra_isla' } } });
  await act(async () => gate.release()); await settle();
  expect(late.destroy).toHaveBeenCalledTimes(1); expect(window.print).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Export PDF');
});

it('Next part rechaza el índice anterior si se retira una página; reinicio explícito desde cero', async () => {
  let pause: Promise<void> = Promise.resolve(); const s = await setup(() => pause);
  await click('Export PDF'); const first = s.books[0]; const gate = deferred(); pause = gate.promise;
  await click('Prepare part 2'); await act(async () => device.tree.trash(s.a));
  await act(async () => gate.release()); await settle();
  expect(s.producer).toHaveBeenCalledTimes(1); expect(first.destroy).not.toHaveBeenCalled();
  expect(host.textContent).toContain('The pages or their layout changed');
  await click('Export again'); expect(s.producer).toHaveBeenCalledTimes(2);
  expect(s.producer.mock.calls[1][0].from).toBe(0); expect(s.producer.mock.calls[1][0].carry).toBeNull();
  expect(s.producer.mock.calls[1][0].plan.map((page) => page.id)).toEqual([s.page, s.b]);
});

it('Next part compatible usa títulos actuales y conserva el carry por páginas', async () => {
  let pause: Promise<void> = Promise.resolve(); const s = await setup(() => pause);
  await click('Export PDF'); const first = s.books[0]; const gate = deferred(); pause = gate.promise;
  await click('Prepare part 2'); await act(async () => device.tree.rename(s.b, 'B vigente'));
  await act(async () => gate.release()); await settle();
  expect(s.producer.mock.calls[1][0].from).toBe(2);
  expect(s.producer.mock.calls[1][0].carry).toBe(first.carry);
  expect(s.producer.mock.calls[1][0].plan[2].title).toBe('B vigente');
});
