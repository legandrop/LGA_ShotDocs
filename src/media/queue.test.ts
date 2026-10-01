import { createClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import { SupabaseRemote, THUMB_DOWNLOAD_TIMEOUT_MS, timeoutFor } from '../sync/remote';
import { FakeServer, fakeProbe, makeDevice, type Device } from '../sync/testing';
import { resolveObjectURL } from 'node:buffer';
import { FileRejected } from '../sync/files';
import { CONTROL_TIMEOUT_MS, PART_BYTES, STALL_CHECK_MS, STALL_MS, answerLimit, localDay } from './portero';
import { fileKind } from './attachments';
import { deletedLabel, mediaKind } from './probe';
import { MEDIA_SCHEME, STALLS_BEFORE_RENEW, heicNotice, mediaIdOf, normalizeMime } from './queue';
import { HEIC_SAMPLE } from './fixtures/heicSample';
import { HeicError } from './heic';

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

// Un pedido al portero que nunca contesta (sin error de red) dejaba la cola entera clavada, porque se sube de
// a uno. El portero corta el pedido que deja de moverse y la cola sigue (Docs/Doc_Portero.md, "Subidas que se
// traban"). Acá el tiempo no pasa de verdad: se adelanta el reloj y se hace mirar al vigilante.
describe('cola de archivos: subidas que se traban', () => {
  /** Lo que tarda en volver a intentarse un archivo que falló (más que la espera más larga de estas pruebas). */
  const LATER = 60_000;
  const never = () => new Promise<void>(() => undefined);

  /** Espera de verdad (unos milisegundos) a que pase algo que depende de la base del dispositivo. */
  async function until(check: () => boolean): Promise<void> {
    for (let i = 0; i < 600 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
    expect(check()).toBe(true);
  }

  /**
   * Pasa el tiempo, de a una mirada del vigilante por vez, como cuando pasa de verdad (un salto grande del
   * reloj entre dos miradas es un equipo suspendido, y ese tiempo no cuenta).
   */
  function elapse(server: FakeServer, ms: number): void {
    for (let left = ms; left > 0; left -= STALL_CHECK_MS) {
      const step = Math.min(left, STALL_CHECK_MS);
      server.clockOffset += step;
      vi.advanceTimersByTime(step);
    }
  }

  /** Una vuelta de la cola, y si terminó. */
  function round(d: Device): { done: Promise<void>; finished: () => boolean } {
    let finished = false;
    const done = d.engine.syncMedia().then(() => {
      finished = true;
    });
    return { done, finished: () => finished };
  }

  /** Una vuelta en la que un pedido queda colgado: se espera a que salga, pasa el tiempo límite y termina. */
  async function stalledRound(d: Device, server: FakeServer, hung: () => boolean, limit = STALL_MS): Promise<void> {
    const { done, finished } = round(d);
    await until(hung);
    // Un poco antes del límite sigue esperando (no se corta de más)...
    elapse(server, limit - 2 * STALL_CHECK_MS);
    await new Promise((r) => setTimeout(r, 20));
    expect(finished()).toBe(false);
    // ...y pasado el límite se corta.
    elapse(server, 3 * STALL_CHECK_MS);
    await done;
  }

  async function withFile(size: number, name = 'IMG_0002.JPG'): Promise<{ server: FakeServer; a: Device; file: File; id: string }> {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    const file = makeFile(size, name, 'image/jpeg');
    const id = mediaIdOf(await a.media.add(page, file))!;
    await a.engine.syncNow();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    return { server, a, file, id };
  }

  /** Los pedidos de subida al portero, en orden: la parte o la pregunta (`Content-Range`), o `POST /upload`. */
  const uploadCalls = (server: FakeServer) =>
    server.portero.calls.filter((c) => c.path.startsWith('/upload')).map((c) => c.range ?? `${c.method} ${c.path}`);

  afterEach(() => {
    vi.useRealTimers();
  });

  it('si el portero no contesta al abrir la subida, se corta al minuto y el archivo vuelve a la cola; después sube', async () => {
    const { server, a, id } = await withFile(MB);
    server.portero.hang = true;
    await stalledRound(a, server, () => server.portero.calls.some((c) => c.path === '/upload'), CONTROL_TIMEOUT_MS);

    expect(server.mediaFiles.get(id)?.drive_id).toBeFalsy();
    const record = await a.mediaDb.get('files', id);
    // No queda detenido: se reintenta solo. El original sigue en el dispositivo.
    expect(record).toMatchObject({ pending: 1, blocked: false, stalls: 1, uploadId: null });
    expect(record?.error).toMatch(/stopped moving/);
    expect((await a.mediaDb.get('blobs', id))?.size).toBe(MB);
    await until(() => a.engine.getStatus().pendingMedia === 1);
    expect(a.engine.getStatus().failedMedia).toBe(0);

    server.portero.hang = false;
    server.clockOffset += LATER;
    await a.engine.syncMedia();
    expect(server.mediaFiles.get(id)?.drive_id).toBeTruthy();
    expect(await a.mediaDb.get('files', id)).toMatchObject({ pending: 0, stalls: 0, error: null });
  });

  it('una parte colgada (no sale ni un byte) se corta; a la segunda seguida se abre otra subida, sin duplicar', async () => {
    const { server, a, file, id } = await withFile(MB);
    let hung = 0;
    server.portero.partDelay = () => {
      hung++;
      return never();
    };

    // Primera: se corta y queda la misma subida para retomar.
    await stalledRound(a, server, () => hung === 1);
    const first = await a.mediaDb.get('files', id);
    expect(first).toMatchObject({ pending: 1, blocked: false, stalls: 1, sent: 0 });
    expect(first?.uploadId).toBeTruthy();
    expect(first?.error).toMatch(/stopped moving/);

    // Segunda: retoma la misma (pregunta cuánto llegó) y se vuelve a trabar.
    server.clockOffset += LATER;
    await stalledRound(a, server, () => hung === 2);
    expect(await a.mediaDb.get('files', id)).toMatchObject({ stalls: STALLS_BEFORE_RENEW, uploadId: first!.uploadId, sent: 0 });
    expect(server.portero.uploads.size).toBe(1);

    // Tercera: le pregunta a la que hay; no recibió nada, así que abre otra y sube por ahí.
    server.portero.partDelay = null;
    server.portero.calls.length = 0;
    server.clockOffset += LATER;
    await a.engine.syncMedia();
    expect(uploadCalls(server)).toEqual([`bytes */${MB}`, 'POST /upload', `bytes 0-${MB - 1}/${MB}`]);
    expect(server.portero.uploads.size).toBe(2);
    expect(server.portero.drive.size).toBe(1);
    const row = server.mediaFiles.get(id)!;
    expect(await same(file, server.portero.drive.get(row.drive_id!)!.data)).toBe(true);
    expect(await a.mediaDb.get('files', id)).toMatchObject({ pending: 0, stalls: 0, uploadId: null, error: null });
  });

  it('abrir otra subida no es avanzar, y se abre cada dos trabadas, no en cada una desde la segunda', async () => {
    const { server, a, id } = await withFile(MB);
    let hung = 0;
    server.portero.partDelay = () => {
      hung++;
      return never();
    };
    const again = async (times: number) => {
      server.clockOffset += 10 * LATER;
      await stalledRound(a, server, () => hung === times);
      return (await a.mediaDb.get('files', id))!;
    };

    await stalledRound(a, server, () => hung === 1);
    expect(await again(2)).toMatchObject({ stalls: 2 });
    expect(server.portero.uploads.size).toBe(1);
    // Tercera: van dos, así que abre otra subida... que también se traba. Sigue la cuenta: son tres.
    expect(await again(3)).toMatchObject({ stalls: 3, sent: 0 });
    expect(server.portero.uploads.size).toBe(2);
    // Cuarta: con tres no toca abrir otra; se retoma la segunda.
    expect(await again(4)).toMatchObject({ stalls: 4 });
    expect(server.portero.uploads.size).toBe(2);

    // Quinta: van cuatro, toca otra, y esta vez pasa. En Drive queda una sola copia.
    server.portero.partDelay = null;
    server.clockOffset += 10 * LATER;
    await a.engine.syncMedia();
    expect(server.portero.uploads.size).toBe(3);
    expect(server.portero.drive.size).toBe(1);
    expect(await a.mediaDb.get('files', id)).toMatchObject({ pending: 0, stalls: 0, uploadId: null });
  });

  it('un video al que le llega una parte más en cada vuelta no espera cada vez más para seguir', async () => {
    const size = 3 * PART_BYTES + MB;
    const { server, a, file, id } = await withFile(size, 'IMG_0800.JPG');
    let pass = 0;
    let hung = 0;
    // En cada vuelta pasa una parte y la siguiente se traba.
    server.portero.partDelay = () => {
      if (pass-- > 0) return Promise.resolve();
      hung++;
      return never();
    };
    for (let lap = 1; lap <= 3; lap++) {
      pass = 1;
      server.clockOffset += LATER;
      await stalledRound(a, server, () => hung === lap);
      const record = (await a.mediaDb.get('files', id))!;
      // Avanzó: es la primera trabada y la primera falla, y la espera es la más corta (10 s), no 10, 20, 40...
      expect(record).toMatchObject({ stalls: 1, failures: 1, sent: lap * PART_BYTES, blocked: false });
      const wait = record.retryAt - (Date.now() + server.clockOffset);
      expect(wait).toBeGreaterThan(0);
      expect(wait).toBeLessThanOrEqual(10_000);
    }

    server.portero.partDelay = null;
    server.clockOffset += LATER;
    await a.engine.syncMedia();
    expect(server.portero.uploads.size).toBe(1);
    const row = server.mediaFiles.get(id)!;
    expect(await same(file, server.portero.drive.get(row.drive_id!)!.data)).toBe(true);
    expect(await a.mediaDb.get('files', id)).toMatchObject({ pending: 0, stalls: 0, failures: 0 });
  });

  it('una subida lenta pero sana no se corta: mientras salgan bytes, la parte tarda lo que tarde', async () => {
    const { server, a, file, id } = await withFile(MB);
    const out: { part?: { size: number; sent: (bytes: number) => void }; arrive?: () => void } = {};
    server.portero.partDelay = (part) => {
      out.part = part;
      return new Promise((resolve) => (out.arrive = resolve));
    };
    const { done, finished } = round(a);
    await until(() => !!out.part);

    // 20 tramos de casi dos minutos sin que salga nada y después un poco más del archivo: la parte tarda
    // unos 37 minutos (18 veces el tiempo del vigilante), pero nunca pasa ese tiempo sin moverse.
    const steps = 20;
    for (let i = 1; i <= steps; i++) {
      elapse(server, STALL_MS - 2 * STALL_CHECK_MS);
      out.part!.sent(Math.floor((out.part!.size * i) / steps));
    }
    // Ya salió entera: el portero se la pasa a Drive y tarda en contestar más que el tiempo del vigilante
    // (a la respuesta se le da ese tiempo más lo que tardó el cuerpo, hasta el doble).
    elapse(server, STALL_MS + 30_000);
    await new Promise((r) => setTimeout(r, 20));
    expect(finished()).toBe(false);

    out.arrive!();
    await done;
    expect(uploadCalls(server)).toEqual(['POST /upload', `bytes 0-${MB - 1}/${MB}`]);
    const row = server.mediaFiles.get(id)!;
    expect(await same(file, server.portero.drive.get(row.drive_id!)!.data)).toBe(true);
    expect(await a.mediaDb.get('files', id)).toMatchObject({ pending: 0, stalls: 0, error: null, failures: 0 });
  });

  it('la parte salió entera y la respuesta no llega nunca: también se corta', async () => {
    const { server, a, id } = await withFile(MB);
    server.portero.loseAnswer = true;
    server.portero.failLink = true;
    await stalledRound(a, server, () => server.portero.drive.size === 1);
    expect(await a.mediaDb.get('files', id)).toMatchObject({ pending: 1, stalls: 1 });
  });

  it('si la última parte ya había llegado, no abre otra subida: le pregunta a la que hay y no sube dos veces', async () => {
    const { server, a, id } = await withFile(MB);
    let hung = 0;
    server.portero.partDelay = () => {
      hung++;
      return never();
    };
    await stalledRound(a, server, () => hung === 1);

    // Segunda trabada seguida: esta vez la parte llega a Drive, pero la respuesta no vuelve y la base no se
    // entera. Para la app es igual que la anterior: no avanzó.
    server.portero.partDelay = null;
    server.portero.loseAnswer = true;
    server.portero.failLink = true;
    server.clockOffset += LATER;
    // Ya se había trabado una vez: a la respuesta se la espera más que la primera vez.
    expect(answerLimit(MB, 1)).toBeGreaterThan(STALL_MS);
    await stalledRound(a, server, () => server.portero.drive.size === 1, answerLimit(MB, 1));
    expect(await a.mediaDb.get('files', id)).toMatchObject({ pending: 1, stalls: STALLS_BEFORE_RENEW });
    expect(server.mediaFiles.get(id)?.drive_id).toBeFalsy();

    // Tercera: tocaría abrir otra subida, pero primero pregunta, y la que hay ya terminó: no manda nada más.
    server.portero.loseAnswer = false;
    server.portero.failLink = false;
    server.portero.calls.length = 0;
    server.clockOffset += LATER;
    await a.engine.syncMedia();
    expect(uploadCalls(server)).toEqual([`bytes */${MB}`]);
    expect(server.portero.uploads.size).toBe(1);
    expect(server.portero.drive.size).toBe(1);
    expect(server.mediaFiles.get(id)?.drive_id).toBeTruthy();
    expect(await a.mediaDb.get('files', id)).toMatchObject({ pending: 0, stalls: 0, uploadId: null });
  });

  it('las trabadas se cuentan seguidas y sin avance; una subida que ya recibió algo se retoma siempre', async () => {
    const size = PART_BYTES + MB;
    const { server, a, file, id } = await withFile(size, 'IMG_0700.JPG');
    let hung = 0;
    const hang = () => {
      hung++;
      return never();
    };

    // Primera: se traba la primera parte.
    server.portero.partDelay = hang;
    await stalledRound(a, server, () => hung === 1);
    const first = await a.mediaDb.get('files', id);
    expect(first).toMatchObject({ stalls: 1, sent: 0 });

    // Segunda: la primera parte llega (la cuenta vuelve a cero) y se traba la segunda: es la primera sin avance.
    server.portero.partDelay = (part) => (part.size === PART_BYTES ? Promise.resolve() : hang());
    server.clockOffset += LATER;
    await stalledRound(a, server, () => hung === 2);
    expect(await a.mediaDb.get('files', id)).toMatchObject({ stalls: 1, sent: PART_BYTES, uploadId: first!.uploadId });

    // Tercera: retoma, no avanza y se vuelve a trabar: van dos seguidas.
    server.clockOffset += LATER;
    await stalledRound(a, server, () => hung === 3);
    expect(await a.mediaDb.get('files', id)).toMatchObject({ stalls: 2, sent: PART_BYTES, uploadId: first!.uploadId });

    // Cuarta: ni la pregunta de cuánto llegó contesta. Otra trabada, y lo que la subida ya había confirmado
    // no se pierde de vista (si bajara a cero, la próxima pregunta que conteste parecería un avance).
    server.portero.partDelay = null;
    server.portero.hang = true;
    server.portero.calls.length = 0;
    server.clockOffset += LATER;
    await stalledRound(a, server, () => server.portero.calls.length === 1, CONTROL_TIMEOUT_MS);
    expect(uploadCalls(server)).toEqual([`bytes */${size}`]);
    expect(await a.mediaDb.get('files', id)).toMatchObject({ stalls: 3, sent: PART_BYTES, uploadId: first!.uploadId });

    // Quinta: aunque se trabó varias veces, la subida ya tiene la primera parte: se sigue con ella, sin
    // mandar eso de nuevo.
    server.portero.hang = false;
    server.portero.calls.length = 0;
    server.clockOffset += 2 * LATER;
    await a.engine.syncMedia();
    expect(uploadCalls(server)).toEqual([`bytes */${size}`, `bytes ${PART_BYTES}-${size - 1}/${size}`]);
    expect(server.portero.uploads.size).toBe(1);
    const row = server.mediaFiles.get(id)!;
    expect(await same(file, server.portero.drive.get(row.drive_id!)!.data)).toBe(true);
    expect(await a.mediaDb.get('files', id)).toMatchObject({ pending: 0, stalls: 0, uploadId: null });
  });

  it('si el cuerpo sale de golpe (un antivirus o un proxy en el medio) y sube despacio, cada trabada le da más plazo y termina pasando', async () => {
    const { server, a, file, id } = await withFile(MB);
    const out: { arrive?: () => void } = {};
    // El navegador da la parte por enviada al instante, pero al portero le llega mucho después.
    server.portero.partDelay = (part) => {
      part.sent(part.size);
      return new Promise((resolve) => (out.arrive = resolve));
    };
    const NEEDS = STALL_MS + 30_000;
    expect(answerLimit(MB, 1)).toBeGreaterThan(NEEDS);

    // Primera: a los dos minutos sin respuesta se corta (todavía no se sabe si es lenta o está colgada).
    await stalledRound(a, server, () => !!out.arrive);
    expect(await a.mediaDb.get('files', id)).toMatchObject({ pending: 1, stalls: 1 });

    // Segunda: con más plazo, la misma espera ya no la corta, y la parte llega.
    out.arrive = undefined;
    server.clockOffset += LATER;
    const { done, finished } = round(a);
    await until(() => !!out.arrive);
    elapse(server, NEEDS);
    await new Promise((r) => setTimeout(r, 20));
    expect(finished()).toBe(false);
    out.arrive!();
    await done;

    expect(server.portero.uploads.size).toBe(1);
    const row = server.mediaFiles.get(id)!;
    expect(await same(file, server.portero.drive.get(row.drive_id!)!.data)).toBe(true);
    expect(await a.mediaDb.get('files', id)).toMatchObject({ pending: 0, stalls: 0, error: null });
  });

  it('cerrar la app con una parte en camino no cuenta como trabada: queda para retomar', async () => {
    const { server, a, id } = await withFile(MB);
    let hung = 0;
    server.portero.partDelay = () => {
      hung++;
      return never();
    };
    const { done } = round(a);
    await until(() => hung === 1);
    a.engine.stop();
    await done;

    const record = (await a.mediaDb.get('files', id))!;
    expect(record).toMatchObject({ pending: 1, blocked: false, error: null, failures: 0 });
    expect(record.uploadId).toBeTruthy();
    expect(record.stalls ?? 0).toBe(0);
    expect(server.mediaFiles.get(id)?.drive_id).toBeFalsy();
  });

  it('un archivo trabado no frena a los demás: se corta y la cola sigue con el siguiente', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    const stuck = mediaIdOf(await a.media.add(page, makeFile(MB, 'trabado.jpg', 'image/jpeg')))!;
    // La cola sube por orden de llegada: el trabado va primero.
    server.clockOffset += 1000;
    const other = mediaIdOf(await a.media.add(page, makeFile(MB, 'otro.jpg', 'image/jpeg')))!;
    await a.engine.syncNow();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let hung = 0;
    server.portero.partDelay = ({ uploadId }) => {
      if (server.portero.uploads.get(uploadId)?.file !== stuck) return Promise.resolve();
      hung++;
      return never();
    };

    const { done } = round(a);
    await until(() => hung === 1);
    // Mientras está colgado, el otro espera (se sube de a uno): es lo que antes duraba minutos.
    await new Promise((r) => setTimeout(r, 30));
    expect(server.mediaFiles.get(other)?.drive_id).toBeFalsy();
    elapse(server, STALL_MS + STALL_CHECK_MS);
    await done;

    expect(server.mediaFiles.get(other)?.drive_id).toBeTruthy();
    expect(server.mediaFiles.get(stuck)?.drive_id).toBeFalsy();
    expect(await a.mediaDb.get('files', stuck)).toMatchObject({ pending: 1, blocked: false, stalls: 1 });
    expect(await a.mediaDb.get('files', other)).toMatchObject({ pending: 0 });
    // Lo que se ve en la app (el conteo se actualiza un instante después de la vuelta): falta uno, sin detenidos.
    await until(() => a.engine.getStatus().pendingMedia === 1);
    expect(a.engine.getStatus().failedMedia).toBe(0);
  });

  it('un registro guardado por una versión anterior (sin `stalls`) sube igual', async () => {
    const { server, a, id } = await withFile(MB);
    // Así queda un archivo agregado y todavía sin subir: el campo no existe (como en lo guardado antes de v0.068).
    expect(Object.keys((await a.mediaDb.get('files', id))!)).not.toContain('stalls');
    await a.engine.syncMedia();
    expect(server.mediaFiles.get(id)?.drive_id).toBeTruthy();
    expect(await a.mediaDb.get('files', id)).toMatchObject({ pending: 0, stalls: 0 });
  });
});

// Los dos pedidos de la miniatura a Storage (subirla antes del original; bajar las de otros dispositivos al
// final de la vuelta) no tenían tope: si Storage no contestaba, la cola quedaba esperando igual que con el
// portero colgado. Acá las miniaturas pasan por el cliente de verdad (`SupabaseRemote`, con su tope) contra un
// Storage de mentira, y lo demás por los dobles de siempre. El reloj de los topes es simulado.
describe('cola de archivos: miniaturas que Storage no contesta', () => {
  const LATER = 60_000;
  const realTimeout = AbortSignal.timeout;
  // El de verdad, para esperar a la base del dispositivo con el reloj de los topes simulado.
  const realSetTimeout = globalThis.setTimeout;
  const pause = (ms: number) => new Promise((r) => realSetTimeout(r, ms));

  async function until(check: () => boolean): Promise<void> {
    for (let i = 0; i < 600 && !check(); i++) await pause(5);
    expect(check()).toBe(true);
  }

  /** Lo que tarda Storage en contestar cada pedido; `never` es que no contesta. */
  interface Storage {
    upload: (id: string) => Promise<void>;
    download: (id: string) => Promise<void>;
    /** Los pedidos que llegaron, en orden: `POST <id>` o `GET <id>`. */
    calls: string[];
    /** Los pedidos de bajada que el navegador cortó. */
    aborted: string[];
  }
  const never = () => new Promise<void>(() => undefined);

  /**
   * Las miniaturas de `d` van por `SupabaseRemote` a un Storage en memoria que guarda en el bucket del
   * servidor de prueba. Desde acá el reloj de los topes es simulado (`setTimeout`); la cola sigue con el suyo
   * (`server.clockOffset`).
   */
  function realThumbs(d: Device, server: FakeServer): Storage {
    const storage: Storage = { upload: () => Promise.resolve(), download: () => Promise.resolve(), calls: [], aborted: [] };
    const json = (body: unknown, status: number) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const fetchStorage: typeof fetch = async (input, init) => {
      const id = /\/object\/thumbs\/([^/?]+)\.jpg/.exec(String(input))![1];
      const method = init?.method ?? 'GET';
      storage.calls.push(`${method} ${id}`);
      if (method === 'POST') {
        await storage.upload(id);
        // Sin reemplazar: si ya está, lo dice (y la app lo da por hecho).
        if (server.thumbs.has(id)) return json({ statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }, 400);
        server.thumbs.set(id, (init!.body as FormData).get('') as Blob);
        return json({ Id: id, Key: `thumbs/${id}.jpg` }, 200);
      }
      // La bajada sí se puede cortar: `download` le pasa la señal del tope al pedido.
      await new Promise<void>((resolve, reject) => {
        const signal = init?.signal;
        const cut = () => {
          storage.aborted.push(id);
          reject(signal!.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
        };
        signal?.addEventListener('abort', cut);
        // Una señal que vence con el pedido ya contestado no corta nada.
        void storage.download(id).then(() => {
          signal?.removeEventListener('abort', cut);
          resolve();
        });
      });
      const thumb = server.thumbs.get(id);
      return thumb ? new Response(thumb) : json({ statusCode: '404', error: 'not_found', message: 'Object not found' }, 400);
    };
    const client = createClient('https://example.supabase.co', 'sb_publishable_test', {
      global: { fetch: fetchStorage },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const real = new SupabaseRemote(client, '0.070');
    d.remote.uploadThumb = (id, data) => real.uploadThumb(id, data);
    d.remote.downloadThumb = (id) => real.downloadThumb(id);
    // El tope por `setTimeout` (el que se usa si el navegador no tiene `AbortSignal.timeout`), para poder
    // adelantar el reloj. IndexedDB de prueba no usa `setTimeout`.
    (AbortSignal as { timeout: unknown }).timeout = undefined;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    return storage;
  }

  /** Una vuelta de la cola, y si terminó. */
  function round(d: Device): { done: Promise<void>; finished: () => boolean } {
    let finished = false;
    const done = d.engine.syncMedia().then(() => {
      finished = true;
    });
    return { done, finished: () => finished };
  }

  /**
   * Una vuelta en la que un pedido a Storage queda colgado: sigue esperando hasta su tope, y ahí termina. Con
   * `server`, el reloj de la cola (que no corre con el de los topes) avanza lo mismo mientras espera.
   */
  async function hungRound(d: Device, hung: () => boolean, limit: number, server?: FakeServer): Promise<void> {
    const { done, finished } = round(d);
    await until(hung);
    if (server) server.clockOffset += limit;
    await vi.advanceTimersByTimeAsync(limit - 1000);
    await pause(30);
    expect(finished()).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    await done;
  }

  afterEach(() => {
    vi.useRealTimers();
    (AbortSignal as { timeout: unknown }).timeout = realTimeout;
  });

  it('si Storage no contesta al subir la miniatura, se corta al vencer el tope: el archivo vuelve a la cola y los demás siguen', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    const stuck = mediaIdOf(await a.media.add(page, makeFile(MB, 'trabado.jpg', 'image/jpeg')))!;
    // La cola sube por orden de llegada: el trabado va primero.
    server.clockOffset += 1000;
    const other = mediaIdOf(await a.media.add(page, makeFile(MB, 'otro.jpg', 'image/jpeg')))!;
    await a.media.idle();
    await a.engine.syncNow();
    const thumb = (await a.mediaDb.get('thumbs', stuck))!;
    const storage = realThumbs(a, server);
    storage.upload = (id) => (id === stuck ? never() : Promise.resolve());

    await hungRound(a, () => storage.calls.includes(`POST ${stuck}`), timeoutFor(thumb.size));

    // El otro subió entero en la misma vuelta, con su miniatura.
    expect(server.mediaFiles.get(other)?.drive_id).toBeTruthy();
    expect(server.mediaFiles.get(other)?.thumb_at).toBeTruthy();
    expect(server.thumbs.has(other)).toBe(true);
    expect(await a.mediaDb.get('files', other)).toMatchObject({ pending: 0, thumb: 'done', error: null });
    // El trabado no quedó detenido ni marcado como hecho: se reintenta solo, con su espera.
    const record = (await a.mediaDb.get('files', stuck))!;
    expect(record).toMatchObject({ pending: 1, blocked: false, registered: true, thumb: 'local', failures: 1, driveId: null });
    expect(record.error).toMatch(/stopped moving/);
    expect(record.retryAt).toBeGreaterThan(Date.now() + server.clockOffset);
    expect(server.mediaFiles.get(stuck)).toMatchObject({ thumb_at: null });
    expect(server.mediaFiles.get(stuck)?.drive_id).toBeFalsy();
    expect(server.thumbs.has(stuck)).toBe(false);
    // No se perdió nada: el original y la miniatura siguen en el dispositivo.
    expect((await a.mediaDb.get('blobs', stuck))?.size).toBe(MB);
    expect((await a.mediaDb.get('thumbs', stuck))?.size).toBe(thumb.size);
    await until(() => a.engine.getStatus().pendingMedia === 1);
    expect(a.engine.getStatus().failedMedia).toBe(0);

    // Antes de su espera no se vuelve a pedir; después, con Storage contestando, sube todo.
    storage.upload = () => Promise.resolve();
    await a.engine.syncMedia();
    expect(storage.calls.filter((c) => c === `POST ${stuck}`)).toHaveLength(1);
    server.clockOffset += LATER;
    await a.engine.syncMedia();
    expect(server.thumbs.get(stuck)?.size).toBe(thumb.size);
    expect(server.mediaFiles.get(stuck)?.thumb_at).toBeTruthy();
    expect(server.mediaFiles.get(stuck)?.drive_id).toBeTruthy();
    expect(await a.mediaDb.get('files', stuck)).toMatchObject({ pending: 0, thumb: 'done', error: null, failures: 0 });
  });

  it('si la miniatura cortada termina de subir sola, el reintento la encuentra y sigue, sin subirla dos veces', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    const id = mediaIdOf(await a.media.add(page, makeFile(MB, 'IMG_0201.JPG', 'image/jpeg')))!;
    await a.media.idle();
    await a.engine.syncNow();
    const thumb = (await a.mediaDb.get('thumbs', id))!;
    const storage = realThumbs(a, server);
    // Storage tarda más que el tope en contestar, pero la miniatura llega.
    let arrive = () => undefined as void;
    storage.upload = () => new Promise<void>((resolve) => (arrive = resolve));

    await hungRound(a, () => storage.calls.length === 1, timeoutFor(thumb.size));
    expect(await a.mediaDb.get('files', id)).toMatchObject({ pending: 1, thumb: 'local', failures: 1 });
    expect(server.mediaFiles.get(id)).toMatchObject({ thumb_at: null });
    // El pedido que quedó suelto termina: la miniatura está en el bucket, pero la base todavía no lo sabe.
    arrive();
    await until(() => server.thumbs.has(id));
    const first = server.thumbs.get(id);
    expect(server.mediaFiles.get(id)).toMatchObject({ thumb_at: null });

    storage.upload = () => Promise.resolve();
    server.clockOffset += LATER;
    await a.engine.syncMedia();
    // Storage dijo que ya estaba (no se reemplaza): se da por hecho, se marca en la base y sube el original.
    expect(storage.calls).toEqual([`POST ${id}`, `POST ${id}`]);
    expect(server.thumbs.get(id)).toBe(first);
    expect(server.mediaFiles.get(id)?.thumb_at).toBeTruthy();
    expect(server.mediaFiles.get(id)?.drive_id).toBeTruthy();
    expect(server.portero.drive.size).toBe(1);
    expect(await a.mediaDb.get('files', id)).toMatchObject({ pending: 0, thumb: 'done', error: null });
  });

  it('una miniatura lenta pero sana no se corta: el tope crece con su tamaño', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    const id = mediaIdOf(await a.media.add(page, makeFile(MB, 'IMG_0202.JPG', 'image/jpeg')))!;
    await a.media.idle();
    await a.engine.syncNow();
    // Una miniatura pesada (320 KB) en una red lenta: tarda 45 s, más que los 30 s de una consulta a la base.
    const heavy = new Blob([new Uint8Array(320 * 1024)], { type: 'image/jpeg' });
    await a.mediaDb.put('thumbs', heavy, id);
    expect(timeoutFor(heavy.size)).toBe(50_000);
    const storage = realThumbs(a, server);
    storage.upload = () => new Promise<void>((resolve) => setTimeout(resolve, 45_000));

    const { done, finished } = round(a);
    await until(() => storage.calls.length === 1);
    await vi.advanceTimersByTimeAsync(44_000);
    await pause(30);
    expect(finished()).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    await done;

    expect(server.thumbs.get(id)?.size).toBe(heavy.size);
    expect(server.mediaFiles.get(id)?.thumb_at).toBeTruthy();
    expect(server.mediaFiles.get(id)?.drive_id).toBeTruthy();
    expect(await a.mediaDb.get('files', id)).toMatchObject({ pending: 0, thumb: 'done', error: null, failures: 0 });
  });

  /** `b` mostró con un ícono dos fotos de `a` que todavía no tenían miniatura; después las miniaturas llegan. */
  async function waitingForThumbs(): Promise<{ server: FakeServer; b: Device; ids: string[]; page: string }> {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    // `a` registra y sube los archivos, pero todavía no las miniaturas.
    server.rejectThumbs = true;
    const ids = [
      mediaIdOf(await a.media.add(page, makeFile(MB, 'IMG_0203.JPG', 'image/jpeg')))!,
      mediaIdOf(await a.media.add(page, makeFile(MB, 'IMG_0204.JPG', 'image/jpeg')))!,
    ];
    await sync(a);
    const b = await device(server);
    await sync(b);
    for (const id of ids) expect(await b.media.resolve(MEDIA_SCHEME + id)).toMatch(/^data:image\/svg\+xml/);
    for (const id of ids) {
      server.thumbs.set(id, new Blob([new Uint8Array([0xff, 0xd8, 9])], { type: 'image/jpeg' }));
      server.mediaFiles.get(id)!.thumb_at = new Date().toISOString();
    }
    server.clockOffset += 61_000;
    return { server, b, ids, page };
  }

  it('si Storage no contesta al bajar una miniatura, la vuelta termina al vencer el tope y se reintenta más tarde', async () => {
    const { server, b, ids, page } = await waitingForThumbs();
    const ready: string[] = [];
    b.media.subscribeThumbs((x) => ready.push(x));
    const storage = realThumbs(b, server);
    storage.download = never;

    await hungRound(b, () => storage.calls.length === 1, THUMB_DOWNLOAD_TIMEOUT_MS);

    // Se cortó el pedido de verdad y no se siguió con la otra: cada una hubiera esperado su tope entero.
    expect(storage.calls).toHaveLength(1);
    expect(storage.aborted).toEqual([storage.calls[0].slice('GET '.length)]);
    expect(ready).toEqual([]);
    for (const id of ids) expect(await b.mediaDb.get('thumbs', id)).toBeUndefined();
    const missing = (b.media as unknown as { missing: Set<string> }).missing;
    expect([...missing].sort()).toEqual([...ids].sort());

    // La cola no quedó trabada: un archivo nuevo sube en la vuelta siguiente (todavía no toca volver a
    // preguntar por las miniaturas).
    const added = mediaIdOf(await b.media.add(page, makeFile(MB, 'IMG_0205.JPG', 'image/jpeg')))!;
    await b.media.idle();
    await sync(b);
    expect(server.mediaFiles.get(added)?.drive_id).toBeTruthy();
    expect(storage.calls.filter((c) => c.startsWith('GET'))).toHaveLength(1);

    // Más tarde, con Storage contestando, llegan las dos.
    storage.download = () => Promise.resolve();
    server.clockOffset += 61_000;
    await sync(b);
    expect(ready.filter((x) => ids.includes(x)).sort()).toEqual([...ids].sort());
    expect(missing.size).toBe(0);
    for (const id of ids) expect(await b.media.resolve(MEDIA_SCHEME + id)).toMatch(/^blob:/);
  });

  it('con Storage colgado, la bajada se vuelve a pedir al minuto de cortarse, no en la vuelta siguiente', async () => {
    const { server, b } = await waitingForThumbs();
    const storage = realThumbs(b, server);
    storage.download = never;
    /** Una vuelta que no tiene nada que esperar: termina enseguida. */
    const quickRound = async () => {
      const { done, finished } = round(b);
      await Promise.race([done, pause(300)]);
      return finished();
    };

    // Mientras espera, para la cola también pasa el tiempo: 62 s, más que el minuto que deja pasar entre una
    // pregunta y la siguiente.
    expect(THUMB_DOWNLOAD_TIMEOUT_MS).toBeGreaterThan(60_000);
    await hungRound(b, () => storage.calls.length === 1, THUMB_DOWNLOAD_TIMEOUT_MS, server);
    // La vuelta siguiente no vuelve a pedir: esperaría otro tope entero, y así todas.
    expect(await quickRound()).toBe(true);
    expect(storage.calls).toHaveLength(1);
    server.clockOffset += 59_000;
    expect(await quickRound()).toBe(true);
    expect(storage.calls).toHaveLength(1);

    // Pasado el minuto desde el corte, sí.
    server.clockOffset += 2000;
    await hungRound(b, () => storage.calls.length === 2, THUMB_DOWNLOAD_TIMEOUT_MS, server);
    expect(storage.calls).toHaveLength(2);
  });

  it('una miniatura que no baja no frena lo que no necesita bajada: el adjunto de atrás se actualiza igual', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    // `b` mostró con un ícono una foto de `a` que todavía no tenía miniatura...
    server.rejectThumbs = true;
    const photo = mediaIdOf(await a.media.add(page, makeFile(MB, 'IMG_0206.JPG', 'image/jpeg')))!;
    await sync(a);
    const b = await device(server);
    await sync(b);
    expect(await b.media.resolve(MEDIA_SCHEME + photo)).toMatch(/^data:image\/svg\+xml/);
    // ...y después un adjunto que todavía no estaba en la base ("todavía no").
    server.online = false;
    const url = await a.media.add(page, makeFile(10, 'guion.txt', 'text/plain'));
    const attachment = mediaIdOf(url)!;
    server.online = true;
    expect(cardText(await b.media.resolve(url))).toContain(t('queue.notYet'));
    const missing = (b.media as unknown as { missing: Set<string> }).missing;
    expect([...missing]).toEqual([photo, attachment]);
    // Llegan los dos: el adjunto a la base y la miniatura de la foto al bucket.
    await sync(a);
    server.thumbs.set(photo, new Blob([new Uint8Array([0xff, 0xd8, 9])], { type: 'image/jpeg' }));
    server.mediaFiles.get(photo)!.thumb_at = new Date().toISOString();
    server.clockOffset += 61_000;
    const heard: string[] = [];
    b.media.subscribeThumbs((x) => heard.push(x));
    const storage = realThumbs(b, server);
    storage.download = never;

    await hungRound(b, () => storage.calls.length === 1, THUMB_DOWNLOAD_TIMEOUT_MS);

    // La foto sigue esperando su miniatura; el adjunto, que sale de la fila, ya tiene su tarjeta.
    expect(storage.calls).toEqual([`GET ${photo}`]);
    expect(heard).toEqual([attachment]);
    expect([...missing]).toEqual([photo]);
    expect(await b.mediaDb.get('known', attachment)).toMatchObject({ mime: 'text/plain', name: 'guion.txt' });
    const card = cardText(await b.media.resolve(url));
    expect(card).toContain('guion.txt');
    expect(card).not.toContain(t('queue.notYet'));
  });

  it('una miniatura que tarda en bajar pero llega no se corta', async () => {
    const { server, b, ids } = await waitingForThumbs();
    const storage = realThumbs(b, server);
    // Cada una tarda 55 s: más que una consulta a la base, menos que el tope de una miniatura.
    storage.download = () => new Promise<void>((resolve) => setTimeout(resolve, 55_000));

    const { done, finished } = round(b);
    for (const n of [1, 2]) {
      await until(() => storage.calls.length === n);
      await vi.advanceTimersByTimeAsync(54_000);
      await pause(30);
      expect(finished()).toBe(false);
      await vi.advanceTimersByTimeAsync(2000);
    }
    await done;

    expect(storage.aborted).toEqual([]);
    for (const id of ids) expect((await b.mediaDb.get('thumbs', id))?.size).toBe(3);
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

describe('fotos HEIC: se guardan en el acto y pasan a JPEG después (Docs/Doc_Imagenes.md, "Fotos HEIC")', () => {
  const heicBytes = () => Uint8Array.from(atob(HEIC_SAMPLE), (c) => c.charCodeAt(0));
  /** Un HEIC de verdad (la firma es lo que cuenta), con el nombre y el tipo que dé el navegador. */
  const heicFile = (name = 'IMG_0001.HEIC', type = '') => new File([heicBytes()], name, { type });
  const svgText = (url: string) => decodeURIComponent(url.slice(url.indexOf(',') + 1));
  const bytes = async (blob: Blob | undefined) => new Uint8Array(await blob!.arrayBuffer());
  /** Una promesa que se resuelve desde afuera. */
  function gate<T = void>() {
    let open!: (value: T) => void;
    const done = new Promise<T>((resolve) => (open = resolve));
    return { done, open };
  }
  const unavailable = async (): Promise<Blob> => {
    throw new HeicError('unavailable', 'sin el decodificador');
  };

  it('el HEIC queda guardado tal cual en el acto; enseguida pasa a JPEG, la página lo muestra y se sube el JPEG', async () => {
    const server = new FakeServer();
    const calls: number[] = [];
    const converter = gate();
    const real = server.convertHeic;
    server.convertHeic = async (file) => {
      calls.push(file.size);
      await converter.done;
      return real(file);
    };
    const { a, page } = await withPage(server);
    const refreshed: string[] = [];
    a.media.subscribeThumbs((x) => refreshed.push(x));
    // Sin tipo (Chrome en Windows suele no darlo): lo reconoce la firma.
    const original = heicFile();
    const url = await a.media.add(page, original);
    const id = mediaIdOf(url)!;
    // `add` termina con el HEIC ya a salvo en el dispositivo, sin esperar la conversión.
    expect(await a.mediaDb.get('files', id)).toMatchObject({ name: 'IMG_0001.HEIC', mime: 'image/heic', heic: 'pending', size: original.size });
    expect(await same(original, await bytes(await a.mediaDb.get('blobs', id)))).toBe(true);
    expect(svgText(await a.media.resolve(url))).toContain(heicNotice('converting'));

    converter.open();
    await a.media.idle();
    expect(calls).toEqual([original.size]);
    const record = await a.mediaDb.get('files', id);
    expect(record).toMatchObject({ name: 'IMG_0001.jpg', mime: 'image/jpeg', thumb: 'local', width: 4032 });
    expect(record?.heic).toBeUndefined();
    const stored = await bytes(await a.mediaDb.get('blobs', id));
    expect([...stored.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(record?.size).toBe(stored.length);
    // La página se entera y muestra la foto, sin recargar.
    expect(refreshed).toContain(id);
    expect(await a.media.resolve(url)).toMatch(/^blob:/);
    expect(a.media.fileInfo(id)).toMatchObject({ name: 'IMG_0001.jpg', mime: 'image/jpeg' });

    await sync(a);
    const row = server.mediaFiles.get(id)!;
    expect(row).toMatchObject({ name: 'IMG_0001.jpg', mime: 'image/jpeg', size: stored.length });
    expect(row.thumb_at).toBeTruthy();
    expect(server.portero.drive.get(row.drive_id!)!.data).toEqual(stored);
    // Con el tipo que dice HEIC, igual.
    const typed = mediaIdOf(await a.media.add(page, heicFile('foto.heif', 'image/heif')))!;
    await a.media.idle();
    expect(await a.mediaDb.get('files', typed)).toMatchObject({ name: 'foto.jpg', mime: 'image/jpeg' });
  });

  it('un JPEG, un PNG, un video o una secuencia HEIF no pasan por el conversor ni cambian', async () => {
    const server = new FakeServer();
    let calls = 0;
    server.convertHeic = async () => {
      calls++;
      throw new Error('no se debería llamar');
    };
    const { a, page } = await withPage(server);
    const jpeg = mediaIdOf(await a.media.add(page, makeFile(MB, 'IMG_0007.JPG', 'image/jpeg')))!;
    const png = mediaIdOf(await a.media.add(page, makeFile(1000, 'captura.png', 'image/png')))!;
    const mov = mediaIdOf(await a.media.add(page, makeFile(MB, 'IMG_0008.MOV', 'video/quicktime')))!;
    // Una secuencia (varias imágenes): un JPEG de la primera perdería el resto. Se guarda tal cual.
    const sequence = heicBytes();
    sequence.set([...'msf1'].map((c) => c.charCodeAt(0)), 8);
    const seq = mediaIdOf(await a.media.add(page, new File([sequence], 'rafaga.heics', { type: 'image/heif-sequence' })))!;
    await a.media.idle();
    expect(calls).toBe(0);
    expect(await a.mediaDb.get('files', jpeg)).toMatchObject({ name: 'IMG_0007.JPG', mime: 'image/jpeg', size: MB });
    expect(await a.mediaDb.get('files', png)).toMatchObject({ name: 'captura.png', mime: 'image/png', size: 1000 });
    expect(await a.mediaDb.get('files', mov)).toMatchObject({ name: 'IMG_0008.MOV', mime: 'video/quicktime' });
    const seqRecord = await a.mediaDb.get('files', seq);
    expect(seqRecord).toMatchObject({ name: 'rafaga.heics', mime: 'image/heif-sequence' });
    expect(seqRecord?.heic).toBeUndefined();
  });

  it('si la foto no se puede convertir, queda el HEIC tal cual con su aviso y se sube igual, sin perder nada', async () => {
    const server = new FakeServer();
    server.convertHeic = async () => {
      throw new HeicError('failed', 'archivo roto');
    };
    const { a, page } = await withPage(server);
    const original = heicFile();
    const url = await a.media.add(page, original);
    const id = mediaIdOf(url)!;
    await a.media.idle();
    expect(await a.mediaDb.get('files', id)).toMatchObject({ name: 'IMG_0001.HEIC', mime: 'image/heic', heic: 'failed', size: original.size, probed: true });
    expect(await same(original, await bytes(await a.mediaDb.get('blobs', id)))).toBe(true);
    const shown = await a.media.resolve(url);
    expect(shown).toMatch(/^data:image\/svg\+xml/);
    expect(svgText(shown)).toContain(heicNotice('failed'));
    expect(svgText(shown)).toContain('IMG_0001.HEIC');

    await sync(a);
    const row = server.mediaFiles.get(id)!;
    expect(row).toMatchObject({ name: 'IMG_0001.HEIC', mime: 'image/heic', thumb_at: null });
    expect(await same(original, server.portero.drive.get(row.drive_id!)!.data)).toBe(true);
    // Cualquier otro error del conversor (falta de memoria, por ejemplo) es lo mismo.
    server.convertHeic = async () => {
      throw new RangeError('Out of memory');
    };
    const other = mediaIdOf(await a.media.add(page, heicFile('b.heic')))!;
    await a.media.idle();
    expect(await a.mediaDb.get('files', other)).toMatchObject({ heic: 'failed', mime: 'image/heic' });
  });

  it('un conversor que no contesta nunca no deja la cola esperando: pasado el tope queda el HEIC y se sube', async () => {
    const server = new FakeServer();
    server.heicTimeoutMs = 40;
    server.convertHeic = () => new Promise<Blob>(() => undefined);
    const { a, page } = await withPage(server);
    const original = heicFile();
    const id = mediaIdOf(await a.media.add(page, original))!;
    await sync(a);
    expect(await a.mediaDb.get('files', id)).toMatchObject({ heic: 'failed', pending: 0, mime: 'image/heic' });
    expect(await same(original, server.portero.drive.get(server.mediaFiles.get(id)!.drive_id!)!.data)).toBe(true);
  });

  it('sin red y sin el decodificador: queda el HEIC con su aviso y, cuando vuelve la red, se convierte antes de subirlo', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    server.online = false;
    let available = false;
    const real = server.convertHeic;
    server.convertHeic = async (file) => (available ? real(file) : unavailable());
    const url = await a.media.add(page, heicFile());
    const id = mediaIdOf(url)!;
    await a.media.idle();
    expect(await a.mediaDb.get('files', id)).toMatchObject({ name: 'IMG_0001.HEIC', mime: 'image/heic', heic: 'pending' });
    expect(svgText(await a.media.resolve(url))).toContain(heicNotice('waiting'));
    // Sin red no se registra nada; el HEIC sigue esperando (anotado como mandado a registrar).
    await sync(a);
    expect(server.mediaFiles.size).toBe(0);
    expect(await a.mediaDb.get('files', id)).toMatchObject({ heic: 'sent', registered: false });
    expect(svgText(await a.media.resolve(url))).toContain(heicNotice('waiting'));

    // Vuelve la red (y con ella el decodificador): se pregunta a la base, se convierte y se sube el JPEG.
    const refreshed: string[] = [];
    a.media.subscribeThumbs((x) => refreshed.push(x));
    server.online = true;
    available = true;
    await sync(a);
    const record = await a.mediaDb.get('files', id);
    expect(record).toMatchObject({ name: 'IMG_0001.jpg', mime: 'image/jpeg', thumb: 'done', pending: 0 });
    expect(record?.heic).toBeUndefined();
    const stored = await bytes(await a.mediaDb.get('blobs', id));
    const row = server.mediaFiles.get(id)!;
    expect(row).toMatchObject({ name: 'IMG_0001.jpg', mime: 'image/jpeg', size: stored.length });
    expect(server.portero.drive.get(row.drive_id!)!.data).toEqual(stored);
    expect(refreshed).toContain(id);
    expect(await a.media.resolve(url)).toMatch(/^blob:/);
  });

  it('sin red pero con el decodificador ya guardado: se convierte en el acto, sin esperar la red', async () => {
    const server = new FakeServer();
    const { a, page } = await withPage(server);
    server.online = false;
    const id = mediaIdOf(await a.media.add(page, heicFile()))!;
    await a.media.idle();
    expect(await a.mediaDb.get('files', id)).toMatchObject({ name: 'IMG_0001.jpg', mime: 'image/jpeg', thumb: 'local' });
  });

  it('si con red el decodificador sigue sin cargar, sube el HEIC tal cual (subir manda) y deja de esperar', async () => {
    const server = new FakeServer();
    server.convertHeic = unavailable;
    const { a, page } = await withPage(server);
    const original = heicFile();
    const url = await a.media.add(page, original);
    const id = mediaIdOf(url)!;
    await sync(a);
    expect(await a.mediaDb.get('files', id)).toMatchObject({ heic: 'failed', registered: true, pending: 0, mime: 'image/heic' });
    const row = server.mediaFiles.get(id)!;
    expect(await same(original, server.portero.drive.get(row.drive_id!)!.data)).toBe(true);
    expect(svgText(await a.media.resolve(url))).toContain(heicNotice('failed'));
  });

  it('si se perdió la respuesta de register_file, no se convierte: la base ya tiene el HEIC y se sube ese (nada queda detenido)', async () => {
    const server = new FakeServer();
    // El decodificador no está hasta que se pierde la respuesta; desde ahí, sí.
    server.loseMediaResponse.add('register_file');
    const real = server.convertHeic;
    let conversions = 0;
    server.convertHeic = async (file) => {
      if (server.loseMediaResponse.has('register_file')) return unavailable();
      conversions++;
      return real(file);
    };
    const { a, page } = await withPage(server);
    const original = heicFile();
    const id = mediaIdOf(await a.media.add(page, original))!;
    await a.media.idle();
    // Se registra como HEIC (el decodificador no estaba), la respuesta no llega y, en el reintento, el
    // decodificador ya está: igual no se convierte (el portero compararía el peso con la fila del HEIC).
    await sync(a);
    server.clockOffset += 60 * 60_000;
    await sync(a);
    expect(server.loseMediaResponse.has('register_file')).toBe(false);
    expect(conversions).toBe(0);
    const record = await a.mediaDb.get('files', id);
    expect(record).toMatchObject({ heic: 'failed', mime: 'image/heic', registered: true, pending: 0, blocked: false, error: null });
    expect(await same(original, await bytes(await a.mediaDb.get('blobs', id)))).toBe(true);
    const row = server.mediaFiles.get(id)!;
    expect(row).toMatchObject({ mime: 'image/heic', size: original.size });
    expect(await same(original, server.portero.drive.get(row.drive_id!)!.data)).toBe(true);
  });

  it('una fila registrada mientras se convertía (otra pestaña) no se toca: queda el HEIC', async () => {
    const server = new FakeServer();
    const converter = gate();
    const real = server.convertHeic;
    server.convertHeic = async (file) => {
      await converter.done;
      return real(file);
    };
    const { a, page } = await withPage(server);
    const original = heicFile();
    const url = await a.media.add(page, original);
    const id = mediaIdOf(url)!;
    // Mientras convierte, otra pestaña (de una versión anterior) lo registra como HEIC.
    const current = (await a.mediaDb.get('files', id))!;
    await a.mediaDb.put('files', { ...current, registered: true });
    converter.open();
    await a.media.idle();
    expect(await a.mediaDb.get('files', id)).toMatchObject({ mime: 'image/heic', name: 'IMG_0001.HEIC', registered: true });
    expect(await same(original, await bytes(await a.mediaDb.get('blobs', id)))).toBe(true);
    // El aviso no promete una conversión que ya no va a pasar.
    expect(svgText(await a.media.resolve(url))).toContain(heicNotice('failed'));
    await a.media.ensureConverted(id);
    expect(await a.mediaDb.get('files', id)).toMatchObject({ heic: 'failed' });
  });

  it('una medición del HEIC en curso no pisa las medidas ni la miniatura del JPEG', async () => {
    const server = new FakeServer();
    const probing = gate();
    server.probe = async (file, mime) => {
      if (mime === 'image/heic') await probing.done;
      return fakeProbe(file, mime);
    };
    let available = false;
    const real = server.convertHeic;
    server.convertHeic = async (file) => (available ? real(file) : unavailable());
    const { a, page } = await withPage(server);
    const id = mediaIdOf(await a.media.add(page, heicFile()))!;
    await a.media.idle();
    // Algo empieza a medir el HEIC (lento) y, mientras tanto, la conversión termina.
    const probe = a.media.ensureProbed(id);
    available = true;
    const converted = a.media.ensureConverted(id);
    await new Promise((r) => setTimeout(r, 20));
    probing.open();
    await Promise.all([probe, converted]);
    await a.media.idle();
    expect(await a.mediaDb.get('files', id)).toMatchObject({ mime: 'image/jpeg', width: 4032, height: 3024, thumb: 'local', probed: true });
    expect((await a.mediaDb.get('thumbs', id))?.type).toBe('image/jpeg');
  });

  it('un HEIC subido sin convertir (otro dispositivo, una versión anterior) dice por qué no se ve', async () => {
    const server = new FakeServer();
    server.convertHeic = async () => {
      throw new HeicError('failed', 'roto');
    };
    const { a, page } = await withPage(server);
    const id = mediaIdOf(await a.media.add(page, heicFile()))!;
    await sync(a);
    const b = await device(server);
    await sync(b);
    const shown = await b.media.resolve(MEDIA_SCHEME + id);
    expect(svgText(shown)).toContain(heicNotice('none'));
    expect(svgText(shown)).toContain('IMG_0001.HEIC');
  });
});
