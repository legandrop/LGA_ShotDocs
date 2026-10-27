// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectIndex } from '../search/projectIndex';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { buildProject, writeBlocks, type Built } from './fixtures/proyectoSintetico';
import { kindReader } from './kind';
import { locationLive, sceneLive, setIndex, setLive, type LiveSource } from './liveView';
import { RelationIndex } from './relationIndex';

// El decorado como entidad (Docs/Plan_Estructura_Etapas.md, parte 4, D804): la carpeta *Decorados* marcada con
// Type › Sets vuelve decorado cada página de adentro; se nombra solo por campo o por link, nunca por texto suelto.

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

async function setup(mark = true): Promise<{ d: Device; built: Built; src: () => Promise<LiveSource> }> {
  const d = await makeDevice(new FakeServer());
  devices.push(d);
  const built = await buildProject(d, fakePhoto, { indexPage: false });
  if (mark) await d.tree.setPatch(built.ids.decorados, { settings: { holds: 'set' } });
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

describe('el decorado como entidad', () => {
  it('Type › Sets en la carpeta: cada página de adentro es un decorado, con su nombre', async () => {
    const { d, built, src } = await setup();
    expect(kindReader(d.tree).kindOf(built.ids.set_int)).toMatchObject({ kind: 'set' });
    const s = await src();
    expect(s.snap.registration.sets.map((x) => x.name)).toEqual(['Ambulancia | Ruta INT', 'Ambulancia | Ruta EXT', 'Camioneta | Banquina']);
    expect(setIndex(s).rows.map((r) => r.pageId)).toEqual([built.ids.set_int, built.ids.set_ext, built.ids.set_auto]);
  });

  it('sin marcar la carpeta, nada cambia: no hay decorados y las locaciones siguen mostrando los suyos (D424)', async () => {
    const { built, src } = await setup(false);
    const s = await src();
    expect(s.snap.registration.sets).toEqual([]);
    expect(locationLive(s, 'La Arenera (estudio)').sets.map((x) => x.pageId)).toContain(built.ids.set_int);
  });

  it('la cabecera: sus escenas (por el link de las fichas), dónde se filma y los días de esas escenas', async () => {
    const { built, src } = await setup();
    const s = await src();
    const v = setLive(s, built.ids.set_int);
    expect(v.name).toBe('Ambulancia | Ruta INT');
    expect(v.scenes.map((x) => x.code)).toContain('105_027');
    expect(v.locs).toEqual([{ name: 'La Arenera (estudio)', pageId: built.ids.arenera }]);
    // Los días salen de los reportes con sección de sus escenas.
    const days = sceneLive(s, '105_027').days.map((x) => x.day.pageId);
    expect(v.days.map((x) => x.day.pageId).every((id) => days.includes(id))).toBe(true);
    expect(v.days.length).toBeGreaterThan(0);
  });

  it('las dos cabeceras dicen lo mismo: la locación lista sus decorados también marcados', async () => {
    const { built, src } = await setup();
    const s = await src();
    expect(locationLive(s, 'La Arenera (estudio)').sets.map((x) => x.pageId)).toContain(built.ids.set_int);
    expect(locationLive(s, 'CENADE').sets.map((x) => x.pageId)).toEqual(expect.arrayContaining([built.ids.set_ext, built.ids.set_auto]));
    // Y la escena, su renglón *Set*.
    expect(sceneLive(s, '105_027').sets.map((x) => x.pageId)).toContain(built.ids.set_int);
  });

  it('se nombra por el valor entero de un campo o por uno de sus otros nombres; el texto suelto no cuenta', async () => {
    const { d, built, src } = await setup();
    await writeBlocks(d, built.ids.set_auto, [{ table: [['Locacion Real', 'CENADE'], ['Otros nombres', 'Banquina']] }]);
    const byField = await d.tree.create(null, 'Notas de arte', built.projectId);
    await writeBlocks(d, byField, [{ table: [['Decorado', 'Camioneta | Banquina']] }]);
    const byAlias = await d.tree.create(null, 'Lista de utilería', built.projectId);
    await writeBlocks(d, byAlias, [{ table: [['Decorado', 'Banquina']] }]);
    const loose = await d.tree.create(null, 'Charla con arte', built.projectId);
    await writeBlocks(d, loose, [{ p: 'Hablamos de la Camioneta | Banquina y del Comedor.' }]);
    const partial = await d.tree.create(null, 'Otra nota', built.projectId);
    await writeBlocks(d, partial, [{ table: [['Decorado', 'Camioneta | Banquina y algo más']] }]);
    const s = await src();
    const v = setLive(s, built.ids.set_auto);
    expect(v.aliases).toEqual(['Banquina']);
    const also = v.also.map((x) => x.pageId);
    expect(also).toEqual(expect.arrayContaining([byField, byAlias]));
    expect(also).not.toContain(loose);
    expect(also).not.toContain(partial);
  });

  it('un nombre que escribieron dos decorados no es de ninguno', async () => {
    const { d, built, src } = await setup();
    await writeBlocks(d, built.ids.set_int, [{ table: [['Locacion Real', 'La Arenera'], ['Otros nombres', 'Ambulancia']] }]);
    await writeBlocks(d, built.ids.set_ext, [{ table: [['Locacion Real', 'CENADE'], ['Otros nombres', 'Ambulancia']] }]);
    const s = await src();
    expect(setIndex(s).named('Ambulancia')).toBeNull();
    expect(setIndex(s).named('Ambulancia | Ruta EXT')).toBe(built.ids.set_ext);
  });

  it('la locación no repite en Also named in un decorado que ya está en su renglón Sets', async () => {
    const { d, built, src } = await setup();
    await writeBlocks(d, built.ids.set_int, [{ table: [['Locacion Real', 'La Arenera']] }, { p: 'También se probó en CENADE.' }]);
    await writeBlocks(d, built.ids.cenade, [{ table: [['Decorados', 'Ambulancia | Ruta INT']] }]);
    const v = locationLive(await src(), 'CENADE');
    expect(v.sets.some((x) => x.pageId === built.ids.set_int)).toBe(true);
    expect(v.also.some((x) => x.pageId === built.ids.set_int)).toBe(false);
  });

  it('una locación que nombra más de 20 escenas sigue diciendo su decorado, y el decorado la lista', async () => {
    const { d, built, src } = await setup();
    const codes: string[] = [];
    for (let i = 40; i < 63; i++) {
      await d.tree.create(built.ids.ep5, `${i} | escena ${i}`, built.projectId);
      codes.push(`105_0${i}`);
    }
    await writeBlocks(d, built.ids.cenade, [{ table: [['Decorados', 'Ambulancia | Ruta INT']] }, { p: codes.join(', ') }]);
    const s = await src();
    expect(locationLive(s, 'CENADE').sets.some((x) => x.pageId === built.ids.set_int)).toBe(true);
    expect(setLive(s, built.ids.set_int).locs.some((l) => l.name === 'CENADE')).toBe(true);
  });

  it('una página adentro de un decorado que nombra la escena no se repite en Also named in', async () => {
    const { d, built, src } = await setup();
    const inner = await d.tree.create(built.ids.set_ext, 'Notas del decorado', built.projectId);
    await writeBlocks(d, inner, [{ p: 'Acá va la 105_027.' }]);
    const v = sceneLive(await src(), '105_027');
    expect(v.sets.some((x) => x.pageId === built.ids.set_ext)).toBe(true);
    expect(v.also.some((x) => x.pageId === inner)).toBe(false);
  });

  it('una marca de decorado se lee como decorado; una de otra versión más nueva sigue siendo «otro tipo»', async () => {
    const { d, built } = await setup(false);
    await d.tree.setPatch(built.ids.set_ext, { settings: { entity: { kind: 'set' } } });
    expect(kindReader(d.tree).kindOf(built.ids.set_ext)).toMatchObject({ kind: 'set' });
    await d.tree.setPatch(built.ids.set_auto, { settings: { entity: { kind: 'vehicle' } as never } });
    expect(kindReader(d.tree).kindOf(built.ids.set_auto).kind).not.toBe('set');
  });
});
