// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipLayer } from './Tooltip';

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
