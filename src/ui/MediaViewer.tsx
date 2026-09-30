import { useEffect, useState } from 'react';
import { useServices } from '../services';
import type { MediaKind } from '../media/probe';
import { MEDIA_SCHEME } from '../media/queue';

// Visor simple de una foto o un video del Drive (`sdmedia://`), hasta que llegue el carrete (paso 7):
// el original si está en este dispositivo (anda sin red); si no, el archivo entero con un pase del
// portero. Mientras carga, la miniatura.

type View =
  | { state: 'loading'; poster: string | null }
  | { state: 'ready'; poster: string | null; src: string; kind: MediaKind | null; name: string; remote: boolean }
  | { state: 'error'; poster: string | null; message: string };

export function MediaViewer({ fileId, onClose }: { fileId: string; onClose: () => void }) {
  const { media } = useServices();
  const [view, setView] = useState<View>({ state: 'loading', poster: null });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let live = true;
    let objectUrl: string | null = null;
    void (async () => {
      const poster = await media.resolve(MEDIA_SCHEME + fileId);
      if (!live) return;
      setView({ state: 'loading', poster });
      try {
        const source = await media.source(fileId);
        if (!live) return;
        if (source.original) {
          objectUrl = URL.createObjectURL(source.original);
          setView({ state: 'ready', poster, src: objectUrl, kind: source.kind, name: source.name, remote: false });
          return;
        }
        const src = await media.pass(fileId);
        if (live) setView({ state: 'ready', poster, src, kind: source.kind, name: source.name, remote: true });
      } catch (err) {
        if (live) setView({ state: 'error', poster, message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [media, fileId]);

  // HEIC en Chrome, HEVC o ProRes en un navegador que no los decodifica: el archivo está a salvo igual.
  const cannotShow = () =>
    setView((v) => ({
      state: 'error',
      poster: v.poster,
      message: 'This browser cannot show this file. Nothing is lost: try it on another device.',
    }));

  return (
    <div className="modal-backdrop media-viewer-backdrop" onClick={onClose}>
      <div className="modal media-viewer" role="dialog" aria-modal="true" aria-label="Photo or video" onClick={(e) => e.stopPropagation()}>
        {view.state === 'ready' ? (
          view.kind === 'video' ? (
            <video src={view.src} poster={view.poster ?? undefined} controls autoPlay playsInline onError={cannotShow} />
          ) : (
            <img src={view.src} alt={view.name} onError={cannotShow} />
          )
        ) : (
          view.poster && <img src={view.poster} alt="" className="media-viewer-poster" />
        )}
        {view.state === 'loading' && <p className="muted">Loading…</p>}
        {view.state === 'error' && <p className="error">{view.message}</p>}
        <div className="row">
          <span className="media-viewer-name" data-tip={view.state === 'ready' ? view.name : undefined} data-tip-plain data-tip-overflow>
            {view.state === 'ready' ? view.name : ''}
          </span>
          <span className="media-viewer-actions">
            {view.state === 'ready' && view.remote && (
              <a className="link" href={view.src} target="_blank" rel="noreferrer">
                Open in a new tab
              </a>
            )}
            <button className="link" autoFocus onClick={onClose}>
              Close
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
