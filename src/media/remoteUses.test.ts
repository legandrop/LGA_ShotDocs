import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { RemoteError } from '../sync/types';
import { MEDIA_SCHEME, mediaIdOf } from './queue';

// D790: una página que este dispositivo ya había comparado y a la que le llegan fotos de otro dispositivo. Antes cada
// foto quedaba «por mandar»: traer los planos de VLLF a sus escenas desde la PC mostraba en la Mac «Uploading 688
// changes…» y salían 688 `link_page_file` que no cambiaban nada (la base ya tenía cada uso). Ahora la comparación le
// pregunta al servidor por esas páginas y solo manda lo que falta. Con el servidor en memoria, como openBaseline.test.ts.

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

function photo(name: string): File {
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
const link = (d: Device, pageId: string, fileId: string) => d.mediaDb.get('links', `${pageId}:${fileId}`);

/**
 * Una escena con una foto, hecha en `a` y ya comparada en `b`; después `a` le agrega tres fotos (como traer los planos
 * de una escena) y las sube. `b` todavía no bajó nada de eso.
 */
async function scene(server: FakeServer) {
  server.enableTrash();
  const a = await device(server);
  await sync(a);
  const page = await a.tree.create(null, 'Escena 59');
  await sync(a);
  const first = mediaIdOf(await a.media.add(page, photo('IMG_0001.JPG')))!;
  await edit(a, page, (doc) => insertImage(doc, first));
  await sync(a);
  const b = await device(server);
  await sync(b);
  await sync(b);
  expect(await link(b, page, first)).toMatchObject({ pending: 0, removed: false });
  const added: string[] = [];
  for (const name of ['IMG_0002.JPG', 'IMG_0003.JPG', 'IMG_0004.JPG']) added.push(mediaIdOf(await a.media.add(page, photo(name)))!);
  await edit(a, page, (doc) => added.forEach((id) => insertImage(doc, id)));
  await sync(a);
  expect(server.pageFiles.size).toBe(4);
  return { a, b, page, added };
}

describe('fotos que llegan de otro dispositivo a una página ya comparada (D790)', () => {
  it('no se cuentan ni se mandan: el servidor ya las tiene', async () => {
    const server = new FakeServer();
    const { b, page, added } = await scene(server);
    const sent = calls(server, 'link_page_file').length;
    await b.engine.syncNow();
    // Lo que la pastilla suma de la cola de archivos, recién comparado y antes de que la cola mande nada.
    expect(b.engine.getStatus()).toMatchObject({ pendingMedia: 0, pendingPages: 0, pendingOps: 0 });
    for (const id of added) expect(await link(b, page, id)).toMatchObject({ pending: 0, removed: false });
    await sync(b);
    expect(calls(server, 'link_page_file')).toHaveLength(sent);
    expect(b.engine.getStatus().pendingMedia).toBe(0);
  });

  it('lo que el servidor no tiene se manda, y solo eso', async () => {
    const server = new FakeServer();
    const { b, page, added } = await scene(server);
    // El uso de una de las tres no está en la base (por ejemplo, el otro dispositivo todavía no lo mandó).
    server.pageFiles.delete(`${page}:${added[1]}`);
    const sent = calls(server, 'link_page_file').length;
    await b.engine.syncNow();
    expect(b.engine.getStatus().pendingMedia).toBe(1);
    await sync(b);
    expect(calls(server, 'link_page_file').slice(sent)).toEqual([`link_page_file ${page} ${added[1]}`]);
    expect(server.pageFiles.has(`${page}:${added[1]}`)).toBe(true);
    expect(b.engine.getStatus().pendingMedia).toBe(0);
  });

  it('si la lectura falla, se mandan todas, como antes', async () => {
    const server = new FakeServer();
    const { b, page, added } = await scene(server);
    b.remote.fetchPageUses = async () => {
      throw new RemoteError('Internal Server Error', false, '500');
    };
    const sent = calls(server, 'link_page_file').length;
    await sync(b);
    expect(calls(server, 'link_page_file').slice(sent).sort()).toEqual(added.map((id) => `link_page_file ${page} ${id}`).sort());
    expect(b.engine.getStatus().pendingMedia).toBe(0);
  });

  it('una página sin fotos nuevas no le pregunta nada al servidor', async () => {
    const server = new FakeServer();
    const { a, b, page } = await scene(server);
    await sync(b);
    const asked = calls(server, 'page_files').length;
    // Solo texto: la página cambia en el servidor, pero no trae archivos que `b` no conozca.
    await edit(a, page, (doc) => doc.getText('otra-cosa').insert(0, 'hola'));
    await sync(a);
    await sync(b);
    expect(calls(server, 'page_files')).toHaveLength(asked);
  });

  it('mirar qué archivos traen las páginas no atrasa la lectura de las que nunca comparó (A1 de trash.test.ts)', async () => {
    const server = new FakeServer();
    const { a, b, page } = await scene(server);
    // Una página nueva con una foto, que `b` nunca comparó, y la escena con una foto más (`b` la abre para mirarla).
    const other = await a.tree.create(null, 'Día 2');
    await sync(a);
    const p = mediaIdOf(await a.media.add(other, photo('IMG_0010.JPG')))!;
    await edit(a, other, (doc) => insertImage(doc, p));
    const q = mediaIdOf(await a.media.add(page, photo('IMG_0011.JPG')))!;
    await edit(a, page, (doc) => insertImage(doc, q));
    await sync(a);
    // Justo cuando `b` abre la escena para ver qué trae, `a` quita la foto de la página nueva.
    const orig = b.docs.snapshot.bind(b.docs);
    let fired = false;
    b.docs.snapshot = (async (pid: string) => {
      if (!fired && pid === page) {
        fired = true;
        await edit(a, other, (doc) => removeImage(doc, p));
        await sync(a);
        expect(server.removedPageFiles.has(`${other}:${p}`)).toBe(true);
      }
      return orig(pid);
    }) as typeof b.docs.snapshot;
    const sent = calls(server, 'link_page_file').length;
    await sync(b);
    await sync(b);
    // `b` no reactiva el uso que `a` quitó.
    expect(fired).toBe(true);
    expect(calls(server, 'link_page_file').slice(sent)).toEqual([]);
    expect(server.pageFiles.has(`${other}:${p}`)).toBe(false);
  });
});
