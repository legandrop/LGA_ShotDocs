// El portero de archivos de un workspace: un Worker de Cloudflare en la cuenta del dueño. Guarda la
// conexión con el Drive del dueño (nadie más la recibe), sube los archivos a su Drive y los devuelve en
// streaming, con pedidos por partes (Range), para que un video se reproduzca sin bajarlo entero.
//
// Quién pide algo lo decide el Supabase del workspace: el portero le pregunta con la sesión de la persona
// (`media_whoami`, `media_file`, `set_file_drive`), así que no necesita ninguna clave de la base. Para los
// videos, que el navegador pide sin sesión, el portero entrega un pase firmado que vence.
//
// Permisos: conectar Drive, elegir la carpeta y lo de la prueba de media (`/upload` sin `file`, `/pass`
// con `fileId`) solo el dueño. Subir y ver un archivo de la app (`file`) depende del nivel de la persona
// sobre ese archivo, según las páginas que lo usan (`media_file`): subir pide 3 (editar), ver pide 1.

export interface Env {
  /** Dirección y clave publicable del Supabase del workspace (las dos son públicas). */
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  /** Direcciones de la app que pueden hablar con el portero, separadas por comas. */
  APP_ORIGINS: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /** Clave de API de Google para el selector de carpetas (Picker). Sin ella, la carpeta va a la raíz. */
  GOOGLE_API_KEY?: string;
}

/** Lo que el portero guarda (la conexión con Drive, las subidas en curso). Ver index.ts. */
export interface Store {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

// Lo guardado, por clave. Las de antes (`google`, `accessToken`, `passSecret`, `upload:*`, `state:*`) se
// leen igual que siempre; lo nuevo va en claves nuevas o en campos opcionales.

/** `google`: la conexión con el Drive del dueño y las carpetas de la app. */
interface Google {
  refreshToken: string;
  email?: string;
  rootFolder?: string;
  testFolder?: string;
  /** La conexión dejó de andar (el dueño la revocó o venció): hay que volver a conectar. */
  broken?: string;
}

/** `drivePlace`: la carpeta que eligió el dueño para `LGA_ShotDocs`. Sin la clave: la raíz de su Drive. */
interface Place {
  id: string;
  name: string;
}

/** `upload:<id>`: una subida en curso (o terminada, por si la app perdió la respuesta). */
interface Upload {
  session: string;
  user: string;
  size: number;
  createdAt: number;
  /** Ya terminó: si la app perdió la respuesta de la última parte y pregunta, se le contesta esto. */
  done?: DriveFile;
  /** El archivo de la app (`files.id`) que se sube; sin él, es de la prueba de media. */
  file?: string;
  /** `set_file_drive` ya respondió bien (o la base ya tenía el archivo subido). */
  linked?: boolean;
}

/** `file:<uuid>`: lo que el portero sabe de un archivo de la app. */
interface FileRecord {
  /** Lo que subió el portero (aunque la base todavía no lo sepa). */
  drive?: DriveFile;
  /** `set_file_drive` ya respondió bien. */
  linked?: boolean;
  /** El id de Drive cuyo `appProperties.sdFile` ya se comprobó que es este archivo. */
  verified?: string;
}

/** `project:<project_id>`: la carpeta del proyecto y el nombre que le puso la app. */
interface ProjectFolder {
  id: string;
  name: string;
}
// `day:<project_id>:<AAAA-MM-DD>`: el id de la carpeta del día (texto).

/**
 * `cache:<id de Drive>`: qué hay guardado del principio y del final de un archivo, para que el video
 * arranque sin esperar a Drive. Los trozos van en `cache:<id>:h<n>` (desde el byte 0) y `cache:<id>:t<n>`
 * (los últimos `tail` bytes). `cacheIndex` es la lista de archivos guardados, del más viejo al más nuevo.
 */
interface CacheMeta {
  size: number;
  head: number;
  tail: number;
  type?: string;
  etag?: string;
  modified?: string;
}

/** Lo que devuelve `media_file` del Supabase del workspace (`null` si la persona no lo puede ver). */
interface MediaFile {
  id: string;
  project_id: string;
  project_name: string;
  name: string;
  mime: string;
  size: number;
  drive_id: string | null;
  created_at: string;
  level: number;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

interface Who {
  userId: string;
  isOwner: boolean;
  /** El encabezado `Authorization` de la persona, para preguntarle a la base con su sesión. */
  auth: string;
}

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
/** Nombres de carpeta sin espacios: guiones bajos, y el de la app igual al del repo. */
const ROOT_FOLDER = 'LGA_ShotDocs';
const TEST_FOLDER = 'Media_Test';
/** Los nombres con espacios de v0.022–v0.026: una carpeta que todavía se llame así se renombra sola. */
const OLD_NAMES: Record<string, string> = { [ROOT_FOLDER]: 'LGA Shot Docs', [TEST_FOLDER]: 'Media test' };
/** Un pase de reproducción dura esto: si vence en medio de un video, la reproducción se corta. */
const PASS_MS = 8 * 60 * 60 * 1000;
/** Una parte de subida no puede pasar esto (el plan gratis de Workers acepta hasta 100 MB por pedido). */
const MAX_CHUNK = 64 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DRIVE_ID = /^[\w-]{10,200}$/;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MIME = /^[\w.+-]+\/[\w.+-]+$/;

/**
 * Caché del arranque del video. Cada valor del almacenamiento del portero puede pesar hasta 128 KiB: los
 * trozos son de 127 KiB para que, con lo que agrega el almacenamiento al guardarlos, no lleguen al tope.
 * Por archivo se guardan 2 trozos del principio (~254 KiB: el encabezado del video) y 4 del final
 * (~508 KiB: el índice, que los videos del iPhone llevan al final). Un archivo que entra entero en esos
 * ~762 KiB se guarda entero. Como mucho `CACHE_FILES` archivos (~190 MiB en total): al pasarse, se
 * olvida el más viejo.
 */
export const CACHE_PIECE = 127 * 1024;
export const CACHE_HEAD_PIECES = 2;
export const CACHE_TAIL_PIECES = 4;
export const CACHE_FILES = 256;

/** Carpetas que se están buscando o creando en este momento: dos subidas a la vez no crean dos iguales. */
const pending = new Map<string, Promise<string>>();

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

/** El cuerpo JSON del pedido; `{}` si no trae o no se puede leer (las versiones viejas mandan `{}`). */
async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await req.json()) as unknown;
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * El nombre de la carpeta de un proyecto en Drive: sin espacios (guiones bajos) y sin caracteres raros
 * (barras, dos puntos, comodines, emojis). Conserva letras con acento, números y `- . , ( ) & + '`.
 */
export function folderName(name: string): string {
  const clean = Array.from(
    name
      .normalize('NFC')
      .replace(/[^\p{L}\p{M}\p{N}\s_\-.,()&+']/gu, '')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[_.]+|[_.]+$/g, ''),
  )
    .slice(0, 100)
    .join('');
  return clean || 'Project';
}

/** El día de hoy (UTC) como `AAAA-MM-DD`, si la app no manda uno. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// --- el portero -------------------------------------------------------------------------------------

export class Portero {
  private accessToken: { token: string; until: number } | null = null;

  constructor(
    private readonly env: Env,
    private readonly store: Store,
    // `fetch` guardado suelto y llamado como método pierde su `this`, y Workers lo corta ("Illegal
    // invocation"): se llama siempre como la función global.
    private readonly http: typeof fetch = (input, init) => fetch(input, init),
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
      // Subir y ver: con `file`, según el nivel de la persona sobre el archivo; sin él, solo el dueño.
      if (path === '/upload' && req.method === 'POST') return json(req, this.env, await this.startUpload(req, who));
      const upload = /^\/upload\/([^/]+)$/.exec(path)?.[1];
      if (upload && req.method === 'PUT') return json(req, this.env, await this.uploadChunk(req, upload, who));
      if (path === '/pass' && req.method === 'POST') return json(req, this.env, await this.makePass(req, who));

      if (!who.isOwner) throw new HttpError(403, 'Only the owner of the workspace can do this for now.');
      if (path === '/drive/connect' && req.method === 'POST') return json(req, this.env, await this.connect(req));
      if (path === '/drive/picker' && req.method === 'POST') return json(req, this.env, await this.picker());
      if (path === '/drive/folder' && req.method === 'POST') return json(req, this.env, await this.chooseFolder(req));
      throw new HttpError(404, 'Not found');
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      const message = err instanceof Error ? err.message : String(err);
      return json(req, this.env, { error: message }, status);
    }
  }

  // --- la base del workspace, con la sesión de la persona ------------------------------------------

  private rpc(auth: string, fn: string, args: unknown): Promise<Response> {
    return this.http(`${this.env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: this.env.SUPABASE_PUBLISHABLE_KEY, Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
  }

  // Quién es: la sesión de Supabase de la persona, validada por el propio Supabase.
  private async whoami(req: Request): Promise<Who> {
    const auth = req.headers.get('Authorization') ?? '';
    if (!/^Bearer \S+$/.test(auth)) throw new HttpError(401, 'Sign in to the app first.');
    const res = await this.rpc(auth, 'media_whoami', {});
    if (res.status === 401 || res.status === 403) throw new HttpError(401, 'Your session expired: sign in again.');
    if (!res.ok) throw new HttpError(502, `The workspace did not answer (${res.status}).`);
    const who = (await res.json()) as { user_id: string | null; is_owner: boolean };
    if (!who.user_id) throw new HttpError(401, 'Sign in to the app first.');
    return { userId: who.user_id, isOwner: who.is_owner === true, auth };
  }

  /** El archivo de la app y el nivel de la persona sobre él; `null` si no existe o no lo puede ver. */
  private async mediaFile(who: Who, file: string): Promise<MediaFile | null> {
    const res = await this.rpc(who.auth, 'media_file', { p_file_id: file });
    if (res.status === 401 || res.status === 403) throw new HttpError(401, 'Your session expired: sign in again.');
    if (res.status === 404) throw new HttpError(502, 'The workspace database is not up to date for files yet.');
    if (!res.ok) throw new HttpError(502, `The workspace did not answer (${res.status}).`);
    const media = (await res.json()) as MediaFile | null;
    return media && typeof media === 'object' && media.id ? media : null;
  }

  /**
   * Le dice a la base en qué archivo de Drive quedó (`set_file_drive`), con la sesión de la persona. Si
   * falla por la red o la base, queda anotado y se intenta de nuevo la próxima vez que se pregunte por ese
   * archivo (subida o pase). Devuelve si quedó hecho.
   */
  private async linkFile(who: Who, file: string, drive: DriveFile): Promise<boolean> {
    let linked = false;
    try {
      const res = await this.rpc(who.auth, 'set_file_drive', { p_file_id: file, p_drive_id: drive.id });
      if (res.ok) linked = true;
      else {
        const error = (await res.json().catch(() => null)) as { message?: string } | null;
        // Otro dispositivo ya lo subió y quedó ese: lo de acá es una copia de más; no hay nada que hacer.
        if (error?.message?.includes('file_already_uploaded')) linked = true;
      }
    } catch {
      linked = false;
    }
    const rec = (await this.store.get<FileRecord>(`file:${file}`)) ?? {};
    await this.store.put(`file:${file}`, { ...rec, drive, linked, verified: rec.verified ?? drive.id } satisfies FileRecord);
    return linked;
  }

  private async status(who: Who): Promise<unknown> {
    const google = await this.store.get<Google>('google');
    const place = who.isOwner ? await this.store.get<Place>('drivePlace') : undefined;
    return {
      connected: !!google && !google.broken,
      broken: google?.broken ?? null,
      email: who.isOwner ? (google?.email ?? null) : null,
      isOwner: who.isOwner,
      folder: place ? { id: place.id, name: place.name } : null,
      picker: !!this.env.GOOGLE_API_KEY,
    };
  }

  // --- conectar el Drive del dueño -----------------------------------------------------------------

  private async connect(req: Request): Promise<{ url: string }> {
    const origin = req.headers.get('Origin') ?? '';
    if (!origins(this.env).includes(origin.toLowerCase())) throw new HttpError(403, 'This app address is not allowed.');
    const body = await readBody(req);
    // A qué ruta de la app vuelve Google: solo una ruta de la misma app (`/…`), nunca otra dirección.
    const ret = typeof body.return === 'string' ? body.return : '';
    const back = /^\/(?![/\\])[^\s\\]{0,300}$/.test(ret) ? ret : '/media-test';
    // Google vuelve a esta dirección del portero, que tiene que estar cargada en el cliente de Google.
    const redirect = `${new URL(req.url).origin}/drive/callback`;
    const state = randomId();
    await this.store.put(`state:${state}`, { origin, redirect, until: Date.now() + 15 * 60_000, back });
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
    const state = stateId
      ? await this.store.get<{ origin: string; redirect: string; until: number; back?: string }>(`state:${stateId}`)
      : undefined;
    if (!state || state.until < Date.now()) {
      return new Response('This link expired. Go back to the app and connect Google Drive again.', { status: 400 });
    }
    await this.store.delete(`state:${stateId}`);
    const back = (result: string) => {
      let target = new URL('/media-test', state.origin);
      try {
        const chosen = new URL(state.back ?? '/media-test', state.origin);
        if (chosen.origin === new URL(state.origin).origin) target = chosen;
      } catch {
        // una ruta que no se puede leer: vuelve a la de siempre
      }
      target.searchParams.set('drive', result);
      return Response.redirect(target.href, 302);
    };
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
    // Otra cuenta de Google: la carpeta elegida era del Drive de la anterior.
    if (previous?.email && email && previous.email !== email) await this.store.delete('drivePlace');
    await this.keepAccessToken(token.access_token, token.expires_in);
    return back('connected');
  }

  /** Pide a Google un token de acceso con la conexión guardada (`scope`: uno más chico, opcional). */
  private async refresh(scope?: string): Promise<{ token: string; expiresIn?: number }> {
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
        ...(scope ? { scope } : {}),
      }),
    });
    const token = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
    if (res.status === 400 && token.error === 'invalid_grant') {
      await this.store.put('google', { ...google, broken: 'The connection with Google Drive stopped working: connect it again.' });
      throw new HttpError(409, 'The connection with Google Drive stopped working: connect it again.');
    }
    if (!res.ok || !token.access_token) throw new HttpError(502, `Google did not answer (${token.error ?? res.status}).`);
    return { token: token.access_token, expiresIn: token.expires_in };
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
    const fresh = await this.refresh();
    await this.keepAccessToken(fresh.token, fresh.expiresIn);
    return fresh.token;
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

  // --- elegir dónde va la carpeta de la app (solo el dueño) -----------------------------------------

  /**
   * Lo que necesita el selector de carpetas de Google en el navegador del dueño. El token es uno nuevo,
   * de una hora y solo con `drive.file`; el dueño ya es dueño de ese Drive.
   */
  private async picker(): Promise<{ apiKey: string; appId: string; token: string }> {
    const apiKey = this.env.GOOGLE_API_KEY;
    if (!apiKey) throw new HttpError(404, 'The Google folder picker is not set up in the media server (GOOGLE_API_KEY).');
    let token: string;
    try {
      token = (await this.refresh(SCOPE)).token;
    } catch (err) {
      // Si Google no da un token más chico, el de siempre (tiene los mismos permisos sobre Drive).
      if (err instanceof HttpError && err.status === 409) throw err;
      token = await this.token();
    }
    return { apiKey, appId: this.env.GOOGLE_CLIENT_ID.split('-')[0] ?? '', token };
  }

  /** Guarda dónde va `LGA_ShotDocs` (`null`: la raíz) y, si la carpeta ya existe, la mueve ahí. */
  private async chooseFolder(req: Request): Promise<{ folder: Place | null }> {
    const body = await readBody(req);
    const parentId = body.parentId;
    if (parentId !== null && (typeof parentId !== 'string' || !DRIVE_ID.test(parentId))) {
      throw new HttpError(400, 'Missing the folder.');
    }
    let place: Place | null = null;
    if (parentId) {
      const res = await this.drive(`/files/${encodeURIComponent(parentId)}?fields=id,name,mimeType,trashed`);
      if (res.status === 404 || res.status === 403) {
        throw new HttpError(400, 'Could not open that folder: choose it again with the Google picker.');
      }
      if (!res.ok) throw new HttpError(502, `Could not check that folder in Google Drive (${res.status}).`);
      const found = (await res.json()) as { name?: string; mimeType?: string; trashed?: boolean };
      if (found.mimeType !== FOLDER_MIME || found.trashed) throw new HttpError(400, 'Choose a folder that is not in the trash.');
      place = { id: parentId, name: found.name ?? '' };
    }
    const previous = (await this.store.get<Place>('drivePlace')) ?? null;
    const google = await this.store.get<Google>('google');
    if (!google || google.broken) throw new HttpError(409, 'Google Drive is not connected.');
    if (google.rootFolder && (previous?.id ?? null) !== (place?.id ?? null)) await this.moveRoot(google.rootFolder, place);
    if (place) await this.store.put('drivePlace', place);
    else await this.store.delete('drivePlace');
    return { folder: place };
  }

  /** Mueve la carpeta de la app adentro de la elegida. Si ya no existe, no hay nada que mover. */
  private async moveRoot(root: string, place: Place | null): Promise<void> {
    const res = await this.drive(`/files/${encodeURIComponent(root)}?fields=id,parents,trashed`);
    if (res.status === 404) return;
    if (!res.ok) throw new HttpError(502, `Could not check the folder "${ROOT_FOLDER}" in Google Drive (${res.status}).`);
    const found = (await res.json()) as { parents?: string[]; trashed?: boolean };
    if (found.trashed) return;
    const parents = found.parents ?? [];
    if (place && parents.includes(place.id)) return;
    const params = new URLSearchParams({ addParents: place?.id ?? 'root', fields: 'id,parents' });
    if (parents.length) params.set('removeParents', parents.join(','));
    const moved = await this.drive(`/files/${encodeURIComponent(root)}?${params}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!moved.ok) throw new HttpError(502, `Could not move the folder "${ROOT_FOLDER}" in Google Drive (${moved.status}).`);
  }

  // --- carpetas ------------------------------------------------------------------------------------

  /** Una sola búsqueda o creación a la vez por carpeta (dos subidas juntas no crean dos iguales). */
  private once(key: string, work: () => Promise<string>): Promise<string> {
    const running = pending.get(key);
    if (running) return running;
    const started = work().finally(() => pending.delete(key));
    pending.set(key, started);
    return started;
  }

  /** La carpeta de la app (`LGA_ShotDocs`), en la carpeta que eligió el dueño o en la raíz. La crea si falta. */
  private rootFolder(): Promise<string> {
    return this.once('root', async () => {
      const google = await this.store.get<Google>('google');
      if (!google || google.broken) throw new HttpError(409, 'Google Drive is not connected.');
      const place = await this.store.get<Place>('drivePlace');
      const root = await this.folder(google.rootFolder, ROOT_FOLDER, place?.id ?? null);
      if (root !== google.rootFolder) {
        const latest = (await this.store.get<Google>('google')) ?? google;
        await this.store.put('google', { ...latest, rootFolder: root });
      }
      return root;
    });
  }

  /** La carpeta de pruebas, adentro de la carpeta de la app en el Drive del dueño. La crea si falta. */
  private async testFolder(): Promise<string> {
    const root = await this.rootFolder();
    return this.once('test', async () => {
      const google = (await this.store.get<Google>('google'))!;
      const test = await this.folder(google.testFolder, TEST_FOLDER, root);
      if (test !== google.testFolder) await this.store.put('google', { ...google, testFolder: test });
      return test;
    });
  }

  /**
   * `LGA_ShotDocs / <Proyecto> / <AAAA-MM-DD>`. Si el proyecto cambió de nombre, su carpeta se renombra,
   * pero solo si todavía tiene el nombre que le puso la app (si el dueño la renombró a mano, se respeta).
   */
  private async dayFolder(media: MediaFile, day: string): Promise<string> {
    const root = await this.rootFolder();
    const project = await this.once(`project:${media.project_id}`, async () => {
      const key = `project:${media.project_id}`;
      const want = folderName(media.project_name ?? '');
      const saved = await this.store.get<ProjectFolder>(key);
      if (saved) {
        const found = await this.look(saved.id, want);
        if (found && !found.trashed) {
          if (found.name === saved.name && saved.name !== want) {
            const res = await this.drive(`/files/${encodeURIComponent(saved.id)}?fields=id`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: want }),
            });
            // Si falla, se intenta de nuevo en la próxima subida.
            if (res.ok) await this.store.put(key, { id: saved.id, name: want } satisfies ProjectFolder);
          }
          return saved.id;
        }
      }
      const id = await this.create(want, root, { sdProject: media.project_id });
      await this.store.put(key, { id, name: want } satisfies ProjectFolder);
      return id;
    });
    return this.once(`day:${media.project_id}:${day}`, async () => {
      const key = `day:${media.project_id}:${day}`;
      const saved = await this.store.get<string>(key);
      if (saved) {
        const found = await this.look(saved, day);
        if (found && !found.trashed) return saved;
      }
      const id = await this.create(day, project);
      await this.store.put(key, id);
      return id;
    });
  }

  /** Cómo está una carpeta que ya conocemos; `null` si ya no existe. Un error pasajero no es "no existe". */
  private async look(id: string, name: string): Promise<{ name?: string; trashed?: boolean } | null> {
    const res = await this.drive(`/files/${encodeURIComponent(id)}?fields=id,name,trashed`);
    if (res.status === 404) return null;
    if (!res.ok) throw new HttpError(502, `Could not check the folder "${name}" in Google Drive (${res.status}).`);
    return (await res.json()) as { name?: string; trashed?: boolean };
  }

  private async create(name: string, parent: string | null, appProperties?: Record<string, string>): Promise<string> {
    const res = await this.drive('/files?fields=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parent ? { parents: [parent] } : {}), ...(appProperties ? { appProperties } : {}) }),
    });
    if (res.status === 404 && parent) {
      throw new HttpError(409, `The folder where "${name}" goes is not available anymore: choose another one.`);
    }
    if (!res.ok) throw new HttpError(502, `Could not create the folder "${name}" in Google Drive (${res.status}).`);
    return ((await res.json()) as { id: string }).id;
  }

  private async folder(known: string | undefined, name: string, parent: string | null): Promise<string> {
    if (known) {
      const found = await this.look(known, name);
      if (found && !found.trashed) {
        // Solo si conserva el nombre viejo: si el dueño la renombró a mano, se respeta. Si falla, se
        // intenta de nuevo en la próxima subida.
        if (OLD_NAMES[name] !== undefined && found.name === OLD_NAMES[name]) {
          await this.drive(`/files/${known}?fields=id`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
          });
        }
        return known;
      }
    }
    return this.create(name, parent);
  }

  // --- subir (por partes, se puede retomar) ---------------------------------------------------------

  private async startUpload(req: Request, who: Who): Promise<unknown> {
    const body = await readBody(req);
    if (body.file !== undefined) return this.startFileUpload(body, who);
    // Sin `file`: la prueba de media, solo el dueño, a `Media_Test`.
    if (!who.isOwner) throw new HttpError(403, 'Only the owner of the workspace can do this for now.');
    const size = Number(body.size);
    if (typeof body.name !== 'string' || !body.name || !Number.isSafeInteger(size) || size <= 0) {
      throw new HttpError(400, 'Missing the file name or size.');
    }
    const folder = await this.testFolder();
    const mime = typeof body.mime === 'string' && body.mime ? body.mime : 'application/octet-stream';
    return { uploadId: await this.openUpload(who, { name: body.name.slice(0, 250), parents: [folder] }, mime, size) };
  }

  /** Un archivo de la app: hace falta poder editar alguna página que lo usa (`level >= 3`). */
  private async startFileUpload(body: Record<string, unknown>, who: Who): Promise<unknown> {
    const file = typeof body.file === 'string' ? body.file.toLowerCase() : '';
    if (!UUID.test(file)) throw new HttpError(400, 'Missing the file.');
    const day = body.day === undefined ? today() : body.day;
    if (typeof day !== 'string' || !DAY.test(day)) throw new HttpError(400, 'The day must look like 2026-09-30.');
    const media = await this.mediaFile(who, file);
    if (!media) throw new HttpError(404, 'This file does not exist or you cannot see it.');
    if (media.level < 3) throw new HttpError(403, 'You cannot add files to this page.');
    const size = Number(media.size);
    if (body.size !== undefined && Number(body.size) !== size) throw new HttpError(400, 'The size does not match the file.');

    if (media.drive_id) {
      return { status: 'done', file: { id: media.drive_id, name: media.name, mimeType: media.mime, size } };
    }
    // Ya se subió pero la base no se enteró (se cortó la red al avisarle): se le avisa ahora.
    const rec = await this.store.get<FileRecord>(`file:${file}`);
    if (rec?.drive) {
      const linked = await this.linkFile(who, file, rec.drive);
      return { status: 'done', file: rec.drive, linked };
    }

    const folder = await this.dayFolder(media, day);
    const name = (typeof body.name === 'string' && body.name ? body.name : media.name || 'file').slice(0, 250);
    const mime = media.mime || (typeof body.mime === 'string' && body.mime) || 'application/octet-stream';
    const meta = { name, parents: [folder], appProperties: { sdFile: file } };
    return { uploadId: await this.openUpload(who, meta, mime, size, file) };
  }

  private async openUpload(who: Who, meta: object, mime: string, size: number, file?: string): Promise<string> {
    const res = await this.drive(`${UPLOAD}/files?uploadType=resumable&fields=id,name,mimeType,size`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mime,
        'X-Upload-Content-Length': String(size),
      },
      body: JSON.stringify(meta),
    });
    const session = res.headers.get('Location');
    if (!res.ok || !session) throw new HttpError(502, `Google Drive did not start the upload (${res.status}).`);
    const uploadId = randomId();
    const upload: Upload = { session, user: who.userId, size, createdAt: Date.now(), ...(file ? { file } : {}) };
    await this.store.put(`upload:${uploadId}`, upload);
    return uploadId;
  }

  /**
   * Pasa una parte a Drive. `Content-Range: bytes 0-8388607/123456789` con la parte, o
   * `bytes *\/123456789` sin cuerpo para preguntar cuánto llegó (para retomar).
   */
  private async uploadChunk(req: Request, uploadId: string, who: Who): Promise<unknown> {
    const upload = await this.store.get<Upload>(`upload:${uploadId}`);
    if (!upload || upload.user !== who.userId) throw new HttpError(404, 'This upload does not exist anymore: start it again.');
    if (!upload.file && !who.isOwner) throw new HttpError(403, 'Only the owner of the workspace can do this for now.');
    if (upload.done) return this.finish(uploadId, upload, upload.done, who);
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
      return this.finish(uploadId, { ...upload, done }, done, who);
    }
    if (res.status === 404 || res.status === 410) {
      await this.store.delete(`upload:${uploadId}`);
      throw new HttpError(410, 'Google Drive dropped this upload: start it again.');
    }
    throw new HttpError(502, `Google Drive answered ${res.status} to a part of the upload.`);
  }

  /** La subida terminó. Si es un archivo de la app, se le dice a la base dónde quedó (una vez). */
  private async finish(uploadId: string, upload: Upload, done: DriveFile, who: Who): Promise<unknown> {
    if (!upload.file) return { status: 'done', file: done };
    if (upload.linked) return { status: 'done', file: done, linked: true };
    const linked = await this.linkFile(who, upload.file, done);
    if (linked) await this.store.put(`upload:${uploadId}`, { ...upload, done, linked } satisfies Upload);
    return { status: 'done', file: done, linked };
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

  private async makePass(req: Request, who: Who): Promise<{ url: string }> {
    const body = await readBody(req);
    const asked = typeof body.type === 'string' && MIME.test(body.type) ? body.type : '';
    if (body.file !== undefined) {
      const { drive, type, size } = await this.filePass(body.file, who);
      return { url: await this.passUrl(req, { f: drive, t: asked || type, u: Date.now() + PASS_MS, s: size }) };
    }
    // Con el id de Drive (la prueba de media): solo el dueño.
    if (!who.isOwner) throw new HttpError(403, 'Only the owner of the workspace can do this for now.');
    const fileId = body.fileId;
    if (typeof fileId !== 'string' || !DRIVE_ID.test(fileId)) throw new HttpError(400, 'Missing the file.');
    return { url: await this.passUrl(req, { f: fileId, t: asked, u: Date.now() + PASS_MS }) };
  }

  /**
   * Un archivo de la app: hace falta verlo (`level >= 1`) y que ya esté en Drive. El archivo de Drive tiene
   * que llevar `appProperties.sdFile` con este mismo id (se comprueba una vez y queda anotado): así nadie
   * puede apuntar un archivo de la base a otro archivo del Drive del dueño.
   */
  private async filePass(value: unknown, who: Who): Promise<{ drive: string; type: string; size: number }> {
    const file = typeof value === 'string' ? value.toLowerCase() : '';
    if (!UUID.test(file)) throw new HttpError(400, 'Missing the file.');
    const media = await this.mediaFile(who, file);
    if (!media || !(media.level >= 1)) throw new HttpError(404, 'This file does not exist or you cannot see it.');
    let rec = (await this.store.get<FileRecord>(`file:${file}`)) ?? {};
    let drive = media.drive_id;
    if (!drive && rec.drive) {
      // Lo subió el portero y la base no se enteró: se intenta avisarle (si esta persona puede) y se sirve.
      drive = rec.drive.id;
      if (!rec.linked && media.level >= 3) {
        await this.linkFile(who, file, rec.drive);
        rec = (await this.store.get<FileRecord>(`file:${file}`)) ?? rec;
      }
    }
    if (!drive) throw new HttpError(409, 'This file has not finished uploading yet.');
    if (rec.verified !== drive) {
      const res = await this.drive(`/files/${encodeURIComponent(drive)}?fields=id,appProperties`);
      if (res.status === 404) throw new HttpError(404, 'This file is not in Google Drive anymore.');
      if (!res.ok) throw new HttpError(502, `Google Drive answered ${res.status}.`);
      const found = (await res.json()) as { appProperties?: Record<string, string> };
      if (found.appProperties?.sdFile !== file) throw new HttpError(403, 'This file in Google Drive does not belong to this file of the app.');
      await this.store.put(`file:${file}`, { ...rec, verified: drive } satisfies FileRecord);
    }
    return { drive, type: MIME.test(media.mime ?? '') ? media.mime : '', size: Number(media.size) || 0 };
  }

  private async passUrl(req: Request, data: { f: string; t: string; u: number; s?: number }): Promise<string> {
    const payload = b64url(new TextEncoder().encode(JSON.stringify(data)));
    const pass = `${payload}.${await hmac(await this.secret(), payload)}`;
    return `${new URL(req.url).origin}/m/${pass}`;
  }

  private async media(req: Request, pass: string): Promise<Response> {
    const [payload, signature] = pass.split('.');
    if (!payload || !signature || !sameText(signature, await hmac(await this.secret(), payload))) {
      throw new HttpError(403, 'Invalid link.');
    }
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as Pass;
    if (data.u < Date.now()) throw new HttpError(403, 'This link expired: open the file again from the app.');

    const range = req.headers.get('Range');
    const cached = range ? await this.fromCache(req, data, range) : {};
    if (cached.response) return cached.response;

    const headers = new Headers();
    if (range) headers.set('Range', range);
    const res = await this.drive(`/files/${encodeURIComponent(data.f)}?alt=media`, { headers });
    if (res.status === 416) return new Response(null, { status: 416, headers: { 'Content-Range': res.headers.get('Content-Range') ?? '' } });
    if (!res.ok && res.status !== 206) throw new HttpError(res.status === 404 ? 404 : 502, `Google Drive answered ${res.status}.`);
    // Un pase sin el peso del archivo (la prueba de media): se aprende de la respuesta, para la próxima.
    if (cached.learn && res.status === 206) await this.learnSize(data.f, res);

    const out = mediaHeaders();
    for (const h of ['Content-Length', 'Content-Range', 'Content-Type', 'ETag', 'Last-Modified']) {
      const v = res.headers.get(h);
      if (v) out.set(h, v);
    }
    if (data.t) out.set('Content-Type', data.t);
    return new Response(req.method === 'HEAD' ? null : res.body, { status: res.status, headers: out });
  }

  // --- caché del principio y del final de los archivos (arranque del video) -------------------------

  /**
   * Un pedido por partes que cae entero en el principio o en el final guardado se sirve desde el
   * almacenamiento del portero, sin ir a Drive. Si cae en esa zona pero todavía no está guardada, se le
   * pide a Drive la zona entera (una sola vez), se guarda y se sirve. Lo demás va a Drive como siempre.
   */
  private async fromCache(req: Request, data: Pass, header: string): Promise<{ response?: Response; learn?: boolean }> {
    const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!m || (!m[1] && !m[2])) return {};
    const key = `cache:${data.f}`;
    const meta = await this.store.get<CacheMeta>(key);
    const size = meta?.size ?? (Number.isSafeInteger(data.s) && data.s! > 0 ? data.s! : 0);
    if (!size) return { learn: true };
    const r = byteRange(m[1], m[2], size);
    if (!r) return {};
    if (meta) {
      const hit = await this.readCache(req, data, meta, r);
      if (hit) return { response: hit };
    }

    const zone = cacheZones(size);
    let from: number;
    let kind: 'h' | 't';
    if (r.end < zone.head) [from, kind] = [0, 'h'];
    else if (zone.tail > 0 && r.start >= size - zone.tail) [from, kind] = [size - zone.tail, 't'];
    else return {};
    const to = kind === 'h' ? zone.head - 1 : size - 1;

    const res = await this.drive(`/files/${encodeURIComponent(data.f)}?alt=media`, { headers: { Range: `bytes=${from}-${to}` } });
    const got = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers.get('Content-Range') ?? '');
    if (res.status !== 206 || !got || Number(got[1]) !== from || Number(got[2]) !== to || Number(got[3]) !== size) {
      await res.body?.cancel();
      // El archivo no pesa lo que se creía: se anota el peso de verdad y se va a Drive.
      if (res.status === 206 && got && Number(got[3]) > 0 && Number(got[3]) !== size) {
        await this.store.put(key, { size: Number(got[3]), head: 0, tail: 0 } satisfies CacheMeta);
        if (!meta) await this.remember(data.f);
      }
      return {};
    }
    // Es poco (hasta ~762 KiB): se puede tener entero en memoria.
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length !== to - from + 1) return {};
    // Copias (`slice`), no vistas: una vista se guardaría con todo el búfer de atrás.
    const writes: Promise<void>[] = [];
    for (let i = 0; i * CACHE_PIECE < bytes.length; i++) {
      writes.push(this.store.put(`${key}:${kind}${i}`, bytes.slice(i * CACHE_PIECE, (i + 1) * CACHE_PIECE)));
    }
    await Promise.all(writes);
    // Lo último: la descripción, recién cuando los trozos ya están.
    const latest = await this.store.get<CacheMeta>(key);
    const base: CacheMeta = latest && latest.size === size ? latest : { size, head: 0, tail: 0 };
    const next: CacheMeta = {
      ...base,
      [kind === 'h' ? 'head' : 'tail']: bytes.length,
      type: res.headers.get('Content-Type') ?? base.type,
      etag: res.headers.get('ETag') ?? base.etag,
      modified: res.headers.get('Last-Modified') ?? base.modified,
    };
    await this.store.put(key, next);
    if (!latest) await this.remember(data.f);
    return { response: cacheResponse(req, data, next, r, bytes.slice(r.start - from, r.end - from + 1), 'fill') };
  }

  private async readCache(req: Request, data: Pass, meta: CacheMeta, r: ByteRange): Promise<Response | null> {
    let start: number;
    let kind: 'h' | 't';
    if (meta.head > 0 && r.end < meta.head) [start, kind] = [0, 'h'];
    else if (meta.tail > 0 && r.start >= meta.size - meta.tail) [start, kind] = [meta.size - meta.tail, 't'];
    else return null;
    const first = Math.floor((r.start - start) / CACHE_PIECE);
    const last = Math.floor((r.end - start) / CACHE_PIECE);
    const keys = Array.from({ length: last - first + 1 }, (_, i) => `cache:${data.f}:${kind}${first + i}`);
    const pieces = await Promise.all(keys.map((k) => this.store.get<Uint8Array | ArrayBuffer>(k)));
    const out = new Uint8Array(r.end - r.start + 1);
    let pos = 0;
    for (let i = 0; i < pieces.length; i++) {
      const raw = pieces[i];
      if (!raw) return null;
      const piece = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
      const pieceStart = start + (first + i) * CACHE_PIECE;
      const a = Math.max(r.start, pieceStart) - pieceStart;
      const b = Math.min(r.end, pieceStart + piece.length - 1) - pieceStart;
      if (b < a || pos + (b - a + 1) > out.length) return null;
      out.set(piece.subarray(a, b + 1), pos);
      pos += b - a + 1;
    }
    if (pos !== out.length) return null;
    return cacheResponse(req, data, meta, r, out, 'hit');
  }

  private async learnSize(id: string, res: Response): Promise<void> {
    const total = Number(/\/(\d+)$/.exec(res.headers.get('Content-Range') ?? '')?.[1]);
    if (!Number.isSafeInteger(total) || total <= 0) return;
    await this.store.put(`cache:${id}`, { size: total, head: 0, tail: 0, type: res.headers.get('Content-Type') ?? undefined } satisfies CacheMeta);
    await this.remember(id);
  }

  /** Anota un archivo más en la caché y olvida los más viejos si se pasa de `CACHE_FILES`. */
  private async remember(id: string): Promise<void> {
    const index = (await this.store.get<string[]>('cacheIndex')) ?? [];
    if (index.includes(id)) return;
    index.push(id);
    while (index.length > CACHE_FILES) {
      const old = index.shift()!;
      // Primero la descripción: sin ella nadie lee los trozos que se están borrando.
      await this.store.delete(`cache:${old}`);
      const keys = [
        ...Array.from({ length: CACHE_HEAD_PIECES + CACHE_TAIL_PIECES }, (_, i) => `cache:${old}:h${i}`),
        ...Array.from({ length: CACHE_TAIL_PIECES }, (_, i) => `cache:${old}:t${i}`),
      ];
      await Promise.all(keys.map((k) => this.store.delete(k)));
    }
    await this.store.put('cacheIndex', index);
  }
}

/** Lo que lleva un pase: el id de Drive, el tipo a devolver, cuándo vence y el peso (si se sabe). */
interface Pass {
  f: string;
  t: string;
  u: number;
  s?: number;
}

interface ByteRange {
  start: number;
  end: number;
}

/** Un pedido `bytes=a-b`, `bytes=a-` o `bytes=-n` sobre un archivo de `size` bytes; `null` si no se puede servir. */
function byteRange(a: string, b: string, size: number): ByteRange | null {
  if (a === '') {
    const n = Number(b);
    if (!(n > 0)) return null;
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(a);
  const end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return null;
  return { start, end };
}

/** Qué se guarda de un archivo: el principio y el final, o entero si es chico. */
function cacheZones(size: number): { head: number; tail: number } {
  const all = (CACHE_HEAD_PIECES + CACHE_TAIL_PIECES) * CACHE_PIECE;
  if (size <= all) return { head: size, tail: 0 };
  return { head: CACHE_HEAD_PIECES * CACHE_PIECE, tail: CACHE_TAIL_PIECES * CACHE_PIECE };
}

// Lo que se sirve nunca corre como página en la dirección del portero (un HTML o un SVG subido).
function mediaHeaders(): Headers {
  return new Headers({
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'sandbox',
  });
}

function cacheResponse(req: Request, data: Pass, meta: CacheMeta, r: ByteRange, body: Uint8Array<ArrayBuffer>, how: 'hit' | 'fill'): Response {
  const out = mediaHeaders();
  out.set('Content-Type', data.t || meta.type || 'application/octet-stream');
  out.set('Content-Length', String(body.length));
  out.set('Content-Range', `bytes ${r.start}-${r.end}/${meta.size}`);
  if (meta.etag) out.set('ETag', meta.etag);
  if (meta.modified) out.set('Last-Modified', meta.modified);
  // Para medir desde el navegador (herramientas de desarrollo): si salió de la caché o de Drive.
  out.set('X-Portero-Cache', how);
  return new Response(req.method === 'HEAD' ? null : body, { status: 206, headers: out });
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
