import type { SupabaseClient } from '@supabase/supabase-js';
import { fromBase64, toBase64 } from '../lib/base64';
import { RemoteError, type NewPage, type PagePatch, type PageRow, type RemoteUpdate } from './types';

/** Todo lo que la sincronización le pide al servidor. Las pruebas usan una versión en memoria. */
export interface Remote {
  ensureWorkspace(): Promise<string>;
  fetchTree(workspaceId: string): Promise<PageRow[]>;
  /** Idempotente: si la página ya existe no hace nada. */
  createPage(page: NewPage): Promise<void>;
  updatePage(id: string, patch: PagePatch): Promise<void>;
  /** Idempotente por `clientUpdateId`. Devuelve el `seq` asignado. */
  pushUpdate(pageId: string, clientUpdateId: string, update: Uint8Array): Promise<number>;
  pullUpdates(pageId: string, afterSeq: number, limit: number): Promise<RemoteUpdate[]>;
  /** Idempotente: si el archivo ya está subido no hace nada. */
  uploadFile(path: string, data: ArrayBuffer, mime: string): Promise<void>;
  downloadFile(path: string): Promise<Blob>;
}

export const FILES_BUCKET = 'page-files';
export const PAGE_COLUMNS =
  'id, workspace_id, parent_id, title, icon, sort_key, settings, update_seq, deleted_at, created_at, updated_at';
// Una instalación que publicó esta versión sin aplicar la migración de ajustes no tiene `pages.settings`:
// el árbol se sigue bajando sin esa columna, en vez de cortar toda la sincronización.
const PAGE_COLUMNS_WITHOUT_SETTINGS = PAGE_COLUMNS.replace(' settings,', '');
const UNDEFINED_COLUMN = '42703';

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

export class SupabaseRemote implements Remote {
  /** Desde cuándo la base no tiene `pages.settings`; se vuelve a probar cada tanto por si se migró. */
  private settingsMissingAt = 0;

  private get settingsMissing(): boolean {
    return Date.now() - this.settingsMissingAt < 10 * 60_000;
  }

  constructor(private readonly client: SupabaseClient) {}

  async ensureWorkspace(): Promise<string> {
    const { data, error, status } = await this.client.rpc('ensure_workspace');
    if (error) throw toRemoteError(error, status);
    return data as string;
  }

  async fetchTree(workspaceId: string): Promise<PageRow[]> {
    // De a 1000, por id: si se crean páginas mientras se baja, no se saltea ninguna.
    const rows: PageRow[] = [];
    let after: string | null = null;
    for (;;) {
      const columns = this.settingsMissing ? PAGE_COLUMNS_WITHOUT_SETTINGS : PAGE_COLUMNS;
      let query = this.client.from('pages').select(columns).eq('workspace_id', workspaceId);
      if (after) query = query.gt('id', after);
      const { data, error, status } = await query.order('id').limit(1000);
      if (error?.code === UNDEFINED_COLUMN && !this.settingsMissing) {
        this.settingsMissingAt = Date.now();
        return this.fetchTree(workspaceId);
      }
      if (error) throw toRemoteError(error, status);
      const page = data as unknown as PageRow[];
      rows.push(...page);
      if (page.length < 1000) return rows;
      after = page[page.length - 1].id;
    }
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
    const { data, error, status } = await this.client.rpc('push_page_update', {
      p_page_id: pageId,
      p_client_update_id: clientUpdateId,
      p_update: toBase64(update),
    });
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
}
