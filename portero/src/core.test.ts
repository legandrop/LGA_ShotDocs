import { describe, expect, it } from 'vitest';
import { Portero, type Env, type Store } from './core';

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

/** Google y Supabase de mentira: sesiones, tokens, carpetas, subida por partes y bajada con Range. */
function fakeWorld() {
  const sessions = new Map<string, { user: string; owner: boolean }>([
    ['owner-jwt', { user: 'u-owner', owner: true }],
    ['member-jwt', { user: 'u-member', owner: false }],
  ]);
  const files = new Map<string, { name: string; mime: string; data: Uint8Array; parents: string[] }>();
  const uploads = new Map<string, { name: string; mime: string; size: number; parents: string[]; data: Uint8Array; got: number }>();
  let refreshValid = true;
  let tokenRefreshes = 0;
  let grantedScope = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email openid';
  let n = 0;
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
      return jsonRes({ user_id: s.user, is_owner: s.owner });
    }
    if (url.href === 'https://oauth2.googleapis.com/token') {
      const form = new URLSearchParams(String(init.body));
      if (form.get('grant_type') === 'authorization_code') {
        const idToken = `h.${btoa(JSON.stringify({ email: 'lega@example.com' }))}.s`;
        return jsonRes({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, id_token: idToken, scope: grantedScope });
      }
      tokenRefreshes++;
      if (!refreshValid) return jsonRes({ error: 'invalid_grant' }, 400);
      return jsonRes({ access_token: `at-${++n}`, expires_in: 3600 });
    }
    if (!/^Bearer at-/.test(headers.get('Authorization') ?? '') && !url.pathname.startsWith('/session/')) {
      return jsonRes({ error: 'unauthorized' }, 401);
    }
    if (url.host === 'www.googleapis.com' && url.pathname === '/drive/v3/files' && init.method === 'POST') {
      const meta = JSON.parse(String(init.body)) as { name: string; parents?: string[] };
      const id = `folder${++n}xxxxxxxx`;
      files.set(id, { name: meta.name, mime: 'application/vnd.google-apps.folder', data: new Uint8Array(), parents: meta.parents ?? [] });
      return jsonRes({ id });
    }
    const one = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname)?.[1];
    if (one && url.searchParams.get('alt') === 'media') {
      const f = files.get(one);
      if (!f) return jsonRes({ error: 'not found' }, 404);
      const range = /bytes=(\d+)-(\d*)/.exec(headers.get('Range') ?? '');
      if (!range) return new Response(f.data, { status: 200, headers: { 'Content-Type': f.mime, 'Content-Length': String(f.data.length) } });
      const start = Number(range[1]);
      const end = range[2] ? Number(range[2]) : f.data.length - 1;
      return new Response(f.data.slice(start, end + 1), {
        status: 206,
        headers: { 'Content-Type': f.mime, 'Content-Range': `bytes ${start}-${end}/${f.data.length}`, 'Content-Length': String(end - start + 1) },
      });
    }
    if (one && init.method === 'PATCH') {
      const f = files.get(one);
      if (!f) return jsonRes({ error: 'not found' }, 404);
      f.name = (JSON.parse(String(init.body)) as { name: string }).name;
      return jsonRes({ id: one });
    }
    if (one) {
      const f = files.get(one);
      return f ? jsonRes({ id: one, name: f.name, trashed: false }) : jsonRes({ error: 'not found' }, 404);
    }
    if (url.host === 'www.googleapis.com' && url.pathname === '/upload/drive/v3/files') {
      const meta = JSON.parse(String(init.body)) as { name: string; parents: string[] };
      const id = `session${++n}`;
      uploads.set(id, {
        name: meta.name,
        mime: headers.get('X-Upload-Content-Type') ?? '',
        size: Number(headers.get('X-Upload-Content-Length')),
        parents: meta.parents,
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
        files.set(id, { name: up.name, mime: up.mime, data: up.data, parents: up.parents });
        return jsonRes({ id, name: up.name, mimeType: up.mime, size: String(up.size) }, 200);
      }
      return new Response(null, { status: 308, headers: up.got > 0 ? { Range: `bytes=0-${up.got - 1}` } : {} });
    }
    return jsonRes({ error: `unexpected ${url.href}` }, 500);
  }) as typeof fetch;

  return {
    http,
    files,
    calls,
    breakRefresh: () => (refreshValid = false),
    refreshes: () => tokenRefreshes,
    grantOnly: (scope: string) => (grantedScope = scope),
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
