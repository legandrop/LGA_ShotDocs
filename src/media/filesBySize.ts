import type { FilesBySizeRemote, SizeCursor } from '../sync/remote';
import type { PageTree } from '../sync/tree';
import { errorMessage, isNetworkError, type PageUseRow, type SizedFileRow } from '../sync/types';
import { fileKind, isFolderMime } from './attachments';

// Los archivos de un proyecto ordenados por peso (P.8, Docs/Doc_Peso_Proyectos.md, "Cómo quedó: la lista por
// peso"). Sin React, para poder probarlo. Solo lectura y solo con red: la base decide qué archivos ve la sesión
// (las políticas de `files` y `page_files`); acá se piden de a tramos, los más pesados primero (cada tramo sigue
// desde el último archivo del anterior), y a cada tramo se le buscan las páginas que lo usan.

/** Cuántos archivos trae cada tramo (lejos del tope de 1000 filas por pedido). */
export const FILES_BATCH = 100;

export type SizedKind = 'photo' | 'video' | 'folder' | 'file';

/** Foto, video, carpeta (P.9) o cualquier otro archivo. */
export function sizedKind(file: Pick<SizedFileRow, 'mime' | 'name'>): SizedKind {
  if (isFolderMime(file.mime)) return 'folder';
  const kind = fileKind(file.mime, file.name);
  return kind === 'image' ? 'photo' : kind;
}

/** Un archivo de la lista, con sus usos activos en páginas que la sesión ve. */
export interface SizedFile extends SizedFileRow {
  uses: PageUseRow[];
}

/** El orden de la lista: del más pesado al más liviano y, a igual peso, por id (el mismo que pide la base). */
export function bySize(a: Pick<SizedFileRow, 'size' | 'id'>, b: Pick<SizedFileRow, 'size' | 'id'>): number {
  return b.size - a.size || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Ninguna página viva lo usa: está en la papelera de archivos (lo calcula la base, `files.trashed_at`). */
export function isUnused(file: Pick<SizedFileRow, 'trashed_at'>): boolean {
  return file.trashed_at !== null;
}

/** Una página que usa el archivo, como la conoce el dispositivo. */
export interface FilePage {
  id: string;
  title: string;
  projectId: string;
  /** Ella o una de arriba está en la papelera de páginas. */
  inTrash: boolean;
}

/**
 * Las páginas que usan el archivo y que el dispositivo conoce (para el link): primero las vivas, después las de
 * la papelera, por título. Un uso en una página que el dispositivo no tiene no se puede abrir y no se lista.
 */
export function pagesOf(uses: PageUseRow[], tree: Pick<PageTree, 'get' | 'isTrashed'>): FilePage[] {
  const pages = new Map<string, FilePage>();
  for (const use of uses) {
    if (use.removed_at || pages.has(use.page_id)) continue;
    const page = tree.get(use.page_id);
    if (!page) continue;
    pages.set(page.id, { id: page.id, title: page.title, projectId: page.workspace_id, inTrash: tree.isTrashed(page.id) });
  }
  return [...pages.values()].sort(
    (a, b) => Number(a.inTrash) - Number(b.inTrash) || a.title.localeCompare(b.title) || (a.id < b.id ? -1 : 1),
  );
}

/** Lo que muestra la interfaz. Cambia de objeto cada vez que algo cambia (para `useSyncExternalStore`). */
export interface FilesView {
  files: SizedFile[];
  loading: boolean;
  /** Ya llegó el último tramo: no hay más para pedir. */
  done: boolean;
  /** El último pedido falló: sin red o por otro error. Lo que ya había llegado se sigue mostrando. */
  failed: 'offline' | 'error' | null;
  error: string | null;
}

/** La lista de un proyecto: se arma al abrir la vista y se descarta al cerrarla (no se guarda en el dispositivo). */
export class FilesBySize {
  /** El último archivo que mandó la base: desde ahí sigue el próximo tramo. */
  private cursor: SizeCursor | null = null;
  private running: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  private view: FilesView = { files: [], loading: false, done: false, failed: null, error: null };

  constructor(
    private readonly remote: FilesBySizeRemote,
    private readonly projectId: string,
    private readonly batch = FILES_BATCH,
  ) {}

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): FilesView => this.view;

  /**
   * Pide el tramo que sigue (el primero al abrir, los demás con "Show more"; también es el *Retry* de un tramo
   * que falló). Dos pedidos a la vez son uno. Nunca tira: el error queda en la vista.
   */
  loadMore(): Promise<void> {
    if (this.view.done) return Promise.resolve();
    this.running ??= this.fetch().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async fetch(): Promise<void> {
    this.publish({ loading: true, failed: null, error: null });
    try {
      const rows = await this.remote.filesBySize(this.projectId, this.cursor, this.batch);
      // Los usos, antes de mostrar el tramo: sin ellos un archivo en uso parecería estar en una página que no se
      // ve. Si este pedido falla, el tramo entero se vuelve a pedir.
      const uses = rows.length > 0 ? await this.remote.fileUses(rows.map((r) => r.id)) : [];
      const byFile = new Map<string, PageUseRow[]>();
      for (const use of uses) byFile.set(use.file_id, [...(byFile.get(use.file_id) ?? []), use]);
      // Por las dudas (un peso que cambió entre dos tramos): una fila que vuelve a llegar no se repite.
      const merged = new Map(this.view.files.map((f) => [f.id, f]));
      for (const row of rows) merged.set(row.id, { ...row, uses: byFile.get(row.id) ?? [] });
      const last = rows[rows.length - 1];
      if (last) this.cursor = { size: last.size, id: last.id };
      this.publish({ files: [...merged.values()].sort(bySize), loading: false, done: rows.length < this.batch });
    } catch (err) {
      this.publish({ loading: false, failed: isNetworkError(err) ? 'offline' : 'error', error: errorMessage(err) });
    }
  }

  private publish(patch: Partial<FilesView>): void {
    this.view = { ...this.view, ...patch };
    for (const fn of this.listeners) fn();
  }
}
