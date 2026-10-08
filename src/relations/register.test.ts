import { describe, expect, it } from 'vitest';
import type { PageSettings } from '../sync/types';
import { fakeTree } from './kindTesting';
import { buildRegistry, scan } from './reader';
import { locationFromTitle, registerProject, type RegisterTree } from './register';

// Qué existe y qué es cada página para las relaciones (Docs/Doc_Relaciones.md, sección 4), con el tipo de `kind.ts`
// (E2) y un árbol inventado: a qué escena o locación se refiere cada página, su episodio, su etapa y `graph: false`.

type Spec = { id: string; parent?: string; title?: string; settings?: PageSettings; deleted?: boolean };

function tree(specs: Spec[]): RegisterTree {
  const t = fakeTree(specs);
  return { ...t, roots: () => t.children(null) };
}

const SERIES: Spec[] = [
  { id: 'bd', title: 'Breakdown', settings: { holds: 'scene' } },
  { id: 'ep101', parent: 'bd', title: '101' },
  { id: 's074', parent: 'ep101', title: '074 | La cocina' },
  { id: 'ficha', parent: 's074', title: 'ERSO_101_074_010' },
  { id: 'otra', parent: 's074', title: '101_075 | parecida' },
  { id: 's069a', parent: 'ep101', title: '069A | Puerta Adlon' },
  { id: 'sdup', parent: 'ep101', title: '074 | copia' },
  { id: 'ep102', parent: 'bd', title: 'EP 102' },
  { id: 's012', parent: 'ep102', title: '012 | Andén' },
  { id: 'canon', parent: 'bd', title: '105_027 | Arenera' },
  { id: 'notas', parent: 'bd', title: 'Notas del desglose' },
  { id: 'locs', title: 'Locations', settings: { holds: 'location' } },
  { id: 'cenade', parent: 'locs', title: 'CENADE (Centro Nacional)' },
  { id: 'scout', parent: 'cenade', title: 'Tech scout 12/09' },
  { id: 'days', title: 'Shoot days', settings: { dayReports: {} } },
  { id: 'b2', parent: 'days', title: 'Bloque 2' },
  { id: 'd59', parent: 'b2', title: '2026-02-18 | Día 59 | CENADE' },
  { id: 'plan', parent: 'd59', title: 'Plan' },
  { id: 'marked', title: 'Suelta', settings: { entity: { kind: 'scene', code: '103_045' } } },
  { id: 'nomark', title: '101_074 copia', settings: { entity: false } },
  { id: 'archivo', title: '90 | Archivo', settings: { graph: false } },
  { id: 'viejo', parent: 'archivo', title: 'Backup', settings: { entity: { kind: 'scene', code: '104_001' } } },
  { id: 'tacho', title: 'Escena borrada', deleted: true, settings: { entity: { kind: 'scene', code: '104_002' } } },
];

describe('qué existe y qué es cada página', () => {
  const reg = registerProject(tree(SERIES), 'p');
  const role = (id: string) => reg.roles.get(id)!;

  it('las escenas, con el episodio de su carpeta, sin repetir; una sin número no entra al registro', () => {
    expect(reg.scenes.map((s) => `${s.code}@${s.pageId}`)).toEqual(['101_074@s074', '101_069A@s069a', '102_012@s012', '105_027@canon', '103_045@marked']);
    expect(reg.duplicates).toEqual([{ code: '101_074', pageIds: ['s074', 'sdup'] }]);
    expect(role('ep101').entity).toBeNull();
    expect(role('notas').entity).toEqual({ kind: 'scene', ref: null });
  });

  it('«parte de»: lo de adentro de una escena no es otra escena; su episodio sirve para «Esc 27»', () => {
    expect(role('ficha')).toMatchObject({ entity: null, partOf: { kind: 'scene', ref: '101_074', pageId: 's074' }, ep: '101', stage: 'breakdown' });
    expect(role('otra').entity).toBeNull();
    expect(role('s074')).toMatchObject({ entity: { kind: 'scene', ref: '101_074' }, ep: '101', stage: 'breakdown' });
  });

  it('locaciones (con sus alias) y días; lo de adentro es scouting o rodaje', () => {
    // El paréntesis no da alias (D416): ni «CENADE» ni «Centro Nacional» solos; «CENADE», solo en el título de un día (D417).
    expect(reg.locations).toEqual([{ name: 'CENADE (Centro Nacional)', aliases: ['CENADE (Centro Nacional)'], dayTitleAliases: ['CENADE'], pageId: 'cenade' }]);
    expect(role('scout')).toMatchObject({ partOf: { kind: 'location', pageId: 'cenade' }, stage: 'scouting' });
    expect(role('cenade').stage).toBe('location');
    expect(role('d59')).toMatchObject({ entity: { kind: 'day', ref: 'd59' }, stage: 'shoot' });
    expect(role('plan')).toMatchObject({ partOf: { kind: 'day', pageId: 'd59' }, stage: 'shoot' });
    expect(role('b2').entity).toBeNull();
  });

  it('`graph: false` saca la rama (aunque adentro haya una escena marcada); la papelera no cuenta', () => {
    expect(role('marked').entity).toEqual({ kind: 'scene', ref: '103_045' });
    expect(role('nomark').entity).toBeNull();
    expect(role('archivo').excluded).toBe(true);
    expect(role('viejo').excluded).toBe(true);
    expect(reg.scenes.some((s) => s.code === '104_001' || s.code === '104_002')).toBe(false);
    expect(reg.roles.has('tacho')).toBe(false);
  });

  it('un largo sin episodios (D383): `074 | Cocina` es la escena 074', () => {
    const film = registerProject(
      tree([
        { id: 'bd', title: 'Breakdown', settings: { holds: 'scene' } },
        { id: 'a', parent: 'bd', title: '074 | Cocina' },
        { id: 'b', parent: 'bd', title: '120 | Plaza' },
      ]),
      'p',
    );
    expect(film.scenes.map((s) => s.code)).toEqual(['074', '120']);
  });

  it('el nombre y los alias de una locación salen de su título', () => {
    expect(locationFromTitle('Aysa / Planta Bernal').aliases).toEqual(['Aysa / Planta Bernal', 'Aysa', 'Planta Bernal']);
    expect(locationFromTitle('Estudio Norte | Backlot').aliases).toEqual(['Estudio Norte | Backlot', 'Estudio Norte', 'Backlot']);
  });

  // D416, medido en ERSO: un alias sacado del paréntesis relacionaba en falso 36 pares página–locación.
  describe('un paréntesis no inventa alias (D416)', () => {
    const ERSO_LOCS = [
      'Europa (plates)',
      'Brandemburgo (Europa)',
      'Lübben (Europa)',
      'Farmacia Fanfarria (Europa)',
      'Plates Arrabal (Europa)',
      'Bar Berlin (Claridge)',
      'Inquilinato (Cachi 247)',
      'Mansión Gótica (rodaje D68)',
      'La Arenera (estudio)',
      'Estudio Norte (A)',
      'Estudio Norte (B)',
      'CENADE',
    ];
    const reg = registerProject(
      tree([{ id: 'locs', title: 'Locaciones', settings: { holds: 'location' } }, ...ERSO_LOCS.map((title, i) => ({ id: `l${i}`, parent: 'locs', title }))]),
      'p',
    );
    const R = buildRegistry({ scenes: [{ code: '101_074' }, { code: '105_025' }], locations: reg.locations });
    const aliases = (name: string) => reg.locations.find((l) => l.name === name)?.aliases;
    const locs = (text: string, heading = false) => scan(R, text, { heading }).filter((h) => h.kind === 'loc').map((h) => h.ref);

    it('lo de adentro del paréntesis nunca es alias; el nombre sin él, solo con dos palabras o más y si no se comparte', () => {
      expect(locationFromTitle('Europa (plates)').aliases).toEqual(['Europa (plates)']);
      expect(aliases('Europa (plates)')).toEqual(['Europa (plates)']);
      expect(aliases('Lübben (Europa)')).toEqual(['Lübben (Europa)']);
      expect(aliases('Inquilinato (Cachi 247)')).toEqual(['Inquilinato (Cachi 247)']);
      expect(aliases('La Arenera (estudio)')).toEqual(['La Arenera (estudio)', 'La Arenera']);
      expect(aliases('Bar Berlin (Claridge)')).toEqual(['Bar Berlin (Claridge)', 'Bar Berlin']);
      expect(aliases('Mansión Gótica (rodaje D68)')).toEqual(['Mansión Gótica (rodaje D68)', 'Mansión Gótica']);
      expect(aliases('Estudio Norte (A)')).toEqual(['Estudio Norte (A)']);
      expect(aliases('CENADE')).toEqual(['CENADE']);
    });

    it('«plates» suelto no nombra a «Europa (plates)»', () => {
      expect(locs('2 plates de humo negro')).toEqual([]);
      expect(locs('Plates ambulancia', true)).toEqual([]);
      expect(locs('Se filma por continuidad con los plates de la estación.')).toEqual([]);
    });

    it('«Europa», que comparten seis títulos, no nombra a ninguno', () => {
      expect(locs('Plates de Europa para el tren')).toEqual([]);
    });

    it('lo del paréntesis o una sola palabra tampoco: «Lübben» del guion, «Claridge», «Cachi 247», «rodaje D68»', () => {
      expect(locs('A lo lejos las luces de un auto que viene de Berlín hacia Lübben')).toEqual([]);
      expect(locs('Pasan por cartel a Lubben (sin VFX):', true)).toEqual([]);
      expect(locs('Tucumán 535, CABA Claridge Bar')).toEqual([]);
      expect(locs('Inquilinato, Cachi 247')).toEqual([]);
      expect(locs('Una toma en rodaje D68')).toEqual([]);
    });

    it('el título entero o el nombre de dos palabras sí la nombran, y una locación sin paréntesis sigue igual', () => {
      expect(locs('Plates en Europa (plates), segunda unidad')).toEqual(['Europa (plates)']);
      expect(locs('2026-03-14 | Día 76 | La Arenera Ambulancia', true)).toEqual(['La Arenera (estudio)']);
      expect(locs('2026-04-01 | Día 77 | plates Arrabal', true)).toEqual(['Plates Arrabal (Europa)']);
      expect(locs('Bar Berlin, frente')).toEqual(['Bar Berlin (Claridge)']);
      expect(locs('Scouting en CENADE')).toEqual(['CENADE']);
    });
  });

  // D417: el nombre sin paréntesis de una sola palabra vale solo para el lugar de un día por su título (D398).
  describe('un nombre de una palabra vale en el título de un día (D417)', () => {
    const LOCS = ['Inquilinato (Cachi 247)', 'Lübben (Europa)', 'Brandemburgo (Europa)', 'Sótano (A)', 'Sótano (B)', 'CENADE'];
    const reg = registerProject(
      tree([{ id: 'locs', title: 'Locaciones', settings: { holds: 'location' } }, ...LOCS.map((title, i) => ({ id: `l${i}`, parent: 'locs', title }))]),
      'p',
    );
    const R = buildRegistry({ scenes: [{ code: '101_032' }], locations: reg.locations });
    const dayLocs = (title: string) => scan(R, title, { heading: true, dayTitle: true }).filter((h) => h.kind === 'loc').map((h) => h.ref);
    const locs = (text: string, heading = false) => scan(R, text, { heading }).filter((h) => h.kind === 'loc').map((h) => h.ref);

    it('los tres días de ERSO dan su locación', () => {
      expect(dayLocs('2026-03-11 | Día 73 | Inquilinato')).toEqual(['Inquilinato (Cachi 247)']);
      expect(dayLocs('2026-04-02 | Día 78 | Lubben Puente y calle')).toEqual(['Lübben (Europa)']);
      expect(dayLocs('2026-04-03 | Día 79 | Brandemburgo')).toEqual(['Brandemburgo (Europa)']);
    });

    it('en un párrafo o en otro título no cuenta', () => {
      expect(locs('A lo lejos las luces de un auto que viene de Berlín hacia Lübben')).toEqual([]);
      expect(locs('Pasan por cartel a Lubben (sin VFX):', true)).toEqual([]);
      expect(locs('El inquilinato del fondo')).toEqual([]);
    });

    it('un nombre corto que comparten dos locaciones no da lugar, ni siquiera en un día', () => {
      expect(dayLocs('2026-01-10 | Día 12 | Sótano')).toEqual([]);
      expect(reg.locations.find((l) => l.name === 'Sótano (A)')?.dayTitleAliases).toBeUndefined();
    });

    it('el título entero y las locaciones sin paréntesis siguen igual en el día', () => {
      expect(dayLocs('2026-02-19 | Día 59 | Cenade')).toEqual(['CENADE']);
      expect(dayLocs('2026-01-11 | Día 13 | Sótano (B)')).toEqual(['Sótano (B)']);
    });
  });
});
