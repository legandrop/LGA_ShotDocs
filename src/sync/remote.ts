import type { SupabaseClient } from '@supabase/supabase-js';
import { t } from '../i18n';
import { fromBase64, toBase64 } from '../lib/base64';
import { THUMB_MAX_BYTES } from '../media/probe';
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
  type NewMediaFile,
  type ProjectSizeRow,
  type TrashedFileRow,
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
   * para que, cuando se pueda compartir, lo compartido llegue por su propio camino.
   */
  fetchTree(projectIds: string[]): Promise<PageRow[]>;
  fetchProjects(): Promise<ProjectRow[]>;
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
  /** Sube `thumbs/<id>.jpg` sin reemplazar: si ya existe, está hecho. */
  uploadThumb(fileId: string, data: Blob): Promise<void>;
  setFileThumb(fileId: string): Promise<void>;
  downloadThumb(fileId: string): Promise<Blob>;
  /** Las filas de `files` que la sesión puede ver (las demás no vuelven). */
  fetchMediaFiles(ids: string[]): Promise<MediaFileRow[]>;
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
  'id, workspace_id, parent_id, title, icon, sort_key, settings, update_seq, deleted_at, created_at, updated_at';
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
 * grande en una red lenta puede tardar más): las miniaturas tienen uno proporcional a su tamaño (`within` con
 * `timeoutFor`) y las imágenes del bucket `page-files` (un workspace sin portero) siguen sin ninguno.
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

export class SupabaseRemote implements Remote, MediaRemote, TeamRemote, SizesRemote {
  /** Desde cuándo la base no tiene `pages.settings`; se vuelve a probar cada tanto por si se migró. */
  private settingsMissingAt = 0;

  private get settingsMissing(): boolean {
    return Date.now() - this.settingsMissingAt < 10 * 60_000;
  }

  /** Desde cuándo la base no tiene `workspace_settings` (o la subida con versión); se reintenta cada tanto. */
  private settingsTableMissingAt = 0;
  private versionedPushMissingAt = 0;

  /**
   * `appVersion` viaja con cada subida de contenido: el servidor rechaza las de una versión más vieja que
   * la mínima del workspace.
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
    };
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
    };
  }

  async ensureWorkspace(): Promise<string | null> {
    const { data, error, status } = await timed(this.client.rpc('ensure_workspace'));
    if (error) throw toRemoteError(error, status);
    return (data as string | null) || null;
  }

  async fetchTree(projectIds: string[]): Promise<PageRow[]> {
    // De a 100 proyectos por consulta: la lista viaja en la dirección y tiene un largo máximo.
    const rows: PageRow[] = [];
    for (let i = 0; i < projectIds.length; i += 100) {
      rows.push(...(await this.fetchTreeOf(projectIds.slice(i, i + 100))));
    }
    return rows;
  }

  private async fetchTreeOf(projectIds: string[]): Promise<PageRow[]> {
    // De a 1000, por id: si se crean páginas mientras se baja, no se saltea ninguna.
    const rows: PageRow[] = [];
    let after: string | null = null;
    for (;;) {
      const columns = this.settingsMissing ? PAGE_COLUMNS_WITHOUT_SETTINGS : PAGE_COLUMNS;
      let query = this.client.from('pages').select(columns).in('workspace_id', projectIds);
      if (after) query = query.gt('id', after);
      const { data, error, status } = await timed(query.order('id').limit(1000));
      if (error?.code === UNDEFINED_COLUMN && !this.settingsMissing) {
        this.settingsMissingAt = Date.now();
        return this.fetchTreeOf(projectIds);
      }
      if (error) throw toRemoteError(error, status);
      const page = data as unknown as PageRow[];
      rows.push(...page);
      if (page.length < 1000) return rows;
      after = page[page.length - 1].id;
    }
  }

  async fetchProjects(): Promise<ProjectRow[]> {
    const { data, error, status } = await timed(this.client
      .from('workspaces')
      .select('id, name, created_at, owner_id')
      .order('created_at')
      .limit(1000));
    if (error) throw toRemoteError(error, status);
    return data as ProjectRow[];
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

  async uploadFile(path: string, data: ArrayBuffer, mime: string): Promise<void> {
    let result;
    try {
      result = await this.client.storage
        .from(FILES_BUCKET)
        .upload(path, data, { contentType: mime, upsert: false });
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
      result = await this.client.storage.from(FILES_BUCKET).download(path);
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

  async registerFile(file: NewMediaFile): Promise<LinkResult> {
    const { data, error, status } = await timed(this.client.rpc('register_file', {
      p_id: file.id,
      p_page_id: file.pageId,
      p_name: file.name,
      p_mime: file.mime,
      p_size: file.size,
      p_width: file.width,
      p_height: file.height,
      p_duration: file.duration,
    }));
    if (error) throw toRemoteError(error, status);
    return linkResult(data);
  }

  async linkPageFile(pageId: string, fileId: string): Promise<LinkResult> {
    const { data, error, status } = await timed(
      this.client.rpc('link_page_file', { p_page_id: pageId, p_file_id: fileId }),
    );
    if (error) throw toRemoteError(error, status);
    return linkResult(data);
  }

  async uploadThumb(fileId: string, data: Blob): Promise<void> {
    let result;
    try {
      // Con tope: sin él, un Storage que no contesta dejaba clavada la cola de archivos, que sube de a uno
      // (la miniatura va antes que el original). Es proporcional al tamaño (30 s más lo que tarda a 16 KB/s),
      // así una miniatura lenta pero sana termina. `upload` no acepta una señal de corte en esta versión del
      // cliente, por eso es una carrera: si el tope vence, el pedido queda suelto y puede terminar solo. No
      // hace daño: no reemplaza (`upsert: false`), así que el reintento se encuentra con que ya está (409,
      // abajo) y lo da por hecho, y si no había llegado, la sube. `thumb_at` se marca recién después de una
      // subida confirmada (`setFileThumb`), nunca por una que quedó suelta.
      result = await within(timeoutFor(data.size), () =>
        this.client.storage
          .from(THUMBS_BUCKET)
          .upload(thumbPath(fileId), data, { contentType: 'image/jpeg', upsert: false }),
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

  async unlinkPageFile(pageId: string, fileId: string, seenSeq?: number | null): Promise<boolean> {
    const { data, error, status } = await timed(this.client.rpc('unlink_page_file', {
      p_page_id: pageId,
      p_file_id: fileId,
      p_seen_seq: seenSeq ?? null,
    }));
    if (error) throw toRemoteError(error, status);
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
