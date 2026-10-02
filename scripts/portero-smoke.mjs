#!/usr/bin/env node
// Prueba del portero en el `workerd` de Cloudflare (`wrangler dev`, local, sin cuenta ni red), antes de publicarlo.
// Las pruebas de `portero/src/*.test.ts` corren `core.ts` con un almacenamiento en memoria y no pasan por
// `index.ts`: esta sí, con el Durable Object de verdad (local). Manda varios pedidos seguidos a la misma instancia
// (lo que cambia entre pedidos es justo lo que las otras no ven: en Cloudflare un stub del Durable Object queda
// atado al pedido que lo creó) y falla si alguno da 500.
//
// Uso (desde la raíz del repo): node scripts/portero-smoke.mjs
// Usa `npx wrangler` (la primera vez lo baja). Escribe el estado local en una carpeta temporal y la borra.

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORTERO_SMOKE_PORT ?? 4198);
// Una versión que conoce la `compatibility_date` de portero/wrangler.jsonc (una más vieja no arranca: subirla junto con esa fecha).
const WRANGLER = process.env.PORTERO_SMOKE_WRANGLER ?? 'wrangler@4.146.0';
const state = mkdtempSync(join(tmpdir(), 'portero-smoke-'));
const vars = {
  SUPABASE_URL: 'https://smoke.invalid',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_smoke',
  APP_ORIGINS: 'http://127.0.0.1:5173',
  GOOGLE_CLIENT_ID: 'smoke',
  GOOGLE_CLIENT_SECRET: 'smoke',
};
const args = ['-y', WRANGLER, 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', state, '--log-level', 'warn'];
for (const [k, v] of Object.entries(vars)) args.push('--var', `${k}:${v}`);

const child = spawn('npx', args, { cwd: join(root, 'portero'), shell: process.platform === 'win32', env: { ...process.env, CI: '1' } });
let log = '';
child.stdout.on('data', (d) => (log += d));
child.stderr.on('data', (d) => (log += d));

function stop() {
  if (child.exitCode !== null) return;
  // El árbol entero (npx → wrangler → workerd), por su PID.
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
  else child.kill('SIGTERM');
}

async function ready() {
  for (let i = 0; i < 240; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (res.ok) return;
    } catch {
      // todavía no escucha
    }
    if (child.exitCode !== null) throw new Error(`wrangler terminó antes de arrancar:\n${log}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`wrangler no arrancó en 2 minutos:\n${log}`);
}

const results = [];
async function expect(name, method, path, want, init = {}, cors) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, ...init });
  await res.arrayBuffer();
  // `cors`: el `Access-Control-Allow-Origin` que tiene que traer (`null`: ninguno).
  const ok = res.status === want && (cors === undefined || res.headers.get('Access-Control-Allow-Origin') === cors);
  results.push({ name, ok, status: res.status });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${res.status}${ok ? '' : ` (se esperaba ${want})`}`);
}

let failed = true;
try {
  await ready();
  // Varios pedidos seguidos: cada uno abre su stub del Durable Object (la clave de los pases vive ahí).
  for (let i = 1; i <= 4; i++) await expect(`pase inválido #${i} (lee el Durable Object)`, 'GET', '/m/abc.def', 403);
  for (let i = 1; i <= 2; i++) await expect(`miniatura con pase inválido #${i}`, 'GET', '/t/abc.def', 403);
  for (let i = 1; i <= 2; i++) await expect(`estado sin sesión #${i}`, 'GET', '/drive/status', 401);
  await expect('carpeta sin sesión', 'POST', '/folder/list', 401, { body: '{}', headers: { 'Content-Type': 'application/json' } });
  await expect('preflight', 'OPTIONS', '/folder/list', 204, { headers: { Origin: vars.APP_ORIGINS, 'Access-Control-Request-Method': 'POST' } });
  // "Available offline" (Doc_Copias_Locales.md): `?offline=1` y `Range` en `/m/`, y `/verify`.
  await expect('pase inválido con ?offline=1 y Range', 'GET', '/m/abc.def?offline=1', 403, { headers: { Range: 'bytes=0-16777215' } });
  await expect('verify sin sesión', 'POST', '/verify', 401, { body: '{"files":[]}', headers: { 'Content-Type': 'application/json' } });
  await expect('preflight de verify', 'OPTIONS', '/verify', 204, { headers: { Origin: vars.APP_ORIGINS, 'Access-Control-Request-Method': 'POST' } });
  // "Download all" (P.9, entrega 2): la app lee /m/ con fetch; otro origen no.
  await expect('pase inválido desde la app (CORS)', 'GET', '/m/abc.def', 403, { headers: { Origin: vars.APP_ORIGINS } }, vars.APP_ORIGINS);
  await expect('pase inválido desde otro origen (sin CORS)', 'GET', '/m/abc.def', 403, { headers: { Origin: 'https://evil.example' } }, null);
  await expect('preflight de /m/ desde otro origen (sin CORS)', 'OPTIONS', '/m/abc.def', 204, { headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } }, null);
  await expect('salud al final', 'GET', '/health', 200);
  failed = results.some((r) => !r.ok);
  console.log(failed ? 'El portero NO pasó la prueba: no publicarlo.' : `${results.length}/${results.length} bien.`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
} finally {
  stop();
  // workerd tarda un momento en soltar sus archivos: se reintenta, y si igual quedan, es una carpeta temporal.
  try {
    rmSync(state, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  } catch {
    console.log(`(quedó la carpeta temporal ${state})`);
  }
}
process.exit(failed ? 1 : 0);
