import type { LocalDb } from '../sync/localDb';
import type { SizesRemote } from '../sync/remote';
import { errorMessage, isNetworkError, type ProjectSizeRow } from '../sync/types';

// Cuánto ocupa cada proyecto en el Drive (P.7, Docs/Doc_Peso_Proyectos.md). Lo calcula la base
// (`project_sizes`, versión 7) y acá se guarda la última respuesta en la base local (`meta.projectSizes`):
// sin red se muestra el último valor. Sin React, para poder probarlo.
//
// Nunca se pide en cada render. Se pide al abrir el selector de proyectos si pasaron 5 minutos del último
// pedido, siempre al abrir el diálogo de Google Drive y al tocar "Volver a calcular", y una vez al terminar
// de vaciar la papelera de archivos. Con una base anterior a la 7 no se pide; si igual falta la función
// (`PGRST202`), no se muestra nada y no se vuelve a probar por 10 minutos.

/** La versión de la base con `project_sizes`. `DB_SCHEMA_VERSION` no sube: sin ella solo falta el peso. */
export const SIZES_SCHEMA_VERSION = 7;
/** Al abrir el selector no se vuelve a pedir antes de esto. */
export const SIZES_MAX_AGE_MS = 5 * 60_000;
/** Después de un `PGRST202` (la base no tiene la función) no se vuelve a probar antes de esto. */
export const SIZES_MISSING_WAIT_MS = 10 * 60_000;

const SIZES_KEY = 'projectSizes';

interface Saved {
  rows: ProjectSizeRow[];
  /** Cuándo respondió la base (ms). */
  at: number;
}

/** Lo que muestra la interfaz. Cambia de objeto cada vez que algo cambia (para `useSyncExternalStore`). */
export interface SizesView {
  /** La última respuesta, o `null` si no hay ninguna o no se puede mostrar (base sin la función). */
  rows: ProjectSizeRow[] | null;
  /** Cuándo respondió la base la última vez. */
  at: number | null;
  loading: boolean;
  /** El último pedido falló: sin red o por otro error (se sigue mostrando la respuesta anterior). */
  failed: 'offline' | 'error' | null;
  error: string | null;
}

/** Lo que suman todas las filas (con la de los proyectos que no se ven). */
export interface SizesTotal {
  driveBytes: number;
  driveFiles: number;
  trashBytes: number;
  driveTrashBytes: number;
  pendingBytes: number;
  pendingFiles: number;
  /** La fila sin proyecto (solo el dueño): lo que ocupan los proyectos que no ve. */
  hiddenBytes: number;
}

export function totalOf(rows: ProjectSizeRow[]): SizesTotal {
  const total: SizesTotal = {
    driveBytes: 0,
    driveFiles: 0,
    trashBytes: 0,
    driveTrashBytes: 0,
    pendingBytes: 0,
    pendingFiles: 0,
    hiddenBytes: 0,
  };
  for (const r of rows) {
    total.driveBytes += r.drive_bytes;
    total.driveFiles += r.drive_files;
    total.trashBytes += r.trash_bytes;
    total.driveTrashBytes += r.drive_trash_bytes;
    total.pendingBytes += r.pending_bytes;
    total.pendingFiles += r.pending_files;
    if (r.project_id === null) total.hiddenBytes += r.drive_bytes;
  }
  return total;
}

const FIELDS = [
  'drive_bytes',
  'drive_files',
  'trash_bytes',
  'trash_files',
  'drive_trash_bytes',
  'drive_trash_files',
  'pending_bytes',
  'pending_files',
] as const;

/** Lo guardado en el dispositivo, si tiene la forma esperada (si no, como si no hubiera nada). */
function readSaved(value: unknown): Saved | null {
  const saved = value as Partial<Saved> | null | undefined;
  if (!saved || typeof saved !== 'object' || typeof saved.at !== 'number' || !Array.isArray(saved.rows)) return null;
  const rows = saved.rows.filter(
    (r): r is ProjectSizeRow =>
      !!r &&
      typeof r === 'object' &&
      (r.project_id === null || typeof r.project_id === 'string') &&
      FIELDS.every((f) => typeof r[f] === 'number'),
  );
  return { rows, at: saved.at };
}

export class ProjectSizes {
  private saved: Saved | null = null;
  /** La versión de la base, de la última sincronización; `null` mientras no se sabe (sin red al abrir). */
  private schemaVersion: number | null = null;
  private missingAt = Number.NEGATIVE_INFINITY;
  private lastAttemptAt = Number.NEGATIVE_INFINITY;
  /** Se pidió antes de saber la versión de la base: se pide apenas se sepa. */
  private waiting = false;
  private running: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  private view: SizesView = { rows: null, at: null, loading: false, failed: null, error: null };

  constructor(
    private readonly db: Pick<LocalDb, 'get' | 'put' | 'delete'> | null,
    private readonly remote: SizesRemote,
    private readonly now: () => number = Date.now,
  ) {}

  async load(): Promise<void> {
    if (!this.db) return;
    this.saved = readSaved(await this.db.get('meta', SIZES_KEY));
    this.publish({});
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): SizesView => this.view;

  /**
   * La versión de la base, en cada sincronización (0 si la base no tiene ajustes). Mientras no se sabe se
   * muestra lo guardado; con una anterior a la 7, nada.
   */
  configure(schemaVersion: number): void {
    if (schemaVersion === this.schemaVersion) return;
    this.schemaVersion = schemaVersion;
    this.publish({});
    if (this.waiting) {
      this.waiting = false;
      if (schemaVersion >= SIZES_SCHEMA_VERSION) void this.refresh();
    }
  }

  /** El peso de un proyecto, si hay (lo que no vino en la última respuesta no está). */
  of(projectId: string): ProjectSizeRow | undefined {
    return this.view.rows?.find((r) => r.project_id === projectId);
  }

  /** Pide de nuevo (el diálogo de Drive, "Volver a calcular", al terminar un vaciado). */
  refresh(): Promise<void> {
    if (this.schemaVersion === null) {
      this.waiting = true;
      return Promise.resolve();
    }
    if (!this.callable) return Promise.resolve();
    this.running ??= this.fetch().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Pide solo si pasaron 5 minutos del último pedido (al abrir el selector). */
  refreshIfStale(): Promise<void> {
    const last = Math.max(this.lastAttemptAt, this.saved?.at ?? Number.NEGATIVE_INFINITY);
    if (this.now() - last < SIZES_MAX_AGE_MS) return Promise.resolve();
    return this.refresh();
  }

  private get callable(): boolean {
    return (
      this.schemaVersion !== null &&
      this.schemaVersion >= SIZES_SCHEMA_VERSION &&
      this.now() - this.missingAt >= SIZES_MISSING_WAIT_MS
    );
  }

  /**
   * Se muestra lo guardado si la base tiene la función o si todavía no se sabe (sin red al abrir). Tras un
   * `PGRST202` no queda nada guardado.
   */
  private get showable(): boolean {
    return this.schemaVersion === null || this.schemaVersion >= SIZES_SCHEMA_VERSION;
  }

  private async fetch(): Promise<void> {
    this.lastAttemptAt = this.now();
    this.publish({ loading: true });
    try {
      const rows = await this.remote.projectSizes();
      if (rows === null) {
        // La base no tiene la función: lo guardado no se muestra más.
        this.missingAt = this.now();
        this.saved = null;
        await this.db?.delete('meta', SIZES_KEY).catch(() => undefined);
      } else {
        this.saved = { rows, at: this.now() };
        // Si no se puede guardar, igual se muestra: la próxima vez se vuelve a pedir.
        await this.db?.put('meta', this.saved, SIZES_KEY).catch(() => undefined);
      }
      this.publish({ loading: false, failed: null, error: null });
    } catch (err) {
      this.publish({ loading: false, failed: isNetworkError(err) ? 'offline' : 'error', error: errorMessage(err) });
    }
  }

  private publish(patch: Partial<Pick<SizesView, 'loading' | 'failed' | 'error'>>): void {
    const show = this.showable && this.saved !== null;
    this.view = {
      ...this.view,
      ...patch,
      rows: show ? this.saved!.rows : null,
      at: show ? this.saved!.at : null,
    };
    for (const fn of this.listeners) fn();
  }
}
