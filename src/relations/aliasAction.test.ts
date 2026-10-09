import { describe, expect, it } from 'vitest';
import { likeness, locationOptions, titleFragment } from './aliasAction';
import { buildRegistry } from './reader';

// *Link to a location…* (D539), lo puro: qué parte del título se ofrece y el orden de las locaciones (la regla de parecido
// solo ordena, D532).

const R = buildRegistry({
  scenes: [],
  locations: [
    { name: 'CENADE', pageId: 'cenade' },
    { name: 'Edificio Ministerial Hall', pageId: 'edif' },
    { name: 'El Pasaje Bar', pageId: 'pasaje' },
    { name: 'La Arenera (estudio)', aliases: ['La Arenera (estudio)', 'La Arenera'], dayTitleAliases: ['Arenera'], pageId: 'arenera' },
    { name: 'Hotel Alvear', pageId: 'alvear' },
  ],
});

describe('la parte del título que se ofrece', () => {
  it('sin la fecha, el rótulo del día ni lo de entre paréntesis', () => {
    expect(titleFragment({ title: '2026-02-18 | Día 58 | Edif Ministe Hall', label: 'Día 58', date: '2026-02-18' })).toBe('Edif Ministe Hall');
    expect(titleFragment({ title: '2025-11-25 | Día 18 | Arrabal Altillo (sin reporte)', label: 'Día 18', date: '2025-11-25' })).toBe('Arrabal Altillo');
    expect(titleFragment({ title: '2026-02-12 | Día 56', label: 'Día 56', date: '2026-02-12' })).toBe('');
    expect(titleFragment({ title: 'Día 56', label: 'Día 56', date: null })).toBe('');
  });
});

describe('el orden (D532: solo ordena)', () => {
  it('cada palabra del título es el comienzo de una del nombre, sin artículos ni «de»', () => {
    expect(likeness('Edificio Ministerial Hall', 'Edif Ministe Hall')).toBe(1);
    expect(likeness('El Pasaje Bar', 'Pasaje Bar')).toBe(1);
    expect(likeness('Hotel Alvear', 'Edif Ministe Hall')).toBe(0);
    expect(likeness('CENADE', 'Centro CABA')).toBe(0);
  });

  it('las parecidas primero; después por nombre; filtra por cualquier forma; solo las que se pueden editar', () => {
    const all = () => true;
    expect(locationOptions(R, 'Edif Ministe Hall', '', all).map((o) => [o.name, o.similar])).toEqual([
      ['Edificio Ministerial Hall', true],
      ['CENADE', false],
      ['El Pasaje Bar', false],
      ['Hotel Alvear', false],
      ['La Arenera (estudio)', false],
    ]);
    expect(locationOptions(R, 'Edif Ministe Hall', 'arenera', all).map((o) => o.name)).toEqual(['La Arenera (estudio)']);
    expect(locationOptions(R, 'Edif Ministe Hall', '', (id) => id !== 'edif').map((o) => o.name)).not.toContain('Edificio Ministerial Hall');
  });
});
