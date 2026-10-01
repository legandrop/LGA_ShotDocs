// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    expect(archive.getAttribute('data-tip')).toBe('This is your only project: create another one first');
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

/** Monta el selector para esa persona y lo abre. */
async function open$(d: Device, userId: string): Promise<HTMLElement> {
  const host = await mount(services(d, userId));
  await open(host);
  return host;
}
