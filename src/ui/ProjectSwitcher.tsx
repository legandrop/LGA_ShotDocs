import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { locale, t, useT } from '../i18n';
import { formatSize } from '../media/fileTrash';
import { usePermissions, useProjectSizes, useServices, useSyncStatus, useTree } from '../services';
import { isOnlyActiveProject, nextProjectAfter } from '../sync/projectStates';
import { PROJECT_STATES_SCHEMA_VERSION } from '../sync/remote';
import { displayName } from '../workspaces';
import { useCodaOwner } from '../import/codaOwner';
import { importJobFor } from '../import/importJob';
import {
  AccountIcon,
  ArchiveIcon,
  ChevronLeftIcon,
  ImportIcon,
  MoreIcon,
  PlusIcon,
  RenameIcon,
  SearchIcon,
  ShareIcon,
  TrashIcon,
  UnarchiveIcon,
} from './icons';
import { menuBelow, useFloating, type MenuPosition } from './menus';
import { notify } from './notice';
import { editedLabel, monogram, projectStateError, useCurrentProject, useProjectDrive, useSwitchProject } from './project';
import { SEARCH_SHORTCUT_LABEL, useSearchSession } from './projectSearchUi';
import { DeletedProjectsList, DeleteProjectDialog, ShareDialog } from './lazyDialogs';
import { Part } from './lazyPart';
import { WorkspacesDialog, type WorkspacesMode } from './Welcome';
import {
  RemoveWorkspaceDialog,
  useCurrentWorkspace,
  useLeaveGuard,
  useRememberWorkspaceName,
  WorkspaceSection,
} from './WorkspaceMenu';

export function Monogram({ name, size = 26 }: { name: string; size?: number }) {
  return (
    <span className="monogram" style={{ width: size, height: size, fontSize: size >= 30 ? 12 : 10 }} aria-hidden="true">
      {monogram(name)}
    </span>
  );
}


// En pantallas táctiles no se enfoca el buscador al abrir: el teclado taparía la lista.
const coarsePointer = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/**
 * Arriba de la barra lateral: el proyecto abierto (y, con varios workspaces en el dispositivo, antes el
 * workspace: Workspace › Proyecto). Abre el selector con un clic. Ctrl/⌘+K ya no lo abre: abre la búsqueda del
 * proyecto, que también lista los proyectos (Docs/Doc_Buscar.md, sección 9).
 */
export function ProjectSwitcher() {
  const tree = useTree();
  const current = useCurrentProject();
  const { workspace, engine } = useServices();
  const { current: ws, all } = useCurrentWorkspace();
  const leave = useLeaveGuard();
  // "Importar de Coda", solo para la cuenta de Lega (codaOwner.ts). Acá y no en el menú: el hash ya está
  // resuelto cuando se abre.
  const codaOwner = useCodaOwner();
  useRememberWorkspaceName();
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const switchTo = useSwitchProject();
  const [workspaces, setWorkspaces] = useState<WorkspacesMode | null>(null);
  const [removing, setRemoving] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const project = tree.project(current);
  const stats = tree.projectStats(current);
  const tr = useT();
  const name = project?.name ?? tr('project.defaultName');

  const toggle = () => setPosition((open) => (open || !button.current ? null : menuBelow(button.current, 340)));

  // Ctrl/⌘+K con el selector abierto abre la búsqueda: el selector se cierra (no queda abajo del panel).
  const searchOpen = useSearchSession().isOpen();
  useEffect(() => {
    if (searchOpen) setPosition(null);
  }, [searchOpen]);

  return (
    <>
      <button
        ref={button}
        className="project-button"
        aria-haspopup="dialog"
        aria-expanded={!!position}
        data-tip={tr('project.switchTip', { shortcut: SEARCH_SHORTCUT_LABEL })}
        onClick={toggle}
      >
        <Monogram name={name} />
        <span className="project-label">
          <strong>{name}</strong>
          <span>
            {/* Con un solo workspace, igual que siempre. */}
            {all.length > 1 && ws ? `${displayName(ws)} › ` : ''}
            {tr('project.summary', { count: stats.pages })}
            {/* Un archivado se abre y se edita, con la marca a la vista (decisión de Lega, P.14). */}
            {project?.archived_at ? ` · ${tr('project.archivedMark')}` : ''}
          </span>
        </span>
        <AccountIcon size={16} />
      </button>
      {/* Fuera de la barra lateral: en el teléfono la barra está corrida fuera de la pantalla y todo lo
          que tiene adentro se posiciona respecto de ella. */}
      {position &&
        createPortal(
          <>
            <div className="sheet-scrim" aria-hidden="true" />
            <ProjectMenu
              current={current}
              position={position}
              anchor={button.current}
              onClose={() => setPosition(null)}
              onShare={(id) => setSharing(id)}
              onDelete={(id, name) => setDeleting({ id, name })}
              onWorkspaces={(mode) => setWorkspaces(mode)}
              onRemoveWorkspace={() => setRemoving(true)}
              onImport={codaOwner ? () => importJobFor(tree).show() : undefined}
            />
          </>,
          document.body,
        )}
      {sharing &&
        createPortal(
          <Part onClose={() => setSharing(null)}>
            <ShareDialog target={{ projectId: sharing }} onClose={() => setSharing(null)} />
          </Part>,
          document.body,
        )}
      {deleting &&
        createPortal(
          <Part onClose={() => setDeleting(null)}>
            <DeleteProjectDialog
              projectId={deleting.id}
              name={deleting.name}
              onClose={() => setDeleting(null)}
              onDeleted={async (id) => {
                // A cuál se pasa (si era el abierto): se calcula antes de que salga de la lista (sección 7.3).
                const next = id === current ? nextProjectAfter(tree, id) : null;
                setDeleting(null);
                await tree.forgetProject(id);
                if (id === current) switchTo(next ?? tree.workspaceId);
                button.current?.focus();
                void engine.syncNow();
              }}
            />
          </Part>,
          document.body,
        )}
      {workspaces &&
        createPortal(
          <WorkspacesDialog
            initial={workspaces}
            currentId={workspace.config.localKey}
            beforeLeave={leave}
            onClose={() => setWorkspaces(null)}
          />,
          document.body,
        )}
      {removing && createPortal(<RemoveWorkspaceDialog onClose={() => setRemoving(false)} />, document.body)}
    </>
  );
}

type Mode =
  | { name: 'list' }
  | { name: 'new' }
  | { name: 'rename'; id: string }
  | { name: 'archived' }
  | { name: 'deleted' };

function ProjectMenu(props: {
  current: string;
  position: MenuPosition;
  anchor: HTMLElement | null;
  onClose: () => void;
  onShare: (projectId: string) => void;
  onDelete: (projectId: string, name: string) => void;
  onWorkspaces: (mode: WorkspacesMode) => void;
  onRemoveWorkspace: () => void;
  /** Solo para la cuenta de Lega (codaOwner.ts); sin esto no aparece "Importar de Coda". */
  onImport?: () => void;
}) {
  const tree = useTree();
  const perms = usePermissions();
  const { sizes: sizeStore, remote, engine } = useServices();
  const status = useSyncStatus();
  const sizes = useProjectSizes();
  const drive = useProjectDrive();
  const switchTo = useSwitchProject();
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [mode, setMode] = useState<Mode>({ name: 'list' });
  const [touch] = useState(coarsePointer);
  const [returned, setReturned] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  // Archivar pregunta en el mismo renglón (P.14); en el teléfono, "⋯" despliega las acciones del renglón.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const tr = useT();
  useFloating(ref, props.onClose, props.anchor, false, !touch);
  // El peso de cada proyecto (P.7): se vuelve a pedir al abrir si pasaron 5 minutos; mientras, lo guardado.
  useEffect(() => void sizeStore.refreshIfStale(), [sizeStore]);

  // Archivar y borrar (P.14) solo con la base en la versión 9: con una más vieja, el selector es el de siempre.
  const statesReady = (status.schemaVersion ?? 0) >= PROJECT_STATES_SCHEMA_VERSION;
  const offline = !status.online;
  const needle = query.trim().toLowerCase();
  const archivedMode = mode.name === 'archived';
  // Antes de la primera sincronización el dispositivo puede no conocer todavía el proyecto abierto. Los
  // archivados salen de la lista de todos los días (el abierto, aunque esté archivado, no).
  const known = archivedMode ? tree.archivedProjects() : tree.projects().filter((p) => !p.archived_at || p.id === props.current);
  const all =
    archivedMode || known.some((p) => p.id === props.current)
      ? known
      : [{ id: props.current, name: tr('project.defaultName'), created_at: '' }, ...known];
  const projects = all.filter((p) => !needle || p.name.toLowerCase().includes(needle));
  const archivedCount = tree.archivedProjects().filter((p) => p.id !== props.current).length;
  const currentName = tree.project(props.current)?.name ?? tr('project.thisProject');
  const nameOf = (id: string) => tree.project(id)?.name ?? tr('project.thisProject');

  const pick = (id: string) => {
    props.onClose();
    if (id !== props.current) switchTo(id);
  };

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!projects.length) return;
      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + projects.length) % projects.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = projects[Math.min(active, projects.length - 1)];
      if (target) pick(target.id);
      else if (needle && perms.canCreateProject && !archivedMode) setMode({ name: 'new' });
    } else if (e.key === 'Escape' && mode.name !== 'list') {
      e.preventDefault();
      e.stopPropagation();
      backToList();
    }
  };

  function backToList() {
    setQuery('');
    setActive(0);
    setConfirming(null);
    setOpened(null);
    setReturned(true);
    setMode({ name: 'list' });
  }

  /** Por qué no se puede archivar o borrar este proyecto ahora; `null` si se puede (o si no le toca a la persona). */
  const blockedReason = (id: string, archived: boolean): string | null => {
    if (offline) return tr('fileTrash.needsInternet');
    if (!archived && isOnlyActiveProject(tree, id)) {
      return tr(tree.archivedProjects().length > 0 ? 'project.onlyActive' : 'project.onlyOne');
    }
    return null;
  };

  async function setArchived(id: string, archived: boolean) {
    const name = nameOf(id);
    // A cuál se pasa si se archiva el abierto: se calcula antes de que salga de la lista.
    const next = archived && id === props.current ? nextProjectAfter(tree, id) : null;
    setBusy(id);
    try {
      await remote.setProjectArchived(id, archived);
      await tree.markArchived(id, archived ? new Date().toISOString() : null);
      notify(t(archived ? 'project.archived' : 'project.unarchived', { name }));
      void engine.syncNow();
      if (next) {
        props.onClose();
        switchTo(next);
      }
    } catch (err) {
      notify(projectStateError(err, t));
    } finally {
      setBusy(null);
      setConfirming(null);
      setOpened(null);
      // El renglón confirmado desaparece: el foco vuelve al buscador (si el selector sigue abierto).
      requestAnimationFrame(() => search.current?.focus());
    }
  }

  if (mode.name === 'new' || mode.name === 'rename') {
    const renaming = mode.name === 'rename';
    return (
      <div ref={ref} className="menu project-menu" role="dialog" aria-label={renaming ? tr('project.rename') : tr('project.new')} style={props.position}>
        <NameForm
          label={renaming ? tr('project.name') : tr('project.newName')}
          initial={renaming ? nameOf(mode.id) : query.trim()}
          submit={renaming ? tr('common.rename') : tr('common.create')}
          onCancel={backToList}
          onSubmit={async (name) => {
            try {
              if (mode.name === 'rename') {
                await tree.renameProject(mode.id, name);
                backToList();
              } else {
                const id = await tree.createProject(name);
                props.onClose();
                switchTo(id);
              }
            } catch {
              notify(t('project.saveFailed'));
              return false;
            }
            return true;
          }}
        />
      </div>
    );
  }

  if (mode.name === 'deleted') {
    return (
      <div ref={ref} className="menu project-menu" role="dialog" aria-label={tr('project.deletedList')} style={props.position}>
        <button className="project-back" onClick={backToList}>
          <ChevronLeftIcon size={16} />
          {tr('project.deletedList')}
        </button>
        <Part>
          <DeletedProjectsList
            remote={remote}
            drive={drive}
            sizeOf={(id) => sizes.rows?.find((r) => r.project_id === id)?.drive_bytes ?? null}
            onRestored={async () => {
              // Vuelve a la lista en la próxima sincronización, con los mismos permisos (no se tocaron).
              await engine.syncNow();
              void sizeStore.refresh();
            }}
          />
        </Part>
      </div>
    );
  }

  /** Los íconos de un renglón (archivar y borrar solo a quien maneja el proyecto, renombrar con 4 sobre él). */
  const rowActions = (id: string, name: string, archived: boolean) => {
    const canRename = !archived && perms.canRenameProject(id);
    const canManage = statesReady && perms.canManageProject(id);
    if (!canRename && !canManage) return null;
    const reason = blockedReason(id, archived);
    const deleteReason = offline ? tr('fileTrash.needsInternet') : archived ? null : reason;
    return (
      <span className="project-actions">
        {canRename && (
          <button
            className="icon-button"
            aria-label={tr('project.renameNamed', { name })}
            data-tip={tr('common.rename')}
            onClick={() => setMode({ name: 'rename', id })}
          >
            <RenameIcon size={16} />
          </button>
        )}
        {canManage && (
          <button
            className="icon-button"
            aria-label={tr(archived ? 'project.unarchiveNamed' : 'project.archiveNamed', { name })}
            data-tip={(archived ? (offline ? tr('fileTrash.needsInternet') : null) : reason) ?? tr(archived ? 'project.unarchiveTip' : 'project.archiveTip')}
            disabled={busy !== null || (archived ? offline : reason !== null)}
            onClick={() => (archived ? void setArchived(id, false) : setConfirming(id))}
          >
            {archived ? <UnarchiveIcon size={16} /> : <ArchiveIcon size={16} />}
          </button>
        )}
        {canManage && (
          <button
            className="icon-button danger"
            aria-label={tr('project.deleteNamed', { name })}
            data-tip={deleteReason ?? tr('project.deleteTip')}
            disabled={busy !== null || deleteReason !== null}
            onClick={() => {
              props.onClose();
              props.onDelete(id, name);
            }}
          >
            <TrashIcon size={16} />
          </button>
        )}
      </span>
    );
  };

  return (
    <div ref={ref} className="menu project-menu" role="dialog" aria-label={tr(archivedMode ? 'project.archivedTitle' : 'project.projects')} style={props.position}>
      {archivedMode && (
        <button className="project-back" onClick={backToList}>
          <ChevronLeftIcon size={16} />
          {tr('project.archivedTitle')}
        </button>
      )}
      <label className="project-search">
        <SearchIcon size={16} />
        <input
          role="combobox"
          aria-expanded="true"
          aria-controls="project-listbox"
          aria-autocomplete="list"
          aria-activedescendant={projects[active] ? `project-option-${projects[active].id}` : undefined}
          ref={search}
          autoFocus={returned && !touch}
          aria-label={tr('project.find')}
          placeholder={tr(archivedMode ? 'project.findArchived' : 'project.findPlaceholder')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onSearchKey}
        />
      </label>
      {!archivedMode && <span className="mono-label project-section">{tr('project.yours')}</span>}
      <div className="project-list" id="project-listbox" role="listbox" aria-label={tr(archivedMode ? 'project.archivedTitle' : 'project.yours')}>
        {projects.map((p, i) => {
          const stats = tree.projectStats(p.id);
          const archived = !!p.archived_at;
          // Solo a quien ve la papelera de archivos del proyecto (también en el dispositivo: un valor guardado
          // no se muestra si se perdió el permiso), y nunca en cero.
          const bytes = perms.canSeeFileTrash(p.id) ? (sizes.rows?.find((r) => r.project_id === p.id)?.drive_bytes ?? 0) : 0;
          const actions = rowActions(p.id, p.name, archived);
          if (confirming === p.id) {
            return (
              <div
                key={p.id}
                className="project-row confirming"
                role="presentation"
                onKeyDown={(e) => {
                  if (e.key !== 'Escape') return;
                  e.preventDefault();
                  e.stopPropagation();
                  setConfirming(null);
                  search.current?.focus();
                }}
              >
                <Monogram name={p.name} />
                <span className="project-confirm-text">{tr('project.archiveConfirm', { name: p.name })}</span>
                <button className="primary small" disabled={busy !== null} autoFocus onClick={() => void setArchived(p.id, true)}>
                  {tr('project.archive')}
                </button>
                <button className="link" disabled={busy !== null} onClick={() => setConfirming(null)}>
                  {tr('common.cancel')}
                </button>
              </div>
            );
          }
          return (
            <div
              key={p.id}
              role="presentation"
              className={`project-row${i === active ? ' active' : ''}${touch ? ' touch' : ''}${opened === p.id ? ' opened' : ''}`}
              onMouseEnter={() => setActive(i)}
            >
              <button
                id={`project-option-${p.id}`}
                role="option"
                aria-selected={i === active}
                aria-current={p.id === props.current ? 'true' : undefined}
                className="project-open"
                tabIndex={-1}
                onClick={() => pick(p.id)}
              >
                <Monogram name={p.name} />
                <span className="project-label">
                  <strong>{p.name}</strong>
                  <span>
                    {/* El peso antes de la fecha: si no entra, el "…" corta la fecha. */}
                    {tr('project.pages', { count: stats.pages })} · {bytes > 0 && `${formatSize(bytes, tr.lang)} · `}
                    {archived && archivedMode && p.archived_at
                      ? archivedLabel(p.archived_at, tr)
                      : editedLabel(stats.updatedAt, tr)}
                  </span>
                </span>
                {p.id === props.current && (
                  <span className="current-mark">{archived ? tr('project.archivedMark') : tr('project.open')}</span>
                )}
              </button>
              {actions && touch && (
                <button
                  className="icon-button project-more"
                  aria-label={tr('project.moreNamed', { name: p.name })}
                  aria-expanded={opened === p.id}
                  onClick={() => setOpened((o) => (o === p.id ? null : p.id))}
                >
                  <MoreIcon size={18} />
                </button>
              )}
              {actions && !touch && actions}
              {actions && touch && opened === p.id && (
                <span className="project-sheet">
                  {perms.canRenameProject(p.id) && !archived && (
                    <button onClick={() => setMode({ name: 'rename', id: p.id })}>
                      <RenameIcon size={16} /> {tr('common.rename')}
                    </button>
                  )}
                  {perms.canShareProject(p.id) && (
                    <button
                      onClick={() => {
                        props.onClose();
                        props.onShare(p.id);
                      }}
                    >
                      <ShareIcon size={16} /> {tr('project.share', { name: p.name })}
                    </button>
                  )}
                  {statesReady && perms.canManageProject(p.id) && (
                    <>
                      <button
                        disabled={busy !== null || (archived ? offline : blockedReason(p.id, false) !== null)}
                        onClick={() => (archived ? void setArchived(p.id, false) : setConfirming(p.id))}
                      >
                        {archived ? <UnarchiveIcon size={16} /> : <ArchiveIcon size={16} />}
                        {tr(archived ? 'project.unarchive' : 'project.archive')}
                      </button>
                      <button
                        className="danger"
                        disabled={busy !== null || offline || (!archived && blockedReason(p.id, false) !== null)}
                        onClick={() => {
                          props.onClose();
                          props.onDelete(p.id, p.name);
                        }}
                      >
                        <TrashIcon size={16} /> {tr('project.delete')}
                      </button>
                      {!archived && blockedReason(p.id, false) && <span className="muted small">{blockedReason(p.id, false)}</span>}
                    </>
                  )}
                </span>
              )}
            </div>
          );
        })}
        {projects.length === 0 && (
          <p className="muted project-empty">{tr(archivedMode ? 'project.noArchived' : 'project.noMatch')}</p>
        )}
      </div>
      {!archivedMode && (
        <>
          {(perms.canCreateProject || perms.canShareProject(props.current) || statesReady) && <hr />}
          {perms.canShareProject(props.current) && (
            <button
              onClick={() => {
                props.onClose();
                props.onShare(props.current);
              }}
            >
              <ShareIcon size={16} />
              {tr('project.share', { name: currentName })}
            </button>
          )}
          {perms.canCreateProject && (
            <button onClick={() => setMode({ name: 'new' })}>
              <PlusIcon size={16} />
              {needle && projects.length === 0 ? tr('project.newNamed', { name: query.trim() }) : tr('project.new')}
            </button>
          )}
          {perms.canCreateProject && props.onImport && (
            <button
              onClick={() => {
                props.onClose();
                props.onImport?.();
              }}
            >
              <ImportIcon size={16} />
              {tr('import.menu')}
            </button>
          )}
          {/* De la copia del dispositivo: anda sin red y sin saber todavía la versión de la base (sección 7.2).
              Desarchivar y borrar, adentro, sí piden red y la versión 9. */}
          {archivedCount > 0 && (
            <button
              onClick={() => {
                setQuery('');
                setActive(0);
                setReturned(true);
                setMode({ name: 'archived' });
                // El buscador no se vuelve a montar al cambiar de lista: `autoFocus` no alcanza (sin esto, el foco
                // queda en el fondo de la página y Escape cierra todo el selector).
                if (!touch) requestAnimationFrame(() => search.current?.focus());
              }}
            >
              <ArchiveIcon size={16} />
              {tr('project.archivedList', { count: archivedCount })}
            </button>
          )}
          {statesReady && (
            <button
              disabled={offline}
              data-tip={offline ? tr('fileTrash.needsInternet') : undefined}
              onClick={() => setMode({ name: 'deleted' })}
            >
              <TrashIcon size={16} />
              {tr('project.deletedList')}
            </button>
          )}
          <WorkspaceSection onClose={props.onClose} onDialog={props.onWorkspaces} onRemove={props.onRemoveWorkspace} />
        </>
      )}
    </div>
  );
}

/** "archived Sep 12" (o en castellano). */
function archivedLabel(iso: string, tr: ReturnType<typeof useT>): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return tr('project.archivedOn', {
    date: date.toLocaleDateString(locale(tr.lang), { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }),
  });
}

function NameForm(props: {
  label: string;
  initial: string;
  submit: string;
  onCancel: () => void;
  /** `false` si no se pudo: el formulario vuelve a quedar habilitado. */
  onSubmit: (name: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState(props.initial);
  const [busy, setBusy] = useState(false);
  const tr = useT();
  return (
    <form
      className="project-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!value.trim() || busy) return;
        setBusy(true);
        if (!(await props.onSubmit(value.trim()))) setBusy(false);
      }}
    >
      <label className="pref-label" htmlFor="project-name">
        {props.label}
      </label>
      <input
        id="project-name"
        value={value}
        maxLength={200}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className="row">
        <button type="button" className="link" onClick={props.onCancel}>
          {tr('common.back')}
        </button>
        <button className="primary" disabled={!value.trim() || busy}>
          {props.submit}
        </button>
      </div>
    </form>
  );
}
