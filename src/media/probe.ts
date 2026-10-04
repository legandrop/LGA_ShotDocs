// Lo que se hace con el navegador al elegir una foto o un video: medidas, duración y miniatura. Si el
// navegador no puede abrir el archivo (HEIC en Chrome de Windows, un video que no decodifica), no hay
// miniatura ni medidas: el archivo se guarda y se sube igual, y en la página queda un ícono.

import { t } from '../i18n';
import { toBase64 } from '../lib/base64';

/** Lado mayor de la miniatura. */
export const THUMB_SIDE = 480;
/** Tope del bucket `thumbs`. */
export const THUMB_MAX_BYTES = 512 * 1024;
const THUMB_QUALITY = 0.8;
/** Lo máximo que se espera a que el navegador abra un archivo. */
const PROBE_TIMEOUT_MS = 10_000;

/** Medidas reales orientadas del candidato; cancelar suelta imagen, URL, timer y listener. */
export function orientedImageSize(file: Blob, signal: AbortSignal): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Cancelado', 'AbortError')); return; }
    const image = new Image(), url = URL.createObjectURL(file);
    const finish = (size?: { width: number; height: number }) => {
      clearTimeout(timer); signal.removeEventListener('abort', abort);
      image.onload = image.onerror = null; image.src = ''; URL.revokeObjectURL(url);
      if (size) resolve(size);
      else reject(new DOMException('No se pudieron medir las dimensiones', signal.aborted ? 'AbortError' : 'DataError'));
    };
    const abort = () => finish();
    const timer = setTimeout(abort, PROBE_TIMEOUT_MS);
    signal.addEventListener('abort', abort, { once: true });
    image.onerror = abort;
    image.onload = () => {
      const width = image.naturalWidth, height = image.naturalHeight;
      finish([width, height].every((n) => Number.isInteger(n) && n >= 1 && n <= 100_000) ? { width, height } : undefined);
    };
    image.src = url;
  });
}

export interface Probe {
  width: number | null;
  height: number | null;
  duration: number | null;
  /** JPEG de hasta 512 KB, o `null` si el navegador no pudo abrir el archivo. */
  thumb: Blob | null;
}

export type MediaKind = 'image' | 'video';

export function mediaKind(mime: string): MediaKind | null {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return null;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** Un ancho o alto válido para la base (1..100000), o `null`. */
export function dimension(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const n = Math.round(value);
  return n >= 1 && n <= 100_000 ? n : null;
}

/** Una duración válida para la base (segundos), o `null`. */
export function seconds(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0 || value > 10_000_000) return null;
  return value;
}

type Drawable = CanvasImageSource & { width?: number; height?: number };

/**
 * Lado mayor de la imagen que se ve en la página cuando la miniatura queda chica (una foto a lo ancho de la
 * hoja, o una pantalla de alta densidad). Ver Docs/Doc_Imagenes.md, "Calidad en la página".
 */
export const VIEW_SIDE = 2048;
/** La imagen nítida chica, para una foto que se dibuja a 900 px de pantalla o menos (un teléfono). */
export const VIEW_SIDE_SMALL = 1024;
/**
 * Calidad de esa imagen (WebP donde el navegador lo hace, si no JPEG): como "Exportar para web", nítida y
 * liviana (ver las medidas en Docs/Doc_Imagenes.md).
 */
export const VIEW_QUALITY = 0.8;

/**
 * Reduce con buena calidad: el navegador achica de a mitades (con el suavizado en `high`) hasta quedar a
 * menos del doble del tamaño final. Un solo salto de 4000 a 480 px con el suavizado común deja la imagen
 * dentada o con moiré; así queda como el "Exportar para web" de Photoshop.
 */
function drawScaled(source: Drawable, width: number, height: number, w: number, h: number): HTMLCanvasElement | null {
  let current: Drawable = source;
  let cw = width;
  let ch = height;
  while (cw / 2 >= w * 1.0001 && ch / 2 >= h * 1.0001) {
    const step = document.createElement('canvas');
    step.width = Math.max(1, Math.round(cw / 2));
    step.height = Math.max(1, Math.round(ch / 2));
    const sctx = step.getContext('2d');
    if (!sctx) break;
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(current, 0, 0, step.width, step.height);
    // El paso anterior ya no hace falta: se suelta su memoria enseguida (Safari tarda en liberar canvases).
    if (current !== source && current instanceof HTMLCanvasElement) release(current);
    current = step;
    cw = step.width;
    ch = step.height;
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // Fondo blanco: un PNG con transparencia no queda negro en JPEG.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(current, 0, 0, w, h);
  if (current !== source && current instanceof HTMLCanvasElement) release(current);
  return canvas;
}

/** Suelta la memoria de un canvas (en Safari un canvas grande queda ocupando hasta que se achica a cero). */
function release(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * Si el navegador sabe hacer WebP (`toBlob` con `image/webp`): Safari devuelve un PNG, así que se prueba
 * una vez y queda anotado.
 */
let webpEncodes: boolean | undefined;

/**
 * Dibuja con el lado mayor en `side` como mucho y lo pasa a JPEG (o, con `webp`, a WebP si el navegador sabe
 * hacerlo: pesa como 40% menos con la misma nitidez; Safari no lo hace y queda JPEG). Con `maxBytes`, baja la
 * calidad de a 0,2 hasta que entre (o `null`).
 */
async function toJpeg(
  source: Drawable,
  width: number,
  height: number,
  side: number,
  quality: number,
  maxBytes = Infinity,
  webp = false,
): Promise<Blob | null> {
  const scale = Math.min(1, side / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = drawScaled(source, width, height, w, h);
  if (!canvas) return null;
  try {
    if (webp && webpEncodes !== false) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
      if (blob) webpEncodes = blob.type === 'image/webp';
      if (blob && blob.size <= maxBytes && blob.type === 'image/webp') return blob;
    }
    for (let q = quality; q >= 0.4; q -= 0.2) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', q));
      if (blob && blob.size <= maxBytes && blob.type === 'image/jpeg') return blob;
    }
    return null;
  } finally {
    release(canvas);
  }
}

/** Dibuja reducido a `THUMB_SIDE` de lado mayor y lo pasa a JPEG de menos de 512 KB. */
function toThumb(source: Drawable, width: number, height: number): Promise<Blob | null> {
  return toJpeg(source, width, height, THUMB_SIDE, THUMB_QUALITY, THUMB_MAX_BYTES);
}

/**
 * La miniatura de algo ya dibujado en un canvas (la primera página de un PDF, `pdfPreview.ts`): JPEG de lado mayor
 * `THUMB_SIDE` y menos de 512 KB, o `null`.
 */
export function thumbFromCanvas(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return toThumb(canvas, canvas.width, canvas.height);
}

/** Las medidas de una foto sin decodificarla entera: el navegador las lee de la cabecera al cargarla. */
function imageSize(file: Blob): Promise<{ width: number; height: number; img: HTMLImageElement; url: string }> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  return new Promise((resolve, reject) => {
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight, img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(t('probe.imageFailed')));
    };
    img.src = url;
  });
}

/**
 * La foto reducida a `side` de lado mayor, en JPEG. Se decodifica ya reducida (`resizeWidth`/`resizeHeight`,
 * con `resizeQuality: 'high'`): una foto de 48 MP entera en memoria puede cerrar la app en el iPhone. Se
 * pide solo el lado mayor, para que el otro salga proporcional aunque el navegador aplique la orientación
 * antes o después de reducir. Sin esas opciones, se dibuja la imagen ya cargada (achicando de a mitades).
 */
async function reduced(
  file: Blob,
  size: { width: number; height: number; img: HTMLImageElement },
  side: number,
  quality: number,
  maxBytes?: number,
  webp = false,
): Promise<Blob | null> {
  const { width, height, img } = size;
  const target = Math.min(side, Math.max(width, height));
  try {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: 'from-image',
      resizeQuality: 'high',
      ...(width >= height ? { resizeWidth: target } : { resizeHeight: target }),
    });
    try {
      return await toJpeg(bitmap, bitmap.width, bitmap.height, side, quality, maxBytes, webp);
    } finally {
      bitmap.close();
    }
  } catch {
    // Un navegador sin las opciones de reducción: se dibuja la imagen ya cargada.
    return toJpeg(img, width, height, side, quality, maxBytes, webp).catch(() => null);
  }
}

async function probeImage(file: Blob): Promise<Probe> {
  // Las medidas salen de la cabecera (ya con la orientación de la foto aplicada, como la muestra el
  // navegador).
  const size = await imageSize(file);
  try {
    const thumb = await reduced(file, size, THUMB_SIDE, THUMB_QUALITY, THUMB_MAX_BYTES);
    return { width: dimension(size.width), height: dimension(size.height), duration: null, thumb };
  } finally {
    URL.revokeObjectURL(size.url);
  }
}

/**
 * La imagen para la página cuando la miniatura queda chica: el lado mayor en `side` como mucho (`VIEW_SIDE` o
 * `VIEW_SIDE_SMALL`), WebP (o JPEG en Safari) a `VIEW_QUALITY`, sobre blanco como la miniatura (un PNG con
 * transparencia se ve igual que su miniatura y que en Safari, donde JPEG no tiene transparencia). Solo se
 * guarda en el dispositivo que la hizo (nunca se sube). `null` si el navegador no abre el archivo o si no ganaría nada (la foto no es más grande
 * que la miniatura). Un JPEG que ya entra en `VIEW_SIDE` y no pesa de más se usa tal cual. Nunca falla.
 */
export async function viewImage(file: Blob, mime: string, side: number = VIEW_SIDE): Promise<Blob | null> {
  if (typeof document === 'undefined' || mediaKind(mime) !== 'image') return null;
  try {
    return await withTimeout(
      (async () => {
        const size = await imageSize(file);
        try {
          const long = Math.max(size.width, size.height);
          if (long <= THUMB_SIDE * VIEW_GAIN) return null;
          if (long <= side && mime === 'image/jpeg' && file.size <= VIEW_KEEP_BYTES) {
            return file.type === mime ? file : new Blob([file], { type: mime });
          }
          return await reduced(file, size, side, VIEW_QUALITY, undefined, true);
        } finally {
          URL.revokeObjectURL(size.url);
        }
      })(),
      VIEW_TIMEOUT_MS,
    );
  } catch {
    return null;
  }
}

/** La imagen de la página cambia la miniatura solo si es al menos esto más grande. */
export const VIEW_GAIN = 1.2;
/** Un JPEG chico de lado que pesa más que esto se vuelve a comprimir igual. */
const VIEW_KEEP_BYTES = 900 * 1024;
/** Decodificar una foto de 48 MP en un teléfono puede tardar: más margen que la miniatura. */
const VIEW_TIMEOUT_MS = 20_000;

async function probeVideo(file: Blob): Promise<Probe> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error(t('probe.videoFailed')));
      video.src = url;
    });
    const duration = seconds(video.duration);
    const width = dimension(video.videoWidth);
    const height = dimension(video.videoHeight);
    // Un cuadro cerca del primer segundo (el primero suele ser negro). Saltar ahí hace que el navegador
    // decodifique ese cuadro (Safari no lo hace solo); si no llega a tiempo, queda sin miniatura.
    const at = duration !== null ? Math.min(1, duration / 2) : 0.001;
    const framed = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 4000);
      video.onseeked = () => {
        clearTimeout(timer);
        resolve(true);
      };
      video.onerror = () => {
        clearTimeout(timer);
        resolve(false);
      };
      video.currentTime = at;
    });
    const thumb = framed && width && height ? await toThumb(video, width, height).catch(() => null) : null;
    return { width, height, duration, thumb };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** Medidas, duración y miniatura. Nunca falla: lo que no se pudo sacar queda en `null`. */
export async function probeMedia(file: Blob, mime: string): Promise<Probe> {
  const none: Probe = { width: null, height: null, duration: null, thumb: null };
  if (typeof document === 'undefined') return none;
  const kind = mediaKind(mime);
  try {
    if (kind === 'image') return await withTimeout(probeImage(file), PROBE_TIMEOUT_MS);
    if (kind === 'video') return await withTimeout(probeVideo(file), PROBE_TIMEOUT_MS);
  } catch {
    // El navegador no puede abrir este archivo.
  }
  return none;
}

/** La miniatura de un video con una marca de "play" en el medio, para mostrar en la página. */
export async function withPlayMark(thumb: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(thumb);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return thumb;
    ctx.drawImage(bitmap, 0, 0);
    const r = Math.max(14, Math.min(bitmap.width, bitmap.height) * 0.12);
    const cx = bitmap.width / 2;
    const cy = bitmap.height / 2;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.32, cy - r * 0.45);
    ctx.lineTo(cx + r * 0.5, cy);
    ctx.lineTo(cx - r * 0.32, cy + r * 0.45);
    ctx.closePath();
    ctx.fill();
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    return out ?? thumb;
  } finally {
    bitmap.close();
  }
}

/** El texto listo para ir dentro de un SVG (sin `<`, `&` ni comillas sueltas). */
export function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Lo que dice un archivo que un dueño o admin mandó a la papelera de Drive. */
export function deletedLabel(): string {
  return t('probe.deleted');
}
/** Se pidió mandarlo a la papelera de Drive pero el portero todavía no lo confirmó (por ejemplo, Drive falló). */
export function requestedLabel(): string {
  return t('probe.requested');
}

/**
 * Un archivo que un dueño o admin mandó a la papelera de Drive (papelera de archivos): la miniatura
 * oscurecida, si la hay, con el aviso y el nombre; sin miniatura, el ícono. Es un SVG sin scripts, como
 * dirección `data:`, con la miniatura adentro (un `<img>` no carga nada de afuera de un SVG).
 */
export async function deletedUrl(
  kind: MediaKind | null,
  name: string,
  thumb: Blob | null,
  notice: string = deletedLabel(),
): Promise<string> {
  const label = escapeXml(name.length > 46 ? `${name.slice(0, 45)}…` : name);
  let picture = '';
  if (thumb) {
    const bytes = new Uint8Array(await thumb.arrayBuffer());
    const type = thumb.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
    picture =
      `<image href="data:${type};base64,${toBase64(bytes)}" width="480" height="270" preserveAspectRatio="xMidYMid slice"/>` +
      '<rect width="480" height="270" fill="#000000" fill-opacity="0.55"/>';
  }
  const ink = thumb ? '#ffffff' : '#5c5853';
  const glyph = kind === 'video' ? '▶' : '';
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270">' +
    '<rect width="480" height="270" rx="8" fill="#ebe8e4"/>' +
    picture +
    `<text x="240" y="130" text-anchor="middle" font-family="system-ui, sans-serif" font-size="18" font-weight="600" fill="${ink}">${escapeXml(notice)}</text>` +
    `<text x="240" y="162" text-anchor="middle" font-family="system-ui, sans-serif" font-size="15" fill="${ink}">${glyph ? `${glyph} ` : ''}${label}</text>` +
    '</svg>';
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Un ícono para el archivo que todavía no tiene miniatura (o que el navegador no puede mostrar), con su
 * nombre y, si hace falta, un aviso abajo (una foto HEIC que no se pudo pasar a JPEG). Es un SVG sin scripts,
 * como dirección `data:`.
 */
export function placeholderUrl(kind: MediaKind | null, label: string, notice?: string): string {
  const text = escapeXml(label.length > 46 ? `${label.slice(0, 45)}…` : label);
  const note = notice
    ? `<text x="240" y="226" text-anchor="middle" font-family="system-ui, sans-serif" font-size="14" font-weight="600" fill="#8a5a2b">${escapeXml(notice.length > 56 ? `${notice.slice(0, 55)}…` : notice)}</text>`
    : '';
  const glyph =
    kind === 'video'
      ? '<circle cx="240" cy="112" r="34" fill="#00000066"/><path d="M229 94 L260 112 L229 130 Z" fill="#fff"/>'
      : '<rect x="206" y="86" width="68" height="52" rx="6" fill="none" stroke="#8a8580" stroke-width="5"/><circle cx="226" cy="104" r="7" fill="#8a8580"/><path d="M210 134 L234 112 L250 126 L258 118 L272 134 Z" fill="#8a8580"/>';
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270">' +
    '<rect width="480" height="270" rx="8" fill="#ebe8e4"/>' +
    glyph +
    `<text x="240" y="196" text-anchor="middle" font-family="system-ui, sans-serif" font-size="17" fill="#5c5853">${text}</text>` +
    note +
    '</svg>';
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
