// Pruebas de scripts/setup-workspace.mjs (lógica en scripts/lib/setup.mjs) y del cliente de la Management
// API. Sin red: un Supabase falso en memoria que, en modo "solo lectura", falla ante cualquier pedido que no
// sea un GET o una consulta envuelta en `begin read only; … rollback;`.

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { allowedInDryRun, createManagementClient, isReadOnlyQuery, readOnlySql } from './lib/management.mjs';
import {
  HOOK_URI,
  WANKA_REF,
  desiredAuthConfig,
  diffAuthConfig,
  formatAuthDiff,
  inviteSignupPreconditions,
  parseArgs,
  planSettings,
  runOpenInviteSignup,
  runSetup,
  sanitizeAuthConfig,
  settingsSql,
  smtpPasswordSource,
  validateOptions,
  writeBlockers,
} from './lib/setup.mjs';

const templates = {
  magicLink: await readFile(new URL('../supabase/templates/magic_link.html', import.meta.url), 'utf8'),
  invite: await readFile(new URL('../supabase/templates/invite.html', import.meta.url), 'utf8'),
};

const NEW_REF = 'abcdefghijklmnopqrst';
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const SMTP_SECRET = 're_SUPER_SECRET_VALUE';

function opts(extra = {}) {
  return validateOptions(
    parseArgs([
      '--ref', NEW_REF, '--owner-email', 'Owner@Studio.com', '--app-url', 'https://docs.studio.com',
      '--smtp-from', 'shotdocs@studio.com', '--name', 'Studio', ...(extra.args ?? []),
    ]),
  );
}

// Un proyecto recién creado: configuración de fábrica, sin tablas.
function freshConfig() {
  return {
    site_url: 'http://localhost:3000',
    uri_allow_list: '',
    disable_signup: false,
    external_email_enabled: true,
    external_phone_enabled: false,
    external_google_enabled: false,
    external_anonymous_users_enabled: false,
    passkey_enabled: false,
    saml_enabled: false,
    mailer_otp_length: 6,
    mailer_otp_exp: 3600,
    smtp_host: null,
    smtp_pass: null,
    hook_before_user_created_enabled: false,
    hook_before_user_created_uri: null,
    hook_before_user_created_secrets: 'v1,whsec_hidden',
    security_captcha_secret: 'captcha-hidden',
    sms_twilio_auth_token: 'twilio-hidden',
    refresh_token_rotation_enabled: true,
  };
}

// Supabase falso. `readOnly: true`: cualquier escritura es un error de la prueba.
function fakeSupabase({ ref = NEW_REF, config = freshConfig(), db = {}, readOnly = false } = {}) {
  const state = {
    config: { ...config },
    migrationsTable: false,
    applied: new Set(),
    settings: null,
    users: [],
    owners: [],
    hookFn: false,
    ...db,
  };
  const requests = [];
  const json = (v) => new Response(JSON.stringify(v), { status: 200 });
  const api = `https://api.supabase.com/v1/projects/${ref}`;
  const strOf = (q, re) => re.exec(q)?.[1] ?? null;

  function read(q) {
    if (q.includes("to_regclass('supabase_migrations.schema_migrations')")) return [{ present: state.migrationsTable }];
    if (q.includes('select version from supabase_migrations')) return [...state.applied].map((version) => ({ version }));
    if (q.includes("to_regclass('public.workspace_settings')")) {
      return [{ settings: !!state.settings, members: !!state.settings, hook: state.hookFn }];
    }
    if (q.includes('to_jsonb(s)')) return state.settings ? [{ row: { ...state.settings } }] : [];
    if (q.includes('from auth.users where id =')) {
      const id = strOf(q, /id = '([^']+)'::uuid/);
      return state.users.filter((u) => u.id === id).map(({ id, email }) => ({ id, email }));
    }
    if (q.includes('from auth.users where lower(email)')) {
      const em = strOf(q, /lower\(email\) = '([^']+)'/);
      return state.users.filter((u) => u.email === em).map((u) => ({ ...u, confirmed: true }));
    }
    if (q.includes('from public.members')) return state.owners.map((user_id) => ({ user_id }));
    if (q.includes('has_function_privilege')) {
      return [{ auth_admin_execute: true, auth_admin_usage: true, authenticated_execute: false }];
    }
    if (q.includes('private.hook_before_user_created(')) return [{ code: '403' }];
    throw new Error(`Consulta de lectura desconocida: ${q}`);
  }

  function write(q) {
    if (q.includes('create schema if not exists supabase_migrations')) {
      state.migrationsTable = true;
      return [];
    }
    const version = strOf(q, /insert into supabase_migrations\.schema_migrations \(version, name, statements\)\nvalues \('(\d+)'/);
    if (version) {
      state.applied.add(version);
      if (version === '20260930100000') state.settings = { name: 'Workspace', local_key: null, owner_id: null, media_url: null };
      if (version === '20260930160000') state.hookFn = true;
      return [];
    }
    if (q.includes('update public.workspace_settings set')) {
      const s = state.settings;
      const name = strOf(q, /name = coalesce\('([^']*)', name\)/);
      const key = strOf(q, /local_key = coalesce\(local_key, '([^']*)'\)/);
      const owner = strOf(q, /owner_id = coalesce\(owner_id, '([^']*)'::uuid\)/);
      const media = strOf(q, /media_url = coalesce\('([^']*)', media_url\)/);
      if (name) s.name = name;
      s.local_key ??= key;
      s.owner_id ??= owner;
      if (media) s.media_url = media;
      if (s.owner_id !== owner) throw new Error('owner_not_saved');
      if (!state.owners.includes(owner)) state.owners.push(owner);
      return [];
    }
    throw new Error(`Escritura desconocida: ${q.slice(0, 120)}`);
  }

  async function fetch(url, init = {}) {
    const method = init.method ?? 'GET';
    requests.push({ method, url, body: init.body });
    if (readOnly && !allowedInDryRun(method, url, init.body)) {
      throw new Error(`PRUEBA: se intentó escribir (${method} ${url})`);
    }
    if (url === `${api}/config/auth` && method === 'GET') return json(state.config);
    if (url === `${api}/config/auth` && method === 'PATCH') {
      Object.assign(state.config, JSON.parse(init.body));
      return json(state.config);
    }
    if (url.startsWith(`${api}/api-keys`) && method === 'GET') {
      return json([
        { name: 'publishable', type: 'publishable', api_key: 'sb_publishable_test' },
        { name: 'secret', type: 'secret', api_key: 'sb_secret_test' },
      ]);
    }
    if (url.startsWith(`https://${ref}.supabase.co/auth/v1/invite`) && method === 'POST') {
      const { email } = JSON.parse(init.body);
      const user = { id: OWNER_ID, email };
      state.users.push(user);
      return json(user);
    }
    if (url === `${api}/database/query` && method === 'POST') {
      const q = JSON.parse(init.body).query;
      return json(isReadOnlyQuery(q) ? read(q) : write(q));
    }
    return new Response('not found', { status: 404 });
  }

  const writes = () => requests.filter((r) => !allowedInDryRun(r.method, r.url, r.body));
  return { fetch, state, requests, writes };
}

function collector() {
  const lines = [];
  return { lines, io: { log: (l) => lines.push(l), askHidden: null }, text: () => lines.join('\n') };
}

// Un Wanka de mentira: todo aplicado y configurado, con dueño.
async function wankaLike() {
  const { readMigrations } = await import('./lib/migrations.mjs');
  const all = await readMigrations();
  return {
    config: {
      ...freshConfig(),
      site_url: 'https://shotdocs.lega.com.ar',
      uri_allow_list: 'https://shotdocs.lega.com.ar/**,http://localhost:5173/**',
      disable_signup: true,
      smtp_host: 'smtp.resend.com',
      smtp_user: 'resend',
      smtp_pass: SMTP_SECRET,
    },
    db: {
      migrationsTable: true,
      applied: new Set(all.map((m) => m.version)),
      settings: { name: 'Wanka', local_key: WANKA_REF, owner_id: OWNER_ID, media_url: null },
      users: [{ id: OWNER_ID, email: 'lega@lega.com.ar' }],
      owners: [OWNER_ID],
      hookFn: true,
    },
  };
}

describe('cliente de la Management API', () => {
  it('arma consultas de solo lectura y rechaza lo que no lo es', () => {
    expect(readOnlySql('select 1 as a')).toBe('begin read only;\nselect 1 as a;\nrollback;');
    expect(isReadOnlyQuery(readOnlySql('select 1'))).toBe(true);
    expect(() => readOnlySql('select 1; delete from pages')).toThrow();
    expect(() => readOnlySql('delete from pages')).toThrow();
    expect(isReadOnlyQuery('begin read only;\nselect 1;\ncommit;')).toBe(false);
    expect(isReadOnlyQuery('begin read only;\nselect 1;\nupdate x set a = 1;\nrollback;')).toBe(false);
    expect(isReadOnlyQuery('begin;\nselect 1;\nrollback;')).toBe(false);
    expect(isReadOnlyQuery('begin read only;\nupdate x set a = 1;\nrollback;')).toBe(false);
  });

  it('en dry-run frena todo lo que no es GET o lectura, sin llegar a la red', async () => {
    const calls = [];
    const client = createManagementClient({
      ref: NEW_REF,
      dryRun: true,
      fetch: async (url, init) => {
        calls.push([url, init.method]);
        return new Response('[]', { status: 200 });
      },
    });
    await expect(client.patch('/config/auth', { disable_signup: false })).rejects.toThrow(/Dry run/);
    await expect(client.query('update public.workspace_settings set name = 1')).rejects.toThrow(/Dry run/);
    await expect(client.request('POST', `https://${NEW_REF}.supabase.co/auth/v1/invite`, { body: {} })).rejects.toThrow(/Dry run/);
    expect(calls).toEqual([]);
    await client.get('/config/auth');
    await client.readQuery('select 1');
    expect(calls.map((c) => c[1])).toEqual(['GET', 'POST']);
  });

  it('solo acepta refs de proyecto válidos', () => {
    expect(() => createManagementClient({ ref: '../x' })).toThrow();
  });
});

describe('opciones', () => {
  it('nunca acepta la contraseña SMTP como opción', () => {
    expect(() => parseArgs(['--smtp-password', 'x'])).toThrow(/SMTP_PASSWORD/);
    expect(() => parseArgs(['--smtp-pass=x'])).toThrow(/SMTP_PASSWORD/);
    expect(parseArgs(['--new-smtp-password'])['new-smtp-password']).toBe(true);
  });

  it('valida y normaliza', () => {
    const o = opts({ args: ['--media-url', 'https://portero.studio.workers.dev/', '--redirect-url', 'http://localhost:5173'] });
    expect(o.ownerEmail).toBe('owner@studio.com');
    expect(o.appUrl).toBe('https://docs.studio.com');
    expect(o.mediaUrl).toBe('https://portero.studio.workers.dev');
    expect(o.redirectUrls).toEqual(['http://localhost:5173']);
    expect(() => validateOptions(parseArgs(['--ref', NEW_REF, '--owner-email', 'a@b.co', '--app-url', 'http://x.com', '--smtp-from', 'a@b.co']))).toThrow(/https/);
    expect(() => validateOptions(parseArgs(['--ref', NEW_REF, '--owner-email', 'a@b.co', '--app-url', 'https://x.com/app', '--smtp-from', 'a@b.co']))).toThrow(/path/);
    expect(() => validateOptions(parseArgs(['--owner-email', 'a@b.co']))).toThrow(/--ref/);
    expect(() => parseArgs(['--unknown'])).toThrow(/Unknown/);
    // El paso del registro no pide la app ni el remitente.
    expect(validateOptions(parseArgs(['--ref', NEW_REF, '--owner-email', 'a@b.co', '--open-invite-signup'])).openInviteSignup).toBe(true);
  });
});

describe('configuración de login', () => {
  it('saca los secretos apenas llega', () => {
    const c = sanitizeAuthConfig({ ...freshConfig(), smtp_pass: SMTP_SECRET, external_google_secret: 'g' });
    expect(JSON.stringify(c)).not.toContain(SMTP_SECRET);
    expect(c).not.toHaveProperty('hook_before_user_created_secrets');
    expect(c).not.toHaveProperty('security_captcha_secret');
    expect(c).not.toHaveProperty('sms_twilio_auth_token');
    expect(c).not.toHaveProperty('external_google_secret');
    expect(c.passkey_enabled).toBe(false);
    expect(c.refresh_token_rotation_enabled).toBe(true);
    expect(c.smtp_pass_saved).toBe(true);
    expect(sanitizeAuthConfig(freshConfig()).smtp_pass_saved).toBe(false);
  });

  it('arma la configuración deseada', () => {
    const d = desiredAuthConfig(opts(), sanitizeAuthConfig(freshConfig()), templates);
    expect(d.mailer_otp_length).toBe(8);
    expect(d.mailer_otp_exp).toBe(3600);
    expect(d.disable_signup).toBe(true);
    expect(d.site_url).toBe('https://docs.studio.com');
    expect(d.uri_allow_list).toBe('https://docs.studio.com/**');
    expect(d.smtp_host).toBe('smtp.resend.com');
    expect(d.smtp_port).toBe('465');
    expect(d.smtp_user).toBe('resend');
    expect(d.smtp_admin_email).toBe('shotdocs@studio.com');
    expect(d.rate_limit_email_sent).toBe(30);
    expect(d.mailer_templates_magic_link_content).toContain('{{ .Token }}');
    expect(d.mailer_templates_confirmation_content).toContain('{{ .Token }}');
    expect(d.mailer_subjects_confirmation).toContain('{{ .Token }}');
    expect(d.mailer_templates_invite_content).toBe(templates.invite);
    expect(d.external_phone_enabled).toBe(false);
    expect(d.external_google_enabled).toBe(false);
    expect(d.external_email_enabled).toBe(true);
    expect(d.passkey_enabled).toBe(false);
    expect(Object.keys(d).some((k) => k.startsWith('hook_'))).toBe(false);
    expect(d).not.toHaveProperty('smtp_pass');
  });

  it('conserva las direcciones que ya estaban y el registro abierto para invitados', () => {
    const current = sanitizeAuthConfig({
      ...freshConfig(),
      uri_allow_list: 'https://extra.studio.com/**,https://docs.studio.com/**',
      hook_before_user_created_enabled: true,
      hook_before_user_created_uri: HOOK_URI,
      disable_signup: false,
    });
    const d = desiredAuthConfig(opts(), current, templates);
    expect(d.uri_allow_list).toBe('https://extra.studio.com/**,https://docs.studio.com/**');
    expect(d.disable_signup).toBe(false);
    // Abierto sin el hook: se cierra.
    const open = desiredAuthConfig(opts(), sanitizeAuthConfig({ ...freshConfig(), disable_signup: false }), templates);
    expect(open.disable_signup).toBe(true);
  });

  it('el diff ignora diferencias de forma y no muestra las plantillas', () => {
    const d = desiredAuthConfig(opts(), sanitizeAuthConfig(freshConfig()), templates);
    const same = { ...d, smtp_port: 465, mailer_templates_invite_content: `${templates.invite}\n\n` };
    expect(diffAuthConfig(same, d)).toEqual([]);
    const changes = diffAuthConfig(sanitizeAuthConfig(freshConfig()), d);
    expect(changes.map((c) => c.key)).toContain('mailer_otp_length');
    expect(changes.map((c) => c.key)).not.toContain('external_email_enabled');
    const text = formatAuthDiff(changes, Object.keys(d).length).join('\n');
    expect(text).toContain('mailer_otp_length: 6 → 8');
    expect(text).not.toContain('<div');
    expect(text).toContain('mailer_templates_magic_link_content: empty →');
  });

  it('decide de dónde sale la contraseña SMTP', () => {
    expect(smtpPasswordSource({ envPassword: 'x', saved: true })).toBe('env');
    expect(smtpPasswordSource({ saved: true })).toBe('keep');
    expect(smtpPasswordSource({ saved: true, forceNew: true })).toBe('ask');
    expect(smtpPasswordSource({ saved: false })).toBe('ask');
  });
});

describe('seguros', () => {
  it('nunca escribe en Wanka', () => {
    const b = writeBlockers({ ref: WANKA_REF, ownerEmail: 'x@y.com', state: {} });
    expect(b.join()).toMatch(/SMTP.*templates.*sign-up.*Site URL/);
  });

  it('se niega si el proyecto ya tiene otro dueño, y no si es el mismo', () => {
    const state = { settings: { owner_id: OWNER_ID }, ownerAccount: { id: OWNER_ID, email: 'Owner@Studio.com' } };
    expect(writeBlockers({ ref: NEW_REF, ownerEmail: 'owner@studio.com', state })).toEqual([]);
    const other = writeBlockers({ ref: NEW_REF, ownerEmail: 'intruder@else.com', state });
    expect(other.join()).toMatch(/already has an owner \(o\*\*\*@studio\.com\)/);
  });

  it('la clave local y el dueño nunca se pisan', () => {
    const sql = settingsSql({ userId: OWNER_ID, name: "Lega's", localKey: 'ws_abcdefghij' });
    expect(sql).toContain("local_key = coalesce(local_key, 'ws_abcdefghij')");
    expect(sql).toContain(`owner_id = coalesce(owner_id, '${OWNER_ID}'::uuid)`);
    expect(sql).toContain("coalesce('Lega''s', name)");
    const plan = planSettings(opts(), { settings: { name: 'Studio', local_key: 'mine', owner_id: OWNER_ID }, targetAccount: { id: OWNER_ID }, activeOwners: [{ user_id: OWNER_ID }] });
    expect(plan.changes).toEqual([]);
    expect(plan.ownerRow).toBe(false);
  });
});

describe('dry-run', () => {
  it('contra un Wanka de mentira: muestra todo y no escribe nada', async () => {
    const { config, db } = await wankaLike();
    const fake = fakeSupabase({ ref: WANKA_REF, config, db, readOnly: true });
    const client = createManagementClient({ ref: WANKA_REF, dryRun: true, fetch: fake.fetch });
    const out = collector();
    const o = { ...opts(), ref: WANKA_REF, dryRun: true, ownerEmail: 'lega@lega.com.ar', appUrl: 'https://shotdocs.lega.com.ar' };
    const { wrote } = await runSetup({ client, opts: o, templates, env: {}, io: out.io });
    expect(wrote).toBe(false);
    expect(fake.writes()).toEqual([]);
    expect(fake.requests.every((r) => r.method === 'GET' || isReadOnlyQuery(JSON.parse(r.body).query))).toBe(true);
    expect(out.text()).toContain('Would REFUSE to write');
    expect(out.text()).toContain('Dry run: nothing was written.');
    expect(out.text()).not.toContain(SMTP_SECRET);
    expect(fake.state.config.smtp_pass).toBe(SMTP_SECRET);
  });

  it('en un proyecto nuevo: muestra las migraciones, el diff y la invitación, sin escribir', async () => {
    const fake = fakeSupabase({ readOnly: true });
    const client = createManagementClient({ ref: NEW_REF, dryRun: true, fetch: fake.fetch });
    const out = collector();
    await runSetup({ client, opts: { ...opts(), dryRun: true }, templates, env: { SMTP_PASSWORD: SMTP_SECRET }, io: out.io });
    expect(fake.writes()).toEqual([]);
    const text = out.text();
    expect(text).toMatch(/0 migrations applied, \d+ to apply/);
    expect(text).toContain('mailer_otp_length: 6 → 8');
    expect(text).toContain('will be invited');
    expect(text).toContain('local_key: null → "(a new random key)"');
    expect(text).not.toContain(SMTP_SECRET);
  });

  it('el registro para invitados en dry-run no escribe', async () => {
    const fake = fakeSupabase({ readOnly: true });
    const client = createManagementClient({ ref: NEW_REF, dryRun: true, fetch: fake.fetch });
    const out = collector();
    await runOpenInviteSignup({ client, opts: { ...opts(), dryRun: true, openInviteSignup: true }, io: out.io });
    expect(fake.writes()).toEqual([]);
    expect(out.text()).toContain('Not ready');
  });
});

describe('de verdad (contra el Supabase falso)', () => {
  it('contra Wanka se niega antes de escribir', async () => {
    const { config, db } = await wankaLike();
    const fake = fakeSupabase({ ref: WANKA_REF, config, db, readOnly: true });
    const client = createManagementClient({ ref: WANKA_REF, fetch: fake.fetch });
    const o = { ...opts(), ref: WANKA_REF, ownerEmail: 'lega@lega.com.ar' };
    await expect(runSetup({ client, opts: o, templates, env: {}, io: collector().io })).rejects.toThrow(/Nothing was written/);
    expect(fake.writes()).toEqual([]);
  });

  it('contra un proyecto con otro dueño se niega antes de escribir', async () => {
    const { config, db } = await wankaLike();
    const fake = fakeSupabase({ config, db, readOnly: true });
    const client = createManagementClient({ ref: NEW_REF, fetch: fake.fetch });
    await expect(runSetup({ client, opts: opts(), templates, env: {}, io: collector().io })).rejects.toThrow(/Nothing was written/);
    expect(fake.writes()).toEqual([]);
  });

  it('prepara un proyecto nuevo y la segunda vez no cambia nada', async () => {
    const fake = fakeSupabase();
    const client = createManagementClient({ ref: NEW_REF, fetch: fake.fetch });
    const out = collector();
    const o = opts({ args: ['--media-url', 'https://portero.studio.workers.dev'] });
    await runSetup({ client, opts: o, templates, env: { SMTP_PASSWORD: SMTP_SECRET }, io: out.io });

    const patches = fake.requests.filter((r) => r.method === 'PATCH');
    expect(patches).toHaveLength(1);
    const body = JSON.parse(patches[0].body);
    expect(body.smtp_pass).toBe(SMTP_SECRET);
    expect(body.disable_signup).toBe(true);
    expect(Object.keys(body).some((k) => k.startsWith('hook_'))).toBe(false);
    expect(fake.state.config.mailer_otp_length).toBe(8);
    expect(fake.state.settings.local_key).toMatch(/^ws_[a-z0-9]{20}$/);
    expect(fake.state.settings.owner_id).toBe(OWNER_ID);
    expect(fake.state.settings.name).toBe('Studio');
    expect(fake.state.settings.media_url).toBe('https://portero.studio.workers.dev');
    expect(fake.state.owners).toEqual([OWNER_ID]);
    expect(fake.requests.some((r) => r.url.includes('/auth/v1/invite'))).toBe(true);
    expect(out.text()).not.toContain(SMTP_SECRET);
    expect(out.text()).toContain('sb_publishable_test');
    expect(out.text()).not.toContain('sb_secret_test');

    // Segunda vez: nada que cambiar (ni login, ni fila, ni invitación), y la clave local queda.
    const key = fake.state.settings.local_key;
    const before = fake.requests.length;
    await runSetup({ client, opts: o, templates, env: {}, io: collector().io });
    const second = fake.requests.slice(before);
    expect(second.filter((r) => r.method === 'PATCH')).toEqual([]);
    expect(second.some((r) => r.url.includes('/invite'))).toBe(false);
    expect(second.some((r) => r.body?.includes('update public.workspace_settings'))).toBe(false);
    expect(fake.state.settings.local_key).toBe(key);
  });

  it('no pisa una clave local que ya existe', async () => {
    const { db } = await wankaLike();
    const fake = fakeSupabase({
      db: { ...db, settings: { name: 'Workspace', local_key: 'keep_me', owner_id: null, media_url: null }, users: [], owners: [] },
    });
    const client = createManagementClient({ ref: NEW_REF, fetch: fake.fetch });
    await runSetup({ client, opts: opts(), templates, env: { SMTP_PASSWORD: SMTP_SECRET }, io: collector().io });
    expect(fake.state.settings.local_key).toBe('keep_me');
    expect(fake.state.settings.owner_id).toBe(OWNER_ID);
  });

  it('con el hook conectado y sin la cuenta del dueño no escribe nada (la invitación se rechazaría)', async () => {
    const config = { ...freshConfig(), hook_before_user_created_enabled: true, hook_before_user_created_uri: HOOK_URI };
    const fake = fakeSupabase({ config, readOnly: true });
    const client = createManagementClient({ ref: NEW_REF, fetch: fake.fetch });
    await expect(runSetup({ client, opts: opts(), templates, env: { SMTP_PASSWORD: SMTP_SECRET }, io: collector().io })).rejects.toThrow(
      /Nothing was written/,
    );
    expect(fake.writes()).toEqual([]);
  });

  it('sin contraseña SMTP ni terminal no escribe nada', async () => {
    const fake = fakeSupabase({ readOnly: true });
    const client = createManagementClient({ ref: NEW_REF, fetch: fake.fetch });
    await expect(runSetup({ client, opts: opts(), templates, env: {}, io: collector().io })).rejects.toThrow(/SMTP_PASSWORD/);
    expect(fake.writes()).toEqual([]);
  });

  it('abre el registro para invitados: primero el hook, lo verifica, y recién después el registro', async () => {
    const fake = fakeSupabase();
    const client = createManagementClient({ ref: NEW_REF, fetch: fake.fetch });
    await runSetup({ client, opts: opts(), templates, env: { SMTP_PASSWORD: SMTP_SECRET }, io: collector().io });
    const before = fake.requests.length;
    const out = collector();
    await runOpenInviteSignup({ client, opts: { ...opts(), openInviteSignup: true }, io: out.io });
    const steps = fake.requests.slice(before).filter((r) => r.method === 'PATCH').map((r) => JSON.parse(r.body));
    expect(steps).toEqual([
      { hook_before_user_created_enabled: true, hook_before_user_created_uri: HOOK_URI },
      { disable_signup: false },
    ]);
    const probe = fake.requests.slice(before).findIndex((r) => r.body?.includes('private.hook_before_user_created('));
    const open = fake.requests.slice(before).findIndex((r) => r.body?.includes('disable_signup'));
    expect(probe).toBeGreaterThan(-1);
    expect(probe).toBeLessThan(open);
    // Correrlo de nuevo no hace nada; y el setup no vuelve a cerrar el registro.
    const again = fake.requests.length;
    await runOpenInviteSignup({ client, opts: { ...opts(), openInviteSignup: true }, io: collector().io });
    await runSetup({ client, opts: opts(), templates, env: {}, io: collector().io });
    expect(fake.requests.slice(again).filter((r) => r.method === 'PATCH')).toEqual([]);
    expect(fake.state.config.disable_signup).toBe(false);
  });

  it('no abre el registro si falta algo', () => {
    const state = {
      applied: new Set(),
      hookGrants: null,
      settings: null,
      config: sanitizeAuthConfig(freshConfig()),
    };
    const missing = inviteSignupPreconditions(state, [{ version: '1' }]);
    expect(missing.length).toBeGreaterThanOrEqual(4);
  });
});
