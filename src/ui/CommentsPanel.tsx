import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { locale, localize, t as current, useT, type Translate } from '../i18n';
import '../i18n/lazy/commentsPanel';
import { setVisitorName, useLinkMode, useVisitorName } from '../linkMode';
import { useServices, useSyncStatus } from '../services';
import {
  CommentInvalid,
  labelForEmail,
  MAX_COMMENT_LENGTH,
  MAX_MENTIONS,
  type CommentThread,
  type CommentView,
  type MentionRef,
} from '../sync/comments';
import type { MentionCandidate } from '../sync/mentions';
import { errorMessage } from '../sync/types';
import {
  clearCommentsTarget,
  closeComments,
  copyText,
  hasDrafts,
  isPhoneLayout,
  isSendShortcut,
  requestCloseComments,
  setDraft,
  revealBlock,
  useBlockSource,
  useCommentsUi,
  type BlockSource,
  type CommentsTarget,
} from './commentsUi';
import { CommentsToggle, useCommentAccess } from './CommentsToggle';
import { activeMentions, insertMention, mentionQuery, mentionSegments } from './mentionText';
import { useInbox } from './MentionsBell';
import { MentionShareArea } from './MentionShare';
import { shortcutLabel } from './shortcuts';
import { CloseIcon, CollapseIcon, ExpandIcon, QuestionIcon } from './icons';

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

// El botón y los permisos viven aparte (CommentsToggle.tsx) para no bajar el panel con la primera pantalla.
export { CommentsToggle, useCommentAccess };

function sortThreads(threads: CommentThread[], source: BlockSource | null): CommentThread[] {
  const order = source?.order() ?? new Map<string, number>();
  const pos = (t: CommentThread) => (t.blockId === null ? -1 : (order.get(t.blockId) ?? Number.MAX_SAFE_INTEGER));
  return [...threads].sort((a, b) => pos(a) - pos(b) || (a.root.createdAt < b.root.createdAt ? -1 : 1));
}

export function CommentsPanel({ pageId }: { pageId: string }) {
  const ui = useCommentsUi();
  // Al salir de la página, lo pedido para ella no sigue.
  useEffect(() => () => clearCommentsTarget(pageId), [pageId]);
  if (!ui.open) return null;
  return <Panel pageId={pageId} target={ui.targetPage && ui.targetPage !== pageId ? null : ui.target} nonce={ui.nonce} />;
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
  const tr = useT();
  const link = useLinkMode();

  const open = sortThreads(threads.filter((t) => !t.resolved), source);
  const resolved = sortThreads(threads.filter((t) => t.resolved), source);

  // Ver los hilos en el panel marca leídas las menciones de esos hilos (Doc_Menciones.md, 2.3).
  const { mentions } = useServices();
  const inbox = useInbox();
  const visible = [...open, ...(showResolved ? resolved : [])].map((t) => t.id).join(',');
  useEffect(() => {
    if (!mentions || !inbox.ready || !mentions.unreadOn(pageId)) return;
    void mentions.markThreadsRead(pageId, new Set(visible.split(',')));
  }, [mentions, inbox, pageId, visible]);

  // Lo que pidió el editor o el margen: un hilo, los de un bloque, o escribir uno nuevo.
  useEffect(() => {
    if (!target) return;
    if (target.kind === 'thread') {
      setFocused(target.threadId);
      setComposing(null);
      if (target.resolved || threads.find((t) => t.id === target.threadId)?.resolved) setShowResolved(true);
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
      if (ref.current?.contains(document.activeElement) || isPhoneLayout()) requestCloseComments();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // En el teléfono la hoja va anclada abajo: con el teclado abierto (iOS no achica la página), se sube por
  // encima del teclado y no pasa del alto que queda a la vista.
  useEffect(() => {
    const vv = window.visualViewport;
    const el = ref.current;
    if (!vv || !el) return;
    const update = () => {
      el.style.setProperty('--kb-inset', `${Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))}px`);
      el.style.setProperty('--vv-height', `${Math.round(vv.height)}px`);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  const reveal = (blockId: string | null) => {
    if (!blockId) return;
    // En el teléfono la hoja tapa la página: se cierra para ver el bloque (si no hay nada escrito a medias).
    if (isPhoneLayout()) {
      if (hasDrafts() && !requestCloseComments()) return;
      closeComments();
    }
    revealBlock(blockId);
  };

  const empty = open.length === 0 && resolved.length === 0 && !composing;

  return (
    <>
      <div className="comments-scrim" onClick={() => requestCloseComments()} />
      <aside ref={ref} className="comments-panel" aria-label={tr('comments.title')}>
        <header className="comments-head">
          <h2>{tr('comments.title')}</h2>
          {canComment && (
            <button className="link" onClick={() => setComposing({ blockId: null, answer: false })}>
              {tr('comments.onPage')}
            </button>
          )}
          <button className="icon-button" aria-label={tr('comments.close')} onClick={() => requestCloseComments()}>
            <CloseIcon size={18} />
          </button>
        </header>
        <div className="comments-body">
          {!status.online && (
            <p className="comments-note">{tr('comments.offline')}</p>
          )}
          {status.schemaBehind && (
            <p className="comments-note warn">{tr('comments.schemaBehind')}</p>
          )}
          {comments.unavailable && <p className="comments-note warn">{tr('comments.readOnlyDevice', { reason: localize(comments.unavailable) })}</p>}
          {link && level >= 2 && <VisitorName />}
          {!canComment && !comments.unavailable && level > 0 && !(link && level >= 2) && (
            <p className="comments-note">{tr('comments.readOnly')}</p>
          )}
          {comments.pullError(pageId) && status.online && (
            <p className="comments-note warn">{tr('comments.pullError', { reason: localize(comments.pullError(pageId) ?? '') })}</p>
          )}
          {!comments.isFresh(pageId) && status.online && threads.length === 0 && !comments.pullError(pageId) && (
            <p className="muted comments-empty">{tr('comments.loading')}</p>
          )}

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
              {tr('comments.none')}
              {canComment && ` ${tr('comments.noneHint')}`}
            </p>
          )}
          {empty && !comments.isFresh(pageId) && !status.online && (
            <p className="muted comments-empty">{tr('comments.noneOffline')}</p>
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
                {tr('comments.resolvedThreads', { count: resolved.length })}
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
  const tr = useT();
  if (blockId === null) return <p className="thread-anchor page-wide">{tr('comments.wholePage')}</p>;
  const info = source?.describe(blockId) ?? null;
  if (!info && source) return <p className="thread-anchor gone">{tr('comments.blockGone')}</p>;
  const text = info?.text.trim() || tr('comments.emptyBlock');
  return (
    <button className={`thread-anchor${info?.question ? ' question' : ''}`} onClick={() => onReveal(blockId)} data-tip={tr('comments.goToBlock')}>
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
  const tr = useT();
  return (
    <section className="comment-thread composing">
      <Anchor blockId={blockId} source={source} onReveal={onReveal} />
      <Composer
        autoFocus
        mentionPage={pageId}
        placeholder={question ? tr('comments.writeAnswer') : tr('comments.write')}
        submitLabel={question ? tr('comments.answer') : tr('comments.comment')}
        onSubmit={async (text, mentions) => onDone(await comments.add(pageId, blockId, text, null, mentions ?? []))}
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
  const tr = useT();
  const link = useLinkMode();

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
          {thread.resolvedBy ? tr('comments.resolvedBy', { name: nameOf(comments, thread.resolvedBy, me, tr) }) : tr('comments.resolved')}
          {thread.resolvedAt ? ` · ${when(thread.resolvedAt, Date.now(), tr)}` : ''}
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
          mentionPage={thread.pageId}
          placeholder={question ? tr('comments.writeAnswer') : tr('comments.replyPlaceholder')}
          submitLabel={question ? tr('comments.answer') : tr('comments.reply')}
          onSubmit={async (text, mentions) => {
            await comments.add(thread.pageId, thread.blockId, text, thread.id, mentions ?? []);
            setReplying(false);
          }}
          onCancel={() => setReplying(false)}
        />
      ) : (
        canComment &&
        !thread.root.deleted && (
          <div className="thread-actions">
            {!thread.resolved && (
              <button className="link" onClick={() => setReplying(true)}>
                {question ? tr('comments.answer') : tr('comments.reply')}
              </button>
            )}
            {!link && (
              <button className="link" onClick={() => resolve(!thread.resolved)}>
                {thread.resolved ? tr('comments.reopen') : tr('comments.resolve')}
              </button>
            )}
          </div>
        )
      )}
    </article>
  );
}

type Names = { emailOf(id: string | null): string | undefined };

/** El nombre de la herramienta de la que vino un comentario importado. */
function sourceName(source: string): string {
  return source === 'coda' ? 'Coda' : source;
}

function nameOf(comments: Names, userId: string | null, me: string, tr: Translate): string {
  if (userId && userId === me) return tr('comments.you');
  if (!userId) return tr('comments.deletedAccount');
  return comments.emailOf(userId) ?? tr('comments.someone');
}

function Comment({ comment, me, canComment, canDeleteAny }: { comment: CommentView; me: string; canComment: boolean; canDeleteAny: boolean }) {
  const { comments } = useServices();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = comment.authorId === me;
  // `canComment` ya pide que la base de comentarios del dispositivo esté abierta; borrar lo ajeno también.
  const canEdit = mine && canComment && !comment.deleted;
  const canDelete = !comment.deleted && comments.writable && ((mine && canComment) || canDeleteAny);
  const tr = useT();

  if (comment.deleted) {
    return (
      <div className="comment deleted">
        <p className="muted">{tr('comments.deleted')}</p>
        {comment.error && <Rejected comment={comment} />}
      </div>
    );
  }

  return (
    <div className={`comment${comment.pending ? ' pending' : ''}`}>
      <div className="comment-meta">
        {comment.linkAuthor ? (
          // Escrito con un link público: el nombre que escribió, siempre con "(via link)" (nadie se hace pasar por el equipo).
          <strong className="comment-author comment-via-link" data-tip-overflow>
            {comment.linkAuthor} <span className="comment-via">{tr('link.viaLink')}</span>
          </strong>
        ) : comment.importedAuthor ? (
          // De afuera (importado, sin cuenta en la app): el nombre de la herramienta de origen y su correo.
          <strong className="comment-author" data-tip={comment.importedAuthorEmail ?? undefined} data-tip-plain data-tip-overflow>
            {comment.importedAuthor}
          </strong>
        ) : (
          <strong className="comment-author" data-tip={comment.authorId && !mine ? comments.emailOf(comment.authorId) : undefined} data-tip-plain data-tip-overflow>
            {nameOf(comments, comment.authorId, me, tr)}
          </strong>
        )}
        <time dateTime={comment.createdAt}>{when(comment.createdAt, Date.now(), tr)}</time>
        {comment.importedFrom && (
          <span
            className="comment-edited comment-imported"
            data-tip={comment.importedBy ? tr('comments.importedBy', { name: nameOf(comments, comment.importedBy, me, tr) }) : undefined}
            data-tip-plain
          >
            {tr('comments.importedFrom', { source: sourceName(comment.importedFrom) })}
          </span>
        )}
        {comment.editedAt && <span className="comment-edited">{tr('comments.edited')}</span>}
        {comment.pending && !comment.error && <span className="comment-pending">{tr('comments.notUploaded')}</span>}
      </div>
      {editing ? (
        <Composer
          autoFocus
          initial={comment.body}
          initialMentions={comment.mentions}
          mentionPage={comment.pageId}
          submitLabel={tr('common.save')}
          placeholder={tr('comments.editPlaceholder')}
          onSubmit={async (text, mentions) => {
            if (text !== comment.body) await comments.edit(comment.pageId, comment.id, text, mentions ?? undefined);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <CommentBody comment={comment} me={me} />
      )}
      {!editing && mine && comment.unnotified.length > 0 && (
        <p className="comment-unnotified">
          {tr('comments.notNotified', { count: comment.unnotified.length, names: comment.unnotified.map((l) => `@${l}`).join(', ') })}
        </p>
      )}
      {comment.error && <Rejected comment={comment} />}
      {error && <p className="comment-error">{error}</p>}
      {!editing && (canEdit || canDelete) && (
        <div className="comment-actions">
          {confirming ? (
            <>
              <span>{tr('comments.deleteConfirm')}</span>
              <button
                className="link danger"
                onClick={() => {
                  setConfirming(false);
                  void comments.remove(comment.pageId, comment.id).catch((err: unknown) => setError(errorMessage(err)));
                }}
              >
                {tr('common.delete')}
              </button>
              <button className="link" onClick={() => setConfirming(false)}>
                {tr('common.cancel')}
              </button>
            </>
          ) : (
            <>
              {canEdit && (
                <button className="link" onClick={() => setEditing(true)}>
                  {tr('common.edit')}
                </button>
              )}
              {canDelete && (
                <button className="link" onClick={() => setConfirming(true)}>
                  {tr('common.delete')}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * El texto del comentario con las menciones pintadas (Doc_Menciones.md, 2.2): cada `@rótulo` de una mención activa,
 * con el correo en el tooltip (más fuerte si es quien mira); las de Coda como `@Nombre`. Lo de un visitante de un
 * link no se pinta (no menciona a nadie).
 */
function CommentBody({ comment, me }: { comment: CommentView; me: string }) {
  const { comments } = useServices();
  const segments = comment.linkAuthor ? [{ text: comment.body }] : mentionSegments(comment.body, comment.mentions, !!comment.importedFrom);
  return (
    <p className="comment-body">
      {segments.map((seg, i) =>
        'mention' in seg ? (
          <span
            key={i}
            className={`mention${seg.mention.userId === me ? ' me' : ''}`}
            data-tip={comments.emailOf(seg.mention.userId)}
            data-tip-plain
          >
            {seg.text}
          </span>
        ) : 'coda' in seg ? (
          <span key={i} className="mention">
            {seg.text}
          </span>
        ) : (
          seg.text
        ),
      )}
    </p>
  );
}

/** Los autores conocidos de la página (para mencionar sin red y sin la lista guardada). */
function knownAuthors(comments: ReturnType<typeof useServices>['comments'], pageId: string, me: string): MentionCandidate[] {
  const ids = new Set<string>();
  for (const t of comments.threads(pageId)) {
    for (const c of [t.root, ...t.replies]) if (c.authorId && c.authorId !== me) ids.add(c.authorId);
  }
  const out: MentionCandidate[] = [];
  for (const id of ids) {
    const email = comments.emailOf(id);
    if (email) out.push({ userId: id, email, label: labelForEmail(email) });
  }
  return out;
}

/**
 * La lista del `@` de la página (vacía si no hay menciones: base sin migrar, link público, sin la campana), y quienes
 * no ven la página y se les puede compartir desde la mención (ME2: solo le llegan al dueño y a los admins que pueden
 * compartirla; pide red).
 */
function useMentionCandidates(pageId: string | null): { on: boolean; list: MentionCandidate[]; outsiders: MentionCandidate[] } {
  const { mentions, comments, user } = useServices();
  const inbox = useInbox();
  const link = useLinkMode();
  const status = useSyncStatus();
  const on = !!pageId && !!mentions && inbox.ready && !link && comments.writable;
  useEffect(() => {
    if (on && pageId) void mentions?.refreshIfStale(pageId);
  }, [on, pageId, mentions]);
  if (!on || !pageId || !mentions) return { on: false, list: [], outsiders: [] };
  return {
    on,
    list: mentions.candidatesFor(pageId, () => knownAuthors(comments, pageId, user.id)),
    outsiders: status.online ? mentions.outsidersFor(pageId) : [],
  };
}

/** Hasta `max` de la lista que coinciden con lo escrito después del `@` (primero los que empiezan así). */
function matchCandidates(list: MentionCandidate[], query: string, taken: Set<string>, me: string, max = 8): MentionCandidate[] {
  const q = query.toLowerCase();
  return list
    .filter((c) => c.userId !== me && !taken.has(c.userId) && (c.label.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)))
    .sort((a, b) => Number(!a.label.toLowerCase().startsWith(q)) - Number(!b.label.toLowerCase().startsWith(q)) || a.email.localeCompare(b.email))
    .slice(0, max);
}

/** Cuántos de los que no ven la página muestra la lista, abajo y en gris (ME2). */
const MAX_OUTSIDERS = 4;

/**
 * Un cambio que el servidor no aceptó: el motivo, "Retry" y "Discard". Descartar pide confirmación y dice
 * qué pasa (vuelve el comentario, se reabre el hilo, se van también las respuestas), con el texto para
 * copiar antes.
 */
function Rejected({ comment }: { comment: CommentView }) {
  const { comments, engine } = useServices();
  const [asking, setAsking] = useState(false);
  const [copied, setCopied] = useState(false);
  const info = asking ? comments.describeDiscard(comment.failedSeqs) : null;
  const text = info?.text ?? comment.rejectedText;
  const copy = () => void copyText(text ?? '').then((ok) => setCopied(ok));
  const tr = useT();
  return (
    <div className="comment-error" role="status">
      <span>{tr('comments.rejected', { reason: localize(comment.error ?? '') })}</span>
      {info ? (
        <>
          <span>{info.message}</span>
          <span className="row">
            {text && (
              <button className="link" onClick={copy}>
                {copied ? tr('common.copied') : tr('sync.copyText')}
              </button>
            )}
            <button
              className="link danger"
              onClick={() => void Promise.all(comment.failedSeqs.map((s) => comments.discard(s))).then(() => setAsking(false))}
            >
              {tr('common.discard')}
            </button>
            <button className="link" onClick={() => setAsking(false)}>
              {tr('common.cancel')}
            </button>
          </span>
        </>
      ) : (
        <span className="row">
          <button className="link" onClick={() => void engine.retryRejected()}>
            {tr('common.retry')}
          </button>
          {text && (
            <button className="link" onClick={copy}>
              {copied ? tr('common.copied') : tr('sync.copyText')}
            </button>
          )}
          <button className="link danger" onClick={() => setAsking(true)}>
            {tr('comments.discardEllipsis')}
          </button>
        </span>
      )}
    </div>
  );
}

/**
 * El cuadro para escribir: Ctrl/⌘+Enter manda, Escape cancela. Crece con el texto. Con `mentionPage` (y la base con
 * menciones), `@` al comienzo o después de un espacio abre la lista de a quién nombrar: ↑ ↓ eligen, Enter o Tab lo
 * ponen, Esc cierra la lista sin borrar lo escrito. Detrás del cuadro, una copia del texto pinta cada mención elegida.
 * Al mandar, `mentions` son las elegidas que siguen escritas (`null` sin menciones).
 */
function Composer({
  initial = '',
  initialMentions = [],
  mentionPage = null,
  placeholder,
  submitLabel,
  autoFocus,
  onSubmit,
  onCancel,
}: {
  initial?: string;
  initialMentions?: MentionRef[];
  mentionPage?: string | null;
  placeholder: string;
  submitLabel: string;
  autoFocus?: boolean;
  onSubmit: (text: string, mentions: MentionRef[] | null) => Promise<unknown>;
  onCancel: () => void;
}) {
  const { user } = useServices();
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const dirty = text.trim() !== '' && text !== initial;
  const tr = useT();

  // Las menciones: a quién se eligió, dónde está el cursor y la lista abierta.
  const candidates = useMentionCandidates(mentionPage);
  const [picked, setPicked] = useState<MentionRef[]>(initialMentions);
  const [caret, setCaret] = useState<number | null>(null);
  const [choice, setChoice] = useState(0);
  // El `@` en el que se cerró la lista con Esc: no se vuelve a abrir hasta escribir otro.
  const [closedAt, setClosedAt] = useState<number | null>(null);
  const active = useMemo(() => activeMentions(text, picked), [text, picked]);
  const query = candidates.on && caret !== null ? mentionQuery(text, caret) : null;
  const listOpen = !!query && query.start !== closedAt;
  const full = active.length >= MAX_MENTIONS;
  const taken = new Set(active.map((m) => m.userId));
  const inside = listOpen && !full ? matchCandidates(candidates.list, query.query, taken, user.id) : [];
  // Quienes no ven la página (ME2), debajo de los que la ven; las flechas recorren las dos partes.
  const outside =
    listOpen && !full
      ? matchCandidates(candidates.outsiders, query.query, new Set([...taken, ...inside.map((c) => c.userId)]), user.id, MAX_OUTSIDERS)
      : [];
  const matches = [...inside, ...outside];
  // La pregunta de compartir desde la mención, con dónde estaba el `@` cuando se eligió.
  const [asking, setAsking] = useState<{ who: MentionCandidate; start: number; end: number; typed: string } | null>(null);
  const textNow = useRef(text);
  textNow.current = text;
  useEffect(() => setChoice(0), [query?.query, query?.start]);
  // Cerrada con Esc: vuelve a abrir en cuanto ese `@` ya no está (se borró o se movió el cursor a otro lado).
  useEffect(() => {
    if (closedAt !== null && query?.start !== closedAt) setClosedAt(null);
  }, [closedAt, query?.start]);

  const pick = (c: MentionCandidate) => {
    if (!query || caret === null) return;
    if (c.hasAccess === false) {
      // No ve la página: primero la pregunta de compartir (la lista se cierra; el `@` queda escrito).
      setAsking({ who: c, start: query.start, end: caret, typed: text.slice(query.start, caret) });
      setClosedAt(query.start);
      return;
    }
    const next = insertMention(text, query.start, caret, c.label);
    setText(next.text);
    setPicked((list) => [...list.filter((m) => m.userId !== c.userId), { userId: c.userId, label: c.label }]);
    setCaret(next.caret);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(next.caret, next.caret);
    });
  };
  const syncCaret = () => setCaret(ref.current?.selectionStart ?? null);

  /** Ya compartida: la mención va donde estaba el `@` (si se cambió lo escrito ahí, al final). */
  const placeShared = (who: MentionCandidate) => {
    const at = asking;
    setAsking(null);
    const cur = textNow.current;
    const still = !!at && cur.slice(at.start, at.end) === at.typed;
    const base = still || cur === '' || /\s$/u.test(cur) ? cur : `${cur} `;
    const next = still && at ? insertMention(cur, at.start, at.end, who.label) : insertMention(base, base.length, base.length, who.label);
    setText(next.text);
    setPicked((list) => [...list.filter((m) => m.userId !== who.userId), { userId: who.userId, label: who.label }]);
    setCaret(next.caret);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(next.caret, next.caret);
    });
  };
  const cancelAsk = () => {
    setAsking(null);
    // La lista vuelve a abrirse en ese `@` (para elegir a otro).
    setClosedAt(null);
    requestAnimationFrame(() => ref.current?.focus());
  };

  // Lo escrito a medias: cerrar el panel (tocar afuera, Escape, la X) pide confirmación.
  const draftKey = useRef(Symbol('draft'));
  useEffect(() => {
    const key = draftKey.current;
    setDraft(key, dirty);
    return () => setDraft(key, false);
  }, [dirty]);

  // En el teléfono, cuando aparece el teclado, el cuadro queda a la vista.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const keep = () => {
      if (document.activeElement === ref.current && isPhoneLayout()) ref.current?.scrollIntoView?.({ block: 'nearest' });
    };
    vv.addEventListener('resize', keep);
    return () => vv.removeEventListener('resize', keep);
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [text]);

  useEffect(() => {
    if (!autoFocus) return;
    // En el teléfono se enfoca igual (se tocó un botón para escribir) y se deja que el navegador lo muestre.
    ref.current?.focus({ preventScroll: !isPhoneLayout() });
    const end = ref.current?.value.length ?? 0;
    ref.current?.setSelectionRange(end, end);
  }, [autoFocus]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(text, candidates.on ? activeMentions(text, picked) : null);
    } catch (err) {
      setError(err instanceof CommentInvalid ? err.message : tr('comments.saveFailed', { reason: errorMessage(err) }));
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
      <div className={`mention-field${candidates.on ? ' on' : ''}`}>
        {candidates.on && (
          <div ref={backdrop} className="mention-backdrop" aria-hidden="true">
            {mentionSegments(text, active).map((seg, i) => ('mention' in seg ? <mark key={i}>{seg.text}</mark> : seg.text))}
            {/* Un salto al final se ve en el cuadro aunque no tenga nada detrás. */}
            {'\u200b'}
          </div>
        )}
        <textarea
          ref={ref}
          rows={2}
          value={text}
          placeholder={placeholder}
          aria-label={placeholder}
          aria-expanded={candidates.on ? listOpen : undefined}
          aria-autocomplete={candidates.on ? 'list' : undefined}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart);
          }}
          onSelect={syncCaret}
          onClick={syncCaret}
          onScroll={(e) => {
            if (backdrop.current) backdrop.current.scrollTop = e.currentTarget.scrollTop;
          }}
          onBlur={() => setTimeout(() => document.activeElement !== ref.current && setCaret(null), 150)}
          onKeyDown={(e) => {
            if (listOpen && !isSendShortcut(e)) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                if (matches.length === 0) return;
                e.preventDefault();
                setChoice((n) => (n + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length);
                return;
              }
              if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && matches.length > 0) {
                e.preventDefault();
                pick(matches[Math.min(choice, matches.length - 1)]);
                return;
              }
              if (e.key === 'Escape') {
                // Cierra la lista sin borrar lo escrito ni cancelar el comentario.
                e.preventDefault();
                e.stopPropagation();
                e.nativeEvent.stopImmediatePropagation();
                setClosedAt(query!.start);
                return;
              }
            }
            if (isSendShortcut(e)) {
              e.preventDefault();
              void submit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              if (dirty && !confirm(tr('comments.discardDraft'))) return;
              onCancel();
            }
          }}
        />
      </div>
      {listOpen && (
        <ul className="mention-list" role="listbox" aria-label={tr('mentions.listLabel')}>
          {full ? (
            <li className="mention-list-note">{tr('mentions.max', { max: MAX_MENTIONS })}</li>
          ) : matches.length === 0 ? (
            <li className="mention-list-note">{tr('mentions.noMatch')}</li>
          ) : (
            <>
              {inside.length === 0 && <li className="mention-list-note">{tr('mentions.noMatch')}</li>}
              {matches.map((c, i) => (
                <MentionOption
                  key={c.userId}
                  candidate={c}
                  selected={i === choice}
                  head={i === inside.length && outside.length > 0 ? tr('mentions.outsideHead') : null}
                  onPick={() => pick(c)}
                  onHover={() => setChoice(i)}
                />
              ))}
            </>
          )}
        </ul>
      )}
      {candidates.on && mentionPage && (
        <MentionShareArea pageId={mentionPage} who={asking?.who ?? null} onShared={placeShared} onCancel={cancelAsk} />
      )}
      {(error || tooLong) && (
        <p className="comment-error">{tooLong ? tr('comments.tooLong', { max: MAX_COMMENT_LENGTH, now: text.length }) : error}</p>
      )}
      <div className="row">
        <button type="submit" className="primary" disabled={busy || !text.trim() || tooLong} data-tip={shortcutLabel('commentsSend')}>
          {submitLabel}
        </button>
        <button type="button" className="link" onClick={onCancel}>
          {tr('common.cancel')}
        </button>
      </div>
    </form>
  );
}

/** Una persona de la lista del `@`; las que no ven la página (ME2), en gris y con su título arriba de la primera. */
function MentionOption({
  candidate: c,
  selected,
  head,
  onPick,
  onHover,
}: {
  candidate: MentionCandidate;
  selected: boolean;
  head: string | null;
  onPick: () => void;
  onHover: () => void;
}) {
  const outside = c.hasAccess === false;
  return (
    <>
      {head && (
        <li className="mention-list-head" role="presentation">
          {head}
        </li>
      )}
      <li
        role="option"
        aria-selected={selected}
        className={[selected ? 'selected' : '', outside ? 'outside' : ''].filter(Boolean).join(' ') || undefined}
        // El mouse elige sin sacarle el foco al cuadro.
        onMouseDown={(e) => {
          e.preventDefault();
          onPick();
        }}
        onMouseEnter={onHover}
      >
        <strong>{c.label}</strong>
        <span className="muted">{c.email}</span>
      </li>
    </>
  );
}

const formats = new Map<string, { time: Intl.DateTimeFormat; day: Intl.DateTimeFormat; year: Intl.DateTimeFormat }>();
function formatsFor(lang: Translate['lang']) {
  const loc = locale(lang);
  let f = formats.get(loc);
  if (!f) {
    f = {
      time: new Intl.DateTimeFormat(loc, { hour: 'numeric', minute: '2-digit' }),
      day: new Intl.DateTimeFormat(loc, { month: 'short', day: 'numeric' }),
      year: new Intl.DateTimeFormat(loc, { month: 'short', day: 'numeric', year: 'numeric' }),
    };
    formats.set(loc, f);
  }
  return f;
}

/** "just now", "5 min", "3:40 PM", "Sep 30", "Sep 30, 2025" (o en castellano, con `tr`). */
export function when(iso: string, now = Date.now(), tr: Translate = current): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = now - t;
  if (diff < 60_000) return tr('comments.justNow');
  if (diff < 3_600_000) return tr('comments.minutes', { count: Math.floor(diff / 60_000) });
  const d = new Date(t);
  const today = new Date(now);
  const f = formatsFor(tr.lang);
  if (d.toDateString() === today.toDateString()) return f.time.format(d);
  return d.getFullYear() === today.getFullYear() ? f.day.format(d) : f.year.format(d);
}

/** El nombre con el que comenta el visitante de un link (P8): lo pide la primera vez y se puede cambiar. */
function VisitorName() {
  const link = useLinkMode();
  const name = useVisitorName();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const tr = useT();
  if (!link) return null;
  if (name && !editing) {
    return (
      <p className="comments-note link-name">
        {tr('link.commentingAs', { name })}{' '}
        <button
          className="link"
          onClick={() => {
            setValue(name);
            setEditing(true);
          }}
        >
          {tr('link.changeName')}
        </button>
      </p>
    );
  }
  return (
    <form
      className="comments-note link-name"
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim()) return;
        setVisitorName(link.entry.id, value);
        setEditing(false);
      }}
    >
      <span>{tr('link.namePrompt')}</span>
      <input
        aria-label={tr('link.yourName')}
        placeholder={tr('link.yourName')}
        maxLength={60}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button className="primary" disabled={!value.trim()}>
        {tr('link.saveName')}
      </button>
    </form>
  );
}
