// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { centerDelta, revealRow, topCover } from './treeNav';

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


describe('centerDelta: el centro de lo que se ve, debajo de lo que de verdad queda pegado', () => {
  /** La barra de 300 px; dónde estarían «Pages» y la madre sin pegarse (el borde de arriba de su bloque) y la fila. */
  function at(pagesTop: number, motherTop: number, rowTop: number) {
    const { nav, row } = sidebar();
    Object.defineProperty(nav, 'clientHeight', { value: 300 });
    nav.getBoundingClientRect = () => rect(0, 300);
    document.querySelector<HTMLElement>('.pages-section')!.getBoundingClientRect = () => rect(pagesTop, 400);
    document.getElementById('mother')!.parentElement!.getBoundingClientRect = () => rect(motherTop, 64);
    row.getBoundingClientRect = () => rect(rowTop, 32);
    return centerDelta(row, nav);
  }
  it('las dos pegadas: el centro de lo que queda debajo de los 64 px', () => {
    // Centro de la fila 266; centro de 64…300, 182.
    expect(at(-500, -200, 250)).toBe(84);
  });
  it('ninguna llega a pegarse: el centro de la barra entera', () => {
    // Con «Pages» y la madre en su lugar, arriba de la fila: centro de la fila 88, de la barra 150.
    expect(at(0, 40, 72)).toBe(-62);
  });
  it('solo «Pages» se pega: el centro de lo que queda debajo de sus 32 px', () => {
    // Centro de la fila 198; centro de 32…300, 166. La madre queda a 118, debajo de su lugar pegado (32).
    expect(at(-500, 150, 182)).toBe(32);
  });
  it('una madre justo en el borde (se pega con un desplazamiento y no con el otro): queda justo en su lugar pegado', () => {
    // Con 64 px tapados bajaría 84 y la madre no se pegaría; con 32, bajaría 100 y se pegaría. Queda en 88: la madre,
    // de 120, justo en su lugar (32).
    expect(at(-500, 120, 250)).toBe(88);
  });
});
