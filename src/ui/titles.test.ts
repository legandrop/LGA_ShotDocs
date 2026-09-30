import { afterEach, describe, expect, it } from 'vitest';
import { cleanPrefs, DEFAULT_PREFS } from '../prefs';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import type { PageRow } from '../sync/types';
import { headerLevels, headerPages, splitEnabled, splitSiblings, splitTitle } from './titles';

const devices: Device[] = [];
afterEach(async () => {
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.db.close();
  }
});

const row = (id: string, title: string) => ({ id, title }) as PageRow;

describe('títulos divididos por "|"', () => {
  it('divide solo cuando hay código y nombre', () => {
    expect(splitTitle('064 | Cubiertos pegados | Bar Caballero')).toEqual({ code: '064', name: 'Cubiertos pegados' });
    expect(splitTitle('MGTZD | Brief')).toEqual({ code: 'MGTZD', name: 'Brief' });
    expect(splitTitle('Uruguay')).toBeNull();
    expect(splitTitle('| Sin código')).toBeNull();
    expect(splitTitle('064 |')).toBeNull();
  });

  it('una lista se divide solo si ningún código pasa de 7 caracteres', () => {
    const list = [row('a', '003A | Iglesia PG'), row('b', '009ab | Cámara Gesell'), row('c', 'Notas')];
    const split = splitSiblings(list);
    expect(split?.width).toBe(5);
    expect(split?.titles.get('a')).toEqual({ code: '003A', name: 'Iglesia PG' });
    expect(split?.titles.has('c')).toBe(false);

    expect(splitSiblings([...list, row('d', 'Producción | Notas')])).toBeNull();
    expect(splitSiblings([row('e', 'Uruguay'), row('f', 'Jujuy')])).toBeNull();
  });
});

describe('ajustes por rama', () => {
  it('se heredan, se pisan más abajo y viajan a otro dispositivo', async () => {
    const server = new FakeServer();
    const a = await makeDevice(server);
    const b = await makeDevice(server);
    devices.push(a, b);

    const show = await a.tree.create(null, 'MGTZD | Brief');
    const country = await a.tree.create(show, 'Uruguay');
    const scene = await a.tree.create(country, '064 | Cubiertos pegados | Bar Caballero');

    expect(headerLevels(a.tree, scene)).toEqual({ levels: 2, last: 2, from: null });
    expect(headerPages(a.tree, scene).map((p) => p.title)).toEqual(['MGTZD | Brief', 'Uruguay']);
    expect(splitEnabled(a.tree, country)).toBe(true);

    await a.tree.setSetting(show, 'header', { levels: 1 });
    await a.tree.setSetting(show, 'split', false);
    expect(headerPages(a.tree, scene).map((p) => p.title)).toEqual(['Uruguay']);
    expect(headerLevels(a.tree, scene).from?.id).toBe(show);
    expect(splitEnabled(a.tree, country)).toBe(false);

    await a.tree.setSetting(scene, 'header', { levels: 0 });
    expect(headerPages(a.tree, scene)).toEqual([]);
    await a.tree.setSetting(country, 'header', { levels: null });
    expect(headerPages(a.tree, scene)).toEqual([]);
    await a.tree.setSetting(scene, 'header', undefined);
    expect(headerPages(a.tree, scene).map((p) => p.title)).toEqual(['MGTZD | Brief', 'Uruguay']);

    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(b.tree.get(show)?.settings).toEqual({ header: { levels: 1 }, split: false });
    expect(headerLevels(b.tree, scene)).toEqual({ levels: null, last: null, from: b.tree.get(country) });
  });

  it('un ajuste que no se entiende cuenta como no puesto y se hereda el de más arriba', async () => {
    const server = new FakeServer();
    const a = await makeDevice(server);
    devices.push(a);
    const show = await a.tree.create(null, 'Show');
    const scene = await a.tree.create(show, 'Escena');
    await a.tree.setPatch(scene, { settings: { header: { levels: -3 }, split: 'no' as never } });
    expect(headerLevels(a.tree, scene).levels).toBe(2);
    await a.tree.setSetting(show, 'header', { levels: 1 });
    await a.tree.setSetting(show, 'split', false);
    expect(headerLevels(a.tree, scene)).toMatchObject({ levels: 1, from: { id: show } });
    expect(splitEnabled(a.tree, scene)).toBe(false);
    await a.tree.setPatch(scene, { settings: { header: 'x' as never } });
    expect(headerLevels(a.tree, scene).levels).toBe(1);
  });

  it('al volver a mostrar el encabezado recuerda cuántos niveles tenía', async () => {
    const server = new FakeServer();
    const a = await makeDevice(server);
    devices.push(a);
    const show = await a.tree.create(null, 'Show');
    await a.tree.setSetting(show, 'header', { levels: 0, last: null });
    expect(headerLevels(a.tree, show)).toMatchObject({ levels: 0, last: null });
    await a.tree.setSetting(show, 'header', { levels: 0, last: 3 });
    expect(headerLevels(a.tree, show)).toMatchObject({ levels: 0, last: 3 });
  });
});

describe('preferencias de la cuenta', () => {
  it('descarta valores desconocidos', () => {
    expect(cleanPrefs(null)).toEqual(DEFAULT_PREFS);
    expect(cleanPrefs({ theme: 'dark', font: 'comic', textSize: 'large', extra: 1 })).toEqual({
      ...DEFAULT_PREFS,
      theme: 'dark',
      textSize: 'large',
    });
  });
});
