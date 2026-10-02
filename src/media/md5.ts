// MD5 por tramos, para comparar el original de este dispositivo con el `md5Checksum` que da Google Drive antes de
// liberarlo (Docs/Doc_Copias_Locales.md, sección 5.3). El navegador no trae MD5 (`crypto.subtle` no lo tiene): esta
// es la de la RFC 1321, que lee el archivo de a 8 MiB para no cargar un video entero en memoria. No se usa para nada
// de seguridad, solo para saber si dos copias son el mismo archivo.

/** De a cuánto se lee el archivo. */
export const MD5_CHUNK = 8 * 1024 * 1024;

const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

export class Md5 {
  private a = 0x67452301;
  private b = 0xefcdab89;
  private c = 0x98badcfe;
  private d = 0x10325476;
  /** Lo que quedó sin completar un bloque de 64 bytes. */
  private readonly buffer = new Uint8Array(64);
  private buffered = 0;
  private length = 0;
  private readonly words = new Uint32Array(16);

  update(bytes: Uint8Array): this {
    this.length += bytes.length;
    let at = 0;
    if (this.buffered > 0) {
      const take = Math.min(64 - this.buffered, bytes.length);
      this.buffer.set(bytes.subarray(0, take), this.buffered);
      this.buffered += take;
      at = take;
      if (this.buffered < 64) return this;
      this.block(this.buffer, 0);
      this.buffered = 0;
    }
    for (; at + 64 <= bytes.length; at += 64) this.block(bytes, at);
    if (at < bytes.length) {
      this.buffer.set(bytes.subarray(at), 0);
      this.buffered = bytes.length - at;
    }
    return this;
  }

  /** El MD5 en hexadecimal, en minúsculas (como `md5Checksum` de Drive). */
  digest(): string {
    const bits = this.length * 8;
    const tail = new Uint8Array(this.buffered < 56 ? 64 - this.buffered : 128 - this.buffered);
    tail[0] = 0x80;
    const view = new DataView(tail.buffer);
    // El largo en bits, en 64 bits little-endian (el alto aparte: un archivo de más de 512 MB pasa 2^32 bits).
    view.setUint32(tail.length - 8, bits >>> 0, true);
    view.setUint32(tail.length - 4, Math.floor(bits / 2 ** 32) >>> 0, true);
    const length = this.length;
    this.update(tail);
    this.length = length;
    let hex = '';
    for (const word of [this.a, this.b, this.c, this.d]) {
      for (let i = 0; i < 4; i++) hex += ((word >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
    }
    return hex;
  }

  private block(bytes: Uint8Array, at: number): void {
    const w = this.words;
    for (let i = 0; i < 16; i++) {
      const j = at + i * 4;
      w[i] = (bytes[j] | (bytes[j + 1] << 8) | (bytes[j + 2] << 16) | (bytes[j + 3] << 24)) >>> 0;
    }
    let a = this.a;
    let b = this.b;
    let c = this.c;
    let d = this.d;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const sum = (a + f + K[i] + w[g]) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << S[i]) | (sum >>> (32 - S[i])))) >>> 0;
    }
    this.a = (this.a + a) >>> 0;
    this.b = (this.b + b) >>> 0;
    this.c = (this.c + c) >>> 0;
    this.d = (this.d + d) >>> 0;
  }
}

/** El MD5 de un archivo, leído de a `MD5_CHUNK` (cede el hilo entre tramo y tramo). */
export async function md5Blob(blob: Blob, chunk = MD5_CHUNK, signal?: AbortSignal): Promise<string> {
  const md5 = new Md5();
  for (let at = 0; at < blob.size; at += chunk) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    md5.update(new Uint8Array(await blob.slice(at, Math.min(at + chunk, blob.size)).arrayBuffer()));
  }
  return md5.digest();
}
