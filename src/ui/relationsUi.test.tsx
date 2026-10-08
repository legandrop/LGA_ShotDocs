// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { settled } from '../test/settle';
import { pagePath } from '../router';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { PROGRESS_MIN_PAGES } from '../search/projectIndex';
import { searchSession } from './projectSearchUi';
import { relationsSession } from './relationsUi';
import { Shell } from './Workspace';

// Las relaciones en vivo en la app de verdad (Docs/Doc_Relaciones.md, secciones 5 y 6): el índice arranca al abrir el
// proyecto, sin abrir el panel de buscar, y mientras lee muchas páginas el pie de la barra lateral dice cuántas lleva.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  history.replaceState(null, '', '/');
});

const wait = (ms = 30) => act(() => settled(ms));

async function until(check: () => unknown, what: string, tries = 250): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (check()) return;
    await wait(40);
  }
  throw new Error(`no llegó: ${what}`);
}

function services(device: Device): Services {
  return {
    workspace: { config: { url: 'https://x.supabase.co', publishableKey: 'k', name: 'W', localKey: WANKA_LOCAL_KEY, storage: legacyStorageNames(WANKA_LOCAL_KEY) }, client: {} },
    client: { auth: { signOut: vi.fn() } },
    user: { id: device.remote.userId, email: 'a@test' },
    db: device.db,
    tree: device.tree,
    docs: device.docs,
    files: device.files,
    media: device.media,
    engine: device.engine,
    access: device.access,
    remote: device.remote as unknown as SupabaseRemote,
    dbName: 'test',
    mediaDb: device.mediaDb,
    comments: device.comments,
    commentsDb: device.commentsDb,
    sizes: device.sizes,
    shutdown: async () => undefined,
  } as unknown as Services;
}

async function edit(d: Device, pageId: string, text: string): Promise<void> {
  const doc = await d.docs.open(pageId);
  const fragment = doc.getXmlFragment(CONTENT_FRAGMENT);
  doc.transact(() => {
    fragment.insert(0, [new Y.XmlElement('blockGroup')]);
    const container = new Y.XmlElement('blockContainer');
    container.setAttribute('id', `b-${pageId}`);
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.insert(0, [new Y.XmlText(text)]);
    container.insert(0, [paragraph]);
    (fragment.get(0) as Y.XmlElement).insert(0, [container]);
  });
  d.docs.close(pageId);
  await d.docs.flush();
}

describe('relaciones en la app', () => {
  it('al abrir el proyecto el índice lee solo, y el pie dice cuánto lleva mientras lee muchas páginas', async () => {
    const d = await makeDevice(new FakeServer());
    devices.push(d);
    const ids: string[] = [];
    for (let i = 0; i <= PROGRESS_MIN_PAGES; i++) {
      const id = await d.tree.create(null, `Página ${i}`);
      await edit(d, id, `texto ${i}`);
      ids.push(id);
    }
    await d.engine.syncNow();
    // La última página queda frenada hasta que la prueba la suelta: así se ve el progreso a mitad de camino.
    const real = d.docs.indexSnapshot.bind(d.docs);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    vi.spyOn(d.docs, 'indexSnapshot').mockImplementation(async (pageId) => {
      if (pageId === ids[ids.length - 1]) await held;
      return real(pageId);
    });
    history.replaceState(null, '', pagePath(ids[0]));
    const s = services(d);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    act(() =>
      root.render(
        <ServicesContext.Provider value={s}>
          <Shell />
        </ServicesContext.Provider>,
      ),
    );
    const label = () => host.querySelector<HTMLElement>('.sidebar .index-progress');
    await until(() => label()?.textContent?.startsWith('Reading'), 'el progreso');
    expect(label()!.textContent).toMatch(new RegExp(`^Reading \\d+ of ${ids.length}…$`));
    expect(label()!.getAttribute('data-tip')).toBeTruthy();
    expect(label()!.hasAttribute('title')).toBe(false);
    // Sin abrir el panel de buscar.
    expect(document.querySelector('.search-panel')).toBeNull();
    release();
    await until(() => !label(), 'que el progreso se vaya solo');
    const index = searchSession(s).index;
    expect(ids.every((id) => index.has(id))).toBe(true);
    // Las relaciones tienen su foto, completa.
    await until(() => relationsSession(s).relations.snapshot(d.tree.workspaceId)?.complete, 'la foto de las relaciones');
  });
});
