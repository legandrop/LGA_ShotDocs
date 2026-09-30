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
import { closeFindBar, getFindUi, updateFindUi } from './findUi';
import { isSearchShortcut, searchSession, takesSearchShortcut } from './projectSearchUi';
import { Sidebar } from './Sidebar';
import { Shell } from './Workspace';

// El panel de buscar en el proyecto (Docs/Doc_Buscar.md, secciones 7 a 9, y "Cómo quedó (entrega 2)"): la
// lupa de la barra lateral, Ctrl/⌘+K (y su excepción en el editor), los resultados, el teclado, los proyectos,
// e ir a un resultado en otra página y en la misma, con la app de verdad (el árbol, la base local y el editor).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

async function until(check: () => unknown, what: string, tries = 100): Promise<void> {
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

type Block = { id: string; text?: string; caption?: string; name?: string };

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
        const paragraph = new Y.XmlElement('paragraph');
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
    // La página y su fragmento.
    expect(options()).toHaveLength(2);
    expect(active()).toBe(options()[0]);
    key(input(), { key: 'ArrowDown' });
    expect(active()).toBe(options()[1]);
    key(input(), { key: 'ArrowDown' });
    expect(active()).toBe(options()[0]);
    key(input(), { key: 'ArrowUp' });
    expect(active()).toBe(options()[1]);
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[1].id);
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
    expect(options()).toHaveLength(2);
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
