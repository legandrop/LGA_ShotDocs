import { navigate, pagePath, parseRoute } from '../router';

// Links a otras páginas de la app (`/p/<id>`, o la dirección entera de la app): por ejemplo los que deja la
// importación de Coda entre sus páginas, o una dirección de página pegada en el texto. Un clic abre la
// página en la misma pestaña, sin recargar la app; ⌘/Ctrl+clic (o Shift, o el botón del medio) sigue
// abriéndola en otra pestaña, como cualquier link.

/** La página a la que va un link de la app, o null si es un link a otro lado. */
export function internalPageId(href: string | null | undefined, origin = location.origin): string | null {
  if (!href) return null;
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  const route = parseRoute(url.pathname);
  return route.name === 'page' ? route.id : null;
}

/**
 * Un clic simple en un link a una página de la app: la abre acá (sin recargar) en vez de seguir el link.
 * Devuelve si lo tomó. Con la página de solo lectura se usa en el `click` (en captura): el editor no maneja
 * los links y el navegador abriría otra pestaña.
 */
export function followInternalLink(e: Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'target' | 'preventDefault' | 'stopPropagation'>): boolean {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const target = e.target instanceof Element ? e.target : null;
  const link = target?.closest('a[href]');
  if (!link) return false;
  const id = internalPageId(link.getAttribute('href'));
  if (!id) return false;
  e.preventDefault();
  e.stopPropagation();
  navigate(pagePath(id));
  return true;
}

/**
 * El clic en un link del editor mientras se edita (la opción `links.onClick` de BlockNote, que se dispara al
 * soltar el botón, antes del `click`): una página de la app, acá; cualquier otro, en otra pestaña, como hace
 * el editor sin este manejo.
 */
export function editorLinkClick(e: MouseEvent): boolean {
  const target = e.target instanceof Element ? e.target : null;
  const link = target?.closest<HTMLAnchorElement>('a[href]');
  if (!link) return false;
  if (followInternalLink(e)) return true;
  window.open(link.href, link.target || '_blank', 'noopener,noreferrer');
  return true;
}
