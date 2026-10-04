import { checkRasterAbort, RasterError } from './rasterError';

/** Subconjunto estático cerrado: un único VP8 o VP8L, sin metadatos ni animación. */
export async function webpInfo(blob: Blob, head: Uint8Array, signal: AbortSignal): Promise<{ width: number; height: number }> {
  checkRasterAbort(signal);
  const reject = () => { throw new RasterError('unsupported'); };
  if (head.length < 25 || String.fromCharCode(...head.slice(0, 4)) !== 'RIFF' || String.fromCharCode(...head.slice(8, 12)) !== 'WEBP') return reject();
  const v = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const length = v.getUint32(16, true), kind = String.fromCharCode(...head.slice(12, 16));
  if (v.getUint32(4, true) + 8 !== blob.size || 20 + length + length % 2 !== blob.size) return reject();
  if (kind !== 'VP8 ' && kind !== 'VP8L') return reject();
  if (length % 2) {
    const padding = new Uint8Array(await blob.slice(blob.size - 1).arrayBuffer());
    checkRasterAbort(signal);
    if (padding.length !== 1 || padding[0] !== 0) return reject();
  }
  if (kind === 'VP8 ') {
    if (length < 10 || head.length < 30) return reject();
    const tag = head[20] + head[21] * 256 + head[22] * 65536, partition = tag >>> 5;
    if ((tag & 1) || ((tag >>> 1) & 7) > 3 || !(tag & 16) || partition === 0 || partition > length - 10 ||
      head[23] !== 0x9d || head[24] !== 1 || head[25] !== 0x2a) return reject();
    const width = v.getUint16(26, true), height = v.getUint16(28, true);
    if (!width || !height || width >>> 14 || height >>> 14) return reject();
    return { width, height };
  }
  if (length < 5 || head[20] !== 0x2f) return reject();
  const packed = v.getUint32(21, true);
  if (packed >>> 29) return reject();
  // La pista de alfa no sustituye los píxeles del decodificador nativo.
  return { width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1 };
}
