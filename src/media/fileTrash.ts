import { locale, t } from '../i18n';
import type { Language } from '../prefs';
import { errorMessage } from '../sync/types';
import type { MediaRemote } from '../sync/remote';
import type { TrashedFileRow } from '../sync/types';
import { PorteroError } from './portero';
import { UnsentUseError } from './queue';

// La pestaña Archivos de la papelera (paso 11 de Docs/Plan_Workspaces.md): leer la papelera de archivos de
// un proyecto y mandar archivos a la papelera de Drive, de a uno o todos. Sin React, para poder probarlo.
// Solo con red: la base y el portero deciden (quién ve, quién manda, si una página lo volvió a usar).

/** Días que un archivo espera en la papelera antes del borrado automático (apagado hasta que Lega lo confirme). */
export const TRASH_DAYS = 30;

/** Lo que se avisa antes de mandar nada a la papelera de Drive (el riesgo que anota el plan). */
export function unsyncedUseWarning(): string {
  return t('fileTrash.unsyncedUse');
}

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

/** Lo que se dice si el Drive del dueño no está conectado al portero. */
export function driveNotConnected(): string {
  return t('fileTrash.driveNotConnected');
}

/** Cómo terminó mandar un archivo a la papelera de Drive. */
export type TrashOutcome =
  | { status: 'done' }
  /** 409 con `code: 'in_use'`: una página lo volvió a usar (ya no está en la papelera). Hay que volver a leer la lista. */
  | { status: 'in_use'; message: string }
  /** 503 con `code: 'drive_not_connected'`: no se mandó nada ni se marcó nada; los demás fallarían igual. */
  | { status: 'not_connected'; message: string }
  /**
   * 426 con `code: 'app_outdated'`: esta app es más vieja que la versión mínima del workspace. No se mandó ni se marcó
   * nada; los demás fallarían igual hasta actualizar la app.
   */
  | { status: 'outdated'; message: string }
  /** Una página de este dispositivo lo usa y todavía no se sincronizó: se saltea. */
  | { status: 'unsent_use'; message: string }
  /** 403, 404, otro 409, 502, sin red...: queda en la lista con el error a la vista. */
  | { status: 'error'; message: string };

/** Manda uno a la papelera de Drive (`POST /trash`) y dice cómo terminó; nunca tira. */
export async function sendToDriveTrash(trash: (fileId: string) => Promise<unknown>, fileId: string): Promise<TrashOutcome> {
  try {
    await trash(fileId);
    return { status: 'done' };
  } catch (err) {
    if (err instanceof UnsentUseError) return { status: 'unsent_use', message: err.message };
    if (err instanceof PorteroError && err.code === 'in_use') return { status: 'in_use', message: err.message };
    if (err instanceof PorteroError && err.code === 'drive_not_connected') return { status: 'not_connected', message: driveNotConnected() };
    if (err instanceof PorteroError && err.code === 'app_outdated') return { status: 'outdated', message: t('queue.outdated') };
    if (err instanceof PorteroError && err.status === 0) {
      return { status: 'error', message: t('fileTrash.noConnection') };
    }
    return { status: 'error', message: errorMessage(err) };
  }
}

/**
 * "Empty": manda todos de a uno, en orden, avisando el avance después de cada uno. Si uno falla, sigue con
 * los demás; si el Drive no está conectado o la app es más vieja que la mínima del workspace, para (fallarían
 * todos). Devuelve cómo terminó cada uno.
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
    if (outcome.status === 'not_connected' || outcome.status === 'outdated') break;
  }
  return results;
}

const SIZE_UNITS = ['KB', 'MB', 'GB', 'TB'] as const;

/** Redondeado como se muestra: un decimal por debajo de 100, entero desde 100. */
function roundShown(value: number): number {
  return value < 100 ? Math.round(value * 10) / 10 : Math.round(value);
}

/**
 * El peso para mostrar, en base 1024 como cuenta Google: `820 KB`, `61.9 MB`, `3.4 GB`, `30 GB`, `1.2 TB`
 * (en castellano, `61,9 MB`). Una sola regla: un decimal por debajo de 100 y ninguno desde 100, sin `.0`
 * (`30 GB`, no `30.0 GB`). Se pasa a la unidad de arriba cuando el número llegaría a 1000 (nunca `1000 MB`).
 * Algo de menos de 0,1 KB (y más de cero) se muestra como `0.1 KB`.
 */
export function formatSize(bytes: number, lang?: Language): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  let unit = 0;
  let value = bytes / 1024;
  while (unit < SIZE_UNITS.length - 1 && roundShown(value) >= 1000) {
    value /= 1024;
    unit++;
  }
  if (bytes > 0) value = Math.max(0.1, value);
  const format = new Intl.NumberFormat(locale(lang), { maximumFractionDigits: roundShown(value) < 100 ? 1 : 0 });
  return `${format.format(roundShown(value))} ${SIZE_UNITS[unit]}`;
}

/** Cuánto le falta para los 30 días, dicho corto. */
export function daysLeftText(days: number): string {
  if (days <= 0) return t('fileTrash.daysPassed', { days: TRASH_DAYS });
  return t('fileTrash.daysLeft', { count: days });
}
