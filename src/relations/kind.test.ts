import { describe, expect, it } from 'vitest';
import { BUILTIN_ONSET } from '../templates/builtinIds';
import { episodeOf, holdsOf, isEpisodeTitle, kindReader, pageKind, sceneCode } from './kind';
import { fakeTree } from './kindTesting';

// Qué es cada página (src/relations/kind.ts): la marca de la página, la carpeta, los grupos (episodios, bloques), «parte
// de», los días por la carpeta de reportes, lo que ve un invitado sin la carpeta y lo que ve un link público.

/** El proyecto estándar (Doc_Estructura_Proyecto.md) como ERSO: desglose por episodio, locaciones, rodaje por bloques. */
function erso(marks = true) {
  return fakeTree([
    { id: 'pre', title: '1 | Preproducción' },
    { id: 'desglose', parent: 'pre', title: '1.1 | Desglose', settings: marks ? { holds: 'scene' } : {} },
    { id: 'ep105', parent: 'desglose', title: '105 | Episodio 5' },
    { id: 'esc027', parent: 'ep105', title: '027 | El vehículo comienza a zigzaguear | 105-027' },
    { id: 'ficha', parent: 'esc027', title: 'ERSO_105_027_010 Ambulancia | Ruta INT' },
    { id: 'esc069a', parent: 'ep105', title: '069A | Puerta Adlon' },
    { id: 'notas', parent: 'desglose', title: 'Notas generales' },
    { id: 'locs', parent: 'pre', title: '1.2 | Locaciones y scoutings', settings: marks ? { holds: 'location' } : {} },
    { id: 'cenade', parent: 'locs', title: 'CENADE' },
    { id: 'scout', parent: 'cenade', title: '260106 | Scouting técnico VFX | Cenade - Ezeiza' },
    { id: 'rodaje', title: '2 | Rodaje', settings: marks ? { dayReports: {} } : {} },
    { id: 'bloque2', parent: 'rodaje', title: 'Bloque 2' },
    { id: 'dia59', parent: 'bloque2', title: '2026-02-19 | Día 59 | Cenade' },
    { id: 'plan', parent: 'dia59', title: 'Plan' },
    { id: 'suelta', parent: 'bloque2', title: 'Llamados' },
  ]);
}

describe('títulos: número de escena y episodio', () => {
  it('el número canónico sale con guion bajo y la letra en mayúscula', () => {
    expect(sceneCode('101_074 | Llegan al bar')).toBe('101_074');
    expect(sceneCode('101-074 | Llegan al bar')).toBe('101_074');
    expect(sceneCode('101_069A')).toBe('101_069A');
    expect(sceneCode('Escena 105_029a')).toBe('105_029A');
    expect(sceneCode('074 | Llegan | 101-074')).toBe('101_074');
    expect(sceneCode('074 | Llegan al bar', '101')).toBe('101_074');
    expect(sceneCode('74 | Llegan al bar', '101')).toBe('101_074');
    expect(sceneCode('069A | Puerta', '101')).toBe('101_069A');
  });

  it('sin episodio un número corto no alcanza, y lo que no es un número de escena no cuenta', () => {
    expect(sceneCode('074 | Llegan al bar')).toBeNull();
    expect(sceneCode('ERSO_105_027_010 Ambulancia')).toBeNull();
    expect(sceneCode('2026-02-19 | Día 59')).toBeNull();
    expect(sceneCode('101_07 | a medio escribir')).toBeNull();
    expect(sceneCode('105_026ial')).toBeNull();
    expect(sceneCode('Av. Suárez 2095', '102')).toBeNull();
    expect(sceneCode('')).toBeNull();
  });

  it('un número que nombra otra escena en el medio o al final del título no cuenta (auditoría de E2, B2)', () => {
    expect(sceneCode('075 | Persecución, sigue en 105_076', '105')).toBe('105_075');
    expect(sceneCode('074 | Llegan al pozo | igual que 101_080', '105')).toBe('105_074');
    expect(sceneCode('Persecución, sigue en 105_076')).toBeNull();
    expect(sceneCode('074 | Llegan al pozo | igual que 101_080')).toBeNull();
    // La forma ERSO: la última parte es entera el número.
    expect(sceneCode('027 | El vehículo comienza a zigzaguear | 105-027')).toBe('105_027');
    expect(sceneCode('027 | El vehículo | Escena 105_027')).toBe('105_027');
    // Con episodio, el corto de la primera parte va antes que la última parte.
    expect(sceneCode('027 | El vehículo | 105-027', '105')).toBe('105_027');
  });

  it('carpetas de episodio', () => {
    for (const t of ['101', 'EP 101', 'Ep. 101', '101 | Episode 1', '105 | Episodio 5', '105 · Episodio 5', 'Episodio 5'])
      expect(isEpisodeTitle(t), t).toBe(true);
    for (const t of ['074 | Llegan al bar', '1.1 | Desglose', 'Epílogo', '105 | Epílogo', '1010']) expect(isEpisodeTitle(t), t).toBe(false);
    expect(episodeOf('105 | Episodio 5')).toBe('105');
    expect(episodeOf('EP 101')).toBe('101');
    expect(episodeOf('101')).toBe('101');
    expect(episodeOf('Episodio 5')).toBeNull();
  });
});

describe('qué es cada página', () => {
  it('por la carpeta: escenas adentro de los episodios, locaciones, días adentro de los bloques', () => {
    const tree = erso();
    expect(pageKind(tree, 'esc027')).toEqual({ kind: 'scene', code: '105_027', source: 'folder', folder: 'desglose' });
    expect(pageKind(tree, 'esc069a')).toMatchObject({ kind: 'scene', code: '105_069A' });
    expect(pageKind(tree, 'cenade')).toEqual({ kind: 'location', code: null, source: 'folder', folder: 'locs' });
    expect(pageKind(tree, 'dia59')).toEqual({ kind: 'day', code: null, source: 'folder', folder: 'rodaje' });
    // Los grupos no son entidades.
    expect(pageKind(tree, 'ep105')).toEqual({ kind: 'none' });
    expect(pageKind(tree, 'bloque2')).toEqual({ kind: 'none' });
    // Una página sin fecha en un bloque no es un día.
    expect(pageKind(tree, 'suelta')).toEqual({ kind: 'none' });
    // Lo de primer nivel en la carpeta de escenas es escena (se arregla con *Type* → *None of these*).
    expect(pageKind(tree, 'notas')).toMatchObject({ kind: 'scene', code: null });
  });

  it('lo de adentro es «parte de»: las fichas con número no se vuelven escenas', () => {
    const tree = erso();
    expect(pageKind(tree, 'ficha')).toEqual({ kind: 'part', of: 'esc027', ofKind: 'scene', code: '105_027' });
    expect(pageKind(tree, 'scout')).toEqual({ kind: 'part', of: 'cenade', ofKind: 'location', code: null });
    expect(pageKind(tree, 'plan')).toEqual({ kind: 'part', of: 'dia59', ofKind: 'day', code: null });
  });

  it('sin carpetas marcadas, nada es nada', () => {
    const tree = erso(false);
    for (const id of tree.rows.keys()) expect(pageKind(tree, id), id).toEqual({ kind: 'none' });
  });

  it('la marca de la página gana sobre la carpeta, y `false` dice «no es nada de esto»', () => {
    const tree = erso();
    tree.rows.get('notas')!.settings = { entity: false };
    tree.rows.get('cenade')!.settings = { entity: { kind: 'scene', code: '101_001' } };
    tree.rows.get('ficha')!.settings = { entity: { kind: 'location' } };
    expect(pageKind(tree, 'notas')).toEqual({ kind: 'none' });
    expect(pageKind(tree, 'cenade')).toEqual({ kind: 'scene', code: '101_001', source: 'page', folder: null });
    expect(pageKind(tree, 'ficha')).toEqual({ kind: 'location', code: null, source: 'page', folder: null });
  });

  it('una marca de una versión más nueva (un tipo que esta no conoce) no se toma por la de la carpeta', () => {
    const tree = erso();
    tree.rows.get('esc027')!.settings = { entity: { kind: 'shot' } as never };
    expect(pageKind(tree, 'esc027')).toEqual({ kind: 'none' });
    expect(pageKind(tree, 'ficha')).toEqual({ kind: 'none' });
  });

  it('un invitado que ve la escena sin su carpeta: la marca alcanza (tipo y código)', () => {
    const tree = fakeTree([{ id: 'esc', parent: 'ep105', title: '027 | El vehículo', settings: { entity: { kind: 'scene', code: '105_027' } } }, { id: 'ficha', parent: 'esc', title: 'ERSO_105_027_010' }]);
    expect(pageKind(tree, 'esc')).toEqual({ kind: 'scene', code: '105_027', source: 'page', folder: null });
    expect(pageKind(tree, 'ficha')).toEqual({ kind: 'part', of: 'esc', ofKind: 'scene', code: '105_027' });
    // Sin la marca, un invitado así no sabe nada.
    tree.rows.get('esc')!.settings = {};
    expect(pageKind(tree, 'esc')).toEqual({ kind: 'none' });
  });

  it('un visitante de un link público recibe solo `header` y `format`: nada', () => {
    const tree = erso();
    for (const row of tree.rows.values()) {
      const s = row.settings ?? {};
      row.settings = { ...(s.header ? { header: s.header } : {}), ...(s.format ? { format: s.format } : {}) };
    }
    for (const id of tree.rows.keys()) expect(pageKind(tree, id), id).toEqual({ kind: 'none' });
  });

  it('la carpeta *Templates* y las plantillas nunca son entidades', () => {
    const tree = fakeTree([
      { id: 'tpl', title: 'Templates', settings: { templatesFolder: true, holds: 'scene' } },
      { id: 'scene-tpl', parent: 'tpl', title: '101_074 | Escena modelo', settings: { entity: { kind: 'scene', code: '101_074' } } },
      { id: 'desglose', title: 'Desglose', settings: { holds: 'scene' } },
      { id: 'marcada', parent: 'desglose', title: '101_001 | Modelo', settings: { template: {} } },
    ]);
    expect(holdsOf(tree, 'tpl')).toBeNull();
    expect(pageKind(tree, 'scene-tpl')).toEqual({ kind: 'none' });
    expect(pageKind(tree, 'marcada')).toEqual({ kind: 'none' });
  });

  it('una subcarpeta con su propio tipo manda adentro suyo', () => {
    const tree = fakeTree([
      { id: 'cenade', title: 'CENADE', settings: { entity: { kind: 'location' } } },
      { id: 'escenas', parent: 'cenade', title: 'Escenas de acá', settings: { holds: 'scene' } },
      { id: 'e1', parent: 'escenas', title: '101_074 | Llegan' },
      { id: 'desglose', title: 'Desglose', settings: { holds: 'scene' } },
      { id: 'ep', parent: 'desglose', title: 'Unidad B', settings: { holds: 'scene' } },
      { id: 'e2', parent: 'ep', title: '102_003' },
    ]);
    expect(pageKind(tree, 'escenas')).toEqual({ kind: 'part', of: 'cenade', ofKind: 'location', code: null });
    expect(pageKind(tree, 'e1')).toMatchObject({ kind: 'scene', code: '101_074', folder: 'escenas' });
    expect(pageKind(tree, 'ep')).toEqual({ kind: 'none' });
    expect(pageKind(tree, 'e2')).toMatchObject({ kind: 'scene', code: '102_003', folder: 'ep' });
  });

  it('un episodio en la carpeta con su propio tipo da su número a las escenas', () => {
    const tree = fakeTree([
      { id: 'ep', title: 'EP 101', settings: { holds: 'scene' } },
      { id: 'e', parent: 'ep', title: '074 | Llegan al bar' },
    ]);
    expect(pageKind(tree, 'e')).toMatchObject({ kind: 'scene', code: '101_074' });
  });

  it('una página recién creada (sin título) ya toma el tipo de la carpeta', () => {
    const tree = fakeTree([
      { id: 'desglose', title: 'Desglose', settings: { holds: 'scene' } },
      { id: 'nueva', parent: 'desglose', title: '' },
    ]);
    expect(pageKind(tree, 'nueva')).toMatchObject({ kind: 'scene', code: null, source: 'folder' });
  });
});

describe('días adentro de un grupo (auditoría de E2, O2)', () => {
  it('es día un reporte, o lo que tiene fecha Y número de día; una hoja de llamado con fecha no', () => {
    const tree = fakeTree([
      { id: 'rodaje', settings: { dayReports: {} } },
      { id: 'calls', parent: 'rodaje', title: 'Call sheets' },
      { id: 'call', parent: 'calls', title: '2026-02-19 | Call sheet' },
      { id: 'bloque', parent: 'rodaje', title: 'Bloque 2' },
      { id: 'dia', parent: 'bloque', title: '2026-02-19 | Día 59 | Cenade' },
      { id: 'solo-numero', parent: 'bloque', title: 'Día 60' },
      { id: 'bloque3', parent: 'rodaje', title: 'Bloque 3' },
      { id: 'reporte', parent: 'bloque3', title: '2026-02-21 | Notas', template_id: BUILTIN_ONSET },
      { id: 'directo', parent: 'rodaje', title: '2026-02-22 | Unidad B' },
    ]);
    expect(pageKind(tree, 'call')).toEqual({ kind: 'none' });
    expect(pageKind(tree, 'dia')).toMatchObject({ kind: 'day', folder: 'rodaje' });
    expect(pageKind(tree, 'solo-numero')).toEqual({ kind: 'none' });
    // Un reporte cuenta: y su grupo pasa a ser una carpeta de reportes deducida (la de días, D369).
    expect(pageKind(tree, 'reporte')).toMatchObject({ kind: 'day', folder: 'bloque3' });
    // En el primer nivel de la carpeta de días alcanza la fecha (o el número de día).
    expect(pageKind(tree, 'directo')).toMatchObject({ kind: 'day' });
  });
});

describe('las carpetas de días son las de reportes del día (D369)', () => {
  it('marcada, deducida por sus reportes, o con `holds: day`; `dayReports: false` la apaga', () => {
    const tree = fakeTree([
      { id: 'marcada', settings: { dayReports: {} } },
      { id: 'deducida', title: 'Reportes' },
      { id: 'r1', parent: 'deducida', title: '2026-10-02 | Day 06', template_id: BUILTIN_ONSET },
      { id: 'holds', settings: { holds: 'day' } },
      { id: 'apagada', settings: { holds: 'day', dayReports: false } },
      { id: 'escenas', settings: { holds: 'scene' } },
      { id: 'nada', settings: { holds: false } },
    ]);
    expect(holdsOf(tree, 'marcada')).toBe('day');
    expect(holdsOf(tree, 'deducida')).toBe('day');
    expect(holdsOf(tree, 'holds')).toBe('day');
    expect(holdsOf(tree, 'apagada')).toBeNull();
    expect(holdsOf(tree, 'escenas')).toBe('scene');
    expect(holdsOf(tree, 'nada')).toBeNull();
    expect(pageKind(tree, 'r1')).toMatchObject({ kind: 'day', folder: 'deducida' });
  });
});

describe('el lector con memoria', () => {
  it('da lo mismo que página por página', () => {
    const tree = erso();
    const reader = kindReader(tree);
    for (const id of tree.rows.keys()) expect(reader.kindOf(id), id).toEqual(pageKind(tree, id));
    expect(reader.titleCode('esc027')).toBe('105_027');
    expect(reader.contextOf('esc027')).toEqual({ holds: 'scene', folder: 'desglose', episode: '105' });
  });
});
