import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { usePermissions, useServices, useTree } from '../services';
import { displayName } from '../workspaces';
import { AccountIcon, PlusIcon, RenameIcon, SearchIcon, ShareIcon } from './icons';
import { menuBelow, useFloating, type MenuPosition } from './menus';
import { notify } from './notice';
import { editedLabel, monogram, useCurrentProject, useSwitchProject } from './project';
import { ShareDialog } from './ShareDialog';
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
  const name = project?.name ?? 'My project';

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
        data-tip={`**${SHORTCUT}** to switch projects from anywhere`}
        onClick={toggle}
      >
        <Monogram name={name} />
        <span className="project-label">
          <strong>{name}</strong>
          <span>
            {/* Con un solo workspace, igual que siempre. */}
            {all.length > 1 && ws ? `${displayName(ws)} › ` : ''}Project · {stats.pages} {stats.pages === 1 ? 'page' : 'pages'}
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
            />
          </>,
          document.body,
        )}
      {sharing &&
        createPortal(<ShareDialog target={{ projectId: sharing }} onClose={() => setSharing(null)} />, document.body)}
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
}) {
  const tree = useTree();
  const perms = usePermissions();
  const switchTo = useSwitchProject();
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [mode, setMode] = useState<Mode>({ name: 'list' });
  const [touch] = useState(coarsePointer);
  const [returned, setReturned] = useState(false);
  useFloating(ref, props.onClose, props.anchor, false, !touch);

  const needle = query.trim().toLowerCase();
  // Antes de la primera sincronización el dispositivo puede no conocer todavía el proyecto abierto.
  const known = tree.projects();
  const all = known.some((p) => p.id === props.current)
    ? known
    : [{ id: props.current, name: 'My project', created_at: '' }, ...known];
  const projects = all.filter((p) => !needle || p.name.toLowerCase().includes(needle));
  const currentName = tree.project(props.current)?.name ?? 'this project';

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
      <div ref={ref} className="menu project-menu" role="dialog" aria-label={renaming ? 'Rename project' : 'New project'} style={props.position}>
        <NameForm
          label={renaming ? 'Project name' : 'New project name'}
          initial={renaming ? currentName : query.trim()}
          submit={renaming ? 'Rename' : 'Create'}
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
              notify('This device could not save the change. Free up some storage and try again.');
              return false;
            }
            return true;
          }}
        />
      </div>
    );
  }

  return (
    <div ref={ref} className="menu project-menu" role="dialog" aria-label="Projects" style={props.position}>
      <label className="project-search">
        <SearchIcon size={16} />
        <input
          role="combobox"
          aria-expanded="true"
          aria-controls="project-listbox"
          aria-autocomplete="list"
          aria-activedescendant={projects[active] ? `project-option-${projects[active].id}` : undefined}
          autoFocus={returned && !touch}
          aria-label="Find a project"
          placeholder="Find a project…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onSearchKey}
        />
      </label>
      <span className="mono-label project-section">Your projects</span>
      <div className="project-list" id="project-listbox" role="listbox" aria-label="Your projects">
        {projects.map((p, i) => {
          const stats = tree.projectStats(p.id);
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
                  {stats.pages} {stats.pages === 1 ? 'page' : 'pages'} · {editedLabel(stats.updatedAt)}
                </span>
              </span>
              {p.id === props.current && <span className="current-mark">Open</span>}
            </button>
          );
        })}
        {projects.length === 0 && <p className="muted project-empty">No project with that name.</p>}
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
          Share “{currentName}”…
        </button>
      )}
      {perms.canCreateProject && (
        <button onClick={() => setMode({ name: 'new' })}>
          <PlusIcon size={16} />
          {needle && projects.length === 0 ? `New project “${query.trim()}”` : 'New project'}
        </button>
      )}
      {perms.canRenameProject(props.current) && (
        <button onClick={() => setMode({ name: 'rename', id: props.current })}>
          <RenameIcon size={16} />
          Rename “{currentName}”
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
          Back
        </button>
        <button className="primary" disabled={!value.trim() || busy}>
          {props.submit}
        </button>
      </div>
    </form>
  );
}
