// @vitest-environment jsdom
import { TextSelection } from '@tiptap/pm/state';
import { afterAll, afterEach, expect, it } from 'vitest';
import * as Y from 'yjs';
import { PageDocs as MainPageDocs } from '../sync/fixtures/mainDocs';
import { applyRowsInOrder } from '../sync/removedWriting';
import { CONTENT_FRAGMENT, normalizeStructure, seedIfEmpty } from '../sync/structure';
import { FakeRemote, FakeServer, makeDevice, type Device } from '../sync/testing';
import { editors, mountEditor, type Editor, press, seeded, showsDoc, tick, unmountAll, view, yText } from './collabHarness';
import { SHARED_COLLAPSE_MAP } from './collapseEditor';
import { schema as mainSchema } from './fixtures/editorSchemaMain';

// Roadmap B.16 (Docs/Doc_Sincronizacion.md, "La subida sin GC"), al azar con el editor real y el camino de la app
// (PageDocs, IndexedDB, el servidor de prueba). Tres dispositivos escriben marcas `{n}` en bloques al azar (párrafos,
// listas anidadas, celdas de tablas, secciones con su mapa de colapsar) mientras otros borran bloques padres, tablas
// y secciones enteras; a veces un dispositivo queda sin red, baja antes de subir, o abre su misma base con la versión
// publicada (fixtures/mainDocs.ts, con GC) y un cuarto dispositivo es de esa versión. Invariantes:
//
// - **Todo lo escrito con esta versión llega al servidor**: cada letra que un dispositivo guardó con su texto (en
//   sus propias filas de IndexedDB) está en el servidor con su texto, viva o borrada. Se mira por autor de Yjs (el
//   `clientID` de cada apertura), no por la marca: y-prosemirror reusa letras iguales de al lado al escribir, así que
//   una marca no siempre es un solo tramo. Lo escrito antes de que la versión publicada suba desde la misma base
//   queda fuera (ella sube con GC).
// - Todos terminan iguales entre sí y al servidor (también el mapa de colapsar), y cada editor muestra su documento.
// - Los avisos de "lo que escribiste quedó adentro de algo que se borró" son solo de lo que ese dispositivo escribió.
//
// Más corridas: REMOVED_SEEDS=100 REMOVED_STEPS=80 npx vitest run src/ui/collabRemovedWriting.test.ts

Range.prototype.getClientRects ??= (() => []) as never;
Range.prototype.getBoundingClientRect ??= (() => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 })) as never;

const SEEDS = Number(process.env.REMOVED_SEEDS ?? 12);
const STEPS = Number(process.env.REMOVED_STEPS ?? 60);

const devices: Device[] = [];
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
  unmountAll();
  for (const d of devices.splice(0)) {
    d.engine.stop();
    try {
      d.db.close();
    } catch {
      // ya cerrada
    }
  }
});

const START = [
  { id: 'h1', type: 'heading', props: { level: 1 }, content: 'Escena uno' },
  { id: 'p1', type: 'paragraph', content: 'Plano general' },
  {
    id: 'l1',
    type: 'bulletListItem',
    content: 'Lista',
    children: [
      { id: 'l2', type: 'bulletListItem', content: 'Hijo', children: [{ id: 'l3', type: 'bulletListItem', content: 'Nieto' }] },
      { id: 'l4', type: 'numberedListItem', content: 'Otro hijo' },
    ],
  },
  { id: 't1', type: 'table', content: { type: 'tableContent', rows: [{ cells: ['A1', 'B1'] }, { cells: ['A2', 'B2'] }] } },
  { id: 'h2', type: 'heading', props: { level: 2 }, content: 'Escena dos' },
  { id: 'p2', type: 'paragraph', content: 'Detalle', children: [{ id: 'p3', type: 'paragraph', content: 'Nota' }] },
  { id: 'p4', type: 'paragraph', content: 'Cierre' },
];

interface Side {
  name: string;
  d: Device;
  doc: Y.Doc;
  E: Editor;
  offline: boolean;
  typed: string[];
  /** Los autores de Yjs de cada apertura de la página en este dispositivo. */
  clients: Set<number>;
  /** Los que no se exigen: escribieron antes de que la versión publicada subiera desde la misma base. */
  exempt: Set<number>;
}

/** El elemento de `structs` (ordenados por reloj) que contiene `clock`, o `null`. */
function structAt(structs: (Y.Item | Y.GC)[], clock: number): Y.Item | Y.GC | null {
  let lo = 0;
  let hi = structs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = structs[mid];
    if (clock < s.id.clock) hi = mid - 1;
    else if (clock >= s.id.clock + s.length) lo = mid + 1;
    else return s;
  }
  return null;
}

/**
 * Las letras de estos autores que el dispositivo guardó con su texto y que el servidor no tiene con su texto. Devuelve
 * cuántas faltan y cuántas hay en total.
 */
function lettersMissing(local: Y.Doc, server: Y.Doc, clients: Iterable<number>): { missing: number; total: number } {
  let missing = 0;
  let total = 0;
  for (const client of clients) {
    const theirs = (server.store.clients.get(client) ?? []) as (Y.Item | Y.GC)[];
    for (const s of (local.store.clients.get(client) ?? []) as (Y.Item | Y.GC)[]) {
      if (!(s instanceof Y.Item) || !(s.content instanceof Y.ContentString)) continue;
      for (let i = 0; i < s.length; i++) {
        total++;
        const there = structAt(theirs, s.id.clock + i);
        if (!(there instanceof Y.Item) || !(there.content instanceof Y.ContentString)) missing++;
        else if (there.content.str[s.id.clock + i - there.id.clock] !== s.content.str[i]) missing++;
      }
    }
  }
  return { missing, total };
}

async function run(seed: number): Promise<{ problem: string | null; typed: number; letters: number; noticed: number }> {
  const rand = seeded(seed * 7919 + 13);
  const server = new FakeServer();
  const [a, b, c] = [await makeDevice(server), await makeDevice(server), await makeDevice(server)];
  devices.push(a, b, c);
  const pageId = await a.tree.create(null, 'P');
  await a.engine.syncNow();
  const docA = await a.docs.open(pageId, { seed: true });
  const first = mountEditor(docA, 'a');
  first.replaceBlocks(first.document, START as never);
  await a.docs.flush(pageId);
  await a.docs.pushPage(pageId, a.remote);
  await b.engine.syncNow();
  await c.engine.syncNow();
  const sides: Side[] = [{ name: 'a', d: a, doc: docA, E: first, offline: false, typed: [], clients: new Set([docA.clientID]), exempt: new Set() }];
  for (const [name, d] of [['b', b], ['c', c]] as const) {
    const doc = await d.docs.open(pageId);
    sides.push({ name, d, doc, E: mountEditor(doc, name), offline: false, typed: [], clients: new Set([doc.clientID]), exempt: new Set() });
  }
  // La versión publicada, en otro dispositivo (sin motor: solo el contenido), con el esquema de esa versión.
  const oldDb = (await makeDevice(server)).db;
  const old = new MainPageDocs(oldDb, { normalize: normalizeStructure, seed: seedIfEmpty });
  const oldRemote = new FakeRemote(server, '0.082');
  await old.pullPage(pageId, oldRemote);
  const oldDoc = await old.open(pageId);
  const oldEditor = mountEditor(oldDoc, 'o', mainSchema);

  const errors: string[] = [];
  let counter = 0;
  const token = (who: string) => `{${seed}.${counter++}${who}}`;
  const type = (E: Editor, doc: Y.Doc, mark: string) => {
    const v = view(E);
    const ends: number[] = [];
    v.state.doc.descendants((n, p) => {
      if (!n.isTextblock) return true;
      ends.push(p + 1, p + 1 + n.content.size);
      return false;
    });
    if (ends.length === 0) return false;
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, ends[Math.floor(rand() * ends.length)])));
    if (rand() < 0.1) press(E, 'Enter');
    E.insertInlineContent(mark);
    if (!yText(doc).includes(mark)) errors.push(`${mark} is not even in the local document`);
    return true;
  };

  for (let step = 0; step < STEPS; step++) {
    const s = sides[Math.floor(rand() * sides.length)];
    const r = rand();
    try {
      if (r < 0.36) {
        const mark = token(s.name);
        if (type(s.E, s.doc, mark)) s.typed.push(mark);
      } else if (r < 0.52) {
        removeOp(s.E, rand);
      } else if (r < 0.58) {
        structuralOp(s.E, rand);
      } else if (r < 0.62) {
        // Colapsar para todos: el mapa de la página (no es contenido; tiene que sobrevivir igual).
        const ids: string[] = [];
        view(s.E).state.doc.descendants((n) => {
          if (n.type.name === 'blockContainer' && n.firstChild?.type.name === 'heading') ids.push(n.attrs.id as string);
          return true;
        });
        if (ids.length > 0) s.doc.getMap(SHARED_COLLAPSE_MAP).set(ids[Math.floor(rand() * ids.length)], rand() < 0.6);
      } else if (r < 0.7) {
        if (!s.offline) await s.d.docs.pushPage(pageId, s.d.remote).catch(() => undefined);
      } else if (r < 0.8) {
        if (!s.offline) await s.d.docs.pullPage(pageId, s.d.remote);
      } else if (r < 0.86) {
        // Baja antes de subir: lo escrito entre la subida y la bajada de un ciclo, o una subida que venció.
        if (!s.offline) {
          await s.d.docs.pullPage(pageId, s.d.remote);
          await s.d.docs.pushPage(pageId, s.d.remote).catch(() => undefined);
        }
      } else if (r < 0.9) {
        s.offline = !s.offline;
      } else if (r < 0.95) {
        // El dispositivo de la versión publicada escribe, sube y baja.
        if (rand() < 0.5) type(oldEditor, oldDoc, token('o'));
        await old.flush(pageId);
        await old.pushPage(pageId, oldRemote).catch(() => undefined);
        await old.pullPage(pageId, oldRemote);
      } else if (r < 0.97 && !s.offline) {
        // Su misma base, abierta con la versión publicada (se cierra esta y se abre aquella, como al volver a una
        // versión anterior): sube lo pendiente con GC y baja. Después vuelve esta versión.
        editors.splice(editors.indexOf(s.E), 1);
        s.E.unmount();
        s.d.docs.close(pageId);
        await s.d.docs.flush(pageId);
        // Con el candado de la página: espera a que el cierre termine (el documento se descarta).
        (await s.d.docs.indexSnapshot(pageId)).doc.destroy();
        for (const client of s.clients) s.exempt.add(client);
        const same = new MainPageDocs(s.d.db, { normalize: normalizeStructure, seed: seedIfEmpty });
        await same.pushPage(pageId, new FakeRemote(server, '0.082')).catch(() => undefined);
        await same.pullPage(pageId, new FakeRemote(server, '0.082'));
        same.dispose();
        s.doc = await s.d.docs.open(pageId);
        s.clients.add(s.doc.clientID);
        s.E = mountEditor(s.doc, s.name);
      } else {
        server.loseNextPushResponse = true;
      }
    } catch (err) {
      errors.push(`step ${step}: ${String(err)}`);
    }
    if (rand() < 0.3) await tick(1);
  }
  server.loseNextPushResponse = false;
  for (const s of sides) s.offline = false;
  const round = async () => {
    for (const s of sides) {
      await s.d.docs.flush(pageId);
      await s.d.docs.pushPage(pageId, s.d.remote);
      await s.d.docs.pullPage(pageId, s.d.remote);
    }
    await old.flush(pageId);
    await old.pushPage(pageId, oldRemote);
    await old.pullPage(pageId, oldRemote);
  };
  for (let i = 0; i < 3; i++) await round();
  // Los ids repetidos que deja una fusión se arreglan con la próxima transacción de cada editor (ver
  // collabRandom.test.ts): una vuelta más moviendo solo el cursor.
  for (const E of [...sides.map((s) => s.E), oldEditor]) {
    const v = view(E);
    v.dispatch(v.state.tr.setSelection(TextSelection.atStart(v.state.doc)));
  }
  for (let i = 0; i < 2; i++) await round();
  await tick();

  const rows = server.updates.get(pageId) ?? [];
  const fromServer = new Y.Doc({ gc: false });
  applyRowsInOrder(fromServer, rows.map((u) => u.data));
  // El mapa de colapsar, con las claves ordenadas (el orden de `toJSON` depende de cómo llegó cada una).
  const shown = (doc: Y.Doc) =>
    JSON.stringify([doc.getXmlFragment(CONTENT_FRAGMENT).toJSON(), Object.entries(doc.getMap(SHARED_COLLAPSE_MAP).toJSON()).sort()]);
  const reference = shown(fromServer);
  const converged = [...sides.map((s) => s.doc), oldDoc].every((doc) => shown(doc) === reference);
  if (!converged) {
    const who = [...sides.map((x) => [x.name, x.doc] as const), ['old', oldDoc] as const].filter(([, doc]) => shown(doc) !== reference).map(([n]) => n);
    errors.push(`not converged (${who.join(',')})`);
    if (process.env.REMOVED_DEBUG) {
      console.log('server', yText(fromServer));
      for (const [n, doc] of [...sides.map((x) => [x.name, x.doc] as const), ['old', oldDoc] as const]) console.log(n, yText(doc), JSON.stringify(doc.getMap(SHARED_COLLAPSE_MAP).toJSON()));
    }
  }
  for (const s of sides) if (!showsDoc(s.E, s.doc)) errors.push(`editor ${s.name} shows an old document`);
  let letters = 0;
  let noticed = 0;
  for (const s of sides) {
    // Lo guardado en el dispositivo, sin GC y en orden: las letras propias con su texto.
    const local = new Y.Doc({ gc: false });
    applyRowsInOrder(local, (await s.d.db.getAllFromIndex('docUpdates', 'pageId', pageId)).map((r) => r.data));
    const own = [...s.clients].filter((c) => !s.exempt.has(c));
    const { missing, total } = lettersMissing(local, fromServer, own);
    letters += total;
    if (missing > 0) errors.push(`${s.name}: ${missing} of ${total} letters it wrote are not on the server`);
    local.destroy();
    const notes = await s.d.docs.removedWriting(pageId);
    noticed += notes.length;
    for (const n of notes) {
      const ranges = n.ranges ?? [];
      const foreign = ranges.map(([c]) => c).filter((c) => !s.clients.has(c));
      if (foreign.length > 0) errors.push(`${s.name} was told about text it did not write (${foreign.join(',')})`);
      if (!n.text.trim()) errors.push(`${s.name} got an empty notice`);
      // El texto del aviso son exactamente las letras de sus tramos, que en el servidor están borradas.
      // (Lo que la versión publicada subió desde la misma base llega como hueco: esas letras no se pueden comparar.)
      const letters: string[] = [];
      let holes = false;
      for (const [client, from, to] of ranges) {
        const structs = (fromServer.store.clients.get(client) ?? []) as (Y.Item | Y.GC)[];
        for (let clock = from; clock < to; clock++) {
          const there = structAt(structs, clock);
          if (there instanceof Y.Item && !there.deleted) errors.push(`${s.name}: a noticed letter is not deleted on the server`);
          else if (!(there instanceof Y.Item)) holes = true;
          else if (there.content instanceof Y.ContentString) letters.push(there.content.str[clock - there.id.clock]);
        }
      }
      if (holes && !ranges.every(([c]) => s.exempt.has(c))) errors.push(`${s.name}: a noticed letter is a hole on the server`);
      const shown = n.text.replace(/\n/g, '').split('');
      if (!holes && shown.sort().join('') !== letters.sort().join('')) {
        errors.push(`${s.name}: notice text ${JSON.stringify(n.text)} is not its letters (${JSON.stringify(letters.join(''))})`);
      }
    }
  }
  for (const e of editors.splice(0)) e.unmount();
  for (const s of sides) s.d.docs.close(pageId);
  old.close(pageId);
  old.dispose();
  oldDb.close();
  fromServer.destroy();
  return {
    problem: errors.length === 0 ? null : `seed ${seed}: ${errors.join('; ')}`,
    typed: sides.reduce((n, s) => n + s.typed.length, 0),
    letters,
    noticed,
  };
}

/** Borra un bloque con hijos, una tabla, una sección (un título y lo que sigue) o un bloque cualquiera. */
function removeOp(E: Editor, rand: () => number): void {
  const v = view(E);
  const parents: string[] = [];
  const tables: string[] = [];
  const headings: string[] = [];
  const all: string[] = [];
  v.state.doc.descendants((n) => {
    if (n.type.name !== 'blockContainer') return true;
    const id = n.attrs.id as string;
    all.push(id);
    if (n.childCount > 1) parents.push(id);
    if (n.firstChild?.type.name === 'table') tables.push(id);
    if (n.firstChild?.type.name === 'heading') headings.push(id);
    return true;
  });
  if (all.length <= 2) return;
  const k = rand();
  const pick = (list: string[]) => list[Math.floor(rand() * list.length)];
  if (k < 0.35 && parents.length > 0) E.removeBlocks([pick(parents)]);
  else if (k < 0.55 && tables.length > 0) E.removeBlocks([pick(tables)]);
  else if (k < 0.8 && headings.length > 0) {
    // La sección: el título y los bloques de arriba del todo que le siguen hasta el próximo título.
    const top = E.document;
    const at = top.findIndex((bl) => bl.id === pick(headings));
    if (at < 0) return;
    const ids = [top[at].id];
    for (let i = at + 1; i < top.length && top[i].type !== 'heading'; i++) ids.push(top[i].id);
    if (ids.length < top.length) E.removeBlocks(ids);
  } else E.removeBlocks([pick(all)]);
}

/** Un cambio de estructura en un bloque al azar (como collabRandom.test.ts). */
function structuralOp(E: Editor, rand: () => number): void {
  const v = view(E);
  const blocks: { id: string; pos: number }[] = [];
  v.state.doc.descendants((n, pos) => {
    if (n.type.name === 'blockContainer') blocks.push({ id: n.attrs.id as string, pos });
    return true;
  });
  const { id, pos } = blocks[Math.floor(rand() * blocks.length)];
  const k = rand();
  try {
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, pos + 2)));
    if (k < 0.3) press(E, 'Tab');
    else if (k < 0.45) press(E, 'Tab', { shiftKey: true });
    else if (k < 0.7) E.updateBlock(id, { type: rand() < 0.5 ? 'heading' : 'bulletListItem' } as never);
    else if (k < 0.85) press(E, 'Backspace');
    else (E as unknown as { moveBlocksUp: () => void }).moveBlocksUp();
  } catch {
    // Un error de BlockNote al hacer el cambio (sangrar el primero, por ejemplo) no toca el documento.
  }
}

it(`lo escrito en algo que otro borra llega al servidor y todos convergen (${SEEDS} corridas)`, async () => {
  const problems: string[] = [];
  let typed = 0;
  let letters = 0;
  let noticed = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const out = await run(seed);
    if (out.problem) problems.push(out.problem);
    typed += out.typed;
    letters += out.letters;
    noticed += out.noticed;
  }
  console.log(`B.16 al azar: ${typed} marcas, ${letters} letras propias revisadas en el servidor, ${noticed} avisos a quien escribió`);
  expect(problems).toEqual([]);
  // Que la prueba de verdad arme el caso: algo escrito quedó adentro de algo que otro borró, y se avisó.
  expect(noticed).toBeGreaterThan(0);
}, 900_000);
