import type { MediaDb, MediaRecord } from './mediaDb';
import { md5Blob } from './md5';
import { MARK_PREFIX, MARKS_REV, protects, type OfflineMark } from './offlineStore';

// Liberar el original de un archivo agregado en este dispositivo (Docs/Doc_Copias_Locales.md, entrega 2, sección
// 5.3). `freeOwn` es la ÚNICA función de la app que borra `blobs[<id>]`, la clave sin prefijo de un original propio
// (las copias bajadas viven en `off:`/`offview:` y las borra `dropCopy`, que nunca arma esta clave). Quien llama ya
// comprobó la base (`drive_id`, fuera de las papeleras) y Drive (`POST /verify`: mismo id, peso, marca y MD5, fuera de
// la papelera); acá se repite todo lo del dispositivo **adentro de la transacción que borra**, porque entre la
// comprobación y el borrado pudo pasar algo (una restauración de la base lo volvió a la cola, alguien lo marcó).

/** Un original propio no se libera antes de esto desde que se confirmó su subida (la semana del rodaje, un error del dueño en Drive). */
export const OWN_MIN_AGE_MS = 14 * 24 * 60 * 60_000;

/** Lo comprobado afuera, que la transacción vuelve a mirar contra el registro. */
export interface OwnGuard {
  /** El `marksRev` con que se armó la lista: si cambió, no se borra en esta vuelta. */
  rev: number;
  /** El id de Drive que `/verify` miró (y que la base tiene). */
  driveId: string;
  /** El peso y el MD5 que Drive confirmó. */
  size: number;
  md5: string;
  now: number;
  /** Cuándo estrenó este dispositivo el tope (`space:rollout`): la fecha de subida de lo anterior a `uploadedAt`. */
  rollout: number | null;
}

/** Por qué un original propio no se puede liberar (todavía). `null`: se puede, en lo que mira el dispositivo. */
export type OwnBlock = 'missing' | 'freed' | 'waiting' | 'blocked' | 'recent' | 'protected';

/**
 * Lo que mira el dispositivo de un original propio (sin la base ni Drive): que esté, que la subida esté confirmada y
 * terminada, que no espere nada (`uploadId`, un HEIC sin convertir) y que hayan pasado los 14 días desde la subida.
 */
export function ownBlock(record: MediaRecord, hasBlob: boolean, marks: readonly OfflineMark[], now: number, rollout: number | null): OwnBlock | null {
  if (record.freedAt) return 'freed';
  if (!hasBlob) return 'missing';
  if (record.pending !== 0 || !record.driveId || record.uploadId || record.heic === 'pending' || record.heic === 'sent') return 'waiting';
  if (record.blocked) return 'blocked';
  const uploaded = record.uploadedAt ?? rollout;
  if (uploaded === null || uploaded === undefined || now - uploaded < OWN_MIN_AGE_MS) return 'recent';
  if (protects(marks, record.id).orig) return 'protected';
  return null;
}

/**
 * Borra el original propio `blobs[<id>]` y pone `freedAt` en su registro, en una sola transacción, solo si sigue
 * todo como se comprobó: registro subido y confirmado con el mismo id de Drive, peso y MD5, sin nada pendiente, con
 * 14 días desde la subida, `marksRev` igual y ninguna marca que lo pida. Devuelve los bytes liberados (0 si no).
 */
export async function freeOwn(db: MediaDb, id: string, guard: OwnGuard): Promise<number> {
  const tx = db.transaction(['files', 'blobs', 'meta'], 'readwrite');
  const files = tx.objectStore('files');
  const blobs = tx.objectStore('blobs');
  const meta = tx.objectStore('meta');
  const record = await files.get(id);
  const stop = async () => {
    await tx.done;
    return 0;
  };
  // La clave es la del registro, tal cual: nunca una armada (ni con un prefijo de copias).
  if (!record || record.id !== id) return stop();
  const blob = await blobs.get(record.id);
  const rev = ((await meta.get(MARKS_REV)) as number | undefined) ?? 0;
  const marks = ((await meta.getAll(IDBKeyRange.bound(MARK_PREFIX, `${MARK_PREFIX}￿`))) as OfflineMark[]).filter((m) => m && typeof m.id === 'string');
  if (rev !== guard.rev) return stop();
  if (ownBlock(record, !!blob, marks, guard.now, guard.rollout) !== null) return stop();
  if (record.driveId !== guard.driveId || record.size !== guard.size || !blob || blob.size !== record.size) return stop();
  if (!record.md5 || record.md5 !== guard.md5) return stop();
  await blobs.delete(record.id);
  await files.put({ ...record, freedAt: guard.now });
  await tx.done;
  return blob.size;
}

/**
 * El MD5 del original propio (sección 5.3): el guardado en el registro, o se calcula por tramos y se guarda, solo si
 * mientras tanto el registro y el original siguen iguales. `null` si no hay original.
 */
export async function ensureMd5(db: MediaDb, id: string, signal?: AbortSignal): Promise<string | null> {
  const record = await db.get('files', id);
  if (!record || record.freedAt) return null;
  if (record.md5) return record.md5;
  const blob = await db.get('blobs', id);
  if (!blob || blob.size !== record.size) return null;
  const md5 = await md5Blob(blob, undefined, signal);
  const tx = db.transaction(['files', 'blobs'], 'readwrite');
  const current = await tx.objectStore('files').get(id);
  const still = await tx.objectStore('blobs').get(id);
  // Cambió en el medio (un HEIC que pasó a JPEG, se liberó): no se anota nada.
  if (current && !current.freedAt && current.size === record.size && still && still.size === blob.size) {
    await tx.objectStore('files').put({ ...current, md5 });
  }
  await tx.done;
  return current && still && still.size === blob.size ? md5 : null;
}
