// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { goBack, goForward, historyStack, installNavHistory, navPosition, overlayState, rebuildHistory } from '../navHistory';
import { navigate, pagePath } from '../router';
import { bindTabs, closeTab, newTab, readTabs, stepTab, switchTab, tabsState } from './tabs';

// Los tabs de la app instalada (tabs.ts, D811): cada tab con su historial (atrás y adelante recorren solo sus páginas),
// abrir de fondo, cerrar el de ahora, lo guardado que vuelve al abrir y lo guardado roto que no rompe nada.

const A = pagePath('00000000-0000-4000-8000-00000000000a');
const B = pagePath('00000000-0000-4000-8000-00000000000b');
const C = pagePath('00000000-0000-4000-8000-00000000000c');
const D = pagePath('00000000-0000-4000-8000-00000000000d');
const KEY = 'shotdocs.tabs.test';
const rawReplace = History.prototype.replaceState;

let uninstallNav: () => void = () => undefined;
let unbind: () => void = () => undefined;
let project = 'p1';
const chosen: string[] = [];

function popped(): Promise<void> {
  return new Promise((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }));
}

/** Atrás o adelante con el botón de la app, pasado el tiempo en que no se acepta otro (D742). */
async function step(dir: 'back' | 'forward'): Promise<void> {
  vi.setSystemTime(Date.now() + 600);
  const done = popped();
  expect(dir === 'back' ? goBack() : goForward()).toBe(true);
  await done;
}

function bind(): void {
  unbind = bindTabs({ key: KEY, project: () => project, chooseProject: (id) => chosen.push(id) });
}

const here = () => location.pathname + location.search;

// Cada prueba un minuto después: los cambios del historial de la anterior no cuentan para el tope (rebuildHistory).
let clock = Date.now();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  clock += 60_000;
  vi.setSystemTime(clock);
  sessionStorage.clear();
  localStorage.clear();
  chosen.length = 0;
  project = 'p1';
  rawReplace.call(history, null, '', '/');
  uninstallNav = installNavHistory();
  document.body.innerHTML = '<main class="main"></main>';
});

afterEach(() => {
  unbind();
  unbind = () => undefined;
  uninstallNav();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('el historial de un tab', () => {
  it('historyStack: las direcciones del tramo y dónde está, sin repetir seguidas', async () => {
    navigate(A);
    navigate(B);
    navigate(C);
    await step('back');
    expect(historyStack()).toEqual({ stack: ['/', A, B, C], at: 2 });
  });

  it('rebuildHistory cambia el historial de la ventana por el del tab, con lo de adelante', async () => {
    navigate(A);
    navigate(B);
    await rebuildHistory({ stack: [C, D, A], at: 1 });
    expect(here()).toBe(D);
    expect(navPosition()).toEqual({ canBack: true, canForward: true });
    await step('back');
    expect(here()).toBe(C);
    expect(navPosition().canBack).toBe(false);
    await step('forward');
    await step('forward');
    expect(here()).toBe(A);
    expect(navPosition().canForward).toBe(false);
  });

  it('después de recargar no vuelve a las entradas de la carga anterior (recargaría la app)', async () => {
    navigate(A);
    navigate(B);
    uninstallNav();
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type: 'reload' } as PerformanceNavigationTiming]);
    uninstallNav = installNavHistory();
    const go = vi.spyOn(history, 'go');
    await rebuildHistory({ stack: [C, D], at: 1 });
    expect(go.mock.calls.every(([delta]) => (delta ?? 0) > -2)).toBe(true);
    expect(here()).toBe(D);
    await step('back');
    expect(here()).toBe(C);
    expect(navPosition().canBack).toBe(false);
  });

  it('una capa (el carrete) no queda como página del tab', async () => {
    navigate(A);
    history.pushState(overlayState({ carrete: 1 }), '', A);
    navigate(B);
    expect(historyStack().stack).toEqual(['/', A, B]);
  });

  it('pasando seguido de tab, el historial se arma corto antes de llegar al tope del navegador', async () => {
    const long = Array.from({ length: 20 }, (_, i) => pagePath(`00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`));
    for (let n = 0; n < 6; n++) await rebuildHistory({ stack: long, at: 19 });
    expect(here()).toBe(long[19]);
    expect(navPosition().canBack).toBe(false);
  });

  it('con una sola entrada no queda adelante lo del tab anterior', async () => {
    navigate(A);
    navigate(B);
    await step('back');
    await step('back');
    await rebuildHistory({ stack: [C], at: 0 });
    expect(here()).toBe(C);
    expect(navPosition()).toEqual({ canBack: false, canForward: false });
  });
});

describe('abrir, cambiar y cerrar tabs', () => {
  it('cada tab recorre solo sus páginas con atrás y adelante', async () => {
    bind();
    navigate(A);
    navigate(B);
    const first = tabsState().active;
    await newTab(C);
    expect(here()).toBe(C);
    expect(tabsState().tabs).toHaveLength(2);
    expect(navPosition().canBack).toBe(false);
    navigate(D);
    await step('back');
    expect(here()).toBe(C);

    await switchTab(first);
    expect(here()).toBe(B);
    await step('back');
    expect(here()).toBe(A);
    await step('forward');
    expect(here()).toBe(B);

    // El otro tab volvió como estaba: en C, con D adelante.
    await stepTab(1);
    expect(here()).toBe(C);
    expect(navPosition()).toEqual({ canBack: false, canForward: true });
  });

  it('de fondo (Ctrl/⌘+clic o la rueda) se suma al lado sin dejar el de ahora', async () => {
    bind();
    navigate(A);
    const first = tabsState().active;
    await newTab(D, { background: true });
    expect(here()).toBe(A);
    expect(tabsState().active).toBe(first);
    expect(tabsState().tabs.map((t) => t.history.stack[t.history.at])).toEqual([A, D]);
  });

  it('cerrar el de ahora pasa al de la derecha (o al de la izquierda si era el último); el único no se cierra', async () => {
    bind();
    navigate(A);
    await newTab(B);
    await newTab(C);
    const [, second, third] = tabsState().tabs.map((t) => t.id);
    await switchTab(second);
    await closeTab(second);
    expect(here()).toBe(C);
    await closeTab(third);
    expect(here()).toBe(A);
    expect(tabsState().tabs).toHaveLength(1);
    await closeTab(tabsState().active);
    expect(tabsState().tabs).toHaveLength(1);
  });

  it('un tab que no estaba en una página vuelve con su proyecto elegido', async () => {
    bind();
    rawReplace.call(history, history.state, '', '/map');
    project = 'p2';
    const first = tabsState().active;
    await newTab(A);
    project = 'p1';
    await switchTab(first);
    expect(chosen).toContain('p2');
    expect(here()).toBe('/map');
  });
});

describe('lo guardado', () => {
  it('vuelve al abrir, en el tab de la dirección de la ventana', async () => {
    bind();
    navigate(A);
    await newTab(B);
    unbind();
    unbind = () => undefined;
    rawReplace.call(history, history.state, '', A);
    bind();
    expect(tabsState().tabs).toHaveLength(2);
    expect(tabsState().tabs[tabsState().tabs.findIndex((t) => t.id === tabsState().active)].history.stack.at(-1)).toBe(A);
  });

  it('con otra dirección (un link), esa va en un tab nuevo al principio', async () => {
    bind();
    navigate(A);
    await newTab(B);
    unbind();
    unbind = () => undefined;
    rawReplace.call(history, history.state, '', C);
    bind();
    const { tabs, active } = tabsState();
    expect(tabs).toHaveLength(3);
    expect(tabs[0].id).toBe(active);
  });

  it('un tab roto se descarta y lo demás sigue; algo que no es una lista no sirve', () => {
    const good = { id: 'a', history: { stack: [A], at: 0 }, project: null, scroll: 0 };
    const state = readTabs(JSON.stringify({ tabs: [good, { id: 'b', history: { stack: ['//evil.com'], at: 0 } }, 5], active: 'b' }));
    expect(state?.tabs.map((t) => t.id)).toEqual(['a']);
    expect(state?.active).toBe('a');
    expect(readTabs('{"tabs":3}')).toBeNull();
    expect(readTabs('no es json')).toBeNull();
    expect(readTabs(JSON.stringify({ tabs: [{ ...good, history: { stack: [A, B], at: 9 } }] }))?.tabs[0].history.at).toBe(1);
  });
});
