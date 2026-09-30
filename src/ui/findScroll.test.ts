// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { centerInScroller, keepInView, scrollParent, stopKeepingInView } from './findScroll';

// Llevar la coincidencia a la vista dentro del contenedor que se desplaza (Docs/Doc_Buscar.md, ajustes de
// v0.057): centrada debajo de la barra de arriba, de costado con una hoja ancha, y acomodándose mientras la
// página cambia de alto sin pelearse con la persona.

interface Fake {
  scroller: HTMLElement;
  owner: HTMLElement;
  match: HTMLElement;
  /** Dónde está la coincidencia en el contenido (sin desplazar). */
  at: { top: number; left: number };
}

let observers: (() => void)[] = [];

beforeEach(() => {
  observers = [];
  // Sin requestAnimationFrame, se aplica en el momento.
  vi.stubGlobal('requestAnimationFrame', undefined);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private fn: () => void) {
        observers.push(() => this.fn());
      }
      observe() {}
      unobserve() {}
      disconnect() {
        observers = observers.filter(() => false);
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

/** Un `.main` de 900×800 en x=300, con la barra de arriba de 52 px (`scroll-padding-top`). */
function fake(): Fake {
  const scroller = document.createElement('main');
  scroller.style.overflowY = 'auto';
  const article = document.createElement('article');
  const owner = document.createElement('div');
  const match = document.createElement('span');
  owner.append(match);
  article.append(owner);
  scroller.append(article);
  document.body.append(scroller);
  const at = { top: 3000, left: 400 };
  let top = 0;
  let left = 0;
  Object.defineProperty(scroller, 'scrollTop', { get: () => top, set: (v: number) => (top = Math.max(0, v)) });
  Object.defineProperty(scroller, 'scrollLeft', { get: () => left, set: (v: number) => (left = Math.max(0, v)) });
  Object.defineProperty(scroller, 'clientHeight', { value: 800 });
  Object.defineProperty(scroller, 'clientWidth', { value: 900 });
  scroller.getBoundingClientRect = () => ({ top: 0, left: 300, right: 1200, bottom: 800, width: 900, height: 800 }) as DOMRect;
  match.getBoundingClientRect = () => {
    const t = at.top - top;
    const l = 300 + at.left - left;
    return { top: t, bottom: t + 20, left: l, right: l + 80, width: 80, height: 20 } as DOMRect;
  };
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
    if (el !== scroller) return real(el);
    return { overflowX: 'auto', overflowY: 'auto', scrollPaddingTop: '52px', scrollPaddingBottom: '', scrollPaddingLeft: '', scrollPaddingRight: '' } as CSSStyleDeclaration;
  });
  return { scroller, owner, match, at };
}

/** El centro de la coincidencia, en la pantalla. */
const centerOf = (el: HTMLElement) => {
  const r = el.getBoundingClientRect();
  return (r.top + r.bottom) / 2;
};

describe('llevar a la vista', () => {
  it('el contenedor que se desplaza es el primer antepasado con scroll propio (no la ventana)', () => {
    const { scroller, owner } = fake();
    expect(scrollParent(owner)).toBe(scroller);
  });

  it('centra la coincidencia en lo que se ve, debajo de la barra de arriba', () => {
    const { scroller, match } = fake();
    expect(centerInScroller(scroller, match)).toBe(true);
    // Lo que se ve va de 52 a 800: el centro, 426.
    expect(centerOf(match)).toBe(426);
    expect(scroller.scrollLeft).toBe(0);
  });

  it('con una hoja más ancha que la ventana, la trae de costado; si ya se ve de costado, no mueve', () => {
    const { scroller, match, at } = fake();
    at.left = 1500;
    centerInScroller(scroller, match);
    const r = match.getBoundingClientRect();
    expect(r.left).toBeGreaterThanOrEqual(300);
    expect(r.right).toBeLessThanOrEqual(1200);
    const before = scroller.scrollLeft;
    at.left = 1400;
    centerInScroller(scroller, match);
    expect(scroller.scrollLeft).toBe(before);
  });

  it('una coincidencia escondida (sin tamaño) no mueve nada', () => {
    const { scroller, match } = fake();
    match.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }) as DOMRect;
    expect(centerInScroller(scroller, match)).toBe(false);
    expect(scroller.scrollTop).toBe(0);
  });

  it('al llegar, la sigue centrando mientras la página cambia de alto (fotos que bajan)', () => {
    const { owner, match, at } = fake();
    const after = vi.fn();
    keepInView(owner, () => match, { settleMs: 4000, after });
    expect(centerOf(match)).toBe(426);
    // Una foto de arriba terminó de bajar: todo lo de abajo se corre 600 px.
    at.top += 600;
    expect(centerOf(match)).toBe(1026);
    for (const fn of observers) fn();
    expect(centerOf(match)).toBe(426);
    // Un `load` de una foto también vuelve a centrar.
    at.top += 300;
    owner.dispatchEvent(new Event('load'));
    expect(centerOf(match)).toBe(426);
    expect(after).toHaveBeenCalledWith(match);
  });

  it('no se pelea con la persona: desplazar, hacer clic o una tecla lo corta', () => {
    for (const stopWith of ['wheel', 'pointerdown', 'touchstart', 'dragenter', 'drop', 'keydown'] as const) {
      document.body.innerHTML = '';
      vi.restoreAllMocks();
      const { scroller, owner, match, at } = fake();
      keepInView(owner, () => match, { settleMs: 4000 });
      if (stopWith === 'keydown') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      else scroller.dispatchEvent(new Event(stopWith));
      at.top += 600;
      for (const fn of observers) fn();
      owner.dispatchEvent(new Event('load'));
      expect(centerOf(match), stopWith).toBe(1026);
    }
  });

  it('se termina solo al rato, y al ir a otra coincidencia (o cerrar la barra)', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { owner, match, at } = fake();
    keepInView(owner, () => match, { settleMs: 4000 });
    vi.advanceTimersByTime(4001);
    at.top += 600;
    owner.dispatchEvent(new Event('load'));
    expect(centerOf(match)).toBe(1026);

    keepInView(owner, () => match, { settleMs: 4000 });
    expect(centerOf(match)).toBe(426);
    stopKeepingInView(owner);
    at.top += 600;
    owner.dispatchEvent(new Event('load'));
    expect(centerOf(match)).toBe(1026);
  });

  it('ir con Enter a la siguiente la lleva una sola vez (sin quedarse acomodando)', () => {
    const { owner, match, at } = fake();
    keepInView(owner, () => match);
    expect(centerOf(match)).toBe(426);
    at.top += 600;
    owner.dispatchEvent(new Event('load'));
    expect(centerOf(match)).toBe(1026);
  });
});
