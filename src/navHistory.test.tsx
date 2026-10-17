// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { goBack, goForward, installNavHistory, navDebug, navPosition, overlayState, readNavTag } from './navHistory';
import { navigate, pagePath } from './router';
import { endShowStep, showStep } from './tutorial/tourState';
import { NavButtons } from './ui/NavButtons';

// Atrás y adelante adentro de la app (Docs/Doc_Navegacion.md): el registro de posición que lleva cada entrada del
// historial, lo de adelante que sobrevive a una recarga, las capas (carrete, «Show me») que no cuentan como páginas,
// los atajos y los botones de la barra.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const A = pagePath('00000000-0000-4000-8000-00000000000a');
const B = pagePath('00000000-0000-4000-8000-00000000000b');
const C = pagePath('00000000-0000-4000-8000-00000000000c');

/** Las funciones originales del historial (las del prototipo: `installNavHistory` envuelve las de la instancia). */
const rawReplace = History.prototype.replaceState;

let uninstall: () => void = () => undefined;

/** Espera la vuelta de un atrás o adelante (JSDOM la manda un momento después). */
function popped(): Promise<void> {
  return new Promise((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }));
}

/** Pasa el tiempo en que otro atrás o adelante no se acepta (un doble clic va una sola página, D742). */
function later(ms = 600): void {
  vi.setSystemTime(Date.now() + ms);
}

async function back(): Promise<void> {
  later();
  const done = popped();
  expect(goBack()).toBe(true);
  await done;
}

async function forward(): Promise<void> {
  later();
  const done = popped();
  expect(goForward()).toBe(true);
  await done;
}

/** Un documento nuevo en la misma pestaña: lo que se ve es la entrada de ahora, con su `state` y la sesión guardada. */
function reopen(type: 'reload' | 'back_forward' | 'navigate'): void {
  uninstall();
  vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type } as PerformanceNavigationTiming]);
  uninstall = installNavHistory();
}

/** Una entrada nueva que llega desde afuera de la app (sin marca), como al volver de otro sitio por un link. */
function freshEntry(path: string): void {
  uninstall();
  rawReplace.call(history, null, '', path);
  vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type: 'navigate' } as PerformanceNavigationTiming]);
  uninstall = installNavHistory();
}

beforeEach(() => {
  // Solo el reloj (`Date.now`): los `setTimeout` y la vuelta del historial de JSDOM siguen de verdad.
  vi.useFakeTimers({ toFake: ['Date'] });
  sessionStorage.clear();
  rawReplace.call(history, null, '', '/');
  uninstall = installNavHistory();
});

afterEach(() => {
  uninstall();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('el registro de posición', () => {
  it('al arrancar no hay atrás ni adelante, y la entrada queda marcada', () => {
    expect(navPosition()).toEqual({ canBack: false, canForward: false });
    expect(readNavTag(history.state)).toMatchObject({ i: 0 });
  });

  it('cada página abierta suma una posición; atrás y adelante recorren solo las de la app', async () => {
    navigate(A);
    navigate(B);
    expect(navDebug()).toMatchObject({ idx: 2, max: 2 });
    expect(navPosition()).toEqual({ canBack: true, canForward: false });
    await back();
    expect(location.pathname).toBe(A);
    expect(navPosition()).toEqual({ canBack: true, canForward: true });
    await back();
    expect(location.pathname).toBe('/');
    expect(navPosition()).toEqual({ canBack: false, canForward: true });
    // En la primera entrada de la app, atrás no hace nada: nunca se sale al sitio de antes.
    later();
    expect(goBack()).toBe(false);
    await forward();
    await forward();
    expect(location.pathname).toBe(B);
    later();
    expect(goForward()).toBe(false);
  });

  it('abrir otra página después de volver borra lo de adelante, como en un navegador', async () => {
    navigate(A);
    navigate(B);
    await back();
    navigate(C);
    expect(navPosition()).toEqual({ canBack: true, canForward: false });
    await back();
    expect(location.pathname).toBe(A);
  });

  it('un replaceState (también con state null) conserva la posición', async () => {
    navigate(A);
    history.replaceState(null, '', A + '?drive=ok');
    navigate(B, true);
    expect(readNavTag(history.state)).toMatchObject({ i: 1 });
    expect(navPosition()).toEqual({ canBack: true, canForward: false });
    await back();
    expect(location.pathname).toBe('/');
  });

  it('un state propio de quien navega se conserva entero', () => {
    history.pushState({ carrete: 'x', otro: 1 }, '');
    expect(history.state).toMatchObject({ carrete: 'x', otro: 1 });
    expect(readNavTag(history.state)).toMatchObject({ i: 1 });
  });

  it('un doble clic en atrás no salta dos veces mientras la primera vuelta está en camino', async () => {
    navigate(A);
    const done = popped();
    expect(goBack()).toBe(true);
    expect(goBack()).toBe(false);
    await done;
    expect(location.pathname).toBe('/');
    expect(navDebug().idx).toBe(0);
  });

  it('dos clics a 150 ms van una sola página; pasado el medio segundo, otro clic sí', async () => {
    navigate(A);
    navigate(B);
    navigate(C);
    const done = popped();
    expect(goBack()).toBe(true);
    await done;
    // La vuelta ya llegó, pero el segundo clic del doble clic llega a los 150 ms: no cuenta.
    later(150);
    expect(goBack()).toBe(false);
    expect(location.pathname).toBe(B);
    later(400);
    const again = popped();
    expect(goBack()).toBe(true);
    await again;
    expect(location.pathname).toBe(A);
  });

  it('un link con # dentro de la página suma una posición', async () => {
    navigate(A);
    const done = popped();
    location.hash = '#seccion';
    await done;
    expect(navDebug()).toMatchObject({ idx: 2, max: 2 });
    expect(readNavTag(history.state)).toMatchObject({ i: 2 });
  });
});

describe('recargar y volver de otro sitio', () => {
  it('recargar conserva atrás y adelante', async () => {
    navigate(A);
    navigate(B);
    await back();
    reopen('reload');
    expect(location.pathname).toBe(A);
    expect(navPosition()).toEqual({ canBack: true, canForward: true });
    await forward();
    expect(location.pathname).toBe(B);
  });

  it('volver con atrás desde otro sitio: lo de adelante llega hasta donde se salió', async () => {
    navigate(A);
    navigate(B);
    await back();
    // Desde A (posición 1) salió a otro sitio por un link: la B de adelante ya no existe. Lo guardado dice max 2 y que
    // se salió en la 1; vuelve con atrás a A, en un documento nuevo.
    expect(JSON.parse(sessionStorage.getItem('shotdocs.navHistory')!)).toMatchObject({ max: 2, at: 1 });
    reopen('back_forward');
    expect(location.pathname).toBe(A);
    expect(navPosition()).toEqual({ canBack: true, canForward: false });
  });

  it('volver con atrás a una página anterior del mismo tramo, en otro documento: adelante hasta donde estaba', async () => {
    navigate(A);
    navigate(B);
    navigate(C);
    // Estaba en C (3) y vuelve con atrás a B (2) en otro documento: C sigue adelante.
    const s = readNavTag(history.state)!.s;
    uninstall();
    rawReplace.call(history, { sdNav: { s, i: 2 } }, '', B);
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type: 'back_forward' } as PerformanceNavigationTiming]);
    uninstall = installNavHistory();
    expect(navDebug()).toMatchObject({ idx: 2, max: 3 });
  });

  it('una entrada sin marca empieza un tramo nuevo: atrás apagado aunque haya páginas de la app más atrás', () => {
    navigate(A);
    navigate(B);
    freshEntry(C);
    expect(navPosition()).toEqual({ canBack: false, canForward: false });
    expect(readNavTag(history.state)).toMatchObject({ i: 0 });
  });

  it('volver a un tramo viejo deja atrás encendido y adelante apagado (no se sabe qué hay adelante)', () => {
    navigate(A);
    navigate(B);
    const old = history.state;
    freshEntry(C);
    // La pestaña vuelve con atrás a la B del tramo viejo, en otro documento.
    uninstall();
    rawReplace.call(history, old, '', B);
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type: 'back_forward' } as PerformanceNavigationTiming]);
    uninstall = installNavHistory();
    expect(navPosition()).toEqual({ canBack: true, canForward: false });
  });

  it('sin sessionStorage sigue andando (hasta recargar)', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    navigate(A);
    expect(navPosition().canBack).toBe(true);
    await back();
    expect(location.pathname).toBe('/');
  });
});

describe('las capas: carrete y «Show me»', () => {
  it('al cerrar el carrete (atrás) no queda un adelante que lo reabra', async () => {
    navigate(A);
    // Lo que hace el carrete al abrirse (Carrete.tsx): una entrada con la misma dirección.
    history.pushState(overlayState({ ...(history.state ?? {}), carrete: 't1' }), '');
    expect(navPosition()).toEqual({ canBack: true, canForward: false });
    const done = popped();
    history.back();
    await done;
    expect(location.pathname).toBe(A);
    expect(navPosition()).toEqual({ canBack: true, canForward: false });
    // Las páginas de antes siguen: atrás vuelve al inicio.
    await back();
    expect(location.pathname).toBe('/');
    expect(navPosition()).toEqual({ canBack: false, canForward: true });
  });

  it('con el carrete abierto, atrás de la barra hace lo mismo que el atrás del navegador: lo cierra', async () => {
    navigate(A);
    history.pushState(overlayState({ carrete: 't2' }), '');
    await back();
    expect(location.pathname).toBe(A);
    expect((history.state as { carrete?: string }).carrete).toBeUndefined();
  });

  it('«Show me» y su vuelta: la entrada de la práctica no queda adelante', async () => {
    navigate(A);
    const listener = vi.fn();
    window.addEventListener('popstate', listener);
    showStep('find');
    expect(location.pathname).toBe('/practice');
    expect(navPosition()).toEqual({ canBack: true, canForward: false });
    const done = popped();
    endShowStep();
    await done;
    window.removeEventListener('popstate', listener);
    expect(location.pathname).toBe(A);
    expect(navPosition()).toEqual({ canBack: true, canForward: false });
  });

  it('atrás de la barra durante «Show me» vuelve a la página, igual que el del navegador', async () => {
    navigate(A);
    showStep('find');
    await back();
    expect(location.pathname).toBe(A);
    endShowStep({ goBack: false });
    expect(navPosition()).toEqual({ canBack: true, canForward: false });
  });
});

describe('los botones y sus atajos', () => {
  let root: Root;
  let host: HTMLElement;

  function mount(): void {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<NavButtons />));
  }

  const button = (which: 'back' | 'forward') => host.querySelector<HTMLButtonElement>(`[data-test="nav-${which}"]`)!;

  function key(init: KeyboardEventInit): KeyboardEvent {
    const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    document.body.dispatchEvent(e);
    return e;
  }

  afterEach(() => act(() => root.unmount()));

  it('apagados sin a dónde ir; se encienden y apagan solos', async () => {
    mount();
    expect(button('back').disabled).toBe(true);
    expect(button('forward').disabled).toBe(true);
    act(() => navigate(A));
    expect(button('back').disabled).toBe(false);
    const done = popped();
    act(() => button('back').click());
    await act(() => done);
    expect(location.pathname).toBe('/');
    expect(button('back').disabled).toBe(true);
    expect(button('forward').disabled).toBe(false);
    expect(button('back').getAttribute('aria-label')).toBe('Back');
    // El tooltip nombra el atajo con el formato de la app (D226), nunca un `title`.
    expect(button('forward').hasAttribute('title')).toBe(false);
  });

  it('Alt+← y Alt+→ (fuera de la Mac) van atrás y adelante, y frenan el del navegador', async () => {
    mount();
    act(() => navigate(A));
    let done = popped();
    const e = key({ key: 'ArrowLeft', altKey: true });
    expect(e.defaultPrevented).toBe(true);
    await act(() => done);
    expect(location.pathname).toBe('/');
    done = popped();
    later();
    key({ key: 'ArrowRight', altKey: true });
    await act(() => done);
    expect(location.pathname).toBe(A);
  });

  it('Alt+← mantenido va una sola página y frena las repeticiones: nunca sale de la app', async () => {
    mount();
    act(() => navigate(A));
    const done = popped();
    expect(key({ key: 'ArrowLeft', altKey: true }).defaultPrevented).toBe(true);
    await act(() => done);
    expect(location.pathname).toBe('/');
    // Las repeticiones de la tecla mantenida, ya en la primera entrada de la app (y también pasado el medio segundo):
    // se frenan para que el navegador no siga yendo atrás, y no navegan.
    for (let n = 0; n < 5; n++) {
      later(200);
      expect(key({ key: 'ArrowLeft', altKey: true, repeat: true }).defaultPrevented).toBe(true);
    }
    expect(navDebug().idx).toBe(0);
    expect(location.pathname).toBe('/');
  });

  it('sin a dónde ir, el atajo no se frena (el navegador hace lo suyo)', () => {
    mount();
    expect(key({ key: 'ArrowLeft', altKey: true }).defaultPrevented).toBe(false);
  });

  it('con una capa abierta (carrete, anotador, un diálogo) el atajo no es de la barra', () => {
    mount();
    act(() => navigate(A));
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
    expect(key({ key: 'ArrowLeft', altKey: true }).defaultPrevented).toBe(false);
    expect(navDebug().idx).toBe(1);
  });

  it('lo que ya tomó otro (el editor, el carrete) no llega', () => {
    mount();
    act(() => navigate(A));
    const stop = (ev: KeyboardEvent) => ev.preventDefault();
    window.addEventListener('keydown', stop, true);
    key({ key: 'ArrowLeft', altKey: true });
    window.removeEventListener('keydown', stop, true);
    expect(navDebug().idx).toBe(1);
  });

  it('dos copias de los botones no van dos veces atrás', async () => {
    mount();
    const second = document.createElement('div');
    document.body.appendChild(second);
    const root2 = createRoot(second);
    act(() => root2.render(<NavButtons />));
    act(() => navigate(A));
    act(() => navigate(B));
    const done = popped();
    key({ key: 'ArrowLeft', altKey: true });
    await act(() => done);
    expect(location.pathname).toBe(A);
    act(() => root2.unmount());
  });
});
