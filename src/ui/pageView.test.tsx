// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { saveBeforeExit, watchPendingWrites, reloadTimings } from './lazyPart';
import type { TitlePreparation } from './PageView';

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
afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const d of devices.splice(0)) {
    await d.engine.stop();
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
    offline: d.offline,
    shutdown: async () => undefined,
  };
}

describe('la página', () => {
  it.each(['guardado', 'rechazo', 'contexto'] as const)('la salida conserva el título real: %s', async (mode) => {
    const device = await makeDevice(new FakeServer());
    devices.push(device);
    const page = await device.tree.create(null, 'Original');
    const owner = services(device);
    const { PageView } = await import('./PageView');
    let title: TitlePreparation | undefined;
    let live = true;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    act(() => root.render(<ServicesContext.Provider value={owner}><PageView id={page} registerTitle={(p) => {
      title = p; return () => { title = undefined; };
    }} /></ServicesContext.Provider>));
    const input = host.querySelector<HTMLTextAreaElement>('.page-title')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    act(() => { input.focus(); setter.call(input, 'Título nuevo'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(title?.unsaved()).toBe(true);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const saveTitleDraft = device.tree.saveTitleDraft.bind(device.tree);
    const blocked = vi.spyOn(device.tree, 'saveTitleDraft').mockImplementation(async (...args) => {
      await held;
      if (mode === 'rechazo') throw new Error('IndexedDB rechazó la escritura');
      await saveTitleDraft(...args);
    });
    const oldWait = reloadTimings.saveWaitMs;
    reloadTimings.saveWaitMs = 120;
    const unwatch = watchPendingWrites({ owner, current: () => live,
      stamp: () => title?.stamp(),
      prepare: () => title!.prepare(), flush: () => device.docs.flush(),
      unsaved: () => !!title?.unsaved() || device.tree.hasUnsavedWrites() || device.docs.hasUnsavedEdits(),
    });
    const exit = vi.fn();
    try {
      let leaving!: Promise<boolean>;
      act(() => { leaving = saveBeforeExit(owner, () => live, exit); });
      expect(exit).not.toHaveBeenCalled();
      expect(blocked).toHaveBeenCalledTimes(1);
      if (mode === 'contexto') live = false;
      await act(async () => { release(); await leaving; });
      expect(exit).toHaveBeenCalledTimes(mode === 'guardado' ? 1 : 0);
      expect(input.value).toBe('Título nuevo');
      if (mode === 'rechazo') {
        expect(device.tree.get(page)?.title).toBe('Original');
        blocked.mockRestore();
        reloadTimings.saveWaitMs = oldWait;
        await act(async () => { await saveBeforeExit(owner, () => live, exit); });
        expect(exit).toHaveBeenCalledTimes(1);
      }
      const ops = await device.db.getAll('ops');
      expect(ops.some((o) => o.op.kind === 'update' && o.op.id === page && o.op.patch.title === 'Título nuevo')).toBe(true);
    } finally { unwatch(); blocked.mockRestore(); reloadTimings.saveWaitMs = oldWait; }
  });

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

  it('si la página se cierra mientras su contenido se está abriendo y esa apertura falla después (la base ya cerrada), no queda un rechazo sin atrapar', async () => {
    const device = await makeDevice(new FakeServer());
    devices.push(device);
    const page = await device.tree.create(null, 'Escena 65');
    await device.engine.syncNow();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const opening = vi.spyOn(device.docs, 'open').mockImplementation(async () => {
      await held;
      throw new DOMException('The database connection is closing.', 'InvalidStateError');
    });
    const loose: unknown[] = [];
    const onLoose = (reason: unknown) => { loose.push(reason); };
    process.on('unhandledRejection', onLoose);
    try {
      const { PageView } = await import('./PageView');
      const host = document.createElement('div');
      document.body.append(host);
      const root = createRoot(host);
      act(() => root.render(<ServicesContext.Provider value={services(device)}><main className="main"><PageView id={page} /></main></ServicesContext.Provider>));
      for (let i = 0; i < 100 && !opening.mock.calls.length; i++) await wait(50);
      expect(opening).toHaveBeenCalled();
      act(() => root.unmount());
      release();
      await wait(50);
      await wait(50);
      expect(loose).toEqual([]);
    } finally {
      process.off('unhandledRejection', onLoose);
      opening.mockRestore();
    }
  });
});
