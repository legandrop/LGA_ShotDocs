import { useCallback, useEffect, useRef, useState } from 'react';
import {
  daysLeftText,
  emptyFileTrash,
  formatSize,
  loadFileTrash,
  sendToDriveTrash,
  TRASH_DAYS,
  UNSYNCED_USE_WARNING,
  type TrashOutcome,
} from '../media/fileTrash';
import { navigate, pagePath } from '../router';
import { usePermissions, useServices, useSyncStatus, useTree } from '../services';
import type { TrashedFileRow } from '../sync/types';
import { errorMessage } from '../sync/types';
import { RestoreIcon, TrashIcon } from './icons';
import { notify } from './notice';
import { useCurrentProject } from './project';

// La papelera del proyecto: las páginas y, desde el paso 11 (Docs/Plan_Workspaces.md), la pestaña Archivos
// con las fotos y los videos que ninguna página usa. La pestaña se muestra solo si la base deja verla
// (`trashed_files` no da `not_allowed`); mandar a la papelera de Drive, solo el dueño y los admins.

type Tab = 'pages' | 'files';

export function TrashView() {
  const projectId = useCurrentProject();
  const perms = usePermissions();
  const { media } = useServices();
  const [tab, setTab] = useState<Tab>('pages');
  // La pestaña Archivos se ofrece si la base tiene la papelera de archivos y los permisos del dispositivo no
  // la descartan; la base decide de verdad al pedirla (`FilesTrash` avisa si no la deja ver).
  const [filesAllowed, setFilesAllowed] = useState(true);
  const offerFiles = media.trashEnabled && perms.canSeeFileTrash(projectId) && filesAllowed;
  useEffect(() => setFilesAllowed(true), [projectId]);
  const current = offerFiles ? tab : 'pages';

  return (
    <article className="page narrow">
      <h1 className="page-heading">Trash</h1>
      {offerFiles && (
        <div className="segmented trash-tabs" role="group" aria-label="Trash contents">
          <button aria-pressed={current === 'pages'} onClick={() => setTab('pages')}>
            Pages
          </button>
          <button aria-pressed={current === 'files'} onClick={() => setTab('files')}>
            Files
          </button>
        </div>
      )}
      {current === 'pages' ? (
        <PagesTrash projectId={projectId} />
      ) : (
        <FilesTrash key={projectId} projectId={projectId} onNotAllowed={() => setFilesAllowed(false)} />
      )}
    </article>
  );
}

function PagesTrash({ projectId }: { projectId: string }) {
  const tree = useTree();
  const perms = usePermissions();
  const items = tree.trashed(projectId);
  return (
    <>
      <p className="muted">
        Nothing here is ever deleted from the app. Restoring a page brings it back with everything that was inside
        it.
      </p>
      {items.length === 0 ? (
        <p className="muted">The trash is empty.</p>
      ) : (
        <ul className="trash-list">
          {items.map((p) => (
            <li key={p.id}>
              <button className="link title" onClick={() => navigate(pagePath(p.id))}>
                {p.title || 'Untitled'}
              </button>
              <span className="when">{new Date(p.deleted_at!).toLocaleString()}</span>
              {perms.canManagePage(p.id) && (
                <button onClick={() => void tree.restore(p.id)}>
                  <RestoreIcon size={16} /> Restore
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

type Loaded = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; files: TrashedFileRow[] };

const confirmTail = `They go to the Google Drive trash of the workspace owner and can be recovered from there for 30 days. Pages that still show one of them will say it was deleted.\n\n${UNSYNCED_USE_WARNING}`;

/** Las fotos y los videos que ninguna página usa. Solo con red: lo que dice la base y el portero. */
function FilesTrash({ projectId, onNotAllowed }: { projectId: string; onNotAllowed: () => void }) {
  const { media, remote } = useServices();
  const perms = usePermissions();
  const status = useSyncStatus();
  const canPurge = perms.canPurgeFiles(projectId);
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );

  const reload = useCallback(async () => {
    try {
      const files = await loadFileTrash(remote, projectId);
      if (!live.current) return;
      if (files === null) onNotAllowed();
      else setLoaded({ state: 'ready', files });
    } catch (err) {
      if (live.current) setLoaded({ state: 'error', message: errorMessage(err) });
    }
  }, [remote, projectId, onNotAllowed]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const trash = (id: string) => media.trash(id);
  const files = loaded.state === 'ready' ? loaded.files : [];

  /** Lo que pasó con uno: sale de la lista, se vuelve a leer la lista (409) o queda con su error. */
  const settle = (file: TrashedFileRow, outcome: TrashOutcome): boolean => {
    if (outcome.status === 'done') {
      setLoaded((l) => (l.state === 'ready' ? { ...l, files: l.files.filter((f) => f.id !== file.id) } : l));
      setErrors((e) => {
        const next = { ...e };
        delete next[file.id];
        return next;
      });
      return false;
    }
    if (outcome.status === 'in_use') {
      notify(`A page uses “${file.name}” again, so it is not in the trash anymore.`);
      return true;
    }
    setErrors((e) => ({ ...e, [file.id]: outcome.message }));
    return false;
  };

  const sendOne = async (file: TrashedFileRow) => {
    if (!confirm(`Send “${file.name}” to the Google Drive trash?\n\n${confirmTail}`)) return;
    setBusy(file.id);
    const outcome = await sendToDriveTrash(trash, file.id);
    if (!live.current) return;
    setBusy(null);
    if (settle(file, outcome)) await reload();
  };

  const emptyAll = async () => {
    const list = files;
    if (list.length === 0) return;
    const what = list.length === 1 ? `“${list[0].name}”` : `all ${list.length} files`;
    if (!confirm(`Empty the file trash: send ${what} to the Google Drive trash?\n\n${confirmTail}`)) return;
    setProgress({ done: 0, total: list.length });
    let refresh = false;
    const byId = new Map(list.map((f) => [f.id, f]));
    const stop = { cancelled: false };
    const results = await emptyFileTrash(
      trash,
      list.map((f) => f.id),
      (done, total, id, outcome) => {
        if (!live.current) {
          stop.cancelled = true;
          return;
        }
        setProgress({ done, total });
        if (settle(byId.get(id)!, outcome)) refresh = true;
      },
      stop,
    );
    if (!live.current) return;
    setProgress(null);
    const failed = [...results.values()].filter((r) => r.status === 'error').length;
    if (failed > 0) notify(`${failed} of ${list.length} could not be sent. They stay in the list with the reason.`);
    if (refresh) await reload();
  };

  const working = busy !== null || progress !== null;
  const offline = !status.online;

  return (
    <>
      <p className="muted">
        Photos and videos that no page uses anymore. Each one is sent to the Google Drive trash {TRASH_DAYS} days
        after it got here.{' '}
        {!status.autoPurgeFiles && <strong>Auto-delete is off:</strong>}
        {!status.autoPurgeFiles && ' nothing is sent on its own; the days are only a reference.'}
      </p>
      <p className="muted trash-warning">{UNSYNCED_USE_WARNING}</p>
      {loaded.state === 'loading' && <p className="muted">Loading…</p>}
      {loaded.state === 'error' && (
        <p className="muted">
          The file trash could not be read ({loaded.message}). It needs an internet connection.{' '}
          <button className="link" onClick={() => void reload()}>
            Retry
          </button>
        </p>
      )}
      {loaded.state === 'ready' && files.length === 0 && <p className="muted">No files in the trash.</p>}
      {loaded.state === 'ready' && files.length > 0 && (
        <>
          {canPurge && (
            <div className="row trash-files-actions">
              <button
                className="link danger"
                disabled={working || offline}
                data-tip={offline ? 'Needs an internet connection' : 'Send every file in this list to the Google Drive trash'}
                onClick={() => void emptyAll()}
              >
                <TrashIcon size={16} /> Empty
              </button>
              {progress && (
                <span className="muted" role="status">
                  Sending {Math.min(progress.done + 1, progress.total)} of {progress.total}…
                </span>
              )}
            </div>
          )}
          <ul className="trash-list trash-files">
            {files.map((f) => (
              <li key={f.id}>
                <FileThumb id={f.id} name={f.name} />
                <div className="trash-file">
                  <span className="title">{f.name}</span>
                  <span className="when">
                    {formatSize(f.size)} · {new Date(f.trashed_at).toLocaleDateString()} · {daysLeftText(f.days_left)}
                  </span>
                  {f.purged_at && !errors[f.id] && (
                    <span className="muted small">Sending it to the Google Drive trash was not confirmed yet. Try again.</span>
                  )}
                  {errors[f.id] && <span className="trash-error small">{errors[f.id]}</span>}
                </div>
                {canPurge && (
                  <button
                    disabled={working || offline}
                    data-tip={offline ? 'Needs an internet connection' : 'Send to the Google Drive trash (recoverable there for 30 days)'}
                    onClick={() => void sendOne(f)}
                  >
                    {busy === f.id ? 'Sending…' : 'Send to Drive trash'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/** La miniatura del archivo (la del dispositivo o la del bucket `thumbs`), o un recuadro vacío. */
function FileThumb({ id, name }: { id: string; name: string }) {
  const { media } = useServices();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void media.thumbnail(id).then(
      (url) => alive && setSrc(url),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [media, id]);
  return src ? <img className="trash-thumb" src={src} alt={name} /> : <span className="trash-thumb" aria-hidden="true" />;
}
