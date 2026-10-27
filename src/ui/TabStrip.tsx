import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useT, type Translate } from '../i18n';
import { pagePath, parseRoute, useRoute, useSearchParam } from '../router';
import { useServices, useTree } from '../services';
import type { PageTree } from '../sync/tree';
import { isLetter, modPressed } from './findUi';
import { CloseIcon, PlusIcon } from './icons';
import { storeProject, useCurrentProject } from './project';
import { IS_MAC } from './shortcuts';
import {
  appPath,
  bindTabs,
  closeTab,
  newTab,
  rememberTabs,
  stepTab,
  switchTab,
  tabsAvailable,
  tabsState,
  useTabs,
  type AppTab,
} from './tabs';
import { asAction, tipRows } from './tipRows';

/** El link lógico de una página (`LOGICAL_PAGE_HREF` de pageLinkView.ts, que trae el editor: acá va la primera carga). */
const LOGICAL_PAGE_HREF = 'data-shotdocs-page-href';

// La barra de tabs de la app instalada (tabs.ts, Docs/Doc_Navegacion.md, «Tabs»): arriba de la columna de la página,
// solo con dos tabs o más (con uno, la app se ve como siempre). Sus atajos, los de los navegadores: Ctrl/⌘+T, Ctrl/⌘+W,
// Ctrl+Tab y Ctrl+Shift+Tab (⌘⇧] y ⌘⇧[ en la Mac). En el navegador esas teclas son del navegador y la app no tiene tabs.

/** Una capa abierta (un diálogo, el carrete, el anotador): sus teclas son de ella. */
const MODAL = '[aria-modal="true"], .modal-backdrop, .carrete, dialog[open]';

type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

/** Ctrl/⌘+T. */
export function isNewTabShortcut(e: KeyLike, mac = IS_MAC): boolean {
  return modPressed(e, mac) && !e.altKey && !e.shiftKey && isLetter(e, 't');
}

/** Ctrl/⌘+W. */
export function isCloseTabShortcut(e: KeyLike, mac = IS_MAC): boolean {
  return modPressed(e, mac) && !e.altKey && !e.shiftKey && isLetter(e, 'w');
}

/** El tab siguiente: Ctrl+Tab; en la Mac, ⌘⇧] (nunca Ctrl). */
export function isNextTabShortcut(e: KeyLike, mac = IS_MAC): boolean {
  if (mac) return e.metaKey && !e.ctrlKey && !e.altKey && e.shiftKey && (e.code === 'BracketRight' || e.key === ']');
  return e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key === 'Tab';
}

/** El tab anterior: Ctrl+Shift+Tab; en la Mac, ⌘⇧[. Con Shift la tecla da otro carácter: se mira su lugar (`code`). */
export function isPrevTabShortcut(e: KeyLike, mac = IS_MAC): boolean {
  if (mac) return e.metaKey && !e.ctrlKey && !e.altKey && e.shiftKey && (e.code === 'BracketLeft' || e.key === '[');
  return e.ctrlKey && !e.metaKey && !e.altKey && e.shiftKey && e.key === 'Tab';
}

/** El nombre de un tab: el de su página, el de su proyecto en el inicio, o el de la pantalla. */
export function tabTitle(tab: Pick<AppTab, 'project'> & { path: string }, tree: PageTree, tr: Translate): string {
  const route = parseRoute(new URL(tab.path, 'http://x').pathname);
  if (route.name === 'page') {
    const page = tree.get(route.id);
    return page ? page.title || tr('common.untitled') : tr('tabs.page');
  }
  if (route.name === 'map') return tr('sidebar.map');
  if (route.name === 'trash') return tr('trash.title');
  const project = tab.project ? tree.project(tab.project) : undefined;
  return project?.name || tr('tabs.home');
}

/** Prende los tabs mientras la ventana los tiene (la app instalada, fuera del teléfono) y escucha sus teclas. */
export function useTabsHost(enabled: boolean): void {
  const services = useServices();
  const { user, workspace, dbName } = services;
  const keys = workspace.config.storage;
  const project = useCurrentProject();
  const [available, setAvailable] = useState(tabsAvailable);

  // Instalarla o achicar la ventana a la medida del teléfono prende o apaga los tabs.
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const queries = ['(max-width: 760px)', '(display-mode: standalone)', '(display-mode: window-controls-overlay)', '(display-mode: minimal-ui)'].map((q) => matchMedia(q));
    const update = () => setAvailable(tabsAvailable());
    for (const q of queries) q.addEventListener?.('change', update);
    return () => {
      for (const q of queries) q.removeEventListener?.('change', update);
    };
  }, []);

  const on = enabled && available;
  // El proyecto que se ve, para guardarlo con el tab (se lee al dejarlo).
  const projectRef = useLatest(project);
  useEffect(() => {
    if (!on) return;
    return bindTabs({
      key: `shotdocs.tabs.${dbName}`,
      project: () => projectRef.current,
      chooseProject: (id) => storeProject(keys, user.id, id),
    });
  }, [on, dbName, keys, user.id, projectRef]);

  // Cada cambio de página queda guardado (si la ventana se cierra de golpe, vuelve con los tabs como estaban).
  const route = useRoute();
  const search = useSearchParam('scene');
  useEffect(() => {
    if (on) rememberTabs();
  }, [on, route, search, project]);

  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      const step = isNextTabShortcut(e) ? 1 : isPrevTabShortcut(e) ? -1 : 0;
      const create = !step && isNewTabShortcut(e);
      const close = !step && !create && isCloseTabShortcut(e);
      if (!step && !create && !close) return;
      // Con un solo tab, Ctrl/⌘+W hace lo de siempre (cerrar la ventana) y pasar de tab no tiene a dónde ir.
      if ((close || step) && tabsState().tabs.length < 2) return;
      if (document.querySelector(MODAL)) {
        // Con una capa abierta las teclas son de ella; Ctrl/⌘+W igual se frena: con varios tabs, cerraría la ventana.
        if (close) e.preventDefault();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      if (step) void stepTab(step);
      else if (create) void newTab();
      else void closeTab(tabsState().active);
    };
    // En captura: antes que el editor (Tab indenta) y que cualquier otra tecla de la página.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [on]);

  // Ctrl/⌘+clic o la rueda en un link de la app: en un tab nuevo de fondo, como en un navegador.
  useEffect(() => {
    if (!on) return;
    const take = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      const wheel = e.type === 'auxclick' && e.button === 1;
      const withMod = e.type === 'click' && e.button === 0 && modPressed(e) && !e.altKey && !e.shiftKey;
      if (!wheel && !withMod) return;
      const link = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[href]') : null;
      const path = link ? appPath(link.getAttribute(LOGICAL_PAGE_HREF) ?? link.getAttribute('href')) : null;
      if (!link || !path) return;
      e.preventDefault();
      // En el editor mientras se edita, Ctrl/⌘+clic ya lo abrió el editor al soltar el botón (internalLinks.ts).
      if (withMod && link.closest('[contenteditable="true"]')) return;
      e.stopPropagation();
      void newTab(path, { background: true });
    };
    window.addEventListener('click', take, true);
    window.addEventListener('auxclick', take, true);
    return () => {
      window.removeEventListener('click', take, true);
      window.removeEventListener('auxclick', take, true);
    };
  }, [on]);
}

function useLatest<T>(value: T): { current: T } {
  const [ref] = useState(() => ({ current: value }));
  ref.current = value;
  return ref;
}

export function TabStrip() {
  const tr = useT();
  // Los nombres siguen a los de las páginas.
  const tree = useTree();
  const { tabs, active } = useTabs();
  // El de ahora es lo que se ve (lo guardado de él se pone al día recién al dejarlo).
  const route = useRoute();
  const project = useCurrentProject();
  if (tabs.length < 2) return null;
  const middleClose = (e: ReactMouseEvent, id: string) => {
    if (e.button !== 1) return;
    e.preventDefault();
    void closeTab(id);
  };
  return (
    <div className="tab-strip" role="tablist" aria-label={tr('tabs.label')}>
      {tabs.map((tab) => {
        const on = tab.id === active;
        const title = on
          ? tabTitle({ path: route.name === 'page' ? pagePath(route.id) : route.name === 'map' ? '/map' : route.name === 'trash' ? '/trash' : '/', project }, tree, tr)
          : tabTitle({ path: tab.history.stack[tab.history.at] ?? '/', project: tab.project }, tree, tr);
        return (
          <div key={tab.id} className={`app-tab${on ? ' active' : ''}`} onAuxClick={(e) => middleClose(e, tab.id)} onMouseDown={(e) => e.button === 1 && e.preventDefault()}>
            <button className="app-tab-label" role="tab" aria-selected={on} onClick={() => void switchTab(tab.id)}>
              {title}
            </button>
            <button
              className="app-tab-close"
              aria-label={tr('tabs.close')}
              data-tip={on ? tipRows([{ shortcut: 'closeTab', action: asAction(tr('tabs.close')) }]) : undefined}
              onClick={() => void closeTab(tab.id)}
            >
              <CloseIcon size={12} />
            </button>
          </div>
        );
      })}
      <button
        className="app-tab-new"
        aria-label={tr('tabs.new')}
        data-tip={tipRows([{ shortcut: 'newTab', action: asAction(tr('tabs.new')) }])}
        onClick={() => void newTab()}
      >
        <PlusIcon size={14} />
      </button>
    </div>
  );
}
