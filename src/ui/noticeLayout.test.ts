import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// El aviso flotante (`.notice`: el de `notify`, el avance de reemplazar, los del espacio y los de un link). Con `left:
// 50%` y `translateX(-50%)` el ancho natural se calculaba sobre media pantalla: a 375 px el aviso de un comentario
// cerrado medía 210 por 175 px, y entre 761 y 1279 px topaba en la mitad. Desde la v0.234 va anclado a los dos costados
// en todas las pantallas, con un tope de 640 px o media pantalla; sus botones de texto tienen alto para el dedo en una
// pantalla táctil, y los avisos de abajo van apilados según el alto real de los de abajo (ya no a 76 px fijos). El diseño
// en pantalla se midió en un navegador (375, 761, 900 y 1280 px, temas claro y oscuro; Docs/Doc_Sincronizacion.md, «Los avisos de abajo»); acá se fija
// lo que lo produce en el CSS.

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** Las declaraciones de la regla `selector { ... }` que está a ese nivel de sangría. */
function rule(source: string, selector: string, indent = ''): Record<string, string> | null {
  const at = source.indexOf(`\n${indent}${selector} {\n`);
  if (at < 0) return null;
  const body = source.slice(source.indexOf('{', at) + 1, source.indexOf('}', at));
  return Object.fromEntries(body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]));
}

/** El bloque `@media` con esa cabecera que trae una regla para `selector`. */
function mediaBlock(head: string, selector: string): string {
  for (let at = css.indexOf(head); at >= 0; at = css.indexOf(head, at + 1)) {
    let depth = 0;
    for (let i = at + head.length - 1; i < css.length; i++) {
      if (css[i] === '{') depth++;
      if (css[i] === '}' && --depth === 0) {
        const block = css.slice(at, i + 1);
        if (rule(block, selector, '  ')) return block;
        break;
      }
    }
  }
  throw new Error(`no hay regla de ${selector} en ${head}`);
}

const phone = () => mediaBlock('@media (max-width: 760px) {', '.notice');
const px = (value: string) => Number(/^(-?[\d.]+)px$/.exec(value)![1]);

describe('el aviso flotante', () => {
  it('va anclado a los dos costados y centrado en todas las pantallas, sin el corrimiento que lo dejaba en media pantalla', () => {
    const general = rule(css, '.notice')!;
    expect(general).toMatchObject({ position: 'fixed', left: '16px', right: '16px', width: 'fit-content', 'margin-inline': 'auto', 'max-width': 'max(640px, 50vw)' });
    expect(general).not.toHaveProperty('transform');
    // En el teléfono, sin tope: todo el ancho.
    expect(rule(phone(), '.notice', '  ')).toEqual({ 'max-width': 'none' });
  });

  it('sus botones no se achican, en ninguna pantalla: el que se parte en renglones es el texto', () => {
    expect(rule(css, '.notice > button')).toEqual({ flex: 'none' });
  });

  it('en una pantalla táctil sus botones de texto miden 36 px de alto, y un aviso de un renglón sigue midiendo lo mismo', () => {
    const touch = rule(mediaBlock('@media (pointer: coarse) {', '.notice button.link'), '.notice button.link', '  ')!;
    expect(touch['min-height']).toBe('36px');
    // El margen negativo de arriba y de abajo devuelve lo que creció: queda el renglón de texto de antes (21 px).
    expect(px(touch['min-height']) + 2 * px(touch['margin-block'])).toBe(21);
  });

  it('ningún aviso repite la posición del general: si la repitiera, el anclaje no le llegaría', () => {
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

describe('los avisos de abajo, apilados sin taparse', () => {
  it('de abajo hacia arriba: sin red de un link, el de un link Can edit, el común, el avance de reemplazar y los del espacio', () => {
    expect(rule(css, '.notice')!.bottom).toBe('calc(20px + env(safe-area-inset-bottom))');
    expect(rule(css, '.notice.link-edit-bar')!.bottom).toBe('calc(20px + var(--link-offline-step, 0px) + env(safe-area-inset-bottom))');
    // `.shell` tiene otra regla antes (su diseño): la del lugar de los avisos es la que trae `--notice-base`.
    const shell = css.slice(css.indexOf('\n.shell {\n  --notice-base'));
    expect(rule(shell, '.shell')).toEqual({ '--notice-base': 'calc(20px + var(--link-offline-step, 0px) + var(--link-edit-step, 0px))' });
    expect(rule(css, '.shell .notice')).toEqual({ bottom: 'calc(var(--notice-base) + env(safe-area-inset-bottom))' });
    // Por encima del común aunque ocupe varios renglones: su lugar es su alto real, y nunca menos que un renglón.
    expect(rule(css, '.shell .notice.replace-progress-bar')).toEqual({
      bottom: 'calc(var(--notice-base) + max(43px, var(--notice-height, 0px)) + 13px + env(safe-area-inset-bottom))',
    });
    expect(rule(css, '.shell .notice.space-notice')).toEqual({
      bottom: 'calc(var(--notice-base) + max(43px, var(--notice-height, 0px)) + 13px + var(--progress-step, 0px) + env(safe-area-inset-bottom))',
    });
    // Sin avisos de un link ni avance y con un común de un renglón, donde estaban (76 px); ya no hay alturas fijas.
    expect(20 + 43 + 13).toBe(76);
    expect(css).not.toContain('calc(76px');
  });

  it('cada alto que usa el CSS lo anota el aviso que corresponde, con la separación de 13 px entre los apilados', () => {
    const src = fileURLToPath(new URL('.', import.meta.url));
    const read = (file: string) => readFileSync(join(src, file), 'utf8');
    expect(read('Workspace.tsx')).toContain("followHeight('--notice-height', 0, 'parent')");
    expect(read('Workspace.tsx')).toContain("followHeight('--progress-step', 13, 'parent')");
    expect(read('LinkApp.tsx')).toContain("followHeight('--link-offline-step', 13, 'root')");
    expect(read('LinkEditBar.tsx')).toContain("followHeight('--link-edit-step', 13, 'root')");
    for (const name of ['--notice-height', '--progress-step', '--link-offline-step', '--link-edit-step']) expect(css).toContain(`var(${name}, 0px)`);
  });
});

describe('el aviso y el botón redondo de dictar en el teléfono', () => {
  it('con el botón en pantalla, los avisos de la app arrancan por encima de él (o de los de un link, si van más alto)', () => {
    expect(rule(phone(), '.shell:not(.nav-open):has(.dictate-fab)', '  ')).toEqual({
      '--notice-base': 'max(84px, calc(20px + var(--link-offline-step, 0px) + var(--link-edit-step, 0px)))',
    });
    // El botón ocupa de 18 a 74 px del borde de abajo: 84 deja 10 px libres.
    const fab = [...css.matchAll(/\n {2}\.dictate-fab \{([^}]*)\}/g)].map((m) => m[1]).find((b) => b.includes('position: fixed'))!;
    const bottom = Number(/bottom:\s*calc\((\d+)px/.exec(fab)![1]);
    const height = Number(/height:\s*(\d+)px/.exec(fab)![1]);
    expect(bottom + height).toBeLessThan(84);
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
