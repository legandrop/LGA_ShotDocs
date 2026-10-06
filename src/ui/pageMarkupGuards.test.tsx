// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { ServicesContext, type Services } from '../services';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { addShape, PHOTO_MARKUP_MAP } from '../media/markup';
import { PRUNE_AFTER_MS, PRUNE_EVERY_MS } from '../media/markupPrune';
import { WANKA_LOCAL_KEY, legacyStorageNames } from '../workspace';
import { mountEditor } from './collabHarness';
import { AnnotateButton } from './MediaBar';
import { PageEditor } from './PageEditor';

// El menú aloja el botón real bajo el contexto que crea PageEditor: observa la oferta de Annotate aunque otra barra
// ya esté oculta. PageEditor, permisos, editor, documento, motor y poda son reales; no se reemplazan sus guardas.
vi.mock('./BlockSideMenu', () => ({ BlockSideMenuController: () => <AnnotateButton url="sdmedia://0f8fad5b-d9cb-469f-a165-708677289501" name="Set.jpg" kind="image" /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const FILE = '0f8fad5b-d9cb-469f-a165-708677289501', roots: Root[] = [], devices: Device[] = [];
beforeAll(() => {
  window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as never;
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
});
afterEach(async () => {
  vi.useRealTimers();
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const d of devices.splice(0)) { await d.engine.stop(); d.db.close(); d.mediaDb.close(); d.commentsDb.close(); }
  document.body.innerHTML = '';
});
const wait = (ms = 20) => act(async () => new Promise(r => setTimeout(r, ms)));
async function until(ok: () => boolean) { for (let i = 0; i < 100 && !ok(); i++) await wait(); expect(ok(), 'consumidor listo').toBe(true); }
function services(d: Device): Services {
  const config = { url: 'http://local.invalid', publishableKey: 'local-test', name: 'Wanka', localKey: WANKA_LOCAL_KEY, storage: legacyStorageNames(WANKA_LOCAL_KEY) }, client = { auth: {} };
  return { ...d, workspace: { config, client }, client, user: { id: d.remote.userId, email: 'local@test' }, dbName: 'local-test', shutdown: async () => undefined } as unknown as Services;
}
async function mount(d: Device, pageId: string) {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host); roots.push(root);
  await act(async () => root.render(<ServicesContext.Provider value={services(d)}><PageEditor pageId={pageId} /></ServicesContext.Provider>));
  await until(() => !!host.querySelector('.ProseMirror'));
  return host;
}
async function fixture() {
  const server = new FakeServer(); server.enableComments();
  const d = await makeDevice(server); devices.push(d);
  const pageId = await d.tree.create(null, 'Set'); await d.engine.syncNow();
  const doc = await d.docs.open(pageId, { seed: true }), ed = mountEditor(doc);
  ed.replaceBlocks(ed.document, [{ id: 'p', type: 'paragraph', content: 'Plano 1' }, { id: 'f', type: 'image', props: { url: `sdmedia://${FILE}`, name: 'Set.jpg' } }] as never);
  addShape(doc, FILE, 'line', { type: 'line', zValue: 1, posX: 1, posY: 1, startX: 0, startY: 0, endX: 9, endY: 9 }, { w: 100, h: 100 });
  await d.docs.flush(pageId); await d.engine.syncNow(); ed.unmount();
  return { server, d, pageId, doc };
}
it('PageEditor: Ver no ofrece Annotate ni escribe con teclas; Editar sí ofrece el botón real', async () => {
  const { server, pageId } = await fixture();
  server.addMember('viewer', 'guest', 'viewer@test'); server.grant('viewer', { pageId }, 'view');
  const d = await makeDevice(server, undefined, undefined, undefined, undefined, { id: 'viewer' }); devices.push(d); await d.engine.syncNow();
  const host = await mount(d, pageId), doc = await d.docs.open(pageId);
  expect(host.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('false');
  expect(host.querySelector('[data-test="mediaAnnotate"]'), 'Ver no ofrece Annotate').toBeNull();
  const before = JSON.stringify({ markup: doc.getMap(PHOTO_MARKUP_MAP).toJSON(), content: doc.getXmlFragment(CONTENT_FRAGMENT).toString() });
  for (const key of ['a', 'n', 'z']) await act(async () => host.querySelector('.ProseMirror')!.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: key === 'z', bubbles: true })));
  expect(JSON.stringify({ markup: doc.getMap(PHOTO_MARKUP_MAP).toJSON(), content: doc.getXmlFragment(CONTENT_FRAGMENT).toString() })).toBe(before);
  expect(await d.docs.unsyncedPages()).toEqual([]);
  server.grant('viewer', { pageId }, 'edit');
  await act(async () => d.engine.syncNow());
  await until(() => !!host.querySelector('[data-test="mediaAnnotate"]'));
  expect(host.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('true');
});
it.each(['local', 'remote', 'offline', 'ready'] as const)('PageEditor: la poda espera sincronización real (%s)', async (state) => {
  const { server, d, pageId, doc } = await fixture(), seed = mountEditor(doc);
  seed.removeBlocks(['f']); seed.unmount(); await d.docs.flush(pageId); await d.engine.syncNow();
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  const host = await mount(d, pageId);
  await act(async () => d.engine.syncNow());
  expect(host.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('true');
  if (state === 'local') await act(async () => { const local = mountEditor(doc); local.updateBlock('p', { content: 'Plano 1 pendiente de subir' }); local.unmount(); await d.docs.flush(pageId); expect(await d.docs.unsyncedPages()).toContain(pageId); });
  if (state === 'remote') {
    const other = await makeDevice(server); devices.push(other); await other.engine.syncNow();
    const remoteDoc = await other.docs.open(pageId), remoteEditor = mountEditor(remoteDoc); remoteEditor.updateBlock('p', { content: 'Plano 1 pendiente de bajar' }); remoteEditor.unmount(); await other.docs.flush(pageId); await other.engine.syncNow();
    const projects = await d.remote.fetchProjects(10), rows = await d.remote.fetchTree(projects.map(p => p.id), 10); await act(async () => d.tree.setSnapshot(rows, projects));
    expect(await d.engine.isMissingContent(pageId)).toBe(true);
  }
  if (state === 'offline') { server.online = false; await act(async () => d.engine.syncNow()); expect(d.engine.getStatus().online).toBe(false); }
  const map = doc.getMap(PHOTO_MARKUP_MAP), before = JSON.stringify(map.toJSON());
  expect(map.has(`${FILE}/line`)).toBe(true);
  for (let i = 0; i < PRUNE_AFTER_MS / PRUNE_EVERY_MS + 2; i++) { await act(async () => vi.advanceTimersByTimeAsync(PRUNE_EVERY_MS)); await wait(); }
  if (state === 'ready') expect(map.size, 'poda con página sincronizada').toBe(0);
  else expect(JSON.stringify(map.toJSON()), 'no poda con página sin sincronizar').toBe(before);
});
