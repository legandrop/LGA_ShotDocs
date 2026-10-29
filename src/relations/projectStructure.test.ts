// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { kindReader } from './kind';
import { createStageFolders } from './projectStructure';

// Las carpetas de las etapas de un proyecto nuevo (D817): vacías, en orden y con su tipo, así lo que se crea adentro ya
// es escena, locación, scouting, prueba o día, y lo del archivo queda fuera de las relaciones.

const devices: Device[] = [];
afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.docs.dispose();
    d.db.close();
  }
});

describe('createStageFolders', () => {
  it('crea las etapas con su tipo, en el idioma pedido', async () => {
    const d = await makeDevice(new FakeServer());
    devices.push(d);
    const projectId = await d.tree.createProject('Nuevo');
    const ids = await createStageFolders(d.tree, projectId, 'es');
    const titles = (parent: string | null) => (parent ? d.tree.children(parent) : d.tree.roots(projectId)).map((p) => p.title);
    expect(titles(null)).toEqual(['1 | Preproducción', '2 | Scouting reports', '3 | Pruebas y previs', '4 | Rodaje', '5 | Referencias', '90 | Archivo']);
    expect(titles(ids.prepro)).toEqual(['1.1 | Escenas', '1.2 | Locaciones']);
    const kinds = kindReader(d.tree);
    const scene = await d.tree.create(ids.scenes, '001 | Llegada', projectId);
    const location = await d.tree.create(ids.locations, 'Puente La Boca', projectId);
    const scouting = await d.tree.create(ids.scouting, '2026-11-02 | Scouting | Puente La Boca', projectId);
    expect(kinds.kindOf(scene)).toMatchObject({ kind: 'scene', code: '001' });
    expect(kinds.kindOf(location)).toMatchObject({ kind: 'location' });
    expect(kinds.kindOf(scouting)).toMatchObject({ kind: 'doc', doc: 'scouting' });
    expect(d.tree.get(ids.shoot)?.settings?.dayReports).toEqual({});
    expect(d.tree.get(ids.archive)?.settings?.graph).toBe(false);
  });

  it('en inglés', async () => {
    const d = await makeDevice(new FakeServer());
    devices.push(d);
    const projectId = await d.tree.createProject('New');
    const ids = await createStageFolders(d.tree, projectId, 'en');
    expect(d.tree.children(ids.prepro).map((p) => p.title)).toEqual(['1.1 | Scenes', '1.2 | Locations']);
    expect(d.tree.get(ids.shoot)?.title).toBe('4 | Shoot');
  });
});
