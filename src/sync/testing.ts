import 'fake-indexeddb/auto';
import { wrap } from 'idb';
import { mediaDbName, openMediaDb, type MediaDb } from '../media/mediaDb';
import { AccessStore, levelValue, parseAccess, Permissions, type AccessSnapshot, type GrantLevel, type Role } from './access';
import { Portero, type PartSender } from '../media/portero';
import type { Probe } from '../media/probe';
import { OfflineManager } from '../media/offline';
import { ProjectSizes } from '../media/projectSizes';
import { MediaQueue } from '../media/queue';
import { PageDocs, type PageDocsOptions } from './docs';
import { SyncEngine } from './engine';
import { PageFiles } from './files';
import { openLocalDb, type LocalDb } from './localDb';
import {
  PROJECT_DRIVE_SCHEMA_VERSION,
  PROJECT_STATES_SCHEMA_VERSION,
  type AccessRow,
  type InvitationGrant,
  type InvitationRow,
  type LinkResult,
  type MediaRemote,
  type MemberRow,
  type HistoryAuthor,
  type HistoryRemote,
  type ProjectStatesRemote,
  type Remote,
  type TeamRemote,
} from './remote';
import type { HistoryRow } from './history';
import {
  CommentQueue,
  commentsDbName,
  openCommentsDb,
  type CommentAuthor,
  type CommentRemote,
  type CommentRow,
  type CommentsDb,
  type ImportedComment,
  type NewComment,
} from './comments';
import { normalizeStructure, seedIfEmpty } from './structure';
import { PageTree } from './tree';
import {
  RemoteError,
  type DueFileRow,
  type MediaFileRow,
  type PageUseRow,
  type TrashedFileRow,
  type NewMediaFile,
  type ProjectSizeRow,
  type NewPage,
  type NewProject,
  type PagePatch,
  type PageRow,
  type ProjectRow,
  type ProjectDeleteInfo,
  type RemoteUpdate,
  type TrashedProjectRow,
  type WorkspaceSettings,
} from './types';

/**
 * La primera versión de la app que manda su versión en el header (`x-shotdocs-version`): en la base, el número de
 * `private.write_version_allowed` (supabase/migrations/20261008120000_version_minima_arbol.sql). Acá es un número de
 * modelo, más alto que todas las versiones publicadas sin header (hasta la 0.098); las pruebas suben la mínima a este
 * número, o a uno más bajo, para ver cada caso.
 */
export const WRITE_VERSION_SINCE = 0.099;

/** Una fila de `comments` en el servidor en memoria: con el texto aunque se haya borrado, como la tabla. */
type StoredComment = CommentRow & { body: string; updated_at?: string };

/** Servidor en memoria con las mismas reglas que el de Supabase (ver supabase/migrations). */
export class FakeServer {
  online = true;
  /** Guarda el próximo update pero hace como si la respuesta se hubiera perdido. */
  loseNextPushResponse = false;
  /** Como una base sin la migración del historial: `page_history` no existe (PGRST202). */
  historyMissing = false;
  /** Rechaza las creaciones de páginas como si faltaran permisos. */
  rejectCreates = false;
  /** Tope de tamaño de un update, como en push_page_update (8 MB). */
  maxUpdateBytes = 8 * 1024 * 1024;
  /** Hace fallar las subidas de archivos como si se cortara la red. */
  failUploads = false;
  /**
   * Lo que responde `project_sizes` (P.7) a cualquier sesión, tal cual; `null`, como una base sin la función.
   * El servidor en memoria no lo calcula: las reglas están probadas en supabase/tests/peso_proyectos_permisos.sql.
   */
  sizes: ProjectSizeRow[] | null = null;
  /** Cuántas veces se pidió `project_sizes`. */
  sizesCalls = 0;
  readonly pages = new Map<string, PageRow>();
  /**
   * Las filas de `page_updates` de cada página. `id`, `createdBy` y `createdAt` los pone el servidor al subir (como la
   * base con `auth.uid()` y `now()`); una prueba que carga filas a mano puede dejarlos afuera.
   */
  readonly updates = new Map<
    string,
    { seq: number; clientUpdateId: string; data: Uint8Array; id?: number; createdBy?: string | null; createdAt?: string }[]
  >();
  /** El contador de `page_updates.id` (nunca vuelve atrás). */
  private updateIds = 0;
  /** El reloj del servidor (`now()`): las pruebas del historial lo mueven. */
  now: () => number = () => Date.now();
  nextUpdateId(): number {
    return ++this.updateIds;
  }
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
  readonly invitations: {
    id: string;
    email: string;
    role: Exclude<Role, 'owner'>;
    grants: InvitationGrant[];
    used_at: string | null;
    invited_by?: string;
    revoked_at?: string | null;
  }[] = [];
  /** Simula una base sin `list_invitations`/`revoke_invitation` (PGRST202). */
  noInvitationList = false;
  /** Cómo falla la lectura de los permisos propios (para probar que nada de eso se toma por "sacado"). */
  accessFailure: null | 'network' | 'server' | 'empty' | 'weird' = null;
  /** Rechaza la creación de proyectos como si faltaran permisos. */
  rejectProjects = false;
  /** Para darle a cada restauración una generación nunca usada. */
  static generations = 100;
  /** `workspace_settings`; `null` simula una base sin esa migración. */
  settings: WorkspaceSettings | null = { generation: 1, minAppVersion: null, schemaVersion: 1, mediaUrl: null };
  /**
   * La versión mínima frena el árbol y los comentarios (20261008120000_version_minima_arbol.sql): sin header, solo con
   * una mínima de este número o más. `null` simula una base sin esa migración (el header se ignora).
   */
  writeVersionSince: number | null = WRITE_VERSION_SINCE;
  /** `files`, con el proyecto (sale de la página), el tamaño y quién lo registró. */
  readonly mediaFiles = new Map<string, MediaFileRow & { project_id: string; size: number; created_by?: string }>();
  /** `page_files` en uso (sin `removed_at`): `<página>:<archivo>`. */
  readonly pageFiles = new Set<string>();
  /** `page_files` con `removed_at` (la página dejó de usar el archivo; la fila queda). */
  readonly removedPageFiles = new Set<string>();
  /**
   * Usos ajenos (`<página>:<archivo>` de otro proyecto, `page_files.is_foreign`): `link_page_file` y
   * `register_file` los guardan, cuentan como uso para la papelera y devuelven `'file_other_project'`.
   */
  readonly foreignPageFiles = new Set<string>();
  /** El `p_seen_seq` de cada `unlink_page_file`, en orden. */
  readonly seenSeqs: (number | null)[] = [];
  /** Los avisos de "foto de otro proyecto" que mostraron los dispositivos (nombre del archivo o `null`). */
  readonly foreignNotices: (string | null)[] = [];
  /** El bucket `thumbs`. */
  readonly thumbs = new Map<string, Blob>();
  /** Cuántas veces se llamó cada función de archivos (para ver que no se llama de más). */
  readonly mediaCalls: string[] = [];
  /** El portero del workspace, en memoria. */
  readonly portero = new FakePortero(this);
  /**
   * El almacenamiento del navegador para "Available offline" (`estimate()`, `persist()`); sin esto, el navegador
   * no dice cuánto hay (se prueba igual).
   */
  storage: { estimate: () => Promise<StorageEstimate>; persist: () => Promise<boolean>; persisted: () => Promise<boolean> } | undefined =
    undefined;
  /** Funciones de archivos que hacen su trabajo y después pierden la respuesta, una vez cada una. */
  readonly loseMediaResponse = new Set<string>();
  /** Cuánto adelantar el reloj de la cola de archivos (para no esperar de verdad entre reintentos). */
  clockOffset = 0;
  /** El bucket `thumbs` rechaza las miniaturas para siempre (por ejemplo, por tamaño). */
  rejectThumbs = false;
  /** La base de archivos del dispositivo no se puede abrir (los dispositivos nuevos arrancan sin ella). */
  mediaDbFails = false;
  /** Cómo convierten los dispositivos un HEIC a JPEG (por defecto `fakeConvertHeic`; las pruebas lo cambian). */
  convertHeic: (file: Blob) => Promise<Blob> = fakeConvertHeic;
  /** Lo más que la cola espera una conversión (por defecto, el de la app). */
  heicTimeoutMs?: number;
  /** Lo que el navegador saca de un archivo (por defecto `fakeProbe`; las pruebas lo cambian). */
  probe: (file: Blob, mime: string) => Promise<Probe> = fakeProbe;
  /**
   * La vista previa de un adjunto (Docs/Doc_Adjuntos.md, entrega 2). Por defecto ninguna (node no tiene canvas);
   * las pruebas ponen `fakePreview` o una que tira `PreviewUnavailable`.
   */
  preview: (file: Blob, mime: string, name: string, onStart?: () => Promise<boolean>) => Promise<Blob | null> = async () => null;
  /** `comments`, con el texto aunque se haya borrado (como la tabla; la vista lo devuelve vacío). */
  readonly comments = new Map<string, StoredComment>();
  /** La base tiene `import_comment` (versión 8); apagado, la función no existe (PGRST202). */
  importCommentsEnabled = false;
  /** La base tiene `list_comments` (bajar solo lo cambiado); apagado, la app lee la vista entera. */
  listCommentsEnabled = false;
  /** Las funciones de comentarios que se llamaron, en orden (`add <id>`, `edit <id>`...). */
  readonly commentCalls: string[] = [];
  /** Funciones de comentarios que hacen su trabajo y después pierden la respuesta, una vez cada una. */
  readonly loseCommentResponse = new Set<'add' | 'edit' | 'delete' | 'resolve' | 'import'>();
  /** Las funciones de comentarios fallan como un 500 (se arregla solo). */
  commentsServerError = false;
  private commentClock = 0;

  /**
   * La papelera de proyectos (P.14): id → cuándo y quién lo borró. Con el proyecto acá, todos los niveles dan 0
   * y no se ve por ningún camino, como en la base (`user_page_level`, `workspaces_select`).
   */
  readonly deletedProjects = new Map<string, { at: string; by: string }>();

  /**
   * La carpeta de cada proyecto en la papelera de Drive (P.14, entrega 2, versión 10): pedida, confirmada y, si se
   * restauró sin ella, cuándo. Las pruebas la ponen como lo haría el portero.
   */
  readonly projectDrive = new Map<string, { requested_at: string; trashed_at: string | null; missing_at: string | null }>();

  /** Prende la carpeta de un proyecto en la papelera de Drive: la base en la versión 10. */
  enableProjectDrive(): void {
    this.enableProjectStates();
    this.settings = { ...this.settings!, schemaVersion: Math.max(this.settings!.schemaVersion, PROJECT_DRIVE_SCHEMA_VERSION) };
  }

  /** Prende archivar y borrar proyectos: la base en la versión 9. */
  enableProjectStates(): void {
    this.settings = {
      ...(this.settings ?? { generation: 1, minAppVersion: null, schemaVersion: 1, mediaUrl: null }),
      schemaVersion: Math.max(this.settings?.schemaVersion ?? 1, PROJECT_STATES_SCHEMA_VERSION),
    };
  }

  projectDeleted(projectId: string | undefined): boolean {
    return !!projectId && this.deletedProjects.has(projectId);
  }

  /** La página es de un proyecto borrado. */
  pageInDeletedProject(pageId: string): boolean {
    return this.projectDeleted(this.pages.get(pageId)?.workspace_id);
  }

  /** `private.can_manage_project` (sin mirar el borrado). Sin las reglas del equipo, solo el dueño. */
  canManageProject(uid: string, projectId: string): boolean {
    if (!this.team) return uid === this.ownerId;
    const role = this.role(uid);
    return (
      this.projectLevel(uid, projectId, true) >= 4 &&
      (role === 'owner' || role === 'admin' || this.projects.get(projectId)?.owner_id === uid)
    );
  }

  /** Lo veía (sin mirar el borrado). Sin las reglas del equipo, todos. */
  couldViewProject(uid: string, projectId: string): boolean {
    if (!this.projects.has(projectId)) return false;
    return !this.team || this.canViewProject(uid, projectId, true);
  }

  /** Prende los comentarios: la base en la versión 5 (y las reglas del equipo, que la versión 5 incluye). */
  enableComments(): void {
    this.enableTeam();
    this.settings = { ...this.settings!, schemaVersion: 5 };
  }

  /** Prende los comentarios importados: la base en la versión 8 (`import_comment`). */
  enableImportedComments(): void {
    this.enableComments();
    this.importCommentsEnabled = true;
    this.settings = { ...this.settings!, schemaVersion: 8 };
  }

  /** Una hora del servidor que siempre avanza (para el orden de los comentarios). */
  commentNow(): string {
    return new Date(Date.UTC(2026, 8, 30, 12) + ++this.commentClock * 1000).toISOString();
  }

  /** Pierde la respuesta de una función de archivos si se pidió. */
  lostMediaResponse(name: string): void {
    if (this.loseMediaResponse.delete(name)) throw new RemoteError('Failed to fetch', false, undefined, true);
  }

  /**
   * Prende la papelera de archivos: portero, reglas del equipo y la base en la versión 6
   * (supabase/migrations/20260930180000_papelera_archivos.sql), con el borrado automático apagado.
   */
  enableTrash(): void {
    this.enableTeam();
    this.settings = { ...this.settings!, schemaVersion: 6, mediaUrl: PORTERO_URL, autoPurgeFiles: false };
  }

  /** El peso de los proyectos (P.7): base en la versión 7, con la papelera, y `project_sizes` sin filas. */
  enableSizes(rows: ProjectSizeRow[] = []): void {
    this.enableTrash();
    this.settings = { ...this.settings!, schemaVersion: 7 };
    this.sizes = rows;
  }

  /** `private.page_alive`: la página existe y ni ella ni ninguna de arriba está en la papelera de páginas. */
  pageAlive(pageId: string): boolean {
    // Una página de un proyecto borrado no está viva (P.14): sus archivos entran a la papelera.
    if (this.pageInDeletedProject(pageId)) return false;
    const seen = new Set<string>();
    for (let cur: string | null = pageId; cur && !seen.has(cur); ) {
      seen.add(cur);
      const page = this.pages.get(cur);
      if (!page || page.deleted_at) return false;
      cur = page.parent_id;
    }
    return true;
  }

  /**
   * `private.refresh_file_trash`: entra a la papelera (con la hora de ahora) si ninguna página viva lo usa y
   * sale si alguna lo usa. Uno con `purged_at` no cambia más.
   */
  refreshFileTrash(fileId: string): void {
    const f = this.mediaFiles.get(fileId);
    if (!f || f.purged_at) return;
    const used = [...this.pageFiles, ...this.foreignPageFiles].some(
      (k) => k.endsWith(`:${fileId}`) && this.pageAlive(k.slice(0, k.indexOf(':'))),
    );
    if (used) f.trashed_at = null;
    else if (!f.trashed_at) f.trashed_at = new Date().toISOString();
  }

  /** Si lo usa una página que está en la papelera de páginas (ella o una de arriba), y su título. */
  trashedPageUse(fileId: string): { in_trashed_page: boolean; trashed_page_title: string | null } {
    for (const k of this.pageFiles) {
      if (!k.endsWith(`:${fileId}`)) continue;
      const pageId = k.slice(0, k.indexOf(':'));
      if (this.pages.has(pageId) && !this.pageAlive(pageId)) {
        return { in_trashed_page: true, trashed_page_title: this.pages.get(pageId)!.title };
      }
    }
    return { in_trashed_page: false, trashed_page_title: null };
  }

  /** Los triggers de `pages`: una página entra, sale o se mueve de la papelera de páginas. */
  refreshAllFileTrash(): void {
    for (const id of this.mediaFiles.keys()) this.refreshFileTrash(id);
  }

  /** `private.can_see_file_trash`. Sin las reglas del equipo, solo el dueño. */
  canSeeFileTrash(uid: string, projectId: string): boolean {
    if (!this.team) return uid === this.ownerId;
    const role = this.role(uid);
    return this.projectLevel(uid, projectId) >= 4 || ((role === 'owner' || role === 'admin') && this.projectLevel(uid, projectId) >= 1);
  }

  /** `private.can_purge_files`. Sin las reglas del equipo, solo el dueño. */
  canPurgeFiles(uid: string, projectId: string): boolean {
    if (!this.team) return uid === this.ownerId;
    const role = this.role(uid);
    return (role === 'owner' || role === 'admin') && this.projectLevel(uid, projectId) >= 1;
  }

  /** `purge_file`, como lo llama el portero con la sesión de la persona. */
  purgeFile(uid: string, fileId: string): void {
    const f = this.mediaFiles.get(fileId);
    if (!f) throw fileNotFound();
    if (!this.canPurgeFiles(uid, f.project_id)) throw new RemoteError('not_allowed', true, '42501');
    if (!f.trashed_at) throw new RemoteError('file_not_trashed', true, 'P0001');
    if (!f.purged_at && this.fileInDeletedProject(fileId)) throw new RemoteError('file_in_deleted_project', true, 'P0001');
    f.purged_at ??= new Date().toISOString();
  }

  /** `private.file_in_deleted_project` (P.14): lo usa una página de un proyecto borrado. */
  fileInDeletedProject(fileId: string): boolean {
    return [...this.pageFiles, ...this.foreignPageFiles].some(
      (k) => k.endsWith(`:${fileId}`) && this.pageInDeletedProject(k.slice(0, k.indexOf(':'))),
    );
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
    const comments = new Map([...this.comments].map(([id, c]) => [id, { ...c }]));
    /** Restaura la copia y sube la generación, como scripts/restore.sh del repo de copias. */
    return () => {
      this.comments.clear();
      for (const [id, c] of comments) this.comments.set(id, { ...c });
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
  pageLevel(uid: string, pageId: string, ignoreDeleted = false): number {
    if (!this.role(uid)) return 0;
    const page = this.pages.get(pageId);
    if (!page) return 0;
    if (!ignoreDeleted && this.projectDeleted(page.workspace_id)) return 0;
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
  projectLevel(uid: string, projectId: string, ignoreDeleted = false): number {
    if (!this.role(uid)) return 0;
    if (!ignoreDeleted && this.projectDeleted(projectId)) return 0;
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
  canViewProject(uid: string, projectId: string, ignoreDeleted = false): boolean {
    if (!this.role(uid)) return false;
    if (!ignoreDeleted && this.projectDeleted(projectId)) return false;
    if (this.projects.get(projectId)?.owner_id === uid || this.projectLevel(uid, projectId, ignoreDeleted) >= 1) return true;
    return this.grants.some((g) => g.user_id === uid && g.page_id && this.pages.get(g.page_id)?.workspace_id === projectId);
  }

  /**
   * `remove_member`: pone `removed_at`, no borra nada, y pasa cada proyecto compartido a un dueño o admin
   * con permiso sobre el proyecto entero (gana `edit_pages`). Compartido solo por páginas: sin heredero.
   */
  removeMember(uid: string): { transferred: number; withoutHeir: number } {
    const m = this.members.get(uid);
    if (!m || m.removed_at) return { transferred: 0, withoutHeir: 0 };
    m.removed_at = new Date().toISOString();
    let transferred = 0;
    let withoutHeir = 0;
    const rank = { view: 1, comment: 2, edit: 3, edit_pages: 4 } as Record<string, number>;
    for (const p of this.projects.values()) {
      if (p.owner_id !== uid) continue;
      const others = this.grants.filter(
        (g) => g.user_id !== uid && (g.project_id === p.id || (g.page_id && this.pages.get(g.page_id)?.workspace_id === p.id)),
      );
      if (others.length === 0) continue;
      const heir = others
        .filter((g) => g.project_id === p.id && (this.role(g.user_id) === 'owner' || this.role(g.user_id) === 'admin'))
        .sort((a, b) => (rank[b.level] ?? 0) - (rank[a.level] ?? 0))[0];
      if (heir) {
        p.owner_id = heir.user_id;
        transferred++;
      } else withoutHeir++;
    }
    return { transferred, withoutHeir };
  }
}

export const PORTERO_URL = 'https://portero.test';

/** El usuario de un pedido al portero en memoria (`Bearer token:<usuario>`; si no, el dueño). */
function porteroUser(server: FakeServer, headers: Headers): string {
  return /^Bearer token:(.+)$/.exec(headers.get('Authorization') ?? '')?.[1] ?? server.ownerId;
}

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
  /** Los pedidos de subida nunca contestan (sin error de red) hasta que se abortan. */
  hang = false;
  /**
   * Lo que pasa mientras sale una parte (pruebas del vigilante): la prueba avisa con `sent` cuántos bytes
   * van saliendo y la parte recién le llega al portero cuando la promesa se resuelve. Una promesa que nunca
   * se resuelve es una parte colgada. Sin esto, la parte sale entera al instante.
   */
  partDelay: ((part: { uploadId: string; size: number; sent: (bytes: number) => void }) => Promise<void>) | null = null;
  /** La parte le llega al portero (y a Drive) pero la respuesta nunca vuelve. */
  loseAnswer = false;
  /** La base apunta a otro archivo de Drive (409 que no se arregla solo). */
  conflict = false;
  /**
   * Un portero anterior al paso 6: ignora `file`, sube igual, responde `done` sin `linked` y no le avisa a
   * la base.
   */
  legacy = false;
  /** Responde `linked: true` pero la base no quedó con el id de Drive. */
  lieLinked = false;
  /** Los archivos de Drive que `/trash` mandó a la papelera de Drive (nunca se borra nada). */
  readonly driveTrash = new Set<string>();
  /** Archivos de la app para los que Drive falla al mandarlos a la papelera (502, sin confirmar). */
  readonly failTrash = new Set<string>();
  /** El Drive del dueño no está conectado: `/trash` responde 503 con `code: 'drive_not_connected'`. */
  driveDisconnected = false;
  /** Lo que dice que entiende (`/drive/status`): el de la entrega 0 de P.10. Vacío: un portero anterior. */
  features: string[] = ['verify', 'known', 'offline', 'codes'];
  /** Archivos que la persona ya no puede ver (`not_found`): un permiso quitado. */
  readonly hidden = new Set<string>();
  /** Pases (ids de Drive) que la próxima vez responden como vencidos. */
  readonly expiredPasses = new Set<string>();
  /** Sin `?offline=1`, las partes salen de este largo como mucho (la caché del arranque del portero). */
  shortParts = 0;
  /** No hace caso del `Range` (un portero muy viejo): siempre el archivo entero. */
  ignoreRanges = false;
  /** Un portero anterior a la entrega 0 de P.10: no conoce `?offline=1` (la caché del arranque corta igual). */
  oldOffline = false;
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
    if (this.hang && url.pathname.startsWith('/upload')) {
      return new Promise<Response>((_, reject) =>
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }),
      );
    }

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
      if (this.conflict) {
        return json({ error: 'This file is registered with a different Drive file: ask the workspace owner.' }, 409);
      }
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
    if (method === 'POST' && url.pathname === '/trash') {
      // Como portero/src/core.ts (`trashFile`): `purge_file` con la sesión, recién ahí Drive, y al final
      // `media_purged`.
      const id = String(body?.file ?? '').toLowerCase();
      const uid = porteroUser(this.server, headers);
      if (this.driveDisconnected) {
        return json({ error: 'Google Drive is not connected yet.', code: 'drive_not_connected' }, 503);
      }
      try {
        this.server.purgeFile(uid, id);
      } catch (err) {
        const message = err instanceof Error ? err.message : '';
        if (message === 'not_allowed') {
          return json({ error: 'Only the owner or an admin of the workspace can send files to the Google Drive trash.' }, 403);
        }
        if (message === 'file_not_trashed') {
          return json({ error: 'A page still uses this file: it is not in the trash.', code: 'in_use' }, 409);
        }
        return json({ error: 'This file does not exist or you cannot see it.' }, 404);
      }
      const media = this.server.mediaFiles.get(id)!;
      if (media.drive_trashed_at) return json({ status: 'done', file: id, drive: media.drive_id ? 'trashed' : 'none' });
      if (this.failTrash.has(id)) return json({ error: 'Could not send the file to the Google Drive trash (500).' }, 502);
      let drive: 'trashed' | 'missing' | 'none' = 'none';
      if (media.drive_id) {
        drive = this.drive.has(media.drive_id) ? 'trashed' : 'missing';
        if (drive === 'trashed') this.driveTrash.add(media.drive_id);
      }
      media.drive_trashed_at = new Date().toISOString();
      return json({ status: 'done', file: id, drive });
    }
    if (method === 'GET' && url.pathname.startsWith('/m/')) {
      // El archivo con un pase (el pase de prueba es el id de Drive), entero o por partes (`Range`). Un pase en
      // `expiredPasses` responde como vencido.
      const driveId = decodeURIComponent(url.pathname.slice(3));
      if (this.expiredPasses.delete(driveId)) {
        return json({ error: 'This link expired: open the file again from the app.', code: 'pass_expired' }, 403);
      }
      const stored = this.drive.get(driveId);
      if (!stored) return json({ error: 'This file is not in Google Drive anymore.', code: 'drive_missing' }, 404);
      const mime = this.server.mediaFiles.get(stored.file)?.mime ?? 'application/octet-stream';
      const asked = /^bytes=(\d+)-(\d*)$/.exec(headers.get('Range') ?? '');
      if (asked && !this.ignoreRanges) {
        const start = Number(asked[1]);
        // Como la caché del arranque del portero sin `?offline=1`: una parte más corta que la pedida.
        const cap = this.shortParts && (this.oldOffline || url.searchParams.get('offline') !== '1') ? this.shortParts : Infinity;
        const end = Math.min(asked[2] ? Number(asked[2]) : stored.data.length - 1, stored.data.length - 1, start + cap - 1);
        if (start >= stored.data.length) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stored.data.length}` } });
        return new Response(new Blob([stored.data.slice(start, end + 1) as BlobPart], { type: mime }), {
          status: 206,
          headers: { 'Content-Type': mime, 'Content-Range': `bytes ${start}-${end}/${stored.data.length}` },
        });
      }
      return new Response(new Blob([stored.data as BlobPart], { type: mime }), { status: 200, headers: { 'Content-Type': mime } });
    }
    if (method === 'POST' && url.pathname === '/pass') {
      const media = this.server.mediaFiles.get(String(body?.file ?? ''));
      if (!media || this.hidden.has(String(body?.file ?? ''))) {
        return json({ error: 'This file does not exist or you cannot see it.', code: 'not_found' }, 404);
      }
      // Como el portero: una carpeta (P.9) no se baja con un pase.
      if (media.mime === 'inode/directory') return json({ error: 'This is a folder: open it in the app to see its files.', code: 'is_folder' }, 409);
      if (!media.drive_id) return json({ error: 'This file has not finished uploading yet.', code: 'not_uploaded' }, 409);
      if (!this.drive.has(media.drive_id)) return json({ error: 'This file is not in Google Drive anymore.', code: 'drive_missing' }, 404);
      return json({ url: `${PORTERO_URL}/m/${media.drive_id}` });
    }
    if (method === 'GET' && url.pathname === '/drive/status') {
      return json({ connected: true, broken: null, email: null, isOwner: true, folder: null, picker: false, features: this.features });
    }
    if (method === 'POST' && url.pathname === '/verify') {
      const results: Record<string, unknown> = {};
      for (const id of (body?.files as string[]) ?? []) {
        const media = this.server.mediaFiles.get(id);
        if (!media || this.hidden.has(id)) results[id] = { error: 'not found', code: 'not_found' };
        else if (!media.drive_id) results[id] = { error: 'not uploaded', code: 'not_uploaded' };
        else if (!this.drive.has(media.drive_id)) results[id] = { error: 'missing', code: 'drive_missing' };
        else {
          const d = this.drive.get(media.drive_id)!;
          results[id] = { driveId: media.drive_id, size: d.data.length, trashed: this.driveTrash.has(media.drive_id), marked: d.file === id, md5: null };
        }
      }
      return json({ results });
    }
    return json({ error: 'Not found' }, 404);
  };

  /**
   * Las partes, como las manda la app (`PartSender`): avisa los bytes que salen y después hace el mismo
   * pedido que `fetch`.
   */
  readonly send: PartSender = async (input, init) => {
    const { signal } = init;
    // Lo que queda esperando se suelta cuando el pedido se aborta, como un pedido de verdad.
    const aborted = new Promise<never>((_, reject) => {
      const stop = () => reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
      if (signal?.aborted) stop();
      else signal?.addEventListener('abort', stop, { once: true });
    });
    aborted.catch(() => undefined);
    if (this.partDelay) {
      const uploadId = /\/upload\/(.+)$/.exec(new URL(input).pathname)?.[1] ?? '';
      await Promise.race([this.partDelay({ uploadId, size: init.body.size, sent: init.onSent }), aborted]);
    }
    init.onSent(init.body.size);
    const res = await this.fetch(input, { method: init.method, headers: init.headers, body: init.body, signal });
    if (this.loseAnswer) return aborted;
    return res;
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

export class FakeRemote implements Remote, MediaRemote, TeamRemote, CommentRemote, ProjectStatesRemote, HistoryRemote {
  /** La sesión: por defecto, el dueño del workspace. */
  readonly userId: string;
  readonly email: string;

  /**
   * Si los pedidos llevan el header con la versión (`x-shotdocs-version`), como el cliente de la app desde v0.0XX
   * (`appVersionHeaders` en workspace.ts; sin versión, ninguno). `false`: una versión anterior.
   */
  versionHeader = true;

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

  /** Como `private.app_version_allowed` de la base: con mínimo, una versión menor o ilegible no pasa. */
  private checkAppVersion(): void {
    const min = this.server.settings?.minAppVersion;
    if (min != null && !(/^\d{1,4}(\.\d{1,3})?$/.test(this.appVersion) && Number(this.appVersion) >= min)) {
      throw new RemoteError('app_outdated', true, 'P0001');
    }
  }

  /**
   * Como `private.require_write_version` de la base, al escribir el árbol o un comentario: con header, la versión contra
   * la mínima; sin header, se rechaza solo con una mínima de `writeVersionSince` o más. El rechazo es pasajero (503,
   * `app_outdated`): todas las versiones lo reintentan sin marcarlo como rechazado.
   */
  private checkWriteVersion(): void {
    const since = this.server.writeVersionSince;
    const min = this.server.settings?.minAppVersion;
    if (since == null || min == null) return;
    const allowed =
      this.versionHeader && this.appVersion !== ''
        ? /^\d{1,4}(\.\d{1,3})?$/.test(this.appVersion) && Number(this.appVersion) >= min
        : min < since;
    if (!allowed) throw new RemoteError('app_outdated', false, 'P0001');
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
    // Como la base (P.14): nunca uno borrado, y los archivados después de todos los demás.
    const byAge = [...this.server.projects.values()]
      .filter((p) => !this.server.projectDeleted(p.id))
      .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    const steps = [
      (p: ProjectRow) => p.owner_id === uid,
      (p: ProjectRow) => this.server.grants.some((g) => g.user_id === uid && g.project_id === p.id),
      (p: ProjectRow) => this.server.canViewProject(uid, p.id),
    ];
    for (const archived of [false, true]) {
      for (const step of steps) {
        const found = byAge.find((p) => !!p.archived_at === archived && step(p));
        if (found) return found.id;
      }
    }
    return null;
  }

  async fetchTree(projectIds: string[]): Promise<PageRow[]> {
    this.server.check();
    const ids = new Set(projectIds);
    return [...this.server.pages.values()]
      .filter((p) => ids.has(p.workspace_id) && !this.server.projectDeleted(p.workspace_id))
      .filter((p) => !this.team || this.server.projectLevel(this.userId, p.workspace_id) >= 1 || this.server.pageLevel(this.userId, p.id) >= 1)
      .map((p) => ({ ...p }));
  }

  /** Las versiones de la base que pasó la app a `fetchProjects`, en orden. */
  readonly fetchProjectsVersions: (number | null | undefined)[] = [];

  async fetchProjects(schemaVersion?: number | null): Promise<ProjectRow[]> {
    this.server.check();
    this.fetchProjectsVersions.push(schemaVersion);
    // Como pide las columnas la app: `archived_at` solo con la versión 9 o más; las de Drive, con la 10.
    const withArchived = (schemaVersion ?? 0) >= PROJECT_STATES_SCHEMA_VERSION;
    const withDrive =
      (schemaVersion ?? 0) >= PROJECT_DRIVE_SCHEMA_VERSION && (this.server.settings?.schemaVersion ?? 0) >= PROJECT_DRIVE_SCHEMA_VERSION;
    return [...this.server.projects.values()]
      .filter((p) => !this.server.projectDeleted(p.id))
      .filter((p) => !this.team || this.server.canViewProject(this.userId, p.id))
      .map(({ archived_at, drive_trash_requested_at: _r, drive_missing_at: _m, ...p }) => {
        const d = this.server.projectDrive.get(p.id);
        return {
          ...p,
          ...(withArchived ? { archived_at: archived_at ?? null } : {}),
          ...(withDrive ? { drive_trash_requested_at: d?.requested_at ?? null, drive_missing_at: d?.missing_at ?? null } : {}),
        };
      });
  }

  // --- archivar, borrar y restaurar proyectos (P.14) ---------------------------------------------------

  private projectStatesCheck(projectId: string): ProjectRow {
    this.server.check();
    if ((this.server.settings?.schemaVersion ?? 0) < PROJECT_STATES_SCHEMA_VERSION) {
      throw new RemoteError('Could not find the function', true, 'PGRST202');
    }
    const project = this.server.projects.get(projectId);
    if (!project || !this.server.couldViewProject(this.userId, projectId)) {
      throw new RemoteError('project_not_found', true, 'P0002');
    }
    if (!this.server.canManageProject(this.userId, projectId)) throw this.denied('not_allowed');
    return project;
  }

  async setProjectArchived(projectId: string, archived: boolean): Promise<void> {
    const project = this.projectStatesCheck(projectId);
    if (this.server.projectDeleted(projectId)) throw new RemoteError('project_deleted', true, 'P0001');
    // La versión se mira solo si cambia algo (como en la base: repetirlo no escribe).
    if (archived !== !!project.archived_at) this.checkWriteVersion();
    if (archived && !project.archived_at) project.archived_at = new Date().toISOString();
    else if (!archived) project.archived_at = null;
  }

  async deleteProject(projectId: string): Promise<string> {
    this.projectStatesCheck(projectId);
    const existing = this.server.deletedProjects.get(projectId);
    if (existing) return existing.at;
    this.checkWriteVersion();
    const at = new Date().toISOString();
    this.server.deletedProjects.set(projectId, { at, by: this.userId });
    this.server.refreshAllFileTrash();
    return at;
  }

  async restoreProject(projectId: string, withoutDrive = false): Promise<void> {
    this.projectStatesCheck(projectId);
    if (!this.server.deletedProjects.has(projectId)) return;
    this.checkWriteVersion();
    // Como la migración 10: con la carpeta pedida para la papelera de Drive, primero traerla (o sin ella, con marca).
    const d = this.server.projectDrive.get(projectId);
    if (d && !d.missing_at) {
      if (!withoutDrive) throw new RemoteError('drive_untrash_first', true, 'P0001');
      d.missing_at = new Date().toISOString();
    }
    this.server.deletedProjects.delete(projectId);
    this.server.refreshAllFileTrash();
  }

  async trashedProjects(): Promise<TrashedProjectRow[] | null> {
    this.server.check();
    if ((this.server.settings?.schemaVersion ?? 0) < PROJECT_STATES_SCHEMA_VERSION) return null;
    const day = 86_400_000;
    const role = this.server.role(this.userId);
    const staff = !this.team || role === 'owner' || role === 'admin';
    return [...this.server.deletedProjects.entries()]
      .filter(([id]) => this.server.couldViewProject(this.userId, id))
      .sort((a, b) => (a[1].at < b[1].at ? 1 : -1))
      .map(([id, d]) => {
        const p = this.server.projects.get(id)!;
        const can = this.server.canManageProject(this.userId, id);
        const drive = can ? this.server.projectDrive.get(id) : undefined;
        const email = this.server.members.get(d.by)?.email ?? d.by + '@test';
        return {
          id,
          name: p.name,
          archived_at: p.archived_at ?? null,
          deleted_at: d.at,
          deleted_by: can || staff ? d.by : null,
          deleted_by_email: can || staff ? email : null,
          days_left: Math.max(0, Math.ceil((Date.parse(d.at) + 30 * day - Date.now()) / day)),
          can_restore: can,
          pages: can ? [...this.server.pages.values()].filter((pg) => pg.workspace_id === id && !pg.deleted_at).length : null,
          files: can
            ? [...this.server.mediaFiles.values()].filter((f) => f.project_id === id && f.drive_id && !f.drive_trashed_at).length
            : null,
          drive_trash_requested_at: drive?.requested_at ?? null,
          drive_trashed_at: drive?.trashed_at ?? null,
          drive_missing_at: drive?.missing_at ?? null,
          can_purge: can && (role === 'owner' || role === 'admin' || !this.team),
        };
      });
  }

  async projectDeleteInfo(projectId: string): Promise<ProjectDeleteInfo> {
    this.projectStatesCheck(projectId);
    const pages = [...this.server.pages.values()].filter((p) => p.workspace_id === projectId);
    const files = [...this.server.mediaFiles.values()].filter((f) => f.project_id === projectId && f.drive_id && !f.drive_trashed_at);
    return {
      pages: pages.filter((p) => !p.deleted_at).length,
      trashed_pages: pages.filter((p) => !!p.deleted_at).length,
      files: files.length,
      drive_bytes: files.reduce((n, f) => n + f.size, 0),
      pending_files: [...this.server.mediaFiles.values()].filter((f) => f.project_id === projectId && !f.drive_id).length,
      used_elsewhere: 0,
      foreign_only_here: 0,
      shared_with: new Set(
        this.server.grants
          .filter((g) => g.project_id === projectId || (g.page_id && this.server.pages.get(g.page_id)?.workspace_id === projectId))
          .map((g) => g.user_id)
          .filter((u) => u !== this.userId),
      ).size,
    };
  }

  async createProject(project: NewProject): Promise<void> {
    this.server.check();
    // La política de la versión mira la fila propuesta aunque el proyecto ya exista (`upsert` sin pisar).
    this.checkWriteVersion();
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
    this.checkWriteVersion();
    this.server.projects.set(id, { ...project, name });
  }

  async createPage(page: NewPage): Promise<void> {
    this.server.check();
    // Como en los proyectos: la versión se mira aunque la página ya exista.
    this.checkWriteVersion();
    if (this.server.pages.has(page.id)) return;
    if (this.server.rejectCreates) {
      throw new RemoteError('new row violates row-level security policy for table "pages"', true, '42501');
    }
    if (!this.server.projects.has(page.workspace_id) || this.server.projectDeleted(page.workspace_id)) {
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
    if (!page || this.server.pageInDeletedProject(id)) throw new RemoteError('page_not_found', true, 'P0002');
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
    // La política de la versión mira la fila nueva, después de los triggers (como en la base).
    this.checkWriteVersion();
    this.server.pages.set(id, { ...page, ...patch, updated_at: new Date().toISOString() });
    // Los triggers de la papelera de archivos: la página entró, salió o se movió de la papelera de páginas.
    if (patch.deleted_at !== undefined || patch.parent_id !== undefined) this.server.refreshAllFileTrash();
  }

  async pushUpdate(pageId: string, clientUpdateId: string, update: Uint8Array): Promise<number> {
    this.server.check();
    const page = this.server.pages.get(pageId);
    if (!page || this.server.pageInDeletedProject(pageId) || (this.team && this.server.pageLevel(this.userId, pageId) < 3)) {
      throw new RemoteError('page_not_found', true, 'P0002');
    }
    this.checkAppVersion();
    const list = this.server.updates.get(pageId) ?? [];
    const existing = list.find((u) => u.clientUpdateId === clientUpdateId);
    if (existing) return existing.seq;
    if (update.length === 0 || update.length > this.server.maxUpdateBytes) {
      throw new RemoteError('update_size_invalid', true, '22023');
    }
    page.update_seq += 1;
    list.push({
      seq: page.update_seq,
      clientUpdateId,
      data: update.slice(),
      id: this.server.nextUpdateId(),
      createdBy: this.userId,
      createdAt: new Date(this.server.now()).toISOString(),
    });
    this.server.updates.set(pageId, list);
    if (this.server.loseNextPushResponse) {
      this.server.loseNextPushResponse = false;
      throw new RemoteError('Failed to fetch', false, undefined, true);
    }
    return page.update_seq;
  }

  async pullUpdates(pageId: string, afterSeq: number, limit: number): Promise<RemoteUpdate[]> {
    this.server.check();
    if (
      !this.server.pages.has(pageId) ||
      this.server.pageInDeletedProject(pageId) ||
      (this.team && this.server.pageLevel(this.userId, pageId) < 1)
    ) {
      throw new RemoteError('page_not_found', true, 'P0002');
    }
    return (this.server.updates.get(pageId) ?? [])
      .filter((u) => u.seq > afterSeq)
      .slice(0, limit)
      .map((u) => ({ seq: u.seq, data: u.data.slice() }));
  }

  /** `page_history` (20261007120000_historial.sql): nivel 3 o más, no invitado, no en la papelera. */
  private checkHistory(pageId: string): void {
    this.server.check();
    if (
      !this.server.pages.has(pageId) ||
      this.server.pageInDeletedProject(pageId) ||
      (this.team && (this.server.pageLevel(this.userId, pageId) < 3 || this.server.role(this.userId) === 'guest'))
    ) {
      throw new RemoteError('page_not_found', true, 'P0002');
    }
    for (let p = this.server.pages.get(pageId); p; p = p.parent_id ? this.server.pages.get(p.parent_id) : undefined) {
      if (p.deleted_at) throw new RemoteError('page_in_trash', true, 'P0001');
    }
  }

  async pageHistory(pageId: string, afterSeq: number, limit: number): Promise<HistoryRow[]> {
    if (this.server.historyMissing) throw new RemoteError('Could not find the function public.page_history', true, 'PGRST202');
    this.checkHistory(pageId);
    return (this.server.updates.get(pageId) ?? [])
      .filter((u) => u.seq > afterSeq)
      .slice(0, Math.min(Math.max(limit, 1), 1000))
      .map((u) => ({
        id: u.id ?? u.seq,
        seq: u.seq,
        createdBy: u.createdBy === undefined ? this.server.ownerId : u.createdBy,
        createdAt: u.createdAt ?? new Date(0).toISOString(),
        data: u.data.slice(),
      }));
  }

  async pageHistoryAuthors(pageId: string): Promise<HistoryAuthor[]> {
    this.checkHistory(pageId);
    const ids = new Set((this.server.updates.get(pageId) ?? []).map((u) => (u.createdBy === undefined ? this.server.ownerId : u.createdBy)));
    return [...ids]
      .filter((id): id is string => !!id)
      .map((id) => ({ user_id: id, email: this.server.members.get(id)?.email ?? `${id}@test` }))
      .sort((a, b) => a.email.localeCompare(b.email));
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
      if (inv.used_at || inv.revoked_at || inv.email !== this.email) continue;
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
    const live = this.server.invitations.find((i) => i.email === em && !i.used_at && !i.revoked_at);
    if (live) {
      if ((live.invited_by ?? this.server.ownerId) !== this.userId) throw new RemoteError('invitation_exists', true, 'P0001');
      if (ROLE_RANK[role] > ROLE_RANK[live.role]) live.role = role;
      live.grants.push(...grants);
      return live.id;
    }
    const id = crypto.randomUUID();
    this.server.invitations.push({ id, email: em, role, grants: [...grants], used_at: null, invited_by: this.userId });
    return id;
  }

  async listInvitations(): Promise<InvitationRow[] | null> {
    this.server.check();
    if (this.server.noInvitationList) return null;
    const mine = this.server.role(this.userId);
    if (mine !== 'owner' && mine !== 'admin') return [];
    return this.server.invitations
      .filter((i) => !i.used_at && !i.revoked_at)
      .map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        grants: i.grants,
        invited_by: i.invited_by ?? null,
        invited_by_email: this.server.members.get(i.invited_by ?? '')?.email ?? null,
        created_at: '',
        expires_at: '',
      }));
  }

  async revokeInvitation(id: string): Promise<void> {
    this.server.check();
    const inv = this.server.invitations.find((i) => i.id === id);
    const mine = this.server.role(this.userId);
    if (!inv || (mine !== 'owner' && (mine !== 'admin' || inv.invited_by !== this.userId))) {
      throw new RemoteError('invitation_not_found', true, 'P0002');
    }
    if (inv.used_at) throw new RemoteError('invitation_used', true, 'P0001');
    inv.revoked_at ??= new Date().toISOString();
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

  async removeMember(userId: string): Promise<{ transferred: number; withoutHeir: number }> {
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

  async registerFile(file: NewMediaFile): Promise<LinkResult> {
    this.server.check();
    this.server.mediaCalls.push(`register_file ${file.id}`);
    const page = this.server.pages.get(file.pageId);
    if (!page) throw pageNotFound();
    // supabase/migrations/20261006120000_version_minima_archivos.sql: la cola de archivos también manda la versión.
    this.checkAppVersion();
    const existing = this.server.mediaFiles.get(file.id);
    if (existing && existing.project_id !== page.workspace_id) {
      // De otro proyecto (que la sesión ve): guarda el uso ajeno y lo dice con el valor, sin error.
      this.server.foreignPageFiles.add(`${file.pageId}:${file.id}`);
      this.server.refreshFileTrash(file.id);
      this.server.lostMediaResponse('register_file');
      return 'foreign';
    }
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
        trashed_at: null,
        purged_at: null,
        drive_trashed_at: null,
        created_by: this.userId,
      });
    }
    this.server.pageFiles.add(`${file.pageId}:${file.id}`);
    this.server.removedPageFiles.delete(`${file.pageId}:${file.id}`);
    this.server.refreshFileTrash(file.id);
    this.server.lostMediaResponse('register_file');
    return 'ok';
  }

  async linkPageFile(pageId: string, fileId: string): Promise<LinkResult> {
    this.server.check();
    this.server.mediaCalls.push(`link_page_file ${pageId} ${fileId}`);
    const page = this.server.pages.get(pageId);
    if (!page) throw pageNotFound();
    this.checkAppVersion();
    const file = this.server.mediaFiles.get(fileId);
    if (!file) throw fileNotFound();
    if (file.project_id !== page.workspace_id) {
      // Uso ajeno: se guarda (cuenta para la papelera) y se dice con el valor, sin error.
      this.server.foreignPageFiles.add(`${pageId}:${fileId}`);
      this.server.refreshFileTrash(fileId);
      this.server.lostMediaResponse('link_page_file');
      return 'foreign';
    }
    this.server.pageFiles.add(`${pageId}:${fileId}`);
    this.server.removedPageFiles.delete(`${pageId}:${fileId}`);
    this.server.refreshFileTrash(fileId);
    this.server.lostMediaResponse('link_page_file');
    return 'ok';
  }

  // --- papelera de archivos (supabase/migrations/20260930180000_papelera_archivos.sql) ---

  async unlinkPageFile(pageId: string, fileId: string, seenSeq?: number | null): Promise<boolean> {
    this.server.check();
    this.server.mediaCalls.push(`unlink_page_file ${pageId} ${fileId}`);
    this.server.seenSeqs.push(seenSeq ?? null);
    const page = this.server.pages.get(pageId);
    if (!page || (this.team && this.server.pageLevel(this.userId, pageId) < 3)) throw pageNotFound();
    this.checkAppVersion();
    // `p_seen_seq`: si la página cambió después del documento con el que se decidió, no hace nada.
    if (seenSeq != null && page.update_seq > seenSeq) {
      this.server.lostMediaResponse('unlink_page_file');
      return false;
    }
    const key = `${pageId}:${fileId}`;
    if (this.server.foreignPageFiles.delete(key)) this.server.refreshFileTrash(fileId);
    // La fila queda, marcada; si no existe o ya estaba marcada, no hace nada.
    if (this.server.pageFiles.delete(key)) {
      this.server.removedPageFiles.add(key);
      this.server.refreshFileTrash(fileId);
    }
    this.server.lostMediaResponse('unlink_page_file');
    return true;
  }

  async trashedFiles(projectId: string): Promise<TrashedFileRow[]> {
    this.server.check();
    this.server.mediaCalls.push(`trashed_files ${projectId}`);
    if (!this.server.canSeeFileTrash(this.userId, projectId)) throw this.denied('not_allowed');
    const day = 86_400_000;
    return [...this.server.mediaFiles.values()]
      .filter((f) => f.project_id === projectId && f.trashed_at && !f.drive_trashed_at)
      .sort((a, b) => (a.trashed_at! < b.trashed_at! ? 1 : a.trashed_at! > b.trashed_at! ? -1 : a.id < b.id ? -1 : 1))
      .map((f) => ({
        id: f.id,
        name: f.name,
        mime: f.mime,
        size: f.size,
        thumb_at: f.thumb_at,
        trashed_at: f.trashed_at!,
        days_left: Math.max(0, Math.ceil((Date.parse(f.trashed_at!) + 30 * day - Date.now()) / day)),
        purged_at: f.purged_at ?? null,
        ...this.server.trashedPageUse(f.id),
        in_deleted_project: this.server.fileInDeletedProject(f.id),
      }));
  }

  async filesDueForPurge(projectId: string): Promise<DueFileRow[]> {
    this.server.check();
    this.server.mediaCalls.push(`files_due_for_purge ${projectId}`);
    if (!this.server.canPurgeFiles(this.userId, projectId)) throw this.denied('not_allowed');
    if (this.server.settings?.autoPurgeFiles !== true) return [];
    const limit = Date.now() - 30 * 86_400_000;
    return [...this.server.mediaFiles.values()]
      .filter((f) => f.project_id === projectId && f.trashed_at && Date.parse(f.trashed_at) <= limit && !f.drive_trashed_at)
      .sort((a, b) => (a.trashed_at! < b.trashed_at! ? -1 : 1))
      .map((f) => ({ id: f.id, name: f.name, trashed_at: f.trashed_at! }));
  }

  // `_stalledBefore`: el tope lo pone el cliente de verdad (`thumbUploadLimit`); acá no hay tope.
  async uploadThumb(fileId: string, data: Blob, _stalledBefore?: number): Promise<void> {
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
      const { created_by: _c, ...row } = f;
      return [{ ...row }];
    });
  }

  /** `page_files` con su política: los usos de las páginas que la sesión ve (activos, quitados y ajenos). */
  async fetchPageUses(pageIds: string[]): Promise<PageUseRow[]> {
    this.server.check();
    this.server.mediaCalls.push(`page_files ${pageIds.length}`);
    const rows: PageUseRow[] = [];
    for (const pageId of new Set(pageIds)) {
      if (!this.server.pages.has(pageId) || this.server.pageInDeletedProject(pageId)) continue;
      if (this.team && this.server.pageLevel(this.userId, pageId) < 1) continue;
      for (const [set, removed, foreign] of [
        [this.server.pageFiles, false, false],
        [this.server.removedPageFiles, true, false],
        [this.server.foreignPageFiles, false, true],
      ] as const) {
        for (const key of set) {
          const [p, f] = key.split(':');
          if (p === pageId) rows.push({ page_id: p, file_id: f, removed_at: removed ? new Date().toISOString() : null, is_foreign: foreign });
        }
      }
    }
    return rows;
  }

  // --- comentarios (mismas reglas que supabase/migrations/20260930170000_comentarios.sql) ---

  /** `private.page_level`; sin las reglas del equipo, quien ve la página la puede todo (como antes). */
  private commentLevel(pageId: string): number {
    if (!this.server.pages.has(pageId) || this.server.pageInDeletedProject(pageId)) return 0;
    return this.team ? this.server.pageLevel(this.userId, pageId) : 4;
  }

  private commentCheck(name: string): void {
    this.server.check();
    this.server.commentCalls.push(name);
    if (this.server.commentsServerError) throw new RemoteError('Internal Server Error', false, '500');
  }

  private lostCommentResponse(name: 'add' | 'edit' | 'delete' | 'resolve' | 'import'): void {
    if (this.server.loseCommentResponse.delete(name)) throw new RemoteError('Failed to fetch', false, undefined, true);
  }

  async fetchComments(pageId: string): Promise<CommentRow[]> {
    this.server.check();
    // La política de la tabla: se ven los de las páginas que se ven.
    if (this.commentLevel(pageId) < 1) return [];
    return [...this.server.comments.values()]
      .filter((c) => c.page_id === pageId)
      .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1))
      .map(({ updated_at: _u, ...c }) => ({ ...c, body: c.deleted_at ? null : c.body }));
  }

  async listComments(pageId: string, since: string | null): Promise<(CommentRow & { updated_at?: string })[] | null> {
    this.server.check();
    if (!this.server.listCommentsEnabled) return null;
    this.server.commentCalls.push(`list ${since ?? 'all'}`);
    if (this.commentLevel(pageId) < 1) throw new RemoteError('page_not_found', true, 'P0002');
    return [...this.server.comments.values()]
      .filter((c) => c.page_id === pageId && (since === null || (c.updated_at ?? c.created_at) > since))
      .map((c) => ({ ...c, body: c.deleted_at ? null : c.body, updated_at: c.updated_at ?? c.created_at }));
  }

  async fetchCommentAuthors(pageId: string): Promise<CommentAuthor[]> {
    this.server.check();
    this.server.commentCalls.push('authors');
    if (this.commentLevel(pageId) < 1) throw new RemoteError('page_not_found', true, 'P0002');
    const ids = new Set<string>();
    for (const c of this.server.comments.values()) {
      if (c.page_id !== pageId) continue;
      for (const id of [c.author_id, c.resolved_by, c.deleted_by, c.imported_by]) if (id) ids.add(id);
    }
    return [...ids].map((id) => ({ user_id: id, email: this.server.members.get(id)?.email ?? `${id}@test` }));
  }

  async addComment(c: NewComment): Promise<void> {
    this.commentCheck(`add ${c.id}`);
    const lvl = this.commentLevel(c.pageId);
    if (lvl < 1) throw new RemoteError('page_not_found', true, 'P0002');
    if (lvl < 2) throw new RemoteError('comment_denied', true, '42501');
    let block = c.blockId;
    if (c.threadId) {
      if (c.threadId === c.id) throw new RemoteError('thread_invalid', true, '22023');
      const root = this.server.comments.get(c.threadId);
      if (!root) throw new RemoteError('thread_not_found', true, 'P0002');
      if (root.page_id !== c.pageId) throw new RemoteError('thread_other_page', true, 'P0001');
      if (root.thread_id || (block !== null && block !== root.block_id)) throw new RemoteError('thread_invalid', true, '22023');
      block = root.block_id;
    }
    if (!/\S/.test(c.body) || c.body.length > 10000 || (block !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(block))) {
      throw new RemoteError('new row for relation "comments" violates check constraint', true, '23514');
    }
    const cur = this.server.comments.get(c.id);
    if (cur) {
      if (cur.author_id !== this.userId || cur.page_id !== c.pageId || cur.block_id !== block || cur.thread_id !== c.threadId || cur.body !== c.body) {
        throw new RemoteError('comment_conflict', true, 'P0001');
      }
    } else {
      // El trigger de la versión corre solo cuando la función escribe (un reintento de algo que ya está, no).
      this.checkWriteVersion();
      this.server.comments.set(c.id, {
        id: c.id,
        page_id: c.pageId,
        block_id: block,
        thread_id: c.threadId,
        body: c.body,
        author_id: this.userId,
        created_at: this.server.commentNow(),
        updated_at: this.server.commentNow(),
        edited_at: null,
        resolved_at: null,
        resolved_by: null,
        deleted_at: null,
        deleted_by: null,
      });
    }
    this.lostCommentResponse('add');
  }

  /** Las reglas de `import_comment` (20260930200000_comentarios_importados.sql). */
  async importComment(c: ImportedComment): Promise<void> {
    this.commentCheck(`import ${c.id}`);
    const name = c.authorName?.trim() || null;
    const email = name ? c.authorEmail?.trim().toLowerCase() || null : null;
    const author = name ? null : this.userId;
    // Las fechas se comparan como fechas (la base las guarda como timestamptz, no como el texto que llega).
    const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
    // El mismo comentario importado por la misma persona: todo igual salvo, quizás, el bloque y el texto.
    const sameOrigin = (cur: StoredComment) =>
      cur.imported_by === this.userId && cur.page_id === c.pageId && cur.thread_id === c.threadId &&
      time(cur.created_at) === time(c.createdAt) && cur.imported_from === c.source && cur.author_id === author &&
      (cur.imported_author ?? null) === name && (cur.imported_author_email ?? null) === email;
    const existing = this.server.comments.get(c.id);
    const exactBlock = existing && (existing.block_id === c.blockId || (c.threadId !== null && c.blockId === null));
    if (existing && sameOrigin(existing) && existing.body === c.body && exactBlock) {
      this.lostCommentResponse('import');
      return;
    }
    if (!this.server.importCommentsEnabled) throw new RemoteError('Could not find the function public.import_comment', true, 'PGRST202');
    const lvl = this.commentLevel(c.pageId);
    if (lvl < 1) throw new RemoteError('page_not_found', true, 'P0002');
    if (lvl < 4) throw new RemoteError('import_denied', true, '42501');
    const min = Date.parse('2000-01-01T00:00:00Z');
    const created = time(c.createdAt);
    if (!(created >= min) || created > time(this.server.commentNow()) + 5 * 60_000) throw new RemoteError('created_invalid', true, '22023');
    if (c.resolvedAt && (c.threadId || !(time(c.resolvedAt) >= min))) throw new RemoteError('resolved_invalid', true, '22023');
    let block = c.blockId;
    if (c.threadId) {
      if (c.threadId === c.id) throw new RemoteError('thread_invalid', true, '22023');
      const root = this.server.comments.get(c.threadId);
      if (!root) throw new RemoteError('thread_not_found', true, 'P0002');
      if (root.page_id !== c.pageId) throw new RemoteError('thread_other_page', true, 'P0001');
      if (root.thread_id || (block !== null && block !== root.block_id)) throw new RemoteError('thread_invalid', true, '22023');
      block = root.block_id;
    }
    if (c.source !== 'coda' || !/\S/.test(c.body) || c.body.length > 10000 || (block !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(block))) {
      throw new RemoteError('new row for relation "comments" violates check constraint', true, '23514');
    }
    if (existing) {
      if (!sameOrigin(existing)) throw new RemoteError('comment_conflict', true, 'P0001');
      // Importado de nuevo: el hilo va al bloque de ahora, con sus respuestas (el texto de la base queda).
      if (existing.thread_id === null && !existing.deleted_at && block !== null && existing.block_id !== block) {
        this.checkWriteVersion();
        const at = this.server.commentNow();
        for (const r of this.server.comments.values()) {
          if (r.id === c.id || (r.thread_id === c.id && r.page_id === c.pageId)) {
            r.block_id = block;
            r.updated_at = at;
          }
        }
      }
    } else {
      this.checkWriteVersion();
      this.server.comments.set(c.id, {
        id: c.id,
        page_id: c.pageId,
        block_id: block,
        thread_id: c.threadId,
        body: c.body,
        author_id: author,
        created_at: c.createdAt,
        updated_at: this.server.commentNow(),
        edited_at: null,
        resolved_at: c.resolvedAt,
        resolved_by: null,
        deleted_at: null,
        deleted_by: null,
        imported_from: c.source,
        imported_author: name,
        imported_author_email: email,
        imported_by: this.userId,
      });
    }
    this.lostCommentResponse('import');
  }

  async editComment(id: string, body: string): Promise<void> {
    this.commentCheck(`edit ${id}`);
    const cur = this.server.comments.get(id);
    const lvl = cur ? this.commentLevel(cur.page_id) : 0;
    if (!cur || lvl < 1) throw new RemoteError('comment_not_found', true, 'P0002');
    if (cur.author_id !== this.userId) throw new RemoteError('not_allowed', true, '42501');
    if (lvl < 2) throw new RemoteError('comment_denied', true, '42501');
    if (cur.deleted_at) throw new RemoteError('comment_deleted', true, 'P0001');
    if (cur.body !== body) {
      if (!/\S/.test(body) || body.length > 10000) throw new RemoteError('check constraint', true, '23514');
      this.checkWriteVersion();
      cur.body = body;
      cur.edited_at = this.server.commentNow();
      cur.updated_at = cur.edited_at;
    }
    this.lostCommentResponse('edit');
  }

  async deleteComment(id: string): Promise<void> {
    this.commentCheck(`delete ${id}`);
    const cur = this.server.comments.get(id);
    const lvl = cur ? this.commentLevel(cur.page_id) : 0;
    if (!cur || lvl < 1) throw new RemoteError('comment_not_found', true, 'P0002');
    if (!((cur.author_id === this.userId && lvl >= 2) || lvl >= 4)) throw new RemoteError('not_allowed', true, '42501');
    if (!cur.deleted_at) {
      this.checkWriteVersion();
      cur.deleted_at = this.server.commentNow();
      cur.deleted_by = this.userId;
      cur.updated_at = cur.deleted_at;
    }
    this.lostCommentResponse('delete');
  }

  async resolveThread(threadId: string, resolved: boolean): Promise<void> {
    this.commentCheck(`resolve ${threadId} ${resolved}`);
    const root = this.server.comments.get(threadId);
    const lvl = root ? this.commentLevel(root.page_id) : 0;
    if (!root || lvl < 1) throw new RemoteError('thread_not_found', true, 'P0002');
    if (root.thread_id) throw new RemoteError('thread_invalid', true, '22023');
    if (lvl < 2) throw new RemoteError('comment_denied', true, '42501');
    if (resolved !== !!root.resolved_at) this.checkWriteVersion();
    if (resolved && !root.resolved_at) {
      root.resolved_at = this.server.commentNow();
      root.resolved_by = this.userId;
      root.updated_at = root.resolved_at;
    } else if (!resolved && root.resolved_at) {
      root.resolved_at = null;
      root.resolved_by = null;
      root.updated_at = this.server.commentNow();
    }
    this.lostCommentResponse('resolve');
  }

}


/**
 * Lo que el navegador saca de un archivo, simulado: una foto o un video tienen medidas y miniatura; un HEIC
 * no (como en Chrome de Windows).
 */
/** Una vista previa de mentira para un PDF (un JPEG corto que dice de qué archivo es); nada para lo demás. */
export async function fakePreview(_file: Blob, mime: string, name: string, onStart?: () => Promise<boolean>): Promise<Blob | null> {
  if (mime !== 'application/pdf') return null;
  // Como la de verdad: avisa que empieza a dibujar.
  if (onStart && !(await onStart())) return null;
  return new Blob([new Uint8Array([0xff, 0xd8, 0xff]), new TextEncoder().encode(`preview:${name}`)], { type: 'image/jpeg' });
}

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

/**
 * La conversión de un HEIC a JPEG, simulada (node no tiene Worker ni canvas): un JPEG corto que dice cuánto
 * pesaba el HEIC.
 */
export async function fakeConvertHeic(file: Blob): Promise<Blob> {
  return new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), `jpeg-of:${file.size}`], { type: 'image/jpeg' });
}

/**
 * La imagen nítida de prueba (jsdom no dibuja): un JPEG corto que dice de qué tamaño vino el original, o `null`
 * para un HEIC (el navegador no lo abre).
 */
export async function fakeViewImage(file: Blob, mime: string, side = 2048): Promise<Blob | null> {
  if (!mime.startsWith('image/') || mime === 'image/heic') return null;
  return new Blob([new Uint8Array([0xff, 0xd8, 0xff, 9]), `view:${file.size}:${side}`], { type: 'image/jpeg' });
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
  comments: CommentQueue;
  commentsDb: CommentsDb;
  sizes: ProjectSizes;
  offline: OfflineManager;
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
  // Como la app: sin "Edit", las reparaciones quedan en memoria.
  const docs = new PageDocs(db, {
    normalize: normalizeStructure,
    seed: seedIfEmpty,
    canWrite: (pageId) => new Permissions(tree, access.get(), remote.userId).canEditPage(pageId),
    ...docsOptions,
  });
  const files = new PageFiles(db, remote);
  const mediaDb = await openMediaDb(mediaDbName(dbName));
  // Como la app (services.ts): "Available offline" se arma después y la cola le avisa por acá.
  let offlineRef: OfflineManager | null = null;
  const media = new MediaQueue(server.mediaDbFails ? null : mediaDb, remote, {
    onUse: (id, how) => offlineRef?.used(id, how),
    makeRoom: async (bytes) => (offlineRef ? offlineRef.makeRoom(bytes) : 0),
    onRejected: (file) => offlineRef?.rejected(file),
    // El portero en memoria sabe quién pide por el token (`token:<usuario>`).
    portero: (url) =>
      new Portero(url, {
        fetch: server.portero.fetch,
        send: server.portero.send,
        token: async () => `token:${remote.userId}`,
        wait: async () => undefined,
        now: () => Date.now() + server.clockOffset,
      }),
    projectOf: (pageId) => tree.get(pageId)?.workspace_id,
    onForeignFile: (name) => server.foreignNotices.push(name),
    probe: (file, mime) => server.probe(file, mime),
    preview: (file, mime, name, onStart) => server.preview(file, mime, name, onStart),
    playMark: async (thumb) => thumb,
    viewImage: fakeViewImage,
    convertHeic: (file) => server.convertHeic(file),
    heicTimeoutMs: server.heicTimeoutMs,
    // Sin red, el dispositivo lo sabe (como `navigator.onLine` en false).
    offline: () => !server.online,
    now: () => Date.now() + server.clockOffset,
  });
  await media.load();
  const commentsDb = await openCommentsDb(commentsDbName(dbName));
  const comments = new CommentQueue(commentsDb, remote, remote.userId, { now: () => Date.now() + server.clockOffset });
  await comments.load();
  const sizes = new ProjectSizes(db, {
    projectSizes: async () => {
      server.check();
      server.sizesCalls++;
      return server.sizes && server.sizes.map((r) => ({ ...r }));
    },
  });
  await sizes.load();
  const engine = new SyncEngine(remote, tree, docs, files, { appVersion, schemaVersion, media, access, comments, sizes });
  const offline = new OfflineManager({
    db: server.mediaDbFails ? null : mediaDb,
    media,
    tree,
    docs,
    remote,
    comments,
    older: files,
    online: () => server.online,
    fetch: (url, init) => server.portero.fetch(url, init),
    storage: () => server.storage,
    now: () => Date.now() + server.clockOffset,
    dbName,
    local: null,
  });
  await offline.load();
  offlineRef = offline;
  return { db, tree, docs, files, media, mediaDb, engine, remote, access, comments, commentsDb, sizes, offline };
}

/** Lo que se corta al matar la app (un dispositivo, o la versión publicada sin motor). */
export interface Killable {
  docs: { dispose(): void };
  engine?: { stop(): void };
  db: { close(): void };
}

/** Deja correr `n` microtareas (sin que avance IndexedDB, que va por tareas). */
export const microtasks = async (n = 20) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

/**
 * La página se va de golpe (una recarga, un cierre, el sistema que mata la app): se pierde todo lo que está
 * en memoria y el navegador aborta las transacciones que todavía no se estaban confirmando. Las que ya
 * llamaron a `commit()` terminan (es lo que se midió en el navegador: ver
 * Docs/Doc_Investigacion_Intermitente.md). Hay que llamar a `watchTransactions` antes de lo que se quiera
 * cortar.
 */
export function watchTransactions(): { kill: (d: Killable) => Promise<void>; restore: () => void } {
  const proto = IDBDatabase.prototype as unknown as { transaction: (...args: unknown[]) => IDBTransaction };
  const txProto = IDBTransaction.prototype as unknown as { commit: () => void };
  const realTransaction = proto.transaction;
  const realCommit = txProto.commit;
  const open = new Set<IDBTransaction>();
  const committing = new WeakSet<IDBTransaction>();
  proto.transaction = function (this: IDBDatabase, ...args: unknown[]) {
    const tx = realTransaction.apply(this, args);
    open.add(tx);
    const finish = () => open.delete(tx);
    tx.addEventListener('complete', finish);
    tx.addEventListener('abort', finish);
    tx.addEventListener('error', finish);
    return tx;
  };
  txProto.commit = function (this: IDBTransaction) {
    committing.add(this);
    return realCommit.call(this);
  };
  const restore = () => {
    proto.transaction = realTransaction;
    txProto.commit = realCommit;
  };
  return {
    restore,
    kill: async (d: Killable) => {
      for (const tx of open) {
        // Las de solo lectura no cambian nada de lo guardado: da igual si terminan.
        if (committing.has(tx) || tx.mode !== 'readwrite') continue;
        // En el navegador no queda nadie esperando a la transacción; acá sí, y su rechazo no se atiende.
        (wrap(tx) as unknown as { done: Promise<void> }).done.catch(() => undefined);
        try {
          tx.abort();
        } catch {
          // Ya estaba terminando.
        }
      }
      restore();
      // Lo de memoria se pierde: no se escribe nada más desde este dispositivo.
      d.docs.dispose();
      d.engine?.stop();
      d.db.close();
      // Que terminen de abortarse (y de confirmarse) antes de volver a abrir la base.
      await new Promise((r) => setTimeout(r, 20));
    },
  };
}
