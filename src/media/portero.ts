import type { SupabaseClient } from '@supabase/supabase-js';
// Los mensajes van en inglés (se guardan con la subida); se traducen al mostrarlos (`localize`).
import { stored as t } from '../i18n';

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
/**
 * Lo más que puede tardar en contestar un pedido de control de una subida (abrirla, preguntar cuánto llegó).
 * No llevan casi nada de cuerpo: lo que tardan es el portero más Drive (uno a cinco segundos, aun creando
 * las carpetas), no la velocidad de la red. Un minuto sin respuesta es un pedido colgado.
 */
export const CONTROL_TIMEOUT_MS = 60_000;
/**
 * Una parte se da por trabada si en este tiempo no salió **ni un byte** más ni llegó la respuesta. No es un
 * tope para la parte entera: con una red lenta la parte tarda lo que tarde, mientras sigan saliendo bytes.
 * Dos minutos cubren el silencio normal del final (el portero le pasa la parte a Drive y Drive la guarda:
 * segundos) y lo que el sistema ya dio por enviado pero sigue saliendo por una red muy lenta, y es la mitad
 * o menos de lo que tardaba en cortar solo el navegador (5 a 9 minutos medidos).
 */
export const STALL_MS = 120_000;
/** Cada cuánto mira el vigilante si el pedido se sigue moviendo. */
export const STALL_CHECK_MS = 5_000;
/**
 * Si entre dos miradas del vigilante pasa más que esto, el equipo estuvo suspendido (o la pestaña congelada)
 * y ese tiempo no se cuenta. No puede ser mucho más chico: con la pestaña en segundo plano el navegador deja
 * correr los temporizadores una vez por minuto, y ahí el vigilante tiene que seguir cortando.
 */
export const FROZEN_GAP_MS = 90_000;
/** Una red lenta: la misma con la que se calculan los topes de las consultas a la base (`remote.ts`). */
const SLOW_BYTES_PER_SECOND = 16 * 1024;

/**
 * Lo que se espera la respuesta de una parte que ya salió entera. Ahí no hay bytes que avisen, y "salió" es
 * lo que dice el navegador: detrás de un antivirus o un proxy que recibe el cuerpo de golpe, la parte puede
 * seguir subiendo despacio mucho después. Por eso cada trabada seguida sin avance (`stalledBefore`) le da
 * `STALL_MS` más al intento siguiente, y así una subida lenta termina pasando en vez de cortarse siempre en
 * el mismo lugar. El techo es lo que tardaría la parte entera con una red lenta: más que eso es un pedido
 * colgado, y la cola no lo espera (8 MiB: unos 10 minutos y medio; una foto de 3 MB: 5).
 */
export function answerLimit(bytes: number, stalledBefore = 0): number {
  const slowest = STALL_MS + Math.ceil((bytes / SLOW_BYTES_PER_SECOND) * 1000);
  return Math.min(STALL_MS * (1 + Math.max(0, stalledBefore)), slowest);
}

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
  /** Lo que entiende además de lo de siempre (`verify`, `known`, `offline`, `codes`); un portero anterior no lo manda. */
  features?: string[];
}

/** Lo que responde `POST /verify` por archivo (portero/src/core.ts). */
export type VerifyResult =
  | { driveId: string; size: number; trashed: boolean; marked: boolean; md5: string | null }
  | { error: string; code: string };

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
  /**
   * Al retomar (`resume`): si esa subida contesta que todavía no recibió nada, se abre otra en vez de seguir
   * con ella (para una que se trabó varias veces sin avanzar). No se pierde nada, y una subida que ya terminó
   * o que ya recibió algo se sigue usando siempre: por eso se le pregunta primero. Queda un caso que la
   * pregunta no ve: si algo en el medio (un proxy) recibió el cuerpo entero y lo sigue mandando después de
   * cortado el pedido, la subida vieja contesta 0, se abre otra y la vieja termina más tarde. Deja una copia
   * de más en el Drive; no se pierde nada y la base apunta a una sola.
   */
  renewIfEmpty?: boolean;
  /**
   * Cuántas veces seguidas ya se trabó esta subida sin avanzar: a la respuesta de cada parte se le da ese
   * tanto más de plazo (ver `answerLimit`).
   */
  stalledBefore?: number;
}

/**
 * Manda una parte de una subida avisando cuántos bytes van saliendo (`onSent`, el total de la parte hasta
 * ahí). Es lo que le permite al vigilante distinguir una red lenta de un pedido colgado.
 */
export type PartSender = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: Blob; signal?: AbortSignal; onSent: (bytes: number) => void },
) => Promise<Response>;

export interface PorteroDeps {
  fetch?: typeof fetch;
  /**
   * Cómo se mandan las partes. Por defecto, `XMLHttpRequest` (`xhrSend`). Con un `fetch` propio y sin esto
   * (las pruebas), o donde no hay `XMLHttpRequest`, las partes van por `fetch` y no se vigilan: sin saber
   * cuántos bytes salieron no se puede distinguir lento de colgado.
   */
  send?: PartSender;
  /** El token de la sesión de Supabase; se pide en cada pedido porque se renueva solo. */
  token?: () => Promise<string | null>;
  /** La espera entre reintentos (las pruebas no esperan de verdad). */
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** El reloj (las pruebas lo adelantan). */
  now?: () => number;
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

/**
 * La subida no terminó. Con `uploadId` se puede retomar; sin él hay que empezar de nuevo. `stalled`: se
 * cortó porque un pedido dejó de moverse (ver `STALL_MS`), no porque fallara.
 */
export class UploadError extends PorteroError {
  constructor(
    message: string,
    status: number,
    readonly uploadId: string | null,
    readonly sent: number,
    readonly cancelled = false,
    readonly stalled = false,
  ) {
    super(message, status, false);
    this.name = 'UploadError';
  }
}

/** Un pedido que dejó de moverse: lo cortó el vigilante. 408 (tiempo agotado): se puede volver a pedir. */
class StalledError extends PorteroError {
  constructor() {
    super(t('portero.stalled'), 408, true);
    this.name = 'StalledError';
  }
}

/** Con `onlyIfSent`, el portero no sabe que el archivo ya llegó y abriría una subida nueva. */
export class AlreadySentError extends PorteroError {
  constructor() {
    super(t('portero.alreadySent'), 409, false);
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

/**
 * El resultado de `work`, o un rechazo apenas se aborta `signal`: así un pedido vigilado se suelta aunque
 * alguno de sus pasos no escuche la señal (pedir el token de la sesión, por ejemplo, no la recibe).
 */
function untilAborted<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(abortError(signal));
    if (signal.aborted) {
      // Lo que `work` haga después ya no le importa a nadie: que su rechazo no quede sin atender.
      work.catch(() => undefined);
      return stop();
    }
    signal.addEventListener('abort', stop, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}

/**
 * Manda una parte con `XMLHttpRequest`. Es lo único del navegador que avisa cuántos bytes del cuerpo van
 * saliendo (`upload.onprogress`); `fetch` no dice nada hasta que llega la respuesta, y con una red lenta eso
 * es indistinguible de un pedido colgado. Devuelve una `Response` para que el resto no note la diferencia.
 */
export const xhrSend: PartSender = (url, init) =>
  new Promise<Response>((resolve, reject) => {
    const { signal } = init;
    if (signal?.aborted) return reject(abortError(signal));
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const settle = () => signal?.removeEventListener('abort', abort);
    xhr.open(init.method, url);
    for (const [name, value] of Object.entries(init.headers)) xhr.setRequestHeader(name, value);
    xhr.responseType = 'text';
    xhr.upload.onprogress = (event) => init.onSent(event.loaded);
    // Por si el último `progress` no llegó a contar el final: el cuerpo ya salió entero.
    xhr.upload.onload = () => init.onSent(init.body.size);
    xhr.onload = () => {
      settle();
      // Estos estados no pueden llevar cuerpo en una `Response`.
      const empty = xhr.status === 204 || xhr.status === 205 || xhr.status === 304;
      try {
        resolve(
          new Response(empty ? null : xhr.responseText, {
            status: xhr.status,
            headers: { 'Content-Type': xhr.getResponseHeader('Content-Type') ?? 'application/json' },
          }),
        );
      } catch (err) {
        reject(err);
      }
    };
    xhr.onerror = () => {
      settle();
      // El mismo tipo de error que tira `fetch` cuando se corta la red.
      reject(new TypeError('Failed to fetch'));
    };
    xhr.onabort = () => {
      settle();
      reject(signal?.aborted ? abortError(signal) : new DOMException('Cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    xhr.send(init.body);
  });

/** Lo que el vigilante le da a un pedido: la señal con la que lo corta y cómo avisarle que se movió. */
interface Watch {
  readonly signal: AbortSignal;
  /** Lo cortó el vigilante (no quien llama). */
  readonly stalled: boolean;
  /** Salieron más bytes del cuerpo; `done`: ya salió entero y solo falta la respuesta. */
  moved(done: boolean): void;
  stop(): void;
}

/** 1 s, 2 s, 4 s… con un tope de 30 s. */
export function retryDelay(failures: number): number {
  return Math.min(1000 * 2 ** Math.max(0, failures - 1), MAX_WAIT_MS);
}

/** La dirección del portero, de `workspace_settings.media_url`; `null` si el workspace no tiene. */
export async function readMediaUrl(client: SupabaseClient): Promise<string | null> {
  const { data, error } = await client.from('workspace_settings').select('*').maybeSingle();
  if (error) throw new PorteroError(t('portero.settings', { reason: error.message }));
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
  private readonly send: PartSender | null;
  private readonly now: () => number;

  constructor(
    readonly baseUrl: string,
    deps: PorteroDeps = {},
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    // `fetch` suelto pierde su `this` en Safari: se llama siempre como función global.
    this.http = deps.fetch ?? ((input, init) => fetch(input, init));
    // Quien pasa su propio `fetch` quiere todos los pedidos por ahí (las pruebas): las partes no se desvían.
    this.send = deps.send ?? (!deps.fetch && typeof XMLHttpRequest !== 'undefined' ? xhrSend : null);
    this.token = deps.token ?? (async () => null);
    this.wait = deps.wait ?? sleep;
    this.now = deps.now ?? (() => Date.now());
  }

  status(): Promise<DriveStatus> {
    return this.request<DriveStatus>('GET', '/drive/status');
  }

  /**
   * La dirección de Google para autorizar el Drive del dueño: la app navega ahí. Al terminar, Google vuelve
   * a `returnTo` (una ruta de la app, `/…`; sin ella, el portero vuelve a `/media-test`, que hoy abre la app)
   * con `?drive=<resultado>`.
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

  /**
   * Un pase y si el portero le pone el nombre del archivo a las descargas (`named`: un portero actualizado para
   * los adjuntos, Docs/Doc_Adjuntos.md; uno viejo no lo dice y baja con un nombre feo).
   */
  async passInfo(target: { file: string }): Promise<{ url: string; named: boolean }> {
    const body = await this.request<{ url: string; named?: unknown }>('POST', '/pass', { json: target });
    return { url: body.url, named: body.named === true };
  }

  /**
   * Lo que dice Drive hoy de cada archivo (`POST /verify`, hasta 15 por pedido): id de Drive, peso, papelera,
   * marca y MD5, o el error con su `code`. Solo un portero que anuncia `verify` en `features`.
   */
  async verify(files: string[]): Promise<Record<string, VerifyResult>> {
    return (await this.request<{ results: Record<string, VerifyResult> }>('POST', '/verify', { json: { files } })).results;
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
   *
   * Ningún pedido puede quedar esperando para siempre: los de control tienen un tope fijo
   * (`CONTROL_TIMEOUT_MS`) y una parte se corta si deja de moverse (`STALL_MS` sin que salga un byte ni
   * llegue la respuesta). Un pedido cortado así no se reintenta acá: la subida termina con un `UploadError`
   * con `stalled` y lo enviado, para que quien llama siga con otra cosa y la retome más tarde.
   */
  async upload(file: Blob & { name?: string }, options: UploadOptions = {}): Promise<UploadResult> {
    const { onProgress, signal, appFile, onlyIfSent, renewIfEmpty, stalledBefore = 0 } = options;
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
      const seconds = startedAt ? (this.now() - startedAt) / 1000 : 0;
      const bytesPerSecond = seconds > 0 ? Math.max(0, sent - sentAtStart) / seconds : 0;
      onProgress({ uploadId, sent, total, bytesPerSecond, retries });
    };
    const begin = () => {
      startedAt = this.now();
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
            stallMs: CONTROL_TIMEOUT_MS,
          });
          // Un archivo de la app que ya está en Drive (lo subió otro intento): no hay nada que mandar.
          if (started.status === 'done' && started.file) {
            sent = total;
            return { ...started.file, ...(started.linked === undefined ? {} : { linked: started.linked }) };
          }
          // Una respuesta que no se entiende no es "sin red" (status 0): es un problema del portero.
          if (!started.uploadId) throw new PorteroError(t('portero.notStarted'), 502, true);
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
            if (answer.status === 'incomplete') {
              // Se trabó varias veces sin avanzar y no recibió nada: se abre otra. Recién acá, con su
              // respuesta en la mano: si ya hubiera terminado (la última parte llegó y la respuesta se
              // perdió), abrir otra sin preguntar dejaría el archivo dos veces en Drive.
              if (renewIfEmpty && answer.received === 0) {
                uploadId = null;
                continue;
              }
              sent = answer.received;
            }
            begin();
          }
        } else {
          const end = Math.min(sent + PART_BYTES, total);
          answer = await this.chunk(uploadId, `bytes ${sent}-${end - 1}/${total}`, file.slice(sent, end), signal, stalledBefore);
          if (answer.status === 'incomplete' && answer.received <= sent) {
            throw new PorteroError(t('portero.partLost'), 0, true);
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
        if (signal?.aborted) throw new UploadError(t('mediaTest.cancelled'), 0, uploadId, sent, true);
        // Un pedido que dejó de moverse no se reintenta acá (cada intento puede volver a tardar lo mismo):
        // se devuelve con lo enviado, y quien llama decide cuándo retomar.
        if (err instanceof StalledError) throw new UploadError(err.message, err.status, uploadId, sent, false, true);
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
            t('portero.retries', { max: MAX_RETRIES, reason: error.message }),
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
          throw new UploadError(t('mediaTest.cancelled'), 0, uploadId, sent, true);
        }
        // No se sabe cuánto de la parte llegó antes del corte: se pregunta antes de seguir.
        if (uploadId) ask = true;
      }
    }
  }

  private chunk(
    uploadId: string,
    range: string,
    body: Blob | null,
    signal?: AbortSignal,
    stalledBefore = 0,
  ): Promise<ChunkAnswer> {
    return this.request<ChunkAnswer>('PUT', `/upload/${encodeURIComponent(uploadId)}`, {
      headers: { 'Content-Range': range },
      body,
      signal,
      // La pregunta de cuánto llegó es un pedido de control. Una parte se vigila por los bytes que salen, y
      // eso solo se sabe con `send`: sin él queda como antes (sin tope), porque un tope por tiempo cortaría
      // también las partes que van lentas pero bien.
      stallMs: body ? (this.send ? STALL_MS : undefined) : CONTROL_TIMEOUT_MS,
      answerMs: body ? answerLimit(body.size, stalledBefore) : undefined,
    });
  }

  /**
   * El vigilante de un pedido: lo corta si pasan `limitMs` sin que se mueva. Un pedido de control no avisa
   * nada, así que `limitMs` es su tope; una parte avisa cada vez que salen bytes y el plazo vuelve a empezar.
   * `answerMs`: lo que se espera la respuesta de una parte que ya salió entera (ver `answerLimit`).
   */
  private watch(limitMs: number, outer?: AbortSignal, answerMs = limitMs): Watch {
    const controller = new AbortController();
    const startedAt = this.now();
    let lastMove = startedAt;
    let patience = limitMs;
    let stalled = false;
    const cancel = () => controller.abort(outer ? abortError(outer) : undefined);
    if (outer?.aborted) cancel();
    else outer?.addEventListener('abort', cancel, { once: true });
    let lastLook = startedAt;
    const timer = setInterval(() => {
      const now = this.now();
      // El vigilante estuvo sin mirar mucho más de lo que tarda entre dos miradas: el equipo estuvo
      // suspendido o la pestaña congelada. Ese tiempo no dice nada del pedido (tampoco él pudo moverse), así
      // que no cuenta: si quedó muerto, se corta cuando pase el plazo desde ahora.
      if (now - lastLook > FROZEN_GAP_MS) lastMove = Math.min(now, lastMove + (now - lastLook));
      lastLook = now;
      if (now - lastMove < patience) return;
      stalled = true;
      controller.abort();
    }, STALL_CHECK_MS);
    return {
      signal: controller.signal,
      get stalled() {
        return stalled;
      },
      moved: (done) => {
        lastMove = this.now();
        // Con el cuerpo entero afuera ya no hay bytes que avisen. A la respuesta se le da su plazo más lo
        // que tardó en salir el cuerpo: parte de lo "enviado" puede seguir en camino, y con una red lenta
        // (el cuerpo tardó mucho) eso también tarda más. Ese extra es a lo sumo otro `limitMs`, para que un
        // pedido colgado justo ahí no tenga a la cola esperando tanto como tardó la parte.
        if (done) patience = answerMs + Math.min(lastMove - startedAt, limitMs);
      },
      stop: () => {
        clearInterval(timer);
        outer?.removeEventListener('abort', cancel);
      },
    };
  }

  private async request<T>(
    method: string,
    path: string,
    init: {
      json?: unknown;
      body?: Blob | null;
      headers?: Record<string, string>;
      signal?: AbortSignal;
      /** Con esto el pedido se vigila: se corta (`StalledError`) si pasa este tiempo sin moverse. */
      stallMs?: number;
      /** Para una parte: lo que se espera la respuesta una vez que el cuerpo salió entero. */
      answerMs?: number;
    } = {},
  ): Promise<T> {
    const watch = init.stallMs ? this.watch(init.stallMs, init.signal, init.answerMs) : null;
    const signal = watch?.signal ?? init.signal;
    // Por qué se soltó el pedido: lo canceló quien llama, o lo cortó el vigilante.
    const interrupted = (): unknown =>
      init.signal?.aborted ? abortError(init.signal) : watch?.stalled ? new StalledError() : null;
    try {
      const token = await untilAborted(this.token(), signal).catch((err: unknown) => {
        throw interrupted() ?? err;
      });
      if (!token) throw new PorteroError(t('portero.signIn'), 401);
      const headers: Record<string, string> = { Authorization: `Bearer ${token}`, ...init.headers };
      let body: BodyInit | null = init.body ?? null;
      if (init.json !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(init.json);
      }
      const url = `${this.baseUrl}${path}`;
      let res: Response;
      let data: { error?: string; code?: string } | null = null;
      try {
        const part = init.body;
        if (part && this.send) {
          let out = 0;
          const onSent = (bytes: number) => {
            // Solo cuenta lo que avanza: un aviso repetido con la misma cantidad no es movimiento.
            if (bytes <= out) return;
            out = bytes;
            watch?.moved(bytes >= part.size);
          };
          res = await untilAborted(this.send(url, { method, headers, body: part, signal, onSent }), signal);
        } else {
          res = await untilAborted(this.http(url, { method, headers, body, signal }), signal);
        }
        data = await untilAborted(
          res.json().catch(() => null) as Promise<{ error?: string; code?: string } | null>,
          signal,
        );
      } catch (err) {
        throw (
          interrupted() ??
          new PorteroError(t('portero.noConnection', { reason: err instanceof Error ? err.message : String(err) }), 0, true)
        );
      }
      if (!res.ok) {
        const status = res.status;
        // Un 5xx, un tiempo agotado (408) o demasiados pedidos (429) pueden andar si se repiten; los demás 4xx no.
        const retryable = status >= 500 || status === 408 || status === 429;
        const code = typeof data?.code === 'string' ? data.code : undefined;
        throw new PorteroError(data?.error ?? t('portero.answered', { status }), status, retryable, code);
      }
      if (data === null) throw new PorteroError(t('portero.unreadable'), res.status, true);
      return data as T;
    } finally {
      watch?.stop();
    }
  }
}

/** El portero del workspace, o `null` si todavía no tiene. */
export async function openPortero(client: SupabaseClient, deps: PorteroDeps = {}): Promise<Portero | null> {
  const url = await readMediaUrl(client);
  return url ? new Portero(url, { token: sessionToken(client), ...deps }) : null;
}
