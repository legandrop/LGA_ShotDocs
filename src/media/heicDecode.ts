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

/**
 * Lo más grande que se convierte: 50 megapíxeles. Entra la foto más grande de un iPhone (48 MP, 8064 × 6048) y
 * el pico de memoria queda cerca de 800 MB (por píxel: 4 bytes de la foto decodificada, otros tantos adentro de
 * la librería y en el canvas, y otra vez al comprobar el JPEG). Con 100 MP serían 1,6 GB. Una foto más grande
 * queda como HEIC, con su aviso.
 */
export const MAX_PIXELS = 50_000_000;

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

/** Comprueba que el JPEG sea la foto; tira `HeicError('failed')` si no. */
export type JpegCheck = (jpeg: Uint8Array, pixels: Pixels) => Promise<void>;

/** Cuántos puntos de la foto se comparan (una grilla de 4 × 4) y de qué lado es cada cuadradito. */
const CHECK_GRID = 4;
const CHECK_BLOCK = 8;
/** Cuánto puede diferir el promedio de un cuadradito (de 0 a 255): mucho más que lo que cambia un JPEG de 0,92. */
const CHECK_TOLERANCE = 64;
/**
 * Los puntos que más se apartan del fondo: se buscan en una grilla de hasta 48 × 48 cuadraditos de 4 × 4, y se
 * comparan los 12 más distintos, si se apartan del fondo en más de 40 (de 0 a 255, en luminancia).
 */
const SALIENT_GRID = 48;
const SALIENT_BLOCK = 4;
const SALIENT_POINTS = 12;
const SALIENT_MIN = 40;

/** La luminancia (la misma fórmula que usa el JPEG para su canal Y, que guarda con más detalle que el color). */
const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

function blankCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** El promedio de cada canal (R, G, B) de un cuadradito de lado `block` en (x, y) de los píxeles decodificados. */
function blockMean(pixels: Pixels, x: number, y: number, block: number): [number, number, number] {
  const sum = [0, 0, 0];
  for (let dy = 0; dy < block; dy++) {
    for (let dx = 0; dx < block; dx++) {
      const at = ((y + dy) * pixels.width + x + dx) * 4;
      sum[0] += pixels.data[at];
      sum[1] += pixels.data[at + 1];
      sum[2] += pixels.data[at + 2];
    }
  }
  const n = block * block;
  return [sum[0] / n, sum[1] / n, sum[2] / n];
}

/** Lo mismo, de una tira de cuadraditos leída del JPEG (`readBlocks`). */
function stripMean(read: Uint8ClampedArray, count: number, i: number, block: number): [number, number, number] {
  const sum = [0, 0, 0];
  for (let dy = 0; dy < block; dy++) {
    for (let dx = 0; dx < block; dx++) {
      const at = (dy * block * count + i * block + dx) * 4;
      sum[0] += read[at];
      sum[1] += read[at + 1];
      sum[2] += read[at + 2];
    }
  }
  const n = block * block;
  return [sum[0] / n, sum[1] / n, sum[2] / n];
}

/** Los cuadraditos del JPEG en esos puntos, uno al lado del otro en una tira (una sola lectura del canvas). */
function readBlocks(bitmap: ImageBitmap, points: [number, number][], block: number): Uint8ClampedArray {
  const strip = blankCanvas(block * points.length, block);
  const ctx = strip?.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new HeicError('failed', 'No canvas to check the JPEG.');
  points.forEach(([x, y], i) => ctx.drawImage(bitmap, x, y, block, block, i * block, 0, block, block));
  return ctx.getImageData(0, 0, block * points.length, block).data;
}

/**
 * Los puntos de la foto que más se apartan de su fondo (la mediana de la luminancia): el texto de un documento,
 * el horizonte de un cielo. Un canvas vacío (todo blanco o todo negro) se parece al fondo de una foto casi toda
 * de ese color, y en una grilla pareja podría pasar; en estos puntos, no. Sin ninguno (una foto lisa), ninguno.
 */
function salientPoints(pixels: Pixels): { points: [number, number][]; lumas: number[]; background: number } {
  const block = Math.min(SALIENT_BLOCK, pixels.width, pixels.height);
  const across = Math.max(1, Math.min(SALIENT_GRID, Math.floor(pixels.width / block)));
  const down = Math.max(1, Math.min(SALIENT_GRID, Math.floor(pixels.height / block)));
  const candidates: { x: number; y: number; luma: number }[] = [];
  for (let row = 0; row < down; row++) {
    for (let col = 0; col < across; col++) {
      const x = Math.floor(((col + 0.5) / across) * (pixels.width - block));
      const y = Math.floor(((row + 0.5) / down) * (pixels.height - block));
      candidates.push({ x, y, luma: luma(...blockMean(pixels, x, y, block)) });
    }
  }
  const sorted = candidates.map((c) => c.luma).sort((a, b) => a - b);
  const background = sorted[Math.floor(sorted.length / 2)];
  const chosen = candidates
    .filter((c) => Math.abs(c.luma - background) > SALIENT_MIN)
    .sort((a, b) => Math.abs(b.luma - background) - Math.abs(a.luma - background))
    .slice(0, SALIENT_POINTS);
  return { points: chosen.map((c) => [c.x, c.y]), lumas: chosen.map((c) => c.luma), background };
}

/**
 * El JPEG se vuelve a abrir y se compara con lo decodificado: tiene que decodificar, medir lo mismo que el HEIC
 * y parecerse. Lo que devuelve un canvas no es de fiar a ciegas: pasado su tope de área (16,7 MP en iOS) puede
 * salir vacío, blanco o negro, y hay navegadores que alteran lo que se lee de un canvas. Si no coincide, la
 * conversión cuenta como fallida y queda el HEIC. Dos comparaciones:
 *   - una grilla pareja de 4 × 4 cuadraditos de 8 × 8 (el promedio de cada canal, con tolerancia amplia): más de
 *     la mitad distintos es otra cosa (vacío, ruido);
 *   - los puntos que más se apartan del fondo de la foto (`salientPoints`), en luminancia, que el JPEG guarda
 *     casi exacta: en cada uno el JPEG tiene que estar más cerca de la foto que del fondo. Si más de la mitad
 *     no, es un canvas vacío del color del fondo (una foto casi toda blanca, como un documento o un cielo,
 *     pasaba la grilla pareja con un canvas en blanco).
 */
export const checkJpeg: JpegCheck = async (jpeg, pixels) => {
  if (typeof createImageBitmap !== 'function') throw new HeicError('failed', 'This browser cannot check the JPEG.');
  let bitmap: ImageBitmap;
  try {
    // Sin aplicar el perfil de color: se comparan los valores tal cual están guardados.
    bitmap = await createImageBitmap(new Blob([jpeg as Uint8Array<ArrayBuffer>], { type: JPEG_TYPE }), { colorSpaceConversion: 'none' });
  } catch {
    throw new HeicError('failed', 'The JPEG does not decode.');
  }
  try {
    if (bitmap.width !== pixels.width || bitmap.height !== pixels.height) {
      throw new HeicError('failed', `The JPEG is ${bitmap.width}×${bitmap.height}, not ${pixels.width}×${pixels.height}.`);
    }
    const block = Math.min(CHECK_BLOCK, pixels.width, pixels.height);
    const points: [number, number][] = [];
    for (let row = 0; row < CHECK_GRID; row++) {
      for (let col = 0; col < CHECK_GRID; col++) {
        points.push([
          Math.floor(((col + 0.5) / CHECK_GRID) * (pixels.width - block)),
          Math.floor(((row + 0.5) / CHECK_GRID) * (pixels.height - block)),
        ]);
      }
    }
    const read = readBlocks(bitmap, points, block);
    let different = 0;
    points.forEach(([x, y], i) => {
      const want = blockMean(pixels, x, y, block);
      const got = stripMean(read, points.length, i, block);
      if (want.some((v, channel) => Math.abs(v - got[channel]) > CHECK_TOLERANCE)) different++;
    });
    // Más de la mitad de los puntos distintos: no es la foto (vacío, negro, ruido).
    if (different * 2 > points.length) throw new HeicError('failed', 'The JPEG does not look like the photo.');

    const salient = salientPoints(pixels);
    if (salient.points.length) {
      const small = Math.min(SALIENT_BLOCK, pixels.width, pixels.height);
      const readSalient = readBlocks(bitmap, salient.points, small);
      let lost = 0;
      salient.lumas.forEach((want, i) => {
        const got = luma(...stripMean(readSalient, salient.points.length, i, small));
        // Más cerca del fondo que de la foto: ese detalle no está en el JPEG.
        if (Math.abs(got - want) > Math.abs(want - salient.background) / 2) lost++;
      });
      if (lost * 2 > salient.points.length) throw new HeicError('failed', 'The JPEG lost the details of the photo.');
    }
  } finally {
    bitmap.close();
  }
};

/** Los píxeles a JPEG, con el perfil de color del HEIC adentro, y comprobado (`checkJpeg`). */
export async function pixelsToJpeg(
  pixels: Pixels,
  heic: Uint8Array,
  encode: JpegEncoder,
  check: JpegCheck = checkJpeg,
): Promise<Uint8Array> {
  const encoded = await encode(pixels, JPEG_QUALITY);
  // Lo que no empieza como un JPEG no se guarda con nombre de JPEG.
  if (!isJpegStart(encoded)) throw new HeicError('failed', 'The encoder did not return a JPEG.');
  const jpeg = jpegWithProfile(encoded, heicColorProfile(heic));
  await check(jpeg, pixels);
  return jpeg;
}

/** Un HEIC entero a JPEG: tamaño completo, calidad 0,92, derecho y con su perfil de color. */
export async function heicToJpeg(lib: Libheif, heic: Uint8Array, encode: JpegEncoder, check: JpegCheck = checkJpeg): Promise<Uint8Array> {
  return pixelsToJpeg(await decodeHeic(lib, heic), heic, encode, check);
}
