import { afterEach, describe, expect, it } from 'vitest';
import { ARTIST_MUTANTS, FakeRemote, FakeServer, makeDevice, type ArtistMutant, type Device } from './testing';
import type { PageSettings } from './types';
import { parseSceneVendorsList, parseVendorTeam, type VendorOp } from './remote';

// El equipo de un vendor y sus artistas (Docs/Doc_Compartir_Escenas.md, sección 12, D854) contra el servidor en memoria,
// que tiene las reglas de 20261122120000_vendor_artistas.sql: cada chequeo con su mutante (sin él, la prueba tiene que
// fallar), el recorrido de punta a punta (el proyecto arma un vendor, el equipo suma gente y reparte escenas entre
// artistas, el proyecto lo ve y manda) y la lectura de las respuestas.

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
  server.enableVendorTeam();
  const owner = await makeDevice(server);
  devices.push(owner);
  await owner.engine.syncNow();
  const t = owner.tree;
  const P = await t.createProject('P');
  const folder = await t.create(null, 'Escenas', P);
  await t.setPatch(folder, { settings: { holds: 'scene' } as unknown as PageSettings });
  const mark = (code: string) => ({ settings: { entity: { kind: 'scene', code } } as unknown as PageSettings });
  const s1 = await t.create(folder, '001 | Uno', P);
  const s2 = await t.create(folder, '002 | Dos', P);
  const s3 = await t.create(folder, '003 | Tres', P);
  for (const [id, code] of [[s1, '001'], [s2, '002'], [s3, '003']] as const) await t.setPatch(id, mark(code));
  await owner.engine.syncNow();
  // Tomás (productor de DNEG), Celia (coordinadora), Sofía (artista), Ximena (de otro vendor).
  server.addMember('tomas', 'guest', 'tomas@dneg.test');
  server.addMember('celia', 'guest', 'celia@dneg.test');
  server.addMember('sofia', 'guest', 'sofia@art.test');
  server.addMember('ximena', 'guest', 'ximena@otro.test');
  const as = (uid: string, email: string) => new FakeRemote(server, '0.021', uid, email);
  const create = (name: string, level: 'view' | 'comment', scenes: string[] = [], emails: string[] = []): VendorOp => ({
    op: 'create', key: name, name, code: '', color: '#2e5a8e', level, add_scenes: scenes, add_emails: emails,
  });
  const r = await owner.remote.saveSceneVendors(P, [
    create('DNEG', 'comment', [s1, s2], ['tomas@dneg.test']),
    create('Otro', 'comment', [s3], ['ximena@otro.test']),
  ]);
  const tomas = as('tomas', 'tomas@dneg.test');
  return { server, owner: owner.remote, as, tomas, P, s1, s2, s3, create, dneg: r.keys.DNEG, otro: r.keys.Otro };
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

const levelOf = (e: Env, uid: string, pageId: string) => e.server.grants.find((g) => g.user_id === uid && g.page_id === pageId)?.level ?? null;

/** Crea un artista como Tomás y devuelve su id. */
async function artist(e: Env, name: string, level: 'view' | 'comment', scenes: string[] = [], emails: string[] = []): Promise<string> {
  const r = await e.tomas.saveVendorTeam(e.P, [e.create(name, level, scenes, emails)]);
  return r.keys[name];
}

const CHECKS: Record<ArtistMutant, (e: Env) => Promise<boolean>> = {
  // Sofía es artista: no es del equipo.
  teamWho: async (e) => {
    await artist(e, 'Sofi', 'comment', [e.s1], ['sofia@art.test']);
    return (await failure(e.as('sofia', 'sofia@art.test').vendorTeamGet(e.P))) === 'not_allowed';
  },
  teamLocked: async (e) => {
    await e.owner.saveSceneVendors(e.P, [{ op: 'update', id: e.dneg, add_emails: ['celia@dneg.test'] }]);
    const err = await failure(e.tomas.saveVendorTeam(e.P, [{ op: 'team', remove_emails: ['celia@dneg.test'] }]));
    return err === 'email_locked' && levelOf(e, 'celia', e.s1) === 'comment';
  },
  teamOwn: async (e) => {
    await e.tomas.saveVendorTeam(e.P, [{ op: 'team', add_emails: ['celia@dneg.test'] }]);
    const celia = e.as('celia', 'celia@dneg.test');
    return (await failure(celia.saveVendorTeam(e.P, [{ op: 'team', remove_emails: ['celia@dneg.test'] }]))) === 'own_email';
  },
  artistLevel: async (e) => {
    await e.owner.saveSceneVendors(e.P, [{ op: 'update', id: e.dneg, level: 'view' }]);
    return (await failure(e.tomas.saveVendorTeam(e.P, [e.create('Sofi', 'comment', [e.s1])]))) === 'level_not_allowed';
  },
  artistScenes: async (e) => (await failure(e.tomas.saveVendorTeam(e.P, [e.create('Sofi', 'view', [e.s3])]))) === 'page_invalid',
  ownerArtistOps: async (e) => {
    const id = await artist(e, 'Sofi', 'comment', [e.s1]);
    return (await failure(e.owner.saveSceneVendors(e.P, [{ op: 'update', id, name: 'Otra' }]))) === 'ops_invalid';
  },
  listTop: async (e) => {
    await artist(e, 'Sofi', 'comment', [e.s1]);
    const list = await e.owner.sceneVendorsList(e.P);
    return list.vendors.length === 2 && list.vendors.find((v) => v.name === 'DNEG')?.artists?.[0]?.name === 'Sofi';
  },
  followScenes: async (e) => {
    await artist(e, 'Sofi', 'comment', [e.s1, e.s2], ['sofia@art.test']);
    await e.owner.saveSceneVendors(e.P, [{ op: 'update', id: e.dneg, remove_scenes: [e.s1] }]);
    return levelOf(e, 'sofia', e.s1) === null && levelOf(e, 'sofia', e.s2) === 'comment';
  },
  followLevel: async (e) => {
    await artist(e, 'Sofi', 'comment', [e.s1], ['sofia@art.test']);
    await e.owner.saveSceneVendors(e.P, [{ op: 'update', id: e.dneg, level: 'view' }]);
    return levelOf(e, 'sofia', e.s1) === 'view';
  },
  followDelete: async (e) => {
    await artist(e, 'Sofi', 'comment', [e.s1], ['sofia@art.test']);
    await e.owner.saveSceneVendors(e.P, [{ op: 'delete', id: e.dneg }]);
    return levelOf(e, 'sofia', e.s1) === null;
  },
};

describe('El equipo de un vendor y sus artistas: las reglas del servidor en memoria', () => {
  it.each(ARTIST_MUTANTS.map((m) => [m] as const))('el chequeo «%s» se mantiene, y sin él hay una fuga (mutante)', async (which) => {
    expect(await CHECKS[which](await env())).toBe(true);
    const e = await env();
    e.server.artistMutants.add(which);
    expect(await CHECKS[which](e)).toBe(false);
  });

  it('de punta a punta: el equipo suma gente, reparte escenas entre artistas, y el proyecto lo ve y manda', async () => {
    const e = await env();
    // Solo el equipo de DNEG lee lo suyo, y nunca ve Otro.
    const team = await e.tomas.vendorTeamGet(e.P);
    expect(team.vendor.name).toBe('DNEG');
    expect(JSON.stringify(team)).not.toContain('Otro');
    expect(JSON.stringify(team)).not.toContain('ximena');
    expect(await failure(e.owner.vendorTeamGet(e.P))).toBe('not_allowed');

    // Tomás suma a Celia: ve todo DNEG y es del equipo.
    await e.tomas.saveVendorTeam(e.P, [{ op: 'team', add_emails: ['Celia@dneg.test'] }]);
    expect(levelOf(e, 'celia', e.s1)).toBe('comment');
    const celia = e.as('celia', 'celia@dneg.test');
    expect((await celia.vendorTeamGet(e.P)).vendor.emails.find((m) => m.email === 'celia@dneg.test')?.by_team).toBe(true);
    // Un correo de otro vendor: no entra, y el error no dice dónde está.
    expect(await failure(e.tomas.saveVendorTeam(e.P, [{ op: 'team', add_emails: ['ximena@otro.test'] }]))).toBe('email_in_use');

    // Celia arma a Sofi (S1, sin correo: planificación) y después le carga el correo.
    const r = await celia.saveVendorTeam(e.P, [e.create('Sofi', 'comment', [e.s1])]);
    expect(levelOf(e, 'sofia', e.s1)).toBeNull();
    await celia.saveVendorTeam(e.P, [{ op: 'update', id: r.keys.Sofi, add_emails: ['sofia@art.test'] }]);
    expect(levelOf(e, 'sofia', e.s1)).toBe('comment');
    expect(levelOf(e, 'sofia', e.s2)).toBeNull();

    // El proyecto ve a Sofi debajo de DNEG, y a Celia marcada; le saca el correo a Sofi.
    const list = await e.owner.sceneVendorsList(e.P);
    const d = list.vendors.find((v) => v.name === 'DNEG')!;
    expect(d.artists?.map((a) => a.name)).toEqual(['Sofi']);
    expect(d.emails.find((m) => m.email === 'celia@dneg.test')?.by_team).toBe(true);
    await e.owner.saveSceneVendors(e.P, [{ op: 'update', id: r.keys.Sofi, remove_emails: ['sofia@art.test'] }]);
    expect(levelOf(e, 'sofia', e.s1)).toBeNull();

    // La lista de proyectos dice quién es del equipo.
    const rows = await e.tomas.fetchProjects(32);
    expect(rows.find((p) => p.id === e.P)?.vendor_team).toBe(true);
    const sofiRows = await e.as('sofia', 'sofia@art.test').fetchProjects(32);
    expect(sofiRows.find((p) => p.id === e.P)?.vendor_team ?? false).toBe(false);
  });

  it('las respuestas se comprueban', () => {
    const team = parseVendorTeam({
      me: 'tomas@dneg.test',
      vendor: { id: 'v1', name: 'DNEG', code: 'DN', color: '#2e5a8e', level: 'comment', emails: [{ email: 'a@b.c', state: 'joined', by_team: true }], scenes: [] },
      artists: [{ id: 'a1', name: 'Sofi', code: '', color: '#8e4a2e', level: 'view', emails: [], scenes: [{ page_id: 'p', alive: true, ok: false }] }],
    });
    expect(team.vendor.emails[0].by_team).toBe(true);
    expect(team.artists[0].scenes[0].ok).toBe(false);
    expect(() => parseVendorTeam({ vendor: null })).toThrow();
    const list = parseSceneVendorsList({
      cap: 2,
      vendors: [{ id: 'v1', name: 'DNEG', emails: [], scenes: [], artists: [{ id: 'a1', name: 'Sofi', emails: [], scenes: [] }] }],
    });
    expect(list.vendors[0].artists?.[0].name).toBe('Sofi');
  });
});
