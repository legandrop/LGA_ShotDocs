import { crc32Update } from '../media/crc32';

// Leer un zip sin cargarlo entero (P.22, Docs/Doc_Exportar.md, sección 3: volver a Shot Docs). El zip que arma la app
// (`zipWriter.ts`) va sin comprimir, con descriptores y Zip64; quien lo descomprime y lo vuelve a comprimir con el
// Explorador o el Finder lo deja con *deflate*. Los dos se leen: el índice del final (el directorio central) con
// `Blob.slice`, y cada archivo recién cuando se pide (sin comprimir, un pedazo del mismo `Blob`: nada pasa a la
// memoria; con *deflate*, por `DecompressionStream`). Cada archivo se comprueba con su CRC32 al leerlo.
//
// El zip puede venir de cualquiera: un nombre con `..`, absoluto (`/x`, `C:\x`, `\\servidor`), con caracteres de
// control o repetido no se ofrece (queda en `skipped`, con su motivo); tampoco uno cifrado o con otro método. Nada de
// esto escribe en el disco: lo que sale del zip va a la base del navegador por los caminos de siempre.

/** Lo que se puede leer de un archivo (un zip o una carpeta descomprimida). Las rutas, con `/` y sin nada raro. */
export interface ArchiveSource {
  paths(): string[];
  has(path: string): boolean;
  /** Lo que pesa sin comprimir (0 si no está). */
  size(path: string): number;
  /** El texto (UTF-8) de un archivo; más grande que `maxBytes`, un error. */
  text(path: string, maxBytes: number): Promise<string>;
  /** El archivo entero, comprobado; con `type`, ese tipo. */
  blob(path: string, type?: string): Promise<Blob>;
  /**
   * El archivo no se va a poder leer por su tamaño: un *deflate* (un zip vuelto a comprimir) más grande que el tope por
   * archivo. Se sabe sin leerlo (lo dice el índice).
   */
  tooBig(path: string): boolean;
  /** Lo que se dejó afuera, con su motivo. */
  skipped: SkippedEntry[];
}

export interface SkippedEntry {
  name: string;
  why: 'unsafe' | 'encrypted' | 'method' | 'duplicate' | 'range';
}

/** Por qué no se pudo abrir o leer (el texto lo pone quien lo muestra). */
export type ZipErrorCode = 'notZip' | 'damaged' | 'tooBig' | 'tooMany' | 'crc' | 'missing';

export class ZipReadError extends Error {
  constructor(
    readonly code: ZipErrorCode,
    readonly path?: string,
  ) {
    super(path ? `${code}: ${path}` : code);
    this.name = 'ZipReadError';
  }
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const SIG_END64 = 0x06064b50;
const SIG_LOCATOR64 = 0x07064b50;
const U32 = 0xffffffff;
const U16 = 0xffff;

/** Topes del índice: un zip con más cosas que esto no es uno de la app (y no cuelga la pestaña). */
export const MAX_ENTRIES = 300_000;
export const MAX_CENTRAL_BYTES = 96 * 1024 * 1024;
/** De a cuánto se lee para el CRC. */
const CHUNK = 4 * 1024 * 1024;
/**
 * Topes de lo que se descomprime (*deflate*: un zip que alguien volvió a comprimir; el de la app va sin comprimir y no
 * los usa). Por archivo y en total por zip abierto: lo descomprimido se arma como un `Blob` a medida que llega, pero
 * Chromium igual lo tiene en memoria (medido: una entrada de 1 GB sube +1,5 GB el navegador; antes, juntando los
 * pedazos, +2,15 GB). Con 256 MB por archivo el pico queda en unos cientos de MB; lo que pasa el tope (un video grande
 * recomprimido, o un zip de 1 MB que dice 4 GB) se rechaza con su aviso antes de leerlo.
 */
export const MAX_DEFLATE_ENTRY = 256 * 1024 ** 2;
export const MAX_DEFLATE_TOTAL = 4 * 1024 ** 3;

export interface ZipLimits {
  maxDeflateEntry?: number;
  maxDeflateTotal?: number;
}

interface Entry {
  name: string;
  method: number;
  crc: number;
  compressed: number;
  size: number;
  offset: number;
}

/**
 * Una ruta del zip como la ofrece el lector, o `null` si no se ofrece: absoluta, con unidad (`C:`), con `..` o `.`, con
 * partes vacías o caracteres de control. Las barras al revés pasan a `/` (los zips viejos de Windows las usan).
 */
export function safePath(name: string): string | null {
  const p = name.replace(/\\/g, '/');
  if (!p || p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(p)) return null;
  const parts = p.endsWith('/') ? p.slice(0, -1).split('/') : p.split('/');
  if (parts.some((s) => s === '' || s === '.' || s === '..' || /^\s+$/.test(s))) return null;
  return p;
}

const u16 = (v: DataView, at: number) => v.getUint16(at, true);
const u32 = (v: DataView, at: number) => v.getUint32(at, true);
/** Un número de 64 bits: más allá de 2^53 no es un zip de verdad. */
function u64(v: DataView, at: number): number {
  const lo = v.getUint32(at, true);
  const hi = v.getUint32(at + 4, true);
  if (hi > 0x1fffff) throw new ZipReadError('damaged');
  return hi * 0x100000000 + lo;
}

async function bytesOf(blob: Blob, from: number, to: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(from, to).arrayBuffer());
}

const utf8 = new TextDecoder('utf-8');

/** De a cuánto se le pasa lo comprimido al descompresor (una bomba: 16 KB de *deflate* dan como mucho unos 16 MB). */
export const INFLATE_PIECE = 16 * 1024;

/**
 * Lo comprimido de a pedazos chicos y solo cuando el descompresor pide más (`highWaterMark: 0`). Con `blob.stream()` el
 * navegador le pasa pedazos grandes y descomprime cada uno entero antes de que el control vea nada: una bomba (2 MB que
 * descomprimen 2 GB) subía +2 GB antes del corte. Así, lo de más que alcanza a salir queda acotado a un pedazo.
 */
function smallPieces(data: Blob): ReadableStream<Uint8Array> {
  let at = 0;
  return new ReadableStream<Uint8Array>(
    {
      async pull(ctl) {
        if (at >= data.size) {
          ctl.close();
          return;
        }
        const piece = new Uint8Array(await data.slice(at, at + INFLATE_PIECE).arrayBuffer());
        at += piece.length;
        ctl.enqueue(piece);
      },
    },
    { highWaterMark: 0 },
  );
}

/** Lee el índice de un zip. Un archivo que no es zip, o cortado (sin el final), es un error. */
export async function openZip(blob: Blob, limits: ZipLimits = {}): Promise<ArchiveSource> {
  const maxEntry = limits.maxDeflateEntry ?? MAX_DEFLATE_ENTRY;
  const maxTotal = limits.maxDeflateTotal ?? MAX_DEFLATE_TOTAL;
  let inflated = 0;
  if (blob.size < 22) throw new ZipReadError('notZip');
  // El final del directorio está en los últimos 22 bytes más el comentario (hasta 65 535).
  const tailFrom = Math.max(0, blob.size - (22 + U16 + 20));
  const tail = await bytesOf(blob, tailFrom, blob.size);
  const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32(tv, i) === SIG_END && i + 22 + u16(tv, i + 20) === tail.length) {
      end = i;
      break;
    }
  }
  if (end < 0) {
    // Sin el final: un zip cortado (la firma del principio está) o algo que no es zip.
    const head = await bytesOf(blob, 0, 4);
    const isZip = head.length === 4 && new DataView(head.buffer).getUint32(0, true) === SIG_LOCAL;
    throw new ZipReadError(isZip ? 'damaged' : 'notZip');
  }
  let count = u16(tv, end + 10);
  let cdSize = u32(tv, end + 12);
  let cdOffset = u32(tv, end + 16);
  // Zip64: el localizador va justo antes del final.
  if (end >= 20 && u32(tv, end - 20) === SIG_LOCATOR64) {
    const at64 = u64(tv, end - 20 + 8);
    if (at64 + 56 > blob.size) throw new ZipReadError('damaged');
    const e64 = await bytesOf(blob, at64, at64 + 56);
    const v64 = new DataView(e64.buffer);
    if (u32(v64, 0) !== SIG_END64) throw new ZipReadError('damaged');
    count = u64(v64, 32);
    cdSize = u64(v64, 40);
    cdOffset = u64(v64, 48);
  } else if (count === U16 || cdSize === U32 || cdOffset === U32) {
    throw new ZipReadError('damaged');
  }
  if (count > MAX_ENTRIES) throw new ZipReadError('tooMany');
  if (cdSize > MAX_CENTRAL_BYTES) throw new ZipReadError('tooBig');
  if (cdOffset + cdSize > blob.size) throw new ZipReadError('damaged');
  const cd = await bytesOf(blob, cdOffset, cdOffset + cdSize);
  const v = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const entries = new Map<string, Entry>();
  const skipped: SkippedEntry[] = [];
  let at = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > cd.length || u32(v, at) !== SIG_CENTRAL) throw new ZipReadError('damaged');
    const flags = u16(v, at + 8);
    const method = u16(v, at + 10);
    const crc = u32(v, at + 16);
    let compressed = u32(v, at + 20);
    let size = u32(v, at + 24);
    const nameLen = u16(v, at + 28);
    const extraLen = u16(v, at + 30);
    const commentLen = u16(v, at + 32);
    let offset = u32(v, at + 42);
    if (at + 46 + nameLen + extraLen + commentLen > cd.length) throw new ZipReadError('damaged');
    const raw = utf8.decode(cd.subarray(at + 46, at + 46 + nameLen));
    // Zip64: los valores que no entran en 32 bits van en el campo extra 0x0001, en ese orden.
    let x = at + 46 + nameLen;
    const xEnd = x + extraLen;
    while (x + 4 <= xEnd) {
      const id = u16(v, x);
      const len = u16(v, x + 2);
      if (id === 0x0001) {
        let p = x + 4;
        const need = (field: number) => field === U32 && p + 8 <= x + 4 + len;
        if (need(size)) {
          size = u64(v, p);
          p += 8;
        }
        if (need(compressed)) {
          compressed = u64(v, p);
          p += 8;
        }
        if (need(offset)) {
          offset = u64(v, p);
          p += 8;
        }
      }
      x += 4 + len;
    }
    at += 46 + nameLen + extraLen + commentLen;
    if (raw.endsWith('/') || raw.endsWith('\\')) continue;
    const name = safePath(raw);
    if (!name) {
      skipped.push({ name: raw, why: 'unsafe' });
      continue;
    }
    if (flags & 0x0001) {
      skipped.push({ name, why: 'encrypted' });
      continue;
    }
    if (method !== 0 && method !== 8) {
      skipped.push({ name, why: 'method' });
      continue;
    }
    if (offset + 30 > cdOffset || (method === 0 && compressed !== size)) {
      skipped.push({ name, why: 'range' });
      continue;
    }
    if (entries.has(name)) {
      skipped.push({ name, why: 'duplicate' });
      continue;
    }
    entries.set(name, { name, method, crc, compressed, size, offset });
  }

  /** Dónde empiezan los datos de un archivo (después de su cabecera local, que repite el nombre). */
  const dataStart = async (e: Entry): Promise<number> => {
    const head = await bytesOf(blob, e.offset, e.offset + 30);
    const hv = new DataView(head.buffer);
    if (head.length < 30 || u32(hv, 0) !== SIG_LOCAL) throw new ZipReadError('damaged', e.name);
    const start = e.offset + 30 + u16(hv, 26) + u16(hv, 28);
    if (start + e.compressed > cdOffset) throw new ZipReadError('damaged', e.name);
    return start;
  };

  const get = (path: string): Entry => {
    const e = entries.get(path);
    if (!e) throw new ZipReadError('missing', path);
    return e;
  };

  /** El archivo descomprimido, con su CRC comprobado; más grande que `max`, un error. */
  const read = async (e: Entry, max: number, type: string): Promise<Blob> => {
    if (e.size > max) throw new ZipReadError('tooBig', e.name);
    const start = await dataStart(e);
    const data = blob.slice(start, start + e.compressed);
    let crc = 0;
    if (e.method === 0) {
      for (let p = 0; p < data.size; p += CHUNK) crc = crc32Update(crc, new Uint8Array(await data.slice(p, p + CHUNK).arrayBuffer()));
      if (crc !== e.crc) throw new ZipReadError('crc', e.name);
      return type ? data.slice(0, data.size, type) : data;
    }
    // *Deflate*: con tope por archivo y por zip, que se miran ANTES de leer (lo que dice el índice) y se cuidan mientras
    // se descomprime: lo que pasa de lo declarado se corta en ese pedazo (una bomba: dice 1 KB y descomprime 10 GB).
    if (e.size > maxEntry || inflated + e.size > maxTotal) throw new ZipReadError('tooBig', e.name);
    inflated += e.size;
    let total = 0;
    let failure: ZipReadError | null = null;
    const check = new TransformStream<Uint8Array, Uint8Array>(
      {
        transform(chunk, ctl) {
          total += chunk.length;
          if (total > e.size) {
            failure = new ZipReadError('damaged', e.name);
            ctl.error(failure);
            return;
          }
          crc = crc32Update(crc, chunk);
          ctl.enqueue(chunk);
        },
        flush(ctl) {
          if (total !== e.size || crc !== e.crc) {
            failure = new ZipReadError('crc', e.name);
            ctl.error(failure);
          }
        },
      },
      undefined,
      // Sin acumular adelante: lo que sale se pide de a uno.
      { highWaterMark: 0 },
    );
    try {
      // Un `Blob` armado por el navegador a medida que llega (lo grande va al disco), nunca una lista de pedazos en memoria.
      const out = await new Response(smallPieces(data).pipeThrough(new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>).pipeThrough(check) as ReadableStream<Uint8Array>).blob();
      if (failure) throw failure;
      return out.slice(0, out.size, type || '');
    } catch (err) {
      inflated -= e.size;
      throw failure ?? (err instanceof ZipReadError ? err : new ZipReadError('damaged', e.name));
    }
  };

  return {
    skipped,
    paths: () => [...entries.keys()],
    has: (p) => entries.has(p),
    size: (p) => entries.get(p)?.size ?? 0,
    text: async (p, maxBytes) => utf8.decode(new Uint8Array(await (await read(get(p), maxBytes, '')).arrayBuffer())),
    blob: (p, type) => read(get(p), Number.MAX_SAFE_INTEGER, type ?? ''),
    tooBig: (p) => {
      const e = entries.get(p);
      return !!e && e.method === 8 && e.size > maxEntry;
    },
  };
}

/**
 * La carpeta descomprimida (lo que da `<input type="file" webkitdirectory>`): las rutas sin la carpeta elegida. Sin
 * CRC que comprobar; las mismas reglas para los nombres.
 */
export function folderSource(files: Iterable<File>): ArchiveSource {
  const byPath = new Map<string, File>();
  const skipped: SkippedEntry[] = [];
  for (const f of files) {
    const rel = (f.webkitRelativePath || f.name).split('/').slice(1).join('/') || f.name;
    const p = safePath(rel);
    if (!p) skipped.push({ name: rel, why: 'unsafe' });
    else if (byPath.has(p)) skipped.push({ name: p, why: 'duplicate' });
    else byPath.set(p, f);
  }
  const get = (p: string) => {
    const f = byPath.get(p);
    if (!f) throw new ZipReadError('missing', p);
    return f;
  };
  return {
    skipped,
    paths: () => [...byPath.keys()],
    has: (p) => byPath.has(p),
    size: (p) => byPath.get(p)?.size ?? 0,
    text: async (p, maxBytes) => {
      const f = get(p);
      if (f.size > maxBytes) throw new ZipReadError('tooBig', p);
      return utf8.decode(new Uint8Array(await f.arrayBuffer()));
    },
    blob: async (p, type) => {
      const f = get(p);
      return type ? f.slice(0, f.size, type) : f;
    },
    tooBig: () => false,
  };
}

/** Lo mismo con las rutas adentro de `prefix` (el zip que alguien volvió a comprimir con su carpeta de arriba). */
export function subSource(source: ArchiveSource, prefix: string): ArchiveSource {
  if (!prefix) return source;
  const full = (p: string) => `${prefix}/${p}`;
  return {
    skipped: source.skipped,
    paths: () => source.paths().filter((p) => p.startsWith(`${prefix}/`)).map((p) => p.slice(prefix.length + 1)),
    has: (p) => source.has(full(p)),
    size: (p) => source.size(full(p)),
    text: (p, max) => source.text(full(p), max),
    blob: (p, type) => source.blob(full(p), type),
    tooBig: (p) => source.tooBig(full(p)),
  };
}
