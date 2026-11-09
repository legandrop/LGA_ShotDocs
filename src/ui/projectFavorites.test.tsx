// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefs } from '../prefs';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { settled } from '../test/settle';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { ProjectSwitcher } from './ProjectSwitcher';

// Los proyectos favoritos en el selector (Docs/Doc_Navegacion.md, «Proyectos favoritos»): la estrella marca y
// desmarca, los favoritos van primero (también con una búsqueda) y suben a la base, lo que la v0.327 guardó en el
// dispositivo pasa a la base, y las entradas de abajo del selector ya no terminan en «…».

const newTab = vi.fn(async (_path?: string, _options?: { background?: boolean; project?: string }) => undefined);
vi.mock('./tabs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tabs')>()),
  tabsOn: () => true,
  newTab: (path?: string, options?: { background?: boolean; project?: string }) => newTab(path, options),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const devices: Device[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
  }
  document.body.innerHTML = '';
  newTab.mockClear();
  act(() => prefs.set({ language: 'en' }));
  localStorage.clear();
});

function services(d: Device, userId: string): Services {
  const config = {
    url: 'https://znlvpuddswymxpffgvbz.supabase.co',
    publishableKey: 'sb_publishable_test',
    name: 'Wanka',
    localKey: WANKA_LOCAL_KEY,
    storage: legacyStorageNames(WANKA_LOCAL_KEY),
  };
  const client = { auth: { getSession: async () => ({ data: { session: null } }) } } as never;
  return {
    workspace: { config, client },
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
    sizes: d.sizes,
    offline: d.offline,
    shutdown: async () => undefined,
  };
}

const settle = () => act(() => settled(30));

async function openSwitcher(d: Device, userId: string): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<ServicesContext.Provider value={services(d, userId)}>{<ProjectSwitcher />}</ServicesContext.Provider>));
  await settle();
  await act(async () => host.querySelector<HTMLButtonElement>('.project-button')!.click());
  await settle();
  return host;
}

async function workspace(schema: number): Promise<{ server: FakeServer; owner: Device; o: string; z: string }> {
  const server = new FakeServer();
  server.enableTeam();
  if (schema >= 30) server.enableProjectFavorites();
  else if (schema >= 27) server.enableProjectColor();
  else server.enableProjectPurge();
  const owner = await makeDevice(server);
  devices.push(owner);
  await owner.engine.syncNow();
  const o = await owner.tree.createProject('Bosque Negro');
  const z = await owner.tree.createProject('Zeta');
  await owner.engine.syncNow();
  return { server, owner, o, z };
}

const label = (name: string) => document.querySelector<HTMLElement>(`[aria-label="${name}"]`);
const order = () => [...document.querySelectorAll<HTMLElement>('.project-line .project-title strong')].map((s) => s.textContent);

describe('favoritos: lo que la v0.327 guardó en el dispositivo', () => {
  it('pasa una vez a la base y se borra de ahí (lo de otro usuario queda)', async () => {
    const { server, owner, z } = await workspace(30);
    localStorage.setItem('shotdocs-project-favorites', JSON.stringify({ [server.ownerId]: [z, 'no-existe'], otro: [z] }));
    await openSwitcher(owner, server.ownerId);
    expect(order()[0]).toBe('Zeta');
    expect(owner.tree.project(z)?.favorite).toBe(true);
    expect(JSON.parse(localStorage.getItem('shotdocs-project-favorites')!)).toEqual({ otro: [z] });
    await act(async () => owner.engine.syncNow());
    expect(server.favorites.has(`${server.ownerId}|${z}`)).toBe(true);
  });
});

describe('selector: la estrella de favorito', () => {
  it('marcar un proyecto lo sube al principio; desmarcarlo lo devuelve a su lugar', async () => {
    const { server, owner, z } = await workspace(30);
    await openSwitcher(owner, server.ownerId);
    const before = order();
    expect(before.indexOf('Zeta')).toBeGreaterThan(0);
    await act(async () => label('Add “Zeta” to favorites')!.click());
    await settle();
    expect(order()[0]).toBe('Zeta');
    // El resaltado sigue al renglón que se movió.
    expect(document.querySelector('.project-line.active .project-title strong')!.textContent).toBe('Zeta');
    expect(owner.tree.project(z)?.favorite).toBe(true);
    await act(async () => owner.engine.syncNow());
    expect(server.favorites.has(`${server.ownerId}|${z}`)).toBe(true);
    const star = label('Remove “Zeta” from favorites')!;
    expect(star.getAttribute('aria-pressed')).toBe('true');
    expect(star.closest('.project-row')!.classList.contains('favorite')).toBe(true);
    // Con una búsqueda, también primero.
    const input = document.querySelector<HTMLInputElement>('.project-search input')!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(input, 'e');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(order()[0]).toBe('Zeta');
    await act(async () => label('Remove “Zeta” from favorites')!.click());
    await settle();
    expect(owner.tree.project(z)?.favorite).toBe(false);
  });

  it('las entradas de abajo no terminan en «…»', async () => {
    const { server, owner } = await workspace(27);
    await openSwitcher(owner, server.ownerId);
    // Lo de abajo de la lista (v0.329): el pie, los archivados y los workspaces.
    const texts = [...document.querySelectorAll<HTMLButtonElement>('.project-menu .project-foot button, .project-menu .project-scroll > button')].map((b) => b.textContent ?? '');
    expect(texts).toContain('Trash');
    expect(texts.filter((t) => t.endsWith('…'))).toEqual([]);
  });
});
