import { describe, expect, it } from 'vitest';
import { hexToHsv, hsvToHex, normalizeHex } from './hexColor';

// Los colores del picker (ColorPicker.tsx) y de los proyectos: el hex normalizado y el paso a HSV y de vuelta.

describe('hexColor', () => {
  it('normaliza a #rrggbb en minúsculas y rechaza lo demás', () => {
    expect(normalizeHex('#2E5A8E')).toBe('#2e5a8e');
    expect(normalizeHex('2e5a8e')).toBe('#2e5a8e');
    expect(normalizeHex(' #abc ')).toBe('#aabbcc');
    for (const bad of ['', '#', 'red', '#12345', '#1234567', '#gggggg', '#2e5a8e; x', 'url(x)']) expect(normalizeHex(bad)).toBeNull();
  });

  it('de hex a HSV y de vuelta da el mismo color', () => {
    for (const hex of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#2e5a8e', '#774dcb', '#8e7a2e', '#808080', '#123456']) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
    expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv('#000000').v).toBe(0);
    expect(hsvToHex({ h: 360, s: 1, v: 1 })).toBe('#ff0000');
  });
});
