import { createClient } from '@supabase/supabase-js';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { rangesOf, subtractRanges, unionRanges, type DeleteRanges } from './deleteSets';
import { epochChanged, knownDeletes } from './docs';
import { PageDocs as V100PageDocs } from './fixtures/v100/docs';
import { GENERATION_KEY, openLocalDb, storedGeneration, type LocalDb } from './localDb';
import { SNAPSHOT_SCHEMA_VERSION, SupabaseRemote } from './remote';
import { mergeRootGroups, seedIfEmpty } from './structure';
import { FakeRemote, FakeServer, makeDevice, sha256Hex, watchTransactions, type Device } from './testing';
import type { RemoteUpdate } from './types';

// Compactar, entrega 1: LEER snapshots (Docs/Doc_Compactar.md, secciones 5, 12 y 15, pruebas 2, 3 y 6). Nadie de la app
// arma snapshots todavía: los arma acá `compactOnServer`, como lo hará el dispositivo de un editor en la entrega 2
// (reservar, bajar las filas del servidor, aplicarlas en orden en un documento sin GC, subir, bajar la vuelta y
// confirmar), con el servidor en memoria y las reglas de 20261019120000_compactar_leer.sql. Lo que se prueba es el
// dispositivo que baja: con el motor de verdad (`SyncEngine`, `PageDocs`, IndexedDB en memoria).

const devices: Device[] = [];
const extraDbs: LocalDb[] = [];
async function device(server: FakeServer, opts: { id?: string; dbName?: string } = {}): Promise<Device> {
  const d = await makeDevice(server, opts.dbName, '0.124', {}, undefined, opts.id ? { id: opts.id } : {});
  devices.push(d);
  return d;
}

const swallow = (e: unknown) => {
  if (String(e).includes('closed') || String(e).includes('InvalidStateError')) return;
  throw e;
};
process.on('unhandledRejection', swallow);
afterAll(() => {
  process.off('unhandledRejection', swallow);
});
afterEach(async () => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    try {
      d.db.close();
      d.mediaDb.close();
      d.commentsDb.close();
    } catch {
      // ya cerrada
    }
  }
  for (const db of extraDbs.splice(0)) db.close();
});

// --- ayudantes ------------------------------------------------------------------------------------------------------

async function edit(d: Device, pageId: string, fn: (t: Y.Text) => void): Promise<void> {
  const doc = await d.docs.open(pageId);
  doc.transact(() => fn(doc.getText('t')), 'test');
  await d.docs.flush(pageId);
  d.docs.close(pageId);
}
const add = (s: string) => (t: Y.Text) => t.insert(t.length, `${s} `);

/**
 * Escribe `count` palabras con la página abierta (un solo autor de Yjs, como quien tipea), sincronizando después de cada
 * una (una fila por palabra); cada tres, borra la anterior. Así las filas tienen el peso de siempre y el snapshot junta
 * lo del mismo autor: pesa bastante menos que ellas, como en una página editada de verdad.
 */
async function type(d: Device, pageId: string, count: number, prefix: string): Promise<void> {
  const doc = await d.docs.open(pageId);
  const t = doc.getText('t');
  for (let i = 0; i < count; i++) {
    doc.transact(() => t.insert(t.length, `${prefix}${i} `), 'test');
    if (i % 3 === 2) doc.transact(() => del(`${prefix}${i - 1}`)(t), 'test');
    await d.docs.flush(pageId);
    await d.engine.syncNow();
  }
  d.docs.close(pageId);
}
const del = (s: string) => (t: Y.Text) => {
  const i = t.toString().indexOf(`${s} `);
  if (i >= 0) t.delete(i, s.length + 1);
};

/** Lo que muestra el servidor: sus filas aplicadas de a una, en orden. */
function serverText(server: FakeServer, pageId: string): string {
  const doc = new Y.Doc();
  for (const u of server.updates.get(pageId) ?? []) Y.applyUpdate(doc, u.data);
  const out = doc.getText('t').toString();
  doc.destroy();
  return out;
}
function serverDoc(server: FakeServer, pageId: string): Y.Doc {
  const doc = new Y.Doc({ gc: false });
  for (const u of server.updates.get(pageId) ?? []) Y.applyUpdate(doc, u.data);
  return doc;
}
function serverDeletes(server: FakeServer, pageId: string): DeleteRanges {
  return (server.updates.get(pageId) ?? []).reduce<DeleteRanges>((acc, u) => unionRanges(acc, rangesOf(u.data)), new Map());
}

async function stored(d: { db: LocalDb }, pageId: string): Promise<Uint8Array[]> {
  return (await d.db.getAllFromIndex('docUpdates', 'pageId', pageId)).map((r) => r.data);
}
async function text(d: { db: LocalDb }, pageId: string): Promise<string> {
  const doc = new Y.Doc();
  const rows = await stored(d, pageId);
  if (rows.length > 0) Y.applyUpdate(doc, Y.mergeUpdates(rows));
  const out = doc.getText('t').toString();
  doc.destroy();
  return out;
}
const state = (d: { db: LocalDb }, pageId: string) => d.db.get('docState', pageId);

/** `syncedSV` y `syncedDS` no dicen más de lo que tiene el servidor (las revisiones de B.2 y B.15). */
async function expectSound(d: { db: LocalDb }, server: FakeServer, pageId: string, label = ''): Promise<void> {
  const s = await state(d, pageId);
  const srv = serverDoc(server, pageId);
  const has = Y.decodeStateVector(Y.encodeStateVector(srv));
  srv.destroy();
  for (const [client, clock] of s?.syncedSV ? Y.decodeStateVector(s.syncedSV) : new Map<number, number>()) {
    expect(clock, `syncedSV dice de más, autor ${client} ${label}`).toBeLessThanOrEqual(has.get(client) ?? 0);
  }
  const generation = storedGeneration(await d.db.get('meta', GENERATION_KEY));
  if (generation !== server.settings!.generation || !s) return;
  const known = knownDeletes(s, generation);
  if (!known) return;
  const extra = subtractRanges(rangesOf(known), serverDeletes(server, pageId));
  expect([...extra], `syncedDS dice de más ${label}`).toEqual([]);
}

/** Al servidor no le falta nada de lo guardado en el dispositivo (elementos ni borrados). */
async function expectNothingMissing(d: { db: LocalDb }, server: FakeServer, pageId: string): Promise<void> {
  const rows = await stored(d, pageId);
  const local = new Y.Doc({ gc: false });
  if (rows.length > 0) Y.applyUpdate(local, Y.mergeUpdates(rows));
  const srv = serverDoc(server, pageId);
  const has = Y.decodeStateVector(Y.encodeStateVector(srv));
  for (const [client, clock] of Y.decodeStateVector(Y.encodeStateVector(local))) {
    expect(has.get(client) ?? 0, `autor ${client}`).toBeGreaterThanOrEqual(clock);
  }
  const missing = subtractRanges(rangesOf(Y.encodeStateAsUpdate(local)), serverDeletes(server, pageId));
  expect([...missing], 'borrados del dispositivo que el servidor no tiene').toEqual([]);
  local.destroy();
  srv.destroy();
}

/** Lo que baja el dispositivo con `pullContent` (cada respuesta). */
function recordContent(d: Device): RemoteUpdate[][] {
  const out: RemoteUpdate[][] = [];
  const orig = d.remote.pullContent.bind(d.remote);
  d.remote.pullContent = async (pageId, after, limit) => {
    const got = await orig(pageId, after, limit);
    out.push(got);
    return got;
  };
  return out;
}
const servedSnapshot = (calls: RemoteUpdate[][]) => calls.flat().some((u) => u.snapshotId);

/**
 * Compacta la página en el servidor como lo hará un editor (entrega 2): reserva, baja la base y las filas, las aplica en
 * orden en un documento sin GC, sube, baja la vuelta y confirma. `mutate` cambia las filas o el documento antes de
 * codificar (para armar snapshots malos). Devuelve el id confirmado, o `null` si no había nada que compactar.
 */
async function compactOnServer(
  server: FakeServer,
  pageId: string,
  { by = server.ownerId, mutate }: { by?: string; mutate?: (tail: RemoteUpdate[], doc: Y.Doc) => RemoteUpdate[] | void } = {},
): Promise<string | null> {
  const remote = new FakeRemote(server, '1.000', by);
  const claim = await remote.claimCompaction(pageId);
  if (!claim) return null;
  const base = claim.baseId ? await remote.pullSnapshot(claim.baseId) : null;
  let tail = (await remote.pullUpdates(pageId, claim.baseSeq, 1000)).filter((u) => u.seq <= claim.upToSeq);
  server.contentCalls.pop();
  const doc = new Y.Doc({ gc: false });
  if (base) Y.applyUpdate(doc, base);
  tail = mutate?.(tail, doc) ?? tail;
  for (const u of tail) Y.applyUpdate(doc, u.data);
  const st = Y.encodeStateAsUpdate(doc);
  const sha = await sha256Hex(st);
  const pushed = await remote.pushSnapshot({
    pageId,
    baseId: claim.baseId,
    upToSeq: claim.upToSeq,
    lastUpdateId: claim.lastUpdateId,
    state: st,
    sv: Y.encodeStateVector(doc),
    sha256: sha,
  });
  doc.destroy();
  expect(pushed.result).toBe('ok');
  expect(await sha256Hex(await remote.pullSnapshot(pushed.id))).toBe(sha);
  expect(await remote.confirmSnapshot(pushed.id, sha)).toBe(true);
  return pushed.id;
}

/** Un servidor con los snapshots prendidos (y la reserva desde 5 filas) y un editor con una página escrita. */
async function setup({ snapshots = true, team = false, edits = 12 }: { snapshots?: boolean; team?: boolean; edits?: number } = {}) {
  const server = new FakeServer();
  if (team) server.enableTeam();
  if (snapshots) server.enableSnapshots(0.5);
  else server.migrateSnapshots();
  server.snapshotMinRows = 5;
  server.snapshotMinTailBytes = 1;
  const e1 = await device(server);
  const page = await e1.tree.create(null, 'P');
  await e1.engine.syncNow();
  await type(e1, page, edits, 'palabra');
  return { server, e1, page };
}

// --- sin snapshots: igual que hoy -----------------------------------------------------------------------------------

describe('sin snapshots, la app se comporta y pide exactamente lo mismo que hoy', () => {
  /** El mismo guion en un servidor: dos dispositivos que escriben, borran y bajan. Devuelve lo que se pidió y lo que quedó. */
  async function script(server: FakeServer) {
    const a = await device(server);
    const page = await a.tree.create(null, 'P');
    await a.engine.syncNow();
    for (let i = 0; i < 6; i++) {
      await edit(a, page, add(`w${i}`));
      await a.engine.syncNow();
    }
    const b = await device(server);
    await b.engine.syncNow();
    await edit(a, page, del('w2'));
    await a.engine.syncNow();
    await edit(b, page, add('b1'));
    await b.engine.syncNow();
    await a.engine.syncNow();
    return {
      calls: [...server.contentCalls],
      texts: [await text(a, page), await text(b, page), serverText(server, page)],
      rows: (server.updates.get(page) ?? []).length,
      states: [await state(a, page), await state(b, page)].map((s) => [s?.cursor, s?.snapshotId, s?.contentEpoch]),
    };
  }

  it('con la migración aplicada y los snapshots apagados: los mismos pedidos (solo pull_page_updates) y el mismo resultado', async () => {
    const before = await script(new FakeServer());
    const migrated = new FakeServer();
    migrated.migrateSnapshots();
    const after = await script(migrated);
    expect(after.calls).toEqual(before.calls);
    expect(after.calls.every((c) => c === 'pull_page_updates')).toBe(true);
    expect(after.texts).toEqual(before.texts);
    expect(new Set(after.texts).size).toBe(1);
    expect(after.rows).toBe(before.rows);
    expect(after.states).toEqual(before.states);
    expect(after.states.flat().filter((x) => x === undefined)).toHaveLength(4);
  });

  it('prendidos y sin ningún snapshot: pull_page_content devuelve los mismos bytes que pull_page_updates, con la época', async () => {
    const { server, e1, page } = await setup({ edits: 8 });
    const r = new FakeRemote(server, '0.124');
    await r.fetchWorkspaceSettings();
    for (const after of [0, 3, 7, 100]) {
      for (const limit of [1, 2, 500]) {
        const rows = await r.pullUpdates(page, after, limit);
        const content = await r.pullContent(page, after, limit);
        expect(content.map((u) => [u.seq, Buffer.from(u.data).toString('hex'), u.snapshotId])).toEqual(
          rows.map((u) => [u.seq, Buffer.from(u.data).toString('hex'), undefined]),
        );
        expect(content.every((u) => u.contentEpoch === 0)).toBe(true);
      }
    }
    // Un dispositivo nuevo guarda exactamente lo mismo que con las filas.
    const b = await device(server);
    await b.engine.syncNow();
    expect(server.contentCalls).toContain('pull_page_content');
    expect(await text(b, page)).toBe(serverText(server, page));
    expect(await text(b, page)).toBe(await text(e1, page));
    const s = await state(b, page);
    expect(s?.snapshotId).toBeUndefined();
    expect(s?.contentEpoch).toBe(0);
    expect(s?.cursor).toBe(server.pages.get(page)!.update_seq);
    await expectSound(b, server, page);
  });

  it('una base sin la migración (o sin pull_page_content): el árbol llega sin las columnas y se baja con pull_page_updates', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const page = await a.tree.create(null, 'P');
    await edit(a, page, add('hola'));
    await a.engine.syncNow();
    const b = await device(server);
    await b.engine.syncNow();
    expect(b.tree.get(page)?.content_epoch).toBeUndefined();
    expect(await text(b, page)).toBe('hola ');
    expect(server.contentCalls.every((c) => c === 'pull_page_updates')).toBe(true);

    // Dice la versión 16 y los tiene prendidos, pero falta la función: se baja igual, por pull_page_updates.
    server.enableSnapshots(0.5);
    server.pullContentMissing = true;
    server.contentCalls.splice(0);
    await edit(a, page, add('chau'));
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(b.tree.get(page)?.content_epoch).toBe(0);
    expect(await text(b, page)).toBe('hola chau ');
    expect(server.contentCalls).toEqual(['pull_page_updates']);
  });
});

// --- con snapshots --------------------------------------------------------------------------------------------------

describe('un dispositivo que baja snapshots', () => {
  it('nuevo: baja el snapshot y las filas siguientes; queda igual al servidor y las cuentas no dicen de más', async () => {
    const { server, e1, page } = await setup();
    const id = await compactOnServer(server, page);
    expect(id).not.toBeNull();
    await edit(e1, page, add('despues1'));
    await e1.engine.syncNow();
    await edit(e1, page, del('palabra0'));
    await e1.engine.syncNow();

    const b = await device(server);
    const calls = recordContent(b);
    await b.engine.syncNow();
    expect(servedSnapshot(calls)).toBe(true);
    // El snapshot y las dos filas de después, en un solo pedido.
    expect(calls.flat().map((u) => u.seq)).toEqual([server.snapshots[0].upToSeq, ...(server.updates.get(page) ?? []).slice(-2).map((u) => u.seq)]);
    const rowsBytes = (server.updates.get(page) ?? []).reduce((n, u) => n + u.data.length, 0);
    expect(calls.flat().reduce((n, u) => n + u.data.length, 0)).toBeLessThan(rowsBytes);
    expect(await text(b, page)).toBe(serverText(server, page));
    const s = await state(b, page);
    expect(s?.snapshotId).toBe(id);
    expect(s?.contentEpoch).toBe(0);
    expect(s?.cursor).toBe(server.pages.get(page)!.update_seq);
    expect(s?.unreadable).toBeUndefined();
    await expectSound(b, server, page);
    expect(b.tree.get(page)?.snapshot_seq).toBe(server.snapshots[0].upToSeq);

    // Lo que escribe después sube sin reenviar lo del snapshot, y nada se pierde.
    const before = (server.updates.get(page) ?? []).length;
    await edit(b, page, add('de-b'));
    await b.engine.syncNow();
    expect((server.updates.get(page) ?? []).length).toBe(before + 1);
    const last = server.updates.get(page)!.at(-1)!.data;
    expect(last.length).toBeLessThan(200);
    await expectNothingMissing(b, server, page);
    await e1.engine.syncNow();
    expect(await text(e1, page)).toBe(await text(b, page));
  });

  it('cursor viejo: si la cola que le falta pesa menos que el snapshot, baja las filas', async () => {
    const { server, e1, page } = await setup();
    const b = await device(server);
    await b.engine.syncNow();
    // Una fila más y el snapshot llega hasta ella: a b le falta una fila (chica) y el snapshot trae la página entera.
    await edit(e1, page, add('x'));
    await e1.engine.syncNow();
    await compactOnServer(server, page);
    expect(server.snapshots[0].upToSeq).toBe(server.pages.get(page)!.update_seq);
    const calls = recordContent(b);
    await b.engine.syncNow();
    expect(calls.flat().map((u) => u.seq)).toEqual([server.pages.get(page)!.update_seq]);
    expect(servedSnapshot(calls)).toBe(false);
    expect((await state(b, page))?.snapshotId).toBeUndefined();
    expect(await text(b, page)).toBe(serverText(server, page));
  });

  it('cursor viejo con ediciones propias sin subir: baja el snapshot y lo propio sube igual', async () => {
    const { server, e1, page } = await setup({ edits: 2 });
    const b = await device(server);
    await b.engine.syncNow();
    // b escribe sin red; mientras tanto e1 escribe mucho y alguien compacta.
    server.online = false;
    await edit(b, page, add('propio1'));
    await edit(b, page, del('palabra1'));
    await edit(b, page, add('propio2'));
    server.online = true;
    await type(e1, page, 20, 'mas');
    await compactOnServer(server, page);
    // Baja antes de subir (como si la subida esperara): el snapshot llega con lo propio sin subir.
    await b.remote.fetchWorkspaceSettings();
    const calls = recordContent(b);
    await b.docs.pullPage(page, b.remote);
    expect(servedSnapshot(calls)).toBe(true);
    await expectSound(b, server, page, 'con lo propio sin subir');
    expect(await b.docs.unsyncedPages()).toEqual([page]);
    await b.engine.syncNow();
    await expectNothingMissing(b, server, page);
    expect(serverText(server, page)).toContain('propio1');
    expect(serverText(server, page)).toContain('propio2');
    expect(serverText(server, page)).not.toContain('palabra1 ');
    await e1.engine.syncNow();
    expect(await text(e1, page)).toBe(serverText(server, page));
    expect(await text(b, page)).toBe(serverText(server, page));
  });

  it('una subida en vuelo (respuesta perdida) mientras llega un snapshot que ya la tiene: no se duplica ni se pierde nada', async () => {
    const { server, e1, page } = await setup({ edits: 3 });
    const b = await device(server);
    await b.engine.syncNow();
    await edit(b, page, add('en-vuelo'));
    server.loseNextPushResponse = true;
    await b.engine.syncNow();
    expect((await state(b, page))?.pending).toBeDefined();
    await type(e1, page, 20, 'mas');
    await compactOnServer(server, page);
    await b.remote.fetchWorkspaceSettings();
    const calls = recordContent(b);
    await b.docs.pullPage(page, b.remote);
    expect(servedSnapshot(calls)).toBe(true);
    await expectSound(b, server, page);
    const rows = (server.updates.get(page) ?? []).length;
    await b.engine.syncNow();
    // El reintento usa el mismo id: el servidor no guarda otra fila.
    expect((server.updates.get(page) ?? []).length).toBe(rows);
    expect((await state(b, page))?.pending).toBeUndefined();
    await expectNothingMissing(b, server, page);
    expect(await text(b, page)).toBe(serverText(server, page));
  });

  it('cerrar la app en cualquier punto de la bajada: lo guardado, el cursor, las cuentas y el snapshot quedan juntos', async () => {
    const { server, page } = await setup();
    await compactOnServer(server, page);
    const upTo = server.snapshots[0].upToSeq;
    const outcomes = new Set<string>();
    for (let steps = 0; steps <= 24; steps += 1) {
      const dbName = crypto.randomUUID();
      const b = await device(server, { dbName });
      await b.remote.fetchWorkspaceSettings();
      const watch = watchTransactions();
      try {
        void b.docs.pullPage(page, b.remote).catch(() => undefined);
        // Cada paso, una vuelta del bucle de eventos (IndexedDB en memoria contesta con tareas, no microtareas).
        for (let i = 0; i < steps; i++) await new Promise((r) => setTimeout(r, 0));
        await watch.kill(b);
      } finally {
        watch.restore();
      }
      const again = await device(server, { dbName });
      const s = await state(again, page);
      // O todo o nada: con el cursor en el snapshot, lo guardado lo tiene y el id quedó anotado.
      outcomes.add((s?.cursor ?? 0) > 0 ? 'bajado' : 'nada');
      if ((s?.cursor ?? 0) > 0) {
        expect(s?.cursor, `paso ${steps}`).toBe(upTo);
        expect(s?.snapshotId, `paso ${steps}`).toBe(server.snapshots[0].id);
        expect(await text(again, page)).toBe(serverText(server, page));
      } else {
        expect(await stored(again, page), `paso ${steps}`).toEqual([]);
        expect(s?.snapshotId).toBeUndefined();
      }
      await expectSound(again, server, page, `paso ${steps}`);
      await again.engine.syncNow();
      expect(await text(again, page)).toBe(serverText(server, page));
      await expectSound(again, server, page, `paso ${steps}, después`);
    }
    // Se cortó antes y después de guardar.
    expect([...outcomes].sort()).toEqual(['bajado', 'nada']);
  });

  it('un snapshot que esta versión no puede leer: no se guarda nada, el cursor no se mueve y la página baja en filas', async () => {
    const { server, e1, page } = await setup();
    // Un snapshot ilegible (lo armó "una versión más nueva"), confirmado a mano en el servidor.
    const remote = new FakeRemote(server, '1.000');
    const claim = (await remote.claimCompaction(page))!;
    const junk = new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
    const sha = await sha256Hex(junk);
    const pushed = await remote.pushSnapshot({ pageId: page, baseId: null, upToSeq: claim.upToSeq, lastUpdateId: claim.lastUpdateId, state: junk, sv: new Uint8Array([0]), sha256: sha });
    expect(await remote.confirmSnapshot(pushed.id, sha)).toBe(true);

    const b = await device(server);
    const calls = recordContent(b);
    server.contentCalls.splice(0);
    await b.engine.syncNow();
    expect(servedSnapshot(calls)).toBe(true);
    // Después del snapshot ilegible, las filas sueltas desde el mismo cursor (0).
    expect(server.contentCalls).toEqual(['pull_page_content', 'pull_page_updates']);
    const s = await state(b, page);
    expect(s?.cursor).toBe(server.pages.get(page)!.update_seq);
    expect(s?.snapshotId).toBeUndefined();
    expect(s?.unreadable).toBeUndefined();
    expect(await text(b, page)).toBe(serverText(server, page));
    await expectSound(b, server, page);
    // Hasta la próxima vez que se abra la app, esa página sigue en filas.
    await edit(e1, page, add('otra'));
    await e1.engine.syncNow();
    server.contentCalls.splice(0);
    await b.engine.syncNow();
    expect(server.contentCalls).toEqual(['pull_page_updates']);
    expect(await text(b, page)).toBe(serverText(server, page));
  });

  it('quien solo ve, o un invitado con Editar, nunca recibe un snapshot (tampoco con la privacidad de lo borrado prendida)', async () => {
    const { server, page } = await setup({ team: true });
    await compactOnServer(server, page);
    server.addMember('v', 'member');
    server.grant('v', { pageId: page }, 'view');
    server.addMember('g', 'guest');
    server.grant('g', { pageId: page }, 'edit');
    for (const uid of ['v', 'g']) {
      const d = await device(server, { id: uid });
      const calls = recordContent(d);
      await d.engine.syncNow();
      expect(servedSnapshot(calls), uid).toBe(false);
      expect(calls.flat().length, uid).toBe(server.updates.get(page)!.length);
      expect(await text(d, page)).toBe(serverText(server, page));
    }
    // Con D14 prendido: el lector no recibe nada (no hay base limpia) y nunca el snapshot.
    server.settings = { ...server.settings!, minAppVersion: null };
    server.enableClean(0.1);
    const v2 = await device(server, { id: 'v' });
    const calls = recordContent(v2);
    await v2.engine.syncNow();
    expect(servedSnapshot(calls)).toBe(false);
    expect(await stored(v2, page)).toEqual([]);
    // Un miembro con Editar (ve lo borrado) sí lo recibe.
    server.addMember('e', 'member');
    server.grant('e', { pageId: page }, 'edit');
    const e = await device(server, { id: 'e' });
    const ec = recordContent(e);
    await e.engine.syncNow();
    expect(servedSnapshot(ec)).toBe(true);
    expect(await text(e, page)).toBe(serverText(server, page));
  });

  it('la versión publicada (v0.100, solo pull_page_updates) baja las filas de siempre sobre la misma base', async () => {
    const { server, page } = await setup();
    await compactOnServer(server, page);
    const db = await openLocalDb(crypto.randomUUID());
    extraDbs.push(db);
    const old = new V100PageDocs(db, { normalize: mergeRootGroups, seed: seedIfEmpty });
    const remote = new FakeRemote(server, '0.100', 'old');
    expect(await old.pullPage(page, remote)).toBe(server.updates.get(page)!.length);
    expect(await text({ db }, page)).toBe(serverText(server, page));
  });

  it('una base de una versión anterior de la app (sin los campos nuevos) se sigue usando y los campos sobreviven a ella', async () => {
    const { server, e1, page } = await setup();
    const dbName = crypto.randomUUID();
    const b = await device(server, { dbName });
    await b.engine.syncNow();
    await compactOnServer(server, page);
    await edit(e1, page, add('y'));
    await e1.engine.syncNow();
    // La versión anterior (v0.100) abre la misma base, baja y escribe: conserva los campos que no conoce.
    await b.docs.flush();
    b.engine.stop();
    const db = b.db;
    const old = new V100PageDocs(db, { normalize: mergeRootGroups, seed: seedIfEmpty });
    const remote = new FakeRemote(server, '0.100');
    const fake = { ...(await db.get('docState', page))!, snapshotId: 'x', contentEpoch: 7 };
    await db.put('docState', fake);
    await old.pullPage(page, remote);
    const doc = await old.open(page);
    doc.getText('t').insert(0, 'viejo ');
    await old.flush(page);
    await old.pushPage(page, remote);
    old.close(page);
    old.dispose?.();
    const s = await db.get('docState', page);
    expect(s?.snapshotId).toBe('x');
    expect(s?.contentEpoch).toBe(7);
  });
});

// --- invalidar: la época de contenido -------------------------------------------------------------------------------

describe('si un snapshot sale mal: la época de contenido', () => {
  it('epochChanged: solo con un snapshot aplicado y otra época', () => {
    const base = { pageId: 'p', cursor: 3, version: 0, ackedVersion: 0 };
    expect(epochChanged(undefined, 1)).toBe(false);
    expect(epochChanged(base, 1)).toBe(false);
    expect(epochChanged({ ...base, contentEpoch: 0 }, 1)).toBe(false);
    expect(epochChanged({ ...base, snapshotId: 's', contentEpoch: 0 }, 0)).toBe(false);
    expect(epochChanged({ ...base, snapshotId: 's', contentEpoch: 0 }, 1)).toBe(true);
    // "Distinta", no "mayor": después de restaurar puede ser menor.
    expect(epochChanged({ ...base, snapshotId: 's', contentEpoch: 3 }, 1)).toBe(true);
    expect(epochChanged({ ...base, snapshotId: 's', contentEpoch: 0 }, undefined)).toBe(false);
  });

  it('un snapshot al que le falta una fila: el dispositivo nuevo ve de menos hasta que se invalida; después baja todo y las cuentas se rehacen', async () => {
    const { server, e1, page } = await setup();
    // El snapshot malo: sin la fila 3 (lo que esa fila escribió no está, y lo que depende de ella queda pendiente).
    const id = (await compactOnServer(server, page, { mutate: (tail) => tail.filter((u) => u.seq !== 3) }))!;
    const b = await device(server);
    await b.engine.syncNow();
    expect((await state(b, page))?.snapshotId).toBe(id);
    expect(await text(b, page)).not.toBe(serverText(server, page));
    await expectSound(b, server, page, 'con el snapshot malo');

    // Alguien que edita lo invalida (por ejemplo, la comparación desde cero de la entrega 2): la época sube.
    expect(await new FakeRemote(server, '1.000').invalidateSnapshot(id, 'test')).toBe(true);
    expect(server.smeta(page).epoch).toBe(1);
    const rows = (server.updates.get(page) ?? []).length;
    await b.engine.syncNow();
    const s = await state(b, page);
    expect(s?.snapshotId).toBeUndefined();
    expect(s?.contentEpoch).toBe(1);
    expect(s?.cursor).toBeGreaterThanOrEqual(rows);
    expect(await text(b, page)).toBe(serverText(server, page));
    await expectSound(b, server, page, 'después de invalidar');
    await expectNothingMissing(b, server, page);
    // Quien puede escribir la vuelve a subir entera una vez, en el ciclo siguiente (Yjs no duplica nada).
    expect((server.updates.get(page) ?? []).length).toBe(rows);
    expect(await b.docs.unsyncedPages()).toEqual([page]);
    await b.engine.syncNow();
    expect((server.updates.get(page) ?? []).length).toBe(rows + 1);
    await b.engine.syncNow();
    expect((server.updates.get(page) ?? []).length).toBe(rows + 1);
    await e1.engine.syncNow();
    expect(await text(e1, page)).toBe(serverText(server, page));
  });

  it('un snapshot con un borrado que las filas no tienen: al invalidar, las cuentas se rehacen y todos terminan iguales (el texto queda en el historial)', async () => {
    const { server, e1, page } = await setup({ edits: 6 });
    // b tiene la página desde antes (filas).
    const b = await device(server);
    await b.engine.syncNow();
    // El snapshot malo borra "palabra4" (un borrado que nadie hizo).
    const id = (await compactOnServer(server, page, {
      mutate: (_tail, doc) => {
        // Se arma con todas las filas y después se borra algo.
        for (const u of _tail) Y.applyUpdate(doc, u.data);
        const t = doc.getText('t');
        const i = t.toString().indexOf('palabra4 ');
        t.delete(i, 9);
        return [];
      },
    }))!;
    // c, nuevo, recibe el snapshot.
    const c = await device(server);
    await c.engine.syncNow();
    expect((await state(c, page))?.snapshotId).toBe(id);
    expect(await text(c, page)).not.toContain('palabra4');
    // Si ahora c borra lo mismo, no lo subiría (cree que el servidor lo tiene). Se invalida:
    const rows = (server.updates.get(page) ?? []).length;
    await new FakeRemote(server, '1.000').invalidateSnapshot(id, 'test');
    await c.engine.syncNow();
    // syncedDS se rehízo con las filas: ya no cuenta el borrado del snapshot malo.
    await expectSound(c, server, page, 'después de invalidar');
    await c.engine.syncNow();
    // El borrado del snapshot malo sigue en el dispositivo de c (Yjs no deshace un borrado) y sube con la vuelta entera:
    // todos convergen (Docs/Doc_Compactar.md, sección 12). Las filas no se tocan: el texto sigue en el historial.
    await expectNothingMissing(c, server, page);
    expect((server.updates.get(page) ?? []).length).toBe(rows + 1);
    expect(Buffer.from(server.updates.get(page)!.map((u) => Buffer.from(u.data).toString('latin1')).join('')).toString()).toContain('palabra4');
    await b.engine.syncNow();
    await e1.engine.syncNow();
    expect(await text(b, page)).toBe(serverText(server, page));
    expect(await text(c, page)).toBe(serverText(server, page));
    expect(await text(e1, page)).toBe(serverText(server, page));
  });

  it('la época que llega en la misma respuesta manda aunque el árbol esté atrasado', async () => {
    const { server, e1, page } = await setup();
    const id = (await compactOnServer(server, page))!;
    const b = await device(server);
    await b.engine.syncNow();
    expect((await state(b, page))?.contentEpoch).toBe(0);
    // Se invalida y hay una fila nueva; b baja sin mirar el árbol (época vieja en el árbol).
    await new FakeRemote(server, '1.000').invalidateSnapshot(id, 'test');
    await edit(e1, page, add('nueva'));
    await e1.engine.syncNow();
    const calls = recordContent(b);
    await b.docs.pullPage(page, b.remote, { contentEpoch: 0 });
    // Primero la fila nueva con la época 1: se descarta y la página se baja desde 0, en filas.
    expect(calls[0].map((u) => u.contentEpoch)).toEqual([1]);
    expect(calls[1][0].seq).toBe(1);
    const s = await state(b, page);
    expect(s?.snapshotId).toBeUndefined();
    expect(s?.contentEpoch).toBe(1);
    expect(await text(b, page)).toBe(serverText(server, page));
    await expectSound(b, server, page);
  });

  it('el motor vuelve a bajar una página al día cuya época cambió (sin filas nuevas)', async () => {
    const { server, page } = await setup();
    const id = (await compactOnServer(server, page))!;
    const b = await device(server);
    await b.engine.syncNow();
    const seq = server.pages.get(page)!.update_seq;
    expect((await state(b, page))?.cursor).toBe(seq);
    await new FakeRemote(server, '1.000').invalidateSnapshot(id, 'test');
    const calls = recordContent(b);
    await b.engine.syncNow();
    expect(calls.flat()[0]?.seq).toBe(1);
    expect((await state(b, page))?.snapshotId).toBeUndefined();
    // Y no la vuelve a bajar en el ciclo siguiente.
    calls.splice(0);
    await b.engine.syncNow();
    expect(calls.flat().filter((u) => u.seq <= seq)).toEqual([]);
  });

  it('subir snapshot_min_version deja de servir la cadena; quien ya la tenía no se reinicia (la época no cambió)', async () => {
    const { server, page } = await setup();
    await compactOnServer(server, page);
    server.enableSnapshots(2);
    const b = await device(server);
    const calls = recordContent(b);
    await b.engine.syncNow();
    expect(servedSnapshot(calls)).toBe(false);
    expect(await text(b, page)).toBe(serverText(server, page));
  });
});

// --- restaurar una copia (prueba 6, con el servidor en memoria) -----------------------------------------------------

describe('restaurar una copia de seguridad', () => {
  for (const when of ['antes de los snapshots', 'con un snapshot ya armado', 'antes de una invalidación'] as const) {
    it(`una copia ${when}: los snapshots se vacían, la época no vuelve atrás y lo servido coincide con las filas`, async () => {
      const { server, e1, page } = await setup();
      let restore = when === 'antes de los snapshots' ? server.backup() : null;
      const id = (await compactOnServer(server, page))!;
      if (!restore) restore = server.backup();
      if (when === 'antes de una invalidación') await new FakeRemote(server, '1.000').invalidateSnapshot(id, 'test');
      const b = await device(server);
      await b.engine.syncNow();
      const epoch = server.smeta(page).epoch;
      await edit(e1, page, add('despues'));
      await e1.engine.syncNow();
      restore();
      expect(server.snapshots).toEqual([]);
      expect(server.smeta(page).seq).toBe(0);
      expect(server.smeta(page).epoch).toBe(epoch);
      await b.engine.syncNow();
      await e1.engine.syncNow();
      await b.engine.syncNow();
      expect((await state(b, page))?.snapshotId).toBeUndefined();
      const c = await device(server);
      const calls = recordContent(c);
      await c.engine.syncNow();
      expect(servedSnapshot(calls)).toBe(false);
      for (const d of [b, c, e1]) {
        expect(await text(d, page)).toBe(serverText(server, page));
        await expectNothingMissing(d, server, page);
      }
      expect(serverText(server, page)).toContain('despues');
    });
  }

  it('sin el paso del script (los snapshots quedan): uno cuyas filas no volvieron no se sirve', async () => {
    const { server, e1, page } = await setup({ edits: 3 });
    server.keepSnapshotsOnRestore = true;
    const restore = server.backup();
    await type(e1, page, 8, 'nueva');
    await compactOnServer(server, page);
    restore();
    // La copia tiene menos filas: el snapshot pasa de update_seq (y su fila final no está).
    const c = await device(server);
    const calls = recordContent(c);
    await c.engine.syncNow();
    expect(servedSnapshot(calls)).toBe(false);
    expect(await text(c, page)).toBe(serverText(server, page));
    // Las filas que vuelven a subir (y las nuevas) toman los mismos seq, con otros id: el snapshot sigue sin servirse.
    await e1.engine.syncNow();
    await type(e1, page, 8, 'otra');
    expect(server.pages.get(page)!.update_seq).toBeGreaterThanOrEqual(server.snapshots[0].upToSeq);
    expect(server.currentSnapshot(page)).toBeNull();
    const d = await device(server);
    const dc = recordContent(d);
    await d.engine.syncNow();
    expect(servedSnapshot(dc)).toBe(false);
    expect(await text(d, page)).toBe(serverText(server, page));
  });
});

// --- al azar (prueba 3, sin compactar desde la app todavía) ---------------------------------------------------------

/** Números al azar con semilla (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('al azar: tres dispositivos, la versión publicada, snapshots, invalidaciones, sin red y cortes', () => {
  const seeds = Number(process.env.SNAPSHOT_SEEDS ?? 6);
  const stats = { served: 0, snapshots: 0, invalidated: 0, resets: 0 };
  afterAll(() => {
    // Para el informe: que la corrida de verdad sirvió snapshots e invalidó cadenas.
    console.info(`[snapshots al azar] ${seeds} semillas: ${JSON.stringify(stats)}`);
    expect(stats.served).toBeGreaterThan(0);
    expect(stats.invalidated).toBeGreaterThan(0);
  });
  for (let seed = 1; seed <= seeds; seed++) {
    it(`semilla ${seed}`, async () => {
      const rnd = rng(seed);
      const pick = <T,>(list: T[]) => list[Math.floor(rnd() * list.length)];
      const { server, e1, page } = await setup({ edits: 2 });
      const names = [crypto.randomUUID(), crypto.randomUUID()];
      const devs: Device[] = [e1, await device(server, { dbName: names[0] }), await device(server, { dbName: names[1] })];
      // Cada dispositivo escribe con la página abierta (un autor de Yjs por vez que la abre, como la app).
      const open = new Map<Device, Y.Doc>();
      const docOf = async (d: Device) => {
        if (!open.has(d)) open.set(d, await d.docs.open(page));
        return open.get(d)!;
      };
      const closeAll = (d: Device) => {
        if (open.delete(d)) d.docs.close(page);
      };
      const db = await openLocalDb(crypto.randomUUID());
      extraDbs.push(db);
      const old = new V100PageDocs(db, { normalize: mergeRootGroups, seed: seedIfEmpty });
      const oldRemote = new FakeRemote(server, '0.100', 'old');
      let n = 0;
      for (let step = 0; step < 60; step++) {
        const r = rnd();
        const d = pick(devs);
        const i = devs.indexOf(d);
        if (r < 0.35) {
          const doc = await docOf(d);
          const t = doc.getText('t');
          doc.transact(() => (rnd() < 0.75 ? add(`s${seed}w${n++}`) : del(`s${seed}w${Math.floor(rnd() * Math.max(n, 1))}`))(t), 'test');
          await d.docs.flush(page);
        } else if (r < 0.6) {
          await d.engine.syncNow();
        } else if (r < 0.68) {
          await compactOnServer(server, page).catch(() => null);
        } else if (r < 0.72) {
          const valid = server.currentSnapshot(page);
          if (valid) await new FakeRemote(server, '1.000').invalidateSnapshot(valid.id, 'azar').catch(() => false);
        } else if (r < 0.78) {
          server.online = !server.online;
        } else if (r < 0.84) {
          // La versión publicada escribe y sincroniza con las filas.
          if (server.online) {
            await old.pullPage(page, oldRemote);
            const doc = await old.open(page);
            doc.getText('t').insert(doc.getText('t').length, `s${seed}o${n++} `);
            await old.flush(page);
            await old.pushPage(page, oldRemote).catch(() => undefined);
            old.close(page);
          }
        } else if (r < 0.9 && i > 0) {
          // Cerrar y volver a abrir la app (con la misma base).
          closeAll(d);
          await d.docs.flush();
          d.engine.stop();
          d.db.close();
          devs[i] = await device(server, { dbName: names[i - 1] });
        } else if (r < 0.95 && i > 0) {
          // Otro dispositivo nuevo en su lugar (el anterior sube lo suyo antes, si hay red).
          if (server.online) {
            closeAll(d);
            await d.engine.syncNow();
            if ((await d.docs.unsyncedPages()).length === 0) {
              d.engine.stop();
              names[i - 1] = crypto.randomUUID();
              devs[i] = await device(server, { dbName: names[i - 1] });
              await devs[i].engine.syncNow();
              if (server.online) expect(await text(devs[i], page), `semilla ${seed}, paso ${step}, nuevo`).toBe(serverText(server, page));
            }
          }
        } else {
          for (const x of devs) await expectSound(x, server, page, `semilla ${seed}, paso ${step}`);
        }
      }
      for (const d of devs) closeAll(d);
      server.online = true;
      for (let round = 0; round < 3; round++) {
        for (const d of devs) await d.engine.syncNow();
        await old.pullPage(page, oldRemote);
        await old.pushPage(page, oldRemote);
      }
      const expected = serverText(server, page);
      stats.served += server.snapshotsServed;
      stats.snapshots += server.snapshots.filter((x) => x.confirmedAt !== null).length;
      stats.invalidated += server.snapshots.filter((x) => x.invalidAt !== null).length;
      stats.resets += server.smeta(page).epoch;
      for (const d of devs) {
        expect(await text(d, page), `semilla ${seed}`).toBe(expected);
        await expectSound(d, server, page, `semilla ${seed}, final`);
        await expectNothingMissing(d, server, page);
      }
      expect(await text({ db }, page)).toBe(expected);
      // Un dispositivo nuevo al final: lo mismo (con o sin snapshot vigente).
      const fresh = await device(server);
      await fresh.engine.syncNow();
      expect(await text(fresh, page)).toBe(expected);
      await expectSound(fresh, server, page, `semilla ${seed}, nuevo`);
    });
  }
});

// --- el cliente de verdad (SupabaseRemote) con un fetch en memoria ------------------------------------------------------

describe('SupabaseRemote: qué pide', () => {
  /** Un PostgREST de juguete: anota cada pedido y contesta según la ruta. */
  function fakeBase(opts: { schema: number; snapshotMin: number | string | null; contentMissing?: boolean; columnsMissing?: boolean }) {
    const calls: string[] = [];
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    const fetchFn: typeof fetch = async (input) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const path = url.pathname.replace('/rest/v1/', '');
      calls.push(path === 'pages' ? `pages?select=${url.searchParams.get('select')}` : path);
      if (path === 'workspace_settings') {
        return json(200, [{ id: true, generation: 1, min_app_version: null, schema_version: opts.schema, media_url: null,
          ...(opts.schema >= SNAPSHOT_SCHEMA_VERSION ? { snapshot_min_version: opts.snapshotMin } : {}) }]);
      }
      if (path === 'rpc/pull_page_updates') return json(200, [{ seq: 1, update: 'AAA=' }, { seq: '2', update: 'AAA=' }]);
      if (path === 'rpc/pull_page_content') {
        if (opts.contentMissing) return json(404, { code: 'PGRST202', message: 'Could not find the function public.pull_page_content' });
        return json(200, [
          { seq: '7', update: 'AAA=', snapshot_id: 'a1b2', content_epoch: '3' },
          { seq: 8, update: 'AAA=', snapshot_id: null, content_epoch: 3 },
        ]);
      }
      if (path === 'pages') {
        if (opts.columnsMissing && url.searchParams.get('select')?.includes('snapshot_seq')) {
          return json(400, { code: '42703', message: 'column pages.snapshot_seq does not exist' });
        }
        return json(200, []);
      }
      return json(404, { code: 'PGRST202', message: `no ${path}` });
    };
    const client = createClient('https://example.supabase.co', 'sb_publishable_test', {
      global: { fetch: fetchFn },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    return { remote: new SupabaseRemote(client, '0.124'), calls };
  }

  it('sin la versión 16, o con los snapshots apagados: el mismo pedido de siempre (pull_page_updates)', async () => {
    for (const opts of [{ schema: 15, snapshotMin: null }, { schema: 16, snapshotMin: null }]) {
      const { remote, calls } = fakeBase(opts);
      await remote.fetchWorkspaceSettings();
      const rows = await remote.pullContent('p', 0, 500);
      expect(calls.filter((c) => c.startsWith('rpc/'))).toEqual(['rpc/pull_page_updates']);
      expect(rows.map((r) => [r.seq, r.snapshotId, r.contentEpoch])).toEqual([[1, undefined, undefined], [2, undefined, undefined]]);
    }
    // Sin haber leído los ajustes todavía, también.
    const { remote, calls } = fakeBase({ schema: 16, snapshotMin: '0.500' });
    await remote.pullContent('p', 0, 500);
    expect(calls).toEqual(['rpc/pull_page_updates']);
  });

  it('prendidos: pull_page_content, con el snapshot y la época como números', async () => {
    const { remote, calls } = fakeBase({ schema: 16, snapshotMin: '0.500' });
    const settings = await remote.fetchWorkspaceSettings();
    expect(settings?.snapshotMinVersion).toBe(0.5);
    const rows = await remote.pullContent('p', 0, 500);
    expect(calls.filter((c) => c.startsWith('rpc/'))).toEqual(['rpc/pull_page_content']);
    expect(rows.map((r) => [r.seq, r.snapshotId, r.contentEpoch])).toEqual([[7, 'a1b2', 3], [8, undefined, 3]]);
  });

  it('una base sin pull_page_content: baja con pull_page_updates y no lo vuelve a pedir por 10 minutos', async () => {
    const { remote, calls } = fakeBase({ schema: 16, snapshotMin: 0.5, contentMissing: true });
    await remote.fetchWorkspaceSettings();
    const rows = await remote.pullContent('p', 0, 500);
    expect(rows.map((r) => r.seq)).toEqual([1, 2]);
    await remote.pullContent('p', 2, 500);
    expect(calls.filter((c) => c.startsWith('rpc/'))).toEqual(['rpc/pull_page_content', 'rpc/pull_page_updates', 'rpc/pull_page_updates']);
  });

  it('el árbol pide snapshot_seq y content_epoch desde la 16; si faltan igual, sigue sin ellas', async () => {
    const a = fakeBase({ schema: 15, snapshotMin: null });
    await a.remote.fetchTree(['w'], 15);
    expect(a.calls.some((c) => c.includes('snapshot_seq'))).toBe(false);
    const b = fakeBase({ schema: 16, snapshotMin: null });
    await b.remote.fetchTree(['w'], 16);
    expect(b.calls).toHaveLength(1);
    expect(b.calls[0]).toContain('snapshot_seq,content_epoch');
    const c = fakeBase({ schema: 16, snapshotMin: null, columnsMissing: true });
    expect(await c.remote.fetchTree(['w'], 16)).toEqual([]);
    expect(c.calls).toHaveLength(2);
    expect(c.calls[1]).not.toContain('snapshot_seq');
    expect(c.calls[1]).toContain('clean_seq');
  });
});
