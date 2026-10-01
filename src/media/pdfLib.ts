// pdf.js (Apache-2.0) para la vista previa de los PDF adjuntos (Docs/Doc_Adjuntos.md, "Vista previa"). Se baja
// recién acá, cuando alguien agrega un PDF: no entra en el paquete principal ni en lo que la app guarda al
// instalarse (vite.config.ts); se guarda en la caché `pdf-preview` la primera vez que se usa y desde ahí anda sin
// red. Solo lo importa `pdfPreview.ts`.
//
// Se usa lo mínimo: la primera página dibujada en un canvas. Sin capa de texto, sin anotaciones, sin formularios
// XFA, sin wasm ni nada que se baje aparte. Esta versión (6.x) ya no compila código desde el PDF (la falla de 2024
// que dejaba correrlo venía de ahí). El análisis del PDF corre en un Worker propio de cada vista previa, que se
// corta al terminar (también si se pasó del tiempo: un Worker trabado no queda vivo).

import { getDocument, GlobalWorkerOptions, PDFWorker } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

/** El canvas donde se dibuja la página (el del navegador, o uno de las pruebas). */
export interface PageCanvas {
  width: number;
  height: number;
  getContext(type: '2d'): unknown;
}

/** Lo más que se espera a que pdf.js cierre el documento antes de cortar su Worker. */
const DESTROY_WAIT_MS = 1000;

/** La dirección del Worker de pdf.js (para comprobar que se puede bajar antes de usarlo). */
export const PDF_WORKER_URL = workerUrl;

/**
 * La primera página del PDF dibujada con su lado mayor en `side`, sobre blanco. `makeCanvas` crea el canvas del
 * tamaño pedido. Tira si el PDF no se puede leer (dañado, con contraseña) o si tarda más que `timeoutMs`. Siempre
 * corta el Worker al terminar (esperando a lo sumo un segundo a que pdf.js cierre el documento).
 */
export async function renderFirstPage<C extends PageCanvas>(
  data: Uint8Array,
  side: number,
  makeCanvas: (width: number, height: number) => C,
  timeoutMs: number,
): Promise<C> {
  if (!GlobalWorkerOptions.workerSrc) GlobalWorkerOptions.workerSrc = workerUrl;
  const worker = new PDFWorker();
  const task = getDocument({
    data,
    worker,
    enableXfa: false,
    useWasm: false,
    stopAtErrors: false,
    disableAutoFetch: true,
    disableStream: true,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('The PDF took too long to draw.')), timeoutMs);
  });
  const work = (async () => {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const longest = Math.max(base.width, base.height);
    if (!(longest > 0)) throw new Error('The PDF page has no size.');
    const viewport = page.getViewport({ scale: side / longest });
    const canvas = makeCanvas(Math.max(1, Math.round(viewport.width)), Math.max(1, Math.round(viewport.height)));
    await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport, background: '#ffffff' }).promise;
    page.cleanup();
    return canvas;
  })();
  // Si gana el tope, lo que siga de `work` no tiene que quedar como un rechazo sin atender.
  work.catch(() => undefined);
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    // `destroy` del documento espera la respuesta del Worker, que puede no llegar si está trabado: se le da un segundo
    // y el Worker se corta igual.
    await Promise.race([task.destroy().catch(() => undefined), new Promise((r) => setTimeout(r, DESTROY_WAIT_MS))]);
    worker.destroy();
  }
}
