import { describe, expect, it } from 'vitest';
import { buildRegistry, foldSameLength, scan, sceneCode, type Registry, type ScanContext } from './reader';

// El lector de escenas y locaciones (Docs/Doc_Relaciones.md, sección 2). Las tablas de la propuesta D (sección 6) y de
// la auditoría técnica (secciones 5 y 10: los 25 casos para romperlo), con escenas inventadas que imitan las de ERSO.

/** Una serie con episodios 101…105, las escenas con letra de ERSO y algunas más. */
const SERIES = [
  '101_013', '101_014', '101_016A', '101_016B', '101_033', '101_033B', '101_033C', '101_067', '101_068', '101_069A',
  '101_074', '102_012', '102_014', '102_063', '102_065', '102_095', '103_045', '103_046', '104_005A', '104_019B',
  '104_054A', '105_025', '105_026', '105_027', '105_029', '105_055', '105_058', '105_070', '105_071', '105_072',
];
const series = buildRegistry({
  scenes: SERIES.map((code) => ({ code })),
  locations: [
    { name: 'CENADE', aliases: ['CENADE', 'Centro Nacional'] },
    { name: 'La Arenera', aliases: ['La Arenera', 'Arenera'] },
    { name: 'Estudio Arenas', aliases: ['Estudio'] },
  ],
});

/** Lo que reconoce, como texto corto: `101_074`, `101_074(C)`, `pending 105_120`, `loc CENADE`. */
function read(R: Registry, text: string, ctx: ScanContext = {}): string {
  return (
    scan(R, text, ctx)
      .map((h) => `${h.kind === 'pending' ? 'pending ' : h.kind === 'loc' ? 'loc ' : ''}${h.ref}${h.part ? `(${h.part})` : ''}`)
      .join(' ') || '—'
  );
}
const both = (R: Registry, text: string, ctx: ScanContext = {}) => [read(R, text, ctx), read(R, text, { ...ctx, heading: true })];

describe('sceneCode', () => {
  it('pasa cualquier forma de escribir un código a la canónica', () => {
    expect(sceneCode('101_074')).toBe('101_074');
    expect(sceneCode('101-74a')).toBe('101_074A');
    expect(sceneCode(' 101 - 069A ')).toBe('101_069A');
    expect(sceneCode('74')).toBe('074');
    expect(sceneCode('069a')).toBe('069A');
    expect(sceneCode('0')).toBeNull();
    expect(sceneCode('1074')).toBeNull();
    expect(sceneCode('Escena 5')).toBeNull();
  });
});

describe('lector de escenas en una serie (S4, sección 6)', () => {
  it.each([
    // [texto, en el texto, en un título]
    ['Escena 101_074', '101_074', '101_074'],
    ['101-074', '101_074', '101_074'],
    ['101_074', '101_074', '101_074'],
    ['Escena 1074C', '101_074(C)', '101_074(C)'],
    ['la 1074 se pasa', '—', '—'],
    ['105_70-72', '105_070 105_071 105_072', '105_070 105_071 105_072'],
    ['103_045/46', '103_045 103_046', '103_045 103_046'],
    ['Escena 2012+14', '102_012 102_014', '102_012 102_014'],
    ['Escena 104_019B', '104_019B', '104_019B'],
    ['Escena 101_069A Puerta Adlon', '101_069A', '101_069A'],
    ['Escena 104_054A', '104_054A', '104_054A'],
    ['Escena 1016A1', '101_016A', '101_016A'],
    ['Escena 1033B+C', '101_033B 101_033C', '101_033B 101_033C'],
    ['0116B', '—', '101_016B'],
    ['0168', '—', '101_068'],
    ['H1067', '101_067', '101_067'],
    ['2065A_PD', '102_065(A)', '102_065(A)'],
    ['Escena h2063A', '102_063(A)', '102_063(A)'],
    ['Escena 4-5A', '104_005A', '104_005A'],
    ['Av. Suárez 2095', '—', '—'],
    ['en 2025 filmamos', '—', '—'],
    ['2025-11-26', '—', '—'],
    ['3500 nits', '—', '—'],
    ['Libertador 2897', '—', '—'],
    ['https://drive.google.com/x/1653Rr', '—', '—'],
    ['105_026ial', '—', '—'],
    ['Escena 105_120', 'pending 105_120', 'pending 105_120'],
  ])('«%s»', (text, inText, inHeading) => {
    expect(both(series, text)).toEqual([inText, inHeading]);
  });

  it('las formas de la sección 4 de la propuesta', () => {
    expect(read(series, 'Hoy: 105_027A + 029B')).toBe('105_027(A) 105_029(B)');
    expect(read(series, 'ERSO_105_027_010')).toBe('105_027');
    expect(read(series, 'Fotos de 5027b')).toBe('105_027(B)');
    expect(read(series, '5-27A', { heading: true })).toBe('105_027(A)');
    expect(read(series, 'Escena 5-27A')).toBe('105_027(A)');
    expect(read(series, '5-27A')).toBe('—');
    expect(read(series, '1074 plano 3')).toBe('101_074');
    expect(read(series, 'Escena 1013 + 1014')).toBe('101_013 101_014');
    expect(read(series, '1013 + 1014')).toBe('—');
  });

  it('«Esc 27» solo dentro de su episodio', () => {
    expect(read(series, 'Esc 27 queda para mañana')).toBe('—');
    expect(read(series, 'Esc 27 queda para mañana', { ep: '105' })).toBe('105_027');
    expect(read(series, 'Escena 27B', { ep: '105' })).toBe('105_027(B)');
    expect(read(series, 'Sc. 99', { ep: '105' })).toBe('pending 105_099');
    // «disc» no es «sc» (D385).
    expect(read(series, 'el disc 27', { ep: '105' })).toBe('—');
  });

  it('una escena con letra nunca se pliega a la base, y no hay pendiente si existe con letra', () => {
    expect(read(series, 'Escena 101_016')).toBe('—');
    expect(read(series, 'Escena 104_054')).toBe('—');
    expect(read(series, 'Escena 101_016B')).toBe('101_016B');
    expect(read(series, 'Escena 101_016C')).toBe('—');
  });

  it('el rango marca las escenas del medio como ocultas (cuentan, no se dibujan aparte)', () => {
    const hits = scan(series, '105_70-72');
    expect(hits.map((h) => [h.ref, !!h.hidden])).toEqual([
      ['105_070', false],
      ['105_071', true],
      ['105_072', false],
    ]);
  });

  it('da las posiciones en el texto original', () => {
    const text = 'Ayer Escena 1074C y H1067.';
    for (const h of scan(series, text)) expect(text.slice(h.s, h.e)).toMatch(/^(1074C|H1067)$/);
  });
});

describe('el dígito de la forma compacta sale de los episodios que existen', () => {
  it('episodios 201…', () => {
    const R = buildRegistry({ scenes: [{ code: '201_005' }], locations: [] });
    expect(read(R, 'Escena 1005')).toBe('201_005');
  });
  it('301 y 302 van cada uno a lo suyo', () => {
    const R = buildRegistry({ scenes: [{ code: '301_002' }, { code: '302_002' }], locations: [] });
    expect(read(R, 'Escena 1002 y Escena 2002')).toBe('301_002 302_002');
  });
  it('con 110 y 210 (terminan igual) la forma compacta se apaga y queda la canónica', () => {
    const R = buildRegistry({ scenes: [{ code: '110_012' }, { code: '210_012' }], locations: [] });
    expect(read(R, 'Escena 0012')).toBe('—');
    expect(read(R, 'Escena 110_012')).toBe('110_012');
  });
});

describe('los 25 casos para romperlo (C8, sección 10): 0 escenas falsas', () => {
  // Una trampa: existen todas las escenas que esos números podrían nombrar. Si no las nombra, es por la gramática.
  const trap = buildRegistry({
    scenes: ['102_026', '101_910', '102_025', '102_024', '101_942', '102_470', '101_074', '101_053', '105_027', '101_033', '101_033B', '102_045', '102_008', '101_016']
      .map((code) => ({ code })),
    locations: [],
  });
  const only = (text: string, heading: boolean) =>
    scan(trap, text, { heading }).filter((h) => h.kind !== 'loc').map((h) => `${h.kind}:${h.ref}`).join(' ') || '—';
  it.each([
    // años
    ['Rodaje 2026', '—', '—'],
    ['Inquilinato 1910', '—', '—'],
    ['Temporada 2025/26', '—', '—'],
    ['en 2024-2025 se filmó', '—', '—'],
    ['Escena de 1942', '—', '—'],
    // direcciones
    ['Cachi 2470', '—', '—'],
    ['Av. Corrientes 1074', '—', '—'],
    ['Calle 1053 y 3', '—', '—'],
    ['Piso 5-27', '—', '—'],
    ['Ruta 105_027 km 3', 'scene:105_027', 'scene:105_027'],
    // ids
    ['https://drive.google.com/file/d/1074Cxyz', '—', '—'],
    ['doc-1074C', '—', '—'],
    ['IMG_1074.JPG', '—', '—'],
    ['A001C003_1074', '—', '—'],
    ['id=105_027', '—', '—'],
    // horas
    ['Call 10:74', '—', '—'],
    ['Call 1074 hs', '—', '—'],
    ['a las 2045', '—', '—'],
    ['20:45 - 21:30', '—', '—'],
    ['Wrap 1033B', 'scene:101_033B', '—'],
    // planos
    ['plano 2 toma 1074', 'scene:101_074', 'scene:101_074'],
    ['Toma 1033', 'scene:101_033', 'scene:101_033'],
    ['lente 50mm f/1.4 1016', '—', '—'],
    ['Cámara A 2008', '—', '—'],
    ['Slate 105_027-03-02', 'scene:105_027', 'scene:105_027'],
  ])('«%s»', (text, inText, inHeading) => {
    expect([only(text, false), only(text, true)]).toEqual([inText, inHeading]);
  });

  it('los títulos de sección: un número de 4 cifras cuenta solo primero o tras «Escena»', () => {
    expect(only('Av. Suárez 2095', true)).toBe('—');
    expect(only('1074 · plano general', true)).toBe('scene:101_074');
    expect(only('Plates 1074', true)).toBe('—');
    expect(only('Escena 1074', true)).toBe('scene:101_074');
  });

  it('una letra de unidad pegada (1080p, 1080i, 4050K, 2030h) no hace escena en el texto, salvo que exista con esa letra', () => {
    const units = buildRegistry({ scenes: ['101_080', '102_030', '104_050', '102_024', '102_024P', '105_027'].map((code) => ({ code })), locations: [] });
    const see = (text: string) => scan(units, text).filter((h) => h.kind !== 'loc').map((h) => `${h.ref}${h.part}`).join(' ') || '—';
    expect(see('Entregar en 1080p y 1080i')).toBe('—');
    expect(see('Luz de 4050K')).toBe('—');
    expect(see('Termina 2030h')).toBe('—');
    // La escena con esa letra existe: cuenta. Con «Escena» delante o con H, igual que antes. Las demás letras, igual.
    expect(see('Repetir la 2024p')).toBe('102_024P');
    expect(see('Escena 1080p')).toBe('101_080P');
    expect(see('Repetir la 5027b y la 5027c')).toBe('105_027B 105_027C');
  });
});

describe('proyectos sin episodios (un largo; D383)', () => {
  const film = buildRegistry({
    scenes: ['12', '74', '069A', '100', '120'].map((code) => ({ code })),
    locations: [{ name: 'Puerto Madero' }],
  });
  it('la forma canónica es de 3 cifras con su letra', () => {
    expect([...film.scenes.keys()]).toEqual(['012', '074', '069A', '100', '120']);
    expect(film.flat).toBe(true);
  });
  it('con «Escena/Sc» delante, en el texto y en un título', () => {
    expect(both(film, 'Escena 74 en Puerto Madero')).toEqual(['074 loc Puerto Madero', '074 loc Puerto Madero']);
    expect(read(film, 'Sc. 74B y Sc 12')).toBe('074(B) 012');
    expect(read(film, 'escena 069A')).toBe('069A');
    expect(read(film, 'Escena 69')).toBe('—');
    expect(read(film, 'Escenas 12/74')).toBe('—');
    expect(read(film, 'Escena 12/74')).toBe('012 074');
    expect(read(film, 'Escena 74-75')).toBe('074');
  });
  it('lo primero de un título: 3 cifras con ceros, 3 cifras con un separador, o seguido de INT/EXT (D391)', () => {
    expect(read(film, '074', { heading: true })).toBe('074');
    expect(read(film, '074 Cocina', { heading: true })).toBe('074');
    expect(read(film, '074A Cocina', { heading: true })).toBe('074(A)');
    expect(read(film, '120 | Plaza', { heading: true })).toBe('120');
    expect(read(film, '74 | Cocina', { heading: true })).toBe('—');
    expect(read(film, '12 - INT. COCINA - DÍA', { heading: true })).toBe('012');
    expect(read(film, '12. INT. COCINA', { heading: true })).toBe('012');
    expect(read(film, '12 INT. COCINA', { heading: true })).toBe('012');
    expect(read(film, '74A', { heading: true })).toBe('—');
  });
  it('títulos comunes de VFX no son escenas en un largo (auditoría de E1, B1)', () => {
    const R = buildRegistry({ scenes: ['1', '2', '3', '4', '8', '12'].map((code) => ({ code })), locations: [] });
    for (const title of ['3D Tracking', '4K Plates', '2D', '8K', '1. General', '2 - Notas', '12A pasadas', '1) Llamado', '3D | Tracking']) {
      expect([title, read(R, title, { heading: true })]).toEqual([title, '—']);
    }
    // Con «Escena» delante sí.
    expect(read(R, 'Escena 3D', { heading: true })).toBe('003(D)');
  });
  it('«Esc» sin punto solo con 2 cifras o más: «Presioná Esc 2 veces» es la tecla (O3)', () => {
    expect(read(film, 'Presioná Esc 2 veces')).toBe('—');
    expect(read(film, 'Esc. 12')).toBe('012');
    expect(read(film, 'Esc 12')).toBe('012');
    expect(read(series, 'Presioná Esc 2 veces', { ep: '105' })).toBe('—');
    expect(read(series, 'Esc. 27', { ep: '105' })).toBe('105_027');
  });
  it('un número suelto nunca cuenta (cantidades, horas, años, direcciones)', () => {
    for (const text of ['120 extras en la plaza', '12 tomas de dron', 'Call 12 hs', 'Av. Corrientes 1074', 'en 2025', 'plano 12', 'toma 74', '74']) {
      expect(read(film, text)).toBe('—');
      if (text !== '74') expect(read(film, text, { heading: true })).toBe('—');
    }
    expect(read(film, 'Lista de 100 cosas', { heading: true })).toBe('—');
  });
  it('pendientes solo con «Escena» delante y si no existe ni con letra', () => {
    expect(read(film, 'Escena 130')).toBe('pending 130');
    expect(read(film, 'Escena 69')).toBe('—');
    expect(read(film, '130', { heading: true })).toBe('—');
  });
  it('nombre de plano: ABC_074_010', () => {
    expect(read(film, 'ABC_074_010.exr')).toBe('074');
    expect(read(film, 'IMG_0074.JPG')).toBe('—');
  });
  it('sin escenas, nada de pendientes', () => {
    const empty = buildRegistry({ scenes: [], locations: [] });
    expect(read(empty, 'Escena 130 y 101_074')).toBe('—');
  });
});

describe('locaciones', () => {
  it('por nombre o alias, palabra entera, sin tildes', () => {
    expect(read(series, 'Mañana en el cenade, después la arenera')).toBe('loc CENADE loc La Arenera');
    expect(read(series, 'Centro Nacional de algo')).toBe('loc CENADE');
    expect(read(series, 'CENADEs')).toBe('—');
  });
  it('los genéricos no se reconocen solos', () => {
    expect(read(series, 'Vamos al estudio')).toBe('—');
    expect(read(series, 'Estudio Arenas')).toBe('loc Estudio Arenas');
  });
  it('las posiciones siguen bien con letras que cambian de largo al normalizar', () => {
    expect(foldSameLength('한국 CENADE').length).toBe('한국 CENADE'.length);
    const text = '한국 cenade';
    const [hit] = scan(series, text);
    expect(text.slice(hit.s, hit.e)).toBe('cenade');
  });
});
