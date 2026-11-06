import { afterEach, describe, expect, it } from 'vitest';
import { FakeServer, makeDevice, type Device } from './testing';
import { normalizeProjectName } from './tree';

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
  it('el nombre de un proyecto queda igual si se normaliza otra vez (cortado, sin un espacio en la punta)', async () => {
    // 199 letras, un espacio y más texto: al cortar en 200 el último carácter es el espacio.
    const long = `${'x'.repeat(199)} cola que no entra`;
    const once = normalizeProjectName(long);
    expect(once).toBe('x'.repeat(199));
    expect(normalizeProjectName(once)).toBe(once);
    for (const name of ['  Bosque Negro  ', 'a', `${'ñ'.repeat(200)}  `, '   ', '']) expect(normalizeProjectName(normalizeProjectName(name))).toBe(normalizeProjectName(name));
    const a = await device(new FakeServer());
    expect(a.tree.project(await a.tree.createProject(long))?.name).toBe(once);
  });

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

  it('el color del proyecto se elige sin red, sube y llega a los otros dispositivos; el de fábrica lo deja sin elegir', async () => {
    const server = new FakeServer();
    server.enableProjectColor();
    const a = await device(server);
    const b = await device(server);
    await a.engine.syncNow();
    server.online = false;
    await a.tree.colorProject(server.workspaceId, '#8E2E5A');
    expect(a.tree.project(server.workspaceId)?.color).toBe('#8e2e5a');
    // Un color roto no se guarda.
    await a.tree.colorProject(server.workspaceId, 'rojo');
    expect(a.tree.pendingProjectColors()).toEqual([{ id: server.workspaceId, color: '#8e2e5a' }]);
    // No va en la cola del árbol (una versión anterior no arranca con un cambio que no conoce en su cola), y vuelve
    // al recargar la app.
    expect(a.tree.pendingOps()).toEqual([]);
    expect(await a.db.getAll('ops')).toEqual([]);
    await a.tree.load();
    expect(a.tree.project(server.workspaceId)?.color).toBe('#8e2e5a');
    // Sin la cola del árbol, el pendiente queda aparte (y el estado lo suma a los cambios sin subir).
    expect(a.tree.pendingProjectColors().length + a.tree.pendingOps().length).toBe(1);
    server.online = true;
    await a.engine.syncNow();
    expect(server.projects.get(server.workspaceId)?.color).toBe('#8e2e5a');
    await b.engine.syncNow();
    expect(b.tree.project(server.workspaceId)?.color).toBe('#8e2e5a');
    await b.tree.colorProject(server.workspaceId, null);
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect(a.tree.project(server.workspaceId)?.color ?? null).toBeNull();
    expect(a.tree.failedOps()).toEqual([]);
    expect(a.tree.pendingProjectColors()).toEqual([]);
  });

  it('el color de un proyecto creado sin red espera a que el proyecto suba (también si lo rechazan)', async () => {
    const server = new FakeServer();
    server.enableProjectColor();
    const a = await device(server);
    await a.engine.syncNow();
    server.rejectProjects = true;
    const project = await a.tree.createProject('Pampa');
    await a.tree.colorProject(project, '#774dcb');
    await a.engine.syncNow();
    // Rechazado: el proyecto sigue a la vista con su color, que espera.
    expect(a.tree.failedOps().map((f) => f.op.kind)).toEqual(['createProject']);
    expect(a.tree.project(project)?.color).toBe('#774dcb');
    expect(a.tree.pendingProjectColors()).toEqual([{ id: project, color: '#774dcb' }]);
    server.rejectProjects = false;
    await a.engine.retryRejected();
    await a.engine.syncNow();
    await a.engine.syncNow();
    expect(server.projects.get(project)?.color).toBe('#774dcb');
    expect(a.tree.pendingProjectColors()).toEqual([]);
  });

  it('el color de un proyecto que no se puede cambiar se descarta sin cortar la sincronización; con una base vieja espera', async () => {
    const server = new FakeServer();
    server.enableProjectPurge();
    const a = await device(server);
    await a.engine.syncNow();
    await a.tree.colorProject(server.workspaceId, '#2e5a8e');
    await a.engine.syncNow();
    // Base 23: el color espera en el dispositivo.
    expect(a.tree.pendingProjectColors()).toHaveLength(1);
    expect(server.projects.get(server.workspaceId)?.color).toBeUndefined();
    server.enableProjectColor();
    await a.engine.syncNow();
    await a.engine.syncNow();
    expect(server.projects.get(server.workspaceId)?.color).toBe('#2e5a8e');
    expect(a.tree.pendingProjectColors()).toEqual([]);
    // Un proyecto que no está en el servidor: rechazado para siempre, se descarta.
    await a.tree.colorProject(server.workspaceId, '#443a91');
    server.projects.delete(server.workspaceId);
    await a.engine.syncNow();
    expect(a.tree.pendingProjectColors()).toEqual([]);
    expect(a.engine.getStatus().lastError).toBeNull();
  });

  it('con una base sin el color (antes de la versión 27) no se pide la columna', async () => {
    const server = new FakeServer();
    server.enableProjectPurge();
    server.projects.set(server.workspaceId, { ...server.projects.get(server.workspaceId)!, color: '#123456' });
    const a = await device(server);
    await a.engine.syncNow();
    expect(a.tree.project(server.workspaceId)?.color).toBeUndefined();
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
