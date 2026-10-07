import { loadPageHistory, rowHasTrace, type HistoryRow, type PageVersionRow } from './history';
import type { HistoryCache, PendingRestore } from './historyCache';
import { APP_OUTDATED, type HistoryRemote, type NamedVersionsRemote } from './remote';
import { errorMessage, isNetworkError, RemoteError } from './types';

// Bajar el historial de una página con la caché (P.18, entrega 3; Docs/Doc_Historial.md, secciones 8 y 10), los nombres
// de versión y las marcas de restauración ("Restored from…") que quedaron pendientes.

/** Lo que muestra la pantalla del historial. */
export interface HistoryLoad {
  rows: HistoryRow[];
  emails: Map<string, string>;
  /** Los nombres y las marcas de restauración; `null` si la base no los tiene (o no se pudieron leer). */
  versions: PageVersionRow[] | null;
  /** Sin red: es lo guardado, bajado en este momento. `null` con red. */
  offlineAt: number | null;
  /** La generación con que quedó guardado (la del servidor si se pudo leer): la usa quien guarda lo que llegue después. */
  generation: number | null;
}

export interface LoadHistoryOptions {
  /** `fetchWorkspaceSettings`: la generación del servidor, para no usar lo guardado de antes de restaurar una copia. */
  remote: HistoryRemote & NamedVersionsRemote & { fetchWorkspaceSettings?: () => Promise<{ generation: number } | null> };
  pageId: string;
  cache: HistoryCache | null;
  /** La generación del workspace que conoce el dispositivo (una copia de seguridad restaurada la cambia). */
  generation: number | null;
  /** Si el dispositivo cree que hay red. */
  online: boolean;
  /** Si la base tiene `page_versions` (`NAMED_VERSIONS_SCHEMA_VERSION`). */
  namedVersions: boolean;
  onProgress?: (rows: number) => void;
  isCancelled?: () => boolean;
  now?: () => number;
}

/** Errores de la base que dicen que esa persona ya no ve el historial de esa página: se tira lo guardado. */
function deniedNow(err: unknown): boolean {
  return err instanceof RemoteError && (err.message === 'page_not_found' || err.message === 'page_in_trash');
}

/** Los nombres de versión, o `null` si la base no los tiene. Sin red, el error sigue (lo decide quien llama). */
export async function fetchVersions(remote: NamedVersionsRemote, pageId: string, supported: boolean): Promise<PageVersionRow[] | null> {
  if (!supported) return null;
  try {
    return await remote.listPageVersions(pageId);
  } catch (err) {
    if (isNetworkError(err) || deniedNow(err)) throw err;
    // La base sin la función (PGRST202) o un error raro: el historial anda igual, sin nombres.
    return null;
  }
}

/**
 * El historial de una página. Con red: lo guardado más lo nuevo (o todo, si lo guardado ya no sirve), y se guarda.
 * Sin red (o si el servidor no contesta): lo guardado, con `offlineAt`; sin nada guardado, `null`. Si la base dice que
 * ya no lo puede ver, se tira lo guardado y sigue el error.
 */
export async function loadHistory(opts: LoadHistoryOptions): Promise<HistoryLoad | null> {
  const { remote, pageId, cache, generation } = opts;
  const now = opts.now ?? Date.now;
  const saved = cache ? await cache.read(pageId).catch(() => null) : null;
  // Lo guardado de otra generación (restauraron una copia de seguridad) no sirve.
  const usable = saved && (saved.meta.generation === generation || generation === null) ? saved : null;
  const fromCache = (): HistoryLoad | null =>
    usable
      ? { rows: usable.rows, emails: new Map(usable.meta.emails), versions: usable.meta.versions, offlineAt: usable.meta.savedAt, generation: usable.meta.generation }
      : null;
  if (!opts.online) return fromCache();
  try {
    // Con algo guardado, la generación del SERVIDOR antes de usarlo (O7 de la auditoría de la entrega 3): el
    // dispositivo se entera de una copia restaurada recién con su próxima sincronización, y una copia restaurada puede
    // volver atrás el contador de `page_updates` (el `id` de la última guardada podría coincidir con otra fila). Si no se
    // puede leer (la base sin la tabla), queda la que conoce el dispositivo; un error que no es de red, se baja todo.
    let current = generation;
    let trusted = usable;
    if (usable && remote.fetchWorkspaceSettings) {
      try {
        const server = await remote.fetchWorkspaceSettings();
        if (server) current = server.generation;
      } catch (err) {
        if (isNetworkError(err)) throw err;
        current = null;
        trusted = null;
      }
      if (current !== null && usable.meta.generation !== null && usable.meta.generation !== current) trusted = null;
    }
    const loaded = await loadPageHistory(remote, pageId, opts.onProgress, opts.isCancelled, trusted?.rows ?? []);
    let versions: PageVersionRow[] | null;
    try {
      versions = await fetchVersions(remote, pageId, opts.namedVersions);
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      versions = trusted?.meta.versions ?? null;
    }
    const keep = current ?? generation;
    if (cache) {
      await cache
        .save(pageId, { rows: loaded.rows, emails: loaded.emails, versions, generation: keep, reset: loaded.reset || (!!saved && !trusted) }, now())
        .catch(() => undefined);
    }
    return { rows: loaded.rows, emails: loaded.emails, versions, offlineAt: null, generation: keep };
  } catch (err) {
    if (deniedNow(err)) {
      await cache?.drop(pageId).catch(() => undefined);
      throw err;
    }
    if (isNetworkError(err)) {
      const offline = fromCache();
      if (offline) return offline;
    }
    throw err;
  }
}

// --- "Restored from…" -----------------------------------------------------------------------------------------------
//
// Restaurar es una edición del editor de la página que sube como cualquier otra: el `seq` de esa fila se sabe recién
// cuando llega al servidor. Se guarda una marca pendiente (en la caché) y, cuando la página terminó de subir, se busca
// la primera fila propia posterior a la última que había al restaurar y se marca (`mark_page_restored`). Si la app se
// cierra antes, la termina la app la próxima vez que se abre, después de sincronizar (`settlePendingRestores`), o la
// pantalla del historial de esa página (`settleRestores`). Es solo un rótulo: si se pierde, no se pierde nada de la
// página.

/** Cuánto se espera que la restauración llegue al servidor antes de dejar la marca de lado. */
const PENDING_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

/**
 * Marcas que se dejaron de lado (el Undo del aviso, o una que la base no acepta), también sin caché: ninguna vuelta las
 * vuelve a intentar.
 */
const abandoned = new Set<string>();

/**
 * Un rechazo que se arregla solo y se reintenta: sin red, o esta versión de la app es más vieja que la mínima del
 * workspace (`app_outdated`: la base rechaza las escrituras hasta que la app se actualiza). Dejar de lado la marca por
 * eso la perdía para siempre, justo cuando la app todavía podía ponerla después de actualizarse.
 */
const retriesLater = (err: unknown) => isNetworkError(err) || errorMessage(err) === APP_OUTDATED;

/** Las marcas que `markRestoreLater` está siguiendo en esta sesión: las termina él, la vuelta de fondo no las toca. */
const watched = new Set<string>();

/**
 * Las marcas que la vuelta de fondo ya buscó en esta sesión, con la página subida, sin encontrar su fila: no se vuelve
 * a bajar el historial por ellas hasta la próxima vez que se abra la app (o el historial de esa página).
 */
const searched = new Set<string>();

/** Hasta cuántas filas posteriores a la restauración mira la vuelta de fondo (de a `BACKGROUND_BATCH`). */
const BACKGROUND_BATCH = 500;
const BACKGROUND_MAX_ROWS = 2000;

/**
 * Termina las marcas pendientes de todas las páginas sin abrir el historial de ninguna (la app se cerró antes de que
 * la restauración subiera): se llama después de cada sincronización. Sin marcas pendientes no pide nada. Una página
 * con algo sin subir espera a la próxima (su restauración puede no estar todavía en el servidor). Devuelve las marcas
 * nuevas.
 */
export async function settlePendingRestores(
  deps: { remote: HistoryRemote & NamedVersionsRemote; cache: HistoryCache; docs: { unsyncedPages(): Promise<string[]> } },
  now = Date.now(),
): Promise<PageVersionRow[]> {
  const all = (await deps.cache.allRestores()).filter((p) => !watched.has(p.id) && !searched.has(p.id));
  if (all.length === 0) return [];
  const unsynced = new Set(await deps.docs.unsyncedPages());
  const done: PageVersionRow[] = [];
  for (const pageId of new Set(all.map((p) => p.pageId))) {
    if (unsynced.has(pageId)) continue;
    const pending = all.filter((p) => p.pageId === pageId);
    const rows: HistoryRow[] = [];
    try {
      let after = Math.min(...pending.map((p) => p.afterSeq));
      while (rows.length < BACKGROUND_MAX_ROWS) {
        const batch = await deps.remote.pageHistory(pageId, after, BACKGROUND_BATCH);
        rows.push(...batch);
        if (batch.length < BACKGROUND_BATCH) break;
        after = batch[batch.length - 1].seq;
      }
    } catch (err) {
      // Sin red (o con la app vieja), en la próxima vuelta. Lo demás (ya no puede ver el historial de esa página) no
      // se arregla insistiendo: queda para cuando se abra ese historial, hasta que venza.
      if (retriesLater(err)) return done;
      for (const p of pending) searched.add(p.id);
      continue;
    }
    // Las que no se pudieron marcar por algo pasajero (la red se cortó justo ahí) no se dan por buscadas: la vuelta
    // siguiente las intenta otra vez.
    const waiting = new Set<string>();
    done.push(...(await settleRestores(deps.remote, deps.cache, pageId, rows, pending, now, waiting)));
    for (const p of pending) if (!waiting.has(p.id)) searched.add(p.id);
  }
  return done;
}

/**
 * Busca la fila de cada restauración pendiente de la página entre `rows` y la marca en el servidor. Devuelve las marcas
 * nuevas. Una que nunca va a poder marcarse (la base no la acepta, o pasó una semana) se deja de lado. `waiting`: ahí
 * se anotan las que encontraron su fila y no se pudieron marcar por algo pasajero (siguen pendientes para reintentar).
 */
export async function settleRestores(
  remote: NamedVersionsRemote,
  cache: HistoryCache | null,
  pageId: string,
  rows: readonly HistoryRow[],
  pending?: PendingRestore[],
  now = Date.now(),
  waiting?: Set<string>,
): Promise<PageVersionRow[]> {
  const list = pending ?? (cache ? await cache.restoresOf(pageId).catch(() => []) : []);
  const done: PageVersionRow[] = [];
  for (const p of list) {
    if (abandoned.has(p.id)) {
      await cache?.removeRestore(p.id).catch(() => undefined);
      continue;
    }
    // La fila de la restauración: propia, posterior y con lo que agregó o borró la restauración (su huella). Sin huella
    // (o si nunca subió) no se marca nada: mejor sin rótulo que con uno sobre otra edición.
    const trace = p.trace;
    const mine = trace ? rows.find((r) => r.seq > p.afterSeq && r.createdBy === p.userId && rowHasTrace(r.data, trace)) : undefined;
    if (!mine) {
      if (!trace || now - p.at > PENDING_MAX_AGE_MS) {
        abandoned.add(p.id);
        await cache?.removeRestore(p.id).catch(() => undefined);
      }
      continue;
    }
    try {
      done.push(await remote.markPageRestored(p.id, p.pageId, mine.seq, p.fromSeq));
      await cache?.removeRestore(p.id).catch(() => undefined);
    } catch (err) {
      // Sin red o con la app más vieja que la mínima, se reintenta; lo demás (la base sin la función, una fila que no
      // es propia) no se arregla reintentando.
      if (retriesLater(err)) {
        waiting?.add(p.id);
      } else {
        abandoned.add(p.id);
        await cache?.removeRestore(p.id).catch(() => undefined);
      }
    }
  }
  return done;
}

export interface RestoreMarkDeps {
  remote: HistoryRemote & NamedVersionsRemote;
  cache: HistoryCache | null;
  engine: { subscribe(fn: () => void): () => void; getStatus(): { lastSyncAt: number | null; online: boolean }; syncNow(): Promise<void> };
  docs: { unsyncedPages(): Promise<string[]> };
}

/**
 * Después de restaurar: guarda la marca pendiente y la intenta después de cada sincronización hasta que la
 * restauración llegó al servidor y quedó marcada (o se deja de lado). Devuelve cómo dejarla de lado (el Undo del aviso,
 * si la restauración todavía no subió: marcar la fila que sube "restauración y deshacer" juntas diría algo falso).
 */
export function markRestoreLater(deps: RestoreMarkDeps, pending: PendingRestore, tries = 30): { cancel: () => Promise<void>; done: Promise<void> } {
  let left = tries;
  let stopped = false;
  let running = false;
  let lastSync = deps.engine.getStatus().lastSyncAt;
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => (finish = resolve));
  let off: () => void = () => undefined;
  watched.add(pending.id);
  const stop = () => {
    if (stopped) return;
    stopped = true;
    watched.delete(pending.id);
    off();
    finish();
  };
  const attempt = async () => {
    if (stopped || running) return;
    running = true;
    try {
      // Mientras la página tiene algo sin subir, la restauración todavía no está en el servidor (solo ahorra pedidos).
      if ((await deps.docs.unsyncedPages()).includes(pending.pageId)) return;
      const rows = await deps.remote.pageHistory(pending.pageId, pending.afterSeq, 50);
      const marked = await settleRestores(deps.remote, deps.cache, pending.pageId, rows, [pending]);
      if (marked.length > 0 || abandoned.has(pending.id)) return stop();
      // Sin la fila todavía: se espera a la próxima sincronización (hasta `tries` veces).
      if (deps.cache && !(await deps.cache.hasRestore(pending.id).catch(() => true))) return stop();
      if (--left <= 0) stop();
    } catch (err) {
      if (!isNetworkError(err) || --left <= 0) stop();
    } finally {
      running = false;
    }
  };
  void (deps.cache ? deps.cache.addRestore(pending) : Promise.resolve()).catch(() => undefined).then(() => {
    if (stopped) return;
    off = deps.engine.subscribe(() => {
      const at = deps.engine.getStatus().lastSyncAt;
      if (at !== lastSync) {
        lastSync = at;
        void attempt();
      }
    });
    void deps.engine.syncNow().catch(() => undefined).then(attempt);
  });
  return {
    cancel: async () => {
      abandoned.add(pending.id);
      await deps.cache?.removeRestore(pending.id).catch(() => undefined);
      stop();
    },
    done,
  };
}
