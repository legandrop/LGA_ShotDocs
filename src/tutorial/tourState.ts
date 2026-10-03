import { useEffect, useSyncExternalStore } from 'react';
import { helpSeen, useHelpUi } from '../help/helpUi';
import { checkHelpNews, useHelpNews } from '../help/news';
import { PRACTICE_PATH } from '../router';
import { capturePlace, restorePlace, type ShowMePlace } from './showMePlace';

// El estado de la recorrida (Docs/Doc_Tutorial.md, sección 4, "Cuándo aparece y dónde se guarda que ya se vio"). Va
// en la primera carga y es chico: decidir si arranca, el punto del "?" y las señales de la práctica. El motor
// (TourLayer.tsx), los pasos y sus textos se bajan aparte, solo cuando hacen falta.
//
// - En el dispositivo (`localStorage`, una clave para todos los workspaces: es lo que la persona sabe de la app):
//   `{ v, done, step, account }`. `step` es el paso de una recorrida a medias (para retomarla al recargar);
//   `account: false`, que falta anotarla en la cuenta (no había red).
// - En la cuenta (por workspace): `shotdocs_tour: 1` en los metadatos del usuario de Supabase Auth (corrección 12;
//   nunca en `user_settings.prefs`). Lo escribe `TourHost` con el cliente del workspace.

export const TOUR_VERSION = 1;
const KEY = 'shotdocs-tour';
/** La marca en los metadatos del usuario de Supabase Auth. */
export const ACCOUNT_MARK = 'shotdocs_tour';

export interface DeviceTour {
  v: number;
  done: boolean;
  /** El paso (desde 0) de una recorrida a medias; `null` si no hay ninguna. */
  step: number | null;
  /** `false`: terminada en este dispositivo pero todavía sin anotar en la cuenta. */
  account?: boolean;
}

export function readDeviceTour(): DeviceTour {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<DeviceTour> | null;
    // Una versión nueva de la recorrida (cambió mucho) cuenta como no vista.
    if (raw && raw.v === TOUR_VERSION) return { v: TOUR_VERSION, done: !!raw.done, step: typeof raw.step === 'number' ? raw.step : null, account: raw.account };
  } catch {
    // Sin almacenamiento, como nueva.
  }
  return { v: TOUR_VERSION, done: false, step: null };
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
  /** La recorrida, en el paso `step`. */
  | 'running'
  /** La tarjeta "¿Seguimos la recorrida?" (se recargó a mitad). */
  | 'resume'
  /** La tarjeta "¿Primera vez? Recorrida de 2 minutos" (entró con un link). */
  | 'invite';

export interface TourUi {
  mode: TourMode;
  step: number;
  /** Sube al empezar o al seguir: la recorrida lleva a la práctica (si la persona se fue, queda en pausa). */
  nonce: number;
  /**
   * "Mostrame" de la ayuda (entrega 3): un solo paso, `id`, en la práctica. Al terminar se vuelve a `back` (dónde
   * estaba la persona, con el desplazamiento y el cursor; `null` si ya estaba en la práctica). No cuenta como recorrida
   * vista ni a medias; `prev` es lo que había a la vista antes (la tarjeta de retomar o la de primera vez), que vuelve.
   */
  only?: { id: string; back: ShowMePlace | null; prev: TourUi | null };
}

let ui: TourUi = { mode: 'off', step: 0, nonce: 0 };
const listeners = new Set<() => void>();

function set(next: TourUi): void {
  ui = next;
  for (const fn of listeners) fn();
}

export function getTourUi(): TourUi {
  return ui;
}

export function useTourUi(): TourUi {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => ui,
  );
}

/** Lo que decide el arranque, sin efectos (para probarlo). */
export interface StartFacts {
  /** La primera carga de este workspace en este dispositivo (`Services.firstLoad`). */
  firstLoad: boolean;
  /** La dirección con la que abrió la app es el inicio (`/`). */
  atHome: boolean;
  /** Entró con un link de invitación a una página o un proyecto. */
  invite: boolean;
  device: DeviceTour;
  /** La cuenta dice que ya la vio (`shotdocs_tour` en los metadatos del usuario). */
  accountSeen: boolean;
}

/**
 * Qué mostrar al abrir la app (correcciones 5 y 22, decisión 2 de Lega): una recorrida a medias se ofrece retomar;
 * arranca sola solo para alguien nuevo en todo (ni el dispositivo ni la cuenta), en su primera carga y en el
 * inicio; con un link (de invitación o a una página), la tarjeta. Los demás ven el punto en el "?".
 */
export function decideStart(f: StartFacts): TourMode {
  if (!f.device.done && f.device.step !== null) return 'resume';
  if (!f.firstLoad || f.device.done || f.accountSeen) return 'off';
  if (f.invite || !f.atHome) return 'invite';
  return 'running';
}

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
  set({ mode: 'running', step: 0, nonce: ui.nonce + 1, only: { id, back, prev } });
  // Una entrada nueva en el historial del navegador (Atrás durante el paso vuelve a la página y lo termina); al terminar
  // se vuelve con Atrás, así no queda ninguna de más. También desde la vista previa de una plantilla (`/practice?…`),
  // que tiene la misma ruta.
  if (back) {
    history.pushState({ shotdocsShowMe: true }, '', PRACTICE_PATH);
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
  set(only.prev ? { ...only.prev, nonce: ui.nonce + 1 } : { mode: 'off', step: 0, nonce: ui.nonce });
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

/** Arranca la recorrida desde el paso 1 (la ayuda la ofrece siempre; Docs/Doc_Tutorial.md, sección 4). */
export function startTour(step = 0): void {
  writeDeviceTour({ ...readDeviceTour(), done: false, step });
  set({ mode: 'running', step, nonce: ui.nonce + 1 });
}

/** Sigue una recorrida a medias (la tarjeta de retomar o la de pausa), en el paso guardado. */
export function continueTour(): void {
  startTour(ui.mode === 'running' && !ui.only ? ui.step : (readDeviceTour().step ?? 0));
}

/** Muestra una tarjeta (retomar o la de primera vez) sin empezar nada. */
export function offerTour(mode: 'resume' | 'invite'): void {
  set({ mode, step: mode === 'resume' ? (readDeviceTour().step ?? 0) : 0, nonce: ui.nonce });
}

export function setTourStep(step: number): void {
  writeDeviceTour({ ...readDeviceTour(), done: false, step });
  set({ mode: 'running', step, nonce: ui.nonce });
}

/** Esconde la tarjeta o la recorrida sin marcar nada ("Ahora no", salir de la sesión): queda el punto en el "?". */
export function dismissTour(): void {
  if (ui.mode !== 'off') set({ mode: 'off', step: 0, nonce: ui.nonce });
}

/** Lo anota en la cuenta (lo pone `TourHost`, que tiene el cliente del workspace). */
let markAccount: (() => Promise<boolean>) | null = null;

export function setAccountMarker(fn: (() => Promise<boolean>) | null): void {
  markAccount = fn;
}

/**
 * Terminar o saltar la recorrida (cuentan igual): queda vista en el dispositivo y se anota en la cuenta. Sin red,
 * la cuenta queda para después (`account: false`) y se vuelve a probar al volver la red y al abrir la app.
 */
export function endTour(): void {
  writeDeviceTour({ v: TOUR_VERSION, done: true, step: null, account: false });
  set({ mode: 'off', step: 0, nonce: ui.nonce });
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

/** La práctica avisa lo que pasó (se abrió el menú "/"). */
export function tourSignal(s: Signal): void {
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
