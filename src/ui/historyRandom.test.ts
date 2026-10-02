// @vitest-environment jsdom
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { PageHistory, yShape, type ContentShape } from '../sync/history';
import { blocksOf, block, everyLetter, group, rowsOf, seeded, textOf } from '../sync/historyTesting';
import { PageDocs as OldPageDocs } from '../sync/fixtures/mainDocs';
import { openLocalDb } from '../sync/localDb';
import { normalizeStructure, seedIfEmpty } from '../sync/structure';
import { FakeRemote, FakeServer, makeDevice, type Device } from '../sync/testing';
import { mountEditor, undoManager, unmountAll, view } from './collabHarness';
import { restoreInEditor } from './historyRestore';

// Prueba 3 del plan del historial (Docs/Doc_Historial.md, sección 11), completa en la entrega 2: tres dispositivos al
// azar sobre la misma página. A tiene la página abierta en el editor de verdad y restaura versiones al azar (a veces
// deshace); B (esta versión) y C (la versión publicada, que sube con GC) escriben, borran, cambian tipos, se quedan sin
// red y vuelven, y a veces bajan un borrado antes de subir lo suyo (el texto huérfano). En cada restauración: no corre
// con algo pendiente, deja la página igual a la versión y deshacer vuelve a lo de antes. Al final: todos iguales, al
// servidor no le falta nada, cada letra subida se ve en una versión o en el texto huérfano, y quien escribió algo que
// quedó huérfano con esta versión de la app tiene su aviso.

const devices: Device[] = [];
const swallow = (e: unknown) => {
  if (String(e).includes('closed') || String(e).includes('InvalidStateError')) return;
  throw e;
};
process.on('unhandledRejection', swallow);
afterAll(() => {
  process.off('unhandledRejection', swallow);
});
afterEach(async () => {
  unmountAll();
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    try {
      d.db.close();
      d.mediaDb.close();
      d.commentsDb.close();
    } catch {
      // ya cerrada
    }
  }
});

const B = { id: 'user-b', email: 'b@test' };
const C = { id: 'user-c', email: 'c@test' };
const settle = () => new Promise((r) => setTimeout(r, 0));

/**
 * La página quedó como la versión: el mismo texto y los mismos nodos, y los mismos ids salvo los repetidos de la versión
 * (el segundo de cada uno), que tienen uno nuevo, distinto de todos.
 */
function expectVersion(page: ContentShape, version: ContentShape, msg: string): void {
  expect({ text: page.text, nodes: page.nodes, blocks: page.ids.length }, msg).toEqual({ text: version.text, nodes: version.nodes, blocks: version.ids.length });
  const seen = new Set<string>();
  version.ids.forEach((id, i) => {
    if (seen.has(id)) expect(version.ids.includes(page.ids[i]), `${msg}: el repetido ${i} tiene un id nuevo`).toBe(false);
    else expect(page.ids[i], `${msg}: el bloque ${i}`).toBe(id);
    seen.add(id);
  });
  expect(new Set(page.ids).size, `${msg}: sin ids repetidos`).toBe(page.ids.length);
}

/** Un cambio al azar como los del editor (Yjs directo; cambiar el tipo, como y-prosemirror: rehacer con el mismo id). */
function randomEdit(g: Y.XmlElement, rnd: () => number, tag: string, step: number): void {
  const containers = g
    .toArray()
    .filter((x): x is Y.XmlElement => x instanceof Y.XmlElement && x.nodeName === 'blockContainer' && x.get(0) instanceof Y.XmlElement && (x.get(0) as Y.XmlElement).get(0) instanceof Y.XmlText);
  const any = () => (containers.length ? containers[Math.floor(rnd() * containers.length)] : null);
  const r = rnd();
  if (containers.length === 0 || r < 0.28) g.insert(Math.floor(rnd() * (g.length + 1)), [block(`${tag}${step}`, `${tag} ${step} `)]);
  else if (r < 0.4 && containers.length > 2) g.delete(g.toArray().indexOf(any()!), 1);
  else if (r < 0.5) {
    const target = any()!;
    const i = g.toArray().indexOf(target);
    const fresh = block(String(target.getAttribute('id')), textOf(target).toString(), rnd() < 0.5 ? 'heading' : 'paragraph');
    g.delete(i, 1);
    g.insert(i, [fresh]);
  } else if (r < 0.8) {
    const t = textOf(any()!);
    t.insert(Math.floor(rnd() * (t.length + 1)), ` ${tag}${step}`);
  } else {
    const t = textOf(any()!);
    if (t.length > 3) t.delete(Math.floor(rnd() * (t.length - 3)), 1 + Math.floor(rnd() * 3));
  }
}

describe('al azar con tres dispositivos y restaurar (prueba 3)', () => {
  it('restaurar deja la versión y se deshace; todos terminan iguales, nada falta en el servidor y ninguna letra se pierde', async () => {
    let restores = 0;
    let undos = 0;
    let orphans = 0;
    let notices = 0;
    let repeated = 0;
    for (const seed of [41, 42, 43, 44, 45, 46]) {
      const server = new FakeServer();
      let clock = Date.parse('2026-10-01T10:00:00Z');
      server.now = () => clock;
      const a = await makeDevice(server);
      devices.push(a);
      const pageId = await a.tree.create(null, 'P');
      await a.engine.syncNow();
      const b = await makeDevice(server, undefined, '0.021', {}, undefined, B);
      devices.push(b);
      await b.engine.syncNow();
      const oldDb = await openLocalDb(crypto.randomUUID());
      const old = new OldPageDocs(oldDb, { normalize: normalizeStructure, seed: seedIfEmpty });
      const oldRemote = new FakeRemote(server, '0.082', C.id, C.email);
      // A: la página abierta en el editor (como la app).
      const docA = await a.docs.open(pageId);
      docA.transact(() => group(docA).insert(0, [block('a0', 'Escena 64 ')]), 'test');
      const ed = mountEditor(docA, 'A');
      await settle();
      await a.engine.syncNow();
      const rnd = seeded(seed);
      for (let step = 0; step < 40; step++) {
        const who = Math.floor(rnd() * 3);
        const r = rnd();
        if (who === 0 && r < 0.2) {
          // A restaura una versión al azar: primero sincroniza; con algo pendiente, no restaura.
          await a.engine.syncNow();
          await settle();
          if ((await a.docs.unsyncedPages()).includes(pageId)) continue;
          const h = new PageHistory(rowsOf(server, pageId));
          const v = h.version(Math.floor(rnd() * h.sessions.length));
          const before = yShape(docA);
          undoManager(ed).stopCapturing();
          const outcome = restoreInEditor(view(ed), v);
          const ids = yShape(v).ids;
          // Una versión con dos bloques del mismo id (dos dispositivos rehicieron el mismo bloque a la vez) también se
          // restaura: el segundo, con un id nuevo (antes se deshacía sola).
          if (new Set(ids).size < ids.length) repeated++;
          expect(outcome, `semilla ${seed}, paso ${step}`).toMatchObject({ ok: true });
          expectVersion(yShape(docA), yShape(v), `semilla ${seed}, paso ${step}: la página es la versión`);
          restores++;
          if (outcome.ok && rnd() < 0.35) {
            // Una versión igual a la página no cambia nada y su Undo no hace nada (O2 de la auditoría de la entrega 1).
            if (outcome.undo()) undos++;
            expect(yShape(docA), `semilla ${seed}, paso ${step}: deshacer vuelve a lo de antes`).toEqual(before);
          }
          undoManager(ed).stopCapturing();
          await settle();
          await a.engine.syncNow();
        } else if (who === 0) {
          docA.transact(() => randomEdit(group(docA), rnd, 'a', step), 'test');
          await settle();
          if (rnd() < 0.7) await a.engine.syncNow();
        } else {
          const docs = (who === 1 ? b.docs : old) as unknown as {
            open(id: string): Promise<Y.Doc>;
            flush(id?: string): Promise<void>;
            close(id: string): void;
            pullPage(id: string, remote: unknown): Promise<unknown>;
          };
          const remote = who === 1 ? b.remote : oldRemote;
          // Sin red un rato: a veces no baja lo de los demás antes de escribir.
          if (rnd() < 0.6) await docs.pullPage(pageId, remote);
          const doc = await docs.open(pageId);
          doc.transact(() => randomEdit(group(doc), rnd, who === 1 ? 'b' : 'c', step), 'test');
          await docs.flush(pageId);
          docs.close(pageId);
          // A veces baja el borrado de otro ANTES de subir lo suyo (el orden del texto huérfano).
          if (rnd() < 0.35) await docs.pullPage(pageId, remote);
          if (rnd() < 0.75) {
            if (who === 1) await b.engine.syncNow();
            else for (const id of await old.unsyncedPages()) await old.pushPage(id, oldRemote);
          }
        }
        clock += rnd() < 0.25 ? 45 * 60_000 : 1000 + Math.floor(rnd() * 60_000);
      }
      // Todos vuelven a tener red y sincronizan.
      for (let round = 0; round < 3; round++) {
        await a.engine.syncNow();
        await b.engine.syncNow();
        await old.pullPage(pageId, oldRemote);
        for (const id of await old.unsyncedPages()) await old.pushPage(id, oldRemote);
        await settle();
      }
      await a.engine.syncNow();
      await b.engine.syncNow();
      await old.pullPage(pageId, oldRemote);
      await settle();
      const rows = rowsOf(server, pageId);
      const serverDoc = new Y.Doc();
      for (const row of rows) Y.applyUpdate(serverDoc, row.data);
      // Al servidor no le falta nada de ningún dispositivo.
      const serverSV = Y.decodeStateVector(Y.encodeStateVector(serverDoc));
      const docB = await b.docs.open(pageId);
      const docC = await old.open(pageId);
      for (const [name, d] of [
        ['A', docA],
        ['B', docB],
        ['C', docC],
      ] as const) {
        for (const [client, clock2] of Y.decodeStateVector(Y.encodeStateVector(d))) {
          expect(serverSV.get(client) ?? 0, `semilla ${seed}: lo de ${name} (${client}) está en el servidor`).toBeGreaterThanOrEqual(clock2);
        }
      }
      // Todos iguales (como los muestra la app: con la reparación de estructura).
      const shown = (d: Y.Doc) => {
        const copy = new Y.Doc();
        Y.applyUpdate(copy, Y.encodeStateAsUpdate(d));
        normalizeStructure(copy, 'ref');
        return blocksOf(copy);
      };
      expect(shown(docA), `semilla ${seed}: A y B`).toEqual(shown(docB));
      expect(shown(docA), `semilla ${seed}: A y C`).toEqual(shown(docC));
      expect(shown(docA), `semilla ${seed}: A y el servidor`).toEqual(shown(serverDoc));
      b.docs.close(pageId);
      old.close(pageId);
      // Cada letra que llegó al servidor se ve en una versión o en el texto huérfano.
      const perRow = new PageHistory(rows, -1);
      const letters = everyLetter(perRow);
      expect(letters.lost, `semilla ${seed}: letras perdidas`).toEqual([]);
      expect(letters.checked).toBeGreaterThan(0);
      // Quien escribió con esta versión algo que quedó huérfano tiene su aviso (B.16), con ese texto.
      for (const [device, user] of [
        [b, B.id],
        [a, server.ownerId],
      ] as const) {
        const mine = perRow.orphans.filter((o) => perRow.rows[o.row].createdBy === user && o.text.trim().length > 0);
        orphans += mine.length;
        if (mine.length === 0) continue;
        // (El texto exacto del aviso lo prueba uploadNoGc.test.ts: acá, que el aviso está.)
        const notes = await device.docs.removedWriting(pageId);
        expect(notes.length, `semilla ${seed}: ${user} tiene su aviso`).toBeGreaterThan(0);
        notices++;
      }
      unmountAll();
      a.docs.close(pageId);
      old.dispose();
      oldDb.close();
      for (const d of devices.splice(0)) {
        await d.engine.stop();
        d.db.close();
      }
    }
    expect(restores, 'se restauró').toBeGreaterThan(4);
    expect(undos, 'se deshizo').toBeGreaterThan(0);
    expect(repeated, 'se restauró una versión con ids repetidos').toBeGreaterThan(0);
    if (process.env.HIST_DEBUG) console.log({ restores, undos, orphans, notices, repeated });
  });
});
