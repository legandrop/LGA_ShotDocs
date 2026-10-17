// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectIndex } from '../search/projectIndex';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import type { PageSettings } from '../sync/types';
import { buildProject, writeBlocks } from './fixtures/proyectoSintetico';
import type { LiveSource } from './liveView';
import { projectMap } from './projectMap';
import type { SceneEntry } from './reader';
import { RelationIndex } from './relationIndex';
import { mapPathFrom, sceneEpisodes, sceneLinks, sceneMapPath, sceneMentions, scenePageCount, sceneSnippet } from './sceneMentions';

// La sección Scenes (Docs/Doc_Relaciones.md, sección 21): la lista de todas las páginas que hablan de una escena, por
// etapa, con el lugar exacto y un extracto; las páginas índice aparte; solo lo que la persona ve; y las escenas por
// episodio de la barra lateral. Con el índice de verdad sobre el proyecto sintético.

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

describe('las páginas que hablan de una escena', () => {
  it('por etapa: la escena y sus fichas, scoutings, días por fecha, otras; las páginas índice aparte, al final', async () => {
    const d = await makeDevice(new FakeServer());
    devices.push(d);
    const built = await buildProject(d, fakePhoto, { days: true });
    const src = await sourceOf(d, built.projectId);
    const m = projectMap(src);
    const list = sceneMentions(m, '105_027', src)!;
    const ids = built.ids;
    expect(list.groups.map((g) => g.id)).toEqual(['scene', 'location', 'shoot', 'other', 'index']);
    const g = Object.fromEntries(list.groups.map((x) => [x.id, x.pages]));
    // La escena primero (aunque su texto no la nombre) y sus fichas.
    expect(g.scene.map((p) => p.pageId)).toEqual([ids.s027, ids.s027_010, ids.s027_020, ids.s027_030]);
    expect(g.scene[0]).toMatchObject({ self: true, own: true, places: [] });
    expect(g.scene.slice(1).every((p) => p.own && !p.self)).toBe(true);
    // Una ficha la nombra en su tabla: el extracto es la fila que la nombra, «rótulo: valor», no la tabla entera.
    expect(g.scene[1].places.map((p) => p.quote)).toEqual(['Shot Name: PRUEBA_105_027_010']);
    // El scouting: la sección de la escena, con su primer renglón como extracto y sus fotos.
    expect(g.location.map((p) => p.pageId)).toEqual([ids.scout]);
    expect(g.location[0].places).toEqual([
      {
        blockId: expect.any(String),
        endBlockId: null,
        label: '(5027b) Ambulancia vuelca',
        quote: expect.stringMatching(/^En el forcejeo la ambulancia pierde el control/),
        photos: 3,
      },
    ]);
    // Los días por fecha, cada uno con su sección (el rótulo del día, no el título entero).
    expect(g.shoot.map((p) => [p.label, p.date])).toEqual([
      ['Día 59', '2026-02-19'],
      ['Día 70', '2026-03-06'],
      ['Día 76', '2026-03-14'],
    ]);
    expect(g.shoot[0].places.map((p) => [p.label, p.quote, p.photos])).toEqual([
      ['Escena 105_027b', 'Tres tomas del vuelco con la ambulancia de doble. Chrome ball y HDRI en la curva.', 5],
    ]);
    // Día 76: dos secciones de la escena, en el orden de la página.
    expect(g.shoot[2].places.map((p) => p.label)).toEqual(['Escena 5-27', 'Escena 5-27A']);
    // Otra página: el bloque que la nombra, con su texto.
    expect(g.other.map((p) => p.pageId)).toEqual([ids.notas]);
    expect(g.other[0].places).toEqual([{ blockId: expect.any(String), label: '', quote: 'Revisar con dirección la 105_027 antes del día 70.', photos: 0 }]);
    expect('endBlockId' in g.other[0].places[0]).toBe(false);
    // La página índice (el plan general nombra 21 escenas y locaciones), aparte; el archivo fuera del grafo, nunca.
    expect(g.index.map((p) => p.pageId)).toEqual([ids.planning]);
    expect(list.indexCount).toBe(1);
    expect(list.groups.flatMap((x) => x.pages).some((p) => p.pageId === ids.archivo)).toBe(false);
    // El número sin las páginas índice, igual que el de la columna Pages.
    expect(list.count).toBe(4 + 1 + 3 + 1);
    const links = sceneLinks(src);
    expect(scenePageCount(m, '105_027', links)).toBe(list.count);
    for (const s of m.scenes) expect(scenePageCount(m, s.code, links), s.code).toBe(sceneMentions(m, s.code, src, { links })!.count);
    // Sin leer el texto: los mismos grupos y páginas, sin lugares.
    const bare = sceneMentions(m, '105_027', src, { excerpts: false })!;
    expect(bare.groups.map((x) => x.pages.map((p) => p.pageId))).toEqual(list.groups.map((x) => x.pages.map((p) => p.pageId)));
    expect(bare.groups.every((x) => x.pages.every((p) => !p.places.length))).toBe(true);
    // Un número que no es una escena.
    expect(sceneMentions(m, '105_999', src)).toBeNull();
  });

  it('un renglón que la nombra adentro de su propia sección no se repite; uno de afuera, sí, en el orden de la página', async () => {
    const d = await makeDevice(new FakeServer());
    devices.push(d);
    const built = await buildProject(d, fakePhoto, { days: false, indexPage: false });
    await writeBlocks(d, built.ids.notas, [
      { p: 'Primero: ver la 105_026 con arte.' },
      { h: 1, text: 'Escena 105_026' },
      { p: 'Repasar la 105_026 en la reunión.' },
      { h: 1, text: 'Otra cosa' },
      { p: 'Y al final otra vez la 105_026.' },
    ]);
    await d.engine.syncNow();
    const src = await sourceOf(d, built.projectId);
    const list = sceneMentions(projectMap(src), '105_026', src)!;
    const notas = list.groups.find((g) => g.id === 'other')!.pages[0];
    expect(notas.places.map((p) => [p.label, p.quote])).toEqual([
      ['', 'Primero: ver la 105_026 con arte.'],
      ['Escena 105_026', 'Repasar la 105_026 en la reunión.'],
      ['', 'Y al final otra vez la 105_026.'],
    ]);
    // La sección termina en el título siguiente (va resaltada entera al abrirla).
    expect(notas.places[1].endBlockId).toEqual(expect.any(String));
  });

  it('un invitado ve solo las páginas que ve', async () => {
    const server = new FakeServer();
    server.enableTeam();
    const owner = await makeDevice(server);
    devices.push(owner);
    const built = await buildProject(owner, fakePhoto, { days: true, indexPage: false });
    await owner.tree.setPatch(built.ids.s027, { settings: { entity: { kind: 'scene', code: '105_027' } } as unknown as PageSettings });
    await owner.tree.setPatch(built.ids.d70, { settings: { entity: { kind: 'day' } } as unknown as PageSettings });
    await owner.engine.syncNow();
    server.addMember('ana', 'member', 'ana@test');
    server.grant('ana', { pageId: built.ids.s027 }, 'view');
    server.grant('ana', { pageId: built.ids.d70 }, 'view');
    const guest = await makeDevice(server, crypto.randomUUID(), '0.021', {}, undefined, { id: 'ana', email: 'ana@test' });
    devices.push(guest);
    await guest.engine.syncNow();
    await guest.engine.syncNow();
    const src = await sourceOf(guest, built.projectId);
    const list = sceneMentions(projectMap(src), '105_027', src)!;
    const pages = list.groups.flatMap((g) => g.pages.map((p) => p.pageId));
    // La escena (con sus fichas, que están adentro) y el único día que ve.
    expect(pages).toContain(built.ids.s027);
    expect(pages).toContain(built.ids.d70);
    for (const k of ['d59', 'd76', 'scout', 'notas', 'cenade']) expect(pages, k).not.toContain(built.ids[k]);
  });
});

describe('links, repetidas, letras y largos (auditoría)', () => {
  it('B1: las páginas que linkean la escena o una ficha suya están, con el bloque del link y su renglón', async () => {
    const d = await makeDevice(new FakeServer());
    devices.push(d);
    const built = await buildProject(d, fakePhoto, { days: true, indexPage: false });
    const { ids, projectId } = built;
    // Un decorado que linkea la ficha (como «Barco transatlántico» en ERSO) y una nota que linkea la escena.
    const deco = await d.tree.create(ids.decorados, 'Barco | Cubierta', projectId);
    await writeBlocks(d, deco, [{ p: 'Cubierta del barco.' }, { table: [['Escenas', [{ link: ids.s027_010, text: 'PRUEBA_105_027_010 Ambulancia' }]], ['Plate', 'Mar']] }]);
    const linkScene = await d.tree.create(null, 'Link a la escena', projectId);
    await writeBlocks(d, linkScene, [{ p: 'Nada que ver.' }, { p: ['Ver ', { link: ids.s027, text: 'La ambulancia' }, ' antes del rodaje.'] }]);
    await d.engine.syncNow();
    const src = await sourceOf(d, projectId);
    const m = projectMap(src);
    const list = sceneMentions(m, '105_027', src)!;
    const all = list.groups.flatMap((g) => g.pages);
    const decoPage = all.find((p) => p.pageId === deco)!;
    expect(decoPage.group).toBe('other');
    expect(decoPage.places.map((p) => p.quote)).toEqual(['Escenas: PRUEBA_105_027_010 Ambulancia']);
    const ls = all.find((p) => p.pageId === linkScene)!;
    expect(ls.places.map((p) => p.quote)).toEqual(['Ver La ambulancia antes del rodaje.']);
    // B3: el decorado entra solo por el link a la ficha (no nombra ninguna escena ni locación, el mapa no lo anota): su
    // título es el del árbol, no «Untitled».
    expect(m.pages.has(deco)).toBe(false);
    expect([decoPage.title, decoPage.label]).toEqual(['Barco | Cubierta', 'Barco | Cubierta']);
    expect([ls.title, ls.label]).toEqual(['Link a la escena', 'Link a la escena']);
    // La cuenta sin leer el texto da lo mismo.
    expect(scenePageCount(m, '105_027', sceneLinks(src))).toBe(list.count);
    // La otra escena, a la que nadie linkea, no recibe esas páginas.
    expect(sceneMentions(m, '105_026', src)!.groups.flatMap((g) => g.pages).some((p) => p.pageId === deco)).toBe(false);
  });

  it('B1: una página que linkea las fichas de más de 20 escenas es índice (va aparte y no cuenta)', async () => {
    const d = await makeDevice(new FakeServer());
    devices.push(d);
    const projectId = await d.tree.createProject('Serie');
    const bd = await d.tree.create(null, 'Desglose', projectId);
    await d.tree.setPatch(bd, { settings: { holds: 'scene' } as PageSettings });
    const ep = await d.tree.create(bd, '101 | Episodio 1', projectId);
    const cards: string[] = [];
    for (let i = 1; i <= 22; i++) {
      const sc = await d.tree.create(ep, `${String(i).padStart(3, '0')} | Escena ${i}`, projectId);
      cards.push(await d.tree.create(sc, `FICHA_${i}`, projectId));
    }
    const decorados = await d.tree.create(null, '1.3 | Decorados', projectId);
    await writeBlocks(d, decorados, cards.map((c, i) => ({ p: [{ link: c, text: `FICHA_${i + 1}` }] })));
    await d.engine.syncNow();
    const src = await sourceOf(d, projectId);
    const m = projectMap(src);
    const links = sceneLinks(src);
    expect(links.index.has(decorados)).toBe(true);
    const list = sceneMentions(m, '101_001', src, { links })!;
    expect(list.groups.find((g) => g.id === 'index')!.pages.map((p) => p.pageId)).toEqual([decorados]);
    expect(list.count).toBe(2);
    expect(scenePageCount(m, '101_001', links)).toBe(2);
  });

  it('B2: una escena en dos páginas: las dos en su grupo, la segunda marcada, y se cuenta', async () => {
    const d = await makeDevice(new FakeServer());
    devices.push(d);
    const built = await buildProject(d, fakePhoto, { days: true, indexPage: false });
    const { ids, projectId } = built;
    const dup = await d.tree.create(ids.ep5, '027 | La ambulancia (copia)', projectId);
    const dupCard = await d.tree.create(dup, 'PRUEBA_105_027_040 Copia', projectId);
    await writeBlocks(d, dup, [{ p: 'Texto de la copia sin número.' }]);
    await writeBlocks(d, dupCard, [{ p: 'Ficha de la copia.' }]);
    await d.engine.syncNow();
    const src = await sourceOf(d, projectId);
    const m = projectMap(src);
    expect(m.duplicates.find((x) => x.code === '105_027')!.pageIds).toEqual([ids.s027, dup]);
    const list = sceneMentions(m, '105_027', src)!;
    const scene = list.groups.find((g) => g.id === 'scene')!.pages;
    expect(scene.slice(0, 2).map((p) => [p.pageId, p.self, p.twin])).toEqual([
      [ids.s027, true, false],
      [dup, true, true],
    ]);
    expect(scene.map((p) => p.pageId)).toContain(dupCard);
    expect(list.scenePages).toBe(2);
    expect(scenePageCount(m, '105_027', sceneLinks(src))).toBe(list.count);
  });

  it('una escena con letra (105_030A) y su forma compacta; el extracto se centra en ella y no en la escena de al lado', async () => {
    const d = await makeDevice(new FakeServer());
    devices.push(d);
    const built = await buildProject(d, fakePhoto, { days: false, indexPage: false });
    const { ids, projectId } = built;
    const letter = await d.tree.create(ids.ep5, '030A | Escena con letra', projectId);
    await writeBlocks(d, letter, [{ p: 'Nada.' }]);
    const nota = await d.tree.create(null, 'Notas sueltas', projectId);
    const filler = 'Plates de ruta para el traslado, con la 105_026 de referencia y bastante texto que no es de esta escena, ';
    await writeBlocks(d, nota, [{ p: `${filler.repeat(2)}y al final la 5030A con el doble.` }]);
    await d.engine.syncNow();
    const src = await sourceOf(d, projectId);
    const m = projectMap(src);
    const list = sceneMentions(m, '105_030A', src)!;
    const n = list.groups.flatMap((g) => g.pages).find((p) => p.pageId === nota)!;
    expect(n.places).toHaveLength(1);
    expect(n.places[0].quote).toContain('5030A');
    expect(n.places[0].quote.startsWith('…')).toBe(true);
    // La 105_026 también está en ese texto: su extracto se centra en la 105_026 (al principio), no en la 5030A.
    const other = sceneMentions(m, '105_026', src)!.groups.flatMap((g) => g.pages).find((p) => p.pageId === nota)!;
    expect(other.places[0].quote.startsWith('Plates de ruta')).toBe(true);
  });

  it('un largo sin episodios (D383): `074`', async () => {
    const d = await makeDevice(new FakeServer());
    devices.push(d);
    const projectId = await d.tree.createProject('Largo');
    const folder = await d.tree.create(null, 'Escenas', projectId);
    await d.tree.setPatch(folder, { settings: { holds: 'scene' } as PageSettings });
    const s074 = await d.tree.create(folder, '074 | La plaza', projectId);
    const card = await d.tree.create(s074, 'LARGO_074_010 Plaza', projectId);
    await writeBlocks(d, card, [{ p: 'Plano general.' }]);
    const notas = await d.tree.create(null, 'Notas', projectId);
    await writeBlocks(d, notas, [{ p: 'La Escena 074 se filma de noche.' }]);
    await d.engine.syncNow();
    const src = await sourceOf(d, projectId);
    const m = projectMap(src);
    const list = sceneMentions(m, '074', src)!;
    expect(list.groups.map((g) => [g.id, g.pages.map((p) => p.pageId)])).toEqual([
      ['scene', [s074, card]],
      ['other', [notas]],
    ]);
    expect(list.groups[1].pages[0].places[0].quote).toBe('La Escena 074 se filma de noche.');
    expect(sceneEpisodes(src.snap.registry.scenes.values(), (id) => d.tree.get(id)?.title)).toEqual([{ ep: '', scenes: [{ code: '074', title: 'La plaza', pageId: s074 }] }]);
  });

  it('volver a la lista desde la vista de una escena: la misma ruta con «?» va con la barra final', () => {
    expect(mapPathFrom('/map/scenes', { pathname: '/map/scenes', search: '?scene=105_027' })).toBe('/map/scenes/');
    expect(mapPathFrom('/map/scenes', { pathname: '/map/scenes/', search: '?scene=105_027' })).toBe('/map/scenes');
    expect(mapPathFrom('/map', { pathname: '/map/scenes', search: '?scene=105_027' })).toBe('/map');
    expect(mapPathFrom('/map/scenes', { pathname: '/map/scenes', search: '' })).toBe('/map/scenes');
  });
});

describe('el extracto', () => {
  it('corto, entero si entra; si no, alrededor de la posición que da el lector, en palabras enteras', () => {
    expect(sceneSnippet('  Revisar   la 105_027 ')).toBe('Revisar la 105_027');
    const long = `${'palabra '.repeat(30)}la Escena 105_027 se filma de noche ${'y después '.repeat(20)}fin`;
    const s = sceneSnippet(long, long.indexOf('105_027'));
    expect(s.length).toBeLessThanOrEqual(112);
    expect(s).toContain('105_027');
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
    // Cortado en palabras enteras.
    const words = ['palabra', 'la', 'Escena', '105_027', 'se', 'filma', 'de', 'noche', 'y', 'después'];
    expect(s.slice(1, -1).split(' ').every((w) => words.includes(w))).toBe(true);
    // Con espacios repetidos antes, la posición se corre igual que el texto.
    const spaced = `${'a     '.repeat(40)}la 105_027 al final`;
    expect(sceneSnippet(spaced, spaced.indexOf('105_027'))).toContain('105_027');
    // Sin posición, el principio.
    expect(sceneSnippet('x '.repeat(100)).startsWith('x x')).toBe(true);
  });
});

describe('las escenas de la barra lateral', () => {
  const entry = (code: string, pageId: string | null = `p${code}`): SceneEntry => {
    const [ep, num] = code.includes('_') ? code.split('_') : ['', code];
    return { code, ep, n: num.slice(0, 3), letter: num.slice(3), pageId };
  };

  it('por episodio y en orden de número, con el título en vivo sin el número', () => {
    const titles: Record<string, string> = { p105_027: '027 | La ambulancia | 105_027', p104_008: '008 | La camioneta', p105_027A: '027A | Interior' };
    const groups = sceneEpisodes([entry('105_027'), entry('104_008'), entry('105_027A'), entry('105_002', null)], (id) => titles[id]);
    expect(groups.map((g) => [g.ep, g.scenes.map((s) => [s.code, s.title])])).toEqual([
      ['104', [['104_008', 'La camioneta']]],
      [
        '105',
        [
          ['105_002', ''],
          ['105_027', 'La ambulancia'],
          ['105_027A', 'Interior'],
        ],
      ],
    ]);
    // Un largo (sin episodios): un solo grupo.
    expect(sceneEpisodes([entry('074'), entry('012')], () => undefined).map((g) => [g.ep, g.scenes.map((s) => s.code)])).toEqual([['', ['012', '074']]]);
    expect(sceneMapPath('105_027A')).toBe('/map/scenes?scene=105_027A');
  });

  it('226 escenas en 9 episodios: agruparlas cuesta menos de 5 ms', () => {
    const list: SceneEntry[] = [];
    for (let e = 1; e <= 9; e++) for (let i = 1; i <= 26 - (e === 9 ? 8 : 0); i++) list.push(entry(`10${e}_${String(i * 3).padStart(3, '0')}`));
    expect(list.length).toBe(226);
    const t0 = performance.now();
    const groups = sceneEpisodes(list.reverse(), (id) => `${id} | Título`);
    const ms = performance.now() - t0;
    expect(groups.length).toBe(9);
    expect(groups.reduce((a, g) => a + g.scenes.length, 0)).toBe(226);
    expect(ms).toBeLessThan(5);
  });
});
