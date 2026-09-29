import { navigate, pagePath } from '../router';
import { useTree } from '../services';

export function TrashView() {
  const tree = useTree();
  const items = tree.trashed();
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
              <span className="muted">{new Date(p.deleted_at!).toLocaleString()}</span>
              <button onClick={() => void tree.restore(p.id)}>Restore</button>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
