import { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { usePermissions, useTree } from '../services';
import type { PageRow } from '../sync/types';

export function MoveDialog({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const tree = useTree();
  const perms = usePermissions();
  const [filter, setFilter] = useState('');
  const page = tree.get(pageId);
  const tr = useT();

  const options = useMemo(() => {
    const out: { page: PageRow; depth: number }[] = [];
    const walk = (parentId: string | null, depth: number) => {
      const list = parentId ? tree.children(parentId) : page ? tree.roots(page.workspace_id) : [];
      for (const p of list) {
        if (p.id === pageId) continue;
        out.push({ page: p, depth });
        walk(p.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [tree, pageId, page]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const needle = filter.trim().toLowerCase();
  // Mover pide "Edit & create pages" en la página y en el destino: los demás destinos no se ofrecen.
  const allowed = options.filter((o) => perms.canMove(pageId, o.page.id));
  const visible = needle ? allowed.filter((o) => o.page.title.toLowerCase().includes(needle)) : allowed;

  const moveTo = async (parentId: string | null) => {
    await tree.move(pageId, parentId);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={tr('move.label')} onClick={(e) => e.stopPropagation()}>
        <h2>{tr('move.title', { title: page?.title || tr('common.untitled') })}</h2>
        <input autoFocus placeholder={tr('move.search')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <ul className="move-list">
          {!needle && page?.parent_id && perms.canMove(pageId, null) && (
            <li>
              <button onClick={() => void moveTo(null)}>{tr('move.top')}</button>
            </li>
          )}
          {visible.map(({ page: p, depth }) => (
            <li key={p.id}>
              <button
                style={{ paddingLeft: 10 + (needle ? 0 : depth * 14) }}
                disabled={p.id === page?.parent_id}
                onClick={() => void moveTo(p.id)}
              >
                {p.title || tr('common.untitled')}
              </button>
            </li>
          ))}
          {visible.length === 0 && <li className="muted">{tr('move.noMatch')}</li>}
        </ul>
        <div className="modal-actions">
          <button onClick={onClose}>{tr('common.cancel')}</button>
        </div>
      </div>
    </div>
  );
}
