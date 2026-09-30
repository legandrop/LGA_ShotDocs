import { useEffect, useState } from 'react';
import { clearInviteTarget } from '../invite';
import type { MediaRecord } from '../media/mediaDb';
import { mediaDbName } from '../media/mediaDb';
import { commentsDbName } from '../sync/comments';
import { useServices, useSyncStatus } from '../services';
import { unsyncedSummary, type UnsyncedSummary } from '../sync/unsynced';
import { errorMessage } from '../sync/types';
import type { StorageNames } from '../workspace';
import { forgetWorkspaceStorage, readWorkspaces, removeWorkspace, updateWorkspaces } from '../workspaces';
import { downloadUnsynced, saveBlob } from './unsyncedDownload';

// Sacaron a la persona del workspace (sección 8 de Docs/Plan_Workspaces.md). Aparece SOLO con la señal
// explícita de la base (su fila de `members` con `removed_at`). No borra nada sola: si hay cambios sin
// subir, ofrece bajarlos como archivo, y la base local se borra recién cuando la persona toca "Remove from
// this device" (decisión a confirmar con Lega: también sin cambios pendientes espera ese toque).

/** Otra pestaña o ventana de la app tiene la base abierta: el borrado queda esperando. */
export class DeleteBlocked extends Error {}

/**
 * Borra una base de IndexedDB. Si otra pestaña la tiene abierta, el navegador avisa `blocked`: en vez de
 * quedarse colgado, se rechaza con `DeleteBlocked` (el pedido sigue en pie y termina solo cuando la otra
 * pestaña se cierra; reintentar lo confirma).
 */
export function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error(`Could not delete ${name}`));
    req.onblocked = () => reject(new DeleteBlocked(name));
  });
}

/**
 * Borra las bases de un workspace y usuario en el dispositivo: primero la principal (el texto, la cola del
 * árbol y lo que dice qué falta subir) y después la de fotos y videos y la de comentarios. Si otra pestaña
 * tiene la principal abierta, no se borra nada; si después se bloquea otra, reintentar sigue desde ahí
 * (borrar una base que ya no existe no falla). Rechaza con `DeleteBlocked` si hay que cerrar otras pestañas.
 * `keepMedia`: la base de fotos y videos no se pudo abrir, así que no se sabe si tiene originales sin subir
 * y queda en el dispositivo.
 */
export async function deleteWorkspaceDatabases(dbName: string, keepMedia = false): Promise<void> {
  await deleteDatabase(dbName);
  if (!keepMedia) await deleteDatabase(mediaDbName(dbName));
  await deleteDatabase(commentsDbName(dbName));
}

/** El aviso cuando la base de fotos y videos no abrió: no se borra (podría tener originales sin subir). */
export const MEDIA_KEPT_NOTE =
  'The storage for photos and videos could not be opened on this device, so it may still hold originals that were never uploaded. It stays on this device; everything else is removed.';

/**
 * Los originales de fotos y videos que nunca subieron: el archivo JSON no los trae, así que se bajan de a
 * uno. `downloaded` marca los ya bajados.
 */
export function PendingMediaList(props: {
  media: MediaRecord[];
  downloaded: ReadonlySet<string>;
  onDownload: (record: MediaRecord) => void;
}) {
  if (props.media.length === 0) return null;
  return (
    <div className="removed-media">
      <span className="muted">The file does not include the original photos and videos. Download each one:</span>
      <ul>
        {props.media.map((m) => (
          <li key={m.id}>
            <button className="link" onClick={() => props.onDownload(m)}>
              {m.name}
            </button>{' '}
            <span className="muted">
              {sizeLabel(m.size)}
              {props.downloaded.has(m.id) ? ' · downloaded' : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Lo que la app recuerda en este dispositivo de ese workspace y esa persona (proyecto y últimas páginas). */
export function forgetWorkspaceKeys(storage: StorageNames, userId: string, projectIds: string[]): void {
  try {
    const projects = JSON.parse(localStorage.getItem(storage.project) ?? '{}') as Record<string, string>;
    delete projects[userId];
    localStorage.setItem(storage.project, JSON.stringify(projects));
    const pages = JSON.parse(localStorage.getItem(storage.lastPages) ?? '{}') as Record<string, string>;
    for (const id of projectIds) delete pages[id];
    localStorage.setItem(storage.lastPages, JSON.stringify(pages));
  } catch {
    // Son comodidades: si no se pueden limpiar, no importa.
  }
  clearInviteTarget(storage.inviteTarget);
}

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function RemovedScreen() {
  const services = useServices();
  const { db, mediaDb, commentsDb, docs, tree, user, workspace, client, dbName } = services;
  const [blocked, setBlocked] = useState(false);
  const status = useSyncStatus();
  const [summary, setSummary] = useState<UnsyncedSummary | null>(null);
  const [media, setMedia] = useState<MediaRecord[]>([]);
  const [downloaded, setDownloaded] = useState(false);
  const [mediaDone, setMediaDone] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      await docs.flush().catch(() => undefined);
      const [s, m] = await Promise.all([unsyncedSummary(db, mediaDb, commentsDb), mediaDb ? mediaDb.getAllFromIndex('files', 'pending', 1) : []]);
      if (!live) return;
      setSummary(s);
      setMedia(m);
    })().catch((err: unknown) => live && setError(errorMessage(err)));
    return () => {
      live = false;
    };
  }, [db, mediaDb, commentsDb, docs, status.pendingOps, status.pendingPages, status.pendingMedia, status.pendingComments]);

  const pending = summary?.total ?? 0;
  const name = status.workspaceName || workspace.config.name || 'this workspace';

  async function download() {
    setBusy('download');
    setError(null);
    try {
      await downloadUnsynced(services, name);
      setDownloaded(true);
    } catch (err) {
      setError(`The file could not be made (${errorMessage(err)}). Nothing was deleted.`);
    } finally {
      setBusy(null);
    }
  }

  async function downloadMedia(record: MediaRecord) {
    const blob = await mediaDb?.get('blobs', record.id);
    if (blob) {
      saveBlob(blob, record.name);
      setMediaDone((prev) => new Set(prev).add(record.id));
    } else setError(`“${record.name}” is not on this device anymore.`);
  }

  async function removeFromDevice() {
    const mediaLeft = media.filter((m) => !mediaDone.has(m.id)).length;
    if (
      !blocked &&
      pending > 0 &&
      (!downloaded || mediaLeft > 0) &&
      !confirm(
        `${pending} changes on this device were never uploaded, and you have not downloaded ${downloaded ? `${mediaLeft} of the photos and videos` : 'them'}. Removing deletes them for good. Remove anyway?`,
      )
    ) {
      return;
    }
    setBusy('remove');
    setError(null);
    setBlocked(false);
    const projectIds = tree.projects().map((p) => p.id);
    try {
      await services.shutdown();
      await deleteWorkspaceDatabases(dbName, mediaDb === null);
      forgetWorkspaceKeys(workspace.config.storage, user.id, projectIds);
      await client.auth.signOut({ scope: 'local' });
      // Un workspace que no es el de la compilación sale también de la lista del dispositivo (paso 12), y la
      // app vuelve a otro workspace o a la bienvenida.
      const entry = readWorkspaces().workspaces.find((w) => w.id === workspace.config.localKey);
      if (entry && !entry.legacy) {
        forgetWorkspaceStorage(entry);
        updateWorkspaces((l) => removeWorkspace(l, entry.id));
        location.replace('/');
      }
    } catch (err) {
      setBusy(null);
      if (err instanceof DeleteBlocked) {
        setBlocked(true);
        setError('Close other tabs or windows of the app on this device, then tap “Remove from this device” again.');
      } else {
        setError(`Could not remove everything (${errorMessage(err)}). Reload the app and try again.`);
      }
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
              {summary.media > 0 && ` · ${summary.media} photos or videos`}
              {summary.comments > 0 && ` · ${summary.comments} ${summary.comments === 1 ? 'comment' : 'comments'}`}. Download them before removing this
              workspace from the device.
            </p>
            <button className="primary" disabled={busy !== null} onClick={() => void download()}>
              {busy === 'download' ? 'Preparing…' : downloaded ? 'Download again' : 'Download my unsynced changes'}
            </button>
            <PendingMediaList media={media} downloaded={mediaDone} onDownload={(m) => void downloadMedia(m)} />
          </>
        )}
        {summary !== null && pending === 0 && (
          <p className="muted">Everything on this device was already uploaded. You can remove it from here.</p>
        )}
        {mediaDb === null && <p className="muted">{MEDIA_KEPT_NOTE}</p>}
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
