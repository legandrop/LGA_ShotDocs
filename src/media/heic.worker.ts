// El Web Worker que convierte un HEIC a JPEG (Docs/Doc_Imagenes.md, "Fotos HEIC"): decodificar una foto de
// 24 MP tarda uno o dos segundos y, en la página, trabaría la pantalla. Lo crea `heicConvert.ts`, uno por
// foto, y lo cierra al terminar (así la memoria de la librería se suelta entera).
//
// Mensajes: al arrancar manda `ready` (el script cargó); recibe `{ bytes }` (el HEIC) y contesta `done` con el
// JPEG, `pixels` si este navegador no tiene `OffscreenCanvas` (la página codifica el JPEG), o `error` con el
// motivo (`unavailable`: no se pudo cargar el decodificador; `failed`: la foto no se pudo convertir).

import { heicFailure } from './heic';
import { decodeHeic, encodeJpegOffscreen, pixelsToJpeg } from './heicDecode';
import { loadLibheif } from './heicLib';

interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<{ bytes: Uint8Array }>) => void): void;
  addEventListener(type: 'unhandledrejection', listener: (event: PromiseRejectionEvent) => void): void;
}

const scope = self as unknown as WorkerScope;
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

// La librería puede fallar adentro de un `setTimeout` suyo (falta de memoria) sin llamar a nadie: se avisa igual.
scope.addEventListener('unhandledrejection', (event) => {
  scope.postMessage({ type: 'error', reason: 'failed', message: message(event.reason) });
});

scope.addEventListener('message', async (event) => {
  const { bytes } = event.data;
  try {
    const lib = await loadLibheif();
    const pixels = await decodeHeic(lib, bytes);
    if (typeof OffscreenCanvas === 'undefined') {
      scope.postMessage({ type: 'pixels', width: pixels.width, height: pixels.height, data: pixels.data }, [pixels.data.buffer]);
      return;
    }
    const jpeg = await pixelsToJpeg(pixels, bytes, encodeJpegOffscreen);
    scope.postMessage({ type: 'done', jpeg }, [jpeg.buffer as ArrayBuffer]);
  } catch (err) {
    scope.postMessage({ type: 'error', reason: heicFailure(err), message: message(err) });
  }
});

scope.postMessage({ type: 'ready' });
