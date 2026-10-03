import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TABLE_SCROLL_QUERY } from './tableScroll';

// La tabla en el teléfono (P.28) es presentación pura en styles.css: el medido de verdad (Chromium a 375 px y a 768 y
// 834 px de tablet vertical, tablas de 680 px, la compu y el PDF sin cambios) está en el recorrido de
// Docs/Doc_Tabla_Telefono.md. Acá se cuida lo que no se debe perder en una edición del CSS: que valga solo hasta 1024
// px (teléfono y tablet), solo en la página abierta (no en la vista de impresión ni en el armado del PDF de exportar) y
// que no toque el documento.

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** El bloque `@media (max-width: 1024px)` que lleva las reglas de las tablas. */
function tableBlock(): string {
  const at = css.indexOf("[data-content-type='table'] :is(td, th)[colwidth]");
  expect(at).toBeGreaterThan(0);
  const start = css.lastIndexOf('@media (max-width: 1024px) {', at);
  expect(start).toBeGreaterThan(0);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error('bloque sin cerrar');
}

describe('la tabla en una pantalla angosta (styles.css)', () => {
  it('usa el mismo corte que el código que acomoda la celda: 1024 px, no los 760 del teléfono (tablet vertical)', () => {
    expect(TABLE_SCROLL_QUERY).toBe('(max-width: 1024px)');
    expect(tableBlock().startsWith('@media (max-width: 1024px) {')).toBe(true);
    // El corte va solo para las tablas: ninguna otra regla de este bloque, ni de más abajo, se mudó a 1024.
    expect(css.match(/@media \(max-width: 1024px\) \{/g)?.length).toBe(1);
  });

  it('todas sus reglas valen solo en la página abierta: ni la vista de impresión ni el PDF', () => {
    const selectors = tableBlock().match(/^ {2}\.page[^{]*\{/gm) ?? [];
    expect(selectors.length).toBe(2);
    for (const s of selectors) expect(s).toContain('.page:not(.sd-export-source) .bn-editor');
    expect(tableBlock()).not.toContain('.print-view');
  });

  it('el piso de ancho es de 96 px (el ancho de fábrica del reporte) y solo en las celdas con ancho guardado', () => {
    expect(tableBlock()).toMatch(/:is\(td, th\)\[colwidth\] \{\s*min-width: 96px !important;/);
  });

  it('no fuerza el ancho de la tabla (D244): una que entra en la pantalla con columnas de 96 px o más no se desplaza', () => {
    expect(tableBlock()).not.toMatch(/max-content|[^-]width:|table-layout/);
  });

  it('el desplazamiento queda dentro del bloque de la tabla: la página no se mueve de costado', () => {
    expect(tableBlock()).toMatch(/\.tableWrapper \{[^}]*overscroll-behavior-x: contain;/);
    // El recorte y el desplazamiento del contenedor son de BlockNote (overflow-y: hidden hace al otro eje `auto`): no se pisan.
    expect(tableBlock()).not.toMatch(/overflow(-x)?:\s*visible/);
  });
});
