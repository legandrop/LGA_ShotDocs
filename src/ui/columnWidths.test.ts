import { describe, expect, it } from 'vitest';
import { columnWidths, moveBorder, spreadBorder } from './columnWidths';

const sum = (ws: number[]) => ws.reduce((a, b) => a + b, 0);
const round = (ws: number[]) => ws.map((w) => Math.round(w * 100) / 100);

describe('anchos de columna en porcentaje (D821)', () => {
  it('lo de fábrica se normaliza a 100 y lo guardado gana', () => {
    const cols = [
      { id: 'a', width: 1 },
      { id: 'b', width: 3 },
    ];
    expect(columnWidths(cols, {})).toEqual([25, 75]);
    expect(columnWidths(cols, { a: 50, b: 50 })).toEqual([50, 50]);
    // Una columna nueva (sin ancho guardado) toma el de fábrica; un valor roto no cuenta.
    expect(round(columnWidths(cols, { a: 3, b: Number.NaN }))).toEqual([50, 50]);
  });

  it('agrandar le saca a la de al lado y después a las siguientes, sin bajar del mínimo', () => {
    const out = moveBorder([20, 20, 60], 0, 25, 10);
    expect(out).toEqual([45, 10, 45]);
    expect(sum(out)).toBe(100);
  });

  it('achicar le da lo que pierde a la de al lado, sin bajar del mínimo', () => {
    expect(moveBorder([30, 30, 40], 0, -25, 10)).toEqual([10, 50, 40]);
  });

  it('ajustar al contenido reparte entre las de la derecha según lo que le sobra a cada una', () => {
    const out = spreadBorder([20, 20, 60], 0, 20, 10);
    // Les sobran 10 y 50: ponen 1/6 y 5/6 de los 20.
    expect(round(out)).toEqual([40, 16.67, 43.33]);
    expect(Math.round(sum(out))).toBe(100);
  });

  it('nunca da más de lo que sobra', () => {
    expect(spreadBorder([50, 25, 25], 0, 80, 20)).toEqual([60, 20, 20]);
  });
  it('una columna ya por debajo del mínimo no crece al achicarla, y ninguna queda en negativo', () => {
    const out = moveBorder([12, 8, 40, 40], 0, -2, 16.7);
    expect(out).toEqual([12, 8, 40, 40]);
    expect(out.every((w) => w >= 0)).toBe(true);
  });
});
