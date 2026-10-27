import { useT } from '../i18n';
import { useTree } from '../services';
import { holdsDoc, holdsOf } from './kind';

// El rótulo chico junto a una carpeta con tipo en el árbol: SCENES, LOCATIONS, SETS, SHOOT DAYS, SCOUTING, TESTS o PLANS (Doc_Estructura_Proyecto.md,
// «Tipo de página»). Una carpeta de reportes del día (marcada o deducida) es una carpeta de días. Y LEFT OUT en la página
// que está fuera de las relaciones por su propia marca (D541; lo de adentro no lo repite).
export function HoldsTag({ pageId }: { pageId: string }) {
  const tree = useTree();
  const tr = useT();
  const holds = holdsOf(tree, pageId) ?? holdsDoc(tree.get(pageId));
  const off = tree.get(pageId)?.settings?.graph === false;
  if (!holds && !off) return null;
  const label =
    holds === 'scene' ? tr('type.scenes') : holds === 'location' ? tr('type.locations') : holds === 'set' ? tr('type.sets') : holds === 'scouting' ? tr('sidebar.tagScoutings') : holds === 'test' ? tr('sidebar.tagTests') : holds === 'plan' ? tr('sidebar.tagPlans') : tr('sidebar.tagDays');
  const tip =
    holds === 'scene' ? tr('sidebar.holdsScenes') : holds === 'location' ? tr('sidebar.holdsLocations') : holds === 'set' ? tr('sidebar.holdsSets') : holds === 'scouting' ? tr('sidebar.holdsScoutings') : holds === 'test' ? tr('sidebar.holdsTests') : holds === 'plan' ? tr('sidebar.holdsPlans') : tr('sidebar.holdsDays');
  return (
    <>
      {holds && (
        <span className="tree-holds" data-holds={holds} data-tip={tip}>
          {label}
        </span>
      )}
      {off && (
        <span className="tree-holds" data-holds="off" data-tip={tr('leaveOut.tagTip')}>
          {tr('leaveOut.tag')}
        </span>
      )}
    </>
  );
}
