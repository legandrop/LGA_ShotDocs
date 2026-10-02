import { useEffect, useState } from 'react';

const EVENT = 'shotdocs:notice';
/** Quita un aviso con botón que dejó de valer (por su `key`). */
const DISMISS_EVENT = 'shotdocs:notice-dismiss';

/** Un botón en el aviso (por ejemplo *Undo* después de reemplazar en todo el proyecto, o de restaurar una versión). */
export interface NoticeAction {
  label: string;
  run: () => void;
  /** Para quitarlo desde afuera cuando deja de valer (`dismissNotice`): el **Undo** de restaurar, con la próxima edición. */
  key?: string;
}

interface NoticeDetail {
  message: string;
  action?: NoticeAction;
}

/** Cuánto queda a la vista un aviso; uno con un botón, más (hay que llegar a tocarlo). */
const NOTICE_MS = 6000;
const ACTION_NOTICE_MS = 15000;

/** Muestra un aviso corto al usuario (por ejemplo, una imagen que no se puede agregar), con un botón opcional. */
export function notify(message: string, action?: NoticeAction): void {
  // Sin botón, el texto solo (como siempre: quien escucha el evento lee el texto).
  window.dispatchEvent(new CustomEvent<NoticeDetail | string>(EVENT, { detail: action ? { message, action } : message }));
}

/** Quita el aviso con el botón de esa `key`, si es el que está a la vista. */
export function dismissNotice(key: string): void {
  window.dispatchEvent(new CustomEvent<string>(DISMISS_EVENT, { detail: key }));
}

/** El aviso a la vista: el texto, su botón (si tiene) y cerrarlo. */
export function useNotice(): [string | null, () => void, NoticeAction | undefined] {
  const [notice, setNotice] = useState<NoticeDetail | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onNotice = (e: Event) => {
      const detail = (e as CustomEvent<NoticeDetail | string>).detail;
      const next = typeof detail === 'string' ? { message: detail } : detail;
      setNotice(next);
      clearTimeout(timer);
      timer = setTimeout(() => setNotice(null), next.action ? ACTION_NOTICE_MS : NOTICE_MS);
    };
    const onDismiss = (e: Event) => {
      const key = (e as CustomEvent<string>).detail;
      setNotice((n) => (n?.action?.key !== undefined && n.action.key === key ? null : n));
    };
    window.addEventListener(EVENT, onNotice);
    window.addEventListener(DISMISS_EVENT, onDismiss);
    return () => {
      window.removeEventListener(EVENT, onNotice);
      window.removeEventListener(DISMISS_EVENT, onDismiss);
      clearTimeout(timer);
    };
  }, []);
  return [notice?.message ?? null, () => setNotice(null), notice?.action];
}
