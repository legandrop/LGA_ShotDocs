import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { HistoryRow, PageVersionRow, RestoreTrace } from './history';

// La caché del historial de versiones (P.18, entrega 3; Docs/Doc_Historial.md, secciones 8 y 10). Una base aparte,
// `<base local>:history` (como `:media` y `:comments`: la de siempre no cambia de versión), con, por página, las filas
// de `page_history` ya bajadas, los correos de sus autores y los nombres de versión. Sirve para dos cosas:
//
// - La próxima vez se baja solo lo posterior (`loadPageHistory` con `start`), comprobando que la última fila guardada
//   sigue siendo la misma (su `id`) y que el workspace no cambió de generación (una copia de seguridad restaurada
//   vuelve a usar los `seq`). Si no, se tira y se baja todo.
// - Sin red se ve el historial hasta lo último bajado, con su aviso. Restaurar y nombrar no (piden red).
//
// Cambio respecto del diseño (que guardaba el documento armado y los metadatos de cada fila): se guardan las filas
// mismas. El historial se arma igual que con red (el mismo código, aplicando en orden), así que no hay un segundo camino
// que pueda dar distinto; lo que se ahorra es bajarlas, que es lo lento.
//
// Es solo una copia de lo que está en el servidor: borrarla no pierde nada. Se borra con la base local (al sacar el
// workspace del dispositivo), al salir de la cuenta, y la página que la base rechaza (`page_not_found`,
// `page_in_trash`). Tope de 50 MB: se liberan las páginas abiertas hace más tiempo.
//
// Además guarda las marcas de restauración que todavía no llegaron al servidor (`restores`, ver historyRestoreMark.ts).

/** Tope de la caché. */
export const HISTORY_CACHE_MAX_BYTES = 50 * 1024 * 1024;

/** Lo que pesa una fila guardada además de sus bytes (claves, autor, hora). */
const ROW_OVERHEAD = 96;

export interface CachedHistoryMeta {
  pageId: string;
  /** `workspace_settings.generation` cuando se guardó (`null` si no se sabía). */
  generation: number | null;
  lastSeq: number;
  lastId: number;
  count: number;
  bytes: number;
  /** Cuándo se bajó por última vez (lo que dice el aviso sin red). */
  savedAt: number;
  /** Cuándo se abrió por última vez (para liberar las menos usadas). */
  openedAt: number;
  emails: [string, string][];
  /** Los nombres de versión (`null`: la base no los tiene o no se pudieron leer). */
  versions: PageVersionRow[] | null;
}

interface CachedRow extends HistoryRow {
  pageId: string;
}

/** Una restauración cuya marca ("Restored from…") todavía no se guardó en el servidor. */
export interface PendingRestore {
  id: string;
  pageId: string;
  userId: string;
  /** La versión restaurada (el `seq` de su última fila). */
  fromSeq: number;
  /** La última fila que había en el servidor al restaurar: la restauración es una fila propia posterior. */
  afterSeq: number;
  /** Lo que agregó y borró la restauración: la fila que se marca es la primera que lo trae. Sin huella no se marca. */
  trace?: RestoreTrace;
  at: number;
}

interface HistoryCacheSchema extends DBSchema {
  pages: { key: string; value: CachedHistoryMeta };
  rows: { key: [string, number]; value: CachedRow };
  restores: { key: string; value: PendingRestore; indexes: { page: string } };
}

type HistoryDb = IDBPDatabase<HistoryCacheSchema>;

/** El nombre de la base del historial que acompaña a una base local. */
export function historyDbName(localDbName: string): string {
  return `${localDbName}:history`;
}

const opened = new Map<string, Promise<HistoryCache | null>>();

/**
 * La caché de una base local (una sola conexión por nombre). `null` si no hay base local (la página de práctica, el
 * visor del historial) o si el navegador no la deja abrir (modo privado): el historial anda igual, sin caché.
 */
export function historyCacheFor(localDbName: string): Promise<HistoryCache | null> {
  if (!localDbName || typeof indexedDB === 'undefined') return Promise.resolve(null);
  const name = historyDbName(localDbName);
  let got = opened.get(name);
  if (!got) {
    got = HistoryCache.open(name, () => opened.delete(name)).catch(() => null);
    opened.set(name, got);
  }
  return got;
}

/** La caché de una base local, solo si ya existe (no crea una base vacía para quien nunca abrió el historial). */
export async function existingHistoryCache(localDbName: string): Promise<HistoryCache | null> {
  if (!localDbName || typeof indexedDB === 'undefined') return null;
  const name = historyDbName(localDbName);
  if (!opened.has(name)) {
    try {
      if (typeof indexedDB.databases !== 'function' || !(await indexedDB.databases()).some((d) => d.name === name)) return null;
    } catch {
      return null;
    }
  }
  return historyCacheFor(localDbName);
}

/** `prune` sobre la caché de una base local, solo si ya existe. Devuelve las páginas tiradas. */
export async function pruneHistoryCache(localDbName: string, keep: (pageId: string) => boolean): Promise<string[]> {
  const cache = await existingHistoryCache(localDbName);
  return cache ? cache.prune(keep).catch(() => []) : [];
}

/** Borra la caché del historial de una base local (cierra la conexión de esta pestaña antes). */
export async function deleteHistoryCache(localDbName: string): Promise<void> {
  const name = historyDbName(localDbName);
  const got = opened.get(name);
  opened.delete(name);
  if (got) (await got.catch(() => null))?.close();
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error(`Could not delete ${name}`));
    // Otra pestaña la tiene abierta: se le pide que la cierre (`blocking`) y el borrado termina solo.
    req.onblocked = () => resolve();
  });
}

const rowBytes = (r: HistoryRow) => r.data.byteLength + ROW_OVERHEAD;

export class HistoryCache {
  private closed = false;

  private constructor(private readonly db: HistoryDb) {}

  static async open(name: string, onClose: () => void = () => undefined): Promise<HistoryCache> {
    let cache: HistoryCache | null = null;
    const db = await openDB<HistoryCacheSchema>(name, 1, {
      upgrade(d) {
        d.createObjectStore('pages', { keyPath: 'pageId' });
        d.createObjectStore('rows', { keyPath: ['pageId', 'seq'] });
        d.createObjectStore('restores', { keyPath: 'id' }).createIndex('page', 'pageId');
      },
      // Otra pestaña (o salir de la cuenta) la quiere borrar: se cierra para no trabarla.
      blocking() {
        cache?.close();
        onClose();
      },
      terminated() {
        onClose();
      },
    });
    cache = new HistoryCache(db);
    return cache;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  /** Lo guardado de una página: sus filas en orden y lo demás. `null` si no hay nada. */
  async read(pageId: string): Promise<{ meta: CachedHistoryMeta; rows: HistoryRow[] } | null> {
    const tx = this.db.transaction(['pages', 'rows'], 'readonly');
    const meta = await tx.objectStore('pages').get(pageId);
    const raw = meta ? await tx.objectStore('rows').getAll(IDBKeyRange.bound([pageId, -Infinity], [pageId, Infinity])) : [];
    await tx.done;
    if (!meta) return null;
    const rows = raw
      .map(({ id, seq, createdBy, createdAt, data }) => ({ id, seq, createdBy, createdAt, data }))
      .sort((a, b) => a.seq - b.seq);
    // Algo no cuadra (se cortó a medio guardar): se tira.
    if (rows.length !== meta.count || (rows.length > 0 && (rows[rows.length - 1].seq !== meta.lastSeq || rows[rows.length - 1].id !== meta.lastId))) {
      await this.drop(pageId);
      return null;
    }
    return { meta, rows };
  }

  /**
   * Guarda el historial bajado de una página: las filas (todas, en orden; se escriben solo las que faltan, salvo con
   * `reset`, que tira lo de antes), los correos y los nombres. Después libera lo menos usado si se pasa del tope.
   */
  async save(
    pageId: string,
    data: {
      rows: readonly HistoryRow[];
      emails: ReadonlyMap<string, string>;
      versions: PageVersionRow[] | null;
      generation: number | null;
      reset?: boolean;
    },
    now = Date.now(),
    maxBytes = HISTORY_CACHE_MAX_BYTES,
  ): Promise<void> {
    if (data.reset) await this.drop(pageId);
    const tx = this.db.transaction(['pages', 'rows'], 'readwrite');
    const pages = tx.objectStore('pages');
    const rowsStore = tx.objectStore('rows');
    const before = await pages.get(pageId);
    // Otra generación: lo guardado no sirve.
    const keep = before && before.generation === data.generation ? before : null;
    if (before && !keep) await rowsStore.delete(IDBKeyRange.bound([pageId, -Infinity], [pageId, Infinity]));
    const fromSeq = keep ? keep.lastSeq : -Infinity;
    let bytes = keep ? keep.bytes : 0;
    let count = keep ? keep.count : 0;
    for (const row of data.rows) {
      if (row.seq <= fromSeq) continue;
      await rowsStore.put({ pageId, id: row.id, seq: row.seq, createdBy: row.createdBy, createdAt: row.createdAt, data: row.data });
      bytes += rowBytes(row);
      count++;
    }
    // Lo guardado puede ser más nuevo que lo que llega (dos pestañas con el mismo historial abierto guardan a la vez):
    // la última nunca baja, así lo guardado sigue cuadrando.
    const incoming = data.rows[data.rows.length - 1];
    const last = keep && (!incoming || keep.lastSeq > incoming.seq) ? { seq: keep.lastSeq, id: keep.lastId } : incoming;
    await pages.put({
      pageId,
      generation: data.generation,
      lastSeq: last ? last.seq : 0,
      lastId: last ? last.id : 0,
      count,
      bytes,
      savedAt: now,
      openedAt: now,
      emails: [...data.emails],
      versions: data.versions,
    });
    await tx.done;
    await this.evict(maxBytes, pageId);
  }

  /** Cambia solo los nombres de versión guardados (después de nombrar, renombrar o sacar uno). */
  async saveVersions(pageId: string, versions: PageVersionRow[] | null): Promise<void> {
    const tx = this.db.transaction('pages', 'readwrite');
    const meta = await tx.store.get(pageId);
    if (meta) await tx.store.put({ ...meta, versions });
    await tx.done;
  }

  /** Marca la página como recién abierta (la última en liberarse). */
  async touch(pageId: string, now = Date.now()): Promise<void> {
    const tx = this.db.transaction('pages', 'readwrite');
    const meta = await tx.store.get(pageId);
    if (meta) await tx.store.put({ ...meta, openedAt: now });
    await tx.done;
  }

  /** Tira lo guardado de una página. */
  async drop(pageId: string): Promise<void> {
    const tx = this.db.transaction(['pages', 'rows'], 'readwrite');
    await tx.objectStore('rows').delete(IDBKeyRange.bound([pageId, -Infinity], [pageId, Infinity]));
    await tx.objectStore('pages').delete(pageId);
    await tx.done;
  }

  /** Las páginas que tienen algo guardado. */
  async pages(): Promise<string[]> {
    return this.db.getAllKeys('pages');
  }

  /**
   * Tira lo guardado de las páginas cuyo historial esta persona ya no puede ver (`keep` dice que no): perdió el permiso,
   * pasó a invitada, la página salió del árbol. Lo guardado tiene lo borrado de la página (D13). Devuelve las tiradas.
   */
  async prune(keep: (pageId: string) => boolean): Promise<string[]> {
    const gone = (await this.pages()).filter((id) => !keep(id));
    for (const id of gone) await this.drop(id);
    return gone;
  }

  /** Cuánto ocupa todo. */
  async totalBytes(): Promise<number> {
    return (await this.db.getAll('pages')).reduce((n, m) => n + m.bytes, 0);
  }

  /**
   * Libera páginas, las abiertas hace más tiempo primero, hasta quedar debajo del tope. `keep` (la que se acaba de
   * guardar) va última; si sola pasa el tope, no se guarda (y lo demás queda).
   */
  async evict(maxBytes = HISTORY_CACHE_MAX_BYTES, keep?: string): Promise<string[]> {
    let metas = await this.db.getAll('pages');
    const dropped: string[] = [];
    // La recién guardada pasa el tope sola: se tira ella y no se toca lo demás.
    const kept = metas.find((m) => m.pageId === keep);
    if (kept && kept.bytes > maxBytes) {
      await this.drop(kept.pageId);
      dropped.push(kept.pageId);
      metas = metas.filter((m) => m !== kept);
    }
    let total = metas.reduce((n, m) => n + m.bytes, 0);
    const order = metas.sort((a, b) => (a.pageId === keep ? 1 : b.pageId === keep ? -1 : a.openedAt - b.openedAt));
    for (const m of order) {
      if (total <= maxBytes) break;
      await this.drop(m.pageId);
      total -= m.bytes;
      dropped.push(m.pageId);
    }
    return dropped;
  }

  // --- Marcas de restauración pendientes ------------------------------------------------------------------------

  async addRestore(pending: PendingRestore): Promise<void> {
    await this.db.put('restores', pending);
  }

  async restoresOf(pageId: string): Promise<PendingRestore[]> {
    return (await this.db.getAllFromIndex('restores', 'page', pageId)).sort((a, b) => a.at - b.at);
  }

  /** Las de todas las páginas (para terminarlas sin abrir el historial de cada una). */
  async allRestores(): Promise<PendingRestore[]> {
    return (await this.db.getAll('restores')).sort((a, b) => a.at - b.at);
  }

  async hasRestore(id: string): Promise<boolean> {
    return (await this.db.get('restores', id)) !== undefined;
  }

  async removeRestore(id: string): Promise<void> {
    await this.db.delete('restores', id);
  }
}
