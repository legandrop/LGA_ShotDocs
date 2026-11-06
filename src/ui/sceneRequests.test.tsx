// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import { buildProject } from '../relations/fixtures/proyectoSintetico';
import { navigate, pagePath } from '../router';
import { ServicesContext, type Services } from '../services';
import {
  AccessRequestsInbox,
  projectTextCode,
  projectTextKey,
  requestKey,
  sceneAskedId,
  sceneRequestsEnabled,
  sceneTarget,
  type AccessRequest,
  type SceneTarget,
} from '../sync/accessRequests';
import type { SupabaseRemote } from '../sync/remote';
import { FakeRemote, FakeServer, makeDevice, SCENE_REQUEST_MUTANTS, type Device, type SceneRequestMutant } from '../sync/testing';
import type { PageSettings } from '../sync/types';
import { settled } from '../test/settle';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { AccessRequestDialog } from './AccessRequests';
import { NoProjectsOpen, Shell } from './Workspace';

// Pedir una escena desde su link (Docs/Doc_Compartir_Escenas.md, B-2) contra el servidor en memoria, que tiene las mismas
// reglas que 20261119120000_pedir_escena.sql: los chequeos de pedir, listar y decidir (cada uno con su mutante, que tiene
// que dar una fuga), la pantalla sin acceso (nada del proyecto ni de la escena, la misma exista o no) en el Panorama y
// sin proyectos, y la ventana de decidir (la escena del link, qué es y cuántas lleva adentro, dar acceso con las reglas de
// *Share scenes*).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as never;
  const empty = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) });
  Range.prototype.getClientRects ??= (() => []) as never;
  Range.prototype.getBoundingClientRect ??= empty as never;
  Element.prototype.scrollIntoView ??= (() => undefined) as never;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

beforeEach(() => localStorage.clear());

const roots: Root[] = [];
const devices: Device[] = [];
const inboxes: AccessRequestsInbox[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const i of inboxes.splice(0)) i.stop();
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb?.close();
  }
  document.body.innerHTML = '';
  history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

const wait = (ms = 30) => act(() => settled(ms));

async function until(check: () => unknown, what: string, tries = 250): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (check()) return;
    await wait(40);
  }
  throw new Error(`no llegó: ${what}`);
}

/** Un cliente con `rpc` que va al servidor en memoria (solo lo que usa la pantalla sin acceso). */
function rpcTo(remote: FakeRemote) {
  return vi.fn(async (fn: string, args: Record<string, unknown>) => {
    try {
      if (fn === 'request_scene_access') {
        const target: SceneTarget = {
          projectId: (args.p_project as string | null) ?? null,
          projectText: (args.p_project_text as string | null) ?? null,
          scene: args.p_scene as string,
        };
        return { data: await remote.requestSceneAccess(target), error: null, status: 200 };
      }
      throw new Error(`rpc ${fn}`);
    } catch (err) {
      const e = err as { message: string; code?: string };
      return { data: null, error: { message: e.message, code: e.code }, status: 400 };
    }
  });
}

function services(d: Device, accessRequests?: AccessRequestsInbox): Services {
  const client = { auth: { signOut: vi.fn(), getSession: async () => ({ data: { session: null } }) }, rpc: rpcTo(d.remote) };
  return {
    workspace: { config: { url: 'https://x.supabase.co', publishableKey: 'k', name: 'W', localKey: WANKA_LOCAL_KEY, storage: legacyStorageNames(WANKA_LOCAL_KEY) }, client },
    client,
    user: { id: d.remote.userId, email: d.remote.email },
    db: d.db,
    tree: d.tree,
    docs: d.docs,
    files: d.files,
    media: d.media,
    engine: d.engine,
    access: d.access,
    remote: d.remote as unknown as SupabaseRemote,
    dbName: 'test',
    mediaDb: d.mediaDb,
    comments: d.comments,
    commentsDb: d.commentsDb,
    accessRequests,
    sizes: d.sizes,
    offline: d.offline,
    shutdown: async () => undefined,
  } as unknown as Services;
}

function mount(d: Device, node: React.ReactNode, start?: string, inbox?: AccessRequestsInbox): HTMLElement {
  if (start) history.replaceState(null, '', start);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<ServicesContext.Provider value={services(d, inbox)}>{node}</ServicesContext.Provider>));
  return host;
}

const button = (text: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text);
const click = async (el: Element | null | undefined) => {
  if (!el) throw new Error('no está');
  await act(async () => (el as HTMLElement).click());
  await wait();
};

/** El error de un pedido (o '' si no falló). */
async function failure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return '';
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

const byId = (projectId: string, scene: string): SceneTarget => ({ projectId, projectText: null, scene });
const byText = (projectText: string, scene: string): SceneTarget => ({ projectId: null, projectText, scene });
const mark = (code: string) => ({ settings: { entity: { kind: 'scene', code } } as unknown as PageSettings });

// ---------------------------------------------------------------------------------------------------------------------
// 1. Las reglas del servidor en memoria y sus mutantes
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Un workspace chico: P «ERSO | Serie» (carpeta de escenas › s1 › ficha, s2, s3 sin marca, s4 con una locación adentro),
 * EX «Érso» (xs), M2 «MOR 2» y M3 «MOR 3», Q «Quinta» (de Cris, miembro común). Vera (invitada, Comentar sobre s1), Hugo
 * (invitado sin nada), Ada (admin con 4 sobre P), Nora (admin sin nada), Cris, Walter (Ver sobre todo P).
 */
async function small() {
  const server = new FakeServer();
  server.enableTeam();
  server.enableClean();
  server.enableSceneRequests();
  const owner = await makeDevice(server);
  devices.push(owner);
  await owner.engine.syncNow();
  const t = owner.tree;
  const P = await t.createProject('ERSO | Serie');
  const EX = await t.createProject('Érso');
  const M2 = await t.createProject('MOR 2');
  const M3 = await t.createProject('MOR 3');
  const Q = await t.createProject('Quinta');
  const folder = await t.create(null, 'Escenas', P);
  await t.setPatch(folder, { settings: { holds: 'scene' } as unknown as PageSettings });
  const s1 = await t.create(folder, '101_013 | Uno', P);
  await t.setPatch(s1, mark('101_013'));
  await t.create(s1, 'Ficha 101_013_010', P);
  const s2 = await t.create(folder, '101_066 | Dos', P);
  await t.setPatch(s2, mark('101_066'));
  const s3 = await t.create(folder, 'Suelta', P);
  const s4 = await t.create(folder, '101_070 | Cuatro', P);
  await t.setPatch(s4, mark('101_070'));
  const loc = await t.create(s4, 'Galpón', P);
  await t.setPatch(loc, { settings: { entity: { kind: 'location' } } as unknown as PageSettings });
  const xs = await t.create(null, '001 | Ex', EX);
  await t.setPatch(xs, mark('001'));
  const ms2 = await t.create(null, '001 | Mor', M2);
  await t.setPatch(ms2, mark('001'));
  const qs = await t.create(null, '001 | Quinta', Q);
  await t.setPatch(qs, mark('001'));
  await owner.engine.syncNow();
  server.projects.get(Q)!.owner_id = 'cris';
  server.addMember('vera', 'guest', 'vera@vendor.test');
  server.addMember('hugo', 'guest', 'hugo@vendor.test');
  server.addMember('ada', 'admin', 'ada@test');
  server.addMember('nora', 'admin', 'nora@test');
  server.addMember('cris', 'member', 'cris@test');
  server.addMember('walter', 'member', 'walter@test');
  server.grant('vera', { pageId: s1 }, 'comment');
  server.grant('ada', { projectId: P }, 'edit_pages');
  server.grant('walter', { projectId: P }, 'view');
  const as = (uid: string) => new FakeRemote(server, '0.021', uid);
  /** Los pedidos de escenas que ve `uid`: «persona:proyecto:escena». */
  const list = async (uid: string) =>
    (await as(uid).accessRequestsRemote().pending({ scenes: true }))
      .filter((r) => r.scene)
      .map((r) => `${r.userId}:${r.scene!.projectId === P ? 'P' : r.scene!.projectId === EX ? 'EX' : r.scene!.projectId === M2 ? 'M2' : r.scene!.projectId === M3 ? 'M3' : r.scene!.projectId === Q ? 'Q' : '?'}:${r.scene!.text}`)
      .sort();
  const rowOf = (uid: string) => server.sceneAccessRequests.filter((r) => r.user_id === uid);
  const levelOf = (uid: string, pageId: string) => server.grants.find((g) => g.user_id === uid && g.page_id === pageId)?.level ?? null;
  return { server, owner: owner.remote, as, list, rowOf, levelOf, P, EX, M2, M3, Q, folder, s1, s2, s3, s4, xs, ms2, qs };
}
type Small = Awaited<ReturnType<typeof small>>;

/** Cada chequeo: `true` si se mantiene (rechaza, o no deja ver ni tocar lo que no debe). Con su mutante, `false`. */
const CHECKS: Record<SceneRequestMutant, { also?: SceneRequestMutant[]; run: (e: Small) => Promise<boolean> }> = {
  member: { run: async (e) => (await failure(e.as('nadie').requestSceneAccess(byId(e.P, '1066')))) === 'not_member' },
  sameAnswer: { run: async (e) => (await e.as('vera').requestSceneAccess(byId(crypto.randomUUID(), '1066'))) === 'sent' },
  allCalls: {
    run: async (e) => {
      for (let i = 0; i < 20; i++) await e.as('vera').requestSceneAccess(byId(e.P, '1066'));
      return (await failure(e.as('vera').requestSceneAccess(byId(e.P, '1066')))) === 'rate_limited';
    },
  },
  dedup: {
    run: async (e) => {
      await e.as('vera').requestSceneAccess(byText('ERSO', '1066'));
      await e.as('vera').requestSceneAccess(byText('Érso ', 'erso_1066_010'.toUpperCase()));
      await e.as('vera').requestSceneAccess(byText('erso', ' ERSO_1066_010 '));
      return e.rowOf('vera').length === 2;
    },
  },
  listRole: {
    run: async (e) => {
      await e.as('hugo').requestSceneAccess(byId(e.Q, '001'));
      return (await e.list('cris')).length === 0 && (await e.list('vera')).length === 0;
    },
  },
  listShare: {
    run: async (e) => {
      await e.as('vera').requestSceneAccess(byId(e.P, '1066'));
      return (await e.list('nora')).length === 0;
    },
  },
  listExact: {
    run: async (e) => {
      await e.as('vera').requestSceneAccess(byText('ERSO', '1066'));
      return JSON.stringify(await e.list(e.owner.userId)) === JSON.stringify(['vera:EX:1066']);
    },
  },
  listSees: {
    run: async (e) => {
      await e.as('walter').requestSceneAccess(byId(e.P, '1066'));
      return (await e.list(e.owner.userId)).length === 0;
    },
  },
  listRecent: {
    run: async (e) => {
      await e.as('vera').requestSceneAccess(byId(e.P, '1066'));
      e.rowOf('vera')[0].asked_at = new Date(e.server.now() - 31 * 86_400_000).toISOString();
      return (await e.list(e.owner.userId)).length === 0;
    },
  },
  listRemoved: {
    run: async (e) => {
      await e.as('vera').requestSceneAccess(byId(e.P, '1066'));
      e.server.members.get('vera')!.removed_at = new Date().toISOString();
      return (await e.list(e.owner.userId)).length === 0;
    },
  },
  decideRole: {
    run: async (e) => {
      await e.as('hugo').requestSceneAccess(byId(e.Q, '001'));
      const id = e.rowOf('hugo')[0].id;
      const inbox = e.as('cris').accessRequestsRemote();
      return (await failure(inbox.decideScene!(id, false, e.Q, null, 'view'))) === 'request_not_found' && e.rowOf('hugo')[0].state === 'pending';
    },
  },
  decideShare: {
    run: async (e) => {
      await e.as('vera').requestSceneAccess(byId(e.P, '1066'));
      const id = e.rowOf('vera')[0].id;
      return (await failure(e.as('nora').accessRequestsRemote().decideScene!(id, false, e.P, null, 'view'))) === 'request_not_found' && e.rowOf('vera')[0].state === 'pending';
    },
  },
  decideCandidate: {
    run: async (e) => {
      await e.as('vera').requestSceneAccess(byId(e.P, '1066'));
      const id = e.rowOf('vera')[0].id;
      return (await failure(e.owner.accessRequestsRemote().decideScene!(id, true, e.EX, e.xs, 'view'))) === 'request_not_found' && e.levelOf('vera', e.xs) === null;
    },
  },
  decideState: {
    run: async (e) => {
      await e.as('vera').requestSceneAccess(byId(e.P, '1066'));
      const id = e.rowOf('vera')[0].id;
      const remote = e.owner.accessRequestsRemote();
      await remote.decideScene!(id, true, e.P, e.s2, 'view');
      return (await failure(remote.decideScene!(id, false, e.P, null, 'view'))) === 'request_not_found' && e.rowOf('vera')[0].state === 'accepted';
    },
  },
  decideMember: {
    run: async (e) => {
      await e.as('vera').requestSceneAccess(byId(e.P, '1066'));
      const id = e.rowOf('vera')[0].id;
      e.server.members.get('vera')!.removed_at = new Date().toISOString();
      return (
        (await failure(e.owner.accessRequestsRemote().decideScene!(id, true, e.P, e.s2, 'view'))) === 'member_not_found' &&
        !e.server.invitations.some((i) => i.email === 'vera@vendor.test')
      );
    },
  },
  reuse: {
    run: async (e) => {
      await e.as('vera').requestSceneAccess(byId(e.P, '1066'));
      const id = e.rowOf('vera')[0].id;
      return (await failure(e.owner.accessRequestsRemote().decideScene!(id, true, e.P, e.s3, 'view'))) === 'page_invalid' && e.levelOf('vera', e.s3) === null;
    },
  },
  shareFirst: {
    // «erso»: EX se llama así entero, pero Ada no lo comparte; para ella es P por la primera palabra, y lo decide desde P.
    run: async (e) => {
      await e.as('vera').requestSceneAccess(byText('erso', '1066'));
      const listed = JSON.stringify(await e.list('ada')) === JSON.stringify(['vera:P:1066']);
      const id = e.rowOf('vera')[0].id;
      return listed && (await failure(e.as('ada').accessRequestsRemote().decideScene!(id, false, e.P, null, 'view'))) === '';
    },
  },
  projectText: {
    run: async (e) => {
      await e.as('vera').requestSceneAccess(byText('mor', '001'));
      await e.as('vera').requestSceneAccess(byText('ERSO | Serie', '1013'));
      await e.as('vera').requestSceneAccess(byId(e.P, '1066'));
      const items = (await e.owner.accessRequestsRemote().pending({ scenes: true })).filter((r) => r.scene);
      const of = (text: string) => items.filter((r) => r.scene!.text === text).map((r) => r.scene);
      return (
        JSON.stringify(of('001')) === JSON.stringify([
          { projectId: [e.M2, e.M3].sort()[0], text: '001', linkText: 'mor', exact: false },
          { projectId: [e.M2, e.M3].sort()[1], text: '001', linkText: 'mor', exact: false },
        ]) &&
        JSON.stringify(of('1013')) === JSON.stringify([{ projectId: e.P, text: '1013', linkText: 'erso | serie', exact: true }]) &&
        JSON.stringify(of('1066')) === JSON.stringify([{ projectId: e.P, text: '1066', linkText: null, exact: true }])
      );
    },
  },
  listOwn: {
    // Segunda capa: la dueña ve P entero, así que `listSees` ya saca su pedido; con las dos afuera, aparece.
    also: ['listSees'],
    run: async (e) => {
      await e.owner.requestSceneAccess(byId(e.P, '1013'));
      return (await e.list(e.owner.userId)).length === 0;
    },
  },
  decideOwn: {
    run: async (e) => {
      await e.owner.requestSceneAccess(byId(e.P, '1013'));
      const id = e.rowOf(e.owner.userId)[0].id;
      return (await failure(e.owner.accessRequestsRemote().decideScene!(id, false, e.P, null, 'view'))) === 'request_not_found' && e.rowOf(e.owner.userId)[0].state === 'pending';
    },
  },
  decideRecent: {
    run: async (e) => {
      await e.as('vera').requestSceneAccess(byId(e.P, '1066'));
      const row = e.rowOf('vera')[0];
      row.asked_at = new Date(e.server.now() - 31 * 86_400_000).toISOString();
      return (await failure(e.owner.accessRequestsRemote().decideScene!(row.id, false, e.P, null, 'view'))) === 'request_not_found' && row.state === 'pending';
    },
  },
  openCap: {
    // El tope de abiertos vive en la lista: con 22 pendientes de días distintos (el tope de llamadas no los frena), uno
    // nuevo y uno repetido que fue rechazado siguen dando `sent`, y la dueña ve solo los 20 más nuevos de vera.
    run: async (e) => {
      const row = (scene: string, minutes: number, state: 'pending' | 'declined') => {
        const at = new Date(e.server.now() - 3 * 86_400_000 - minutes * 60_000).toISOString();
        e.server.sceneAccessRequests.push({ id: crypto.randomUUID(), user_id: 'vera', project_id: e.P, project_text: null, scene_text: scene, state, times: 1, created_at: at, asked_at: at, decided_at: state === 'declined' ? at : null, decided_by: null, decided_project: null, page_id: null, level: null });
      };
      for (let i = 0; i < 22; i++) row(`k${String(i).padStart(2, '0')}`, i, 'pending');
      row('kd', 0, 'declined');
      const fresh = (await e.as('vera').requestSceneAccess(byId(e.P, '1066'))) === 'sent';
      const again = (await e.as('vera').requestSceneAccess(byId(e.P, 'kd'))) === 'sent';
      const mine = (await e.list(e.owner.userId)).filter((x) => x.startsWith('vera:'));
      const want = ['1066', 'kd', ...Array.from({ length: 18 }, (_, i) => `k${String(i).padStart(2, '0')}`)].map((x) => `vera:P:${x}`).sort();
      return fresh && again && JSON.stringify(mine) === JSON.stringify(want);
    },
  },
  cleanup: {
    // Al pedir se borran las propias creadas hace más de 30 días, en cualquier estado (una pendiente renovada también);
    // la que se creó hace 29 días y se decidió hace mucho, no.
    run: async (e) => {
      const row = (scene: string, createdDays: number, state: 'pending' | 'declined', askedDays = createdDays) => {
        const ago = (d: number) => new Date(e.server.now() - d * 86_400_000).toISOString();
        e.server.sceneAccessRequests.push({ id: crypto.randomUUID(), user_id: 'vera', project_id: e.P, project_text: null, scene_text: scene, state, times: 1, created_at: ago(createdDays), asked_at: ago(askedDays), decided_at: state === 'declined' ? ago(askedDays) : null, decided_by: null, decided_project: null, page_id: null, level: null });
      };
      row('viejo-p', 40, 'pending', 1);
      row('reciente-d', 29, 'declined');
      await e.as('vera').requestSceneAccess(byId(e.P, '1066'));
      return JSON.stringify(e.rowOf('vera').map((r) => r.scene_text).sort()) === JSON.stringify(['1066', 'reciente-d']);
    },
  },
  level: {
    // `set_page_shares` también lo frena: con `reuse` afuera, la única capa es esta.
    also: ['reuse'],
    run: async (e) => {
      await e.as('vera').requestSceneAccess(byId(e.P, '1066'));
      const id = e.rowOf('vera')[0].id;
      return (await failure(e.owner.accessRequestsRemote().decideScene!(id, true, e.P, e.s2, 'edit' as 'view'))) === 'level_invalid' && e.levelOf('vera', e.s2) === null;
    },
  },
};

describe('Pedir una escena: las reglas del servidor en memoria', () => {
  it.each(SCENE_REQUEST_MUTANTS.map((m) => [m] as const))('el chequeo «%s» se mantiene, y sin él hay una fuga (mutante)', async (which) => {
    const check = CHECKS[which];
    expect(await check.run(await small())).toBe(true);
    const e = await small();
    for (const m of [which, ...(check.also ?? [])]) e.server.sceneRequestMutants.add(m);
    expect(await check.run(e)).toBe(false);
  });

  it('`level` es una segunda capa: con solo `level` afuera, `set_page_shares` igual rechaza Editar', async () => {
    const e = await small();
    e.server.sceneRequestMutants.add('level');
    expect(await CHECKS.level.run(e)).toBe(true);
  });

  it('pedir: siempre `sent`, el texto normalizado, lo mal formado no deja fila', async () => {
    const e = await small();
    const vera = e.as('vera');
    for (const target of [byId(e.P, '1066'), byId(crypto.randomUUID(), '1066'), byText('  ÉRSO  ', '1066'), byText('Nada que exista', '1'), byId(e.P, '9999')]) {
      expect(await vera.requestSceneAccess(target)).toBe('sent');
    }
    expect(e.rowOf('vera').map((r) => r.project_text).filter(Boolean)).toEqual(['erso', 'nada que exista']);
    for (const bad of [
      { projectId: null, projectText: null, scene: '1' },
      { projectId: e.P, projectText: 'ERSO', scene: '1' },
      byText('   ', '1'),
      byText('a'.repeat(201), '1'),
      byId(e.P, '  '),
      byId(e.P, '1'.repeat(81)),
    ]) {
      expect(await failure(vera.requestSceneAccess(bad))).toBe('target_invalid');
    }
    expect(e.rowOf('vera')).toHaveLength(5);
  });

  it('la lista: el id, el nombre entero gana a la primera palabra, una palabra que nombra dos da una fila por proyecto', async () => {
    const e = await small();
    await e.as('vera').requestSceneAccess(byId(e.P, '1066'));
    await e.as('vera').requestSceneAccess(byText('erso', '1066'));
    await e.as('vera').requestSceneAccess(byText('ERSO | Serie', 'ERSO_1066_010'));
    await e.as('vera').requestSceneAccess(byText('mor', '001'));
    await e.as('hugo').requestSceneAccess(byId(e.Q, '001'));
    await e.as(e.owner.userId).requestSceneAccess(byId(e.P, '1013'));
    expect(await e.list(e.owner.userId)).toEqual(['vera:EX:1066', 'vera:M2:001', 'vera:M3:001', 'vera:P:1066', 'vera:P:ERSO_1066_010']);
    // Ada comparte solo P (el pedido de la dueña no: ella ve P entero): para ella «erso» es P por la primera palabra (EX,
    // que se llama así entero, no lo comparte). Nora, Cris, un invitado: nada.
    expect(await e.list('ada')).toEqual(['vera:P:1066', 'vera:P:1066', 'vera:P:ERSO_1066_010']);
    expect(await e.list('nora')).toEqual([]);
    expect(await e.list('cris')).toEqual([]);
    expect(await e.list('hugo')).toEqual([]);
    // Sin pedir los de escenas (base vieja o miembro), la lista no los trae.
    expect((await e.owner.accessRequestsRemote().pending()).some((r) => r.scene)).toBe(false);
  });

  it('dar acceso: las reglas de Share scenes (interruptor, escena marcada y viva, nada adentro, nunca baja) y una palabra que nombra dos', async () => {
    const e = await small();
    const remote = e.owner.accessRequestsRemote();
    await e.as('vera').requestSceneAccess(byId(e.P, '1066'));
    const id = e.rowOf('vera')[0].id;
    e.server.settings = { ...e.server.settings!, cleanMinVersion: null };
    expect(await failure(remote.decideScene!(id, true, e.P, e.s2, 'view'))).toBe('clean_off');
    e.server.enableClean();
    expect(await failure(remote.decideScene!(id, true, e.P, e.s4, 'view'))).toBe('scene_contains_entities');
    expect(await failure(remote.decideScene!(id, true, e.P, e.folder, 'view'))).toBe('page_invalid');
    expect(await failure(remote.decideScene!(id, true, e.P, null, 'view'))).toBe('page_invalid');
    expect(e.rowOf('vera')[0].state).toBe('pending');
    expect(await remote.decideScene!(id, true, e.P, e.s2, 'view')).toBe('accepted');
    expect(e.levelOf('vera', e.s2)).toBe('view');
    // Nunca baja: Comentar sobre s1 sigue con un pedido aceptado con Ver.
    await e.as('vera').requestSceneAccess(byId(e.P, '1013'));
    const id2 = e.rowOf('vera').find((r) => r.scene_text === '1013')!.id;
    expect(await remote.decideScene!(id2, true, e.P, e.s1, 'view')).toBe('accepted');
    expect(e.levelOf('vera', e.s1)).toBe('comment');
    // «mor»: se da desde M2 y sale de la lista de las dos.
    await e.as('vera').requestSceneAccess(byText('mor', '001'));
    const id3 = e.rowOf('vera').find((r) => r.project_text === 'mor')!.id;
    expect(await remote.decideScene!(id3, true, e.M2, e.ms2, 'comment')).toBe('accepted');
    expect(await e.list(e.owner.userId)).toEqual([]);
  });

  it('rechazar: el mismo pedido dentro del día queda `void` y no se lista; pasado el día, vuelve', async () => {
    const e = await small();
    await e.as('vera').requestSceneAccess(byId(e.P, '1066'));
    const id = e.rowOf('vera')[0].id;
    expect(await e.owner.accessRequestsRemote().decideScene!(id, false, e.P, null, 'view')).toBe('declined');
    await e.as('vera').requestSceneAccess(byId(e.P, '1066'));
    expect(e.rowOf('vera').map((r) => r.state).sort()).toEqual(['declined', 'void']);
    expect(await e.list(e.owner.userId)).toEqual([]);
    e.rowOf('vera')[0].decided_at = new Date(e.server.now() - 25 * 3_600_000).toISOString();
    await e.as('vera').requestSceneAccess(byId(e.P, '1066'));
    expect(e.rowOf('vera').map((r) => r.state).sort()).toEqual(['declined', 'pending']);
  });

  it('al pedir se borran las propias creadas hace más de 30 días, en cualquier estado; las más nuevas y las de otros, no', async () => {
    const e = await small();
    const row = (user: string, scene: string, state: 'pending' | 'void' | 'declined' | 'accepted', askedDays: number, decidedDays: number | null) =>
      e.server.sceneAccessRequests.push({
        id: crypto.randomUUID(), user_id: user, project_id: e.P, project_text: null, scene_text: scene, state, times: 1,
        created_at: new Date(e.server.now() - askedDays * 86_400_000).toISOString(), asked_at: new Date(e.server.now() - askedDays * 86_400_000).toISOString(),
        decided_at: decidedDays === null ? null : new Date(e.server.now() - decidedDays * 86_400_000).toISOString(), decided_by: null, decided_project: null, page_id: null, level: null,
      });
    row('vera', 'viejo', 'declined', 40, 35);
    row('vera', 'void-viejo', 'void', 31, null);
    row('vera', 'aceptado-hace-poco', 'accepted', 40, 2);
    row('vera', 'pendiente-viejo', 'pending', 40, null);
    row('vera', 'reciente', 'declined', 29, 29);
    row('hugo', 'de-otro', 'declined', 40, 35);
    await e.as('vera').requestSceneAccess(byId(e.P, '1066'));
    expect(e.server.sceneAccessRequests.map((r) => r.scene_text).sort()).toEqual(['1066', 'de-otro', 'reciente']);
  });

  it('el tope: 20 llamadas por persona en 24 horas, repetidas o no; la 21 da lo mismo exista o no; pasado el día, sigue', async () => {
    const e = await small();
    for (let i = 0; i < 20; i++) await e.as('vera').requestSceneAccess(byId(e.P, '1066'));
    expect(await failure(e.as('vera').requestSceneAccess(byId(e.P, '1066')))).toBe('rate_limited');
    expect(await failure(e.as('vera').requestSceneAccess(byId(crypto.randomUUID(), '1')))).toBe('rate_limited');
    expect(await failure(e.as('vera').requestSceneAccess(byText('Quinta', '001')))).toBe('rate_limited');
    expect(e.server.sceneAccessCalls.get('vera')!.calls).toBe(20);
    expect(await e.as('hugo').requestSceneAccess(byId(e.P, '1066'))).toBe('sent');
    e.server.sceneAccessCalls.get('vera')!.start -= 25 * 3_600_000;
    expect(await e.as('vera').requestSceneAccess(byId(e.P, '1066'))).toBe('sent');
  });
});

describe('lo que manda la app', () => {
  it('la normalización del texto es la de la migración, letra por letra (la app, el servidor en memoria y la base)', () => {
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261119120000_pedir_escena.sql'), 'utf8');
    const m = /translate\(btrim\(regexp_replace\(coalesce\(t, ''\), '\[\[:space:\]\]\+', ' ', 'g'\)\),\s*'([^']+)',\s*'([^']+)'\)\)/.exec(sql);
    expect(m).not.toBeNull();
    const [, from, to] = m!;
    expect([...from].length).toBe([...to].length);
    expect(projectTextKey(from)).toBe(to.toLowerCase());
    expect(/regexp_split_to_table\(k, '\[\[:space:\]\|·_\/-\]\+'\)/.test(sql)).toBe(true);
    // Lo que la base no toca, la app tampoco: otras marcas quedan (no coincide con nada, el lado seguro).
    expect(projectTextKey('Ő\u00a0x')).toBe('ő\u00a0x');
    expect(projectTextKey(' \t ÉRSO \n| Serie  ')).toBe('erso | serie');
    expect(projectTextCode('mor_2')).toBe('mor');
    expect(projectTextCode('| a')).toBe('a');
  });

  it('el proyecto del link: un id tal cual, un nombre como texto comparable (como la base y projectKey)', () => {
    const id = '0F8FAD5B-D9CB-469F-A165-70867728950E';
    expect(sceneTarget(id, ' 1066 ')).toEqual({ projectId: id.toLowerCase(), projectText: null, scene: '1066' });
    expect(sceneTarget('  ÉRSO   |  Serie ', 'ERSO_1066_010')).toEqual({ projectId: null, projectText: 'erso | serie', scene: 'ERSO_1066_010' });
    expect(projectTextKey('Ñandú')).toBe('nandu');
    expect(sceneTarget('ERSO', '')).toBeNull();
    expect(sceneTarget('', '1066')).toBeNull();
    expect(sceneTarget('ERSO', '1'.repeat(81))).toBeNull();
    expect(sceneAskedId(sceneTarget('ERSO', 'ERSO_1066_010')!)).toBe(sceneAskedId(sceneTarget('erso', 'erso_1066_010')!));
  });

  it('los pedidos de escenas se piden con la base en la 29 y solo para dueño o admin', () => {
    expect(sceneRequestsEnabled(29, 'owner')).toBe(true);
    expect(sceneRequestsEnabled(29, 'admin')).toBe(true);
    expect(sceneRequestsEnabled(29, 'member')).toBe(false);
    expect(sceneRequestsEnabled(29, 'guest')).toBe(false);
    expect(sceneRequestsEnabled(28, 'owner')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 2. La pantalla sin acceso
// ---------------------------------------------------------------------------------------------------------------------

let n = 0;
const fakePhoto = async () => `0000${String(++n).padStart(4, '0')}-aaaa-4bbb-8ccc-dddddddddddd`;

/** La serie de prueba «ERSO | Serie de prueba» del dueño, con la base en la 29 (o `schema`) y el interruptor prendido. */
async function series(schema = 29, clean = true) {
  const server = new FakeServer();
  server.enableTeam();
  // Sin el interruptor, quien ve una parte baja el contenido sin esperar a las bases limpias (el Panorama de un invitado).
  if (clean) server.enableClean();
  if (schema >= 29) server.enableSceneRequests();
  else {
    server.enableSceneShares();
    server.settings = { ...server.settings!, schemaVersion: schema };
  }
  const owner = await makeDevice(server);
  devices.push(owner);
  const built = await buildProject(owner, fakePhoto, { days: true, indexPage: false, name: 'ERSO | Serie de prueba' });
  await owner.engine.syncNow();
  return { server, owner, built };
}

/** Un dispositivo de `uid` (miembro con lo que le den) ya sincronizado. */
async function deviceOf(server: FakeServer, uid: string, email: string): Promise<Device> {
  const d = await makeDevice(server, crypto.randomUUID(), '0.021', {}, undefined, { id: uid, email });
  devices.push(d);
  await d.engine.syncNow();
  await d.engine.syncNow();
  return d;
}

describe('la pantalla sin acceso del link de una escena', () => {
  it('un proyecto que no ve: lo mismo exista o no, sin nada del proyecto ni de la escena; Request access y «Request sent»', async () => {
    const { server, owner, built } = await series();
    // Mario ve otro proyecto (una página), no ERSO.
    const otro = await owner.tree.createProject('Otro');
    const nota = await owner.tree.create(null, 'Notas', otro);
    await owner.engine.syncNow();
    server.addMember('mario', 'member', 'mario@test');
    server.grant('mario', { pageId: nota }, 'view');
    const mario = await deviceOf(server, 'mario', 'mario@test');

    const real = mount(mario, <Shell />, '/map/scenes?project=ERSO&scene=5029');
    await until(() => real.querySelector('.scene-request'), 'la pantalla sin acceso');
    const screen = real.querySelector<HTMLElement>('.mp')!;
    expect(screen.querySelector('.scene-request p')!.textContent).toBe(`${t('page.sceneNoAccess')} ${t('page.sceneRequestAsk')}`);
    expect(screen.textContent).not.toMatch(/ERSO|5029|Serie/);
    const html = screen.innerHTML;
    // Uno que no existe: la misma pantalla.
    act(() => navigate('/map/scenes?project=NOPE&scene=5029'));
    await wait();
    expect(real.querySelector('.mp')!.innerHTML).toBe(html);
    act(() => navigate('/map/scenes?project=ERSO&scene=5029'));
    await wait();

    await click(button(t('file.request'), real));
    await until(() => real.querySelector('.scene-request')?.textContent === t('page.sceneRequestSent'), 'Request sent');
    expect(server.sceneAccessRequests).toEqual([expect.objectContaining({ user_id: 'mario', project_id: null, project_text: 'erso', scene_text: '5029', state: 'pending' })]);
    // Le llega al dueño, con el proyecto de verdad.
    const items = await new FakeRemote(server, '0.021').accessRequestsRemote().pending({ scenes: true });
    expect(items.map((r) => r.scene)).toEqual([{ projectId: built.projectId, text: '5029', linkText: 'erso', exact: false }]);
    // El dispositivo recuerda que lo pidió: otra vez, «You asked for access on…» y Ask again.
    const again = mount(mario, <Shell />, '/map/scenes?project=ERSO&scene=5029');
    await until(() => again.querySelector('.scene-request'), 'otra vez');
    expect(button(t('file.requestAgain'), again)).toBeTruthy();
  });

  it('un invitado que ve una escena pide otra por el id del proyecto; el tope lleno se dice en palabras', async () => {
    const { server, owner, built } = await series(29, false);
    await owner.tree.setPatch(built.ids.s027, { settings: { entity: { kind: 'scene', code: '105_027' } } as unknown as PageSettings });
    await owner.engine.syncNow();
    server.addMember('vera', 'guest', 'vera@vendor.test');
    server.grant('vera', { pageId: built.ids.s027 }, 'view');
    const vera = await deviceOf(server, 'vera', 'vera@vendor.test');
    // Como llega del link: la app abierta en su escena, y el link de otra.
    const host = mount(vera, <Shell />, pagePath(built.ids.s027));
    await until(() => host.querySelector('.ov-nav'), 'Overview');
    act(() => navigate(`/map/scenes?project=${built.projectId}&scene=5029`));
    await until(() => host.querySelector('.mp-scene .scene-request'), 'la pantalla sin acceso en la escena');
    expect(host.querySelector('.mp-scene')!.textContent).not.toMatch(/fugitivo|Arenera|isn’t/);
    await click(button(t('file.request'), host));
    await until(() => host.querySelector('.scene-request')?.textContent === t('page.sceneRequestSent'), 'Request sent');
    expect(server.sceneAccessRequests).toEqual([expect.objectContaining({ user_id: 'vera', project_id: built.projectId, project_text: null, scene_text: '5029' })]);
    // El tope lleno.
    server.sceneAccessCalls.set('vera', { start: server.now(), calls: 20 });
    act(() => navigate(`/map/scenes?project=${built.projectId}&scene=5025`));
    await until(() => button(t('file.request'), host), 'el botón otra vez');
    await click(button(t('file.request'), host));
    await until(() => host.querySelector('.scene-request .error'), 'el error');
    expect(host.querySelector('.scene-request .error')!.textContent).toBe(t('file.requestLimited'));
  });

  it('el proyecto del link por la primera palabra va como texto; por el nombre entero, como id', async () => {
    const { server, owner, built } = await series(29, false);
    await owner.tree.setPatch(built.ids.s027, { settings: { entity: { kind: 'scene', code: '105_027' } } as unknown as PageSettings });
    await owner.engine.syncNow();
    server.addMember('vera', 'guest', 'vera@vendor.test');
    server.grant('vera', { pageId: built.ids.s027 }, 'view');
    const vera = await deviceOf(server, 'vera', 'vera@vendor.test');
    const host = mount(vera, <Shell />, pagePath(built.ids.s027));
    await until(() => host.querySelector('.ov-nav'), 'Overview');
    // «ERSO» coincide acá solo por la primera palabra: puede nombrar otro proyecto que Vera no ve. Va el texto.
    act(() => navigate('/map/scenes?project=ERSO&scene=5029'));
    await until(() => host.querySelector('.mp-scene .scene-request'), 'la pantalla sin acceso');
    await click(button(t('file.request'), host));
    await until(() => host.querySelector('.scene-request')?.textContent === t('page.sceneRequestSent'), 'Request sent');
    expect(server.sceneAccessRequests).toEqual([expect.objectContaining({ user_id: 'vera', project_id: null, project_text: 'erso', scene_text: '5029' })]);
    // El nombre entero: el id del proyecto.
    act(() => navigate(`/map/scenes?project=${encodeURIComponent('ERSO | Serie de prueba')}&scene=5025`));
    await until(() => button(t('file.request'), host), 'el botón otra vez');
    await click(button(t('file.request'), host));
    await until(() => server.sceneAccessRequests.length === 2, 'el segundo pedido');
    expect(server.sceneAccessRequests[1]).toMatchObject({ project_id: built.projectId, project_text: null, scene_text: '5025' });
  });

  it('un admin que ve una sola escena del proyecto también puede pedir otra (no se mira el rol)', async () => {
    const { server, owner, built } = await series(29, false);
    await owner.tree.setPatch(built.ids.s027, { settings: { entity: { kind: 'scene', code: '105_027' } } as unknown as PageSettings });
    await owner.engine.syncNow();
    server.addMember('ana', 'admin', 'ana@test');
    server.grant('ana', { pageId: built.ids.s027 }, 'view');
    const ana = await deviceOf(server, 'ana', 'ana@test');
    const host = mount(ana, <Shell />, pagePath(built.ids.s027));
    await until(() => host.querySelector('.ov-nav'), 'Overview');
    act(() => navigate(`/map/scenes?project=${built.projectId}&scene=5029`));
    await until(() => host.querySelector('.mp-scene .scene-request'), 'la pantalla sin acceso');
    expect(host.querySelector('.mp-scene')!.textContent).not.toMatch(/isn’t|fugitivo/);
    await click(button(t('file.request'), host));
    await until(() => server.sceneAccessRequests.length === 1, 'el pedido');
    expect(server.sceneAccessRequests[0]).toMatchObject({ user_id: 'ana', project_id: built.projectId, scene_text: '5029' });
  });

  it('quien ve una parte sin ninguna escena: el link de una escena da la pantalla sin acceso, y sin escena no dice «no hay»', async () => {
    const { server, owner, built } = await series(29, false);
    const nota = await owner.tree.create(null, 'Notas sueltas', built.projectId);
    await owner.engine.syncNow();
    server.addMember('mario', 'member', 'mario@test');
    server.grant('mario', { pageId: nota }, 'view');
    const mario = await deviceOf(server, 'mario', 'mario@test');
    const host = mount(mario, <Shell />, `/map/scenes?project=${built.projectId}&scene=5029`);
    await until(() => host.querySelector('.mp .scene-request'), 'la pantalla sin acceso');
    expect(host.textContent).not.toContain(t('map.empty'));
    await click(button(t('file.request'), host));
    await until(() => server.sceneAccessRequests.length === 1, 'el pedido');
    expect(server.sceneAccessRequests[0]).toMatchObject({ user_id: 'mario', project_id: built.projectId, scene_text: '5029' });
    act(() => navigate(`/map/scenes?project=${built.projectId}`));
    await until(() => host.querySelector('.mp-empty'), 'la lista vacía');
    expect(host.querySelector('.mp-empty')!.textContent).toBe(t('map.emptyPartial'));
  });

  it('con la base vieja: «You don’t have access to this.» sin botón', async () => {
    const { server } = await series(28);
    server.addMember('mario', 'member', 'mario@test');
    const mario = await deviceOf(server, 'mario', 'mario@test');
    const host = mount(mario, <NoProjectsOpen />, '/map/scenes?project=ERSO&scene=5029');
    await until(() => host.querySelector('.scene-request'), 'la pantalla');
    expect(host.querySelector('.scene-request')!.textContent).toBe(t('page.sceneNoAccess'));
    expect(button(t('file.request'), host)).toBeUndefined();
  });

  it('sin ningún proyecto: la pantalla sin acceso en vez de «No projects yet», con Request access', async () => {
    const { server } = await series();
    server.addMember('mario', 'member', 'mario@test');
    const mario = await deviceOf(server, 'mario', 'mario@test');
    const host = mount(mario, <NoProjectsOpen />, '/map/scenes?project=ERSO&scene=5029');
    await until(() => button(t('file.request'), host), 'Request access');
    expect(host.textContent).not.toMatch(/ERSO|5029/);
    await click(button(t('file.request'), host));
    await until(() => host.querySelector('.scene-request')?.textContent === t('page.sceneRequestSent'), 'Request sent');
    expect(server.sceneAccessRequests).toHaveLength(1);
  });
});

/** Elegir una opción de un `<select>` controlado por React. */
async function pick(select: HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await wait();
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. Quien decide
// ---------------------------------------------------------------------------------------------------------------------

async function decider(opts: { clean?: boolean } = {}) {
  const { server, owner, built } = await series();
  server.addMember('vera', 'guest', 'vera@vendor.test');
  if (opts.clean === false) server.settings = { ...server.settings!, cleanMinVersion: null };
  await owner.engine.syncNow();
  const inbox = new AccessRequestsInbox(owner.remote.accessRequestsRemote(), { online: () => server.online });
  inboxes.push(inbox);
  inbox.setEnabled(true);
  inbox.setScenes(true);
  const ask = async (target: SceneTarget): Promise<AccessRequest> => {
    await new FakeRemote(server, '0.021', 'vera').requestSceneAccess(target);
    // Una pregunta que ya estaba en curso puede devolver la lista de antes: se pregunta hasta que llega.
    for (let i = 0; i < 20; i++) {
      await inbox.poll();
      const item = inbox.getSnapshot().items.find((r) => r.scene && r.scene.text === target.scene.trim());
      if (item) return item;
      await wait(20);
    }
    throw new Error('no llegó el pedido');
  };
  return { server, owner, built, inbox, ask };
}

describe('la ventana de decidir el pedido de una escena', () => {
  it('la escena del link elegida, qué es y cuántas lleva adentro; Give access da Ver con la marca escrita antes', async () => {
    const { server, owner, built, inbox, ask } = await decider();
    const r = await ask(byText('ERSO | Serie de prueba', 'ERSO_5029_010'));
    expect(requestKey(r)).toBe(`${r.id}:${built.projectId}`);
    let closed = false;
    const host = mount(owner, <AccessRequestDialog request={r} onClose={() => (closed = true)} />, '/', inbox);
    await until(() => host.querySelector('.scene-request-form'), 'la ventana');
    expect(host.textContent).toContain(t('requests.asksScene', { email: 'vera@vendor.test', scene: 'ERSO_5029_010', project: 'ERSO | Serie de prueba' }));
    expect(host.querySelector('.scene-request-link')!.textContent).toBe(t('requests.sceneLinkSaid', { project: 'erso | serie de prueba' }));
    // El nombre entero y la escena encontrada: la lista queda fija en ella, sin confirmación.
    const select = host.querySelector<HTMLSelectElement>('.scene-request-form select')!;
    expect(select.value).toBe(built.ids.s029);
    expect(select.disabled).toBe(true);
    expect(select.options).toHaveLength(1);
    const inside = owner.engine.branchOf(built.ids.s029).length - 1;
    expect(host.querySelector('.scene-request-info')!.textContent).toBe(t('requests.sceneInfo', { count: inside }));
    await click(button(t('requests.give'), host));
    await until(() => closed, 'cerrada');
    expect(server.grants.find((g) => g.user_id === 'vera' && g.page_id === built.ids.s029)?.level).toBe('view');
    // La marca de escena se escribió y subió antes (la base la exige).
    expect((server.pages.get(built.ids.s029)?.settings as { entity?: { kind?: string } } | undefined)?.entity?.kind).toBe('scene');
    expect(server.sceneAccessRequests[0].state).toBe('accepted');
    expect(inbox.getSnapshot().items).toEqual([]);
  });

  it('por la primera palabra del nombre: el texto del link, la escena a mano y la confirmación «asked for X, giving Y»', async () => {
    const { server, owner, built, inbox, ask } = await decider();
    const r = await ask(byText('ERSO', '5029'));
    expect(r.scene).toMatchObject({ projectId: built.projectId, linkText: 'erso', exact: false });
    let closed = false;
    const host = mount(owner, <AccessRequestDialog request={r} onClose={() => (closed = true)} />, '/', inbox);
    await until(() => host.querySelector('.scene-request-form'), 'la ventana');
    expect(host.querySelector('.scene-request-link')!.textContent).toBe(t('requests.sceneByWord', { project: 'erso' }));
    // La escena existe en este proyecto, pero no se elige sola: el link puede nombrar otro proyecto.
    const select = host.querySelector<HTMLSelectElement>('.scene-request-form select')!;
    expect(select.value).toBe('');
    expect(select.disabled).toBe(false);
    expect(button(t('requests.give'), host)!.disabled).toBe(true);
    await pick(select, built.ids.s025);
    const given = select.selectedOptions[0].textContent!;
    // El primer Give access no da: muestra qué pedía el link y qué se da.
    await click(button(t('requests.give'), host));
    expect(host.querySelector('.scene-request-confirm')!.textContent).toBe(t('requests.sceneConfirm', { asked: '5029', given }));
    expect(server.grants.some((g) => g.user_id === 'vera')).toBe(false);
    // Cambiar la escena vuelve a pedir la confirmación.
    await pick(select, built.ids.s029);
    expect(host.querySelector('.scene-request-confirm')).toBeNull();
    await click(button(t('requests.give'), host));
    await click(button(t('requests.giveConfirm'), host));
    await until(() => closed, 'cerrada');
    expect(server.grants.find((g) => g.user_id === 'vera' && g.page_id === built.ids.s029)?.level).toBe('view');
  });

  it('una escena del link que no aparece: lo dice y se elige; sin el interruptor, Give access apagado y el aviso', async () => {
    const { inbox, owner, ask } = await decider({ clean: false });
    const r = await ask(byText('ERSO', '9999'));
    const host = mount(owner, <AccessRequestDialog request={r} onClose={() => undefined} />, '/', inbox);
    await until(() => host.querySelector('.scene-request-form'), 'la ventana');
    expect(host.textContent).toContain(t('requests.sceneAsked', { scene: '9999' }));
    expect(host.querySelector<HTMLSelectElement>('.scene-request-form select')!.value).toBe('');
    expect(host.querySelector('.scene-request-info')).toBeNull();
    expect(button(t('requests.give'), host)!.disabled).toBe(true);
    expect(host.textContent).toContain(t('scenes.share.cleanOff'));
    // Rechazar sí se puede.
    expect(button(t('requests.decline'), host)!.disabled).toBe(false);
  });

  it('una escena con otra entidad adentro: apagada en la lista y, elegida, el motivo y Give access apagado', async () => {
    const { owner, built, inbox, ask } = await decider();
    const inner = await owner.tree.create(built.ids.s029, 'Galpón', built.projectId);
    await owner.tree.setPatch(inner, { settings: { entity: { kind: 'location' } } as unknown as PageSettings });
    await owner.engine.syncNow();
    const r = await ask(byId(built.projectId, '5029'));
    const host = mount(owner, <AccessRequestDialog request={r} onClose={() => undefined} />, '/', inbox);
    await until(() => host.querySelector('.scene-request-form'), 'la ventana');
    const option = host.querySelector<HTMLOptionElement>(`.scene-request-form option[value="${built.ids.s029}"]`)!;
    expect(option.disabled).toBe(true);
    expect(host.textContent).toContain(t('scenes.share.blocked'));
    expect(button(t('requests.give'), host)!.disabled).toBe(true);
  });
});
