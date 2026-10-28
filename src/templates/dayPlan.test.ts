// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { syncEntityMark } from '../relations/entitySync';
import { isDayPlanRow, pageKind } from '../relations/kind';
import { reportsOnDate } from '../relations/tomorrowNew';
import { BUILTIN_PLAN } from './builtinIds';
import { dayReportFolderOf, hasReportTitle, newDayTitle, planTitle, planTitleFor } from './dayReport';
import {
  createDayPlan,
  createDayReport,
  dayPlanTitle,
  markReportFolder,
  planDayReport,
  placeBefore,
  planProposal,
  plannedLocation,
  titlePlace,
  plansOn,
  reportsOn,
  suggestedDay,
  suggestedPlanDate,
  suggestedPlanDay,
} from './dayReportCreate';
import { suggestedTemplateName } from './ownCopy';
import { stripKinds } from './stripKinds';

// El plan de jornada al lado de su reporte (D813, `Docs/Plan_Fichas_Cuaderno.md`, parte 2): *New day report* y
// *Tomorrow* no lo toman por un reporte (ni lo de ayer, ni el número de día, ni «ya existe», ni *Prepare*), *New day
// plan* lo crea justo arriba del reporte de su fecha con el mismo nombre y « | Plan», y un plan escrito a mano en una
// carpeta de días recibe la marca de plan y nunca la de día.

const devices: Device[] = [];
afterEach(async () => {
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.db.close();
  }
});

async function device(): Promise<Device> {
  const d = await makeDevice(new FakeServer());
  devices.push(d);
  return d;
}

const deps = (d: Device) => ({ tree: d.tree, docs: d.docs, engine: d.engine });
const at = (day: number) => new Date(2026, 9, day, 9, 0);

/** Una carpeta de reportes con un reporte por día (1 de octubre en adelante), como los deja *New day report*. */
async function weekWith(d: Device, days: number[]): Promise<string> {
  const folder = await d.tree.create(null, 'Semana 01');
  await markReportFolder(d.tree, folder);
  for (const day of days) {
    const plan = await planDayReport(deps(d), { parentId: folder, projectId: d.tree.workspaceId }, { now: at(day) });
    await createDayReport(deps(d), plan, plan.suggestion, 'en', { canMark: true });
  }
  return folder;
}

const titles = (d: Device, folder: string) => d.tree.children(folder).map((p) => p.title);

describe('el título de un plan', () => {
  it('una parte entera «Plan» o «Plan · …»; nunca una palabra que solo empieza igual', () => {
    expect(planTitle('2026-05-12 | Día 40 | 7 Puentes | Plan')).toBe(true);
    expect(planTitle('2026-05-12 | Día 40 | Plan · Casa Rosada')).toBe(true);
    expect(planTitle('2026-05-12 | Día 40 | plan')).toBe(true);
    expect(planTitle('2026-05-12 | Día 40 | Planta Bernal')).toBe(false);
    expect(planTitle('2026-05-12 | Día 40 | Plano 3')).toBe(false);
    expect(planTitle('2026-05-12 | Día 40')).toBe(false);
    expect(planTitle('')).toBe(false);
    expect(planTitleFor('2026-05-12 | Día 40 ')).toBe('2026-05-12 | Día 40 | Plan');
  });
});

describe('New day plan', () => {
  it('sin reporte de esa fecha: el título que tendría el reporte, al final, con la marca de plan y sin puntero', async () => {
    const d = await device();
    const folder = await weekWith(d, [1, 2]);
    const plan = await planDayReport(deps(d), { parentId: folder, projectId: d.tree.workspaceId }, { now: at(2) });
    expect(suggestedPlanDate(plan, '2026-10-02')).toBe('2026-10-03');
    expect(suggestedPlanDay(plan, '2026-10-03')).toBe(3);
    const id = await createDayPlan(deps(d), plan, { date: '2026-10-03', day: 3, location: 'Casa  Rosada' }, 'en');
    const row = d.tree.get(id)!;
    // La locación va también al nombre, con los espacios limpios (simulación de D813): de ahí lee el Overview el lugar.
    expect(row.title).toBe('2026-10-03 | Day 03 | Casa Rosada | Plan');
    expect(row.template_id).toBe(BUILTIN_PLAN);
    expect(row.settings?.entity).toEqual({ kind: 'plan' });
    expect(titles(d, folder)).toEqual(['2026-10-01 | Day 01', '2026-10-02 | Day 02', '2026-10-03 | Day 03 | Casa Rosada | Plan']);
    expect(pageKind(d.tree, id)).toMatchObject({ kind: 'doc', doc: 'plan' });
  });

  it('con el reporte de esa fecha: su mismo nombre con « | Plan», justo arriba de él y con el puntero', async () => {
    const d = await device();
    const folder = await weekWith(d, [1, 2, 3]);
    const plan = await planDayReport(deps(d), { parentId: folder, projectId: d.tree.workspaceId }, { now: at(3) });
    const report = reportsOn(plan, '2026-10-02')[0];
    expect(dayPlanTitle(plan, { date: '2026-10-02', day: 2, location: 'otra' }, 'en')).toBe('2026-10-02 | Day 02 | Plan');
    const id = await createDayPlan(deps(d), plan, { date: '2026-10-02', day: 2, location: '' }, 'en');
    expect(d.tree.get(id)?.settings?.entity).toEqual({ kind: 'plan', day: report.id });
    expect(titles(d, folder)).toEqual(['2026-10-01 | Day 01', '2026-10-02 | Day 02 | Plan', '2026-10-02 | Day 02', '2026-10-03 | Day 03']);
  });

  it('el título que se le pase (el de *Plan tomorrow*, con la forma de los días de la carpeta)', async () => {
    const d = await device();
    const folder = await weekWith(d, [1]);
    const plan = await planDayReport(deps(d), { parentId: folder, projectId: d.tree.workspaceId }, { now: at(1) });
    const id = await createDayPlan(deps(d), plan, { date: '2026-10-02', day: 2, location: '' }, 'en', { title: 'D02 | 2026-10-02 | Plan' });
    expect(d.tree.get(id)?.title).toBe('D02 | 2026-10-02 | Plan');
  });
});

describe('lo que pidió la auditoría de la parte 2', () => {
  it('dos planes por adelantado: Día 03 y Día 04 (el número mira los planes ya hechos)', async () => {
    const d = await device();
    const folder = await weekWith(d, [1, 2]);
    let plan = await planDayReport(deps(d), { parentId: folder, projectId: d.tree.workspaceId }, { now: at(2) });
    await createDayPlan(deps(d), plan, { date: '2026-10-03', day: suggestedPlanDay(plan, '2026-10-03'), location: '' }, 'en');
    plan = await planDayReport(deps(d), { parentId: folder, projectId: d.tree.workspaceId }, { now: at(2) });
    // Hoy (2/10) ya tiene reporte y mañana ya tiene plan: propone pasado mañana, Día 04.
    expect(suggestedPlanDate(plan, '2026-10-02')).toBe('2026-10-04');
    expect(suggestedPlanDay(plan, '2026-10-04')).toBe(4);
    expect(suggestedPlanDay(plan, '2026-10-03')).toBe(3);
  });

  it('*Create another*: el segundo plan de la misma fecha no repite el nombre', async () => {
    const d = await device();
    const folder = await weekWith(d, [1]);
    let plan = await planDayReport(deps(d), { parentId: folder, projectId: d.tree.workspaceId }, { now: at(1) });
    await createDayPlan(deps(d), plan, { date: '2026-10-02', day: 2, location: '' }, 'en');
    plan = await planDayReport(deps(d), { parentId: folder, projectId: d.tree.workspaceId }, { now: at(1) });
    await createDayPlan(deps(d), plan, { date: '2026-10-02', day: 2, location: '' }, 'en');
    plan = await planDayReport(deps(d), { parentId: folder, projectId: d.tree.workspaceId }, { now: at(1) });
    await createDayPlan(deps(d), plan, { date: '2026-10-02', day: 2, location: '' }, 'en');
    expect(titles(d, folder).slice(1)).toEqual(['2026-10-02 | Day 02 | Plan', '2026-10-02 | Day 02 | Plan · 2', '2026-10-02 | Day 02 | Plan · 3']);
  });

  it('el reintento después de un error de escritura usa la página que quedó, no crea otra', async () => {
    const d = await device();
    const folder = await weekWith(d, [1]);
    const plan = await planDayReport(deps(d), { parentId: folder, projectId: d.tree.workspaceId }, { now: at(1) });
    const left = await d.tree.create(folder, '2026-10-02 | Day 02 | Plan');
    const id = await createDayPlan(deps(d), plan, { date: '2026-10-02', day: 2, location: '' }, 'en', { reuse: left });
    expect(id).toBe(left);
    expect(d.tree.children(folder)).toHaveLength(2);
    expect(d.tree.get(left)?.settings?.entity).toEqual({ kind: 'plan' });
  });

  it('el reintento con otra fecha cambia el título de la página que quedó, como el del reporte (O4)', async () => {
    const d = await device();
    const folder = await weekWith(d, [1]);
    const plan = await planDayReport(deps(d), { parentId: folder, projectId: d.tree.workspaceId }, { now: at(1) });
    const left = await d.tree.create(folder, '2026-10-02 | Day 02 | Plan');
    const id = await createDayPlan(deps(d), plan, { date: '2026-10-05', day: 3, location: '' }, 'en', { reuse: left });
    expect(id).toBe(left);
    expect(d.tree.get(left)?.title).toBe('2026-10-05 | Day 03 | Plan');
  });

  it('una página de otra carpeta no se reusa: se crea el plan donde va', async () => {
    const d = await device();
    const folder = await weekWith(d, [1]);
    const other = await d.tree.create(null, 'Otra');
    const plan = await planDayReport(deps(d), { parentId: folder, projectId: d.tree.workspaceId }, { now: at(1) });
    const id = await createDayPlan(deps(d), plan, { date: '2026-10-02', day: 2, location: '' }, 'en', { reuse: other });
    expect(id).not.toBe(other);
    expect(d.tree.get(id)?.parent_id).toBe(folder);
    expect(d.tree.get(other)?.title).toBe('Otra');
  });

  it('una página que se llama solo «Plan» en una carpeta de días no es un plan (sin fecha ni jornada)', async () => {
    const d = await device();
    const shoot = await d.tree.create(null, 'Rodaje');
    await d.tree.setSetting(shoot, 'holds', 'day');
    const group = await d.tree.create(shoot, 'Plan · Semana 3');
    const inside = await d.tree.create(group, '2026-10-02 | Día 02');
    expect(isDayPlanRow(d.tree.get(group))).toBe(false);
    expect(pageKind(d.tree, group).kind).not.toBe('doc');
    expect(pageKind(d.tree, inside)).toMatchObject({ kind: 'day' });
  });

  it('*Save as template…* de un plan propone *Day plan*, no *On-Set Report*', async () => {
    const d = await device();
    const folder = await weekWith(d, [1]);
    const plan = await planDayReport(deps(d), { parentId: folder, projectId: d.tree.workspaceId }, { now: at(1) });
    const id = await createDayPlan(deps(d), plan, { date: '2026-10-02', day: 2, location: '' }, 'en');
    expect(suggestedTemplateName(d.tree.get(id), 'en')).toBe('Day plan');
    expect(suggestedTemplateName(d.tree.get(d.tree.children(folder)[0].id), 'en')).toBe('On-Set Report');
  });
});

describe('New day report y Tomorrow saltean los planes', () => {
  it('el plan de mañana no es «lo de ayer», no suma un día y no dice «ya existe»; el reporte va justo abajo de su plan', async () => {
    const d = await device();
    const folder = await weekWith(d, [1, 2]);
    let plan = await planDayReport(deps(d), { parentId: folder, projectId: d.tree.workspaceId }, { now: at(2) });
    await createDayPlan(deps(d), plan, { date: '2026-10-03', day: 3, location: '' }, 'en');

    plan = await planDayReport(deps(d), { parentId: folder, projectId: d.tree.workspaceId }, { now: at(3) });
    expect(plan.reports.map((r) => r.title)).toEqual(['2026-10-01 | Day 01', '2026-10-02 | Day 02']);
    expect(plan.last?.title).toBe('2026-10-02 | Day 02');
    expect(plan.suggestion.day).toBe(3);
    expect(suggestedDay(plan, '2026-10-03')).toBe(3);
    expect(reportsOn(plan, '2026-10-03')).toEqual([]);
    expect(plansOn(plan, '2026-10-03').map((p) => p.title)).toEqual(['2026-10-03 | Day 03 | Plan']);
    // La propuesta del plan ya no es hoy: hoy tiene plan.
    expect(suggestedPlanDate(plan, '2026-10-03')).toBe('2026-10-04');

    await createDayReport(deps(d), plan, plan.suggestion, 'en', { canMark: true });
    expect(titles(d, folder)).toEqual(['2026-10-01 | Day 01', '2026-10-02 | Day 02', '2026-10-03 | Day 03 | Plan', '2026-10-03 | Day 03']);
    expect(reportsOnDate(d.tree, folder, d.tree.workspaceId, '2026-10-03')).toEqual([d.tree.children(folder)[3].id]);
  });

  it('un reporte de una fecha anterior va antes del primer plan o reporte de una fecha mayor', async () => {
    const d = await device();
    const folder = await weekWith(d, [1]);
    let plan = await planDayReport(deps(d), { parentId: folder, projectId: d.tree.workspaceId }, { now: at(1) });
    await createDayPlan(deps(d), plan, { date: '2026-10-05', day: 3, location: '' }, 'en');
    plan = await planDayReport(deps(d), { parentId: folder, projectId: d.tree.workspaceId }, { now: at(3) });
    const planId = plansOn(plan, '2026-10-05')[0].id;
    expect(placeBefore(plan, '2026-10-03')).toBe(planId);
    expect(placeBefore(plan, '2026-10-06')).toBeUndefined();
    await createDayReport(deps(d), plan, { date: '2026-10-03', day: 2, location: '' }, 'en', { canMark: true });
    expect(titles(d, folder)).toEqual(['2026-10-01 | Day 01', '2026-10-03 | Day 02', '2026-10-05 | Day 03 | Plan']);
  });

  it('un plan con su marca y un título sin « | Plan» (los del reacomodo) tampoco es un reporte', async () => {
    const d = await device();
    const folder = await weekWith(d, [1]);
    const id = await d.tree.create(folder, '2026-10-02 | Día 02 | 7 Puentes');
    await d.tree.setSetting(id, 'entity', { kind: 'plan' });
    expect(isDayPlanRow(d.tree.get(id))).toBe(true);
    const plan = await planDayReport(deps(d), { parentId: folder, projectId: d.tree.workspaceId }, { now: at(2) });
    expect(plan.reports.map((r) => r.title)).toEqual(['2026-10-01 | Day 01']);
    expect(reportsOnDate(d.tree, folder, d.tree.workspaceId, '2026-10-02')).toEqual([]);
  });
});

describe('el plan escrito a mano en una carpeta de días (la red)', () => {
  it('con « | Plan» es un plan y recibe la marca de plan; sin, sigue siendo un día', async () => {
    const d = await device();
    const folder = await weekWith(d, [1]);
    const plan = await d.tree.create(folder, '2026-10-02 | Day 02 | Plan');
    const day = await d.tree.create(folder, '2026-10-02 | Day 02');
    expect(pageKind(d.tree, plan)).toMatchObject({ kind: 'doc', doc: 'plan' });
    expect(pageKind(d.tree, day)).toMatchObject({ kind: 'day' });
    await syncEntityMark(d.tree, plan);
    await syncEntityMark(d.tree, day);
    expect(d.tree.get(plan)?.settings?.entity).toEqual({ kind: 'plan' });
    expect((d.tree.get(day)?.settings?.entity as { kind?: string } | undefined)?.kind).toBe('day');
    // La marca gana: si después cambia el título, sigue siendo un plan.
    await d.tree.setPatch(plan, { title: '2026-10-02 | Day 02 | Casa Rosada' });
    expect(pageKind(d.tree, plan)).toMatchObject({ kind: 'doc', doc: 'plan' });
  });

  it('adentro de una semana de una carpeta de días también', async () => {
    const d = await device();
    const shoot = await d.tree.create(null, 'Rodaje');
    await d.tree.setSetting(shoot, 'holds', 'day');
    const week = await d.tree.create(shoot, 'Semana 01');
    await d.tree.create(week, '2026-10-01 | Día 01');
    const plan = await d.tree.create(week, '2026-10-02 | Día 02 | Plan · Casa Rosada');
    expect(pageKind(d.tree, plan)).toMatchObject({ kind: 'doc', doc: 'plan' });
    await syncEntityMark(d.tree, plan);
    expect(d.tree.get(plan)?.settings?.entity).toEqual({ kind: 'plan' });
  });

  it('«None of these» o una marca de entidad ganan sobre el título', async () => {
    const d = await device();
    const folder = await weekWith(d, [1]);
    const none = await d.tree.create(folder, '2026-10-02 | Day 02 | Plan');
    await d.tree.setSetting(none, 'entity', false);
    expect(isDayPlanRow(d.tree.get(none))).toBe(false);
    const day = await d.tree.create(folder, '2026-10-03 | Day 03 | Plan');
    await d.tree.setSetting(day, 'entity', { kind: 'day' });
    expect(isDayPlanRow(d.tree.get(day))).toBe(false);
    expect(pageKind(d.tree, day)).toMatchObject({ kind: 'day' });
  });

  it('la tira de plantillas de una página de una carpeta de días ofrece también *Day plan*', async () => {
    const d = await device();
    const folder = await weekWith(d, [1]);
    const page = await d.tree.create(folder, '2026-10-02 | Day 02');
    expect(stripKinds(d.tree, page)).toEqual(['onset', 'dayPlan']);
  });
});

describe('el día con su lugar y en su semana (simulación de D813)', () => {
  it('el título sigue la forma de los días de la carpeta y lleva el lugar escrito', () => {
    expect(newDayTitle(null, '2026-11-03', 1, 'en')).toBe('2026-11-03 | Day 01');
    expect(newDayTitle(null, '2026-11-03', 1, 'es', 'Costanera  Sur')).toBe('2026-11-03 | Día 01 | Costanera Sur');
    // La palabra y los ceros de la carpeta, aunque el idioma sea otro.
    expect(newDayTitle('2026-05-12 | Día 40 | 7 Puentes', '2026-05-13', 41, 'en', 'Casa Rosada')).toBe('2026-05-13 | Día 41 | Casa Rosada');
    expect(newDayTitle('2026-05-12 | Day 007', '2026-05-13', 8, 'es')).toBe('2026-05-13 | Day 008');
    // Una barra en el lugar partiría el título: pasa a «·».
    expect(newDayTitle(null, '2026-11-03', 2, 'en', 'Galpón | nave 2')).toBe('2026-11-03 | Day 02 | Galpón · nave 2');
  });

  it('un reporte con lugar sigue siendo un título de la app (se puede reusar vacío); un plan no', () => {
    expect(hasReportTitle('2026-11-03 | Day 01')).toBe(true);
    expect(hasReportTitle('2026-11-03 | Día 01 | Costanera Sur')).toBe(true);
    expect(hasReportTitle('2026-11-03 | Día 01 | Costanera Sur | Plan')).toBe(false);
    expect(hasReportTitle('2026-11-03 | Día 01 | Plan')).toBe(false);
    expect(hasReportTitle('2026-11-03 | Día 01 | A | B')).toBe(false);
    // Las formas que copia `newDayTitle` de la carpeta: el reintento las reusa (O4).
    expect(hasReportTitle('2026-11-03|Dia 01|Galpón')).toBe(true);
    expect(hasReportTitle('2026-11-03 | DIA 7')).toBe(true);
    expect(hasReportTitle('2026-11-03 | Day40 | ')).toBe(false);
  });

  it('una semana vacía adentro de la carpeta de días es la carpeta de lo que se crea desde ella', async () => {
    const d = await device();
    const shoot = await weekWith(d, [1]);
    const week = await d.tree.create(shoot, 'Semana 2');
    const page = await d.tree.create(week, 'Notas de la semana');
    expect(dayReportFolderOf(d.tree, week)).toBe(week);
    // Una página suelta de la semana: el día va a la semana, no a la carpeta de arriba.
    expect(dayReportFolderOf(d.tree, page)).toBe(week);
    // Un reporte de la carpeta de días sigue creando ahí.
    const report = d.tree.children(shoot).find((p) => p.title.startsWith('2026-10-01'))!;
    expect(dayReportFolderOf(d.tree, report.id)).toBe(shoot);
    // Una página recién creada, sin título, todavía no es una semana.
    const blank = await d.tree.create(shoot, '');
    expect(dayReportFolderOf(d.tree, blank)).toBe(shoot);
    // Otra página sin fecha de la carpeta de días no es una semana: el día va a la carpeta, no adentro de ella.
    const sheets = await d.tree.create(shoot, 'Call sheets');
    expect(dayReportFolderOf(d.tree, sheets)).toBe(shoot);
  });

  it('el primer día de una semana nueva sigue el número y lo de ayer de las semanas de antes', async () => {
    const d = await device();
    const shoot = await d.tree.create(null, '4 | Rodaje');
    await markReportFolder(d.tree, shoot);
    const w1 = await d.tree.create(shoot, 'Semana 1');
    let plan = await planDayReport(deps(d), { parentId: w1, projectId: d.tree.workspaceId }, { now: at(1) });
    await createDayReport(deps(d), plan, { date: '2026-10-01', day: 1, location: 'Galpón' }, 'es', { canMark: true });
    plan = await planDayReport(deps(d), { parentId: w1, projectId: d.tree.workspaceId }, { now: at(2) });
    await createDayReport(deps(d), plan, { date: '2026-10-02', day: 2, location: 'Galpón' }, 'es', { canMark: true });
    const w2 = await d.tree.create(shoot, 'Semana 2');
    plan = await planDayReport(deps(d), { parentId: w2, projectId: d.tree.workspaceId }, { now: at(8) });
    expect(plan.reports).toEqual([]);
    expect(plan.last?.title).toBe('2026-10-02 | Día 02');
    expect(plan.suggestion.day).toBe(3);
    const id = await createDayReport(deps(d), plan, { date: '2026-10-08', day: 3, location: 'Bar El Puerto' }, 'en', { canMark: true });
    // La forma de los días de la carpeta (Día, no Day) y adentro de su semana.
    expect(d.tree.get(id)).toMatchObject({ title: '2026-10-08 | Día 03 | Bar El Puerto', parent_id: w2 });
  });

  it('D814: la locación de ayer que nadie tocó no va al título; la escrita o la del plan de esa fecha, sí', () => {
    const base = { suggestion: { date: '2026-10-02', day: 2, location: 'Galpón' }, plans: [] as { id: string; title: string; date: string; day: number | null }[] };
    expect(titlePlace(base, { date: '2026-10-02', day: 2, location: 'Galpón' })).toBe('');
    // Si la persona tocó el campo (aunque vuelva a poner la de ayer), va.
    expect(titlePlace(base, { date: '2026-10-02', day: 2, location: 'Galpón' }, true)).toBe('Galpón');
    expect(titlePlace(base, { date: '2026-10-02', day: 2, location: 'Bar El Puerto' })).toBe('Bar El Puerto');
    const planned = { ...base, plans: [{ id: 'p', title: '2026-10-02 | Día 02 | galpon | Plan', date: '2026-10-02', day: 2 }] };
    expect(titlePlace(planned, { date: '2026-10-02', day: 2, location: 'Galpón' })).toBe('Galpón');
    expect(titlePlace(planned, { date: '2026-10-03', day: 3, location: 'Galpón' })).toBe('');
  });

  it('auditoría final de D813: New day report propone el lugar del plan de esa fecha aunque no se abra desde el plan', () => {
    const plans = [
      { id: 'p1', title: '2026-10-02 | Día 02 | Plan · SIN VFX', date: '2026-10-02', day: 2 },
      { id: 'p2', title: '2026-10-03 | Día 03 | Bar El Puerto | Plan', date: '2026-10-03', day: 3 },
    ];
    expect(plannedLocation({ plans }, '2026-10-03')).toBe('Bar El Puerto');
    // Un plan sin lugar en el título, o una fecha sin plan: nada (queda la de ayer).
    expect(plannedLocation({ plans }, '2026-10-02')).toBe('');
    expect(plannedLocation({ plans }, '2026-10-04')).toBe('');
    // Una unidad no es un lugar.
    expect(plannedLocation({ plans: [{ id: 'p3', title: '2026-10-05 | Día 04 | U2 | Plan', date: '2026-10-05', day: 4 }] }, '2026-10-05')).toBe('');
    expect(plannedLocation({ plans: [{ id: 'p4', title: '2026-10-05 | Día 04 | Unidad 2 | Plan', date: '2026-10-05', day: 4 }] }, '2026-10-05')).toBe('');
    expect(plannedLocation({ plans: [{ id: 'p5', title: '2026-10-05 | Día 04 | U2 Estudio | Plan', date: '2026-10-05', day: 4 }] }, '2026-10-05')).toBe('U2 Estudio');
  });

  it('verificación de v0.306: con el campo sin tocar (el globito lo sabe), al título va solo la locación del plan de esa fecha', () => {
    const base = { suggestion: { date: '2026-10-02', day: 2, location: 'Galpón' }, plans: [{ id: 'p', title: '2026-10-03 | Día 03 | Bar El Puerto | Plan', date: '2026-10-03', day: 3 }] };
    // La del plan de otra fecha, que quedó en el campo al cambiar la fecha: no.
    expect(titlePlace(base, { date: '2026-10-04', day: 3, location: 'Bar El Puerto' }, false)).toBe('');
    expect(titlePlace(base, { date: '2026-10-03', day: 3, location: 'Bar El Puerto' }, false)).toBe('Bar El Puerto');
    // Escrita: siempre. Sin saber si se tocó (otros caminos): la que no es la de ayer, como antes.
    expect(titlePlace(base, { date: '2026-10-04', day: 3, location: 'Bar El Puerto' }, true)).toBe('Bar El Puerto');
    expect(titlePlace(base, { date: '2026-10-04', day: 3, location: 'Bar El Puerto' })).toBe('Bar El Puerto');
  });

  it('New day report abierto desde un plan propone su fecha, su día y su lugar; con el reporte hecho, la propuesta de siempre', async () => {
    const d = await device();
    const folder = await weekWith(d, [1, 2]);
    let plan = await planDayReport(deps(d), { parentId: folder, projectId: d.tree.workspaceId }, { now: at(2) });
    const planId = await createDayPlan(deps(d), plan, { date: '2026-10-05', day: 3, location: 'Casa Rosada' }, 'en');
    plan = await planDayReport(deps(d), { parentId: folder, projectId: d.tree.workspaceId }, { now: at(2) });
    expect(planProposal(d.tree, planId, plan)).toEqual({ date: '2026-10-05', day: 3, location: 'Casa Rosada' });
    // Un reporte no es un plan.
    const report = d.tree.children(folder)[0];
    expect(planProposal(d.tree, report.id, plan)).toBeNull();
    // Con el reporte de esa fecha creado, ya no propone el plan; el reporte queda abajo de su plan, con el lugar.
    const id = await createDayReport(deps(d), plan, { date: '2026-10-05', day: 3, location: 'Casa Rosada' }, 'en', { canMark: true });
    expect(titles(d, folder).slice(-2)).toEqual(['2026-10-05 | Day 03 | Casa Rosada | Plan', '2026-10-05 | Day 03 | Casa Rosada']);
    expect(d.tree.get(id)?.title).toBe('2026-10-05 | Day 03 | Casa Rosada');
    plan = await planDayReport(deps(d), { parentId: folder, projectId: d.tree.workspaceId }, { now: at(2) });
    expect(planProposal(d.tree, planId, plan)).toBeNull();
  });
});
