import { describe, expect, it, vi } from 'vitest';
import { inviteLink } from './invite';
import { legacyStorageNames, storageNamesFor, WANKA_LOCAL_KEY } from './workspace';
import {
  activeWorkspace,
  addWorkspace,
  adoptPending,
  checkWorkspace,
  configOf,
  forgetWorkspaceStorage,
  loadWorkspaces,
  pendingEntry,
  probeWorkspace,
  readWorkspaces,
  removeWorkspace,
  renameWorkspace,
  resolveInvite,
  resolveInviteText,
  safeWorkspaceName,
  sameOrigin,
  switchWorkspace,
  updateWorkspaces,
  workspaceOrigin,
  WORKSPACES_KEY,
  type DeviceWorkspace,
  type KeyValueStore,
} from './workspaces';

// La lista de workspaces del dispositivo (paso 12 de Plan_Workspaces.md). Lo guardado de Wanka NUNCA
// cambia de nombre: renombrarlo desloguea a Lega en todos sus dispositivos y, sin red, lo deja sin su base.

const WANKA = { url: 'https://znlvpuddswymxpffgvbz.supabase.co', publishableKey: 'sb_publishable_wankaKey123' };
const STUDIO_URL = 'https://abcdefghijklmnopqrst.supabase.co';
const STUDIO_KEY = 'sb_publishable_studioKey456';

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

function studio(localKey = 'ws_studio1234567890abc'): DeviceWorkspace {
  return { id: localKey, url: STUDIO_URL, publishableKey: STUDIO_KEY, localKey, name: 'Studio' };
}

describe('lista de workspaces del dispositivo', () => {
  it('Wanka entra a la lista con los nombres de siempre', () => {
    const store = memoryStore();
    const list = loadWorkspaces(WANKA, store);
    expect(list.workspaces).toHaveLength(1);
    const wanka = activeWorkspace(list)!;
    expect(wanka.legacy).toBe(true);
    expect(wanka.id).toBe(WANKA_LOCAL_KEY);
    const config = configOf(wanka);
    expect(config.localKey).toBe('znlvpuddswymxpffgvbz');
    expect(config.storage.auth).toBe('shotdocs-auth');
    expect(config.storage.lastUser).toBe('shotdocs-last-user');
    expect(config.storage.project).toBe('shotdocs-project');
    expect(config.storage.lastPages).toBe('shotdocs-last-pages');
    expect(config.storage.db('u1')).toBe('shotdocs:znlvpuddswymxpffgvbz:u1');
    // Queda guardada con la clave nueva, sin tocar ninguna de las de siempre.
    expect([...store.data.keys()]).toEqual([WORKSPACES_KEY]);
  });

  it('los nombres de Wanka no cambian aunque la lista guardada venga tocada, ni al agregar otros', () => {
    const store = memoryStore({
      [WORKSPACES_KEY]: JSON.stringify({
        active: 'otra',
        workspaces: [{ id: 'otra', url: WANKA.url, publishableKey: 'vieja', localKey: 'otra', name: 'Wanka', legacy: true }],
      }),
    });
    let list = loadWorkspaces(WANKA, store);
    list = updateWorkspaces((l) => addWorkspace(l, studio()), store);
    list = loadWorkspaces(WANKA, store);
    const wanka = list.workspaces.find((w) => w.legacy)!;
    expect(wanka.name).toBe('Wanka');
    expect(wanka.publishableKey).toBe(WANKA.publishableKey);
    expect(configOf(wanka).storage.auth).toBe('shotdocs-auth');
    expect(configOf(wanka).storage.db('u1')).toBe('shotdocs:znlvpuddswymxpffgvbz:u1');
    expect(list.workspaces.filter((w) => w.legacy)).toHaveLength(1);
    // El último abierto se respeta.
    expect(list.active).toBe('ws_studio1234567890abc');
  });

  it('si la compilación cambia de dirección (Wanka restaurada en otro proyecto), sigue con la base de siempre', () => {
    const store = memoryStore();
    loadWorkspaces(WANKA, store);
    const list = loadWorkspaces({ url: 'https://nuevoproyecto0000000.supabase.co/', publishableKey: 'sb_publishable_nueva1234' }, store);
    expect(list.workspaces).toHaveLength(1);
    const wanka = list.workspaces[0];
    expect(wanka.url).toBe('https://nuevoproyecto0000000.supabase.co');
    expect(configOf(wanka).storage).toMatchObject({ auth: 'shotdocs-auth', project: 'shotdocs-project' });
    expect(configOf(wanka).storage.db('u1')).toBe('shotdocs:znlvpuddswymxpffgvbz:u1');
  });

  it('una lista tocada con otra entrada para la dirección de Wanka nunca le cambia los nombres', () => {
    const evil = { id: 'ws_evil1', url: WANKA.url, publishableKey: 'sb_publishable_evilKey123', localKey: 'ws_evil1', name: 'Wanka' };
    const sameKey = {
      id: WANKA_LOCAL_KEY,
      url: 'https://atacante0000000000.supabase.co',
      publishableKey: 'sb_publishable_evilKey123',
      localKey: WANKA_LOCAL_KEY,
      name: 'Wanka',
    };
    for (const workspaces of [[evil], [sameKey], [evil, { ...evil, id: 'ws_evil2', localKey: 'ws_evil2', url: `${WANKA.url}.` }]]) {
      const store = memoryStore({ [WORKSPACES_KEY]: JSON.stringify({ active: workspaces[0].id, workspaces }) });
      const list = loadWorkspaces(WANKA, store);
      expect(list.workspaces).toHaveLength(1);
      const opened = activeWorkspace(list)!;
      expect(opened.legacy).toBe(true);
      expect(configOf(opened).storage.auth).toBe('shotdocs-auth');
      expect(configOf(opened).storage.db('u1')).toBe('shotdocs:znlvpuddswymxpffgvbz:u1');
      // Y así quedó guardada.
      expect(readWorkspaces(store).workspaces.map((w) => w.id)).toEqual([WANKA_LOCAL_KEY]);
    }
  });

  it('al leer, descarta entradas con una dirección o una clave publicable que no se podrían haber agregado', () => {
    const bad = [
      { ...studio('ws_http00000'), url: 'http://abcdefghijklmnopqrst.supabase.co' },
      { ...studio('ws_path00000'), url: `${STUDIO_URL}/rest/v1` },
      { ...studio('ws_secret0000'), url: 'https://otro0000000000000000.supabase.co', publishableKey: 'sb_secret_abcdefghijkl' },
      { ...studio('ws_nokey00000'), url: 'https://otro1111111111111111.supabase.co', publishableKey: '' },
    ];
    const store = memoryStore({ [WORKSPACES_KEY]: JSON.stringify({ active: null, workspaces: [...bad, studio()] }) });
    expect(readWorkspaces(store).workspaces.map((w) => w.id)).toEqual(['ws_studio1234567890abc']);
  });

  it('un workspace nuevo usa los nombres con su clave local', () => {
    const config = configOf(studio());
    const expected = storageNamesFor('ws_studio1234567890abc');
    expect(config.storage.auth).toBe(expected.auth);
    expect(config.storage.auth).not.toBe(legacyStorageNames(WANKA_LOCAL_KEY).auth);
    expect(config.storage.db('u1')).toBe('shotdocs:ws_studio1234567890abc:u1');
  });

  it('sin compilación configurada y sin nada guardado, la lista queda vacía (bienvenida)', () => {
    const list = loadWorkspaces(null, memoryStore());
    expect(list).toEqual({ active: null, workspaces: [] });
  });

  it('descarta entradas rotas y repetidas al leer', () => {
    const store = memoryStore({
      [WORKSPACES_KEY]: JSON.stringify({
        active: 'x',
        workspaces: [
          studio(),
          studio(),
          { id: 'MAL', url: STUDIO_URL, publishableKey: STUDIO_KEY, localKey: 'MAL', name: '' },
          { id: 'sin-pending', url: STUDIO_URL, publishableKey: STUDIO_KEY, localKey: '', name: '', pending: true },
          'basura',
        ],
      }),
    });
    const list = readWorkspaces(store);
    expect(list.workspaces.map((w) => w.id)).toEqual(['ws_studio1234567890abc']);
    expect(list.active).toBeNull();
  });

  it('guarda el nombre de la base sin tocar la clave local', () => {
    const list = addWorkspace(loadWorkspaces(WANKA, memoryStore()), studio());
    const renamed = renameWorkspace(list, WANKA_LOCAL_KEY, ' Wanka ');
    expect(renamed.workspaces[0]).toMatchObject({ name: 'Wanka', localKey: WANKA_LOCAL_KEY, legacy: true });
    expect(renameWorkspace(renamed, WANKA_LOCAL_KEY, 'Wanka')).toBe(renamed);
  });
});

describe('validar un workspace nuevo y los links de invitación', () => {
  const base = () => loadWorkspaces(WANKA, memoryStore());

  it('pide https, clave publicable y clave local con su forma', () => {
    expect(workspaceOrigin('https://abc.supabase.co/', false)).toBe('https://abc.supabase.co');
    expect(workspaceOrigin('http://abc.supabase.co', false)).toBeNull();
    expect(workspaceOrigin('javascript:alert(1)', false)).toBeNull();
    expect(workspaceOrigin('https://user:pw@abc.supabase.co', false)).toBeNull();
    expect(workspaceOrigin('https://abc.supabase.co/rest/v1', false)).toBeNull();
    expect(workspaceOrigin('http://localhost:54321', false)).toBeNull();
    expect(workspaceOrigin('http://localhost:54321', true)).toBe('http://localhost:54321');
    // El punto final del DNS es el mismo host.
    expect(workspaceOrigin('https://ABC.supabase.co./', false)).toBe('https://abc.supabase.co');
    expect(sameOrigin('https://abc.supabase.co.', 'https://abc.supabase.co/')).toBe(true);

    const list = base();
    expect(checkWorkspace(list, { url: STUDIO_URL, publishableKey: STUDIO_KEY, localKey: 'ws_nueva1234' })).toEqual({
      kind: 'ok',
      url: STUDIO_URL,
    });
    expect(checkWorkspace(list, { url: 'http://x.supabase.co', publishableKey: STUDIO_KEY }).kind).toBe('invalid');
    expect(checkWorkspace(list, { url: STUDIO_URL, publishableKey: 'eyJhbGciOi.jwt.viejo' }).kind).toBe('invalid');
    const secret = checkWorkspace(list, { url: STUDIO_URL, publishableKey: 'sb_secret_abcdefghijkl' });
    expect(secret.kind === 'invalid' && secret.reason).toMatch(/secret key/);
    expect(checkWorkspace(list, { url: STUDIO_URL, publishableKey: STUDIO_KEY, localKey: 'Con Espacios' }).kind).toBe('invalid');
    expect(checkWorkspace(list, { url: STUDIO_URL, publishableKey: STUDIO_KEY, localKey: 'pending.abc' }).kind).toBe('invalid');
  });

  it('nunca acepta otra dirección con la clave local de Wanka ni de otro workspace del dispositivo', () => {
    const list = addWorkspace(base(), studio(), false);
    const wankaKey = checkWorkspace(list, { url: 'https://atacante0000000000.supabase.co', publishableKey: STUDIO_KEY, localKey: WANKA_LOCAL_KEY });
    expect(wankaKey.kind).toBe('invalid');
    const studioKey = checkWorkspace(list, {
      url: 'https://otro00000000000000.supabase.co',
      publishableKey: STUDIO_KEY,
      localKey: 'ws_studio1234567890abc',
    });
    expect(studioKey.kind === 'invalid' && studioKey.reason).toMatch(/Studio/);
  });

  it('la misma dirección es el workspace que ya está, sin tocar lo guardado', () => {
    const list = base();
    const check = checkWorkspace(list, { url: `${WANKA.url}/`, publishableKey: STUDIO_KEY, localKey: 'ws_otraclave123' });
    expect(check.kind === 'existing' && check.entry.legacy).toBe(true);
    const dotted = checkWorkspace(list, { url: `${WANKA.url}.`, publishableKey: STUDIO_KEY, localKey: 'ws_otraclave123' });
    expect(dotted.kind).toBe('existing');
    // Una clave secreta se avisa aunque el workspace ya esté.
    expect(checkWorkspace(list, { url: WANKA.url, publishableKey: 'sb_secret_abcdefghijkl' }).kind).toBe('invalid');
  });

  it('un link de otro workspace pide confirmación con su nombre; uno del que ya está lo abre', () => {
    const list = base();
    const page = '0b7e5a52-8d1d-4a0f-9d62-3f1f1a2b3c4d';
    const link = inviteLink('https://shotdocs.lega.com.ar', { u: STUDIO_URL, k: STUDIO_KEY, l: 'ws_nueva1234', p: page, n: 'Studio' });
    const other = resolveInviteText(list, `  ${link}  `);
    expect(other).toMatchObject({
      kind: 'confirm',
      target: page,
      entry: { id: 'ws_nueva1234', url: STUDIO_URL, publishableKey: STUDIO_KEY, localKey: 'ws_nueva1234', name: 'Studio' },
    });
    const own = resolveInviteText(list, inviteLink('https://shotdocs.lega.com.ar', { u: WANKA.url, k: WANKA.publishableKey, l: WANKA_LOCAL_KEY }));
    expect(own).toMatchObject({ kind: 'open', target: null, entry: { legacy: true } });
    expect(resolveInviteText(list, 'https://shotdocs.lega.com.ar/').kind).toBe('invalid');
    // El nombre lo arma quien manda el link: sin comillas ni saltos, recortado.
    const disguised = resolveInvite(list, {
      u: STUDIO_URL,
      k: STUDIO_KEY,
      l: 'ws_nueva1234',
      n: '"Wanka"\nat znlvpuddswymxpffgvbz.supabase.co and a very long tail',
    });
    expect(disguised.kind === 'confirm' && disguised.entry.name).toBe('Wanka at znlvpuddswymxpffgvbz.supabase.…');
    expect(safeWorkspaceName('  Studio\u202e  ')).toBe('Studio');
    expect(resolveInviteText(list, '#invite=%%%').kind).toBe('invalid');
    const badKey = inviteLink('https://a', { u: STUDIO_URL, k: 'no-es-una-clave', l: 'ws_nueva1234' });
    expect(resolveInviteText(list, badKey).kind).toBe('invalid');
  });
});

describe('cambiar y quitar', () => {
  it('cambiar guarda el elegido como el último abierto y recarga', () => {
    const store = memoryStore();
    loadWorkspaces(WANKA, store);
    updateWorkspaces((l) => addWorkspace(l, studio(), false), store);
    expect(readWorkspaces(store).active).toBe(WANKA_LOCAL_KEY);
    const reload = vi.fn();
    switchWorkspace('ws_studio1234567890abc', reload, store);
    expect(reload).toHaveBeenCalledTimes(1);
    const list = loadWorkspaces(WANKA, store);
    expect(activeWorkspace(list)?.name).toBe('Studio');
    // Un id que no está no cambia nada.
    switchWorkspace('no-existe', reload, store);
    expect(readWorkspaces(store).active).toBe('ws_studio1234567890abc');
  });

  it('Wanka nunca sale de la lista; quitar otro deja abierto a Wanka', () => {
    const list = addWorkspace(loadWorkspaces(WANKA, memoryStore()), studio());
    expect(list.active).toBe('ws_studio1234567890abc');
    expect(removeWorkspace(list, WANKA_LOCAL_KEY)).toBe(list);
    const after = removeWorkspace(list, 'ws_studio1234567890abc');
    expect(after.workspaces.map((w) => w.id)).toEqual([WANKA_LOCAL_KEY]);
    expect(after.active).toBe(WANKA_LOCAL_KEY);
    // Sin ninguno más, la bienvenida.
    const alone = { active: 'ws_studio1234567890abc', workspaces: [studio()] };
    expect(removeWorkspace(alone, 'ws_studio1234567890abc')).toEqual({ active: null, workspaces: [] });
  });

  it('quitar olvida solo lo guardado de ese workspace, nunca lo de Wanka', () => {
    const names = storageNamesFor('ws_studio1234567890abc');
    const store = memoryStore({
      'shotdocs-auth': 'sesion-wanka',
      'shotdocs-last-user': 'u',
      'shotdocs-project': '{}',
      'shotdocs-last-pages': '{}',
      [names.auth]: 'sesion-studio',
      [`${names.auth}-user`]: 'x',
      [names.lastUser]: 'u',
      [names.project]: '{}',
      [names.lastPages]: '{}',
    });
    forgetWorkspaceStorage(studio(), store);
    expect([...store.data.keys()].sort()).toEqual(['shotdocs-auth', 'shotdocs-last-pages', 'shotdocs-last-user', 'shotdocs-project']);
    forgetWorkspaceStorage(loadWorkspaces(WANKA, memoryStore()).workspaces[0], store);
    expect(store.data.get('shotdocs-auth')).toBe('sesion-wanka');
  });
});

describe('uno creado con la guía, pendiente hasta entrar', () => {
  it('pasa la sesión a los nombres de su clave local y queda abierto', () => {
    const store = memoryStore();
    loadWorkspaces(WANKA, store);
    const pending = pendingEntry(STUDIO_URL, STUDIO_KEY);
    expect(pending.id).toMatch(/^pending\.[0-9a-f]{20}$/);
    updateWorkspaces((l) => addWorkspace(l, pending), store);
    const provisional = configOf(pending).storage;
    store.setItem(provisional.auth, 'sesion');
    store.setItem(provisional.lastUser, '{"id":"u1"}');

    const result = adoptPending(pending.id, { name: 'Studio', localKey: 'ws_studio1234567890abc' }, store);
    expect(result.ok).toBe(true);
    const names = storageNamesFor('ws_studio1234567890abc');
    expect(store.getItem(names.auth)).toBe('sesion');
    expect(store.getItem(names.lastUser)).toBe('{"id":"u1"}');
    expect(store.getItem(provisional.auth)).toBeNull();
    const list = readWorkspaces(store);
    expect(list.active).toBe('ws_studio1234567890abc');
    expect(list.workspaces.map((w) => w.id)).toEqual([WANKA_LOCAL_KEY, 'ws_studio1234567890abc']);
    expect(list.workspaces[1]).toMatchObject({ name: 'Studio', localKey: 'ws_studio1234567890abc' });
    expect(list.workspaces[1].pending).toBeUndefined();
    // La sesión de Wanka, intacta.
    expect(store.getItem('shotdocs-auth')).toBeNull();
  });

  it('sin clave local, o con la de otro workspace, no se completa', () => {
    const store = memoryStore();
    loadWorkspaces(WANKA, store);
    const pending = pendingEntry(STUDIO_URL, STUDIO_KEY);
    updateWorkspaces((l) => addWorkspace(l, pending), store);
    const missing = adoptPending(pending.id, { name: 'Studio', localKey: null }, store);
    expect(missing.ok === false && missing.reason).toMatch(/setup command/);
    const clash = adoptPending(pending.id, { name: 'Studio', localKey: WANKA_LOCAL_KEY }, store);
    expect(clash.ok).toBe(false);
    expect(readWorkspaces(store).workspaces.find((w) => w.id === pending.id)?.pending).toBe(true);
  });
});

describe('leer workspace_settings con la clave publicable', () => {
  const respond = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it('lee nombre, clave local y versión, y manda la clave solo en apikey', async () => {
    const fetchFn = respond(200, [{ name: 'Studio', local_key: 'ws_studio1234567890abc', schema_version: 5 }]);
    const probe = await probeWorkspace(STUDIO_URL, STUDIO_KEY, fetchFn as unknown as typeof fetch);
    expect(probe).toEqual({ kind: 'ready', name: 'Studio', localKey: 'ws_studio1234567890abc', schemaVersion: 5 });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${STUDIO_URL}/rest/v1/workspace_settings?select=name,local_key,schema_version&limit=1`);
    expect(init.headers).toEqual({ apikey: STUDIO_KEY, Accept: 'application/json' });
  });

  it('distingue lo que falta: el comando, entrar primero, la clave o la red', async () => {
    const probe = (status: number, body: unknown) => probeWorkspace(STUDIO_URL, STUDIO_KEY, respond(status, body) as unknown as typeof fetch);
    expect(await probe(200, [{ name: 'Workspace', local_key: null, schema_version: 5 }])).toEqual({ kind: 'noLocalKey' });
    expect(await probe(200, [])).toEqual({ kind: 'notSetUp' });
    expect(await probe(404, { code: 'PGRST205', message: 'Could not find the table' })).toEqual({ kind: 'notSetUp' });
    expect(await probe(400, { code: '42703', message: 'column does not exist' })).toEqual({ kind: 'notSetUp' });
    expect(await probe(401, { code: '42501', message: 'permission denied for table workspace_settings' })).toEqual({
      kind: 'signInFirst',
    });
    expect(await probe(401, { message: 'Invalid API key' })).toEqual({ kind: 'badKey' });
    const offline = await probeWorkspace(STUDIO_URL, STUDIO_KEY, (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch);
    expect(offline).toEqual({ kind: 'unreachable', message: 'Failed to fetch' });
  });
});
