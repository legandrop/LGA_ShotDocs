import type { SupabaseClient } from '@supabase/supabase-js';
import { fromBase64, toBase64 } from '../lib/base64';
import {
  RemoteError,
  type NewPage,
  type NewProject,
  type PagePatch,
  type PageRow,
  type ProjectRow,
  type MediaFileRow,
  type NewMediaFile,
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
}

/**
 * Los archivos grandes (fotos y videos que van al Drive del dueño por el portero): la base guarda de qué
 * proyecto son y qué páginas los usan, y la miniatura va al bucket `thumbs` (ver
 * supabase/migrations/20260930150000_archivos.sql). Todo es idempotente.
 */
export interface MediaRemote {
  /** `page_not_found` si no se puede editar la página; `file_other_project` si el id es de otro proyecto. */
  registerFile(file: NewMediaFile): Promise<void>;
  /** `file_not_found` si el archivo todavía no está en el servidor (se reintenta más tarde). */
  linkPageFile(pageId: string, fileId: string): Promise<void>;
  /** Sube `thumbs/<id>.jpg` sin reemplazar: si ya existe, está hecho. */
  uploadThumb(fileId: string, data: Blob): Promise<void>;
  setFileThumb(fileId: string): Promise<void>;
  downloadThumb(fileId: string): Promise<Blob>;
  /** Las filas de `files` que la sesión puede ver (las demás no vuelven). */
  fetchMediaFiles(ids: string[]): Promise<MediaFileRow[]>;
}

export const FILES_BUCKET = 'page-files';
export const THUMBS_BUCKET = 'thumbs';
const MEDIA_COLUMNS = 'id, name, mime, width, height, duration, thumb_at, drive_id';

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
  const permanent = !(TRANSIENT_STATUS.has(httpStatus) || httpStatus >= 500);
  return new RemoteError(error?.message ?? `HTTP ${httpStatus}`, permanent, code, httpStatus === 0);
}

function networkError(err: unknown): RemoteError {
  return new RemoteError(err instanceof Error ? err.message : String(err), false, undefined, true);
}

function storageStatus(error: { name?: string; message: string }): number {
  if (error.name === 'StorageUnknownError') return 0;
  return Number((error as { status?: number; statusCode?: string }).status ?? (error as { statusCode?: string }).statusCode ?? 0);
}

export class SupabaseRemote implements Remote, MediaRemote {
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
    const { data, error, status } = await this.client.from('workspace_settings').select('*').maybeSingle();
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
    return {
      generation: Number(row.generation),
      minAppVersion: row.min_app_version === null ? null : Number(row.min_app_version),
      schemaVersion: Number(row.schema_version),
      mediaUrl: row.media_url || null,
      ownerId: (row as { owner_id?: string | null }).owner_id ?? null,
    };
  }

  async ensureWorkspace(): Promise<string | null> {
    const { data, error, status } = await this.client.rpc('ensure_workspace');
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
      const { data, error, status } = await query.order('id').limit(1000);
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
    const { data, error, status } = await this.client
      .from('workspaces')
      .select('id, name, created_at')
      .order('created_at')
      .limit(1000);
    if (error) throw toRemoteError(error, status);
    return data as ProjectRow[];
  }

  async createProject(project: NewProject): Promise<void> {
    const { error, status } = await this.client
      .from('workspaces')
      .upsert(project, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw toRemoteError(error, status);
  }

  async renameProject(id: string, name: string): Promise<void> {
    const { data, error, status } = await this.client.from('workspaces').update({ name }).eq('id', id).select('id');
    if (error) throw toRemoteError(error, status);
    if (data.length === 0) throw new RemoteError('project_not_found', true, 'P0002');
  }

  async createPage(page: NewPage): Promise<void> {
    const { error, status } = await this.client
      .from('pages')
      .upsert(page, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw toRemoteError(error, status);
  }

  async updatePage(id: string, patch: PagePatch): Promise<void> {
    if (this.settingsMissing && patch.settings !== undefined) {
      throw new RemoteError('The database is missing pages.settings: apply the database migrations.', true, UNDEFINED_COLUMN);
    }
    const { data, error, status } = await this.client.from('pages').update(patch).eq('id', id).select('id');
    if (error) throw toRemoteError(error, status);
    if (data.length === 0) throw new RemoteError('page_not_found', true, 'P0002');
  }

  async pushUpdate(pageId: string, clientUpdateId: string, update: Uint8Array): Promise<number> {
    const args = { p_page_id: pageId, p_client_update_id: clientUpdateId, p_update: toBase64(update) };
    // Una base sin la migración de ajustes del workspace no tiene la versión con `p_app_version`.
    const versioned = Date.now() - this.versionedPushMissingAt >= 10 * 60_000;
    const { data, error, status } = await this.client.rpc(
      'push_page_update',
      versioned ? { ...args, p_app_version: this.appVersion || null } : args,
    );
    if (error?.code === MISSING_FUNCTION && versioned) {
      this.versionedPushMissingAt = Date.now();
      return this.pushUpdate(pageId, clientUpdateId, update);
    }
    if (error) throw toRemoteError(error, status);
    return Number(data);
  }

  async pullUpdates(pageId: string, afterSeq: number, limit: number): Promise<RemoteUpdate[]> {
    const { data, error, status } = await this.client.rpc('pull_page_updates', {
      p_page_id: pageId,
      p_after_seq: afterSeq,
      p_limit: limit,
    });
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

  async registerFile(file: NewMediaFile): Promise<void> {
    const { error, status } = await this.client.rpc('register_file', {
      p_id: file.id,
      p_page_id: file.pageId,
      p_name: file.name,
      p_mime: file.mime,
      p_size: file.size,
      p_width: file.width,
      p_height: file.height,
      p_duration: file.duration,
    });
    if (error) throw toRemoteError(error, status);
  }

  async linkPageFile(pageId: string, fileId: string): Promise<void> {
    const { error, status } = await this.client.rpc('link_page_file', { p_page_id: pageId, p_file_id: fileId });
    if (error) throw toRemoteError(error, status);
  }

  async uploadThumb(fileId: string, data: Blob): Promise<void> {
    let result;
    try {
      result = await this.client.storage
        .from(THUMBS_BUCKET)
        .upload(thumbPath(fileId), data, { contentType: 'image/jpeg', upsert: false });
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
    const { error, status } = await this.client.rpc('set_file_thumb', { p_file_id: fileId });
    if (error) throw toRemoteError(error, status);
  }

  async downloadThumb(fileId: string): Promise<Blob> {
    let result;
    try {
      result = await this.client.storage.from(THUMBS_BUCKET).download(thumbPath(fileId));
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
      const { data, error, status } = await this.client.from('files').select(MEDIA_COLUMNS).in('id', ids.slice(i, i + 100));
      if (error) throw toRemoteError(error, status);
      rows.push(...(data as unknown as MediaFileRow[]));
    }
    return rows.map((r) => ({ ...r, duration: r.duration === null ? null : Number(r.duration) }));
  }
}
