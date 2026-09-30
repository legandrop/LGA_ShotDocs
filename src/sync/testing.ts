import 'fake-indexeddb/auto';
import { mediaDbName, openMediaDb, type MediaDb } from '../media/mediaDb';
import { AccessStore, levelValue, parseAccess, type AccessSnapshot, type GrantLevel, type Role } from './access';
import { Portero } from '../media/portero';
import type { Probe } from '../media/probe';
import { MediaQueue } from '../media/queue';
import { PageDocs, type PageDocsOptions } from './docs';
import { SyncEngine } from './engine';
import { PageFiles } from './files';
import { openLocalDb, type LocalDb } from './localDb';
import type { AccessRow, InvitationGrant, MediaRemote, MemberRow, Remote, TeamRemote } from './remote';
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
  /** El dueño del workspace y creador del primer proyecto; es el usuario de los dispositivos por defecto. */
  readonly ownerId = 'owner-0000';
  readonly projects = new Map<string, ProjectRow>([
    [this.workspaceId, { id: this.workspaceId, name: 'My project', created_at: new Date(0).toISOString(), owner_id: this.ownerId }],
  ]);
  /**
   * Las reglas del paso 9 (supabase/migrations/20260930160000_equipo.sql): con `team`, las páginas y los
   * proyectos se ven y se cambian según `members` y `grants`, como en la base. Apagado, como antes.
   */
  team = false;
  readonly members = new Map<string, { email: string; role: Role; removed_at: string | null }>();
  readonly grants: { id: string; user_id: string; project_id: string | null; page_id: string | null; level: GrantLevel }[] = [];
  readonly invitations: { id: string; email: string; role: Exclude<Role, 'owner'>; grants: InvitationGrant[]; used_at: string | null }[] = [];
  /** Cómo falla la lectura de los permisos propios (para probar que nada de eso se toma por "sacado"). */
  accessFailure: null | 'network' | 'server' | 'empty' | 'weird' = null;
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
  /** El bucket `thumbs` rechaza las miniaturas para siempre (por ejemplo, por tamaño). */
  rejectThumbs = false;
  /** La base de archivos del dispositivo no se puede abrir (los dispositivos nuevos arrancan sin ella). */
  mediaDbFails = false;

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

  /** Prende las reglas del equipo: base en la versión 4, con el dueño como `owner`. */
  enableTeam(): void {
    this.team = true;
    this.settings = { ...(this.settings ?? { generation: 1, minAppVersion: null, mediaUrl: null, schemaVersion: 1 }), schemaVersion: 4 };
    if (!this.members.has(this.ownerId)) this.members.set(this.ownerId, { email: 'owner@test', role: 'owner', removed_at: null });
  }

  /** Suma un miembro activo (como si hubiera entrado con una invitación). */
  addMember(userId: string, role: Role, email = `${userId}@test`): void {
    this.members.set(userId, { email, role, removed_at: null });
  }

  /** Da o cambia un permiso (como `share`). */
  grant(userId: string, target: { projectId: string } | { pageId: string }, level: GrantLevel): string {
    const project = 'projectId' in target ? target.projectId : null;
    const page = 'pageId' in target ? target.pageId : null;
    const found = this.grants.find((g) => g.user_id === userId && g.project_id === project && g.page_id === page);
    if (found) {
      found.level = level;
      return found.id;
    }
    const id = crypto.randomUUID();
    this.grants.push({ id, user_id: userId, project_id: project, page_id: page, level });
    return id;
  }

  /** `private.workspace_role`: el rol activo, o `null`. */
  role(uid: string): Role | null {
    const m = this.members.get(uid);
    return m && !m.removed_at ? m.role : null;
  }

  /** `private.page_level`. */
  pageLevel(uid: string, pageId: string): number {
    if (!this.role(uid)) return 0;
    const page = this.pages.get(pageId);
    if (!page) return 0;
    const chain = new Set<string>();
    for (let cur: string | null = pageId; cur && !chain.has(cur); cur = this.pages.get(cur)?.parent_id ?? null) chain.add(cur);
    let level = this.projects.get(page.workspace_id)?.owner_id === uid ? 4 : 0;
    for (const g of this.grants) {
      if (g.user_id !== uid) continue;
      if (g.project_id === page.workspace_id || (g.page_id && chain.has(g.page_id))) level = Math.max(level, levelValue(g.level));
    }
    return level;
  }

  /** `private.project_level`. */
  projectLevel(uid: string, projectId: string): number {
    if (!this.role(uid)) return 0;
    let level = this.projects.get(projectId)?.owner_id === uid ? 4 : 0;
    for (const g of this.grants) {
      if (g.user_id === uid && g.project_id === projectId) level = Math.max(level, levelValue(g.level));
    }
    return level;
  }

  /** `private.can_create_page`. */
  canCreatePage(uid: string, projectId: string, parentId: string | null): boolean {
    if (!parentId) return this.projectLevel(uid, projectId) >= 4;
    return this.pageLevel(uid, parentId) >= 4 && this.pages.get(parentId)?.workspace_id === projectId;
  }

  /** `private.can_view_project_row`. */
  canViewProject(uid: string, projectId: string): boolean {
    if (!this.role(uid)) return false;
    if (this.projects.get(projectId)?.owner_id === uid || this.projectLevel(uid, projectId) >= 1) return true;
    return this.grants.some((g) => g.user_id === uid && g.page_id && this.pages.get(g.page_id)?.workspace_id === projectId);
  }

  /** `remove_member`: pone `removed_at`, no borra nada, y pasa los proyectos compartidos a un admin. */
  removeMember(uid: string): number {
    const m = this.members.get(uid);
    if (!m || m.removed_at) return 0;
    m.removed_at = new Date().toISOString();
    let moved = 0;
    for (const p of this.projects.values()) {
      if (p.owner_id !== uid) continue;
      const heir = this.grants.find(
        (g) =>
          g.user_id !== uid &&
          (this.role(g.user_id) === 'owner' || this.role(g.user_id) === 'admin') &&
          (g.project_id === p.id || (g.page_id && this.pages.get(g.page_id)?.workspace_id === p.id)),
      );
      if (heir) {
        p.owner_id = heir.user_id;
        moved++;
      }
    }
    return moved;
  }
}

export const PORTERO_URL = 'https://portero.test';

interface FakeUpload {
  file: string;
  size: number;
  data: Uint8Array;
  received: number;
  done?: { id: string; name: string; mimeType: string; size: number };
  /** Subida de un portero anterior al paso 6 (ver `FakePortero.legacy`). */
  legacy?: boolean;
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
  /**
   * Un portero anterior al paso 6: ignora `file`, sube igual, responde `done` sin `linked` y no le avisa a
   * la base.
   */
  legacy = false;
  /** Responde `linked: true` pero la base no quedó con el id de Drive. */
  lieLinked = false;
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

    if (method === 'POST' && url.pathname === '/upload' && this.legacy) {
      const uploadId = `up-${this.next++}`;
      const size = Number(body?.size);
      this.uploads.set(uploadId, { file: String(body?.file ?? ''), size, data: new Uint8Array(size), received: 0, legacy: true });
      return json({ uploadId });
    }
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
      if (up.done && up.legacy) return json({ status: 'done', file: up.done });
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
        if (up.legacy) {
          // A `Media_Test`, sin la marca del archivo ni aviso a la base.
          this.drive.set(driveId, { file: '', data: up.data, folder: 'LGA_ShotDocs/Media_Test', name: media.name });
          return json({ status: 'done', file: up.done });
        }
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
    if (this.lieLinked) return true;
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

const ROLE_RANK: Record<Role, number> = { guest: 1, member: 2, admin: 3, owner: 4 };

/** Los errores de `register_file` y compañía (ver supabase/migrations/20260930150000_archivos.sql). */
const pageNotFound = () => new RemoteError('page_not_found', true, 'P0002');
const fileNotFound = () => new RemoteError('file_not_found', true, 'P0002');

export class FakeRemote implements Remote, MediaRemote, TeamRemote {
  /** La sesión: por defecto, el dueño del workspace. */
  readonly userId: string;
  readonly email: string;

  constructor(
    readonly server: FakeServer,
    readonly appVersion = '',
    userId?: string,
    email?: string,
  ) {
    this.userId = userId ?? server.ownerId;
    this.email = (email ?? server.members.get(this.userId)?.email ?? `${this.userId}@test`).toLowerCase();
  }

  private get team(): boolean {
    return this.server.team;
  }

  private denied(message: string): RemoteError {
    return new RemoteError(message, true, '42501');
  }

  async fetchWorkspaceSettings(): Promise<WorkspaceSettings | null> {
    this.server.check();
    return this.server.settings && { ...this.server.settings };
  }

  async ensureWorkspace(): Promise<string | null> {
    this.server.check();
    if (!this.team) return this.server.workspaceId;
    const uid = this.userId;
    if (!this.server.role(uid)) return null;
    const byAge = [...this.server.projects.values()].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    const own = byAge.find((p) => p.owner_id === uid);
    if (own) return own.id;
    const project = byAge.find((p) => this.server.grants.some((g) => g.user_id === uid && g.project_id === p.id));
    if (project) return project.id;
    const page = byAge.find((p) => this.server.canViewProject(uid, p.id));
    return page?.id ?? null;
  }

  async fetchTree(projectIds: string[]): Promise<PageRow[]> {
    this.server.check();
    const ids = new Set(projectIds);
    return [...this.server.pages.values()]
      .filter((p) => ids.has(p.workspace_id))
      .filter((p) => !this.team || this.server.projectLevel(this.userId, p.workspace_id) >= 1 || this.server.pageLevel(this.userId, p.id) >= 1)
      .map((p) => ({ ...p }));
  }

  async fetchProjects(): Promise<ProjectRow[]> {
    this.server.check();
    return [...this.server.projects.values()]
      .filter((p) => !this.team || this.server.canViewProject(this.userId, p.id))
      .map((p) => ({ ...p }));
  }

  async createProject(project: NewProject): Promise<void> {
    this.server.check();
    if (this.server.projects.has(project.id)) return;
    const role = this.server.role(this.userId);
    if (this.server.rejectProjects || (this.team && role !== 'owner' && role !== 'admin')) {
      throw new RemoteError('new row violates row-level security policy for table "workspaces"', true, '42501');
    }
    this.server.projects.set(project.id, { ...project, created_at: new Date().toISOString(), owner_id: this.userId });
  }

  async renameProject(id: string, name: string): Promise<void> {
    this.server.check();
    const project = this.server.projects.get(id);
    if (!project || (this.team && this.server.projectLevel(this.userId, id) < 4)) {
      throw new RemoteError('project_not_found', true, 'P0002');
    }
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
    if (this.team && !this.server.canCreatePage(this.userId, page.workspace_id, page.parent_id)) {
      throw this.denied('page_create_denied');
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
    if (this.team) {
      const uid = this.userId;
      // La política de update pide 3: sin eso, la fila no se ve y el update no toca nada.
      if (this.server.pageLevel(uid, id) < 3) throw new RemoteError('page_not_found', true, 'P0002');
      const parentId = patch.parent_id !== undefined ? patch.parent_id : page.parent_id;
      const moves = parentId !== page.parent_id || (patch.sort_key !== undefined && patch.sort_key !== page.sort_key);
      if (moves && (this.server.pageLevel(uid, id) < 4 || !this.server.canCreatePage(uid, page.workspace_id, parentId))) {
        throw this.denied('page_move_denied');
      }
      if (patch.deleted_at !== undefined && patch.deleted_at !== page.deleted_at && this.server.pageLevel(uid, id) < 4) {
        throw this.denied('page_trash_denied');
      }
    }
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
    if (!page || (this.team && this.server.pageLevel(this.userId, pageId) < 3)) {
      throw new RemoteError('page_not_found', true, 'P0002');
    }
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
    if (!this.server.pages.has(pageId) || (this.team && this.server.pageLevel(this.userId, pageId) < 1)) {
      throw new RemoteError('page_not_found', true, 'P0002');
    }
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

  // --- equipo (mismas reglas que supabase/migrations/20260930160000_equipo.sql) ---

  async fetchMyAccess(userId: string): Promise<AccessSnapshot | null> {
    this.server.check();
    if (!this.team) return null;
    switch (this.server.accessFailure) {
      case 'network':
        throw new RemoteError('Failed to fetch', false, undefined, true);
      case 'server':
        throw new RemoteError('Internal Server Error', false, '500');
      case 'empty':
        return parseAccess(null, []);
      case 'weird':
        try {
          return parseAccess({ role: 'captain', removed_at: 12 }, 'nope');
        } catch (err) {
          throw new RemoteError(String(err), false);
        }
    }
    const m = this.server.members.get(userId);
    return parseAccess(
      m ? { role: m.role, removed_at: m.removed_at } : null,
      this.server.grants.filter((g) => g.user_id === userId).map(({ user_id: _u, ...g }) => g),
    );
  }

  async acceptInvitations(): Promise<number | null> {
    this.server.check();
    if (!this.team) return null;
    const uid = this.userId;
    let n = 0;
    for (const inv of this.server.invitations) {
      if (inv.used_at || inv.email !== this.email) continue;
      const cur = this.server.members.get(uid);
      if (!cur) this.server.members.set(uid, { email: this.email, role: inv.role, removed_at: null });
      else if (cur.removed_at) {
        // Vuelve sin los permisos de antes.
        for (let i = this.server.grants.length - 1; i >= 0; i--) if (this.server.grants[i].user_id === uid) this.server.grants.splice(i, 1);
        this.server.members.set(uid, { ...cur, role: inv.role, removed_at: null });
      } else if (cur.role !== 'owner' && ROLE_RANK[inv.role] > ROLE_RANK[cur.role]) {
        cur.role = inv.role;
      }
      for (const g of inv.grants) {
        const target = 'project_id' in g ? { projectId: g.project_id } : { pageId: g.page_id };
        const existing = this.server.grants.find(
          (x) => x.user_id === uid && ('projectId' in target ? x.project_id === target.projectId : x.page_id === target.pageId),
        );
        if (!existing || levelValue(g.level) > levelValue(existing.level)) this.server.grant(uid, target, g.level);
      }
      inv.used_at = new Date().toISOString();
      n++;
    }
    return n;
  }

  async listMembers(): Promise<MemberRow[]> {
    this.server.check();
    const admin = ['owner', 'admin'].includes(this.server.role(this.userId) ?? '');
    return [...this.server.members]
      .filter(([id]) => admin || id === this.userId)
      .map(([id, m]) => ({ user_id: id, email: m.email, role: m.role, created_at: '', removed_at: m.removed_at }));
  }

  async createInvitation(email: string, role: Exclude<Role, 'owner'>, grants: InvitationGrant[]): Promise<string> {
    this.server.check();
    const mine = this.server.role(this.userId);
    if (mine !== 'owner' && mine !== 'admin') throw this.denied('not_allowed');
    if (role === 'admin' && mine !== 'owner') throw this.denied('not_allowed');
    for (const g of grants) {
      const level = 'project_id' in g ? this.server.projectLevel(this.userId, g.project_id) : this.server.pageLevel(this.userId, g.page_id);
      if (level < 4) throw this.denied('grant_not_allowed');
    }
    const em = email.trim().toLowerCase();
    const live = this.server.invitations.find((i) => i.email === em && !i.used_at);
    if (live) {
      if (ROLE_RANK[role] > ROLE_RANK[live.role]) live.role = role;
      live.grants.push(...grants);
      return live.id;
    }
    const id = crypto.randomUUID();
    this.server.invitations.push({ id, email: em, role, grants: [...grants], used_at: null });
    return id;
  }

  async setMemberRole(userId: string, role: Exclude<Role, 'owner'>): Promise<void> {
    this.server.check();
    const mine = this.server.role(this.userId);
    const cur = this.server.members.get(userId);
    if (mine !== 'owner' && mine !== 'admin') throw this.denied('not_allowed');
    if (!cur || cur.removed_at) throw new RemoteError('member_not_found', true, 'P0002');
    if (cur.role === 'owner') throw this.denied('owner_cannot_change');
    if ((cur.role === 'admin' || role === 'admin') && mine !== 'owner') throw this.denied('not_allowed');
    cur.role = role;
  }

  async removeMember(userId: string): Promise<number> {
    this.server.check();
    const mine = this.server.role(this.userId);
    const cur = this.server.members.get(userId);
    if (mine !== 'owner' && mine !== 'admin') throw this.denied('not_allowed');
    if (!cur) throw new RemoteError('member_not_found', true, 'P0002');
    if (cur.role === 'owner') throw this.denied('owner_cannot_change');
    if (cur.role === 'admin' && mine !== 'owner') throw this.denied('not_allowed');
    return this.server.removeMember(userId);
  }

  async share(userId: string, target: { projectId: string } | { pageId: string }, level: GrantLevel): Promise<string> {
    this.server.check();
    if (!this.canShare(target)) throw this.denied('not_allowed');
    if (!this.server.role(userId)) throw new RemoteError('member_not_found', true, 'P0002');
    return this.server.grant(userId, target, level);
  }

  async unshare(grantId: string): Promise<void> {
    this.server.check();
    const at = this.server.grants.findIndex((g) => g.id === grantId);
    const g = this.server.grants[at];
    if (!g || !this.canShare(g.project_id ? { projectId: g.project_id } : { pageId: g.page_id! })) {
      throw new RemoteError('grant_not_found', true, 'P0002');
    }
    this.server.grants.splice(at, 1);
  }

  async listAccess(target: { projectId: string } | { pageId: string }): Promise<AccessRow[]> {
    this.server.check();
    if (!this.canShare(target)) throw this.denied('not_allowed');
    const projectId = 'projectId' in target ? target.projectId : this.server.pages.get(target.pageId)!.workspace_id;
    const chain = new Set<string>();
    if ('pageId' in target) {
      for (let cur: string | null = target.pageId; cur && !chain.has(cur); cur = this.server.pages.get(cur)?.parent_id ?? null) chain.add(cur);
    }
    const rows: AccessRow[] = [];
    const add = (uid: string, level: GrantLevel, source: AccessRow['source'], grant: string | null, project: string | null, page: string | null) => {
      const m = this.server.members.get(uid);
      if (m && !m.removed_at) rows.push({ user_id: uid, email: m.email, role: m.role, level, source, grant_id: grant, project_id: project, page_id: page });
    };
    const owner = this.server.projects.get(projectId)?.owner_id;
    if (owner) add(owner, 'edit_pages', 'creator', null, projectId, null);
    for (const g of this.server.grants) {
      if (g.project_id === projectId) add(g.user_id, g.level, 'project', g.id, g.project_id, null);
      else if (g.page_id && chain.has(g.page_id)) {
        add(g.user_id, g.level, 'pageId' in target && g.page_id === target.pageId ? 'page' : 'parent_page', g.id, null, g.page_id);
      }
    }
    return rows;
  }

  /** `private.can_share`. */
  private canShare(target: { projectId: string } | { pageId: string }): boolean {
    const uid = this.userId;
    const role = this.server.role(uid);
    if (!role) return false;
    const projectId = 'projectId' in target ? target.projectId : this.server.pages.get(target.pageId)?.workspace_id;
    if (!projectId) return false;
    const level = 'projectId' in target ? this.server.projectLevel(uid, projectId) : this.server.pageLevel(uid, target.pageId);
    return level >= 4 && (role === 'owner' || role === 'admin' || this.server.projects.get(projectId)?.owner_id === uid);
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
    if (this.server.rejectThumbs) throw new RemoteError('The object exceeded the maximum allowed size', true);
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
  access: AccessStore;
}

/** Un dispositivo con su propia base local. Reusar `dbName` simula cerrar y volver a abrir la app. */
export async function makeDevice(
  server: FakeServer,
  dbName: string = crypto.randomUUID(),
  appVersion = '0.021',
  docsOptions: PageDocsOptions = {},
  schemaVersion?: number,
  /** La persona que usa el dispositivo; por defecto, el dueño del workspace. */
  user: { id?: string; email?: string } = {},
): Promise<Device> {
  const db = await openLocalDb(dbName);
  const remote = new FakeRemote(server, appVersion, user.id, user.email);
  const access = new AccessStore(db, remote.userId);
  await access.load();
  const tree = new PageTree(db, (server.team ? await remote.ensureWorkspace().catch(() => null) : null) ?? server.workspaceId);
  await tree.load();
  const docs = new PageDocs(db, { normalize: mergeRootGroups, seed: seedIfEmpty, ...docsOptions });
  const files = new PageFiles(db, remote);
  const mediaDb = await openMediaDb(mediaDbName(dbName));
  const media = new MediaQueue(server.mediaDbFails ? null : mediaDb, remote, {
    portero: (url) => new Portero(url, { fetch: server.portero.fetch, token: async () => 'token-1', wait: async () => undefined }),
    projectOf: (pageId) => tree.get(pageId)?.workspace_id,
    probe: fakeProbe,
    playMark: async (thumb) => thumb,
    now: () => Date.now() + server.clockOffset,
  });
  await media.load();
  const engine = new SyncEngine(remote, tree, docs, files, { appVersion, schemaVersion, media, access });
  return { db, tree, docs, files, media, mediaDb, engine, remote, access };
}
