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
import { IS_MAC } from './shortcuts';

// El color de los proyectos y Ctrl/⌘+clic en el selector (Docs/Doc_Navegacion.md, «Color del proyecto»), contra el
// servidor en memoria: el botón de la paleta solo a quien renombra y con la base en la versión 27, la vista previa en
// vivo en los puntos del proyecto, OK que guarda y Cancel que deja todo como estaba, y abrir otro proyecto en un tab
// nuevo de fondo sin cerrar el selector.

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

async function workspace(schema: number): Promise<{ server: FakeServer; owner: Device; o: string }> {
  const server = new FakeServer();
  server.enableTeam();
  if (schema >= 27) server.enableProjectColor();
  else server.enableProjectPurge();
  const owner = await makeDevice(server);
  devices.push(owner);
  await owner.engine.syncNow();
  const o = await owner.tree.createProject('Bosque Negro');
  await owner.engine.syncNow();
  return { server, owner, o };
}

const label = (name: string) => document.querySelector<HTMLElement>(`[aria-label="${name}"]`);
// Solo los botones del picker: un aviso de novedades de la versión puede tener su propio «OK».
const byText = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('.color-picker button')].find((b) => b.textContent?.trim() === text);
const rowDot = (id: string) => document.querySelector<HTMLElement>(`#project-option-${id} .project-dot`)!;
/** El color de un punto, como lo da el navegador (`rgb(…)`) pasado a hex. */
const dotHex = (el: HTMLElement) => {
  const m = el.style.background.match(/\d+/g)!.map(Number);
  return `#${m.slice(0, 3).map((n) => n.toString(16).padStart(2, '0')).join('')}`;
};

describe('selector: el color del proyecto', () => {
  it('la paleta abre el picker; la vista previa se ve en el punto y OK la guarda', async () => {
    const { server, owner, o } = await workspace(27);
    await openSwitcher(owner, server.ownerId);
    const before = dotHex(rowDot(o));
    await act(async () => label('Color of “Bosque Negro”')!.click());
    await act(async () => label('#774dcb')!.click());
    await act(async () => byText('OK')!.click());
    await settle();
    expect(owner.tree.project(o)?.color).toBe('#774dcb');
    expect(dotHex(rowDot(o))).toBe('#774dcb');
    expect(before).not.toBe('#774dcb');
    await owner.engine.syncNow();
    expect(server.projects.get(o)?.color).toBe('#774dcb');
    // Recién elegido, queda primero en los recientes.
    expect(JSON.parse(localStorage.getItem('shotdocs.colorRecents')!)[0]).toBe('#774dcb');
  });

  it('Cancel deja el color como estaba y no encola nada', async () => {
    const { server, owner, o } = await workspace(27);
    await owner.tree.colorProject(server.workspaceId, '#2e5a8e');
    await owner.engine.syncNow();
    const host = await openSwitcher(owner, server.ownerId);
    const top = host.querySelector<HTMLElement>('.project-button .project-dot')!;
    expect(dotHex(top)).toBe('#2e5a8e');
    await act(async () => label(`Color of “${owner.tree.project(server.workspaceId)!.name}”`)!.click());
    await act(async () => label('#8e2e5a')!.click());
    // La vista previa ya se ve en el punto de arriba (el proyecto abierto).
    expect(dotHex(top)).toBe('#8e2e5a');
    await act(async () => byText('Cancel')!.click());
    await settle();
    expect(dotHex(top)).toBe('#2e5a8e');
    expect(owner.tree.pendingOps()).toEqual([]);
    expect(owner.tree.project(o)?.color ?? null).toBeNull();
  });

  it('quien no renombra el proyecto no ve la paleta; tampoco con una base anterior a la 27', async () => {
    const old = await workspace(26);
    await openSwitcher(old.owner, old.server.ownerId);
    expect(label('Color of “Bosque Negro”')).toBeNull();
    // El punto igual está, con el color de fábrica.
    expect(rowDot(old.o)).not.toBeNull();
  });
});

describe('selector: Ctrl/⌘+clic en otro proyecto', () => {
  it('lo abre en un tab nuevo de fondo y el selector sigue abierto; el clic común lo abre acá', async () => {
    const { server, owner, o } = await workspace(27);
    await openSwitcher(owner, server.ownerId);
    const row = document.querySelector<HTMLButtonElement>(`#project-option-${o}`)!;
    await act(async () =>
      void row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: IS_MAC, ctrlKey: !IS_MAC })),
    );
    expect(newTab).toHaveBeenCalledWith('/', { background: true, project: o });
    expect(document.querySelector('.project-menu')).not.toBeNull();
    // La rueda también.
    await act(async () => void row.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 })));
    expect(newTab).toHaveBeenCalledTimes(2);
    await act(async () => row.click());
    await settle();
    expect(newTab).toHaveBeenCalledTimes(2);
    expect(document.querySelector('.project-menu')).toBeNull();
  });
});
