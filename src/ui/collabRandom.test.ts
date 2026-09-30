// @vitest-environment jsdom
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { editors, mountEditor, type Editor, press, sameDocs, seeded, showsDoc, tick, unmountAll, view, yText } from './collabHarness';

// Dos dispositivos escriben a la vez en una página nueva por el camino real de la app (PageDocs, IndexedDB, el
// servidor de prueba): ponen el cursor al principio o al final de un bloque al azar, a veces con Enter, y
// escriben una marca `{n}`; suben, bajan, y a veces se pierde la respuesta de una subida. Al final, sin
// importar el orden, cada marca escrita tiene que estar en los dos y en el servidor
// (Docs/Doc_Colaboracion.md). Antes de v0.054 perdía texto en 26 de cada 100 corridas.
//
// La segunda prueba suma cambios de estructura (sangrar, cambiar el tipo, juntar, mover, borrar): ahí se puede
// perder texto por cómo funciona y-prosemirror (ver el documento), así que solo exige que los dos terminen
// iguales al servidor, que cada editor muestre lo que dice el documento y que nada tire un error.
//
// En CI corren unas semillas fijas; con COLLAB_SEEDS=100 (o más) corre la prueba grande.

const devices: Device[] = [];

afterEach(() => {
  unmountAll();
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
  }
});

const SEEDS = Number(process.env.COLLAB_SEEDS ?? 24);
const STEPS = Number(process.env.COLLAB_STEPS ?? 60);

async function run(seed: number, structural = false): Promise<string | null> {
  const rand = seeded(seed * 31337 + 7);
  const server = new FakeServer();
  const a = await makeDevice(server);
  const b = await makeDevice(server);
  devices.push(a, b);
  const pageId = await a.tree.create(null, 'P');
  await a.engine.syncNow();
  await b.engine.syncNow();
  // Los dos abren la página nueva a la vez: cada uno pone la semilla.
  const docA = await a.docs.open(pageId, { seed: true });
  const docB = await b.docs.open(pageId, { seed: true });
  const A = mountEditor(docA, 'a');
  const B = mountEditor(docB, 'b');
  const typed: string[] = [];
  const errors: string[] = [];
  const inflight: Promise<unknown>[] = [];
  for (let step = 0; step < STEPS; step++) {
    const [E, d, doc] = rand() < 0.5 ? [A, a, docA] : [B, b, docB];
    const r = rand();
    if (structural && r >= 0.45 && r < 0.68) {
      structuralOp(E, rand);
    } else if (r < (structural ? 0.45 : 0.55)) {
      const v = view(E);
      const ends: number[] = [];
      v.state.doc.descendants((n, p) => {
        if (!n.isTextblock) return true;
        ends.push(p + 1, p + 1 + n.content.size);
        return false;
      });
      const pos = ends[Math.floor(rand() * ends.length)];
      v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, pos)));
      const token = `{${seed}.${step}}`;
      typed.push(token);
      if (rand() < 0.15) press(E, 'Enter');
      E.insertInlineContent(token);
      if (!yText(doc).includes(token)) errors.push(`${token} is not even in the local document`);
    } else if (r < 0.75) inflight.push(d.docs.pushPage(pageId, d.remote).catch(() => undefined));
    else if (r < 0.95) inflight.push(d.docs.pullPage(pageId, d.remote).catch((e: unknown) => errors.push(`pull: ${String(e)}`)));
    else server.loseNextPushResponse = true;
    if (rand() < 0.3) {
      await Promise.all(inflight.splice(0));
      await tick(1);
    }
  }
  await Promise.all(inflight.splice(0));
  server.loseNextPushResponse = false;
  for (let i = 0; i < 3; i++) {
    for (const d of [a, b]) {
      await d.docs.flush(pageId);
      await d.docs.pushPage(pageId, d.remote);
      await d.docs.pullPage(pageId, d.remote);
    }
  }
  // Si una fusión dejó dos bloques con el mismo id, cada editor le cambia el id a uno al dibujarlo y lo guarda
  // con su próxima transacción (Docs/Doc_Colaboracion.md, "Ids repetidos"): una vuelta más, con solo mover el
  // cursor, y otra sincronización.
  for (const E of [A, B]) {
    const v = view(E);
    v.dispatch(v.state.tr.setSelection(TextSelection.atStart(v.state.doc)));
  }
  for (let i = 0; i < 2; i++) {
    for (const d of [a, b]) {
      await d.docs.flush(pageId);
      await d.docs.pushPage(pageId, d.remote);
      await d.docs.pullPage(pageId, d.remote);
    }
  }
  await tick();
  const fromServer = new Y.Doc();
  Y.applyUpdate(fromServer, Y.mergeUpdates((server.updates.get(pageId) ?? []).map((u) => u.data)));
  const final = yText(docA);
  const missing = structural ? [] : typed.filter((t) => !final.includes(t));
  // Con cambios de estructura, un bloque puede quedar dos veces (se prefiere duplicar a perder).
  const twice = structural ? [] : typed.filter((t) => final.split(t).length > 2);
  if (!showsDoc(A, docA) || !showsDoc(B, docB)) errors.push('an editor shows an old document');
  const converged =
    sameDocs(docA, docB) &&
    fromServer.getXmlFragment(CONTENT_FRAGMENT).toJSON() === docA.getXmlFragment(CONTENT_FRAGMENT).toJSON();
  for (const e of editors.splice(0)) e.unmount();
  a.docs.close(pageId);
  b.docs.close(pageId);
  if (converged && missing.length === 0 && twice.length === 0 && errors.length === 0) return null;
  return `seed ${seed}: converged=${converged} missing=${missing.join(',')} twice=${twice.join(',')} ${errors.join('; ')}`;
}

/** Un cambio de estructura en un bloque al azar (de la auditoría). */
function structuralOp(E: Editor, rand: () => number): void {
  const v = view(E);
  const blocks: { id: string; pos: number }[] = [];
  v.state.doc.descendants((n, pos) => {
    if (n.type.name === 'blockContainer') blocks.push({ id: n.attrs.id as string, pos });
    return true;
  });
  const { id, pos } = blocks[Math.floor(rand() * blocks.length)];
  const k = rand();
  // Un error de BlockNote al hacer el cambio (por ejemplo, sangrar el primer bloque) no toca el documento.
  try {
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, pos + 2)));
    if (k < 0.3) press(E, 'Tab');
    else if (k < 0.4) press(E, 'Tab', { shiftKey: true });
    else if (k < 0.6) E.updateBlock(id, { type: rand() < 0.5 ? 'heading' : 'bulletListItem' } as never);
    else if (k < 0.75) press(E, 'Backspace');
    else if (k < 0.85) (E as unknown as { moveBlocksUp: () => void }).moveBlocksUp();
    else if (k < 0.92) E.updateBlock(id, { props: { textColor: 'red' } } as never);
    else if (blocks.length > 2) E.removeBlocks([id]);
  } catch {
    // Nada.
  }
}

it(`dos dispositivos escribiendo a la vez en una página nueva no pierden nada (${SEEDS} corridas)`, async () => {
  const problems: string[] = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const problem = await run(seed);
    if (problem) problems.push(problem);
  }
  expect(problems).toEqual([]);
}, 600_000);

it(`con cambios de estructura a la vez: terminan iguales y cada editor muestra el documento (${SEEDS} corridas)`, async () => {
  const problems: string[] = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const problem = await run(seed, true);
    if (problem) problems.push(problem);
  }
  expect(problems).toEqual([]);
}, 600_000);
