import { afterEach, describe, expect, it, vi } from 'vitest';
import { SupabaseCommentRemote } from './commentsRemote';
import { MentionsInbox } from './mentions';
import { FakeServer, makeDevice, type Device } from './testing';

// Menciones, entrega 2 (P.21, ME2; Docs/Doc_Menciones.md, sección 9): quién recibe a los que no ven la página en la
// lista del `@` (solo el dueño y los admins que pueden compartirla, fuera de la papelera), que esas filas no se
// guardan en el dispositivo, y compartir desde la mención (Comentar, solo esa página, sin tocar a quien ya la ve). El
// servidor en memoria sigue las reglas de supabase/migrations/20261016120000_menciones_e2.sql (las de permisos están
// probadas en supabase/tests/menciones_e2_permisos.sql, con mutantes).

const ADMIN = '00000000-0000-4000-8000-0000000000b1';
const ADMIN3 = '00000000-0000-4000-8000-0000000000b2';
const ANA = '00000000-0000-4000-8000-0000000000b3';
const PEDRO = '00000000-0000-4000-8000-0000000000b4';
const CLIENTE = '00000000-0000-4000-8000-0000000000b5';
const MO = '00000000-0000-4000-8000-0000000000b6';
const SACADO = '00000000-0000-4000-8000-0000000000b7';

const devices: Device[] = [];
async function device(server: FakeServer, id?: string, dbName?: string): Promise<Device> {
  const d = await makeDevice(server, dbName, undefined, undefined, undefined, id ? { id } : {});
  devices.push(d);
  await d.engine.syncNow();
  return d;
}

afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.mentions.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
});

/**
 * Un workspace en la versión 16: la dueña creó Plan (con Toma adentro) y Notas; un admin edita y crea en Plan (puede
 * compartirla), otro admin solo edita; Ana (miembro) comenta; Pedro (miembro) y un cliente no ven Plan; Mo es un
 * miembro dueño de otro proyecto; a otro lo sacaron del workspace.
 */
async function workspace(options: { sharing?: boolean } = {}) {
  const server = new FakeServer();
  if (options.sharing === false) server.enableMentions();
  else server.enableMentionSharing();
  server.addMember(ADMIN, 'admin', 'admin@wanka.tv');
  server.addMember(ADMIN3, 'admin', 'admin3@wanka.tv');
  server.addMember(ANA, 'member', 'ana@wanka.tv');
  server.addMember(PEDRO, 'member', 'pedro@wanka.tv');
  server.addMember(CLIENTE, 'guest', 'cliente@cliente.com');
  server.addMember(MO, 'member', 'mo@wanka.tv');
  server.addMember(SACADO, 'member', 'sacado@wanka.tv');
  const owner = await device(server);
  const plan = await owner.tree.create(null, 'Plan');
  const toma = await owner.tree.create(plan, 'Toma');
  const notas = await owner.tree.create(null, 'Notas');
  await owner.engine.syncNow();
  server.grant(ADMIN, { pageId: plan }, 'edit_pages');
  server.grant(ADMIN3, { pageId: plan }, 'edit');
  server.grant(ANA, { pageId: plan }, 'comment');
  server.grant(MO, { pageId: plan }, 'comment');
  server.grant(SACADO, { pageId: plan }, 'comment');
  server.removeMember(SACADO);
  return { server, owner, plan, toma, notas };
}

const ids = (list: { userId: string }[]) => list.map((c) => c.userId).sort();

describe('las filas sin acceso de la lista del @', () => {
  it('le llegan al dueño y a un admin que puede compartir la página; nunca a uno mismo ni a quien sacaron', async () => {
    const { server, owner, plan } = await workspace();
    const outside = (await owner.remote.mentionCandidates(plan)).filter((c) => c.hasAccess === false);
    expect(ids(outside)).toEqual([CLIENTE, PEDRO].sort());
    const admin = await device(server, ADMIN);
    const fromAdmin = await admin.remote.mentionCandidates(plan);
    expect(ids(fromAdmin.filter((c) => c.hasAccess === false))).toEqual([CLIENTE, PEDRO].sort());
    // Los que ven la página, primero y con acceso.
    expect(fromAdmin.findIndex((c) => c.hasAccess === false)).toBe(fromAdmin.filter((c) => c.hasAccess !== false).length);
  });

  it('nadie más: un admin que no puede compartirla, un miembro, un miembro dueño de otro proyecto, ni en la papelera', async () => {
    const { server, owner, plan, notas } = await workspace();
    for (const id of [ADMIN3, ANA, MO]) {
      const d = await device(server, id);
      expect((await d.remote.mentionCandidates(plan)).some((c) => c.hasAccess === false), id).toBe(false);
    }
    // En la papelera, tampoco el dueño.
    await owner.tree.trash(notas);
    await owner.engine.syncNow();
    expect((await owner.remote.mentionCandidates(notas)).some((c) => c.hasAccess === false)).toBe(false);
    await expect(owner.remote.shareForMention(notas, PEDRO)).rejects.toThrow('page_in_trash');
  });

  it('con la base en 15 (sin la entrega 2) no hay filas sin acceso', async () => {
    const { owner, plan } = await workspace({ sharing: false });
    expect((await owner.remote.mentionCandidates(plan)).some((c) => c.hasAccess === false)).toBe(false);
  });

  it('quedan solo en memoria: la lista guardada en el dispositivo tiene solo a quienes ven la página', async () => {
    const { server, plan } = await workspace();
    const admin = await device(server, ADMIN, 'admin-db');
    await admin.mentions.refreshCandidates(plan);
    expect(ids(admin.mentions.outsidersFor(plan))).toEqual([CLIENTE, PEDRO].sort());
    expect(admin.mentions.outsidersFor(plan).every((c) => c.hasAccess === false)).toBe(true);
    const saved = (await admin.commentsDb.get('meta', `mentionCandidates:${plan}`)) as { list: { userId: string; hasAccess?: boolean }[] };
    expect(saved.list.some((c) => c.userId === PEDRO || c.userId === CLIENTE)).toBe(false);
    expect(saved.list.every((c) => c.hasAccess === undefined)).toBe(true);
    // Otra campana sobre la misma base del dispositivo (la app recién abierta, sin red): ninguno sin acceso.
    const again = new MentionsInbox(admin.commentsDb, admin.remote, admin.comments);
    await again.load();
    expect(again.outsidersFor(plan)).toEqual([]);
    expect(ids(again.candidatesFor(plan, () => []))).toEqual(ids(saved.list));
    again.stop();
  });
});

describe('compartir desde la mención', () => {
  it('da Comentar sobre esa página (y las de adentro), nunca sobre las de arriba ni el proyecto, y pasa a la lista', async () => {
    const { server, plan, toma, notas } = await workspace();
    const admin = await device(server, ADMIN);
    await admin.mentions.refreshCandidates(toma);
    const pedro = admin.mentions.outsidersFor(toma).find((c) => c.userId === PEDRO)!;
    expect(pedro).toBeTruthy();
    await admin.mentions.shareForMention(toma, pedro);
    const mine = server.grants.filter((g) => g.user_id === PEDRO);
    expect(mine).toMatchObject([{ page_id: toma, project_id: null, level: 'comment' }]);
    expect(server.pageLevel(PEDRO, toma)).toBe(2);
    expect(server.pageLevel(PEDRO, plan)).toBe(0);
    expect(server.pageLevel(PEDRO, notas)).toBe(0);
    // Ya ve la página: con acceso, y no más entre los que no.
    expect(admin.mentions.outsidersFor(toma).some((c) => c.userId === PEDRO)).toBe(false);
    expect(ids(admin.mentions.candidatesFor(toma, () => []))).toContain(PEDRO);
    // La mención pasa (antes, la base la descartaba).
    const stop = admin.comments.watch(toma);
    const id = await admin.comments.add(toma, null, '@pedro mirá', null, [{ userId: PEDRO, label: 'pedro' }]);
    await admin.engine.syncNow();
    stop();
    expect(server.mentions).toMatchObject([{ comment_id: id, user_id: PEDRO }]);
  });

  it('a quien ya ve la página no le cambia nada (un reintento, o Ana con Comentar)', async () => {
    const { server, owner, plan } = await workspace();
    const before = JSON.stringify(server.grants);
    await expect(owner.remote.shareForMention(plan, ANA)).resolves.toBe(false);
    await expect(owner.remote.shareForMention(plan, ADMIN)).resolves.toBe(false);
    expect(JSON.stringify(server.grants)).toBe(before);
    await expect(owner.remote.shareForMention(plan, PEDRO)).resolves.toBe(true);
    await expect(owner.remote.shareForMention(plan, PEDRO)).resolves.toBe(false);
    expect(server.grants.filter((g) => g.user_id === PEDRO)).toHaveLength(1);
  });

  it('quien no recibe las filas sin acceso tampoco comparte; ni con quien no es del workspace', async () => {
    const { server, owner, plan } = await workspace();
    for (const id of [ADMIN3, ANA, MO]) {
      const d = await device(server, id);
      await expect(d.remote.shareForMention(plan, PEDRO), id).rejects.toThrow('not_allowed');
    }
    await expect(owner.remote.shareForMention(plan, SACADO)).rejects.toThrow('member_not_found');
    expect(server.grants.some((g) => g.user_id === PEDRO)).toBe(false);
  });

  it('sin red, tira y no cambia la lista', async () => {
    const { server, plan } = await workspace();
    const admin = await device(server, ADMIN);
    await admin.mentions.refreshCandidates(plan);
    const pedro = admin.mentions.outsidersFor(plan).find((c) => c.userId === PEDRO)!;
    server.online = false;
    await expect(admin.mentions.shareForMention(plan, pedro)).rejects.toThrow();
    expect(admin.mentions.outsidersFor(plan).some((c) => c.userId === PEDRO)).toBe(true);
    expect(server.grants.some((g) => g.user_id === PEDRO)).toBe(false);
  });
});

describe('lo que manda la base de verdad', () => {
  it('has_access = false llega como hasAccess: false; share_for_mention devuelve si compartió', async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === 'mention_candidates') {
        return {
          data: [
            { user_id: 'a', email: 'ana@wanka.tv', label: 'ana', has_access: true },
            { user_id: 'p', email: 'pedro@wanka.tv', label: 'pedro', has_access: false },
          ],
          error: null,
          status: 200,
        };
      }
      return { data: { shared: true, grant_id: 'g' }, error: null, status: 200 };
    });
    const remote = new SupabaseCommentRemote({ rpc } as never);
    expect(await remote.mentionCandidates('page')).toEqual([
      { userId: 'a', email: 'ana@wanka.tv', label: 'ana' },
      { userId: 'p', email: 'pedro@wanka.tv', label: 'pedro', hasAccess: false },
    ]);
    expect(await remote.shareForMention('page', 'p')).toBe(true);
    expect(rpc).toHaveBeenLastCalledWith('share_for_mention', { p_page_id: 'page', p_user: 'p' });
  });
});
