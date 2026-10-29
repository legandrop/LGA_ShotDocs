import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t, useT, type Key, type Translate } from '../i18n';
import '../i18n/lazy/tutorial';
import './tour.css';
import { navigate, PRACTICE_PATH, useRoute } from '../router';
import { useServices } from '../services';
import { isPhoneLayout } from '../ui/commentsUi';
import { placeNear, type Rect } from '../ui/floating';
import { CloseIcon } from '../ui/icons';
import { revealRow } from '../ui/treeNav';
import { setNavOpen } from '../ui/navStore';
import { notify } from '../ui/notice';
import { shortcutLabel } from '../ui/shortcuts';
import { chapterById, tourById, type ChapterDef, type Text, type TourDef } from '../tour/catalog';
import { chapterAfter, chapterNumber, ensureNeeds, met, nextOf, placeOf, prevOf, type Place, type Target } from '../tour/engine';
import { clearCursor, markSeen, setCursor } from '../tour/progress';
import { practiceWorld } from '../tour/world';
import { ShowMeBack } from './ShowMeBack';
import { TOUR_STEPS, type TourAnchor, type TourStep } from './steps';
import {
  continueTour,
  dismissTour,
  endShowStep,
  endTour,
  inTourDocument,
  leaveTourDocument,
  onTourSignal,
  practiceHooks,
  setTourAt,
  startTour,
  TOUR_ANCHOR_EVENT,
  useTourUi,
  type TourUi,
} from './tourState';

// El motor de los recorridos (Docs/Doc_Tutorial.md, sección 4; Docs/Plan_Proyecto_Desde_Cero.md, sección 6): propio,
// sin librerías. Un foco de luz (un solo `div` con una sombra enorme que oscurece el resto, 27 %) con un aro verde que
// pulsa, y un globito con el capítulo y el paso, *Back*, *Next*, *Skip chapter* y ×. Los pasos salen del catálogo
// (src/tour/catalog.ts), por id:
// - `info`: explica; la app queda tapada (un clic afuera hace pulsar el globito) y *Next* sigue.
// - `do`: la persona hace la acción de verdad en la app, que queda a mano y sin oscurecer. Cuando la condición del paso
//   se cumple, el globito dice «Done» medio segundo y avanza solo. *Next* queda gris: nunca hace la acción.
// - `card`: tarjeta centrada.
// *Back* no deshace: si el paso de antes ya está cumplido, dice «Already done» y no avanza solo. Esc dos veces sale (el
// primero pregunta en el globito, con *Keep going*). El globito nunca le roba el foco a la app: las teclas (→, Enter, ←,
// Esc) se escuchan en la ventana. Espera a que aparezca lo que señala (hasta 3 s; si no, va centrado y nunca se traba).
// Antes de un capítulo deja listo lo que necesita (`needs`). Se baja aparte (TourHost.tsx lo monta solo cuando hace
// falta; el documento de práctica, siempre).

/** Cuánto se espera un ancla que todavía no está (una parte que se baja aparte, el editor, el cajón). */
const ANCHOR_WAIT_MS = 3000;
/** El aire entre el ancla y el borde del foco de luz. */
const PAD = 6;
/** Cuánto se ve «Done» antes de pasar solo al paso que sigue. */
const DONE_MS = 500;
/** Cada cuánto se mira si un paso de acción se cumplió (solo lee memoria). */
const POLL_MS = 200;
/** Lo que, abierto, tapa la página: la recorrida se esconde hasta que se cierra. */
const MODAL = '[aria-modal="true"], .modal-backdrop, .carrete, dialog[open]';

export function TourLayer() {
  const ui = useTourUi();
  const route = useRoute();
  if (ui.mode === 'invite') return <InviteCard />;
  if (ui.mode === 'resume') return <ResumeCard ui={ui} />;
  if (ui.mode !== 'running') return null;
  if (ui.only) return <ShowMe key={ui.nonce} id={ui.only.id} onPractice={route.name === 'practice'} />;
  const tour = tourById(ui.tour);
  if (!tour) return <Unknown />;
  return <Running key={ui.nonce} ui={ui} tour={tour} onPractice={route.name === 'practice'} />;
}

/** Un recorrido que ya no está en el catálogo (una ayuda vieja en otra pestaña): no se traba nada. */
function Unknown() {
  useEffect(() => dismissTour(), []);
  return null;
}

/** Un texto del catálogo (clave del diccionario o `{ en, es }`) con sus `{valores}` y `**negritas**`. */
function textOf(tr: Translate, text: Text, params: Record<string, string> = {}): string {
  if (typeof text === 'string') return tr(text as Key, params);
  return text[tr.lang].replace(/\{(\w+)\}/g, (all, name: string) => params[name] ?? all);
}

function rich(text: string): ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.length === 1 ? text : parts.map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part));
}

/**
 * "Mostrame" (entrega 3): un solo paso en la práctica, el que pidió una entrada de la ayuda. Vale en los dos diseños
 * (en el teléfono también el de Buscar, que la recorrida entera saltea). Si la persona se va de la práctica, se
 * termina sin más (no queda en pausa: no es la recorrida).
 */
function ShowMe({ id, onPractice }: { id: string; onPractice: boolean }) {
  const [phone] = useState(isPhoneLayout);
  const step = TOUR_STEPS.find((s) => s.id === id);
  const [entered, setEntered] = useState(onPractice);
  useEffect(() => {
    if (onPractice) setEntered(true);
    else if (entered) endShowStep({ goBack: false });
  }, [onPractice]);
  // Esc termina "Mostrame" también con el foco afuera del globito (un clic en la página, el renglón del paso del menú
  // "/"), salvo que sea de otro (`escTakenElsewhere`) o que algo ya lo haya usado (la barra de buscar). En el editor,
  // Esc no es de nadie más (BlockNote lo usa para soltar el foco).
  useEffect(() => {
    let skip = false;
    const before = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') skip = escTakenElsewhere(e.target);
    };
    const after = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || skip) return;
      const inEditor = e.target instanceof Element && !!e.target.closest('.bn-editor');
      if (e.defaultPrevented && !inEditor) return;
      finishShowMe();
    };
    window.addEventListener('keydown', before, true);
    window.addEventListener('keydown', after);
    return () => {
      window.removeEventListener('keydown', before, true);
      window.removeEventListener('keydown', after);
    };
  }, []);
  useEffect(() => {
    // Un paso que ya no existe (una ayuda vieja en otra pestaña): no se traba nada.
    if (!step) endShowStep();
  }, [step]);
  if (!step || !onPractice) return null;
  return <StepView step={step} phone={phone} />;
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

/** "¿Seguimos la recorrida? · Cap. 2 · Escribir en una página" (se recargó a mitad). */
function ResumeCard({ ui }: { ui: TourUi }) {
  const tr = useT();
  const tour = tourById(ui.tour);
  const chapter = chapterById(ui.chapter);
  const sub = tour && chapter ? tr('tour.resumeAt', { ch: chapterNumber(tour, chapter.id).n, title: chapter.title[tr.lang] }) : undefined;
  return <Card text={tr('tour.resume')} sub={sub} primary={tr('tour.continue')} onPrimary={() => continueTour()} secondary={tr('tour.end')} onSecondary={endTour} />;
}

/** "Recorrida en pausa · Seguir" (la persona salió de la práctica a mitad). */
function PausedCard() {
  const tr = useT();
  return <Card text={tr('tour.paused')} primary={tr('tour.continue')} onPrimary={() => continueTour()} secondary={tr('tour.end')} onSecondary={endTour} />;
}

/** Un recorrido en marcha: dónde está (por id), los requisitos del capítulo y, en la app, la práctica a la vista. */
function Running({ ui, tour, onPractice }: { ui: TourUi; tour: TourDef; onPractice: boolean }) {
  // El diseño se elige al empezar: la cuenta de pasos no salta si cambia el ancho.
  const [phone] = useState(isPhoneLayout);
  const place = useMemo(() => placeOf(tour, ui.chapter, ui.step, phone), [tour, ui.chapter, ui.step, phone]);
  const inApp = tour.where === 'app';
  const [entered, setEntered] = useState(onPractice);
  const prep = usePrepared(place?.chapter ?? null);

  // Un recorrido de la app va a la práctica; si después la persona se va a otra página, queda en pausa.
  useEffect(() => {
    if (inApp && !onPractice) navigate(PRACTICE_PATH);
  }, []);
  useEffect(() => {
    if (onPractice) setEntered(true);
  }, [onPractice]);
  // Lo que se ve queda guardado por id (un id vacío o que ya no existe se resuelve al primero).
  useEffect(() => {
    if (!place) {
      dismissTour();
      return;
    }
    const step = place.steps[place.index].id;
    if (place.chapter.id !== ui.chapter || step !== ui.step) setTourAt(place.chapter.id, step, ui.via);
    else setCursor(tour.id, { chapter: ui.chapter, step });
  }, [place]);

  if (!place) return null;
  if (inApp && !onPractice) return entered ? <PausedCard /> : null;
  if (prep.state !== 'ready') return <Preparing failed={prep.state === 'failed' ? prep.error : null} retry={prep.retry} onExit={() => exitTour(tour)} phone={phone} />;
  const step = place.steps[place.index];
  return <StepView key={step.id} step={step} phone={phone} nav={{ tour, place, via: ui.via }} />;
}

/** Los requisitos del capítulo (`needs`): listos, preparándose, o qué falló. */
function usePrepared(chapter: ChapterDef | null): { state: 'ready' | 'preparing' | 'failed'; error: string; retry: () => void } {
  const [done, setDone] = useState<{ id: string; error: string | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const id = chapter?.id ?? '';
  const needsSome = !!chapter?.needs?.length;
  useEffect(() => {
    if (!chapter || !needsSome) return;
    let live = true;
    setDone(null);
    ensureNeeds(chapter).then(
      () => live && setDone({ id, error: null }),
      (e: unknown) => live && setDone({ id, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [id, attempt]);
  const retry = () => setAttempt((n) => n + 1);
  if (!needsSome) return { state: 'ready', error: '', retry };
  if (done?.id !== id) return { state: 'preparing', error: '', retry };
  return done.error === null ? { state: 'ready', error: '', retry } : { state: 'failed', error: done.error, retry };
}

/** Mientras se prepara un capítulo, la capa tapa todo; si falla, el porqué con *Try again* y salir. */
function Preparing({ failed, retry, onExit, phone }: { failed: string | null; retry: () => void; onExit: () => void; phone: boolean }) {
  const tr = useT();
  return createPortal(
    <>
      <div className="tour-blocker" aria-hidden="true" />
      <div className="tour-dim" aria-hidden="true" />
      <div className={`tour-bubble tour-center${failed ? '' : ' tour-wait'}${phone ? ' sheet' : ''}`} role="dialog" aria-modal="false" aria-live="polite">
        <p>{failed ? tr('tour.prepFailed', { error: failed }) : tr('tour.preparing')}</p>
        {failed && (
          <div className="tour-actions">
            <button className="secondary" onClick={onExit}>
              {tr('tour.exit')}
            </button>
            <button className="primary" onClick={retry}>
              {tr('tour.tryAgain')}
            </button>
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}

// --- Moverse por el recorrido ----------------------------------------------------------------------------

/** Ir al paso `to` (o terminar): el capítulo que se deja atrás queda visto. */
function advance(tour: TourDef, place: Place, to: Target | 'end') {
  if (to === 'end' || to.chapter !== place.chapter.id) markSeen(tour.id, place.chapter.id, place.chapter.version);
  if (to === 'end') finishTour(tour);
  else setTourAt(to.chapter, to.step);
}

/** *Skip chapter*: al primer paso del capítulo que sigue, sin darlo por visto (sus requisitos se preparan solos). */
function skipChapter(tour: TourDef, place: Place, phone: boolean) {
  const to = chapterAfter(tour, place.chapter.id, phone);
  if (to === 'end') finishTour(tour);
  else setTourAt(to.chapter, to.step);
}

/** Terminó: no queda nada para seguir. En el documento de práctica, se vuelve a donde estaba la persona. */
function finishTour(tour: TourDef) {
  clearCursor(tour.id);
  setNavOpen(false);
  if (tour.where === 'app') endTour();
  else leaveDocument();
}

/** Salir a mitad (Esc dos veces, ×): lo de dónde quedó se guarda para *Continue* en la ayuda. */
function exitTour(tour: TourDef) {
  setNavOpen(false);
  if (tour.where === 'doc') {
    leaveDocument();
    return;
  }
  endTour();
  notify(t('tour.replay'));
}

function leaveDocument() {
  if (inTourDocument()) leaveTourDocument();
  else dismissTour();
}

/**
 * Un Esc que es de otro, mirado antes de que nadie lo atienda (varios cierran sin `preventDefault`): el menú "/" de la
 * práctica abierto, un diálogo o el carrete, un menú flotante (`.menu` de `useFloating`, que cierra con cualquier Esc:
 * el ⋯ de la página, el selector de proyectos, la cuenta), una lista o un menú con el foco adentro, o el panel de
 * comentarios con el foco adentro (en el teléfono, abierto: cierra con cualquier Esc).
 */
function escTakenElsewhere(target: EventTarget | null): boolean {
  if (practiceHooks.slashMenuOpen?.() || document.querySelector(MODAL) || document.querySelector('.menu')) return true;
  const focus = document.activeElement;
  const inside = (sel: string) => [target, focus].some((el) => el instanceof Element && !!el.closest(sel));
  if (inside('[role="menu"], [role="listbox"], .comments-panel')) return true;
  return isPhoneLayout() && !!document.querySelector('.comments-panel');
}

/** Donde se escribe (o un botón, que hace lo suyo con Enter): las flechas y Enter no son de la recorrida. */
function typingIn(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('input, textarea, select, button, [contenteditable="true"]');
}

/** Termina "Mostrame": el cajón del teléfono se cierra y se vuelve a donde estaba la persona. */
function finishShowMe() {
  setNavOpen(false);
  endShowStep();
}

interface Nav {
  tour: TourDef;
  place: Place;
  via?: 'back';
}

/** Un paso a la vista. Sin `nav`, es «Show me» (un solo paso, *Done* y vuelta). */
function StepView({ step, phone, nav }: { step: TourStep; phone: boolean; nav?: Nav }) {
  const tr = useT();
  const { media } = useServices();
  const single = !nav;
  const bubble = useRef<HTMLDivElement>(null);
  const modal = useModalOpen();
  const rect = useAnchorRect(step.anchor, phone && !!step.drawer);
  const [size, setSize] = useState({ width: 320, height: 160 });
  // En el teléfono, la altura de la hoja cuando va abajo, la que decide si tapa lo señalado. Arriba mide otra cosa
  // (otro relleno, el notch): decidir con la medida de la hoja donde está la hacía saltar de abajo a arriba sin parar
  // cuando lo señalado quedaba justo en el borde (pasaba en inglés, en el paso del menú "/").
  const sheetBelow = useRef<{ step: string; height: number } | null>(null);
  // Un paso de acción deja la app a mano (sin bloquear ni oscurecer); los demás la tapan.
  const acting = step.mode === 'do';
  const [, redraw] = useState(0);
  const [phase, setPhase] = useState<'todo' | 'done' | 'already'>(() =>
    nav && acting && nav.via === 'back' && step.until && met(step.until) ? 'already' : 'todo',
  );
  const [confirm, setConfirm] = useState(false);
  const [nudge, setNudge] = useState(0);
  const card = step.mode === 'card';
  const to = nav ? nextOf(nav.tour, nav.place, phone) : 'end';
  const from = nav ? prevOf(nav.tour, nav.place, phone) : null;
  const canNext = !acting || phase === 'already';

  // Lo de ahora, para las teclas (se escuchan en la ventana una sola vez por paso).
  const now = useRef({ canNext, to, from, confirm });
  now.current = { canNext, to, from, confirm };

  // Mientras se ve un paso, sin tooltips (styles.css); en pausa vuelven.
  useEffect(() => {
    document.documentElement.dataset.tourRunning = '1';
    return () => {
      delete document.documentElement.dataset.tourRunning;
    };
  }, []);

  // En un paso que no se toca, la app tampoco se alcanza con el teclado (Tab hasta el "+" crearía una página real):
  // `inert` en la app; el globito va aparte, en `body`.
  useEffect(() => {
    if (acting) return;
    const shell = document.querySelector('.shell');
    shell?.setAttribute('inert', '');
    return () => shell?.removeAttribute('inert');
  }, [acting]);

  // El teclado del teléfono cambia lo que se ve sin un `resize` de la ventana: la hoja se vuelve a ubicar.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onChange = () => redraw((n) => n + 1);
    vv.addEventListener('resize', onChange);
    vv.addEventListener('scroll', onChange);
    return () => {
      vv.removeEventListener('resize', onChange);
      vv.removeEventListener('scroll', onChange);
    };
  }, []);

  // Lo de antes de cada paso: el cajón del teléfono, el cursor en el renglón vacío, y que se vea lo que señala (*Pages*
  // plegada se despliega: `TOUR_ANCHOR_EVENT`, lo escucha la barra lateral).
  useEffect(() => {
    const anchor = step.anchor;
    if (anchor && ('tour' in anchor || 'page' in anchor)) window.dispatchEvent(new CustomEvent(TOUR_ANCHOR_EVENT, { detail: 'tour' in anchor ? anchor.tour : 'pages' }));
    // En el cuadro siguiente: al seguir desde otra página, el Shell cierra el cajón al cambiar de dirección (en el
    // mismo dibujo, después de este efecto).
    const frame = phone ? requestAnimationFrame(() => setNavOpen(!!step.drawer)) : 0;
    if (step.interactive !== 'slash') return () => cancelAnimationFrame(frame);
    // El editor de la práctica puede no estar todavía ("Mostrame" o retomar justo en este paso): se espera hasta 3 s.
    let tries = 0;
    let wait = 0;
    const focusLine = () => {
      if (practiceHooks.focusEmptyLine) practiceHooks.focusEmptyLine();
      else if (tries++ < ANCHOR_WAIT_MS / 100) wait = window.setTimeout(focusLine, 100);
    };
    focusLine();
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(wait);
    };
  }, [step, phone]);

  // Un paso de acción: se mira si se cumplió (al usar el menú "/", enseguida; lo demás, cada `POLL_MS`). En «Show me»
  // no: el paso queda a la vista para ver lo que pasó, y termina con *Done*.
  useEffect(() => {
    if (!nav || !acting || phase !== 'todo' || !step.until) return;
    const until = step.until;
    const tick = () => {
      if (met(until)) setPhase('done');
    };
    tick();
    const timer = setInterval(tick, POLL_MS);
    const off = onTourSignal(tick);
    return () => {
      clearInterval(timer);
      off();
    };
  }, [phase, step]);
  // Cumplido: «Done» medio segundo y al paso que sigue.
  useEffect(() => {
    if (phase !== 'done' || !nav) return;
    const timer = setTimeout(() => advance(nav.tour, nav.place, nextOf(nav.tour, nav.place, phone)), DONE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  // Las teclas, en la ventana (el globito no se lleva el foco): → y Enter siguen (si *Next* está prendido), ← vuelve, y
  // Esc pregunta y, la segunda vez, sale. Un Esc de otro (un menú, un diálogo) no cuenta.
  useEffect(() => {
    let taken = false;
    const before = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') taken = escTakenElsewhere(e.target);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      const { canNext, to, from, confirm } = now.current;
      if (e.key === 'Escape') {
        // En «Show me», Esc lo atiende `ShowMe` (también con el foco en el renglón del menú "/").
        const inEditor = e.target instanceof Element && !!e.target.closest('.bn-editor');
        if (single || taken || (e.defaultPrevented && !inEditor)) return;
        e.preventDefault();
        if (confirm) exitTour(nav!.tour);
        else setConfirm(true);
        return;
      }
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || typingIn(e.target) || confirm) return;
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (single) finishShowMe();
        else if (canNext) advance(nav!.tour, nav!.place, to);
        else return;
        e.preventDefault();
      } else if (e.key === 'ArrowLeft' && from) {
        e.preventDefault();
        setTourAt(from.chapter, from.step, 'back');
      }
    };
    window.addEventListener('keydown', before, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', before, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [step]);

  useLayoutEffect(() => {
    const el = bubble.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (phone && !el.classList.contains('top')) sheetBelow.current = { step: step.id, height: r.height };
    if (r.width !== size.width || r.height !== size.height) setSize({ width: r.width, height: r.height });
  });

  if (modal) return null;

  const textKey = phone && step.textPhone ? step.textPhone : step.textDrive && media.enabled ? step.textDrive : step.text;
  const params = Object.fromEntries(Object.entries(step.keys ?? {}).map(([name, id]) => [name, shortcutLabel(id, undefined, tr.lang)]));
  const title = textOf(tr, step.title);
  const where = nav ? whereLabel(tr, nav) : null;

  // El globito: en el teléfono, una hoja abajo de todo el ancho; en la computadora, al lado del ancla (una tarjeta, al
  // centro).
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const spot = rect && !card ? { left: rect.left - PAD, top: rect.top - PAD, width: rect.width + 2 * PAD, height: rect.height + 2 * PAD } : null;
  let bubbleStyle: CSSProperties;
  // En el teléfono, la hoja va abajo; si taparía lo señalado (el "?" del pie del cajón), arriba.
  const belowHeight = sheetBelow.current?.step === step.id ? sheetBelow.current.height : size.height;
  const sheetOnTop = phone && !!spot && spot.top + spot.height > viewport.height - keyboardInset() - belowHeight - 12;
  if (phone) bubbleStyle = sheetOnTop ? { left: 0, right: 0, top: 0 } : { left: 0, right: 0, bottom: keyboardInset() };
  else if (spot) {
    const place = placeNear(spot, size, viewport, { sides: step.sides ?? ['below', 'above', 'right', 'left'], gap: 14, edge: 12 });
    bubbleStyle = { left: place.left, top: place.top };
  } else bubbleStyle = { left: (viewport.width - size.width) / 2, top: (viewport.height - size.height) / 2 };

  const back = () => from && setTourAt(from.chapter, from.step, 'back');
  const next = () => nav && advance(nav.tour, nav.place, to);
  // Un clic en lo tapado: el globito pulsa (dónde seguir).
  const poke = () => setNudge((n) => n + 1);

  return createPortal(
    <>
      {/* Lo que no se puede tocar mientras tanto (un clic en el "+" de verdad crearía una página real). */}
      {!acting && <div className="tour-blocker" aria-hidden="true" onClick={poke} />}
      {spot ? (
        <div className={`tour-spot${acting ? ' interactive' : ''}`} aria-hidden="true" style={{ left: spot.left, top: spot.top, width: spot.width, height: spot.height }} />
      ) : (
        !acting && <div className="tour-dim" aria-hidden="true" />
      )}
      <div
        ref={bubble}
        key={nudge ? `n${nudge}` : 'b'}
        className={`tour-bubble${card ? ' tour-card-step' : ''}${phone ? ' sheet' : ''}${sheetOnTop ? ' top' : ''}${nudge ? ' nudge' : ''}${phase === 'done' ? ' is-done' : ''}`}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        aria-describedby="tour-text"
        style={bubbleStyle}
        // El globito no se lleva el foco: un clic en sus botones deja el foco donde estaba (en la app, en un paso de acción).
        onMouseDown={(e) => e.preventDefault()}
      >
        <div className="tour-head">
          <span className="mono-label">{single ? tr('tour.showMe') : where}</span>
          {nav && (
            <span className="tour-head-actions">
              <button className="link tour-skip" onClick={() => skipChapter(nav.tour, nav.place, phone)}>
                {tr('tour.skipChapter')}
              </button>
              <button className="icon-button tour-close" aria-label={tr('tour.exit')} onClick={() => setConfirm(true)}>
                <CloseIcon size={16} />
              </button>
            </span>
          )}
        </div>
        <h3 id="tour-title">{title}</h3>
        {confirm ? (
          <>
            <p id="tour-text">{tr('tour.exitAsk')}</p>
            <div className="tour-actions">
              <button className="secondary" onClick={() => exitTour(nav!.tour)}>
                {tr('tour.exit')}
              </button>
              <button className="primary" onClick={() => setConfirm(false)}>
                {tr('tour.keepGoing')}
              </button>
            </div>
          </>
        ) : (
          <>
            <p id="tour-text">{rich(textOf(tr, textKey, params))}</p>
            {acting && step.turn && phase === 'todo' && (
              <p className="tour-turn">
                <span className="tour-turn-label">{tr('tour.doThis')}</span> {rich(textOf(tr, step.turn, params))}
              </p>
            )}
            {phase !== 'todo' && <p className={`tour-status${phase === 'done' ? ' done' : ''}`}>✓ {phase === 'done' ? tr('tour.done') : tr('tour.alreadyDone')}</p>}
            <div className="tour-actions">
              {from && (
                <button className="secondary" onClick={back}>
                  {tr('tour.back')}
                </button>
              )}
              {single ? (
                <button className="primary" onClick={finishShowMe}>
                  {tr('tour.done')}
                </button>
              ) : (
                <button className="primary" onClick={next} disabled={!canNext}>
                  {to === 'end' ? tr('tour.finish') : tr('tour.next')}
                </button>
              )}
            </div>
          </>
        )}
      </div>
      {/* «Show me»: el ‹ de la barra queda tapado por el bloqueador; una copia encima, si ahí se vería (ShowMeBack.tsx). */}
      {single && <ShowMeBack bubble={bubble} />}
      <div className="tour-live" aria-live="polite">
        {single ? tr('tour.liveShowMe', { title }) : `${where}: ${title}${phase === 'done' ? ` · ${tr('tour.done')}` : ''}`}
      </div>
    </>,
    document.body,
  );
}

/** «Cap. 1/9 · Paso 2/7». */
function whereLabel(tr: Translate, nav: Nav): string {
  const { n, total } = chapterNumber(nav.tour, nav.place.chapter.id);
  return tr('tour.where', { ch: n, chapters: total, n: nav.place.index + 1, total: nav.place.steps.length });
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
    // Lo que se veía al dibujar puede haberse ido en el mismo cambio (la ayuda se cierra y abre "Mostrame").
    check();
    return () => observer.disconnect();
  }, []);
  return open;
}

/** Los elementos del ancla que se ven (en el teléfono, el cajón cerrado queda fuera de la pantalla). */
function anchorElements(anchor: TourAnchor): HTMLElement[] {
  let found: HTMLElement[];
  if ('tour' in anchor) found = [...document.querySelectorAll<HTMLElement>(`[data-tour="${anchor.tour}"]`)];
  else if ('page' in anchor) {
    // Las filas del árbol de las carpetas de esas etapas, en el proyecto de práctica.
    const stages = practiceWorld()?.stages;
    found = stages ? anchor.page.flatMap((s) => [...document.querySelectorAll<HTMLElement>(`.tree-row[data-page="${stages[s]}"]`)]) : [];
  } else if ('fields' in anchor) {
    // La primera tabla de la página abierta (la ficha de la plantilla).
    const block = document.querySelector<HTMLElement>('.page .bn-editor [data-content-type="table"]');
    // La tabla misma (el bloque ocupa todo el ancho de la página).
    const table = block?.querySelector<HTMLElement>('table') ?? block;
    found = table ? [table] : [];
  } else
    found = anchor.blocks.flatMap((id) => {
      const el = document.querySelector<HTMLElement>(`.bn-editor [data-id="${id}"]`);
      return el ? [el] : [];
    });
  const visible = found.filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.right > 0 && r.left < window.innerWidth;
  });
  return visible;
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
        // El cajón del teléfono se desliza: `scrollIntoView` movería también la página. Adentro del cajón solo se desplaza
        // el árbol (`.sidebar-scroll`, donde está *All synced* desde D802), y ahí se lleva lo señalado a la vista.
        // Un ancla más alta que la ventana (el Overview entero) va con su principio arriba: centrada, lo primero (la fila 001)
        // quedaba fuera de la vista justo cuando el paso pide tocarlo.
        const tall = els[0].getBoundingClientRect().height > window.innerHeight * 0.8;
        if (!inDrawer) els[0].scrollIntoView({ block: tall ? 'start' : 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
        else {
          const tree = els[0].closest<HTMLElement>('.sidebar-scroll');
          if (tree) revealRow(els[0], tree);
        }
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
