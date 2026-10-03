import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// El botón de comentar del margen en el teléfono (roadmap P.28; Doc_Tabla_Telefono.md, "El botón de comentar"): el margen
// de la página mide `--gutter` (20 px a 760 px o menos) y el botón (28 px de siempre) tapaba hasta 8 px del final de un
// renglón muy largo. Ahora mide justo el margen. El diseño en pantalla se midió en Chromium a 375 y 390 px (el informe del
// frente); acá se fija lo que lo produce en el CSS.

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** Todos los bloques `@media (max-width: 760px) { ... }` del archivo, con sus llaves. */
function phoneBlocks(): string[] {
  const out: string[] = [];
  const head = '@media (max-width: 760px) {';
  for (let at = css.indexOf(head); at >= 0; at = css.indexOf(head, at + 1)) {
    let depth = 0;
    let end = at;
    for (let i = at + head.length - 1; i < css.length; i++) {
      if (css[i] === '{') depth++;
      if (css[i] === '}' && --depth === 0) {
        end = i + 1;
        break;
      }
    }
    out.push(css.slice(at, end));
  }
  return out;
}

/** El cuerpo de la regla que empieza por `selector` solo (no al final de una lista de selectores separados por comas). */
function rule(block: string, selector: string): string | null {
  const escaped = selector.replace(/[.:]/g, '\$&');
  const m = new RegExp(`(?<!,)\n {2}${escaped} \{([^}]*)\}`).exec(block);
  return m ? m[1] : null;
}

describe('el botón de comentar del margen en el teléfono', () => {
  const block = phoneBlocks().find((b) => rule(b, '.comment-add') !== null)!;

  it('mide el margen de la página (--gutter) y no 28 px: no tapa el final de un renglón largo', () => {
    expect(block).toBeTruthy();
    expect(rule(block, '.comment-add')).toMatch(/width:\s*var\(--gutter\)\s*;/);
    // El margen del teléfono es de 20 px: el botón entra justo.
    expect(phoneBlocks().some((b) => /--gutter:\s*20px;/.test(b))).toBe(true);
    // De fábrica sigue en 28 px (la compu y la tablet no cambian), y está pegado al borde, adentro de la pantalla.
    expect(css).toMatch(/\.comment-add \{\n {2}width: 28px;/);
    expect(block).toMatch(/\.comment-count,\n {2}\.comment-add \{\n {4}right: 0;/);
  });

  it('el dedo tiene el área de siempre: se estira para arriba y para abajo, nunca hacia el texto', () => {
    const after = rule(block, '.comment-add::after')!;
    expect(after).toMatch(/content:\s*''/);
    // Solo vertical: `inset: -10px 0` (arriba y abajo, nada a los costados).
    expect(after).toMatch(/inset:\s*-10px 0;/);
  });
});
