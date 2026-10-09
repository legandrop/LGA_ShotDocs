// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { menuBelow, useFloating } from './menus';

// Un menú fijo a la ventana que con su ancho real no entra a la derecha se corre a la izquierda (auditoría de la v0.250:
// el menú ⋯ con «Dejar fuera de las relaciones · POR CARPETA» mide ~341 px y se colocaba con 290).

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

function Menu({ left, width, fit }: { left: number; width: number; fit?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFloating(ref, () => {}, null, false, false);
  return (
    <div
      ref={(el) => {
        ref.current = el;
        // jsdom no mide: el rectángulo sale de la posición y del ancho que el menú tendría.
        if (el)
          el.getBoundingClientRect = () => {
            const l = parseFloat(el.style.left) || 0;
            // `fit`: como un menú de verdad, que se ensancha hasta lo que queda a su derecha y hasta su tope (max-width).
            const w = fit ? Math.min(width, window.innerWidth - l, window.innerWidth - 16) : width;
            return { left: l, right: l + w, width: w, top: 40, bottom: 140, height: 100, x: l, y: 40, toJSON: () => ({}) } as DOMRect;
          };
      }}
      style={{ position: 'fixed', top: 40, left }}
    />
  );
}

function open(left: number, width: number, fit = false): HTMLDivElement {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<Menu left={left} width={width} fit={fit} />));
  return host.firstElementChild as HTMLDivElement;
}

describe('useFloating corrige también el eje horizontal', () => {
  it('un menú más ancho que lo previsto, pegado a la derecha, se corre hasta entrar', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    const el = open(92, 341); // colocado con 290 px: 390 − 290 − 8 = 92; termina en 433
    expect(parseFloat(el.style.left)).toBe(390 - 8 - 341);
  });

  it('en una pantalla angosta queda pegado al margen derecho', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 350 });
    const el = open(52, 320);
    expect(parseFloat(el.style.left)).toBe(350 - 8 - 320);
  });

  it('D710: más ancho que la pantalla (320 px): al correrlo se ensancha hasta su tope y se vuelve a medir, hasta quedar a 8 px', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    const el = open(22, 341, true); // colocado en 22: ahí mide 298 y termina en 320; corrido a 14 mide 304 y termina en 318
    expect(parseFloat(el.style.left)).toBe(8);
  });

  it('una hoja de borde a borde del teléfono no se toca', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    const el = open(0, 390);
    expect(parseFloat(el.style.left)).toBe(0);
  });

  it('un menú que entra queda donde estaba', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    const el = open(600, 341);
    expect(parseFloat(el.style.left)).toBe(600);
  });
});

describe('menuBelow (D710)', () => {
  const anchor = (left: number) => ({ getBoundingClientRect: () => ({ left, bottom: 40 }) }) as unknown as Element;
  it('un menú más ancho que la pantalla menos los márgenes va pegado al margen izquierdo', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    expect(menuBelow(anchor(250), 341)).toEqual({ top: 44, left: 8 });
    // Uno que entra se coloca como siempre: a la izquierda del botón, sin salir por la derecha.
    expect(menuBelow(anchor(250), 240)).toEqual({ top: 44, left: 72 });
    expect(menuBelow(anchor(10), 240)).toEqual({ top: 44, left: 10 });
  });
});


describe('el renglón largo del menú ⋯ en una pantalla angosta (D710)', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'styles.css'), 'utf8').replace(/\r\n/g, '\n');
  it('hasta 356 px el rótulo baja a dos renglones y el estado no se parte; el renglón entero (≈341 px + márgenes) entra desde 357', () => {
    const at = css.indexOf('@media (max-width: 356px) {');
    expect(at).toBeGreaterThan(0);
    const block = css.slice(at, css.indexOf('\n}\n', at));
    expect(block).toContain('.menu .leave-out {');
    expect(block).toMatch(/white-space: normal/);
    expect(block).toMatch(/\.menu \.leave-out \.check \{\s+white-space: nowrap/);
    // Fuera de esa pantalla, un solo renglón (D668).
    expect(css).toMatch(/\n\.menu \.leave-out \{\n {2}text-align: left;\n {2}white-space: nowrap;\n\}/);
    expect(341 + 16).toBe(357);
  });
});
