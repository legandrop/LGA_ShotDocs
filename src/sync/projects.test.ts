import { afterEach, describe, expect, it } from 'vitest';
import { FakeServer, makeDevice, type Device } from './testing';

const devices: Device[] = [];
async function device(server: FakeServer): Promise<Device> {
  const d = await makeDevice(server);
  devices.push(d);
  return d;
}

afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
  }
});

describe('proyectos', () => {
  it('se crean sin red y suben antes que sus páginas', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const b = await device(server);

    server.online = false;
    const project = await a.tree.createProject('Bosque Negro');
    const root = await a.tree.create(null, 'Exteriores', project);
    const scene = await a.tree.create(root, '012 | Bosque nocturno');
    expect(a.tree.project(project)?.name).toBe('Bosque Negro');
    expect(a.tree.roots(project).map((p) => p.id)).toEqual([root]);
    expect(a.tree.roots(server.workspaceId)).toEqual([]);
    expect(a.tree.get(scene)?.workspace_id).toBe(project);
    await a.engine.syncNow();

    server.online = true;
    await a.engine.syncNow();
    expect(a.tree.pendingOps()).toEqual([]);
    expect(a.tree.failedOps()).toEqual([]);
    expect(server.projects.get(project)?.name).toBe('Bosque Negro');

    await b.engine.syncNow();
    expect(b.tree.projects().map((p) => p.name)).toEqual(['My project', 'Bosque Negro']);
    expect(b.tree.roots(project).map((p) => p.title)).toEqual(['Exteriores']);
    expect(b.tree.children(root).map((p) => p.title)).toEqual(['012 | Bosque nocturno']);
  });

  it('renombrar un proyecto llega a los otros dispositivos', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const b = await device(server);
    await a.tree.renameProject(server.workspaceId, 'MGTZD');
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(b.tree.project(server.workspaceId)?.name).toBe('MGTZD');
  });

  it('un proyecto rechazado no se pierde: queda a la vista con sus páginas y se puede reintentar', async () => {
    const server = new FakeServer();
    const a = await device(server);
    server.rejectProjects = true;
    const project = await a.tree.createProject('Pampa');
    const page = await a.tree.create(null, 'Brief', project);
    await a.engine.syncNow();

    expect(a.tree.failedOps().map((f) => f.op.kind)).toEqual(['createProject', 'create']);
    expect(a.tree.project(project)?.name).toBe('Pampa');
    expect(a.tree.roots(project).map((p) => p.id)).toEqual([page]);
    await a.tree.dismissFailed();
    expect(a.tree.failedOps()).toHaveLength(2);

    server.rejectProjects = false;
    await a.engine.retryRejected();
    await a.engine.syncNow();
    expect(a.tree.failedOps()).toEqual([]);
    expect(server.pages.get(page)?.workspace_id).toBe(project);
  });

  it('un proyecto rechazado y vacío se puede descartar', async () => {
    const server = new FakeServer();
    const a = await device(server);
    server.rejectProjects = true;
    const project = await a.tree.createProject('Vacío');
    await a.tree.renameProject(project, 'Vacío 2');
    await a.engine.syncNow();
    expect(a.tree.failedOps()).toHaveLength(2);
    expect(a.tree.project(project)?.name).toBe('Vacío 2');
    await a.tree.dismissFailed();
    expect(a.tree.failedOps()).toEqual([]);
    expect(a.tree.project(project)).toBeUndefined();
  });

  it('sin la lista de proyectos, el primero igual está y se puede renombrar', async () => {
    const server = new FakeServer();
    const a = await device(server);
    server.online = false;
    const other = await a.tree.createProject('Nuevo');
    await a.tree.renameProject(server.workspaceId, 'MGTZD');
    expect(a.tree.projects().map((p) => p.id).sort()).toEqual([server.workspaceId, other].sort());
    expect(a.tree.project(server.workspaceId)?.name).toBe('MGTZD');
    server.online = true;
    await a.engine.syncNow();
    expect(server.projects.get(server.workspaceId)?.name).toBe('MGTZD');
    expect(a.tree.projects().map((p) => p.name)).toEqual(['MGTZD', 'Nuevo']);
  });

  it('una página no se mueve a otro proyecto', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const other = await a.tree.createProject('Otro');
    const here = await a.tree.create(null, 'Acá');
    const there = await a.tree.create(null, 'Allá', other);
    await expect(a.tree.move(here, there)).rejects.toThrow(/another project/);
    await a.engine.syncNow();
    expect(a.tree.failedOps()).toEqual([]);
  });

  it('el orden en la raíz se calcula dentro de cada proyecto', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const other = await a.tree.createProject('Otro');
    const first = await a.tree.create(null, 'Primera');
    const x = await a.tree.create(null, 'X', other);
    const second = await a.tree.create(null, 'Segunda');
    await a.tree.move(second, null, { before: first });
    expect(a.tree.roots(server.workspaceId).map((p) => p.id)).toEqual([second, first]);
    expect(a.tree.roots(other).map((p) => p.id)).toEqual([x]);
  });
});
