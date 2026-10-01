import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { t, useT } from '../i18n';
import '../i18n/lazy/tutorial';
import { navigate, PRACTICE_PATH, useRoute } from '../router';
import { useServices } from '../services';
import { isPhoneLayout } from '../ui/commentsUi';
import { placeNear, type Rect } from '../ui/floating';
import { setNavOpen } from '../ui/navStore';
import { notify } from '../ui/notice';
import { shortcutLabel } from '../ui/shortcuts';
import { stepsFor, type TourAnchor, type TourStep } from './steps';
import { continueTour, dismissTour, endTour, onTourSignal, practiceHooks, setTourStep, startTour, useTourUi } from './tourState';

// El motor de la recorrida (Docs/Doc_Tutorial.md, sección 4): propio, sin librerías. Un foco de luz (un solo `div`
// con una sombra enorme que oscurece el resto) que se desliza de un ancla a otra, y un globito con *Atrás*,
// *Siguiente* y *Saltar recorrida*. Espera a que aparezca lo que señala (hasta 3 s; si no, el globito va centrado y
// nunca se traba), no deja tocar lo señalado salvo en los pasos interactivos y se esconde si se abre un diálogo.
// Se baja aparte (TourHost.tsx lo monta solo cuando hace falta).

/** Cuánto se espera un ancla que todavía no está (una parte que se baja aparte, el editor, el cajón). */
const ANCHOR_WAIT_MS = 3000;
/** El aire entre el ancla y el borde del foco de luz. */
const PAD = 6;
/** Lo que, abierto, tapa la página: la recorrida se esconde hasta que se cierra. */
const MODAL = '[aria-modal="true"], .modal-backdrop, .carrete, dialog[open]';

export function TourLayer() {
  const ui = useTourUi();
  const route = useRoute();
  if (ui.mode === 'invite') return <InviteCard />;
  if (ui.mode === 'resume') return <ResumeCard step={ui.step} />;
  if (ui.mode !== 'running') return null;
  return <Running key={ui.nonce} step={ui.step} onPractice={route.name === 'practice'} />;
}

function Card({ text, sub, primary, onPrimary, secondary, onSecondary }: { text: string; sub?: string; primary: string; onPrimary: () => void; secondary: string; onSecondary: () => void }) {
  return createPortal(
    <div className="tour-card" role="dialog" aria-modal="false" aria-label={t('tour.label')}>
      <div className="tour-card-text">
        <strong>{text}</strong>
        {sub && <span className="mono-label">{sub}</span>}
      </div>
      <div className="tour-card-actions">
        <button className="link" onClick={onSecondary}>
          {secondary}
        </button>
        <button className="primary" onClick={onPrimary}>
          {primary}
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** "¿Primera vez? Recorrida de 2 minutos" (entró con un link: primero lo que abrió; decisión 2 de Lega). */
function InviteCard() {
  const tr = useT();
  return <Card text={tr('tour.invite')} primary={tr('tour.start')} onPrimary={() => startTour()} secondary={tr('tour.notNow')} onSecondary={dismissTour} />;
}

/** "¿Seguimos la recorrida? · Paso 4 de 10" (se recargó a mitad). */
function ResumeCard({ step }: { step: number }) {
  const tr = useT();
  const total = stepsFor(isPhoneLayout()).length;
  return (
    <Card
      text={tr('tour.resume')}
      sub={tr('tour.stepOf', { n: Math.min(step, total - 1) + 1, total })}
      primary={tr('tour.continue')}
      onPrimary={() => continueTour()}
      secondary={tr('tour.end')}
      onSecondary={endTour}
    />
  );
}

/** "Recorrida en pausa · Seguir" (la persona salió de la práctica a mitad). */
function PausedCard() {
  const tr = useT();
  return <Card text={tr('tour.paused')} primary={tr('tour.continue')} onPrimary={() => continueTour()} secondary={tr('tour.end')} onSecondary={endTour} />;
}

function Running({ step, onPractice }: { step: number; onPractice: boolean }) {
  // El diseño se elige al empezar: "3/10" no salta si cambia el ancho.
  const [phone] = useState(isPhoneLayout);
  const steps = useMemo(() => stepsFor(phone), [phone]);
  const index = Math.min(Math.max(0, step), steps.length - 1);
  const current = steps[index];
  const [entered, setEntered] = useState(onPractice);

  // Al empezar (o seguir), a la práctica; si después la persona se va a otra página, la recorrida queda en pausa.
  useEffect(() => {
    if (!onPractice) navigate(PRACTICE_PATH);
  }, []);
  useEffect(() => {
    if (onPractice) setEntered(true);
  }, [onPractice]);

  // Mientras dura, sin tooltips (styles.css); al terminar, el cajón del teléfono se cierra.
  useEffect(() => {
    document.documentElement.dataset.tourRunning = '1';
    return () => {
      delete document.documentElement.dataset.tourRunning;
    };
  }, []);

  if (!onPractice) return entered ? <PausedCard /> : null;
  return <StepView key={current.id} step={current} index={index} total={steps.length} phone={phone} />;
}

function go(index: number, total: number) {
  if (index >= total) {
    setNavOpen(false);
    endTour();
  } else setTourStep(Math.max(0, index));
}

function skip() {
  setNavOpen(false);
  endTour();
  notify(t('tour.replay'));
}

function StepView({ step, index, total, phone }: { step: TourStep; index: number; total: number; phone: boolean }) {
  const tr = useT();
  const { media } = useServices();
  const next = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const modal = useModalOpen();
  const rect = useAnchorRect(step.anchor, phone && !!step.drawer);
  const [size, setSize] = useState({ width: 320, height: 160 });

  // Lo de antes de cada paso: el cajón del teléfono, el cursor en el renglón vacío.
  useEffect(() => {
    if (phone) setNavOpen(!!step.drawer);
    if (step.interactive === 'slash') {
      practiceHooks.focusEmptyLine?.();
      return onTourSignal((s) => {
        if (s === 'slash') go(index + 1, total);
      });
    }
    // El foco va al globito, salvo que la persona esté escribiendo en la página (lo dejó el paso anterior).
    if (!document.activeElement?.closest('.bn-editor')) next.current?.focus({ preventScroll: true });
  }, [step, phone, index, total]);

  useLayoutEffect(() => {
    const el = bubble.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width !== size.width || r.height !== size.height) setSize({ width: r.width, height: r.height });
  });

  if (modal) return null;

  const textKey = phone && step.textPhone ? step.textPhone : step.textDrive && media.enabled ? step.textDrive : step.text;
  const params = Object.fromEntries(Object.entries(step.keys ?? {}).map(([name, id]) => [name, shortcutLabel(id, undefined, tr.lang)]));
  const title = tr(step.title);
  const last = index === total - 1;
  const interactive = !!step.interactive;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      skip();
    } else if (e.key === 'ArrowRight' || (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement))) {
      e.preventDefault();
      go(index + 1, total);
    } else if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      go(index - 1, total);
    }
  };

  // El globito: en el teléfono, una hoja abajo de todo el ancho; en la computadora, al lado del ancla.
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const spot = rect ? { left: rect.left - PAD, top: rect.top - PAD, width: rect.width + 2 * PAD, height: rect.height + 2 * PAD } : null;
  let bubbleStyle: CSSProperties;
  // En el teléfono, la hoja va abajo; si taparía lo señalado (el "?" del pie del cajón), arriba.
  const sheetOnTop = phone && !!spot && spot.top + spot.height > viewport.height - keyboardInset() - size.height - 12;
  if (phone) bubbleStyle = sheetOnTop ? { left: 0, right: 0, top: 0 } : { left: 0, right: 0, bottom: keyboardInset() };
  else if (spot) {
    const place = placeNear(spot, size, viewport, { sides: step.sides ?? ['below', 'above', 'right', 'left'], gap: 14, edge: 12 });
    bubbleStyle = { left: place.left, top: place.top };
  } else bubbleStyle = { left: (viewport.width - size.width) / 2, top: (viewport.height - size.height) / 2 };

  return createPortal(
    <>
      {/* Lo que no se puede tocar mientras tanto (un clic en el "+" de verdad crearía una página real). */}
      {!interactive && <div className="tour-blocker" aria-hidden="true" />}
      {spot ? (
        <div
          className={`tour-spot${interactive ? ' interactive' : ''}`}
          aria-hidden="true"
          style={{ left: spot.left, top: spot.top, width: spot.width, height: spot.height }}
        />
      ) : (
        <div className="tour-dim" aria-hidden="true" />
      )}
      <div
        ref={bubble}
        className={`tour-bubble${phone ? ' sheet' : ''}${sheetOnTop ? ' top' : ''}`}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        aria-describedby="tour-text"
        style={bubbleStyle}
        onKeyDown={onKeyDown}
      >
        <div className="tour-head">
          <span className="mono-label">
            {index + 1}/{total}
          </span>
          <button className="link tour-skip" onClick={skip}>
            {tr('tour.skip')}
          </button>
        </div>
        <h3 id="tour-title">{title}</h3>
        <p id="tour-text">{tr(textKey, params)}</p>
        <div className="tour-actions">
          {index > 0 && (
            <button className="secondary" onClick={() => go(index - 1, total)}>
              {tr('tour.back')}
            </button>
          )}
          <button ref={next} className="primary" onClick={() => go(index + 1, total)}>
            {last ? tr('tour.finish') : tr('tour.next')}
          </button>
        </div>
      </div>
      <div className="tour-live" aria-live="polite">
        {tr('tour.live', { n: index + 1, total, title })}
      </div>
    </>,
    document.body,
  );
}

/** En el teléfono, lo que tapa el teclado (la hoja va arriba de él). */
function keyboardInset(): number {
  const vv = window.visualViewport;
  if (!vv) return 0;
  return Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
}

/** Algo modal abierto (un diálogo, el carrete, la búsqueda): la recorrida se esconde hasta que se cierra. */
function useModalOpen(): boolean {
  const [open, setOpen] = useState(() => !!document.querySelector(MODAL));
  useEffect(() => {
    const check = () => setOpen(!!document.querySelector(MODAL));
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return open;
}

/** Los elementos del ancla que se ven (en el teléfono, el cajón cerrado queda fuera de la pantalla). */
function anchorElements(anchor: TourAnchor): HTMLElement[] {
  const found =
    'tour' in anchor
      ? [...document.querySelectorAll<HTMLElement>(`[data-tour="${anchor.tour}"]`)]
      : anchor.blocks.flatMap((id) => {
          const el = document.querySelector<HTMLElement>(`.bn-editor [data-id="${id}"]`);
          return el ? [el] : [];
        });
  const visible = found.filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.right > 0 && r.left < window.innerWidth;
  });
  return 'tour' in anchor ? visible.slice(0, 1) : visible;
}

function union(els: HTMLElement[]): Rect | null {
  if (els.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    x0 = Math.min(x0, r.left);
    y0 = Math.min(y0, r.top);
    x1 = Math.max(x1, r.right);
    y1 = Math.max(y1, r.bottom);
  }
  return { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * Dónde está el ancla, siguiéndola (desplazar, cambiar el tamaño, el cajón que se abre). Espera hasta 3 s a que
 * aparezca; si no aparece, o desaparece a mitad, `null` (el globito va centrado).
 */
function useAnchorRect(anchor: TourAnchor | null, inDrawer: boolean): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  useEffect(() => {
    if (!anchor) {
      setRect(null);
      return;
    }
    let frame = 0;
    let scrolled = false;
    const measure = () => {
      frame = 0;
      const els = anchorElements(anchor);
      if (els.length > 0 && !scrolled) {
        scrolled = true;
        // El cajón del teléfono se desliza: lo de adentro no se desplaza.
        if (!inDrawer) els[0].scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
      }
      const next = union(els);
      setRect((old) => (same(old, next) ? old : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'data-id'] });
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    resize?.observe(document.body);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    // Mientras se espera el ancla (y lo que dura la animación del cajón), se vuelve a medir cada tanto.
    const settle = setInterval(schedule, 250);
    const timer = setTimeout(() => clearInterval(settle), ANCHOR_WAIT_MS);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      resize?.disconnect();
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      clearInterval(settle);
      clearTimeout(timer);
    };
  }, [anchor, inDrawer]);
  return rect;
}

function same(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
