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

import { FOLDER_LIST_DIRS, PorteroError, type FolderEntry, type FolderListing, type FolderListingMany } from './portero';
import { NameSpace, safeName } from './zipNames';
import { ZipWriter, type ZipSink } from './zipWriter';
import type { CrcStream } from './crc32';

/** Lo que hace falta del portero: listar una carpeta (`media.porteroClient()`). */
export interface FolderLister {
  folderList(file: string, dir?: string | null, pageToken?: string | null): Promise<FolderListing>;
  /**
   * Varias subcarpetas por pedido (hasta `FOLDER_LIST_DIRS`), de un portero que lo sabe. `null`: el portero es
   * anterior (no devolvió `lists`): se lista de a una con `folderList`, como sin este método. Las páginas siguientes
   * van con los mismos `dirs`; en ellas, `later` y `failed` pueden traer algunas que ya venían (ver `listRound`).
   */
  folderListDirs?(file: string, dirs: string[], pageToken?: string | null, skip?: string[]): Promise<FolderListingMany | null>;
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
  /** Una subcarpeta que no se pudo listar: su id de Drive, para volver a probar (*Retry missing*). */
  dirId?: string;
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

/** Cuántos pedidos de listado van a la vez (cada uno, de hasta `FOLDER_LIST_DIRS` subcarpetas). */
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
  opts: {
    signal?: AbortSignal;
    onProgress?: (p: PlanProgress) => void;
    wait?: Wait;
    /** Recorrer solo esta subcarpeta (su id y su ruta limpia): *Retry missing* de una que no se pudo listar. */
    start?: { id: string; path: string };
  } = {},
): Promise<DownloadPlan> {
  const wait = opts.wait ?? defaultWait;
  const seen = new Set<string>();
  const progress: PlanProgress = { folders: 0, files: 0, bytes: 0 };
  const root: Node = { id: opts.start?.id ?? null, path: opts.start?.path ?? '', modified: null, entries: [], children: [] };

  /** Los pedidos de varias subcarpetas (`folderListDirs`) se usan mientras el portero los entienda. */
  let batched = typeof lister.folderListDirs === 'function';

  const addEntries = (node: Node, entries: FolderEntry[]) => {
    node.entries.push(...entries);
    for (const e of entries) {
      if (e.type === 'file') {
        progress.files++;
        progress.bytes += e.size;
      }
    }
  };
  /** Lo ya anotado de una subcarpeta que se vuelve a listar de cero (un pedido de varias que falló a mitad). */
  const dropEntries = (node: Node) => {
    for (const e of node.entries) {
      if (e.type === 'file') {
        progress.files--;
        progress.bytes -= e.size;
      }
    }
    node.entries.length = 0;
  };

  /** Una subcarpeta (o la carpeta) por pedido: todas sus páginas. */
  const listAll = async (node: Node): Promise<void> => {
    let token: string | null = null;
    do {
      const page = await withRate(() => lister.folderList(fileId, node.id, token), wait, opts.signal);
      addEntries(node, page.entries);
      opts.onProgress?.({ ...progress });
      token = page.nextPageToken;
    } while (token);
  };
  const failure = (err: unknown) => (err instanceof PorteroError ? (err.code ?? String(err.status)) : String(err));
  /** Lo mismo, y una que no se puede listar queda anotada sin frenar a las demás. */
  const listOne = async (node: Node): Promise<void> => {
    try {
      await listAll(node);
    } catch (err) {
      if (isAbort(err)) throw err;
      node.failed = failure(err);
    }
  };

  /**
   * Un pedido (con todas sus páginas) para varias subcarpetas a la vez. Devuelve las que el portero dejó para
   * después (el tope de llamados a Drive de un pedido). Si el pedido falla a mitad (o el portero no sabe de
   * `dirs`), se descarta lo recibido de esas y se listan de a una: una que no anda no pierde a las otras. Si Drive
   * pide ir más despacio y no cede, quedan anotadas con `rate` (de a una serían igual de lentas).
   *
   * En una página siguiente el portero puede dejar alguna para después o darla por perdida (más de un minuto entre
   * páginas y ya no entran todas en su tope de llamados a Drive, o una se movió afuera): se descarta lo que ya se
   * tenía de esa y se lista de nuevo en la vuelta siguiente (o queda anotada), y las demás siguen con sus páginas. Las
   * páginas siguientes se piden con los mismos `dirs` de la primera, aunque alguna haya quedado afuera: Drive ata el
   * token a la consulta.
   */
  const listRound = async (nodes: Node[]): Promise<Node[]> => {
    const byId = new Map(nodes.map((n) => [n.id!, n]));
    let accepted = nodes;
    const later: Node[] = [];
    let token: string | null = null;
    // Los `dirs` de la primera página: las siguientes van con los mismos.
    let query: string[] | null = null;
    try {
      do {
        const ids = query ?? accepted.map((n) => n.id!);
        const active = new Set(accepted.map((n) => n.id!));
        const skip: string[] = token ? ids.filter((id) => !active.has(id)) : [];
        const page: FolderListingMany | null = await withRate(() => lister.folderListDirs!(fileId, ids, token, skip), wait, opts.signal);
        if (!page) {
          if (token) throw new Error('The media server changed its answer.');
          // Un portero anterior: de a una, también las que siguen.
          batched = false;
          for (const n of nodes) await listOne(n);
          return [];
        }
        if (!token) {
          const deferred = new Set(page.later);
          accepted = [];
          for (const n of nodes) {
            const code = page.failed[n.id!];
            if (code !== undefined) n.failed = code;
            else if (deferred.has(n.id!)) later.push(n);
            else if (n.id! in page.lists) accepted.push(n);
            else n.failed = 'no_answer';
          }
          query = accepted.map((n) => n.id!);
        } else {
          // Una página siguiente: la que el portero dejó para después o dio por perdida sale de esta vuelta, sin lo
          // que ya se tenía de ella (incompleto).
          const deferred = new Set(page.later);
          const still: Node[] = [];
          for (const n of accepted) {
            const code = page.failed[n.id!];
            if (code === undefined && !deferred.has(n.id!) && n.id! in page.lists) {
              still.push(n);
              continue;
            }
            dropEntries(n);
            if (code !== undefined) n.failed = code;
            else if (deferred.has(n.id!)) later.push(n);
            else n.failed = 'no_answer';
          }
          accepted = still;
        }
        const mine = new Set(accepted);
        for (const [id, entries] of Object.entries(page.lists)) {
          const n = byId.get(id);
          if (n && mine.has(n)) addEntries(n, entries);
        }
        opts.onProgress?.({ ...progress });
        // Si ya no queda ninguna de esta vuelta, no hace falta seguir con las páginas.
        token = accepted.length > 0 ? page.nextPageToken : null;
      } while (token);
    } catch (err) {
      if (isAbort(err)) throw err;
      for (const n of accepted) dropEntries(n);
      if (err instanceof PorteroError && err.code === 'rate') for (const n of accepted) n.failed = 'rate';
      else for (const n of accepted) await listOne(n);
    }
    return later;
  };
  /** Todas, sin dejar ninguna: cada vuelta lista al menos una (las que el portero deja para después, vuelven). */
  const listMany = async (nodes: Node[]): Promise<void> => {
    let todo = nodes;
    for (let round = 0; todo.length && round <= nodes.length; round++) todo = await listRound(todo);
    for (const n of todo) n.failed = 'later';
  };

  await listAll(root);
  // Las subcarpetas, de a `FOLDER_LIST_DIRS` por pedido y `LIST_PARALLEL` pedidos a la vez. Los nombres se ponen después, en orden.
  const queue: { node: Node; entry: Extract<FolderEntry, { type: 'folder' }>; depth: number }[] = [];
  const enqueue = (node: Node, depth: number) => {
    for (const e of node.entries) if (e.type === 'folder') queue.push({ node, entry: e, depth });
  };
  enqueue(root, 1);
  const children = new Map<FolderEntry, Node>();
  const worker = async () => {
    while (queue.length) {
      if (opts.signal?.aborted) throw abortError();
      const taken: { child: Node; depth: number }[] = [];
      while (queue.length && taken.length < (batched ? FOLDER_LIST_DIRS : 1)) {
        const { entry, depth } = queue.shift()!;
        const child: Node = { id: entry.id, path: '', modified: entry.modified, entries: [], children: [] };
        children.set(entry, child);
        if (seen.has(entry.id) || depth > MAX_DEPTH) {
          child.failed = seen.has(entry.id) ? 'loop' : 'too_deep';
          continue;
        }
        seen.add(entry.id);
        progress.folders++;
        taken.push({ child, depth });
      }
      if (!taken.length) continue;
      if (batched) await listMany(taken.map((t) => t.child));
      else await listOne(taken[0]!.child);
      for (const { child, depth } of taken) if (!child.failed) enqueue(child, depth + 1);
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
      if (child.failed) {
        // Un ciclo o una carpeta demasiado honda no cambian al volver a probar; lo demás (un error del portero), sí.
        const again = child.failed !== 'loop' && child.failed !== 'too_deep';
        plan.skipped.push({ path: `${child.path}/`, reason: 'folder', detail: child.failed, ...(again ? { dirId: e.id } : {}) });
      }
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

/** Si vale la pena volver a probar lo que falta: un archivo que falló o quedó a medias, o una subcarpeta que no se listó. */
export function canRetry(item: MissingItem): boolean {
  return item.reason === 'failed' || item.reason === 'incomplete' || (item.reason === 'folder' && !!item.dirId);
}

/**
 * *Retry missing*: el plan de lo que vale la pena volver a bajar de una bajada que terminó (`plan` y lo que faltó,
 * `missing`). Los archivos que fallaron o quedaron a medias, con su pase (si venció, `runDownload` lo renueva), y
 * cada subcarpeta que no se pudo listar, listada de nuevo. Lo que no se puede bajar (accesos directos, documentos de
 * Google, una subcarpeta que vuelve a fallar) queda en `skipped`, así `MISSING_FILES.txt` sigue entero.
 */
export async function planRetry(
  lister: FolderLister,
  fileId: string,
  plan: DownloadPlan,
  missing: MissingItem[],
  opts: { signal?: AbortSignal; wait?: Wait } = {},
): Promise<DownloadPlan> {
  const again = new Set(missing.filter((m) => m.reason === 'failed' || m.reason === 'incomplete').map((m) => m.path));
  const out: DownloadPlan = { root: plan.root, dirs: [], files: plan.files.filter((f) => again.has(f.path)), skipped: [], bytes: 0 };
  for (const item of missing) {
    if (item.reason === 'failed' || item.reason === 'incomplete') continue;
    if (!canRetry(item)) {
      out.skipped.push(item);
      continue;
    }
    if (opts.signal?.aborted) throw abortError();
    const path = item.path.replace(/\/$/, '');
    try {
      const sub = await planFolder(lister, fileId, plan.root, { ...opts, start: { id: item.dirId!, path } });
      out.dirs.push({ path, modified: null }, ...sub.dirs);
      out.files.push(...sub.files);
      out.skipped.push(...sub.skipped);
    } catch (err) {
      if (isAbort(err)) throw err;
      out.skipped.push({ ...item, detail: err instanceof PorteroError ? (err.code ?? String(err.status)) : String(err) });
    }
  }
  out.bytes = out.files.reduce((sum, f) => sum + f.size, 0);
  return out;
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
  | {
      kind: 'dir';
      makeDir(path: string): Promise<void>;
      makeFile(path: string): Promise<FileOut>;
      /** Borra un archivo si está (la lista vieja de lo que faltaba, cuando *Retry missing* bajó todo). */
      remove?(path: string): Promise<void>;
    };

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
  /**
   * Cada cuánto se vuelve a probar el portero cuando no contesta nadie (wifi conectado sin internet: el navegador
   * sigue diciendo que hay red). Por defecto, `PROBE_MS`.
   */
  probeMs?: number;
  /**
   * Cuánto se espera un pedido sin que llegue nada (la respuesta o el próximo pedazo) antes de tratarlo como un corte
   * (el portero dejó de contestar sin cortar la conexión). Por defecto, `STALL_MS`.
   */
  stallMs?: number;
  /** El pase nuevo de un archivo (cuando el que se tenía venció): vuelve a listar su subcarpeta. */
  refresh?: (file: PlanFile) => Promise<string | null>;
  /**
   * El pase de un archivo que todavía no tiene (`url` vacía), recién cuando le toca: exportar (src/export/exportZip.ts)
   * no pide miles de pases antes de empezar. Un error del portero con estado 4xx (el archivo ya no está, no terminó de
   * subir) saltea el archivo; otro (la red) cuenta como un intento.
   */
  passFor?: (file: PlanFile) => Promise<string>;
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
/** Cada cuánto se prueba si el portero volvió a contestar, sin red de verdad. */
const PROBE_MS = 5_000;
/**
 * Lo más que se espera sin que llegue nada (la respuesta o el próximo pedazo): después cuenta como un corte, como el
 * tope de las subidas trabadas. Un portero que deja de contestar sin cortar la conexión dejaba la barra quieta.
 */
const STALL_MS = 30_000;
/** Lo más que se espera la respuesta de `/health` al probar si el portero contesta. */
const HEALTH_MS = 10_000;

/** No llegó nada en `stallMs`: se trata como un corte de la red (prueba el portero y, si no contesta, espera). */
class Stalled extends TypeError {
  constructor() {
    super('The media server stopped answering.');
  }
}

/** El pedido ni llegó a tener respuesta (`fetch` falló): la red, no el archivo. */
class NetworkFailed extends Error {}

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
  opts: {
    signal?: AbortSignal;
    onProgress?: (p: DownloadProgress) => void;
    /**
     * *Retry missing*: lo que se baja completa una bajada anterior. Si ya no falta nada, la lista vieja se borra de la
     * carpeta, y en un zip va una nueva que lo dice (descomprimido encima del primero, la reemplaza).
     */
    retry?: boolean;
    /**
     * La bajada es una parte de un zip o de una carpeta que arma otro (exportar, src/export/exportZip.ts): escribe en
     * `zip` (ya abierto; no lo cierra) o en la carpeta del destino, sin crear las carpetas del plan ni
     * `MISSING_FILES.txt`. Lo que falta vuelve en el resultado.
     */
    part?: { zip: ZipWriter | null };
  } = {},
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
        // Sin `window` (las pruebas), solo cancelar la termina.
        if (typeof window === 'undefined') {
          s?.addEventListener('abort', () => fail(abortError()), { once: true });
          return;
        }
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
  const stallMs = deps.stallMs ?? STALL_MS;

  /**
   * `work` con su propia señal (cancelar la bajada la corta) y un tope: si en `ms` no terminó, la corta y falla con
   * `Stalled`.
   */
  const within = async <T>(ms: number, work: (s: AbortSignal) => Promise<T>): Promise<T> => {
    if (signal?.aborted) throw abortError();
    const local = new AbortController();
    const relay = () => local.abort();
    signal?.addEventListener('abort', relay, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work(local.signal),
        new Promise<never>((_, fail) => {
          timer = setTimeout(() => {
            fail(new Stalled());
            local.abort();
          }, ms);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', relay);
    }
  };

  /** El próximo pedazo de la respuesta, con el tope sin avance; cancelar la bajada lo corta en el acto. */
  const readSome = (reader: ReadableStreamDefaultReader<Uint8Array>) =>
    within(
      stallMs,
      (s) =>
        new Promise<ReadableStreamReadResult<Uint8Array>>((ok, fail) => {
          s.addEventListener('abort', () => fail(abortError()), { once: true });
          reader.read().then(ok, fail);
        }),
    );

  /** Cuántos pedidos están esperando la conexión (los de adelante también): la ventana dice "No connection". */
  let waiting = 0;
  const setWaiting = (delta: number) => {
    waiting += delta;
    if (progress.offline !== waiting > 0) {
      progress.offline = waiting > 0;
      report();
    }
  };

  /** Espera la conexión si se fue (sin contar como intento). */
  const ensureOnline = async () => {
    if (online()) return;
    setWaiting(1);
    try {
      await whenOnline(signal);
    } finally {
      setWaiting(-1);
    }
  };

  /** Si el portero contesta algo (cualquier cosa, también un error): hay camino hasta él. */
  const reachable = async (url: string): Promise<boolean> => {
    try {
      // Con su tope: un portero colgado tampoco contesta esto.
      await within(Math.min(stallMs, HEALTH_MS), async (s) => {
        const res = await http(new URL('/health', url).href, { signal: s, mode: 'cors', credentials: 'omit', cache: 'no-store' });
        res.body?.cancel().catch(() => undefined);
      });
      return true;
    } catch {
      if (signal?.aborted) throw abortError();
      return false;
    }
  };

  /** Hasta `ms` o hasta que el navegador diga que volvió la red, lo que pase antes. Cancelar corta. */
  const pause = async (ms: number) => {
    const local = new AbortController();
    const stop = () => local.abort();
    signal?.addEventListener('abort', stop, { once: true });
    try {
      await Promise.race([wait(ms, local.signal), whenOnline(local.signal)]).catch(() => undefined);
    } finally {
      local.abort();
      signal?.removeEventListener('abort', stop);
    }
    if (signal?.aborted) throw abortError();
  };

  /**
   * Un pedido falló por la red. Con el wifi conectado y sin internet el navegador sigue diciendo que hay red
   * (`navigator.onLine`): se prueba el portero. Si tampoco contesta, se espera (diciendo "No connection") hasta que
   * vuelva, sin gastar intentos del archivo, y devuelve `true`. Si contesta, el problema era de este pedido: `false`
   * (cuenta como un intento).
   */
  const waitForNetwork = async (file: PlanFile): Promise<boolean> => {
    await ensureOnline();
    if (await reachable(file.url)) return false;
    setWaiting(1);
    try {
      do await pause(deps.probeMs ?? PROBE_MS);
      while (!(await reachable(file.url)));
    } finally {
      setWaiting(-1);
    }
    return true;
  };

  /**
   * Pide el archivo desde `from` (con `Range` si no es el principio). Con `?offline=1`: es una bajada entera, no tiene
   * que pasar por la caché del arranque de los videos ni desplazar lo que hay en ella (Doc_Portero.md).
   */
  const request = async (file: PlanFile, from: number): Promise<Response> => {
    const headers: Record<string, string> = from > 0 ? { Range: `bytes=${from}-` } : {};
    let res: Response;
    try {
      // Hasta que llega la respuesta, con el tope sin avance (después, cada pedazo tiene el suyo: `readSome`).
      res = await within(stallMs, (s) => http(withOffline(file.url), { headers, signal: s, mode: 'cors', credentials: 'omit', cache: 'no-store' }));
    } catch (err) {
      if (signal?.aborted) throw abortError();
      throw new NetworkFailed(err instanceof Error ? err.message : String(err));
    }
    if (res.ok) return res;
    let code = '';
    try {
      code = await within(stallMs, async (s) => {
        const reader = res.body?.getReader();
        if (!reader) return '';
        const stop = () => { void reader.cancel().catch(() => undefined); };
        s.addEventListener('abort', stop, { once: true });
        let ended = false;
        try {
          // El cuerpo de un error también puede quedar a medias: Cancel y el plazo deben cortar su fuente.
          if (s.aborted) {
            stop();
            throw abortError();
          }
          const decoder = new TextDecoder();
          let text = '';
          for (;;) {
            const part = await reader.read();
            if (s.aborted) throw abortError();
            if (part.done) {
              ended = true;
              break;
            }
            text += decoder.decode(part.value, { stream: true });
          }
          return (JSON.parse(text + decoder.decode()) as { code?: string }).code ?? '';
        } finally {
          s.removeEventListener('abort', stop);
          if (!ended && !s.aborted) stop();
          reader.releaseLock();
        }
      });
    } catch {
      if (signal?.aborted) throw abortError();
      // Sin cuerpo JSON (o no llegó): conserva la clasificación por el estado HTTP.
    }
    if (res.status === 403 && code === 'pass_expired') throw new FileFailed('pass_expired', true);
    if (res.status >= 500 || res.status === 429) throw new TypeError(`The media server answered ${res.status}.`);
    throw new FileFailed(code || `HTTP ${res.status}`);
  };

  /** El pase que todavía no tiene: lo que el portero niega (4xx) saltea el archivo; la red, otro intento. */
  const passOf = async (file: PlanFile): Promise<string> => {
    try {
      return await deps.passFor!(file);
    } catch (err) {
      if (isAbort(err)) throw err;
      const status = (err as { status?: unknown } | null)?.status;
      if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429) {
        throw new FileFailed((err as { code?: string }).code || `HTTP ${status}`);
      }
      throw new TypeError(err instanceof Error ? err.message : String(err));
    }
  };

  /** Abre el archivo con sus reintentos; si no se puede, `FileFailed`. */
  const open = async (file: PlanFile): Promise<Opened> => {
    let refreshed = false;
    let fails = 0;
    for (;;) {
      if (signal?.aborted) throw abortError();
      await ensureOnline();
      try {
        if (!file.url && deps.passFor) file.url = await passOf(file);
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
        if (err instanceof NetworkFailed && (await waitForNetwork(file))) continue;
        if (++fails >= FILE_TRIES) throw new FileFailed(err instanceof Error ? err.message : String(err));
        await wait(RETRY_MS[Math.min(fails - 1, RETRY_MS.length - 1)]!, signal);
      }
    }
  };

  /** Un pase nuevo para el archivo (venció en medio de una bajada larga); `false` si no hay. */
  const renewPass = async (file: PlanFile): Promise<boolean> => {
    if (!deps.refresh) return false;
    const url = await deps.refresh(file).catch(() => null);
    if (!url) return false;
    file.url = url;
    return true;
  };

  /**
   * Los pedazos del archivo. Si la respuesta se corta antes de `total`, pide lo que falta con `Range` (hasta
   * `FILE_TRIES` veces seguidas sin avanzar).
   */
  async function* chunksOf(file: PlanFile, first: Response, total: number): AsyncGenerator<Uint8Array> {
    let res: Response | null = first;
    let got = 0;
    let fails = 0;
    let renewed = false;
    for (;;) {
      if (!res) {
        if (signal?.aborted) throw abortError();
        await ensureOnline();
        try {
          res = await request(file, got);
        } catch (err) {
          if (isAbort(err)) throw err;
          // El pase venció entre un corte y el pedido que sigue (una bajada de más de 8 horas): uno nuevo, una vez.
          if (err instanceof FileFailed && err.expired && !renewed && (await renewPass(file))) {
            renewed = true;
            continue;
          }
          if (err instanceof FileFailed) throw err;
          if (!online()) continue;
          if (err instanceof NetworkFailed && (await waitForNetwork(file))) continue;
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
          const { value, done: end } = await readSome(reader);
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
        res = null;
        // Se cortó a mitad: si fue la red (el portero tampoco contesta), se espera sin gastar intentos.
        if (err instanceof TypeError && (await waitForNetwork(file))) continue;
        if (++fails >= FILE_TRIES) throw err;
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

  const part = opts.part ?? null;
  const zip = part ? part.zip : target.kind === 'zip' ? new ZipWriter(target.sink, { crc: target.crc }) : null;
  // Sin `root` (exportar): las rutas van tal cual, sin carpeta de arriba.
  const top = (path: string) => (plan.root ? `${plan.root}/${path}` : path);
  try {
    if (part) {
      // Las carpetas las pone quien arma el zip o la carpeta.
    } else if (zip) {
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
        let out: FileOut;
        try {
          out = await target.makeFile(file.path);
        } catch (err) {
          if (isAbort(err)) throw err;
          // Un nombre que el navegador no deja crear en el disco (Chrome rechaza `.lnk`, `.scf`, `.local`… con un
          // TypeError): ese archivo se saltea y se anota; lo demás sigue. Otro error (sin permiso, disco) frena todo.
          if (!(err instanceof TypeError)) throw err;
          for await (const _ of opened.chunks) break; // suelta la respuesta abierta
          failed(file, err);
          progress.bytesDone += file.size;
          progress.filesDone++;
          report();
          continue;
        }
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

    if (part) {
      report();
      return { done, bytes: written, missing };
    }
    if (missing.length || (zip && opts.retry)) {
      const text = new TextEncoder().encode(deps.missingText(missing));
      if (zip) await zip.addFile(top(MISSING_NAME), text.length, new Date(), fromArray([text]));
      else if (target.kind === 'dir') {
        const out = await target.makeFile(MISSING_NAME);
        await out.write(text);
        await out.close();
      }
    } else if (opts.retry && target.kind === 'dir') await target.remove?.(MISSING_NAME);
    if (zip) await zip.finish();
    report();
    return { done, bytes: written, missing };
  } finally {
    // Lo que se pidió por delante y no se usó (cancelar, un error del disco): se suelta.
    ahead.clear();
  }
}

/** La dirección del pase con `?offline=1` (el portero saltea la caché del arranque de los videos). */
function withOffline(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set('offline', '1');
    return u.href;
  } catch {
    return url;
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

/** El zip en memoria pasó su tope (Drive dijo un peso menor que lo que mandó). */
export class MemoryCapExceeded extends Error {
  constructor(readonly cap: number) {
    super('The zip does not fit in this browser\'s memory.');
    this.name = 'MemoryCapExceeded';
  }
}

/**
 * Un zip en memoria (Firefox, Safari y los teléfonos): los pedazos se juntan en `Blob` de a 8 MB. Con `cap`, pasado
 * ese peso de verdad (no el que dijo Drive) falla con `MemoryCapExceeded`.
 */
export class BlobSink implements ZipSink {
  private parts: Blob[] = [];
  private pending: Uint8Array[] = [];
  private pendingBytes = 0;
  private total = 0;

  constructor(private readonly cap = Infinity) {}

  async write(chunk: Uint8Array): Promise<void> {
    if (this.total + chunk.length > this.cap) {
      // Lo juntado se suelta: no se va a usar.
      this.parts = [];
      this.pending = [];
      throw new MemoryCapExceeded(this.cap);
    }
    this.total += chunk.length;
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
