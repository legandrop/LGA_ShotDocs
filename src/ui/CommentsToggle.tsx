import { useEffect, useSyncExternalStore } from 'react';
import { useLinkMode, useVisitorName } from '../linkMode';
import { useT } from '../i18n';
import { usePermissions, useServices } from '../services';
import { LEVEL_COMMENT, LEVEL_DELETE_ANY } from '../sync/comments';
import { toggleComments, useCommentsUi } from './commentsUi';
import { CommentIcon } from './icons';

// Lo de los comentarios que está siempre a la vista (el botón de la barra de arriba). El panel, más
// pesado, se baja aparte la primera vez que se abre (CommentsPanel.tsx, roadmap B.4).

/** Lo que la persona puede hacer con los comentarios de la página (misma cuenta que la base). */
export function useCommentAccess(pageId: string): { canComment: boolean; canDeleteAny: boolean; level: number } {
  const { comments } = useServices();
  const perms = usePermissions();
  const level = perms.pageLevel(pageId);
  // Con un link público se comenta con un nombre (P8): hasta escribirlo, el panel lo pide.
  const link = useLinkMode();
  const named = useVisitorName() !== '';
  return {
    level,
    canComment: level >= LEVEL_COMMENT && comments.writable && (!link || named),
    canDeleteAny: level >= LEVEL_DELETE_ANY,
  };
}

/** El botón de la barra de arriba: abre y cierra el panel, con la cantidad de hilos abiertos. */
export function CommentsToggle({ pageId }: { pageId: string }) {
  const { comments } = useServices();
  useSyncExternalStore(comments.subscribe, comments.getRevision);
  useEffect(() => comments.watch(pageId), [comments, pageId]);
  const { open } = useCommentsUi();
  const tr = useT();
  const openThreads = comments.threads(pageId).filter((t) => !t.resolved).length;
  return (
    <button
      className={`icon-button comments-toggle${openThreads > 0 ? ' has-count' : ''}`}
      data-tour="comments"
      aria-label={openThreads > 0 ? tr('comments.toggleOpen', { count: openThreads }) : tr('comments.title')}
      aria-pressed={open}
      onClick={toggleComments}
    >
      <CommentIcon size={19} />
      {openThreads > 0 && <span className="comments-toggle-count">{openThreads > 99 ? '99+' : openThreads}</span>}
    </button>
  );
}
