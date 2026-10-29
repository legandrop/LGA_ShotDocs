// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectIndex } from '../search/projectIndex';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { LEVEL_EDIT_PAGES } from '../sync/access';
import { createDepsFrom, createEntity, createGuard, type GuardPerms } from './createEntity';
import { installEntityMarks } from './entitySync';
import { buildProject, writeBlocks, type Built } from './fixtures/proyectoSintetico';
import { kindReader } from './kind';
import { locationLive, sceneLive, setLive, type LiveSource } from './liveView';
import { RelationIndex } from './relationIndex';

// Los decorados adentro de su locación (D818, Docs/Plan_Proyecto_Desde_Cero.md, sección 3): mover no cambia el tipo (la
// marca se escribe antes, con el tipo del lugar de origen), un decorado adentro de una locación se filma ahí, *New set*
// lo crea adentro, y la locación dice qué escenas van ahí en su campo *Escenas*.

const devices: Device[] = [];
afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.docs.dispose();
    d.db.close();
  }
});

let n = 0;
const fakePhoto = async () => `0000${String(++n).padStart(4, '0')}-eeee-4bbb-8ccc-dddddddddddd`;
const owner: GuardPerms = { known: true, projectLevel: () => LEVEL_EDIT_PAGES, canCreateIn: () => true };

/** El proyecto sintético con *Decorados* marcada (sus páginas sin marca propia, como lo importado de Coda) y las marcas de la app. */
async function setup(): Promise<{ d: Device; built: Built; src: () => Promise<LiveSource> }> {
  const d = await makeDevice(new FakeServer());
  devices.push(d);
  const built = await buildProject(d, fakePhoto, { indexPage: false });
  await d.tree.setPatch(built.ids.decorados, { settings: { holds: 'set' } });
  // Lo que hace services.ts (después de armar: las páginas del proyecto quedan sin marca, como las importadas).
  installEntityMarks(d.tree, false);
  await d.engine.syncNow();
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

const entity = (d: Device, id: string) => d.tree.get(id)?.settings?.entity;

describe('mover no cambia el tipo', () => {
  it('un decorado de la carpeta Decorados que entra en su locación sigue siendo decorado (la marca se escribe antes)', async () => {
    const { d, built } = await setup();
    expect(entity(d, built.ids.set_int)).toBeUndefined();
    await d.tree.move(built.ids.set_int, built.ids.arenera);
    expect(d.tree.get(built.ids.set_int)?.parent_id).toBe(built.ids.arenera);
    expect(entity(d, built.ids.set_int)).toEqual({ kind: 'set' });
    expect(kindReader(d.tree).kindOf(built.ids.set_int)).toMatchObject({ kind: 'set', source: 'page' });
    // Sin la marca de antes, adentro de la locación habría quedado como parte de ella (un scouting).
  });

  it('sin el aviso de antes (como estaba), el decorado quedaba como parte de la locación', async () => {
    const { d, built } = await setup();
    d.tree.onBeforeMove = undefined;
    await d.tree.move(built.ids.set_int, built.ids.arenera);
    expect(entity(d, built.ids.set_int)).toBeUndefined();
    expect(kindReader(d.tree).kindOf(built.ids.set_int)).toMatchObject({ kind: 'part', of: built.ids.arenera });
  });

  it('una escena o una locación sin marca que entra en otra entidad sigue siendo lo que era; sacarla de su carpeta, también', async () => {
    const { d, built } = await setup();
    await d.tree.move(built.ids.s008, built.ids.cenade);
    expect(entity(d, built.ids.s008)).toEqual({ kind: 'scene', code: '104_008' });
    expect(kindReader(d.tree).kindOf(built.ids.s008)).toMatchObject({ kind: 'scene', code: '104_008' });
    await d.tree.move(built.ids.arenera, built.ids.s009);
    expect(entity(d, built.ids.arenera)).toEqual({ kind: 'location' });
    // Un episodio entero que sale del desglose: sus escenas quedan marcadas con su número.
    await d.tree.move(built.ids.ep5, null);
    expect(entity(d, built.ids.s027)).toEqual({ kind: 'scene', code: '105_027' });
    expect(entity(d, built.ids.ep5)).toBeUndefined();
    expect(kindReader(d.tree).kindOf(built.ids.s027)).toMatchObject({ kind: 'scene', code: '105_027' });
  });

  it('una página sin número mal archivada en el desglose no se lleva la marca de escena al sacarla', async () => {
    const { d, built } = await setup();
    const id = crypto.randomUUID();
    await d.tree.create(built.ids.desglose, 'Notas sueltas', built.projectId, { id });
    expect(kindReader(d.tree).kindOf(id)).toMatchObject({ kind: 'scene', source: 'folder' });
    await d.tree.move(id, null);
    expect(entity(d, id)).toBeUndefined();
    expect(kindReader(d.tree).kindOf(id).kind).toBe('none');
  });

  it('lo que entra en una entidad del mismo tipo pasa a ser parte de ella: una ficha suelta del desglose que entra en su escena (D785)', async () => {
    const { d, built } = await setup();
    // Importada (id reservado: sin marca) al primer nivel del desglose, donde se lee como escena.
    const id = crypto.randomUUID();
    await d.tree.create(built.ids.desglose, 'PRUEBA_105_027_040 Ambulancia', built.projectId, { id });
    expect(kindReader(d.tree).kindOf(id)).toMatchObject({ kind: 'scene', source: 'folder' });
    await d.tree.move(id, built.ids.s027);
    expect(entity(d, id)).toBeUndefined();
    expect(kindReader(d.tree).kindOf(id)).toMatchObject({ kind: 'part', of: built.ids.s027 });
  });

  it('lo de adentro de una carpeta con tipo va con ella: la carpeta Decorados entera adentro de otra sigue dando decorados', async () => {
    const { d, built } = await setup();
    const preprod = await d.tree.create(null, '1 | Preproducción', built.projectId);
    await d.tree.move(built.ids.decorados, preprod);
    expect(kindReader(d.tree).kindOf(built.ids.set_int)).toMatchObject({ kind: 'set', folder: built.ids.decorados });
  });

  it('un error al fijar la marca no frena el movimiento', async () => {
    const { d, built } = await setup();
    d.tree.onBeforeMove = async () => {
      throw new Error('falla a propósito');
    };
    await d.tree.move(built.ids.set_int, built.ids.arenera);
    expect(d.tree.get(built.ids.set_int)?.parent_id).toBe(built.ids.arenera);
  });
});

describe('un decorado adentro de una locación se filma ahí', () => {
  it('«Se filma en» incluye la locación de arriba, y la locación lo cuenta entre sus decorados (no como scouting)', async () => {
    const { d, built, src } = await setup();
    // Un decorado sin campo Locación: antes no se sabía dónde se filmaba.
    const cabina = await d.tree.create(built.ids.decorados, 'Camioneta | Cabina INT', built.projectId);
    let s = await src();
    expect(setLive(s, cabina).locs).toEqual([]);
    await d.tree.move(cabina, built.ids.cenade);
    await d.tree.move(built.ids.set_int, built.ids.arenera);
    s = await src();
    expect(setLive(s, cabina).locs).toEqual([{ name: 'CENADE', pageId: built.ids.cenade }]);
    // Con su campo, la misma locación no se repite.
    expect(setLive(s, built.ids.set_int).locs).toEqual([{ name: 'La Arenera (estudio)', pageId: built.ids.arenera }]);
    const cenade = locationLive(s, 'CENADE');
    expect(cenade.sets.map((x) => x.pageId)).toEqual(expect.arrayContaining([cabina, built.ids.set_ext, built.ids.set_auto]));
    expect(cenade.scouts.map((x) => x.pageId)).not.toContain(cabina);
    expect(cenade.also.map((x) => x.pageId)).not.toContain(cabina);
    expect(locationLive(s, 'La Arenera (estudio)').sets.map((x) => x.pageId)).toContain(built.ids.set_int);
    // Lo de las escenas no cambia: 105_027 sigue con su decorado por el link de sus fichas.
    expect(sceneLive(s, '105_027').sets.map((x) => x.pageId)).toContain(built.ids.set_int);
  });

  it('adentro de una escena (no una locación) no dice nada de dónde se filma', async () => {
    const { d, built, src } = await setup();
    const cabina = await d.tree.create(built.ids.decorados, 'Camioneta | Cabina INT', built.projectId);
    await d.tree.move(cabina, built.ids.s008);
    const s = await src();
    expect(kindReader(d.tree).kindOf(cabina)).toMatchObject({ kind: 'set' });
    expect(setLive(s, cabina).locs).toEqual([]);
  });
});

describe('New set: el decorado se crea adentro de su locación', () => {
  it('createGuard acepta la locación como lugar; la página queda adentro, marcada como decorado, y se filma ahí', async () => {
    const { d, built, src } = await setup();
    await d.engine.syncNow();
    let current = (await src()).snap;
    const deps = createDepsFrom(d, { projectId: built.projectId, lang: 'es', perms: () => owner, snap: () => current });
    expect(createGuard(deps.context(), { kind: 'set', name: 'Banquina | Noche', in: built.ids.cenade })).toEqual({ ok: true, parentId: built.ids.cenade, title: 'Banquina | Noche' });
    const res = await createEntity(deps, { kind: 'set', name: 'Banquina | Noche', in: built.ids.cenade });
    expect(res).toMatchObject({ ok: true, parentId: built.ids.cenade });
    if (!res.ok) return;
    expect(d.tree.get(res.pageId)?.parent_id).toBe(built.ids.cenade);
    expect(entity(d, res.pageId)).toEqual({ kind: 'set' });
    const s = await src();
    current = s.snap;
    expect(setLive(s, res.pageId).locs).toEqual([{ name: 'CENADE', pageId: built.ids.cenade }]);
    expect(locationLive(s, 'CENADE').sets.map((x) => x.pageId)).toContain(res.pageId);
    // Otra vez el mismo nombre, en otra locación: ya existe.
    expect(createGuard(deps.context(), { kind: 'set', name: 'banquina | noche', in: built.ids.arenera })).toMatchObject({ ok: false, reason: 'exists', pageId: res.pageId });
  });

  it('sin lugar elegido, un decorado nuevo va a la carpeta Decorados aunque una locación tenga más; sin carpeta, no hay dónde', async () => {
    const { d, built, src } = await setup();
    for (const t of ['A | Uno', 'B | Dos', 'C | Tres', 'D | Cuatro']) await d.tree.create(built.ids.cenade, t, built.projectId).then((id) => d.tree.setSetting(id, 'entity', { kind: 'set' }));
    const ctx = async () => ({ tree: d.tree, perms: owner, snap: (await src()).snap, sync: d.engine.getStatus(), projectId: built.projectId });
    expect(createGuard(await ctx(), { kind: 'set', name: 'Quirófano' })).toMatchObject({ ok: true, parentId: built.ids.decorados });
    // Sin la carpeta (sus decorados, sin marca, dejan de serlo), solo quedan los de adentro de la locación: no cuentan.
    await d.tree.setSetting(built.ids.decorados, 'holds', undefined);
    expect(createGuard(await ctx(), { kind: 'set', name: 'Quirófano' })).toEqual({ ok: false, reason: 'noFolder' });
  });
});

describe('la locación dice qué escenas van ahí (campo Escenas)', () => {
  it('cuentan como planeadas ahí en las dos cabeceras; el texto suelto no', async () => {
    const { d, built, src } = await setup();
    await writeBlocks(d, built.ids.cenade, [
      { p: 'Acceso por la autopista. Contacto en la guardia.' },
      { p: 'Escenas: 105_029, 104_009' },
      { p: 'Quizás también la 105_027 si sobra tiempo.' },
    ]);
    const s = await src();
    const cenade = locationLive(s, 'CENADE');
    expect(cenade.planned.map((x) => x.code)).toEqual(expect.arrayContaining(['105_029', '104_009']));
    expect(cenade.planned.map((x) => x.code)).not.toContain('105_027');
    expect(sceneLive(s, '105_029').plannedAt.map((x) => [x.title, x.pageId])).toContainEqual(['CENADE', built.ids.cenade]);
    expect(sceneLive(s, '104_009').plannedAt.map((x) => x.title)).toContain('CENADE');
    // La locación que la nombra en su campo ya está en su renglón: no se repite en *Other*.
    expect(sceneLive(s, '105_029').also.map((x) => x.pageId)).not.toContain(built.ids.cenade);
    // 105_027 está solo en el texto suelto: sigue en *Other*, no planeada ahí por eso.
    expect(sceneLive(s, '105_027').also.map((x) => x.pageId)).toContain(built.ids.cenade);
    expect(sceneLive(s, '105_027').plannedAt.map((x) => x.pageId)).not.toContain(built.ids.cenade);
  });

  it('en un largo, los números pelados («027, 31b») y los links a la escena; un número que no existe no cuenta', async () => {
    const d = await makeDevice(new FakeServer());
    devices.push(d);
    const projectId = await d.tree.createProject('Largo de prueba');
    const escenas = await d.tree.create(null, '1.1 | Escenas', projectId);
    await d.tree.setSetting(escenas, 'holds', 'scene');
    const s027 = await d.tree.create(escenas, '027 | La plaza', projectId);
    const s031 = await d.tree.create(escenas, '031 | El bar', projectId);
    const s040 = await d.tree.create(escenas, '040 | La ruta', projectId);
    const locs = await d.tree.create(null, '1.2 | Locaciones', projectId);
    await d.tree.setSetting(locs, 'holds', 'location');
    const plaza = await d.tree.create(locs, 'Plaza de Mayo', projectId);
    await writeBlocks(d, plaza, [{ table: [['Otros nombres', 'Plaza'], ['Escenas', '027, 31b y 099']] }, { h: 2, text: 'Scenes' }, { p: [{ link: s040, text: '040 | La ruta' }] }]);
    const index = new ProjectIndex(d.tree, d.docs);
    const relations = new RelationIndex(d.tree, index);
    await index.refresh(projectId);
    await relations.update(projectId);
    const snap = relations.snapshot(projectId)!;
    const s: LiveSource = { snap, title: (id) => d.tree.get(id)?.title, content: (id) => index.content(id) };
    expect(locationLive(s, 'Plaza de Mayo').planned.map((x) => [x.code, x.pageId])).toEqual([
      ['027', s027],
      ['031', s031],
      ['040', s040],
    ]);
    expect(sceneLive(s, '031').plannedAt.map((x) => x.pageId)).toEqual([plaza]);
  });
  it('la locación escrita en la escena que no existe se ofrece para crear; una conocida con otra forma o la de una ficha, no', async () => {
    const d = await makeDevice(new FakeServer());
    devices.push(d);
    const projectId = await d.tree.createProject('Corto de prueba');
    const escenas = await d.tree.create(null, '1.1 | Escenas', projectId);
    await d.tree.setSetting(escenas, 'holds', 'scene');
    const locs = await d.tree.create(null, '1.2 | Locaciones', projectId);
    await d.tree.setSetting(locs, 'holds', 'location');
    const estudio = await d.tree.create(locs, 'Estudio Autos', projectId);
    const s001 = await d.tree.create(escenas, '001 | Andén', projectId);
    const s002 = await d.tree.create(escenas, '002 | El auto', projectId);
    const ficha = await d.tree.create(s002, 'Plano 002_010', projectId);
    await writeBlocks(d, s001, [{ table: [['Escena', '001'], ['Locación (planeada)', 'Estación Vieja']] }]);
    // «Estudio | Autos» es la locación «Estudio Autos» con otra forma; «N/A» no es un lugar.
    await writeBlocks(d, s002, [{ table: [['Escena', '002'], ['Locación (planeada)', 'Estudio | Autos\nN/A']] }]);
    // La ficha de un plano dice dónde se filmó: no es una locación para crear.
    await writeBlocks(d, ficha, [{ table: [['Escena', '002'], ['Locación', 'Galpón Sur']] }]);
    const index = new ProjectIndex(d.tree, d.docs);
    const relations = new RelationIndex(d.tree, index);
    await index.refresh(projectId);
    await relations.update(projectId);
    const snap = relations.snapshot(projectId)!;
    const s: LiveSource = { snap, title: (id) => d.tree.get(id)?.title, content: (id) => index.content(id) };
    expect(sceneLive(s, '001').plannedAt.map((x) => [x.title, x.pageId])).toEqual([['Estación Vieja', '']]);
    // Nada para crear en la 002: ni la conocida con otra forma, ni «N/A», ni el «Galpón Sur» de la ficha.
    expect(sceneLive(s, '002').plannedAt.filter((x) => !x.pageId)).toEqual([]);
    expect(estudio).toBeTruthy();
  });
});
