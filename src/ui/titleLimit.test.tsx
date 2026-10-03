// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { codePointLength } from '../lib/dbLimits';
import { watchTitleRests } from '../sync/titleRest';
import { notify } from './notice';


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

// El tope del título (500 caracteres, el de la base): pegar más lo corta y lo que sobra va al principio de la página;
// teclear más no entra. Antes, el cambio quedaba rechazado por el servidor para siempre (Doc_Sincronizacion.md).

async function open(d: Device, page: string): Promise<HTMLTextAreaElement> {
  const { PageView } = await import('./PageView');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <ServicesContext.Provider value={services(d)}>
        <main className="main">
          <PageView id={page} />
        </main>
      </ServicesContext.Provider>,
    ),
  );
  return host.querySelector<HTMLTextAreaElement>('.page-title')!;
}

/** Cambia el valor como lo hace el navegador y avisa a React con el evento que corresponde. */
function input(el: HTMLTextAreaElement, value: string, event: Event): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(event);
  });
}

function notices(): string[] {
  const seen: string[] = [];
  window.addEventListener('shotdocs:notice', (e) => {
    const detail = (e as CustomEvent<string | { message: string }>).detail;
    seen.push(typeof detail === 'string' ? detail : detail.message);
  });
  return seen;
}

describe('el título de la página tiene el tope de la base', () => {
  it('pegar 800 caracteres: el título queda en 500, sube, y lo demás es el primer párrafo del editor', async () => {
    const server = new FakeServer();
    const device = await makeDevice(server);
    devices.push(device);
    const stop = watchTitleRests(device.tree, device.docs, (r) => notify(`movido ${r.pageId}`));
    const seen = notices();
    const page = await device.tree.create(null, 'Algo');
    await device.engine.syncNow();
    const title = await open(device, page);
    for (let i = 0; i < 100 && !document.querySelector('.bn-editor'); i++) await wait(50);

    const pasted = `${'Escena '.repeat(70)}y el resto del texto pegado`; // 517 caracteres
    const long = pasted + '\nsegundo renglón ' + 'z'.repeat(250);
    act(() => void title.dispatchEvent(new Event('paste', { bubbles: true })));
    input(title, long, new Event('input', { bubbles: true }));
    expect(codePointLength(title.value)).toBeLessThanOrEqual(500);
    expect(long.startsWith(title.value)).toBe(true);
    for (let i = 0; i < 100 && (device.tree.titleRests().length > 0 || !document.querySelector('.bn-editor')?.textContent?.includes('segundo renglón')); i++) await wait(30);
    expect(device.tree.get(page)?.title).toBe(title.value.trim());
    const editorText = document.querySelector('.bn-editor')?.textContent ?? '';
    const firstLine = long.slice(title.value.length, long.indexOf('segundo renglón')).trim();
    expect(firstLine).toMatch(/del texto pegado$/);
    expect(editorText).toContain(firstLine);
    expect(editorText).toContain(`segundo renglón ${'z'.repeat(250)}`);
    expect(seen).toContain(`movido ${page}`);
    await device.engine.syncNow();
    expect(server.pages.get(page)?.title).toBe(title.value.trim());
    expect(device.engine.getStatus().failedOps).toBe(0);
    // Salir del título no vuelve a mandar nada (ni repite el párrafo).
    act(() => title.blur());
    await wait();
    expect(device.tree.titleRests()).toEqual([]);
    expect(device.tree.pendingOps()).toEqual([]);
    stop();
  });

  it('teclear pasado el tope no entra y avisa', async () => {
    const server = new FakeServer();
    const device = await makeDevice(server);
    devices.push(device);
    const seen = notices();
    const page = await device.tree.create(null, 'x'.repeat(500));
    const title = await open(device, page);
    input(title, `${'x'.repeat(500)}y`, new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'y' }));
    expect(title.value).toBe('x'.repeat(500));
    expect(seen.some((m) => m.includes('500'))).toBe(true);
    await wait(400);
    expect(device.tree.titleRests()).toEqual([]);
    expect(device.tree.get(page)?.title).toBe('x'.repeat(500));
  });

  it('un emoji en el borde no se parte', async () => {
    const server = new FakeServer();
    const device = await makeDevice(server);
    devices.push(device);
    const page = await device.tree.create(null, '');
    const title = await open(device, page);
    act(() => void title.dispatchEvent(new Event('paste', { bubbles: true })));
    input(title, `${'é'.repeat(499)}🎬🎬🎬`, new Event('input', { bubbles: true }));
    expect(title.value).toBe(`${'é'.repeat(499)}🎬`);
    await wait();
    expect(device.tree.get(page)?.title).toBe(`${'é'.repeat(499)}🎬`);
    expect(device.tree.titleRests().map((r) => r.text)).toEqual(['🎬🎬']);
  });
});
