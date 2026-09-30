import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { PageDocs as PublishedPageDocs } from './fixtures/publishedDocs';
import { openLocalDb as openPublishedDb } from './fixtures/publishedLocalDb';
import { dirtyKey, type LocalDb } from './localDb';
import { mergeRootGroups, seedIfEmpty } from './structure';
import { FakeRemote, FakeServer, makeDevice, microtasks, watchTransactions, type Device } from './testing';

// La misma base local con la versión publicada de la app (fixtures/publishedDocs.ts, copia de v0.029): una
// pestaña que no se recargó, o volver a la versión anterior. Esa versión solo mira `version > ackedVersion`
// para saber qué falta subir; la actual guarda cada edición con una marca en `meta` y suma la versión
// aparte, así que tiene que dejar siempre la versión por encima mientras haya algo sin subir (la guardia).

interface Published {
  db: LocalDb;
  docs: PublishedPageDocs;
  remote: FakeRemote;
}

const devices: Device[] = [];
const published: Published[] = [];
async function device(server: FakeServer, dbName?: string): Promise<Device> {
  const d = await makeDevice(server, dbName);
  devices.push(d);
  return d;
}

async function openPublished(server: FakeServer, dbName: string): Promise<Published> {
  const db = (await openPublishedDb(dbName)) as unknown as LocalDb;
  const p = { db, docs: new PublishedPageDocs(db as never, { normalize: mergeRootGroups, seed: seedIfEmpty }), remote: new FakeRemote(server, '0.029') };
  published.push(p);
  return p;
}

/** Lo que hace con el contenido el ciclo de la versión publicada: sube lo pendiente y baja. */
async function publishedSync(p: Published, pageIds: string[]): Promise<void> {
  for (const pageId of await p.docs.unsyncedPages()) await p.docs.pushPage(pageId, p.remote);
  for (const pageId of pageIds) await p.docs.pullPage(pageId, p.remote);
}

afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
  }
  for (const p of published.splice(0)) p.db.close();
});

function serverText(server: FakeServer, pageId: string): string {
  const doc = new Y.Doc();
  const list = server.updates.get(pageId) ?? [];
  if (list.length > 0) Y.applyUpdate(doc, Y.mergeUpdates(list.map((u) => u.data)));
  const text = doc.getText('t').toString();
  doc.destroy();
  return text;
}

async function readText(docs: { open(id: string): Promise<Y.Doc>; close(id: string): void }, pageId: string): Promise<string> {
  const doc = await docs.open(pageId);
  const text = doc.getText('t').toString();
  docs.close(pageId);
  return text;
}

/** Escribe y la app se cierra enseguida: la edición queda guardada, la suma de su versión no. */
async function writeAndKill(d: Device, doc: Y.Doc, text: string): Promise<void> {
  const watch = watchTransactions();
  try {
    doc.getText('t').insert(doc.getText('t').length, text);
    await microtasks();
    await watch.kill(d);
  } finally {
    watch.restore();
  }
}

describe('la misma base con la versión publicada', () => {
  it('cerrar justo después de escribir: la versión publicada lo ve pendiente y lo sube', async () => {
    const server = new FakeServer();
    const dbName = crypto.randomUUID();
    const a = await device(server, dbName);
    const pageId = await a.tree.create(null, 'P');
    await a.engine.syncNow();
    await writeAndKill(a, await a.docs.open(pageId), 'últimas teclas');

    const old = await openPublished(server, dbName);
    expect(await readText(old.docs, pageId)).toBe('últimas teclas');
    expect(await old.docs.unsyncedPages()).toEqual([pageId]);
    await publishedSync(old, [pageId]);
    expect(serverText(server, pageId)).toBe('últimas teclas');
    old.db.close();

    // Al volver, la actual borra la marca y no queda nada pendiente.
    const again = await device(server, dbName);
    await again.engine.syncNow();
    expect(await again.db.get('meta', dirtyKey(pageId))).toBeUndefined();
    expect(again.engine.getStatus().pendingPages).toBe(0);
  });

  for (const openWhenPushed of [true, false]) {
    it(`un envío en vuelo, una edición que no entra en él y la app que se cierra: la publicada confirma el envío y sigue viendo pendiente la edición (página ${openWhenPushed ? 'abierta' : 'cerrada'} al armarlo)`, async () => {
      const server = new FakeServer();
      const dbName = crypto.randomUUID();
      const a = await device(server, dbName);
      const pageId = await a.tree.create(null, 'P');
      await a.engine.syncNow();
      let doc = await a.docs.open(pageId);
      doc.getText('t').insert(0, 'A');
      await a.docs.flush(pageId);
      if (!openWhenPushed) a.docs.close(pageId);
      // El envío llega al servidor pero la respuesta se pierde: queda en vuelo.
      server.loseNextPushResponse = true;
      await a.docs.pushPage(pageId, a.remote).catch(() => undefined);
      expect((await a.db.get('docState', pageId))?.pending).toBeDefined();
      if (!openWhenPushed) doc = await a.docs.open(pageId);
      await writeAndKill(a, doc, ' B');

      const old = await openPublished(server, dbName);
      await publishedSync(old, [pageId]);
      // El envío (A) se confirmó con la versión publicada y la edición (B) igual subió.
      expect(serverText(server, pageId)).toBe('A B');
      old.db.close();
      const again = await device(server, dbName);
      await again.engine.syncNow();
      expect(again.engine.getStatus().pendingPages).toBe(0);
    });
  }

  it('la publicada escribe y sube con un envío pendiente de la actual (con su marca): la actual queda al día sin perder nada', async () => {
    const server = new FakeServer();
    const dbName = crypto.randomUUID();
    const a = await device(server, dbName);
    const pageId = await a.tree.create(null, 'P');
    await a.engine.syncNow();
    let doc = await a.docs.open(pageId);
    doc.getText('t').insert(0, 'N1');
    await a.docs.flush(pageId);
    server.loseNextPushResponse = true;
    await a.engine.syncNow().catch(() => undefined);
    expect((await a.db.get('docState', pageId))?.pending?.dirty).toBeTypeOf('string');
    doc.getText('t').insert(2, ' N2');
    await a.docs.flush(pageId);
    a.docs.close(pageId);
    await a.docs.flush();
    a.engine.stop();
    a.db.close();

    const old = await openPublished(server, dbName);
    doc = await old.docs.open(pageId);
    doc.getText('t').insert(doc.getText('t').length, ' L1');
    await old.docs.flush(pageId);
    old.docs.close(pageId);
    await publishedSync(old, [pageId]);
    old.db.close();

    const b = await device(server, dbName);
    await b.engine.syncNow();
    await b.engine.syncNow();
    expect(b.engine.getStatus().pendingPages).toBe(0);
    expect(serverText(server, pageId)).toBe('N1 N2 L1');
  });

  it('la guardia no hace subir nada de más en la versión actual', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const pageId = await a.tree.create(null, 'P');
    await a.engine.syncNow();
    const doc = await a.docs.open(pageId);
    // Abrir arma la guardia: para la publicada queda pendiente, para esta no.
    const state = (await a.db.get('docState', pageId))!;
    expect(state.version).toBeGreaterThan(state.ackedVersion);
    expect(state.guardVersion).toBe(state.version);
    expect(await a.docs.unsyncedPages()).toEqual([]);
    doc.getText('t').insert(0, 'uno');
    await a.docs.flush(pageId);
    await a.engine.syncNow();
    const after = (await a.db.get('docState', pageId))!;
    // Confirmado con la página abierta: la guardia se vuelve a armar.
    expect(after.version).toBeGreaterThan(after.ackedVersion);
    expect(after.guardVersion).toBe(after.version);
    const rows = server.updates.get(pageId)!.length;
    await a.engine.syncNow();
    expect(server.updates.get(pageId)).toHaveLength(rows);
    expect(a.engine.getStatus().pendingPages).toBe(0);
    a.docs.close(pageId);
  });

  it('restaurar una copia no queda escondido detrás de la guardia', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const pageId = await a.tree.create(null, 'P');
    await a.engine.syncNow();
    const doc = await a.docs.open(pageId);
    doc.getText('t').insert(0, 'antes y después');
    await a.docs.flush(pageId);
    await a.engine.syncNow();
    expect((await a.db.get('docState', pageId))?.guardVersion).toBeDefined();
    // Lo que hace el motor al ver una generación nueva: todo vuelve a subir entero.
    await a.docs.resetForRestore();
    expect(await a.docs.unsyncedPages()).toEqual([pageId]);
    a.docs.close(pageId);
  });
});
