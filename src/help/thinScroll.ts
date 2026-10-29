import { useEffect, useRef, type MouseEvent } from 'react';

// La barra de desplazamiento fina de la barra lateral (styles.css, `.sidebar-scroll`; Sidebar.tsx, `useScrollbarReveal`),
// para las partes de la ayuda que se desplazan (`.help-scroll`, help.css): escondida, aparece mientras el mouse está en
// su franja y mientras se desplaza, y se va sola un rato después. Se toca la clase directamente: un mouse que se mueve
// no redibuja la ayuda. Es una copia de la de Sidebar.tsx (que no la exporta): si cambia una, cambia la otra.

/** El ancho de la franja de la barra, desde el borde derecho, donde el mouse la hace aparecer. */
const ZONE = 14;
/** Cuánto sigue a la vista después de desplazar o de salir de su franja. */
const LINGER_MS = 900;

export function useThinScroll() {
  const near = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const el = useRef<HTMLElement | null>(null);
  const show = (on: boolean) => el.current?.classList.toggle('show-scrollbar', on);
  const hideLater = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => show(near.current), LINGER_MS);
  };
  useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);
  return {
    onScroll: (e: { currentTarget: HTMLElement }) => {
      el.current = e.currentTarget;
      show(true);
      hideLater();
    },
    onMouseMove: (e: MouseEvent<HTMLElement>) => {
      el.current = e.currentTarget;
      const was = near.current;
      near.current = e.clientX >= e.currentTarget.getBoundingClientRect().right - ZONE;
      if (near.current) show(true);
      else if (was) hideLater();
    },
    onMouseLeave: () => {
      near.current = false;
      hideLater();
    },
  };
}
