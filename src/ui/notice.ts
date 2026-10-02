import { useEffect, useState } from 'react';

const EVENT = 'shotdocs:notice';

/** Un botón en el aviso (por ejemplo *Undo* después de reemplazar en todo el proyecto). */
export interface NoticeAction {
  label: string;
  run: () => void;
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
    window.addEventListener(EVENT, onNotice);
    return () => {
      window.removeEventListener(EVENT, onNotice);
      clearTimeout(timer);
    };
  }, []);
  return [notice?.message ?? null, () => setNotice(null), notice?.action];
}
