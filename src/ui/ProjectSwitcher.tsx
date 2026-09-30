import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { t, useT } from '../i18n';
import { formatSize } from '../media/fileTrash';
import { usePermissions, useProjectSizes, useServices, useTree } from '../services';
import { displayName } from '../workspaces';
import { importJobFor } from '../import/importJob';
import { AccountIcon, ImportIcon, PlusIcon, RenameIcon, SearchIcon, ShareIcon } from './icons';
import { menuBelow, useFloating, type MenuPosition } from './menus';
import { notify } from './notice';
import { editedLabel, monogram, useCurrentProject, useSwitchProject } from './project';
import { ShareDialog } from './lazyDialogs';
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

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const SHORTCUT = IS_MAC ? '⌘K' : 'Ctrl+K';

// En pantallas táctiles no se enfoca el buscador al abrir: el teclado taparía la lista.
const coarsePointer = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/**
 * Arriba de la barra lateral: el proyecto abierto (y, con varios workspaces en el dispositivo, antes el
 * workspace: Workspace › Proyecto). Abre el selector con un clic o con Ctrl+K (⌘K).
 */
export function ProjectSwitcher() {
  const tree = useTree();
  const current = useCurrentProject();
  const { workspace } = useServices();
  const { current: ws, all } = useCurrentWorkspace();
  const leave = useLeaveGuard();
  useRememberWorkspaceName();
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspacesMode | null>(null);
  const [removing, setRemoving] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const project = tree.project(current);
  const stats = tree.projectStats(current);
  const tr = useT();
  const name = project?.name ?? tr('project.defaultName');

  const toggle = () => setPosition((open) => (open || !button.current ? null : menuBelow(button.current, 340)));

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      // En el editor, Ctrl+K con texto elegido crea un link. Se deja pasar aunque la barra de formato
      // todavía no haya aparecido (y no lo haya tomado).
      if (e.defaultPrevented) return;
      const selection = window.getSelection();
      if (e.target instanceof Element && e.target.closest('.bn-editor') && selection && !selection.isCollapsed) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        toggle();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button
        ref={button}
        className="project-button"
        aria-haspopup="dialog"
        aria-expanded={!!position}
        data-tip={tr('project.switchTip', { shortcut: SHORTCUT })}
        onClick={toggle}
      >
        <Monogram name={name} />
        <span className="project-label">
          <strong>{name}</strong>
          <span>
            {/* Con un solo workspace, igual que siempre. */}
            {all.length > 1 && ws ? `${displayName(ws)} › ` : ''}
            {tr('project.summary', { count: stats.pages })}
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
              onWorkspaces={(mode) => setWorkspaces(mode)}
              onRemoveWorkspace={() => setRemoving(true)}
              onImport={() => importJobFor(tree).show()}
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

type Mode = { name: 'list' } | { name: 'new' } | { name: 'rename'; id: string };

function ProjectMenu(props: {
  current: string;
  position: MenuPosition;
  anchor: HTMLElement | null;
  onClose: () => void;
  onShare: (projectId: string) => void;
  onWorkspaces: (mode: WorkspacesMode) => void;
  onRemoveWorkspace: () => void;
  onImport: () => void;
}) {
  const tree = useTree();
  const perms = usePermissions();
  const { sizes: sizeStore } = useServices();
  const sizes = useProjectSizes();
  const switchTo = useSwitchProject();
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [mode, setMode] = useState<Mode>({ name: 'list' });
  const [touch] = useState(coarsePointer);
  const [returned, setReturned] = useState(false);
  const tr = useT();
  useFloating(ref, props.onClose, props.anchor, false, !touch);
  // El peso de cada proyecto (P.7): se vuelve a pedir al abrir si pasaron 5 minutos; mientras, lo guardado.
  useEffect(() => void sizeStore.refreshIfStale(), [sizeStore]);

  const needle = query.trim().toLowerCase();
  // Antes de la primera sincronización el dispositivo puede no conocer todavía el proyecto abierto.
  const known = tree.projects();
  const all = known.some((p) => p.id === props.current)
    ? known
    : [{ id: props.current, name: tr('project.defaultName'), created_at: '' }, ...known];
  const projects = all.filter((p) => !needle || p.name.toLowerCase().includes(needle));
  const currentName = tree.project(props.current)?.name ?? tr('project.thisProject');

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
      else if (needle && perms.canCreateProject) setMode({ name: 'new' });
    }
  };

  if (mode.name !== 'list') {
    const renaming = mode.name === 'rename';
    return (
      <div ref={ref} className="menu project-menu" role="dialog" aria-label={renaming ? tr('project.rename') : tr('project.new')} style={props.position}>
        <NameForm
          label={renaming ? tr('project.name') : tr('project.newName')}
          initial={renaming ? currentName : query.trim()}
          submit={renaming ? tr('common.rename') : tr('common.create')}
          onCancel={() => {
            setReturned(true);
            setMode({ name: 'list' });
          }}
          onSubmit={async (name) => {
            try {
              if (mode.name === 'rename') {
                await tree.renameProject(mode.id, name);
                props.onClose();
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

  return (
    <div ref={ref} className="menu project-menu" role="dialog" aria-label={tr('project.projects')} style={props.position}>
      <label className="project-search">
        <SearchIcon size={16} />
        <input
          role="combobox"
          aria-expanded="true"
          aria-controls="project-listbox"
          aria-autocomplete="list"
          aria-activedescendant={projects[active] ? `project-option-${projects[active].id}` : undefined}
          autoFocus={returned && !touch}
          aria-label={tr('project.find')}
          placeholder={tr('project.findPlaceholder')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onSearchKey}
        />
      </label>
      <span className="mono-label project-section">{tr('project.yours')}</span>
      <div className="project-list" id="project-listbox" role="listbox" aria-label={tr('project.yours')}>
        {projects.map((p, i) => {
          const stats = tree.projectStats(p.id);
          // Solo a quien ve la papelera de archivos del proyecto (también en el dispositivo: un valor guardado
          // no se muestra si se perdió el permiso), y nunca en cero.
          const bytes = perms.canSeeFileTrash(p.id) ? (sizes.rows?.find((r) => r.project_id === p.id)?.drive_bytes ?? 0) : 0;
          return (
            <button
              key={p.id}
              id={`project-option-${p.id}`}
              role="option"
              aria-selected={i === active}
              aria-current={p.id === props.current ? 'true' : undefined}
              className={`project-row${i === active ? ' active' : ''}`}
              tabIndex={-1}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(p.id)}
            >
              <Monogram name={p.name} />
              <span className="project-label">
                <strong>{p.name}</strong>
                <span>
                  {/* El peso antes de la fecha: si no entra, el "…" corta la fecha. */}
                  {tr('project.pages', { count: stats.pages })} · {bytes > 0 && `${formatSize(bytes, tr.lang)} · `}
                  {editedLabel(stats.updatedAt, tr)}
                </span>
              </span>
              {p.id === props.current && <span className="current-mark">{tr('project.open')}</span>}
            </button>
          );
        })}
        {projects.length === 0 && <p className="muted project-empty">{tr('project.noMatch')}</p>}
      </div>
      {(perms.canCreateProject || perms.canRenameProject(props.current) || perms.canShareProject(props.current)) && <hr />}
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
      {perms.canCreateProject && (
        <button
          onClick={() => {
            props.onClose();
            props.onImport();
          }}
        >
          <ImportIcon size={16} />
          {tr('import.menu')}
        </button>
      )}
      {perms.canRenameProject(props.current) && (
        <button onClick={() => setMode({ name: 'rename', id: props.current })}>
          <RenameIcon size={16} />
          {tr('project.renameNamed', { name: currentName })}
        </button>
      )}
      <WorkspaceSection onClose={props.onClose} onDialog={props.onWorkspaces} onRemove={props.onRemoveWorkspace} />
    </div>
  );
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
