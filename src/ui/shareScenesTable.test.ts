import { describe, expect, it } from 'vitest';
import { filterRows, optionsOf, sceneName, sortRows, type RowFacts, type SceneRow } from './shareScenesTable';

// La tabla de *Share scenes* (v0.330; vendors desde la v0.331): el nombre sin el número, el orden de cada columna y los
// filtros.

const row = (code: string, extra: Partial<SceneRow> = {}): SceneRow => ({
  pageId: `p${code}`,
  code,
  title: `${code} | Escena ${code}`,
  inside: 0,
  blocked: false,
  label: code,
  name: `Escena ${code}`,
  locations: [],
  sets: [],
  intExt: [],
  ...extra,
});
const facts = (vendors: Record<string, string> = {}, seen: Record<string, number> = {}, mine: string[] = []): RowFacts => ({
  status: () => 'none',
  vendors: (id) => vendors[id] ?? '',
  seenBy: (id) => seen[id] ?? 0,
  mine: (id) => mine.includes(id),
});
const codes = (rows: SceneRow[]) => rows.map((r) => r.code);

describe('shareScenesTable', () => {
  it('el nombre va sin el número de adelante, en la forma nueva y en la vieja', () => {
    expect(sceneName('1013 | Plaza', '101_013')).toBe('Plaza');
    expect(sceneName('013 | Plaza | 101_013', '101_013')).toBe('Plaza');
    expect(sceneName('Plaza vacía', '101_013')).toBe('Plaza vacía');
    expect(sceneName('1013', '101_013')).toBe('');
  });

  it('ordena por número de verdad (no como texto), y al revés', () => {
    const rows = [row('101_010'), row('101_002'), row('101_100')];
    expect(codes(sortRows(rows, { key: 'code', dir: 1 }, facts()))).toEqual(['101_002', '101_010', '101_100']);
    expect(codes(sortRows(rows, { key: 'code', dir: -1 }, facts()))).toEqual(['101_100', '101_010', '101_002']);
  });

  it('una columna vacía va siempre al final, ordene como ordene; los empates, por número', () => {
    const rows = [row('101_003', { locations: ['Bar'] }), row('101_001'), row('101_002', { locations: ['Arrabal'] }), row('101_004', { locations: ['Bar'] })];
    expect(codes(sortRows(rows, { key: 'location', dir: 1 }, facts()))).toEqual(['101_002', '101_003', '101_004', '101_001']);
    expect(codes(sortRows(rows, { key: 'location', dir: -1 }, facts()))).toEqual(['101_003', '101_004', '101_002', '101_001']);
  });

  it('ordena por vendors (sin vendor, al final)', () => {
    const rows = [row('101_001'), row('101_002'), row('101_003')];
    expect(codes(sortRows(rows, { key: 'vendors', dir: 1 }, facts({ p101_002: 'FS', p101_003: 'DN FS' })))).toEqual(['101_003', '101_002', '101_001']);
  });

  it('filtra por locación, decorado, vista y texto (también la locación y el decorado)', () => {
    const rows = [
      row('101_001', { locations: ['Arrabal'], sets: ['Altillo'] }),
      row('101_002', { locations: ['Casa Müller'], sets: ['Cocina'], blocked: true }),
      row('101_003', { locations: ['Arrabal'], sets: ['Calle'] }),
    ];
    const fx = facts({ p101_001: 'DN', p101_003: 'DN FS' }, { p101_003: 2 }, ['p101_003']);
    const f = { text: '', view: 'all' as const, location: '', set: '' };
    expect(codes(filterRows(rows, { ...f, location: 'Arrabal' }, fx))).toEqual(['101_001', '101_003']);
    expect(codes(filterRows(rows, { ...f, set: 'Cocina' }, fx))).toEqual(['101_002']);
    expect(codes(filterRows(rows, { ...f, view: 'mine' }, fx))).toEqual(['101_003']);
    expect(codes(filterRows(rows, { ...f, view: 'none' }, fx))).toEqual(['101_002']);
    expect(codes(filterRows(rows, { ...f, view: 'multi' }, fx))).toEqual(['101_003']);
    expect(codes(filterRows(rows, { ...f, view: 'blocked' }, fx))).toEqual(['101_002']);
    expect(codes(filterRows(rows, { ...f, text: 'altillo' }, fx))).toEqual(['101_001']);
    expect(codes(filterRows(rows, { ...f, text: '101_002' }, fx))).toEqual(['101_002']);
    expect(codes(filterRows(rows, { ...f, text: 'fs' }, fx))).toEqual(['101_003']);
    expect(optionsOf(rows, 'locations')).toEqual(['Arrabal', 'Casa Müller']);
  });
});
