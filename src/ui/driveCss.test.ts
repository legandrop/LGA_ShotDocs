import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FOLDER_GRID_WIDTH, folderGridFit } from './driveCard';

// La grilla de una carpeta de Drive (D797): Google pone las columnas según el ancho del iframe al cargar, así que se
// arma siempre con el mismo ancho (cinco por fila) y se achica al ancho real de la tarjeta, sin recargarla. Solo en las
// carpetas: un video o un documento quedan como estaban.
const CSS = readFileSync(resolve(__dirname, 'drive.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('la tarjeta de una carpeta de Drive (D797)', () => {
  it('la grilla se arma siempre con el mismo ancho y se achica a la tarjeta', () => {
    for (const w of [624, 312, 208, 156]) {
      const fit = folderGridFit(w, w * 0.75)!;
      expect(fit.width).toBeCloseTo(FOLDER_GRID_WIDTH);
      expect(fit.width * fit.zoom).toBeCloseTo(w);
      expect(fit.height * fit.zoom).toBeCloseTo(w * 0.75);
    }
    // Una tarjeta más ancha que la grilla no la agranda.
    expect(folderGridFit(1400, 600)).toEqual({ zoom: 1, width: 1400, height: 600 });
    expect(folderGridFit(0, 100)).toBeNull();
  });

  it('solo el iframe de la carpeta se achica, desde la esquina', () => {
    const folder = /\.drive-card-player\.drive-card-folder \{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(folder).toContain('transform-origin: 0 0');
    const player = /\n\.drive-card-player \{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(player).toContain('width: 100%');
    expect(player).not.toContain('transform');
  });
});
