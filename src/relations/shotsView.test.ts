import { describe, expect, it } from 'vitest';
import { placeClass } from './ShotsView';

describe('Shots: color de las columnas de lugar (D823)', () => {
  it('la locación en azul y el decorado en violeta, con el rótulo en inglés o en castellano', () => {
    expect(placeClass('Location')).toBe('loc');
    expect(placeClass('Locación')).toBe('loc');
    expect(placeClass('Locación real')).toBe('loc');
    expect(placeClass('Set')).toBe('set');
    expect(placeClass('Decorado')).toBe('set');
    expect(placeClass('Locación guion')).toBe('set');
    expect(placeClass('Descripción')).toBeUndefined();
  });
});
