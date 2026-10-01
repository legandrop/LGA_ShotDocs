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
  /**
   * Quien creó el proyecto (`workspaces.owner_id`): tiene 4 sobre él mientras sea miembro activo. Falta en
   * un proyecto creado en el dispositivo que todavía no volvió del servidor (lo creó esta persona) y en
   * las copias guardadas por versiones anteriores de la app.
   */
  owner_id?: string | null;
  /**
   * Cuándo se archivó (`workspaces.archived_at`, versión 9 de la base, P.14); `null` o ausente: no está
   * archivado. Archivar es solo orden: sale de la lista de todos los días, con los mismos permisos.
   */
  archived_at?: string | null;
}

/** Una fila de `trashed_projects` (P.14): un proyecto en la papelera de proyectos que la sesión veía. */
export interface TrashedProjectRow {
  id: string;
  name: string;
  archived_at: string | null;
  deleted_at: string;
  /** Quién lo borró: solo a quien lo maneja y al dueño y los admins (si no, `null`). */
  deleted_by: string | null;
  deleted_by_email: string | null;
  /** Días que faltan para los 30 (30 el día que entra, 0 después; se sigue pudiendo restaurar). */
  days_left: number;
  /** La sesión lo puede restaurar (`private.can_manage_project`). */
  can_restore: boolean;
  /** Solo a quien lo maneja; si no, `null`. */
  pages: number | null;
  files: number | null;
}

/** Lo que muestra la ventana de borrar (`project_delete_info`, P.14). */
export interface ProjectDeleteInfo {
  /** Páginas fuera de la papelera de páginas y en ella. */
  pages: number;
  trashed_pages: number;
  /** Archivos subidos fuera de la papelera de Drive, y su peso. */
  files: number;
  drive_bytes: number;
  /** Archivos todavía sin subir que usa alguna página. */
  pending_files: number;
  /** Archivos del proyecto que usan páginas vivas de otros proyectos: dejan de verse ahí mientras esté borrado. */
  used_elsewhere: number;
  /** Archivos de otros proyectos que solo usa este: quedan en la papelera de su proyecto mientras esté borrado. */
  foreign_only_here: number;
  /** Con cuántas personas activas está compartido (sin contar a quien pregunta). */
  shared_with: number;
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

/** Los ajustes del workspace (`workspace_settings`): una sola fila que la app lee en cada sincronización. */
export interface WorkspaceSettings {
  /** Sube cuando se restaura una copia de seguridad: cada dispositivo vuelve a subir todo lo suyo. */
  generation: number;
  /** Versión mínima de la app que puede subir contenido (como en el changelog: 0.021). */
  minAppVersion: number | null;
  schemaVersion: number;
  /** Dirección del portero de archivos del workspace (ver portero/); `null` si todavía no hay. */
  mediaUrl: string | null;
  /** El dueño del workspace (el único que conecta su Drive); `null` si la base todavía no lo tiene. */
  ownerId?: string | null;
  /** Nombre del workspace (`name`); `null` si la base todavía no lo tiene. */
  name?: string | null;
  /** Clave local del workspace (`local_key`), la que viaja en los links de invitación. */
  localKey?: string | null;
  /**
   * El borrado automático de la papelera de archivos a los 30 días (`auto_purge_files`, paso 11). Apagado
   * hasta que Lega lo confirme; `false` también si la base todavía no tiene la columna.
   */
  autoPurgeFiles?: boolean;
}

/** Un archivo nuevo para `register_file` (el proyecto sale de la página). */
export interface NewMediaFile {
  id: string;
  pageId: string;
  name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  duration: number | null;
}

/** Lo que la app lee de `files`. */
export interface MediaFileRow {
  id: string;
  name: string;
  mime: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  thumb_at: string | null;
  drive_id: string | null;
  /** El peso en bytes (`files.size`). Opcional: lo que se guardó antes no lo tiene. */
  size?: number | null;
  /**
   * La papelera de archivos (versión 6 de la base; en una anterior faltan): desde cuándo ninguna página lo
   * usa, cuándo un dueño o admin pidió mandarlo a la papelera de Drive y cuándo el portero lo confirmó.
   */
  trashed_at?: string | null;
  purged_at?: string | null;
  drive_trashed_at?: string | null;
  /** El proyecto del archivo. */
  project_id?: string | null;
}

/** Una fila de `trashed_files`: un archivo en la papelera que todavía no llegó a la papelera de Drive. */
export interface TrashedFileRow {
  id: string;
  name: string;
  mime: string;
  size: number;
  thumb_at: string | null;
  /** Cuándo entró a la papelera. */
  trashed_at: string;
  /** Cuántos días faltan para los 30 (30 el día que entra, 0 si ya pasaron). */
  days_left: number;
  /** Ya se pidió mandarlo a la papelera de Drive y el portero todavía no lo confirmó (se puede repetir). */
  purged_at: string | null;
  /**
   * Lo usa una página que está en la papelera de páginas (ella o una de arriba): restaurarla lo vuelve a
   * usar, salvo que ya se haya mandado a la papelera de Drive. Falta en una base sin esa columna.
   */
  in_trashed_page?: boolean;
  /** El título de esa página. */
  trashed_page_title?: string | null;
  /**
   * Lo usa una página de un proyecto borrado (versión 9, P.14): no se puede mandar a la papelera de Drive
   * hasta que ese proyecto se restaure (`purge_file` da `file_in_deleted_project`). Falta en una base anterior.
   */
  in_deleted_project?: boolean;
}

/**
 * Una fila de `project_sizes` (versión 7 de la base, P.7): cuánto ocupa un proyecto en el Drive, en bytes y
 * archivos. Cada archivo cuenta en un solo lugar. `drive_*` es el número principal: lo que la app tiene en
 * Drive fuera de la papelera de Drive (en uso más la papelera de la app, que también viene sola en
 * `trash_*`). `drive_trash_*`: en la papelera de Drive hace menos de 30 días (ocupa hasta que Google la
 * vacía). `pending_*`: registrado y todavía sin subir. Con `project_id` nulo (solo al dueño), el total de los
 * proyectos que no ve.
 */
export interface ProjectSizeRow {
  project_id: string | null;
  drive_bytes: number;
  drive_files: number;
  trash_bytes: number;
  trash_files: number;
  drive_trash_bytes: number;
  drive_trash_files: number;
  pending_bytes: number;
  pending_files: number;
}

/** Una fila de `files_due_for_purge`. */
export interface DueFileRow {
  id: string;
  name: string;
  trashed_at: string;
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

/** La consulta venció su tope de tiempo (ver `timed` en remote.ts). Cuenta como sin red: se reintenta. */
export const REQUEST_TIMEOUT = 'request_timeout';

/** Una consulta que venció su tope (o se cortó): la red anda, pero muy lenta para lo que se pidió. */
export function isTimeout(err: unknown): boolean {
  return err instanceof RemoteError && (err.code === REQUEST_TIMEOUT || /^(AbortError|TimeoutError)\b/.test(err.message));
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
