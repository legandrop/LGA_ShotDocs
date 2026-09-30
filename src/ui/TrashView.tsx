import { navigate, pagePath } from '../router';
import { usePermissions, useTree } from '../services';
import { RestoreIcon } from './icons';
import { useCurrentProject } from './project';

export function TrashView() {
  const tree = useTree();
  const perms = usePermissions();
  const items = tree.trashed(useCurrentProject());
  return (
    <article className="page narrow">
      <h1 className="page-heading">Trash</h1>
      <p className="muted">
        Nothing here is ever deleted from the app. Restoring a page brings it back with everything that was inside
        it.
      </p>
      {items.length === 0 ? (
        <p className="muted">The trash is empty.</p>
      ) : (
        <ul className="trash-list">
          {items.map((p) => (
            <li key={p.id}>
              <button className="link title" onClick={() => navigate(pagePath(p.id))}>
                {p.title || 'Untitled'}
              </button>
              <span className="when">{new Date(p.deleted_at!).toLocaleString()}</span>
              {perms.canManagePage(p.id) && (
                <button onClick={() => void tree.restore(p.id)}>
                  <RestoreIcon size={16} /> Restore
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
