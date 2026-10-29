// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { pageKind } from '../relations/kind';
import { createStageFolders } from '../relations/projectStructure';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { writeNewPage } from '../templates/dayReportCreate';
import { SCRATCH_LOCATIONS, SCRATCH_SCENES, seedPlan, seedReport, seedScene, seedScenes, seedScouting, shootDate, type SeedDeps } from './scratchData';

const devices: Device[] = [];
afterEach(async () => {
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
});

async function world(lang: 'en' | 'es' = 'es') {
  const server = new FakeServer();
  server.enableTeam();
  const device = await makeDevice(server);
  devices.push(device);
  await device.engine.syncNow();
  const projectId = await device.tree.createProject('El último tren');
  const stages = await createStageFolders(device.tree, projectId, lang);
  const photos: string[] = [];
  const deps: SeedDeps = {
    tree: device.tree,
    projectId,
    stages,
    lang,
    docs: device.docs,
    write: async (pageId, blocks) => void (await writeNewPage(device.docs, pageId, blocks)),
    photo: async (pageId, name) => {
      photos.push(`${name}@${pageId}`);
      return null;
    },
  };
  return { device, deps, photos };
}

describe('el proyecto de práctica de «A project from scratch»', () => {
  it('siembra 20 escenas, 5 locaciones y sus decorados adentro, cada uno con su tipo', async () => {
    const { device, deps } = await world();
    await seedScenes(deps);
    const tree = device.tree;
    const scenes = tree.children(deps.stages.scenes);
    expect(scenes.map((r) => r.title.slice(0, 3))).toEqual(SCRATCH_SCENES.map((s) => s.code));
    for (const r of scenes) expect(pageKind(tree, r.id)).toMatchObject({ kind: 'scene', code: r.title.slice(0, 3) });
    const locs = tree.children(deps.stages.locations);
    expect(locs.map((r) => r.title).sort()).toEqual(SCRATCH_LOCATIONS.map((l) => l.name.es).sort());
    for (const l of locs) {
      expect(pageKind(tree, l.id).kind).toBe('location');
      const def = SCRATCH_LOCATIONS.find((x) => x.name.es === l.title)!;
      const sets = tree.children(l.id);
      expect(sets.map((s) => s.title)).toEqual(def.sets.map((s) => s.name.es));
      // Un decorado adentro de su locación sigue siendo decorado (su marca), no un scouting de la locación.
      for (const s of sets) expect(pageKind(tree, s.id).kind).toBe('set');
    }
  });

  it('no repite: sembrar otra vez, o una escena que ya existe, no crea nada', async () => {
    const { device, deps } = await world('en');
    const first = await seedScene(deps, '001');
    const count = device.tree.allRowsOf(deps.projectId).length;
    expect(await seedScene(deps, '001')).toBe(first);
    await seedScenes(deps, ['001']);
    expect(device.tree.allRowsOf(deps.projectId).length).toBe(count);
    // La escena hecha a mano en el capítulo 2 (con otro nombre) también cuenta: por su número.
    const { deps: other, device: d2 } = await world('en');
    const own = await d2.tree.create(other.stages.scenes, '001 | My own name', other.projectId);
    expect(await seedScene(other, '001')).toBe(own);
  });

  it('el scouting, el plan y el reporte de hoy, con su marca y su contenido, sin repetir', async () => {
    const { device, deps } = await world();
    await seedScenes(deps);
    const tree = device.tree;
    const scout = await seedScouting(deps);
    expect(pageKind(tree, scout)).toMatchObject({ kind: 'doc', doc: 'scouting' });
    expect(tree.get(scout)?.title).toBe('Scouting de dirección · Estación Vieja');
    const plan = await seedPlan(deps);
    expect(tree.get(plan)?.settings?.entity).toMatchObject({ kind: 'plan' });
    expect(tree.get(plan)?.title).toContain(shootDate(0));
    // El plan trae las escenas de hoy como link a su página (así la cabecera del reporte lee el plan).
    const doc = await device.docs.open(plan);
    const xml = doc.getXmlFragment(CONTENT_FRAGMENT).toString();
    device.docs.close(plan);
    for (const code of ['001', '002', '003']) expect(xml).toContain(`/p/${await seedScene(deps, code)}`);
    const report = await seedReport(deps);
    expect(pageKind(tree, report).kind).toBe('day');
    expect(tree.get(report)?.title).toBe(`${shootDate(0)} | Día 01 | Estación Vieja`);
    // Otra vez: no se crea nada.
    const count = tree.allRowsOf(deps.projectId).length;
    expect([await seedScouting(deps), await seedPlan(deps), await seedReport(deps)]).toEqual([scout, plan, report]);
    expect(tree.allRowsOf(deps.projectId).length).toBe(count);
  });

  it('las fechas de rodaje se cuentan desde hoy (el plan del recorrido se crea con la fecha que propone la app)', () => {
    expect(shootDate(0, new Date(2026, 9, 29, 23, 30))).toBe('2026-10-29');
    expect(shootDate(3, new Date(2026, 9, 30))).toBe('2026-11-02');
    expect(shootDate(-7, new Date(2026, 0, 3))).toBe('2025-12-27');
    expect(SCRATCH_SCENES.filter((x) => x.date === 0).map((x) => x.code)).toEqual(['001', '002', '003']);
  });
});
