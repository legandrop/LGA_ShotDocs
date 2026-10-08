import { afterEach, describe, expect, it } from 'vitest';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { BUILTIN_LOCATION, BUILTIN_SCENE } from '../templates/builtinIds';
import { installEntityMarks, markFolderHolds, markFromTemplate, placedEntity, setPageType, templateEntity } from './entitySync';
import { pageKind } from './kind';

// Las marcas de tipo con el árbol de verdad (PageTree con su cola y el servidor en memoria): marcar una carpeta, crear,
// renombrar y mover adentro, desmarcar, los días como carpeta de reportes, las plantillas, y que un cambio de otro ajuste
// hecho en otro dispositivo no borra la marca.

const devices: Device[] = [];
async function device(server: FakeServer): Promise<Device> {
  const d = await makeDevice(server);
  // Lo que hace services.ts.
  d.tree.onPlaced = (id, how) => placedEntity(d.tree, id, how);
  devices.push(d);
  return d;
}

afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
    d.mediaDb.close();
  }
});

const entity = (d: Device, id: string) => d.tree.get(id)?.settings?.entity;

/** El desglose de una serie: una carpeta, un episodio, dos escenas y una ficha adentro de una. */
async function breakdown(d: Device) {
  const desglose = await d.tree.create(null, '1.1 | Desglose');
  const ep = await d.tree.create(desglose, '105 | Episodio 5');
  const esc = await d.tree.create(ep, '027 | El vehículo comienza a zigzaguear');
  const ficha = await d.tree.create(esc, 'ERSO_105_027_010 Ambulancia');
  const notas = await d.tree.create(desglose, 'Notas generales');
  return { desglose, ep, esc, ficha, notas };
}

describe('marcar una carpeta', () => {
  it('marca el primer nivel y lo de adentro de los episodios, con su número; no los grupos ni las fichas', async () => {
    const a = await device(new FakeServer());
    const t = await breakdown(a);
    expect(entity(a, t.esc)).toBeUndefined();
    await markFolderHolds(a.tree, t.desglose, 'scene');
    expect(a.tree.get(t.desglose)?.settings?.holds).toBe('scene');
    expect(entity(a, t.esc)).toEqual({ kind: 'scene', code: '105_027' });
    expect(entity(a, t.notas)).toEqual({ kind: 'scene' });
    expect(entity(a, t.ep)).toBeUndefined();
    expect(entity(a, t.ficha)).toBeUndefined();
    expect(pageKind(a.tree, t.ficha)).toMatchObject({ kind: 'part', of: t.esc, code: '105_027' });
  });

  it('desmarcarla deja las marcas de las páginas (D-E2-3)', async () => {
    const a = await device(new FakeServer());
    const t = await breakdown(a);
    await markFolderHolds(a.tree, t.desglose, 'scene');
    await markFolderHolds(a.tree, t.desglose, null);
    expect(a.tree.get(t.desglose)?.settings?.holds).toBeUndefined();
    expect(entity(a, t.esc)).toEqual({ kind: 'scene', code: '105_027' });
    expect(pageKind(a.tree, t.esc)).toMatchObject({ kind: 'scene', source: 'page' });
  });

  it('no pisa una marca de otro tipo ni «nada de esto»', async () => {
    const a = await device(new FakeServer());
    const t = await breakdown(a);
    await setPageType(a.tree, t.notas, null);
    await setPageType(a.tree, t.esc, 'location');
    await markFolderHolds(a.tree, t.desglose, 'scene');
    expect(entity(a, t.notas)).toBe(false);
    expect(entity(a, t.esc)).toEqual({ kind: 'location' });
  });
});

describe('crear, renombrar y mover', () => {
  it('crear con título adentro de una carpeta marcada la marca; el «+» (sin título) espera al nombre', async () => {
    const a = await device(new FakeServer());
    const locs = await a.tree.create(null, 'Locaciones');
    await markFolderHolds(a.tree, locs, 'location');
    const cenade = await a.tree.create(locs, 'CENADE');
    expect(entity(a, cenade)).toEqual({ kind: 'location' });
    const nueva = await a.tree.create(locs, '');
    expect(entity(a, nueva)).toBeUndefined();
    expect(pageKind(a.tree, nueva)).toMatchObject({ kind: 'location', source: 'folder' });
    await a.tree.rename(nueva, 'La Arenera');
    expect(entity(a, nueva)).toEqual({ kind: 'location' });
  });

  it('nombrar un episodio nuevo no lo marca; las escenas de adentro toman su número', async () => {
    const a = await device(new FakeServer());
    const desglose = await a.tree.create(null, 'Desglose');
    await markFolderHolds(a.tree, desglose, 'scene');
    const ep = await a.tree.create(desglose, '');
    await a.tree.rename(ep, '106 | Episodio 6');
    expect(entity(a, ep)).toBeUndefined();
    const esc = await a.tree.create(ep, '012 | Entra la policía');
    expect(entity(a, esc)).toEqual({ kind: 'scene', code: '106_012' });
  });

  it('el código sigue al título mientras lo traiga; si deja de traerlo, el guardado se queda', async () => {
    const a = await device(new FakeServer());
    const desglose = await a.tree.create(null, 'Desglose');
    await markFolderHolds(a.tree, desglose, 'scene');
    const esc = await a.tree.create(desglose, '101_074 | Llegan al bar');
    expect(entity(a, esc)).toEqual({ kind: 'scene', code: '101_074' });
    await a.tree.rename(esc, '101_074A | Llegan al bar');
    expect(entity(a, esc)).toEqual({ kind: 'scene', code: '101_074A' });
    await a.tree.saveTitleDraft(esc, 'Llegan al bar');
    expect(entity(a, esc)).toEqual({ kind: 'scene', code: '101_074A' });
  });

  it('mover adentro marca (también un episodio entero); sacarla deja la marca', async () => {
    const a = await device(new FakeServer());
    const desglose = await a.tree.create(null, 'Desglose');
    await markFolderHolds(a.tree, desglose, 'scene');
    const suelta = await a.tree.create(null, '101_003 | Afuera');
    const ep = await a.tree.create(null, 'EP 102');
    const esc = await a.tree.create(ep, '045 | Persecución');
    expect(entity(a, suelta)).toBeUndefined();
    await a.tree.move(suelta, desglose);
    expect(entity(a, suelta)).toEqual({ kind: 'scene', code: '101_003' });
    await a.tree.move(ep, desglose);
    expect(entity(a, ep)).toBeUndefined();
    expect(entity(a, esc)).toEqual({ kind: 'scene', code: '102_045' });
    await a.tree.move(suelta, null);
    expect(entity(a, suelta)).toEqual({ kind: 'scene', code: '101_003' });
  });

  it('una página adentro de una escena no se marca (es parte de ella)', async () => {
    const a = await device(new FakeServer());
    const t = await breakdown(a);
    await markFolderHolds(a.tree, t.desglose, 'scene');
    const otra = await a.tree.create(t.esc, 'ERSO_105_027_020 Ambulancia');
    expect(entity(a, otra)).toBeUndefined();
    expect(pageKind(a.tree, otra)).toMatchObject({ kind: 'part', of: t.esc });
  });

  it('una importación (id reservado) no escribe marcas', async () => {
    const a = await device(new FakeServer());
    const locs = await a.tree.create(null, 'Locaciones');
    await markFolderHolds(a.tree, locs, 'location');
    const id = crypto.randomUUID();
    await a.tree.create(locs, 'CENADE', undefined, { id });
    expect(entity(a, id)).toBeUndefined();
  });
});

describe('Type a mano (auditoría de E2, O1)', () => {
  it('Scene sobre una escena que ya lo es no le borra el número si el título no da otro', async () => {
    const a = await device(new FakeServer());
    const t = await breakdown(a);
    await markFolderHolds(a.tree, t.desglose, 'scene');
    expect(entity(a, t.esc)).toEqual({ kind: 'scene', code: '105_027' });
    const tablas = await a.tree.create(null, 'Tablas');
    await a.tree.move(t.esc, tablas);
    await setPageType(a.tree, t.esc, 'scene');
    expect(entity(a, t.esc)).toEqual({ kind: 'scene', code: '105_027' });
  });
});

describe('dónde se instala la marca automática (auditoría de E2, O6)', () => {
  it('con una cuenta sí; con un link público no', async () => {
    const server = new FakeServer();
    const a = await makeDevice(server);
    devices.push(a);
    installEntityMarks(a.tree, true);
    expect(a.tree.onPlaced).toBeUndefined();
    installEntityMarks(a.tree, false);
    expect(a.tree.onPlaced).toBeTypeOf('function');
  });
});

describe('días de rodaje = carpeta de reportes del día (D369)', () => {
  it('marcar como días escribe `dayReports` y no `holds`; marcar otra cosa la deja de usar para reportes', async () => {
    const a = await device(new FakeServer());
    const rodaje = await a.tree.create(null, 'Rodaje');
    await markFolderHolds(a.tree, rodaje, 'day');
    expect(a.tree.get(rodaje)?.settings).toEqual({ dayReports: {} });
    const dia = await a.tree.create(rodaje, '2026-10-02 | Day 06');
    expect(entity(a, dia)).toEqual({ kind: 'day' });
    await markFolderHolds(a.tree, rodaje, 'location');
    expect(a.tree.get(rodaje)?.settings).toEqual({ dayReports: false, holds: 'location' });
    await markFolderHolds(a.tree, rodaje, 'day');
    expect(a.tree.get(rodaje)?.settings).toEqual({ dayReports: {} });
    await markFolderHolds(a.tree, rodaje, null);
    expect(a.tree.get(rodaje)?.settings).toEqual({ dayReports: false });
  });

  it('la plantilla de la carpeta de reportes se conserva al volver a marcarla como días', async () => {
    const a = await device(new FakeServer());
    const rodaje = await a.tree.create(null, 'Rodaje');
    await a.tree.setSetting(rodaje, 'dayReports', { template: 'abc' });
    await markFolderHolds(a.tree, rodaje, 'day');
    expect(a.tree.get(rodaje)?.settings).toEqual({ dayReports: { template: 'abc' } });
  });
});

describe('plantillas', () => {
  it('*Scene* y *Location* marcan la página esté donde esté; una propia que salió de ellas, también', async () => {
    const a = await device(new FakeServer());
    const p = await a.tree.create(null, '101_074 | Llegan al bar');
    await markFromTemplate(a.tree, p, BUILTIN_SCENE);
    expect(entity(a, p)).toEqual({ kind: 'scene', code: '101_074' });
    const own = await a.tree.create(null, 'Mi locación', undefined, { templateId: BUILTIN_LOCATION });
    expect(templateEntity(a.tree, own)).toBe('location');
    const q = await a.tree.create(null, 'CENADE');
    await markFromTemplate(a.tree, q, own);
    expect(entity(a, q)).toEqual({ kind: 'location' });
    const r = await a.tree.create(null, 'Otra');
    await markFromTemplate(a.tree, r, crypto.randomUUID());
    expect(entity(a, r)).toBeUndefined();
  });
});

describe('compatibilidad y sincronización', () => {
  it('otro dispositivo que cambia otro ajuste sin haber visto la marca no la borra (fusión por clave)', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const t = await breakdown(a);
    await a.engine.syncNow();
    const b = await device(server);
    await b.engine.syncNow();
    await markFolderHolds(a.tree, t.desglose, 'scene');
    await b.tree.setSetting(t.esc, 'format', { size: 'A4', landscape: false });
    await b.tree.setSetting(t.desglose, 'split', true);
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow();
    for (const d of [a, b]) {
      expect(d.tree.get(t.esc)?.settings).toEqual({ entity: { kind: 'scene', code: '105_027' }, format: { size: 'A4', landscape: false } });
      expect(d.tree.get(t.desglose)?.settings).toEqual({ holds: 'scene', split: true });
    }
    expect(server.pages.get(t.esc)?.settings).toEqual({ entity: { kind: 'scene', code: '105_027' }, format: { size: 'A4', landscape: false } });
    expect(a.tree.failedOps()).toEqual([]);
    expect(b.tree.failedOps()).toEqual([]);
  });

  it('las marcas se escriben sin red y suben después', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const locs = await a.tree.create(null, 'Locaciones');
    await a.engine.syncNow();
    server.online = false;
    await markFolderHolds(a.tree, locs, 'location');
    const cenade = await a.tree.create(locs, 'CENADE');
    expect(entity(a, cenade)).toEqual({ kind: 'location' });
    await a.engine.syncNow().catch(() => undefined);
    expect(server.pages.get(cenade)).toBeUndefined();
    server.online = true;
    await a.engine.syncNow();
    expect(server.pages.get(cenade)?.settings).toEqual({ entity: { kind: 'location' } });
    expect(server.pages.get(locs)?.settings).toEqual({ holds: 'location' });
  });
});
