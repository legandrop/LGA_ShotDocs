import { useEffect, useMemo, useState } from 'react';
import { useTree } from '../services';
import type { PageRow } from '../sync/types';

export function MoveDialog({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const tree = useTree();
  const [filter, setFilter] = useState('');
  const page = tree.get(pageId);

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
  const visible = needle ? options.filter((o) => o.page.title.toLowerCase().includes(needle)) : options;

  const moveTo = async (parentId: string | null) => {
    await tree.move(pageId, parentId);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Move page" onClick={(e) => e.stopPropagation()}>
        <h2>Move “{page?.title || 'Untitled'}”</h2>
        <input autoFocus placeholder="Search pages…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <ul className="move-list">
          {!needle && page?.parent_id && (
            <li>
              <button onClick={() => void moveTo(null)}>Top level</button>
            </li>
          )}
          {visible.map(({ page: p, depth }) => (
            <li key={p.id}>
              <button
                style={{ paddingLeft: 10 + (needle ? 0 : depth * 14) }}
                disabled={p.id === page?.parent_id}
                onClick={() => void moveTo(p.id)}
              >
                {p.title || 'Untitled'}
              </button>
            </li>
          ))}
          {visible.length === 0 && <li className="muted">No pages with that name.</li>}
        </ul>
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
