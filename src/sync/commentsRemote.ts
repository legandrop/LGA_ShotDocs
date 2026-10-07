import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommentAuthor, CommentRemote, CommentRow, EditConflict, ImportedComment, ListedComment, NewComment } from './comments';
import type { InboxResponse, MentionCandidate, MentionsRemote } from './mentions';
import { afterPair, COUNTED, KeyedList, placeOf } from './listPages';
import { rpcByKey, timed, toRemoteError } from './remote';

// Las llamadas de los comentarios a Supabase (supabase/migrations/20260930170000_comentarios.sql). La tabla
// `comments` no se puede leer con `*` (la columna del texto no se da): se lee `comments_view`, que devuelve
// el texto vacío si el comentario se borró.

const COLUMNS =
  'id, page_id, block_id, thread_id, body, author_id, created_at, edited_at, resolved_at, resolved_by, deleted_at, deleted_by';
// De dónde se importó y quién lo escribió afuera (la vista las trae desde 20260930200000_comentarios_importados.sql):
// sin ellas, mientras se lee la vista en lugar de `list_comments`, un comentario importado se veía como de una cuenta
// borrada hasta la bajada siguiente.
const IMPORTED_COLUMNS = 'imported_from, imported_author, imported_author_email, imported_by';
// Quién escribió con un link público (la vista las trae desde 20261012120000_link_publico.sql): sin ellas, mientras se
// lee la vista en lugar de `list_comments`, un comentario de un link se guardaba sin su nombre ni su link.
const LINK_COLUMNS = 'plink_id, plink_author';
// A quién nombra cada comentario (20261015120000_menciones.sql).
const MENTION_COLUMNS = 'mentions';
/**
 * Lo que se le pide a la vista, de la base más nueva a la más vieja: si a la vista de esta base le falta una columna
 * (`42703`), se baja un escalón y no se vuelve a pedir. Cada grupo de columnas llegó después que el anterior.
 */
const VIEW_COLUMNS = [
  `${COLUMNS}, ${IMPORTED_COLUMNS}, ${LINK_COLUMNS}, ${MENTION_COLUMNS}`,
  `${COLUMNS}, ${IMPORTED_COLUMNS}, ${LINK_COLUMNS}`,
  `${COLUMNS}, ${IMPORTED_COLUMNS}`,
  COLUMNS,
];
/** Cuántas filas se piden por pedido. La API puede entregar menos (su tope de filas): se sigue desde la última. */
const PAGE = 1000;
// La función todavía no existe en la base (falta aplicar una migración).
const MISSING_FUNCTION = 'PGRST202';
// La vista no tiene una columna pedida (una base anterior a esa columna).
const MISSING_COLUMN = '42703';

export class SupabaseCommentRemote implements CommentRemote, MentionsRemote {
  /** Desde cuándo la base no tiene `list_comments`; se vuelve a probar cada tanto por si se migró. */
  private listMissingAt = 0;
  /** Qué escalón de `VIEW_COLUMNS` tiene la vista de esta base (0: todas las columnas). */
  private viewStep = 0;
  /** Desde cuándo la base no tiene `edit_comment(p_id, p_body, p_base)`; se vuelve a probar cada tanto por si se migró. */
  private editBaseMissingAt = 0;

  constructor(private readonly client: SupabaseClient) {}

  /**
   * `list_comments(p_page_id, p_since)`: lo de la vista más `updated_at`, calculando el nivel una vez; con
   * `since`, solo lo cambiado. `null` si la base no tiene la función (la cola sigue con la vista).
   *
   * Se pide **por clave**, en el orden de la función (`updated_at`, `id`) escrito en el pedido: cada pedido sigue a la
   * última fila recibida (`p_since` con su fecha, y un filtro que deja afuera lo de esa misma fecha que ya llegó), y la
   * lista termina cuando lo recibido alcanza el total que dice la API, no por haber recibido pocas filas. En el caso
   * de siempre (todo entra en una respuesta) es **un pedido**, como antes. Un comentario que cambia entre dos pedidos
   * vuelve a llegar más adelante con su fecha nueva: queda su última versión. Si un pedido falla, tira: nunca una
   * lista parcial (la cola la tomaría por todo lo que hay).
   */
  async listComments(pageId: string, since: string | null): Promise<ListedComment[] | null> {
    if (Date.now() - this.listMissingAt < 10 * 60_000) return null;
    const list = new KeyedList<ListedComment>('list_comments', (r) => `${r.updated_at}|${r.id}`);
    for (;;) {
      const last = list.last ? placeOf('list_comments', list.last.updated_at, list.last.id) : null;
      let query = this.client.rpc('list_comments', { p_page_id: pageId, p_since: last ? last.at : since }, COUNTED);
      if (last) query = query.or(afterPair('updated_at', last.at, 'id', last.id));
      const { data, error, status, count } = await timed(query.order('updated_at').order('id').limit(PAGE));
      // Solo antes de la primera página: la base no tiene la función.
      if (error?.code === MISSING_FUNCTION && !last) {
        this.listMissingAt = Date.now();
        return null;
      }
      if (error) throw toRemoteError(error, status);
      if (list.add((data ?? []) as ListedComment[], count)) break;
    }
    const byId = new Map<string, ListedComment>();
    for (const row of list.rows) {
      byId.delete(row.id);
      byId.set(row.id, row);
    }
    return [...byId.values()];
  }

  /**
   * La vista de compatibilidad, entera (cuando `list_comments` no está). Pide además de dónde se importó cada
   * comentario, quién escribió con un link y a quién nombra; si a la vista de esta base le falta alguna de esas
   * columnas, sigue sin ellas (y no las vuelve a pedir): los comentarios se leen igual. Por clave (`created_at`,
   * `id`) y hasta el total que dice la API, como `listComments`.
   */
  async fetchComments(pageId: string): Promise<CommentRow[]> {
    const list = new KeyedList<CommentRow>('comments_view', (r) => `${r.created_at}|${r.id}`);
    for (;;) {
      const last = list.last ? placeOf('comments_view', list.last.created_at, list.last.id) : null;
      let query = this.client.from('comments_view').select(VIEW_COLUMNS[this.viewStep], COUNTED).eq('page_id', pageId);
      if (last) query = query.or(afterPair('created_at', last.at, 'id', last.id));
      const { data, error, status, count } = await timed(query.order('created_at').order('id').limit(PAGE));
      if (error?.code === MISSING_COLUMN && this.viewStep < VIEW_COLUMNS.length - 1) {
        this.viewStep++;
        continue;
      }
      if (error) throw toRemoteError(error, status);
      if (list.add((data ?? []) as unknown as CommentRow[], count)) return list.rows;
    }
  }

  async fetchCommentAuthors(pageId: string): Promise<CommentAuthor[]> {
    // Una fila por persona: entera, por su id. Un correo que falta no puede dejar en error la bajada de los comentarios.
    return rpcByKey<CommentAuthor>(this.client, 'comment_authors', { p_page_id: pageId }, 'user_id');
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

  /**
   * Con `base` (el texto del que partió la persona), la firma de tres argumentos
   * (20261115120000_comentario_edicion_base.sql): si la base ya tiene otro texto no lo pisa y contesta el conflicto.
   * PostgREST elige la función por los nombres de los argumentos, como con `push_page_update` y su `p_app_version`.
   * Con una base sin esa firma (`PGRST202`), o sin `base` (una edición guardada por una versión anterior de la app),
   * la de dos argumentos, que guarda lo que llega: lo de siempre. No se vuelve a probar por 10 minutos.
   */
  async editComment(id: string, body: string, base?: string): Promise<EditConflict | void> {
    if (base !== undefined && Date.now() - this.editBaseMissingAt >= 10 * 60_000) {
      const { data, error, status } = await timed(this.client.rpc('edit_comment', { p_id: id, p_body: body, p_base: base }));
      if (error?.code !== MISSING_FUNCTION) {
        if (error) throw toRemoteError(error, status);
        const answer = data as { conflict?: unknown; body?: unknown; edited_at?: unknown } | null;
        if (answer?.conflict !== true) return;
        return {
          conflict: true,
          body: typeof answer.body === 'string' ? answer.body : null,
          editedAt: typeof answer.edited_at === 'string' ? answer.edited_at : null,
        };
      }
      this.editBaseMissingAt = Date.now();
    }
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
    // Un pedido y lo que llegue, sin el control del total: quien lo pide se traga los errores (`refreshCandidates` en
    // `mentions.ts`), así que con un tope de filas menor que el equipo el `@` se quedaría sin nadie; con lo que llega,
    // ofrece a esos.
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
