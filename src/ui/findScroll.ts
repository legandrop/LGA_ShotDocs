// Llevar a la vista la coincidencia actual de la búsqueda (Docs/Doc_Buscar.md, "Ajustes de v0.057"). Sin
// ProseMirror: solo el DOM, así se prueba con jsdom.
//
// La app no desplaza la ventana sino `.main` (y de costado, con una hoja más ancha que la ventana, como A3):
// se busca ese contenedor y se centra ahí la coincidencia, a mano (no `scrollIntoView`, que mueve todos los
// antepasados y respeta a medias la barra de arriba). Al llegar desde la búsqueda del proyecto, la página
// todavía se está acomodando (fotos que bajan, marcas de hoja, lo que se abre de una sección colapsada): por
// un rato se vuelve a centrar con cada cambio de tamaño, y se deja de hacer apenas la persona desplaza,
// toca, hace clic o escribe.

/** Cuánto se sigue acomodando después de llegar desde la búsqueda del proyecto (si nadie toca nada). */
export const SETTLE_MS = 4000;
/** Margen a los costados al traer una coincidencia de costado. */
const EDGE = 24;

/** El contenedor que se desplaza: el primer antepasado con `overflow` auto o scroll (en la app, `.main`). */
export function scrollParent(el: Element): HTMLElement | null {
  const doc = el.ownerDocument;
  for (let p = el.parentElement; p && p !== doc.body && p !== doc.documentElement; p = p.parentElement) {
    const style = getComputedStyle(p);
    if (/auto|scroll|overlay/.test(`${style.overflowY} ${style.overflowX}`)) return p;
  }
  return (doc.scrollingElement as HTMLElement | null) ?? doc.documentElement;
}

const px = (value: string) => parseFloat(value) || 0;

/**
 * Centra `el` en lo que se ve de `scroller` (de arriba abajo, debajo de la barra de arriba: su
 * `scroll-padding-top`) y, si queda afuera de costado, lo trae con un margen. `false` si `el` no se ve (está
 * escondido: no hay dónde ir).
 */
export function centerInScroller(scroller: HTMLElement, el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const doc = el.ownerDocument;
  const isPage = scroller === doc.scrollingElement || scroller === doc.documentElement || scroller === doc.body;
  const box = isPage ? { top: 0, left: 0 } : scroller.getBoundingClientRect();
  const style = getComputedStyle(scroller);
  const top = box.top + scroller.clientTop + px(style.scrollPaddingTop);
  const bottom = box.top + scroller.clientTop + scroller.clientHeight - px(style.scrollPaddingBottom);
  const left = box.left + scroller.clientLeft + px(style.scrollPaddingLeft);
  const right = box.left + scroller.clientLeft + scroller.clientWidth - px(style.scrollPaddingRight);
  const dy = Math.round((r.top + r.bottom) / 2 - (top + bottom) / 2);
  let dx = 0;
  if (r.right - r.left > right - left - 2 * EDGE || r.left < left + EDGE) dx = Math.round(r.left - left - EDGE);
  else if (r.right > right - EDGE) dx = Math.round(r.right - right + EDGE);
  if (dy !== 0) scroller.scrollTop += dy;
  if (dx !== 0 && (r.left < left || r.right > right)) scroller.scrollLeft += dx;
  return true;
}

/** Lo que está acomodando cada editor (uno por vez: ir a otra coincidencia corta el anterior). */
const keepers = new WeakMap<Element, () => void>();

/** Deja de acomodar lo de ese editor (se cerró la barra, se fue a otra coincidencia). */
export function stopKeepingInView(owner: Element): void {
  keepers.get(owner)?.();
}

const frame = (fn: () => void): (() => void) => {
  if (typeof requestAnimationFrame !== 'function') {
    fn();
    return () => undefined;
  }
  const id = requestAnimationFrame(fn);
  return () => cancelAnimationFrame(id);
};

/**
 * Lleva a la vista lo que da `find` (la coincidencia actual del editor `owner`) en el próximo cuadro. Con
 * `settleMs`, lo vuelve a centrar cada vez que cambia el tamaño de la página, hasta ese tiempo o hasta que la
 * persona desplaza, toca, hace clic o aprieta una tecla. `after` corre después de cada vez (correr la barra si
 * tapa la coincidencia).
 */
export function keepInView(
  owner: HTMLElement,
  find: () => HTMLElement | null,
  { settleMs = 0, after }: { settleMs?: number; after?: (el: HTMLElement) => void } = {},
): () => void {
  stopKeepingInView(owner);
  const scroller = scrollParent(owner);
  let cancelFrame: (() => void) | null = null;
  let stopped = false;
  const cleanups: (() => void)[] = [];
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelFrame?.();
    for (const fn of cleanups.splice(0)) fn();
    if (keepers.get(owner) === stop) keepers.delete(owner);
  };
  const apply = () => {
    cancelFrame = null;
    if (stopped) return;
    if (!owner.isConnected) return stop();
    const el = find();
    if (!el || !scroller) return;
    if (centerInScroller(scroller, el)) after?.(el);
    if (settleMs <= 0) stop();
  };
  const schedule = () => {
    if (stopped || cancelFrame) return;
    let ran = false;
    const cancel = frame(() => {
      ran = true;
      apply();
    });
    if (!ran) cancelFrame = cancel;
  };
  keepers.set(owner, stop);
  schedule();
  // Una sola vez (ir con Enter a la siguiente): se termina en cuanto se aplica.
  if (settleMs <= 0 || !scroller || stopped) return stop;
  // Cualquier cambio de alto o ancho de la página (una foto que bajó, una sección que se abrió, las marcas de
  // hoja) vuelve a centrar.
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(schedule);
    observer.observe(owner);
    const page = owner.closest('article');
    if (page) observer.observe(page);
    cleanups.push(() => observer.disconnect());
  }
  // Las fotos avisan cuando terminan de bajar (por si no cambia el tamaño de lo observado).
  owner.addEventListener('load', schedule, true);
  cleanups.push(() => owner.removeEventListener('load', schedule, true));
  // La persona manda: desplazar, tocar, hacer clic o una tecla lo corta.
  const user = () => stop();
  const target = scroller === owner.ownerDocument.scrollingElement ? owner.ownerDocument : scroller;
  for (const type of ['wheel', 'touchstart', 'pointerdown', 'mousedown'] as const) {
    target.addEventListener(type, user, { passive: true, capture: true });
    cleanups.push(() => target.removeEventListener(type, user, { capture: true }));
  }
  const win = owner.ownerDocument.defaultView;
  win?.addEventListener('keydown', user, true);
  cleanups.push(() => win?.removeEventListener('keydown', user, true));
  const timer = setTimeout(stop, settleMs);
  cleanups.push(() => clearTimeout(timer));
  return stop;
}
