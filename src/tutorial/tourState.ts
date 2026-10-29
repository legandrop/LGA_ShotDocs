import { useEffect, useSyncExternalStore } from 'react';
import { helpSeen, useHelpUi } from '../help/helpUi';
import { checkHelpNews, useHelpNews } from '../help/news';
import { PRACTICE_PATH } from '../router';
import { overlayState } from '../navHistory';
import { cursorOf, setCursor } from '../tour/progress';
import { leaveTourDoc, tourDocHref } from '../tour/reload';

/** El paso del tour que señala un ancla (`data-tour`): quien la esconde (*Pages* plegada, en la barra) la muestra. */
export const TOUR_ANCHOR_EVENT = 'shotdocs:tour-anchor';
import { capturePlace, restorePlace, type ShowMePlace } from './showMePlace';

// El estado de los recorridos (Docs/Doc_Tutorial.md, sección 4, y Docs/Plan_Proyecto_Desde_Cero.md, sección 6). Va en
// la primera carga y es chico: decidir si arranca la recorrida de la app, el punto del "?", qué recorrido corre y en qué
// capítulo y paso (por id, nunca por posición), y las señales de la práctica. El motor (TourLayer.tsx), el catálogo
// (src/tour/catalog.ts) y sus textos se bajan aparte, solo cuando hacen falta.
//
// - En el dispositivo (`localStorage`, una clave para todos los workspaces: es lo que la persona sabe de la app):
//   `{ v, done, account }` de la recorrida de la app (*Getting around*: si ya se vio, para no arrancarla sola), y el
//   progreso de todos los recorridos (src/tour/progress.ts: capítulos vistos y dónde quedó cada uno).
// - En la cuenta (por workspace): `shotdocs_tour: 1` en los metadatos del usuario de Supabase Auth (corrección 12;
//   nunca en `user_settings.prefs`). Lo escribe `TourHost` con el cliente del workspace.

export const TOUR_VERSION = 1;
const KEY = 'shotdocs-tour';
/** La marca en los metadatos del usuario de Supabase Auth. */
export const ACCOUNT_MARK = 'shotdocs_tour';
/** La recorrida de la app (corre en `/practice`): la que arranca sola la primera vez. */
export const GETTING_AROUND = 'getting-around';
/** Los recorridos que corren en el documento de práctica aparte (tour.html, src/tour/practiceDoc.tsx). */
const DOC_TOURS = new Set(['scratch']);

export interface DeviceTour {
  v: number;
  done: boolean;
  /** `false`: terminada en este dispositivo pero todavía sin anotar en la cuenta. */
  account?: boolean;
}

export function readDeviceTour(): DeviceTour {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<DeviceTour> | null;
    // Una versión nueva de la recorrida (cambió mucho) cuenta como no vista.
    if (raw && raw.v === TOUR_VERSION) return raw.account === undefined ? { v: TOUR_VERSION, done: !!raw.done } : { v: TOUR_VERSION, done: !!raw.done, account: raw.account };
  } catch {
    // Sin almacenamiento, como nueva.
  }
  return { v: TOUR_VERSION, done: false };
}

export function writeDeviceTour(next: DeviceTour): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Sin almacenamiento, la recorrida se ofrece de nuevo: nada se pierde.
  }
}

export type TourMode =
  /** Nada a la vista. */
  | 'off'
  /** Un recorrido, en `chapter` y `step`. */
  | 'running'
  /** La tarjeta "¿Seguimos la recorrida?" (se recargó a mitad). */
  | 'resume'
  /** La tarjeta "¿Primera vez? Recorrida de 2 minutos" (entró con un link). */
  | 'invite';

export interface TourUi {
  mode: TourMode;
  /** El recorrido (id del catálogo). */
  tour: string;
  /** El capítulo y el paso (ids); `''`: el primero (el motor lo resuelve con el catálogo). */
  chapter: string;
  step: string;
  /** Se llegó con *Back*: un paso de acción ya cumplido dice «Already done» y no avanza solo. */
  via?: 'back';
  /** Sube al empezar o al seguir: la recorrida lleva a la práctica (si la persona se fue, queda en pausa). */
  nonce: number;
  /**
   * "Mostrame" de la ayuda (entrega 3): un solo paso, `id`, en la práctica. Al terminar se vuelve a `back` (dónde
   * estaba la persona, con el desplazamiento y el cursor; `null` si ya estaba en la práctica). No cuenta como recorrida
   * vista ni a medias; `prev` es lo que había a la vista antes (la tarjeta de retomar o la de primera vez), que vuelve.
   */
  only?: { id: string; back: ShowMePlace | null; prev: TourUi | null };
}

const OFF: Omit<TourUi, 'nonce'> = { mode: 'off', tour: GETTING_AROUND, chapter: '', step: '' };
let ui: TourUi = { ...OFF, nonce: 0 };
const listeners = new Set<() => void>();

function set(next: TourUi): void {
  ui = next;
  for (const fn of listeners) fn();
}

export function getTourUi(): TourUi {
  return ui;
}

export function subscribeTourUi(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useTourUi(): TourUi {
  return useSyncExternalStore(subscribeTourUi, () => ui);
}

// --- El documento de práctica (tour.html) ----------------------------------------------------------------

/** Este documento es el de práctica: no arranca la recorrida de la app ni anota nada en la cuenta. */
let doc: { back: string } | null = null;

export function inTourDocument(): boolean {
  return doc !== null;
}

/** Lo llama la entrada del documento de práctica, antes de dibujar la app: el recorrido arranca en `chapter`. */
export function enterTourDocument(tour: string, chapter: string, back: string): void {
  doc = { back };
  startTour(tour, chapter);
}

/** Sale del documento de práctica a donde estaba la persona (con `launch`, para arrancar ahí un recorrido de la app). */
export function leaveTourDocument(launch?: { tour: string; chapter: string }): void {
  if (doc) leaveTourDoc(doc.back, launch);
}

/**
 * Abrir un recorrido desde la ayuda: uno de la app arranca acá (en `/practice`, en el paso pedido); uno del documento de
 * práctica abre `tour.html` (y vuelve a esta dirección al salir) al principio del capítulo, porque el proyecto de
 * práctica se arma de nuevo. Adentro del documento de práctica, uno del documento cambia de capítulo en el lugar y uno de
 * la app sale primero.
 */
export function launchTour(tour: string, chapter = '', step = ''): void {
  if (!DOC_TOURS.has(tour)) startTour(tour, chapter, step);
  else if (doc) startTour(tour, chapter);
  else location.assign(tourDocHref(tour, chapter || null, location.pathname + location.search));
}

// --- Cuándo arranca --------------------------------------------------------------------------------------

/** Lo que decide el arranque, sin efectos (para probarlo). */
export interface StartFacts {
  /** La primera carga de este workspace en este dispositivo (`Services.firstLoad`). */
  firstLoad: boolean;
  /** La dirección con la que abrió la app es el inicio (`/`). */
  atHome: boolean;
  /** Entró con un link de invitación a una página o un proyecto. */
  invite: boolean;
  device: DeviceTour;
  /** La recorrida de la app quedó a medias en este dispositivo (hay dónde seguirla). */
  halfway: boolean;
  /** La cuenta dice que ya la vio (`shotdocs_tour` en los metadatos del usuario). */
  accountSeen: boolean;
}

/**
 * Qué mostrar al abrir la app (correcciones 5 y 22, decisión 2 de Lega): una recorrida a medias se ofrece retomar;
 * arranca sola solo para alguien nuevo en todo (ni el dispositivo ni la cuenta), en su primera carga y en el
 * inicio; con un link (de invitación o a una página), la tarjeta. Los demás ven el punto en el "?".
 */
export function decideStart(f: StartFacts): TourMode {
  if (!f.device.done && f.halfway) return 'resume';
  if (!f.firstLoad || f.device.done || f.accountSeen) return 'off';
  if (f.invite || !f.atHome) return 'invite';
  return 'running';
}

/** La recorrida de la app quedó a medias (hay un cursor guardado). */
export function appTourHalfway(): boolean {
  return cursorOf(GETTING_AROUND) !== null;
}

// --- "Mostrame" ------------------------------------------------------------------------------------------

/**
 * "Mostrame" (entrega 3): la práctica con un solo paso de la recorrida, el `id` de una entrada de la ayuda (`showMe`).
 * No toca lo guardado de la recorrida entera (ni vista, ni a medias). Al terminar, vuelve a donde estaba la persona.
 */
export function showStep(id: string): void {
  const here = location.pathname + location.search;
  const back = here === PRACTICE_PATH ? null : capturePlace();
  // Lo que estaba a la vista vuelve al terminar: la tarjeta de retomar o la de primera vez; una recorrida en curso
  // queda como tarjeta de retomar (su paso sigue guardado en el dispositivo).
  const before = ui.only ? ui.only.prev : ui;
  const prev = before && before.mode !== 'off' ? (before.mode === 'running' ? { ...before, mode: 'resume' as const, only: undefined } : before) : null;
  set({ ...OFF, mode: 'running', nonce: ui.nonce + 1, only: { id, back, prev } });
  // Una entrada nueva en el historial del navegador (Atrás durante el paso vuelve a la página y lo termina); al terminar
  // se vuelve con Atrás, así no queda ninguna de más. También desde la vista previa de una plantilla (`/practice?…`),
  // que tiene la misma ruta.
  if (back) {
    history.pushState(overlayState({ shotdocsShowMe: true }), '', PRACTICE_PATH);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
}

let cancelRestore: (() => void) | null = null;

/**
 * Termina "Mostrame". Con `goBack`, vuelve a donde estaba la persona (Atrás del navegador, que saca la entrada que
 * sumó `showStep`) con el desplazamiento y el cursor de antes. Sin `goBack` (la persona ya se fue de la práctica),
 * solo termina.
 */
export function endShowStep({ goBack = true }: { goBack?: boolean } = {}): void {
  const only = ui.only;
  if (!only) return;
  set(only.prev ? { ...only.prev, nonce: ui.nonce + 1 } : { ...OFF, nonce: ui.nonce });
  const back = only.back;
  if (!goBack || !back || location.pathname !== PRACTICE_PATH) return;
  cancelRestore?.();
  if ((history.state as { shotdocsShowMe?: boolean } | null)?.shotdocsShowMe) history.back();
  else {
    history.replaceState(null, '', back.path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
  cancelRestore = restorePlace(back);
}

// --- Correr un recorrido ---------------------------------------------------------------------------------

/**
 * Arranca un recorrido en este documento, en `chapter` y `step` (vacíos: el primero). Sin nada, la recorrida de la app
 * desde el principio (la entrada *Take the tour* de la ayuda). Adentro del documento de práctica, uno de la app sale.
 */
export function startTour(tour = GETTING_AROUND, chapter = '', step = ''): void {
  if (doc && !DOC_TOURS.has(tour)) {
    leaveTourDocument({ tour, chapter });
    return;
  }
  if (tour === GETTING_AROUND) writeDeviceTour({ ...readDeviceTour(), done: false });
  flags.slashUsed = false;
  set({ mode: 'running', tour, chapter, step, nonce: ui.nonce + 1 });
}

/** Sigue el recorrido a medias (la tarjeta de retomar o la de pausa), donde quedó. */
export function continueTour(): void {
  const tour = ui.tour;
  const at = ui.mode === 'running' && !ui.only ? { chapter: ui.chapter, step: ui.step } : cursorOf(tour);
  set({ mode: 'running', tour, chapter: at?.chapter ?? '', step: at?.step ?? '', nonce: ui.nonce + 1 });
}

/** Muestra una tarjeta (retomar la recorrida de la app, o la de primera vez) sin empezar nada. */
export function offerTour(mode: 'resume' | 'invite'): void {
  const at = mode === 'resume' ? cursorOf(GETTING_AROUND) : null;
  set({ mode, tour: GETTING_AROUND, chapter: at?.chapter ?? '', step: at?.step ?? '', nonce: ui.nonce });
}

/** Pasa a otro paso del recorrido que corre (lo llama el motor); queda guardado en el dispositivo. */
export function setTourAt(chapter: string, step: string, via?: 'back'): void {
  if (ui.mode !== 'running' || ui.only) return;
  setCursor(ui.tour, { chapter, step });
  set({ ...ui, chapter, step, via });
}

/** Esconde la tarjeta o la recorrida sin marcar nada ("Ahora no", salir de la sesión): queda el punto en el "?". */
export function dismissTour(): void {
  if (ui.mode !== 'off') set({ ...OFF, nonce: ui.nonce });
}

/** Lo anota en la cuenta (lo pone `TourHost`, que tiene el cliente del workspace). */
let markAccount: (() => Promise<boolean>) | null = null;

export function setAccountMarker(fn: (() => Promise<boolean>) | null): void {
  markAccount = fn;
}

/**
 * Terminar o salir de la recorrida de la app (cuentan igual): queda vista en el dispositivo y se anota en la cuenta.
 * Sin red, la cuenta queda para después (`account: false`) y se vuelve a probar al volver la red y al abrir la app. Lo
 * guardado de dónde quedó (para *Continue* en la ayuda) no se toca: lo borra el motor solo al terminar el recorrido.
 */
export function endTour(): void {
  writeDeviceTour({ v: TOUR_VERSION, done: true, account: false });
  set({ ...OFF, nonce: ui.nonce });
  void syncAccountMark();
}

/** Si quedó por anotar en la cuenta, lo intenta (al abrir la app y al volver la red). */
export async function syncAccountMark(): Promise<void> {
  const device = readDeviceTour();
  if (!device.done || device.account !== false || !markAccount) return;
  if (await markAccount().catch(() => false)) writeDeviceTour({ ...readDeviceTour(), account: true });
}

/**
 * El punto del "?": hay una recorrida para ver (nunca terminada acá) y la ayuda nunca se abrió en el dispositivo, o
 * hay novedades en la ayuda (entrega 3). `news` dice cuál de las dos (para el nombre del botón).
 */
export function useHelpDot(): { dot: boolean; news: boolean } {
  useHelpUi();
  const { mode } = useTourUi();
  const news = useHelpNews();
  // Una vez por carga: si la app cambió de versión, se cuentan las novedades (las entradas se bajan con la ayuda).
  useEffect(() => {
    if (newsChecked) return;
    newsChecked = true;
    const run = () => void checkHelpNews(__APP_VERSION__, () => import('../help/entries').then((m) => m.HELP_ENTRIES.map((e) => e.since)));
    // Cuando el navegador está libre: la primera carga no espera a la ayuda.
    const idle = (globalThis as { requestIdleCallback?: (fn: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (idle) idle(run, { timeout: 4000 });
    else setTimeout(run, 1500);
  }, []);
  return { dot: news || (mode === 'off' && !readDeviceTour().done && !helpSeen()), news };
}

/** Las novedades se cuentan una vez por carga de la app. */
let newsChecked = false;

// --- Señales entre la práctica y la recorrida (las dos se bajan aparte) -----------------------------------

type Signal = 'slash';
const signals = new Set<(s: Signal) => void>();

/** Lo que pasó en la práctica y leen las condiciones de los pasos de acción (src/tour/conditions.ts). */
export const flags = { slashUsed: false };

/** La práctica avisa lo que pasó (se usó el menú "/"). */
export function tourSignal(s: Signal): void {
  if (s === 'slash') flags.slashUsed = true;
  for (const fn of signals) fn(s);
}

export function onTourSignal(fn: (s: Signal) => void): () => void {
  signals.add(fn);
  return () => signals.delete(fn);
}

/** Lo que la recorrida le pide a la práctica: llevar el cursor al renglón vacío (paso del menú "/"). */
export const practiceHooks: {
  focusEmptyLine: (() => void) | null;
  /** Si el menú "/" de la práctica está abierto ("Mostrame": Esc es del menú). */
  slashMenuOpen: (() => boolean) | null;
} = { focusEmptyLine: null, slashMenuOpen: null };
