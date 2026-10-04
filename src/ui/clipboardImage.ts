export { checkRasterPng as checkCopyPng } from '../media/rasterPng';

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
