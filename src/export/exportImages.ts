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

/** Los puntos por pulgada del papel (la pantalla es de 96 px de CSS por pulgada). */
export const PRINT_PPI = 200;
const CSS_PPI = 96;

/** Se superó el tope de píxeles de fotos para un PDF (la vista colgaría la pestaña). */
export class PhotoLimitError extends Error {
  constructor(readonly pixels: number) {
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
  /** La mejor imagen que haya de `id` (sin la red, salvo con *Sharp photos*), o `null` (queda la que se ve). */
  best(id: string): Promise<Blob | null>;
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
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        // El papel es blanco: una PNG con transparencia no sale negra en el JPEG.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, 0, 0, width, height);
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

/** La cuenta de lo decodificado de un PDF entero, con su tope. */
export class PixelBudget {
  used = 0;
  constructor(readonly limit: number) {}
  add(width: number, height: number): void {
    this.used += width * height;
    if (this.used > this.limit) throw new PhotoLimitError(this.used);
  }
}

export interface ShrinkResult {
  /** Las direcciones `blob:` nuevas (se sueltan al cerrar). */
  urls: string[];
  /** Fotos cambiadas por su imagen achicada. */
  shrunk: number;
  /** Fotos que quedaron como estaban (ya chicas, o el navegador no las abre). */
  kept: number;
}

/** Las imágenes de una foto, un video o un adjunto de la vista (no las de las tarjetas de Drive: son de afuera). */
const MEDIA_IMG = 'img.bn-visual-media';

/** Una imagen que no es una foto (el ícono de un adjunto, un marcador): no se achica. */
function vector(src: string): boolean {
  return src.startsWith('data:image/svg') || /\.svg(\?|$)/i.test(src);
}

/**
 * Cambia cada foto de `root` (una vista de impresión ya paginada, en el documento) por su imagen achicada al ancho
 * impreso. La proporción queda fija antes de cambiar nada, así los cortes no se mueven. Nunca falla por una foto: la
 * que no se puede achicar queda como estaba (y cuenta lo suyo en el tope).
 */
export async function shrinkImages(
  root: HTMLElement,
  options: { source?: ImageSource | null; budget: PixelBudget; resizer?: Resizer; signal?: AbortSignal; parallel?: number },
): Promise<ShrinkResult> {
  const resizer = options.resizer ?? browserResizer;
  const out: ShrinkResult = { urls: [], shrunk: 0, kept: 0 };
  // Primero se mide todo (sin esperar nada en el medio: la vista no se vuelve a armar entre una foto y otra).
  const jobs: { img: HTMLImageElement; src: string; cssWidth: number; id: string | null }[] = [];
  for (const img of root.querySelectorAll<HTMLImageElement>(MEDIA_IMG)) {
    const src = img.getAttribute('src') ?? '';
    if (!src || vector(src) || img.closest('.drive-card')) continue;
    const cssWidth = img.getBoundingClientRect().width;
    if (!(cssWidth > 0)) continue;
    // La proporción de lo que se ve, fija: la imagen nueva no cambia el alto.
    if (!img.style.aspectRatio && img.naturalWidth > 0 && img.naturalHeight > 0) img.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
    jobs.push({ img, src, cssWidth, id: mediaIdOf(img.closest('[data-url]')?.getAttribute('data-url')) });
  }
  const keep = (img: HTMLImageElement) => {
    // No se puede leer (una imagen de afuera, un formato que el navegador no abre): queda la que se ve.
    if (img.naturalWidth > 0) options.budget.add(img.naturalWidth, img.naturalHeight);
    out.kept++;
  };
  const one = async ({ img, src, cssWidth, id }: (typeof jobs)[number]) => {
    let blob: Blob | null = null;
    if (id && options.source) blob = await options.source.best(id).catch(() => null);
    const fromSource = !!blob;
    if (!blob && (src.startsWith('blob:') || src.startsWith('data:'))) blob = await fetchBlob(src);
    const decoded = blob ? await resizer.open(blob) : null;
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
      const small = target.width >= natural.width && PASS_THROUGH.has(blob.type) ? blob : await decoded.draw(target.width, target.height);
      if (!small) {
        out.kept++;
        return;
      }
      if (options.signal?.aborted) return;
      const url = URL.createObjectURL(small);
      out.urls.push(url);
      img.src = url;
      out.shrunk++;
    } finally {
      decoded.close();
    }
  };
  // De a varias a la vez: decodificar y codificar no usan el hilo principal todo el tiempo.
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (next < jobs.length && !failed && !options.signal?.aborted) {
      try {
        await one(jobs[next++]);
      } catch (err) {
        // El tope (u otro error): las demás no empiezan otra foto.
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.parallel ?? 4, jobs.length)) }, worker));
  return out;
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
 * offline", la guardada de la página o la hecha en esta sesión) y, con `sharp`, la nítida pedida al Drive por el
 * portero (como la página, `sharpImages.ts`), hasta `maxDownloads`. Nada de esto cambia un documento ni el Drive.
 */
export function deviceImages(
  media: Pick<MediaQueue, 'localImage' | 'view'>,
  options: { download?: ((id: string) => Promise<Blob>) | null; maxDownloads?: number } = {},
): ImageSource & { downloads(): number } {
  let downloads = 0;
  return {
    downloads: () => downloads,
    async best(id) {
      const original = await media.localImage(id);
      if (original) return original;
      const canDownload = !!options.download && downloads < (options.maxDownloads ?? Infinity);
      if (canDownload) downloads++;
      const view = await media.view(id, { side: VIEW_SIDE, download: canDownload ? options.download! : undefined }).catch(() => null);
      return view ? fetchBlob(view.url) : null;
    },
  };
}
