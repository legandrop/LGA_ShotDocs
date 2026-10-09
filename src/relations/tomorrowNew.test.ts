// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import type * as Y from 'yjs';
import { ProjectIndex } from '../search/projectIndex';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { BUILTIN_ONSET } from '../templates/builtinIds';
import { schema } from '../ui/editorSchema';
import { dayLive, headingStyleFor, linkTargetOf } from './dayLive';
import { buildProject, writeBlocks, type Built } from './fixtures/proyectoSintetico';
import { dayRef, type LiveSource } from './liveView';
import { RelationIndex } from './relationIndex';
import { addDays, createTomorrow, nextDayNumber, nextDayTitle, proposeTomorrow, reportOnDate, undoTomorrow, type TomorrowInput } from './tomorrowNew';

// La tarjeta *Tomorrow* de un día sin día siguiente (D573–D577): crear el reporte de mañana como *New day report* y
// prepararlo en un paso, con las garantías de *Prepare*: solo agrega, no duplica (dos toques, otro dispositivo), *Undo*
// seguro (a la papelera solo si nadie lo tocó, después de sincronizar) y sin red no crea.

const devices: Device[] = [];
afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.docs.dispose();
    d.db.close();
  }
});
let n = 0;
const fakePhoto = async () => `0000${String(++n).padStart(4, '0')}-cccc-4bbb-8ccc-dddddddddddd`;

function editorOn(doc: Y.Doc): { e: BlockNoteEditor; done: () => void } {
  const e = BlockNoteEditor.create(withCollaboration({ schema, collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'x', color: '#000' } } }) as never) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  e.mount(el);
  return { e, done: () => (e.unmount(), el.remove()) };
}

async function headingsOf(d: Device, pageId: string): Promise<string[]> {
  const doc = await d.docs.open(pageId);
  const { e, done } = editorOn(doc);
  const out = e.document
    .filter((b) => b.type === 'heading')
    .map((b) => (b.content as { text?: string; content?: { text: string }[] }[]).map((c) => c.text ?? (c.content ?? []).map((x) => x.text).join('')).join(''));
  done();
  d.docs.close(pageId);
  return out;
}

/** La foto del índice de un dispositivo, y lo que la tarjeta le pasa a `createTomorrow`. */
async function sourceOf(d: Device, built: Built): Promise<{ src: LiveSource; input: TomorrowInput }> {
  const index = new ProjectIndex(d.tree, d.docs);
  const rel = new RelationIndex(d.tree, index);
  await index.refresh(built.projectId);
  await rel.update(built.projectId);
  const src: LiveSource = { snap: rel.snapshot(built.projectId)!, title: (id) => d.tree.get(id)?.title, content: (id) => index.content(id) };
  const p = proposeTomorrow(src, dayRef(src, built.ids.d76))!;
  const scenes = p.plan.codes.flatMap((code) => {
    const pageId = src.snap.registry.scenes.get(code)?.pageId;
    return pageId ? [{ code, pageId }] : [];
  });
  const style = headingStyleFor(src, built.ids.d76, 'es');
  return {
    src,
    input: {
      projectId: built.projectId,
      parentId: built.ids.rodaje,
      todayTitle: d.tree.get(built.ids.d76)!.title,
      date: p.date,
      lang: 'es',
      prepare: { scenes, registry: src.snap.registry, linkTarget: linkTargetOf(src), word: style.word, level: style.level },
    },
  };
}

const depsOf = (d: Device) => ({ tree: d.tree, docs: d.docs, engine: d.engine });
const canCreate = () => true;

/** El proyecto sintético con dos fichas filmadas el 16/03 (el lunes después del Día 76, del sábado 14). */
async function world(server = new FakeServer()): Promise<{ A: Device; built: Built; server: FakeServer }> {
  const A = await makeDevice(server);
  devices.push(A);
  const built = await buildProject(A, fakePhoto, { indexPage: false, days: true });
  await writeBlocks(A, built.ids.s008, [{ table: [['Fecha Rodaje', '16/03/2026']] }]);
  await writeBlocks(A, built.ids.s029, [{ table: [['Fecha Rodaje', '16/03/2026']] }]);
  await A.engine.syncNow();
  return { A, built, server };
}

describe('qué propone (puro)', () => {
  it('el título con la forma del de hoy: la palabra, el separador y los ceros; sin la locación de hoy', () => {
    expect(nextDayTitle('2026-02-20 | Día 60 | CENADE', '2026-02-21', 61, 'en')).toBe('2026-02-21 | Día 61');
    expect(nextDayTitle('2026-10-02 | Day 06', '2026-10-03', 7, 'es')).toBe('2026-10-03 | Day 07');
    expect(nextDayTitle('2026-10-02 · Dia 9', '2026-10-03', 10, 'es')).toBe('2026-10-03 | Día 10');
    expect(nextDayTitle('Rodaje del martes', '2026-10-03', 4, 'en')).toBe('2026-10-03 | Day 04');
    expect(nextDayNumber('2026-02-20 | Día 60 | CENADE', 3)).toBe(61);
    expect(nextDayNumber('2026-03-10 | Sin reporte', 3)).toBe(3);
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('la fecha: la próxima con escenas en el desglose dentro de una semana; si no, el día siguiente; sin fecha, nada', async () => {
    const { A, built } = await world();
    const { src } = await sourceOf(A, built);
    // Día 76 (sábado 14/03): el desglose dice 16/03 → ese, con sus dos escenas.
    expect(proposeTomorrow(src, dayRef(src, built.ids.d76))).toMatchObject({ date: '2026-03-16', plan: { source: 'breakdown', codes: ['104_008', '105_029'] } });
    // Sin nada en la semana: el día siguiente, sin plan.
    const lone = { pageId: 'x', label: 'Día 90', date: '2026-05-01', loc: null, locs: [] };
    expect(proposeTomorrow(src, lone)).toMatchObject({ date: '2026-05-02', plan: { codes: [], source: 'none' } });
    expect(proposeTomorrow(src, { ...lone, date: null })).toBeNull();
    // La cabecera del Día 76 no tiene tarjeta Tomorrow (no hay día siguiente): ahí va esta.
    expect(dayLive(src, built.ids.d76).tomorrow).toBeNull();
  });
});

describe('crear y preparar el reporte de mañana', () => {
  it('crea en la carpeta del día, con el título del proyecto, la plantilla de New day report, la marca de día y las secciones', async () => {
    const { A, built } = await world();
    const { input } = await sourceOf(A, built);
    const res = await createTomorrow(depsOf(A), input, canCreate);
    if (res.status !== 'ok') throw new Error(res.status);
    expect(res.created).toBe(true);
    const row = A.tree.get(res.pageId)!;
    expect(row).toMatchObject({ title: '2026-03-16 | Día 77', parent_id: built.ids.rodaje, template_id: BUILTIN_ONSET });
    expect(row.settings?.entity).toEqual({ kind: 'day' });
    // La plantilla (la ficha del día) y, al final, una sección por escena del plan, con el número como link.
    const heads = await headingsOf(A, res.pageId);
    expect(heads.slice(-2)).toEqual(['Escena 104_008', 'Escena 105_029']);
    expect(res.prepared).toMatchObject({ status: 'ok', added: [{ code: '104_008' }, { code: '105_029' }] });
    // La carpeta no cambió de marca.
    expect(A.tree.get(built.ids.rodaje)!.settings?.dayReports).toEqual({});
  });

  it('dos toques seguidos en el mismo dispositivo: un solo reporte', async () => {
    const { A, built } = await world();
    const { input } = await sourceOf(A, built);
    const [a, b] = await Promise.all([createTomorrow(depsOf(A), input, canCreate), createTomorrow(depsOf(A), input, canCreate)]);
    expect(a).toBe(b);
    expect(A.tree.children(built.ids.rodaje).filter((p) => p.title.startsWith('2026-03-16')).length).toBe(1);
    // Y otra vez después: prepara el que existe (no agrega nada) y no crea otro.
    const again = await createTomorrow(depsOf(A), input, canCreate);
    expect(again).toMatchObject({ status: 'ok', created: false, prepared: { status: 'ok', added: [] } });
    expect(A.tree.children(built.ids.rodaje).filter((p) => p.title.startsWith('2026-03-16')).length).toBe(1);
  });

  it('dos dispositivos: A crea; B (con su tarjeta todavía vieja) toca después: sincroniza, encuentra el de A y no duplica nada', async () => {
    const { A, built, server } = await world();
    const B = await makeDevice(server);
    devices.push(B);
    await B.engine.syncNow();
    const fromB = await sourceOf(B, built);
    const { input } = await sourceOf(A, built);
    const res = await createTomorrow(depsOf(A), input, canCreate);
    if (res.status !== 'ok') throw new Error(res.status);
    await A.engine.syncNow();
    const resB = await createTomorrow(depsOf(B), fromB.input, canCreate);
    expect(resB).toMatchObject({ status: 'ok', created: false, pageId: res.pageId, prepared: { status: 'ok', added: [] } });
    expect(B.tree.children(built.ids.rodaje).filter((p) => p.title.startsWith('2026-03-16')).length).toBe(1);
    await B.engine.syncNow();
    await A.engine.syncNow();
    expect((await headingsOf(A, res.pageId)).filter((h) => h.startsWith('Escena'))).toEqual(['Escena 104_008', 'Escena 105_029']);
  });

  it('sin red no crea nada y lo dice (otro dispositivo pudo crearlo ya)', async () => {
    const { A, built, server } = await world();
    const { input } = await sourceOf(A, built);
    const before = A.tree.children(built.ids.rodaje).length;
    server.online = false;
    expect(await createTomorrow(depsOf(A), input, canCreate)).toEqual({ status: 'offline' });
    expect(A.tree.children(built.ids.rodaje).length).toBe(before);
    server.online = true;
  });

  it('sin permiso de crear en la carpeta (mirado después de sincronizar): no crea', async () => {
    const { A, built } = await world();
    const { input } = await sourceOf(A, built);
    const before = A.tree.children(built.ids.rodaje).length;
    expect(await createTomorrow(depsOf(A), input, () => false)).toEqual({ status: 'cantCreate' });
    expect(A.tree.children(built.ids.rodaje).length).toBe(before);
  });

  it('Undo: a la papelera si nadie lo tocó; si otro dispositivo ya escribió, queda', async () => {
    const { A, built, server } = await world();
    const { input } = await sourceOf(A, built);
    const res = await createTomorrow(depsOf(A), input, canCreate);
    if (res.status !== 'ok') throw new Error(res.status);
    expect(await undoTomorrow(depsOf(A), res, built.ids.rodaje, input.prepare.linkTarget)).toEqual({ kind: 'trashed' });
    expect(A.tree.isTrashed(res.pageId)).toBe(true);
    expect(reportOnDate(A.tree, built.ids.rodaje, built.projectId, '2026-03-16')).toBeNull();

    // Otra vez; B baja el reporte nuevo y escribe en él; A deshace: sincroniza, ve lo de B y no lo manda a la papelera.
    const res2 = await createTomorrow(depsOf(A), input, canCreate);
    if (res2.status !== 'ok' || res2.prepared.status !== 'ok') throw new Error('no creó');
    await A.engine.syncNow();
    const B = await makeDevice(server);
    devices.push(B);
    await B.engine.syncNow();
    const docB = await B.docs.open(res2.pageId);
    const { e, done } = editorOn(docB);
    e.updateBlock(res2.prepared.added[0].paragraphId, { content: 'Llegó la grúa.' } as never);
    done();
    await B.docs.flush(res2.pageId);
    B.docs.close(res2.pageId);
    await B.engine.syncNow();
    expect(await undoTomorrow(depsOf(A), res2, built.ids.rodaje, input.prepare.linkTarget)).toEqual({ kind: 'changed' });
    expect(A.tree.isTrashed(res2.pageId)).toBe(false);

    // Sin red, Undo no deshace.
    server.online = false;
    expect(await undoTomorrow(depsOf(A), res2, built.ids.rodaje, input.prepare.linkTarget)).toEqual({ kind: 'offline' });
    server.online = true;
  });

  it('si mañana ya existía, Undo saca solo lo que agregó Prepare', async () => {
    const { A, built } = await world();
    const { input } = await sourceOf(A, built);
    const existing = await A.tree.create(built.ids.rodaje, '2026-03-16 | Día 77 | La Arenera', built.projectId);
    await writeBlocks(A, existing, [{ h: 1, text: 'Info general' }, { p: 'Llamado 7:00.' }]);
    const res = await createTomorrow(depsOf(A), input, canCreate);
    if (res.status !== 'ok') throw new Error(res.status);
    expect(res).toMatchObject({ created: false, pageId: existing });
    expect(await headingsOf(A, existing)).toEqual(['Info general', 'Escena 104_008', 'Escena 105_029']);
    expect(await undoTomorrow(depsOf(A), res, built.ids.rodaje, input.prepare.linkTarget)).toMatchObject({ kind: 'prepared', removed: 2 });
    expect(await headingsOf(A, existing)).toEqual(['Info general']);
    expect(A.tree.isTrashed(existing)).toBe(false);
  });
});

describe('la carrera de dos dispositivos (B2 de la auditoría de E11, D579, D580)', () => {
  /** Lo que deja A a mitad de camino: la fila subida, su contenido todavía no. */
  async function rowOnly(A: Device, built: Built): Promise<string> {
    const id = await A.tree.create(built.ids.rodaje, '2026-03-16 | Día 77', built.projectId, { templateId: BUILTIN_ONSET });
    await A.tree.setSetting(id, 'entity', { kind: 'day' });
    await A.engine.syncNow();
    return id;
  }
  const escenas = (heads: string[]) => heads.filter((h) => h.startsWith('Escena'));

  it('B toca mientras el reporte de A está llegando (la fila sí, el contenido no): no lo prepara ni crea otro', async () => {
    const { A, built, server } = await world();
    const B = await makeDevice(server);
    devices.push(B);
    await B.engine.syncNow();
    const fromB = await sourceOf(B, built);
    const id = await rowOnly(A, built);
    const res = await createTomorrow(depsOf(B), fromB.input, canCreate);
    expect(res).toEqual({ status: 'elsewhere', pageId: id, title: '2026-03-16 | Día 77' });
    expect(B.tree.children(built.ids.rodaje).filter((p) => p.title.startsWith('2026-03-16')).length).toBe(1);
    expect(await headingsOf(B, id)).toEqual([]);
    // El Prepare de siempre (la tarjeta Tomorrow de B ya ve el día): espera y, si no llega, no toca nada.
    const { prepareReport } = await import('./prepareDay');
    const busy = await prepareReport({ ...depsOf(B), arrivingWaitMs: 300 }, id, fromB.input.prepare);
    expect(busy).toEqual({ status: 'busy' });
    expect(await headingsOf(B, id)).toEqual([]);
  });

  it('B prepara mientras llega lo de A: espera el contenido (plantilla y secciones juntas) y no repite ninguna sección', async () => {
    const { A, built, server } = await world();
    const B = await makeDevice(server);
    devices.push(B);
    await B.engine.syncNow();
    const fromB = await sourceOf(B, built);
    const { input } = await sourceOf(A, built);
    const id = await rowOnly(A, built);
    await B.engine.syncNow();
    const { prepareReport, sectionBlocks } = await import('./prepareDay');
    const waiting = prepareReport({ ...depsOf(B), arrivingWaitMs: 8000 }, id, fromB.input.prepare);
    // A escribe lo suyo de una vez (como createTomorrow) y lo sube.
    const { writeNewPage } = await import('../templates/dayReportCreate');
    await writeNewPage(A.docs, id, [{ type: 'heading', props: { level: 2 }, content: 'Info general' }, ...input.prepare.scenes.flatMap((x) => sectionBlocks(x, 'Escena', 1))]);
    await A.engine.syncNow();
    const res = await waiting;
    expect(res).toMatchObject({ status: 'ok', added: [] });
    await B.engine.syncNow();
    await A.engine.syncNow();
    for (const d of [A, B]) expect(escenas(await headingsOf(d, id))).toEqual(['Escena 104_008', 'Escena 105_029']);
  });

  it('una página vacía de verdad (creada hace rato y dejada así) se prepara como siempre', async () => {
    const { A, built } = await world();
    const { input } = await sourceOf(A, built);
    const id = await rowOnly(A, built);
    const { prepareReport } = await import('./prepareDay');
    const row = A.tree.get(id)!;
    const tree = { get: () => ({ ...row, created_at: new Date(Date.now() - 10 * 60_000).toISOString() }), hasUnsentCreate: () => false };
    const res = await prepareReport({ docs: A.docs, engine: A.engine, tree, arrivingWaitMs: 300 }, id, input.prepare);
    expect(res).toMatchObject({ status: 'ok', added: [{ code: '104_008' }, { code: '105_029' }] });
  });

  it('A y B tocan a la vez: nunca secciones repetidas; si quedan dos reportes, se avisan y Map › Pending los lista', async () => {
    const { A, built, server } = await world();
    const B = await makeDevice(server);
    devices.push(B);
    await B.engine.syncNow();
    const fromA = await sourceOf(A, built);
    const fromB = await sourceOf(B, built);
    const [ra, rb] = await Promise.all([createTomorrow(depsOf(A), fromA.input, canCreate), createTomorrow(depsOf(B), fromB.input, canCreate)]);
    for (let k = 0; k < 3; k++) {
      await A.engine.syncNow();
      await B.engine.syncNow();
    }
    const live = A.tree.children(built.ids.rodaje).filter((p) => p.title.startsWith('2026-03-16') && !A.tree.isTrashed(p.id));
    // Siempre queda al menos uno (el de id menor nunca cede).
    expect(live.length).toBeGreaterThanOrEqual(1);
    for (const p of live) for (const d of [A, B]) expect(escenas(await headingsOf(d, p.id))).toEqual(['Escena 104_008', 'Escena 105_029']);
    if (live.length > 1) {
      expect([ra, rb].some((r) => r.status === 'ok' && r.twins.length > 0)).toBe(true);
      const { src } = await sourceOf(A, built);
      const { dayTwins } = await import('./projectMap');
      expect(dayTwins(src)).toEqual([{ code: '2026-03-16 | Día 77', pageIds: expect.arrayContaining(live.map((p) => p.id)), kind: 'day' }]);
    }
  });
});

describe('dos que crean el mismo día a la vez: cede el de id mayor, nunca los dos (D580)', () => {
  /** A crea; justo antes de que suba su fila, B sube la suya (con ese id) sin contenido todavía. */
  async function race(otherId: string) {
    const { A, built, server } = await world();
    const B = await makeDevice(server);
    devices.push(B);
    await B.engine.syncNow();
    const { input } = await sourceOf(A, built);
    let calls = 0;
    const engine = {
      ...A.engine,
      getStatus: () => A.engine.getStatus(),
      isMissingContent: (id: string) => A.engine.isMissingContent(id),
      prefetchPage: (id: string, ms?: number) => A.engine.prefetchPage(id, ms),
      syncNow: async () => {
        if (++calls === 2) {
          await B.tree.create(built.ids.rodaje, '2026-03-16 | Día 77', built.projectId, { id: otherId, templateId: BUILTIN_ONSET });
          await B.engine.syncNow();
        }
        return A.engine.syncNow();
      },
    };
    const res = await createTomorrow({ tree: A.tree, docs: A.docs, engine: engine as never }, input, canCreate);
    await A.engine.syncNow();
    const live = A.tree.children(built.ids.rodaje).filter((p) => p.title.startsWith('2026-03-16') && !A.tree.isTrashed(p.id));
    return { res, live, A };
  }

  it('el otro tiene id menor: este abandona su página vacía (a la papelera) y queda la del otro', async () => {
    const small = '00000000-0000-4000-8000-000000000001';
    const { res, live, A } = await race(small);
    expect(res).toMatchObject({ status: 'yielded', pageId: small });
    expect(live.map((p) => p.id)).toEqual([small]);
    if (res.status === 'yielded') {
      expect(A.tree.isTrashed(res.trashed)).toBe(true);
      expect(await headingsOf(A, res.trashed)).toEqual([]);
    }
  });

  it('el otro tiene id mayor: este sigue (quedan los dos, avisados); el otro, al ver este, cede', async () => {
    const big = 'ffffffff-ffff-4fff-bfff-ffffffffffff';
    const { res, live } = await race(big);
    expect(res).toMatchObject({ status: 'ok', created: true, twins: [big] });
    expect(live.length).toBe(2);
  });
});
