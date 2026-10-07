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
import { locale, localize, t, useT } from '../i18n';
import '../i18n/lazy/projectStates';
import { navigate, pagePath } from '../router';
import { usePermissions, useProjectSizes, useServices, useSyncStatus, useTree } from '../services';
import { PROJECT_PURGE_SCHEMA_VERSION, PROJECT_STATES_SCHEMA_VERSION } from '../sync/remote';
import type { PageRow, TrashedFileRow, TrashedProjectRow } from '../sync/types';
import { errorMessage } from '../sync/types';
import { PageIcon, RestoreIcon, TrashIcon } from './icons';
import { notify } from './notice';
import { useProjectDrive } from './project';
import { DeletedProjectItem, DeletedProjectsError, useDeletedProjects } from './ProjectStatesPart';
import { extensionLabel, fileKind } from '../media/attachments';

// La papelera única (pedido de Lega, 2026-10-03; Docs/Doc_Proyectos_Borrar.md, "Cómo quedó: una sola papelera"): las
// páginas, los archivos (fotos y videos que ninguna página usa, paso 11 de Docs/Plan_Workspaces.md) y los proyectos
// borrados (P.14), en una sola lista del más nuevo al más viejo, dentro del selector de proyectos. Arriba, el filtro
// *All / Projects / Pages / Files* y de qué proyectos (el abierto, o todos). Cada tipo hace lo mismo que antes:
// - Páginas: de la copia del dispositivo (anda sin red); *Restore* a quien puede manejar la página.
// - Archivos: con red, de los proyectos que la persona ve (la base decide): con varios, en un solo pedido
//   (`trashed_files_all`), y con uno solo o con una base sin esa función, uno por proyecto (`trashed_files`); mandar a
//   la papelera de Drive y *Empty*, solo el dueño y los admins.
// - Proyectos: con red y la base en la versión 9 (`trashed_projects`: la base decide cuáles ve cada uno). No son de
//   ningún proyecto abierto: se ven con los dos alcances.

/** Qué tipos muestra la lista. */
export type TrashFilter = 'all' | 'projects' | 'pages' | 'files';
/** De qué proyectos: el abierto o todos los del dispositivo. */
export type TrashScope = 'current' | 'all';

type Item =
  | { kind: 'page'; at: number; projectId: string; page: PageRow }
  | { kind: 'file'; at: number; projectId: string; file: TrashedFileRow }
  | { kind: 'project'; at: number; row: TrashedProjectRow };

/**
 * La lista de archivos de un proyecto: cargando, con error, lista, o que la base no la deja ver (no se muestra).
 * `joint`: el error es del pedido que trae juntas las papeleras de varios proyectos (un solo aviso y un solo *Retry*).
 */
type Loaded =
  | { state: 'loading' }
  | { state: 'error'; message: string; joint?: true }
  | { state: 'ready'; files: TrashedFileRow[] }
  | { state: 'hidden' };

/** Una fecha ISO como número para ordenar (la del dispositivo y la de la base se escriben distinto). */
const when = (iso: string | null | undefined) => (iso ? Date.parse(iso) || 0 : 0);

/**
 * Las piezas de la lista, ya filtradas y ordenadas (sin React, para las pruebas): las páginas que se mandaron a la
 * papelera (no las que están adentro de otra), los archivos y los proyectos borrados, del más nuevo al más viejo.
 */
export function trashItems(input: {
  filter: TrashFilter;
  pages: PageRow[];
  files: { projectId: string; file: TrashedFileRow }[];
  projects: TrashedProjectRow[];
}): Item[] {
  const items: Item[] = [];
  if (input.filter === 'all' || input.filter === 'pages') {
    for (const page of input.pages) items.push({ kind: 'page', at: when(page.deleted_at), projectId: page.workspace_id, page });
  }
  if (input.filter === 'all' || input.filter === 'files') {
    for (const f of input.files) items.push({ kind: 'file', at: when(f.file.trashed_at), projectId: f.projectId, file: f.file });
  }
  if (input.filter === 'all' || input.filter === 'projects') {
    for (const row of input.projects) items.push({ kind: 'project', at: when(row.deleted_at), row });
  }
  // `sort` es estable: con la misma hora queda el orden de cada lista.
  return items.sort((a, b) => b.at - a.at);
}

function sumSizes(files: TrashedFileRow[]): number {
  return files.reduce((sum, f) => sum + (Number.isFinite(f.size) ? f.size : 0), 0);
}

/**
 * Lo que dice la confirmación de mandar archivos: adónde van, cómo se recuperan y el riesgo que anota el plan. Al
 * vaciar, además cuánto pasa a la papelera de Drive (que no libera nada hasta que Google la vacía).
 */
function confirmText(question: string, many: boolean, space?: string): string {
  const where = many ? t('fileTrash.whereMany') : t('fileTrash.whereOne');
  return [question, where, space, unsyncedUseWarning()].filter(Boolean).join('\n\n');
}

/**
 * La papelera única, adentro del selector de proyectos. `current` es el proyecto abierto (el alcance de entrada);
 * `onClose` cierra el selector (al abrir una página de la lista).
 */
export function TrashPanel(props: { current: string; onClose: () => void }) {
  const tree = useTree();
  const perms = usePermissions();
  const { media, remote, sizes: sizeStore, engine } = useServices();
  const status = useSyncStatus();
  const sizes = useProjectSizes();
  const drive = useProjectDrive();
  const [filter, setFilter] = useState<TrashFilter>('all');
  const [scope, setScope] = useState<TrashScope>('current');
  const tr = useT();
  const online = status.online;
  const statesReady = (status.schemaVersion ?? 0) >= PROJECT_STATES_SCHEMA_VERSION;

  const deleted = useDeletedProjects({
    remote,
    drive,
    enabled: statesReady && online,
    // *Delete forever* (P.14, entrega 3): con la base en la versión 23.
    purgeReady: (status.schemaVersion ?? 0) >= PROJECT_PURGE_SCHEMA_VERSION,
    onRestored: async () => {
      // Vuelve a la lista de proyectos en la próxima sincronización, con los mismos permisos (no se tocaron).
      await engine.syncNow();
      void sizeStore.refresh();
    },
    // Sus archivos pasaron a la papelera de Drive: el peso cambió.
    onPurged: () => void sizeStore.refresh(),
  });

  // Los proyectos del alcance: el abierto, o todos los que el dispositivo conoce (activos y archivados).
  const known = tree.projects().map((p) => p.id);
  const inScope = scope === 'current' ? [props.current] : known.includes(props.current) ? known : [props.current, ...known];
  // Los archivos, de los proyectos cuya papelera de archivos ve la persona (la base decide de verdad al pedirla).
  const fileProjects = media.trashEnabled ? inScope.filter((id) => perms.canSeeFileTrash(id)) : [];
  const files = useFileTrash(fileProjects, online);

  // Las páginas, de la copia del dispositivo: solo las de proyectos que siguen en la lista (las de uno borrado
  // quedan en el dispositivo hasta la próxima sincronización, que ya no las trae).
  const pages = (scope === 'current' ? tree.trashed(props.current) : tree.trashed()).filter(
    (p) => p.workspace_id === props.current || !!tree.project(p.workspace_id),
  );
  const fileRows = fileProjects.flatMap((id) => {
    const l = files.loaded[id];
    return l?.state === 'ready' ? l.files.map((file) => ({ projectId: id, file })) : [];
  });
  const projectRows = statesReady && Array.isArray(deleted.rows) ? deleted.rows : [];

  // Los filtros que tienen sentido acá: *Projects* con la base en la versión 9, *Files* si hay alguna papelera de
  // archivos que la persona pueda ver. Con uno solo (las páginas), sin filtro.
  // Sin red, solo si ya hay archivos leídos (si no, *Files* diría a la vez "hace falta conexión" y "no hay archivos").
  const filesOffered = online
    ? fileProjects.some((id) => files.loaded[id]?.state !== 'hidden')
    : fileProjects.some((id) => files.loaded[id]?.state === 'ready');
  const filters: TrashFilter[] = ['all', ...(statesReady ? (['projects'] as const) : []), 'pages', ...(filesOffered ? (['files'] as const) : [])];
  const shown: TrashFilter = filters.includes(filter) ? filter : 'all';
  const showFilters = filters.length > 2;
  const onlyPages = !showFilters;
  const list = trashItems({ filter: onlyPages ? 'pages' : shown, pages, files: fileRows, projects: projectRows });

  const nameOf = (id: string) => tree.project(id)?.name ?? tr('project.thisProject');
  const filesLoading = fileProjects.some((id) => (files.loaded[id]?.state ?? 'loading') === 'loading') && online;
  const projectsLoading = statesReady && online && deleted.rows === null && !deleted.error;
  const loading = (shown === 'files' || shown === 'all') && filesLoading ? true : (shown === 'projects' || shown === 'all') && projectsLoading;
  const fileErrors = fileProjects.flatMap((id) => {
    const l = files.loaded[id];
    return l?.state === 'error' ? [{ id, message: l.message, joint: l.joint === true }] : [];
  });
  // El pedido que junta varias papeleras falló: es **un** error (el de ese pedido), no uno por proyecto. Con uno solo
  // de esos proyectos a la vista (se volvió a *This project*), va como el de un proyecto.
  const jointErrors = fileErrors.filter((e) => e.joint).length > 1 ? fileErrors.filter((e) => e.joint) : [];
  const ownErrors = fileErrors.filter((e) => !jointErrors.includes(e));

  // *Empty* vacía solo la papelera de archivos del proyecto abierto, como antes (decisión de Lega, ronda 1): se ofrece
  // con *Files* y *This project*; con *All projects* no está. Lo que se puede vaciar: los archivos del abierto si la
  // persona los manda a la papelera de Drive, sin los que usa una página de la papelera (esos, de a uno, con su
  // confirmación) ni los de una página de un proyecto borrado (esos no se mandan ni de a uno).
  const offerEmpty = shown === 'files' && scope === 'current' && perms.canPurgeFiles(props.current);
  const currentFiles = fileRows.filter((f) => f.projectId === props.current);
  const purgeable = offerEmpty ? currentFiles : [];
  const emptiable = purgeable.filter((f) => !f.file.in_trashed_page && !f.file.in_deleted_project);
  const working = files.busy !== null || files.progress !== null;

  const hint =
    shown === 'pages' || onlyPages
      ? media.trashEnabled
        ? tr('trash.pagesHintMedia')
        : tr('trash.pagesHint')
      : shown === 'projects'
        ? tr('deletedList.hint')
        : shown === 'files'
          ? null
          : tr('trash.hintAll');

  // Sin red, la línea de arriba ya dice que los proyectos y los archivos no se pueden leer: no se dice además que no hay.
  const emptyText =
    !online && (shown === 'projects' || shown === 'files')
      ? null
      : shown === 'projects'
        ? tr('deletedList.none')
        : shown === 'files'
          ? tr('fileTrash.none')
          : tr('trash.empty');

  return (
    <div className="trash-panel">
      {showFilters && (
        <div className="segmented trash-filter" role="group" aria-label={tr('trash.filter')}>
          {filters.map((f) => (
            <button key={f} aria-pressed={shown === f} onClick={() => setFilter(f)}>
              {tr(f === 'all' ? 'trash.filterAll' : f === 'projects' ? 'trash.filterProjects' : f === 'pages' ? 'trash.pages' : 'trash.files')}
            </button>
          ))}
        </div>
      )}
      {/* Los proyectos borrados no son de ningún proyecto abierto: con el filtro *Projects* el alcance no cambia nada. */}
      {shown !== 'projects' && known.length > 1 && (
        <div className="segmented trash-scope" role="group" aria-label={tr('trash.scope')}>
          <button aria-pressed={scope === 'current'} onClick={() => setScope('current')}>
            {tr('trash.scopeCurrent')}
          </button>
          <button aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
            {tr('trash.scopeAll')}
          </button>
        </div>
      )}
      {hint && <p className="muted small trash-hint">{hint}</p>}
      {/* El avance de *Empty* se ve siempre, aunque se cambie de filtro o de alcance a mitad (sigue corriendo). */}
      {files.progress && (
        <p className="muted small trash-progress" role="status">
          {tr('fileTrash.sendingOf', { n: Math.min(files.progress.done + 1, files.progress.total), total: files.progress.total })}
        </p>
      )}
      {shown === 'files' && (
        <>
          <p className="muted small trash-hint">
            {tr('fileTrash.intro')}{' '}
            {status.autoPurgeFiles ? (
              tr('fileTrash.autoOn', { days: TRASH_DAYS })
            ) : (
              <>
                <strong>{tr('fileTrash.autoOffTitle')}</strong> {tr('fileTrash.autoOff', { days: TRASH_DAYS })}
              </>
            )}
          </p>
          <p className="muted small trash-warning">{tr('fileTrash.unsyncedUse')}</p>
          {fileRows.length > 0 && (
            <div className="row trash-files-actions">
              <span className="muted small">
                {tr('fileTrash.total', { count: fileRows.length, size: formatSize(sumSizes(fileRows.map((f) => f.file)), tr.lang) })}
              </span>
              {purgeable.length > 0 && (
                <button
                  className="link danger"
                  disabled={working || !online || emptiable.length === 0}
                  data-tip={!online ? tr('fileTrash.needsInternet') : tr('fileTrash.emptyTip')}
                  onClick={() => void files.emptyAll(emptiable, currentFiles.length, nameOf(props.current))}
                >
                  <TrashIcon size={16} /> {tr('fileTrash.emptyButton')}
                </button>
              )}
            </div>
          )}
        </>
      )}
      {!online && shown !== 'pages' && !onlyPages && <p className="muted small trash-hint">{tr('trash.offlineRest')}</p>}
      {statesReady && online && deleted.rows === 'missing' && (shown === 'projects' || shown === 'all') && (
        <p className="muted small">{tr('deletedList.notYet')}</p>
      )}
      {list.length > 0 && (
        <ul className="trash-list trash-items">
          {list.map((item) => {
            if (item.kind === 'project') {
              return (
                <li key={`project-${item.row.id}`} className="trash-item" data-kind="project">
                  <DeletedProjectItem
                    row={item.row}
                    list={deleted}
                    kind={tr('trash.kindProject')}
                    bytes={sizes.rows?.find((r) => r.project_id === item.row.id)?.drive_bytes ?? null}
                  />
                </li>
              );
            }
            if (item.kind === 'page') {
              const p = item.page;
              return (
                <li key={`page-${p.id}`} className="trash-item" data-kind="page">
                  <span className="trash-thumb trash-thumb-page" aria-hidden="true">
                    <PageIcon size={18} />
                  </span>
                  <div className="trash-file">
                    <span className="trash-kind">
                      {tr('trash.kindPage')} · {nameOf(item.projectId)}
                    </span>
                    <button
                      className="link title"
                      onClick={() => {
                        props.onClose();
                        navigate(pagePath(p.id));
                      }}
                    >
                      {p.title || tr('common.untitled')}
                    </button>
                    <span className="when">{new Date(p.deleted_at!).toLocaleString(locale(tr.lang))}</span>
                  </div>
                  {perms.canManagePage(p.id) && (
                    <button className="secondary" onClick={() => void tree.restore(p.id)}>
                      <RestoreIcon size={16} /> {tr('trash.restore')}
                    </button>
                  )}
                </li>
              );
            }
            const f = item.file;
            const canPurge = perms.canPurgeFiles(item.projectId);
            return (
              <li key={`file-${f.id}`} className="trash-item" data-kind="file">
                <FileThumb id={f.id} name={f.name} />
                <div className="trash-file">
                  <span className="trash-kind">
                    {tr('trash.kindFile')} · {nameOf(item.projectId)}
                  </span>
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
                  {f.purged_at && !files.errors[f.id] && <span className="muted small">{tr('fileTrash.notConfirmed')}</span>}
                  {files.errors[f.id] && <span className="trash-error small">{files.errors[f.id]}</span>}
                </div>
                {/* Un archivo que usa una página de un proyecto borrado no se manda: vuelve si lo restauran (P.14). */}
                {canPurge && !f.in_deleted_project && (
                  <button
                    className="secondary"
                    disabled={working || !online}
                    data-tip={!online ? tr('fileTrash.needsInternet') : tr('fileTrash.sendTip')}
                    onClick={() => void files.sendOne(item.projectId, f)}
                  >
                    {files.busy === f.id ? tr('fileTrash.sending') : tr('fileTrash.send')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {loading && <p className="muted small">{tr('common.loading')}</p>}
      {!loading && list.length === 0 && emptyText && <p className="muted">{emptyText}</p>}
      {(shown === 'projects' || shown === 'all') && <DeletedProjectsError list={deleted} />}
      {(shown === 'files' || shown === 'all') && jointErrors.length > 0 && (
        <p className="muted small">
          {tr('fileTrash.loadFailedMany', { count: jointErrors.length, reason: localize(jointErrors[0].message) })}{' '}
          <button className="link" onClick={() => files.load(jointErrors.map((e) => e.id))}>
            {tr('common.retry')}
          </button>
        </p>
      )}
      {(shown === 'files' || shown === 'all') &&
        ownErrors.map((e) => (
          <p key={e.id} className="muted small">
            {fileErrors.length > 1 || scope === 'all' ? `${nameOf(e.id)}: ` : ''}
            {tr('fileTrash.loadFailed', { reason: localize(e.message) })}{' '}
            <button className="link" onClick={() => files.reload(e.id)}>
              {tr('common.retry')}
            </button>
          </p>
        ))}
    </div>
  );
}

/**
 * Las papeleras de archivos de los proyectos del alcance, la primera vez que cada uno entra en el alcance y con red.
 * Con varios proyectos por pedir (*All projects*), un solo pedido (`trashed_files_all`); con uno solo, o si la base no
 * tiene esa función, una consulta por proyecto (`trashed_files`). Mandar a la papelera de Drive, de a uno o *Empty*.
 */
function useFileTrash(projectIds: string[], online: boolean) {
  const { media, remote, sizes } = useServices();
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const live = useRef(true);
  const asked = useRef(new Set<string>());
  /** La base no tiene `trashed_files_all`: en esta vista se pide proyecto por proyecto. */
  const noAll = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const reload = useCallback(
    (projectId: string) => {
      asked.current.add(projectId);
      setLoaded((l) => ({ ...l, [projectId]: l[projectId]?.state === 'ready' ? l[projectId] : { state: 'loading' } }));
      loadFileTrash(remote, projectId).then(
        (files) => live.current && setLoaded((l) => ({ ...l, [projectId]: files === null ? { state: 'hidden' } : { state: 'ready', files } })),
        (err: unknown) => live.current && setLoaded((l) => ({ ...l, [projectId]: { state: 'error', message: errorMessage(err) } })),
      );
    },
    [remote],
  );

  /** Varios proyectos en un pedido. Lo que la base no trae, la sesión no lo ve; sin la función, de a uno. */
  const loadMany = useCallback(
    (ids: string[]) => {
      for (const id of ids) asked.current.add(id);
      setLoaded((l) => {
        const next = { ...l };
        for (const id of ids) if (next[id]?.state !== 'ready') next[id] = { state: 'loading' };
        return next;
      });
      remote.trashedFilesAll().then(
        (all) => {
          if (!live.current) return;
          if (all === null) {
            noAll.current = true;
            for (const id of ids) reload(id);
            return;
          }
          setLoaded((l) => {
            const next = { ...l };
            for (const id of ids) {
              const files = all.get(id);
              next[id] = files ? { state: 'ready', files } : { state: 'hidden' };
            }
            return next;
          });
        },
        (err: unknown) => {
          if (!live.current) return;
          const message = errorMessage(err);
          setLoaded((l) => {
            const next = { ...l };
            // El error es de este pedido, no de cada proyecto: la lista lo muestra una vez, con un solo *Retry*.
            for (const id of ids) if (next[id]?.state !== 'ready') next[id] = { state: 'error', message, joint: true };
            return next;
          });
        },
      );
    },
    [remote, reload],
  );

  /** Pide las papeleras de estos proyectos: varias, en un pedido (si la base las junta); una, o sin esa función, de a una. */
  const load = useCallback(
    (ids: string[]) => {
      if (ids.length > 1 && !noAll.current) loadMany(ids);
      else for (const id of ids) reload(id);
    },
    [reload, loadMany],
  );

  // Sin red no se pide nada (quedan cargando); al volver la red, lo que faltaba. Cada proyecto, una vez.
  const key = projectIds.join(',');
  useEffect(() => {
    if (!online) return;
    load((key ? key.split(',') : []).filter((id) => !asked.current.has(id)));
  }, [key, online, load]);

  const drop = (file: TrashedFileRow) => {
    setLoaded((l) => {
      const next: Record<string, Loaded> = {};
      for (const [id, v] of Object.entries(l)) next[id] = v.state === 'ready' ? { ...v, files: v.files.filter((f) => f.id !== file.id) } : v;
      return next;
    });
    setErrors((e) => {
      const next = { ...e };
      delete next[file.id];
      return next;
    });
  };

  /** Lo que pasó con uno: sale de la lista, hay que volver a leer su proyecto (409) o queda con su error. */
  const settle = (file: TrashedFileRow, outcome: TrashOutcome): boolean => {
    if (outcome.status === 'done') {
      drop(file);
      return false;
    }
    if (outcome.status === 'in_use') {
      notify(t('fileTrash.inUse', { name: file.name }));
      return true;
    }
    // Sin Drive conectado, o con la app más vieja que la mínima del workspace, no se mandó ni se marcó nada: se
    // avisa, sin error en el archivo.
    if (outcome.status === 'not_connected' || outcome.status === 'outdated') {
      notify(outcome.message);
      return false;
    }
    setErrors((e) => ({ ...e, [file.id]: outcome.message }));
    return false;
  };

  const trash = (id: string) => media.trash(id);

  const sendOne = async (projectId: string, file: TrashedFileRow) => {
    const question = file.in_trashed_page
      ? t('fileTrash.confirmUsed', { name: file.name, page: file.trashed_page_title || t('common.untitled') })
      : t('fileTrash.confirmOne', { name: file.name });
    if (!confirm(confirmText(question, false))) return;
    setBusy(file.id);
    const outcome = await sendToDriveTrash(trash, file.id);
    // El peso del proyecto cambió (aunque se haya cerrado la vista): se vuelve a pedir, como al terminar *Empty*.
    if (outcome.status === 'done') void sizes.refresh();
    if (!live.current) return;
    setBusy(null);
    if (settle(file, outcome)) reload(projectId);
  };

  const emptyAll = async (list: { projectId: string; file: TrashedFileRow }[], listed: number, project: string) => {
    if (list.length === 0) return;
    const what = list.length === 1 ? `“${list[0].file.name}”` : t('fileTrash.allFiles', { count: list.length });
    const kept = listed - list.length;
    const skip = kept > 0 ? ` ${t('fileTrash.kept', { count: kept })}` : '';
    // Solo lo que se va a mandar (sin los que usa una página de la papelera).
    const space = t('fileTrash.emptySpace', { size: formatSize(sumSizes(list.map((f) => f.file))) });
    if (!confirm(confirmText(t('fileTrash.confirmEmpty', { what, skip, project }), list.length > 1, space))) return;
    setProgress({ done: 0, total: list.length });
    const refresh = new Set<string>();
    const byId = new Map(list.map((f) => [f.file.id, f]));
    const stop = { cancelled: false };
    const results = await emptyFileTrash(
      trash,
      list.map((f) => f.file.id),
      (done, total, id, outcome) => {
        if (!live.current) {
          stop.cancelled = true;
          return;
        }
        setProgress({ done, total });
        const entry = byId.get(id)!;
        if (settle(entry.file, outcome)) refresh.add(entry.projectId);
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
    for (const id of refresh) reload(id);
  };

  return { loaded, errors, busy, progress, reload, load, sendOne, emptyAll };
}

/**
 * La miniatura del archivo (la del dispositivo o la del bucket `thumbs`); un adjunto sin miniatura, la etiqueta
 * de su tipo (PDF, ZIP…); si no, un recuadro vacío. `has` en falso: se sabe que no hay miniatura y no se pide.
 */
export function FileThumb({ id, name, has = true }: { id: string; name: string; has?: boolean }) {
  const { media } = useServices();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!has) return;
    let alive = true;
    void media.thumbnail(id).then(
      (url) => alive && setSrc(url),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [media, id, has]);
  if (src) return <img className="trash-thumb" src={src} alt={name} />;
  if (fileKind(null, name) === 'file') return <span className="trash-thumb trash-thumb-file" aria-hidden="true">{extensionLabel(name, null)}</span>;
  return <span className="trash-thumb" aria-hidden="true" />;
}
