// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { settled } from '../test/settle';
import { navigate, pagePath } from '../router';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { Sidebar } from './Sidebar';
import { Shell } from './Workspace';

// La fila de la página abierta queda a la vista en el árbol cuando la página se abre por otro camino que el árbol
// (un link del editor, la búsqueda, el breadcrumb, atrás y adelante, la dirección). Un clic o el teclado en
// el árbol no lo desplazan. JSDOM no mide: cada fila mide 32 px cada 33, a partir de 100 px desde arriba de la
// barra lateral, que muestra 300 px y se desplaza con `scrollTop`.

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
  const empty = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) });
  Range.prototype.getClientRects ??= (() => []) as never;
  Range.prototype.getBoundingClientRect ??= empty as never;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

const VIEW = 300;
const ROW_TOP = 100;
const ROW_STEP = 33;
const ROW_H = 32;
// El desplazamiento de la barra lateral y cada vez que alguien lo cambió.
let scroll = 0;
let writes: number[] = [];
const isSidebar = (el: Element) => el.classList.contains('sidebar');

beforeEach(() => {
  scroll = 0;
  writes = [];
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get(this: HTMLElement) {
      return isSidebar(this) ? scroll : 0;
    },
    set(this: HTMLElement, v: number) {
      if (!isSidebar(this)) return;
      writes.push(v);
      scroll = Math.max(0, v);
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return isSidebar(this) ? VIEW : 0;
    },
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const box = (top: number, height: number) =>
      ({ x: 0, y: top, top, left: 0, right: 240, bottom: top + height, width: 240, height, toJSON: () => ({}) }) as DOMRect;
    if (isSidebar(this)) return box(0, VIEW);
    if (this.classList.contains('tree-row')) return box(ROW_TOP + rows().indexOf(this as HTMLElement) * ROW_STEP - scroll, ROW_H);
    return box(0, 0);
  });
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
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as { scrollTop?: number }).scrollTop;
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  document.body.innerHTML = '';
  localStorage.clear();
  history.replaceState(null, '', '/');
});

const wait = (ms = 30) => act(() => settled(ms));

async function until(check: () => unknown, what: string, tries = 250): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (check()) return;
    await wait(40);
  }
  throw new Error(`no llegó: ${what}`);
}

function services(device: Device): Services {
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
  } as unknown as Services;
}

/** P00 a P29 en el primer nivel y, al final, Lejos ▸ Lejos.A ▸ Lejos.A.1 (cerradas). Abierta: P00 o Lejos.A.1. */
async function app(opts: { open?: 'top' | 'far'; shell?: boolean } = {}) {
  const server = new FakeServer();
  const d = await makeDevice(server);
  devices.push(d);
  const pages: string[] = [];
  for (let i = 0; i < 30; i++) pages.push(await d.tree.create(null, `P${String(i).padStart(2, '0')}`));
  const lejos = await d.tree.create(null, 'Lejos');
  const lejosA = await d.tree.create(lejos, 'Lejos.A');
  const far = await d.tree.create(lejosA, 'Lejos.A.1');
  history.replaceState(null, '', pagePath(opts.open === 'far' ? far : pages[0]));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(<ServicesContext.Provider value={services(d)}>{opts.shell ? <Shell /> : <Sidebar />}</ServicesContext.Provider>),
  );
  await until(() => rows().length > 0, 'el árbol');
  return { host, pages, lejos, lejosA, far };
}

const rows = () => [...document.querySelectorAll<HTMLElement>('.tree-row')];
function row(title: string): HTMLElement {
  const found = rows().find((r) => r.querySelector('.title')?.textContent === title);
  if (!found) throw new Error(`no está la fila ${title}`);
  return found;
}
const path = () => location.pathname;
/** La fila se ve entera en los 300 px de la barra lateral. */
function inView(title: string): boolean {
  const r = row(title).getBoundingClientRect();
  return r.top >= 0 && r.bottom <= VIEW;
}

function go(path: string) {
  act(() => navigate(path));
}

describe('la fila de la página abierta queda a la vista', () => {
  it('un link a una página lejana abre sus madres y desplaza el árbol hasta su fila', async () => {
    const { far } = await app();
    expect(writes).toEqual([]);
    go(pagePath(far));
    await until(() => rows().some((r) => r.querySelector('.title')?.textContent === 'Lejos.A.1'), 'abrir sus madres');
    await wait();
    expect(row('Lejos').getAttribute('aria-expanded')).toBe('true');
    expect(inView('Lejos.A.1')).toBe(true);
    // Un solo desplazamiento, lo justo: pegada al borde de abajo con 8 px de aire.
    expect(writes).toHaveLength(1);
    expect(row('Lejos.A.1').getBoundingClientRect().bottom).toBe(VIEW - 8);
  });

  it('si la fila ya se ve, no se mueve nada', async () => {
    const { pages } = await app();
    go(pagePath(pages[3]));
    await wait();
    expect(path()).toBe(pagePath(pages[3]));
    expect(writes).toEqual([]);
  });

  it('una página de más arriba, fuera de la vista, también: pegada al borde de arriba', async () => {
    const { pages, far } = await app({ open: 'far' });
    await until(() => inView('Lejos.A.1'), 'la abierta al cargar');
    writes = [];
    go(pagePath(pages[20]));
    await wait();
    expect(inView('P20')).toBe(true);
    expect(row('P20').getBoundingClientRect().top).toBe(8);
    expect(writes).toHaveLength(1);
    expect(path()).not.toBe(pagePath(far));
  });

  it('una de la primera pantalla vuelve el árbol al principio, con su encabezado', async () => {
    const { pages } = await app({ open: 'far' });
    await until(() => inView('Lejos.A.1'), 'la abierta al cargar');
    go(pagePath(pages[1]));
    await wait();
    expect(inView('P01')).toBe(true);
    expect(scroll).toBe(0);
  });

  it('al abrir la app con la dirección de una página lejana', async () => {
    await app({ open: 'far' });
    await until(() => rows().some((r) => r.querySelector('.title')?.textContent === 'Lejos.A.1'), 'sus madres');
    await wait();
    expect(inView('Lejos.A.1')).toBe(true);
  });

  it('atrás del navegador vuelve a llevar la fila a la vista', async () => {
    const { pages, far } = await app();
    go(pagePath(far));
    await until(() => inView('Lejos.A.1'), 'la lejana');
    go(pagePath(pages[0]));
    await wait();
    expect(inView('P00')).toBe(true);
    writes = [];
    act(() => history.back());
    await until(() => path() === pagePath(far), 'volver atrás');
    await wait();
    expect(inView('Lejos.A.1')).toBe(true);
    expect(writes).toHaveLength(1);
  });

  it('en el teléfono con el cajón cerrado queda desplazado para cuando se abra', async () => {
    const { host, far } = await app({ shell: true });
    await until(() => host.querySelector('.bn-editor'), 'el editor');
    expect(host.querySelector('.shell.nav-open')).toBeNull();
    go(pagePath(far));
    await until(() => rows().some((r) => r.querySelector('.title')?.textContent === 'Lejos.A.1'), 'sus madres');
    await wait();
    expect(host.querySelector('.shell.nav-open')).toBeNull();
    expect(inView('Lejos.A.1')).toBe(true);
  });
});

describe('la persona que desplaza el árbol a mano', () => {
  const scrollByHand = () => act(() => void document.querySelector('.sidebar')!.dispatchEvent(new Event('scroll')));

  it('no pierde su desplazamiento: la fila se lleva a la vista cuando frena', async () => {
    const { far } = await app();
    // Reloj quieto mientras se mira: la espera de la app no depende de qué tan cargada esté la máquina.
    const t0 = Date.now() + 1000;
    const now = vi.spyOn(Date, 'now').mockReturnValue(t0);
    scrollByHand();
    go(pagePath(far));
    await until(() => rows().some((r) => r.querySelector('.title')?.textContent === 'Lejos.A.1'), 'sus madres');
    await wait();
    // Recién desplazó: el árbol no se toca.
    expect(writes).toEqual([]);
    expect(inView('Lejos.A.1')).toBe(false);
    // Frena: ahora sí, una sola vez.
    now.mockReturnValue(t0 + 300);
    await act(() => settled(260));
    expect(inView('Lejos.A.1')).toBe(true);
    expect(writes).toHaveLength(1);
  });
});

describe('lo que abre el árbol mismo no lo desplaza', () => {
  // P06 se ve a medias: de 298 a 330 px, con 300 a la vista.
  it('un clic en una fila que se ve a medias', async () => {
    const { pages } = await app();
    expect(inView('P06')).toBe(false);
    act(() => row('P06').click());
    await wait();
    expect(path()).toBe(pagePath(pages[6]));
    expect(writes).toEqual([]);
  });

  it('Enter en una fila que se ve a medias', async () => {
    const { pages } = await app();
    act(() => row('P06').focus());
    act(() => {
      row('P06').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    await wait();
    expect(path()).toBe(pagePath(pages[6]));
    expect(writes).toEqual([]);
  });

  it('después de un clic del árbol, un link vuelve a desplazar', async () => {
    const { pages, far } = await app();
    act(() => row('P06').click());
    await wait();
    expect(path()).toBe(pagePath(pages[6]));
    go(pagePath(far));
    await until(() => rows().some((r) => r.querySelector('.title')?.textContent === 'Lejos.A.1'), 'sus madres');
    await wait();
    expect(inView('Lejos.A.1')).toBe(true);
  });
});
