// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { pagePath } from '../router';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { saveCollapse } from './collapseStore';
import { closeFindBar, getFindUi, hasFindTarget, openFindBarAt, updateFindUi } from './findUi';
import { isSearchShortcut, searchSession, takesSearchShortcut } from './projectSearchUi';
import { Sidebar } from './Sidebar';
import { Shell } from './Workspace';

// El panel de buscar en el proyecto (Docs/Doc_Buscar.md, secciones 7 a 9, y "Cómo quedó (entrega 2)"): la
// lupa de la barra lateral, Ctrl/⌘+K (y su excepción en el editor), los resultados, el teclado, los proyectos,
// e ir a un resultado en otra página y en la misma, con la app de verdad (el árbol, la base local y el editor).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// Con la máquina cargada (varias pruebas a la vez), el editor en jsdom tarda: topes holgados.
vi.setConfig({ testTimeout: 60_000 });

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
  // Con texto elegido, la barra de formato de BlockNote mide el rango (jsdom no lo hace).
  const empty = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) });
  Range.prototype.getClientRects ??= (() => []) as never;
  Range.prototype.getBoundingClientRect ??= empty as never;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

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
  act(() => {
    closeFindBar();
    updateFindUi({ query: '', replacement: '', expanded: false, matchCase: false, wholeWord: false });
  });
  document.body.innerHTML = '';
  history.replaceState(null, '', '/');
});

const wait = (ms = 30) => act(async () => new Promise((r) => setTimeout(r, ms)));

async function until(check: () => unknown, what: string, tries = 250): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (check()) return;
    await wait(40);
  }
  throw new Error(`no llegó: ${what}`);
}

function render(node: React.ReactNode): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(node));
  return host;
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function key(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
}

function services(device: Device, overrides: Partial<Services> = {}): Services {
  return {
    workspace: { config: { url: 'https://x.supabase.co', publishableKey: 'k', name: 'W', localKey: WANKA_LOCAL_KEY, storage: legacyStorageNames(WANKA_LOCAL_KEY) }, client: {} },
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
    ...overrides,
  } as unknown as Services;
}

type Block = { id: string; text?: string; caption?: string; name?: string; heading?: number };

/** Escribe los bloques en la página, como los deja el editor, y la cierra. */
async function edit(d: Device, pageId: string, blocks: Block[]): Promise<void> {
  const doc = await d.docs.open(pageId);
  const fragment = doc.getXmlFragment(CONTENT_FRAGMENT);
  doc.transact(() => {
    if (fragment.length === 0) fragment.insert(0, [new Y.XmlElement('blockGroup')]);
    const group = fragment.get(0) as Y.XmlElement;
    for (const b of blocks) {
      const container = new Y.XmlElement('blockContainer');
      container.setAttribute('id', b.id);
      if (b.caption !== undefined || b.name !== undefined) {
        const image = new Y.XmlElement('image');
        image.setAttribute('caption', b.caption ?? '');
        image.setAttribute('name', b.name ?? '');
        container.insert(0, [image]);
      } else {
        const paragraph = new Y.XmlElement(b.heading ? 'heading' : 'paragraph');
        if (b.heading) paragraph.setAttribute('level', b.heading as never);
        paragraph.insert(0, [new Y.XmlText(b.text ?? '')]);
        container.insert(0, [paragraph]);
      }
      group.insert(group.length, [container]);
    }
  });
  d.docs.close(pageId);
  await d.docs.flush();
}

/** La app abierta en la página A, con dos páginas con contenido. */
async function app(overrides?: (d: Device) => Partial<Services>) {
  const server = new FakeServer();
  const d = await makeDevice(server);
  devices.push(d);
  const a = await d.tree.create(null, 'Escena 1');
  await edit(d, a, [
    { id: 'a1', text: 'uno' },
    { id: 'a2', text: 'la cámara' },
    { id: 'a3', text: 'otra cámara al fondo' },
  ]);
  const b = await d.tree.create(null, 'Escena 2');
  await edit(d, b, [
    { id: 'b1', text: 'sin nada' },
    { id: 'b2', text: 'dos cámaras en B' },
    { id: 'foto', caption: 'Cámara en el set', name: 'camara.jpg' },
  ]);
  await d.engine.syncNow();
  history.replaceState(null, '', pagePath(a));
  const host = render(
    <ServicesContext.Provider value={services(d, overrides?.(d))}>
      <Shell />
    </ServicesContext.Provider>,
  );
  await until(() => host.querySelector('.bn-editor'), 'el editor');
  return { host, d, a, b };
}

const panel = () => document.querySelector<HTMLElement>('.search-panel');
const input = () => panel()!.querySelector<HTMLInputElement>('input')!;
const options = () => [...panel()!.querySelectorAll<HTMLElement>('[role="option"]')];
const active = () => panel()!.querySelector<HTMLElement>('[role="option"][aria-selected="true"]');

async function openWithKeys(target: EventTarget = document.body): Promise<KeyboardEvent> {
  const e = key(target, { key: 'k', ctrlKey: true });
  await until(panel, 'el panel');
  return e;
}

async function search(text: string): Promise<void> {
  type(input(), text);
  await until(() => panel()?.querySelector('.search-page'), `resultados de "${text}"`);
  await wait(60);
}

describe('el atajo', () => {
  it('Ctrl+K (⌘K en la Mac), sin Alt ni Shift', () => {
    const k = { altKey: false, shiftKey: false, key: 'k' };
    expect(isSearchShortcut({ ...k, ctrlKey: true, metaKey: false }, false)).toBe(true);
    expect(isSearchShortcut({ ...k, ctrlKey: false, metaKey: true }, true)).toBe(true);
    expect(isSearchShortcut({ ...k, ctrlKey: false, metaKey: true }, false)).toBe(false);
    // En la Mac, Ctrl+K pasa de largo (nunca Ctrl en la Mac).
    expect(isSearchShortcut({ ...k, ctrlKey: true, metaKey: false }, true)).toBe(false);
    expect(isSearchShortcut({ ...k, ctrlKey: true, metaKey: false, shiftKey: true }, false)).toBe(false);
    // Un teclado ruso: la tecla de la K.
    expect(isSearchShortcut({ ...k, key: 'л', code: 'KeyK', ctrlKey: true, metaKey: false }, false)).toBe(true);
  });

  it('con un diálogo o el carrete abiertos no abre', () => {
    expect(takesSearchShortcut(document.body)).toBe(true);
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    document.body.append(modal);
    expect(takesSearchShortcut(document.body)).toBe(false);
  });
});

describe('el panel', () => {
  it('Ctrl+K lo abre con el foco en el campo; busca en títulos y texto; Esc lo cierra; Ctrl+K otra vez también', async () => {
    const { host } = await app();
    const e = await openWithKeys();
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input());
    expect(input().placeholder).toBe('Search in My project');
    // Vacío: la ayuda y los proyectos.
    expect(panel()!.textContent).toContain('Type to search');
    expect(options().map((o) => o.textContent)).toEqual([expect.stringContaining('My project')]);
    await search('camara');
    const pages = [...panel()!.querySelectorAll('.search-page .search-title')].map((el) => el.textContent);
    expect(pages.sort()).toEqual(['Escena 1', 'Escena 2']);
    const marks = [...panel()!.querySelectorAll('.search-snippet mark')].map((m) => m.textContent);
    expect(marks.length).toBeGreaterThan(2);
    for (const m of marks) expect(m!.toLowerCase()).toMatch(/c[aá]mara/);
    // El pie y el nombre, con su etiqueta.
    expect(panel()!.textContent).toContain('Caption:');
    key(input(), { key: 'Escape' });
    expect(panel()).toBeNull();
    await openWithKeys();
    key(input(), { key: 'k', ctrlKey: true });
    expect(panel()).toBeNull();
    expect(host.querySelector('.shell')).not.toBeNull();
  });

  it('cada palabra en algún lado; sin resultados lo dice', async () => {
    await app();
    await openWithKeys();
    await search('escena fondo');
    expect([...panel()!.querySelectorAll('.search-page .search-title')].map((el) => el.textContent)).toEqual(['Escena 1']);
    type(input(), 'camara inexistente');
    await until(() => panel()!.textContent!.includes('No results in this project'), 'sin resultados');
  });

  it('↑ ↓ recorren páginas y fragmentos (dando la vuelta)', async () => {
    await app();
    await openWithKeys();
    await search('fondo');
    // La página, su fragmento y, al final (ningún proyecto se llama así), crear uno.
    expect(options().map((o) => o.className.match(/search-(page|snippet|create)/)?.[1])).toEqual(['page', 'snippet', 'create']);
    expect(active()).toBe(options()[0]);
    key(input(), { key: 'ArrowDown' });
    expect(active()).toBe(options()[1]);
    key(input(), { key: 'ArrowDown' });
    key(input(), { key: 'ArrowDown' });
    expect(active()).toBe(options()[0]);
    key(input(), { key: 'ArrowUp' });
    expect(active()).toBe(options()[2]);
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[2].id);
  });

  it('lista los proyectos que coinciden y elegir uno cambia de proyecto', async () => {
    const { d, host } = await app();
    await act(async () => {
      await d.tree.createProject('Wanka 2');
    });
    await openWithKeys();
    type(input(), 'wanka');
    await until(() => options().length === 1, 'solo el proyecto que coincide');
    expect(options().map((o) => o.textContent)).toEqual([expect.stringContaining('Wanka 2')]);
    expect(panel()!.querySelector('.search-project mark')?.textContent).toBe('Wanka');
    key(input(), { key: 'Enter' });
    expect(panel()).toBeNull();
    await until(() => host.querySelector('.project-button')?.textContent?.includes('Wanka 2'), 'el proyecto nuevo');
    expect(location.pathname).toBe('/');
  });

  it('la lupa de la barra lateral lo abre, también para quien no puede crear páginas', async () => {
    const server = new FakeServer();
    const d = await makeDevice(server);
    devices.push(d);
    const snapshot = { member: { role: 'member', removed_at: null }, grants: [{ id: 'g', project_id: d.tree.workspaceId, page_id: null, level: 'view' }], fetchedAt: Date.now() };
    const access = { get: () => snapshot, subscribe: () => () => undefined, getRevision: () => 1, removed: false, userId: 'viewer' };
    const value = services(d, { user: { id: 'viewer', email: 'v@test' }, access } as never);
    const host = render(
      <ServicesContext.Provider value={value}>
        <Sidebar />
      </ServicesContext.Provider>,
    );
    expect(host.querySelector('.section-title [aria-label="New page"]')).toBeNull();
    const lupa = host.querySelector<HTMLButtonElement>('.section-title .search-button')!;
    expect(lupa.getAttribute('aria-label')).toBe('Search this project (Ctrl+K)');
    act(() => lupa.click());
    expect(searchSession(value).isOpen()).toBe(true);
  });

  it('en el editor, con texto elegido, Ctrl+K es "crear un link": no abre la búsqueda', async () => {
    const { host } = await app();
    const editor = host.querySelector<HTMLElement>('.bn-editor')!;
    const paragraph = editor.querySelector('p')!;
    act(() => {
      editor.focus();
      window.getSelection()!.selectAllChildren(paragraph);
    });
    const e = key(paragraph, { key: 'k', ctrlKey: true });
    expect(e.defaultPrevented).toBe(false);
    expect(panel()).toBeNull();
    // Sin texto elegido, sí.
    act(() => window.getSelection()!.collapse(paragraph, 0));
    await openWithKeys(paragraph);
  });
});

describe('ir a un resultado', () => {
  it('en otra página: la abre con la barra en esa coincidencia, y Enter sigue', async () => {
    const { host, b } = await app();
    await openWithKeys();
    await search('camaras');
    expect(options().filter((o) => !o.classList.contains('search-create'))).toHaveLength(2);
    key(input(), { key: 'ArrowDown' });
    key(input(), { key: 'Enter' });
    expect(panel()).toBeNull();
    expect(location.pathname).toBe(pagePath(b));
    await until(() => host.querySelector('.sd-find-current'), 'la coincidencia actual');
    expect(getFindUi()).toMatchObject({ open: true, query: 'camaras', matchCase: false, wholeWord: false });
    const current = host.querySelector('.sd-find-current')!;
    expect(current.textContent).toBe('cámaras');
    expect(current.closest<HTMLElement>('[data-node-type="blockContainer"]')!.dataset.id).toBe('b2');
    expect(host.querySelector('.find-count')!.textContent).toBe('1 of 1');
    // El foco en la barra: Enter sigue por las demás.
    expect(document.activeElement).toBe(host.querySelector('.find-bar .find-input'));
  });

  it('la coincidencia justa del bloque: la segunda del bloque de la foto está en el nombre del archivo', async () => {
    const { host, b } = await app();
    await openWithKeys();
    await search('jpg camara');
    // La página (en el título no está): va a su mejor fragmento, el del nombre.
    key(input(), { key: 'Enter' });
    expect(location.pathname).toBe(pagePath(b));
    await until(() => host.querySelector('.find-count')?.textContent?.includes('of'), 'la cuenta');
    expect(getFindUi().query).toBe('camara');
    // cámaras (b2), el pie y el nombre: la actual es la tercera.
    expect(host.querySelector('.find-count')!.textContent).toBe('3 of 3');
    expect(host.querySelector('.find-status')!.textContent).toContain('in a file name');
    // Y se queda ahí: no se vuelve a buscar desde el principio un momento después.
    await wait(400);
    expect(host.querySelector('.find-count')!.textContent).toBe('3 of 3');
  });

  it('en la misma página: sin cambiar la dirección, cierra el cajón del teléfono y va a la coincidencia', async () => {
    const { host, a } = await app();
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Open pages"]')!.click());
    expect(host.querySelector('.shell')!.classList.contains('nav-open')).toBe(true);
    act(() => host.querySelector<HTMLButtonElement>('.section-title .search-button')!.click());
    await until(panel, 'el panel');
    await search('otra camara');
    key(input(), { key: 'ArrowDown' });
    key(input(), { key: 'Enter' });
    expect(location.pathname).toBe(pagePath(a));
    expect(host.querySelector('.shell')!.classList.contains('nav-open')).toBe(false);
    await until(() => host.querySelector('.sd-find-current'), 'la coincidencia actual');
    const current = host.querySelector('.sd-find-current')!;
    expect(current.closest<HTMLElement>('[data-node-type="blockContainer"]')!.dataset.id).toBe('a3');
    // La barra busca la palabra que coincidió primero en ese bloque.
    expect(getFindUi().query).toBe('otra');
    // Otra vez, a otro bloque de la misma página, con la barra ya abierta.
    await openWithKeys();
    await search('la camara');
    const snippet = options().find((o) => o.textContent === 'la cámara')!;
    act(() => snippet.click());
    await until(() => host.querySelector('.sd-find-current')?.closest<HTMLElement>('[data-node-type="blockContainer"]')?.dataset.id === 'a2', 'a2');
    expect(getFindUi().query).toBe('la');
  });

  it('un resultado del título abre la página arriba, sin barra', async () => {
    const { host, a } = await app();
    await openWithKeys();
    await search('escena 1');
    const session = searchSession({ tree: devices[0].tree, docs: devices[0].docs });
    const spy = vi.spyOn(session, 'requestResult');
    key(input(), { key: 'Enter' });
    expect(spy).toHaveBeenCalledWith({ pageId: a, term: null });
    await wait(60);
    expect(session.peekRequest()).toBeNull();
    expect(host.querySelector('.find-bar')).toBeNull();
  });
});

describe('el panel (después de la auditoría)', () => {
  it('con algo escrito no lista el proyecto abierto; la primera opción es la activa; sin proyectos que coincidan, ofrece crear uno', async () => {
    const { d, host } = await app();
    await act(async () => {
      await d.tree.createProject('Escenas extra');
    });
    await openWithKeys();
    // "My project" coincide con "my", pero es el abierto: no aparece.
    type(input(), 'my');
    await until(() => !panel()!.querySelector('.search-hint'), 'la búsqueda');
    await wait(80);
    expect(panel()!.querySelector('.search-project')).toBeNull();
    // Otro proyecto que coincide: arriba y activo (Enter cambia de proyecto).
    type(input(), 'escena');
    await until(() => panel()!.querySelector('.search-project'), 'el otro proyecto');
    expect(active()!.textContent).toContain('Escenas extra');
    // Ninguno coincide: al final, "Proyecto nuevo «…»"; con páginas que coinciden, la activa es la primera página.
    type(input(), 'camara');
    await until(() => panel()!.querySelector('.search-create'), 'crear');
    expect(active()!.classList.contains('search-page')).toBe(true);
    expect(options().at(-1)!.textContent).toBe('New project “camara”');
    // Sin nada más: Enter solo no lo crea (es para siempre); con la flecha hasta la opción, sí.
    type(input(), 'Bosque Negro');
    await until(() => options().length === 1, 'solo crear');
    expect(active()!.classList.contains('search-create')).toBe(true);
    key(input(), { key: 'Enter' });
    await wait(50);
    expect(panel()).not.toBeNull();
    expect(d.tree.projects().map((p) => p.name)).not.toContain('Bosque Negro');
    key(input(), { key: 'ArrowDown' });
    key(input(), { key: 'Enter' });
    expect(panel()).toBeNull();
    await until(() => host.querySelector('.project-button')?.textContent?.includes('Bosque Negro'), 'el proyecto nuevo');
    expect(d.tree.projects().map((p) => p.name)).toContain('Bosque Negro');
  });

  it('quien no puede crear proyectos no ve la opción', async () => {
    await app((device) => {
      const snapshot = { member: { role: 'member', removed_at: null }, grants: [{ id: 'g', project_id: device.tree.workspaceId, page_id: null, level: 'edit' }], fetchedAt: Date.now() };
      const access = { get: () => snapshot, subscribe: () => () => undefined, getRevision: () => 1, removed: false, userId: 'member' };
      return { user: { id: 'member', email: 'm@test' }, access } as never;
    });
    await openWithKeys();
    type(input(), 'nada parecido');
    await until(() => panel()!.textContent!.includes('No results'), 'sin resultados');
    expect(panel()!.querySelector('.search-create')).toBeNull();
  });

  it('"Buscando…" no parpadea: sin cambios no aparece, y con una lectura lenta aparece recién después de un rato', async () => {
    const { d } = await app();
    await openWithKeys();
    await search('camara');
    const seen: boolean[] = [];
    const observer = new MutationObserver(() => seen.push(panel()?.textContent?.includes('Searching') ?? false));
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    type(input(), 'camara escena');
    await wait(400);
    type(input(), 'camara');
    await wait(400);
    expect(seen).not.toContain(true);
    // Una página nueva que tarda en leerse.
    const slow = await act(async () => {
      const id = await d.tree.create(null, 'Lenta');
      await edit(d, id, [{ id: 'l1', text: 'cámara lenta' }]);
      return id;
    });
    const real = d.docs.indexSnapshot.bind(d.docs);
    vi.spyOn(d.docs, 'indexSnapshot').mockImplementation(async (pageId) => {
      if (pageId === slow) await new Promise((r) => setTimeout(r, 900));
      return real(pageId);
    });
    type(input(), 'camara lenta');
    await wait(200);
    expect(panel()!.textContent).not.toContain('Searching');
    await until(() => panel()!.textContent!.includes('Searching'), '"Buscando…" después de un rato');
    await until(() => panel()!.querySelector('.search-page'), 'la página lenta');
    observer.disconnect();
  });

  it('Esc en la barra de buscar deja elegida la coincidencia, y Ctrl+K sobre eso abre la búsqueda (no "link")', async () => {
    const { host } = await app();
    const editor = host.querySelector<HTMLElement>('.bn-editor')!;
    key(editor, { key: 'f', ctrlKey: true });
    const find = host.querySelector<HTMLInputElement>('.find-bar .find-input')!;
    type(find, 'otra');
    await until(() => host.querySelector('.sd-find-current'), 'la coincidencia');
    key(find, { key: 'Escape' });
    expect(host.querySelector('.find-bar')).toBeNull();
    // Primero la tecla Ctrl sola (como en un teclado de verdad): no lo olvida.
    key(editor.querySelector('p')!, { key: 'Control', ctrlKey: true });
    const e = key(editor.querySelector('p')!, { key: 'k', ctrlKey: true });
    expect(e.defaultPrevented).toBe(true);
    await until(panel, 'el panel');
    // Ctrl+K otra vez lo cierra y el foco vuelve al editor.
    key(input(), { key: 'k', ctrlKey: true });
    expect(panel()).toBeNull();
    expect(editor.contains(document.activeElement) || document.activeElement === editor).toBe(true);
  });

  it('el panel es modal: Tab no sale, Esc cierra con el foco en cualquier lado y el foco vuelve adonde estaba', async () => {
    const { host } = await app();
    const title = host.querySelector<HTMLTextAreaElement>('.page-title')!;
    act(() => title.focus());
    await openWithKeys(title);
    const close = panel()!.querySelector<HTMLButtonElement>('.search-close')!;
    key(input(), { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    key(close, { key: 'Tab' });
    expect(document.activeElement).toBe(input());
    key(input(), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(close);
    key(close, { key: 'Escape' });
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(title);
  });

  it('solo opciones y grupos adentro de la lista; la cantidad se anuncia', async () => {
    await app();
    await openWithKeys();
    await search('camara');
    const listbox = panel()!.querySelector('[role="listbox"]')!;
    const inside = [...listbox.querySelectorAll(':scope > *, [role="group"] > *')];
    for (const el of inside) {
      const ok = ['option', 'group'].includes(el.getAttribute('role') ?? '') || el.getAttribute('aria-hidden') === 'true';
      expect(ok, el.outerHTML.slice(0, 80)).toBe(true);
    }
    expect(listbox.querySelector('.search-hint, .search-notice')).toBeNull();
    expect(panel()!.querySelector('[aria-live="polite"]')!.textContent).toBe('2 pages found');
  });

  it('Ctrl+K con el selector de proyectos abierto lo cierra y abre la búsqueda', async () => {
    const { host } = await app();
    act(() => host.querySelector<HTMLButtonElement>('.project-button')!.click());
    expect(document.querySelector('.project-menu')).not.toBeNull();
    await openWithKeys();
    expect(document.querySelector('.project-menu')).toBeNull();
  });

  it('una página que todavía está bajando no pierde la coincidencia pedida al completarse', async () => {
    let missing = false;
    const { host, b } = await app((device) => {
      device.engine.prefetchPage = async () => !missing;
      device.engine.isMissingContent = async () => missing;
      return {};
    });
    missing = true;
    await openWithKeys();
    await search('jpg camara');
    key(input(), { key: 'Enter' });
    expect(location.pathname).toBe(pagePath(b));
    await until(() => host.querySelector('.find-count')?.textContent === '3 of 3', 'la coincidencia, a medio bajar');
    expect(host.querySelector('.editor-missing')).not.toBeNull();
    missing = false;
    await until(() => !host.querySelector('.editor-missing'), 'la página completa', 150);
    await until(() => host.querySelector('.find-count')?.textContent?.includes('of'), 'la cuenta otra vez');
    await wait(300);
    expect(host.querySelector('.find-count')!.textContent).toBe('3 of 3');
  }, 20_000);
});

describe('crear un proyecto desde el panel (verificación)', () => {
  it('no se ofrece mientras el índice lee ni con páginas por bajar: una página podría coincidir', async () => {
    const { d } = await app();
    await openWithKeys();
    await search('camara');
    // Una página nueva que tarda en leerse y tiene lo que se busca.
    const slow = await act(async () => {
      const id = await d.tree.create(null, 'Lenta');
      await edit(d, id, [{ id: 'l1', text: 'palabrarara' }]);
      return id;
    });
    const real = d.docs.indexSnapshot.bind(d.docs);
    vi.spyOn(d.docs, 'indexSnapshot').mockImplementation(async (pageId) => {
      if (pageId === slow) await new Promise((r) => setTimeout(r, 1200));
      return real(pageId);
    });
    type(input(), 'palabrarara');
    await wait(500);
    expect(panel()!.querySelector('.search-create')).toBeNull();
    key(input(), { key: 'ArrowDown' });
    key(input(), { key: 'Enter' });
    expect(d.tree.projects().map((p) => p.name)).not.toContain('palabrarara');
    await until(() => panel()?.querySelector('.search-page'), 'la página lenta');
    expect(panel()!.querySelector('.search-create')).not.toBeNull();
  });

  it('no se ofrece con páginas que faltan bajar', async () => {
    await app((device) => {
      const info = device.docs.states.bind(device.docs);
      // El servidor tiene más de una página que lo que bajó el dispositivo.
      vi.spyOn(device.docs, 'states').mockImplementation(async () => {
        const states = await info();
        for (const st of states.values()) st.cursor = -1;
        return states;
      });
      return {};
    });
    await openWithKeys();
    type(input(), 'nombrenuevo');
    await until(() => panel()!.textContent!.includes('Still downloading'), 'el aviso de páginas por bajar');
    expect(panel()!.querySelector('.search-create')).toBeNull();
  });

  it('con lo escrito todavía sin buscar no se ofrece (no se crea un nombre viejo ni uno a medio corregir)', async () => {
    const { d } = await app();
    await openWithKeys();
    type(input(), 'Bosquex');
    await until(() => panel()!.querySelector('.search-create'), 'crear');
    type(input(), 'Bosque');
    // Antes de que se busque lo corregido: sin la opción.
    expect(panel()!.querySelector('.search-create')).toBeNull();
    key(input(), { key: 'ArrowDown' });
    key(input(), { key: 'Enter' });
    await wait(50);
    expect(d.tree.projects().map((p) => p.name).filter((n) => n.startsWith('Bosque'))).toEqual([]);
    await until(() => panel()!.querySelector('.search-create')?.textContent === 'New project “Bosque”', 'crear "Bosque"');
  });

  it('el nombre se corta en 200 caracteres (como el selector y la base)', async () => {
    const { d, host } = await app();
    await openWithKeys();
    const long = 'x'.repeat(250);
    type(input(), long);
    await until(() => panel()!.querySelector('.search-create'), 'crear');
    act(() => panel()!.querySelector<HTMLElement>('.search-create')!.click());
    await until(() => d.tree.projects().some((p) => p.name.startsWith('xxx')), 'el proyecto');
    expect(d.tree.projects().find((p) => p.name.startsWith('xxx'))!.name).toHaveLength(200);
    expect(host.querySelector('.shell')).not.toBeNull();
  });
});

describe('lo que dejó Esc en la barra (verificación)', () => {
  async function escSelection(host: HTMLElement) {
    const editor = host.querySelector<HTMLElement>('.bn-editor')!;
    key(editor, { key: 'f', ctrlKey: true });
    const find = host.querySelector<HTMLInputElement>('.find-bar .find-input')!;
    type(find, 'otra');
    await until(() => host.querySelector('.sd-find-current'), 'la coincidencia');
    key(find, { key: 'Escape' });
    return editor;
  }

  it('un clic o una tecla en el editor lo olvida: elegir lo mismo después es de la persona (Ctrl+K = link)', async () => {
    const { host } = await app();
    const editor = await escSelection(host);
    const p = editor.querySelector('p')!;
    act(() => {
      p.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    const e = key(p, { key: 'k', ctrlKey: true });
    await wait(50);
    expect(panel()).toBeNull();
    expect(e.defaultPrevented).toBe(false);
    // Una tecla también.
    await escSelection(host);
    key(p, { key: 'ArrowLeft', shiftKey: true });
    key(p, { key: 'k', ctrlKey: true });
    await wait(50);
    expect(panel()).toBeNull();
  });

  it('con un diálogo abierto no abre la búsqueda', async () => {
    const { host } = await app();
    const editor = await escSelection(host);
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    document.body.append(modal);
    key(editor.querySelector('p')!, { key: 'k', ctrlKey: true });
    await wait(50);
    expect(panel()).toBeNull();
  });
});

describe('la coincidencia pedida (verificación)', () => {
  it('es de una página: otra no la usa; cambiar lo buscado o cerrar la barra la descarta', () => {
    act(() => openFindBarAt('camara', { pageId: 'A', blockId: 'b', occurrence: 1 }, { focus: false }));
    expect(hasFindTarget('B')).toBe(false);
    expect(hasFindTarget('A')).toBe(true);
    act(() => updateFindUi({ query: 'otra cosa' }));
    expect(hasFindTarget('A')).toBe(false);
    act(() => openFindBarAt('camara', { pageId: 'A', blockId: 'b', occurrence: 1 }, { focus: false }));
    act(() => closeFindBar());
    expect(hasFindTarget('A')).toBe(false);
  });
});

describe('con secciones colapsadas (P.11)', () => {
  it('ir a un resultado escondido en una sección colapsada la abre para vos y queda en la coincidencia', async () => {
    // jsdom dice que no sabe `:has()`: se hace de cuenta que sí (como en collapsePage.test.tsx).
    const realCSS = globalThis.CSS;
    vi.stubGlobal('CSS', {
      escape: (v: string) => realCSS.escape(v),
      supports: (q: string, v?: string) => (q.includes(':has(') ? true : v === undefined ? realCSS.supports(q) : realCSS.supports(q, v)),
    });
    try {
      const { host, d } = await app();
      const hidden = await act(async () => {
        const id = await d.tree.create(null, 'Colapsada');
        await edit(d, id, [
          { id: 'h1', text: 'Título', heading: 1 },
          { id: 'c1', text: 'arriba' },
          { id: 'c2', text: 'la grúa escondida' },
          { id: 'h2', text: 'Otro título', heading: 1 },
        ]);
        await saveCollapse(d.db, id, new Map([['h1', { c: true, g: null }]]));
        return id;
      });
      // La página abre con la sección colapsada (lo de adentro, escondido).
      const { navigate } = await import('../router');
      act(() => navigate(pagePath(hidden)));
      await until(() => host.querySelector('.bn-block-content.sd-collapsed-hidden'), 'la sección colapsada');
      act(() => navigate(pagePath(devices[0].tree.roots(devices[0].tree.workspaceId)[0].id)));
      await until(() => !host.querySelector('.sd-collapsed-hidden') && host.querySelector('.bn-editor'), 'otra página');
      await openWithKeys();
      await search('grua');
      const snippet = options().find((o) => o.classList.contains('search-snippet'))!;
      act(() => snippet.click());
      expect(location.pathname).toBe(pagePath(hidden));
      await until(() => host.querySelector('.sd-find-current'), 'la coincidencia');
      const current = host.querySelector('.sd-find-current')!;
      const block = current.closest<HTMLElement>('[data-node-type="blockContainer"]')!;
      expect(block.dataset.id).toBe('c2');
      // La sección se abrió: el bloque ya no está escondido.
      await until(() => !block.querySelector('.bn-block-content.sd-collapsed-hidden'), 'la sección abierta');
      expect(host.querySelector('.find-count')!.textContent).toBe('1 of 1');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('el pedido de ir a un resultado', () => {
  it('es de cada instancia de servicios, lo toma solo esa página, una vez, y vence', async () => {
    const d = await makeDevice(new FakeServer());
    devices.push(d);
    const other = await makeDevice(new FakeServer());
    devices.push(other);
    const session = searchSession(d);
    expect(searchSession(d)).toBe(session);
    expect(searchSession(other)).not.toBe(session);
    session.requestResult({ pageId: 'p1', term: 'camara', blockId: 'b', occurrence: 2 });
    expect(searchSession(other).peekRequest()).toBeNull();
    expect(session.takeRequest('p2')).toBeNull();
    expect(session.takeRequest('p1')).toEqual({ pageId: 'p1', term: 'camara', blockId: 'b', occurrence: 2 });
    expect(session.takeRequest('p1')).toBeNull();
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000);
    session.requestResult({ pageId: 'p1', term: null });
    now.mockReturnValue(1_000 + 61_000);
    expect(session.takeRequest('p1')).toBeNull();
    now.mockRestore();
  });
});
