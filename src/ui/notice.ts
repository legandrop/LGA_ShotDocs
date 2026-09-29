import { useEffect, useState } from 'react';

const EVENT = 'shotdocs:notice';

/** Muestra un aviso corto al usuario (por ejemplo, una imagen que no se puede agregar). */
export function notify(message: string): void {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: message }));
}

export function useNotice(): [string | null, () => void] {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onNotice = (e: Event) => {
      setMessage((e as CustomEvent<string>).detail);
      clearTimeout(timer);
      timer = setTimeout(() => setMessage(null), 6000);
    };
    window.addEventListener(EVENT, onNotice);
    return () => {
      window.removeEventListener(EVENT, onNotice);
      clearTimeout(timer);
    };
  }, []);
  return [message, () => setMessage(null)];
}
