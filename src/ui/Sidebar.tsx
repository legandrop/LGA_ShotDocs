import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../i18n';
import { navigate, pagePath, useRoute } from '../router';
import { usePermissions, useServices, useTree } from '../services';
import type { PageRow } from '../sync/types';
import { openHelp } from '../help/helpUi';
import { useHelpDot } from '../tutorial/tourState';
import { AccountIcon, CollapseIcon, ExpandIcon, HelpIcon, MoreIcon, PlusIcon, SearchIcon, TrashIcon } from './icons';
import { AccountMenu, menuBelow, PageMenu, type MenuPosition } from './menus';
import { DriveDialogHost, MembersDialog, ShareDialog } from './lazyDialogs';
import { Part } from './lazyPart';
import { MoveDialog } from './MoveDialog';
import { PageFormatDialog } from './PageFormatDialog';
import { useCurrentProject } from './project';
import { ProjectSwitcher } from './ProjectSwitcher';
import { LinkHeader } from './LinkHeader';
import { MentionTreeDot } from './mentionDots';
import { useLinkMode } from '../linkMode';
import { useSearchSession } from './projectSearchUi';
import { shortcutLabel } from './shortcuts';
import { SyncBadge } from './SyncBadge';
import { OfflineBadge, OfflineLine } from './SpaceHost';
import { splitEnabled, splitSiblings, type SplitTitle } from './titles';
import { createOpenScheduler, isPlainKey, isTreeKey, treeKeyAction, visibleRows } from './treeNav';

const EXPANDED_KEY = 'shotdocs-expanded';

function readExpanded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

type DropZone = 'before' | 'inside' | 'after';

/**
 * `onBrowse` se llama justo antes de que el árbol abra la página `id` sin que la persona la haya elegido con un
 * clic ni con Enter (las flechas, o plegar una madre de la página abierta): en el teléfono, el cajón sigue
 * abierto para seguir recorriendo el árbol.
 */
export function Sidebar({ onBrowse }: { onBrowse?: (id: string) => void } = {}) {
  const tree = useTree();
  const perms = usePermissions();
  const { user } = useServices();
  const route = useRoute();
  const activeId = route.name === 'page' ? route.id : null;
  const projectId = useCurrentProject();
  const search = useSearchSession();
  const tr = useT();
  // Un punto en el "?" mientras haya una recorrida para ver y la ayuda nunca se haya abierto acá.
  const helpDot = useHelpDot();

  const [expanded, setExpanded] = useState<Set<string>>(readExpanded);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; position: MenuPosition; anchor: HTMLElement } | null>(null);
  const [account, setAccount] = useState<MenuPosition | null>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  // "Google Drive" (menú de la cuenta). Al volver de conectar Drive, Google deja `?drive=<resultado>` en la
  // dirección: el diálogo se abre con el resultado.
  const [drive, setDrive] = useState<{ result: string | null } | null>(() => {
    const result = new URLSearchParams(location.search).get('drive');
    return result === null ? null : { result };
  });
  useEffect(() => {
    if (drive?.result && new URLSearchParams(location.search).has('drive')) {
      // La vieja prueba de media (`/media-test`, adonde vuelve un portero viejo) ya no existe: queda `/`.
      const path = location.pathname === '/media-test' ? '/' : location.pathname;
      history.replaceState(history.state, '', path + location.hash);
    }
  }, [drive]);
  const [moving, setMoving] = useState<string | null>(null);
  const [formatting, setFormatting] = useState<string | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  const [members, setMembers] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; zone: DropZone } | null>(null);
  // La fila con el foco del teclado mientras el foco está en el árbol (fuera del árbol, `null`).
  const [focusId, setFocusId] = useState<string | null>(null);
  const rowEls = useRef(new Map<string, HTMLDivElement>());

  // Abrir una página desde el árbol sin clic (flechas, plegar una madre de la abierta). Siempre la última
  // versión, para el temporizador de `opener`.
  const browse = useRef<(id: string) => void>(() => undefined);
  browse.current = (id: string) => {
    // Contra la página abierta, no contra la dirección: `/p/<id>/` (con barra al final) es la misma página.
    if (id === activeId || !tree.get(id) || tree.isTrashed(id)) return;
    onBrowse?.(id);
    navigate(pagePath(id));
  };
  const [opener] = useState(() => createOpenScheduler((id) => browse.current(id)));
  useEffect(() => () => opener.cancel(), [opener]);
  // Si la ruta cambia por otro camino (un link, la búsqueda, un clic, la papelera), lo que las flechas iban a
  // abrir ya no va. Lo mismo si el foco sale del árbol (el `onBlur` del árbol).
  useEffect(() => opener.cancel(), [route.name, activeId, opener]);

  useEffect(() => {
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]));
    } catch {
      // Recordar qué está abierto es solo una comodidad.
    }
  }, [expanded]);

  // La página abierta siempre se ve en el árbol: sus madres se abren cuando cambia la página abierta (un link,
  // la búsqueda, al cargar) o cuando el árbol llega o cambia (otro dispositivo). No cuando cambia `expanded`:
  // plegar una madre de la página abierta tiene que poder (`collapse` pasa la página abierta a esa madre).
  const revision = tree.getRevision();
  useEffect(() => {
    if (!activeId) return;
    const ids = tree.ancestors(activeId).map((p) => p.id);
    setExpanded((prev) => (ids.every((id) => prev.has(id)) ? prev : new Set([...prev, ...ids])));
  }, [activeId, tree, revision]);

  const expand = (id: string) => setExpanded((prev) => new Set(prev).add(id));
  /** Pliega `id`. Si la página abierta queda escondida adentro, la abierta pasa a ser `id` (pedido de Lega). */
  const collapse = (id: string) => {
    // Lo que las flechas iban a abrir no se pierde: se abre ya (o `id`, si quedaba escondido adentro).
    const pending = opener.pending();
    opener.cancel();
    setExpanded((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (activeId && tree.isDescendant(activeId, id)) browse.current(id);
    else if (pending) browse.current(tree.isDescendant(pending, id) ? id : pending);
  };
  const focusRow = (id: string, preventScroll = false) => rowEls.current.get(id)?.focus({ preventScroll });

  async function newPage(parentId: string | null) {
    const id = await tree.create(parentId, '', projectId);
    if (parentId) expand(parentId);
    navigate(pagePath(id));
  }

  function canDrop(targetId: string): boolean {
    return !!dragging && dragging !== targetId && !tree.isDescendant(targetId, dragging);
  }

  /** Dónde queda la página si se suelta ahí: adentro de `page`, o al lado (con su padre). */
  function dropParent(page: PageRow, zone: DropZone): string | null {
    if (zone === 'inside') return page.id;
    return page.parent_id && tree.get(page.parent_id) ? page.parent_id : null;
  }

  /** Soltar ahí pide 4 en la página que se mueve y en el destino. */
  function allowedZone(page: PageRow, zone: DropZone): boolean {
    return !!dragging && perms.canMove(dragging, dropParent(page, zone));
  }

  function onDragOver(e: DragEvent, page: PageRow) {
    if (!canDrop(page.id)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    const zone: DropZone = y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside';
    if (!allowedZone(page, zone)) {
      if (drop?.id === page.id) setDrop(null);
      return;
    }
    e.preventDefault();
    if (drop?.id !== page.id || drop.zone !== zone) setDrop({ id: page.id, zone });
  }

  async function onDrop(e: DragEvent, page: PageRow) {
    e.preventDefault();
    const id = dragging;
    const zone = drop?.zone;
    setDragging(null);
    setDrop(null);
    if (!id || !zone || !canDrop(page.id) || !perms.canMove(id, dropParent(page, zone))) return;
    if (zone === 'inside') {
      await tree.move(id, page.id);
      expand(page.id);
    } else {
      const parentId = page.parent_id && tree.get(page.parent_id) ? page.parent_id : null;
      await tree.move(id, parentId, zone === 'before' ? { before: page.id } : { after: page.id });
    }
  }

  /** Las flechas, Inicio, Fin, Enter y Espacio en una fila (patrón de árbol de WAI-ARIA, treeNav.ts). */
  function onRowKey(e: KeyboardEvent<HTMLDivElement>, id: string) {
    // Solo con el foco en la fila misma (no en el renombrado ni en sus botones) y la tecla sola.
    if (e.target !== e.currentTarget || !isTreeKey(e.key) || !isPlainKey(e.nativeEvent)) return;
    e.preventDefault();
    const action = treeKeyAction(rows, id, e.key);
    if (action.type === 'go') {
      // El foco pasa ya; la página se abre al instante o, con la tecla apretada, al frenar (treeNav.ts).
      focusRow(action.id);
      opener.request(action.id, e.repeat);
    } else if (action.type === 'open') {
      opener.cancel();
      navigate(pagePath(action.id));
    } else if (action.type === 'expand') {
      expand(action.id);
    } else if (action.type === 'collapse') {
      collapse(action.id);
    }
  }

  /** Una lista de hermanas: si corresponde, con los títulos divididos y la columna del código alineada. */
  function renderList(parentId: string | null, pages: PageRow[], depth: number, role: 'tree' | 'group') {
    const split = splitEnabled(tree, parentId) ? splitSiblings(pages) : null;
    const style = split ? ({ '--code-w': `${split.width}ch` } as CSSProperties) : undefined;
    return (
      <ul
        className={role === 'tree' ? 'tree' : undefined}
        data-tour={role === 'tree' ? 'pages' : undefined}
        role={role}
        aria-label={role === 'tree' ? tr('sidebar.tree') : undefined}
        style={style}
        onBlur={
          role === 'tree'
            ? (e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                // El foco salió del árbol: al volver con Tab, entra por la página abierta, y lo que las
                // flechas iban a abrir ya no va (la página no cambia bajo el cursor).
                setFocusId(null);
                opener.cancel();
              }
            : undefined
        }
      >
        {pages.map((page) => renderItem(page, depth, split?.titles.get(page.id) ?? null))}
      </ul>
    );
  }

  function renderItem(page: PageRow, depth: number, split: SplitTitle | null) {
    const children = tree.children(page.id);
    const open = expanded.has(page.id);
    const dropClass = drop?.id === page.id ? ` drop-${drop.zone}` : '';
    // Una sola fila del árbol en el orden de Tab (con sus botones): la del foco o, si no, la abierta.
    const tabIndex = page.id === tabStop ? 0 : -1;
    return (
      <li key={page.id} role="none">
        <div
          ref={(el) => {
            if (el) rowEls.current.set(page.id, el);
            else rowEls.current.delete(page.id);
          }}
          role="treeitem"
          aria-level={depth + 1}
          aria-expanded={children.length ? open : undefined}
          aria-label={page.title || tr('common.untitled')}
          className={`tree-row${children.length ? ' parent' : ''}${page.id === activeId ? ' active' : ''}${menu?.id === page.id ? ' menu-open' : ''}${renaming === page.id ? ' renaming' : ''}${dropClass}`}
          style={{ paddingLeft: 4 + depth * 18 }}
          data-tip={split ? page.title : undefined}
          data-tip-plain
          draggable={renaming !== page.id && perms.canManagePage(page.id)}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', page.id);
            setDragging(page.id);
          }}
          onDragEnd={() => {
            setDragging(null);
            setDrop(null);
          }}
          onDragOver={(e) => onDragOver(e, page)}
          onDragLeave={() => drop?.id === page.id && setDrop(null)}
          onDrop={(e) => onDrop(e, page)}
          onClick={(e) => {
            opener.cancel();
            // El foco queda en la fila (Safari no lo da solo): las flechas siguen desde acá.
            e.currentTarget.focus({ preventScroll: true });
            navigate(pagePath(page.id));
          }}
          onFocus={() => setFocusId(page.id)}
          tabIndex={tabIndex}
          aria-current={page.id === activeId ? 'page' : undefined}
          onKeyDown={(e) => onRowKey(e, page.id)}
        >
          {children.length > 0 ? (
            <button
              className="toggle"
              aria-label={open ? tr('sidebar.collapse') : tr('sidebar.expand')}
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                focusRow(page.id, true);
                if (open) collapse(page.id);
                else expand(page.id);
              }}
            >
              {open ? <CollapseIcon size={14} /> : <ExpandIcon size={14} />}
            </button>
          ) : (
            <span className="toggle leaf" aria-hidden="true" />
          )}
          {renaming === page.id ? (
            <RenameInput
              initial={page.title}
              onDone={(title, byKey) => {
                setRenaming(null);
                if (title !== null) void tree.rename(page.id, title);
                // Con Enter o Esc el foco vuelve a la fila; si se fue con un clic a otro lado, no se lo saca.
                if (byKey) focusRow(page.id, true);
              }}
            />
          ) : split ? (
            <span className="label">
              <span className="code">{split.code}</span>
              <span className="title">{split.name}</span>
            </span>
          ) : (
            <span className="label">
              <span
                className={`title${page.title ? '' : ' untitled'}`}
                data-tip={page.title || undefined}
                data-tip-plain
                data-tip-overflow
              >
                {page.title || tr('common.untitled')}
              </span>
            </span>
          )}
          <MentionTreeDot pageId={page.id} collapsed={children.length > 0 && !open} />
          <OfflineBadge kind="page" id={page.id} />
          <span className="row-actions">
            <button
              aria-label={tr('sidebar.moreActions')}
              tabIndex={tabIndex}
              onClick={(e) => {
                e.stopPropagation();
                const anchor = e.currentTarget;
                setMenu(menu?.id === page.id ? null : { id: page.id, position: menuBelow(anchor), anchor });
              }}
            >
              <MoreIcon size={16} />
            </button>
            {perms.canManagePage(page.id) && (
              <button
                aria-label={tr('sidebar.addInside')}
                data-tip={tr('sidebar.addInside')}
                tabIndex={tabIndex}
                onClick={(e) => {
                  e.stopPropagation();
                  void newPage(page.id);
                }}
              >
                <PlusIcon size={16} />
              </button>
            )}
          </span>
        </div>
        {open && children.length > 0 && renderList(page.id, children, depth + 1, 'group')}
      </li>
    );
  }

  const roots = tree.roots(projectId);
  // Las filas que se ven, en orden: lo que recorren las flechas.
  const rows = visibleRows(roots, (id) => tree.children(id), expanded);
  const visible = new Set(rows.map((r) => r.id));
  const tabStop =
    focusId && visible.has(focusId) ? focusId : activeId && visible.has(activeId) ? activeId : (rows[0]?.id ?? null);

  // Si la fila con el foco desaparece (otra persona la mandó a la papelera o la movió adentro de una cerrada),
  // el foco caería al documento y las flechas dejarían de responder: pasa a la fila visible que le seguía (o
  // a la anterior, si era la última). Solo si el foco estaba en el árbol y no se fue a otro lado.
  const shownBefore = useRef<string[]>([]);
  useEffect(() => {
    const before = shownBefore.current;
    shownBefore.current = rows.map((r) => r.id);
    if (!focusId || visible.has(focusId)) return;
    const at = before.indexOf(focusId);
    const lost = !document.activeElement || document.activeElement === document.body;
    const neighbor =
      at < 0 || !lost
        ? undefined
        : (before.slice(at + 1).find((id) => visible.has(id)) ?? before.slice(0, at).reverse().find((id) => visible.has(id)));
    if (neighbor) focusRow(neighbor, true);
    else setFocusId(null);
  });
  const trashCount = tree.trashed(projectId).length;
  // Con un link público: sin proyectos, papelera ni cuenta (Docs/Doc_Link_Publico.md, 3.5).
  const linkMode = useLinkMode();
  const canCreateRoot = perms.canCreateIn(null, projectId);

  return (
    <nav className="sidebar" aria-label={tr('sidebar.pages')}>
      {linkMode ? <LinkHeader /> : <ProjectSwitcher />}
      <SyncBadge />
      <OfflineLine />

      <div className="section-title" data-tour="pages">
        <span className="mono-label">{tr('sidebar.pages')}</span>
        <span className="section-actions">
          {/* Buscar en el proyecto (Docs/Doc_Buscar.md, sección 7): a la izquierda del "+", también para quien
              no puede crear páginas. */}
          <button
            className="search-button"
            aria-label={tr('sidebar.search', { shortcut: shortcutLabel('search') })}
            aria-haspopup="dialog"
            aria-expanded={search.isOpen()}
            data-tip={tr('sidebar.search', { shortcut: shortcutLabel('search') })}
            onClick={() => search.setOpen(true)}
          >
            <SearchIcon size={16} />
          </button>
          {canCreateRoot && (
            <button aria-label={tr('common.newPage')} data-tip={tr('common.newPage')} onClick={() => void newPage(null)}>
              <PlusIcon size={16} />
            </button>
          )}
        </span>
      </div>
      {renderList(null, roots, 0, 'tree')}
      {roots.length === 0 && canCreateRoot && (
        <button className="empty-new" onClick={() => void newPage(null)}>
          <PlusIcon size={16} /> {tr('common.newPage')}
        </button>
      )}

      <div className="sidebar-spacer" />
      <div className="sidebar-footer">
        <div className="footer-row">
          {linkMode ? (
            <span className="footer-item" />
          ) : (
            <button
              className={`footer-item${route.name === 'trash' ? ' active' : ''}`}
              onClick={() => navigate('/trash')}
            >
              <TrashIcon size={17} /> {tr('trash.title')}
              {trashCount > 0 ? ` (${trashCount})` : ''}
            </button>
          )}
          {/* La ayuda (Docs/Doc_Tutorial.md, sección 5): sin tooltip, el ícono ya lo dice (D-15). */}
          <button
            className={`help-button${helpDot ? ' has-dot' : ''}`}
            data-tour="help"
            aria-label={tr('help.open')}
            onClick={(e) => openHelp(null, e.currentTarget)}
          >
            <HelpIcon size={18} />
          </button>
        </div>
        {!linkMode && <button
          ref={accountButton}
          className="account-button"
          aria-haspopup="dialog"
          aria-expanded={!!account}
          onClick={(e) => {
            if (account) return setAccount(null);
            const r = e.currentTarget.getBoundingClientRect();
            setAccount({ bottom: window.innerHeight - r.top + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 308)) });
          }}
        >
          <span className="avatar">{user.email.charAt(0) || '?'}</span>
          <span className="email">{user.email}</span>
          <AccountIcon size={16} />
        </button>}
      </div>

      {account && (
        <AccountMenu
          position={account}
          anchor={accountButton.current}
          onClose={() => setAccount(null)}
          onDrive={() => setDrive({ result: null })}
          onMembers={() => setMembers(true)}
        />
      )}
      {members &&
        createPortal(
          <Part onClose={() => setMembers(false)}>
            <MembersDialog onClose={() => setMembers(false)} />
          </Part>,
          document.body,
        )}
      {sharing &&
        createPortal(
          <Part onClose={() => setSharing(null)}>
            <ShareDialog target={{ pageId: sharing }} onClose={() => setSharing(null)} />
          </Part>,
          document.body,
        )}
      {drive &&
        createPortal(
          <Part onClose={() => setDrive(null)}>
            <DriveDialogHost result={drive.result} onClose={() => setDrive(null)} />
          </Part>,
          document.body,
        )}
      {menu && (
        <PageMenu
          pageId={menu.id}
          position={menu.position}
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          onNewChild={() => void newPage(menu.id)}
          onRename={() => setRenaming(menu.id)}
          onMove={() => setMoving(menu.id)}
          onFormat={() => setFormatting(menu.id)}
          onShare={perms.canSharePage(menu.id) ? () => setSharing(menu.id) : undefined}
          onTrash={async () => {
            const id = menu.id;
            const wasOpen = !!activeId && (activeId === id || tree.isDescendant(activeId, id));
            // Primero se manda a la papelera y después se sale: si no, el inicio vuelve a la última página.
            await tree.trash(id);
            if (wasOpen) navigate('/');
          }}
        />
      )}
      {moving && <MoveDialog pageId={moving} onClose={() => setMoving(null)} />}
      {formatting && <PageFormatDialog pageId={formatting} onClose={() => setFormatting(null)} />}
    </nav>
  );
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (title: string | null, byKey: boolean) => void }) {
  const done = useRef(false);
  const finish = (value: string | null, byKey = false) => {
    if (done.current) return;
    done.current = true;
    onDone(value, byKey);
  };
  return (
    <input
      className="rename"
      autoFocus
      defaultValue={initial}
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => finish(e.currentTarget.value.trim())}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') finish(e.currentTarget.value.trim(), true);
        if (e.key === 'Escape') finish(null, true);
      }}
    />
  );
}
