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
  'id, workspace_id, parent_id, title, icon, sort_key, update_seq, deleted_at, created_at, updated_at';

// 401 llega cuando la sesión venció y se está renovando: se reintenta.
const TRANSIENT_STATUS = new Set([0, 401, 408, 425, 429, 500, 502, 503, 504]);

export function toRemoteError(
  error: { message: string; code?: string | number; status?: number } | null,
  status?: number,
): RemoteError {
  const code = error?.code === undefined ? undefined : String(error.code);
  const httpStatus = status ?? error?.status ?? 0;
  const permanent = !(TRANSIENT_STATUS.has(httpStatus) || httpStatus >= 500);
  return new RemoteError(error?.message ?? `HTTP ${httpStatus}`, permanent, code);
}

function networkError(err: unknown): RemoteError {
  return new RemoteError(err instanceof Error ? err.message : String(err), false);
}

export class SupabaseRemote implements Remote {
  constructor(private readonly client: SupabaseClient) {}

  async ensureWorkspace(): Promise<string> {
    const { data, error, status } = await this.client.rpc('ensure_workspace');
    if (error) throw toRemoteError(error, status);
    return data as string;
  }

  async fetchTree(workspaceId: string): Promise<PageRow[]> {
    const rows: PageRow[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error, status } = await this.client
        .from('pages')
        .select(PAGE_COLUMNS)
        .eq('workspace_id', workspaceId)
        .order('id')
        .range(from, from + 999);
      if (error) throw toRemoteError(error, status);
      rows.push(...(data as PageRow[]));
      if (data.length < 1000) return rows;
    }
  }

  async createPage(page: NewPage): Promise<void> {
    const { error, status } = await this.client
      .from('pages')
      .upsert(page, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw toRemoteError(error, status);
  }

  async updatePage(id: string, patch: PagePatch): Promise<void> {
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
