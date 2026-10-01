// La conversión de un HEIC a JPEG con libheif (Docs/Doc_Imagenes.md, "Fotos HEIC"). Corre en el Web Worker
// (`heic.worker.ts`) y, si el navegador no deja crear uno, en la página. No importa la librería: la recibe, así
// las pruebas la usan en node con la librería de verdad.

import { HeicError, heicColorProfile, isJpegStart, jpegWithProfile, JPEG_QUALITY, JPEG_TYPE } from './heic';

/** Una foto decodificada: RGBA, 4 bytes por píxel, ya derecha (con la rotación del HEIC aplicada). */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

/** Lo que se usa de libheif-js (la parte en JavaScript, que sus tipos no declaran). */
export interface Libheif {
  HeifDecoder: new () => HeifDecoderLike;
  heif_context_free?: (context: unknown) => void;
}

interface HeifDecoderLike {
  decoder: unknown;
  decode(data: Uint8Array): HeifImageLike[];
}

interface HeifImageLike {
  get_width(): number;
  get_height(): number;
  is_primary(): boolean;
  display(target: Pixels, done: (result: unknown) => void): void;
  free(): void;
}

/** Lo más grande que se intenta decodificar (una foto de 100 MP; más que eso no entra en memoria). */
const MAX_PIXELS = 100_000_000;

/**
 * Decodifica la imagen principal del HEIC. libheif aplica la orientación (las cajas `irot`/`imir`): una foto
 * vertical sale vertical. Los píxeles quedan tal cual, en el espacio de color de la foto (el perfil va aparte).
 */
export async function decodeHeic(lib: Libheif, bytes: Uint8Array): Promise<Pixels> {
  const decoder = new lib.HeifDecoder();
  let images: HeifImageLike[] = [];
  try {
    images = decoder.decode(bytes) ?? [];
    const image = images.find((i) => i.is_primary()) ?? images[0];
    if (!image) throw new HeicError('failed', 'The file is not a HEIC photo the decoder can read.');
    const width = image.get_width();
    const height = image.get_height();
    if (!(width > 0 && height > 0) || width * height > MAX_PIXELS) {
      throw new HeicError('failed', `Unsupported HEIC size (${width}×${height}).`);
    }
    const target: Pixels = { width, height, data: new Uint8ClampedArray(width * height * 4) };
    await new Promise<void>((resolve, reject) =>
      image.display(target, (result) => (result ? resolve() : reject(new HeicError('failed', 'The HEIC photo could not be decoded.')))),
    );
    return target;
  } finally {
    for (const image of images) {
      try {
        image.free();
      } catch {
        // Ya liberada.
      }
    }
    try {
      if (decoder.decoder) lib.heif_context_free?.(decoder.decoder);
    } catch {
      // Ya liberado.
    }
  }
}

/** Pasa los píxeles a un JPEG (los bytes). */
export type JpegEncoder = (pixels: Pixels, quality: number) => Promise<Uint8Array>;

/** Dibuja los píxeles tal cual y les pone fondo blanco atrás (un HEIC con transparencia no queda negro). */
function paint(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, pixels: Pixels): void {
  ctx.putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0);
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, pixels.width, pixels.height);
}

/** Con `OffscreenCanvas` (el Worker, o la página). */
export const encodeJpegOffscreen: JpegEncoder = async (pixels, quality) => {
  const canvas = new OffscreenCanvas(pixels.width, pixels.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new HeicError('failed', 'No canvas to encode the JPEG.');
  paint(ctx, pixels);
  const blob = await canvas.convertToBlob({ type: JPEG_TYPE, quality });
  canvas.width = 0;
  canvas.height = 0;
  return new Uint8Array(await blob.arrayBuffer());
};

/** Con un `<canvas>` de la página (un navegador sin `OffscreenCanvas`). */
export const encodeJpegCanvas: JpegEncoder = async (pixels, quality) => {
  const canvas = document.createElement('canvas');
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new HeicError('failed', 'No canvas to encode the JPEG.');
    paint(ctx, pixels);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, JPEG_TYPE, quality));
    if (!blob) throw new HeicError('failed', 'The JPEG could not be encoded.');
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    // Safari tarda en liberar un canvas grande si no se achica a cero.
    canvas.width = 0;
    canvas.height = 0;
  }
};

/** El codificador que tiene este lugar (Worker o página), o `null`. */
export function pickEncoder(): JpegEncoder | null {
  if (typeof OffscreenCanvas !== 'undefined' && typeof OffscreenCanvas.prototype.convertToBlob === 'function') {
    return encodeJpegOffscreen;
  }
  if (typeof document !== 'undefined') return encodeJpegCanvas;
  return null;
}

/** Los píxeles a JPEG, con el perfil de color del HEIC adentro. */
export async function pixelsToJpeg(pixels: Pixels, heic: Uint8Array, encode: JpegEncoder): Promise<Uint8Array> {
  const jpeg = await encode(pixels, JPEG_QUALITY);
  // Lo que no empieza como un JPEG no se guarda con nombre de JPEG.
  if (!isJpegStart(jpeg)) throw new HeicError('failed', 'The encoder did not return a JPEG.');
  return jpegWithProfile(jpeg, heicColorProfile(heic));
}

/** Un HEIC entero a JPEG: tamaño completo, calidad 0,92, derecho y con su perfil de color. */
export async function heicToJpeg(lib: Libheif, heic: Uint8Array, encode: JpegEncoder): Promise<Uint8Array> {
  return pixelsToJpeg(await decodeHeic(lib, heic), heic, encode);
}
