import 'fake-indexeddb/auto';
import { wrap } from 'idb';
import { mediaDbName, openMediaDb, type MediaDb } from '../media/mediaDb';
import type { CompactOptions, CompactOutcome } from './compact';
import { AccessStore, levelValue, parseAccess, Permissions, type AccessSnapshot, type GrantLevel, type Role } from './access';
import { Portero, type PartSender } from '../media/portero';
import { Md5 } from '../media/md5';
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
  SNAPSHOT_SCHEMA_VERSION,
  type AccessRow,
  type CompactionClaim,
  type NewSnapshot,
  type SnapshotPushResult,
  type SnapshotsRemote,
  type CleanPushResult,
  type CleanWorkRow,
  type NewCleanBase,
  type InvitationGrant,
  type InvitationRow,
  type LinkResult,
  type MediaRemote,
  type MemberRow,
  type HistoryAuthor,
  type HistoryRemote,
  type NamedVersionsRemote,
  type ProjectStatesRemote,
  type Remote,
  type TeamRemote,
} from './remote';
import type { HistoryRow, PageVersionRow } from './history';
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
  cleanLabel,
  labelForEmail,
  MENTIONS_SCHEMA_VERSION,
} from './comments';
import { MentionsInbox, type InboxResponse, type MentionCandidate, type MentionsRemote } from './mentions';
import { CLEAN_SCHEMA_VERSION } from './clean';
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

/** Una fila de `page_snapshots` en el servidor en memoria (20261019120000_compactar_leer.sql). */
export interface StoredSnapshot {
  id: string;
  pageId: string;
  upToSeq: number;
  lastUpdateId: number;
  baseId: string | null;
  chainId: string;
  chainMinVersion: number;
  state: Uint8Array;
  sv: Uint8Array;
  sha256: string;
  appVersion: number;
  createdBy: string;
  createdAt: number;
  confirmedAt: number | null;
  invalidAt: number | null;
  invalidReason: string | null;
}

/** La huella SHA-256 en hexadecimal (como `encode(digest(...), 'hex')` en la base). */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>));
  return [...digest].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Una fila de `comments` en el servidor en memoria: con el texto aunque se haya borrado, como la tabla. */
type StoredComment = CommentRow & { body: string; updated_at?: string };

/** Servidor en memoria con las mismas reglas que el de Supabase (ver supabase/migrations). */
export class FakeServer {
  online = true;
  /** Guarda el próximo update pero hace como si la respuesta se hubiera perdido. */
  loseNextPushResponse = false;
  /** Como una base sin la migración del historial: `page_history` no existe (PGRST202). */
  historyMissing = false;
  /** Como una base sin la migración de las versiones con nombre: `list_page_versions` y las demás no existen. */
  versionsMissing = false;
  /**
   * `page_versions` (20261011120000_versiones_con_nombre.sql): nombres y marcas de restauración, con el `id` de su fila
   * (`updateId`) y `removedAt` (nunca se borran).
   */
  readonly versions: (PageVersionRow & { pageId: string; updateId: number; removedAt: string | null; removedBy: string | null })[] = [];
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
  /** Cuántas veces se pidió `clean_work`. */
  cleanWorkCalls = 0;
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
  readonly grants: { id: string; user_id: string; project_id: string | null; page_id: string | null; level: GrantLevel; granted_by?: string }[] = [];
  readonly invitations: {
    id: string;
    email: string;
    role: Exclude<Role, 'owner'>;
    grants: InvitationGrant[];
    used_at: string | null;
    invited_by?: string;
    revoked_at?: string | null;
    /** Quien entró con ella (para las menciones de un invitado, ME3). */
    used_by?: string;
  }[] = [];
  /** Simula una base sin `list_invitations`/`revoke_invitation` (PGRST202). */
  noInvitationList = false;
  /** Cómo falla la lectura de los permisos propios (para probar que nada de eso se toma por "sacado"). */
  accessFailure: null | 'network' | 'server' | 'empty' | 'weird' = null;
  /** Rechaza la creación de proyectos como si faltaran permisos. */
  rejectProjects = false;
  /** Para darle a cada restauración una generación nunca usada. */
  static generations = 100;

  // --- privacidad de lo borrado (20261010120000_privacidad_borrado.sql) ---------------------------------------
  /** `page_clean_bases`: la base vigente de cada página (una por página). */
  readonly cleanBases = new Map<string, { id: string; toSeq: number; lastUpdateId: number; state: Uint8Array; createdBy: string }>();
  /** `pages.clean_seq`, `clean_at` y `clean_reset_seq` (aparte de `PageRow`: el árbol los trae solo desde la versión 12). */
  readonly cleanMeta = new Map<string, { seq: number; at: number | null; reset: number }>();
  /**
   * Mutantes del servidor para las pruebas (tienen que dar fugas): `raw` le sirve filas a todos; `noreset` no mira
   * `clean_reset_seq` (ni al servir ni al aceptar); `noshare` no reinicia al compartir ni al invitar.
   */
  cleanMutant: null | 'raw' | 'noreset' | 'noshare' = null;
  /** Lo que respondió `push_clean_base`, en orden (para las pruebas). */
  readonly cleanPushes: { pageId: string; toSeq: number; result: string; by: string }[] = [];

  // --- compactar: los snapshots (20261019120000_compactar_leer.sql, Docs/Doc_Compactar.md) -----------------------
  /** `page_snapshots`, en el orden en que se subieron. */
  readonly snapshots: StoredSnapshot[] = [];
  /** `pages.snapshot_seq` y `pages.content_epoch` (aparte de `PageRow`: el árbol los trae solo desde la versión 17). */
  readonly snapshotMeta = new Map<string, { seq: number; epoch: number }>();
  /** `page_compaction`: la reserva y el "no reintentar". */
  readonly compaction = new Map<string, { claimAt: number | null; claimBy: string | null; skipUntil: number | null; skipWhy: string | null }>();
  /** Lo que pide `claim_page_compaction` (100 filas y 64 KB de cola en la base; las pruebas lo achican). */
  snapshotMinRows = 100;
  snapshotMinTailBytes = 65536;
  /** Como una base que dice la versión 17 pero no tiene `pull_page_content` (PGRST202). */
  pullContentMissing = false;
  /** Los pedidos de contenido que llegaron, en orden (`pull_page_updates` o `pull_page_content`). */
  readonly contentCalls: string[] = [];
  /** Cuántos snapshots sirvió `pull_page_content` (para las pruebas al azar). */
  snapshotsServed = 0;
  /** Restaurar sin el paso del script que vacía `page_snapshots` (la vigencia mira el id de la fila final). */
  keepSnapshotsOnRestore = false;

  /** Prende los snapshots (`snapshot_min_version`) con la base en la versión 17. Llamarlo después de los otros `enable`. */
  enableSnapshots(minVersion = 0.001): void {
    this.settings = {
      ...(this.settings ?? { generation: 1, minAppVersion: null, mediaUrl: null, schemaVersion: 1 }),
      schemaVersion: Math.max(this.settings?.schemaVersion ?? 1, SNAPSHOT_SCHEMA_VERSION),
      snapshotMinVersion: minVersion,
    };
  }

  /** La base en la versión 17 con los snapshots apagados (la migración aplicada, como queda al publicarla). */
  migrateSnapshots(): void {
    this.settings = {
      ...(this.settings ?? { generation: 1, minAppVersion: null, mediaUrl: null, schemaVersion: 1 }),
      schemaVersion: Math.max(this.settings?.schemaVersion ?? 1, SNAPSHOT_SCHEMA_VERSION),
      snapshotMinVersion: this.settings?.snapshotMinVersion ?? null,
    };
  }

  snapshotsMigrated(): boolean {
    return (this.settings?.schemaVersion ?? 0) >= SNAPSHOT_SCHEMA_VERSION;
  }

  snapshotsOn(): boolean {
    return this.snapshotsMigrated() && this.settings?.snapshotMinVersion != null;
  }

  smeta(pageId: string): { seq: number; epoch: number } {
    let m = this.snapshotMeta.get(pageId);
    if (!m) {
      m = { seq: 0, epoch: 0 };
      this.snapshotMeta.set(pageId, m);
    }
    return m;
  }

  /** `private.current_snapshot`: confirmado, no invalidado, su fila final igual y la cadena de una versión permitida. */
  currentSnapshot(pageId: string): StoredSnapshot | null {
    const page = this.pages.get(pageId);
    const min = this.settings?.snapshotMinVersion;
    if (!page || !this.snapshotsOn() || min == null) return null;
    const rows = this.updates.get(pageId) ?? [];
    let best: StoredSnapshot | null = null;
    for (const sn of this.snapshots) {
      if (sn.pageId !== pageId || sn.confirmedAt === null || sn.invalidAt !== null) continue;
      if (sn.chainMinVersion < min || sn.upToSeq > page.update_seq) continue;
      const row = rows.find((u) => u.seq === sn.upToSeq);
      if (!row || (row.id ?? row.seq) !== sn.lastUpdateId) continue;
      if (!best || sn.upToSeq > best.upToSeq) best = sn;
    }
    return best;
  }

  /** `private.invalidate_snapshot_chain`: toda la cadena; `snapshot_seq` a 0 y la época sube. */
  invalidateChain(pageId: string, chainId: string, reason: string): number {
    let n = 0;
    for (const sn of this.snapshots) {
      if (sn.chainId !== chainId || sn.invalidAt !== null) continue;
      sn.invalidAt = this.now();
      sn.invalidReason = reason;
      n++;
    }
    if (n > 0) {
      const m = this.smeta(pageId);
      m.seq = 0;
      m.epoch += 1;
    }
    return n;
  }


  /** Prende el interruptor (`clean_min_version`) con la base en la versión 12. Llamarlo después de los otros `enable`. */
  enableClean(minVersion = 0.001): void {
    this.settings = {
      ...(this.settings ?? { generation: 1, minAppVersion: null, mediaUrl: null, schemaVersion: 1 }),
      schemaVersion: Math.max(this.settings?.schemaVersion ?? 1, CLEAN_SCHEMA_VERSION),
      cleanMinVersion: minVersion,
    };
  }

  /** El interruptor está prendido (y la base lo tiene). */
  cleanOn(): boolean {
    return (this.settings?.schemaVersion ?? 0) >= CLEAN_SCHEMA_VERSION && this.settings?.cleanMinVersion != null;
  }

  meta(pageId: string): { seq: number; at: number | null; reset: number } {
    let m = this.cleanMeta.get(pageId);
    if (!m) {
      m = { seq: 0, at: null, reset: 0 };
      this.cleanMeta.set(pageId, m);
    }
    return m;
  }

  /** `private.sees_deleted`: Editar o más y no invitado. Sin las reglas del equipo, todos (el dueño). */
  seesDeleted(uid: string, pageId: string): boolean {
    return !this.team || (this.pageLevel(uid, pageId) >= 3 && this.role(uid) !== 'guest');
  }

  /**
   * Los links públicos vivos (Docs/Doc_Link_Publico.md), por token: su página y quién lo creó. Los usa el cliente del modo
   * link de las pruebas (`linkTesting.ts`).
   */
  readonly publicLinks = new Map<string, { id: string; pageId: string; createdBy: string; revoked?: boolean }>();

  /** `private.has_plain_readers`: alguien activo con Ver o Comentar, un invitado con cualquier nivel, o un link vivo. */
  hasPlainReaders(pageId: string): boolean {
    if (!this.team) return false;
    for (const l of this.publicLinks.values()) {
      if (l.revoked) continue;
      for (let cur: string | null = pageId, n = 0; cur && n < 10000; cur = this.pages.get(cur)?.parent_id ?? null, n++) {
        if (cur === l.pageId) return true;
      }
    }
    for (const [uid, m] of this.members) {
      if (m.removed_at) continue;
      const level = this.pageLevel(uid, pageId);
      if ((m.role === 'guest' && level >= 1) || (m.role !== 'guest' && level >= 1 && level <= 2)) return true;
    }
    return false;
  }

  /** `private.current_clean_base`. */
  currentBase(pageId: string): { id: string; toSeq: number; lastUpdateId: number; state: Uint8Array } | null {
    const b = this.cleanBases.get(pageId);
    const page = this.pages.get(pageId);
    if (!b || !page) return null;
    if ((this.cleanMutant !== 'noreset' && b.toSeq < this.meta(pageId).reset) || b.toSeq > page.update_seq) return null;
    const row = (this.updates.get(pageId) ?? []).find((u) => u.seq === b.toSeq);
    return row && (row.id ?? row.seq) === b.lastUpdateId ? b : null;
  }

  /** `private.clean_reset`: la página y su rama, o todo el proyecto. */
  cleanReset(target: { projectId: string } | { pageId: string }): void {
    if (this.cleanMutant === 'noshare') return;
    const ids =
      'projectId' in target
        ? [...this.pages.values()].filter((p) => p.workspace_id === target.projectId).map((p) => p.id)
        : this.branch(target.pageId);
    for (const id of ids) {
      const page = this.pages.get(id);
      if (!page) continue;
      const m = this.meta(id);
      m.reset = page.update_seq;
      if (m.seq < page.update_seq) m.seq = 0;
    }
  }

  /** La página y las de adentro. */
  branch(pageId: string): string[] {
    const out = [pageId];
    for (let i = 0; i < out.length; i++) {
      for (const p of this.pages.values()) if (p.parent_id === out[i] && !out.includes(p.id)) out.push(p.id);
    }
    return out;
  }
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
  readonly loseCommentResponse = new Set<'add' | 'edit' | 'delete' | 'resolve' | 'import' | 'mentions'>();
  /** Funciones de comentarios que fallan una vez como un 500, por el comienzo de su nombre. */
  readonly failCommentOnce = new Set<string>();
  /** La base tiene las menciones (versión 15, 20261015120000_menciones.sql). */
  mentionsEnabled = false;
  /** La entrega 2: filas sin acceso y `share_for_mention` (versión 16, 20261016120000_menciones_e2.sql). */
  mentionSharingEnabled = false;
  /** Las llamadas a `share_for_mention` (`<página> <persona>`). */
  readonly mentionShares: string[] = [];
  /** `comment_mentions`, con las filas sacadas (`removed_at`): nada se borra. */
  readonly mentions: {
    id: string;
    comment_id: string;
    page_id: string;
    user_id: string;
    mentioned_by: string;
    label: string;
    created_at: string;
    updated_at: string;
    removed_at: string | null;
    read_at: string | null;
  }[] = [];
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

  /** Prende las menciones: la base en la versión 15, con `list_comments` (y las reglas del equipo). */
  enableMentions(): void {
    this.enableImportedComments();
    this.listCommentsEnabled = true;
    this.mentionsEnabled = true;
    this.settings = { ...this.settings!, schemaVersion: MENTIONS_SCHEMA_VERSION };
  }

  /** La entrega 2 de las menciones (ME2): la base en la versión 16. */
  enableMentionSharing(): void {
    this.enableMentions();
    this.mentionSharingEnabled = true;
    this.settings = { ...this.settings!, schemaVersion: 16 };
  }

  /** `private.page_in_trash`: ella o una de arriba en la papelera. */
  pageInTrash(pageId: string): boolean {
    const seen = new Set<string>();
    for (let cur: string | null = pageId; cur && !seen.has(cur); cur = this.pages.get(cur)?.parent_id ?? null) {
      seen.add(cur);
      if (this.pages.get(cur)?.deleted_at) return true;
    }
    return false;
  }

  /** `private.mention_allowed` (Docs/Doc_Menciones.md, sección 4). */
  mentionAllowed(pageId: string, caller: string, target: string): boolean {
    const cr = this.role(caller);
    const tr = this.role(target);
    if (!target || target === caller || !cr || !tr || this.pageLevel(target, pageId) < 1) return false;
    if (cr === 'owner' || cr === 'admin' || (cr !== 'guest' && tr !== 'guest')) return true;
    for (const c of this.comments.values()) {
      if (c.page_id === pageId && !c.deleted_at && [c.author_id, c.resolved_by, c.imported_by].includes(target)) return true;
    }
    return (
      cr === 'guest' &&
      (this.grants.some((g) => g.user_id === caller && g.granted_by === target) ||
        this.invitations.some((i) => i.used_by === caller && i.invited_by === target))
    );
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

  /** `private.can_see_file_trash`. Sin las reglas del equipo, solo el dueño. Nunca un invitado (privacidad de lo borrado). */
  canSeeFileTrash(uid: string, projectId: string): boolean {
    if (!this.team) return uid === this.ownerId;
    const role = this.role(uid);
    if (role === 'guest') return false;
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
      // Como tiene que hacer el script de restaurar desde la privacidad de lo borrado (requisito para prender el
      // interruptor): sin bases, y las que vengan tienen que llegar a lo restaurado. Sin el script (`keepCleanBases`),
      // las bases quedan y la vigencia mira el id de su fila final.
      if (!this.keepCleanBasesOnRestore) {
        this.cleanBases.clear();
        this.cleanMeta.clear();
        for (const p of this.pages.values()) this.meta(p.id).reset = p.update_seq;
      }
      // Como tiene que hacer el script de restaurar antes de prender los snapshots (Docs/Doc_Compactar.md, sección 9):
      // `page_snapshots` vacía, `snapshot_seq` en 0 y la época de contenido que nunca vuelve atrás (la de hoy se queda).
      if (!this.keepSnapshotsOnRestore) {
        this.snapshots.splice(0);
        this.compaction.clear();
        for (const m of this.snapshotMeta.values()) m.seq = 0;
      }
    };
  }

  /** Restaurar sin el paso del script que vacía las bases (para probar la vigencia por el id de la fila final). */
  keepCleanBasesOnRestore = false;

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
    // La papelera de páginas (20261009120000_papelera_lectores.sql): en la papelera (ella o una de arriba) solo
    // quien puede editar y no es invitado. Como `user_page_level_any`, `ignoreDeleted` no la mira.
    if (!ignoreDeleted && level > 0 && (level < 3 || this.role(uid) === 'guest')) {
      for (const id of chain) if (this.pages.get(id)?.deleted_at) return 0;
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
  /** `/verify` no contesta (se cortó la red justo ahí). */
  failVerify = false;
  /** Drive no da el MD5 en `/verify` (pasa con algunos archivos). */
  noMd5 = false;
  /** El portero no encuentra nada por la marca (lo que subió se perdió del todo): `only: 'known'` responde `unknown`. */
  forgetMarks = false;
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
      // Ya está en Drive pero la base no se enteró (o, desde la entrega 2 de P.10, el portero lo encuentra por su
      // marca `sdFile`, fuera de la papelera de Drive y con el mismo peso): se le avisa ahora.
      const stored = this.forgetMarks
        ? undefined
        : [...this.drive].find(([driveId, d]) => d.file === id && d.data.length === media.size && !this.driveTrash.has(driveId));
      if (stored) {
        const linked = this.link(id, stored[0]);
        return json({ status: 'done', file: { id: stored[0], name: media.name, mimeType: media.mime, size: media.size }, linked });
      }
      // `only: 'known'`: el portero no lo recuerda ni lo encuentra; no abre nada.
      if (body?.only === 'known') return json({ status: 'unknown' });
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
      if (this.failVerify) throw new TypeError('Failed to fetch');
      const results: Record<string, unknown> = {};
      for (const id of (body?.files as string[]) ?? []) {
        const media = this.server.mediaFiles.get(id);
        if (!media || this.hidden.has(id)) results[id] = { error: 'not found', code: 'not_found' };
        else if (!media.drive_id) results[id] = { error: 'not uploaded', code: 'not_uploaded' };
        else if (!this.drive.has(media.drive_id)) results[id] = { error: 'missing', code: 'drive_missing' };
        else {
          const d = this.drive.get(media.drive_id)!;
          results[id] = {
            driveId: media.drive_id,
            size: d.data.length,
            trashed: this.driveTrash.has(media.drive_id),
            marked: d.file === id,
            md5: this.noMd5 ? null : new Md5().update(d.data).digest(),
          };
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

export class FakeRemote
  implements
    Remote,
    MediaRemote,
    TeamRemote,
    CommentRemote,
    MentionsRemote,
    ProjectStatesRemote,
    HistoryRemote,
    NamedVersionsRemote,
    SnapshotsRemote
{
  /** La sesión: por defecto, el dueño del workspace. */
  readonly userId: string;
  readonly email: string;

  /**
   * Si los pedidos llevan el header con la versión (`x-shotdocs-version`), como el cliente de la app desde v0.099
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

  /** Como el cliente de verdad: los snapshots prendidos según los últimos ajustes leídos (`SupabaseRemote.snapshotsOn`). */
  private snapshotsOn = false;
  /** Como el cliente de verdad: cuándo vio que faltaba `pull_page_content`. */
  private pullContentMissingAt = 0;

  async fetchWorkspaceSettings(): Promise<WorkspaceSettings | null> {
    this.server.check();
    this.snapshotsOn = this.server.snapshotsOn();
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

  async fetchTree(projectIds: string[], schemaVersion?: number | null): Promise<PageRow[]> {
    this.server.check();
    const ids = new Set(projectIds);
    // `clean_seq`, como pide la columna la app: con la versión 12 o más (y si la base la tiene).
    const clean = (schemaVersion ?? 0) >= CLEAN_SCHEMA_VERSION && (this.server.settings?.schemaVersion ?? 0) >= CLEAN_SCHEMA_VERSION;
    // `snapshot_seq` y `content_epoch`: con la versión 17 o más (y si la base las tiene).
    const snap = (schemaVersion ?? 0) >= SNAPSHOT_SCHEMA_VERSION && this.server.snapshotsMigrated();
    return [...this.server.pages.values()]
      .filter((p) => ids.has(p.workspace_id) && !this.server.projectDeleted(p.workspace_id))
      // `can_view_page_row`: el nivel de la página ya cuenta el del proyecto, el del dueño, los de arriba y la papelera.
      .filter((p) => !this.team || this.server.pageLevel(this.userId, p.id) >= 1)
      .map((p) => ({
        ...p,
        ...(clean ? { clean_seq: this.server.cleanMeta.get(p.id)?.seq ?? 0 } : {}),
        ...(snap ? { snapshot_seq: this.server.smeta(p.id).seq, content_epoch: this.server.smeta(p.id).epoch } : {}),
      }));
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
    // `pages_clean_move`: mover a una rama con lectores reinicia la página y su rama.
    if (patch.parent_id !== undefined && patch.parent_id !== page.parent_id && this.server.hasPlainReaders(id)) {
      this.server.cleanReset({ pageId: id });
    }
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
    this.server.contentCalls.push('pull_page_updates');
    return this.serveUpdates(pageId, afterSeq, limit);
  }

  /** `pull_page_updates` en la base (sin anotar el pedido: `pull_page_content` lo llama por dentro). */
  private serveUpdates(pageId: string, afterSeq: number, limit: number): RemoteUpdate[] {
    if (
      !this.server.pages.has(pageId) ||
      this.server.pageInDeletedProject(pageId) ||
      (this.team && this.server.pageLevel(this.userId, pageId) < 1)
    ) {
      throw new RemoteError('page_not_found', true, 'P0002');
    }
    // Con el interruptor prendido, quien no ve lo borrado recibe solo la base vigente (o nada).
    if (this.server.cleanOn() && !this.server.seesDeleted(this.userId, pageId) && this.server.cleanMutant !== 'raw') {
      const base = this.server.currentBase(pageId);
      return base && base.toSeq > afterSeq ? [{ seq: base.toSeq, data: base.state.slice() }] : [];
    }
    return (this.server.updates.get(pageId) ?? [])
      .filter((u) => u.seq > afterSeq)
      .slice(0, Math.min(Math.max(limit, 1), 1000))
      .map((u) => ({ seq: u.seq, data: u.data.slice() }));
  }

  // --- compactar: los snapshots (20261019120000_compactar_leer.sql) ------------------------------------------------

  /**
   * Como `SupabaseRemote.pullContent`: apagados (según los últimos ajustes leídos) o sin la función, `pullUpdates`; si
   * no, `pull_page_content` con las mismas reglas que la base.
   */
  async pullContent(pageId: string, afterSeq: number, limit: number): Promise<RemoteUpdate[]> {
    if (!this.snapshotsOn || Date.now() - this.pullContentMissingAt < 10 * 60_000) return this.pullUpdates(pageId, afterSeq, limit);
    this.server.check();
    if (this.server.pullContentMissing || !this.server.snapshotsMigrated()) {
      this.pullContentMissingAt = Date.now();
      return this.pullUpdates(pageId, afterSeq, limit);
    }
    this.server.contentCalls.push('pull_page_content');
    const lim = Math.min(Math.max(limit, 1), 1000);
    // `pull_page_updates` mira el permiso de ver y tira `page_not_found` igual que `pull_page_content`.
    const epoch = this.server.pages.has(pageId) ? this.server.smeta(pageId).epoch : 0;
    const withEpoch = (rows: RemoteUpdate[]) => rows.map((r) => ({ ...r, contentEpoch: epoch }));
    if (!this.server.pages.has(pageId) || this.server.pageInDeletedProject(pageId) || (this.team && this.server.pageLevel(this.userId, pageId) < 1)) {
      throw new RemoteError('page_not_found', true, 'P0002');
    }
    if (!this.server.seesDeleted(this.userId, pageId)) return withEpoch(this.serveUpdates(pageId, afterSeq, lim));
    const sn = this.server.currentSnapshot(pageId);
    const rows = this.server.updates.get(pageId) ?? [];
    const replaced = rows.filter((u) => u.seq > afterSeq && u.seq <= (sn?.upToSeq ?? 0)).reduce((n, u) => n + u.data.length, 0);
    if (!sn || sn.upToSeq <= afterSeq || sn.state.length >= replaced) return withEpoch(this.serveUpdates(pageId, afterSeq, lim));
    this.server.snapshotsServed++;
    const out: RemoteUpdate[] = [{ seq: sn.upToSeq, data: sn.state.slice(), snapshotId: sn.id }];
    if (lim > 1) out.push(...rows.filter((u) => u.seq > sn.upToSeq).slice(0, lim - 1).map((u) => ({ seq: u.seq, data: u.data.slice() })));
    return withEpoch(out);
  }

  /** Como `private.snapshots_allowed`. */
  private snapshotsAllowed(): boolean {
    const min = this.server.settings?.minAppVersion;
    const snap = this.server.settings?.snapshotMinVersion;
    if (!this.server.snapshotsOn() || snap == null) return false;
    if (!/^\d{1,4}(\.\d{1,3})?$/.test(this.appVersion)) return false;
    const v = Number(this.appVersion);
    return v >= snap && (min == null || v >= min);
  }

  /** Ver la página (`can_view_page`), o `page_not_found`. */
  private snapshotView(pageId: string): void {
    this.server.check();
    if (!this.server.snapshotsMigrated()) throw new RemoteError('Could not find the function', true, 'PGRST202');
    if (!this.server.pages.has(pageId) || this.server.pageInDeletedProject(pageId) || (this.team && this.server.pageLevel(this.userId, pageId) < 1)) {
      throw new RemoteError('page_not_found', true, 'P0002');
    }
  }

  /** Un snapshot que la sesión ve (su página), o `snapshot_not_found`. */
  private snapshotById(id: string): StoredSnapshot {
    this.server.check();
    if (!this.server.snapshotsMigrated()) throw new RemoteError('Could not find the function', true, 'PGRST202');
    const sn = this.server.snapshots.find((x) => x.id === id);
    if (!sn || this.server.pageInDeletedProject(sn.pageId) || (this.team && this.server.pageLevel(this.userId, sn.pageId) < 1)) {
      throw new RemoteError('snapshot_not_found', true, 'P0002');
    }
    return sn;
  }

  async claimCompaction(pageId: string): Promise<CompactionClaim | null> {
    this.snapshotView(pageId);
    const page = this.server.pages.get(pageId)!;
    if (!this.server.seesDeleted(this.userId, pageId) || !this.snapshotsAllowed() || this.server.pageInTrash(pageId)) return null;
    const now = this.server.now();
    const c = this.server.compaction.get(pageId);
    if (c?.skipUntil != null && c.skipUntil > now) return null;
    if (c?.claimAt != null && c.claimAt > now - 10 * 60_000 && c.claimBy !== this.userId) return null;
    const cur = this.server.currentSnapshot(pageId);
    const baseSeq = cur?.upToSeq ?? 0;
    const top = page.update_seq;
    if (top - baseSeq < this.server.snapshotMinRows) return null;
    const rows = this.server.updates.get(pageId) ?? [];
    const tail = rows.filter((u) => u.seq > baseSeq && u.seq <= top).reduce((n, u) => n + u.data.length, 0);
    if (tail < this.server.snapshotMinTailBytes || tail < (cur?.state.length ?? 0) / 2) return null;
    const last = rows.find((u) => u.seq === top);
    if (!last) return null;
    this.server.compaction.set(pageId, { skipUntil: null, skipWhy: null, ...c, claimAt: now, claimBy: this.userId });
    return { baseId: cur?.id ?? null, baseSeq, upToSeq: top, lastUpdateId: last.id ?? last.seq };
  }

  async pushSnapshot(n: NewSnapshot): Promise<SnapshotPushResult> {
    this.snapshotView(n.pageId);
    const page = this.server.pages.get(n.pageId)!;
    if (!this.server.seesDeleted(this.userId, n.pageId)) throw this.denied('not_allowed');
    if (this.server.settings?.snapshotMinVersion == null) throw new RemoteError('snapshot_off', true, 'P0001');
    if (!this.snapshotsAllowed()) throw new RemoteError('app_outdated', true, 'P0001');
    if (n.state.length === 0 || n.state.length > 8 * 1024 * 1024) throw new RemoteError('state_size_invalid', true, '22023');
    if ((await sha256Hex(n.state)) !== n.sha256) throw new RemoteError('sha256_mismatch', true, '22023');
    const row = (this.server.updates.get(n.pageId) ?? []).find((u) => u.seq === n.upToSeq);
    if (n.upToSeq < 1 || n.upToSeq > page.update_seq || !row || (row.id ?? row.seq) !== n.lastUpdateId) {
      throw new RemoteError('snapshot_row_mismatch', true, 'P0001');
    }
    const ver = Number(this.appVersion);
    const other = this.server.snapshots.find((x) => x.pageId === n.pageId && x.upToSeq === n.upToSeq && x.invalidAt === null);
    const now = this.server.now();
    const make = (base: StoredSnapshot | null, invalid: boolean): StoredSnapshot => {
      const id = crypto.randomUUID();
      return {
        id, pageId: n.pageId, upToSeq: n.upToSeq, lastUpdateId: n.lastUpdateId, baseId: n.baseId,
        chainId: invalid ? id : base?.chainId ?? id,
        chainMinVersion: invalid ? ver : Math.min(base?.chainMinVersion ?? ver, ver),
        state: n.state.slice(), sv: n.sv.slice(), sha256: n.sha256, appVersion: ver, createdBy: this.userId, createdAt: now,
        confirmedAt: null, invalidAt: invalid ? now : null, invalidReason: invalid ? 'snapshot_mismatch' : null,
      };
    };
    if (other) {
      if (other.baseId === n.baseId && other.sha256 === n.sha256) return { id: other.id, result: 'ok' };
      if (other.baseId === n.baseId && other.appVersion === ver) {
        const bad = make(null, true);
        this.server.snapshots.push(bad);
        this.server.invalidateChain(n.pageId, other.chainId, 'snapshot_mismatch');
        return { id: bad.id, result: 'snapshot_mismatch' };
      }
      return { id: other.id, result: 'snapshot_exists' };
    }
    const cur = this.server.currentSnapshot(n.pageId);
    if ((cur?.id ?? null) !== n.baseId || n.upToSeq <= (cur?.upToSeq ?? 0)) throw new RemoteError('snapshot_base_stale', true, 'P0001');
    const sn = make(cur, false);
    this.server.snapshots.push(sn);
    return { id: sn.id, result: 'ok' };
  }

  async pullSnapshot(id: string): Promise<Uint8Array> {
    const sn = this.snapshotById(id);
    if (!this.server.seesDeleted(this.userId, sn.pageId)) throw this.denied('not_allowed');
    if (sn.invalidAt !== null) throw new RemoteError('snapshot_not_found', true, 'P0002');
    if (sn.confirmedAt === null ? sn.createdBy !== this.userId : this.server.currentSnapshot(sn.pageId)?.id !== sn.id) {
      throw new RemoteError('snapshot_not_found', true, 'P0002');
    }
    return sn.state.slice();
  }

  async confirmSnapshot(id: string, sha256: string): Promise<boolean> {
    const sn = this.snapshotById(id);
    if (!this.server.seesDeleted(this.userId, sn.pageId) || sn.createdBy !== this.userId) throw this.denied('not_allowed');
    const min = this.server.settings?.snapshotMinVersion;
    if (min == null) throw new RemoteError('snapshot_off', true, 'P0001');
    if (sha256 !== sn.sha256) throw new RemoteError('sha256_mismatch', true, '22023');
    if (sn.invalidAt !== null) return false;
    if (sn.confirmedAt !== null) return true;
    const page = this.server.pages.get(sn.pageId)!;
    const cur = this.server.currentSnapshot(sn.pageId);
    const row = (this.server.updates.get(sn.pageId) ?? []).find((u) => u.seq === sn.upToSeq);
    if ((cur?.id ?? null) !== sn.baseId || sn.upToSeq <= (cur?.upToSeq ?? 0) || sn.upToSeq > page.update_seq) return false;
    if (!row || (row.id ?? row.seq) !== sn.lastUpdateId || sn.chainMinVersion < min) return false;
    const now = this.server.now();
    sn.confirmedAt = now;
    this.server.smeta(sn.pageId).seq = sn.upToSeq;
    const c = this.server.compaction.get(sn.pageId);
    if (c) Object.assign(c, { claimAt: null, claimBy: null });
    // La limpieza: quedan este y su base.
    const baseSeq = cur?.upToSeq ?? sn.upToSeq;
    const drop = (x: StoredSnapshot) =>
      x.pageId === sn.pageId && x.id !== sn.id && x.id !== cur?.id &&
      ((x.confirmedAt !== null && x.invalidAt === null && x.upToSeq < baseSeq) ||
        (x.confirmedAt === null && x.invalidAt === null && x.createdAt < now - 86_400_000) ||
        (x.invalidAt !== null && x.invalidAt < now - 30 * 86_400_000));
    const keep = this.server.snapshots.filter((x) => !drop(x));
    this.server.snapshots.splice(0, this.server.snapshots.length, ...keep);
    return true;
  }

  async skipCompaction(pageId: string, reason: string): Promise<void> {
    this.snapshotView(pageId);
    if (!this.server.seesDeleted(this.userId, pageId)) throw this.denied('not_allowed');
    this.server.compaction.set(pageId, { claimAt: null, claimBy: null, skipUntil: this.server.now() + 86_400_000, skipWhy: reason.slice(0, 500) });
  }

  async invalidateSnapshot(id: string, reason: string): Promise<boolean> {
    const sn = this.snapshotById(id);
    // Quien ve lo borrado, como el resto de compactar (20261020120000_compactar_crear.sql; antes, Editar alcanzaba).
    if (!this.server.seesDeleted(this.userId, sn.pageId)) throw this.denied('not_allowed');
    return this.server.invalidateChain(sn.pageId, sn.chainId, reason.slice(0, 500)) > 0;
  }

  /** Como `private.clean_version_allowed`. */
  private cleanVersionAllowed(): boolean {
    const min = this.server.settings?.minAppVersion;
    const clean = this.server.settings?.cleanMinVersion;
    if (!this.server.cleanOn() || clean == null) return false;
    if (!/^\d{1,4}(\.\d{1,3})?$/.test(this.appVersion)) return false;
    const v = Number(this.appVersion);
    return v >= clean && (min == null || v >= min);
  }

  /** `clean_work` (la cadencia de la sección 4.1 del doc, con el reloj del servidor). */
  async cleanWork({ pages, urgent = false }: { pages?: string[]; urgent?: boolean } = {}): Promise<CleanWorkRow[]> {
    this.server.check();
    this.server.cleanWorkCalls++;
    if ((this.team && !this.server.role(this.userId)) || !this.cleanVersionAllowed()) return [];
    const now = this.server.now();
    const out: CleanWorkRow[] = [];
    for (const page of this.server.pages.values()) {
      if (pages && !pages.includes(page.id)) continue;
      if (page.update_seq === 0 || this.server.pageInDeletedProject(page.id)) continue;
      const base = this.server.currentBase(page.id);
      const m = this.server.meta(page.id);
      if (base && page.update_seq <= m.seq) continue;
      const last = (this.server.updates.get(page.id) ?? []).find((u) => u.seq === page.update_seq);
      if (!last) continue;
      const f = Math.max(1, (this.server.cleanBases.get(page.id)?.state.length ?? 0) / 102400);
      const lastAt = last.createdAt ? Date.parse(last.createdAt) : 0;
      const due = !base || urgent || lastAt < now - 20_000 * f || m.at === null || m.at < now - 120_000 * f;
      if (!due || !this.server.seesDeleted(this.userId, page.id) || !this.server.hasPlainReaders(page.id)) continue;
      out.push({ page_id: page.id, update_seq: page.update_seq, last_update_id: last.id ?? last.seq, clean_seq: m.seq, base_bytes: 0 });
    }
    return out.slice(0, 50);
  }

  /** `push_clean_base`, con las mismas comprobaciones y respuestas. */
  async pushCleanBase(b: NewCleanBase): Promise<CleanPushResult> {
    this.server.check();
    const page = this.server.pages.get(b.pageId);
    const done = (result: CleanPushResult) => {
      this.server.cleanPushes.push({ pageId: b.pageId, toSeq: b.toSeq, result, by: this.userId });
      return result;
    };
    if (!page || this.server.pageInDeletedProject(b.pageId) || (this.team && this.server.pageLevel(this.userId, b.pageId) < 1)) {
      throw new RemoteError('page_not_found', true, 'P0002');
    }
    if (!this.server.seesDeleted(this.userId, b.pageId)) throw this.denied('not_allowed');
    if (!this.server.cleanOn()) throw new RemoteError('clean_off', true, 'P0001');
    if (!this.cleanVersionAllowed()) throw new RemoteError('app_outdated', true, 'P0001');
    const current = this.server.cleanBases.get(b.pageId);
    if (current?.id === b.id) return done('ok');
    if (b.state.length === 0 || b.state.length > 8 * 1024 * 1024) throw new RemoteError('state_size_invalid', true, '22023');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', b.state as Uint8Array<ArrayBuffer>));
    if ([...digest].map((x) => x.toString(16).padStart(2, '0')).join('') !== b.sha256) {
      throw new RemoteError('sha256_mismatch', true, '22023');
    }
    const row = (this.server.updates.get(b.pageId) ?? []).find((u) => u.seq === b.toSeq);
    if (b.toSeq < 1 || b.toSeq > page.update_seq || !row || (row.id ?? row.seq) !== b.lastUpdateId) {
      throw new RemoteError('clean_row_mismatch', true, 'P0001');
    }
    const m = this.server.meta(b.pageId);
    if (b.toSeq < m.reset && this.server.cleanMutant !== 'noreset') return done('clean_stale');
    const vigente = this.server.currentBase(b.pageId);
    if (vigente && b.toSeq <= vigente.toSeq) {
      m.seq = vigente.toSeq;
      return done('clean_old');
    }
    this.server.cleanBases.set(b.pageId, { id: b.id, toSeq: b.toSeq, lastUpdateId: b.lastUpdateId, state: b.state.slice(), createdBy: this.userId });
    m.seq = b.toSeq;
    m.at = this.server.now();
    return done('ok');
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

  // --- Versiones con nombre (las reglas de 20261011120000_versiones_con_nombre.sql) ------------------------------------

  private checkVersions(pageId: string): void {
    if (this.server.versionsMissing) throw new RemoteError('Could not find the function public.list_page_versions', true, 'PGRST202');
    this.checkHistory(pageId);
  }

  private rowOf(pageId: string, seq: number): { id: number; createdBy: string | null } | null {
    const u = (this.server.updates.get(pageId) ?? []).find((x) => x.seq === seq);
    return u ? { id: u.id ?? u.seq, createdBy: u.createdBy === undefined ? this.server.ownerId : u.createdBy } : null;
  }

  private static plain(v: FakeServer['versions'][number]): PageVersionRow {
    return { id: v.id, seq: v.seq, kind: v.kind, label: v.label, restoredFromSeq: v.restoredFromSeq, createdBy: v.createdBy, createdAt: v.createdAt };
  }

  private static label(label: string): string {
    const v = label.replace(/\s+/g, ' ').trim();
    if (v.length < 1 || v.length > 100) throw new RemoteError('label_invalid', true, '22023');
    return v;
  }

  async listPageVersions(pageId: string): Promise<PageVersionRow[]> {
    this.checkVersions(pageId);
    return this.server.versions
      .filter((v) => v.pageId === pageId && v.removedAt === null && this.rowOf(pageId, v.seq)?.id === v.updateId)
      .sort((a, b) => a.seq - b.seq || a.createdAt.localeCompare(b.createdAt))
      .map((v) => FakeRemote.plain(v));
  }

  async namePageVersion(id: string, pageId: string, seq: number, label: string): Promise<PageVersionRow> {
    this.checkVersions(pageId);
    const known = this.server.versions.find((v) => v.id === id);
    if (known) {
      if (known.pageId !== pageId || known.seq !== seq || known.kind !== 'named') throw new RemoteError('version_conflict', true, 'P0001');
      if (known.removedAt) throw new RemoteError('version_not_found', true, 'P0002');
      return FakeRemote.plain(known);
    }
    const text = FakeRemote.label(label);
    const row = this.rowOf(pageId, seq);
    if (!row) throw new RemoteError('version_not_found', true, 'P0002');
    if (this.server.versions.some((v) => v.pageId === pageId && v.seq === seq && v.kind === 'named' && v.removedAt === null)) {
      throw new RemoteError('version_named', true, 'P0001');
    }
    this.checkWriteVersion();
    const v = {
      id,
      pageId,
      seq,
      updateId: row.id,
      kind: 'named' as const,
      label: text,
      restoredFromSeq: null,
      createdBy: this.userId,
      createdAt: new Date(this.server.now()).toISOString(),
      removedAt: null,
      removedBy: null,
    };
    this.server.versions.push(v);
    return FakeRemote.plain(v);
  }

  private manageable(id: string): FakeServer['versions'][number] {
    const v = this.server.versions.find((x) => x.id === id);
    if (!v) throw new RemoteError('version_not_found', true, 'P0002');
    this.checkVersions(v.pageId);
    return v;
  }

  private checkManage(v: FakeServer['versions'][number]): void {
    if (v.kind !== 'named') throw new RemoteError('version_not_named', true, 'P0001');
    if (v.createdBy !== this.userId && this.team && this.server.pageLevel(this.userId, v.pageId) < 4) {
      throw new RemoteError('not_allowed', true, '42501');
    }
  }

  async renamePageVersion(id: string, label: string): Promise<PageVersionRow> {
    const v = this.manageable(id);
    if (v.removedAt) throw new RemoteError('version_not_found', true, 'P0002');
    this.checkManage(v);
    const text = FakeRemote.label(label);
    if (text !== v.label) {
      this.checkWriteVersion();
      v.label = text;
    }
    return FakeRemote.plain(v);
  }

  async removePageVersion(id: string): Promise<void> {
    const v = this.manageable(id);
    this.checkManage(v);
    if (v.removedAt) return;
    this.checkWriteVersion();
    v.removedAt = new Date(this.server.now()).toISOString();
    v.removedBy = this.userId;
  }

  async markPageRestored(id: string, pageId: string, seq: number, fromSeq: number): Promise<PageVersionRow> {
    this.checkVersions(pageId);
    const known = this.server.versions.find((v) => v.id === id);
    if (known) {
      if (known.pageId !== pageId || known.seq !== seq || known.kind !== 'restore' || known.restoredFromSeq !== fromSeq) {
        throw new RemoteError('version_conflict', true, 'P0001');
      }
      return FakeRemote.plain(known);
    }
    const row = this.rowOf(pageId, seq);
    if (!(fromSeq < seq) || !this.rowOf(pageId, fromSeq) || !row || row.createdBy !== this.userId) {
      throw new RemoteError('version_not_found', true, 'P0002');
    }
    this.checkWriteVersion();
    const v = {
      id,
      pageId,
      seq,
      updateId: row.id,
      kind: 'restore' as const,
      label: null,
      restoredFromSeq: fromSeq,
      createdBy: this.userId,
      createdAt: new Date(this.server.now()).toISOString(),
      removedAt: null,
      removedBy: null,
    };
    this.server.versions.push(v);
    return FakeRemote.plain(v);
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
    // Al invitar (no al aceptar): a un invitado, o con Ver o Comentar, lo alcanzado empieza de una base nueva.
    for (const g of grants) {
      if (role === 'guest' || g.level === 'view' || g.level === 'comment') {
        this.server.cleanReset('project_id' in g ? { projectId: g.project_id } : { pageId: g.page_id });
      }
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
    const id = this.server.grant(userId, target, level);
    // Con Ver, Comentar o a un invitado, lo alcanzado empieza de una base nueva.
    if (level === 'view' || level === 'comment' || this.server.role(userId) === 'guest') this.server.cleanReset(target);
    return id;
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
      // Los usos sacados, solo a quien ve lo borrado de la página.
      const seesRemoved = this.server.seesDeleted(this.userId, pageId);
      for (const [set, removed, foreign] of [
        [this.server.pageFiles, false, false],
        [this.server.removedPageFiles, true, false],
        [this.server.foreignPageFiles, false, true],
      ] as const) {
        for (const key of set) {
          const [p, f] = key.split(':');
          if (p === pageId && (!removed || seesRemoved)) {
            rows.push({ page_id: p, file_id: f, removed_at: removed ? new Date().toISOString() : null, is_foreign: foreign });
          }
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
    // Una función que falla una vez como un 500 (se arregla sola), por el comienzo de su nombre (`edit`, `set_comment_mentions`).
    for (const prefix of this.server.failCommentOnce) {
      if (name.startsWith(prefix)) {
        this.server.failCommentOnce.delete(prefix);
        throw new RemoteError('Internal Server Error', false, '500');
      }
    }
  }

  private lostCommentResponse(name: 'add' | 'edit' | 'delete' | 'resolve' | 'import' | 'mentions'): void {
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
      .map((c) => ({
        ...c,
        body: c.deleted_at ? null : c.body,
        updated_at: c.updated_at ?? c.created_at,
        // Desde la versión 15, las menciones activas al final (nulo si se borró).
        ...(this.server.mentionsEnabled
          ? {
              mentions: c.deleted_at
                ? null
                : this.server.mentions
                    .filter((m) => m.comment_id === c.id && !m.removed_at)
                    .map((m) => ({ user_id: m.user_id, label: m.label })),
            }
          : {}),
      }));
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
    // Las mencionadas en comentarios sin borrar (versión 15).
    for (const m of this.server.mentions) {
      if (m.page_id === pageId && !m.removed_at && !this.server.comments.get(m.comment_id)?.deleted_at) ids.add(m.user_id);
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

  // --- menciones (mismas reglas que supabase/migrations/20261015120000_menciones.sql) ---

  private mentionsCheck(name: string): void {
    this.commentCheck(name);
    if (!this.server.mentionsEnabled) throw new RemoteError(`Could not find the function public.${name.split(' ')[0]}`, true, 'PGRST202');
  }

  /** Lo que la sesión ve: miembro activo (como `workspace_role()`). */
  private get member(): boolean {
    return !this.team || !!this.server.role(this.userId);
  }

  async setCommentMentions(commentId: string, mentions: { user_id: string; label: string }[]): Promise<string[]> {
    this.mentionsCheck(`set_comment_mentions ${commentId}`);
    const invalid = () => new RemoteError('mentions_invalid', true, '22023');
    if (!Array.isArray(mentions) || mentions.length > 20) throw invalid();
    for (const m of mentions) {
      const label = typeof m?.label === 'string' ? m.label.trim() : '';
      if (
        Object.keys(m ?? {}).length !== 2 ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(m.user_id ?? '') ||
        label.length < 1 ||
        label.length > 64 ||
        // Los mismos caracteres que rechaza la base (también los invisibles).
        label !== cleanLabel(label)
      ) {
        throw invalid();
      }
    }
    const uid = this.userId;
    const wanted = mentions.map((m) => m.user_id);
    const cur = this.server.comments.get(commentId);
    const active = () => this.server.mentions.filter((m) => m.comment_id === commentId && !m.removed_at);
    // El reintento del mismo conjunto da bien antes de mirar el permiso.
    if (
      cur &&
      cur.author_id === uid &&
      !cur.deleted_at &&
      active().every((m) => wanted.includes(m.user_id)) &&
      wanted.every((w) => w === uid || active().some((m) => m.user_id === w))
    ) {
      this.lostCommentResponse('mentions');
      return active().map((m) => m.user_id);
    }
    const lvl = cur ? this.commentLevel(cur.page_id) : 0;
    if (!cur || lvl < 1) throw new RemoteError('comment_not_found', true, 'P0002');
    if (cur.author_id !== uid) throw new RemoteError('not_allowed', true, '42501');
    if (lvl < 2) throw new RemoteError('comment_denied', true, '42501');
    if (cur.deleted_at) throw new RemoteError('comment_deleted', true, 'P0001');
    this.checkWriteVersion();
    const accepted: string[] = [];
    let changed = false;
    const at = this.server.commentNow();
    for (const m of mentions) {
      if (accepted.includes(m.user_id) || !this.server.mentionAllowed(cur.page_id, uid, m.user_id)) continue;
      const label = m.label.trim();
      const row = this.server.mentions.find((r) => r.comment_id === commentId && r.user_id === m.user_id);
      if (!row) {
        this.server.mentions.push({
          id: crypto.randomUUID(), comment_id: commentId, page_id: cur.page_id, user_id: m.user_id, mentioned_by: uid,
          label, created_at: at, updated_at: at, removed_at: null, read_at: null,
        });
        changed = true;
      } else if (row.removed_at || row.label !== label) {
        Object.assign(row, { removed_at: null, label, updated_at: at });
        changed = true;
      }
      accepted.push(m.user_id);
    }
    for (const row of active()) {
      if (accepted.includes(row.user_id)) continue;
      Object.assign(row, { removed_at: at, updated_at: at });
      changed = true;
    }
    if (changed) cur.updated_at = at;
    this.lostCommentResponse('mentions');
    return accepted;
  }

  async mentionCandidates(pageId: string): Promise<MentionCandidate[]> {
    this.mentionsCheck('mention_candidates');
    const lvl = this.commentLevel(pageId);
    if (lvl < 1 || !this.member) throw new RemoteError('page_not_found', true, 'P0002');
    if (lvl < 2) throw new RemoteError('comment_denied', true, '42501');
    const inside: MentionCandidate[] = [...this.server.members]
      .filter(([id, m]) => !m.removed_at && this.server.mentionAllowed(pageId, this.userId, id))
      .map(([id, m]) => ({ userId: id, email: m.email, label: labelForEmail(m.email) }))
      .sort((a, b) => (a.email < b.email ? -1 : 1));
    // ME2 (20261016120000_menciones_e2.sql): solo el dueño y los admins que pueden compartir la página, fuera de la
    // papelera, reciben a quienes no la ven.
    if (!this.mentionOutsidersAllowed(pageId)) return inside;
    const outside: MentionCandidate[] = [...this.server.members]
      .filter(([id, m]) => !m.removed_at && id !== this.userId && this.server.pageLevel(id, pageId) < 1)
      .map(([id, m]) => ({ userId: id, email: m.email, label: labelForEmail(m.email), hasAccess: false as const }))
      .sort((a, b) => (a.email < b.email ? -1 : 1));
    return [...inside, ...outside];
  }

  private mentionOutsidersAllowed(pageId: string): boolean {
    const role = this.server.role(this.userId);
    return (
      this.server.mentionSharingEnabled &&
      (role === 'owner' || role === 'admin') &&
      this.canShare({ pageId }) &&
      !this.server.pageInTrash(pageId)
    );
  }

  /** `share_for_mention`: *Can comment* sobre esa página, con las mismas reglas que la base. */
  async shareForMention(pageId: string, userId: string): Promise<boolean> {
    this.mentionsCheck(`share_for_mention ${pageId}`);
    if (!this.server.mentionSharingEnabled) throw new RemoteError('Could not find the function public.share_for_mention', true, 'PGRST202');
    if (this.commentLevel(pageId) < 1 || !this.member) throw new RemoteError('page_not_found', true, 'P0002');
    const role = this.server.role(this.userId);
    if ((role !== 'owner' && role !== 'admin') || !this.canShare({ pageId })) throw this.denied('not_allowed');
    if (this.server.pageInTrash(pageId)) throw this.denied('page_in_trash');
    if (!this.server.role(userId)) throw new RemoteError('member_not_found', true, 'P0002');
    this.server.mentionShares.push(`${pageId} ${userId}`);
    if (userId === this.userId || this.server.pageLevel(userId, pageId) >= 1) return false;
    await this.share(userId, { pageId }, 'comment');
    return true;
  }

  /** Lo que `mentions_inbox` y `mentions_index` dan por ido. */
  private mentionGone(m: FakeServer['mentions'][number]): boolean {
    return !!m.removed_at || !!this.server.comments.get(m.comment_id)?.deleted_at || this.server.pageLevel(this.userId, m.page_id) < 1;
  }

  async mentionsInbox(since: string | null, limit: number): Promise<InboxResponse> {
    this.mentionsCheck('mentions_inbox');
    const now = this.server.commentNow();
    if (!this.server.role(this.userId)) return { now, unread: 0, rows: [] };
    const mine = this.server.mentions.filter((m) => m.user_id === this.userId);
    const unread = Math.min(mine.filter((m) => !m.read_at && !this.mentionGone(m)).length, 10);
    const rows = mine
      .filter((m) => since === null || m.updated_at >= since)
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
      .slice(0, Math.min(Math.max(limit || 30, 1), 50))
      .map((m) => {
        if (this.mentionGone(m)) return { id: m.id, gone: true, updated_at: m.updated_at };
        const c = this.server.comments.get(m.comment_id)!;
        const root = c.thread_id ? this.server.comments.get(c.thread_id) : null;
        const page = this.server.pages.get(m.page_id);
        return {
          id: m.id, gone: false, updated_at: m.updated_at, created_at: m.created_at, read_at: m.read_at,
          comment_id: m.comment_id, page_id: m.page_id, thread_id: c.thread_id, block_id: c.block_id, label: m.label,
          mentioned_by: m.mentioned_by, mentioned_by_email: this.server.members.get(m.mentioned_by)?.email ?? null,
          snippet: c.body.slice(0, 280), resolved: !!c.resolved_at || !!root?.resolved_at,
          page_title: page?.title ?? '', project_id: page?.workspace_id ?? null,
        };
      });
    return { now, unread, rows };
  }

  async mentionsIndex(): Promise<[string, boolean, boolean][]> {
    this.mentionsCheck('mentions_index');
    if (!this.server.role(this.userId)) return [];
    return this.server.mentions
      .filter((m) => m.user_id === this.userId)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 200)
      .map((m) => [m.id, this.mentionGone(m), !!m.read_at]);
  }

  async markMentionsRead(ids: string[] | null, upTo: string | null): Promise<number> {
    this.mentionsCheck('mark_mentions_read');
    this.server.commentCalls.push(`read ${ids?.length ?? 0} ${upTo ?? '-'}`);
    if (!this.server.role(this.userId)) return 0;
    const at = this.server.commentNow();
    let n = 0;
    for (const m of this.server.mentions) {
      if (m.user_id !== this.userId || m.read_at) continue;
      if ((ids ?? []).includes(m.id) || (upTo !== null && m.created_at <= upTo)) {
        m.read_at = at;
        m.updated_at = at;
        n++;
      }
    }
    return n;
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
  /** La campana (no arranca sola: las pruebas llaman a `poll`). */
  mentions: MentionsInbox;
  sizes: ProjectSizes;
  offline: OfflineManager;
  /** Lo que compactó el motor de este dispositivo (compactar, entrega 2), en orden. */
  compactions: { pageId: string; outcome: CompactOutcome }[];
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
  /** Compactar (Docs/Doc_Compactar.md): las opciones del compactador. Cada compactación queda en `compactions`. */
  compact?: CompactOptions,
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
  const mentions = new MentionsInbox(commentsDb, remote, comments, { now: () => Date.now() + server.clockOffset, online: () => server.online });
  await mentions.load();
  const sizes = new ProjectSizes(db, {
    projectSizes: async () => {
      server.check();
      server.sizesCalls++;
      return server.sizes && server.sizes.map((r) => ({ ...r }));
    },
  });
  await sizes.load();
  const compactions: { pageId: string; outcome: CompactOutcome }[] = [];
  const engine = new SyncEngine(remote, tree, docs, files, {
    appVersion,
    schemaVersion,
    media,
    access,
    comments,
    sizes,
    compact,
    onCompacted: (pageId, outcome) => compactions.push({ pageId, outcome }),
  });
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
  return { db, tree, docs, files, media, mediaDb, engine, remote, access, comments, commentsDb, mentions, sizes, offline, compactions };
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
