import { useT } from '../i18n';
import { useTree } from '../services';
import type { PageTree } from '../sync/tree';
import type { MentionItem } from '../sync/mentions';
import { useInbox } from './MentionsBell';

// El punto de las menciones en el árbol de páginas (P.21, entrega 2; Docs/Doc_Menciones.md, sección 9): lleno en la
// página que tiene una mención sin leer para quien mira; hueco en una madre plegada que la tiene adentro, así se
// encuentra sin abrir todo el árbol. Sale de lo que bajó la campana (sin pedir nada más a la base).

export interface MentionMarks {
  /** Páginas con una mención sin leer. */
  pages: Set<string>;
  /** Las de arriba de esas páginas (para el punto hueco de una madre plegada). */
  inside: Set<string>;
}

const cache = new WeakMap<MentionItem[], { revision: number; marks: MentionMarks }>();

/** Las páginas con menciones sin leer y sus madres; se calcula una vez por cada lista y revisión del árbol. */
export function mentionMarks(items: MentionItem[], tree: Pick<PageTree, 'get' | 'ancestors' | 'getRevision'>): MentionMarks {
  const revision = tree.getRevision();
  const hit = cache.get(items);
  if (hit && hit.revision === revision) return hit.marks;
  const pages = new Set<string>();
  const inside = new Set<string>();
  for (const m of items) {
    if (m.read || pages.has(m.pageId) || !tree.get(m.pageId)) continue;
    pages.add(m.pageId);
    for (const p of tree.ancestors(m.pageId)) inside.add(p.id);
  }
  const marks = { pages, inside };
  cache.set(items, { revision, marks });
  return marks;
}

/** El punto de una fila del árbol; nada si la página no tiene menciones sin leer (o no hay campana). */
export function MentionTreeDot({ pageId, collapsed }: { pageId: string; collapsed: boolean }) {
  const inbox = useInbox();
  const tree = useTree();
  const tr = useT();
  if (!inbox.ready || inbox.unread === 0) return null;
  const marks = mentionMarks(inbox.items, tree);
  if (marks.pages.has(pageId)) {
    const tip = tr('comments.mentionedHere');
    return <span className="mention-dot tree-mention-dot" role="img" aria-label={tip} data-tip={tip} />;
  }
  if (collapsed && marks.inside.has(pageId)) {
    const tip = tr('mentions.mentionedInside');
    return <span className="mention-dot tree-mention-dot inside" role="img" aria-label={tip} data-tip={tip} />;
  }
  return null;
}
