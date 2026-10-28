// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { syncEntityMark } from '../relations/entitySync';
import { isDayPlanRow, pageKind } from '../relations/kind';
import { reportsOnDate } from '../relations/tomorrowNew';
import { BUILTIN_PLAN } from './builtinIds';
import { planTitle, planTitleFor } from './dayReport';
import {
  createDayPlan,
  createDayReport,
  dayPlanTitle,
  markReportFolder,
  planDayReport,
  placeBefore,
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
    // La locación va al campo del plan, no al nombre: el reporte que después crea *New day report* no la lleva.
    expect(row.title).toBe('2026-10-03 | Day 03 | Plan');
    expect(row.template_id).toBe(BUILTIN_PLAN);
    expect(row.settings?.entity).toEqual({ kind: 'plan' });
    expect(titles(d, folder)).toEqual(['2026-10-01 | Day 01', '2026-10-02 | Day 02', '2026-10-03 | Day 03 | Plan']);
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
