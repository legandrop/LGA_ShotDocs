import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// La grilla de una carpeta de Drive se achica entera (D797): el iframe se dibuja más grande y se reduce con la misma
// escala, así ocupa exactamente la tarjeta. Solo en las carpetas: un video o un documento quedan como estaban.
const CSS = readFileSync(resolve(__dirname, 'drive.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('la tarjeta de una carpeta de Drive (D797)', () => {
  const rule = /\.drive-card\[data-drive-kind='folder'\] \.drive-card-player \{([^}]*)\}/.exec(CSS)?.[1] ?? '';

  it('agranda el iframe y lo achica con la misma escala, de una esquina', () => {
    const zoom = Number(/--drive-folder-zoom:\s*([\d.]+)/.exec(rule)?.[1]);
    expect(zoom).toBeGreaterThan(0.3);
    expect(zoom).toBeLessThan(1);
    expect(rule).toContain('width: calc(100% / var(--drive-folder-zoom))');
    expect(rule).toContain('height: calc(100% / var(--drive-folder-zoom))');
    expect(rule).toContain('transform: scale(var(--drive-folder-zoom))');
    expect(rule).toContain('transform-origin: 0 0');
  });

  it('el reproductor de un video no se achica', () => {
    const player = /\n\.drive-card-player \{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(player).toContain('width: 100%');
    expect(player).not.toContain('transform');
  });
});
