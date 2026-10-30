// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STUCK_CLASS, headRow, headShift, placeHeads } from './tableStickyHead';

// El encabezado de una tabla del editor queda pegado al bajar (D827).

function rect(top: number, height: number): DOMRect {
  return { top, bottom: top + height, height, left: 0, right: 600, width: 600, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
}

/** Una página con la barra de arriba y una tabla del editor: encabezado de 30 px y `body` filas de 40. */
function page(tableTop: number, { body = 5, head = true } = {}) {
  document.body.innerHTML = `
    <div class="topbar"></div>
    <div class="host"><div class="bn-editor"><div class="tableWrapper"><div class="tableWrapper-inner"><table><tbody>
      ${head ? '<tr><th>Decorado</th><th>Estado</th></tr>' : ''}
      ${'<tr><td>a</td><td>b</td></tr>'.repeat(body)}
    </tbody></table></div></div></div></div>`;
  document.querySelector('.topbar')!.getBoundingClientRect = () => rect(0, 52);
  const table = document.querySelector('table')!;
  const headHeight = head ? 30 : 0;
  table.getBoundingClientRect = () => rect(tableTop, headHeight + body * 40);
  [...table.rows].forEach((row, i) => {
    row.getBoundingClientRect = () => (head && i === 0 ? rect(tableTop, 30) : rect(tableTop + headHeight + (i - (head ? 1 : 0)) * 40, 40));
  });
  return { host: document.querySelector<HTMLElement>('.host')!, wrapper: document.querySelector<HTMLElement>('.tableWrapper')! };
}

describe('el encabezado pegado de las tablas del editor', () => {
  it('se corre lo que la tabla se metió debajo de la barra, hasta el lugar de la última fila', () => {
    expect(headShift(100, 230, 30, 52)).toBe(0);
    expect(headShift(52, 230, 30, 52)).toBe(0);
    expect(headShift(-48, 230, 30, 52)).toBe(100);
    // La última fila a la vista: el encabezado se va con ella.
    expect(headShift(-500, 230, 30, 52)).toBe(200);
    expect(headShift(-48, 230, 0, 52)).toBe(0);
  });

  it('el encabezado es la primera fila si tiene solo celdas de encabezado (no una columna ni una fila unida de abajo)', () => {
    // Fila y columna de encabezado, y una fila de abajo unida: quedó solo con una celda de encabezado.
    document.body.innerHTML = `<table><tbody>
      <tr><th>a</th><th>b</th></tr><tr><th>c</th><td>d</td></tr><tr><th colspan="2">unida</th></tr>
    </tbody></table>`;
    expect(headRow(document.querySelector('table')!)?.rowIndex).toBe(0);
    document.body.innerHTML = '<table><tbody><tr><th>a</th><td>b</td></tr><tr><th>c</th><th>d</th></tr></tbody></table>';
    expect(headRow(document.querySelector('table')!)).toBeNull();
  });

  it('marca la tabla y escribe el corrimiento solo mientras la tabla pasa por debajo de la barra', () => {
    let { host, wrapper } = page(200);
    placeHeads(host);
    expect(wrapper.classList.contains(STUCK_CLASS)).toBe(false);
    expect(wrapper.style.getPropertyValue('--sd-head-shift')).toBe('');

    ({ host, wrapper } = page(-48));
    placeHeads(host);
    expect(wrapper.classList.contains(STUCK_CLASS)).toBe(true);
    expect(wrapper.style.getPropertyValue('--sd-head-shift')).toBe('100px');

    // Tabla de 230 px: el encabezado no baja más de 200 (queda sobre la última fila).
    ({ host, wrapper } = page(-1000));
    placeHeads(host);
    expect(wrapper.style.getPropertyValue('--sd-head-shift')).toBe('200px');
  });

  it('una tabla sin renglón de encabezado no se toca', () => {
    const { host, wrapper } = page(-48, { head: false });
    placeHeads(host);
    expect(wrapper.classList.contains(STUCK_CLASS)).toBe(false);
    expect(wrapper.getAttribute('style')).toBeNull();
  });

  it('al volver arriba se saca la marca y el corrimiento', () => {
    const { host, wrapper } = page(-48);
    placeHeads(host);
    document.querySelector('table')!.getBoundingClientRect = () => rect(300, 230);
    placeHeads(host);
    expect(wrapper.classList.contains(STUCK_CLASS)).toBe(false);
    expect(wrapper.style.getPropertyValue('--sd-head-shift')).toBe('');
  });

  it('sin la barra de la página en la caja que desplaza (la vista previa del historial), se pega al borde de esa caja', () => {
    const { wrapper } = page(-48);
    const preview = document.createElement('div');
    preview.style.overflowY = 'auto';
    preview.getBoundingClientRect = () => rect(44, 700);
    document.body.appendChild(preview);
    const host = document.querySelector<HTMLElement>('.host')!;
    preview.appendChild(host);
    placeHeads(host);
    // La tabla arranca en -48: se metió 92 px debajo del borde de la caja (44), no 100 debajo de la barra de la página.
    expect(wrapper.style.getPropertyValue('--sd-head-shift')).toBe('92px');
  });

  it('el CSS corre solo las celdas de la primera fila de encabezado, con fondo, y la impresión saca la marca', () => {
    const css = readFileSync(resolve(__dirname, '../styles.css'), 'utf8');
    expect(css).toContain(`.bn-editor .tableWrapper.${STUCK_CLASS} tr:first-child:not(:has(> td)) > th {`);
    expect(css).toContain('transform: translateY(var(--sd-head-shift, 0px));');
    expect(css).toMatch(/sd-head-stuck tr:first-child:not\(:has\(> td\)\) > th:not\(\[data-background-color\]\) \{\s*background-color: var\(--surface\);/);
    expect(readFileSync(resolve(__dirname, 'printView.ts'), 'utf8')).toContain(`'${STUCK_CLASS}'`);
  });
});
