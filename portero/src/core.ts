// El portero de archivos de un workspace: un Worker de Cloudflare en la cuenta del dueño. Guarda la
// conexión con el Drive del dueño (nadie más la recibe), sube los archivos a su Drive y los devuelve en
// streaming, con pedidos por partes (Range), para que un video se reproduzca sin bajarlo entero.
//
// Quién pide algo lo decide el Supabase del workspace: el portero le pregunta con la sesión de la persona
// (`media_whoami`), así que no necesita ninguna clave de la base. Para los videos, que el navegador pide
// sin sesión, el portero entrega un pase firmado que vence.
//
// Por ahora (la prueba del paso 4 de Docs/Plan_Workspaces.md) todo lo puede hacer solo el dueño.

export interface Env {
  /** Dirección y clave publicable del Supabase del workspace (las dos son públicas). */
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  /** Direcciones de la app que pueden hablar con el portero, separadas por comas. */
  APP_ORIGINS: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
}

/** Lo que el portero guarda (la conexión con Drive, las subidas en curso). Ver index.ts. */
export interface Store {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

interface Google {
  refreshToken: string;
  email?: string;
  rootFolder?: string;
  testFolder?: string;
  /** La conexión dejó de andar (el dueño la revocó o venció): hay que volver a conectar. */
  broken?: string;
}

interface Upload {
  session: string;
  user: string;
  size: number;
  createdAt: number;
  /** Ya terminó: si la app perdió la respuesta de la última parte y pregunta, se le contesta esto. */
  done?: { id: string; name: string; mimeType: string; size: number };
}

interface Who {
  userId: string;
  isOwner: boolean;
}

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ROOT_FOLDER = 'LGA Shot Docs';
const TEST_FOLDER = 'Media test';
/** Un pase de reproducción dura esto: si vence en medio de un video, la reproducción se corta. */
const PASS_MS = 8 * 60 * 60 * 1000;
/** Una parte de subida no puede pasar esto (el plan gratis de Workers acepta hasta 100 MB por pedido). */
const MAX_CHUNK = 64 * 1024 * 1024;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// --- utilidades -------------------------------------------------------------------------------------

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

function randomId(bytes = 24): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    fromB64url(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))));
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function origins(env: Env): string[] {
  return (env.APP_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, '').toLowerCase())
    .filter(Boolean);
}

function cors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  if (!origins(env).includes(origin.toLowerCase())) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Content-Range',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function json(req: Request, env: Env, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(req, env) },
  });
}

// --- el portero -------------------------------------------------------------------------------------

export class Portero {
  private accessToken: { token: string; until: number } | null = null;

  constructor(
    private readonly env: Env,
    private readonly store: Store,
    private readonly http: typeof fetch = fetch,
  ) {}

  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req, this.env) });
      const path = url.pathname;
      if (path === '/health') return json(req, this.env, { ok: true });
      if (path === '/drive/callback' && req.method === 'GET') return await this.callback(url);
      const pass = /^\/m\/([^/]+)$/.exec(path)?.[1];
      if (pass && (req.method === 'GET' || req.method === 'HEAD')) return await this.media(req, pass);

      const who = await this.whoami(req);
      if (path === '/drive/status' && req.method === 'GET') return json(req, this.env, await this.status(who));
      if (!who.isOwner) throw new HttpError(403, 'Only the owner of the workspace can do this for now.');
      if (path === '/drive/connect' && req.method === 'POST') return json(req, this.env, await this.connect(req));
      if (path === '/upload' && req.method === 'POST') return json(req, this.env, await this.startUpload(req, who));
      const upload = /^\/upload\/([^/]+)$/.exec(path)?.[1];
      if (upload && req.method === 'PUT') return json(req, this.env, await this.uploadChunk(req, upload, who));
      if (path === '/pass' && req.method === 'POST') return json(req, this.env, await this.makePass(req));
      throw new HttpError(404, 'Not found');
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      const message = err instanceof Error ? err.message : String(err);
      return json(req, this.env, { error: message }, status);
    }
  }

  // Quién es: la sesión de Supabase de la persona, validada por el propio Supabase.
  private async whoami(req: Request): Promise<Who> {
    const auth = req.headers.get('Authorization') ?? '';
    if (!/^Bearer \S+$/.test(auth)) throw new HttpError(401, 'Sign in to the app first.');
    const res = await this.http(`${this.env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/rpc/media_whoami`, {
      method: 'POST',
      headers: { apikey: this.env.SUPABASE_PUBLISHABLE_KEY, Authorization: auth, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (res.status === 401 || res.status === 403) throw new HttpError(401, 'Your session expired: sign in again.');
    if (!res.ok) throw new HttpError(502, `The workspace did not answer (${res.status}).`);
    const who = (await res.json()) as { user_id: string | null; is_owner: boolean };
    if (!who.user_id) throw new HttpError(401, 'Sign in to the app first.');
    return { userId: who.user_id, isOwner: who.is_owner === true };
  }

  private async status(who: Who): Promise<unknown> {
    const google = await this.store.get<Google>('google');
    return {
      connected: !!google && !google.broken,
      broken: google?.broken ?? null,
      email: who.isOwner ? (google?.email ?? null) : null,
      isOwner: who.isOwner,
    };
  }

  // --- conectar el Drive del dueño -----------------------------------------------------------------

  private async connect(req: Request): Promise<{ url: string }> {
    const origin = req.headers.get('Origin') ?? '';
    if (!origins(this.env).includes(origin.toLowerCase())) throw new HttpError(403, 'This app address is not allowed.');
    // Google vuelve a esta dirección del portero, que tiene que estar cargada en el cliente de Google.
    const redirect = `${new URL(req.url).origin}/drive/callback`;
    const state = randomId();
    await this.store.put(`state:${state}`, { origin, redirect, until: Date.now() + 15 * 60_000 });
    const params = new URLSearchParams({
      client_id: this.env.GOOGLE_CLIENT_ID,
      redirect_uri: redirect,
      response_type: 'code',
      scope: `openid email ${SCOPE}`,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` };
  }

  private async callback(url: URL): Promise<Response> {
    const stateId = url.searchParams.get('state') ?? '';
    const state = stateId ? await this.store.get<{ origin: string; redirect: string; until: number }>(`state:${stateId}`) : undefined;
    if (!state || state.until < Date.now()) {
      return new Response('This link expired. Go back to the app and connect Google Drive again.', { status: 400 });
    }
    await this.store.delete(`state:${stateId}`);
    const back = (result: string) => Response.redirect(`${state.origin}/media-test?drive=${encodeURIComponent(result)}`, 302);
    const code = url.searchParams.get('code');
    if (!code) return back(url.searchParams.get('error') ?? 'cancelled');

    const res = await this.http(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.env.GOOGLE_CLIENT_ID,
        client_secret: this.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: state.redirect,
        grant_type: 'authorization_code',
      }),
    });
    const token = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      id_token?: string;
      scope?: string;
      error?: string;
    };
    if (!res.ok || !token.refresh_token || !token.access_token) return back(token.error ?? 'no-refresh-token');
    // Google deja destildar cada permiso en la pantalla de consentimiento: sin Drive no hay conexión.
    if (!(token.scope ?? '').split(' ').includes(SCOPE)) return back('drive-permission-missing');

    const email = token.id_token ? readEmail(token.id_token) : undefined;
    const previous = await this.store.get<Google>('google');
    await this.store.put('google', { refreshToken: token.refresh_token, email, rootFolder: previous?.rootFolder, testFolder: previous?.testFolder });
    await this.keepAccessToken(token.access_token, token.expires_in);
    return back('connected');
  }

  /** Un token de acceso de Google vigente, renovado con la conexión guardada si hace falta. */
  private async token(): Promise<string> {
    if (this.accessToken && this.accessToken.until > Date.now()) return this.accessToken.token;
    // Cada pedido crea un Portero nuevo (index.ts): el token vigente se guarda para no pedirle uno nuevo a
    // Google en cada parte de un video.
    const saved = await this.store.get<{ token: string; until: number }>('accessToken');
    if (saved && saved.until > Date.now()) {
      this.accessToken = saved;
      return saved.token;
    }
    const google = await this.store.get<Google>('google');
    if (!google || google.broken) throw new HttpError(409, 'Google Drive is not connected.');
    const res = await this.http(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.env.GOOGLE_CLIENT_ID,
        client_secret: this.env.GOOGLE_CLIENT_SECRET,
        refresh_token: google.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const token = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
    if (res.status === 400 && token.error === 'invalid_grant') {
      await this.store.put('google', { ...google, broken: 'The connection with Google Drive stopped working: connect it again.' });
      throw new HttpError(409, 'The connection with Google Drive stopped working: connect it again.');
    }
    if (!res.ok || !token.access_token) throw new HttpError(502, `Google did not answer (${token.error ?? res.status}).`);
    await this.keepAccessToken(token.access_token, token.expires_in);
    return token.access_token;
  }

  private async keepAccessToken(token: string, expiresIn = 3600): Promise<void> {
    this.accessToken = { token, until: Date.now() + (expiresIn - 120) * 1000 };
    await this.store.put('accessToken', this.accessToken);
  }

  private async drive(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${await this.token()}`);
    return this.http(path.startsWith('https://') ? path : `${DRIVE}${path}`, { ...init, headers });
  }

  /** La carpeta de pruebas, adentro de la carpeta de la app en el Drive del dueño. La crea si falta. */
  private async testFolder(): Promise<string> {
    const google = (await this.store.get<Google>('google'))!;
    const root = await this.folder(google.rootFolder, ROOT_FOLDER, null);
    const test = await this.folder(google.testFolder, TEST_FOLDER, root);
    if (root !== google.rootFolder || test !== google.testFolder) {
      await this.store.put('google', { ...google, rootFolder: root, testFolder: test });
    }
    return test;
  }

  private async folder(known: string | undefined, name: string, parent: string | null): Promise<string> {
    if (known) {
      const res = await this.drive(`/files/${known}?fields=id,trashed`);
      if (res.ok && !((await res.json()) as { trashed?: boolean }).trashed) return known;
    }
    const res = await this.drive('/files?fields=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', ...(parent ? { parents: [parent] } : {}) }),
    });
    if (!res.ok) throw new HttpError(502, `Could not create the folder "${name}" in Google Drive (${res.status}).`);
    return ((await res.json()) as { id: string }).id;
  }

  // --- subir (por partes, se puede retomar) ---------------------------------------------------------

  private async startUpload(req: Request, who: Who): Promise<{ uploadId: string }> {
    const body = (await req.json()) as { name?: string; mime?: string; size?: number };
    const size = Number(body.size);
    if (typeof body.name !== 'string' || !body.name || !Number.isSafeInteger(size) || size <= 0) {
      throw new HttpError(400, 'Missing the file name or size.');
    }
    const folder = await this.testFolder();
    const res = await this.drive(`${UPLOAD}/files?uploadType=resumable&fields=id,name,mimeType,size`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': body.mime || 'application/octet-stream',
        'X-Upload-Content-Length': String(size),
      },
      body: JSON.stringify({ name: body.name.slice(0, 250), parents: [folder] }),
    });
    const session = res.headers.get('Location');
    if (!res.ok || !session) throw new HttpError(502, `Google Drive did not start the upload (${res.status}).`);
    const uploadId = randomId();
    await this.store.put(`upload:${uploadId}`, { session, user: who.userId, size, createdAt: Date.now() } satisfies Upload);
    return { uploadId };
  }

  /**
   * Pasa una parte a Drive. `Content-Range: bytes 0-8388607/123456789` con la parte, o
   * `bytes *\/123456789` sin cuerpo para preguntar cuánto llegó (para retomar).
   */
  private async uploadChunk(req: Request, uploadId: string, who: Who): Promise<unknown> {
    const upload = await this.store.get<Upload>(`upload:${uploadId}`);
    if (!upload || upload.user !== who.userId) throw new HttpError(404, 'This upload does not exist anymore: start it again.');
    if (upload.done) return { status: 'done', file: upload.done };
    const range = req.headers.get('Content-Range') ?? '';
    const part = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
    const ask = /^bytes \*\/(\d+)$/.exec(range);
    if (!part && !ask) throw new HttpError(400, 'Missing Content-Range.');
    if (ask && Number(ask[1]) !== upload.size) throw new HttpError(400, 'The size does not match the upload.');
    const body = part ? await req.arrayBuffer() : new ArrayBuffer(0);
    if (part) {
      const [start, end, total] = part.slice(1).map(Number);
      if (total !== upload.size || end < start || body.byteLength !== end - start + 1 || body.byteLength > MAX_CHUNK) {
        throw new HttpError(400, 'The part does not match the upload.');
      }
    }
    const res = await this.http(upload.session, {
      method: 'PUT',
      headers: { 'Content-Range': range, 'Content-Length': String(body.byteLength) },
      body,
    });
    if (res.status === 308) {
      const got = /bytes=0-(\d+)/.exec(res.headers.get('Range') ?? '');
      return { status: 'incomplete', received: got ? Number(got[1]) + 1 : 0 };
    }
    if (res.status === 200 || res.status === 201) {
      const file = (await res.json()) as { id: string; name: string; mimeType: string; size?: string };
      const done = { id: file.id, name: file.name, mimeType: file.mimeType, size: Number(file.size ?? upload.size) };
      // Se recuerda: si la respuesta no llega, la app pregunta y no vuelve a subir todo.
      await this.store.put(`upload:${uploadId}`, { ...upload, done } satisfies Upload);
      return { status: 'done', file: done };
    }
    if (res.status === 404 || res.status === 410) {
      await this.store.delete(`upload:${uploadId}`);
      throw new HttpError(410, 'Google Drive dropped this upload: start it again.');
    }
    throw new HttpError(502, `Google Drive answered ${res.status} to a part of the upload.`);
  }

  // --- ver (con un pase firmado, por partes) --------------------------------------------------------

  private async secret(): Promise<string> {
    let secret = await this.store.get<string>('passSecret');
    if (!secret) {
      secret = randomId(32);
      await this.store.put('passSecret', secret);
    }
    return secret;
  }

  private async makePass(req: Request): Promise<{ url: string }> {
    const body = (await req.json()) as { fileId?: string; type?: string };
    if (!body.fileId || !/^[\w-]{10,200}$/.test(body.fileId)) throw new HttpError(400, 'Missing the file.');
    const type = body.type && /^[\w.+-]+\/[\w.+-]+$/.test(body.type) ? body.type : '';
    const payload = b64url(new TextEncoder().encode(JSON.stringify({ f: body.fileId, t: type, u: Date.now() + PASS_MS })));
    const pass = `${payload}.${await hmac(await this.secret(), payload)}`;
    return { url: `${new URL(req.url).origin}/m/${pass}` };
  }

  private async media(req: Request, pass: string): Promise<Response> {
    const [payload, signature] = pass.split('.');
    if (!payload || !signature || !sameText(signature, await hmac(await this.secret(), payload))) {
      throw new HttpError(403, 'Invalid link.');
    }
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as { f: string; t: string; u: number };
    if (data.u < Date.now()) throw new HttpError(403, 'This link expired: open the file again from the app.');

    const headers = new Headers();
    const range = req.headers.get('Range');
    if (range) headers.set('Range', range);
    const res = await this.drive(`/files/${encodeURIComponent(data.f)}?alt=media`, { headers });
    if (res.status === 416) return new Response(null, { status: 416, headers: { 'Content-Range': res.headers.get('Content-Range') ?? '' } });
    if (!res.ok && res.status !== 206) throw new HttpError(res.status === 404 ? 404 : 502, `Google Drive answered ${res.status}.`);

    // Lo que se sirve nunca corre como página en la dirección del portero (un HTML o un SVG subido).
    const out = new Headers({
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': 'sandbox',
    });
    for (const h of ['Content-Length', 'Content-Range', 'Content-Type', 'ETag', 'Last-Modified']) {
      const v = res.headers.get(h);
      if (v) out.set(h, v);
    }
    if (data.t) out.set('Content-Type', data.t);
    return new Response(req.method === 'HEAD' ? null : res.body, { status: res.status, headers: out });
  }
}

/** El correo de la cuenta de Google que se conectó, sacado del id_token que devuelve Google. */
function readEmail(idToken: string): string | undefined {
  try {
    const body = JSON.parse(new TextDecoder().decode(fromB64url(idToken.split('.')[1] ?? ''))) as { email?: string };
    return body.email;
  } catch {
    return undefined;
  }
}
