import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useT } from '../i18n';
import { tipRows } from './tipRows';

// El ancho de la barra lateral es de cada dispositivo (depende de la pantalla), no de la cuenta.
const KEY = 'shotdocs-sidebar-width';
const MIN = 200;
const MAX = 520;
/** Lo mínimo que le queda a la página al lado de la barra. */
const MIN_PAGE = 420;
export const DEFAULT_SIDEBAR_WIDTH = 288;

const clamp = (w: number) =>
  Math.round(Math.max(MIN, Math.min(MAX, window.innerWidth - MIN_PAGE, w)));

function readWidth(): number {
  try {
    const n = Number(localStorage.getItem(KEY));
    return n ? clamp(n) : DEFAULT_SIDEBAR_WIDTH;
  } catch {
    return DEFAULT_SIDEBAR_WIDTH;
  }
}

function apply(width: number): void {
  document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
}

function store(width: number): void {
  try {
    localStorage.setItem(KEY, String(width));
  } catch {
    // Recordar el ancho es solo una comodidad.
  }
}

// Se aplica al cargar este módulo, antes del primer pintado: sin salto de 288 al ancho guardado.
if (typeof window !== 'undefined') apply(readWidth());

/**
 * El borde derecho de la barra lateral: se arrastra para cambiar el ancho, doble clic vuelve al de
 * fábrica y con el teclado se mueve con las flechas.
 */
export function SidebarResizer() {
  const [width, setWidth] = useState(readWidth);
  const tr = useT();
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => apply(width), [width]);

  // Se guarda solo lo que elige el usuario: si la ventana se achica un momento, el ancho elegido no se
  // pisa con el recortado.
  const choose = (next: number) => {
    const w = clamp(next);
    setWidth(w);
    store(w);
  };

  // Si la ventana se achica, la barra también, para que la página no quede aplastada.
  useEffect(() => {
    // Al agrandar la ventana vuelve al ancho elegido.
    const onResize = () => setWidth(readWidth());
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      document.documentElement.classList.remove('resizing-sidebar');
    };
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startWidth: width };
    document.documentElement.classList.add('resizing-sidebar');
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setWidth(clamp(drag.current.startWidth + e.clientX - drag.current.startX));
  };
  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    document.documentElement.classList.remove('resizing-sidebar');
    store(width);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === 'ArrowLeft') choose(width - step);
    else if (e.key === 'ArrowRight') choose(width + step);
    else if (e.key === 'Home') choose(MIN);
    else if (e.key === 'End') choose(MAX);
    else return;
    e.preventDefault();
  };

  return (
    <div
      className="sidebar-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={tr('sidebar.width')}
      aria-valuemin={MIN}
      aria-valuemax={clamp(MAX)}
      aria-valuenow={width}
      tabIndex={0}
      data-tip={tipRows([
        { gesture: 'drag', action: tr('sidebar.widthDrag') },
        { gesture: 'doubleClick', action: tr('sidebar.widthReset') },
        { shortcut: 'sidebarResize', action: tr('sidebar.widthKeys') },
      ])}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={() => choose(DEFAULT_SIDEBAR_WIDTH)}
      onKeyDown={onKeyDown}
    />
  );
}
