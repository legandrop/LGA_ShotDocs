// libheif (libheif-js, LGPL-3.0: Docs/Doc_Decisiones.md) para el navegador. El `.wasm` (~1,4 MB) es un archivo
// aparte que se baja recién acá, cuando llega un HEIC: no entra en el paquete principal ni en lo que la app
// guarda para funcionar sin red (vite.config.ts). Solo lo importan el Worker y, de respaldo, `heicConvert.ts`.

import createLibheif from 'libheif-js/libheif-wasm/libheif.js';
import wasmUrl from 'libheif-js/libheif-wasm/libheif.wasm?url';
import { HeicError } from './heic';
import type { Libheif } from './heicDecode';

let loading: Promise<Libheif> | null = null;

/**
 * La librería lista (una sola vez). El `.wasm` se baja con `fetch` (pasa por el service worker, que lo guarda
 * después de la primera vez) y se le da ya bajado: así la librería lo compila en el acto, en el Worker o en la
 * página. Si no se puede bajar o compilar: `HeicError('unavailable')`.
 */
export function loadLibheif(): Promise<Libheif> {
  loading ??= (async () => {
    const response = await fetch(wasmUrl, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const wasmBinary = new Uint8Array(await response.arrayBuffer());
    const lib = (await createLibheif({ wasmBinary })) as unknown as Libheif;
    if (!lib || typeof lib.HeifDecoder !== 'function') throw new Error('libheif without HeifDecoder');
    return lib;
  })().catch((err: unknown) => {
    loading = null;
    throw new HeicError('unavailable', `The HEIC decoder could not be loaded (${err instanceof Error ? err.message : String(err)}).`);
  });
  return loading;
}
