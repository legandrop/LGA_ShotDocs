import { RasterError } from '../media/rasterError';

/** PNG generado y completo antes de habilitar Copy; no añade otro decoder. */
export async function checkCopyPng(blob: Blob, width: number, height: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (blob.type !== 'image/png' || blob.size < 33) throw new RasterError('encode');
  const head = new Uint8Array(await blob.slice(0, 33).arrayBuffer());
  signal.throwIfAborted();
  const v = new DataView(head.buffer);
  if (head.length !== 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => head[i] === b) ||
    v.getUint32(8) !== 13 || String.fromCharCode(...head.slice(12, 16)) !== 'IHDR' ||
    v.getUint32(16) !== width || v.getUint32(20) !== height) throw new RasterError('encode');
}

/** Se comprueba capacidad sin consultar permisos ni leer el portapapeles. */
export function canCopyImage(): boolean {
  try {
    return globalThis.isSecureContext === true && typeof ClipboardItem === 'function' &&
      typeof navigator.clipboard?.write === 'function' &&
      (typeof ClipboardItem.supports !== 'function' || ClipboardItem.supports('image/png'));
  } catch { return false; }
}

/** El llamador trae PNG listo: write se invoca en este mismo gesto, sin await previo. */
export function copyImage(blob: Blob): Promise<void> {
  try {
    if (!canCopyImage() || blob.type !== 'image/png' || !blob.size) throw new Error('La imagen PNG no está lista para copiar');
    return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  } catch (error) { return Promise.reject(error); }
}
