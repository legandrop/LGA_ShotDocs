import type { SupabaseClient } from '@supabase/supabase-js';

// Cliente del portero de archivos del workspace (ver portero/src/core.ts): el estado de la conexión con
// el Drive del dueño, las subidas por partes y los pases para ver un archivo. Sin React, para poder
// probarlo: `fetch`, el token y la espera entre reintentos se pueden cambiar.

/**
 * Tamaño de cada parte de una subida. Drive pide múltiplos de 256 KiB (salvo la última) y el portero
 * acepta hasta 64 MB por pedido; 8 MiB es poco para repetir si se corta la red del teléfono.
 */
export const PART_BYTES = 8 * 1024 * 1024;
/** Reintentos seguidos de una misma parte antes de rendirse. */
export const MAX_RETRIES = 8;
const MAX_WAIT_MS = 30_000;

export interface DriveStatus {
  connected: boolean;
  /** Por qué dejó de andar la conexión (hay que volver a conectar); `null` si anda o no hay. */
  broken: string | null;
  /** La cuenta de Google conectada; solo la ve el dueño. */
  email: string | null;
  isOwner: boolean;
  /**
   * Dónde está la carpeta `LGA_ShotDocs` (solo se le dice al dueño): la carpeta de Drive elegida, o `null`
   * si va en la raíz de *My Drive*. Un portero anterior al paso 8 no lo manda.
   */
  folder?: { id: string; name: string } | null;
  /** El portero tiene la clave del selector de carpetas de Google (`GOOGLE_API_KEY`). */
  picker?: boolean;
}

/** Lo que necesita el selector de carpetas de Google (Google Picker) en el navegador del dueño. */
export interface PickerConfig {
  apiKey: string;
  /** El número del proyecto de Google Cloud. */
  appId: string;
  /** Token de acceso de Google de corta duración, solo con `drive.file`. */
  token: string;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

/** El resultado de una subida. `linked: false`: terminó en Drive pero la base todavía no se enteró. */
export interface UploadResult extends DriveFile {
  linked?: boolean;
}

/** Un archivo de la app (fila de `files`): el portero lo sube a `LGA_ShotDocs/<Proyecto>/<day>`. */
export interface AppFile {
  /** El id de la fila de `files` (uuid creado en el dispositivo). */
  id: string;
  /** El día local en que se agregó, `AAAA-MM-DD`: la carpeta del día en Drive. */
  day: string;
}

/** La respuesta de `POST /trash`. */
export interface TrashResult {
  status: 'done';
  file: string;
  drive: 'trashed' | 'missing' | 'none';
}

export interface UploadProgress {
  /** El pedido del portero para esta subida: con él se puede retomar (`resume`). */
  uploadId: string;
  sent: number;
  total: number;
  /** Promedio desde que arrancó este intento, sin contar lo que ya estaba subido al retomar. */
  bytesPerSecond: number;
  retries: number;
}

export interface UploadOptions {
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
  /** Una subida que quedó a medias: se pregunta cuánto llegó y se sigue desde ahí. */
  resume?: string | null;
  /** Sube un archivo de la app (con permisos por página); sin esto, la prueba de media (solo el dueño). */
  appFile?: AppFile;
  /**
   * El archivo ya llegó a Drive y solo falta que la base se entere: se le pregunta al portero (que le avisa
   * a la base) pero nunca se vuelve a mandar el archivo. Si el portero abriría una subida nueva, falla con
   * `AlreadySentError` sin mandar nada.
   */
  onlyIfSent?: boolean;
}

export interface PorteroDeps {
  fetch?: typeof fetch;
  /** El token de la sesión de Supabase; se pide en cada pedido porque se renueva solo. */
  token?: () => Promise<string | null>;
  /** La espera entre reintentos (las pruebas no esperan de verdad). */
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * `retryable`: puede andar si se repite (se cortó la red, el portero o Drive fallaron un momento). `code`: el
 * código que manda el portero con algunos errores (por ejemplo `in_use` o `drive_not_connected` en `/trash`).
 */
export class PorteroError extends Error {
  constructor(
    message: string,
    readonly status = 0,
    readonly retryable = false,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'PorteroError';
  }
}

/** La subida no terminó. Con `uploadId` se puede retomar; sin él hay que empezar de nuevo. */
export class UploadError extends PorteroError {
  constructor(
    message: string,
    status: number,
    readonly uploadId: string | null,
    readonly sent: number,
    readonly cancelled = false,
  ) {
    super(message, status, false);
    this.name = 'UploadError';
  }
}

/** Con `onlyIfSent`, el portero no sabe que el archivo ya llegó y abriría una subida nueva. */
export class AlreadySentError extends PorteroError {
  constructor() {
    super('The media server does not know this file reached Google Drive.', 409, false);
    this.name = 'AlreadySentError';
  }
}

/** El token de la sesión del workspace; se pide en cada pedido porque se renueva solo. */
export function sessionToken(client: SupabaseClient): () => Promise<string | null> {
  return async () => (await client.auth.getSession()).data.session?.access_token ?? null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const done = () => {
      signal?.removeEventListener('abort', stop);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const stop = () => {
      clearTimeout(timer);
      reject(abortError(signal!));
    };
    signal?.addEventListener('abort', stop, { once: true });
  });
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Cancelled', 'AbortError');
}

/** 1 s, 2 s, 4 s… con un tope de 30 s. */
export function retryDelay(failures: number): number {
  return Math.min(1000 * 2 ** Math.max(0, failures - 1), MAX_WAIT_MS);
}

/** La dirección del portero, de `workspace_settings.media_url`; `null` si el workspace no tiene. */
export async function readMediaUrl(client: SupabaseClient): Promise<string | null> {
  const { data, error } = await client.from('workspace_settings').select('*').maybeSingle();
  if (error) throw new PorteroError(`Could not read the workspace settings (${error.message}).`);
  const url = (data as { media_url?: string | null } | null)?.media_url;
  return url ? url.replace(/\/+$/, '') : null;
}

type ChunkAnswer = { status: 'incomplete'; received: number } | { status: 'done'; file: DriveFile; linked?: boolean };

/** El día local de una fecha, `AAAA-MM-DD` (la carpeta del día en Drive). */
export function localDay(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export class Portero {
  private readonly http: typeof fetch;
  private readonly token: () => Promise<string | null>;
  private readonly wait: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(
    readonly baseUrl: string,
    deps: PorteroDeps = {},
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    // `fetch` suelto pierde su `this` en Safari: se llama siempre como función global.
    this.http = deps.fetch ?? ((input, init) => fetch(input, init));
    this.token = deps.token ?? (async () => null);
    this.wait = deps.wait ?? sleep;
  }

  status(): Promise<DriveStatus> {
    return this.request<DriveStatus>('GET', '/drive/status');
  }

  /**
   * La dirección de Google para autorizar el Drive del dueño: la app navega ahí. Al terminar, Google vuelve
   * a `returnTo` (una ruta de la app, `/…`; sin ella, `/media-test`) con `?drive=<resultado>`.
   */
  async connect(returnTo?: string): Promise<string> {
    return (await this.request<{ url: string }>('POST', '/drive/connect', { json: returnTo ? { return: returnTo } : {} })).url;
  }

  /**
   * Una dirección para `<video src>` o `<img src>`, que vence a las 8 horas. `{ file }`: un archivo de la
   * app (con el tipo de `files.mime`); un texto o `{ fileId }`: un archivo de Drive por su id (la prueba de
   * media, solo el dueño). `type` fuerza el Content-Type que se devuelve.
   */
  async pass(target: string | { file: string } | { fileId: string }, type?: string): Promise<string> {
    const ref = typeof target === 'string' ? { fileId: target } : target;
    return (await this.request<{ url: string }>('POST', '/pass', { json: type ? { ...ref, type } : ref })).url;
  }

  /** Lo que necesita el selector de carpetas de Google (solo el dueño; 404 si el portero no tiene la clave). */
  picker(): Promise<PickerConfig> {
    return this.request<PickerConfig>('POST', '/drive/picker', { json: {} });
  }

  /**
   * Dónde va la carpeta `LGA_ShotDocs`: adentro de la carpeta de Drive `parentId`, o en la raíz de *My
   * Drive* (`null`). Si ya existe, el portero la mueve ahí. Solo el dueño.
   */
  async setFolder(parentId: string | null): Promise<{ id: string; name: string } | null> {
    return (await this.request<{ folder: { id: string; name: string } | null }>('POST', '/drive/folder', { json: { parentId } }))
      .folder;
  }

  /**
   * Manda un archivo de la papelera de la app a la papelera de Drive (`POST /trash`): la base decide si se
   * puede (solo dueño y admins, y solo si está en la papelera) y el portero lo mueve, nunca lo borra (Drive
   * lo guarda 30 días). `drive`: `trashed` (quedó en la papelera de Drive), `missing` (en Drive ya no estaba)
   * o `none` (nunca terminó de subirse). Pedirlo de nuevo no hace nada de más. Errores (`PorteroError` con
   * el estado y, si lo manda, el código): 403 sin permiso o si el archivo de Drive no es ese; 404 si no
   * existe; 409 con `code: 'in_use'` si una página lo volvió a usar; 503 con `code: 'drive_not_connected'`;
   * 502 si Drive falló (se puede volver a pedir).
   */
  async trash(file: string): Promise<TrashResult> {
    return this.request<TrashResult>('POST', '/trash', { json: { file } });
  }

  /**
   * Sube el archivo por partes, leyendo del disco solo la parte que se manda. Si una parte falla por la
   * red o por el servidor, espera, pregunta cuánto llegó y sigue desde ahí.
   */
  async upload(file: Blob & { name?: string }, options: UploadOptions = {}): Promise<UploadResult> {
    const { onProgress, signal, appFile, onlyIfSent } = options;
    const total = file.size;
    let uploadId = options.resume ?? null;
    // Al retomar, primero se pregunta; si el portero ya no la tiene, se empieza de nuevo.
    let ask = !!uploadId;
    let resuming = ask;
    let sent = 0;
    let startedAt = 0;
    let sentAtStart = 0;
    let failures = 0;
    let retries = 0;

    const report = () => {
      if (!uploadId || !onProgress) return;
      const seconds = startedAt ? (Date.now() - startedAt) / 1000 : 0;
      const bytesPerSecond = seconds > 0 ? Math.max(0, sent - sentAtStart) / seconds : 0;
      onProgress({ uploadId, sent, total, bytesPerSecond, retries });
    };
    const begin = () => {
      startedAt = Date.now();
      sentAtStart = sent;
      report();
    };

    for (;;) {
      try {
        if (signal?.aborted) throw abortError(signal);
        if (!uploadId) {
          const meta = { name: file.name || 'file', mime: file.type || 'application/octet-stream', size: total };
          const started = await this.request<{ uploadId?: string } & Partial<ChunkAnswer>>('POST', '/upload', {
            json: appFile ? { file: appFile.id, ...meta, day: appFile.day } : meta,
            signal,
          });
          // Un archivo de la app que ya está en Drive (lo subió otro intento): no hay nada que mandar.
          if (started.status === 'done' && started.file) {
            sent = total;
            return { ...started.file, ...(started.linked === undefined ? {} : { linked: started.linked }) };
          }
          // Una respuesta que no se entiende no es "sin red" (status 0): es un problema del portero.
          if (!started.uploadId) throw new PorteroError('The media server did not start the upload.', 502, true);
          if (onlyIfSent) throw new AlreadySentError();
          uploadId = started.uploadId;
          sent = 0;
          begin();
        }
        let answer: ChunkAnswer;
        const asked = ask;
        if (ask) {
          answer = await this.chunk(uploadId, `bytes */${total}`, null, signal);
          ask = false;
          if (resuming) {
            resuming = false;
            if (answer.status === 'incomplete') sent = answer.received;
            begin();
          }
        } else {
          const end = Math.min(sent + PART_BYTES, total);
          answer = await this.chunk(uploadId, `bytes ${sent}-${end - 1}/${total}`, file.slice(sent, end), signal);
          if (answer.status === 'incomplete' && answer.received <= sent) {
            throw new PorteroError('The part did not arrive.', 0, true);
          }
        }
        if (answer.status === 'done') {
          sent = total;
          report();
          return { ...answer.file, ...(answer.linked === undefined ? {} : { linked: answer.linked }) };
        }
        sent = answer.received;
        // Solo una parte que llegó corta la racha de fallas; la pregunta de cuánto llegó no.
        if (!asked) failures = 0;
        report();
      } catch (err) {
        if (err instanceof AlreadySentError) throw err;
        if (signal?.aborted) throw new UploadError('Upload cancelled.', 0, uploadId, sent, true);
        const error =
          err instanceof PorteroError ? err : new PorteroError(err instanceof Error ? err.message : String(err));
        // Al retomar, una subida que el portero ya no tiene se empieza de cero.
        if (resuming && (error.status === 404 || error.status === 410)) {
          uploadId = null;
          ask = resuming = false;
          continue;
        }
        if (!error.retryable) {
          const lost = error.status === 404 || error.status === 410;
          throw new UploadError(error.message, error.status, lost ? null : uploadId, sent);
        }
        if (failures >= MAX_RETRIES) {
          throw new UploadError(
            `The upload stopped after ${MAX_RETRIES} failed retries in a row: ${error.message}`,
            error.status,
            uploadId,
            sent,
          );
        }
        failures++;
        retries++;
        report();
        try {
          await this.wait(retryDelay(failures), signal);
        } catch {
          throw new UploadError('Upload cancelled.', 0, uploadId, sent, true);
        }
        // No se sabe cuánto de la parte llegó antes del corte: se pregunta antes de seguir.
        if (uploadId) ask = true;
      }
    }
  }

  private chunk(uploadId: string, range: string, body: Blob | null, signal?: AbortSignal): Promise<ChunkAnswer> {
    return this.request<ChunkAnswer>('PUT', `/upload/${encodeURIComponent(uploadId)}`, {
      headers: { 'Content-Range': range },
      body,
      signal,
    });
  }

  private async request<T>(
    method: string,
    path: string,
    init: { json?: unknown; body?: Blob | null; headers?: Record<string, string>; signal?: AbortSignal } = {},
  ): Promise<T> {
    const token = await this.token();
    if (!token) throw new PorteroError('Sign in to the app first.', 401);
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, ...init.headers };
    let body: BodyInit | null = init.body ?? null;
    if (init.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(init.json);
    }
    let res: Response;
    let data: { error?: string; code?: string } | null = null;
    try {
      res = await this.http(`${this.baseUrl}${path}`, { method, headers, body, signal: init.signal });
      data = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
    } catch (err) {
      if (init.signal?.aborted) throw abortError(init.signal);
      throw new PorteroError(`No connection with the media server (${err instanceof Error ? err.message : err}).`, 0, true);
    }
    if (!res.ok) {
      const status = res.status;
      // Un 5xx, un tiempo agotado (408) o demasiados pedidos (429) pueden andar si se repiten; los demás 4xx no.
      const retryable = status >= 500 || status === 408 || status === 429;
      const code = typeof data?.code === 'string' ? data.code : undefined;
      throw new PorteroError(data?.error ?? `The media server answered ${status}.`, status, retryable, code);
    }
    if (data === null) throw new PorteroError('The media server gave an answer that could not be read.', res.status, true);
    return data as T;
  }
}

/** El portero del workspace, o `null` si todavía no tiene. */
export async function openPortero(client: SupabaseClient, deps: PorteroDeps = {}): Promise<Portero | null> {
  const url = await readMediaUrl(client);
  return url ? new Portero(url, { token: sessionToken(client), ...deps }) : null;
}
