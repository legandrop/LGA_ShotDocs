import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { RemoteError, REQUEST_TIMEOUT } from '../sync/types';
import { MEDIA_SCHEME, mediaIdOf } from './queue';
import { linkOnOpen, mediaIdsInDoc, mediaIdsInUpdate } from './usage';

// Roadmap 29 (v0.255, D691). Una página que B ya comparó (su fila de la foto X está confirmada): B, sin red, vuelve a poner
// X con un ítem nuevo de Yjs (deshacer un borrado, mover el bloque, pegar una copia de la misma página) mientras A, con
// red, quita X y manda el `unlink` (el archivo va a la papelera de archivos). Cuando B vuelve, sube su documento con X y,
// antes de esta versión, no mandaba ningún `link`: su fila seguía confirmada y la comparación no la volvía a mirar. Si
// A no volvía, el archivo quedaba en la papelera con la foto en el documento. Ahora, antes de subir, las filas confirmadas
// de las fotos que trae el envío pasan a sin confirmar y la comparación del mismo ciclo le pregunta al servidor.
// «Sin red» en el arnés = B no sincroniza mientras edita (el servidor en memoria tiene una sola red para todos).

const MB = 1024 * 1024;
const devices: Device[] = [];

async function device(server: FakeServer, dbName?: string): Promise<Device> {
  const d = await makeDevice(server, dbName, '0.021');
  devices.push(d);
  return d;
}

function close(d: Device): void {
  d.engine.stop();
  d.db.close();
  d.mediaDb.close();
  d.commentsDb.close();
}

afterEach(() => {
  for (const d of devices.splice(0)) close(d);
});

const photo = (name: string) => new File([new Uint8Array(MB).fill(7)], name, { type: 'image/jpeg' });

async function sync(d: Device): Promise<void> {
  await d.engine.syncNow();
  await d.engine.syncMedia();
  await d.engine.syncNow();
  await d.engine.syncMedia();
}

function insertImage(doc: Y.Doc, fileId: string, at?: number): void {
  const fragment = doc.getXmlFragment(CONTENT_FRAGMENT);
  doc.transact(() => {
    if (fragment.length === 0) fragment.insert(0, [new Y.XmlElement('blockGroup')]);
    const group = fragment.get(0) as Y.XmlElement;
    const container = new Y.XmlElement('blockContainer');
    container.setAttribute('id', crypto.randomUUID());
    const image = new Y.XmlElement('image');
    image.setAttribute('url', MEDIA_SCHEME + fileId);
    container.insert(0, [image]);
    group.insert(at ?? group.length, [container]);
  });
}

function removeImage(doc: Y.Doc, fileId: string): void {
  const group = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
  const at = group
    .toArray()
    .findIndex((c) => ((c as Y.XmlElement).get(0) as Y.XmlElement | undefined)?.getAttribute('url') === MEDIA_SCHEME + fileId);
  if (at >= 0) group.delete(at, 1);
}

function typeLetter(doc: Y.Doc): void {
  const group = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
  const container = new Y.XmlElement('blockContainer');
  container.setAttribute('id', crypto.randomUUID());
  const p = new Y.XmlElement('paragraph');
  p.insert(0, [new Y.XmlText('a')]);
  container.insert(0, [p]);
  group.insert(0, [container]);
}

async function edit(d: Device, pageId: string, change: (doc: Y.Doc) => void): Promise<void> {
  const doc = await d.docs.open(pageId);
  change(doc);
  d.docs.close(pageId);
  await d.docs.flush();
}

const link = (d: Device, pageId: string, fileId: string) => d.mediaDb.get('links', `${pageId}:${fileId}`);
const active = (server: FakeServer, pageId: string, fileId: string) => server.pageFiles.has(`${pageId}:${fileId}`);
const trashed = (server: FakeServer, fileId: string) => (server.mediaFiles.get(fileId)?.trashed_at ?? null) !== null;

/** Cuenta, desde ahora, las lecturas de usos y los `link`/`unlink` que recibe el servidor. */
function counter(server: FakeServer) {
  const start = server.mediaCalls.length;
  return () => {
    const s = server.mediaCalls.slice(start);
    return {
      reads: s.filter((c) => c.startsWith('page_files')).length,
      links: s.filter((c) => c.startsWith('link_page_file')).length,
      unlinks: s.filter((c) => c.startsWith('unlink_page_file')).length,
    };
  };
}

/** «Día 59» con `n` fotos y «Día 60» con una, hechas y subidas en A; B las bajó, abrió las dos y las comparó. */
async function setup(n = 3, bName?: string) {
  const server = new FakeServer();
  server.enableTrash();
  const a = await device(server);
  await sync(a);
  const page = await a.tree.create(null, 'Día 59');
  const other = await a.tree.create(null, 'Día 60');
  await sync(a);
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(mediaIdOf(await a.media.add(page, photo(`IMG_${i}.JPG`)))!);
  const otherId = mediaIdOf(await a.media.add(other, photo('OTRA.JPG')))!;
  await edit(a, page, (doc) => ids.forEach((x) => insertImage(doc, x)));
  await edit(a, other, (doc) => insertImage(doc, otherId));
  await sync(a);
  const b = await device(server, bName);
  await sync(b);
  for (const p of [page, other]) {
    const doc = await b.docs.open(p);
    await linkOnOpen(b, p, [...mediaIdsInDoc(doc)]);
    b.docs.close(p);
  }
  await sync(b);
  // La fila de B está confirmada: ni por mandar, ni sin confirmar, ni quitada.
  for (const id of ids) {
    const row = await link(b, page, id);
    expect(row?.pending).toBe(0);
    expect(row?.removed).toBeFalsy();
    expect(row?.unconfirmed).toBeFalsy();
  }
  return { server, a, b, page, other, ids, otherId };
}

/** A, con red, quita fotos de la página y la cola manda el `unlink`: los archivos van a la papelera. Después A no vuelve. */
async function aRemoves(server: FakeServer, a: Device, page: string, ...ids: string[]): Promise<void> {
  await edit(a, page, (doc) => ids.forEach((id) => removeImage(doc, id)));
  await sync(a);
  for (const id of ids) {
    expect(active(server, page, id)).toBe(false);
    expect(trashed(server, id)).toBe(true);
  }
}

/** B quita X y lo deshace, sin subir (el `UndoManager` vuelve a escribir el bloque con un ítem nuevo). */
async function removeAndUndo(b: Device, page: string, id: string): Promise<void> {
  const doc = await b.docs.open(page);
  const undo = new Y.UndoManager(doc.getXmlFragment(CONTENT_FRAGMENT));
  removeImage(doc, id);
  undo.stopCapturing();
  undo.undo();
  b.docs.close(page);
  await b.docs.flush();
}

async function inDocOf(d: Device, pageId: string): Promise<Set<string>> {
  const doc = await d.docs.open(pageId);
  const ids = mediaIdsInDoc(doc);
  d.docs.close(pageId);
  return ids;
}

/** La foto está en el documento de B, su uso activo y el archivo fuera de la papelera, y el `link` lo mandó B. */
async function healedByB(server: FakeServer, b: Device, page: string, id: string, n: () => { links: number }): Promise<void> {
  expect((await inDocOf(b, page)).has(id)).toBe(true);
  expect(n().links).toBeGreaterThan(0);
  expect(active(server, page, id)).toBe(true);
  expect(trashed(server, id)).toBe(false);
}

describe('una foto que lo propio vuelve a poner en una página ya comparada (D691)', () => {
  it('deshacer: B quita X y lo deshace sin red; A quita X y manda el unlink; B vuelve y manda el link', async () => {
    const { server, a, b, page, ids } = await setup();
    await removeAndUndo(b, page, ids[0]);
    await aRemoves(server, a, page, ids[0]);
    const n = counter(server);
    await sync(b);
    await healedByB(server, b, page, ids[0], n);
    expect((await link(b, page, ids[0]))?.unconfirmed).toBeFalsy();
  });

  it('mover dentro de la página: B corta X y lo pega más arriba sin red', async () => {
    const { server, a, b, page, ids } = await setup();
    await edit(b, page, (doc) => {
      removeImage(doc, ids[2]);
      insertImage(doc, ids[2], 0);
    });
    await aRemoves(server, a, page, ids[2]);
    const n = counter(server);
    await sync(b);
    await healedByB(server, b, page, ids[2], n);
  });

  it('pegar una copia de la misma página: B duplica X sin red (sin quitar nada) y A quita el original', async () => {
    const { server, a, b, page, ids } = await setup();
    await edit(b, page, (doc) => insertImage(doc, ids[1]));
    await aRemoves(server, a, page, ids[1]);
    const n = counter(server);
    await sync(b);
    await healedByB(server, b, page, ids[1], n);
  });

  it('C1: la app se cierra entre subir y comparar; al reabrirla (la misma base) manda el link', async () => {
    const bName = crypto.randomUUID();
    const { server, a, b, page, ids } = await setup(3, bName);
    await removeAndUndo(b, page, ids[0]);
    await aRemoves(server, a, page, ids[0]);
    // Solo la subida, sin la comparación del ciclo: después se cierra todo.
    expect(await b.docs.pushPage(page, b.remote)).toBe('pushed');
    expect(active(server, page, ids[0])).toBe(false);
    // Anotada antes de subir, solo la foto que trajo el envío: las demás filas de la página siguen confirmadas.
    expect((await link(b, page, ids[0]))?.unconfirmed).toBe(true);
    expect((await link(b, page, ids[1]))?.unconfirmed).toBeFalsy();
    devices.splice(devices.indexOf(b), 1);
    close(b);
    const b2 = await device(server, bName);
    const n = counter(server);
    await sync(b2);
    await healedByB(server, b2, page, ids[0], n);
  });

  it('la subida falla por red después de anotar: al reintentar con red, sale el link', async () => {
    const { server, a, b, page, ids } = await setup();
    await edit(b, page, (doc) => insertImage(doc, ids[1]));
    // Primer intento: la red se corta en el medio (el envío ya quedó armado y anotado).
    const orig = b.remote.pushUpdate.bind(b.remote);
    let fail = true;
    b.remote.pushUpdate = (async (...args: Parameters<typeof orig>) => {
      if (fail) {
        fail = false;
        throw new TypeError('Failed to fetch');
      }
      return orig(...args);
    }) as typeof orig;
    await b.engine.syncNow().catch(() => undefined);
    expect(fail).toBe(false);
    await edit(b, page, (doc) => typeLetter(doc));
    await aRemoves(server, a, page, ids[1]);
    const n = counter(server);
    await sync(b);
    await healedByB(server, b, page, ids[1], n);
  });

  it('un envío armado antes sin anotar (una versión anterior, o anotar falló) se anota al reintentarlo', async () => {
    const { server, a, b, page, ids } = await setup();
    await removeAndUndo(b, page, ids[0]);
    // Primer intento: no se anota y la red se corta; el envío queda armado y guardado.
    const recheck = b.media.recheckUses.bind(b.media);
    b.media.recheckUses = (async () => {
      throw new Error('IndexedDB cerrándose');
    }) as typeof b.media.recheckUses;
    const orig = b.remote.pushUpdate.bind(b.remote);
    let fail = true;
    b.remote.pushUpdate = (async (...args: Parameters<typeof orig>) => {
      if (fail) {
        fail = false;
        throw new TypeError('Failed to fetch');
      }
      return orig(...args);
    }) as typeof orig;
    await b.engine.syncNow().catch(() => undefined);
    expect(fail).toBe(false);
    expect((await link(b, page, ids[0]))?.unconfirmed).toBeFalsy();
    b.media.recheckUses = recheck;
    await aRemoves(server, a, page, ids[0]);
    const n = counter(server);
    await sync(b);
    await healedByB(server, b, page, ids[0], n);
  });

  it('la lectura de usos falla en el ciclo de la subida: se manda el link igual (dirección segura)', async () => {
    const { server, a, b, page, ids } = await setup();
    await removeAndUndo(b, page, ids[0]);
    await aRemoves(server, a, page, ids[0]);
    b.remote.fetchPageUses = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof b.remote.fetchPageUses;
    const n = counter(server);
    await sync(b);
    await healedByB(server, b, page, ids[0], n);
  });

  it('si anotar falla, el texto sube igual y el ciclo sigue (queda como antes de D691)', async () => {
    const { server, b, page, ids } = await setup();
    b.media.recheckUses = (async () => {
      throw new Error('IndexedDB cerrándose');
    }) as typeof b.media.recheckUses;
    await removeAndUndo(b, page, ids[0]);
    await edit(b, page, (doc) => typeLetter(doc));
    await sync(b);
    expect(await b.docs.unsyncedPages()).not.toContain(page);
    const doc = new Y.Doc();
    for (const u of server.updates.get(page) ?? []) Y.applyUpdate(doc, u.data);
    expect(doc.getXmlFragment(CONTENT_FRAGMENT).toString()).toContain('>a<');
    doc.destroy();
    expect(b.engine.getStatus().lastError).toBeNull();
  });

  it('C ve la X de B y la quita a propósito: al final el uso queda quitado (sin usos de más)', async () => {
    const { server, a, b, page, ids } = await setup();
    await edit(b, page, (doc) => insertImage(doc, ids[0]));
    await aRemoves(server, a, page, ids[0]);
    await sync(b);
    await sync(a);
    await edit(a, page, (doc) => {
      removeImage(doc, ids[0]);
      removeImage(doc, ids[0]);
    });
    await sync(a);
    await sync(b);
    expect((await inDocOf(a, page)).has(ids[0])).toBe(false);
    expect((await inDocOf(b, page)).has(ids[0])).toBe(false);
    expect(active(server, page, ids[0])).toBe(false);
    expect(trashed(server, ids[0])).toBe(true);
  });
});

describe('lo que no cambia (guardas)', () => {
  it('mover X a otra página ya comparada sin red: esa página no tenía fila y la comparación la manda', async () => {
    const { server, a, b, page, other, ids } = await setup();
    await edit(b, page, (doc) => removeImage(doc, ids[0]));
    await edit(b, other, (doc) => insertImage(doc, ids[0]));
    await aRemoves(server, a, page, ids[0]);
    await sync(b);
    expect(active(server, other, ids[0])).toBe(true);
    expect(trashed(server, ids[0])).toBe(false);
  });

  it('si A vuelve a sincronizar, A también lo cura (su fila quitada vuelve a usada)', async () => {
    const { server, a, b, page, ids } = await setup();
    await edit(b, page, (doc) => insertImage(doc, ids[0]));
    await aRemoves(server, a, page, ids[0]);
    await b.docs.pushPage(page, b.remote);
    await sync(a);
    expect(active(server, page, ids[0])).toBe(true);
    expect(trashed(server, ids[0])).toBe(false);
  });

  it('deshacer sin que nadie quite la foto: una lectura y ningún link_page_file', async () => {
    const { server, b, page, ids } = await setup();
    await removeAndUndo(b, page, ids[0]);
    const n = counter(server);
    await sync(b);
    expect(n()).toEqual({ reads: 1, links: 0, unlinks: 0 });
    expect(await link(b, page, ids[0])).toMatchObject({ pending: 0, unconfirmed: false });
  });

  it('escribir una letra en una página con fotos: ninguna lectura de usos ni fila sin confirmar', async () => {
    const { server, b, page, ids } = await setup();
    await edit(b, page, (doc) => typeLetter(doc));
    const n = counter(server);
    await sync(b);
    expect(n()).toEqual({ reads: 0, links: 0, unlinks: 0 });
    for (const id of ids) expect((await link(b, page, id))?.unconfirmed).toBeFalsy();
  });

  it('una foto pegada y borrada sin red (ítem borrado en el envío): una lectura, sin links ni filas colgadas', async () => {
    const { server, b, page, ids } = await setup();
    await edit(b, page, (doc) => insertImage(doc, ids[0]));
    await edit(b, page, (doc) => {
      const group = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
      group.delete(group.length - 1, 1);
    });
    const n = counter(server);
    await sync(b);
    expect(n()).toEqual({ reads: 1, links: 0, unlinks: 0 });
    expect(active(server, page, ids[0])).toBe(true);
    expect((await link(b, page, ids[0]))?.unconfirmed).toBeFalsy();
  });

  it('una subida que vence (sin conflicto): a lo sumo un link de más, idempotente, y todo confirmado al final', async () => {
    const { server, b, page, ids } = await setup();
    await edit(b, page, (doc) => insertImage(doc, ids[1]));
    const orig = b.remote.pushUpdate.bind(b.remote);
    let once = true;
    b.remote.pushUpdate = (async (...args: Parameters<typeof orig>) => {
      if (once) {
        once = false;
        throw new RemoteError('slow', false, REQUEST_TIMEOUT);
      }
      return orig(...args);
    }) as typeof orig;
    const n = counter(server);
    await sync(b);
    await sync(b);
    // En el ciclo que vence, lo propio sigue sin subir y la comparación manda lo que trae (D611): 1 `link` de más.
    expect(n().links).toBeLessThanOrEqual(1);
    expect(active(server, page, ids[1])).toBe(true);
    expect(await link(b, page, ids[1])).toMatchObject({ pending: 0, unconfirmed: false });
  });
});

describe('el costo (C2)', () => {
  async function moveAll(b: Device, page: string, ids: string[]): Promise<void> {
    await edit(b, page, (doc) => {
      for (const x of ids) removeImage(doc, x);
      for (const x of ids) insertImage(doc, x, 0);
    });
  }

  it('52 fotos movidas sin red y nadie quita nada: una sola lectura de usos y ningún link', async () => {
    const { server, b, page, ids } = await setup(52);
    await moveAll(b, page, ids);
    const n = counter(server);
    await sync(b);
    expect(n()).toEqual({ reads: 1, links: 0, unlinks: 0 });
    for (const x of ids) expect((await link(b, page, x))?.unconfirmed).toBeFalsy();
  });

  it('52 fotos movidas sin red y A quitó 5: una lectura y exactamente 5 links, de esas 5', async () => {
    const { server, a, b, page, ids } = await setup(52);
    await moveAll(b, page, ids);
    await aRemoves(server, a, page, ...ids.slice(0, 5));
    const start = server.mediaCalls.length;
    const n = counter(server);
    await sync(b);
    expect(n()).toEqual({ reads: 1, links: 5, unlinks: 0 });
    const linked = server.mediaCalls.slice(start).filter((c) => c.startsWith('link_page_file')).map((c) => c.split(' ')[2]);
    expect(linked.sort()).toEqual(ids.slice(0, 5).sort());
    for (const x of ids.slice(0, 5)) {
      expect(active(server, page, x)).toBe(true);
      expect(trashed(server, x)).toBe(false);
    }
  });
});

describe('mediaIdsInUpdate', () => {
  it('trae las fotos de los ítems del update, también las de un ítem que el mismo update borra; el texto no trae ninguna', () => {
    // Sin recolección, como arma la subida lo guardado (`keepDeleted`).
    const doc = new Y.Doc({ gc: false });
    const [x, y] = [crypto.randomUUID(), crypto.randomUUID()];
    insertImage(doc, x);
    const sv = Y.encodeStateVector(doc);
    insertImage(doc, y);
    const group = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
    group.delete(group.length - 1, 1);
    typeLetter(doc);
    expect([...mediaIdsInUpdate(Y.encodeStateAsUpdate(doc, sv))]).toEqual([y]);
    expect([...mediaIdsInUpdate(Y.encodeStateAsUpdate(doc))].sort()).toEqual([x, y].sort());
    doc.destroy();
  });
});
