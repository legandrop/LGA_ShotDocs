import { describe, expect, it } from 'vitest';
import { datedTip, datedTitle } from './datedTitle';

// La fila con fecha de la barra lateral (D789): las tres familias de títulos de Lega dan la misma forma.
describe('datedTitle', () => {
  it('día de rodaje: fecha ISO, jornada y lugar', () => {
    expect(datedTitle('2025-11-05 | Día 05 | Frente Ruso Villarino')).toEqual({
      date: '05/11',
      year: 2025,
      jornada: 'D05',
      place: 'Frente Ruso Villarino',
      note: null,
    });
  });

  it('día sin reporte: la parte del medio queda como nota', () => {
    expect(datedTitle('2025-10-30 | Sin reporte | Casa Flores')).toMatchObject({ date: '30/10', jornada: null, place: 'Casa Flores', note: 'Sin reporte' });
  });

  it('scouting: la locación (la tercera parte) ya no se pierde', () => {
    expect(datedTitle('260106 | Scouting técnico VFX | Senade Ezeiza')).toEqual({
      date: '06/01',
      year: 2026,
      jornada: null,
      place: 'Senade Ezeiza',
      note: 'Scouting técnico VFX',
    });
  });

  it('plan: jornada y fecha en la misma parte', () => {
    expect(datedTitle('D37 26.01.18 | Centro CABA')).toMatchObject({ date: '18/01', year: 2026, jornada: 'D37', place: 'Centro CABA', note: null });
    expect(datedTitle('D03_26.03.25 | Estudio')).toMatchObject({ date: '25/03', jornada: 'D03', place: 'Estudio' });
  });

  it('solo la fecha: sin lugar', () => {
    expect(datedTitle('2026-02-19 | Day 59')).toMatchObject({ date: '19/02', jornada: 'D59', place: null, note: null });
  });

  it('sin una fecha clara, nada: la fila se ve como siempre', () => {
    expect(datedTitle('Bloque 2')).toBeNull();
    expect(datedTitle('Scouting técnico VFX')).toBeNull();
    // Dos fechas, o una que se lee de dos formas (`05.11`: 5 nov o 11 may), no se eligen.
    expect(datedTitle('2026-01-05 | 2026-01-06 | Doble')).toBeNull();
    expect(datedTitle('D19 05.11 | Laureles')).toBeNull();
    // La fecha metida en una parte con otras palabras no es la fecha del título.
    expect(datedTitle('Notas del 26.01.18 | Centro')).toBeNull();
  });

  it('un lugar con números no es una fecha', () => {
    expect(datedTitle('2025-11-05 | Día 05 | Villarino 2200')).toMatchObject({ place: 'Villarino 2200' });
  });

  it('las partes que son solo números (una escena, una hora) se quedan en la fila', () => {
    expect(datedTitle('2025-11-05 | Día 05 | 101_074')).toMatchObject({ place: '101_074' });
    expect(datedTitle('2025-11-05 | 2200')).toMatchObject({ place: '2200' });
    expect(datedTitle('2025-11-05 | 9.30 | Casa')).toMatchObject({ place: 'Casa', note: '9.30' });
  });

  it('la jornada no se lee del lugar', () => {
    expect(datedTitle('2025-11-05 | Galpón D3')).toMatchObject({ jornada: null, place: 'Galpón D3' });
    expect(datedTitle('2025-11-05 | Plató D2 | Día 05')).toMatchObject({ jornada: 'D05', place: 'Plató D2' });
  });

  it('el lugar es la parte que la app reconoce como locación', () => {
    const isLoc = (t: string) => t === 'Casa';
    expect(datedTitle('2025-11-05 | D05 | Casa | Interior | Noche', isLoc)).toMatchObject({ jornada: 'D05', place: 'Casa', note: 'Interior · Noche' });
    expect(datedTitle('2025-11-05 | D05 | Casa | Noche')).toMatchObject({ place: 'Noche', note: 'Casa' });
  });

  it('títulos vacíos y con «|» repetidos', () => {
    expect(datedTitle('')).toBeNull();
    expect(datedTitle('2025-11-05 || Día 05 ||| Casa')).toMatchObject({ jornada: 'D05', place: 'Casa', note: null });
  });

  it('el tooltip suma el año cuando el título no lo escribe entero', () => {
    const t = 'D37 26.01.18 | CENADE';
    expect(datedTip(t, datedTitle(t)!)).toBe('D37 26.01.18 | CENADE · 2026');
    const u = '2025-11-05 | Día 05 | Casa';
    expect(datedTip(u, datedTitle(u)!)).toBe(u);
  });
});
