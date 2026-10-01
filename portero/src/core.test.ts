import { describe, expect, it } from 'vitest';
import {
  CACHE_FILES,
  CACHE_HEAD_PIECES,
  CACHE_PIECE,
  CACHE_TAIL_PIECES,
  cacheSlot,
  cleanFileName,
  contentDisposition,
  folderName,
  inlineType,
  Portero,
  type Env,
  type Store,
} from './core';

const env: Env = {
  SUPABASE_URL: 'https://ws.example',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
  APP_ORIGINS: 'https://app.example, http://localhost:5173',
  GOOGLE_CLIENT_ID: 'client',
  GOOGLE_CLIENT_SECRET: 'secret',
};
const SELF = 'https://portero.example';
const APP = 'https://app.example';

function memoryStore(): Store & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async <T,>(k: string) => structuredClone(data.get(k)) as T | undefined,
    put: async (k, v) => void data.set(k, structuredClone(v)),
    delete: async (k) => void data.delete(k),
  };
}

type FakeFile = {
  name: string;
  mime: string;
  data: Uint8Array<ArrayBuffer>;
  parents: string[];
  appProperties?: Record<string, string>;
  trashed?: boolean;
};
type BaseFile = {
  project_id: string;
  project_name: string;
  name: string;
  mime: string;
  size: number;
  drive_id: string | null;
  levels: Record<string, number>;
  /** Papelera de archivos: como en la base (`purge_file` marca `purged_at`, `media_purged` lo confirma). */
  trashed_at?: string | null;
  purged_at?: string | null;
  drive_trashed_at?: string | null;
  /** Lo usa una página de un proyecto borrado (P.14): `purge_file` da `file_in_deleted_project`. */
  in_deleted_project?: boolean;
};

/** Google y Supabase de mentira: sesiones, tokens, carpetas, subida por partes y bajada con Range. */
function fakeWorld() {
  const sessions = new Map<string, { user: string; owner: boolean }>([
    ['owner-jwt', { user: 'u-owner', owner: true }],
    ['member-jwt', { user: 'u-member', owner: false }],
    ['admin-jwt', { user: 'u-admin', owner: false }],
    ['editor-jwt', { user: 'u-editor', owner: false }],
    ['viewer-jwt', { user: 'u-viewer', owner: false }],
    ['stranger-jwt', { user: 'u-stranger', owner: false }],
  ]);
  const files = new Map<string, FakeFile>();
  const base = new Map<string, BaseFile>();
  const uploads = new Map<
    string,
    { name: string; mime: string; size: number; parents: string[]; appProperties?: Record<string, string>; data: Uint8Array<ArrayBuffer>; got: number }
  >();
  let refreshValid = true;
  let tokenRefreshes = 0;
  let refreshScopes: (string | null)[] = [];
  let linkFailures = 0;
  /** Quiénes pueden mandar a la papelera de Drive (en la base: dueño y admins con permiso sobre el proyecto). */
  const purgers = new Set(['u-owner', 'u-admin']);
  let trashReady = true;
  let grantedScope = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email openid';
  let n = 0;
  let mediaGets = 0;
  let metaGets = 0;
  const calls: string[] = [];

  const http = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers);
    calls.push(`${init.method ?? 'GET'} ${url.host}${url.pathname}`);
    const jsonRes = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...extra } });

    if (url.host === 'ws.example') {
      const s = sessions.get((headers.get('Authorization') ?? '').replace('Bearer ', ''));
      if (!s) return jsonRes({ message: 'JWT expired' }, 401);
      const args = JSON.parse(String(init.body ?? '{}')) as { p_file_id?: string; p_drive_id?: string; p_file?: string };
      if (url.pathname === '/rest/v1/rpc/media_file') {
        const f = base.get(args.p_file_id ?? '');
        const level = f?.levels[s.user] ?? 0;
        if (!f || level === 0) return jsonRes(null);
        return jsonRes({ id: args.p_file_id, ...f, levels: undefined, created_at: '2026-09-30T10:00:00Z', level });
      }
      if (url.pathname === '/rest/v1/rpc/purge_file' || url.pathname === '/rest/v1/rpc/media_purged') {
        // Los errores como los da PostgREST: 42501 → 403, P0001 → 400, y P0002 con otro estado.
        if (!trashReady) return jsonRes({ code: 'PGRST202', message: 'Could not find the function' }, 404);
        const f = base.get(args.p_file ?? '');
        if (!f || (f.levels[s.user] ?? 0) === 0) return jsonRes({ code: 'P0002', message: 'file_not_found' }, 500);
        // media_purged también la puede quien edita el archivo (termina una subida de un archivo ya pedido).
        const confirmByEditor = url.pathname.endsWith('/media_purged') && (f.levels[s.user] ?? 0) >= 3;
        if (!purgers.has(s.user) && !confirmByEditor) return jsonRes({ code: '42501', message: 'not_allowed' }, 403);
        if (url.pathname.endsWith('/purge_file')) {
          if (!f.trashed_at) return jsonRes({ code: 'P0001', message: 'file_not_trashed' }, 400);
          if (!f.purged_at && f.in_deleted_project) return jsonRes({ code: 'P0001', message: 'file_in_deleted_project' }, 400);
          f.purged_at ??= '2026-10-30T10:00:00Z';
        } else {
          if (!f.purged_at) return jsonRes({ code: 'P0001', message: 'file_not_purged' }, 400);
          f.drive_trashed_at ??= '2026-10-30T10:00:01Z';
        }
        return new Response(null, { status: 204 });
      }
      if (url.pathname === '/rest/v1/rpc/set_file_drive') {
        if (linkFailures > 0) {
          linkFailures--;
          throw new TypeError('fetch failed');
        }
        const f = base.get(args.p_file_id ?? '');
        if (!f || (f.levels[s.user] ?? 0) < 3) return jsonRes({ code: 'P0002', message: 'file_not_found' }, 404);
        if (f.drive_id && f.drive_id !== args.p_drive_id) return jsonRes({ code: 'P0001', message: 'file_already_uploaded' }, 400);
        f.drive_id = args.p_drive_id!;
        return new Response(null, { status: 204 });
      }
      return jsonRes({ user_id: s.user, is_owner: s.owner });
    }
    if (url.href === 'https://oauth2.googleapis.com/token') {
      const form = new URLSearchParams(String(init.body));
      if (form.get('grant_type') === 'authorization_code') {
        const idToken = `h.${btoa(JSON.stringify({ email: 'lega@example.com' }))}.s`;
        return jsonRes({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, id_token: idToken, scope: grantedScope });
      }
      tokenRefreshes++;
      refreshScopes.push(form.get('scope'));
      if (!refreshValid) return jsonRes({ error: 'invalid_grant' }, 400);
      return jsonRes({ access_token: `at-${++n}`, expires_in: 3600 });
    }
    if (!/^Bearer at-/.test(headers.get('Authorization') ?? '') && !url.pathname.startsWith('/session/')) {
      return jsonRes({ error: 'unauthorized' }, 401);
    }
    if (url.host === 'www.googleapis.com' && url.pathname === '/drive/v3/files' && init.method === 'POST') {
      const meta = JSON.parse(String(init.body)) as { name: string; parents?: string[]; appProperties?: Record<string, string> };
      if (meta.parents?.some((p) => p !== 'root' && !files.has(p))) return jsonRes({ error: 'parent not found' }, 404);
      const id = `folder${++n}xxxxxxxx`;
      files.set(id, { name: meta.name, mime: 'application/vnd.google-apps.folder', data: new Uint8Array(), parents: meta.parents ?? ['root'], appProperties: meta.appProperties });
      return jsonRes({ id });
    }
    const one = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname)?.[1];
    if (one && url.searchParams.get('alt') === 'media') {
      mediaGets++;
      const f = files.get(one);
      if (!f) return jsonRes({ error: 'not found' }, 404);
      const range = /bytes=(\d*)-(\d*)/.exec(headers.get('Range') ?? '');
      if (!range) return new Response(f.data, { status: 200, headers: { 'Content-Type': f.mime, 'Content-Length': String(f.data.length), ETag: '"v1"' } });
      let start = Number(range[1]);
      let end = range[2] ? Math.min(Number(range[2]), f.data.length - 1) : f.data.length - 1;
      if (range[1] === '') [start, end] = [Math.max(0, f.data.length - Number(range[2])), f.data.length - 1];
      if (start >= f.data.length) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${f.data.length}` } });
      return new Response(f.data.slice(start, end + 1), {
        status: 206,
        headers: { 'Content-Type': f.mime, 'Content-Range': `bytes ${start}-${end}/${f.data.length}`, 'Content-Length': String(end - start + 1), ETag: '"v1"' },
      });
    }
    if (one && init.method === 'PATCH') {
      const f = files.get(one);
      if (!f) return jsonRes({ error: 'not found' }, 404);
      const body = JSON.parse(String(init.body ?? '{}')) as { name?: string; trashed?: boolean };
      if (body.name) f.name = body.name;
      if (body.trashed !== undefined) f.trashed = body.trashed;
      const add = url.searchParams.get('addParents');
      const remove = (url.searchParams.get('removeParents') ?? '').split(',').filter(Boolean);
      if (add) f.parents = [...f.parents.filter((p) => !remove.includes(p)), add];
      return jsonRes({ id: one, parents: f.parents });
    }
    if (one) {
      metaGets++;
      const f = files.get(one);
      return f
        ? jsonRes({ id: one, name: f.name, mimeType: f.mime, trashed: !!f.trashed, parents: f.parents, appProperties: f.appProperties })
        : jsonRes({ error: 'not found' }, 404);
    }
    if (url.host === 'www.googleapis.com' && url.pathname === '/upload/drive/v3/files') {
      const meta = JSON.parse(String(init.body)) as { name: string; parents: string[]; appProperties?: Record<string, string> };
      const id = `session${++n}`;
      uploads.set(id, {
        name: meta.name,
        mime: headers.get('X-Upload-Content-Type') ?? '',
        size: Number(headers.get('X-Upload-Content-Length')),
        parents: meta.parents,
        appProperties: meta.appProperties,
        data: new Uint8Array(Number(headers.get('X-Upload-Content-Length'))),
        got: 0,
      });
      return new Response(null, { status: 200, headers: { Location: `https://www.googleapis.com/session/${id}` } });
    }
    const session = /^\/session\/(.+)$/.exec(url.pathname)?.[1];
    if (session) {
      const up = uploads.get(session);
      if (!up) return jsonRes({ error: 'gone' }, 404);
      const cr = headers.get('Content-Range') ?? '';
      const part = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(cr);
      if (part) {
        const body = new Uint8Array(init.body as ArrayBuffer);
        up.data.set(body, Number(part[1]));
        up.got = Math.max(up.got, Number(part[2]) + 1);
      }
      if (up.got >= up.size) {
        const id = `file${++n}xxxxxxxxxx`;
        files.set(id, { name: up.name, mime: up.mime, data: up.data, parents: up.parents, appProperties: up.appProperties });
        return jsonRes({ id, name: up.name, mimeType: up.mime, size: String(up.size) }, 200);
      }
      return new Response(null, { status: 308, headers: up.got > 0 ? { Range: `bytes=0-${up.got - 1}` } : {} });
    }
    return jsonRes({ error: `unexpected ${url.href}` }, 500);
  }) as typeof fetch;

  return {
    http,
    files,
    base,
    calls,
    breakRefresh: () => (refreshValid = false),
    refreshes: () => tokenRefreshes,
    refreshScopes: () => refreshScopes,
    failLinks: (times: number) => (linkFailures = times),
    /** La base todavía sin la migración de la papelera de archivos. */
    noTrashYet: () => (trashReady = false),
    grantOnly: (scope: string) => (grantedScope = scope),
    folders: () => [...files.entries()].filter(([, f]) => f.mime === 'application/vnd.google-apps.folder'),
    /** Cuántas veces se le pidió a Drive el contenido de un archivo. */
    mediaCalls: () => mediaGets,
    /** Cuántas veces se le preguntó a Drive por los datos de un archivo o carpeta. */
    metaCalls: () => metaGets,
  };
}

function call(p: Portero, path: string, init: RequestInit & { jwt?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Origin', APP);
  if (init.jwt) headers.set('Authorization', `Bearer ${init.jwt}`);
  return p.handle(new Request(`${SELF}${path}`, { ...init, headers }));
}

async function connect(p: Portero): Promise<void> {
  const res = await call(p, '/drive/connect', { method: 'POST', jwt: 'owner-jwt' });
  const { url } = (await res.json()) as { url: string };
  const state = new URL(url).searchParams.get('state');
  const back = await p.handle(new Request(`${SELF}/drive/callback?code=abc&state=${state}`));
  expect(back.status).toBe(302);
  expect(back.headers.get('Location')).toBe(`${APP}/media-test?drive=connected`);
}

describe('portero', () => {
  it('conecta el Drive del dueño y dice el estado', async () => {
    const world = fakeWorld();
    const store = memoryStore();
    const p = new Portero(env, store, world.http);

    const before = (await (await call(p, '/drive/status', { jwt: 'owner-jwt' })).json()) as { connected: boolean };
    expect(before.connected).toBe(false);

    const res = await call(p, '/drive/connect', { method: 'POST', jwt: 'owner-jwt' });
    const { url } = (await res.json()) as { url: string };
    const auth = new URL(url);
    expect(auth.searchParams.get('scope')).toContain('auth/drive.file');
    expect(auth.searchParams.get('redirect_uri')).toBe(`${SELF}/drive/callback`);
    expect(auth.searchParams.get('access_type')).toBe('offline');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(APP);

    await p.handle(new Request(`${SELF}/drive/callback?code=abc&state=${auth.searchParams.get('state')}`));
    const after = (await (await call(p, '/drive/status', { jwt: 'owner-jwt' })).json()) as { connected: boolean; email: string };
    expect(after).toMatchObject({ connected: true, email: 'lega@example.com' });

    // El estado de un pedido de conexión se usa una sola vez.
    const again = await p.handle(new Request(`${SELF}/drive/callback?code=abc&state=${auth.searchParams.get('state')}`));
    expect(again.status).toBe(400);
  });

  it('solo el dueño conecta, sube y pide pases; sin sesión, nada', async () => {
    const p = new Portero(env, memoryStore(), fakeWorld().http);
    expect((await call(p, '/drive/connect', { method: 'POST', jwt: 'member-jwt' })).status).toBe(403);
    expect((await call(p, '/upload', { method: 'POST', jwt: 'member-jwt', body: '{}' })).status).toBe(403);
    expect((await call(p, '/drive/status')).status).toBe(401);
    expect((await call(p, '/drive/status', { jwt: 'expired' })).status).toBe(401);
    const status = (await (await call(p, '/drive/status', { jwt: 'member-jwt' })).json()) as { email: unknown };
    expect(status.email).toBeNull();
  });

  it('un origen que no es la app no recibe permisos de CORS ni puede conectar', async () => {
    const p = new Portero(env, memoryStore(), fakeWorld().http);
    const res = await p.handle(
      new Request(`${SELF}/drive/connect`, { method: 'POST', headers: { Origin: 'https://evil.example', Authorization: 'Bearer owner-jwt' } }),
    );
    expect(res.status).toBe(403);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('sube por partes, retoma preguntando cuánto llegó y reproduce con Range', async () => {
    const world = fakeWorld();
    const p = new Portero(env, memoryStore(), world.http);
    await connect(p);

    const data = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);
    const start = await call(p, '/upload', {
      method: 'POST',
      jwt: 'owner-jwt',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'IMG_0001.MOV', mime: 'video/quicktime', size: data.length }),
    });
    const { uploadId } = (await start.json()) as { uploadId: string };

    const part = (from: number, to: number) =>
      call(p, `/upload/${uploadId}`, {
        method: 'PUT',
        jwt: 'owner-jwt',
        headers: { 'Content-Range': `bytes ${from}-${to}/${data.length}` },
        body: data.slice(from, to + 1),
      });
    expect(await (await part(0, 399)).json()).toEqual({ status: 'incomplete', received: 400 });
    const asked = await call(p, `/upload/${uploadId}`, {
      method: 'PUT',
      jwt: 'owner-jwt',
      headers: { 'Content-Range': `bytes */${data.length}` },
    });
    expect(await asked.json()).toEqual({ status: 'incomplete', received: 400 });
    const done = (await (await part(400, 999)).json()) as { status: string; file: { id: string; size: number } };
    expect(done.status).toBe('done');
    expect(done.file.size).toBe(1000);
    const saved = world.files.get(done.file.id)!;
    expect(saved.data).toEqual(data);
    // Adentro de "Media_Test", adentro de "LGA_ShotDocs": sin espacios.
    const folder = world.files.get(saved.parents[0])!;
    expect(folder.name).toBe('Media_Test');
    expect(world.files.get(folder.parents[0])!.name).toBe('LGA_ShotDocs');

    // Si la respuesta de la última parte se perdió, preguntar devuelve el archivo en vez de empezar de nuevo.
    const again = await call(p, `/upload/${uploadId}`, {
      method: 'PUT',
      jwt: 'owner-jwt',
      headers: { 'Content-Range': `bytes */${data.length}` },
    });
    expect(await again.json()).toEqual({ status: 'done', file: done.file });

    const pass = await call(p, '/pass', {
      method: 'POST',
      jwt: 'owner-jwt',
      body: JSON.stringify({ fileId: done.file.id, type: 'video/mp4' }),
    });
    const { url } = (await pass.json()) as { url: string };
    const media = await p.handle(new Request(url, { headers: { Range: 'bytes=10-19' } }));
    expect(media.status).toBe(206);
    expect(media.headers.get('Content-Range')).toBe('bytes 10-19/1000');
    expect(media.headers.get('Content-Type')).toBe('video/mp4');
    expect(new Uint8Array(await media.arrayBuffer())).toEqual(data.slice(10, 20));

    // Un pase tocado no sirve.
    const tampered = url.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    expect((await p.handle(new Request(tampered))).status).toBe(403);
  });

  it('una parte que no coincide con la subida se rechaza', async () => {
    const p = new Portero(env, memoryStore(), fakeWorld().http);
    await connect(p);
    const start = await call(p, '/upload', {
      method: 'POST',
      jwt: 'owner-jwt',
      body: JSON.stringify({ name: 'a.jpg', mime: 'image/jpeg', size: 100 }),
    });
    const { uploadId } = (await start.json()) as { uploadId: string };
    const bad = await call(p, `/upload/${uploadId}`, {
      method: 'PUT',
      jwt: 'owner-jwt',
      headers: { 'Content-Range': 'bytes 0-49/100' },
      body: new Uint8Array(10),
    });
    expect(bad.status).toBe(400);
    expect((await call(p, '/upload/no-existe', { method: 'PUT', jwt: 'owner-jwt', headers: { 'Content-Range': 'bytes */100' } })).status).toBe(404);
  });

  it('si el dueño destilda el permiso de Drive, no queda conectado', async () => {
    const world = fakeWorld();
    const p = new Portero(env, memoryStore(), world.http);
    world.grantOnly('https://www.googleapis.com/auth/userinfo.email openid');
    const res = await call(p, '/drive/connect', { method: 'POST', jwt: 'owner-jwt' });
    const state = new URL(((await res.json()) as { url: string }).url).searchParams.get('state');
    const back = await p.handle(new Request(`${SELF}/drive/callback?code=abc&state=${state}`));
    expect(back.headers.get('Location')).toBe(`${APP}/media-test?drive=drive-permission-missing`);
    const status = (await (await call(p, '/drive/status', { jwt: 'owner-jwt' })).json()) as { connected: boolean };
    expect(status.connected).toBe(false);
  });

  it('renombra las carpetas que conservan el nombre viejo con espacios, y respeta un nombre puesto a mano', async () => {
    const world = fakeWorld();
    const store = memoryStore();
    const p = new Portero(env, store, world.http);
    await connect(p);
    world.files.set('oldrootxxxxxxxx', { name: 'LGA Shot Docs', mime: 'application/vnd.google-apps.folder', data: new Uint8Array(), parents: [] });
    world.files.set('oldtestxxxxxxxx', { name: 'Media test', mime: 'application/vnd.google-apps.folder', data: new Uint8Array(), parents: ['oldrootxxxxxxxx'] });
    const google = store.data.get('google') as object;
    store.data.set('google', { ...google, rootFolder: 'oldrootxxxxxxxx', testFolder: 'oldtestxxxxxxxx' });
    const upload = () =>
      call(p, '/upload', {
        method: 'POST',
        jwt: 'owner-jwt',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'IMG_0002.MOV', mime: 'video/quicktime', size: 10 }),
      });
    const folders = () => [...world.files.values()].filter((f) => f.mime === 'application/vnd.google-apps.folder').length;

    expect((await upload()).status).toBe(200);
    expect(world.files.get('oldrootxxxxxxxx')!.name).toBe('LGA_ShotDocs');
    expect(world.files.get('oldtestxxxxxxxx')!.name).toBe('Media_Test');
    expect(folders()).toBe(2);

    // Un nombre puesto a mano no se toca, y sigue usando las mismas carpetas (no crea otras).
    world.files.get('oldtestxxxxxxxx')!.name = 'Mis pruebas';
    expect((await upload()).status).toBe(200);
    expect(world.files.get('oldtestxxxxxxxx')!.name).toBe('Mis pruebas');
    expect(folders()).toBe(2);
    expect(store.data.get('google')).toMatchObject({ rootFolder: 'oldrootxxxxxxxx', testFolder: 'oldtestxxxxxxxx' });
  });

  it('si Drive falla al revisar una carpeta, no crea otra', async () => {
    const world = fakeWorld();
    const store = memoryStore();
    const p = new Portero(env, store, world.http);
    await connect(p);
    world.files.set('oldrootxxxxxxxx', { name: 'LGA_ShotDocs', mime: 'application/vnd.google-apps.folder', data: new Uint8Array(), parents: [] });
    const google = store.data.get('google') as object;
    store.data.set('google', { ...google, rootFolder: 'oldrootxxxxxxxx' });
    const flaky: typeof fetch = (input, init) =>
      String(input).includes('/files/oldrootxxxxxxxx') ? Promise.resolve(new Response('{}', { status: 503 })) : world.http(input, init);
    const q = new Portero(env, store, flaky);

    const start = await call(q, '/upload', {
      method: 'POST',
      jwt: 'owner-jwt',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'IMG_0003.MOV', mime: 'video/quicktime', size: 10 }),
    });
    expect(start.status).toBe(502);
    expect([...world.files.values()].filter((f) => f.mime === 'application/vnd.google-apps.folder')).toHaveLength(1);
    expect(store.data.get('google')).toMatchObject({ rootFolder: 'oldrootxxxxxxxx' });
  });

  it('no le pide a Google un token nuevo en cada pedido (cada pedido es un Portero nuevo)', async () => {
    const world = fakeWorld();
    const store = memoryStore();
    await connect(new Portero(env, store, world.http));
    for (let i = 0; i < 3; i++) {
      const p = new Portero(env, store, world.http);
      const res = await call(p, '/upload', { method: 'POST', jwt: 'owner-jwt', body: JSON.stringify({ name: 'a', size: 1 }) });
      expect(res.status).toBe(200);
    }
    expect(world.refreshes()).toBe(0);
  });

  it('si Google revoca la conexión, avisa que hay que volver a conectar', async () => {
    const world = fakeWorld();
    const store = memoryStore();
    await connect(new Portero(env, store, world.http));
    world.breakRefresh();
    store.data.delete('accessToken'); // el token vigente venció: hay que renovarlo con la conexión guardada
    const p = new Portero(env, store, world.http);
    const res = await call(p, '/upload', { method: 'POST', jwt: 'owner-jwt', body: JSON.stringify({ name: 'a', size: 1 }) });
    expect(res.status).toBe(409);
    const status = (await (await call(p, '/drive/status', { jwt: 'owner-jwt' })).json()) as { connected: boolean; broken: string };
    expect(status.connected).toBe(false);
    expect(status.broken).toMatch(/connect it again/);
  });

  it('llama a fetch como función global (Workers corta un fetch con otro this: "Illegal invocation")', async () => {
    const world = fakeWorld();
    const real = globalThis.fetch;
    globalThis.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      return world.http(input, init);
    } as typeof fetch;
    try {
      const res = await call(new Portero(env, memoryStore()), '/drive/status', { jwt: 'owner-jwt' });
      expect(res.status).toBe(200);
    } finally {
      globalThis.fetch = real;
    }
  });
});

// --- archivos de la app (pasos 6 y 8) -----------------------------------------------------------------

const FILE_A = '11111111-2222-4333-8444-555555555555';
const FILE_B = '22222222-3333-4444-8555-666666666666';
const FILE_C = '33333333-4444-4555-8666-777777777777';

type World = ReturnType<typeof fakeWorld>;

function addBaseFile(world: World, id: string, over: Partial<BaseFile> = {}): BaseFile {
  const f: BaseFile = {
    project_id: 'p-1',
    project_name: 'Spot Coca-Cola / 2026',
    name: 'IMG_0100.MOV',
    mime: 'video/quicktime',
    size: 1000,
    drive_id: null,
    levels: { 'u-owner': 4, 'u-editor': 3, 'u-viewer': 1, 'u-member': 2, 'u-admin': 1 },
    ...over,
  };
  world.base.set(id, f);
  return f;
}

/** Compara bytes sin el diff de vitest, que con megas tarda segundos. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.length), Buffer.from(b.buffer, b.byteOffset, b.length)) === 0;
}

function bytes(length: number): Uint8Array<ArrayBuffer> {
  return Uint8Array.from({ length }, (_, i) => (i * 7 + (i >> 8)) % 256);
}

function startFile(p: Portero, jwt: string, body: Record<string, unknown>): Promise<Response> {
  return call(p, '/upload', { method: 'POST', jwt, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

/** Sube un archivo de la app entero (una sola parte) y devuelve la última respuesta del portero. */
async function uploadFile(p: Portero, jwt: string, file: string, data: Uint8Array<ArrayBuffer>, day = '2026-09-30'): Promise<Record<string, unknown>> {
  const res = await startFile(p, jwt, { file, name: 'IMG_0100.MOV', mime: 'video/quicktime', size: data.length, day });
  const started = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(started)}`);
  if (started.status === 'done') return started;
  const part = await call(p, `/upload/${started.uploadId as string}`, {
    method: 'PUT',
    jwt,
    headers: { 'Content-Range': `bytes 0-${data.length - 1}/${data.length}` },
    body: data,
  });
  return (await part.json()) as Record<string, unknown>;
}

async function filePass(p: Portero, jwt: string, file: string): Promise<Response> {
  return call(p, '/pass', { method: 'POST', jwt, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file }) });
}

/** La cadena de carpetas de un archivo en Drive, desde la raíz. */
function pathOf(world: World, id: string): string[] {
  const out: string[] = [];
  let parent = world.files.get(id)?.parents[0];
  while (parent && parent !== 'root') {
    const f = world.files.get(parent);
    if (!f) break;
    out.unshift(f.name);
    parent = f.parents[0];
  }
  return out;
}

async function setup(): Promise<{ world: World; store: ReturnType<typeof memoryStore>; p: Portero }> {
  const world = fakeWorld();
  const store = memoryStore();
  const p = new Portero(env, store, world.http);
  await connect(p);
  return { world, store, p };
}

describe('folderName', () => {
  it('guiones bajos en vez de espacios y sin caracteres raros; conserva acentos', () => {
    expect(folderName('Spot Coca-Cola / 2026')).toBe('Spot_Coca-Cola_2026');
    expect(folderName('  Café   Martínez: rodaje \\ día 1 ')).toBe('Café_Martínez_rodaje_día_1');
    expect(folderName('MGTZD')).toBe('MGTZD');
    expect(folderName('Video 🎬 "final" <v2>?')).toBe('Video_final_v2');
    expect(folderName('///')).toBe('Project');
    expect(folderName('x'.repeat(300))).toHaveLength(100);
  });
});

describe('portero: archivos de la app', () => {
  it('quien puede editar sube a LGA_ShotDocs/<Proyecto>/<día>, con appProperties, y la base se entera', async () => {
    const { world, p } = await setup();
    addBaseFile(world, FILE_A);
    const data = bytes(1000);
    // Lo sube alguien que no es el dueño pero puede editar la página (nivel 3).
    const done = (await uploadFile(p, 'editor-jwt', FILE_A, data)) as { status: string; file: { id: string; size: number }; linked: boolean };
    expect(done.status).toBe('done');
    expect(done.linked).toBe(true);
    const saved = world.files.get(done.file.id)!;
    expect(saved.data).toEqual(data);
    expect(saved.appProperties).toEqual({ sdFile: FILE_A });
    expect(saved.mime).toBe('video/quicktime');
    expect(pathOf(world, done.file.id)).toEqual(['LGA_ShotDocs', 'Spot_Coca-Cola_2026', '2026-09-30']);
    expect(world.base.get(FILE_A)!.drive_id).toBe(done.file.id);
    expect(world.calls).toContain('POST ws.example/rest/v1/rpc/set_file_drive');

    // Otro archivo del mismo proyecto y día: reusa las carpetas.
    const folders = world.folders().length;
    addBaseFile(world, FILE_B, { size: 10 });
    const second = (await uploadFile(p, 'owner-jwt', FILE_B, bytes(10))) as { file: { id: string } };
    expect(world.folders()).toHaveLength(folders);
    expect(world.files.get(second.file.id)!.parents).toEqual(saved.parents);

    // Otro día: solo una carpeta nueva, adentro de la del proyecto.
    addBaseFile(world, FILE_C, { size: 10 });
    const third = (await uploadFile(p, 'owner-jwt', FILE_C, bytes(10), '2026-10-01')) as { file: { id: string } };
    expect(world.folders()).toHaveLength(folders + 1);
    expect(pathOf(world, third.file.id)).toEqual(['LGA_ShotDocs', 'Spot_Coca-Cola_2026', '2026-10-01']);
    const project = world.files.get(world.files.get(saved.parents[0])!.parents[0])!;
    expect(project.appProperties).toEqual({ sdProject: 'p-1' });
  });

  it('permisos por archivo: subir pide nivel 3, ver pide nivel 1; sin nivel, nada', async () => {
    const { world, p } = await setup();
    addBaseFile(world, FILE_A);
    const body = { file: FILE_A, name: 'a.mov', mime: 'video/quicktime', size: 1000, day: '2026-09-30' };
    expect((await startFile(p, 'viewer-jwt', body)).status).toBe(403);
    expect((await startFile(p, 'member-jwt', body)).status).toBe(403); // comentar (2) no alcanza
    expect((await startFile(p, 'stranger-jwt', body)).status).toBe(404);
    expect((await startFile(p, 'editor-jwt', { ...body, file: 'no-es-un-uuid' })).status).toBe(400);
    expect((await startFile(p, 'editor-jwt', { ...body, day: '30/09/2026' })).status).toBe(400);
    expect((await startFile(p, 'editor-jwt', { ...body, size: 999 })).status).toBe(400);
    expect((await call(p, '/upload', { method: 'POST', body: JSON.stringify(body) })).status).toBe(401);
    expect(world.folders()).toHaveLength(0);

    // Todavía no está en Drive: no hay pase.
    expect((await filePass(p, 'viewer-jwt', FILE_A)).status).toBe(409);
    await uploadFile(p, 'editor-jwt', FILE_A, bytes(1000));
    expect((await filePass(p, 'viewer-jwt', FILE_A)).status).toBe(200);
    expect((await filePass(p, 'stranger-jwt', FILE_A)).status).toBe(404);
    expect((await filePass(p, 'stranger-jwt', FILE_B)).status).toBe(404);

    // Lo de la prueba de media sigue siendo solo del dueño.
    const driveId = world.base.get(FILE_A)!.drive_id!;
    const legacy = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: driveId }) };
    expect((await call(p, '/pass', { ...legacy, jwt: 'editor-jwt' })).status).toBe(403);
    expect((await call(p, '/pass', { ...legacy, jwt: 'owner-jwt' })).status).toBe(200);
    expect((await call(p, '/upload', { method: 'POST', jwt: 'editor-jwt', body: JSON.stringify({ name: 'a', size: 1 }) })).status).toBe(403);
    // Conectar y elegir carpeta, solo el dueño.
    expect((await call(p, '/drive/connect', { method: 'POST', jwt: 'editor-jwt', body: '{}' })).status).toBe(403);
    expect((await call(p, '/drive/folder', { method: 'POST', jwt: 'editor-jwt', body: '{"parentId":null}' })).status).toBe(403);
    expect((await call(p, '/drive/picker', { method: 'POST', jwt: 'editor-jwt', body: '{}' })).status).toBe(403);
  });

  it('una subida con file solo la sigue quien la empezó', async () => {
    const { world, p } = await setup();
    addBaseFile(world, FILE_A);
    const res = await startFile(p, 'editor-jwt', { file: FILE_A, size: 1000, day: '2026-09-30' });
    const { uploadId } = (await res.json()) as { uploadId: string };
    const ask = (jwt: string) => call(p, `/upload/${uploadId}`, { method: 'PUT', jwt, headers: { 'Content-Range': 'bytes */1000' } });
    expect((await ask('owner-jwt')).status).toBe(404);
    expect(await (await ask('editor-jwt')).json()).toEqual({ status: 'incomplete', received: 0 });
  });

  it('si el archivo ya está en Drive según la base, comprueba la marca y responde done (linked) sin subir de nuevo', async () => {
    const { world, p } = await setup();
    world.files.set('yaSubidoxxxxxxxx', { name: 'X.MOV', mime: 'video/quicktime', data: bytes(10), parents: [], appProperties: { sdFile: FILE_A } });
    addBaseFile(world, FILE_A, { drive_id: 'yaSubidoxxxxxxxx', size: 1234, name: 'X.MOV' });
    const start = () => startFile(p, 'editor-jwt', { file: FILE_A, name: 'X.MOV', mime: 'video/quicktime', size: 1234, day: '2026-09-30' });
    const before = world.metaCalls();
    expect(await (await start()).json()).toEqual({
      status: 'done',
      file: { id: 'yaSubidoxxxxxxxx', name: 'X.MOV', mimeType: 'video/quicktime', size: 1234 },
      linked: true,
    });
    await start(); // la segunda vez ya está comprobado: no le pregunta a Drive
    expect(world.metaCalls()).toBe(before + 1);
    expect(world.calls.filter((c) => c.includes('/upload/drive'))).toHaveLength(0);
  });

  it('si la base apunta a un archivo de Drive sin la marca de este archivo (o que no existe), 409 y no sube', async () => {
    const { world, p } = await setup();
    world.files.set('deOtroxxxxxxxxxx', { name: 'Y.MOV', mime: 'video/quicktime', data: bytes(10), parents: [], appProperties: { sdFile: FILE_B } });
    addBaseFile(world, FILE_A, { drive_id: 'deOtroxxxxxxxxxx', size: 10 });
    const start = () => startFile(p, 'editor-jwt', { file: FILE_A, size: 10, day: '2026-09-30' });
    const res = await start();
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('This file is registered with a different Drive file: ask the workspace owner.');
    // El archivo de Drive ya no existe: el mismo 409, con su propio mensaje.
    world.base.get(FILE_A)!.drive_id = 'noExistexxxxxxxx';
    const gone = await start();
    expect(gone.status).toBe(409);
    expect(((await gone.json()) as { error: string }).error).toBe('The Drive file for this upload is gone: ask the workspace owner.');
    expect(world.calls.filter((c) => c.includes('/upload/drive'))).toHaveLength(0);
  });

  it('si avisarle a la base falla por la red, done llega igual y se reintenta cuando la app pregunta', async () => {
    const { world, p } = await setup();
    addBaseFile(world, FILE_A);
    world.failLinks(1);
    const data = bytes(1000);
    const res = await startFile(p, 'editor-jwt', { file: FILE_A, size: data.length, day: '2026-09-30' });
    const { uploadId } = (await res.json()) as { uploadId: string };
    const put = (range: string, body?: Uint8Array<ArrayBuffer>) =>
      call(p, `/upload/${uploadId}`, { method: 'PUT', jwt: 'editor-jwt', headers: { 'Content-Range': range }, body });
    const done = (await (await put('bytes 0-999/1000', data)).json()) as { status: string; file: { id: string }; linked: boolean };
    expect(done).toMatchObject({ status: 'done', linked: false });
    expect(world.base.get(FILE_A)!.drive_id).toBeNull();

    // La app pregunta cuánto llegó: el portero vuelve a avisarle a la base.
    const again = (await (await put('bytes */1000')).json()) as { linked: boolean; file: { id: string } };
    expect(again).toMatchObject({ status: 'done', linked: true, file: done.file });
    expect(world.base.get(FILE_A)!.drive_id).toBe(done.file.id);
    const links = world.calls.filter((c) => c.endsWith('set_file_drive')).length;
    await put('bytes */1000');
    expect(world.calls.filter((c) => c.endsWith('set_file_drive'))).toHaveLength(links);
  });

  it('si la app pierde la subida y la vuelve a pedir, no sube dos veces: avisa a la base y responde done', async () => {
    const { world, p } = await setup();
    addBaseFile(world, FILE_A);
    world.failLinks(1);
    const first = (await uploadFile(p, 'editor-jwt', FILE_A, bytes(1000))) as { file: { id: string }; linked: boolean };
    expect(first.linked).toBe(false);
    const uploadsBefore = world.calls.filter((c) => c.includes('/upload/drive')).length;
    const res = await startFile(p, 'editor-jwt', { file: FILE_A, size: 1000, day: '2026-09-30' });
    expect(await res.json()).toMatchObject({ status: 'done', linked: true, file: first.file });
    expect(world.calls.filter((c) => c.includes('/upload/drive'))).toHaveLength(uploadsBefore);
    expect(world.base.get(FILE_A)!.drive_id).toBe(first.file.id);
  });

  it('un pase sirve el archivo aunque la base todavía no sepa su id de Drive', async () => {
    const { world, p } = await setup();
    addBaseFile(world, FILE_A);
    world.failLinks(1); // al subir
    const data = bytes(1000);
    await uploadFile(p, 'editor-jwt', FILE_A, data);
    const res = await filePass(p, 'viewer-jwt', FILE_A); // el que mira no puede avisarle a la base (nivel 1)
    expect(res.status).toBe(200);
    const media = await p.handle(new Request(((await res.json()) as { url: string }).url));
    expect(new Uint8Array(await media.arrayBuffer())).toEqual(data);
    expect(world.base.get(FILE_A)!.drive_id).toBeNull();
    // Quien puede editar, al pedir un pase, termina de avisarle.
    await filePass(p, 'editor-jwt', FILE_A);
    expect(world.base.get(FILE_A)!.drive_id).not.toBeNull();
  });

  it('otro dispositivo ya lo subió (file_already_uploaded): la copia de más queda, sin error', async () => {
    const { world, store, p } = await setup();
    addBaseFile(world, FILE_A, { size: 10 });
    const res = await startFile(p, 'editor-jwt', { file: FILE_A, size: 10, day: '2026-09-30' });
    const { uploadId } = (await res.json()) as { uploadId: string };
    world.base.get(FILE_A)!.drive_id = 'delOtroxxxxxxxxx';
    const part = await call(p, `/upload/${uploadId}`, { method: 'PUT', jwt: 'editor-jwt', headers: { 'Content-Range': 'bytes 0-9/10' }, body: bytes(10) });
    expect(await part.json()).toMatchObject({ status: 'done', linked: true });
    expect(world.base.get(FILE_A)!.drive_id).toBe('delOtroxxxxxxxxx');
    expect(store.data.get(`file:${FILE_A}`)).toMatchObject({ linked: true });
  });

  it('el pase con file comprueba appProperties.sdFile una vez; si no coincide, lo rechaza', async () => {
    const { world, p } = await setup();
    // Alguien apuntó el archivo de la base a otro archivo del Drive del dueño.
    world.files.set('otroArchivoxxxxx', { name: 'contrato.pdf', mime: 'application/pdf', data: bytes(10), parents: [], appProperties: { sdFile: FILE_B } });
    world.files.set('sinPropsxxxxxxxx', { name: 'x.pdf', mime: 'application/pdf', data: bytes(10), parents: [] });
    addBaseFile(world, FILE_A, { drive_id: 'otroArchivoxxxxx' });
    expect((await filePass(p, 'viewer-jwt', FILE_A)).status).toBe(403);
    world.base.get(FILE_A)!.drive_id = 'sinPropsxxxxxxxx';
    expect((await filePass(p, 'viewer-jwt', FILE_A)).status).toBe(403);
    world.base.get(FILE_A)!.drive_id = 'noExistexxxxxxxx';
    expect((await filePass(p, 'viewer-jwt', FILE_A)).status).toBe(404);

    // El bueno: se comprueba la primera vez y después queda anotado.
    world.files.set('elBuenoxxxxxxxxx', { name: 'a.mov', mime: 'video/quicktime', data: bytes(10), parents: [], appProperties: { sdFile: FILE_A } });
    world.base.get(FILE_A)!.drive_id = 'elBuenoxxxxxxxxx';
    const before = world.metaCalls();
    const res = await filePass(p, 'viewer-jwt', FILE_A);
    expect(res.status).toBe(200);
    expect(world.metaCalls()).toBe(before + 1);
    await filePass(p, 'viewer-jwt', FILE_A);
    expect(world.metaCalls()).toBe(before + 1);
    // Sirve con el tipo de files.mime, aunque la app pida otro.
    const media = await p.handle(new Request(((await res.json()) as { url: string }).url, { headers: { Range: 'bytes=0-3' } }));
    expect(media.headers.get('Content-Type')).toBe('video/quicktime');
    const typed = await call(p, '/pass', { method: 'POST', jwt: 'viewer-jwt', body: JSON.stringify({ file: FILE_A, type: 'text/html' }) });
    const other = await p.handle(new Request(((await typed.json()) as { url: string }).url, { headers: { Range: 'bytes=0-3' } }));
    expect(other.headers.get('Content-Type')).toBe('video/quicktime');
  });

  it('renombrar el proyecto renombra su carpeta, salvo que el dueño le haya puesto otro nombre a mano', async () => {
    const { world, p } = await setup();
    addBaseFile(world, FILE_A, { project_name: 'Rodaje uno', size: 10 });
    const first = (await uploadFile(p, 'editor-jwt', FILE_A, bytes(10))) as { file: { id: string } };
    const projectId = world.files.get(world.files.get(first.file.id)!.parents[0])!.parents[0];
    expect(world.files.get(projectId)!.name).toBe('Rodaje_uno');

    addBaseFile(world, FILE_B, { project_name: 'Rodaje dos: final', size: 10 });
    const second = (await uploadFile(p, 'editor-jwt', FILE_B, bytes(10))) as { file: { id: string } };
    expect(world.files.get(projectId)!.name).toBe('Rodaje_dos_final');
    expect(pathOf(world, second.file.id)).toEqual(['LGA_ShotDocs', 'Rodaje_dos_final', '2026-09-30']);

    // El dueño la renombra a mano: la app ya no la toca, y sigue subiendo ahí.
    world.files.get(projectId)!.name = 'Cliente X - rodaje';
    addBaseFile(world, FILE_C, { project_name: 'Rodaje tres', size: 10 });
    const third = (await uploadFile(p, 'editor-jwt', FILE_C, bytes(10))) as { file: { id: string } };
    expect(world.files.get(projectId)!.name).toBe('Cliente X - rodaje');
    expect(pathOf(world, third.file.id)).toEqual(['LGA_ShotDocs', 'Cliente X - rodaje', '2026-09-30']);
  });

  it('una carpeta del día que se mandó a la papelera se vuelve a crear; nada se borra', async () => {
    const { world, p } = await setup();
    addBaseFile(world, FILE_A, { size: 10 });
    const first = (await uploadFile(p, 'editor-jwt', FILE_A, bytes(10))) as { file: { id: string } };
    const day = world.files.get(first.file.id)!.parents[0];
    world.files.get(day)!.trashed = true;
    addBaseFile(world, FILE_B, { size: 10 });
    const second = (await uploadFile(p, 'editor-jwt', FILE_B, bytes(10))) as { file: { id: string } };
    expect(world.files.get(second.file.id)!.parents[0]).not.toBe(day);
    expect(world.files.has(day)).toBe(true);
    expect(pathOf(world, second.file.id)).toEqual(['LGA_ShotDocs', 'Spot_Coca-Cola_2026', '2026-09-30']);
  });

  it('dos subidas a la vez a un proyecto y un día nuevos crean una sola carpeta de cada una', async () => {
    const { world, p } = await setup();
    addBaseFile(world, FILE_A);
    addBaseFile(world, FILE_B);
    addBaseFile(world, FILE_C);
    const results = await Promise.all(
      [FILE_A, FILE_B, FILE_C].map((f) => startFile(p, 'editor-jwt', { file: f, size: 1000, day: '2026-09-30' })),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(world.folders().map(([, f]) => f.name).sort()).toEqual(['2026-09-30', 'LGA_ShotDocs', 'Spot_Coca-Cola_2026']);
  });
});

// --- papelera de archivos (paso 11) --------------------------------------------------------------------

function trash(p: Portero, jwt: string | undefined, file: string): Promise<Response> {
  return call(p, '/trash', { method: 'POST', jwt, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file }) });
}

/** Un archivo subido de verdad al Drive de mentira y que ya está en la papelera de la app. */
async function trashedFile(world: World, p: Portero, id: string): Promise<string> {
  addBaseFile(world, id, { size: 10 });
  await uploadFile(p, 'editor-jwt', id, bytes(10));
  world.base.get(id)!.trashed_at = '2026-09-30T12:00:00Z';
  return world.base.get(id)!.drive_id!;
}

describe('portero: papelera de archivos', () => {
  it('manda el archivo a la papelera de Drive (nunca lo borra), después de que la base lo marca, y lo confirma', async () => {
    const { world, p } = await setup();
    const driveId = await trashedFile(world, p, FILE_A);
    const before = world.calls.length;

    const res = await trash(p, 'owner-jwt', FILE_A);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'done', file: FILE_A, drive: 'trashed' });
    // Sigue en Drive, en su papelera.
    expect(world.files.get(driveId)).toMatchObject({ trashed: true });
    expect(world.files.get(driveId)!.data).toEqual(bytes(10));
    expect(world.base.get(FILE_A)).toMatchObject({ purged_at: expect.any(String), drive_trashed_at: expect.any(String) });

    // El orden, con la sesión de la persona: media_file, la marca en Drive, purge_file (la base marca),
    // media_file de nuevo (confirma el estado), recién ahí Drive, y al final la confirmación. Nunca un DELETE.
    const calls = world.calls.slice(before).filter((c) => c.includes('/rpc/') || c.startsWith('PATCH') || c.startsWith('DELETE'));
    expect(calls).toEqual([
      'POST ws.example/rest/v1/rpc/media_whoami',
      'POST ws.example/rest/v1/rpc/media_file',
      'POST ws.example/rest/v1/rpc/purge_file',
      'POST ws.example/rest/v1/rpc/media_file',
      `PATCH www.googleapis.com/drive/v3/files/${driveId}`,
      'POST ws.example/rest/v1/rpc/media_purged',
    ]);
    expect(world.calls.some((c) => c.startsWith('DELETE'))).toBe(false);

    // Pedirlo de nuevo: listo, sin volver a ir a Drive.
    const patches = world.calls.filter((c) => c.startsWith('PATCH')).length;
    const again = await trash(p, 'owner-jwt', FILE_A);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ status: 'done', file: FILE_A });
    expect(world.calls.filter((c) => c.startsWith('PATCH'))).toHaveLength(patches);
  });

  it('solo el dueño y los admins; lo que una página usa, no; sin sesión, nada', async () => {
    const { world, p } = await setup();
    const driveId = await trashedFile(world, p, FILE_A);
    const patches = () => world.calls.filter((c) => c.startsWith('PATCH')).length;
    const before = patches();

    expect((await trash(p, 'editor-jwt', FILE_A)).status).toBe(403);
    expect((await trash(p, 'member-jwt', FILE_A)).status).toBe(403);
    expect((await trash(p, 'viewer-jwt', FILE_A)).status).toBe(403);
    const forbidden = await trash(p, 'viewer-jwt', FILE_A);
    expect(await forbidden.json()).toMatchObject({ code: 'not_allowed', error: expect.stringMatching(/owner or an admin/) });
    const hidden = await trash(p, 'stranger-jwt', FILE_A);
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toMatchObject({ code: 'not_found' });
    expect((await trash(p, undefined, FILE_A)).status).toBe(401);
    expect((await trash(p, 'expired', FILE_A)).status).toBe(401);
    expect((await trash(p, 'owner-jwt', 'no-es-un-uuid')).status).toBe(400);
    expect(patches()).toBe(before);
    expect(world.files.get(driveId)!.trashed).toBeFalsy();
    expect(world.base.get(FILE_A)!.purged_at).toBeUndefined();

    // En uso (no está en la papelera): 409 y Drive no se toca.
    addBaseFile(world, FILE_B, { size: 10 });
    await uploadFile(p, 'editor-jwt', FILE_B, bytes(10));
    const used = await trash(p, 'owner-jwt', FILE_B);
    expect(used.status).toBe(409);
    expect(await used.json()).toEqual({ error: 'A page uses this file again: it is not in the trash.', code: 'in_use' });
    expect(patches()).toBe(before);

    // Lo usa una página de un proyecto borrado (P.14): 409 con su propio código y Drive no se toca.
    world.base.get(FILE_B)!.trashed_at = '2026-10-01T10:00:00Z';
    world.base.get(FILE_B)!.in_deleted_project = true;
    const deleted = await trash(p, 'owner-jwt', FILE_B);
    expect(deleted.status).toBe(409);
    expect(await deleted.json()).toMatchObject({ code: 'in_deleted_project' });
    expect(patches()).toBe(before);
    expect(world.base.get(FILE_B)!.purged_at).toBeUndefined();

    // Una admin (no es la dueña) sí.
    const res = await trash(p, 'admin-jwt', FILE_A);
    expect(res.status).toBe(200);
    expect(world.files.get(driveId)!.trashed).toBe(true);
  });

  it('nunca manda otro archivo del Drive del dueño; si en Drive ya no está, o nunca llegó, solo lo confirma', async () => {
    const { world, p } = await setup();
    // La base apunta a un archivo de Drive que no lleva la marca de este: no se toca ni se confirma.
    world.files.set('deOtroxxxxxxxxxx', { name: 'contrato.pdf', mime: 'application/pdf', data: bytes(10), parents: [], appProperties: { sdFile: FILE_B } });
    addBaseFile(world, FILE_A, { drive_id: 'deOtroxxxxxxxxxx', trashed_at: '2026-09-30T12:00:00Z' });
    const other = await trash(p, 'owner-jwt', FILE_A);
    expect(other.status).toBe(403);
    expect(await other.json()).toMatchObject({ code: 'drive_mismatch' });
    expect(world.files.get('deOtroxxxxxxxxxx')!.trashed).toBeFalsy();
    // Se comprueba antes de pedirle nada a la base: el archivo queda en la papelera de la app como estaba.
    expect(world.calls).not.toContain('POST ws.example/rest/v1/rpc/purge_file');
    expect(world.base.get(FILE_A)!.purged_at).toBeUndefined();

    // Ya no está en Drive (el dueño lo borró a mano): se confirma, sin error.
    addBaseFile(world, FILE_B, { drive_id: 'noExistexxxxxxxx', trashed_at: '2026-09-30T12:00:00Z' });
    const missing = await trash(p, 'owner-jwt', FILE_B);
    expect(await missing.json()).toEqual({ status: 'done', file: FILE_B, drive: 'missing' });
    expect(world.base.get(FILE_B)!.drive_trashed_at).toBeTruthy();

    // Nunca terminó de subirse: no hay nada en Drive; se confirma.
    addBaseFile(world, FILE_C, { trashed_at: '2026-09-30T12:00:00Z' });
    const none = await trash(p, 'owner-jwt', FILE_C);
    expect(await none.json()).toEqual({ status: 'done', file: FILE_C, drive: 'none' });
    expect(world.calls.some((c) => c.startsWith('PATCH'))).toBe(false);
  });

  it('si la base no se enteró de la subida, usa el archivo que subió el portero (con su marca)', async () => {
    const { world, p } = await setup();
    addBaseFile(world, FILE_A, { size: 10 });
    world.failLinks(1);
    const done = (await uploadFile(p, 'editor-jwt', FILE_A, bytes(10))) as { file: { id: string }; linked: boolean };
    expect(done.linked).toBe(false);
    world.base.get(FILE_A)!.trashed_at = '2026-09-30T12:00:00Z';
    const res = await trash(p, 'owner-jwt', FILE_A);
    expect(await res.json()).toEqual({ status: 'done', file: FILE_A, drive: 'trashed' });
    expect(world.files.get(done.file.id)!.trashed).toBe(true);
  });

  it('si Drive falla, no confirma; pedirlo de nuevo termina', async () => {
    const { world, store, p } = await setup();
    const driveId = await trashedFile(world, p, FILE_A);
    let fail = true;
    const flaky: typeof fetch = (input, init) =>
      fail && init?.method === 'PATCH' ? Promise.resolve(new Response('{}', { status: 503 })) : world.http(input, init);
    const q = new Portero(env, store, flaky);
    const res = await trash(q, 'owner-jwt', FILE_A);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: 'drive_failed' });
    expect(world.base.get(FILE_A)).toMatchObject({ purged_at: expect.any(String) });
    expect(world.base.get(FILE_A)!.drive_trashed_at).toBeUndefined();
    fail = false;
    expect((await trash(q, 'owner-jwt', FILE_A)).status).toBe(200);
    expect(world.files.get(driveId)!.trashed).toBe(true);
    expect(world.base.get(FILE_A)!.drive_trashed_at).toBeTruthy();
  });

  it('con una base sin la papelera de archivos, lo dice claro y no toca Drive', async () => {
    const { world, p } = await setup();
    await trashedFile(world, p, FILE_A);
    world.noTrashYet();
    const res = await trash(p, 'owner-jwt', FILE_A);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'The workspace database is not up to date for the file trash yet.', code: 'db_outdated' });
    expect(world.calls.some((c) => c.startsWith('PATCH'))).toBe(false);
  });

  it('sin conexión con Drive (nunca conectado, o revocada): 503 drive_not_connected, sin pedirle nada a la base', async () => {
    const world = fakeWorld();
    const store = memoryStore();
    const p = new Portero(env, store, world.http);
    addBaseFile(world, FILE_A, { trashed_at: '2026-09-30T12:00:00Z' });
    const never = await trash(p, 'owner-jwt', FILE_A);
    expect(never.status).toBe(503);
    expect(await never.json()).toMatchObject({ code: 'drive_not_connected' });

    await connect(p);
    world.breakRefresh();
    store.data.delete('accessToken');
    const broken = await trash(new Portero(env, store, world.http), 'owner-jwt', FILE_A);
    expect(broken.status).toBe(503);
    expect(await broken.json()).toMatchObject({ code: 'drive_not_connected' });
    expect(world.calls).not.toContain('POST ws.example/rest/v1/rpc/purge_file');
    expect(world.base.get(FILE_A)!.purged_at).toBeUndefined();
  });

  it('si Drive falla al terminar la subida de un archivo ya mandado, pedir /trash de nuevo lo termina', async () => {
    const { world, store, p } = await setup();
    addBaseFile(world, FILE_A, { size: 10 });
    const res = await startFile(p, 'editor-jwt', { file: FILE_A, size: 10, day: '2026-09-30' });
    const { uploadId } = (await res.json()) as { uploadId: string };
    world.base.get(FILE_A)!.trashed_at = '2026-09-30T12:00:00Z';
    await trash(p, 'owner-jwt', FILE_A);
    const flaky: typeof fetch = (input, init) =>
      init?.method === 'PATCH' ? Promise.resolve(new Response('{}', { status: 503 })) : world.http(input, init);
    const q = new Portero(env, store, flaky);
    const part = await call(q, `/upload/${uploadId}`, { method: 'PUT', jwt: 'editor-jwt', headers: { 'Content-Range': 'bytes 0-9/10' }, body: bytes(10) });
    const done = (await part.json()) as { status: string; file: { id: string } };
    expect(done.status).toBe('done'); // la subida no se corta
    expect(world.files.get(done.file.id)!.trashed).toBeFalsy();
    expect(await (await trash(p, 'owner-jwt', FILE_A)).json()).toEqual({ status: 'done', file: FILE_A, drive: 'trashed' });
    expect(world.files.get(done.file.id)!.trashed).toBe(true);
  });

  it('mandado a la papelera con la subida en curso: al terminar la subida, va a la papelera de Drive', async () => {
    const { world, p } = await setup();
    addBaseFile(world, FILE_A, { size: 10 });
    const res = await startFile(p, 'editor-jwt', { file: FILE_A, size: 10, day: '2026-09-30' });
    const { uploadId } = (await res.json()) as { uploadId: string };
    world.base.get(FILE_A)!.trashed_at = '2026-09-30T12:00:00Z';
    expect(await (await trash(p, 'owner-jwt', FILE_A)).json()).toEqual({ status: 'done', file: FILE_A, drive: 'none' });

    // Termina la subida (la hace quien edita, no la dueña): el archivo nuevo va a la papelera de Drive.
    const part = await call(p, `/upload/${uploadId}`, { method: 'PUT', jwt: 'editor-jwt', headers: { 'Content-Range': 'bytes 0-9/10' }, body: bytes(10) });
    const done = (await part.json()) as { status: string; linked: boolean; file: { id: string } };
    expect(done).toMatchObject({ status: 'done', linked: true });
    expect(world.files.get(done.file.id)).toMatchObject({ trashed: true });
    expect(world.files.get(done.file.id)!.data).toEqual(bytes(10));
    expect(world.base.get(FILE_A)).toMatchObject({ drive_id: done.file.id, drive_trashed_at: expect.any(String) });
    expect(world.calls.some((c) => c.startsWith('DELETE'))).toBe(false);

    // Pedirlo de nuevo no vuelve a ir a Drive.
    const patches = world.calls.filter((c) => c.startsWith('PATCH')).length;
    expect((await trash(p, 'owner-jwt', FILE_A)).status).toBe(200);
    expect(world.calls.filter((c) => c.startsWith('PATCH'))).toHaveLength(patches);

    // Un archivo que no se mandó a la papelera no se toca al terminar su subida.
    addBaseFile(world, FILE_B, { size: 10 });
    const kept = (await uploadFile(p, 'editor-jwt', FILE_B, bytes(10))) as { file: { id: string } };
    expect(world.files.get(kept.file.id)!.trashed).toBeFalsy();
  });
});

describe('portero: dónde va la carpeta de la app', () => {
  it('status dice la carpeta elegida y si hay selector', async () => {
    const { p } = await setup();
    const status = (await (await call(p, '/drive/status', { jwt: 'owner-jwt' })).json()) as Record<string, unknown>;
    expect(status).toMatchObject({ connected: true, folder: null, picker: false });
    const withKey = new Portero({ ...env, GOOGLE_API_KEY: 'AIza-test' }, memoryStore(), fakeWorld().http);
    const member = (await (await call(withKey, '/drive/status', { jwt: 'member-jwt' })).json()) as Record<string, unknown>;
    expect(member).toMatchObject({ picker: true, folder: null, email: null, isOwner: false });
  });

  it('/drive/picker: 404 sin GOOGLE_API_KEY; con ella, clave, número del proyecto y un token solo de drive.file', async () => {
    const world = fakeWorld();
    const store = memoryStore();
    await connect(new Portero(env, store, world.http));
    expect((await call(new Portero(env, store, world.http), '/drive/picker', { method: 'POST', jwt: 'owner-jwt', body: '{}' })).status).toBe(404);

    const p = new Portero({ ...env, GOOGLE_API_KEY: 'AIza-test', GOOGLE_CLIENT_ID: '123456789012-abc.apps.googleusercontent.com' }, store, world.http);
    const res = await call(p, '/drive/picker', { method: 'POST', jwt: 'owner-jwt', body: '{}' });
    const body = (await res.json()) as { apiKey: string; appId: string; token: string };
    expect(body.apiKey).toBe('AIza-test');
    expect(body.appId).toBe('123456789012');
    expect(body.token).toMatch(/^at-/);
    expect(world.refreshScopes().at(-1)).toBe('https://www.googleapis.com/auth/drive.file');
    // No reemplaza el token que usa el portero.
    expect((store.data.get('accessToken') as { token: string }).token).toBe('at-1');
  });

  it('/drive/folder: la carpeta de la app se crea o se mueve a la elegida, y vuelve a la raíz con null', async () => {
    const { world, store, p } = await setup();
    world.files.set('elegidaxxxxxxxxx', { name: 'Trabajo', mime: 'application/vnd.google-apps.folder', data: new Uint8Array(), parents: ['root'] });
    world.files.set('unArchivoxxxxxxx', { name: 'a.pdf', mime: 'application/pdf', data: new Uint8Array(), parents: ['root'] });
    const choose = (parentId: unknown) =>
      call(p, '/drive/folder', { method: 'POST', jwt: 'owner-jwt', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parentId }) });

    // Todavía no existe LGA_ShotDocs: se guarda y se crea ahí con la primera subida.
    expect(await (await choose('elegidaxxxxxxxxx')).json()).toEqual({ folder: { id: 'elegidaxxxxxxxxx', name: 'Trabajo' } });
    addBaseFile(world, FILE_A, { size: 10 });
    const up = (await uploadFile(p, 'editor-jwt', FILE_A, bytes(10))) as { file: { id: string } };
    expect(pathOf(world, up.file.id)).toEqual(['Trabajo', 'LGA_ShotDocs', 'Spot_Coca-Cola_2026', '2026-09-30']);
    const status = (await (await call(p, '/drive/status', { jwt: 'owner-jwt' })).json()) as Record<string, unknown>;
    expect(status.folder).toEqual({ id: 'elegidaxxxxxxxxx', name: 'Trabajo' });

    // A la raíz: se mueve (con todo lo de adentro), no se crea otra.
    const folders = world.folders().length;
    expect(await (await choose(null)).json()).toEqual({ folder: null });
    const root = (store.data.get('google') as { rootFolder: string }).rootFolder;
    expect(world.files.get(root)!.parents).toEqual(['root']);
    expect(pathOf(world, up.file.id)).toEqual(['LGA_ShotDocs', 'Spot_Coca-Cola_2026', '2026-09-30']);
    expect(world.folders()).toHaveLength(folders);
    expect(store.data.has('drivePlace')).toBe(false);

    // Y de nuevo a la elegida.
    await choose('elegidaxxxxxxxxx');
    expect(world.files.get(root)!.parents).toEqual(['elegidaxxxxxxxxx']);

    expect((await choose('unArchivoxxxxxxx')).status).toBe(400);
    expect((await choose('noExistexxxxxxxx')).status).toBe(400);
    expect((await choose('')).status).toBe(400);
    expect((await choose(undefined)).status).toBe(400);
  });

  it('si la carpeta elegida ya no existe, avisa que hay que elegir otra (no la crea en otro lado)', async () => {
    const { world, store, p } = await setup();
    store.data.set('drivePlace', { id: 'borradaxxxxxxxxx', name: 'Vieja' });
    addBaseFile(world, FILE_A, { size: 10 });
    const res = await startFile(p, 'editor-jwt', { file: FILE_A, size: 10, day: '2026-09-30' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/choose another/);
    expect(world.folders()).toHaveLength(0);
  });

  it('la vuelta de Google va a la ruta que pidió la app; si no es una ruta de la app, a /media-test', async () => {
    const p = new Portero(env, memoryStore(), fakeWorld().http);
    const back = async (ret: unknown) => {
      const res = await call(p, '/drive/connect', { method: 'POST', jwt: 'owner-jwt', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ return: ret }) });
      const state = new URL(((await res.json()) as { url: string }).url).searchParams.get('state');
      return (await p.handle(new Request(`${SELF}/drive/callback?code=abc&state=${state}`))).headers.get('Location');
    };
    expect(await back('/settings/drive?tab=1')).toBe(`${APP}/settings/drive?tab=1&drive=connected`);
    expect(await back('/')).toBe(`${APP}/?drive=connected`);
    expect(await back('https://evil.example/x')).toBe(`${APP}/media-test?drive=connected`);
    expect(await back('//evil.example/x')).toBe(`${APP}/media-test?drive=connected`);
    expect(await back('/\\evil.example')).toBe(`${APP}/media-test?drive=connected`);
    expect(await back(undefined)).toBe(`${APP}/media-test?drive=connected`);
  });
});

describe('portero: caché del arranque del video', () => {
  const SIZE = 2 * 1024 * 1024 + 12345;
  const HEAD = CACHE_HEAD_PIECES * CACHE_PIECE;
  const TAIL = CACHE_TAIL_PIECES * CACHE_PIECE;

  async function videoPass(size = SIZE) {
    const { world, store, p } = await setup();
    const data = bytes(size);
    world.files.set('videoxxxxxxxxxxx', { name: 'v.mov', mime: 'video/quicktime', data, parents: [], appProperties: { sdFile: FILE_A } });
    addBaseFile(world, FILE_A, { drive_id: 'videoxxxxxxxxxxx', size, mime: 'video/quicktime' });
    const { url } = (await (await filePass(p, 'viewer-jwt', FILE_A)).json()) as { url: string };
    const get = (range?: string, method = 'GET') => p.handle(new Request(url, { method, headers: range ? { Range: range } : {} }));
    return { world, store, p, data, get };
  }

  async function expectPart(res: Response, data: Uint8Array, start: number, end: number) {
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe(`bytes ${start}-${end}/${data.length}`);
    expect(res.headers.get('Content-Length')).toBe(String(end - start + 1));
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(res.headers.get('Content-Type')).toBe('video/quicktime');
    expect(res.headers.get('Content-Security-Policy')).toBe('sandbox');
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.length).toBe(end - start + 1);
    expect(sameBytes(body, data.subarray(start, end + 1))).toBe(true);
  }

  it('guarda el principio y el final y sirve desde ahí los pedidos que caen adentro', async () => {
    const { world, store, data, get } = await videoPass();
    const drive = () => world.mediaCalls();

    // Safari pregunta por los dos primeros bytes: se trae de Drive el principio entero (una vez).
    await expectPart(await get('bytes=0-1'), data, 0, 1);
    expect(drive()).toBe(1);
    // Adentro del principio, cruzando de un trozo a otro: sin Drive.
    const hit = await get(`bytes=1000-${CACHE_PIECE + 5000}`);
    expect(hit.headers.get('X-Portero-Cache')).toBe('hit');
    await expectPart(hit, data, 1000, CACHE_PIECE + 5000);
    await expectPart(await get(`bytes=0-${HEAD - 1}`), data, 0, HEAD - 1);
    expect(drive()).toBe(1);

    // El final (el índice del video): se trae una vez y después sale de la caché, con las tres formas.
    await expectPart(await get(`bytes=${SIZE - 100}-`), data, SIZE - 100, SIZE - 1);
    expect(drive()).toBe(2);
    await expectPart(await get(`bytes=${SIZE - TAIL}-${SIZE - 1}`), data, SIZE - TAIL, SIZE - 1);
    await expectPart(await get('bytes=-5000'), data, SIZE - 5000, SIZE - 1);
    await expectPart(await get(`bytes=${SIZE - 300000}-${SIZE - 200000}`), data, SIZE - 300000, SIZE - 200000);
    await expectPart(await get(`bytes=${SIZE - 10}-${SIZE + 500}`), data, SIZE - 10, SIZE - 1); // pasa del final: se recorta
    expect(drive()).toBe(2);

    // Lo que empieza en el principio y sigue después (Chrome: `bytes=0-`): un 206 más corto, hasta donde
    // llega lo guardado; el navegador pide lo que sigue.
    const chrome = await get('bytes=0-');
    expect(chrome.headers.get('X-Portero-Cache')).toBe('hit');
    await expectPart(chrome, data, 0, HEAD - 1);
    await expectPart(await get('bytes=100-'), data, 100, HEAD - 1);
    await expectPart(await get(`bytes=${HEAD - 10}-${HEAD + 10}`), data, HEAD - 10, HEAD - 1);
    expect(drive()).toBe(2);
    // Lo que sigue (lo que pide el navegador después) y lo del medio van a Drive como siempre.
    await expectPart(await get(`bytes=${HEAD}-`), data, HEAD, SIZE - 1);
    await expectPart(await get('bytes=1000000-1000999'), data, 1000000, 1000999);
    await expectPart(await get(`bytes=${SIZE - TAIL - 10}-${SIZE - TAIL + 10}`), data, SIZE - TAIL - 10, SIZE - TAIL + 10);
    expect(drive()).toBe(5);
    const all = await get();
    expect(all.status).toBe(200);
    expect(sameBytes(new Uint8Array(await all.arrayBuffer()), data)).toBe(true);
    expect((await get(`bytes=${SIZE + 10}-`)).status).toBe(416);
    expect((await get('bytes=0-1,5-9')).status).toBe(206); // varias partes: Drive decide
    expect(drive()).toBe(8);

    // HEAD: los mismos encabezados, sin cuerpo.
    const head = await get('bytes=0-99', 'HEAD');
    expect(head.status).toBe(206);
    expect(head.headers.get('Content-Length')).toBe('100');
    expect(head.headers.get('Content-Range')).toBe(`bytes 0-99/${SIZE}`);
    expect(await head.text()).toBe('');

    // Cada valor guardado pesa menos de 128 KiB.
    for (const [k, v] of store.data) if (k.startsWith('cache:') && v instanceof Uint8Array) expect(v.byteLength).toBeLessThan(128 * 1024);
    expect(store.data.get(`cacheSlot:${cacheSlot('videoxxxxxxxxxxx')}`)).toBe('videoxxxxxxxxxxx');
  });

  it('si el principio todavía no está guardado, `bytes=0-` lo trae una vez y responde corto', async () => {
    const { world, data, get } = await videoPass();
    const first = await get('bytes=0-');
    expect(first.headers.get('X-Portero-Cache')).toBe('fill');
    await expectPart(first, data, 0, HEAD - 1);
    await expectPart(await get(`bytes=5000-${HEAD + 999999}`), data, 5000, HEAD - 1);
    expect(world.mediaCalls()).toBe(1);
  });

  it('el principio y el final pedidos a la vez quedan guardados los dos (no se pisan)', async () => {
    const { world, data, get } = await videoPass();
    const [a, b] = await Promise.all([get('bytes=0-1'), get('bytes=-100')]);
    await expectPart(a, data, 0, 1);
    await expectPart(b, data, SIZE - 100, SIZE - 1);
    expect(world.mediaCalls()).toBe(2);
    await expectPart(await get('bytes=10-20'), data, 10, 20);
    await expectPart(await get('bytes=-200'), data, SIZE - 200, SIZE - 1);
    expect(world.mediaCalls()).toBe(2);
  });

  it('nunca sirve bytes que no son de ese archivo: sin su lugar, o con un trozo que no mide lo que debe, va a Drive', async () => {
    const { world, store, data, get } = await videoPass();
    await get('bytes=0-1');
    expect(world.mediaCalls()).toBe(1);
    // Otro archivo ocupó su lugar (un pedido que se pisó con otro): lo que quedó no se usa.
    store.data.set(`cacheSlot:${cacheSlot('videoxxxxxxxxxxx')}`, 'otroxxxxxxxxxxxx');
    await expectPart(await get('bytes=10-20'), data, 10, 20);
    expect(world.mediaCalls()).toBe(2); // vuelve a traer el principio y recupera su lugar
    await expectPart(await get('bytes=10-20'), data, 10, 20);
    expect(world.mediaCalls()).toBe(2);
    // Un trozo roto (más corto): no se usa.
    store.data.set(`cache:videoxxxxxxxxxxx:${SIZE}:h0`, new Uint8Array(10));
    await expectPart(await get('bytes=10-20'), data, 10, 20);
    expect(world.mediaCalls()).toBe(3);
    // Una descripción de otro peso apunta a trozos de otras claves: tampoco mezcla.
    const zone = store.data.get('cache:videoxxxxxxxxxxx:head') as { size: number };
    store.data.set('cache:videoxxxxxxxxxxx:head', { ...zone, size: SIZE + 1 });
    await expectPart(await get('bytes=10-20'), data, 10, 20);
    expect(world.mediaCalls()).toBe(5); // prueba traer el principio, ve el peso de verdad, olvida y va a Drive
    await expectPart(await get('bytes=10-20'), data, 10, 20); // lo vuelve a guardar bien
    await expectPart(await get('bytes=10-20'), data, 10, 20);
    expect(world.mediaCalls()).toBe(6);
  });

  it('otro Portero (otro pedido) usa lo guardado; un archivo chico se guarda entero', async () => {
    const { world, store, data, get } = await videoPass(50_000);
    await expectPart(await get('bytes=0-1'), data, 0, 1);
    expect(world.mediaCalls()).toBe(1);
    await expectPart(await get('bytes=0-'), data, 0, 49_999);
    await expectPart(await get('bytes=40000-'), data, 40000, 49_999);
    expect(world.mediaCalls()).toBe(1);
    // Un pedido nuevo (cada pedido es un Portero nuevo) con otro pase del mismo archivo.
    const q = new Portero(env, store, world.http);
    const { url } = (await (await filePass(q, 'owner-jwt', FILE_A)).json()) as { url: string };
    await expectPart(await q.handle(new Request(url, { headers: { Range: 'bytes=100-200' } })), data, 100, 200);
    expect(world.mediaCalls()).toBe(1);
  });

  it('un pase de la prueba de media (sin el peso) aprende el peso y después guarda', async () => {
    const { world, p } = await setup();
    const data = bytes(SIZE);
    world.files.set('pruebaxxxxxxxxxx', { name: 'v.mp4', mime: 'video/mp4', data, parents: [] });
    const pass = await call(p, '/pass', { method: 'POST', jwt: 'owner-jwt', body: JSON.stringify({ fileId: 'pruebaxxxxxxxxxx', type: 'video/mp4' }) });
    const { url } = (await pass.json()) as { url: string };
    const get = (range: string) => p.handle(new Request(url, { headers: { Range: range } }));
    const first = await get('bytes=0-1');
    expect(first.headers.get('Content-Range')).toBe(`bytes 0-1/${SIZE}`);
    expect(first.headers.get('Content-Type')).toBe('video/mp4');
    expect(world.mediaCalls()).toBe(1);
    await get('bytes=0-1'); // ahora sabe el peso: trae el principio entero
    expect(world.mediaCalls()).toBe(2);
    const hit = await get('bytes=10-19');
    expect(hit.headers.get('Content-Type')).toBe('video/mp4');
    expect(new Uint8Array(await hit.arrayBuffer())).toEqual(data.slice(10, 20));
    expect(world.mediaCalls()).toBe(2);
  });

  it('si otro archivo toma el lugar mientras se espera a Drive, lo olvida entero (no quedan trozos sin dueño)', async () => {
    const { world, store } = await setup();
    const video = 'videoxxxxxxxxxxx';
    let other = '';
    for (let i = 0; !other; i++) if (cacheSlot(`otro${i}xxxxxxxxxxxx`) === cacheSlot(video)) other = `otro${i}xxxxxxxxxxxx`;
    const data = bytes(SIZE);
    world.files.set(video, { name: 'v.mov', mime: 'video/quicktime', data, parents: [], appProperties: { sdFile: FILE_A } });
    addBaseFile(world, FILE_A, { drive_id: video, size: SIZE });
    // Mientras Drive contesta el principio, otro pedido guarda otro archivo en el mismo lugar.
    const racing: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith(`/files/${video}`) && url.searchParams.get('alt') === 'media' && store.data.get(`cacheSlot:${cacheSlot(video)}`) === undefined) {
        store.data.set(`cacheSlot:${cacheSlot(video)}`, other);
        store.data.set(`cache:${other}:20:h0`, bytes(20));
        store.data.set(`cache:${other}:head`, { size: 20, length: 20 });
      }
      return world.http(input, init);
    };
    const q = new Portero(env, store, racing);
    const { url } = (await (await filePass(q, 'viewer-jwt', FILE_A)).json()) as { url: string };
    const res = await q.handle(new Request(url, { headers: { Range: 'bytes=0-1' } }));
    expect(res.status).toBe(206);
    expect(store.data.get(`cacheSlot:${cacheSlot(video)}`)).toBe(video);
    expect(store.data.has(`cache:${other}:head`)).toBe(false);
    expect(store.data.has(`cache:${other}:20:h0`)).toBe(false);
    expect(world.mediaCalls()).toBe(1);
  });

  it(`guarda como mucho ${CACHE_FILES} archivos: el que llega desplaza al que estaba en su lugar`, async () => {
    const { world, store, p } = await setup();
    const first = 'chico0000xxxxxxxxxx';
    let other = '';
    for (let i = 1; !other; i++) {
      const id = `chico${String(i).padStart(4, '0')}xxxxxxxxxx`;
      if (cacheSlot(id) === cacheSlot(first)) other = id;
    }
    const open = async (id: string) => {
      world.files.set(id, { name: 'a', mime: 'video/mp4', data: bytes(20), parents: [] });
      const pass = await call(p, '/pass', { method: 'POST', jwt: 'owner-jwt', body: JSON.stringify({ fileId: id, type: 'video/mp4' }) });
      return ((await pass.json()) as { url: string }).url;
    };
    const a = await open(first);
    const b = await open(other);
    await p.handle(new Request(a, { headers: { Range: 'bytes=0-1' } })); // aprende el peso
    await p.handle(new Request(a, { headers: { Range: 'bytes=0-1' } })); // guarda
    expect(store.data.has(`cache:${first}:20:h0`)).toBe(true);
    await p.handle(new Request(b, { headers: { Range: 'bytes=0-1' } }));
    await p.handle(new Request(b, { headers: { Range: 'bytes=0-1' } }));
    expect(store.data.get(`cacheSlot:${cacheSlot(first)}`)).toBe(other);
    expect(store.data.has(`cache:${first}:head`)).toBe(false);
    expect(store.data.has(`cache:${first}:20:h0`)).toBe(false);
    expect(store.data.has(`cache:${other}:20:h0`)).toBe(true);
    // Nunca más de CACHE_FILES lugares.
    expect([...store.data.keys()].filter((k) => k.startsWith('cacheSlot:')).every((k) => Number(k.split(':')[1]) < CACHE_FILES)).toBe(true);
  });
});

describe('portero: compatibilidad con lo guardado y la app de hoy', () => {
  it('lo guardado antes (google con carpetas, una subida a medias sin file, un pase viejo) sigue andando', async () => {
    const world = fakeWorld();
    const store = memoryStore();
    const p = new Portero(env, store, world.http);
    await connect(p);
    world.files.set('rootviejoxxxxxxx', { name: 'LGA_ShotDocs', mime: 'application/vnd.google-apps.folder', data: new Uint8Array(), parents: ['root'] });
    world.files.set('testviejoxxxxxxx', { name: 'Media_Test', mime: 'application/vnd.google-apps.folder', data: new Uint8Array(), parents: ['rootviejoxxxxxxx'] });
    store.data.set('google', { ...(store.data.get('google') as object), rootFolder: 'rootviejoxxxxxxx', testFolder: 'testviejoxxxxxxx' });

    // Una subida de la prueba de media empezada con la versión anterior (sin `file`).
    const start = await call(p, '/upload', { method: 'POST', jwt: 'owner-jwt', body: JSON.stringify({ name: 'IMG.MOV', mime: 'video/quicktime', size: 10 }) });
    const { uploadId } = (await start.json()) as { uploadId: string };
    const saved = store.data.get(`upload:${uploadId}`) as Record<string, unknown>;
    expect(saved.file).toBeUndefined();
    const done = await call(p, `/upload/${uploadId}`, { method: 'PUT', jwt: 'owner-jwt', headers: { 'Content-Range': 'bytes 0-9/10' }, body: bytes(10) });
    const answer = (await done.json()) as { status: string; file: { id: string } };
    expect(Object.keys(answer).sort()).toEqual(['file', 'status']); // igual que antes: sin `linked`
    expect(world.files.get(answer.file.id)!.parents).toEqual(['testviejoxxxxxxx']);
    expect(world.folders()).toHaveLength(2);
    expect(world.calls.some((c) => c.endsWith('set_file_drive'))).toBe(false);

    // Un pase firmado por la versión anterior ({ f, t, u }, sin el peso) se sigue sirviendo.
    const pass = await call(p, '/pass', { method: 'POST', jwt: 'owner-jwt', body: JSON.stringify({ fileId: answer.file.id }) });
    const { url } = (await pass.json()) as { url: string };
    const media = await p.handle(new Request(url, { headers: { Range: 'bytes=2-5' } }));
    expect(media.status).toBe(206);
    expect(new Uint8Array(await media.arrayBuffer())).toEqual(bytes(10).slice(2, 6));

    // El estado tiene lo de antes, más lo nuevo.
    const status = (await (await call(p, '/drive/status', { jwt: 'owner-jwt' })).json()) as Record<string, unknown>;
    expect(status).toEqual({ connected: true, broken: null, email: 'lega@example.com', isOwner: true, folder: null, picker: false, features: ['folders'] });
  });

  it('reconectar Drive conserva las carpetas; con otra cuenta de Google olvida la carpeta elegida', async () => {
    const { store, p } = await setup();
    store.data.set('google', { ...(store.data.get('google') as object), rootFolder: 'r1xxxxxxxxxxxxxx', testFolder: 't1xxxxxxxxxxxxxx' });
    store.data.set('drivePlace', { id: 'placexxxxxxxxxxx', name: 'Trabajo' });
    await connect(p);
    expect(store.data.get('google')).toMatchObject({ rootFolder: 'r1xxxxxxxxxxxxxx', testFolder: 't1xxxxxxxxxxxxxx' });
    expect(store.data.get('drivePlace')).toEqual({ id: 'placexxxxxxxxxxx', name: 'Trabajo' });
    store.data.set('google', { ...(store.data.get('google') as object), email: 'otra@example.com' });
    await connect(p);
    expect(store.data.has('drivePlace')).toBe(false);
  });
});

// --- nombres y encabezados de lo que se sirve (adjuntos, entrega 1a) ------------------------------------

/** Un archivo de la app ya subido, con su tipo y su nombre en la base, y un pase para verlo. */
async function servedFile(name: string, mime: string, size = 100) {
  const { world, store, p } = await setup();
  const data = bytes(size);
  world.files.set('adjuntoxxxxxxxxx', { name: 'en-drive.bin', mime, data, parents: [], appProperties: { sdFile: FILE_A } });
  addBaseFile(world, FILE_A, { drive_id: 'adjuntoxxxxxxxxx', size, mime, name });
  const answer = (await (await filePass(p, 'viewer-jwt', FILE_A)).json()) as { url: string; named?: boolean };
  const get = (query = '', init: RequestInit = {}) => p.handle(new Request(`${answer.url}${query}`, init));
  return { world, store, p, data, answer, get };
}

/** Un pase firmado a mano con la clave del portero (como los que ya emitió una versión anterior). */
async function signedPass(store: ReturnType<typeof memoryStore>, data: Record<string, unknown>): Promise<string> {
  const secret = store.data.get('passSecret') as string;
  const key = await crypto.subtle.importKey('raw', Buffer.from(secret, 'base64url'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  const signature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))).toString('base64url');
  return `${SELF}/m/${payload}.${signature}`;
}

function driveError(status: number, reason: string): Response {
  const body = { error: { code: status, message: reason, errors: [{ domain: 'global', reason, message: reason }] } };
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function expectSafe(res: Response) {
  expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
}

describe('portero: nombres y encabezados de lo que se sirve', () => {
  it('/pass dice named: true y el nombre sale de files.name, no de lo que mande la app', async () => {
    const { answer, p, get } = await servedFile('Guion final.pdf', 'application/pdf');
    expect(answer.named).toBe(true);
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe(`inline; filename="Guion final.pdf"; filename*=UTF-8''Guion%20final.pdf`);
    // Un `name` (o un `type`) en el pedido no cuenta.
    const asked = await call(p, '/pass', { method: 'POST', jwt: 'viewer-jwt', body: JSON.stringify({ file: FILE_A, name: 'x.html', type: 'text/html' }) });
    const other = await p.handle(new Request(((await asked.json()) as { url: string }).url));
    expect(other.headers.get('Content-Disposition')).toContain('filename="Guion final.pdf"');
    expect(other.headers.get('Content-Type')).toBe('application/pdf');
    // El pase de la prueba de media también lo dice.
    const legacy = await call(p, '/pass', { method: 'POST', jwt: 'owner-jwt', body: JSON.stringify({ fileId: 'adjuntoxxxxxxxxx' }) });
    expect(await legacy.json()).toMatchObject({ named: true });
  });

  it('un nombre muy largo se corta antes de la extensión (la descarga sigue siendo .pdf)', async () => {
    const { cleanFileName } = await import('./core');
    const long = 'a'.repeat(400) + '.pdf';
    const clean = cleanFileName(long);
    expect(Array.from(clean).length).toBeLessThanOrEqual(255);
    expect(clean.endsWith('.pdf')).toBe(true);
    expect(cleanFileName('x\u200by\u2028z.txt')).toBe('xyz.txt');
  });

  it('encabezados por tipo: la lista inline con su tipo; lo demás, octet-stream y attachment', async () => {
    const cases: [mime: string, type: string, kind: 'inline' | 'attachment', sandbox: boolean][] = [
      ['application/pdf', 'application/pdf', 'inline', false],
      ['image/jpeg', 'image/jpeg', 'inline', true],
      ['image/heic', 'image/heic', 'inline', true],
      ['video/mp4', 'video/mp4', 'inline', true],
      ['video/quicktime', 'video/quicktime', 'inline', true],
      ['audio/mpeg', 'audio/mpeg', 'inline', true],
      ['text/plain', 'text/plain; charset=utf-8', 'inline', true],
      ['image/x+xml', 'application/octet-stream', 'attachment', true],
      ['video/foo+xml', 'application/octet-stream', 'attachment', true],
      ['application/zip', 'application/octet-stream', 'attachment', true],
      ['application/x-rar-compressed', 'application/octet-stream', 'attachment', true],
      ['application/octet-stream', 'application/octet-stream', 'attachment', true],
      ['text/html', 'application/octet-stream', 'attachment', true],
      ['application/xhtml+xml', 'application/octet-stream', 'attachment', true],
      ['image/svg+xml', 'application/octet-stream', 'attachment', true],
      ['application/xml', 'application/octet-stream', 'attachment', true],
      ['text/xml', 'application/octet-stream', 'attachment', true],
      ['text/javascript', 'application/octet-stream', 'attachment', true],
      ['application/json', 'application/octet-stream', 'attachment', true],
      ['text/csv', 'application/octet-stream', 'attachment', true],
    ];
    for (const [mime, type, kind, sandbox] of cases) {
      const { get } = await servedFile('archivo.bin', mime);
      const res = await get();
      expect(res.status, mime).toBe(200);
      expect(res.headers.get('Content-Type'), mime).toBe(type);
      expect(res.headers.get('Content-Disposition'), mime).toBe(`${kind}; filename="archivo.bin"; filename*=UTF-8''archivo.bin`);
      // El PDF que se muestra va sin `sandbox`: con él, el visor de PDF del navegador no carga.
      expect(res.headers.get('Content-Security-Policy'), mime).toBe(sandbox ? 'sandbox' : null);
      expectSafe(res);
    }
    expect(inlineType('IMAGE/JPEG; charset=x')).toBe('image/jpeg');
    expect(inlineType('')).toBeNull();
    expect(inlineType('image/svg')).toBeNull();
  });

  it('?download=1 fuerza attachment (con sandbox) y nada lo pasa a inline', async () => {
    const pdf = await servedFile('Guion.pdf', 'application/pdf');
    const down = await pdf.get('?download=1');
    expect(down.headers.get('Content-Disposition')).toBe(`attachment; filename="Guion.pdf"; filename*=UTF-8''Guion.pdf`);
    expect(down.headers.get('Content-Type')).toBe('application/pdf');
    expect(down.headers.get('Content-Security-Policy')).toBe('sandbox');
    expectSafe(down);
    expect((await pdf.get('?download=0')).headers.get('Content-Disposition')).toMatch(/^inline;/);

    const photo = await servedFile('IMG_0001.JPG', 'image/jpeg');
    expect((await photo.get('?download=1', { headers: { Range: 'bytes=0-9' } })).headers.get('Content-Disposition')).toMatch(/^attachment;/);

    const html = await servedFile('pagina.html', 'text/html');
    for (const query of ['', '?download=0', '?download=inline', '?inline=1', '?download=1&download=0']) {
      const res = await html.get(query);
      expect(res.headers.get('Content-Disposition'), query).toMatch(/^attachment;/);
      expect(res.headers.get('Content-Type'), query).toBe('application/octet-stream');
      expect(res.headers.get('Content-Security-Policy'), query).toBe('sandbox');
    }
  });

  it('filename* bien codificado (acentos, comillas, paréntesis, emojis) y sin controles ni bidi', () => {
    expect(contentDisposition('attachment', 'Informe año 2026.pdf')).toBe(
      `attachment; filename="Informe a_o 2026.pdf"; filename*=UTF-8''Informe%20a%C3%B1o%202026.pdf`,
    );
    expect(contentDisposition('inline', 'dijo "hola".txt')).toBe(`inline; filename="dijo _hola_.txt"; filename*=UTF-8''dijo%20%22hola%22.txt`);
    expect(contentDisposition('inline', "O'Brien (final).pdf")).toBe(
      `inline; filename="O'Brien (final).pdf"; filename*=UTF-8''O%27Brien%20%28final%29.pdf`,
    );
    expect(contentDisposition('attachment', 'a*b.zip')).toBe(`attachment; filename="a*b.zip"; filename*=UTF-8''a%2Ab.zip`);
    // Un emoji (un par sustituto) es un solo `_` en el ASCII.
    expect(contentDisposition('attachment', 'rodaje 🎬.zip')).toBe(`attachment; filename="rodaje _.zip"; filename*=UTF-8''rodaje%20%F0%9F%8E%AC.zip`);
    // Una letra con el acento aparte (NFD, como los nombres de macOS) queda compuesta.
    expect(contentDisposition('inline', 'Cafe\u0301.pdf')).toBe(`inline; filename="Caf_.pdf"; filename*=UTF-8''Caf%C3%A9.pdf`);
    // U+202E da vuelta lo que sigue: `factura` + U+202E + `gpj.exe` se vería como `facturaexe.jpg`.
    expect(contentDisposition('attachment', 'factura\u202Egpj.exe')).toBe(`attachment; filename="facturagpj.exe"; filename*=UTF-8''facturagpj.exe`);
    expect(cleanFileName('\u2066a\u2069\u200Eb\u200F\u202Ac\u202B\u202C\u202D\u2067\u2068.txt')).toBe('abc.txt');
    // Controles: nada de cortar el encabezado con un salto de línea.
    expect(contentDisposition('attachment', 'a\r\nSet-Cookie: x\u0000\u0085.txt')).toBe(
      `attachment; filename="aSet-Cookie: x.txt"; filename*=UTF-8''aSet-Cookie%3A%20x.txt`,
    );
    expect(cleanFileName('../dir\\x.txt')).toBe('.._dir_x.txt');
    expect(cleanFileName('a\uD800b.txt')).toBe('ab.txt'); // media pareja sustituta: se saca (no rompe)
    expect(cleanFileName('x'.repeat(400))).toHaveLength(255);
    // Si no queda nada, sin nombre.
    expect(contentDisposition('inline', '\u202E \u0007')).toBe('inline');
    expect(contentDisposition('attachment', undefined)).toBe('attachment');
    // Lo que va en filename* vuelve a ser el nombre limpio.
    const header = contentDisposition('attachment', 'Ñandú "final" (v2) 🎬 100%.mov');
    expect(decodeURIComponent(header.split("filename*=UTF-8''")[1]!)).toBe('Ñandú "final" (v2) 🎬 100%.mov');
    expect(header).toMatch(/^[\x20-\x7e]+$/); // el encabezado es todo ASCII
  });

  it('el nombre llega a la respuesta desde files.name, limpio', async () => {
    const { get } = await servedFile('Toma\u202E 3 "buena" 🎬.mov', 'video/quicktime');
    const res = await get();
    expect(res.headers.get('Content-Disposition')).toBe(
      `inline; filename="Toma 3 _buena_ _.mov"; filename*=UTF-8''Toma%203%20%22buena%22%20%F0%9F%8E%AC.mov`,
    );
  });

  it('un pase viejo (sin n) sigue valiendo: sin nombre, pero con los encabezados de ahora', async () => {
    const { store, p, data } = await servedFile('Guion.pdf', 'application/pdf');
    // Como lo firmaba la versión anterior: { f, t, u, s }, sin el nombre.
    const oldPdf = await signedPass(store, { f: 'adjuntoxxxxxxxxx', t: 'application/pdf', u: Date.now() + 60_000, s: data.length });
    const pdf = await p.handle(new Request(oldPdf));
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('Content-Disposition')).toBe('inline');
    expect(pdf.headers.get('Content-Type')).toBe('application/pdf');
    expect(pdf.headers.get('Content-Security-Policy')).toBeNull();
    expectSafe(pdf);
    expect(sameBytes(new Uint8Array(await pdf.arrayBuffer()), data)).toBe(true);
  });

  it('un pase viejo de un HTML (sin peso ni nombre) se baja como octet-stream; el de una foto respeta ?download=1', async () => {
    const { world, store, p, data } = await servedFile('x.html', 'text/html');
    const u = Date.now() + 60_000;
    const old = await signedPass(store, { f: 'adjuntoxxxxxxxxx', t: 'text/html', u });
    const res = await p.handle(new Request(old));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(res.headers.get('Content-Disposition')).toBe('attachment');
    expect(res.headers.get('Content-Security-Policy')).toBe('sandbox');
    expect(sameBytes(new Uint8Array(await res.arrayBuffer()), data)).toBe(true);
    // Un pase viejo de una foto: inline sin nombre, y con ?download=1, attachment sin nombre.
    world.files.get('adjuntoxxxxxxxxx')!.mime = 'image/jpeg';
    const photo = await signedPass(store, { f: 'adjuntoxxxxxxxxx', t: 'image/jpeg', u, s: data.length });
    expect((await p.handle(new Request(photo))).headers.get('Content-Disposition')).toBe('inline');
    expect((await p.handle(new Request(`${photo}?download=1`))).headers.get('Content-Disposition')).toBe('attachment');
    // Un nombre agregado a un pase firmado sin él lo rompe.
    const [payload, signature] = photo.slice(`${SELF}/m/`.length).split('.');
    const withName = { ...(JSON.parse(Buffer.from(payload!, 'base64url').toString()) as object), n: 'x.html' };
    const forged = `${SELF}/m/${Buffer.from(JSON.stringify(withName)).toString('base64url')}.${signature}`;
    expect((await p.handle(new Request(forged))).status).toBe(403);
  });

  it('la respuesta 206 de la caché del arranque lleva los mismos encabezados (y respeta ?download=1)', async () => {
    const SIZE = 2 * 1024 * 1024;
    const { world, get } = await servedFile('Toma 1 (buena).mov', 'video/quicktime', SIZE);
    const fill = await get('', { headers: { Range: 'bytes=0-1' } });
    expect(fill.headers.get('X-Portero-Cache')).toBe('fill');
    const hit = await get('', { headers: { Range: 'bytes=10-20' } });
    expect(hit.status).toBe(206);
    expect(hit.headers.get('X-Portero-Cache')).toBe('hit');
    for (const res of [fill, hit]) {
      expect(res.headers.get('Content-Type')).toBe('video/quicktime');
      expect(res.headers.get('Content-Disposition')).toBe(`inline; filename="Toma 1 (buena).mov"; filename*=UTF-8''Toma%201%20%28buena%29.mov`);
      expect(res.headers.get('Content-Security-Policy')).toBe('sandbox');
      expect(res.headers.get('Accept-Ranges')).toBe('bytes');
      expectSafe(res);
    }
    const down = await get('?download=1', { headers: { Range: 'bytes=0-99' } });
    expect(down.headers.get('X-Portero-Cache')).toBe('hit');
    expect(down.headers.get('Content-Disposition')).toMatch(/^attachment; filename="Toma 1 \(buena\)\.mov"/);
    expect(world.mediaCalls()).toBe(1);
  });

  it('la caché del arranque es solo para videos: un PDF pedido por partes va siempre a Drive y no ocupa lugar', async () => {
    const SIZE = 2 * 1024 * 1024;
    const { world, store, data, get } = await servedFile('Plano.pdf', 'application/pdf', SIZE);
    for (let i = 0; i < 3; i++) {
      const res = await get('', { headers: { Range: 'bytes=0-1023' } });
      expect(res.status).toBe(206);
      expect(res.headers.get('X-Portero-Cache')).toBeNull();
      expect(res.headers.get('Content-Type')).toBe('application/pdf');
      expect(sameBytes(new Uint8Array(await res.arrayBuffer()), data.subarray(0, 1024))).toBe(true);
    }
    await get('', { headers: { Range: `bytes=${SIZE - 100}-` } });
    expect(world.mediaCalls()).toBe(4);
    expect([...store.data.keys()].filter((k) => k.startsWith('cache'))).toEqual([]);
  });

  it('un archivo que Drive marcó como malware: 403 con code abusive (también un video por partes)', async () => {
    for (const [mime, init] of [
      ['application/zip', {}],
      ['video/mp4', { headers: { Range: 'bytes=0-1' } }],
    ] as const) {
      const { world, store, answer } = await servedFile('raro.zip', mime);
      const flagged: typeof fetch = (input, i) =>
        new URL(String(input)).searchParams.get('alt') === 'media' ? Promise.resolve(driveError(403, 'cannotDownloadAbusiveFile')) : world.http(input, i);
      const res = await new Portero(env, store, flagged).handle(new Request(answer.url, init));
      expect(res.status, mime).toBe(403);
      expect(await res.json()).toEqual({ error: 'Google Drive flagged this file as malware or spam and does not let it be downloaded.', code: 'abusive' });
    }
    // Otro 403 de Drive (demasiados pedidos) sigue siendo un 502 como siempre.
    const { world, store, answer } = await servedFile('a.zip', 'application/zip');
    const limited: typeof fetch = (input, i) =>
      new URL(String(input)).searchParams.get('alt') === 'media' ? Promise.resolve(driveError(403, 'userRateLimitExceeded')) : world.http(input, i);
    const res = await new Portero(env, store, limited).handle(new Request(answer.url));
    expect(res.status).toBe(502);
    expect(((await res.json()) as { code?: string }).code).toBeUndefined();
  });

  it('el Drive del dueño lleno: 507 drive_full al empezar la subida o en una parte, y la subida se puede retomar', async () => {
    const { world, store } = await setup();
    addBaseFile(world, FILE_A, { size: 10 });
    let full = true;
    const quota: typeof fetch = (input, init) => {
      const url = new URL(String(input));
      if (full && url.pathname === '/upload/drive/v3/files') return Promise.resolve(driveError(403, 'storageQuotaExceeded'));
      if (full && url.pathname.startsWith('/session/') && init?.method === 'PUT' && String(new Headers(init.headers).get('Content-Range')).startsWith('bytes 0-')) {
        return Promise.resolve(driveError(403, 'storageQuotaExceeded'));
      }
      return world.http(input, init);
    };
    const p = new Portero(env, store, quota);
    const start = await startFile(p, 'editor-jwt', { file: FILE_A, size: 10, day: '2026-09-30' });
    expect(start.status).toBe(507);
    expect(await start.json()).toEqual({ error: 'The Google Drive of the workspace owner is full: free up space in it and try again.', code: 'drive_full' });

    full = false;
    const { uploadId } = (await (await startFile(p, 'editor-jwt', { file: FILE_A, size: 10, day: '2026-09-30' })).json()) as { uploadId: string };
    full = true;
    const put = (range: string, body?: Uint8Array<ArrayBuffer>) =>
      call(p, `/upload/${uploadId}`, { method: 'PUT', jwt: 'editor-jwt', headers: { 'Content-Range': range }, body });
    const part = await put('bytes 0-9/10', bytes(10));
    expect(part.status).toBe(507);
    expect(await part.json()).toMatchObject({ code: 'drive_full' });
    // Con espacio de nuevo, la misma subida sigue.
    full = false;
    expect(await (await put('bytes */10')).json()).toEqual({ status: 'incomplete', received: 0 });
    expect(await (await put('bytes 0-9/10', bytes(10))).json()).toMatchObject({ status: 'done', linked: true });
  });
});

describe('portero: la app puede leer lo que se sirve (CORS, fotos nítidas de v0.059)', () => {
  // La app baja el original con `fetch` para hacer la imagen nítida de la página (src/ui/sharpImages.ts): sin
  // `Access-Control-Allow-Origin` el navegador no le deja leer la respuesta. Un `<img>` o un `<video>` (lo
  // que usaban las versiones anteriores y el carrete) no manda `Origin` y sale igual que antes.
  it('GET desde la app: 200 con el origen de la app, Vary: Origin y los encabezados que la app lee', async () => {
    const { get, data } = await servedFile('IMG_0007.JPG', 'image/jpeg', 300);
    const res = await get('', { headers: { Origin: APP } });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(APP);
    expect(res.headers.get('Vary')).toContain('Origin');
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('Content-Length');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(data);
    expectSafe(res);
  });

  it('otro origen no queda habilitado; sin Origin (un <img>, las versiones anteriores) sale como antes', async () => {
    const { get } = await servedFile('IMG_0007.JPG', 'image/jpeg');
    const evil = await get('', { headers: { Origin: 'https://evil.example' } });
    expect(evil.status).toBe(200);
    expect(evil.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(evil.headers.get('Vary')).toContain('Origin');
    const plain = await get();
    expect(plain.status).toBe(200);
    expect(plain.headers.get('Access-Control-Allow-Origin')).toBeNull();
    // La caché del navegador no mezcla la respuesta sin CORS con la de la app.
    expect(plain.headers.get('Vary')).toContain('Origin');
    expect(plain.headers.get('Content-Type')).toBe('image/jpeg');
  });

  it('por partes (206, también de la caché del arranque del video), HEAD y 416, con CORS', async () => {
    const { get } = await servedFile('IMG_0008.MOV', 'video/quicktime', 1000);
    const part = await get('', { headers: { Origin: APP, Range: 'bytes=0-99' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('Access-Control-Allow-Origin')).toBe(APP);
    expect(part.headers.get('Access-Control-Expose-Headers')).toContain('Content-Range');
    const tail = await get('', { headers: { Origin: APP, Range: 'bytes=900-' } });
    expect(tail.status).toBe(206);
    expect(tail.headers.get('Access-Control-Allow-Origin')).toBe(APP);
    const head = await get('', { method: 'HEAD', headers: { Origin: APP } });
    expect(head.headers.get('Access-Control-Allow-Origin')).toBe(APP);
    const out = await get('', { headers: { Origin: APP, Range: 'bytes=5000-' } });
    expect(out.status).toBe(416);
    expect(out.headers.get('Access-Control-Allow-Origin')).toBe(APP);
  });

  it('el preflight de un pedido por partes desde la app deja pasar Range', async () => {
    const { answer, p } = await servedFile('IMG_0007.JPG', 'image/jpeg');
    const res = await p.handle(
      new Request(answer.url, { method: 'OPTIONS', headers: { Origin: APP, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'range' } }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(APP);
    expect(res.headers.get('Access-Control-Allow-Headers')?.toLowerCase().split(/,\s*/)).toContain('range');
  });

  it('un error de un pase (vencido) también lo puede leer la app', async () => {
    const { store, p } = await servedFile('IMG_0007.JPG', 'image/jpeg');
    const expired = await signedPass(store, { f: 'adjuntoxxxxxxxxx', u: Date.now() - 1000, t: 'image/jpeg' });
    const res = await p.handle(new Request(expired, { headers: { Origin: APP } }));
    expect(res.status).toBe(403);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(APP);
  });
});
