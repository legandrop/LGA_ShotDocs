import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
    // Las variantes se descubren solas: las clases que acompañan a `notice` en el JSX y las `.notice.<algo>` del CSS. Un
    // aviso nuevo entra sin tocar esta prueba.
    const variants = noticeVariants();
    expect(variants).toEqual(expect.arrayContaining(['link-edit-bar', 'link-limited', 'link-offline', 'replace-progress-bar', 'space-notice']));
    for (const variant of variants) {
      for (const body of rulesFor(variant)) {
        expect(body, variant).not.toMatch(/(^|[\s;])left\s*:/);
        expect(body, variant).not.toMatch(/(^|[\s;])right\s*:/);
        expect(body, variant).not.toMatch(/transform\s*:/);
      }
    }
  });
});

describe('el aviso y el botón redondo de dictar en el teléfono', () => {
  it('con el botón en pantalla, los avisos de la app arrancan por encima de él; con el menú abierto (sin botón), donde siempre', () => {
    const block = phoneBlock();
    expect(rule(block, '.shell', '  ')).toEqual({ '--notice-base': '20px' });
    expect(rule(block, '.shell:not(.nav-open):has(.dictate-fab)', '  ')).toEqual({ '--notice-base': '84px' });
    expect(rule(block, '.shell .notice', '  ')).toEqual({ bottom: 'calc(var(--notice-base) + env(safe-area-inset-bottom))' });
    // El botón ocupa de 18 a 74 px del borde de abajo: 84 deja 10 px libres.
    const fab = [...css.matchAll(/\n {2}\.dictate-fab \{([^}]*)\}/g)].map((m) => m[1]).find((b) => b.includes('position: fixed'))!;
    const bottom = Number(/bottom:\s*calc\((\d+)px/.exec(fab)![1]);
    const height = Number(/height:\s*(\d+)px/.exec(fab)![1]);
    expect(bottom + height).toBeLessThan(84);
  });

  it('los apilados van por encima del aviso común aunque ocupe varios renglones (su alto lo anota la app)', () => {
    expect(rule(phoneBlock(), '.shell .notice.replace-progress-bar,\n  .shell .space-notice', '  ')).toEqual({
      bottom: 'calc(var(--notice-base) + max(43px, var(--notice-height, 0px)) + 13px + env(safe-area-inset-bottom))',
    });
    // Sin el botón y con un aviso de un renglón, donde estaban (76 px, el general de 760 px para arriba).
    expect(20 + 43 + 13).toBe(76);
    expect(css).toContain('\n.notice.replace-progress-bar {\n  bottom: calc(76px + env(safe-area-inset-bottom));\n}');
  });
});

/** Las clases que acompañan a `notice` en el JSX de la app y las de los selectores `.notice.<algo>` del CSS. */
function noticeVariants(): string[] {
  const found = new Set<string>();
  const root = fileURLToPath(new URL('..', import.meta.url));
  for (const file of readdirSync(root, { recursive: true }) as string[]) {
    if (!file.endsWith('.tsx') || file.endsWith('.test.tsx')) continue;
    const source = readFileSync(join(root, file), 'utf8');
    for (const [, list] of source.matchAll(/className="([^"]*)"/g)) {
      const classes = list.split(/\s+/);
      if (classes.includes('notice')) for (const c of classes) if (c !== 'notice') found.add(c);
    }
  }
  for (const [, c] of css.matchAll(/\.notice\.([\w-]+)/g)) found.add(c);
  return [...found].sort();
}

/** Lo de adentro de cada regla del CSS (en cualquier `@media`) cuyo último tramo de algún selector lleva esa clase. */
function rulesFor(variant: string): string[] {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const bodies: string[] = [];
  for (const [, selectors, body] of plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const hit = selectors.split(',').some((s) => {
      const last = s.trim().split(/[\s>+~]+/).pop() ?? '';
      return last.split(/(?=[.:#[])/).includes(`.${variant}`);
    });
    if (hit) bodies.push(body);
  }
  return bodies;
}
