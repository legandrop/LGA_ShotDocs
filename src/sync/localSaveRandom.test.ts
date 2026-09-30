import { afterAll, afterEach, describe, expect, it } from 'vitest';
import * as Y from '@y/y';
import { PageDocs as PublishedPageDocs } from './fixtures/publishedDocs';
import { DIRTY_PREFIX, dirtyRange, type LocalDb } from './localDb';
import { mergeRootGroups, seedIfEmpty } from './structure';
import { FakeRemote, FakeServer, makeDevice, microtasks, watchTransactions, type Device } from './testing';

// Guardado local y subida, al azar (roadmap B.5). Un dispositivo escribe en varias páginas, sube y baja, se
// cierra de golpe en cualquier microtarea (con subidas en vuelo), a veces vuelve con la versión publicada
// (fixtures/publishedDocs.ts) sobre la misma base, se compacta, se restaura el servidor, y otro dispositivo
// escribe en las mismas páginas. Invariantes: todo lo que llegó a IndexedDB termina en el servidor y en los
// demás dispositivos, sin updates que no se puedan integrar; lo que está en la base y no en el servidor
// figura pendiente (también para la versión publicada); y al final no queda nada pendiente.
//
// Más corridas: LOCAL_SAVE_SEEDS=200 LOCAL_SAVE_STEPS=60 npx vitest run src/sync/localSaveRandom.test.ts

/** La versión publicada sobre la misma base (sin motor: solo el contenido). */
interface LegacyDevice {
  db: LocalDb;
  docs: PublishedPageDocs;
  remote: FakeRemote;
  engine?: undefined;
}

async function makeLegacy(server: FakeServer, dbName: string): Promise<LegacyDevice> {
  const { openLocalDb } = await import('./fixtures/publishedLocalDb');
  const db = (await openLocalDb(dbName)) as unknown as LocalDb;
  const docs = new PublishedPageDocs(db as never, { normalize: mergeRootGroups, seed: seedIfEmpty });
  return { db, docs, remote: new FakeRemote(server, '0.029') };
}

/** Lo que hacía el ciclo de main con el contenido: sube lo pendiente y baja todo. */
async function legacySync(l: LegacyDevice, pageIds: string[]): Promise<void> {
  for (const pageId of await l.docs.unsyncedPages()) await l.docs.pushPage(pageId, l.remote);
  for (const pageId of pageIds) await l.docs.pullPage(pageId, l.remote);
}

async function readText(docs: { open(id: string): Promise<Y.Doc>; close(id: string): void }, pageId: string): Promise<{ text: string; pending: boolean }> {
  const doc = await docs.open(pageId);
  const text = doc.get('t').toString();
  const pending = doc.store.pendingStructs !== null || doc.store.pendingDs !== null;
  docs.close(pageId);
  return { text, pending };
}

async function freshFromServer(server: FakeServer, pageId: string, keep: Device[]): Promise<{ text: string; pending: boolean }> {
  const c = await makeDevice(server);
  keep.push(c);
  await c.engine.syncNow();
  return readText(c.docs, pageId);
}

/** Lo guardado en IndexedDB, armado directamente con Yjs (sin PageDocs). */
async function savedText(db: LocalDb, pageId: string): Promise<{ text: string; pending: boolean; rows: number }> {
  const rows = await db.getAllFromIndex('docUpdates', 'pageId', pageId);
  const doc = new Y.Doc();
  if (rows.length > 0) Y.applyUpdate(doc, Y.mergeUpdates(rows.map((r) => r.data)));
  const out = { text: doc.get('t').toString(), pending: doc.store.pendingStructs !== null, rows: rows.length };
  doc.destroy();
  return out;
}

/** PRNG con semilla (mulberry32). */
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

const SEEDS = Number(process.env.LOCAL_SAVE_SEEDS ?? 16);
const STEPS = Number(process.env.LOCAL_SAVE_STEPS ?? 45);

// Lo que queda corriendo en un dispositivo "matado" (p. ej. refreshCounts) choca con la base cerrada.
const swallow = (e: unknown) => {
  const name = (e as { name?: string })?.name;
  if (name === 'InvalidStateError' || name === 'AbortError' || name === 'TransactionInactiveError') return;
  throw e;
};
process.on('unhandledRejection', swallow);
afterAll(() => {
  process.off('unhandledRejection', swallow);
});

const cleanup: { db: { close(): void }; engine?: { stop(): void } }[] = [];
afterEach(() => {
  for (const d of cleanup.splice(0)) {
    d.engine?.stop();
    try {
      d.db.close();
    } catch {
      // ya cerrada
    }
  }
});

type Current = { kind: 'new'; d: Device } | { kind: 'legacy'; d: LegacyDevice };

async function runSeed(seed: number): Promise<string[]> {
  const log: string[] = [];
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const server = new FakeServer();
  const dbName = `local-save-${seed}-${crypto.randomUUID()}`;
  let cur: Current = { kind: 'new', d: await makeDevice(server, dbName) };
  cleanup.push(cur.d);
  const pages: string[] = [];
  for (let i = 0; i < 3; i++) pages.push(await (cur.d as Device).tree.create(null, `P${i}`));
  await (cur.d as Device).engine.syncNow();
  const other = await makeDevice(server);
  cleanup.push(other);
  await other.engine.syncNow();

  /** Todo lo que se vio guardado en IndexedDB (de cualquiera de los dos dispositivos). */
  const mustHave = new Map<string, Set<string>>(pages.map((p) => [p, new Set()]));
  /** Lo que se vio en la base de ESTE dispositivo (lo guardado solo crece: nunca puede desaparecer). */
  const localSeen = new Map<string, Set<string>>(pages.map((p) => [p, new Set()]));
  let open = new Map<string, Y.Doc>();
  let tok = 0;
  let restoreFn: (() => void) | null = null;
  const token = () => `[${seed}.${tok++}]`;
  const docsOf = (c: Current) => c.d.docs as unknown as { open(id: string): Promise<Y.Doc>; close(id: string): void; flush(id?: string): Promise<void> };

  const edit = async (pageId: string) => {
    let doc = open.get(pageId);
    if (!doc) {
      doc = await docsOf(cur).open(pageId);
      open.set(pageId, doc);
    }
    const t = doc.get('t');
    const s = token();
    t.insert(t.length, s);
    return s;
  };
  const absorbSaved = async () => {
    for (const p of pages) {
      const saved = await savedText(cur.d.db, p);
      if (saved.pending) log.push(`pendingStructs en IndexedDB de ${p}`);
      for (const s of localSeen.get(p)!) if (!saved.text.includes(s)) log.push(`PERDIDO de IndexedDB: ${s} en ${p}`);
      for (const m of saved.text.match(/\[[0-9.]+\]/g) ?? []) {
        mustHave.get(p)!.add(m);
        localSeen.get(p)!.add(m);
      }
    }
  };
  const closeAll = async () => {
    for (const p of open.keys()) docsOf(cur).close(p);
    open = new Map();
    await docsOf(cur).flush();
  };
  let restoredSinceSync = false;
  /** Lo que está en la base y no en el servidor tiene que figurar pendiente (si no, nadie lo sube). */
  const checkPending = async (label: string) => {
    // También lo que ve la versión publicada. Después de restaurar, hasta que la actual sincroniza, no: el
    // motor todavía no vio la generación nueva.
    if (restoredSinceSync) return;
    const unsynced = new Set(await cur.d.docs.unsyncedPages());
    for (const p of pages) {
      const rows = await cur.d.db.getAllFromIndex('docUpdates', 'pageId', p);
      const local = new Y.Doc();
      if (rows.length > 0) Y.applyUpdate(local, Y.mergeUpdates(rows.map((row) => row.data)));
      const srv = new Y.Doc();
      const list = server.updates.get(p) ?? [];
      if (list.length > 0) Y.applyUpdate(srv, Y.mergeUpdates(list.map((u) => u.data)));
      let changed = false;
      srv.on('update', () => (changed = true));
      Y.applyUpdate(srv, Y.encodeStateAsUpdate(local));
      if (changed && !unsynced.has(p)) log.push(`FUERA DE PENDIENTE (${cur.kind}): ${p} tras ${label}`);
      local.destroy();
      srv.destroy();
    }
  };
  const reopen = async (legacy: boolean) => {
    // La versión publicada de acá no tiene motor: nunca vería la generación nueva de una restauración.
    if (legacy && !restoredSinceSync) {
      const l = await makeLegacy(server, dbName);
      cleanup.push(l);
      cur = { kind: 'legacy', d: l };
    } else {
      const d = await makeDevice(server, dbName);
      cleanup.push(d);
      cur = { kind: 'new', d };
    }
    open = new Map();
    await absorbSaved();
  };
  const kill = async (after: number, withSync: boolean) => {
    const watch = watchTransactions();
    try {
      if (withSync) {
        if (cur.kind === 'new') void cur.d.engine.syncNow().catch(() => undefined);
        else void legacySync((cur as { d: LegacyDevice }).d, pages).catch(() => undefined);
      }
      await microtasks(after);
      await watch.kill(cur.d);
    } finally {
      watch.restore();
    }
    open = new Map();
  };

  for (let step = 0; step < STEPS; step++) {
    const x = r();
    if (x < 0.4) {
      // Ediciones, a veces varias en la misma tarea, a veces en microtareas separadas.
      const n = 1 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        await edit(pick(pages));
        if (r() < 0.5) await microtasks(Math.floor(r() * 5));
      }
      log.push(`edit${n}`);
      if (r() < 0.5) {
        await docsOf(cur).flush();
        await absorbSaved();
      }
    } else if (x < 0.55) {
      // Sincronizar (a veces sin red o perdiendo la respuesta).
      server.online = r() > 0.2;
      server.loseNextPushResponse = r() < 0.2;
      if (cur.kind === 'new') await cur.d.engine.syncNow().catch(() => undefined);
      else await legacySync((cur as { d: LegacyDevice }).d, pages).catch(() => undefined);
      log.push(`sync ${cur.kind}`);
      if (cur.kind === 'new' && server.online && !server.loseNextPushResponse) restoredSinceSync = false;
      server.online = true;
      server.loseNextPushResponse = false;
      await checkPending('sync');
    } else if (x < 0.75) {
      // Cierre de golpe en una microtarea al azar, con o sin subida en vuelo, justo después de escribir.
      if (r() < 0.8) await edit(pick(pages));
      if (r() < 0.3) await edit(pick(pages));
      const after = Math.floor(r() * 60);
      const withSync = r() < 0.5;
      server.loseNextPushResponse = r() < 0.2;
      await kill(after, withSync);
      server.loseNextPushResponse = false;
      log.push(`kill@${after}${withSync ? '+sync' : ''}`);
      await reopen(r() < 0.3);
      log.push(cur.kind);
      await checkPending('reabrir');
    } else if (x < 0.8) {
      // Edición MIENTRAS viaja una subida, y cierre de golpe unas microtareas después de la respuesta.
      const remote = cur.d.remote;
      const real = remote.pushUpdate.bind(remote);
      let pushed!: () => void;
      const done = new Promise<void>((res) => (pushed = res));
      const macro = r() < 0.5;
      remote.pushUpdate = async (...args) => {
        remote.pushUpdate = real;
        await edit(pick(pages));
        if (macro) await new Promise((res) => setTimeout(res, 1));
        else await microtasks(3);
        try {
          return await real(...args);
        } finally {
          pushed();
        }
      };
      server.loseNextPushResponse = r() < 0.2;
      const watch = watchTransactions();
      try {
        if (cur.kind === 'new') void cur.d.engine.syncNow().catch(() => undefined);
        else void legacySync((cur as { d: LegacyDevice }).d, pages).catch(() => undefined);
        await Promise.race([done, new Promise((res) => setTimeout(res, 50))]);
        const after = Math.floor(r() * 40);
        await microtasks(after);
        await watch.kill(cur.d);
        log.push(`pushkill@${after}${macro ? 'M' : 'm'}`);
      } finally {
        watch.restore();
        remote.pushUpdate = real;
        server.loseNextPushResponse = false;
      }
      open = new Map();
      await reopen(r() < 0.3);
      log.push(cur.kind);
      await checkPending('reabrir');
    } else if (x < 0.85) {
      // Muchas filas en una página y reabrirla: compacta (>64).
      const p = pick(pages);
      for (let i = 0; i < 70; i++) {
        await edit(p);
        await docsOf(cur).flush(p);
      }
      await closeAll();
      await absorbSaved();
      const doc = await docsOf(cur).open(p);
      open.set(p, doc);
      log.push(`compact ${p} rows=${(await savedText(cur.d.db, p)).rows}`);
    } else if (x < 0.9) {
      // El otro dispositivo escribe y sincroniza.
      const p = pick(pages);
      const doc = await other.docs.open(p);
      const s = token();
      doc.get('t').insert(doc.get('t').length, s);
      await other.docs.flush(p);
      other.docs.close(p);
      mustHave.get(p)!.add(s);
      log.push('other');
      await other.engine.syncNow().catch(() => undefined);
    } else if (x < 0.95) {
      // Copia de seguridad / restaurarla.
      if (!restoreFn) {
        restoreFn = server.backup();
        log.push('backup');
      } else if (cur.kind !== 'new') {
        // Solo con la actual abierta (ver `reopen`).
        log.push('restore later');
      } else {
        restoreFn();
        restoreFn = null;
        restoredSinceSync = true;
        log.push('restore');
      }
    } else {
      // Cierre ordenado y vuelta (a veces con la versión publicada).
      await closeAll();
      cur.d.docs.dispose();
      if (cur.kind === 'new') cur.d.engine.stop();
      cur.d.db.close();
      await new Promise((res) => setTimeout(res, 5));
      await reopen(r() < 0.4);
      log.push(`reopen ${cur.kind}`);
    }
  }

  // Final: vuelve la versión nueva, con red, y todo tiene que quedar arriba.
  await closeAll();
  cur.d.docs.dispose();
  if (cur.kind === 'new') cur.d.engine.stop();
  cur.d.db.close();
  await new Promise((res) => setTimeout(res, 5));
  await reopen(false);
  const d = (cur as { d: Device }).d;
  server.online = true;
  for (let i = 0; i < 4; i++) {
    await d.engine.syncNow();
    await other.engine.syncNow();
  }
  const problems: string[] = [];
  if (d.engine.getStatus().pendingPages !== 0) problems.push(`pendingPages=${d.engine.getStatus().pendingPages}`);
  const marks = await d.db.getAllKeys('meta', dirtyRange());
  if (marks.length > 0) problems.push(`marcas: ${marks.map((k) => String(k).slice(DIRTY_PREFIX.length)).join(',')}`);
  const beforeRows = [...server.updates.values()].reduce((n, l) => n + l.length, 0);
  await d.engine.syncNow();
  const afterRows = [...server.updates.values()].reduce((n, l) => n + l.length, 0);
  if (afterRows !== beforeRows) problems.push(`sigue subiendo: ${afterRows - beforeRows} filas en un ciclo sin cambios`);
  for (const p of pages) {
    const fresh = await freshFromServer(server, p, cleanup as never);
    const mine = await readText(d.docs, p);
    const theirs = await readText(other.docs, p);
    for (const s of mustHave.get(p)!) {
      if (!fresh.text.includes(s)) problems.push(`falta en el servidor: ${s} (${p})`);
      if (!theirs.text.includes(s)) problems.push(`falta en el otro dispositivo: ${s} (${p})`);
      if (!mine.text.includes(s)) problems.push(`falta en el dispositivo: ${s} (${p})`);
    }
    if (fresh.pending || mine.pending || theirs.pending) problems.push(`pendingStructs (${p})`);
    if (fresh.text !== theirs.text) problems.push(`difieren servidor/otro en ${p}`);
  }
  const bad = log.filter((l) => /PERDIDO|pendingStructs|FUERA/.test(l));
  return [...bad, ...problems].map((pr) => `${pr}  [seed ${seed}; ${log.filter((l) => !/PERDIDO|pending|FUERA/.test(l)).join(' ')}]`);
}

describe('guardado local y subida, al azar', () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    it(`semilla ${seed}`, async () => {
      expect(await runSeed(seed)).toEqual([]);
    }, 60_000);
  }
});
