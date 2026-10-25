// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { revealRow, topCover } from './treeNav';

// Lo que queda pegado arriba al bajar por la barra (D771): el título de la sección y las madres abiertas de una fila
// tapan el borde de arriba, y llevar una fila a la vista la deja debajo de ellas, no escondida.

const rect = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 200, width: 200, x: 0, y: top, toJSON: () => ({}) });

/** La barra: «Pages» › madre abierta › fila, y una hermana pegajosa que no es de la fila (otra madre abierta). */
function sidebar() {
  document.body.innerHTML = `
    <nav class="sidebar">
      <div class="scene-nav"><button class="sticky-head" id="scenes"></button></div>
      <div class="pages-section">
        <div class="section-title sticky-head" id="pages"></div>
        <ul>
          <li><div class="tree-row sticky-head" id="other"></div><ul><li><div class="tree-row" id="o1"></div></li></ul></li>
          <li><div class="tree-row sticky-head" id="mother"></div><ul><li><div class="tree-row" id="row"></div></li></ul></li>
        </ul>
      </div>
    </nav>`;
  for (const id of ['scenes', 'pages', 'other', 'mother']) document.getElementById(id)!.getBoundingClientRect = () => rect(0, 32);
  return { nav: document.querySelector<HTMLElement>('.sidebar')!, row: document.getElementById('row')! };
}

describe('topCover', () => {
  it('suma solo el título de su sección y sus madres abiertas', () => {
    const { nav, row } = sidebar();
    // «Pages» y la madre: no *Scenes* (otro bloque) ni la otra madre abierta (no contiene a la fila).
    expect(topCover(row, nav)).toBe(64);
  });
  it('una madre pegajosa no se cuenta a sí misma', () => {
    const { nav } = sidebar();
    expect(topCover(document.getElementById('mother')!, nav)).toBe(32);
  });
});

describe('revealRow con lo pegado arriba', () => {
  it('una fila escondida arriba queda debajo de las pegadas, con su aire', () => {
    const { nav, row } = sidebar();
    Object.defineProperty(nav, 'clientHeight', { value: 300 });
    nav.getBoundingClientRect = () => rect(0, 300);
    nav.scrollTop = 1000;
    row.getBoundingClientRect = () => rect(10, 32);
    // Tapada por los 64 px de arriba: sube 64 - 10 + 8.
    expect(revealRow(row, nav)).toBe(-62);
  });
  it('una fila que se ve debajo de las pegadas no se mueve', () => {
    const { nav, row } = sidebar();
    Object.defineProperty(nav, 'clientHeight', { value: 300 });
    nav.getBoundingClientRect = () => rect(0, 300);
    nav.scrollTop = 1000;
    row.getBoundingClientRect = () => rect(70, 32);
    expect(revealRow(row, nav)).toBe(0);
  });
});

describe('revealRow con el margen de la cámara (iPhone)', () => {
  it('lo pegado arranca después del margen de arriba que no descuenta --sticky-top', () => {
    const { nav, row } = sidebar();
    // 16 px de la barra + 44 de la cámara; lo pegado se corre 16: arranca a 44 del borde.
    nav.style.paddingTop = '60px';
    nav.style.setProperty('--sticky-top', '-16px');
    Object.defineProperty(nav, 'clientHeight', { value: 600 });
    nav.getBoundingClientRect = () => rect(0, 600);
    nav.scrollTop = 1000;
    row.getBoundingClientRect = () => rect(100, 32);
    // Tapada hasta 44 + 64 = 108: sube 108 - 100 + 8.
    expect(revealRow(row, nav)).toBe(-16);
  });
});

