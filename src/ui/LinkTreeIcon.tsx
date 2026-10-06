import { useT } from '../i18n';
import { LinkIcon } from './icons';
import { useLinkPages } from './linkPages';

// El ícono del árbol en una página con un link público propio (Docs/Doc_Link_Publico.md, 3.11): solo en esa página (lo
// de abajo se abre con el mismo link, pero el link es de ella) y solo para quien puede abrir su *Share*, que es donde se
// copia, se cambia y se apaga. El tooltip dice lo que el ícono no: qué deja hacer el link y quién lo creó.
export function LinkTreeIcon({ pageId }: { pageId: string }) {
  const mark = useLinkPages().get(pageId);
  const tr = useT();
  if (!mark) return null;
  const what = !mark.alive ? tr('link.tree.off') : tr(mark.level === 'edit' ? 'link.tree.edit' : 'link.tree.view');
  const tip = mark.createdBy ? tr('link.tree.by', { what, name: mark.createdBy }) : what;
  return (
    <span className={`tree-link${mark.alive ? '' : ' off'}`} role="img" aria-label={tip} data-tip={tip}>
      <LinkIcon size={13} />
    </span>
  );
}
