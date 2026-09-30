import 'fake-indexeddb/auto';
import { PageDocs, type PageDocsOptions } from './docs';
import { SyncEngine } from './engine';
import { PageFiles } from './files';
import { openLocalDb, type LocalDb } from './localDb';
import type { Remote } from './remote';
import { mergeRootGroups, seedIfEmpty } from './structure';
import { PageTree } from './tree';
import {
  RemoteError,
  type NewPage,
  type NewProject,
  type PagePatch,
  type PageRow,
  type ProjectRow,
  type RemoteUpdate,
  type WorkspaceSettings,
} from './types';

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
  readonly projects = new Map<string, ProjectRow>([
    [this.workspaceId, { id: this.workspaceId, name: 'My project', created_at: new Date(0).toISOString() }],
  ]);
  /** Rechaza la creación de proyectos como si faltaran permisos. */
  rejectProjects = false;
  /** Para darle a cada restauración una generación nunca usada. */
  static generations = 100;
  /** `workspace_settings`; `null` simula una base sin esa migración. */
  settings: WorkspaceSettings | null = { generation: 1, minAppVersion: null, schemaVersion: 1, mediaUrl: null };

  /** Una copia de seguridad: todo lo que hay en la base en este momento. */
  backup(): () => void {
    const pages = new Map([...this.pages].map(([id, p]) => [id, { ...p }]));
    const updates = new Map([...this.updates].map(([id, list]) => [id, list.map((u) => ({ ...u }))]));
    const projects = new Map([...this.projects].map(([id, p]) => [id, { ...p }]));
    const files = new Map(this.files);
    /** Restaura la copia y sube la generación, como scripts/restore.sh del repo de copias. */
    return () => {
      this.pages.clear();
      for (const [id, p] of pages) this.pages.set(id, { ...p });
      this.updates.clear();
      for (const [id, list] of updates) this.updates.set(id, list.map((u) => ({ ...u })));
      this.projects.clear();
      for (const [id, p] of projects) this.projects.set(id, { ...p });
      this.files.clear();
      for (const [path, f] of files) this.files.set(path, f);
      // Como scripts/restore.sh: un valor que no se usó nunca, aunque la copia traiga uno viejo.
      if (this.settings) this.settings = { ...this.settings, generation: ++FakeServer.generations };
    };
  }

  check(): void {
    if (!this.online) throw new RemoteError('Failed to fetch', false, undefined, true);
  }
}

export class FakeRemote implements Remote {
  constructor(
    readonly server: FakeServer,
    readonly appVersion = '',
  ) {}

  async fetchWorkspaceSettings(): Promise<WorkspaceSettings | null> {
    this.server.check();
    return this.server.settings && { ...this.server.settings };
  }

  async ensureWorkspace(): Promise<string> {
    this.server.check();
    return this.server.workspaceId;
  }

  async fetchTree(projectIds: string[]): Promise<PageRow[]> {
    this.server.check();
    const ids = new Set(projectIds);
    return [...this.server.pages.values()].filter((p) => ids.has(p.workspace_id)).map((p) => ({ ...p }));
  }

  async fetchProjects(): Promise<ProjectRow[]> {
    this.server.check();
    return [...this.server.projects.values()].map((p) => ({ ...p }));
  }

  async createProject(project: NewProject): Promise<void> {
    this.server.check();
    if (this.server.projects.has(project.id)) return;
    if (this.server.rejectProjects) {
      throw new RemoteError('new row violates row-level security policy for table "workspaces"', true, '42501');
    }
    this.server.projects.set(project.id, { ...project, created_at: new Date().toISOString() });
  }

  async renameProject(id: string, name: string): Promise<void> {
    this.server.check();
    const project = this.server.projects.get(id);
    if (!project) throw new RemoteError('project_not_found', true, 'P0002');
    this.server.projects.set(id, { ...project, name });
  }

  async createPage(page: NewPage): Promise<void> {
    this.server.check();
    if (this.server.pages.has(page.id)) return;
    if (this.server.rejectCreates) {
      throw new RemoteError('new row violates row-level security policy for table "pages"', true, '42501');
    }
    if (!this.server.projects.has(page.workspace_id)) {
      throw new RemoteError('new row violates row-level security policy for table "pages"', true, '42501');
    }
    const parent = page.parent_id ? this.server.pages.get(page.parent_id) : undefined;
    if (page.parent_id && parent?.workspace_id !== page.workspace_id) {
      throw new RemoteError('page_parent_invalid', true, '23503');
    }
    const now = new Date().toISOString();
    this.server.pages.set(page.id, {
      ...page,
      icon: null,
      settings: {},
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
    if (patch.parent_id && this.server.pages.get(patch.parent_id)?.workspace_id !== page.workspace_id) {
      throw new RemoteError('page_parent_invalid', true, '23503');
    }
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
    const min = this.server.settings?.minAppVersion;
    if (min != null && !(/^\d{1,4}(\.\d{1,3})?$/.test(this.appVersion) && Number(this.appVersion) >= min)) {
      throw new RemoteError('app_outdated', true, 'P0001');
    }
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
export async function makeDevice(
  server: FakeServer,
  dbName: string = crypto.randomUUID(),
  appVersion = '0.021',
  docsOptions: PageDocsOptions = {},
): Promise<Device> {
  const db = await openLocalDb(dbName);
  const remote = new FakeRemote(server, appVersion);
  const tree = new PageTree(db, server.workspaceId);
  await tree.load();
  const docs = new PageDocs(db, { normalize: mergeRootGroups, seed: seedIfEmpty, ...docsOptions });
  const files = new PageFiles(db, remote);
  const engine = new SyncEngine(remote, tree, docs, files, { appVersion });
  return { db, tree, docs, files, engine, remote };
}
