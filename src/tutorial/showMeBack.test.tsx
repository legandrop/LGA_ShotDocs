// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNavHistory } from '../navHistory';
import { navigate, pagePath } from '../router';
import { setNavOpen } from '../ui/navStore';
import { ShowMeBack, showMeBackRect } from './ShowMeBack';

// La copia del ‹ de la barra durante «Show me» (Docs/Doc_Navegacion.md, D741): solo donde el ‹ de verdad se vería (no
// con el cajón abierto, no si la pisa el globito o la barra lateral), se vuelve a medir sola y vuelve como el de la barra.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const A = pagePath('00000000-0000-4000-8000-00000000000a');
const rawReplace = History.prototype.replaceState;

type Box = { left: number; top: number; width: number; height: number };

/** Un elemento que mide lo que se le diga (JSDOM no mide). */
function sized(el: HTMLElement, box: () => Box): HTMLElement {
  el.getBoundingClientRect = () => {
    const b = box();
    return { x: b.left, y: b.top, ...b, right: b.left + b.width, bottom: b.top + b.height, toJSON: () => b } as DOMRect;
  };
  return el;
}

let uninstall: () => void = () => undefined;
let root: Root;
let host: HTMLElement;
let bubbleBox: Box;
let observers: (() => void)[];
const bubble = createRef<HTMLDivElement>();

function mount(): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<ShowMeBack bubble={bubble} />));
}

const copy = () => document.querySelector<HTMLButtonElement>('[data-test="tour-nav-back"]');

beforeEach(() => {
  sessionStorage.clear();
  rawReplace.call(history, null, '', '/');
  uninstall = installNavHistory();
  observers = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) {
        observers.push(cb);
      }
      observe() {}
      disconnect() {}
    },
  );
  // La barra con el ‹ (48, 8, 30×36, como en el teléfono) y la barra lateral cerrada, fuera de la pantalla.
  const topbar = document.createElement('header');
  topbar.className = 'topbar';
  const back = document.createElement('button');
  back.dataset.test = 'nav-back';
  topbar.appendChild(sized(back, () => ({ left: 48, top: 8, width: 30, height: 36 })));
  document.body.appendChild(topbar);
  const sidebar = document.createElement('aside');
  sidebar.className = 'sidebar';
  document.body.appendChild(sized(sidebar, () => ({ left: -300, top: 0, width: 300, height: 812 })));
  // El globito abajo (la hoja del teléfono).
  bubbleBox = { left: 0, top: 680, width: 375, height: 132 };
  const el = sized(document.createElement('div'), () => bubbleBox);
  document.body.appendChild(el);
  (bubble as { current: HTMLDivElement | null }).current = el as HTMLDivElement;
  navigate(A);
});

afterEach(() => {
  act(() => root.unmount());
  act(() => setNavOpen(false));
  uninstall();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('la copia del ‹ en «Show me»', () => {
  it('con atrás disponible aparece justo sobre el ‹ de la barra; el clic vuelve como el de la barra', async () => {
    mount();
    const button = copy();
    expect(button).not.toBeNull();
    expect([button!.style.left, button!.style.top, button!.style.width, button!.style.height]).toEqual(['48px', '8px', '30px', '36px']);
    const done = new Promise<void>((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }));
    act(() => button!.click());
    await act(() => done);
    expect(location.pathname).toBe('/');
    // Ya en la primera entrada de la app: no hay a dónde volver, la copia se va.
    expect(copy()).toBeNull();
  });

  it('sin atrás disponible no aparece', () => {
    uninstall();
    rawReplace.call(history, null, '', '/');
    uninstall = installNavHistory();
    mount();
    expect(copy()).toBeNull();
  });

  it('con el cajón de páginas abierto no aparece (en el teléfono lo tapa), y vuelve al cerrarlo', () => {
    mount();
    expect(copy()).not.toBeNull();
    act(() => setNavOpen(true));
    expect(copy()).toBeNull();
    act(() => setNavOpen(false));
    expect(copy()).not.toBeNull();
  });

  it('si el globito pisa su lugar no aparece; se vuelve a medir cuando el globito cambia (ResizeObserver)', () => {
    mount();
    expect(copy()).not.toBeNull();
    // La hoja pasa arriba (el paso señala algo de abajo) y tapa el ‹: el título del globito queda a la vista.
    bubbleBox = { left: 0, top: 0, width: 375, height: 140 };
    act(() => observers.forEach((cb) => cb()));
    expect(copy()).toBeNull();
    bubbleBox = { left: 0, top: 680, width: 375, height: 132 };
    act(() => observers.forEach((cb) => cb()));
    expect(copy()).not.toBeNull();
  });

  it('la cuenta: barra lateral abierta encima, fuera de la pantalla o sin medir', () => {
    const back = { left: 48, top: 8, width: 30, height: 36 };
    expect(showMeBackRect(back, [{ left: 0, top: 0, width: 300, height: 812 }], false)).toBeNull();
    expect(showMeBackRect(back, [{ left: -300, top: 0, width: 300, height: 812 }], false)).toEqual(back);
    // Bordes que solo se tocan no pisan.
    expect(showMeBackRect(back, [{ left: 78, top: 8, width: 10, height: 36 }], false)).toEqual(back);
    expect(showMeBackRect({ ...back, left: -40 }, [], false)).toBeNull();
    expect(showMeBackRect(null, [], false)).toBeNull();
    expect(showMeBackRect(back, [], true)).toBeNull();
  });
});
