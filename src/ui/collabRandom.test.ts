// @vitest-environment jsdom
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { editors, mountEditor, press, sameDocs, seeded, tick, unmountAll, view, yText } from './collabHarness';

// Dos dispositivos escriben a la vez en una página nueva por el camino real de la app (PageDocs, IndexedDB, el
// servidor de prueba): ponen el cursor al principio o al final de un bloque al azar, a veces con Enter, y
// escriben una marca `{n}`; suben, bajan, y a veces se pierde la respuesta de una subida. Al final, sin
// importar el orden, cada marca escrita tiene que estar en los dos y en el servidor
// (Docs/Doc_Colaboracion.md). Antes de v0.054 perdía texto en 26 de cada 100 corridas.
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

async function run(seed: number): Promise<string | null> {
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
    if (r < 0.55) {
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
  await tick();
  const fromServer = new Y.Doc();
  Y.applyUpdate(fromServer, Y.mergeUpdates((server.updates.get(pageId) ?? []).map((u) => u.data)));
  const final = yText(docA);
  const missing = typed.filter((t) => !final.includes(t));
  const converged =
    sameDocs(docA, docB) &&
    fromServer.getXmlFragment(CONTENT_FRAGMENT).toJSON() === docA.getXmlFragment(CONTENT_FRAGMENT).toJSON();
  for (const e of editors.splice(0)) e.unmount();
  a.docs.close(pageId);
  b.docs.close(pageId);
  if (converged && missing.length === 0 && errors.length === 0) return null;
  return `seed ${seed}: converged=${converged} missing=${missing.join(',')} ${errors.join('; ')}`;
}

it(`dos dispositivos escribiendo a la vez en una página nueva no pierden nada (${SEEDS} corridas)`, async () => {
  const problems: string[] = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const problem = await run(seed);
    if (problem) problems.push(problem);
  }
  expect(problems).toEqual([]);
}, 600_000);
