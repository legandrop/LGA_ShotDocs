import { useEffect, useRef, useState, type RefObject } from 'react';
import { locale, t, useT } from '../i18n';
import '../i18n/lazy/projectStates';
import { formatSize } from '../media/fileTrash';
import { driveFolderLabel, projectDriveError, type ProjectDrive } from '../media/projectDrive';
import { importJobFor } from '../import/importJob';
import { usePermissions, useServices, useSyncStatus } from '../services';
import { deleteWord, deleteWordMatches, PROJECT_TRASH_DAYS, unsyncedInProject } from '../sync/projectStates';
import type { ProjectStatesRemote } from '../sync/remote';
import { errorMessage, type ProjectDeleteInfo, type TrashedProjectRow } from '../sync/types';
import { RestoreIcon } from './icons';
import { notify } from './notice';
import { projectStateError, useProjectDrive } from './project';
import { Monogram } from './ProjectSwitcher';
import { downloadUnsynced } from './unsyncedDownload';

// Borrar un proyecto y la papelera de proyectos (P.14, Docs/Doc_Proyectos_Borrar.md, secciones 3, 6.1, 7.2 y 7.4).
// Se bajan aparte (lazyPart): no hacen falta para la primera pantalla.

/** Google guarda 30 días lo que está en la papelera de Drive. */
const DRIVE_TRASH_DAYS = 30;

/** Cómo está la casilla de Drive de la ventana de borrar: lista, o apagada con el motivo. */
type DriveOption = { state: 'ready' } | { state: 'off'; reason: string } | { state: 'checking' };

/**
 * La ventana de borrar: los números del proyecto (`project_delete_info`), lo que este dispositivo tiene sin subir
 * de él y la palabra del idioma de la app. Solo con red. Al confirmar, la base lo manda a la papelera de
 * proyectos; recién con la respuesta la app sale de él (`onDeleted`). Con la casilla (entrega 2, destildada al
 * abrir), después el portero manda su carpeta entera a la papelera de Drive; si eso falla, el proyecto queda borrado
 * con sus archivos en Drive y se termina desde la papelera (*Trash*, en el selector de proyectos).
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
  const perms = usePermissions();
  const drive = useProjectDrive();
  const [info, setInfo] = useState<ProjectDeleteInfo | null>(null);
  const [unsynced, setUnsynced] = useState<number | null>(null);
  const [word, setWord] = useState('');
  const [alsoDrive, setAlsoDrive] = useState(false);
  const [driveOption, setDriveOption] = useState<DriveOption>({ state: 'checking' });
  const [busy, setBusy] = useState<'delete' | 'drive' | 'download' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const tr = useT();
  const importing = importJobFor(tree).get().running;
  const staff = perms.role === 'owner' || perms.role === 'admin';
  // Restaurado antes sin su carpeta: volver a mandarla cierra esa marca archivo por archivo (sección 3.4).
  const missingBefore = !!tree.project(props.projectId)?.drive_missing_at;

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

  // La casilla de Drive: solo dueño y admins, con Drive conectado (se pregunta al portero una vez).
  useEffect(() => {
    if (!drive) return;
    if (!staff) {
      setDriveOption({ state: 'off', reason: t('deleteProject.driveOnlyStaff') });
      return;
    }
    let live = true;
    setDriveOption({ state: 'checking' });
    drive.status().then(
      (s) => live && setDriveOption(s.connected ? { state: 'ready' } : { state: 'off', reason: t('projectDrive.notConnected') }),
      (err: unknown) => live && setDriveOption({ state: 'off', reason: projectDriveError(err) }),
    );
    return () => {
      live = false;
    };
  }, [drive, staff]);

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
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && busy === null && props.onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [props, busy]);

  const blocked = unsynced === null || unsynced > 0 || importing;
  const sendDrive = alsoDrive && driveOption.state === 'ready' && !!drive;
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
    // Recién con el proyecto borrado, su carpeta (la base lo exige: `project_not_deleted`).
    let driveNote = '';
    if (sendDrive) {
      setBusy('drive');
      try {
        const r = await drive.trash(props.projectId);
        if (r.drive === 'trashed') driveNote = t('deleteProject.driveSent');
        else if (r.drive === 'missing') driveNote = t('deleteProject.driveWasMissing');
      } catch (err) {
        driveNote = t('deleteProject.driveFailed', { reason: projectDriveError(err) });
      }
    }
    await props.onDeleted(props.projectId);
    notify([t('deleteProject.done', { name: props.name, days: PROJECT_TRASH_DAYS }), driveNote].filter(Boolean).join(' '));
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
  const size = info ? formatSize(info.drive_bytes, tr.lang) : '';
  return (
    <div className="modal-backdrop" onClick={() => busy === null && props.onClose()}>
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
                size,
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
        {info && info.files > 0 && !drive && <p className="muted">{tr('deleteProject.driveStays', { size })}</p>}
        {info && info.files > 0 && drive && (
          <div className="delete-project-drive">
            <label className="delete-project-check">
              <input
                type="checkbox"
                checked={sendDrive}
                disabled={driveOption.state !== 'ready' || busy !== null}
                onChange={(e) => setAlsoDrive(e.target.checked)}
              />
              <span>{tr('deleteProject.driveOption', { size })}</span>
            </label>
            <p className="muted small">
              {driveOption.state === 'off'
                ? driveOption.reason
                : driveOption.state === 'checking'
                  ? tr('deleteProject.driveChecking')
                  : sendDrive
                    ? tr('deleteProject.driveHint', { folder: driveFolderLabel(props.name) })
                    : tr('deleteProject.driveStays', { size })}
            </p>
            {sendDrive && missingBefore && <p className="delete-project-warning">{tr('deleteProject.driveMissingBefore')}</p>}
          </div>
        )}
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
            {busy === 'delete' ? tr('deleteProject.deleting') : busy === 'drive' ? tr('deleteProject.sendingDrive') : tr('deleteProject.button')}
          </button>
          <button className="link" disabled={busy === 'delete' || busy === 'drive'} onClick={props.onClose}>
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

/** "31 oct." / "Oct 31". */
function dateText(ms: number, lang: 'en' | 'es'): string {
  return new Intl.DateTimeFormat(locale(lang), { month: 'short', day: 'numeric' }).format(new Date(ms));
}

/** La carpeta de un borrado está pedida o en la papelera de Drive (y no se restauró antes sin ella). */
function folderSent(r: TrashedProjectRow): boolean {
  return !!r.drive_trash_requested_at && !r.drive_missing_at;
}

/** Qué dice el renglón sobre su carpeta de Drive, si algo. */
function driveLine(r: TrashedProjectRow, tr: ReturnType<typeof useT>): string | null {
  if (!folderSent(r)) return null;
  if (!r.drive_trashed_at) return tr('deletedList.driveUnfinished');
  const until = Date.parse(r.drive_trashed_at) + DRIVE_TRASH_DAYS * 86_400_000;
  return until > Date.now()
    ? tr('deletedList.driveTrashed', { date: dateText(until, tr.lang) })
    : tr('deletedList.driveTrashedPast', { date: dateText(Date.parse(r.drive_trashed_at), tr.lang) });
}

/** Cómo está la lista de borrados: cargando (`null`), sin la función en la base (`missing`) o las filas. */
export type DeletedRows = TrashedProjectRow[] | null | 'missing';

/** Las preguntas del renglón de un borrado. */
export type DeletedAsk = { id: string; kind: 'missing' | 'send' | 'purge' };

/** *Delete forever* (entrega 3): pasados los 30 días, a dueños y admins que lo manejan (`can_purge`), con la base en la 23. */
export function canOfferPurge(r: TrashedProjectRow, purgeReady: boolean): boolean {
  return purgeReady && r.can_purge && r.days_left === 0;
}

/** Lo que pasó al borrar para siempre, en palabras de la persona. */
function purgeError(err: unknown): string {
  const code = errorMessage(err);
  if (code === 'project_trash_not_due') return t('purgeProject.notDue');
  if (code === 'project_not_deleted') return t('purgeProject.notDeleted');
  if (code === 'drive_trash_first') return t('purgeProject.driveFirst');
  return projectStateError(err, t);
}

/** Lo que comparten los renglones de los borrados: el trabajo en curso, la pregunta abierta y las acciones. */
export interface DeletedProjects {
  rows: DeletedRows;
  error: string | null;
  busy: string | null;
  /**
   * Una pregunta en el renglón: restaurar sin los archivos, mandar la carpeta a la papelera de Drive o borrarlo para
   * siempre (con la palabra).
   */
  ask: DeletedAsk | null;
  setAsk: (ask: DeletedAsk | null) => void;
  askRef: RefObject<HTMLDivElement | null>;
  /** El error de la pregunta abierta (borrar para siempre): se muestra en el renglón, no al pie de la lista. */
  askError: string | null;
  load: () => void;
  restore: (row: TrashedProjectRow, withoutDrive?: boolean) => Promise<void>;
  send: (row: TrashedProjectRow) => Promise<void>;
  purge: (row: TrashedProjectRow) => Promise<void>;
  /** Mandando la carpeta antes de borrar para siempre, o borrando (para el texto del botón). */
  purgeStep: 'drive' | 'purge' | null;
  drive: ProjectDrive | null;
  /** Con la base en la versión 23 y con red: se ofrece *Delete forever*. */
  purgeReady: boolean;
}

/**
 * La papelera de proyectos (`trashed_projects`): los borrados que la sesión veía (la base decide cuáles; acá no se
 * filtra nada). *Restore* solo en los que puede restaurar. Sin red, la lista no se puede leer. Con `enabled: false`
 * no pide nada (sin red o con una base sin la versión 9).
 *
 * Entrega 2: restaurar uno con la carpeta en la papelera de Drive primero la trae (`/project/untrash`). Si Drive,
 * conectado a la misma cuenta, ya no la tiene, pregunta antes de restaurar sin los archivos (una marca reversible).
 * A los dueños y admins que lo manejan, *Send files to the Drive trash* manda la carpeta de uno borrado sin ella (o
 * termina un envío que quedó a medias).
 */
export function useDeletedProjects(props: {
  remote: ProjectStatesRemote;
  onRestored: (row: TrashedProjectRow) => void | Promise<void>;
  drive?: ProjectDrive | null;
  enabled?: boolean;
  /** *Delete forever* (entrega 3): con la base en la versión 23 y con red. Sin esto no se ofrece. */
  purgeReady?: boolean;
  /** Después de borrar uno para siempre (el peso de los proyectos cambió). */
  onPurged?: (row: TrashedProjectRow) => void | Promise<void>;
}): DeletedProjects {
  const enabled = props.enabled ?? true;
  const [rows, setRows] = useState<DeletedRows>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAskState] = useState<DeletedAsk | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [purgeStep, setPurgeStep] = useState<'drive' | 'purge' | null>(null);
  const setAsk = (next: DeletedAsk | null) => {
    setAskError(null);
    setAskState(next);
  };
  const askRef = useRef<HTMLDivElement>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  // La pregunta del renglón puede quedar abajo del borde del selector: se la trae a la vista, con el foco en su botón
  // (o en el campo de la palabra, al borrar para siempre).
  useEffect(() => {
    if (!ask) return;
    askRef.current?.scrollIntoView?.({ block: 'nearest' });
    askRef.current?.querySelector<HTMLElement>('input, button')?.focus();
  }, [ask]);

  const load = () => {
    if (!enabled) return;
    setError(null);
    props.remote.trashedProjects().then(
      (list) => live.current && setRows(list ?? 'missing'),
      (err: unknown) => live.current && setError(t('deletedList.loadFailed', { reason: errorMessage(err) })),
    );
  };
  // Una vez al abrir la lista (y con "Retry", o cuando vuelve la red).
  useEffect(() => load(), [props.remote, enabled]);

  async function restore(row: TrashedProjectRow, withoutDrive = false) {
    setBusy(row.id);
    setError(null);
    setAsk(null);
    try {
      // Primero la carpeta (la base lo exige: `drive_untrash_first`).
      if (folderSent(row) && !withoutDrive) {
        if (!props.drive) throw new Error(t('projectDrive.noPortero'));
        let answer;
        try {
          answer = await props.drive.untrash(row.id);
        } catch (err) {
          setError(projectDriveError(err));
          return;
        }
        if (answer.drive === 'missing') {
          setAsk({ id: row.id, kind: 'missing' });
          return;
        }
      }
      await props.remote.restoreProject(row.id, withoutDrive);
      notify(t(withoutDrive ? 'deletedList.restoredWithoutFiles' : 'deletedList.restored', { name: row.name }));
      await props.onRestored(row);
      setRows((list) => (Array.isArray(list) ? list.filter((r) => r.id !== row.id) : list));
    } catch (err) {
      setError(projectStateError(err, t));
    } finally {
      setBusy(null);
    }
  }

  async function send(row: TrashedProjectRow) {
    if (!props.drive) return;
    setBusy(row.id);
    setError(null);
    setAsk(null);
    try {
      const r = await props.drive.trash(row.id);
      notify(t(r.drive === 'trashed' ? 'deletedList.sent' : 'deleteProject.driveWasMissing', { name: row.name }));
    } catch (err) {
      setError(projectDriveError(err));
    } finally {
      setBusy(null);
      // El estado nuevo (pedido, confirmado) sale de la base.
      load();
    }
  }

  /**
   * *Delete forever* (entrega 3): la base decide (plazo, permisos, la carpeta). Si contesta que la carpeta tiene que ir
   * antes a la papelera de Drive (`drive_trash_first`), el portero la manda y se vuelve a pedir; si eso falla, no se
   * marca nada. Ninguna fila se borra ni nada sale del dispositivo: el proyecto deja la papelera y no se restaura más.
   */
  async function purge(row: TrashedProjectRow) {
    setBusy(row.id);
    setAskError(null);
    setPurgeStep('purge');
    try {
      try {
        await props.remote.purgeProject(row.id);
      } catch (err) {
        if (errorMessage(err) !== 'drive_trash_first') throw err;
        if (!props.drive) {
          setAskError(t('purgeProject.driveFailed', { reason: t('projectDrive.noPortero') }));
          return;
        }
        setPurgeStep('drive');
        try {
          await props.drive.trash(row.id);
        } catch (driveErr) {
          setAskError(t('purgeProject.driveFailed', { reason: projectDriveError(driveErr) }));
          return;
        }
        setPurgeStep('purge');
        await props.remote.purgeProject(row.id);
      }
      setAsk(null);
      setRows((list) => (Array.isArray(list) ? list.filter((r) => r.id !== row.id) : list));
      notify(t('purgeProject.done', { name: row.name }));
      await props.onPurged?.(row);
    } catch (err) {
      if (live.current) setAskError(purgeError(err));
    } finally {
      if (live.current) {
        setBusy(null);
        setPurgeStep(null);
      }
    }
  }

  return {
    rows,
    error,
    busy,
    ask,
    setAsk,
    askRef,
    askError,
    load,
    restore,
    send,
    purge,
    purgeStep,
    drive: props.drive ?? null,
    purgeReady: !!props.purgeReady && enabled,
  };
}

/**
 * Un borrado: nombre, quién y cuándo, sus números, la carpeta de Drive, *Restore* y las preguntas del renglón. `kind`
 * es la línea de arriba en la papelera única ("Project"); la pantalla "sin proyectos" no la lleva.
 */
export function DeletedProjectItem(props: { row: TrashedProjectRow; list: DeletedProjects; bytes: number | null; kind?: string }) {
  const { row: r, list, bytes } = props;
  const tr = useT();
  const line = driveLine(r, tr);
  // Con la carpeta en la papelera de Drive, restaurar la trae: solo dueño y admins (la base lo exige).
  const needsStaff = r.can_restore && folderSent(r) && !r.can_purge;
  // Mandar la carpeta (o terminar un envío a medias): dueño y admins que lo manejan, con portero.
  const canSend = r.can_purge && !!list.drive && (!r.drive_trash_requested_at || !!r.drive_missing_at || !r.drive_trashed_at);
  const unfinished = folderSent(r) && !r.drive_trashed_at;
  const asking = list.ask?.id === r.id ? list.ask.kind : null;
  const busy = list.busy;
  const offerPurge = canOfferPurge(r, list.purgeReady);
  return (
    <div className="deleted-project-item" data-kind="project">
      <div className="deleted-project-row">
        <Monogram name={r.name} />
        <span className="project-label">
          {props.kind && <span className="trash-kind">{props.kind}</span>}
          <strong>{r.name}</strong>
          <span>
            {r.deleted_by_email
              ? tr('deletedList.by', { email: r.deleted_by_email, when: whenText(r.deleted_at, tr.lang) })
              : tr('deletedList.on', { when: whenText(r.deleted_at, tr.lang) })}
          </span>
          <span>{rowStats(r, bytes, tr)}</span>
          {line && <span>{line}</span>}
        </span>
        {r.can_restore && (
          <button className="secondary" disabled={busy !== null || needsStaff} onClick={() => void list.restore(r)}>
            <RestoreIcon size={16} /> {busy === r.id && !asking ? tr('deletedList.restoring') : tr('deletedList.restore')}
          </button>
        )}
      </div>
      {needsStaff && <p className="muted small deleted-project-note">{tr('deletedList.needsStaff')}</p>}
      {(canSend || offerPurge) && !asking && (
        <div className="deleted-project-actions">
          {canSend && (
            <button
              className="link"
              disabled={busy !== null}
              onClick={() => (unfinished ? void list.send(r) : list.setAsk({ id: r.id, kind: 'send' }))}
            >
              {bytes !== null && bytes > 0
                ? tr('deletedList.sendToDriveSize', { size: formatSize(bytes, tr.lang) })
                : tr('deletedList.sendToDrive')}
            </button>
          )}
          {offerPurge && (
            <button className="link danger" disabled={busy !== null} onClick={() => list.setAsk({ id: r.id, kind: 'purge' })}>
              {tr('purgeProject.open')}
            </button>
          )}
        </div>
      )}
      {asking === 'purge' && <PurgeAsk row={r} list={list} />}
      {asking === 'send' && (
        <div ref={list.askRef} className="deleted-project-ask" role="group" aria-label={tr('deletedList.sendToDrive')}>
          <p className="small">{tr('deletedList.sendConfirm', { folder: driveFolderLabel(r.name) })}</p>
          {r.drive_missing_at && <p className="small delete-project-warning">{tr('deleteProject.driveMissingBefore')}</p>}
          <div className="deleted-project-actions">
            <button className="primary danger" disabled={busy !== null} onClick={() => void list.send(r)}>
              {busy === r.id ? tr('deletedList.sending') : tr('deletedList.send')}
            </button>
            <button className="link" disabled={busy !== null} onClick={() => list.setAsk(null)}>
              {tr('common.cancel')}
            </button>
          </div>
        </div>
      )}
      {asking === 'missing' && (
        <div ref={list.askRef} className="deleted-project-ask" role="group" aria-label={tr('deletedList.restoreWithoutFiles')}>
          <p className="small">{tr('deletedList.missingQuestion')}</p>
          <div className="deleted-project-actions">
            <button className="primary" disabled={busy !== null} onClick={() => void list.restore(r, true)}>
              {busy === r.id ? tr('deletedList.restoring') : tr('deletedList.restoreWithoutFiles')}
            </button>
            <button className="link" disabled={busy !== null} onClick={() => list.setAsk(null)}>
              {tr('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * La pregunta de *Delete forever* en el renglón: qué pasa, la palabra del idioma de la app (como en la ventana de
 * borrar, sin mayúscula ni corrector en el iPhone) y el botón, que se habilita recién con ella. Enter confirma; Escape
 * vuelve al renglón sin cerrar la papelera.
 */
function PurgeAsk({ row: r, list }: { row: TrashedProjectRow; list: DeletedProjects }) {
  const tr = useT();
  const [word, setWord] = useState('');
  const working = list.busy === r.id;
  const ready = deleteWordMatches(word, tr.lang) && list.busy === null;
  const confirm = () => {
    if (ready) void list.purge(r);
  };
  return (
    <div ref={list.askRef} className="deleted-project-ask" role="group" aria-label={tr('purgeProject.button')}>
      <p className="small">{tr('purgeProject.confirm', { name: r.name })}</p>
      <form
        className="delete-project-word"
        onSubmit={(e) => {
          e.preventDefault();
          confirm();
        }}
      >
        <label htmlFor={`purge-word-${r.id}`} className="small">
          {tr.rich('deleteProject.typeWord', { word: <strong>{deleteWord(tr.lang)}</strong> })}
        </label>
        <input
          id={`purge-word-${r.id}`}
          value={word}
          disabled={working}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setWord(e.target.value)}
          onKeyDown={(e) => {
            // Escape cierra solo la pregunta: ni vuelve a la lista de proyectos ni cierra el selector.
            if (e.key !== 'Escape' || working) return;
            e.preventDefault();
            e.stopPropagation();
            list.setAsk(null);
          }}
        />
      </form>
      {list.askError && <p className="error small">{list.askError}</p>}
      <div className="deleted-project-actions">
        <button className="primary danger" disabled={!ready} onClick={confirm}>
          {working
            ? list.purgeStep === 'drive'
              ? tr('purgeProject.sendingDrive')
              : tr('purgeProject.purging')
            : tr('purgeProject.button')}
        </button>
        <button className="link" disabled={working} onClick={() => list.setAsk(null)}>
          {tr('common.cancel')}
        </button>
      </div>
    </div>
  );
}

/** El error de la lista de borrados, con *Retry*. */
export function DeletedProjectsError({ list }: { list: DeletedProjects }) {
  const tr = useT();
  if (!list.error) return null;
  return (
    <p className="error">
      {list.error}{' '}
      <button className="link" onClick={list.load}>
        {tr('common.retry')}
      </button>
    </p>
  );
}

/**
 * Los proyectos borrados solos: la pantalla "sin proyectos", que no tiene los servicios abiertos (por eso recibe el
 * remoto y, para la carpeta de Drive, el cliente del portero). Adentro de la app están en la papelera única
 * (`TrashPanel`, TrashView.tsx), junto con las páginas y los archivos.
 */
export function DeletedProjectsList(props: {
  remote: ProjectStatesRemote;
  onRestored: (row: TrashedProjectRow) => void | Promise<void>;
  /** Para mostrar el peso en Drive de cada uno (solo a quien lo puede restaurar). */
  sizeOf?: (projectId: string) => number | null;
  /** El portero, para la carpeta de Drive (entrega 2). Sin él, *Restore* de uno con la carpeta enviada lo dice. */
  drive?: ProjectDrive | null;
}) {
  const list = useDeletedProjects(props);
  const tr = useT();
  const rows = list.rows;
  return (
    <div className="deleted-projects">
      <p className="muted small">{tr('deletedList.hint')}</p>
      {rows === null && !list.error && <p className="muted">{tr('common.loading')}</p>}
      {rows === 'missing' && <p className="muted">{tr('deletedList.notYet')}</p>}
      {Array.isArray(rows) && rows.length === 0 && <p className="muted">{tr('deletedList.none')}</p>}
      {Array.isArray(rows) &&
        rows.map((r) => <DeletedProjectItem key={r.id} row={r} list={list} bytes={props.sizeOf?.(r.id) ?? null} />)}
      <DeletedProjectsError list={list} />
    </div>
  );
}

/**
 * *Look for its files again* (entrega 2): en un proyecto restaurado sin su carpeta de Drive (`drive_missing_at`), el
 * portero la busca y, si aparece (alguien la recuperó de la papelera de Drive, o Drive volvió a la cuenta de antes),
 * la trae y la base borra la marca: todo vuelve a como estaba. Solo dueño y admins que lo manejan.
 */
export function LookForFilesButton(props: { projectId: string }) {
  const drive = useProjectDrive();
  const { engine } = useServices();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tr = useT();
  if (!drive) return null;

  async function look() {
    if (!drive) return;
    setBusy(true);
    setError(null);
    try {
      const r = await drive.untrash(props.projectId);
      if (r.drive === 'missing') setError(t('project.filesStillMissing'));
      else {
        notify(t('project.filesBack'));
        // La marca sale de la base: la próxima lista de proyectos ya no la trae.
        await engine.syncNow();
      }
    } catch (err) {
      setError(projectDriveError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="secondary" disabled={busy} onClick={() => void look()}>
        {busy ? tr('project.lookingForFiles') : tr('project.lookForFiles')}
      </button>
      {error && <p className="error">{error}</p>}
    </>
  );
}
