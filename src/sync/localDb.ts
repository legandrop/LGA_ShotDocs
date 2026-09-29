import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { FailedOp, PageRow, QueuedOp } from './types';

/** Estado de sincronización del contenido de una página en este dispositivo. */
export interface DocState {
  pageId: string;
  /** Último `seq` del servidor que ya está guardado acá. */
  cursor: number;
  /** Cuenta las ediciones locales guardadas. Sube una vez por update de Yjs. */
  version: number;
  /** Hasta qué `version` confirmó el servidor. Si es menor que `version`, hay cambios sin subir. */
  ackedVersion: number;
  /** Vector de estado de lo que el servidor ya tiene. Lo que falta subir se calcula contra esto. */
  syncedSV?: Uint8Array;
  /** Update enviado y todavía sin confirmar. Se reenvía igual (mismo id) hasta que el servidor responde. */
  pending?: { id: string; update: Uint8Array; sv: Uint8Array; version: number };
  lastError?: string;
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

export function localDbName(projectRef: string, userId: string): string {
  return `shotdocs:${projectRef}:${userId}`;
}

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

export function hasUnsyncedContent(state: DocState): boolean {
  return state.version > state.ackedVersion || state.pending !== undefined;
}
