import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { FileRejected } from '../sync/files';
import { SupabaseRemote } from '../sync/remote';
import { RemoteError } from '../sync/types';
import { MEDIA_SCHEME, mediaIdOf } from './queue';

// La versión mínima del workspace (`workspace_settings.min_app_version`) también frena la cola de archivos
// (Docs/Doc_Sincronizacion.md, "La versión mínima y los archivos"): con una versión menor no se registra, no se sube
// y no se mandan usos de páginas, todo queda en el dispositivo sin marcarse como error, y al actualizar sale todo. El
// servidor en memoria sigue las reglas de supabase/migrations/20261006120000_version_minima_archivos.sql.

const MB = 1024 * 1024;
const devices: Device[] = [];

async function device(server: FakeServer, dbName: string, appVersion: string): Promise<Device> {
  const d = await makeDevice(server, dbName, appVersion);
  devices.push(d);
  return d;
}

async function close(d: Device): Promise<void> {
  d.engine.stop();
  await d.engine.syncMedia();
  await d.docs.flush();
  d.db.close();
  d.mediaDb.close();
  d.commentsDb.close();
  devices.splice(devices.indexOf(d), 1);
}

afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
});

function photo(name: string): File {
  return new File([new Uint8Array(MB).fill(7)], name, { type: 'image/jpeg' });
}

/** El ciclo de siempre y la cola de archivos, tres veces (subir, comparar los usos y mandarlos). */
async function sync(d: Device): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await d.engine.syncNow();
    await d.engine.syncMedia();
  }
}

function insertImage(doc: Y.Doc, fileId: string): void {
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

function removeImage(doc: Y.Doc, fileId: string): void {
  const group = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
  const at = group
    .toArray()
    .findIndex((c) => ((c as Y.XmlElement).get(0) as Y.XmlElement | undefined)?.getAttribute('url') === MEDIA_SCHEME + fileId);
  if (at >= 0) group.delete(at, 1);
}

async function edit(d: Device, pageId: string, change: (doc: Y.Doc) => void): Promise<void> {
  const doc = await d.docs.open(pageId);
  change(doc);
  d.docs.close(pageId);
  await d.docs.flush();
}

/** Lo que la cola escribió en el servidor (registrar, miniatura, usos), sin las lecturas. */
const writes = (server: FakeServer) =>
  server.mediaCalls.filter((c) => /^(register_file|set_file_thumb|link_page_file|unlink_page_file) /.test(c));

describe('versión mínima: la cola de archivos', () => {
  it('una versión menor a la mínima no registra, no sube ni manda usos; al actualizar sale todo', async () => {
    const server = new FakeServer();
    server.enableTrash();
    const dbName = crypto.randomUUID();
    const a = await device(server, dbName, '0.050');
    await sync(a);
    const page = await a.tree.create(null, 'Día 1');
    await sync(a);
    // Una foto subida y usada antes de que suban la mínima.
    const before = mediaIdOf(await a.media.add(page, photo('IMG_0001.JPG')))!;
    await edit(a, page, (doc) => insertImage(doc, before));
    await sync(a);
    expect(server.mediaFiles.get(before)?.drive_id).toBeTruthy();
    expect(server.pageFiles.has(`${page}:${before}`)).toBe(true);

    // El workspace pide la 0.060. Esta pestaña (0.050) agrega una foto y quita la anterior.
    server.settings = { ...server.settings!, minAppVersion: 0.06 };
    const sent = writes(server).length;
    const id = mediaIdOf(await a.media.add(page, photo('IMG_0002.JPG')))!;
    await edit(a, page, (doc) => {
      insertImage(doc, id);
      removeImage(doc, before);
    });
    await sync(a);

    expect(a.engine.getStatus().outdated).toBe(true);
    // Nada salió: ni registrar, ni miniatura, ni usos; tampoco el original al portero.
    expect(writes(server).slice(sent)).toEqual([]);
    expect(server.mediaFiles.has(id)).toBe(false);
    expect(server.pageFiles.has(`${page}:${before}`)).toBe(true);
    expect(server.mediaFiles.get(before)?.trashed_at).toBeNull();
    // Queda en el dispositivo y en la cola, a la vista como pendiente y sin error.
    expect(await a.mediaDb.get('files', id)).toMatchObject({ pending: 1, registered: false, blocked: false, failures: 0, error: null });
    expect(await a.media.status()).toMatchObject({ failed: 0, error: null });
    expect((await a.media.status()).pending).toBeGreaterThanOrEqual(1);
    expect(a.engine.getStatus().pendingMedia).toBeGreaterThanOrEqual(1);
    // Las bajadas de "Available offline" no esperan una subida que no va a llegar.
    expect(await a.media.hasUploadableNow()).toBe(false);
    // Una carpeta se registra en el acto: no se puede, y no queda nada a medias.
    const files = server.mediaFiles.size;
    await expect(a.media.addFolder(page, 'Fotos', 10)).rejects.toBeInstanceOf(FileRejected);
    expect(server.mediaFiles.size).toBe(files);
    // Mandar a la papelera de Drive tampoco.
    await expect(a.media.trash(before)).rejects.toThrow(/newer version/);
    expect(writes(server).slice(sent)).toEqual([]);

    // La misma base local, abierta con la versión nueva: sale todo.
    await close(a);
    const b = await device(server, dbName, '0.060');
    await sync(b);
    expect(b.engine.getStatus().outdated).toBe(false);
    expect(server.mediaFiles.get(id)?.drive_id).toBeTruthy();
    expect(server.pageFiles.has(`${page}:${id}`)).toBe(true);
    expect(server.removedPageFiles.has(`${page}:${before}`)).toBe(true);
    expect(await b.media.status()).toMatchObject({ pending: 0, failed: 0 });
  });

  it('si la base dice app_outdated (subieron la mínima en el medio), el archivo queda como estaba y se ve el aviso', async () => {
    const server = new FakeServer();
    server.enableTrash();
    const dbName = crypto.randomUUID();
    const a = await device(server, dbName, '0.050');
    await sync(a);
    const page = await a.tree.create(null, 'Día 1');
    await sync(a);

    // El motor ya miró la mínima (no había); la suben antes de que la cola mande el archivo.
    server.settings = { ...server.settings!, minAppVersion: 0.06 };
    const id = mediaIdOf(await a.media.add(page, photo('IMG_0003.JPG')))!;
    await a.media.run();
    expect(server.mediaCalls.filter((c) => c.startsWith('register_file'))).toEqual([`register_file ${id}`]);
    expect(server.mediaFiles.has(id)).toBe(false);
    expect(a.media.outdated).toBe(true);
    expect(a.engine.getStatus().outdated).toBe(true);
    expect(await a.mediaDb.get('files', id)).toMatchObject({ pending: 1, registered: false, blocked: false, failures: 0, error: null });
    // Mientras tanto no se vuelve a pedir nada.
    await a.media.run();
    expect(server.mediaCalls.filter((c) => c.startsWith('register_file'))).toHaveLength(1);

    // Con la versión nueva, sale.
    await close(a);
    const b = await device(server, dbName, '0.060');
    await sync(b);
    expect(server.mediaFiles.get(id)?.drive_id).toBeTruthy();
    expect(await b.media.status()).toMatchObject({ pending: 0, failed: 0 });
  });

  it('las imágenes sin portero (sdfile://) tampoco salen con una versión menor', async () => {
    const server = new FakeServer();
    const dbName = crypto.randomUUID();
    const a = await device(server, dbName, '0.050');
    const page = await a.tree.create(null, 'Día 1');
    await a.engine.syncNow();
    server.settings = { ...server.settings!, minAppVersion: 0.06 };
    await a.files.add(page, new File([new Uint8Array(10)], 'a.png', { type: 'image/png' }));
    await a.engine.syncNow();
    expect(a.engine.getStatus().outdated).toBe(true);
    expect(server.files.size).toBe(0);
    expect(a.engine.getStatus().pendingFiles).toBe(1);

    await close(a);
    const b = await device(server, dbName, '0.060');
    await b.engine.syncNow();
    expect(server.files.size).toBe(1);
    expect(b.engine.getStatus().pendingFiles).toBe(0);
  });
});

describe('versión mínima: los pedidos de archivos llevan la versión', () => {
  it('registrar, usar y dejar de usar mandan p_app_version; sin la función nueva en la base, la de siempre', async () => {
    let missing = false;
    const rpc = vi.fn(async (_fn: string, args: Record<string, unknown>) =>
      'p_app_version' in args && missing
        ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function' }, status: 404 }
        : { data: _fn === 'unlink_page_file' ? true : 'ok', error: null, status: 200 },
    );
    const remote = new SupabaseRemote({ rpc } as never, '0.090');
    const file = { id: 'f', pageId: 'p', name: 'a.jpg', mime: 'image/jpeg', size: 1, width: null, height: null, duration: null };
    expect(await remote.registerFile(file)).toBe('ok');
    expect(await remote.linkPageFile('p', 'f')).toBe('ok');
    expect(await remote.unlinkPageFile('p', 'f', 3)).toBe(true);
    expect(rpc.mock.calls.map((c) => [c[0], c[1].p_app_version])).toEqual([
      ['register_file', '0.090'],
      ['link_page_file', '0.090'],
      ['unlink_page_file', '0.090'],
    ]);

    // Una base sin la migración: se prueba una vez, se usa la de siempre y no se vuelve a probar enseguida.
    missing = true;
    const old = new SupabaseRemote({ rpc } as never, '0.090');
    rpc.mockClear();
    expect(await old.registerFile(file)).toBe('ok');
    expect(await old.linkPageFile('p', 'f')).toBe('ok');
    expect(rpc.mock.calls.map((c) => [c[0], 'p_app_version' in c[1]])).toEqual([
      ['register_file', true],
      ['register_file', false],
      ['link_page_file', false],
    ]);
  });

  it('si la de siempre dice app_outdated (la migración llegó en los 10 minutos), repite una vez con versión', async () => {
    let migrated = false;
    const rpc = vi.fn(async (_fn: string, args: Record<string, unknown>) => {
      if ('p_app_version' in args) {
        return migrated
          ? { data: 'ok', error: null, status: 200 }
          : { data: null, error: { code: 'PGRST202', message: 'Could not find the function' }, status: 404 };
      }
      return migrated
        ? { data: null, error: { code: 'P0001', message: 'app_outdated' }, status: 400 }
        : { data: 'ok', error: null, status: 200 };
    });
    const remote = new SupabaseRemote({ rpc } as never, '0.090');
    expect(await remote.linkPageFile('p', 'f')).toBe('ok');
    // Se aplica la migración y la mínima sube a 0.090 antes de los 10 minutos.
    migrated = true;
    rpc.mockClear();
    expect(await remote.linkPageFile('p', 'f')).toBe('ok');
    expect(rpc.mock.calls.map((c) => 'p_app_version' in c[1])).toEqual([false, true]);
    // Y desde ahí, directo con versión.
    rpc.mockClear();
    expect(await remote.linkPageFile('p', 'f')).toBe('ok');
    expect(rpc.mock.calls.map((c) => 'p_app_version' in c[1])).toEqual([true]);
  });

  it('con versión, app_outdated no se repite: esta versión es menor a la mínima', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: 'P0001', message: 'app_outdated' }, status: 400 }));
    const remote = new SupabaseRemote({ rpc } as never, '0.090');
    await expect(remote.registerFile({ id: 'f', pageId: 'p', name: 'a.jpg', mime: 'image/jpeg', size: 1, width: null, height: null, duration: null })).rejects.toThrow('app_outdated');
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('app_outdated de la base llega como tal (la cola lo reconoce)', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: 'P0001', message: 'app_outdated' }, status: 400 }));
    const remote = new SupabaseRemote({ rpc } as never, '0.050');
    const err = await remote.linkPageFile('p', 'f').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RemoteError);
    expect((err as RemoteError).message).toBe('app_outdated');
    expect((err as RemoteError).permanent).toBe(true);
  });
});

describe('versión mínima: el umbral de la migración', () => {
  const MIGRATION = '20261006120000_version_minima_archivos';
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

  it('es la versión de la entrada del changelog que la nombra (si se renumera la tanda, esto falla)', () => {
    // La versión con la que sale: la entrada del changelog que nombra la migración (la app la toma del changelog).
    const changelog = read('../../Docs/Changelog.md');
    const at = changelog.indexOf(MIGRATION);
    expect(at).toBeGreaterThan(0);
    const headers = [...changelog.slice(0, at).matchAll(/^v(\d+\.\d{3}) :$/gm)];
    const version = headers[headers.length - 1]?.[1];
    expect(version).toMatch(/^\d+\.\d{3}$/);

    // El umbral de `private.files_version_allowed`: una sola comparación con la mínima.
    const migration = read(`../../supabase/migrations/${MIGRATION}.sql`);
    const thresholds = [...migration.matchAll(/min_app_version >= (\d+\.\d{3})/g)].map((m) => m[1]);
    expect(thresholds).toEqual([version]);

    // La prueba SQL: la mínima más alta que pone es el umbral, la otra queda abajo, y rechaza la versión de antes.
    const test = read(`../../supabase/tests/version_minima_archivos_permisos.sql`);
    const minimums = [...test.matchAll(/set min_app_version = (\d+\.\d{3});/g)].map((m) => Number(m[1]));
    expect(Math.max(...minimums).toFixed(3)).toBe(version);
    expect(Math.min(...minimums)).toBeLessThan(Number(version));
    const before = (Number(version) - 0.001).toFixed(3);
    expect(test).toContain(`'${before}'`);
    expect(test).toContain(`'${version}') = 'ok'`);
  });
});
