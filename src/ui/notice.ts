import { useEffect, useState } from 'react';

const EVENT = 'shotdocs:notice';
/** Un aviso con un botón (por ejemplo, **Undo** después de restaurar una versión). */
const ACTION_EVENT = 'shotdocs:notice-action';
/** Quita un aviso con botón que dejó de valer (con su `key`). */
const DISMISS_EVENT = 'shotdocs:notice-dismiss';

/** Muestra un aviso corto al usuario (por ejemplo, una imagen que no se puede agregar). */
export function notify(message: string): void {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: message }));
}

export interface NoticeAction {
  /** Para quitarlo desde afuera (`dismissNotice`). */
  key: string;
  label: string;
  run: () => void;
}

/** Un aviso con un botón: dura más que uno común (12 s) y se puede quitar con `dismissNotice(key)`. */
export function notifyWithAction(message: string, action: NoticeAction): void {
  window.dispatchEvent(new CustomEvent<{ message: string; action: NoticeAction }>(ACTION_EVENT, { detail: { message, action } }));
}

/** Quita el aviso con ese botón, si es el que está a la vista. */
export function dismissNotice(key: string): void {
  window.dispatchEvent(new CustomEvent<string>(DISMISS_EVENT, { detail: key }));
}

export function useNotice(): [string | null, () => void, NoticeAction | null] {
  const [notice, setNotice] = useState<{ message: string; action: NoticeAction | null } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = (message: string, action: NoticeAction | null) => {
      setNotice({ message, action });
      clearTimeout(timer);
      timer = setTimeout(() => setNotice(null), action ? 12000 : 6000);
    };
    const onNotice = (e: Event) => show((e as CustomEvent<string>).detail, null);
    const onAction = (e: Event) => {
      const { message, action } = (e as CustomEvent<{ message: string; action: NoticeAction }>).detail;
      show(message, action);
    };
    const onDismiss = (e: Event) => {
      const key = (e as CustomEvent<string>).detail;
      setNotice((n) => (n?.action?.key === key ? null : n));
    };
    window.addEventListener(EVENT, onNotice);
    window.addEventListener(ACTION_EVENT, onAction);
    window.addEventListener(DISMISS_EVENT, onDismiss);
    return () => {
      window.removeEventListener(EVENT, onNotice);
      window.removeEventListener(ACTION_EVENT, onAction);
      window.removeEventListener(DISMISS_EVENT, onDismiss);
      clearTimeout(timer);
    };
  }, []);
  return [notice?.message ?? null, () => setNotice(null), notice?.action ?? null];
}
