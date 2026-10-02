import { createClient } from '@supabase/supabase-js';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { compareDocs, docFromUpdate, type CompactOptions } from './compact';
import { rangesOf, subtractRanges, unionRanges, type DeleteRanges } from './deleteSets';
import { PageDocs as V100PageDocs } from './fixtures/v100/docs';
import { GENERATION_KEY, openLocalDb, storedGeneration, updateDocState, type LocalDb } from './localDb';
import { knownDeletes } from './docs';
import { SupabaseRemote } from './remote';
import { mergeRootGroups, seedIfEmpty } from './structure';
import { FakeRemote, FakeServer, makeDevice, sha256Hex, type Device } from './testing';
import { RemoteError, REQUEST_TIMEOUT, type RemoteUpdate } from './types';

// Compactar, entrega 2: el dispositivo de quien edita arma los snapshots (Docs/Doc_Compactar.md, secciones 4 y 15,
// pruebas 2 y 3). Con el motor de verdad (`SyncEngine`, `PageDocs`, IndexedDB en memoria) y el servidor en memoria con
// las reglas de 20261019120000_compactar_leer.sql. Quien escribe usa una versión que no compacta (0.124, la mínima de
// los snapshots es 0.5); quien compacta, la 1.000, con la pista del árbol en 5 filas como el servidor.

const devices: Device[] = [];
const extraDbs: LocalDb[] = [];
const COMPACT: CompactOptions = { minRows: 5, fullCheckEvery: 1 };

async function device(
  server: FakeServer,
  opts: { id?: string; dbName?: string; version?: string; compact?: CompactOptions } = {},
): Promise<Device> {
  const d = await makeDevice(
    server,
    opts.dbName,
    opts.version ?? '0.124',
    {},
    undefined,
    opts.id ? { id: opts.id } : {},
    opts.compact ?? COMPACT,
  );
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

function serverRows(server: FakeServer, pageId: string): Uint8Array[] {
  return (server.updates.get(pageId) ?? []).map((u) => u.data);
}
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
function serverDeletes(server: FakeServer, pageId: string): DeleteRanges {
  return serverRows(server, pageId).reduce<DeleteRanges>((acc, u) => unionRanges(acc, rangesOf(u)), new Map());
}
/** Huella de `page_updates` de la página (seq, id y bytes): nada de compactar la puede cambiar. */
async function rowsPrint(server: FakeServer, pageId: string): Promise<string> {
  const parts = await Promise.all(
    (server.updates.get(pageId) ?? []).map(async (u) => `${u.seq}:${u.id ?? ''}:${await sha256Hex(u.data)}`),
  );
  return parts.join(',');
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

/**
 * `syncedSV` y `syncedDS` no dicen más de lo que tiene el servidor. Un dispositivo que todavía no vio una restauración
 * (otra generación) no cuenta: sus cuentas se borran en cuanto la ve (`resetForRestore`).
 */
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
  expect([...subtractRanges(rangesOf(Y.encodeStateAsUpdate(local)), serverDeletes(server, pageId))]).toEqual([]);
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

/** Cuenta los pedidos de reserva del dispositivo. */
function countClaims(d: Device): { n: number } {
  const counter = { n: 0 };
  const orig = d.remote.claimCompaction.bind(d.remote);
  d.remote.claimCompaction = async (pageId) => {
    counter.n++;
    return orig(pageId);
  };
  return counter;
}

const confirmed = (server: FakeServer, pageId: string) =>
  server.snapshots.filter((x) => x.pageId === pageId && x.confirmedAt !== null && x.invalidAt === null);

/**
 * Un snapshot armado "a mano" en el servidor (como en la entrega 1), con `mutate` para armar uno malo (al que le falta
 * una fila o con un borrado de más). Devuelve el id confirmado.
 */
async function badSnapshot(server: FakeServer, pageId: string, mutate: (tail: RemoteUpdate[], doc: Y.Doc) => RemoteUpdate[] | void): Promise<string> {
  const remote = new FakeRemote(server, '1.000', 'malo');
  if (server.team) {
    server.addMember('malo', 'member');
    server.grant('malo', { pageId }, 'edit');
  }
  const claim = (await remote.claimCompaction(pageId))!;
  const base = claim.baseId ? await remote.pullSnapshot(claim.baseId) : null;
  let tail = (await remote.pullUpdates(pageId, claim.baseSeq, 1000)).filter((u) => u.seq <= claim.upToSeq);
  const doc = new Y.Doc({ gc: false });
  if (base) Y.applyUpdate(doc, base);
  tail = mutate(tail, doc) ?? tail;
  for (const u of tail) Y.applyUpdate(doc, u.data);
  const st = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  const sha = await sha256Hex(st);
  const pushed = await remote.pushSnapshot({ pageId, baseId: claim.baseId, upToSeq: claim.upToSeq, lastUpdateId: claim.lastUpdateId, state: st, sv: Y.encodeStateVectorFromUpdate(st), sha256: sha });
  expect(await remote.confirmSnapshot(pushed.id, sha)).toBe(true);
  return pushed.id;
}

/** Un servidor con los snapshots prendidos (desde 0.5; la reserva desde 5 filas) y un editor con una página escrita. */
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

// --- cuándo se compacta ------------------------------------------------------------------------------------------

describe('cuándo compacta el dispositivo', () => {
  it('apagados, sin la migración o con una versión menor que la mínima: nunca pide reservar', async () => {
    for (const how of ['off', 'unmigrated', 'old'] as const) {
      const server = new FakeServer();
      if (how === 'off') server.migrateSnapshots();
      if (how === 'old') server.enableSnapshots(2);
      server.snapshotMinRows = 5;
      server.snapshotMinTailBytes = 1;
      const e1 = await device(server);
      const page = await e1.tree.create(null, 'P');
      await e1.engine.syncNow();
      await type(e1, page, 8, 'w');
      const k = await compactor(server);
      const claims = countClaims(k);
      await k.engine.syncNow();
      await k.engine.syncNow();
      expect(claims.n, how).toBe(0);
      expect(server.snapshots, how).toEqual([]);
      expect(k.compactions, how).toEqual([]);
    }
  });

  it('prendidos: arma, comprueba, sube y confirma; page_updates no cambia; un dispositivo nuevo lo baja y ve lo mismo', async () => {
    const { server, page } = await setup();
    const before = await rowsPrint(server, page);
    const k = await compactor(server);
    await k.engine.syncNow();
    expect(k.compactions.map((c) => c.outcome.kind)).toEqual(['confirmed']);
    const [sn] = confirmed(server, page);
    expect(sn.upToSeq).toBe(server.pages.get(page)!.update_seq);
    expect(sn.baseId).toBeNull();
    expect(sn.appVersion).toBe(1);
    expect(server.smeta(page).seq).toBe(sn.upToSeq);
    // El snapshot es lo mismo que las filas (los dos caminos, desde afuera).
    const fromRows = serverDoc(server, page);
    const fromSnap = docFromUpdate(sn.state);
    expect(compareDocs(fromRows, fromSnap)).toBeNull();
    fromRows.destroy();
    fromSnap.destroy();
    // Nunca se borra ni se cambia una fila.
    expect(await rowsPrint(server, page)).toBe(before);
    const c = await device(server);
    const calls = recordContent(c);
    await c.engine.syncNow();
    expect(servedSnapshot(calls)).toBe(true);
    expect(await text(c, page)).toBe(serverText(server, page));
    await expectSound(c, server, page);
  });

  it('incremental sobre el anterior, en la misma cadena, con la comparación desde cero; sin cola nueva no vuelve a pedir', async () => {
    const { server, e1, page } = await setup();
    const k = await compactor(server);
    await k.engine.syncNow();
    const first = confirmed(server, page)[0];
    await type(e1, page, 8, 'mas');
    await k.engine.syncNow();
    expect(k.compactions.map((c) => c.outcome)).toEqual([
      expect.objectContaining({ kind: 'confirmed', fullCheck: false }),
      expect.objectContaining({ kind: 'confirmed', fullCheck: true }),
    ]);
    const second = confirmed(server, page).find((x) => x.id !== first.id)!;
    expect(second.baseId).toBe(first.id);
    expect(second.chainId).toBe(first.chainId);
    // Sin cola nueva no se vuelve a pedir la reserva.
    const claims = countClaims(k);
    await k.engine.syncNow();
    expect(claims.n).toBe(0);
    const c = await device(server);
    await c.engine.syncNow();
    expect(await text(c, page)).toBe(serverText(server, page));
  });

  it('como mucho una página por ciclo', async () => {
    const { server, e1, page } = await setup();
    const other = await e1.tree.create(null, 'Q');
    await e1.engine.syncNow();
    await type(e1, other, 12, 'q');
    const k = await compactor(server);
    await k.engine.syncNow();
    expect(k.compactions).toHaveLength(1);
    await k.engine.syncNow();
    expect(k.compactions.map((c) => c.pageId).sort()).toEqual([page, other].sort());
  });

  it('quien no ve lo borrado (Ver, un invitado con Editar) no pide reservar', async () => {
    const { server, page } = await setup({ team: true });
    server.addMember('v', 'member');
    server.grant('v', { pageId: page }, 'view');
    server.addMember('g', 'guest');
    server.grant('g', { pageId: page }, 'edit');
    for (const uid of ['v', 'g']) {
      const d = await compactor(server, { id: uid });
      const claims = countClaims(d);
      await d.engine.syncNow();
      await d.engine.syncNow();
      expect(claims.n, uid).toBe(0);
    }
    expect(server.snapshots).toEqual([]);
    // Un miembro con Editar sí.
    server.addMember('e', 'member');
    server.grant('e', { pageId: page }, 'edit');
    const e = await compactor(server, { id: 'e' });
    await e.engine.syncNow();
    expect(e.compactions.map((c) => c.outcome.kind)).toEqual(['confirmed']);
  });

  it('ni una página en la papelera, ni una rechazada, ni una que el dispositivo no tiene entera', async () => {
    const { server, e1, page } = await setup();
    const k = await compactor(server);
    await k.engine.syncNow();
    expect(k.compactions).toHaveLength(1);
    const claims = countClaims(k);
    // No la tiene entera: hay filas nuevas y la bajada de esa página no llega.
    await type(e1, page, 8, 'r');
    const pull = k.docs.pullPage.bind(k.docs);
    k.docs.pullPage = async (id, remote, opts) => (id === page ? 0 : pull(id, remote, opts));
    await k.engine.syncNow();
    expect(claims.n).toBe(0);
    k.docs.pullPage = pull;
    await k.engine.syncNow();
    expect(k.compactions).toHaveLength(2);
    // Rechazada.
    await type(e1, page, 8, 's');
    await updateDocState(k.db, page, (s) => {
      s.rejected = 'too large';
    });
    const before = claims.n;
    await k.engine.syncNow();
    expect(claims.n).toBe(before);
    await updateDocState(k.db, page, (s) => {
      s.rejected = undefined;
    });
    // En la papelera.
    await e1.tree.trash(page);
    await e1.engine.syncNow();
    await k.engine.syncNow();
    expect(claims.n).toBe(before);
  });
});

// --- lo que no se puede compactar ----------------------------------------------------------------------------------

describe('lo que no se puede compactar se saltea (24 horas, con el motivo) y no se sube nada', () => {
  it('un snapshot que no pasa la comprobación por los dos caminos (un error del compactador)', async () => {
    const { server, e1, page } = await setup();
    // El error: el snapshot armado pierde un renglón antes de comprobarlo.
    const tamper = (snap: Uint8Array) => {
      const d = docFromUpdate(snap);
      d.getText('t').delete(0, 3);
      const out = Y.encodeStateAsUpdate(d);
      d.destroy();
      return out;
    };
    const k = await compactor(server, { compact: { ...COMPACT, tamper } });
    const errors: unknown[] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      await k.engine.syncNow();
    } finally {
      console.error = orig;
    }
    expect(k.compactions[0].outcome).toEqual({ kind: 'skipped', reason: expect.stringMatching(/^check: /) });
    expect(errors).toHaveLength(1);
    expect(server.snapshots).toEqual([]);
    expect(server.compaction.get(page)?.skipWhy).toMatch(/^check: /);
    // No se reintenta: la base no da la reserva por 24 horas.
    await type(e1, page, 60, 'mas');
    const claims = countClaims(k);
    await k.engine.syncNow();
    expect(claims.n).toBeLessThanOrEqual(1);
    expect(server.snapshots).toEqual([]);
  });

  it('más de 8 MB', async () => {
    const { server, page } = await setup();
    const k = await compactor(server, { compact: { ...COMPACT, tamper: () => new Uint8Array(8 * 1024 * 1024 + 1) } });
    await k.engine.syncNow();
    expect(k.compactions[0].outcome).toEqual({ kind: 'skipped', reason: 'too large' });
    expect(server.compaction.get(page)?.skipWhy).toBe('too large');
    expect(server.snapshots).toEqual([]);
  });

  it('una fila del servidor que esta versión no puede leer', async () => {
    const { server, e1, page } = await setup({ edits: 4 });
    await new FakeRemote(server, '0.124').pushUpdate(page, crypto.randomUUID(), new Uint8Array([200, 1, 2, 3]));
    await type(e1, page, 4, 'mas');
    const bad = server.pages.get(page)!.update_seq - 4;
    const k = await compactor(server);
    await k.engine.syncNow();
    expect(k.compactions[0].outcome).toEqual({ kind: 'skipped', reason: `unreadable row ${bad}` });
    expect(server.snapshots).toEqual([]);
  });

  it('un salto en las filas que baja (una respuesta rara): no arma con un hueco', async () => {
    const { server, page } = await setup();
    const k = await compactor(server);
    const orig = k.remote.pullUpdates.bind(k.remote);
    k.remote.pullUpdates = async (id, after, limit) => (await orig(id, after, limit)).filter((u) => u.seq !== 3);
    await k.engine.syncNow();
    expect(k.compactions.map((c) => c.outcome)).toEqual([{ kind: 'skipped', reason: 'rows: expected 3, got 4' }]);
    expect(server.compaction.get(page)?.skipWhy).toBe('rows: expected 3, got 4');
    expect(server.snapshots).toEqual([]);
  });
});

// --- la cadena y la comparación desde cero --------------------------------------------------------------------------

describe('la comparación desde cero', () => {
  it('encuentra una cadena mala: la invalida, la época sube, y quien la usó se rearma con lo del servidor', async () => {
    const { server, e1, page } = await setup();
    // Un snapshot malo (le falta la fila 3) ya confirmado, y un dispositivo que lo bajó.
    const bad = await badSnapshot(server, page, (tail) => tail.filter((u) => u.seq !== 3));
    const c = await device(server);
    await c.engine.syncNow();
    expect((await state(c, page))?.snapshotId).toBe(bad);
    expect(await text(c, page)).not.toBe(serverText(server, page));
    await type(e1, page, 8, 'mas');
    const k = await compactor(server);
    const errors: unknown[] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      await k.engine.syncNow();
    } finally {
      console.error = orig;
    }
    expect(k.compactions[0].outcome.kind).toBe('invalidated');
    expect(errors).toHaveLength(1);
    expect(server.snapshots.find((x) => x.id === bad)?.invalidAt).not.toBeNull();
    expect(server.smeta(page).epoch).toBe(1);
    expect(confirmed(server, page)).toEqual([]);
    // La próxima arranca desde la fila 1, buena.
    await k.engine.syncNow();
    expect(k.compactions[1].outcome.kind).toBe('confirmed');
    expect(confirmed(server, page)[0].baseId).toBeNull();
    // c se rearma (no tenía nada sin subir) y queda igual al servidor, sin subir nada.
    const rows = server.updates.get(page)!.length;
    await c.engine.syncNow();
    expect(await text(c, page)).toBe(serverText(server, page));
    expect(server.updates.get(page)!.length).toBe(rows);
    await expectSound(c, server, page);
  });

  it('determinista por tramo: con la comparación cada 10, los dos dispositivos del mismo tramo deciden lo mismo', async () => {
    const { server, e1, page } = await setup();
    const k = await compactor(server, { compact: { minRows: 5 } });
    await k.engine.syncNow();
    for (let i = 0; i < 6; i++) {
      await type(e1, page, 6, `v${i}`);
      await k.engine.syncNow();
    }
    const outcomes = k.compactions.map((c) => c.outcome);
    expect(outcomes.every((o) => o.kind === 'confirmed')).toBe(true);
    // Sin forzarla, casi nunca corre (1 de cada 10 en promedio); la cadena sigue siendo una.
    expect(new Set(server.snapshots.filter((x) => x.invalidAt === null).map((x) => x.chainId)).size).toBe(1);
  });
});

// --- reintentos, carreras y respuestas perdidas ----------------------------------------------------------------------

describe('reintentos: nada se duplica y lo sin confirmar nunca se sirve', () => {
  const lost = () => new RemoteError('Failed to fetch', false, undefined, true);

  it('sin respuesta al confirmar: no se sirve; el ciclo siguiente devuelve el mismo snapshot y lo confirma', async () => {
    const { server, page } = await setup();
    const k = await compactor(server);
    const orig = k.remote.confirmSnapshot.bind(k.remote);
    let drop = true;
    k.remote.confirmSnapshot = async (id, sha) => {
      if (drop) {
        drop = false;
        throw lost();
      }
      return orig(id, sha);
    };
    await k.engine.syncNow();
    expect(k.compactions).toEqual([]);
    expect(server.snapshots).toHaveLength(1);
    expect(server.snapshots[0].pageId).toBe(page);
    expect(server.snapshots[0].confirmedAt).toBeNull();
    // Sin confirmar no se sirve.
    const c = await device(server);
    const calls = recordContent(c);
    await c.engine.syncNow();
    expect(servedSnapshot(calls)).toBe(false);
    await k.engine.syncNow();
    expect(k.compactions.map((x) => x.outcome.kind)).toEqual(['confirmed']);
    expect(server.snapshots).toHaveLength(1);
    expect(server.snapshots[0].confirmedAt).not.toBeNull();
  });

  it('filas que vuelven a subir la página entera desde un dispositivo con GC: el snapshot conserva el texto borrado', async () => {
    const { server, e1, page } = await setup({ edits: 6 });
    // Un dispositivo con GC (una versión vieja, o después de restaurar una copia) sube el documento entero: lo borrado
    // va como hueco. Armado con `mergeUpdates` se quedaría con esa copia y perdería el texto de las versiones del medio.
    const gc = new Y.Doc();
    for (const u of serverRows(server, page)) Y.applyUpdate(gc, u);
    await new FakeRemote(server, '0.124').pushUpdate(page, crypto.randomUUID(), Y.encodeStateAsUpdate(gc));
    gc.destroy();
    await type(e1, page, 4, 'mas');
    const k = await compactor(server);
    await k.engine.syncNow();
    expect(k.compactions.map((c) => c.outcome.kind)).toEqual(['confirmed']);
    const [sn] = confirmed(server, page);
    const fromRows = serverDoc(server, page);
    const fromSnap = docFromUpdate(sn.state);
    expect(compareDocs(fromRows, fromSnap)).toBeNull();
    // "palabra1" (borrada por el que escribe) conserva su texto en el snapshot.
    const deleted: string[] = [];
    for (const structs of fromSnap.store.clients.values()) {
      for (const st of structs) if (st instanceof Y.Item && st.deleted && st.content instanceof Y.ContentString) deleted.push(st.content.str);
    }
    expect(deleted.join('')).toContain('palabra1');
    fromRows.destroy();
    fromSnap.destroy();
  });

  it('la vuelta no coincide con lo que se subió: no se confirma ni se sirve', async () => {
    const { server, page } = await setup();
    const k = await compactor(server);
    const orig = k.remote.pullSnapshot.bind(k.remote);
    k.remote.pullSnapshot = async (id) => {
      const got = await orig(id);
      got[got.length - 1] ^= 1;
      return got;
    };
    const errors: unknown[] = [];
    const log = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      await k.engine.syncNow();
    } finally {
      console.error = log;
    }
    expect(k.compactions.map((x) => x.outcome)).toEqual([{ kind: 'skipped', reason: 'check: round trip' }]);
    expect(errors).toHaveLength(1);
    expect(server.snapshots.every((x) => x.confirmedAt === null)).toBe(true);
    expect(server.currentSnapshot(page)).toBeNull();
  });

  it('un invitado con Editar no invalida (no ve lo borrado; auditoría de la entrega 1, O3); un miembro con Editar sí', async () => {
    const { server, page } = await setup({ team: true });
    const k = await compactor(server);
    await k.engine.syncNow();
    const [sn] = confirmed(server, page);
    server.addMember('g', 'guest');
    server.grant('g', { pageId: page }, 'edit');
    await expect(new FakeRemote(server, '1.000', 'g').invalidateSnapshot(sn.id, 'x')).rejects.toThrow('not_allowed');
    expect(server.smeta(page).epoch).toBe(0);
    server.addMember('e', 'member');
    server.grant('e', { pageId: page }, 'edit');
    expect(await new FakeRemote(server, '1.000', 'e').invalidateSnapshot(sn.id, 'x')).toBe(true);
    expect(server.smeta(page).epoch).toBe(1);
  });

  it('la respuesta de la subida se pierde: el reintento no duplica', async () => {
    const { server, page } = await setup();
    const k = await compactor(server);
    const orig = k.remote.pushSnapshot.bind(k.remote);
    let drop = true;
    k.remote.pushSnapshot = async (n) => {
      const r = await orig(n);
      if (drop) {
        drop = false;
        throw lost();
      }
      return r;
    };
    await k.engine.syncNow();
    await k.engine.syncNow();
    expect(k.compactions.map((x) => x.outcome.kind)).toEqual(['confirmed']);
    expect(server.snapshots.filter((x) => x.pageId === page)).toHaveLength(1);
  });

  it('dos dispositivos de la misma persona compactan a la vez: la misma huella, un solo snapshot', async () => {
    const { server, page } = await setup();
    const k1 = await compactor(server);
    const k2 = await compactor(server);
    await Promise.all([k1.engine.syncNow(), k2.engine.syncNow()]);
    const kinds = [...k1.compactions, ...k2.compactions].map((x) => x.outcome.kind);
    expect(kinds).toContain('confirmed');
    expect(server.snapshots.filter((x) => x.pageId === page)).toHaveLength(1);
    expect(confirmed(server, page)).toHaveLength(1);
  });

  it('otro dispositivo de la misma versión subió otra cosa para el mismo tramo: los dos quedan invalidados', async () => {
    const { server, page } = await setup();
    const k = await compactor(server);
    // Lo que subió "el otro" (sin confirmar todavía): mismo tramo y misma base, otra huella.
    const other = new FakeRemote(server, '1.000');
    const claim = (await other.claimCompaction(page))!;
    const junk = Y.encodeStateAsUpdate(new Y.Doc());
    await other.pushSnapshot({ pageId: page, baseId: null, upToSeq: claim.upToSeq, lastUpdateId: claim.lastUpdateId, state: junk, sv: new Uint8Array([0]), sha256: await sha256Hex(junk) });
    const errors: unknown[] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      await k.engine.syncNow();
    } finally {
      console.error = orig;
    }
    expect(k.compactions.map((x) => x.outcome.kind)).toEqual(['mismatch']);
    expect(server.snapshots.every((x) => x.invalidAt !== null)).toBe(true);
    expect(errors).toHaveLength(1);
  });

  it('otra versión de la app ya armó el mismo tramo: no se invalida nada', async () => {
    const { server, page } = await setup();
    const k = await compactor(server);
    const other = new FakeRemote(server, '1.001');
    const claim = (await other.claimCompaction(page))!;
    const junk = Y.encodeStateAsUpdate(new Y.Doc());
    await other.pushSnapshot({ pageId: page, baseId: null, upToSeq: claim.upToSeq, lastUpdateId: claim.lastUpdateId, state: junk, sv: new Uint8Array([0]), sha256: await sha256Hex(junk) });
    await k.engine.syncNow();
    expect(k.compactions.map((x) => x.outcome.kind)).toEqual(['exists']);
    expect(server.snapshots.every((x) => x.invalidAt === null)).toBe(true);
  });

  it('lo que el compactador tiene sin subir no entra: el snapshot sale de las filas del servidor', async () => {
    const { server, page } = await setup();
    const k = await compactor(server);
    await k.engine.syncNow();
    expect(k.compactions).toHaveLength(1);
    // k escribe y la subida vence el tope de tiempo (el ciclo sigue con lo demás); después compacta igual.
    const orig = k.remote.pushUpdate.bind(k.remote);
    k.remote.pushUpdate = async () => {
      throw new RemoteError(REQUEST_TIMEOUT, false, REQUEST_TIMEOUT);
    };
    await edit(k, page, add('propia'));
    const e = await device(server);
    await type(e, page, 8, 'otra');
    await k.engine.syncNow();
    expect(k.compactions.map((x) => x.outcome.kind)).toEqual(['confirmed', 'confirmed']);
    const latest = confirmed(server, page).sort((a, b) => b.upToSeq - a.upToSeq)[0];
    const doc = docFromUpdate(latest.state);
    expect(doc.getText('t').toString()).not.toContain('propia');
    const fromRows = serverDoc(server, page);
    expect(compareDocs(fromRows, doc)).toBeNull();
    doc.destroy();
    fromRows.destroy();
    k.remote.pushUpdate = orig;
    await k.engine.syncNow();
    expect(serverText(server, page)).toContain('propia');
  });
});

/** ¿Alguna fila del servidor trae este texto (aunque no se vea)? */
function inRows(server: FakeServer, pageId: string, s: string): boolean {
  return serverRows(server, pageId).some((u) =>
    Y.decodeUpdate(u).structs.some((st) => st instanceof Y.Item && st.content instanceof Y.ContentString && st.content.str.includes(s)),
  );
}

describe('D110 con un snapshot malo que trae un elemento de más (auditoría de la entrega 2, O-A)', () => {
  it('lo escrito sin red al lado del elemento fantasma (rama que espera) sigue visible en el servidor y en todos', async () => {
    const { server, e1, page } = await setup({ edits: 9 });
    const b = await device(server);
    await b.engine.syncNow();
    // El snapshot malo: las filas + "FANTASMA" (un elemento que ninguna fila tiene, de otro autor de Yjs).
    const bad = await badSnapshot(server, page, (tail, doc) => {
      for (const u of tail) Y.applyUpdate(doc, u.data);
      const t = doc.getText('t');
      t.insert(t.toString().indexOf('palabra4 '), 'FANTASMA ');
      return [];
    });
    const c = await device(server);
    await c.engine.syncNow();
    expect((await state(c, page))?.snapshotId).toBe(bad);
    expect(await text(c, page)).toContain('FANTASMA');
    // c escribe sin red, justo después del fantasma.
    server.online = false;
    await edit(c, page, (t) => t.insert(t.toString().indexOf('FANTASMA ') + 9, 'MIO '));
    server.online = true;
    expect(await text(c, page)).toContain('FANTASMA MIO');
    await new FakeRemote(server, '1.000').invalidateSnapshot(bad, 'test');
    await edit(e1, page, add('ajena'));
    await e1.engine.syncNow();
    for (let i = 0; i < 4; i++) await c.engine.syncNow();
    await b.engine.syncNow();
    await e1.engine.syncNow();
    // Lo que escribió c tiene que verse en algún lado.
    const visible = { server: serverText(server, page), c: await text(c, page), b: await text(b, page), e1: await text(e1, page) };
    expect(visible.server).toContain('MIO');
    expect(visible.c).toContain('MIO');
    expect(visible.b).toContain('MIO');
    expect(visible.e1).toContain('MIO');
    for (const d of [b, c, e1]) expect(await text(d, page)).toBe(visible.server);
  });

  it('lo escrito con red al lado del elemento fantasma (ya subido; rama que rearma) sigue visible en todos', async () => {
    const { server, e1, page } = await setup({ edits: 9 });
    const bad = await badSnapshot(server, page, (tail, doc) => {
      for (const u of tail) Y.applyUpdate(doc, u.data);
      const t = doc.getText('t');
      t.insert(t.toString().indexOf('palabra4 '), 'FANTASMA ');
      return [];
    });
    const c = await device(server);
    await c.engine.syncNow();
    expect((await state(c, page))?.snapshotId).toBe(bad);
    await edit(c, page, (t) => t.insert(t.toString().indexOf('FANTASMA ') + 9, 'MIO '));
    await c.engine.syncNow();
    expect(inRows(server, page, 'MIO')).toBe(true);
    await e1.engine.syncNow();
    expect(await text(e1, page)).not.toContain('MIO');
    await new FakeRemote(server, '1.000').invalidateSnapshot(bad, 'test');
    for (let i = 0; i < 3; i++) await c.engine.syncNow();
    await e1.engine.syncNow();
    const visible = { server: serverText(server, page), c: await text(c, page), e1: await text(e1, page) };
    expect(inRows(server, page, 'MIO')).toBe(true);
    expect(visible.c).toContain('MIO');
    expect(visible.server).toContain('MIO');
    expect(visible.e1).toContain('MIO');
    expect(visible.c).toBe(visible.server);
    // Sobra texto antes que falte: el elemento del snapshot malo queda en todos (los borrados malos, no).
    expect(visible.server).toContain('FANTASMA');
    await expectSound(c, server, page);
    await expectNothingMissing(c, server, page);
  });
});

describe('D110 con un snapshot malo que trae un elemento de más: la espera y el aviso', () => {
  it('una bajada mientras hay algo sin subir olvida syncedSV: la subida siguiente ya lleva el elemento y lo propio se ve', async () => {
    const { server, page } = await setup({ edits: 9 });
    const bad = await badSnapshot(server, page, (tail, doc) => {
      for (const u of tail) Y.applyUpdate(doc, u.data);
      const t = doc.getText('t');
      t.insert(t.toString().indexOf('palabra4 '), 'FANTASMA ');
      return [];
    });
    const c = await device(server);
    await c.engine.syncNow();
    server.online = false;
    await edit(c, page, (t) => t.insert(t.toString().indexOf('FANTASMA ') + 9, 'MIO '));
    server.online = true;
    await new FakeRemote(server, '1.000').invalidateSnapshot(bad, 'test');
    // La bajada con la época nueva espera (hay algo sin subir) y la subida que sigue lleva también el elemento.
    await c.docs.pullPage(page, c.remote, { contentEpoch: 1 });
    expect((await state(c, page))?.snapshotId).toBe(bad);
    await c.docs.pushPage(page, c.remote);
    expect(serverText(server, page)).toContain('FANTASMA MIO');
  });

  it('el rearmado no repite el aviso de lo propio que otro borró (lo que baja vuelve a borrar lo mismo)', async () => {
    const { server, e1, page } = await setup();
    // Un párrafo (en un fragmento aparte: la reparación de estructura no lo toca).
    const d = await e1.docs.open(page);
    d.transact(() => {
      const para = new Y.XmlElement('p');
      para.insert(0, [new Y.XmlText('hola')]);
      d.getXmlFragment('f').insert(0, [para]);
    }, 'test');
    await e1.docs.flush(page);
    e1.docs.close(page);
    await e1.engine.syncNow();
    const snap = await badSnapshot(server, page, () => undefined);
    const c = await device(server);
    await c.engine.syncNow();
    expect((await state(c, page))?.snapshotId).toBe(snap);
    // c escribe sin red adentro del párrafo; e1 lo borra; c sube y baja: el aviso de B.16, una vez.
    server.online = false;
    const cd = await c.docs.open(page);
    cd.transact(() => ((cd.getXmlFragment('f').get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(4, ' MIO'), 'test');
    await c.docs.flush(page);
    c.docs.close(page);
    server.online = true;
    const ed = await e1.docs.open(page);
    ed.transact(() => ed.getXmlFragment('f').delete(0, 1), 'test');
    await e1.docs.flush(page);
    e1.docs.close(page);
    await e1.engine.syncNow();
    await c.engine.syncNow();
    expect((await c.docs.removedWriting(page)).map((n) => n.text)).toEqual([' MIO']);
    // Se invalida y c se rearma: lo que baja vuelve a borrar el párrafo; no es un aviso nuevo.
    await new FakeRemote(server, '1.000').invalidateSnapshot(snap, 'test');
    await c.engine.syncNow();
    await c.engine.syncNow();
    expect((await state(c, page))?.snapshotId).toBeUndefined();
    expect(await c.docs.removedWriting(page)).toHaveLength(1);
  });
});

describe('restaurar una copia de la base con un snapshot malo sin invalidar (auditoría de la entrega 2, O-B)', () => {
  it('quien lo aplicó vuelve a subir sus elementos sin sus borrados: lo que el snapshot borró de más no llega a nadie', async () => {
    const { server, e1, page } = await setup({ edits: 6 });
    await badSnapshot(server, page, (tail, doc) => {
      for (const u of tail) Y.applyUpdate(doc, u.data);
      const t = doc.getText('t');
      t.delete(t.toString().indexOf('palabra3 '), 9);
      return [];
    });
    const c = await device(server);
    await c.engine.syncNow();
    expect(await text(c, page)).not.toContain('palabra3');
    const restore = server.backup();
    // Lo escrito después de la copia: vuelve a subir desde quien lo tiene.
    await edit(e1, page, add('despues'));
    await e1.engine.syncNow();
    await c.engine.syncNow();
    restore();
    for (let i = 0; i < 3; i++) {
      await c.engine.syncNow();
      await e1.engine.syncNow();
    }
    const expected = serverText(server, page);
    expect(expected).toContain('palabra3');
    expect(expected).toContain('despues');
    expect(await text(c, page)).toBe(expected);
    expect(await text(e1, page)).toBe(expected);
    await expectSound(c, server, page);
    await expectNothingMissing(e1, server, page);
  });
});

// --- al azar -----------------------------------------------------------------------------------------------------

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

describe('al azar: tres dispositivos que compactan, la versión publicada, snapshots malos, invalidaciones, sin red, respuestas perdidas, cortes y una restauración', () => {
  const seeds = Number(process.env.COMPACT_DEVICE_SEEDS ?? 6);
  const stats = { confirmed: 0, fullChecks: 0, invalidated: 0, bad: 0, served: 0, rebuilt: 0 };
  afterAll(() => {
    console.info(`[compactar al azar] ${seeds} semillas: ${JSON.stringify(stats)}`);
    expect(stats.confirmed).toBeGreaterThan(0);
  });
  for (let seed = 1; seed <= seeds; seed++) {
    it(`semilla ${seed}`, async () => {
      const rnd = rng(seed);
      const pick = <T,>(list: T[]) => list[Math.floor(rnd() * list.length)];
      const { server, e1, page } = await setup({ edits: 2 });
      // Cadenas largas en pocas filas: la reserva desde 3 filas y la comparación desde cero cada 2 (en promedio).
      server.snapshotMinRows = 3;
      const opts = { minRows: 3, fullCheckEvery: 2 };
      const names = [crypto.randomUUID(), crypto.randomUUID()];
      const devs: Device[] = [
        e1,
        await compactor(server, { dbName: names[0], compact: opts }),
        await compactor(server, { dbName: names[1], compact: opts }),
      ];
      const lossy = (d: Device) => {
        // Respuestas perdidas al subir o al confirmar un snapshot (la base hizo lo suyo; el dispositivo no se entera).
        const push = d.remote.pushSnapshot.bind(d.remote);
        const conf = d.remote.confirmSnapshot.bind(d.remote);
        d.remote.pushSnapshot = async (n) => {
          const r = await push(n);
          if (rnd() < 0.15) throw new RemoteError('Failed to fetch', false, undefined, true);
          return r;
        };
        d.remote.confirmSnapshot = async (id, sha) => {
          if (rnd() < 0.1) throw new RemoteError('Failed to fetch', false, undefined, true);
          const r = await conf(id, sha);
          if (rnd() < 0.1) throw new RemoteError('Failed to fetch', false, undefined, true);
          return r;
        };
      };
      lossy(devs[1]);
      lossy(devs[2]);
      const open = new Map<Device, Y.Doc>();
      const docOf = async (d: Device) => {
        if (!open.has(d)) open.set(d, await d.docs.open(page));
        return open.get(d)!;
      };
      const closeAll = (d: Device) => {
        if (open.delete(d)) d.docs.close(page);
      };
      let db = await openLocalDb(crypto.randomUUID());
      extraDbs.push(db);
      let old = new V100PageDocs(db, { normalize: mergeRootGroups, seed: seedIfEmpty });
      const oldRemote = new FakeRemote(server, '0.100', 'old');
      // Lo que escribió la versión publicada desde la copia: el modelo de esa versión no tiene motor (no se entera de una
      // restauración), así que al restaurar se cambia por uno nuevo y eso no se espera.
      let oldSinceBackup: string[] = [];
      // Lo escrito y lo que alguien borró a propósito: al final, todo lo escrito y no borrado tiene que estar.
      const written = new Set<string>();
      const erased = new Set<string>();
      const bad = new Set<string>();
      let restore: (() => void) | null = null;
      // Restaurar una copia con un snapshot malo sin invalidar: quien lo aplicó sube sus elementos sin sus borrados
      // (`resetForRestore`, O-B), así que se mezclan.
      let n = 0;
      for (let step = 0; step < 100; step++) {
        const r = rnd();
        const d = pick(devs);
        const i = devs.indexOf(d);
        if (r < 0.32) {
          const doc = await docOf(d);
          const t = doc.getText('t');
          if (rnd() < 0.75) {
            const w = `s${seed}w${n++}`;
            doc.transact(() => add(w)(t), 'test');
            written.add(w);
          } else {
            const w = `s${seed}w${Math.floor(rnd() * Math.max(n, 1))}`;
            if (t.toString().includes(`${w} `)) {
              doc.transact(() => del(w)(t), 'test');
              erased.add(w);
            }
          }
          await d.docs.flush(page);
        } else if (r < 0.58) {
          await d.engine.syncNow();
        } else if (r < 0.62 && server.online) {
          // Un snapshot malo: le falta una fila, o borra una palabra que nadie borró.
          const missing = rnd() < 0.5;
          const id = await badSnapshot(server, page, (tail, doc) => {
            if (missing) return tail.filter((_, k) => k !== Math.floor(tail.length / 2));
            for (const u of tail) Y.applyUpdate(doc, u.data);
            const t = doc.getText('t');
            const words = t.toString().split(' ').filter(Boolean);
            if (words.length > 0) {
              const w = pick(words);
              t.delete(t.toString().indexOf(`${w} `), w.length + 1);
            }
            return [];
          }).catch(() => null);
          if (id) bad.add(server.snapshots.find((x) => x.id === id)!.chainId);
        } else if (r < 0.66 && server.online) {
          // Alguien invalida la cadena vigente (a mano, o la comparación desde cero de otro).
          const valid = server.currentSnapshot(page);
          if (valid) await new FakeRemote(server, '1.000').invalidateSnapshot(valid.id, 'azar').catch(() => false);
        } else if (r < 0.72) {
          server.online = !server.online;
        } else if (r < 0.78) {
          if (server.online) {
            await old.pullPage(page, oldRemote);
            const doc = await old.open(page);
            const w = `s${seed}o${n++}`;
            doc.getText('t').insert(doc.getText('t').length, `${w} `);
            written.add(w);
            oldSinceBackup.push(w);
            await old.flush(page);
            await old.pushPage(page, oldRemote).catch(() => undefined);
            old.close(page);
          }
        } else if (r < 0.84 && i > 0) {
          // Cerrar y volver a abrir la app (con la misma base).
          closeAll(d);
          await d.docs.flush();
          d.engine.stop();
          d.db.close();
          devs[i] = await compactor(server, { dbName: names[i - 1], compact: opts });
          lossy(devs[i]);
        } else if (r < 0.86 && !restore) {
          restore = server.backup();
          oldSinceBackup = [];
        } else if (r < 0.87 && restore && server.online) {
          // Restaurar la copia (como el script: sin snapshots, la época no vuelve atrás). Lo escrito después de la copia
          // vuelve a subir desde los dispositivos que lo tienen.
          restore();
          restore = null;
          bad.clear();
          for (const w of oldSinceBackup) written.delete(w);
          db = await openLocalDb(crypto.randomUUID());
          extraDbs.push(db);
          old = new V100PageDocs(db, { normalize: mergeRootGroups, seed: seedIfEmpty });
        } else {
          // Un snapshot malo con un borrado de más hace decir de más a `syncedDS` de quien lo aplicó (para eso está la
          // invalidación): esos dispositivos se miran al final.
          for (const x of devs) {
            const applied = (await state(x, page))?.snapshotId;
            const chainOf = server.snapshots.find((sn) => sn.id === applied)?.chainId;
            if (applied && (!chainOf || bad.has(chainOf))) continue;
            await expectSound(x, server, page, `semilla ${seed}, paso ${step}`);
          }
        }
      }
      for (const d of devs) closeAll(d);
      server.online = true;
      // Ninguna cadena mala sigue vigente al final (alguien las invalida: la comparación desde cero o a mano).
      for (const sn of server.snapshots) {
        if (bad.has(sn.chainId) && sn.invalidAt === null) await new FakeRemote(server, '1.000').invalidateSnapshot(sn.id, 'fin');
      }
      for (let round = 0; round < 4; round++) {
        for (const d of devs) await d.engine.syncNow();
        await old.pullPage(page, oldRemote);
        await old.pushPage(page, oldRemote);
      }
      const expected = serverText(server, page);
      stats.confirmed += server.snapshots.filter((x) => x.confirmedAt !== null).length;
      stats.invalidated += server.snapshots.filter((x) => x.invalidAt !== null).length;
      stats.bad += bad.size;
      stats.served += server.snapshotsServed;
      stats.rebuilt += server.smeta(page).epoch;
      for (const d of devs) stats.fullChecks += d.compactions.filter((c) => c.outcome.kind === 'confirmed' && c.outcome.fullCheck).length;
      for (const d of devs) {
        expect(await text(d, page), `semilla ${seed}`).toBe(expected);
        await expectSound(d, server, page, `semilla ${seed}, final`);
        await expectNothingMissing(d, server, page);
      }
      expect(await text({ db }, page)).toBe(expected);
      // Nada escrito se perdió: cada palabra escrita y no borrada a propósito está.
      for (const w of written) if (!erased.has(w)) expect(expected, `semilla ${seed}: falta ${w}`).toContain(`${w} `);
      // Un dispositivo nuevo al final: lo mismo.
      const fresh = await device(server);
      await fresh.engine.syncNow();
      expect(await text(fresh, page)).toBe(expected);
      // Todo snapshot vigente es igual a sus filas.
      const cur = server.currentSnapshot(page);
      if (cur) {
        const a = docFromUpdate(cur.state);
        const b = new Y.Doc({ gc: false });
        for (const u of (server.updates.get(page) ?? []).filter((x) => x.seq <= cur.upToSeq)) Y.applyUpdate(b, u.data);
        expect(compareDocs(b, a)).toBeNull();
        a.destroy();
        b.destroy();
      }
    });
  }
});

// --- el cliente de verdad (SupabaseRemote) con un fetch en memoria ------------------------------------------------------

describe('SupabaseRemote: las funciones de quien compacta', () => {
  function fakeBase(answers: Record<string, { status: number; body: unknown }>) {
    const calls: { path: string; body: Record<string, unknown> }[] = [];
    const fetchFn: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const path = url.pathname.replace('/rest/v1/', '');
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : {} });
      const a = answers[path] ?? { status: 404, body: { code: 'PGRST202', message: `no ${path}` } };
      return new Response(JSON.stringify(a.body), { status: a.status, headers: { 'Content-Type': 'application/json' } });
    };
    const client = createClient('https://example.supabase.co', 'sb_publishable_test', {
      global: { fetch: fetchFn },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    return { remote: new SupabaseRemote(client, '1.000'), calls };
  }

  it('reservar, subir, bajar la vuelta, confirmar, saltear e invalidar: qué pide y cómo lee la respuesta', async () => {
    const { remote, calls } = fakeBase({
      'rpc/claim_page_compaction': { status: 200, body: [{ base_id: null, base_seq: '0', up_to_seq: '120', last_update_id: '9001' }] },
      'rpc/push_page_snapshot': { status: 200, body: [{ snapshot_id: 'snap-1', result: 'ok' }] },
      'rpc/pull_page_snapshot': { status: 200, body: 'AQID' },
      'rpc/confirm_page_snapshot': { status: 200, body: true },
      'rpc/skip_page_compaction': { status: 200, body: null },
      'rpc/invalidate_page_snapshot': { status: 200, body: true },
    });
    expect(await remote.claimCompaction('p')).toEqual({ baseId: null, baseSeq: 0, upToSeq: 120, lastUpdateId: 9001 });
    const state = new Uint8Array([1, 2, 3]);
    expect(
      await remote.pushSnapshot({ pageId: 'p', baseId: null, upToSeq: 120, lastUpdateId: 9001, state, sv: new Uint8Array([0]), sha256: 'ab' }),
    ).toEqual({ id: 'snap-1', result: 'ok' });
    expect([...(await remote.pullSnapshot('snap-1'))]).toEqual([1, 2, 3]);
    expect(await remote.confirmSnapshot('snap-1', 'ab')).toBe(true);
    await remote.skipCompaction('p', 'too large');
    expect(await remote.invalidateSnapshot('snap-1', 'x')).toBe(true);
    expect(calls.map((c) => c.path)).toEqual([
      'rpc/claim_page_compaction',
      'rpc/push_page_snapshot',
      'rpc/pull_page_snapshot',
      'rpc/confirm_page_snapshot',
      'rpc/skip_page_compaction',
      'rpc/invalidate_page_snapshot',
    ]);
    expect(calls[0].body).toEqual({ p_page_id: 'p', p_app_version: '1.000' });
    expect(calls[1].body).toEqual({
      p_page_id: 'p', p_base_id: null, p_up_to_seq: 120, p_last_update_id: 9001, p_state: 'AQID', p_sv: 'AA==', p_sha256: 'ab', p_app_version: '1.000',
    });
    expect(calls[2].body).toEqual({ p_id: 'snap-1' });
    expect(calls[3].body).toEqual({ p_id: 'snap-1', p_sha256: 'ab' });
    expect(calls[4].body).toEqual({ p_page_id: 'p', p_reason: 'too large' });
    // Lo que usa la comparación desde cero para invalidar una cadena mala (auditoría de la entrega 2, O-E).
    expect(calls[5].body).toEqual({ p_id: 'snap-1', p_reason: 'x' });
  });

  it('sin tramo, una base sin la migración y una respuesta rara', async () => {
    expect(await fakeBase({ 'rpc/claim_page_compaction': { status: 200, body: [] } }).remote.claimCompaction('p')).toBeNull();
    expect(await fakeBase({}).remote.claimCompaction('p')).toBeNull();
    const odd = fakeBase({ 'rpc/push_page_snapshot': { status: 200, body: [{ snapshot_id: 's', result: 'otro' }] } });
    await expect(
      odd.remote.pushSnapshot({ pageId: 'p', baseId: null, upToSeq: 1, lastUpdateId: 1, state: new Uint8Array([1]), sv: new Uint8Array([0]), sha256: 'ab' }),
    ).rejects.toThrow(/unexpected answer/);
    const off = fakeBase({ 'rpc/push_page_snapshot': { status: 400, body: { code: 'P0001', message: 'snapshot_off' } } });
    await expect(
      off.remote.pushSnapshot({ pageId: 'p', baseId: null, upToSeq: 1, lastUpdateId: 1, state: new Uint8Array([1]), sv: new Uint8Array([0]), sha256: 'ab' }),
    ).rejects.toThrow(/snapshot_off/);
    expect(await fakeBase({ 'rpc/confirm_page_snapshot': { status: 200, body: false } }).remote.confirmSnapshot('s', 'ab')).toBe(false);
  });
});
