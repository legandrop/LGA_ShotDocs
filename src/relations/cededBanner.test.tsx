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
import { unmountAll } from '../ui/collabHarness';
import { pagePath } from '../router';
import { cedeCopy } from './cededCopy';
// El editor de la página se arma antes (como en titleTyping.test.tsx).
import '../ui/PageEditor';

// La página de la copia que cedió (D580, D628): quien la abre ve por qué está en la papelera y cómo ir a la que quedó.

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

async function open(device: Device, pageId: string): Promise<HTMLElement> {
  const { PageView } = await import('../ui/PageView');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <ServicesContext.Provider value={services(device)}>
        <main className="main">
          <PageView id={pageId} />
        </main>
      </ServicesContext.Provider>,
    ),
  );
  await shown(() => expect(host.querySelector('.bn-editor')).not.toBeNull());
  await act(() => settled(50));
  return host;
}

describe('el cartel de la copia que cedió', () => {
  it('dice por qué está en la papelera, que escribir la trae de vuelta, y lleva a la que quedó', async () => {
    const device = await makeDevice(new FakeServer());
    devices.push(device);
    await device.engine.syncNow();
    const kept = await device.tree.create(null, '2026-03-16 | Día 77');
    const copy = await device.tree.create(null, '2026-03-16 | Día 77');
    await cedeCopy(device.tree, copy, kept);
    const host = await open(device, copy);
    const banner = host.querySelector<HTMLElement>('.banner')!;
    expect(banner.textContent).toContain('This copy went to the trash: another device created the same day at the same time. Write in the one that stayed; what is written here brings the copy back once a device that can restore pages syncs.');
    const buttons = [...banner.querySelectorAll<HTMLButtonElement>('button')].map((b) => b.textContent);
    expect(buttons).toEqual(['Open “2026-03-16 | Día 77”', 'Restore']);
    act(() => banner.querySelector<HTMLButtonElement>('button')!.click());
    expect(location.pathname).toBe(pagePath(kept));
  });

  it('una página que va a la papelera a mano tiene el cartel de siempre; la que quedó, en la papelera, no se ofrece', async () => {
    const device = await makeDevice(new FakeServer());
    devices.push(device);
    await device.engine.syncNow();
    const kept = await device.tree.create(null, '2026-03-16 | Día 77');
    const copy = await device.tree.create(null, '2026-03-16 | Día 77');
    const plain = await device.tree.create(null, 'Notas');
    await device.tree.trash(plain);
    const host = await open(device, plain);
    expect(host.querySelector('.banner')!.textContent).toBe('This page is in the trash.Restore');
    await cedeCopy(device.tree, copy, kept);
    await device.tree.trash(kept);
    const host2 = await open(device, copy);
    expect([...host2.querySelectorAll<HTMLButtonElement>('.banner button')].map((b) => b.textContent)).toEqual(['Restore']);
  });
});
