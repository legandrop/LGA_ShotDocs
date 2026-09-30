import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { advanceSynced, serverReach } from './docs';
import { CONTENT_FRAGMENT, seedClientId } from './structure';
import { RemoteError } from './types';
import { FakeServer, makeDevice, type Device } from './testing';

// Roadmap B.2 (subir solo lo propio después de bajar) y B.3 (abrir una página vacía no crea un cambio).
//
// La regla que se prueba: lo pendiente es la diferencia entre el documento del dispositivo y `syncedSV`, así
// que `syncedSV` nunca puede decir que el servidor tiene algo que no tiene. Cada prueba lo revisa contra el
// servidor en memoria (`expectSound`) y al final se fija que al servidor no le falte nada del dispositivo
// (`expectNothingMissing`).

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

/**
 * Cierra la app (con lo que se haya subido o no: nada se espera del servidor) y la vuelve a abrir con la
 * misma base. Antes deja terminar el recuento de pendientes que dispara cada edición guardada, que si no
 * leería una base ya cerrada.
 */
async function reopen(d: Device, server: FakeServer): Promise<Device> {
  await new Promise((r) => setTimeout(r, 10));
  d.engine.stop();
  d.db.close();
  return device(server, d.db.name);
}

/** El documento que arma el servidor con todos sus updates de la página. */
function serverDoc(server: FakeServer, pageId: string, upTo = Infinity): Y.Doc {
  const doc = new Y.Doc();
  const list = (server.updates.get(pageId) ?? []).slice(0, upTo);
  if (list.length > 0) Y.applyUpdate(doc, Y.mergeUpdates(list.map((u) => u.data)));
  return doc;
}

function stateVector(doc: Y.Doc): Map<number, number> {
  return Y.decodeStateVector(Y.encodeStateVector(doc));
}

async function syncedOf(d: Device, pageId: string): Promise<Map<number, number>> {
  const sv = (await d.db.get('docState', pageId))?.syncedSV;
  return sv ? Y.decodeStateVector(sv) : new Map();
}

/** `syncedSV` no dice más de lo que tiene el servidor: de cada autor, nunca un reloj que el servidor no tenga. */
async function expectSound(d: Device, server: FakeServer, pageId: string): Promise<void> {
  // Primero lo del dispositivo y después el servidor: el servidor solo crece.
  const synced = await syncedOf(d, pageId);
  const doc = serverDoc(server, pageId);
  const has = stateVector(doc);
  doc.destroy();
  for (const [client, clock] of synced) {
    expect(clock, `autor ${client}`).toBeLessThanOrEqual(has.get(client) ?? 0);
  }
}

/** Al servidor no le falta nada de lo guardado en el dispositivo, y los dos muestran lo mismo. */
async function expectNothingMissing(d: Device, server: FakeServer, pageId: string): Promise<void> {
  const snap = await d.docs.snapshot(pageId);
  const doc = serverDoc(server, pageId);
  const has = stateVector(doc);
  for (const [client, clock] of stateVector(snap.doc)) {
    expect(has.get(client) ?? 0, `autor ${client}`).toBeGreaterThanOrEqual(clock);
  }
  expect(doc.getText('t').toString()).toBe(snap.doc.getText('t').toString());
  expect(doc.getXmlFragment(CONTENT_FRAGMENT).toString()).toBe(snap.doc.getXmlFragment(CONTENT_FRAGMENT).toString());
  snap.doc.destroy();
  doc.destroy();
}

/**
 * Cuántos pedazos del último update del servidor ya estaban en el servidor antes (reenvíos). Con B.2, una
 * subida después de bajar no reenvía nada de lo bajado.
 */
function resentInLast(server: FakeServer, pageId: string): number {
  const list = server.updates.get(pageId) ?? [];
  const before = serverDoc(server, pageId, list.length - 1);
  const had = stateVector(before);
  before.destroy();
  let resent = 0;
  for (const struct of Y.decodeUpdate(list[list.length - 1].data).structs) {
    if (!(struct instanceof Y.Item || struct instanceof Y.GC)) continue;
    if (struct.id.clock < (had.get(struct.id.client) ?? 0)) resent++;
  }
  return resent;
}

/** Autores de Yjs del último update del servidor. */
function clientsInLast(server: FakeServer, pageId: string): Set<number> {
  const list = server.updates.get(pageId) ?? [];
  return new Set(Y.decodeUpdate(list[list.length - 1].data).structs.map((s) => s.id.client));
}

async function sharedPage(a: Device, b: Device, text = 'Base.'): Promise<string> {
  const pageId = await a.tree.create(null, 'Escena');
  await write(a, pageId, (t) => t.insert(0, text));
  await a.engine.syncNow();
  await b.engine.syncNow();
  expect(await read(b, pageId)).toBe(text);
  return pageId;
}

describe('B.2: después de bajar se sube solo lo propio', () => {
  it('la primera subida después de bajar no reenvía lo bajado', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const b = await device(server);
    const pageId = await sharedPage(a, b, 'Guion de A, bastante largo para que se note.');
    const aClients = clientsInLast(server, pageId);

    await write(b, pageId, (t) => t.insert(t.length, ' B.'));
    await b.engine.syncNow();
    expect(server.updates.get(pageId)).toHaveLength(2);
    expect(resentInLast(server, pageId)).toBe(0);
    for (const client of aClients) expect(clientsInLast(server, pageId).has(client)).toBe(false);

    // Y al revés: A baja lo de B y sube solo lo suyo.
    await a.engine.syncNow();
    await write(a, pageId, (t) => t.insert(0, 'A: '));
    await a.engine.syncNow();
    expect(resentInLast(server, pageId)).toBe(0);

    for (const d of [a, b]) {
      await d.engine.syncNow();
      await expectSound(d, server, pageId);
      await expectNothingMissing(d, server, pageId);
      expect(d.engine.getStatus().pendingPages).toBe(0);
    }
    const c = await device(server);
    await c.engine.syncNow();
    expect(await read(c, pageId)).toBe('A: Guion de A, bastante largo para que se note. B.');
  });

  it('lo propio sin subir, mezclado con lo bajado, sigue pendiente y sube entero', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const b = await device(server);
    const pageId = await sharedPage(a, b);

    // B escribe sin red; A escribe y sube.
    server.online = false;
    await write(b, pageId, (t) => t.insert(t.length, ' B1'));
    server.online = true;
    await write(a, pageId, (t) => t.insert(0, 'A1 '));
    await a.engine.syncNow();

    // B baja antes de subir (el orden al revés que el ciclo), y escribe más.
    await b.docs.pullPage(pageId, b.remote);
    await expectSound(b, server, pageId);
    expect(await b.docs.unsyncedPages()).toEqual([pageId]);
    // Lo que B calcula como pendiente todavía tiene B1.
    const snap = await b.docs.snapshot(pageId);
    const pendingDoc = serverDoc(server, pageId);
    Y.applyUpdate(pendingDoc, Y.encodeStateAsUpdate(snap.doc, snap.state.syncedSV));
    expect(pendingDoc.getText('t').toString()).toContain('B1');
    snap.doc.destroy();
    pendingDoc.destroy();

    await write(b, pageId, (t) => t.insert(t.length, ' B2'));
    await b.engine.syncNow();
    expect(resentInLast(server, pageId)).toBe(0);
    await expectSound(b, server, pageId);
    await expectNothingMissing(b, server, pageId);
    expect(b.engine.getStatus().pendingPages).toBe(0);

    await a.engine.syncNow();
    expect(await read(a, pageId)).toBe('A1 Base. B1 B2');
  });

  it('lo bajado que depende de algo que falta no avanza el vector (Yjs lo deja pendiente)', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const pageId = await a.tree.create(null, 'P');
    await a.engine.syncNow();

    // Otro dispositivo escribe "hola" (autor X) y encima " mundo" (autor Y, que depende de X).
    const x = new Y.Doc();
    x.clientID = 1001;
    x.getText('t').insert(0, 'hola');
    const updX = Y.encodeStateAsUpdate(x);
    const y = new Y.Doc();
    y.clientID = 1002;
    Y.applyUpdate(y, updX);
    y.getText('t').insert(4, ' mundo');
    const updY = Y.encodeStateAsUpdate(y, Y.encodeStateVector(x));

    // A escribe sin subir, y le llega solo lo de Y (lo de X todavía no).
    await write(a, pageId, (t) => t.insert(0, 'mío '));
    await a.remote.pushUpdate(pageId, crypto.randomUUID(), updY);
    await a.docs.pullPage(pageId, a.remote);
    expect((await syncedOf(a, pageId)).get(1002) ?? 0).toBe(0);
    expect(await a.docs.unsyncedPages()).toEqual([pageId]);
    await expectSound(a, server, pageId);

    // A sube: lo suyo va entero (y lo pendiente de Y viaja de más, sin daño).
    await a.engine.syncNow();
    await expectSound(a, server, pageId);

    // Llega lo de X: ahora sí se integra todo.
    await a.remote.pushUpdate(pageId, crypto.randomUUID(), updX);
    await a.engine.syncNow();
    await expectSound(a, server, pageId);
    expect((await syncedOf(a, pageId)).get(1001)).toBe(4);
    await write(a, pageId, (t) => t.insert(t.length, '!'));
    await a.engine.syncNow();
    await expectNothingMissing(a, server, pageId);

    const c = await device(server);
    await c.engine.syncNow();
    const text = await read(c, pageId);
    expect(text).toContain('hola mundo');
    expect(text).toContain('mío ');
    expect(text.endsWith('!')).toBe(true);
  });

  it('un update propio que vuelve del servidor cuenta como confirmado y la respuesta perdida se reintenta sin duplicar', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const b = await device(server);
    const pageId = await sharedPage(a, b);

    // A sube, pero la respuesta se pierde: queda la subida en vuelo (`pending`).
    await write(a, pageId, (t) => t.insert(0, 'A1 '));
    server.loseNextPushResponse = true;
    await a.engine.syncNow();
    expect((await a.db.get('docState', pageId))?.pending).toBeDefined();
    // B baja lo de A, escribe y sube.
    await b.engine.syncNow();
    await write(b, pageId, (t) => t.insert(t.length, ' B1'));
    await b.engine.syncNow();
    const count = server.updates.get(pageId)!.length;

    // A baja (le vuelve lo propio y lo de B) con la subida todavía en vuelo, y sigue escribiendo.
    await a.docs.pullPage(pageId, a.remote);
    await expectSound(a, server, pageId);
    expect((await a.db.get('docState', pageId))?.pending).toBeDefined();
    await write(a, pageId, (t) => t.insert(t.length, ' A2'));

    await a.engine.syncNow();
    // El reintento devolvió el mismo `seq` (sin duplicar) y después subió solo A2.
    expect(server.updates.get(pageId)).toHaveLength(count + 1);
    expect(resentInLast(server, pageId)).toBe(0);
    await expectSound(a, server, pageId);
    await expectNothingMissing(a, server, pageId);
    expect(a.engine.getStatus().pendingPages).toBe(0);
    expect((await a.db.get('docState', pageId))?.pending).toBeUndefined();

    const c = await device(server);
    await c.engine.syncNow();
    expect(await read(c, pageId)).toBe('A1 Base. B1 A2');
  });

  it('una subida que no llegó al servidor sigue pendiente aunque se baje lo de otro en el medio', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const b = await device(server);
    const pageId = await sharedPage(a, b);

    // La subida de A se corta antes de llegar (el servidor no la guarda).
    await write(a, pageId, (t) => t.insert(0, 'A1 '));
    const push = a.remote.pushUpdate.bind(a.remote);
    a.remote.pushUpdate = async () => {
      throw new RemoteError('Failed to fetch', false, undefined, true);
    };
    await a.engine.syncNow();
    a.remote.pushUpdate = push;
    const pending = (await a.db.get('docState', pageId))?.pending;
    expect(pending).toBeDefined();

    await write(b, pageId, (t) => t.insert(t.length, ' B1'));
    await b.engine.syncNow();
    await a.docs.pullPage(pageId, a.remote);
    await expectSound(a, server, pageId);
    // Lo de A no figura como confirmado: ninguno de sus autores avanzó.
    const synced = await syncedOf(a, pageId);
    for (const struct of Y.decodeUpdate(pending!.update).structs) {
      expect(synced.get(struct.id.client) ?? 0).toBeLessThanOrEqual(struct.id.clock);
    }

    await a.engine.syncNow();
    await expectNothingMissing(a, server, pageId);
    const c = await device(server);
    await c.engine.syncNow();
    expect(await read(c, pageId)).toBe('A1 Base. B1');
  });

  it('cerrar la app a la mitad: con la subida en vuelo y lo bajado, al volver no falta ni se duplica nada', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const b = await device(server);
    const pageId = await sharedPage(a, b);

    await write(a, pageId, (t) => t.insert(0, 'A1 '));
    server.loseNextPushResponse = true;
    await a.engine.syncNow();
    await write(b, pageId, (t) => t.insert(t.length, ' B1'));
    await b.engine.syncNow();
    await a.docs.pullPage(pageId, a.remote);
    await write(a, pageId, (t) => t.insert(t.length, ' A2'));

    const again = await reopen(a, server);
    await expectSound(again, server, pageId);
    const count = server.updates.get(pageId)!.length;
    await again.engine.syncNow();
    expect(server.updates.get(pageId)).toHaveLength(count + 1);
    expect(resentInLast(server, pageId)).toBe(0);
    await expectNothingMissing(again, server, pageId);
    expect(await read(again, pageId)).toBe('A1 Base. B1 A2');
  });

  it('si la app se cierra antes de guardar lo bajado, el cursor y el vector no cambian', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const b = await device(server);
    const pageId = await sharedPage(a, b);
    await write(a, pageId, (t) => t.insert(0, 'A1 '));
    await write(b, pageId, (t) => t.insert(t.length, ' B1'));
    await b.engine.syncNow();

    const before = await a.db.get('docState', pageId);
    // La app se cierra con lo bajado todavía en memoria, antes de guardarlo.
    const pull = a.remote.pullUpdates.bind(a.remote);
    a.remote.pullUpdates = async (...args) => {
      const updates = await pull(...args);
      a.engine.stop();
      a.db.close();
      return updates;
    };
    await expect(a.docs.pullPage(pageId, a.remote)).rejects.toThrow();

    const again = await reopen(a, server);
    expect(await again.db.get('docState', pageId)).toEqual(before);
    await again.engine.syncNow();
    await expectSound(again, server, pageId);
    await expectNothingMissing(again, server, pageId);
    expect(await read(again, pageId)).toBe('A1 Base. B1');
  });

  it('restaurar una copia: lo bajado antes ya no cuenta y todo vuelve a subir', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const b = await device(server);
    const pageId = await sharedPage(a, b);
    const restore = server.backup();

    // Después de la copia: B escribe y sube; A lo baja (su vector avanza) y escribe.
    await write(b, pageId, (t) => t.insert(t.length, ' B1'));
    await b.engine.syncNow();
    await a.engine.syncNow();
    await write(a, pageId, (t) => t.insert(0, 'A1 '));
    await a.engine.syncNow();

    restore();
    b.engine.stop();
    // Solo A se entera: tiene que volver a subir también lo de B que había bajado.
    await a.engine.syncNow();
    await a.engine.syncNow();
    await expectSound(a, server, pageId);
    await expectNothingMissing(a, server, pageId);
    const c = await device(server);
    await c.engine.syncNow();
    expect(await read(c, pageId)).toBe('A1 Base. B1');
  });

  it('el vector solo avanza por tramos sin huecos desde lo confirmado, y nunca más que lo integrado', () => {
    const doc = new Y.Doc();
    doc.clientID = 7;
    doc.getText('t').insert(0, 'abc');
    const first = Y.encodeStateAsUpdate(doc);
    doc.getText('t').insert(3, 'def');
    const second = Y.encodeStateAsUpdate(doc, Y.encodeStateVector(new Map([[7, 3]])));

    // Solo el segundo tramo: empieza en 3 y no se sabe nada de [0, 3).
    expect(serverReach(undefined, [Y.decodeUpdate(second)]).size).toBe(0);
    // Con [0, 3) confirmado, llega hasta 6.
    expect(serverReach(Y.encodeStateVector(new Map([[7, 3]])), [Y.decodeUpdate(second)])).toEqual(new Map([[7, 6]]));
    // Los dos juntos, en cualquier orden.
    expect(serverReach(undefined, [Y.decodeUpdate(second), Y.decodeUpdate(first)])).toEqual(new Map([[7, 6]]));
    // Unidos con un hueco en el medio (un Skip), no pasa del hueco.
    const gap = Y.mergeUpdates([first, Y.encodeStateAsUpdate(doc, Y.encodeStateVector(new Map([[7, 4]])))]);
    expect(serverReach(undefined, [Y.decodeUpdate(gap)])).toEqual(new Map([[7, 3]]));

    // Tope: lo que el documento local integró.
    const next = advanceSynced(undefined, new Map([[7, 6]]), new Map([[7, 4]]));
    expect(Y.decodeStateVector(next!)).toEqual(new Map([[7, 4]]));
    // Nunca retrocede ni suma autores que el documento no tiene.
    const kept = Y.encodeStateVector(new Map([[7, 5]]));
    expect(advanceSynced(kept, new Map([[7, 6], [8, 2]]), new Map([[7, 4]]))).toBe(kept);
    doc.destroy();
  });
});

/** Números al azar repetibles. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('B.2 al azar', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`el vector confirmado nunca dice más que el servidor, y al final no falta nada (semilla ${seed})`, async () => {
      const rnd = random(seed);
      const pick = <T>(list: T[]): T => list[Math.floor(rnd() * list.length)];
      const server = new FakeServer();
      let list = [await device(server), await device(server), await device(server)];
      const pageId = await list[0].tree.create(null, 'P');
      await list[0].engine.syncNow();
      for (const d of list.slice(1)) await d.engine.syncNow();

      for (let step = 0; step < 40; step++) {
        const i = Math.floor(rnd() * list.length);
        const d = list[i];
        const action = rnd();
        try {
          if (action < 0.35) {
            await write(d, pageId, (t) => {
              if (t.length > 4 && rnd() < 0.25) t.delete(Math.floor(rnd() * (t.length - 2)), 2);
              else t.insert(Math.floor(rnd() * (t.length + 1)), `${i}${step} `);
            });
          } else if (action < 0.5) {
            await d.docs.pullPage(pageId, d.remote);
          } else if (action < 0.6) {
            server.loseNextPushResponse = true;
            await d.docs.pushPage(pageId, d.remote);
          } else if (action < 0.7) {
            await d.docs.pushPage(pageId, d.remote);
          } else if (action < 0.8) {
            server.online = pick([true, true, false]);
          } else if (action < 0.87) {
            list[i] = await reopen(d, server);
          } else {
            await d.engine.syncNow();
          }
        } catch {
          // Sin red o respuesta perdida: se sigue.
        }
        server.loseNextPushResponse = false;
        for (const each of list) await expectSound(each, server, pageId);
      }

      server.online = true;
      for (let round = 0; round < 2; round++) for (const d of list) await d.engine.syncNow();
      const expected = serverDoc(server, pageId).getText('t').toString();
      for (const d of list) {
        await expectSound(d, server, pageId);
        await expectNothingMissing(d, server, pageId);
        expect(await read(d, pageId)).toBe(expected);
        expect(d.engine.getStatus().pendingPages).toBe(0);
      }
      list = [];
    });
  }
});

describe('B.3: abrir una página vacía no crea un cambio', () => {
  /** Escribe en el párrafo de la semilla, como el editor. */
  function typeInSeed(doc: Y.Doc, text: string): void {
    // En una sola transacción, como cada tecla en el editor.
    doc.transact(() => {
      const group = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
      const paragraph = (group.get(0) as Y.XmlElement).get(0) as Y.XmlElement;
      let node = paragraph.get(0) as Y.XmlText | undefined;
      if (!node) {
        node = new Y.XmlText();
        paragraph.insert(0, [node]);
      }
      node.insert(node.length, text);
    });
  }

  it('abrir una página vacía sin escribir no deja nada pendiente ni sube nada', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const pageId = await a.tree.create(null, 'Vacía');
    await a.engine.syncNow();

    const doc = await a.docs.open(pageId, { seed: true });
    // La raíz está (el editor la necesita), pero solo en memoria.
    expect(doc.getXmlFragment(CONTENT_FRAGMENT).length).toBe(1);
    await a.docs.flush(pageId);
    expect(a.docs.hasUnsavedEdits()).toBe(false);
    expect(await a.db.countFromIndex('docUpdates', 'pageId', pageId)).toBe(0);
    expect(await a.docs.unsyncedPages()).toEqual([]);
    a.docs.close(pageId);
    await a.engine.syncNow();
    expect(a.engine.getStatus().pendingPages).toBe(0);
    expect(server.updates.get(pageId) ?? []).toHaveLength(0);

    // Abrir de nuevo pone otra vez la misma raíz.
    const again = await a.docs.open(pageId, { seed: true });
    expect(again.getXmlFragment(CONTENT_FRAGMENT).length).toBe(1);
    a.docs.close(pageId);
  });

  it('la semilla se guarda con la primera edición, en la misma transacción, y sube con ella', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const pageId = await a.tree.create(null, 'P');
    await a.engine.syncNow();

    const doc = await a.docs.open(pageId, { seed: true });
    typeInSeed(doc, 'hola');
    await a.docs.flush(pageId);
    // Una sola fila: la semilla y la edición juntas.
    expect(await a.db.countFromIndex('docUpdates', 'pageId', pageId)).toBe(1);
    typeInSeed(doc, ' mundo');
    await a.docs.flush(pageId);
    a.docs.close(pageId);

    // Al volver a abrir, lo escrito se ve (no quedó colgado de una raíz que no se guardó).
    const again = await reopen(a, server);
    const reloaded = await again.docs.open(pageId);
    expect(reloaded.getXmlFragment(CONTENT_FRAGMENT).length).toBe(1);
    expect(reloaded.getXmlFragment(CONTENT_FRAGMENT).toString()).toContain('hola mundo');
    expect(reloaded.store.pendingStructs).toBeNull();
    again.docs.close(pageId);

    await again.engine.syncNow();
    expect(server.updates.get(pageId)).toHaveLength(1);
    const c = await device(server);
    await c.engine.syncNow();
    const fromServer = await c.docs.open(pageId);
    expect(fromServer.getXmlFragment(CONTENT_FRAGMENT).toString()).toContain('hola mundo');
    expect(stateVector(fromServer).get(seedClientId(pageId))).toBeGreaterThan(0);
    c.docs.close(pageId);
  });

  it('si guardar falla, la semilla y la edición se reintentan juntas', async () => {
    const server = new FakeServer();
    const dbName = crypto.randomUUID();
    const a = await device(server, dbName);
    const pageId = await a.tree.create(null, 'P');
    await a.engine.syncNow();

    const realTransaction = a.db.transaction.bind(a.db);
    let failing = true;
    (a.db as { transaction: unknown }).transaction = ((stores: string | string[], mode?: IDBTransactionMode) => {
      const names = [stores].flat();
      if (failing && mode === 'readwrite' && names.includes('docUpdates') && names.includes('docState')) {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }
      return realTransaction(stores as never, mode);
    }) as never;
    const doc = await a.docs.open(pageId, { seed: true });
    typeInSeed(doc, 'importante');
    await a.docs.flush(pageId);
    expect(a.docs.hasUnsavedEdits()).toBe(true);
    failing = false;
    typeInSeed(doc, '!');
    await a.docs.flush(pageId);
    expect(a.docs.hasUnsavedEdits()).toBe(false);
    a.docs.close(pageId);

    const again = await reopen(a, server);
    const reloaded = await again.docs.open(pageId);
    expect(reloaded.getXmlFragment(CONTENT_FRAGMENT).toString()).toContain('importante!');
    expect(reloaded.store.pendingStructs).toBeNull();
    again.docs.close(pageId);
  });

  it('dos dispositivos que empiezan la misma página sin red siguen compartiendo la raíz', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const b = await device(server);
    const pageId = await a.tree.create(null, 'P');
    await a.engine.syncNow();
    await b.engine.syncNow();

    server.online = false;
    const docA = await a.docs.open(pageId, { seed: true });
    const docB = await b.docs.open(pageId, { seed: true });
    typeInSeed(docA, 'de A');
    typeInSeed(docB, 'de B');
    await a.docs.flush(pageId);
    await b.docs.flush(pageId);
    server.online = true;
    await a.engine.syncNow();
    // B baja lo de A antes de subir: tenía la misma semilla, así que no la vuelve a mandar.
    await b.docs.pullPage(pageId, b.remote);
    await b.engine.syncNow();
    expect(resentInLast(server, pageId)).toBe(0);
    await a.engine.syncNow();

    for (const doc of [docA, docB]) {
      expect(doc.getXmlFragment(CONTENT_FRAGMENT).length).toBe(1);
      expect(doc.getXmlFragment(CONTENT_FRAGMENT).toString()).toContain('de A');
      expect(doc.getXmlFragment(CONTENT_FRAGMENT).toString()).toContain('de B');
    }
    a.docs.close(pageId);
    b.docs.close(pageId);
    await expectNothingMissing(a, server, pageId);
    await expectNothingMissing(b, server, pageId);
  });

  it('con la semilla solo en memoria, lo que llega de otro se ve y la primera edición se guarda bien', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const b = await device(server);
    const pageId = await a.tree.create(null, 'P');
    await a.engine.syncNow();
    await b.engine.syncNow();

    const docA = await a.docs.open(pageId, { seed: true });
    const docB = await b.docs.open(pageId, { seed: true });
    typeInSeed(docB, 'B escribe primero');
    await b.docs.flush(pageId);
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect(docA.getXmlFragment(CONTENT_FRAGMENT).length).toBe(1);
    expect(docA.getXmlFragment(CONTENT_FRAGMENT).toString()).toContain('B escribe primero');

    typeInSeed(docA, ' y A sigue');
    await a.docs.flush(pageId);
    a.docs.close(pageId);
    b.docs.close(pageId);
    await a.engine.syncNow();
    expect(resentInLast(server, pageId)).toBe(0);

    const again = await reopen(a, server);
    const reloaded = await again.docs.open(pageId);
    expect(reloaded.getXmlFragment(CONTENT_FRAGMENT).toString()).toContain('B escribe primero y A sigue');
    again.docs.close(pageId);
    await expectNothingMissing(again, server, pageId);
  });
});
