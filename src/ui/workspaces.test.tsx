// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inviteLink } from '../invite';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { WANKA_LOCAL_KEY, WorkspaceContext } from '../workspace';
import {
  addWorkspace,
  configOf,
  loadWorkspaces,
  readWorkspaces,
  updateWorkspaces,
  type DeviceWorkspace,
} from '../workspaces';
import { GUIDE_URL, JoinConfirm, LoginWorkspaceBar, Welcome } from './Welcome';
import { RemoveWorkspaceDialog, WorkspaceSection } from './WorkspaceMenu';

vi.mock('./unsyncedDownload', () => ({ downloadUnsynced: vi.fn(async () => undefined), saveBlob: vi.fn() }));

// Las pantallas de varios workspaces (paso 12), montadas en jsdom: la bienvenida, unirse con un link, crear
// con la guía, el selector y quitar un workspace del dispositivo.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WANKA = { url: 'https://znlvpuddswymxpffgvbz.supabase.co', publishableKey: 'sb_publishable_wankaKey123' };
const STUDIO: DeviceWorkspace = {
  id: 'ws_studio1234567890abc',
  url: 'https://abcdefghijklmnopqrst.supabase.co',
  publishableKey: 'sb_publishable_studioKey456',
  localKey: 'ws_studio1234567890abc',
  name: 'Studio',
};

const roots: Root[] = [];
const devices: Device[] = [];
beforeEach(() => localStorage.clear());
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

async function mount(node: ReactNode): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  await act(async () => new Promise((r) => setTimeout(r, 20)));
  return host;
}

function click(el: Element | null | undefined) {
  if (!el) throw new Error('no element');
  act(() => (el as HTMLElement).click());
}

function button(host: ParentNode, text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
  if (!found) throw new Error(`no button "${text}"`);
  return found;
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit(host: HTMLElement) {
  await act(async () => {
    (host.querySelector('form') as HTMLFormElement).requestSubmit();
    await new Promise((r) => setTimeout(r, 20));
  });
}

describe('bienvenida', () => {
  it('ofrece unirse o crear, y unirse con un link pregunta "Join <nombre> at <host>?"', async () => {
    const onAdded = vi.fn();
    const host = await mount(<Welcome onAdded={onAdded} />);
    expect(host.textContent).toContain('Join a workspace');
    expect(host.textContent).toContain('Create my workspace');

    click(button(host, 'Join a workspace'));
    const page = '0b7e5a52-8d1d-4a0f-9d62-3f1f1a2b3c4d';
    const link = inviteLink('https://shotdocs.lega.com.ar', { u: STUDIO.url, k: STUDIO.publishableKey, l: STUDIO.localKey, p: page, n: 'Studio' });
    type(host.querySelector('#invite-link') as HTMLInputElement, 'no es un link');
    await submit(host);
    expect(host.textContent).toContain('not a valid invitation link');

    type(host.querySelector('#invite-link') as HTMLInputElement, link);
    await submit(host);
    expect(host.textContent).toContain('Join “Studio” at abcdefghijklmnopqrst.supabase.co?');
    expect(onAdded).not.toHaveBeenCalled();
    click(button(host, 'Join'));
    expect(onAdded).toHaveBeenCalledWith(STUDIO, { target: page });
  });

  it('crear enlaza la guía y, si la base no deja leer sus ajustes sin sesión, lo agrega pendiente', async () => {
    const onAdded = vi.fn();
    const host = await mount(<Welcome onAdded={onAdded} />);
    click(button(host, 'Create my workspace'));
    expect((host.querySelector('a.welcome-guide') as HTMLAnchorElement).href).toBe(GUIDE_URL);

    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ code: '42501', message: 'permission denied' }), { status: 401 }));
    vi.stubGlobal('fetch', fetchFn);
    type(host.querySelector('#ws-url') as HTMLInputElement, `${STUDIO.url}/`);
    type(host.querySelector('#ws-key') as HTMLInputElement, STUDIO.publishableKey);
    await submit(host);
    expect(onAdded).toHaveBeenCalledTimes(1);
    const entry = onAdded.mock.calls[0][0] as DeviceWorkspace;
    expect(entry).toMatchObject({ url: STUDIO.url, publishableKey: STUDIO.publishableKey, pending: true, localKey: '' });
    expect(configOf(entry).storage.auth).toMatch(/^shotdocs-auth:pending\./);
  });

  it('crear avisa que falta correr el comando si la base no tiene clave local', async () => {
    const onAdded = vi.fn();
    const host = await mount(<Welcome onAdded={onAdded} />);
    click(button(host, 'Create my workspace'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ name: 'Workspace', local_key: null, schema_version: 5 }]), { status: 200 })));
    type(host.querySelector('#ws-url') as HTMLInputElement, STUDIO.url);
    type(host.querySelector('#ws-key') as HTMLInputElement, STUDIO.publishableKey);
    await submit(host);
    expect(host.textContent).toContain('run the setup command');
    expect(onAdded).not.toHaveBeenCalled();

    // Una clave secreta no se manda a ningún lado.
    type(host.querySelector('#ws-key') as HTMLInputElement, 'sb_secret_abcdefghijkl');
    const calls = (fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    await submit(host);
    expect(host.textContent).toContain('That is a secret key');
    expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(calls);
  });

  it('el link de otro workspace muestra el host antes de unirse', async () => {
    const onJoin = vi.fn();
    const host = await mount(<JoinConfirm entry={{ ...STUDIO, name: '' }} onJoin={onJoin} onCancel={() => undefined} />);
    expect(host.textContent).toContain('Join a workspace at abcdefghijklmnopqrst.supabase.co?');
    click(button(host, 'Join'));
    expect(onJoin).toHaveBeenCalledTimes(1);
  });
});

describe('en el login', () => {
  function withWorkspace(entry: DeviceWorkspace, node: ReactNode) {
    const config = configOf(entry);
    return <WorkspaceContext.Provider value={{ config, client: {} as never }}>{node}</WorkspaceContext.Provider>;
  }

  it('con Wanka sola no muestra nada; con varios, en cuál se entra y cómo cambiar', async () => {
    const list = loadWorkspaces(WANKA);
    const wanka = list.workspaces[0];
    const alone = await mount(withWorkspace(wanka, <LoginWorkspaceBar />));
    expect(alone.textContent).toBe('');

    updateWorkspaces((l) => addWorkspace(l, STUDIO));
    const host = await mount(withWorkspace(STUDIO, <LoginWorkspaceBar />));
    expect(host.textContent).toContain('Studio');
    click(button(host, 'Change'));
    expect(document.body.textContent).toContain('Workspaces');
    expect(document.body.textContent).toContain('znlvpuddswymxpffgvbz.supabase.co');
  });
});

describe('en la app abierta', () => {
  function services(d: Device, entry: DeviceWorkspace, dbName: string, signOut = vi.fn(async () => ({ error: null }))): Services {
    const config = configOf(entry);
    const client = { auth: { signOut } } as never;
    return {
      workspace: { config, client },
      client,
      user: { id: 'owner', email: 'owner@test' },
      db: d.db,
      tree: d.tree,
      docs: d.docs,
      files: d.files,
      media: d.media,
      engine: d.engine,
      access: d.access,
      remote: d.remote as unknown as SupabaseRemote,
      dbName,
      mediaDb: d.mediaDb,
      comments: d.comments,
      commentsDb: d.commentsDb,
      shutdown: async () => {
        d.engine.stop();
        d.db.close();
        d.mediaDb.close();
        d.commentsDb.close();
      },
    };
  }

  async function device(dbName: string) {
    const d = await makeDevice(new FakeServer(), dbName);
    devices.push(d);
    return d;
  }

  it('con un solo workspace, el selector suma una sola línea discreta y no ofrece quitar a Wanka', async () => {
    const list = loadWorkspaces(WANKA);
    const d = await device(crypto.randomUUID());
    const host = await mount(
      <ServicesContext.Provider value={services(d, list.workspaces[0], 'x')}>
        <WorkspaceSection onClose={() => undefined} onDialog={() => undefined} onRemove={() => undefined} />
      </ServicesContext.Provider>,
    );
    expect(host.querySelectorAll('button')).toHaveLength(1);
    expect(host.textContent).toContain('Join or create a workspace…');
    expect(host.textContent).not.toContain('Remove');
  });

  it('con varios, la lista para cambiar, unirse, crear y quitar el abierto (nunca Wanka)', async () => {
    loadWorkspaces(WANKA);
    updateWorkspaces((l) => addWorkspace(l, STUDIO));
    const d = await device(crypto.randomUUID());
    const onDialog = vi.fn();
    const host = await mount(
      <ServicesContext.Provider value={services(d, STUDIO, 'x')}>
        <WorkspaceSection onClose={() => undefined} onDialog={onDialog} onRemove={() => undefined} />
      </ServicesContext.Provider>,
    );
    expect(host.textContent).toContain('Workspaces');
    expect(host.textContent).toContain('Studio');
    expect(host.textContent).toContain('znlvpuddswymxpffgvbz.supabase.co');
    expect(host.textContent).toContain('Remove “Studio” from this device…');
    click(button(host, 'Join a workspace…'));
    expect(onDialog).toHaveBeenCalledWith('join');

    // Abierto en Wanka: no se ofrece quitarla.
    const wanka = readWorkspaces().workspaces.find((w) => w.legacy)!;
    const other = await mount(
      <ServicesContext.Provider value={services(d, wanka, 'x')}>
        <WorkspaceSection onClose={() => undefined} onDialog={() => undefined} onRemove={() => undefined} />
      </ServicesContext.Provider>,
    );
    expect(other.textContent).not.toContain('Remove');
  });

  it('quitar pide bajar lo pendiente primero, y después borra la base, la sesión y la entrada', async () => {
    loadWorkspaces(WANKA);
    updateWorkspaces((l) => addWorkspace(l, STUDIO));
    const names = configOf(STUDIO).storage;
    localStorage.setItem(names.auth, 'sesion-studio');
    localStorage.setItem('shotdocs-auth', 'sesion-wanka');
    const dbName = names.db('owner');
    const d = await device(dbName);
    await d.tree.create(null, 'Sin subir');
    const signOut = vi.fn(async () => ({ error: null }));
    const host = await mount(
      <ServicesContext.Provider value={services(d, STUDIO, dbName, signOut)}>
        <RemoveWorkspaceDialog onClose={() => undefined} />
      </ServicesContext.Provider>,
    );
    expect(document.body.textContent).toContain('never uploaded');
    const remove = button(document.body, 'Remove from this device');
    expect(remove.disabled).toBe(true);

    await act(async () => {
      button(document.body, 'Download my unsynced changes').click();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(remove.disabled).toBe(false);
    vi.stubGlobal('confirm', () => true);
    await act(async () => {
      remove.click();
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(readWorkspaces().workspaces.map((w) => w.id)).toEqual([WANKA_LOCAL_KEY]);
    expect(readWorkspaces().active).toBe(WANKA_LOCAL_KEY);
    expect(localStorage.getItem(names.auth)).toBeNull();
    expect(localStorage.getItem('shotdocs-auth')).toBe('sesion-wanka');
    const left = await indexedDB.databases();
    expect(left.some((db) => db.name === dbName)).toBe(false);
    expect(host).toBeTruthy();
  });
});
