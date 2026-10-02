import { useEffect, useState, useSyncExternalStore } from 'react';
import { localize, t, useT, type Translate } from '../i18n';
import type { MediaFailure } from '../media/queue';
import { useServices, useSyncStatus, useTree } from '../services';
import { ErrorIcon, OfflineIcon, SyncedIcon, UploadingIcon, WarningIcon } from './icons';
import { rejectionText } from './teamText';
import { copyText } from './commentsUi';
import { usePendingCount } from './usePendingCount';
import { downloadUnsynced } from './unsyncedDownload';
import { notify } from './notice';
import { forceUpdate, isUpdateStuck, subscribeUpdateStuck, updateNow } from './appUpdate';

type Tone = 'ok' | 'busy' | 'offline' | 'warn' | 'error';

const TONE_ICONS = { ok: SyncedIcon, busy: UploadingIcon, offline: OfflineIcon, warn: WarningIcon, error: ErrorIcon };

/** Qué comentario no se pudo subir, en el detalle. */
function commentAction(tr: Translate, kind: 'add' | 'edit' | 'delete' | 'resolve' | 'import', page: string): string {
  if (kind === 'add') return tr('sync.comment.add', { page });
  if (kind === 'import') return tr('sync.comment.import', { page });
  if (kind === 'edit') return tr('sync.comment.edit', { page });
  if (kind === 'delete') return tr('sync.comment.delete', { page });
  return tr('sync.comment.resolve', { page });
}

function useSyncTone(): { tone: Tone; text: string; rejected: number } {
  const status = useSyncStatus();
  const pending = usePendingCount();
  const tr = useT();
  const changes = tr('sync.changes', { count: pending });
  const rejected = status.failedOps + status.rejectedPages + status.failedMedia + status.failedComments;
  // La cola de fotos y videos tiene su propio ciclo: su error cuenta mientras le quede algo por subir.
  const mediaError = status.pendingMedia > 0 ? status.mediaError : null;
  const commentError = status.pendingComments > 0 ? status.commentError : null;
  let tone: Tone = 'ok';
  let text = tr('sync.allSynced');
  if (status.localError) {
    tone = 'error';
    text = tr('sync.localError');
  } else if (!status.online) {
    tone = 'offline';
    text = pending > 0 ? tr('sync.offlinePending', { count: pending }) : tr('sync.offline');
  } else if ((status.lastError && !status.syncing) || (mediaError && !status.uploading) || (commentError && !status.syncing)) {
    tone = 'warn';
    text = pending > 0 ? tr('sync.notUploadedRetrying', { changes }) : tr('sync.problem');
  } else if (status.outdated) {
    tone = 'warn';
    text = pending > 0 ? tr('sync.updatePending', { changes }) : tr('sync.update');
  } else if (pending > 0) {
    tone = 'busy';
    const up = status.uploading;
    text =
      up && up.total > 0
        ? tr('sync.uploadingPercent', { changes, percent: Math.floor((up.sent / up.total) * 100) })
        : status.syncing
          ? tr('sync.uploading', { changes })
          : tr('sync.notUploaded', { changes });
  } else if (status.lastSyncAt === null) {
    tone = 'busy';
    text = tr('sync.syncing');
  }
  // La base vieja no frena la subida: el texto sigue diciendo el estado real y el aviso va en el detalle.
  if ((rejected > 0 || status.warning || status.mediaWarning || status.schemaBehind) && tone !== 'error') tone = 'warn';
  return { tone, text, rejected };
}

/** Versión chica para la barra de arriba en el teléfono: solo el ícono, con el texto como etiqueta. */
export function SyncIcon({ onClick }: { onClick: () => void }) {
  const { tone, text } = useSyncTone();
  const status = useSyncStatus();
  const pending = usePendingCount();
  const tr = useT();
  const Icon = TONE_ICONS[tone];
  // Sin conexión se dice con palabras, también en el teléfono (D-25): "Offline · 700" al lado del ícono, según la
  // conexión y no según el tono (con algo rechazado el tono pasa a aviso, y justo ahí importa saber que no hay red).
  // El `data-tip` no repite lo que ya se lee.
  const offline = !status.online;
  return (
    <button
      className={`icon-button sync-icon ${tone}${offline ? ' with-label' : ''}`}
      data-tour="sync"
      aria-label={text}
      data-tip={offline ? undefined : text}
      onClick={onClick}
    >
      <Icon size={20} />
      {offline && <span className="sync-icon-label">{pending > 0 ? tr('sync.offlineShort', { count: pending }) : tr('sync.offline')}</span>}
    </button>
  );
}

/** Siempre dice si hay cambios sin subir y si algo anda mal (regla 6 de la sincronización). */
export function SyncBadge() {
  const status = useSyncStatus();
  // "Update now" no trajo la versión nueva aunque el servidor tiene otra: se ofrece forzarla (appUpdate.ts).
  const stuck = useSyncExternalStore(subscribeUpdateStuck, isUpdateStuck);
  const tree = useTree();
  const services = useServices();
  const { engine, media, comments } = services;
  const pending = usePendingCount();
  const [details, setDetails] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const { tone, text, rejected } = useSyncTone();
  const tr = useT();
  const Icon = TONE_ICONS[tone];
  const mediaError = status.pendingMedia > 0 ? status.mediaError : null;
  const commentError = status.pendingComments > 0 ? status.commentError : null;
  const hasDetails =
    rejected > 0 ||
    !!commentError ||
    !!status.localError ||
    !!status.lastError ||
    !!mediaError ||
    !!status.warning ||
    !!status.mediaWarning ||
    !!status.notice ||
    status.outdated ||
    !!status.schemaBehind;
  // Las fotos y los videos detenidos por un error, con su nombre, para el detalle.
  const [mediaFailures, setMediaFailures] = useState<MediaFailure[]>([]);
  useEffect(() => {
    if (!details || status.failedMedia === 0) return setMediaFailures([]);
    let live = true;
    void media.failures().then((list) => live && setMediaFailures(list), () => undefined);
    return () => {
      live = false;
    };
  }, [details, media, status.failedMedia]);

  return (
    <div className="sync" data-tour="sync">
      <button
        className={`sync-pill ${tone}`}
        data-tip={localize(status.localError ?? status.lastError ?? mediaError ?? commentError ?? '') || undefined}
        aria-expanded={hasDetails ? details : undefined}
        onClick={() => (hasDetails ? setDetails(!details) : void engine.syncNow())}
      >
        <Icon size={15} />
        <span>{text}</span>
      </button>
      {rejected > 0 && (
        <button className="sync-warning" onClick={() => setDetails(!details)}>
          {tr('sync.rejected', { count: rejected })}
        </button>
      )}
      {details && (
        <div className="sync-details">
          {status.localError && (
            <p>
              {tr.rich('sync.detail.localError', {
                title: <strong>{tr('sync.detail.localErrorTitle')}</strong>,
                error: status.localError,
              })}
            </p>
          )}
          {status.lastError && !status.localError && (
            <p>{tr.rich('sync.detail.lastError', { error: <code>{localize(status.lastError)}</code> })}</p>
          )}
          {mediaError && !status.localError && (
            <p>{tr.rich('sync.detail.mediaError', { error: <code>{localize(mediaError)}</code> })}</p>
          )}
          {commentError && !status.localError && (
            <p>{tr.rich('sync.detail.commentError', { error: <code>{localize(commentError)}</code> })}</p>
          )}
          {status.outdated && (
            <p>
              <strong>{tr('sync.detail.outdatedTitle')}</strong> {tr('sync.detail.outdated')}{' '}
              <button className="link" onClick={() => void updateNow()}>
                {tr('sync.detail.updateNow')}
              </button>
            </p>
          )}
          {status.outdated && stuck && (
            <p>
              {tr('sync.detail.stuck')}{' '}
              <button
                className="link"
                onClick={() =>
                  void forceUpdate().then((reloaded) => {
                    if (!reloaded) notify(tr('sync.detail.forceFailed'));
                  })
                }
              >
                {tr('sync.detail.force')}
              </button>
            </p>
          )}
          {status.schemaBehind && (
            <p>
              <strong>{tr('sync.detail.schemaTitle')}</strong>{' '}
              {tr('sync.detail.schema', { has: status.schemaBehind[0], needs: status.schemaBehind[1] })}
            </p>
          )}
          {status.notice && <p>{localize(status.notice)}</p>}
          {/* Ya dice qué hacer (reabrir la app): va solo, sin el texto de los otros avisos. */}
          {status.mediaWarning && <p>{localize(status.mediaWarning)}</p>}
          {status.warning && (
            <p>
              <code>{localize(status.warning)}</code> {tr('sync.detail.warning')}
            </p>
          )}
          {rejected > 0 && (
            <>
              <p>{tr('sync.detail.rejected')}</p>
              <ul>
                {tree.failedOps().map((f) => (
                  <li key={f.seq}>
                    {f.op.kind === 'create'
                      ? tr('sync.op.create', { title: f.op.page.title || tr('common.untitled') })
                      : f.op.kind === 'createProject'
                        ? tr('sync.op.createProject', { name: f.op.project.name })
                        : f.op.kind === 'renameProject'
                          ? tr('sync.op.renameProject', { name: f.op.name })
                          : tr('sync.op.change', { title: tree.get(f.op.id)?.title || tr('common.untitled') })}
                    : <code>{rejectionText(f.error)}</code>
                  </li>
                ))}
                {status.rejectedPages > 0 && (
                  <li>{tr('sync.rejectedPages', { count: status.rejectedPages })}</li>
                )}
                {mediaFailures.map((f) => (
                  <li key={f.id}>
                    {tr('sync.upload', { name: f.name })}: <code>{localize(f.error)}</code>
                  </li>
                ))}
                {status.failedComments > 0 &&
                  comments.failures().map((f) => (
                    <li key={`comment-${f.seq}`}>
                      {commentAction(tr, f.kind, tree.get(f.pageId)?.title || tr('common.untitled'))}
                      {f.body ? ` (“${f.body.length > 40 ? `${f.body.slice(0, 40)}…` : f.body}”)` : ''}:{' '}
                      <code>{localize(f.error)}</code>{' '}
                      {f.body && (
                        <button className="link" onClick={() => void copyText(f.body ?? '')}>
                          {tr('sync.copyText')}
                        </button>
                      )}{' '}
                      <button
                        className="link danger"
                        onClick={() => {
                          // Nunca se descarta solo: la persona lo pide y confirma sabiendo qué pasa.
                          const info = comments.describeDiscard([f.seq]);
                          if (confirm(`${info.message} ${t('common.cannotUndo')}`)) void comments.discard(f.seq);
                        }}
                      >
                        {tr('common.discard')}
                      </button>
                    </li>
                  ))}
              </ul>
            </>
          )}
          <div className="row">
            {rejected > 0 && (
              <button
                className="link"
                onClick={() => {
                  void engine.retryRejected();
                  setDetails(false);
                }}
              >
                {tr('common.retry')}
              </button>
            )}
            {status.failedOps > 0 && (
              <button
                className="link"
                onClick={() => {
                  void tree.dismissFailed();
                  setDetails(false);
                }}
              >
                {tr('sync.hideDiscardable')}
              </button>
            )}
            {/* Lo de una página que dejaron de compartir ya no se ve en el árbol, pero sigue acá: se puede bajar. */}
            {(rejected > 0 || pending > 0) && (
              <button
                className="link"
                disabled={downloading}
                onClick={() => {
                  setDownloading(true);
                  void downloadUnsynced(services, status.workspaceName || services.workspace.config.name || 'Workspace')
                    .catch(() => notify(t('sync.downloadFailed')))
                    .finally(() => setDownloading(false));
                }}
              >
                {downloading ? tr('common.preparing') : tr('sync.downloadUnsynced')}
              </button>
            )}
            <button className="link" onClick={() => setDetails(false)}>
              {tr('common.close')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
