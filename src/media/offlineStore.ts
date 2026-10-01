import type { FileKind } from './attachments';
import type { MediaDb } from './mediaDb';

// Lo que guarda "Available offline" en la base de archivos del dispositivo (Docs/Doc_Copias_Locales.md, sección
// 2), sin almacenes nuevos ni versión nueva de IndexedDB (una versión vieja de la app no podría abrirla):
//
//   blobs   off:<id>#<n>   las partes de una copia bajada del Drive (el archivo entero)
//   thumbs  offview:<id>   la nítida de 2048 de una foto, hecha para una marca (fuera de `viewIndex`)
//   meta    copy:<id>      qué copias hay de un archivo y cuándo se usó
//   meta    offline:<id>   una marca, con su conjunto de archivos
//   meta    marksRev       sube con cada cambio de las marcas: se relee adentro de la transacción que borra
//
// Regla dura: lo que se borra acá son solo claves con prefijo (`off:` y `offview:`). Un original agregado en este
// dispositivo vive en `blobs[<id>]`, sin prefijo, y ninguna función de este archivo arma esa clave: un error al
// armar una clave nunca puede llevarse un original sin subir.

export const OFF_PREFIX = 'off:';
export const OFFVIEW_PREFIX = 'offview:';
export const COPY_PREFIX = 'copy:';
export const MARK_PREFIX = 'offline:';
export const MARKS_REV = 'marksRev';
/** Hasta este peso, un adjunto entra con la casilla *Attachments up to 50 MB* (D-25). */
export const ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;

/** Las casillas de una marca (D-25: de fábrica, fotos en 2048 y adjuntos de hasta 50 MB). */
export interface OfflineOptions {
  sharp: boolean;
  originals: boolean;
  attachments: boolean;
  videos: boolean;
  folders: boolean;
}

export const DEFAULT_OPTIONS: OfflineOptions = { sharp: true, originals: false, attachments: true, videos: false, folders: false };

/** Un archivo de la rama marcada: qué páginas lo usan, su tipo y su peso (para el filtro por casillas). */
export interface MarkFile {
  pages: string[];
  kind: FileKind;
  size: number | null;
}

export type MarkState = 'downloading' | 'ready' | 'waiting' | 'noSpace' | 'offline';

/** Una marca "Available offline": una página con sus subpáginas, o un proyecto entero. */
export interface OfflineMark {
  id: string;
  kind: 'page' | 'project';
  /** La página o el proyecto marcado. */
  target: string;
  projectId: string;
  title: string;
  options: OfflineOptions;
  createdAt: number;
  /** Por cada página de la rama, el `seq` con el que se leyó su contenido completo (sin la clave: todavía no). */
  pages: Record<string, number>;
  /** El conjunto de la rama: todos sus archivos, sin filtrar por casillas (el filtro se aplica al proteger). */
  files: Record<string, MarkFile>;
  /** Las imágenes viejas (`sdfile://`) de sus páginas. */
  older?: string[];
  state: MarkState;
  /** Por qué se detuvo (sin lugar, el tope del iPhone), en palabras de la app. */
  error: string | null;
  /** Cuándo quedó todo lo pedido en el dispositivo por última vez. */
  readyAt: number | null;
  /** Cuándo se bajaron por última vez los comentarios de sus páginas. */
  commentsAt?: number | null;
}

export interface CopyPart {
  n: number;
  start: number;
  bytes: number;
}

/** Lo que hay en el dispositivo de un archivo bajado para "Available offline". */
export interface CopyEntry {
  id: string;
  /** La última vez que se abrió (una página que lo usa, o el archivo). */
  usedAt: number;
  orig?: { mime: string; total: number; parts: CopyPart[]; savedAt: number; complete: boolean };
  view?: { bytes: number; savedAt: number };
  /** Cuándo se confirmó que Google Drive ya no lo tiene: esta puede ser la única copia (nunca se borra sola). */
  gone?: number;
}

const copyKey = (id: string) => `${COPY_PREFIX}${id.toLowerCase()}`;
const markKey = (id: string) => `${MARK_PREFIX}${id}`;

/** La clave de una parte de una copia bajada. Siempre con `off:` adelante. */
export function partKey(id: string, n: number): string {
  return `${OFF_PREFIX}${id.toLowerCase()}#${n}`;
}

/** La clave de la nítida de una marca. Siempre con `offview:` adelante. */
export function offviewKey(id: string): string {
  return `${OFFVIEW_PREFIX}${id.toLowerCase()}`;
}

/** Lo que borra el código de las copias: nunca algo sin uno de los dos prefijos. */
function assertCopyKey(key: string): string {
  if (!(key.startsWith(OFF_PREFIX) || key.startsWith(OFFVIEW_PREFIX))) throw new Error(`not a copy key: ${key}`);
  return key;
}

function range(prefix: string): IDBKeyRange {
  return IDBKeyRange.bound(prefix, `${prefix}￿`);
}

// --- marcas ---------------------------------------------------------------------------------------------------

export async function listMarks(db: MediaDb): Promise<OfflineMark[]> {
  const values = (await db.getAll('meta', range(MARK_PREFIX))) as OfflineMark[];
  return values.filter((m) => m && typeof m === 'object' && typeof m.id === 'string').sort((a, b) => a.createdAt - b.createdAt);
}

export async function getRev(db: MediaDb): Promise<number> {
  const rev = await db.get('meta', MARKS_REV);
  return typeof rev === 'number' ? rev : 0;
}

/** Guarda una marca y sube `marksRev` en la misma transacción. Devuelve el `marksRev` nuevo. */
export async function putMark(db: MediaDb, mark: OfflineMark): Promise<number> {
  const tx = db.transaction('meta', 'readwrite');
  const rev = ((await tx.store.get(MARKS_REV)) as number | undefined) ?? 0;
  await tx.store.put(mark, markKey(mark.id));
  await tx.store.put(rev + 1, MARKS_REV);
  await tx.done;
  return rev + 1;
}

export async function deleteMark(db: MediaDb, id: string): Promise<number> {
  const tx = db.transaction('meta', 'readwrite');
  const rev = ((await tx.store.get(MARKS_REV)) as number | undefined) ?? 0;
  await tx.store.delete(markKey(id));
  await tx.store.put(rev + 1, MARKS_REV);
  await tx.done;
  return rev + 1;
}

/**
 * Qué copias de un archivo pide alguna marca, según sus casillas (Doc_Copias_Locales.md, sección 3.1, opción A):
 * `orig`, el archivo entero (una foto con *Original photos*, un video con *Videos*, un adjunto de hasta 50 MB con
 * *Attachments*); `view`, la nítida de una foto con *Large photos*.
 */
export function protects(marks: readonly OfflineMark[], fileId: string): { orig: boolean; view: boolean } {
  const id = fileId.toLowerCase();
  let orig = false;
  let view = false;
  for (const mark of marks) {
    const file = mark.files[id];
    if (!file) continue;
    const o = mark.options;
    if (file.kind === 'image') {
      view ||= o.sharp;
      orig ||= o.originals;
    } else if (file.kind === 'video') {
      orig ||= o.videos;
    } else {
      orig ||= o.attachments && file.size !== null && file.size <= ATTACHMENT_MAX_BYTES;
    }
  }
  return { orig, view };
}

// --- copias -------------------------------------------------------------------------------------------------

export async function getCopy(db: MediaDb, id: string): Promise<CopyEntry | undefined> {
  return (await db.get('meta', copyKey(id))) as CopyEntry | undefined;
}

export async function listCopies(db: MediaDb): Promise<CopyEntry[]> {
  return ((await db.getAll('meta', range(COPY_PREFIX))) as CopyEntry[]).filter((e) => e && typeof e.id === 'string');
}

/** Lo que ya se bajó de la copia (las partes van seguidas desde 0). */
export function copyReceived(entry: CopyEntry | undefined): number {
  return entry?.orig ? entry.orig.parts.reduce((n, p) => n + p.bytes, 0) : 0;
}

/**
 * Guarda una parte de una copia bajada y su avance en la misma transacción (nunca queda una parte sin su
 * entrada). `start` tiene que ser donde terminó lo anterior; si el total o el tipo cambiaron, empieza de nuevo.
 * Tira el error de IndexedDB tal cual (`QuotaExceededError`: falta de lugar).
 */
export async function appendPart(db: MediaDb, id: string, mime: string, total: number, start: number, part: Blob, now: number): Promise<CopyEntry> {
  const key = id.toLowerCase();
  const tx = db.transaction(['blobs', 'meta'], 'readwrite');
  const meta = tx.objectStore('meta');
  const blobs = tx.objectStore('blobs');
  const entry = ((await meta.get(copyKey(key))) as CopyEntry | undefined) ?? { id: key, usedAt: now };
  if (entry.orig && (entry.orig.total !== total || entry.orig.mime !== mime)) {
    for (const p of entry.orig.parts) await blobs.delete(assertCopyKey(partKey(key, p.n)));
    entry.orig = undefined;
  }
  const orig = entry.orig ?? { mime, total, parts: [], savedAt: now, complete: false };
  const next = orig.parts.reduce((n, p) => n + p.bytes, 0);
  if (start !== next) {
    tx.abort();
    await tx.done.catch(() => undefined);
    throw new Error(`gap: expected ${next}, got ${start}`);
  }
  const n = orig.parts.length ? Math.max(...orig.parts.map((p) => p.n)) + 1 : 0;
  await blobs.put(part, assertCopyKey(partKey(key, n)));
  orig.parts.push({ n, start, bytes: part.size });
  orig.complete = next + part.size === total;
  orig.savedAt = now;
  entry.orig = orig;
  delete entry.gone;
  await meta.put(entry, copyKey(key));
  await tx.done;
  return entry;
}

/** La copia bajada, entera y completa, armada sobre sus partes (sin copiar los bytes), o `null`. */
export async function readCopy(db: MediaDb, id: string): Promise<Blob | null> {
  const key = id.toLowerCase();
  const entry = await getCopy(db, key);
  const orig = entry?.orig;
  if (!orig?.complete) return null;
  const parts = [...orig.parts].sort((a, b) => a.start - b.start);
  let at = 0;
  for (const p of parts) {
    if (p.start !== at) return null;
    at += p.bytes;
  }
  if (at !== orig.total) return null;
  const blobs: Blob[] = [];
  for (const p of parts) {
    const blob = await db.get('blobs', partKey(key, p.n));
    if (!blob || blob.size !== p.bytes) return null;
    blobs.push(blob);
  }
  return new Blob(blobs, { type: orig.mime });
}

/** Guarda la nítida de una marca. */
export async function putOfflineView(db: MediaDb, id: string, blob: Blob, now: number): Promise<void> {
  const key = id.toLowerCase();
  const tx = db.transaction(['thumbs', 'meta'], 'readwrite');
  const meta = tx.objectStore('meta');
  const entry = ((await meta.get(copyKey(key))) as CopyEntry | undefined) ?? { id: key, usedAt: now };
  await tx.objectStore('thumbs').put(blob, assertCopyKey(offviewKey(key)));
  entry.view = { bytes: blob.size, savedAt: now };
  await meta.put(entry, copyKey(key));
  await tx.done;
}

export async function readOfflineView(db: MediaDb, id: string): Promise<Blob | null> {
  return (await db.get('thumbs', offviewKey(id))) ?? null;
}

/** Anota cuándo se usó (solo si ya hay una entrada: los originales propios no la tienen en esta entrega). */
export async function touchCopy(db: MediaDb, id: string, now: number): Promise<void> {
  const tx = db.transaction('meta', 'readwrite');
  const entry = (await tx.store.get(copyKey(id))) as CopyEntry | undefined;
  if (entry) await tx.store.put({ ...entry, usedAt: now }, copyKey(id));
  await tx.done;
}

/** Google Drive ya no lo tiene (confirmado): la copia puede ser la única y nada automático la borra. */
export async function markGone(db: MediaDb, id: string, now: number): Promise<void> {
  const tx = db.transaction('meta', 'readwrite');
  const entry = (await tx.store.get(copyKey(id))) as CopyEntry | undefined;
  if (entry) await tx.store.put({ ...entry, gone: now }, copyKey(id));
  await tx.done;
}

export interface DropGuard {
  /** El `marksRev` con que se armó la lista: si cambió, no se borra en esta vuelta. */
  rev?: number;
  /** Se puede borrar aunque una marca la pida (desmarcar, una parte a medias, sin lugar al escribir). */
  ignoreMarks?: boolean;
  /** Se puede borrar aunque sea `gone` (solo a mano, con el aviso de "única copia"). */
  allowGone?: boolean;
  /** Qué borrar: el archivo entero, la nítida o las dos (por defecto). */
  what?: 'orig' | 'view' | 'all';
}

/**
 * Borra una copia bajada o una nítida de una marca, con su entrada, en una sola transacción, comprobando adentro
 * que ninguna marca la pida (con las marcas leídas en la misma transacción) y que no sea `gone`. Devuelve los
 * bytes liberados (0 si no se borró nada). Solo arma claves `off:` y `offview:`.
 */
export async function dropCopy(db: MediaDb, id: string, guard: DropGuard = {}): Promise<number> {
  const key = id.toLowerCase();
  const tx = db.transaction(['blobs', 'thumbs', 'meta'], 'readwrite');
  const meta = tx.objectStore('meta');
  const entry = (await meta.get(copyKey(key))) as CopyEntry | undefined;
  if (!entry) {
    await tx.done;
    return 0;
  }
  const rev = ((await meta.get(MARKS_REV)) as number | undefined) ?? 0;
  const stop = async () => {
    await tx.done;
    return 0;
  };
  if (guard.rev !== undefined && rev !== guard.rev) return stop();
  if (entry.gone && !guard.allowGone) return stop();
  const what = guard.what ?? 'all';
  let wantOrig = what !== 'view' && !!entry.orig;
  let wantView = what !== 'orig' && !!entry.view;
  if (!guard.ignoreMarks) {
    const marks = ((await meta.getAll(range(MARK_PREFIX))) as OfflineMark[]).filter((m) => m && typeof m.id === 'string');
    const wanted = protects(marks, key);
    if (wanted.orig) wantOrig = false;
    if (wanted.view) wantView = false;
  }
  let freed = 0;
  if (wantOrig && entry.orig) {
    for (const p of entry.orig.parts) {
      await tx.objectStore('blobs').delete(assertCopyKey(partKey(key, p.n)));
      freed += p.bytes;
    }
    entry.orig = undefined;
  }
  if (wantView && entry.view) {
    await tx.objectStore('thumbs').delete(assertCopyKey(offviewKey(key)));
    freed += entry.view.bytes;
    entry.view = undefined;
  }
  if (!entry.orig && !entry.view) await meta.delete(copyKey(key));
  else await meta.put(entry, copyKey(key));
  await tx.done;
  return freed;
}

/**
 * Borra las partes y nítidas que no figuran en su entrada (un cierre a mitad de camino, una pestaña a la que le
 * tomaron el control y terminó de escribir una parte en vuelo): ocupan lugar que las sumas propias no ven.
 */
export async function cleanOrphans(db: MediaDb): Promise<number> {
  const entries = new Map((await listCopies(db)).map((e) => [e.id, e]));
  let removed = 0;
  const partKeys = (await db.getAllKeys('blobs', range(OFF_PREFIX))) as string[];
  for (const key of partKeys) {
    const m = /^off:(.+)#(\d+)$/.exec(key);
    const entry = m ? entries.get(m[1]) : undefined;
    if (m && entry?.orig?.parts.some((p) => p.n === Number(m[2]))) continue;
    await db.delete('blobs', assertCopyKey(key));
    removed++;
  }
  const viewKeys = (await db.getAllKeys('thumbs', range(OFFVIEW_PREFIX))) as string[];
  for (const key of viewKeys) {
    if (entries.get(key.slice(OFFVIEW_PREFIX.length))?.view) continue;
    await db.delete('thumbs', assertCopyKey(key));
    removed++;
  }
  return removed;
}
