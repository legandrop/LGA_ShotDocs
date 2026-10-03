import type { SupabaseClient } from '@supabase/supabase-js';
import { t } from '../i18n';
import { fromBase64, toBase64 } from '../lib/base64';
import { linkAuthorKey, type HistoryRow, type PageVersionRow } from './history';
import { parseAdmitResults, type AdmitDecision, type AdmitPageRow, type AdmitResult, type AdmitWorkRow, type LinkUpdateRow } from './linkAdmitApi';
import { THUMB_MAX_BYTES } from '../media/probe';
import { CLEAN_SCHEMA_VERSION } from './clean';
import { MAX_FILE_BYTES } from './files';
import { parseAccess, type AccessSnapshot, type GrantLevel, type Role } from './access';
import {
  REQUEST_TIMEOUT,
  RemoteError,
  type NewPage,
  type NewProject,
  type PagePatch,
  type PageRow,
  type ProjectRow,
  type DueFileRow,
  type MediaFileRow,
  type PageUseRow,
  type NewMediaFile,
  type ProjectSizeRow,
  type ProjectDeleteInfo,
  type TrashedFileRow,
  type TrashedProjectRow,
  type RemoteUpdate,
  type WorkspaceSettings,
} from './types';

/** Todo lo que la sincronización le pide al servidor. Las pruebas usan una versión en memoria. */
export interface Remote {
  /**
   * El primer proyecto que el usuario puede ver, o `null` si no tiene ninguno. Desde el paso 5 del plan de
   * workspaces el servidor ya no crea "My project": los proyectos los crean el dueño y los admins.
   */
  ensureWorkspace(): Promise<string | null>;
  /**
   * Las páginas de estos proyectos. Se pide por proyecto (y no "todo lo visible") para usar el índice y
   * para que, cuando se pueda compartir, lo compartido llegue por su propio camino. `schemaVersion`: la versión de la
   * base, si se sabe; desde la 12 se pide también `clean_seq` (Docs/Doc_Privacidad_Borrado.md).
   */
  fetchTree(projectIds: string[], schemaVersion?: number | null): Promise<PageRow[]>;
  /**
   * Los proyectos que ve la sesión. `schemaVersion`: la versión de la base, si se sabe; desde la 9 (P.14) se
   * pide también `archived_at`. Una base sin esa columna nunca corta la sincronización (ver la implementación).
   */
  fetchProjects(schemaVersion?: number | null): Promise<ProjectRow[]>;
  /** Idempotente: si el proyecto ya existe no hace nada. */
  createProject(project: NewProject): Promise<void>;
  renameProject(id: string, name: string): Promise<void>;
  /** Idempotente: si la página ya existe no hace nada. */
  createPage(page: NewPage): Promise<void>;
  updatePage(id: string, patch: PagePatch): Promise<void>;
  /** Los ajustes del workspace; `null` si la base todavía no tiene la tabla (falta migrar). */
  fetchWorkspaceSettings(): Promise<WorkspaceSettings | null>;
  /** Idempotente por `clientUpdateId`. Devuelve el `seq` asignado. */
  pushUpdate(pageId: string, clientUpdateId: string, update: Uint8Array): Promise<number>;
  pullUpdates(pageId: string, afterSeq: number, limit: number): Promise<RemoteUpdate[]>;
  /**
   * Como `pullUpdates`, por `pull_page_content` (compactar, versión 17 de la base; Docs/Doc_Compactar.md, sección 5): la
   * primera fila puede ser un snapshot (`snapshotId`, con `seq` = la última fila que junta) y cada fila trae la época de
   * contenido de la página. Con los snapshots apagados o una base sin la función, hace lo mismo que `pullUpdates`. Sin
   * el método (otras implementaciones), se baja con `pullUpdates`.
   */
  pullContent?(pageId: string, afterSeq: number, limit: number): Promise<RemoteUpdate[]>;
  /**
   * Las páginas que esta sesión puede armar como base limpia ahora (`clean_work`, versión 12): vacío con el interruptor
   * apagado, una versión que no alcanza o una base sin la función. `urgent`: sin esperar la cadencia.
   */
  cleanWork(options?: { pages?: string[]; urgent?: boolean }): Promise<CleanWorkRow[]>;
  /** Sube una base limpia (`push_clean_base`). Idempotente por `id`. */
  pushCleanBase(base: NewCleanBase): Promise<CleanPushResult>;
  /** Idempotente: si el archivo ya está subido no hace nada. */
  uploadFile(path: string, data: ArrayBuffer, mime: string): Promise<void>;
  downloadFile(path: string): Promise<Blob>;
  /**
   * Los permisos propios: la fila de `members` (o `null` si no hay) y las filas de `grants` de esta
   * persona. `null` si la base todavía no tiene esas tablas. Una respuesta rara tira error.
   */
  fetchMyAccess(userId: string): Promise<AccessSnapshot | null>;
  /**
   * Aplica las invitaciones vivas del correo de la sesión (`accept_invitations`) y devuelve cuántas.
   * `null` si la base todavía no tiene la función.
   */
  acceptInvitations(): Promise<number | null>;
}

/** Una página que se puede armar como base limpia (`clean_work`). */
export interface CleanWorkRow {
  page_id: string;
  update_seq: number;
  /** `page_updates.id` de la fila `update_seq`: va con la base (la base mira que siga siendo esa fila). */
  last_update_id: number;
  clean_seq: number;
  base_bytes: number;
}

/** Una base limpia para `push_clean_base`. */
export interface NewCleanBase {
  id: string;
  pageId: string;
  toSeq: number;
  lastUpdateId: number;
  state: Uint8Array;
  sha256: string;
}

/** `ok` (guardada), `clean_old` (había una igual o más nueva) o `clean_stale` (anterior a compartir). */
export type CleanPushResult = 'ok' | 'clean_old' | 'clean_stale';

export function cleanPushResult(data: unknown): CleanPushResult {
  if (data === 'ok' || data === 'clean_old' || data === 'clean_stale') return data;
  throw new RemoteError(`push_clean_base: unexpected answer ${String(data)}`, true);
}

/** Una fila de `list_members`. */
export interface MemberRow {
  user_id: string;
  email: string;
  role: Role;
  created_at: string;
  removed_at: string | null;
}

/** Una fila de `list_access`: una por origen del permiso (el nivel de cada persona es el más alto). */
export interface AccessRow {
  user_id: string;
  email: string;
  role: Role;
  level: GrantLevel;
  source: 'creator' | 'project' | 'page' | 'parent_page';
  grant_id: string | null;
  project_id: string | null;
  page_id: string | null;
}

/** Una fila de `list_invitations`. */
export interface InvitationRow {
  id: string;
  email: string;
  role: Exclude<Role, 'owner'>;
  grants: InvitationGrant[];
  invited_by: string | null;
  invited_by_email: string | null;
  created_at: string;
  expires_at: string;
}

/** Un permiso de una invitación: sobre un proyecto o una página. */
export type InvitationGrant = { project_id: string; level: GrantLevel } | { page_id: string; level: GrantLevel };

/**
 * Las funciones del equipo (supabase/migrations/20260930160000_equipo.sql). Solo con red: son la pantalla
 * de miembros y el diálogo de compartir, que muestran el error si no hay conexión.
 */
export interface TeamRemote {
  listMembers(): Promise<MemberRow[]>;
  /** Las invitaciones vivas (dueño y admins). `null` si la base todavía no tiene la función. */
  listInvitations(): Promise<InvitationRow[] | null>;
  /** Revoca una invitación sin usar (la marca, no la borra). */
  revokeInvitation(id: string): Promise<void>;
  createInvitation(email: string, role: Exclude<Role, 'owner'>, grants: InvitationGrant[]): Promise<string>;
  setMemberRole(userId: string, role: Exclude<Role, 'owner'>): Promise<void>;
  /**
   * Qué pasó con los proyectos compartidos de quien se saca: cuántos pasaron a otra persona y cuántos
   * quedaron sin heredero (solo compartidos por páginas sueltas: los siguen viendo aquellos con quienes
   * estaban compartidos). Los privados no se informan.
   */
  removeMember(userId: string): Promise<RemovedMember>;
  share(userId: string, target: { projectId: string } | { pageId: string }, level: GrantLevel): Promise<string>;
  unshare(grantId: string): Promise<void>;
  listAccess(target: { projectId: string } | { pageId: string }): Promise<AccessRow[]>;
}

/**
 * Los archivos grandes (fotos y videos que van al Drive del dueño por el portero): la base guarda de qué
 * proyecto son y qué páginas los usan, y la miniatura va al bucket `thumbs` (ver
 * supabase/migrations/20260930150000_archivos.sql). Todo es idempotente.
 */
export interface MediaRemote {
  /**
   * `page_not_found` si no se puede editar la página; el error `file_other_project` si el id es de otro
   * proyecto y la sesión no lo ve. Devuelve `foreign` si es de otro proyecto que la sesión ve: la base guardó
   * el uso como ajeno (cuenta para la papelera, no da permiso); si no, `ok`.
   */
  registerFile(file: NewMediaFile): Promise<LinkResult>;
  /**
   * `file_not_found` si el archivo todavía no está en el servidor o la sesión no lo ve (se reintenta más
   * tarde). Devuelve `foreign` si es de otro proyecto: la base guardó el uso como ajeno; si no, `ok`.
   */
  linkPageFile(pageId: string, fileId: string): Promise<LinkResult>;
  /**
   * Sube `thumbs/<id>.jpg` sin reemplazar: si ya existe, está hecho. `stalledBefore`: cuántas veces seguidas ya
   * venció el tope de esta miniatura (el tope crece con eso, `thumbUploadLimit`).
   */
  uploadThumb(fileId: string, data: Blob, stalledBefore?: number): Promise<void>;
  setFileThumb(fileId: string): Promise<void>;
  downloadThumb(fileId: string): Promise<Blob>;
  /** Las filas de `files` que la sesión puede ver (las demás no vuelven). */
  fetchMediaFiles(ids: string[]): Promise<MediaFileRow[]>;
  /**
   * Los usos (`page_files`) de estas páginas que la sesión ve, activos y quitados. Solo lee: con lo que vuelve,
   * un dispositivo nuevo no vuelve a mandar uno por uno los usos que el servidor ya tiene (B.14).
   */
  fetchPageUses(pageIds: string[]): Promise<PageUseRow[]>;
  /**
   * La página dejó de usar el archivo (el bloque desapareció): marca el uso, no lo borra. Idempotente.
   * `seenSeq`: el `seq` del documento con el que se decidió; si la página cambió después en el servidor, la
   * base no hace nada y esto devuelve `false` (hay que volver a comparar con el documento nuevo). `true` si
   * quedó hecho. `page_not_found` si no se puede editar la página. Versión 6 de la base.
   */
  unlinkPageFile(pageId: string, fileId: string, seenSeq?: number | null): Promise<boolean>;
  /** La papelera de archivos del proyecto (`trashed_files`). `not_allowed` si la sesión no la ve. */
  trashedFiles(projectId: string): Promise<TrashedFileRow[]>;
  /**
   * Los que cumplieron 30 días en la papelera, solo con el borrado automático prendido (si no, ninguno).
   * `not_allowed` si la sesión no es dueño o admin con permiso sobre el proyecto.
   */
  filesDueForPurge(projectId: string): Promise<DueFileRow[]>;
}

/**
 * El peso de los proyectos en el Drive (P.7, supabase/migrations/20260930190000_peso_proyectos.sql). Aparte
 * de `MediaRemote`: solo lo pide el store de `src/media/projectSizes.ts`, así las pruebas no tienen que
 * simularlo.
 */
export interface SizesRemote {
  /**
   * Una fila por proyecto cuya papelera de archivos ve la sesión (y, solo al dueño, la de los que no ve).
   * `null` si la base todavía no tiene la función (`PGRST202`).
   */
  projectSizes(): Promise<ProjectSizeRow[] | null>;
}

/** La versión de la base con archivar y borrar proyectos (P.14, Docs/Doc_Proyectos_Borrar.md). */
export const PROJECT_STATES_SCHEMA_VERSION = 9;
/** La versión con la carpeta de un proyecto borrado en la papelera de Drive (P.14, entrega 2, migración 10). */
export const PROJECT_DRIVE_SCHEMA_VERSION = 10;
/**
 * La versión con los snapshots de compactar (Docs/Doc_Compactar.md; 20261019120000_compactar_leer.sql): `pages.snapshot_seq`,
 * `pages.content_epoch`, `pull_page_content` y las funciones de compactar. Constante propia: no sube `DB_SCHEMA_VERSION`
 * (una base sin la migración sigue andando igual, sin aviso).
 */
export const SNAPSHOT_SCHEMA_VERSION = 17;

/** El tramo a compactar que devuelve `claim_page_compaction` (Docs/Doc_Compactar.md, 4.2). */
export interface CompactionClaim {
  baseId: string | null;
  baseSeq: number;
  upToSeq: number;
  lastUpdateId: number;
}

/** Un snapshot para `push_page_snapshot`: el update de Yjs, su vector y su huella (SHA-256 en hexadecimal). */
export interface NewSnapshot {
  pageId: string;
  baseId: string | null;
  upToSeq: number;
  lastUpdateId: number;
  state: Uint8Array;
  sv: Uint8Array;
  sha256: string;
}

/**
 * Lo que contesta `push_page_snapshot`: `ok` (guardado sin confirmar, o el mismo ya guardado), `snapshot_mismatch` (otra
 * huella para lo mismo, con la misma versión de la app: se invalidó) o `snapshot_exists` (otra versión ya lo armó).
 */
export interface SnapshotPushResult {
  id: string;
  result: 'ok' | 'snapshot_mismatch' | 'snapshot_exists';
}

/**
 * Las funciones de quien compacta (Docs/Doc_Compactar.md, secciones 4 y 12): las usa el compactador del dispositivo
 * (`compact.ts`, entrega 2), solo con los snapshots prendidos y una versión que alcanza.
 */
export interface SnapshotsRemote {
  claimCompaction(pageId: string): Promise<CompactionClaim | null>;
  pushSnapshot(snapshot: NewSnapshot): Promise<SnapshotPushResult>;
  pullSnapshot(id: string): Promise<Uint8Array>;
  /**
   * Un snapshot con la huella que guardó la base (entrega 3, O-D), o `null` si la base no tiene la función (entonces se
   * usa `pullSnapshot`, sin huella).
   */
  pullSnapshotChecked?(id: string): Promise<{ state: Uint8Array; sha256: string } | null>;
  confirmSnapshot(id: string, sha256: string): Promise<boolean>;
  skipCompaction(pageId: string, reason: string): Promise<void>;
  invalidateSnapshot(id: string, reason: string): Promise<boolean>;
}

/**
 * Archivar, borrar y restaurar proyectos (P.14, supabase/migrations/20261001120000_proyectos_archivar_borrar.sql).
 * Solo con red: son funciones de la base que se llaman en el momento, no cambios en la cola. Todas son
 * idempotentes. Errores: `project_not_found` (no existe o la sesión no lo veía), `not_allowed`,
 * `project_deleted` (archivar uno borrado).
 */
export interface ProjectStatesRemote {
  setProjectArchived(projectId: string, archived: boolean): Promise<void>;
  /** Lo manda a la papelera de proyectos y devuelve cuándo (si ya estaba, la fecha de entonces). */
  deleteProject(projectId: string): Promise<string>;
  /**
   * Lo saca de la papelera de proyectos. Con la carpeta pedida para la papelera de Drive, la base exige traerla
   * antes (`drive_untrash_first`), salvo `withoutDrive` (versión 10): solo cuando el portero, con Drive conectado
   * a la misma cuenta, respondió que no la tiene. Vuelve con la marca `drive_missing_at`, que se deshace si aparece.
   */
  restoreProject(projectId: string, withoutDrive?: boolean): Promise<void>;
  /** La papelera de proyectos de la sesión. `null` si la base todavía no tiene la función. */
  trashedProjects(): Promise<TrashedProjectRow[] | null>;
  projectDeleteInfo(projectId: string): Promise<ProjectDeleteInfo>;
}

/** Un autor del historial de una página, con su correo. */
export interface HistoryAuthor {
  user_id: string;
  email: string;
}

/**
 * El historial de versiones (P.18, supabase/migrations/20261007120000_historial.sql). Solo con red, a quien puede
 * editar la página y no es invitado. Errores: `page_not_found` (sin permiso), `page_in_trash`; `PGRST202` con la
 * base sin migrar (la app no lo ofrece por `HISTORY_SCHEMA_VERSION`).
 */
export interface HistoryRemote {
  /** Las filas de `page_updates` posteriores a `afterSeq`, en orden, con autor y hora. */
  pageHistory(pageId: string, afterSeq: number, limit: number): Promise<HistoryRow[]>;
  pageHistoryAuthors(pageId: string): Promise<HistoryAuthor[]>;
}

/**
 * Las versiones con nombre y las marcas de restauración (P.18, entrega 3; 20261011120000_versiones_con_nombre.sql). Los
 * permisos del historial; renombrar y sacar el nombre, quien lo puso o nivel 4. Errores: `page_not_found`,
 * `page_in_trash`, `version_named` (esa versión ya tiene nombre), `version_not_found`, `version_conflict`,
 * `label_invalid`, `not_allowed`, `app_outdated`; `PGRST202` con la base sin migrar.
 */
export interface NamedVersionsRemote {
  listPageVersions(pageId: string): Promise<PageVersionRow[]>;
  /** `id` lo crea el dispositivo: reintentar el mismo pedido devuelve el mismo. */
  namePageVersion(id: string, pageId: string, seq: number, label: string): Promise<PageVersionRow>;
  renamePageVersion(id: string, label: string): Promise<PageVersionRow>;
  removePageVersion(id: string): Promise<void>;
  /** La fila `seq` (subida por esta sesión) es una restauración de la versión que terminaba en `fromSeq`. */
  markPageRestored(id: string, pageId: string, seq: number, fromSeq: number): Promise<PageVersionRow>;
}

/** Una fila de `list_page_versions` (o de las funciones que escriben) como llega. */
export function parsePageVersion(row: Record<string, unknown>): PageVersionRow {
  return {
    id: String(row.id),
    seq: Number(row.seq),
    kind: row.kind === 'restore' ? 'restore' : 'named',
    label: row.label === null || row.label === undefined ? null : String(row.label),
    restoredFromSeq: row.restored_from_seq === null || row.restored_from_seq === undefined ? null : Number(row.restored_from_seq),
    createdBy: row.created_by === null || row.created_by === undefined ? null : String(row.created_by),
    createdAt: String(row.created_at ?? ''),
  };
}

/** Las filas de `pull_page_content` como llegan (los números pueden venir como texto). */
export function parseContentRows(data: unknown): RemoteUpdate[] {
  type Row = {
    seq: number | string;
    update: string;
    snapshot_id?: string | null;
    content_epoch?: number | string | null;
    sha256?: string | null;
  };
  return ((data ?? []) as Row[]).map((r) => ({
    seq: Number(r.seq),
    data: fromBase64(r.update),
    ...(r.snapshot_id ? { snapshotId: String(r.snapshot_id) } : {}),
    ...(r.content_epoch === null || r.content_epoch === undefined ? {} : { contentEpoch: Number(r.content_epoch) }),
    ...(r.snapshot_id && typeof r.sha256 === 'string' ? { snapshotSha256: r.sha256.toLowerCase() } : {}),
  }));
}

/** Lo que contesta `push_page_snapshot` (una fila `(snapshot_id, result)`). */
export function parseSnapshotPush(data: unknown): SnapshotPushResult {
  const row = (Array.isArray(data) ? data[0] : data) as { snapshot_id?: unknown; result?: unknown } | undefined;
  const result = row?.result;
  if (!row?.snapshot_id || (result !== 'ok' && result !== 'snapshot_mismatch' && result !== 'snapshot_exists')) {
    throw new RemoteError(`push_page_snapshot: unexpected answer ${JSON.stringify(data)}`, true);
  }
  return { id: String(row.snapshot_id), result };
}

/** Una fila de `trashed_projects` como llega (los números pueden venir como texto). */
export function parseTrashedProject(row: Record<string, unknown>): TrashedProjectRow {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    archived_at: (row.archived_at as string | null) ?? null,
    deleted_at: String(row.deleted_at),
    deleted_by: (row.deleted_by as string | null) ?? null,
    deleted_by_email: (row.deleted_by_email as string | null) ?? null,
    days_left: Number(row.days_left) || 0,
    can_restore: row.can_restore === true,
    pages: num(row.pages),
    files: num(row.files),
    drive_trash_requested_at: (row.drive_trash_requested_at as string | null) ?? null,
    drive_trashed_at: (row.drive_trashed_at as string | null) ?? null,
    drive_missing_at: (row.drive_missing_at as string | null) ?? null,
    can_purge: row.can_purge === true,
  };
}

/** Lo que devuelve `project_delete_info`. */
export function parseDeleteInfo(data: unknown): ProjectDeleteInfo {
  const row = (data ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => Number(v) || 0;
  return {
    pages: n(row.pages),
    trashed_pages: n(row.trashed_pages),
    files: n(row.files),
    drive_bytes: n(row.drive_bytes),
    pending_files: n(row.pending_files),
    used_elsewhere: n(row.used_elsewhere),
    foreign_only_here: n(row.foreign_only_here),
    shared_with: n(row.shared_with),
  };
}

/**
 * Lo que devuelven `register_file` y `link_page_file` (versión 6 de la base): `'ok'`, o
 * `'file_other_project'` (sin error) cuando guardaron el uso de un archivo de otro proyecto. Una base anterior
 * no devuelve nada: cuenta como `ok`.
 */
export type LinkResult = 'ok' | 'foreign';

export function linkResult(data: unknown): LinkResult {
  return data === 'file_other_project' ? 'foreign' : 'ok';
}

export interface RemovedMember {
  transferred: number;
  withoutHeir: number;
}

/** Lo que devuelve `remove_member`: `{ transferred: [...], without_heir: [...] }` (antes, un número). */
export function parseRemovedMember(data: unknown): RemovedMember {
  if (typeof data === 'number') return { transferred: data, withoutHeir: 0 };
  const row = (data ?? {}) as { transferred?: unknown; without_heir?: unknown };
  return {
    transferred: Array.isArray(row.transferred) ? row.transferred.length : 0,
    withoutHeir: Array.isArray(row.without_heir) ? row.without_heir.length : 0,
  };
}

/**
 * `unlink_page_file` no hizo nada porque la página cambió después del `seq` con el que se decidió: la base
 * responde `false` (hecho: `true`).
 */
export function unlinkIgnored(data: unknown): boolean {
  return data === false;
}

export const FILES_BUCKET = 'page-files';
export const THUMBS_BUCKET = 'thumbs';

/** El nombre de la miniatura de un archivo en el bucket `thumbs`: `<uuid en minúsculas>.jpg`. */
export function thumbPath(fileId: string): string {
  return `${fileId.toLowerCase()}.jpg`;
}
export const PAGE_COLUMNS =
  'id, workspace_id, parent_id, title, icon, sort_key, settings, template_id, update_seq, deleted_at, created_at, updated_at';
// Una instalación que publicó esta versión sin aplicar la migración de ajustes no tiene `pages.settings`:
// el árbol se sigue bajando sin esa columna, en vez de cortar toda la sincronización.
const PAGE_COLUMNS_WITHOUT_SETTINGS = PAGE_COLUMNS.replace(' settings,', '');
const UNDEFINED_COLUMN = '42703';
// La tabla o la función todavía no existen en la base (falta aplicar una migración).
const MISSING_TABLE = new Set(['42P01', 'PGRST205']);
const MISSING_FUNCTION = 'PGRST202';
/** Lo que manda push_page_update cuando la app es más vieja que la mínima del workspace. */
export const APP_OUTDATED = 'app_outdated';

// 401 llega cuando la sesión venció y se está renovando: se reintenta.
const TRANSIENT_STATUS = new Set([0, 401, 408, 425, 429, 500, 502, 503, 504]);

export function toRemoteError(
  error: { message: string; code?: string | number; status?: number } | null,
  status?: number,
): RemoteError {
  const code = error?.code === undefined ? undefined : String(error.code);
  const httpStatus = status ?? error?.status ?? 0;
  // El cliente de Supabase devuelve así una consulta cortada por su tope (`timed`). Con `AbortSignal.timeout`
  // el navegador rechaza con el motivo de la señal, `TimeoutError`; con un corte a mano, `AbortError`.
  if (httpStatus === 0 && /^(AbortError|TimeoutError)\b/.test(error?.message ?? '')) {
    return new RemoteError(REQUEST_TIMEOUT, false, REQUEST_TIMEOUT, true);
  }
  const permanent = !(TRANSIENT_STATUS.has(httpStatus) || httpStatus >= 500);
  return new RemoteError(error?.message ?? `HTTP ${httpStatus}`, permanent, code, httpStatus === 0);
}

/**
 * Tope de cada consulta a la base. Sin él, una respuesta que no llega nunca (una red que se corta a mitad
 * de camino) deja colgado para siempre el ciclo de sincronización (nunca corren dos a la vez): no se baja
 * nada más hasta recargar, con `syncing` prendido y el estado diciendo "All synced" porque no queda nada sin
 * subir. Lo mismo con la cola de fotos y videos y la de comentarios. Al vencer, la consulta vuelve como un
 * error de red (estado 0) y la vuelta siguiente la reintenta; todo lo que se manda es idempotente
 * (`clientUpdateId`, ids creados en el dispositivo). Los archivos de Storage no usan este tope fijo (una foto
 * grande en una red lenta puede tardar más): las miniaturas tienen uno proporcional a su tamaño que crece con las
 * fallas seguidas (`within` con `thumbUploadLimit`), y las imágenes del bucket `page-files` (un workspace sin
 * portero) uno proporcional sin techo (`storageTimeout`).
 */
export const REQUEST_TIMEOUT_MS = 30_000;
/**
 * Lo que se le da de más a una consulta por lo que manda: una red lenta de 16 KB/s. Así "lento" nunca se
 * vuelve "nunca" (una subida de 8 MB tiene unos 12 minutos).
 */
const SLOW_BYTES_PER_SECOND = 16 * 1024;
/** Tope más largo: una subida del tamaño máximo (8 MB, que en base64 son unos 11 MB) a 16 KB/s. */
export const MAX_REQUEST_TIMEOUT_MS = REQUEST_TIMEOUT_MS + Math.ceil(((8 * 1024 * 1024 * 4) / 3 / SLOW_BYTES_PER_SECOND) * 1000);

/** El tope de una consulta que manda o recibe `bytes` (30 s más lo que tardaría a 16 KB/s, con un máximo). */
export function timeoutFor(bytes: number): number {
  return Math.min(MAX_REQUEST_TIMEOUT_MS, REQUEST_TIMEOUT_MS + Math.ceil((bytes / SLOW_BYTES_PER_SECOND) * 1000));
}

export function deadline(ms = REQUEST_TIMEOUT_MS): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/** Le pone el tope (`deadline`) a una consulta de Supabase. Un cliente de prueba sin `abortSignal` queda igual. */
export function timed<T>(query: T, ms = REQUEST_TIMEOUT_MS): T {
  const q = query as T & { abortSignal?: (signal: AbortSignal) => T };
  return typeof q.abortSignal === 'function' ? q.abortSignal(deadline(ms)) : query;
}

/**
 * Corre un pedido contra un tope: si no terminó en `ms`, rechaza con el mismo error de red que una consulta
 * cortada por su tope (`request_timeout`), que se reintenta. Es para los pedidos a Storage, que no pasan por
 * `timed`. Al pedido se le da la señal del tope por si la acepta (así el navegador lo corta de verdad); si no
 * la acepta, queda suelto: su resultado ya no lo espera nadie, y si falla más tarde no molesta.
 */
export function within<T>(ms: number, request: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  const signal = deadline(ms);
  return new Promise<T>((resolve, reject) => {
    const expired = () => reject(new RemoteError(REQUEST_TIMEOUT, false, REQUEST_TIMEOUT, true));
    if (signal.aborted) {
      expired();
      return;
    }
    // Antes de hacer el pedido: al vencer, este aviso llega primero y el error es siempre el del tope, no el
    // que dé el pedido al cortarse.
    signal.addEventListener('abort', expired, { once: true });
    Promise.resolve()
      .then(() => request(signal))
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', expired));
  });
}

/**
 * El tope de la bajada de una miniatura, que no sabe de antemano cuánto llega: el de la más pesada que puede
 * haber. El bucket `thumbs` no acepta más de `THUMB_MAX_BYTES` (512 KB, `file_size_limit` en
 * supabase/migrations/20260930150000_archivos.sql), así que una sana termina siempre antes: 30 s más los 32 s
 * que tardan 512 KB a 16 KB/s. Las de verdad pesan decenas de KB.
 */
export const THUMB_DOWNLOAD_TIMEOUT_MS = timeoutFor(THUMB_MAX_BYTES);

/** La red más lenta con la que todavía se espera una miniatura, después de varias fallas seguidas. */
const THUMB_SLOWEST_BYTES_PER_SECOND = 2 * 1024;
/** Lo menos que puede crecer el tope de una miniatura (una chica, donde casi todo es la espera fija). */
const THUMB_MIN_GROWTH = 4;

/**
 * El tope de la subida de una miniatura que ya venció `stalledBefore` veces seguidas: el de siempre
 * (`timeoutFor`), el doble, el triple... hasta lo que tardaría a 2 KB/s (30 s más 250 s para 500 KB), y nunca
 * menos que cuatro veces el de siempre (una chica). Con un tope fijo, una miniatura de 500 KB con menos de unos
 * 8 KB/s vencía siempre y el archivo no subía nunca; así, una red muy lenta termina pasando como pasa con el
 * portero (`stalledBefore` en portero.ts).
 */
export function thumbUploadLimit(bytes: number, stalledBefore = 0): number {
  const base = timeoutFor(bytes);
  const ceiling = Math.max(THUMB_MIN_GROWTH * base, REQUEST_TIMEOUT_MS + Math.ceil((bytes / THUMB_SLOWEST_BYTES_PER_SECOND) * 1000));
  return Math.min(base * (1 + Math.max(0, stalledBefore)), ceiling);
}

/**
 * El tope de un pedido a Storage que manda o recibe `bytes`: 30 s más lo que tarda a 16 KB/s, **sin el techo** de
 * las consultas (`timeoutFor`). Una imagen de `page-files` puede pesar 25 MB, y a esa velocidad tarda 27 minutos.
 */
export function storageTimeout(bytes: number): number {
  return REQUEST_TIMEOUT_MS + Math.ceil((bytes / SLOW_BYTES_PER_SECOND) * 1000);
}

/**
 * El tope total de la bajada de una imagen de `page-files`, que no sabe cuánto llega: el de la más pesada que acepta
 * (27 minutos). Lo que corta de verdad a una bajada colgada es `FILE_IDLE_MS`.
 */
export const FILE_DOWNLOAD_TIMEOUT_MS = storageTimeout(MAX_FILE_BYTES);

/**
 * Lo más que puede pasar sin que llegue nada en la bajada de una imagen de `page-files`: hasta la respuesta y entre
 * un pedazo y el siguiente. Antes, con solo el tope total, una imagen chica de un Storage colgado esperaba 27 minutos;
 * lento no es colgado: una bajada que sigue recibiendo no se corta (hasta el tope total).
 */
export const FILE_IDLE_MS = REQUEST_TIMEOUT_MS;

/**
 * Como `within`, pero además se corta si pasan `idleMs` sin un aviso de `moved` (que llama quien hace el pedido
 * cada vez que llega algo). El error es el mismo del tope: cuenta como sin red y se reintenta.
 */
export function withinIdle<T>(ms: number, idleMs: number, request: (signal: AbortSignal, moved: () => void) => PromiseLike<T>): Promise<T> {
  const idle = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const moved = () => {
    clearTimeout(timer);
    timer = setTimeout(() => idle.abort(), idleMs);
  };
  return within(ms, (signal) => {
    moved();
    const both = anySignal(signal, idle.signal);
    return new Promise<T>((resolve, reject) => {
      const expired = () => reject(new RemoteError(REQUEST_TIMEOUT, false, REQUEST_TIMEOUT, true));
      idle.signal.addEventListener('abort', expired, { once: true });
      Promise.resolve()
        .then(() => request(both, moved))
        .then(resolve, reject)
        .finally(() => idle.signal.removeEventListener('abort', expired));
    });
  }).finally(() => clearTimeout(timer));
}

/** Una señal que se corta cuando se corta cualquiera de las dos. */
function anySignal(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([a, b]);
  const both = new AbortController();
  for (const s of [a, b]) {
    if (s.aborted) both.abort(s.reason);
    else s.addEventListener('abort', () => both.abort(s.reason), { once: true });
  }
  return both.signal;
}

/**
 * El cliente de Storage de un bucket cuyos pedidos llevan `signal` y avisan `moved` al llegar la respuesta y cada
 * pedazo del cuerpo (para `withinIdle`). Sin `fetch` propio en el cliente queda solo con el tope total.
 */
function bucketWatched(client: SupabaseClient, bucket: string, signal: AbortSignal, moved: () => void): ReturnType<SupabaseClient['storage']['from']> {
  const api = client.storage.from(bucket);
  const holder = api as unknown as { fetch?: typeof fetch };
  const base = holder.fetch;
  if (typeof base !== 'function') return api;
  holder.fetch = async (input, init) => {
    const res = await base(input, { ...init, signal: init?.signal ?? signal });
    moved();
    if (!res.body || typeof TransformStream !== 'function') return res;
    const watched = res.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, out) {
          moved();
          out.enqueue(chunk);
        },
      }),
    );
    return new Response(watched, { status: res.status, statusText: res.statusText, headers: res.headers });
  };
  return api;
}

/**
 * El cliente de Storage de un bucket con todos sus pedidos atados a `signal`. `upload` no acepta una señal de
 * corte (`@supabase/storage-js` 2.117), pero cada pedido sale por el `fetch` del cliente, y cada `from(bucket)` es
 * un objeto nuevo con el suyo: se lo envuelve para que lleve la señal. Así, cuando vence el tope, el navegador
 * corta la subida de verdad en vez de dejarla suelta (con Storage colgado para todos, se acumulaban). Si una
 * versión del cliente no tuviera ese `fetch`, queda como antes: una carrera contra el tope.
 */
function bucketWith(client: SupabaseClient, bucket: string, signal: AbortSignal): ReturnType<SupabaseClient['storage']['from']> {
  const api = client.storage.from(bucket);
  const holder = api as unknown as { fetch?: typeof fetch };
  const base = holder.fetch;
  if (typeof base === 'function') holder.fetch = (input, init) => base(input, { ...init, signal: init?.signal ?? signal });
  return api;
}

function networkError(err: unknown): RemoteError {
  // El tope de `within` ya viene como error de red.
  if (err instanceof RemoteError) return err;
  return new RemoteError(err instanceof Error ? err.message : String(err), false, undefined, true);
}

function storageStatus(error: { name?: string; message: string }): number {
  if (error.name === 'StorageUnknownError') return 0;
  return Number((error as { status?: number; statusCode?: string }).status ?? (error as { statusCode?: string }).statusCode ?? 0);
}

/** Una fila de `project_sizes` como llega (los `bigint` pueden venir como texto). */
export function parseProjectSize(row: Record<string, unknown>): ProjectSizeRow {
  const n = (v: unknown) => Number(v) || 0;
  return {
    project_id: typeof row.project_id === 'string' ? row.project_id : null,
    drive_bytes: n(row.drive_bytes),
    drive_files: n(row.drive_files),
    trash_bytes: n(row.trash_bytes),
    trash_files: n(row.trash_files),
    drive_trash_bytes: n(row.drive_trash_bytes),
    drive_trash_files: n(row.drive_trash_files),
    pending_bytes: n(row.pending_bytes),
    pending_files: n(row.pending_files),
  };
}

export class SupabaseRemote
  implements Remote, MediaRemote, TeamRemote, SizesRemote, ProjectStatesRemote, HistoryRemote, NamedVersionsRemote, SnapshotsRemote
{
  /** Desde cuándo la base no tiene `pages.settings`; se vuelve a probar cada tanto por si se migró. */
  private settingsMissingAt = 0;

  private get settingsMissing(): boolean {
    return Date.now() - this.settingsMissingAt < 10 * 60_000;
  }

  /** Desde cuándo la base no tiene `workspaces.archived_at` (aunque diga la versión 9); se reintenta cada tanto. */
  private archivedMissingAt = 0;
  /** Lo mismo con las columnas de la carpeta en la papelera de Drive (versión 10). */
  private driveColumnsMissingAt = 0;

  /** Desde cuándo la base no tiene `workspace_settings` (o la subida con versión); se reintenta cada tanto. */
  private settingsTableMissingAt = 0;
  private versionedPushMissingAt = 0;
  /** Desde cuándo la base no tiene las funciones de archivos con la versión de la app; se reintenta cada tanto. */
  private versionedFilesMissingAt = 0;

  /**
   * `appVersion` viaja con cada subida de contenido y con cada pedido de la cola de archivos (registrar, usar y
   * dejar de usar): el servidor rechaza los de una versión más vieja que la mínima del workspace.
   */
  constructor(
    private readonly client: SupabaseClient,
    private readonly appVersion = '',
  ) {}

  async fetchWorkspaceSettings(): Promise<WorkspaceSettings | null> {
    if (Date.now() - this.settingsTableMissingAt < 10 * 60_000) return null;
    // Todas las columnas: una base a la que le falta una migración más nueva (p. ej. `media_url`) sigue
    // devolviendo los ajustes, y lo que falta queda vacío.
    const { data, error, status } = await timed(this.client.from('workspace_settings').select('*')).maybeSingle();
    if (error && MISSING_TABLE.has(String(error.code))) {
      this.settingsTableMissingAt = Date.now();
      return null;
    }
    if (error) throw toRemoteError(error, status);
    if (!data) return null;
    const row = data as {
      generation: number;
      min_app_version: number | string | null;
      schema_version: number;
      media_url?: string | null;
    };
    const extra = row as {
      owner_id?: string | null;
      name?: string | null;
      local_key?: string | null;
      auto_purge_files?: boolean | null;
      clean_min_version?: number | string | null;
      snapshot_min_version?: number | string | null;
      link_edit_min_version?: number | string | null;
    };
    // Los snapshots se bajan con `pull_page_content` solo prendidos y con la base en la versión 17 (si no, todo sale
    // por `pull_page_updates`, como siempre).
    this.snapshotsOn = Number(row.schema_version) >= SNAPSHOT_SCHEMA_VERSION && extra.snapshot_min_version != null;
    return {
      generation: Number(row.generation),
      minAppVersion: row.min_app_version === null ? null : Number(row.min_app_version),
      schemaVersion: Number(row.schema_version),
      mediaUrl: row.media_url || null,
      ownerId: extra.owner_id ?? null,
      name: extra.name || null,
      localKey: extra.local_key || null,
      // Solo `true` lo prende: sin la columna (base anterior a la versión 6) queda apagado.
      autoPurgeFiles: extra.auto_purge_files === true,
      // Sin la columna (base anterior a la versión 12), apagado.
      cleanMinVersion: extra.clean_min_version == null ? null : Number(extra.clean_min_version),
      // Sin la columna (base anterior a la versión 17), apagados.
      snapshotMinVersion: extra.snapshot_min_version == null ? null : Number(extra.snapshot_min_version),
      // Sin la columna (base anterior a la versión 19), apagado.
      linkEditMinVersion: extra.link_edit_min_version == null ? null : Number(extra.link_edit_min_version),
    };
  }

  async ensureWorkspace(): Promise<string | null> {
    const { data, error, status } = await timed(this.client.rpc('ensure_workspace'));
    if (error) throw toRemoteError(error, status);
    return (data as string | null) || null;
  }

  async fetchTree(projectIds: string[], schemaVersion?: number | null): Promise<PageRow[]> {
    // De a 100 proyectos por consulta: la lista viaja en la dirección y tiene un largo máximo.
    const rows: PageRow[] = [];
    for (let i = 0; i < projectIds.length; i += 100) {
      rows.push(...(await this.fetchTreeOf(projectIds.slice(i, i + 100), schemaVersion)));
    }
    return rows;
  }

  /** Desde cuándo la base no tiene `pages.clean_seq` (aunque diga la versión 12); se reintenta cada tanto. */
  private cleanSeqMissingAt = 0;
  /** Lo mismo con `pages.snapshot_seq` y `content_epoch` (versión 17). */
  private snapshotColumnsMissingAt = 0;
  /** Lo mismo con `pull_page_content`: mientras tanto se baja con `pull_page_updates`. */
  private pullContentMissingAt = 0;
  /** Los snapshots están prendidos en la base, según los últimos ajustes leídos (`fetchWorkspaceSettings`). */
  private snapshotsOn = false;

  private async fetchTreeOf(projectIds: string[], schemaVersion?: number | null): Promise<PageRow[]> {
    // De a 1000, por id: si se crean páginas mientras se baja, no se saltea ninguna.
    const rows: PageRow[] = [];
    let after: string | null = null;
    // `clean_seq` solo con la versión 12 o más; si falta igual, se sigue sin ella un rato (como `settings`).
    const clean = (schemaVersion ?? 0) >= CLEAN_SCHEMA_VERSION && Date.now() - this.cleanSeqMissingAt >= 10 * 60_000;
    // `snapshot_seq` y `content_epoch` con la 17 o más; si faltan igual, se dejan primero ellas (son las más nuevas).
    const snap = (schemaVersion ?? 0) >= SNAPSHOT_SCHEMA_VERSION && Date.now() - this.snapshotColumnsMissingAt >= 10 * 60_000;
    for (;;) {
      const columns =
        (this.settingsMissing ? PAGE_COLUMNS_WITHOUT_SETTINGS : PAGE_COLUMNS) +
        (clean ? ', clean_seq' : '') +
        (snap ? ', snapshot_seq, content_epoch' : '');
      let query = this.client.from('pages').select(columns).in('workspace_id', projectIds);
      if (after) query = query.gt('id', after);
      const { data, error, status } = await timed(query.order('id').limit(1000));
      if (error?.code === UNDEFINED_COLUMN && snap) {
        this.snapshotColumnsMissingAt = Date.now();
        return this.fetchTreeOf(projectIds, schemaVersion);
      }
      if (error?.code === UNDEFINED_COLUMN && clean) {
        this.cleanSeqMissingAt = Date.now();
        return this.fetchTreeOf(projectIds, schemaVersion);
      }
      if (error?.code === UNDEFINED_COLUMN && !this.settingsMissing) {
        this.settingsMissingAt = Date.now();
        return this.fetchTreeOf(projectIds, schemaVersion);
      }
      if (error) throw toRemoteError(error, status);
      const page = data as unknown as PageRow[];
      rows.push(...page);
      if (page.length < 1000) return rows;
      after = page[page.length - 1].id;
    }
  }

  async fetchProjects(schemaVersion?: number | null): Promise<ProjectRow[]> {
    // `archived_at` solo con la versión 9 o más (P.14). Cada workspace tiene su propia base y esta consulta
    // está en el ciclo de sincronización: si la columna falta igual (la versión dice 9 pero la migración no
    // está), se sigue sin ella un rato en vez de cortar toda la sincronización, como `fetchTreeOf` con
    // `settings`.
    const archived =
      (schemaVersion ?? 0) >= PROJECT_STATES_SCHEMA_VERSION && Date.now() - this.archivedMissingAt >= 10 * 60_000;
    // Lo mismo con las de Drive (versión 10): primero se dejan ellas; si sigue faltando algo, también `archived_at`.
    const drive =
      archived &&
      (schemaVersion ?? 0) >= PROJECT_DRIVE_SCHEMA_VERSION &&
      Date.now() - this.driveColumnsMissingAt >= 10 * 60_000;
    const columns = ['id, name, created_at, owner_id', ...(archived ? ['archived_at'] : []), ...(drive ? ['drive_trash_requested_at, drive_missing_at'] : [])];
    const { data, error, status } = await timed(this.client
      .from('workspaces')
      .select(columns.join(', '))
      .order('created_at')
      .limit(1000));
    if (drive && error?.code === UNDEFINED_COLUMN) {
      this.driveColumnsMissingAt = Date.now();
      return this.fetchProjects(schemaVersion);
    }
    if (archived && error?.code === UNDEFINED_COLUMN) {
      this.archivedMissingAt = Date.now();
      return this.fetchProjects(schemaVersion);
    }
    if (error) throw toRemoteError(error, status);
    return data as unknown as ProjectRow[];
  }

  // --- archivar, borrar y restaurar proyectos (P.14) ---------------------------------------------------

  async setProjectArchived(projectId: string, archived: boolean): Promise<void> {
    const { error, status } = await timed(this.client.rpc('set_project_archived', { p_project: projectId, p_archived: archived }));
    if (error) throw toRemoteError(error, status);
  }

  async deleteProject(projectId: string): Promise<string> {
    const { data, error, status } = await timed(this.client.rpc('delete_project', { p_project: projectId }));
    if (error) throw toRemoteError(error, status);
    return String(data);
  }

  async restoreProject(projectId: string, withoutDrive = false): Promise<void> {
    // El segundo parámetro solo si hace falta: una base de la versión 9 tiene la función con uno solo.
    const args = withoutDrive ? { p_project: projectId, p_without_drive: true } : { p_project: projectId };
    const { error, status } = await timed(this.client.rpc('restore_project', args));
    if (error) throw toRemoteError(error, status);
  }

  async trashedProjects(): Promise<TrashedProjectRow[] | null> {
    const { data, error, status } = await timed(this.client.rpc('trashed_projects'));
    if (error?.code === MISSING_FUNCTION) return null;
    if (error) throw toRemoteError(error, status);
    return ((data ?? []) as Record<string, unknown>[]).map(parseTrashedProject);
  }

  async projectDeleteInfo(projectId: string): Promise<ProjectDeleteInfo> {
    const { data, error, status } = await timed(this.client.rpc('project_delete_info', { p_project: projectId }));
    if (error) throw toRemoteError(error, status);
    return parseDeleteInfo(data);
  }

  async createProject(project: NewProject): Promise<void> {
    const { error, status } = await timed(this.client
      .from('workspaces')
      .upsert(project, { onConflict: 'id', ignoreDuplicates: true }));
    if (error) throw toRemoteError(error, status);
  }

  async renameProject(id: string, name: string): Promise<void> {
    const { data, error, status } = await timed(
      this.client.from('workspaces').update({ name }).eq('id', id).select('id'),
    );
    if (error) throw toRemoteError(error, status);
    if (data.length === 0) throw new RemoteError('project_not_found', true, 'P0002');
  }

  async createPage(page: NewPage): Promise<void> {
    const { error, status } = await timed(this.client
      .from('pages')
      .upsert(page, { onConflict: 'id', ignoreDuplicates: true }));
    if (error) throw toRemoteError(error, status);
  }

  async updatePage(id: string, patch: PagePatch): Promise<void> {
    if (this.settingsMissing && patch.settings !== undefined) {
      throw new RemoteError(t('remote.settingsMissing'), true, UNDEFINED_COLUMN);
    }
    const { data, error, status } = await timed(this.client.from('pages').update(patch).eq('id', id).select('id'));
    if (error) throw toRemoteError(error, status);
    if (data.length === 0) throw new RemoteError('page_not_found', true, 'P0002');
  }

  async pushUpdate(pageId: string, clientUpdateId: string, update: Uint8Array): Promise<number> {
    const args = { p_page_id: pageId, p_client_update_id: clientUpdateId, p_update: toBase64(update) };
    // Una base sin la migración de ajustes del workspace no tiene la versión con `p_app_version`.
    const versioned = Date.now() - this.versionedPushMissingAt >= 10 * 60_000;
    // El tope crece con lo que se sube (hasta 8 MB).
    const { data, error, status } = await timed(
      this.client.rpc('push_page_update', versioned ? { ...args, p_app_version: this.appVersion || null } : args),
      timeoutFor(args.p_update.length),
    );
    if (error?.code === MISSING_FUNCTION && versioned) {
      this.versionedPushMissingAt = Date.now();
      return this.pushUpdate(pageId, clientUpdateId, update);
    }
    if (error) throw toRemoteError(error, status);
    return Number(data);
  }

  async pullUpdates(pageId: string, afterSeq: number, limit: number): Promise<RemoteUpdate[]> {
    // Lo que llega no se sabe de antemano: con el lote más chico (uno solo, que puede pesar hasta 8 MB) se
    // da el tope más largo. Si vence un lote más grande, `PageDocs.pullPage` lo achica.
    const { data, error, status } = await timed(
      this.client.rpc('pull_page_updates', { p_page_id: pageId, p_after_seq: afterSeq, p_limit: limit }),
      limit <= 1 ? MAX_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS,
    );
    if (error) throw toRemoteError(error, status);
    return (data as { seq: number; update: string }[]).map((r) => ({
      seq: Number(r.seq),
      data: fromBase64(r.update),
    }));
  }

  async pullContent(pageId: string, afterSeq: number, limit: number): Promise<RemoteUpdate[]> {
    // Apagados (o sin la función hace poco): lo de siempre, el mismo pedido que hoy.
    if (!this.snapshotsOn || Date.now() - this.pullContentMissingAt < 10 * 60_000) {
      return this.pullUpdates(pageId, afterSeq, limit);
    }
    // Con la versión (entrega 3, 20261025120000_compactar_prender.sql): la base sirve el snapshot solo a una versión
    // permitida y con su huella; la de tres argumentos (v0.127 a v0.133) ya no sirve snapshots. Sin la migración,
    // PGRST202: filas sueltas por 10 minutos.
    const { data, error, status } = await timed(
      this.client.rpc('pull_page_content', {
        p_page_id: pageId,
        p_after_seq: afterSeq,
        p_limit: limit,
        p_app_version: this.appVersion || null,
      }),
      limit <= 1 ? MAX_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS,
    );
    if (error?.code === MISSING_FUNCTION) {
      this.pullContentMissingAt = Date.now();
      return this.pullUpdates(pageId, afterSeq, limit);
    }
    if (error) throw toRemoteError(error, status);
    return parseContentRows(data);
  }

  // --- compactar: quien arma los snapshots (Docs/Doc_Compactar.md, sección 4; 20261019120000_compactar_leer.sql) ----

  async claimCompaction(pageId: string): Promise<CompactionClaim | null> {
    const { data, error, status } = await timed(
      this.client.rpc('claim_page_compaction', { p_page_id: pageId, p_app_version: this.appVersion || null }),
    );
    // Una base sin la migración: nada que compactar.
    if (error?.code === MISSING_FUNCTION) return null;
    if (error) throw toRemoteError(error, status);
    const row = ((data ?? []) as Record<string, unknown>[])[0];
    if (!row) return null;
    return {
      baseId: row.base_id === null || row.base_id === undefined ? null : String(row.base_id),
      baseSeq: Number(row.base_seq),
      upToSeq: Number(row.up_to_seq),
      lastUpdateId: Number(row.last_update_id),
    };
  }

  async pushSnapshot(snapshot: NewSnapshot): Promise<SnapshotPushResult> {
    const state = toBase64(snapshot.state);
    const { data, error, status } = await timed(
      this.client.rpc('push_page_snapshot', {
        p_page_id: snapshot.pageId,
        p_base_id: snapshot.baseId,
        p_up_to_seq: snapshot.upToSeq,
        p_last_update_id: snapshot.lastUpdateId,
        p_state: state,
        p_sv: toBase64(snapshot.sv),
        p_sha256: snapshot.sha256,
        p_app_version: this.appVersion || null,
      }),
      timeoutFor(state.length),
    );
    if (error) throw toRemoteError(error, status);
    return parseSnapshotPush(data);
  }

  async pullSnapshot(id: string): Promise<Uint8Array> {
    // Como bajar de a una fila: el tope más largo (un snapshot puede pesar 8 MB).
    const { data, error, status } = await timed(this.client.rpc('pull_page_snapshot', { p_id: id }), MAX_REQUEST_TIMEOUT_MS);
    if (error) throw toRemoteError(error, status);
    if (typeof data !== 'string') throw new RemoteError(`pull_page_snapshot: unexpected answer ${String(data)}`, true);
    return fromBase64(data);
  }

  async pullSnapshotChecked(id: string): Promise<{ state: Uint8Array; sha256: string } | null> {
    const { data, error, status } = await timed(this.client.rpc('pull_page_snapshot_checked', { p_id: id }), MAX_REQUEST_TIMEOUT_MS);
    // Una base sin la migración de la entrega 3: quien compacta baja la base sin huella, como antes.
    if (error?.code === MISSING_FUNCTION) return null;
    if (error) throw toRemoteError(error, status);
    const row = (Array.isArray(data) ? data[0] : data) as { state?: unknown; sha256?: unknown } | undefined;
    if (typeof row?.state !== 'string' || typeof row.sha256 !== 'string') {
      throw new RemoteError(`pull_page_snapshot_checked: unexpected answer ${JSON.stringify(data)?.slice(0, 200)}`, true);
    }
    return { state: fromBase64(row.state), sha256: row.sha256.toLowerCase() };
  }

  async confirmSnapshot(id: string, sha256: string): Promise<boolean> {
    const { data, error, status } = await timed(this.client.rpc('confirm_page_snapshot', { p_id: id, p_sha256: sha256 }));
    if (error) throw toRemoteError(error, status);
    return data === true;
  }

  async skipCompaction(pageId: string, reason: string): Promise<void> {
    const { error, status } = await timed(this.client.rpc('skip_page_compaction', { p_page_id: pageId, p_reason: reason }));
    if (error) throw toRemoteError(error, status);
  }

  async invalidateSnapshot(id: string, reason: string): Promise<boolean> {
    const { data, error, status } = await timed(this.client.rpc('invalidate_page_snapshot', { p_id: id, p_reason: reason }));
    if (error) throw toRemoteError(error, status);
    return data === true;
  }

  async cleanWork({ pages, urgent = false }: { pages?: string[]; urgent?: boolean } = {}): Promise<CleanWorkRow[]> {
    const args: Record<string, unknown> = { p_app_version: this.appVersion || null, p_urgent: urgent };
    if (pages) args.p_pages = pages;
    const { data, error, status } = await timed(this.client.rpc('clean_work', args));
    // Una base sin la migración: nada que armar.
    if (error?.code === MISSING_FUNCTION) return [];
    if (error) throw toRemoteError(error, status);
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      page_id: String(r.page_id),
      update_seq: Number(r.update_seq),
      last_update_id: Number(r.last_update_id),
      clean_seq: Number(r.clean_seq),
      base_bytes: Number(r.base_bytes),
    }));
  }

  async pushCleanBase(base: NewCleanBase): Promise<CleanPushResult> {
    const state = toBase64(base.state);
    const { data, error, status } = await timed(
      this.client.rpc('push_clean_base', {
        p_id: base.id,
        p_page_id: base.pageId,
        p_to_seq: base.toSeq,
        p_last_update_id: base.lastUpdateId,
        p_state: state,
        p_sha256: base.sha256,
        p_app_version: this.appVersion || null,
      }),
      timeoutFor(state.length),
    );
    if (error) throw toRemoteError(error, status);
    return cleanPushResult(data);
  }

  async pageHistory(pageId: string, afterSeq: number, limit: number): Promise<HistoryRow[]> {
    // Como `pullUpdates`: el lote de a uno tiene el tope más largo (una fila puede pesar 8 MB).
    const { data, error, status } = await timed(
      this.client.rpc('page_history', { p_page_id: pageId, p_after_seq: afterSeq, p_limit: limit }),
      limit <= 1 ? MAX_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS,
    );
    if (error) throw toRemoteError(error, status);
    return (data as { id: number; seq: number; created_by: string | null; created_at: string; update: string; plink_author?: string | null }[]).map((r) => ({
      id: Number(r.id),
      seq: Number(r.seq),
      // Una fila que entró por un link (versión 19 de la base): el nombre del visitante (E2.8).
      createdBy: r.plink_author ? linkAuthorKey(r.plink_author) : (r.created_by ?? null),
      createdAt: String(r.created_at),
      data: fromBase64(r.update),
    }));
  }

  // --- link público, entrega 2a: admitir lo que escribe un link (20261028120000_link_editar.sql, src/sync/linkAdmit.ts) ---

  /** Las páginas con algo de un link para decidir, sin bytes. Una base sin la migración: nada. */
  async admitPages(): Promise<AdmitPageRow[]> {
    const { data, error, status } = await timed(this.client.rpc('link_admit_pages', { p_app_version: this.appVersion || null }));
    if (error?.code === MISSING_FUNCTION) return [];
    if (error) throw toRemoteError(error, status);
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      page_id: String(r.page_id),
      waiting: Number(r.waiting),
      bytes: Number(r.bytes),
    }));
  }

  /** Los bytes de lo que espera en estas páginas (hasta 20 páginas y unos 4 MB), en orden por página, link y llegada. */
  async admitWork(pages: string[]): Promise<AdmitWorkRow[]> {
    const { data, error, status } = await timed(
      this.client.rpc('link_admit_work', { p_app_version: this.appVersion || null, p_pages: pages }),
      MAX_REQUEST_TIMEOUT_MS,
    );
    if (error?.code === MISSING_FUNCTION) return [];
    if (error) throw toRemoteError(error, status);
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      page_id: String(r.page_id),
      link_id: String(r.link_id),
      n: Number(r.n),
      data: fromBase64(String(r.data)),
    }));
  }

  /** Decide en orden las filas de una página; la base corta en la primera que decide distinto. */
  async admit(pageId: string, decisions: AdmitDecision[]): Promise<AdmitResult[]> {
    const { data, error, status } = await timed(
      this.client.rpc('link_admit', { p_page_id: pageId, p_app_version: this.appVersion || null, p_decisions: decisions }),
    );
    if (error) throw toRemoteError(error, status);
    return parseAdmitResults(data);
  }

  /** Lo de un link que no entró a la página (apartado, retenido, esperando), para quien la ve con lo borrado. */
  async linkUpdatesOf(pageId: string): Promise<LinkUpdateRow[]> {
    const { data, error, status } = await timed(this.client.rpc('public_link_updates_of', { p_page_id: pageId }));
    if (error?.code === MISSING_FUNCTION) return [];
    if (error) throw toRemoteError(error, status);
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      link_id: String(r.link_id),
      author: String(r.author),
      created_at: String(r.created_at),
      bytes: Number(r.bytes),
      state: r.state === 'aside' || r.state === 'held' ? r.state : 'waiting',
      reason: typeof r.reason === 'string' ? r.reason : null,
    }));
  }

  /** Los bytes de una fila apartada o retenida (para "Download it"; nunca se aplican). */
  async linkUpdateBytes(id: string): Promise<Uint8Array> {
    const { data, error, status } = await timed(this.client.rpc('public_link_update_bytes', { p_id: id }), MAX_REQUEST_TIMEOUT_MS);
    if (error) throw toRemoteError(error, status);
    return fromBase64(String(data));
  }

  async pageHistoryAuthors(pageId: string): Promise<HistoryAuthor[]> {
    const { data, error, status } = await timed(this.client.rpc('page_history_authors', { p_page_id: pageId }));
    if (error) throw toRemoteError(error, status);
    return ((data ?? []) as { user_id: string; email: string }[]).map((r) => ({ user_id: String(r.user_id), email: String(r.email ?? '') }));
  }

  async listPageVersions(pageId: string): Promise<PageVersionRow[]> {
    const { data, error, status } = await timed(this.client.rpc('list_page_versions', { p_page_id: pageId }));
    if (error) throw toRemoteError(error, status);
    return ((data ?? []) as Record<string, unknown>[]).map(parsePageVersion);
  }

  async namePageVersion(id: string, pageId: string, seq: number, label: string): Promise<PageVersionRow> {
    const { data, error, status } = await timed(
      this.client.rpc('name_page_version', { p_id: id, p_page_id: pageId, p_seq: seq, p_label: label }),
    );
    if (error) throw toRemoteError(error, status);
    return parsePageVersion(data as Record<string, unknown>);
  }

  async renamePageVersion(id: string, label: string): Promise<PageVersionRow> {
    const { data, error, status } = await timed(this.client.rpc('rename_page_version', { p_id: id, p_label: label }));
    if (error) throw toRemoteError(error, status);
    return parsePageVersion(data as Record<string, unknown>);
  }

  async removePageVersion(id: string): Promise<void> {
    const { error, status } = await timed(this.client.rpc('remove_page_version', { p_id: id }));
    if (error) throw toRemoteError(error, status);
  }

  async markPageRestored(id: string, pageId: string, seq: number, fromSeq: number): Promise<PageVersionRow> {
    const { data, error, status } = await timed(
      this.client.rpc('mark_page_restored', { p_id: id, p_page_id: pageId, p_seq: seq, p_from_seq: fromSeq }),
    );
    if (error) throw toRemoteError(error, status);
    return parsePageVersion(data as Record<string, unknown>);
  }

  async uploadFile(path: string, data: ArrayBuffer, mime: string): Promise<void> {
    let result;
    try {
      // Con tope, como las miniaturas: sin él, un Storage que no contesta dejaba el ciclo de sincronización
      // esperando para siempre. Al vencer se corta el pedido; si la imagen ya había llegado, el reintento se
      // encuentra con que está (409, abajo) y lo da por hecho (`upsert: false`: nunca se reemplaza).
      result = await within(storageTimeout(data.byteLength), (signal) =>
        bucketWith(this.client, FILES_BUCKET, signal).upload(path, data, { contentType: mime, upsert: false }),
      );
    } catch (err) {
      throw networkError(err);
    }
    const { error } = result;
    if (!error) return;
    const status = Number((error as { status?: number; statusCode?: string }).status ??
      (error as { statusCode?: string }).statusCode ?? 0);
    if (status === 409 || /already exists/i.test(error.message)) return;
    throw toRemoteError({ message: error.message }, error.name === 'StorageUnknownError' ? 0 : status);
  }

  async downloadFile(path: string): Promise<Blob> {
    let result;
    try {
      // Dos topes: el de la imagen más pesada que acepta el bucket (no se sabe de antemano cuánto llega) y
      // `FILE_IDLE_MS` sin que llegue nada (la respuesta o un pedazo): un Storage colgado se nota en 30 s.
      result = await withinIdle(FILE_DOWNLOAD_TIMEOUT_MS, FILE_IDLE_MS, (signal, moved) =>
        bucketWatched(this.client, FILES_BUCKET, signal, moved).download(path, {}, { signal }),
      );
    } catch (err) {
      throw networkError(err);
    }
    const { data, error } = result;
    if (error) {
      const status = Number((error as { status?: number }).status ?? 0);
      throw toRemoteError({ message: error.message }, error.name === 'StorageUnknownError' ? 0 : status);
    }
    return data;
  }

  async fetchMyAccess(userId: string): Promise<AccessSnapshot | null> {
    const member = await timed(
      this.client.from('members').select('role, removed_at').eq('user_id', userId),
    ).maybeSingle();
    if (member.error && MISSING_TABLE.has(String(member.error.code))) return null;
    if (member.error) throw toRemoteError(member.error, member.status);
    // Los admins ven los permisos de todos: se piden solo los propios.
    const grants = await timed(this.client
      .from('grants')
      // Todas las columnas: `revoked_at` (un permiso sacado queda en la tabla sin efecto) se filtra acá.
      .select('*')
      .eq('user_id', userId)
      .limit(10000));
    if (grants.error && MISSING_TABLE.has(String(grants.error.code))) return null;
    if (grants.error) throw toRemoteError(grants.error, grants.status);
    try {
      return parseAccess(member.data, grants.data);
    } catch (err) {
      // No es un rechazo: se vuelve a preguntar en la próxima sincronización y nada cambia.
      throw new RemoteError(err instanceof Error ? err.message : String(err), false);
    }
  }

  async acceptInvitations(): Promise<number | null> {
    const { data, error, status } = await timed(this.client.rpc('accept_invitations'));
    if (error?.code === MISSING_FUNCTION) return null;
    if (error) throw toRemoteError(error, status);
    return Number(data) || 0;
  }

  // --- equipo (pantalla de miembros y compartir) ---

  async listMembers(): Promise<MemberRow[]> {
    const { data, error, status } = await timed(this.client.rpc('list_members'));
    if (error) throw toRemoteError(error, status);
    return (data ?? []) as MemberRow[];
  }

  async listInvitations(): Promise<InvitationRow[] | null> {
    const { data, error, status } = await timed(this.client.rpc('list_invitations'));
    if (error?.code === MISSING_FUNCTION) return null;
    if (error) throw toRemoteError(error, status);
    return (data ?? []) as InvitationRow[];
  }

  async revokeInvitation(id: string): Promise<void> {
    const { error, status } = await timed(this.client.rpc('revoke_invitation', { p_id: id }));
    if (error) throw toRemoteError(error, status);
  }

  async createInvitation(email: string, role: Exclude<Role, 'owner'>, grants: InvitationGrant[]): Promise<string> {
    const { data, error, status } = await timed(this.client.rpc('create_invitation', {
      p_email: email,
      p_role: role,
      p_grants: grants,
    }));
    if (error) throw toRemoteError(error, status);
    return String(data);
  }

  async setMemberRole(userId: string, role: Exclude<Role, 'owner'>): Promise<void> {
    const { error, status } = await timed(this.client.rpc('set_member_role', { p_user: userId, p_role: role }));
    if (error) throw toRemoteError(error, status);
  }

  async removeMember(userId: string): Promise<RemovedMember> {
    const { data, error, status } = await timed(this.client.rpc('remove_member', { p_user: userId }));
    if (error) throw toRemoteError(error, status);
    return parseRemovedMember(data);
  }

  async share(userId: string, target: { projectId: string } | { pageId: string }, level: GrantLevel): Promise<string> {
    const { data, error, status } = await timed(this.client.rpc('share', {
      p_user: userId,
      p_project: 'projectId' in target ? target.projectId : null,
      p_page: 'pageId' in target ? target.pageId : null,
      p_level: level,
    }));
    if (error) throw toRemoteError(error, status);
    return String(data);
  }

  async unshare(grantId: string): Promise<void> {
    const { error, status } = await timed(this.client.rpc('unshare', { p_grant: grantId }));
    if (error) throw toRemoteError(error, status);
  }

  async listAccess(target: { projectId: string } | { pageId: string }): Promise<AccessRow[]> {
    const { data, error, status } = await timed(this.client.rpc('list_access', {
      p_project: 'projectId' in target ? target.projectId : null,
      p_page: 'pageId' in target ? target.pageId : null,
    }));
    if (error) throw toRemoteError(error, status);
    return (data ?? []) as AccessRow[];
  }

  /**
   * Un pedido de la cola de archivos con la versión de la app (`p_app_version`), que la base compara con la
   * mínima del workspace (`app_outdated`). Una base sin esa migración no tiene la función con ese parámetro:
   * se usa la de siempre por 10 minutos y se vuelve a probar.
   */
  private async fileRpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    const versioned = Date.now() - this.versionedFilesMissingAt >= 10 * 60_000;
    const { data, error, status } = await timed(
      this.client.rpc(name, versioned ? { ...args, p_app_version: this.appVersion || null } : args),
    );
    if (error?.code === MISSING_FUNCTION && versioned) {
      this.versionedFilesMissingAt = Date.now();
      return this.fileRpc(name, args);
    }
    // La de siempre dijo `app_outdated`: la base ya tiene la función con versión (la migración llegó en estos 10
    // minutos) y una mínima de 0.090 o más. Se repite una vez con versión, que es la que vale para esta app.
    if (error?.message === APP_OUTDATED && !versioned) {
      this.versionedFilesMissingAt = 0;
      return this.fileRpc(name, args);
    }
    if (error) throw toRemoteError(error, status);
    return data;
  }

  async registerFile(file: NewMediaFile): Promise<LinkResult> {
    const data = await this.fileRpc('register_file', {
      p_id: file.id,
      p_page_id: file.pageId,
      p_name: file.name,
      p_mime: file.mime,
      p_size: file.size,
      p_width: file.width,
      p_height: file.height,
      p_duration: file.duration,
    });
    return linkResult(data);
  }

  async linkPageFile(pageId: string, fileId: string): Promise<LinkResult> {
    return linkResult(await this.fileRpc('link_page_file', { p_page_id: pageId, p_file_id: fileId }));
  }

  async uploadThumb(fileId: string, data: Blob, stalledBefore = 0): Promise<void> {
    let result;
    try {
      // Con tope: sin él, un Storage que no contesta dejaba clavada la cola de archivos, que sube de a uno
      // (la miniatura va antes que el original). Es proporcional al tamaño (30 s más lo que tarda a 16 KB/s) y
      // crece con las veces seguidas que ya venció (`thumbUploadLimit`), así una miniatura lenta pero sana
      // termina. Al vencer, el navegador corta el pedido (`bucketWith`). Si la miniatura igual había llegado
      // (la respuesta se perdió), no hace daño: no reemplaza (`upsert: false`), así que el reintento se
      // encuentra con que ya está (409, abajo) y lo da por hecho. `thumb_at` se marca recién después de una
      // subida confirmada (`setFileThumb`).
      result = await within(thumbUploadLimit(data.size, stalledBefore), (signal) =>
        bucketWith(this.client, THUMBS_BUCKET, signal).upload(thumbPath(fileId), data, { contentType: 'image/jpeg', upsert: false }),
      );
    } catch (err) {
      throw networkError(err);
    }
    const { error } = result;
    if (!error) return;
    const status = storageStatus(error);
    // Sin update en el bucket: una miniatura que ya está no se reemplaza, y eso cuenta como hecho.
    if (status === 409 || /already exists|duplicate/i.test(error.message)) return;
    throw toRemoteError({ message: error.message }, status);
  }

  async setFileThumb(fileId: string): Promise<void> {
    const { error, status } = await timed(this.client.rpc('set_file_thumb', { p_file_id: fileId }));
    if (error) throw toRemoteError(error, status);
  }

  async downloadThumb(fileId: string): Promise<Blob> {
    let result;
    try {
      // Con tope, como la subida. La bajada no sabe cuánto llega: se le da lo que tardaría la miniatura más
      // pesada que acepta el bucket. `download` sí acepta la señal: al vencer, el navegador corta el pedido.
      // La carrera queda igual, por si la respuesta se cuelga a mitad del cuerpo.
      result = await within(THUMB_DOWNLOAD_TIMEOUT_MS, (signal) =>
        this.client.storage.from(THUMBS_BUCKET).download(thumbPath(fileId), {}, { signal }),
      );
    } catch (err) {
      throw networkError(err);
    }
    const { data, error } = result;
    if (error) throw toRemoteError({ message: error.message }, storageStatus(error));
    return data;
  }

  async fetchMediaFiles(ids: string[]): Promise<MediaFileRow[]> {
    const rows: MediaFileRow[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      // Todas las columnas: una base anterior a la papelera de archivos (versión 6) no tiene `purged_at` ni
      // `drive_trashed_at`, y pedirlas por nombre fallaría.
      const { data, error, status } = await timed(
        this.client.from('files').select('*').in('id', ids.slice(i, i + 100)),
      );
      if (error) throw toRemoteError(error, status);
      rows.push(...(data as unknown as MediaFileRow[]));
    }
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      mime: r.mime,
      width: r.width,
      height: r.height,
      duration: r.duration === null ? null : Number(r.duration),
      thumb_at: r.thumb_at,
      drive_id: r.drive_id,
      // `bigint`: puede llegar como texto.
      size: r.size === null || r.size === undefined ? null : Number(r.size),
      trashed_at: r.trashed_at ?? null,
      purged_at: r.purged_at ?? null,
      drive_trashed_at: r.drive_trashed_at ?? null,
      project_id: r.project_id ?? null,
    }));
  }

  async fetchPageUses(pageIds: string[]): Promise<PageUseRow[]> {
    const rows: PageUseRow[] = [];
    // De a 100 páginas (la lista viaja en la dirección) y de a 1000 filas. Todas las columnas: una base anterior
    // a la papelera de archivos no tiene `removed_at` ni `is_foreign`. Si se cuela o se pierde una fila porque
    // algo cambió entre dos lotes, no pasa nada: un uso que no vuelve se manda como siempre.
    for (let i = 0; i < pageIds.length; i += 100) {
      for (let from = 0; ; from += 1000) {
        const { data, error, status } = await timed(
          this.client
            .from('page_files')
            .select('*')
            .in('page_id', pageIds.slice(i, i + 100))
            .order('page_id')
            .order('file_id')
            .range(from, from + 999),
        );
        if (error) throw toRemoteError(error, status);
        const page = (data ?? []) as unknown as PageUseRow[];
        rows.push(
          ...page.map((r) => ({
            page_id: r.page_id,
            file_id: r.file_id,
            removed_at: r.removed_at ?? null,
            is_foreign: r.is_foreign === true,
          })),
        );
        if (page.length < 1000) break;
      }
    }
    return rows;
  }

  async unlinkPageFile(pageId: string, fileId: string, seenSeq?: number | null): Promise<boolean> {
    const data = await this.fileRpc('unlink_page_file', {
      p_page_id: pageId,
      p_file_id: fileId,
      p_seen_seq: seenSeq ?? null,
    });
    return !unlinkIgnored(data);
  }

  async trashedFiles(projectId: string): Promise<TrashedFileRow[]> {
    const { data, error, status } = await timed(this.client.rpc('trashed_files', { p_project: projectId }));
    if (error) throw toRemoteError(error, status);
    return ((data ?? []) as (TrashedFileRow & { page_title?: string | null; trashed_page?: string | null })[]).map((r) => ({
      ...r,
      size: Number(r.size),
      days_left: Number(r.days_left),
      in_trashed_page: r.in_trashed_page === true,
      trashed_page_title: r.trashed_page_title ?? r.page_title ?? r.trashed_page ?? null,
      in_deleted_project: r.in_deleted_project === true,
    }));
  }

  async projectSizes(): Promise<ProjectSizeRow[] | null> {
    const { data, error, status } = await timed(this.client.rpc('project_sizes'));
    if (error?.code === MISSING_FUNCTION) return null;
    if (error) throw toRemoteError(error, status);
    return ((data ?? []) as Record<string, unknown>[]).map(parseProjectSize);
  }

  async filesDueForPurge(projectId: string): Promise<DueFileRow[]> {
    const { data, error, status } = await timed(this.client.rpc('files_due_for_purge', { p_project: projectId }));
    if (error) throw toRemoteError(error, status);
    return (data ?? []) as DueFileRow[];
  }
}
