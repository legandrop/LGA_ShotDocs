import { afterEach, describe, expect, it, vi } from 'vitest';
import { DRIVE_CALL_BUDGET, driveFolderName, FOLDER_BATCH, Portero, TREE_TTL_MS, validFolderPath, type Env, type Store } from './core';

// Carpetas (P.9, Docs/Doc_Carpetas.md): crear el árbol, abrir las subidas, listar en vivo y, sobre todo, que
// nadie pueda listar, subir ni bajar nada de afuera del árbol de la carpeta.

const env: Env = {
  SUPABASE_URL: 'https://ws.example',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
  APP_ORIGINS: 'https://app.example',
  GOOGLE_CLIENT_ID: 'client',
  GOOGLE_CLIENT_SECRET: 'secret',
};
const SELF = 'https://portero.example';
const APP = 'https://app.example';
const FOLDER = 'application/vnd.google-apps.folder';
const SHORTCUT = 'application/vnd.google-apps.shortcut';
const F1 = '11111111-1111-4111-8111-111111111111';
const F2 = '22222222-2222-4222-8222-222222222222';
const PHOTO = '33333333-3333-4333-8333-333333333333';
const PROJECT = '99999999-9999-4999-8999-999999999999';

function memoryStore(): Store & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async <T,>(k: string) => structuredClone(data.get(k)) as T | undefined,
    put: async (k, v) => void data.set(k, structuredClone(v)),
    delete: async (k) => void data.delete(k),
  };
}

type DriveItem = {
  name: string;
  mimeType: string;
  parents: string[];
  appProperties?: Record<string, string>;
  trashed?: boolean;
  data?: Uint8Array<ArrayBuffer>;
  thumb?: boolean;
};

/** Drive y Supabase de mentira, con las consultas que usa el portero para las carpetas. */
function fakeWorld() {
  const sessions = new Map<string, string>([
    ['owner-jwt', 'u-owner'],
    ['editor-jwt', 'u-editor'],
    ['viewer-jwt', 'u-viewer'],
    ['stranger-jwt', 'u-stranger'],
  ]);
  const drive = new Map<string, DriveItem>();
  const base = new Map<string, { name: string; mime: string; size: number; drive_id: string | null; levels: Record<string, number> }>();
  const uploads = new Map<string, { meta: DriveItem; size: number; data: Uint8Array<ArrayBuffer>; got: number }>();
  let n = 0;
  let rateAfter = Infinity;
  let sessionsOpened = 0;
  const calls: string[] = [];
  const id = (prefix: string) => `${prefix}${++n}`.padEnd(14, 'x');

  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  const metaOf = (key: string, f: DriveItem) => ({
    id: key,
    name: f.name,
    mimeType: f.mimeType,
    parents: f.parents,
    trashed: !!f.trashed,
    appProperties: f.appProperties,
    size: f.data ? String(f.data.length) : undefined,
    modifiedTime: '2026-10-01T10:00:00Z',
    hasThumbnail: !!f.thumb,
    thumbnailLink: f.thumb ? `https://lh3.googleusercontent.com/t-${key}=s220` : undefined,
  });

  const http = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers);
    const method = init.method ?? 'GET';
    calls.push(`${method} ${url.host}${url.pathname}`);

    if (url.host === 'ws.example') {
      const user = sessions.get((headers.get('Authorization') ?? '').replace('Bearer ', ''));
      if (!user) return json({ message: 'JWT expired' }, 401);
      const args = JSON.parse(String(init.body ?? '{}')) as { p_file_id?: string; p_drive_id?: string };
      if (url.pathname === '/rest/v1/rpc/media_whoami') return json({ user_id: user, is_owner: user === 'u-owner' });
      if (url.pathname === '/rest/v1/rpc/media_file') {
        const f = base.get(args.p_file_id ?? '');
        const level = f?.levels[user] ?? 0;
        if (!f || level === 0) return json(null);
        return json({ id: args.p_file_id, project_id: PROJECT, project_name: 'Spot Coca', name: f.name, mime: f.mime, size: f.size, drive_id: f.drive_id, created_at: '2026-10-01T10:00:00Z', level });
      }
      if (url.pathname === '/rest/v1/rpc/set_file_drive') {
        const f = base.get(args.p_file_id ?? '');
        if (!f || (f.levels[user] ?? 0) < 3) return json({ message: 'file_not_found' }, 404);
        if (f.drive_id && f.drive_id !== args.p_drive_id) return json({ message: 'file_already_uploaded' }, 400);
        f.drive_id = args.p_drive_id!;
        return new Response(null, { status: 204 });
      }
      return json({ message: 'unexpected' }, 500);
    }
    if (url.href === 'https://oauth2.googleapis.com/token') {
      const form = new URLSearchParams(String(init.body));
      if (form.get('grant_type') === 'authorization_code') {
        return json({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive.file' });
      }
      return json({ access_token: 'at-2', expires_in: 3600 });
    }
    const session = /^\/session\/(.+)$/.exec(url.pathname)?.[1];
    if (!session && !/^Bearer at-/.test(headers.get('Authorization') ?? '')) return json({ error: 'unauthorized' }, 401);
    if (url.host === 'lh3.googleusercontent.com') {
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg' } });
    }
    if (url.pathname === '/drive/v3/files' && method === 'POST') {
      const meta = JSON.parse(String(init.body)) as DriveItem & { parents?: string[] };
      if (meta.parents?.some((p) => p !== 'root' && !drive.has(p))) return json({ error: 'parent not found' }, 404);
      const key = id(meta.mimeType === FOLDER ? 'folder' : 'empty');
      drive.set(key, { name: meta.name, mimeType: meta.mimeType, parents: meta.parents ?? ['root'], appProperties: meta.appProperties, data: meta.mimeType === FOLDER ? undefined : new Uint8Array() });
      return json({ id: key, name: meta.name, mimeType: meta.mimeType, size: '0' });
    }
    if (url.pathname === '/drive/v3/files' && method === 'GET') {
      const q = url.searchParams.get('q') ?? '';
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const mime = /mimeType = '([^']+)'/.exec(q)?.[1];
      const sdFolder = /key='sdFolder' and value='([^']+)'/.exec(q)?.[1];
      const sdPaths = [...q.matchAll(/key='sdPath' and value='([^']+)'/g)].map((m) => m[1]);
      let list = [...drive.entries()].filter(([, f]) => !f.trashed);
      if (parent) list = list.filter(([, f]) => f.parents.includes(parent));
      if (mime) list = list.filter(([, f]) => f.mimeType === mime);
      if (sdFolder) list = list.filter(([, f]) => f.appProperties?.sdFolder === sdFolder);
      if (sdPaths.length) list = list.filter(([, f]) => sdPaths.includes(f.appProperties?.sdPath ?? ''));
      list.sort(([, a], [, b]) => Number(b.mimeType === FOLDER) - Number(a.mimeType === FOLDER) || a.name.localeCompare(b.name, undefined, { numeric: true }));
      return json({ files: list.map(([k, f]) => metaOf(k, f)) });
    }
    const one = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname)?.[1];
    if (one && url.searchParams.get('alt') === 'media') {
      const f = drive.get(one);
      if (!f?.data) return json({ error: 'not found' }, 404);
      return new Response(f.data, { status: 200, headers: { 'Content-Type': f.mimeType, 'Content-Length': String(f.data.length) } });
    }
    if (one && method === 'PATCH') {
      const f = drive.get(one);
      if (!f) return json({ error: 'not found' }, 404);
      const body = JSON.parse(String(init.body ?? '{}')) as { trashed?: boolean };
      if (body.trashed !== undefined) f.trashed = body.trashed;
      return json({ id: one });
    }
    if (one) {
      const f = drive.get(one);
      return f ? json(metaOf(one, f)) : json({ error: 'not found' }, 404);
    }
    if (url.pathname === '/upload/drive/v3/files') {
      if (sessionsOpened >= rateAfter) return json({ error: { errors: [{ reason: 'userRateLimitExceeded' }] } }, 403);
      sessionsOpened++;
      const meta = JSON.parse(String(init.body)) as DriveItem;
      const size = Number(headers.get('X-Upload-Content-Length'));
      const key = `s${++n}`;
      uploads.set(key, { meta: { ...meta, mimeType: headers.get('X-Upload-Content-Type') ?? '' }, size, data: new Uint8Array(size), got: 0 });
      return new Response(null, { status: 200, headers: { Location: `https://www.googleapis.com/session/${key}` } });
    }
    if (session) {
      const up = uploads.get(session);
      if (!up) return json({ error: 'gone' }, 404);
      const part = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(headers.get('Content-Range') ?? '');
      if (part) {
        up.data.set(new Uint8Array(init.body as ArrayBuffer), Number(part[1]));
        up.got = Math.max(up.got, Number(part[2]) + 1);
      }
      if (up.got >= up.size) {
        const key = id('file');
        if (!drive.has(key)) drive.set(key, { ...up.meta, data: up.data });
        return json({ id: key, name: up.meta.name, mimeType: up.meta.mimeType, size: String(up.size) });
      }
      return new Response(null, { status: 308, headers: up.got > 0 ? { Range: `bytes=0-${up.got - 1}` } : {} });
    }
    return json({ error: `unexpected ${url.href}` }, 500);
  }) as typeof fetch;

  return {
    http,
    drive,
    base,
    calls,
    /** Drive deja abrir `count` subidas más y después pide ir más despacio. */
    rateLimitAfter: (count: number) => (rateAfter = sessionsOpened + count),
  };
}

function call(p: Portero, path: string, jwt: string | null, body?: unknown, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Origin', APP);
  if (jwt) headers.set('Authorization', `Bearer ${jwt}`);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  return p.handle(new Request(`${SELF}${path}`, { method: 'POST', ...init, headers, body: body === undefined ? init.body : JSON.stringify(body) }));
}

async function connect(p: Portero): Promise<void> {
  const res = await call(p, '/drive/connect', 'owner-jwt', {});
  const { url } = (await res.json()) as { url: string };
  const state = new URL(url).searchParams.get('state');
  await p.handle(new Request(`${SELF}/drive/callback?code=abc&state=${state}`));
}

/** Un portero conectado, con una carpeta de la app (F1) que el editor puede editar y el de "Ver" solo ver. */
async function setup() {
  const world = fakeWorld();
  const store = memoryStore();
  const p = new Portero(env, store, world.http);
  await connect(p);
  world.base.set(F1, { name: 'Referencias', mime: 'inode/directory', size: 10, drive_id: null, levels: { 'u-owner': 4, 'u-editor': 3, 'u-viewer': 1 } });
  world.base.set(F2, { name: 'Referencias', mime: 'inode/directory', size: 10, drive_id: null, levels: { 'u-owner': 4, 'u-editor': 3 } });
  world.base.set(PHOTO, { name: 'a.jpg', mime: 'image/jpeg', size: 3, drive_id: null, levels: { 'u-owner': 4, 'u-editor': 3, 'u-viewer': 1 } });
  return { world, store, p };
}

type Prepared = { root: { id: string; name: string }; dirs: Record<string, string> };
type Listed = { entries: { type: string; id?: string; name: string; url?: string; thumb?: string | null; size?: number }[]; nextPageToken: string | null };

async function prepare(p: Portero, body: Record<string, unknown>, jwt = 'editor-jwt'): Promise<Prepared> {
  const res = await call(p, '/folder/prepare', jwt, { file: F1, name: 'Referencias', ...body });
  expect(res.status).toBe(200);
  return (await res.json()) as Prepared;
}

async function uploadOne(p: Portero, uploadId: string, data: Uint8Array<ArrayBuffer>, jwt = 'editor-jwt'): Promise<Response> {
  return call(p, `/upload/${uploadId}`, jwt, undefined, {
    method: 'PUT',
    headers: { 'Content-Range': `bytes 0-${data.length - 1}/${data.length}` },
    body: data,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('carpetas: nombres y rutas', () => {
  it('las carpetas van sin espacios ni caracteres de control', () => {
    expect(driveFolderName('Fotos  día 2')).toBe('Fotos_día_2');
    expect(driveFolderName(' ‮ ')).toBe('Folder');
    expect(driveFolderName('a\u0000b')).toBe('ab');
  });

  it('una ruta no puede subir ni empezar con barra', () => {
    expect(validFolderPath('Fotos/Dia 2')).toBe(true);
    for (const bad of ['', '/Fotos', 'Fotos/', 'a//b', '..', 'a/../b', './a', 'a\\b', 1]) expect(validFolderPath(bad)).toBe(false);
  });
});

describe('carpetas: crear el árbol', () => {
  it('crea <Proyecto>/Carpetas/<nombre> con su marca, se lo dice a la base y crea las subcarpetas en orden', async () => {
    const { world, p } = await setup();
    const first = await prepare(p, { dirs: ['Fotos', 'Fotos/Dia 2', 'Notas'] });
    const root = world.drive.get(first.root.id)!;
    expect(root).toMatchObject({ name: 'Referencias', mimeType: FOLDER, appProperties: { sdFile: F1 } });
    const carpetas = world.drive.get(root.parents[0]!)!;
    expect(carpetas.name).toBe('Carpetas');
    expect(world.drive.get(carpetas.parents[0]!)!.name).toBe('Spot_Coca');
    expect(world.base.get(F1)!.drive_id).toBe(first.root.id);

    expect(world.drive.get(first.dirs['Fotos/Dia 2']!)).toMatchObject({ name: 'Dia_2', parents: [first.dirs.Fotos] });
    expect(world.drive.get(first.dirs.Notas!)!.parents).toEqual([first.root.id]);

    // Repetir el mismo pedido (la respuesta se perdió) no crea nada de más.
    const folders = () => [...world.drive.values()].filter((f) => f.mimeType === FOLDER).length;
    const before = folders();
    const again = await prepare(p, { dirs: ['Fotos', 'Fotos/Dia 2', 'Notas'] });
    expect(again).toEqual(first);
    expect(folders()).toBe(before);

    // Una tanda que sigue con las de abajo, con el id de la de arriba de un pedido anterior.
    const next = await prepare(p, { dirs: ['Fotos/Dia 2/Raw'], parents: { 'Fotos/Dia 2': first.dirs['Fotos/Dia 2'] } });
    expect(world.drive.get(next.dirs['Fotos/Dia 2/Raw']!)!.parents).toEqual([first.dirs['Fotos/Dia 2']]);
  });

  it('otra carpeta con el mismo nombre en el mismo proyecto va con _2', async () => {
    const { world, p } = await setup();
    const a = await prepare(p, {});
    const res = await call(p, '/folder/prepare', 'editor-jwt', { file: F2, name: 'Referencias' });
    const b = (await res.json()) as Prepared;
    expect(world.drive.get(a.root.id)!.name).toBe('Referencias');
    expect(world.drive.get(b.root.id)!.name).toBe('Referencias_2');
    expect(b.root.name).toBe('Referencias_2');
  });

  it('crear pide editar; ver no alcanza; sin acceso a la página es como si no existiera; un archivo no es una carpeta', async () => {
    const { p } = await setup();
    expect((await call(p, '/folder/prepare', 'viewer-jwt', { file: F1, name: 'x' })).status).toBe(403);
    const stranger = await call(p, '/folder/prepare', 'stranger-jwt', { file: F1, name: 'x' });
    expect(stranger.status).toBe(404);
    expect(((await stranger.json()) as { code: string }).code).toBe('not_found');
    expect((await call(p, '/folder/prepare', null, { file: F1 })).status).toBe(401);
    expect((await call(p, '/folder/prepare', 'editor-jwt', { file: PHOTO, name: 'x' })).status).toBe(400);
  });

  it('una ruta con .. o demasiadas en un pedido se rechazan', async () => {
    const { p } = await setup();
    expect((await call(p, '/folder/prepare', 'editor-jwt', { file: F1, dirs: ['../afuera'] })).status).toBe(400);
    expect((await call(p, '/folder/prepare', 'editor-jwt', { file: F1, dirs: ['/abs'] })).status).toBe(400);
    const many = Array.from({ length: FOLDER_BATCH + 1 }, (_, i) => `d${i}`);
    expect((await call(p, '/folder/prepare', 'editor-jwt', { file: F1, dirs: many })).status).toBe(400);
  });

  it('nunca crea una subcarpeta adentro de una carpeta de afuera del árbol', async () => {
    const { world, p } = await setup();
    const a = await prepare(p, {});
    const carpetas = world.drive.get(a.root.id)!.parents[0]!;
    const res = await call(p, '/folder/prepare', 'editor-jwt', { file: F1, dirs: ['x/y'], parents: { x: carpetas } });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('outside');
    // Tampoco en otra carpeta de la app.
    const other = (await (await call(p, '/folder/prepare', 'editor-jwt', { file: F2, name: 'Otra' })).json()) as Prepared;
    expect((await call(p, '/folder/prepare', 'editor-jwt', { file: F1, dirs: ['x/y'], parents: { x: other.root.id } })).status).toBe(403);
    expect([...world.drive.values()].some((f) => f.name === 'y')).toBe(false);
  });
});

describe('carpetas: subir', () => {
  it('abre las subidas, los bytes pasan por el portero y quedan en la subcarpeta; nada se guarda por archivo', async () => {
    const { world, store, p } = await setup();
    const tree = await prepare(p, { dirs: ['Fotos'] });
    const res = await call(p, '/folder/sessions', 'editor-jwt', {
      file: F1,
      items: [
        { dir: tree.dirs.Fotos, name: 'a.jpg', mime: 'image/jpeg', size: 5 },
        { dir: null, name: 'vacío.txt', mime: 'text/plain', size: 0 },
      ],
    });
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as { items: { uploadId?: string; done?: { id: string } }[] };
    const keys = store.data.size;
    expect(items[0]!.uploadId).toMatch(/^f\./);
    // El id no deja ver la dirección de Google.
    expect(items[0]!.uploadId).not.toContain('session');
    expect(world.drive.get(items[1]!.done!.id)).toMatchObject({ name: 'vacío.txt', parents: [tree.root.id], appProperties: { sdFolder: F1 } });

    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const done = (await (await uploadOne(p, items[0]!.uploadId!, data)).json()) as { status: string; file: { id: string } };
    expect(done.status).toBe('done');
    expect(world.drive.get(done.file.id)).toMatchObject({ name: 'a.jpg', parents: [tree.dirs.Fotos], appProperties: { sdFolder: F1 } });
    expect(world.drive.get(done.file.id)!.data).toEqual(data);
    expect(store.data.size).toBe(keys);

    // Si la respuesta se perdió, preguntar devuelve el archivo.
    const asked = await call(p, `/upload/${items[0]!.uploadId}`, 'editor-jwt', undefined, { method: 'PUT', headers: { 'Content-Range': 'bytes */5' } });
    expect(((await asked.json()) as { status: string }).status).toBe('done');
  });

  it('la subida es de quien la abrió; un id tocado o de otro portero no sirve', async () => {
    const { p } = await setup();
    await prepare(p, {});
    const { items } = (await (await call(p, '/folder/sessions', 'editor-jwt', { file: F1, items: [{ dir: null, name: 'a.bin', size: 3 }] })).json()) as {
      items: { uploadId: string }[];
    };
    const id = items[0]!.uploadId;
    expect((await uploadOne(p, id, new Uint8Array(3), 'owner-jwt')).status).toBe(404);
    const tampered = id.slice(0, -2) + (id.endsWith('A') ? 'BB' : 'AA');
    expect((await uploadOne(p, tampered, new Uint8Array(3))).status).toBe(404);
    const other = new Portero(env, memoryStore(), fakeWorld().http);
    expect((await uploadOne(other, id, new Uint8Array(3))).status).toBe(404);
  });

  it('una subida de más de 6 días se pide de nuevo', async () => {
    const { p } = await setup();
    await prepare(p, {});
    const { items } = (await (await call(p, '/folder/sessions', 'editor-jwt', { file: F1, items: [{ dir: null, name: 'a.bin', size: 3 }] })).json()) as {
      items: { uploadId: string }[];
    };
    vi.useFakeTimers({ now: Date.now() + 7 * 24 * 3600_000, toFake: ['Date'] });
    expect((await uploadOne(p, items[0]!.uploadId, new Uint8Array(3))).status).toBe(410);
  });

  it('subir pide editar, una carpeta ya creada y una subcarpeta del árbol', async () => {
    const { world, p } = await setup();
    expect((await call(p, '/folder/sessions', 'editor-jwt', { file: F1, items: [{ dir: null, name: 'a', size: 1 }] })).status).toBe(409);
    const tree = await prepare(p, { dirs: ['Fotos'] });
    expect((await call(p, '/folder/sessions', 'viewer-jwt', { file: F1, items: [{ dir: null, name: 'a', size: 1 }] })).status).toBe(403);
    expect((await call(p, '/folder/sessions', 'stranger-jwt', { file: F1, items: [{ dir: null, name: 'a', size: 1 }] })).status).toBe(404);
    // La carpeta de arriba (Carpetas), la del proyecto, la raíz del Drive: nunca.
    const carpetas = world.drive.get(tree.root.id)!.parents[0]!;
    const project = world.drive.get(carpetas)!.parents[0]!;
    for (const dir of [carpetas, project, 'rootxxxxxxxxxx']) {
      const res = await call(p, '/folder/sessions', 'editor-jwt', { file: F1, items: [{ dir, name: 'a', size: 1 }] });
      expect(res.status).toBe(403);
    }
    expect([...world.drive.values()].some((f) => f.name === 'a')).toBe(false);
  });

  it('ningún pedido pasa el tope de llamados a Drive del plan gratis: lo que no entra vuelve para después', async () => {
    const { world, store } = await setup();
    // 30 subcarpetas de 3 niveles, en una instancia nueva (sin nada comprobado en memoria).
    const dirs = Array.from({ length: 10 }, (_, i) => [`a${i}`, `a${i}/b`, `a${i}/b/c`]).flat();
    let done: Record<string, string> = {};
    let requests = 0;
    let maxUsed = 0;
    const counted = async (path: string, body: unknown) => {
      const before = world.calls.filter((c) => c.includes('googleapis')).length;
      // Lo guardado es el mismo, la memoria de la instancia no (otro objeto `Store`).
      const res = await call(new Portero(env, { ...store }, world.http), path, 'editor-jwt', body);
      const used = world.calls.filter((c) => c.includes('googleapis')).length - before;
      maxUsed = Math.max(maxUsed, used);
      expect(used).toBeLessThanOrEqual(DRIVE_CALL_BUDGET + 4);
      requests++;
      return res;
    };
    while (Object.keys(done).length < dirs.length && requests < 20) {
      const batch = dirs.filter((d) => !(d in done)).slice(0, FOLDER_BATCH);
      const parents = Object.fromEntries(Object.entries(done));
      const res = await counted('/folder/prepare', { file: F1, name: 'Referencias', dirs: batch, parents });
      expect(res.status).toBe(200);
      done = { ...done, ...((await res.json()) as Prepared).dirs };
    }
    expect(Object.keys(done).length).toBe(30);
    // Una tanda de 30 archivos en 30 subcarpetas distintas, en otra instancia nueva.
    const items = dirs.map((d) => ({ dir: done[d], name: 'x.bin', size: 1 }));
    const res = await counted('/folder/sessions', { file: F1, items });
    const out = ((await res.json()) as { items: { uploadId?: string; error?: string }[] }).items;
    expect(out.some((i) => i.uploadId)).toBe(true);
    expect(out.every((i) => i.uploadId || i.error === 'later')).toBe(true);
  });

  it('si Drive pide ir más despacio, los que faltan vuelven para pedirlos después', async () => {
    const { world, p } = await setup();
    await prepare(p, {});
    world.rateLimitAfter(2);
    const items = Array.from({ length: 4 }, (_, i) => ({ dir: null, name: `f${i}.bin`, size: 2 }));
    const out = (await (await call(p, '/folder/sessions', 'editor-jwt', { file: F1, items })).json()) as { items: { uploadId?: string; error?: string }[] };
    expect(out.items.map((i) => (i.uploadId ? 'ok' : i.error))).toEqual(['ok', 'ok', 'rate', 'rate']);
  });
});

describe('carpetas: ver, nunca hacia arriba', () => {
  async function filled() {
    const s = await setup();
    const tree = await prepare(s.p, { dirs: ['Fotos'] });
    const add = (name: string, parent: string, extra: Partial<DriveItem> = {}) => {
      const key = `added${name.replace(/\W/g, '')}`.padEnd(14, 'x');
      s.world.drive.set(key, { name, mimeType: 'image/jpeg', parents: [parent], data: new Uint8Array([9, 9]), ...extra });
      return key;
    };
    return { ...s, tree, add };
  }

  it('lista primero las carpetas, cada archivo con su pase y su miniatura; quien ve la página lo ve y lo baja', async () => {
    const { p, tree, add } = await filled();
    add('foto 10.jpg', tree.root.id, { thumb: true });
    add('foto 2.jpg', tree.root.id);
    add('borrado.jpg', tree.root.id, { trashed: true });
    const res = await call(p, '/folder/list', 'viewer-jwt', { file: F1 });
    expect(res.status).toBe(200);
    const listed = (await res.json()) as Listed;
    expect(listed.entries.map((e) => `${e.type}:${e.name}`)).toEqual(['folder:Fotos', 'file:foto 2.jpg', 'file:foto 10.jpg']);
    const photo = listed.entries[2]!;
    expect(photo.thumb).toBe(photo.url!.replace('/m/', '/t/'));
    const served = await p.handle(new Request(photo.url!));
    expect(served.status).toBe(200);
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(new Uint8Array([9, 9]));
    const thumb = await p.handle(new Request(photo.thumb!));
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get('Content-Type')).toBe('image/jpeg');
    expect(thumb.headers.get('Content-Security-Policy')).toBe('sandbox');

    // Abrir la subcarpeta.
    add('dentro.jpg', tree.dirs.Fotos!);
    const sub = (await (await call(p, '/folder/list', 'viewer-jwt', { file: F1, dir: tree.dirs.Fotos })).json()) as Listed;
    expect(sub.entries.map((e) => e.name)).toEqual(['dentro.jpg']);
  });

  it('sin acceso a la página no se lista nada; un pase tocado no sirve', async () => {
    const { p } = await filled();
    expect((await call(p, '/folder/list', 'stranger-jwt', { file: F1 })).status).toBe(404);
    expect((await call(p, '/folder/list', null, { file: F1 })).status).toBe(401);
    expect((await p.handle(new Request(`${SELF}/t/abc.def`))).status).toBe(403);
  });

  it('pedir otra carpeta del Drive (la de arriba, una hermana, otra carpeta de la app) da 404 y no muestra nada', async () => {
    const { world, p, tree } = await filled();
    const carpetas = world.drive.get(tree.root.id)!.parents[0]!;
    const sister = 'sisterxxxxxxxxxx';
    world.drive.set(sister, { name: 'Hermana', mimeType: FOLDER, parents: [carpetas] });
    const other = (await (await call(p, '/folder/prepare', 'editor-jwt', { file: F2, name: 'Otra' })).json()) as Prepared;
    for (const dir of [carpetas, sister, other.root.id, 'rootxxxxxxxxxx', 'nadaxxxxxxxxxxx']) {
      const res = await call(p, '/folder/list', 'viewer-jwt', { file: F1, dir });
      expect(res.status).toBe(404);
    }
  });

  it('un acceso directo se muestra sin seguirlo; un documento de Google, sin bajarlo', async () => {
    const { world, p, tree, add } = await filled();
    const carpetas = world.drive.get(tree.root.id)!.parents[0]!;
    const shortcut = add('atajo', tree.root.id, { mimeType: SHORTCUT, data: undefined });
    add('Guion', tree.root.id, { mimeType: 'application/vnd.google-apps.document', data: undefined });
    const listed = (await (await call(p, '/folder/list', 'viewer-jwt', { file: F1 })).json()) as Listed;
    const byName = new Map(listed.entries.map((e) => [e.name, e]));
    expect(byName.get('atajo')).toEqual({ type: 'shortcut', name: 'atajo', modified: '2026-10-01T10:00:00Z' });
    expect(byName.get('Guion')!.url).toBeUndefined();
    // Abrir el acceso directo como si fuera una carpeta no sirve (aunque apunte afuera).
    world.drive.get(shortcut)!.parents = [tree.root.id];
    expect((await call(p, '/folder/list', 'viewer-jwt', { file: F1, dir: shortcut })).status).toBe(404);
    expect(carpetas).toBeTruthy();
  });

  it('una subcarpeta que el dueño movió afuera deja de verse (a más tardar a los 10 minutos); un ciclo no cuelga', async () => {
    const { world, p, tree } = await filled();
    const fotos = tree.dirs.Fotos!;
    expect((await call(p, '/folder/list', 'viewer-jwt', { file: F1, dir: fotos })).status).toBe(200);
    const carpetas = world.drive.get(tree.root.id)!.parents[0]!;
    world.drive.get(fotos)!.parents = [carpetas];
    vi.useFakeTimers({ now: Date.now() + TREE_TTL_MS + 1000, toFake: ['Date'] });
    expect((await call(p, '/folder/list', 'viewer-jwt', { file: F1, dir: fotos })).status).toBe(404);

    // Dos carpetas que se apuntan entre sí (Drive no lo deja, pero el portero no confía).
    world.drive.set('loopaxxxxxxxxxx', { name: 'a', mimeType: FOLDER, parents: ['loopbxxxxxxxxxx'] });
    world.drive.set('loopbxxxxxxxxxx', { name: 'b', mimeType: FOLDER, parents: ['loopaxxxxxxxxxx'] });
    expect((await call(p, '/folder/list', 'viewer-jwt', { file: F1, dir: 'loopaxxxxxxxxxx' })).status).toBe(404);
  });

  it('un pase de la carpeta misma no existe (lo de adentro se lista)', async () => {
    const { world, p, tree } = await filled();
    const pass = await call(p, '/pass', 'viewer-jwt', { file: F1 });
    expect(pass.status).toBe(409);
    expect(((await pass.json()) as { code: string }).code).toBe('is_folder');
    expect(world.drive.get(tree.root.id)!.trashed).toBeFalsy();
  });

  it('el estado dice que este portero sabe de carpetas', async () => {
    const { p } = await setup();
    const status = (await (await call(p, '/drive/status', 'viewer-jwt', undefined, { method: 'GET' })).json()) as { features: string[] };
    expect(status.features).toContain('folders');
  });
});
