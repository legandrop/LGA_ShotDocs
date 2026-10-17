import { useSyncExternalStore } from 'react';
import { IS_MAC } from './ui/shortcuts';
import { modPressed } from './ui/findUi';

// Atrás y adelante adentro de la app (Docs/Doc_Navegacion.md). El navegador no dice si la entrada de atrás es de la
// app o del sitio de antes, así que la app lleva su propio registro de posición:
//
// - Cada entrada del historial lleva en su `state` la marca `sdNav = { s, i }`: `s` es el tramo (un id por cada vez
//   que la app arranca en una entrada nueva, sin marca) e `i` su posición dentro del tramo, desde 0. `history.pushState`
//   y `history.replaceState` quedan envueltos al arrancar (`installNavHistory`), así cualquier código que los llame
//   (el router, el carrete, la recorrida, los `replaceState(null, …)` que limpian la dirección) conserva la marca.
// - `max` es la última posición que existe adelante en el tramo. Va también en `sessionStorage` (por pestaña), junto
//   con la posición de ahora, para sobrevivir a una recarga.
// - Atrás vale con `i > 0`: la entrada de atrás es siempre la `i - 1` del mismo tramo (la creó un `pushState` desde
//   ella). Adelante vale con `i < max`. Ante la duda (volver a un tramo viejo, una página restaurada de la caché del
//   navegador), adelante queda apagado: nunca se sale de la app por un botón de la app.
// - Las entradas de una capa (el carrete, «Show me» de la recorrida) llevan `sdNavOverlay` (`overlayState`). Al volver
//   de una de ellas, lo de adelante se olvida: adelante no reabre un carrete ya cerrado.

/** La marca de posición de una entrada del historial. */
export interface NavTag {
  s: string;
  i: number;
}

/** Si se puede ir atrás o adelante sin salir de la app. */
export interface NavPosition {
  canBack: boolean;
  canForward: boolean;
}

const TAG = 'sdNav';
const OVERLAY = 'sdNavOverlay';
const STORAGE_KEY = 'shotdocs.navHistory';
/**
 * Después de un atrás o adelante, otro no se acepta hasta que pasaron estos milisegundos desde el clic (y llegó la
 * vuelta del primero): un doble clic va una sola página. El doble clic de Windows es de hasta 500 ms.
 */
const QUIET_MS = 500;
/** Si la vuelta del navegador no llega en este tiempo, se deja de esperarla. */
const PENDING_MS = 2000;

/** Lo guardado por pestaña: el tramo, su última posición adelante y la posición de la entrada que se veía. */
interface Saved {
  s: string;
  max: number;
  at: number;
}

let installed: { win: Window; uninstall: () => void } | null = null;
let seg = '';
let idx = 0;
let max = 0;
/** La entrada de ahora es de una capa (carrete, «Show me»). */
let overlay = false;
/** Un atrás o adelante en camino: hasta su `popstate` (o `PENDING_MS`). */
let pending: ReturnType<typeof setTimeout> | null = null;
/** Hasta cuándo no se acepta otro atrás o adelante (`QUIET_MS` desde el último). */
let quietUntil = 0;
let snapshot: NavPosition = { canBack: false, canForward: false };
const listeners = new Set<() => void>();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** La marca de un `state`, o `null` si no tiene una válida. */
export function readNavTag(state: unknown): NavTag | null {
  if (!isPlainObject(state)) return null;
  const tag = state[TAG];
  if (!isPlainObject(tag) || typeof tag.s !== 'string' || !tag.s || typeof tag.i !== 'number' || !Number.isInteger(tag.i) || tag.i < 0) return null;
  return { s: tag.s, i: tag.i };
}

function isOverlay(state: unknown): boolean {
  return isPlainObject(state) && state[OVERLAY] === true;
}

/**
 * El `state` de una entrada que abre una capa encima de la página (el carrete, «Show me»): atrás la cierra, y al
 * volver de ella adelante no la reabre.
 */
export function overlayState<T extends Record<string, unknown>>(state: T): T & { [OVERLAY]: true } {
  return { ...state, [OVERLAY]: true };
}

/** El `state` con la marca. Un `state` que no es un objeto simple queda como está (ningún código de la app lo usa). */
function tagged(state: unknown, tag: NavTag): unknown {
  if (state === null || state === undefined) return { [TAG]: tag };
  if (!isPlainObject(state)) return state;
  return { ...state, [TAG]: tag };
}

function newSegment(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // Sin `crypto.randomUUID` (un contexto sin HTTPS): el de abajo alcanza, solo distingue tramos de una pestaña.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function readSaved(win: Window): Saved | null {
  try {
    const raw = win.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Saved>;
    if (typeof v.s !== 'string' || !Number.isInteger(v.max) || !Number.isInteger(v.at)) return null;
    return { s: v.s, max: v.max as number, at: v.at as number };
  } catch {
    return null;
  }
}

function save(win: Window): void {
  try {
    win.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ s: seg, max, at: idx } satisfies Saved));
  } catch {
    // Sin `sessionStorage` (modo privado estricto): el registro vale hasta recargar.
  }
}

function emit(): void {
  const next = { canBack: idx > 0, canForward: idx < max };
  if (next.canBack === snapshot.canBack && next.canForward === snapshot.canForward) return;
  snapshot = next;
  for (const fn of listeners) fn();
}

/** Cómo se llegó a este documento: recargando, con atrás o adelante, o de nuevo. */
function navigationType(win: Window): string {
  try {
    const entry = win.performance?.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined;
    return entry?.type ?? 'navigate';
  } catch {
    return 'navigate';
  }
}

/**
 * Lee dónde está la pestaña al arrancar (o al volver de la caché del navegador, `pageshow`): una entrada sin marca
 * empieza un tramo nuevo; una con marca sigue el suyo, con lo de adelante que se sabe seguro.
 */
function sync(win: Window, type: string, replace: History['replaceState']): void {
  const state = win.history.state;
  const tag = readNavTag(state);
  overlay = isOverlay(state);
  if (!tag) {
    seg = newSegment();
    idx = 0;
    max = 0;
    replace.call(win.history, tagged(state, { s: seg, i: 0 }), '');
  } else {
    seg = tag.s;
    idx = tag.i;
    const saved = readSaved(win);
    if (saved && saved.s === seg) {
      // Recargar conserva las entradas de adelante. Volver con atrás o adelante a un documento del mismo tramo: si
      // se había salido a otro sitio, lo de adelante de donde se salió ya no existe; se cuenta solo hasta ahí.
      max = type === 'reload' ? Math.max(idx, saved.max) : Math.max(idx, Math.min(saved.max, saved.at));
    } else max = idx;
  }
  save(win);
}

/** Después de un `popstate` o un `hashchange`: la entrada de ahora. */
function observe(win: Window, replace: History['replaceState']): void {
  if (pending !== null) {
    clearTimeout(pending);
    pending = null;
  }
  const state = win.history.state;
  const tag = readNavTag(state);
  if (!tag) {
    // Una entrada nueva sin marca dentro del mismo documento (un link con `#`): como un `pushState`.
    idx += 1;
    max = idx;
    overlay = isOverlay(state);
    replace.call(win.history, tagged(state, { s: seg, i: idx }), '');
  } else if (tag.s !== seg) {
    seg = tag.s;
    idx = tag.i;
    max = idx;
    overlay = isOverlay(state);
  } else {
    // Volver de una capa olvida lo de adelante (era la capa, ya cerrada).
    if (overlay && tag.i < idx) max = tag.i;
    idx = tag.i;
    if (idx > max) max = idx;
    overlay = isOverlay(state);
  }
  save(win);
  emit();
}

/**
 * Envuelve `history.pushState` y `history.replaceState` de la ventana y escucha la vuelta del historial. Una sola vez
 * por ventana (se llama al arrancar, en `main.tsx`); devuelve cómo deshacerlo (las pruebas).
 */
export function installNavHistory(win: Window = window): () => void {
  if (installed?.win === win) return installed.uninstall;
  installed?.uninstall();
  const history = win.history;
  const push = history.pushState;
  const replace = history.replaceState;
  const ownPush = history.hasOwnProperty('pushState');
  const ownReplace = history.hasOwnProperty('replaceState');
  sync(win, navigationType(win), replace);
  history.pushState = function pushState(state: unknown, unused: string, url?: string | URL | null) {
    const next = idx + 1;
    push.call(history, tagged(state, { s: seg, i: next }), unused, url);
    idx = next;
    max = next;
    overlay = isOverlay(state);
    save(win);
    emit();
  };
  history.replaceState = function replaceState(state: unknown, unused: string, url?: string | URL | null) {
    replace.call(history, tagged(state, { s: seg, i: idx }), unused, url);
    overlay = isOverlay(state);
    save(win);
  };
  const onPop = () => observe(win, replace);
  const onHash = () => {
    // Un `hashchange` sin `popstate` (navegadores viejos): solo si la entrada quedó sin marca.
    if (!readNavTag(win.history.state)) observe(win, replace);
  };
  const onShow = (e: PageTransitionEvent) => {
    if (!e.persisted) return;
    sync(win, 'back_forward', replace);
    emit();
  };
  win.addEventListener('popstate', onPop);
  win.addEventListener('hashchange', onHash);
  win.addEventListener('pageshow', onShow);
  emit();
  const uninstall = () => {
    if (installed?.win !== win) return;
    win.removeEventListener('popstate', onPop);
    win.removeEventListener('hashchange', onHash);
    win.removeEventListener('pageshow', onShow);
    if (ownPush) history.pushState = push;
    else delete (history as Partial<History>).pushState;
    if (ownReplace) history.replaceState = replace;
    else delete (history as Partial<History>).replaceState;
    if (pending !== null) clearTimeout(pending);
    pending = null;
    quietUntil = 0;
    installed = null;
  };
  installed = { win, uninstall };
  return uninstall;
}

/** Dónde está el registro (para las pruebas y el diagnóstico). */
export function navDebug(): { seg: string; idx: number; max: number; overlay: boolean } {
  return { seg, idx, max, overlay };
}

export function navPosition(): NavPosition {
  return snapshot;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Si se puede ir atrás o adelante adentro de la app; se actualiza solo. */
export function useNavPosition(): NavPosition {
  return useSyncExternalStore(subscribe, navPosition, navPosition);
}

function traverse(win: Window, delta: -1 | 1): boolean {
  if (!installed || pending !== null || Date.now() < quietUntil) return false;
  if (delta < 0 ? idx <= 0 : idx >= max) return false;
  pending = setTimeout(() => (pending = null), PENDING_MS);
  quietUntil = Date.now() + QUIET_MS;
  win.history.go(delta);
  return true;
}

/** A la página anterior adentro de la app. `false` si no hay, o si hubo otro atrás o adelante hace menos de `QUIET_MS`. */
export function goBack(win: Window = window): boolean {
  return traverse(win, -1);
}

/** A la página siguiente (después de haber vuelto). `false` si no hay. */
export function goForward(win: Window = window): boolean {
  return traverse(win, 1);
}

interface NavKey {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Lo que manda el navegador cuando la tecla no da un carácter (una tecla muerta en un teclado que no es de EE. UU.). */
const UNNAMED = new Set(['Dead', 'Unidentified']);

/** `[` o `]`; en un teclado donde esa tecla no da el carácter, su lugar en el de EE. UU. */
function bracket(e: NavKey, which: '[' | ']'): boolean {
  if (e.key === '[') return which === '[';
  if (e.key === ']') return which === ']';
  return UNNAMED.has(e.key) && e.code === (which === '[' ? 'BracketLeft' : 'BracketRight');
}

/** Atrás: ⌘[ en la Mac (nunca Ctrl), Alt+← en el resto. */
export function isNavBackShortcut(e: NavKey, mac = IS_MAC): boolean {
  if (mac) return modPressed(e, true) && !e.altKey && !e.shiftKey && bracket(e, '[');
  return e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key === 'ArrowLeft';
}

/** Adelante: ⌘] en la Mac, Alt+→ en el resto. */
export function isNavForwardShortcut(e: NavKey, mac = IS_MAC): boolean {
  if (mac) return modPressed(e, true) && !e.altKey && !e.shiftKey && bracket(e, ']');
  return e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key === 'ArrowRight';
}

/** Una capa abierta (un diálogo, el carrete, el anotador): el atajo es de ella, o del navegador. */
const MODAL = '[aria-modal="true"], .modal-backdrop, .carrete, dialog[open]';

let keyUsers = 0;
let keyHandler: ((e: KeyboardEvent) => void) | null = null;

/**
 * Los atajos de atrás y adelante, en `window` (fase de burbuja: lo que ya tomó el editor, el carrete o el anotador no
 * llega). Sin a dónde ir, no se frena: el navegador hace lo suyo. La tecla mantenida (`repeat`) se frena siempre y no
 * navega: así mantener Alt+← no sigue yendo atrás hasta salir de la app. Lo usan los botones (`NavButtons`), con un
 * conteo para que dos copias no vayan dos veces atrás.
 */
export function listenNavShortcuts(win: Window = window): () => void {
  keyUsers += 1;
  if (!keyHandler) {
    keyHandler = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const back = isNavBackShortcut(e);
      if (!back && !isNavForwardShortcut(e)) return;
      if (win.document.querySelector(MODAL)) return;
      if (e.repeat) {
        e.preventDefault();
        return;
      }
      const position = navPosition();
      if (back ? !position.canBack : !position.canForward) return;
      e.preventDefault();
      if (back) goBack(win);
      else goForward(win);
    };
    win.addEventListener('keydown', keyHandler);
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    keyUsers -= 1;
    if (keyUsers === 0 && keyHandler) {
      win.removeEventListener('keydown', keyHandler);
      keyHandler = null;
    }
  };
}
