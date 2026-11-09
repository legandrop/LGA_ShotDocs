import { flushSync } from 'react-dom';

// Las acciones de cada renglón del selector de proyectos (v0.329) están en su menú ⋯ y ese menú solo existe abierto: estos
// ayudantes lo abren antes de buscar el botón, para que las pruebas pidan «Archive “X”» como siempre. Con `flushSync`,
// porque también se llaman adentro de un `act(async () => …)`.

/** Abre el menú ⋯ del proyecto `name`; `null` si ese renglón no tiene ⋯ (nada que ofrecerle a la persona). */
export function openRowMenu(name: string): HTMLButtonElement | null {
  const more = document.querySelector<HTMLButtonElement>(`button[aria-label="Actions for “${name}”"], button[aria-label="Acciones de “${name}”"]`);
  if (more && more.getAttribute('aria-expanded') !== 'true') flushSync(() => more.click());
  return more;
}

/**
 * El botón con ese nombre accesible. Si no está a la vista y el nombre trae el de un proyecto («Archive “X”»), abre antes
 * el ⋯ de ese proyecto y lo busca ahí. `null` si no existe.
 */
export function rowLabel(name: string): HTMLButtonElement | null {
  const direct = document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
  if (direct) return direct;
  const who = /“(.+?)”/.exec(name)?.[1];
  if (!who || !openRowMenu(who)) return null;
  return document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
}

/** Abre el menú del botón *New* de arriba del selector (crear y los dos importar); `null` si no hay botón. */
export function openNewMenu(): HTMLButtonElement | null {
  const button = document.querySelector<HTMLButtonElement>('.project-menu .project-new');
  if (button && button.getAttribute('aria-haspopup') === 'menu' && button.getAttribute('aria-expanded') !== 'true') flushSync(() => button.click());
  return button;
}
