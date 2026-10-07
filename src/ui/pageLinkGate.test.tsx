// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { ServicesContext, type Services } from '../services';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { openLocalDb } from '../sync/localDb';
import { PageTree } from '../sync/tree';
import { watchTitleRests } from '../sync/titleRest';
import { dirtyKey } from '../sync/localDb';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { storageNamesFor } from '../workspace';
import { schema } from './editorSchema';
import { PageView, type TitlePreparation } from './PageView';
import { preloadPageParts } from './PageView';
import './PageEditor';
import { pageLinkNavigation } from './internalLinks';
import { watchPendingWrites, reloadTimings } from './lazyPart';
import { closeComments, hasDrafts, setDraft } from './commentsUi';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const devices: Device[] = []; const roots: Root[] = []; const cleanup: (() => void)[] = [];
const wait = (ms = 50) => act(async () => new Promise((r) => setTimeout(r, ms)));
beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as never;
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
});
afterEach(async () => {
  cleanup.splice(0).forEach((f) => f()); for (const root of roots.splice(0)) act(() => root.unmount());
  for (const d of devices.splice(0)) { await d.engine.stop(); d.db.close(); d.mediaDb.close(); d.commentsDb.close(); }
  act(closeComments); document.body.innerHTML = ''; history.replaceState(null, '', '/'); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

async function fixture(readonly = false) {
  const server = new FakeServer(); server.enableComments(); let d = await makeDevice(server); devices.push(d);
  const page = await d.tree.create(null, 'Original'); await d.engine.syncNow();
  cleanup.push(watchTitleRests(d.tree, d.docs));
  const doc = await d.docs.open(page, { seed: true });
  const seed = BlockNoteEditor.create(withCollaboration({ schema, collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } } })) as unknown as BlockNoteEditor;
  seed.mount(document.createElement('div')); seed.replaceBlocks(seed.document, [{ type: 'paragraph', content: [
    { type: 'link', href: `/p/${ID}`, content: 'Propio' }, { type: 'text', text: ' ', styles: {} },
    { type: 'link', href: `/p/${ID}?w=isla_b#target`, content: 'Ajeno' },
  ] }]); await wait(); seed.unmount(); await d.docs.flush(page); d.docs.close(page); await d.engine.syncNow();
  if (readonly) {
    server.addMember('reader', 'guest', 'reader@test'); server.grant('reader', { pageId: page }, 'view');
    d = await makeDevice(server, undefined, undefined, undefined, undefined, { id: 'reader', email: 'reader@test' }); devices.push(d); await d.engine.syncNow();
  }
  const observed = await d.docs.open(page); const before = Y.encodeStateAsUpdate(observed); let updates = 0;
  observed.on('update', () => { updates++; }); cleanup.push(() => d.docs.close(page));
  const dirtyBefore = await d.db.get('meta', dirtyKey(page));
  const config = { url: 'https://aaaaaaaaaa.supabase.co', publishableKey: 'sb_publishable_aaaaaaaa', name: 'A', localKey: 'isla_a', storage: storageNamesFor('isla_a') };
  const client = { auth: { signOut: vi.fn() } } as never;
  const owner = { workspace: { config, client }, client, user: { id: d.remote.userId, email: 'u@test' }, db: d.db, dbName: d.db.name,
    tree: d.tree, docs: d.docs, files: d.files, media: d.media, engine: d.engine, access: d.access, remote: d.remote,
    mediaDb: d.mediaDb, comments: d.comments, commentsDb: d.commentsDb, sizes: d.sizes, offline: d.offline, shutdown: async () => undefined } as unknown as Services;
  history.replaceState(null, '', `/p/${page}?w=isla_a`);
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); roots.push(root);
  let title: TitlePreparation | undefined; let live = true;
  preloadPageParts();
  await act(async () => root.render(<ServicesContext.Provider value={owner}><PageView id={page} registerTitle={(t) => { title = t; return () => { title = undefined; }; }} /></ServicesContext.Provider>));
  for (let n = 0; n < 100 && !host.querySelector('a[data-inline-content-type=link]'); n++) await wait(100);
  expect(host.querySelectorAll('a[data-inline-content-type=link]')).toHaveLength(2);
  const unwatch = watchPendingWrites({ owner, current: () => live, stamp: () => title?.stamp(), prepare: () => title!.prepare(), flush: () => d.docs.flush(),
    unsaved: () => !!title?.unsaved() || d.docs.hasUnsavedEdits() || !!d.docs.getWriteError() || d.tree.hasUnsavedWrites() }); cleanup.push(unwatch);
  const refresh = async () => {
    await act(async () => root.render(<ServicesContext.Provider value={{ ...owner, user: { ...owner.user } }}><PageView id={page} registerTitle={(t) => { title = t; return () => { title = undefined; }; }} /></ServicesContext.Provider>));
  };
  return { d, server, page, host, root, before, observed, dirtyBefore, updates: () => updates, title: () => title, invalidate: () => { live = false; }, refresh };
}

describe('enlace en PageEditor y barrera de salida real', () => {
  it('mouseup con modificador lee la sesión renovada del mismo usuario y documento', async () => {
    const created = vi.spyOn(BlockNoteEditor, 'create'); const f = await fixture();
    const editor = created.mock.results.at(-1)!.value as BlockNoteEditor;
    const view = editor.prosemirrorView, dom = editor.domElement;
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    vi.spyOn(view, 'posAtCoords').mockReturnValue({ pos: 3, inside: -1 });
    const anchor = f.host.querySelector<HTMLAnchorElement>('a[data-inline-content-type=link]')!;
    const href = anchor.href; const count = created.mock.calls.length;
    const gesture = async () => {
      await act(async () => {
        anchor.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ctrlKey: true }));
        anchor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, ctrlKey: true }));
      });
    };
    await gesture(); expect(opened).toHaveBeenCalledTimes(1);
    await f.refresh(); await gesture(); expect(opened).toHaveBeenCalledTimes(2);
    expect(opened).toHaveBeenLastCalledWith(href, '_blank', 'noopener,noreferrer');
    expect(created.mock.calls).toHaveLength(count); expect(editor.domElement).toBe(dom);
    expect(f.d.docs.peek(f.page)).toBe(f.observed); expect(anchor.href).toBe(href);
    expect(f.updates()).toBe(0); expect(Y.encodeStateAsUpdate(f.observed)).toEqual(f.before);
    expect(await f.d.db.get('meta', dirtyKey(f.page))).toBe(f.dirtyBefore);
  });
  it('lector local conserva permiso y anchor antes de Enter: no usa el cliente de otra isla', async () => {
    const f = await fixture(true); expect(f.host.querySelector('.ProseMirror')!.getAttribute('contenteditable')).toBe('false');
    expect(f.d.remote.userId).toBe('reader');
    const anchors = f.host.querySelectorAll<HTMLAnchorElement>('a[data-inline-content-type=link]');
    expect(anchors[0].href).toBe(`${location.origin}/p/${ID}?w=isla_a`);
    const assign = vi.spyOn(pageLinkNavigation, 'assign').mockImplementation(() => undefined);
    await act(async () => anchors[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
    await wait(100); expect(assign).toHaveBeenCalledOnce(); expect(f.updates()).toBe(0);
  });
  it('antes de cualquier gesto muestra origenA y no ensucia; modifier/middle/Shift no salen de A', async () => {
    const f = await fixture(); const anchors = f.host.querySelectorAll<HTMLAnchorElement>('a[data-inline-content-type=link]');
    expect(anchors[0].href).toBe(`${location.origin}/p/${ID}?w=isla_a`);
    expect(anchors[1].getAttribute('href')).toBe(`/p/${ID}?w=isla_b#target`);
    await f.d.docs.flush(); expect(f.d.docs.isSaved(f.page)).toBe(true); expect(f.d.docs.hasUnsavedEdits()).toBe(false);
    expect(f.updates()).toBe(0); expect(Y.encodeStateAsUpdate(f.observed)).toEqual(f.before);
    expect(await f.d.db.get('meta', dirtyKey(f.page))).toBe(f.dirtyBefore); expect(f.dirtyBefore).toBeUndefined();
    const assign = vi.spyOn(pageLinkNavigation, 'assign').mockImplementation(() => undefined);
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { button: 1 }, { shiftKey: true }]) {
      await act(async () => anchors[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init })));
    }
    expect(assign).not.toHaveBeenCalled(); expect(location.search).toBe('?w=isla_a');
  });

  it.each(['saved', 'rejected', 'timeout', 'href', 'hash', 'owner', 'refresh', 'unmount', 'draft'] as const)('título1100 y salida A→B: %s', async (mode) => {
    const f = await fixture(); vi.stubGlobal('confirm', () => true);
    const assign = vi.spyOn(pageLinkNavigation, 'assign').mockImplementation(() => undefined);
    const input = f.host.querySelector<HTMLTextAreaElement>('.page-title')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    let release!: () => void; const held = new Promise<void>((r) => { release = r; });
    const original = f.d.tree.saveTitleDraft.bind(f.d.tree);
    const saving = vi.spyOn(f.d.tree, 'saveTitleDraft').mockImplementation(async (...args) => { await held; if (mode === 'rejected') throw new Error('Fallo local'); await original(...args); });
    const text = 'T'.repeat(1100); act(() => { input.focus(); setter.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(f.title()!.unsaved()).toBe(true);
    // Con el título guardado se sale apenas termina de guardarse, tarde lo que tarde: ahí el plazo no puede ser el que
    // decida (con la máquina cargada, guardar pasaba de los 1,2 s que tenía y la salida se frenaba sin que nada
    // estuviera mal). En los demás casos sigue corto: ninguno sale, y el de `timeout` lo deja vencer a propósito.
    const oldWait = reloadTimings.saveWaitMs; reloadTimings.saveWaitMs = mode === 'saved' ? 60_000 : 120; cleanup.push(() => { reloadTimings.saveWaitMs = oldWait; });
    const anchor = f.host.querySelectorAll<HTMLAnchorElement>('a[data-inline-content-type=link]')[1];
    await act(async () => anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    expect(saving).toHaveBeenCalledOnce();
    expect(assign).not.toHaveBeenCalled(); expect(location.search).toBe('?w=isla_a');
    if (mode === 'href') anchor.setAttribute('href', `/p/${ID}?w=isla_c`);
    if (mode === 'hash') history.replaceState(null, '', location.pathname + location.search + '#changed');
    if (mode === 'owner') f.invalidate();
    if (mode === 'refresh') await f.refresh();
    if (mode === 'unmount') { act(() => f.root.unmount()); roots.splice(roots.indexOf(f.root), 1); }
    if (mode === 'draft') act(() => setDraft(Symbol('draft'), true));
    if (mode === 'timeout') await wait(170);
    await act(async () => release()); await wait(mode === 'saved' ? 650 : 180);
    // La salida espera el guardado volviendo a mirar cada tanto: se espera a que salga, no un rato fijo.
    if (mode === 'saved') await act(() => vi.waitFor(() => expect(assign).toHaveBeenCalledTimes(1)));
    if (mode === 'saved') expect(anchor.isConnected).toBe(true);
    expect(assign).toHaveBeenCalledTimes(mode === 'saved' ? 1 : 0);
    if (mode === 'saved') {
      expect(assign).toHaveBeenCalledWith(`${location.origin}/p/${ID}?w=isla_b#target`);
      const fresh = await openLocalDb(f.d.db.name); const freshTree = new PageTree(fresh, f.server.workspaceId); await freshTree.load();
      expect(freshTree.get(f.page)!.title).toBe('T'.repeat(500));
      const rebuilt = new Y.Doc(); for (const update of await fresh.getAllFromIndex('docUpdates', 'pageId', f.page)) Y.applyUpdate(rebuilt, update.data);
      const xml = rebuilt.getXmlFragment(CONTENT_FRAGMENT).toString(); expect(xml).toContain('T'.repeat(600));
      expect(xml).toContain(`/p/${ID}?w=isla_b#target`); expect(xml).not.toContain(`/p/${ID}?w=isla_a`);
      rebuilt.destroy(); fresh.close();
    }
    if (mode === 'draft') expect(hasDrafts()).toBe(true);
  });
});
