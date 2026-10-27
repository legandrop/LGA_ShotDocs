import { useT } from '../i18n';
import { openHelp } from '../help/helpUi';
import { useHelpDot } from '../tutorial/tourState';
import { HelpIcon } from './icons';

/**
 * La ayuda (Docs/Doc_Tutorial.md, sección 5), con un punto si hay una recorrida sin ver o novedades (`useHelpDot`). Sin
 * tooltip: el ícono ya lo dice (D-15). Va en la barra de arriba, antes del menú de la página (`where="top"`, la de la
 * página y la de la práctica), y en el teléfono, donde esa barra no tiene lugar, al pie del cajón a la derecha de la
 * cuenta (`where="drawer"`). D801: antes tenía su propio renglón al pie de la barra lateral.
 */
export function HelpButton({ where }: { where: 'top' | 'drawer' }) {
  const tr = useT();
  const help = useHelpDot();
  return (
    <button
      className={`icon-button help-button ${where === 'top' ? 'not-mobile' : 'only-mobile'}${help.dot ? ' has-dot' : ''}`}
      data-tour="help"
      aria-label={help.news ? tr('help.openNews') : tr('help.open')}
      onClick={(e) => openHelp(null, e.currentTarget)}
    >
      <HelpIcon size={18} />
    </button>
  );
}
