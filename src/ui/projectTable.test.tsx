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
import { searchSession } from './projectSearchUi';

// El selector de proyectos (v0.329, sin columnas desde la v0.333): la línea de datos abajo del nombre, el ⋯ de cada renglón (menú flotante con texto), el botón *New*
// de arriba, el pie, los archivados y la estrella en su lugar fijo. Contra el servidor en memoria.

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

/** Un workspace con las reglas del equipo, archivar y borrar (base 9) y tres proyectos del dueño. */
async function workspace() {
  const server = new FakeServer();
  server.enableTeam();
  server.enableProjectStates();
  const owner = await makeDevice(server);
  devices.push(owner);
  await owner.engine.syncNow();
  const o = await owner.tree.createProject('Bosque Negro');
  const q = await owner.tree.createProject('Old spot');
  await owner.engine.syncNow();
  return { server, owner, p: server.workspaceId, o, q };
}

async function openFor(d: Device, userId: string): Promise<HTMLElement> {
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

const rows = () => [...document.querySelectorAll<HTMLElement>('.project-line')];
const rowOf = (id: string) => document.getElementById(`project-option-${id}`)!.closest<HTMLElement>('.project-line')!;
const moreOf = (name: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="Actions for “${name}”"]`);
const pop = () => document.querySelector<HTMLElement>('.project-pop');
const popItems = () => [...document.querySelectorAll<HTMLButtonElement>('.project-pop button')].map((b) => b.textContent);
const byText = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text);

describe('selector: la tabla', () => {
  it('una fila por proyecto, con la línea de datos abajo del nombre, y «Open» solo en el abierto', async () => {
    const { server, owner, p } = await workspace();
    await openFor(owner, server.ownerId);
    // Sin columnas ni títulos de columnas (v0.333): páginas, peso y fecha van chicos abajo del nombre.
    expect(document.querySelector('.project-head, .project-num')).toBeNull();
    expect(rows()).toHaveLength(3);
    const current = rowOf(p);
    expect(current.classList.contains('current')).toBe(true);
    expect(current.querySelector('.project-badge')?.textContent).toBe('Open');
    expect(rows().filter((r) => r.querySelector('.project-badge'))).toHaveLength(1);
    // Cada renglón se lee entero (nombre, datos y si es el abierto), no celda por celda.
    expect(document.getElementById(`project-option-${p}`)!.getAttribute('aria-label')).toMatch(/^My project, 0 pages · .*, Open$/);
    expect(current.querySelector('.project-meta')!.textContent).toMatch(/^0 pages · /);
  });

  it('en castellano la línea de datos sale en castellano', async () => {
    const { server, owner, p } = await workspace();
    act(() => prefs.set({ language: 'es' }));
    await openFor(owner, server.ownerId);
    expect(rowOf(p).querySelector('.project-meta')!.textContent).toMatch(/^0 páginas · /);
    expect(byText('Nuevo')).toBeDefined();
  });

  it('la estrella y el ⋯ tienen su lugar fijo en todos los renglones, también sin nada para el ⋯', async () => {
    const { server, owner, o } = await workspace();
    server.addMember('ana', 'member');
    server.grant('ana', { projectId: o }, 'view');
    const ana = await makeDevice(server, undefined, undefined, undefined, undefined, { id: 'ana' });
    devices.push(ana);
    await ana.engine.syncNow();
    await openFor(ana, 'ana');
    expect(rows().length).toBeGreaterThan(0);
    for (const row of rows()) {
      const acts = row.querySelector('.project-acts')!;
      expect(acts.children).toHaveLength(2);
      expect(acts.children[0].classList.contains('project-star')).toBe(true);
    }
    void owner;
  });
});

describe('selector: la lista y el teclado', () => {
  it('las flechas del buscador desplazan la lista hasta el renglón activo', async () => {
    const { server, owner } = await workspace();
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    try {
      await openFor(owner, server.ownerId);
      scrollIntoView.mockClear();
      const input = document.querySelector<HTMLInputElement>('.project-search input')!;
      await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      });
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
      expect((scrollIntoView.mock.contexts[0] as HTMLElement).id).toMatch(/^project-option-/);
      // El mouse (que también mueve el activo) no desplaza nada.
      scrollIntoView.mockClear();
      await act(async () => {
        rows()[2].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      });
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('un renglón al que no se le puede ofrecer nada igual guarda el lugar del ⋯ (la estrella no se corre)', async () => {
    const { server, owner, o } = await workspace();
    const page = await owner.tree.create(null, 'Solo esta página', o);
    await owner.engine.syncNow();
    server.addMember('ana', 'member');
    server.grant('ana', { pageId: page }, 'view');
    const ana = await makeDevice(server, undefined, undefined, undefined, undefined, { id: 'ana' });
    devices.push(ana);
    await ana.engine.syncNow();
    await openFor(ana, 'ana');
    const row = rowOf(o);
    expect(row.querySelector('.project-more')).toBeNull();
    expect(row.querySelector('.project-acts')!.children).toHaveLength(2);
    expect(row.querySelector('.project-acts')!.children[0].classList.contains('project-star')).toBe(true);
  });
});

describe('selector: el menú ⋯ de un renglón', () => {
  it('Tab no pasa por el ⋯ escondido de cada renglón: solo por el del renglón activo (auditoría de la v0.329)', async () => {
    const { server, owner } = await workspace();
    await openFor(owner, server.ownerId);
    const mores = [...document.querySelectorAll<HTMLButtonElement>('.project-more')];
    expect(mores.length).toBeGreaterThan(1);
    const reachable = mores.filter((b) => b.tabIndex === 0);
    expect(reachable).toHaveLength(1);
    expect(reachable[0].closest('.project-line')!.classList.contains('active')).toBe(true);
  });

  it('lista con texto lo que la persona puede hacer, en grupos, y no deja íconos sueltos en el renglón', async () => {
    const { server, owner, o } = await workspace();
    await openFor(owner, server.ownerId);
    expect(pop()).toBeNull();
    // Sin íconos de acciones en el renglón: solo la estrella y el ⋯.
    expect(rowOf(o).querySelectorAll('button:not(.project-open)')).toHaveLength(2);
    await act(async () => moreOf('Bosque Negro')!.click());
    // «Available offline…» no está: jsdom no tiene Web Locks. La base 9 no tiene color ni compartir escenas. El orden
    // (v0.333): renombrar; compartir y exportar; archivar y borrar.
    expect(popItems()).toEqual(['Rename…', 'Share…', 'Export project…', 'Archive', 'Delete…']);
    expect(pop()!.querySelector('button[aria-label="Share “Bosque Negro”"]')).not.toBeNull();
    expect(pop()!.getAttribute('role')).toBe('menu');
    expect(pop()!.querySelectorAll('[role="group"]')).toHaveLength(3);
    expect(document.querySelector('.project-pop [title]')).toBeNull();
    expect(moreOf('Bosque Negro')!.getAttribute('aria-expanded')).toBe('true');
    expect(rowOf(o).classList.contains('more-open')).toBe(true);
    // El foco entra al primer renglón.
    expect(document.activeElement?.textContent).toBe('Rename…');
  });

  it('Escape lo cierra sin cerrar el selector y el foco vuelve al ⋯', async () => {
    const { server, owner } = await workspace();
    await openFor(owner, server.ownerId);
    const more = moreOf('Bosque Negro')!;
    await act(async () => more.click());
    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(pop()).toBeNull();
    expect(document.querySelector('.project-menu')).not.toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it('tocar afuera, tocar el mismo ⋯ otra vez o recorrer la lista lo cierran; las flechas recorren sus renglones', async () => {
    const { server, owner } = await workspace();
    await openFor(owner, server.ownerId);
    const more = moreOf('Bosque Negro')!;
    await act(async () => more.click());
    await act(async () => more.click());
    expect(pop()).toBeNull();

    await act(async () => more.click());
    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(document.activeElement?.textContent).toBe('Share…');
    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    });
    // Da la vuelta: de «Rename…» sube a «Delete…».
    expect(document.activeElement?.textContent).toBe('Delete…');

    // Tocar el buscador (afuera del menú flotante) lo cierra y deja abierto el selector.
    await act(async () => {
      document.querySelector('.project-search input')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(pop()).toBeNull();
    expect(document.querySelector('.project-menu')).not.toBeNull();

    await act(async () => more.click());
    expect(pop()).not.toBeNull();
    await act(async () => {
      document.querySelector('.project-scroll')!.dispatchEvent(new Event('scroll'));
    });
    expect(pop()).toBeNull();
  });

  it('compartir un proyecto que no es el abierto abre su ventana Share (v0.333: compartir está en el ⋯ de cada uno)', async () => {
    const { server, owner } = await workspace();
    await openFor(owner, server.ownerId);
    await act(async () => moreOf('Bosque Negro')!.click());
    await act(async () => byText('Share…')!.click());
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"] h2')?.textContent).toContain('Bosque Negro'));
  });

  it('cada acción hace lo suyo: renombrar abre el formulario con el nombre, archivar pregunta en el renglón', async () => {
    const { server, owner, o } = await workspace();
    await openFor(owner, server.ownerId);
    await act(async () => moreOf('Bosque Negro')!.click());
    await act(async () => byText('Rename…')!.click());
    expect(pop()).toBeNull();
    expect(document.querySelector<HTMLInputElement>('.project-form input')!.value).toBe('Bosque Negro');
    await act(async () => byText('Back')!.click());

    await act(async () => moreOf('Bosque Negro')!.click());
    await act(async () => byText('Archive')!.click());
    expect(document.querySelector('.project-row.confirming')?.textContent).toContain('Archive “Bosque Negro”?');
    expect(pop()).toBeNull();
    void server;
    void o;
  });

  it('el único proyecto activo no se archiva ni se borra, y el renglón apagado dice por qué', async () => {
    const { server, owner, o, q } = await workspace();
    await owner.remote.setProjectArchived(o, true);
    await owner.remote.setProjectArchived(q, true);
    await owner.engine.syncNow();
    await openFor(owner, server.ownerId);
    await act(async () => moreOf('My project')!.click());
    const archive = document.querySelector<HTMLButtonElement>('.project-pop button[aria-label="Archive “My project”"]')!;
    expect(archive.getAttribute('aria-disabled')).toBe('true');
    expect(archive.getAttribute('data-tip')).toBe('This is your only active project: create or unarchive another one first');
    expect(document.querySelector('.project-pop button[aria-label="Delete “My project”…"]')!.getAttribute('aria-disabled')).toBe('true');
    // Con el teclado se llega también a lo apagado (su motivo se lee con el foco), y Tab cierra el menú.
    const ariaLabels = () => document.activeElement?.getAttribute('aria-label');
    // Rename… → Share… → Export project… → Archive.
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      });
    }
    expect(ariaLabels()).toBe('Archive “My project”');
    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    expect(pop()).toBeNull();
    await act(async () => moreOf('My project')!.click());
    // Apagado no hace nada al tocarlo (y el menú sigue abierto).
    await act(async () => archive.click());
    expect(document.querySelector('.project-row.confirming')).toBeNull();
    expect(pop()).not.toBeNull();
  });
});

describe('selector: el botón New, el pie y los archivados', () => {
  it('New reúne crear e importar; solo lo ve quien crea proyectos', async () => {
    const { server, owner, o } = await workspace();
    await openFor(owner, server.ownerId);
    const button = document.querySelector<HTMLButtonElement>('.project-new')!;
    expect(button.textContent).toBe('New');
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    await act(async () => button.click());
    expect(popItems()).toEqual(['New project', 'Import Shot Docs archive']);
    await act(async () => byText('New project')!.click());
    expect(document.querySelector('.project-form')).not.toBeNull();
    for (const r of roots.splice(0)) act(() => r.unmount());
    document.body.innerHTML = '';

    server.addMember('ana', 'member');
    server.grant('ana', { projectId: o }, 'edit_pages');
    const ana = await makeDevice(server, undefined, undefined, undefined, undefined, { id: 'ana' });
    devices.push(ana);
    await ana.engine.syncNow();
    await openFor(ana, 'ana');
    expect(document.querySelector('.project-new')).toBeNull();
  });

  it('el campo de arriba busca en todo el proyecto: escribir abre el panel de Ctrl/⌘+K con lo escrito y cierra el selector', async () => {
    const { server, owner } = await workspace();
    await openFor(owner, server.ownerId);
    const input = document.querySelector<HTMLInputElement>('.project-search input')!;
    expect(input.placeholder).toMatch(/^Search in .+…$/);
    // Vacío, las flechas siguen recorriendo los proyectos.
    expect(rows().length).toBeGreaterThan(0);
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(input, 'Zzz');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle();
    const session = searchSession(owner);
    expect(session.isOpen()).toBe(true);
    expect(session.takeInitialQuery()).toBe('Zzz');
    expect(document.querySelector('.project-menu')).toBeNull();
    act(() => session.setOpen(false));
  });

  it('solo espacios no abre el panel; en los archivados el campo sigue filtrando por nombre y no abre el panel', async () => {
    const { server, owner, o } = await workspace();
    await owner.remote.setProjectArchived(o, true);
    await owner.engine.syncNow();
    await openFor(owner, server.ownerId);
    const session = searchSession(owner);
    const write = async (value: string) => {
      const input = document.querySelector<HTMLInputElement>('.project-search input')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await settle();
    };
    await write('   ');
    expect(session.isOpen()).toBe(false);
    await act(async () => byText('Archived projects (1)')!.click());
    await write('bosque');
    expect(session.isOpen()).toBe(false);
    expect(rows()).toHaveLength(1);
    await write('zzz');
    expect(rows()).toHaveLength(0);
    expect(document.querySelector('.project-empty')!.textContent).toBe('No archived project with that name.');
  });

  it('el pie: archivos por peso y papelera (compartir está en el ⋯ de cada proyecto)', async () => {
    const { server, owner } = await workspace();
    await openFor(owner, server.ownerId);
    const foot = [...document.querySelectorAll<HTMLButtonElement>('.project-foot button')].map((b) => b.textContent);
    // Sin pesos, no hay *Files by size*.
    expect(foot).toEqual(['Trash']);
    await act(async () => byText('Trash')!.click());
    expect(document.querySelector('.trash-menu')).not.toBeNull();
  });

  it('los archivados son un renglón al final de la lista; su pantalla no tiene New ni pie y titula la fecha «Archived»', async () => {
    const { server, owner, o } = await workspace();
    await owner.remote.setProjectArchived(o, true);
    await owner.engine.syncNow();
    await openFor(owner, server.ownerId);
    const link = byText('Archived projects (1)')!;
    expect(link.closest('.project-scroll')).not.toBeNull();
    await act(async () => link.click());
    expect(rows()[0].querySelector('.project-meta')!.textContent).toMatch(/ · archived /);
    expect(rows()).toHaveLength(1);
    expect(document.querySelector('.project-new')).toBeNull();
    expect(document.querySelector('.project-foot')).toBeNull();
    // Dentro de los archivados las acciones siguen en el ⋯ (compartir, como antes; desarchivar y borrar).
    await act(async () => moreOf('Bosque Negro')!.click());
    expect(popItems()).toEqual(['Share…', 'Export project…', 'Unarchive', 'Delete…']);
  });
});
