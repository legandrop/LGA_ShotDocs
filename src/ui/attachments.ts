import { fileKind } from '../media/attachments';
import type { MediaQueue } from '../media/queue';
import { MEDIA_SCHEME } from '../media/queue';

// Adjuntos en el editor (Docs/Doc_Adjuntos.md): un bloque `image` con `sdmedia://` cuyo archivo no es una foto
// ni un video. Lo que sabe la cola (`fileInfo`) manda; mientras no lo sabe, la extensión del nombre del bloque.

/** El archivo es un adjunto (un PDF, un zip…) y no una foto o un video. */
export function isAttachment(media: Pick<MediaQueue, 'fileInfo'>, id: string, name: string): boolean {
  const info = media.fileInfo(id);
  if (info) return info.kind === 'file';
  return name !== '' && fileKind(null, name) === 'file';
}

/**
 * Marca con `sd-attachment` las imágenes de los bloques de ese archivo si es un adjunto (la tarjeta tiene
 * tamaño fijo, sin tiradores ni lupa: styles.css). La clase va en la imagen, adentro de la vista de BlockNote,
 * que ProseMirror no vigila; si BlockNote vuelve a dibujar la imagen, vuelve a pasar por `resolveFileUrl` y se
 * marca de nuevo.
 */
export function markAttachments(
  editor: { domElement?: HTMLElement | null } | null,
  id: string,
  media: Pick<MediaQueue, 'fileInfo'>,
): void {
  const root = editor?.domElement;
  if (!root) return;
  for (const block of root.querySelectorAll<HTMLElement>(`[data-content-type="image"][data-url="${MEDIA_SCHEME}${id}"]`)) {
    const img = block.querySelector<HTMLImageElement>('img.bn-visual-media');
    if (!img) continue;
    const name = block.getAttribute('data-name') ?? '';
    img.classList.toggle('sd-attachment', isAttachment(media, id, name));
  }
}
