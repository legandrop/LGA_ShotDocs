import { afterEach, describe, expect, it } from 'vitest';
import * as Y from '@y/y';
import { fromBase64 } from '../lib/base64';
import { inviteLink, parseInviteHash } from '../invite';
import { loadWorkspaces, resolveInvite } from '../workspaces';
import { legacyStorageNames, WANKA_LOCAL_KEY, type WorkspaceConfig } from '../workspace';
import { acceptInvitationsQuietly, isRemovedSignal, parseAccess, Permissions, type AccessSnapshot } from './access';
import { FakeServer, makeDevice, type Device } from './testing';
import { RemoteError } from './types';
import { CONTENT_FRAGMENT } from './structure';
import { exportUnsynced, unsyncedSummary } from './unsynced';

// Paso 9 (equipo), lado de la app: permisos en el dispositivo, solo lectura, rechazos a la vista,
// invitaciones y la señal de que sacaron a alguien. El servidor en memoria sigue las reglas de
// supabase/migrations/20260930160000_equipo.sql.

const devices: Device[] = [];
async function device(server: FakeServer, user?: { id: string; email?: string }, dbName?: string): Promise<Device> {
  const d = await makeDevice(server, dbName, undefined, undefined, undefined, user ?? {});
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

/** Un workspace con equipo y un árbol: Proyecto › A › A1 › A1a, y B en la raíz. */
async function teamWorkspace() {
  const server = new FakeServer();
  server.enableTeam();
  const owner = await device(server);
  const a = await owner.tree.create(null, 'A');
  const a1 = await owner.tree.create(a, 'A1');
  const a1a = await owner.tree.create(a1, 'A1a');
  const b = await owner.tree.create(null, 'B');
  await owner.engine.syncNow();
  expect(owner.tree.failedOps()).toEqual([]);
  return { server, owner, pages: { a, a1, a1a, b } };
}

function perms(d: Device): Permissions {
  return new Permissions(d.tree, d.access.get(), d.remote.userId);
}

async function write(d: Device, pageId: string, text: string): Promise<void> {
  const doc = await d.docs.open(pageId);
  doc.get('t').insert(0, text);
  await d.docs.flush(pageId);
  d.docs.close(pageId);
}

describe('niveles en el dispositivo', () => {
  it('los permisos bajan y nunca suben; gana el más alto', async () => {
    const { server, pages } = await teamWorkspace();
    server.addMember('ana', 'member');
    server.grant('ana', { pageId: pages.a1 }, 'view');
    server.grant('ana', { pageId: pages.a }, 'comment');
    server.grant('ana', { pageId: pages.a1a }, 'edit_pages');
    const ana = await device(server, { id: 'ana' });
    await ana.engine.syncNow();

    const p = perms(ana);
    expect(p.known).toBe(true);
    expect(p.pageLevel(pages.a)).toBe(2);
    // Hacia abajo: A1 tiene "ver" propio y "comentar" de A: gana el más alto.
    expect(p.pageLevel(pages.a1)).toBe(2);
    expect(p.pageLevel(pages.a1a)).toBe(4);
    // Hacia arriba nunca: B no está debajo de nada compartido (y ni siquiera llega al dispositivo).
    expect(ana.tree.get(pages.b)).toBeUndefined();
    expect(p.pageLevel(pages.b)).toBe(0);
    expect(p.projectLevel(server.workspaceId)).toBe(0);
    expect(p.canCreateIn(null, server.workspaceId)).toBe(false);
    expect(p.canManagePage(pages.a1a)).toBe(true);
    expect(p.canMove(pages.a1a, pages.a1)).toBe(false);
  });

  it('un permiso sobre el proyecto vale para todas sus páginas', async () => {
    const { server, pages } = await teamWorkspace();
    server.addMember('bea', 'member');
    server.grant('bea', { projectId: server.workspaceId }, 'edit');
    server.grant('bea', { pageId: pages.b }, 'edit_pages');
    const bea = await device(server, { id: 'bea' });
    await bea.engine.syncNow();
    const p = perms(bea);
    expect(p.pageLevel(pages.a1a)).toBe(3);
    expect(p.pageLevel(pages.b)).toBe(4);
    expect(p.projectLevel(server.workspaceId)).toBe(3);
    expect(p.canEditPage(pages.a)).toBe(true);
    expect(p.canManagePage(pages.a)).toBe(false);
  });

  it('quien creó el proyecto tiene 4 solo siendo miembro activo', async () => {
    const { server, owner, pages } = await teamWorkspace();
    expect(perms(owner).pageLevel(pages.a1a)).toBe(4);

    // Creador sin membresía (nunca la tuvo): 0, como en la base.
    const snapshot: AccessSnapshot = { member: null, grants: [], fetchedAt: 0 };
    const stranger = new Permissions(owner.tree, snapshot, server.ownerId);
    expect(stranger.pageLevel(pages.a)).toBe(0);
    expect(stranger.projectLevel(server.workspaceId)).toBe(0);
    // Sacado: también 0.
    const removed = new Permissions(owner.tree, { member: { role: 'admin', removed_at: '2026-09-30T10:00:00Z' }, grants: [], fetchedAt: 0 }, server.ownerId);
    expect(removed.pageLevel(pages.a)).toBe(0);
    expect(removed.canCreateProject).toBe(false);
  });

  it('sin datos (base sin migrar o sin red la primera vez) no bloquea nada', async () => {
    const server = new FakeServer(); // base de antes del paso 9
    const d = await device(server);
    const page = await d.tree.create(null, 'Libre');
    await d.engine.syncNow();
    expect(d.access.get()).toBeNull();
    const p = perms(d);
    expect(p.known).toBe(false);
    expect(p.pageLevel(page)).toBe(4);
    expect(p.canCreateProject).toBe(true);
    // Lo del equipo no se ofrece sin datos: la base puede no tener las funciones.
    expect(p.canManageMembers).toBe(false);
    expect(p.canSharePage(page)).toBe(false);

    // Sin red la primera vez, con la base nueva: tampoco.
    const team = new FakeServer();
    team.enableTeam();
    team.online = false;
    const offline = await device(team);
    await offline.engine.syncNow();
    expect(perms(offline).known).toBe(false);
    expect(perms(offline).canCreateProject).toBe(true);
  });

  it('crear proyectos: solo el dueño y los admins', async () => {
    const { server } = await teamWorkspace();
    server.addMember('admin-1', 'admin');
    server.addMember('memb-1', 'member');
    server.grant('memb-1', { projectId: server.workspaceId }, 'edit_pages');
    const admin = await device(server, { id: 'admin-1' });
    const member = await device(server, { id: 'memb-1' });
    await admin.engine.syncNow();
    await member.engine.syncNow();
    expect(perms(admin).canCreateProject).toBe(true);
    expect(perms(member).canCreateProject).toBe(false);
    expect(perms(admin).canManageMembers).toBe(true);
    expect(perms(member).canManageMembers).toBe(false);
  });

  it('los permisos quedan guardados en el dispositivo y andan sin red', async () => {
    const { server, pages } = await teamWorkspace();
    server.addMember('ana', 'guest');
    server.grant('ana', { pageId: pages.a1 }, 'view');
    const dbName = crypto.randomUUID();
    const first = await device(server, { id: 'ana' }, dbName);
    await first.engine.syncNow();
    first.engine.stop();
    first.db.close();
    first.mediaDb.close();

    server.online = false;
    const again = await device(server, { id: 'ana' }, dbName);
    expect(again.access.get()?.member?.role).toBe('guest');
    expect(perms(again).pageLevel(pages.a1a)).toBe(1);
    expect(perms(again).canEditPage(pages.a1a)).toBe(false);
  });
});

describe('solo lectura y rechazos', () => {
  it('con "ver" el título y el contenido no se pueden cambiar; si igual sale algo, queda a la vista', async () => {
    const { server, pages } = await teamWorkspace();
    server.addMember('ana', 'member');
    server.grant('ana', { pageId: pages.a }, 'view');
    const ana = await device(server, { id: 'ana' });
    await ana.engine.syncNow();
    expect(perms(ana).canEditPage(pages.a)).toBe(false);

    // Una versión vieja o un dispositivo sin los permisos todavía: el servidor rechaza y nada se pierde.
    await ana.tree.rename(pages.a, 'Cambiado');
    await write(ana, pages.a1, 'texto');
    await ana.engine.syncNow();
    expect(server.pages.get(pages.a)?.title).toBe('A');
    expect(ana.tree.failedOps()).toHaveLength(1);
    const status = ana.engine.getStatus();
    expect(status.failedOps).toBe(1);
    expect(status.rejectedPages).toBe(1);
    // Lo rechazado sigue guardado en el dispositivo, con su motivo, hasta reintentar o descartarlo.
    const failed = ana.tree.failedOps()[0];
    expect(failed.op).toMatchObject({ kind: 'update', id: pages.a, patch: { title: 'Cambiado' } });
    expect(failed.error).toBe('page_not_found');
  });

  it('crear, mover y mandar a la papelera sin "Edit & create pages": errores 42501 visibles', async () => {
    const { server, pages } = await teamWorkspace();
    server.addMember('eli', 'member');
    server.grant('eli', { pageId: pages.a }, 'edit');
    const eli = await device(server, { id: 'eli' });
    await eli.engine.syncNow();
    const p = perms(eli);
    expect(p.canEditPage(pages.a1)).toBe(true);
    expect(p.canManagePage(pages.a1)).toBe(false);
    expect(p.canCreateIn(pages.a, server.workspaceId)).toBe(false);

    const child = await eli.tree.create(pages.a1, 'Nueva');
    await eli.tree.trash(pages.a1a);
    await eli.tree.move(pages.a1a, pages.a);
    await eli.tree.rename(pages.a1, 'A1 renombrada');
    await eli.engine.syncNow();

    const errors = eli.tree.failedOps().map((f) => f.error).sort();
    expect(errors).toEqual(['page_create_denied', 'page_move_denied', 'page_trash_denied']);
    expect(eli.engine.getStatus().failedOps).toBe(3);
    // Editar sí pasa.
    expect(server.pages.get(pages.a1)?.title).toBe('A1 renombrada');
    // La página rechazada no se pierde: sigue a la vista con su contenido local.
    expect(eli.tree.get(child)?.title).toBe('Nueva');
    expect(server.pages.has(child)).toBe(false);
  });

  it('un miembro no puede crear proyectos: el rechazo queda a la vista', async () => {
    const { server } = await teamWorkspace();
    server.addMember('memb-1', 'member');
    server.grant('memb-1', { projectId: server.workspaceId }, 'edit_pages');
    const m = await device(server, { id: 'memb-1' });
    await m.engine.syncNow();
    await m.tree.createProject('Propio');
    await m.engine.syncNow();
    expect(m.tree.failedOps()).toHaveLength(1);
    expect(m.tree.failedOps()[0].error).toMatch(/row-level security/);
  });
});

describe('invitaciones', () => {
  it('al entrar se aplican las invitaciones y lo compartido llega', async () => {
    const { server, owner, pages } = await teamWorkspace();
    await owner.remote.createInvitation('Cliente@Test', 'guest', [{ page_id: pages.a1, level: 'comment' }]);
    expect(server.invitations).toHaveLength(1);

    const guest = await device(server, { id: 'cli', email: 'cliente@test' });
    // Antes de aceptar: no es miembro, no ve nada.
    expect(await guest.remote.ensureWorkspace()).toBeNull();
    expect(await acceptInvitationsQuietly(guest.remote)).toBe(1);
    expect(server.members.get('cli')?.role).toBe('guest');
    expect(await guest.remote.ensureWorkspace()).toBe(server.workspaceId);

    await guest.engine.syncNow();
    expect(guest.tree.get(pages.a1)?.title).toBe('A1');
    expect(guest.tree.get(pages.a1a)?.title).toBe('A1a');
    expect(guest.tree.get(pages.a)).toBeUndefined();
    expect(perms(guest).pageLevel(pages.a1a)).toBe(2);
    // Una segunda vez no hace nada.
    expect(await acceptInvitationsQuietly(guest.remote)).toBe(0);
  });

  it('aceptar nunca corta la entrada: sin red o sin la función, sigue', async () => {
    expect(await acceptInvitationsQuietly({ acceptInvitations: async () => null })).toBe(0);
    expect(
      await acceptInvitationsQuietly({
        acceptInvitations: async () => {
          throw new RemoteError('Failed to fetch', false, undefined, true);
        },
      }),
    ).toBe(0);
    expect(
      await acceptInvitationsQuietly({
        acceptInvitations: async () => {
          throw new RemoteError('boom', false, '500');
        },
      }),
    ).toBe(0);
  });

  it('solo el dueño invita admins y cada permiso pide 4 a quien invita', async () => {
    const { server, pages } = await teamWorkspace();
    server.addMember('admin-1', 'admin');
    const admin = await device(server, { id: 'admin-1' });
    await expect(admin.remote.createInvitation('x@test', 'admin', [])).rejects.toThrow('not_allowed');
    await expect(admin.remote.createInvitation('x@test', 'guest', [{ page_id: pages.a, level: 'view' }])).rejects.toThrow(
      'grant_not_allowed',
    );
    await expect(admin.remote.createInvitation('x@test', 'guest', [])).resolves.toBeTruthy();
  });
});

describe('sacar a alguien', () => {
  async function withMember() {
    const { server, owner, pages } = await teamWorkspace();
    server.addMember('ana', 'member');
    server.grant('ana', { projectId: server.workspaceId }, 'edit_pages');
    const dbName = crypto.randomUUID();
    const ana = await device(server, { id: 'ana' }, dbName);
    await ana.engine.syncNow();
    expect(ana.access.removed).toBe(false);
    return { server, owner, pages, ana, dbName };
  }

  it('la fila de members con removed_at es la señal: no se sube ni se borra nada', async () => {
    const { server, owner, pages, ana, dbName } = await withMember();
    await ana.tree.rename(pages.b, 'Sin subir');
    await write(ana, pages.b, 'pendiente');
    await owner.remote.removeMember('ana');

    await ana.engine.syncNow();
    expect(ana.access.removed).toBe(true);
    expect(ana.engine.removed).toBe(true);
    // Nada se subió ni se rechazó: todo sigue en la cola del dispositivo.
    expect(ana.tree.pendingOps()).toHaveLength(1);
    expect(ana.tree.failedOps()).toEqual([]);
    expect(server.pages.get(pages.b)?.title).toBe('B');
    // Y el árbol no se vació (el servidor ya no le muestra nada).
    expect(ana.tree.get(pages.a1a)?.title).toBe('A1a');
    const summary = await unsyncedSummary(ana.db, ana.mediaDb);
    expect(summary.ops).toBe(1);
    expect(summary.pages).toBe(1);

    // Al reabrir sin red, la señal guardada sigue.
    ana.engine.stop();
    ana.db.close();
    ana.mediaDb.close();
    server.online = false;
    const again = await device(server, { id: 'ana' }, dbName);
    expect(again.access.removed).toBe(true);
  });

  it('un error de red, un 500, una lista vacía o una respuesta rara NUNCA la disparan', async () => {
    const { server, ana } = await withMember();
    for (const failure of ['network', 'server', 'empty', 'weird'] as const) {
      server.accessFailure = failure;
      await ana.engine.syncNow();
      expect(ana.access.removed, failure).toBe(false);
      expect(ana.engine.removed, failure).toBe(false);
    }
    server.accessFailure = null;
    server.online = false;
    await ana.engine.syncNow();
    expect(ana.access.removed).toBe(false);
    // Con la base sin la versión del equipo, tampoco (y deja de haber datos).
    server.online = true;
    server.settings = { ...server.settings!, schemaVersion: 3 };
    await ana.engine.syncNow();
    expect(ana.access.removed).toBe(false);
    expect(ana.access.get()).toBeNull();
  });

  it('un error después de la señal no la borra, y volver a invitar la levanta', async () => {
    const { server, owner, ana } = await withMember();
    await owner.remote.removeMember('ana');
    await ana.engine.syncNow();
    expect(ana.access.removed).toBe(true);
    server.accessFailure = 'server';
    await ana.engine.syncNow();
    expect(ana.access.removed).toBe(true);
    server.accessFailure = null;

    await owner.remote.createInvitation('ana@test', 'member', [{ project_id: server.workspaceId, level: 'edit' }]);
    expect(await acceptInvitationsQuietly(ana.remote)).toBe(1);
    await ana.engine.syncNow();
    expect(ana.access.removed).toBe(false);
    expect(perms(ana).projectLevel(server.workspaceId)).toBe(3);
  });

  it('isRemovedSignal solo con una fila válida y una fecha', () => {
    expect(isRemovedSignal(null)).toBe(false);
    expect(isRemovedSignal(undefined)).toBe(false);
    expect(isRemovedSignal({ member: null, grants: [], fetchedAt: 0 })).toBe(false);
    expect(isRemovedSignal({ member: { role: 'member', removed_at: null }, grants: [], fetchedAt: 0 })).toBe(false);
    expect(isRemovedSignal({ member: { role: 'member', removed_at: '' }, grants: [], fetchedAt: 0 })).toBe(false);
    expect(isRemovedSignal({ member: { role: 'member', removed_at: 'ayer' }, grants: [], fetchedAt: 0 })).toBe(false);
    expect(isRemovedSignal({ member: { role: 'nobody', removed_at: '2026-09-30' }, grants: [], fetchedAt: 0 } as never)).toBe(false);
    expect(isRemovedSignal({ member: { role: 'member', removed_at: '2026-09-30T12:00:00+00:00' }, grants: [], fetchedAt: 0 })).toBe(true);
    // Una respuesta rara no se guarda: tira error.
    expect(() => parseAccess({ role: 'member', removed_at: 5 }, [])).toThrow();
    expect(() => parseAccess([], [])).toThrow();
    expect(() => parseAccess(null, null)).toThrow();
    expect(parseAccess(null, []).member).toBeNull();
  });

  it('los cambios sin subir se bajan como archivo: cola, updates de Yjs e imágenes', async () => {
    const { owner, pages, ana } = await withMember();
    await owner.remote.removeMember('ana');
    await ana.tree.create(pages.a, 'Hecha sin red');
    await write(ana, pages.b, 'Nota de rodaje');
    await ana.files.add(pages.b, new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
    await ana.engine.syncNow();
    expect(ana.access.removed).toBe(true);

    const summary = await unsyncedSummary(ana.db, ana.mediaDb);
    expect(summary).toMatchObject({ ops: 1, pages: 1, images: 1, total: 3 });
    const data = (await exportUnsynced(ana.db, ana.mediaDb, {
      appVersion: '0.0',
      workspace: { url: 'https://x.supabase.co', localKey: 'k', name: 'Wanka' },
      user: { id: 'ana', email: 'ana@test' },
      titleOf: (id) => ana.tree.get(id)?.title,
    })) as {
      treeQueue: { op: { kind: string; page?: { title: string } } }[];
      pages: { pageId: string; title: string; yjsUpdate: string }[];
      images: { base64: string; mime: string }[];
    };
    expect(data.treeQueue.map((o) => o.op.page?.title)).toEqual(['Hecha sin red']);
    expect(data.pages).toHaveLength(1);
    expect(data.pages[0].title).toBe('B');
    const doc = new Y.Doc();
    Y.applyUpdate(doc, fromBase64(data.pages[0].yjsUpdate));
    expect(doc.get('t').toString()).toBe('Nota de rodaje');
    expect(data.images[0].mime).toBe('image/png');
    expect([...fromBase64(data.images[0].base64)]).toEqual([1, 2, 3]);
  });
});

describe('link de invitación', () => {
  const ws: WorkspaceConfig = {
    url: 'https://znlvpuddswymxpffgvbz.supabase.co',
    publishableKey: 'sb_publishable_x',
    name: 'Wanka',
    localKey: WANKA_LOCAL_KEY,
    storage: legacyStorageNames(WANKA_LOCAL_KEY),
  };
  const page = '3f9c2a00-0000-4000-8000-000000000001';

  it('va y vuelve, y reconoce el workspace de la compilación', () => {
    const link = inviteLink('https://shotdocs.lega.com.ar/', { u: ws.url, k: ws.publishableKey, l: ws.localKey, p: page });
    expect(link.startsWith('https://shotdocs.lega.com.ar/#invite=')).toBe(true);
    expect(link).not.toMatch(/[+/=]$/);
    const parsed = parseInviteHash(link.slice(link.indexOf('#')));
    expect(parsed).toEqual({ u: ws.url, k: ws.publishableKey, l: ws.localKey, p: page });
    // La lista del dispositivo lo reconoce como el de la compilación (paso 12).
    const data = new Map<string, string>();
    const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
    const list = loadWorkspaces({ url: ws.url, publishableKey: ws.publishableKey }, store);
    expect(resolveInvite(list, parsed!)).toMatchObject({ kind: 'open', target: page, entry: { legacy: true } });
    expect(resolveInvite(list, { ...parsed!, u: 'https://otro.supabase.co' }).kind).not.toBe('open');
  });

  it('un link roto o sin https no cuenta', () => {
    expect(parseInviteHash('#access_token=abc')).toBeNull();
    expect(parseInviteHash('#invite=%%%')).toBeNull();
    const bad = inviteLink('https://a', { u: 'javascript:alert(1)', k: 'k', l: 'l' });
    expect(parseInviteHash(bad.slice(bad.indexOf('#')))).toBeNull();
    const fakeLocal = inviteLink('https://a', { u: 'http://localhost.evil.example', k: 'k', l: 'l' });
    expect(parseInviteHash(fakeLocal.slice(fakeLocal.indexOf('#')))).toBeNull();
    const local = inviteLink('https://a', { u: 'http://localhost:54321', k: 'k', l: 'l' });
    expect(parseInviteHash(local.slice(local.indexOf('#')))?.u).toBe('http://localhost:54321');
    const noPage = inviteLink('https://a', { u: ws.url, k: 'k', l: 'l' });
    expect(parseInviteHash(noPage.slice(noPage.indexOf('#')))).toEqual({ u: ws.url, k: 'k', l: 'l' });
  });
});

/** Un documento con dos raíces (dos dispositivos que empezaron la misma página sin verse). */
function twoRootsUpdate(extra = 'dos'): Uint8Array {
  const doc = new Y.Doc();
  const fragment = doc.get(CONTENT_FRAGMENT);
  const pending: (() => void)[] = [];
  const root = (text: string) => {
    const group = new Y.Type('blockGroup');
    const block = new Y.Type('blockContainer');
    group.insert(0, [block]);
    pending.push(() => block.insert(0, text));
    return group;
  };
  fragment.insert(0, [root('uno'), root(extra)]);
  for (const p of pending) p();
  return Y.encodeStateAsUpdate(doc);
}

describe('correcciones de la auditoría', () => {
  it('quien solo puede ver abre una página con dos raíces: se repara en memoria y no sale nada', async () => {
    const { server, owner, pages } = await teamWorkspace();
    // El contenido roto llega al servidor como lo dejaría una versión vieja.
    await owner.remote.pushUpdate(pages.a, crypto.randomUUID(), twoRootsUpdate());
    server.addMember('ana', 'member');
    server.grant('ana', { pageId: pages.a }, 'view');
    const ana = await device(server, { id: 'ana' });
    await ana.engine.syncNow();
    const before = server.updates.get(pages.a)?.length;

    const doc = await ana.docs.open(pages.a);
    expect(doc.get(CONTENT_FRAGMENT).length).toBe(1);
    await ana.docs.flush(pages.a);
    // Llega otro cambio roto con la página abierta: también se repara solo en memoria.
    await owner.remote.pushUpdate(pages.a, crypto.randomUUID(), twoRootsUpdate('tres'));
    await ana.engine.syncNow();
    expect(doc.get(CONTENT_FRAGMENT).length).toBe(1);
    ana.docs.close(pages.a);
    // Y otra apertura (se vuelve a armar desde lo guardado).
    await ana.docs.open(pages.a);
    ana.docs.close(pages.a);
    await ana.engine.syncNow();

    expect(await ana.docs.unsyncedPages()).toEqual([]);
    expect(ana.engine.getStatus().rejectedPages).toBe(0);
    expect(server.updates.get(pages.a)?.length).toBe(before! + 1);

    // Quien puede editar sí guarda y sube la reparación.
    const owner2 = await device(server);
    await owner2.engine.syncNow();
    await owner2.docs.open(pages.a);
    await owner2.docs.flush(pages.a);
    owner2.docs.close(pages.a);
    expect(await owner2.docs.unsyncedPages()).toEqual([pages.a]);
  });

  it('se siembra siempre que el editor quede editable (también sin datos de permisos), nunca sin "Edit"', async () => {
    const { server, owner, pages } = await teamWorkspace();
    // Sin datos (base sin la versión del equipo, o la primera apertura sin red) el editor queda editable:
    // sin semilla crearía su propia raíz. La semilla queda en memoria hasta que se escriba.
    const unknown = new Permissions(owner.tree, null, server.ownerId);
    expect(unknown.canEditPage(pages.a)).toBe(true);
    expect(unknown.canSeed(pages.a)).toBe(true);
    expect(perms(owner).canSeed(pages.a)).toBe(true);
    server.addMember('ana', 'member');
    server.grant('ana', { pageId: pages.a }, 'view');
    const ana = await device(server, { id: 'ana' });
    await ana.engine.syncNow();
    expect(perms(ana).canSeed(pages.a)).toBe(false);
  });

  it('un proyecto sin dueño conocido no es propio para un invitado; al dueño no se le bloquea', async () => {
    const { server, owner, pages } = await teamWorkspace();
    server.addMember('ana', 'guest');
    server.grant('ana', { pageId: pages.a }, 'edit_pages');
    const ana = await device(server, { id: 'ana' });
    await ana.engine.syncNow();
    const project = ana.tree.project(server.workspaceId)!;
    // Como una copia vieja: sin `owner_id`.
    const snapshot = ana.access.get();
    const fakeTree = { ...ana.tree, project: () => ({ ...project, owner_id: undefined }), isLocalProject: () => false };
    const guest = new Permissions(fakeTree as never, snapshot, 'ana');
    expect(guest.canCreateIn(null, server.workspaceId)).toBe(false);
    expect(guest.canRenameProject(server.workspaceId)).toBe(false);
    const ownerPerms = new Permissions({ ...fakeTree, get: owner.tree.get.bind(owner.tree), ancestors: owner.tree.ancestors.bind(owner.tree) } as never, owner.access.get(), server.ownerId);
    expect(ownerPerms.canCreateIn(null, server.workspaceId)).toBe(true);
    expect(ownerPerms.pageLevel(pages.a1)).toBe(4);
    // Un proyecto creado en el dispositivo y sin volver del servidor sí es propio.
    const local = await owner.tree.createProject('Nuevo');
    expect(owner.tree.isLocalProject(local)).toBe(true);
    expect(perms(owner).canCreateIn(null, local)).toBe(true);
  });

  it('tras restaurar una copia, no vuelve a crear lo que ya no se puede crear, y lo avisa', async () => {
    const { server, pages } = await teamWorkspace();
    server.addMember('eli', 'member');
    server.grant('eli', { pageId: pages.a }, 'edit_pages');
    const eli = await device(server, { id: 'eli' });
    await eli.engine.syncNow();
    const restore = server.backup();
    const child = await eli.tree.create(pages.a1, 'Después de la copia');
    await eli.engine.syncNow();
    expect(server.pages.has(child)).toBe(true);
    // Le bajan el permiso y se restaura la copia (la página nueva ya no está en el servidor).
    server.grant('eli', { pageId: pages.a }, 'edit');
    restore();
    await eli.engine.syncNow();
    expect(eli.tree.pendingOps()).toEqual([]);
    expect(eli.tree.failedOps()).toEqual([]);
    expect(eli.engine.getStatus().notice).toMatch(/could not be created again/);
  });

  it('los permisos sacados (revoked_at) no cuentan', () => {
    const snap = parseAccess({ role: 'member', removed_at: null }, [
      { id: '1', project_id: 'p', page_id: null, level: 'edit_pages', revoked_at: '2026-09-30T10:00:00Z' },
      { id: '2', project_id: 'p', page_id: null, level: 'view', revoked_at: null },
    ]);
    expect(snap.grants.map((g) => g.id)).toEqual(['2']);
  });

  it('invitaciones pendientes: listar, revocar, y la de otra persona no se pisa', async () => {
    const { server, owner } = await teamWorkspace();
    server.addMember('admin-1', 'admin');
    const admin = await device(server, { id: 'admin-1' });
    const id = await owner.remote.createInvitation('x@test', 'guest', []);
    await expect(admin.remote.createInvitation('x@test', 'member', [])).rejects.toThrow('invitation_exists');
    expect((await admin.remote.listInvitations())?.map((i) => i.email)).toEqual(['x@test']);
    await expect(admin.remote.revokeInvitation(id)).rejects.toThrow('invitation_not_found');
    await owner.remote.revokeInvitation(id);
    expect(await owner.remote.listInvitations()).toEqual([]);
    // Revocada: no sirve para entrar.
    const x = await device(server, { id: 'x', email: 'x@test' });
    expect(await acceptInvitationsQuietly(x.remote)).toBe(0);
    server.noInvitationList = true;
    expect(await owner.remote.listInvitations()).toBeNull();
  });
});
