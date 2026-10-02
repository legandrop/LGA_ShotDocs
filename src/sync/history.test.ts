import { afterAll, afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { loadPageHistory, PageHistory, sameShape, yShape, type HistoryRow } from './history';
import { CONTENT_FRAGMENT, normalizeStructure, seedIfEmpty } from './structure';
import { PageDocs as OldPageDocs } from './fixtures/mainDocs';
import { openLocalDb } from './localDb';
import { FakeRemote, FakeServer, makeDevice, type Device } from './testing';
import { RemoteError, REQUEST_TIMEOUT } from './types';

// El historial de versiones (P.18, Docs/Doc_Historial.md). Las filas salen de la subida de verdad (`PageDocs` y el
// servidor en memoria, con `readSaved` y GC, como la app), no de updates armados a mano: así aparecen también las filas
// que vuelven a subir el documento entero con lo borrado ya recolectado (después de restaurar una copia).

const devices: Device[] = [];
async function device(server: FakeServer, user?: { id: string; email: string }): Promise<Device> {
  const d = await makeDevice(server, undefined, '0.021', {}, undefined, user ?? {});
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

/** El grupo de bloques de la página (lo crea si no está), como lo guarda el editor. */
function group(doc: Y.Doc): Y.XmlElement {
  const f = doc.getXmlFragment(CONTENT_FRAGMENT);
  if (f.length === 0) f.insert(0, [new Y.XmlElement('blockGroup')]);
  return f.get(0) as Y.XmlElement;
}

/** Un bloque `blockContainer > paragraph > texto`, como BlockNote. */
function block(id: string, text: string, type = 'paragraph'): Y.XmlElement {
  const bc = new Y.XmlElement('blockContainer');
  bc.setAttribute('id', id);
  const p = new Y.XmlElement(type);
  const t = new Y.XmlText();
  t.insert(0, text);
  p.insert(0, [t]);
  bc.insert(0, [p]);
  return bc;
}

const textOf = (bc: Y.XmlElement) => (bc.get(0) as Y.XmlElement).get(0) as Y.XmlText;

/** Edita la página en el dispositivo (abre, cambia, guarda y cierra). Devuelve el autor de Yjs de esa apertura. */
async function edit(d: Device, pageId: string, fn: (doc: Y.Doc, g: Y.XmlElement) => void): Promise<number> {
  const doc = await d.docs.open(pageId);
  doc.transact(() => fn(doc, group(doc)), 'test');
  await d.docs.flush(pageId);
  d.docs.close(pageId);
  return doc.clientID;
}

/** Lo visible del documento (estructura, atributos y texto), para comparar sin imprimir. */
const visible = (doc: Y.Doc) => doc.getXmlFragment(CONTENT_FRAGMENT).toJSON();

/** Las filas del servidor como las da `page_history`. */
function rowsOf(server: FakeServer, pageId: string): HistoryRow[] {
  return (server.updates.get(pageId) ?? []).map((u) => ({
    id: u.id ?? u.seq,
    seq: u.seq,
    createdBy: u.createdBy ?? null,
    createdAt: u.createdAt ?? new Date(0).toISOString(),
    data: u.data,
  }));
}

/**
 * Lo que había en el servidor después de la fila `n` (1..n aplicadas de a una, en orden, en un documento común), como lo
 * muestra la app: con la reparación de estructura (dos raíces de dos dispositivos sin red, por ejemplo).
 */
function serverAt(rows: HistoryRow[], n: number): string {
  const doc = new Y.Doc();
  for (let i = 0; i < n; i++) Y.applyUpdate(doc, rows[i].data);
  normalizeStructure(doc, 'ref');
  const out = visible(doc);
  doc.destroy();
  return out;
}

/** Si la fila trae ese texto (aunque esté borrado): se lee el update sin integrarlo. */
function rowHasText(data: Uint8Array, text: string): boolean {
  return Y.decodeUpdate(data).structs.some((x) => x instanceof Y.Item && x.content instanceof Y.ContentString && x.content.str.includes(text));
}

function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

async function setup() {
  const server = new FakeServer();
  let clock = Date.parse('2026-10-01T10:00:00Z');
  server.now = () => clock;
  const a = await device(server);
  const pageId = await a.tree.create(null, 'P');
  await a.engine.syncNow();
  const b = await device(server, B);
  await b.engine.syncNow();
  return { server, a, b, pageId, tick: (ms: number) => (clock += ms) };
}

describe('reconstruir versiones desde las filas', () => {
  it('cada versión es lo que tenía el servidor después de su última fila (al azar, dos personas, subidas enteras con GC)', async () => {
    for (const seed of [1, 2, 3, 4]) {
      const { server, a, b, pageId, tick } = await setup();
      const rnd = seeded(seed);
      let ids = 0;
      for (let step = 0; step < 40; step++) {
        const d = rnd() < 0.5 ? a : b;
        const r = rnd();
        if (r < 0.08) {
          // Restaurar una copia: el dispositivo vuelve a subir su documento entero (con lo borrado como hueco).
          await d.docs.resetForRestore();
        } else {
          await edit(d, pageId, (_doc, g) => {
            const pick = () => g.get(Math.floor(rnd() * g.length)) as Y.XmlElement;
            if (g.length === 0 || r < 0.3) g.insert(Math.floor(rnd() * (g.length + 1)), [block(`b${seed}-${++ids}`, `texto ${ids} `)]);
            else if (r < 0.4 && g.length > 2) g.delete(Math.floor(rnd() * g.length), 1);
            else if (r < 0.5) {
              // Cambiar el tipo como y-prosemirror: borra el bloque y lo crea de nuevo con el mismo id.
              const i = Math.floor(rnd() * g.length);
              const old = g.get(i) as Y.XmlElement;
              const fresh = block(String(old.getAttribute('id')), textOf(old).toString(), 'heading');
              g.delete(i, 1);
              g.insert(i, [fresh]);
            } else if (r < 0.75) {
              const t = textOf(pick());
              t.insert(Math.floor(rnd() * (t.length + 1)), ` palabra${step}`);
            } else {
              const t = textOf(pick());
              if (t.length > 3) t.delete(Math.floor(rnd() * (t.length - 3)), 1 + Math.floor(rnd() * 3));
            }
          });
        }
        tick(rnd() < 0.2 ? 45 * 60_000 : 1000 + Math.floor(rnd() * 60_000));
        if (rnd() < 0.7) await d.engine.syncNow();
      }
      await a.engine.syncNow();
      await b.engine.syncNow();
      await a.engine.syncNow();
      const rows = rowsOf(server, pageId);
      const history = new PageHistory(rows);
      expect(history.sessions.length).toBeGreaterThan(1);
      for (let i = 0; i < history.sessions.length; i++) {
        const v = history.version(i);
        expect(visible(v), `semilla ${seed}, sesión ${i}`).toBe(serverAt(rows, history.sessions[i].last + 1));
        v.destroy();
      }
      // La última es lo que muestran los dos dispositivos.
      const last = history.version(history.sessions.length - 1);
      const shown = await a.docs.open(pageId);
      const repaired = new Y.Doc();
      Y.applyUpdate(repaired, Y.encodeStateAsUpdate(shown));
      normalizeStructure(repaired, 'ref');
      expect(visible(last)).toBe(visible(repaired));
      a.docs.close(pageId);
      history.destroy();
      for (const d of devices.splice(0)) {
        await d.engine.stop();
        d.db.close();
      }
    }
  });

  it('filas de los dos tipos: la versión publicada (sube con GC) y esta (sin GC, desde v0.095) en la misma página', async () => {
    // Desde B.16 (v0.095) la subida se arma sin GC: lleva el texto de lo que ya está borrado. Una versión anterior
    // (fixtures/mainDocs.ts) sube con GC, y después de restaurar una copia vuelve a subir todo con huecos. El
    // historial tiene que armar cada versión igual a lo que tenía el servidor, con filas de los dos tipos mezcladas.
    for (const seed of [11, 12, 13]) {
      const { server, a, pageId, tick } = await setup();
      const oldDb = await openLocalDb(crypto.randomUUID());
      const old = new OldPageDocs(oldDb, { normalize: normalizeStructure, seed: seedIfEmpty });
      const oldRemote = new FakeRemote(server, '0.082', B.id, B.email);
      const rnd = seeded(seed);
      let ids = 0;
      let wroteAndDeleted = false;
      for (let step = 0; step < 40; step++) {
        const useOld = rnd() < 0.5;
        const docs = (useOld ? old : a.docs) as unknown as { open(id: string): Promise<Y.Doc>; flush(id?: string): Promise<void>; close(id: string): void };
        if (useOld) await old.pullPage(pageId, oldRemote);
        else await a.docs.pullPage(pageId, a.remote);
        if (rnd() < 0.08) {
          if (useOld) await old.resetForRestore();
          else await a.docs.resetForRestore();
        } else {
          const doc = await docs.open(pageId);
          doc.transact(() => {
            const g = group(doc);
            const r = rnd();
            const pick = () => g.get(Math.floor(rnd() * g.length)) as Y.XmlElement;
            if (g.length === 0 || r < 0.3) g.insert(Math.floor(rnd() * (g.length + 1)), [block(`m${seed}-${++ids}`, `texto ${ids} `)]);
            else if (r < 0.45 && g.length > 2) g.delete(Math.floor(rnd() * g.length), 1);
            else if (r < 0.6) {
              // Escribir ahora y borrar en otra transacción, antes de subir (abajo): sin GC, el texto viaja igual.
              textOf(pick()).insert(0, 'tmp ');
              if (!useOld) wroteAndDeleted = true;
            } else if (r < 0.85) {
              const t = textOf(pick());
              t.insert(Math.floor(rnd() * (t.length + 1)), ` p${step}`);
            } else {
              const t = textOf(pick());
              if (t.length > 3) t.delete(Math.floor(rnd() * (t.length - 3)), 1 + Math.floor(rnd() * 3));
            }
          }, 'test');
          await docs.flush(pageId);
          // Lo escrito recién (de esta apertura) se borra en otra transacción, antes de subir.
          doc.transact(() => {
            const g = group(doc);
            for (let i = 0; i < g.length; i++) {
              const t = textOf(g.get(i) as Y.XmlElement);
              if (t.toString().startsWith('tmp ')) t.delete(0, 4);
            }
          }, 'test');
          await docs.flush(pageId);
          docs.close(pageId);
        }
        if (useOld) {
          for (const id of await old.unsyncedPages()) await old.pushPage(id, oldRemote);
        } else await a.engine.syncNow();
        tick(rnd() < 0.2 ? 45 * 60_000 : 1000 + Math.floor(rnd() * 60_000));
      }
      await old.pullPage(pageId, oldRemote);
      await a.engine.syncNow();
      const rows = rowsOf(server, pageId);
      // Hay filas de los dos: con huecos (la publicada) y con texto ya borrado (esta, sin GC).
      const kinds = rows.map((r) => {
        const { structs } = Y.decodeUpdate(r.data);
        return {
          gc: structs.some((x) => x instanceof Y.GC || (x instanceof Y.Item && x.content instanceof Y.ContentDeleted)),
          by: r.createdBy,
        };
      });
      expect(kinds.some((k) => k.by === B.id), `semilla ${seed}: filas de la publicada`).toBe(true);
      expect(kinds.some((k) => k.by === server.ownerId), `semilla ${seed}: filas de esta`).toBe(true);
      if (wroteAndDeleted) {
        const deletedText = rows.some((r) => r.createdBy === server.ownerId && rowHasText(r.data, 'tmp '));
        expect(deletedText, `semilla ${seed}: lo borrado antes de subir viaja sin GC`).toBe(true);
      }
      const history = new PageHistory(rows);
      for (let i = 0; i < history.sessions.length; i++) {
        const v = history.version(i);
        expect(visible(v), `semilla ${seed}, sesión ${i}`).toBe(serverAt(rows, history.sessions[i].last + 1));
        v.destroy();
      }
      history.destroy();
      old.dispose();
      oldDb.close();
      for (const d of devices.splice(0)) {
        await d.engine.stop();
        d.db.close();
      }
    }
  });

  it('armar el documento con mergeUpdates (en vez de en orden) pierde lo borrado de las versiones del medio', async () => {
    // Que `mergeUpdates` se quede con el hueco depende de los autores de Yjs (números al azar): se repite el guion y
    // alcanza con que pierda una vez. En orden, nunca.
    let lost = 0;
    for (let run = 0; run < 12; run++) {
      const { server, a, pageId, tick } = await setup();
      await edit(a, pageId, (_d, g) => g.insert(0, [block('x', 'hola'), block('y', 'mundo')]));
      await a.engine.syncNow();
      tick(60 * 60_000);
      // Se borra el bloque entero: su texto queda como hueco (GC) en el dispositivo.
      await edit(a, pageId, (_d, g) => g.delete(1, 1));
      await a.engine.syncNow();
      tick(60 * 60_000);
      // Restaurar una copia con una versión anterior de la app sobre la misma base (sube con GC; desde v0.095 esta sube
      // sin GC): vuelve a subir todo, ya con el bloque recolectado.
      await a.engine.stop();
      const old = new OldPageDocs(a.db, { normalize: normalizeStructure, seed: seedIfEmpty });
      const oldRemote = new FakeRemote(server, '0.082');
      await old.resetForRestore();
      {
        const doc = await old.open(pageId);
        doc.transact(() => textOf(group(doc).get(0) as Y.XmlElement).insert(4, '!'), 'test');
        await old.flush(pageId);
        old.close(pageId);
      }
      for (const id of await old.unsyncedPages()) await old.pushPage(id, oldRemote);
      old.dispose();
      const rows = rowsOf(server, pageId);
      const history = new PageHistory(rows);
      const first = history.version(0);
      expect(yShape(first).ids).toEqual(['x', 'y']);
      expect(textOf(group(first).get(1) as Y.XmlElement).toString()).toBe('mundo');
      // El mutante: el mismo snapshot sobre un documento armado con mergeUpdates.
      const merged = new Y.Doc({ gc: false });
      Y.applyUpdate(merged, Y.mergeUpdates(rows.map((r) => r.data)));
      if (visible(Y.createDocFromSnapshot(merged, history.snapshot(0))) !== visible(first)) lost++;
      history.destroy();
      for (const d of devices.splice(0)) {
        await d.engine.stop();
        d.db.close();
      }
    }
    expect(lost).toBeGreaterThan(0);
  });

  it('una fila que esta versión no puede leer se saltea y se cuenta', () => {
    const doc = new Y.Doc();
    group(doc).insert(0, [block('a', 'uno')]);
    const rows: HistoryRow[] = [
      { id: 1, seq: 1, createdBy: 'u', createdAt: '2026-10-01T10:00:00Z', data: Y.encodeStateAsUpdate(doc) },
      { id: 2, seq: 2, createdBy: 'u', createdAt: '2026-10-01T10:00:01Z', data: new Uint8Array([255, 255, 255, 1]) },
    ];
    const h = new PageHistory(rows);
    expect(h.unreadable).toEqual([1]);
    expect(visible(h.version(h.sessions.length - 1))).toBe(visible(doc));
  });
});

describe('quién hizo cada cambio', () => {
  it('cada letra es de quien subió la primera fila que la trae, y cada borrado igual; una subida entera no cambia nada', async () => {
    const { server, a, b, pageId, tick } = await setup();
    const clientA = await edit(a, pageId, (_d, g) => g.insert(0, [block('x', 'Hola')]));
    await a.engine.syncNow();
    tick(1000);
    await b.engine.syncNow();
    const clientB = await edit(b, pageId, (_d, g) => {
      const t = textOf(g.get(0) as Y.XmlElement);
      t.insert(4, ' de B');
      t.delete(0, 2); // B borra "Ho", que escribió A
    });
    await b.engine.syncNow();
    tick(1000);
    // A vuelve a subir todo (restaurar una copia): no le cambia el autor a nada de B.
    await a.engine.syncNow();
    await a.docs.resetForRestore();
    await a.engine.syncNow();
    const rows = rowsOf(server, pageId);
    const history = new PageHistory(rows);
    let checkedA = 0;
    let checkedB = 0;
    let deletedByB = 0;
    for (const [client, list] of history.doc.store.clients) {
      for (const s of list) {
        if (!(s instanceof Y.Item) || !(s.content instanceof Y.ContentString)) continue;
        for (let k = 0; k < s.length; k++) {
          const author = history.authorOf(client, s.id.clock + k);
          if (client === clientA) {
            expect(author).toBe(server.ownerId);
            checkedA++;
          } else if (client === clientB) {
            expect(author).toBe(B.id);
            checkedB++;
          }
          if (s.deleted) {
            expect(history.deleterOf(client, s.id.clock + k)).toBe(B.id);
            deletedByB++;
          }
        }
      }
    }
    expect(checkedA).toBe(4);
    expect(checkedB).toBe(5);
    expect(deletedByB).toBe(2);
    // Las personas, en orden de aparición; la subida entera de A no suma una sesión con autores nuevos.
    expect(history.people()).toEqual([server.ownerId, B.id]);
    history.destroy();
  });
});

describe('sesiones', () => {
  it('se corta con más de 30 minutos; un cambio que solo toca el colapsar no arma una versión ni suma autores', async () => {
    const { server, a, b, pageId, tick } = await setup();
    await edit(a, pageId, (_d, g) => g.insert(0, [block('x', 'uno')]));
    await a.engine.syncNow();
    tick(5 * 60_000);
    await b.engine.syncNow();
    await edit(b, pageId, (_d, g) => textOf(g.get(0) as Y.XmlElement).insert(3, ' dos'));
    await b.engine.syncNow();
    tick(40 * 60_000);
    await edit(a, pageId, (_d, g) => g.insert(1, [block('y', 'tres')]));
    await a.engine.syncNow();
    tick(3 * 60 * 60_000);
    // B solo colapsa para todos: no es un cambio del contenido.
    await b.engine.syncNow();
    await edit(b, pageId, (doc) => doc.getMap('collapsedHeadings').set('x', true));
    await b.engine.syncNow();
    const history = new PageHistory(rowsOf(server, pageId));
    expect(history.sessions.map((s) => s.authors)).toEqual([[server.ownerId, B.id], [server.ownerId]]);
    // La última versión (con el colapsar adentro) se ve abierta.
    const last = history.version(history.sessions.length - 1);
    expect(last.getMap('collapsedHeadings').size).toBe(0);
    expect(yShape(last).ids).toEqual(['x', 'y']);
    history.destroy();
  });

  it('una página vieja con dos raíces se muestra reparada (solo en memoria)', () => {
    const one = new Y.Doc();
    group(one).insert(0, [block('a', 'uno')]);
    const two = new Y.Doc();
    group(two).insert(0, [block('b', 'dos')]);
    const rows: HistoryRow[] = [one, two].map((d, i) => ({
      id: i + 1,
      seq: i + 1,
      createdBy: 'u',
      createdAt: `2026-10-01T10:00:0${i}Z`,
      data: Y.encodeStateAsUpdate(d),
    }));
    const h = new PageHistory(rows);
    const v = h.version(0);
    expect(v.getXmlFragment(CONTENT_FRAGMENT).length).toBe(1);
    expect(yShape(v).ids.sort()).toEqual(['a', 'b']);
    // El documento del historial no se tocó.
    expect(h.doc.getXmlFragment(CONTENT_FRAGMENT).length).toBe(2);
  });
});

describe('bajar el historial', () => {
  it('de a lotes, en orden, y si un lote vence pide uno más chico', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const pageId = await a.tree.create(null, 'P');
    await a.engine.syncNow();
    const doc = new Y.Doc();
    const list = [];
    for (let i = 1; i <= 1203; i++) {
      group(doc);
      const u = Y.encodeStateAsUpdate(doc);
      list.push({ seq: i, clientUpdateId: crypto.randomUUID(), data: u, id: i, createdBy: server.ownerId, createdAt: new Date(i * 1000).toISOString() });
    }
    server.updates.set(pageId, list);
    const remote = new FakeRemote(server);
    const sizes: number[] = [];
    let fail = true;
    const wrapped = {
      pageHistory: async (p: string, after: number, limit: number) => {
        sizes.push(limit);
        if (fail && limit === 500 && after > 0) {
          fail = false;
          throw new RemoteError(REQUEST_TIMEOUT, false);
        }
        return remote.pageHistory(p, after, limit);
      },
      pageHistoryAuthors: (p: string) => remote.pageHistoryAuthors(p),
    };
    const loaded = await loadPageHistory(wrapped, pageId);
    expect(loaded.rows.map((r) => r.seq)).toEqual(list.map((u) => u.seq));
    expect(sizes.slice(0, 3)).toEqual([500, 500, 50]);
    expect(loaded.emails.get(server.ownerId)).toBe(`${server.ownerId}@test`);
  });
});

describe('permisos (el servidor en memoria, con las reglas de 20261007120000_historial.sql)', () => {
  it('lo ven quien edita, el dueño y los admins; no quien ve, comenta ni un invitado con Editar; nada en la papelera', async () => {
    const server = new FakeServer();
    server.enableTeam();
    const owner = await device(server);
    const pageId = await owner.tree.create(null, 'P');
    const child = await owner.tree.create(pageId, 'C');
    await owner.engine.syncNow();
    await edit(owner, pageId, (_d, g) => g.insert(0, [block('x', 'hola')]));
    await owner.engine.syncNow();
    const people: [string, 'member' | 'guest' | 'admin', 'view' | 'comment' | 'edit' | null, boolean][] = [
      ['ver', 'member', 'view', false],
      ['comentar', 'member', 'comment', false],
      ['editar', 'member', 'edit', true],
      ['invitado', 'guest', 'edit', false],
      ['admin', 'admin', 'view', false],
      ['nadie', 'member', null, false],
    ];
    for (const [id, role, level] of people) {
      server.addMember(id, role);
      if (level) server.grant(id, { projectId: server.workspaceId }, level);
    }
    expect((await new FakeRemote(server).pageHistory(pageId, 0, 500)).length).toBeGreaterThan(0);
    for (const [id, , , allowed] of people) {
      const remote = new FakeRemote(server, '0.021', id);
      if (allowed) {
        expect((await remote.pageHistory(pageId, 0, 500)).length, id).toBeGreaterThan(0);
        expect((await remote.pageHistoryAuthors(pageId)).map((x) => x.email), id).toEqual(['owner@test']);
      } else {
        await expect(remote.pageHistory(pageId, 0, 500), id).rejects.toThrow('page_not_found');
        await expect(remote.pageHistoryAuthors(pageId), id).rejects.toThrow('page_not_found');
      }
    }
    // Lo que se baja para sincronizar no cambia: quien ve sigue bajando las filas.
    expect((await new FakeRemote(server, '0.021', 'ver').pullUpdates(pageId, 0, 500)).length).toBeGreaterThan(0);
    // La papelera: la página y lo de adentro.
    await owner.tree.trash(pageId);
    await owner.engine.syncNow();
    await expect(new FakeRemote(server).pageHistory(pageId, 0, 500)).rejects.toThrow('page_in_trash');
    await expect(new FakeRemote(server).pageHistory(child, 0, 500)).rejects.toThrow('page_in_trash');
  });
});

describe('la forma del contenido (ida y vuelta)', () => {
  it('cuenta bloques, texto y nodos', () => {
    const doc = new Y.Doc();
    group(doc).insert(0, [block('a', 'uno'), block('b', 'dos', 'heading')]);
    const shape = yShape(doc);
    expect(shape).toEqual({ ids: ['a', 'b'], text: 6, nodes: 5 });
    expect(sameShape(shape, { ...shape })).toBe(true);
    expect(sameShape(shape, { ...shape, ids: ['a'] })).toBe(false);
    expect(sameShape(shape, { ...shape, text: 5 })).toBe(false);
  });
});
