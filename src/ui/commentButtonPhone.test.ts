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

// El contador de comentarios (`.comment-count`, globo y número) en el teléfono (restos de la tanda 17, roadmap P.28): uno al
// lado del otro medía 40 a 55 px (1, 12 y 120 comentarios) y pasaba hasta 35 px sobre el final de un renglón largo. Ahora el
// globo va arriba y el número abajo, en una pastilla del ancho del margen. La medida real (Chromium a 360, 375, 390 y 414 px:
// superposición con el texto de 19,8 / 27,2 / 35,2 px a 0 con 1, 12 y 120 comentarios) está en el informe del frente; acá se
// fija lo que la produce en el CSS.
describe('el contador de comentarios del margen en el teléfono', () => {
  const block = phoneBlocks().find((b) => rule(b, '.comment-count') !== null)!;

  it('es una pastilla del ancho del margen, con el globo arriba y el número abajo', () => {
    expect(block).toBeTruthy();
    const r = rule(block, '.comment-count')!;
    // Del ancho del margen como mínimo (crece solo si el número no entra, nunca recortado) y nunca más ancho de entrada.
    expect(r).toMatch(/min-width:\s*var\(--gutter\)\s*;/);
    expect(r).not.toMatch(/(?<!-)width:/);
    expect(r).toMatch(/flex-direction:\s*column\s*;/);
    expect(r).toMatch(/padding:\s*2px 0\s*;/);
    // Pegado al borde, como el botón de comentar (misma regla de `right: 0`).
    expect(block).toMatch(/\.comment-count,\n {2}\.comment-add \{\n {4}right: 0;/);
    // El globo (12 px) cabe en el margen de 20 px.
    expect(rule(block, '.comment-count svg')).toMatch(/width:\s*12px\s*;[^}]*height:\s*12px\s*;/);
  });

  it('en la compu y la tablet sigue como siempre: globo y número uno al lado del otro', () => {
    // Fuera del teléfono ninguna regla del contador lo apila ni lo achica.
    const base = css.slice(css.indexOf('.comment-margin-button {'), css.indexOf('.comment-add {'));
    expect(base).not.toMatch(/flex-direction/);
    expect(base).not.toMatch(/min-width/);
    expect(base).toMatch(/\.comment-margin-button \{[^}]*height:\s*24px;[^}]*padding:\s*0 7px;/);
    // Y el único lugar donde se apila es el bloque de teléfono (760 px o menos).
    const outside = phoneBlocks().reduce((s, b) => s.replace(b, ''), css);
    expect(outside).not.toMatch(/\.comment-count[^{]*\{[^}]*flex-direction/);
  });

  it('no se pisa con el contador del bloque de abajo: alto de la pastilla <= 30 px (el paso de dos renglones sueltos)', () => {
    const r = rule(block, '.comment-count')!;
    const px = (re: RegExp, text: string) => Number(re.exec(text)?.[1]);
    const padding = px(/padding:\s*(\d+)px 0/, r) * 2;
    const gap = px(/gap:\s*(\d+)px/, r);
    const font = px(/font-size:\s*(\d+)px/, r); // `.comment-margin-button` tiene `line-height: 1`
    const icon = px(/height:\s*(\d+)px/, rule(block, '.comment-count svg')!);
    expect(css).toMatch(/\.comment-margin-button \{[^}]*line-height:\s*1;/);
    const border = 2;
    expect(padding + gap + font + icon + border).toBeLessThanOrEqual(30);
  });

  it('el dedo tiene área de sobra: se estira para arriba y para abajo, nunca hacia el texto', () => {
    const after = rule(block, '.comment-count::after')!;
    expect(after).toMatch(/content:\s*''/);
    expect(after).toMatch(/inset:\s*-8px 0;/);
  });
});
