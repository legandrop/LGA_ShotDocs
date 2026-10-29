// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { settled } from '../test/settle';
import { navigate, pagePath } from '../router';
import { prefs } from '../prefs';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { Sidebar } from './Sidebar';
import { AUTO_COLLAPSE, OPEN_DELAY_MS } from './treeNav';

// El colapso automático del árbol de *Pages* (treeNav.ts, `AUTO_COLLAPSE`): al abrir una página quedan abiertas solo
// sus madres y su fila queda centrada en la barra. Y las flechas siguen en el árbol si el foco se perdió después de
// tocarlo. JSDOM no mide: cada fila mide 32 px cada 33, desde 100 px del borde de arriba de lo que se desplaza, que
// muestra 300 px.

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
let scroll = 0;
const isScroller = (el: Element) => el.classList.contains('sidebar-scroll');
/** Lo más que se puede desplazar: el alto del contenido menos lo que se ve (como el navegador). */
const maxScroll = () => Math.max(0, ROW_TOP + rows().length * ROW_STEP + 8 - VIEW);

beforeEach(() => {
  scroll = 0;
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get(this: HTMLElement) {
      return isScroller(this) ? scroll : 0;
    },
    set(this: HTMLElement, v: number) {
      if (isScroller(this)) scroll = Math.min(maxScroll(), Math.max(0, v));
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return isScroller(this) ? VIEW : 0;
    },
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const box = (top: number, height: number) =>
      ({ x: 0, y: top, top, left: 0, right: 240, bottom: top + height, width: 240, height, toJSON: () => ({}) }) as DOMRect;
    const rowBox = (el: Element) => box(ROW_TOP + rows().indexOf(el as HTMLElement) * ROW_STEP - scroll, ROW_H);
    if (isScroller(this)) return box(0, VIEW);
    if (this.classList.contains('tree-row')) return rowBox(this);
    // El `li` de una fila arranca donde ella (es su primer hijo): ahí estaría una madre sin pegarse.
    const first = this.firstElementChild;
    if (this.tagName === 'LI' && first?.classList.contains('tree-row')) return rowBox(first);
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
  act(() => prefs.set({ expandSubpages: 'onClick' }));
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

/**
 * Uno ▸ Uno.A ▸ Uno.A.1, Uno ▸ Uno.B, Dos, Tres ▸ Tres.C y, con `long`, P00 a P19 sueltas al final (más largo que la
 * barra). Abierta: Uno.A.1, con sus madres abiertas.
 */
async function app(opts: { long?: boolean; expandSubpages?: 'manual' | 'onClick' } = {}) {
  prefs.set({ expandSubpages: opts.expandSubpages ?? 'manual' });
  const d = await makeDevice(new FakeServer());
  devices.push(d);
  const uno = await d.tree.create(null, 'Uno');
  const a = await d.tree.create(uno, 'Uno.A');
  const a1 = await d.tree.create(a, 'Uno.A.1');
  const b = await d.tree.create(uno, 'Uno.B');
  const dos = await d.tree.create(null, 'Dos');
  const tres = await d.tree.create(null, 'Tres');
  const c = await d.tree.create(tres, 'Tres.C');
  const pages: string[] = [];
  if (opts.long) for (let i = 0; i < 20; i++) pages.push(await d.tree.create(null, `P${String(i).padStart(2, '0')}`));
  history.replaceState(null, '', pagePath(a1));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<ServicesContext.Provider value={services(d)}><Sidebar /></ServicesContext.Provider>));
  await until(() => rows().length > 0, 'el árbol');
  return { ids: { uno, a, a1, b, dos, tres, c }, pages };
}

const rows = () => [...document.querySelectorAll<HTMLElement>('.tree-row')];
const titles = () => rows().map((r) => r.querySelector('.title')?.textContent);
function row(title: string): HTMLElement {
  const found = rows().find((r) => r.querySelector('.title')?.textContent === title);
  if (!found) throw new Error(`no está la fila ${title}`);
  return found;
}
const path = () => location.pathname;
const focusedTitle = () => (document.activeElement as HTMLElement | null)?.closest('.tree-row')?.querySelector('.title')?.textContent;
const go = (to: string) => act(() => navigate(to));
const scroller = () => document.querySelector<HTMLElement>('.sidebar-scroll')!;
/** Dónde queda el centro de la fila, contado desde el borde de arriba de lo que se ve. */
const middleOf = (title: string) => {
  const r = row(title).getBoundingClientRect();
  return r.top + r.height / 2;
};

function press(key: string, target: EventTarget | null = document.activeElement, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target!.dispatchEvent(e);
  });
  return e;
}

/** Un clic de verdad en la fila: primero `pointerdown` y `mousedown` (lo que anota que se tocó el árbol), después `click`. */
function clickRow(title: string) {
  const el = row(title).querySelector('.title')!;
  act(() => {
    el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    // `detail` 1, como un clic del mouse (un `click()` sin mouse llega con 0).
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  });
}

it('el colapso automático está prendido (más adelante, un switch en Settings)', () => {
  expect(AUTO_COLLAPSE).toBe(true);
});

describe('al abrir una página quedan abiertas solo sus madres', () => {
  it('un link a otra rama pliega la de antes; volver despliega la suya y pliega la otra', async () => {
    const { ids } = await app();
    expect(titles()).toEqual(['Uno', 'Uno.A', 'Uno.A.1', 'Uno.B', 'Dos', 'Tres']);
    go(pagePath(ids.c));
    expect(titles()).toEqual(['Uno', 'Dos', 'Tres', 'Tres.C']);
    // Lo mismo que «‹»: la anterior vuelve con su rama, y la de Tres se pliega.
    go(pagePath(ids.a1));
    expect(titles()).toEqual(['Uno', 'Uno.A', 'Uno.A.1', 'Uno.B', 'Dos', 'Tres']);
    // Se guarda como siempre (localStorage), así una recarga lo encuentra igual.
    expect(new Set(JSON.parse(localStorage.getItem('shotdocs-expanded')!))).toEqual(new Set([ids.uno, ids.a]));
  });

  it('con atrás del navegador, igual', async () => {
    const { ids } = await app();
    go(pagePath(ids.c));
    act(() => history.back());
    await until(() => path() === pagePath(ids.a1), 'volver');
    expect(titles()).toEqual(['Uno', 'Uno.A', 'Uno.A.1', 'Uno.B', 'Dos', 'Tres']);
  });

  it('abrir una página que ya se ve no pliega nada: el colapso llega al desplegar algo (D809)', async () => {
    const { ids } = await app();
    go(pagePath(ids.a));
    go(pagePath(ids.b));
    expect(titles()).toEqual(['Uno', 'Uno.A', 'Uno.A.1', 'Uno.B', 'Dos', 'Tres']);
    // Desplegar Tres pliega lo demás de su proyecto.
    act(() => row('Tres').querySelector<HTMLButtonElement>('.toggle')!.click());
    expect(titles()).toEqual(['Uno', 'Dos', 'Tres', 'Tres.C']);
  });

  it('desplegar deja abierto lo que ya estaba abierto adentro; un clic en Manual no pliega nada', async () => {
    const { ids } = await app();
    clickRow('Dos');
    expect(path()).toBe(pagePath(ids.dos));
    expect(titles()).toEqual(['Uno', 'Uno.A', 'Uno.A.1', 'Uno.B', 'Dos', 'Tres']);
    // Plegar y volver a desplegar Uno: Uno.A, que estaba abierta adentro, sigue abierta.
    act(() => row('Uno').querySelector<HTMLButtonElement>('.toggle')!.click());
    act(() => row('Uno').querySelector<HTMLButtonElement>('.toggle')!.click());
    expect(titles()).toEqual(['Uno', 'Uno.A', 'Uno.A.1', 'Uno.B', 'Dos', 'Tres']);
  });

  it('un clic con «On click» deja abierta la página elegida y pliega lo demás', async () => {
    const { ids } = await app({ expandSubpages: 'onClick' });
    clickRow('Tres');
    expect(path()).toBe(pagePath(ids.tres));
    expect(titles()).toEqual(['Uno', 'Dos', 'Tres', 'Tres.C']);
  });

  it('con «On click», otro clic en la página abierta la pliega y el siguiente la despliega (D826)', async () => {
    const { ids } = await app({ expandSubpages: 'onClick' });
    clickRow('Tres');
    expect(titles()).toEqual(['Uno', 'Dos', 'Tres', 'Tres.C']);
    clickRow('Tres');
    expect(path()).toBe(pagePath(ids.tres));
    expect(titles()).toEqual(['Uno', 'Dos', 'Tres']);
    clickRow('Tres');
    expect(titles()).toEqual(['Uno', 'Dos', 'Tres', 'Tres.C']);
    // El segundo clic de un doble clic no la pliega.
    act(() => row('Tres').querySelector('.title')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 })));
    expect(titles()).toEqual(['Uno', 'Dos', 'Tres', 'Tres.C']);
    // Una madre desplegada que no es la abierta: el clic la abre y la deja desplegada.
    clickRow('Uno');
    clickRow('Uno.A');
    clickRow('Uno');
    expect(path()).toBe(pagePath(ids.uno));
    expect(titles()).toEqual(['Uno', 'Uno.A', 'Uno.A.1', 'Uno.B', 'Dos', 'Tres']);
  });

  it('con «Manual», otro clic en la página abierta no la pliega', async () => {
    const { ids } = await app();
    go(pagePath(ids.uno));
    clickRow('Uno');
    expect(titles()).toEqual(['Uno', 'Uno.A', 'Uno.A.1', 'Uno.B', 'Dos', 'Tres']);
  });

  it('con las flechas, salir de una rama no la pliega; desplegar la siguiente, sí (Lega, D809)', async () => {
    const { ids } = await app();
    clickRow('Uno.B');
    expect(titles()).toEqual(['Uno', 'Uno.A', 'Uno.A.1', 'Uno.B', 'Dos', 'Tres']);
    await wait(OPEN_DELAY_MS + 30);
    press('ArrowDown');
    await wait(OPEN_DELAY_MS + 30);
    press('ArrowDown');
    expect(path()).toBe(pagePath(ids.tres));
    expect(focusedTitle()).toBe('Tres');
    expect(titles()).toEqual(['Uno', 'Uno.A', 'Uno.A.1', 'Uno.B', 'Dos', 'Tres']);
    press('ArrowRight');
    expect(titles()).toEqual(['Uno', 'Dos', 'Tres', 'Tres.C']);
    expect(focusedTitle()).toBe('Tres');
    await wait(OPEN_DELAY_MS + 30);
    press('ArrowUp');
    expect(path()).toBe(pagePath(ids.dos));
    await wait(OPEN_DELAY_MS + 30);
    press('ArrowUp');
    expect(path()).toBe(pagePath(ids.uno));
    expect(focusedTitle()).toBe('Uno');
  });
});

describe('la fila de la página abierta queda centrada', () => {
  it('al abrir una página por un link, aunque ya se vea', async () => {
    const { pages } = await app({ long: true });
    go(pagePath(pages[10]));
    await wait();
    expect(middleOf('P10')).toBe(VIEW / 2);
  });

  it('con ↓ la fila sigue en el centro mientras hay lugar; abajo de todo el desplazamiento se frena y la fila baja', async () => {
    const { pages } = await app({ long: true });
    go(pagePath(pages[5]));
    await wait();
    row('P05').focus();
    for (let i = 6; i < 20; i++) {
      await wait(OPEN_DELAY_MS + 30);
      press('ArrowDown');
      const title = `P${String(i).padStart(2, '0')}`;
      expect(path()).toBe(pagePath(pages[i]));
      if (scroll < maxScroll()) expect(middleOf(title)).toBe(VIEW / 2);
    }
    expect(scroll).toBe(maxScroll());
    expect(middleOf('P19')).toBeGreaterThan(VIEW / 2);
  });

  it('arriba de todo, el desplazamiento queda en 0 y la fila arriba del centro', async () => {
    const { ids } = await app({ long: true });
    go(pagePath(ids.dos));
    await wait();
    go(pagePath(ids.uno));
    await wait();
    expect(scroll).toBe(0);
    expect(middleOf('Uno')).toBeLessThan(VIEW / 2);
  });
});

describe('las flechas siguen en el árbol si el foco se perdió después de tocarlo', () => {
  it('con el foco en el documento, ↓ abre la fila que sigue a la abierta (el navegador no desplaza la barra)', async () => {
    const { ids } = await app();
    clickRow('Uno.B');
    expect(focusedTitle()).toBe('Uno.B');
    // El foco se va al documento (la fila se volvió a dibujar, o el clic cayó en lo que se desplaza).
    act(() => (document.activeElement as HTMLElement).blur());
    expect(document.activeElement).toBe(document.body);
    await wait(OPEN_DELAY_MS + 30);
    const e = press('ArrowDown', document.body);
    expect(e.defaultPrevented).toBe(true);
    expect(path()).toBe(pagePath(ids.dos));
    expect(focusedTitle()).toBe('Dos');
  });

  it('con el foco en lo que se desplaza, igual', async () => {
    const { ids } = await app();
    clickRow('Uno.B');
    const s = scroller();
    // Hay navegadores que le dan el foco a lo que se desplaza.
    s.tabIndex = -1;
    act(() => s.focus());
    expect(document.activeElement).toBe(s);
    await wait(OPEN_DELAY_MS + 30);
    const e = press('ArrowUp', s);
    expect(e.defaultPrevented).toBe(true);
    // Desde la abierta (Uno.B), la de arriba: Uno.A.1 (abrir Uno.B, que ya se veía, no plegó Uno.A: D809).
    expect(path()).toBe(pagePath(ids.a1));
  });

  it('si lo último que se tocó no fue el árbol, las flechas no son del árbol', async () => {
    const { ids } = await app();
    clickRow('Uno.B');
    act(() => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      (document.activeElement as HTMLElement).blur();
    });
    await wait(OPEN_DELAY_MS + 30);
    const e = press('ArrowDown', document.body);
    expect(e.defaultPrevented).toBe(false);
    expect(path()).toBe(pagePath(ids.b));
  });
});
