// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { settled } from '../test/settle';
import { t } from '../i18n';
import { LinkContext } from '../linkMode';
import { prefs } from '../prefs';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY, WorkspaceContext } from '../workspace';
import { writeWorkspaces, type DeviceWorkspace } from '../workspaces';
import { FileScreen } from './FileScreen';
import { PageView } from './PageView';
import { NoProjectsBoot, NoProjectsOpen } from './Workspace';

// Los restos de *Request access* (P.30, Docs/Doc_Links_PDF.md, sección 19), contra el servidor en memoria:
// - O1: `/p/<id>` no dice de qué workspace es; con más de uno en el dispositivo, la pantalla sin acceso de una página no
//   ofrece pedir (iría a la base del abierto) y dice que se cambie de workspace. La de un archivo (`/f/<clave>/<id>`) sí.
// - O2: quien no ve ningún proyecto y abre la dirección de una página o de un archivo ve la pantalla sin acceso con
//   *Request access*, tanto al arrancar (sin la sincronización abierta) como con la app abierta; sin membresía, en el
//   inicio o con un link público, «No projects yet» como siempre.
// - O9: el tope de pedidos por día llega del servidor en memoria (no de un doble) y la pantalla lo dice.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as never;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.scrollTo ??= function () {} as never;
});

const CLIENTA = '00000000-0000-4000-8000-0000000000a3';
const FILE = '00000000-0000-4000-8000-0000000000f1';
const OTHER_KEY = 'otrostudio';

const roots: Root[] = [];
const devices: Device[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.mentions.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  document.body.innerHTML = '';
  localStorage.clear();
  history.replaceState(null, '', '/');
  act(() => prefs.set({ language: 'en' }));
});

const CONFIG = {
  url: 'https://znlvpuddswymxpffgvbz.supabase.co',
  publishableKey: 'sb_publishable_test',
  name: 'Wanka',
  localKey: WANKA_LOCAL_KEY,
  storage: legacyStorageNames(WANKA_LOCAL_KEY),
};

/** Wanka (el de la compilación) y, si `two`, otro workspace más en el dispositivo. */
function deviceWorkspaces(two: boolean): void {
  const wanka: DeviceWorkspace = { id: WANKA_LOCAL_KEY, url: CONFIG.url, publishableKey: CONFIG.publishableKey, localKey: WANKA_LOCAL_KEY, name: 'Wanka', legacy: true };
  const other: DeviceWorkspace = { id: OTHER_KEY, url: 'https://abcdefghijklmnopqrst.supabase.co', publishableKey: 'sb_publishable_OtroEstudio_abc123XYZ', localKey: OTHER_KEY, name: 'Otro estudio' };
  writeWorkspaces({ active: WANKA_LOCAL_KEY, workspaces: two ? [wanka, other] : [wanka] });
}

/**
 * Un cliente de Supabase de mentira que va al servidor en memoria con la sesión de `d`: los pedidos, `media_file`, la
 * membresía y la versión de la base (`workspace_settings`).
 */
function clientTo(server: FakeServer, d: Device, userId: string, calls: string[] = []) {
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    calls.push(fn);
    try {
      if (fn === 'request_page_access') return { data: await d.remote.requestPageAccess(args.p_page as string), error: null, status: 200 };
      if (fn === 'request_access') return { data: await d.remote.requestAccess(args.p_file as string), error: null, status: 200 };
      if (fn === 'media_file') return { data: null, error: null, status: 200 };
      if (fn === 'trashed_projects') return { data: [], error: null, status: 200 };
      throw new Error(`rpc ${fn}`);
    } catch (err) {
      const e = err as { message: string; code?: string };
      return { data: null, error: { message: e.message, code: e.code }, status: 400 };
    }
  });
  const from = (table: string) => {
    const one = async () => {
      if (table === 'workspace_settings') {
        return { data: { generation: 1, min_app_version: null, schema_version: server.settings?.schemaVersion ?? 0 }, error: null, status: 200 };
      }
      if (table === 'members') {
        const role = server.role(userId);
        return { data: role ? { role, removed_at: null } : null, error: null, status: 200 };
      }
      return { data: null, error: null, status: 200 };
    };
    return { select: () => ({ eq: () => ({ maybeSingle: one }), maybeSingle: one }) };
  };
  return { auth: { signOut: vi.fn(), getSession: async () => ({ data: { session: null } }) }, rpc, from };
}

function services(server: FakeServer, d: Device, userId: string, calls?: string[]): Services {
  const client = clientTo(server, d, userId, calls) as never;
  return {
    workspace: { config: CONFIG, client },
    client,
    user: { id: userId, email: `${userId}@test` },
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
    mentions: d.mentions,
    sizes: d.sizes,
    offline: d.offline,
    shutdown: async () => undefined,
  };
}

// El rato pedido y, después, a que termine lo que quedó en marcha (src/test/settle.ts).
const wait = (ms = 60) => act(() => settled(ms));

async function mount(node: React.ReactNode, value?: Services, link: unknown = null): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const workspace = value ? value.workspace : { config: CONFIG, client: null };
  await act(async () =>
    root.render(
      <LinkContext.Provider value={link as never}>
        <WorkspaceContext.Provider value={workspace as never}>
          {value ? <ServicesContext.Provider value={value}>{node}</ServicesContext.Provider> : node}
        </WorkspaceContext.Provider>
      </LinkContext.Provider>,
    ),
  );
  await wait();
  return host;
}

/** `NoProjectsBoot` (el arranque no encontró proyectos): sin servicios, con el cliente de mentira. */
async function mountBoot(server: FakeServer, d: Device, userId: string, onRetry = vi.fn(), calls: string[] = [], link = false): Promise<HTMLElement> {
  const workspace = { config: CONFIG, client: clientTo(server, d, userId, calls) };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      <WorkspaceContext.Provider value={workspace as never}>
        <NoProjectsBoot user={{ id: userId, email: `${userId}@test` }} onRetry={onRetry} link={link} />
      </WorkspaceContext.Provider>,
    ),
  );
  await wait();
  return host;
}

function button(text: string, within: ParentNode = document): HTMLButtonElement {
  const b = [...within.querySelectorAll('button')].find((x) => x.textContent === text);
  if (!b) throw new Error(`falta el botón ${text}`);
  return b as HTMLButtonElement;
}

function hasButton(text: string, within: ParentNode = document): boolean {
  return [...within.querySelectorAll('button')].some((x) => x.textContent === text);
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => el.click());
  await wait();
}

/** Pide con *Request access* (el primer clic muestra el aviso, el segundo manda). */
async function ask(host: HTMLElement): Promise<void> {
  await click(button(t('file.request'), host));
  await click(button(t('file.request'), host));
}

/** El dueño con Escena 12 (que usa un archivo); una clienta invitada sin nada compartido. Base en `schema`. */
async function setup(schema = 24) {
  const server = new FakeServer();
  server.enableMentions();
  server.settings = { ...server.settings!, schemaVersion: schema };
  server.addMember(CLIENTA, 'guest', 'clienta@cliente.com');
  const owner = await makeDevice(server);
  devices.push(owner);
  const scene = await owner.tree.create(null, 'Escena 12');
  await owner.engine.syncNow();
  server.mediaFiles.set(FILE, {
    id: FILE,
    name: 'plano.pdf',
    mime: 'application/pdf',
    width: null,
    height: null,
    duration: null,
    thumb_at: null,
    drive_id: 'd1',
    project_id: server.pages.get(scene)!.workspace_id,
    size: 10,
  });
  server.pageFiles.add(`${scene}:${FILE}`);
  const guest = await makeDevice(server, undefined, undefined, undefined, undefined, { id: CLIENTA });
  devices.push(guest);
  await guest.engine.syncNow();
  return { server, owner, guest, scene };
}

describe('O1: la dirección de una página no dice de qué workspace es', () => {
  it('con dos workspaces en el dispositivo: sin Request access y con el aviso de cambiar de workspace', async () => {
    const { server, guest, scene } = await setup();
    deviceWorkspaces(true);
    const host = await mount(<PageView id={scene} />, services(server, guest, CLIENTA));
    expect(host.textContent).toContain(t('page.notFound'));
    expect(host.textContent).toContain(t('page.otherWorkspace'));
    expect(hasButton(t('file.request'), host)).toBe(false);
    expect(server.accessRequests).toEqual([]);
  });

  it('con uno solo, Request access como siempre (y sin el aviso)', async () => {
    const { server, guest, scene } = await setup();
    deviceWorkspaces(false);
    const host = await mount(<PageView id={scene} />, services(server, guest, CLIENTA));
    expect(host.textContent).not.toContain(t('page.otherWorkspace'));
    await ask(host);
    expect(server.accessRequests).toEqual([expect.objectContaining({ target_page_id: scene, state: 'pending' })]);
  });

  it('la dirección de un archivo sí dice el workspace: con dos, Request access sigue', async () => {
    const { server, guest } = await setup();
    deviceWorkspaces(true);
    const host = await mount(<FileScreen localKey={WANKA_LOCAL_KEY} id={FILE} />, services(server, guest, CLIENTA));
    expect(host.textContent).toContain(t('file.noAccess.title'));
    await ask(host);
    expect(server.accessRequests).toEqual([expect.objectContaining({ file_id: FILE, state: 'pending' })]);
  });
});

describe('O2: sin ningún proyecto, la dirección de una página o de un archivo', () => {
  it('al arrancar, una página: la pantalla sin acceso con Request access (no «No projects yet»); Go to Shot Docs lleva al inicio', async () => {
    const { server, guest, scene } = await setup();
    history.replaceState(null, '', `/p/${scene}`);
    const host = await mountBoot(server, guest, CLIENTA);
    expect(host.textContent).toContain(t('page.notFound'));
    expect(host.textContent).not.toContain(t('noProjects.title'));
    expect(host.textContent).not.toContain('Escena 12');
    await ask(host);
    expect(host.textContent).toContain(t('page.requestSent'));
    expect(server.accessRequests).toEqual([expect.objectContaining({ user_id: CLIENTA, target_page_id: scene, state: 'pending' })]);
    await click(button(t('file.home'), host));
    expect(location.pathname).toBe('/');
    expect(host.textContent).toContain(t('noProjects.title'));
  });

  it('al arrancar, un archivo: lo mismo con request_access', async () => {
    const { server, guest } = await setup();
    history.replaceState(null, '', `/f/${WANKA_LOCAL_KEY}/${FILE}`);
    const host = await mountBoot(server, guest, CLIENTA);
    expect(host.textContent).toContain(t('file.noAccess.title'));
    await ask(host);
    expect(server.accessRequests).toEqual([expect.objectContaining({ file_id: FILE, state: 'pending' })]);
  });

  it('al arrancar, si la base dice que ya lo ve, vuelve a buscar los proyectos', async () => {
    const { server, guest, scene } = await setup();
    server.grant(CLIENTA, { pageId: scene }, 'view');
    history.replaceState(null, '', `/p/${scene}`);
    const onRetry = vi.fn();
    const host = await mountBoot(server, guest, CLIENTA, onRetry);
    await ask(host);
    expect(onRetry).toHaveBeenCalled();
    expect(server.accessRequests).toEqual([]);
  });

  it('al arrancar, sin el botón: la página con la base en la 23, o con dos workspaces (con el aviso)', async () => {
    const old = await setup(23);
    history.replaceState(null, '', `/p/${old.scene}`);
    const host = await mountBoot(old.server, old.guest, CLIENTA);
    expect(host.textContent).toContain(t('page.notFound'));
    expect(hasButton(t('file.request'), host)).toBe(false);
    // Un archivo con la base en la 23 sí (desde la 22).
    history.replaceState(null, '', `/f/${WANKA_LOCAL_KEY}/${FILE}`);
    const file = await mountBoot(old.server, old.guest, CLIENTA);
    expect(hasButton(t('file.request'), file)).toBe(true);

    const { server, guest, scene } = await setup();
    deviceWorkspaces(true);
    history.replaceState(null, '', `/p/${scene}`);
    const two = await mountBoot(server, guest, CLIENTA);
    expect(two.textContent).toContain(t('page.otherWorkspace'));
    expect(hasButton(t('file.request'), two)).toBe(false);
  });

  it('al arrancar, «No projects yet» como siempre: en el inicio, sin membresía o con un link público', async () => {
    const { server, guest, scene } = await setup();
    const home = await mountBoot(server, guest, CLIENTA);
    expect(home.textContent).toContain(t('noProjects.title'));
    history.replaceState(null, '', `/p/${scene}`);
    const linked = await mountBoot(server, guest, CLIENTA, vi.fn(), [], true);
    expect(linked.textContent).toContain(t('noProjects.title'));
    const stranger = '00000000-0000-4000-8000-0000000000b9';
    const outside = await mountBoot(server, guest, stranger);
    expect(outside.textContent).toContain(t('noProjects.title'));
    expect(hasButton(t('file.request'), outside)).toBe(false);
  });

  it('con la app abierta y sin proyectos (se los sacaron): la misma pantalla, y el pedido sincroniza si ya lo ve', async () => {
    const { server, guest, scene } = await setup();
    expect(guest.tree.hasNoProjects()).toBe(true);
    history.replaceState(null, '', `/p/${scene}`);
    const value = services(server, guest, CLIENTA);
    const host = await mount(<NoProjectsOpen />, value);
    expect(host.textContent).toContain(t('page.notFound'));
    expect(host.textContent).not.toContain(t('noProjects.title'));
    await ask(host);
    expect(server.accessRequests).toEqual([expect.objectContaining({ target_page_id: scene, state: 'pending' })]);
    // En el inicio, «No projects yet» de siempre.
    await click(button(t('file.home'), host));
    expect(host.textContent).toContain(t('noProjects.title'));
  });

  it('con la app abierta, en castellano', async () => {
    const { server, guest } = await setup();
    act(() => prefs.set({ language: 'es' }));
    history.replaceState(null, '', `/f/${WANKA_LOCAL_KEY}/${FILE}`);
    const host = await mount(<NoProjectsOpen />, services(server, guest, CLIENTA));
    expect(host.textContent).toContain(t('file.noAccess.title'));
    expect(hasButton('Pedir acceso', host)).toBe(true);
    expect(hasButton('Ir a Shot Docs', host)).toBe(true);
  });
});

describe('O9: el tope de pedidos llega del servidor en memoria', () => {
  it('después de 20 filas nuevas en el día, la pantalla dice que pidió demasiado', async () => {
    const { server, guest, scene } = await setup();
    for (let i = 0; i < 20; i++) await guest.remote.requestAccess(crypto.randomUUID());
    const host = await mount(<PageView id={scene} />, services(server, guest, CLIENTA));
    await ask(host);
    expect(host.textContent).toContain(t('file.requestLimited'));
    expect(server.accessRequests.filter((r) => r.target_page_id === scene)).toEqual([]);
  });
});
