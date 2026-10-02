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
import { freedText, SpaceHost } from './SpaceHost';
import type { Usage } from '../media/offline';
import { noticeFor } from './Carrete';
import { t } from '../i18n';
import '../i18n/lazy/carrete';
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

  it('"Free up … and make available offline" libera solo copias: los originales agregados acá no cuentan ni se liberan', async () => {
    const { b, page } = await setup();
    // Sin lugar libre fuera de la reserva: solo entra liberando.
    vi.stubGlobal('navigator', {
      ...navigator,
      onLine: true,
      storage: { estimate: async () => ({ quota: 4 * 1024 * MB, usage: 3 * 1024 * MB }), persisted: async () => true, persist: async () => true },
    });
    const usage = (copies: number, own: number) => ({
      kept: copies + own,
      freeable: copies + own,
      own: { freeable: own, count: own ? 3 : 0, recent: 0, recentCount: 0, held: null, heldBytes: 0 },
      waiting: 0,
      waitingCount: 0,
      offline: 0,
      gone: { count: 0, bytes: 0, ids: [] },
    });
    // Solo originales propios para liberar: no alcanza (no se ofrece liberarlos desde esta ventana).
    const spyUsage = vi.spyOn(b.offline, 'usage').mockResolvedValue(usage(0, 50 * 1024 * MB));
    await act(async () => b.offline.refresh());
    const host = await mount(services(b), <OfflineDialog kind="page" target={page} onClose={() => undefined} />);
    await until(() => !host.querySelector('.offline-total .offline-spinner'));
    await settle();
    expect(([...host.querySelectorAll('button')].find((x) => x.textContent === 'Make available offline') as HTMLButtonElement).disabled).toBe(true);
    // Con copias bajadas para liberar: el botón lo dice, y al tocarlo libera solo copias.
    spyUsage.mockResolvedValue(usage(50 * 1024 * MB, 50 * 1024 * MB));
    await act(async () => b.offline.refresh());
    await settle();
    const freeUp = vi.spyOn(b.offline, 'freeUp').mockResolvedValue(0);
    const mark = vi.spyOn(b.offline, 'mark').mockResolvedValue('m');
    const start = [...host.querySelectorAll('button')].find((x) => /^Free up .* and make available offline$/.test(x.textContent ?? '')) as HTMLButtonElement;
    expect(start.disabled).toBe(false);
    await act(async () => start.click());
    await settle();
    expect(freeUp).toHaveBeenCalledWith('all', { own: false });
    expect(mark).toHaveBeenCalled();
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

describe('liberar los originales agregados en este dispositivo (entrega 2)', { timeout: 30_000 }, () => {
  // Liberar de verdad (con el portero y la base en memoria) lo prueba src/media/ownFree.test.ts. Acá, lo que se ve y que
  // nada se libera sin el sí: el uso viene armado (en jsdom la cola no termina de subir los originales).
  const own = (over: Partial<Usage['own']>): Usage => ({
    kept: 3 * MB,
    freeable: over.freeable ?? 0,
    own: { freeable: 0, count: 0, recent: 0, recentCount: 0, held: null, heldBytes: 0, ...over },
    waiting: 0,
    waitingCount: 0,
    offline: 0,
    gone: { count: 0, bytes: 0, ids: [] },
  });

  it('el diálogo dice qué originales se pueden liberar, cuáles quedan por los 14 días y libera con la confirmación', async () => {
    const { a } = await setup();
    vi.spyOn(a.offline, 'usage').mockResolvedValue(own({ freeable: 2 * MB, count: 2, recent: MB, recentCount: 1 }));
    const freeUp = vi.spyOn(a.offline, 'freeUp').mockResolvedValue(2 * MB);
    const host = await mount(services(a), <StorageDialog onClose={() => undefined} onEdit={() => undefined} />);
    await until(() => (host.textContent ?? '').includes('already in Drive'));
    expect(host.textContent).toContain('Added on this device and already in Drive: 2 MB (2 files). Before removing each one, Shot Docs checks that Drive has the same file.');
    expect(host.textContent).toContain('1 file added on this device (1 MB) was uploaded less than 14 days ago: it stays for now.');
    const free = [...host.querySelectorAll('button')].find((x) => x.textContent === 'Free up space') as HTMLButtonElement;
    await act(async () => free.click());
    expect(freeUp).not.toHaveBeenCalled();
    expect(host.textContent).toMatch(/Free up 2 MB\? Files stay in Drive/);
    const yes = [...host.querySelectorAll('.offline-remove button')].find((x) => x.textContent === 'Free up') as HTMLButtonElement;
    await act(async () => yes.click());
    await settle();
    expect(freeUp).toHaveBeenCalledWith('all');
  });

  it('sin conexión o con un portero viejo, lo dice y no ofrece liberarlos', async () => {
    const { a } = await setup();
    const usage = vi.spyOn(a.offline, 'usage').mockResolvedValue(own({ held: 'offline', heldBytes: 3 * MB }));
    const host = await mount(services(a), <StorageDialog onClose={() => undefined} onEdit={() => undefined} />);
    await until(() => (host.textContent ?? '').includes('only with a connection'));
    expect(host.textContent).toContain('Files added on this device (3 MB) can be freed only with a connection');
    expect(host.textContent).toContain('Nothing to free up right now.');
    usage.mockResolvedValue(own({ held: 'server', heldBytes: 3 * MB }));
    await act(async () => a.offline.refresh());
    expect(host.textContent).toContain("can't be freed until the media server is updated");
  });

  it('un archivo nuevo que no entró: el aviso ofrece liberar los originales ya en Drive y recién con el sí los libera', async () => {
    const { a } = await setup();
    vi.spyOn(a.offline, 'usage').mockResolvedValue(own({ freeable: 3 * MB, count: 3 }));
    const freeUp = vi.spyOn(a.offline, 'freeUp').mockResolvedValue(3 * MB);
    const host = await mount(services(a), <SpaceHost />);
    act(() => a.offline.rejected(new File([new Uint8Array(10)], 'IMG_0500.JPG', { type: 'image/jpeg' })));
    await until(() => (host.textContent ?? '').includes('Free up 3 MB'));
    expect(host.querySelector('.unsaved-notice')!.textContent).toMatch(/IMG_0500\.JPG.*\(0\.1 KB\) was not added\. Save it so it isn't lost\.Free up 3 MB of files added here that are already in Drive\?/s);
    expect(freeUp).not.toHaveBeenCalled();
    const button = [...host.querySelectorAll('button')].find((x) => x.textContent === 'Free up 3 MB') as HTMLButtonElement;
    await act(async () => button.click());
    await settle();
    expect(freeUp).toHaveBeenCalledWith('room');
  });

  it('lo que dice al terminar: cuánto se liberó y, con motivo, lo que quedó', () => {
    const tr = t;
    expect(freedText({ freed: 3 * MB, own: 2, skipped: {}, at: 0 }, tr)).toBe('Freed 3 MB on this device.');
    expect(freedText({ freed: MB, own: 1, skipped: { notInDrive: 1, offline: 2 }, at: 0 }, tr)).toBe(
      'Freed 1 MB on this device. 3 files stayed on this device: no connection (2), not in Drive (1).',
    );
  });

  it('el carrete sin conexión dice que la copia de este dispositivo se liberó', () => {
    const tr = t;
    const view = { kind: 'image' as const, state: 'offline' as const, preview: 'blob:x', error: null };
    expect(noticeFor({ ...view, freed: true }, 'IMG.JPG', tr)).toMatch(/thumbnail.*The copy on this device was freed to save space; it's in Drive\./);
    expect(noticeFor(view, 'IMG.JPG', tr)).not.toMatch(/freed/);
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
  it('sin conexión y con algo rechazado (el ícono de aviso), sigue diciendo "Offline · N"', async () => {
    const { b } = await setup();
    const real = b.engine.getStatus();
    const status = { ...real, online: false, failedMedia: 1 };
    vi.spyOn(b.engine, 'getStatus').mockReturnValue(status);
    const host = await mount(services(b), <SyncIcon onClick={() => undefined} />);
    expect(host.querySelector('.sync-icon')?.classList.contains('warn')).toBe(true);
    expect(host.querySelector('.sync-icon-label')?.textContent).toMatch(/^Offline/);
  });
});
