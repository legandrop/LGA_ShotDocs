import type * as Y from 'yjs';
import { readAllMarkup, touchedFileIds, type PhotoMarkup } from '../media/markup';
import { mediaIdOf } from '../media/queue';
import { createMarkupSvg, drawMarkup } from './markupSvg';

// Las anotaciones encima de las fotos de la página (P.20, entrega 1; Docs/Doc_Anotar_Fotos.md, sección 4): la foto
// en línea (también la de una celda) y la foto-bloque. A cada foto con anotaciones se le pone su `<svg>` en la misma
// caja que el `<img>` (styles.css, `svg.sd-markup`), y se redibuja cuando cambian las suyas. Nada de esto toca el
// documento ni el editor: el `<svg>` va adentro de vistas que el editor no relee (la foto en línea ignora todo lo de
// adentro; la foto-bloque de BlockNote no tiene contenido editable).
//
// MONTADO SIEMPRE (corrección B3): toda foto anotada de la página tiene su dibujo, esté donde esté, aunque esté lejos
// de la pantalla. La vista de impresión copia el editor tal cual (printView.ts, `cloneNode`): así el PDF sale con las
// flechas aunque la foto no se haya visto. Una foto sin anotaciones no tiene `<svg>`.

/** La foto-bloque (su caja: `.bn-visual-media-wrapper`) y la foto en línea (su `<span>`), como sharpImages.ts. */
const PHOTO_IMGS = '[data-content-type="image"][data-url] .bn-visual-media-wrapper > img.bn-visual-media, .sd-photo[data-url] > img.bn-visual-media';

/** La dirección guardada de la foto de esa imagen. */
function urlOf(img: HTMLImageElement): string | null {
  const host = img.parentElement;
  if (host?.classList.contains('sd-photo')) return host.getAttribute('data-url');
  return img.closest('[data-content-type="image"][data-url]')?.getAttribute('data-url') ?? null;
}

/**
 * La imagen no muestra la foto: una tarjeta de la cola (sin copia en el dispositivo, borrada, de otro proyecto: un SVG
 * `data:`, como en inlinePhotoSize.ts) o una imagen que no cargó. Ahí no se dibuja: las flechas taparían la leyenda de
 * la tarjeta en otra proporción (auditoría O1). Cuando llega la foto, el cambio de `src` o su `load` la vuelve a dibujar.
 */
export function showsNoPhoto(img: HTMLImageElement): boolean {
  if (img.src.startsWith('data:image/svg')) return true;
  return img.complete && img.naturalWidth === 0 && !!img.getAttribute('src');
}

/** El `<svg>` de las anotaciones que ya tiene esa caja, o `null`. */
const svgIn = (host: Element): SVGSVGElement | null => {
  for (const child of host.children) if (child instanceof SVGSVGElement && child.classList.contains('sd-markup')) return child;
  return null;
};

/** Lo que mide 1 px de pantalla en unidades del marco, para la caja de la foto (0 si no se sabe). */
export function minStrokeFor(frame: { w: number; h: number }, box: { width: number; height: number }): number {
  if (!(box.width > 0) || !(box.height > 0)) return 0;
  // `meet`: la foto entra entera; la escala es la menor de las dos.
  const scale = Math.min(box.width / frame.w, box.height / frame.h);
  return scale > 0 ? 1 / scale : 0;
}

export interface MarkupOverlay {
  /** Pone al día todas las fotos ya (sin esperar al próximo turno). Lo usan las pruebas. */
  flush(): void;
  stop(): void;
}

/** Empieza a dibujar las anotaciones de `map` sobre las fotos de `root` (el editor). */
export function attachMarkupOverlay(root: HTMLElement, map: Y.Map<unknown>): MarkupOverlay {
  let photos: Map<string, PhotoMarkup> = readAllMarkup(map);
  /** Cuántas veces cambió cada foto: un `<svg>` dibujado con otra cuenta se vuelve a dibujar. */
  const stamps = new Map<string, number>();
  const drawn = new WeakMap<SVGSVGElement, { fileId: string; stamp: number; min: number }>();
  let queued = false;
  let stopped = false;

  const draw = (svg: SVGSVGElement, photo: PhotoMarkup, box: { width: number; height: number }) => {
    const min = minStrokeFor(photo.frame, box);
    drawMarkup(svg, photo, { minStroke: min });
    drawn.set(svg, { fileId: photo.fileId, stamp: stamps.get(photo.fileId) ?? 0, min });
  };

  const scan = () => {
    queued = false;
    if (stopped) return;
    // Primero se lee todo (qué falta dibujar y el tamaño de cada caja) y después se escribe: medir entre dibujo y
    // dibujo obligaba al navegador a rearmar la página cada vez (medido: 200 fotos anotadas, 200 ms por cambio).
    const pending: { svg: SVGSVGElement; photo: PhotoMarkup; host: Element }[] = [];
    for (const img of root.querySelectorAll<HTMLImageElement>(PHOTO_IMGS)) {
      const host = img.parentElement;
      if (!host) continue;
      const fileId = mediaIdOf(urlOf(img));
      const photo = fileId ? photos.get(fileId) : undefined;
      let svg = svgIn(host);
      if (!photo || showsNoPhoto(img)) {
        svg?.remove();
        continue;
      }
      if (!svg) {
        svg = createMarkupSvg();
        // Justo después de la imagen: los tiradores y las marcas de la foto quedan arriba.
        img.after(svg);
        resizes?.observe(host);
      }
      const was = drawn.get(svg);
      if (!was || was.fileId !== photo.fileId || was.stamp !== (stamps.get(photo.fileId) ?? 0)) pending.push({ svg, photo, host });
    }
    const boxes = pending.map((job) => job.host.getBoundingClientRect());
    pending.forEach((job, i) => draw(job.svg, job.photo, boxes[i]));
  };

  const schedule = () => {
    if (queued || stopped) return;
    queued = true;
    queueMicrotask(scan);
  };

  // Un cambio del mapa: se vuelve a leer y se redibujan solo las fotos tocadas.
  const onChange = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    const touched = touchedFileIds(events, map);
    if (touched.size === 0) return;
    photos = readAllMarkup(map);
    for (const id of touched) stamps.set(id, (stamps.get(id) ?? 0) + 1);
    schedule();
  };
  map.observeDeep(onChange);

  // Fotos que aparecen, se van o cambian de archivo (el editor las dibuja de nuevo; otra persona agrega una).
  const ours = (node: Node) => node instanceof SVGSVGElement && node.classList.contains('sd-markup');
  const mutations = typeof MutationObserver === 'function'
    ? new MutationObserver((records) => {
        for (const r of records) {
          if (r.type === 'attributes' || [...r.addedNodes, ...r.removedNodes].some((node) => !ours(node))) {
            schedule();
            return;
          }
        }
      })
    : null;
  // `src`: la cola cambia la tarjeta por la foto (o al revés) en la misma imagen.
  mutations?.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-url', 'src'] });
  // Una imagen que termina de cargar o falla (no burbujean: se escuchan en la captura).
  const onImage = (e: Event) => {
    if (e.target instanceof HTMLImageElement) schedule();
  };
  root.addEventListener('load', onImage, true);
  root.addEventListener('error', onImage, true);

  // Una foto que cambia de tamaño en pantalla: el grosor mínimo (1 px) se vuelve a calcular.
  const resizes = typeof ResizeObserver === 'function'
    ? new ResizeObserver((entries) => {
        for (const entry of entries) {
          const svg = svgIn(entry.target);
          const was = svg ? drawn.get(svg) : undefined;
          const photo = was ? photos.get(was.fileId) : undefined;
          if (!svg || !was || !photo) continue;
          // El tamaño que trae el aviso (la caja de la foto no tiene relleno ni borde): sin medir otra vez.
          const min = minStrokeFor(photo.frame, entry.contentRect);
          if (Math.abs(min - was.min) > was.min * 0.1) draw(svg, photo, entry.contentRect);
        }
      })
    : null;

  scan();
  return {
    flush: scan,
    stop() {
      stopped = true;
      map.unobserveDeep(onChange);
      mutations?.disconnect();
      resizes?.disconnect();
      root.removeEventListener('load', onImage, true);
      root.removeEventListener('error', onImage, true);
    },
  };
}
