import { describe, expect, it } from 'vitest';
import { arrangeRows, groupRows, pxToRowWidth, ROW_PRESETS, rowHeights, snapRowWidth } from './imageRows';

// Fotos en fila (Docs/Doc_Imagenes.md): las filas del plugin, "Arrange in rows" y los tiradores, con números.
// Las alturas se miden con el mismo modelo que el CSS: `flex-basis = f · (W − (n − 1) · g)`.

const GAP = 8;
const WIDTHS = [343, 650, 700];
const V = 2 / 3;
const G = 8 / 700;
/** El alto ideal en unidades del ancho: una foto 3:2 a un tercio, descontando los espacios. */
const H = (1 - 2 * G) / 3 / 1.5;
/** Lo más alta que puede quedar una fila. */
const MAX = 2.2 * H;

const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);
const pick = <T,>(xs: readonly T[], idx: readonly number[]) => idx.map((i) => xs[i]);

/**
 * Lo que tiene que cumplir cualquier resultado de `arrangeRows`: mismo largo, filas de como mucho 4, todas
 * llenas menos la última, y cada fila a una sola altura con cualquier ancho. Devuelve las filas.
 */
function checkArrangement(aspects: readonly number[], fracs: readonly number[]): number[][] {
  expect(fracs).toHaveLength(aspects.length);
  for (const f of fracs) {
    expect(f).toBeGreaterThan(0);
    expect(f).toBeLessThanOrEqual(1);
    expect(Math.round(f * 1e4) / 1e4).toBe(f);
  }
  const rows = groupRows(fracs);
  // Cada foto en una fila, en orden y sin saltear ninguna.
  expect(rows.flat()).toEqual(aspects.map((_, i) => i));
  rows.forEach((row, r) => {
    expect(row.length).toBeLessThanOrEqual(4);
    const s = sum(pick(fracs, row));
    if (r < rows.length - 1) expect(Math.abs(s - 1)).toBeLessThan(1e-4);
    expect(s).toBeLessThanOrEqual(1 + 1e-6);
  });
  const a = aspects.map((x) => (Number.isFinite(x) && x > 0 ? x : 1.5));
  for (const W of WIDTHS) {
    const h = rowHeights(fracs, a, W, GAP);
    for (const row of rows) {
      // El redondeo a 4 decimales mueve cada ancho hasta 0,00005 (la última de una fila llena, lo que sumen
      // las otras): en px, una fracción de píxel.
      const tol = 0.01 + ((row.length + 1) * 0.5e-4 * W) / Math.min(...pick(a, row));
      const hs = pick(h, row);
      for (const x of hs) expect(Math.abs(x - hs[0])).toBeLessThan(tol);
    }
  }
  return rows;
}

describe('el modelo del CSS', () => {
  it('con f = a / Σa todas las fotos de una fila tienen la misma altura exacta, con cualquier ancho', () => {
    const a = [1.5, V, 16 / 9, 4 / 3];
    const f = a.map((x) => x / sum(a));
    for (const W of WIDTHS) {
      const h = rowHeights(f, a, W, GAP);
      const expected = (W - 3 * GAP) / sum(a);
      for (const x of h) expect(Math.abs(x - expected)).toBeLessThan(0.01);
    }
  });

  it('las fotos sin ancho propio no tienen altura de fila', () => {
    expect(rowHeights([0.5, 0, 0.5], [1.5, 1.5, 1.5], 700, GAP)).toEqual([350 / 1.5, 0, 350 / 1.5]);
  });
});

describe('groupRows', () => {
  it('dos de 1/2, tres de 1/3 y cuatro de 1/4 seguidas son una fila cada una', () => {
    const t = 1 / 3;
    expect(groupRows([0.5, 0.5, t, t, t, 0.25, 0.25, 0.25, 0.25])).toEqual([[0, 1], [2, 3, 4], [5, 6, 7, 8]]);
  });

  it('con 4 decimales tampoco se parte: 0,3333 + 0,3333 + 0,3334', () => {
    expect(groupRows([0.3333, 0.3333, 0.3334, 0.3333])).toEqual([[0, 1, 2], [3]]);
  });

  it('una que no entra en lo que queda empieza la fila siguiente', () => {
    expect(groupRows([0.5, 0.25, 0.5, 1, 0.3])).toEqual([[0, 1], [2], [3], [4]]);
  });

  it('una foto sin ancho o un bloque que no es foto (0) corta la fila y no entra en ninguna', () => {
    expect(groupRows([0.25, 0.25, 0, 0.25, 0.25])).toEqual([[0, 1], [3, 4]]);
    expect(groupRows([0, 0, 0])).toEqual([]);
    expect(groupRows([])).toEqual([]);
  });

  it('lo que no es un número corta como un 0', () => {
    expect(groupRows([0.5, Number.NaN, 0.5, -1, 0.5])).toEqual([[0], [2], [4]]);
  });

  it('la suma puede pasar de 1 por menos de una millonésima, no más', () => {
    expect(groupRows([0.5, 0.5 + 1e-7])).toEqual([[0, 1]]);
    expect(groupRows([0.5, 0.5001])).toEqual([[0], [1]]);
  });
});

describe('arrangeRows', () => {
  it('sin fotos, nada', () => {
    expect(arrangeRows([])).toEqual([]);
  });

  it('una foto horizontal: llena quedaría muy alta, se achica al alto máximo', () => {
    const f = arrangeRows([1.5]);
    checkArrangement([1.5], f);
    expect(f[0]).toBeCloseTo(1.5 * MAX, 4);
    expect(f[0]).toBeCloseTo(0.72, 2);
  });

  it('una foto vertical se achica al alto máximo', () => {
    const f = arrangeRows([V]);
    checkArrangement([V], f);
    expect(f[0]).toBeCloseTo(V * MAX, 4);
    expect(rowHeights(f, [V], 700, GAP)[0]).toBeCloseTo(700 * MAX, 0);
  });

  it('dos 3:2: una fila llena, mitad y mitad', () => {
    const f = arrangeRows([1.5, 1.5]);
    expect(checkArrangement([1.5, 1.5], f)).toEqual([[0, 1]]);
    expect(f).toEqual([0.5, 0.5]);
  });

  it('una vertical y una 3:2: una fila llena, un poco por debajo del máximo', () => {
    const a = [V, 1.5];
    const f = arrangeRows(a);
    expect(checkArrangement(a, f)).toEqual([[0, 1]]);
    expect(sum(f)).toBeCloseTo(1, 10);
    // En unidades del ancho (W = 1): h = (1 − g) / Σa ≈ 2,1·H.
    expect(rowHeights(f, a, 1, G)[0] / H).toBeCloseTo(2.1, 1);
  });

  it('una panorámica sola llena el ancho (no queda alta)', () => {
    expect(arrangeRows([4])).toEqual([1]);
  });

  it('dos verticales: una fila achicada, las dos al alto máximo', () => {
    const f = arrangeRows([V, V]);
    expect(checkArrangement([V, V], f)).toEqual([[0, 1]]);
    expect(sum(f)).toBeLessThan(1);
    expect(f[0]).toBe(f[1]);
    expect(f[0]).toBeCloseTo((V * MAX) / (1 - G), 4);
  });

  it('tres mezcladas: una fila llena', () => {
    const a = [1.5, V, 16 / 9];
    const f = arrangeRows(a);
    expect(checkArrangement(a, f)).toEqual([[0, 1, 2]]);
    expect(sum(f)).toBeCloseTo(1, 10);
  });

  it('siete mezcladas: la panorámica 4:1 va sola en su fila', () => {
    const a = [4 / 3, V, 1.5, 4, 1.5, 16 / 9, V];
    const f = arrangeRows(a);
    expect(checkArrangement(a, f)).toEqual([[0, 1, 2], [3], [4, 5, 6]]);
    expect(f[3]).toBe(1);
  });

  it('siete mezcladas con la panorámica en el medio de una fila: el resultado igual es válido', () => {
    const a = [1.5, V, 1.5, 4, 1.5, 4 / 3, 3 / 4];
    checkArrangement(a, arrangeRows(a));
  });

  it('doce fotos 3:2: cuatro filas de tres, todas llenas y a la altura ideal', () => {
    const a = Array<number>(12).fill(1.5);
    const f = arrangeRows(a);
    expect(checkArrangement(a, f)).toEqual([
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
      [9, 10, 11],
    ]);
    const h = rowHeights(f, a, 700, GAP);
    for (const x of h) expect(Math.abs(x - 700 * H)).toBeLessThan(0.1);
  });

  it('una vertical sola en la última fila se achica a la altura de la anterior', () => {
    // Con la panorámica 9:1 la vertical no puede ir en su fila (quedaría por debajo de la mitad de H).
    const a = [1.5, 1.5, 1.5, 9, V];
    const f = arrangeRows(a);
    const rows = checkArrangement(a, f);
    expect(rows).toEqual([[0, 1, 2], [3], [4]]);
    expect(f[4]).toBeLessThan(1);
    for (const W of WIDTHS) {
      const h = rowHeights(f, a, W, GAP);
      expect(Math.abs(h[4] - h[3])).toBeLessThan(0.05);
    }
  });

  it('una última fila que llena no pasa del máximo queda llena', () => {
    // Cuatro 3:2 van juntas (una fila un poco más baja que H es mejor que dos filas altas o una sola suelta).
    const a = [1.5, 1.5, 1.5, 1.5];
    const f = arrangeRows(a);
    expect(checkArrangement(a, f)).toEqual([[0, 1, 2, 3]]);
    expect(sum(f)).toBeCloseTo(1, 10);
  });

  it('cinco 3:2: tres y dos, las dos llenando el ancho', () => {
    const a = [1.5, 1.5, 1.5, 1.5, 1.5];
    const f = arrangeRows(a);
    expect(checkArrangement(a, f)).toEqual([[0, 1, 2], [3, 4]]);
    expect(f[3] + f[4]).toBeCloseTo(1, 10);
  });

  it('nueve verticales: dos filas de cuatro y la novena sola, a la altura de la anterior', () => {
    const a = Array<number>(9).fill(V);
    const f = arrangeRows(a);
    expect(checkArrangement(a, f)).toEqual([[0, 1, 2, 3], [4, 5, 6, 7], [8]]);
    expect(f[8]).toBeLessThan(1);
    // Entre filas con distinta cantidad de fotos la altura igual vale con el ancho del cálculo (8 px de
    // espacio en 700); dentro de una fila, con cualquiera.
    const h = rowHeights(f, a, 700, GAP);
    expect(Math.abs(h[8] - h[7])).toBeLessThan(0.1);
  });

  it('nunca más de 4 por fila, ni con muchas verticales (que querrían ir de a más)', () => {
    for (const a of [Array<number>(9).fill(V), Array<number>(10).fill(0.5), Array<number>(8).fill(4)]) {
      checkArrangement(a, arrangeRows(a));
    }
    const a = Array<number>(6).fill(0.4);
    for (const row of groupRows(arrangeRows(a, { maxPerRow: 2 }))) expect(row.length).toBeLessThanOrEqual(2);
  });

  it('el orden no cambia: cada foto conserva su lugar', () => {
    // Una vertical entre dos horizontales sigue en el medio (su ancho es el más chico de la fila).
    const a = [1.5, V, 1.5];
    const f = arrangeRows(a);
    checkArrangement(a, f);
    expect(f[1]).toBeLessThan(f[0]);
    expect(f[1]).toBeLessThan(f[2]);
  });

  it('proporciones inválidas (0, NaN, negativas, infinitas) cuentan como 3:2 y no rompen', () => {
    const bad = [0, Number.NaN, -1, Number.POSITIVE_INFINITY, 1.5];
    const f = arrangeRows(bad);
    checkArrangement(bad, f);
    expect(f).toEqual(arrangeRows([1.5, 1.5, 1.5, 1.5, 1.5]));
  });

  it('opciones raras no rompen: siempre hay resultado', () => {
    const a = [1.5, V, 4, 1.5];
    for (const opts of [{ maxPerRow: 0 }, { maxPerRow: Number.NaN }, { gapRatio: Number.NaN }, { gapRatio: -1 }, { gapRatio: 5 }]) {
      const f = arrangeRows(a, opts);
      expect(f).toHaveLength(a.length);
      for (const x of f) expect(x > 0 && x <= 1).toBe(true);
    }
  });

  it('si ninguna partición entra en los límites, igual reparte (proporciones extremas)', () => {
    const a = [20, 0.1, 20, 0.1, 30];
    checkArrangement(a, arrangeRows(a));
  });
});

describe('tiradores', () => {
  it('pxToRowWidth es la inversa del CSS: ida y vuelta', () => {
    for (const W of WIDTHS) {
      for (const n of [1, 2, 3, 4]) {
        for (const f of [0.1, 0.25, 0.3333, 0.5, 0.8, 1]) {
          const px = f * (W - (n - 1) * GAP);
          expect(pxToRowWidth(px, W, GAP, n)).toBeCloseTo(f, 10);
        }
      }
    }
  });

  it('pxToRowWidth queda entre lo más chico que se guarda y 1', () => {
    expect(pxToRowWidth(900, 700, GAP, 1)).toBe(1);
    expect(pxToRowWidth(0, 700, GAP, 1)).toBe(0.0001);
    expect(pxToRowWidth(-20, 700, GAP, 2)).toBe(0.0001);
    expect(pxToRowWidth(Number.NaN, 700, GAP, 2)).toBe(0.0001);
    // Sin lugar (un ancho absurdo), todo el ancho.
    expect(pxToRowWidth(100, 0, GAP, 1)).toBe(1);
  });

  it('snapRowWidth imanta a 1, 1/2, 1/3 y 1/4 a menos de 2%', () => {
    expect(snapRowWidth(0.99)).toBe(1);
    expect(snapRowWidth(1.2)).toBe(1);
    expect(snapRowWidth(0.51)).toBe(0.5);
    expect(snapRowWidth(0.485)).toBe(0.5);
    expect(snapRowWidth(0.34)).toBe(1 / 3);
    expect(snapRowWidth(0.26)).toBe(0.25);
  });

  it('snapRowWidth fuera del imán redondea a 4 decimales', () => {
    expect(snapRowWidth(0.62347)).toBe(0.6235);
    expect(snapRowWidth(0.4)).toBe(0.4);
    expect(snapRowWidth(0.5, 0)).toBe(0.5);
    expect(snapRowWidth(0.51, 0.005)).toBe(0.51);
    expect(snapRowWidth(0.00001)).toBe(0.0001);
  });

  it('snapRowWidth de algo que no es un número positivo da 0 (sin ancho propio)', () => {
    expect(snapRowWidth(0)).toBe(0);
    expect(snapRowWidth(-0.3)).toBe(0);
    expect(snapRowWidth(Number.NaN)).toBe(0);
  });

  it('los tamaños rápidos son 1, 1/2, 1/3 y 1/4, y se imantan a sí mismos', () => {
    expect(ROW_PRESETS).toEqual([1, 1 / 2, 1 / 3, 1 / 4]);
    for (const p of ROW_PRESETS) expect(snapRowWidth(p)).toBe(p);
  });
});
