import 'fake-indexeddb/auto';
import { mediaDbName, openMediaDb, type MediaDb } from '../media/mediaDb';
import { Portero } from '../media/portero';
import type { Probe } from '../media/probe';
import { MediaQueue } from '../media/queue';
import { PageDocs, type PageDocsOptions } from './docs';
import { SyncEngine } from './engine';
import { PageFiles } from './files';
import { openLocalDb, type LocalDb } from './localDb';
import type { MediaRemote, Remote } from './remote';
import { mergeRootGroups, seedIfEmpty } from './structure';
import { PageTree } from './tree';
import {
  RemoteError,
  type MediaFileRow,
  type NewMediaFile,
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
  /** `files`, con el proyecto (sale de la página) y el tamaño. */
  readonly mediaFiles = new Map<string, MediaFileRow & { project_id: string; size: number }>();
  /** `page_files`: `<página>:<archivo>`. */
  readonly pageFiles = new Set<string>();
  /** El bucket `thumbs`. */
  readonly thumbs = new Map<string, Blob>();
  /** Cuántas veces se llamó cada función de archivos (para ver que no se llama de más). */
  readonly mediaCalls: string[] = [];
  /** El portero del workspace, en memoria. */
  readonly portero = new FakePortero(this);
  /** Funciones de archivos que hacen su trabajo y después pierden la respuesta, una vez cada una. */
  readonly loseMediaResponse = new Set<string>();
  /** Cuánto adelantar el reloj de la cola de archivos (para no esperar de verdad entre reintentos). */
  clockOffset = 0;

  /** Pierde la respuesta de una función de archivos si se pidió. */
  lostMediaResponse(name: string): void {
    if (this.loseMediaResponse.delete(name)) throw new RemoteError('Failed to fetch', false, undefined, true);
  }

  /** Prende el portero y la base con archivos (versión 3). */
  enableMedia(): void {
    this.settings = { ...(this.settings ?? { generation: 1, minAppVersion: null, schemaVersion: 1, mediaUrl: null }), schemaVersion: 3, mediaUrl: PORTERO_URL };
  }

  /** Una copia de seguridad: todo lo que hay en la base en este momento. */
  backup(): () => void {
    const pages = new Map([...this.pages].map(([id, p]) => [id, { ...p }]));
    const updates = new Map([...this.updates].map(([id, list]) => [id, list.map((u) => ({ ...u }))]));
    const projects = new Map([...this.projects].map(([id, p]) => [id, { ...p }]));
    const files = new Map(this.files);
    const mediaFiles = new Map([...this.mediaFiles].map(([id, f]) => [id, { ...f }]));
    const pageFiles = new Set(this.pageFiles);
    const thumbs = new Map(this.thumbs);
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
      this.mediaFiles.clear();
      for (const [id, f] of mediaFiles) this.mediaFiles.set(id, { ...f });
      this.pageFiles.clear();
      for (const k of pageFiles) this.pageFiles.add(k);
      this.thumbs.clear();
      for (const [id, t] of thumbs) this.thumbs.set(id, t);
      // Como scripts/restore.sh: un valor que no se usó nunca, aunque la copia traiga uno viejo.
      if (this.settings) this.settings = { ...this.settings, generation: ++FakeServer.generations };
    };
  }

  check(): void {
    if (!this.online) throw new RemoteError('Failed to fetch', false, undefined, true);
  }
}

export const PORTERO_URL = 'https://portero.test';

interface FakeUpload {
  file: string;
  size: number;
  data: Uint8Array;
  received: number;
  done?: { id: string; name: string; mimeType: string; size: number };
}

/**
 * El portero en memoria, con las mismas respuestas que portero/src/core.ts para los archivos de la app:
 * `POST /upload` con `file` (pregunta a la base si existe y si ya está en Drive), `PUT /upload/<id>` por
 * partes (o `bytes *\/total` para preguntar cuánto llegó), y `POST /pass` con `file`.
 */
export class FakePortero {
  readonly uploads = new Map<string, FakeUpload>();
  /** Lo que llegó a Drive: id de Drive → contenido y carpeta. */
  readonly drive = new Map<string, { file: string; data: Uint8Array; folder: string; name: string }>();
  readonly calls: { method: string; path: string; range?: string; body?: Record<string, unknown> }[] = [];
  /** Después de esta cantidad de partes, se corta la red (todas las partes fallan). */
  cutAfterParts: number | null = null;
  /** La base no se entera al terminar (`set_file_drive` falla por red): responde `linked: false`. */
  failLink = false;
  /** Responde 403 a las subidas, como si la persona no pudiera editar la página. */
  forbid = false;
  private parts = 0;
  private next = 1;

  constructor(private readonly server: FakeServer) {}

  readonly fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const headers = new Headers(init.headers);
    const range = headers.get('Content-Range') ?? undefined;
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    this.calls.push({ method, path: url.pathname, range, body });
    if (!this.server.online) throw new TypeError('Failed to fetch');

    if (method === 'POST' && url.pathname === '/upload') {
      const id = String(body?.file ?? '');
      const media = this.server.mediaFiles.get(id);
      if (!media) return json({ error: 'This file does not exist or you cannot see it.' }, 404);
      if (this.forbid) return json({ error: 'You cannot add files to this page.' }, 403);
      if (typeof body?.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.day)) return json({ error: 'The day must look like 2026-09-30.' }, 400);
      if (Number(body.size) !== media.size) return json({ error: 'The size does not match the file.' }, 400);
      if (media.drive_id) {
        return json({ status: 'done', file: { id: media.drive_id, name: media.name, mimeType: media.mime, size: media.size } });
      }
      // Ya está en Drive pero la base no se enteró: se le avisa ahora.
      const stored = [...this.drive].find(([, d]) => d.file === id);
      if (stored) {
        const linked = this.link(id, stored[0]);
        return json({ status: 'done', file: { id: stored[0], name: media.name, mimeType: media.mime, size: media.size }, linked });
      }
      const uploadId = `up-${this.next++}`;
      this.uploads.set(uploadId, { file: id, size: media.size, data: new Uint8Array(media.size), received: 0 });
      return json({ uploadId, folder: `LGA_ShotDocs/${this.server.projects.get(media.project_id)?.name}/${body.day}` });
    }
    const uploadId = /^\/upload\/(.+)$/.exec(url.pathname)?.[1];
    if (method === 'PUT' && uploadId) {
      const up = this.uploads.get(uploadId);
      if (!up) return json({ error: 'This upload does not exist anymore: start it again.' }, 404);
      if (up.done) return json({ status: 'done', file: up.done, linked: this.link(up.file, up.done.id) });
      const part = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range ?? '');
      if (part && init.body instanceof Blob) {
        if (this.cutAfterParts !== null && this.parts >= this.cutAfterParts) throw new TypeError('Load failed');
        const start = Number(part[1]);
        if (start !== up.received) return json({ error: 'The part does not match the upload.' }, 400);
        const bytes = new Uint8Array(await init.body.arrayBuffer());
        up.data.set(bytes, start);
        up.received = start + bytes.byteLength;
        this.parts++;
      }
      if (up.received === up.size) {
        const media = this.server.mediaFiles.get(up.file)!;
        const driveId = `drive-${up.file.slice(0, 8)}-${this.drive.size + 1}`;
        up.done = { id: driveId, name: media.name, mimeType: media.mime, size: up.size };
        this.drive.set(driveId, { file: up.file, data: up.data, folder: `LGA_ShotDocs/${this.server.projects.get(media.project_id)?.name}`, name: media.name });
        return json({ status: 'done', file: up.done, linked: this.link(up.file, driveId) });
      }
      return json({ status: 'incomplete', received: up.received });
    }
    if (method === 'POST' && url.pathname === '/pass') {
      const media = this.server.mediaFiles.get(String(body?.file ?? ''));
      if (!media) return json({ error: 'This file does not exist or you cannot see it.' }, 404);
      if (!media.drive_id) return json({ error: 'This file has not finished uploading yet.' }, 409);
      return json({ url: `${PORTERO_URL}/m/${media.drive_id}` });
    }
    return json({ error: 'Not found' }, 404);
  };

  /** `set_file_drive`, como lo llama el portero. */
  private link(file: string, driveId: string): boolean {
    if (this.failLink) return false;
    const media = this.server.mediaFiles.get(file);
    if (media && !media.drive_id) media.drive_id = driveId;
    return true;
  }

  /** Vuelve a dejar pasar las partes. */
  reconnect(): void {
    this.cutAfterParts = null;
    this.parts = 0;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Los errores de `register_file` y compañía (ver supabase/migrations/20260930150000_archivos.sql). */
const pageNotFound = () => new RemoteError('page_not_found', true, 'P0002');
const fileNotFound = () => new RemoteError('file_not_found', true, 'P0002');

export class FakeRemote implements Remote, MediaRemote {
  constructor(
    readonly server: FakeServer,
    readonly appVersion = '',
  ) {}

  async fetchWorkspaceSettings(): Promise<WorkspaceSettings | null> {
    this.server.check();
    return this.server.settings && { ...this.server.settings };
  }

  async ensureWorkspace(): Promise<string | null> {
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

  // --- archivos grandes (mismas reglas que la base) ---

  async registerFile(file: NewMediaFile): Promise<void> {
    this.server.check();
    this.server.mediaCalls.push(`register_file ${file.id}`);
    const page = this.server.pages.get(file.pageId);
    if (!page) throw pageNotFound();
    const existing = this.server.mediaFiles.get(file.id);
    if (existing && existing.project_id !== page.workspace_id) throw new RemoteError('file_other_project', true, 'P0001');
    if (!existing) {
      if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(file.mime)) {
        throw new RemoteError('new row for relation "files" violates check constraint "files_mime_check"', true, '23514');
      }
      this.server.mediaFiles.set(file.id, {
        id: file.id,
        project_id: page.workspace_id,
        name: file.name,
        mime: file.mime,
        size: file.size,
        width: file.width,
        height: file.height,
        duration: file.duration,
        thumb_at: null,
        drive_id: null,
      });
    }
    this.server.pageFiles.add(`${file.pageId}:${file.id}`);
    this.server.lostMediaResponse('register_file');
  }

  async linkPageFile(pageId: string, fileId: string): Promise<void> {
    this.server.check();
    this.server.mediaCalls.push(`link_page_file ${pageId} ${fileId}`);
    const page = this.server.pages.get(pageId);
    if (!page) throw pageNotFound();
    const file = this.server.mediaFiles.get(fileId);
    if (!file) throw fileNotFound();
    if (file.project_id !== page.workspace_id) throw new RemoteError('file_other_project', true, 'P0001');
    this.server.pageFiles.add(`${pageId}:${fileId}`);
    this.server.lostMediaResponse('link_page_file');
  }

  async uploadThumb(fileId: string, data: Blob): Promise<void> {
    this.server.check();
    this.server.mediaCalls.push(`thumb ${fileId}`);
    if (!this.server.mediaFiles.has(fileId)) throw new RemoteError('new row violates row-level security policy', true, '42501');
    // Sin upsert: si ya existe, está hecho.
    if (!this.server.thumbs.has(fileId)) this.server.thumbs.set(fileId, data);
    this.server.lostMediaResponse('thumb');
  }

  async setFileThumb(fileId: string): Promise<void> {
    this.server.check();
    this.server.mediaCalls.push(`set_file_thumb ${fileId}`);
    const file = this.server.mediaFiles.get(fileId);
    if (!file) throw fileNotFound();
    file.thumb_at = new Date().toISOString();
    this.server.lostMediaResponse('set_file_thumb');
  }

  async downloadThumb(fileId: string): Promise<Blob> {
    this.server.check();
    const thumb = this.server.thumbs.get(fileId);
    if (!thumb) throw new RemoteError('Object not found', true);
    return thumb;
  }

  async fetchMediaFiles(ids: string[]): Promise<MediaFileRow[]> {
    this.server.check();
    return ids.flatMap((id) => {
      const f = this.server.mediaFiles.get(id);
      if (!f) return [];
      const { project_id: _p, size: _s, ...row } = f;
      return [{ ...row }];
    });
  }

}


/**
 * Lo que el navegador saca de un archivo, simulado: una foto o un video tienen medidas y miniatura; un HEIC
 * no (como en Chrome de Windows).
 */
export async function fakeProbe(_file: Blob, mime: string): Promise<Probe> {
  if (mime === 'image/heic') return { width: null, height: null, duration: null, thumb: null };
  const video = mime.startsWith('video/');
  return {
    width: video ? 3840 : 4032,
    height: video ? 2160 : 3024,
    duration: video ? 21.4 : null,
    thumb: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], { type: 'image/jpeg' }),
  };
}

export interface Device {
  db: LocalDb;
  tree: PageTree;
  docs: PageDocs;
  files: PageFiles;
  media: MediaQueue;
  mediaDb: MediaDb;
  engine: SyncEngine;
  remote: FakeRemote;
}

/** Un dispositivo con su propia base local. Reusar `dbName` simula cerrar y volver a abrir la app. */
export async function makeDevice(
  server: FakeServer,
  dbName: string = crypto.randomUUID(),
  appVersion = '0.021',
  docsOptions: PageDocsOptions = {},
  schemaVersion?: number,
): Promise<Device> {
  const db = await openLocalDb(dbName);
  const remote = new FakeRemote(server, appVersion);
  const tree = new PageTree(db, server.workspaceId);
  await tree.load();
  const docs = new PageDocs(db, { normalize: mergeRootGroups, seed: seedIfEmpty, ...docsOptions });
  const files = new PageFiles(db, remote);
  const mediaDb = await openMediaDb(mediaDbName(dbName));
  const media = new MediaQueue(mediaDb, remote, {
    portero: (url) => new Portero(url, { fetch: server.portero.fetch, token: async () => 'token-1', wait: async () => undefined }),
    projectOf: (pageId) => tree.get(pageId)?.workspace_id,
    probe: fakeProbe,
    playMark: async (thumb) => thumb,
    now: () => Date.now() + server.clockOffset,
  });
  await media.load();
  const engine = new SyncEngine(remote, tree, docs, files, { appVersion, schemaVersion, media });
  return { db, tree, docs, files, media, mediaDb, engine, remote };
}
