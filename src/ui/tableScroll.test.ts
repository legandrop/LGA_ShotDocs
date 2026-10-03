// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NARROW_QUERY, revealCell, revealSelectionCell, selectionCell } from './tableScroll';

// La celda con el cursor a la vista en una tabla que se desplaza de costado (P.28): solo mueve el contenedor de la
// tabla, solo de costado, solo en pantalla angosta y nunca toca el documento.

interface Rect {
  left: number;
  right: number;
}

/** Un contenedor de 300 px (con relleno de 10 a la izquierda y 20 a la derecha) y una tabla de 700 px adentro. */
function setup(cellAt: Rect, scrollLeft = 0, tableWidth = 700) {
  document.body.innerHTML =
    '<div class="bn-editor"><div class="tableWrapper" style="padding: 0 20px 0 10px"><table><tbody><tr><td><p>x</p></td></tr></tbody></table></div></div>';
  const wrapper = document.querySelector<HTMLElement>('.tableWrapper')!;
  const cell = document.querySelector<HTMLElement>('td')!;
  Object.defineProperty(wrapper, 'clientWidth', { value: 300, configurable: true });
  Object.defineProperty(wrapper, 'scrollWidth', { value: tableWidth, configurable: true });
  // jsdom no desplaza: el contenedor guarda su propio valor.
  let left = scrollLeft;
  Object.defineProperty(wrapper, 'scrollLeft', { get: () => left, set: (v: number) => void (left = v), configurable: true });
  wrapper.getBoundingClientRect = () => ({ left: 0, right: 300, top: 0, bottom: 100, width: 300, height: 100, x: 0, y: 0, toJSON: () => ({}) });
  // La celda se mueve con lo que se desplazó el contenedor.
  cell.getBoundingClientRect = () => {
    const shift = left - scrollLeft;
    return { left: cellAt.left - shift, right: cellAt.right - shift, top: 0, bottom: 30, width: cellAt.right - cellAt.left, height: 30, x: 0, y: 0, toJSON: () => ({}) };
  };
  return { wrapper, cell };
}

function select(el: Element) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(true);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('revealCell', () => {
  it('una celda que ya se ve entera no mueve nada', () => {
    const { wrapper, cell } = setup({ left: 20, right: 120 });
    expect(revealCell(wrapper, cell)).toBe(false);
    expect(wrapper.scrollLeft).toBe(0);
  });

  it('una celda cortada por la derecha se corre lo justo para entrar (sin el relleno de la derecha)', () => {
    const { wrapper, cell } = setup({ left: 220, right: 320 });
    expect(revealCell(wrapper, cell)).toBe(true);
    // Lo visible llega a 280 (300 menos el relleno de 20): la celda termina ahí.
    expect(wrapper.scrollLeft).toBe(40);
    expect(cell.getBoundingClientRect().right).toBe(280);
  });

  it('una celda cortada por la izquierda se corre hacia atrás, hasta el relleno de la izquierda', () => {
    const { wrapper, cell } = setup({ left: -30, right: 70 }, 200);
    expect(revealCell(wrapper, cell)).toBe(true);
    expect(wrapper.scrollLeft).toBe(160);
    expect(cell.getBoundingClientRect().left).toBe(10);
  });

  it('si la tabla entra en el contenedor no hace nada (la compu con tablas que caben)', () => {
    const { wrapper, cell } = setup({ left: 220, right: 320 }, 0, 300);
    expect(revealCell(wrapper, cell)).toBe(false);
    expect(wrapper.scrollLeft).toBe(0);
  });

  it('una celda más ancha que lo visible no hace nada: el cursor lo lleva el editor', () => {
    const { wrapper, cell } = setup({ left: 100, right: 450 });
    expect(revealCell(wrapper, cell)).toBe(false);
    expect(wrapper.scrollLeft).toBe(0);
  });
});

describe('revealSelectionCell', () => {
  it('encuentra la celda del cursor y su contenedor', () => {
    const { wrapper, cell } = setup({ left: 220, right: 320 });
    select(cell.querySelector('p')!);
    expect(selectionCell()).toEqual({ cell, wrapper });
  });

  it('un cursor fuera de una tabla no es una celda', () => {
    setup({ left: 0, right: 10 });
    document.body.insertAdjacentHTML('beforeend', '<div class="bn-editor"><p id="o">afuera</p></div>');
    select(document.getElementById('o')!);
    expect(selectionCell()).toBeNull();
  });

  it('en pantalla angosta acomoda la celda; en pantalla ancha no toca nada', () => {
    const { wrapper, cell } = setup({ left: 220, right: 320 });
    select(cell.querySelector('p')!);
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === NARROW_QUERY }));
    expect(revealSelectionCell()).toBe(true);
    expect(wrapper.scrollLeft).toBe(40);

    wrapper.scrollLeft = 0;
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(revealSelectionCell()).toBe(false);
    expect(wrapper.scrollLeft).toBe(0);
  });
});
