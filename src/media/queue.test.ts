import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { resolveObjectURL } from 'node:buffer';
import { FileRejected } from '../sync/files';
import { PART_BYTES, localDay } from './portero';
import { fileKind } from './attachments';
import { deletedLabel, mediaKind } from './probe';
import { MEDIA_SCHEME, STALL_MS, mediaIdOf, normalizeMime } from './queue';

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
    // Primero el archivo; medidas y miniatura se sacan después, del archivo ya guardado.
    expect(await a.mediaDb.get('files', id)).toMatchObject({ probed: false, width: null, thumb: 'none', pending: 1 });
    expect((await a.mediaDb.get('blobs', id))?.size).toBe(3 * MB);
    await a.media.idle();

    const record = await a.mediaDb.get('files', id);
    expect(record).toMatchObject({
      probed: true,
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

  it('con portero acepta cualquier archivo; solo rechaza los vacíos', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    expect(mediaIdOf(await a.media.add(page, makeFile(10, 'notas.pdf', 'application/pdf')))).toBeTruthy();
    expect(mediaIdOf(await a.media.add(page, makeFile(10, 'x.svg', 'image/svg+xml')))).toBeTruthy();
    await expect(a.media.add(page, makeFile(0, 'vacio.jpg', 'image/jpeg'))).rejects.toThrow(/empty/);
    await expect(a.media.add(page, makeFile(0, 'vacio.zip', ''))).rejects.toThrow(/empty/);
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

  it('una subida que no avanza (el portero no contesta, sin error) se aborta y la cola sigue; después sube', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      server.portero.hang = true;
      const id = mediaIdOf(await a.media.add(page, makeFile(MB, 'IMG_0002.JPG', 'image/jpeg')))!;
      await a.engine.syncNow();
      const running = a.engine.syncMedia();
      // Sin avance: pasado el tiempo del vigilante, la subida se aborta (antes quedaba colgada para siempre).
      for (let i = 0; i < 50 && !server.portero.calls.some((c) => c.path === '/upload'); i++) await new Promise((r) => setTimeout(r, 5));
      server.clockOffset += STALL_MS + 1;
      vi.advanceTimersByTime(STALL_MS);
      await running;
      expect(server.mediaFiles.get(id)?.drive_id).toBeFalsy();
      const status = a.engine.getStatus();
      expect(status.pendingMedia).toBe(1);
      // Vuelve a la cola para más tarde (no queda detenido) y, cuando el portero contesta, sube.
      server.portero.hang = false;
      server.clockOffset += 3_600_000;
      await sync(a);
      expect(server.mediaFiles.get(id)?.drive_id).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
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

  it('conoce las extensiones de los adjuntos sin cambiar qué es foto o video', () => {
    expect(normalizeMime('', 'notas.PDF')).toBe('application/pdf');
    expect(normalizeMime(undefined, 'fotos.rar')).toBe('application/vnd.rar');
    expect(normalizeMime('application/octet-stream', 'backup.7z')).toBe('application/x-7z-compressed');
    expect(normalizeMime('', 'comp_v012.nk')).toBe('application/x-nuke');
    expect(normalizeMime('', 'instalar.exe')).toBe('application/vnd.microsoft.portable-executable');
    expect(normalizeMime('', 'arte.psd')).toBe('image/vnd.adobe.photoshop');
    // El tipo que da el navegador gana sobre la extensión.
    expect(normalizeMime('text/plain', 'guion.pdf')).toBe('text/plain');
    const attachments = [
      'pdf', 'zip', 'rar', '7z', 'tar', 'gz', 'txt', 'csv', 'json', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pages',
      'numbers', 'key', 'mp3', 'wav', 'aif', 'aiff', 'm4a', 'flac', 'ogg', 'psd', 'exr', 'svg', 'exe', 'dmg', 'nk',
      'blend', 'fbx', 'abc', 'usd',
    ];
    for (const ext of attachments) {
      const mime = normalizeMime('', `archivo.${ext}`);
      expect(mime, ext).not.toBe('application/octet-stream');
      expect(fileKind(mime, `archivo.${ext}`), ext).toBe('file');
      // `mediaKind` sigue mirando solo el tipo: un PSD, un EXR o un SVG son `image/*`, lo demás nada.
      expect(mediaKind(mime), ext).toBe(['psd', 'exr', 'svg'].includes(ext) ? 'image' : null);
    }
    const media: Record<string, string> = { jpg: 'image', heic: 'image', dng: 'image', tif: 'image', mov: 'video', mp4: 'video', mkv: 'video' };
    for (const [ext, kind] of Object.entries(media)) expect(fileKind(normalizeMime('', `a.${ext}`), `a.${ext}`), ext).toBe(kind);
  });
});

describe('cola de archivos: correcciones de la auditoría', () => {
  it('con un portero viejo (sin linked) se detiene y no vuelve a subir el archivo en cada vuelta', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    server.portero.legacy = true;
    const id = mediaIdOf(await a.media.add(page, makeFile(MB, 'IMG_0100.JPG', 'image/jpeg')))!;
    for (let i = 0; i < 5; i++) {
      server.clockOffset += 20 * 60_000;
      await sync(a);
    }
    expect(server.portero.drive.size).toBe(1);
    expect(server.mediaFiles.get(id)?.drive_id).toBeNull();
    expect(await a.mediaDb.get('files', id)).toMatchObject({ pending: 1, blocked: true, driveId: null });
    expect(a.engine.getStatus()).toMatchObject({ pendingMedia: 0, failedMedia: 1 });
    expect((await a.media.failures())[0].error).toMatch(/media server needs an update/);

    // Se actualiza el portero y se toca "Retry": sube bien, a la carpeta del proyecto, una sola vez más.
    server.portero.legacy = false;
    await a.engine.retryRejected();
    await a.engine.syncMedia();
    await a.engine.syncNow();
    expect(server.mediaFiles.get(id)?.drive_id).toBeTruthy();
    expect(server.portero.drive.size).toBe(2);
    expect(a.engine.getStatus()).toMatchObject({ pendingMedia: 0, failedMedia: 0 });
  });

  it('si la base no se enteró de la subida, vuelve a preguntar sin volver a subir el archivo', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    server.portero.failLink = true;
    const id = mediaIdOf(await a.media.add(page, makeFile(PART_BYTES + MB, 'IMG_0107.MOV', 'video/quicktime')))!;
    for (let i = 0; i < 4; i++) {
      server.clockOffset += 20 * 60_000;
      await sync(a);
    }
    expect(server.portero.drive.size).toBe(1);
    // Una sola subida con partes: las vueltas siguientes solo preguntan (`POST /upload`, sin partes).
    expect(server.portero.calls.filter((c) => c.method === 'PUT' && c.range?.startsWith('bytes 0-'))).toHaveLength(1);
    expect(a.engine.getStatus().pendingMedia).toBe(1);

    server.portero.failLink = false;
    server.clockOffset += 20 * 60_000;
    await sync(a);
    expect(server.mediaFiles.get(id)?.drive_id).toBeTruthy();
    expect(server.portero.drive.size).toBe(1);
    expect(a.engine.getStatus().pendingMedia).toBe(0);
  });

  it('si el portero no sabe que el archivo llegó, se detiene en vez de subirlo otra vez', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    server.portero.failLink = true;
    const id = mediaIdOf(await a.media.add(page, makeFile(MB, 'IMG_0108.JPG', 'image/jpeg')))!;
    await sync(a);
    // El portero perdió lo que recordaba (por ejemplo, otra publicación): abriría una subida nueva.
    server.portero.drive.clear();
    server.portero.failLink = false;
    server.clockOffset += 20 * 60_000;
    await sync(a);
    expect(server.portero.calls.filter((c) => c.method === 'PUT').length).toBe(1);
    expect(await a.mediaDb.get('files', id)).toMatchObject({ blocked: true, driveId: null });
    expect(a.engine.getStatus().failedMedia).toBe(1);
  });

  it('un 409 porque la base apunta a otro archivo de Drive queda detenido, sin reintentar', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    server.portero.conflict = true;
    const id = mediaIdOf(await a.media.add(page, makeFile(MB, 'IMG_0109.JPG', 'image/jpeg')))!;
    await sync(a);
    const starts = server.portero.calls.filter((c) => c.path === '/upload').length;
    for (let i = 0; i < 3; i++) {
      server.clockOffset += 20 * 60_000;
      await sync(a);
    }
    expect(server.portero.calls.filter((c) => c.path === '/upload')).toHaveLength(starts);
    expect(await a.mediaDb.get('files', id)).toMatchObject({ blocked: true });
    expect((await a.media.failures())[0].error).toMatch(/different Drive file/);
  });

  it('si la cola falla al restaurar, el texto se recupera igual y la cola hace su parte después', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    const restore = server.backup();
    const id = mediaIdOf(await a.media.add(page, makeFile(MB, 'IMG_0110.JPG', 'image/jpeg')))!;
    const text = await a.tree.create(null, 'Después de la copia');
    await sync(a);
    expect(server.mediaFiles.get(id)?.drive_id).toBeTruthy();

    restore();
    const reset = a.media.resetForRestore.bind(a.media);
    a.media.resetForRestore = async () => {
      throw new Error('IndexedDB closed');
    };
    await sync(a);
    expect(server.pages.has(text)).toBe(true);
    expect(server.mediaFiles.has(id)).toBe(false);

    a.media.resetForRestore = reset;
    await sync(a);
    await sync(a);
    expect(server.mediaFiles.get(id)?.drive_id).toBeTruthy();
    expect(server.portero.drive.size).toBe(1);
    expect(a.engine.getStatus().pendingMedia).toBe(0);
  });

  it('si el portero dice linked pero la base no tiene el id de Drive, sigue pendiente', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    server.portero.lieLinked = true;
    const id = mediaIdOf(await a.media.add(page, makeFile(MB, 'IMG_0101.JPG', 'image/jpeg')))!;
    await sync(a);
    expect(await a.mediaDb.get('files', id)).toMatchObject({ pending: 1 });
    expect(a.engine.getStatus().pendingMedia).toBe(1);

    server.portero.lieLinked = false;
    server.clockOffset += 60_000;
    await sync(a);
    expect(server.portero.drive.size).toBe(1);
    expect(a.engine.getStatus().pendingMedia).toBe(0);
  });

  it('después de restaurar, lo que estaba a medio subir se vuelve a registrar', async () => {
    const server = new FakeServer();
    server.enableMedia();
    const a = await device(server);
    const page = await a.tree.create(null, 'Rodaje');
    await sync(a);
    const restore = server.backup();
    const file = makeFile(PART_BYTES + MB, 'IMG_0102.MOV', 'video/quicktime');
    const id = mediaIdOf(await a.media.add(page, file))!;
    server.portero.cutAfterParts = 1;
    await sync(a);
    expect(await a.mediaDb.get('files', id)).toMatchObject({ pending: 1, registered: true });

    restore();
    server.portero.reconnect();
    await sync(a);
    await sync(a);
    expect(server.mediaFiles.get(id)?.drive_id).toBeTruthy();
    expect(server.mediaFiles.get(id)?.thumb_at).toBeTruthy();
    expect(a.engine.getStatus().pendingMedia).toBe(0);
  });

  it('si el servidor perdió un archivo que figura registrado, lo vuelve a registrar en vez de detenerlo', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    const id = mediaIdOf(await a.media.add(page, makeFile(PART_BYTES + MB, 'IMG_0103.MOV', 'video/quicktime')))!;
    server.portero.cutAfterParts = 1;
    await sync(a);
    expect(await a.mediaDb.get('files', id)).toMatchObject({ registered: true, pending: 1 });

    // La base ya no lo tiene (por ejemplo, una restauración que este dispositivo no vio).
    server.mediaFiles.delete(id);
    server.portero.reconnect();
    server.portero.uploads.clear();
    for (let i = 0; i < 3; i++) {
      server.clockOffset += 20 * 60_000;
      await sync(a);
    }
    expect(server.mediaFiles.get(id)?.drive_id).toBeTruthy();
    expect(server.mediaFiles.get(id)?.thumb_at).toBeTruthy();
    expect(a.engine.getStatus()).toMatchObject({ pendingMedia: 0, failedMedia: 0 });
  });

  it('si la miniatura no se puede subir, sigue con el original sin ella', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    server.rejectThumbs = true;
    const id = mediaIdOf(await a.media.add(page, makeFile(MB, 'IMG_0104.JPG', 'image/jpeg')))!;
    await sync(a);
    expect(server.mediaFiles.get(id)).toMatchObject({ thumb_at: null });
    expect(server.mediaFiles.get(id)?.drive_id).toBeTruthy();
    expect(await a.mediaDb.get('files', id)).toMatchObject({ pending: 0, thumb: 'none' });
    expect((await a.mediaDb.get('files', id))?.thumbError).toMatch(/maximum allowed size/);
    // En la página se sigue viendo la miniatura del dispositivo.
    expect(await a.media.resolve(MEDIA_SCHEME + id)).toMatch(/^blob:/);
  });

  it('en la página muestra la miniatura, no el original', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    const id = mediaIdOf(await a.media.add(page, makeFile(MB, 'IMG_0105.JPG', 'image/jpeg')))!;
    // Antes de tener la miniatura, el ícono; cuando llega, se avisa al editor.
    const ready: string[] = [];
    a.media.subscribeThumbs((x) => ready.push(x));
    await a.media.idle();
    expect(ready).toEqual([id]);
    const shown = resolveObjectURL(await a.media.resolve(MEDIA_SCHEME + id));
    expect(shown?.size).toBe(6);
    expect(shown?.type).toBe('image/jpeg');
    // El original sigue a mano para el carrete.
    expect((await a.media.source(id)).original?.size).toBe(MB);
  });

  it('otro dispositivo que mostró el ícono se entera cuando llega la miniatura', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    server.online = false;
    const id = mediaIdOf(await a.media.add(page, makeFile(MB, 'IMG_0106.JPG', 'image/jpeg')))!;
    await a.media.idle();
    server.online = true;
    // `a` registra el archivo pero todavía no sube la miniatura.
    server.rejectThumbs = true;
    await sync(a);
    const b = await device(server);
    await sync(b);
    expect(await b.media.resolve(MEDIA_SCHEME + id)).toMatch(/^data:image\/svg\+xml/);
    const ready: string[] = [];
    b.media.subscribeThumbs((x) => ready.push(x));

    // Otro dispositivo sube la miniatura.
    server.thumbs.set(id, new Blob([new Uint8Array([0xff, 0xd8, 9])], { type: 'image/jpeg' }));
    server.mediaFiles.get(id)!.thumb_at = new Date().toISOString();
    server.clockOffset += 61_000;
    await sync(b);
    expect(ready).toEqual([id]);
    expect(await b.media.resolve(MEDIA_SCHEME + id)).toMatch(/^blob:/);
  });

  it('si la base de archivos no se abre, el texto sincroniza igual y lo avisa', async () => {
    const server = new FakeServer();
    server.enableMedia();
    server.mediaDbFails = true;
    const a = await device(server);
    const page = await a.tree.create(null, 'Solo texto');
    await sync(a);
    expect(server.pages.has(page)).toBe(true);
    expect(a.media.enabled).toBe(false);
    expect(a.engine.getStatus().mediaWarning).toMatch(/Photos and videos are off on this device/);
    expect(a.engine.getStatus().warning).toBeNull();
    await expect(a.media.add(page, makeFile(MB, 'x.jpg', 'image/jpeg'))).rejects.toBeInstanceOf(FileRejected);
    expect(await a.media.resolve(MEDIA_SCHEME + crypto.randomUUID())).toMatch(/^data:image\/svg\+xml/);
    await a.engine.retryRejected();
    expect(a.engine.getStatus().lastError).toBeNull();
  });
});

/** Lo que dice la tarjeta (el SVG de la dirección `data:`). */
function cardText(url: string): string {
  expect(url).toMatch(/^data:image\/svg\+xml/);
  return decodeURIComponent(url.slice(url.indexOf(',') + 1));
}

describe('adjuntos', () => {
  it('un PDF se guarda, se sube y se registra con su tipo, y en la página se ve la tarjeta', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    const id = mediaIdOf(await a.media.add(page, makeFile(2048, 'notas.pdf', 'application/pdf')))!;
    await a.media.idle();
    // Sin medidas ni miniatura: no se le pregunta al navegador.
    expect(await a.mediaDb.get('files', id)).toMatchObject({ mime: 'application/pdf', name: 'notas.pdf', probed: true, thumb: 'none' });
    expect(await a.mediaDb.get('thumbs', id)).toBeUndefined();
    expect(a.media.fileInfo(id)).toEqual({ kind: 'file', mime: 'application/pdf', name: 'notas.pdf', size: 2048, local: true });

    await sync(a);
    expect(server.mediaFiles.get(id)).toMatchObject({ mime: 'application/pdf', name: 'notas.pdf', size: 2048, thumb_at: null });
    expect(server.mediaFiles.get(id)?.drive_id).toBeTruthy();
    expect(server.thumbs.has(id)).toBe(false);
    expect(server.pageFiles.has(`${page}:${id}`)).toBe(true);

    const card = cardText(await a.media.resolve(MEDIA_SCHEME + id));
    expect(card).toContain('notas.pdf');
    expect(card).toMatch(/PDF · 2 KB/);
    // La impresión no lo toma por una foto.
    expect(await a.media.localImage(id)).toBeNull();
    expect((await a.media.localOriginal(id))?.size).toBe(2048);
  });

  it('un SVG o un PSD son adjuntos: sin miniatura, con tarjeta; un archivo sin tipo sale de la extensión', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    const svg = mediaIdOf(await a.media.add(page, makeFile(10, 'x.svg', 'image/svg+xml')))!;
    const psd = mediaIdOf(await a.media.add(page, makeFile(10, 'arte.psd', '')))!;
    const rar = mediaIdOf(await a.media.add(page, makeFile(10, 'fotos.rar', '')))!;
    await a.media.idle();
    expect(await a.mediaDb.get('files', svg)).toMatchObject({ mime: 'image/svg+xml', thumb: 'none', width: null });
    expect(await a.mediaDb.get('files', psd)).toMatchObject({ mime: 'image/vnd.adobe.photoshop', thumb: 'none', width: null });
    expect(await a.mediaDb.get('files', rar)).toMatchObject({ mime: 'application/vnd.rar' });
    expect(a.media.fileInfo(svg)?.kind).toBe('file');
    expect(a.media.fileInfo(psd)?.kind).toBe('file');
    expect(cardText(await a.media.resolve(MEDIA_SCHEME + svg))).toContain('>SVG<');
    expect(cardText(await a.media.resolve(MEDIA_SCHEME + rar))).toContain('>RAR<');
    expect(await a.media.localImage(psd)).toBeNull();
  });

  it('en otro dispositivo: la tarjeta con el peso sale de la base, una sola vez, sin esperar miniatura', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    const url = await a.media.add(page, makeFile(3 * MB, 'plano.zip', 'application/zip'));
    const id = mediaIdOf(url)!;
    await sync(a);
    const b = await device(server);
    await sync(b);
    expect(b.media.fileInfo(id)).toBeNull();

    const fetch = vi.spyOn(b.remote, 'fetchMediaFiles');
    const card = cardText(await b.media.resolve(url));
    expect(card).toContain('plano.zip');
    expect(card).toMatch(/ZIP · 3 MB/);
    expect(b.media.fileInfo(id)).toEqual({ kind: 'file', mime: 'application/zip', name: 'plano.zip', size: 3 * MB, local: false });
    expect((b.media as unknown as { missing: Set<string> }).missing.size).toBe(0);
    const calls = fetch.mock.calls.length;
    // Se vuelve a dibujar: la misma tarjeta, sin preguntar de nuevo.
    expect(await b.media.resolve(url)).toBe(await b.media.resolve(url));
    expect(fetch.mock.calls.length).toBe(calls);
    expect(await b.mediaDb.get('known', id)).toMatchObject({ size: 3 * MB, mime: 'application/zip' });
  });

  it('un adjunto que todavía no estaba en la base: cuando aparece, avisa y deja de esperar miniatura', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    const b = await device(server);
    await sync(b);
    server.online = false;
    const url = await a.media.add(page, makeFile(10, 'guion.txt', 'text/plain'));
    const id = mediaIdOf(url)!;
    server.online = true;
    // El otro dispositivo lo ve antes de que llegue: "todavía no".
    expect(cardText(await b.media.resolve(url))).toContain(t('queue.notYet'));
    const missing = (b.media as unknown as { missing: Set<string> }).missing;
    expect(missing.has(id)).toBe(true);

    await sync(a);
    const heard: string[] = [];
    b.media.subscribeThumbs((x) => heard.push(x));
    server.clockOffset += 61_000;
    await b.engine.syncMedia();
    expect(heard).toEqual([id]);
    expect(missing.size).toBe(0);
    expect(await b.mediaDb.get('known', id)).toMatchObject({ mime: 'text/plain', name: 'guion.txt' });
    const card = cardText(await b.media.resolve(url));
    expect(card).toContain('guion.txt');
    expect(card).not.toContain(t('queue.notYet'));
  });

  it('en una página de otro proyecto se ve la tarjeta de otro proyecto, con la misma forma', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    const url = await a.media.add(page, makeFile(10, 'notas.pdf', 'application/pdf'));
    await sync(a);
    const other = await a.tree.createProject('Otro rodaje');
    const foreign = await a.tree.create(null, 'Día 1 (otro)', other);
    const card = cardText(await a.media.resolve(url, foreign));
    expect(card).toContain(t('attachment.foreign'));
    expect(card).toContain('notas.pdf');
    expect(card).toContain('width="360" height="96"');
    expect(cardText(await a.media.resolve(url, page))).not.toContain(t('attachment.foreign'));
  });

  it('un adjunto mandado a la papelera de Drive se ve tachado', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    const url = await a.media.add(page, makeFile(10, 'notas.pdf', 'application/pdf'));
    const id = mediaIdOf(url)!;
    await sync(a);
    server.mediaFiles.get(id)!.drive_trashed_at = new Date().toISOString();
    const b = await device(server);
    await sync(b);
    const card = cardText(await b.media.resolve(url));
    expect(card).toContain('line-through');
    expect(card).toContain(deletedLabel());
    expect(card).toContain('width="360" height="96"');
  });

  it('sin portero, un adjunto se rechaza con el aviso de conectar Google Drive (las fotos siguen)', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const page = await a.tree.create(null, 'Día 3');
    await sync(a);
    expect(a.media.enabled).toBe(false);
    await expect(a.media.add(page, makeFile(10, 'notas.pdf', 'application/pdf'))).rejects.toThrow(/Google Drive/);
    expect(mediaIdOf(await a.media.add(page, makeFile(10, 'IMG_1.JPG', 'image/jpeg')))).toBeTruthy();
  });
});

describe('espacio en el dispositivo', () => {
  function mockStorage(usage: number, quota: number) {
    const storage = { estimate: vi.fn(async () => ({ usage, quota })), persist: vi.fn(async () => true) };
    Object.defineProperty(navigator, 'storage', { value: storage, configurable: true });
    return storage;
  }
  afterEach(() => {
    delete (navigator as { storage?: unknown }).storage;
  });

  it('algo grande que no entra con el margen no se guarda, y se avisa', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    const storage = mockStorage(100 * MB, 400 * MB);
    const big = new File([new Uint8Array(120 * MB)], 'render.mov', { type: 'video/quicktime' });
    await expect(a.media.add(page, big)).rejects.toThrow(/no room/);
    expect(await a.mediaDb.count('files')).toBe(0);
    expect(await a.mediaDb.count('blobs')).toBe(0);
    expect(storage.estimate).toHaveBeenCalledTimes(1);

    // Lo chico no pregunta; y el pedido de que no se borre lo guardado va una sola vez.
    await a.media.add(page, makeFile(10, 'IMG_1.JPG', 'image/jpeg'));
    await a.media.add(page, makeFile(10, 'IMG_2.JPG', 'image/jpeg'));
    expect(storage.estimate).toHaveBeenCalledTimes(1);
    expect(storage.persist).toHaveBeenCalledTimes(1);
  });

  it('con lugar de sobra se guarda; sin `navigator.storage`, también', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    mockStorage(100 * MB, 50 * 1024 * MB);
    const big = new File([new Uint8Array(60 * MB)], 'render.zip', { type: 'application/zip' });
    expect(mediaIdOf(await a.media.add(page, big))).toBeTruthy();
    delete (navigator as { storage?: unknown }).storage;
    expect(mediaIdOf(await a.media.add(page, big))).toBeTruthy();
  });
});

describe('qué hace la cola con cada error del portero', () => {
  it('Drive lleno (507, portero desde v0.048) queda detenido con el aviso; un 502 se reintenta', async () => {
    const { classify } = await import('./queue');
    const { PorteroError } = await import('./portero');
    expect(classify(new PorteroError('Google Drive is full.', 507, false))).toBe('blocked');
    expect(classify(new PorteroError('Google Drive answered 500', 502, false))).toBe('retry');
  });
});
