// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { prefs } from '../prefs';
import { ServicesContext, type Services } from '../services';
import { CONTENT_FRAGMENT } from '../sync/structure';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { appendPart, getCopy, listMarks, offviewKey, putOfflineView } from '../media/offlineStore';
import { MEDIA_SCHEME, mediaIdOf } from '../media/queue';
import { OfflineDialog, StorageDialog } from './OfflinePart';
import { SpaceHost } from './SpaceHost';
import { SyncIcon } from './SyncBadge';

// La ventana "Available offline", "Storage on this device", el aviso del tope y "Offline · N" en el teléfono
// (P.10, Docs/Doc_Copias_Locales.md), contra el servidor y el portero en memoria.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MB = 1024 * 1024;
const roots: Root[] = [];
const devices: Device[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const d of devices.splice(0)) {
    d.offline.stop();
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
  }
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  act(() => prefs.set({ language: 'en' }));
});

function services(d: Device): Services {
  const config = {
    url: 'https://znlvpuddswymxpffgvbz.supabase.co',
    publishableKey: 'sb_publishable_test',
    name: 'Wanka',
    localKey: WANKA_LOCAL_KEY,
    storage: legacyStorageNames(WANKA_LOCAL_KEY),
  };
  const client = { auth: { getSession: async () => ({ data: { session: null } }) } } as never;
  return {
    workspace: { config, client },
    client,
    user: { id: 'owner', email: 'owner@test' },
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

const settle = (ms = 30) => act(async () => new Promise((r) => setTimeout(r, ms)));

async function mount(value: Services, node: React.ReactNode): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<ServicesContext.Provider value={value}>{node}</ServicesContext.Provider>));
  await settle();
  return host;
}

async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timeout');
    await settle(20);
  }
}

async function sync(d: Device): Promise<void> {
  for (let i = 0; i < 2; i++) {
    await d.engine.syncNow();
    await d.engine.syncMedia();
  }
}

/** Una página con dos fotos y un video subidos desde otro dispositivo. */
async function setup() {
  const server = new FakeServer();
  server.enableTrash();
  const a = await makeDevice(server);
  devices.push(a);
  await sync(a);
  const page = await a.tree.create(null, 'Escena 12');
  await sync(a);
  const ids: string[] = [];
  for (const [name, type] of [
    ['IMG_0001.JPG', 'image/jpeg'],
    ['IMG_0002.JPG', 'image/jpeg'],
    ['IMG_0003.MOV', 'video/quicktime'],
  ] as const) {
    ids.push(mediaIdOf(await a.media.add(page, new File([new Uint8Array(MB).fill(3)], name, { type })))!);
  }
  const doc = await a.docs.open(page);
  doc.transact(() => {
    const fragment = doc.getXmlFragment(CONTENT_FRAGMENT);
    const group = new Y.XmlElement('blockGroup');
    fragment.insert(0, [group]);
    for (const id of ids) {
      const container = new Y.XmlElement('blockContainer');
      container.setAttribute('id', crypto.randomUUID());
      const image = new Y.XmlElement('image');
      image.setAttribute('url', MEDIA_SCHEME + id);
      container.insert(0, [image]);
      group.insert(group.length, [container]);
    }
  });
  a.docs.close(page);
  await a.docs.flush();
  await sync(a);
  const b = await makeDevice(server);
  devices.push(b);
  await sync(b);
  return { server, a, b, page, ids };
}

describe('la ventana "Available offline"', { timeout: 30_000 }, () => {
  it('pesa todas las filas (también lo destildado), muestra el total y arranca; termina en "listo"', async () => {
    const { b, page, ids } = await setup();
    const host = await mount(services(b), <OfflineDialog kind="page" target={page} onClose={() => undefined} />);
    await until(() => !host.querySelector('.offline-total .offline-spinner'));
    const rows = [...host.querySelectorAll('.offline-row')].map((r) => r.textContent ?? '');
    expect(rows[0]).toContain('Large photos (2048 px)');
    expect(rows[0]).toContain('2 photos');
    expect(rows[1]).toContain('Original photos');
    expect(rows[1]).toContain('2 MB');
    expect(rows[3]).toContain('Videos');
    expect(rows[3]).toContain('1 video');
    const checks = [...host.querySelectorAll<HTMLInputElement>('.offline-row input[type=checkbox]')].map((c) => c.checked);
    expect(checks).toEqual([true, false, true, false]);
    expect(host.querySelector('.offline-total strong')?.textContent).toMatch(/^Selected: ≈.* · downloads ≈/);
    expect(host.textContent).toContain('Kept automatically:');

    const start = [...host.querySelectorAll('button')].find((x) => x.textContent === 'Make available offline')!;
    expect(start.disabled).toBe(false);
    await act(async () => start.click());
    await until(() => host.textContent!.includes('Ready to use offline'), 15_000);
    // Lo que se baja de verdad lo prueban src/media/offline.test.ts (acá, con jsdom, los Blob de la red no son los de IndexedDB).
    expect((await listMarks(b.mediaDb))[0]).toMatchObject({ kind: 'page', target: page, state: 'ready' });
    void ids;
  });

  it('no arranca si no entra (contando la reserva para fotos y videos nuevos) y lo dice', async () => {
    const { b, page } = await setup();
    vi.stubGlobal('navigator', {
      ...navigator,
      onLine: true,
      storage: { estimate: async () => ({ quota: 4 * 1024 * MB, usage: 4 * 1024 * MB - 2 * MB }), persisted: async () => true, persist: async () => true },
    });
    const host = await mount(services(b), <OfflineDialog kind="page" target={page} onClose={() => undefined} />);
    await until(() => !host.querySelector('.offline-total .offline-spinner'));
    await settle();
    const start = [...host.querySelectorAll('button')].find((x) => x.textContent === 'Make available offline')!;
    expect(start.disabled).toBe(true);
    expect(host.querySelector('.error')?.textContent).toMatch(/^Needs .*; .* available, keeping 1 GB for new photos and videos\.$/);
  });

  it('una marca existente: estado, sacar con la casilla de borrar las copias', async () => {
    const { b, page, ids } = await setup();
    await b.offline.mark('page', page);
    await b.offline.idle();
    const host = await mount(services(b), <OfflineDialog kind="page" target={page} onClose={() => undefined} />);
    await until(() => host.textContent!.includes('Ready to use offline'));
    const remove = [...host.querySelectorAll('button')].find((x) => x.textContent === 'Remove')!;
    await act(async () => remove.click());
    expect(host.textContent).toContain('Stop keeping “Escena 12” offline?');
    expect(host.querySelector<HTMLInputElement>('.offline-remove input')!.checked).toBe(true);
    const confirm = [...host.querySelectorAll('.offline-remove button')].find((x) => x.textContent === 'Remove') as HTMLButtonElement;
    await act(async () => confirm.click());
    await settle();
    expect(await listMarks(b.mediaDb)).toEqual([]);
    expect(await b.mediaDb.get('thumbs', offviewKey(ids[0]))).toBeUndefined();
  });
});

describe('"Storage on this device" y el aviso del tope', () => {
  it('muestra lo guardado con su tope, lo marcado, y libera recién con la confirmación', async () => {
    const { b, ids } = await setup();
    // Tres copias bajadas que ninguna marca pide (como después de desmarcar sin borrar).
    for (const id of ids) await appendPart(b.mediaDb, id, 'image/jpeg', MB, 0, new Blob([new Uint8Array(MB)]), Date.now());
    await b.offline.setLimit(1024 * MB);
    const host = await mount(services(b), <StorageDialog onClose={() => undefined} onEdit={() => undefined} />);
    await settle();
    expect(host.textContent).toContain('Kept automatically');
    expect(host.textContent).toContain('3 MB of 1 GB');
    expect(host.querySelector<HTMLSelectElement>('.storage-limit select')!.value).toBe(String(1024 * MB));
    // Liberar de verdad lo prueba src/media/offline.test.ts; acá, que pide confirmación y recién ahí libera todo.
    const freeUp = vi.spyOn(b.offline, 'freeUp').mockResolvedValue(3 * MB);
    const free = [...host.querySelectorAll('button')].find((x) => x.textContent === 'Free up space') as HTMLButtonElement;
    await act(async () => free.click());
    expect(freeUp).not.toHaveBeenCalled();
    expect(host.textContent).toMatch(/Free up 3 MB\? Files stay in Drive/);
    const yes = [...host.querySelectorAll('.offline-remove button')].find((x) => x.textContent === 'Free up') as HTMLButtonElement;
    await act(async () => yes.click());
    await settle();
    expect(freeUp).toHaveBeenCalledWith('all');
  });

  it('pasado el tope, el aviso pregunta; "Not now" lo calla y nada se borra', async () => {
    const { b, ids } = await setup();
    await appendPart(b.mediaDb, ids[2], 'video/quicktime', MB, 0, new Blob([new Uint8Array(MB)]), Date.now());
    await putOfflineView(b.mediaDb, ids[0], new Blob([new Uint8Array(10)]), Date.now());
    await b.offline.setLimit(1);
    const host = await mount(services(b), <SpaceHost />);
    await until(() => !!host.querySelector('.space-notice'));
    expect(host.querySelector('.space-notice')!.textContent).toMatch(/Shot Docs is keeping 1 MB of files on this device \(limit .*\)\. Free up 1 MB\?/);
    expect(host.querySelector('.space-notice')!.textContent).toContain('New: Shot Docs keeps up to');
    const notNow = [...host.querySelectorAll('button')].find((x) => x.textContent === 'Not now') as HTMLButtonElement;
    await act(async () => notNow.click());
    await settle();
    expect(host.querySelector('.space-notice')).toBeNull();
    expect((await getCopy(b.mediaDb, ids[2]))?.orig).toBeDefined();
  });
});

describe('"Offline" a la vista en el teléfono', () => {
  it('sin conexión, la barra de arriba dice "Offline · N" con lo pendiente', async () => {
    const { server, b, page } = await setup();
    server.online = false;
    await b.media.add(page, new File([new Uint8Array(10)], 'nota.pdf', { type: 'application/pdf' }));
    await b.engine.syncNow();
    const host = await mount(services(b), <SyncIcon onClick={() => undefined} />);
    await settle(80);
    expect(host.querySelector('.sync-icon-label')?.textContent).toMatch(/^Offline · \d+$/);
    expect(host.querySelector('.sync-icon')?.getAttribute('data-tip')).toBeNull();
    act(() => prefs.set({ language: 'es' }));
    await settle();
    expect(host.querySelector('.sync-icon-label')?.textContent).toMatch(/^Sin conexión · \d+$/);
  });
});
