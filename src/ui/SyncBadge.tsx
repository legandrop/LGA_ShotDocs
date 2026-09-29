import { useState } from 'react';
import { useServices, useSyncStatus, useTree } from '../services';
import { usePendingCount } from './usePendingCount';

function changes(n: number): string {
  return `${n} ${n === 1 ? 'change' : 'changes'}`;
}

/** Siempre dice si hay cambios sin subir (regla 6 de la sincronización). */
export function SyncBadge() {
  const status = useSyncStatus();
  const pending = usePendingCount();
  const tree = useTree();
  const { engine } = useServices();
  const [details, setDetails] = useState(false);

  let tone: 'ok' | 'busy' | 'offline' | 'warn' = 'ok';
  let text = 'All synced';
  if (!status.online) {
    tone = 'offline';
    text = pending > 0 ? `Offline · ${changes(pending)} saved on this device` : 'Offline';
  } else if (pending > 0 && status.lastError && !status.syncing) {
    tone = 'warn';
    text = `${changes(pending)} not uploaded · retrying`;
  } else if (pending > 0) {
    tone = 'busy';
    text = status.syncing ? `Uploading ${changes(pending)}…` : `${changes(pending)} not uploaded`;
  } else if (status.lastSyncAt === null) {
    tone = 'busy';
    text = 'Syncing…';
  }
  if (status.failedOps > 0) tone = 'warn';

  return (
    <div className="sync">
      <button
        className={`sync-badge ${tone}`}
        title={status.lastError ?? undefined}
        onClick={() => (status.failedOps > 0 ? setDetails(!details) : void engine.syncNow())}
      >
        <span className="dot" />
        <span>{text}</span>
      </button>
      {status.failedOps > 0 && (
        <button className="sync-warning" onClick={() => setDetails(!details)}>
          {status.failedOps === 1 ? '1 change' : `${status.failedOps} changes`} rejected by the server
        </button>
      )}
      {details && (
        <div className="sync-details">
          <p>
            The server did not accept these changes (for example, a move that would put a page inside itself). No
            page content was lost: pages that could not be created stay on this device until you retry.
          </p>
          <ul>
            {tree.failedOps().map((f) => (
              <li key={f.seq}>
                {f.op.kind === 'create' ? `Create “${f.op.page.title || 'Untitled'}”` : `Change “${tree.get(f.op.id)?.title || 'Untitled'}”`}
                : <code>{f.error}</code>
              </li>
            ))}
          </ul>
          <div className="row">
            <button
              className="link"
              onClick={() => {
                void tree.retryFailed();
                setDetails(false);
              }}
            >
              Retry
            </button>
            <button
              className="link"
              onClick={() => {
                void tree.dismissFailed();
                setDetails(false);
              }}
            >
              Hide
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
