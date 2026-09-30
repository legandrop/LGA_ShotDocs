import { useCallback, useEffect, useState } from 'react';
import type { MediaRecord } from '../media/mediaDb';
import { prefs } from '../prefs';
import { useServices, useSyncStatus } from '../services';
import { errorMessage } from '../sync/types';
import { unsyncedSummary, type UnsyncedSummary } from '../sync/unsynced';
import {
  displayName,
  forgetWorkspaceStorage,
  hostOf,
  removeWorkspace,
  renameWorkspace,
  switchWorkspace,
  updateWorkspaces,
  useWorkspaceList,
  type DeviceWorkspace,
} from '../workspaces';
import { AccountIcon, PlusIcon, TrashIcon } from './icons';
import { monogram } from './project';
import { DeleteBlocked, deleteWorkspaceDatabases, forgetWorkspaceKeys, PendingMediaList } from './RemovedScreen';
import { downloadUnsynced, saveBlob } from './unsyncedDownload';
import { usePendingCount } from './usePendingCount';
import type { WorkspacesMode } from './Welcome';

// Los workspaces dentro de la app abierta (paso 12 de Docs/Plan_Workspaces.md): la sección del selector de
// proyectos, lo que se pregunta antes de dejar el workspace abierto y quitarlo del dispositivo.

/** El workspace abierto, tal como está en la lista del dispositivo. */
export function useCurrentWorkspace(): { current: DeviceWorkspace | null; all: DeviceWorkspace[] } {
  const { workspace } = useServices();
  const list = useWorkspaceList();
  return { current: list.workspaces.find((w) => w.id === workspace.config.localKey) ?? null, all: list.workspaces };
}

/** Guarda en la lista el nombre que da la base (`workspace_settings.name`), para el selector y el login. */
export function useRememberWorkspaceName(): void {
  const { workspace } = useServices();
  const status = useSyncStatus();
  const name = status.workspaceName;
  useEffect(() => {
    if (name) updateWorkspaces((l) => renameWorkspace(l, workspace.config.localKey, name));
  }, [name, workspace.config.localKey]);
}

/**
 * Antes de dejar el workspace abierto (cambiar a otro o agregar uno): lo que todavía no llegó al
 * dispositivo se perdería, así que espera; lo guardado sin subir queda en el dispositivo y sube la próxima
 * vez que se abra ese workspace. `false` cancela.
 */
export function useLeaveGuard(): () => boolean {
  const { docs, tree, media, comments } = useServices();
  const pending = usePendingCount();
  const { current } = useCurrentWorkspace();
  const name = current ? displayName(current) : 'this workspace';
  return useCallback(() => {
    if (docs.hasUnsavedEdits() || tree.hasUnsavedWrites() || media.hasUnsavedWrites() || comments.hasUnsavedWrites()) {
      alert('Some of your latest edits are not saved on this device yet. Wait a moment and try again.');
      return false;
    }
    // Las preferencias sin subir quedan en el dispositivo (una copia por usuario) y suben al volver.
    const settings = prefs.hasUnsynced();
    if (pending === 0 && !settings) return true;
    const what = [
      pending > 0 ? `${pending} ${pending === 1 ? 'change' : 'changes'}` : '',
      settings ? 'your appearance settings' : '',
    ]
      .filter(Boolean)
      .join(' and ');
    return confirm(
      `${what[0].toUpperCase()}${what.slice(1)} in ${name} ${pending + (settings ? 1 : 0) === 1 ? 'is' : 'are'} not uploaded yet. ` +
        `They stay saved on this device and upload the next time you open ${name}. Continue?`,
    );
  }, [docs, tree, media, comments, pending, name]);
}

/**
 * Al pie del selector de proyectos. Con un solo workspace, una línea discreta ("Join or create a
 * workspace…"); con varios, la lista para cambiar y unirse o crear. Quitar del dispositivo se ofrece para
 * el abierto, salvo el de la compilación (Wanka en la dirección de Lega), que no se quita nunca.
 */
export function WorkspaceSection(props: {
  onClose: () => void;
  onDialog: (mode: WorkspacesMode) => void;
  onRemove: () => void;
}) {
  const { current, all } = useCurrentWorkspace();
  const leave = useLeaveGuard();
  const removable = !!current && !current.legacy;
  const open = (mode: WorkspacesMode) => {
    props.onClose();
    props.onDialog(mode);
  };
  if (all.length <= 1) {
    return (
      <>
        <hr />
        <button className="workspace-more" onClick={() => open('start')}>
          <AccountIcon size={16} />
          Join or create a workspace…
        </button>
        {removable && (
          <button
            onClick={() => {
              props.onClose();
              props.onRemove();
            }}
          >
            <TrashIcon size={16} />
            Remove “{displayName(current)}” from this device…
          </button>
        )}
      </>
    );
  }
  return (
    <>
      <hr />
      <span className="mono-label project-section">Workspaces</span>
      <div className="project-list" role="list" aria-label="Workspaces">
        {all.map((w) => (
          <button
            key={w.id}
            role="listitem"
            className="project-row workspace-row"
            aria-current={w.id === current?.id ? 'true' : undefined}
            onClick={() => {
              if (w.id === current?.id) return props.onClose();
              if (!leave()) return;
              props.onClose();
              switchWorkspace(w.id);
            }}
          >
            <span className="monogram" aria-hidden="true">
              {monogram(displayName(w))}
            </span>
            <span className="project-label">
              <strong>{displayName(w)}</strong>
              <span>{w.pending ? `${hostOf(w.url)} · sign in to finish` : hostOf(w.url)}</span>
            </span>
            {w.id === current?.id && <span className="current-mark">Open</span>}
          </button>
        ))}
      </div>
      <button onClick={() => open('join')}>
        <AccountIcon size={16} />
        Join a workspace…
      </button>
      <button onClick={() => open('create')}>
        <PlusIcon size={16} />
        Create a workspace…
      </button>
      {removable && (
        <button
          onClick={() => {
            props.onClose();
            props.onRemove();
          }}
        >
          <TrashIcon size={16} />
          Remove “{displayName(current)}” from this device…
        </button>
      )}
    </>
  );
}

/**
 * Quitar el workspace abierto del dispositivo: solo sin cambios sin subir, o después de bajarlos (el archivo
 * de siempre y, uno por uno, los originales de fotos y videos que nunca subieron: el archivo no los trae), y
 * con confirmación. Borra la base local de esta cuenta (y las de fotos y comentarios),
 * lo que la app recordaba y la sesión; las bases de otras cuentas de ese workspace en el dispositivo
 * quedan. Después la app recarga en otro workspace o en la bienvenida.
 */
export function RemoveWorkspaceDialog({ onClose }: { onClose: () => void }) {
  const services = useServices();
  const { db, mediaDb, commentsDb, docs, tree, user, client, dbName } = services;
  const { current } = useCurrentWorkspace();
  const status = useSyncStatus();
  const [summary, setSummary] = useState<UnsyncedSummary | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [media, setMedia] = useState<MediaRecord[]>([]);
  const [mediaDone, setMediaDone] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<'download' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = current ? displayName(current) : 'this workspace';

  useEffect(() => {
    let live = true;
    void (async () => {
      await docs.flush().catch(() => undefined);
      const [s, m] = await Promise.all([
        unsyncedSummary(db, mediaDb, commentsDb),
        mediaDb ? mediaDb.getAllFromIndex('files', 'pending', 1) : [],
      ]);
      if (!live) return;
      setSummary(s);
      setMedia(m);
    })().catch((err: unknown) => live && setError(errorMessage(err)));
    return () => {
      live = false;
    };
  }, [db, mediaDb, commentsDb, docs, status.pendingOps, status.pendingPages, status.pendingMedia, status.pendingComments]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && busy !== 'remove' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const pending = summary?.total ?? 0;
  const mediaLeft = media.filter((m) => !mediaDone.has(m.id)).length;
  // Con algo sin subir, recién después de bajar el archivo y cada original de foto o video.
  const canRemove = summary !== null && (pending === 0 || (downloaded && mediaLeft === 0)) && !!current && !current.legacy;

  async function downloadMedia(record: MediaRecord) {
    const blob = await mediaDb?.get('blobs', record.id);
    if (blob) {
      saveBlob(blob, record.name);
      setMediaDone((prev) => new Set(prev).add(record.id));
    } else {
      setError(`“${record.name}” is not on this device anymore.`);
    }
  }

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

  async function remove() {
    if (!current || current.legacy) return;
    const warning =
      pending > 0
        ? `The ${pending} changes that were never uploaded will only be in what you downloaded${media.length > 0 ? ' (the file and the photos and videos)' : ''}. `
        : '';
    if (!confirm(`Remove “${name}” from this device? ${warning}You can join it again later with an invitation link.`)) return;
    setBusy('remove');
    setError(null);
    const projectIds = tree.projects().map((p) => p.id);
    try {
      await services.shutdown();
      await deleteWorkspaceDatabases(dbName);
      forgetWorkspaceKeys(services.workspace.config.storage, user.id, projectIds);
      await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
      forgetWorkspaceStorage(current);
      updateWorkspaces((l) => removeWorkspace(l, current.id));
      location.replace('/');
    } catch (err) {
      setBusy(null);
      if (err instanceof DeleteBlocked) {
        setError('Close other tabs or windows of the app on this device, then reload and try again.');
      } else {
        setError(`Could not remove everything (${errorMessage(err)}). Reload the app and try again.`);
      }
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => busy !== 'remove' && onClose()}>
      <div className="modal workspaces-dialog" role="dialog" aria-label="Remove workspace" onClick={(e) => e.stopPropagation()}>
        <h2>Remove “{name}” from this device</h2>
        <p className="muted">
          This deletes what this device keeps of {name} for {user.email} and signs you out of it. Nothing
          changes on the server or for anyone else.
        </p>
        {summary === null && !error && <p className="muted">Checking this device…</p>}
        {summary !== null && pending > 0 && (
          <>
            <p>
              <strong>
                This device has {pending} {pending === 1 ? 'change' : 'changes'} that {pending === 1 ? 'was' : 'were'} never
                uploaded.
              </strong>{' '}
              Open the workspace with internet until they upload, or download them first
              {media.length > 0 ? ': the file, and each photo or video below' : ''}.
            </p>
            <button className="secondary" disabled={busy !== null} onClick={() => void download()}>
              {busy === 'download' ? 'Preparing…' : downloaded ? 'Download again' : 'Download my unsynced changes'}
            </button>
            <PendingMediaList media={media} downloaded={mediaDone} onDownload={(m) => void downloadMedia(m)} />
          </>
        )}
        {summary !== null && pending === 0 && <p className="muted">Everything on this device was already uploaded.</p>}
        {error && <p className="error">{error}</p>}
        <div className="welcome-actions">
          <button className="primary danger" disabled={!canRemove || busy !== null} onClick={() => void remove()}>
            {busy === 'remove' ? 'Removing…' : 'Remove from this device'}
          </button>
          <button className="link" disabled={busy === 'remove'} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
