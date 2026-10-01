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
  /**
   * `false` mientras falta sacar medidas y miniatura (se hace después de guardar el archivo, y otra vez al
   * abrir la app si se cerró en el medio). Sin el campo (registros anteriores), ya se sacaron.
   */
  probed?: boolean;
  /** Por qué no se pudo subir la miniatura (se siguió con el original sin ella). */
  thumbError?: string | null;
  /** Veces seguidas que el servidor dijo que el archivo no existe aunque figuraba registrado. */
  lost?: number;
  /**
   * Veces seguidas que la subida se cortó por dejar de moverse sin haber avanzado (ver `STALL_MS` en
   * portero.ts). Vuelve a 0 cuando el portero confirma más bytes y al terminar. Cada trabada le da más plazo
   * al intento siguiente (`answerLimit`) y, cada `STALLS_BEFORE_RENEW`, al retomar se abre otra subida si la
   * que hay no recibió nada. Opcional: los registros guardados por una versión anterior no lo tienen y valen 0.
   */
  stalls?: number;
  /**
   * Una foto HEIC que no se pudo pasar a JPEG al agregarla (Docs/Doc_Imagenes.md, "Fotos HEIC"): se guardó tal
   * cual. `retry`: el decodificador no estaba (sin red); se vuelve a probar antes de registrarla. `failed`: no
   * se pudo convertir, o ya se registró como HEIC; queda así. Sin el campo, no hay nada pendiente.
   */
  heic?: 'retry' | 'failed';
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
 * Un archivo que una página usa (`page_files`), o que dejó de usar. El dispositivo que registra el archivo
 * ya lo cuelga de su página; esto es para los que llegan a otra página (se copió o se pegó el bloque) y,
 * desde la papelera de archivos (paso 11), para lo que la página dejó de usar (`removed`). Una sola fila por
 * par: lo último que se vio en el documento gana, así un deshacer rápido no se pisa con el borrado.
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
   * persona no puede editar esa página; `held`: la página dejó de usarlo, pero este dispositivo tiene otro
   * uso del mismo archivo sin confirmar, y quitarlo lo mandaría a la papelera mientras se ve en otra página.
   * En todos los casos se espera sin contarlo como cambio sin subir.
   */
  waiting: 'file_not_found' | 'denied' | 'held' | null;
  error: string | null;
  blocked: boolean;
  failures: number;
  retryAt: number;
  /**
   * Lo que tiene que quedar en el servidor: `true`, la página ya no lo usa (`unlink_page_file`); sin el
   * campo o `false`, lo usa (`link_page_file`). Las filas anteriores al paso 11 no lo tienen.
   */
  removed?: boolean;
  /**
   * Sube cada vez que cambia `removed`: una respuesta que llega después de un cambio no marca como hecho
   * lo que todavía falta mandar.
   */
  rev?: number;
  /**
   * Con `removed`: el `seq` del documento con el que se decidió que la página ya no lo usa. Va con
   * `unlink_page_file` (`p_seen_seq`): si la página cambió después en el servidor, la base lo ignora y se
   * vuelve a comparar con el documento nuevo.
   */
  seenSeq?: number;
  /**
   * El archivo es de otro proyecto (se pegó el bloque desde otro proyecto): la base guardó el uso como ajeno
   * (cuenta para la papelera, así el archivo no se va mientras se ve acá) y respondió `file_other_project`.
   * Confirmado: no hay nada más que mandar. En la página se ve el marcador de otro proyecto. También se
   * pone al pegarlo, si ya se sabe que es de otro proyecto (ya se avisó; la fila sigue por mandar).
   */
  foreign?: boolean;
}

/** Lo que el servidor sabe de un archivo (fila de `files`), guardado para mostrarlo sin red. */
export interface KnownFile {
  id: string;
  name: string;
  mime: string;
  /** El peso en bytes. Sin el campo (guardado antes de los adjuntos), no se sabe. */
  size?: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  thumbAt: string | null;
  driveId: string | null;
  /**
   * Un dueño o admin lo mandó a la papelera de Drive (`purged_at` o `drive_trashed_at`): en la página se
   * muestra como borrado. Sin el campo, no se sabe (se guardó antes del paso 11).
   */
  deleted?: boolean;
  /** El portero confirmó que está en la papelera de Drive (`drive_trashed_at`). */
  inDriveTrash?: boolean;
  /** El proyecto del archivo (`project_id`), para no registrarlo como uso de una página de otro proyecto. */
  projectId?: string | null;
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
