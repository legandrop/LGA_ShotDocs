import { useT } from '../i18n';
import { useHelpDot } from '../tutorial/tourState';
import { MenuIcon } from './icons';
import { setNavOpen } from './navStore';

/**
 * El botón de menú de la barra de arriba en el teléfono (abre el cajón de páginas). Lleva el mismo punto que el "?" del
 * pie del cajón, con la misma regla (`useHelpDot`: la recorrida sin ver o las novedades de la ayuda), para que se vea
 * sin abrir el cajón (Docs/Doc_Tutorial.md, sección 4). La barra de la página y la de la práctica lo comparten.
 */
export function NavMenuButton() {
  const tr = useT();
  const { dot } = useHelpDot();
  return (
    <button className={`icon-button only-mobile${dot ? ' has-dot' : ''}`} aria-label={tr(dot ? 'shell.openPagesDot' : 'shell.openPages')} onClick={() => setNavOpen(true)}>
      <MenuIcon />
    </button>
  );
}
