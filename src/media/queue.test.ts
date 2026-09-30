import { afterEach, describe, expect, it } from 'vitest';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { PART_BYTES } from './portero';
import { localDay } from './portero';
import { MEDIA_SCHEME, mediaIdOf, normalizeMime } from './queue';

const MB = 1024 * 1024;
const devices: Device[] = [];

async function device(server: FakeServer, dbName?: string): Promise<Device> {
  const d = await makeDevice(server, dbName);
  devices.push(d);
  return d;
}

/** Cierra la app de ese dispositivo (como cerrar la pestaña a la mitad). */
async function close(d: Device): Promise<void> {
  d.engine.stop();
  await d.engine.syncMedia();
  d.db.close();
  d.mediaDb.close();
  devices.splice(devices.indexOf(d), 1);
}

afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
    d.mediaDb.close();
  }
});

/** Un archivo con bytes que cambian, para ver que cada parte llega en su lugar. */
function makeFile(size: number, name: string, type: string): File {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = i % 251;
  return new File([bytes], name, { type });
}

async function same(file: Blob, stored: Uint8Array): Promise<boolean> {
  const original = new Uint8Array(await file.arrayBuffer());
  return original.length === stored.length && original.every((b, i) => b === stored[i]);
}

/** Sincroniza todo: el ciclo de siempre y, después, la cola de archivos. */
async function sync(d: Device): Promise<void> {
  await d.engine.syncNow();
  await d.engine.syncMedia();
  await d.engine.syncNow();
}

async function withPage(server: FakeServer): Promise<{ a: Device; page: string }> {
  server.enableMedia();
  const a = await device(server);
  const page = await a.tree.create(null, 'Día 3');
  await sync(a);
  return { a, page };
}

describe('cola de archivos: guardar primero en el dispositivo', () => {
  it('guarda el archivo, la miniatura y los datos antes de subir nada', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    server.online = false;

    const url = await a.media.add(page, makeFile(3 * MB, 'IMG_0666.MOV', 'video/quicktime'));
    const id = mediaIdOf(url)!;
    expect(url).toBe(MEDIA_SCHEME + id);

    const record = await a.mediaDb.get('files', id);
    expect(record).toMatchObject({
      pageId: page,
      projectId: server.workspaceId,
      name: 'IMG_0666.MOV',
      mime: 'video/quicktime',
      size: 3 * MB,
      width: 3840,
      height: 2160,
      duration: 21.4,
      day: localDay(),
      pending: 1,
      thumb: 'local',
    });
    expect((await a.mediaDb.get('blobs', id))?.size).toBe(3 * MB);
    expect((await a.mediaDb.get('thumbs', id))?.type).toBe('image/jpeg');
    expect(server.mediaFiles.size).toBe(0);

    await sync(a);
    expect(a.engine.getStatus()).toMatchObject({ online: false, pendingMedia: 1, failedMedia: 0 });
  });

  it('sin miniatura (HEIC en Chrome de Windows) se registra y se sube igual', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    const id = mediaIdOf(await a.media.add(page, makeFile(MB, 'IMG_1234.HEIC', '')))!;
    expect(await a.mediaDb.get('files', id)).toMatchObject({ mime: 'image/heic', thumb: 'none', width: null });

    await sync(a);
    expect(server.mediaFiles.get(id)).toMatchObject({ mime: 'image/heic', thumb_at: null, width: null });
    expect(server.mediaFiles.get(id)?.drive_id).toBeTruthy();
    expect(server.thumbs.has(id)).toBe(false);
    // En la página queda un ícono con el nombre.
    expect(await a.media.resolve(MEDIA_SCHEME + id)).toMatch(/^data:image\/svg\+xml/);
  });

  it('rechaza lo que no es foto ni video, y los archivos vacíos', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    await expect(a.media.add(page, makeFile(10, 'notas.pdf', 'application/pdf'))).rejects.toThrow(/photos and videos/);
    await expect(a.media.add(page, makeFile(10, 'x.svg', 'image/svg+xml'))).rejects.toThrow(/photos and videos/);
    await expect(a.media.add(page, makeFile(0, 'vacio.jpg', 'image/jpeg'))).rejects.toThrow(/empty/);
  });
});

describe('cola de archivos: subir', () => {
  it('registra, sube la miniatura y manda el archivo al portero en partes de 8 MiB', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    const file = makeFile(2 * PART_BYTES + 3 * MB, 'IMG_0666.MOV', 'video/quicktime');
    const id = mediaIdOf(await a.media.add(page, file))!;

    await sync(a);

    const row = server.mediaFiles.get(id)!;
    expect(row).toMatchObject({ project_id: server.workspaceId, mime: 'video/quicktime', size: file.size, width: 3840, height: 2160 });
    expect(row.thumb_at).toBeTruthy();
    expect(row.drive_id).toBeTruthy();
    expect(server.pageFiles.has(`${page}:${id}`)).toBe(true);
    expect(server.thumbs.get(id)?.type).toBe('image/jpeg');
    expect(server.mediaCalls).toEqual([`register_file ${id}`, `thumb ${id}`, `set_file_thumb ${id}`]);

    const start = server.portero.calls.find((c) => c.path === '/upload')!;
    expect(start.body).toMatchObject({ file: id, name: 'IMG_0666.MOV', mime: 'video/quicktime', size: file.size, day: localDay() });
    expect(server.portero.calls.filter((c) => c.method === 'PUT').map((c) => c.range)).toEqual([
      `bytes 0-${PART_BYTES - 1}/${file.size}`,
      `bytes ${PART_BYTES}-${2 * PART_BYTES - 1}/${file.size}`,
      `bytes ${2 * PART_BYTES}-${file.size - 1}/${file.size}`,
    ]);
    const stored = server.portero.drive.get(row.drive_id!)!;
    expect(await same(file, stored.data)).toBe(true);
    expect(await a.mediaDb.get('files', id)).toMatchObject({ pending: 0, driveId: row.drive_id, uploadId: null, error: null });
    expect(a.engine.getStatus()).toMatchObject({ pendingMedia: 0, failedMedia: 0, mediaError: null });
    // El original se queda en el dispositivo.
    expect((await a.mediaDb.get('blobs', id))?.size).toBe(file.size);
  });

  it('sin red espera, y sube sola cuando vuelve', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    server.online = false;
    const id = mediaIdOf(await a.media.add(page, makeFile(MB, 'IMG_0001.JPG', 'image/jpeg')))!;
    await sync(a);
    await sync(a);
    expect(a.engine.getStatus()).toMatchObject({ pendingMedia: 1, failedMedia: 0 });
    expect(server.mediaFiles.size).toBe(0);

    server.online = true;
    await sync(a);
    expect(server.mediaFiles.get(id)?.drive_id).toBeTruthy();
    expect(a.engine.getStatus()).toMatchObject({ pendingMedia: 0, failedMedia: 0 });
  });

  it('espera a que la página exista en el servidor', async () => {
    const server = new FakeServer();
    server.enableMedia();
    const a = await device(server);
    await sync(a);
    server.online = false;
    const page = await a.tree.create(null, 'Creada sin red');
    const id = mediaIdOf(await a.media.add(page, makeFile(MB, 'a.jpg', 'image/jpeg')))!;
    // La página todavía no subió: la cola no la intenta (no es un error).
    await a.engine.syncMedia();
    expect(server.mediaCalls).toEqual([]);

    server.online = true;
    await sync(a);
    expect(server.pages.has(page)).toBe(true);
    expect(server.mediaFiles.get(id)?.drive_id).toBeTruthy();
  });

  it('retoma lo que ya llegó después de cortarse la red y cerrar la app', async () => {
    const server = new FakeServer();
    server.enableMedia();
    const dbName = crypto.randomUUID();
    const a = await device(server, dbName);
    const page = await a.tree.create(null, 'Rodaje');
    await sync(a);
    const file = makeFile(2 * PART_BYTES + 5 * MB, 'IMG_0700.MOV', 'video/quicktime');
    const id = mediaIdOf(await a.media.add(page, file))!;

    // Llega la primera parte y se corta la red.
    server.portero.cutAfterParts = 1;
    await sync(a);
    const halfway = await a.mediaDb.get('files', id);
    expect(halfway).toMatchObject({ pending: 1, registered: true, thumb: 'done', sent: PART_BYTES, blocked: false });
    expect(halfway?.uploadId).toBeTruthy();
    expect(a.engine.getStatus().pendingMedia).toBe(1);
    expect(a.engine.getStatus().mediaError).toMatch(/No connection with the media server/);
    await close(a);

    // Se vuelve a abrir la app: pregunta cuánto llegó y sigue desde ahí, sin volver a mandar lo primero.
    server.portero.reconnect();
    server.portero.calls.length = 0;
    const again = await device(server, dbName);
    await sync(again);
    const puts = server.portero.calls.filter((c) => c.method === 'PUT').map((c) => c.range);
    expect(puts).toEqual([
      `bytes */${file.size}`,
      `bytes ${PART_BYTES}-${2 * PART_BYTES - 1}/${file.size}`,
      `bytes ${2 * PART_BYTES}-${file.size - 1}/${file.size}`,
    ]);
    expect(server.portero.calls.some((c) => c.method === 'POST' && c.path === '/upload')).toBe(false);
    const row = server.mediaFiles.get(id)!;
    expect(await same(file, server.portero.drive.get(row.drive_id!)!.data)).toBe(true);
    // Registrar y la miniatura no se repiten.
    expect(server.mediaCalls.filter((c) => c.startsWith('register_file'))).toHaveLength(1);
    expect(again.engine.getStatus()).toMatchObject({ pendingMedia: 0, mediaError: null });
  });

  it('un error que no se arregla solo queda a la vista, no descarta nada y se reintenta con Retry', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    server.portero.forbid = true;
    const file = makeFile(MB, 'IMG_0002.JPG', 'image/jpeg');
    const id = mediaIdOf(await a.media.add(page, file))!;

    await sync(a);
    await sync(a);
    expect(a.engine.getStatus()).toMatchObject({ pendingMedia: 0, failedMedia: 1 });
    expect(await a.media.failures()).toEqual([{ id, name: 'IMG_0002.JPG', error: 'You cannot add files to this page.' }]);
    expect(await a.mediaDb.get('files', id)).toMatchObject({ pending: 1, blocked: true });
    expect((await a.mediaDb.get('blobs', id))?.size).toBe(MB);
    // Mientras está detenido no se vuelve a pedir.
    const starts = server.portero.calls.filter((c) => c.path === '/upload').length;
    await sync(a);
    expect(server.portero.calls.filter((c) => c.path === '/upload')).toHaveLength(starts);

    server.portero.forbid = false;
    await a.engine.retryRejected();
    await a.engine.syncMedia();
    await a.engine.syncNow();
    expect(server.mediaFiles.get(id)?.drive_id).toBeTruthy();
    expect(a.engine.getStatus()).toMatchObject({ pendingMedia: 0, failedMedia: 0 });
  });

  it('reintentar después de perder respuestas no duplica nada', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    const id = mediaIdOf(await a.media.add(page, makeFile(MB, 'IMG_0003.JPG', 'image/jpeg')))!;
    server.loseMediaResponse.add('register_file');
    server.loseMediaResponse.add('thumb');
    server.loseMediaResponse.add('set_file_thumb');

    for (let i = 0; i < 4; i++) await sync(a);

    expect(server.mediaFiles.size).toBe(1);
    expect(server.thumbs.size).toBe(1);
    expect([...server.pageFiles]).toEqual([`${page}:${id}`]);
    expect(server.portero.drive.size).toBe(1);
    expect(a.engine.getStatus().pendingMedia).toBe(0);

    // Ya subido: otra vuelta no llama a nada.
    const calls = server.mediaCalls.length;
    const porteroCalls = server.portero.calls.length;
    await sync(a);
    expect(server.mediaCalls).toHaveLength(calls);
    expect(server.portero.calls).toHaveLength(porteroCalls);
  });

  it('si la base no se enteró de la subida, sigue pendiente y no vuelve a mandar el archivo', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    server.portero.failLink = true;
    const id = mediaIdOf(await a.media.add(page, makeFile(MB, 'IMG_0004.JPG', 'image/jpeg')))!;
    await sync(a);
    expect(server.portero.drive.size).toBe(1);
    expect(server.mediaFiles.get(id)?.drive_id).toBeNull();
    expect(a.engine.getStatus().pendingMedia).toBe(1);

    server.portero.failLink = false;
    server.clockOffset += 60_000;
    await sync(a);
    expect(server.portero.drive.size).toBe(1);
    expect(server.mediaFiles.get(id)?.drive_id).toBeTruthy();
    expect(a.engine.getStatus().pendingMedia).toBe(0);
  });

  it('cuenta cada archivo en los cambios pendientes', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    server.online = false;
    await a.media.add(page, makeFile(MB, 'uno.jpg', 'image/jpeg'));
    await a.media.add(page, makeFile(MB, 'dos.mov', 'video/quicktime'));
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ pendingMedia: 2, pendingOps: 0, pendingPages: 0 });

    server.online = true;
    await sync(a);
    expect(a.engine.getStatus().pendingMedia).toBe(0);
  });
});

describe('cola de archivos: páginas que usan cada archivo', () => {
  it('llama a link_page_file al copiar el bloque a otra página, una sola vez', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    const other = await a.tree.create(null, 'Día 4');
    const id = mediaIdOf(await a.media.add(page, makeFile(MB, 'IMG_0005.JPG', 'image/jpeg')))!;
    await sync(a);

    // La misma página no hace falta: la registró register_file.
    await a.media.ensureLinks(page, [id]);
    await a.media.ensureLinks(other, [id, id]);
    await a.engine.syncNow();
    expect(a.engine.getStatus().pendingMedia).toBe(1);
    await sync(a);
    expect(server.pageFiles.has(`${other}:${id}`)).toBe(true);
    expect(server.mediaCalls.filter((c) => c.startsWith('link_page_file'))).toEqual([`link_page_file ${other} ${id}`]);

    await a.media.ensureLinks(other, [id]);
    await sync(a);
    expect(server.mediaCalls.filter((c) => c.startsWith('link_page_file'))).toHaveLength(1);
    expect(a.engine.getStatus().pendingMedia).toBe(0);
  });

  it('si el archivo todavía no llegó al servidor, espera y reintenta más tarde', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    const other = await a.tree.create(null, 'Día 5');
    await sync(a);
    const b = await device(server);
    await sync(b);

    // `a` agrega sin red; `b` ya ve el bloque copiado en otra página.
    server.online = false;
    const id = mediaIdOf(await a.media.add(page, makeFile(MB, 'IMG_0006.JPG', 'image/jpeg')))!;
    server.online = true;
    await b.media.ensureLinks(other, [id]);
    await sync(b);
    expect(server.pageFiles.has(`${other}:${id}`)).toBe(false);
    // Esperar a otro dispositivo no es un error de este ni queda como pendiente.
    expect(b.engine.getStatus()).toMatchObject({ pendingMedia: 0, failedMedia: 0 });
    expect(await b.mediaDb.get('links', `${other}:${id}`)).toMatchObject({ pending: 1, waiting: 'file_not_found' });

    await sync(a);
    server.clockOffset += 60_000;
    await sync(b);
    expect(server.pageFiles.has(`${other}:${id}`)).toBe(true);
    expect(await b.mediaDb.get('links', `${other}:${id}`)).toMatchObject({ pending: 0, waiting: null });
  });
});

describe('cola de archivos: mostrar', () => {
  it('muestra la foto del dispositivo, y en otro dispositivo la miniatura bajada y guardada', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    const photo = mediaIdOf(await a.media.add(page, makeFile(MB, 'IMG_0007.JPG', 'image/jpeg')))!;
    const video = mediaIdOf(await a.media.add(page, makeFile(MB, 'IMG_0008.MOV', 'video/quicktime')))!;
    expect(await a.media.resolve(MEDIA_SCHEME + photo)).toMatch(/^blob:/);
    expect((await a.media.source(photo)).original?.size).toBe(MB);
    await sync(a);

    const dbName = crypto.randomUUID();
    const b = await device(server, dbName);
    await sync(b);
    expect(await b.media.resolve(MEDIA_SCHEME + video)).toMatch(/^blob:/);
    expect((await b.mediaDb.get('thumbs', video))?.type).toBe('image/jpeg');
    expect(await b.media.source(video)).toMatchObject({ kind: 'video', name: 'IMG_0008.MOV', original: null });
    expect(await b.media.pass(video)).toMatch(/\/m\/drive-/);

    // Sin red, la miniatura ya está en el dispositivo.
    await close(b);
    server.online = false;
    const c = await device(server, dbName);
    expect(await c.media.resolve(MEDIA_SCHEME + video)).toMatch(/^blob:/);
    // Lo que nunca se bajó muestra un ícono.
    expect(await c.media.resolve(MEDIA_SCHEME + photo)).toMatch(/^data:image\/svg\+xml/);
    // Otras direcciones vuelven tal cual.
    expect(await c.media.resolve('sdfile://p/x.jpg')).toBe('sdfile://p/x.jpg');
  });
});

describe('cola de archivos: ajustes del workspace', () => {
  it('sin portero no se usa, y recuerda la dirección para agregar sin red', async () => {
    const server = new FakeServer();
    const dbName = crypto.randomUUID();
    const a = await device(server, dbName);
    await sync(a);
    expect(a.media.enabled).toBe(false);

    server.settings = { ...server.settings!, mediaUrl: 'https://portero.test' };
    await sync(a);
    // Con portero pero con la base vieja (sin `files`), todavía no.
    expect(a.media.enabled).toBe(false);

    server.enableMedia();
    await sync(a);
    expect(a.media.enabled).toBe(true);
    expect(a.engine.getStatus()).toMatchObject({ mediaUrl: 'https://portero.test' });
    await close(a);

    server.online = false;
    const b = await device(server, dbName);
    expect(b.media.enabled).toBe(true);
  });

  it('después de restaurar una copia, vuelve a registrar sin volver a subir el archivo', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    const restore = server.backup();
    const other = await a.tree.create(null, 'Otra');
    const id = mediaIdOf(await a.media.add(page, makeFile(MB, 'IMG_0009.JPG', 'image/jpeg')))!;
    await sync(a);
    await a.media.ensureLinks(other, [id]);
    await sync(a);
    expect(server.pageFiles.has(`${other}:${id}`)).toBe(true);

    restore();
    expect(server.mediaFiles.has(id)).toBe(false);
    await sync(a);
    await sync(a);
    expect(server.mediaFiles.get(id)?.drive_id).toBeTruthy();
    expect(server.pageFiles.has(`${page}:${id}`)).toBe(true);
    expect(server.pageFiles.has(`${other}:${id}`)).toBe(true);
    expect(server.portero.drive.size).toBe(1);
    expect(a.engine.getStatus().pendingMedia).toBe(0);
  });
});

describe('tipos', () => {
  it('pasa el tipo a minúsculas y sin parámetros, o lo saca de la extensión', () => {
    expect(normalizeMime('Video/QuickTime', 'a.mov')).toBe('video/quicktime');
    expect(normalizeMime('video/mp4; codecs="avc1"', 'a.mp4')).toBe('video/mp4');
    expect(normalizeMime('', 'IMG_1234.HEIC')).toBe('image/heic');
    expect(normalizeMime('application/octet-stream', 'clip.MOV')).toBe('video/quicktime');
    expect(normalizeMime('', 'sin-extension')).toBe('application/octet-stream');
  });
});
