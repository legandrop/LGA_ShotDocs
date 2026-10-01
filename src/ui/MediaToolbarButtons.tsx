import { useBlockNoteEditor, useDictionary, useEditorState } from '@blocknote/react';
import { thumbSize } from './sharpMarks';
import { useEffect, useRef, useState } from 'react';
import { BarButton } from './BarButton';
import { t, useT } from '../i18n';
import '../i18n/lazy/editor';
import { mediaIdOf } from '../media/queue';
import { useServices } from '../services';
import { isOffline, originalFor, startDownload } from './carreteLoader';
import { DownloadIcon } from './icons';
import { isAttachment } from './attachments';
import { arrangeRows, ROW_PRESETS } from './imageRows';
import { ROW_WIDTH_PROP } from './imageRowsEditor';
import { notify } from './notice';

// Botones de la barra de una foto-bloque en el editor (Docs/Doc_Carrete.md; la barra entera es MediaBar.tsx):
//   - Bajar: para `sdmedia://`, el original (el del dispositivo con su nombre, o con un pase del portero),
//     nunca la miniatura que muestra la página (también lo usa la foto en línea).
//   - Tamaño: todo el ancho, 1/2, 1/3 o 1/4 del ancho de la página (`rowWidth`, Docs/Doc_Imagenes.md);
//     fotos seguidas que entran se ponen en fila.
//   - Acomodar en filas: la tanda de fotos y videos seguidos a la elegida, en orden, en filas de la misma
//     altura (`arrangeRows`).

/** El bloque `image` elegido (uno solo), o `undefined`. */
function useSelectedImage(): { id: string; url: string; name: string; rowWidth: number } | undefined {
  const editor = useBlockNoteEditor();
  return useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const blocks = e.getSelection()?.blocks ?? [e.getTextCursorPosition().block];
      if (blocks.length !== 1 || blocks[0].type !== 'image') return undefined;
      const props = blocks[0].props as { url?: unknown; name?: unknown; [ROW_WIDTH_PROP]?: unknown };
      const rowWidth = Number(props[ROW_WIDTH_PROP]) || 0;
      const name = typeof props.name === 'string' ? props.name : '';
      return typeof props.url === 'string' ? { id: blocks[0].id, url: props.url, name, rowWidth } : undefined;
    },
    // Un objeto nuevo en cada cambio volvería a dibujar la barra: se compara lo que importa.
    equalityFn: (a, b) => a?.id === b?.id && a?.url === b?.url && a?.name === b?.name && a?.rowWidth === b?.rowWidth,
  });
}

export function OriginalDownloadButton({ fileId, label: given }: { fileId: string; label?: string }) {
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

  const label = given ?? dict.formatting_toolbar.file_download.tooltip.image ?? t('mediaButton.download');
  return <BarButton label={label} icon={<DownloadIcon size={18} />} test="mediaDownload" onClick={onClick} />;
}

/** La foto elegida es un adjunto (un PDF, un zip…) y no una foto o un video. */
function useIsAttachment(block: { url: string; name?: string } | undefined): boolean {
  const { media } = useServices();
  const id = mediaIdOf(block?.url);
  return !!id && isAttachment(media, id, block?.name ?? '');
}

export function ViewIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8V4h4M16 8V4h-4M4 12v4h4M16 12v4h-4" />
    </svg>
  );
}

export const SIZE_LABELS: Record<number, { text: string; tip: 'imageSize.full' | 'imageSize.half' | 'imageSize.third' | 'imageSize.quarter' }> = {
  [1]: { text: '1/1', tip: 'imageSize.full' },
  [1 / 2]: { text: '1/2', tip: 'imageSize.half' },
  [1 / 3]: { text: '1/3', tip: 'imageSize.third' },
  [1 / 4]: { text: '1/4', tip: 'imageSize.quarter' },
};

/** El espacio entre fotos de una fila (`--img-gap` en styles.css). */
const ROW_GAP_PX = 8;

/** Los ids de la tanda de fotos seguidas (hermanas) que incluye a `id`, en orden. */
function runOf(
  editor: { getParentBlock: (id: string) => { children: unknown[] } | undefined; document: unknown[] },
  id: string,
  isPhoto: (block: { id: string; type: string; props?: Record<string, unknown> }) => boolean,
): string[] {
  const siblings = (editor.getParentBlock(id)?.children ?? editor.document) as { id: string; type: string; props?: Record<string, unknown> }[];
  const at = siblings.findIndex((b) => b.id === id);
  if (at < 0) return [id];
  let from = at;
  let to = at;
  // La tanda corta en lo que no es foto ni video, también en un adjunto (su tarjeta desarmaría la galería).
  while (from > 0 && isPhoto(siblings[from - 1])) from--;
  while (to < siblings.length - 1 && isPhoto(siblings[to + 1])) to++;
  return siblings.slice(from, to + 1).map((b) => b.id);
}

/**
 * La proporción (ancho / alto) de lo que se ve de una foto (la miniatura la conserva). `null` mientras carga;
 * 0 si no se sabe (sin imagen, rota, o el marcador de "todavía no está": ahí se usa 3:2).
 */
function aspectOf(dom: Element | null | undefined, id: string): number | null {
  const img = dom?.querySelector<HTMLImageElement>(`[data-node-type="blockContainer"][data-id="${CSS.escape(id)}"] img.bn-visual-media`);
  if (!img || !img.getAttribute('src')) return 0;
  if (!img.complete) return null;
  if (img.src.startsWith('data:image/svg')) return 0;
  // Con la imagen nítida puesta, la proporción de la miniatura (la misma en todos los dispositivos).
  const { width, height } = thumbSize(img);
  return width > 0 && height > 0 ? width / height : 0;
}

/** Vuelve a dibujar cuando termina de cargar una imagen del editor (el botón espera a que carguen). */
function useImageLoads(dom: Element | null | undefined): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!dom) return;
    const onLoad = (e: Event) => {
      if ((e.target as Element | null)?.matches?.('img.bn-visual-media')) setTick((n) => n + 1);
    };
    dom.addEventListener('load', onLoad, true);
    dom.addEventListener('error', onLoad, true);
    return () => {
      dom.removeEventListener('load', onLoad, true);
      dom.removeEventListener('error', onLoad, true);
    };
  }, [dom]);
}

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
  const block = useSelectedImage();
  const tr = useT();
  const { media } = useServices();
  useImageLoads(block ? editor.domElement : null);
  const attachment = useIsAttachment(block);
  // Un adjunto tiene tamaño fijo (su tarjeta): sin tamaños rápidos ni "Acomodar".
  if (!block || !editor.isEditable || attachment) return null;
  const isPhoto = (b: { type: string; props?: Record<string, unknown> }) => {
    if (b.type !== 'image') return false;
    const url = typeof b.props?.url === 'string' ? b.props.url : '';
    const id = mediaIdOf(url);
    return !id || !isAttachment(media, id, typeof b.props?.name === 'string' ? b.props.name : '');
  };
  const setSize = (f: number) => {
    const width = groupWidth(editor.domElement, block.id);
    const props: Record<string, number> = { [ROW_WIDTH_PROP]: f };
    if (width > 0) props.previewWidth = Math.round(f * width);
    editor.updateBlock(block.id, { props });
  };
  const run = runOf(editor as never, block.id, isPhoto);
  const ready = run.every((id) => aspectOf(editor.domElement, id) !== null);
  const arrange = () => {
    // La tanda y las proporciones al hacer clic: pudo cambiar (otra persona, un deshacer) sin cambiar la foto
    // elegida.
    const now = runOf(editor as never, block.id, isPhoto);
    const aspects = now.map((id) => aspectOf(editor.domElement, id));
    const width = groupWidth(editor.domElement, block.id);
    if (!(width > 0) || aspects.some((x) => x === null)) return;
    // Una proporción desconocida (0: sin foto, rota o todavía el marcador) cuenta como 3:2 en `arrangeRows`.
    const fracs = arrangeRows(aspects as number[], { gapRatio: ROW_GAP_PX / width });
    // Un solo cambio (un solo deshacer).
    editor.transact(() => {
      now.forEach((id, i) => editor.updateBlock(id, { props: { [ROW_WIDTH_PROP]: fracs[i], previewWidth: Math.round(fracs[i] * width) } }));
    });
  };
  // D-24: primero los tamaños y después "Arrange in rows", en el mismo sector.
  return (
    <>
      {ROW_PRESETS.map((f) => (
        <BarButton
          key={f}
          className="image-size-button"
          label={tr(SIZE_LABELS[f].tip)}
          tip={`**${tr(SIZE_LABELS[f].tip)}**${f < 1 ? `
${tr('imageSize.rows')}` : ''}`}
          test={`size-${SIZE_LABELS[f].text}`}
          selected={Math.abs(block.rowWidth - f) < 1e-4}
          onClick={() => setSize(f)}
        >
          {SIZE_LABELS[f].text}
        </BarButton>
      ))}
      {run.length > 1 && (
        <BarButton
          label={tr('imageSize.arrange')}
          tip={`**${tr('imageSize.arrange')}**
${ready ? tr('imageSize.arrangeHint') : tr('imageSize.waiting')}`}
          icon={<ArrangeIcon />}
          test="arrange"
          disabled={!ready}
          onClick={arrange}
        />
      )}
    </>
  );
}

export function ArrangeIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" aria-hidden="true">
      <path d="M3 4h5.5v5H3zM10.5 4H17v5h-6.5zM3 11h8v5H3zM13 11h4v5h-4z" />
    </svg>
  );
}
