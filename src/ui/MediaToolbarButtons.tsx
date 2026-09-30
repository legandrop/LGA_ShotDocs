import { FileDownloadButton, useBlockNoteEditor, useComponentsContext, useDictionary, useEditorState } from '@blocknote/react';
import { useEffect, useRef } from 'react';
import { t, useT } from '../i18n';
import { mediaIdOf } from '../media/queue';
import { useServices } from '../services';
import { carreteSourceOf } from './carrete';
import { isOffline, originalFor, startDownload } from './carreteLoader';
import { DownloadIcon } from './icons';
import { notify } from './notice';

// Botones de la barra de una imagen en el editor (Docs/Doc_Carrete.md):
//   - Bajar: para `sdmedia://`, el original (el del dispositivo con su nombre, o con un pase del portero),
//     nunca la miniatura que muestra la página. Las demás imágenes usan el botón de BlockNote.
//   - Ver: abre el carrete en esa imagen (también con la barra espaciadora, con la imagen elegida).

/** El bloque `image` elegido (uno solo), o `undefined`. */
function useSelectedImage(): { id: string; url: string } | undefined {
  const editor = useBlockNoteEditor();
  return useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const blocks = e.getSelection()?.blocks ?? [e.getTextCursorPosition().block];
      if (blocks.length !== 1 || blocks[0].type !== 'image') return undefined;
      const url = (blocks[0].props as { url?: unknown }).url;
      return typeof url === 'string' ? { id: blocks[0].id, url } : undefined;
    },
  });
}

export function MediaDownloadButton() {
  const block = useSelectedImage();
  const id = mediaIdOf(block?.url);
  if (!id) return <FileDownloadButton />;
  return <OriginalDownloadButton key={id} fileId={id} />;
}

function OriginalDownloadButton({ fileId }: { fileId: string }) {
  const Components = useComponentsContext()!;
  const dict = useDictionary();
  const { media } = useServices();
  // Se prepara apenas se elige la imagen: así el clic baja enseguida (Safari no abre otra pestaña si hay
  // que esperar). El pase se reusa por horas, así que no cuesta pedirlo.
  const ready = useRef<Promise<Awaited<ReturnType<typeof originalFor>>> | null>(null);
  const settled = useRef<Awaited<ReturnType<typeof originalFor>> | null>(null);

  useEffect(() => {
    const pending = originalFor(media, fileId);
    ready.current = pending;
    pending.then(
      (r) => {
        if (ready.current === pending) settled.current = r;
        else r.release();
      },
      () => {
        if (ready.current === pending) ready.current = null;
      },
    );
    return () => {
      ready.current = null;
      const r = settled.current;
      settled.current = null;
      // Un rato después: la descarga de un original local puede estar empezando.
      if (r) setTimeout(r.release, 60_000);
    };
  }, [media, fileId]);

  const onClick = () => {
    const now = settled.current;
    if (now) return startDownload(now.full, now.name);
    (ready.current ?? originalFor(media, fileId)).then(
      (r) => {
        startDownload(r.full, r.name);
        if (!settled.current) setTimeout(r.release, 60_000);
      },
      (err: unknown) =>
        notify(isOffline(err) ? t('mediaButton.offline') : t('mediaButton.failed')),
    );
  };

  const label = dict.formatting_toolbar.file_download.tooltip.image ?? t('mediaButton.download');
  return (
    <Components.FormattingToolbar.Button
      className="bn-button"
      label={label}
      mainTooltip={label}
      icon={<DownloadIcon size={18} />}
      onClick={onClick}
    />
  );
}

export function MediaViewButton({ onView }: { onView: (blockId: string) => void }) {
  const Components = useComponentsContext()!;
  const block = useSelectedImage();
  const tr = useT();
  if (!block || !carreteSourceOf(block.url)) return null;
  return (
    <Components.FormattingToolbar.Button
      className="bn-button"
      label={tr('mediaButton.view')}
      mainTooltip={tr('mediaButton.view')}
      secondaryTooltip={tr('mediaButton.space')}
      icon={<ViewIcon />}
      onClick={() => onView(block.id)}
    />
  );
}

function ViewIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8V4h4M16 8V4h-4M4 12v4h4M16 12v4h-4" />
    </svg>
  );
}
