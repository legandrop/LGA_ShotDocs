import { useEffect } from 'react';
import { useT } from '../i18n';
import { goBack, goForward, listenNavShortcuts, useNavPosition } from '../navHistory';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';
import { asAction, tipRows } from './tipRows';

/**
 * Atrás y adelante de la barra de arriba (Docs/Doc_Navegacion.md), a la izquierda del breadcrumb como en un navegador
 * o en Notion: en la app instalada no hay botones del navegador. Apagados cuando no hay a dónde ir sin salir de la app
 * (navHistory.ts). Escuchan también sus atajos (Alt+← y Alt+→; ⌘[ y ⌘] en la Mac).
 */
export function NavButtons() {
  const tr = useT();
  const { canBack, canForward } = useNavPosition();
  useEffect(() => listenNavShortcuts(), []);
  return (
    <div className="nav-buttons" role="group" aria-label={tr('shell.navigation')}>
      <button
        className="icon-button nav-button"
        data-test="nav-back"
        aria-label={tr('shell.navBack')}
        data-tip={tipRows([{ shortcut: 'navBack', action: asAction(tr('shell.navBack')) }])}
        disabled={!canBack}
        onClick={() => goBack()}
      >
        <ChevronLeftIcon size={18} />
      </button>
      <button
        className="icon-button nav-button"
        data-test="nav-forward"
        aria-label={tr('shell.navForward')}
        data-tip={tipRows([{ shortcut: 'navForward', action: asAction(tr('shell.navForward')) }])}
        disabled={!canForward}
        onClick={() => goForward()}
      >
        <ChevronRightIcon size={18} />
      </button>
    </div>
  );
}
