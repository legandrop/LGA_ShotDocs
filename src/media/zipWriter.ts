// Un zip escrito de a pedazos, a medida que llegan los archivos (Docs/Doc_Carpetas.md, sección 9, "Download all").
// Sin comprimir (método 0, *store*): lo de VFX ya viene comprimido, y así no hay nada que calcular más que el CRC32.
// Como el CRC se sabe recién al final de cada archivo, cada uno lleva su "descriptor" después de los datos (bit 3):
// nunca hay que volver atrás en lo escrito, así sirve para un archivo del disco que se escribe de corrido y para un
// `Blob` en memoria. Zip64 (APPNOTE 6.3.x, 4.5.3) cuando un archivo pesa 4 GiB o más, cuando lo escrito pasa los
// 4 GiB o con más de 65.534 cosas. Los nombres van en UTF-8 (bit 11).

import { localCrc, type CrcStream } from './crc32';

/** Adónde va el zip: un archivo del disco (`FileSystemWritableFileStream`) o pedazos de un `Blob`. */
export interface ZipSink {
  /** Escribe en orden. Al terminar la promesa, el pedazo ya no se usa (se le puede pasar al Worker del CRC). */
  write(chunk: Uint8Array): Promise<void>;
}

const U32 = 0xffffffff;
const U16 = 0xffff;
const SIG_LOCAL = 0x04034b50;
const SIG_DESCRIPTOR = 0x08074b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const SIG_END64 = 0x06064b50;
const SIG_LOCATOR64 = 0x07064b50;
const FLAG_DESCRIPTOR = 0x0008;
const FLAG_UTF8 = 0x0800;
// Hecho por: Unix (3) con la versión 4.5 (Zip64); así los permisos de abajo valen en la Mac y en Linux.
const MADE_BY = (3 << 8) | 45;
const FILE_ATTRS = ((0o100644 << 16) | 0x20) >>> 0;
const DIR_ATTRS = ((0o040755 << 16) | 0x10) >>> 0;

interface CentralEntry {
  name: Uint8Array;
  dir: boolean;
  zip64: boolean;
  crc: number;
  size: number;
  offset: number;
  time: number;
  date: number;
}

/** Lo que dejó un archivo: cuánto pesó, su CRC y si se cortó a la mitad (`error`: por qué). */
export interface ZipFileResult {
  size: number;
  crc: number;
  /** El archivo quedó en el zip con lo que llegó hasta ese momento: el zip sigue siendo válido. */
  error?: unknown;
}

export class ZipWriter {
  private entries: CentralEntry[] = [];
  private written = 0;
  private finished = false;

  constructor(
    private readonly sink: ZipSink,
    private readonly opts: { crc?: () => CrcStream; forceZip64?: boolean } = {},
  ) {}

  /** Cuánto se escribió hasta ahora. */
  get offset(): number {
    return this.written;
  }

  private async put(chunk: Uint8Array): Promise<void> {
    await this.sink.write(chunk);
    this.written += chunk.length;
  }

  /** Una carpeta (`ruta/`): las vacías tienen que estar para que existan al abrir el zip. */
  async addDirectory(path: string, modified?: Date | null): Promise<void> {
    const name = encodeName(path.endsWith('/') ? path : `${path}/`);
    const { time, date } = dosTime(modified);
    const offset = this.written;
    await this.put(localHeader(name, { flags: FLAG_UTF8, time, date, crc: 0, size: 0, zip64: false, descriptor: false }));
    this.entries.push({ name, dir: true, zip64: false, crc: 0, size: 0, offset, time, date });
  }

  /**
   * Un archivo, con sus bytes de a pedazos. `expected`: lo que se espera que pese (decide si va con Zip64: hay que
   * saberlo antes de escribir el encabezado). Si los pedazos fallan en el medio, el archivo se cierra con lo que
   * llegó (el zip sigue siendo válido) y se devuelve `error`: quien llama lo anota como incompleto. Si lo escrito
   * va a pasar 4 GiB en un archivo sin Zip64 (Drive dijo un peso menor que el real), falla todo: no hay forma de
   * arreglar un encabezado ya escrito.
   */
  async addFile(path: string, expected: number | null, modified: Date | null | undefined, chunks: AsyncIterable<Uint8Array>): Promise<ZipFileResult> {
    const name = encodeName(path);
    const { time, date } = dosTime(modified);
    const zip64 = !!this.opts.forceZip64 || expected === null || expected >= U32;
    const offset = this.written;
    await this.put(localHeader(name, { flags: FLAG_UTF8 | FLAG_DESCRIPTOR, time, date, crc: 0, size: 0, zip64, descriptor: true }));
    const crc = (this.opts.crc ?? localCrc)();
    let size = 0;
    let error: unknown;
    // Los errores de los pedazos (la red) cierran el archivo con lo que llegó; los del destino (el disco) suben.
    const source = chunks[Symbol.asyncIterator]();
    for (;;) {
      let next: IteratorResult<Uint8Array>;
      try {
        next = await source.next();
      } catch (err) {
        if (isAbort(err)) throw err;
        error = err;
        break;
      }
      if (next.done) break;
      const chunk = next.value;
      if (!chunk.length) continue;
      if (!zip64 && size + chunk.length >= U32) {
        await source.return?.();
        throw new ZipTooBig(path);
      }
      try {
        await this.put(chunk);
      } catch (err) {
        await source.return?.().catch(() => undefined);
        throw err;
      }
      size += chunk.length;
      crc.update(chunk);
    }
    let sum = 0;
    try {
      sum = await crc.digest();
    } catch (err) {
      error ??= err;
    }
    await this.put(descriptor(sum, size, zip64));
    this.entries.push({ name, dir: false, zip64, crc: sum, size, offset, time, date });
    return error === undefined ? { size, crc: sum } : { size, crc: sum, error };
  }

  /** Escribe el índice del final. Devuelve cuánto pesa el zip. */
  async finish(): Promise<number> {
    if (this.finished) return this.written;
    this.finished = true;
    const start = this.written;
    for (const e of this.entries) await this.put(centralHeader(e));
    const size = this.written - start;
    const count = this.entries.length;
    const needs64 = count >= U16 || start >= U32 || size >= U32 || this.entries.some((e) => e.zip64) || !!this.opts.forceZip64;
    if (needs64) {
      const at = this.written;
      const rec = new Writer(56);
      rec.u32(SIG_END64).u64(44).u16(MADE_BY).u16(45).u32(0).u32(0).u64(count).u64(count).u64(size).u64(start);
      await this.put(rec.bytes);
      const loc = new Writer(20);
      loc.u32(SIG_LOCATOR64).u32(0).u64(at).u32(1);
      await this.put(loc.bytes);
    }
    const end = new Writer(22);
    end
      .u32(SIG_END)
      .u16(0)
      .u16(0)
      .u16(Math.min(count, U16))
      .u16(Math.min(count, U16))
      .u32(size >= U32 ? U32 : size)
      .u32(start >= U32 ? U32 : start)
      .u16(0);
    await this.put(end.bytes);
    return this.written;
  }
}

/** Un archivo sin Zip64 que resultó pesar 4 GiB o más: el zip no se puede terminar bien. */
export class ZipTooBig extends Error {
  constructor(readonly path: string) {
    super(`"${path}" is larger than Google Drive said: the zip could not be finished.`);
  }
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException ? err.name === 'AbortError' : (err as { name?: string } | null)?.name === 'AbortError';
}

/** Cuánto suma el zip a lo que pesan los archivos (encabezados, descriptores e índice), para los topes de memoria. */
export function zipOverhead(names: string[], dirs: number): number {
  let total = 22 + 56 + 20;
  for (const n of names) total += 2 * (encodeName(n).length + 46 + 20) + 24 + 30;
  return total + dirs * 200;
}

const encoder = new TextEncoder();
function encodeName(path: string): Uint8Array {
  return encoder.encode(path);
}

/** La fecha en el formato de MS-DOS (hora local, de a 2 segundos, desde 1980). */
export function dosTime(when: Date | null | undefined): { time: number; date: number } {
  const d = when && !Number.isNaN(when.getTime()) ? when : new Date();
  const year = d.getFullYear();
  if (year < 1980) return { time: 0, date: (0 << 9) | (1 << 5) | 1 };
  if (year > 2107) return { time: (23 << 11) | (59 << 5) | 29, date: (127 << 9) | (12 << 5) | 31 };
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

function localHeader(
  name: Uint8Array,
  h: { flags: number; time: number; date: number; crc: number; size: number; zip64: boolean; descriptor: boolean },
): Uint8Array {
  const extra = h.zip64 ? 20 : 0;
  const w = new Writer(30 + name.length + extra);
  w.u32(SIG_LOCAL)
    .u16(h.zip64 ? 45 : 20)
    .u16(h.flags)
    .u16(0)
    .u16(h.time)
    .u16(h.date)
    .u32(h.crc)
    .u32(h.zip64 ? U32 : h.size)
    .u32(h.zip64 ? U32 : h.size)
    .u16(name.length)
    .u16(extra);
  w.raw(name);
  // Con Zip64 y descriptor, los pesos del encabezado van en 0 y los de verdad en el descriptor (de 8 bytes).
  if (h.zip64) w.u16(0x0001).u16(16).u64(0).u64(0);
  return w.bytes;
}

function descriptor(crc: number, size: number, zip64: boolean): Uint8Array {
  const w = new Writer(zip64 ? 24 : 16);
  w.u32(SIG_DESCRIPTOR).u32(crc);
  if (zip64) w.u64(size).u64(size);
  else w.u32(size).u32(size);
  return w.bytes;
}

function centralHeader(e: CentralEntry): Uint8Array {
  // En el índice, Zip64 solo para lo que no entra en 32 bits (y siempre si el archivo lo usó en su encabezado).
  const bigSize = e.zip64 || e.size >= U32;
  const bigOffset = e.offset >= U32;
  const extraLen = (bigSize ? 16 : 0) + (bigOffset ? 8 : 0);
  const extra = extraLen ? extraLen + 4 : 0;
  const w = new Writer(46 + e.name.length + extra);
  w.u32(SIG_CENTRAL)
    .u16(MADE_BY)
    .u16(bigSize || bigOffset ? 45 : 20)
    .u16(FLAG_UTF8 | (e.dir ? 0 : FLAG_DESCRIPTOR))
    .u16(0)
    .u16(e.time)
    .u16(e.date)
    .u32(e.crc)
    .u32(bigSize ? U32 : e.size)
    .u32(bigSize ? U32 : e.size)
    .u16(e.name.length)
    .u16(extra)
    .u16(0)
    .u16(0)
    .u16(0)
    .u32(e.dir ? DIR_ATTRS : FILE_ATTRS)
    .u32(bigOffset ? U32 : e.offset);
  w.raw(e.name);
  if (extra) {
    w.u16(0x0001).u16(extraLen);
    if (bigSize) w.u64(e.size).u64(e.size);
    if (bigOffset) w.u64(e.offset);
  }
  return w.bytes;
}

/** Escribe enteros little-endian en un buffer de largo fijo. */
class Writer {
  readonly bytes: Uint8Array;
  private view: DataView;
  private at = 0;
  constructor(size: number) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }
  u16(v: number): this {
    this.view.setUint16(this.at, v, true);
    this.at += 2;
    return this;
  }
  u32(v: number): this {
    this.view.setUint32(this.at, v >>> 0, true);
    this.at += 4;
    return this;
  }
  u64(v: number): this {
    this.view.setUint32(this.at, v % 0x100000000, true);
    this.view.setUint32(this.at + 4, Math.floor(v / 0x100000000), true);
    this.at += 8;
    return this;
  }
  raw(b: Uint8Array): this {
    this.bytes.set(b, this.at);
    this.at += b.length;
    return this;
  }
}
