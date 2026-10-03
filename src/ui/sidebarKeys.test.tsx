// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { navigate, pagePath } from '../router';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { Sidebar } from './Sidebar';
import { OPEN_DELAY_MS } from './treeNav';
import { Shell } from './Workspace';

// El árbol de páginas con el teclado (patrón de árbol de WAI-ARIA) y plegar una madre de la página abierta, con
// la barra lateral de verdad contra el árbol y la base local en memoria.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// Las del Shell montan el editor: con la máquina cargada, en jsdom tarda.
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
  document.body.innerHTML = '';
  localStorage.clear();
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
 * Uno ▸ Uno.A ▸ Uno.A.1, Uno ▸ Uno.B, Dos (sin subpáginas), Tres ▸ Tres.C. La página abierta es `open` (Uno.A.1
 * si no se dice): sus madres se abren solas, Tres queda cerrada.
 */
async function app(opts: { open?: 'a1' | 'none'; shell?: boolean; slash?: boolean; shared?: boolean } = {}) {
  const server = new FakeServer();
  const d = await makeDevice(server);
  devices.push(d);
  const uno = await d.tree.create(null, 'Uno');
  const a = await d.tree.create(uno, 'Uno.A');
  const a1 = await d.tree.create(a, 'Uno.A.1');
  const b = await d.tree.create(uno, 'Uno.B');
  const dos = await d.tree.create(null, 'Dos');
  const tres = await d.tree.create(null, 'Tres');
  const c = await d.tree.create(tres, 'Tres.C');
  const ids = { uno, a, a1, b, dos, tres, c };
  if (opts.shared) {
    // Una rama compartida: la madre real de Uno.A no está entre las páginas que la persona puede ver.
    await d.engine.syncNow();
    const all = Object.values(ids).map((id) => d.tree.get(id)!);
    await d.tree.setSnapshot(all.filter((p) => p.id !== uno && p.id !== b));
  }
  // `/p/<id>/` (con barra al final) también es la página.
  history.replaceState(null, '', opts.open === 'none' ? '/' : pagePath(a1) + (opts.slash ? '/' : ''));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(<ServicesContext.Provider value={services(d)}>{opts.shell ? <Shell /> : <Sidebar />}</ServicesContext.Provider>),
  );
  return { host, d, ids, root };
}

const rows = () => [...document.querySelectorAll<HTMLElement>('.tree-row')];
const titles = () => rows().map((r) => r.querySelector('.title')?.textContent);
function row(title: string): HTMLElement {
  const found = rows().find((r) => r.querySelector('.title')?.textContent === title);
  if (!found) throw new Error(`no está la fila ${title}`);
  return found;
}
const focusedTitle = () => (document.activeElement as HTMLElement | null)?.closest('.tree-row')?.querySelector('.title')?.textContent;
const path = () => location.pathname;
const expandedOf = (title: string) => row(title).getAttribute('aria-expanded');

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget | null = document.activeElement): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target!.dispatchEvent(e);
  });
  return e;
}

function focusRow(title: string) {
  act(() => row(title).focus());
}

describe('↑ y ↓', () => {
  it('cliquear una fila la abre y deja el foco en ella; ↓ y ↑ abren la siguiente y la anterior visibles, con el foco en el árbol', async () => {
    const { ids } = await app();
    expect(titles()).toEqual(['Uno', 'Uno.A', 'Uno.A.1', 'Uno.B', 'Dos', 'Tres']);
    act(() => row('Uno.B').click());
    expect(path()).toBe(pagePath(ids.b));
    expect(focusedTitle()).toBe('Uno.B');
    // Espera a que pase la ventana de "pulsaciones seguidas": cada pulsación suelta abre al instante.
    await wait(OPEN_DELAY_MS + 30);
    const e = press('ArrowDown');
    expect(e.defaultPrevented).toBe(true);
    expect(focusedTitle()).toBe('Dos');
    expect(path()).toBe(pagePath(ids.dos));
    await wait(OPEN_DELAY_MS + 30);
    // Las subpáginas de una cerrada (Tres) no cuentan; las de una abierta, sí.
    press('ArrowDown');
    expect(path()).toBe(pagePath(ids.tres));
    await wait(OPEN_DELAY_MS + 30);
    press('ArrowUp');
    expect(path()).toBe(pagePath(ids.dos));
    await wait(OPEN_DELAY_MS + 30);
    press('ArrowUp');
    expect(focusedTitle()).toBe('Uno.B');
    expect(path()).toBe(pagePath(ids.b));
    await wait(OPEN_DELAY_MS + 30);
    press('ArrowUp');
    expect(focusedTitle()).toBe('Uno.A.1');
    expect(path()).toBe(pagePath(ids.a1));
  });

  it('en la primera y en la última no hacen nada', async () => {
    const { ids } = await app();
    focusRow('Uno');
    press('ArrowUp');
    expect(focusedTitle()).toBe('Uno');
    expect(path()).toBe(pagePath(ids.a1));
    focusRow('Tres');
    press('ArrowDown');
    expect(focusedTitle()).toBe('Tres');
    expect(path()).toBe(pagePath(ids.a1));
  });

  it('con la tecla apretada el foco corre y se abre solo la última, al frenar', async () => {
    const { ids } = await app();
    focusRow('Uno');
    press('ArrowDown', { repeat: true });
    press('ArrowDown', { repeat: true });
    press('ArrowDown', { repeat: true });
    press('ArrowDown', { repeat: true });
    expect(focusedTitle()).toBe('Dos');
    // Todavía no abrió ninguna de las del camino.
    expect(path()).toBe(pagePath(ids.a1));
    await until(() => path() === pagePath(ids.dos), 'abrir la última');
    await wait(OPEN_DELAY_MS + 30);
    expect(path()).toBe(pagePath(ids.dos));
  });

  it('Inicio y Fin van a la primera y a la última visibles; Enter abre la del foco', async () => {
    const { ids } = await app();
    focusRow('Uno.B');
    press('End');
    expect(focusedTitle()).toBe('Tres');
    await until(() => path() === pagePath(ids.tres), 'abrir Tres');
    await wait(OPEN_DELAY_MS + 30);
    press('Home');
    expect(focusedTitle()).toBe('Uno');
    await until(() => path() === pagePath(ids.uno), 'abrir Uno');
    focusRow('Dos');
    press('Enter');
    expect(path()).toBe(pagePath(ids.dos));
    // Espacio, igual (y no desplaza la barra lateral).
    focusRow('Tres');
    const e = press(' ');
    expect(e.defaultPrevented).toBe(true);
    expect(path()).toBe(pagePath(ids.tres));
  });
});

describe('lo que las flechas iban a abrir', () => {
  /** Con la tecla apretada desde Uno: el foco en Uno.A y esa página por abrirse. */
  async function pending() {
    const made = await app();
    focusRow('Uno');
    press('ArrowDown', { repeat: true });
    expect(focusedTitle()).toBe('Uno.A');
    expect(path()).toBe(pagePath(made.ids.a1));
    return made;
  }

  it('un clic en otra fila lo anula', async () => {
    const { ids } = await pending();
    act(() => row('Dos').click());
    await wait(OPEN_DELAY_MS + 60);
    expect(path()).toBe(pagePath(ids.dos));
  });

  it('abrir otra página por un link lo anula', async () => {
    const { ids } = await pending();
    act(() => navigate(pagePath(ids.c)));
    await wait(OPEN_DELAY_MS + 60);
    expect(path()).toBe(pagePath(ids.c));
  });

  it('al desmontar la barra lateral no queda nada por abrirse', async () => {
    const { ids, root } = await pending();
    act(() => root.unmount());
    roots.splice(roots.indexOf(root), 1);
    await wait(OPEN_DELAY_MS + 60);
    expect(path()).toBe(pagePath(ids.a1));
  });

  it('si el foco sale del árbol (un clic en el editor), la página no cambia bajo el cursor', async () => {
    const { ids } = await pending();
    const outside = document.createElement('input');
    document.body.append(outside);
    act(() => outside.focus());
    await wait(OPEN_DELAY_MS + 60);
    expect(path()).toBe(pagePath(ids.a1));
  });

  it('sin página abierta, ir a otra dirección (la vieja de la papelera) lo anula', async () => {
    await app({ open: 'none' });
    focusRow('Uno');
    press('ArrowDown', { repeat: true });
    expect(focusedTitle()).toBe('Dos');
    act(() => navigate('/trash'));
    expect(path()).toBe('/trash');
    await wait(OPEN_DELAY_MS + 60);
    expect(path()).toBe('/trash');
  });

  it('plegar la fila del foco antes de que se abra: se abre igual', async () => {
    const { ids } = await app();
    act(() => row('Dos').click());
    await wait(OPEN_DELAY_MS + 30);
    focusRow('Uno');
    press('ArrowDown', { repeat: true });
    expect(focusedTitle()).toBe('Uno.A');
    press('ArrowLeft');
    expect(titles()).toEqual(['Uno', 'Uno.A', 'Uno.B', 'Dos', 'Tres']);
    await wait(OPEN_DELAY_MS + 60);
    // Antes quedaba Dos abierta con el foco en Uno.A.
    expect(path()).toBe(pagePath(ids.a));
    expect(focusedTitle()).toBe('Uno.A');
  });

  it('plegar con el triángulo una madre de lo que se iba a abrir: se abre esa madre', async () => {
    const { ids } = await app();
    act(() => row('Dos').click());
    await wait(OPEN_DELAY_MS + 30);
    focusRow('Uno.A');
    press('ArrowDown', { repeat: true });
    expect(focusedTitle()).toBe('Uno.A.1');
    act(() => row('Uno').querySelector<HTMLButtonElement>('.toggle')!.click());
    await wait(OPEN_DELAY_MS + 60);
    expect(titles()).toEqual(['Uno', 'Dos', 'Tres']);
    expect(path()).toBe(pagePath(ids.uno));
    expect(focusedTitle()).toBe('Uno');
  });
});

describe('la fila con el foco desaparece', () => {
  it('el foco pasa a la fila visible que sigue, o a la anterior si era la última', async () => {
    const { d, ids } = await app();
    focusRow('Dos');
    await act(async () => d.tree.trash(ids.dos));
    expect(titles()).toEqual(['Uno', 'Uno.A', 'Uno.A.1', 'Uno.B', 'Tres']);
    expect(focusedTitle()).toBe('Tres');
    await act(async () => d.tree.trash(ids.tres));
    expect(focusedTitle()).toBe('Uno.B');
    // Las flechas siguen respondiendo.
    press('ArrowUp');
    expect(focusedTitle()).toBe('Uno.A.1');
    // Movida adentro de una cerrada: igual.
    focusRow('Uno.B');
    act(() => row('Uno.A').querySelector<HTMLButtonElement>('.toggle')!.click());
    focusRow('Uno.B');
    await act(async () => d.tree.move(ids.b, ids.a));
    expect(titles()).toEqual(['Uno', 'Uno.A']);
    expect(focusedTitle()).toBe('Uno.A');
  });

  it('con el foco fuera del árbol, no se lo trae', async () => {
    const { d, ids } = await app();
    const outside = document.createElement('input');
    document.body.append(outside);
    focusRow('Dos');
    act(() => outside.focus());
    await act(async () => d.tree.trash(ids.dos));
    expect(document.activeElement).toBe(outside);
    // Y sin foco en ningún lado, tampoco.
    act(() => outside.blur());
    await act(async () => d.tree.trash(ids.tres));
    expect(document.activeElement).toBe(document.body);
  });
});

describe('una rama compartida', () => {
  it('la madre real no se ve: la rama está en el primer nivel y ← no sale de ella', async () => {
    const { ids } = await app({ shared: true });
    expect(titles()).toEqual(['Uno.A', 'Uno.A.1', 'Dos', 'Tres']);
    expect(row('Uno.A').getAttribute('aria-level')).toBe('1');
    focusRow('Uno.A.1');
    await wait(OPEN_DELAY_MS + 30);
    press('ArrowLeft');
    expect(focusedTitle()).toBe('Uno.A');
    expect(path()).toBe(pagePath(ids.a));
    // Plegada, en el primer nivel: nada (no hay madre a la vista).
    press('ArrowLeft');
    expect(titles()).toEqual(['Uno.A', 'Dos', 'Tres']);
    await wait(OPEN_DELAY_MS + 30);
    press('ArrowLeft');
    expect(focusedTitle()).toBe('Uno.A');
    expect(path()).toBe(pagePath(ids.a));
  });
});

describe('→ y ←', () => {
  it('→: cerrada con subpáginas la abre sin cambiar de página; abierta pasa a la primera subpágina; sin subpáginas, nada', async () => {
    const { ids } = await app();
    focusRow('Tres');
    expect(expandedOf('Tres')).toBe('false');
    press('ArrowRight');
    expect(expandedOf('Tres')).toBe('true');
    expect(focusedTitle()).toBe('Tres');
    expect(path()).toBe(pagePath(ids.a1));
    press('ArrowRight');
    expect(focusedTitle()).toBe('Tres.C');
    await until(() => path() === pagePath(ids.c), 'abrir Tres.C');
    focusRow('Dos');
    press('ArrowRight');
    expect(focusedTitle()).toBe('Dos');
    expect(path()).toBe(pagePath(ids.c));
  });

  it('←: abierta la cierra; cerrada o sin subpáginas va a su madre y la abre; en el primer nivel sin nada que cerrar, nada', async () => {
    const { ids } = await app({ open: 'none' });
    // Sin página abierta, todo arranca cerrado.
    expect(titles()).toEqual(['Uno', 'Dos', 'Tres']);
    focusRow('Tres');
    press('ArrowRight');
    expect(expandedOf('Tres')).toBe('true');
    press('ArrowLeft');
    expect(expandedOf('Tres')).toBe('false');
    expect(path()).toBe('/');
    // En el primer nivel, cerrada: nada.
    press('ArrowLeft');
    expect(focusedTitle()).toBe('Tres');
    expect(path()).toBe('/');
    focusRow('Dos');
    press('ArrowLeft');
    expect(path()).toBe('/');
    // Una subpágina sin subpáginas: a su madre, que pasa a ser la página abierta, con el foco.
    focusRow('Uno');
    press('ArrowRight');
    press('ArrowRight');
    expect(focusedTitle()).toBe('Uno.A');
    await wait(OPEN_DELAY_MS + 30);
    press('ArrowDown');
    expect(focusedTitle()).toBe('Uno.B');
    await wait(OPEN_DELAY_MS + 30);
    press('ArrowLeft');
    expect(focusedTitle()).toBe('Uno');
    await until(() => path() === pagePath(ids.uno), 'abrir Uno');
    // Una subpágina cerrada con subpáginas: también a su madre.
    focusRow('Uno.A');
    expect(expandedOf('Uno.A')).toBe('false');
    await wait(OPEN_DELAY_MS + 30);
    press('ArrowLeft');
    expect(focusedTitle()).toBe('Uno');
    expect(expandedOf('Uno')).toBe('true');
  });
});

describe('plegar una madre de la página abierta (el defecto)', () => {
  it('con el mouse: se pliega y la página abierta pasa a ser ella, con el foco en su fila', async () => {
    const { ids } = await app();
    expect(path()).toBe(pagePath(ids.a1));
    act(() => row('Uno').querySelector<HTMLButtonElement>('.toggle')!.click());
    await wait();
    // Antes del arreglo, el efecto que abre las madres de la página abierta la volvía a abrir.
    expect(titles()).toEqual(['Uno', 'Dos', 'Tres']);
    expect(path()).toBe(pagePath(ids.uno));
    expect(focusedTitle()).toBe('Uno');
    // Una madre intermedia, igual (Uno.A quedó abierta adentro de Uno).
    act(() => row('Uno').querySelector<HTMLButtonElement>('.toggle')!.click());
    act(() => row('Uno.A.1').click());
    expect(path()).toBe(pagePath(ids.a1));
    act(() => row('Uno.A').querySelector<HTMLButtonElement>('.toggle')!.click());
    await wait();
    expect(titles()).toEqual(['Uno', 'Uno.A', 'Uno.B', 'Dos', 'Tres']);
    expect(path()).toBe(pagePath(ids.a));
  });

  it('con ←: igual', async () => {
    const { ids } = await app();
    focusRow('Uno');
    press('ArrowLeft');
    await wait();
    expect(titles()).toEqual(['Uno', 'Dos', 'Tres']);
    expect(path()).toBe(pagePath(ids.uno));
    expect(focusedTitle()).toBe('Uno');
  });

  it('plegar una que no es madre de la abierta no cambia de página', async () => {
    const { ids } = await app();
    act(() => row('Tres').querySelector<HTMLButtonElement>('.toggle')!.click());
    expect(expandedOf('Tres')).toBe('true');
    act(() => row('Tres').querySelector<HTMLButtonElement>('.toggle')!.click());
    expect(expandedOf('Tres')).toBe('false');
    expect(path()).toBe(pagePath(ids.a1));
    expect(focusedTitle()).toBe('Tres');
  });

  it('abrir una página profunda por otro camino (un link, la búsqueda, al cargar) sigue abriendo sus madres', async () => {
    const { ids } = await app();
    act(() => row('Uno').querySelector<HTMLButtonElement>('.toggle')!.click());
    expect(titles()).toEqual(['Uno', 'Dos', 'Tres']);
    act(() => navigate(pagePath(ids.a1)));
    await wait();
    expect(titles()).toEqual(['Uno', 'Uno.A', 'Uno.A.1', 'Uno.B', 'Dos', 'Tres']);
    act(() => navigate(pagePath(ids.c)));
    await wait();
    expect(expandedOf('Tres')).toBe('true');
    expect(row('Tres.C').getAttribute('aria-current')).toBe('page');
  });
});

describe('no pisa otros atajos', () => {
  it('con Ctrl, ⌘, Alt o Shift las flechas no hacen nada', async () => {
    const { ids } = await app();
    focusRow('Uno.A.1');
    for (const mod of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey'] as const) {
      for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End']) {
        const e = press(key, { [mod]: true });
        expect(e.defaultPrevented).toBe(false);
      }
    }
    await wait(OPEN_DELAY_MS + 30);
    expect(focusedTitle()).toBe('Uno.A.1');
    expect(path()).toBe(pagePath(ids.a1));
    expect(expandedOf('Uno.A')).toBe('true');
  });

  it('en el renombrado de una fila y en los botones de la fila, las flechas son de ellos', async () => {
    const { ids } = await app();
    act(() => row('Uno.B').querySelector<HTMLButtonElement>('[aria-label="More actions"]')!.click());
    const rename = [...document.querySelectorAll<HTMLButtonElement>('.menu button')].find((b) => b.textContent?.includes('Rename'));
    act(() => rename!.click());
    const input = document.querySelector<HTMLInputElement>('.tree-row .rename')!;
    expect(document.activeElement).toBe(input);
    press('ArrowDown', {}, input);
    press('ArrowLeft', {}, input);
    expect(document.activeElement).toBe(input);
    expect(path()).toBe(pagePath(ids.a1));
    // Enter guarda y el foco vuelve a la fila: las flechas siguen.
    press('Enter', {}, input);
    expect(focusedTitle()).toBe('Uno.B');
    const more = row('Dos').querySelector<HTMLButtonElement>('[aria-label="More actions"]')!;
    act(() => more.focus());
    press('ArrowDown', {}, more);
    expect(document.activeElement).toBe(more);
  });

  it('con el foco en el título o en el editor de la página, las flechas no mueven el árbol', async () => {
    const { host, ids } = await app({ shell: true });
    await until(() => host.querySelector('.bn-editor'), 'el editor');
    const title = host.querySelector<HTMLTextAreaElement>('.page-title')!;
    act(() => title.focus());
    for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft']) press(key, {}, title);
    const editor = host.querySelector<HTMLElement>('.bn-editor')!;
    act(() => editor.focus());
    for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft']) press(key, {}, editor);
    await wait(OPEN_DELAY_MS + 30);
    expect(path()).toBe(pagePath(ids.a1));
    expect(expandedOf('Uno')).toBe('true');
    expect(expandedOf('Uno.A')).toBe('true');
  });
});

describe('accesibilidad', () => {
  it('árbol con niveles, la abierta marcada y una sola fila en el orden de Tab, que sigue al foco', async () => {
    await app();
    expect(document.querySelectorAll('[role="tree"]')).toHaveLength(1);
    // El árbol tiene su nombre, distinto del de la barra que lo contiene.
    const tree = document.querySelector('[role="tree"]')!;
    expect(tree.getAttribute('aria-label')).toBe('Page tree');
    expect(tree.closest('nav')!.getAttribute('aria-label')).toBe('Pages');
    expect(row('Uno.A.1').getAttribute('role')).toBe('treeitem');
    expect(row('Uno.A.1').getAttribute('aria-level')).toBe('3');
    // Un árbol de navegación: la página abierta se marca con aria-current y ninguna fila lleva aria-selected.
    expect(row('Uno.A.1').getAttribute('aria-current')).toBe('page');
    expect(row('Dos').getAttribute('aria-current')).toBeNull();
    expect(document.querySelectorAll('.tree [aria-selected]')).toHaveLength(0);
    expect(row('Dos').getAttribute('aria-expanded')).toBeNull();
    const stops = () => rows().filter((r) => r.tabIndex === 0);
    expect(stops()).toEqual([row('Uno.A.1')]);
    focusRow('Uno');
    press('ArrowDown', { repeat: true });
    expect(stops()).toEqual([row('Uno.A')]);
    // Los botones de una fila que no tiene el foco no están en el orden de Tab.
    expect(row('Dos').querySelector<HTMLButtonElement>('[aria-label="More actions"]')!.tabIndex).toBe(-1);
    expect(row('Uno.A').querySelector<HTMLButtonElement>('[aria-label="More actions"]')!.tabIndex).toBe(0);
  });
});

describe('teléfono', () => {
  it('plegar con el dedo una madre de la página abierta deja el cajón abierto', async () => {
    const { host, ids } = await app({ shell: true });
    await until(() => host.querySelector('.bn-editor'), 'el editor');
    act(() => host.querySelector<HTMLButtonElement>('.topbar .only-mobile')!.click());
    expect(host.querySelector('.shell.nav-open')).not.toBeNull();
    act(() => row('Uno').querySelector<HTMLButtonElement>('.toggle')!.click());
    await wait();
    expect(path()).toBe(pagePath(ids.uno));
    expect(host.querySelector('.shell.nav-open')).not.toBeNull();
    // Tocar una página sí lo cierra, como siempre.
    act(() => row('Dos').click());
    await wait();
    expect(path()).toBe(pagePath(ids.dos));
    expect(host.querySelector('.shell.nav-open')).toBeNull();
  });

  it('con el cajón abierto, las flechas recorren sin cerrarlo', async () => {
    const { host, ids } = await app({ shell: true });
    await until(() => host.querySelector('.bn-editor'), 'el editor');
    act(() => host.querySelector<HTMLButtonElement>('.topbar .only-mobile')!.click());
    focusRow('Uno.A.1');
    press('ArrowDown');
    await until(() => path() === pagePath(ids.b), 'abrir Uno.B');
    await wait(OPEN_DELAY_MS + 30);
    expect(host.querySelector('.shell.nav-open')).not.toBeNull();
    expect(focusedTitle()).toBe('Uno.B');
  });

  it('una flecha hacia la página ya abierta (dirección con barra al final) no deja el cajón clavado', async () => {
    const { host, ids } = await app({ shell: true, slash: true });
    await until(() => host.querySelector('.bn-editor'), 'el editor');
    expect(path()).toBe(pagePath(ids.a1) + '/');
    act(() => host.querySelector<HTMLButtonElement>('.topbar .only-mobile')!.click());
    focusRow('Uno.B');
    press('ArrowUp');
    expect(focusedTitle()).toBe('Uno.A.1');
    await wait(OPEN_DELAY_MS + 60);
    // Ya era la página abierta: la dirección ni se toca.
    expect(path()).toBe(pagePath(ids.a1) + '/');
    act(() => row('Dos').click());
    await wait();
    expect(path()).toBe(pagePath(ids.dos));
    expect(host.querySelector('.shell.nav-open')).toBeNull();
  });
});

// El nombre de la fila usa todo el ancho; solo con el mouse encima, el foco o el menú abierto deja lugar a ⋯ y +.
// jsdom no calcula el layout: se prueba el cascado del CSS real de la fila (el ancho de los botones, que es lo que
// le saca lugar al nombre) y las clases que prenden los estados. La medición en pantalla está en el informe.
describe('ancho del nombre de la fila', () => {
  function rowCss(withMedia = false): string {
    const css = readFileSync(resolve(__dirname, '../styles.css'), 'utf8').replace(/\r\n/g, '\n');
    const from = css.indexOf('\n.tree-row {');
    const to = css.indexOf('\n.row-actions button {');
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    // Sin la parte táctil (salvo que se pida): jsdom no resuelve `@media`.
    const rules = css.slice(from, to);
    return withMedia ? rules : rules.replace(/@media \(hover: none\) \{[\s\S]*?\n\}\n/, '');
  }
  const actionsWidth = (el: HTMLElement) => getComputedStyle(el.querySelector('.row-actions')!).width;

  it('sin hover, foco ni menú los botones no ocupan lugar; con foco o menú abierto sí', async () => {
    await app();
    const style = document.createElement('style');
    style.textContent = rowCss();
    document.head.append(style);
    try {
      const dos = row('Dos');
      expect(actionsWidth(dos)).toBe('0px');
      expect(getComputedStyle(dos.querySelector('.row-actions')!).marginLeft).toBe('-4px');
      // Con el foco en la fila.
      act(() => dos.focus());
      expect(actionsWidth(dos)).toBe('auto');
      act(() => (document.activeElement as HTMLElement).blur());
      expect(actionsWidth(dos)).toBe('0px');
      // Con el foco en uno de sus botones.
      const more = dos.querySelector<HTMLButtonElement>('[aria-label="More actions"]')!;
      act(() => more.focus());
      expect(actionsWidth(dos)).toBe('auto');
      act(() => more.blur());
      // En la compu, la página abierta también llega al borde: sus botones salen solo con hover, foco o menú.
      expect(actionsWidth(row('Uno.A.1'))).toBe('0px');
      // Con el menú ⋯ abierto, aunque el foco se vaya al menú.
      act(() => more.click());
      expect(dos.classList.contains('menu-open')).toBe(true);
      act(() => (document.activeElement as HTMLElement | null)?.blur());
      expect(actionsWidth(dos)).toBe('auto');
      press('Escape');
      expect(document.querySelector('.menu')).toBeNull();
      expect(dos.classList.contains('menu-open')).toBe(false);
      expect(row('Uno.B').classList.contains('menu-open')).toBe(false);
    } finally {
      style.remove();
    }
  });

  it('el CSS muestra los botones con hover, foco o menú abierto (jsdom no calcula :hover) y en la compu no por ser la abierta', () => {
    const css = rowCss();
    const shown = css.match(/((?:\.tree-row[^{,]*\.row-actions,?\s*)+)\{\s*opacity: 1;/)![1];
    expect(shown.replace(/\s+/g, ' ').trim()).toBe(
      '.tree-row:hover .row-actions, .tree-row.menu-open .row-actions, .tree-row:focus-within .row-actions',
    );
  });

  it('en el teléfono (hover: none) solo la página abierta tiene los botones, a la vista siempre', async () => {
    await app();
    const touch = rowCss(true).match(/@media \(hover: none\) \{([\s\S]*?)\n\}\n/)![1];
    const style = document.createElement('style');
    // jsdom no evalúa `@media`: se prueba el contenido de la regla táctil como si valiera.
    style.textContent = rowCss() + touch;
    document.head.append(style);
    try {
      expect(actionsWidth(row('Uno.A.1'))).toBe('auto');
      expect(getComputedStyle(row('Uno.A.1').querySelector('.row-actions')!).display).not.toBe('none');
      expect(getComputedStyle(row('Dos').querySelector('.row-actions')!).display).toBe('none');
      expect(getComputedStyle(row('Uno.B').querySelector('.row-actions')!).display).toBe('none');
    } finally {
      style.remove();
    }
  });

  it('renombrando, la fila no muestra los botones: el campo usa todo el ancho', async () => {
    await app();
    const style = document.createElement('style');
    style.textContent = rowCss();
    document.head.append(style);
    try {
      act(() => row('Uno.B').querySelector<HTMLButtonElement>('[aria-label="More actions"]')!.click());
      const rename = [...document.querySelectorAll<HTMLButtonElement>('.menu button')].find((b) => b.textContent?.includes('Rename'));
      act(() => rename!.click());
      const renaming = document.querySelector<HTMLElement>('.tree-row.renaming')!;
      expect(renaming).not.toBeNull();
      expect(renaming.classList.contains('menu-open')).toBe(false);
      expect(getComputedStyle(renaming.querySelector('.row-actions')!).display).toBe('none');
      press('Escape', {}, document.activeElement);
      expect(document.querySelector('.tree-row.renaming')).toBeNull();
    } finally {
      style.remove();
    }
  });
});
