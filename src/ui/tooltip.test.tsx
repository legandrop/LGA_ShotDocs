// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { placeNear } from './floating';
import { tipAnchor, TooltipLayer } from './Tooltip';

// El tooltip con el foco del teclado: en un control al que se llega con Tab sale enseguida; en una fila del
// árbol de páginas (que se recorre con las flechas) espera como con el mouse, para no parpadear en cada fila.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  // jsdom no sabe si el foco llegó con el teclado: acá todo foco cuenta como de teclado.
  const matches = Element.prototype.matches;
  vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
    return matches.call(this, selector === ':focus-visible' ? ':focus' : selector);
  });
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(
      <>
        <button id="boton" data-tip="Add a page inside">
          +
        </button>
        <div id="fila1" className="tree-row" tabIndex={0} data-tip="064 | Cubiertos pegados" data-tip-plain />
        <div id="fila2" className="tree-row" tabIndex={-1} data-tip="065 | Iglesia" data-tip-plain />
        <TooltipLayer />
      </>,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const tip = () => document.querySelector('[role="tooltip"]')?.textContent ?? null;
const el = (id: string) => document.getElementById(id)!;
const focus = (id: string) => act(() => el(id).focus());
const pass = (ms: number) => act(() => vi.advanceTimersByTime(ms));
function press(id: string, key: string) {
  act(() => {
    el(id).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

describe('el tooltip con el teclado', () => {
  it('en un botón al que se llega con Tab sale enseguida', () => {
    focus('boton');
    expect(tip()).toBe('Add a page inside');
  });

  it('en una fila del árbol espera, y recorriendo con las flechas no sale ninguno', () => {
    focus('fila1');
    expect(tip()).toBeNull();
    pass(300);
    press('fila1', 'ArrowDown');
    focus('fila2');
    expect(tip()).toBeNull();
    pass(300);
    press('fila2', 'ArrowUp');
    focus('fila1');
    pass(300);
    expect(tip()).toBeNull();
    // Quedándose quieto, aparece.
    pass(400);
    expect(tip()).toBe('064 | Cubiertos pegados');
  });

  it('con uno a la vista, seguir con las flechas lo esconde y el de la otra fila vuelve a esperar', () => {
    focus('fila1');
    pass(700);
    expect(tip()).toBe('064 | Cubiertos pegados');
    press('fila1', 'ArrowDown');
    expect(tip()).toBeNull();
    focus('fila2');
    expect(tip()).toBeNull();
    pass(300);
    expect(tip()).toBeNull();
    pass(400);
    expect(tip()).toBe('065 | Iglesia');
    // Una flecha que no mueve el foco (desplegar) también lo esconde.
    press('fila2', 'ArrowRight');
    expect(tip()).toBeNull();
  });
});

// El globo siempre adentro de la ventana (auditoría de D226, B.25b): el borde de la barra lateral mide todo el alto y
// el globo quedaba debajo, afuera de la pantalla.
describe('dónde va el globo', () => {
  const view = { width: 1300, height: 900 };
  const size = { width: 260, height: 70 };
  const inside = (p: { left: number; top: number }) =>
    p.left >= 8 && p.top >= 8 && p.left + size.width <= view.width - 8 && p.top + size.height <= view.height - 8;

  it('un control común: abajo si entra, arriba si no', () => {
    const below = placeNear({ left: 100, top: 100, width: 30, height: 30 }, size, view);
    expect(below.side).toBe('below');
    const above = placeNear({ left: 100, top: 850, width: 30, height: 30 }, size, view);
    expect(above.side).toBe('above');
    expect(inside(below) && inside(above)).toBe(true);
  });

  it('un control más alto que la ventana: al costado, a la altura del mouse', () => {
    const resizer = { left: 300, top: 0, width: 6, height: 900 };
    const { rect, sides } = tipAnchor(resizer, view.height, 420);
    const p = placeNear(rect, size, view, { sides });
    expect(p.side).toBe('right');
    expect(p.left).toBeGreaterThan(306);
    expect(p.top + p.arrow).toBe(420);
    expect(inside(p)).toBe(true);
    // Con el teclado (sin mouse), al medio de lo que se ve; contra el borde derecho, a la izquierda.
    const kb = placeNear(tipAnchor(resizer, view.height, null).rect, size, view, { sides });
    expect(kb.top + kb.arrow).toBe(450);
    const atRight = tipAnchor({ left: 1290, top: -50, width: 6, height: 1000 }, view.height, 880);
    const q = placeNear(atRight.rect, size, view, { sides: atRight.sides });
    expect(q.side).toBe('left');
    expect(inside(q)).toBe(true);
  });

  it('si no entra en ningún lado, queda corrido adentro (antes: abajo y afuera)', () => {
    const huge = { left: 0, top: 0, width: 1300, height: 900 };
    const p = placeNear(huge, size, view, { sides: ['below', 'above'] });
    expect(inside(p)).toBe(true);
  });

  it('con el mouse sobre el borde de la barra, el globo sale a la altura del mouse y adentro', () => {
    const el = document.createElement('div');
    el.setAttribute('data-tip', '**Drag**: resize the sidebar');
    document.body.append(el);
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ left: 300, top: 0, width: 6, height: 900, right: 306, bottom: 900, x: 300, y: 0, toJSON: () => ({}) } as DOMRect);
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
    Object.defineProperty(window, 'innerWidth', { value: 1300, configurable: true });
    act(() => {
      el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse', clientX: 303, clientY: 500 }));
    });
    pass(700);
    const bubble = document.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(bubble.className).toContain('right');
    expect(parseFloat(bubble.style.left)).toBeGreaterThan(306);
    // jsdom no mide el globo (alto 0): su centro queda justo a la altura del mouse.
    expect(parseFloat(bubble.style.top)).toBe(500);
    expect(bubble.style.getPropertyValue('--arrow-y')).not.toBe('');
  });
});
