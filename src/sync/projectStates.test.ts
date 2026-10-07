import { afterEach, describe, expect, it } from 'vitest';
import { Permissions } from './access';
import { deleteWord, deleteWordMatches, isOnlyActiveProject, nextProjectAfter, unsyncedInProject } from './projectStates';
import { PROJECT_STATES_SCHEMA_VERSION, SupabaseRemote } from './remote';
import { FakeServer, makeDevice, type Device } from './testing';

// Archivar, borrar y restaurar proyectos (P.14, Docs/Doc_Proyectos_Borrar.md) en la sincronización, contra el
// servidor en memoria: qué ve cada dispositivo, que lo que no se subió no se pierde y vuelve al restaurar, el
// "primer proyecto" de cada dispositivo, y una base sin la migración. Las reglas de la base están en
// supabase/tests/proyectos_borrar_permisos.sql.

const devices: Device[] = [];
afterEach(async () => {
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
  }
});

async function device(server: FakeServer, user: { id?: string } = {}, dbName?: string): Promise<Device> {
  const d = await makeDevice(server, dbName, undefined, undefined, undefined, user);
  devices.push(d);
  return d;
}

/** Un workspace con las reglas del equipo, en la versión 9, con dos proyectos del dueño: P (el primero) y O. */
async function workspace(): Promise<{ server: FakeServer; owner: Device; p: string; o: string }> {
  const server = new FakeServer();
  server.enableTeam();
  server.enableProjectStates();
  const owner = await device(server);
  await owner.engine.syncNow();
  const o = await owner.tree.createProject('O');
  await owner.engine.syncNow();
  return { server, owner, p: server.workspaceId, o };
}

async function write(d: Device, pageId: string, text: string): Promise<void> {
  const doc = await d.docs.open(pageId);
  doc.getText('t').insert(0, text);
  await d.docs.flush(pageId);
  d.docs.close(pageId);
}

const perms = (d: Device) => new Permissions(d.tree, d.access.get(), d.remote.userId);

describe('la palabra de confirmación', () => {
  it('es la del idioma de la app, sin mayúsculas ni espacios de más; la del otro idioma no vale', () => {
    expect(deleteWord('en')).toBe('delete');
    expect(deleteWord('es')).toBe('borrar');
    expect(deleteWordMatches('  DELETE ', 'en')).toBe(true);
    expect(deleteWordMatches('Borrar', 'es')).toBe(true);
    expect(deleteWordMatches('borrar', 'en')).toBe(false);
    expect(deleteWordMatches('delete', 'es')).toBe(false);
    expect(deleteWordMatches('delet', 'en')).toBe(false);
    expect(deleteWordMatches('', 'en')).toBe(false);
  });
});

describe('archivar', () => {
  it('sale de la lista de todos los días y queda en la de archivados, con los mismos permisos; desarchivar lo devuelve', async () => {
    const { server, owner, p, o } = await workspace();
    server.addMember('ana', 'member');
    server.grant('ana', { projectId: o }, 'edit');
    const ana = await device(server, { id: 'ana' });
    await ana.engine.syncNow();

    await owner.remote.setProjectArchived(o, true);
    await owner.engine.syncNow();
    await ana.engine.syncNow();
    expect(owner.tree.activeProjects().map((x) => x.id)).toEqual([p]);
    expect(owner.tree.archivedProjects().map((x) => x.id)).toEqual([o]);
    // Ana lo ve igual (archivado) y sigue editando.
    expect(ana.tree.archivedProjects().map((x) => x.id)).toEqual([o]);
    expect(perms(ana).projectLevel(o)).toBe(3);

    await owner.remote.setProjectArchived(o, false);
    await owner.engine.syncNow();
    expect(owner.tree.archivedProjects()).toEqual([]);
    expect(owner.tree.activeProjects().map((x) => x.id)).toEqual([p, o]);
  });

  it('quien no maneja el proyecto no lo archiva ni lo borra; en el dispositivo, canManageProject da lo mismo', async () => {
    const { server, p } = await workspace();
    server.addMember('ana', 'member');
    server.grant('ana', { projectId: p }, 'edit_pages');
    server.addMember('ad', 'admin');
    server.grant('ad', { projectId: p }, 'edit_pages');
    const ana = await device(server, { id: 'ana' });
    const ad = await device(server, { id: 'ad' });
    await ana.engine.syncNow();
    await ad.engine.syncNow();
    expect(perms(ana).canManageProject(p)).toBe(false);
    expect(perms(ad).canManageProject(p)).toBe(true);
    await expect(ana.remote.setProjectArchived(p, true)).rejects.toThrow('not_allowed');
    await expect(ana.remote.deleteProject(p)).rejects.toThrow('not_allowed');
    await ad.remote.setProjectArchived(p, true);
    expect(server.projects.get(p)?.archived_at).toBeTruthy();
  });
});

describe('borrar y restaurar', () => {
  it('otro dispositivo deja de verlo, conserva lo que no subió como rechazado, y al restaurar todo sube sin perder nada', async () => {
    const { server, owner, p, o } = await workspace();
    const page = await owner.tree.create(null, 'Escena', o);
    await owner.engine.syncNow();
    await write(owner, page, 'subido');
    await owner.engine.syncNow();

    // Otro dispositivo del dueño, con cambios de O sin subir.
    const other = await device(server);
    await other.engine.syncNow();
    server.online = false;
    await write(other, page, 'sin subir ');
    const offline = await other.tree.create(null, 'Hecha sin red', o);
    await write(other, offline, 'texto nuevo');
    server.online = true;

    await owner.remote.deleteProject(o);
    await owner.tree.forgetProject(o);
    await owner.engine.syncNow();
    expect(owner.tree.projects().map((x) => x.id)).toEqual([p]);

    await other.engine.syncNow();
    // El proyecto ya no viene; lo que no se subió queda en el dispositivo, a la vista como rechazado.
    expect(other.tree.project(o)).toBeUndefined();
    expect(other.tree.failedOps().map((f) => f.op.kind)).toEqual(['create']);
    expect(await other.docs.unsyncedPages()).toEqual(expect.arrayContaining([page, offline]));
    expect(server.pages.get(offline)).toBeUndefined();

    await owner.remote.restoreProject(o);
    // *Retry* (o volver a abrir la app): el árbol y el contenido rechazados se reintentan.
    await other.tree.retryFailed();
    await other.engine.retryRejected();
    await other.engine.syncNow();
    await other.engine.syncNow();
    expect(other.tree.failedOps()).toEqual([]);
    expect(other.tree.project(o)?.name).toBe('O');
    expect(server.pages.get(offline)?.title).toBe('Hecha sin red');

    // El dueño ve lo que el otro dispositivo había escrito, una sola vez.
    await owner.engine.syncNow();
    const doc = await owner.docs.open(page);
    expect(doc.getText('t').toString()).toBe('sin subir subido');
  });

  it('con el proyecto borrado nadie lo ve: ni su creador, ni quien tenía una página compartida', async () => {
    const { server, owner, o } = await workspace();
    const page = await owner.tree.create(null, 'Escena', o);
    await owner.engine.syncNow();
    server.addMember('gu', 'guest');
    server.grant('gu', { pageId: page }, 'view');
    const gu = await device(server, { id: 'gu' });
    await gu.engine.syncNow();
    expect(gu.tree.get(page)?.title).toBe('Escena');

    await owner.remote.deleteProject(o);
    await gu.engine.syncNow();
    expect(gu.tree.get(page)).toBeUndefined();
    expect(gu.tree.project(o)).toBeUndefined();
    // En la papelera de proyectos lo ve, sin poder restaurarlo y sin saber quién lo borró ni cuánto tenía.
    const [row] = (await gu.remote.trashedProjects())!;
    expect(row).toMatchObject({ id: o, can_restore: false, deleted_by_email: null, pages: null, files: null });
    await expect(gu.remote.restoreProject(o)).rejects.toThrow('not_allowed');
  });

  it('el "primer proyecto" de un dispositivo, si lo borran, se reemplaza por el primero activo (sin el renglón vacío)', async () => {
    const { server, owner, p, o } = await workspace();
    // Otro dispositivo cuyo primer proyecto es P.
    const other = await device(server);
    await other.engine.syncNow();
    expect(other.tree.workspaceId).toBe(p);

    await owner.remote.deleteProject(p);
    await other.engine.syncNow();
    expect(other.tree.workspaceId).toBe(o);
    expect(other.tree.projects().map((x) => x.id)).toEqual([o]);
    // Una página nueva sin proyecto va al nuevo primero, no al borrado.
    const created = await other.tree.create(null, 'Nueva');
    expect(other.tree.get(created)?.workspace_id).toBe(o);
    // Queda guardado: al volver a abrir la app arranca en O.
    expect(await other.db.get('meta', 'workspaceId')).toBe(o);
  });

  it('con todos los proyectos borrados, el dispositivo queda "sin proyectos" (y vuelve al restaurar)', async () => {
    const { server, owner, p, o } = await workspace();
    await owner.remote.deleteProject(o);
    await owner.remote.deleteProject(p);
    await owner.engine.syncNow();
    expect(owner.tree.hasNoProjects()).toBe(true);
    await owner.remote.restoreProject(o);
    await owner.engine.syncNow();
    expect(owner.tree.hasNoProjects()).toBe(false);
    expect(owner.tree.workspaceId).toBe(o);
    expect(server.deletedProjects.has(p)).toBe(true);
  });

  it('archivados al final: con el primero archivado, el reemplazo prefiere uno activo', async () => {
    const { owner, p, o } = await workspace();
    await owner.remote.setProjectArchived(o, true);
    await owner.engine.syncNow();
    await owner.remote.deleteProject(p);
    await owner.engine.syncNow();
    // Solo queda O, archivado: el primero pasa a ser ese (no hay otro), y no es "sin proyectos".
    expect(owner.tree.workspaceId).toBe(o);
    expect(owner.tree.hasNoProjects()).toBe(false);
  });

  it('un archivo de otro proyecto usado solo en el borrado no se manda a la papelera de Drive', async () => {
    const { server, owner, o } = await workspace();
    const page = await owner.tree.create(null, 'Escena', o);
    await owner.engine.syncNow();
    server.enableTrash();
    server.enableProjectStates();
    server.mediaFiles.set('f3', {
      id: 'f3', name: 'f3.jpg', mime: 'image/jpeg', width: null, height: null, duration: null, thumb_at: null,
      drive_id: 'd3', size: 10, trashed_at: null, purged_at: null, drive_trashed_at: null, project_id: server.workspaceId,
    });
    server.pageFiles.add(`${page}:f3`);
    await owner.remote.deleteProject(o);
    expect(server.mediaFiles.get('f3')?.trashed_at).toBeTruthy();
    const rows = await owner.remote.trashedFiles(server.workspaceId);
    expect(rows.find((r) => r.id === 'f3')?.in_deleted_project).toBe(true);
    expect(() => server.purgeFile(server.ownerId, 'f3')).toThrow('file_in_deleted_project');
    await owner.remote.restoreProject(o);
    expect(server.mediaFiles.get('f3')?.trashed_at).toBeNull();
  });
});

describe('lo que no se subió de un proyecto, en este dispositivo', () => {
  it('cuenta los cambios del árbol, el contenido y los rechazados de ese proyecto y de ningún otro', async () => {
    const { server, owner, p, o } = await workspace();
    const inO = await owner.tree.create(null, 'En O', o);
    await owner.engine.syncNow();
    const queues = { tree: owner.tree, docs: owner.docs, files: owner.files, media: owner.media, comments: owner.comments };
    expect(await unsyncedInProject(queues, o)).toBe(0);
    server.online = false;
    await write(owner, inO, 'sin subir');
    await owner.tree.create(null, 'Nueva en O', o);
    await owner.tree.create(null, 'Nueva en P', p);
    expect(await unsyncedInProject(queues, o)).toBe(2);
    expect(await unsyncedInProject(queues, p)).toBe(1);
    server.online = true;
    await owner.engine.syncNow();
    expect(await unsyncedInProject(queues, o)).toBe(0);
  });
});

describe('a cuál se pasa y el último activo', () => {
  it('el de abajo; si era el último, el de arriba; sin otro activo, ninguno', async () => {
    const { owner, p, o } = await workspace();
    const q = await owner.tree.createProject('Q');
    await owner.engine.syncNow();
    // El orden de la lista (por fecha de creación; dos creados en el mismo milisegundo, por id).
    const [first, second, third] = owner.tree.activeProjects().map((x) => x.id);
    expect(first).toBe(p);
    expect(nextProjectAfter(owner.tree, first)).toBe(second);
    expect(nextProjectAfter(owner.tree, second)).toBe(third);
    expect(nextProjectAfter(owner.tree, third)).toBe(second);
    expect(isOnlyActiveProject(owner.tree, p)).toBe(false);
    await owner.remote.setProjectArchived(o, true);
    await owner.remote.setProjectArchived(q, true);
    await owner.engine.syncNow();
    expect(isOnlyActiveProject(owner.tree, p)).toBe(true);
    expect(nextProjectAfter(owner.tree, p)).toBeNull();
  });
});

describe('una base sin la migración 9', () => {
  it('la sincronización sigue: no pide archived_at, no hay funciones nuevas, y todo lo demás anda', async () => {
    const server = new FakeServer();
    server.enableTeam();
    server.settings = { ...server.settings!, schemaVersion: 8 };
    const owner = await device(server);
    await owner.engine.syncNow();
    const page = await owner.tree.create(null, 'Sigue andando');
    await owner.engine.syncNow();
    expect(owner.tree.failedOps()).toEqual([]);
    expect(server.pages.get(page)?.title).toBe('Sigue andando');
    expect(owner.engine.getStatus().schemaVersion).toBe(8);
    expect(owner.remote.fetchProjectsVersions.at(-1)).toBe(8);
    expect(owner.tree.projects()[0]).not.toHaveProperty('archived_at');
    expect(await owner.remote.trashedProjects()).toBeNull();
    await expect(owner.remote.deleteProject(server.workspaceId)).rejects.toMatchObject({ code: 'PGRST202' });
  });

  it('con la versión 9, fetchProjects pide archived_at; si la columna falta igual (42703), sigue sin ella', async () => {
    const calls: string[] = [];
    let missing = true;
    const client = {
      from: () => ({
        select: (columns: string) => {
          // El orden va por dos columnas (fecha y id); la respuesta trae el total, como la API cuando se le pide.
          const query = {
            order: () => query,
            limit: async () => {
              calls.push(columns);
              if (missing && columns.includes('archived_at')) {
                return { data: null, error: { message: 'column workspaces.archived_at does not exist', code: '42703' }, status: 400 };
              }
              return { data: [{ id: 'p1', name: 'P', created_at: '2026-01-01', owner_id: 'u' }], error: null, status: 200, count: 1 };
            },
          };
          return query;
        },
      }),
    };
    const remote = new SupabaseRemote(client as never);
    expect(await remote.fetchProjects(8)).toHaveLength(1);
    expect(calls).toEqual(['id, name, created_at, owner_id']);
    calls.length = 0;
    expect(await remote.fetchProjects(PROJECT_STATES_SCHEMA_VERSION)).toHaveLength(1);
    expect(calls).toEqual(['id, name, created_at, owner_id, archived_at', 'id, name, created_at, owner_id']);
    // Lo recuerda un rato: no vuelve a pedir la columna enseguida.
    calls.length = 0;
    missing = false;
    await remote.fetchProjects(PROJECT_STATES_SCHEMA_VERSION);
    expect(calls).toEqual(['id, name, created_at, owner_id']);
  });

  it('trashed_projects sin la función (PGRST202) da null; los números llegan como número', async () => {
    const rpc = (answer: { data?: unknown; error?: { message: string; code?: string } | null }) =>
      new SupabaseRemote({ rpc: async () => ({ data: null, error: null, status: 200, ...answer }) } as never);
    expect(await rpc({ error: { message: 'Could not find the function', code: 'PGRST202' } }).trashedProjects()).toBeNull();
    const [row] = (await rpc({
      data: [{ id: 'p', name: 'P', archived_at: null, deleted_at: '2026-10-01T00:00:00Z', deleted_by: null, deleted_by_email: null, days_left: '29', can_restore: true, pages: '3', files: null }],
    }).trashedProjects())!;
    expect(row).toMatchObject({ days_left: 29, pages: 3, files: null, can_restore: true });
    const info = await rpc({ data: { pages: '2', drive_bytes: '5000000000', shared_with: 1 } }).projectDeleteInfo('p');
    expect(info).toMatchObject({ pages: 2, drive_bytes: 5000000000, shared_with: 1, files: 0, foreign_only_here: 0 });
  });
});

// *Delete forever* en el servidor de las pruebas, igual que `purge_project` (O3 de la auditoría de la entrega 3): la
// carpeta mandada a la papelera de Drive cubre solo lo subido hasta el pedido; lo subido después fue a otra carpeta.
describe('Delete forever: la carpeta cubre solo lo subido hasta el pedido, como la base', () => {
  const DAY = 86_400_000;
  const iso = (ms: number) => new Date(ms).toISOString();

  async function purgeable(uploadedAt: (requested: number) => (string | null)[]) {
    const { server, owner, o } = await workspace();
    server.enableProjectPurge();
    await owner.engine.syncNow();
    const requested = Date.now() - 2 * DAY;
    uploadedAt(requested).forEach((at, i) => {
      server.mediaFiles.set(`f${i}`, {
        id: `f${i}`, name: `f${i}.jpg`, mime: 'image/jpeg', width: null, height: null, duration: null, thumb_at: null,
        drive_id: `drive_f${i}_xxxxx`, size: 10, trashed_at: null, purged_at: null, drive_trashed_at: null, project_id: o,
        uploaded_at: at,
      });
    });
    await owner.remote.deleteProject(o);
    server.deletedProjects.get(o)!.at = iso(Date.now() - 31 * DAY);
    server.projectDrive.set(o, { requested_at: iso(requested), trashed_at: iso(requested + 60_000), missing_at: null });
    return { server, owner, o, requested };
  }

  it('un archivo subido después del pedido la vuelve a pedir (drive_trash_first) y no marca nada', async () => {
    const { server, owner, o, requested } = await purgeable((r) => [iso(r - DAY), iso(r + 1000)]);
    await expect(owner.remote.purgeProject(o)).rejects.toThrow('drive_trash_first');
    expect(server.deletedProjects.get(o)?.purged).toBeFalsy();
    expect(server.mediaFiles.get('f0')?.drive_trashed_at).toBeFalsy();
    expect(server.projectDrive.get(o)?.requested_at).toBe(iso(requested));
  });

  it('lo subido hasta el pedido (también en el mismo instante, o sin fecha, de antes) queda marcado con las fechas de la carpeta', async () => {
    const { server, owner, o, requested } = await purgeable((r) => [iso(r - DAY), iso(r), null]);
    // Al borrar el proyecto entraron a la papelera de archivos: esa fecha se conserva (`coalesce`).
    const trashed = ['f0', 'f1', 'f2'].map((id) => server.mediaFiles.get(id)!.trashed_at);
    expect(trashed.every(Boolean)).toBe(true);
    await owner.remote.purgeProject(o);
    expect(server.deletedProjects.get(o)?.purged).toBeTruthy();
    for (const [i, id] of ['f0', 'f1', 'f2'].entries()) {
      const f = server.mediaFiles.get(id)!;
      expect(f.trashed_at).toBe(trashed[i]);
      expect(f.purged_at).toBe(iso(requested));
      expect(f.drive_trashed_at).toBe(iso(requested + 60_000));
    }
    expect(server.projectDrive.has(o)).toBe(false);
  });
});
