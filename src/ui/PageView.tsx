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

  const trashedAt = tree.trashedAncestor(id);
  return (
    <article className="page">
      {trashedAt && (
        <div className="banner">
          {trashedAt.id === id
            ? 'This page is in the trash.'
            : `This page is inside “${trashedAt.title || 'Untitled'}”, which is in the trash.`}
          <button className="link" onClick={() => void tree.restore(trashedAt.id)}>
            {trashedAt.id === id ? 'Restore' : `Restore “${trashedAt.title || 'Untitled'}”`}
          </button>
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

  // Un título escrito justo antes de cambiar de página o de cerrar la app no espera la pausa.
  useEffect(() => {
    const flushPending = () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      timer.current = null;
      void tree.rename(id, (ref.current?.value ?? '').replace(/\s+/g, ' ').trim());
    };
    const onHide = () => document.visibilityState === 'hidden' && flushPending();
    window.addEventListener('pagehide', flushPending);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', flushPending);
      document.removeEventListener('visibilitychange', onHide);
      flushPending();
    };
  }, [tree, id]);

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
        timer.current = setTimeout(() => commit(next), 300);
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
