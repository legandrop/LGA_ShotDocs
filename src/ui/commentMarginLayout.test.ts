import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCss, px, rootVars, ruleValue, styleOf } from '../test/cssLayout';

// Superposición del botón de comentar y del contador de comentarios con el texto en el teléfono (roadmap P.28;
// Doc_Tabla_Telefono.md). `commentButtonPhone.test.ts` lee el texto de la hoja (`width: var(--gutter)`): un cambio del margen
// o del ancho que dejara otra forma del mismo texto lo rompería sin que el diseño se enterara, o al revés. Esta prueba
// calcula el diseño desde los VALORES del CSS que valen en una pantalla de teléfono (cascada, `!important`, `var()`,
// abreviadas):
//   - el texto termina a `padding-right` del borde derecho (el del editor, `.bn-editor`, más el de la página);
//   - el botón está pegado al borde con `right` y mide lo que mide su `width` (o `min-width`, o su contenido si es mayor);
//   - se tapan si `ancho + right > margen`.
// jsdom no calcula el diseño de verdad, así que la medida real en un navegador es `scripts/medir-telefono.mjs` (a 360, 375,
// 390 y 414 px con 1, 12 y 120 comentarios); su medida y esta cuenta coinciden (20 px de botón y 20 de margen).

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const tsx = readFileSync(new URL('./EditorComments.tsx', import.meta.url), 'utf8');

/** El ancho de un dígito del contador, en em: con la tipografía de la app a 10 px mide 5,7 px (0,57 em); se redondea hacia arriba. */
const DIGIT_EM = 0.6;
/** Los dígitos del contador que tienen que caber sin crecer: 120 comentarios en un bloque (con 4 el ancho crece, ya documentado). */
const DIGITS = 3;

const WIDTHS = [360, 375, 390, 414, 430, 760];

/** El ancho de la hoja de estilos `source` en una pantalla de `screen` px: margen del texto y ancho y `right` de cada botón. */
function layout(source: string, screen: number) {
  const decls = parseCss(source, screen);
  const vars = rootVars(decls);
  const num = (value: string | undefined) => px(value, vars);

  // El texto termina a esto del borde derecho de la pantalla.
  const margin = num(styleOf(decls, 'div', ['bn-editor']).get('padding-right')) + num(styleOf(decls, 'div', ['page']).get('padding-right'));

  const button = (cls: string) => styleOf(decls, 'button', ['comment-margin-button', cls]);
  const border = (s: Map<string, string>) => num(s.get('border-width'));
  const padX = (s: Map<string, string>) => num(s.get('padding-left')) + num(s.get('padding-right'));

  // Botón de comentar: el ancho que declara, o su ícono (el tamaño sale del componente) si éste fuera mayor.
  const add = button('comment-add');
  const addIcon = Number(/<CommentIcon size=\{(\d+)\} \/>\s*<\/button>/.exec(tsx.slice(tsx.indexOf('comment-margin-button comment-add')))?.[1]);
  const addWidth = Math.max(num(add.get('width')), addIcon + padX(add) + 2 * border(add));

  // Contador: el `min-width` que declara, o su contenido (globo arriba y número abajo) si es mayor.
  const count = button('comment-count');
  const iconWidth = num(ruleValue(decls, '.comment-count svg', 'width'));
  const digitsWidth = DIGITS * num(count.get('font-size')) * DIGIT_EM;
  const countWidth = Math.max(
    count.has('min-width') ? num(count.get('min-width')) : 0,
    Math.max(iconWidth, digitsWidth) + padX(count) + 2 * border(count),
  );

  return {
    margin,
    add: { width: addWidth, right: num(add.get('right')) },
    count: { width: countWidth, right: num(count.get('right')) },
  };
}

describe.each(WIDTHS)('en una pantalla de %i px', (screen) => {
  const l = layout(css, screen);

  it('el cálculo entiende el CSS (nada da NaN) y el margen es el del teléfono', () => {
    for (const n of [l.margin, l.add.width, l.add.right, l.count.width, l.count.right]) {
      expect(Number.isNaN(n), JSON.stringify(l)).toBe(false);
    }
    // El margen del teléfono es el de `--gutter` (20 px a 760 px o menos), no el de la compu (54).
    expect(l.margin).toBeGreaterThan(0);
    expect(l.margin).toBeLessThan(54);
  });

  it('el botón de comentar no tapa el final del texto ni se sale de la pantalla', () => {
    // Pegado al borde o más adentro: nunca afuera (cortaba el botón y corría la página).
    expect(l.add.right).toBeGreaterThanOrEqual(0);
    // El texto termina a `margin` del borde derecho; el botón empieza a `width + right`.
    expect(l.add.width + l.add.right).toBeLessThanOrEqual(l.margin);
  });

  it('el contador (con 120 comentarios) tampoco', () => {
    expect(l.count.right).toBeGreaterThanOrEqual(0);
    expect(l.count.width + l.count.right).toBeLessThanOrEqual(l.margin);
  });
});

describe('a 761 px (fuera del teléfono) el cálculo usa las reglas de la compu', () => {
  it('el margen (--gutter) es de 54 px y el botón de 28', () => {
    expect(rootVars(parseCss(css, 761)).get('--gutter')).toBe('54px');
    expect(layout(css, 761).add.width).toBe(28);
  });
});

// El cálculo tiene que avisar de verdad: la hoja mutada (lo que haría un cambio descuidado) da una superposición.
describe('el cálculo detecta un cambio de margen o de ancho', () => {
  const swap = (from: RegExp, to: string) => {
    expect(css).toMatch(from);
    return css.replace(from, to);
  };
  const overlap = (c: string) => {
    const l = layout(c, 375);
    return Math.max(l.add.width + l.add.right, l.count.width + l.count.right) - l.margin;
  };

  it('referencia: la hoja de hoy no tapa', () => {
    expect(overlap(css)).toBeLessThanOrEqual(0);
  });

  // Los cambios son grandes a propósito: lo que se prueba es que el cálculo se entera, no un número de margen en particular.
  it('un botón mucho más ancho que el margen tapa', () => {
    expect(overlap(swap(/(\.comment-add \{\n {4}width:) var\(--gutter\)/, '$1 60px'))).toBeGreaterThan(0);
  });

  it('un margen de 8 px (los botones miden el margen) no alcanza para el contenido del contador', () => {
    // Todo el diseño sigue a `--gutter`: al achicarlo, el globo de 12 px y los tres dígitos del número ya no entran.
    expect(overlap(swap(/(@media \(max-width: 760px\) \{\n {2}:root \{\n {4}--gutter:) \d+px/, '$1 8px'))).toBeGreaterThan(0);
  });

  it('un margen del editor más chico que el botón tapa', () => {
    expect(overlap(swap(/(\.bn-editor \{\n {4}padding-inline:) var\(--gutter\)( !important)/, '$1 1px$2'))).toBeGreaterThan(0);
  });

  it('un contador con el número más grande (14 px) tapa', () => {
    expect(overlap(swap(/(\.comment-count \{\n(?: {4}[^\n]*\n)*? {4}font-size:) 10px/, '$1 14px'))).toBeGreaterThan(0);
  });

  it('un botón corrido para afuera se sale de la pantalla', () => {
    const l = layout(swap(/(\.comment-count,\n {2}\.comment-add \{\n {4}right: )0;/, '$1-4px;'), 375);
    expect(l.add.right).toBe(-4);
    expect(l.count.right).toBe(-4);
  });
});
