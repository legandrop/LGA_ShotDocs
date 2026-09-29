export interface PageRow {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  title: string;
  icon: string | null;
  sort_key: string;
  update_seq: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export type PagePatch = Partial<Pick<PageRow, 'title' | 'icon' | 'parent_id' | 'sort_key' | 'deleted_at'>>;

export interface NewPage {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  title: string;
  sort_key: string;
}

/** Un cambio del árbol hecho en el dispositivo, en la cola de salida hasta que el servidor lo confirma. */
export type TreeOp = { kind: 'create'; page: NewPage } | { kind: 'update'; id: string; patch: PagePatch };

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
