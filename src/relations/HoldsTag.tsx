import { useT } from '../i18n';
import { useTree } from '../services';
import { holdsOf } from './kind';

// El rótulo chico junto a una carpeta con tipo en el árbol: SCENES, LOCATIONS o SHOOT DAYS (Doc_Estructura_Proyecto.md,
// «Tipo de página»). Una carpeta de reportes del día (marcada o deducida) es una carpeta de días.
export function HoldsTag({ pageId }: { pageId: string }) {
  const tree = useTree();
  const tr = useT();
  const holds = holdsOf(tree, pageId);
  if (!holds) return null;
  const label = holds === 'scene' ? tr('type.scenes') : holds === 'location' ? tr('type.locations') : tr('sidebar.tagDays');
  const tip = holds === 'scene' ? tr('sidebar.holdsScenes') : holds === 'location' ? tr('sidebar.holdsLocations') : tr('sidebar.holdsDays');
  return (
    <span className="tree-holds" data-holds={holds} data-tip={tip}>
      {label}
    </span>
  );
}
