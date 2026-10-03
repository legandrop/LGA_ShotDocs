import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NARROW_QUERY } from './tableScroll';

// La tabla en el teléfono (P.28) es presentación pura en styles.css: el medido de verdad (Chromium a 375 px, tablas de
// 680 px, la compu y el PDF sin cambios) está en el recorrido de Docs/Doc_Tabla_Telefono.md. Acá se cuida lo que no
// se debe perder en una edición del CSS: que valga solo en pantalla angosta, solo en la página abierta (no en la vista
// de impresión ni en el armado del PDF de exportar) y que no toque el documento.

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** El bloque `@media (max-width: 760px)` que lleva las reglas de las tablas. */
function tableBlock(): string {
  const at = css.indexOf('table:not(:has(:is(td, th):not([colwidth])))');
  expect(at).toBeGreaterThan(0);
  const start = css.lastIndexOf('@media (max-width: 760px) {', at);
  expect(start).toBeGreaterThan(0);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error('bloque sin cerrar');
}

describe('la tabla en una pantalla angosta (styles.css)', () => {
  it('usa la misma pantalla angosta que el código que acomoda la celda', () => {
    expect(NARROW_QUERY).toBe('(max-width: 760px)');
    expect(tableBlock().startsWith('@media (max-width: 760px) {')).toBe(true);
  });

  it('todas sus reglas valen solo en la página abierta: ni la vista de impresión ni el PDF', () => {
    const selectors = tableBlock().match(/^ {2}\.page[^{]*\{/gm) ?? [];
    expect(selectors.length).toBe(3);
    for (const s of selectors) expect(s).toContain('.page:not(.sd-export-source) .bn-editor');
    expect(tableBlock()).not.toContain('.print-view');
  });

  it('el piso de ancho es de 96 px (el ancho de fábrica del reporte) y solo en las celdas con ancho guardado', () => {
    expect(tableBlock()).toMatch(/:is\(td, th\)\[colwidth\] \{\s*min-width: 96px !important;/);
  });

  it('una tabla con todos sus anchos guardados mide la suma de esos anchos', () => {
    expect(tableBlock()).toMatch(/table:not\(:has\(:is\(td, th\):not\(\[colwidth\]\)\)\) \{\s*width: max-content !important;/);
  });

  it('el desplazamiento queda dentro del bloque de la tabla: la página no se mueve de costado', () => {
    expect(tableBlock()).toMatch(/\.tableWrapper \{[^}]*overscroll-behavior-x: contain;/);
    // El recorte y el desplazamiento del contenedor son de BlockNote (overflow-y: hidden hace al otro eje `auto`): no se pisan.
    expect(tableBlock()).not.toMatch(/overflow(-x)?:\s*visible/);
  });
});
