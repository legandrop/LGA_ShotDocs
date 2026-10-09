import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const EVENT = 'shotdocs:notice';
/** Quita un aviso con botón que dejó de valer (por su `key`). */
const DISMISS_EVENT = 'shotdocs:notice-dismiss';

/** Un botón en el aviso (por ejemplo *Undo* después de reemplazar en todo el proyecto, o de restaurar una versión). */
export interface NoticeAction {
  label: string;
  run: () => void;
  /** Para quitarlo desde afuera cuando deja de valer (`dismissNotice`): el **Undo** de restaurar, con la próxima edición. */
  key?: string;
  /**
   * El botón es la única forma de recuperar algo que no está en ningún otro lado (lo tipeado en un comentario que se
   * cerró solo): ningún otro aviso lo saca de la vista antes de su tiempo; los que llegan esperan su turno.
   */
  keep?: boolean;
}

export interface NoticeDetail {
  message: string;
  action?: NoticeAction;
  /** Un segundo botón (por ejemplo *Show* junto a *Redo* al deshacer un reemplazo con páginas que habían cambiado). */
  second?: NoticeAction;
}

/** Cuánto queda a la vista un aviso; uno con un botón, más (hay que llegar a tocarlo). */
export const NOTICE_MS = 6000;
export const ACTION_NOTICE_MS = 15000;
/** Cuántos avisos esperan, como mucho, detrás de uno que guarda algo, sin contar los que también guardan algo. */
export const WAITING_MAX = 3;
/**
 * Con el mouse (o el foco) encima, un aviso no vence (D712): al soltarlo queda lo que le quedaba, y al menos esto, para
 * llegar a tocar un botón que se acaba de ver (el *Undo* de *Assign* o del reporte de mañana es la única forma de volver).
 */
export const RESUME_MS = 4000;

/** Muestra un aviso corto al usuario (por ejemplo, una imagen que no se puede agregar), con un botón opcional. */
export function notify(message: string, action?: NoticeAction, second?: NoticeAction): void {
  // Sin botón, el texto solo (como siempre: quien escucha el evento lee el texto).
  const detail: NoticeDetail | string = action || second ? { message, action: action ?? second, second: action ? second : undefined } : message;
  window.dispatchEvent(new CustomEvent<NoticeDetail | string>(EVENT, { detail }));
}

/** Quita el aviso con el botón de esa `key`, esté a la vista o esperando su turno. */
export function dismissNotice(key: string): void {
  window.dispatchEvent(new CustomEvent<string>(DISMISS_EVENT, { detail: key }));
}

// Cuántas pantallas montadas dibujan el aviso (hoy una: `Shell`). Sin ninguna, un aviso no lo ve nadie: quien tiene
// algo que no se puede perder (lo tipeado en un comentario, commentsUi.ts) lo mira antes de confiar en el aviso.
let hosts = 0;

/** Si hay una pantalla montada que dibuja los avisos. */
export function noticeVisible(): boolean {
  return hosts > 0;
}

// --- El orden de los avisos (D356 a D358) ---------------------------------------------------------------------------
// La pantalla muestra un aviso a la vez. Antes, el que llegaba reemplazaba al que estaba, y uno con botón perdía el
// botón antes de sus 15 segundos. Las reglas (`place`):
//  1. A uno que guarda algo (`keep`: el *Copy text* de un comentario cerrado) no lo saca nadie: lo que llega espera
//     (D356).
//  2. Uno sin botón que llega sobre uno con botón se muestra ya (suele ser la respuesta a una tecla), y el del botón
//     vuelve después, con lo que le quedaba (al menos 6 segundos) (D357).
//  3. En lo demás, el que llega reemplaza: uno con botón a otro con botón (*Undo* y después *Redo*, *Next*), uno sin
//     botón a otro sin botón.
// Lo que espera detrás de uno que guarda algo se muestra solo si esperó menos de lo que iba a estar a la vista (pasado
// ese tiempo ya no viene a cuento: era de otra página, de otra tecla) y, como mucho, los últimos `WAITING_MAX`. Los que
// guardan algo no vencen esperando (D358).

interface Waiting {
  detail: NoticeDetail;
  /** Cuánto va a estar a la vista. */
  ms: number;
  /** Hasta cuándo vale la pena mostrarlo; `null`: siempre (guarda algo, o es uno con botón que vuelve). */
  deadline: number | null;
}

export interface NoticeState {
  shown: { detail: NoticeDetail; until: number } | null;
  waiting: readonly Waiting[];
}

export const NO_NOTICE: NoticeState = { shown: null, waiting: [] };

const keeps = (d: NoticeDetail) => !!d.action?.keep;
const lifetime = (d: NoticeDetail) => (d.action ? ACTION_NOTICE_MS : NOTICE_MS);

/** Llega un aviso. */
export function arrive(state: NoticeState, detail: NoticeDetail, now: number): NoticeState {
  return place(state, { detail, ms: lifetime(detail), deadline: keeps(detail) ? null : now + lifetime(detail) }, now);
}

function place(state: NoticeState, next: Waiting, now: number): NoticeState {
  const { shown } = state;
  const show = { detail: next.detail, until: now + next.ms };
  if (shown && keeps(shown.detail)) {
    // Regla 1. Esperan todos los que guardan algo; de los demás, los últimos.
    const others = state.waiting.filter((w) => !keeps(w.detail));
    const extra = keeps(next.detail) ? 0 : Math.max(0, others.length + 1 - WAITING_MAX);
    const gone = new Set(others.slice(0, extra));
    return { shown, waiting: [...state.waiting.filter((w) => !gone.has(w)), next] };
  }
  if (shown?.detail.action && !next.detail.action) {
    // Regla 2.
    return { shown: show, waiting: [{ detail: shown.detail, ms: Math.max(shown.until - now, NOTICE_MS), deadline: null }] };
  }
  // Regla 3. Uno con botón deja sin efecto al que esperaba para volver; uno sin botón solo reemplaza al que está.
  return { shown: show, waiting: next.detail.action ? [] : state.waiting };
}

/** El aviso a la vista terminó (venció, o lo cerraron): pasa el que sigue. */
export function advance(state: NoticeState, now: number): NoticeState {
  // Primero los que guardan algo, en el orden en que llegaron; después los demás, con las mismas reglas.
  const live = state.waiting.filter((w) => w.deadline === null || w.deadline > now);
  const order = [...live.filter((w) => keeps(w.detail)), ...live.filter((w) => !keeps(w.detail))];
  return order.reduce((s, w) => place(s, w, now), NO_NOTICE);
}

/** Quita el aviso con el botón de esa `key`, esté a la vista o esperando. */
export function withoutKey(state: NoticeState, key: string, now: number): NoticeState {
  const has = (d: NoticeDetail) => d.action?.key !== undefined && d.action.key === key;
  const waiting = state.waiting.filter((w) => !has(w.detail));
  if (state.shown && has(state.shown.detail)) return advance({ shown: null, waiting }, now);
  return waiting.length === state.waiting.length ? state : { shown: state.shown, waiting };
}

/**
 * Para el `ref` de un aviso de abajo: anota el lugar que ocupa (su alto más `gap`, la separación hasta el de arriba) en
 * la variable `name` del elemento que lo contiene (la app) o de la raíz (los de un link, que van afuera de la app), y
 * los de arriba se corren con él (styles.css). Sin el aviso, la variable no está. Se crea una vez por aviso (fuera del
 * componente): un `ref` nuevo en cada dibujo la sacaría y la volvería a poner.
 */
export function followHeight(name: string, gap: number, where: 'parent' | 'root'): (el: HTMLElement | null) => (() => void) | undefined {
  return (el) => {
    const target = where === 'root' ? document.documentElement : el?.parentElement;
    if (!el || !target) return undefined;
    const set = () => target.style.setProperty(name, `${el.offsetHeight + gap}px`);
    set();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(set) : null;
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      target.style.removeProperty(name);
    };
  };
}

/** Quién sostiene el aviso: un mouse encima (no un toque: en el teléfono sigue corriendo) o el foco del teclado. */
export type HoldSource = 'mouse' | 'focus';

/**
 * El aviso a la vista: el texto, cerrarlo, su botón (si tiene), el segundo y `hold`: con `true` (el mouse o el foco encima)
 * el aviso no vence; con `false` en los dos, sigue con lo que le quedaba, al menos `RESUME_MS`.
 */
export function useNotice(): [string | null, () => void, NoticeAction | undefined, NoticeAction | undefined, (source: HoldSource, on: boolean) => void] {
  const [state, setState] = useState<NoticeState>(NO_NOTICE);
  // El mouse y el foco sostienen por separado: soltar uno no libera si el otro sigue (D717).
  const [heldBy, setHeldBy] = useState<Record<HoldSource, boolean>>({ mouse: false, focus: false });
  const held = heldBy.mouse || heldBy.focus;
  // Lo que le quedaba al aviso a la vista cuando se lo pausó.
  const paused = useRef<{ of: NoticeState['shown']; left: number } | null>(null);
  const hold = useCallback((source: HoldSource, on: boolean) => setHeldBy((s) => (s[source] === on ? s : { ...s, [source]: on })), []);
  // Se anota al montarse y se borra al desmontarse en el mismo paso en que se desmonta lo de adentro (un cuadro de
  // comentario avisa que se cerró en ese paso): quien pregunta después ya ve si quedó alguien para dibujar el aviso.
  useLayoutEffect(() => {
    hosts++;
    return () => {
      hosts--;
    };
  }, []);
  useEffect(() => {
    const onNotice = (e: Event) => {
      const detail = (e as CustomEvent<NoticeDetail | string>).detail;
      setState((s) => arrive(s, typeof detail === 'string' ? { message: detail } : detail, Date.now()));
    };
    const onDismiss = (e: Event) => {
      const key = (e as CustomEvent<string>).detail;
      setState((s) => withoutKey(s, key, Date.now()));
    };
    window.addEventListener(EVENT, onNotice);
    window.addEventListener(DISMISS_EVENT, onDismiss);
    return () => {
      window.removeEventListener(EVENT, onNotice);
      window.removeEventListener(DISMISS_EVENT, onDismiss);
    };
  }, []);
  // El reloj del que está a la vista: al vencer pasa el que sigue (si otro lo reemplazó mientras tanto, no hace nada).
  const shown = state.shown;
  useEffect(() => {
    if (!shown) {
      // Sin aviso no hay nada encima: un `mouseleave` que nunca llega (el aviso se desmontó con el mouse encima) no traba el siguiente.
      paused.current = null;
      setHeldBy((s) => (s.mouse || s.focus ? { mouse: false, focus: false } : s));
      return undefined;
    }
    if (held) {
      if (paused.current?.of !== shown) paused.current = { of: shown, left: Math.max(0, shown.until - Date.now()) };
      return undefined;
    }
    const left = paused.current?.of === shown ? paused.current.left : null;
    paused.current = null;
    const wait = left === null ? Math.max(0, shown.until - Date.now()) : Math.max(left, RESUME_MS);
    const timer = setTimeout(() => setState((s) => (s.shown === shown ? advance(s, Date.now()) : s)), wait);
    return () => clearTimeout(timer);
  }, [shown, held]);
  const detail = shown?.detail;
  return [detail?.message ?? null, () => setState((s) => advance(s, Date.now())), detail?.action, detail?.second, hold];
}
