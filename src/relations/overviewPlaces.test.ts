import { describe, expect, it } from 'vitest';
import { fakeTree } from './kindTesting';
import { exportPlan } from '../export/exportPages';
import { fichaBranch, fichaOf, folderPlace, overviewPlaces, routeOf } from './overviewPlaces';
import { buildRegistry } from './reader';
import { registerProject } from './register';

// Dónde vive cada página en la barra (Plan_Fichas_Cuaderno.md, parte 1; D813): las fichas en el *Overview*, y *Pages*
// esconde solo lo que el *Overview* muestra.

type Specs = Parameters<typeof fakeTree>[0];

function places(specs: Specs) {
  const base = fakeTree(specs);
  // Como el árbol de la app: una fila cuya madre no está en el dispositivo (un invitado) es una raíz.
  const tree = { ...base, roots: () => [...base.rows.values()].filter((r) => !r.parent_id || !base.rows.has(r.parent_id)) };
  const reg = registerProject(tree, 'p');
  const snap = { registry: buildRegistry({ scenes: reg.scenes, locations: reg.locations }), registration: reg };
  return { tree: base, p: overviewPlaces(snap, tree) };
}

/** VLLF como está: un largo sin episodios, con notas sueltas en Preproducción. */
const VLLF: Specs = [
  { id: 'pre', title: '1 | Preproducción' },
  { id: 'reunion', parent: 'pre', title: 'Reunión con dirección' },
  { id: 'desglose', parent: 'pre', title: '1.1 | Desglose', settings: { holds: 'scene' } },
  { id: 'e040', parent: 'desglose', title: '040 | Rubio' },
  { id: 'e059', parent: 'desglose', title: '059 | Puente' },
  { id: 'anexo', parent: 'e059', title: 'Anexo' },
  { id: 'locs', parent: 'pre', title: '1.2 | Locaciones', settings: { holds: 'location' } },
  { id: 'puentes', parent: 'locs', title: '7 Puentes' },
  { id: 'decos', parent: 'pre', title: '1.3 | Decorados', settings: { holds: 'set' } },
  { id: 'larralde', parent: 'decos', title: 'Puente Larralde' },
  { id: 'rodaje', title: '5 | Rodaje', settings: { dayReports: {} } },
  { id: 'd40', parent: 'rodaje', title: '2026-05-12 | Día 40 | 7 Puentes' },
];

describe('overviewPlaces', () => {
  it('las fichas van al Overview con su parte; Pages esconde las fichas y las carpetas que quedan vacías', () => {
    const { p } = places(VLLF);
    expect(Object.fromEntries(p.fichas)).toEqual({
      e040: { part: 'scenes', ep: '' },
      e059: { part: 'scenes', ep: '' },
      puentes: { part: 'locations', ep: null },
      larralde: { part: 'sets', ep: null },
    });
    expect([...p.hidden].sort()).toEqual(['decos', 'desglose', 'e040', 'e059', 'larralde', 'locs', 'puentes']);
    // Cada carpeta escondida, con su parte: el ⋯ de la parte lleva a ella.
    expect(Object.fromEntries(p.folders)).toEqual({ scenes: ['desglose'], locations: ['locs'], sets: ['decos'] });
    // Lo de adentro de una ficha no se esconde aparte: va con ella. Las notas, los días y la carpeta de arriba quedan.
    for (const id of ['anexo', 'pre', 'reunion', 'rodaje', 'd40']) expect(p.hidden.has(id)).toBe(false);
  });

  it('ninguna página queda sin lugar: lo que el Overview no lista sigue en Pages, y su carpeta también', () => {
    const { p } = places([
      ...VLLF,
      // Sin número: no es una fila del Overview.
      { id: 'sinnum', parent: 'desglose', title: 'Notas del desglose' },
      // El mismo número dos veces: la segunda la une *Pending*.
      { id: 'e040b', parent: 'desglose', title: '040 | Rubio (otra)' },
      // Fuera de las relaciones.
      { id: 'viejas', parent: 'locs', title: 'Viejas', settings: { graph: false } },
      { id: 'vieja', parent: 'viejas', title: 'Bar Comet' },
    ]);
    for (const id of ['sinnum', 'e040b', 'viejas', 'vieja']) expect(p.hidden.has(id)).toBe(false);
    expect(p.hidden.has('desglose')).toBe(false);
    expect(p.hidden.has('locs')).toBe(false);
    expect(p.hidden.has('e040')).toBe(true);
    expect(p.hidden.has('decos')).toBe(true);
  });

  it('una serie: las escenas con su episodio, y el episodio se esconde con su carpeta', () => {
    const { p } = places([
      { id: 'desglose', title: '1.1 | Desglose', settings: { holds: 'scene' } },
      { id: 'ep105', parent: 'desglose', title: '105 | Episodio 5' },
      { id: 'e027', parent: 'ep105', title: '027 | Zigzag' },
      { id: 'ficha', parent: 'e027', title: 'ERSO_105_027_010 Ambulancia' },
      { id: 'ep106', parent: 'desglose', title: '106 | Episodio 6' },
      { id: 'e001', parent: 'ep106', title: '001 | Inicio' },
      { id: 'suelta', parent: 'ep106', title: 'Notas del 106' },
    ]);
    expect(p.fichas.get('e027')).toEqual({ part: 'scenes', ep: '105' });
    expect(p.fichas.get('e001')).toEqual({ part: 'scenes', ep: '106' });
    expect(p.hidden.has('ep105')).toBe(true);
    // Las carpetas escondidas, para el ⋯ de su episodio: la del 106 no (queda en Pages), ni la de escenas.
    expect(Object.fromEntries(p.episodes)).toEqual({ '105': 'ep105' });
    expect(p.folders.get('scenes')).toBeUndefined();
    // Un episodio con algo que no es escena queda, y la carpeta de escenas con él.
    expect(p.hidden.has('ep106')).toBe(false);
    expect(p.hidden.has('desglose')).toBe(false);
  });

  it('cada carpeta escondida tiene su ⋯: dos de la misma parte, o dos grupos del mismo episodio, quedan en Pages', () => {
    const { p } = places([
      { id: 'a', title: 'Escenas A', settings: { holds: 'scene' } },
      { id: 'a1', parent: 'a', title: '001 | Uno' },
      { id: 'b', title: 'Escenas B', settings: { holds: 'scene' } },
      { id: 'b2', parent: 'b', title: '002 | Dos' },
      { id: 'locs', title: 'Locaciones', settings: { holds: 'location' } },
      { id: 'cenade', parent: 'locs', title: 'CENADE' },
    ]);
    expect(p.hidden.has('a1')).toBe(true);
    expect(p.hidden.has('a')).toBe(false);
    expect(p.hidden.has('b')).toBe(false);
    expect(p.folders.get('scenes')).toBeUndefined();
    expect(p.folders.get('locations')).toEqual(['locs']);
    expect(folderPlace(p, 'locs')).toEqual({ part: 'locations', ep: null });
    expect(folderPlace(p, 'a')).toBeNull();
    expect(folderPlace(p, 'cenade')).toBeNull();
    const serie = places([
      { id: 'desglose', title: '1.1 | Desglose', settings: { holds: 'scene' } },
      { id: 'g1', parent: 'desglose', title: '105 | Episodio 5' },
      { id: 'e1', parent: 'g1', title: '001 | Uno' },
      { id: 'g2', parent: 'desglose', title: 'EP 105' },
      { id: 'e2', parent: 'g2', title: '002 | Dos' },
    ]).p;
    // Dos grupos del 105: los dos quedan en Pages, y con ellos su carpeta.
    expect(serie.hidden.has('g1')).toBe(false);
    expect(serie.hidden.has('g2')).toBe(false);
    expect(serie.hidden.has('desglose')).toBe(false);
    expect(serie.hidden.has('e1')).toBe(true);
  });

  it('un invitado que ve una sola escena (sin su carpeta) la ve en el Overview y no en Pages', () => {
    // La madre no está en el dispositivo: la fila llega sola, con su marca.
    const { p } = places([{ id: 'e059', parent: 'desglose-que-no-ve', title: '059 | Puente', settings: { entity: { kind: 'scene', code: '059' } } }]);
    expect(p.fichas.get('e059')).toEqual({ part: 'scenes', ep: '' });
    expect(p.hidden.has('e059')).toBe(true);
  });

  it('una ficha marcada a mano en cualquier lugar se va al Overview; la carpeta de una nota no se esconde', () => {
    const { p } = places([
      { id: 'notas', title: 'Notas' },
      { id: 'loc', parent: 'notas', title: 'Casa Rosada', settings: { entity: { kind: 'location' } } },
    ]);
    expect(p.hidden.has('loc')).toBe(true);
    expect(p.hidden.has('notas')).toBe(false);
  });

  it('fichaOf y fichaBranch: la ficha de una página y sus madres adentro de ella', () => {
    const { tree, p } = places([...VLLF, { id: 'sub', parent: 'anexo', title: 'Fotos' }]);
    const t = { ...tree, ancestors: (id: string) => {
      const out = [];
      for (let r = tree.get(tree.get(id)?.parent_id ?? ''); r; r = r.parent_id ? tree.get(r.parent_id) : undefined) out.unshift(r);
      return out;
    } };
    expect(fichaOf(p, t, 'sub')).toBe('e059');
    expect(fichaOf(p, t, 'e059')).toBe('e059');
    expect(fichaOf(p, t, 'd40')).toBeNull();
    expect(fichaOf(null, t, 'sub')).toBeNull();
    expect(fichaBranch(t as never, 'e059', 'sub')).toEqual(['e059', 'anexo']);
    expect(fichaBranch(t as never, 'e059', 'e059')).toEqual([]);
  });

  it('la ruta de una ficha es la del Overview, en la pantalla y en lo exportado (sin nada de arriba de la raíz)', () => {
    const { tree, p } = places([...VLLF, { id: 'sub', parent: 'anexo', title: 'Fotos' }]);
    const t = {
      ...tree,
      roots: () => tree.children(null),
      isTrashed: () => false,
      resolveSetting: () => null,
      ancestors: (id: string) => {
        const out = [];
        for (let r = tree.get(tree.get(id)?.parent_id ?? ''); r; r = r.parent_id ? tree.get(r.parent_id) : undefined) out.unshift(r);
        return out;
      },
    };
    const label = (s: ReturnType<typeof routeOf>[number]) => ('page' in s ? s.page.title : `[${s.part ?? 'overview'}]`);
    expect(routeOf(t, p, 'sub').map(label)).toEqual(['[overview]', '[scenes]', '059 | Puente', 'Anexo']);
    expect(routeOf(t, p, 'e059').map(label)).toEqual(['[overview]', '[scenes]']);
    // Lo que vive en *Pages* dice sus carpetas, como siempre.
    expect(routeOf(t, p, 'd40').map(label)).toEqual(['5 | Rodaje']);
    const route = { places: p, partLabel: (part: string | null) => `[${part ?? 'overview'}]` };
    const header = (kind: 'page' | 'project', target: string) =>
      Object.fromEntries(exportPlan(t as never, kind, target, route).map((page) => [page.id, page.header]));
    // El proyecto: la ficha con «Overview · Scenes» (dos niveles, como en la pantalla), nunca «1.1 | Desglose».
    const all = header('project', 'p');
    expect(all.e059).toEqual(['[overview]', '[scenes]']);
    expect(all.sub).toEqual(['059 | Puente', 'Anexo']);
    expect(all.d40).toEqual(['5 | Rodaje']);
    // La ficha como raíz de lo exportado: nada de arriba (regla 2), tampoco el *Overview*.
    const branch = header('page', 'e059');
    expect(branch.e059).toEqual([]);
    expect(branch.anexo).toEqual(['059 | Puente']);
    // Sin la ruta (los bancos de prueba), como antes.
    expect(exportPlan(t as never, 'project', 'p').find((page) => page.id === 'e059')?.header).toEqual(['1 | Preproducción', '1.1 | Desglose']);
  });
});
