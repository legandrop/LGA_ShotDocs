import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { dirtyKey, emptyDocState, hasUnsyncedContent } from './localDb';
import { FakeServer, makeDevice, microtasks, watchTransactions, type Device } from './testing';

// Roadmap B.5: el guardado local sin lecturas. Una recarga o un cierre a pocos milisegundos de la última
// tecla perdía el final de lo escrito: la transacción que guardaba cada edición leía el estado antes de
// confirmarse, y lo que llegaba mientras tanto esperaba en memoria. Ahora cada tanda sale en una
// transacción que solo escribe (el update y la marca `docDirty:<página>` en `meta`) y se confirma en el acto.

const devices: Device[] = [];
async function device(server: FakeServer, dbName?: string): Promise<Device> {
  const d = await makeDevice(server, dbName);
  devices.push(d);
  return d;
}

afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
  }
});

async function write(d: Device, pageId: string, fn: (text: Y.Text) => void): Promise<void> {
  const doc = await d.docs.open(pageId);
  fn(doc.getText('t'));
  await d.docs.flush(pageId);
  d.docs.close(pageId);
}

async function read(d: Device, pageId: string): Promise<string> {
  const doc = await d.docs.open(pageId);
  const text = doc.getText('t').toString();
  d.docs.close(pageId);
  return text;
}

/** Lo que ve un dispositivo nuevo después de bajar todo del servidor. */
async function fromServer(server: FakeServer, pageId: string): Promise<string> {
  const c = await device(server);
  await c.engine.syncNow();
  return read(c, pageId);
}

async function meta(d: Device, pageId: string): Promise<unknown> {
  return d.db.get('meta', dirtyKey(pageId));
}

describe('B.5: guardado local sin lecturas', () => {
  it('la página que se va justo después de escribir no pierde lo escrito (antes se perdía)', async () => {
    const server = new FakeServer();
    const dbName = crypto.randomUUID();
    const a = await device(server, dbName);
    const pageId = await a.tree.create(null, 'P');
    const doc = await a.docs.open(pageId);

    const watch = watchTransactions();
    try {
      // Dos teclas en dos tareas del navegador, y la página se va enseguida de la segunda.
      doc.getText('t').insert(0, 'Escrito ');
      await microtasks();
      doc.getText('t').insert(8, 'sin conexión.');
      await microtasks();
      await watch.kill(a);
    } finally {
      watch.restore();
    }

    const again = await device(server, dbName);
    expect(await read(again, pageId)).toBe('Escrito sin conexión.');
    expect(await again.docs.unsyncedPages()).toEqual([pageId]);
    await again.engine.syncNow();
    expect(await fromServer(server, pageId)).toBe('Escrito sin conexión.');
  });

  it('el final de lo escrito, con lo anterior ya guardado, tampoco se pierde', async () => {
    const server = new FakeServer();
    const dbName = crypto.randomUUID();
    const a = await device(server, dbName);
    const pageId = await a.tree.create(null, 'P');
    const doc = await a.docs.open(pageId);
    doc.getText('t').insert(0, 'Escrito sin co');
    await a.docs.flush(pageId);

    const watch = watchTransactions();
    try {
      doc.getText('t').insert(14, 'nexión 1.');
      await microtasks();
      await watch.kill(a);
    } finally {
      watch.restore();
    }

    const again = await device(server, dbName);
    expect(await read(again, pageId)).toBe('Escrito sin conexión 1.');
  });

  it('la semilla y la primera edición salen en la misma transacción, aunque la página se vaya enseguida', async () => {
    const server = new FakeServer();
    const dbName = crypto.randomUUID();
    const a = await device(server, dbName);
    const pageId = await a.tree.create(null, 'P');
    await a.engine.syncNow();
    const doc = await a.docs.open(pageId, { seed: true });

    const watch = watchTransactions();
    try {
      doc.transact(() => {
        const paragraph = ((doc.getXmlFragment('document-store').get(0) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlElement;
        const text = new Y.XmlText();
        paragraph.insert(0, [text]);
        text.insert(0, 'hola');
      });
      await microtasks();
      await watch.kill(a);
    } finally {
      watch.restore();
    }

    const again = await device(server, dbName);
    const reloaded = await again.docs.open(pageId);
    expect(reloaded.getXmlFragment('document-store').toString()).toContain('hola');
    expect(reloaded.store.pendingStructs).toBeNull();
    again.docs.close(pageId);
  });

  it('la marca queda si hubo ediciones durante una subida, y se suben en la vuelta siguiente', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const pageId = await a.tree.create(null, 'P');
    await a.engine.syncNow();
    const doc = await a.docs.open(pageId);
    doc.getText('t').insert(0, 'A1');
    await a.docs.flush(pageId);
    expect(await meta(a, pageId)).toBeTypeOf('string');

    // Mientras la subida viaja, se escribe y se guarda algo más.
    const push = a.remote.pushUpdate.bind(a.remote);
    a.remote.pushUpdate = async (...args) => {
      doc.getText('t').insert(2, ' A2');
      await a.docs.flush(pageId);
      a.remote.pushUpdate = push;
      return push(...args);
    };
    await a.docs.pushPage(pageId, a.remote).catch(() => undefined);
    // La primera subida (A1) se confirmó; A2 llegó después: la marca sigue y la página figura pendiente.
    expect(server.updates.get(pageId)?.length).toBeGreaterThanOrEqual(1);
    const pushedFirst = new Y.Doc();
    Y.applyUpdate(pushedFirst, server.updates.get(pageId)![0].data);
    expect(pushedFirst.getText('t').toString()).toBe('A1');

    await a.engine.syncNow();
    expect(await meta(a, pageId)).toBeUndefined();
    expect(await a.docs.unsyncedPages()).toEqual([]);
    a.docs.close(pageId);
    expect(await fromServer(server, pageId)).toBe('A1 A2');
  });

  it('la subida confirmada borra la marca solo si sigue siendo la misma', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const pageId = await a.tree.create(null, 'P');
    await a.engine.syncNow();
    await write(a, pageId, (t) => t.insert(0, 'uno'));
    const first = await meta(a, pageId);
    await write(a, pageId, (t) => t.insert(3, ' dos'));
    const second = await meta(a, pageId);
    expect(first).not.toBe(second);
    await a.engine.syncNow();
    expect(await meta(a, pageId)).toBeUndefined();
    expect(a.engine.getStatus().pendingPages).toBe(0);
    expect(await fromServer(server, pageId)).toBe('uno dos');
  });
});

describe('B.5: la misma base con una versión anterior de la app', () => {
  /** Guarda una edición como lo hacía la versión anterior: el update y la versión +1, sin marca. */
  async function legacyWrite(d: Device, pageId: string, fn: (text: Y.Text) => void): Promise<void> {
    const rows = await d.db.getAllFromIndex('docUpdates', 'pageId', pageId);
    const doc = new Y.Doc();
    if (rows.length > 0) Y.applyUpdate(doc, Y.mergeUpdates(rows.map((r) => r.data)));
    const before = Y.encodeStateVector(doc);
    fn(doc.getText('t'));
    const update = Y.encodeStateAsUpdate(doc, before);
    doc.destroy();
    const tx = d.db.transaction(['docUpdates', 'docState'], 'readwrite');
    await tx.objectStore('docUpdates').add({ pageId, data: update });
    const state = (await tx.objectStore('docState').get(pageId)) ?? { pageId, cursor: 0, version: 0, ackedVersion: 0 };
    state.version += 1;
    await tx.objectStore('docState').put(state);
    await tx.done;
  }

  it('un dispositivo que actualiza con cambios pendientes de la versión anterior los sube', async () => {
    const server = new FakeServer();
    const dbName = crypto.randomUUID();
    const a = await device(server, dbName);
    const pageId = await a.tree.create(null, 'P');
    await a.engine.syncNow();
    a.engine.stop();
    await legacyWrite(a, pageId, (t) => t.insert(0, 'de la versión anterior'));
    expect(await meta(a, pageId)).toBeUndefined();

    const updated = await device(server, dbName);
    expect(await updated.docs.unsyncedPages()).toEqual([pageId]);
    await updated.engine.syncNow();
    expect(updated.engine.getStatus().pendingPages).toBe(0);
    expect(await fromServer(server, pageId)).toBe('de la versión anterior');
  });

  it('una versión anterior que abre la base ve pendiente lo que guardó la nueva (la versión se sigue sumando)', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const pageId = await a.tree.create(null, 'P');
    await a.engine.syncNow();
    await write(a, pageId, (t) => t.insert(0, 'nuevo'));
    const state = (await a.db.get('docState', pageId))!;
    // Lo que mira una versión anterior: sin la marca.
    expect(hasUnsyncedContent(state)).toBe(true);
  });

  it('si la app se cerró antes de sumar la versión, se suma al volver (para una versión anterior)', async () => {
    const server = new FakeServer();
    const dbName = crypto.randomUUID();
    const a = await device(server, dbName);
    const pageId = await a.tree.create(null, 'P');
    await a.engine.syncNow();
    // Ni la guardia al abrir (`docState`) ni la suma de la versión (`docState` y `meta`, aparte de la
    // edición) llegan a guardarse.
    const realTransaction = a.db.transaction.bind(a.db);
    let blocked = 0;
    (a.db as { transaction: unknown }).transaction = ((stores: string | string[], mode?: IDBTransactionMode) => {
      const names = [stores].flat();
      if (mode === 'readwrite' && names.includes('docState') && !names.includes('docUpdates')) {
        blocked++;
        throw new DOMException('closing', 'InvalidStateError');
      }
      return realTransaction(stores as never, mode);
    }) as never;
    const doc = await a.docs.open(pageId);
    doc.getText('t').insert(0, 'sin sumar');
    await a.docs.flush(pageId);
    a.docs.close(pageId);
    await a.docs.flush();
    (a.db as { transaction: unknown }).transaction = realTransaction;
    expect(blocked).toBeGreaterThan(0);
    // Una versión anterior no la vería pendiente.
    expect(hasUnsyncedContent((await a.db.get('docState', pageId)) ?? emptyDocState(pageId))).toBe(false);
    expect(await meta(a, pageId)).toBeTypeOf('string');
    a.engine.stop();
    a.db.close();

    server.online = false;
    const again = await device(server, dbName);
    expect(await again.docs.unsyncedPages()).toEqual([pageId]);
    expect(hasUnsyncedContent((await again.db.get('docState', pageId))!)).toBe(true);
    server.online = true;
    await again.engine.syncNow();
    expect(await fromServer(server, pageId)).toBe('sin sumar');
  });

  it('lo que confirma una versión anterior no borra la marca: la nueva vuelve a mirar y queda al día', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const pageId = await a.tree.create(null, 'P');
    await a.engine.syncNow();
    await write(a, pageId, (t) => t.insert(0, 'texto'));
    // Una versión anterior sube todo y confirma a su manera (versión confirmada, sin tocar la marca).
    const snap = await a.docs.snapshot(pageId);
    await a.remote.pushUpdate(pageId, crypto.randomUUID(), Y.encodeStateAsUpdate(snap.doc));
    const sv = Y.encodeStateVector(snap.doc);
    snap.doc.destroy();
    const tx = a.db.transaction('docState', 'readwrite');
    const s = (await tx.store.get(pageId))!;
    s.ackedVersion = s.version;
    s.syncedSV = sv;
    await tx.store.put(s);
    await tx.done;
    expect(await meta(a, pageId)).toBeTypeOf('string');

    await a.engine.syncNow();
    expect(await meta(a, pageId)).toBeUndefined();
    expect(a.engine.getStatus().pendingPages).toBe(0);
    expect(await fromServer(server, pageId)).toBe('texto');
  });

  it('un envío en vuelo de la nueva, ediciones de la anterior en el medio y la nueva otra vez: nada queda afuera', async () => {
    const server = new FakeServer();
    const dbName = crypto.randomUUID();
    const a = await device(server, dbName);
    const pageId = await a.tree.create(null, 'P');
    await a.engine.syncNow();
    await write(a, pageId, (t) => t.insert(0, 'nueva'));
    // La nueva arma el envío (con su marca) y la respuesta se pierde.
    server.loseNextPushResponse = true;
    await a.engine.syncNow();
    expect((await a.db.get('docState', pageId))?.pending?.dirty).toBeTypeOf('string');
    a.engine.stop();
    // Se abre la versión anterior y escribe (sin marca).
    await legacyWrite(a, pageId, (t) => t.insert(t.length, ' y anterior'));
    a.db.close();

    const again = await device(server, dbName);
    await again.engine.syncNow();
    await again.engine.syncNow();
    expect(again.engine.getStatus().pendingPages).toBe(0);
    expect(await fromServer(server, pageId)).toBe('nueva y anterior');
  });
});

describe('B.5: restaurar y cerrar en cada punto', () => {
  it('restaurar una copia con ediciones marcadas y sin subir: todo vuelve al servidor', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const pageId = await a.tree.create(null, 'P');
    await write(a, pageId, (t) => t.insert(0, 'antes.'));
    await a.engine.syncNow();
    const restore = server.backup();
    await write(a, pageId, (t) => t.insert(t.length, ' después.'));
    await a.engine.syncNow();
    server.online = false;
    await write(a, pageId, (t) => t.insert(t.length, ' sin red.'));
    restore();
    server.online = true;
    await a.engine.syncNow();
    await a.engine.syncNow();
    expect(await meta(a, pageId)).toBeUndefined();
    expect(a.engine.getStatus().pendingPages).toBe(0);
    expect(await fromServer(server, pageId)).toBe('antes. después. sin red.');
  });

  // Cada punto en el que la app se puede cerrar, con lo escrito y la subida.
  const points = ['antes de guardar', 'guardado', 'envío armado', 'enviado sin respuesta', 'confirmado'] as const;
  for (const point of points) {
    it(`cerrar la app: ${point}`, async () => {
      const server = new FakeServer();
      const dbName = crypto.randomUUID();
      const a = await device(server, dbName);
      const pageId = await a.tree.create(null, 'P');
      await write(a, pageId, (t) => t.insert(0, 'base.'));
      await a.engine.syncNow();
      const doc = await a.docs.open(pageId);

      const watch = watchTransactions();
      try {
        doc.getText('t').insert(5, ' nuevo.');
        if (point !== 'antes de guardar') await a.docs.flush(pageId);
        if (point === 'envío armado') {
          a.remote.pushUpdate = async () => {
            throw new Error('Failed to fetch');
          };
          await a.docs.pushPage(pageId, a.remote).catch(() => undefined);
        }
        if (point === 'enviado sin respuesta') {
          server.loseNextPushResponse = true;
          await a.docs.pushPage(pageId, a.remote).catch(() => undefined);
        }
        if (point === 'confirmado') await a.docs.pushPage(pageId, a.remote);
        await microtasks();
        await watch.kill(a);
      } finally {
        watch.restore();
      }

      const again = await device(server, dbName);
      // "antes de guardar": la tecla se escribió en la misma tarea que el cierre, así que se pierde (la
      // única ventana que queda). En todos los demás puntos, lo escrito está.
      const expected = point === 'antes de guardar' ? /^base\.( nuevo\.)?$/ : /^base\. nuevo\.$/;
      expect(await read(again, pageId)).toMatch(expected);
      await again.engine.syncNow();
      await again.engine.syncNow();
      expect(again.engine.getStatus().pendingPages).toBe(0);
      expect(await meta(again, pageId)).toBeUndefined();
      expect(await fromServer(server, pageId)).toBe(await read(again, pageId));
      // Nada duplicado: el reintento con el mismo id no suma otra fila.
      if (point === 'enviado sin respuesta') expect(server.updates.get(pageId)).toHaveLength(2);
    });
  }
});

/** Lo guardado en IndexedDB, armado directamente con Yjs (sin PageDocs). */
async function savedText(db: Device['db'], pageId: string): Promise<{ text: string; pending: boolean }> {
  const rows = await db.getAllFromIndex('docUpdates', 'pageId', pageId);
  const doc = new Y.Doc();
  if (rows.length > 0) Y.applyUpdate(doc, Y.mergeUpdates(rows.map((r) => r.data)));
  const out = { text: doc.getText('t').toString(), pending: doc.store.pendingStructs !== null };
  doc.destroy();
  return out;
}

describe('B.5: carreras del guardado sin lecturas', () => {
  it('una edición guardada entre leer lo que se sube y la suma de su versión no provoca una subida vacía de más', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const pageId = await a.tree.create(null, 'P');
    await a.engine.syncNow();
    const doc = await a.docs.open(pageId);
    doc.getText('t').insert(0, 'uno');
    await a.docs.flush(pageId);
    await a.engine.syncNow();
    const before = server.updates.get(pageId)?.length ?? 0;

    // La edición entra justo cuando la subida lee el estado (después de esperar lo que se estaba guardando).
    const realGet = a.db.get.bind(a.db);
    let fired = false;
    (a.db as { get: unknown }).get = ((store: never, key: never) => {
      if (!fired && store === 'docState') {
        fired = true;
        doc.getText('t').insert(3, ' dos');
      }
      return realGet(store, key);
    }) as never;
    await a.docs.pushPage(pageId, a.remote);
    (a.db as { get: unknown }).get = realGet;
    await a.docs.flush();
    await a.engine.syncNow();
    await a.engine.syncNow();
    const rows = server.updates.get(pageId)!.slice(before);
    expect(rows.map((u) => Y.decodeUpdate(u.data).structs.length > 0)).toEqual([true]);
    expect(await fromServer(server, pageId)).toBe('uno dos');
    a.docs.close(pageId);
  });

  it('una edición guardada mientras viaja la subida sale en la siguiente, sin subidas vacías', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const pageId = await a.tree.create(null, 'P');
    await a.engine.syncNow();
    const doc = await a.docs.open(pageId);
    doc.getText('t').insert(0, 'uno');
    await a.docs.flush(pageId);
    const before = server.updates.get(pageId)?.length ?? 0;
    const push = a.remote.pushUpdate.bind(a.remote);
    a.remote.pushUpdate = async (...args) => {
      a.remote.pushUpdate = push;
      doc.getText('t').insert(3, ' dos');
      await a.docs.flush(pageId);
      return push(...args);
    };
    await a.engine.syncNow();
    await a.engine.syncNow();
    await a.engine.syncNow();
    const rows = server.updates.get(pageId)!.slice(before);
    expect(rows.map((u) => Y.decodeUpdate(u.data).structs.length > 0)).toEqual([true, true]);
    expect(a.engine.getStatus().pendingPages).toBe(0);
    a.docs.close(pageId);
  });

  it('si la transacción de una tanda falla después de que la siguiente se confirmó, lo guardado no queda colgando de algo que no está', async () => {
    const server = new FakeServer();
    const dbName = crypto.randomUUID();
    const a = await device(server, dbName);
    const pageId = await a.tree.create(null, 'P');
    await a.engine.syncNow();
    const doc = await a.docs.open(pageId);

    // La primera transacción de guardado falla después de recibir sus pedidos (como un error al confirmar).
    const proto = IDBDatabase.prototype as unknown as { transaction: (...args: unknown[]) => IDBTransaction };
    const real = proto.transaction;
    let n = 0;
    proto.transaction = function (this: IDBDatabase, ...args: unknown[]) {
      const tx = real.apply(this, args);
      const stores = args[0];
      if (Array.isArray(stores) && stores.includes('meta') && stores.includes('docUpdates') && args[1] === 'readwrite' && n++ === 0) {
        (tx as unknown as { commit: () => void }).commit = () => undefined;
        void Promise.resolve().then(() => {
          try {
            tx.abort();
          } catch {
            // Ya terminó.
          }
        });
      }
      return tx;
    };
    const watch = watchTransactions();
    try {
      doc.getText('t').insert(0, 'AAAA');
      await microtasks(1);
      doc.getText('t').insert(4, 'BBBB');
      await microtasks();
      await new Promise((r) => setTimeout(r, 30));
      proto.transaction = real;
      // Se cierra antes del reintento (3 s).
      await watch.kill(a);
    } finally {
      proto.transaction = real;
      watch.restore();
    }
    const again = await device(server, dbName);
    const saved = await savedText(again.db, pageId);
    expect(saved.pending).toBe(false);
    // La segunda transacción llevó también la primera tanda: no se perdió nada.
    expect(saved.text).toBe('AAAABBBB');
  });

  it('lo programado para guardarse antes de `dispose()` se guarda igual', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const pageId = await a.tree.create(null, 'P');
    await a.engine.syncNow();
    const doc = await a.docs.open(pageId);
    doc.getText('t').insert(0, 'antes del cierre');
    // Como al cerrar sesión: dispose, flush y cerrar la base.
    a.docs.dispose();
    await a.docs.flush();
    expect((await savedText(a.db, pageId)).text).toBe('antes del cierre');
  });

  it('una edición sobre un documento reparado solo en memoria guarda también la reparación', async () => {
    const { PageDocs } = await import('./docs');
    const { openLocalDb } = await import('./localDb');
    const { mergeRootGroups } = await import('./structure');
    const db = await openLocalDb(crypto.randomUUID());
    const pageId = crypto.randomUUID();
    // Dos raíces de dos autores (como dos dispositivos que empezaron la página sin verse), ya guardadas.
    const root = (text: string) => {
      const d = new Y.Doc();
      const group = new Y.XmlElement('blockGroup');
      const container = new Y.XmlElement('blockContainer');
      const paragraph = new Y.XmlElement('paragraph');
      const t = new Y.XmlText();
      d.getXmlFragment('document-store').insert(0, [group]);
      group.insert(0, [container]);
      container.insert(0, [paragraph]);
      paragraph.insert(0, [t]);
      t.insert(0, text);
      const u = Y.encodeStateAsUpdate(d);
      d.destroy();
      return u;
    };
    await db.add('docUpdates', { pageId, data: root('uno') });
    await db.add('docUpdates', { pageId, data: root('dos') });
    let canWrite = false;
    const docs = new PageDocs(db, { normalize: mergeRootGroups, canWrite: () => canWrite });
    const doc = await docs.open(pageId);
    expect(doc.getXmlFragment('document-store').length).toBe(1);
    // Le dan "Edit" con la página abierta y escribe en el bloque que vino de la segunda raíz (una copia en
    // memoria).
    canWrite = true;
    const group = doc.getXmlFragment('document-store').get(0) as Y.XmlElement;
    const cloned = ((group.get(group.length - 1) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlText;
    cloned.insert(cloned.length, ' EDITADO');
    await docs.flush(pageId);
    docs.close(pageId);
    await docs.flush();
    await new Promise((r) => setTimeout(r, 10));
    const rows = await db.getAllFromIndex('docUpdates', 'pageId', pageId);
    const saved = new Y.Doc();
    Y.applyUpdate(saved, Y.mergeUpdates(rows.map((r) => r.data)));
    expect(saved.store.pendingStructs).toBeNull();
    const again = await docs.open(pageId);
    expect(again.getXmlFragment('document-store').length).toBe(1);
    const xml = again.getXmlFragment('document-store').toString();
    for (const part of ['uno', 'dos', ' EDITADO']) expect(xml).toContain(part);
    expect(await db.get('meta', dirtyKey(pageId))).toBeTypeOf('string');
    docs.close(pageId);
    saved.destroy();
    db.close();
  });
});
