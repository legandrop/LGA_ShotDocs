import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// En Windows y en macOS (los discos de siempre) los nombres no distinguen mayúsculas: dos archivos que solo
// se diferencian en eso pisan uno al otro al clonar. Y un import sin extensión (`./Carrete`) encuentra el
// módulo equivocado si al lado hay otro que solo cambia en mayúsculas y en la extensión (`carrete.ts` junto
// a `Carrete.tsx`, como antes de v0.055). Esta prueba lo evita en todo lo que va al repo (sin node_modules
// ni lo que genera el build).

const ROOT = resolve(__dirname, '..');
const SKIP = new Set(['node_modules', 'dist', 'dev-dist', '.git', '.wrangler', 'test-results']);

function allPaths(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    out.push(relative(ROOT, path));
    if (statSync(path).isDirectory()) allPaths(path, out);
  }
  return out;
}

describe('nombres de archivo', () => {
  it('ningún par de archivos o carpetas se diferencia solo en mayúsculas y minúsculas', () => {
    const paths = allPaths(ROOT);
    expect(paths.some((p) => p === join('src', 'ui', 'Carrete.tsx'))).toBe(true);
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const path of paths) {
      const key = path.toLowerCase();
      const other = seen.get(key);
      if (other) clashes.push(`${other} / ${path}`);
      else seen.set(key, path);
    }
    expect(clashes).toEqual([]);
  });

  it('ningún par de módulos se diferencia solo en mayúsculas (sin contar la extensión)', () => {
    const modules = allPaths(ROOT).filter((p) => /\.(tsx?|jsx?|mjs)$/.test(p) && !p.endsWith('.d.ts'));
    expect(moduleClashes([join('src', 'ui', 'Carrete.tsx'), join('src', 'ui', 'carrete.ts')])).toHaveLength(1);
    expect(moduleClashes(modules)).toEqual([]);
  });
});

/** Los pares de módulos que un import sin extensión confundiría en un disco que no distingue mayúsculas. */
function moduleClashes(paths: string[]): string[] {
  const seen = new Map<string, string>();
  const clashes: string[] = [];
  for (const path of paths) {
    const key = path.replace(/\.(tsx?|jsx?|mjs)$/, '').toLowerCase();
    const other = seen.get(key);
    if (other) clashes.push(`${other} / ${path}`);
    else seen.set(key, path);
  }
  return clashes;
}
