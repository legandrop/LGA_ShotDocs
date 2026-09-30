#!/usr/bin/env node
// Prepara el Supabase de un workspace NUEVO con el token personal de su dueño (paso 12 de
// Docs/Plan_Workspaces.md): migraciones, configuración de login (código de 8 dígitos, plantillas, SMTP de
// Resend, límites, direcciones, registro cerrado), workspace_settings (nombre, clave local, dueño, portero)
// y la fila del dueño en members. Se puede correr dos veces. Ver Docs/Doc_Supabase.md, "Preparar un
// workspace nuevo", y la guía para usuarios Docs/Guide_Create_Workspace.md.
//
// Mac o Linux (POSIX):
//   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/setup-workspace.mjs --ref <ref> --owner-email <correo> \
//     --app-url https://<app> --smtp-from shotdocs@<dominio> --name <nombre> [--dry-run]
//   node scripts/setup-workspace.mjs --ref <ref> --owner-email <correo> --open-invite-signup [--dry-run]
// Windows (PowerShell), en una línea:
//   $env:SUPABASE_ACCESS_TOKEN="sbp_..."; node scripts/setup-workspace.mjs --ref <ref> --owner-email <correo> --app-url https://<app> --smtp-from shotdocs@<dominio> --name <nombre> [--dry-run]
//
// El ref va siempre explícito (no se toma de SUPABASE_URL, que en esta carpeta apunta a Wanka). La lógica
// está en scripts/lib/setup.mjs.

import { readFile } from 'node:fs/promises';
import { createManagementClient } from './lib/management.mjs';
import { USAGE, parseArgs, runOpenInviteSignup, runSetup, validateOptions } from './lib/setup.mjs';

// Pide un texto sin mostrarlo (la contraseña SMTP). Sin dependencias: la terminal en modo crudo.
function askHidden(prompt) {
  const { stdin, stderr } = process;
  return new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stderr.write('\n');
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          cleanup();
          resolve(value);
          return;
        }
        if (ch === '\u0003' || ch === '\u0004') {
          cleanup();
          reject(new Error('Cancelled. Nothing more was written.'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stderr.write(prompt);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function main() {
  let opts;
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(USAGE);
      return;
    }
    opts = validateOptions(args);
  } catch (e) {
    console.error(e.message);
    console.error('\nRun with --help to see the options.');
    process.exitCode = 1;
    return;
  }
  if (!process.env.SUPABASE_ACCESS_TOKEN) {
    console.error(
      'Note: SUPABASE_ACCESS_TOKEN is not set (supabase.com → Account → Access Tokens). Set it in this terminal:\n' +
        '  Mac or Linux:        export SUPABASE_ACCESS_TOKEN=sbp_...\n' +
        '  Windows PowerShell:  $env:SUPABASE_ACCESS_TOKEN="sbp_..."',
    );
  }
  const client = createManagementClient({
    ref: opts.ref,
    token: process.env.SUPABASE_ACCESS_TOKEN,
    dryRun: opts.dryRun,
  });
  const io = { log: (line) => console.log(line), askHidden: process.stdin.isTTY ? askHidden : null };
  try {
    if (opts.openInviteSignup) {
      await runOpenInviteSignup({ client, opts, io });
    } else {
      const templates = {
        magicLink: await readFile(new URL('../supabase/templates/magic_link.html', import.meta.url), 'utf8'),
        invite: await readFile(new URL('../supabase/templates/invite.html', import.meta.url), 'utf8'),
      };
      await runSetup({ client, opts, templates, env: { SMTP_PASSWORD: process.env.SMTP_PASSWORD }, io });
    }
  } catch (e) {
    console.error(`\n${e.message}`);
    process.exitCode = 1;
  }
}

await main();
