import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanFileName, cutText, DRIVE_CALL_BUDGET, driveFolderName, FOLDER_BATCH, LIST_TRUST_MS, Portero, TREE_TTL_MS, validFolderPath, type Env, type Store } from './core';

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
  const base = new Map<string, { name: string; mime: string; size: number; drive_id: string | null; levels: Record<string, number>; created_by?: string | null }>();
  const uploads = new Map<string, { meta: DriveItem; size: number; data: Uint8Array<ArrayBuffer>; got: number }>();
  let n = 0;
  let rateAfter = Infinity;
  let sessionsOpened = 0;
  const calls: string[] = [];
  /** Las consultas `files.list` de carpetas que llegaron (para contar los pedidos a Drive y ver su forma). */
  const listQueries: string[] = [];
  let listFailAfter = -1;
  const tokenQueries = new Map<string, string>();
  const pageTokenFor = (q: string, at: number) => {
    const id = String(tokenQueries.size + 1);
    tokenQueries.set(id, q);
    return `t${id}x${at}`;
  };
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
        return json({ id: args.p_file_id, project_id: PROJECT, project_name: 'Spot Coca', name: f.name, mime: f.mime, size: f.size, drive_id: f.drive_id, created_at: '2026-10-01T10:00:00Z', level, ...(f.created_by !== undefined ? { created_by: f.created_by } : {}) });
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
      const parents = [...q.matchAll(/'([^']+)' in parents/g)].map((m) => m[1]!);
      const mime = /mimeType = '([^']+)'/.exec(q)?.[1];
      const sdFolder = /key='sdFolder' and value='([^']+)'/.exec(q)?.[1];
      const sdFile = /key='sdFile' and value='([^']+)'/.exec(q)?.[1];
      const sdPaths = [...q.matchAll(/key='sdPath' and value='([^']+)'/g)].map((m) => m[1]);
      let list = [...drive.entries()].filter(([, f]) => !f.trashed);
      if (parents.length) list = list.filter(([, f]) => f.parents.some((p) => parents.includes(p)));
      if (parents.length) {
        listQueries.push(q);
        if (listFailAfter >= 0 && listQueries.length > listFailAfter) return json({ error: 'boom' }, 500);
      }
      if (mime) list = list.filter(([, f]) => f.mimeType === mime);
      if (sdFolder) list = list.filter(([, f]) => f.appProperties?.sdFolder === sdFolder);
      if (sdFile) list = list.filter(([, f]) => f.appProperties?.sdFile === sdFile);
      if (sdPaths.length) list = list.filter(([, f]) => sdPaths.includes(f.appProperties?.sdPath ?? ''));
      list.sort(([, a], [, b]) => Number(b.mimeType === FOLDER) - Number(a.mimeType === FOLDER) || a.name.localeCompare(b.name, undefined, { numeric: true }));
      // Paginado como Drive: `pageSize` y un `pageToken` que dice dónde seguir y está atado a la consulta.
      const size = Number(url.searchParams.get('pageSize') ?? 1000);
      const token = url.searchParams.get('pageToken');
      let from = 0;
      if (token) {
        const [id, at] = token.slice(1).split('x');
        if (tokenQueries.get(id!) !== q) return json({ error: 'invalid pageToken' }, 400);
        from = Number(at);
      }
      const more = from + size < list.length;
      return json({ files: list.slice(from, from + size).map(([k, f]) => metaOf(k, f)), ...(more ? { nextPageToken: pageTokenFor(q, from + size) } : {}) });
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
    listQueries,
    /** Después de `count` listados más de carpetas, Drive contesta 500. */
    failListsAfter: (count: number) => (listFailAfter = listQueries.length + count),
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
  it('las carpetas que suelta el usuario no llevan espacios (D3 → B): cada tramo de espacios es un "_" y lo demás queda tal cual', () => {
    expect(driveFolderName('Día 2 - Puerto')).toBe('Día_2_-_Puerto');
    // Dobles y espacios que no son el común: un solo "_" por tramo.
    expect(driveFolderName('Fotos  día 2')).toBe('Fotos_día_2');
    expect(driveFolderName('a\u00A0b\u2003c')).toBe('a_b_c');
    // Tildes, eñes, guiones, signos y emojis: tal cual; los guiones bajos del usuario no se tocan ni se juntan.
    for (const same of ['Ñandú_áéíóú_ÁÉÍÓÚ_ü', '🎬_Rodaje_🌊_toma_1', "Spot_(v2)_&_co,_'final'.", 'Dia_2', 'a__b', '_borrador_']) {
      expect(driveFolderName(same)).toBe(same);
    }
    expect(driveFolderName('Ñandú áéíóú ÁÉÍÓÚ ü')).toBe('Ñandú_áéíóú_ÁÉÍÓÚ_ü');
    expect(driveFolderName('🎬 Rodaje 🌊 toma 1')).toBe('🎬_Rodaje_🌊_toma_1');
    expect(driveFolderName("Spot (v2) & co, 'final'.")).toBe("Spot_(v2)_&_co,_'final'.");
    // Ningún resultado tiene un espacio.
    for (const raw of ['Día 2 - Puerto', ' a  b ', 'x\u00A0y', 'a\u3000b']) expect(driveFolderName(raw)).not.toMatch(/\s/);
    // Lo invisible o que engaña se saca; los bordes, sin espacios.
    expect(driveFolderName('a\tb\nc')).toBe('abc');
    expect(driveFolderName('factura\u202Efdp')).toBe('facturafdp');
    // Como en los archivos (y en la app): el ZWJ se queda entre dos emojis (una familia sigue siendo una); una bandera
    // o un tono de piel no cambian.
    expect(driveFolderName('👨\u200D👩\u200D👧 Familia 🇦🇷 👍🏽')).toBe('👨\u200D👩\u200D👧_Familia_🇦🇷_👍🏽');
    expect(driveFolderName('👩🏽\u200D💻 y ❤\uFE0F\u200D🔥')).toBe('👩🏽\u200D💻_y_❤\uFE0F\u200D🔥');
    // Entre letras, suelto, al principio o al final se saca; el U+200C, siempre.
    expect(driveFolderName('a\u200Db')).toBe('ab');
    expect(driveFolderName('\u200D👨 y 👨\u200D')).toBe('👨_y_👨');
    expect(driveFolderName('👨\u200C\u200D👩')).toBe('👨\u200D👩'); // sin el U+200C, el ZWJ queda entre dos emojis
    expect(driveFolderName('👨\u200C👩')).toBe('👨👩');
    expect(driveFolderName('x\u200D👨 a\u200D👩')).toBe('x👨_a👩');
    // Los espacios de los bordes se sacan: nunca queda un "_" al principio ni al final por ellos.
    expect(driveFolderName('  Fotos  ')).toBe('Fotos');
    expect(driveFolderName(' Día 2 ')).toBe('Día_2');
    // Una letra con su tilde aparte (como las da la Mac) queda en una sola.
    expect(driveFolderName('Di\u0301a 2')).toBe('Día_2');
    // Vacío, solo espacios o solo marcas: "Folder".
    for (const empty of ['', '   ', ' \u202E ', '\u200B\u2066']) expect(driveFolderName(empty)).toBe('Folder');
    expect(driveFolderName(' \u202E ')).toBe('Folder');
    expect(driveFolderName('a\u0000b')).toBe('ab');
  });

  it('las barras van como "_" y el nombre se corta en 200 caracteres sin partir un emoji ni dejar un "_" al final', () => {
    expect(driveFolderName('a/b')).toBe('a_b');
    expect(driveFolderName('Fotos \\ día 2')).toBe('Fotos___día_2');
    expect(driveFolderName('x'.repeat(300))).toBe('x'.repeat(200));
    expect(driveFolderName('x'.repeat(290) + '.final')).toBe('x'.repeat(200));
    expect(driveFolderName('🎬'.repeat(300))).toBe('🎬'.repeat(200));
    expect(driveFolderName('x'.repeat(199) + ' yyy')).toBe('x'.repeat(199));
    // Con espacios adentro: cuenta el nombre original (los tramos largos se achican a un "_"), nunca pasa de 200.
    const long = driveFolderName('ab '.repeat(100));
    expect(long).toBe('ab_'.repeat(66) + 'ab');
    expect(Array.from(long).length).toBeLessThanOrEqual(200);
    expect(driveFolderName('x'.repeat(199) + '   ' + 'y'.repeat(50))).toBe('x'.repeat(199));
  });

  it('el corte de 200 no parte una bandera ni le saca el tono a un emoji (por grafema, sin pasar 200 caracteres)', () => {
    // Antes, por punto de código: quedaba media bandera (una letra regional suelta) o la mano sin su tono.
    expect(driveFolderName('x'.repeat(199) + '🇦🇷')).toBe('x'.repeat(199));
    expect(driveFolderName('x'.repeat(198) + '🇦🇷🇦🇷')).toBe('x'.repeat(198) + '🇦🇷');
    expect(driveFolderName('x'.repeat(199) + '👍🏽')).toBe('x'.repeat(199));
    expect(cutText('dí', 2)).toBe('d');
    expect(cutText('abc', 0)).toBe('');
    // El nombre de un archivo (el del pase, 255) también, y conserva la extensión.
    const name = cleanFileName('a'.repeat(250) + '🇦🇷🇦🇷🇦🇷.mov');
    expect(name).toBe('a'.repeat(250) + '.mov');
    expect(cleanFileName('a'.repeat(249) + '🇦🇷🇦🇷.mov')).toBe('a'.repeat(249) + '🇦🇷.mov');
    expect(cleanFileName('a'.repeat(248) + '🇦🇷🇦🇷.mov')).toBe('a'.repeat(248) + '🇦🇷.mov');
  });

  it('una ruta no puede subir ni empezar con barra', () => {
    expect(validFolderPath('Fotos/Dia 2')).toBe(true);
    for (const bad of ['', '/Fotos', 'Fotos/', 'a//b', '..', 'a/../b', './a', 1]) expect(validFolderPath(bad)).toBe(false);
    // Una barra invertida es parte del nombre (Mac, Linux): vale, y en Drive va "_".
    expect(validFolderPath('Raras/a\\b')).toBe(true);
    expect(driveFolderName('a\\b')).toBe('a_b');
    expect(validFolderPath(Array.from({ length: 31 }, () => 'x').join('/'))).toBe(false);
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

  it('una carpeta soltada queda sin espacios (guiones bajos), y sus subcarpetas también, igual que las que crea la app', async () => {
    const { world, p } = await setup();
    world.base.get(F1)!.name = 'Día 2 - Puerto';
    const dirs = ['Fotos de set', 'Fotos de set/Día 2', 'Fotos de set/Día 2/🎬 Toma 1', 'Notas  (borrador)'];
    const tree = await prepare(p, { name: 'Día 2 - Puerto', dirs });
    expect(world.drive.get(tree.root.id)!.name).toBe('Día_2_-_Puerto');
    expect(tree.root.name).toBe('Día_2_-_Puerto');
    expect(dirs.map((d) => world.drive.get(tree.dirs[d]!)!.name)).toEqual(['Fotos_de_set', 'Día_2', '🎬_Toma_1', 'Notas_(borrador)']);
    // Retomar (la respuesta se perdió) no duplica nada: se encuentra por la marca.
    const folders = () => [...world.drive.values()].filter((f) => f.mimeType === FOLDER).length;
    const before = folders();
    expect(await prepare(p, { name: 'Día 2 - Puerto', dirs })).toEqual(tree);
    expect(folders()).toBe(before);
    const carpetas = world.drive.get(world.drive.get(tree.root.id)!.parents[0]!)!;
    expect(carpetas.name).toBe('Carpetas');
    // La del proyecto ("Spot Coca") y la de la app, como siempre.
    const project = world.drive.get(carpetas.parents[0]!)!;
    expect(project.name).toBe('Spot_Coca');
    expect(world.drive.get(project.parents[0]!)!.name).toBe('LGA_ShotDocs');
  });

  it('otra con el mismo nombre (sin distinguir mayúsculas) va con _2; una de v0.089 con espacios no choca ni se renombra', async () => {
    const { world, p } = await setup();
    const a = await prepare(p, { name: 'Día 2 - Puerto' });
    const b = (await (await call(p, '/folder/prepare', 'editor-jwt', { file: F2, name: 'día 2 - PUERTO' })).json()) as Prepared;
    expect(world.drive.get(a.root.id)!.name).toBe('Día_2_-_Puerto');
    expect(b.root.name).toBe('día_2_-_PUERTO_2');
    // Una subida de entre v0.089 y esta versión quedó como "Fotos rodaje": "Fotos_rodaje" es otro nombre y no lleva _2; la vieja sigue como estaba.
    const carpetas = world.drive.get(a.root.id)!.parents[0]!;
    world.drive.set('oldfolderxxxxxxx', { name: 'Fotos rodaje', mimeType: FOLDER, parents: [carpetas], appProperties: { sdFile: 'otra' } });
    world.base.set(PHOTO, { name: 'Fotos rodaje', mime: 'inode/directory', size: 10, drive_id: null, levels: { 'u-editor': 3 } });
    const c = (await (await call(p, '/folder/prepare', 'editor-jwt', { file: PHOTO, name: 'Fotos rodaje' })).json()) as Prepared;
    expect(c.root.name).toBe('Fotos_rodaje');
    expect(world.drive.get('oldfolderxxxxxxx')!.name).toBe('Fotos rodaje');
  });

  it('una subida de v0.089 a v0.127, con espacios, se retoma sin renombrar nada ni crear carpetas de más; lo nuevo va con guiones bajos', async () => {
    const { world, store, p } = await setup();
    const dirs = ['Fotos', 'Fotos/Dia 2', 'Fotos/Dia 2/Toma 1'];
    const first = await prepare(p, { name: 'Dia 2 - Puerto', dirs });
    // Lo que dejó la versión anterior del portero: los mismos ids y marcas (la marca sale de la ruta, no del
    // nombre), con los nombres de entonces: con espacios.
    const old: Record<string, string> = { '': 'Dia 2 - Puerto', Fotos: 'Fotos', 'Fotos/Dia 2': 'Dia 2', 'Fotos/Dia 2/Toma 1': 'Toma 1' };
    world.drive.get(first.root.id)!.name = old['']!;
    for (const d of dirs) world.drive.get(first.dirs[d]!)!.name = old[d]!;
    const rec = store.data.get(`file:${F1}`) as { drive: { name: string } };
    rec.drive.name = old['']!;
    const folders = () => [...world.drive.values()].filter((f) => f.mimeType === FOLDER).length;
    const before = folders();

    // Se vuelve a soltar la carpeta: la app manda las mismas rutas (perdió los ids) y una subcarpeta nueva.
    const again = await prepare(p, { name: 'Dia 2 - Puerto', dirs: [...dirs, 'Fotos/Dia 2/Toma 2'] });
    expect(again.root).toEqual({ id: first.root.id, name: 'Dia 2 - Puerto' });
    for (const d of dirs) expect(again.dirs[d]).toBe(first.dirs[d]);
    expect(folders()).toBe(before + 1);
    // Nada se renombró; la nueva va adentro de la vieja, y ella sí sin espacios.
    expect(world.drive.get(first.root.id)!.name).toBe('Dia 2 - Puerto');
    for (const d of dirs) expect(world.drive.get(first.dirs[d]!)!.name).toBe(old[d]);
    expect(world.drive.get(again.dirs['Fotos/Dia 2/Toma 2']!)).toMatchObject({ name: 'Toma_2', parents: [first.dirs['Fotos/Dia 2']] });

    // Con los ids que la app guardó, una tanda que sigue abajo de una vieja también va adentro de la vieja.
    const next = await prepare(p, { dirs: ['Fotos/Dia 2/Toma 1/Raw'], parents: { 'Fotos/Dia 2/Toma 1': first.dirs['Fotos/Dia 2/Toma 1'] } });
    expect(world.drive.get(next.dirs['Fotos/Dia 2/Toma 1/Raw']!)!.parents).toEqual([first.dirs['Fotos/Dia 2/Toma 1']]);
    // Y los archivos que faltaban suben a la subcarpeta vieja (los archivos conservan su nombre: D3 solo toca carpetas).
    const res = await call(p, '/folder/sessions', 'editor-jwt', { file: F1, items: [{ dir: first.dirs['Fotos/Dia 2'], name: 'b 2.jpg', mime: 'image/jpeg', size: 0 }] });
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as { items: { done?: { id: string } }[] };
    expect(world.drive.get(items[0]!.done!.id)).toMatchObject({ name: 'b 2.jpg', parents: [first.dirs['Fotos/Dia 2']] });
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

describe('carpetas: la instancia', () => {
  it('cada pedido trae su Store (como index.ts) y lo comprobado se comparte por la llave de memoria', async () => {
    const { world, store, p } = await setup();
    const tree = await prepare(p, { dirs: ['Fotos'] });
    const memoryKey = {};
    const fresh = () => new Portero(env, { ...store, memoryKey }, world.http);
    expect((await call(fresh(), '/folder/list', 'viewer-jwt', { file: F1, dir: tree.dirs.Fotos })).status).toBe(200);
    // Otro pedido, otro Store, la misma llave: no vuelve a subir por los padres de "Fotos" (solo mira la subcarpeta).
    const before = world.calls.filter((c) => c.startsWith('GET www.googleapis.com/drive/v3/files/')).length;
    expect((await call(fresh(), '/folder/list', 'viewer-jwt', { file: F1, dir: tree.dirs.Fotos })).status).toBe(200);
    const metaGets = world.calls.filter((c) => c.startsWith('GET www.googleapis.com/drive/v3/files/')).length - before;
    expect(metaGets).toBeLessThanOrEqual(2);
  });
});

describe('carpetas: quién sube', () => {
  it('perder el permiso deja la subida sin terminar: la última parte vuelve a mirar', async () => {
    const { world, p } = await setup();
    await prepare(p, {});
    const { items } = (await (await call(p, '/folder/sessions', 'editor-jwt', { file: F1, items: [{ dir: null, name: 'a.bin', size: 4 }] })).json()) as {
      items: { uploadId: string }[];
    };
    const part = (from: number, to: number) =>
      call(p, `/upload/${items[0]!.uploadId}`, 'editor-jwt', undefined, {
        method: 'PUT',
        headers: { 'Content-Range': `bytes ${from}-${to}/4` },
        body: new Uint8Array(to - from + 1),
      });
    expect((await part(0, 1)).status).toBe(200);
    world.base.get(F1)!.levels['u-editor'] = 0;
    expect((await part(2, 3)).status).toBe(404);
    expect([...world.drive.values()].some((f) => f.name === 'a.bin')).toBe(false);
  });

  it('un tipo de Google (carpeta, documento) no se crea por las subidas', async () => {
    const { world, p } = await setup();
    await prepare(p, {});
    const res = await call(p, '/folder/sessions', 'editor-jwt', {
      file: F1,
      items: [{ dir: null, name: 'falsa', mime: 'application/vnd.google-apps.folder', size: 0 }],
    });
    const { items } = (await res.json()) as { items: { done?: { id: string } }[] };
    expect(world.drive.get(items[0]!.done!.id)!.mimeType).toBe('application/octet-stream');
  });

  it('una subcarpeta mandada a la papelera deja de listarse en el acto', async () => {
    const { world, p } = await setup();
    const tree = await prepare(p, { dirs: ['Fotos'] });
    expect((await call(p, '/folder/list', 'viewer-jwt', { file: F1, dir: tree.dirs.Fotos })).status).toBe(200);
    world.drive.get(tree.dirs.Fotos!)!.trashed = true;
    expect((await call(p, '/folder/list', 'viewer-jwt', { file: F1, dir: tree.dirs.Fotos })).status).toBe(404);
  });

  it('una subcarpeta con barra invertida en el nombre se crea, con "_"', async () => {
    const { world, p } = await setup();
    const tree = await prepare(p, { dirs: ['a\\b'] });
    expect(world.drive.get(tree.dirs['a\\b']!)!.name).toBe('a_b');
  });

  it('solo quien la creó sube adentro, aunque otro llegue a editarla pegando su bloque en una página propia', async () => {
    const { world, p } = await setup();
    const tree = await prepare(p, { dirs: ['Fotos'] });
    // El de "Ver" pega la carpeta en una página donde edita: la base le da nivel 3 sobre la carpeta.
    world.base.get(F1)!.levels['u-viewer'] = 3;
    for (const jwt of ['viewer-jwt', 'owner-jwt']) {
      const prep = await call(p, '/folder/prepare', jwt, { file: F1, dirs: ['x'] });
      expect(prep.status).toBe(403);
      expect(((await prep.json()) as { code: string }).code).toBe('not_creator');
      const sess = await call(p, '/folder/sessions', jwt, { file: F1, items: [{ dir: tree.dirs.Fotos, name: 'x.bin', size: 1 }] });
      expect(sess.status).toBe(403);
    }
    // Ver, sí.
    expect((await call(p, '/folder/list', 'viewer-jwt', { file: F1 })).status).toBe(200);
    expect([...world.drive.values()].some((f) => f.name === 'x' || f.name === 'x.bin')).toBe(false);
  });

  it('con la base que dice quién la agregó, nadie más la crea ni sube, ni siquiera primero', async () => {
    const { world, p } = await setup();
    world.base.get(F1)!.created_by = 'u-editor';
    world.base.get(F1)!.levels['u-viewer'] = 3;
    // El de "Ver" (con nivel 3 por pegarla en su página) se adelanta: no la crea.
    const first = await call(p, '/folder/prepare', 'viewer-jwt', { file: F1, name: 'x' });
    expect(first.status).toBe(403);
    expect([...world.drive.values()].some((f) => f.appProperties?.sdFile === F1)).toBe(false);
    // Quien la agregó, sí; y después tampoco sube el otro.
    const tree = await prepare(p, { dirs: ['Fotos'] });
    expect((await call(p, '/folder/sessions', 'viewer-jwt', { file: F1, items: [{ dir: tree.dirs.Fotos, name: 'x.bin', size: 1 }] })).status).toBe(403);
    // Una cuenta borrada (created_by vacío): nadie sube.
    world.base.get(F1)!.created_by = null;
    expect((await call(p, '/folder/sessions', 'editor-jwt', { file: F1, items: [{ dir: null, name: 'x.bin', size: 1 }] })).status).toBe(403);
  });

  it('si otra instancia ya la creó (dos pedidos a la vez), se encuentra por su marca y no se crea otra', async () => {
    const { world, store, p } = await setup();
    // Otra instancia creó la carpeta en Drive y todavía no anotó nada (ni acá ni en la base).
    const first = await prepare(p, {});
    store.data.delete(`file:${F1}`);
    world.base.get(F1)!.drive_id = null;
    const again = await prepare(p, {});
    expect(again.root.id).toBe(first.root.id);
    expect([...world.drive.values()].filter((f) => f.appProperties?.sdFile === F1)).toHaveLength(1);
  });

  it('una carpeta no se sube como un archivo (/upload) ni da un pase', async () => {
    const { p } = await setup();
    await prepare(p, {});
    const up = await call(p, '/upload', 'editor-jwt', { file: F1, name: 'x', mime: 'inode/directory', size: 10 });
    expect(up.status).toBe(409);
    expect(((await up.json()) as { code: string }).code).toBe('is_folder');
  });

  it('como subcarpeta no sirve un archivo, una carpeta en la papelera, una con dos padres ni una de otra carpeta de la app', async () => {
    const { world, p } = await setup();
    const tree = await prepare(p, { dirs: ['Fotos', 'Viejas', 'Dos'] });
    const file = 'afilexxxxxxxxxxxx';
    world.drive.set(file, { name: 'a.jpg', mimeType: 'image/jpeg', parents: [tree.root.id], data: new Uint8Array([1]) });
    world.drive.get(tree.dirs.Viejas!)!.trashed = true;
    world.drive.get(tree.dirs.Dos!)!.parents = [tree.root.id, 'otherparentxxxx'];
    const other = (await (await call(p, '/folder/prepare', 'editor-jwt', { file: F2, name: 'Otra', dirs: ['Sub'] })).json()) as Prepared;
    vi.useFakeTimers({ now: Date.now() + TREE_TTL_MS + 1000, toFake: ['Date'] });
    for (const dir of [file, tree.dirs.Viejas, tree.dirs.Dos, other.dirs.Sub]) {
      expect((await call(p, '/folder/list', 'viewer-jwt', { file: F1, dir })).status).toBe(404);
      const sess = await call(p, '/folder/sessions', 'editor-jwt', { file: F1, items: [{ dir, name: 'x.bin', size: 1 }] });
      expect(sess.status).toBe(403);
    }
  });

  it('un pase vencido no da la miniatura', async () => {
    const { world, p } = await setup();
    const tree = await prepare(p, {});
    world.drive.set('photoxxxxxxxxxxx', { name: 'f.jpg', mimeType: 'image/jpeg', parents: [tree.root.id], data: new Uint8Array([1, 2]), thumb: true });
    const listed = (await (await call(p, '/folder/list', 'viewer-jwt', { file: F1 })).json()) as Listed;
    const thumb = listed.entries.find((e) => e.name === 'f.jpg')!.thumb!;
    expect((await p.handle(new Request(thumb))).status).toBe(200);
    vi.useFakeTimers({ now: Date.now() + 9 * 3600_000, toFake: ['Date'] });
    expect((await p.handle(new Request(thumb))).status).toBe(403);
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

  it('Download all: la app lee cada archivo de la lista con fetch (CORS en /m/ y /t/ solo para su origen)', async () => {
    const { p, tree, add } = await filled();
    add('foto.jpg', tree.root.id, { thumb: true });
    const listed = (await (await call(p, '/folder/list', 'viewer-jwt', { file: F1 })).json()) as Listed;
    const photo = listed.entries.find((e) => e.name === 'foto.jpg')!;
    // Desde la app: el origen habilitado y los encabezados que lee el zip (el peso, la parte, el nombre).
    const ok = await p.handle(new Request(photo.url!, { headers: { Origin: APP } }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(APP);
    expect(ok.headers.get('Vary')).toContain('Origin');
    const exposed = (ok.headers.get('Access-Control-Expose-Headers') ?? '').split(/,\s*/);
    expect(exposed).toEqual(expect.arrayContaining(['Content-Length', 'Content-Range', 'Content-Disposition']));
    expect(ok.headers.get('Content-Length')).toBe('2');
    // Retomar a la mitad (Range, 206) lleva lo mismo: lo prueba core.test.ts ("GET desde la app").
    // Otro origen: el navegador no le deja leer nada (sin la cabecera), ni en el archivo, ni en la miniatura, ni en
    // el preflight.
    for (const origin of ['https://evil.example', 'https://app.example.evil.example', 'null']) {
      const evil = await p.handle(new Request(photo.url!, { headers: { Origin: origin } }));
      expect(evil.headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect(evil.headers.get('Access-Control-Expose-Headers')).toBeNull();
      expect(evil.headers.get('Vary')).toContain('Origin');
      const thumb = await p.handle(new Request(photo.thumb!, { headers: { Origin: origin } }));
      expect(thumb.headers.get('Access-Control-Allow-Origin')).toBeNull();
      const pre = await p.handle(
        new Request(photo.url!, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'range' } }),
      );
      expect(pre.headers.get('Access-Control-Allow-Origin')).toBeNull();
    }
    const appThumb = await p.handle(new Request(photo.thumb!, { headers: { Origin: APP } }));
    expect(appThumb.headers.get('Access-Control-Allow-Origin')).toBe(APP);
  });

  it('Download all: lo de una subcarpeta lo baja quien ve la página; quien no, ni lista ni recibe pases', async () => {
    const { p, tree, add } = await filled();
    add('dentro.jpg', tree.dirs.Fotos!);
    const sub = (await (await call(p, '/folder/list', 'viewer-jwt', { file: F1, dir: tree.dirs.Fotos })).json()) as Listed;
    const file = sub.entries.find((e) => e.name === 'dentro.jpg')!;
    expect((await p.handle(new Request(file.url!, { headers: { Origin: APP } }))).status).toBe(200);
    for (const jwt of ['stranger-jwt', null]) {
      const res = await call(p, '/folder/list', jwt, { file: F1, dir: tree.dirs.Fotos });
      expect([401, 404]).toContain(res.status);
      expect(JSON.stringify(await res.json())).not.toContain('/m/');
    }
  });

  it('el estado dice que este portero sabe de carpetas', async () => {
    const { p } = await setup();
    const status = (await (await call(p, '/drive/status', 'viewer-jwt', undefined, { method: 'GET' })).json()) as { features: string[] };
    expect(status.features).toContain('folders');
  });
});

describe('carpetas: listar varias subcarpetas de una vez (dirs)', () => {
  type Many = { lists: Record<string, { type: string; id?: string; name: string; url?: string }[]>; failed: Record<string, string>; later: string[]; nextPageToken: string | null };

  async function many() {
    const s = await setup();
    const names = Array.from({ length: 5 }, (_, i) => `D${i}`);
    const tree = await prepare(s.p, { dirs: names });
    let n = 0;
    const add = (name: string, parents: string[], extra: Partial<DriveItem> = {}) => {
      const key = `m${++n}${name.replace(/\W/g, '')}`.padEnd(14, 'x');
      s.world.drive.set(key, { name, mimeType: 'image/jpeg', parents, data: new Uint8Array([7]), ...extra });
      return key;
    };
    const ids = names.map((d) => tree.dirs[d]!);
    // Como en producción, un `Portero` nuevo por pedido (con su cuenta de llamados a Drive en cero) y la misma memoria.
    const fresh = () => new Portero(env, s.store, s.world.http);
    const ask = async (body: Record<string, unknown>, jwt = 'viewer-jwt', portero: Portero = fresh()) => call(portero, '/folder/list', jwt, { file: F1, ...body });
    const askOk = async (body: Record<string, unknown>, jwt = 'viewer-jwt', portero: Portero = fresh()) => {
      const res = await ask(body, jwt, portero);
      expect(res.status).toBe(200);
      return (await res.json()) as Many;
    };
    /** Los listados de carpetas que le llegaron a Drive desde `from`. */
    const listsSince = (from: number) => s.world.listQueries.length - from;
    return { ...s, tree, add, ids, ask, askOk, listsSince, names };
  }

  it('una sola consulta a Drive para varias subcarpetas, agrupada por padre, con el pase de cada archivo', async () => {
    const { world, ids, add, askOk, listsSince } = await many();
    add('a.jpg', [ids[0]!]);
    add('b.jpg', [ids[1]!]);
    add('c.jpg', [ids[1]!]);
    add('en-d3.jpg', [ids[3]!]);
    const before = world.listQueries.length;
    const out = await askOk({ dirs: [ids[1]!, ids[0]!, ids[2]!] });
    // Un solo listado a Drive, con un `or` entre los padres (en orden, siempre el mismo) y sin la papelera.
    expect(listsSince(before)).toBe(1);
    const q = world.listQueries.at(-1)!;
    expect(q).toBe(`(${[...[ids[0]!, ids[1]!, ids[2]!].sort()].map((d) => `'${d}' in parents`).join(' or ')}) and trashed = false`);
    expect(Object.keys(out.lists).sort()).toEqual([ids[0]!, ids[1]!, ids[2]!].sort());
    expect(out.lists[ids[0]!]!.map((e) => e.name)).toEqual(['a.jpg']);
    expect(out.lists[ids[1]!]!.map((e) => e.name)).toEqual(['b.jpg', 'c.jpg']);
    expect(out.lists[ids[2]!]).toEqual([]);
    expect(JSON.stringify(out)).not.toContain('en-d3');
    expect(out.failed).toEqual({});
    expect(out.later).toEqual([]);
    expect(out.nextPageToken).toBeNull();
    for (const e of out.lists[ids[1]!]!) expect(e.url).toMatch(/^https:\/\/portero\.example\/m\//);
  });

  it('compatible hacia atrás: dir (o nada) responde igual que antes, con entries', async () => {
    const { ids, add, tree, ask } = await many();
    add('a.jpg', [ids[0]!]);
    const one = (await (await ask({ dir: ids[0] })).json()) as { entries: { name: string }[]; nextPageToken: string | null; lists?: unknown };
    expect(one.entries.map((e) => e.name)).toEqual(['a.jpg']);
    expect(one.lists).toBeUndefined();
    const root = (await (await ask({})).json()) as { entries: { name: string }[] };
    expect(root.entries.map((e) => e.name)).toEqual(['D0', 'D1', 'D2', 'D3', 'D4']);
    expect(tree.dirs.D0).toBe(ids[0]);
  });

  it('pagina con nextPageToken (100 por pedido en total), sin repetir ni perder nada, con los padres mezclados', async () => {
    const { world, ids, add, askOk } = await many();
    for (let i = 0; i < 130; i++) add(`f${String(i).padStart(3, '0')}.jpg`, [ids[i % 2]!]);
    add('solo.jpg', [ids[2]!]);
    // Una cosa con dos padres (de antes de 2020): sale en las dos.
    add('doble.jpg', [ids[0]!, ids[1]!]);
    const dirs = [ids[0]!, ids[1]!, ids[2]!];
    const got: Record<string, string[]> = { [ids[0]!]: [], [ids[1]!]: [], [ids[2]!]: [] };
    let token: string | null = null;
    let pages = 0;
    const before = world.listQueries.length;
    do {
      const out: Many = await askOk({ dirs, pageToken: token });
      pages++;
      // Una página trae a lo sumo 100 cosas (un pase firmado cada una); la misma consulta en cada página.
      expect(Object.values(out.lists).flat().length).toBeLessThanOrEqual(100 + 1);
      for (const [d, list] of Object.entries(out.lists)) got[d]!.push(...list.map((e) => e.name));
      token = out.nextPageToken;
    } while (token && pages < 10);
    expect(pages).toBe(2);
    expect(world.listQueries.length - before).toBe(2);
    expect(new Set(world.listQueries.slice(before)).size).toBe(1);
    const expected = (k: number) => Array.from({ length: 130 }, (_, i) => i).filter((i) => i % 2 === k).map((i) => `f${String(i).padStart(3, '0')}.jpg`);
    expect(got[ids[0]!]!.filter((n) => n !== 'doble.jpg')).toEqual(expected(0));
    expect(got[ids[1]!]!.filter((n) => n !== 'doble.jpg')).toEqual(expected(1));
    expect(got[ids[2]!]).toEqual(['solo.jpg']);
    expect(got[ids[0]!]!.filter((n) => n === 'doble.jpg')).toHaveLength(1);
    expect(got[ids[1]!]!.filter((n) => n === 'doble.jpg')).toHaveLength(1);
  });

  it('las subcarpetas de adentro salen con su id y se pueden listar enseguida en otro pedido', async () => {
    const { world, ids, add, askOk } = await many();
    const sub = add('Hija', [ids[0]!], { mimeType: FOLDER, data: undefined });
    add('nieta.jpg', [sub]);
    const first = await askOk({ dirs: [ids[0]!] });
    expect(first.lists[ids[0]!]).toEqual([{ type: 'folder', id: sub, name: 'Hija', modified: '2026-10-01T10:00:00Z' }]);
    const gets = world.calls.length;
    const second = await askOk({ dirs: [sub] });
    expect(second.lists[sub]!.map((e) => e.name)).toEqual(['nieta.jpg']);
    // La comprobó recién el listado de arriba: ni una consulta a Drive más que el propio listado.
    expect(world.calls.slice(gets).filter((c) => c.includes('www.googleapis.com'))).toEqual(['GET www.googleapis.com/drive/v3/files']);
  });

  it('lo de afuera del árbol (la de arriba, una hermana, otra carpeta de la app, un archivo, un atajo, la papelera) falla con not_found y no muestra nada', async () => {
    const { world, p, ids, add, tree, askOk, listsSince } = await many();
    const carpetas = world.drive.get(tree.root.id)!.parents[0]!;
    const sister = 'sisterxxxxxxxxxx';
    world.drive.set(sister, { name: 'Hermana secreta', mimeType: FOLDER, parents: [carpetas] });
    world.drive.set('secretoxxxxxxxx', { name: 'secreto.jpg', mimeType: 'image/jpeg', parents: [sister], data: new Uint8Array([1]) });
    const other = (await (await call(p, '/folder/prepare', 'editor-jwt', { file: F2, name: 'Otra' })).json()) as Prepared;
    const file = add('x.jpg', [ids[0]!]);
    const shortcut = add('atajo', [ids[0]!], { mimeType: SHORTCUT, data: undefined });
    const trashed = add('Borrada', [ids[0]!], { mimeType: FOLDER, data: undefined, trashed: true });
    const bad = [carpetas, sister, other.root.id, 'rootxxxxxxxxxx', 'nadaxxxxxxxxxxx', file, shortcut, trashed];
    // Una sola buena adentro: el listado sale solo con ella.
    const before = world.listQueries.length;
    const out = await askOk({ dirs: [ids[0]!, ...bad] });
    expect(Object.keys(out.lists)).toEqual([ids[0]!]);
    expect(listsSince(before)).toBe(1);
    // Las de afuera tardan varios llamados cada una (suben por los padres): las que no entran vuelven como `later`.
    let failed = out.failed;
    let pending = out.later;
    for (let i = 0; i < 6 && pending.length; i++) {
      const next = await askOk({ dirs: pending });
      expect(next.lists).toEqual({});
      failed = { ...failed, ...next.failed };
      pending = next.later;
    }
    expect(pending).toEqual([]);
    expect(Object.keys(failed).sort()).toEqual([...bad].sort());
    expect(Object.values(failed).every((c) => c === 'not_found')).toBe(true);
    expect(JSON.stringify([out, failed])).not.toMatch(/secret|Hermana|Otra/);
    // Todas malas: ni siquiera se le pregunta a Drive qué hay adentro.
    const mid = world.listQueries.length;
    const none = await askOk({ dirs: bad.slice(0, 3) });
    expect(none.lists).toEqual({});
    expect(Object.keys(none.failed).length + none.later.length).toBe(3);
    expect(none.nextPageToken).toBeNull();
    expect(listsSince(mid)).toBe(0);
  });

  it('0 resultados: una subcarpeta vacía sale con []', async () => {
    const { ids, askOk } = await many();
    const out = await askOk({ dirs: [ids[4]!] });
    expect(out).toEqual({ lists: { [ids[4]!]: [] }, failed: {}, later: [], nextPageToken: null });
  });

  it('pide ver (nivel 1): sin sesión 401, sin acceso a la página 404, y quien solo ve la lista; con dir y dirs a la vez, 400', async () => {
    const { p, ids, ask, askOk } = await many();
    expect((await ask({ dirs: [ids[0]!] }, 'stranger-jwt')).status).toBe(404);
    expect((await call(p, '/folder/list', null, { file: F1, dirs: [ids[0]!] })).status).toBe(401);
    expect(Object.keys((await askOk({ dirs: [ids[0]!] }, 'viewer-jwt')).lists)).toEqual([ids[0]!]);
    const both = await ask({ dir: ids[0], dirs: [ids[1]!] });
    expect(both.status).toBe(400);
  });

  it('valida la lista: vacía, de más de 40, algo que no es un id o que no es una lista dan 400; las repetidas cuentan una vez', async () => {
    const { ids, ask, askOk, world } = await many();
    for (const dirs of [[], Array.from({ length: 41 }, (_, i) => `id${i}`.padEnd(14, 'x')), ['corto'], [123], 'abc', { a: 1 }, [ids[0]!, null]]) {
      const res = await ask({ dirs });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe('bad_request');
    }
    const before = world.listQueries.length;
    const out = await askOk({ dirs: [ids[0]!, ids[0]!, ids[0]!] });
    expect(Object.keys(out.lists)).toEqual([ids[0]!]);
    expect(world.listQueries.length - before).toBe(1);
    // 40 justas se aceptan.
    const forty = Array.from({ length: 40 }, (_, i) => `nope${i}`.padEnd(14, 'x'));
    const res = await ask({ dirs: forty });
    expect(res.status).toBe(200);
    const decided = (await res.json()) as Many;
    expect(Object.keys(decided.failed).length + decided.later.length).toBe(40);
  });

  it('un error de Drive en una página corta el pedido; Drive que pide ir más despacio sale como rate', async () => {
    const { world, store, ids, add, ask, askOk } = await many();
    for (let i = 0; i < 150; i++) add(`g${String(i).padStart(3, '0')}.jpg`, [ids[0]!]);
    const first = await askOk({ dirs: [ids[0]!] });
    expect(first.nextPageToken).toBeTruthy();
    world.failListsAfter(0);
    const res = await ask({ dirs: [ids[0]!], pageToken: first.nextPageToken });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { code: string }).code).toBe('drive_failed');
    // Drive pide ir más despacio (429): `rate`, y la app espera y repite.
    const slow = new Portero(env, store, ((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes('pageSize') ? Promise.resolve(new Response('{}', { status: 429 })) : world.http(input, init)) as typeof fetch);
    const limited = await ask({ dirs: [ids[0]!] }, 'viewer-jwt', slow);
    expect(limited.status).toBe(503);
    expect(((await limited.json()) as { code: string }).code).toBe('rate');
  });

  it('con un pageToken, una subcarpeta que ya no se puede comprobar corta con 409 changed (la app empieza de nuevo)', async () => {
    const { world, ids, add, tree, ask, askOk } = await many();
    for (let i = 0; i < 150; i++) add(`h${String(i).padStart(3, '0')}.jpg`, [ids[0]!]);
    const first = await askOk({ dirs: [ids[0]!, ids[1]!] });
    expect(first.nextPageToken).toBeTruthy();
    // El dueño la mueve afuera y pasan más de 10 minutos.
    const carpetas = world.drive.get(tree.root.id)!.parents[0]!;
    world.drive.get(ids[1]!)!.parents = [carpetas];
    vi.useFakeTimers({ now: Date.now() + TREE_TTL_MS + 1000, toFake: ['Date'] });
    const res = await ask({ dirs: [ids[0]!, ids[1]!], pageToken: first.nextPageToken });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('changed');
    // Empezar de nuevo: la de afuera falla, la otra sigue.
    const again = await askOk({ dirs: [ids[0]!, ids[1]!] });
    expect(Object.keys(again.lists)).toEqual([ids[0]!]);
    expect(again.failed).toEqual({ [ids[1]!]: 'not_found' });
  });

  it('el tope de llamados a Drive: lo que no entra vuelve como later y cada pedido avanza al menos una', async () => {
    const { world, store } = await setup();
    const names = Array.from({ length: 40 }, (_, i) => `n${i}`);
    const made: Record<string, string> = {};
    for (let round = 0; round < 6 && Object.keys(made).length < names.length; round++) {
      const batch = names.filter((d) => !(d in made)).slice(0, FOLDER_BATCH);
      const res = await call(new Portero(env, { ...store }, world.http), '/folder/prepare', 'editor-jwt', { file: F1, name: 'Referencias', dirs: batch, parents: {} });
      Object.assign(made, ((await res.json()) as Prepared).dirs);
    }
    expect(Object.keys(made)).toHaveLength(40);
    const all = names.map((d) => made[d]!);
    // Una instancia nueva (sin nada comprobado en memoria): cada subcarpeta cuesta un llamado a Drive.
    let pending = all;
    let requests = 0;
    const listed = new Set<string>();
    while (pending.length && requests < 6) {
      const before = world.calls.filter((c) => c.includes('googleapis')).length;
      const res = await call(new Portero(env, { ...store }, world.http), '/folder/list', 'viewer-jwt', { file: F1, dirs: pending });
      expect(res.status).toBe(200);
      const out = (await res.json()) as Many;
      const used = world.calls.filter((c) => c.includes('googleapis')).length - before;
      expect(used).toBeLessThanOrEqual(DRIVE_CALL_BUDGET + 4);
      requests++;
      const accepted = Object.keys(out.lists);
      expect(accepted.length).toBeGreaterThan(0);
      expect(accepted.length + out.later.length + Object.keys(out.failed).length).toBe(pending.length);
      for (const a of accepted) listed.add(a);
      if (requests === 1) expect(out.later.length).toBeGreaterThan(0);
      pending = out.later;
    }
    expect(pending).toEqual([]);
    expect(listed.size).toBe(40);
    expect(requests).toBeLessThanOrEqual(3);
  });

  it('una subcarpeta comprobada hace menos de un minuto no se vuelve a mirar en Drive; pasado el minuto, sí (y una movida afuera deja de verse)', async () => {
    const { world, ids, add, tree, askOk } = await many();
    add('a.jpg', [ids[0]!]);
    // `many` ya mostró las D0..D4 al crearlas: están comprobadas (las anotó `prepare`).
    const gets = () => world.calls.filter((c) => c.startsWith('GET www.googleapis.com/drive/v3/files/')).length;
    const before = gets();
    await askOk({ dirs: [ids[0]!, ids[1]!, ids[2]!] });
    expect(gets() - before).toBe(0);
    // Pasado el minuto vuelve a preguntarle a Drive por cada una.
    vi.useFakeTimers({ now: Date.now() + LIST_TRUST_MS + 1000, toFake: ['Date'] });
    const mid = gets();
    await askOk({ dirs: [ids[0]!, ids[1]!, ids[2]!] });
    expect(gets() - mid).toBe(3);
    // Una que el dueño movió afuera: con el minuto cumplido, deja de verse en el acto.
    const carpetas = world.drive.get(tree.root.id)!.parents[0]!;
    world.drive.get(ids[1]!)!.parents = [carpetas];
    vi.useFakeTimers({ now: Date.now() + LIST_TRUST_MS + 1000, toFake: ['Date'] });
    const out = await askOk({ dirs: [ids[0]!, ids[1]!] });
    expect(Object.keys(out.lists)).toEqual([ids[0]!]);
    expect(out.failed).toEqual({ [ids[1]!]: 'not_found' });
  });
});

describe('carpetas: el ZWJ de los emojis compuestos en lo que lista el portero', () => {
  it('cleanFileName: el ZWJ se queda entre dos emojis y se saca entre letras, suelto o con el ZWNJ (igual que la app)', () => {
    const same = ['👨‍👩‍👧.jpg', '👩🏽‍💻.png', '❤️‍🔥.txt', 'Familia 👨‍👩‍👧‍👦 2026.pdf'];
    for (const name of same) expect(cleanFileName(name)).toBe(name);
    expect(cleanFileName('a‍b.jpg')).toBe('ab.jpg');
    expect(cleanFileName('‍👨.jpg')).toBe('👨.jpg');
    expect(cleanFileName('👨‍.jpg')).toBe('👨.jpg');
    expect(cleanFileName('👨‍ a.jpg')).toBe('👨 a.jpg');
    expect(cleanFileName('👨‌👩.jpg')).toBe('👨👩.jpg');
    expect(cleanFileName('👨​‍👩.jpg')).toBe('👨‍👩.jpg');
    // Lo demás de HIDDEN_CHARS sigue igual.
    expect(cleanFileName('a‮b⁦c‎d.txt')).toBe('abcd.txt');
    // Un nombre largo con ZWJ no pasa de 255 y no parte la familia.
    const long = cleanFileName('x'.repeat(240) + '👨‍👩‍👧‍👦.jpg');
    expect(Array.from(long).length).toBeLessThanOrEqual(255);
    expect(long.endsWith('.jpg')).toBe(true);
  });

  it('lo que lista el portero (archivos y subcarpetas) conserva la familia y lo que se sube va con su nombre', async () => {
    const { world, p } = await setup();
    const tree = await prepare(p, { dirs: ['👨‍👩‍👧 y a‍b'] });
    const names = [...world.drive.values()].map((f) => f.name);
    // La subcarpeta se creó en el Drive del dueño con su familia entera (y sin el ZWJ de entre letras).
    expect(names).toContain('👨‍👩‍👧_y_ab');
    world.drive.set('familiaxxxxxxxx', { name: 'foto 👩‍💻 a‍b.jpg', mimeType: 'image/jpeg', parents: [tree.root.id], data: new Uint8Array([1]) });
    const listed = (await (await call(p, '/folder/list', 'viewer-jwt', { file: F1 })).json()) as Listed;
    expect(listed.entries.map((e) => e.name)).toEqual(['👨‍👩‍👧_y_ab', 'foto 👩‍💻 ab.jpg']);
    expect(listed.entries[0]!.name).toBe('👨‍👩‍👧_y_ab');
    // También en el listado de varias subcarpetas.
    const dir = Object.values(tree.dirs)[0]!;
    world.drive.set('hijaxxxxxxxxxx', { name: '🇦🇷 👨‍👩‍👧.jpg', mimeType: 'image/jpeg', parents: [dir], data: new Uint8Array([1]) });
    const many = (await (await call(p, '/folder/list', 'viewer-jwt', { file: F1, dirs: [dir] })).json()) as { lists: Record<string, { name: string }[]> };
    expect(many.lists[dir]!.map((e) => e.name)).toEqual(['🇦🇷 👨‍👩‍👧.jpg']);
  });
});
