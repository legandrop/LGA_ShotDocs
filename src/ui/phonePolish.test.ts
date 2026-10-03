import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Pulido del teléfono (tanda 16): lo que jsdom no calcula se mide en Chromium (Docs/Doc_Tabla_Telefono.md y el roadmap,
// P.13, P.16 y P.28). Acá se cuida el texto del CSS para que una edición no deshaga lo arreglado.

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** El cuerpo de la primera regla `selector { ... }` que empieza en `from`. */
function ruleAfter(from: number, selector: string): string {
  const at = css.indexOf(selector, from);
  expect(at).toBeGreaterThan(from - 1);
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
}

describe('el botón de comentar del margen en el teléfono', () => {
  it('queda pegado al borde (right: 0), no 4 px afuera: afuera se cortaba y la página se arrastraba de costado', () => {
    // La regla de teléfono de `.comment-count, .comment-add` (la de la hoja de comentarios, dentro de 760 px).
    const start = css.indexOf('/* Pegado al borde de la pantalla');
    expect(start).toBeGreaterThan(0);
    const body = ruleAfter(start, '.comment-add');
    expect(body.trim()).toBe('right: 0;');
    expect(css).not.toMatch(/\.comment-add \{\s*right: -4px/);
  });

  it('la regla de la compu no cambia (a la derecha del texto, adentro del margen)', () => {
    const at = css.indexOf('.comment-count,\n.comment-add {');
    expect(at).toBeGreaterThan(0);
    expect(ruleAfter(at, '.comment-count,\n.comment-add').replace(/\s+/g, ' ')).toContain('right: max(0px, calc(var(--gutter) / 2 - 16px));');
  });
});

describe('el punto del botón de menú de la barra de arriba', () => {
  it('es el mismo del "?" (7 px, de acento) y el botón le sirve de ancla', () => {
    const at = css.indexOf('.icon-button.has-dot::after {');
    expect(at).toBeGreaterThan(0);
    const body = ruleAfter(at, '.icon-button.has-dot::after').replace(/\s+/g, ' ');
    expect(body).toContain('width: 7px');
    expect(body).toContain('height: 7px');
    // Adentro del botón (esquina de arriba a la derecha), como el del "?": medido en Chromium, acá solo el texto.
    expect(body).toContain('top: 7px');
    expect(body).toContain('right: 7px');
    expect(body).toContain('background: var(--accent)');
    expect(css).toMatch(/\.icon-button\.has-dot \{\s*position: relative;/);
  });
});
