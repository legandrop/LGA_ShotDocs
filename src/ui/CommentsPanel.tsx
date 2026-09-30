import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePermissions, useServices, useSyncStatus } from '../services';
import {
  CommentInvalid,
  LEVEL_COMMENT,
  LEVEL_DELETE_ANY,
  MAX_COMMENT_LENGTH,
  type CommentThread,
  type CommentView,
} from '../sync/comments';
import { errorMessage } from '../sync/types';
import {
  clearCommentsTarget,
  closeComments,
  isPhoneLayout,
  revealBlock,
  toggleComments,
  useBlockSource,
  useCommentsUi,
  type BlockSource,
  type CommentsTarget,
} from './commentsUi';
import { CloseIcon, CollapseIcon, CommentIcon, ExpandIcon, QuestionIcon } from './icons';

// El panel de comentarios de la página (paso 10): a la derecha en la computadora y como hoja desde abajo en
// el teléfono. Los hilos abiertos arriba, en el orden de la página; los resueltos, plegados abajo. Cada hilo
// dice a qué bloque apunta (un clic lleva al bloque y lo resalta). Todo se guarda primero en el dispositivo
// (ver sync/comments.ts): sin red se escribe igual y sube después.

/** Re-renderiza cuando cambian los comentarios; mientras está montado, la página se baja y se mantiene al día. */
function useThreads(pageId: string): CommentThread[] {
  const { comments } = useServices();
  useSyncExternalStore(comments.subscribe, comments.getRevision);
  useEffect(() => comments.watch(pageId), [comments, pageId]);
  return comments.threads(pageId);
}

/** Lo que la persona puede hacer con los comentarios de la página (misma cuenta que la base). */
export function useCommentAccess(pageId: string): { canComment: boolean; canDeleteAny: boolean; level: number } {
  const { comments } = useServices();
  const perms = usePermissions();
  const level = perms.pageLevel(pageId);
  return { level, canComment: level >= LEVEL_COMMENT && comments.writable, canDeleteAny: level >= LEVEL_DELETE_ANY };
}

/** El botón de la barra de arriba: abre y cierra el panel, con la cantidad de hilos abiertos. */
export function CommentsToggle({ pageId }: { pageId: string }) {
  const { comments } = useServices();
  useSyncExternalStore(comments.subscribe, comments.getRevision);
  useEffect(() => comments.watch(pageId), [comments, pageId]);
  const { open } = useCommentsUi();
  const openThreads = comments.threads(pageId).filter((t) => !t.resolved).length;
  return (
    <button
      className={`icon-button comments-toggle${openThreads > 0 ? ' has-count' : ''}`}
      aria-label={openThreads > 0 ? `Comments, ${openThreads} open` : 'Comments'}
      aria-pressed={open}
      onClick={toggleComments}
    >
      <CommentIcon size={19} />
      {openThreads > 0 && <span className="comments-toggle-count">{openThreads > 99 ? '99+' : openThreads}</span>}
    </button>
  );
}

function sortThreads(threads: CommentThread[], source: BlockSource | null): CommentThread[] {
  const order = source?.order() ?? new Map<string, number>();
  const pos = (t: CommentThread) => (t.blockId === null ? -1 : (order.get(t.blockId) ?? Number.MAX_SAFE_INTEGER));
  return [...threads].sort((a, b) => pos(a) - pos(b) || (a.root.createdAt < b.root.createdAt ? -1 : 1));
}

export function CommentsPanel({ pageId }: { pageId: string }) {
  const ui = useCommentsUi();
  // Al salir de la página, lo pedido para ella no sigue.
  useEffect(() => () => clearCommentsTarget(), [pageId]);
  if (!ui.open) return null;
  return <Panel pageId={pageId} target={ui.target} nonce={ui.nonce} />;
}

function Panel({ pageId, target, nonce }: { pageId: string; target: CommentsTarget | null; nonce: number }) {
  const { comments, user } = useServices();
  const status = useSyncStatus();
  const threads = useThreads(pageId);
  const source = useBlockSource(pageId);
  const { canComment, canDeleteAny, level } = useCommentAccess(pageId);
  const [showResolved, setShowResolved] = useState(false);
  const [composing, setComposing] = useState<{ blockId: string | null; answer: boolean } | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);

  const open = sortThreads(threads.filter((t) => !t.resolved), source);
  const resolved = sortThreads(threads.filter((t) => t.resolved), source);

  // Lo que pidió el editor o el margen: un hilo, los de un bloque, o escribir uno nuevo.
  useEffect(() => {
    if (!target) return;
    if (target.kind === 'thread') {
      setFocused(target.threadId);
      setComposing(null);
      if (threads.find((t) => t.id === target.threadId)?.resolved) setShowResolved(true);
    } else if (target.kind === 'block') {
      const onBlock = threads.filter((t) => t.blockId === target.blockId);
      const first = onBlock.find((t) => !t.resolved) ?? (target.answer ? onBlock[0] : undefined);
      if (first) {
        setFocused(first.id);
        setComposing(null);
        if (first.resolved) setShowResolved(true);
      } else {
        setFocused(null);
        setComposing(canComment ? { blockId: target.blockId, answer: !!target.answer } : null);
      }
    } else {
      setFocused(null);
      setComposing(canComment ? { blockId: target.blockId, answer: !!target.answer } : null);
    }
    // Solo cuando llega un pedido nuevo (no con cada cambio de los hilos).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  // En el teléfono, Escape o tocar afuera cierra la hoja; en la computadora, Escape cierra el panel si el
  // foco está adentro (el editor usa Escape para lo suyo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (ref.current?.contains(document.activeElement) || isPhoneLayout()) closeComments();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const reveal = (blockId: string | null) => {
    if (!blockId) return;
    // En el teléfono la hoja tapa la página: se cierra para ver el bloque.
    if (isPhoneLayout()) closeComments();
    revealBlock(blockId);
  };

  const empty = open.length === 0 && resolved.length === 0 && !composing;

  return (
    <>
      <div className="comments-scrim" onClick={closeComments} />
      <aside ref={ref} className="comments-panel" aria-label="Comments">
        <header className="comments-head">
          <h2>Comments</h2>
          {canComment && (
            <button className="link" onClick={() => setComposing({ blockId: null, answer: false })}>
              Comment on the page
            </button>
          )}
          <button className="icon-button" aria-label="Close comments" onClick={closeComments}>
            <CloseIcon size={18} />
          </button>
        </header>
        <div className="comments-body">
          {!status.online && (
            <p className="comments-note">Offline: what you write is saved on this device and uploads when you’re back online.</p>
          )}
          {status.schemaBehind && (
            <p className="comments-note warn">
              The workspace database needs an update before comments can upload. Yours stay saved on this device.
            </p>
          )}
          {comments.unavailable && <p className="comments-note warn">Comments are read-only on this device: {comments.unavailable}</p>}
          {!canComment && !comments.unavailable && level > 0 && (
            <p className="comments-note">You can read the comments here. Ask for comment access to add yours.</p>
          )}
          {!comments.isFresh(pageId) && status.online && threads.length === 0 && <p className="muted comments-empty">Loading comments…</p>}

          {composing && (
            <NewThread
              key={`${composing.blockId ?? 'page'}:${nonce}`}
              pageId={pageId}
              blockId={composing.blockId}
              answer={composing.answer}
              source={source}
              onReveal={reveal}
              onDone={(id) => {
                setComposing(null);
                if (id) setFocused(id);
              }}
            />
          )}

          {empty && comments.isFresh(pageId) && (
            <p className="muted comments-empty">
              No comments on this page yet.
              {canComment && ' Select a block and choose Comment, or use the comment button in its margin.'}
            </p>
          )}
          {empty && !comments.isFresh(pageId) && !status.online && (
            <p className="muted comments-empty">No comments saved on this device for this page.</p>
          )}

          {open.map((t) => (
            <Thread
              key={t.id}
              thread={t}
              me={user.id}
              focused={focused === t.id}
              nonce={nonce}
              source={source}
              canComment={canComment}
              canDeleteAny={canDeleteAny}
              onReveal={reveal}
            />
          ))}

          {resolved.length > 0 && (
            <div className="comments-resolved">
              <button className="comments-resolved-toggle" aria-expanded={showResolved} onClick={() => setShowResolved(!showResolved)}>
                {showResolved ? <CollapseIcon size={14} /> : <ExpandIcon size={14} />}
                {resolved.length} resolved {resolved.length === 1 ? 'thread' : 'threads'}
              </button>
              {showResolved &&
                resolved.map((t) => (
                  <Thread
                    key={t.id}
                    thread={t}
                    me={user.id}
                    focused={focused === t.id}
                    nonce={nonce}
                    source={source}
                    canComment={canComment}
                    canDeleteAny={canDeleteAny}
                    onReveal={reveal}
                  />
                ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

/** A qué apunta un hilo: el texto del bloque (cortado), la página entera o un bloque que ya no está. */
function Anchor({ blockId, source, onReveal }: { blockId: string | null; source: BlockSource | null; onReveal: (id: string | null) => void }) {
  if (blockId === null) return <p className="thread-anchor page-wide">On the whole page</p>;
  const info = source?.describe(blockId) ?? null;
  if (!info && source) return <p className="thread-anchor gone">The block it pointed to is no longer on the page</p>;
  const text = info?.text.trim() || 'Empty block';
  return (
    <button className={`thread-anchor${info?.question ? ' question' : ''}`} onClick={() => onReveal(blockId)} data-tip="Go to the block">
      {info?.question && <QuestionIcon size={14} />}
      <span>{text.length > 140 ? `${text.slice(0, 140)}…` : text}</span>
    </button>
  );
}

function NewThread({
  pageId,
  blockId,
  answer,
  source,
  onReveal,
  onDone,
}: {
  pageId: string;
  blockId: string | null;
  answer: boolean;
  source: BlockSource | null;
  onReveal: (id: string | null) => void;
  onDone: (id: string | null) => void;
}) {
  const { comments } = useServices();
  const question = answer || (blockId ? !!source?.describe(blockId)?.question : false);
  return (
    <section className="comment-thread composing">
      <Anchor blockId={blockId} source={source} onReveal={onReveal} />
      <Composer
        autoFocus
        placeholder={question ? 'Write your answer…' : 'Write a comment…'}
        submitLabel={question ? 'Answer' : 'Comment'}
        onSubmit={async (text) => onDone(await comments.add(pageId, blockId, text))}
        onCancel={() => onDone(null)}
      />
    </section>
  );
}

function Thread({
  thread,
  me,
  focused,
  nonce,
  source,
  canComment,
  canDeleteAny,
  onReveal,
}: {
  thread: CommentThread;
  me: string;
  focused: boolean;
  nonce: number;
  source: BlockSource | null;
  canComment: boolean;
  canDeleteAny: boolean;
  onReveal: (id: string | null) => void;
}) {
  const { comments } = useServices();
  const [replying, setReplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);
  const question = thread.blockId ? !!source?.describe(thread.blockId)?.question : false;

  useLayoutEffect(() => {
    if (focused) ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [focused, nonce]);

  const resolve = (value: boolean) =>
    void comments.resolve(thread.pageId, thread.id, value).catch((err: unknown) => setError(errorMessage(err)));

  return (
    <article ref={ref} className={`comment-thread${focused ? ' focused' : ''}${thread.resolved ? ' resolved' : ''}`}>
      <Anchor blockId={thread.blockId} source={source} onReveal={onReveal} />
      {thread.resolved && (
        <p className="thread-resolved-by">
          Resolved{thread.resolvedBy ? ` by ${nameOf(comments, thread.resolvedBy, me)}` : ''}
          {thread.resolvedAt ? ` · ${when(thread.resolvedAt)}` : ''}
        </p>
      )}
      <Comment comment={thread.root} me={me} canComment={canComment} canDeleteAny={canDeleteAny} />
      {thread.replies.map((r) => (
        <Comment key={r.id} comment={r} me={me} canComment={canComment} canDeleteAny={canDeleteAny} />
      ))}
      {error && <p className="comment-error">{error}</p>}
      {replying ? (
        <Composer
          autoFocus
          placeholder={question ? 'Write your answer…' : 'Reply…'}
          submitLabel={question ? 'Answer' : 'Reply'}
          onSubmit={async (text) => {
            await comments.add(thread.pageId, thread.blockId, text, thread.id);
            setReplying(false);
          }}
          onCancel={() => setReplying(false)}
        />
      ) : (
        canComment && (
          <div className="thread-actions">
            {!thread.resolved && (
              <button className="link" onClick={() => setReplying(true)}>
                {question ? 'Answer' : 'Reply'}
              </button>
            )}
            <button className="link" onClick={() => resolve(!thread.resolved)}>
              {thread.resolved ? 'Reopen' : 'Resolve'}
            </button>
          </div>
        )
      )}
    </article>
  );
}

type Names = { emailOf(id: string | null): string | undefined };

function nameOf(comments: Names, userId: string | null, me: string): string {
  if (userId && userId === me) return 'You';
  if (!userId) return 'Deleted account';
  return comments.emailOf(userId) ?? 'Someone';
}

function Comment({ comment, me, canComment, canDeleteAny }: { comment: CommentView; me: string; canComment: boolean; canDeleteAny: boolean }) {
  const { comments, engine } = useServices();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = comment.authorId === me;
  const canEdit = mine && canComment && !comment.deleted;
  const canDelete = !comment.deleted && ((mine && canComment) || canDeleteAny);

  if (comment.deleted) {
    return (
      <div className="comment deleted">
        <p className="muted">This comment was deleted.</p>
      </div>
    );
  }

  return (
    <div className={`comment${comment.pending ? ' pending' : ''}`}>
      <div className="comment-meta">
        <strong className="comment-author" data-tip={comment.authorId && !mine ? comments.emailOf(comment.authorId) : undefined} data-tip-plain data-tip-overflow>
          {nameOf(comments, comment.authorId, me)}
        </strong>
        <time dateTime={comment.createdAt}>{when(comment.createdAt)}</time>
        {comment.editedAt && <span className="comment-edited">edited</span>}
        {comment.pending && !comment.error && <span className="comment-pending">Not uploaded yet</span>}
      </div>
      {editing ? (
        <Composer
          autoFocus
          initial={comment.body}
          submitLabel="Save"
          placeholder="Edit the comment…"
          onSubmit={async (text) => {
            if (text !== comment.body) await comments.edit(comment.pageId, comment.id, text);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <p className="comment-body">{comment.body}</p>
      )}
      {comment.error && (
        <div className="comment-error">
          <span>Not accepted by the server: {comment.error} It stays on this device.</span>
          <span className="row">
            <button className="link" onClick={() => void engine.retryRejected()}>
              Retry
            </button>
            <button
              className="link danger"
              onClick={() => {
                if (!confirm('Discard this change? It was never uploaded and is only on this device.')) return;
                void Promise.all(comment.failedSeqs.map((s) => comments.discard(s)));
              }}
            >
              Discard
            </button>
          </span>
        </div>
      )}
      {error && <p className="comment-error">{error}</p>}
      {!editing && (canEdit || canDelete) && (
        <div className="comment-actions">
          {confirming ? (
            <>
              <span>Delete this comment?</span>
              <button
                className="link danger"
                onClick={() => {
                  setConfirming(false);
                  void comments.remove(comment.pageId, comment.id).catch((err: unknown) => setError(errorMessage(err)));
                }}
              >
                Delete
              </button>
              <button className="link" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              {canEdit && (
                <button className="link" onClick={() => setEditing(true)}>
                  Edit
                </button>
              )}
              {canDelete && (
                <button className="link" onClick={() => setConfirming(true)}>
                  Delete
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** El cuadro para escribir: Ctrl/⌘+Enter manda, Escape cancela. Crece con el texto. */
function Composer({
  initial = '',
  placeholder,
  submitLabel,
  autoFocus,
  onSubmit,
  onCancel,
}: {
  initial?: string;
  placeholder: string;
  submitLabel: string;
  autoFocus?: boolean;
  onSubmit: (text: string) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [text]);

  useEffect(() => {
    if (!autoFocus) return;
    // En el teléfono se enfoca igual: se tocó un botón para escribir.
    ref.current?.focus({ preventScroll: true });
    const end = ref.current?.value.length ?? 0;
    ref.current?.setSelectionRange(end, end);
  }, [autoFocus]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(text);
    } catch (err) {
      setError(err instanceof CommentInvalid ? err.message : `Could not save it on this device (${errorMessage(err)}).`);
      setBusy(false);
      return;
    }
    setBusy(false);
  };

  const tooLong = text.length > MAX_COMMENT_LENGTH;
  return (
    <form
      className="comment-composer"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <textarea
        ref={ref}
        rows={2}
        value={text}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      {(error || tooLong) && (
        <p className="comment-error">{tooLong ? `Up to ${MAX_COMMENT_LENGTH} characters (${text.length} now).` : error}</p>
      )}
      <div className="row">
        <button type="submit" className="primary" disabled={busy || !text.trim() || tooLong} data-tip={IS_MAC ? '⌘↩' : 'Ctrl+Enter'}>
          {submitLabel}
        </button>
        <button type="button" className="link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const timeFormat = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });
const yearFormat = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' });

/** "just now", "5 min", "3:40 PM", "Sep 30", "Sep 30, 2025". */
export function when(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = now - t;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min`;
  const d = new Date(t);
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return timeFormat.format(d);
  return d.getFullYear() === today.getFullYear() ? dayFormat.format(d) : yearFormat.format(d);
}
