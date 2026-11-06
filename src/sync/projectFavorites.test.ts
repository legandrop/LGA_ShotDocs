import { afterEach, describe, expect, it } from 'vitest';
import { RemoteError } from './types';
import { FakeServer, makeDevice, type Device } from './testing';

// Los proyectos favoritos (Docs/Doc_Navegacion.md, «Proyectos favoritos»): se marcan sin red, suben aparte de la cola del
// árbol, llegan a los otros dispositivos de la misma persona y nunca a los de otra; con una base anterior a la 30 esperan.

const devices: Device[] = [];
async function device(server: FakeServer, user: { id?: string } = {}): Promise<Device> {
  const d = await makeDevice(server, undefined, undefined, undefined, undefined, user);
  devices.push(d);
  return d;
}

afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
  }
});

describe('proyectos favoritos', () => {
  it('se marcan sin red, vuelven al recargar y llegan al otro dispositivo de la misma persona', async () => {
    const server = new FakeServer();
    server.enableProjectFavorites();
    const a = await device(server);
    const b = await device(server);
    await a.engine.syncNow();
    server.online = false;
    await a.tree.favoriteProject(server.workspaceId, true);
    expect(a.tree.project(server.workspaceId)?.favorite).toBe(true);
    // Aparte de la cola del árbol, y cuenta en los cambios sin subir.
    expect(a.tree.pendingOps()).toEqual([]);
    expect(a.tree.pendingProjectFavorites()).toEqual([{ id: server.workspaceId, favorite: true }]);
    await a.tree.load();
    expect(a.tree.project(server.workspaceId)?.favorite).toBe(true);
    server.online = true;
    await a.engine.syncNow();
    expect(server.favorites.has(`${server.ownerId}|${server.workspaceId}`)).toBe(true);
    expect(a.tree.pendingProjectFavorites()).toEqual([]);
    expect(a.tree.project(server.workspaceId)?.favorite).toBe(true);

    await b.engine.syncNow();
    expect(b.tree.project(server.workspaceId)?.favorite).toBe(true);
    await b.tree.favoriteProject(server.workspaceId, false);
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect(a.tree.project(server.workspaceId)?.favorite).toBe(false);
    expect(server.favorites.size).toBe(0);
  });

  it('desmarcar mientras sube la marca no se pierde (y al revés)', async () => {
    const server = new FakeServer();
    server.enableProjectFavorites();
    const a = await device(server);
    await a.engine.syncNow();
    const id = server.workspaceId;
    // Marca, y mientras la marca viaja (el servidor todavía dice que no) la desmarca.
    await a.tree.favoriteProject(id, true);
    await a.tree.favoriteProject(id, false);
    expect(a.tree.pendingProjectFavorites()).toEqual([{ id, favorite: false }]);
    // Vuelve la confirmación de la marca: la desmarca sigue pendiente.
    server.favorites.add(`${server.ownerId}|${id}`);
    await a.tree.settleProjectFavorite(id, true, true);
    expect(a.tree.pendingProjectFavorites()).toEqual([{ id, favorite: false }]);
    await a.engine.syncNow();
    expect(server.favorites.size).toBe(0);
    expect(a.tree.project(id)?.favorite).toBe(false);
    expect(a.tree.pendingProjectFavorites()).toEqual([]);
  });

  it('con la tabla faltante (versión 30 a medias) espera sin descartar', async () => {
    const server = new FakeServer();
    server.enableProjectFavorites();
    const a = await device(server);
    await a.engine.syncNow();
    await a.tree.favoriteProject(server.workspaceId, true);
    const original = a.remote.favoriteProject.bind(a.remote);
    a.remote.favoriteProject = async () => {
      throw new RemoteError('relation "public.project_favorites" does not exist', true, '42P01');
    };
    await a.engine.syncNow();
    expect(a.tree.pendingProjectFavorites()).toHaveLength(1);
    a.remote.favoriteProject = original;
    await a.engine.syncNow();
    expect(server.favorites.size).toBe(1);
  });

  it('los favoritos de otra persona no se ven', async () => {
    const server = new FakeServer();
    server.enableTeam();
    server.enableProjectFavorites();
    server.addMember('editor-1', 'member');
    server.grant('editor-1', { projectId: server.workspaceId }, 'edit');
    const owner = await device(server);
    const editor = await device(server, { id: 'editor-1' });
    await owner.engine.syncNow();
    await owner.tree.favoriteProject(server.workspaceId, true);
    await owner.engine.syncNow();
    await editor.engine.syncNow();
    expect(editor.tree.project(server.workspaceId)?.favorite).toBe(false);
  });

  it('con una base vieja espera; un proyecto que ya no está se descarta sin cortar la sincronización', async () => {
    const server = new FakeServer();
    server.enableProjectColor();
    const a = await device(server);
    await a.engine.syncNow();
    await a.tree.favoriteProject(server.workspaceId, true);
    await a.engine.syncNow();
    expect(a.tree.pendingProjectFavorites()).toHaveLength(1);
    expect(server.favorites.size).toBe(0);
    server.enableProjectFavorites();
    await a.engine.syncNow();
    await a.engine.syncNow();
    expect(server.favorites.size).toBe(1);
    expect(a.tree.pendingProjectFavorites()).toEqual([]);

    const other = await a.tree.createProject('Pampa');
    await a.engine.syncNow();
    await a.tree.favoriteProject(other, true);
    server.projects.delete(other);
    await a.engine.syncNow();
    expect(a.tree.pendingProjectFavorites()).toEqual([]);
    expect(a.engine.getStatus().lastError).toBeNull();
  });
});
