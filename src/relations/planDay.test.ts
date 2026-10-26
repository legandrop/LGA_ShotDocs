// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectIndex } from '../search/projectIndex';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { dayLive, planOf } from './dayLive';
import { buildProject, writeBlocks, type Built } from './fixtures/proyectoSintetico';
import { sceneLive, type LiveSource } from './liveView';
import { planLinks, readPlanTitle } from './planDay';
import { mapCounts, projectMap } from './projectMap';
import { RelationIndex } from './relationIndex';

// Plan → día (src/relations/planDay.ts; Docs/Plan_Estructura_Etapas.md, parte 3): un plan que vive en *Planeamiento* se
// conecta con su día por su puntero, su campo *Día* o la fecha y la jornada del título; si se contradicen, *Pending*.

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

async function setup(): Promise<{ d: Device; built: Built; src: () => Promise<LiveSource>; folder: string }> {
  const d = await makeDevice(new FakeServer());
  devices.push(d);
  const built = await buildProject(d, fakePhoto, { indexPage: false });
  const index = new ProjectIndex(d.tree, d.docs);
  const relations = new RelationIndex(d.tree, index);
  const src = async (): Promise<LiveSource> => {
    await index.refresh(built.projectId);
    await relations.update(built.projectId);
    const snap = relations.snapshot(built.projectId)!;
    return { snap, title: (id) => d.tree.get(id)?.title, content: (id) => index.content(id) };
  };
  const folder = await d.tree.create(null, '4 | Planeamiento', built.projectId);
  await d.tree.setPatch(folder, { settings: { holds: 'plan' } });
  return { d, built, src, folder };
}

describe('el título de un plan, como los escribe Lega', () => {
  it('fechas, jornada y unidad', () => {
    expect(readPlanTitle('D03_26.03.25_Palomar Dagmar | Mie')).toEqual({ dates: [[{ y: 2026, m: 3, d: 25 }]], jornada: 3, unit: null });
    expect(readPlanTitle('D03 25.11.03 | Ferro Escalada | Lunes')).toEqual({ dates: [[{ y: 2025, m: 11, d: 3 }]], jornada: 3, unit: null });
    expect(readPlanTitle('D21_U1_26.04.16_Arrabal')).toMatchObject({ jornada: 21, unit: '1' });
    // Día y mes, y también mes y día si existe (ERSO mezcla los dos): desempata la jornada.
    expect(readPlanTitle('D05 05.11 | Laureles').dates).toEqual([[{ y: null, m: 11, d: 5 }, { y: null, m: 5, d: 11 }]]);
    expect(readPlanTitle('D19 11.26 | Estudio').dates).toEqual([[{ y: null, m: 11, d: 26 }]]);
    expect(readPlanTitle('2026-03-25 | Plan | Palomar').dates).toEqual([[{ y: 2026, m: 3, d: 25 }]]);
    expect(readPlanTitle('D46_260520 | Colegio').dates).toEqual([[{ y: 2026, m: 5, d: 20 }]]);
    // Varias fechas: un plan de la locación.
    expect(readPlanTitle('Plaza de Mayo | 21 Mar | 2,3,4,11 Abr').dates.length).toBe(5);
    // Una fecha que no existe no cuenta; un número de escena tampoco.
    expect(readPlanTitle('D03 26.02.31').dates).toEqual([]);
    expect(readPlanTitle('Plan | 105_027 y 104_008').dates).toEqual([]);
    expect(readPlanTitle('Plan | Av Castanares')).toEqual({ dates: [], jornada: null, unit: null });
  });

  it('horas, palabras y decimales no son fechas', () => {
    const one = [[{ y: 2026, m: 3, d: 27 }]];
    expect(readPlanTitle('D05_26.03.27 | Llamado 9.30').dates).toEqual(one);
    expect(readPlanTitle('D05_26.03.27_Estudio 3 sets').dates).toEqual(one);
    expect(readPlanTitle('D05 25.11.05 | 2 decorados | Miércoles').dates).toEqual([[{ y: 2025, m: 11, d: 5 }]]);
    expect(readPlanTitle('D12_26.04.01 | Ruta 2 Mar del Plata').dates).toEqual([[{ y: 2026, m: 4, d: 1 }]]);
    expect(readPlanTitle('D05 | 2 sets').dates).toEqual([]);
    expect(readPlanTitle('Plan | Cámara v1.2').dates).toEqual([]);
    expect(readPlanTitle('Plan | Cámara 1.2').dates).toEqual([]);
    expect(readPlanTitle('D60 | Llamado 9.30').dates).toEqual([]);
    expect(readPlanTitle('D05 05.11 | Laureles').dates.length).toBe(1);
    expect(readPlanTitle('UBA FILO Ministerio | 27 Abr').dates).toEqual([[{ y: null, m: 4, d: 27 }]]);
    // Un año de dos cifras fuera de lo razonable no es una fecha.
    expect(readPlanTitle('D03 03.11.25').dates).toEqual([]);
    expect(readPlanTitle('D20 | Unidad 2 | Aeroparque')).toMatchObject({ jornada: 20, unit: '2' });
  });
});

describe('plan → día, casos de borde', () => {
  it('la jornada sin día no contradice a la fecha; la jornada con día y la fecha sin día, sí; DD.MM y MM.DD los desempata la jornada', async () => {
    const { d, built, src, folder } = await setup();
    // D00: la fecha es la del Día 60 y no hay «Día 00».
    const d00 = await d.tree.create(folder, 'D00_26.02.20_CENADE', built.projectId);
    // La jornada es la del Día 60 y la fecha completa no tiene día: contradicción.
    const off = await d.tree.create(folder, 'D60_26.02.27_CENADE', built.projectId);
    // Sin año, 20.02 o 02.20 (este no existe): Día 60.
    const ddmm = await d.tree.create(folder, 'D60 20.02 | CENADE', built.projectId);
    const s = await src();
    const L = planLinks(s);
    expect(L.get(d00)).toMatchObject({ dayId: built.ids.d60, why: 'match' });
    expect(L.get(off)).toMatchObject({ dayId: null, why: 'conflict', candidates: [built.ids.d60] });
    expect(L.get(ddmm)).toMatchObject({ dayId: built.ids.d60 });
  });

  it('una semana vacía con planes adentro es un grupo aunque su título tenga fecha', async () => {
    const { d, built, src, folder } = await setup();
    const week = await d.tree.create(folder, 'Semana 08 | 2026-02-20', built.projectId);
    await d.tree.move(built.ids.plan60, week);
    const s = await src();
    expect(planLinks(s).get(week)).toMatchObject({ why: 'group', dayId: null });
    expect(projectMap(s).plannedDates).toEqual([]);
    expect(dayLive(s, built.ids.d60).plan.pages.map((p) => p.title)).toEqual(['Plan | Día 60']);
  });

  it('un plan vacío con fecha y sin jornada, con sus fotos abajo, sigue siendo el plan de su día; el puntero gana al grupo', async () => {
    const { d, built, src, folder } = await setup();
    const p = await d.tree.create(folder, '26.02.20 | CENADE', built.projectId);
    const photos = await d.tree.create(p, 'Fotos', built.projectId);
    const week = await d.tree.create(folder, 'Semana 08 | 2026-02-20', built.projectId);
    const inner = await d.tree.create(week, 'D59 | CENADE', built.projectId);
    await d.tree.setSetting(week, 'entity', { kind: 'plan', day: built.ids.d60 });
    const L = planLinks(await src());
    expect(L.get(p)).toMatchObject({ dayId: built.ids.d60, why: 'match' });
    expect(L.get(photos)).toMatchObject({ dayId: built.ids.d60 });
    expect(L.get(week)).toMatchObject({ dayId: built.ids.d60, why: 'pointer' });
    expect(L.get(inner)?.why).not.toBe('group');
  });

  it('una hora sin fecha completa no contradice a la jornada', async () => {
    const { d, built, src, folder } = await setup();
    const p = await d.tree.create(folder, 'D60 | 7.30 a 19.30', built.projectId);
    expect(planLinks(await src()).get(p)).toMatchObject({ dayId: built.ids.d60 });
  });

  it('una subpágina de un plan sin día claro no repite el aviso; la de uno conectado es de su día aunque tenga una hora', async () => {
    const { d, built, src, folder } = await setup();
    const conflict = await d.tree.create(folder, 'D59 26.02.20 | CENADE', built.projectId);
    const photos = await d.tree.create(conflict, 'Fotos', built.projectId);
    const ok = await d.tree.create(folder, 'D60_26.02.20 | CENADE', built.projectId);
    const call = await d.tree.create(ok, 'Llamado 9.30', built.projectId);
    const s = await src();
    const L = planLinks(s);
    expect(L.get(photos)).toMatchObject({ dayId: null, why: 'none' });
    expect(projectMap(s).plans.map((p) => p.pageId)).toEqual([conflict]);
    expect(L.get(call)).toMatchObject({ dayId: built.ids.d60 });
  });

  it('un plan de la unidad 2 no se pega a un día de la principal', async () => {
    const { d, built, src, folder } = await setup();
    const u2 = await d.tree.create(folder, 'D60_U2_26.02.20 | CENADE', built.projectId);
    const s = await src();
    expect(planLinks(s).get(u2)).toMatchObject({ dayId: null, why: 'noDay', date: '2026-02-20' });
  });
});

describe('plan → día', () => {
  it('sacado del día a Planeamiento, sigue siendo el plan de su día (por la jornada del título); con fecha y jornada también', async () => {
    const { d, built, src, folder } = await setup();
    await d.tree.move(built.ids.plan60, folder);
    let s = await src();
    expect(planLinks(s).get(built.ids.plan60)).toMatchObject({ dayId: built.ids.d60, why: 'match' });
    const d60 = dayLive(s, built.ids.d60);
    expect(d60.plan.source).toBe('plan');
    expect(d60.plan.codes).toEqual(['104_008', '104_009', '105_029', '105_027']);
    expect(d60.plan.pages.map((p) => p.title)).toEqual(['Plan | Día 60']);
    // La escena lo ve planeado para el Día 60, no en «Also named in».
    const v = sceneLive(s, '104_008');
    expect(v.plannedDays.map((p) => p.day.label)).toContain('Día 60');
    expect(v.also.map((a) => a.title)).not.toContain('Plan | Día 60');
    await d.tree.rename(built.ids.plan60, 'D60_26.02.20 | CENADE');
    s = await src();
    expect(planLinks(s).get(built.ids.plan60)).toMatchObject({ dayId: built.ids.d60, why: 'match' });
  });

  it('el puntero de la página gana; un plan sin fecha ni jornada y sin puntero no es de ningún día ni un aviso', async () => {
    const { d, built, src, folder } = await setup();
    await d.tree.move(built.ids.plan60, folder);
    await d.tree.rename(built.ids.plan60, 'Plan | Av Castanares');
    let s = await src();
    expect(planLinks(s).get(built.ids.plan60)).toMatchObject({ dayId: null, why: 'none' });
    expect(projectMap(s).plans).toEqual([]);
    await d.tree.setSetting(built.ids.plan60, 'entity', { kind: 'plan', day: built.ids.d60 });
    s = await src();
    expect(planLinks(s).get(built.ids.plan60)).toMatchObject({ dayId: built.ids.d60, why: 'pointer' });
    expect(dayLive(s, built.ids.d60).plan.codes).toEqual(['104_008', '104_009', '105_029', '105_027']);
    expect(projectMap(s).plans).toEqual([]);
  });

  it('fecha y jornada que se contradicen: Pending con los dos días; una fecha sin día: planeada; varias fechas: de la locación', async () => {
    const { d, built, src, folder } = await setup();
    const conflict = await d.tree.create(folder, 'D59 26.02.20 | CENADE', built.projectId);
    const future = await d.tree.create(folder, 'D90_26.04.01 | La Arenera', built.projectId);
    await writeBlocks(d, future, [{ p: 'Plates del 104_009.' }]);
    const several = await d.tree.create(folder, 'CENADE | 21 Mar | 2,3 Abr', built.projectId);
    const s = await src();
    const links = planLinks(s);
    expect(links.get(conflict)).toMatchObject({ dayId: null, why: 'conflict' });
    expect(new Set(links.get(conflict)!.candidates)).toEqual(new Set([built.ids.d59, built.ids.d60]));
    expect(links.get(future)).toMatchObject({ dayId: null, why: 'noDay', date: '2026-04-01' });
    expect(links.get(several)).toMatchObject({ why: 'several' });
    const m = projectMap(s);
    expect(m.plans.map((p) => [p.pageId, p.why])).toEqual([[conflict, 'conflict']]);
    expect(m.plannedDates).toEqual([{ date: '2026-04-01', plans: [future], scenes: ['104_009'] }]);
    expect(mapCounts(m).plans).toBe(1);
    // Sin página de día (*Tomorrow* de una fecha nueva): el plan de esa fecha.
    expect(planOf(s, { pageId: '', label: '', date: '2026-04-01', loc: null, locs: [] }).codes).toEqual(['104_009']);
  });

  it('una semana sin fecha con planes adentro es un grupo; una subpágina de un plan es de su día', async () => {
    const { d, built, src, folder } = await setup();
    const week = await d.tree.create(folder, 'Semana 08', built.projectId);
    await d.tree.move(built.ids.plan60, week);
    const photos = await d.tree.create(built.ids.plan60, 'Fotos', built.projectId);
    const s = await src();
    const links = planLinks(s);
    expect(links.get(week)).toMatchObject({ why: 'group' });
    expect(links.get(built.ids.plan60)).toMatchObject({ dayId: built.ids.d60 });
    expect(links.get(photos)).toMatchObject({ dayId: built.ids.d60 });
    expect(projectMap(s).plans).toEqual([]);
  });

  it('un plan marcado que sigue adentro de su día es de ese día, como antes', async () => {
    const { d, built, src } = await setup();
    await d.tree.setSetting(built.ids.plan60, 'entity', { kind: 'plan' });
    const s = await src();
    expect(s.snap.registration.roles.get(built.ids.plan60)).toMatchObject({ doc: 'plan', partOf: { kind: 'day', pageId: built.ids.d60 } });
    expect(dayLive(s, built.ids.d60).plan.codes).toEqual(['104_008', '104_009', '105_029', '105_027']);
  });
});
