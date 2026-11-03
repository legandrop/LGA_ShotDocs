// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { settled } from '../test/settle';
import { shown } from '../test/shown';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { unmountAll } from './collabHarness';
import { LinkContext, type LinkInfo } from '../linkMode';
import { pageDocTitle, resetTitleBadge, setTitleCount } from './titleBadge';
// El editor de la página se arma antes (como en titleTyping.test.tsx).
import './PageEditor';

// El título de la pestaña de una página lleva el proyecto: `<página> · <proyecto> · Shot Docs`.

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
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

const roots: Root[] = [];
const devices: Device[] = [];
afterEach(async () => {
  unmountAll();
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  document.body.innerHTML = '';
  history.replaceState(null, '', '/');
  resetTitleBadge();
});

function services(d: Device): Services {
  const config = { url: 'https://example.test', publishableKey: 'sb_publishable_test', name: 'Wanka', localKey: WANKA_LOCAL_KEY, storage: legacyStorageNames(WANKA_LOCAL_KEY) };
  const client = { auth: { signOut: vi.fn() } } as never;
  return {
    workspace: { config, client },
    client,
    user: { id: d.remote.userId, email: `${d.remote.userId}@test` },
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

async function open(device: Device, pageId: string, link: LinkInfo | null = null): Promise<void> {
  const { PageView } = await import('./PageView');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <ServicesContext.Provider value={services(device)}>
        <LinkContext.Provider value={link}>
          <main className="main">
            <PageView id={pageId} />
          </main>
        </LinkContext.Provider>
      </ServicesContext.Provider>,
    ),
  );
  await shown(() => expect(host.querySelector('.bn-editor')).not.toBeNull());
  await act(() => settled(50));
}

describe('el título de la pestaña de una página', () => {
  it('lleva el nombre del proyecto entre la página y Shot Docs', async () => {
    const device = await makeDevice(new FakeServer());
    devices.push(device);
    await device.engine.syncNow();
    const id = await device.tree.create(null, 'Plan de rodaje');
    const project = device.tree.project(device.tree.get(id)!.workspace_id)!.name;
    expect(project).toBeTruthy();
    await open(device, id);
    expect(document.title).toBe(`Plan de rodaje · ${project} · Shot Docs`);
  });

  it('se actualiza al renombrar el proyecto y lleva el (n) de menciones', async () => {
    const device = await makeDevice(new FakeServer());
    devices.push(device);
    await device.engine.syncNow();
    const id = await device.tree.create(null, 'Plan de rodaje');
    const ws = device.tree.get(id)!.workspace_id;
    await open(device, id);
    await act(async () => {
      await device.tree.renameProject(ws, 'Nombre Nuevo');
      await settled(50);
    });
    expect(document.title).toBe('Plan de rodaje · Nombre Nuevo · Shot Docs');
    act(() => setTitleCount(3));
    expect(document.title).toBe('(3) Plan de rodaje · Nombre Nuevo · Shot Docs');
  });

  it('con un link público no lleva proyecto (ahí es la página compartida)', async () => {
    const device = await makeDevice(new FakeServer());
    devices.push(device);
    await device.engine.syncNow();
    const id = await device.tree.create(null, 'Plan de rodaje');
    await open(device, id, { entry: {}, domain: 'x.supabase.co', linkId: '', pageId: id } as unknown as LinkInfo);
    expect(document.title).toBe('Plan de rodaje · Shot Docs');
  });

  it('sin proyecto conocido queda «<página> · Shot Docs»', () => {
    expect(pageDocTitle('Plan', undefined)).toBe('Plan · Shot Docs');
    expect(pageDocTitle('Plan', 'ERSO')).toBe('Plan · ERSO · Shot Docs');
    expect(pageDocTitle('Plan', '')).toBe('Plan · Shot Docs');
  });
});
