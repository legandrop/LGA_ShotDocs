import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// La política de contenido (`public/_headers`, Docs/Doc_Asistente.md, 10.4): una clave en el navegador es tan segura como
// el código que corre en la página. La CSP solo deja correr los scripts de la app, el script en línea del tema
// (index.html, por su hash) y el único de afuera que carga la app: el del selector de carpetas de Google
// (src/media/picker.ts), con su origen en script-src. Si alguien cambia el script del tema, esta prueba avisa que hay que
// cambiar el hash (si no, el tema dejaría de aplicarse antes de pintar); si alguien suma un script de otro origen, avisa
// que falta en la CSP (si no, esa función se rompería solo en la web publicada).

const ROOT = resolve(__dirname, '..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8').replace(/\r\n/g, '\n');

/** Los archivos de `src/` (sin las pruebas). */
function sources(dir = resolve(ROOT, 'src')): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(path));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

/**
 * Los orígenes de los scripts de afuera que carga la app: en cada archivo que arma un `<script>` (o un Worker que llama a
 * `importScripts`), las direcciones `.js` escritas en el código (la del selector de Google va en una constante).
 */
function externalScriptOrigins(): string[] {
  const origins = new Set<string>();
  for (const file of sources()) {
    const code = readFileSync(file, 'utf8');
    if (!/createElement\(\s*['"]script['"]\s*\)|importScripts\(/.test(code)) continue;
    for (const m of code.matchAll(/['"`](https?:\/\/[^'"`\s]+?\.m?js)(?:\?[^'"`\s]*)?['"`]/g)) origins.add(new URL(m[1]).origin);
  }
  return [...origins].sort();
}

function csp(): Map<string, string[]> {
  const headers = read('public/_headers');
  const line = headers.split('\n').find((l) => /^\s+Content-Security-Policy:/.test(l));
  expect(line, 'falta la Content-Security-Policy en public/_headers').toBeTruthy();
  const out = new Map<string, string[]>();
  for (const part of line!.replace(/^\s+Content-Security-Policy:\s*/, '').split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) out.set(name, values);
  }
  return out;
}

/** Los scripts en línea de un HTML (sin `src`), tal cual. */
const inlineScripts = (html: string) => [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const hashOf = (code: string) => `'sha256-${createHash('sha256').update(code, 'utf8').digest('base64')}'`;

describe('la política de contenido', () => {
  it('vale para todas las direcciones y solo deja los scripts de la app, sin eval ni en línea sueltos', () => {
    const headers = read('public/_headers');
    // En el bloque `/*`, uno solo para todas las direcciones.
    const all = headers.split(/\n(?=\S)/).filter((b) => /^\/\*\n/.test(b));
    expect(all).toHaveLength(1);
    expect(all[0]).toMatch(/^\s+Content-Security-Policy:/m);
    const p = csp();
    const scripts = p.get('script-src') ?? [];
    expect(scripts).toContain("'self'");
    // WebAssembly (las fotos HEIC), no `eval`.
    expect(scripts).toContain("'wasm-unsafe-eval'");
    for (const banned of ["'unsafe-inline'", "'unsafe-eval'", '*', 'https:', 'http:', 'data:', 'blob:']) expect(scripts, banned).not.toContain(banned);
    // Ningún otro origen en script-src que los de los scripts de afuera que la app carga.
    expect(scripts.filter((s) => !s.startsWith("'")).sort()).toEqual(externalScriptOrigins());
    expect(p.get('object-src')).toEqual(["'none'"]);
    expect(p.get('base-uri')).toEqual(["'self'"]);
    expect(p.get('default-src')).toEqual(["'self'"]);
    // Los Worker de la app (fotos HEIC, PDF, historial) y los que se arman de un blob.
    expect(p.get('worker-src')).toEqual(["'self'", 'blob:']);
    // Pegar una imagen embebida la pasa a archivo con `fetch(data:…)` (PageEditor.tsx).
    expect(p.get('connect-src')).toEqual(expect.arrayContaining(['data:', 'blob:', 'https:', 'wss:']));
  });

  it('cada script de afuera que carga la app tiene su origen en script-src (el selector de carpetas de Google)', () => {
    const origins = externalScriptOrigins();
    expect(origins).toContain('https://apis.google.com');
    const scripts = csp().get('script-src') ?? [];
    for (const origin of origins) expect(scripts, `falta ${origin} en script-src`).toContain(origin);
    // Sus ventanas van en iframes de Google (docs.google.com): frame-src deja https.
    expect(csp().get('frame-src')).toContain('https:');
  });

  it('cada script en línea de index.html tiene su hash en script-src', () => {
    const html = read('index.html');
    const inline = inlineScripts(html);
    expect(inline.length).toBeGreaterThan(0);
    const scripts = csp().get('script-src') ?? [];
    for (const code of inline) expect(scripts, `falta el hash del script en línea: ${code.trim().slice(0, 60)}…`).toContain(hashOf(code));
  });

  it('index.html no carga scripts de terceros (ni estilos de afuera)', () => {
    const html = read('index.html');
    for (const m of html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)) expect(m[1], m[1]).toMatch(/^\/(?!\/)/);
    for (const m of html.matchAll(/<link[^>]*\bhref="([^"]+)"/g)) expect(m[1], m[1]).toMatch(/^\/(?!\/)/);
  });

  it('el index.html publicado (si ya se armó) tampoco: sus scripts en línea tienen su hash', () => {
    const built = resolve(ROOT, 'dist/index.html');
    if (!existsSync(built)) return;
    const html = readFileSync(built, 'utf8');
    const scripts = csp().get('script-src') ?? [];
    for (const code of inlineScripts(html)) expect(scripts, code.slice(0, 60)).toContain(hashOf(code));
    for (const m of html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)) expect(m[1], m[1]).toMatch(/^\/(?!\/)/);
  });
});
