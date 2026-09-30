import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import '../i18n/lazy/editor';
import { inlineType } from '../media/attachments';
import { formatSize } from '../media/fileTrash';
import { MEDIA_SCHEME } from '../media/queue';
import { useServices } from '../services';
import { downloadNow, openInNewTab, prepareAttachment, preparedFor } from './attachmentOpen';
import { notify } from './notice';

// La hoja de un adjunto (Docs/Doc_Adjuntos.md): en el teléfono (un toque) y con el mouse cuando la dirección
// todavía no estaba lista. Muestra la tarjeta y los botones *Open* (lo que el navegador sabe mostrar),
// *Download* y *Share* (en el teléfono, con el archivo del dispositivo: "Guardar en Archivos"). Cada botón es
// un gesto nuevo con la dirección ya preparada: Safari no deja abrir una pestaña después de esperar.

export function AttachmentSheet({ fileId, onClose }: { fileId: string; onClose: () => void }) {
  const { media } = useServices();
  const tr = useT();
  const info = media.fileInfo(fileId);
  const [card, setCard] = useState<string | null>(null);
  const [ready, setReady] = useState(() => preparedFor(fileId));
  const [shareFile, setShareFile] = useState<File | null>(null);

  useEffect(() => {
    let alive = true;
    void media.resolve(MEDIA_SCHEME + fileId).then((src) => alive && setCard(src));
    void prepareAttachment(media, fileId).then(() => alive && setReady(preparedFor(fileId)));
    // Compartir (en el teléfono): solo con el archivo del dispositivo y si el navegador lo acepta.
    void media
      .localOriginal?.(fileId)
      .then((blob) => {
        if (!alive || !blob || typeof navigator.canShare !== 'function') return;
        const file = new File([blob], info?.name || 'file', { type: 'application/octet-stream' });
        if (navigator.canShare({ files: [file] })) setShareFile(file);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [media, fileId, info?.name]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const canOpen = !!info && inlineType(info.mime);
  const meta = [info?.mime ? extensionOf(info.name) : '', info?.size ? formatSize(info.size) : ''].filter(Boolean).join(' · ');

  return (
    <div className="modal-backdrop attachment-backdrop" onClick={onClose}>
      <div className="modal attachment-sheet" role="dialog" aria-modal="true" aria-label={info?.name ?? tr('attachment.title')} onClick={(e) => e.stopPropagation()}>
        {/* La tarjeta ya dice el nombre y el tamaño; sin ella (todavía no se sabe nada), el nombre. */}
        {card ? (
          <img className="attachment-card" src={card} alt={[info?.name, meta].filter(Boolean).join(' · ')} />
        ) : (
          <p className="attachment-name">{info?.name ?? tr('attachment.title')}</p>
        )}
        <div className="modal-actions attachment-actions">
          {canOpen && (
            <button
              className="button primary"
              disabled={!ready?.open}
              onClick={() => {
                if (!ready?.open) return;
                openInNewTab(ready.open.url);
                onClose();
              }}
            >
              {ready?.open ? tr('attachment.open') : tr('attachment.preparing')}
            </button>
          )}
          <button
            className={canOpen ? 'button' : 'button primary'}
            disabled={!ready?.download}
            onClick={() => {
              if (!ready?.download) return;
              downloadNow(ready.download);
              onClose();
            }}
          >
            {ready?.download ? tr('attachment.download') : tr('attachment.preparing')}
          </button>
          {shareFile && (
            <button
              className="button"
              onClick={() => {
                navigator.share({ files: [shareFile] }).catch((err: unknown) => {
                  if ((err as { name?: string })?.name !== 'AbortError') notify(tr('attachment.shareFailed'));
                });
              }}
            >
              {tr('attachment.share')}
            </button>
          )}
          <button className="button" onClick={onClose}>
            {tr('common.close')}
          </button>
        </div>
        {ready && !ready.open && !ready.download && <p className="muted small">{tr('attachment.unavailable')}</p>}
      </div>
    </div>
  );
}

function extensionOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(name);
  return m ? m[1].toUpperCase() : '';
}
