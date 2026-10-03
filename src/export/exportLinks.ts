import type { SupabaseClient } from '@supabase/supabase-js';
import { getPublicLink, type LinkLevel } from '../sync/publicLinks';
import { timed, toRemoteError } from '../sync/remote';

// Los links a los archivos en un PDF exportado con un link público (P.30, Docs/Doc_Links_PDF.md, 3.3, LF17 y LF18).
// Solo desde la ventana *Export* (imprimir una página nunca pone un token). Para cada página que sale se busca hacia arriba
// (ella misma o una de arriba) el link público vivo más cercano de nivel *Can view*; uno *Can edit* solo si no hay
// ninguno *Can view* (y entonces la casilla viene destildada). Solo quien puede compartir la página del link recibe su
// token (`get_public_link`): quien no, exporta con la dirección de siempre (`#ws=`).

/** Un link público que usan los archivos de una o más páginas del PDF. */
export interface FileLinkChoice {
  /** La página del link. */
  pageId: string;
  title: string;
  level: LinkLevel;
  expiresAt: string | null;
  token: string;
}

export interface FileLinkPlan {
  /** Página exportada → el link que usan sus archivos. */
  byPage: Map<string, FileLinkChoice>;
  /** Los links que se usan, sin repetir (para el aviso). */
  links: FileLinkChoice[];
}

/** Tope de links que se le preguntan a la base por exportación (cada uno es un pedido). */
export const MAX_LINK_LOOKUPS = 40;

/**
 * Elige el link de cada página (sin red). `parentOf`: la página de arriba, o `null`. `links`: los links vivos con token,
 * por página.
 */
export function chooseFileLinks(
  pageIds: string[],
  parentOf: (id: string) => string | null,
  links: ReadonlyMap<string, FileLinkChoice>,
): FileLinkPlan {
  const byPage = new Map<string, FileLinkChoice>();
  for (const id of pageIds) {
    let view: FileLinkChoice | null = null;
    let edit: FileLinkChoice | null = null;
    const seen = new Set<string>();
    for (let at: string | null = id; at && !seen.has(at) && !view; at = parentOf(at)) {
      seen.add(at);
      const link = links.get(at);
      if (!link) continue;
      if (link.level === 'comment') view = link;
      else edit ??= link;
    }
    const chosen = view ?? edit;
    if (chosen) byPage.set(id, chosen);
  }
  return { byPage, links: [...new Set(byPage.values())] };
}

/**
 * Pregunta a la base qué links públicos usar. `null` si no se pudo (sin red, base sin links públicos): entonces el PDF va
 * con la dirección de siempre.
 */
export async function loadFileLinks(
  client: SupabaseClient,
  pageIds: string[],
  parentOf: (id: string) => string | null,
  titleOf: (id: string) => string,
): Promise<FileLinkPlan | null> {
  let withLinks: Set<string>;
  try {
    const { data, error, status } = await timed(client.rpc('public_link_pages'));
    if (error) throw toRemoteError(error, status);
    withLinks = new Set(((data as { page_id: string }[] | null) ?? []).map((r) => r.page_id));
  } catch {
    return null;
  }
  if (withLinks.size === 0) return { byPage: new Map(), links: [] };
  // Las páginas con link en el camino de cada una (ella o las de arriba): una vez por rama, no una vez por página.
  const needed = new Set<string>();
  for (const id of pageIds) {
    const seen = new Set<string>();
    for (let at: string | null = id; at && !seen.has(at); at = parentOf(at)) {
      seen.add(at);
      if (withLinks.has(at)) needed.add(at);
    }
  }
  const links = new Map<string, FileLinkChoice>();
  for (const pageId of [...needed].slice(0, MAX_LINK_LOOKUPS)) {
    try {
      const info = await getPublicLink(client, pageId);
      const link = info?.link;
      if (!link?.token || !link.alive) continue;
      links.set(pageId, { pageId, title: titleOf(pageId), level: link.level, expiresAt: link.expires_at, token: link.token });
    } catch {
      // Sin ese link: sus páginas van con la dirección de siempre.
    }
  }
  return chooseFileLinks(pageIds, parentOf, links);
}
