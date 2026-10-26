// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { unitsFromYDoc } from '../search/extract';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { writeBlocks } from './fixtures/proyectoSintetico';
import { foldCards } from './FoldShots';
import { mergedTarget, readPointer } from './merge';
import { copyKey, mergeDepsFrom, pendingMerges, runFold, undoMerge, type MergeDeps, type MergeJob } from './mergeJob';
import { separatorId } from './mergeWrite';
import type { SceneLive } from './liveView';

// *Bring shots into this page* (D785) con dos dispositivos sobre el servidor en memoria: las tres fichas de una escena (dos
// con el mismo nombre, como las sub-filas de Coda) entran una debajo de la otra bajo un solo título 1 «Shots», cada una con
// su título 2; las fichas van a la papelera con un puntero al plano; el otro dispositivo ve lo mismo; repetir no duplica; y
// una ficha con comentarios queda como subpágina sin tocar la escena.

const devices: Device[] = [];
afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.docs.dispose();
    d.db.close();
  }
});

async function device(server: FakeServer): Promise<Device> {
  const d = await makeDevice(server);
  devices.push(d);
  return d;
}

interface World {
  server: FakeServer;
  a: Device;
  b: Device;
  scene: string;
  cards: string[];
}

async function world(): Promise<World> {
  const server = new FakeServer();
  server.enableTrash();
  const a = await device(server);
  await a.engine.syncNow();
  const bd = await a.tree.create(null, 'Breakdown');
  await a.tree.setSetting(bd, 'holds', 'scene');
  const ep = await a.tree.create(bd, '101');
  const scene = await a.tree.create(ep, '032 | Repentinamente se escucha un crujido');
  await writeBlocks(a, scene, [{ p: 'Notas de la escena.' }]);
  const cards: string[] = [];
  for (const [i, body] of ['La plataforma cae.', 'Detalle del piso.', 'Contraplano.'].entries()) {
    const c = await a.tree.create(scene, 'ERSO_101_032_010 Inquilinato');
    await writeBlocks(a, c, [
      { table: [['Shot Name', 'ERSO_101_032_010']] },
      { p: body },
      ...(i === 0 ? [{ h: 1 as const, text: 'Referencias' }, { p: 'Ver el storyboard.' }, { h: 2 as const, text: 'Consultas' }, { p: 'Sin consultas.' }] : []),
      ...(i === 2 ? [{ h: 3 as const, text: 'Sup Notes' }, { p: 'Ojo con el polvo.' }] : []),
    ]);
    cards.push(c);
  }
  await a.engine.syncNow();
  const b = await device(server);
  await b.engine.syncNow();
  return { server, a, b, scene, cards };
}

const deps = (d: Device): MergeDeps => ({ ...mergeDepsFrom(d, { comments: d.remote, check: () => null }), waitMs: 1500 });

const text = async (d: Device, pageId: string) => {
  const doc = await d.docs.open(pageId);
  const out = unitsFromYDoc(doc).map((u) => u.text);
  d.docs.close(pageId);
  return out;
};

/** Lo que `foldCards` necesita de la vista viva: las fichas y sus nombres de plano (todas «ERSO_101_032_010»). */
const live = (w: World): SceneLive =>
  ({
    pageId: w.scene,
    cards: w.cards.map((pageId) => ({ pageId, title: 'ERSO_101_032_010 Inquilinato' })),
    shots: w.cards.map((pageId) => ({ pageId, title: 'ERSO_101_032_010' })),
  }) as unknown as SceneLive;

/** Cada título de la página con su nivel. */
async function headingLevels(d: Device, pageId: string): Promise<Map<string, number>> {
  const doc = await d.docs.open(pageId);
  const out = new Map<string, number>();
  const walk = (n: Y.XmlElement) => {
    for (const c of n.toArray()) {
      if (!(c instanceof Y.XmlElement)) continue;
      if (c.nodeName === 'heading') out.set(c.toArray().map((t) => (t instanceof Y.XmlText ? t.toString().replace(/<[^>]+>/g, '') : '')).join(''), Number(c.getAttribute('level')));
      walk(c);
    }
  };
  walk(doc.getXmlFragment('document-store') as unknown as Y.XmlElement);
  d.docs.close(pageId);
  return out;
}

async function foldAll(d: Device, w: World) {
  const out = [];
  for (const c of foldCards(live(w))) {
    out.push(await runFold(deps(d), { scene: w.scene, card: c.pageId, projectId: d.tree.workspaceId, title: c.title, shots: 'Shots' }));
  }
  return out;
}

describe('Traer los planos a la página de la escena', () => {
  it('los nombres repetidos se numeran', () => {
    const w = { scene: 's', cards: ['c1', 'c2', 'c3'] } as World;
    // El título entero de la ficha («Inquilinato» no está en su cuerpo y no se pierde).
    expect(foldCards(live(w)).map((c) => c.title)).toEqual(['ERSO_101_032_010 Inquilinato', 'ERSO_101_032_010 Inquilinato · 2', 'ERSO_101_032_010 Inquilinato · 3']);
    // Solo las que se pueden traer (la cabecera pasa las subpáginas directas que no son un documento de una etapa).
    expect(foldCards(live(w), (id) => id !== 'c2').map((c) => c.pageId)).toEqual(['c1', 'c3']);
  });

  it('las tres fichas entran en orden bajo un solo «Shots», van a la papelera con el puntero, y el otro dispositivo lo ve', async () => {
    const w = await world();
    const out = await foldAll(w.a, w);
    expect(out.map((o) => o.status)).toEqual(['done', 'done', 'done']);
    for (const d of [w.a, w.b]) {
      await d.engine.syncNow();
      const t = await text(d, w.scene);
      expect(t[0]).toBe('Notas de la escena.');
      expect(t.filter((x) => x === 'Shots')).toHaveLength(1);
      const order = ['Shots', 'ERSO_101_032_010 Inquilinato', 'La plataforma cae.', 'Referencias', 'Ver el storyboard.', 'Consultas', 'Sin consultas.', 'ERSO_101_032_010 Inquilinato · 2', 'Detalle del piso.', 'ERSO_101_032_010 Inquilinato · 3', 'Contraplano.', 'Sup Notes', 'Ojo con el polvo.'];
      const at = order.map((x) => t.indexOf(x));
      expect(at.every((i) => i >= 0)).toBe(true);
      expect([...at].sort((x, y) => x - y)).toEqual(at);
      // Los títulos 1 y 2 de la ficha pasaron a 3: la sección «Shots» no se corta y los planos son los tres títulos 2.
      const levels = await headingLevels(d, w.scene);
      expect(levels.get('Referencias')).toBe(3);
      expect(levels.get('Consultas')).toBe(3);
      expect([...levels].filter(([, l]) => l === 2).map(([t]) => t)).toEqual(['ERSO_101_032_010 Inquilinato', 'ERSO_101_032_010 Inquilinato · 2', 'ERSO_101_032_010 Inquilinato · 3']);
      expect([...levels].filter(([, l]) => l === 1).map(([t]) => t)).toEqual(['Shots']);
      for (const c of w.cards) {
        expect(d.tree.isTrashed(c)).toBe(true);
        expect(mergedTarget(d.tree, c)).toBe(w.scene);
        // El puntero dice dónde quedó el plano: el título 2 que está en la escena.
        const block = readPointer(d.tree.get(c))?.block;
        expect(block).toBeTruthy();
        const doc = await d.docs.open(w.scene);
        expect(JSON.stringify(doc.getXmlFragment('document-store').toJSON())).toContain(block!);
        d.docs.close(w.scene);
      }
    }
    expect(await pendingMerges(deps(w.a).store)).toEqual([]);
  });

  it('el puntero apunta al título del plano de esa unión', async () => {
    const w = await world();
    const jobs: MergeJob[] = [];
    const [c] = foldCards(live(w));
    await runFold({ ...deps(w.a), afterStep: (_s, job) => void jobs.push(job) }, { scene: w.scene, card: c.pageId, projectId: w.a.tree.workspaceId, title: c.title, shots: 'Shots' });
    expect(readPointer(w.a.tree.get(c.pageId))?.block).toBe(separatorId(copyKey(jobs[0])));
  });

  it('con un comentario en una ficha, esa queda como subpágina y la escena no se toca por ella', async () => {
    const w = await world();
    await w.a.remote.addComment({ id: crypto.randomUUID(), pageId: w.cards[1], blockId: null, threadId: null, body: 'ojo' });
    const out = await foldAll(w.a, w);
    expect(out.map((o) => o.status)).toEqual(['done', 'blocked', 'done']);
    expect(w.a.tree.isTrashed(w.cards[1])).toBe(false);
    expect(w.a.tree.get(w.cards[1])?.parent_id).toBe(w.scene);
    const t = await text(w.a, w.scene);
    expect(t).not.toContain('Detalle del piso.');
    expect(t).toContain('Contraplano.');
  });

  it('deshacer el único plano traído saca su copia y el título «Shots» vacío; la ficha vuelve', async () => {
    const w = await world();
    const jobs: MergeJob[] = [];
    const [c] = foldCards(live(w));
    const out = await runFold({ ...deps(w.a), afterStep: (_s, job) => void jobs.push(job) }, { scene: w.scene, card: c.pageId, projectId: w.a.tree.workspaceId, title: c.title, shots: 'Shots' });
    expect(out.status).toBe('done');
    expect(await text(w.a, w.scene)).toContain('Shots');
    const done = jobs[jobs.length - 1];
    expect((await undoMerge(deps(w.a), done)).status).toBe('undone');
    const t = await text(w.a, w.scene);
    expect(t).not.toContain('Shots');
    expect(t).not.toContain('La plataforma cae.');
    expect(t).toContain('Notas de la escena.');
    expect(w.a.tree.isTrashed(c.pageId)).toBe(false);
  });

  it('repetir con una ficha que ya entró no la copia otra vez', async () => {
    const w = await world();
    await foldAll(w.a, w);
    const before = await text(w.a, w.scene);
    const again = await runFold(deps(w.a), { scene: w.scene, card: w.cards[0], projectId: w.a.tree.workspaceId, title: 'ERSO_101_032_010 Inquilinato', shots: 'Shots' });
    expect(again.status).not.toBe('done');
    expect(await text(w.a, w.scene)).toEqual(before);
  });
});
