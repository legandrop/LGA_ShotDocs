import { mediaIdOf, type MediaQueue } from '../media/queue';
import { VIEW_SIDE } from '../media/probe';
import { ORIGINAL_MAX_SIDE } from '../ui/printPage';

// Las fotos del PDF de una rama (P.22, Docs/Doc_Exportar.md, secciones 2.2 y 5).
//
// Cada foto de la vista ya tiene su ancho fijo (el de la pantalla: printView.ts). Acá se cambia su imagen por la mejor
// que haya EN EL DISPOSITIVO (el original, la nítida de 2048 o la miniatura que ya muestra) achicada a su ancho
// impreso a 200 ppp (como mucho 2400 px de lado): una foto que ocupa 160 px en la hoja no necesita 2048 px. Medido en
// el diseño: con fuente de 2048 px la vista suma 368 MB y el PDF 30 MB; achicada, 261 MB y 6 MB. Lo que cuenta para el
// tope es lo decodificado (ancho × alto de cada foto ya achicada), no la cantidad de fotos.
//
// Desde la entrega 1b (D85, Lega 2026-10-02) las fotos van por defecto como se tomaron, en resolución completa: el
// ORIGINAL (del dispositivo o bajado del Drive por el portero), sin achicar. Un JPEG derecho entra tal cual al PDF
// (Chrome lo copia sin decodificarlo: medido, el PDF pesa lo mismo que los JPEG y la memoria no crece con los
// píxeles); uno girado por EXIF, una PNG o un HEIC se pasan antes a JPEG del mismo tamaño en un Worker (Chrome los
// decodificaba y volvía a codificar uno por uno al imprimir: medio segundo y seis veces el peso por foto). Ahí el
// tope que manda es el peso (bytes), además de los píxeles. *Smaller file* vuelve a lo de antes: achicadas a 200 ppp.

/** Los puntos por pulgada del papel (la pantalla es de 96 px de CSS por pulgada). */
export const PRINT_PPI = 200;
const CSS_PPI = 96;

/** Se superó el tope de fotos (píxeles o peso) para un PDF (la vista colgaría la pestaña). */
export class PhotoLimitError extends Error {
  /**
   * Los originales que ya se habían traído para la página que no entró (va primera en la parte siguiente: así no se
   * bajan dos veces). Los pone `shrinkImages`.
   */
  fetched?: Map<string, Blob>;
  constructor(readonly pixels: number, readonly bytes = 0) {
    super('Too many photos for one PDF');
    this.name = 'PhotoLimitError';
  }
}

/** El tamaño al que se achica una foto que ocupa `cssWidth` px en la hoja, con la proporción de `natural`. */
export function printSize(cssWidth: number, natural: { width: number; height: number }, maxSide = ORIGINAL_MAX_SIDE): { width: number; height: number } {
  const ratio = natural.height / natural.width;
  let width = Math.ceil((cssWidth * PRINT_PPI) / CSS_PPI);
  let height = Math.round(width * ratio);
  const long = Math.max(width, height);
  if (long > maxSide) {
    const scale = maxSide / long;
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }
  // Nunca más grande que la fuente.
  if (width > natural.width) return { width: natural.width, height: natural.height };
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

/** De dónde sale la mejor imagen de una foto del Drive en este dispositivo. */
export interface ImageSource {
  /** La mejor imagen que haya de `id` para achicar (la nítida o la miniatura), o `null` (queda la que se ve). */
  best(id: string, signal?: AbortSignal): Promise<Blob | null>;
  /**
   * El original de una FOTO (nunca de un video ni de un adjunto): el del dispositivo o, con red, bajado del Drive por
   * el portero. `null` si no se puede (sin red, sin portero): la foto sale con `best`, achicada, y se cuenta. Tira
   * `DownloadTimeout` si la bajada deja de recibir bytes (sale achicada, contada, y la página va a la lista de D88).
   * `received` informa bytes nuevos y positivos: cada chunk renueva el plazo, no las cabeceras ni eventos vacíos.
   */
  original?(id: string, signal?: AbortSignal, received?: (bytes: number) => void): Promise<Blob | null>;
  /**
   * Si `id` es una foto: `false` para un video o un adjunto (no cuentan como "menos resolución"), `null` si no se sabe
   * (sin red y sin la ficha guardada: se cuenta igual, mejor avisar de más que de menos).
   */
  isPhoto?(id: string): Promise<boolean | null>;
}

/** Una bajada de un original que pasó su tope de tiempo (la red del set floja, el portero o Drive trabados). */
export class DownloadTimeout extends Error {
  constructor() {
    super('Original download timed out');
    this.name = 'DownloadTimeout';
  }
}

/** Un original vence tras 30 s sin bytes nuevos, aunque la descarga completa dure varios minutos. */
export const ORIGINAL_TIMEOUT_MS = 30_000;
/** *Smaller file* conserva el plazo total previo para preparar su imagen nítida. */
const SHARP_TIMEOUT_MS = 90_000;

/**
 * Corre `run` con su propia señal de cortar, que se corta con `outer` (*Cancel*) o al pasar `ms` sin bytes (y ahí tira
 * `DownloadTimeout`). Vuelve enseguida aunque `run` no termine nunca (un `fetch` colgado).
 */
export function withDeadline<T>(run: (signal: AbortSignal, received: (bytes: number) => void) => Promise<T>, ms: number, outer?: AbortSignal | null): Promise<T> {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  let finished = false;
  let arm: () => void;
  const stopped = new Promise<never>((_, reject) => {
    arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        reject(new DownloadTimeout());
        ctl.abort();
      }, ms);
    };
    arm();
    onAbort = () => {
      reject(new DOMException('Aborted', 'AbortError'));
      ctl.abort();
    };
    if (outer?.aborted) onAbort();
    else outer?.addEventListener('abort', onAbort, { once: true });
  });
  const work = Promise.resolve().then(() => {
    if (ctl.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return run(ctl.signal, (bytes) => {
      if (!finished && !ctl.signal.aborted && Number.isFinite(bytes) && bytes > 0) arm();
    });
  });
  // La que pierde la carrera no deja un rechazo sin atender.
  work.catch(() => undefined);
  stopped.catch(() => undefined);
  return Promise.race([work, stopped]).finally(() => {
    finished = true;
    clearTimeout(timer);
    if (onAbort) outer?.removeEventListener('abort', onAbort);
  });
}

/** Lo que dice la cabecera de un JPEG sin decodificarlo. */
export interface JpegInfo {
  width: number;
  height: number;
  /** El giro de EXIF (1: derecha; 2 a 8: girada o espejada). */
  orientation: number;
  /** Canales: 1 (gris) o 3 (color) entran tal cual al PDF; 4 (CMYK) no. */
  components: number;
}

/**
 * Lee la cabecera de un JPEG (los segmentos hasta el comienzo de los datos): las medidas, el giro de EXIF y los
 * canales. `null` si no es un JPEG o no se encuentra el tamaño en los bytes dados.
 */
export function jpegInfo(bytes: Uint8Array): JpegInfo | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let orientation = 1;
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    // Relleno entre segmentos.
    if (marker === 0xff) {
      i++;
      continue;
    }
    // Marcadores sin largo.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2) return null;
    const body = i + 4;
    if (marker === 0xe1 && body + 14 <= bytes.length && String.fromCharCode(...bytes.subarray(body, body + 4)) === 'Exif') {
      orientation = exifOrientation(bytes.subarray(body + 6, Math.min(bytes.length, i + 2 + len))) ?? orientation;
    }
    // SOF0 a SOF15, salvo DHT (C4), JPG (C8) y DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (body + 6 > bytes.length) return null;
      const height = (bytes[body + 1] << 8) | bytes[body + 2];
      const width = (bytes[body + 3] << 8) | bytes[body + 4];
      const components = bytes[body + 5];
      if (!width || !height) return null;
      return { width, height, orientation, components };
    }
    // Empiezan los datos: no hubo tamaño.
    if (marker === 0xda) return null;
    i += 2 + len;
  }
  return null;
}

/** La orientación (etiqueta 0x0112) del primer IFD de un bloque TIFF de EXIF, o `null`. */
function exifOrientation(tiff: Uint8Array): number | null {
  if (tiff.length < 8) return null;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return null;
  const u16 = (at: number) => (little ? tiff[at] | (tiff[at + 1] << 8) : (tiff[at] << 8) | tiff[at + 1]);
  const u32 = (at: number) => (little ? (tiff[at] | (tiff[at + 1] << 8) | (tiff[at + 2] << 16)) + tiff[at + 3] * 0x1000000 : tiff[at] * 0x1000000 + ((tiff[at + 1] << 16) | (tiff[at + 2] << 8) | tiff[at + 3]));
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return null;
  const count = u16(ifd);
  for (let k = 0; k < count; k++) {
    const entry = ifd + 2 + k * 12;
    if (entry + 12 > tiff.length) return null;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

/** Cuánto se lee de un JPEG para la cabecera (el EXIF de un teléfono, con su miniatura, cabe de sobra). */
const JPEG_HEAD_BYTES = 256 * 1024;

async function headOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(0, JPEG_HEAD_BYTES).arrayBuffer());
}

/** Una imagen abierta: sus medidas y cómo dibujarla más chica. Se cierra siempre (`close`). */
export interface Decoded {
  width: number;
  height: number;
  /** La imagen achicada a `width` × `height` (JPEG), o `null`. */
  draw(width: number, height: number): Promise<Blob | null>;
  close(): void;
}

/** Lo que hace falta para achicar: en el navegador, `createImageBitmap` y un canvas (en las pruebas, uno falso). */
export interface Resizer {
  /** La imagen abierta (se decodifica una sola vez), o `null` si el navegador no la abre (un HEIC en Chrome). */
  open(blob: Blob): Promise<Decoded | null>;
}

/** Dibuja la imagen achicada sobre blanco: una PNG con transparencia no sale negra en el JPEG. */
function paint(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, bitmap: ImageBitmap, width: number, height: number): void {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
}

/** El de verdad. */
export const browserResizer: Resizer = {
  async open(blob) {
    if (typeof createImageBitmap !== 'function') return null;
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(blob);
    } catch {
      return null;
    }
    return {
      width: bitmap.width,
      height: bitmap.height,
      async draw(width, height) {
        // `OffscreenCanvas.convertToBlob` donde está: el `toBlob` de un canvas común espera un momento libre del hilo
        // principal y, ocupado armando el PDF, tardaba 1 s por foto (medido en Chrome).
        if (typeof OffscreenCanvas === 'function') {
          try {
            const canvas = new OffscreenCanvas(width, height);
            const ctx = canvas.getContext('2d');
            if (ctx) {
              paint(ctx, bitmap, width, height);
              return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
            }
          } catch {
            // Sigue con el canvas común.
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        paint(ctx, bitmap, width, height);
        const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
        // Suelta la memoria del canvas enseguida (con cientos de fotos, el recolector llega tarde).
        canvas.width = 0;
        canvas.height = 0;
        return out;
      },
      close: () => bitmap.close(),
    };
  },
};

/** Un achicador que hay que soltar al terminar (el de los Workers). */
export interface DisposableResizer extends Resizer {
  dispose(): void;
}

type Reply = { id: number; ok: boolean; error?: string; handle?: number; width?: number; height?: number; blob?: Blob };

/**
 * Abrir y achicar en un grupo de Workers (`resize.worker.ts`, `OffscreenCanvas`): el hilo de la pantalla queda libre y
 * van de a varias de verdad (la auditoría midió 2 a 3 veces más rápido). Donde no hay Worker u `OffscreenCanvas`, o si
 * un Worker falla, esa foto se hace en el hilo principal (`browserResizer`): nunca se pierde una foto por esto.
 */
export function workerResizer(size = 4, create: () => Worker = () => new Worker(new URL('./resize.worker.ts', import.meta.url), { type: 'module', name: 'export-resize' })): DisposableResizer {
  if (typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function') return { ...browserResizer, dispose: () => undefined };
  const workers: Worker[] = [];
  const waiting = new Map<number, (reply: Reply) => void>();
  let seq = 0;
  let turn = 0;
  let broken = false;
  const fail = () => {
    broken = true;
    for (const resolve of waiting.values()) resolve({ id: -1, ok: false, error: 'worker' });
    waiting.clear();
  };
  const worker = (i: number): Worker | null => {
    if (broken) return null;
    try {
      workers[i] ??= (() => {
        const w = create();
        w.onmessage = (e: MessageEvent<Reply>) => {
          const resolve = waiting.get(e.data.id);
          waiting.delete(e.data.id);
          resolve?.(e.data);
        };
        w.onerror = fail;
        return w;
      })();
      return workers[i];
    } catch {
      broken = true;
      return null;
    }
  };
  const ask = (w: Worker, msg: Record<string, unknown>): Promise<Reply> =>
    new Promise((resolve) => {
      const id = ++seq;
      waiting.set(id, resolve);
      w.postMessage({ id, ...msg });
    });
  return {
    async open(blob) {
      const w = worker(turn++ % size);
      if (!w) return browserResizer.open(blob);
      const opened = await ask(w, { kind: 'open', blob });
      if (!opened.ok) return broken ? browserResizer.open(blob) : null;
      const handle = opened.handle!;
      return {
        width: opened.width!,
        height: opened.height!,
        async draw(width, height) {
          const r = await ask(w, { kind: 'draw', handle, width, height });
          return r.ok ? (r.blob ?? null) : null;
        },
        close: () => void ask(w, { kind: 'close', handle }),
      };
    },
    dispose() {
      for (const w of workers) w?.terminate();
      workers.length = 0;
      fail();
    },
  };
}

/** La cuenta de las fotos de un PDF (o de una de sus partes): los píxeles y el peso, con sus topes. */
export class PixelBudget {
  used = 0;
  bytes = 0;
  constructor(
    readonly limit: number,
    readonly byteLimit = Infinity,
  ) {}
  add(width: number, height: number, bytes = 0): void {
    this.used += width * height;
    this.bytes += bytes;
    if (this.used > this.limit || this.bytes > this.byteLimit) throw new PhotoLimitError(this.used, this.bytes);
  }
}

export interface ShrinkResult {
  /** Las direcciones `blob:` nuevas (se sueltan al cerrar). */
  urls: string[];
  /** Fotos cambiadas por su imagen achicada. */
  shrunk: number;
  /** Fotos que quedaron como estaban (ya chicas, o el navegador no las abre). */
  kept: number;
  /** Con resolución completa: fotos que salieron con su original (tal cual, o pasado a JPEG del mismo tamaño). */
  full: number;
  /** Con resolución completa: fotos cuyo original no se pudo usar (sin red, o el navegador no lo abre): achicadas. */
  lowRes: number;
  /** De esas, las que no llegaron porque la bajada pasó su tope de tiempo. */
  timedOut: number;
  /** Milisegundos sumados de cada paso (traer la imagen, abrirla, achicarla), para medir. */
  ms: { best: number; open: number; draw: number };
}

/** Las imágenes de una foto, un video o un adjunto de la vista (no las de las tarjetas de Drive: son de afuera). */
const MEDIA_IMG = 'img.bn-visual-media';

/** Una imagen que no es una foto (el ícono de un adjunto, un marcador): no se achica. */
function vector(src: string): boolean {
  return src.startsWith('data:image/svg') || /\.svg(\?|$)/i.test(src);
}

export interface ShrinkOptions {
  source?: ImageSource | null;
  budget: PixelBudget;
  resizer?: Resizer;
  signal?: AbortSignal;
  parallel?: number;
  /**
   * Resolución completa (D85): cada foto con su original (`source.original`), sin achicar. La que no tiene original
   * a mano sale achicada como siempre y se cuenta en `lowRes`.
   */
  full?: boolean;
  /** Pasa un HEIC a JPEG del mismo tamaño (el convertidor de la app), donde el navegador no lo abre. */
  convertHeic?: ((blob: Blob) => Promise<Blob>) | null;
  /** Originales ya traídos (de la página que no entró en la parte anterior): se usan sin volver a bajarlos. */
  carry?: Map<string, Blob> | null;
  /** Píxeles que se pueden estar convirtiendo a la vez (`DECODE_PIXELS`; las pruebas lo achican). */
  decodePixels?: number;
  /** Sin bytes para originales (`ORIGINAL_TIMEOUT_MS`); total para nítidas (90 s). Las pruebas lo achican. */
  downloadMs?: number;
}

/**
 * Lo que se puede estar decodificando a la vez para pasar originales a JPEG del mismo tamaño: cada megapíxel son unos
 * 8 MB (la imagen abierta y el lienzo). Medido por la auditoría: cuatro fotos de 108 MP giradas a la vez subían la
 * memoria 6,6 GB. Con 150 millones: unas dos fotos de 61 MP, o una sola más grande.
 */
export const DECODE_PIXELS = 150_000_000;
/** Más grande que esto no se pasa entera a JPEG (el lienzo no da o la memoria no alcanza): sale achicada y contada. */
export const MAX_CONVERT_PIXELS = 100_000_000;

/** Un semáforo por píxeles: `acquire(n)` espera hasta que lo que está en curso más `n` entre en `limit`. */
function pixelGate(limit: number) {
  let used = 0;
  const waiting: { n: number; go: () => void }[] = [];
  const pump = () => {
    while (waiting.length > 0 && (used === 0 || used + waiting[0].n <= limit)) {
      const w = waiting.shift()!;
      used += w.n;
      w.go();
    }
  };
  return {
    async acquire(n: number): Promise<() => void> {
      const weight = Math.min(Math.max(1, n), limit);
      await new Promise<void>((go) => {
        waiting.push({ n: weight, go });
        pump();
      });
      let done = false;
      return () => {
        if (done) return;
        done = true;
        used -= weight;
        pump();
      };
    },
  };
}

/** Las medidas de una PNG (su cabecera IHDR), sin decodificarla. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  const u32 = (at: number) => bytes[at] * 0x1000000 + ((bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]);
  return { width: u32(16), height: u32(20) };
}

/** El marcador con la dirección que tenía una foto antes de cambiarla (para dejarla como estaba si algo corta). */
const BEFORE = 'sdExportSrc';

/**
 * Cambia cada foto de `root` (una vista de impresión ya paginada, en el documento) por su imagen achicada al ancho
 * impreso, o por su original con `full`. La proporción queda fija antes de cambiar nada, así los cortes no se mueven.
 * Nunca falla por una foto: la que no se puede achicar queda como estaba (y cuenta lo suyo en el tope). Si se pasa el
 * tope (`PhotoLimitError`) o algo falla, deja cada foto como estaba y suelta lo suyo antes de tirar el error.
 */
export async function shrinkImages(root: HTMLElement, options: ShrinkOptions): Promise<ShrinkResult> {
  const resizer = options.resizer ?? browserResizer;
  const out: ShrinkResult = { urls: [], shrunk: 0, kept: 0, full: 0, lowRes: 0, timedOut: 0, ms: { best: 0, open: 0, draw: 0 } };
  const gate = pixelGate(options.decodePixels ?? DECODE_PIXELS);
  /** Los originales traídos para esta página (si no entra en la parte, pasan a la siguiente). */
  const fetched = new Map<string, Blob>();
  // Primero se mide todo (sin esperar nada en el medio: la vista no se vuelve a armar entre una foto y otra).
  const jobs: Job[] = [];
  for (const img of root.querySelectorAll<HTMLImageElement>(MEDIA_IMG)) {
    const src = img.getAttribute('src') ?? '';
    if (!src || vector(src) || img.closest('.drive-card')) continue;
    const cssWidth = img.getBoundingClientRect().width;
    if (!(cssWidth > 0)) continue;
    // La proporción de lo que se ve, fija: la imagen nueva no cambia el alto.
    if (!img.style.aspectRatio && img.naturalWidth > 0 && img.naturalHeight > 0) img.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
    jobs.push({ img, src, cssWidth, id: mediaIdOf(img.closest('[data-url]')?.getAttribute('data-url')) });
  }
  let failed = false;
  /** Cambia la imagen de una foto (si nada cortó mientras se preparaba). */
  const use = (img: HTMLImageElement, blob: Blob): boolean => {
    if (failed || options.signal?.aborted) return false;
    const url = URL.createObjectURL(blob);
    out.urls.push(url);
    if (img.dataset[BEFORE] === undefined) img.dataset[BEFORE] = img.getAttribute('src') ?? '';
    img.src = url;
    return true;
  };
  const keep = (img: HTMLImageElement) => {
    // No se puede leer (una imagen de afuera, un formato que el navegador no abre): queda la que se ve.
    if (img.naturalWidth > 0) options.budget.add(img.naturalWidth, img.naturalHeight);
    out.kept++;
  };

  /** Con resolución completa: el original tal cual (un JPEG derecho) o pasado a JPEG del mismo tamaño. */
  const fullSize = async (img: HTMLImageElement, original: Blob): Promise<boolean | 'huge'> => {
    const info = jpegInfo(await headOf(original));
    if (info && info.orientation === 1 && info.components !== 4) {
      options.budget.add(info.width, info.height, original.size);
      // Siempre como JPEG (nunca el tipo que diga el archivo guardado).
      return use(img, original.type === 'image/jpeg' ? original : new Blob([original], { type: 'image/jpeg' }));
    }
    // Girado por EXIF, CMYK, PNG, WebP, HEIC…: a JPEG del mismo tamaño (ya derecho), fuera del hilo de la pantalla.
    // De a pocas: lo que se decodifica a la vez tiene un tope en píxeles (una foto sin medidas conocidas, sola).
    const known = info ?? pngSize(await headOf(original));
    const pixels = known ? known.width * known.height : Infinity;
    // Una foto gigante no se pasa entera (sale achicada y contada). Sin medidas conocidas (un HEIC), va sola.
    if (known && pixels > MAX_CONVERT_PIXELS) return 'huge';
    const release = await gate.acquire(pixels);
    try {
      if (failed || options.signal?.aborted) return false;
      let blob = original;
      let decoded = await resizer.open(blob);
      if (!decoded && options.convertHeic && !info) {
        const jpeg = await options.convertHeic(original).catch(() => null);
        if (!jpeg) return false;
        const converted = jpegInfo(await headOf(jpeg));
        if (converted && converted.orientation === 1 && converted.components !== 4) {
          options.budget.add(converted.width, converted.height, jpeg.size);
          return use(img, jpeg);
        }
        blob = jpeg;
        decoded = await resizer.open(blob);
      }
      if (!decoded) return false;
      try {
        if (decoded.width * decoded.height > MAX_CONVERT_PIXELS) return 'huge';
        // Se cuenta antes de dibujar (con el peso del original como estimado): pasado el tope, no se gasta memoria.
        options.budget.add(decoded.width, decoded.height, blob.size);
        const t = performance.now();
        const jpeg = await decoded.draw(decoded.width, decoded.height);
        out.ms.draw += performance.now() - t;
        if (!jpeg) return false;
        // El peso de verdad (el JPEG nuevo), otra vez contra el tope.
        options.budget.add(0, 0, jpeg.size - blob.size);
        return use(img, jpeg);
      } finally {
        decoded.close();
      }
    } finally {
      release();
    }
  };

  /**
   * Achicada a su ancho impreso (lo de siempre, y *Smaller file*). Con `given`, desde esa imagen (el original de una
   * foto gigante), sola: abrirla ocupa todo lo que se puede decodificar a la vez.
   */
  const shrink = async ({ img, src, cssWidth, id }: Job, given: Blob | null = null) => {
    const release = given ? await gate.acquire(Infinity) : null;
    try {
      await shrinkOne({ img, src, cssWidth, id }, given);
    } finally {
      release?.();
    }
  };
  const shrinkOne = async ({ img, src, cssWidth, id }: Job, given: Blob | null) => {
    let blob: Blob | null = given;
    const t0 = performance.now();
    if (!blob && id && options.source) {
      const source = options.source;
      blob = await withDeadline((signal) => source.best(id, signal), options.downloadMs ?? SHARP_TIMEOUT_MS, options.signal).catch(() => null);
    }
    const fromSource = !!blob;
    if (!blob && (src.startsWith('blob:') || src.startsWith('data:'))) blob = await fetchBlob(src);
    const t1 = performance.now();
    const decoded = blob ? await resizer.open(blob) : null;
    const t2 = performance.now();
    out.ms.best += t1 - t0;
    out.ms.open += t2 - t1;
    if (!blob || !decoded) return keep(img);
    try {
      const natural = { width: decoded.width, height: decoded.height };
      const target = printSize(cssWidth, natural);
      if (target.width >= natural.width && !fromSource) {
        // La que ya se ve es chica: queda.
        options.budget.add(natural.width, natural.height);
        out.kept++;
        return;
      }
      // Se cuenta antes de dibujar: pasado el tope, no se gasta memoria en una foto más.
      options.budget.add(target.width, target.height);
      const t3 = performance.now();
      const small = target.width >= natural.width && PASS_THROUGH.has(blob.type) ? blob : await decoded.draw(target.width, target.height);
      out.ms.draw += performance.now() - t3;
      if (!small) {
        out.kept++;
        return;
      }
      if (use(img, small)) out.shrunk++;
    } finally {
      decoded.close();
    }
  };

  const one = async (job: Job) => {
    if (options.full && job.id && options.source?.original) {
      const t0 = performance.now();
      const id = job.id;
      const source = options.source;
      const getOriginal = source.original!.bind(source);
      let original: Blob | null = options.carry?.get(id) ?? null;
      let late = false;
      if (!original) {
        try {
          original = await withDeadline((signal, received) => getOriginal(id, signal, received), options.downloadMs ?? ORIGINAL_TIMEOUT_MS, options.signal);
        } catch (err) {
          late = err instanceof DownloadTimeout;
          original = null;
        }
      }
      out.ms.best += performance.now() - t0;
      if (original) fetched.set(id, original);
      const done = original ? await fullSize(job.img, original) : false;
      if (done === true) {
        out.full++;
        return;
      }
      if (done === 'huge') {
        // Más grande de lo que se puede pasar entera a JPEG: achicada desde su original, sola, y contada.
        out.lowRes++;
        return shrink(job, original);
      }
      if (options.signal?.aborted) return;
      // Una foto sin su original a mano (sin red, o la bajada pasó su tope) o que el navegador no abre: achicada, y
      // contada. `original` da `null` también para un video o un adjunto: esos no cuentan (`isPhoto` da `false`).
      if (late) out.timedOut++;
      if (original || late || (await source.isPhoto?.(id).catch(() => null)) !== false) out.lowRes++;
    }
    await shrink(job);
  };

  /** *Cancel* vuelve enseguida aunque una foto no termine nunca (una bajada colgada): la foto sigue sola y no cambia nada. */
  const cancelled = new Promise<void>((resolve) => {
    if (options.signal?.aborted) resolve();
    else options.signal?.addEventListener('abort', () => resolve(), { once: true });
  });

  // De a varias a la vez: decodificar y codificar no usan el hilo principal todo el tiempo.
  let next = 0;
  let error: unknown = null;
  const worker = async () => {
    while (next < jobs.length && !failed && !options.signal?.aborted) {
      try {
        await Promise.race([one(jobs[next++]), cancelled]);
      } catch (err) {
        // El tope (u otro error): las demás no empiezan otra foto ni cambian la suya.
        if (!failed) error = err;
        failed = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.parallel ?? 4, jobs.length)) }, worker));
  if (failed) {
    // Todo como estaba: las fotos con su imagen de antes y lo armado, suelto.
    restoreImages(root);
    for (const url of out.urls) URL.revokeObjectURL(url);
    if (error instanceof PhotoLimitError) error.fetched = fetched;
    throw error;
  }
  return out;
}

type Job = { img: HTMLImageElement; src: string; cssWidth: number; id: string | null };

/** Deja cada foto de `root` con la imagen que tenía antes de `shrinkImages`. */
export function restoreImages(root: HTMLElement): void {
  for (const img of root.querySelectorAll<HTMLImageElement>('img')) {
    const before = img.dataset[BEFORE];
    if (before === undefined) continue;
    img.setAttribute('src', before);
    delete img.dataset[BEFORE];
  }
}

const PASS_THROUGH = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

async function fetchBlob(src: string): Promise<Blob | null> {
  try {
    const res = await fetch(src);
    return res.ok ? await res.blob() : null;
  } catch {
    return null;
  }
}

/** Las imágenes de la vista que todavía cargan (las achicadas son locales: llegan enseguida). */
export function imagesLoaded(root: HTMLElement, timeoutMs: number): Promise<boolean> {
  const pending = [...root.querySelectorAll('img')].filter((img) => img.getAttribute('src') && !img.complete);
  if (pending.length === 0) return Promise.resolve(true);
  return Promise.race([
    Promise.all(
      pending.map(
        (img) =>
          new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve(), { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
          }),
      ),
    ).then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}

/**
 * La mejor imagen de cada foto en este dispositivo: el original (propio o bajado), la nítida (la de "Available
 * offline", la guardada de la página o la hecha en esta sesión) y, con `download`, la nítida pedida al Drive por el
 * portero (como la página, `sharpImages.ts`), hasta `maxDownloads`. Con `originals` (resolución completa, D85), el
 * original de cada foto: el del dispositivo o, si no está, bajado entero del Drive por el portero (nunca se guarda:
 * exportar no escribe nada). Nada de esto cambia un documento ni el Drive.
 */
export function deviceImages(
  media: Pick<MediaQueue, 'localImage' | 'view'> & Partial<Pick<MediaQueue, 'source'>>,
  options: {
    download?: ((id: string, signal?: AbortSignal) => Promise<Blob>) | null;
    maxDownloads?: number;
    originals?: ((id: string, signal?: AbortSignal, received?: (bytes: number) => void) => Promise<Blob>) | null;
  } = {},
): ImageSource & { downloads(): number; originalsFetched(): number } {
  let downloads = 0;
  let fetched = 0;
  return {
    downloads: () => downloads,
    originalsFetched: () => fetched,
    async best(id, signal) {
      const original = await media.localImage(id);
      if (original) return original;
      const canDownload = !!options.download && downloads < (options.maxDownloads ?? Infinity);
      if (canDownload) downloads++;
      const download = options.download;
      const view = await media
        .view(id, { side: VIEW_SIDE, download: canDownload && download ? (fileId) => download(fileId, signal) : undefined })
        .catch(() => null);
      return view ? fetchBlob(view.url) : null;
    },
    async original(id, signal, received) {
      if (!media.source) return media.localImage(id);
      const source = await media.source(id).catch(() => null);
      // Solo fotos: un video o un adjunto nunca se baja para el PDF (sale su cuadro o su ícono).
      if (!source || source.kind !== 'image') return null;
      if (source.original) return source.original;
      if (!options.originals) return null;
      try {
        const blob = await options.originals(id, signal, received);
        fetched++;
        return blob;
      } catch (err) {
        // Cortada por *Cancel* o por el tope de tiempo: que lo sepa quien pidió (`withDeadline`).
        if (signal?.aborted) throw err;
        return null;
      }
    },
    async isPhoto(id) {
      if (!media.source) return null;
      const source = await media.source(id).catch(() => null);
      if (source?.kind === 'image') return true;
      if (source?.kind === 'video') return false;
      // Un adjunto (tipo conocido que no es foto ni video) no cuenta; sin la ficha (sin red), no se sabe.
      return source?.mime ? false : null;
    },
  };
}
