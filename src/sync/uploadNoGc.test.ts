import { afterAll, afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { NO_GC_MAX_BYTES } from './docs';
import { PageDocs as MainPageDocs } from './fixtures/mainDocs';
import { applyRowsInOrder, findRemovedWriting } from './removedWriting';
import { CONTENT_FRAGMENT, normalizeStructure, seedIfEmpty } from './structure';
import { FakeRemote, FakeServer, makeDevice, type Device } from './testing';

// Roadmap B.16: lo que alguien escribe adentro de un bloque que otro borra a la vez tiene que llegar al servidor, y
// quien lo escribió se tiene que enterar. La subida se armaba en un Y.Doc con GC: si el dispositivo bajaba el
// borrado antes de subir lo suyo, su texto viajaba como hueco y quedaba solo en ese dispositivo. Ver
// Docs/Doc_Sincronizacion.md, "La subida sin GC". La prueba al azar con el editor está en
// src/ui/collabRemovedWriting.test.ts.

const devices: Device[] = [];
async function device(server: FakeServer, dbName?: string): Promise<Device> {
  const d = await makeDevice(server, dbName);
  devices.push(d);
  return d;
}

const swallow = (e: unknown) => {
  const name = (e as { name?: string })?.name;
  if (name === 'InvalidStateError' || name === 'AbortError' || name === 'TransactionInactiveError') return;
  throw e;
};
process.on('unhandledRejection', swallow);
afterAll(() => {
  process.off('unhandledRejection', swallow);
});
afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    try {
      d.db.close();
    } catch {
      // ya cerrada
    }
  }
});

/** Un bloque de BlockNote (blockContainer > paragraph > texto) con ese id y ese texto. */
function block(id: string, text: string): Y.XmlElement {
  const container = new Y.XmlElement('blockContainer');
  container.setAttribute('id', id);
  const paragraph = new Y.XmlElement('paragraph');
  const t = new Y.XmlText();
  t.insert(0, text);
  paragraph.insert(0, [t]);
  container.insert(0, [paragraph]);
  return container;
}

/** La raíz de bloques de la página. */
function root(doc: Y.Doc): Y.XmlElement {
  return doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
}

/** El texto de un bloque (un blockContainer). */
function textIn(container: Y.XmlElement): Y.XmlText {
  return (container.get(0) as Y.XmlElement).get(0) as Y.XmlText;
}

/** El texto de un bloque de la raíz, por id. */
function textOf(doc: Y.Doc, id: string): Y.XmlText | null {
  for (const node of root(doc).toArray()) {
    if (node instanceof Y.XmlElement && node.getAttribute('id') === id) return textIn(node);
  }
  return null;
}

/** Todo el texto que trae una fila, también el borrado: lo que el historial podría mostrar. */
function rowText(data: Uint8Array): string {
  return Y.decodeUpdate(data)
    .structs.map((s) => (s instanceof Y.Item && s.content instanceof Y.ContentString ? s.content.str : ''))
    .join('');
}

function serverText(server: FakeServer, pageId: string): string {
  return (server.updates.get(pageId) ?? []).map((u) => rowText(u.data)).join('|');
}

/** Lo visible de la página en el servidor (las filas en orden). */
function serverVisible(server: FakeServer, pageId: string): string {
  const doc = new Y.Doc({ gc: false });
  applyRowsInOrder(doc, (server.updates.get(pageId) ?? []).map((u) => u.data));
  const out = doc.getXmlFragment(CONTENT_FRAGMENT).toString();
  doc.destroy();
  return out;
}

async function edit(d: Device, pageId: string, fn: (doc: Y.Doc) => void): Promise<void> {
  const doc = await d.docs.open(pageId);
  fn(doc);
  await d.docs.flush(pageId);
  d.docs.close(pageId);
}

async function visible(d: Device, pageId: string): Promise<string> {
  const doc = await d.docs.open(pageId);
  const out = doc.getXmlFragment(CONTENT_FRAGMENT).toString();
  d.docs.close(pageId);
  return out;
}

/** La página con dos bloques, subida y bajada en los dos dispositivos. */
async function twoBlocks(server: FakeServer): Promise<{ a: Device; b: Device; pageId: string }> {
  const a = await device(server);
  const b = await device(server);
  const pageId = await a.tree.create(null, 'P');
  await edit(a, pageId, (doc) => {
    const group = new Y.XmlElement('blockGroup');
    group.insert(0, [block('b1', 'Primero'), block('b2', 'Segundo')]);
    doc.getXmlFragment(CONTENT_FRAGMENT).insert(0, [group]);
  });
  await a.engine.syncNow();
  await b.engine.syncNow();
  return { a, b, pageId };
}

describe('B.16: lo escrito adentro de algo que otro borra llega al servidor', () => {
  it('A escribe en un bloque, B lo borra, A baja el borrado antes de subir: el texto de A está en el servidor y A se entera', async () => {
    const server = new FakeServer();
    const { a, b, pageId } = await twoBlocks(server);

    // A escribe en el bloque b2 (queda guardado en su dispositivo, sin subir).
    await edit(a, pageId, (doc) => textOf(doc, 'b2')!.insert(7, ' TEXTO-DE-A'));
    // B borra el bloque b2 y lo sube.
    await edit(b, pageId, (doc) => root(doc).delete(1, 1));
    await b.engine.syncNow();
    // A baja antes de subir (lo escrito entre la subida y la bajada de un ciclo, o una subida que venció).
    await a.docs.pullPage(pageId, a.remote);
    await a.engine.syncNow();

    // Antes de B.16 la fila de A llegaba sin el texto (`PrimeroSegundo||`).
    expect(serverText(server, pageId)).toContain('TEXTO-DE-A');
    // El borrado gana igual en todos lados: nadie lo ve.
    await b.engine.syncNow();
    const shown = serverVisible(server, pageId);
    expect(shown).not.toContain('TEXTO-DE-A');
    expect(await visible(a, pageId)).toBe(shown);
    expect(await visible(b, pageId)).toBe(shown);
    const c = await device(server);
    await c.engine.syncNow();
    expect(await visible(c, pageId)).toBe(shown);
    // A tiene el aviso con su texto; B (que borró) y C, no.
    const notes = await a.docs.removedWriting(pageId);
    expect(notes.map((n) => n.text)).toEqual([' TEXTO-DE-A']);
    expect(await b.docs.removedWriting(pageId)).toEqual([]);
    expect(await c.docs.removedWriting(pageId)).toEqual([]);
    // Visto: se va.
    await a.docs.dismissRemovedWriting(pageId);
    expect(await a.docs.removedWriting(pageId)).toEqual([]);
  });

  it('si A ya había subido, el texto está en el servidor y A también se entera (lo escribió en esta sesión)', async () => {
    const server = new FakeServer();
    const { a, b, pageId } = await twoBlocks(server);
    await edit(a, pageId, (doc) => textOf(doc, 'b2')!.insert(7, ' YA-SUBIDO'));
    await a.engine.syncNow();
    // B borra sin haber bajado lo de A.
    await edit(b, pageId, (doc) => root(doc).delete(1, 1));
    await b.docs.pushPage(pageId, b.remote);
    let heard = 0;
    a.docs.subscribeRemovedWriting(() => heard++);
    await a.engine.syncNow();
    expect(serverText(server, pageId)).toContain('YA-SUBIDO');
    expect((await a.docs.removedWriting(pageId)).map((n) => n.text)).toEqual([' YA-SUBIDO']);
    expect(heard).toBe(1);
  });

  it('si B vio el texto de A y borró el bloque, no es a la vez: no hay aviso', async () => {
    const server = new FakeServer();
    const { a, b, pageId } = await twoBlocks(server);
    await edit(a, pageId, (doc) => textOf(doc, 'b2')!.insert(7, ' VISTO'));
    await a.engine.syncNow();
    await b.engine.syncNow();
    await edit(b, pageId, (doc) => root(doc).delete(1, 1));
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect(await visible(a, pageId)).not.toContain('VISTO');
    expect(await a.docs.removedWriting(pageId)).toEqual([]);
  });

  it('lo que A borró antes de que llegara el borrado de B no es un aviso (y también sube, con su texto)', async () => {
    const server = new FakeServer();
    const { a, b, pageId } = await twoBlocks(server);
    await edit(a, pageId, (doc) => textOf(doc, 'b2')!.insert(7, ' BORRADO-POR-A'));
    await edit(a, pageId, (doc) => textOf(doc, 'b2')!.delete(7, 14));
    // Y además borra el bloque b1 entero, que B también borra.
    await edit(a, pageId, (doc) => root(doc).delete(0, 1));
    await edit(b, pageId, (doc) => root(doc).delete(0, 2));
    await b.engine.syncNow();
    await a.docs.pullPage(pageId, a.remote);
    await a.engine.syncNow();
    expect(await a.docs.removedWriting(pageId)).toEqual([]);
    // Lo escrito y borrado entre dos subidas también llega (es lo que hace la subida sin GC: ver el documento).
    expect(serverText(server, pageId)).toContain('BORRADO-POR-A');
  });

  it('después de cerrar la app: lo que quedó sin subir y otro borró también avisa', async () => {
    const server = new FakeServer();
    const { b, pageId } = await twoBlocks(server);
    const name = crypto.randomUUID();
    const a2 = await device(server, name);
    await a2.engine.syncNow();
    await edit(a2, pageId, (doc) => textOf(doc, 'b2')!.insert(0, 'SIN-RED '));
    // La app se cierra sin subir.
    a2.engine.stop();
    a2.db.close();
    await edit(b, pageId, (doc) => root(doc).delete(1, 1));
    await b.engine.syncNow();
    // Vuelve a abrir (otra sesión: no sabe qué autores de Yjs fueron suyos) y baja antes de subir.
    const again = await device(server, name);
    await again.docs.pullPage(pageId, again.remote);
    await again.engine.syncNow();
    expect((await again.docs.removedWriting(pageId)).map((n) => n.text)).toEqual(['SIN-RED ']);
    expect(serverText(server, pageId)).toContain('SIN-RED');
  });

  it('la versión publicada abre la misma base con el aviso guardado y sigue andando', async () => {
    const server = new FakeServer();
    const { a, b, pageId } = await twoBlocks(server);
    await edit(a, pageId, (doc) => textOf(doc, 'b2')!.insert(7, ' AVISO'));
    await edit(b, pageId, (doc) => root(doc).delete(1, 1));
    await b.engine.syncNow();
    await a.docs.pullPage(pageId, a.remote);
    expect(await a.docs.removedWriting(pageId)).toHaveLength(1);
    // Antes de subir, abre la versión publicada (fixtures/mainDocs.ts) sobre la misma base.
    a.engine.stop();
    await a.docs.flush();
    const old = new MainPageDocs(a.db, { normalize: normalizeStructure, seed: seedIfEmpty });
    const remote = new FakeRemote(server, '0.082');
    expect(await old.unsyncedPages()).toContain(pageId);
    await old.pushPage(pageId, remote);
    await old.pullPage(pageId, remote);
    expect(await old.unsyncedPages()).toEqual([]);
    // Ella sube con GC (el texto no llega: por eso conviene subir la versión mínima), pero lo guardado sigue intacto
    // y el aviso sigue ahí para esta versión.
    const rows = await a.db.getAllFromIndex('docUpdates', 'pageId', pageId);
    expect(rows.map((r) => rowText(r.data)).join('|')).toContain('AVISO');
    expect(await a.docs.removedWriting(pageId)).toHaveLength(1);
    old.dispose();
  });

  it('una subida sin GC demasiado grande se arma con GC, como antes (nunca se queda sin subir)', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const pageId = await a.tree.create(null, 'P');
    // Más de lo que entra sin GC: se escribe y se borra antes de subir.
    const big = 'x'.repeat(NO_GC_MAX_BYTES + 1024);
    await edit(a, pageId, (doc) => {
      const group = new Y.XmlElement('blockGroup');
      group.insert(0, [block('b1', 'Queda')]);
      doc.getXmlFragment(CONTENT_FRAGMENT).insert(0, [group]);
    });
    await edit(a, pageId, (doc) => textOf(doc, 'b1')!.insert(0, big));
    await edit(a, pageId, (doc) => textOf(doc, 'b1')!.delete(0, big.length));
    const warn = console.warn;
    const warned: string[] = [];
    console.warn = (msg: unknown) => void warned.push(String(msg));
    try {
      await a.engine.syncNow();
    } finally {
      console.warn = warn;
    }
    const rows = server.updates.get(pageId) ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0].data.length).toBeLessThan(10_000);
    expect(warned.some((m) => m.includes('too large'))).toBe(true);
    expect(serverVisible(server, pageId)).toContain('Queda');
    expect(await a.docs.unsyncedPages()).toEqual([]);
  });
});

describe('B.16: el texto del aviso', () => {
  /** Un padre con dos hijos y otro bloque, igual en "el servidor" y en el dispositivo. */
  function setup(): { server: Y.Doc; rows: Uint8Array[]; local: Y.Doc } {
    const server = new Y.Doc();
    const group = new Y.XmlElement('blockGroup');
    const parent = block('p', 'Padre');
    const children = new Y.XmlElement('blockGroup');
    children.insert(0, [block('h1', 'Hijo uno'), block('h2', 'Hijo dos')]);
    parent.insert(1, [children]);
    group.insert(0, [parent, block('q', 'Otro')]);
    server.getXmlFragment(CONTENT_FRAGMENT).insert(0, [group]);
    const local = new Y.Doc();
    Y.applyUpdate(local, Y.encodeStateAsUpdate(server));
    return { server, rows: [Y.encodeStateAsUpdate(server)], local };
  }

  it('un renglón por bloque, en el orden de la página, con fotos por su nombre; nada de lo ajeno', () => {
    const { server, rows, local } = setup();
    const syncedSV = Y.encodeStateVector(local);
    local.on('update', (u: Uint8Array) => rows.push(u));
    const fragment = local.getXmlFragment(CONTENT_FRAGMENT);
    const parent = (fragment.get(0) as Y.XmlElement).get(0) as Y.XmlElement;
    const kids = parent.get(1) as Y.XmlElement;
    textIn(kids.get(1) as Y.XmlElement).insert(0, 'segundo ');
    textIn(kids.get(0) as Y.XmlElement).insert(8, ' primero');
    const photo = new Y.XmlElement('blockContainer');
    const image = new Y.XmlElement('image');
    image.setAttribute('url', 'sdmedia://abc');
    image.setAttribute('name', 'toma.jpg');
    photo.insert(0, [image]);
    kids.insert(2, [photo]);
    // Lo que se escribe en "Otro" no se borra: no aparece.
    textIn((fragment.get(0) as Y.XmlElement).get(1) as Y.XmlElement).insert(0, 'queda ');
    // El servidor borra el padre (sin haber visto nada de lo de arriba).
    (server.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement).delete(0, 1);
    const incoming = Y.encodeStateAsUpdate(server, syncedSV);
    const found = findRemovedWriting(rows, syncedSV, incoming);
    expect(found?.text).toBe(' primero\nsegundo \n[toma.jpg]');
    expect(found?.clients).toEqual([local.clientID]);
  });

  it('sin nada propio vivo, o con todo nombrado en el borrado, no hay aviso', () => {
    const { server, rows, local } = setup();
    const syncedSV = Y.encodeStateVector(local);
    (server.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement).delete(0, 1);
    const incoming = Y.encodeStateAsUpdate(server, syncedSV);
    expect(findRemovedWriting(rows, syncedSV, incoming)).toBeNull();
    // Sin `syncedSV` todo parece propio, y lo mismo con `own`; pero el borrado nombra todo lo que borra: tampoco.
    expect(findRemovedWriting(rows, undefined, incoming)).toBeNull();
    expect(findRemovedWriting(rows, syncedSV, incoming, new Set([server.clientID]))).toBeNull();
  });
});
