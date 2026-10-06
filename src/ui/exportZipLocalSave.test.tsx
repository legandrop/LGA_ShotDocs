// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ServicesContext, type Services } from '../services';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { watchTitleRests } from '../sync/titleRest';
import { ExportEditor } from '../export/exportEditor';
import * as zip from '../export/exportZip';
import { exportPlan } from '../export/exportPages';
import { ExportZipPanel } from './ExportZip';
import { reloadTimings, watchPendingWrites } from './lazyPart';

// Pruebas de las fronteras del caller; ZIP/HTML/MD/JSON físicos se verifican en Chromium.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, device: Device, host: HTMLElement;
const cleanups: (() => void)[] = [];
beforeEach(() => {
  window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never;
  history.replaceState(null, '', '/');
});
afterEach(async () => {
  if (root) act(() => root.unmount());
  for (const cleanup of cleanups.splice(0)) cleanup();
  if (device) { await device.docs.flush(); await device.engine.stop(); device.docs.dispose(); device.db.close(); device.mediaDb.close(); device.commentsDb.close(); }
  delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  document.body.replaceChildren(); vi.restoreAllMocks();
});
const deferred = () => { let release!: () => void; const promise = new Promise<void>((resolve) => { release = resolve; }); return { promise, release }; };
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 125)); });
const click = async (text: string) => { await act(async () => { [...host.querySelectorAll('button')].find((button) => button.textContent === text)!.click(); }); await settle(); };
async function setup(prepare: () => Promise<void> = async () => undefined) {
  const server = new FakeServer(); device = await makeDevice(server);
  const page = await device.tree.create(null, 'Raíz');
  const child = await device.tree.create(page, 'Hija');
  await device.engine.syncNow(); server.online = false;
  const services = { ...device, user: { id: server.ownerId }, client: {}, workspace: { config: { url: 'https://fixture.invalid', localKey: 'zip_local', storage: {} } } } as unknown as Services;
  cleanups.push(watchPendingWrites({ owner: services, current: () => true, unsaved: () => false, flush: () => device.docs.flush(), prepare }));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const mount = (value = services, ids = [page]) => act(() => root.render(<ServicesContext.Provider value={value}><ExportZipPanel plan={exportPlan(device.tree, 'page', page).filter((p) => ids.includes(p.id))} kind="page" project={null} title={device.tree.get(page)!.title} onBusy={() => undefined} onClose={() => undefined} /></ServicesContext.Provider>));
  mount();
  vi.spyOn(ExportEditor, 'create').mockResolvedValue({ destroy: vi.fn() } as never);
  const producer = vi.spyOn(zip, 'buildZip').mockResolvedValue({ root: 'Raiz', missing: [], lastSync: null } as never);
  return { page, child, services, mount, producer };
}
/** `size`: lo que pesa el archivo elegido al elegirlo (0: lo acaba de crear el selector); sin él, el navegador no lo dice. */
function filePicker(pause: Promise<void> = Promise.resolve(), size?: number) {
  const writable = { write: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined), abort: vi.fn().mockResolvedValue(undefined) };
  const handle = { name: 'Elegido.zip', createWritable: vi.fn(async () => { await pause; return writable; }), remove: vi.fn().mockResolvedValue(undefined), ...(size === undefined ? {} : { getFile: vi.fn(async () => ({ size })) }) };
  const picker = vi.fn().mockResolvedValue(handle);
  (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = picker;
  return { writable, handle, picker };
}

it('prepara título antes de producir y no agrega hijas al exportar sólo una página', async () => {
  const gate = deferred(); let page = '';
  const s = await setup(async () => { await gate.promise; await device.tree.rename(page, 'Título actual'); }); page = s.page;
  await click('Prepare .zip'); expect(s.producer).not.toHaveBeenCalled();
  await act(async () => gate.release()); await settle();
  expect(s.producer).toHaveBeenCalledTimes(1);
  expect(s.producer.mock.calls[0][0].title).toBe('Título actual');
  expect(s.producer.mock.calls[0][0].plan.map((p) => [p.id, p.title])).toEqual([[s.page, 'Título actual']]);
  expect(host.textContent).toContain('Save Titulo_actual.zip');
});

it('espera al consumidor real del sobrante hasta su documento durable', async () => {
  const s = await setup(); const gate = deferred();
  await device.tree.rename(s.page, 'H'.repeat(500), { rest: 'REST245' });
  const edit = device.docs.edit.bind(device.docs);
  vi.spyOn(device.docs, 'edit').mockImplementation(async (...args) => { await gate.promise; return edit(...args); });
  cleanups.push(watchTitleRests(device.tree, device.docs));
  await click('Prepare .zip'); expect(s.producer).not.toHaveBeenCalled();
  await act(async () => gate.release()); await settle();
  expect(device.tree.titleRests()).toHaveLength(0); expect(s.producer).toHaveBeenCalledTimes(1);
  const snap = await device.docs.snapshot(s.page);
  expect(snap.doc.getXmlFragment('document-store').toString()).toContain('REST245'); snap.doc.destroy();
});

it('el selector recibe el gesto pero el escritor espera la barrera', async () => {
  const gate = deferred(); const s = await setup(() => gate.promise); const f = filePicker(); s.mount();
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Download .zip…')!;
  act(() => button.click()); expect(f.picker).toHaveBeenCalledTimes(1);
  await settle(); expect(f.handle.createWritable).not.toHaveBeenCalled();
  await act(async () => gate.release()); await settle();
  expect(s.producer).toHaveBeenCalledTimes(1); expect(f.writable.close).toHaveBeenCalledTimes(1); expect(f.handle.remove).not.toHaveBeenCalled();
});

it('rechazo de preparación no abre el escritor ni borra el archivo elegido', async () => {
  const old = reloadTimings.saveWaitMs; reloadTimings.saveWaitMs = 30; cleanups.push(() => { reloadTimings.saveWaitMs = old; });
  const s = await setup(async () => { throw Error('Escritura rechazada'); }); const f = filePicker(); s.mount();
  await click('Download .zip…'); expect(s.producer).not.toHaveBeenCalled();
  expect(f.handle.createWritable).not.toHaveBeenCalled(); expect(f.handle.remove).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Download .zip…');
});

it('Cancel invalida la preparación sin cancelar la escritura aceptada', async () => {
  const gate = deferred(); const s = await setup(() => gate.promise);
  await click('Prepare .zip'); await click('Cancel');
  await act(async () => gate.release()); await settle(); expect(s.producer).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Cancelled: nothing was saved.');
});

it('un escritor adquirido después de Cancel se aborta sin remove', async () => {
  const gate = deferred(); const s = await setup(); const f = filePicker(gate.promise); s.mount();
  await click('Download .zip…'); expect(f.handle.createWritable).toHaveBeenCalledTimes(1);
  await click('Cancel'); await act(async () => gate.release()); await settle();
  expect(f.writable.abort).toHaveBeenCalledTimes(1); expect(f.handle.remove).not.toHaveBeenCalled(); expect(s.producer).not.toHaveBeenCalled();
});

it('otra identidad de Services no recibe el resultado tardío ni Save', async () => {
  const s = await setup(); const gate = deferred();
  s.producer.mockImplementation(async () => { await gate.promise; return { missing: [] } as never; });
  await click('Prepare .zip'); expect(s.producer).toHaveBeenCalledTimes(1);
  s.mount({ ...s.services, workspace: { ...s.services.workspace, config: { ...s.services.workspace.config, localKey: 'otra_isla' } } });
  await act(async () => gate.release()); await settle();
  expect(host.textContent).not.toContain('The zip is ready'); expect(host.textContent).not.toContain('Save Raiz.zip');
});

it('retirar una página durante preparación exige preparar selección actual otra vez', async () => {
  const gate = deferred(); const s = await setup(() => gate.promise); s.mount(s.services, [s.page, s.child]);
  await click('Prepare .zip'); await act(async () => device.tree.trash(s.child));
  await act(async () => gate.release()); await settle(); expect(s.producer).not.toHaveBeenCalled();
  expect(host.textContent).toContain('The pages or their layout changed');
});

it('Save listo no dispara una descarga al cambiar la ruta sin render', async () => {
  const s = await setup(); const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  await click('Prepare .zip'); expect(s.producer).toHaveBeenCalledTimes(1);
  history.replaceState(null, '', '/otra_pagina');
  await click('Save Raiz.zip'); expect(download).not.toHaveBeenCalled();
});

it('Cancelar el selector no prepara ni produce un archivo', async () => {
  const prepare = vi.fn().mockResolvedValue(undefined); const s = await setup(prepare); const f = filePicker();
  f.picker.mockRejectedValue(new DOMException('Cancelado', 'AbortError')); s.mount();
  await click('Download .zip…'); expect(prepare).not.toHaveBeenCalled(); expect(s.producer).not.toHaveBeenCalled();
  expect(f.handle.createWritable).not.toHaveBeenCalled();
});

it('la carpeta nueva se crea con el título confirmado sólo después de guardar', async () => {
  const gate = deferred(); let page = '';
  const s = await setup(async () => { await gate.promise; await device.tree.rename(page, 'Carpeta actual'); }); page = s.page;
  filePicker();
  const parent = { name: 'Destino', getDirectoryHandle: vi.fn(async (_name: string, options?: { create?: boolean }) => { if (!options?.create) throw Error('No existe'); return { name: 'Carpeta_actual' }; }), getFileHandle: vi.fn().mockRejectedValue(Error('No existe')) };
  (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = vi.fn().mockResolvedValue(parent); s.mount();
  await click('Download to a folder…'); expect(parent.getDirectoryHandle).not.toHaveBeenCalled();
  await act(async () => gate.release()); await settle();
  expect(parent.getDirectoryHandle).toHaveBeenLastCalledWith('Carpeta_actual', { create: true });
  expect(s.producer.mock.calls[0][0].title).toBe('Carpeta actual');
});

it('Cancel del selector de carpeta no crea directorios', async () => {
  const s = await setup(); filePicker();
  (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = vi.fn().mockRejectedValue(new DOMException('Cancelado', 'AbortError')); s.mount();
  await click('Download to a folder…'); expect(s.producer).not.toHaveBeenCalled(); expect(host.textContent).toContain('Download to a folder…');
});

it('un handle elegido tarde para otro owner no abre el escritor', async () => {
  const gate = deferred(); const s = await setup(); const f = filePicker(); f.picker.mockImplementation(async () => { await gate.promise; return f.handle; }); s.mount();
  await click('Download .zip…'); s.mount({ ...s.services });
  await act(async () => gate.release()); await settle();
  expect(f.handle.createWritable).not.toHaveBeenCalled(); expect(s.producer).not.toHaveBeenCalled();
});

it('recomprueba permisos locales antes de abrir el escritor', async () => {
  const gate = deferred(); const s = await setup(() => gate.promise); const f = filePicker(); s.mount();
  await click('Download .zip…'); vi.spyOn(device.access, 'get').mockReturnValue({ member: null, grants: [], fetchedAt: Date.now() });
  await act(async () => gate.release()); await settle();
  expect(f.handle.createWritable).not.toHaveBeenCalled(); expect(s.producer).not.toHaveBeenCalled();
});

it('el límite de memoria usa la estimación posterior a guardar', async () => {
  const gate = deferred(); const s = await setup(() => gate.promise);
  await settle(); await click('Prepare .zip');
  vi.spyOn(zip, 'estimateZip').mockResolvedValue({ pages: 1, files: 1, previews: 0, byKind: { image: { count: 1, bytes: 20 * 1024 ** 3, remote: 0, remoteBytes: 0, unknown: 0 }, video: { count: 0, bytes: 0, remote: 0, remoteBytes: 0, unknown: 0 }, file: { count: 0, bytes: 0, remote: 0, remoteBytes: 0, unknown: 0 } } });
  await act(async () => gate.release()); await settle();
  expect(s.producer).not.toHaveBeenCalled(); expect(host.textContent).toContain('Too big for this browser');
});

it('un título cambiado mientras abre el escritor invalida la copia preparada', async () => {
  const gate = deferred(); const s = await setup(); const f = filePicker(gate.promise); s.mount();
  await click('Download .zip…'); await act(async () => device.tree.rename(s.page, 'Título posterior'));
  await act(async () => gate.release()); await settle();
  expect(s.producer).not.toHaveBeenCalled(); expect(f.writable.abort).toHaveBeenCalledTimes(1); expect(f.handle.remove).not.toHaveBeenCalled();
});

it('un sobrante nuevo durante adquisición del escritor impide producir la copia vieja', async () => {
  const gate = deferred(); const s = await setup(); const f = filePicker(gate.promise); s.mount();
  await click('Download .zip…'); await act(async () => device.tree.rename(s.page, 'Raíz', { rest: 'REST posterior' }));
  await act(async () => gate.release()); await settle();
  expect(device.tree.titleRests()).toHaveLength(1); expect(s.producer).not.toHaveBeenCalled(); expect(f.writable.abort).toHaveBeenCalledTimes(1);
});

it('otra identidad con referencias compartidas descarta la estimación tardía', async () => {
  const s = await setup(), gate = deferred(), plan = exportPlan(device.tree, 'page', s.page);
  const estimate = await zip.estimateZip(plan, device.docs, null, new AbortController().signal);
  const spy = vi.spyOn(zip, 'estimateZip').mockImplementationOnce(async () => { await gate.promise; return { ...estimate, pages: 9 }; }).mockResolvedValue({ ...estimate, pages: 2 });
  const mount = (owner: Services) => act(() => root.render(<ServicesContext.Provider value={owner}><ExportZipPanel plan={plan} kind="page" project={null} title="Raíz" onBusy={() => undefined} onClose={() => undefined} /></ServicesContext.Provider>));
  mount(s.services); await settle();
  mount({ ...s.services, workspace: { ...s.services.workspace, config: { ...s.services.workspace.config, localKey: 'otro_owner' } } }); await settle();
  expect(spy).toHaveBeenCalledTimes(2); expect(host.textContent).toContain('2 pages');
  await act(async () => gate.release()); await settle();
  expect(host.textContent).toContain('2 pages'); expect(host.textContent).not.toContain('9 pages');
});

it.each([
  ['el zip vacío que acaba de crear el selector se saca del destino', 0, 1],
  ['un zip que ya tenía contenido al elegirlo no se toca', 4096, 0],
] as const)('al cancelar, %s', async (_what, size, removed) => {
  const gate = deferred(); const s = await setup(); const f = filePicker(gate.promise, size); s.mount();
  await click('Download .zip…'); expect(f.handle.createWritable).toHaveBeenCalledTimes(1);
  await click('Cancel'); await act(async () => gate.release()); await settle();
  expect(f.writable.abort).toHaveBeenCalledTimes(1); expect(s.producer).not.toHaveBeenCalled();
  expect(f.handle.remove).toHaveBeenCalledTimes(removed);
});

it('si el zip falla después de abrir el escritor, el vacío recién creado se saca', async () => {
  const s = await setup(); const f = filePicker(Promise.resolve(), 0); s.mount();
  s.producer.mockRejectedValueOnce(new Error('se cortó la escritura'));
  await click('Download .zip…');
  expect(s.producer).toHaveBeenCalledTimes(1); expect(f.writable.abort).toHaveBeenCalledTimes(1); expect(f.writable.close).not.toHaveBeenCalled();
  expect(f.handle.remove).toHaveBeenCalledTimes(1);
});

it('un rechazo de la preparación saca el zip vacío recién creado sin abrir el escritor', async () => {
  const old = reloadTimings.saveWaitMs; reloadTimings.saveWaitMs = 30; cleanups.push(() => { reloadTimings.saveWaitMs = old; });
  const s = await setup(async () => { throw Error('Escritura rechazada'); }); const f = filePicker(Promise.resolve(), 0); s.mount();
  await click('Download .zip…'); expect(s.producer).not.toHaveBeenCalled();
  expect(f.handle.createWritable).not.toHaveBeenCalled(); expect(f.handle.remove).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain('Download .zip…');
});

it('el zip que terminó de escribirse no se borra aunque el selector lo haya creado vacío', async () => {
  const s = await setup(); const f = filePicker(Promise.resolve(), 0); s.mount();
  await click('Download .zip…');
  expect(s.producer).toHaveBeenCalledTimes(1); expect(f.writable.close).toHaveBeenCalledTimes(1);
  expect(f.handle.remove).not.toHaveBeenCalled();
});

it('con una importación o un reemplazo en curso no se pide ni el destino: la causa se avisa en el mismo clic', async () => {
  const s = await setup(); const f = filePicker(Promise.resolve(), 0);
  let blocked: string | null = 'Hay una importación en curso';
  cleanups.push(watchPendingWrites({ owner: s.services, current: () => true, unsaved: () => false, flush: () => device.docs.flush(), exportBlocked: () => blocked }));
  const notices: string[] = []; const onNotice = (e: Event) => notices.push(String((e as CustomEvent<string>).detail));
  window.addEventListener('shotdocs:notice', onNotice); cleanups.push(() => window.removeEventListener('shotdocs:notice', onNotice));
  s.mount();
  await click('Download .zip…');
  expect(f.picker).not.toHaveBeenCalled(); expect(f.handle.createWritable).not.toHaveBeenCalled(); expect(s.producer).not.toHaveBeenCalled();
  expect(notices).toEqual(['Hay una importación en curso']);
  expect(host.textContent).toContain('Download .zip…');
  // Terminó: el mismo botón pide el destino y arma el archivo.
  blocked = null;
  await click('Download .zip…');
  expect(f.picker).toHaveBeenCalledTimes(1); expect(s.producer).toHaveBeenCalledTimes(1); expect(notices).toHaveLength(1);
});
