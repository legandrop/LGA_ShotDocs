// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inviteLink, markInviteArrival, pendingInviteTarget } from '../invite';
import { prefs } from '../prefs';
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
import { DeleteBlocked, deleteWorkspaceDatabases } from './RemovedScreen';
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
afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const d of devices.splice(0)) {
    await d.engine.stop();
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
    expect(host.querySelector('h1')?.textContent).toBe('Join Studio?');
    expect(host.querySelector('.join-host')?.textContent).toContain('abcdefghijklmnopqrst.supabase.co');
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
    expect(host.textContent).toContain('Join a workspace?');
    expect(host.querySelector('.join-host strong')?.textContent).toBe('abcdefghijklmnopqrst.supabase.co');
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
      sizes: d.sizes,
      shutdown: async () => {
        await d.engine.stop();
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

  it('con fotos o videos sin subir, quitar espera también a que se baje cada original', async () => {
    loadWorkspaces(WANKA);
    updateWorkspaces((l) => addWorkspace(l, STUDIO));
    const dbName = configOf(STUDIO).storage.db('owner');
    const d = await device(dbName);
    const page = await d.tree.create(null, 'Rodaje');
    await d.media.add(page, new File([new Uint8Array(64)], 'IMG_0001.MOV', { type: 'video/quicktime' }));
    const saved: string[] = [];
    const { saveBlob } = await import('./unsyncedDownload');
    vi.mocked(saveBlob).mockImplementation((_blob, name) => void saved.push(name));
    await mount(
      <ServicesContext.Provider value={services(d, STUDIO, dbName)}>
        <RemoveWorkspaceDialog onClose={() => undefined} />
      </ServicesContext.Provider>,
    );
    const remove = button(document.body, 'Remove from this device');
    // Lo sin subir se cuenta aparte: con la máquina cargada puede tardar más que el montaje.
    await act(() => vi.waitFor(() => button(document.body, 'Download my unsynced changes')));
    await act(async () => {
      button(document.body, 'Download my unsynced changes').click();
      await new Promise((r) => setTimeout(r, 20));
    });
    // El archivo no trae los originales: todavía no.
    expect(document.body.textContent).toContain('does not include the original photos and videos');
    expect(remove.disabled).toBe(true);
    await act(async () => {
      button(document.body, 'IMG_0001.MOV').click();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(saved).toEqual(['IMG_0001.MOV']);
    expect(remove.disabled).toBe(false);
  });
});

describe('quitar sin la base de fotos', () => {
  it('si la base de fotos y videos no abrió, no la borra (podría tener originales sin subir)', async () => {
    loadWorkspaces(WANKA);
    updateWorkspaces((l) => addWorkspace(l, STUDIO));
    const dbName = configOf(STUDIO).storage.db(crypto.randomUUID());
    const d = await makeDevice(new FakeServer(), dbName);
    devices.push(d);
    const value: Services = {
      workspace: { config: configOf(STUDIO), client: { auth: { signOut: vi.fn(async () => ({ error: null })) } } as never },
      client: { auth: { signOut: vi.fn(async () => ({ error: null })) } } as never,
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
      mediaDb: null,
      comments: d.comments,
      commentsDb: d.commentsDb,
      sizes: d.sizes,
      shutdown: async () => {
        await d.engine.stop();
        d.db.close();
        d.mediaDb.close();
        d.commentsDb.close();
      },
    };
    await mount(
      <ServicesContext.Provider value={value}>
        <RemoveWorkspaceDialog onClose={() => undefined} />
      </ServicesContext.Provider>,
    );
    expect(document.body.textContent).toContain('could not be opened');
    vi.stubGlobal('confirm', () => true);
    await act(async () => {
      button(document.body, 'Remove from this device').click();
      await new Promise((r) => setTimeout(r, 50));
    });
    const names = (await indexedDB.databases()).map((db) => db.name);
    expect(names).not.toContain(dbName);
    expect(names).not.toContain(`${dbName}:comments`);
    expect(names).toContain(`${dbName}:media`);
  });

  it('deleteWorkspaceDatabases con keepMedia deja la base de fotos', async () => {
    const name = `shotdocs:ws_keepmedia0:${crypto.randomUUID()}`;
    for (const n of [name, `${name}:media`, `${name}:comments`]) {
      await new Promise<void>((resolve) => {
        const req = indexedDB.open(n, 1);
        req.onsuccess = () => {
          req.result.close();
          resolve();
        };
      });
    }
    await deleteWorkspaceDatabases(name, true);
    const names = (await indexedDB.databases()).map((db) => db.name).filter((n) => n?.startsWith(name));
    expect(names).toEqual([`${name}:media`]);
  });
});

describe('lo que cada workspace recuerda', () => {
  it('la página de un link queda en el workspace del link, nunca en otro', () => {
    const wanka = configOf(loadWorkspaces(WANKA).workspaces[0]).storage;
    const studio = configOf(STUDIO).storage;
    markInviteArrival('0b7e5a52-8d1d-4a0f-9d62-3f1f1a2b3c4d', studio.inviteTarget);
    expect(pendingInviteTarget(studio.inviteTarget)).toBe('0b7e5a52-8d1d-4a0f-9d62-3f1f1a2b3c4d');
    expect(pendingInviteTarget(wanka.inviteTarget)).toBeNull();
    expect(wanka.inviteTarget).toBe('shotdocs-invite-target');
  });

  it('otra pestaña con otro workspace no le cambia el usuario ni sube sus preferencias a esta cuenta', async () => {
    const pushed: string[] = [];
    // La cuenta se lee bien (todavía sin fila); subir falla sin red.
    const client = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        update: () => ({
          eq: (_col: string, id: string) => {
            pushed.push(id);
            return { select: async () => ({ data: null, error: { message: 'Failed to fetch' }, status: 0 }) };
          },
        }),
        insert: async () => ({ error: { message: 'Failed to fetch' }, status: 0 }),
      }),
    } as never;
    await prefs.attach(client, 'tab-a');
    prefs.set({ font: 'editorial' });
    expect(pushed).toEqual(['tab-a']);

    // La otra pestaña (otro workspace, otro usuario) escribe `shotdocs-prefs`.
    const other = JSON.stringify({ userId: 'tab-b', prefs: { theme: 'light', font: 'default', textSize: 'large', pageWidth: 'wide' }, dirty: true });
    localStorage.setItem('shotdocs-prefs', other);
    window.dispatchEvent(new StorageEvent('storage', { key: 'shotdocs-prefs', newValue: other }));
    expect(prefs.get().font).toBe('editorial');
    expect(prefs.get().textSize).toBe('normal');
    // Al volver la red solo sube lo de esta pestaña, con su usuario.
    window.dispatchEvent(new Event('online'));
    await new Promise((r) => setTimeout(r, 10));
    expect(pushed.every((id) => id === 'tab-a')).toBe(true);
    prefs.detach();

    // Si esta pestaña se recarga después de que la otra pisó la clave de siempre, vuelve a lo suyo.
    await prefs.attach(client, 'tab-b');
    await prefs.attach(client, 'tab-a');
    expect(prefs.get().font).toBe('editorial');
    expect(prefs.hasUnsynced()).toBe(true);
    prefs.detach();
  });

  it('las preferencias sin subir de un usuario no se pierden al entrar con otro, y vuelven sin red', async () => {
    // Un cliente sin red: toda llamada falla, como en el rodaje.
    const offline = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'offline' } }) }) }),
        update: () => ({ eq: () => ({ select: async () => ({ data: null, error: { message: 'Failed to fetch' }, status: 0 }) }) }),
        insert: async () => ({ error: { message: 'Failed to fetch' }, status: 0 }),
      }),
    } as never;
    await prefs.attach(offline, 'lega-wanka');
    prefs.set({ theme: 'dark' });
    expect(prefs.hasUnsynced()).toBe(true);
    await prefs.attach(offline, 'lega-studio');
    expect(prefs.get().theme).toBe('system');
    expect(prefs.hasUnsynced()).toBe(false);
    // La clave de siempre sigue teniendo al usuario actual.
    expect(JSON.parse(localStorage.getItem('shotdocs-prefs')!).userId).toBe('lega-studio');
    await prefs.attach(offline, 'lega-wanka');
    expect(prefs.get().theme).toBe('dark');
    expect(prefs.hasUnsynced()).toBe(true);
    prefs.detach();
  });
});

describe('borrar las bases de un workspace', () => {
  function open(name: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('x');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  it('primero la principal: si otra pestaña la tiene abierta no borra nada, y reintentar termina', async () => {
    const name = `shotdocs:ws_borrar0000:${crypto.randomUUID()}`;
    const main = await open(name);
    (await open(`${name}:media`)).close();
    (await open(`${name}:comments`)).close();
    await expect(deleteWorkspaceDatabases(name)).rejects.toBeInstanceOf(DeleteBlocked);
    let names = (await indexedDB.databases()).map((d) => d.name);
    expect(names).toContain(`${name}:media`);
    expect(names).toContain(`${name}:comments`);
    main.close();
    await deleteWorkspaceDatabases(name);
    names = (await indexedDB.databases()).map((d) => d.name);
    expect(names.filter((n) => n?.startsWith(name))).toEqual([]);
  });
});
