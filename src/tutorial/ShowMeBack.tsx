import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { useT } from '../i18n';
import { goBack, useNavPosition } from '../navHistory';
import type { Rect } from '../ui/floating';
import { ChevronLeftIcon } from '../ui/icons';
import { useNavOpen } from '../ui/navStore';
import { asAction, tipRows } from '../ui/tipRows';

// El ‹ de la barra durante «Show me» (Docs/Doc_Navegacion.md, D741): el bloqueador de la recorrida y la app `inert` lo
// tapan, así que va una copia encima, en el mismo lugar y con el mismo aspecto. Vuelve igual que el de la barra
// (`goBack`): saca la entrada de la práctica y el paso termina al volver a la página.
//
// Solo se muestra si el ‹ de verdad es lo que se vería ahí: no con el cajón de páginas abierto (en el teléfono lo tapa)
// ni si su lugar se cruza con el globito o con la barra lateral. Se vuelve a medir cuando cambia el tamaño de la barra,
// del globito o de la ventana, al terminar una transición (el cajón) y en cada dibujo del paso.

/** Si dos rectángulos se pisan (los bordes que solo se tocan no cuentan). */
function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
}

function rectOf(el: Element | null | undefined): Rect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
}

/**
 * Dónde va la copia, o `null` si no va: el ‹ de la barra no se ve (no está, mide 0, quedó fuera de la pantalla), el
 * cajón está abierto o algo de `covers` (el globito, la barra lateral) pisa su lugar.
 */
export function showMeBackRect(back: Rect | null, covers: (Rect | null)[], navOpen: boolean, viewport = { width: window.innerWidth, height: window.innerHeight }): Rect | null {
  if (!back || navOpen) return null;
  if (back.left + back.width <= 0 || back.top + back.height <= 0 || back.left >= viewport.width || back.top >= viewport.height) return null;
  return covers.some((c) => c && overlaps(back, c)) ? null : back;
}

const same = (a: Rect | null, b: Rect | null) => a === b || (!!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);

export function ShowMeBack({ bubble }: { bubble: RefObject<HTMLElement | null> }) {
  const tr = useT();
  const { canBack } = useNavPosition();
  const navOpen = useNavOpen();
  const [rect, setRect] = useState<Rect | null>(null);

  const measure = useCallback(() => {
    const back = rectOf(document.querySelector('.topbar [data-test="nav-back"]'));
    const next = showMeBackRect(back, [rectOf(bubble.current), rectOf(document.querySelector('.sidebar'))], navOpen);
    setRect((prev) => (same(prev, next) ? prev : next));
  }, [bubble, navOpen]);

  // En cada dibujo (el globito se ubica después de medirse; el cajón se abre o se cierra).
  useLayoutEffect(measure);

  useEffect(() => {
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => measure()) : null;
    const topbar = document.querySelector('.topbar');
    if (topbar) observer?.observe(topbar);
    if (bubble.current) observer?.observe(bubble.current);
    const vv = window.visualViewport;
    window.addEventListener('resize', measure);
    vv?.addEventListener('resize', measure);
    // El cajón entra y sale con una transición (un `transform`, que ResizeObserver no ve).
    document.addEventListener('transitionend', measure, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      vv?.removeEventListener('resize', measure);
      document.removeEventListener('transitionend', measure, true);
    };
  }, [bubble, measure]);

  if (!rect || !canBack) return null;
  return (
    <button
      className="icon-button nav-button tour-nav-back"
      data-test="tour-nav-back"
      aria-label={tr('shell.navBack')}
      data-tip={tipRows([{ shortcut: 'navBack', action: asAction(tr('shell.navBack')) }])}
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      onClick={() => goBack()}
    >
      <ChevronLeftIcon size={18} />
    </button>
  );
}
