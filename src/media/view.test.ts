import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { resolveObjectURL } from 'node:buffer';
import { porteroDownload } from '../ui/sharpImages';
import { HeicError } from './heic';
import { MEDIA_SCHEME, mediaIdOf, VIEW_FETCH_MAX_BYTES, VIEW_PREFIX, VIEW_RETRY_MS, VIEW_SMALL_PREFIX } from './queue';

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
  // Un HEIC que quedó sin convertir (subido por una versión anterior, o que no se pudo pasar a JPEG).
  const convert = server.convertHeic;
  server.convertHeic = async () => {
    throw new HeicError('failed', 'no se pudo');
  };
  const heic = mediaIdOf(await a.media.add(page, file(MB, 'IMG_0009.HEIC', 'image/heic')))!;
  await a.media.idle();
  server.convertHeic = convert;
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

    const url = (await a.media.view(photo, { download }))?.url;
    expect(url).toMatch(/^blob:/);
    expect(await text(url!)).toContain(`view:${2 * MB}`);
    expect(download).not.toHaveBeenCalled();
    expect(a.media.viewUrl(photo)).toBe(url);
    // Guardada en el dispositivo, con su clave: la miniatura de siempre sigue igual para las versiones viejas.
    expect(await a.mediaDb.get('thumbs', VIEW_PREFIX + photo)).toBeInstanceOf(Blob);
    expect((await a.mediaDb.get('thumbs', photo))?.size).toBe(6);
    // Pedirla otra vez (otra foto de la misma página con el mismo archivo) no la vuelve a hacer.
    expect((await a.media.view(photo))?.url).toBe(url);
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
    const url = (await b.media.view(photo, { download }))?.url;
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
    const url2 = (await again.media.view(photo, { download: bytes }))?.url;
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
    expect((await b.media.view(photo, { download: spy }))?.url).toMatch(/^blob:/);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('cada falla seguida espera más para volver a bajar (1, 4, 16 minutos… hasta una hora)', async () => {
    const { server, a, photo } = await setup();
    await sync(a);
    const b = await otherDevice(server, [photo]);
    const download = vi.fn(async (): Promise<Blob> => {
      throw new TypeError('Failed to fetch');
    });
    expect(await b.media.view(photo, { download })).toBeNull();
    server.clockOffset += VIEW_RETRY_MS + 1;
    expect(await b.media.view(photo, { download })).toBeNull();
    expect(download).toHaveBeenCalledTimes(2);
    server.clockOffset += VIEW_RETRY_MS + 1;
    expect(await b.media.view(photo, { download })).toBeNull();
    expect(download).toHaveBeenCalledTimes(2);
    server.clockOffset += 3 * VIEW_RETRY_MS;
    expect(await b.media.view(photo, { download })).toBeNull();
    expect(download).toHaveBeenCalledTimes(3);
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
    expect((await a.media.view(photo))?.url).toMatch(/^blob:/);
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

describe('imagen nítida: lo que encontró la auditoría', () => {
  type Internals = { makeView: (file: Blob, mime: string, side: number) => Promise<Blob | null>; options: { viewStoreMaxBytes?: number } };
  const internals = (d: Device) => d.media as unknown as Internals;

  it('bajado y el navegador no lo abre: no se vuelve a bajar ni a decodificar en la sesión', async () => {
    const { server, a, photo } = await setup();
    await sync(a);
    const b = await otherDevice(server, [photo]);
    const make = vi.fn(async () => null);
    internals(b).makeView = make;
    const download = vi.fn(async () => new Blob([new Uint8Array(100)], { type: 'image/jpeg' }));
    expect(await b.media.view(photo, { download })).toBeNull();
    expect(await b.media.view(photo, { download })).toBeNull();
    server.clockOffset += VIEW_RETRY_MS + 1;
    expect(await b.media.view(photo, { download })).toBeNull();
    expect(download).toHaveBeenCalledTimes(1);
    expect(make).toHaveBeenCalledTimes(1);
  });

  it('bajado y más pesado que el tope: tampoco se vuelve a bajar', async () => {
    const { server, a, photo } = await setup();
    await sync(a);
    const b = await otherDevice(server, [photo]);
    const known = (await b.mediaDb.get('known', photo))!;
    await b.mediaDb.put('known', { ...known, size: null });
    const download = vi.fn(async () => new Blob([new Uint8Array(2000)], { type: 'image/jpeg' }));
    expect(await b.media.view(photo, { download, maxBytes: 1000 })).toBeNull();
    expect(await b.media.view(photo, { download, maxBytes: 1000 })).toBeNull();
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('el original del dispositivo que no se pudo decodificar (o tardó demasiado) no se vuelve a probar', async () => {
    const { a, photo } = await setup();
    const make = vi.fn(async () => null);
    internals(a).makeView = make;
    expect(await a.media.view(photo)).toBeNull();
    expect(await a.media.view(photo)).toBeNull();
    expect(make).toHaveBeenCalledTimes(1);
  });

  it('nunca dos decodificaciones del mismo archivo a la vez', async () => {
    const { a, photo } = await setup();
    let release: (b: Blob | null) => void = () => undefined;
    const make = vi.fn(() => new Promise<Blob | null>((r) => (release = r)));
    internals(a).makeView = make;
    const one = a.media.view(photo, { side: 1024 });
    const two = a.media.view(photo);
    await vi.waitFor(() => expect(make).toHaveBeenCalledTimes(1));
    release(new Blob(['x'], { type: 'image/jpeg' }));
    expect((await one)?.side).toBe(1024);
    // La segunda (pedía 2048) esperó a la primera y no sirvió: vuelve sin nada; la próxima la hace.
    expect(await two).toBeNull();
    expect(make).toHaveBeenCalledTimes(1);
  });

  it('la chica (1024) para una foto que se ve chica; la grande la reemplaza y sirve para las dos', async () => {
    const { a, photo } = await setup();
    const small = await a.media.view(photo, { side: 1024 });
    expect(small?.side).toBe(1024);
    expect(await text(small!.url)).toContain(':1024');
    expect(await a.mediaDb.get('thumbs', VIEW_SMALL_PREFIX + photo)).toBeInstanceOf(Blob);
    const big = await a.media.view(photo, { side: 2048 });
    expect(big?.side).toBe(2048);
    expect(await text(big!.url)).toContain(':2048');
    expect(await a.mediaDb.get('thumbs', VIEW_PREFIX + photo)).toBeInstanceOf(Blob);
    expect(await a.mediaDb.get('thumbs', VIEW_SMALL_PREFIX + photo)).toBeUndefined();
    expect((await a.media.view(photo, { side: 1024 }))?.url).toBe(big!.url);
    expect(a.media.viewOf(photo)).toEqual(big);
  });

  it('lo guardado tiene tope: se borran las más viejas', async () => {
    const { a, page, photo } = await setup();
    const second = mediaIdOf(await a.media.add(page, file(3 * MB, 'IMG_0011.JPG', 'image/jpeg')))!;
    await a.media.idle();
    internals(a).options.viewStoreMaxBytes = 40;
    await a.media.view(photo);
    expect(await a.mediaDb.get('thumbs', VIEW_PREFIX + photo)).toBeInstanceOf(Blob);
    await a.media.view(second);
    expect(await a.mediaDb.get('thumbs', VIEW_PREFIX + second)).toBeInstanceOf(Blob);
    expect(await a.mediaDb.get('thumbs', VIEW_PREFIX + photo)).toBeUndefined();
    // La miniatura no se toca.
    expect(await a.mediaDb.get('thumbs', photo)).toBeInstanceOf(Blob);
  });

  it('si falta lugar para un archivo nuevo, primero se borran las imágenes nítidas', async () => {
    const { a, photo } = await setup();
    await a.media.view(photo);
    let usage = 900 * MB;
    vi.stubGlobal('navigator', { ...navigator, storage: { estimate: async () => ({ usage, quota: 1000 * MB }) } });
    const clear = vi.spyOn(a.media, 'clearViews').mockImplementation(async () => {
      usage = 100 * MB;
      return 1;
    });
    await (a.media as unknown as { checkRoom: (n: number) => Promise<void> }).checkRoom(60 * MB);
    expect(clear).toHaveBeenCalledTimes(1);
    clear.mockRestore();
    expect(await a.media.clearViews()).toBe(1);
    expect(await a.mediaDb.get('thumbs', VIEW_PREFIX + photo)).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it('una foto mandada a la papelera de Drive desde este dispositivo borra su nítida guardada', async () => {
    const { a, photo } = await setup();
    await sync(a);
    expect(await a.media.view(photo)).not.toBeNull();
    await (a.media as unknown as { refreshDeleted: (id: string, done: boolean) => Promise<void> }).refreshDeleted(photo, true);
    expect(a.media.viewOf(photo)).toBeNull();
    await vi.waitFor(async () => expect(await a.mediaDb.get('thumbs', VIEW_PREFIX + photo)).toBeUndefined());
  });
});
