import { useEffect, useState } from 'react';
import { t, useT, type Translate } from '../i18n';
import { importJobFor } from '../import/importJob';
import { replaceBlocksLeaving } from './replaceUi';
import { clearInviteTarget } from '../invite';
import { formatSize } from '../media/fileTrash';
import type { MediaRecord } from '../media/mediaDb';
import { mediaDbName } from '../media/mediaDb';
import { commentsDbName } from '../sync/comments';
import { deleteHistoryCache } from '../sync/historyCache';
import { foldersDbName } from '../media/folderUpload';
import { useServices, useSyncStatus } from '../services';
import { unsyncedSummary, type UnsyncedSummary } from '../sync/unsynced';
import { errorMessage } from '../sync/types';
import type { StorageNames } from '../workspace';
import { forgetWorkspaceStorage, readWorkspaces, removeWorkspace, updateWorkspaces } from '../workspaces';
import { downloadUnsynced, saveBlob } from './unsyncedDownload';
import { signOutAccepted } from './commentsUi';
import { signOutHere, signOutQuestion, unsentCount } from './menus';

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
  // La lista de trabajo de las carpetas (sin bytes: las carpetas siguen en el disco de quien las soltó).
  await deleteDatabase(foldersDbName(dbName));
  // La caché del historial de versiones (una copia de lo que está en el servidor).
  await deleteHistoryCache(dbName);
}

/**
 * Qué hay sin subir, en detalle (" · 2 pages · 3 page changes · 1 comment"). El aviso cuando la base de fotos
 * y videos no abrió (no se borra: podría tener originales sin subir) es `removed.mediaKept`.
 */
export function unsyncedDetail(summary: UnsyncedSummary, tr: Translate): string {
  const parts: string[] = [];
  if (summary.pages > 0) parts.push(tr('unsynced.pages', { count: summary.pages }));
  if (summary.ops + summary.failedOps > 0) parts.push(tr('unsynced.pageChanges', { count: summary.ops + summary.failedOps }));
  if (summary.images > 0) parts.push(tr('unsynced.images', { count: summary.images }));
  if (summary.media > 0) parts.push(tr('unsynced.media', { count: summary.media }));
  if (summary.comments > 0) parts.push(tr('unsynced.comments', { count: summary.comments }));
  return parts.map((p) => ` · ${p}`).join('');
}

/**
 * Los originales de fotos y videos que nunca subieron: el archivo JSON no los trae, así que se bajan de a
 * uno. `downloaded` marca los ya bajados.
 */
export function PendingMediaList(props: {
  media: MediaRecord[];
  downloaded: ReadonlySet<string>;
  onDownload: (record: MediaRecord) => void;
}) {
  const tr = useT();
  if (props.media.length === 0) return null;
  return (
    <div className="removed-media">
      <span className="muted">{tr('removed.mediaList')}</span>
      <ul>
        {props.media.map((m) => (
          <li key={m.id}>
            <button className="link" onClick={() => props.onDownload(m)}>
              {m.name}
            </button>{' '}
            <span className="muted">
              {formatSize(m.size)}
              {props.downloaded.has(m.id) ? ` · ${tr('removed.downloaded')}` : ''}
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
  const tr = useT();

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
  // Lo que falta subir de las carpetas (P.9): sigue en el disco de quien las soltó, pero conviene decirlo.
  const foldersLeft = (services.folders?.all() ?? []).reduce((n, p) => n + (p.files - p.doneFiles), 0);
  const name = status.workspaceName || workspace.config.name || tr('noProjects.thisWorkspace');

  async function download() {
    setBusy('download');
    setError(null);
    try {
      await downloadUnsynced(services, name);
      setDownloaded(true);
    } catch (err) {
      setError(t('removed.downloadFailed', { reason: errorMessage(err) }));
    } finally {
      setBusy(null);
    }
  }

  async function downloadMedia(record: MediaRecord) {
    const blob = await mediaDb?.get('blobs', record.id);
    if (blob) {
      saveBlob(blob, record.name);
      setMediaDone((prev) => new Set(prev).add(record.id));
    } else setError(t('removed.mediaGone', { name: record.name }));
  }

  /** Con una importación de Coda en curso, cerrar la sesión o borrar las bases la cortaría: se espera. */
  function importing(): boolean {
    // Un reemplazo en todo el proyecto en curso, igual (escribiría en una base cerrada o borrada).
    if (replaceBlocksLeaving()) return true;
    if (!importJobFor(tree).get().running) return false;
    alert(t('import.running'));
    return true;
  }

  async function removeFromDevice() {
    if (importing()) return;
    const mediaLeft = media.filter((m) => !mediaDone.has(m.id)).length;
    // Lo que quedó sin copiar en el cartel de un comentario que se cerró solo (LeftDrafts.tsx) se pierde al salir: la
    // misma oración que un comentario a medio escribir, adelante de la pregunta de siempre (una sola).
    const writing = unsentCount();
    const unsent = writing > 0 ? `${t('comments.draftUnsent', { count: writing })} ` : '';
    const question =
      !blocked && pending > 0 && (!downloaded || mediaLeft > 0)
        ? downloaded
          ? t('removed.confirmMediaLeft', { count: pending, left: mediaLeft })
          : t('removed.confirmNotDownloaded', { count: pending })
        : null;
    if (question ? !confirm(unsent + question) : writing > 0 && !confirm(signOutQuestion(0, 0, writing))) return;
    setBusy('remove');
    setError(null);
    setBlocked(false);
    const projectIds = tree.projects().map((p) => p.id);
    try {
      await services.shutdown();
      await deleteWorkspaceDatabases(dbName, mediaDb === null);
      forgetWorkspaceKeys(workspace.config.storage, user.id, projectIds);
      await signOutAccepted(() => client.auth.signOut({ scope: 'local' }));
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
        setError(t('removed.blocked'));
      } else {
        setError(t('removed.failed', { reason: errorMessage(err) }));
      }
    }
  }

  return (
    <main className="center-screen">
      <div className="card removed-card">
        <h1>{tr('removed.title')}</h1>
        <p className="muted">{tr('removed.text', { name, email: user.email })}</p>
        {summary === null && !error && <p className="muted">{tr('removed.checking')}</p>}
        {summary !== null && pending > 0 && (
          <>
            <p>
              <strong>{tr('removed.pending', { count: pending })}</strong>
              {unsyncedDetail(summary, tr)}. {tr('removed.downloadFirst')}
            </p>
            <button className="primary" disabled={busy !== null} onClick={() => void download()}>
              {busy === 'download' ? tr('common.preparing') : downloaded ? tr('removed.downloadAgain') : tr('sync.downloadUnsynced')}
            </button>
            <PendingMediaList media={media} downloaded={mediaDone} onDownload={(m) => void downloadMedia(m)} />
            {foldersLeft > 0 && <p className="muted">{tr('removed.foldersLeft', { count: foldersLeft })}</p>}
          </>
        )}
        {summary !== null && pending === 0 && foldersLeft === 0 && <p className="muted">{tr('removed.allUploaded')}</p>}
        {summary !== null && pending === 0 && foldersLeft > 0 && <p>{tr('removed.foldersLeft', { count: foldersLeft })}</p>}
        {mediaDb === null && <p className="muted">{tr('removed.mediaKept')}</p>}
        {error && <p className="error">{error}</p>}
        <button className={pending > 0 ? 'secondary' : 'primary'} disabled={busy !== null || summary === null} onClick={() => void removeFromDevice()}>
          {busy === 'remove' ? tr('removed.removing') : tr('removed.remove')}
        </button>
        <button className="link" disabled={busy !== null} onClick={() => !importing() && signOutHere(() => client.auth.signOut({ scope: 'local' }))}>
          {tr('removed.signOutKeep')}
        </button>
      </div>
    </main>
  );
}
