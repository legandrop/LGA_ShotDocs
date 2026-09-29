export interface PageRow {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  title: string;
  icon: string | null;
  sort_key: string;
  /** Ajustes de la rama; en copias guardadas por versiones anteriores de la app puede faltar. */
  settings?: PageSettings;
  update_seq: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Ajustes de una página que valen también para las de adentro, salvo que alguna defina los suyos. Cada
 * campo se hereda por separado: el que falta se busca en los ancestros.
 */
export interface PageSettings {
  /** Encabezado arriba del título con las páginas contenedoras. `levels: 0` lo oculta; `null`, todas. */
  header?: { levels: number | null; last?: number | null };
  /** Dividir por "|" los títulos de las páginas de adentro en la barra lateral. */
  split?: boolean;
  /** Tamaño de hoja: la página se ve (y más adelante se exporta) con ese tamaño. `free`: sin hoja. */
  format?: { size: string; landscape?: boolean };
}

export type PagePatch = Partial<Pick<PageRow, 'title' | 'icon' | 'parent_id' | 'sort_key' | 'deleted_at' | 'settings'>>;

export interface NewPage {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  title: string;
  sort_key: string;
}

/** Un proyecto (`workspaces` en la base): tiene su propio árbol de páginas. */
export interface ProjectRow {
  id: string;
  name: string;
  created_at: string;
}

export interface NewProject {
  id: string;
  name: string;
}

/**
 * Un cambio del árbol hecho en el dispositivo, en la cola de salida hasta que el servidor lo confirma.
 * Los proyectos van en la misma cola: uno nuevo sube antes que sus páginas.
 */
export type TreeOp =
  | { kind: 'create'; page: NewPage }
  | { kind: 'update'; id: string; patch: PagePatch }
  | { kind: 'createProject'; project: NewProject }
  | { kind: 'renameProject'; id: string; name: string };

export interface QueuedOp {
  seq?: number;
  opId: string;
  op: TreeOp;
  createdAt: number;
}

export interface FailedOp {
  seq?: number;
  /** Posición que tenía en la cola: al reintentar vuelve a ese lugar. */
  opSeq?: number;
  op: TreeOp;
  error: string;
  failedAt: number;
}

export interface RemoteUpdate {
  seq: number;
  data: Uint8Array;
}

/** `permanent`: reintentar no va a cambiar el resultado (permisos, ciclo, datos inválidos). */
export class RemoteError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
    readonly code?: string,
    /** No hubo respuesta del servidor: no hay red. */
    readonly network = false,
  ) {
    super(message);
    this.name = 'RemoteError';
  }
}

export function isPermanent(err: unknown): boolean {
  return err instanceof RemoteError && err.permanent;
}

export function isNetworkError(err: unknown): boolean {
  return err instanceof RemoteError && err.network;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
