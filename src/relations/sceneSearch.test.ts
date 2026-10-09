import { describe, expect, it } from 'vitest';
import { buildRegistry } from './reader';
import { findEntities, searchLocations, searchScenes, type SearchSource } from './sceneSearch';

// Buscar una escena o una locación por cualquier forma de su número o su nombre (Docs/Doc_Relaciones.md, sección 12):
// el mismo lector que el texto, la escena exacta primero, el episodio de la página abierta antes que los otros.

const TITLES: Record<string, string> = {
  '101_074': '074 | La camioneta frena en la banquina',
  '101_069A': '069A | Puerta del hotel',
  '101_033B': '033B | Pasillo',
  '101_033C': '033C | Pasillo, contraplano',
  '102_027': '027 | El tren llega',
  '104_054A': '054A | Garita',
  '105_027': '027 | La ambulancia empieza a zigzaguear',
  '105_029': '029 | El fugitivo abre los ojos',
  '105_002': '002 | Títulos',
};

function source(codes = Object.keys(TITLES), titles = TITLES): SearchSource {
  const registry = buildRegistry({
    scenes: codes.map((code) => ({ code, pageId: `p-${code}` })),
    locations: [
      { name: 'CENADE', pageId: 'p-cenade' },
      { name: 'La Arenera (estudio)', aliases: ['La Arenera (estudio)', 'La Arenera'], pageId: 'p-arenera' },
      { name: 'Hotel Alvear', pageId: 'p-alvear' },
    ],
  });
  const pages: Record<string, string> = { 'p-cenade': 'CENADE', 'p-arenera': 'La Arenera (estudio)', 'p-alvear': 'Hotel Alvear' };
  for (const c of codes) pages[`p-${c}`] = titles[c] ?? c;
  return { snap: { registry }, title: (id) => pages[id] };
}

const codes = (list: { code: string }[]) => list.map((x) => x.code);

describe('searchScenes: cualquier forma del número, la escena exacta primero', () => {
  const src = source();
  it.each([
    ['101_074', '101_074'],
    ['101-074', '101_074'],
    ['1074', '101_074'],
    ['h1074', '101_074'],
    ['5027', '105_027'],
    ['5027b', '105_027'],
    ['105-027', '105_027'],
    ['105_27', '105_027'],
    ['105 027', '105_027'],
    ['1069A', '101_069A'],
    ['101_069a', '101_069A'],
    ['104_054A', '104_054A'],
  ])('«%s» → %s primero', (q, want) => {
    expect(searchScenes(src, q)[0]?.code).toBe(want);
    expect(searchScenes(src, q)[0]?.pageId).toBe(`p-${want}`);
  });

  it('una escena que existe solo con letra: el número sin letra la encuentra (no queda pendiente)', () => {
    expect(codes(searchScenes(src, '101_069', { loose: false }))).toEqual(['101_069A']);
    expect(codes(searchScenes(src, '1069', { loose: false }))).toEqual(['101_069A']);
    expect(findEntities(src, '104_054').map((e) => [e.kind, e.ref])).toEqual([['scene', '104_054A']]);
  });

  it('«Escena 27» y «27» dentro del episodio de la página; sin episodio, en todos (por orden)', () => {
    expect(codes(searchScenes(src, 'Escena 27', { ep: '105', loose: false }))).toEqual(['105_027']);
    expect(searchScenes(src, 'Escena 27', { ep: '105' })[0].why).toBe('episode');
    expect(codes(searchScenes(src, 'Escena 27', { loose: false }))).toEqual(['102_027', '105_027']);
    expect(codes(searchScenes(src, '27', { ep: '105', loose: false }))).toEqual(['105_027', '102_027']);
    expect(codes(searchScenes(src, 'esc 27', { ep: '102', loose: false }))).toEqual(['102_027']);
  });

  it('continuaciones del lector: 1033B+C nombra las dos', () => {
    expect(codes(searchScenes(src, '1033B+C', { loose: false }))).toEqual(['101_033B', '101_033C']);
  });

  it('con `loose`: después los dígitos y después el título; `near` y el episodio primero', () => {
    const list = searchScenes(src, '02', { ep: '105' });
    // «02» es la escena 2 del episodio de la página (exacta); después, los códigos con esos dígitos.
    expect(list[0]).toMatchObject({ code: '105_002', why: 'episode' });
    expect(list[1]).toMatchObject({ code: '105_027', why: 'digits' });
    expect(codes(searchScenes(src, '02', { near: ['102_027'] })).slice(0, 2)).toEqual(['105_002', '102_027']);
    expect(codes(searchScenes(src, 'zigza'))).toEqual(['105_027']);
    expect(searchScenes(src, 'zigza')[0].title).toBe('La ambulancia empieza a zigzaguear');
    // Sin `loose` (la lupa): solo lo exacto; el título de una escena ya sale en las páginas.
    expect(searchScenes(src, 'zigza', { loose: false })).toEqual([]);
  });

  it('lo que no es un número de escena no trae escenas exactas', () => {
    for (const q of ['camara', '3D', 'Av. Suárez 2095', '']) expect(searchScenes(src, q, { loose: false }), q).toEqual([]);
  });

  it('un largo sin episodios: «74», «Escena 69» y «074»', () => {
    const flat = source(['074', '069A', '120'], { '074': '074 | Cocina', '069A': '069A | Patio', '120': '120 | Plaza' });
    expect(codes(searchScenes(flat, '74', { loose: false }))).toEqual(['074']);
    expect(codes(searchScenes(flat, 'Escena 69', { loose: false }))).toEqual(['069A']);
    expect(codes(searchScenes(flat, '074', { loose: false }))).toEqual(['074']);
    expect(codes(searchScenes(flat, 'Sc. 120', { loose: false }))).toEqual(['120']);
  });

  it('solo lo que ve la persona: una escena del registro sin página visible va sin página ni título', () => {
    const src2 = source();
    const hidden: SearchSource = { snap: src2.snap, title: (id) => (id === 'p-105_027' ? undefined : src2.title(id)) };
    expect(searchScenes(hidden, '5027')[0]).toMatchObject({ code: '105_027', pageId: null, title: '' });
  });
});

describe('searchLocations', () => {
  const src = source();
  it('por nombre entero, por alias, por el principio y por una parte', () => {
    expect(searchLocations(src, 'cenade').map((l) => [l.name, l.why])).toEqual([['CENADE', 'name']]);
    expect(searchLocations(src, 'CENAD').map((l) => l.name)).toEqual(['CENADE']);
    expect(searchLocations(src, 'arenera').map((l) => l.name)).toEqual(['La Arenera (estudio)']);
    expect(searchLocations(src, 'alv').map((l) => [l.name, l.why])).toEqual([['Hotel Alvear', 'contains']]);
    expect(searchLocations(src, 'x')).toEqual([]);
    // Menos de 3 letras, nada (con «la» o «de» subía media lista); y solo por el principio de una palabra (O5).
    expect(searchLocations(src, 'la')).toEqual([]);
    expect(searchLocations(src, 'ena')).toEqual([]);
    expect(searchLocations(src, 'are').map((l) => l.name)).toEqual(['La Arenera (estudio)']);
  });
});

describe('searchLocations con los otros nombres escritos (D536, B1 de la auditoría de E10)', () => {
  // Como en ERSO: «Arenera» escrito (una palabra: vale donde se espera un lugar) y «Estudio» (genérico: solo como parte
  // entera). La lupa lee lo buscado como un lugar.
  const registry = buildRegistry({
    scenes: [],
    locations: [
      { name: 'La Arenera (estudio)', aliases: ['La Arenera'], dayTitleAliases: ['Arenera'], wholeAliases: ['Estudio'], pageId: 'p-arenera' },
      { name: 'Estudio UnFilm', pageId: 'p-unfilm' },
    ],
  });
  const pages: Record<string, string> = { 'p-arenera': 'La Arenera (estudio)', 'p-unfilm': 'Estudio UnFilm' };
  const src: SearchSource = { snap: { registry }, title: (id) => pages[id] };
  const names = (q: string) => searchLocations(src, q).map((l) => l.name);

  it('un nombre de una palabra dentro de la búsqueda lleva a su locación', () => {
    expect(names('Arenera VA')).toEqual(['La Arenera (estudio)']);
    expect(findEntities(src, 'Arenera VA').map((e) => [e.kind, e.ref])).toEqual([['loc', 'La Arenera (estudio)']]);
  });

  it('el genérico cuenta solo como parte entera', () => {
    expect(names('Estudio UnFilm')).toEqual(['Estudio UnFilm']);
    expect(names('Estudio | Autos')).toEqual(['La Arenera (estudio)']);
    expect(names('estudio de sonido')).not.toContain('La Arenera (estudio)');
  });
});

describe('findEntities (la lupa ⌘K)', () => {
  const src = source();
  it('escenas, pendientes y locaciones, sin repetir, con la escena primero', () => {
    expect(findEntities(src, '101-074').map((e) => [e.kind, e.ref, e.pageId])).toEqual([['scene', '101_074', 'p-101_074']]);
    // Un número que no existe va solo si alguna página lo nombra (está en Map › Pending).
    expect(findEntities(src, '105_120', { named: new Set(['105_120']) }).map((e) => [e.kind, e.ref])).toEqual([['pending', '105_120']]);
    expect(findEntities(src, '105_120')).toEqual([]);
    expect(findEntities(src, 'cenade').map((e) => [e.kind, e.ref])).toEqual([['loc', 'CENADE']]);
    expect(findEntities(src, '5027 cenade').map((e) => [e.kind, e.ref])).toEqual([
      ['scene', '105_027'],
      ['loc', 'CENADE'],
    ]);
    expect(findEntities(src, 'camioneta')).toEqual([]);
  });

  it('un proyecto sin escenas ni locaciones no busca nada', () => {
    const empty: SearchSource = { snap: { registry: buildRegistry({ scenes: [], locations: [] }) }, title: () => undefined };
    expect(findEntities(empty, '1074')).toEqual([]);
  });
});
