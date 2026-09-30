import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { FailedOp, PageRow, QueuedOp } from './types';

/** Estado de sincronización del contenido de una página en este dispositivo. */
export interface DocState {
  pageId: string;
  /** Último `seq` del servidor que ya está guardado acá. */
  cursor: number;
  /**
   * Cuenta las ediciones locales guardadas. Desde el guardado sin lecturas (ver `dirtyKey`) sube en una
   * transacción aparte, justo después de cada edición guardada: lo que falta subir lo dice la marca, y la
   * versión se sigue sumando para las versiones anteriores de la app que abran esta misma base (y para la
   * papelera de archivos, que la usa para saber si el documento cambió).
   */
  version: number;
  /** Hasta qué `version` confirmó el servidor. Si es menor que `version`, hay cambios sin subir. */
  ackedVersion: number;
  /** Vector de estado de lo que el servidor ya tiene. Lo que falta subir se calcula contra esto. */
  syncedSV?: Uint8Array;
  /** Update enviado y todavía sin confirmar. Se reenvía igual (mismo id) hasta que el servidor responde. */
  pending?: {
    id: string;
    update: Uint8Array;
    sv: Uint8Array;
    version: number;
    /**
     * La marca de ediciones sin subir (`dirtyKey`) que había al armar el envío, leída en la misma
     * transacción que lo guardado. Al confirmarse, la marca se borra solo si sigue siendo esta. Un envío
     * armado por una versión anterior no la tiene.
     */
    dirty?: string;
  };
  lastError?: string;
  /** El servidor rechazó el contenido para siempre (por ejemplo, por tamaño). Se reintenta al abrir la app. */
  rejected?: string;
  /**
   * Llegó del servidor un update que este dispositivo no pudo leer (quedó intacto en el servidor): al
   * documento local le puede faltar contenido, así que nunca se usa para decir que la página dejó de usar
   * un archivo (papelera de archivos). No se borra.
   */
  unreadable?: boolean;
}

/** Imagen pegada en una página. Se guarda acá primero y se sube cuando hay red. */
export interface FileRecord {
  path: string;
  pageId: string;
  mime: string;
  data: ArrayBuffer;
  /** 0 = falta subirla, 1 = ya está en el servidor. Número porque IndexedDB no indexa booleanos. */
  uploaded: 0 | 1;
  createdAt: number;
  lastError?: string;
}

interface ShotDocsDB extends DBSchema {
  meta: { key: string; value: unknown };
  pages: { key: string; value: PageRow };
  ops: { key: number; value: QueuedOp };
  failedOps: { key: number; value: FailedOp };
  docUpdates: { key: number; value: { pageId: string; data: Uint8Array }; indexes: { pageId: string } };
  docState: { key: string; value: DocState };
  files: { key: string; value: FileRecord; indexes: { uploaded: number } };
}

export type LocalDb = IDBPDatabase<ShotDocsDB>;

export function openLocalDb(name: string): Promise<LocalDb> {
  return openDB<ShotDocsDB>(name, 1, {
    upgrade(db) {
      db.createObjectStore('meta');
      db.createObjectStore('pages', { keyPath: 'id' });
      db.createObjectStore('ops', { keyPath: 'seq', autoIncrement: true });
      db.createObjectStore('failedOps', { keyPath: 'seq', autoIncrement: true });
      db.createObjectStore('docUpdates', { autoIncrement: true }).createIndex('pageId', 'pageId');
      db.createObjectStore('docState', { keyPath: 'pageId' });
      db.createObjectStore('files', { keyPath: 'path' }).createIndex('uploaded', 'uploaded');
    },
  });
}

export function emptyDocState(pageId: string): DocState {
  return { pageId, cursor: 0, version: 0, ackedVersion: 0 };
}

/** Lee, modifica y guarda el estado de una página en una sola transacción. */
export async function updateDocState(
  db: LocalDb,
  pageId: string,
  mutate: (state: DocState) => void,
): Promise<DocState> {
  const tx = db.transaction('docState', 'readwrite');
  const state = (await tx.store.get(pageId)) ?? emptyDocState(pageId);
  mutate(state);
  await tx.store.put(state);
  await tx.done;
  return state;
}

/**
 * Clave en `meta` de la marca de ediciones locales guardadas que todavía no entraron en una subida
 * confirmada. Cada escritura local pone una marca nueva (un id al azar) en la misma transacción que el
 * update, sin leer nada antes: así la transacción se confirma en el acto (ver docs.ts, `startWrite`).
 * `meta` ya existe y las versiones anteriores solo la leen por clave, así que la base no cambia de versión.
 */
export function dirtyKey(pageId: string): string {
  return `${DIRTY_PREFIX}${pageId}`;
}
export const DIRTY_PREFIX = 'docDirty:';
/** Todas las marcas de `meta`. */
export function dirtyRange(): IDBKeyRange {
  return IDBKeyRange.bound(DIRTY_PREFIX, `${DIRTY_PREFIX}\uffff`);
}

/**
 * Si la página tiene algo sin subir: la marca de ediciones sin subir (`dirty`), una versión mayor que la
 * confirmada (lo de siempre: así lo guardado por una versión anterior se sigue subiendo) o un envío sin
 * confirmar.
 */
export function hasUnsyncedContent(state: DocState, dirty = false): boolean {
  return dirty || state.version > state.ackedVersion || state.pending !== undefined;
}

/**
 * El estado de las páginas con algo sin subir (ver `hasUnsyncedContent`), leído en una sola transacción con
 * las marcas. Una página con marca y sin estado guardado todavía (la app se cerró antes de sumar la
 * versión) viene con el estado vacío.
 */
export async function unsyncedDocStates(db: LocalDb): Promise<DocState[]> {
  const tx = db.transaction(['docState', 'meta'], 'readonly');
  const [states, keys] = await Promise.all([tx.objectStore('docState').getAll(), tx.objectStore('meta').getAllKeys(dirtyRange())]);
  await tx.done;
  const dirty = new Set(keys.map((k) => String(k).slice(DIRTY_PREFIX.length)));
  const out = states.filter((s) => hasUnsyncedContent(s, dirty.has(s.pageId)));
  const known = new Set(states.map((s) => s.pageId));
  for (const pageId of dirty) if (!known.has(pageId)) out.push(emptyDocState(pageId));
  return out;
}
