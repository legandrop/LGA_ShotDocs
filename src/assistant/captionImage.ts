import { mediaIdOf, type MediaQueue } from '../media/queue';

// La foto que se le manda al modelo en *Suggest caption* (Docs/Doc_Asistente.md, entrega A3, y 10.5): nunca el original.
//
// De dónde sale (sin bajar el original si ya hay algo más chico en el dispositivo):
// 1. Una foto del Drive (`sdmedia://`): la imagen nítida de la página (`media.view`, la de 1024 px; la hace con lo que
//    ya hay: la guardada, el original si está en el dispositivo o, con red, bajándolo una vez por el portero, como para
//    mostrarla nítida). Si no hay nada mejor (una foto chica, una HEIC que todavía no se convirtió), la miniatura.
// 2. Otra dirección (`https`, un archivo de Storage, `data:`): lo que da el editor para mostrarla.
//
// Y siempre se vuelve a armar en el dispositivo: lado mayor de 1024 px como mucho, JPEG al 85 %. Eso además saca los
// metadatos del archivo (la ubicación GPS de un iPhone, la cámara, la fecha): al proveedor le llegan solo los píxeles.
// 1024 px alcanzan para leer una claqueta y cuestan unos 1 000 a 1 400 tokens de entrada (Anthropic cuenta ancho × alto
// / 750 y achica de por sí a 1 568 px; OpenAI y Gemini cobran por mosaicos de 512 y 768 px).

/** El lado mayor de lo que se manda. */
export const CAPTION_SIDE = 1024;
/** La calidad del JPEG. */
export const CAPTION_QUALITY = 0.85;

export interface CaptionImage {
  mime: 'image/jpeg';
  /** Los bytes en base64. */
  data: string;
  bytes: number;
  width: number;
  height: number;
}

export class CaptionImageError extends Error {
  /** `unavailable`: no hay de dónde sacarla (sin red, sin copia); `unreadable`: el navegador no la abre. */
  constructor(readonly kind: 'unavailable' | 'unreadable') {
    super(kind);
    this.name = 'CaptionImageError';
  }
}

export interface CaptionImageDeps {
  media: Pick<MediaQueue, 'view' | 'thumbnail'>;
  /** Baja el original del Drive con un pase del portero (sharpImages.ts, `porteroDownload`). */
  download?: (id: string) => Promise<Blob>;
  /** Lo que da el editor para mostrar una dirección que no es del Drive (`resolveFileUrl` de BlockNote). */
  resolve?: (url: string) => Promise<string>;
  fetcher?: (url: string) => Promise<Response>;
  /** Achica y vuelve a armar (en el navegador, con un canvas; en las pruebas, otra cosa). */
  encode?: (blob: Blob, side: number) => Promise<{ blob: Blob; width: number; height: number }>;
}

/** El tamaño que entra en `side` (el lado mayor), sin agrandar. */
export function fitSide(width: number, height: number, side = CAPTION_SIDE): { width: number; height: number } {
  const long = Math.max(width, height);
  if (!(long > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, side / long);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function blobAt(url: string, fetcher: (url: string) => Promise<Response>): Promise<Blob> {
  let res: Response;
  try {
    res = await fetcher(url);
  } catch {
    throw new CaptionImageError('unavailable');
  }
  if (!res.ok) throw new CaptionImageError('unavailable');
  return res.blob();
}

/** De dónde sale la foto (antes de achicarla): ver arriba. */
export async function captionSource(url: string, deps: CaptionImageDeps): Promise<Blob> {
  const fetcher = deps.fetcher ?? ((u: string) => fetch(u));
  const id = mediaIdOf(url);
  if (id) {
    const view = await deps.media.view(id, { side: CAPTION_SIDE, download: deps.download }).catch(() => null);
    if (view) return blobAt(view.url, fetcher);
    const thumb = await deps.media.thumbnail(id).catch(() => null);
    if (thumb) return blobAt(thumb, fetcher);
    throw new CaptionImageError('unavailable');
  }
  if (!url) throw new CaptionImageError('unavailable');
  const href = deps.resolve ? await deps.resolve(url).catch(() => url) : url;
  return blobAt(href, fetcher);
}

/** Achica en el navegador: `createImageBitmap` (gira según EXIF, como la muestra la página) y un canvas a JPEG. */
async function encodeInBrowser(blob: Blob, side: number): Promise<{ blob: Blob; width: number; height: number }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    throw new CaptionImageError('unreadable');
  }
  try {
    const size = fitSide(bitmap.width, bitmap.height, side);
    if (size.width === 0) throw new CaptionImageError('unreadable');
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new CaptionImageError('unreadable');
    // Una PNG con transparencia: fondo blanco (en JPEG lo transparente sale negro).
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', CAPTION_QUALITY));
    if (!out) throw new CaptionImageError('unreadable');
    return { blob: out, ...size };
  } finally {
    bitmap.close?.();
  }
}

/** Base64 de un Blob, sin `data:` adelante. */
export async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** La foto lista para mandar: achicada, en JPEG y en base64. */
export async function captionImage(url: string, deps: CaptionImageDeps): Promise<CaptionImage> {
  const source = await captionSource(url, deps);
  if (source.type && !source.type.startsWith('image/')) throw new CaptionImageError('unreadable');
  const { blob, width, height } = await (deps.encode ?? encodeInBrowser)(source, CAPTION_SIDE);
  return { mime: 'image/jpeg', data: await base64Of(blob), bytes: blob.size, width, height };
}
