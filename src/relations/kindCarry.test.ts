import { describe, expect, it } from 'vitest';
import { settingsOf } from '../export/exportZip';
import { archiveSettings } from '../import/shotdocsImport';
import { DEFAULT_STRIP, stripKinds } from '../templates/stripKinds';
import { fakeTree } from './kindTesting';

// El tipo viaja con la página al exportar e importar un proyecto (Shot Docs → Shot Docs), y la tira de plantillas de una
// página vacía ofrece las que tocan donde está.

describe('exportar e importar conservan el tipo', () => {
  it('`entity` y `holds` salen en el archivo y vuelven al importarlo', () => {
    const page = { parent: 'x', format: { size: 'free', landscape: false } } as never;
    const out = settingsOf({ entity: { kind: 'scene', code: '101_074' }, holds: 'location', split: true }, page, new Set());
    expect(out).toEqual({ entity: { kind: 'scene', code: '101_074' }, holds: 'location', split: true });
    expect(archiveSettings(out, () => null)).toEqual({ entity: { kind: 'scene', code: '101_074' }, holds: 'location', split: true });
    expect(archiveSettings({ entity: false, holds: false }, () => null)).toEqual({ entity: false, holds: false });
  });

  it('lo que no tiene la forma de esta versión no se escribe', () => {
    expect(archiveSettings({ entity: { kind: 'shot' }, holds: 'shots' }, () => null)).toEqual({});
    expect(archiveSettings({ entity: { kind: 'scene', code: '101-074' } }, () => null)).toEqual({ entity: { kind: 'scene' } });
    expect(archiveSettings({ entity: 'scene' }, () => null)).toEqual({});
  });

  it('`graph: false` (fuera de las relaciones, D387) sale y vuelve; otro valor no', () => {
    const page = { parent: 'x', format: { size: 'free', landscape: false } } as never;
    const out = settingsOf({ graph: false }, page, new Set());
    expect(out).toEqual({ graph: false });
    expect(archiveSettings(out, () => null)).toEqual({ graph: false });
    expect(archiveSettings({ graph: true }, () => null)).toEqual({});
    // Un código sin episodio (un largo, D383) también vuelve.
    expect(archiveSettings({ entity: { kind: 'scene', code: '074' } }, () => null)).toEqual({ entity: { kind: 'scene', code: '074' } });
  });
});

describe('la tira de plantillas según el lugar', () => {
  const tree = fakeTree([
    { id: 'desglose', settings: { holds: 'scene' } },
    { id: 'esc', parent: 'desglose', title: '' },
    { id: 'escena', parent: 'desglose', title: '101_074' },
    { id: 'ficha', parent: 'escena', title: '' },
    { id: 'locs', settings: { holds: 'location' } },
    { id: 'loc', parent: 'locs', title: '' },
    { id: 'cenade', parent: 'locs', title: 'CENADE' },
    { id: 'scout', parent: 'cenade', title: '' },
    { id: 'rodaje', settings: { dayReports: {} } },
    { id: 'dia', parent: 'rodaje', title: '' },
    { id: 'suelta', title: '' },
  ]);

  it('escena, locación, scouting adentro de una locación, día; afuera, las de siempre', () => {
    expect(stripKinds(tree, 'esc')).toEqual(['scene', 'prepro', 'shot']);
    expect(stripKinds(tree, 'ficha')).toEqual(['shot', 'prepro']);
    expect(stripKinds(tree, 'loc')).toEqual(['location']);
    expect(stripKinds(tree, 'scout')).toEqual(['techScout', 'creativeScout']);
    expect(stripKinds(tree, 'dia')).toEqual(['onset']);
    expect(stripKinds(tree, 'suelta')).toEqual(DEFAULT_STRIP);
  });
});
