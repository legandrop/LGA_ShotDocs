import { FileDownloadButton, useBlockNoteEditor, useComponentsContext, useDictionary, useEditorState } from '@blocknote/react';
import { useEffect, useRef } from 'react';
import { t, useT } from '../i18n';
import '../i18n/lazy/editor';
import { mediaIdOf } from '../media/queue';
import { useServices } from '../services';
import { carreteSourceOf } from './carrete';
import { isOffline, originalFor, startDownload } from './carreteLoader';
import { DownloadIcon } from './icons';
import { ROW_PRESETS } from './imageRows';
import { ROW_WIDTH_PROP } from './imageRowsEditor';
import { notify } from './notice';

// Botones de la barra de una imagen en el editor (Docs/Doc_Carrete.md):
//   - Bajar: para `sdmedia://`, el original (el del dispositivo con su nombre, o con un pase del portero),
//     nunca la miniatura que muestra la página. Las demás imágenes usan el botón de BlockNote.
//   - Ver: abre el carrete en esa imagen (también con la barra espaciadora, con la imagen elegida).
//   - Tamaño: todo el ancho, 1/2, 1/3 o 1/4 del ancho de la página (`rowWidth`, Docs/Doc_Imagenes.md);
//     fotos seguidas que entran se ponen en fila.

/** El bloque `image` elegido (uno solo), o `undefined`. */
function useSelectedImage(): { id: string; url: string; rowWidth: number } | undefined {
  const editor = useBlockNoteEditor();
  return useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const blocks = e.getSelection()?.blocks ?? [e.getTextCursorPosition().block];
      if (blocks.length !== 1 || blocks[0].type !== 'image') return undefined;
      const props = blocks[0].props as { url?: unknown; [ROW_WIDTH_PROP]?: unknown };
      const rowWidth = Number(props[ROW_WIDTH_PROP]) || 0;
      return typeof props.url === 'string' ? { id: blocks[0].id, url: props.url, rowWidth } : undefined;
    },
    // Un objeto nuevo en cada cambio volvería a dibujar la barra: se compara lo que importa.
    equalityFn: (a, b) => a?.id === b?.id && a?.url === b?.url && a?.rowWidth === b?.rowWidth,
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

const SIZE_LABELS: Record<number, { text: string; tip: 'imageSize.full' | 'imageSize.half' | 'imageSize.third' | 'imageSize.quarter' }> = {
  [1]: { text: '1/1', tip: 'imageSize.full' },
  [1 / 2]: { text: '1/2', tip: 'imageSize.half' },
  [1 / 3]: { text: '1/3', tip: 'imageSize.third' },
  [1 / 4]: { text: '1/4', tip: 'imageSize.quarter' },
};

/** El ancho del área de texto donde está el bloque (su grupo), en px, o 0. */
function groupWidth(dom: Element | null | undefined, id: string): number {
  const group = dom?.querySelector(`[data-node-type="blockContainer"][data-id="${CSS.escape(id)}"]`)?.parentElement?.parentElement;
  if (!group) return 0;
  const style = getComputedStyle(group);
  return group.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
}

/**
 * Los tamaños rápidos. Además de `rowWidth` se guarda `previewWidth` (px) con el ancho de ese momento: una
 * versión vieja de la app, que no conoce `rowWidth`, muestra la foto con ese ancho.
 */
export function ImageSizeButtons() {
  const editor = useBlockNoteEditor();
  const Components = useComponentsContext()!;
  const block = useSelectedImage();
  const tr = useT();
  if (!block || !editor.isEditable) return null;
  const setSize = (f: number) => {
    const width = groupWidth(editor.domElement, block.id);
    const props: Record<string, number> = { [ROW_WIDTH_PROP]: f };
    if (width > 0) props.previewWidth = Math.round(f * width);
    editor.updateBlock(block.id, { props });
  };
  return (
    <>
      {ROW_PRESETS.map((f) => (
        <Components.FormattingToolbar.Button
          key={f}
          className="bn-button image-size-button"
          label={tr(SIZE_LABELS[f].tip)}
          mainTooltip={tr(SIZE_LABELS[f].tip)}
          secondaryTooltip={f < 1 ? tr('imageSize.rows') : undefined}
          isSelected={Math.abs(block.rowWidth - f) < 1e-4}
          onClick={() => setSize(f)}
        >
          {SIZE_LABELS[f].text}
        </Components.FormattingToolbar.Button>
      ))}
    </>
  );
}
