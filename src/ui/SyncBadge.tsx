import { useState } from 'react';
import { useServices, useSyncStatus, useTree } from '../services';
import { ErrorIcon, OfflineIcon, SyncedIcon, UploadingIcon, WarningIcon } from './icons';
import { usePendingCount } from './usePendingCount';

type Tone = 'ok' | 'busy' | 'offline' | 'warn' | 'error';

const TONE_ICONS = { ok: SyncedIcon, busy: UploadingIcon, offline: OfflineIcon, warn: WarningIcon, error: ErrorIcon };

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function useSyncTone(): { tone: Tone; text: string; rejected: number } {
  const status = useSyncStatus();
  const pending = usePendingCount();
  const rejected = status.failedOps + status.rejectedPages;
  let tone: Tone = 'ok';
  let text = 'All synced';
  if (status.localError) {
    tone = 'error';
    text = 'Could not save on this device · retrying';
  } else if (!status.online) {
    tone = 'offline';
    text = pending > 0 ? `Offline · ${count(pending, 'change', 'changes')} saved on this device` : 'Offline';
  } else if (status.lastError && !status.syncing) {
    tone = 'warn';
    text = pending > 0 ? `${count(pending, 'change', 'changes')} not uploaded · retrying` : 'Sync problem · retrying';
  } else if (pending > 0) {
    tone = 'busy';
    text = status.syncing ? `Uploading ${count(pending, 'change', 'changes')}…` : `${count(pending, 'change', 'changes')} not uploaded`;
  } else if (status.lastSyncAt === null) {
    tone = 'busy';
    text = 'Syncing…';
  }
  if ((rejected > 0 || status.warning) && tone !== 'error') tone = 'warn';
  return { tone, text, rejected };
}

/** Versión chica para la barra de arriba en el teléfono: solo el ícono, con el texto como etiqueta. */
export function SyncIcon({ onClick }: { onClick: () => void }) {
  const { tone, text } = useSyncTone();
  const Icon = TONE_ICONS[tone];
  return (
    <button className={`icon-button sync-icon ${tone}`} aria-label={text} title={text} onClick={onClick}>
      <Icon size={20} />
    </button>
  );
}

/** Siempre dice si hay cambios sin subir y si algo anda mal (regla 6 de la sincronización). */
export function SyncBadge() {
  const status = useSyncStatus();
  const tree = useTree();
  const { engine } = useServices();
  const [details, setDetails] = useState(false);
  const { tone, text, rejected } = useSyncTone();
  const Icon = TONE_ICONS[tone];
  const hasDetails = rejected > 0 || !!status.localError || !!status.lastError || !!status.warning;

  return (
    <div className="sync">
      <button
        className={`sync-pill ${tone}`}
        title={status.localError ?? status.lastError ?? undefined}
        aria-expanded={hasDetails ? details : undefined}
        onClick={() => (hasDetails ? setDetails(!details) : void engine.syncNow())}
      >
        <Icon size={15} />
        <span>{text}</span>
      </button>
      {rejected > 0 && (
        <button className="sync-warning" onClick={() => setDetails(!details)}>
          {count(rejected, 'change', 'changes')} rejected by the server
        </button>
      )}
      {details && (
        <div className="sync-details">
          {status.localError && (
            <p>
              <strong>This device could not save your last edits</strong> ({status.localError}). They are kept in
              memory and saving is retried every few seconds. Do not close the app until this message goes away;
              freeing up storage space usually fixes it.
            </p>
          )}
          {status.lastError && !status.localError && (
            <p>
              Last problem: <code>{status.lastError}</code>. Nothing is lost; syncing keeps retrying.
            </p>
          )}
          {status.warning && (
            <p>
              <code>{status.warning}</code> Reopening the app tries again; updating the app may be needed.
            </p>
          )}
          {rejected > 0 && (
            <>
              <p>
                The server did not accept these changes. Nothing was lost: they stay on this device until you
                retry.
              </p>
              <ul>
                {tree.failedOps().map((f) => (
                  <li key={f.seq}>
                    {f.op.kind === 'create'
                      ? `Create “${f.op.page.title || 'Untitled'}”`
                      : `Change “${tree.get(f.op.id)?.title || 'Untitled'}”`}
                    : <code>{f.error}</code>
                  </li>
                ))}
                {status.rejectedPages > 0 && (
                  <li>{count(status.rejectedPages, 'page', 'pages')} whose content could not be uploaded</li>
                )}
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
                Retry
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
                Hide what can be discarded
              </button>
            )}
            <button className="link" onClick={() => setDetails(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
