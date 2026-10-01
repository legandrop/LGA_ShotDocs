import { attachmentFamily, fileKind } from './attachments';
import { thumbFromCanvas, THUMB_SIDE } from './probe';

// La vista previa de un adjunto (Docs/Doc_Adjuntos.md, sección 4 y "Cómo quedó (entrega 2)"): la primera página
// de un PDF, hecha en el dispositivo que lo agrega, como la miniatura de una foto. Va por el mismo camino que las
// miniaturas: el almacén `thumbs` del dispositivo, el bucket `thumbs` y `set_file_thumb`. Ningún pedido al
// portero ni a Drive, y anda sin red. pdf.js se baja aparte, solo cuando llega un PDF (`pdfLib.ts`).

/** Un PDF más grande que esto no tiene vista previa (pdf.js lo lee entero en memoria; el iPhone no da para más). */
export const PDF_PREVIEW_MAX_BYTES = 64 * 1024 * 1024;
/** Lo más que se espera para dibujar la primera página (un PDF enorme o muy complejo). */
export const PDF_PREVIEW_TIMEOUT_MS = 20_000;
/** Lo más que se espera para bajar pdf.js (una red que no contesta). */
const LIB_FETCH_TIMEOUT_MS = 30_000;

/**
 * pdf.js no se pudo cargar (sin red la primera vez, o la bajada falló): no es un PDF sin vista previa, se
 * prueba de nuevo más tarde (la cola deja el archivo sin medir y lo intenta antes de subirlo).
 */
export class PreviewUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreviewUnavailable';
  }
}

/** El adjunto puede tener vista previa: un PDF de hasta `PDF_PREVIEW_MAX_BYTES`. */
export function previewable(mime: string | null | undefined, name: string | null | undefined, size?: number | null): boolean {
  if (fileKind(mime, name) !== 'file' || attachmentFamily(mime, name) !== 'pdf') return false;
  return !(typeof size === 'number' && size > PDF_PREVIEW_MAX_BYTES);
}

type PdfLib = typeof import('./pdfLib');
let loading: Promise<PdfLib> | null = null;

/** pdf.js listo (una sola vez), con su Worker comprobado. Si no se puede: `PreviewUnavailable`. */
function loadPdfLib(): Promise<PdfLib> {
  loading ??= (async () => {
    const lib = await import('./pdfLib');
    // El Worker se baja aparte: se comprueba que llegue (pasa por el service worker, que lo guarda), así una
    // falta de red no se confunde con un PDF que no se puede leer.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LIB_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(lib.PDF_WORKER_URL, { credentials: 'same-origin', signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await res.arrayBuffer();
    } finally {
      clearTimeout(timer);
    }
    return lib;
  })().catch((err: unknown) => {
    loading = null;
    throw new PreviewUnavailable(`The PDF reader could not be loaded (${err instanceof Error ? err.message : String(err)}).`);
  });
  return loading;
}

/**
 * La vista previa del adjunto: un JPEG de lado mayor `THUMB_SIDE` (como la miniatura de una foto), o `null` si no
 * tiene (no es un PDF, es muy grande, está dañado o tiene contraseña). Tira `PreviewUnavailable` si pdf.js no se
 * pudo cargar. El archivo de la persona no se toca.
 */
export async function attachmentPreview(file: Blob, mime: string, name: string): Promise<Blob | null> {
  if (typeof document === 'undefined' || !previewable(mime, name, file.size)) return null;
  const lib = await loadPdfLib();
  let canvas: HTMLCanvasElement | null = null;
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    canvas = await lib.renderFirstPage(
      data,
      THUMB_SIDE,
      (width, height) => {
        const c = document.createElement('canvas');
        c.width = width;
        c.height = height;
        return c;
      },
      PDF_PREVIEW_TIMEOUT_MS,
    );
    return await thumbFromCanvas(canvas);
  } catch (err) {
    console.info('[adjuntos] sin vista previa del PDF', name, err instanceof Error ? err.message : err);
    return null;
  } finally {
    if (canvas) {
      // Safari retiene la memoria de un canvas hasta que se achica a cero.
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
