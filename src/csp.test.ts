import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// La política de contenido (`public/_headers`, Docs/Doc_Asistente.md, 10.4): una clave en el navegador es tan segura como
// el código que corre en la página. La app no carga scripts de terceros y la CSP solo deja correr los suyos: el script
// en línea del tema (index.html) va por su hash. Si alguien cambia ese script, esta prueba avisa que hay que cambiar el
// hash (si no, el tema dejaría de aplicarse antes de pintar).

const ROOT = resolve(__dirname, '..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8').replace(/\r\n/g, '\n');

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
    expect(headers).toMatch(/^\/\*\n\s+Content-Security-Policy:/m);
    const p = csp();
    const scripts = p.get('script-src') ?? [];
    expect(scripts).toContain("'self'");
    // WebAssembly (las fotos HEIC), no `eval`.
    expect(scripts).toContain("'wasm-unsafe-eval'");
    for (const banned of ["'unsafe-inline'", "'unsafe-eval'", '*', 'https:', 'http:', 'data:', 'blob:']) expect(scripts, banned).not.toContain(banned);
    // Ningún otro origen en script-src.
    expect(scripts.filter((s) => !s.startsWith("'"))).toEqual([]);
    expect(p.get('object-src')).toEqual(["'none'"]);
    expect(p.get('base-uri')).toEqual(["'self'"]);
    expect(p.get('default-src')).toEqual(["'self'"]);
    // Los Worker de la app (fotos HEIC, PDF, historial) y los que se arman de un blob.
    expect(p.get('worker-src')).toEqual(["'self'", 'blob:']);
    // Pegar una imagen embebida la pasa a archivo con `fetch(data:…)` (PageEditor.tsx).
    expect(p.get('connect-src')).toEqual(expect.arrayContaining(['data:', 'blob:', 'https:', 'wss:']));
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
