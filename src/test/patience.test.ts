import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { WAIT_FOR_MS } from './patience';

// El plazo por defecto de las esperas por condición (src/test/patience.ts), que carga la configuración de las pruebas.

it('una condición que tarda más de un segundo en cumplirse se sigue esperando, sin pedir un plazo', async () => {
  const started = Date.now();
  let looks = 0;
  await vi.waitFor(() => {
    looks++;
    expect(Date.now() - started).toBeGreaterThanOrEqual(1300);
  });
  expect(looks).toBeGreaterThan(1);
});

it('el plazo por defecto queda por debajo del tope de cada prueba, así falla la condición y no el reloj', ({ task }) => {
  expect(WAIT_FOR_MS).toBeLessThan(task.timeout);
  expect(WAIT_FOR_MS).toBeGreaterThanOrEqual(5000);
});

it('una espera que pide su plazo lo conserva: una condición que nunca llega falla a ese tiempo, con su mensaje', async () => {
  const started = Date.now();
  await expect(vi.waitFor(() => expect('nunca').toBe('llega'), { timeout: 120 })).rejects.toThrow(/llega/);
  await expect(vi.waitFor(() => expect('nunca').toBe('llega'), 120)).rejects.toThrow(/llega/);
  expect(Date.now() - started).toBeLessThan(WAIT_FOR_MS / 2);
});

// La regla de los plazos propios (vite.config.ts, `testTimeout`): el plazo de una prueba no afirma nada, solo detecta un
// cuelgue, así que ninguna prueba ni ningún paso de antes o después lleva uno menor o igual al general. Los que había
// (30 s en un grupo entero, 60 s en una prueba de 12 s) vencían con la máquina cargada sin que nada estuviera mal. Si
// alguna vez una prueba necesita un plazo corto porque lo que mide es justamente eso, lleva en la línea del plazo o en
// la de arriba un comentario con `PLAZO_CORTO` y el motivo.
const RUNNERS = /^\s*(?:it|test|describe|beforeAll|beforeEach|afterAll|afterEach)\b/;

interface OwnTimeout {
  line: number;
  /** Los milisegundos, o desde cuántos suma (`60_000 + SEMILLAS * 1500`). */
  ms: number;
  grows: boolean;
}

/**
 * Los plazos propios escritos con números en un archivo de pruebas. Mira línea por línea, no entiende el código. Lo que
 * no ve: un plazo que sale de una constante, las opciones `{ timeout }` puestas como último argumento, y una función
 * flecha sin llaves partida en varias líneas con el plazo en la última. Y toma por plazo cualquier `testTimeout:` o
 * `hookTimeout:` escrito en un objeto, aunque no sea de `vi.setConfig`.
 */
function ownTimeouts(code: string): OwnTimeout[] {
  const lines = code.split('\n');
  const found: OwnTimeout[] = [];
  const add = (at: number, expression: string) => {
    if (/PLAZO_CORTO/.test(`${lines[at - 1] ?? ''}${lines[at]}`)) return;
    const text = expression.trim();
    const literal = (digits: string) => Number(digits.replace(/_/g, ''));
    if (/^\d[\d_]*(?:\s*\*\s*\d[\d_]*)*$/.test(text)) found.push({ line: at + 1, ms: text.split('*').reduce((total, part) => total * literal(part.trim()), 1), grows: false });
    else if (/^\d[\d_]*\s*\+/.test(text)) found.push({ line: at + 1, ms: literal(/^\d[\d_]*/.exec(text)![0]), grows: true });
  };
  /** La línea que abre lo que cierra la línea `at`: la anterior con su misma sangría que no sea otro cierre. */
  const opener = (at: number) => {
    const indent = /^\s*/.exec(lines[at])![0];
    for (let i = at - 1; i >= 0; i--) if (lines[i].trim() && /^\s*/.exec(lines[i])![0] === indent && !/^\s*[})\]]/.test(lines[i])) return lines[i];
    return '';
  };
  lines.forEach((text, i) => {
    // vi.setConfig({ testTimeout: N }) y hookTimeout.
    let m = /\b(?:test|hook)Timeout:\s*([^,}]+)/.exec(text);
    if (m) return add(i, m[1]);
    // it('…', { timeout: N }, …) y describe('…', { timeout: N, retry: 2 }, …): las opciones, seguidas de la función
    // (así no se confunde con el `{ timeout }` de una espera escrita en la misma línea).
    m = /\{[^{}]*\btimeout:\s*([^,}]+)[^{}]*\}\s*,\s*(?:async\b|function\b|\(|[\w$]+\s*=>)/.exec(text);
    if (m && RUNNERS.test(text)) return add(i, m[1]);
    // afterEach(cleanup, N);  it('…', () => …, N);  todo en una línea, con el plazo al final.
    m = /,\s*(\d[\d_]*(?:\s*[*+]\s*[\w.]+)*)\s*\);?\s*$/.exec(text);
    if (m && RUNNERS.test(text)) return add(i, m[1]);
    // }, N);  y  }), N);  al final de una prueba, de un grupo o de un paso de antes o después.
    m = /^\s*\}\)?,\s*([^,()]+)\);?\s*$/.exec(text);
    if (m && RUNNERS.test(opener(i))) return add(i, m[1]);
    // },⏎ N,⏎ );  lo mismo, con el plazo en su propia línea.
    m = /^\s*([^,()]+),\s*$/.exec(text);
    if (m && /^\s*\},\s*$/.test(lines[i - 1] ?? '') && /^\s*\);?\s*$/.test(lines[i + 1] ?? '') && RUNNERS.test(opener(i + 1))) add(i, m[1]);
  });
  return found;
}

it('la búsqueda de plazos propios los encuentra en todas sus formas, y no confunde otras esperas', () => {
  const code = [
    'vi.setConfig({ testTimeout: 30_000 });',
    "describe('grupo', { timeout: 45_000 }, () => {",
    "  it('con opciones', { timeout: 30_000 + SEEDS * 1500 }, async () => {",
    '    await vi.waitFor(() => expect(1).toBe(1), { timeout: 20000 });',
    '    setTimeout(() => {',
    '      done();',
    '    }, 5000);',
    '  });',
    "  it('al final', async () => {",
    '    expect(1).toBe(1);',
    '  }, 20_000);',
    '  it.each([1, 2])(',
    "    'en su línea %s',",
    '    async () => {',
    '      expect(1).toBe(1);',
    '    },',
    '    15000,',
    '  );',
    "  it.skipIf(!RUN)('una medición larga', async () => {",
    '    expect(1).toBe(1);',
    '  }, 6 * 3600_000);',
    "  it('a propósito', () => {",
    '    expect(1).toBe(1);',
    '    // PLAZO_CORTO: esta mide que no tarde.',
    '  }, 1000);',
    "  it('con más opciones', { timeout: 5000, retry: 2 }, async () => {",
    '    expect(1).toBe(1);',
    '  });',
    "  it('y en otro orden', { retry: 2, timeout: 7000 }, () => undefined);",
    "  it('en una línea', () => expect(add(1, 2)).toBe(3), 9000);",
    "  it('envuelta', wrap(async () => {",
    '    expect(1).toBe(1);',
    '  }), 8000);',
    "  it('una espera adentro', async () => vi.waitFor(() => expect(add(1, 2)).toBe(3), { timeout: 500 }));",
    '});',
    'beforeAll(async () => {',
    '  await ready();',
    '}, 45000);',
    'afterEach(cleanup, 5000);',
  ].join('\n');
  expect(ownTimeouts(code)).toEqual([
    { line: 1, ms: 30_000, grows: false },
    { line: 2, ms: 45_000, grows: false },
    { line: 3, ms: 30_000, grows: true },
    { line: 11, ms: 20_000, grows: false },
    { line: 17, ms: 15_000, grows: false },
    { line: 21, ms: 21_600_000, grows: false },
    { line: 26, ms: 5000, grows: false },
    { line: 29, ms: 7000, grows: false },
    { line: 30, ms: 9000, grows: false },
    { line: 33, ms: 8000, grows: false },
    { line: 38, ms: 45_000, grows: false },
    { line: 39, ms: 5000, grows: false },
  ]);
});

it('ninguna prueba lleva un plazo propio menor o igual al general', ({ task }) => {
  const root = resolve(__dirname, '../..');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.test\.(?:tsx?|mjs)$/.test(entry.name) && path !== __filename) files.push(path);
    }
  };
  for (const dir of ['src', 'portero/src', 'scripts']) walk(join(root, dir));
  expect(files.length).toBeGreaterThan(300);
  const short: string[] = [];
  let seen = 0;
  for (const file of files) {
    for (const own of ownTimeouts(readFileSync(file, 'utf8'))) {
      seen++;
      // Uno que suma desde el general (`60_000 + SEMILLAS * 1500`) queda arriba; uno que suma desde menos, no se sabe.
      if (own.grows ? own.ms < task.timeout : own.ms <= task.timeout) short.push(`${relative(root, file).replace(/\\/g, '/')}:${own.line} (${own.ms} ms)`);
    }
  }
  // Las pruebas largas de verdad llevan su plazo: si no se encontró casi ninguno, la búsqueda dejó de ver.
  expect(seen).toBeGreaterThan(30);
  expect(short).toEqual([]);
});
