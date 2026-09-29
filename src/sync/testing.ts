import 'fake-indexeddb/auto';
import { PageDocs } from './docs';
import { SyncEngine } from './engine';
import { PageFiles } from './files';
import { openLocalDb, type LocalDb } from './localDb';
import type { Remote } from './remote';
import { mergeRootGroups } from './structure';
import { PageTree } from './tree';
import { RemoteError, type NewPage, type PagePatch, type PageRow, type RemoteUpdate } from './types';

/** Servidor en memoria con las mismas reglas que el de Supabase (ver supabase/migrations). */
export class FakeServer {
  online = true;
  /** Guarda el próximo update pero hace como si la respuesta se hubiera perdido. */
  loseNextPushResponse = false;
  /** Rechaza las creaciones de páginas como si faltaran permisos. */
  rejectCreates = false;
  /** Tope de tamaño de un update, como en push_page_update (8 MB). */
  maxUpdateBytes = 8 * 1024 * 1024;
  /** Hace fallar las subidas de archivos como si se cortara la red. */
  failUploads = false;
  readonly pages = new Map<string, PageRow>();
  readonly updates = new Map<string, { seq: number; clientUpdateId: string; data: Uint8Array }[]>();
  readonly files = new Map<string, { data: ArrayBuffer; mime: string }>();
  readonly workspaceId = crypto.randomUUID();

  check(): void {
    if (!this.online) throw new RemoteError('Failed to fetch', false, undefined, true);
  }
}

export class FakeRemote implements Remote {
  constructor(readonly server: FakeServer) {}

  async ensureWorkspace(): Promise<string> {
    this.server.check();
    return this.server.workspaceId;
  }

  async fetchTree(workspaceId: string): Promise<PageRow[]> {
    this.server.check();
    return [...this.server.pages.values()].filter((p) => p.workspace_id === workspaceId).map((p) => ({ ...p }));
  }

  async createPage(page: NewPage): Promise<void> {
    this.server.check();
    if (this.server.pages.has(page.id)) return;
    if (this.server.rejectCreates) {
      throw new RemoteError('new row violates row-level security policy for table "pages"', true, '42501');
    }
    if (page.parent_id && !this.server.pages.has(page.parent_id)) {
      throw new RemoteError('page_parent_invalid', true, '23503');
    }
    const now = new Date().toISOString();
    this.server.pages.set(page.id, {
      ...page,
      icon: null,
      update_seq: 0,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    });
  }

  async updatePage(id: string, patch: PagePatch): Promise<void> {
    this.server.check();
    const page = this.server.pages.get(id);
    if (!page) throw new RemoteError('page_not_found', true, 'P0002');
    if (patch.parent_id !== undefined && patch.parent_id !== null) {
      for (let cur: string | null = patch.parent_id; cur; cur = this.server.pages.get(cur)?.parent_id ?? null) {
        if (cur === id) throw new RemoteError('page_cycle', true, '23514');
      }
    }
    this.server.pages.set(id, { ...page, ...patch, updated_at: new Date().toISOString() });
  }

  async pushUpdate(pageId: string, clientUpdateId: string, update: Uint8Array): Promise<number> {
    this.server.check();
    const page = this.server.pages.get(pageId);
    if (!page) throw new RemoteError('page_not_found', true, 'P0002');
    const list = this.server.updates.get(pageId) ?? [];
    const existing = list.find((u) => u.clientUpdateId === clientUpdateId);
    if (existing) return existing.seq;
    if (update.length === 0 || update.length > this.server.maxUpdateBytes) {
      throw new RemoteError('update_size_invalid', true, '22023');
    }
    page.update_seq += 1;
    list.push({ seq: page.update_seq, clientUpdateId, data: update.slice() });
    this.server.updates.set(pageId, list);
    if (this.server.loseNextPushResponse) {
      this.server.loseNextPushResponse = false;
      throw new RemoteError('Failed to fetch', false, undefined, true);
    }
    return page.update_seq;
  }

  async pullUpdates(pageId: string, afterSeq: number, limit: number): Promise<RemoteUpdate[]> {
    this.server.check();
    if (!this.server.pages.has(pageId)) throw new RemoteError('page_not_found', true, 'P0002');
    return (this.server.updates.get(pageId) ?? [])
      .filter((u) => u.seq > afterSeq)
      .slice(0, limit)
      .map((u) => ({ seq: u.seq, data: u.data.slice() }));
  }

  async uploadFile(path: string, data: ArrayBuffer, mime: string): Promise<void> {
    this.server.check();
    if (this.server.failUploads) throw new RemoteError('Failed to fetch', false, undefined, true);
    const pageId = path.split('/')[0];
    if (!this.server.pages.has(pageId)) throw new RemoteError('new row violates row-level security policy', true);
    if (!this.server.files.has(path)) this.server.files.set(path, { data: data.slice(0), mime });
  }

  async downloadFile(path: string): Promise<Blob> {
    this.server.check();
    const file = this.server.files.get(path);
    if (!file) throw new RemoteError('Object not found', true);
    return new Blob([file.data], { type: file.mime });
  }
}

export interface Device {
  db: LocalDb;
  tree: PageTree;
  docs: PageDocs;
  files: PageFiles;
  engine: SyncEngine;
  remote: FakeRemote;
}

/** Un dispositivo con su propia base local. Reusar `dbName` simula cerrar y volver a abrir la app. */
export async function makeDevice(server: FakeServer, dbName: string = crypto.randomUUID()): Promise<Device> {
  const db = await openLocalDb(dbName);
  const remote = new FakeRemote(server);
  const tree = new PageTree(db, server.workspaceId);
  await tree.load();
  const docs = new PageDocs(db, { normalize: mergeRootGroups });
  const files = new PageFiles(db, remote);
  const engine = new SyncEngine(remote, tree, docs, files);
  return { db, tree, docs, files, engine, remote };
}
