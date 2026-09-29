import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { navigate, pagePath, useRoute } from '../router';
import { useServices, useTree } from '../services';
import { supabase } from '../supabase';
import type { PageRow } from '../sync/types';
import { DocIcon, MoreIcon, PlusIcon, TrashIcon } from './icons';
import { MoveDialog } from './MoveDialog';
import { SyncBadge } from './SyncBadge';
import { usePendingCount } from './usePendingCount';

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
  const { user, docs } = useServices();
  const route = useRoute();
  const activeId = route.name === 'page' ? route.id : null;
  const pending = usePendingCount();

  const [expanded, setExpanded] = useState<Set<string>>(readExpanded);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; top: number; left: number } | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
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
    const id = await tree.create(parentId);
    if (parentId) expand(parentId);
    navigate(pagePath(id));
  }

  function canDrop(targetId: string): boolean {
    return !!dragging && dragging !== targetId && !tree.isDescendant(targetId, dragging);
  }

  function onDragOver(e: DragEvent, page: PageRow) {
    if (!canDrop(page.id)) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    const zone: DropZone = y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside';
    if (drop?.id !== page.id || drop.zone !== zone) setDrop({ id: page.id, zone });
  }

  async function onDrop(e: DragEvent, page: PageRow) {
    e.preventDefault();
    const id = dragging;
    const zone = drop?.zone;
    setDragging(null);
    setDrop(null);
    if (!id || !zone || !canDrop(page.id)) return;
    if (zone === 'inside') {
      await tree.move(id, page.id);
      expand(page.id);
    } else {
      const parentId = page.parent_id && tree.get(page.parent_id) ? page.parent_id : null;
      await tree.move(id, parentId, zone === 'before' ? { before: page.id } : { after: page.id });
    }
  }

  function renderItem(page: PageRow, depth: number) {
    const children = tree.children(page.id);
    const open = expanded.has(page.id);
    const dropClass = drop?.id === page.id ? ` drop-${drop.zone}` : '';
    return (
      <li key={page.id} role="treeitem" aria-expanded={children.length ? open : undefined}>
        <div
          className={`tree-row${page.id === activeId ? ' active' : ''}${dropClass}`}
          style={{ paddingLeft: 6 + depth * 14 }}
          draggable={renaming !== page.id}
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
          <button
            className="toggle"
            aria-label={open ? 'Collapse' : 'Expand'}
            onClick={(e) => {
              e.stopPropagation();
              toggle(page.id);
            }}
          >
            {children.length > 0 ? <span className={`chevron${open ? ' open' : ''}`} /> : <DocIcon />}
          </button>
          {renaming === page.id ? (
            <RenameInput
              initial={page.title}
              onDone={(title) => {
                setRenaming(null);
                if (title !== null) void tree.rename(page.id, title);
              }}
            />
          ) : (
            <span className={`title${page.title ? '' : ' untitled'}`}>{page.title || 'Untitled'}</span>
          )}
          <span className="row-actions">
            <button
              aria-label="More actions"
              title="More actions"
              onClick={(e) => {
                e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                setMenu({ id: page.id, top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 220) });
              }}
            >
              <MoreIcon />
            </button>
            <button
              aria-label="Add a page inside"
              title="Add a page inside"
              onClick={(e) => {
                e.stopPropagation();
                void newPage(page.id);
              }}
            >
              <PlusIcon />
            </button>
          </span>
        </div>
        {open && children.length > 0 && (
          <ul role="group">{children.map((child) => renderItem(child, depth + 1))}</ul>
        )}
      </li>
    );
  }

  const roots = tree.children(null);
  const trashCount = tree.trashed().length;

  async function signOut() {
    if (docs.hasUnsavedEdits()) {
      alert('Some of your latest edits are not saved on this device yet. Wait until the red warning goes away, then sign out.');
      return;
    }
    if (
      pending > 0 &&
      !confirm(
        `${pending} changes are not uploaded yet. They stay saved on this device and upload the next time you sign in with this account. Sign out anyway?`,
      )
    ) {
      return;
    }
    await supabase!.auth.signOut({ scope: 'local' });
  }

  return (
    <nav className="sidebar" aria-label="Pages">
      <div className="sidebar-header">
        <img src="/icons/icon.svg" alt="" width={22} height={22} />
        <span className="brand">Shot Docs</span>
      </div>
      <SyncBadge />

      <div className="section-title">
        <span>Pages</span>
        <button aria-label="New page" title="New page" onClick={() => void newPage(null)}>
          <PlusIcon />
        </button>
      </div>
      <ul className="tree" role="tree">
        {roots.map((page) => renderItem(page, 0))}
      </ul>
      {roots.length === 0 && (
        <button className="empty-new" onClick={() => void newPage(null)}>
          <PlusIcon /> New page
        </button>
      )}

      <div className="sidebar-footer">
        <button
          className={`footer-item${route.name === 'trash' ? ' active' : ''}`}
          onClick={() => navigate('/trash')}
        >
          <TrashIcon /> Trash{trashCount > 0 ? ` (${trashCount})` : ''}
        </button>
        <div className="account">
          <span className="email" title={user.email}>
            {user.email}
          </span>
          <button className="link" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </div>

      {menu && (
        <PageMenu
          {...menu}
          onClose={() => setMenu(null)}
          onNewChild={() => void newPage(menu.id)}
          onRename={() => setRenaming(menu.id)}
          onMove={() => setMoving(menu.id)}
          onTrash={() => {
            void tree.trash(menu.id);
            if (activeId && (activeId === menu.id || tree.isDescendant(activeId, menu.id))) navigate('/');
          }}
        />
      )}
      {moving && <MoveDialog pageId={moving} onClose={() => setMoving(null)} />}
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

function PageMenu(props: {
  top: number;
  left: number;
  onClose: () => void;
  onNewChild: () => void;
  onRename: () => void;
  onMove: () => void;
  onTrash: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) {
        props.onClose();
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [props]);

  const item = (label: string, action: () => void, danger = false) => (
    <button
      role="menuitem"
      className={danger ? 'danger' : undefined}
      onClick={() => {
        props.onClose();
        action();
      }}
    >
      {label}
    </button>
  );

  return (
    <div ref={ref} className="menu" role="menu" style={{ top: props.top, left: props.left }}>
      {item('New page inside', props.onNewChild)}
      {item('Rename', props.onRename)}
      {item('Move to…', props.onMove)}
      {item('Move to trash', props.onTrash, true)}
    </div>
  );
}
