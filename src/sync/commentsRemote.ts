import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommentAuthor, CommentRemote, CommentRow, ImportedComment, ListedComment, NewComment } from './comments';
import type { InboxResponse, MentionCandidate, MentionsRemote } from './mentions';
import { timed, toRemoteError } from './remote';

// Las llamadas de los comentarios a Supabase (supabase/migrations/20260930170000_comentarios.sql). La tabla
// `comments` no se puede leer con `*` (la columna del texto no se da): se lee `comments_view`, que devuelve
// el texto vacío si el comentario se borró.

const COLUMNS =
  'id, page_id, block_id, thread_id, body, author_id, created_at, edited_at, resolved_at, resolved_by, deleted_at, deleted_by';
// Quién escribió con un link público (la vista las trae desde 20261012120000_link_publico.sql): sin ellas, mientras se
// lee la vista en lugar de `list_comments`, un comentario de un link se guardaba sin su nombre ni su link.
const LINK_COLUMNS = 'plink_id, plink_author';
const PAGE = 1000;
// La función todavía no existe en la base (falta aplicar una migración).
const MISSING_FUNCTION = 'PGRST202';
// La vista no tiene una columna pedida (una base anterior a los links públicos).
const MISSING_COLUMN = '42703';

export class SupabaseCommentRemote implements CommentRemote, MentionsRemote {
  /** Desde cuándo la base no tiene `list_comments`; se vuelve a probar cada tanto por si se migró. */
  private listMissingAt = 0;
  /** La vista de esta base no tiene las columnas del link (anterior a la versión 14): se lee sin ellas. */
  private viewWithoutLink = false;

  constructor(private readonly client: SupabaseClient) {}

  /**
   * `list_comments(p_page_id, p_since)`: lo de la vista más `updated_at`, calculando el nivel una vez; con
   * `since`, solo lo cambiado. `null` si la base no tiene la función (la cola sigue con la vista).
   */
  async listComments(pageId: string, since: string | null): Promise<ListedComment[] | null> {
    if (Date.now() - this.listMissingAt < 10 * 60_000) return null;
    const rows: ListedComment[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error, status } = await timed(this.client
        .rpc('list_comments', { p_page_id: pageId, p_since: since })
        .range(from, from + PAGE - 1));
      if (error?.code === MISSING_FUNCTION) {
        this.listMissingAt = Date.now();
        return null;
      }
      if (error) throw toRemoteError(error, status);
      const page = (data ?? []) as ListedComment[];
      rows.push(...page);
      if (page.length < PAGE) return rows;
    }
  }

  /**
   * La vista de compatibilidad, entera (cuando `list_comments` no está). Pide además quién escribió con un link; si la
   * vista de esta base no tiene esas columnas, sigue sin ellas (y no las vuelve a pedir): los comentarios se leen igual.
   */
  async fetchComments(pageId: string): Promise<CommentRow[]> {
    const rows: CommentRow[] = [];
    for (let from = 0; ; ) {
      const { data, error, status } = await timed(this.client
        .from('comments_view')
        .select(this.viewWithoutLink ? COLUMNS : `${COLUMNS}, ${LINK_COLUMNS}`)
        .eq('page_id', pageId)
        .order('created_at')
        .order('id')
        .range(from, from + PAGE - 1));
      if (error?.code === MISSING_COLUMN && !this.viewWithoutLink) {
        this.viewWithoutLink = true;
        continue;
      }
      if (error) throw toRemoteError(error, status);
      const page = (data ?? []) as unknown as CommentRow[];
      rows.push(...page);
      if (page.length < PAGE) return rows;
      from += PAGE;
    }
  }

  async fetchCommentAuthors(pageId: string): Promise<CommentAuthor[]> {
    const { data, error, status } = await timed(this.client.rpc('comment_authors', { p_page_id: pageId }));
    if (error) throw toRemoteError(error, status);
    return (data ?? []) as CommentAuthor[];
  }

  async addComment(c: NewComment): Promise<void> {
    const { error, status } = await timed(this.client.rpc('add_comment', {
      p_id: c.id,
      p_page_id: c.pageId,
      p_block_id: c.blockId,
      p_thread_id: c.threadId,
      p_body: c.body,
    }));
    if (error) throw toRemoteError(error, status);
  }

  /** `import_comment` (20260930200000_comentarios_importados.sql). */
  async importComment(c: ImportedComment): Promise<void> {
    const { error, status } = await timed(this.client.rpc('import_comment', {
      p_id: c.id,
      p_page_id: c.pageId,
      p_block_id: c.blockId,
      p_thread_id: c.threadId,
      p_body: c.body,
      p_created_at: c.createdAt,
      p_resolved_at: c.resolvedAt,
      p_source: c.source,
      p_author_name: c.authorName,
      p_author_email: c.authorEmail,
    }));
    if (error) throw toRemoteError(error, status);
  }

  async editComment(id: string, body: string): Promise<void> {
    const { error, status } = await timed(this.client.rpc('edit_comment', { p_id: id, p_body: body }));
    if (error) throw toRemoteError(error, status);
  }

  async deleteComment(id: string): Promise<void> {
    const { error, status } = await timed(this.client.rpc('delete_comment', { p_id: id }));
    if (error) throw toRemoteError(error, status);
  }

  // --- Menciones (20261015120000_menciones.sql; Docs/Doc_Menciones.md) ---

  /** `set_comment_mentions`: el conjunto entero; devuelve los ids que la base aceptó. */
  async setCommentMentions(commentId: string, mentions: { user_id: string; label: string }[]): Promise<string[]> {
    const { data, error, status } = await timed(
      this.client.rpc('set_comment_mentions', { p_comment_id: commentId, p_mentions: mentions }),
    );
    if (error) throw toRemoteError(error, status);
    return Array.isArray(data) ? data.filter((x): x is string => typeof x === 'string') : [];
  }

  async mentionCandidates(pageId: string): Promise<MentionCandidate[]> {
    const { data, error, status } = await timed(this.client.rpc('mention_candidates', { p_page_id: pageId }));
    if (error) throw toRemoteError(error, status);
    // Las filas sin acceso (ME2, entrega 2) le llegan solo al dueño y a los admins que pueden compartir la página.
    return ((data ?? []) as { user_id: string; email: string; label: string; has_access: boolean }[]).map((r) => ({
      userId: r.user_id,
      email: r.email,
      label: r.label,
      ...(r.has_access === false ? { hasAccess: false } : {}),
    }));
  }

  /** `share_for_mention` (20261016120000_menciones_e2.sql): *Can comment* sobre esa página, para mencionar. */
  async shareForMention(pageId: string, userId: string): Promise<boolean> {
    const { data, error, status } = await timed(this.client.rpc('share_for_mention', { p_page_id: pageId, p_user: userId }));
    if (error) throw toRemoteError(error, status);
    return (data as { shared?: unknown } | null)?.shared === true;
  }

  async mentionsInbox(since: string | null, limit: number): Promise<InboxResponse> {
    const { data, error, status } = await timed(this.client.rpc('mentions_inbox', { p_since: since, p_limit: limit }));
    if (error) throw toRemoteError(error, status);
    const d = (data ?? {}) as Partial<InboxResponse>;
    return { now: d.now ?? '', unread: Number(d.unread) || 0, rows: Array.isArray(d.rows) ? d.rows : [] };
  }

  async mentionsIndex(): Promise<[string, boolean, boolean][]> {
    const { data, error, status } = await timed(this.client.rpc('mentions_index'));
    if (error) throw toRemoteError(error, status);
    return Array.isArray(data) ? (data as [string, boolean, boolean][]) : [];
  }

  async markMentionsRead(ids: string[] | null, upTo: string | null): Promise<number> {
    const { data, error, status } = await timed(this.client.rpc('mark_mentions_read', { p_ids: ids, p_up_to: upTo }));
    if (error) throw toRemoteError(error, status);
    return Number(data) || 0;
  }

  async resolveThread(threadId: string, resolved: boolean): Promise<void> {
    const { error, status } = await timed(
      this.client.rpc('resolve_thread', { p_thread_id: threadId, p_resolved: resolved }),
    );
    if (error) throw toRemoteError(error, status);
  }
}
