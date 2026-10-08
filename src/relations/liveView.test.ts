// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectIndex } from '../search/projectIndex';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import type { PageSettings } from '../sync/types';
import { buildProject, writeBlocks, type Built } from './fixtures/proyectoSintetico';
import { locationLive, sceneLive, type LiveSource } from './liveView';
import { RelationIndex } from './relationIndex';

// Lo que muestra la cabecera viva, con el índice de verdad sobre un proyecto sintético con la forma del recorte de la
// maqueta (Docs/Doc_Relaciones.md, sección 10): todo sale del índice, nada de listas guardadas.

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

async function indexed(d: Device, projectId: string): Promise<{ src: LiveSource; index: ProjectIndex; relations: RelationIndex }> {
  const index = new ProjectIndex(d.tree, d.docs);
  const relations = new RelationIndex(d.tree, index);
  await index.refresh(projectId);
  await relations.update(projectId);
  const snap = relations.snapshot(projectId)!;
  return { src: { snap, title: (id) => d.tree.get(id)?.title, content: (id) => index.content(id) }, index, relations };
}

async function setup(): Promise<{ d: Device; built: Built; src: LiveSource }> {
  const d = await makeDevice(new FakeServer());
  devices.push(d);
  const built = await buildProject(d, fakePhoto);
  const { src } = await indexed(d, built.projectId);
  return { d, built, src };
}

describe('la cabecera de una escena', () => {
  it('105_027: filmada en dos locaciones y tres días (por el título del día), scouting que la nombra, fichas, fotos', async () => {
    const { built, src } = await setup();
    expect(src.snap.complete).toBe(true);
    const v = sceneLive(src, '105_027');
    expect(v.pageId).toBe(built.ids.s027);
    expect(v.episode).toBe('105');
    // Días en orden de fecha, cada uno con su locación del título y sus secciones.
    expect(v.days.map((x) => [x.day.label, x.day.date, x.day.loc, x.sections.map((s) => s.heading)])).toEqual([
      ['Día 59', '2026-02-19', 'CENADE', ['Escena 105_027b']],
      ['Día 70', '2026-03-06', 'La Arenera (estudio)', ['Escena 105_027A + 029B']],
      ['Día 76', '2026-03-14', 'La Arenera (estudio)', ['Escena 5-27', 'Escena 5-27A']],
    ]);
    // La sección del día 59 va hasta el título siguiente («Plates ambulancia»), con sus 5 fotos y su texto.
    const s59 = v.days[0].sections[0];
    expect(s59.place.endBlockId).toBeTruthy();
    expect(s59.photos.map((p) => p.id)).toEqual(['D59 vuelco 1', 'D59 vuelco 2', 'D59 vuelco 3', 'D59 vuelco 4', 'D59 vuelco 5'].map((l) => built.photos[l]));
    expect(s59.text).toContain('Tres tomas del vuelco');
    expect(s59.part).toBe('B');
    // La sección compartida dice con quién la comparte.
    expect(v.days[1].sections[0].shared).toEqual(['105_029']);
    // Desglose: dos fichas; la locación que nombra su desglose.
    expect(v.cards.map((c) => c.title)).toEqual(['PRUEBA_105_027_010 Ambulancia', 'PRUEBA_105_027_020 Ambulancia interior']);
    expect(v.plannedAt.map((l) => l.title)).toEqual(['La Arenera (estudio)']);
    // El scouting que la nombra (forma compacta con letra en el título de la sección), con sus 3 fotos.
    expect(v.scoutPages.map((s) => s.title)).toEqual(['Tech scout 06/01']);
    expect(v.scouting.map((e) => [e.heading, e.photos.length])).toEqual([['(5027b) Ambulancia vuelca', 3]]);
    expect(v.scoutsVia).toEqual([]);
    // Otras formas en que se escribe (nunca la canónica).
    expect(v.aliases).toEqual(expect.arrayContaining(['105_027b', '5027b', '5-27']));
    expect(v.aliases).not.toContain('105_027');
    // La nota suelta va a «Also named in»; la página índice, plegada aparte; el archivo con graph:false, en ningún lado.
    expect(v.also.map((a) => a.title)).toEqual(['Notas de dirección']);
    expect(v.indexPages.map((a) => a.title)).toEqual(['Planning general']);
    expect(JSON.stringify(v)).not.toContain(built.ids.archivo);
    // Fotos: primero el desglose, después el scouting y después los días; sin repetir.
    expect(v.photos.slice(0, 2).map((p) => p.sourceKind)).toEqual(['breakdown', 'breakdown']);
    expect(v.photos[2].source).toBe('Tech scout 06/01');
    expect(v.photos.at(-1)!.source).toBe('Día 76');
    expect(new Set(v.photos.map((p) => p.id)).size).toBe(v.photos.length);
    expect(v.noVfx).toBe(false);
  });

  it('sin sección en un reporte: «No report section», y «No VFX» solo si su ficha lo dice en un campo propio', async () => {
    const { d, built, src } = await setup();
    const v026 = sceneLive(src, '105_026');
    expect(v026.days).toEqual([]);
    expect(v026.noVfx).toBe(true);
    const v025 = sceneLive(src, '105_025');
    expect(v025.noVfx).toBe(false);
    // Una frase que lo dice de pasada no cuenta.
    await writeBlocks(d, built.ids.s025_010, [{ p: 'Esta toma no lleva no VFX salvo el cielo' }]);
    const again = await indexed(d, built.projectId);
    expect(sceneLive(again.src, '105_025').noVfx).toBe(false);
    // Sin scouting que la nombre: los de las locaciones donde se filmó.
    const v029 = sceneLive(src, '105_029');
    expect(v029.scoutPages).toEqual([]);
    expect(v029.scoutsVia.map((s) => [s.title, s.loc])).toEqual([['Tech scout 06/01', 'CENADE']]);
  });
});

describe('ronda de corrección (auditoría de E3)', () => {
  it('B1: una sola ficha «No VFX» no marca la escena; todas sí; y una parte se cuenta', async () => {
    const { d, built } = await setup();
    // 105_025: la 010 con DMP y CG (como 105_062 en ERSO) y una 020 «No VFX».
    await writeBlocks(d, built.ids.s025_010, [{ p: 'Locación real: CENADE' }, { row: ['VFX Cat', 'DMP 2.5D, CG'] }]);
    const c020 = await d.tree.create(built.ids.s025, 'PRUEBA_105_025_020 Ambulancia', built.projectId);
    await writeBlocks(d, c020, [{ row: ['VFX Cat', 'No VFX'] }]);
    let { src } = await indexed(d, built.projectId);
    let v = sceneLive(src, '105_025');
    expect(v.noVfx).toBe(false);
    expect(v.noVfxCards).toEqual({ no: 1, of: 2 });
    // Las dos «No VFX»: la escena entera.
    await writeBlocks(d, built.ids.s025_010, [{ p: 'Locación real: CENADE' }, { row: ['VFX Cat', 'No VFX'] }]);
    ({ src } = await indexed(d, built.projectId));
    v = sceneLive(src, '105_025');
    expect(v.noVfx).toBe(true);
    // Una ficha sin texto no cuenta.
    await d.tree.create(built.ids.s025, 'PRUEBA_105_025_030', built.projectId);
    ({ src } = await indexed(d, built.projectId));
    expect(sceneLive(src, '105_025').noVfx).toBe(true);
  });

  it('O2: un día con dos locaciones en el título cuenta para las dos', async () => {
    const { d, built } = await setup();
    const d82 = await d.tree.create(built.ids.rodaje, '2026-03-20 | Día 82 | CENADE + La Arenera', built.projectId);
    await writeBlocks(d, d82, [{ h: 1, text: 'Escena 105_029' }, { p: 'Retomas.' }]);
    const { src } = await indexed(d, built.projectId);
    expect(locationLive(src, 'CENADE').days.map((x) => x.day.label)).toContain('Día 82');
    expect(locationLive(src, 'La Arenera (estudio)').days.map((x) => x.day.label)).toContain('Día 82');
    const day = sceneLive(src, '105_029').days.find((x) => x.day.label === 'Día 82')!;
    expect(day.day.locs).toEqual(['CENADE', 'La Arenera (estudio)']);
  });

  it('O3: el plan de un día en que la escena ya tiene sección no repite ese día como «planned»', async () => {
    const { d, built } = await setup();
    const plan59 = await d.tree.create(built.ids.d59, 'Plan | Día 59', built.projectId);
    await writeBlocks(d, plan59, [{ p: 'Orden: 105_027 primero.' }]);
    const { src } = await indexed(d, built.projectId);
    const v = sceneLive(src, '105_027');
    expect(v.plannedDays.map((x) => x.day.label)).toEqual(['Día 60']);
  });
});

describe('lo planeado no es lo filmado', () => {
  it('el plan de adentro de un día nombra escenas: planeadas para ese día, nunca un día de rodaje (D400)', async () => {
    const { built, src } = await setup();
    const v = sceneLive(src, '105_027');
    expect(v.days.map((x) => x.day.label)).toEqual(['Día 59', 'Día 70', 'Día 76']);
    expect(v.shoot.every((e) => e.pageId !== built.ids.plan60)).toBe(true);
    expect(v.plannedDays.map((x) => [x.day.label, x.items.map((i) => i.pageTitle)])).toEqual([['Día 60', ['Plan | Día 60']]]);
    const v008 = sceneLive(src, '104_008');
    expect(v008.days).toEqual([]);
    expect(v008.plannedDays.map((x) => x.day.label)).toEqual(['Día 60']);
    // La locación tampoco la cuenta como filmada.
    const cenade = locationLive(src, 'CENADE');
    expect(cenade.days.find((x) => x.day.label === 'Día 60')!.scenes.map((s) => s.code)).toEqual(['105_029']);
    expect(cenade.planned.find((s) => s.code === '104_008')!.days).toEqual([]);
    expect(cenade.noReport).toContain('104_008');
  });
});

describe('la cabecera de una locación', () => {
  it('CENADE: escenas planeadas por su desglose, días por el título, secciones sin número, scouting y sin sección', async () => {
    const { built, src } = await setup();
    const v = locationLive(src, 'CENADE');
    expect(v.pageId).toBe(built.ids.cenade);
    expect(v.planned.map((s) => s.code)).toEqual(['104_008', '104_009', '105_025', '105_026']);
    expect(v.days.map((x) => [x.day.label, x.scenes.map((s) => s.code), x.unresolved.map((u) => u.heading)])).toEqual([
      ['Día 59', ['105_027'], ['Plates ambulancia']],
      ['Día 60', ['105_029'], []],
    ]);
    // Ninguna de las planeadas tiene sección: lo dice sin afirmar que no se filmó.
    expect(v.noReport).toEqual(['104_008', '104_009', '105_025', '105_026']);
    expect(v.scouts.map((s) => [s.title, s.photos])).toEqual([['Tech scout 06/01', 5]]);
    // Fotos: el scouting y los días (todas las del día, por el título).
    expect(v.photos.length).toBe(5 + 7 + 2);
    expect(v.indexPages.map((p) => p.title)).toEqual(['Planning general']);
    // Los días que la nombran en el título no se repiten en «Also named in».
    expect(v.also.map((p) => p.title)).not.toContain('2026-02-19 | Día 59 | CENADE');
  });
});

describe('permisos', () => {
  it('un invitado que ve solo la escena ve solo lo de su rama: ningún título ni foto de páginas que no ve', async () => {
    const server = new FakeServer();
    server.enableTeam();
    const owner = await makeDevice(server);
    devices.push(owner);
    const built = await buildProject(owner, fakePhoto);
    // La marca de la página (E2): sin la carpeta, el invitado igual sabe que es una escena.
    await owner.tree.setPatch(built.ids.s027, { settings: { entity: { kind: 'scene', code: '105_027' } } as unknown as PageSettings });
    await owner.engine.syncNow();
    server.addMember('ana', 'member', 'ana@test');
    server.grant('ana', { pageId: built.ids.s027 }, 'view');
    const guest = await makeDevice(server, crypto.randomUUID(), '0.021', {}, undefined, { id: 'ana', email: 'ana@test' });
    devices.push(guest);
    await guest.engine.syncNow();
    await guest.engine.syncNow();
    expect(guest.tree.get(built.ids.d59)).toBeUndefined();
    const { src } = await indexed(guest, built.projectId);
    const v = sceneLive(src, '105_027');
    expect(v.cards.length).toBe(2);
    expect(v.days).toEqual([]);
    expect(v.scoutPages).toEqual([]);
    expect(v.also).toEqual([]);
    const text = JSON.stringify(v);
    for (const key of ['d59', 'd70', 'scout', 'cenade', 'arenera', 'notas', 'planning']) {
      expect(text).not.toContain(built.ids[key]);
      expect(text).not.toContain(owner.tree.get(built.ids[key])!.title);
    }
    for (const label of ['D59 vuelco 1', 'Vuelco 1', 'D70 1']) expect(text).not.toContain(built.photos[label]);
  });
});
