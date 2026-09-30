import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'page'; id: string }
  | { name: 'trash' }
  // Pantalla de prueba del portero de archivos (subir y ver videos desde el teléfono).
  | { name: 'media-test' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT = 'shotdocs:navigate';

export function parseRoute(pathname: string): Route {
  const page = /^\/p\/([^/]+)\/?$/.exec(pathname)?.[1];
  if (page && UUID.test(page)) return { name: 'page', id: page };
  if (pathname === '/trash') return { name: 'trash' };
  if (pathname === '/media-test') return { name: 'media-test' };
  return { name: 'home' };
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
