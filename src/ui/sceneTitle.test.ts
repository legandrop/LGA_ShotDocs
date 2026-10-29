import { describe, expect, it } from 'vitest';
import { nextSceneCodes } from '../relations/FolderIndex';
import { sceneTitleJoin, sceneTitleName } from './sceneTitle';

// El título partido de una escena (D818) y el número que propone *New scene*.

describe('sceneTitleName / sceneTitleJoin', () => {
  it('separa el nombre del número y lo vuelve a juntar igual', () => {
    expect(sceneTitleName('029 | Plaza de Mayo', '029')).toBe('Plaza de Mayo');
    expect(sceneTitleJoin('029', 'Plaza de Mayo')).toBe('029 | Plaza de Mayo');
    expect(sceneTitleName('029', '029')).toBe('');
    expect(sceneTitleJoin('029', '')).toBe('029');
    // Lo escrito se conserva tal cual (dos espacios, un nombre con «|» adentro).
    expect(sceneTitleJoin('029', sceneTitleName('029 |  Plaza', '029')!)).toBe('029 |  Plaza');
    expect(sceneTitleName('105_120 | Bar | Noche', '105_120')).toBe('Bar | Noche');
  });

  it('un título que no empieza con su número no se parte', () => {
    expect(sceneTitleName('Escena 29', '029')).toBeNull();
    expect(sceneTitleName('029A | Otra', '029')).toBeNull();
    expect(sceneTitleName('0290 | Otra', '029')).toBeNull();
  });
});

describe('nextSceneCodes', () => {
  const scene = (code: string, ep = '') => [code, { code, ep, n: code.slice(-3).replace(/[A-Z]+$/, ''), letter: '', pageId: null }] as const;

  it('en un largo, el siguiente al más alto', () => {
    const registry = { flat: true, eps: new Set<string>(), scenes: new Map([scene('001'), scene('059'), scene('012')]) };
    expect(nextSceneCodes(registry, 2)).toEqual(['060', '061']);
  });

  it('en un proyecto vacío, 001', () => {
    expect(nextSceneCodes({ flat: true, eps: new Set(), scenes: new Map() }, 1)).toEqual(['001']);
  });

  it('en una serie, el siguiente del último episodio', () => {
    const registry = { flat: false, eps: new Set(['101', '105']), scenes: new Map([scene('101_040', '101'), scene('105_027', '105')]) };
    expect(nextSceneCodes(registry, 1)).toEqual(['105_028']);
  });
});
