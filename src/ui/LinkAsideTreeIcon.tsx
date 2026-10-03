import { useT } from '../i18n';
import { WarningIcon } from './icons';
import { useLinkAside } from './linkAside';

// El ícono del árbol en una página con algo apartado de un link (Docs/Doc_Link_Publico.md, entrega 2c): se ve solo para
// quien ve lo borrado de esa página (sale de `public_link_aside`, como la lista de Share). Abrir la página muestra el
// aviso con el motivo y *Download it*.
export function LinkAsideTreeIcon({ pageId }: { pageId: string }) {
  const aside = useLinkAside();
  const tr = useT();
  if (!aside.rows.some((r) => r.page_id === pageId)) return null;
  const tip = tr('link.aside.tree');
  return (
    <span className="tree-link-aside" role="img" aria-label={tip} data-tip={tip}>
      <WarningIcon size={13} />
    </span>
  );
}
