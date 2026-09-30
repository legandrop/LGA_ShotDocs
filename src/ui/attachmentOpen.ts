import type { MediaQueue } from '../media/queue';
import { inlineType } from '../media/attachments';
import { downloadTarget, openTarget } from './carreteLoader';

// Abrir o bajar un adjunto (Docs/Doc_Adjuntos.md). Un PDF (o lo que el navegador sabe mostrar) se abre en una
// pestaña nueva; el resto se baja con su nombre. Safari no deja abrir una pestaña después de esperar algo, así
// que la dirección se prepara antes (al elegir el bloque, o al apretar sobre él) y el clic la usa en el acto.
// Si todavía no está lista, quien llama muestra la hoja del adjunto (AttachmentSheet), donde cada botón es un
// gesto nuevo con la dirección ya preparada.

type Media = Pick<MediaQueue, 'fileInfo'> & Parameters<typeof openTarget>[0] & Parameters<typeof downloadTarget>[0];

interface Ready {
  url: string;
  name?: string;
  release: () => void;
}

interface Prepared {
  open?: Ready | null;
  download?: Ready | null;
  pending: Promise<void>;
}

/** Lo preparado por adjunto; se suelta a los 10 minutos (los pases valen horas; un `blob:` ocupa memoria). */
const prepared = new Map<string, Prepared>();
const KEEP_MS = 10 * 60_000;

/** Empieza a preparar la dirección para abrir y la de bajar. Llamarla de más no pide dos veces. */
export function prepareAttachment(media: Media, id: string): Promise<void> {
  const known = prepared.get(id);
  if (known) return known.pending;
  const entry: Prepared = { pending: Promise.resolve() };
  entry.pending = (async () => {
    const info = media.fileInfo(id);
    const [open, download] = await Promise.all([
      info && inlineType(info.mime) ? openTarget(media, id).catch(() => null) : Promise.resolve(null),
      downloadTarget(media, id).catch(() => null),
    ]);
    entry.open = open;
    entry.download = download;
  })();
  prepared.set(id, entry);
  setTimeout(() => {
    if (prepared.get(id) !== entry) return;
    prepared.delete(id);
    entry.open?.release();
    entry.download?.release();
  }, KEEP_MS);
  return entry.pending;
}

/** Lo ya preparado (sin esperar), o `undefined` si todavía no está. */
export function preparedFor(id: string): { open: Ready | null; download: Ready | null } | undefined {
  const entry = prepared.get(id);
  if (!entry || entry.download === undefined) return undefined;
  return { open: entry.open ?? null, download: entry.download ?? null };
}

/** Olvida lo preparado (un pase que no anduvo, o un archivo que cambió). */
export function forgetAttachment(id: string): void {
  const entry = prepared.get(id);
  prepared.delete(id);
  entry?.open?.release();
  entry?.download?.release();
}

/** Abre la dirección en una pestaña nueva, sin darle acceso a la app. */
export function openInNewTab(url: string): void {
  window.open(url, '_blank', 'noopener');
}

/**
 * Baja un archivo: un `blob:` de este dispositivo con su nombre, en esta pestaña (no navega); una dirección del
 * portero en otra pestaña (si respondiera un error, no reemplaza la app).
 */
export function downloadNow(target: Ready): void {
  const a = document.createElement('a');
  a.href = target.url;
  if (target.url.startsWith('blob:')) {
    a.download = target.name || 'file';
  } else {
    a.target = '_blank';
    a.rel = 'noopener';
  }
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
}

/**
 * Con el mouse: abre o baja en el acto si ya está preparado. `false` si todavía no (quien llama muestra la hoja
 * del adjunto).
 */
export function openAttachmentNow(media: Media, id: string): boolean {
  const info = media.fileInfo(id);
  const ready = preparedFor(id);
  if (!info || !ready) {
    void prepareAttachment(media, id);
    return false;
  }
  if (inlineType(info.mime) && ready.open) {
    openInNewTab(ready.open.url);
    return true;
  }
  if (ready.download) {
    downloadNow(ready.download);
    return true;
  }
  return false;
}
