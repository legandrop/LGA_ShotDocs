import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import '../i18n/lazy/editor';
import type { RemovedWriting } from '../sync/removedWriting';
import { notify } from './notice';

/** Lo que el aviso necesita de `PageDocs` (B.16). */
export interface RemovedWritingSource {
  removedWriting(pageId: string): Promise<RemovedWriting[]>;
  dismissRemovedWriting(pageId: string): Promise<void>;
  subscribeRemovedWriting(fn: (pageId: string) => void): () => void;
}

/**
 * El aviso de la página cuando otro borró algo donde este dispositivo estaba escribiendo (roadmap B.16,
 * Docs/Doc_Sincronizacion.md, "La subida sin GC"): el borrado gana, como siempre, pero quien escribió se entera y
 * tiene su texto a mano para copiarlo. Queda hasta que lo cierra (está guardado en el dispositivo).
 */
export function RemovedWritingBanner({ docs, pageId }: { docs: RemovedWritingSource; pageId: string }) {
  const tr = useT();
  const [notes, setNotes] = useState<RemovedWriting[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void docs.removedWriting(pageId).then(
        (list) => {
          if (!cancelled) setNotes(list);
        },
        () => undefined,
      );
    load();
    const stop = docs.subscribeRemovedWriting((id) => {
      if (id === pageId) load();
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [docs, pageId]);

  if (notes.length === 0) return null;
  const text = notes.map((n) => n.text).join('\n\n');
  const copy = () => {
    if (!navigator.clipboard) {
      setOpen(true);
      notify(tr('removedWriting.copyFailed'));
      return;
    }
    void navigator.clipboard.writeText(text).then(
      () => notify(tr('common.copied')),
      () => {
        // Sin portapapeles (un navegador que no deja): el texto queda a la vista para copiarlo a mano.
        setOpen(true);
        notify(tr('removedWriting.copyFailed'));
      },
    );
  };
  const dismiss = () => {
    setNotes([]);
    setOpen(false);
    void docs.dismissRemovedWriting(pageId).catch(() => undefined);
  };
  return (
    <div className="banner removed-writing" role="status">
      <p>{tr('removedWriting.text')}</p>
      <div className="removed-writing-actions">
        <button className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? tr('removedWriting.hide') : tr('removedWriting.show')}
        </button>
        <button className="link" onClick={copy}>
          {tr('removedWriting.copy')}
        </button>
        <button className="link" onClick={dismiss}>
          {tr('removedWriting.dismiss')}
        </button>
      </div>
      {open && <pre className="removed-writing-text">{text}</pre>}
    </div>
  );
}
