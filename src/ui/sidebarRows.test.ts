// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearOpenedFromOverview, goToRow, markOpenedFromOverview, openedFromOverview, overviewTarget, sidebarStep, TREE_GO_EVENT, type TreeGo } from './sidebarRows';

// La barra lateral como un solo recorrido (D806): el Overview y el árbol de Pages, en el orden en que se ven.

function bar(): HTMLElement {
  document.body.innerHTML = `
    <div class="sidebar-scroll">
      <div class="scene-nav ov-nav">
        <div class="ov-part"><a class="ov-part-name" href="/map/locations">Locations</a></div>
        <div class="ov-part"><a class="ov-part-name" href="/map/scenes">Scenes</a></div>
        <button class="scene-nav-ep">Episode 105</button>
        <a class="scene-nav-row active" href="/map/scenes?scene=105_025">025</a>
        <a class="scene-nav-row" href="/map/scenes?scene=105_026">026</a>
        <button class="scene-nav-more">Show 60 more</button>
        <div class="ov-part"><a class="ov-part-name" href="/map/pending">Pending</a></div>
      </div>
      <div class="pages-section">
        <div role="tree">
          <div class="tree-row" data-page="guia" tabindex="0">Guía</div>
          <div class="tree-row" data-page="pre" tabindex="-1">Preproducción</div>
        </div>
      </div>
    </div>`;
  return document.querySelector('.sidebar-scroll')!;
}
const q = (sel: string) => document.querySelector<HTMLElement>(sel)!;

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('un solo recorrido', () => {
  it('↑ desde la primera página sube al Overview; ↓ desde lo último del Overview baja a Pages', () => {
    bar();
    expect(sidebarStep(q('[data-page="guia"]'), -1)?.textContent).toBe('Pending');
    expect(sidebarStep(q('a[href="/map/pending"]'), 1)?.dataset.page).toBe('guia');
    // Partes, episodios y filas, en orden; «Show 60 more» no es una fila.
    expect(sidebarStep(q('a[href="/map/scenes"]'), 1)?.textContent).toBe('Episode 105');
    expect(sidebarStep(q('a[href="/map/scenes?scene=105_026"]'), 1)?.textContent).toBe('Pending');
    // En los extremos de la barra, nada.
    expect(sidebarStep(q('a[href="/map/locations"]'), -1)).toBeNull();
    expect(sidebarStep(q('[data-page="pre"]'), 1)).toBeNull();
  });

  it('una fila del árbol la abre Sidebar; una del Overview se abre como un clic, y la marca va con el foco', () => {
    vi.useFakeTimers();
    bar();
    const got: TreeGo[] = [];
    const on = (e: Event) => got.push((e as CustomEvent<TreeGo>).detail);
    window.addEventListener(TREE_GO_EVENT, on);
    goToRow(q('[data-page="guia"]'), false);
    window.removeEventListener(TREE_GO_EVENT, on);
    expect(got).toEqual([{ id: 'guia', repeat: false }]);

    const row = q('a[href="/map/scenes?scene=105_026"]');
    const clicks = vi.fn((e: Event) => e.preventDefault());
    row.addEventListener('click', clicks);
    // Con la tecla apretada: la marca de elegida pasa enseguida; se abre al frenar.
    goToRow(row, true);
    expect(document.activeElement).toBe(row);
    expect([...document.querySelectorAll('.scene-nav-row.active')]).toEqual([row]);
    expect(clicks).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it('un episodio solo recibe el foco, y la marca vuelve a la fila abierta', () => {
    bar();
    goToRow(q('a[href="/map/scenes?scene=105_026"]'), true);
    goToRow(q('button.scene-nav-ep'), false);
    expect(document.activeElement).toBe(q('button.scene-nav-ep'));
    expect([...document.querySelectorAll('.scene-nav-row.active')].map((a) => a.textContent)).toEqual(['025']);
  });

  it('lo abierto desde el Overview se anota por destino: otra página abierta después no cuenta', () => {
    vi.useFakeTimers();
    expect(overviewTarget('/p/abc?w=x')).toBe('abc');
    expect(overviewTarget('/map/scenes?scene=105_025')).toBe('map');
    markOpenedFromOverview('abc');
    expect(openedFromOverview('abc')).toBe(true);
    expect(openedFromOverview('otra')).toBe(false);
    expect(openedFromOverview(null)).toBe(false);
    // Lo que abre el árbol la borra; y vence.
    clearOpenedFromOverview();
    expect(openedFromOverview('abc')).toBe(false);
    markOpenedFromOverview('abc');
    vi.advanceTimersByTime(6000);
    expect(openedFromOverview('abc')).toBe(false);
  });

  it('una locación sin página no se marca a mano, y lo pendiente no se abre si el foco se fue', () => {
    vi.useFakeTimers();
    bar();
    const loose = document.createElement('a');
    loose.className = 'scene-nav-row';
    loose.setAttribute('href', '/map/locations');
    q('.ov-nav').append(loose);
    goToRow(loose, true);
    expect(loose.classList.contains('active')).toBe(false);
    const row = q('a[href="/map/scenes?scene=105_026"]');
    const clicks = vi.fn((e: Event) => e.preventDefault());
    row.addEventListener('click', clicks);
    goToRow(row, true);
    q('[data-page="guia"]').focus();
    vi.advanceTimersByTime(1000);
    expect(clicks).not.toHaveBeenCalled();
    expect([...document.querySelectorAll('.scene-nav-row.active')].map((a) => a.textContent)).toEqual(['025']);
  });
});
