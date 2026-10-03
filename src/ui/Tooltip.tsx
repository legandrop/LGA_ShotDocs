import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { placeNear, type Rect, type Side } from './floating';

// Tooltips propios, con el mismo estilo que las apps LGA en Qt: fondo oscuro, borde fino, una flecha que
// apunta al control y se da vuelta si no entra, y la misma espera de 600 ms. Cualquier elemento con
// `data-tip` lo usa. Formato: un salto de línea por renglón; `**negrita**` (blanca) solo para el gesto o el atajo de
// un renglón «gesto o atajo: acción», que arma tipRows.ts (D226). Ningún otro texto va en negrita.
//   - `data-tip-plain`: el texto va tal cual (títulos de páginas escritos por el usuario).
//   - `data-tip-overflow`: solo aparece si el texto del elemento está cortado.
//
// Regla (la misma que en Qt): un tooltip nunca repite lo que el control ya dice. Va solo cuando agrega
// algo que no se deduce del ícono o del texto, como un atajo o una segunda interacción.

const SHOW_DELAY_MS = 600;
/** Si otro tooltip se cerró hace menos que esto, el siguiente aparece sin esperar. */
const WARM_MS = 400;
// Separación entre el control y el globo: lo que mide la flecha más un poco de aire.
const GAP = 13;
const EDGE = 8;

interface Shown {
  target: HTMLElement;
  text: string;
  plain: boolean;
  /** La altura del mouse al llegar al control (`null` con el teclado): ahí va el globo de un control muy alto. */
  y?: number | null;
}

const isCut = (el: HTMLElement) => el.scrollWidth > el.clientWidth + 1;

function tipOf(target: HTMLElement): Shown | null {
  const text = target.dataset.tip;
  if (!text) return null;
  if (target.hasAttribute('data-tip-overflow') && !isCut(target)) return null;
  return { target, text, plain: target.hasAttribute('data-tip-plain') };
}

export function TooltipLayer() {
  const [shown, setShown] = useState<Shown | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHidden = useRef(0);
  const current = useRef<HTMLElement | null>(null);
  const pending = useRef<HTMLElement | null>(null);
  const pointerY = useRef<number | null>(null);

  useEffect(() => {
    const clear = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      pending.current = null;
    };
    const hide = () => {
      clear();
      if (current.current) lastHidden.current = Date.now();
      current.current = null;
      setShown(null);
    };
    // `warm`: si otro tooltip se acaba de cerrar, este no espera.
    const show = (target: HTMLElement, immediate: boolean, warm = true) => {
      if (!target.dataset.tip) return;
      clear();
      const open = () => {
        pending.current = null;
        const tip = target.isConnected ? tipOf(target) : null;
        if (!tip) return;
        current.current = target;
        setShown({ ...tip, y: pointerY.current });
      };
      if (immediate || (warm && Date.now() - lastHidden.current < WARM_MS)) open();
      else {
        pending.current = target;
        timer.current = setTimeout(open, SHOW_DELAY_MS);
      }
    };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const target = (e.target as Element | null)?.closest<HTMLElement>('[data-tip]');
      // Pasar del botón a su ícono no reinicia la espera.
      if (target && (target === current.current || target === pending.current)) return;
      if (!target) return hide();
      hide();
      pointerY.current = e.clientY;
      show(target, false);
    };
    const onOut = (e: PointerEvent) => {
      const to = (e.relatedTarget as Element | null)?.closest('[data-tip]');
      if (to && (to === current.current || to === pending.current)) return;
      const from = (e.target as Element | null)?.closest('[data-tip]');
      if (from && !to) hide();
    };
    // Una fila del árbol de páginas se recorre con las flechas: ahí el foco espera como el mouse, siempre.
    const isTreeRow = (el: EventTarget | null): el is HTMLElement =>
      el instanceof HTMLElement && el.classList.contains('tree-row');
    // Con el teclado: al llegar con Tab se muestra enseguida. En una fila del árbol, solo si uno se queda
    // quieto: recorriendo con las flechas no sale un globo en cada fila.
    const onFocus = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (!target.matches?.(':focus-visible')) return;
      const tip = target.closest<HTMLElement>('[data-tip]');
      if (!tip) return;
      pointerY.current = null;
      if (isTreeRow(target)) show(tip, false, false);
      else show(tip, true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return hide();
      // Una tecla en la fila del árbol (una flecha que despliega, por ejemplo) esconde el globo y la espera
      // vuelve a empezar.
      const target = e.target;
      if (isTreeRow(target) && (current.current === target || pending.current === target)) {
        hide();
        show(target, false, false);
      }
    };

    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', hide);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    window.addEventListener('blur', hide);
    return () => {
      clear();
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // Si el control desaparece (se cierra un menú, cambia la página) el tooltip se va con él; si cambia su
  // texto (el estado de sincronización), se actualiza.
  useEffect(() => {
    if (!shown) return;
    const check = setInterval(() => {
      const next = shown.target.isConnected ? tipOf(shown.target) : null;
      if (!next) setShown(null);
      else if (next.text !== shown.text) setShown({ ...next, y: shown.y });
    }, 250);
    return () => clearInterval(check);
  }, [shown]);

  return shown
    ? createPortal(<TooltipBubble target={shown.target} text={shown.text} plain={shown.plain} y={shown.y ?? null} />, document.body)
    : null;
}

/**
 * Dónde apunta el globo: el control, salvo que sea más alto que media ventana (el borde de la barra lateral ocupa todo
 * el alto): entonces un punto del control a la altura del mouse (o del medio de lo que se ve, con el teclado), y el
 * globo va al costado. Así nunca queda afuera de la pantalla (B.25b, auditoría de D226).
 */
export function tipAnchor(r: Rect, viewportHeight: number, y: number | null): { rect: Rect; sides: Side[] } {
  if (r.height <= viewportHeight / 2) return { rect: r, sides: ['below', 'above', 'right', 'left'] };
  const top = Math.max(r.top, 0);
  const bottom = Math.min(r.top + r.height, viewportHeight);
  const at = y !== null && y >= top && y <= bottom ? y : (top + bottom) / 2;
  return { rect: { left: r.left, width: r.width, top: at, height: 0 }, sides: ['right', 'left', 'below', 'above'] };
}

function TooltipBubble({ target, text, plain, y }: { target: HTMLElement; text: string; plain: boolean; y: number | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number; arrow: number; side: Side } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const b = el.getBoundingClientRect();
    // Abajo si entra; si no, arriba (la misma cuenta que los globitos de la recorrida, floating.ts).
    // Abajo si entra; si no, arriba; si tampoco, a un costado; y si nada entra, corrido para quedar adentro.
    const { rect, sides } = tipAnchor(target.getBoundingClientRect(), window.innerHeight, y);
    const place = placeNear(rect, b, { width: window.innerWidth, height: window.innerHeight }, { sides, gap: GAP, edge: EDGE });
    setPlace({ left: place.left, top: place.top, arrow: place.arrow, side: place.side });
  }, [target, text, y]);

  useEffect(() => {
    // No pisa una descripción que el control ya tenga.
    if (target.hasAttribute('aria-describedby')) return;
    target.setAttribute('aria-describedby', 'shotdocs-tooltip');
    return () => {
      if (target.getAttribute('aria-describedby') === 'shotdocs-tooltip') target.removeAttribute('aria-describedby');
    };
  }, [target]);

  return (
    <div
      ref={ref}
      id="shotdocs-tooltip"
      role="tooltip"
      className={`tooltip ${place?.side ?? 'below'}`}
      style={
        place
          ? { left: place.left, top: place.top, [place.side === 'below' || place.side === 'above' ? '--arrow-x' : '--arrow-y']: `${place.arrow}px` }
          : { left: -9999, top: -9999 }
      }
    >
      {plain ? text : renderTip(text)}
    </div>
  );
}

/** `**Drag**: resize\n**Double-click**: reset` → renglones con el gesto o el atajo en negrita. */
export function renderTip(text: string): ReactNode {
  return text.split('\n').map((line, i) => (
    <span key={i} className="tooltip-line">
      {line.split(/(\*\*[^*]+\*\*)/).map((part, j) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={j}>{part.slice(2, -2)}</strong>
        ) : (
          <Fragment key={j}>{part}</Fragment>
        ),
      )}
    </span>
  ));
}
