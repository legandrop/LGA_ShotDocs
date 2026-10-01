import { useEffect, useRef, useState } from 'react';
import { locale, t, useT } from '../i18n';
import '../i18n/lazy/projectStates';
import { formatSize } from '../media/fileTrash';
import { importJobFor } from '../import/importJob';
import { useServices, useSyncStatus } from '../services';
import { deleteWord, deleteWordMatches, PROJECT_TRASH_DAYS, unsyncedInProject } from '../sync/projectStates';
import type { ProjectStatesRemote } from '../sync/remote';
import { errorMessage, type ProjectDeleteInfo, type TrashedProjectRow } from '../sync/types';
import { RestoreIcon } from './icons';
import { notify } from './notice';
import { projectStateError } from './project';
import { Monogram } from './ProjectSwitcher';
import { downloadUnsynced } from './unsyncedDownload';

// Borrar un proyecto y la papelera de proyectos (P.14, Docs/Doc_Proyectos_Borrar.md, secciones 6.1, 7.2 y 7.4).
// Se bajan aparte (lazyPart): no hacen falta para la primera pantalla.

/**
 * La ventana de borrar: los números del proyecto (`project_delete_info`), lo que este dispositivo tiene sin subir
 * de él y la palabra del idioma de la app. Solo con red. Al confirmar, la base lo manda a la papelera de
 * proyectos; recién con la respuesta la app sale de él (`onDeleted`).
 */
export function DeleteProjectDialog(props: {
  projectId: string;
  name: string;
  onClose: () => void;
  onDeleted: (projectId: string) => void | Promise<void>;
}) {
  const services = useServices();
  const { remote, tree, docs, files, media, comments, engine } = services;
  const status = useSyncStatus();
  const [info, setInfo] = useState<ProjectDeleteInfo | null>(null);
  const [unsynced, setUnsynced] = useState<number | null>(null);
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState<'delete' | 'download' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const tr = useT();
  const importing = importJobFor(tree).get().running;

  // Los números, una vez al abrir.
  useEffect(() => {
    let live = true;
    remote.projectDeleteInfo(props.projectId).then(
      (i) => live && setInfo(i),
      (err: unknown) => live && setError(t('deleteProject.loadFailed', { reason: errorMessage(err) })),
    );
    return () => {
      live = false;
    };
  }, [remote, props.projectId]);

  // Lo sin subir de este proyecto: primero se guarda y se sincroniza lo pendiente, después se cuenta. Se vuelve a
  // contar cuando cambia lo pendiente del dispositivo (puede terminar de subir con la ventana abierta).
  useEffect(() => {
    let live = true;
    void (async () => {
      await docs.flush().catch(() => undefined);
      const n = await unsyncedInProject({ tree, docs, files, media, comments }, props.projectId);
      if (live) setUnsynced(n);
    })().catch((err: unknown) => live && setError(errorMessage(err)));
    return () => {
      live = false;
    };
  }, [tree, docs, files, media, comments, props.projectId, status.pendingOps, status.pendingPages, status.pendingFiles, status.pendingMedia, status.pendingComments, status.failedOps]);

  useEffect(() => {
    void engine.syncNow();
  }, [engine]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && busy !== 'delete' && props.onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [props, busy]);

  const blocked = unsynced === null || unsynced > 0 || importing;
  const ready = info !== null && !blocked && status.online && deleteWordMatches(word, tr.lang) && busy === null;

  async function confirmDelete() {
    if (!ready) return;
    setBusy('delete');
    setError(null);
    try {
      await remote.deleteProject(props.projectId);
    } catch (err) {
      setBusy(null);
      setError(projectStateError(err, tr));
      return;
    }
    await props.onDeleted(props.projectId);
    notify(t('deleteProject.done', { name: props.name, days: PROJECT_TRASH_DAYS }));
  }

  async function download() {
    setBusy('download');
    setError(null);
    try {
      await downloadUnsynced(services, props.name);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const theWord = deleteWord(tr.lang);
  return (
    <div className="modal-backdrop" onClick={() => busy !== 'delete' && props.onClose()}>
      <div
        className="modal delete-project-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={tr('deleteProject.title', { name: props.name })}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{tr('deleteProject.title', { name: props.name })}</h2>
        {info && (
          <div className="delete-project-stats">
            <Monogram name={props.name} size={30} />
            <span>
              {tr('deleteProject.stats', {
                pages: tr('project.pages', { count: info.pages }),
                files: tr('deleteProject.files', { count: info.files }),
                size: formatSize(info.drive_bytes, tr.lang),
              })}
              {info.shared_with > 0 && (
                <>
                  <br />
                  {tr('deleteProject.shared', { count: info.shared_with })}
                </>
              )}
            </span>
          </div>
        )}
        {!info && !error && <p className="muted">{tr('common.loading')}</p>}
        <p>{tr('deleteProject.where', { days: PROJECT_TRASH_DAYS })}</p>
        {info && info.files > 0 && <p className="muted">{tr('deleteProject.driveStays', { size: formatSize(info.drive_bytes, tr.lang) })}</p>}
        {info && info.used_elsewhere > 0 && (
          <p className="delete-project-warning">{tr('deleteProject.usedElsewhere', { count: info.used_elsewhere })}</p>
        )}
        {info && info.foreign_only_here > 0 && (
          <p className="muted">{tr('deleteProject.foreignOnlyHere', { count: info.foreign_only_here })}</p>
        )}
        {unsynced === null && <p className="muted">{tr('deleteProject.checking')}</p>}
        {importing && <p className="delete-project-warning">{tr('import.running')}</p>}
        {unsynced !== null && unsynced > 0 && (
          <>
            <p className="delete-project-warning">{tr('deleteProject.unsynced', { count: unsynced })}</p>
            <button className="secondary" disabled={busy !== null} onClick={() => void download()}>
              {busy === 'download' ? tr('common.preparing') : tr('sync.downloadUnsynced')}
            </button>
          </>
        )}
        {!blocked && (
          <form
            className="delete-project-word"
            onSubmit={(e) => {
              e.preventDefault();
              void confirmDelete();
            }}
          >
            <label htmlFor="delete-project-word">{tr.rich('deleteProject.typeWord', { word: <strong>{theWord}</strong> })}</label>
            <input
              id="delete-project-word"
              ref={input}
              value={word}
              autoFocus
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setWord(e.target.value)}
            />
          </form>
        )}
        {!status.online && <p className="muted">{tr('fileTrash.needsInternet')}</p>}
        {error && <p className="error">{error}</p>}
        <div className="welcome-actions">
          <button className="primary danger" disabled={!ready} onClick={() => void confirmDelete()}>
            {busy === 'delete' ? tr('deleteProject.deleting') : tr('deleteProject.button')}
          </button>
          <button className="link" disabled={busy === 'delete'} onClick={props.onClose}>
            {tr('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "3 páginas · 1,1 GB · quedan 30 días"; si el plazo abre el renglón (sin números), con mayúscula. */
function rowStats(r: TrashedProjectRow, bytes: number | null, tr: ReturnType<typeof useT>): string {
  const parts: string[] = [];
  if (r.pages !== null) parts.push(tr('project.pages', { count: r.pages }));
  if (bytes !== null && bytes > 0) parts.push(formatSize(bytes, tr.lang));
  const days = r.days_left > 0 ? tr('deletedList.daysLeft', { count: r.days_left }) : tr('deletedList.passed');
  parts.push(parts.length === 0 ? days.charAt(0).toUpperCase() + days.slice(1) : days);
  return parts.join(' · ');
}

/** "hace 2 días", "hoy" (con la fecha del idioma de la app). */
function whenText(iso: string, lang: 'en' | 'es'): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  const rtf = new Intl.RelativeTimeFormat(locale(lang), { numeric: 'auto' });
  return rtf.format(-Math.max(0, days), 'day');
}

/**
 * La papelera de proyectos (`trashed_projects`): los borrados que la sesión veía. *Restore* solo en los que puede
 * restaurar. Sin red, la lista no se puede leer. La usan el selector y la pantalla "sin proyectos" (que no tiene
 * los servicios abiertos: por eso recibe el remoto).
 */
export function DeletedProjectsList(props: {
  remote: ProjectStatesRemote;
  onRestored: (row: TrashedProjectRow) => void | Promise<void>;
  /** Para mostrar el peso en Drive de cada uno (solo a quien lo puede restaurar). */
  sizeOf?: (projectId: string) => number | null;
}) {
  const [rows, setRows] = useState<TrashedProjectRow[] | null | 'missing'>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const tr = useT();

  const load = () => {
    setError(null);
    props.remote.trashedProjects().then(
      (list) => setRows(list ?? 'missing'),
      (err: unknown) => setError(t('deletedList.loadFailed', { reason: errorMessage(err) })),
    );
  };
  // Una vez al abrir la lista (y con "Retry").
  useEffect(() => load(), [props.remote]);

  async function restore(row: TrashedProjectRow) {
    setBusy(row.id);
    setError(null);
    try {
      await props.remote.restoreProject(row.id);
      notify(t('deletedList.restored', { name: row.name }));
      await props.onRestored(row);
      setRows((list) => (Array.isArray(list) ? list.filter((r) => r.id !== row.id) : list));
    } catch (err) {
      setError(projectStateError(err, t));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="deleted-projects">
      <p className="muted small">{tr('deletedList.hint')}</p>
      {rows === null && !error && <p className="muted">{tr('common.loading')}</p>}
      {rows === 'missing' && <p className="muted">{tr('deletedList.notYet')}</p>}
      {Array.isArray(rows) && rows.length === 0 && <p className="muted">{tr('deletedList.none')}</p>}
      {Array.isArray(rows) &&
        rows.map((r) => {
          const bytes = props.sizeOf?.(r.id) ?? null;
          return (
            <div key={r.id} className="deleted-project-row">
              <Monogram name={r.name} />
              <span className="project-label">
                <strong>{r.name}</strong>
                <span>
                  {r.deleted_by_email
                    ? tr('deletedList.by', { email: r.deleted_by_email, when: whenText(r.deleted_at, tr.lang) })
                    : tr('deletedList.on', { when: whenText(r.deleted_at, tr.lang) })}
                </span>
                <span>{rowStats(r, bytes, tr)}</span>
              </span>
              {r.can_restore && (
                <button className="secondary" disabled={busy !== null} onClick={() => void restore(r)}>
                  <RestoreIcon size={16} /> {busy === r.id ? tr('deletedList.restoring') : tr('deletedList.restore')}
                </button>
              )}
            </div>
          );
        })}
      {error && (
        <p className="error">
          {error}{' '}
          <button className="link" onClick={load}>
            {tr('common.retry')}
          </button>
        </p>
      )}
    </div>
  );
}
