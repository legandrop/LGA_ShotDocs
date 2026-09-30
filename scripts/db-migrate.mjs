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
// supabase.com/dashboard/account/tokens; nunca se versiona. Lo común con scripts/setup-workspace.mjs está en
// scripts/lib/.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createManagementClient } from './lib/management.mjs';
import { applyPending } from './lib/migrations.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const ref =
  process.env.SUPABASE_PROJECT_REF ??
  process.env.SUPABASE_URL?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
if (!ref) {
  console.error('Falta SUPABASE_PROJECT_REF (o SUPABASE_URL).');
  process.exit(1);
}

const client = createManagementClient({ ref, token: process.env.SUPABASE_ACCESS_TOKEN });

await applyPending(client, {
  onStart: (m) => process.stdout.write(`Aplicando ${m.file}… `),
  onDone: () => console.log('listo'),
});
console.log('Migraciones al día.');

if (process.argv.includes('--test')) {
  const testDir = join(root, 'supabase/tests');
  for (const file of (await readdir(testDir)).filter((f) => f.endsWith('.sql')).sort()) {
    process.stdout.write(`Prueba ${file}… `);
    const rows = await client.query(await readFile(join(testDir, file), 'utf8'));
    const result = rows.at?.(-1)?.result ?? JSON.stringify(rows);
    if (result !== 'ok') throw new Error(`${file}: ${result}`);
    console.log('ok');
  }
}
