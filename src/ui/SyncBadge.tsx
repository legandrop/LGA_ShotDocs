import { useEffect, useState, useSyncExternalStore } from 'react';
import { localize, t, useT, type Translate } from '../i18n';
import type { MediaFailure } from '../media/queue';
import type { SyncStatus } from '../sync/engine';
import { useServices, useSyncStatus, useTree } from '../services';
import { ErrorIcon, OfflineIcon, SyncedIcon, UploadingIcon, WarningIcon } from './icons';
import { rejectionText } from './teamText';
import { copyText } from './commentsUi';
import { usePendingCount } from './usePendingCount';
import { downloadUnsynced, saveBlob } from './unsyncedDownload';
import { notify } from './notice';
import { VoiceNotesNotice } from '../dictation/VoiceNotes';
import { LinkRemote } from '../sync/linkRemote';
import { useLinkEdits } from './LinkEditBar';
import {
  forceUpdate,
  isAppUpdating,
  isOfflineNotReady,
  isUpdateStuck,
  setStuck,
  subscribeAppUpdating,
  subscribeOfflineNotReady,
  subscribeUpdateStuck,
  updateNow,
} from './appUpdate';

export type Tone = 'ok' | 'busy' | 'offline' | 'warn' | 'error';

const TONE_ICONS = { ok: SyncedIcon, busy: UploadingIcon, offline: OfflineIcon, warn: WarningIcon, error: ErrorIcon };

/** Qué comentario no se pudo subir, en el detalle. */
function commentAction(tr: Translate, kind: 'add' | 'edit' | 'delete' | 'resolve' | 'import' | 'mentions', page: string): string {
  if (kind === 'add') return tr('sync.comment.add', { page });
  if (kind === 'mentions') return tr('sync.comment.mentions', { page });
  if (kind === 'import') return tr('sync.comment.import', { page });
  if (kind === 'edit') return tr('sync.comment.edit', { page });
  if (kind === 'delete') return tr('sync.comment.delete', { page });
  return tr('sync.comment.resolve', { page });
}

/** Con un link *Can edit*: lo que mandó este navegador y espera a que el equipo lo sume (E2.9). */
function useVisitorEdits() {
  const { remote } = useServices();
  return useLinkEdits(remote instanceof LinkRemote ? remote : null);
}

const noSubscribe = () => () => undefined;
const never = () => false;

/**
 * Con un link: la lista de páginas puede estar atrasada (cambió y su bajada todavía no pudo terminar, porque la rama
 * sigue cambiando). No es un error ni frena nada: va como una línea en el detalle, y se va sola con el árbol nuevo.
 */
function useVisitorTreeBehind(): boolean {
  const { remote } = useServices();
  const link = remote instanceof LinkRemote ? remote : null;
  return useSyncExternalStore(link?.subscribeLinkEdits ?? noSubscribe, link?.treeBehind ?? never);
}

function useSyncTone(): { tone: Tone; text: string; rejected: number } {
  const status = useSyncStatus();
  const pending = usePendingCount();
  const visitor = useVisitorEdits();
  const tr = useT();
  return syncTone(status, pending, visitor.waiting.length > 0, tr);
}

/** El tono y el texto de la pastilla para un estado (sin React: lo prueban `syncBadge.test.ts`). */
export function syncTone(
  status: SyncStatus,
  pending: number,
  visitorWaiting: boolean,
  tr: Translate,
): { tone: Tone; text: string; rejected: number } {
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
    // «Uploading» también mientras la cola de archivos manda, que corre después del ciclo (D612).
    const sending = status.syncing || status.mediaSending;
    text =
      up && up.total > 0
        ? tr('sync.uploadingPercent', { changes, percent: Math.floor((up.sent / up.total) * 100) })
        : sending
          ? tr('sync.uploading', { changes })
          : tr('sync.notUploaded', { changes });
  } else if (status.lastSyncAt === null) {
    tone = 'busy';
    text = tr('sync.syncing');
  } else if (visitorWaiting) {
    // Un link: todo mandado, pero todavía en la sala (entra cuando alguien del equipo abre la app).
    text = tr('link.edit.waiting');
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
  const updating = useSyncExternalStore(subscribeAppUpdating, isAppUpdating);
  // "Update now" no trajo la versión nueva aunque el servidor tiene otra: se ofrece forzarla (appUpdate.ts).
  const stuck = useSyncExternalStore(subscribeUpdateStuck, isUpdateStuck);
  // Después de forzar la actualización, hasta que la versión nueva termine de instalarse, sin red no abre.
  const notReady = useSyncExternalStore(subscribeOfflineNotReady, isOfflineNotReady);
  const tree = useTree();
  const services = useServices();
  const { engine, media, comments } = services;
  const pending = usePendingCount();
  const [details, setDetails] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const { tone, text, rejected } = useSyncTone();
  // Lo rechazado que *Retry* puede volver a mandar: todo menos las ediciones apartadas por un conflicto (no están en
  // la cola; la persona elige en el panel de comentarios).
  const retryable = rejected - (status.failedComments > 0 ? comments.failures().filter((f) => f.conflictOf).length : 0);
  const visitor = useVisitorEdits();
  const treeBehind = useVisitorTreeBehind();
  const tr = useT();
  const Icon = TONE_ICONS[tone];
  const mediaError = status.pendingMedia > 0 ? status.mediaError : null;
  const commentError = status.pendingComments > 0 ? status.commentError : null;
  const hasDetails =
    rejected > 0 ||
    visitor.waiting.length > 0 ||
    treeBehind ||
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
        {updating ? <span className="app-update-spinner" aria-hidden="true" /> : <Icon size={15} />}
        <span>{text}</span>
      </button>
      {updating && <p className="sync-hint" role="status">{tr('sync.detail.updatingWait')}</p>}
      {notReady && <p className="sync-hint">{tr('sync.offlineNotReady')}</p>}
      {rejected > 0 && (
        <button className="sync-warning" onClick={() => setDetails(!details)}>
          {tr('sync.rejected', { count: rejected })}
        </button>
      )}
      {/* Las notas de *Dictate to report* guardadas para ubicar después (Docs/Doc_Dictado.md, 8). */}
      <VoiceNotesNotice />
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
          {/* Un link: el pegado de más de 1 MB no se manda (R1); deshacerlo destraba la página. */}
          {status.lastError === 'update_size_invalid' && services.remote instanceof LinkRemote && <p>{tr('link.edit.tooBig')}</p>}
          {visitor.waiting.length > 0 && <p>{tr('link.edit.waitingDetail')}</p>}
          {treeBehind && <p>{tr('link.treeBehind')}</p>}
          {mediaError && !status.localError && (
            <p>{tr.rich('sync.detail.mediaError', { error: <code>{localize(mediaError)}</code> })}</p>
          )}
          {commentError && !status.localError && (
            <p>{tr.rich('sync.detail.commentError', { error: <code>{localize(commentError)}</code> })}</p>
          )}
          {status.outdated && (
            <p>
              <strong>{tr('sync.detail.outdatedTitle')}</strong> {tr('sync.detail.outdated')}{' '}
              <button className="link" disabled={updating} aria-busy={updating} onClick={() => void updateNow()}>
                {tr(updating ? 'sync.detail.updating' : 'sync.detail.updateNow')}
              </button>
            </p>
          )}
          {status.outdated && !updating && stuck === 'failed' && <p>{tr('sync.detail.installFailed')}</p>}
          {status.outdated && stuck === 'force' && (
            <p>
              {tr('sync.detail.stuck')}{' '}
              <button
                className="link"
                disabled={updating}
                aria-busy={updating}
                onClick={() =>
                  void forceUpdate().then((result) => {
                    // Sin lugar para instalarla, forzar dejaría la app sin abrir sin red: se explica qué hacer.
                    if (result === 'noSpace') setStuck('failed');
                    else if (result !== 'reloaded') notify(tr('sync.detail.forceFailed'));
                  })
                }
              >
                {tr(updating ? 'sync.detail.updating' : 'sync.detail.force')}
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
              {/* Solo ediciones apartadas por un conflicto: no hay nada que reintentar; se decide en el panel. */}
              <p>{tr(retryable > 0 ? 'sync.detail.rejected' : 'sync.detail.aside')}</p>
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
                    {/* Con un link, un archivo que no sube (la página salió de la rama, un tope) se puede bajar: con
                        el link no se completa nunca solo (B1 de la auditoría de la 2b). */}
                    {services.remote instanceof LinkRemote && !f.id.includes(':') && (
                      <>
                        {' '}
                        <button
                          className="link"
                          onClick={() =>
                            void media.source(f.id).then(
                              (src) => (src.original ? saveBlob(src.original, f.name) : notify(tr('sync.downloadFailed'))),
                              () => notify(tr('sync.downloadFailed')),
                            )
                          }
                        >
                          {tr('link.aside.download')}
                        </button>
                      </>
                    )}
                  </li>
                ))}
                {status.failedComments > 0 &&
                  comments.failures().map((f) => (
                    <li key={f.conflictOf ? `comment-conflict-${f.conflictOf}` : `comment-${f.seq}`}>
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
                          if (f.conflictOf) {
                            // Una edición apartada por un conflicto no está en la cola: se descarta por su comentario.
                            if (confirm(`${t('commentDiscard.conflict')} ${t('common.cannotUndo')}`)) void comments.discardMine(f.conflictOf);
                            return;
                          }
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
            {retryable > 0 && (
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
