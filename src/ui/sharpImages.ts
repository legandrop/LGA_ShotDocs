import { mediaIdOf, type MediaQueue } from '../media/queue';
import { VIEW_GAIN } from '../media/probe';
import { forgetPass, passFor } from './carreteLoader';

// Fotos nítidas en la página (Docs/Doc_Imagenes.md, "Calidad en la página"). La página muestra primero la
// miniatura (480 px de lado, guardada en el dispositivo o bajada del bucket `thumbs`): anda sin red y carga
// enseguida. Cuando una foto se ve (o está por verse) más grande que su miniatura —a lo ancho de la hoja, en
// una fila, o en una pantalla de alta densidad—, se pide a la cola una imagen de hasta 2048 px
// (`MediaQueue.view`: del original del dispositivo o, si no está, del original bajado una vez con un pase del
// portero) y, ya decodificada, reemplaza a la miniatura en ese `<img>`. Nada cambia en el documento: BlockNote
// sigue creyendo que muestra la miniatura, y si vuelve a ponerla (o la pone `subscribeThumbs`), se vuelve a
// cambiar.
//
// Una foto sin ancho propio se ve del ancho natural de su miniatura (la caja de BlockNote es `fit-content`):
// la imagen nítida es más grande, así que lleva ese ancho como tope (`--sd-thumb-w`, ver styles.css) y
// `data-sd-sharp` con el número, para que la foto quede del mismo tamaño que antes (y la vista de impresión
// mida lo mismo, printView.ts).

export type SharpMedia = Pick<MediaQueue, 'isThumbUrl' | 'viewUrl' | 'view'>;

/** Nunca se pide más que el doble de píxeles del ancho en pantalla (un teléfono de 3x no necesita 3x). */
export const MAX_DENSITY = 2;
/** Cuántas imágenes nítidas se preparan a la vez (bajadas del portero o reducciones del original). */
export const SHARP_CONCURRENCY = 2;

/**
 * Hace falta algo más nítido que la miniatura: el ancho con que se dibuja, en píxeles del dispositivo (hasta
 * 2x), pasa por `VIEW_GAIN` el ancho de la miniatura.
 */
export function wantsSharper(cssWidth: number, dpr: number, thumbWidth: number): boolean {
  if (!(cssWidth > 0) || !(thumbWidth > 0)) return false;
  const density = Math.min(MAX_DENSITY, Math.max(1, dpr || 1));
  return cssWidth * density > thumbWidth * VIEW_GAIN;
}

/**
 * Se puede bajar un original del portero para la página: con red y sin que el navegador pida ahorrar datos
 * (`Save-Data`) ni diga que la conexión es lenta. Lo del dispositivo se usa siempre.
 */
export function downloadsAllowed(nav: Navigator | null = typeof navigator === 'undefined' ? null : navigator): boolean {
  if (!nav) return false;
  if (nav.onLine === false) return false;
  const connection = (nav as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData) return false;
  return !['slow-2g', '2g', '3g'].includes(connection?.effectiveType ?? '');
}

/**
 * Baja el original con un pase del portero (el mismo que usa el carrete, reusado mientras no venza). Si el
 * portero dice que el pase ya no sirve, pide otro una vez.
 */
export function porteroDownload(
  media: Pick<MediaQueue, 'pass'>,
  fetchImpl: (url: string) => Promise<Response> = (url) => fetch(url),
): (id: string) => Promise<Blob> {
  return async (id) => {
    for (let attempt = 0; ; attempt++) {
      const url = await passFor(media, id);
      const res = await fetchImpl(url);
      if (res.ok) return res.blob();
      forgetPass(media, id);
      if (attempt >= 1 || ![401, 403, 404, 410].includes(res.status)) throw new Error(`portero ${res.status}`);
    }
  };
}

export interface SharpOptions {
  /** Baja el original del portero (sin esto, solo lo del dispositivo). */
  download?: (id: string) => Promise<Blob>;
  /** Si en este momento se puede bajar (por defecto `downloadsAllowed`). */
  canDownload?: () => boolean;
  /** La densidad de la pantalla (por defecto `devicePixelRatio`). */
  dpr?: () => number;
  /** El ancho con que se dibuja la imagen, en px de CSS (por defecto `getBoundingClientRect`). */
  measure?: (img: HTMLImageElement) => number;
  /** Espera a que la imagen nítida esté decodificada antes de mostrarla (por defecto `Image.decode`). */
  decode?: (url: string) => Promise<void>;
}

const IMAGE_BLOCK = '[data-content-type="image"][data-url]';
const MEDIA_IMG = 'img.bn-visual-media';

function decodeImage(url: string): Promise<void> {
  if (typeof Image === 'undefined') return Promise.resolve();
  const pre = new Image();
  pre.src = url;
  return typeof pre.decode === 'function' ? pre.decode().catch(() => undefined) : Promise.resolve();
}

/**
 * Empieza a cambiar las miniaturas de las fotos de `root` (el editor) por imágenes nítidas cuando hace falta.
 * Devuelve la función para dejar de hacerlo (las imágenes ya cambiadas quedan).
 */
export function sharpenImages(root: HTMLElement, media: SharpMedia, options: SharpOptions = {}): () => void {
  const canDownload = options.canDownload ?? (() => downloadsAllowed());
  const dpr = options.dpr ?? (() => (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1));
  const measure = options.measure ?? ((img: HTMLImageElement) => img.getBoundingClientRect().width);
  const decode = options.decode ?? decodeImage;
  /** El ancho natural de la miniatura de cada archivo (el tope de una foto sin ancho propio). */
  const thumbWidths = new Map<string, number>();
  const queued = new Set<string>();
  const waiting: string[] = [];
  const visible = new Set<HTMLImageElement>();
  let active = 0;
  let stopped = false;

  const idOf = (img: HTMLImageElement): string | null => mediaIdOf(img.closest(IMAGE_BLOCK)?.getAttribute('data-url'));

  const unmark = (img: HTMLImageElement) => {
    if (img.dataset.sdSharp === undefined) return;
    delete img.dataset.sdSharp;
    img.style.removeProperty('--sd-thumb-w');
  };

  const show = (img: HTMLImageElement, url: string, thumbWidth: number) => {
    const w = String(thumbWidth);
    if (img.dataset.sdSharp !== w) img.dataset.sdSharp = w;
    if (img.style.getPropertyValue('--sd-thumb-w') !== `${thumbWidth}px`) img.style.setProperty('--sd-thumb-w', `${thumbWidth}px`);
    if (img.getAttribute('src') !== url) img.src = url;
  };

  /** Pone la imagen nítida en todas las fotos de ese archivo que todavía muestran la miniatura. */
  const apply = (id: string, url: string) => {
    const width = thumbWidths.get(id);
    if (!width) return;
    for (const img of root.querySelectorAll<HTMLImageElement>(`${IMAGE_BLOCK} ${MEDIA_IMG}`)) {
      if (idOf(img) === id && media.isThumbUrl(id, img.getAttribute('src') ?? '')) show(img, url, width);
    }
  };

  const pump = () => {
    while (!stopped && active < SHARP_CONCURRENCY && waiting.length > 0) {
      const id = waiting.shift()!;
      active++;
      void media
        .view(id, { download: options.download && canDownload() ? options.download : undefined })
        .then(async (url) => {
          if (!url || stopped) return;
          await decode(url);
          if (!stopped) apply(id, url);
        })
        .catch(() => undefined)
        .finally(() => {
          active--;
          queued.delete(id);
          pump();
        });
    }
  };

  /** La foto se ve: si se dibuja más grande que su miniatura, pide la nítida. */
  const check = (img: HTMLImageElement) => {
    if (stopped || !img.isConnected) return;
    const id = idOf(img);
    if (!id || !media.isThumbUrl(id, img.getAttribute('src') ?? '')) return;
    if (!img.complete || !img.naturalWidth) {
      img.addEventListener('load', () => check(img), { once: true });
      return;
    }
    thumbWidths.set(id, img.naturalWidth);
    if (!wantsSharper(measure(img), dpr(), img.naturalWidth)) return;
    const ready = media.viewUrl(id);
    if (ready) {
      show(img, ready, img.naturalWidth);
      return;
    }
    if (queued.has(id)) return;
    queued.add(id);
    waiting.push(id);
    pump();
  };

  const io =
    typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const img = entry.target as HTMLImageElement;
              if (entry.isIntersecting) {
                visible.add(img);
                check(img);
              } else {
                visible.delete(img);
              }
            }
          },
          { rootMargin: '600px 0px' },
        );

  /** Una foto que apareció o cambió de dirección. */
  const consider = (img: HTMLImageElement) => {
    const id = idOf(img);
    const src = img.getAttribute('src') ?? '';
    if (!id || !media.isThumbUrl(id, src)) {
      // Muestra otra cosa: la nítida (queda como está), o un ícono, un borrado, otro archivo (sin el tope).
      if (!id || src !== media.viewUrl(id)) unmark(img);
      return;
    }
    // BlockNote (o `subscribeThumbs`) volvió a poner la miniatura: si la nítida ya estaba, en el acto.
    const ready = media.viewUrl(id);
    const width = thumbWidths.get(id);
    if (ready && width && img.dataset.sdSharp !== undefined) {
      show(img, ready, width);
      return;
    }
    if (io) io.observe(img);
    else check(img);
  };

  const scan = (node: ParentNode) => {
    if (node instanceof HTMLImageElement) {
      if (node.matches(MEDIA_IMG)) consider(node);
      return;
    }
    for (const img of node.querySelectorAll<HTMLImageElement>(MEDIA_IMG)) consider(img);
  };

  const mo = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes') {
        const el = r.target as Element;
        if (el instanceof HTMLImageElement) {
          if (el.matches(MEDIA_IMG)) consider(el);
        } else {
          scan(el);
        }
        continue;
      }
      for (const node of r.addedNodes) if (node instanceof Element) scan(node);
      for (const node of r.removedNodes) {
        if (!(node instanceof Element)) continue;
        const imgs = node instanceof HTMLImageElement ? [node] : [...node.querySelectorAll<HTMLImageElement>(MEDIA_IMG)];
        for (const img of imgs) {
          io?.unobserve(img);
          visible.delete(img);
        }
      }
    }
  });
  mo.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'data-url'] });
  scan(root);

  // Al cambiar el ancho de la ventana (girar el teléfono), una foto a la vista puede necesitar más.
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  const onResize = () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      for (const img of visible) check(img);
    }, 300);
  };
  if (typeof window !== 'undefined') window.addEventListener('resize', onResize);

  return () => {
    stopped = true;
    mo.disconnect();
    io?.disconnect();
    if (resizeTimer) clearTimeout(resizeTimer);
    if (typeof window !== 'undefined') window.removeEventListener('resize', onResize);
  };
}
