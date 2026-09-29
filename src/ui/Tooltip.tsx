import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Tooltips propios, con el mismo estilo que las apps LGA en Qt: fondo oscuro, borde fino, una flecha que
// apunta al control y se da vuelta si no entra, y la misma espera de 600 ms. Cualquier elemento con
// `data-tip` lo usa. Formato: `**negrita**` para los rótulos y un salto de línea por renglón.
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
    const show = (target: HTMLElement, immediate: boolean) => {
      if (!target.dataset.tip) return;
      clear();
      const open = () => {
        pending.current = null;
        const tip = target.isConnected ? tipOf(target) : null;
        if (!tip) return;
        current.current = target;
        setShown(tip);
      };
      if (immediate || Date.now() - lastHidden.current < WARM_MS) open();
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
      show(target, false);
    };
    const onOut = (e: PointerEvent) => {
      const to = (e.relatedTarget as Element | null)?.closest('[data-tip]');
      if (to && (to === current.current || to === pending.current)) return;
      const from = (e.target as Element | null)?.closest('[data-tip]');
      if (from && !to) hide();
    };
    // Con el teclado: al llegar con Tab se muestra enseguida.
    const onFocus = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (!target.matches?.(':focus-visible')) return;
      const tip = target.closest<HTMLElement>('[data-tip]');
      if (tip) show(tip, true);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide();

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
      else if (next.text !== shown.text) setShown(next);
    }, 250);
    return () => clearInterval(check);
  }, [shown]);

  return shown
    ? createPortal(<TooltipBubble target={shown.target} text={shown.text} plain={shown.plain} />, document.body)
    : null;
}

function TooltipBubble({ target, text, plain }: { target: HTMLElement; text: string; plain: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number; arrow: number; below: boolean } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const t = target.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    const below = t.bottom + GAP + b.height <= window.innerHeight - EDGE || t.top - GAP - b.height < EDGE;
    const center = t.left + t.width / 2;
    const left = Math.min(Math.max(EDGE, center - b.width / 2), window.innerWidth - EDGE - b.width);
    const top = below ? t.bottom + GAP : t.top - GAP - b.height;
    const arrow = Math.min(Math.max(14, center - left), b.width - 14);
    setPlace({ left, top, arrow, below });
  }, [target, text]);

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
      className={`tooltip ${place?.below === false ? 'above' : 'below'}`}
      style={
        place
          ? { left: place.left, top: place.top, ['--arrow-x' as string]: `${place.arrow}px` }
          : { left: -9999, top: -9999 }
      }
    >
      {plain ? text : renderTip(text)}
    </div>
  );
}

/** `**Drag:** resize\n**Double-click:** reset` → renglones con rótulos en negrita. */
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
