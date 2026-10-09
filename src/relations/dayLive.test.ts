// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectIndex } from '../search/projectIndex';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { dayLive, dayList, dayShortLabel, headingStyleFor, linkTargetOf, planOf, sceneTitleOf } from './dayLive';
import { buildProject, writeBlocks, type Built } from './fixtures/proyectoSintetico';
import type { LiveSource } from './liveView';
import { prepareReport, undoPrepared } from './prepareDay';
import { RelationIndex } from './relationIndex';

// La cabecera del día y la tarjeta *Tomorrow* (Docs/Doc_Relaciones.md, sección 11), con el índice de verdad sobre el
// proyecto sintético: las escenas del día salen de los títulos del reporte, el plan de la página *Plan* o del desglose,
// y *Prepare* escribe en el reporte de mañana solo lo que falta.

const devices: Device[] = [];
afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.docs.dispose();
    d.db.close();
  }
});

let n = 0;
const fakePhoto = async () => `0000${String(++n).padStart(4, '0')}-aaaa-4bbb-8ccc-dddddddddddd`;

interface World {
  d: Device;
  built: Built;
  src: () => Promise<LiveSource>;
}

async function setup(options: { days?: boolean } = {}): Promise<World> {
  const d = await makeDevice(new FakeServer());
  devices.push(d);
  const built = await buildProject(d, fakePhoto, { indexPage: false, ...options });
  const index = new ProjectIndex(d.tree, d.docs);
  const relations = new RelationIndex(d.tree, index);
  const src = async (): Promise<LiveSource> => {
    await index.refresh(built.projectId);
    await relations.update(built.projectId);
    const snap = relations.snapshot(built.projectId)!;
    return { snap, title: (id) => d.tree.get(id)?.title, content: (id) => index.content(id) };
  };
  return { d, built, src };
}

const rowsOf = (v: ReturnType<typeof dayLive>) =>
  v.rows.map((r) => (r.kind === 'scene' ? `${r.code}${r.part}:${r.status}:${r.photos}` : r.kind === 'planned' ? `${r.code}:planned` : r.kind === 'pending' ? `${r.code}:pending` : `«${r.heading}»:${r.photos}`));

describe('la cabecera del día', () => {
  it('Día 59: las escenas con sección, la de arriba sin número, las planeadas por el desglose, preguntas y Tomorrow', async () => {
    const { built, src } = await setup({ days: true });
    const s = await src();
    expect(s.snap.complete).toBe(true);
    const v = dayLive(s, built.ids.d59);
    expect([v.day.label, v.day.date, v.day.locs]).toEqual(['Día 59', '2026-02-19', ['CENADE']]);
    expect([v.prev?.label, v.next?.label]).toEqual(['Día 58', 'Día 60']);
    // El plan del Día 59 sale del desglose (fichas con Fecha Rodaje 19/02): 105_025 y la ficha 030 de 105_027.
    expect(v.plan).toMatchObject({ source: 'breakdown', codes: ['105_025', '105_027'], label: 'Fecha Rodaje' });
    // «Info general» no tiene fotos ni número: no es una fila. «Plates ambulancia» sí (fotos sin número).
    expect(rowsOf(v)).toEqual(['105_027B:shot:5', '«Plates ambulancia»:2', '105_025:planned']);
    const r0 = v.rows[0];
    expect(r0.kind === 'scene' && r0.sceneTitle).toBe('La ambulancia empieza a zigzaguear');
    // Las preguntas abiertas de sus escenas (las dos fichas de 105_027 comparten la primera).
    expect(v.questions.map((q) => [q.codes, q.text])).toEqual([
      [['105_027'], '¿Todo el interior de la ambulancia se filma en estudio o solo el vuelco?'],
      [['105_027'], '¿la sangre del chofer es práctica o se agrega?'],
    ]);
    expect(v.scenes).toBe(2);
    // Las fotos: las de cada sección, con su origen (sin «Escena»).
    expect(v.photos.map((p) => p.source)).toEqual(['105_027b', '105_027b', '105_027b', '105_027b', '105_027b', 'Plates ambulancia', 'Plates ambulancia']);
    // Mañana: el Día 60 por el desglose (20/02), con 105_029 que ya tiene «Escena 105_029a».
    expect(v.tomorrow?.day.label).toBe('Día 60');
    expect(v.tomorrow?.plan.source).toBe('breakdown');
    expect(v.tomorrow?.scenes.map((x) => [x.code, x.has])).toEqual([
      ['104_008', false],
      ['104_009', false],
      ['105_029', true],
    ]);
  });

  it('el plan de la página Plan del día manda, en el orden en que la nombra', async () => {
    const { built, src } = await setup();
    const s = await src();
    const d60 = dayLive(s, built.ids.d60);
    expect(d60.plan.source).toBe('plan');
    expect(d60.plan.codes).toEqual(['104_008', '104_009', '105_029', '105_027']);
    expect(d60.plan.pages.map((p) => p.title)).toEqual(['Plan | Día 60']);
    expect(rowsOf(d60)).toEqual(['105_029A:shot:2', '104_008:planned', '104_009:planned', '105_027:planned']);
    // Día 59 ve la misma lista como mañana.
    expect(dayLive(s, built.ids.d59).tomorrow?.plan.codes).toEqual(['104_008', '104_009', '105_029', '105_027']);
    // Día 70: el plan sale de las fichas de 105_027 (06/03); 105_029 tiene sección y el plan no la nombra.
    const d70 = dayLive(s, built.ids.d70);
    expect(planOf(s, d70.day)).toMatchObject({ source: 'breakdown', codes: ['105_027'] });
    expect(rowsOf(d70)).toEqual(['105_027A:shot:4', '105_029B:notInPlan:4']);
  });

  it('una sección vacía figura «prepared», no «shot»; dos vacías de la misma escena son una fila', async () => {
    const { d, built, src } = await setup({ days: true });
    await writeBlocks(d, built.ids.d60, [
      { h: 1, text: 'Escena 105_029a' },
      { p: 'Primer plano del fugitivo.' },
      { h: 1, text: 'Escena 104_008' },
      { p: '' },
      { h: 1, text: 'Escena 104_008' },
      { p: '' },
      { h: 1, text: 'Escena 104_009' },
      { p: 'Se hizo con grúa.' },
    ]);
    const s = await src();
    const v = dayLive(s, built.ids.d60);
    expect(rowsOf(v)).toEqual(['105_029A:shot:0', '104_008:prepared:0', '104_009:shot:0']);
    // Títulos escritos a mano (sin link): no son el par que deja Prepare en dos dispositivos, la tarjeta no avisa (B4).
    expect(dayLive(s, built.ids.d59).tomorrow?.repeated).toEqual([]);
  });

  it('una copia de ficha pegada adentro de otro día no suma su fecha al plan de ese día (O5 de la auditoría de E3b)', async () => {
    const { d, built, src } = await setup({ days: true });
    const copy = await d.tree.create(built.ids.d70, 'Plan | Día 70', built.projectId);
    await writeBlocks(d, copy, [{ table: [['Shot Name', 'PRUEBA_105_025_010'], ['Fecha Rodaje', '20/02/2026']] }]);
    const s = await src();
    expect(dayLive(s, built.ids.d60).plan.codes).toEqual(['104_008', '104_009', '105_029']);
    expect(dayLive(s, built.ids.d70).plan).toMatchObject({ source: 'plan', codes: ['105_025'] });
  });

  it('B1: la sección general del día («Info general», o la primera sin número) no es una fila; sus fotos van primero', async () => {
    const { d, built, src } = await setup({ days: true });
    const photo = await fakePhoto();
    await writeBlocks(d, built.ids.d60, [
      { h: 1, text: 'Info general:' },
      { p: 'Llamado 7:00.' },
      { photo },
      { h: 1, text: 'Escena 105_029a' },
      { p: 'Primer plano.' },
      { h: 1, text: 'Plates de ruta' },
      { photo: await fakePhoto() },
    ]);
    const s = await src();
    const v = dayLive(s, built.ids.d60);
    expect(rowsOf(v)).toEqual(['105_029A:shot:0', '«Plates de ruta»:1', '104_008:planned', '104_009:planned']);
    expect(v.photos[0]).toMatchObject({ id: photo, source: 'Día 60' });
    // Sin «Info general»: la primera sección sin número de arriba también es la general.
    await writeBlocks(d, built.ids.d60, [{ h: 1, text: 'Llamado' }, { photo: await fakePhoto() }, { h: 1, text: 'Escena 105_029a' }, { p: 'Primer plano.' }]);
    expect(rowsOf(dayLive(await src(), built.ids.d60))).toEqual(['105_029A:shot:0', '104_008:planned', '104_009:planned']);
  });

  it('O3: el título de la escena sin el número de adelante ni el código entero al final', () => {
    expect(sceneTitleOf('027 | El vehículo comienza a zigzaguear | 105_027')).toBe('El vehículo comienza a zigzaguear');
    expect(sceneTitleOf('074 | Voces | 101-074')).toBe('Voces');
    expect(sceneTitleOf('La escena sin número')).toBe('La escena sin número');
  });

  it('B4: el aviso de repetidos solo con dos títulos de Prepare de la misma escena, no ante una sección escrita a mano', async () => {
    const { d, built, src } = await setup({ days: true });
    const link = (code: string) => [{ link: built.ids[`s${code.slice(4)}`], text: code }];
    // A mano: «Escena 105_029a» escrita + «Escena [105_029]» con link y vacía. No son el par de dos dispositivos.
    await writeBlocks(d, built.ids.d60, [
      { h: 1, text: 'Escena 105_029a' },
      { p: 'Primer plano.' },
      { hl: 1, runs: ['Escena ', ...link('105_029')] },
      { p: '' },
    ]);
    let s = await src();
    expect(dayLive(s, built.ids.d59).tomorrow?.repeated).toEqual([]);
    // El par de verdad: dos títulos «Escena [104_008]» vacíos.
    await writeBlocks(d, built.ids.d60, [
      { h: 1, text: 'Escena 105_029a' },
      { p: 'Primer plano.' },
      { hl: 1, runs: ['Escena ', ...link('104_008')] },
      { p: '' },
      { hl: 1, runs: ['Escena ', ...link('104_008')] },
      { p: '' },
    ]);
    s = await src();
    expect(dayLive(s, built.ids.d59).tomorrow?.repeated).toEqual(['104_008']);
  });

  it('el título de sección que usa el proyecto: la palabra y el nivel del día más cercano', async () => {
    const { built, src } = await setup({ days: true });
    const s = await src();
    expect(headingStyleFor(s, built.ids.d59, 'en')).toEqual({ word: 'Escena', level: 1 });
    expect(dayList(s).map((x) => dayShortLabel(x))).toEqual(['Día 58', 'Día 59', 'Día 60', 'Día 70', '10/03', 'Día 76']);
  });
});

describe('Prepare tomorrow’s report sobre el reporte de verdad', () => {
  it('agrega al final del Día 60 solo lo que falta; la cabecera lo ve «prepared»; de nuevo no duplica; Undo lo saca', async () => {
    const { d, built, src } = await setup({ days: true });
    let s = await src();
    const t = dayLive(s, built.ids.d59).tomorrow!;
    const scenes = t.scenes.map((x) => ({ code: x.code, pageId: x.scenePageId! }));
    const linkTarget = linkTargetOf(s);
    const style = headingStyleFor(s, built.ids.d59, 'en');
    const deps = { docs: d.docs, engine: d.engine };
    const opts = { scenes, registry: s.snap.registry, linkTarget, ...style };
    const res = await prepareReport(deps, built.ids.d60, opts);
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.added.map((a) => a.code)).toEqual(['104_008', '104_009']);
    expect(res.skipped).toEqual(['105_029']);
    s = await src();
    expect(rowsOf(dayLive(s, built.ids.d60))).toEqual(['105_029A:shot:2', '104_008:prepared:0', '104_009:prepared:0']);
    expect(dayLive(s, built.ids.d59).tomorrow?.scenes.every((x) => x.has)).toBe(true);
    // La escena «se entera»: 104_008 tiene una sección (vacía) en el Día 60.
    const again = await prepareReport(deps, built.ids.d60, opts);
    expect(again.status === 'ok' && again.added).toEqual([]);
    const undo = await undoPrepared(deps, built.ids.d60, res, linkTarget);
    // Sin sincronizar: lo agregado no salió del dispositivo, así que se va entero (título y renglón).
    expect(undo).toEqual({ removed: 2, kept: 0, titleOnly: false });
    s = await src();
    expect(rowsOf(dayLive(s, built.ids.d60))).toEqual(['105_029A:shot:2', '104_008:planned', '104_009:planned']);
  });

  it('O1: si lo preparado ya subió (otro pudo recibirlo), Undo saca solo los títulos y deja los renglones', async () => {
    const { d, built, src } = await setup({ days: true });
    const s = await src();
    const t = dayLive(s, built.ids.d59).tomorrow!;
    const linkTarget = linkTargetOf(s);
    const deps = { docs: d.docs, engine: d.engine };
    const res = await prepareReport(deps, built.ids.d60, { scenes: t.scenes.map((x) => ({ code: x.code, pageId: x.scenePageId! })), registry: s.snap.registry, linkTarget, word: 'Escena', level: 1 });
    if (res.status !== 'ok') throw new Error(res.status);
    await d.engine.syncNow();
    const undo = await undoPrepared(deps, built.ids.d60, res, linkTarget);
    expect(undo).toEqual({ removed: 2, kept: 0, titleOnly: true });
    const v = dayLive(await src(), built.ids.d60);
    expect(rowsOf(v)).toEqual(['105_029A:shot:2', '104_008:planned', '104_009:planned']);
  });

  it('un reporte que no terminó de bajar no se toca', async () => {
    const { d, built, src } = await setup({ days: true });
    const s = await src();
    const deps = { docs: d.docs, engine: { isMissingContent: async () => true, prefetchPage: async () => false } };
    const res = await prepareReport(deps, built.ids.d60, { scenes: [], registry: s.snap.registry, linkTarget: linkTargetOf(s), word: 'Escena', level: 1 });
    expect(res.status).toBe('missing');
  });
});

describe('E16-0: una escena en dos páginas (D651)', () => {
  it('el título de una sección con link a la segunda página de la escena cuenta para la escena en el día', async () => {
    const { d, built, src } = await setup({ days: true });
    // La segunda página de 105_029 (la carrera de *Create*), linkeada desde un título del Día 70.
    const second = await d.tree.create(built.ids.ep5, '029 | El fugitivo (otra)', built.projectId);
    await writeBlocks(d, built.ids.d70, [
      { hl: 1, runs: ['Escena ', { link: second, text: '105_029' }] },
      { p: 'Lo de la segunda página.' },
    ]);
    const s = await src();
    expect(s.snap.registration.duplicates.map((x) => x.code)).toEqual(['105_029']);
    expect(linkTargetOf(s)(second)).toEqual({ kind: 'scene', ref: '105_029' });
    // La sección es de 105_029 (filmada aunque no estaba en el plan del día); sin el arreglo, el título no nombraba nada.
    expect(rowsOf(dayLive(s, built.ids.d70))).toEqual(['105_029:notInPlan:0', '105_027:planned']);
  });
});
