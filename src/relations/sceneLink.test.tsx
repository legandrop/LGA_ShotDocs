// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigate, pagePath } from '../router';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { settled } from '../test/settle';
import { shown } from '../test/shown';
import { projectFromParam, storeProject } from '../ui/project';
import { Shell } from '../ui/Workspace';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { buildProject, type Built } from './fixtures/proyectoSintetico';
import { sceneShareLink } from './sceneMentions';

// El link a una escena del Panorama (Docs/Doc_Link_Escena.md): `?project=` abre ese proyecto aunque el dispositivo tenga
// otro elegido, entiende el código del proyecto (como lo conocen PipeSync y Flow) y cualquier forma del número de escena,
// nunca muestra la escena de otro proyecto, y *Copy link* copia una dirección que vuelve a la misma escena.

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
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  document.body.innerHTML = '';
  history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

const STORAGE = legacyStorageNames(WANKA_LOCAL_KEY);

function services(device: Device): Services {
  return {
    workspace: { config: { url: 'https://x.supabase.co', publishableKey: 'k', name: 'W', localKey: WANKA_LOCAL_KEY, storage: STORAGE }, client: {} },
    client: { auth: { signOut: vi.fn() } },
    user: { id: device.remote.userId, email: 'a@test' },
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
    shutdown: async () => undefined,
  } as unknown as Services;
}

let n = 0;
const fakePhoto = async () => `0000${String(++n).padStart(4, '0')}-aaaa-4bbb-8ccc-dddddddddddd`;

function mount(d: Device, start: string): HTMLElement {
  history.replaceState(null, '', start);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <ServicesContext.Provider value={services(d)}>
        <Shell />
      </ServicesContext.Provider>,
    ),
  );
  return host;
}

/** La serie de prueba con el nombre «ERSO | Serie de prueba» y otro proyecto, «VLLF», elegido en el dispositivo. */
async function twoProjects(): Promise<{ d: Device; built: Built; other: string; otherPage: string }> {
  const d = await makeDevice(new FakeServer());
  devices.push(d);
  const built = await buildProject(d, fakePhoto, { days: true, name: 'ERSO | Serie de prueba' });
  const other = await d.tree.createProject('VLLF');
  const otherPage = await d.tree.create(null, 'Notas', other);
  storeProject(STORAGE, d.remote.userId, other);
  return { d, built, other, otherPage };
}

const storedProjectOf = (userId: string) => (JSON.parse(localStorage.getItem(STORAGE.project) ?? '{}') as Record<string, string>)[userId];

describe('projectFromParam', () => {
  const projects = [
    { id: '0f8fad5b-d9cb-469f-a165-70867728950e', name: 'ERSO | Serie' },
    { id: '1f8fad5b-d9cb-469f-a165-70867728950e', name: 'Villaflor' },
    { id: '2f8fad5b-d9cb-469f-a165-70867728950e', name: 'Árbol Negro' },
    { id: '3f8fad5b-d9cb-469f-a165-70867728950e', name: 'MOR' },
    { id: '4f8fad5b-d9cb-469f-a165-70867728950e', name: 'MOR 2' },
  ];

  it('por id, por nombre entero o por su primera palabra, sin mayúsculas ni tildes', () => {
    expect(projectFromParam(projects, '1F8FAD5B-D9CB-469F-A165-70867728950E')).toBe(projects[1].id);
    expect(projectFromParam(projects, 'erso')).toBe(projects[0].id);
    expect(projectFromParam(projects, 'ERSO | Serie')).toBe(projects[0].id);
    expect(projectFromParam(projects, '  villaflor ')).toBe(projects[1].id);
    expect(projectFromParam(projects, 'arbol negro')).toBe(projects[2].id);
  });

  it('el nombre entero gana a la primera palabra; dos con la misma palabra no se adivinan', () => {
    expect(projectFromParam(projects, 'MOR')).toBe(projects[3].id);
    expect(projectFromParam([projects[4], { id: '5f8fad5b-d9cb-469f-a165-70867728950e', name: 'MOR | B' }], 'MOR')).toBeNull();
    expect(projectFromParam([...projects, { id: '6f8fad5b-d9cb-469f-a165-70867728950e', name: 'Villaflor' }], 'Villaflor')).toBeNull();
  });

  it('lo que no está, vacío, o un id que no es de ningún proyecto: ninguno', () => {
    expect(projectFromParam(projects, 'VLLF')).toBeNull();
    expect(projectFromParam(projects, '   ')).toBeNull();
    expect(projectFromParam(projects, '9f8fad5b-d9cb-469f-a165-70867728950e')).toBeNull();
    expect(projectFromParam(projects, 'x'.repeat(201))).toBeNull();
  });
});

describe('el link a una escena', () => {
  it('abre la escena de ese proyecto aunque el dispositivo tenga otro elegido, y lo deja elegido', async () => {
    const { d, built } = await twoProjects();
    // La forma de PipeSync: el código del proyecto y el número en cualquier forma (`5027` = 105_027).
    const host = mount(d, '/map/scenes?project=ERSO&scene=5027');
    await shown(() => expect(host.querySelector('.mp-sh')?.textContent).toContain('5027La ambulancia'));
    expect(storedProjectOf(d.remote.userId)).toBe(built.projectId);
    // Al salir del Panorama, el inicio sigue en ese proyecto.
    act(() => navigate('/'));
    await act(() => settled(30));
    expect(storedProjectOf(d.remote.userId)).toBe(built.projectId);
  });

  it('la escena en cualquier forma abre la misma: interna, de la post, el nombre de un plano o de su inserto (v0.319)', async () => {
    const { d } = await twoProjects();
    const host = mount(d, '/map/scenes?project=ERSO&scene=104_008');
    await shown(() => expect(host.querySelector('.mp-sh')?.textContent).toContain('4008'));
    for (const q of ['105_027', '5027', 'ERSO_5027_010', 'ERSO_105_027_010', 'ERSO_5027A-INS_010', 'ERSO_105_027A-INS_010']) {
      // Entre una y otra, otra escena: que la vista cambie de verdad.
      act(() => navigate('/map/scenes?project=ERSO&scene=104_008'));
      await shown(() => expect(host.querySelector('.mp-sh')?.textContent).toContain('4008'));
      act(() => navigate(`/map/scenes?project=ERSO&scene=${q}`));
      await shown(() => expect(host.querySelector('.mp-sh')?.textContent).toContain('5027La ambulancia'));
    }
  });

  it('un proyecto que no está no muestra la escena de otro: «Opening…» hasta una vuelta con el servidor, después que no lo ve', async () => {
    const { d, other } = await twoProjects();
    const real = d.engine.getStatus;
    // Un dispositivo nuevo que todavía no habló con el servidor: el proyecto puede estar bajando.
    // Un objeto fijo: `useSyncExternalStore` pide la misma referencia mientras no cambie.
    const fresh = { ...real(), lastSyncAt: null, lastError: null };
    d.engine.getStatus = () => fresh;
    const host = mount(d, '/map/scenes?project=NOPE&scene=105_027');
    await shown(() => expect(host.querySelector('.mp-empty')?.textContent).toBe('Opening project “NOPE”…'));
    expect(host.querySelector('.mp-sh')).toBeNull();
    // Ya habló: lo dice.
    const synced = { ...real(), lastSyncAt: Date.now(), lastError: null };
    d.engine.getStatus = () => synced;
    act(() => navigate('/map/scenes?project=NOPE&scene=105_028'));
    await shown(() => expect(host.querySelector('.mp-empty')?.textContent).toBe('“NOPE” isn’t a project you can see here. Ask for access, or check you’re in its workspace.'));
    expect(host.querySelector('.mp-sh')).toBeNull();
    expect(storedProjectOf(d.remote.userId)).toBe(other);
  });

  it('dos proyectos que empiezan igual: no se adivina, se nombran los dos; el valor largo se recorta', async () => {
    const { d, other } = await twoProjects();
    await d.tree.createProject('ERSO (copia)');
    const host = mount(d, '/map/scenes?project=erso&scene=105_027');
    await shown(() => expect(host.querySelector('.mp-empty')?.textContent).toBe('“erso” matches more than one project: ERSO | Serie de prueba · ERSO (copia). Open the one you want from the project list.'));
    expect(host.querySelector('.mp-sh')).toBeNull();
    expect(storedProjectOf(d.remote.userId)).toBe(other);
    act(() => navigate(`/map/scenes?project=${encodeURIComponent('Your session expired, call this number now to keep your account')}&scene=1`));
    await shown(() => expect(host.querySelector('.mp-empty')?.textContent).toContain('“Your session expired, call this number…”'));
  });

  it('una escena que no está nombra el proyecto; en una página manda la página aunque la dirección diga otro proyecto', async () => {
    const { d, built, other, otherPage } = await twoProjects();
    const host = mount(d, '/map/scenes?project=ERSO&scene=105_999');
    await shown(() => expect(host.querySelector('.mp-scene .mp-empty')?.textContent).toBe('105_999 isn’t a scene of ERSO | Serie de prueba.'));
    // En una página manda la página, aunque la dirección diga otro proyecto.
    storeProject(STORAGE, d.remote.userId, other);
    act(() => navigate(`${pagePath(otherPage)}?project=ERSO`));
    await act(() => settled(30));
    expect(storedProjectOf(d.remote.userId)).toBe(other);
    expect(storedProjectOf(d.remote.userId)).not.toBe(built.projectId);
  });

  it('Copy link copia una dirección que vuelve a la misma escena del mismo proyecto', async () => {
    const { d, built } = await twoProjects();
    const writeText = vi.fn(async (_text: string) => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const host = mount(d, pagePath(built.ids.notas));
    await act(() => settled(30));
    act(() => navigate('/map/scenes?scene=105_027'));
    await shown(() => expect(host.querySelector('.mp-sh')?.textContent).toContain('5027La ambulancia'));
    const button = [...host.querySelectorAll<HTMLButtonElement>('.mp-sbar .mp-btn')].find((b) => b.textContent === 'Copy link');
    expect(button).toBeTruthy();
    await act(async () => button!.click());
    await shown(() => expect(writeText).toHaveBeenCalledOnce());
    const copied = writeText.mock.calls[0][0];
    expect(copied).toBe(sceneShareLink(location.origin, WANKA_LOCAL_KEY, built.projectId, '105_027'));
    const url = new URL(copied);
    expect(url.pathname).toBe('/map/scenes');
    // La escena con la forma de la post (como la nombran PipeSync y Flow), no el código interno.
    expect(Object.fromEntries(url.searchParams)).toEqual({ project: built.projectId, scene: '5027', w: WANKA_LOCAL_KEY });

    // Abierto con otro proyecto elegido, el link copiado vuelve a esa escena.
    storeProject(STORAGE, d.remote.userId, d.tree.projects().find((p) => p.id !== built.projectId)!.id);
    act(() => navigate(url.pathname + url.search));
    await shown(() => expect(host.querySelector('.mp-sh')?.textContent).toContain('5027La ambulancia'));
    expect(storedProjectOf(d.remote.userId)).toBe(built.projectId);
  });
});
