import { describe, expect, it } from 'vitest';
import { rowPhoto } from './liveView';
import type { PhotoRef } from './liveView';

// La foto de una fila de la tabla de Escenas o Locaciones (D824): la elegida con *Use as thumbnail* si sigue entre las de
// la fila; si no, la primera de la página misma; si no tiene, la primera de lo de adentro.

const photo = (id: string, pageId: string): PhotoRef => ({ id, place: { pageId, blockId: `b-${id}` } }) as PhotoRef;

describe('la foto de la fila', () => {
  const photos = [photo('a', 'child'), photo('b', 'scene'), photo('c', 'scene')];

  it('sin elegir: la primera de la página misma, y si no tiene, la primera de lo de adentro', () => {
    expect(rowPhoto(photos, 'scene')).toBe('b');
    expect(rowPhoto([photo('a', 'child')], 'scene')).toBe('a');
    expect(rowPhoto([], 'scene')).toBeNull();
  });

  it('la elegida gana; si ya no está entre las de la fila (se borró la foto), vuelve a la de siempre', () => {
    expect(rowPhoto(photos, 'scene', 'c')).toBe('c');
    expect(rowPhoto(photos, 'scene', 'a')).toBe('a');
    expect(rowPhoto(photos, 'scene', 'gone')).toBe('b');
  });
});
