import { createClient } from '@supabase/supabase-js';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { compactPage, type CompactOptions } from './compact';
import { rangesOf, subtractRanges, unionRanges, type DeleteRanges } from './deleteSets';
import { knownDeletes } from './docs';
import { PageDocs as V100PageDocs } from './fixtures/v100/docs';
import { GENERATION_KEY, openLocalDb, storedGeneration, type LocalDb } from './localDb';
import { SupabaseRemote } from './remote';
import { mergeRootGroups, seedIfEmpty } from './structure';
import { FakeRemote, FakeServer, makeDevice, sha256Hex, type Device } from './testing';
import { RemoteError, type RemoteUpdate } from './types';

// Compactar, entrega 3: PRENDER los snapshots (Docs/Doc_Compactar.md, "Cómo quedó la entrega 3"). Lo que tiene que estar
// antes de prenderlos, con el motor de verdad y el servidor en memoria con las reglas de las tres migraciones:
//
// - R-1: la marca del rearmado guardada (si la app se cierra a mitad, lo escrito al lado de lo que trajo un snapshot malo
//   igual llega a todos);
// - R-2: la espera olvida `syncedSV` una sola vez por época;
// - O-D: un snapshot que no coincide con su huella no se aplica y se invalida; uno ilegible con la huella bien (de una
//   versión más nueva) no se invalida;
// - las versiones v0.127 a v0.133 (`pull_page_content` sin versión) nunca reciben un snapshot;
// - D142: restaurar empieza por anularlas todas;
// - dos dispositivos (uno de una versión sin snapshots y uno nuevo), sin red y con red, con un snapshot malo detectado y
//   rearmado: nada se pierde ni se oculta.

const devices: Device[] = [];
const extraDbs: LocalDb[] = [];
const COMPACT: CompactOptions = { minRows: 5, fullCheckEvery: 1 };

async function device(
  server: FakeServer,
  opts: { id?: string; dbName?: string; version?: string; compact?: CompactOptions } = {},
): Promise<Device> {
  const d = await makeDevice(server, opts.dbName, opts.version ?? '0.124', {}, undefined, opts.id ? { id: opts.id } : {}, opts.compact ?? COMPACT);
  devices.push(d);
  return d;
}
const compactor = (server: FakeServer, opts: { id?: string; dbName?: string; compact?: CompactOptions } = {}) =>
  device(server, { ...opts, version: '1.000' });

const swallow = (e: unknown) => {
  if (String(e).includes('closed') || String(e).includes('InvalidStateError')) return;
  throw e;
};
process.on('unhandledRejection', swallow);
afterAll(() => {
  process.off('unhandledRejection', swallow);
});
afterEach(async () => {
  for (const d of devices.splice(0)) closeDevice(d);
  for (const db of extraDbs.splice(0)) db.close();
});
function closeDevice(d: Device): void {
  d.engine.stop();
  try {
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  } catch {
    // ya cerrada
  }
}

// --- ayudantes ------------------------------------------------------------------------------------------------------

async function edit(d: Device, pageId: string, fn: (t: Y.Text) => void): Promise<void> {
  const doc = await d.docs.open(pageId);
  doc.transact(() => fn(doc.getText('t')), 'test');
  await d.docs.flush(pageId);
  d.docs.close(pageId);
}
const add = (s: string) => (t: Y.Text) => t.insert(t.length, `${s} `);
const del = (s: string) => (t: Y.Text) => {
  const i = t.toString().indexOf(`${s} `);
  if (i >= 0) t.delete(i, s.length + 1);
};

/** Escribe `count` palabras (una fila por palabra); cada tres, borra la anterior. */
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

const serverRows = (server: FakeServer, pageId: string) => (server.updates.get(pageId) ?? []).map((u) => u.data);
function serverText(server: FakeServer, pageId: string): string {
  const doc = new Y.Doc();
  for (const u of serverRows(server, pageId)) Y.applyUpdate(doc, u);
  const out = doc.getText('t').toString();
  doc.destroy();
  return out;
}
function serverDoc(server: FakeServer, pageId: string): Y.Doc {
  const doc = new Y.Doc({ gc: false });
  for (const u of serverRows(server, pageId)) Y.applyUpdate(doc, u);
  return doc;
}
const serverDeletes = (server: FakeServer, pageId: string): DeleteRanges =>
  serverRows(server, pageId).reduce<DeleteRanges>((acc, u) => unionRanges(acc, rangesOf(u)), new Map());
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
const inRows = (server: FakeServer, pageId: string, s: string) =>
  serverRows(server, pageId).some((u) =>
    Y.decodeUpdate(u).structs.some((st) => st instanceof Y.Item && st.content instanceof Y.ContentString && st.content.str.includes(s)),
  );

/** `syncedSV` y `syncedDS` no dicen más de lo que tiene el servidor. */
async function expectSound(d: { db: LocalDb }, server: FakeServer, pageId: string, label = ''): Promise<void> {
  const generation = storedGeneration(await d.db.get('meta', GENERATION_KEY));
  if (generation !== server.settings!.generation) return;
  const s = await state(d, pageId);
  const srv = serverDoc(server, pageId);
  const has = Y.decodeStateVector(Y.encodeStateVector(srv));
  srv.destroy();
  for (const [client, clock] of s?.syncedSV ? Y.decodeStateVector(s.syncedSV) : new Map<number, number>()) {
    expect(clock, `syncedSV dice de más, autor ${client} ${label}`).toBeLessThanOrEqual(has.get(client) ?? 0);
  }
  if (!s) return;
  const known = knownDeletes(s, generation);
  if (!known) return;
  expect([...subtractRanges(rangesOf(known), serverDeletes(server, pageId))], `syncedDS dice de más ${label}`).toEqual([]);
}

/** Al servidor no le falta nada de lo guardado en el dispositivo (ningún elemento): nada escrito quedó sin subir. */
async function expectNothingMissing(d: { db: LocalDb }, server: FakeServer, pageId: string, label = ''): Promise<void> {
  const rows = await stored(d, pageId);
  const local = new Y.Doc({ gc: false });
  if (rows.length > 0) Y.applyUpdate(local, Y.mergeUpdates(rows));
  const srv = serverDoc(server, pageId);
  const has = Y.decodeStateVector(Y.encodeStateVector(srv));
  for (const [client, clock] of Y.decodeStateVector(Y.encodeStateVector(local))) {
    expect(has.get(client) ?? 0, `autor ${client} ${label}`).toBeGreaterThanOrEqual(clock);
  }
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
const valid = (server: FakeServer, pageId: string) =>
  server.snapshots.filter((x) => x.pageId === pageId && x.confirmedAt !== null && x.invalidAt === null);

/** Un snapshot armado a mano (con `mutate`, uno malo) y confirmado. Devuelve su id. */
async function plantSnapshot(
  server: FakeServer,
  pageId: string,
  mutate?: (tail: RemoteUpdate[], doc: Y.Doc) => RemoteUpdate[] | void,
): Promise<string> {
  const remote = new FakeRemote(server, '1.000', 'malo');
  const claim = (await remote.claimCompaction(pageId))!;
  expect(claim).not.toBeNull();
  const base = claim.baseId ? await remote.pullSnapshot(claim.baseId) : null;
  let tail = (await remote.pullUpdates(pageId, claim.baseSeq, 1000)).filter((u) => u.seq <= claim.upToSeq);
  const doc = new Y.Doc({ gc: false });
  if (base) Y.applyUpdate(doc, base);
  tail = mutate?.(tail, doc) ?? tail;
  for (const u of tail) Y.applyUpdate(doc, u.data);
  const st = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  const sha = await sha256Hex(st);
  const pushed = await remote.pushSnapshot({ pageId, baseId: claim.baseId, upToSeq: claim.upToSeq, lastUpdateId: claim.lastUpdateId, state: st, sv: Y.encodeStateVectorFromUpdate(st), sha256: sha });
  expect(await remote.confirmSnapshot(pushed.id, sha)).toBe(true);
  return pushed.id;
}
/** Un snapshot malo con un elemento de más ("FANTASMA") delante de `before`. */
const ghost = (before: string) => (tail: RemoteUpdate[], doc: Y.Doc) => {
  for (const u of tail) Y.applyUpdate(doc, u.data);
  const t = doc.getText('t');
  t.insert(t.toString().indexOf(`${before} `), 'FANTASMA ');
  return [];
};
/** Un snapshot malo con un borrado de más (la palabra `word`). */
const dropWord = (word: string) => (tail: RemoteUpdate[], doc: Y.Doc) => {
  for (const u of tail) Y.applyUpdate(doc, u.data);
  del(word)(doc.getText('t'));
  return [];
};

async function setup({ snapshots = true, edits = 12 }: { snapshots?: boolean; edits?: number } = {}) {
  const server = new FakeServer();
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

/** Un fallo de red: la bajada se corta. */
const networkDown = () => new RemoteError('Failed to fetch', false, undefined, true);

// --- R-1: la marca del rearmado, guardada -------------------------------------------------------------------------

describe('R-1: la marca del rearmado se guarda con el rearmado', () => {
  it('la app se cierra entre el rearmado y el final de la bajada: lo escrito al lado del elemento de más llega a todos (AUD-R4)', async () => {
    const { server, e1, page } = await setup({ edits: 9 });
    const bad = await plantSnapshot(server, page, ghost('palabra3'));
    const dbName = crypto.randomUUID();
    const c = await device(server, { dbName });
    await c.engine.syncNow();
    expect((await state(c, page))?.snapshotId).toBe(bad);
    await edit(c, page, (t) => t.insert(t.toString().indexOf('FANTASMA ') + 9, 'MIO '));
    await c.engine.syncNow();
    expect(inRows(server, page, 'MIO')).toBe(true);
    await new FakeRemote(server, '1.000').invalidateSnapshot(bad, 'test');
    // El rearmado empieza y la bajada se corta enseguida; después se cierra la app.
    const orig = c.remote.pullContent.bind(c.remote);
    c.remote.pullContent = async () => {
      throw networkDown();
    };
    await c.docs.pullPage(page, c.remote, { contentEpoch: server.smeta(page).epoch }).catch(() => undefined);
    c.remote.pullContent = orig;
    const mid = await state(c, page);
    expect(mid?.snapshotId).toBeUndefined();
    expect(mid?.rebuilt).toBe(true);
    closeDevice(c);
    // Se vuelve a abrir la app (misma base local).
    const c2 = await device(server, { dbName });
    for (let i = 0; i < 3; i++) await c2.engine.syncNow();
    await e1.engine.syncNow();
    expect(serverText(server, page)).toContain('FANTASMA MIO');
    expect(await text(c2, page)).toBe(serverText(server, page));
    expect(await text(e1, page)).toBe(serverText(server, page));
    expect((await state(c2, page))?.rebuilt).toBeUndefined();
    await expectSound(c2, server, page);
    await expectNothingMissing(c2, server, page);
  });

  it('la app se cierra con la bajada ya completa y antes de marcar la subida: el ciclo vuelve a bajar la página marcada y la termina', async () => {
    const { server, e1, page } = await setup({ edits: 9 });
    const bad = await plantSnapshot(server, page, ghost('palabra3'));
    const dbName = crypto.randomUUID();
    const c = await device(server, { dbName });
    await c.engine.syncNow();
    await edit(c, page, (t) => t.insert(t.toString().indexOf('FANTASMA ') + 9, 'MIO '));
    await c.engine.syncNow();
    await new FakeRemote(server, '1.000').invalidateSnapshot(bad, 'test');
    // La bajada termina entera, pero la app se cierra justo antes de mirar qué subir (`settleRebuild`).
    const docs = c.docs as unknown as { settleRebuild: (p: string) => Promise<void> };
    docs.settleRebuild = async () => {
      throw new Error('cerrada');
    };
    await c.docs.pullPage(page, c.remote, { contentEpoch: server.smeta(page).epoch }).catch(() => undefined);
    const mid = await state(c, page);
    expect(mid?.cursor).toBe(server.pages.get(page)!.update_seq);
    expect(mid?.rebuilt).toBe(true);
    closeDevice(c);
    // Otro escribe mientras tanto (las filas que faltan no cambian nada: la página ya estaba al día).
    const c2 = await device(server, { dbName });
    for (let i = 0; i < 2; i++) await c2.engine.syncNow();
    await e1.engine.syncNow();
    expect((await state(c2, page))?.rebuilt).toBeUndefined();
    expect(await text(c2, page)).toBe(serverText(server, page));
    expect(await text(e1, page)).toBe(serverText(server, page));
    expect(serverText(server, page)).toContain('MIO');
    await expectNothingMissing(c2, server, page);
    await expectSound(c2, server, page);
  });

  it('una página rearmada sin nada de más: la marca se borra y no sube nada', async () => {
    const { server, page } = await setup({ edits: 9 });
    const bad = await plantSnapshot(server, page, dropWord('palabra3'));
    const c = await device(server);
    await c.engine.syncNow();
    expect(await text(c, page)).not.toContain('palabra3 ');
    await new FakeRemote(server, '1.000').invalidateSnapshot(bad, 'test');
    const rows = server.updates.get(page)!.length;
    await c.engine.syncNow();
    await c.engine.syncNow();
    expect(await text(c, page)).toBe(serverText(server, page));
    expect(serverText(server, page)).toContain('palabra3 ');
    expect(server.updates.get(page)!.length).toBe(rows);
    expect((await state(c, page))?.rebuilt).toBeUndefined();
  });

  it('restaurar una copia con un snapshot aplicado guarda la marca con los elementos (keepElementsForRestore)', async () => {
    const { server, page } = await setup({ edits: 9 });
    await plantSnapshot(server, page);
    const c = await device(server);
    await c.engine.syncNow();
    expect((await state(c, page))?.snapshotId).toBeDefined();
    await c.docs.resetForRestore();
    const s = await state(c, page);
    expect(s?.rebuilt).toBe(true);
    expect(s?.snapshotId).toBeUndefined();
    await c.docs.pullPage(page, c.remote);
    expect((await state(c, page))?.rebuilt).toBeUndefined();
  });
});

// --- R-2: olvidar syncedSV una vez por época ------------------------------------------------------------------------

describe('R-2: la espera olvida syncedSV una sola vez por época', () => {
  it('tres bajadas seguidas con algo propio sin subir: la página sube entera una vez, después solo lo nuevo (AUD-R1)', async () => {
    const { server, e1, page } = await setup({ edits: 30 });
    const bad = await plantSnapshot(server, page, dropWord('palabra6'));
    const c = await device(server);
    await c.engine.syncNow();
    expect((await state(c, page))?.snapshotId).toBe(bad);
    await edit(c, page, add('normal'));
    await c.docs.pushPage(page, c.remote);
    const normal = server.updates.get(page)!.at(-1)!.data.length;
    await new FakeRemote(server, '1.000').invalidateSnapshot(bad, 'test');
    const before = server.updates.get(page)!.length;
    const epoch = server.smeta(page).epoch;
    for (let i = 0; i < 3; i++) {
      await edit(c, page, add(`propia${i}`));
      await c.docs.pullPage(page, c.remote, { contentEpoch: epoch });
      expect((await state(c, page))?.forgotSyncedForEpoch).toBe(epoch);
      await c.docs.pushPage(page, c.remote);
    }
    const sizes = server.updates.get(page)!.slice(before).map((u) => u.data.length);
    expect(sizes).toHaveLength(3);
    // La primera lleva la página entera; las otras dos, solo lo nuevo (antes de R-2: 521, 544 y 567 bytes).
    expect(sizes[0]).toBeGreaterThan(normal * 5);
    expect(sizes[1]).toBeLessThan(normal * 3);
    expect(sizes[2]).toBeLessThan(normal * 3);
    await c.engine.syncNow();
    await c.engine.syncNow();
    await e1.engine.syncNow();
    expect(serverText(server, page)).toContain('palabra6 ');
    for (let i = 0; i < 3; i++) expect(serverText(server, page)).toContain(`propia${i}`);
    expect(await text(c, page)).toBe(serverText(server, page));
    expect(await text(e1, page)).toBe(serverText(server, page));
    const s = await state(c, page);
    expect(s?.forgotSyncedForEpoch).toBeUndefined();
    expect(s?.contentEpoch).toBe(epoch);
    await expectSound(c, server, page);
    await expectNothingMissing(c, server, page);
  });

  it('con una época nueva durante la espera, vuelve a olvidar (una vez por época, no una vez para siempre)', async () => {
    const { server, page } = await setup({ edits: 12 });
    const bad = await plantSnapshot(server, page, ghost('palabra3'));
    const c = await device(server);
    await c.engine.syncNow();
    await new FakeRemote(server, '1.000').invalidateSnapshot(bad, 'test');
    await edit(c, page, add('a'));
    await c.docs.pullPage(page, c.remote, { contentEpoch: server.smeta(page).epoch });
    expect((await state(c, page))?.syncedSV).toBeUndefined();
    await c.docs.pushPage(page, c.remote);
    expect((await state(c, page))?.syncedSV).toBeDefined();
    await edit(c, page, add('b'));
    await c.docs.pullPage(page, c.remote, { contentEpoch: server.smeta(page).epoch });
    expect((await state(c, page))?.syncedSV).toBeDefined();
    // Otra época (otra invalidación): se olvida de nuevo.
    await c.docs.pullPage(page, c.remote, { contentEpoch: server.smeta(page).epoch + 1 });
    const s = await state(c, page);
    expect(s?.syncedSV).toBeUndefined();
    expect(s?.forgotSyncedForEpoch).toBe(server.smeta(page).epoch + 1);
  });
});

// --- O-D: la huella del snapshot --------------------------------------------------------------------------------------

describe('O-D: un snapshot que no coincide con su huella', () => {
  /** Cambia los bytes guardados de un snapshot sin tocar su huella (una copia que se corrompió en la base). */
  function corrupt(server: FakeServer, id: string, state: Uint8Array): void {
    server.snapshots.find((x) => x.id === id)!.state = state;
  }

  it('legible pero distinto (le falta un pedazo): un dispositivo nuevo no lo aplica, lo invalida y baja las filas', async () => {
    const { server, e1, page } = await setup({ edits: 12 });
    const id = await plantSnapshot(server, page);
    // Otro snapshot válido de Yjs, con lo de las primeras filas solamente.
    const partial = new Y.Doc({ gc: false });
    for (const u of serverRows(server, page).slice(0, 3)) Y.applyUpdate(partial, u);
    corrupt(server, id, Y.encodeStateAsUpdate(partial));
    partial.destroy();
    const n = await device(server);
    const calls = recordContent(n);
    await n.engine.syncNow();
    expect(servedSnapshot(calls)).toBe(true);
    expect(await text(n, page)).toBe(serverText(server, page));
    expect(await text(n, page)).toBe(await text(e1, page));
    expect((await state(n, page))?.snapshotId).toBeUndefined();
    expect(server.snapshots.find((x) => x.id === id)!.invalidAt).not.toBeNull();
    expect(server.snapshots.find((x) => x.id === id)!.invalidReason).toBe('corrupt: sha256');
    expect(server.smeta(page).epoch).toBe(1);
    await expectSound(n, server, page);
    // Otro dispositivo nuevo ya no lo recibe.
    const m = await device(server);
    const mc = recordContent(m);
    await m.engine.syncNow();
    expect(servedSnapshot(mc)).toBe(false);
    expect(await text(m, page)).toBe(serverText(server, page));
  });

  it('bytes rotos: no se aplica, se invalida y se baja en filas', async () => {
    const { server, page } = await setup({ edits: 12 });
    const id = await plantSnapshot(server, page);
    const sn = server.snapshots.find((x) => x.id === id)!;
    corrupt(server, id, sn.state.slice(0, Math.floor(sn.state.length / 2)));
    const n = await device(server);
    await n.engine.syncNow();
    expect(await text(n, page)).toBe(serverText(server, page));
    expect(sn.invalidAt).not.toBeNull();
    expect((await state(n, page))?.unreadable).toBeUndefined();
  });

  it('ilegible pero con la huella bien (de una versión más nueva): no se invalida y se baja en filas', async () => {
    const { server, page } = await setup({ edits: 12 });
    const id = await plantSnapshot(server, page);
    const sn = server.snapshots.find((x) => x.id === id)!;
    const odd = new Uint8Array([250, 1, 2, 3, 4, 5, 6, 7]);
    sn.state = odd;
    sn.sha256 = await sha256Hex(odd);
    const n = await device(server);
    await n.engine.syncNow();
    expect(await text(n, page)).toBe(serverText(server, page));
    expect(sn.invalidAt).toBeNull();
    expect(server.smeta(page).epoch).toBe(0);
  });

  it('quien no puede invalidar (sin permiso): igual no lo aplica y baja las filas', async () => {
    const { server, page } = await setup({ edits: 12 });
    const id = await plantSnapshot(server, page);
    const partial = new Y.Doc({ gc: false });
    Y.applyUpdate(partial, serverRows(server, page)[0]);
    corrupt(server, id, Y.encodeStateAsUpdate(partial));
    partial.destroy();
    const n = await device(server);
    n.remote.invalidateSnapshot = async () => {
      throw new RemoteError('not_allowed', true, '42501');
    };
    await n.engine.syncNow();
    expect(await text(n, page)).toBe(serverText(server, page));
    expect((await state(n, page))?.snapshotId).toBeUndefined();
  });

  it('quien compacta con una base corrupta: invalida la cadena y la próxima compactación arranca desde la fila 1', async () => {
    const { server, e1, page } = await setup({ edits: 12 });
    const k = await compactor(server, { compact: { minRows: 5, fullCheckEvery: 1000 } });
    await k.engine.syncNow();
    const [first] = valid(server, page);
    expect(first).toBeDefined();
    const partial = new Y.Doc({ gc: false });
    Y.applyUpdate(partial, serverRows(server, page)[0]);
    first.state = Y.encodeStateAsUpdate(partial);
    partial.destroy();
    await type(e1, page, 8, 'mas');
    const claim = (await k.remote.claimCompaction(page))!;
    expect(claim.baseId).toBe(first.id);
    const out = await compactPage(k.remote, page, claim, { fullCheckEvery: 1000 });
    expect(out).toEqual({ kind: 'invalidated', reason: 'corrupt base' });
    expect(first.invalidAt).not.toBeNull();
    // La próxima, desde la fila 1 y sin base.
    const again = (await k.remote.claimCompaction(page))!;
    expect(again.baseId).toBeNull();
    expect((await compactPage(k.remote, page, again, { fullCheckEvery: 1000 })).kind).toBe('confirmed');
    const n = await device(server);
    await n.engine.syncNow();
    expect(await text(n, page)).toBe(serverText(server, page));
  });

  it('sin la migración de la entrega 3: quien compacta baja la base sin huella (como antes) y el dispositivo baja filas', async () => {
    const { server, page } = await setup({ edits: 12 });
    server.prenderMissing = true;
    const k = await compactor(server);
    await k.engine.syncNow();
    expect(valid(server, page)).toHaveLength(1);
    const n = await device(server);
    const calls = recordContent(n);
    await n.engine.syncNow();
    expect(servedSnapshot(calls)).toBe(false);
    expect(server.contentCalls).toContain('pull_page_updates');
    expect(await text(n, page)).toBe(serverText(server, page));
  });
});

// --- las versiones v0.127 a v0.133 nunca reciben un snapshot ----------------------------------------------------------

describe('pull_page_content sin versión (v0.127 a v0.133): nunca un snapshot', () => {
  it('con los snapshots prendidos y uno vigente, la versión anterior baja filas con la época; el snapshot malo invalidado no le cambia nada', async () => {
    const { server, e1, page } = await setup({ edits: 12 });
    const bad = await plantSnapshot(server, page, dropWord('palabra3'));
    const old = await device(server);
    old.remote.legacyContent = true;
    const calls = recordContent(old);
    await old.engine.syncNow();
    expect(server.contentCalls).toContain('pull_page_content');
    expect(servedSnapshot(calls)).toBe(false);
    expect(calls.flat().every((u) => u.contentEpoch === 0 && u.snapshotSha256 === undefined)).toBe(true);
    expect(await text(old, page)).toContain('palabra3 ');
    await edit(old, page, add('vieja'));
    await new FakeRemote(server, '1.000').invalidateSnapshot(bad, 'test');
    await old.engine.syncNow();
    await e1.engine.syncNow();
    expect(await text(old, page)).toBe(serverText(server, page));
    expect(serverText(server, page)).toContain('palabra3 ');
    expect(serverText(server, page)).toContain('vieja ');
    expect((await state(old, page))?.snapshotId).toBeUndefined();
    await expectNothingMissing(old, server, page);
  });

  it('una versión con la mínima por encima no recibe snapshots por la de con versión', async () => {
    const { server, page } = await setup({ edits: 12 });
    await plantSnapshot(server, page);
    const r = new FakeRemote(server, '0.124');
    await r.fetchWorkspaceSettings();
    expect((await r.pullContent(page, 0, 500)).some((u) => u.snapshotId)).toBe(true);
    server.settings = { ...server.settings!, minAppVersion: 0.2 };
    expect((await r.pullContent(page, 0, 500)).some((u) => u.snapshotId)).toBe(false);
  });
});

// --- D142: restaurar empieza por anularlas todas -----------------------------------------------------------------------

describe('D142: restaurar empieza por anular todas las copias resumidas', () => {
  it('la época de cada página con una cadena válida sube, la tabla queda vacía y la época nunca vuelve atrás', async () => {
    const { server, e1, page } = await setup({ edits: 12 });
    const other = await e1.tree.create(null, 'Q');
    await e1.engine.syncNow();
    await plantSnapshot(server, page);
    const restore = server.backup();
    await type(e1, page, 3, 'despues');
    restore();
    expect(server.snapshots).toEqual([]);
    expect(server.smeta(page).epoch).toBe(1);
    expect(server.smeta(other).epoch).toBe(0);
    expect(server.smeta(page).seq).toBe(0);
  });

  it('un dispositivo que aplicó un snapshot malo sin detectar y baja antes de ver la generación nueva: se rearma sin subir el borrado malo', async () => {
    const { server, e1, page } = await setup({ edits: 12 });
    await plantSnapshot(server, page, dropWord('palabra3'));
    const c = await device(server);
    await c.engine.syncNow();
    expect(await text(c, page)).not.toContain('palabra3 ');
    const restore = server.backup();
    restore();
    // Baja la página directo (sin el ciclo, que vería la generación primero): la época nueva alcanza.
    await c.docs.pullPage(page, c.remote, { contentEpoch: server.smeta(page).epoch });
    for (let i = 0; i < 3; i++) {
      await c.engine.syncNow();
      await e1.engine.syncNow();
    }
    expect(serverText(server, page)).toContain('palabra3 ');
    expect(await text(c, page)).toBe(serverText(server, page));
    expect(await text(e1, page)).toBe(serverText(server, page));
  });
});

// --- dos dispositivos: uno sin snapshots y uno nuevo, sin red y con red --------------------------------------------------

describe('dos dispositivos (uno de una versión sin snapshots y uno nuevo), sin red y con red: nada se pierde ni se oculta', () => {
  for (const seed of [1, 2, 3]) {
    it(`semilla ${seed}: una copia mala detectada por la comparación desde cero y rearmada`, async () => {
      const { server, e1, page } = await setup({ edits: 12 });
      // El dispositivo viejo: la versión publicada v0.100 (solo pull_page_updates, no sabe de snapshots).
      const oldDb = await openLocalDb(crypto.randomUUID());
      extraDbs.push(oldDb);
      const old = new V100PageDocs(oldDb, { normalize: mergeRootGroups, seed: seedIfEmpty });
      const oldRemote = new FakeRemote(server, '0.100', 'old');
      await old.pullPage(page, oldRemote);
      // Una copia mala (le falta "palabra3", un borrado de más) que nadie notó todavía.
      const bad = await plantSnapshot(server, page, seed === 2 ? ghost('palabra6') : dropWord('palabra3'));
      // El dispositivo nuevo la baja.
      const n = await device(server);
      await n.engine.syncNow();
      expect((await state(n, page))?.snapshotId).toBe(bad);
      // Los dos escriben sin red.
      await edit(n, page, add(`nuevo${seed}`));
      if (seed === 3) await edit(n, page, del('palabra8'));
      const doc = await old.open(page);
      doc.transact(() => doc.getText('t').insert(doc.getText('t').length, `viejo${seed} `));
      await old.flush(page);
      old.close(page);
      // Mientras tanto, el editor escribe con red y quien compacta detecta la copia mala desde cero.
      await type(e1, page, 20, 'mas');
      const k = await compactor(server);
      await k.engine.syncNow();
      expect(server.snapshots.find((x) => x.id === bad)!.invalidAt).not.toBeNull();
      // Vuelve la red: todos sincronizan, en cualquier orden.
      await old.pushPage(page, oldRemote);
      await n.engine.syncNow();
      await old.pullPage(page, oldRemote);
      for (let i = 0; i < 3; i++) {
        await n.engine.syncNow();
        await e1.engine.syncNow();
        await k.engine.syncNow();
        await old.pushPage(page, oldRemote);
        await old.pullPage(page, oldRemote);
      }
      const visible = serverText(server, page);
      // Nada escrito se perdió: lo de los dos sin red y lo del editor.
      expect(visible).toContain(`nuevo${seed} `);
      expect(visible).toContain(`viejo${seed} `);
      for (let i = 0; i < 20; i++) if (i % 3 !== 1 || i === 19) expect(visible).toContain(`mas${i} `);
      // El borrado de la copia mala no llegó a nadie (lo legítimo, sí).
      if (seed !== 2) expect(visible).toContain('palabra3 ');
      if (seed === 3) expect(visible).not.toContain('palabra8 ');
      // Nada se oculta: todos muestran lo mismo que las filas del servidor, también un dispositivo nuevo.
      expect(await text(n, page)).toBe(visible);
      expect(await text(e1, page)).toBe(visible);
      expect(await text({ db: oldDb }, page)).toBe(visible);
      const fresh = await device(server);
      await fresh.engine.syncNow();
      expect(await text(fresh, page)).toBe(visible);
      for (const d of [n, e1, k, fresh]) {
        await expectSound(d, server, page, `semilla ${seed}`);
        await expectNothingMissing(d, server, page, `semilla ${seed}`);
      }
      await expectNothingMissing({ db: oldDb }, server, page, `semilla ${seed}, viejo`);
    });
  }
});

// --- el cliente de verdad -------------------------------------------------------------------------------------------------

describe('SupabaseRemote: pull_page_content con la versión y la huella', () => {
  function fakeBase(opts: { missing?: boolean }) {
    const bodies: { path: string; body: unknown }[] = [];
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    const fetchFn: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const path = url.pathname.replace('/rest/v1/', '');
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      bodies.push({ path, body });
      if (path === 'workspace_settings') {
        return json(200, [{ id: true, generation: 1, min_app_version: null, schema_version: 17, media_url: null, snapshot_min_version: '0.500' }]);
      }
      if (opts.missing && (path === 'rpc/pull_page_content' || path === 'rpc/pull_page_snapshot_checked')) {
        return json(404, { code: 'PGRST202', message: `Could not find the function public.${path.slice(4)}` });
      }
      if (path === 'rpc/pull_page_content') {
        return json(200, [
          { seq: '7', update: 'AAA=', snapshot_id: 'a1b2', content_epoch: '3', sha256: 'ABCDEF' },
          { seq: 8, update: 'AAA=', snapshot_id: null, content_epoch: 3, sha256: null },
        ]);
      }
      if (path === 'rpc/pull_page_updates') return json(200, [{ seq: 1, update: 'AAA=' }]);
      if (path === 'rpc/pull_page_snapshot_checked') return json(200, [{ state: 'AAA=', sha256: 'ABC' }]);
      return json(404, { code: 'PGRST202', message: `no ${path}` });
    };
    const client = createClient('https://example.supabase.co', 'sb_publishable_test', {
      global: { fetch: fetchFn },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    return { remote: new SupabaseRemote(client, '0.200'), bodies };
  }

  it('manda la versión y lee la huella del snapshot (solo en la fila del snapshot)', async () => {
    const { remote, bodies } = fakeBase({});
    await remote.fetchWorkspaceSettings();
    const rows = await remote.pullContent('p', 0, 500);
    expect(bodies.find((b) => b.path === 'rpc/pull_page_content')?.body).toEqual({ p_page_id: 'p', p_after_seq: 0, p_limit: 500, p_app_version: '0.200' });
    expect(rows.map((r) => [r.seq, r.snapshotId, r.contentEpoch, r.snapshotSha256])).toEqual([[7, 'a1b2', 3, 'abcdef'], [8, undefined, 3, undefined]]);
    expect(await remote.pullSnapshotChecked('x')).toEqual({ state: new Uint8Array([0, 0]), sha256: 'abc' });
    expect(bodies.find((b) => b.path === 'rpc/pull_page_snapshot_checked')?.body).toEqual({ p_id: 'x' });
  });

  it('una base sin la migración de la entrega 3: filas por pull_page_updates, y la base de quien compacta sin huella', async () => {
    const { remote, bodies } = fakeBase({ missing: true });
    await remote.fetchWorkspaceSettings();
    expect((await remote.pullContent('p', 0, 500)).map((r) => r.seq)).toEqual([1]);
    await remote.pullContent('p', 1, 500);
    expect(bodies.filter((b) => b.path.startsWith('rpc/')).map((b) => b.path)).toEqual([
      'rpc/pull_page_content',
      'rpc/pull_page_updates',
      'rpc/pull_page_updates',
    ]);
    expect(await remote.pullSnapshotChecked('x')).toBeNull();
  });
});
