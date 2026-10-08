import { describe, expect, it } from 'vitest';
import type { PageSettings } from '../sync/types';
import { fakeTree } from './kindTesting';
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
    expect(reg.locations).toEqual([{ name: 'CENADE (Centro Nacional)', aliases: ['CENADE (Centro Nacional)', 'CENADE', 'Centro Nacional'], pageId: 'cenade' }]);
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
  });
});
