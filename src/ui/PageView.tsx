import { useEffect, useRef, useState } from 'react';
import { useSyncStatus, useTree } from '../services';
import { PageEditor } from './PageEditor';

export function PageView({ id }: { id: string }) {
  const tree = useTree();
  const status = useSyncStatus();
  const page = tree.get(id);

  useEffect(() => {
    document.title = page ? `${page.title || 'Untitled'} · Shot Docs` : 'LGA Shot Docs';
  }, [page]);

  if (!page) {
    return (
      <article className="page narrow">
        <p className="muted">
          {status.lastSyncAt === null ? 'Looking for the page…' : 'This page does not exist or you do not have access to it.'}
        </p>
      </article>
    );
  }

  const trashed = tree.isTrashed(id);
  return (
    <article className="page">
      {trashed && (
        <div className="banner">
          This page is in the trash.
          {page.deleted_at && (
            <button className="link" onClick={() => void tree.restore(id)}>
              Restore
            </button>
          )}
        </div>
      )}
      <TitleInput id={id} title={page.title} />
      <PageEditor pageId={id} />
    </article>
  );
}

function TitleInput({ id, title }: { id: string; title: string }) {
  const tree = useTree();
  const [value, setValue] = useState(title);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Si el título cambia desde otro lado (otro dispositivo, la barra lateral), se muestra salvo que se
  // esté escribiendo acá.
  useEffect(() => {
    if (!focused.current) setValue(title);
  }, [title]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const commit = (next: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    void tree.rename(id, next.replace(/\s+/g, ' ').trim());
  };

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void tree.rename(id, (ref.current?.value ?? '').replace(/\s+/g, ' ').trim());
      }
    },
    [tree, id],
  );

  return (
    <textarea
      ref={ref}
      className="page-title"
      rows={1}
      value={value}
      placeholder="Untitled"
      aria-label="Title"
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        commit(value);
      }}
      onChange={(e) => {
        setValue(e.target.value);
        if (timer.current) clearTimeout(timer.current);
        const next = e.target.value;
        timer.current = setTimeout(() => commit(next), 600);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit(value);
          window.dispatchEvent(new Event('shotdocs:focus-editor'));
        }
      }}
    />
  );
}
