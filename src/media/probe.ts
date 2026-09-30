// Lo que se hace con el navegador al elegir una foto o un video: medidas, duración y miniatura. Si el
// navegador no puede abrir el archivo (HEIC en Chrome de Windows, un video que no decodifica), no hay
// miniatura ni medidas: el archivo se guarda y se sube igual, y en la página queda un ícono.

import { toBase64 } from '../lib/base64';

/** Lado mayor de la miniatura. */
export const THUMB_SIDE = 480;
/** Tope del bucket `thumbs`. */
export const THUMB_MAX_BYTES = 512 * 1024;
const THUMB_QUALITY = 0.8;
/** Lo máximo que se espera a que el navegador abra un archivo. */
const PROBE_TIMEOUT_MS = 10_000;

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

/** Dibuja reducido a `THUMB_SIDE` de lado mayor y lo pasa a JPEG de menos de 512 KB. */
async function toThumb(source: Drawable, width: number, height: number): Promise<Blob | null> {
  const scale = Math.min(1, THUMB_SIDE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // Fondo blanco: un PNG con transparencia no queda negro en JPEG.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  for (let quality = THUMB_QUALITY; quality >= 0.4; quality -= 0.2) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= THUMB_MAX_BYTES && blob.type === 'image/jpeg') return blob;
  }
  return null;
}

/** Las medidas de una foto sin decodificarla entera: el navegador las lee de la cabecera al cargarla. */
function imageSize(file: Blob): Promise<{ width: number; height: number; img: HTMLImageElement; url: string }> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  return new Promise((resolve, reject) => {
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight, img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The image could not be opened.'));
    };
    img.src = url;
  });
}

async function probeImage(file: Blob): Promise<Probe> {
  // Las medidas salen de la cabecera (ya con la orientación de la foto aplicada, como la muestra el
  // navegador). La miniatura se decodifica ya reducida (`resizeWidth`/`resizeHeight`): una foto de 48 MP
  // entera en memoria puede cerrar la app en el iPhone. Se pide solo el lado mayor, para que el otro salga
  // proporcional aunque el navegador aplique la orientación antes o después de reducir.
  const { width, height, img, url } = await imageSize(file);
  try {
    const side = Math.min(THUMB_SIDE, Math.max(width, height));
    let thumb: Blob | null = null;
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: 'from-image',
        resizeQuality: 'high',
        ...(width >= height ? { resizeWidth: side } : { resizeHeight: side }),
      });
      try {
        thumb = await toThumb(bitmap, bitmap.width, bitmap.height);
      } finally {
        bitmap.close();
      }
    } catch {
      // Un navegador sin las opciones de reducción: se dibuja la imagen ya cargada.
      thumb = await toThumb(img, width, height).catch(() => null);
    }
    return { width: dimension(width), height: dimension(height), duration: null, thumb };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function probeVideo(file: Blob): Promise<Probe> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('The video could not be opened.'));
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

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Lo que dice un archivo que un dueño o admin mandó a la papelera de Drive. */
export const DELETED_LABEL = 'File deleted (in the Drive trash)';

/**
 * Un archivo que un dueño o admin mandó a la papelera de Drive (papelera de archivos): la miniatura
 * oscurecida, si la hay, con el aviso y el nombre; sin miniatura, el ícono. Es un SVG sin scripts, como
 * dirección `data:`, con la miniatura adentro (un `<img>` no carga nada de afuera de un SVG).
 */
export async function deletedUrl(kind: MediaKind | null, name: string, thumb: Blob | null): Promise<string> {
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
    `<text x="240" y="130" text-anchor="middle" font-family="system-ui, sans-serif" font-size="20" font-weight="600" fill="${ink}">${escapeXml(DELETED_LABEL)}</text>` +
    `<text x="240" y="162" text-anchor="middle" font-family="system-ui, sans-serif" font-size="15" fill="${ink}">${glyph ? `${glyph} ` : ''}${label}</text>` +
    '</svg>';
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Un ícono para el archivo que todavía no tiene miniatura (o que el navegador no puede mostrar), con su
 * nombre. Es un SVG sin scripts, como dirección `data:`.
 */
export function placeholderUrl(kind: MediaKind | null, label: string): string {
  const text = escapeXml(label.length > 46 ? `${label.slice(0, 45)}…` : label);
  const glyph =
    kind === 'video'
      ? '<circle cx="240" cy="112" r="34" fill="#00000066"/><path d="M229 94 L260 112 L229 130 Z" fill="#fff"/>'
      : '<rect x="206" y="86" width="68" height="52" rx="6" fill="none" stroke="#8a8580" stroke-width="5"/><circle cx="226" cy="104" r="7" fill="#8a8580"/><path d="M210 134 L234 112 L250 126 L258 118 L272 134 Z" fill="#8a8580"/>';
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270">' +
    '<rect width="480" height="270" rx="8" fill="#ebe8e4"/>' +
    glyph +
    `<text x="240" y="196" text-anchor="middle" font-family="system-ui, sans-serif" font-size="17" fill="#5c5853">${text}</text>` +
    '</svg>';
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
