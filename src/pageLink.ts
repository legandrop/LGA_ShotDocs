import { parseRoute } from './router';
import { validLocalKey } from './workspaces';

/** Identidad de la página que contiene el enlace; nunca incluye sesión ni backend. */
export interface PageLinkOrigin { readonly appOrigin: string; readonly localKey: string }
export type WorkspaceSelector = { kind: 'absent' } | { kind: 'invalid' } | { kind: 'workspace'; key: string };

export function workspaceSelector(search: string): WorkspaceSelector {
  const values = new URLSearchParams(search).getAll('w');
  if (!values.length) return { kind: 'absent' };
  return values.length === 1 && validLocalKey(values[0]) ? { kind: 'workspace', key: values[0] } : { kind: 'invalid' };
}

export function pageLink(href: string, origin: PageLinkOrigin): { url: URL; id: string; selector: WorkspaceSelector; own: boolean } | null {
  if (!href || href.length > 4000) return null;
  try {
    const url = new URL(href, origin.appOrigin);
    const route = parseRoute(url.pathname);
    if (url.origin !== origin.appOrigin || url.username || url.password || route.name !== 'page') return null;
    const selector = workspaceSelector(url.search);
    const authority = /^#(?:link|invite|ws)=/.test(url.hash);
    return { url, id: route.id.toLowerCase(), selector, own: !authority && (selector.kind === 'absent' || (selector.kind === 'workspace' && selector.key === origin.localKey)) };
  } catch { return null; }
}

/** Conserva parámetros y fragmento; sólo agrega identidad a una referencia propia legacy. */
export function qualifyPageLink(href: string, origin: PageLinkOrigin): string {
  const link = pageLink(href, origin);
  if (!link?.own || link.selector.kind !== 'absent' || !validLocalKey(origin.localKey)) return href;
  link.url.searchParams.set('w', origin.localKey);
  return link.url.href;
}
