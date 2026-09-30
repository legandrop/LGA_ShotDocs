import { errorMessage } from '../sync/types';
import type { MediaRemote } from '../sync/remote';
import type { TrashedFileRow } from '../sync/types';
import { PorteroError } from './portero';

// La pestaña Archivos de la papelera (paso 11 de Docs/Plan_Workspaces.md): leer la papelera de archivos de
// un proyecto y mandar archivos a la papelera de Drive, de a uno o todos. Sin React, para poder probarlo.
// Solo con red: la base y el portero deciden (quién ve, quién manda, si una página lo volvió a usar).

/** Días que un archivo espera en la papelera antes del borrado automático (apagado hasta que Lega lo confirme). */
export const TRASH_DAYS = 30;

/** Lo que se avisa antes de mandar nada a la papelera de Drive (el riesgo que anota el plan). */
export const UNSYNCED_USE_WARNING = "A file can show here while still in use on a page this device hasn't synced.";

/**
 * La papelera de archivos del proyecto, o `null` si la sesión no la ve (`not_allowed`) o la base todavía no
 * tiene la papelera (la función no existe): en los dos casos la pestaña no se muestra. Sin red u otro error,
 * tira (la pestaña lo muestra con "Retry").
 */
export async function loadFileTrash(remote: Pick<MediaRemote, 'trashedFiles'>, projectId: string): Promise<TrashedFileRow[] | null> {
  try {
    return await remote.trashedFiles(projectId);
  } catch (err) {
    const message = errorMessage(err);
    const code = (err as { code?: string }).code;
    if (message === 'not_allowed' || code === '42501' || code === 'PGRST202') return null;
    throw err;
  }
}

/** Cómo terminó mandar un archivo a la papelera de Drive. */
export type TrashOutcome =
  | { status: 'done' }
  /** 409: una página lo volvió a usar (ya no está en la papelera). Hay que volver a leer la lista. */
  | { status: 'in_use'; message: string }
  /** 403, 404, 502, sin red...: queda en la lista con el error a la vista. */
  | { status: 'error'; message: string };

/** Manda uno a la papelera de Drive (`POST /trash`) y dice cómo terminó; nunca tira. */
export async function sendToDriveTrash(trash: (fileId: string) => Promise<unknown>, fileId: string): Promise<TrashOutcome> {
  try {
    await trash(fileId);
    return { status: 'done' };
  } catch (err) {
    if (err instanceof PorteroError && err.status === 409) return { status: 'in_use', message: err.message };
    if (err instanceof PorteroError && err.status === 0) {
      return { status: 'error', message: 'No connection with the media server. Nothing was sent; try again when online.' };
    }
    return { status: 'error', message: errorMessage(err) };
  }
}

/**
 * "Empty": manda todos de a uno, en orden, avisando el avance después de cada uno. Si uno falla, sigue con
 * los demás. Devuelve cómo terminó cada uno.
 */
export async function emptyFileTrash(
  trash: (fileId: string) => Promise<unknown>,
  fileIds: string[],
  onProgress?: (done: number, total: number, fileId: string, outcome: TrashOutcome) => void,
  signal?: { cancelled: boolean },
): Promise<Map<string, TrashOutcome>> {
  const results = new Map<string, TrashOutcome>();
  for (const id of fileIds) {
    if (signal?.cancelled) break;
    const outcome = await sendToDriveTrash(trash, id);
    results.set(id, outcome);
    onProgress?.(results.size, fileIds.length, id, outcome);
  }
  return results;
}

/** El peso para mostrar: `820 KB`, `61.9 MB`, `1.2 GB`. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/** Cuánto le falta para los 30 días, dicho corto. */
export function daysLeftText(days: number): string {
  if (days <= 0) return `${TRASH_DAYS} days passed`;
  return days === 1 ? '1 day left' : `${days} days left`;
}
