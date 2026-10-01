// pdf.js (Apache-2.0) para la vista previa de los PDF adjuntos (Docs/Doc_Adjuntos.md, "Vista previa"). Se baja
// recién acá, cuando alguien agrega un PDF: no entra en el paquete principal ni en lo que la app guarda al
// instalarse (vite.config.ts); se guarda en la caché `pdf-preview` la primera vez que se usa y desde ahí anda sin
// red. Solo lo importa `pdfPreview.ts`.
//
// Se usa lo mínimo: la primera página dibujada en un canvas. Sin capa de texto, sin anotaciones, sin formularios
// XFA, sin wasm ni nada que se baje aparte. Esta versión (6.x) ya no compila código desde el PDF (la falla de 2024
// que dejaba correrlo venía de ahí). El análisis del PDF corre en el Worker de pdf.js.

import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

/** El canvas donde se dibuja la página (el del navegador, o uno de las pruebas). */
export interface PageCanvas {
  width: number;
  height: number;
  getContext(type: '2d'): unknown;
}

/** La dirección del Worker de pdf.js (para comprobar que se puede bajar antes de usarlo). */
export const PDF_WORKER_URL = workerUrl;

/**
 * La primera página del PDF dibujada con su lado mayor en `side`, sobre blanco. `makeCanvas` crea el canvas del
 * tamaño pedido. Tira si el PDF no se puede leer (dañado, con contraseña) o si tarda más que `timeoutMs`; en los
 * dos casos suelta lo que pdf.js tenía abierto.
 */
export async function renderFirstPage<C extends PageCanvas>(
  data: Uint8Array,
  side: number,
  makeCanvas: (width: number, height: number) => C,
  timeoutMs: number,
): Promise<C> {
  if (!GlobalWorkerOptions.workerSrc) GlobalWorkerOptions.workerSrc = workerUrl;
  const task = getDocument({
    data,
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
  try {
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
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    await task.destroy().catch(() => undefined);
  }
}
