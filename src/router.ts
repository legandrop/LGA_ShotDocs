import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'page'; id: string }
  | { name: 'trash' }
  // Política de privacidad y condiciones de uso: públicas, se ven sin sesión y sin workspace (Google las pide
  // para la pantalla de consentimiento).
  | { name: 'privacy' }
  | { name: 'terms' };

export const PRIVACY_PATH = '/privacy';
export const TERMS_PATH = '/terms';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT = 'shotdocs:navigate';

export function parseRoute(pathname: string): Route {
  const page = /^\/p\/([^/]+)\/?$/.exec(pathname)?.[1];
  if (page && UUID.test(page)) return { name: 'page', id: page };
  if (pathname === '/trash') return { name: 'trash' };
  if (pathname === PRIVACY_PATH || pathname === PRIVACY_PATH + '/') return { name: 'privacy' };
  if (pathname === TERMS_PATH || pathname === TERMS_PATH + '/') return { name: 'terms' };
  return { name: 'home' };
}

/** Las direcciones que se muestran sin sesión ni workspace: la app no crea ningún cliente para ellas. */
export type PublicRoute = Extract<Route, { name: 'privacy' | 'terms' }>;

export function isPublicRoute(route: Route): route is PublicRoute {
  return route.name === 'privacy' || route.name === 'terms';
}

export function pagePath(id: string): string {
  return `/p/${id}`;
}

export function navigate(path: string, replace = false): void {
  if (path === location.pathname) return;
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(fn: () => void): () => void {
  window.addEventListener('popstate', fn);
  window.addEventListener(EVENT, fn);
  return () => {
    window.removeEventListener('popstate', fn);
    window.removeEventListener(EVENT, fn);
  };
}

export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, () => location.pathname);
  return parseRoute(pathname);
}
