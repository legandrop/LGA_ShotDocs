import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// El aviso flotante (`.notice`: el de `notify`, el avance de reemplazar, los del espacio y los de un link) en el
// teléfono. Con `left: 50%` y `translateX(-50%)` el ancho natural se calcula sobre media pantalla: a 375 px el aviso de
// un comentario cerrado medía 210 por 175 px y su botón se partía en tres renglones. En el teléfono va anclado a los dos
// costados, y los botones de un aviso no se achican en ninguna pantalla. El diseño en pantalla se midió en un navegador (375, 760, 761 y 1280 px, cada
// aviso con el estilo de antes y el de ahora; ver Docs/Doc_Sincronizacion.md, "Un cuadro abierto y lo que llega de
// afuera"); acá se fija lo que lo produce en el CSS, y que en pantallas más anchas el estilo general no cambió.

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** Las declaraciones de la regla `selector { ... }` que está a ese nivel de sangría. */
function rule(source: string, selector: string, indent = ''): Record<string, string> | null {
  const at = source.indexOf(`\n${indent}${selector} {\n`);
  if (at < 0) return null;
  const body = source.slice(source.indexOf('{', at) + 1, source.indexOf('}', at));
  return Object.fromEntries(body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]));
}

/** El bloque `@media (max-width: 760px)` que trae la regla de `.notice`. */
function phoneBlock(): string {
  const head = '@media (max-width: 760px) {';
  for (let at = css.indexOf(head); at >= 0; at = css.indexOf(head, at + 1)) {
    let depth = 0;
    for (let i = at + head.length - 1; i < css.length; i++) {
      if (css[i] === '{') depth++;
      if (css[i] === '}' && --depth === 0) {
        const block = css.slice(at, i + 1);
        if (rule(block, '.notice', '  ')) return block;
        break;
      }
    }
  }
  throw new Error('no hay regla de .notice para el teléfono');
}

describe('el aviso flotante en el teléfono', () => {
  it('va anclado a los dos costados y centrado, sin el corrimiento que lo dejaba en media pantalla', () => {
    expect(rule(phoneBlock(), '.notice', '  ')).toEqual({ left: '16px', right: '16px', width: 'fit-content', 'margin-inline': 'auto', transform: 'none' });
  });

  it('sus botones no se achican, en ninguna pantalla: el que se parte en renglones es el texto', () => {
    expect(rule(css, '.notice > button')).toEqual({ flex: 'none' });
  });

  it('en pantallas más anchas el estilo general es el de siempre', () => {
    expect(rule(css, '.notice')).toMatchObject({ position: 'fixed', left: '50%', transform: 'translateX(-50%)', 'max-width': 'calc(100vw - 32px)' });
  });

  it('ningún aviso repite la posición del general: si la repitiera, el anclaje del teléfono no le llegaría', () => {
    for (const variant of ['.notice.link-limited', '.notice.link-edit-bar', '.notice.replace-progress-bar', '.space-notice']) {
      const rules = [...css.matchAll(new RegExp(`\\n${variant.replace(/\./g, '\\.')} \\{([^}]*)\\}`, 'g'))].map((m) => m[1]);
      expect(rules.length, variant).toBeGreaterThan(0);
      for (const body of rules) {
        expect(body, variant).not.toMatch(/(^|[\s;])left\s*:/);
        expect(body, variant).not.toMatch(/(^|[\s;])right\s*:/);
        expect(body, variant).not.toMatch(/transform\s*:/);
      }
    }
  });
});
