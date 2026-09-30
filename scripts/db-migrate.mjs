#!/usr/bin/env node
// Aplica las migraciones de supabase/migrations que falten, en orden, usando la Management API de
// Supabase. Registra cada una en supabase_migrations.schema_migrations, la misma tabla que usa el CLI de
// Supabase, así que después se puede seguir con `supabase db push` sin repetir nada.
//
// Uso:
//   SUPABASE_PROJECT_REF=abcd SUPABASE_ACCESS_TOKEN=sbp_... node scripts/db-migrate.mjs
//   node scripts/db-migrate.mjs --test    # aplica lo pendiente DE VERDAD y después corre supabase/tests/*.sql (las pruebas en rollback)
//
// Si falta SUPABASE_PROJECT_REF se toma de SUPABASE_URL. El token es un Personal Access Token de
// supabase.com/dashboard/account/tokens; nunca se versiona.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const ref =
  process.env.SUPABASE_PROJECT_REF ??
  process.env.SUPABASE_URL?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
if (!ref) {
  console.error('Falta SUPABASE_PROJECT_REF (o SUPABASE_URL).');
  process.exit(1);
}

async function query(sql) {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.SUPABASE_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`;
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${body}`);
  return JSON.parse(body);
}

const quote = (s) => `'${s.replaceAll("'", "''")}'`;

await query(`
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (
    version text primary key, statements text[], name text
  );
`);
const applied = new Set(
  (await query('select version from supabase_migrations.schema_migrations')).map((r) => r.version),
);

const dir = join(root, 'supabase/migrations');
const files = (await readdir(dir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
for (const file of files) {
  const [, version, name] = file.match(/^(\d+)_(.+)\.sql$/);
  if (applied.has(version)) continue;
  const sql = await readFile(join(dir, file), 'utf8');
  process.stdout.write(`Aplicando ${file}… `);
  await query(`begin;
${sql}
;
insert into supabase_migrations.schema_migrations (version, name, statements)
values (${quote(version)}, ${quote(name)}, array[${quote(sql)}]);
commit;`);
  console.log('listo');
}
console.log('Migraciones al día.');

if (process.argv.includes('--test')) {
  const testDir = join(root, 'supabase/tests');
  for (const file of (await readdir(testDir)).filter((f) => f.endsWith('.sql')).sort()) {
    process.stdout.write(`Prueba ${file}… `);
    const rows = await query(await readFile(join(testDir, file), 'utf8'));
    const result = rows.at?.(-1)?.result ?? JSON.stringify(rows);
    if (result !== 'ok') throw new Error(`${file}: ${result}`);
    console.log('ok');
  }
}
