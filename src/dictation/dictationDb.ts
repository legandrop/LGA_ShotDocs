import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

// La base del dictado en el dispositivo, `shotdocs-dictation` (Docs/Doc_Dictado.md, 8). Propia, no la del asistente:
// una pestaña vieja que abriera esa base con otra versión fallaría. Dos almacenes, creados juntos en la versión 1 (V1):
//
// - `drafts`: el borrador de la hoja por correo, workspace y página (drafts.ts).
// - `notes`: la cola de notas sin red (queue.ts, entrega V2). Guarda dos clases de filas en el mismo almacén, por el
//   prefijo de la clave, para no subir la versión de la base (una pestaña de V1 abierta la seguiría abriendo):
//   `n:<id>` es una nota y `c:<id>:<número>` es un pedazo de su grabación (V3).
//
// La versión NO sube: si alguna vez hiciera falta, una pestaña vieja abierta no podría abrirla.

export const DICTATION_DB = 'shotdocs-dictation';
export const DICTATION_DB_VERSION = 1;

/** Un pedazo de una nota que no se ubicó (o que la persona destildó). */
export interface PendingItem {
  id: string;
  text: string;
}

export interface Draft {
  /** `correo|workspace|página`. */
  id: string;
  email: string;
  workspace: string;
  pageId: string;
  /** Lo escrito en el campo (la nota que todavía no se ubicó). */
  text: string;
  /** Lo que quedó sin ubicar. */
  pending: PendingItem[];
  /**
   * La última nota aplicada, tal como la escribió la persona: queda a la vista hasta *Done* o *New note*, por si el
   * modelo se salteó una parte sin decirlo (B1 de la auditoría de V1).
   */
  applied?: string;
  updatedAt: number;
}

/** El estado de una nota de la cola. */
export type NoteState =
  /** Grabando (V3): los pedazos se van guardando; si la página muere, al volver queda como `saved`. */
  | 'recording'
  /** Con audio y sin transcribir todavía (sin red, o esperando su turno). */
  | 'saved'
  /** Con texto (escrito, o ya transcrito): lista para ubicar. */
  | 'ready'
  /** La transcripción falló: queda con su error, para reintentar, copiar o descartar. */
  | 'failed';

export interface QueuedNote {
  /** `n:<uuid>`. */
  id: string;
  kind: 'note';
  email: string;
  workspace: string;
  pageId: string;
  /** El título de la página al guardarla (para la lista, si la página ya no se ve). */
  pageTitle: string;
  createdAt: number;
  updatedAt: number;
  /** Lo escrito, o la transcripción (vacío mientras el audio no se transcribió). */
  text: string;
  state: NoteState;
  /** V3: la grabación, guardada en pedazos aparte (`c:<id sin n:>:<número>`). */
  audio?: { mime: string; chunks: number; durationMs: number };
  /** Por qué falló la transcripción (sin la clave). */
  error?: string;
  /**
   * Una pestaña la está transcribiendo (O1 de la auditoría de V2/V3): las otras no la mandan otra vez hasta `until`. Si
   * esa pestaña murió, el reclamo vence solo.
   */
  claim?: { by: string; until: number };
}

export interface StoredChunk {
  /** `c:<uuid>:<número de 5 cifras>`. */
  id: string;
  kind: 'chunk';
  note: string;
  seq: number;
  data: ArrayBuffer;
}

interface Schema extends DBSchema {
  drafts: { key: string; value: Draft };
  notes: { key: string; value: QueuedNote | StoredChunk };
}

let opening: Promise<IDBPDatabase<Schema>> | null = null;

export function dictationDb(): Promise<IDBPDatabase<Schema>> {
  opening ??= openDB<Schema>(DICTATION_DB, DICTATION_DB_VERSION, {
    upgrade(d) {
      if (!d.objectStoreNames.contains('drafts')) d.createObjectStore('drafts', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('notes')) d.createObjectStore('notes', { keyPath: 'id' });
    },
    // Otra pestaña necesita la base con otra versión (no debería pasar: la versión no sube). Se cierra para no
    // trabarla; la próxima vez se vuelve a abrir.
    blocking() {
      void opening?.then((db) => db.close()).catch(() => undefined);
      opening = null;
    },
  }).catch((err: unknown) => {
    opening = null;
    throw err;
  });
  return opening;
}

/** Para las pruebas: cierra la base (la próxima vez se vuelve a abrir). */
export async function closeDictationDb(): Promise<void> {
  const d = await opening?.catch(() => null);
  d?.close();
  opening = null;
}
