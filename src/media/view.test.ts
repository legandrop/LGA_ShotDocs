import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { resolveObjectURL } from 'node:buffer';
import { porteroDownload } from '../ui/sharpImages';
import { MEDIA_SCHEME, mediaIdOf, VIEW_FETCH_MAX_BYTES, VIEW_PREFIX, VIEW_RETRY_MS } from './queue';

// La imagen nítida de la página (Docs/Doc_Imagenes.md, "Calidad en la página"): de dónde sale en cada
// dispositivo, qué se baja del portero y qué no, y que se hace una sola vez por dispositivo.

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

async function text(url: string): Promise<string> {
  const blob = resolveObjectURL(url);
  return blob ? Buffer.from(await blob.arrayBuffer()).toString('latin1') : '';
}

async function setup() {
  const server = new FakeServer();
  server.enableMedia();
  const a = await device(server);
  const page = await a.tree.create(null, 'Día 3');
  await sync(a);
  const photo = mediaIdOf(await a.media.add(page, file(2 * MB, 'bl-InUT6dyjKb.jpg', 'image/jpeg')))!;
  const video = mediaIdOf(await a.media.add(page, file(MB, 'IMG_0008.MOV', 'video/quicktime')))!;
  const heic = mediaIdOf(await a.media.add(page, file(MB, 'IMG_0009.HEIC', 'image/heic')))!;
  await a.media.idle();
  return { server, a, page, photo, video, heic };
}

/** Un dispositivo que abre la página: la miniatura ya pasó por `resolve`. */
async function otherDevice(server: FakeServer, ids: string[], dbName?: string): Promise<Device> {
  const b = await device(server, dbName);
  await sync(b);
  for (const id of ids) await b.media.resolve(MEDIA_SCHEME + id);
  return b;
}

describe('imagen nítida de la página', () => {
  it('en el dispositivo que agregó la foto: del original local, sin red y sin el portero, una sola vez', async () => {
    const { server, a, photo } = await setup();
    server.online = false;
    const download = vi.fn(async () => new Blob());
    const thumb = await a.media.resolve(MEDIA_SCHEME + photo);
    expect(a.media.isThumbUrl(photo, thumb)).toBe(true);
    expect(a.media.viewUrl(photo)).toBeNull();

    const url = await a.media.view(photo, { download });
    expect(url).toMatch(/^blob:/);
    expect(await text(url!)).toContain(`view:${2 * MB}`);
    expect(download).not.toHaveBeenCalled();
    expect(a.media.viewUrl(photo)).toBe(url);
    // Guardada en el dispositivo, con su clave: la miniatura de siempre sigue igual para las versiones viejas.
    expect(await a.mediaDb.get('thumbs', VIEW_PREFIX + photo)).toBeInstanceOf(Blob);
    expect((await a.mediaDb.get('thumbs', photo))?.size).toBe(6);
    // Pedirla otra vez (otra foto de la misma página con el mismo archivo) no la vuelve a hacer.
    expect(await a.media.view(photo)).toBe(url);
  });

  it('en otro dispositivo: el original se baja una vez con un pase y queda guardado para la próxima sesión', async () => {
    const { server, a, photo } = await setup();
    await sync(a);
    const dbName = crypto.randomUUID();
    const b = await otherDevice(server, [photo], dbName);

    // Sin cómo bajarlo, se queda la miniatura.
    expect(await b.media.view(photo)).toBeNull();

    const pass = vi.spyOn(b.media, 'pass');
    const download = porteroDownload(b.media, (url) => server.portero.fetch(url));
    const url = await b.media.view(photo, { download });
    expect(await text(url!)).toContain(`view:${2 * MB}`);
    expect(pass).toHaveBeenCalledTimes(1);
    expect(server.portero.calls.filter((c) => c.method === 'GET' && c.path.startsWith('/m/'))).toHaveLength(1);

    // Otra sesión en el mismo dispositivo: sale de lo guardado, sin red.
    b.engine.stop();
    b.db.close();
    b.mediaDb.close();
    devices.splice(devices.indexOf(b), 1);
    server.online = false;
    const again = await device(server, dbName);
    const bytes = vi.fn(async () => new Blob());
    const url2 = await again.media.view(photo, { download: bytes });
    expect(await text(url2!)).toContain(`view:${2 * MB}`);
    expect(bytes).not.toHaveBeenCalled();
  });

  it('sin red no se ve rota: queda la miniatura y se vuelve a probar un rato después', async () => {
    const { server, a, photo } = await setup();
    await sync(a);
    const b = await otherDevice(server, [photo]);
    server.online = false;
    const download = porteroDownload(b.media, (url) => server.portero.fetch(url));
    expect(await b.media.view(photo, { download })).toBeNull();

    server.online = true;
    // Enseguida no se vuelve a pedir (una página con muchas fotos no insiste en cada dibujo).
    const spy = vi.fn(download);
    expect(await b.media.view(photo, { download: spy })).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    server.clockOffset += VIEW_RETRY_MS + 1;
    expect(await b.media.view(photo, { download: spy })).toMatch(/^blob:/);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('lo que no se baja para la página: videos, HEIC, lo que todavía no llegó a Drive, lo muy pesado', async () => {
    const { server, a, page, photo, video, heic } = await setup();
    await sync(a);
    server.online = false;
    const pending = mediaIdOf(await a.media.add(page, file(MB, 'IMG_0010.JPG', 'image/jpeg')))!;
    await a.media.idle();
    server.online = true;
    // `pending` quedó registrado pero sin subir: se corta la red del portero.
    server.portero.cutAfterParts = 0;
    await sync(a);
    server.portero.reconnect();

    const b = await otherDevice(server, [photo, video, heic, pending]);
    expect((await b.mediaDb.get('known', pending))?.driveId).toBeNull();
    expect((await b.mediaDb.get('known', photo))?.driveId).toBeTruthy();
    const download = vi.fn(async () => new Blob([new Uint8Array(10)], { type: 'image/jpeg' }));
    expect(await b.media.view(video, { download })).toBeNull();
    expect(await b.media.view(heic, { download })).toBeNull();
    expect(await b.media.view(pending, { download })).toBeNull();
    expect(download).not.toHaveBeenCalled();

    // Una foto que la base dice que pesa más que el tope.
    const known = (await b.mediaDb.get('known', photo))!;
    await b.mediaDb.put('known', { ...known, size: VIEW_FETCH_MAX_BYTES + 1 });
    expect(await b.media.view(photo, { download })).toBeNull();
    expect(download).not.toHaveBeenCalled();
    // En el dispositivo que tiene el original, un video tampoco (queda su miniatura con la marca de "play").
    expect(await a.media.view(video)).toBeNull();
    expect(a.media.isThumbUrl(video, await a.media.resolve(MEDIA_SCHEME + video))).toBe(false);
  });

  it('una foto que no es más grande que su miniatura se queda con la miniatura', async () => {
    const { a, photo } = await setup();
    const record = (await a.mediaDb.get('files', photo))!;
    await a.mediaDb.put('files', { ...record, width: 560, height: 400 });
    expect(await a.media.view(photo)).toBeNull();
  });

  it('una foto que un dueño mandó a la papelera de Drive: sin imagen nítida (y se borra la guardada)', async () => {
    const { server, a, photo } = await setup();
    await sync(a);
    expect(await a.media.view(photo)).toMatch(/^blob:/);
    server.mediaFiles.get(photo)!.drive_trashed_at = new Date().toISOString();
    const known = await a.mediaDb.get('known', photo);
    await a.mediaDb.put('known', { ...(known ?? { id: photo, name: 'x', mime: 'image/jpeg', width: 1, height: 1, duration: null, thumbAt: null, driveId: null, fetchedAt: 0 }), deleted: true });
    const shown = await a.media.resolve(MEDIA_SCHEME + photo);
    expect(shown).toMatch(/^data:image\/svg\+xml/);
    expect(a.media.isThumbUrl(photo, shown)).toBe(false);
    expect(a.media.viewUrl(photo)).toBeNull();
    await vi.waitFor(async () => expect(await a.mediaDb.get('thumbs', VIEW_PREFIX + photo)).toBeUndefined());
  });
});
