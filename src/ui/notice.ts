import { useEffect, useLayoutEffect, useState } from 'react';

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
  /** Un segundo botón (por ejemplo *Show* junto a *Redo* al deshacer un reemplazo con páginas que habían cambiado). */
  second?: NoticeAction;
}

/** Cuánto queda a la vista un aviso; uno con un botón, más (hay que llegar a tocarlo). */
const NOTICE_MS = 6000;
const ACTION_NOTICE_MS = 15000;

/** Muestra un aviso corto al usuario (por ejemplo, una imagen que no se puede agregar), con un botón opcional. */
export function notify(message: string, action?: NoticeAction, second?: NoticeAction): void {
  // Sin botón, el texto solo (como siempre: quien escucha el evento lee el texto).
  const detail: NoticeDetail | string = action || second ? { message, action: action ?? second, second: action ? second : undefined } : message;
  window.dispatchEvent(new CustomEvent<NoticeDetail | string>(EVENT, { detail }));
}

/** Quita el aviso con el botón de esa `key`, si es el que está a la vista. */
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

/** El aviso a la vista: el texto, cerrarlo, su botón (si tiene) y el segundo. */
export function useNotice(): [string | null, () => void, NoticeAction | undefined, NoticeAction | undefined] {
  const [notice, setNotice] = useState<NoticeDetail | null>(null);
  // Se anota al montarse y se borra al desmontarse en el mismo paso en que se desmonta lo de adentro (un cuadro de
  // comentario avisa que se cerró en ese paso): quien pregunta después ya ve si quedó alguien para dibujar el aviso.
  useLayoutEffect(() => {
    hosts++;
    return () => {
      hosts--;
    };
  }, []);
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
  return [notice?.message ?? null, () => setNotice(null), notice?.action, notice?.second];
}
