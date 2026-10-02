// @vitest-environment jsdom
import { TextSelection } from '@tiptap/pm/state';
import { afterAll, afterEach, expect, it } from 'vitest';
import * as Y from 'yjs';
import { PageDocs } from '../sync/docs';
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
// "Lo que escribió un dispositivo" se mira por los autores de Yjs que tuvieron sus documentos, anotados por la prueba
// en cada transacción (`watch`), no por el número con que se abrió cada uno: Yjs le cambia el número a un documento
// abierto cuando la reparación que va con lo bajado escribe (docs.ts, `applyToLive`). La prueba solo conocía el
// primero, y con más corridas avisaba de "texto ajeno" que era del mismo dispositivo (semillas 2 y 88 con 120 pasos,
// que quedan como casos fijos con la forma de entonces).
//
// Con la forma ampliada (la de las semillas al azar) a veces se cierra y se vuelve a abrir la página (al abrir se
// compacta lo guardado si pasa de 64 filas), en la misma pestaña o en otra (otro PageDocs sobre la misma base, como al
// cerrar la app y volver a abrirla), también sin red.
//
// Más corridas: REMOVED_SEEDS=300 REMOVED_STEPS=200 npx vitest run src/ui/collabRemovedWriting.test.ts
// Solo algunas: REMOVED_ONLY=2,88 (con REMOVED_CLASSIC=1, la forma de los casos fijos).

Range.prototype.getClientRects ??= (() => []) as never;
Range.prototype.getBoundingClientRect ??= (() => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 })) as never;

const SEEDS = Number(process.env.REMOVED_SEEDS ?? 12);
const STEPS = Number(process.env.REMOVED_STEPS ?? 60);
const ONLY = process.env.REMOVED_ONLY ? process.env.REMOVED_ONLY.split(',').map(Number) : null;
/**
 * Las corridas que fallaban (con la forma de entonces): la prueba tomaba como ajeno lo que el mismo dispositivo
 * escribió después de que Yjs le cambiara el número al documento.
 */
const FIXED: { seed: number; steps: number }[] = [
  { seed: 2, steps: 120 },
  { seed: 88, steps: 120 },
];

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

/** Un dispositivo: su base, su red y los autores de Yjs que tuvieron sus documentos (también en otras pestañas). */
interface Dev {
  d: Device;
  offline: boolean;
  /** Todos los autores de Yjs que tuvieron los documentos de la página en este dispositivo (ver `watch`). */
  clients: Set<number>;
  /** Los que no se exigen: escribieron antes de que la versión publicada subiera desde la misma base. */
  exempt: Set<number>;
}

/** Quien escribe en un dispositivo: un PageDocs (una pestaña) con la página abierta en un editor. */
interface Side {
  name: string;
  dev: Dev;
  docs: PageDocs;
  remote: FakeRemote;
  doc: Y.Doc;
  E: Editor;
  typed: string[];
}

/**
 * Anota en `clients` cada autor de Yjs que tiene el documento, al empezar y al terminar cada transacción: Yjs lo
 * cambia al final de una transacción remota en la que el documento escribió (la reparación con lo bajado). Cuenta en
 * `renewed` las veces que cambió.
 */
function watch(doc: Y.Doc, clients: Set<number>, renewed: { n: number }): void {
  clients.add(doc.clientID);
  doc.on('beforeTransaction', () => clients.add(doc.clientID));
  doc.on('afterTransactionCleanup', () => {
    if (!clients.has(doc.clientID)) renewed.n++;
    clients.add(doc.clientID);
  });
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

interface Outcome {
  problem: string | null;
  typed: number;
  letters: number;
  noticed: number;
  renewed: number;
  reopened: number;
  compacted: number;
}

/**
 * Una corrida. `classic`: la forma de los casos fijos (sin volver a abrir la página); si no, a veces se vuelve a abrir,
 * en la misma pestaña o en otra.
 */
async function run(seed: number, steps: number, classic: boolean): Promise<Outcome> {
  const rand = seeded(seed * 7919 + 13);
  // Lo de la forma ampliada sale de otra serie: la forma clásica sigue igual, paso por paso.
  const extra = seeded(seed * 104729 + 7);
  const renewed = { n: 0 };
  let reopened = 0;
  let compacted = 0;
  const server = new FakeServer();
  const [a, b, c] = [await makeDevice(server), await makeDevice(server), await makeDevice(server)];
  devices.push(a, b, c);
  const devs = [a, b, c].map((d): Dev => ({ d, offline: false, clients: new Set(), exempt: new Set() }));
  const pageId = await a.tree.create(null, 'P');
  await a.engine.syncNow();
  const docA = await a.docs.open(pageId, { seed: true });
  watch(docA, devs[0].clients, renewed);
  const first = mountEditor(docA, 'a');
  first.replaceBlocks(first.document, START as never);
  await a.docs.flush(pageId);
  await a.docs.pushPage(pageId, a.remote);
  await b.engine.syncNow();
  await c.engine.syncNow();
  const sides: Side[] = [{ name: 'a', dev: devs[0], docs: a.docs, remote: a.remote, doc: docA, E: first, typed: [] }];
  for (const [name, dev] of [['b', devs[1]], ['c', devs[2]]] as const) {
    const doc = await dev.d.docs.open(pageId);
    watch(doc, dev.clients, renewed);
    sides.push({ name, dev, docs: dev.d.docs, remote: dev.d.remote, doc, E: mountEditor(doc, name), typed: [] });
  }
  // Las pestañas que se abrieron después (ver `reopen`), para cerrarlas al final.
  const tabs: PageDocs[] = [];
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

  /**
   * Cierra la página y la vuelve a abrir desde lo guardado (con más de 64 filas, compacta). Con `newTab`, en otra
   * pestaña: otro PageDocs sobre la misma base, como al cerrar la pestaña (o la app) y abrir otra. La app no deja dos
   * pestañas abiertas a la vez en el mismo dispositivo (services.ts, el candado del navegador).
   */
  const reopen = async (s: Side, newTab: boolean) => {
    editors.splice(editors.indexOf(s.E), 1);
    s.E.unmount();
    s.docs.close(pageId);
    await s.docs.flush(pageId);
    // Con el candado de la página: espera a que el cierre termine (el documento se descarta).
    (await s.docs.indexSnapshot(pageId)).doc.destroy();
    if (newTab) {
      s.docs = new PageDocs(s.dev.d.db, { normalize: normalizeStructure, seed: seedIfEmpty });
      tabs.push(s.docs);
      s.remote = new FakeRemote(server, '0.021');
    }
    if ((await s.dev.d.db.countFromIndex('docUpdates', 'pageId', pageId)) > 64) compacted++;
    s.doc = await s.docs.open(pageId);
    watch(s.doc, s.dev.clients, renewed);
    s.E = mountEditor(s.doc, s.name);
    reopened++;
  };

  for (let step = 0; step < steps; step++) {
    if (!classic && extra() < 0.05) {
      try {
        await reopen(sides[Math.floor(extra() * sides.length)], extra() < 0.5);
      } catch (err) {
        errors.push(`step ${step} (reopen): ${String(err)}`);
      }
      continue;
    }
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
        if (!s.dev.offline) await s.docs.pushPage(pageId, s.remote).catch(() => undefined);
      } else if (r < 0.8) {
        if (!s.dev.offline) await s.docs.pullPage(pageId, s.remote);
      } else if (r < 0.86) {
        // Baja antes de subir: lo escrito entre la subida y la bajada de un ciclo, o una subida que venció.
        if (!s.dev.offline) {
          await s.docs.pullPage(pageId, s.remote);
          await s.docs.pushPage(pageId, s.remote).catch(() => undefined);
        }
      } else if (r < 0.9) {
        s.dev.offline = !s.dev.offline;
      } else if (r < 0.95) {
        // El dispositivo de la versión publicada escribe, sube y baja.
        if (rand() < 0.5) type(oldEditor, oldDoc, token('o'));
        await old.flush(pageId);
        await old.pushPage(pageId, oldRemote).catch(() => undefined);
        await old.pullPage(pageId, oldRemote);
      } else if (r < 0.97 && !s.dev.offline) {
        // Su misma base, abierta con la versión publicada (se cierra esta y se abre aquella, como al volver a una
        // versión anterior): sube lo pendiente con GC y baja. Después vuelve esta versión. (Otra pestaña de esta
        // versión con la página abierta sigue abierta.)
        editors.splice(editors.indexOf(s.E), 1);
        s.E.unmount();
        s.docs.close(pageId);
        await s.docs.flush(pageId);
        // Con el candado de la página: espera a que el cierre termine (el documento se descarta).
        (await s.docs.indexSnapshot(pageId)).doc.destroy();
        for (const t of sides) if (t.dev === s.dev) await t.docs.flush(pageId);
        for (const client of s.dev.clients) s.dev.exempt.add(client);
        const same = new MainPageDocs(s.dev.d.db, { normalize: normalizeStructure, seed: seedIfEmpty });
        await same.pushPage(pageId, new FakeRemote(server, '0.082')).catch(() => undefined);
        await same.pullPage(pageId, new FakeRemote(server, '0.082'));
        same.dispose();
        s.doc = await s.docs.open(pageId);
        watch(s.doc, s.dev.clients, renewed);
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
  for (const dev of devs) dev.offline = false;
  const round = async () => {
    for (const s of sides) {
      await s.docs.flush(pageId);
      await s.docs.pushPage(pageId, s.remote);
      await s.docs.pullPage(pageId, s.remote);
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
  for (const dev of devs) {
    // Una vez por dispositivo: las pestañas comparten la base (y los avisos, que están en `meta`).
    const s = sides.find((x) => x.dev === dev)!;
    // Lo guardado en el dispositivo, sin GC y en orden: las letras propias con su texto.
    const local = new Y.Doc({ gc: false });
    applyRowsInOrder(local, (await dev.d.db.getAllFromIndex('docUpdates', 'pageId', pageId)).map((r) => r.data));
    const own = [...dev.clients].filter((c) => !dev.exempt.has(c));
    const { missing, total } = lettersMissing(local, fromServer, own);
    letters += total;
    if (missing > 0) errors.push(`${s.name}: ${missing} of ${total} letters it wrote are not on the server`);
    local.destroy();
    const notes = await s.docs.removedWriting(pageId);
    noticed += notes.length;
    for (const n of notes) {
      const ranges = n.ranges ?? [];
      const foreign = ranges.map(([c]) => c).filter((c) => !dev.clients.has(c));
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
      if (holes && !ranges.every(([c]) => dev.exempt.has(c))) errors.push(`${s.name}: a noticed letter is a hole on the server`);
      const shown = n.text.replace(/\n/g, '').split('');
      if (!holes && shown.sort().join('') !== letters.sort().join('')) {
        errors.push(`${s.name}: notice text ${JSON.stringify(n.text)} is not its letters (${JSON.stringify(letters.join(''))})`);
      }
    }
  }
  for (const e of editors.splice(0)) e.unmount();
  for (const s of sides) s.docs.close(pageId);
  for (const t of tabs) {
    await t.flush(pageId);
    t.dispose();
  }
  old.close(pageId);
  old.dispose();
  oldDb.close();
  fromServer.destroy();
  return {
    problem: errors.length === 0 ? null : `seed ${seed}: ${errors.join('; ')}`,
    typed: sides.reduce((n, s) => n + s.typed.length, 0),
    letters,
    noticed,
    renewed: renewed.n,
    reopened,
    compacted,
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

async function runAll(list: { seed: number; steps: number; classic: boolean }[]) {
  const problems: string[] = [];
  const sum = { typed: 0, letters: 0, noticed: 0, renewed: 0, reopened: 0, compacted: 0 };
  for (const { seed, steps, classic } of list) {
    const out = await run(seed, steps, classic);
    if (out.problem) problems.push(out.problem);
    for (const k of Object.keys(sum) as (keyof typeof sum)[]) sum[k] += out[k];
  }
  console.log(
    `B.16 al azar: ${sum.typed} marcas, ${sum.letters} letras propias revisadas en el servidor, ${sum.noticed} avisos a quien ` +
      `escribió, ${sum.renewed} cambios de autor de Yjs, ${sum.reopened} páginas vueltas a abrir (${sum.compacted} compactando)`,
  );
  return { problems, sum };
}

it(`lo escrito en algo que otro borra llega al servidor y todos convergen (${ONLY ? ONLY.join(',') : SEEDS} corridas)`, async () => {
  const seeds = ONLY ?? Array.from({ length: SEEDS }, (_, i) => i + 1);
  const { problems, sum } = await runAll(seeds.map((seed) => ({ seed, steps: STEPS, classic: !!process.env.REMOVED_CLASSIC })));
  expect(problems).toEqual([]);
  // Que la prueba de verdad arme el caso: algo escrito quedó adentro de algo que otro borró, y se avisó.
  expect(sum.noticed).toBeGreaterThan(0);
}, 3_600_000);

it('las corridas que avisaban de texto ajeno: el aviso es de lo que escribió el mismo dispositivo', async () => {
  const { problems, sum } = await runAll(FIXED.map((f) => ({ ...f, classic: true })));
  expect(problems).toEqual([]);
  // En las dos, Yjs le cambia el número al documento de `c` y hay avisos.
  expect(sum.renewed).toBeGreaterThan(0);
  expect(sum.noticed).toBeGreaterThan(0);
}, 900_000);
