// "Download all" de una carpeta (P.9, entrega 2, Docs/Doc_Carpetas.md, sección 9). Dos pasos:
//
// 1. `planFolder`: recorre el árbol con `POST /folder/list` (el mismo permiso que el visor: quien ve la página ve y
//    baja lo de adentro, y el portero nunca deja salir de la carpeta) y arma la lista: cada archivo con su pase,
//    cada carpeta (también las vacías) y lo que no se puede bajar (accesos directos, documentos de Google, una
//    subcarpeta que no se pudo listar). Los nombres se limpian y se desambiguan acá (`zipNames.ts`).
// 2. `runDownload`: baja cada archivo por su pase (`/m/`, que deja leer la respuesta a la app por CORS) y lo
//    escribe en un zip (`zipWriter.ts`) o en una carpeta del disco, en orden. Lo que falla se saltea y se anota en
//    `MISSING_FILES.txt`, que va adentro del zip o de la carpeta. Se puede cancelar en cualquier momento.
//
// Los archivos chicos se piden de a varios por delante (`PREFETCH`), así miles de fotos no esperan cada una su
// pedido; los grandes se escriben a medida que llegan y, si la conexión se corta en el medio, se retoma desde donde
// quedó con `Range`. Un pase vence a las 8 horas: si una bajada larga llega a uno vencido, vuelve a listar esa
// subcarpeta para tener uno nuevo.

import { PorteroError, type FolderEntry, type FolderListing } from './portero';
import { NameSpace, safeName } from './zipNames';
import { ZipWriter, type ZipSink } from './zipWriter';
import type { CrcStream } from './crc32';

/** Lo que hace falta del portero: listar una carpeta (`media.porteroClient()`). */
export interface FolderLister {
  folderList(file: string, dir?: string | null, pageToken?: string | null): Promise<FolderListing>;
}

/** El nombre de la lista de lo que no se pudo bajar (en inglés, como la app; el texto de adentro va en su idioma). */
export const MISSING_NAME = 'MISSING_FILES.txt';

export interface PlanFile {
  /** La ruta limpia adentro de la carpeta (`Fotos/Dia 2/a.jpg`). */
  path: string;
  /** El id de Drive del archivo (para buscar su pase de nuevo). */
  id: string;
  /** La subcarpeta donde está (`null`: la carpeta). */
  dirId: string | null;
  name: string;
  size: number;
  url: string;
  modified: string | null;
}

export type MissingReason = 'shortcut' | 'google' | 'folder' | 'failed' | 'incomplete';

export interface MissingItem {
  path: string;
  reason: MissingReason;
  /** El motivo técnico (un código del portero, un estado HTTP), en inglés. */
  detail?: string;
}

export interface DownloadPlan {
  /** El nombre limpio de la carpeta: la carpeta de arriba del zip y el nombre del zip. */
  root: string;
  /** Las subcarpetas (rutas limpias), las de arriba primero. */
  dirs: { path: string; modified: string | null }[];
  files: PlanFile[];
  /** Lo que se sabe desde el listado que no se va a bajar. */
  skipped: MissingItem[];
  /** Lo que pesan los archivos. */
  bytes: number;
}

/** Cuánto lleva el listado. */
export interface PlanProgress {
  folders: number;
  files: number;
  bytes: number;
}

type Wait = (ms: number, signal?: AbortSignal) => Promise<void>;

const defaultWait: Wait = (ms, signal) =>
  new Promise((ok, fail) => {
    if (signal?.aborted) return fail(abortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', stop);
      ok();
    }, ms);
    const stop = () => {
      clearTimeout(timer);
      fail(abortError());
    };
    signal?.addEventListener('abort', stop, { once: true });
  });

function abortError(): Error {
  return new DOMException('The download was cancelled.', 'AbortError');
}

export function isAbort(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === 'AbortError';
}

/** Cuántas subcarpetas se listan a la vez. */
const LIST_PARALLEL = 4;
/** Lo más hondo que se baja (el portero ya corta en 30 al subir; Drive puede tener más). */
const MAX_DEPTH = 64;
/** Cuántas veces se espera cuando Drive pide ir más despacio, y cuánto la primera (después el doble). */
const RATE_TRIES = 5;
const RATE_WAIT_MS = 5_000;

interface Node {
  id: string | null;
  path: string;
  modified: string | null;
  entries: FolderEntry[];
  children: Node[];
  failed?: string;
}

/**
 * Recorre la carpeta entera con `/folder/list` y arma la lista de lo que se baja. Si no se puede listar la carpeta
 * misma, falla (con el error del portero); una subcarpeta que no se puede listar queda en `skipped`.
 */
export async function planFolder(
  lister: FolderLister,
  fileId: string,
  rootName: string,
  opts: { signal?: AbortSignal; onProgress?: (p: PlanProgress) => void; wait?: Wait } = {},
): Promise<DownloadPlan> {
  const wait = opts.wait ?? defaultWait;
  const seen = new Set<string>();
  const progress: PlanProgress = { folders: 0, files: 0, bytes: 0 };
  const root: Node = { id: null, path: '', modified: null, entries: [], children: [] };

  const listAll = async (node: Node): Promise<void> => {
    let token: string | null = null;
    do {
      const page = await withRate(() => lister.folderList(fileId, node.id, token), wait, opts.signal);
      node.entries.push(...page.entries);
      for (const e of page.entries) {
        if (e.type === 'file') {
          progress.files++;
          progress.bytes += e.size;
        }
      }
      opts.onProgress?.({ ...progress });
      token = page.nextPageToken;
    } while (token);
  };

  await listAll(root);
  // Las subcarpetas, de a `LIST_PARALLEL` a la vez. Los nombres se ponen después, en orden.
  const queue: { node: Node; entry: Extract<FolderEntry, { type: 'folder' }>; depth: number }[] = [];
  const enqueue = (node: Node, depth: number) => {
    for (const e of node.entries) if (e.type === 'folder') queue.push({ node, entry: e, depth });
  };
  enqueue(root, 1);
  const children = new Map<FolderEntry, Node>();
  const worker = async () => {
    while (queue.length) {
      if (opts.signal?.aborted) throw abortError();
      const { entry, depth } = queue.shift()!;
      const child: Node = { id: entry.id, path: '', modified: entry.modified, entries: [], children: [] };
      children.set(entry, child);
      if (seen.has(entry.id) || depth > MAX_DEPTH) {
        child.failed = seen.has(entry.id) ? 'loop' : 'too_deep';
        continue;
      }
      seen.add(entry.id);
      progress.folders++;
      try {
        await listAll(child);
        enqueue(child, depth + 1);
      } catch (err) {
        if (isAbort(err)) throw err;
        child.failed = err instanceof PorteroError ? (err.code ?? String(err.status)) : String(err);
      }
    }
  };
  // Cada trabajador sigue mientras haya algo en la cola; uno que termina temprano no frena a los demás.
  let running: Promise<void>[] = [];
  do {
    running = Array.from({ length: Math.min(LIST_PARALLEL, Math.max(queue.length, 1)) }, worker);
    await Promise.all(running);
  } while (queue.length);

  // El árbol en orden (primero las carpetas y después los archivos, como los lista Drive), con los nombres limpios.
  const names = new NameSpace();
  names.reserve('', MISSING_NAME);
  const plan: DownloadPlan = { root: safeName(rootName, 'Folder'), dirs: [], files: [], skipped: [], bytes: 0 };
  const walk = (node: Node) => {
    const join = (name: string) => (node.path ? `${node.path}/${name}` : name);
    for (const e of node.entries) {
      if (e.type !== 'folder') continue;
      const child = children.get(e)!;
      child.path = join(names.take(node.path, e.name, 'Folder'));
      plan.dirs.push({ path: child.path, modified: e.modified });
      if (child.failed) plan.skipped.push({ path: `${child.path}/`, reason: 'folder', detail: child.failed });
      else walk(child);
    }
    for (const e of node.entries) {
      if (e.type === 'folder') continue;
      const path = join(names.take(node.path, e.name, 'file'));
      if (e.type === 'file') {
        plan.files.push({ path, id: e.id, dirId: node.id, name: e.name, size: e.size, url: e.url, modified: e.modified });
        plan.bytes += e.size;
      } else plan.skipped.push({ path, reason: e.type === 'shortcut' ? 'shortcut' : 'google' });
    }
  };
  walk(root);
  return plan;
}

async function withRate<T>(work: () => Promise<T>, wait: Wait, signal?: AbortSignal): Promise<T> {
  for (let i = 0; ; i++) {
    if (signal?.aborted) throw abortError();
    try {
      return await work();
    } catch (err) {
      if (!(err instanceof PorteroError && err.code === 'rate') || i >= RATE_TRIES - 1) throw err;
      await wait(RATE_WAIT_MS * 2 ** i, signal);
    }
  }
}

// --- bajar ---------------------------------------------------------------------------------------------------

/** Un archivo del disco que se escribe de corrido. */
export interface FileOut {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  /** Lo deja sin escribir (y lo borra si se puede). */
  abort(): Promise<void>;
}

/** Adónde va la bajada: un zip, o una carpeta del disco con el árbol tal cual. */
export type DownloadTarget =
  | { kind: 'zip'; sink: ZipSink; crc?: () => CrcStream }
  | { kind: 'dir'; makeDir(path: string): Promise<void>; makeFile(path: string): Promise<FileOut> };

export interface DownloadProgress {
  files: number;
  filesDone: number;
  bytes: number;
  bytesDone: number;
  /** El archivo que se está bajando (la ruta limpia). */
  current: string | null;
  missing: number;
  /** Esperando que vuelva la conexión. */
  offline: boolean;
}

export interface DownloadResult {
  /** Los archivos que quedaron enteros. */
  done: number;
  bytes: number;
  /** Todo lo que no está (o no está entero), con lo que ya se sabía del listado. */
  missing: MissingItem[];
}

export interface DownloadDeps {
  fetch?: typeof fetch;
  wait?: Wait;
  /** Si hay conexión (por defecto, `navigator.onLine`). */
  online?: () => boolean;
  /** Espera a que vuelva la conexión (por defecto, el evento `online`). */
  whenOnline?: (signal?: AbortSignal) => Promise<void>;
  /** El pase nuevo de un archivo (cuando el que se tenía venció): vuelve a listar su subcarpeta. */
  refresh?: (file: PlanFile) => Promise<string | null>;
  /** El texto de `MISSING_FILES.txt`. */
  missingText: (items: MissingItem[]) => string;
}

/** Hasta este peso un archivo se pide por delante y se guarda entero en memoria mientras le toca. */
const SMALL = 4 * 1024 * 1024;
/** Cuántos archivos chicos se piden por delante. */
const PREFETCH = 4;
/** Reintentos de un archivo que no contesta o se corta, sin avanzar (después de eso, se saltea). */
const FILE_TRIES = 4;
const RETRY_MS = [1_000, 3_000, 9_000];

/** El destino (el disco) no dejó escribir: frena la bajada. */
class TargetFailed extends Error {
  constructor(readonly cause: unknown) {
    super('write failed');
  }
}

class FileFailed extends Error {
  constructor(
    readonly detail: string,
    readonly expired = false,
  ) {
    super(detail);
  }
}

/** Una respuesta abierta: el peso que dice y sus pedazos (con los reintentos por `Range` adentro). */
interface Opened {
  length: number | null;
  chunks: AsyncIterable<Uint8Array>;
}

/**
 * Baja lo que dice el plan al destino, en orden. Siempre termina con la lista de lo que falta (también adentro del
 * zip o de la carpeta, en `MISSING_FILES.txt`), salvo que se cancele (`AbortError`) o que el destino falle
 * (no se pudo escribir en el disco: el error sube).
 */
export async function runDownload(
  plan: DownloadPlan,
  target: DownloadTarget,
  deps: DownloadDeps,
  opts: { signal?: AbortSignal; onProgress?: (p: DownloadProgress) => void } = {},
): Promise<DownloadResult> {
  const signal = opts.signal;
  const http = deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const wait = deps.wait ?? defaultWait;
  const online = deps.online ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const whenOnline =
    deps.whenOnline ??
    ((s?: AbortSignal) =>
      new Promise<void>((ok, fail) => {
        if (s?.aborted) return fail(abortError());
        const done = () => {
          window.removeEventListener('online', done);
          s?.removeEventListener('abort', stop);
          ok();
        };
        const stop = () => {
          window.removeEventListener('online', done);
          fail(abortError());
        };
        window.addEventListener('online', done);
        s?.addEventListener('abort', stop, { once: true });
      }));

  const missing: MissingItem[] = [...plan.skipped];
  const progress: DownloadProgress = {
    files: plan.files.length,
    filesDone: 0,
    bytes: plan.bytes,
    bytesDone: 0,
    current: null,
    missing: missing.length,
    offline: false,
  };
  const report = () => opts.onProgress?.({ ...progress });
  let done = 0;
  let written = 0;

  /** Espera la conexión si se fue (sin contar como intento). */
  const ensureOnline = async () => {
    if (online()) return;
    progress.offline = true;
    report();
    await whenOnline(signal);
    progress.offline = false;
    report();
  };

  /** Pide el archivo desde `from` (con `Range` si no es el principio). */
  const request = async (file: PlanFile, from: number): Promise<Response> => {
    const headers: Record<string, string> = from > 0 ? { Range: `bytes=${from}-` } : {};
    const res = await http(file.url, { headers, signal, mode: 'cors', credentials: 'omit', cache: 'no-store' });
    if (res.ok) return res;
    let code = '';
    try {
      code = ((await res.json()) as { code?: string }).code ?? '';
    } catch {
      // sin cuerpo JSON
    }
    if (res.status === 403 && code === 'pass_expired') throw new FileFailed('pass_expired', true);
    if (res.status >= 500 || res.status === 429) throw new TypeError(`The media server answered ${res.status}.`);
    throw new FileFailed(code || `HTTP ${res.status}`);
  };

  /** Abre el archivo con sus reintentos; si no se puede, `FileFailed`. */
  const open = async (file: PlanFile): Promise<Opened> => {
    let refreshed = false;
    let fails = 0;
    for (;;) {
      if (signal?.aborted) throw abortError();
      await ensureOnline();
      try {
        const res = await request(file, 0);
        const header = Number(res.headers.get('Content-Length'));
        const length = Number.isSafeInteger(header) && header >= 0 && res.headers.get('Content-Length') !== null ? header : null;
        return { length, chunks: chunksOf(file, res, length ?? file.size) };
      } catch (err) {
        if (isAbort(err)) throw err;
        if (err instanceof FileFailed && err.expired && !refreshed && deps.refresh) {
          refreshed = true;
          const url = await deps.refresh(file).catch(() => null);
          if (url) {
            file.url = url;
            continue;
          }
        }
        if (err instanceof FileFailed) throw err;
        if (!online()) continue;
        if (++fails >= FILE_TRIES) throw new FileFailed(err instanceof Error ? err.message : String(err));
        await wait(RETRY_MS[Math.min(fails - 1, RETRY_MS.length - 1)]!, signal);
      }
    }
  };

  /**
   * Los pedazos del archivo. Si la respuesta se corta antes de `total`, pide lo que falta con `Range` (hasta
   * `FILE_TRIES` veces seguidas sin avanzar).
   */
  async function* chunksOf(file: PlanFile, first: Response, total: number): AsyncGenerator<Uint8Array> {
    let res: Response | null = first;
    let got = 0;
    let fails = 0;
    for (;;) {
      if (!res) {
        if (signal?.aborted) throw abortError();
        await ensureOnline();
        try {
          res = await request(file, got);
        } catch (err) {
          if (isAbort(err) || err instanceof FileFailed) throw err;
          if (!online()) continue;
          if (++fails >= FILE_TRIES) throw err;
          await wait(RETRY_MS[Math.min(fails - 1, RETRY_MS.length - 1)]!, signal);
          continue;
        }
        // Lo pedido desde `got`: un 206 tiene que empezar ahí; un 200 trae todo (se saltea lo que ya está).
        let skip = 0;
        if (res.status === 206) {
          const start = Number(/^bytes (\d+)-/.exec(res.headers.get('Content-Range') ?? '')?.[1]);
          if (start !== got) throw new FileFailed('range_mismatch');
        } else skip = got;
        res = skipping(res, skip);
      }
      const before = got;
      const reader = res.body?.getReader();
      try {
        if (!reader) throw new TypeError('No body.');
        for (;;) {
          const { value, done: end } = await reader.read();
          if (end) break;
          if (value?.length) {
            got += value.length;
            yield value;
          }
        }
        // Una respuesta que terminó: si no llegó todo (un 206 más corto, como el del arranque de los videos), sigue.
        if (got >= total) return;
        if (got === before) throw new TypeError('The download stopped.');
        res = null;
        fails = 0;
      } catch (err) {
        if (isAbort(err) || signal?.aborted) throw abortError();
        if (got > before) fails = 0;
        if (++fails >= FILE_TRIES) throw err;
        res = null;
        await wait(RETRY_MS[Math.min(fails - 1, RETRY_MS.length - 1)]!, signal);
      } finally {
        // Si quien lee deja de leer (cancelar, un error del disco), la respuesta no sigue bajando sola.
        reader?.cancel().catch(() => undefined);
      }
    }
  }

  /** Lo que se pidió por delante: el archivo entero en memoria, o por qué no se pudo. */
  type Fetched = { ok: true; length: number | null; chunks: Uint8Array[] } | { ok: false; err: unknown };
  const ahead = new Map<number, Promise<Fetched>>();
  const fetchWhole = async (file: PlanFile): Promise<Fetched> => {
    try {
      const opened = await open(file);
      const chunks: Uint8Array[] = [];
      for await (const c of opened.chunks) chunks.push(c);
      return { ok: true, length: opened.length, chunks };
    } catch (err) {
      return { ok: false, err };
    }
  };
  const prefetch = (from: number) => {
    for (let i = from; i < plan.files.length && i < from + PREFETCH; i++) {
      if (!ahead.has(i) && plan.files[i]!.size <= SMALL) ahead.set(i, fetchWhole(plan.files[i]!));
    }
  };

  const failed = (file: PlanFile, err: unknown) => {
    missing.push({ path: file.path, reason: 'failed', detail: err instanceof Error ? err.message : String(err) });
    progress.missing = missing.length;
  };

  const zip = target.kind === 'zip' ? new ZipWriter(target.sink, { crc: target.crc }) : null;
  const top = (path: string) => `${plan.root}/${path}`;
  try {
    if (zip) {
      await zip.addDirectory(plan.root);
      for (const d of plan.dirs) await zip.addDirectory(top(d.path), dateOf(d.modified));
    } else if (target.kind === 'dir') {
      for (const d of plan.dirs) await target.makeDir(d.path);
    }
    report();

    for (let i = 0; i < plan.files.length; i++) {
      if (signal?.aborted) throw abortError();
      const file = plan.files[i]!;
      progress.current = file.path;
      report();
      prefetch(i);
      let opened: Opened;
      const early = ahead.get(i);
      ahead.delete(i);
      try {
        if (early) {
          const got = await early;
          if (!got.ok) throw got.err;
          opened = { length: got.length, chunks: fromArray(got.chunks) };
        } else opened = await open(file);
      } catch (err) {
        if (isAbort(err)) throw err;
        failed(file, err);
        progress.bytesDone += file.size;
        progress.filesDone++;
        report();
        continue;
      }
      const counted = counting(opened.chunks, (n) => {
        progress.bytesDone += n;
        report();
      });
      let size = 0;
      let error: unknown;
      if (zip) {
        const r = await zip.addFile(top(file.path), opened.length ?? file.size, dateOf(file.modified), counted);
        size = r.size;
        error = r.error;
        if (error !== undefined) {
          missing.push({ path: file.path, reason: 'incomplete', detail: `${size} of ${opened.length ?? file.size} bytes` });
          progress.missing = missing.length;
        }
      } else if (target.kind === 'dir') {
        const out = await target.makeFile(file.path);
        try {
          for await (const c of counted) {
            try {
              await out.write(c);
            } catch (err) {
              throw new TargetFailed(err);
            }
            size += c.length;
          }
          try {
            await out.close();
          } catch (err) {
            throw new TargetFailed(err);
          }
        } catch (err) {
          await out.abort().catch(() => undefined);
          // Cancelar o no poder escribir en el disco frenan todo; un archivo que no llegó se saltea.
          if (isAbort(err)) throw err;
          if (err instanceof TargetFailed) throw err.cause;
          error = err;
          failed(file, err);
        }
      }
      // Lo que no se contó (un archivo que pesó menos de lo que decía Drive) igual cuenta para la barra.
      progress.bytesDone += Math.max(0, file.size - size);
      progress.filesDone++;
      if (error === undefined) {
        done++;
        written += size;
      }
      report();
    }
    progress.current = null;

    if (missing.length) {
      const text = new TextEncoder().encode(deps.missingText(missing));
      if (zip) await zip.addFile(top(MISSING_NAME), text.length, new Date(), fromArray([text]));
      else if (target.kind === 'dir') {
        const out = await target.makeFile(MISSING_NAME);
        await out.write(text);
        await out.close();
      }
    }
    if (zip) await zip.finish();
    report();
    return { done, bytes: written, missing };
  } finally {
    // Lo que se pidió por delante y no se usó (cancelar, un error del disco): se suelta.
    ahead.clear();
  }
}

/** Una respuesta de la que se saltean los primeros `skip` bytes (un 200 a un pedido con `Range`). */
function skipping(res: Response, skip: number): Response {
  if (!skip || !res.body) return res;
  let left = skip;
  const body = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        if (left >= chunk.length) {
          left -= chunk.length;
          return;
        }
        ctrl.enqueue(left ? chunk.subarray(left) : chunk);
        left = 0;
      },
    }),
  );
  return new Response(body, { status: res.status, headers: res.headers });
}

async function* fromArray(chunks: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const c of chunks) yield c;
}

async function* counting(chunks: AsyncIterable<Uint8Array>, onBytes: (n: number) => void): AsyncGenerator<Uint8Array> {
  for await (const c of chunks) {
    onBytes(c.length);
    yield c;
  }
}

function dateOf(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * El pase nuevo de un archivo: vuelve a listar su subcarpeta (con todas sus páginas) y lo busca por su id de
 * Drive. `null` si ya no está.
 */
export async function refreshPass(lister: FolderLister, fileId: string, file: PlanFile): Promise<string | null> {
  let token: string | null = null;
  do {
    const page = await lister.folderList(fileId, file.dirId, token);
    const hit = page.entries.find((e) => e.type === 'file' && e.id === file.id);
    if (hit && hit.type === 'file') return hit.url;
    token = page.nextPageToken;
  } while (token);
  return null;
}

/** Un zip en memoria (Firefox, Safari y los teléfonos): los pedazos se juntan en `Blob` de a 8 MB. */
export class BlobSink implements ZipSink {
  private parts: Blob[] = [];
  private pending: Uint8Array[] = [];
  private pendingBytes = 0;

  async write(chunk: Uint8Array): Promise<void> {
    // Se copia: el pedazo después se le pasa al Worker del CRC.
    this.pending.push(chunk.slice());
    this.pendingBytes += chunk.length;
    if (this.pendingBytes >= 8 * 1024 * 1024) this.flush();
  }

  private flush() {
    if (!this.pending.length) return;
    this.parts.push(new Blob(this.pending as BlobPart[]));
    this.pending = [];
    this.pendingBytes = 0;
  }

  blob(): Blob {
    this.flush();
    return new Blob(this.parts, { type: 'application/zip' });
  }
}
