import { useCallback, useEffect, useRef, useState } from 'react';
import {
  daysLeftText,
  emptyFileTrash,
  formatSize,
  loadFileTrash,
  sendToDriveTrash,
  TRASH_DAYS,
  unsyncedUseWarning,
  type TrashOutcome,
} from '../media/fileTrash';
import { locale, t, useT } from '../i18n';
import { navigate, pagePath } from '../router';
import { usePermissions, useServices, useSyncStatus, useTree } from '../services';
import type { TrashedFileRow } from '../sync/types';
import { errorMessage } from '../sync/types';
import { RestoreIcon, TrashIcon } from './icons';
import { notify } from './notice';
import { useCurrentProject } from './project';
import { extensionLabel, fileKind } from '../media/attachments';

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
  const hideFiles = useCallback(() => setFilesAllowed(false), []);
  const current = offerFiles ? tab : 'pages';
  const tr = useT();

  return (
    <article className="page narrow">
      <h1 className="page-heading">{tr('trash.title')}</h1>
      {offerFiles && (
        <div className="segmented trash-tabs" role="group" aria-label={tr('trash.contents')}>
          <button aria-pressed={current === 'pages'} onClick={() => setTab('pages')}>
            {tr('trash.pages')}
          </button>
          <button aria-pressed={current === 'files'} onClick={() => setTab('files')}>
            {tr('trash.files')}
          </button>
        </div>
      )}
      {current === 'pages' ? (
        <PagesTrash projectId={projectId} />
      ) : (
        <FilesTrash key={projectId} projectId={projectId} onNotAllowed={hideFiles} />
      )}
    </article>
  );
}

function PagesTrash({ projectId }: { projectId: string }) {
  const tree = useTree();
  const perms = usePermissions();
  const { media } = useServices();
  const items = tree.trashed(projectId);
  const tr = useT();
  return (
    <>
      <p className="muted">{media.trashEnabled ? tr('trash.pagesHintMedia') : tr('trash.pagesHint')}</p>
      {items.length === 0 ? (
        <p className="muted">{tr('trash.empty')}</p>
      ) : (
        <ul className="trash-list">
          {items.map((p) => (
            <li key={p.id}>
              <button className="link title" onClick={() => navigate(pagePath(p.id))}>
                {p.title || tr('common.untitled')}
              </button>
              <span className="when">{new Date(p.deleted_at!).toLocaleString(locale(tr.lang))}</span>
              {perms.canManagePage(p.id) && (
                <button onClick={() => void tree.restore(p.id)}>
                  <RestoreIcon size={16} /> {tr('trash.restore')}
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

/**
 * Lo que dice la confirmación: adónde van, cómo se recuperan y el riesgo que anota el plan. Al vaciar,
 * además cuánto pasa a la papelera de Drive (que no libera nada hasta que Google la vacía).
 */
function confirmText(question: string, many: boolean, space?: string): string {
  const where = many ? t('fileTrash.whereMany') : t('fileTrash.whereOne');
  return [question, where, space, unsyncedUseWarning()].filter(Boolean).join('\n\n');
}

function sumSizes(files: TrashedFileRow[]): number {
  return files.reduce((sum, f) => sum + (Number.isFinite(f.size) ? f.size : 0), 0);
}

/** Las fotos y los videos que ninguna página usa. Solo con red: lo que dice la base y el portero. */
function FilesTrash({ projectId, onNotAllowed }: { projectId: string; onNotAllowed: () => void }) {
  const { media, remote, sizes } = useServices();
  const perms = usePermissions();
  const status = useSyncStatus();
  const canPurge = perms.canPurgeFiles(projectId);
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const tr = useT();
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
      notify(t('fileTrash.inUse', { name: file.name }));
      return true;
    }
    // Sin Drive conectado no se mandó ni se marcó nada: se avisa, sin error en el archivo.
    if (outcome.status === 'not_connected') {
      notify(outcome.message);
      return false;
    }
    setErrors((e) => ({ ...e, [file.id]: outcome.message }));
    return false;
  };

  const sendOne = async (file: TrashedFileRow) => {
    const question = file.in_trashed_page
      ? t('fileTrash.confirmUsed', { name: file.name, page: file.trashed_page_title || t('common.untitled') })
      : t('fileTrash.confirmOne', { name: file.name });
    if (!confirm(confirmText(question, false))) return;
    setBusy(file.id);
    const outcome = await sendToDriveTrash(trash, file.id);
    if (!live.current) return;
    setBusy(null);
    if (settle(file, outcome)) await reload();
  };

  // "Empty" deja afuera los que usa una página que está en la papelera de páginas: se mandan de a uno, con su
  // propia confirmación.
  // Tampoco los que usa una página de un proyecto borrado (P.14): esos no se mandan ni de a uno.
  const emptiable = files.filter((f) => !f.in_trashed_page && !f.in_deleted_project);

  const emptyAll = async () => {
    const list = emptiable;
    if (list.length === 0) return;
    const what = list.length === 1 ? `“${list[0].name}”` : t('fileTrash.allFiles', { count: list.length });
    const kept = files.length - list.length;
    const skip = kept > 0 ? ` ${t('fileTrash.kept', { count: kept })}` : '';
    // Solo lo que se va a mandar (sin los que usa una página de la papelera).
    const space = t('fileTrash.emptySpace', { size: formatSize(sumSizes(list)) });
    if (!confirm(confirmText(t('fileTrash.confirmEmpty', { what, skip }), list.length > 1, space))) return;
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
    // El peso de los proyectos cambió: se vuelve a pedir una vez, al terminar (aunque se haya cerrado la vista).
    void sizes.refresh();
    if (!live.current) return;
    setProgress(null);
    const outcomes = [...results.values()];
    const failed = outcomes.filter((r) => r.status === 'error' || r.status === 'unsent_use').length;
    if (!outcomes.some((r) => r.status === 'not_connected') && failed > 0) {
      notify(t('fileTrash.someFailed', { failed, total: list.length }));
    }
    if (refresh) await reload();
  };

  const working = busy !== null || progress !== null;
  const offline = !status.online;

  return (
    <>
      <p className="muted">
        {tr('fileTrash.intro')}{' '}
        {status.autoPurgeFiles ? (
          tr('fileTrash.autoOn', { days: TRASH_DAYS })
        ) : (
          <>
            <strong>{tr('fileTrash.autoOffTitle')}</strong> {tr('fileTrash.autoOff', { days: TRASH_DAYS })}
          </>
        )}
      </p>
      <p className="muted trash-warning">{tr('fileTrash.unsyncedUse')}</p>
      {loaded.state === 'loading' && <p className="muted">{tr('common.loading')}</p>}
      {loaded.state === 'error' && (
        <p className="muted">
          {tr('fileTrash.loadFailed', { reason: loaded.message })}{' '}
          <button className="link" onClick={() => void reload()}>
            {tr('common.retry')}
          </button>
        </p>
      )}
      {loaded.state === 'ready' && files.length === 0 && <p className="muted">{tr('fileTrash.none')}</p>}
      {loaded.state === 'ready' && files.length > 0 && (
        <>
          <p className="muted">
            {tr('fileTrash.total', { count: files.length, size: formatSize(sumSizes(files), tr.lang) })}
          </p>
          {canPurge && (
            <div className="row trash-files-actions">
              <button
                className="link danger"
                disabled={working || offline || emptiable.length === 0}
                data-tip={offline ? tr('fileTrash.needsInternet') : tr('fileTrash.emptyTip')}
                onClick={() => void emptyAll()}
              >
                <TrashIcon size={16} /> {tr('fileTrash.emptyButton')}
              </button>
              {progress && (
                <span className="muted" role="status">
                  {tr('fileTrash.sendingOf', { n: Math.min(progress.done + 1, progress.total), total: progress.total })}
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
                    {formatSize(f.size)} · {new Date(f.trashed_at).toLocaleDateString(locale(tr.lang))} · {daysLeftText(f.days_left)}
                  </span>
                  {f.in_deleted_project ? (
                    <span className="muted small">{tr('fileTrash.inDeletedProject')}</span>
                  ) : (
                    f.in_trashed_page && (
                      <span className="muted small">{tr('fileTrash.usedBy', { page: f.trashed_page_title || tr('common.untitled') })}</span>
                    )
                  )}
                  {f.purged_at && !errors[f.id] && <span className="muted small">{tr('fileTrash.notConfirmed')}</span>}
                  {errors[f.id] && <span className="trash-error small">{errors[f.id]}</span>}
                </div>
                {/* Un archivo que usa una página de un proyecto borrado no se manda: vuelve si lo restauran (P.14). */}
                {canPurge && !f.in_deleted_project && (
                  <button
                    disabled={working || offline}
                    data-tip={offline ? tr('fileTrash.needsInternet') : tr('fileTrash.sendTip')}
                    onClick={() => void sendOne(f)}
                  >
                    {busy === f.id ? tr('fileTrash.sending') : tr('fileTrash.send')}
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

/**
 * La miniatura del archivo (la del dispositivo o la del bucket `thumbs`); un adjunto sin miniatura, la etiqueta
 * de su tipo (PDF, ZIP…); si no, un recuadro vacío.
 */
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
  if (src) return <img className="trash-thumb" src={src} alt={name} />;
  if (fileKind(null, name) === 'file') return <span className="trash-thumb trash-thumb-file" aria-hidden="true">{extensionLabel(name, null)}</span>;
  return <span className="trash-thumb" aria-hidden="true" />;
}
