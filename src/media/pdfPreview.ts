import { attachmentFamily, fileKind } from './attachments';
import { thumbFromCanvas, THUMB_SIDE } from './probe';

// La vista previa de un adjunto (Docs/Doc_Adjuntos.md, sección 4 y "Cómo quedó (entrega 2)"): la primera página
// de un PDF, hecha en el dispositivo que lo agrega, como la miniatura de una foto. Va por el mismo camino que las
// miniaturas: el almacén `thumbs` del dispositivo, el bucket `thumbs` y `set_file_thumb`. Ningún pedido al
// portero ni a Drive, y anda sin red. pdf.js se baja aparte, solo cuando llega un PDF (`pdfLib.ts`).
//
// De a una por vez (soltar o importar muchos PDF no abre muchos Workers ni lee muchos PDF enteros en memoria a la
// vez: el iPhone cerraría la pestaña), y cada paso con su tope, así una red que no contesta o un PDF que traba a
// pdf.js nunca frenan la cola de subida, que espera la vista previa antes de registrar el archivo.

/** Un PDF más grande que esto no tiene vista previa (pdf.js lo lee entero en memoria; el iPhone no da para más). */
export const PDF_PREVIEW_MAX_BYTES = 64 * 1024 * 1024;
/** Lo más que se espera para dibujar la primera página (un PDF enorme o muy complejo). */
export const PDF_PREVIEW_TIMEOUT_MS = 20_000;
/** Lo más que se espera para bajar pdf.js y su Worker (una red que no contesta). */
const LIB_LOAD_TIMEOUT_MS = 30_000;

/**
 * pdf.js no se pudo cargar (sin red la primera vez, o la bajada falló): no es un PDF sin vista previa. La cola sube
 * el archivo igual y la vista previa se hace la próxima vez que se lo muestra (`MediaQueue.backfillPreview`).
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

/** `work`, o un error si tarda más que `ms`. */
function within<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took too long`)), ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

/** pdf.js listo (una sola vez), con su Worker comprobado. Si no se puede: `PreviewUnavailable`. */
function loadPdfLib(): Promise<PdfLib> {
  loading ??= within(
    (async () => {
      const lib = await import('./pdfLib');
      // El Worker se baja aparte: se comprueba que llegue (pasa por el service worker, que lo guarda), así una falta
      // de red no se confunde con un PDF que no se puede leer. Un archivo que ya no existe (una pestaña vieja después
      // de publicar una versión) vuelve como la página de la app, con 200: eso tampoco es el Worker.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), LIB_LOAD_TIMEOUT_MS);
      try {
        const res = await fetch(lib.PDF_WORKER_URL, { credentials: 'same-origin', signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (/text\/html/i.test(res.headers.get('Content-Type') ?? '')) throw new Error('not the PDF reader');
        await res.arrayBuffer();
      } finally {
        clearTimeout(timer);
      }
      return lib;
    })(),
    LIB_LOAD_TIMEOUT_MS + 5_000,
    'Loading the PDF reader',
  ).catch((err: unknown) => {
    loading = null;
    throw new PreviewUnavailable(`The PDF reader could not be loaded (${err instanceof Error ? err.message : String(err)}).`);
  });
  return loading;
}

/** La última vista previa pedida: la siguiente espera a que termine (de a una por vez). */
let previous: Promise<unknown> = Promise.resolve();

/**
 * La vista previa del adjunto: un JPEG de lado mayor `THUMB_SIDE` (como la miniatura de una foto), o `null` si no
 * tiene (no es un PDF, es muy grande, está dañado o tiene contraseña, o tardó demasiado). Tira `PreviewUnavailable`
 * si pdf.js no se pudo cargar (antes de `onStart`). El archivo de la persona no se toca. De a una por vez; `onStart`
 * se llama en su turno, con pdf.js ya bajado, justo antes de dibujar.
 */
export function attachmentPreview(file: Blob, mime: string, name: string, onStart?: () => Promise<boolean>): Promise<Blob | null> {
  if (typeof document === 'undefined' || !previewable(mime, name, file.size)) return Promise.resolve(null);
  const run = previous.then(
    () => makePreview(file, name, onStart),
    () => makePreview(file, name, onStart),
  );
  previous = run.catch(() => undefined);
  return run;
}

async function makePreview(file: Blob, name: string, onStart?: () => Promise<boolean>): Promise<Blob | null> {
  const lib = await loadPdfLib();
  // En su turno y con pdf.js listo, justo antes de dibujar: quien llama anota que empieza (la cola lo usa para no
  // volver a probar un PDF que cerró la pestaña). `false`: ya no hace falta.
  if (onStart && !(await onStart())) return null;
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
    return await within(thumbFromCanvas(canvas), 10_000, 'Encoding the preview');
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
