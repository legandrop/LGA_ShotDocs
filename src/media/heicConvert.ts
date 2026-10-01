// Convierte un HEIC a JPEG en el dispositivo (Docs/Doc_Imagenes.md, "Fotos HEIC"). Lo carga la cola con
// `import()` recién cuando llega un HEIC: ni este archivo ni el decodificador están en el paquete principal.
//
// La conversión corre en un Web Worker (`heic.worker.ts`), uno por foto, que se cierra al terminar. Si el
// navegador no deja crear el Worker (o su script no arranca), se hace en la página: tarda lo mismo pero traba
// la pantalla mientras dura. Sin red y sin el decodificador guardado, falla con `unavailable` (la cola guarda
// el HEIC tal cual y vuelve a probar antes de subirlo).

import { HeicError, JPEG_TYPE, type HeicFailure } from './heic';
import { decodeHeic, pickEncoder, pixelsToJpeg, type Pixels } from './heicDecode';

/** Lo más que se espera una conversión (una foto enorme en una computadora lenta). */
export const HEIC_TIMEOUT_MS = 120_000;

type WorkerReply =
  | { type: 'ready' }
  | { type: 'done'; jpeg: Uint8Array }
  | ({ type: 'pixels' } & Pixels)
  | { type: 'error'; reason: HeicFailure; message: string };

/** El JPEG del HEIC (con su perfil de color). Tira `HeicError` si no se pudo. */
export async function convertHeic(file: Blob): Promise<Blob> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const jpeg = await convertBytes(bytes);
  return new Blob([jpeg as Uint8Array<ArrayBuffer>], { type: JPEG_TYPE });
}

function convertBytes(bytes: Uint8Array): Promise<Uint8Array> {
  let worker: Worker;
  try {
    worker = new Worker(new URL('./heic.worker.ts', import.meta.url), { type: 'module', name: 'heic' });
  } catch {
    return onMainThread(bytes);
  }
  return new Promise<Uint8Array>((resolve, reject) => {
    let ready = false;
    let settled = false;
    const finish = (work: () => Promise<Uint8Array> | Uint8Array) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      Promise.resolve()
        .then(work)
        .then(resolve, reject);
    };
    const fail = (reason: HeicFailure, text: string) =>
      finish(() => {
        throw new HeicError(reason, text);
      });
    const timer = setTimeout(() => fail('failed', 'The HEIC conversion took too long.'), HEIC_TIMEOUT_MS);
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data;
      if (reply.type === 'ready') ready = true;
      else if (reply.type === 'done') finish(() => reply.jpeg);
      else if (reply.type === 'pixels') finish(() => encodeHere(reply, bytes));
      else if (reply.type === 'error') fail(reply.reason, reply.message);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      // El script del Worker no arrancó (no se pudo bajar, o el navegador no lo deja): se prueba en la página.
      // Si ya había arrancado, se cayó en el medio (falta de memoria): no se vuelve a probar.
      if (!ready) finish(() => onMainThread(bytes));
      else fail('failed', event.message || 'The HEIC converter stopped.');
    };
    // Una copia (no se transfiere): si el Worker no arranca, los bytes siguen acá para el respaldo.
    worker.postMessage({ bytes });
  });
}

/** El JPEG de los píxeles que mandó un Worker sin `OffscreenCanvas`. */
async function encodeHere(pixels: Pixels, heic: Uint8Array): Promise<Uint8Array> {
  const encode = pickEncoder();
  if (!encode) throw new HeicError('failed', 'This browser cannot encode a JPEG.');
  return pixelsToJpeg(pixels, heic, encode);
}

/** El respaldo sin Worker: todo en la página. */
async function onMainThread(bytes: Uint8Array): Promise<Uint8Array> {
  let loadLibheif: typeof import('./heicLib').loadLibheif;
  try {
    ({ loadLibheif } = await import('./heicLib'));
  } catch (err) {
    throw new HeicError('unavailable', `The HEIC decoder could not be loaded (${err instanceof Error ? err.message : String(err)}).`);
  }
  const lib = await loadLibheif();
  const pixels = await decodeHeic(lib, bytes);
  return encodeHere(pixels, bytes);
}
