// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefs } from '../prefs';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import type { PageRow, TrashedFileRow, TrashedProjectRow } from '../sync/types';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { openProjectTrash, ProjectSwitcher } from './ProjectSwitcher';
import { Sidebar } from './Sidebar';
import { trashItems } from './TrashView';

// Una sola papelera (pedido de Lega, 2026-10-03): adentro del selector de proyectos, con los proyectos, las páginas y
// los archivos borrados juntos, del más nuevo al más viejo; el filtro All / Projects / Pages / Files; el proyecto
// abierto o todos; cada tipo hace lo de siempre, y cada persona ve lo que la base le deja ver.

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
  vi.unstubAllGlobals();
  act(() => prefs.set({ language: 'en' }));
  localStorage.clear();
  history.replaceState(null, '', '/');
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

const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mount(value: Services, node = <ProjectSwitcher />): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<ServicesContext.Provider value={value}>{node}</ServicesContext.Provider>));
  await settle();
  return host;
}

const byText = (text: string, scope: ParentNode = document) =>
  [...scope.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text);
const panel = () => document.querySelector<HTMLElement>('.trash-panel');
/** Lo que muestra la lista, en orden: "tipo:nombre". */
const shown = () =>
  [...document.querySelectorAll<HTMLElement>('.trash-panel .trash-item')].map((li) => {
    const kind = li.dataset.kind!;
    const name = li.querySelector('.title, strong')?.textContent?.trim();
    return `${kind}:${name}`;
  });
const kindLine = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('.trash-panel .trash-item')]
    .find((li) => li.querySelector('.title, strong')?.textContent?.trim() === name)
    ?.querySelector('.trash-kind')?.textContent?.trim();

/** Un archivo en la papelera de archivos de un proyecto, puesto como lo dejaría la base. */
function fileInTrash(server: FakeServer, id: string, projectId: string, at: string): void {
  server.mediaFiles.set(id, {
    id, name: `${id}.jpg`, mime: 'image/jpeg', width: null, height: null, duration: null, thumb_at: null,
    drive_id: `d-${id}`, size: 2048, trashed_at: at, purged_at: null, drive_trashed_at: null, project_id: projectId,
  });
}

/**
 * El workspace del dueño en la versión 9, con la papelera de archivos: "My project" (el abierto, P), "Bosque Negro"
 * (O) y "Old spot" (Q). En orden, del más viejo al más nuevo: una página de P a la papelera, un archivo de P, una
 * página de Q, y O borrado.
 */
async function workspace() {
  const server = new FakeServer();
  server.enableTrash();
  server.enableProjectStates();
  const owner = await makeDevice(server);
  devices.push(owner);
  await owner.engine.syncNow();
  const p = server.workspaceId;
  const o = await owner.tree.createProject('Bosque Negro');
  const q = await owner.tree.createProject('Old spot');
  const keep = await owner.tree.create(null, 'Guion', p);
  const old = await owner.tree.create(null, 'Escena vieja', p);
  const inQ = await owner.tree.create(null, 'Escena de Q', q);
  await owner.engine.syncNow();
  await owner.tree.trash(old);
  await wait(15);
  fileInTrash(server, 'foto1', p, new Date().toISOString());
  await wait(15);
  await owner.tree.trash(inQ);
  await owner.engine.syncNow();
  await wait(15);
  await owner.remote.deleteProject(o);
  await owner.tree.forgetProject(o);
  await owner.engine.syncNow();
  return { server, owner, p, o, q, keep, old, inQ };
}

async function openTrash(d: Device, userId: string): Promise<HTMLElement> {
  const host = await mount(services(d, userId));
  await act(async () => host.querySelector<HTMLButtonElement>('.project-button')!.click());
  await settle();
  await act(async () => byText('Trash')!.click());
  await vi.waitFor(() => expect(panel()).not.toBeNull());
  await settle();
  return host;
}

describe('la lista (sin React)', () => {
  const page = (id: string, at: string, project = 'P') => ({ id, title: id, deleted_at: at, workspace_id: project }) as unknown as PageRow;
  const file = (id: string, at: string) => ({ projectId: 'P', file: { id, name: id, trashed_at: at } as unknown as TrashedFileRow });
  const project = (id: string, at: string) => ({ id, name: id, deleted_at: at }) as unknown as TrashedProjectRow;

  it('junta los tres tipos del más nuevo al más viejo, aunque la base y el dispositivo escriban la hora distinto', () => {
    const items = trashItems({
      filter: 'all',
      pages: [page('pág-1', '2026-10-01T10:00:00.000Z'), page('pág-3', '2026-10-03T10:00:00.000Z')],
      files: [file('arch-2', '2026-10-02T07:00:00.000000-03:00')],
      projects: [project('proy-4', '2026-10-03T12:00:00.5+00:00')],
    });
    expect(items.map((i) => (i.kind === 'project' ? i.row.id : i.kind === 'page' ? i.page.id : i.file.id))).toEqual(['proy-4', 'pág-3', 'arch-2', 'pág-1']);
  });

  it('cada filtro deja solo su tipo', () => {
    const input = {
      pages: [page('pág', '2026-10-01T10:00:00Z')],
      files: [file('arch', '2026-10-02T10:00:00Z')],
      projects: [project('proy', '2026-10-03T10:00:00Z')],
    };
    expect(trashItems({ ...input, filter: 'pages' }).map((i) => i.kind)).toEqual(['page']);
    expect(trashItems({ ...input, filter: 'files' }).map((i) => i.kind)).toEqual(['file']);
    expect(trashItems({ ...input, filter: 'projects' }).map((i) => i.kind)).toEqual(['project']);
    expect(trashItems({ ...input, filter: 'all' }).map((i) => i.kind)).toEqual(['project', 'file', 'page']);
  });
});

describe('la papelera en el selector de proyectos', () => {
  it('la barra lateral ya no tiene la papelera; el selector sí, en lugar de Deleted projects', async () => {
    const { server, owner } = await workspace();
    const host = await mount(services(owner, server.ownerId), <Sidebar />);
    expect(byText('Trash', host.querySelector('.sidebar-footer')!)).toBeUndefined();
    expect(host.querySelector('.sidebar-footer')?.textContent).not.toMatch(/Trash/);
    await act(async () => host.querySelector<HTMLButtonElement>('.project-button')!.click());
    await settle();
    expect(byText('Trash')).toBeDefined();
    expect(byText('Deleted projects')).toBeUndefined();
  });

  it('del proyecto abierto: los tres tipos juntos, del más nuevo al más viejo, cada uno con su proyecto; los borrados siempre', async () => {
    const { server, owner } = await workspace();
    await openTrash(owner, server.ownerId);
    expect(shown()).toEqual(['project:Bosque Negro', 'file:foto1.jpg', 'page:Escena vieja']);
    expect(kindLine('Escena vieja')).toBe('Page · My project');
    expect(kindLine('foto1.jpg')).toBe('File · My project');
    expect(kindLine('Bosque Negro')).toBe('Project');
    // El filtro arriba, con el alcance; *All* y *This project* de entrada.
    const filter = document.querySelector('.trash-filter')!;
    expect([...filter.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['All', 'Projects', 'Pages', 'Files']);
    expect(filter.querySelector('[aria-pressed="true"]')?.textContent).toBe('All');
    expect(document.querySelector('.trash-scope [aria-pressed="true"]')?.textContent).toBe('This project');
    expect(document.querySelector('.trash-menu [title]')).toBeNull();
  });

  it('con *All projects* suma lo de los otros proyectos, con el nombre de cada uno', async () => {
    const { server, owner, q } = await workspace();
    await openTrash(owner, server.ownerId);
    await act(async () => byText('All projects')!.click());
    await settle();
    expect(shown()).toEqual(['project:Bosque Negro', 'page:Escena de Q', 'file:foto1.jpg', 'page:Escena vieja']);
    expect(kindLine('Escena de Q')).toBe('Page · Old spot');
    // Los archivos de cada proyecto se piden una vez, al entrar en el alcance.
    expect(server.mediaCalls.filter((c) => c === `trashed_files ${q}`)).toHaveLength(1);
    await act(async () => byText('This project')!.click());
    expect(shown()).toEqual(['project:Bosque Negro', 'file:foto1.jpg', 'page:Escena vieja']);
  });

  it('cada filtro muestra solo lo suyo, con su explicación; con *Projects* no hay alcance', async () => {
    const { server, owner } = await workspace();
    await openTrash(owner, server.ownerId);
    await act(async () => byText('Pages')!.click());
    expect(shown()).toEqual(['page:Escena vieja']);
    expect(panel()!.textContent).toContain('already sent to the Google Drive trash from Files');
    await act(async () => byText('Files')!.click());
    expect(shown()).toEqual(['file:foto1.jpg']);
    expect(panel()!.textContent).toContain('Photos and videos that no page outside the trash uses anymore.');
    expect(panel()!.textContent).toContain('1 file · 2 KB');
    expect(byText('Empty')).toBeDefined();
    await act(async () => byText('Projects')!.click());
    expect(shown()).toEqual(['project:Bosque Negro']);
    expect(panel()!.textContent).toContain('Deleted projects can be restored exactly as they were.');
    expect(document.querySelector('.trash-scope')).toBeNull();
    // *Empty* es de los archivos: con los demás filtros no está.
    expect(byText('Empty')).toBeUndefined();
  });

  it('Restore de una página la devuelve; el título la abre y cierra el selector', async () => {
    const { server, owner, old } = await workspace();
    await openTrash(owner, server.ownerId);
    await act(async () => byText('Pages')!.click());
    const row = document.querySelector<HTMLElement>('.trash-item[data-kind="page"]')!;
    await act(async () => byText('Restore', row)!.click());
    await settle();
    expect(owner.tree.isTrashed(old)).toBe(false);
    expect(shown()).toEqual([]);
    expect(panel()!.textContent).toContain('The trash is empty.');

    await owner.tree.trash(old);
    await settle();
    await act(async () => document.querySelector<HTMLButtonElement>('.trash-item[data-kind="page"] button.title')!.click());
    expect(location.pathname).toBe(`/p/${old}`);
    expect(document.querySelector('.project-menu')).toBeNull();
  });

  it('Restore de un proyecto lo devuelve a la lista, como antes', async () => {
    const { server, owner, o } = await workspace();
    await openTrash(owner, server.ownerId);
    const row = document.querySelector<HTMLElement>('.trash-item[data-kind="project"]')!;
    expect(row.textContent).toContain('Deleted by owner@test');
    await act(async () => byText('Restore', row)!.click());
    await vi.waitFor(() => expect(server.deletedProjects.has(o)).toBe(false));
    await vi.waitFor(() => expect(owner.tree.project(o)?.name).toBe('Bosque Negro'));
    expect(shown()).not.toContain('project:Bosque Negro');
  });

  it('un archivo de otro proyecto se manda a la papelera de Drive desde *All projects*, con su confirmación', async () => {
    const { server, owner, q } = await workspace();
    fileInTrash(server, 'fotoq', q, new Date().toISOString());
    await openTrash(owner, server.ownerId);
    await act(async () => byText('Files')!.click());
    await act(async () => byText('All projects')!.click());
    await vi.waitFor(() => expect(shown()).toContain('file:fotoq.jpg'));
    expect(kindLine('fotoq.jpg')).toBe('File · Old spot');
    expect(panel()!.textContent).toContain('2 files · 4 KB');
    const confirm = vi.fn((_message: string) => false);
    vi.stubGlobal('confirm', confirm);
    const row = () => [...document.querySelectorAll<HTMLElement>('.trash-item')].find((li) => li.textContent?.includes('fotoq.jpg'))!;
    await act(async () => byText('Send to Drive trash', row())!.click());
    expect(confirm.mock.calls[0]?.[0]).toMatch(/Send “fotoq\.jpg” to the Google Drive trash\?/);
    expect(server.portero.calls.some((c) => c.path === '/trash')).toBe(false);
    confirm.mockReturnValue(true);
    await act(async () => byText('Send to Drive trash', row())!.click());
    await vi.waitFor(async () => {
      await settle();
      expect(shown()).toEqual(['file:foto1.jpg']);
    });
    expect(server.mediaFiles.get('fotoq')?.drive_trashed_at).toBeTruthy();
    expect(server.mediaFiles.get('foto1')?.drive_trashed_at).toBeFalsy();
  });

  it('en castellano: Papelera, Todo, Proyectos, Páginas, Archivos', async () => {
    const { server, owner } = await workspace();
    act(() => prefs.set({ language: 'es' }));
    const host = await mount(services(owner, server.ownerId));
    await act(async () => host.querySelector<HTMLButtonElement>('.project-button')!.click());
    await settle();
    await act(async () => byText('Papelera')!.click());
    await vi.waitFor(() => expect(document.querySelector('.trash-filter')).not.toBeNull());
    expect([...document.querySelectorAll('.trash-filter button')].map((b) => b.textContent)).toEqual(['Todo', 'Proyectos', 'Páginas', 'Archivos']);
    expect(document.querySelector('.trash-scope')?.textContent).toBe('Este proyectoTodos los proyectos');
    await vi.waitFor(() => expect(kindLine('Escena vieja')).toBe('Página · My project'));
  });
});

describe('quién ve qué (la base sigue mandando)', () => {
  it('un miembro que ve el proyecto abierto: sin Restore ni archivos; de los borrados, solo el que veía, sin quién lo borró', async () => {
    const { server, p, o, q } = await workspace();
    server.addMember('ana', 'member');
    server.grant('ana', { projectId: p }, 'view');
    server.grant('ana', { projectId: o }, 'edit_pages');
    // Q también está borrado, pero Ana nunca lo vio.
    server.deletedProjects.set(q, { at: new Date().toISOString(), by: server.ownerId });
    const ana = await makeDevice(server, undefined, undefined, undefined, undefined, { id: 'ana' });
    devices.push(ana);
    await ana.engine.syncNow();
    await openTrash(ana, 'ana');
    await vi.waitFor(() => expect(shown()).toContain('project:Bosque Negro'));
    expect(shown()).not.toContain('project:Old spot');
    const row = document.querySelector<HTMLElement>('.trash-item[data-kind="project"]')!;
    expect(byText('Restore', row)).toBeUndefined();
    expect(row.textContent).not.toContain('Deleted by');
    // Sin la papelera de archivos de P (solo ve): ni el filtro ni la consulta.
    expect(document.querySelector('.trash-filter')?.textContent).not.toContain('Files');
    expect(server.mediaCalls.filter((c) => c.startsWith('trashed_files'))).toEqual([]);
    expect(shown()).not.toContain('file:foto1.jpg');
    // Las páginas de la papelera que ve, sin Restore.
    for (const li of document.querySelectorAll<HTMLElement>('.trash-item[data-kind="page"]')) {
      expect(byText('Restore', li)).toBeUndefined();
    }
  });

  it('quien no veía ningún proyecto borrado no ve ninguno', async () => {
    const { server, p } = await workspace();
    server.addMember('beto', 'member');
    server.grant('beto', { projectId: p }, 'edit_pages');
    const beto = await makeDevice(server, undefined, undefined, undefined, undefined, { id: 'beto' });
    devices.push(beto);
    await beto.engine.syncNow();
    await openTrash(beto, 'beto');
    await vi.waitFor(() => expect(panel()!.textContent).not.toContain('Loading'));
    expect(shown().filter((s) => s.startsWith('project:'))).toEqual([]);
    // Con "editar y crear" en P ve sus archivos, pero no los manda a Drive (no es dueño ni admin).
    expect(shown()).toContain('file:foto1.jpg');
    expect(byText('Send to Drive trash')).toBeUndefined();
    await act(async () => byText('Files')!.click());
    expect(byText('Empty')).toBeUndefined();
    // Restaura páginas de P (puede manejarlas).
    await act(async () => byText('Pages')!.click());
    expect(byText('Restore', document.querySelector<HTMLElement>('.trash-item[data-kind="page"]')!)).toBeDefined();
  });
});

describe('sin red, una base vieja y la dirección vieja', () => {
  it('sin red: las páginas del dispositivo se ven y se restauran; proyectos y archivos lo explican y no se piden', async () => {
    const { server, owner, old } = await workspace();
    server.online = false;
    await owner.engine.syncNow();
    const before = server.mediaCalls.length;
    await openTrash(owner, server.ownerId);
    expect(shown()).toEqual(['page:Escena vieja']);
    expect(panel()!.textContent).toContain('Deleted projects and files need an internet connection');
    expect(server.mediaCalls.length).toBe(before);
    await act(async () => byText('Restore')!.click());
    await settle();
    expect(owner.tree.isTrashed(old)).toBe(false);
  });

  it('con una base sin la migración 9: la papelera con páginas y archivos, sin el filtro de proyectos', async () => {
    const server = new FakeServer();
    server.enableTrash();
    const owner = await makeDevice(server);
    devices.push(owner);
    await owner.engine.syncNow();
    const page = await owner.tree.create(null, 'Escena', server.workspaceId);
    await owner.engine.syncNow();
    await owner.tree.trash(page);
    await owner.engine.syncNow();
    await openTrash(owner, server.ownerId);
    expect([...document.querySelectorAll('.trash-filter button')].map((b) => b.textContent)).toEqual(['All', 'Pages', 'Files']);
    expect(shown()).toEqual(['page:Escena']);
  });

  it('openProjectTrash (la dirección vieja /trash) abre el selector en la papelera; Escape y ‹ vuelven a la lista sin cerrarlo', async () => {
    const { server, owner } = await workspace();
    await mount(services(owner, server.ownerId));
    expect(document.querySelector('.project-menu')).toBeNull();
    await act(async () => openProjectTrash());
    await vi.waitFor(() => expect(panel()).not.toBeNull());
    await settle();
    expect(document.activeElement?.classList.contains('project-back')).toBe(true);
    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(panel()).toBeNull();
    expect(document.querySelector('.project-menu')).not.toBeNull();
    expect(byText('Trash')).toBeDefined();
    await act(async () => byText('Trash')!.click());
    await vi.waitFor(() => expect(panel()).not.toBeNull());
    await act(async () => document.querySelector<HTMLButtonElement>('.project-back')!.click());
    expect(panel()).toBeNull();
    expect(document.querySelector('.project-menu')).not.toBeNull();
  });

  it('en el teléfono, el mismo lugar: la papelera dentro del selector', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('coarse'), addEventListener() {}, removeEventListener() {} }));
    const { server, owner } = await workspace();
    await openTrash(owner, server.ownerId);
    expect(document.querySelector('.project-menu.trash-menu')).not.toBeNull();
    expect(shown()).toEqual(['project:Bosque Negro', 'file:foto1.jpg', 'page:Escena vieja']);
    // Sin el foco en el botón de volver (en el teléfono no se enfoca nada solo).
    expect(document.activeElement?.classList.contains('project-back')).toBe(false);
  });
});
