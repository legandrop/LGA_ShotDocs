// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';

// La página con el editor cargado aparte (roadmap B.4): el título y el encabezado salen enseguida, el cuerpo
// muestra un esqueleto y el editor se monta cuando termina de bajar. Este archivo no importa el editor.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  // jsdom no trae estas dos; Mantine las pide.
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
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  document.body.innerHTML = '';
});

const wait = (ms = 30) => act(async () => new Promise((r) => setTimeout(r, ms)));

function services(d: Device): Services {
  const config = {
    url: 'https://znlvpuddswymxpffgvbz.supabase.co',
    publishableKey: 'sb_publishable_test',
    name: 'Wanka',
    localKey: WANKA_LOCAL_KEY,
    storage: legacyStorageNames(WANKA_LOCAL_KEY),
  };
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
    shutdown: async () => undefined,
  };
}

describe('la página', () => {
  it('el título sale enseguida y el editor se monta cuando termina de bajar', async () => {
    const server = new FakeServer();
    const device = await makeDevice(server);
    devices.push(device);
    const page = await device.tree.create(null, 'Escena 64');
    await device.engine.syncNow();

    const { PageView } = await import('./PageView');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    act(() =>
      root.render(
        <ServicesContext.Provider value={services(device)}>
          <main className="main">
            <PageView id={page} />
          </main>
        </ServicesContext.Provider>,
      ),
    );
    expect(host.querySelector<HTMLTextAreaElement>('.page-title')?.value).toBe('Escena 64');
    expect(host.querySelector('.editor-skeleton')).not.toBeNull();
    expect(host.querySelector('.bn-editor')).toBeNull();

    for (let i = 0; i < 100 && !host.querySelector('.bn-editor'); i++) await wait(50);
    expect(host.querySelector('.bn-editor')).not.toBeNull();
    expect(host.querySelector('.editor-skeleton')).toBeNull();
  });
});
