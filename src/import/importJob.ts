import { useSyncExternalStore } from 'react';
import type { CodaFolder, ImportProgress, ImportResult, Resumable } from './codaImport';

// El estado de "Importar de Coda", afuera del diálogo: uno por workspace abierto (por su árbol). Así la
// importación y su resultado no dependen de quién dibuja el diálogo (el selector de proyectos se desmonta
// al cerrar la barra lateral en el celular, por ejemplo): el diálogo se dibuja desde el Shell
// (`ImportCodaHost`) y la app sabe que hay una importación en curso para no cerrarse sin preguntar
// (`beforeunload`, Workspace.tsx) ni cambiar de workspace (`useLeaveGuard`). Este archivo va en la primera
// carga: solo tipos de codaImport.ts, nada de lo que pesa.

export interface ImportJobState {
  /** El diálogo está abierto. */
  open: boolean;
  folder: CodaFolder | null;
  name: string;
  /** Una importación anterior de este doc que se cortó y se puede seguir. */
  resumable: Resumable | null;
  progress: ImportProgress | null;
  result: ImportResult | null;
  error: string | null;
  /** Hay una importación en curso: cerrar la app ahora la dejaría a medias. */
  running: boolean;
}

const EMPTY: ImportJobState = {
  open: false,
  folder: null,
  name: '',
  resumable: null,
  progress: null,
  result: null,
  error: null,
  running: false,
};

export class ImportJob {
  private state: ImportJobState = EMPTY;
  private readonly listeners = new Set<() => void>();

  get = (): ImportJobState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  set(patch: Partial<ImportJobState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  show(): void {
    this.set({ open: true });
  }

  /** Cierra el diálogo y olvida lo elegido. Con una importación en curso no hace nada. */
  close(): void {
    if (this.state.running) return;
    this.state = EMPTY;
    for (const fn of this.listeners) fn();
  }

  /** Corre la importación; el progreso, el resultado o el error quedan en el estado. */
  async run(task: (onProgress: (p: ImportProgress) => void) => Promise<ImportResult>): Promise<void> {
    if (this.state.running) return;
    this.set({ running: true, error: null, result: null, progress: { done: 0, total: this.state.folder?.manifest.pages.length ?? 0, page: '' } });
    try {
      const result = await task((progress) => this.set({ progress }));
      this.set({ running: false, result });
    } catch (err) {
      this.set({ running: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
}

const jobs = new WeakMap<object, ImportJob>();

/** La importación del workspace abierto (la clave es su árbol, `services.tree`). */
export function importJobFor(key: object): ImportJob {
  let job = jobs.get(key);
  if (!job) {
    job = new ImportJob();
    jobs.set(key, job);
  }
  return job;
}

export function useImportJob(key: object): [ImportJobState, ImportJob] {
  const job = importJobFor(key);
  return [useSyncExternalStore(job.subscribe, job.get), job];
}
