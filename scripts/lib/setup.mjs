// Lógica de scripts/setup-workspace.mjs: prepara el Supabase de un workspace NUEVO con el token personal de
// su dueño. Ver Docs/Doc_Supabase.md ("Preparar un workspace nuevo") y Docs/Plan_Workspaces.md (paso 12).
//
// Todo lo que no toca la red (armar la configuración deseada, el diff, los seguros, el plan) es puro y tiene
// pruebas en scripts/setup-workspace.test.mjs. La salida del comando es en inglés: la lee quien crea su
// workspace siguiendo Docs/Guide_Create_Workspace.md.
//
// Reglas:
// - Se puede correr dos veces: cada paso mira el estado actual y cambia solo lo que falta (la configuración
//   de login va con un PATCH de los campos que difieren; la clave local y el dueño no se pisan nunca).
// - Dry-run no escribe nada: lee con GET y con consultas envueltas en `begin read only; … rollback;`, y el
//   cliente (lib/management.mjs) frena cualquier otro pedido.
// - Seguro: nunca escribe contra Wanka ni contra un proyecto que ya tiene otro dueño.
// - La contraseña SMTP no se imprime nunca, ni entra en el diff.

import { randomInt } from 'node:crypto';
import { quote } from './management.mjs';
import { appliedVersions, applyPending, pendingMigrations, readMigrations } from './migrations.mjs';

export const WANKA_REF = 'znlvpuddswymxpffgvbz';
export const HOOK_URI = 'pg-functions://postgres/private/hook_before_user_created';
export const CODE_SUBJECT = 'Your Shot Docs code: {{ .Token }}';
export const INVITE_SUBJECT = 'You are invited to LGA Shot Docs';
export const DEFAULT_NAME = 'Workspace';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EMAIL_RE = /^[^\s@;'"\\]+@[^\s@;'"\\]+\.[^\s@;'"\\]+$/;

// ---------------------------------------------------------------------------------------------------
// Opciones
// ---------------------------------------------------------------------------------------------------

export const USAGE = `Prepares the Supabase project of a NEW LGA Shot Docs workspace.

Usage (first give the command your Supabase personal access token, in the same terminal):
  Mac or Linux:        export SUPABASE_ACCESS_TOKEN=sbp_...
  Windows PowerShell:  $env:SUPABASE_ACCESS_TOKEN="sbp_..."
then, on one line:
  node scripts/setup-workspace.mjs --ref <project ref> --owner-email <you@yourdomain.com>
    --app-url <https://app address> --smtp-from <shotdocs@yourdomain.com> [--name <workspace name>] [options]

Options:
  --ref <ref>                The project ref (the part before .supabase.co). Required.
  --owner-email <email>      The owner's email. Required.
  --app-url <url>            The address of the app, e.g. https://shotdocs.lega.com.ar. Required for setup.
  --smtp-from <email>        Sender address, on the domain verified in Resend. Required for setup.
  --name <name>              The workspace name (shown in the app).
  --media-url <url>          The file gateway address (https://shotdocs-portero.<you>.workers.dev).
  --redirect-url <url>       Another app address allowed after sign-in (repeatable).
  --smtp-sender-name <name>  Sender name (default: LGA Shot Docs).
  --smtp-host <host>         Default: smtp.resend.com
  --smtp-port <port>         Default: 465
  --smtp-user <user>         Default: resend
  --new-smtp-password        Ask for the SMTP password again even if one is already saved.
  --dry-run                  Only show what it would do. Writes nothing.
  --open-invite-signup       Separate step: connect the invitation check (Before User Created hook),
                             verify it, and only then let invited people create their account.
  --help                     This help.

The SMTP password (the Resend API key) is read from SMTP_PASSWORD or asked without showing it.
It is never accepted as an option and never printed.`;

const VALUE_OPTIONS = new Set([
  'ref', 'owner-email', 'app-url', 'name', 'media-url', 'redirect-url', 'smtp-from', 'smtp-sender-name',
  'smtp-host', 'smtp-port', 'smtp-user',
]);
const FLAG_OPTIONS = new Set(['dry-run', 'open-invite-signup', 'new-smtp-password', 'help']);

export function parseArgs(argv) {
  const out = { 'redirect-url': [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const m = /^--([a-z-]+)(?:=(.*))?$/s.exec(arg);
    // Sin repetir el valor: podría ser una clave pegada por error.
    if (!m) throw new Error('Unexpected argument (value hidden). Options start with --; run with --help.');
    const [, key, inline] = m;
    if (/pass/.test(key)) {
      if (key === 'new-smtp-password') {
        out[key] = true;
        continue;
      }
      throw new Error(
        `--${key} is not accepted: a password on the command line stays in the shell history. ` +
          'Use the SMTP_PASSWORD environment variable, or let the command ask for it.',
      );
    }
    if (FLAG_OPTIONS.has(key)) {
      if (inline !== undefined) throw new Error(`--${key} takes no value.`);
      out[key] = true;
    } else if (VALUE_OPTIONS.has(key)) {
      const value = inline ?? argv[++i];
      if (value === undefined || value.startsWith('--')) throw new Error(`--${key} needs a value.`);
      if (key === 'redirect-url') out[key].push(value);
      else out[key] = value;
    } else {
      throw new Error(`Unknown option: --${key}`);
    }
  }
  return out;
}

// Una dirección https sin camino (la app y el portero se sirven desde la raíz). Devuelve el origen.
function origin(value, what, { allowLocalhost = false } = {}) {
  let u;
  try {
    u = new URL(value);
  } catch {
    throw new Error(`${what} is not an address: ${value}`);
  }
  const local = allowLocalhost && u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname);
  if (u.protocol !== 'https:' && !local) throw new Error(`${what} must start with https://: ${value}`);
  if ((u.pathname !== '/' && u.pathname !== '') || u.search || u.hash || u.username || u.password) {
    throw new Error(`${what} must be just the address, without a path: ${value}`);
  }
  return u.origin;
}

export function validateOptions(args) {
  const errors = [];
  const opts = {
    dryRun: Boolean(args['dry-run']),
    openInviteSignup: Boolean(args['open-invite-signup']),
    newSmtpPassword: Boolean(args['new-smtp-password']),
    ref: args.ref,
    ownerEmail: args['owner-email']?.trim().toLowerCase(),
    name: args.name?.trim(),
    redirectUrls: [],
    smtp: {
      host: args['smtp-host'] ?? 'smtp.resend.com',
      port: String(args['smtp-port'] ?? '465'),
      user: args['smtp-user'] ?? 'resend',
      from: args['smtp-from']?.trim().toLowerCase(),
      senderName: args['smtp-sender-name']?.trim() ?? 'LGA Shot Docs',
    },
  };
  const tryDo = (fn) => {
    try {
      fn();
    } catch (e) {
      errors.push(e.message);
    }
  };
  if (!/^[a-z0-9]{20}$/.test(opts.ref ?? '')) {
    errors.push('--ref is required: the project ref, 20 lowercase letters and numbers (Project Settings → General → Project ID).');
  }
  if (!EMAIL_RE.test(opts.ownerEmail ?? '')) errors.push('--owner-email is required and must be an email address.');
  if (opts.name !== undefined && (opts.name.length < 1 || opts.name.length > 80)) {
    errors.push('--name must have between 1 and 80 characters.');
  }
  if (args['media-url'] !== undefined) tryDo(() => (opts.mediaUrl = origin(args['media-url'], '--media-url')));
  for (const r of args['redirect-url'] ?? []) {
    tryDo(() => opts.redirectUrls.push(origin(r, '--redirect-url', { allowLocalhost: true })));
  }
  if (!opts.openInviteSignup) {
    if (args['app-url'] === undefined) errors.push('--app-url is required: the address where people open the app.');
    else tryDo(() => (opts.appUrl = origin(args['app-url'], '--app-url')));
    if (!EMAIL_RE.test(opts.smtp.from ?? '')) {
      errors.push('--smtp-from is required: the sender address, on the domain you verified in Resend.');
    }
    if (!/^[a-z0-9.-]+$/i.test(opts.smtp.host)) errors.push('--smtp-host is not a host name.');
    if (!/^\d{2,5}$/.test(opts.smtp.port)) errors.push('--smtp-port must be a number.');
    if (!opts.smtp.user) errors.push('--smtp-user cannot be empty.');
    if (!opts.smtp.senderName || opts.smtp.senderName.length > 80) errors.push('--smtp-sender-name must have 1 to 80 characters.');
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return opts;
}

// ---------------------------------------------------------------------------------------------------
// Configuración de login
// ---------------------------------------------------------------------------------------------------

// Campos de /config/auth que guardan secretos: smtp_pass, los *_secret(s) de proveedores, hooks y captcha,
// y las claves y tokens de los proveedores de SMS (sms_*_api_key, sms_twilio_auth_token…). Ojo: no alcanza
// con buscar "pass" o "token" (passkey_enabled, refresh_token_rotation_enabled no son secretos).
export function isSecretKey(k) {
  return k === 'smtp_pass' || /secret/i.test(k) || /(_key|_token|_password)$/i.test(k);
}

// La respuesta de GET /config/auth trae secretos (la contraseña SMTP, los de los proveedores y los hooks).
// Se sacan apenas llega: de la contraseña SMTP queda solo si hay una guardada.
export function sanitizeAuthConfig(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (isSecretKey(k)) continue;
    out[k] = v;
  }
  out.smtp_pass_saved = typeof raw?.smtp_pass === 'string' && raw.smtp_pass.length > 0;
  return out;
}

export function hookConnected(config) {
  return config.hook_before_user_created_enabled === true && config.hook_before_user_created_uri === HOOK_URI;
}

// El registro para invitados ya abierto como se debe (hook conectado y después registro abierto): el comando
// no lo vuelve a cerrar.
export function inviteSignupOpen(config) {
  return hookConnected(config) && config.disable_signup === false;
}

function splitList(s) {
  return String(s ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

// La configuración de login que tiene que quedar (los valores de Wanka de Doc_Supabase.md, "Login", con las
// direcciones y el remitente de este workspace). `current` es la configuración de hoy, ya sin secretos.
// Nunca toca los campos del hook: eso es --open-invite-signup.
export function desiredAuthConfig(opts, current, templates) {
  const redirects = [`${opts.appUrl}/**`, ...opts.redirectUrls.map((u) => `${u}/**`)];
  // Las direcciones que ya estaban se conservan (el dueño pudo sumar alguna a mano); se agregan las que faltan.
  const allow = [...splitList(current.uri_allow_list)];
  for (const r of redirects) if (!allow.includes(r)) allow.push(r);

  const desired = {
    site_url: opts.appUrl,
    uri_allow_list: allow.join(','),
    // Registro cerrado (D-09), salvo que ya esté abierto para invitados con el hook conectado.
    disable_signup: !inviteSignupOpen(current),
    external_email_enabled: true,
    mailer_autoconfirm: false,
    mailer_allow_unverified_email_sign_ins: false,
    mailer_secure_email_change_enabled: true,
    mailer_notifications_email_changed_enabled: false,
    mailer_notifications_identity_linked_enabled: false,
    mailer_notifications_identity_unlinked_enabled: false,
    mailer_notifications_mfa_factor_enrolled_enabled: false,
    mailer_notifications_mfa_factor_unenrolled_enabled: false,
    mailer_notifications_password_changed_enabled: false,
    mailer_notifications_phone_changed_enabled: false,
    mfa_totp_enroll_enabled: true,
    mfa_totp_verify_enabled: true,
    mfa_phone_enroll_enabled: false,
    mfa_phone_verify_enabled: false,
    mfa_web_authn_enroll_enabled: false,
    mfa_web_authn_verify_enabled: false,
    password_min_length: 6,
    sessions_timebox: 0,
    sessions_inactivity_timeout: 0,
    sessions_single_per_user: false,
    mailer_otp_length: 8,
    mailer_otp_exp: 3600,
    jwt_exp: 3600,
    refresh_token_rotation_enabled: true,
    security_refresh_token_reuse_interval: 10,
    security_captcha_enabled: false,
    rate_limit_email_sent: 30,
    rate_limit_otp: 30,
    rate_limit_verify: 30,
    rate_limit_token_refresh: 150,
    smtp_host: opts.smtp.host,
    smtp_port: opts.smtp.port,
    smtp_user: opts.smtp.user,
    smtp_admin_email: opts.smtp.from,
    smtp_sender_name: opts.smtp.senderName,
    smtp_max_frequency: 60,
    mailer_subjects_magic_link: CODE_SUBJECT,
    mailer_subjects_confirmation: CODE_SUBJECT,
    mailer_subjects_invite: INVITE_SUBJECT,
    mailer_templates_magic_link_content: templates.magicLink,
    // Una cuenta nueva que pide código recibe "Confirm signup", no "Magic Link": lleva el mismo contenido,
    // con el código, para que en el iPhone se pueda entrar (Doc_Supabase.md, paso 2 de "Abrir el registro").
    mailer_templates_confirmation_content: templates.magicLink,
    mailer_templates_invite_content: templates.invite,
  };
  // Todo otro proveedor apagado: teléfono, anónimos, Google, Apple, GitHub, Web3… (los que el proyecto tenga).
  for (const k of Object.keys(current)) {
    if (/^external_.+_enabled$/.test(k) && k !== 'external_email_enabled') desired[k] = false;
  }
  for (const k of ['saml_enabled', 'passkey_enabled', 'oauth_server_enabled']) {
    if (k in current) desired[k] = false;
  }
  return desired;
}

function sameValue(key, a, b) {
  if (key === 'uri_allow_list') {
    const x = splitList(a);
    const y = splitList(b);
    return x.length === y.length && x.every((v) => y.includes(v));
  }
  if (key.endsWith('_content')) return String(a ?? '').trim() === String(b ?? '').trim();
  const empty = (v) => v === null || v === undefined || v === '';
  if (empty(a) || empty(b)) return empty(a) && empty(b);
  return String(a) === String(b);
}

// Qué campos cambian: [{ key, from, to }]. El PATCH lleva solo esos (lo que no va no se toca).
export function diffAuthConfig(current, desired) {
  return Object.keys(desired)
    .filter((k) => !sameValue(k, current[k], desired[k]))
    .map((k) => ({ key: k, from: current[k], to: desired[k] }));
}

export function formatAuthDiff(changes, total) {
  const lines = [];
  const same = total - changes.length;
  lines.push(`  = ${same} of ${total} settings already as wanted`);
  for (const c of changes) {
    if (c.key.endsWith('_content')) {
      const from = String(c.from ?? '').trim();
      lines.push(
        `  ~ ${c.key}: ${from ? `differs (${from.length} → ${String(c.to).trim().length} characters)` : `empty → ${String(c.to).trim().length} characters`}`,
      );
    } else if (c.key === 'uri_allow_list') {
      const before = splitList(c.from);
      const added = splitList(c.to).filter((u) => !before.includes(u));
      lines.push(`  ~ uri_allow_list: adds ${added.map((u) => JSON.stringify(u)).join(', ')}`);
    } else {
      lines.push(`  ~ ${c.key}: ${JSON.stringify(c.from ?? null)} → ${JSON.stringify(c.to)}`);
    }
  }
  return lines;
}

// Qué hacer con la contraseña SMTP: 'keep' (ya hay una guardada: no se reescribe aunque esté SMTP_PASSWORD,
// salvo --new-smtp-password, así correrlo de nuevo no cambia nada), 'env' (viene en SMTP_PASSWORD) o 'ask'.
export function smtpPasswordSource({ envPassword, saved, forceNew }) {
  if (saved && !forceNew) return 'keep';
  if (envPassword) return 'env';
  return 'ask';
}

// ---------------------------------------------------------------------------------------------------
// Seguros
// ---------------------------------------------------------------------------------------------------

export function maskEmail(email) {
  const [user, domain] = String(email ?? '').split('@');
  if (!domain) return '(unknown)';
  return `${user.slice(0, 1)}***@${domain}`;
}

// Por qué no se puede escribir en este proyecto (lista vacía: se puede). Dry-run muestra lo mismo y sigue.
export function writeBlockers({ ref, ownerEmail, state }) {
  const out = [];
  if (ref === WANKA_REF) {
    out.push(
      `${WANKA_REF} is Wanka, the workspace that is already in use. Running this for real would overwrite its ` +
        'SMTP settings (and password), its email templates, the closed sign-up and its Site URL. ' +
        'Only --dry-run is allowed against it.',
    );
  }
  const ownerId = state.settings?.owner_id;
  if (ownerId) {
    const current = state.ownerAccount?.email?.toLowerCase();
    if (current !== ownerEmail) {
      out.push(
        `This project already has an owner (${current ? maskEmail(current) : 'an account that no longer exists'}) ` +
          `and it is not ${ownerEmail}. It is someone else's workspace: running this would overwrite its SMTP ` +
          'settings, email templates, closed sign-up and Site URL.',
      );
    }
  }
  const otherOwner = (state.activeOwners ?? []).find((o) => o.user_id !== state.targetAccount?.id);
  if (otherOwner && !out.length) {
    out.push('Another account is already the active owner in the members table. Fix it by hand before running this.');
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Estado y plan
// ---------------------------------------------------------------------------------------------------

// Clave local nueva: nombra lo guardado en los dispositivos para este workspace (Doc_Sincronizacion.md).
export function newLocalKey() {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = 'ws_';
  for (let i = 0; i < 20; i++) s += abc[randomInt(abc.length)];
  return s;
}

// Lo que la app supone de la API y del portero de un workspace. El comando solo lo mira y avisa: no lo cambia.
// Las listas largas (el árbol de páginas, los comentarios de una página, los archivos de las páginas) se piden de a
// 1000 filas y una página más corta se toma por la última: con un tope de filas por pedido menor llegan cortadas.
export const APP_MIN_MAX_ROWS = 1000;
// Los headers que la app le manda al portero. Tienen que estar todos en su CORS (`cors` en portero/src/core.ts): con
// uno que falte, el navegador corta el pedido entero antes de mandarlo.
export const GATEWAY_HEADERS = ['Authorization', 'Content-Type', 'Content-Range', 'Range', 'x-shotdocs-link', 'x-shotdocs-device', 'x-shotdocs-version'];

// El tope de filas por pedido de la API (el ajuste Max rows de la Data API del proyecto), o null si no se pudo leer.
// La respuesta de /postgrest trae también un secreto (`jwt_secret`): de acá sale solo el número, y se pide una sola vez
// por corrida (`runSetup`).
export async function readApiMaxRows(client) {
  try {
    const rows = (await client.get('/postgrest'))?.max_rows;
    return Number.isInteger(rows) ? rows : null;
  } catch {
    return null;
  }
}

// El aviso del tope de filas, o null si alcanza. Si no se pudo leer, lo dice (sin el motivo: el error de la API puede
// traer parte de la respuesta).
export function maxRowsWarning(maxRows) {
  if (maxRows === null) {
    return (
      'Could not read how many rows the API returns per request: check by hand that the Max rows setting of your ' +
      `project's Data API settings is ${APP_MIN_MAX_ROWS} or more.`
    );
  }
  if (maxRows >= APP_MIN_MAX_ROWS) return null;
  return (
    `The API returns at most ${maxRows} rows per request (the Max rows setting of your project's Data API settings). The app ` +
    `expects ${APP_MIN_MAX_ROWS} or more: with fewer, long lists (the pages of a big project, the comments of a page) ` +
    `arrive cut short. Set it back to ${APP_MIN_MAX_ROWS}.`
  );
}

// Cuánto se espera al portero antes de darlo por caído: uno que acepta la conexión y no contesta frenaría el comando.
export const GATEWAY_TIMEOUT_MS = 10_000;

// Le pregunta al portero lo que pregunta un navegador antes de un pedido de la app (la consulta previa de CORS, sin
// sesión): ¿acepta a la app desde su dirección, con todos sus headers? Devuelve el aviso, o null si está bien.
export async function gatewayWarning({ mediaUrl, appUrl, fetch: fetchImpl, timeoutMs = GATEWAY_TIMEOUT_MS }) {
  let res;
  try {
    res = await fetchImpl(`${mediaUrl}/pass`, {
      method: 'OPTIONS',
      // Vencido el tiempo, el pedido se corta y sale por el mismo aviso que un portero que no contesta.
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Origin: appUrl,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': GATEWAY_HEADERS.join(', ').toLowerCase(),
      },
    });
  } catch {
    return `The file gateway at ${mediaUrl} did not answer: check its address (step 5 of the guide).`;
  }
  if (res.headers.get('Access-Control-Allow-Origin') !== appUrl) {
    return `The file gateway does not accept the app at ${appUrl}: add that address to its APP_ORIGINS variable (step 5 of the guide).`;
  }
  const allowed = (res.headers.get('Access-Control-Allow-Headers') ?? '').split(',').map((h) => h.trim().toLowerCase());
  const missing = GATEWAY_HEADERS.filter((h) => !allowed.includes(h.toLowerCase()));
  if (!missing.length) return null;
  return (
    `The file gateway is older than the app: it does not accept ${missing.join(', ')}, so some files will not open or upload. ` +
    'Sync your fork on GitHub (step 1) so Cloudflare publishes the gateway again.'
  );
}

// Lee todo lo que el comando necesita, solo con GET y consultas de solo lectura.
export async function readState(client, ownerEmail) {
  const config = sanitizeAuthConfig(await client.get('/config/auth'));
  const [t] = await client.readQuery(
    `select to_regclass('public.workspace_settings') is not null as settings,
            to_regclass('public.members') is not null as members,
            to_regprocedure('private.hook_before_user_created(jsonb)') is not null as hook`,
  );
  const applied = await appliedVersions(client);
  const settings = t.settings
    ? ((await client.readQuery('select to_jsonb(s) as row from public.workspace_settings s where s.id'))[0]?.row ?? null)
    : null;
  let ownerAccount = null;
  if (settings?.owner_id && UUID_RE.test(settings.owner_id)) {
    ownerAccount =
      (await client.readQuery(`select id::text as id, email::text as email from auth.users where id = ${quote(settings.owner_id)}::uuid`))[0] ??
      null;
  }
  const targetAccount =
    (
      await client.readQuery(
        `select id::text as id, email::text as email, email_confirmed_at is not null as confirmed
         from auth.users where lower(email) = ${quote(ownerEmail)} order by created_at limit 1`,
      )
    )[0] ?? null;
  const activeOwners = t.members
    ? await client.readQuery(`select user_id::text as user_id from public.members where role = 'owner' and removed_at is null`)
    : [];
  const hookGrants = t.hook
    ? (
        await client.readQuery(
          `select has_function_privilege('supabase_auth_admin', 'private.hook_before_user_created(jsonb)', 'execute') as auth_admin_execute,
                  has_schema_privilege('supabase_auth_admin', 'private', 'usage') as auth_admin_usage,
                  has_function_privilege('authenticated', 'private.hook_before_user_created(jsonb)', 'execute') as authenticated_execute`,
        )
      )[0]
    : null;
  return { config, applied, settingsTable: t.settings, settings, ownerAccount, targetAccount, activeOwners, hookGrants };
}

// Qué cambia en workspace_settings y members. En un proyecto sin migrar, la fila va a nacer con los valores
// de fábrica de las migraciones. Si la fila existe pero le faltan columnas (migraciones pendientes), lo que
// valga después lo deciden esas migraciones (la de miembros, por ejemplo, carga nombre y clave en una
// instalación con dueño): el plan lo dice, y la corrida de verdad vuelve a leer después de migrar.
const LATER = '(decided after the pending migrations)';
export function planSettings(opts, state) {
  const s = state.settings ?? { name: DEFAULT_NAME, local_key: null, owner_id: null, media_url: null };
  const has = (k) => k in s;
  const changes = [];
  if (opts.name && opts.name !== s.name) changes.push({ field: 'name', from: has('name') ? s.name : LATER, to: opts.name });
  if (!s.local_key) {
    changes.push(has('local_key')
      ? { field: 'local_key', from: null, to: '(a new random key)' }
      : { field: 'local_key', from: LATER, to: '(a new random key, only if still empty)' });
  }
  if (!s.owner_id) {
    changes.push({ field: 'owner_id', from: null, to: state.targetAccount?.id ?? `(the account of ${opts.ownerEmail})` });
  }
  if (opts.mediaUrl && opts.mediaUrl !== s.media_url) changes.push({ field: 'media_url', from: s.media_url, to: opts.mediaUrl });
  const ownerRow = !(state.targetAccount && (state.activeOwners ?? []).some((o) => o.user_id === state.targetAccount.id));
  const warnings = [];
  if (state.settings && !has('local_key')) {
    warnings.push('Part of step 4 depends on migrations not applied yet: a real run reads it again after applying them.');
  }
  if (!opts.name && (s.name ?? DEFAULT_NAME) === DEFAULT_NAME) {
    warnings.push(`The workspace is still called "${DEFAULT_NAME}": pass --name to give it its name.`);
  }
  return { changes, ownerRow, warnings };
}

// El SQL que completa workspace_settings y la fila del dueño en members. Nunca pisa una clave local ni un
// dueño que ya estén: `coalesce` los deja. Adentro de la transacción vuelve a mirar que el dueño sea el
// esperado (si alguien lo cambió en el medio, no escribe nada).
export function settingsSql({ userId, name, mediaUrl, localKey }) {
  if (!UUID_RE.test(userId)) throw new Error(`Invalid user id: ${userId}`);
  if (!/^[a-z0-9_-]{4,64}$/.test(localKey)) throw new Error('Invalid local key.');
  return `begin;
update public.workspace_settings set
  name = coalesce(${name ? quote(name) : 'null'}, name),
  local_key = coalesce(local_key, ${quote(localKey)}),
  owner_id = coalesce(owner_id, ${quote(userId)}::uuid),
  media_url = coalesce(${mediaUrl ? quote(mediaUrl) : 'null'}, media_url),
  updated_at = now()
where id;
do $$
begin
  if (select owner_id from public.workspace_settings where id) is distinct from ${quote(userId)}::uuid then
    raise exception 'owner_not_saved: workspace_settings has no row or already has another owner';
  end if;
end;
$$;
insert into public.members (user_id, role) values (${quote(userId)}::uuid, 'owner')
on conflict (user_id) do update set role = 'owner', removed_at = null;
commit;`;
}

export function planSetup(opts, state, templates, migrations, env = {}) {
  const pending = pendingMigrations(migrations, state.applied);
  const desired = desiredAuthConfig(opts, state.config, templates);
  const changes = diffAuthConfig(state.config, desired);
  const smtpPassword = smtpPasswordSource({
    envPassword: env.SMTP_PASSWORD,
    saved: state.config.smtp_pass_saved,
    forceNew: opts.newSmtpPassword,
  });
  const settings = planSettings(opts, state);
  const warnings = [...settings.warnings];
  if (smtpPassword === 'keep' && env.SMTP_PASSWORD) {
    warnings.push('SMTP_PASSWORD is set but not used: a password is already saved. Pass --new-smtp-password to replace it.');
  }
  if (
    smtpPassword === 'keep' &&
    state.config.smtp_host &&
    (state.config.smtp_host !== opts.smtp.host || state.config.smtp_user !== opts.smtp.user)
  ) {
    warnings.push('The saved SMTP password belongs to another server or user: pass --new-smtp-password.');
  }
  if (state.config.disable_signup === false && !hookConnected(state.config)) {
    warnings.push('Sign-up is OPEN without the invitation check: this run closes it.');
  }
  if (!state.targetAccount && hookConnected(state.config)) {
    warnings.push(
      `The invitation check is on and ${opts.ownerEmail} has no account yet: the invitation email would be ` +
        'rejected. Create the owner account first (Authentication → Users → Add user → Create new user).',
    );
  }
  return {
    blockers: writeBlockers({ ref: opts.ref, ownerEmail: opts.ownerEmail, state }),
    pending,
    desired,
    changes,
    smtpPassword,
    owner: state.targetAccount ? { action: 'found', account: state.targetAccount } : { action: 'invite' },
    settings,
    warnings,
  };
}

function printPlan(io, opts, state, plan) {
  const log = io.log;
  log(`Project ${opts.ref}${opts.dryRun ? ' — DRY RUN: nothing will be written' : ''}`);
  log('');
  if (plan.blockers.length) {
    log(opts.dryRun ? 'Would REFUSE to write:' : 'REFUSING to write:');
    for (const b of plan.blockers) log(`  ! ${b}`);
    log('');
  }
  log(`1. Database: ${state.applied.size} migrations applied, ${plan.pending.length} to apply`);
  for (const m of plan.pending) log(`  + ${m.file}`);
  log('');
  log('2. Sign-in settings (Authentication), current → wanted:');
  for (const l of formatAuthDiff(plan.changes, Object.keys(plan.desired).length)) log(l);
  log(
    `  SMTP password: ${
      {
        keep: 'keeps the one already saved',
        env: 'will be set from SMTP_PASSWORD (not shown)',
        ask: 'will be asked for, without showing it',
      }[plan.smtpPassword]
    }`,
  );
  log(
    `  Invitation check (Before User Created hook): ${hookConnected(state.config) ? 'connected' : 'not connected'}; ` +
      `sign-up ${state.config.disable_signup === false ? 'open' : 'closed'}. Not changed here (see --open-invite-signup).`,
  );
  log('');
  log('3. Owner account:');
  if (plan.owner.action === 'found') {
    log(`  = ${opts.ownerEmail} has an account (${plan.owner.account.id})${plan.owner.account.confirmed ? '' : ', not confirmed yet'}`);
  } else {
    log(`  + ${opts.ownerEmail} has no account: will be invited by email (the link opens ${opts.appUrl})`);
  }
  log('');
  log('4. Workspace settings (workspace_settings and members):');
  if (!plan.settings.changes.length && !plan.settings.ownerRow) log('  = nothing to change');
  for (const c of plan.settings.changes) log(`  ~ ${c.field}: ${JSON.stringify(c.from ?? null)} → ${JSON.stringify(c.to)}`);
  if (plan.settings.ownerRow) log(`  + members: ${opts.ownerEmail} as owner`);
  if (plan.warnings.length) {
    log('');
    for (const w of plan.warnings) log(`Note: ${w}`);
  }
  log('');
}

// ---------------------------------------------------------------------------------------------------
// Preparar el workspace
// ---------------------------------------------------------------------------------------------------

async function findAuthKey(client) {
  const keys = await client.get('/api-keys?reveal=true');
  const secret = keys.find((k) => k.type === 'secret' && k.api_key && !/\*/.test(k.api_key));
  const legacy = keys.find((k) => k.name === 'service_role' && k.api_key);
  const key = secret?.api_key ?? legacy?.api_key;
  if (!key) throw new Error('Could not read a secret key of the project to send the invitation.');
  return key;
}

// La clave publicable (`sb_publishable_…`) para la app y el portero. La `anon` vieja (un JWT) no se imprime:
// si es la única, hay que crear la publicable en el panel.
export function publishableKeyLine(keys) {
  const pub = (keys ?? []).find((k) => k.type === 'publishable' && /^sb_publishable_/.test(k.api_key ?? ''));
  if (pub) return pub.api_key;
  return '(none yet: in Supabase, Project Settings → API Keys → create a publishable key, sb_publishable_…)';
}

async function publishableKey(client) {
  try {
    return publishableKeyLine(await client.get('/api-keys'));
  } catch {
    return '(Project Settings → API Keys → Publishable key)';
  }
}

export async function runSetup({ client, opts, templates, env = {}, io, migrations }) {
  const all = migrations ?? (await readMigrations());
  const state = await readState(client, opts.ownerEmail);
  const plan = planSetup(opts, state, templates, all, env);
  // Lo que la app supone y el comando solo mira. El tope de filas, una vez por corrida.
  const rows = maxRowsWarning(await readApiMaxRows(client));
  if (rows) plan.warnings.push(rows);
  // El portero, si ya tiene dirección: solo una pregunta (la consulta previa de CORS), nunca un cambio.
  const mediaUrl = opts.mediaUrl ?? state.settings?.media_url ?? null;
  if (mediaUrl && io.fetch) {
    const warning = await gatewayWarning({ mediaUrl, appUrl: opts.appUrl, fetch: io.fetch });
    if (warning) plan.warnings.push(warning);
  }
  printPlan(io, opts, state, plan);

  if (opts.dryRun) {
    io.log('Dry run: nothing was written.');
    return { plan, wrote: false };
  }
  if (plan.blockers.length) throw new Error('Nothing was written.');
  if (plan.owner.action === 'invite' && hookConnected(state.config)) {
    throw new Error(
      `The invitation check is on and ${opts.ownerEmail} has no account: create it in Authentication → Users → ` +
        'Add user → Create new user, then run this again. Nothing was written.',
    );
  }

  // Todo lo que puede fallar antes de escribir, antes: la contraseña.
  let smtpPass = null;
  if (plan.smtpPassword === 'env') smtpPass = env.SMTP_PASSWORD;
  if (plan.smtpPassword === 'ask') {
    if (!io.askHidden) throw new Error('No SMTP password: set SMTP_PASSWORD or run the command in a terminal.');
    smtpPass = (await io.askHidden('SMTP password (the Resend API key, not shown): ')).trim();
    if (!smtpPass) throw new Error('No SMTP password given. Nothing was written.');
  }

  // 1. Migraciones.
  await applyPending(client, {
    onStart: (m) => io.log(`Applying ${m.file}…`),
  });
  io.log('Database up to date.');

  // 2. Login: solo lo que difiere, y la contraseña si hay una nueva. Después se vuelve a leer y se compara.
  const patch = Object.fromEntries(plan.changes.map((c) => [c.key, c.to]));
  if (smtpPass) patch.smtp_pass = smtpPass;
  if (Object.keys(patch).length) {
    try {
      await client.patch('/config/auth', patch);
    } catch (e) {
      // Por las dudas de que un error devuelva lo que se mandó: la contraseña nunca sale por pantalla.
      throw new Error(smtpPass ? e.message.replaceAll(smtpPass, '***') : e.message);
    }
    smtpPass = null;
  }
  const after = sanitizeAuthConfig(await client.get('/config/auth'));
  // Si algo no quedó, se sigue con el dueño y la fila (volver a correrlo lo reintenta) y se avisa al final.
  const problems = diffAuthConfig(after, desiredAuthConfig(opts, after, templates)).map((c) => c.key);
  if (!after.smtp_pass_saved) problems.push('smtp_pass');
  io.log(problems.length ? `Some sign-in settings did not stick: ${problems.join(', ')}` : 'Sign-in settings up to date.');

  // 3. La cuenta del dueño: la que existe con ese correo, o una invitación (manda el mail de Invite).
  let account = (await readState(client, opts.ownerEmail)).targetAccount;
  if (!account) {
    if (hookConnected(after)) {
      throw new Error(
        `The invitation check is on and ${opts.ownerEmail} has no account: create it in Authentication → Users → Add user, then run this again.`,
      );
    }
    const key = await findAuthKey(client);
    const user = await client.request(
      'POST',
      `https://${opts.ref}.supabase.co/auth/v1/invite?redirect_to=${encodeURIComponent(opts.appUrl)}`,
      { body: { email: opts.ownerEmail }, headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!UUID_RE.test(user?.id ?? '')) throw new Error('The invitation did not return an account.');
    account = { id: user.id, email: opts.ownerEmail };
    io.log(`Invitation sent to ${opts.ownerEmail}.`);
  }

  // 4. workspace_settings y members, en una transacción.
  const fresh = await readState(client, opts.ownerEmail);
  const blockers = writeBlockers({ ref: opts.ref, ownerEmail: opts.ownerEmail, state: fresh });
  if (blockers.length) throw new Error(blockers.join('\n'));
  const todo = planSettings(opts, fresh);
  if (todo.changes.length || todo.ownerRow) {
    await client.query(settingsSql({ userId: account.id, name: opts.name, mediaUrl: opts.mediaUrl, localKey: newLocalKey() }));
  }
  const final = (await readState(client, opts.ownerEmail)).settings ?? {};
  io.log(
    `Workspace settings: name "${final.name}", local key ${final.local_key}, owner ${opts.ownerEmail}` +
      (final.media_url ? `, file gateway ${final.media_url}` : ''),
  );

  io.log('');
  io.log('Done. Write these down for the app and the file gateway:');
  io.log(`  Project URL:     https://${opts.ref}.supabase.co`);
  io.log(`  Publishable key: ${await publishableKey(client)}`);
  if (problems.length) {
    throw new Error(
      `Finished, but these sign-in settings did not stick: ${problems.join(', ')}. ` +
        'Run the command again; if they still do not stick, set them in the Supabase dashboard (Authentication).',
    );
  }
  return { plan, wrote: true };
}

// ---------------------------------------------------------------------------------------------------
// Abrir el registro solo para invitados (paso aparte)
// ---------------------------------------------------------------------------------------------------

// Lo que tiene que estar antes de conectar el hook. Lista vacía: listo.
export function inviteSignupPreconditions(state, migrations) {
  const out = [];
  const pending = pendingMigrations(migrations, state.applied);
  if (pending.length) out.push(`${pending.length} migrations are not applied yet: run the setup first.`);
  if (!state.hookGrants) out.push('The invitation check function (private.hook_before_user_created) is missing.');
  else if (
    !state.hookGrants.auth_admin_execute ||
    !state.hookGrants.auth_admin_usage ||
    state.hookGrants.authenticated_execute
  ) {
    out.push('The invitation check function does not have the expected permissions.');
  }
  if (!state.settings?.owner_id) out.push('The workspace has no owner yet: run the setup first.');
  if (!state.config.smtp_host || !state.config.smtp_pass_saved) out.push('The SMTP server is not set up yet: run the setup first.');
  for (const k of ['mailer_templates_confirmation_content', 'mailer_templates_magic_link_content']) {
    if (!String(state.config[k] ?? '').includes('{{ .Token }}')) {
      out.push(`The ${k.replace(/^mailer_templates_|_content$/g, '')} email has no code ({{ .Token }}): run the setup first.`);
    }
  }
  return out;
}

export async function runOpenInviteSignup({ client, opts, io, migrations }) {
  const all = migrations ?? (await readMigrations());
  const state = await readState(client, opts.ownerEmail);
  const blockers = writeBlockers({ ref: opts.ref, ownerEmail: opts.ownerEmail, state });
  const missing = inviteSignupPreconditions(state, all);
  const log = io.log;
  log(`Project ${opts.ref} — open sign-up for invited people${opts.dryRun ? ' — DRY RUN: nothing will be written' : ''}`);
  log('');
  for (const b of blockers) log(`  ! ${opts.dryRun ? 'Would refuse' : 'Refusing'}: ${b}`);
  for (const m of missing) log(`  ! Not ready: ${m}`);
  const connected = hookConnected(state.config);
  log(`  Invitation check (Before User Created hook): ${connected ? 'connected' : 'not connected'}`);
  log(`  Sign-up: ${state.config.disable_signup === false ? 'open' : 'closed'}`);
  if (inviteSignupOpen(state.config)) {
    log('');
    log('Already open for invited people. Nothing to do.');
    return { wrote: false };
  }
  log('');
  log('Steps, in this order (never the other way round):');
  log(`  1. ${connected ? '(already done) ' : ''}connect the hook to private.hook_before_user_created, sign-up still closed`);
  log('  2. verify: the hook is on, and the function rejects an email without an invitation (403)');
  log('  3. only then: open sign-up (disable_signup = false), and check the hook is still on');
  log('');
  if (opts.dryRun) {
    log('Dry run: nothing was written.');
    return { wrote: false };
  }
  if (blockers.length || missing.length) throw new Error('Nothing was written.');

  // 1. El hook, con el registro todavía cerrado.
  if (!connected) {
    await client.patch('/config/auth', { hook_before_user_created_enabled: true, hook_before_user_created_uri: HOOK_URI });
  }
  // 2. Verificar antes de abrir.
  const withHook = sanitizeAuthConfig(await client.get('/config/auth'));
  if (!hookConnected(withHook)) throw new Error('The hook did not stay connected. Sign-up was NOT opened.');
  const [probe] = await client.readQuery(
    `select private.hook_before_user_created('{"user": {"email": "nobody@invitation-check.invalid"}}'::jsonb) #>> '{error,http_code}' as code`,
  );
  if (String(probe?.code) !== '403') {
    throw new Error('The invitation check did not reject an email without an invitation. Sign-up was NOT opened.');
  }
  log('Hook connected and verified.');
  // 3. Recién ahora, abrir.
  await client.patch('/config/auth', { disable_signup: false });
  const opened = sanitizeAuthConfig(await client.get('/config/auth'));
  if (!hookConnected(opened)) {
    // Nunca el registro abierto sin el hook: se vuelve a cerrar.
    await client.patch('/config/auth', { disable_signup: true });
    throw new Error('The hook turned off while opening sign-up: sign-up was closed again.');
  }
  if (opened.disable_signup !== false) throw new Error('Sign-up did not open.');
  log('Sign-up is open for invited people only.');
  log('Test it in the app: an email without an invitation must see "ask for an invitation", an invited one gets the code.');
  return { wrote: true };
}
