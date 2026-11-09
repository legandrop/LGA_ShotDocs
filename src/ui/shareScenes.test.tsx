// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setPageType } from '../relations/entitySync';
import { buildProject, type Built } from '../relations/fixtures/proyectoSintetico';
import { mapPath, navigate, pagePath } from '../router';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeRemote, FakeServer, makeDevice, SCENE_SHARE_MUTANTS, type Device, type SceneShareMutant } from '../sync/testing';
import type { PageSettings } from '../sync/types';
import { settled } from '../test/settle';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { confirmOutsideMove, noticeOutsideCreate, outsideReadersStore } from './outsideReaders';
import { storeProject } from './project';
import { ProjectSwitcher } from './ProjectSwitcher';
import { rowLabel } from '../test/projectRows';
import { ShareDialog } from './ShareDialog';
import { ShareScenesDialog } from './ShareScenesDialog';
import { Shell } from './Workspace';

// *Share scenes* (Docs/Doc_Compartir_Escenas.md, B-1) contra el servidor en memoria, que tiene las mismas reglas que
// 20261118120000_compartir_escenas.sql: los chequeos de seguridad de las tres funciones (cada uno con su mutante, que
// tiene que dar una fuga), la ventana (personas, marcar, guardar, invitar, errores, lo apagado), las entradas (selector de
// proyectos y Panorama), el Panorama de un vendor con dos escenas y la marca del árbol con sus avisos.

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

let clip: string[] = [];
beforeEach(() => {
  localStorage.clear();
  clip = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => void clip.push(t) } });
});

const roots: Root[] = [];
const devices: Device[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount());
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

function services(device: Device): Services {
  return {
    workspace: { config: { url: 'https://x.supabase.co', publishableKey: 'k', name: 'W', localKey: WANKA_LOCAL_KEY, storage: legacyStorageNames(WANKA_LOCAL_KEY) }, client: {} },
    client: { auth: { signOut: vi.fn(), getSession: async () => ({ data: { session: null } }) } },
    user: { id: device.remote.userId, email: device.remote.email },
    db: device.db,
    tree: device.tree,
    docs: device.docs,
    files: device.files,
    media: device.media,
    engine: device.engine,
    access: device.access,
    remote: device.remote as unknown as SupabaseRemote,
    dbName: 'test',
    mediaDb: device.mediaDb,
    comments: device.comments,
    commentsDb: device.commentsDb,
    sizes: device.sizes,
    offline: device.offline,
    shutdown: async () => undefined,
  } as unknown as Services;
}

function mount(d: Device, node: React.ReactNode, start?: string): HTMLElement {
  if (start) history.replaceState(null, '', start);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<ServicesContext.Provider value={services(d)}>{node}</ServicesContext.Provider>));
  return host;
}

const click = (el: Element | null | undefined) => {
  if (!el) throw new Error('no está');
  act(() => (el as HTMLElement).click());
};

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Un botón por su texto, dentro de `root` (la ventana): el aviso de novedades tiene sus propios botones. */
const byText = (text: string, root: ParentNode | null = document.querySelector('.share-scenes')) =>
  [...(root ?? document).querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text);
const sceneRow = (pageId: string) => document.querySelector<HTMLElement>(`.share-scenes-table tr[data-scene="${pageId}"]`);
const checkbox = (pageId: string) => sceneRow(pageId)?.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? null;
const saveButton = () => document.querySelector<HTMLButtonElement>('.share-scenes .team-invite-actions .primary')!;
const levelOf = (server: FakeServer, uid: string, pageId: string) =>
  server.grants.find((g) => g.user_id === uid && g.page_id === pageId)?.level ?? null;

let n = 0;
const fakePhoto = async () => `0000${String(++n).padStart(4, '0')}-aaaa-4bbb-8ccc-dddddddddddd`;

/** Un workspace con el equipo, el interruptor de lo borrado y la base 31; el proyecto sintético y Vera (invitada, el vendor). */
async function workspace(opts: { clean?: boolean; schema?: number } = {}): Promise<{ server: FakeServer; owner: Device; built: Built }> {
  const server = new FakeServer();
  server.enableTeam();
  if (opts.clean !== false) server.enableClean();
  const schema = opts.schema ?? 31;
  if (schema >= 31) server.enableVendors();
  else if (schema >= 28) server.enableSceneShares();
  else server.settings = { ...server.settings!, schemaVersion: schema };
  const owner = await makeDevice(server);
  devices.push(owner);
  const built = await buildProject(owner, fakePhoto, { days: true, indexPage: false });
  await owner.engine.syncNow();
  server.addMember('vera', 'guest', 'vera@vendor.test');
  return { server, owner, built };
}

// ---------------------------------------------------------------------------------------------------------------------
// 1. Las reglas del servidor en memoria y sus mutantes
// ---------------------------------------------------------------------------------------------------------------------

/** Un proyecto chico armado a mano: P (escenas s1, s2, s3 en la papelera, s1 › card; una suelta sin marca; una locación), P2 (q1) y P3 (c1, de Cris). */
async function small() {
  const server = new FakeServer();
  server.enableTeam();
  server.enableClean();
  server.enableSceneShares();
  const owner = await makeDevice(server);
  devices.push(owner);
  await owner.engine.syncNow();
  const t = owner.tree;
  const P = await t.createProject('P');
  const P2 = await t.createProject('P2');
  const P3 = await t.createProject('P3');
  const folder = await t.create(null, 'Escenas', P);
  await t.setPatch(folder, { settings: { holds: 'scene' } as unknown as PageSettings });
  const mark = (code: string) => ({ settings: { entity: { kind: 'scene', code } } as unknown as PageSettings });
  const s1 = await t.create(folder, '001 | Uno', P);
  const s2 = await t.create(folder, '002 | Dos', P);
  const s3 = await t.create(folder, '003 | Tres', P);
  for (const [id, code] of [[s1, '001'], [s2, '002'], [s3, '003']] as const) await t.setPatch(id, mark(code));
  const card = await t.create(s1, 'Ficha 001_010', P);
  const loose = await t.create(null, 'Suelta', P);
  const loc = await t.create(null, 'CENADE', P);
  await t.setPatch(loc, { settings: { entity: { kind: 'location' } } as unknown as PageSettings });
  // S4 lleva adentro una locación: no se comparte (`scene_contains_entities`).
  const s4 = await t.create(folder, '004 | Cuatro', P);
  await t.setPatch(s4, mark('004'));
  const loc4 = await t.create(s4, 'Galpón', P);
  await t.setPatch(loc4, { settings: { entity: { kind: 'location' } } as unknown as PageSettings });
  const q1 = await t.create(null, '001 | Otra', P2);
  await t.setPatch(q1, mark('001'));
  const c1 = await t.create(null, '001 | De Cris', P3);
  await t.setPatch(c1, mark('001'));
  await t.trash(s3);
  await owner.engine.syncNow();
  server.projects.get(P3)!.owner_id = 'cris';
  server.addMember('vera', 'guest', 'vera@vendor.test');
  server.addMember('mario', 'member', 'mario@test');
  server.addMember('pablo', 'member', 'pablo@test');
  server.addMember('ada', 'admin', 'ada@test');
  server.addMember('bob', 'member', 'bob@test');
  server.addMember('cris', 'member', 'cris@test');
  // Gina es invitada y dueña de P4 (lo creó antes de pasar a invitada).
  const P4 = await t.createProject('P4');
  await owner.engine.syncNow();
  server.addMember('gina', 'guest', 'gina@test');
  server.projects.get(P4)!.owner_id = 'gina';
  server.grant('mario', { pageId: s1 }, 'edit');
  server.grant('pablo', { projectId: P }, 'view');
  const as = (uid: string) => new FakeRemote(server, '0.021', uid);
  return { server, owner: owner.remote, as, P, P2, P3, P4, folder, s1, s2, s3, s4, loc4, card, loose, loc, q1, c1 };
}
type Small = Awaited<ReturnType<typeof small>>;

/** El error de un pedido (o '' si no falló). */
async function failure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return '';
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Cada chequeo: `true` si se mantiene (rechaza, o no deja ver ni tocar lo que no debe). Con su mutante, `false`. `sharePage`
 * es una segunda capa (`can_share` del proyecto ya lo cubre en el mismo proyecto): se prueba con `project` también afuera.
 */
const CHECKS: Record<SceneShareMutant, { also?: SceneShareMutant[]; run: (e: Small) => Promise<boolean> }> = {
  role: { run: async (e) => (await failure(e.as('cris').setPageShares(e.P3, 'vera@vendor.test', [e.c1], [], 'view'))) === 'not_allowed' },
  canShare: { run: async (e) => (await failure(e.as('ada').projectPageShares(e.P))) === 'not_allowed' },
  clean: {
    run: async (e) => {
      e.server.settings = { ...e.server.settings!, cleanMinVersion: null };
      return (await failure(e.owner.setPageShares(e.P, 'vera@vendor.test', [e.s1], [], 'view'))) === 'clean_off' && levelOf(e.server, 'vera', e.s1) === null;
    },
  },
  level: {
    run: async (e) =>
      (await failure(e.owner.setPageShares(e.P, 'vera@vendor.test', [e.s1], [], 'edit' as 'view'))) === 'level_invalid' && levelOf(e.server, 'vera', e.s1) === null,
  },
  cap: {
    run: async (e) =>
      (await failure(e.owner.setPageShares(e.P, 'vera@vendor.test', Array.from({ length: 201 }, () => crypto.randomUUID()), [], 'view'))) === 'too_many_pages',
  },
  project: { run: async (e) => (await failure(e.owner.setPageShares(e.P, 'vera@vendor.test', [e.q1], [], 'view'))) === 'page_invalid' && levelOf(e.server, 'vera', e.q1) === null },
  email: {
    run: async (e) =>
      (await failure(e.owner.setPageShares(e.P, 'no-es-correo', [e.s1], [], 'view'))) === 'email_invalid' &&
      !e.server.invitations.some((i) => i.email === 'no-es-correo'),
  },
  pagesList: {
    run: async (e) =>
      (await failure(e.owner.setPageShares(e.P, 'vera@vendor.test', [e.s1, e.s1], [], 'view'))) === 'pages_invalid' &&
      levelOf(e.server, 'vera', e.s1) === null,
  },
  alive: { run: async (e) => (await failure(e.owner.setPageShares(e.P, 'vera@vendor.test', [e.s3], [], 'view'))) === 'page_invalid' && levelOf(e.server, 'vera', e.s3) === null },
  entities: {
    run: async (e) =>
      (await failure(e.owner.setPageShares(e.P, 'vera@vendor.test', [e.s1, e.s4], [], 'view'))) === 'scene_contains_entities' &&
      !e.server.grants.some((g) => g.user_id === 'vera'),
  },
  sharePage: {
    also: ['project'],
    run: async (e) => {
      // Vera ve c1 (de Cris): la dueña no puede compartir esa página, y tampoco sacarla.
      e.server.grant('vera', { pageId: e.c1 }, 'view');
      return (await failure(e.owner.setPageShares(e.P, 'vera@vendor.test', [], [e.c1], 'view'))) === 'page_invalid' && levelOf(e.server, 'vera', e.c1) === 'view';
    },
  },
  mark: {
    run: async (e) =>
      (await failure(e.owner.setPageShares(e.P, 'vera@vendor.test', [e.loose], [], 'view'))) === 'page_invalid' &&
      (await failure(e.owner.setPageShares(e.P, 'vera@vendor.test', [e.loc], [], 'view'))) === 'page_invalid' &&
      (await failure(e.owner.setPageShares(e.P, 'vera@vendor.test', [e.folder], [], 'view'))) === 'page_invalid' &&
      !e.server.grants.some((g) => g.user_id === 'vera'),
  },
  allOrNothing: {
    run: async (e) => (await failure(e.owner.setPageShares(e.P, 'vera@vendor.test', [e.s1, e.loose], [], 'view'))) === 'page_invalid' && levelOf(e.server, 'vera', e.s1) === null,
  },
  lowers: {
    run: async (e) => {
      // Pablo ve todo P (Ver): agregar Ver sobre S1 no crea nada.
      await e.owner.setPageShares(e.P, 'pablo@test', [e.s1], [], 'view');
      return levelOf(e.server, 'pablo', e.s1) === null;
    },
  },
  upsert: {
    // Segunda capa: sin la comparación de antes (`lowers`), el upsert tampoco baja el Editar de Mario.
    also: ['lowers'],
    run: async (e) => {
      await e.owner.setPageShares(e.P, 'mario@test', [e.s1], [], 'view');
      return levelOf(e.server, 'mario', e.s1) === 'edit';
    },
  },
  memberInvitation: {
    run: async (e) => {
      e.server.invitations.push({ id: 'inv-mario', email: 'mario@test', role: 'guest', grants: [{ page_id: e.s1, level: 'view' }], used_at: null, invited_by: e.server.ownerId });
      return (await failure(e.owner.setPageShares(e.P, 'mario@test', [e.s2], [], 'view'))) === 'invitation_exists' && levelOf(e.server, 'mario', e.s2) === null;
    },
  },
  removesHigher: {
    run: async (e) => {
      await e.owner.setPageShares(e.P, 'mario@test', [], [e.s1], 'view');
      return levelOf(e.server, 'mario', e.s1) === 'edit';
    },
  },
  removesProject: {
    run: async (e) => {
      await e.owner.setPageShares(e.P, 'pablo@test', [], [e.s1], 'view');
      return e.server.grants.some((g) => g.user_id === 'pablo' && g.project_id === e.P && g.level === 'view');
    },
  },
  inviteOwner: {
    run: async (e) => {
      e.server.invitations.push({ id: 'inv-ada', email: 'otro@vendor.test', role: 'guest', grants: [], used_at: null, invited_by: 'ada' });
      return (await failure(e.owner.setPageShares(e.P, 'otro@vendor.test', [e.s1], [], 'view'))) === 'invitation_exists' && e.server.invitations.find((i) => i.id === 'inv-ada')!.grants.length === 0;
    },
  },
  inviteRole: {
    run: async (e) => {
      e.server.invitations.push({ id: 'inv-rol', email: 'rol@vendor.test', role: 'member', grants: [], used_at: null, invited_by: e.server.ownerId });
      return (await failure(e.owner.setPageShares(e.P, 'rol@vendor.test', [e.s1], [], 'view'))) === 'invitation_role' && e.server.invitations.find((i) => i.id === 'inv-rol')!.grants.length === 0;
    },
  },
  inviteRemove: {
    run: async (e) => {
      await e.owner.setPageShares(e.P, 'nuevo@vendor.test', [e.s1, e.s2], [], 'view');
      const err = await failure(e.owner.setPageShares(e.P, 'nuevo@vendor.test', [], [e.s1], 'view'));
      const inv = e.server.invitations.find((i) => i.email === 'nuevo@vendor.test')!;
      return err === 'invitation_remove' && inv.grants.some((g) => 'page_id' in g && g.page_id === e.s1);
    },
  },
  inviteCap: {
    run: async (e) => {
      const grants = Array.from({ length: 200 }, () => ({ page_id: crypto.randomUUID(), level: 'view' as const }));
      e.server.invitations.push({ id: 'inv-tope', email: 'tope@vendor.test', role: 'guest', grants, used_at: null, invited_by: e.server.ownerId });
      return (await failure(e.owner.setPageShares(e.P, 'tope@vendor.test', [e.s1], [], 'view'))) === 'too_many_pages';
    },
  },
  listProject: {
    run: async (e) => {
      e.server.grant('vera', { pageId: e.q1 }, 'view');
      return !(await e.owner.projectPageShares(e.P)).some((r) => r.page_id === e.q1);
    },
  },
  listAlive: {
    run: async (e) => {
      e.server.invitations.push({ id: 'inv-papelera', email: 'otro@vendor.test', role: 'guest', grants: [{ page_id: e.s3, level: 'view' }], used_at: null, invited_by: e.server.ownerId });
      return !(await e.owner.projectPageShares(e.P)).some((r) => r.page_id === e.s3);
    },
  },
  listTrash: {
    run: async (e) => {
      e.server.grant('vera', { pageId: e.s3 }, 'view');
      const row = (await e.owner.projectPageShares(e.P)).find((r) => r.page_id === e.s3);
      return row?.in_trash === true;
    },
  },
  readersCanShare: { run: async (e) => (await failure(e.as('bob').pagesWithOutsideReaders(e.P))) === 'not_allowed' },
  readersProject: {
    run: async (e) => {
      e.server.grant('vera', { pageId: e.q1 }, 'view');
      return !(await e.owner.pagesWithOutsideReaders(e.P)).has(e.q1);
    },
  },
  readersGuest: { run: async (e) => (await failure(e.as('gina').pagesWithOutsideReaders(e.P4))) === 'not_allowed' },
  hasEdit: {
    run: async (e) => {
      e.server.grant('vera', { pageId: e.s1 }, 'view');
      // Vera (invitada, Ver) y Pablo (Ver sobre P) no editan S1: la base les dice que no.
      return !(await e.as('vera').pageHasOutsideReaders(e.s1)) && !(await e.as('pablo').pageHasOutsideReaders(e.card));
    },
  },
  guard: {
    run: async (e) => {
      // Marcar como locación la ficha de S1, que ve Vera.
      e.server.grant('vera', { pageId: e.s1 }, 'view');
      const err = await failure(e.owner.updatePage(e.card, { settings: { entity: { kind: 'location' } } as unknown as PageSettings }));
      return err === 'entity_in_shared_scene' && !(e.server.pages.get(e.card)!.settings as { entity?: unknown }).entity;
    },
  },
  guardUnmark: {
    run: async (e) => {
      // Desmarcar S1 compartida, meter la locación y volver a marcar: lo primero ya se rechaza.
      e.server.grant('vera', { pageId: e.s1 }, 'view');
      const err = await failure(e.owner.updatePage(e.s1, { settings: {} as unknown as PageSettings }));
      return err === 'entity_in_shared_scene' && (e.server.pages.get(e.s1)!.settings as { entity?: { kind?: string } }).entity?.kind === 'scene';
    },
  },
  guardMove: {
    run: async (e) => {
      // «Suelta» (sin marca, en la raíz) no entra en S1, que ve Vera: nada de afuera entra moviéndolo.
      e.server.grant('vera', { pageId: e.s1 }, 'view');
      const err = await failure(e.owner.updatePage(e.loose, { parent_id: e.s1 }));
      return err === 'moved_into_shared_scene' && e.server.pages.get(e.loose)!.parent_id === null;
    },
  },
  entitiesSelf: {
    run: async (e) => {
      // S2 es escena y además guarda locaciones, sin nada adentro: no se comparte.
      await e.owner.updatePage(e.s2, { settings: { entity: { kind: 'scene', code: '002' }, holds: 'location' } as unknown as PageSettings });
      return (await failure(e.owner.setPageShares(e.P, 'vera@vendor.test', [e.s2], [], 'view'))) === 'scene_contains_entities' && levelOf(e.server, 'vera', e.s2) === null;
    },
  },
};

describe('Share scenes: las reglas del servidor en memoria', () => {
  it.each(SCENE_SHARE_MUTANTS.map((m) => [m] as const))('el chequeo «%s» se mantiene, y sin él hay una fuga (mutante)', async (which) => {
    const check = CHECKS[which];
    expect(await check.run(await small())).toBe(true);
    const e = await small();
    for (const m of [which, ...(check.also ?? [])]) e.server.sceneShareMutants.add(m);
    expect(await check.run(e)).toBe(false);
  });

  it('`sharePage` es una segunda capa: con solo `project` afuera, igual rechaza una página que no se puede compartir', async () => {
    const e = await small();
    e.server.sceneShareMutants.add('project');
    expect(await CHECKS.sharePage.run(e)).toBe(true);
  });

  it('mover: adentro de la misma escena compartida y sacar, sí; de afuera (también en dos pasos) o de otra escena compartida, no', async () => {
    const e = await small();
    await e.owner.updatePage(e.loose, { parent_id: e.s1 });
    e.server.grant('vera', { pageId: e.s1 }, 'view');
    e.server.grant('vera', { pageId: e.s2 }, 'view');
    const move = (id: string, parent: string | null) => failure(e.owner.updatePage(id, { parent_id: parent }));
    expect(await move(e.loose, e.card)).toBe('');
    expect(await move(e.loose, e.s1)).toBe('');
    expect(await move(e.loose, null)).toBe('');
    expect(await move(e.loose, e.s1)).toBe('moved_into_shared_scene');
    // Una locación marcada, de su carpeta a la raíz y de ahí a S1: el segundo paso no.
    expect(await move(e.loc, e.folder)).toBe('');
    expect(await move(e.loc, null)).toBe('');
    expect(await move(e.loc, e.card)).toBe('moved_into_shared_scene');
    // De S1 a S2 (las dos compartidas), no.
    expect(await move(e.card, e.s2)).toBe('moved_into_shared_scene');
    expect(e.server.pages.get(e.card)!.parent_id).toBe(e.s1);
    // Para meterla: dejar de compartir, mover y volver a compartir (y ahí `scene_contains_entities` lo mira).
    await e.owner.setPageShares(e.P, 'vera@vendor.test', [], [e.s1], 'view');
    expect(await move(e.loc, e.s1)).toBe('');
    expect(await failure(e.owner.setPageShares(e.P, 'vera@vendor.test', [e.s1], [], 'view'))).toBe('scene_contains_entities');
  });

  it('`holds: false` no es una marca; `dayReports` sí (una carpeta de días adentro de una escena compartida)', async () => {
    const e = await small();
    e.server.grant('vera', { pageId: e.s1 }, 'view');
    const set = (id: string, settings: object) => e.owner.updatePage(id, { settings: settings as unknown as PageSettings });
    expect(await failure(set(e.card, { holds: false }))).toBe('');
    expect(await failure(set(e.card, { holds: '' }))).toBe('');
    expect(await failure(set(e.card, { dayReports: {} }))).toBe('entity_in_shared_scene');
    // Compartir una escena con una carpeta de días adentro tampoco.
    await set(e.loose, { dayReports: {} });
    await e.owner.updatePage(e.loose, { parent_id: e.s2 });
    expect(await failure(e.owner.setPageShares(e.P, 'vera@vendor.test', [e.s2], [], 'view'))).toBe('scene_contains_entities');
  });

  it('agrega y saca solo lo pedido, cuenta las páginas, invita como invitado y no repite invitaciones', async () => {
    const e = await small();
    expect(await e.owner.setPageShares(e.P, ' Vera@Vendor.test ', [e.s1, e.s2], [], 'view')).toEqual({ result: 'member', pages: 2 });
    expect(levelOf(e.server, 'vera', e.s1)).toBe('view');
    // Subir a Comentar, y no bajar después.
    await e.owner.setPageShares(e.P, 'vera@vendor.test', [e.s2], [], 'comment');
    await e.owner.setPageShares(e.P, 'vera@vendor.test', [e.s2], [], 'view');
    expect(levelOf(e.server, 'vera', e.s2)).toBe('comment');
    expect(await e.owner.setPageShares(e.P, 'vera@vendor.test', [], [e.s2], 'view')).toEqual({ result: 'member', pages: 1 });
    // Pablo ve todo P: agregar no crea nada.
    expect(await e.owner.setPageShares(e.P, 'pablo@test', [e.s1], [], 'view')).toEqual({ result: 'member', pages: 0 });
    // Alguien nuevo: una invitación de invitado, que se suma.
    expect(await e.owner.setPageShares(e.P, 'nuevo@vendor.test', [e.s1], [], 'view')).toEqual({ result: 'invited', pages: 1 });
    expect(await e.owner.setPageShares(e.P, 'nuevo@vendor.test', [e.s2, e.s1], [], 'comment')).toEqual({ result: 'invited', pages: 2 });
    const inv = e.server.invitations.filter((i) => i.email === 'nuevo@vendor.test');
    expect(inv).toHaveLength(1);
    expect(inv[0].role).toBe('guest');
    expect(inv[0].grants.map((g) => g.level)).toEqual(['comment', 'comment']);
    // Lo que lista quién tiene qué: Vera (S1), Mario (Editar S1), Pablo (el proyecto) y la invitación.
    const rows = await e.owner.projectPageShares(e.P);
    expect(rows.map((r) => `${r.email}:${r.page_id === null ? 'P' : r.page_id === e.s1 ? 's1' : 's2'}:${r.level}`).sort()).toEqual(
      ['mario@test:s1:edit', 'nuevo@vendor.test:s1:comment', 'nuevo@vendor.test:s2:comment', 'pablo@test:P:view', 'vera@vendor.test:s1:view'].sort(),
    );
    // La marca del árbol: S1 (Vera e invitación) y S2 (invitación); Mario (Editar) no cuenta.
    expect([...(await e.owner.pagesWithOutsideReaders(e.P))].sort()).toEqual([[e.s1, 2], [e.s2, 1]].sort());
    // La pregunta de quien edita: Mario (Editar sobre S1) sabe que S1 y su ficha la ven de afuera; de S2 no le dice nada.
    expect(await e.as('mario').pageHasOutsideReaders(e.card)).toBe(true);
    expect(await e.as('mario').pageHasOutsideReaders(e.s2)).toBe(false);
    expect(await e.owner.pageHasOutsideReaders(e.loose)).toBe(false);
  });

  it('sacar anda en la papelera, la fila queda revocada y vuelve con el mismo id; el trigger frena entidades en una escena compartida', async () => {
    const e = await small();
    await e.owner.setPageShares(e.P, 'vera@vendor.test', [e.s1, e.s2], [], 'view');
    const id = e.server.grants.find((g) => g.user_id === 'vera' && g.page_id === e.s2)!.id;
    e.server.pages.get(e.s2)!.deleted_at = new Date().toISOString();
    // En la lista, con `in_trash`; agregarla no, sacarla sí.
    expect((await e.owner.projectPageShares(e.P)).find((r) => r.page_id === e.s2)?.in_trash).toBe(true);
    expect(await failure(e.owner.setPageShares(e.P, 'vera@vendor.test', [e.s2], [], 'view'))).toBe('page_invalid');
    expect(await e.owner.setPageShares(e.P, 'vera@vendor.test', [], [e.s2], 'view')).toEqual({ result: 'member', pages: 1 });
    expect(e.server.revokedGrants.map((g) => [g.page_id, g.revoked_by])).toEqual([[e.s2, e.server.ownerId]]);
    e.server.pages.get(e.s2)!.deleted_at = null;
    await e.owner.setPageShares(e.P, 'vera@vendor.test', [e.s2], [], 'comment');
    expect(e.server.grants.find((g) => g.user_id === 'vera' && g.page_id === e.s2)).toMatchObject({ id, level: 'comment' });
    // Una invitación vencida no cuenta: se crea otra.
    e.server.invitations.push({ id: 'vieja', email: 'nuevo@vendor.test', role: 'member', grants: [], used_at: null, invited_by: e.server.ownerId, expires_at: '2000-01-01T00:00:00Z' });
    expect(await e.owner.setPageShares(e.P, 'nuevo@vendor.test', [e.s1], [], 'view')).toEqual({ result: 'invited', pages: 1 });
    // El trigger: nada entra moviéndolo en S1 (la ve Vera), ni se marca la ficha como locación; en S3 (nadie la ve), sí.
    expect(await failure(e.owner.updatePage(e.loc, { parent_id: e.s1 }))).toBe('moved_into_shared_scene');
    expect(await failure(e.owner.updatePage(e.card, { settings: { entity: { kind: 'location' } } as unknown as PageSettings }))).toBe('entity_in_shared_scene');
    expect(await failure(e.owner.updatePage(e.loose, { parent_id: e.s1 }))).toBe('moved_into_shared_scene');
    expect(await failure(e.owner.updatePage(e.loc, { parent_id: e.s3 }))).toBe('');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 2. La ventana
// ---------------------------------------------------------------------------------------------------------------------

describe('Share scenes: la ventana con vendors', () => {
  const rows = () => document.querySelectorAll('.share-scenes-table tr[data-scene]').length;
  /** Las escenas y la lista de vendors de la base (hasta entonces, *New vendor* espera). */
  const loaded = () => rows() === 6 && document.querySelector<HTMLButtonElement>('.share-vendors-add')?.disabled === false;
  const nameInput = () => document.querySelector<HTMLInputElement>('.share-vendor-name')!;
  const railItem = (name: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('.share-vitem')].find((b) => b.querySelector('.nm-text')?.textContent === name);
  const addMail = (email: string) => {
    const input = document.querySelector<HTMLInputElement>('.share-vendor-addmail input')!;
    type(input, email);
    // Enter en el campo manda su formulario: la prueba lo manda directo (jsdom no lo hace solo con la tecla).
    act(() => void input.form!.requestSubmit());
  };
  const status = (id: string) => sceneRow(id)?.querySelector('.c-status')?.textContent ?? '';
  const chips = (id: string) => [...(sceneRow(id)?.querySelectorAll('.share-vchip') ?? [])].map((c) => `${c.textContent}${c.classList.contains('plan') ? '·plan' : ''}`);
  const footer = () => document.querySelector('.share-scenes .team-invite-actions')!.textContent ?? '';
  /** Marca las dos escenas y arma dos vendors por la base: DNEG (S027 y S029, con Vera) y FS (S027, con Nora). */
  async function twoVendors(owner: Device, built: Built) {
    for (const id of [built.ids.s027, built.ids.s029]) await setPageType(owner.tree, id, 'scene');
    await owner.engine.syncNow();
    await owner.remote.saveSceneVendors(built.projectId, [
      { op: 'create', key: 'dn', name: 'DNEG', code: 'DN', color: '#2e5a8e', level: 'comment', add_scenes: [built.ids.s027, built.ids.s029], add_emails: ['vera@vendor.test'] },
      { op: 'create', key: 'fs', name: 'Framestore', code: 'FS', color: '#774dcb', level: 'view', add_scenes: [built.ids.s027], add_emails: ['nora@fs.test'] },
    ]);
  }

  it('crea un vendor, le asigna escenas sin correo (planificación), le carga a Vera y la ve', async () => {
    const { server, owner, built } = await workspace();
    const { s027, s029, s025 } = built.ids;
    mount(owner, <ShareScenesDialog projectId={built.projectId} onClose={() => undefined} />);
    await until(loaded, 'las seis escenas');
    // En orden de número, con la forma de la post; sin vendor elegido no hay casillas.
    expect([...document.querySelectorAll('.share-scenes-code')].map((x) => x.textContent)).toEqual(['4008', '4009', '5025', '5026', '5027', '5029']);
    expect(checkbox(s027)).toBeNull();
    expect(document.querySelector('.share-vendors-overview')!.textContent).toContain('No vendors yet');
    expect(saveButton().disabled).toBe(true);

    click(byText('New vendor'));
    expect(document.activeElement).toBe(nameInput());
    // Sin nombre no se guarda.
    expect(footer()).toContain('Every vendor needs a name.');
    expect(saveButton().disabled).toBe(true);
    type(nameInput(), 'DNEG');
    click(checkbox(s027));
    click(checkbox(s029));
    expect(status(s027)).toBe('Assigning');
    expect(footer()).toContain('+2');
    expect(document.querySelector('.share-vendor-hint')!.textContent).toContain('only planning');
    await act(async () => saveButton().click());
    await until(() => server.vendors.length === 1 && server.vendors[0].scenes.length === 2, 'el vendor guardado');
    expect(server.vendors[0]).toMatchObject({ name: 'DNEG', code: '', level: 'comment', emails: [] });
    // Planificación: nadie ve nada. La marca de escena sí se escribió (la base la pide).
    expect(server.grants.filter((g) => g.user_id === 'vera')).toEqual([]);
    for (const id of [s027, s029]) expect((server.pages.get(id)!.settings as { entity?: { kind?: string } }).entity?.kind).toBe('scene');
    expect(server.pages.get(s025)!.settings?.entity).toBeUndefined();
    await until(() => status(s027) === 'Assigned', 'asignada, sin correo');
    expect(chips(s027)).toEqual(['DNE·plan']);

    addMail('Vera@Vendor.test');
    expect(document.querySelector('.share-vendor-mail.new')!.textContent).toContain('vera@vendor.test');
    expect(saveButton().textContent).toBe('Invite & save');
    await act(async () => saveButton().click());
    await until(() => levelOf(server, 'vera', s027) === 'comment' && levelOf(server, 'vera', s029) === 'comment', 'Vera ve las dos');
    expect(server.grants.filter((g) => g.user_id === 'vera').map((g) => g.page_id).sort()).toEqual([s027, s029].sort());
    await until(() => clip.length === 1, 'el link copiado');
    await until(() => status(s027) === 'Seen', 'la ven');
    expect(chips(s027)).toEqual(['DNE']);
    expect(document.querySelector('.share-vendor-mail.joined')!.textContent).toContain('in');
    // Se vuelve a *All vendors*: el reparto, sin casillas ni estado.
    click(railItem('All vendors'));
    expect(checkbox(s027)).toBeNull();
    expect(document.querySelector('.share-scenes-table th.c-status')).toBeNull();
  });

  it('dos vendors en una escena se avisan; un correo va en un solo vendor; uno nuevo queda invitado; Shift+clic y las vistas', async () => {
    const { server, owner, built } = await workspace();
    const { s027, s029 } = built.ids;
    await twoVendors(owner, built);
    mount(owner, <ShareScenesDialog projectId={built.projectId} onClose={() => undefined} />);
    await until(() => rows() === 6 && railItem('DNEG'), 'las escenas y los vendors');
    expect(chips(s027)).toEqual(['DN', 'FS']);
    expect(sceneRow(s027)!.querySelector('.share-vboth')!.getAttribute('data-tip')).toBe('DNEG, Framestore see it: they see each other\'s comments and emails');
    expect(sceneRow(s029)!.querySelector('.share-vboth')).toBeNull();
    click(byText('2+ vendors1'));
    expect(rows()).toBe(1);
    click(byText('No vendor4'));
    expect(rows()).toBe(4);
    click(byText('All6'));

    click(railItem('DNEG'));
    expect(document.querySelector('.share-vendor-cross')!.textContent).toContain('1 scene of DNEG is also seen by Framestore');
    addMail('nora@fs.test');
    expect(document.querySelector('.share-vendor-hint.err')!.textContent).toContain('already in Framestore');
    expect(document.querySelectorAll('.share-vendor-mail').length).toBe(1);

    // Shift+clic: de la primera a la tercera que se ven, las tres asignadas.
    const ids = [...document.querySelectorAll<HTMLElement>('.share-scenes-table tr[data-scene]')].map((r) => r.dataset.scene!);
    click(checkbox(ids[0]));
    act(() => void checkbox(ids[2])!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true })));
    expect(ids.map((id) => checkbox(id)!.checked)).toEqual([true, true, true, false, true, true]);
    expect(footer()).toContain('+3');
    // Un correo nuevo: invitación de invitado del vendor, sin páginas; el link se copia.
    addMail('nuevo@dneg.test');
    await act(async () => saveButton().click());
    await until(() => server.invitations.some((i) => i.email === 'nuevo@dneg.test'), 'la invitación');
    const inv = server.invitations.find((i) => i.email === 'nuevo@dneg.test')!;
    expect(inv).toMatchObject({ role: 'guest', grants: [], vendor_id: server.vendors.find((v) => v.name === 'DNEG')!.id });
    await until(() => document.querySelector('.share-scenes [role="status"]')?.textContent?.includes('1 email has to join'), 'el aviso');
    expect(clip.length).toBe(1);
    // Vera ve las cinco de DNEG.
    expect(server.grants.filter((g) => g.user_id === 'vera').length).toBe(5);
  });

  it('borrar un vendor y sacar un correo revocan al guardar; cambiar el nivel y el color', async () => {
    const { server, owner, built } = await workspace();
    await twoVendors(owner, built);
    mount(owner, <ShareScenesDialog projectId={built.projectId} onClose={() => undefined} />);
    await until(() => rows() === 6 && railItem('DNEG'), 'los vendors');
    click(railItem('DNEG'));
    click(byText('View'));
    await act(async () => saveButton().click());
    await until(() => levelOf(server, 'vera', built.ids.s027) === 'view', 'Vera con Ver');
    await until(() => railItem('DNEG') && !saveButton().disabled === false, 'al día');
    click(railItem('DNEG'));
    click(document.querySelector('.share-vendor-mail button[aria-label="Remove vera@vendor.test"]'));
    expect(document.querySelector('.share-vendor-mail.removed')).toBeTruthy();
    await act(async () => saveButton().click());
    await until(() => levelOf(server, 'vera', built.ids.s027) === null, 'Vera afuera');
    await until(() => railItem('Framestore'), 'la lista');
    click(railItem('Framestore'));
    click(document.querySelector('.share-vendor-row button[aria-label="Delete vendor"]'));
    click([...document.querySelectorAll<HTMLButtonElement>('.share-vendor-confirm button')].find((b) => b.textContent === 'Delete vendor'));
    expect(footer()).toContain('deleted');
    await act(async () => saveButton().click());
    await until(() => server.vendors.find((v) => v.name === 'Framestore')!.deleted_at, 'Framestore borrado');
    expect(server.invitations.filter((i) => i.email === 'nora@fs.test' && !i.revoked_at)).toEqual([]);
  });

  it('con el interruptor de lo borrado apagado, lo dice y no deja guardar', async () => {
    const { owner, built } = await workspace({ clean: false });
    mount(owner, <ShareScenesDialog projectId={built.projectId} onClose={() => undefined} />);
    await until(loaded, 'las escenas');
    expect(document.querySelector('.share-scenes [role="alert"]')!.textContent).toContain('needs the workspace setting that keeps deleted text out');
  });

  it('los errores de la base se dicen en palabras, y no se guarda nada', async () => {
    const { server, owner, built } = await workspace();
    await twoVendors(owner, built);
    mount(owner, <ShareScenesDialog projectId={built.projectId} onClose={() => undefined} />);
    await until(() => rows() === 6 && railItem('DNEG'), 'los vendors');
    click(railItem('DNEG'));
    // Una escena que pasó a la papelera en otro dispositivo mientras la ventana estaba abierta: la base rechaza todo.
    await setPageType(owner.tree, built.ids.s025, 'scene');
    await owner.engine.syncNow();
    server.pages.get(built.ids.s025)!.deleted_at = new Date().toISOString();
    click(checkbox(built.ids.s025));
    type(nameInput(), 'DNEG Ltd');
    await act(async () => saveButton().click());
    await until(() => document.querySelector('.share-scenes .error')?.textContent?.includes("can't be shared anymore"), 'el error');
    expect(server.vendors.find((v) => v.id === server.vendors[0].id)!.name).toBe('DNEG');
    expect(server.vendors[0].scenes).not.toContain(built.ids.s025);
  });

  it('si no sube lo pendiente de lo que empieza a verse, avisa con Retry y sin Share anyway, y no guarda', async () => {
    const { server, owner, built } = await workspace();
    await twoVendors(owner, built);
    mount(owner, <ShareScenesDialog projectId={built.projectId} onClose={() => undefined} />);
    await until(() => rows() === 6 && railItem('DNEG'), 'los vendors');
    click(railItem('DNEG'));
    click(checkbox(built.ids.s026));
    const upload = vi.spyOn(owner.engine, 'uploadPagesFirst').mockResolvedValue(false);
    await act(async () => saveButton().click());
    await until(() => document.querySelector('.share-scenes [role="alert"]')?.textContent?.includes('Retry'), 'el aviso de lo pendiente');
    expect(byText('Share anyway')).toBeUndefined();
    expect([...(upload.mock.calls[0][0] as string[])].sort()).toEqual([...owner.engine.branchOf(built.ids.s026)].sort());
    expect(levelOf(server, 'vera', built.ids.s026)).toBeNull();
    upload.mockResolvedValue(true);
    await act(async () => byText('Retry')!.click());
    await until(() => levelOf(server, 'vera', built.ids.s026) === 'comment', 'compartida al reintentar');
  });

  it('sin poder subir la marca de escena (sin red), no guarda nada', async () => {
    const { server, owner, built } = await workspace();
    mount(owner, <ShareScenesDialog projectId={built.projectId} onClose={() => undefined} />);
    await until(loaded, 'las escenas');
    click(byText('New vendor'));
    type(nameInput(), 'DNEG');
    click(checkbox(built.ids.s027));
    server.online = false;
    await act(async () => saveButton().click());
    await until(() => document.querySelector('.share-scenes .error')?.textContent?.includes("scene marks couldn't be uploaded"), 'el error de la marca');
    server.online = true;
    expect(server.vendors).toEqual([]);
  });

  it('la tabla se ordena con un clic en cada título y se busca por vendor', async () => {
    const { owner, built } = await workspace();
    await twoVendors(owner, built);
    mount(owner, <ShareScenesDialog projectId={built.projectId} onClose={() => undefined} />);
    await until(() => rows() === 6 && railItem('DNEG'), 'los vendors');
    const order = () => [...document.querySelectorAll('.share-scenes-table .share-scenes-code')].map((x) => x.textContent);
    const header = (label: string) => [...document.querySelectorAll<HTMLElement>('.share-scenes-table th')].find((th) => th.textContent === label)!;
    expect(header('No.').getAttribute('aria-sort')).toBe('ascending');
    click(header('No.').querySelector('button'));
    expect(order()).toEqual(['5029', '5027', '5026', '5025', '4009', '4008']);
    click(header('Vendors').querySelector('button'));
    expect(order().slice(0, 2)).toEqual(['5029', '5027']);
    expect(sceneRow(built.ids.s027)!.querySelector('.share-scenes-title')!.textContent).not.toMatch(/^\s*0?27\s*\|/);
    type(document.querySelector<HTMLInputElement>('.share-scenes input[type="search"]')!, 'fs');
    expect(rows()).toBe(1);
  });

  it('con *Can share scenes* y Ver sobre el proyecto: maneja vendors solo con Ver', async () => {
    const { server, built } = await workspace();
    server.addMember('quinn', 'member', 'quinn@test');
    server.grant('quinn', { projectId: built.projectId }, 'view');
    server.grants.find((g) => g.user_id === 'quinn' && g.project_id === built.projectId)!.share_scenes = true;
    const quinn = await makeDevice(server, crypto.randomUUID(), '0.021', {}, undefined, { id: 'quinn', email: 'quinn@test' });
    devices.push(quinn);
    await quinn.engine.syncNow();
    await quinn.engine.syncNow();
    mount(quinn, <ShareScenesDialog projectId={built.projectId} onClose={() => undefined} />);
    await until(loaded, 'las escenas');
    click(byText('New vendor'));
    expect(byText('View')!.getAttribute('aria-pressed')).toBe('true');
    expect(byText('Comment')!.disabled).toBe(true);
    // Sin la marca de escena (y sin poder editar), una escena no se asigna.
    expect(checkbox(built.ids.s027)!.disabled).toBe(true);
    expect(sceneRow(built.ids.s027)!.textContent).toContain('Not marked as a scene yet');
  });

  it('con tope Ver, a un vendor con Comentar no le suma correos (lo dice antes de guardar)', async () => {
    const { server, built } = await workspace();
    server.addMember('quinn', 'member', 'quinn@test');
    server.grant('quinn', { projectId: built.projectId }, 'view');
    server.grants.find((g) => g.user_id === 'quinn' && g.project_id === built.projectId)!.share_scenes = true;
    server.vendors.push({
      id: crypto.randomUUID(), project_id: built.projectId, name: 'DNEG', code: 'DN', color: '#2e5a8e', level: 'comment',
      created_at: new Date().toISOString(), deleted_at: null, emails: [], scenes: [],
    });
    const quinn = await makeDevice(server, crypto.randomUUID(), '0.021', {}, undefined, { id: 'quinn', email: 'quinn@test' });
    devices.push(quinn);
    await quinn.engine.syncNow();
    await quinn.engine.syncNow();
    mount(quinn, <ShareScenesDialog projectId={built.projectId} onClose={() => undefined} />);
    await until(() => !!railItem('DNEG'), 'el vendor');
    click(railItem('DNEG')!);
    addMail('nora@dneg.test');
    expect(document.querySelector('.share-vendor-hint.err')?.textContent).toContain('up to your own access');
    expect(document.querySelector('.share-vendor-mails')!.textContent).not.toContain('nora@dneg.test');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 3. Dónde está la entrada
// ---------------------------------------------------------------------------------------------------------------------

describe('Share scenes: las entradas', () => {
  const openSwitcher = async () => {
    await until(() => document.querySelector('.project-button'), 'el selector');
    await act(async () => document.querySelector<HTMLButtonElement>('.project-button')!.click());
    await wait();
  };

  it('en el selector de proyectos, para la dueña con la base 31; abre la ventana', async () => {
    const { owner, built } = await workspace();
    storeProject(services(owner).workspace.config.storage, owner.remote.userId, built.projectId);
    mount(owner, <ProjectSwitcher />);
    await openSwitcher();
    // El ⋯ del proyecto (v0.333) trae compartir el proyecto y compartir sus escenas.
    let entry: HTMLButtonElement | null = null;
    act(() => void (entry = rowLabel('Share scenes of “Serie de prueba”')));
    expect(entry!.textContent).toBe('Share scenes…');
    // El orden del ⋯ (v0.333, D853): compartir, compartir escenas y exportar juntos, en ese orden.
    const items = [...document.querySelectorAll<HTMLButtonElement>('.project-pop button')].map((b) => b.textContent);
    expect(items.slice(items.indexOf('Share…'), items.indexOf('Share…') + 3)).toEqual(['Share…', 'Share scenes…', 'Export project…']);
    click(entry);
    await until(() => document.querySelector('.share-scenes'), 'la ventana');
    expect(document.querySelector('.share-scenes h2')!.textContent).toBe('Share scenes of “Serie de prueba”');
  });

  it('no está con una base anterior a la 31, ni para un miembro sin *Can share scenes*; con la casilla, solo eso', async () => {
    const old = await workspace({ schema: 30 });
    storeProject(services(old.owner).workspace.config.storage, old.owner.remote.userId, old.built.projectId);
    mount(old.owner, <ProjectSwitcher />);
    await openSwitcher();
    act(() => {
      expect(rowLabel('Share “Serie de prueba”')).toBeTruthy();
      expect(rowLabel('Share scenes of “Serie de prueba”')).toBeNull();
    });
    for (const r of roots.splice(0)) act(() => r.unmount());
    document.body.innerHTML = '';

    const { server, built } = await workspace();
    server.addMember('beto', 'member', 'beto@test');
    server.grant('beto', { projectId: built.projectId }, 'edit_pages');
    const beto = await makeDevice(server, crypto.randomUUID(), '0.021', {}, undefined, { id: 'beto', email: 'beto@test' });
    devices.push(beto);
    await beto.engine.syncNow();
    await beto.engine.syncNow();
    storeProject(services(beto).workspace.config.storage, 'beto', built.projectId);
    mount(beto, <ProjectSwitcher />);
    await openSwitcher();
    act(() => void expect(rowLabel('Share scenes of “Serie de prueba”')).toBeNull());
    for (const r of roots.splice(0)) act(() => r.unmount());
    document.body.innerHTML = '';

    // Gina, invitada con Comentar y *Can share scenes*: el ⋯ trae solo compartir escenas.
    server.addMember('gina', 'guest', 'gina@prod.test');
    server.grant('gina', { projectId: built.projectId }, 'comment');
    server.grants.find((g) => g.user_id === 'gina' && g.project_id === built.projectId)!.share_scenes = true;
    const gina = await makeDevice(server, crypto.randomUUID(), '0.021', {}, undefined, { id: 'gina', email: 'gina@prod.test' });
    devices.push(gina);
    await gina.engine.syncNow();
    await gina.engine.syncNow();
    storeProject(services(gina).workspace.config.storage, 'gina', built.projectId);
    mount(gina, <ProjectSwitcher />);
    await openSwitcher();
    let scenes: HTMLButtonElement | null = null;
    act(() => {
      expect(rowLabel('Share “Serie de prueba”')).toBeNull();
      scenes = rowLabel('Share scenes of “Serie de prueba”');
    });
    click(scenes);
    await until(() => document.querySelector('.share-scenes'), 'la ventana');
  });

  it('*Can share scenes* en la ventana Share del proyecto: la dueña la pone y la saca', async () => {
    const { server, owner, built } = await workspace();
    server.addMember('pablo', 'member', 'pablo@test');
    server.grant('pablo', { projectId: built.projectId }, 'comment');
    mount(owner, <ShareDialog target={{ projectId: built.projectId }} onClose={() => undefined} />);
    const flag = () => document.querySelector<HTMLInputElement>('.team-share-scenes input');
    await until(() => flag(), 'la casilla');
    expect(document.querySelector('.team-share-scenes')!.textContent).toBe('Can share scenes');
    const grant = () => server.grants.find((g) => g.user_id === 'pablo' && g.project_id === built.projectId)!;
    await act(async () => flag()!.click());
    await until(() => grant().share_scenes === true, 'la casilla puesta');
    await until(() => flag()!.checked, 'la casilla marcada');
    await act(async () => flag()!.click());
    await until(() => grant().share_scenes === false, 'la casilla sacada');
  });

  it('en el Panorama, en la lista de escenas', async () => {
    const { owner, built } = await workspace();
    const host = mount(owner, <Shell />, pagePath(built.ids.s027));
    await until(() => host.querySelector('.page-title'), 'la página');
    act(() => navigate(mapPath('scenes')));
    await until(() => host.querySelector('.mp-share-scenes'), 'el botón');
    click(host.querySelector('.mp-share-scenes'));
    await until(() => document.querySelector('.share-scenes'), 'la ventana');
    act(() => navigate(mapPath('locations')));
    await wait();
    expect(host.querySelector('.mp-share-scenes')).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 4. Lo que ve el vendor
// ---------------------------------------------------------------------------------------------------------------------

/** Comparte S027 y S029 con Vera (con la marca de escena escrita antes) y arma las bases. */
async function shareTwo(server: FakeServer, owner: Device, built: Built): Promise<void> {
  for (const id of [built.ids.s027, built.ids.s029]) await setPageType(owner.tree, id, 'scene');
  await owner.engine.syncNow();
  expect(await owner.remote.setPageShares(built.projectId, 'vera@vendor.test', [built.ids.s027, built.ids.s029], [], 'view')).toEqual({
    result: 'member',
    pages: 2,
  });
  const branch = [...owner.engine.branchOf(built.ids.s027), ...owner.engine.branchOf(built.ids.s029)];
  await owner.engine.prepareBases(branch);
  // Cada página de las dos ramas con texto subido tiene su base limpia (lo que baja quien no ve lo borrado).
  const withText = branch.filter((id) => (server.pages.get(id)?.update_seq ?? 0) > 0);
  expect(withText.length).toBeGreaterThan(0);
  expect(withText.filter((id) => !server.currentBase(id))).toEqual([]);
}

describe('Share scenes: lo que ve el vendor', () => {
  it('con dos escenas: solo esas y sus fichas, en el árbol, en el Panorama y en la cabecera viva', async () => {
    const { server, owner, built } = await workspace();
    await shareTwo(server, owner, built);
    const vera = await makeDevice(server, crypto.randomUUID(), '0.021', {}, undefined, { id: 'vera', email: 'vera@vendor.test' });
    devices.push(vera);
    await vera.engine.syncNow();
    await vera.engine.syncNow();
    // El árbol del dispositivo: las dos escenas y lo de adentro; nada de los costados ni de arriba.
    const mine = [...owner.engine.branchOf(built.ids.s027), ...owner.engine.branchOf(built.ids.s029)].sort();
    expect(vera.tree.roots(built.projectId).map((p) => p.id).sort()).toEqual([built.ids.s027, built.ids.s029].sort());
    const seen = [built.ids.s027, built.ids.s029].flatMap((id) => vera.engine.branchOf(id)).sort();
    expect(seen).toEqual(mine);
    for (const k of ['desglose', 'ep5', 's025', 's026', 's008', 'cenade', 'scout', 'd59', 'd70', 'rodaje', 'notas', 'locaciones']) {
      expect(vera.tree.get(built.ids[k])).toBeUndefined();
    }

    const host = mount(vera, <Shell />, pagePath(built.ids.s027));
    await until(() => host.querySelector('.page-title'), 'la página');
    act(() => navigate(mapPath('scenes')));
    const rows = () => [...host.querySelectorAll<HTMLElement>('.mp-srow')].filter((r) => !r.classList.contains('head'));
    await until(() => host.querySelector('.mp-title') && !host.querySelector('.mp-reading') && rows().length === 2, 'el Panorama del vendor');
    expect(rows().map((r) => r.querySelector('.mp-code')!.textContent)).toEqual(['5027', '5029']);
    expect(host.querySelector('.mp-lede')!.textContent).toContain('from the pages you can see');
    const hidden = ['d58', 'd59', 'd60', 'd70', 'd76', 'scout', 'notas', 's025', 's026', 's008', 's009', 'locaciones', 'rodaje', 'desglose'].map(
      (k) => owner.tree.get(built.ids[k])!.title,
    );
    for (const title of hidden) expect(host.textContent).not.toContain(title);
    // Sin la entrada de compartir (no es dueña ni admin).
    expect(host.querySelector('.mp-share-scenes')).toBeNull();
    // Las otras pestañas: sin locaciones ni días.
    act(() => navigate(mapPath('days')));
    await wait(60);
    for (const title of hidden) expect(host.textContent).not.toContain(title);

    // La cabecera viva de la escena.
    act(() => navigate(pagePath(built.ids.s027)));
    await until(() => host.querySelector('section.lh'), 'la cabecera viva');
    await wait(60);
    for (const title of hidden) expect(host.querySelector('section.lh')!.textContent).not.toContain(title);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 5. Lo que ven personas de afuera: la marca del árbol y los avisos
// ---------------------------------------------------------------------------------------------------------------------

describe('Share scenes: la marca del árbol', () => {
  it('marca la escena compartida y lo de adentro, solo para quien comparte; pregunta al mover adentro y avisa al crear', async () => {
    const { server, owner, built } = await workspace();
    await shareTwo(server, owner, built);
    const host = mount(owner, <Shell />, pagePath(built.ids.s027_010));
    const mark = (id: string) => host.querySelector<HTMLElement>(`.tree-row[data-page="${id}"] .tree-outside`);
    await until(() => mark(built.ids.s027), 'la marca de S027');
    expect(mark(built.ids.s027)!.dataset.outside).toBe('direct');
    expect(mark(built.ids.s027)!.dataset.tip).toBe('Seen by 1 person outside the team (a guest, or View or Comment), with the pages inside');
    expect(mark(built.ids.s027_010)!.dataset.outside).toBe('inside');
    expect(mark(built.ids.s027_010)!.dataset.tip).toContain('through “027 | La ambulancia empieza a zigzaguear”');
    expect(mark(built.ids.s025)).toBeNull();
    expect(mark(built.ids.ep5)).toBeNull();
    expect(host.querySelector<HTMLElement>('.tree-row[data-page="' + built.ids.s027 + '"] .tree-outside')!.getAttribute('title')).toBeNull();

    // Mover a una escena compartida desde afuera de ella, sea lo que sea: lo dice y no mueve, sin opción de seguir.
    // Adentro de la misma escena, o afuera, sí y sin preguntar.
    const svc = services(owner);
    const confirm = vi.fn(() => true);
    const alert = vi.fn();
    vi.stubGlobal('confirm', confirm);
    vi.stubGlobal('alert', alert);
    expect(await confirmOutsideMove(svc, built.ids.notas, built.ids.s027)).toBe(false);
    expect(await confirmOutsideMove(svc, built.ids.cenade, built.ids.s027_010)).toBe(false);
    expect(await confirmOutsideMove(svc, built.ids.locaciones, built.ids.s027)).toBe(false);
    expect(alert).toHaveBeenCalledTimes(3);
    expect((alert.mock.calls[0] as unknown[])[0]).toBe(
      'The scene “027 | La ambulancia empieza a zigzaguear” is shared with people outside the team. To move a page into it, stop sharing it first.',
    );
    // De una escena compartida a otra (S029, que también ve Vera), no.
    expect(await confirmOutsideMove(svc, built.ids.s027_020, built.ids.s029)).toBe(false);
    expect(alert).toHaveBeenCalledTimes(4);
    expect(await confirmOutsideMove(svc, built.ids.s027_020, built.ids.s027_010)).toBe(true);
    expect(await confirmOutsideMove(svc, built.ids.notas, built.ids.s025)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    // Unir dos fichas: lo de una ficha de afuera no pasa a una de adentro (avisa y no une); dos de la misma escena, sí.
    expect(await confirmOutsideMove(svc, built.ids.s025_010, built.ids.s027_010, true)).toBe(false);
    expect((alert.mock.calls[4] as unknown[])[0]).toContain('To merge a card from outside it into one inside it, stop sharing it first.');
    expect(await confirmOutsideMove(svc, built.ids.s027_020, built.ids.s027_010, true)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    // Otra rama que ven de afuera, que no es una escena (la carpeta de locaciones, compartida con *Share*): pregunta.
    server.grant('vera', { pageId: built.ids.locaciones }, 'view');
    await act(async () => outsideReadersStore(svc)!.invalidate(built.projectId));
    await until(() => outsideReadersStore(svc)!.get(built.projectId).has(built.ids.locaciones), 'la carpeta compartida');
    confirm.mockReturnValue(false);
    expect(await confirmOutsideMove(svc, built.ids.notas, built.ids.locaciones)).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect((confirm.mock.calls[0] as unknown[])[0]).toContain('If you move this page inside it, they will see it too');
    expect(alert).toHaveBeenCalledTimes(5);
    // Crear adentro: avisa.
    const notices: string[] = [];
    const listen = (e: Event) => notices.push(String((e as CustomEvent).detail?.message ?? (e as CustomEvent).detail));
    window.addEventListener('shotdocs:notice', listen);
    noticeOutsideCreate(svc, built.ids.s027_010);
    noticeOutsideCreate(svc, built.ids.s025);
    window.removeEventListener('shotdocs:notice', listen);
    expect(notices).toEqual(['People outside the team see “027 | La ambulancia empieza a zigzaguear”: they will see this new page too.']);

    // Al sacarla, la marca se va (la ventana vuelve a preguntar enseguida).
    await owner.remote.setPageShares(built.projectId, 'vera@vendor.test', [], [built.ids.s027], 'view');
    await act(async () => outsideReadersStore(svc)!.invalidate(built.projectId));
    await until(() => !mark(built.ids.s027), 'la marca sacada');
    expect(mark(built.ids.s029) ?? host.querySelector(`.tree-row[data-page="${built.ids.s029}"]`)).toBeTruthy();
  });

  it('quien edita sin poder compartir el proyecto: solo sí o no de la página abierta, y los avisos al mover y crear', async () => {
    const { server, owner, built } = await workspace();
    await shareTwo(server, owner, built);
    server.addMember('beto', 'member', 'beto@test');
    server.grant('beto', { projectId: built.projectId }, 'edit');
    const beto = await makeDevice(server, crypto.randomUUID(), '0.021', {}, undefined, { id: 'beto', email: 'beto@test' });
    devices.push(beto);
    await beto.engine.syncNow();
    await beto.engine.syncNow();
    // La lista no se la da la base.
    await expect(beto.remote.pagesWithOutsideReaders(built.projectId)).rejects.toThrow('not_allowed');
    const host = mount(beto, <Shell />, pagePath(built.ids.s027_010));
    const marks = () => [...host.querySelectorAll<HTMLElement>('.tree-outside')];
    await until(() => marks().length === 1, 'el ojo de la página abierta');
    const eye = marks()[0];
    expect(eye.closest<HTMLElement>('.tree-row')!.dataset.page).toBe(built.ids.s027_010);
    expect(eye.dataset.outside).toBe('seen');
    // Sin quién ni cuántos.
    expect(eye.dataset.tip).toBe('People outside the team (a guest, or View or Comment) see this page');
    // En una página que no ven de afuera, nada.
    act(() => navigate(pagePath(built.ids.s025)));
    await until(() => marks().length === 0, 'sin ojo en S025');

    // Mover y crear: pregunta a la base por el destino. A una escena que ven de afuera desde afuera de ella, no mueve
    // (no sabe cuál la hace visible: ante la duda, no); adentro de la misma escena, pregunta; a lo que nadie ve, nada.
    const svc = services(beto);
    const confirm = vi.fn(() => false);
    const alert = vi.fn();
    vi.stubGlobal('confirm', confirm);
    vi.stubGlobal('alert', alert);
    const asked = vi.spyOn(beto.remote, 'pageHasOutsideReaders');
    expect(await confirmOutsideMove(svc, built.ids.notas, built.ids.s027)).toBe(false);
    expect((alert.mock.calls[0] as unknown[])[0]).toContain('To move a page into it, stop sharing it first.');
    expect(await confirmOutsideMove(svc, built.ids.s025_010, built.ids.s027_010, true)).toBe(false);
    expect((alert.mock.calls[1] as unknown[])[0]).toContain('To merge a card from outside it into one inside it');
    expect(confirm).not.toHaveBeenCalled();
    expect(await confirmOutsideMove(svc, built.ids.s027_020, built.ids.s027_010)).toBe(false);
    expect((confirm.mock.calls[0] as unknown[])[0]).toContain('see “PRUEBA_105_027_010 Ambulancia”');
    expect(await confirmOutsideMove(svc, built.ids.notas, built.ids.s025)).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledTimes(2);
    expect(asked.mock.calls.map((c) => c[0])).toContain(built.ids.s027);
    const notices: string[] = [];
    const listen = (e: Event) => notices.push(String((e as CustomEvent).detail?.message ?? (e as CustomEvent).detail));
    window.addEventListener('shotdocs:notice', listen);
    noticeOutsideCreate(svc, built.ids.s027_010);
    noticeOutsideCreate(svc, built.ids.s026);
    await until(() => notices.length === 1, 'el aviso al crear');
    await wait(60);
    window.removeEventListener('shotdocs:notice', listen);
    expect(notices).toEqual(['People outside the team see “PRUEBA_105_027_010 Ambulancia”: they will see this new page too.']);
  });
});
