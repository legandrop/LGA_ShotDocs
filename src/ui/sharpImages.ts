import { mediaIdOf, VIEW_FETCH_MAX_BYTES, type MediaQueue, type SharpView } from '../media/queue';
import { VIEW_GAIN, VIEW_SIDE, VIEW_SIDE_SMALL } from '../media/probe';
import { forgetPass, passFor } from './carreteLoader';
import { thumbSize } from './sharpMarks';

// Fotos nítidas en la página (Docs/Doc_Imagenes.md, "Calidad en la página"). La página muestra primero la
// miniatura (480 px de lado, guardada en el dispositivo o bajada del bucket `thumbs`): anda sin red y carga
// enseguida. Cuando una foto se ve (o está por verse) más grande que su miniatura —a lo ancho de la hoja, en
// una fila, o en una pantalla de alta densidad—, se pide a la cola una imagen de hasta 2048 px (1024 si se
// dibuja chica) (`MediaQueue.view`: del original del dispositivo o, si no está, del original bajado una vez con
// un pase del portero) y, ya decodificada, reemplaza a la miniatura en ese `<img>`. Nada cambia en el
// documento: BlockNote sigue creyendo que muestra la miniatura, y si vuelve a ponerla (o la pone
// `subscribeThumbs`), se vuelve a cambiar.
//
// Una foto sin ancho propio se ve del ancho natural de su miniatura (la caja de BlockNote es `fit-content`):
// la imagen nítida es más grande, así que lleva ese ancho como tope (`--sd-thumb-w`, ver styles.css). En la
// imagen quedan `data-sd-sharp` y `data-sd-sharp-h` (las medidas naturales de la miniatura: la vista de
// impresión y "Acomodar en filas" usan esas, así dan igual en todos los dispositivos), `data-sd-sharp-id` (de
// qué archivo) y `data-sd-side` (el lado mayor de la nítida que muestra).

export type SharpMedia = Pick<MediaQueue, 'isThumbUrl' | 'viewOf' | 'view'>;

/** Nunca se pide más que el doble de píxeles del ancho en pantalla (un teléfono de 3x no necesita 3x). */
export const MAX_DENSITY = 2;
/** Cuántas imágenes nítidas se preparan a la vez (bajadas del portero o reducciones del original). */
export const SHARP_CONCURRENCY = 2;
/** En un teléfono o una tableta, lo más grande que se baja del portero para la página (datos móviles). */
export const TOUCH_FETCH_MAX_BYTES = 8 * 1024 * 1024;
/** Cada cuánto se vuelven a mirar las fotos a la vista (una bajada que falló se reintenta al minuto, después más). */
export const RECHECK_MS = 65_000;
/** Bajadas seguidas que fallan sin respuesta (con red) antes de dejar de bajar un rato. */
export const BREAKER_FAILURES = 3;
export const BREAKER_MS = 30 * 60_000;

/** Los píxeles del dispositivo con que se dibuja (hasta 2x). */
function devicePixels(cssWidth: number, dpr: number): number {
  return cssWidth * Math.min(MAX_DENSITY, Math.max(1, dpr || 1));
}

/**
 * Hace falta algo más nítido que la miniatura: el ancho con que se dibuja, en píxeles del dispositivo (hasta
 * 2x), pasa por `VIEW_GAIN` el ancho de la miniatura.
 */
export function wantsSharper(cssWidth: number, dpr: number, thumbWidth: number): boolean {
  if (!(cssWidth > 0) || !(thumbWidth > 0)) return false;
  return devicePixels(cssWidth, dpr) > thumbWidth * VIEW_GAIN;
}

/**
 * El lado mayor de la imagen nítida que hace falta: 1024 si la foto se dibuja a 900 px del dispositivo o menos
 * (un teléfono; menos lugar y menos memoria), 2048 si no.
 */
export function sharpSide(cssWidth: number, dpr: number): number {
  return devicePixels(cssWidth, dpr) <= 900 ? VIEW_SIDE_SMALL : VIEW_SIDE;
}

/**
 * Se puede bajar un original del portero para la página: con red y sin que el navegador pida ahorrar datos
 * (`Save-Data`) ni diga que la conexión es lenta. Ojo: `navigator.connection` solo existe en Chrome (y Edge,
 * Android); Safari y Firefox no dicen si la conexión es medida o lenta, así que ahí se baja igual (con el tope
 * de `TOUCH_FETCH_MAX_BYTES` en un teléfono). Lo del dispositivo se usa siempre.
 */
/**
 * Modo liviano (link público, Docs/Doc_Link_Publico.md, P12): el visitante ve las miniaturas y abre el original en el
 * carrete o al bajarlo; la página no baja originales sola.
 */
let lightMode = false;

export function setLightImages(on: boolean): void {
  lightMode = on;
}

export function downloadsAllowed(nav: Navigator | null = typeof navigator === 'undefined' ? null : navigator): boolean {
  if (!nav || lightMode) return false;
  if (nav.onLine === false) return false;
  const connection = (nav as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData) return false;
  return !['slow-2g', '2g', '3g'].includes(connection?.effectiveType ?? '');
}

/** Un teléfono o una tableta (puntero grueso): se bajan originales de hasta `TOUCH_FETCH_MAX_BYTES`. */
export function fetchLimit(): number {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return coarse ? TOUCH_FETCH_MAX_BYTES : VIEW_FETCH_MAX_BYTES;
}

/**
 * Baja el original con un pase del portero (el mismo que usa el carrete, reusado mientras no venza). Si el
 * portero dice que el pase ya no sirve, pide otro una vez. Necesita el portero de v0.059 (con CORS en `/m/`):
 * con uno anterior el navegador no deja leer la respuesta, falla y la página sigue con la miniatura.
 */
export function porteroDownload(
  media: Pick<MediaQueue, 'pass'>,
  fetchImpl: (url: string, signal?: AbortSignal) => Promise<Response> = (url, signal) => fetch(url, signal ? { signal } : undefined),
  now: () => number = Date.now,
  online: () => boolean = () => typeof navigator === 'undefined' || navigator.onLine !== false,
): (id: string, signal?: AbortSignal, received?: (bytes: number) => void) => Promise<Blob> {
  // Con red, un `fetch` que falla sin respuesta es casi siempre CORS (un portero anterior a v0.059): después de
  // `BREAKER_FAILURES` seguidos no se baja nada por `BREAKER_MS` (la página sigue con las miniaturas).
  let failures = 0;
  let closedUntil = 0;
  // `signal` corta la bajada (exportar: *Cancel*, o el tope de tiempo por original); un corte no cuenta como falla.
  return async (id, signal, received) => {
    const checkAbort = () => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    };
    checkAbort();
    if (now() < closedUntil) throw new Error('portero: paused');
    for (let attempt = 0; ; attempt++) {
      const url = await passFor(media, id);
      checkAbort();
      let res: Response;
      try {
        res = await fetchImpl(url, signal);
      } catch (err) {
        if (signal?.aborted) throw err;
        if (online() && ++failures >= BREAKER_FAILURES) {
          closedUntil = now() + BREAKER_MS;
          failures = 0;
        }
        throw err;
      }
      failures = 0;
      if (res.ok) return received ? progressBlob(res, signal, received) : res.blob();
      // Solo el modo con progreso (PDF): un error no deja su cuerpo descargándose mientras se renueva el pase.
      if (received) void res.body?.cancel().catch(() => undefined);
      forgetPass(media, id);
      if (attempt >= 1 || ![401, 403, 404, 410].includes(res.status)) throw new Error(`portero ${res.status}`);
    }
  };
}

/** Original del PDF: leer bytes permite distinguir una descarga lenta de una detenida y cancelar su lector real. */
async function progressBlob(res: Response, signal: AbortSignal | undefined, received: (bytes: number) => void): Promise<Blob> {
  const reader = res.body?.getReader();
  if (!reader) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return res.blob();
  }
  const chunks: BlobPart[] = [];
  const cancel = () => { void reader.cancel(signal?.reason).catch(() => undefined); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    if (signal?.aborted) cancel();
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (done) return new Blob(chunks, { type: res.headers.get('Content-Type') ?? '' });
      if (value.byteLength > 0) {
        chunks.push(value);
        received(value.byteLength);
      }
    }
  } catch (err) {
    void reader.cancel(err).catch(() => undefined);
    throw err;
  } finally {
    signal?.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

export interface SharpOptions {
  /** Baja el original del portero (sin esto, solo lo del dispositivo). */
  download?: (id: string) => Promise<Blob>;
  /** Si en este momento se puede bajar (por defecto `downloadsAllowed`). */
  canDownload?: () => boolean;
  /** Lo más grande que se baja (por defecto `fetchLimit`). */
  maxBytes?: () => number;
  /** La densidad de la pantalla (por defecto `devicePixelRatio`). */
  dpr?: () => number;
  /** El ancho con que se dibuja la imagen, en px de CSS (por defecto `getBoundingClientRect`). */
  measure?: (img: HTMLImageElement) => number;
  /** Espera a que la imagen nítida esté decodificada antes de mostrarla (por defecto `Image.decode`). */
  decode?: (url: string) => Promise<void>;
  /** Lo que se desplaza (por defecto `.main`, o la ventana): se mira 600 px más allá de lo que se ve. */
  scrollRoot?: Element | null;
}

const IMAGE_BLOCK = '[data-content-type="image"][data-url]';
/** La foto en línea (inlinePhoto.ts, Docs/Doc_Fotos_En_Linea.md): su `<span>` lleva la dirección. */
const INLINE_PHOTO = '.sd-photo[data-url]';
const MEDIA_IMG = 'img.bn-visual-media';
/**
 * Las imágenes de foto de la página: la de cada bloque `image` y la de cada foto en línea (su hija directa: nunca
 * el `<img class="ProseMirror-separator">` de ancho 0 que ProseMirror pone junto a un nodo en línea).
 */
const PHOTO_IMGS = `${IMAGE_BLOCK} ${MEDIA_IMG}, ${INLINE_PHOTO} > ${MEDIA_IMG}`;

/** La dirección guardada de la foto de esa imagen: la de su foto en línea o la de su bloque `image`. */
export function photoUrlOf(img: HTMLImageElement): string | null {
  const inline = img.parentElement?.matches(INLINE_PHOTO) ? img.parentElement : null;
  return (inline ?? img.closest(IMAGE_BLOCK))?.getAttribute('data-url') ?? null;
}

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
  const maxBytes = options.maxBytes ?? fetchLimit;
  const dpr = options.dpr ?? (() => (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1));
  const measure = options.measure ?? ((img: HTMLImageElement) => img.getBoundingClientRect().width);
  const decode = options.decode ?? decodeImage;
  /** Las medidas naturales de la miniatura de cada archivo (el tope de una foto sin ancho propio). */
  const thumbs = new Map<string, { width: number; height: number }>();
  /** Lo pedido y todavía no empezado: archivo → el lado mayor que hace falta (lo último pedido, al final). */
  const waiting = new Map<string, number>();
  const running = new Set<string>();
  const visible = new Set<HTMLImageElement>();
  let active = 0;
  let stopped = false;

  const idOf = (img: HTMLImageElement): string | null => mediaIdOf(photoUrlOf(img));

  const unmark = (img: HTMLImageElement) => {
    if (img.dataset.sdSharp === undefined && img.dataset.sdSharpId === undefined) return;
    delete img.dataset.sdSharp;
    delete img.dataset.sdSharpH;
    delete img.dataset.sdSharpId;
    delete img.dataset.sdSide;
    img.style.removeProperty('--sd-thumb-w');
  };

  const setData = (img: HTMLImageElement, key: string, value: string) => {
    if (img.dataset[key] !== value) img.dataset[key] = value;
  };

  const show = (img: HTMLImageElement, id: string, view: SharpView, thumb: { width: number; height: number }) => {
    setData(img, 'sdSharp', String(thumb.width));
    setData(img, 'sdSharpH', String(thumb.height));
    setData(img, 'sdSharpId', id);
    setData(img, 'sdSide', String(view.side));
    if (img.style.getPropertyValue('--sd-thumb-w') !== `${thumb.width}px`) img.style.setProperty('--sd-thumb-w', `${thumb.width}px`);
    if (img.getAttribute('src') !== view.url) img.src = view.url;
  };

  /** Una nítida de este archivo que la página ya puso (marcada por `show`). */
  const showsSharp = (img: HTMLImageElement, id: string): boolean =>
    img.dataset.sdSharpId === id && !!img.dataset.sdSide && (img.getAttribute('src') ?? '').startsWith('blob:');

  /** Muestra la miniatura de ese archivo o una nítida suya (no un ícono, un borrado ni otro archivo). */
  const ownPicture = (img: HTMLImageElement, id: string): 'thumb' | 'sharp' | null => {
    if (media.isThumbUrl(id, img.getAttribute('src') ?? '')) return 'thumb';
    return showsSharp(img, id) ? 'sharp' : null;
  };

  const imagesOf = (id: string): HTMLImageElement[] =>
    [...root.querySelectorAll<HTMLImageElement>(PHOTO_IMGS)].filter((img) => idOf(img) === id);

  /** Pone la imagen nítida en las fotos de ese archivo que muestran la miniatura o una nítida más chica. */
  const apply = (id: string, view: SharpView) => {
    const thumb = thumbs.get(id);
    if (!thumb) return;
    for (const img of imagesOf(id)) {
      const picture = ownPicture(img, id);
      if (picture === 'thumb' || (picture === 'sharp' && Number(img.dataset.sdSide) < view.side)) show(img, id, view, thumb);
    }
  };

  /** Alguna foto de ese archivo está a la vista (o por verse). */
  const wanted = (id: string): boolean => {
    if (!io) return true;
    for (const img of visible) if (img.isConnected && idOf(img) === id) return true;
    return false;
  };

  const pump = () => {
    while (!stopped && active < SHARP_CONCURRENCY && waiting.size > 0) {
      // Lo último pedido primero (lo que se acaba de ver); lo que ya se pasó de largo se descarta (se vuelve a
      // pedir si se vuelve a ver).
      const [id, side] = [...waiting].pop()!;
      waiting.delete(id);
      if (!wanted(id)) continue;
      active++;
      running.add(id);
      void media
        .view(id, { download: options.download && canDownload() ? options.download : undefined, side, maxBytes: maxBytes() })
        .then(async (view) => {
          if (!view || stopped) return;
          await decode(view.url);
          if (!stopped) apply(id, view);
        })
        .catch(() => undefined)
        .finally(() => {
          active--;
          running.delete(id);
          pump();
        });
    }
  };

  const request = (id: string, side: number) => {
    if (running.has(id)) return;
    waiting.delete(id);
    waiting.set(id, side);
    pump();
  };

  /** La foto se ve (o cambió de ancho): si se dibuja más grande que lo que muestra, pide la nítida. */
  const check = (img: HTMLImageElement) => {
    if (stopped || !img.isConnected) return;
    const id = idOf(img);
    if (!id) return;
    const picture = ownPicture(img, id);
    if (!picture) return;
    if (picture === 'thumb') {
      if (!img.complete || !img.naturalWidth) {
        img.addEventListener('load', () => check(img), { once: true });
        return;
      }
      thumbs.set(id, { width: img.naturalWidth, height: img.naturalHeight });
    } else if (!thumbs.has(id)) {
      thumbs.set(id, thumbSize(img));
    }
    const thumb = thumbs.get(id)!;
    const width = measure(img);
    if (!wantsSharper(width, dpr(), thumb.width)) return;
    const side = sharpSide(width, dpr());
    if (picture === 'sharp' && Number(img.dataset.sdSide) >= side) return;
    const ready = media.viewOf(id);
    if (ready && ready.side >= side) {
      show(img, id, ready, thumb);
      return;
    }
    request(id, side);
  };

  const scrollRoot = options.scrollRoot !== undefined ? options.scrollRoot : root.closest('.main');
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
          { root: scrollRoot, rootMargin: '600px 0px' },
        );

  // Una foto a la vista que cambia de ancho (tamaños rápidos, tirador, "Acomodar en filas", hoja más ancha,
  // barra lateral) puede necesitar más.
  const ro =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver((entries) => {
          for (const entry of entries) {
            const img = entry.target as HTMLImageElement;
            if (!io || visible.has(img)) check(img);
          }
        });

  const watch = (img: HTMLImageElement) => {
    if (io) io.observe(img);
    ro?.observe(img);
    if (!io) check(img);
  };

  /** Una foto que apareció o cambió de dirección. */
  const consider = (img: HTMLImageElement) => {
    const id = idOf(img);
    if (!id) {
      unmark(img);
      return;
    }
    // Las marcas son de otro archivo (se reemplazó la foto del bloque): no valen.
    if (img.dataset.sdSharpId !== undefined && img.dataset.sdSharpId !== id) unmark(img);
    if (!media.isThumbUrl(id, img.getAttribute('src') ?? '')) {
      // Muestra otra cosa: una nítida de este archivo (queda como está), o un ícono, un borrado (sin el tope).
      if (!showsSharp(img, id)) unmark(img);
      watch(img);
      return;
    }
    // BlockNote (o `subscribeThumbs`) volvió a poner la miniatura: si la nítida ya estaba, en el acto.
    const ready = media.viewOf(id);
    const thumb = thumbs.get(id);
    if (ready && thumb && img.dataset.sdSharpId === id) {
      show(img, id, ready, thumb);
      return;
    }
    // Sin nítida a mano: la miniatura sin marcas (si no, quedaría el tope de antes).
    unmark(img);
    watch(img);
  };

  const scan = (node: ParentNode) => {
    if (node instanceof HTMLImageElement) {
      if (node.matches(MEDIA_IMG)) consider(node);
      return;
    }
    for (const img of node.querySelectorAll<HTMLImageElement>(MEDIA_IMG)) consider(img);
  };

  const forget = (img: HTMLImageElement) => {
    io?.unobserve(img);
    ro?.unobserve(img);
    visible.delete(img);
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
      for (const node of r.removedNodes) {
        if (!(node instanceof Element)) continue;
        const imgs = node instanceof HTMLImageElement ? [node] : [...node.querySelectorAll<HTMLImageElement>(MEDIA_IMG)];
        for (const img of imgs) if (!img.isConnected) forget(img);
      }
      for (const node of r.addedNodes) if (node instanceof Element) scan(node);
    }
  });
  mo.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'data-url'] });
  scan(root);

  /** Vuelve a mirar las fotos a la vista (volvió la red, pasó el tiempo de reintentar, cambió la ventana). */
  const recheck = () => {
    for (const img of io ? [...visible] : [...root.querySelectorAll<HTMLImageElement>(MEDIA_IMG)]) check(img);
  };
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  const onResize = () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(recheck, 300);
  };
  const timer = setInterval(recheck, RECHECK_MS);
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', onResize);
    window.addEventListener('online', recheck);
  }

  return () => {
    stopped = true;
    mo.disconnect();
    io?.disconnect();
    ro?.disconnect();
    clearInterval(timer);
    if (resizeTimer) clearTimeout(resizeTimer);
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('online', recheck);
    }
    waiting.clear();
  };
}
