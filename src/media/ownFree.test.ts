import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { FileRejected } from '../sync/files';
import { md5Blob } from './md5';
import { DEFAULT_OPTIONS, getRev, partKey, putMark } from './offlineStore';
import { ensureMd5, freeOwn, ownBlock, OWN_MIN_AGE_MS } from './ownFree';
import { MEDIA_SCHEME, mediaIdOf } from './queue';

// Liberar los originales agregados en este dispositivo (Docs/Doc_Copias_Locales.md, entrega 2): solo con el sí de la
// persona, con red, un portero que comprueba (`/verify`), la base y Drive diciendo el mismo archivo (MD5 incluido) y
// 14 días desde la subida. Con el servidor y el portero en memoria (src/sync/testing.ts).

const MB = 1024 * 1024;
const DAY = 24 * 60 * 60_000;
const devices: Device[] = [];

afterEach(() => {
  for (const d of devices.splice(0)) {
    d.offline.stop();
    d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
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
  await d.engine.syncMedia();
}

function bytes(size: number, seed = 1): Uint8Array<ArrayBuffer> {
  return Uint8Array.from({ length: size }, (_, i) => (i * 31 + seed * 7 + (i >> 9)) % 256);
}

const file = (size: number, name: string, type: string, seed = 1) => new File([bytes(size, seed)], name, { type });

function insert(doc: Y.Doc, fileId: string): void {
  const fragment = doc.getXmlFragment(CONTENT_FRAGMENT);
  doc.transact(() => {
    if (fragment.length === 0) fragment.insert(0, [new Y.XmlElement('blockGroup')]);
    const group = fragment.get(0) as Y.XmlElement;
    const container = new Y.XmlElement('blockContainer');
    container.setAttribute('id', crypto.randomUUID());
    const image = new Y.XmlElement('image');
    image.setAttribute('url', MEDIA_SCHEME + fileId);
    container.insert(0, [image]);
    group.insert(group.length, [container]);
  });
}

async function edit(d: Device, pageId: string, change: (doc: Y.Doc) => void): Promise<void> {
  const doc = await d.docs.open(pageId);
  change(doc);
  d.docs.close(pageId);
  await d.docs.flush();
}

/** Un dispositivo que agregó una foto y un video a una página, ya subidos; `days` después. */
async function setup(days = 15) {
  const server = new FakeServer();
  server.enableTrash();
  const a = await device(server);
  await sync(a);
  const page = await a.tree.create(null, 'Escena 12');
  await sync(a);
  const photo = mediaIdOf(await a.media.add(page, file(2 * MB, 'IMG_0001.JPG', 'image/jpeg', 1)))!;
  const video = mediaIdOf(await a.media.add(page, file(MB, 'IMG_0002.MOV', 'video/quicktime', 2)))!;
  await edit(a, page, (doc) => {
    insert(doc, photo);
    insert(doc, video);
  });
  await sync(a);
  expect(server.mediaFiles.get(photo)?.drive_id).toBeTruthy();
  expect(server.mediaFiles.get(video)?.drive_id).toBeTruthy();
  server.clockOffset += days * DAY;
  await a.offline.refresh();
  return { server, a, page, photo, video };
}

const hasOriginal = async (d: Device, id: string) => !!(await d.mediaDb.getKey('blobs', id));

describe('liberar originales propios (entrega 2)', () => {
  it('con el sí, libera el original confirmado en Drive y deja el registro, la miniatura y la página igual', async () => {
    const { server, a, photo, video } = await setup();
    const usage = a.offline.getSnapshot().usage!;
    expect(usage.own.count).toBe(2);
    expect(usage.own.freeable).toBe(3 * MB);
    const thumbBefore = await a.mediaDb.get('thumbs', photo);
    const freed = await a.offline.freeUp('all');
    expect(freed).toBe(3 * MB);
    expect(a.offline.getSnapshot().report).toMatchObject({ freed: 3 * MB, own: 2, skipped: {} });
    for (const id of [photo, video]) {
      expect(await hasOriginal(a, id)).toBe(false);
      const record = await a.mediaDb.get('files', id);
      expect(record).toMatchObject({ pending: 0, driveId: server.mediaFiles.get(id)!.drive_id });
      expect(record?.freedAt).toBeGreaterThan(0);
      expect(record?.md5).toBe(await md5Blob(new Blob([server.portero.drive.get(record!.driveId!)!.data as BlobPart])));
    }
    expect(await a.mediaDb.get('thumbs', photo)).toEqual(thumbBefore);
    // Lo liberado ya no cuenta, y no queda nada para ofrecer.
    await a.offline.refresh();
    expect(a.offline.getSnapshot().usage!.own).toMatchObject({ freeable: 0, count: 0 });
    expect(a.offline.getSnapshot().usage!.kept).toBe(0);
    // Abrir: sin original en el dispositivo (el aviso sin conexión lo dice), con red por el portero.
    const source = await a.media.source(photo);
    expect(source).toMatchObject({ original: null, freed: true, kind: 'image' });
    expect(await a.media.pass(photo)).toMatch(/\/m\//);
    // Nada quedó pendiente ni detenido.
    expect(a.engine.getStatus().pendingMedia).toBe(0);
    expect(await a.media.failures()).toHaveLength(0);
  });

  it('nunca sin el sí: pasado el tope, el aviso ofrece los originales y no se borra nada hasta Free up', async () => {
    const { a, photo, video } = await setup();
    await a.offline.setLimit(1 * MB);
    const prompt = a.offline.getSnapshot().prompt;
    expect(prompt).toMatchObject({ reason: 'limit' });
    expect(prompt!.free).toBeGreaterThan(0);
    expect(await hasOriginal(a, photo)).toBe(true);
    expect(await hasOriginal(a, video)).toBe(true);
    // Solo hasta el 90 % del tope: del que hace más que no se abre (el video se abrió ayer; la foto, nunca).
    a.offline.used(photo, 'show');
    await new Promise((r) => setTimeout(r, 20));
    await a.offline.freeUp('over');
    expect(await hasOriginal(a, video)).toBe(false);
  });

  it('subido hace menos de 14 días no se ofrece ni se libera', async () => {
    const { a, photo } = await setup(13);
    const usage = a.offline.getSnapshot().usage!;
    expect(usage.own).toMatchObject({ freeable: 0, count: 0, recentCount: 2, recent: 3 * MB });
    expect(await a.offline.freeUp('all')).toBe(0);
    expect(await hasOriginal(a, photo)).toBe(true);
  });

  it('sin `uploadedAt` (subido antes de esta versión) cuenta desde el estreno del tope', async () => {
    const { server, a, photo } = await setup(0);
    const record = (await a.mediaDb.get('files', photo))!;
    delete record.uploadedAt;
    await a.mediaDb.put('files', record);
    server.clockOffset += 15 * DAY;
    await a.offline.freeUp('all');
    expect(await hasOriginal(a, photo)).toBe(false);
  });

  it('sin red no se libera ningún original propio (y se dice por qué)', async () => {
    const { server, a, photo } = await setup();
    server.online = false;
    await a.offline.refresh();
    expect(a.offline.getSnapshot().usage!.own).toMatchObject({ freeable: 0, held: 'offline', heldBytes: 3 * MB });
    expect(await a.offline.freeUp('all')).toBe(0);
    expect(a.offline.getSnapshot().report!.skipped).toEqual({ offline: 2 });
    expect(await hasOriginal(a, photo)).toBe(true);
  });

  it('un portero sin `verify` no libera originales (el diálogo dice que necesita una actualización)', async () => {
    const { server, a, photo } = await setup();
    server.portero.features = ['known', 'offline', 'codes'];
    const fresh = await device(server, a.mediaDb.name.replace(/:media$/, ''));
    // El mismo dispositivo con una sesión nueva (las features se preguntan una vez por sesión).
    a.offline.stop();
    await fresh.offline.refresh();
    expect(fresh.offline.getSnapshot().usage!.own.held).toBe('server');
    expect(await fresh.offline.freeUp('all')).toBe(0);
    expect(fresh.offline.getSnapshot().report!.skipped).toEqual({ server: 2 });
    expect(await hasOriginal(fresh, photo)).toBe(true);
    expect(server.portero.calls.some((c) => c.path === '/verify')).toBe(false);
  });

  it('lo que espera subir, lo detenido o con una subida a medias nunca se libera', async () => {
    const { server, a, page, photo } = await setup();
    // Agregado sin red: espera subir.
    server.online = false;
    const waiting = mediaIdOf(await a.media.add(page, file(MB, 'IMG_0009.JPG', 'image/jpeg', 9)))!;
    server.online = true;
    server.clockOffset += 30 * DAY;
    // Detenido y con una subida a medias, aunque digan estar subidos (registros raros): tampoco.
    const p = (await a.mediaDb.get('files', photo))!;
    await a.mediaDb.put('files', { ...p, blocked: true });
    await a.offline.freeUp('all');
    expect(await hasOriginal(a, waiting)).toBe(true);
    expect(await hasOriginal(a, photo)).toBe(true);
    await a.mediaDb.put('files', { ...p, blocked: false, uploadId: 'up-9' });
    await a.offline.freeUp('all');
    expect(await hasOriginal(a, photo)).toBe(true);
    await a.mediaDb.put('files', { ...p, heic: 'sent' });
    await a.offline.freeUp('all');
    expect(await hasOriginal(a, photo)).toBe(true);
  });

  it('lo que pide una marca con su casilla (opción A) no se libera; con la casilla destildada, sí', async () => {
    const { a, page, photo, video } = await setup();
    await a.offline.mark('page', page, { ...DEFAULT_OPTIONS, originals: true });
    await a.offline.idle();
    await a.offline.freeUp('all');
    expect(await hasOriginal(a, photo)).toBe(true);
    // El video no lo pide (Videos destildada): se libera.
    expect(await hasOriginal(a, video)).toBe(false);
  });

  it('lo abierto en esta sesión no se libera', async () => {
    const { a, photo, video } = await setup();
    await a.media.source(video);
    await a.offline.freeUp('all');
    expect(await hasOriginal(a, video)).toBe(true);
    expect(await hasOriginal(a, photo)).toBe(false);
  });

  it('la base dice otro archivo de Drive, o en una papelera: no se libera', async () => {
    const { server, a, photo, video } = await setup();
    server.mediaFiles.get(photo)!.drive_id = 'drive-otro';
    server.mediaFiles.get(video)!.trashed_at = new Date().toISOString();
    await a.offline.freeUp('all');
    expect(await hasOriginal(a, photo)).toBe(true);
    expect(await hasOriginal(a, video)).toBe(true);
    expect(a.offline.getSnapshot().report!.skipped).toEqual({ mismatch: 1, trash: 1 });
  });

  it('Drive dice otro MD5, otro peso, sin la marca, en su papelera, sin MD5 o que no lo tiene: no se libera', async () => {
    const cases: [string, (s: FakeServer, driveId: string, id: string) => void, string][] = [
      ['otro MD5', (s, d) => (s.portero.drive.get(d)!.data = bytes(s.portero.drive.get(d)!.data.length, 99)), 'mismatch'],
      ['otro peso', (s, d) => (s.portero.drive.get(d)!.data = bytes(5, 1)), 'mismatch'],
      ['sin la marca', (s, d) => (s.portero.drive.get(d)!.file = ''), 'mismatch'],
      ['en la papelera de Drive', (s, d) => s.portero.driveTrash.add(d), 'trash'],
      ['sin MD5', (s) => (s.portero.noMd5 = true), 'mismatch'],
      ['no lo tiene', (s, d) => s.portero.drive.delete(d), 'notInDrive'],
      ['sin permiso', (s, _d, id) => s.portero.hidden.add(id), 'noAnswer'],
    ];
    for (const [name, change, reason] of cases) {
      const { server, a, photo } = await setup();
      const driveId = server.mediaFiles.get(photo)!.drive_id!;
      change(server, driveId, photo);
      // Solo la foto: el video se abre en la sesión (no se ofrece).
      const { video } = { video: [...server.mediaFiles.keys()].find((k) => k !== photo)! };
      await a.media.source(video);
      await a.offline.freeUp('all');
      expect(await hasOriginal(a, photo), name).toBe(true);
      expect(a.offline.getSnapshot().report!.skipped, name).toEqual({ [reason]: 1 });
    }
  });

  it('`/verify` sin respuesta (se corta la red en el medio): no se libera nada', async () => {
    const { server, a, photo } = await setup();
    server.portero.failVerify = true;
    await a.offline.freeUp('all');
    expect(await hasOriginal(a, photo)).toBe(true);
    expect(a.offline.getSnapshot().report!.skipped).toEqual({ noAnswer: 2 });
  });
});

describe('freeOwn: la comprobación adentro de la transacción que borra', () => {
  async function ready() {
    const { server, a, photo, video } = await setup();
    const md5 = (await ensureMd5(a.mediaDb, photo))!;
    // Leído después del MD5: lo guarda en el registro, y cada caso vuelve a este estado.
    const record = (await a.mediaDb.get('files', photo))!;
    expect(record.md5).toBe(md5);
    const guard = { rev: await getRev(a.mediaDb), driveId: record.driveId!, size: record.size, md5, now: Date.now() + server.clockOffset, rollout: null };
    return { server, a, photo, video, record, guard };
  }

  it('con todo igual, borra el original y solo esa clave', async () => {
    const { a, photo, guard } = await ready();
    // Una copia bajada del mismo archivo (otra clave) no se toca.
    await a.mediaDb.put('blobs', new Blob(['copia']), partKey(photo, 0));
    expect(await freeOwn(a.mediaDb, photo, guard)).toBe(2 * MB);
    expect(await hasOriginal(a, photo)).toBe(false);
    expect(await a.mediaDb.get('blobs', partKey(photo, 0))).toBeTruthy();
  });

  it('cualquier cosa que cambió entre la comprobación y el borrado, no borra', async () => {
    const { a, photo, record, guard } = await ready();
    const tries: [string, () => Promise<unknown>, Partial<typeof guard>][] = [
      ['marksRev cambió', () => putMark(a.mediaDb, { id: 'm', kind: 'page', target: 'x', projectId: '', title: '', options: DEFAULT_OPTIONS, createdAt: 0, pages: {}, files: {}, state: 'ready', error: null, readyAt: null }), {}],
      ['otro id de Drive', async () => undefined, { driveId: 'drive-otro' }],
      ['otro peso', async () => undefined, { size: record.size + 1 }],
      ['otro MD5', async () => undefined, { md5: '0'.repeat(32) }],
      ['la restauración lo volvió a la cola', () => a.mediaDb.put('files', { ...record, pending: 1, driveId: null }), {}],
      ['en Drive pero la base todavía no confirmó', () => a.mediaDb.put('files', { ...record, pending: 1 }), {}],
      ['ya liberado', () => a.mediaDb.put('files', { ...record, freedAt: 1 }), {}],
      ['otro MD5 guardado en el registro', () => a.mediaDb.put('files', { ...record, md5: 'f'.repeat(32) }), {}],
      ['14 días todavía no', () => a.mediaDb.put('files', { ...record, uploadedAt: guard.now - OWN_MIN_AGE_MS + 1000 }), {}],
      ['sin uploadedAt ni estreno', () => a.mediaDb.put('files', { ...record, uploadedAt: undefined }), {}],
    ];
    for (const [name, change, over] of tries) {
      // El `marksRev` de cada caso se lee antes del cambio (el primero lo sube; los demás no lo tocan).
      const rev = await getRev(a.mediaDb);
      await change();
      expect(await freeOwn(a.mediaDb, photo, { ...guard, rev, ...over }), name).toBe(0);
      expect(await hasOriginal(a, photo), name).toBe(true);
      await a.mediaDb.put('files', record);
    }
    // Y con todo igual, recién ahí borra.
    expect(await freeOwn(a.mediaDb, photo, { ...guard, rev: await getRev(a.mediaDb) })).toBe(2 * MB);
  });

  it('una marca que lo pide (leída en la transacción) no deja borrar', async () => {
    const { a, photo, guard } = await ready();
    const rev = await putMark(a.mediaDb, {
      id: 'm1',
      kind: 'page',
      target: 'x',
      projectId: '',
      title: '',
      options: { ...DEFAULT_OPTIONS, originals: true },
      createdAt: 0,
      pages: {},
      files: { [photo]: { pages: ['x'], kind: 'image', size: 2 * MB } },
      state: 'ready',
      error: null,
      readyAt: null,
    });
    expect(await freeOwn(a.mediaDb, photo, { ...guard, rev })).toBe(0);
    expect(await hasOriginal(a, photo)).toBe(true);
  });
});

describe('ownBlock: lo que mira el dispositivo', () => {
  const base = {
    id: 'f1', pageId: 'p', projectId: null, name: 'a.jpg', mime: 'image/jpeg', size: 10, width: null, height: null, duration: null,
    day: '2026-10-01', createdAt: 0, pending: 0 as const, registered: true, thumb: 'done' as const, uploadId: null, sent: 10,
    driveId: 'drive-1', error: null, blocked: false, failures: 0, retryAt: 0, uploadedAt: 0,
  };
  const now = OWN_MIN_AGE_MS + 1;
  it('cada condición, por separado', () => {
    expect(ownBlock(base, true, [], now, null)).toBeNull();
    expect(ownBlock(base, false, [], now, null)).toBe('missing');
    expect(ownBlock({ ...base, pending: 1 }, true, [], now, null)).toBe('waiting');
    expect(ownBlock({ ...base, driveId: null }, true, [], now, null)).toBe('waiting');
    expect(ownBlock({ ...base, uploadId: 'u' }, true, [], now, null)).toBe('waiting');
    expect(ownBlock({ ...base, heic: 'pending' }, true, [], now, null)).toBe('waiting');
    expect(ownBlock({ ...base, heic: 'sent' }, true, [], now, null)).toBe('waiting');
    expect(ownBlock({ ...base, heic: 'failed' }, true, [], now, null)).toBeNull();
    expect(ownBlock({ ...base, blocked: true }, true, [], now, null)).toBe('blocked');
    expect(ownBlock({ ...base, freedAt: 5 }, true, [], now, null)).toBe('freed');
    expect(ownBlock(base, true, [], now - 2, null)).toBe('recent');
    // Sin fecha de subida: la del estreno; sin ninguna de las dos, nunca.
    expect(ownBlock({ ...base, uploadedAt: undefined }, true, [], now, 0)).toBeNull();
    expect(ownBlock({ ...base, uploadedAt: undefined }, true, [], now, null)).toBe('recent');
  });
});

describe('hacer lugar para un archivo nuevo', () => {
  it('nunca libera un original propio sin preguntar; lo ofrece después y con el sí lo libera', async () => {
    const { server, a, page, photo, video } = await setup();
    // El dispositivo no tiene lugar para nada nuevo (cualquier original nuevo da `QuotaExceededError`).
    const real = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (this.name === 'blobs' && typeof key === 'string' && !key.startsWith('off:')) throw new DOMException('full', 'QuotaExceededError');
      return real.call(this, value, key);
    });
    await expect(a.media.add(page, file(MB, 'IMG_0100.JPG', 'image/jpeg', 7))).rejects.toBeInstanceOf(FileRejected);
    vi.restoreAllMocks();
    // En el acto no se liberó ningún original propio, ni se le preguntó a Drive.
    expect(await hasOriginal(a, photo)).toBe(true);
    expect(await hasOriginal(a, video)).toBe(true);
    expect(server.portero.calls.some((c) => c.path === '/verify')).toBe(false);
    // Queda para guardarla, y el aviso ofrece los originales ya en Drive.
    expect(a.offline.getSnapshot().unsaved).toEqual([{ name: 'IMG_0100.JPG', size: MB }]);
    await a.offline.refresh();
    expect(a.offline.getSnapshot().prompt).toMatchObject({ reason: 'room', free: 3 * MB });
    await a.offline.freeUp('room');
    expect(await hasOriginal(a, photo)).toBe(false);
    expect(await hasOriginal(a, video)).toBe(false);
    expect(server.portero.calls.some((c) => c.path === '/verify')).toBe(true);
    // Ya no se ofrece.
    await a.offline.refresh();
    expect(a.offline.getSnapshot().prompt).toBeNull();
  });
});

describe('volver a la cola después de liberar (una restauración de la base)', () => {
  it('se vuelve a enlazar sin mandar bytes: el portero lo encuentra por su marca', async () => {
    const { server, a, photo } = await setup();
    const restore = server.backup();
    await a.offline.freeUp('all');
    expect(await hasOriginal(a, photo)).toBe(false);
    // La copia de seguridad es de cuando el archivo ya estaba registrado pero sin `drive_id`.
    restore();
    server.mediaFiles.get(photo)!.drive_id = null;
    const puts = server.portero.calls.filter((c) => c.method === 'PUT').length;
    await sync(a);
    await sync(a);
    expect(server.mediaFiles.get(photo)?.drive_id).toBeTruthy();
    expect(await a.mediaDb.get('files', photo)).toMatchObject({ pending: 0, blocked: false });
    expect((await a.mediaDb.get('files', photo))?.freedAt).toBeGreaterThan(0);
    expect(server.portero.calls.filter((c) => c.method === 'PUT').length).toBe(puts);
    expect(server.portero.calls.some((c) => c.path === '/upload' && c.body?.only === 'known')).toBe(true);
  });

  it('si el portero no lo encuentra, se detiene con el aviso y no abre ninguna subida', async () => {
    const { server, a, photo } = await setup();
    const restore = server.backup();
    await a.offline.freeUp('all');
    restore();
    server.mediaFiles.get(photo)!.drive_id = null;
    server.portero.forgetMarks = true;
    const uploads = server.portero.uploads.size;
    await sync(a);
    expect(await a.mediaDb.get('files', photo)).toMatchObject({ pending: 1, blocked: true });
    expect((await a.media.failures()).find((f) => f.id === photo)?.error).toMatch(/was freed/);
    expect(server.portero.uploads.size).toBe(uploads);
  });

  it('con un portero sin `known` no se pide /upload', async () => {
    const { server, a, photo } = await setup();
    const restore = server.backup();
    await a.offline.freeUp('all');
    restore();
    server.mediaFiles.get(photo)!.drive_id = null;
    server.portero.features = ['verify', 'offline', 'codes'];
    const fresh = await device(server, a.mediaDb.name.replace(/:media$/, ''));
    a.offline.stop();
    a.engine.stop();
    const calls = server.portero.calls.length;
    await sync(fresh);
    expect(server.portero.calls.slice(calls).some((c) => c.path === '/upload')).toBe(false);
    expect(await fresh.mediaDb.get('files', photo)).toMatchObject({ blocked: true });
  });

  it('con una copia bajada entera del mismo archivo, se sube esa', async () => {
    const { server, a, page, photo } = await setup();
    const restore = server.backup();
    await a.offline.freeUp('all');
    // Volver a tenerlo: marcar la página con *Original photos* baja una copia (`off:`).
    await a.offline.mark('page', page, { ...DEFAULT_OPTIONS, originals: true });
    await a.offline.idle();
    expect(await a.media.localOriginal(photo)).toBeTruthy();
    restore();
    server.mediaFiles.get(photo)!.drive_id = null;
    server.portero.forgetMarks = true;
    for (const [driveId, d] of server.portero.drive) if (d.file === photo) server.portero.drive.delete(driveId);
    await sync(a);
    await sync(a);
    expect(server.mediaFiles.get(photo)?.drive_id).toBeTruthy();
    expect(await a.mediaDb.get('files', photo)).toMatchObject({ pending: 0, blocked: false });
  });
});
