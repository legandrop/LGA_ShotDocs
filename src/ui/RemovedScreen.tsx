import { useEffect, useState } from 'react';
import type { MediaRecord } from '../media/mediaDb';
import { mediaDbName } from '../media/mediaDb';
import { useServices, useSyncStatus } from '../services';
import { exportUnsynced, unsyncedSummary, type UnsyncedSummary } from '../sync/unsynced';
import { errorMessage } from '../sync/types';

// Sacaron a la persona del workspace (sección 8 de Docs/Plan_Workspaces.md). Aparece SOLO con la señal
// explícita de la base (su fila de `members` con `removed_at`). No borra nada sola: si hay cambios sin
// subir, ofrece bajarlos como archivo, y la base local se borra recién cuando la persona toca "Remove from
// this device" (decisión a confirmar con Lega: también sin cambios pendientes espera ese toque).

function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error(`Could not delete ${name}`));
    // Otra conexión abierta (no debería haber: el lock es de esta ventana). Se resuelve cuando se cierre.
    req.onblocked = () => undefined;
  });
}

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function RemovedScreen() {
  const services = useServices();
  const { db, mediaDb, docs, tree, user, workspace, client, dbName } = services;
  const status = useSyncStatus();
  const [summary, setSummary] = useState<UnsyncedSummary | null>(null);
  const [media, setMedia] = useState<MediaRecord[]>([]);
  const [downloaded, setDownloaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      await docs.flush().catch(() => undefined);
      const [s, m] = await Promise.all([unsyncedSummary(db, mediaDb), mediaDb.getAllFromIndex('files', 'pending', 1)]);
      if (!live) return;
      setSummary(s);
      setMedia(m);
    })().catch((err: unknown) => live && setError(errorMessage(err)));
    return () => {
      live = false;
    };
  }, [db, mediaDb, docs, status.pendingOps, status.pendingPages, status.pendingMedia]);

  const pending = summary?.total ?? 0;
  const name = status.workspaceName || workspace.config.name || 'this workspace';

  async function download() {
    setBusy('download');
    setError(null);
    try {
      await docs.flush();
      const data = await exportUnsynced(db, mediaDb, {
        appVersion: __APP_VERSION__,
        workspace: { url: workspace.config.url, localKey: workspace.config.localKey, name },
        user: { id: user.id, email: user.email },
        titleOf: (id) => tree.get(id)?.title,
      });
      const day = new Date().toISOString().slice(0, 10);
      save(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `shotdocs-unsynced-${day}.json`);
      setDownloaded(true);
    } catch (err) {
      setError(`The file could not be made (${errorMessage(err)}). Nothing was deleted.`);
    } finally {
      setBusy(null);
    }
  }

  async function downloadMedia(record: MediaRecord) {
    const blob = await mediaDb.get('blobs', record.id);
    if (blob) save(blob, record.name);
    else setError(`“${record.name}” is not on this device anymore.`);
  }

  async function removeFromDevice() {
    if (
      pending > 0 &&
      !downloaded &&
      !confirm(
        `${pending} changes on this device were never uploaded, and you have not downloaded them. Removing deletes them for good. Remove anyway?`,
      )
    ) {
      return;
    }
    setBusy('remove');
    setError(null);
    try {
      await services.shutdown();
      await deleteDatabase(mediaDbName(dbName));
      await deleteDatabase(dbName);
      await client.auth.signOut({ scope: 'local' });
    } catch (err) {
      setBusy(null);
      setError(`Could not remove everything (${errorMessage(err)}). Reload the app and try again.`);
    }
  }

  return (
    <main className="center-screen">
      <div className="card removed-card">
        <h1>You no longer have access to this workspace</h1>
        <p className="muted">
          The owner or an admin of {name} removed {user.email}. Nothing was sent or changed since then.
        </p>
        {summary === null && !error && <p className="muted">Checking this device…</p>}
        {summary !== null && pending > 0 && (
          <>
            <p>
              <strong>
                This device has {pending} {pending === 1 ? 'change' : 'changes'} that were never uploaded
              </strong>
              {summary.pages > 0 && ` · ${summary.pages} ${summary.pages === 1 ? 'page' : 'pages'}`}
              {summary.ops + summary.failedOps > 0 && ` · ${summary.ops + summary.failedOps} page changes`}
              {summary.images > 0 && ` · ${summary.images} ${summary.images === 1 ? 'image' : 'images'}`}
              {summary.media > 0 && ` · ${summary.media} photos or videos`}. Download them before removing this
              workspace from the device.
            </p>
            <button className="primary" disabled={busy !== null} onClick={() => void download()}>
              {busy === 'download' ? 'Preparing…' : downloaded ? 'Download again' : 'Download my unsynced changes'}
            </button>
            {media.length > 0 && (
              <div className="removed-media">
                <span className="muted">Photos and videos go one by one:</span>
                <ul>
                  {media.map((m) => (
                    <li key={m.id}>
                      <button className="link" onClick={() => void downloadMedia(m)}>
                        {m.name}
                      </button>{' '}
                      <span className="muted">{sizeLabel(m.size)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        {summary !== null && pending === 0 && (
          <p className="muted">Everything on this device was already uploaded. You can remove it from here.</p>
        )}
        {error && <p className="error">{error}</p>}
        <button className={pending > 0 ? 'secondary' : 'primary'} disabled={busy !== null || summary === null} onClick={() => void removeFromDevice()}>
          {busy === 'remove' ? 'Removing…' : 'Remove from this device'}
        </button>
        <button className="link" disabled={busy !== null} onClick={() => void client.auth.signOut({ scope: 'local' })}>
          Sign out and keep it on this device
        </button>
      </div>
    </main>
  );
}
