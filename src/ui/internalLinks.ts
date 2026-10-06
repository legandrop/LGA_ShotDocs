import { navigate, pagePath, parseRoute } from '../router';
import { pageLink, type PageLinkOrigin } from '../pageLink';
import { LOGICAL_PAGE_HREF } from './pageLinkView';

export interface PageLinkContext {
  readonly origin: PageLinkOrigin;
  readonly publicMode: boolean;
  root: () => HTMLElement | null;
  current: () => boolean;
  leave: (action: () => void, current: () => boolean) => void;
}
export const pageLinkNavigation = { assign: (href: string): void => location.assign(href) };

// Links a otras páginas de la app (`/p/<id>`, o la dirección entera de la app): por ejemplo los que deja la
// importación de Coda entre sus páginas, o una dirección de página pegada en el texto. Un clic abre la
// página en la misma pestaña, sin recargar la app; ⌘/Ctrl+clic sigue abriéndola en otra pestaña, como
// cualquier link. Mientras se edita, Shift+clic extiende la selección (el editor no lo trata como clic en el
// link); en una página de solo lectura, Shift+clic y el botón del medio los resuelve el navegador.

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
  // El árbol guarda los ids en minúsculas; un link pegado a mano puede venir en mayúsculas.
  return route.name === 'page' ? route.id.toLowerCase() : null;
}

/**
 * Un clic simple en un link a una página de la app: la abre acá (sin recargar) en vez de seguir el link.
 * Devuelve si lo tomó. Con la página de solo lectura se usa en el `click` (en captura): el editor no maneja
 * los links y el navegador abriría otra pestaña.
 */
export function followInternalLink(e: Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'target' | 'preventDefault' | 'stopPropagation'>, context?: PageLinkContext): boolean {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const target = e.target instanceof Element ? e.target : null;
  const link = target?.closest('a[href]');
  if (!link) return false;
  if (context) {
    const root = context.root();
    if (!root?.contains(link)) return false;
    const visible = link.getAttribute('href');
    const logical = link.getAttribute(LOGICAL_PAGE_HREF);
    const href = logical ?? visible;
    const resolved = href ? pageLink(href, context.origin) : null;
    if (!resolved) return false;
    e.preventDefault(); e.stopPropagation();
    const address = location.href;
    const current = () => context.current() && root.isConnected && root.contains(link) &&
      link.getAttribute('href') === visible && link.getAttribute(LOGICAL_PAGE_HREF) === logical && location.href === address;
    if (!current()) return true;
    const accountExit = context.publicMode && resolved.selector.kind !== 'absent';
    if (resolved.own && !accountExit) {
      navigate(resolved.url.pathname + resolved.url.search + resolved.url.hash);
    } else {
      context.leave(() => { if (current()) pageLinkNavigation.assign(resolved.url.href); }, current);
    }
    return true;
  }
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
export function editorLinkClick(e: MouseEvent, context?: PageLinkContext): boolean {
  if (e.defaultPrevented) return true;
  if (e.button !== 0 || e.shiftKey || e.altKey) return false;
  const target = e.target instanceof Element ? e.target : null;
  const link = target?.closest<HTMLAnchorElement>('a[href]');
  if (!link) return false;
  if (context && (!context.current() || !context.root()?.contains(link))) { e.preventDefault(); return true; }
  if (followInternalLink(e, context)) return true;
  window.open(link.href, link.target || '_blank', 'noopener,noreferrer');
  return true;
}
