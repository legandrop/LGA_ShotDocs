import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { locale, t, useT } from '../i18n';
import { formatSize } from '../media/fileTrash';
import { useOffline, usePermissions, useProjectSizes, useServices, useSyncStatus, useTree } from '../services';
import { isOnlyActiveProject, nextProjectAfter } from '../sync/projectStates';
import { PROJECT_COLOR_SCHEMA_VERSION, PROJECT_STATES_SCHEMA_VERSION, VENDOR_TEAM_SCHEMA_VERSION, VENDORS_SCHEMA_VERSION } from '../sync/remote';
import { pagePath } from '../router';
import { modPressed } from './findUi';
import { newTab, openInNewTab, tabsOn } from './tabs';
import { displayName } from '../workspaces';
import { useCodaOwner } from '../import/codaOwner';
import { importJobFor } from '../import/importJob';
import {
  AccountIcon,
  ArchiveIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExportIcon,
  MembersIcon,
  MoreIcon,
  OfflineMarkIcon,
  PaletteIcon,
  PlusIcon,
  RenameIcon,
  SearchIcon,
  ShareIcon,
  SizeListIcon,
  StarFilledIcon,
  StarIcon,
  TrashIcon,
  UnarchiveIcon,
} from './icons';
import { menuBelow, useFloating, type MenuPosition } from './menus';
import { notify } from './notice';
import { editedLabel, lastPageOf, projectStateError, useCurrentProject, useSwitchProject } from './project';
import { defaultProjectColor, loadRecentColors, previewColor, PROJECT_PRESETS, projectColor, rememberRecentColor, useProjectColor } from './projectColor';
import { ColorPicker } from './ColorPicker';
import { searchSession, useSearchSession } from './projectSearchUi';
import { adoptDeviceFavorites, favoritesFirst } from './projectFavorites';
import { tipRows } from './tipRows';
import { DeleteProjectDialog, FilesBySizePanel, ProjectSearch, ShareDialog, ShareScenesDialog, TrashPanel, VendorTeamDialog } from './lazyDialogs';
import { Part } from './lazyPart';
import { OfflineBadge, offlineSupported, offlineTipOf, openOffline } from './SpaceHost';
import { openExport } from './ExportHost';
import { LEVEL_VIEW } from '../sync/access';
import { WorkspacesDialog, type WorkspacesMode } from './Welcome';
import { createStageFolders } from '../relations/projectStructure';
import {
  RemoveWorkspaceDialog,
  useCurrentWorkspace,
  useLeaveGuard,
  useRememberWorkspaceName,
  WorkspaceSection,
} from './WorkspaceMenu';

/**
 * El punto de color de un proyecto (reemplazó al recuadro con dos letras): su color elegido o el de fábrica, y el que se
 * está probando mientras el picker está abierto.
 */
export function ProjectDot({ id, size = 14 }: { id: string; size?: number }) {
  const tree = useTree();
  return <ProjectDotOf project={tree.project(id) ?? { id, color: null }} size={size} />;
}

/** El punto de un proyecto que no está en el árbol (uno borrado; la pantalla «sin proyectos», sin servicios). */
export function ProjectDotOf({ project, size = 14 }: { project: { id: string; color?: string | null }; size?: number }) {
  const color = useProjectColor(project);
  return <span className="project-dot" style={{ width: size, height: size, background: color ?? undefined }} aria-hidden="true" />;
}


/**
 * Elegir el color de un proyecto, dentro del selector: el picker con la vista previa en vivo en todos los puntos del
 * proyecto (la barra, la lista, los tabs). *OK* lo guarda (anda sin red: `PageTree.colorProject`); *Cancel*, Escape o
 * cerrar el selector lo descartan. Elegir el color de fábrica lo deja sin elegir.
 */
function ProjectColorPanel(props: { id: string; name: string; touch: boolean; onDone: () => void }) {
  const tree = useTree();
  const tr = useT();
  const { id } = props;
  const [initial] = useState(() => projectColor(tree.project(id) ?? { id, color: null }));
  const [recents] = useState(loadRecentColors);
  // Aceptado: la vista previa queda hasta que el color nuevo está en la vista (si no, el punto parpadea con el viejo).
  const accepted = useRef(false);
  // Cerrar el selector a mitad de camino (un clic afuera) también descarta la vista previa.
  useEffect(
    () => () => {
      if (!accepted.current) previewColor(id, null);
    },
    [id],
  );
  return (
    <>
      <button className="project-back" autoFocus={!props.touch} onClick={props.onDone}>
        <ChevronLeftIcon size={16} />
        {tr('project.colorNamed', { name: props.name })}
      </button>
      <ColorPicker
        initial={initial}
        defaultColor={defaultProjectColor(id)}
        presets={PROJECT_PRESETS}
        recents={recents}
        onChange={(color) => previewColor(id, color)}
        onCancel={() => {
          previewColor(id, null);
          props.onDone();
        }}
        onAccept={(color) => {
          accepted.current = true;
          rememberRecentColor(color);
          void tree
            .colorProject(id, color === defaultProjectColor(id) ? null : color)
            .catch(() => notify(t('project.colorFailed')))
            .finally(() => previewColor(id, null));
          props.onDone();
        }}
      />
    </>
  );
}

/** El ancho del selector en el escritorio (styles.css): la lista de proyectos (`.project-list-menu`) y la papelera (`.project-menu`). */
const PROJECT_LIST_WIDTH = 400;
const PROJECT_MENU_WIDTH = 520;

// En pantallas táctiles no se enfoca el buscador al abrir: el teclado taparía la lista.
const coarsePointer = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

// Abrir la papelera desde afuera del selector (la dirección vieja `/trash`, Workspace.tsx): el selector se abre ya en
// la papelera. Sin un selector montado no hace nada (no queda un pedido guardado que lo abra solo más tarde): el
// `Shell` lo pide con la barra lateral ya montada.
const trashListeners = new Set<() => void>();

/** Abre el selector de proyectos en la papelera (*Trash*). */
export function openProjectTrash(): void {
  for (const listener of trashListeners) listener();
}

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
  // Con qué lista se abre el selector: la de siempre o la papelera (`openProjectTrash`).
  const [startIn, setStartIn] = useState<'list' | 'trash'>('list');
  const [sharing, setSharing] = useState<string | null>(null);
  // *Share scenes of “<proyecto>”* (Doc_Compartir_Escenas.md): el proyecto cuyas escenas se comparten.
  const [sharingScenes, setSharingScenes] = useState<string | null>(null);
  // Lo del equipo de un vendor (D854): sumar gente al equipo (`team`) o repartir las escenas entre artistas.
  const [vendorTeam, setVendorTeam] = useState<{ id: string; kind: 'team' | 'artists' } | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const switchTo = useSwitchProject();
  const [workspaces, setWorkspaces] = useState<WorkspacesMode | null>(null);
  const [removing, setRemoving] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const project = tree.project(current);
  const stats = tree.projectStats(current);
  const tr = useT();
  const name = project?.name ?? tr('project.defaultName');

  const toggle = () => {
    setStartIn('list');
    setPosition((open) => (open || !button.current ? null : menuBelow(button.current, PROJECT_LIST_WIDTH)));
  };

  useEffect(() => {
    const open = () => {
      if (!button.current) return;
      setStartIn('trash');
      setPosition(menuBelow(button.current, PROJECT_MENU_WIDTH));
    };
    trashListeners.add(open);
    return () => {
      trashListeners.delete(open);
    };
  }, []);

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
        data-tour="project-switcher"
        aria-haspopup="dialog"
        aria-expanded={!!position}
        data-tip={tipRows([{ shortcut: 'search', action: tr('project.switchTip') }])}
        onClick={toggle}
      >
        <ProjectDot id={current} />
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
              initialMode={startIn}
              position={position}
              anchor={button.current}
              onClose={() => setPosition(null)}
              onShare={(id) => setSharing(id)}
              onShareScenes={(id) => setSharingScenes(id)}
              onVendorTeam={(id, kind) => setVendorTeam({ id, kind })}
              onDelete={(id, name) => setDeleting({ id, name })}
              onWorkspaces={(mode) => setWorkspaces(mode)}
              onRemoveWorkspace={() => setRemoving(true)}
              onImport={codaOwner ? () => importJobFor(tree).show('coda') : undefined}
              onImportArchive={() => importJobFor(tree).show('archive')}
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
      {sharingScenes &&
        createPortal(
          <Part onClose={() => setSharingScenes(null)}>
            <ShareScenesDialog projectId={sharingScenes} onClose={() => setSharingScenes(null)} />
          </Part>,
          document.body,
        )}
      {vendorTeam &&
        createPortal(
          <Part onClose={() => setVendorTeam(null)}>
            {vendorTeam.kind === 'team' ? (
              <VendorTeamDialog projectId={vendorTeam.id} onClose={() => setVendorTeam(null)} />
            ) : (
              <ShareScenesDialog projectId={vendorTeam.id} artists onClose={() => setVendorTeam(null)} />
            )}
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

/** Un renglón de un menú flotante del selector (⋯ de un proyecto, *New*). */
interface PopEntry {
  key: string;
  label: string;
  /** El nombre accesible, si dice más que el texto (con el nombre del proyecto). */
  aria?: string;
  /** Por qué está apagado (o qué agrega): el tooltip. */
  tip?: string;
  disabled?: boolean;
  danger?: boolean;
  /** Algo a la derecha del texto (la muestra del color). */
  right?: ReactNode;
  /** El ícono, solo en la lista del teléfono (en el menú flotante, solo texto). */
  icon?: ReactNode;
  run: () => void;
}

/** Cuál menú flotante está abierto y desde qué botón. */
type PopKind = { kind: 'row'; id: string } | { kind: 'new' };
type Pop = { anchor: HTMLElement } & PopKind;

/** Los renglones de un menú flotante que se pueden elegir. Las flechas recorren todos, también los apagados (su motivo se lee con el foco). */
const ENABLED = 'button:not([aria-disabled="true"])';

/**
 * Un menú chico que sale de un botón del selector (el ⋯ de un renglón, *New*): con texto y en grupos. Va
 * adentro del selector (fijo a la ventana) para que tocarlo no cuente como tocar afuera. Escape lo cierra sin cerrar el
 * selector; tocar afuera o desplazar la lista, también. Las flechas recorren los renglones.
 */
function PopMenu(props: {
  anchor: HTMLElement;
  label: string;
  groups: PopEntry[][];
  align: 'left' | 'right';
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(props.onClose);
  close.current = props.onClose;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const a = props.anchor.getBoundingClientRect();
    const { width, height } = el.getBoundingClientRect();
    const left = props.align === 'right' ? a.right - width : a.left;
    el.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`;
    const below = a.bottom + 4;
    const above = a.top - 4 - height;
    const fitsBelow = below + height <= window.innerHeight - 8;
    const top = fitsBelow || above < 8 ? below : above;
    el.style.top = `${Math.max(8, Math.min(top, window.innerHeight - 8 - height))}px`;
    el.querySelector<HTMLElement>(ENABLED)?.focus({ preventScroll: true });
    return () => {
      // Si el foco quedó en el menú (o se perdió al desmontarlo), vuelve al botón que lo abrió.
      const active = document.activeElement;
      if (props.anchor.isConnected && (!active || active === document.body || el.contains(active))) props.anchor.focus({ preventScroll: true });
    };
  }, [props.anchor, props.align]);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !props.anchor.contains(target)) close.current();
    };
    const onResize = () => close.current();
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('resize', onResize);
    };
  }, [props.anchor]);
  return (
    <div
      ref={ref}
      className="project-pop"
      role="menu"
      aria-label={props.label}
      style={{ left: 0, top: 0 }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close.current();
        } else if (e.key === 'Tab') {
          close.current();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const list = [...(ref.current?.querySelectorAll<HTMLElement>('button') ?? [])];
          if (!list.length) return;
          const at = list.indexOf(document.activeElement as HTMLElement);
          list[(at + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length].focus();
        }
      }}
    >
      {props.groups.map((group, i) => (
        <div key={i} className="project-pop-group" role="group">
          {group.map((entry) => (
            <button
              key={entry.key}
              role="menuitem"
              className={entry.danger ? 'danger' : undefined}
              aria-label={entry.aria}
              data-tip={entry.tip}
              // Apagado con `aria-disabled` (no `disabled`): sigue recibiendo el mouse y el tooltip explica por qué.
              aria-disabled={entry.disabled || undefined}
              onClick={() => {
                if (entry.disabled) return;
                close.current();
                entry.run();
              }}
            >
              {entry.label}
              {entry.right && <span className="project-pop-right">{entry.right}</span>}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

type Mode =
  | { name: 'list' }
  | { name: 'new' }
  | { name: 'rename'; id: string }
  // El color del proyecto (Docs/Doc_Navegacion.md, «Color del proyecto»).
  | { name: 'color'; id: string }
  | { name: 'archived' }
  // La papelera única: proyectos, páginas y archivos borrados (TrashView.tsx).
  | { name: 'trash' }
  // Los archivos de un proyecto ordenados por peso (P.8, FilesBySize.tsx).
  | { name: 'files'; id: string };

function ProjectMenu(props: {
  current: string;
  /** `trash`: se abre directo en la papelera (`openProjectTrash`). */
  initialMode?: 'list' | 'trash';
  position: MenuPosition;
  anchor: HTMLElement | null;
  onClose: () => void;
  onShare: (projectId: string) => void;
  /** *Share scenes of “<proyecto>”* (Doc_Compartir_Escenas.md): dueño y admins, con la base en la 28. */
  onShareScenes: (projectId: string) => void;
  /** Lo del equipo de un vendor (D854): *Share all scenes…* (`team`) o *Share scenes with artists…*. */
  onVendorTeam: (projectId: string, kind: 'team' | 'artists') => void;
  onDelete: (projectId: string, name: string) => void;
  onWorkspaces: (mode: WorkspacesMode) => void;
  onRemoveWorkspace: () => void;
  /** Solo para la cuenta de Lega (codaOwner.ts); sin esto no aparece "Importar de Coda". */
  onImport?: () => void;
  /** *Import Shot Docs archive* (P.22, entrega 3): para quien crea proyectos (dueño y admins). */
  onImportArchive?: () => void;
}) {
  const tree = useTree();
  const perms = usePermissions();
  const { sizes: sizeStore, remote, engine, mediaDb } = useServices();
  const status = useSyncStatus();
  const sizes = useProjectSizes();
  const switchTo = useSwitchProject();
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [mode, setMode] = useState<Mode>(props.initialMode === 'trash' ? { name: 'trash' } : { name: 'list' });
  const [touch] = useState(coarsePointer);
  const [returned, setReturned] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  // Archivar pregunta en el mismo renglón (P.14); en el teléfono, "⋯" despliega las acciones del renglón.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // El menú flotante abierto (⋯ de un renglón, *New* o *Share*), si hay uno.
  const [pop, setPop] = useState<Pop | null>(null);
  const offlineSnapshot = useOffline();
  // Las flechas del buscador mueven el renglón activo: la lista se desplaza para que se vea (ver abajo).
  const keyNav = useRef(false);
  const tr = useT();
  useFloating(ref, props.onClose, props.anchor, false, !touch);
  // Un menú flotante no sobrevive a cambiar de pantalla ni de búsqueda (el renglón puede ya no estar).
  useEffect(() => setPop(null), [mode.name, query, confirming]);
  // El peso de cada proyecto (P.7): se vuelve a pedir al abrir si pasaron 5 minutos; mientras, lo guardado.
  useEffect(() => void sizeStore.refreshIfStale(), [sizeStore]);

  // Archivar y borrar (P.14) solo con la base en la versión 9: con una más vieja, el selector es el de siempre.
  const statesReady = (status.schemaVersion ?? 0) >= PROJECT_STATES_SCHEMA_VERSION;
  // El color, con la base en la versión 27 (una más vieja no tiene dónde guardarlo).
  const colorReady = (status.schemaVersion ?? 0) >= PROJECT_COLOR_SCHEMA_VERSION;
  // *Share scenes* con vendors (Doc_Compartir_Escenas.md, sección 11, D852): dueño o admin que comparte el proyecto, o quien
  // tiene *Can share scenes*, con la base en la 31. La base vuelve a pedir todo (`save_scene_vendors`).
  const scenesReady = (status.schemaVersion ?? 0) >= VENDORS_SCHEMA_VERSION;
  const teamReady = (status.schemaVersion ?? 0) >= VENDOR_TEAM_SCHEMA_VERSION;
  const { workspace, user } = useServices();
  const keys = workspace.config.storage;
  // La estrella de cada renglón: los favoritos de la persona van primero (`ProjectRow.favorite`, se sincronizan). Lo que la
  // v0.327 guardó solo en este dispositivo pasa una vez a la base.
  useEffect(() => void adoptDeviceFavorites(keys, user.id, tree).catch(() => undefined), [keys, user.id, tree]);
  const toggleFavorite = (id: string, favorite: boolean) =>
    void tree.favoriteProject(id, favorite).catch(() => notify(t('project.favoriteFailed')));
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
  const projects = favoritesFirst(all.filter((p) => !needle || p.name.toLowerCase().includes(needle)));
  // Con las flechas, el renglón activo se desplaza hasta quedar a la vista (la lista tiene su propio scroll).
  const activeId = projects[Math.min(active, projects.length - 1)]?.id;
  useEffect(() => {
    if (!keyNav.current) return;
    keyNav.current = false;
    document.getElementById(`project-option-${activeId}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, activeId]);
  const archivedCount = tree.archivedProjects().filter((p) => p.id !== props.current).length;
  // El peso que se muestra de un proyecto: solo a quien ve su papelera de archivos (también en el dispositivo: un
  // valor guardado no se muestra si se perdió el permiso); 0 si no hay o no lo ve.
  const weightOf = (id: string) => (perms.canSeeFileTrash(id) ? (sizes.rows?.find((r) => r.project_id === id)?.drive_bytes ?? 0) : 0);
  // "Files by size" (P.8) se ofrece si algún proyecto muestra un peso; abre el abierto o, si no pesa, el más pesado.
  const heaviest = tree
    .projects()
    .map((p) => p.id)
    .filter((id) => weightOf(id) > 0)
    .sort((a, b) => weightOf(b) - weightOf(a));
  const nameOf = (id: string) => tree.project(id)?.name ?? tr('project.thisProject');
  // El campo de arriba busca en todo el proyecto abierto (Docs/Doc_Buscar.md, «Buscar en la página o en el proyecto»,
  // pedido de Lega): la primera letra abre el panel de Ctrl/⌘+K con lo escrito y el selector se cierra. Los otros
  // proyectos cuyo nombre coincide salen en ese panel. Los archivados siguen filtrándose acá por nombre.
  const allServices = useServices();
  const searchesProject = !archivedMode;
  // El panel se baja aparte: se pide al abrir el selector, así la primera letra no espera y no se pierden las otras.
  useEffect(() => {
    ProjectSearch.preload();
  }, []);
  /** Pasa lo escrito al panel del proyecto. El foco va antes al botón del selector: el panel vuelve ahí al cerrarse. */
  const searchProject = (value: string) => {
    setQuery('');
    props.anchor?.focus();
    searchSession(allServices).openWith(value);
  };

  /**
   * Abre el proyecto en un tab nuevo de fondo (Ctrl/⌘+clic o la rueda): en su última página, si la hay; si no, en su
   * inicio. Sin tabs (el navegador), solo una página se puede abrir aparte; `false` si no se abrió.
   */
  const openProjectInNewTab = (id: string): boolean => {
    const last = lastPageOf(keys, id);
    const page = last ? tree.get(last) : undefined;
    const path = page && page.workspace_id === id && !tree.isTrashed(page.id) ? pagePath(page.id) : '/';
    if (tabsOn()) {
      void newTab(path, { background: true, project: id });
      return true;
    }
    return path !== '/' && openInNewTab(path);
  };

  const pick = (id: string) => {
    props.onClose();
    if (id !== props.current) switchTo(id);
  };

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!projects.length) return;
      keyNav.current = true;
      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + projects.length) % projects.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = projects[Math.min(active, projects.length - 1)];
      if (target) pick(target.id);
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
          initial={renaming ? nameOf(mode.id) : ''}
          submit={renaming ? tr('common.rename') : tr('common.create')}
          onCancel={backToList}
          onSubmit={async (name) => {
            try {
              if (mode.name === 'rename') {
                await tree.renameProject(mode.id, name);
                backToList();
              } else {
                const id = await tree.createProject(name);
                // Todo proyecto nuevo arranca con las carpetas de las etapas, vacías (D817).
                await createStageFolders(tree, id, t.lang);
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

  if (mode.name === 'color') {
    return (
      <div
        ref={ref}
        className="menu project-menu color-menu"
        role="dialog"
        aria-label={tr('project.colorNamed', { name: nameOf(mode.id) })}
        style={props.position}
        onKeyDown={(e) => {
          // Escape vuelve a la lista de proyectos (sin cerrar el selector), como en la papelera.
          if (e.key !== 'Escape' || e.defaultPrevented) return;
          e.preventDefault();
          e.stopPropagation();
          backToList();
        }}
      >
        <ProjectColorPanel id={mode.id} name={nameOf(mode.id)} touch={touch} onDone={backToList} />
      </div>
    );
  }

  if (mode.name === 'trash') {
    return (
      <div
        ref={ref}
        className="menu project-menu trash-menu"
        role="dialog"
        aria-label={tr('trash.title')}
        style={props.position}
        onKeyDown={(e) => {
          // Escape vuelve a la lista de proyectos (sin cerrar el selector), como en los archivados.
          if (e.key !== 'Escape' || e.defaultPrevented) return;
          e.preventDefault();
          e.stopPropagation();
          backToList();
        }}
      >
        <button className="project-back" autoFocus={!touch} onClick={backToList}>
          <ChevronLeftIcon size={16} />
          {tr('trash.title')}
        </button>
        <Part>
          <TrashPanel current={props.current} onClose={props.onClose} />
        </Part>
      </div>
    );
  }

  if (mode.name === 'files') {
    return (
      <div
        ref={ref}
        className="menu project-menu trash-menu files-menu"
        role="dialog"
        aria-label={tr('project.filesBySize')}
        style={props.position}
        onKeyDown={(e) => {
          // Escape vuelve a la lista de proyectos, como en la papelera.
          if (e.key !== 'Escape' || e.defaultPrevented) return;
          e.preventDefault();
          e.stopPropagation();
          backToList();
        }}
      >
        <button className="project-back" autoFocus={!touch} onClick={backToList}>
          <ChevronLeftIcon size={16} />
          {tr('project.filesBySize')}
        </button>
        <Part>
          <FilesBySizePanel projectId={mode.id} onClose={props.onClose} />
        </Part>
      </div>
    );
  }

  /**
   * Las acciones de un renglón, en su menú ⋯ (v0.333, pedido de Lega): sin conexión, color y renombrar; compartir, compartir
   * escenas y exportar; archivar y borrar. Archivar y borrar son solo para quien maneja el proyecto; renombrar, con 4 sobre
   * él; compartir, como en *Share*. Los grupos van separados. En el teléfono, la misma lista se despliega abajo del renglón.
   */
  const rowGroups = (id: string, name: string, archived: boolean): PopEntry[][] => {
    const canRename = !archived && perms.canRenameProject(id);
    const canManage = statesReady && perms.canManageProject(id);
    // "Available offline" (P.10): cualquiera que vea el proyecto, si hay base de archivos en el dispositivo.
    const canOffline = !!mediaDb && offlineSupported();
    // "Export project…" (P.22): quien ve el proyecto entero (un invitado con páginas sueltas exporta cada rama).
    const canExport = perms.projectLevel(id) >= LEVEL_VIEW;
    const canColor = canRename && colorReady;
    // Compartir, como antes en el pie y en la hoja del teléfono: también un archivado (se sigue abriendo y editando).
    const canShareIt = perms.canShareProject(id);
    const canScenesOf = scenesReady && perms.canShareScenes(id);
    // Del equipo de un vendor (D854, la columna `vendor_team`, base 32): sumar gente al equipo y repartir sus escenas
    // entre artistas. Quien ya maneja los vendors del proyecto no lo necesita (los ve todos desde *Share scenes…*).
    const isVendorTeam = teamReady && !canScenesOf && tree.project(id)?.vendor_team === true;
    const reason = blockedReason(id, archived);
    const deleteReason = offline ? tr('fileTrash.needsInternet') : archived ? null : reason;
    const groups: (PopEntry | false)[][] = [
      [
        canOffline && {
          key: 'offline',
          label: tr('project.offline'),
          icon: <OfflineMarkIcon size={16} />,
          run: () => {
            props.onClose();
            openOffline('project', id);
          },
        },
        canColor && {
          key: 'color',
          label: tr('project.color'),
          aria: tr('project.colorNamed', { name }),
          icon: <PaletteIcon size={16} />,
          right: <ProjectDot id={id} size={12} />,
          run: () => setMode({ name: 'color', id }),
        },
        canRename && {
          key: 'rename',
          label: tr('project.renameMenu'),
          aria: tr('project.renameNamed', { name }),
          icon: <RenameIcon size={16} />,
          run: () => setMode({ name: 'rename', id }),
        },
      ],
      [
        canShareIt && {
          key: 'share',
          label: tr('project.shareItem'),
          aria: tr('project.share', { name }),
          icon: <ShareIcon size={16} />,
          run: () => {
            props.onClose();
            props.onShare(id);
          },
        },
        canScenesOf && {
          key: 'shareScenes',
          label: tr('project.shareScenesItem'),
          aria: tr('project.shareScenes', { name }),
          icon: <ShareIcon size={16} />,
          run: () => {
            props.onClose();
            props.onShareScenes(id);
          },
        },
        isVendorTeam && {
          key: 'vendorTeam',
          label: tr('project.vendorTeamItem'),
          aria: tr('project.vendorTeamNamed', { name }),
          icon: <MembersIcon size={16} />,
          run: () => {
            props.onClose();
            props.onVendorTeam(id, 'team');
          },
        },
        isVendorTeam && {
          key: 'vendorArtists',
          label: tr('project.vendorArtistsItem'),
          aria: tr('project.vendorArtistsNamed', { name }),
          icon: <ShareIcon size={16} />,
          run: () => {
            props.onClose();
            props.onVendorTeam(id, 'artists');
          },
        },
        canExport && {
          key: 'export',
          label: tr('project.export'),
          icon: <ExportIcon size={16} />,
          run: () => {
            props.onClose();
            openExport('project', id);
          },
        },
      ],
      [
        canManage && {
          key: 'archive',
          label: tr(archived ? 'project.unarchive' : 'project.archive'),
          aria: tr(archived ? 'project.unarchiveNamed' : 'project.archiveNamed', { name }),
          icon: archived ? <UnarchiveIcon size={16} /> : <ArchiveIcon size={16} />,
          tip: (archived ? (offline ? tr('fileTrash.needsInternet') : null) : reason) ?? undefined,
          disabled: busy !== null || (archived ? offline : reason !== null),
          run: () => (archived ? void setArchived(id, false) : setConfirming(id)),
        },
        canManage && {
          key: 'delete',
          label: tr('project.delete'),
          aria: tr('project.deleteNamed', { name }),
          icon: <TrashIcon size={16} />,
          tip: deleteReason ?? undefined,
          danger: true,
          disabled: busy !== null || deleteReason !== null,
          run: () => {
            props.onClose();
            props.onDelete(id, name);
          },
        },
      ],
    ];
    return groups.map((g) => g.filter((e): e is PopEntry => !!e)).filter((g) => g.length > 0);
  };

  // Lo que abre el botón *New* de arriba: proyecto vacío y los dos importar. Solo para quien crea proyectos.
  const newGroups: PopEntry[][] = !perms.canCreateProject || archivedMode
    ? []
    : [
        [{ key: 'new', label: tr('project.new'), run: () => setMode({ name: 'new' }) }],
        [
          ...(props.onImportArchive
            ? [
                {
                  key: 'importArchive',
                  label: tr('importArchive.menu'),
                  run: () => {
                    props.onClose();
                    props.onImportArchive?.();
                  },
                },
              ]
            : []),
          ...(props.onImport
            ? [
                {
                  key: 'importCoda',
                  label: tr('import.menu'),
                  run: () => {
                    props.onClose();
                    props.onImport?.();
                  },
                },
              ]
            : []),
        ],
      ].filter((g) => g.length > 0);

  const newCount = newGroups.flat().length;

  /** Abre (o cierra, si ya estaba abierto desde ese botón) un menú flotante. */
  const togglePop = (next: PopKind, anchor: HTMLElement) =>
    setPop((open) => (open && open.anchor === anchor ? null : ({ ...next, anchor } as Pop)));

  const popGroups = !pop ? [] : pop.kind === 'new' ? newGroups : rowGroups(pop.id, nameOf(pop.id), !!tree.project(pop.id)?.archived_at);

  return (
    <div
      ref={ref}
      className="menu project-menu project-list-menu"
      role="dialog"
      aria-label={tr(archivedMode ? 'project.archivedTitle' : 'project.projects')}
      style={props.position}
    >
      {archivedMode && (
        <button className="project-back" onClick={backToList}>
          <ChevronLeftIcon size={16} />
          {tr('project.archivedTitle')}
        </button>
      )}
      <div className="project-top">
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
            aria-label={searchesProject ? tr('project.searchIn', { name: nameOf(props.current) }).replace(/…$/, '') : tr('project.find')}
            placeholder={searchesProject ? tr('project.searchIn', { name: nameOf(props.current) }) : tr('project.findArchived')}
            value={query}
            onChange={(e) => {
              const value = e.target.value;
              // Escribiendo con un IME, se espera a que termine la composición.
              const composing = (e.nativeEvent as InputEvent).isComposing;
              if (searchesProject && value.trim() && !composing) {
                searchProject(value);
                return;
              }
              setQuery(value);
              setActive(0);
            }}
            onCompositionEnd={(e) => {
              const value = e.currentTarget.value;
              if (!searchesProject || !value.trim()) return;
              searchProject(value);
            }}
            onKeyDown={onSearchKey}
          />
        </label>
        {newGroups.length > 0 && (
          // Crear y los importar en un solo botón al lado del buscador. Sin importar (nadie lo ofrece), crea directo.
          <button
            className="primary project-new"
            aria-haspopup={newCount > 1 ? 'menu' : undefined}
            aria-expanded={newCount > 1 ? pop?.kind === 'new' : undefined}
            onClick={(e) => (newCount > 1 ? togglePop({ kind: 'new' }, e.currentTarget) : setMode({ name: 'new' }))}
          >
            <PlusIcon size={16} />
            {tr(newCount > 1 ? 'project.newMenu' : 'project.new')}
            {newCount > 1 && <ChevronDownIcon size={14} />}
          </button>
        )}
      </div>
      <div className="project-scroll" onScroll={() => setPop(null)}>
        <div className="project-list" id="project-listbox" role="listbox" aria-label={tr(archivedMode ? 'project.archivedTitle' : 'project.yours')}>
          {projects.map((p, i) => {
            const stats = tree.projectStats(p.id);
            const archived = !!p.archived_at;
            // Nunca en cero (ver `weightOf`).
            const bytes = weightOf(p.id);
            const groups = rowGroups(p.id, p.name, archived);
            const hasActions = groups.length > 0;
            // La línea de datos, chica y abajo del nombre (v0.333): páginas, peso y cuándo se editó (o archivó).
            const summary = [
              tr('project.pages', { count: stats.pages }),
              bytes > 0 ? formatSize(bytes, tr.lang) : null,
              archived && archivedMode && p.archived_at ? archivedLabel(p.archived_at, tr) : editedLabel(stats.updatedAt, tr),
            ]
              .filter(Boolean)
              .join(' · ');
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
                  <span className="project-dotcell">
                    <ProjectDot id={p.id} size={10} />
                  </span>
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
            const favorite = !!p.favorite;
            const isCurrent = p.id === props.current;
            const moreOpen = touch ? opened === p.id : pop?.kind === 'row' && pop.id === p.id;
            return (
              <div
                key={p.id}
                role="presentation"
                className={`project-row project-line${i === active ? ' active' : ''}${touch ? ' touch' : ''}${opened === p.id ? ' opened' : ''}${favorite ? ' favorite' : ''}${isCurrent ? ' current' : ''}${moreOpen ? ' more-open' : ''}`}
                onMouseEnter={() => setActive(i)}
              >
                <button
                  id={`project-option-${p.id}`}
                  role="option"
                  aria-selected={i === active}
                  aria-current={isCurrent ? 'true' : undefined}
                  aria-label={[p.name, summary, offlineTipOf(offlineSnapshot, 'project', p.id, tr), isCurrent ? (archived ? tr('project.archivedMark') : tr('project.open')) : null].filter(Boolean).join(', ')}
                  className="project-open"
                  tabIndex={-1}
                  onClick={(e) => {
                    // Ctrl/⌘+clic: en un tab nuevo de fondo, como una página; el selector queda abierto para abrir otros.
                    if (modPressed(e) && !e.altKey && !e.shiftKey && openProjectInNewTab(p.id)) return;
                    pick(p.id);
                  }}
                  // La rueda: sin el desplazamiento automático del navegador (Windows), como en el árbol.
                  onMouseDown={(e) => e.button === 1 && e.preventDefault()}
                  onAuxClick={(e) => {
                    if (e.button !== 1) return;
                    e.preventDefault();
                    openProjectInNewTab(p.id);
                  }}
                >
                  <ProjectDot id={p.id} size={10} />
                  <span className="project-name">
                    <span className="project-title">
                      <strong>
                        {p.name}
                        <OfflineBadge kind="project" id={p.id} />
                      </strong>
                      {isCurrent && <span className="project-badge">{archived ? tr('project.archivedMark') : tr('project.open')}</span>}
                    </span>
                    <small className="project-meta">{summary}</small>
                  </span>
                </button>
                <span className="project-acts">
                  {/* La estrella: llena y siempre a la vista en un favorito; en los demás, al pasar el mouse (en el
                      teléfono, siempre). Su lugar es fijo: no se corre al aparecer el ⋯. */}
                  <button
                    className="icon-button project-star"
                    aria-label={tr(favorite ? 'project.unfavoriteNamed' : 'project.favoriteNamed', { name: p.name })}
                    aria-pressed={favorite}
                    // En un favorito, la estrella llena ya lo dice: el tooltip solo explica qué hace marcarla.
                    data-tip={touch || favorite ? undefined : tr('project.favoriteTip')}
                    onClick={() => {
                      // El renglón cambia de lugar: el resaltado (y Enter) lo sigue, no se queda en el que ocupó su lugar.
                      const next = favoritesFirst(projects.map((q) => (q.id === p.id ? { ...q, favorite: !favorite } : q)));
                      setActive(Math.max(0, next.findIndex((q) => q.id === p.id)));
                      toggleFavorite(p.id, !favorite);
                    }}
                  >
                    {favorite ? <StarFilledIcon size={16} /> : <StarIcon size={16} />}
                  </button>
                  {hasActions ? (
                    <button
                      className="icon-button project-more"
                      aria-label={tr('project.moreNamed', { name: p.name })}
                      aria-haspopup={touch ? undefined : 'menu'}
                      aria-expanded={moreOpen}
                      // Escondido (con `opacity`, para que el renglón no salte) seguiría en el orden de Tab: solo el del
                      // renglón activo (el de las flechas del buscador) o con su menú abierto; en el teléfono, todos.
                      tabIndex={touch || i === active || moreOpen ? 0 : -1}
                      onClick={(e) => (touch ? setOpened((o) => (o === p.id ? null : p.id)) : togglePop({ kind: 'row', id: p.id }, e.currentTarget))}
                    >
                      <MoreIcon size={18} />
                    </button>
                  ) : (
                    <span />
                  )}
                </span>
                {hasActions && touch && opened === p.id && (
                  // En el teléfono, las mismas acciones del ⋯, con íconos y el motivo de lo apagado a la vista.
                  <span className="project-sheet">
                    {groups.map((group, gi) => (
                      <span key={gi} className="project-sheet-group">
                        {group.map((entry, ei) => (
                          <span key={entry.key} className="project-sheet-entry">
                            <button className={entry.danger ? 'danger' : undefined} aria-label={entry.aria} disabled={entry.disabled} onClick={entry.run}>
                              {entry.icon} {entry.label}
                              {entry.right && <span className="project-pop-right">{entry.right}</span>}
                            </button>
                            {/* El motivo, una sola vez: archivar y borrar suelen estar apagados por lo mismo. */}
                            {entry.disabled && entry.tip && !group.slice(ei + 1).some((next) => next.disabled && next.tip === entry.tip) && (
                              <span className="muted small">{entry.tip}</span>
                            )}
                          </span>
                        ))}
                      </span>
                    ))}
                  </span>
                )}
              </div>
            );
          })}
          {/* Solo en archivados se filtra por nombre (la lista principal busca en el proyecto, con el panel). */}
          {projects.length === 0 && archivedMode && (
            <div className="project-empty">
              <p className="muted">{tr('project.noArchived')}</p>
            </div>
          )}
        </div>
        {!archivedMode && (
          <>
            {/* De la copia del dispositivo: anda sin red y sin saber todavía la versión de la base (sección 7.2).
                Desarchivar y borrar, adentro, sí piden red y la versión 9. */}
            {archivedCount > 0 && (
              <button
                className="project-link"
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
                <ChevronRightIcon size={16} />
              </button>
            )}
            <WorkspaceSection onClose={props.onClose} onDialog={props.onWorkspaces} onRemove={props.onRemoveWorkspace} />
          </>
        )}
      </div>
      {!archivedMode && (
        // El pie: las vistas (archivos por peso y la papelera), a la derecha. Compartir está en el ⋯ de cada proyecto.
        <div className="project-foot">
          <span className="project-foot-space" />
          {heaviest.length > 0 && (
            <button className="project-ghost" onClick={() => setMode({ name: 'files', id: heaviest.includes(props.current) ? props.current : heaviest[0] })}>
              <SizeListIcon size={16} />
              {tr('project.filesBySize')}
            </button>
          )}
          {/* La papelera única (proyectos, páginas y archivos): anda sin red con las páginas del dispositivo. */}
          <button className="project-ghost" onClick={() => setMode({ name: 'trash' })}>
            <TrashIcon size={16} />
            {tr('trash.title')}
          </button>
        </div>
      )}
      {pop && popGroups.length > 0 && (
        <PopMenu
          anchor={pop.anchor}
          label={pop.kind === 'row' ? tr('project.moreNamed', { name: nameOf(pop.id) }) : tr('project.newMenu')}
          groups={popGroups}
          align="right"
          onClose={() => setPop(null)}
        />
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
