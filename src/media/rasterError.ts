export type RasterFailure = 'unsupported' | 'size' | 'annotations' | 'source' | 'encode';
export class RasterError extends Error {
  constructor(public readonly reason: RasterFailure) { super(`No se puede preparar la foto anotada: ${reason}`); }
}
export function checkRasterAbort(signal: AbortSignal): void { signal.throwIfAborted(); }
