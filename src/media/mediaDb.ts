import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

// Las fotos y los videos que se agregan a las páginas (`sdmedia://<id>`), en una base IndexedDB aparte:
// `<nombre de la base local>:media`. La base de siempre no cambia de versión: una versión vieja de la app
// que la abriera con una versión más nueva no podría abrirla (IndexedDB no deja bajar de versión).

/** Un archivo agregado en este dispositivo, en la cola hasta que el servidor confirma todo. */
export interface MediaRecord {
  /** El id de la fila de `files` (uuid creado acá). */
  id: string;
  pageId: string;
  projectId: string | null;
  name: string;
  /** En minúsculas, `tipo/subtipo`, sin parámetros. */
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  /** Segundos (videos). */
  duration: number | null;
  /** El día local en que se agregó, `AAAA-MM-DD`: la carpeta del día en Drive. */
  day: string;
  createdAt: number;
  /** 1 mientras falta algo; 0 cuando el servidor confirmó todo. Número porque IndexedDB no indexa booleanos. */
  pending: 0 | 1;
  /** `register_file` ya respondió bien. */
  registered: boolean;
  /**
   * La miniatura: `none` si el navegador no pudo abrir el archivo (queda un ícono), `local` si está hecha y
   * falta subirla, `done` si ya está en el bucket `thumbs` y marcada con `set_file_thumb`.
   */
  thumb: 'none' | 'local' | 'done';
  /** La subida al portero que quedó a medias: con esto se retoma después de cerrar la app. */
  uploadId: string | null;
  /** Hasta dónde confirmó el portero (bytes). */
  sent: number;
  /** El id en Drive cuando el portero respondió `done`. */
  driveId: string | null;
  /** El último error, a la vista; `null` si anduvo. */
  error: string | null;
  /** El error no se arregla reintentando: se vuelve a probar con "Retry" o al abrir la app. Nada se descarta. */
  blocked: boolean;
  /** Fallas seguidas (para esperar cada vez un poco más) y cuándo reintentar. */
  failures: number;
  retryAt: number;
}

/**
 * Un archivo que una página usa (`page_files`). El dispositivo que registra el archivo ya lo cuelga de su
 * página; esto es para los que llegan a otra página (se copió o se pegó el bloque).
 */
export interface MediaLink {
  /** `<página>:<archivo>` */
  key: string;
  pageId: string;
  fileId: string;
  /** 1 hasta que el servidor confirma (`link_page_file`). */
  pending: 0 | 1;
  /**
   * `file_not_found`: el archivo todavía no llegó al servidor (lo registra otro dispositivo); `denied`: la
   * persona no puede editar esa página. En los dos casos se espera sin contarlo como pendiente.
   */
  waiting: 'file_not_found' | 'denied' | null;
  error: string | null;
  blocked: boolean;
  failures: number;
  retryAt: number;
}

/** Lo que el servidor sabe de un archivo (fila de `files`), guardado para mostrarlo sin red. */
export interface KnownFile {
  id: string;
  name: string;
  mime: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  thumbAt: string | null;
  driveId: string | null;
  fetchedAt: number;
}

interface MediaDBSchema extends DBSchema {
  meta: { key: string; value: unknown };
  files: { key: string; value: MediaRecord; indexes: { pending: number } };
  /** El archivo original, tal como lo entregó el dispositivo. */
  blobs: { key: string; value: Blob };
  /** La miniatura (JPEG): la hecha acá o la bajada del bucket `thumbs`. */
  thumbs: { key: string; value: Blob };
  links: { key: string; value: MediaLink; indexes: { pending: number } };
  known: { key: string; value: KnownFile };
}

export type MediaDb = IDBPDatabase<MediaDBSchema>;

/** El nombre de la base de archivos que acompaña a una base local. */
export function mediaDbName(localDbName: string): string {
  return `${localDbName}:media`;
}

export function openMediaDb(name: string): Promise<MediaDb> {
  return openDB<MediaDBSchema>(name, 1, {
    upgrade(db) {
      db.createObjectStore('meta');
      db.createObjectStore('files', { keyPath: 'id' }).createIndex('pending', 'pending');
      db.createObjectStore('blobs');
      db.createObjectStore('thumbs');
      db.createObjectStore('links', { keyPath: 'key' }).createIndex('pending', 'pending');
      db.createObjectStore('known', { keyPath: 'id' });
    },
  });
}
