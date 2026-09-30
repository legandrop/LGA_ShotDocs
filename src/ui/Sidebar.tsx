import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { navigate, pagePath, useRoute } from '../router';
import { usePermissions, useServices, useTree } from '../services';
import type { PageRow } from '../sync/types';
import { AccountIcon, CollapseIcon, ExpandIcon, MoreIcon, PlusIcon, TrashIcon } from './icons';
import { AccountMenu, menuBelow, PageMenu, type MenuPosition } from './menus';
import { DriveDialogHost, MembersDialog, ShareDialog } from './lazyDialogs';
import { Part } from './lazyPart';
import { MoveDialog } from './MoveDialog';
import { PageFormatDialog } from './PageFormatDialog';
import { useCurrentProject } from './project';
import { ProjectSwitcher } from './ProjectSwitcher';
import { SyncBadge } from './SyncBadge';
import { splitEnabled, splitSiblings, type SplitTitle } from './titles';

const EXPANDED_KEY = 'shotdocs-expanded';

function readExpanded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

type DropZone = 'before' | 'inside' | 'after';

export function Sidebar() {
  const tree = useTree();
  const perms = usePermissions();
  const { user } = useServices();
  const route = useRoute();
  const activeId = route.name === 'page' ? route.id : null;
  const projectId = useCurrentProject();

  const [expanded, setExpanded] = useState<Set<string>>(readExpanded);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; position: MenuPosition; anchor: HTMLElement } | null>(null);
  const [account, setAccount] = useState<MenuPosition | null>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  // "Google Drive" (menú de la cuenta). Al volver de conectar Drive, Google deja `?drive=<resultado>` en la
  // dirección (salvo en Media test, que lo muestra ella): el diálogo se abre con el resultado.
  const [drive, setDrive] = useState<{ result: string | null } | null>(() => {
    const result = location.pathname === '/media-test' ? null : new URLSearchParams(location.search).get('drive');
    return result === null ? null : { result };
  });
  useEffect(() => {
    if (drive?.result && new URLSearchParams(location.search).has('drive')) {
      history.replaceState(history.state, '', location.pathname + location.hash);
    }
  }, [drive]);
  const [moving, setMoving] = useState<string | null>(null);
  const [formatting, setFormatting] = useState<string | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  const [members, setMembers] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; zone: DropZone } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]));
    } catch {
      // Recordar qué está abierto es solo una comodidad.
    }
  }, [expanded]);

  // La página abierta siempre se ve en el árbol, también cuando el árbol llega después (otro dispositivo).
  const revision = tree.getRevision();
  useEffect(() => {
    if (!activeId) return;
    const missing = tree.ancestors(activeId).filter((p) => !expanded.has(p.id));
    if (missing.length) setExpanded((prev) => new Set([...prev, ...missing.map((p) => p.id)]));
  }, [activeId, tree, revision, expanded]);

  const expand = (id: string) => setExpanded((prev) => new Set(prev).add(id));
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

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

  /** Una lista de hermanas: si corresponde, con los títulos divididos y la columna del código alineada. */
  function renderList(parentId: string | null, pages: PageRow[], depth: number, role?: 'tree' | 'group') {
    const split = splitEnabled(tree, parentId) ? splitSiblings(pages) : null;
    const style = split ? ({ '--code-w': `${split.width}ch` } as CSSProperties) : undefined;
    return (
      <ul className={role === 'tree' ? 'tree' : undefined} role={role} style={style}>
        {pages.map((page) => renderItem(page, depth, split?.titles.get(page.id) ?? null))}
      </ul>
    );
  }

  function renderItem(page: PageRow, depth: number, split: SplitTitle | null) {
    const children = tree.children(page.id);
    const open = expanded.has(page.id);
    const dropClass = drop?.id === page.id ? ` drop-${drop.zone}` : '';
    return (
      <li key={page.id} role="treeitem" aria-expanded={children.length ? open : undefined}>
        <div
          className={`tree-row${children.length ? ' parent' : ''}${page.id === activeId ? ' active' : ''}${dropClass}`}
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
          onClick={() => navigate(pagePath(page.id))}
          tabIndex={0}
          aria-current={page.id === activeId ? 'page' : undefined}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter') navigate(pagePath(page.id));
            if (e.key === 'ArrowRight' && children.length && !open) toggle(page.id);
            if (e.key === 'ArrowLeft' && open) toggle(page.id);
          }}
        >
          {children.length > 0 ? (
            <button
              className="toggle"
              aria-label={open ? 'Collapse' : 'Expand'}
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                toggle(page.id);
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
              onDone={(title) => {
                setRenaming(null);
                if (title !== null) void tree.rename(page.id, title);
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
                {page.title || 'Untitled'}
              </span>
            </span>
          )}
          <span className="row-actions">
            <button
              aria-label="More actions"
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
                aria-label="Add a page inside"
                data-tip="Add a page inside"
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
  const trashCount = tree.trashed(projectId).length;
  const canCreateRoot = perms.canCreateIn(null, projectId);

  return (
    <nav className="sidebar" aria-label="Pages">
      <ProjectSwitcher />
      <SyncBadge />

      <div className="section-title">
        <span className="mono-label">Pages</span>
        {canCreateRoot && (
          <button aria-label="New page" data-tip="New page" onClick={() => void newPage(null)}>
            <PlusIcon size={16} />
          </button>
        )}
      </div>
      {renderList(null, roots, 0, 'tree')}
      {roots.length === 0 && canCreateRoot && (
        <button className="empty-new" onClick={() => void newPage(null)}>
          <PlusIcon size={16} /> New page
        </button>
      )}

      <div className="sidebar-spacer" />
      <div className="sidebar-footer">
        <button
          className={`footer-item${route.name === 'trash' ? ' active' : ''}`}
          onClick={() => navigate('/trash')}
        >
          <TrashIcon size={17} /> Trash{trashCount > 0 ? ` (${trashCount})` : ''}
        </button>
        <button
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
        </button>
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
          <Part>
            <MembersDialog onClose={() => setMembers(false)} />
          </Part>,
          document.body,
        )}
      {sharing &&
        createPortal(
          <Part>
            <ShareDialog target={{ pageId: sharing }} onClose={() => setSharing(null)} />
          </Part>,
          document.body,
        )}
      {drive &&
        createPortal(
          <Part>
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

function RenameInput({ initial, onDone }: { initial: string; onDone: (title: string | null) => void }) {
  const done = useRef(false);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(value);
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
        if (e.key === 'Enter') finish(e.currentTarget.value.trim());
        if (e.key === 'Escape') finish(null);
      }}
    />
  );
}
