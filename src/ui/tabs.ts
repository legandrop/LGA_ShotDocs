import { useSyncExternalStore } from 'react';
import { historyStack, rebuildHistory, type TabHistory } from '../navHistory';
import { pageLink, qualifyPageLink } from '../pageLink';
import { documentPageOrigin, holdRoute, releaseRoute } from '../router';
import { isStandalone } from './install';

// Los tabs de la app instalada (Docs/Doc_Navegacion.md, sección «Tabs», D811): varias páginas abiertas en la misma
// ventana, como en un navegador. En el navegador no hay (ya tiene los suyos: cada pestaña es otra copia de la app,
// services.ts) y en el teléfono tampoco.
//
// - Se ve uno solo a la vez: el de ahora es la dirección de la ventana y todo lo demás de la app (la barra lateral, la
//   página, la cabecera) sigue leyendo la ruta como siempre. Los otros son solo su historial guardado.
// - Cada tab tiene su atrás y adelante: al cambiar, el historial de la ventana se rearma con el del tab
//   (`rebuildHistory`) mientras la ruta queda quieta (`holdRoute`).
// - Se recuerdan en el dispositivo, por workspace y cuenta (`bindTabs`), y vuelven al abrir la app.

export interface AppTab {
  id: string;
  /** Su historial. En el de ahora, el último que se guardó (el vivo es el de la ventana). */
  history: TabHistory;
  /** El proyecto que se veía (el inicio, el mapa y la papelera muestran el proyecto elegido, no uno de la ruta). */
  project: string | null;
  /** Cuánto estaba desplazada la página. */
  scroll: number;
}

interface TabsState {
  tabs: AppTab[];
  active: string;
}

interface Binding {
  key: string;
  /** El proyecto que se ve ahora. */
  project: () => string | null;
  /** Deja elegido ese proyecto (antes de mostrar un tab que no está en una página). */
  chooseProject: (projectId: string) => void;
}

/** Más tabs no se abren (cada uno es solo una lista de direcciones, pero una barra con más no se lee). */
export const MAX_TABS = 20;

let binding: Binding | null = null;
let state: TabsState = { tabs: [], active: '' };
/** Se está mostrando un tab (`show`): el historial de la ventana está a mitad de rearmarse. */
let showing = false;
/** Un cambio de tab en camino: otro espera a que termine. */
let busy: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // Sin `crypto.randomUUID` (sin HTTPS): alcanza con distinguir los tabs de esta ventana.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function here(): string {
  return location.pathname + location.search;
}

function scrollRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.main');
}

/** Si esta ventana tiene tabs: la app instalada y una pantalla que no es la del teléfono. */
export function tabsAvailable(): boolean {
  if (typeof window === 'undefined' || typeof matchMedia !== 'function') return false;
  return isStandalone() && !matchMedia('(max-width: 760px)').matches;
}

function validHistory(v: unknown): TabHistory | null {
  if (!v || typeof v !== 'object') return null;
  const { stack, at } = v as Partial<TabHistory>;
  if (!Array.isArray(stack) || !Number.isInteger(at)) return null;
  const clean = stack.filter((p): p is string => typeof p === 'string' && p.startsWith('/') && !p.startsWith('//'));
  if (clean.length === 0 || clean.length !== stack.length) return null;
  return { stack: clean, at: Math.min(Math.max(0, at as number), clean.length - 1) };
}

/** Lo guardado, si sirve (un tab roto se descarta; la lista entera nunca se pierde por uno). */
export function readTabs(raw: string | null): TabsState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { tabs?: unknown; active?: unknown };
    if (!Array.isArray(v.tabs)) return null;
    const tabs: AppTab[] = [];
    for (const t of v.tabs.slice(0, MAX_TABS)) {
      if (!t || typeof t !== 'object') continue;
      const o = t as Record<string, unknown>;
      const history = validHistory(o.history);
      if (typeof o.id !== 'string' || !o.id || !history) continue;
      tabs.push({
        id: o.id,
        history,
        project: typeof o.project === 'string' ? o.project : null,
        scroll: typeof o.scroll === 'number' && o.scroll >= 0 ? o.scroll : 0,
      });
    }
    if (tabs.length === 0) return null;
    const active = typeof v.active === 'string' && tabs.some((t) => t.id === v.active) ? v.active : tabs[0].id;
    return { tabs, active };
  } catch {
    return null;
  }
}

/** El tab de ahora con lo vivo de la ventana: su historial, su proyecto y cuánto está desplazado. */
function captureActive(): TabsState {
  // Mientras se rearma el historial, la ventana todavía no es la del tab elegido: lo guardado de él es lo que vale.
  if (showing) return state;
  return {
    ...state,
    tabs: state.tabs.map((t) =>
      t.id === state.active
        ? { ...t, history: historyStack(), project: binding?.project() ?? t.project, scroll: scrollRoot()?.scrollTop ?? t.scroll }
        : t,
    ),
  };
}

function persist(): void {
  if (!binding) return;
  const value = JSON.stringify(captureActive());
  // Los de esta ventana (`sessionStorage`: con dos ventanas de la app, cada una vuelve con los suyos al recargar o al
  // retomarse) y los de la última que se usó (`localStorage`: los que vuelven al abrir la app).
  for (const store of ['sessionStorage', 'localStorage'] as const) {
    try {
      window[store].setItem(binding.key, value);
    } catch {
      // Recordar los tabs es una comodidad: sin espacio, valen hasta cerrar la ventana.
    }
  }
}

/**
 * Prende los tabs de un workspace y una cuenta (`key`). La ventana abre en lo que dice su dirección: ese es el tab de
 * ahora (el que estaba elegido, si se cerró ahí; si no, el primero con esa dirección, o uno nuevo al principio).
 */
export function bindTabs(next: Binding): () => void {
  binding = next;
  let saved: TabsState | null = null;
  try {
    saved = readTabs(sessionStorage.getItem(next.key)) ?? readTabs(localStorage.getItem(next.key));
  } catch {
    saved = null;
  }
  const live: AppTab = { id: newId(), history: historyStack(), project: next.project(), scroll: 0 };
  if (!saved) state = { tabs: [live], active: live.id };
  else {
    const where = here();
    const current = (t: AppTab) => t.history.stack[t.history.at] === where;
    const chosen = saved.tabs.find((t) => t.id === saved.active && current(t)) ?? saved.tabs.find(current);
    state = chosen
      ? { tabs: saved.tabs, active: chosen.id }
      : { tabs: [live, ...saved.tabs].slice(0, MAX_TABS), active: live.id };
  }
  const onHide = () => persist();
  window.addEventListener('pagehide', onHide);
  emit();
  return () => {
    window.removeEventListener('pagehide', onHide);
    persist();
    if (binding === next) {
      binding = null;
      state = { tabs: [], active: '' };
      emit();
    }
  };
}

/** Guardar al cambiar de página (lo llama la barra de tabs). */
export function rememberTabs(): void {
  persist();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function snapshot(): TabsState {
  return state;
}

export function useTabs(): TabsState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function tabsState(): TabsState {
  return state;
}

/** Una cosa por vez: abrir, cerrar o cambiar de tab mientras otro cambio rearma el historial espera su turno. */
function queue(job: () => Promise<void>): Promise<void> {
  const run = busy.then(job, job);
  busy = run.catch(() => undefined);
  return run;
}

/** Vuelve a cuánto estaba desplazada la página cuando ya se armó (hasta 2 s; un gesto de la persona lo corta). */
function restoreScroll(top: number): void {
  const root = scrollRoot();
  if (!root) return;
  if (top <= 0) {
    root.scrollTop = 0;
    return;
  }
  const until = performance.now() + 2000;
  let settledAt = 0;
  const stop = () => {
    cancelled = true;
    for (const type of ['wheel', 'touchstart', 'keydown', 'mousedown'] as const) root.removeEventListener(type, stop);
  };
  let cancelled = false;
  for (const type of ['wheel', 'touchstart', 'keydown', 'mousedown'] as const) root.addEventListener(type, stop, { passive: true });
  const step = () => {
    if (cancelled) return;
    const now = performance.now();
    // Recién con el editor armado (al montarse lleva la página arriba de todo) y con alto para llegar.
    const ready = !!root.querySelector('.ProseMirror') || !root.querySelector('.page');
    if (ready && root.scrollHeight - root.clientHeight >= top - 1) {
      if (Math.abs(root.scrollTop - top) > 1) {
        root.scrollTop = top;
        settledAt = now;
      } else if (!settledAt) settledAt = now;
      // Un rato más por si algo de la página la vuelve a mover al terminar de armarse.
      if (now - settledAt > 300) return stop();
    }
    if (now > until) return stop();
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Muestra un tab: rearma el historial de la ventana con el suyo y vuelve a su proyecto y a su desplazamiento. */
async function show(target: AppTab): Promise<void> {
  const path = target.history.stack[target.history.at];
  if (target.project && binding) binding.chooseProject(target.project);
  holdRoute(path);
  showing = true;
  try {
    await rebuildHistory(target.history);
  } finally {
    showing = false;
    releaseRoute();
  }
  restoreScroll(target.scroll);
}

/** Cambia al tab `id`. */
export function switchTab(id: string): Promise<void> {
  return queue(async () => {
    if (!binding || id === state.active) return;
    const target = state.tabs.find((t) => t.id === id);
    if (!target) return;
    state = { ...captureActive(), active: id };
    emit();
    await show(target);
    persist();
  });
}

/** El tab siguiente (`1`) o el anterior (`-1`), dando la vuelta. */
export function stepTab(delta: 1 | -1): Promise<void> {
  const { tabs, active } = state;
  if (tabs.length < 2) return Promise.resolve();
  const i = tabs.findIndex((t) => t.id === active);
  return switchTab(tabs[(i + delta + tabs.length) % tabs.length].id);
}

/**
 * Un tab nuevo con `path` (de fábrica, lo que se ve ahora), al lado del de ahora. `background`: se abre sin dejar el de
 * ahora (Ctrl/⌘+clic o la rueda en un link, como en un navegador).
 */
export function newTab(path: string = here(), options: { background?: boolean } = {}): Promise<void> {
  return queue(async () => {
    if (!binding || state.tabs.length >= MAX_TABS) return;
    const captured = captureActive();
    const tab: AppTab = {
      id: newId(),
      history: { stack: [path], at: 0 },
      project: path === here() ? (binding.project() ?? null) : null,
      scroll: path === here() ? (scrollRoot()?.scrollTop ?? 0) : 0,
    };
    const i = captured.tabs.findIndex((t) => t.id === captured.active);
    const tabs = [...captured.tabs.slice(0, i + 1), tab, ...captured.tabs.slice(i + 1)];
    if (options.background) {
      state = { tabs, active: captured.active };
      emit();
      persist();
      return;
    }
    state = { tabs, active: tab.id };
    emit();
    await show(tab);
    persist();
  });
}

/** Cierra el tab `id` (el de ahora pasa al de la derecha o, si es el último, al de la izquierda). Nunca el único. */
export function closeTab(id: string): Promise<void> {
  return queue(async () => {
    if (!binding || state.tabs.length < 2) return;
    const i = state.tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    if (id !== state.active) {
      state = { ...state, tabs: state.tabs.filter((t) => t.id !== id) };
      emit();
      persist();
      return;
    }
    const next = state.tabs[i + 1] ?? state.tabs[i - 1];
    state = { tabs: state.tabs.filter((t) => t.id !== id), active: next.id };
    emit();
    await show(next);
    persist();
  });
}

/** Si esta ventana tiene los tabs prendidos ahora. */
export function tabsOn(): boolean {
  return !!binding && tabsAvailable();
}

/**
 * Abrir una dirección de la app aparte: en un tab nuevo de fondo si hay tabs; si no, en otra pestaña del navegador
 * (que es otra copia de la app: services.ts la deja tomar el control al usarla).
 */
export function openInNewTab(path: string): boolean {
  if (tabsOn()) {
    void newTab(path, { background: true });
    return true;
  }
  // Con la clave del workspace (`?w=`): la otra pestaña abre esta misma cuenta. Sin ella (un link público, que vive de
  // su `#link=`) no se abre aparte: la pestaña nueva no tendría con qué entrar.
  const origin = documentPageOrigin();
  if (!origin) return false;
  window.open(qualifyPageLink(path, origin), '_blank', 'noopener');
  return true;
}

/** Una dirección de la app (mismo origen, sin `#`), o `null` si el link va a otro lado. */
export function appPath(href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, location.origin);
    if (url.origin !== location.origin || url.pathname.startsWith('/f/') || url.username || url.password) return null;
    // Una página de otro workspace o con la autoridad de un link (`#link=`, `?w=` de otra clave) se abre como siempre.
    const origin = documentPageOrigin();
    const page = origin ? pageLink(href, origin) : null;
    if (page && !page.own) return null;
    return url.pathname + url.search;
  } catch {
    return null;
  }
}

