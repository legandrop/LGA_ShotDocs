// El número de menciones sin leer fuera de la app (P.21, entrega 2; Docs/Doc_Menciones.md, sección 9): en el título
// de la pestaña, `(3) Plan de rodaje · Shot Docs`, y en el ícono de la app instalada (`navigator.setAppBadge`). Lo
// pone la campana; el título de cada página lo pone `PageView` con `setDocumentTitle`.
//
// Si otro toma el título un rato (imprimir pone el nombre del PDF; las páginas legales y la práctica, el suyo), el
// número no lo pisa: vuelve a escribirse cuando la página pone su título otra vez o el título vuelve a ser el nuestro.

let base: string | null = null;
let count = 0;
let written: string | null = null;

/** Como la campana: 1 a 9, y 9+ desde 10 (la base cuenta hasta 10). */
export function badgeText(n: number): string {
  return n >= 10 ? '9+' : String(n);
}

/** El título con el número adelante, o tal cual sin menciones sin leer. */
export function titleWith(title: string, n: number): string {
  return n > 0 ? `(${badgeText(n)}) ${title}` : title;
}

/** El título de la pestaña (sin el número: se lo suma acá). */
export function setDocumentTitle(title: string): void {
  base = title;
  write(true);
}

/** Cuántas menciones sin leer van en el título. */
export function setTitleCount(n: number): void {
  if (n === count) return;
  count = n;
  write(false);
}

function write(force: boolean): void {
  if (typeof document === 'undefined') return;
  if (!force && written !== null && document.title !== written) return;
  if (base === null) base = document.title;
  const next = titleWith(base, count);
  written = next;
  if (document.title !== next) document.title = next;
}

type BadgeNavigator = Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

/**
 * El número en el ícono de la app instalada (Chrome y Edge en la computadora, Safari en el iPhone con la app en la
 * pantalla de inicio). Desde 10, la marca sin número (como 9+: la base no cuenta más). Donde no existe, nada.
 */
export function setAppBadge(n: number): void {
  if (typeof navigator === 'undefined') return;
  const nav = navigator as BadgeNavigator;
  try {
    const done = n <= 0 ? nav.clearAppBadge?.() : n >= 10 ? nav.setAppBadge?.() : nav.setAppBadge?.(n);
    // En una pestaña común (sin instalar) o sin permiso, el navegador lo rechaza: no es un error de la app.
    done?.catch(() => undefined);
  } catch {
    // Igual que arriba.
  }
}

/** Solo para las pruebas: vuelve al estado de arranque. */
export function resetTitleBadge(): void {
  base = null;
  count = 0;
  written = null;
}
