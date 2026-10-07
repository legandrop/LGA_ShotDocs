import { afterAll, afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { knownDeletes } from './docs';
import {
  buildUpload,
  encodeRanges,
  rangesContain,
  rangesOf,
  subtractRanges,
  unionRanges,
  type DeleteRanges,
} from './deleteSets';
import { PageDocs as MainPageDocs } from './fixtures/mainDocs';
import { PageDocs as PublishedPageDocs } from './fixtures/publishedDocs';
import { openLocalDb as openPublishedDb } from './fixtures/publishedLocalDb';
import { GENERATION_KEY, openLocalDb, storedGeneration, type LocalDb } from './localDb';
import { mergeRootGroups, normalizeStructure, seedIfEmpty } from './structure';
import { FakeRemote, FakeServer, makeDevice, microtasks, watchTransactions, type Device } from './testing';

// Roadmap B.15: cada subida de contenido llevaba todos los borrados de la página (el "delete set" de Yjs).
// Ahora lleva solo los que el servidor no tiene (`DocState.syncedDS`). La regla que se prueba: `syncedDS` nunca
// dice que el servidor tiene un borrado que no tiene, así que **ningún borrado propio se deja de subir** (si
// no, el borrado "vuelve" en los demás dispositivos). Lo subido tiene que crecer con lo nuevo, no con la
// historia. Ver Docs/Doc_Sincronizacion.md, "Subir solo los borrados nuevos".

const devices: Device[] = [];
async function device(server: FakeServer, dbName?: string): Promise<Device> {
  const d = await makeDevice(server, dbName);
  devices.push(d);
  return d;
}

/** Las versiones anteriores que se prueban: la publicada hoy (main v0.082) y la v0.029. */
type OldVersion = 'main' | 'v0.029';
const OLD_VERSIONS: OldVersion[] = ['main', 'v0.029'];
interface Published {
  db: LocalDb;
  docs: MainPageDocs | PublishedPageDocs;
  remote: FakeRemote;
}
const published: Published[] = [];
/**
 * Una versión anterior sobre la misma base (fixtures/mainDocs.ts, la publicada hoy, o fixtures/publishedDocs.ts,
 * la v0.029): ninguna conoce `syncedDS`.
 */
async function openPublished(server: FakeServer, dbName: string, version: OldVersion = 'main'): Promise<Published> {
  let p: Published;
  if (version === 'main') {
    const db = await openLocalDb(dbName);
    p = { db, docs: new MainPageDocs(db, { normalize: normalizeStructure, seed: seedIfEmpty }), remote: new FakeRemote(server, '0.082') };
  } else {
    const db = (await openPublishedDb(dbName)) as unknown as LocalDb;
    p = {
      db,
      docs: new PublishedPageDocs(db as never, { normalize: mergeRootGroups, seed: seedIfEmpty }),
      remote: new FakeRemote(server, '0.029'),
    };
  }
  published.push(p);
  return p;
}

/**
 * Lo que hace con el contenido el ciclo de una versión publicada: si la generación cambió, restaura como
 * ella (borra `syncedSV` y lo demás, pero no `syncedDS`, que no conoce) y guarda la generación nueva; después
 * sube lo pendiente y baja. Con `pushAndPull` en false, se corta después de restaurar (la app se cierra).
 */
async function publishedSync(p: Published, server: FakeServer, pageIds: string[], pushAndPull = true): Promise<void> {
  const generation = server.settings!.generation;
  if (storedGeneration(await p.db.get('meta', GENERATION_KEY)) !== generation) {
    await p.docs.resetForRestore();
    await p.db.put('meta', generation, GENERATION_KEY);
  }
  if (!pushAndPull) return;
  for (const pageId of await p.docs.unsyncedPages()) await p.docs.pushPage(pageId, p.remote);
  for (const pageId of pageIds) await p.docs.pullPage(pageId, p.remote);
}

// Lo que queda corriendo en un dispositivo "matado" choca con la base cerrada.
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
  for (const p of published.splice(0)) {
    try {
      p.db.close();
    } catch {
      // ya cerrada
    }
  }
});

type Docs = { open(id: string): Promise<Y.Doc>; close(id: string): void; flush(id?: string): Promise<void> };

async function write(d: { docs: unknown }, pageId: string, fn: (text: Y.Text) => void): Promise<void> {
  const docs = d.docs as Docs;
  const doc = await docs.open(pageId);
  fn(doc.getText('t'));
  await docs.flush(pageId);
  docs.close(pageId);
}

async function read(d: { docs: unknown }, pageId: string): Promise<string> {
  const docs = d.docs as Docs;
  const doc = await docs.open(pageId);
  const text = doc.getText('t').toString();
  docs.close(pageId);
  return text;
}

/** Bytes de cada subida de la página, en orden. */
function uploadSizes(server: FakeServer, pageId: string): number[] {
  return (server.updates.get(pageId) ?? []).map((u) => u.data.length);
}

const average = (list: number[]): number => list.reduce((a, b) => a + b, 0) / list.length;

/** Todos los borrados que tiene el servidor de la página (la suma de los de cada fila). */
function serverDeletes(server: FakeServer, pageId: string): DeleteRanges {
  return (server.updates.get(pageId) ?? []).reduce<DeleteRanges>((acc, u) => unionRanges(acc, rangesOf(u.data)), new Map());
}

function serverDoc(server: FakeServer, pageId: string): Y.Doc {
  const doc = new Y.Doc();
  const list = server.updates.get(pageId) ?? [];
  if (list.length > 0) Y.applyUpdate(doc, Y.mergeUpdates(list.map((u) => u.data)));
  return doc;
}

/** Lo guardado en la base del dispositivo, armado con Yjs (sin PageDocs). */
async function savedDoc(db: LocalDb, pageId: string): Promise<Y.Doc> {
  const rows = await db.getAllFromIndex('docUpdates', 'pageId', pageId);
  const doc = new Y.Doc();
  if (rows.length > 0) Y.applyUpdate(doc, Y.mergeUpdates(rows.map((r) => r.data)));
  return doc;
}

/** `syncedDS` (si vale para la generación guardada) no dice más de lo que tiene el servidor. */
async function expectDeletesSound(db: LocalDb, server: FakeServer, pageId: string, label = ''): Promise<void> {
  const generation = storedGeneration(await db.get('meta', GENERATION_KEY));
  // Antes de enterarse de una restauración, el dispositivo cree (con razón, hasta ahí) lo de antes: lo arregla
  // el motor al ver la generación nueva (vuelve a subir todo). Como con `syncedSV`.
  if (generation !== server.settings!.generation) return;
  const state = await db.get('docState', pageId);
  const known = state ? knownDeletes(state, generation) : undefined;
  if (!known) return;
  const missing = subtractRanges(rangesOf(known), serverDeletes(server, pageId));
  expect([...missing], `syncedDS dice de más ${label}`).toEqual([]);
}

/** Al servidor no le falta ningún elemento ni ningún borrado de lo guardado en el dispositivo. */
async function expectNothingMissing(db: LocalDb, server: FakeServer, pageId: string): Promise<void> {
  const local = await savedDoc(db, pageId);
  const srv = serverDoc(server, pageId);
  const has = Y.decodeStateVector(Y.encodeStateVector(srv));
  for (const [client, clock] of Y.decodeStateVector(Y.encodeStateVector(local))) {
    expect(has.get(client) ?? 0, `autor ${client}`).toBeGreaterThanOrEqual(clock);
  }
  const missing = subtractRanges(rangesOf(Y.encodeStateAsUpdate(local)), serverDeletes(server, pageId));
  expect([...missing], 'borrados del dispositivo que el servidor no tiene').toEqual([]);
  expect(srv.getText('t').toString()).toBe(local.getText('t').toString());
  local.destroy();
  srv.destroy();
}

/** Números al azar repetibles (mulberry32). */
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

describe('B.15: las cuentas de los borrados', () => {
  it('el delete set se escribe igual que Yjs, byte a byte', () => {
    const rnd = random(11);
    for (let round = 0; round < 30; round++) {
      const docs = [new Y.Doc(), new Y.Doc(), new Y.Doc()];
      for (let step = 0; step < 40; step++) {
        const doc = docs[Math.floor(rnd() * docs.length)];
        const t = doc.getText('t');
        if (t.length > 3 && rnd() < 0.4) t.delete(Math.floor(rnd() * (t.length - 2)), 1 + Math.floor(rnd() * 2));
        else t.insert(Math.floor(rnd() * (t.length + 1)), 'xyz'.slice(0, 1 + Math.floor(rnd() * 3)));
        // Se cruzan lo que tienen, para que haya borrados de varios autores.
        const other = docs[Math.floor(rnd() * docs.length)];
        if (other !== doc && rnd() < 0.5) Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
      }
      for (const doc of docs) {
        // Sin elementos (vector de estado al día), Yjs escribe solo el delete set.
        const onlyDeletes = Y.encodeStateAsUpdate(doc, Y.encodeStateVector(doc));
        expect(encodeRanges(rangesOf(onlyDeletes))).toEqual(onlyDeletes);
        doc.destroy();
      }
    }
  });

  it('restar, sumar y contener dan lo mismo que con conjuntos de relojes', () => {
    const rnd = random(5);
    const randomRanges = (): DeleteRanges => {
      const out: DeleteRanges = new Map();
      for (const client of [1, 2, 3]) {
        if (rnd() < 0.3) continue;
        const list: [number, number][] = [];
        for (let i = 0; i < 1 + Math.floor(rnd() * 4); i++) {
          const from = Math.floor(rnd() * 40);
          list.push([from, from + 1 + Math.floor(rnd() * 8)]);
        }
        out.set(client, list);
      }
      return out;
    };
    const set = (r: DeleteRanges): Set<string> => {
      const out = new Set<string>();
      for (const [client, list] of r) for (const [from, to] of list) for (let c = from; c < to; c++) out.add(`${client}:${c}`);
      return out;
    };
    for (let i = 0; i < 500; i++) {
      const a = randomRanges();
      const b = randomRanges();
      const sa = set(a);
      const sb = set(b);
      expect(set(subtractRanges(unionRanges(a, new Map()), unionRanges(b, new Map())))).toEqual(new Set([...sa].filter((x) => !sb.has(x))));
      expect(set(unionRanges(a, b))).toEqual(new Set([...sa, ...sb]));
      expect(rangesContain(a, b)).toBe([...sb].every((x) => sa.has(x)));
    }
  });

  it('lo armado, sumado a lo que tiene el servidor, es todo el documento (también con cosas pendientes de Yjs)', () => {
    const rnd = random(23);
    for (let round = 0; round < 200; round++) {
      const author = new Y.Doc();
      const t = author.getText('t');
      const updates: Uint8Array[] = [];
      author.on('update', (u: Uint8Array) => updates.push(u));
      for (let step = 0; step < 25; step++) {
        if (t.length > 3 && rnd() < 0.45) t.delete(Math.floor(rnd() * (t.length - 2)), 1 + Math.floor(rnd() * 3));
        else t.insert(Math.floor(rnd() * (t.length + 1)), 'ab');
      }
      // "El servidor" tiene una parte de los updates; el dispositivo tiene otra parte (con huecos: Yjs deja
      // pendiente lo que depende de algo que falta).
      const serverHas = updates.filter(() => rnd() < 0.5);
      const deviceHas = updates.filter(() => rnd() < 0.7);
      const server = new Y.Doc();
      if (serverHas.length > 0) Y.applyUpdate(server, Y.mergeUpdates(serverHas));
      const device = new Y.Doc();
      if (deviceHas.length > 0) Y.applyUpdate(device, Y.mergeUpdates(deviceHas));
      const serverUpdate = Y.encodeStateAsUpdate(server);
      // Lo que el dispositivo cree que tiene el servidor: a veces nada, a veces una parte de lo que tiene.
      const known = rnd() < 0.2 ? undefined : encodeRanges(subtractRanges(rangesOf(serverUpdate), new Map(rnd() < 0.5 ? [] : [[author.clientID, [[0, 3]]]])));
      const sv = rnd() < 0.5 ? Y.encodeStateVector(server) : undefined;
      const upload = buildUpload(device, sv, known);
      // El servidor con lo subido tiene todo lo del dispositivo.
      const after = Y.mergeUpdates([serverUpdate, upload.update]);
      expect(rangesContain(rangesOf(after), rangesOf(Y.encodeStateAsUpdate(device)))).toBe(true);
      const check = new Y.Doc();
      Y.applyUpdate(check, after);
      Y.applyUpdate(check, Y.encodeStateAsUpdate(device));
      const merged = new Y.Doc();
      Y.applyUpdate(merged, after);
      expect(merged.getText('t').toString()).toBe(check.getText('t').toString());
      // Y lo que dice que lleva es lo que lleva.
      expect(rangesOf(upload.ds)).toEqual(rangesOf(upload.update));
      for (const d of [author, server, device, check, merged]) d.destroy();
    }
  });
});

describe('B.15: cada subida lleva solo los borrados nuevos', () => {
  it('200 ediciones con borrados: lo subido no crece con la historia', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const pageId = await a.tree.create(null, 'P');
    await write(a, pageId, (t) => t.insert(0, 'Plano general de la calle, de noche, con lluvia. '.repeat(4)));
    await a.engine.syncNow();

    const EDITS = 200;
    for (let i = 0; i < EDITS; i++) {
      // Cada edición abre la página (un autor de Yjs nuevo, como cada sesión de la app), escribe y borra.
      await write(a, pageId, (t) => {
        t.insert((i * 7) % t.length, `toma ${i} `);
        t.delete((i * 13) % (t.length - 4), 3);
      });
      await a.engine.syncNow();
    }

    const sizes = uploadSizes(server, pageId).slice(1);
    expect(sizes).toHaveLength(EDITS);
    const first = average(sizes.slice(0, 20));
    const last = average(sizes.slice(-20));
    console.log(
      `B.15 subidas: primeras 20 ${first.toFixed(0)} B, últimas 20 ${last.toFixed(0)} B, total ${sizes.reduce((x, y) => x + y, 0)} B`,
    );
    // Lo de cada edición (una palabra, un borrado y un autor nuevo) pesa unas decenas de bytes. Con los
    // borrados repetidos, la subida 200 llevaba los 200 borrados anteriores (unos 930 B de promedio en las
    // últimas 20, medido antes del cambio).
    expect(last).toBeLessThan(first * 1.5);
    expect(last).toBeLessThan(120);

    // Y no se perdió nada: un dispositivo nuevo arma lo mismo que el que escribió.
    await expectNothingMissing(a.db, server, pageId);
    const c = await device(server);
    await c.engine.syncNow();
    expect(await read(c, pageId)).toBe(await read(a, pageId));
  });

  it('el mismo guion con la versión publicada y con esta: el peso de page_updates de la página', async () => {
    // Sesiones de 60 subidas (cada sesión, un autor de Yjs nuevo, como abrir la página), con borrados en casi
    // todas. La versión publicada (fixtures/publishedDocs.ts) sube todos los borrados en cada subida.
    // Más ediciones: DELETES_MEASURE_EDITS=2000 npx vitest run src/sync/uploadDeletes.test.ts -t guion
    const EDITS = Number(process.env.DELETES_MEASURE_EDITS ?? 300);
    const totals: Record<string, { total: number; last20: number; first20: number; text: string }> = {};
    for (const kind of ['publicada', 'esta'] as const) {
      const server = new FakeServer();
      const dbName = crypto.randomUUID();
      const a = await device(server, dbName);
      const pageId = await a.tree.create(null, 'P');
      await a.engine.syncNow();
      a.engine.stop();
      a.db.close();
      const docs = kind === 'esta' ? (await device(server, dbName)).docs : (await openPublished(server, dbName)).docs;
      const remote = kind === 'esta' ? devices[devices.length - 1].remote : published[published.length - 1].remote;
      const rnd = random(99);
      let doc = await docs.open(pageId);
      doc.getText('t').insert(0, 'Plano general de la calle, de noche, con lluvia. Cámara A en grúa, B en mano. ');
      await docs.flush(pageId);
      await docs.pushPage(pageId, remote);
      for (let i = 0; i < EDITS; i++) {
        if (i % 60 === 0) {
          docs.close(pageId);
          await docs.flush(pageId);
          await new Promise((r) => setTimeout(r, 0));
          doc = await docs.open(pageId);
        }
        const t = doc.getText('t');
        t.insert(Math.floor(rnd() * (t.length + 1)), ` toma ${i}`);
        if (rnd() < 0.85 && t.length > 20) t.delete(Math.floor(rnd() * (t.length - 6)), 1 + Math.floor(rnd() * 4));
        await docs.flush(pageId);
        await docs.pushPage(pageId, remote);
      }
      docs.close(pageId);
      const sizes = uploadSizes(server, pageId);
      const srv = serverDoc(server, pageId);
      totals[kind] = {
        total: sizes.reduce((x, y) => x + y, 0),
        first20: average(sizes.slice(1, 21)),
        last20: average(sizes.slice(-20)),
        text: srv.getText('t').toString(),
      };
      srv.destroy();
    }
    const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
    console.log(
      `B.15 guion de ${EDITS} subidas: publicada ${kb(totals.publicada.total)} (últimas 20: ${totals.publicada.last20.toFixed(0)} B), ` +
        `esta ${kb(totals.esta.total)} (últimas 20: ${totals.esta.last20.toFixed(0)} B)`,
    );
    // Las dos versiones escriben lo mismo (mismas semillas): el servidor arma el mismo texto.
    expect(totals.esta.text).toBe(totals.publicada.text);
    expect(totals.esta.total).toBeLessThan(totals.publicada.total / 3);
    expect(totals.esta.last20).toBeLessThan(totals.esta.first20 * 2);
  }, 120_000);

  it('lo bajado de otro no se vuelve a subir: los borrados de B no viajan en la subida de A', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const b = await device(server);
    const pageId = await a.tree.create(null, 'P');
    await write(a, pageId, (t) => t.insert(0, 'uno dos tres cuatro cinco seis siete ocho'));
    await a.engine.syncNow();
    await b.engine.syncNow();
    await write(b, pageId, (t) => t.delete(0, 4));
    await b.engine.syncNow();
    await a.engine.syncNow();
    const bDeletes = rangesOf(server.updates.get(pageId)!.at(-1)!.data);
    expect(bDeletes.size).toBeGreaterThan(0);
    await write(a, pageId, (t) => t.delete(t.length - 5, 5));
    await a.engine.syncNow();
    const last = rangesOf(server.updates.get(pageId)!.at(-1)!.data);
    expect(subtractRanges(last, bDeletes)).toEqual(last);
    for (const d of [a, b]) {
      await d.engine.syncNow();
      await expectDeletesSound(d.db, server, pageId);
      await expectNothingMissing(d.db, server, pageId);
    }
    expect(await read(b, pageId)).toBe('dos tres cuatro cinco seis siete');
  });

  it('restaurar una copia: los borrados que ya estaban confirmados vuelven a subir', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const pageId = await a.tree.create(null, 'P');
    await write(a, pageId, (t) => t.insert(0, 'abcdefgh'));
    await a.engine.syncNow();
    const restore = server.backup();
    await write(a, pageId, (t) => t.delete(2, 2));
    await a.engine.syncNow();
    expect((await a.db.get('docState', pageId))?.syncedDS).toBeDefined();

    restore();
    // El servidor perdió el borrado; el dispositivo lo ve en la generación nueva y sube todo de nuevo.
    await a.engine.syncNow();
    await a.engine.syncNow();
    await expectDeletesSound(a.db, server, pageId);
    await expectNothingMissing(a.db, server, pageId);
    const c = await device(server);
    await c.engine.syncNow();
    expect(await read(c, pageId)).toBe('abefgh');
  });

  for (const version of OLD_VERSIONS) {
    it(`una versión anterior restaura una copia y se cierra antes de subir: la actual sube igual los borrados (la generación) (${version})`, async () => {
      const server = new FakeServer();
      const dbName = crypto.randomUUID();
      const a = await device(server, dbName);
      const pageId = await a.tree.create(null, 'P');
      await write(a, pageId, (t) => t.insert(0, 'abcdefgh'));
      await a.engine.syncNow();
      const restore = server.backup();
      await write(a, pageId, (t) => t.delete(2, 2));
      await a.engine.syncNow();
      a.engine.stop();
      a.db.close();

      restore();
      // La versión anterior ve la generación nueva: borra `syncedSV` (no conoce `syncedDS`), guarda la
      // generación y la app se cierra antes de subir nada.
      const old = await openPublished(server, dbName, version);
      await publishedSync(old, server, [pageId], false);
      expect((await old.db.get('docState', pageId))?.syncedSV).toBeUndefined();
      expect((await old.db.get('docState', pageId))?.syncedDS).toBeDefined();
      old.db.close();

      // La actual no vuelve a restaurar (la generación ya está guardada), pero no confía en `syncedDS`.
      const again = await device(server, dbName);
      await again.engine.syncNow();
      await again.engine.syncNow();
      await expectNothingMissing(again.db, server, pageId);
      const c = await device(server);
      await c.engine.syncNow();
      expect(await read(c, pageId)).toBe('abefgh');
    });
  }

  for (const version of OLD_VERSIONS) {
    it(`un envío de la versión anterior (con todos los borrados) confirmado por la actual cuenta para lo que sigue (${version})`, async () => {
      const server = new FakeServer();
      const dbName = crypto.randomUUID();
      const a = await device(server, dbName);
      const pageId = await a.tree.create(null, 'P');
      await write(a, pageId, (t) => t.insert(0, 'uno dos tres cuatro cinco'));
      await a.engine.syncNow();
      a.engine.stop();
      a.db.close();

      const old = await openPublished(server, dbName, version);
      await write(old, pageId, (t) => t.delete(0, 4));
      // Llega al servidor pero la respuesta se pierde: queda el envío de la versión anterior, sin `ds`.
      server.loseNextPushResponse = true;
      await old.docs.pushPage(pageId, old.remote).catch(() => undefined);
      expect((await old.db.get('docState', pageId))?.pending?.ds).toBeUndefined();
      old.db.close();

      const again = await device(server, dbName);
      await again.engine.syncNow();
      const oldDeletes = rangesOf(server.updates.get(pageId)!.at(-1)!.data);
      expect(rangesContain(rangesOf((await again.db.get('docState', pageId))!.syncedDS!), oldDeletes)).toBe(true);
      await write(again, pageId, (t) => t.delete(t.length - 6, 6));
      await again.engine.syncNow();
      const last = rangesOf(server.updates.get(pageId)!.at(-1)!.data);
      expect(subtractRanges(last, oldDeletes)).toEqual(last);
      await expectNothingMissing(again.db, server, pageId);
      expect(await read(again, pageId)).toBe('dos tres cuatro');
    });
  }

  for (const version of OLD_VERSIONS) {
    it(`un envío de la actual (solo lo nuevo) confirmado por la versión anterior: nada se pierde y la actual sigue bien (${version})`, async () => {
      const server = new FakeServer();
      const dbName = crypto.randomUUID();
      const a = await device(server, dbName);
      const pageId = await a.tree.create(null, 'P');
      await write(a, pageId, (t) => t.insert(0, 'uno dos tres cuatro cinco seis'));
      await a.engine.syncNow();
      await write(a, pageId, (t) => t.delete(0, 4));
      await a.engine.syncNow();
      await write(a, pageId, (t) => t.delete(0, 4));
      server.loseNextPushResponse = true;
      await a.engine.syncNow().catch(() => undefined);
      const pending = (await a.db.get('docState', pageId))?.pending;
      expect(pending?.ds).toBeDefined();
      a.engine.stop();
      a.db.close();

      const old = await openPublished(server, dbName, version);
      await publishedSync(old, server, [pageId]);
      await write(old, pageId, (t) => t.delete(0, 5));
      await publishedSync(old, server, [pageId]);
      old.db.close();

      const again = await device(server, dbName);
      await write(again, pageId, (t) => t.delete(t.length - 5, 5));
      await again.engine.syncNow();
      await expectDeletesSound(again.db, server, pageId);
      await expectNothingMissing(again.db, server, pageId);
      const c = await device(server);
      await c.engine.syncNow();
      expect(await read(c, pageId)).toBe('cuatro cinco');
    });
  }

  it('dos instancias sobre la misma base (dos pestañas, que la app no deja): no se pierde ningún borrado', async () => {
    const server = new FakeServer();
    const dbName = crypto.randomUUID();
    const a = await device(server, dbName);
    const pageId = await a.tree.create(null, 'P');
    await write(a, pageId, (t) => t.insert(0, 'a1 a2 a3 a4 a5 a6 a7 a8 a9 b1 b2 b3 b4 b5 b6 b7 b8 b9'));
    await a.engine.syncNow();
    const b = await device(server, dbName);
    const rnd = random(3);
    for (let step = 0; step < 30; step++) {
      const d = rnd() < 0.5 ? a : b;
      await write(d, pageId, (t) => {
        if (t.length > 6) t.delete(Math.floor(rnd() * (t.length - 3)), 3);
        t.insert(Math.floor(rnd() * (t.length + 1)), `${step}`);
      });
      server.loseNextPushResponse = rnd() < 0.2;
      // A veces las dos sincronizan a la vez.
      if (rnd() < 0.3) await Promise.all([a.engine.syncNow(), b.engine.syncNow()]).catch(() => undefined);
      else await d.engine.syncNow().catch(() => undefined);
      server.loseNextPushResponse = false;
      await expectDeletesSound(a.db, server, pageId, `paso ${step}`);
    }
    for (let i = 0; i < 2; i++) for (const d of [a, b]) await d.engine.syncNow();
    await expectNothingMissing(a.db, server, pageId);
    const c = await device(server);
    await c.engine.syncNow();
    const local = await savedDoc(a.db, pageId);
    expect(await read(c, pageId)).toBe(local.getText('t').toString());
    local.destroy();
  });
});

// Tres dispositivos (cada uno con su base) que escriben y borran (también lo de los otros), suben y bajan,
// pierden respuestas, se quedan sin red, se cierran de golpe con una subida en vuelo, vuelven a veces con la
// versión publicada sobre la misma base (que restaura a su manera), y el servidor se restaura desde una copia.
// En cada paso: `syncedDS` nunca dice de más (con la generación al día). Después de cada subida confirmada
// (sin restauración de por medio): el servidor tiene todos los borrados del dispositivo. Al final: todos
// iguales al servidor, y al servidor no le falta nada de ninguno.
//
// Más corridas: DELETES_SEEDS=200 DELETES_STEPS=80 npx vitest run src/sync/uploadDeletes.test.ts
const SEEDS = Number(process.env.DELETES_SEEDS ?? 12);
const STEPS = Number(process.env.DELETES_STEPS ?? 50);

type Slot = { dbName: string; kind: 'new'; d: Device } | { dbName: string; kind: 'old'; d: Published };

describe('B.15 al azar', () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    it(`ningún borrado se pierde y todos terminan iguales (semilla ${seed})`, async () => {
      const rnd = random(seed * 7919);
      const server = new FakeServer();
      const slots: Slot[] = [];
      for (let i = 0; i < 3; i++) {
        const dbName = crypto.randomUUID();
        slots.push({ dbName, kind: 'new', d: await device(server, dbName) });
      }
      const first = slots[0].d as Device;
      const pageId = await first.tree.create(null, 'P');
      await write(first, pageId, (t) => t.insert(0, 'base del texto para borrar de a poco '));
      await first.engine.syncNow();
      for (const s of slots) await (s.d as Device).engine.syncNow();
      let restoreFn: (() => void) | null = null;
      const log: string[] = [];

      const close = async (s: Slot) => {
        if (s.kind === 'new') {
          await s.d.docs.flush();
          s.d.docs.dispose();
          s.d.engine.stop();
        }
        s.d.db.close();
        await new Promise((r) => setTimeout(r, 5));
      };
      const reopen = async (i: number, old: boolean) => {
        const dbName = slots[i].dbName;
        slots[i] = old ? { dbName, kind: 'old', d: await openPublished(server, dbName, rnd() < 0.6 ? 'main' : 'v0.029') } : { dbName, kind: 'new', d: await device(server, dbName) };
      };
      const sync = async (s: Slot) => {
        if (s.kind === 'new') await s.d.engine.syncNow();
        else await publishedSync(s.d, server, [pageId]);
      };

      for (let step = 0; step < STEPS; step++) {
        const i = Math.floor(rnd() * slots.length);
        const s = slots[i];
        const x = rnd();
        let pushedOk = false;
        try {
          if (x < 0.35) {
            await write(s.d, pageId, (t) => {
              const r = rnd();
              if (t.length > 6 && r < 0.5) t.delete(Math.floor(rnd() * (t.length - 3)), 1 + Math.floor(rnd() * 3));
              else if (t.length > 20 && r < 0.6) t.delete(Math.floor(rnd() * 5), Math.floor(t.length / 3));
              else t.insert(Math.floor(rnd() * (t.length + 1)), `${i}.${step} `);
            });
            log.push(`w${i}`);
          } else if (x < 0.45) {
            await s.d.docs.pullPage(pageId, s.d.remote);
            log.push(`pull${i}`);
          } else if (x < 0.55) {
            server.loseNextPushResponse = true;
            log.push(`lost${i}`);
            await s.d.docs.pushPage(pageId, s.d.remote);
          } else if (x < 0.65) {
            log.push(`push${i}`);
            await s.d.docs.pushPage(pageId, s.d.remote);
            pushedOk = s.kind === 'new';
          } else if (x < 0.72) {
            server.online = rnd() < 0.6;
            log.push(server.online ? 'online' : 'offline');
          } else if (x < 0.8) {
            // Cierre de golpe, a veces con una subida (o el ciclo entero) en vuelo.
            const watch = watchTransactions();
            const after = Math.floor(rnd() * 50);
            try {
              if (rnd() < 0.6) {
                server.loseNextPushResponse = rnd() < 0.3;
                void sync(s).catch(() => undefined);
              }
              await microtasks(after);
              await watch.kill(s.d as never);
            } finally {
              watch.restore();
              server.loseNextPushResponse = false;
            }
            await reopen(i, rnd() < 0.3);
            log.push(`kill${i}@${after}->${slots[i].kind}`);
          } else if (x < 0.86) {
            await close(s);
            await reopen(i, rnd() < 0.4);
            log.push(`reopen${i}->${slots[i].kind}`);
          } else if (x < 0.9 && s.kind === 'old') {
            // La versión anterior ve la restauración y se cierra antes de subir (el caso de la generación).
            await publishedSync(s.d, server, [pageId], false);
            await close(s);
            await reopen(i, false);
            log.push(`oldreset${i}`);
          } else if (x < 0.93) {
            if (!restoreFn) {
              restoreFn = server.backup();
              log.push('backup');
            } else {
              restoreFn();
              restoreFn = null;
              log.push('restore');
            }
          } else {
            log.push(`sync${i}`);
            await sync(s);
          }
        } catch {
          // Sin red o respuesta perdida: se sigue.
        }
        server.loseNextPushResponse = false;
        const label = `semilla ${seed}, paso ${step}: ${log.join(' ')}`;
        for (const each of slots) await expectDeletesSound(each.d.db, server, pageId, label);
        // Una subida confirmada (sin restauración que el dispositivo no vio): el servidor tiene todos sus borrados.
        if (pushedOk && storedGeneration(await s.d.db.get('meta', GENERATION_KEY)) === server.settings!.generation) {
          const local = await savedDoc(s.d.db, pageId);
          const missing = subtractRanges(rangesOf(Y.encodeStateAsUpdate(local)), serverDeletes(server, pageId));
          local.destroy();
          expect([...missing], `borrado sin subir tras una subida confirmada, ${label}`).toEqual([]);
        }
      }

      // Final: todos vuelven con la versión actual, con red, y sincronizan.
      server.online = true;
      for (let i = 0; i < slots.length; i++) {
        await close(slots[i]);
        await reopen(i, false);
      }
      for (let round = 0; round < 3; round++) for (const s of slots) await (s.d as Device).engine.syncNow();
      const expected = serverDoc(server, pageId);
      const label = `semilla ${seed}: ${log.join(' ')}`;
      for (const s of slots) {
        const d = s.d as Device;
        await expectDeletesSound(d.db, server, pageId, label);
        await expectNothingMissing(d.db, server, pageId);
        expect(await read(d, pageId), label).toBe(expected.getText('t').toString());
        expect(d.engine.getStatus().pendingPages, label).toBe(0);
      }
      const fresh = await device(server);
      await fresh.engine.syncNow();
      expect(await read(fresh, pageId), label).toBe(expected.getText('t').toString());
      expected.destroy();
    });
  }
});
