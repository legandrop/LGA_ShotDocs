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
import { installEntityMarks, markFolderHolds } from './entitySync';
import { pageKind } from './kind';
// El editor de la página se arma antes (como en templateHost.test.tsx): si no, la primera prueba paga ese armado.
import '../ui/PageEditor';

// El título escrito en la página con pausas (auditoría de E2, B1 y O4): el título se guarda en cada pausa de 300 ms, y
// la marca de tipo cuenta recién al confirmarlo (Enter o salir del campo). Un episodio tipeado con una pausa antes del
// número no queda marcado escena, y una escena no sube números a medio escribir.

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
});

const wait = (ms = 30) => act(() => settled(ms));

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

async function setup() {
  const server = new FakeServer();
  const device = await makeDevice(server);
  installEntityMarks(device.tree, false);
  devices.push(device);
  await device.engine.syncNow();
  return { server, device };
}

async function open(device: Device, pageId: string) {
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
  await wait(100);
  return host.querySelector<HTMLTextAreaElement>('.page-title')!;
}

/** Tipea en el título como la persona: el valor nuevo y el evento de React. */
function typeTitle(title: HTMLTextAreaElement, value: string) {
  act(() => {
    title.focus();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(title, value);
    title.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Una pausa más larga que la del guardado del título (300 ms): el título a medio escribir queda guardado. */
const pause = () => wait(450);

describe('el título escrito en la página con pausas', () => {
  it('«Episodio » … «6» en una carpeta de escenas: el episodio no queda marcado y su escena sí, con su número', async () => {
    const { device } = await setup();
    const desglose = await device.tree.create(null, 'Desglose');
    await markFolderHolds(device.tree, desglose, 'scene');
    const ep = await device.tree.create(desglose, '');
    const title = await open(device, ep);
    typeTitle(title, 'Episodio ');
    await pause();
    expect(device.tree.get(ep)?.title).toBe('Episodio');
    expect(device.tree.get(ep)?.settings?.entity).toBeUndefined();
    typeTitle(title, 'Episodio 6');
    await pause();
    act(() => title.blur());
    await wait(100);
    expect(device.tree.get(ep)?.title).toBe('Episodio 6');
    expect(device.tree.get(ep)?.settings?.entity).toBeUndefined();
    expect(pageKind(device.tree, ep)).toEqual({ kind: 'none' });
    const esc = await device.tree.create(ep, '012 | Adentro del 6');
    expect(pageKind(device.tree, esc)).toMatchObject({ kind: 'scene', source: 'page' });
  });

  it('«10» … «106 | Episodio 6» con Enter: tampoco', async () => {
    const { device } = await setup();
    const desglose = await device.tree.create(null, 'Desglose');
    await markFolderHolds(device.tree, desglose, 'scene');
    const ep = await device.tree.create(desglose, '');
    const title = await open(device, ep);
    typeTitle(title, '10');
    await pause();
    typeTitle(title, '106 | Episodio 6');
    await pause();
    act(() => title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    await wait(100);
    expect(device.tree.get(ep)?.title).toBe('106 | Episodio 6');
    expect(device.tree.get(ep)?.settings?.entity).toBeUndefined();
    const esc = await device.tree.create(ep, '012 | Entra la policía');
    expect(device.tree.get(esc)?.settings?.entity).toEqual({ kind: 'scene', code: '106_012' });
  });

  it('una escena nueva adentro de un episodio: no sube números a medio escribir (105_000, 105_007), sí el final', async () => {
    const { device, server } = await setup();
    const desglose = await device.tree.create(null, 'Desglose');
    await markFolderHolds(device.tree, desglose, 'scene');
    const ep = await device.tree.create(desglose, '105 | Episodio 5');
    const esc = await device.tree.create(ep, '');
    const title = await open(device, esc);
    const seen: unknown[] = [];
    for (const step of ['0', '07', '074', '074 | Llegan al pozo']) {
      typeTitle(title, step);
      await pause();
      await act(() => device.engine.syncNow());
      seen.push(device.tree.get(esc)?.settings?.entity, server.pages.get(esc)?.settings?.entity);
    }
    expect(seen.every((v) => v === undefined)).toBe(true);
    act(() => title.blur());
    await wait(100);
    expect(device.tree.get(esc)?.settings?.entity).toEqual({ kind: 'scene', code: '105_074' });
  });

  it('renombrar una escena marcada en la página: el número cambia al confirmar, no en cada pausa', async () => {
    const { device } = await setup();
    const desglose = await device.tree.create(null, 'Desglose');
    await markFolderHolds(device.tree, desglose, 'scene');
    const esc = await device.tree.create(desglose, '101_074 | Llegan');
    const title = await open(device, esc);
    typeTitle(title, '101_0');
    await pause();
    typeTitle(title, '101_07');
    await pause();
    typeTitle(title, '101_075');
    await pause();
    expect(device.tree.get(esc)?.settings?.entity).toEqual({ kind: 'scene', code: '101_074' });
    typeTitle(title, '101_075 | Llegan');
    await pause();
    act(() => title.blur());
    await wait(100);
    expect(device.tree.get(esc)?.settings?.entity).toEqual({ kind: 'scene', code: '101_075' });
  });
});
