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
  /** La dirección de cada posición del tramo (los tabs de la app instalada, tabs.ts); puede faltar. */
  p?: (string | null)[];
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
/** La dirección de cada posición del tramo (`null` si no se sabe): para guardar el historial de un tab al dejarlo. */
let paths: (string | null)[] = [];
/**
 * Desde qué posición del tramo las entradas son de este documento. Al recargar, las de antes son de la carga anterior:
 * volver a ellas con `history.go` recargaría la app, así que `rebuildHistory` no pasa de acá.
 */
let docStart = 0;
/** Las funciones del historial sin envolver: `rebuildHistory` arma las entradas con sus propias marcas. */
let rawPush: History['pushState'] | null = null;
let rawReplace: History['replaceState'] | null = null;
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
    const p = Array.isArray(v.p) ? v.p.map((x) => (typeof x === 'string' && x.startsWith('/') ? x : null)) : undefined;
    return { s: v.s, max: v.max as number, at: v.at as number, p };
  } catch {
    return null;
  }
}

/** La dirección de la entrada de ahora (sin el `#`: la ruta y lo que va después del `?`). */
function here(win: Window): string {
  return win.location.pathname + win.location.search;
}

function save(win: Window): void {
  // Una capa (el carrete, «Show me») no es una página del tab: al rearmarlo no se reabre.
  paths[idx] = overlay ? null : here(win);
  if (paths.length > max + 1) paths.length = max + 1;
  try {
    win.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ s: seg, max, at: idx, p: paths } satisfies Saved));
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
    paths = [];
    replace.call(win.history, tagged(state, { s: seg, i: 0 }), '');
  } else {
    seg = tag.s;
    idx = tag.i;
    const saved = readSaved(win);
    if (saved && saved.s === seg) {
      // Recargar conserva las entradas de adelante. Volver con atrás o adelante a un documento del mismo tramo: si
      // se había salido a otro sitio, lo de adelante de donde se salió ya no existe; se cuenta solo hasta ahí.
      max = type === 'reload' ? Math.max(idx, saved.max) : Math.max(idx, Math.min(saved.max, saved.at));
      paths = saved.p ? saved.p.slice(0, max + 1) : [];
    } else {
      max = idx;
      paths = [];
    }
  }
  docStart = idx;
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
    paths = [];
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
  rawPush = push;
  rawReplace = replace;
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
    rawPush = null;
    rawReplace = null;
    installed = null;
  };
  installed = { win, uninstall };
  return uninstall;
}

/** El historial de un tab: sus direcciones, de la más vieja a la de ahora y lo de adelante, y en cuál está. */
export interface TabHistory {
  stack: string[];
  at: number;
}

/** Un tab no guarda más que estas posiciones (las más viejas se olvidan). */
export const TAB_HISTORY_MAX = 20;

/**
 * El historial del tab de ahora (los tabs de la app instalada, `ui/tabs.ts`): las posiciones del tramo con dirección
 * conocida, sin repetir seguidas (una capa como el carrete tiene la dirección de su página) y sin pasar de
 * `TAB_HISTORY_MAX`.
 */
export function historyStack(win: Window = window): TabHistory {
  const stack: string[] = [];
  let at = 0;
  for (let i = 0; i <= max; i++) {
    const path = i === idx ? here(win) : paths[i];
    if (path && stack[stack.length - 1] !== path) stack.push(path);
    if (i === idx) at = Math.max(0, stack.length - 1);
  }
  if (stack.length === 0) return { stack: [here(win)], at: 0 };
  const cut = Math.max(0, stack.length - TAB_HISTORY_MAX);
  return { stack: stack.slice(cut), at: Math.max(0, at - cut) };
}

/** Va `delta` posiciones en el historial y espera la vuelta (o un segundo, si no llega). */
function travel(win: Window, delta: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, 1000);
    function done() {
      clearTimeout(timer);
      win.removeEventListener('popstate', done);
      resolve();
    }
    win.addEventListener('popstate', done);
    win.history.go(delta);
  });
}

/**
 * Cambia el historial de la ventana por el de otro tab: vuelve al principio del tramo de ahora y arma ahí las entradas
 * del tab, en un tramo nuevo, con la de `at` como la de ahora. Así atrás y adelante (los botones, los atajos y los
 * botones del mouse) recorren solo las páginas de ese tab. Mientras tanto la ruta no se mueve (`holdRoute` del router,
 * lo hace quien llama): las vueltas de en el medio no abren páginas.
 */
export async function rebuildHistory(next: TabHistory, win: Window = window): Promise<void> {
  if (!installed || installed.win !== win || !rawPush || !rawReplace) return;
  const push = rawPush;
  const replace = rawReplace;
  const stack = next.stack.length ? next.stack : ['/'];
  const at = Math.min(Math.max(0, next.at), stack.length - 1);
  if (pending !== null) clearTimeout(pending);
  pending = null;
  // Safari no acepta más de 100 cambios del historial en 30 s (Chrome ignora los de más): pasando seguido de tab, el
  // tab vuelve con su página nada más, sin su atrás.
  const now = Date.now();
  while (historyCalls.length && now - historyCalls[0] > HISTORY_WINDOW_MS) historyCalls.shift();
  const full = historyCalls.length + stack.length + 2 > HISTORY_BUDGET;
  const entries = full ? [stack[at]] : stack;
  const current = full ? 0 : at;
  // Solo hasta donde empieza este documento: más atrás es la carga de antes (volver ahí recargaría la app).
  if (idx > docStart) await travel(win, docStart - idx);
  seg = newSegment();
  overlay = false;
  try {
    replace.call(win.history, tagged(null, { s: seg, i: 0 }), '', entries[0]);
    record();
    for (let i = 1; i < entries.length; i++) {
      push.call(win.history, tagged(null, { s: seg, i }), '', entries[i]);
      record();
    }
    // Con una sola entrada no hubo ningún `pushState`: lo de adelante del tab anterior seguiría ahí. Una copia de esta
    // la corta (adelante queda apagado igual: `max` es 0).
    if (entries.length === 1) {
      push.call(win.history, tagged(null, { s: seg, i: 1 }), '', entries[0]);
      record();
      await travel(win, -1);
    } else if (current < entries.length - 1) await travel(win, current - (entries.length - 1));
    idx = current;
    max = entries.length - 1;
    paths = entries.slice();
  } catch {
    // El navegador no dejó (el tope de arriba): el registro sigue lo que quedó, sin adelante.
    const tag = readNavTag(win.history.state);
    const fresh = !tag || tag.s === seg;
    if (tag) seg = tag.s;
    idx = tag?.i ?? 0;
    max = idx;
    // Las direcciones de atrás no se saben (eran del tab anterior); el principio de este documento, si se volvió al
    // tramo viejo, sigue donde estaba.
    paths = [];
    if (fresh) docStart = 0;
    save(win);
    emit();
    return;
  }
  docStart = 0;
  save(win);
  emit();
}

/** Los cambios del historial que hizo `rebuildHistory` en los últimos `HISTORY_WINDOW_MS`. */
const historyCalls: number[] = [];
const HISTORY_WINDOW_MS = 30_000;
const HISTORY_BUDGET = 80;

function record(): void {
  historyCalls.push(Date.now());
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
