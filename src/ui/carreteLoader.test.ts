import { afterEach, describe, expect, it, vi } from 'vitest';
import { MEDIA_SCHEME, mediaIdOf } from '../media/queue';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { collectCarrete, type CarreteItem } from './carrete';
import { createCarreteLoader, isOffline, passFor, PASS_REUSE_MS } from './carreteLoader';

// De dónde saca el carrete lo que muestra: primero la miniatura, después lo grande (la copia del
// dispositivo o un pase del portero), con una cola de verdad y un servidor en memoria.

const MB = 1024 * 1024;
const devices: Device[] = [];

afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
    d.mediaDb.close();
  }
  vi.restoreAllMocks();
});

async function device(server: FakeServer, dbName?: string): Promise<Device> {
  const d = await makeDevice(server, dbName);
  devices.push(d);
  return d;
}

async function sync(d: Device): Promise<void> {
  await d.engine.syncNow();
  await d.engine.syncMedia();
  await d.engine.syncNow();
}

const file = (size: number, name: string, type: string) => new File([new Uint8Array(size)], name, { type });

function itemFor(url: string, name = ''): CarreteItem {
  return collectCarrete([{ id: 'b', type: 'image', props: { url, name } }])[0];
}

async function setup() {
  const server = new FakeServer();
  server.enableMedia();
  const a = await device(server);
  const page = await a.tree.create(null, 'Día 3');
  await sync(a);
  const photo = await a.media.add(page, file(MB, 'IMG_0007.JPG', 'image/jpeg'));
  const video = await a.media.add(page, file(MB, 'IMG_0008.MOV', 'video/quicktime'));
  return { server, a, photo, video };
}

describe('carrete: qué se muestra de cada elemento', () => {
  it('en el dispositivo que lo agregó: la miniatura primero y el original local, también sin red', async () => {
    const { server, a, photo, video } = await setup();
    server.online = false;
    const loader = createCarreteLoader(a);

    const p = await loader.preview(itemFor(photo));
    expect(p).toMatchObject({ kind: 'image', name: 'IMG_0007.JPG' });
    expect(p.preview).toMatch(/^blob:/);
    // La miniatura sin marca: lo grande llega después, desde el dispositivo.

    const full = await loader.full(itemFor(photo));
    expect(full.local).toBe(true);
    expect(full.url).toMatch(/^blob:/);

    expect(await loader.preview(itemFor(video))).toMatchObject({ kind: 'video', name: 'IMG_0008.MOV' });
    expect((await loader.full(itemFor(video))).local).toBe(true);
  });

  it('en otro dispositivo: la miniatura bajada y el archivo con un pase, pedido una sola vez', async () => {
    const { server, a, photo, video } = await setup();
    await sync(a);
    const b = await device(server);
    await sync(b);
    const pass = vi.spyOn(b.media, 'pass');
    const loader = createCarreteLoader(b);

    const p = await loader.preview(itemFor(video));
    expect(p).toMatchObject({ kind: 'video', name: 'IMG_0008.MOV' });
    expect(p.preview).toMatch(/^blob:/);
    const full = await loader.full(itemFor(video));
    expect(full).toMatchObject({ local: false });
    expect(full.url).toMatch(/\/m\/drive-/);

    await loader.full(itemFor(video));
    await loader.full(itemFor(photo));
    expect(pass).toHaveBeenCalledTimes(2);
    expect(pass).toHaveBeenCalledWith(mediaIdOf(video));
  });

  it('sin red: la miniatura guardada se ve; lo grande falla como "sin red" y se vuelve a pedir al volver', async () => {
    const { server, a, video } = await setup();
    await sync(a);
    const dbName = crypto.randomUUID();
    const b = await device(server, dbName);
    await sync(b);
    await b.media.resolve(video); // la página ya la mostró: la miniatura quedó en el dispositivo

    server.online = false;
    const loader = createCarreteLoader(b);
    expect((await loader.preview(itemFor(video))).preview).toMatch(/^blob:/);
    const err = await loader.full(itemFor(video)).catch((e: unknown) => e);
    expect(isOffline(err)).toBe(true);

    server.online = true;
    expect((await loader.full(itemFor(video))).url).toMatch(/\/m\/drive-/);
  });

  it('un archivo que nunca llegó a este dispositivo, sin red: sin tipo y con el nombre del bloque', async () => {
    const server = new FakeServer();
    server.enableMedia();
    const b = await device(server);
    await sync(b);
    server.online = false;
    const loader = createCarreteLoader(b);
    const url = `${MEDIA_SCHEME}0a1b2c3d-4e5f-4a6b-8c7d-8e9f00112233`;
    const p = await loader.preview(itemFor(url, 'IMG_9.HEIC'));
    expect(p.kind).toBeNull();
    expect(p.name).toBe('IMG_9.HEIC');
    // Un ícono con el nombre, como en la página.
    expect(p.preview).toMatch(/^data:image\/svg\+xml/);
    expect(isOffline(await loader.full(itemFor(url)).catch((e: unknown) => e))).toBe(true);
  });

  it('imágenes de antes (sdfile://) y direcciones de la web', async () => {
    const files = { resolve: vi.fn(async (url: string) => (url.startsWith('sdfile://') ? 'blob:local-copy' : url)) };
    const media = { resolve: vi.fn(), thumbnail: vi.fn(), source: vi.fn(), pass: vi.fn() };
    const loader = createCarreteLoader({ media, files } as never);

    const old = itemFor('sdfile://page-1/abc.jpg');
    expect(await loader.preview(old)).toEqual({ kind: 'image', name: 'abc.jpg', preview: 'blob:local-copy' });
    expect(await loader.full(old)).toEqual({ url: 'blob:local-copy', local: true });

    const web = itemFor('https://example.com/fotos/Plano%2012.jpg?x=1');
    expect(await loader.preview(web)).toEqual({ kind: 'image', name: 'Plano 12.jpg', preview: web.url });
    expect(await loader.full(web)).toEqual({ url: web.url, local: false });

    const embedded = itemFor('data:image/png;base64,AAAA');
    expect((await loader.full(embedded)).local).toBe(true);
    expect((await loader.preview(embedded)).name).toBe('image.png');
    expect(media.pass).not.toHaveBeenCalled();
  });

  it('reusa el pase mientras le falte más de una hora (también en otro carrete); "Retry" pide uno nuevo', async () => {
    const media = { pass: vi.fn(async (id: string) => `https://portero.test/m/${id}-${media.pass.mock.calls.length}`) };
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const first = await passFor(media, 'f1');
    now.mockReturnValue(1_000_000 + PASS_REUSE_MS - 1);
    expect(await passFor(media, 'f1')).toBe(first);
    const loader = createCarreteLoader({ media: { ...media, resolve: vi.fn(), thumbnail: vi.fn(), source: vi.fn() }, files: { resolve: vi.fn() } } as never);
    expect(media.pass).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1_000_000 + PASS_REUSE_MS + 1);
    expect(await passFor(media, 'f1')).not.toBe(first);
    expect(media.pass).toHaveBeenCalledTimes(2);
    // Otra cola (otra sesión) no reusa el pase.
    await passFor({ pass: media.pass }, 'f1');
    expect(media.pass).toHaveBeenCalledTimes(3);
    loader.dispose();
  });

  it('"Retry" olvida lo grande y el pase: se pide otro', async () => {
    const { server, a, video } = await setup();
    await sync(a);
    const b = await device(server);
    await sync(b);
    const pass = vi.spyOn(b.media, 'pass');
    const loader = createCarreteLoader(b);
    await loader.full(itemFor(video));
    await loader.full(itemFor(video));
    expect(pass).toHaveBeenCalledTimes(1);
    loader.retry(itemFor(video));
    await loader.full(itemFor(video));
    expect(pass).toHaveBeenCalledTimes(2);
  });

  it('al cerrar suelta los originales que puso en memoria', async () => {
    const { a, photo } = await setup();
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const loader = createCarreteLoader(a);
    const full = await loader.full(itemFor(photo));
    loader.dispose();
    expect(revoke).toHaveBeenCalledWith(full.url);
  });
});
