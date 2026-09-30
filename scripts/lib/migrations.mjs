// Migraciones de supabase/migrations por la Management API. Lo común de scripts/db-migrate.mjs y
// scripts/setup-workspace.mjs. Cada migración se registra en supabase_migrations.schema_migrations, la misma
// tabla que usa el CLI de Supabase, así que después se puede seguir con `supabase db push` sin repetir nada.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { quote } from './management.mjs';

// fileURLToPath y no `.pathname`: con `.pathname` una carpeta con espacios queda con %20 y en Windows sale
// /C:/..., y readdir no la encuentra.
export const migrationsDir = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));

// Las migraciones del repo, en orden: [{ file, version, name, sql }].
export async function readMigrations(dir = migrationsDir) {
  const files = (await readdir(dir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  return Promise.all(
    files.map(async (file) => {
      const [, version, name] = file.match(/^(\d+)_(.+)\.sql$/);
      return { file, version, name, sql: await readFile(join(dir, file), 'utf8') };
    }),
  );
}

// Las versiones ya aplicadas, solo leyendo (sirve en dry-run). En un proyecto nuevo la tabla no existe.
export async function appliedVersions(client) {
  const [t] = await client.readQuery(
    `select to_regclass('supabase_migrations.schema_migrations') is not null as present`,
  );
  if (!t?.present) return new Set();
  const rows = await client.readQuery('select version from supabase_migrations.schema_migrations');
  return new Set(rows.map((r) => r.version));
}

export function pendingMigrations(all, applied) {
  return all.filter((m) => !applied.has(m.version));
}

// La migración y su registro, en una sola transacción: o queda todo, o nada.
export function migrationSql({ version, name, sql }) {
  return `begin;
${sql}
;
insert into supabase_migrations.schema_migrations (version, name, statements)
values (${quote(version)}, ${quote(name)}, array[${quote(sql)}]);
commit;`;
}

// Aplica lo que falta, en orden. Escribe: en dry-run el cliente lo frena.
export async function applyPending(client, { dir = migrationsDir, onStart = () => {}, onDone = () => {} } = {}) {
  await client.query(`
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (
    version text primary key, statements text[], name text
  );
`);
  const applied = await appliedVersions(client);
  const pending = pendingMigrations(await readMigrations(dir), applied);
  for (const m of pending) {
    onStart(m);
    await client.query(migrationSql(m));
    onDone(m);
  }
  return pending;
}
