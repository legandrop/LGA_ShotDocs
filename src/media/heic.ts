// Fotos HEIC/HEIF (las del iPhone) al agregarlas a una página (Docs/Doc_Imagenes.md, "Fotos HEIC").
//
// Chrome no sabe decodificar HEIC: sin conversión, la foto se guarda y se sube pero no tiene miniatura y la
// página no la muestra. Por eso la cola (`MediaQueue.add`) la pasa a JPEG en el dispositivo antes de guardarla:
// lo que queda en la página, en el dispositivo y en el Drive es el JPEG. El archivo de la persona no se toca.
//
// Acá va lo que no necesita el decodificador: reconocer un HEIC (por el tipo o por la firma), el nombre del
// JPEG, y el perfil de color (sacarlo del HEIC y meterlo en el JPEG). El decodificador (libheif en wasm) se
// carga aparte y solo cuando llega un HEIC (`heicConvert.ts`). Es el mismo trabajo que hace el comando que baja
// un doc de Coda (`scripts/lib/codaHeic.mjs`), con `Uint8Array` en vez de `Buffer`.

/** Los tipos que el navegador informa para un HEIC (cuando informa alguno). */
const HEIC_TYPES = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);
/** Marcas de la caja `ftyp` de una imagen HEVC (HEIC). */
const HEVC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs']);
/** Marcas genéricas de HEIF: valen como HEIC salvo que el archivo diga que es AVIF (que Chrome sí muestra). */
const HEIF_BRANDS = new Set(['mif1', 'msf1']);
const AVIF_BRANDS = new Set(['avif', 'avis']);
/** Cuántos bytes del principio alcanzan para leer la caja `ftyp`. */
export const HEIC_HEAD_BYTES = 64;

/** El tipo de JPEG y la calidad de la conversión (alta, sin que el archivo se dispare; igual que el comando). */
export const JPEG_TYPE = 'image/jpeg';
export const JPEG_QUALITY = 0.92;

/** Lo que el navegador dice del tipo es de un HEIC. */
export function isHeicType(type: string | undefined | null): boolean {
  return HEIC_TYPES.has((type ?? '').split(';')[0].trim().toLowerCase());
}

const ascii = (bytes: Uint8Array, at: number, length = 4): string =>
  at + length <= bytes.length ? String.fromCharCode(...bytes.subarray(at, at + length)) : '';

const readUint32 = (bytes: Uint8Array, at: number): number =>
  ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;

const readUint16 = (bytes: Uint8Array, at: number): number => (bytes[at] << 8) | bytes[at + 1];

/**
 * Si esos bytes (el principio del archivo) son de un HEIC: una caja `ftyp` con marca principal de HEVC (`heic`,
 * `heix`, `hevc`, `heim`, `heis`…), o con la genérica de HEIF (`mif1`, `msf1`) y sin ser un AVIF.
 */
export function isHeicSignature(head: Uint8Array): boolean {
  if (head.length < 12 || ascii(head, 4) !== 'ftyp') return false;
  const major = ascii(head, 8);
  if (HEVC_BRANDS.has(major)) return true;
  if (!HEIF_BRANDS.has(major)) return false;
  // Las marcas compatibles van de a cuatro bytes después de la versión, hasta el final de la caja.
  const end = Math.min(readUint32(head, 0), head.length);
  const brands: string[] = [];
  for (let at = 16; at + 4 <= end; at += 4) brands.push(ascii(head, at));
  if (brands.some((b) => HEVC_BRANDS.has(b))) return true;
  return !brands.some((b) => AVIF_BRANDS.has(b));
}

/**
 * Si el archivo es un HEIC: por la firma (muchas veces el navegador no informa el tipo, o dice
 * `application/octet-stream`) o, si no se puede leer, por el tipo. Lee solo los primeros bytes; nunca falla.
 */
export async function isHeicFile(file: Blob): Promise<boolean> {
  try {
    const head = new Uint8Array(await file.slice(0, HEIC_HEAD_BYTES).arrayBuffer());
    if (isHeicSignature(head)) return true;
  } catch {
    // Sin poder leerlo, decide el tipo.
  }
  return isHeicType(file.type);
}

/** El nombre del JPEG: la misma base con `.jpg` (`IMG_1234.HEIC` → `IMG_1234.jpg`). */
export function jpegName(name: string | undefined): string {
  const base = (name ?? '').trim().replace(/\.(?:heic|heif|hif)$/i, '');
  if (!base) return 'image.jpg';
  return /\.jpe?g$/i.test(base) ? base : `${base}.jpg`;
}

/**
 * El perfil de color (ICC) de un HEIC: el contenido de su caja `colr` de tipo `prof` (o `rICC`), o `null`. Las
 * fotos del iPhone están en Display P3: el decodificador entrega los píxeles tal cual, sin el perfil, y sin él
 * el JPEG se leería como sRGB y se vería menos saturado.
 */
export function heicColorProfile(heic: Uint8Array): Uint8Array | null {
  for (const type of ['prof', 'rICC']) {
    const mark = `colr${type}`;
    for (let at = indexOfAscii(heic, mark, 0); at >= 0; at = indexOfAscii(heic, mark, at + 1)) {
      if (at < 4) continue;
      const end = at - 4 + readUint32(heic, at - 4);
      if (end > heic.length || end < at + 8) continue;
      const icc = heic.subarray(at + 8, end);
      // Un perfil ICC lleva la firma `acsp` en el byte 36: lo que no la tiene no se copia. Y tiene que ser de
      // color (`RGB ` en el byte 16): el de una imagen auxiliar en grises (profundidad, por ejemplo) no es el de
      // la foto, y se sigue buscando.
      if (icc.length >= 128 && ascii(icc, 36) === 'acsp' && ascii(icc, 16) === 'RGB ') return icc;
    }
  }
  return null;
}

function indexOfAscii(bytes: Uint8Array, text: string, from: number): number {
  const first = text.charCodeAt(0);
  const last = bytes.length - text.length;
  outer: for (let i = Math.max(0, from); i <= last; i++) {
    if (bytes[i] !== first) continue;
    for (let j = 1; j < text.length; j++) if (bytes[i + j] !== text.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
}

const ICC_MARK = 'ICC_PROFILE\0';
/** Cada segmento APP2 lleva hasta 65.519 bytes del perfil (64 KB menos su largo, la firma y dos contadores). */
const ICC_CHUNK = 65519;

/**
 * Un JPEG con el perfil de color adentro: segmentos APP2 `ICC_PROFILE`, después de la cabecera JFIF (APP0) si
 * la hay. Si el JPEG ya traía un perfil (algunos navegadores ponen uno al codificar), se saca: dos perfiles se
 * pisarían. Sin perfil, o si no es un JPEG, devuelve el mismo JPEG.
 */
export function jpegWithProfile(jpeg: Uint8Array, icc: Uint8Array | null): Uint8Array {
  const count = icc ? Math.ceil(icc.length / ICC_CHUNK) : 0;
  if (!icc || !count || count > 255 || jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;
  const body = withoutProfile(jpeg);
  const segments: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const data = icc.subarray(i * ICC_CHUNK, (i + 1) * ICC_CHUNK);
    const head = new Uint8Array(18);
    head[0] = 0xff;
    head[1] = 0xe2;
    head[2] = ((data.length + 16) >> 8) & 0xff;
    head[3] = (data.length + 16) & 0xff;
    for (let k = 0; k < ICC_MARK.length; k++) head[4 + k] = ICC_MARK.charCodeAt(k);
    head[16] = i + 1;
    head[17] = count;
    segments.push(head, data);
  }
  // La cabecera JFIF (APP0), si está, tiene que seguir siendo lo primero.
  const at = body[2] === 0xff && body[3] === 0xe0 && body.length >= 6 ? 4 + readUint16(body, 4) : 2;
  return concat([body.subarray(0, at), ...segments, body.subarray(at)]);
}

/** El JPEG sin los segmentos APP2 `ICC_PROFILE` de la cabecera (hasta el comienzo de la imagen, `SOS`). */
function withoutProfile(jpeg: Uint8Array): Uint8Array {
  const keep: Uint8Array[] = [jpeg.subarray(0, 2)];
  let at = 2;
  let removed = false;
  while (at + 4 <= jpeg.length && jpeg[at] === 0xff) {
    const marker = jpeg[at + 1];
    // SOS (los datos de la imagen) o algo que no lleva largo: de acá en adelante va tal cual.
    if (marker === 0xda || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) break;
    const end = at + 2 + readUint16(jpeg, at + 2);
    if (end > jpeg.length) break;
    if (marker === 0xe2 && ascii(jpeg, at + 4, ICC_MARK.length) === ICC_MARK) removed = true;
    else keep.push(jpeg.subarray(at, end));
    at = end;
  }
  if (!removed) return jpeg;
  keep.push(jpeg.subarray(at));
  return concat(keep);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Si esos bytes empiezan como un JPEG (`FF D8 FF`). */
export function isJpegStart(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * Por qué no se pudo convertir: `unavailable`, el decodificador no se pudo cargar (sin red y sin haberlo
 * bajado nunca, por ejemplo: se vuelve a probar más tarde); `failed`, se cargó pero la foto no se pudo
 * convertir (un archivo roto, falta de memoria: no se vuelve a probar).
 */
export type HeicFailure = 'unavailable' | 'failed';

export class HeicError extends Error {
  constructor(
    readonly reason: HeicFailure,
    message: string,
  ) {
    super(message);
    this.name = 'HeicError';
  }
}

/** El motivo de un error de conversión (lo que no es un `HeicError` cuenta como `failed`). */
export function heicFailure(err: unknown): HeicFailure {
  return err instanceof HeicError ? err.reason : 'failed';
}
