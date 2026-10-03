import type { SupabaseClient } from '@supabase/supabase-js';
import { stored } from '../i18n';
import { fromBase64, toBase64 } from '../lib/base64';
import type { AccessSnapshot } from './access';
import type { CommentAuthor, CommentRemote, CommentRow, ListedComment, NewComment } from './comments';
import { SupabaseRemote, timed, toRemoteError, MAX_REQUEST_TIMEOUT_MS, REQUEST_TIMEOUT_MS, type CleanWorkRow, type CleanPushResult, type LinkResult } from './remote';
import type { AdmitPageRow, AdmitResult, AdmitWorkRow, LinkUpdateRow } from './linkAdmitApi';
import {
  AUTHOR_MISSING,
  RemoteError,
  type MediaFileRow,
  type PageRow,
  type PageUseRow,
  type ProjectRow,
  type RemoteUpdate,
  type WorkspaceSettings,
} from './types';

// El servidor visto desde un link público (Docs/Doc_Link_Publico.md, 3.5 a 3.7): las mismas operaciones que usa el motor,
// sobre las funciones `plink_*` de la base, con el cliente sin sesión del modo link (`createLinkClient`). El visitante es,
// para la app, un invitado con Comentar sobre la página del link (`fetchMyAccess`): ve la rama, recibe solo bases limpias
// (D14) y comenta; todo lo demás (escribir, compartir, la papelera, el historial) no existe para él y, si algo lo pidiera
// igual, la base lo rechaza.
//
// Con *Can edit* (entrega 2a, Docs/Doc_Link_Publico.md, E2.2): es un invitado con Editar sobre la página del link y
// escribe con `plink_push_page_update`, que deja lo escrito en la sala de espera (devuelve 0: todavía no está en la
// página). Lo ve entrar cuando un editor lo admite y arma la base siguiente. Crear, mover, renombrar, subir archivos
// (hasta la 2b), compartir, compactar, el historial y las versiones con nombre siguen cerrados.

/** Lo que devuelve `plink_open`. */
export interface LinkOpenInfo {
  link_id: string;
  page_id: string;
  title: string;
  /** El nivel que esta versión de la app puede usar (una más vieja que el interruptor de Can edit ve Can view). */
  level: 'comment' | 'edit';
  /** El nivel del link (con el interruptor apagado, un link Can edit se usa como Can view). */
  link_level: 'comment' | 'edit';
  expires_at: string | null;
  min_app_version: number | null;
  schema_version: number;
  clean_on: boolean;
  media_url: string | null;
  outdated: boolean;
}

/** El link dejó de andar (revocado, vencido, *Reset link*, la raíz en la papelera) o llegó a un tope del día. */
export type LinkProblem = 'link_not_found' | 'link_rate_limited';

export function linkProblemOf(err: unknown): LinkProblem | null {
  const message = err instanceof Error ? err.message : String(err);
  if (/\blink_not_found\b/.test(message)) return 'link_not_found';
  if (/\blink_rate_limited\b/.test(message)) return 'link_rate_limited';
  return null;
}

/** Lo que un link no hace nunca (Can view): escribir el árbol o el contenido, archivos, compartir. */
export const LINK_READ_ONLY = 'link_read_only';

function readOnly(): never {
  throw new RemoteError(LINK_READ_ONLY, true, '42501');
}

/** Subir fotos, videos y archivos por un link llega con la entrega 2b: hasta entonces, un aviso que se entiende. */
function noUploads(): never {
  throw new RemoteError(stored('link.edit.noUploads'), true, '42501');
}

/** El tope de una subida por un link (`push_max_bytes`, 1 MB): una más grande no se manda (R1 de la re-verificación). */
export const LINK_PUSH_MAX_BYTES = 1024 * 1024;

/** Cómo va lo que escribió este dispositivo con el link (`plink_push_status`), por página. */
export interface LinkEdits {
  /** Hay algo escrito que no sube porque falta el nombre del visitante. */
  needName: boolean;
  /** Páginas con algo mandado que espera a que un editor lo admita. */
  waiting: string[];
  /** Páginas con algo apartado (no pudo entrar): se baja con *Download them*. */
  aside: string[];
}

const NO_EDITS: LinkEdits = { needName: false, waiting: [], aside: [] };

/** Cada cuánto se pregunta el estado de lo mandado mientras algo espera (cuenta como un pase, P11). */
const STATUS_EVERY_MS = 30_000;

/** `plink_open` se vuelve a pedir cada tanto (cuenta como una apertura, P11): no en cada ciclo. */
const OPEN_EVERY_MS = 2 * 60 * 60_000;

export class LinkRemote extends SupabaseRemote {
  private info: LinkOpenInfo | null = null;
  private openedAt = 0;
  private opening: Promise<LinkOpenInfo> | null = null;
  /** La firma del último árbol y sus filas: si no cambió, `plink_tree` no devuelve nada (ni cuenta). */
  private treeSig: string | null = null;
  private treeRows: PageRow[] = [];

  private readonly linkVersion: string;
  /** Lo que escribió este dispositivo: falta el nombre, espera, se apartó (la insignia y los avisos lo muestran). */
  private edits: LinkEdits = NO_EDITS;
  private readonly editListeners = new Set<() => void>();
  /** Hay que volver a preguntar el estado (se mandó algo, o algo seguía esperando). */
  private statusDue = true;
  private statusAt = 0;
  /** `plink_push_status` llegó a su tope del día (los pases): no se pregunta más hasta esta hora. */
  private statusOffUntil = 0;

  /** No admite: lo hace el dispositivo de un editor (E2.3). */
  readonly admitsLinks = false;

  constructor(
    private readonly linkClient: SupabaseClient,
    appVersion: string,
    /** Avisa cuando el link deja de andar o llega a un tope (la pantalla lo dice), y cuando vuelve a andar (`null`). */
    private readonly onProblem: (problem: LinkProblem | null) => void = () => undefined,
    /** El nombre que escribió el visitante (P8), en el momento de subir: sin nombre no se sube lo escrito. */
    private readonly author: () => string = () => '',
  ) {
    super(linkClient, appVersion);
    this.linkVersion = appVersion;
  }

  /** Lo que escribió este dispositivo con el link. */
  linkEdits = (): LinkEdits => this.edits;

  subscribeLinkEdits = (fn: () => void): (() => void) => {
    this.editListeners.add(fn);
    return () => this.editListeners.delete(fn);
  };

  private setEdits(patch: Partial<LinkEdits>): void {
    const next = { ...this.edits, ...patch };
    if (JSON.stringify(next) === JSON.stringify(this.edits)) return;
    this.edits = next;
    for (const fn of this.editListeners) fn();
  }

  /** El visitante escribió su nombre: lo que esperaba sube en el próximo ciclo. */
  nameChanged(): void {
    if (this.author().trim()) this.setEdits({ needName: false });
  }

  /** Lo último que dijo `plink_open` (o `null` si todavía no abrió). */
  get opened(): LinkOpenInfo | null {
    return this.info;
  }

  private async call<T>(fn: string, args: Record<string, unknown>, ms = REQUEST_TIMEOUT_MS): Promise<T> {
    const { data, error, status } = await timed(this.linkClient.rpc(fn, args), ms);
    if (error) {
      const problem = linkProblemOf(error.message);
      if (problem) this.onProblem(problem);
      throw toRemoteError(error, status);
    }
    return data as T;
  }

  /** Abre el link (`plink_open`), como mucho cada `OPEN_EVERY_MS`. */
  async open(force = false): Promise<LinkOpenInfo> {
    if (this.info && !force && Date.now() - this.openedAt < OPEN_EVERY_MS) return this.info;
    this.opening ??= (async () => {
      try {
        const raw = await this.call<Record<string, unknown>>('plink_open', { p_app_version: this.version() });
        const info: LinkOpenInfo = {
          link_id: String(raw.link_id),
          page_id: String(raw.page_id),
          title: typeof raw.title === 'string' ? raw.title : '',
          level: raw.level === 'edit' ? 'edit' : 'comment',
          // Una base anterior a la versión 19 no lo dice: el link es Can view.
          link_level: raw.link_level === 'edit' ? 'edit' : 'comment',
          expires_at: typeof raw.expires_at === 'string' ? raw.expires_at : null,
          min_app_version: raw.min_app_version == null ? null : Number(raw.min_app_version),
          schema_version: Number(raw.schema_version) || 0,
          clean_on: raw.clean_on === true,
          media_url: typeof raw.media_url === 'string' && raw.media_url ? raw.media_url : null,
          outdated: raw.outdated === true,
        };
        this.info = info;
        this.openedAt = Date.now();
        this.onProblem(null);
        return info;
      } finally {
        this.opening = null;
      }
    })();
    return this.opening;
  }

  private version(): string | null {
    return this.linkVersion || null;
  }

  // --- lo que usa el motor ---------------------------------------------------------------------------------------

  override async fetchWorkspaceSettings(): Promise<WorkspaceSettings | null> {
    const info = await this.open();
    return {
      // Un link no recupera nada tras restaurar una copia: no sube nada.
      generation: 1,
      minAppVersion: info.min_app_version,
      schemaVersion: info.schema_version,
      mediaUrl: info.media_url,
      ownerId: null,
      name: null,
      localKey: null,
      autoPurgeFiles: false,
      // Prendido para el motor: el visitante recibe solo bases (la base nunca le manda filas).
      cleanMinVersion: info.clean_on ? 0 : null,
    };
  }

  override async ensureWorkspace(): Promise<string | null> {
    return (await this.open()).link_id;
  }

  override async fetchProjects(): Promise<ProjectRow[]> {
    const info = await this.open();
    // El "proyecto" del visitante es el link: nunca el nombre ni el id del proyecto de verdad (P10).
    return [{ id: info.link_id, name: info.title, created_at: '1970-01-01T00:00:00Z', owner_id: null }];
  }

  override async fetchTree(projectIds: string[]): Promise<PageRow[]> {
    const info = await this.open();
    if (!projectIds.includes(info.link_id)) return [];
    // Una vez por ciclo, cómo va lo que se mandó (mientras algo espera): sus errores no cortan nada.
    if (info.level === 'edit') await this.refreshEdits().catch(() => undefined);
    const rows = await this.call<Record<string, unknown>[]>('plink_tree', { p_sig: this.treeSig });
    if (rows.length > 0) {
      this.treeSig = String(rows[0].sig);
      this.treeRows = rows.map((r) => ({
        id: String(r.id),
        workspace_id: String(r.workspace_id),
        parent_id: r.parent_id ? String(r.parent_id) : null,
        title: typeof r.title === 'string' ? r.title : '',
        icon: typeof r.icon === 'string' ? r.icon : null,
        sort_key: typeof r.sort_key === 'string' ? r.sort_key : '',
        settings: (r.settings && typeof r.settings === 'object' ? r.settings : {}) as PageRow['settings'],
        update_seq: Number(r.update_seq) || 0,
        clean_seq: Number(r.clean_seq) || 0,
        deleted_at: null,
        created_at: String(r.created_at),
        updated_at: String(r.updated_at),
      }));
    }
    return this.treeRows.map((r) => ({ ...r }));
  }

  override async pullUpdates(pageId: string, afterSeq: number): Promise<RemoteUpdate[]> {
    const rows = await this.call<{ seq: number; update: string }[]>(
      'plink_pull_page',
      { p_page_id: pageId, p_after_seq: afterSeq },
      MAX_REQUEST_TIMEOUT_MS,
    );
    return (rows ?? []).map((r) => ({ seq: Number(r.seq), data: fromBase64(r.update) }));
  }

  /** El visitante baja siempre por `plink_pull_page` (la base limpia), nunca snapshots (Docs/Doc_Compactar.md, sección 5). */
  override async pullContent(pageId: string, afterSeq: number): Promise<RemoteUpdate[]> {
    return this.pullUpdates(pageId, afterSeq);
  }

  override async fetchMyAccess(): Promise<AccessSnapshot | null> {
    const info = await this.open();
    // Como un invitado con Comentar sobre la página del link (P4): la app oculta todo lo que no es para él.
    return {
      member: { role: 'guest', removed_at: null },
      grants: [{ id: info.link_id, project_id: null, page_id: info.page_id, level: info.level === 'edit' ? 'edit' : 'comment' }],
      fetchedAt: Date.now(),
      // Con Can edit escribe solo el contenido: el título, los ajustes y la hoja son de la fila (E2.4).
      contentOnly: true,
    };
  }

  override async acceptInvitations(): Promise<number | null> {
    return null;
  }

  override async cleanWork(): Promise<CleanWorkRow[]> {
    return [];
  }

  override async pushCleanBase(): Promise<CleanPushResult> {
    return readOnly();
  }

  /**
   * Escribir con *Can edit*: a la sala de espera (`plink_push_page_update`), con la versión y el nombre del visitante.
   * Devuelve 0: la fila todavía no está en la página (la confirmación sube `syncedSV` y no mueve el cursor; lo admitido
   * llega con la base siguiente). Sin nombre no se manda (queda en el dispositivo); una subida de más de 1 MB tampoco
   * (`update_size_invalid` sin pedido: la página queda rechazada hasta deshacer o volver a intentar).
   */
  override async pushUpdate(pageId: string, clientUpdateId: string, update: Uint8Array): Promise<number> {
    const info = await this.open();
    if (info.level !== 'edit') return readOnly();
    const name = this.author().trim();
    if (!name) {
      this.setEdits({ needName: true });
      throw new RemoteError(AUTHOR_MISSING, false, '22023');
    }
    if (update.length === 0 || update.length > LINK_PUSH_MAX_BYTES) throw new RemoteError('update_size_invalid', true, '22023');
    const b64 = toBase64(update);
    await this.call<number>(
      'plink_push_page_update',
      { p_page_id: pageId, p_client_update_id: clientUpdateId, p_update: b64, p_app_version: this.version(), p_author: name },
      MAX_REQUEST_TIMEOUT_MS,
    );
    this.statusDue = true;
    this.setEdits({ needName: false, waiting: [...new Set([...this.edits.waiting, pageId])] });
    return 0;
  }

  /**
   * Cómo va lo mandado desde este dispositivo (`plink_push_status`): qué espera y qué se apartó. Solo mientras algo
   * espera (o al abrir), una vez cada `STATUS_EVERY_MS`. Cuenta como un pase: con el tope del día lleno, deja de
   * preguntar hasta mañana sin avisar que el link no puede escribir (R2 de la re-verificación).
   */
  async refreshEdits(force = false): Promise<void> {
    const now = Date.now();
    if (!force && (!this.statusDue || now < this.statusOffUntil || now - this.statusAt < STATUS_EVERY_MS)) return;
    this.statusAt = now;
    const { data, error, status } = await timed(this.linkClient.rpc('plink_push_status'));
    if (error) {
      if (linkProblemOf(error.message) === 'link_rate_limited') {
        const tomorrow = new Date();
        tomorrow.setHours(24, 0, 0, 0);
        this.statusOffUntil = tomorrow.getTime();
        return;
      }
      const problem = linkProblemOf(error.message);
      if (problem) this.onProblem(problem);
      throw toRemoteError(error, status);
    }
    const rows = (data ?? []) as { page_id: string; waiting: number; aside: number }[];
    const waiting = rows.filter((r) => Number(r.waiting) > 0).map((r) => String(r.page_id));
    const aside = rows.filter((r) => Number(r.aside) > 0).map((r) => String(r.page_id));
    this.statusDue = waiting.length > 0;
    this.setEdits({ waiting, aside });
  }

  override async createPage(): Promise<void> {
    return readOnly();
  }

  override async updatePage(): Promise<void> {
    return readOnly();
  }

  override async createProject(): Promise<void> {
    return readOnly();
  }

  override async renameProject(): Promise<void> {
    return readOnly();
  }

  override async uploadFile(): Promise<void> {
    return noUploads();
  }

  /** Las imágenes viejas `sdfile://` (bucket `page-files`) no se abren por un link (3.9). */
  override async downloadFile(): Promise<Blob> {
    throw new RemoteError('file_not_found', true, 'P0002');
  }

  // --- archivos: solo ver ------------------------------------------------------------------------------------------

  override async fetchMediaFiles(ids: string[]): Promise<MediaFileRow[]> {
    const info = await this.open();
    const out: MediaFileRow[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const rows = await this.call<Record<string, unknown>[]>('plink_media_files', { p_ids: ids.slice(i, i + 200) });
      for (const r of rows ?? []) {
        out.push({
          id: String(r.id),
          name: String(r.name),
          mime: String(r.mime),
          width: r.width == null ? null : Number(r.width),
          height: r.height == null ? null : Number(r.height),
          duration: r.duration == null ? null : Number(r.duration),
          thumb_at: typeof r.thumb_at === 'string' ? r.thumb_at : null,
          drive_id: typeof r.drive_id === 'string' ? r.drive_id : null,
          size: r.size == null ? null : Number(r.size),
          trashed_at: null,
          purged_at: null,
          drive_trashed_at: null,
          project_id: info.link_id,
        });
      }
    }
    return out;
  }

  override async fetchPageUses(): Promise<PageUseRow[]> {
    return [];
  }

  override async registerFile(): Promise<LinkResult> {
    return noUploads();
  }

  /** El uso de un archivo en una página lo registra el dispositivo de un editor al reconciliar (E2.4): acá, nada. */
  override async linkPageFile(): Promise<LinkResult> {
    return 'ok';
  }

  override async uploadThumb(): Promise<void> {
    return noUploads();
  }

  override async setFileThumb(): Promise<void> {
    return noUploads();
  }

  /** Lo mismo al sacar una foto: la desvincula el editor al reconciliar. */
  override async unlinkPageFile(): Promise<boolean> {
    return true;
  }

  override async trashedFiles(): Promise<never[]> {
    return [];
  }

  override async filesDueForPurge(): Promise<never[]> {
    return [];
  }

  override async projectSizes(): Promise<null> {
    return null;
  }

  // --- cerrado explícito: lo que hereda de SupabaseRemote y un link no hace nunca (E2.1) ---------------------------

  /** Un link no compacta ni baja snapshots (sigue con `plink_pull_page`). */
  override async claimCompaction(): Promise<null> {
    return null;
  }

  override async pushSnapshot(): Promise<never> {
    return readOnly();
  }

  override async confirmSnapshot(): Promise<never> {
    return readOnly();
  }

  override async skipCompaction(): Promise<never> {
    return readOnly();
  }

  override async invalidateSnapshot(): Promise<boolean> {
    return false;
  }

  /** Un link no admite (lo hace un editor) ni ve lo apartado de una página. */
  override async admitPages(): Promise<AdmitPageRow[]> {
    return [];
  }

  override async admitWork(): Promise<AdmitWorkRow[]> {
    return [];
  }

  override async admit(): Promise<AdmitResult[]> {
    return readOnly();
  }

  override async linkUpdatesOf(): Promise<LinkUpdateRow[]> {
    return [];
  }

  override async linkUpdateBytes(): Promise<Uint8Array> {
    return readOnly();
  }

  /** Sin historial ni versiones con nombre (P4). */
  override async pageHistory(): Promise<never> {
    return readOnly();
  }

  override async namePageVersion(): Promise<never> {
    return readOnly();
  }

  override async renamePageVersion(): Promise<never> {
    return readOnly();
  }

  override async removePageVersion(): Promise<never> {
    return readOnly();
  }

  override async markPageRestored(): Promise<never> {
    return readOnly();
  }

  /** Ni compartir ni el equipo. */
  override async share(): Promise<never> {
    return readOnly();
  }

  override async unshare(): Promise<never> {
    return readOnly();
  }

  override async createInvitation(): Promise<never> {
    return readOnly();
  }

  override async revokeInvitation(): Promise<never> {
    return readOnly();
  }

  override async setMemberRole(): Promise<never> {
    return readOnly();
  }

  override async removeMember(): Promise<never> {
    return readOnly();
  }
}

/** Una fila de `plink_list_comments`. */
interface LinkCommentRow {
  id: string;
  page_id: string;
  block_id: string | null;
  thread_id: string | null;
  body: string | null;
  author_name: string | null;
  author_kind: 'team' | 'imported' | 'link';
  mine: boolean;
  created_at: string;
  edited_at: string | null;
  resolved_at: string | null;
  deleted_at: string | null;
  updated_at: string;
}

/**
 * La fila de la app para un comentario visto por un link: los propios (de este link y este dispositivo) con el id del
 * visitante (así se editan y borran); los del equipo y los importados, con el nombre (nunca un correo ni un id); los de
 * un link, con su nombre en `plink_author` (la app suma "(via link)").
 */
export function linkCommentRow(r: LinkCommentRow, me: string): ListedComment {
  const linkName = r.author_kind === 'link' && !r.mine ? r.author_name : null;
  return {
    id: r.id,
    page_id: r.page_id,
    block_id: r.block_id,
    thread_id: r.thread_id,
    body: r.body,
    author_id: r.mine ? me : null,
    created_at: r.created_at,
    edited_at: r.edited_at,
    resolved_at: r.resolved_at,
    resolved_by: null,
    deleted_at: r.deleted_at,
    deleted_by: null,
    imported_from: null,
    imported_author: r.author_kind !== 'link' ? r.author_name : null,
    imported_author_email: null,
    imported_by: null,
    plink_author: linkName,
    updated_at: r.updated_at,
  };
}

/** Los comentarios desde un link (`plink_*`): comentar y responder, y editar y borrar los propios. Nunca resolver. */
export class LinkCommentRemote implements CommentRemote {
  constructor(
    private readonly client: SupabaseClient,
    /** El id del visitante en la app (`AuthUser.id` del modo link). */
    private readonly me: string,
    /** El nombre que escribió el visitante (P8), en el momento de subir. */
    private readonly author: () => string,
  ) {}

  private async call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error, status } = await timed(this.client.rpc(fn, args));
    if (error) throw toRemoteError(error, status);
    return data as T;
  }

  async listComments(pageId: string, since: string | null): Promise<ListedComment[]> {
    const rows = await this.call<LinkCommentRow[]>('plink_list_comments', { p_page_id: pageId, p_since: since });
    return (rows ?? []).map((r) => linkCommentRow(r, this.me));
  }

  async fetchComments(pageId: string): Promise<CommentRow[]> {
    return this.listComments(pageId, null);
  }

  async fetchCommentAuthors(): Promise<CommentAuthor[]> {
    return [];
  }

  async addComment(c: NewComment): Promise<void> {
    const name = this.author().trim();
    // Sin nombre no se sube: queda en la cola hasta que lo escriba (la app lo pide antes de comentar).
    if (!name) throw new RemoteError('author_missing', false, '22023');
    await this.call('plink_add_comment', {
      p_id: c.id,
      p_page_id: c.pageId,
      p_block_id: c.blockId,
      p_thread_id: c.threadId,
      p_body: c.body,
      p_author: name,
    });
  }

  async editComment(id: string, body: string): Promise<void> {
    await this.call('plink_edit_comment', { p_id: id, p_body: body });
  }

  async deleteComment(id: string): Promise<void> {
    await this.call('plink_delete_comment', { p_id: id });
  }

  async resolveThread(): Promise<void> {
    throw new RemoteError('not_allowed', true, '42501');
  }

  async importComment(): Promise<void> {
    throw new RemoteError('not_allowed', true, '42501');
  }
}
