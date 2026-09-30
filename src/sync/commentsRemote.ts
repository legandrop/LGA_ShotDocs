import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommentAuthor, CommentRemote, CommentRow, NewComment } from './comments';
import { toRemoteError } from './remote';

// Las llamadas de los comentarios a Supabase (supabase/migrations/20260930170000_comentarios.sql). La tabla
// `comments` no se puede leer con `*` (la columna del texto no se da): se lee `comments_view`, que devuelve
// el texto vacío si el comentario se borró.

const COLUMNS =
  'id, page_id, block_id, thread_id, body, author_id, created_at, edited_at, resolved_at, resolved_by, deleted_at, deleted_by';
const PAGE = 1000;

export class SupabaseCommentRemote implements CommentRemote {
  constructor(private readonly client: SupabaseClient) {}

  async fetchComments(pageId: string): Promise<CommentRow[]> {
    const rows: CommentRow[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error, status } = await this.client
        .from('comments_view')
        .select(COLUMNS)
        .eq('page_id', pageId)
        .order('created_at')
        .order('id')
        .range(from, from + PAGE - 1);
      if (error) throw toRemoteError(error, status);
      const page = (data ?? []) as unknown as CommentRow[];
      rows.push(...page);
      if (page.length < PAGE) return rows;
    }
  }

  async fetchCommentAuthors(pageId: string): Promise<CommentAuthor[]> {
    const { data, error, status } = await this.client.rpc('comment_authors', { p_page_id: pageId });
    if (error) throw toRemoteError(error, status);
    return (data ?? []) as CommentAuthor[];
  }

  async addComment(c: NewComment): Promise<void> {
    const { error, status } = await this.client.rpc('add_comment', {
      p_id: c.id,
      p_page_id: c.pageId,
      p_block_id: c.blockId,
      p_thread_id: c.threadId,
      p_body: c.body,
    });
    if (error) throw toRemoteError(error, status);
  }

  async editComment(id: string, body: string): Promise<void> {
    const { error, status } = await this.client.rpc('edit_comment', { p_id: id, p_body: body });
    if (error) throw toRemoteError(error, status);
  }

  async deleteComment(id: string): Promise<void> {
    const { error, status } = await this.client.rpc('delete_comment', { p_id: id });
    if (error) throw toRemoteError(error, status);
  }

  async resolveThread(threadId: string, resolved: boolean): Promise<void> {
    const { error, status } = await this.client.rpc('resolve_thread', { p_thread_id: threadId, p_resolved: resolved });
    if (error) throw toRemoteError(error, status);
  }
}
