// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectIndex } from '../search/projectIndex';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import type { PageSettings } from '../sync/types';
import { buildProject, writeBlocks } from './fixtures/proyectoSintetico';
import type { LiveSource } from './liveView';
import { MAP_FORMAT, MAP_VERSION, mapCounts, mapJson, mapText, pendingSummary, projectMap, sceneFilterText, titlePlace } from './projectMap';
import { RelationIndex } from './relationIndex';

// El mapa del proyecto (Docs/Doc_Relaciones.md, sección 12) con el índice de verdad sobre el proyecto sintético: los días
// en orden de fecha, las locaciones en el tiempo, las escenas con dónde se filmaron (por las secciones de los reportes),
// los pendientes, el JSON con forma fija y, para un invitado, solo lo que ve.

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

async function sourceOf(d: Device, projectId: string): Promise<LiveSource> {
  const index = new ProjectIndex(d.tree, d.docs);
  const relations = new RelationIndex(d.tree, index);
  await index.refresh(projectId);
  await relations.update(projectId);
  const snap = relations.snapshot(projectId)!;
  return { snap, title: (id) => d.tree.get(id)?.title, content: (id) => index.content(id) };
}

const META = { project: { id: 'p', name: 'Serie de prueba' }, origin: 'https://app.test', partial: false, builtAt: '2026-10-08T12:00:00.000Z' };

describe('el mapa del proyecto', () => {
  it('días en orden de fecha, con sus secciones de escena, su plan y las secciones sin número', async () => {
    const d = await makeDevice(new FakeServer());
    devices.push(d);
    const built = await buildProject(d, fakePhoto, { days: true });
    const m = projectMap(await sourceOf(d, built.projectId));
    expect(m.complete).toBe(true);
    expect(m.days.map((x) => [x.label, x.date])).toEqual([
      ['Día 58', '2026-02-18'],
      ['Día 59', '2026-02-19'],
      ['Día 60', '2026-02-20'],
      ['Día 70', '2026-03-06'],
      ['2026-03-10 | Sin reporte | La Arenera (estudio), Colegio Pradere', '2026-03-10'],
      ['Día 76', '2026-03-14'],
    ]);
    const d59 = m.days.find((x) => x.pageId === built.ids.d59)!;
    expect(d59.locs).toEqual(['CENADE']);
    expect(d59.scenes).toEqual(['105_027']);
    expect(d59.sections.map((s) => [s.title, s.scenes, s.photos])).toEqual([['Escena 105_027b', ['105_027'], 5]]);
    // «Info general» es la sección del día; «Plates ambulancia» (con fotos, sin número) va a Pending.
    expect(d59.unnumbered.map((s) => [s.title, s.photos])).toEqual([['Plates ambulancia', 2]]);
    expect(m.unnumbered.map((u) => [u.dayId, u.title])).toEqual([[built.ids.d59, 'Plates ambulancia']]);
    // El plan del Día 60 sale de las fichas con esa fecha (no tiene página Plan).
    const d60 = m.days.find((x) => x.pageId === built.ids.d60)!;
    expect([d60.planSource, d60.planned]).toEqual(['breakdown', ['104_008', '104_009', '105_029']]);
    expect(m.days.find((x) => x.pageId === built.ids.d70)!.scenes).toEqual(['105_027', '105_029']);
    expect(d59.written).toBe(true);
  });

  it('locaciones en el tiempo: sus días por el título, las escenas filmadas ahí y las que planea su desglose', async () => {
    const d = await makeDevice(new FakeServer());
    devices.push(d);
    const built = await buildProject(d, fakePhoto, { days: true });
    const m = projectMap(await sourceOf(d, built.projectId));
    expect(m.locations.map((l) => l.name)).toEqual(['CENADE', 'La Arenera (estudio)']);
    const cenade = m.locations[0];
    expect(cenade.pageId).toBe(built.ids.cenade);
    expect(cenade.days).toEqual([built.ids.d58, built.ids.d59, built.ids.d60]);
    expect(cenade.shot).toEqual(['105_027', '105_029']);
    expect(cenade.planned).toEqual(expect.arrayContaining(['104_008', '104_009', '105_025', '105_026']));
    expect(cenade.scouts).toEqual([built.ids.scout]);
    const arenera = m.locations[1];
    expect(arenera.days).toEqual([built.ids.d70, built.ids.d_sin, built.ids.d76]);
    expect(arenera.shot).toEqual(['105_027', '105_029']);
  });

  it('escenas: dónde tienen sección (día, locación del título) y dónde las planea su desglose; nunca «no se filmó»', async () => {
    const d = await makeDevice(new FakeServer());
    devices.push(d);
    const built = await buildProject(d, fakePhoto, { days: true, indexPage: false });
    const m = projectMap(await sourceOf(d, built.projectId));
    const s027 = m.scenes.find((s) => s.code === '105_027')!;
    expect(s027.pageId).toBe(built.ids.s027);
    expect(s027.title).toBe('La ambulancia empieza a zigzaguear');
    expect(s027.episode).toBe('105');
    expect(s027.shot.map((x) => [x.label, x.locs, x.sections.map((y) => y.title)])).toEqual([
      ['Día 59', ['CENADE'], ['Escena 105_027b']],
      ['Día 70', ['La Arenera (estudio)'], ['Escena 105_027A + 029B']],
      ['Día 76', ['La Arenera (estudio)'], ['Escena 5-27', 'Escena 5-27A']],
    ]);
    expect(s027.plannedAt).toEqual(expect.arrayContaining(['La Arenera (estudio)', 'CENADE']));
    expect(s027.cards.length).toBe(3);
    // Las escenas van por código; 105_026 no tiene sección en ningún reporte.
    expect(m.scenes.map((s) => s.code)).toEqual(['104_008', '104_009', '105_025', '105_026', '105_027', '105_029']);
    expect(m.scenes.find((s) => s.code === '105_026')!.shot).toEqual([]);
    expect(m.scenes.find((s) => s.code === '104_008')!.plannedDays).toEqual([built.ids.d60]);
    // El filtro entiende otras formas del número.
    expect(sceneFilterText(s027)).toContain('5027');
    expect(sceneFilterText(s027)).toContain('105-027');
    // La rama con graph:false no aparece en ningún lado.
    expect(JSON.stringify(mapJson(m, META))).not.toContain(built.ids.archivo);
  });

  it('pendientes: un número que no existe, con dónde se nombra; y una escena en dos páginas', async () => {
    const d = await makeDevice(new FakeServer());
    devices.push(d);
    const built = await buildProject(d, fakePhoto, { days: true });
    await writeBlocks(d, built.ids.notas, [{ p: 'Revisar con dirección la 105_027 antes del día 70.' }, { p: 'Falta la Escena 105_120 en el desglose.' }]);
    const dup = await d.tree.create(built.ids.ep5, '029 | El fugitivo abre los ojos (copia)', built.projectId);
    const m = projectMap(await sourceOf(d, built.projectId));
    expect(m.pending.map((p) => [p.code, p.mentions.map((x) => x.pageId)])).toEqual([['105_120', [built.ids.notas]]]);
    expect(m.duplicates).toEqual([{ code: '105_029', pageIds: [built.ids.s029, dup] }]);
    expect(mapCounts(m)).toMatchObject({ pending: 1, duplicates: 1, unnumbered: 1, toResolve: 3 });
  });

  it('el JSON: forma fija (formato y versión), páginas una vez con su link, menciones con su página y sección', async () => {
    const d = await makeDevice(new FakeServer());
    devices.push(d);
    const built = await buildProject(d, fakePhoto, { days: true, indexPage: false });
    const src = await sourceOf(d, built.projectId);
    const m = projectMap(src);
    const j = JSON.parse(JSON.stringify(mapJson(m, META)));
    expect(Object.keys(j)).toEqual(['format', 'version', 'project', 'pageUrl', 'builtAt', 'complete', 'scope', 'counts', 'scenes', 'locations', 'days', 'pending', 'duplicates', 'pages']);
    expect([j.format, j.version, j.scope, j.complete]).toEqual([MAP_FORMAT, MAP_VERSION, 'project', true]);
    expect(MAP_FORMAT).toBe('shotdocs.map');
    // Cada número es el largo de su lista: nada de «pending: 1» con `pending: []` (O4).
    expect(j.counts).toEqual({ scenes: 6, locations: 2, days: 6, pending: 0, duplicates: 0, unnumbered: 1 });
    expect(j.pending).toEqual([]);
    expect(mapCounts(m).toResolve).toBe(1);
    expect(pendingSummary(src)).toEqual({ pending: 0, duplicates: 0, unnumbered: 1, total: 1 });
    const s = j.scenes.find((x: { code: string }) => x.code === '105_027');
    expect(Object.keys(s)).toEqual(['code', 'page', 'title', 'episode', 'plannedAt', 'shot', 'plannedDays', 'cards', 'mentions']);
    expect(s.shot[0]).toMatchObject({ day: built.ids.d59, date: '2026-02-19', locations: ['CENADE'] });
    expect(Object.keys(s.shot[0].sections[0])).toEqual(['block', 'end', 'title', 'photos']);
    const scoutMention = s.mentions.find((x: { page: string }) => x.page === built.ids.scout);
    expect(scoutMention).toMatchObject({ stage: 'scouting', via: ['heading'] });
    expect(scoutMention.sections[0].title).toBe('(5027b) Ambulancia vuelca');
    expect(j.pageUrl).toBe('https://app.test/p/{id}');
    expect(j.pages[built.ids.d59]).toEqual({ title: '2026-02-19 | Día 59 | CENADE', kind: 'day', stage: 'shoot' });
    expect(j.pages[built.ids.scout].kind).toBe('part');
    // Cada id que nombra el mapa tiene su página en `pages`.
    const ids = new Set<string>();
    JSON.stringify(j, (k, v) => {
      if (['page', 'day'].includes(k) && typeof v === 'string') ids.add(v);
      if (['days', 'cards', 'scouts', 'plannedDays', 'pages'].includes(k) && Array.isArray(v)) for (const x of v) if (typeof x === 'string') ids.add(x);
      return v;
    });
    for (const id of ids) expect(j.pages[id], id).toBeTruthy();
    // El texto legible dice lo mismo, sin ids.
    const text = mapText(m, META);
    expect(text).toContain('# Serie de prueba — map');
    expect(text).toContain('6 scenes · 2 locations · 6 shoot days.');
    expect(text).toContain('To resolve: 1 report section with photos and no scene number.');
    // La fecha no se repite cuando el título ya empieza con ella (O7).
    expect(text).toContain('\n- 2026-02-19 | Día 59 | CENADE: CENADE');
    expect(text).not.toContain('2026-02-19 2026-02-19');
    expect(text).toContain('days: Día 70 (2026-03-06), 2026-03-10 | Sin reporte | La Arenera (estudio), Colegio Pradere, Día 76 (2026-03-14)');
    expect(text).not.toMatch(/1 days/);
    expect(text).toContain('- CENADE: 6 scenes · 3 days');
    expect(text).toContain('105_027 La ambulancia empieza a zigzaguear: planned at');
    expect(text).toContain('shot Día 59 at CENADE (§ Escena 105_027b)');
    expect(text).toContain('105_026 El fugitivo cruza la ruta: planned at CENADE · no report section');
    expect(text).not.toContain(built.ids.d59);
  });

  it('el lugar que dice el título de un día además de la fecha y el número', () => {
    expect(titlePlace({ title: '2025-11-05 | Día 05 | Frente Ruso Villarino', label: 'Día 05', date: '2025-11-05' })).toBe('Frente Ruso Villarino');
    expect(titlePlace({ title: '2026-03-15 | Sin reporte | X', label: '2026-03-15 | Sin reporte | X', date: '2026-03-15' })).toBe('');
  });

  it('un invitado que ve una escena y un día que nombra otra que no ve: «not in the pages I can see», no «not created»', async () => {
    const server = new FakeServer();
    server.enableTeam();
    const owner = await makeDevice(server);
    devices.push(owner);
    const built = await buildProject(owner, fakePhoto, { days: true });
    await owner.tree.setPatch(built.ids.s027, { settings: { entity: { kind: 'scene', code: '105_027' } } as unknown as PageSettings });
    await owner.tree.setPatch(built.ids.d70, { settings: { entity: { kind: 'day' } } as unknown as PageSettings });
    // El Día 70 tiene una sección de 105_027 y otra de 105_029; la invitada ve la escena 105_027 y el día, no 105_029.
    await writeBlocks(owner, built.ids.d70, [{ h: 1, text: 'Escena 105_027A' }, { p: 'Interior en estudio.' }, { h: 1, text: 'Escena 105_029' }, { p: 'Primer plano.' }]);
    await owner.engine.syncNow();
    server.addMember('ana', 'member', 'ana@test');
    server.grant('ana', { pageId: built.ids.s027 }, 'view');
    server.grant('ana', { pageId: built.ids.d70 }, 'view');
    const guest = await makeDevice(server, crypto.randomUUID(), '0.021', {}, undefined, { id: 'ana', email: 'ana@test' });
    devices.push(guest);
    await guest.engine.syncNow();
    await guest.engine.syncNow();
    const m = projectMap(await sourceOf(guest, built.projectId));
    expect(m.pending.map((p) => p.code)).toEqual(['105_029']);
    const meta = { ...META, partial: true };
    const text = mapText(m, meta);
    expect(text).toContain('## Scene numbers named that are not in the pages I can see');
    expect(text).toContain('1 scene number named that are not in the pages I can see');
    expect(text).not.toContain('not created');
    expect(text).not.toMatch(/don.t exist/);
    expect((mapJson(m, meta) as { scope: string }).scope).toBe('visible');
  });

  it('un invitado que ve solo una escena: el mapa y el JSON tienen solo lo que ve', async () => {
    const server = new FakeServer();
    server.enableTeam();
    const owner = await makeDevice(server);
    devices.push(owner);
    const built = await buildProject(owner, fakePhoto, { days: true });
    await owner.tree.setPatch(built.ids.s027, { settings: { entity: { kind: 'scene', code: '105_027' } } as unknown as PageSettings });
    await owner.engine.syncNow();
    server.addMember('ana', 'member', 'ana@test');
    server.grant('ana', { pageId: built.ids.s027 }, 'view');
    const guest = await makeDevice(server, crypto.randomUUID(), '0.021', {}, undefined, { id: 'ana', email: 'ana@test' });
    devices.push(guest);
    await guest.engine.syncNow();
    await guest.engine.syncNow();
    const m = projectMap(await sourceOf(guest, built.projectId));
    expect(m.scenes.map((s) => s.code)).toEqual(['105_027']);
    expect(m.scenes[0].shot).toEqual([]);
    expect(m.locations).toEqual([]);
    expect(m.days).toEqual([]);
    const text = JSON.stringify(mapJson(m, { ...META, partial: true })) + mapText(m, { ...META, partial: true });
    for (const key of ['d59', 'd60', 'd70', 'scout', 'cenade', 'arenera', 'notas', 's029', 's008']) {
      expect(text).not.toContain(built.ids[key]);
      expect(text).not.toContain(owner.tree.get(built.ids[key])!.title);
    }
    expect(text).toContain('"scope":"visible"');
  });
});
