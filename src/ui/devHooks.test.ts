import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// Los ganchos de la consola (`__shotdocsRelations`, `__shotdocsDev`) son solo de desarrollo: se ponen en un único
// efecto que empieza con `if (!import.meta.env.DEV) return;`. Vite reemplaza `import.meta.env.DEV` por `false` al armar
// la versión publicada y el minificador saca lo que sigue, así que no viajan. Esta prueba cuida que nadie los ponga en
// otro lado sin esa guarda (los arneses de `src/dev/` no entran en el build).

const SRC = resolve(__dirname, '..');
const HOOK = /\b__shotdocs(?:Dev|Relations)\b\s*=(?!=)/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'dev' ? [] : files(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('ganchos de desarrollo', () => {
  it('solo se asignan detrás de la guarda de desarrollo, en relationsUi.ts', () => {
    const where: string[] = [];
    for (const file of files(SRC)) {
      const code = readFileSync(file, 'utf8');
      if (!HOOK.test(code)) continue;
      where.push(relative(SRC, file).split(sep).join('/'));
      // Cada asignación cae entre la guarda y el final de su efecto.
      for (const m of code.matchAll(new RegExp(HOOK, 'g'))) {
        const before = code.slice(0, m.index);
        const guard = before.lastIndexOf('if (!import.meta.env.DEV) return;');
        const effect = before.lastIndexOf('useEffect(');
        expect(guard, `${file}: sin guarda`).toBeGreaterThan(effect);
        expect(before.slice(guard).includes('}, ['), `${file}: la guarda es de otro efecto`).toBe(false);
      }
    }
    expect(where).toEqual(['ui/relationsUi.ts']);
  });
});
