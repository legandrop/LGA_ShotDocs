import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { RemoteError } from '../sync/types';
import { MediaQueue as PublishedMediaQueue } from './fixtures/v247/queue';
import { foreignPlaceholder, MEDIA_SCHEME, mediaIdOf } from './queue';
import { linkOnOpen, mediaIdsInDoc } from './usage';

// D601: abrir una página en un dispositivo nuevo antes de que el motor la compare con el servidor. El editor anota cada
// foto que vino del servidor como «sin confirmar» (no se cuenta ni se manda) y la comparación la confirma, la manda o
// la quita. Antes se ponían todas por mandar: «Uploading 52 changes…» sin haber escrito nada, y 52 `link_page_file`
// que no cambiaban nada. Con el servidor en memoria (src/sync/testing.ts), como trash.test.ts.

const MB = 1024 * 1024;
const devices: Device[] = [];

async function device(server: FakeServer): Promise<Device> {
  const d = await makeDevice(server, undefined, '0.021');
  devices.push(d);
  return d;
}

afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
});

function photo(name = 'IMG_0001.JPG'): File {
  return new File([new Uint8Array(MB).fill(7)], name, { type: 'image/jpeg' });
}

async function sync(d: Device): Promise<void> {
  await d.engine.syncNow();
  await d.engine.syncMedia();
  await d.engine.syncNow();
  await d.engine.syncMedia();
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

const calls = (server: FakeServer, name: string) => server.mediaCalls.filter((c) => c.startsWith(name));

/** Un proyecto con dos páginas: «Día 1» con una foto y «Día 2» con dos, hechas y subidas en el dispositivo `a`. */
async function project(server: FakeServer) {
  server.enableTrash();
  const a = await device(server);
  await sync(a);
  const page = await a.tree.create(null, 'Día 1');
  const other = await a.tree.create(null, 'Día 2');
  await sync(a);
  const id = mediaIdOf(await a.media.add(page, photo()))!;
  const ids = [mediaIdOf(await a.media.add(other, photo('IMG_0002.JPG')))!, mediaIdOf(await a.media.add(other, photo('IMG_0003.JPG')))!];
  await edit(a, page, (doc) => insertImage(doc, id));
  await edit(a, other, (doc) => ids.forEach((x) => insertImage(doc, x)));
  await sync(a);
  expect(server.pageFiles.size).toBe(3);
  return { a, page, id, other, ids };
}

/**
 * La primera bajada de un dispositivo nuevo, hasta antes de que el motor compare las páginas con sus archivos (el rato
 * en el que la persona ya puede abrir una página).
 */
async function firstPull(d: Device): Promise<void> {
  const engine = d.engine as unknown as { reconcileMedia: () => Promise<void> };
  engine.reconcileMedia = async () => undefined;
  try {
    await d.engine.syncNow();
  } finally {
    delete (engine as { reconcileMedia?: unknown }).reconcileMedia;
  }
}

/** Abre la página como el editor: anota sus fotos (`linkOnOpen`) y devuelve el documento abierto. */
async function open(d: Device, pageId: string): Promise<Y.Doc> {
  const doc = await d.docs.open(pageId);
  await linkOnOpen(d, pageId, [...mediaIdsInDoc(doc)]);
  return doc;
}

async function close(d: Device, pageId: string): Promise<void> {
  d.docs.close(pageId);
  await d.docs.flush();
}

const link = (d: Device, pageId: string, fileId: string) => d.mediaDb.get('links', `${pageId}:${fileId}`);

describe('abrir una página que este dispositivo todavía no comparó (D601)', () => {
  it('no cuenta ni manda las fotos que vinieron del servidor; la comparación las confirma', async () => {
    const server = new FakeServer();
    const { other, ids } = await project(server);
    const sent = calls(server, 'link_page_file').length;
    const b = await device(server);
    await firstPull(b);
    await open(b, other);
    // Lo que la pastilla suma de la cola de archivos: nada.
    expect((await b.media.status()).pending).toBe(0);
    for (const f of ids) expect(await link(b, other, f)).toMatchObject({ pending: 0, unconfirmed: true, removed: false });
    await b.engine.syncNow();
    expect(b.engine.getStatus()).toMatchObject({ pendingMedia: 0, pendingPages: 0, pendingOps: 0 });
    await sync(b);
    await close(b, other);
    expect(calls(server, 'link_page_file')).toHaveLength(sent);
    for (const f of ids) expect(await link(b, other, f)).toMatchObject({ pending: 0, unconfirmed: false, removed: false });
    expect(b.engine.getStatus().pendingMedia).toBe(0);
  });

  it('borrar una foto antes de la primera comparación manda unlink_page_file y el archivo entra a la papelera', async () => {
    const server = new FakeServer();
    const { page, id } = await project(server);
    const b = await device(server);
    await firstPull(b);
    const doc = await open(b, page);
    removeImage(doc, id);
    await close(b, page);
    await sync(b);
    await sync(b);
    expect(calls(server, 'unlink_page_file')).toEqual([`unlink_page_file ${page} ${id}`]);
    expect(server.pageFiles.has(`${page}:${id}`)).toBe(false);
    expect(server.mediaFiles.get(id)?.trashed_at).toBeTruthy();
    expect(await link(b, page, id)).toMatchObject({ removed: true, pending: 0 });
  });

  it('lo mismo sin red: al volver, sale el unlink', async () => {
    const server = new FakeServer();
    const { page, id } = await project(server);
    const b = await device(server);
    await firstPull(b);
    server.online = false;
    const doc = await open(b, page);
    removeImage(doc, id);
    await close(b, page);
    await sync(b);
    expect(calls(server, 'unlink_page_file')).toEqual([]);
    server.online = true;
    await sync(b);
    await sync(b);
    expect(calls(server, 'unlink_page_file')).toEqual([`unlink_page_file ${page} ${id}`]);
    expect(server.mediaFiles.get(id)?.trashed_at).toBeTruthy();
  });

  it('lo escrito sin red durante la primera bajada sí cuenta, y sale un solo link_page_file', async () => {
    const server = new FakeServer();
    const { page, id, ids } = await project(server);
    const sent = calls(server, 'link_page_file').length;
    const b = await device(server);
    await firstPull(b);
    server.online = false;
    // Abre «Día 1» y pega una foto de «Día 2» (el editor la anota con su `onChange`, como siempre).
    const doc = await open(b, page);
    insertImage(doc, ids[0]);
    await b.media.ensureLinks(page, [ids[0]]);
    await close(b, page);
    await b.engine.syncNow();
    expect(b.engine.getStatus().pendingPages).toBe(1);
    expect(b.engine.getStatus().pendingMedia).toBe(1);
    expect(await link(b, page, id)).toMatchObject({ pending: 0, unconfirmed: true });
    server.online = true;
    await sync(b);
    await sync(b);
    expect(calls(server, 'link_page_file').slice(sent)).toEqual([`link_page_file ${page} ${ids[0]}`]);
    expect(server.pageFiles.has(`${page}:${ids[0]}`)).toBe(true);
    expect(b.engine.getStatus()).toMatchObject({ pendingMedia: 0, pendingPages: 0 });
  });

  it('volver a abrir la página después de pegar una foto deja una pendiente, no todas', async () => {
    const server = new FakeServer();
    const { id, other, ids } = await project(server);
    const b = await device(server);
    await firstPull(b);
    const doc = await open(b, other);
    insertImage(doc, id);
    await b.media.ensureLinks(other, [id]);
    await close(b, other);
    // Se cierra y se abre de nuevo (también como después de recargar la app: la cola no recuerda lo visto).
    (b.media as unknown as { seenLinks: Set<string> }).seenLinks.clear();
    await open(b, other);
    await close(b, other);
    expect((await b.media.status()).pending).toBe(1);
    for (const f of ids) expect(await link(b, other, f)).toMatchObject({ pending: 0, unconfirmed: true });
  });

  it('si no se pueden leer los usos del servidor, la comparación las cuenta y las manda todas', async () => {
    const server = new FakeServer();
    const { other, ids } = await project(server);
    const sent = calls(server, 'link_page_file').length;
    const b = await device(server);
    await firstPull(b);
    await open(b, other);
    await close(b, other);
    expect((await b.media.status()).pending).toBe(0);
    b.remote.fetchPageUses = async () => {
      throw new RemoteError('Internal Server Error', false, '500');
    };
    await b.engine.syncNow();
    expect(b.engine.getStatus().pendingMedia).toBeGreaterThanOrEqual(ids.length);
    await sync(b);
    for (const f of ids) expect(calls(server, 'link_page_file').slice(sent)).toContain(`link_page_file ${other} ${f}`);
    expect(b.engine.getStatus().pendingMedia).toBe(0);
  });

  it('una página creada acá o con algo propio sin subir se anota como siempre: por mandar', async () => {
    const server = new FakeServer();
    const { page, id, other, ids } = await project(server);
    const b = await device(server);
    await sync(b);
    server.online = false;
    // Creada en este dispositivo, todavía no en el servidor, con la foto de otra página.
    const copy = await b.tree.create(null, 'Copia');
    await edit(b, copy, (doc) => insertImage(doc, id));
    expect(b.tree.hasUnsentCreate(copy)).toBe(true);
    await open(b, copy);
    await close(b, copy);
    expect(await link(b, copy, id)).toMatchObject({ pending: 1 });
    expect((await link(b, copy, id))?.unconfirmed).toBeFalsy();
    // Una página del servidor con una edición propia sin subir (la foto llegó sin pasar por el editor).
    await (b.mediaDb as unknown as { clear: (s: string) => Promise<void> }).clear('links');
    (b.media as unknown as { seenLinks: Set<string> }).seenLinks.clear();
    await edit(b, page, (doc) => insertImage(doc, ids[1]));
    expect(await b.docs.hasOwnUnsent(page)).toBe(true);
    await open(b, page);
    await close(b, page);
    expect(await link(b, page, ids[1])).toMatchObject({ pending: 1 });
    expect(await link(b, page, id)).toMatchObject({ pending: 1 });
    // Y una sin nada propio: sin confirmar.
    expect(await b.docs.hasOwnUnsent(other)).toBe(false);
    await open(b, other);
    await close(b, other);
    expect(await link(b, other, ids[0])).toMatchObject({ pending: 0, unconfirmed: true });
  });

  it('abrir una página recién bajada con un archivo de otro proyecto no avisa ni muestra el marcador antes de tiempo', async () => {
    const server = new FakeServer();
    const { a, id } = await project(server);
    const otherProject = await a.tree.createProject('Otro rodaje');
    const foreign = await a.tree.create(null, 'Día 1 (otro)', otherProject);
    await sync(a);
    await edit(a, foreign, (doc) => insertImage(doc, id));
    await sync(a);
    expect(server.foreignPageFiles.has(`${foreign}:${id}`)).toBe(true);
    const notices = server.foreignNotices.length;
    const sent = calls(server, 'link_page_file').length;
    const b = await device(server);
    await firstPull(b);
    await open(b, foreign);
    await close(b, foreign);
    expect(server.foreignNotices).toHaveLength(notices);
    const row = await link(b, foreign, id);
    expect(row).toMatchObject({ pending: 0, unconfirmed: true });
    expect(row?.foreign).toBeFalsy();
    await sync(b);
    expect(calls(server, 'link_page_file')).toHaveLength(sent);
    expect(server.foreignNotices).toHaveLength(notices);
    expect(await link(b, foreign, id)).toMatchObject({ pending: 0, unconfirmed: false, foreign: true });
    expect(decodeURIComponent(await b.media.resolve(MEDIA_SCHEME + id, foreign))).toContain(foreignPlaceholder());
  });

  it('una fila sin confirmar marcada como ajena no muestra el marcador de otro proyecto', async () => {
    const server = new FakeServer();
    const { page, id } = await project(server);
    const b = await device(server);
    await sync(b);
    const row = (await link(b, page, id))!;
    await b.mediaDb.put('links', { ...row, foreign: true, unconfirmed: true });
    expect(decodeURIComponent(await b.media.resolve(MEDIA_SCHEME + id, page))).not.toContain(foreignPlaceholder());
    await b.mediaDb.put('links', { ...row, foreign: true, unconfirmed: false });
    expect(decodeURIComponent(await b.media.resolve(MEDIA_SCHEME + id, page))).toContain(foreignPlaceholder());
  });

  it('una página ya comparada a la que le llegó una foto de otro dispositivo: se pregunta y no se manda', async () => {
    const server = new FakeServer();
    const { a, page, ids } = await project(server);
    const b = await device(server);
    await sync(b);
    // `a` agrega a «Día 1» una foto de «Día 2» (y su uso); `b` baja el documento y abre la página antes de compararla.
    await edit(a, page, (doc) => insertImage(doc, ids[0]));
    await a.media.ensureLinks(page, [ids[0]]);
    await sync(a);
    const sent = calls(server, 'link_page_file').length;
    await firstPull(b);
    await open(b, page);
    await close(b, page);
    expect(await link(b, page, ids[0])).toMatchObject({ pending: 0, unconfirmed: true });
    await sync(b);
    expect(calls(server, 'link_page_file')).toHaveLength(sent);
    expect(await link(b, page, ids[0])).toMatchObject({ pending: 0, unconfirmed: false });
  });
});

describe('las filas sin confirmar con la versión anterior (v0.247) en la misma base', () => {
  it('la versión anterior no las cuenta ni las manda, y la nueva las resuelve después', async () => {
    const server = new FakeServer();
    const { page, id, other, ids } = await project(server);
    const sent = calls(server, 'link_page_file').length;
    const b = await device(server);
    await firstPull(b);
    await open(b, other);
    await close(b, other);
    await open(b, page);
    await close(b, page);
    // La misma base, abierta por la versión publicada antes de D601.
    const old = new PublishedMediaQueue(b.mediaDb, b.remote, {
      // El mismo portero en memoria que usa la versión nueva del dispositivo.
      portero: (b.media as unknown as { options: { portero: ConstructorParameters<typeof PublishedMediaQueue>[2]['portero'] } }).options.portero,
      onForeignFile: (name) => server.foreignNotices.push(name),
      offline: () => !server.online,
    });
    await old.load();
    expect((await old.status()).pending).toBe(0);
    await old.ensureLinks(other, ids);
    expect((await old.status()).pending).toBe(0);
    // Su comparación no las toca mientras el documento las tiene; si la persona quita una (y lo subió), manda el unlink.
    expect(await old.reconcilePage(other, new Set(ids), { unlink: true })).toBe(false);
    expect(await old.hasUnsentUse(ids[0])).toBe(false);
    await edit(b, page, (doc) => removeImage(doc, id));
    // Se sube la edición sin que la versión nueva compare la página.
    await firstPull(b);
    expect(await old.reconcilePage(page, new Set(), { unlink: true })).toBe(true);
    await old.run();
    expect(calls(server, 'link_page_file')).toHaveLength(sent);
    expect(calls(server, 'unlink_page_file')).toEqual([`unlink_page_file ${page} ${id}`]);
    // La versión nueva vuelve: lo que quedaba sin confirmar se confirma sin mandar nada.
    await sync(b);
    expect(calls(server, 'link_page_file')).toHaveLength(sent);
    for (const f of ids) expect(await link(b, other, f)).toMatchObject({ pending: 0, unconfirmed: false });
  });
});
