// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PorteroError } from '../media/portero';
import type { ProjectDrive } from '../media/projectDrive';
import { prefs } from '../prefs';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { ProjectSwitcher } from './ProjectSwitcher';

// Archivar y borrar proyectos (P.14) en el selector, contra el servidor en memoria: los íconos de cada renglón
// (solo a quien maneja el proyecto, apagados sin red o en el último activo), archivar en el mismo renglón, la
// lista de archivados, la ventana de borrar con la palabra del idioma, la lista de borrados con *Restore*, el
// "⋯" del teléfono y una base sin la migración.

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
  // El proyecto elegido en el dispositivo (project.ts) no pasa de una prueba a otra.
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
    shutdown: async () => undefined,
  };
}

async function mount(value: Services): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<ServicesContext.Provider value={value}>{<ProjectSwitcher />}</ServicesContext.Provider>));
  await settle();
  return host;
}

const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));

/** Un workspace con las reglas del equipo, en la versión 9, con tres proyectos del dueño. */
async function workspace(schema = 9): Promise<{ server: FakeServer; owner: Device; p: string; o: string; q: string }> {
  const server = new FakeServer();
  server.enableTeam();
  if (schema >= 9) server.enableProjectStates();
  else server.settings = { ...server.settings!, schemaVersion: schema };
  const owner = await makeDevice(server);
  devices.push(owner);
  await owner.engine.syncNow();
  const o = await owner.tree.createProject('Bosque Negro');
  const q = await owner.tree.createProject('Old spot');
  await owner.engine.syncNow();
  return { server, owner, p: server.workspaceId, o, q };
}

const open = async (host: HTMLElement) => {
  await act(async () => host.querySelector<HTMLButtonElement>('.project-button')!.click());
  await settle();
};
const label = (name: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
const byText = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text);
const rowIds = () => [...document.querySelectorAll('[role="option"]')].map((b) => b.id.replace('project-option-', ''));

describe('selector: archivar', () => {
  it('cada renglón tiene renombrar, archivar y borrar; archivar pregunta en el renglón y lo pasa a archivados', async () => {
    const { server, owner, p, o, q } = await workspace();
    const host = await open$(owner, server.ownerId);
    expect(rowIds().sort()).toEqual([p, o, q].sort());
    // Íconos con nombre accesible y tooltip propio, sin `title`.
    const archive = label('Archive “Bosque Negro”')!;
    expect(archive.getAttribute('data-tip')).toBe('Archive');
    expect(label('Delete “Bosque Negro”…')!.getAttribute('data-tip')).toBe('Delete…');
    expect(label('Rename “Bosque Negro”')!.getAttribute('data-tip')).toBe('Rename');
    expect(document.querySelector('.project-menu [title]')).toBeNull();
    // La línea "Rename “X”" ya no está: renombrar es el lápiz del renglón.
    expect(byText('Rename “My project”')).toBeUndefined();

    await act(async () => archive.click());
    expect(document.querySelector('.project-row.confirming')?.textContent).toContain('Archive “Bosque Negro”?');
    // Cancelar vuelve al renglón sin cambiar nada.
    await act(async () => byText('Cancel')!.click());
    expect(server.projects.get(o)?.archived_at).toBeFalsy();
    await act(async () => label('Archive “Bosque Negro”')!.click());
    await act(async () => byText('Archive')!.click());
    await settle();
    expect(server.projects.get(o)?.archived_at).toBeTruthy();
    expect(rowIds().sort()).toEqual([p, q].sort());

    // La lista de archivados: se abre, se desarchiva con un clic.
    await act(async () => byText('Archived projects (1)')!.click());
    expect(rowIds()).toEqual([o]);
    expect(document.getElementById(`project-option-${o}`)?.textContent).toMatch(/archived /);
    await act(async () => label('Unarchive “Bosque Negro”')!.click());
    await settle();
    expect(server.projects.get(o)?.archived_at).toBeNull();
    void host;
  });

  it('el último proyecto activo no se archiva ni se borra; sin red, tampoco (con el motivo en el tooltip)', async () => {
    const { server, owner, o, q, p } = await workspace();
    await owner.remote.setProjectArchived(o, true);
    await owner.remote.setProjectArchived(q, true);
    await owner.engine.syncNow();
    await open$(owner, server.ownerId);
    const archive = label('Archive “My project”')!;
    expect(archive.disabled).toBe(true);
    // Con archivados, el motivo dice que se puede desarchivar otro.
    expect(archive.getAttribute('data-tip')).toBe('This is your only active project: create or unarchive another one first');
    expect(label('Delete “My project”…')!.disabled).toBe(true);
    void p;
  });

  it('quien no maneja el proyecto no tiene archivar ni borrar; sí renombrar si tiene "editar y crear"', async () => {
    const { server, o } = await workspace();
    server.addMember('ana', 'member');
    server.grant('ana', { projectId: o }, 'edit_pages');
    const ana = await makeDevice(server, undefined, undefined, undefined, undefined, { id: 'ana' });
    devices.push(ana);
    await ana.engine.syncNow();
    await open$(ana, 'ana');
    expect(label('Rename “Bosque Negro”')).not.toBeNull();
    expect(label('Archive “Bosque Negro”')).toBeNull();
    expect(label('Delete “Bosque Negro”…')).toBeNull();
  });

  it('con una base sin la migración 9: el selector de siempre, sin archivar, borrar ni las listas nuevas', async () => {
    const { server, owner } = await workspace(8);
    await open$(owner, server.ownerId);
    expect(label('Rename “Bosque Negro”')).not.toBeNull();
    expect(label('Archive “Bosque Negro”')).toBeNull();
    expect(label('Delete “Bosque Negro”…')).toBeNull();
    expect(byText('Deleted projects')).toBeUndefined();
  });
});

describe('selector: borrar', () => {
  it('la ventana muestra los números, pide la palabra del idioma (con los atributos del iPhone) y borra recién con ella', async () => {
    const { server, owner, p, o, q } = await workspace();
    await owner.tree.create(null, 'Escena', o);
    await owner.engine.syncNow();
    await open$(owner, server.ownerId);
    await act(async () => label('Delete “Bosque Negro”…')!.click());
    await vi.waitFor(() => expect(document.querySelector('.delete-project-dialog')?.textContent).toContain('1 page · 0 files · 0 KB in Google Drive'));
    const dialog = document.querySelector('.delete-project-dialog')!;
    expect(dialog.textContent).toContain('Delete “Bosque Negro”?');
    expect(dialog.textContent).toContain('it can be restored exactly as it was for 30 days');
    // Sin archivos subidos no dice que quedan en Drive.
    expect(dialog.textContent).not.toContain('Its files stay in Google Drive');
    await vi.waitFor(() => expect(dialog.querySelector('input')).not.toBeNull());
    const input = dialog.querySelector('input')!;
    expect(input.getAttribute('autocapitalize')).toBe('off');
    expect(input.getAttribute('autocorrect')).toBe('off');
    expect(input.getAttribute('spellcheck')).toBe('false');
    const button = byText('Delete project')!;
    expect(button.disabled).toBe(true);

    const type = async (value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      await act(async () => {
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    // La del otro idioma no vale.
    await type('borrar');
    expect(byText('Delete project')!.disabled).toBe(true);
    await type(' DELETE ');
    expect(byText('Delete project')!.disabled).toBe(false);
    await act(async () => byText('Delete project')!.click());
    await settle();
    expect(server.deletedProjects.has(o)).toBe(true);
    expect(owner.tree.project(o)).toBeUndefined();
    expect(document.querySelector('.delete-project-dialog')).toBeNull();
    // Nada se borró del servidor: las páginas siguen ahí.
    expect([...server.pages.values()].some((pg) => pg.workspace_id === o)).toBe(true);
    void p;
    void q;
  });

  it('en castellano la palabra es "borrar"', async () => {
    const { server, owner } = await workspace();
    act(() => prefs.set({ language: 'es' }));
    await open$(owner, server.ownerId);
    await act(async () => label('Borrar “Bosque Negro”…')!.click());
    await vi.waitFor(() => expect(document.querySelector('.delete-project-dialog input')).not.toBeNull());
    expect(document.querySelector('.delete-project-word')?.textContent).toContain('Escribí borrar para confirmar');
  });

  it('con cambios de ese proyecto sin subir en el dispositivo, no deja borrar (y ofrece bajarlos)', async () => {
    const { server, owner, o } = await workspace();
    server.online = false;
    await owner.tree.create(null, 'Hecha sin red', o);
    await open$(owner, server.ownerId);
    await act(async () => label('Delete “Bosque Negro”…')!.click());
    await vi.waitFor(() =>
      expect(document.querySelector('.delete-project-dialog')?.textContent).toContain('This device has 1 change in this project that is not uploaded yet'),
    );
    expect(document.querySelector('.delete-project-dialog input')).toBeNull();
    expect(byText('Delete project')!.disabled).toBe(true);
    expect(byText('Download my unsynced changes')).toBeDefined();
  });

  it('la lista de borrados muestra quién y cuándo, y *Restore* lo devuelve', async () => {
    const { server, owner, o } = await workspace();
    await owner.remote.deleteProject(o);
    await owner.tree.forgetProject(o);
    await open$(owner, server.ownerId);
    await act(async () => byText('Deleted projects')!.click());
    await vi.waitFor(() => expect(document.querySelector('.deleted-projects')?.textContent).toContain('Bosque Negro'));
    const list = document.querySelector('.deleted-projects')!;
    expect(list.textContent).toContain('Deleted by owner@test');
    expect(list.textContent).toContain('30 days left');
    await act(async () => byText('Restore')!.click());
    await vi.waitFor(() => expect(server.deletedProjects.has(o)).toBe(false));
    await vi.waitFor(() => expect(owner.tree.project(o)?.name).toBe('Bosque Negro'));
  });
});

describe('selector en el teléfono', () => {
  it('un "⋯" por renglón despliega las acciones; archivar pregunta en el renglón', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('coarse'), addEventListener() {}, removeEventListener() {} }));
    const { server, owner, o } = await workspace();
    await open$(owner, server.ownerId);
    // Sin los íconos al pasar el mouse.
    expect(label('Archive “Bosque Negro”')).toBeNull();
    const more = label('Actions for “Bosque Negro”')!;
    expect(more.getAttribute('aria-expanded')).toBe('false');
    await act(async () => more.click());
    const sheet = document.querySelector('.project-row.opened .project-sheet')!;
    expect([...sheet.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual([
      'Rename',
      'Share “Bosque Negro”…',
      'Archive',
      'Delete…',
    ]);
    await act(async () => [...sheet.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Archive')!.click());
    await act(async () => byText('Archive')!.click());
    await settle();
    expect(server.projects.get(o)?.archived_at).toBeTruthy();
  });
});

describe('pantalla "sin proyectos"', () => {
  /** Un cliente de Supabase de mentira: un miembro sin proyectos, con uno borrado que puede (o no) restaurar. */
  function client(canRestore: boolean, calls: string[]) {
    return {
      auth: { signOut: async () => undefined },
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'member', removed_at: null }, error: null }) }) }),
      }),
      rpc: async (fn: string, args?: Record<string, unknown>) => {
        calls.push(args?.p_project ? `${fn} ${String(args.p_project)}` : fn);
        if (fn === 'trashed_projects') {
          return {
            data: [{ id: 'm1', name: 'Mi spot', archived_at: null, deleted_at: new Date().toISOString(), deleted_by: 'u', deleted_by_email: 'ana@test', days_left: 30, can_restore: canRestore, pages: 4, files: 0 }],
            error: null,
            status: 200,
          };
        }
        return { data: null, error: null, status: 204 };
      },
    };
  }

  async function mountNoProjects(canRestore: boolean, calls: string[], onRetry: () => void): Promise<HTMLElement> {
    const { WorkspaceContext } = await import('../workspace');
    const { NoProjects } = await import('./Workspace');
    const value = {
      config: { url: 'https://x.supabase.co', publishableKey: 'k', name: 'Wanka', localKey: WANKA_LOCAL_KEY, storage: legacyStorageNames(WANKA_LOCAL_KEY) },
      client: client(canRestore, calls),
    } as never;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () =>
      root.render(
        <WorkspaceContext.Provider value={value}>
          <NoProjects user={{ id: 'u1', email: 'u1@test' }} onRetry={onRetry} />
        </WorkspaceContext.Provider>,
      ),
    );
    await settle();
    return host;
  }

  it('con un borrado que la persona puede restaurar, lo ofrece; restaurarlo vuelve a entrar', async () => {
    const calls: string[] = [];
    const onRetry = vi.fn();
    const host = await mountNoProjects(true, calls, onRetry);
    await vi.waitFor(() => expect(host.textContent).toContain('Mi spot'));
    expect(host.textContent).toContain('Deleted projects');
    await act(async () => byText('Restore')!.click());
    await vi.waitFor(() => expect(onRetry).toHaveBeenCalled());
    expect(calls).toContain('restore_project m1');
  });

  it('sin ninguno restaurable, la pantalla de siempre', async () => {
    const host = await mountNoProjects(false, [], () => undefined);
    await settle();
    expect(host.textContent).toContain('No projects yet');
    expect(host.textContent).not.toContain('Deleted projects');
  });
});

describe('correcciones de la auditoría del código', () => {
  it('B1: la app arrancó sin red (sin saber la versión de la base): los archivados guardados se ven y se abren', async () => {
    const { server, owner, q } = await workspace();
    await owner.remote.setProjectArchived(q, true);
    await owner.engine.syncNow();
    const db = owner.db.name;
    await owner.engine.stop();
    // La misma app vuelve a abrir, sin red: el motor nunca leyó los ajustes del servidor.
    server.online = false;
    const again = await makeDevice(server, db);
    devices.push(again);
    expect(again.engine.getStatus().schemaVersion).toBeNull();
    await open$(again, server.ownerId);
    const line = byText('Archived projects (1)')!;
    expect(line).toBeDefined();
    await act(async () => line.click());
    expect(rowIds()).toEqual([q]);
    // Se abre; desarchivar y borrar piden red y la versión: no se ofrecen.
    expect(label('Unarchive “Old spot”')).toBeNull();
    expect(label('Delete “Old spot”…')).toBeNull();
  });

  it('B2: abierto un archivado, la marca está en el botón del selector y en el inicio del proyecto', async () => {
    const { server, owner, q } = await workspace();
    await owner.remote.setProjectArchived(q, true);
    await owner.engine.syncNow();
    const { Home } = await import('./Workspace');
    const { storageProjectKey } = { storageProjectKey: legacyStorageNames(WANKA_LOCAL_KEY).project };
    localStorage.setItem(storageProjectKey, JSON.stringify({ [server.ownerId]: q }));
    const host = await mount(services(owner, server.ownerId));
    expect(host.querySelector('.project-button')?.textContent).toContain('Project · 0 pages · Archived');
    const home = document.createElement('div');
    document.body.append(home);
    const root = createRoot(home);
    roots.push(root);
    await act(async () => root.render(<ServicesContext.Provider value={services(owner, server.ownerId)}>{<Home />}</ServicesContext.Provider>));
    expect(home.querySelector('.archived-note')?.textContent).toContain('Archived: out of your everyday list');
  });

  it('obs. 2 y 3: Escape vuelve al renglón o a la lista sin cerrar el selector; después de archivar, el foco está en el buscador', async () => {
    const { server, owner, o } = await workspace();
    await open$(owner, server.ownerId);
    await act(async () => label('Archive “Bosque Negro”')!.click());
    const archiveButton = byText('Archive')!;
    archiveButton.focus();
    await act(async () => {
      archiveButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('.project-menu')).not.toBeNull();
    expect(document.querySelector('.project-row.confirming')).toBeNull();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Find a project');

    await act(async () => label('Archive “Bosque Negro”')!.click());
    await act(async () => byText('Archive')!.click());
    await settle();
    expect(server.projects.get(o)?.archived_at).toBeTruthy();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Find a project');

    // En la lista de archivados, Escape vuelve a la principal (el selector sigue abierto).
    await act(async () => byText('Archived projects (1)')!.click());
    const search = document.querySelector<HTMLInputElement>('.project-search input')!;
    expect(document.activeElement).toBe(search);
    await act(async () => {
      search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('.project-menu')).not.toBeNull();
    expect(byText('Archived projects (1)')).toBeDefined();
  });

  it('obs. 4: los errores de archivar, borrar y restaurar en palabras y en los dos idiomas', async () => {
    const { projectStateError } = await import('./project');
    const { RemoteError } = await import('../sync/types');
    const { translate } = await import('../i18n');
    const tr = Object.assign((key: never, params?: never) => translate('es', key, params), { lang: 'es' }) as never;
    expect(projectStateError(new RemoteError('not_allowed', true, '42501'))).toBe("You can't do that in this project anymore: your access changed.");
    expect(projectStateError(new RemoteError('project_deleted', true, 'P0001'), tr)).toBe('Este proyecto se borró mientras tanto: está en Proyectos borrados.');
    expect(projectStateError(new RemoteError('project_not_found', true, 'P0002'))).toBe("This project no longer exists, or you can't see it anymore.");
    expect(projectStateError(new RemoteError('boom', false))).toBe('Could not do it: boom');
  });

  it('obs. 5: con archivados, el último activo dice que se puede crear o desarchivar otro', async () => {
    const { server, owner, o, q } = await workspace();
    await owner.remote.setProjectArchived(o, true);
    await owner.remote.setProjectArchived(q, true);
    await owner.engine.syncNow();
    await open$(owner, server.ownerId);
    expect(label('Archive “My project”')!.getAttribute('data-tip')).toBe(
      'This is your only active project: create or unarchive another one first',
    );
  });

  it('obs. 6: sin uno elegido, si el primero del dispositivo está archivado, la app abre el primero activo', async () => {
    const { server, owner, p, o } = await workspace();
    await owner.remote.setProjectArchived(p, true);
    await owner.engine.syncNow();
    expect(owner.tree.workspaceId).toBe(p);
    const host = await mount(services(owner, server.ownerId));
    expect(host.querySelector('.project-button strong')?.textContent).toBe(owner.tree.activeProjects()[0].name);
    expect(owner.tree.activeProjects()[0].id).not.toBe(p);
    void o;
  });

  it('obs. 1 y 7: "sin proyectos" con cambios sin subir los muestra, deja bajarlos y salir pregunta; el texto ofrece restaurar', async () => {
    const { WorkspaceContext } = await import('../workspace');
    const { NoProjects } = await import('./Workspace');
    const signOut = vi.fn(async () => undefined);
    const client = {
      auth: { signOut },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'admin', removed_at: null }, error: null }) }) }) }),
      rpc: async (fn: string) =>
        fn === 'trashed_projects'
          ? { data: [{ id: 'm1', name: 'Mi spot', archived_at: null, deleted_at: new Date().toISOString(), deleted_by: null, deleted_by_email: null, days_left: 30, can_restore: true, pages: null, files: null }], error: null, status: 200 }
          : { data: null, error: null, status: 204 },
    };
    const value = {
      config: { url: 'https://x.supabase.co', publishableKey: 'k', name: 'Wanka', localKey: WANKA_LOCAL_KEY, storage: legacyStorageNames(WANKA_LOCAL_KEY) },
      client,
    } as never;
    const download = vi.fn(async () => undefined);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    act(() => prefs.set({ language: 'es' }));
    await act(async () =>
      root.render(
        <WorkspaceContext.Provider value={value}>
          <NoProjects user={{ id: 'u1', email: 'u1@test' }} onRetry={() => undefined} pending={2} onDownload={download} />
        </WorkspaceContext.Provider>,
      ),
    );
    await settle();
    await vi.waitFor(() => expect(host.textContent).toContain('Mi spot'));
    expect(host.textContent).toContain('Restaurá un proyecto borrado de abajo, o creá uno nuevo.');
    expect(host.textContent).not.toContain('Creá el primer proyecto');
    // Sin números (no lo maneja), el plazo abre el renglón con mayúscula.
    expect(host.querySelector('.deleted-project-row')?.textContent).toContain('Quedan 30 días');
    expect(host.textContent).toContain('Este dispositivo tiene 2 cambios sin subir.');
    await act(async () => byText('Descargar mis cambios sin sincronizar')!.click());
    expect(download).toHaveBeenCalled();
    vi.stubGlobal('confirm', vi.fn(() => false));
    await act(async () => byText('Cerrar sesión')!.click());
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe('obs. 7: el plazo en minúscula después del "·"', () => {
  it('en castellano, "3 páginas · quedan 30 días"', async () => {
    const { server, owner, o } = await workspace();
    await owner.tree.create(null, 'Escena', o);
    await owner.engine.syncNow();
    await owner.remote.deleteProject(o);
    await owner.tree.forgetProject(o);
    act(() => prefs.set({ language: 'es' }));
    await open$(owner, server.ownerId);
    await act(async () => byText('Proyectos borrados')!.click());
    await vi.waitFor(() => expect(document.querySelector('.deleted-project-row')?.textContent).toContain('1 página · quedan 30 días'));
  });
});

/** Monta el selector para esa persona y lo abre. */
async function open$(d: Device, userId: string): Promise<HTMLElement> {
  const host = await mount(services(d, userId));
  await open(host);
  return host;
}

// --- entrega 2: la carpeta de Drive (Docs/Doc_Proyectos_Borrar.md, sección 3) -------------------------------------

/**
 * Un portero de mentira para la carpeta de un proyecto: hace en el servidor en memoria lo que haría el de verdad con
 * la base (pide y confirma al mandar; borra las marcas al traer) y anota en qué orden se llamó.
 */
function fakeDrive(
  server: FakeServer,
  opts: { connected?: boolean; trash?: Error; untrash?: 'untrashed' | 'missing' | Error } = {},
): { drive: ProjectDrive; calls: string[] } {
  const calls: string[] = [];
  const drive: ProjectDrive = {
    status: async () => ({ connected: opts.connected ?? true, broken: null, email: null, isOwner: true }),
    trash: async (id) => {
      calls.push(`trash ${id} ${server.deletedProjects.has(id) ? 'borrado' : 'ACTIVO'}`);
      if (opts.trash) throw opts.trash;
      const now = new Date().toISOString();
      server.projectDrive.set(id, { requested_at: now, trashed_at: now, missing_at: null });
      return { status: 'done', project: id, drive: 'trashed', folders: 1 };
    },
    untrash: async (id) => {
      calls.push(`untrash ${id}`);
      if (opts.untrash instanceof Error) throw opts.untrash;
      if (opts.untrash === 'missing') return { status: 'done', project: id, drive: 'missing', folders: 0 };
      server.projectDrive.delete(id);
      return { status: 'done', project: id, drive: 'untrashed', folders: 1 };
    },
  };
  return { drive, calls };
}

/** El workspace en la versión 10, con portero, y un archivo subido en "Bosque Negro". */
async function driveWorkspace() {
  const ws = await workspace();
  ws.server.enableProjectDrive();
  ws.server.settings = { ...ws.server.settings!, mediaUrl: 'https://portero.test' };
  ws.server.mediaFiles.set('f1', {
    id: 'f1', name: 'f1.jpg', mime: 'image/jpeg', width: null, height: null, duration: null, thumb_at: null,
    drive_id: 'd1', size: 1_572_864, trashed_at: null, purged_at: null, drive_trashed_at: null, project_id: ws.o,
  });
  await ws.owner.engine.syncNow();
  return ws;
}

async function openWith(d: Device, userId: string, drive: ProjectDrive): Promise<HTMLElement> {
  const host = await mount({ ...services(d, userId), projectDrive: drive });
  await open(host);
  return host;
}

async function typeWord(value: string) {
  const input = document.querySelector<HTMLInputElement>('.delete-project-dialog input#delete-project-word')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const driveBox = () => document.querySelector<HTMLInputElement>('.delete-project-drive input[type="checkbox"]');

describe('entrega 2: la casilla de Drive en la ventana de borrar', () => {
  it('arranca destildada; tildada, después de borrar el proyecto el portero manda su carpeta', async () => {
    const { server, owner, o } = await driveWorkspace();
    const { drive, calls } = fakeDrive(server);
    const notices: string[] = [];
    window.addEventListener('shotdocs:notice', (e) => notices.push((e as CustomEvent<string>).detail));
    await openWith(owner, server.ownerId, drive);
    await act(async () => label('Delete “Bosque Negro”…')!.click());
    await vi.waitFor(() => expect(driveBox()?.disabled).toBe(false));
    const dialog = document.querySelector('.delete-project-dialog')!;
    expect(driveBox()!.checked).toBe(false);
    expect(dialog.textContent).toContain('Also send its files to the Google Drive trash (1.5 MB)');
    expect(dialog.textContent).toContain('Its files stay in Google Drive (1.5 MB).');

    await act(async () => driveBox()!.click());
    expect(driveBox()!.checked).toBe(true);
    expect(dialog.textContent).toContain('The folder LGA_ShotDocs/Bosque_Negro goes to the Drive trash with everything in it');
    await vi.waitFor(() => expect(document.querySelector('.delete-project-dialog input#delete-project-word')).not.toBeNull());
    await typeWord('delete');
    await act(async () => byText('Delete project')!.click());
    await settle();
    // Primero la base (el proyecto borrado), después la carpeta.
    expect(calls).toEqual([`trash ${o} borrado`]);
    expect(server.deletedProjects.has(o)).toBe(true);
    expect(server.projectDrive.get(o)?.trashed_at).toBeTruthy();
    await vi.waitFor(() => expect(notices.join(' ')).toContain('Its folder is in the Google Drive trash.'));
  });

  it('sin tildar, la carpeta no se toca', async () => {
    const { server, owner, o } = await driveWorkspace();
    const { drive, calls } = fakeDrive(server);
    await openWith(owner, server.ownerId, drive);
    await act(async () => label('Delete “Bosque Negro”…')!.click());
    await vi.waitFor(() => expect(driveBox()?.disabled).toBe(false));
    await vi.waitFor(() => expect(document.querySelector('.delete-project-dialog input#delete-project-word')).not.toBeNull());
    await typeWord('delete');
    await act(async () => byText('Delete project')!.click());
    await settle();
    expect(server.deletedProjects.has(o)).toBe(true);
    expect(calls).toEqual([]);
  });

  it('si Drive falla, el proyecto queda borrado y el aviso dice que se manda desde Deleted projects', async () => {
    const { server, owner, o } = await driveWorkspace();
    const { drive } = fakeDrive(server, { trash: new PorteroError('x', 503, true, 'drive_not_connected') });
    const notices: string[] = [];
    window.addEventListener('shotdocs:notice', (e) => notices.push((e as CustomEvent<string>).detail));
    await openWith(owner, server.ownerId, drive);
    await act(async () => label('Delete “Bosque Negro”…')!.click());
    await vi.waitFor(() => expect(driveBox()?.disabled).toBe(false));
    await act(async () => driveBox()!.click());
    await vi.waitFor(() => expect(document.querySelector('.delete-project-dialog input#delete-project-word')).not.toBeNull());
    await typeWord('delete');
    await act(async () => byText('Delete project')!.click());
    await settle();
    expect(server.deletedProjects.has(o)).toBe(true);
    await vi.waitFor(() =>
      expect(notices.join(' ')).toContain('Its files did not go to the Google Drive trash (Google Drive is not connected: the workspace owner has to connect it.): send them from Deleted projects.'),
    );
  });

  it('apagada con el motivo: Drive sin conectar, o quien borra no es dueño ni admin', async () => {
    const { server, owner } = await driveWorkspace();
    await openWith(owner, server.ownerId, fakeDrive(server, { connected: false }).drive);
    await act(async () => label('Delete “Bosque Negro”…')!.click());
    await vi.waitFor(() => expect(document.querySelector('.delete-project-drive')?.textContent).toContain('Google Drive is not connected'));
    expect(driveBox()!.disabled).toBe(true);
    expect(driveBox()!.checked).toBe(false);
  });

  it('con una base sin la migración 10, la línea de siempre y sin casilla', async () => {
    const { server, owner } = await workspace();
    server.settings = { ...server.settings!, mediaUrl: 'https://portero.test' };
    server.mediaFiles.set('f1', {
      id: 'f1', name: 'f1.jpg', mime: 'image/jpeg', width: null, height: null, duration: null, thumb_at: null,
      drive_id: 'd1', size: 1_572_864, trashed_at: null, purged_at: null, drive_trashed_at: null, project_id: [...server.projects.values()].find((p) => p.name === 'Bosque Negro')!.id,
    });
    await owner.engine.syncNow();
    await openWith(owner, server.ownerId, fakeDrive(server).drive);
    await act(async () => label('Delete “Bosque Negro”…')!.click());
    await vi.waitFor(() => expect(document.querySelector('.delete-project-dialog')?.textContent).toContain('Its files stay in Google Drive (1.5 MB).'));
    expect(driveBox()).toBeNull();
  });
});

describe('entrega 2: la lista de borrados con la carpeta en la papelera de Drive', () => {
  async function deletedWithFolder(opts: Parameters<typeof fakeDrive>[1] = {}) {
    const ws = await driveWorkspace();
    await ws.owner.remote.deleteProject(ws.o);
    await ws.owner.tree.forgetProject(ws.o);
    const now = new Date().toISOString();
    ws.server.projectDrive.set(ws.o, { requested_at: now, trashed_at: now, missing_at: null });
    const fake = fakeDrive(ws.server, opts);
    await openWith(ws.owner, ws.server.ownerId, fake.drive);
    await act(async () => byText('Deleted projects')!.click());
    await vi.waitFor(() => expect(document.querySelector('.deleted-projects')?.textContent).toContain('Bosque Negro'));
    return { ...ws, ...fake };
  }

  it('dice hasta cuándo están en la papelera de Drive; Restore primero trae la carpeta y después restaura', async () => {
    const { server, owner, o, calls } = await deletedWithFolder();
    expect(document.querySelector('.deleted-projects')?.textContent).toMatch(/Files in the Google Drive trash until \w+ \d+/);
    await act(async () => byText('Restore')!.click());
    await vi.waitFor(() => expect(server.deletedProjects.has(o)).toBe(false));
    expect(calls).toEqual([`untrash ${o}`]);
    expect(server.projectDrive.has(o)).toBe(false);
    await vi.waitFor(() => expect(owner.tree.project(o)?.name).toBe('Bosque Negro'));
  });

  it('si Drive ya no tiene la carpeta, pregunta; "Restore without its files" lo restaura con la marca', async () => {
    const { server, owner, o } = await deletedWithFolder({ untrash: 'missing' });
    await act(async () => byText('Restore')!.click());
    await vi.waitFor(() => expect(document.querySelector('.deleted-project-ask')?.textContent).toContain('Google Drive no longer has the folder of this project'));
    expect(server.deletedProjects.has(o)).toBe(true);
    // Cancelar no cambia nada.
    await act(async () => byText('Cancel')!.click());
    expect(document.querySelector('.deleted-project-ask')).toBeNull();
    await act(async () => byText('Restore')!.click());
    await vi.waitFor(() => expect(byText('Restore without its files')).toBeDefined());
    await act(async () => byText('Restore without its files')!.click());
    await vi.waitFor(() => expect(server.deletedProjects.has(o)).toBe(false));
    expect(server.projectDrive.get(o)?.missing_at).toBeTruthy();
    await vi.waitFor(() => expect(owner.tree.project(o)?.drive_missing_at).toBeTruthy());
  });

  it('con Drive conectado a otra cuenta (o sin conectar) no ofrece restaurar sin los archivos', async () => {
    const { server, o } = await deletedWithFolder({ untrash: new PorteroError('x', 409, false, 'drive_other_account') });
    await act(async () => byText('Restore')!.click());
    await vi.waitFor(() => expect(document.querySelector('.deleted-projects .error')?.textContent).toContain('Google Drive is connected to another account'));
    expect(byText('Restore without its files')).toBeUndefined();
    expect(server.deletedProjects.has(o)).toBe(true);
  });

  it('un borrado sin la carpeta enviada ofrece mandarla (pregunta antes); a medias, la termina', async () => {
    const ws = await driveWorkspace();
    await ws.owner.remote.deleteProject(ws.o);
    await ws.owner.tree.forgetProject(ws.o);
    const { drive, calls } = fakeDrive(ws.server);
    await openWith(ws.owner, ws.server.ownerId, drive);
    await act(async () => byText('Deleted projects')!.click());
    await vi.waitFor(() => expect(byText('Send files to the Drive trash')).toBeDefined());
    await act(async () => byText('Send files to the Drive trash')!.click());
    expect(document.querySelector('.deleted-project-ask')?.textContent).toContain('Send the folder LGA_ShotDocs/Bosque_Negro to the Google Drive trash');
    expect(calls).toEqual([]);
    await act(async () => byText('Send to the Drive trash')!.click());
    await settle();
    expect(calls).toEqual([`trash ${ws.o} borrado`]);
    await vi.waitFor(() => expect(document.querySelector('.deleted-projects')?.textContent).toMatch(/Files in the Google Drive trash until/));
    expect(byText('Send files to the Drive trash')).toBeUndefined();
  });
});

describe('entrega 2: restaurado sin su carpeta, "Look for its files again" en el inicio', () => {
  async function homeOf(untrash: 'untrashed' | 'missing') {
    const ws = await driveWorkspace();
    ws.server.projectDrive.set(ws.o, { requested_at: '2026-10-01T10:00:00Z', trashed_at: '2026-10-01T10:00:01Z', missing_at: '2026-10-02T10:00:00Z' });
    await ws.owner.engine.syncNow();
    const fake = fakeDrive(ws.server, { untrash });
    const { Home } = await import('./Workspace');
    localStorage.setItem(legacyStorageNames(WANKA_LOCAL_KEY).project, JSON.stringify({ [ws.server.ownerId]: ws.o }));
    const home = document.createElement('div');
    document.body.append(home);
    const root = createRoot(home);
    roots.push(root);
    const value = { ...services(ws.owner, ws.server.ownerId), projectDrive: fake.drive };
    await act(async () => root.render(<ServicesContext.Provider value={value}>{<Home />}</ServicesContext.Provider>));
    await settle();
    return { ...ws, ...fake, home };
  }

  it('lo dice en el inicio; buscarlos de nuevo la trae y la marca sale', async () => {
    const { owner, o, calls, home } = await homeOf('untrashed');
    expect(home.querySelector('.drive-missing-note')?.textContent).toContain('Its files were not in Google Drive when it was restored');
    await vi.waitFor(() => expect(byText('Look for its files again')).toBeDefined());
    await act(async () => byText('Look for its files again')!.click());
    await settle();
    expect(calls).toEqual([`untrash ${o}`]);
    await vi.waitFor(() => expect(owner.tree.project(o)?.drive_missing_at).toBeNull());
    await vi.waitFor(() => expect(home.querySelector('.drive-missing-note')).toBeNull());
  });

  it('si Drive sigue sin tenerla, lo dice y la marca queda', async () => {
    const { owner, o, home } = await homeOf('missing');
    await vi.waitFor(() => expect(byText('Look for its files again')).toBeDefined());
    await act(async () => byText('Look for its files again')!.click());
    await settle();
    expect(home.querySelector('.drive-missing-note')?.textContent).toContain('Google Drive still does not have the folder of this project.');
    expect(owner.tree.project(o)?.drive_missing_at).toBeTruthy();
  });
});
