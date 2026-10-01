// B.15 entre versiones: subir solo los borrados nuevos (ver uploadDeletes.test.ts y Docs/Doc_Sincronizacion.md,
// "Subir solo los borrados nuevos") con las versiones anteriores de la app sobre la misma base: la publicada hoy
// (main v0.082, fixtures/mainDocs.ts) y la v0.029 (fixtures/publishedDocs.ts). Dos instancias pueden convivir
// sobre la misma base (la app no lo deja, Web Locks, pero se prueba igual).
//
// Más corridas: DELETES_VERSIONS_SEEDS=300 DELETES_VERSIONS_STEPS=90 npx vitest run src/sync/uploadDeletesVersions.test.ts
// Medir la bajada de una página grande escrita con main: DELETES_PERF=1 (no corre en la suite).
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { knownDeletes } from './docs';
import { buildUpload, encodeRanges, rangesOf, subtractRanges, unionRanges, type DeleteRanges } from './deleteSets';
import { PageDocs as MainPageDocs } from './fixtures/mainDocs';
import { PageDocs as PublishedPageDocs } from './fixtures/publishedDocs';
import { openLocalDb as openPublishedDb } from './fixtures/publishedLocalDb';
import { GENERATION_KEY, openLocalDb, storedGeneration, hasUnsyncedContent, dirtyKey, type LocalDb } from './localDb';
import { mergeRootGroups, normalizeStructure, seedIfEmpty } from './structure';
import { FakeRemote, FakeServer, makeDevice, microtasks, watchTransactions, type Device } from './testing';

const swallow = (e: unknown) => {
  const name = (e as { name?: string })?.name;
  if (name === 'InvalidStateError' || name === 'AbortError' || name === 'TransactionInactiveError') return;
  throw e;
};
process.on('unhandledRejection', swallow);
afterAll(() => {
  process.off('unhandledRejection', swallow);
});

type OldKind = 'main' | 'v029';
interface Old {
  kind: OldKind;
  db: LocalDb;
  docs: MainPageDocs | PublishedPageDocs;
  remote: FakeRemote;
}
type Inst = { kind: 'new'; d: Device } | { kind: OldKind; d: Old };

const opened: { db: LocalDb; stop?: () => void }[] = [];
afterEach(() => {
  for (const o of opened.splice(0)) {
    try {
      o.stop?.();
      o.db.close();
    } catch {
      // ya cerrada
    }
  }
});

async function newDevice(server: FakeServer, dbName: string): Promise<Device> {
  const d = await makeDevice(server, dbName);
  opened.push({ db: d.db, stop: () => d.engine.stop() });
  return d;
}

async function oldDevice(server: FakeServer, dbName: string, kind: OldKind): Promise<Old> {
  if (kind === 'main') {
    const db = await openLocalDb(dbName);
    const o: Old = {
      kind,
      db,
      docs: new MainPageDocs(db, { normalize: normalizeStructure, seed: seedIfEmpty }),
      remote: new FakeRemote(server, '0.082'),
    };
    opened.push({ db });
    return o;
  }
  const db = (await openPublishedDb(dbName)) as unknown as LocalDb;
  const o: Old = {
    kind,
    db,
    docs: new PublishedPageDocs(db as never, { normalize: mergeRootGroups, seed: seedIfEmpty }),
    remote: new FakeRemote(server, '0.029'),
  };
  opened.push({ db });
  return o;
}

/** Ciclo de una versión vieja: si cambió la generación, restaura como ella; después sube y baja. */
async function oldSync(o: Old, server: FakeServer, pageIds: string[], mode: 'full' | 'resetOnly' | 'resetNoGen' = 'full') {
  const generation = server.settings!.generation;
  if (storedGeneration(await o.db.get('meta', GENERATION_KEY)) !== generation) {
    await o.docs.resetForRestore();
    if (mode === 'resetNoGen') return; // se cierra entre restaurar y guardar la generación
    await o.db.put('meta', generation, GENERATION_KEY);
  }
  if (mode !== 'full') return;
  for (const pageId of await o.docs.unsyncedPages()) await o.docs.pushPage(pageId, o.remote);
  for (const pageId of pageIds) await o.docs.pullPage(pageId, o.remote);
}

type Docs = { open(id: string): Promise<Y.Doc>; close(id: string): void; flush(id?: string): Promise<void> };
async function write(docsAny: unknown, pageId: string, fn: (text: Y.Text) => void): Promise<void> {
  const docs = docsAny as Docs;
  const doc = await docs.open(pageId);
  fn(doc.getText('t'));
  await docs.flush(pageId);
  docs.close(pageId);
}
async function read(docsAny: unknown, pageId: string): Promise<string> {
  const docs = docsAny as Docs;
  const doc = await docs.open(pageId);
  const text = doc.getText('t').toString();
  docs.close(pageId);
  return text;
}
function serverDeletes(server: FakeServer, pageId: string): DeleteRanges {
  return (server.updates.get(pageId) ?? []).reduce<DeleteRanges>((acc, u) => unionRanges(acc, rangesOf(u.data)), new Map());
}
function serverDoc(server: FakeServer, pageId: string): Y.Doc {
  const doc = new Y.Doc();
  const list = server.updates.get(pageId) ?? [];
  if (list.length > 0) Y.applyUpdate(doc, Y.mergeUpdates(list.map((u) => u.data)));
  return doc;
}
async function savedDoc(db: LocalDb, pageId: string): Promise<Y.Doc> {
  const rows = await db.getAllFromIndex('docUpdates', 'pageId', pageId);
  const doc = new Y.Doc();
  if (rows.length > 0) Y.applyUpdate(doc, Y.mergeUpdates(rows.map((r) => r.data)));
  return doc;
}
async function deletesSound(db: LocalDb, server: FakeServer, pageId: string): Promise<string | null> {
  const generation = storedGeneration(await db.get('meta', GENERATION_KEY));
  if (generation !== server.settings!.generation) return null;
  const state = await db.get('docState', pageId);
  const known = state ? knownDeletes(state, generation) : undefined;
  if (!known) return null;
  const missing = subtractRanges(rangesOf(known), serverDeletes(server, pageId));
  return missing.size > 0 ? JSON.stringify([...missing]) : null;
}
/** Borrados guardados en el dispositivo que el servidor no tiene. */
async function missingDeletes(db: LocalDb, server: FakeServer, pageId: string): Promise<DeleteRanges> {
  const local = await savedDoc(db, pageId);
  const out = subtractRanges(rangesOf(Y.encodeStateAsUpdate(local)), serverDeletes(server, pageId));
  local.destroy();
  return out;
}
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

const SEEDS = Number(process.env.DELETES_VERSIONS_SEEDS ?? 20);
const STEPS = Number(process.env.DELETES_VERSIONS_STEPS ?? 70);
const SEED0 = Number(process.env.DELETES_VERSIONS_SEED0 ?? 1);

// Tres bases, cada una con una o dos instancias (la actual, main o la v0.029, al azar), dos páginas. Borrados
// chicos, de media página y de todo el texto (también de lo que escribieron otros); respuestas perdidas, sin
// red, cierres de golpe de toda la base con el ciclo en vuelo, reaperturas con una versión al azar, copias y
// restauraciones del servidor, y una versión anterior que restaura y se cierra antes o después de guardar la
// generación. En cada paso `syncedDS` no dice de más; después de cada subida confirmada (sin nada pendiente y
// con la generación al día) el servidor tiene todos los borrados del dispositivo; al final, todos iguales.
describe('B.15 al azar: la versión publicada sobre la misma base, dos instancias por base y dos páginas', () => {
  for (let seed = SEED0; seed < SEED0 + SEEDS; seed++) {
    it(`semilla ${seed}`, async () => {
      const rnd = random(seed * 104729 + 17);
      const server = new FakeServer();
      const slots: { dbName: string; insts: Inst[] }[] = [];
      for (let i = 0; i < 3; i++) {
        const dbName = crypto.randomUUID();
        slots.push({ dbName, insts: [{ kind: 'new', d: await newDevice(server, dbName) }] });
      }
      const first = (slots[0].insts[0] as { d: Device }).d;
      const pages = [await first.tree.create(null, 'P'), await first.tree.create(null, 'Q')];
      for (const p of pages) await write(first.docs, p, (t) => t.insert(0, 'texto base para ir borrando de a poco, con varias palabras '));
      await first.engine.syncNow();
      for (const s of slots) await (s.insts[0].d as Device).engine.syncNow();
      let restoreFn: (() => void) | null = null;
      const log: string[] = [];

      const pick = <T,>(list: T[]): T => list[Math.floor(rnd() * list.length)];
      const closeInst = async (inst: Inst) => {
        try {
          if (inst.kind === 'new') {
            await inst.d.docs.flush();
            inst.d.docs.dispose();
            inst.d.engine.stop();
          } else {
            await inst.d.docs.flush();
            inst.d.docs.dispose();
          }
          inst.d.db.close();
        } catch {
          // ya cerrada
        }
        await new Promise((r) => setTimeout(r, 5));
      };
      const openInst = async (dbName: string): Promise<Inst> => {
        const r = rnd();
        if (r < 0.55) return { kind: 'new', d: await newDevice(server, dbName) };
        if (r < 0.9) return { kind: 'main', d: await oldDevice(server, dbName, 'main') };
        return { kind: 'v029', d: await oldDevice(server, dbName, 'v029') };
      };
      const syncInst = async (inst: Inst) => {
        if (inst.kind === 'new') await inst.d.engine.syncNow();
        else await oldSync(inst.d, server, pages);
      };

      for (let step = 0; step < STEPS; step++) {
        const si = Math.floor(rnd() * slots.length);
        const slot = slots[si];
        const ii = Math.floor(rnd() * slot.insts.length);
        const inst = slot.insts[ii];
        const pageId = pick(pages);
        const x = rnd();
        let confirmedNew = false;
        try {
          if (x < 0.32) {
            await write(inst.d.docs, pageId, (t) => {
              const r = rnd();
              if (t.length > 6 && r < 0.45) t.delete(Math.floor(rnd() * (t.length - 3)), 1 + Math.floor(rnd() * 3));
              else if (t.length > 20 && r < 0.6) t.delete(Math.floor(rnd() * 5), Math.floor(t.length / 2));
              else if (t.length > 0 && r < 0.65) t.delete(0, t.length); // borrar todo
              else t.insert(Math.floor(rnd() * (t.length + 1)), `${si}${inst.kind[0]}${step} `);
            });
            log.push(`w${si}${inst.kind[0]}:${pageId === pages[0] ? 'P' : 'Q'}`);
          } else if (x < 0.4) {
            await inst.d.docs.pullPage(pageId, inst.d.remote);
            log.push(`pull${si}${inst.kind[0]}`);
          } else if (x < 0.48) {
            server.loseNextPushResponse = true;
            log.push(`lost${si}${inst.kind[0]}`);
            await inst.d.docs.pushPage(pageId, inst.d.remote);
          } else if (x < 0.58) {
            log.push(`push${si}${inst.kind[0]}`);
            await inst.d.docs.pushPage(pageId, inst.d.remote);
            confirmedNew = inst.kind === 'new' && slot.insts.length === 1;
          } else if (x < 0.63) {
            server.online = rnd() < 0.6;
            log.push(server.online ? 'online' : 'offline');
          } else if (x < 0.7) {
            // Cierre de golpe de toda la base (todas sus instancias), a veces con algo en vuelo.
            const watch = watchTransactions();
            const after = Math.floor(rnd() * 60);
            try {
              if (rnd() < 0.6) {
                server.loseNextPushResponse = rnd() < 0.3;
                void syncInst(inst).catch(() => undefined);
              }
              await microtasks(after);
              for (const each of slot.insts) await watch.kill(each.d as never);
            } finally {
              watch.restore();
              server.loseNextPushResponse = false;
            }
            slot.insts = [await openInst(slot.dbName)];
            log.push(`kill${si}@${after}->${slot.insts[0].kind}`);
          } else if (x < 0.76) {
            await closeInst(inst);
            slot.insts.splice(ii, 1, await openInst(slot.dbName));
            log.push(`reopen${si}->${slot.insts[ii].kind}`);
          } else if (x < 0.8) {
            // Una segunda instancia sobre la misma base (pestaña vieja o nueva), o cerrar la segunda.
            if (slot.insts.length === 1) {
              slot.insts.push(await openInst(slot.dbName));
              log.push(`twin${si}+${slot.insts[1].kind}`);
            } else {
              await closeInst(slot.insts.pop()!);
              log.push(`untwin${si}`);
            }
          } else if (x < 0.85 && inst.kind !== 'new') {
            const mode = rnd() < 0.5 ? 'resetOnly' : 'resetNoGen';
            await oldSync(inst.d, server, pages, mode);
            log.push(`oldreset${si}:${mode}`);
          } else if (x < 0.89) {
            if (!restoreFn) {
              restoreFn = server.backup();
              log.push('backup');
            } else {
              restoreFn();
              restoreFn = null;
              log.push('restore');
            }
          } else {
            log.push(`sync${si}${inst.kind[0]}`);
            await syncInst(inst);
          }
        } catch {
          // sin red, respuesta perdida, base cerrada
        }
        server.loseNextPushResponse = false;
        const label = `semilla ${seed}, paso ${step}: ${log.slice(-25).join(' ')}`;
        for (const s of slots) {
          for (const p of pages) {
            const bad = await deletesSound(s.insts[0].d.db, server, p);
            expect(bad, `syncedDS dice de más, ${label}`).toBeNull();
          }
        }
        if (confirmedNew && storedGeneration(await inst.d.db.get('meta', GENERATION_KEY)) === server.settings!.generation) {
          const state = await inst.d.db.get('docState', pageId);
          const dirty = await inst.d.db.get('meta', dirtyKey(pageId));
          if (state && !hasUnsyncedContent(state, dirty !== undefined)) {
            const miss = await missingDeletes(inst.d.db, server, pageId);
            expect([...miss], `borrado sin subir tras subida confirmada, ${label}`).toEqual([]);
          }
        }
      }

      // Final: todos con la versión actual, con red.
      server.online = true;
      for (const s of slots) {
        for (const inst of s.insts) await closeInst(inst);
        s.insts = [{ kind: 'new', d: await newDevice(server, s.dbName) }];
      }
      for (let round = 0; round < 3; round++) for (const s of slots) await (s.insts[0].d as Device).engine.syncNow();
      const label = `semilla ${seed}: ${log.join(' ')}`;
      for (const p of pages) {
        const expected = serverDoc(server, p);
        for (const s of slots) {
          const d = s.insts[0].d as Device;
          expect(await deletesSound(d.db, server, p), label).toBeNull();
          expect([...(await missingDeletes(d.db, server, p))], `al servidor le faltan borrados, ${label}`).toEqual([]);
          expect(await read(d.docs, p), label).toBe(expected.getText('t').toString());
          expect(d.engine.getStatus().pendingPages, label).toBe(0);
        }
        expected.destroy();
      }
    }, 120_000);
  }
});

describe('B.15: casos entre versiones', () => {
  it('una subida con la generación vieja contra un servidor ya restaurado; después main restaura y se cierra sin guardar la generación', async () => {
    const server = new FakeServer();
    const dbName = crypto.randomUUID();
    const a = await newDevice(server, dbName);
    const pageId = await a.tree.create(null, 'P');
    await write(a.docs, pageId, (t) => t.insert(0, 'abcdefghijkl'));
    await a.engine.syncNow();
    const restore = server.backup();
    await write(a.docs, pageId, (t) => t.delete(1, 2)); // X
    await a.engine.syncNow();
    await write(a.docs, pageId, (t) => t.delete(5, 2)); // Y, sin subir
    restore(); // el servidor perdió X
    // Una subida que ya había pasado por checkWorkspace antes de la restauración.
    await a.docs.pushPage(pageId, a.remote);
    a.engine.stop();
    a.db.close();
    const old = await oldDevice(server, dbName, 'main');
    await oldSync(old, server, [pageId], 'resetNoGen');
    old.db.close();
    const again = await newDevice(server, dbName);
    await again.engine.syncNow();
    await again.engine.syncNow();
    expect([...(await missingDeletes(again.db, server, pageId))]).toEqual([]);
    const c = await newDevice(server, crypto.randomUUID());
    await c.engine.syncNow();
    expect(await read(c.docs, pageId)).toBe(await read(again.docs, pageId));
  });

  it('dos pestañas (main y la actual) en la misma base: main restaura mientras la actual tiene armado un envío con solo los borrados nuevos', async () => {
    const server = new FakeServer();
    const dbName = crypto.randomUUID();
    const a = await newDevice(server, dbName);
    const pageId = await a.tree.create(null, 'P');
    await write(a.docs, pageId, (t) => t.insert(0, 'uno dos tres cuatro cinco seis siete'));
    await a.engine.syncNow();
    const restore = server.backup();
    await write(a.docs, pageId, (t) => t.delete(0, 4));
    await a.engine.syncNow();
    await write(a.docs, pageId, (t) => t.delete(0, 4));
    // El envío recortado queda armado (respuesta perdida).
    server.loseNextPushResponse = true;
    await a.docs.pushPage(pageId, a.remote).catch(() => undefined);
    restore();
    const old = await oldDevice(server, dbName, 'main');
    await oldSync(old, server, [pageId], 'resetOnly');
    // La nueva sigue con la página: sube lo que haya.
    await a.docs.pushPage(pageId, a.remote);
    await a.engine.syncNow();
    await a.engine.syncNow();
    expect([...(await missingDeletes(a.db, server, pageId))]).toEqual([]);
    const c = await newDevice(server, crypto.randomUUID());
    await c.engine.syncNow();
    expect(await read(c.docs, pageId)).toBe('tres cuatro cinco seis siete');
  });

  it('buildUpload con documentos con pendingStructs y pendingDs: nunca falta un borrado', () => {
    const rnd = random(777);
    let trimmed = 0;
    for (let round = 0; round < 400; round++) {
      const authors = [new Y.Doc(), new Y.Doc(), new Y.Doc()];
      const updates: Uint8Array[] = [];
      for (const a of authors) a.on('update', (u: Uint8Array) => updates.push(u));
      for (let step = 0; step < 30; step++) {
        const a = authors[Math.floor(rnd() * 3)];
        const t = a.getText('t');
        if (t.length > 3 && rnd() < 0.5) t.delete(Math.floor(rnd() * (t.length - 2)), 1 + Math.floor(rnd() * 3));
        else t.insert(Math.floor(rnd() * (t.length + 1)), 'xy');
        const b = authors[Math.floor(rnd() * 3)];
        if (b !== a && rnd() < 0.6) Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
      }
      // El dispositivo tiene un subconjunto desordenado (con huecos: pendientes).
      const device = new Y.Doc();
      for (const u of updates) if (rnd() < 0.6) Y.applyUpdate(device, u);
      const serverUpdates = updates.filter(() => rnd() < 0.5);
      const srvMerged = serverUpdates.length ? Y.mergeUpdates(serverUpdates) : new Uint8Array([0, 0]);
      // Lo que el dispositivo cree que tiene el servidor: sus borrados de verdad, o a veces nada.
      const known = rnd() < 0.1 ? undefined : encodeRanges(rangesOf(srvMerged));
      const sv = rnd() < 0.5 ? Y.encodeStateVectorFromUpdate(srvMerged) : undefined;
      const up = buildUpload(device, sv, known);
      if (up.trimmed) trimmed++;
      const after = Y.mergeUpdates([srvMerged, up.update]);
      const missing = subtractRanges(rangesOf(Y.encodeStateAsUpdate(device)), rangesOf(after));
      expect([...missing]).toEqual([]);
      expect(rangesOf(up.ds)).toEqual(rangesOf(up.update));
      for (const d of [...authors, device]) d.destroy();
    }
    console.log(`buildUpload con pendientes: ${trimmed}/400 recortadas`);
  });
});

describe('B.15: rendimiento', () => {
  it.runIf(process.env.DELETES_PERF === '1')('bajar 1500 filas viejas (cada una con el delete set entero) y el peso de syncedDS', async () => {
    const server = new FakeServer();
    const a = await newDevice(server, crypto.randomUUID());
    const pageId = await a.tree.create(null, 'P');
    await a.engine.syncNow();
    // Una página editada con la versión publicada: 1500 subidas, cada una con todos los borrados.
    const old = await oldDevice(server, crypto.randomUUID(), 'main');
    await old.docs.pullPage(pageId, old.remote);
    const rnd = random(5);
    let doc = await old.docs.open(pageId);
    doc.getText('t').insert(0, 'Plano general de la calle, de noche, con lluvia. '.repeat(10));
    for (let i = 0; i < 1500; i++) {
      if (i % 60 === 0) {
        old.docs.close(pageId);
        await old.docs.flush(pageId);
        await new Promise((r) => setTimeout(r, 0));
        doc = await old.docs.open(pageId);
      }
      const t = doc.getText('t');
      t.insert(Math.floor(rnd() * (t.length + 1)), ` toma ${i}`);
      if (t.length > 20) t.delete(Math.floor(rnd() * (t.length - 6)), 1 + Math.floor(rnd() * 4));
      await old.docs.flush(pageId);
      await old.docs.pushPage(pageId, old.remote);
    }
    old.docs.close(pageId);
    const rows = server.updates.get(pageId)!;
    const total = rows.reduce((s, u) => s + u.data.length, 0);
    const t0 = performance.now();
    await a.docs.pullPage(pageId, a.remote);
    const ms = performance.now() - t0;
    const state = await a.db.get('docState', pageId);
    const local = await savedDoc(a.db, pageId);
    const dsOnly = Y.encodeStateAsUpdate(local, Y.encodeStateVector(local)).length;
    console.log(
      `bajar ${rows.length} filas (${(total / 1024).toFixed(0)} KB): ${ms.toFixed(0)} ms; syncedDS ${state?.syncedDS?.length} B; delete set del documento ${dsOnly} B; documento ${Y.encodeStateAsUpdate(local).length} B`,
    );
    // Lo mismo con main (sin syncedDS) para comparar.
    const m = await oldDevice(server, crypto.randomUUID(), 'main');
    const t1 = performance.now();
    await m.docs.pullPage(pageId, m.remote);
    console.log(`main baja lo mismo en ${(performance.now() - t1).toFixed(0)} ms`);
    local.destroy();
  }, 300_000);
});
