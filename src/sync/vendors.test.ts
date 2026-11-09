import { afterEach, describe, expect, it } from 'vitest';
import { FakeRemote, FakeServer, makeDevice, VENDOR_MUTANTS, type Device, type VendorMutant } from './testing';
import type { PageSettings } from './types';
import { Permissions, parseAccess } from './access';
import { parseSaveVendorsResult, parseSceneVendorsList, type VendorOp } from './remote';

// Los vendors y *Can share scenes* (Docs/Doc_Compartir_Escenas.md, sección 11, D852) contra el servidor en memoria, que
// tiene las reglas de 20261121120000_vendors.sql: cada chequeo de seguridad con su mutante (sin él, la prueba tiene que
// fallar), el armado del acceso de cada correo (miembro, invitación, aceptar), lo que devuelve guardar y los permisos del
// cliente (`canShareScenes`, `vendorCap`).

const devices: Device[] = [];
afterEach(async () => {
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb?.close();
  }
});

async function env() {
  const server = new FakeServer();
  server.enableTeam();
  server.enableClean();
  server.enableVendors();
  const owner = await makeDevice(server);
  devices.push(owner);
  await owner.engine.syncNow();
  const t = owner.tree;
  const P = await t.createProject('P');
  const P2 = await t.createProject('P2');
  const folder = await t.create(null, 'Escenas', P);
  await t.setPatch(folder, { settings: { holds: 'scene' } as unknown as PageSettings });
  const mark = (code: string) => ({ settings: { entity: { kind: 'scene', code } } as unknown as PageSettings });
  const s1 = await t.create(folder, '001 | Uno', P);
  const s2 = await t.create(folder, '002 | Dos', P);
  const s3 = await t.create(folder, '003 | Tres', P);
  const s4 = await t.create(folder, '004 | Cuatro', P);
  for (const [id, code] of [[s1, '001'], [s2, '002'], [s3, '003'], [s4, '004']] as const) await t.setPatch(id, mark(code));
  const loc4 = await t.create(s4, 'Galpón', P);
  await t.setPatch(loc4, { settings: { entity: { kind: 'location' } } as unknown as PageSettings });
  const loose = await t.create(null, 'Suelta', P);
  const q1 = await t.create(null, '001 | Otra', P2);
  await t.setPatch(q1, mark('001'));
  await t.trash(s3);
  await owner.engine.syncNow();
  server.addMember('ada', 'admin', 'ada@test');
  server.addMember('pablo', 'member', 'pablo@test');
  server.addMember('quinn', 'member', 'quinn@test');
  server.addMember('rita', 'member', 'rita@test');
  server.addMember('gina', 'guest', 'gina@prod.test');
  server.addMember('vera', 'guest', 'vera@vendor.test');
  server.addMember('eli', 'member', 'eli@test');
  server.grant('ada', { projectId: P }, 'edit_pages');
  server.grant('pablo', { projectId: P }, 'comment');
  server.grant('quinn', { projectId: P }, 'view');
  server.grant('rita', { projectId: P }, 'comment');
  server.grant('gina', { projectId: P }, 'comment');
  server.grant('eli', { projectId: P }, 'edit');
  for (const uid of ['pablo', 'quinn', 'gina']) server.grants.find((g) => g.user_id === uid && g.project_id === P)!.share_scenes = true;
  const as = (uid: string, email?: string) => new FakeRemote(server, '0.021', uid, email);
  return { server, owner: owner.remote, as, P, P2, folder, s1, s2, s3, s4, loose, q1 };
}
type Env = Awaited<ReturnType<typeof env>>;

async function failure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return '';
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

const create = (name: string, level: 'view' | 'comment', scenes: string[] = [], emails: string[] = []): VendorOp => ({
  op: 'create',
  key: name,
  name,
  code: '',
  color: '#2e5a8e',
  level,
  add_scenes: scenes,
  add_emails: emails,
});

/** Crea un vendor como la dueña y devuelve su id. */
async function vendor(e: Env, name: string, level: 'view' | 'comment', scenes: string[] = [], emails: string[] = []): Promise<string> {
  const r = await e.owner.saveSceneVendors(e.P, [create(name, level, scenes, emails)]);
  return r.keys[name];
}

/** El nivel del permiso vivo de `uid` sobre una página, o null. */
const levelOf = (e: Env, uid: string, pageId: string) => e.server.grants.find((g) => g.user_id === uid && g.page_id === pageId)?.level ?? null;

/** Las invitaciones vivas de vendors de un correo. */
const liveVendorInvites = (e: Env, email: string) =>
  e.server.invitations.filter((i) => i.vendor_id && i.email === email && !i.used_at && !i.revoked_at);

type Check = { run: (e: Env) => Promise<boolean>; also?: VendorMutant[] };

const CHECKS: Record<VendorMutant, Check> = {
  manage: { run: async (e) => (await failure(e.as('rita').sceneVendorsList(e.P))) === 'not_allowed' },
  capLevel: {
    run: async (e) => (await failure(e.as('quinn').saveSceneVendors(e.P, [create('X', 'comment')]))) === 'level_not_allowed',
  },
  levelSet: {
    run: async (e) => {
      const id = await vendor(e, 'DNEG', 'view');
      return (await failure(e.as('quinn').saveSceneVendors(e.P, [{ op: 'update', id, level: 'comment' }]))) === 'level_not_allowed';
    },
  },
  levelAdd: {
    run: async (e) => {
      const id = await vendor(e, 'DNEG', 'comment', [e.s1]);
      const err = await failure(e.as('quinn').saveSceneVendors(e.P, [{ op: 'update', id, add_scenes: [e.s2] }]));
      return err === 'level_not_allowed' && e.server.vendors[0].scenes.length === 1;
    },
  },
  sceneMark: { run: async (e) => (await failure(e.owner.saveSceneVendors(e.P, [create('X', 'view', [e.loose])]))) === 'page_invalid' },
  sceneProject: { run: async (e) => (await failure(e.owner.saveSceneVendors(e.P, [create('X', 'view', [e.q1])]))) === 'page_invalid' },
  sceneAlive: { run: async (e) => (await failure(e.owner.saveSceneVendors(e.P, [create('X', 'view', [e.s3])]))) === 'page_invalid' },
  // Pablo (con la casilla) no ve P2: una escena de otro proyecto no entra aunque falte el chequeo del proyecto.
  sceneSees: {
    run: async (e) => (await failure(e.as('pablo').saveSceneVendors(e.P, [create('X', 'view', [e.q1])]))) === 'page_invalid',
    also: ['sceneProject'],
  },
  sceneEntities: {
    run: async (e) => (await failure(e.owner.saveSceneVendors(e.P, [create('X', 'view', [e.s4])]))) === 'scene_contains_entities',
  },
  emailOne: {
    run: async (e) => {
      await vendor(e, 'DNEG', 'view', [e.s1], ['nora@x.test']);
      const err = await failure(e.owner.saveSceneVendors(e.P, [create('FS', 'view', [e.s2], ['nora@x.test'])]));
      return err === 'email_in_other_vendor' && e.server.vendors.filter((v) => !v.deleted_at).length === 1;
    },
  },
  allOrNothing: {
    run: async (e) => {
      const id = await vendor(e, 'DNEG', 'view', [e.s1]);
      const err = await failure(e.owner.saveSceneVendors(e.P, [{ op: 'update', id, name: 'Otro', add_scenes: [e.s2, e.loose] }]));
      const v = e.server.vendors[0];
      return err === 'page_invalid' && v.name === 'DNEG' && v.scenes.length === 1;
    },
  },
  syncRemove: {
    run: async (e) => {
      const id = await vendor(e, 'DNEG', 'comment', [e.s1, e.s2], ['vera@vendor.test']);
      const had = levelOf(e, 'vera', e.s2) === 'comment';
      await e.owner.saveSceneVendors(e.P, [{ op: 'update', id, remove_scenes: [e.s2] }]);
      return had && levelOf(e, 'vera', e.s2) === null && levelOf(e, 'vera', e.s1) === 'comment';
    },
  },
  syncLevel: {
    run: async (e) => {
      const id = await vendor(e, 'DNEG', 'comment', [e.s1], ['vera@vendor.test']);
      await e.owner.saveSceneVendors(e.P, [{ op: 'update', id, level: 'view' }]);
      return levelOf(e, 'vera', e.s1) === 'view';
    },
  },
  deleteRevokes: {
    run: async (e) => {
      const id = await vendor(e, 'DNEG', 'view', [e.s1], ['nora@x.test']);
      const had = liveVendorInvites(e, 'nora@x.test').length === 1;
      await e.owner.saveSceneVendors(e.P, [{ op: 'delete', id }]);
      e.server.addMember('nora', 'guest', 'nora@x.test');
      e.server.members.delete('nora');
      const n = await e.as('nora', 'nora@x.test').acceptInvitations();
      return had && liveVendorInvites(e, 'nora@x.test').length === 0 && n === 0 && levelOf(e, 'nora', e.s1) === null;
    },
  },
  outside: {
    run: async (e) => {
      await vendor(e, 'DNEG', 'view', [e.s1], ['nora@x.test']);
      return (await e.owner.pagesWithOutsideReaders(e.P)).get(e.s1) === 1 && (await e.as('eli').pageHasOutsideReaders(e.s1));
    },
  },
  membersHide: {
    run: async (e) => {
      await vendor(e, 'DNEG', 'view', [e.s1], ['nora@x.test']);
      return !(await e.owner.listInvitations())!.some((i) => i.email === 'nora@x.test');
    },
  },
  acceptNow: {
    run: async (e) => {
      const id = await vendor(e, 'DNEG', 'comment', [e.s1], ['nora@x.test']);
      await e.owner.saveSceneVendors(e.P, [{ op: 'update', id, add_scenes: [e.s2] }]);
      const n = await e.as('nora', 'nora@x.test').acceptInvitations();
      return (
        n === 1 &&
        e.server.members.get('nora')?.role === 'guest' &&
        levelOf(e, 'nora', e.s1) === 'comment' &&
        levelOf(e, 'nora', e.s2) === 'comment'
      );
    },
  },
  flagWho: { run: async (e) => (await failure(e.as('pablo').setShareScenes(e.P, 'rita', true))) === 'not_allowed' },
  flagRevoke: {
    run: async (e) => {
      const g = e.server.grants.find((x) => x.user_id === 'pablo' && x.project_id === e.P)!;
      await e.owner.unshare(g.id);
      await e.owner.share('pablo', { projectId: e.P }, 'comment');
      return !e.server.grants.find((x) => x.user_id === 'pablo' && x.project_id === e.P)!.share_scenes;
    },
  },
  guardLevel: {
    run: async (e) => {
      const id = await vendor(e, 'DNEG', 'comment', [e.s1], ['vera@vendor.test']);
      await e.owner.share('vera', { pageId: e.s1 }, 'view');
      await e.owner.saveSceneVendors(e.P, [{ op: 'update', id, remove_emails: ['vera@vendor.test'] }]);
      return levelOf(e, 'vera', e.s1) === 'view';
    },
  },
  // S1 pierde la marca mientras DNEG no tiene correos: cargarle a Vera no se la da, y la lista la marca.
  sceneOk: {
    run: async (e) => {
      const id = await vendor(e, 'DNEG', 'view', [e.s1]);
      e.server.pages.get(e.s1)!.settings = {} as PageSettings;
      await e.owner.saveSceneVendors(e.P, [{ op: 'update', id, add_emails: ['vera@vendor.test'] }]);
      const list = await e.owner.sceneVendorsList(e.P);
      return levelOf(e, 'vera', e.s1) === null && list.vendors[0].scenes[0].ok === false;
    },
  },
  // Vera ya tiene Ver sobre S1 por *Share*: DNEG (Comentar) no se toma ese permiso, y sacarla de DNEG no se lo lleva.
  ownGrant: {
    run: async (e) => {
      await e.owner.share('vera', { pageId: e.s1 }, 'view');
      const id = await vendor(e, 'DNEG', 'comment', [e.s1], ['vera@vendor.test']);
      await e.owner.saveSceneVendors(e.P, [{ op: 'update', id, remove_emails: ['vera@vendor.test'] }]);
      return levelOf(e, 'vera', e.s1) === 'view';
    },
  },
  ownEmail: {
    run: async (e) => {
      const id = await vendor(e, 'DNEG', 'view', [e.s1]);
      const err = await failure(e.as('gina', 'gina@prod.test').saveSceneVendors(e.P, [{ op: 'update', id, add_emails: ['Gina@prod.test'] }]));
      return err === 'own_email';
    },
  },
  deletedProject: {
    run: async (e) => {
      await vendor(e, 'DNEG', 'view', [e.s1], ['nora@x.test']);
      e.server.deletedProjects.set(e.P, { at: new Date().toISOString(), by: 'owner' });
      return (await e.as('nora', 'nora@x.test').acceptInvitations()) === 0 && levelOf(e, 'nora', e.s1) === null;
    },
  },
};

describe('Vendors: las reglas del servidor en memoria', () => {
  it.each(VENDOR_MUTANTS.map((m) => [m] as const))('el chequeo «%s» se mantiene, y sin él hay una fuga (mutante)', async (which) => {
    const check = CHECKS[which];
    expect(await check.run(await env())).toBe(true);
    const e = await env();
    for (const m of [which, ...(check.also ?? [])]) e.server.vendorMutants.add(m);
    expect(await check.run(e)).toBe(false);
  });

  it('`sceneSees` es una segunda capa: con solo `sceneProject` afuera, igual rechaza una escena que no ve', async () => {
    const e = await env();
    e.server.vendorMutants.add('sceneProject');
    expect(await CHECKS.sceneSees.run(e)).toBe(true);
  });

  it('quién maneja: dueña y admin hasta Comentar; con la casilla, hasta su nivel (también un invitado); el vendor no', async () => {
    const e = await env();
    expect((await e.owner.sceneVendorsList(e.P)).cap).toBe(2);
    expect((await e.as('ada').sceneVendorsList(e.P)).admin).toBe(true);
    expect((await e.as('pablo').sceneVendorsList(e.P)).cap).toBe(2);
    expect((await e.as('quinn').sceneVendorsList(e.P)).cap).toBe(1);
    expect((await e.as('gina').sceneVendorsList(e.P)).admin).toBe(false);
    expect(await failure(e.as('eli').sceneVendorsList(e.P))).toBe('not_allowed');
    await vendor(e, 'DNEG', 'view', [e.s1], ['vera@vendor.test']);
    expect(await failure(e.as('vera').sceneVendorsList(e.P))).toBe('not_allowed');
  });

  it('planificación sin correos; un correo nuevo queda pendiente y reinicia; un miembro recibe permisos del vendor', async () => {
    const e = await env();
    const r1 = await e.owner.saveSceneVendors(e.P, [create('DNEG', 'comment', [e.s1, e.s2])]);
    const id = r1.keys.DNEG;
    expect(r1).toEqual({ keys: { DNEG: id }, reset: [], pending: [] });
    expect((await e.owner.pagesWithOutsideReaders(e.P)).size).toBe(0);
    const r2 = await e.as('gina').saveSceneVendors(e.P, [{ op: 'update', id, add_emails: [' Nora@X.test '] }]);
    expect(r2.pending).toEqual(['nora@x.test']);
    expect([...r2.reset].sort()).toEqual([e.s1, e.s2].sort());
    const inv = liveVendorInvites(e, 'nora@x.test');
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ role: 'guest', grants: [], vendor_id: id });
    await e.owner.saveSceneVendors(e.P, [{ op: 'update', id, add_emails: ['vera@vendor.test', 'eli@test'] }]);
    expect(levelOf(e, 'vera', e.s1)).toBe('comment');
    // Quien ya ve más (Editar sobre el proyecto) no recibe nada.
    expect(levelOf(e, 'eli', e.s1)).toBeNull();
    const list = await e.owner.sceneVendorsList(e.P);
    expect(list.vendors[0].emails).toEqual([
      { email: 'nora@x.test', state: 'invited' },
      { email: 'vera@vendor.test', state: 'joined' },
      { email: 'eli@test', state: 'joined' },
    ]);
    // Volver a invitar renueva la misma invitación.
    await e.owner.saveSceneVendors(e.P, [{ op: 'update', id, reinvite: ['nora@x.test'] }]);
    expect(e.server.invitations.filter((i) => i.email === 'nora@x.test')).toHaveLength(1);
  });

  it('mover un correo de un vendor a otro en un guardado', async () => {
    const e = await env();
    const dn = await vendor(e, 'DNEG', 'comment', [e.s1], ['vera@vendor.test']);
    const r = await e.owner.saveSceneVendors(e.P, [
      { op: 'update', id: dn, remove_emails: ['vera@vendor.test'] },
      create('FS', 'view', [e.s2], ['vera@vendor.test']),
    ]);
    expect(levelOf(e, 'vera', e.s1)).toBeNull();
    expect(levelOf(e, 'vera', e.s2)).toBe('view');
    expect(r.pending).toEqual([]);
  });

  it('la casilla: la ponen la dueña y un admin que comparte; `list_access` la muestra', async () => {
    const e = await env();
    await e.owner.setShareScenes(e.P, 'rita', true);
    expect((await e.as('rita').sceneVendorsList(e.P)).cap).toBe(2);
    await e.as('ada').setShareScenes(e.P, 'rita', false);
    expect(await failure(e.as('rita').sceneVendorsList(e.P))).toBe('not_allowed');
    expect(await failure(e.owner.setShareScenes(e.P, 'vera', true))).toBe('grant_not_found');
    const rows = await e.owner.listAccess({ projectId: e.P });
    expect(rows.find((r) => r.user_id === 'pablo')?.share_scenes).toBe(true);
    expect(rows.find((r) => r.user_id === 'rita')?.share_scenes).toBe(false);
  });

  it('el cliente: `canShareScenes` y `vendorCap` como la base', () => {
    const tree = { get: () => undefined, project: () => ({ owner_id: 'otra' }), isLocalProject: () => false } as never;
    const perms = (role: 'owner' | 'admin' | 'member' | 'guest', grants: unknown[]) =>
      new Permissions(tree, parseAccess({ role, removed_at: null }, grants), 'me');
    const P = 'p1';
    expect(perms('member', [{ id: 'g', project_id: P, page_id: null, level: 'comment', share_scenes: true }]).canShareScenes(P)).toBe(true);
    expect(perms('member', [{ id: 'g', project_id: P, page_id: null, level: 'comment' }]).canShareScenes(P)).toBe(false);
    expect(perms('guest', [{ id: 'g', project_id: P, page_id: null, level: 'view', share_scenes: true }]).vendorCap(P)).toBe(1);
    // Una casilla sobre una página (no existe en la base) no cuenta.
    expect(perms('member', [{ id: 'g', project_id: null, page_id: 'x', level: 'comment', share_scenes: true }]).canShareScenes(P)).toBe(false);
  });

  it('las respuestas se comprueban', () => {
    expect(() => parseSceneVendorsList({ cap: 3, vendors: [] })).toThrow();
    expect(parseSceneVendorsList({ cap: 1, admin: false, vendors: [{ id: 'v', name: 'N', level: 'edit', emails: [{ email: 'a@b', state: 'x' }], scenes: [{ page_id: 'p' }] }], others: [{ page_id: 'p', readers: 2 }] })).toEqual({
      cap: 1,
      admin: false,
      vendors: [{ id: 'v', name: 'N', code: '', color: '#2e5a8e', level: 'view', created_at: '', emails: [{ email: 'a@b', state: 'expired' }], scenes: [{ page_id: 'p', alive: true, ok: true }] }],
      others: new Map([['p', 2]]),
    });
    expect(() => parseSaveVendorsResult(null)).toThrow();
    expect(parseSaveVendorsResult({ keys: { a: 'id' }, reset: ['p', 1], pending: [] })).toEqual({ keys: { a: 'id' }, reset: ['p'], pending: [] });
  });
});
