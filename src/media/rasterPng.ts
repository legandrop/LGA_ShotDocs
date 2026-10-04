import { RasterError } from './rasterError';

/** Comprueba el PNG codificado y sus dimensiones sin añadir otro decodificador. */
export async function checkRasterPng(blob: Blob, width: number, height: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (blob.type !== 'image/png' || blob.size < 33) throw new RasterError('encode');
  const head = new Uint8Array(await blob.slice(0, 33).arrayBuffer());
  signal.throwIfAborted();
  const v = new DataView(head.buffer);
  if (head.length !== 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => head[i] === b) ||
    v.getUint32(8) !== 13 || String.fromCharCode(...head.slice(12, 16)) !== 'IHDR' ||
    v.getUint32(16) !== width || v.getUint32(20) !== height) throw new RasterError('encode');
}
