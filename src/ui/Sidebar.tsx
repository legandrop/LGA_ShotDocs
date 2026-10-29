import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../i18n';
import { usePrefs } from '../prefs';
import { navigate, pagePath, useRoute } from '../router';
import { modPressed } from './findUi';
import { openInNewTab } from './tabs';
import { usePermissions, useServices, useTree } from '../services';
import type { PageRow } from '../sync/types';
import { TOUR_ANCHOR_EVENT } from '../tutorial/tourState';
import { AccountIcon, CollapseIcon, ExpandIcon, MoreIcon, PlusIcon, SearchIcon } from './icons';
import { AccountMenu, menuBelow, PAGE_MENU_WIDTH, PageMenu, type MenuPosition } from './menus';
import { DriveDialogHost, MembersDialog, ShareDialog } from './lazyDialogs';
import { Part } from './lazyPart';
import { MoveDialog } from './MoveDialog';
import { PageFormatDialog } from './PageFormatDialog';
import { useCurrentProject } from './project';
import { ProjectSwitcher } from './ProjectSwitcher';
import { HelpButton } from './HelpButton';
import { LinkHeader } from './LinkHeader';
import { MentionTreeDot } from './mentionDots';
import { OverviewNav } from '../relations/OverviewNav';
import { HoldsTag } from '../relations/HoldsTag';
import { holdsOf, kindReader } from '../relations/kind';
import { LinkAsideTreeIcon } from './LinkAsideTreeIcon';
import { LinkTreeIcon } from './LinkTreeIcon';
import { useLinkMode } from '../linkMode';
import { useSearchSession } from './projectSearchUi';
import { useIndexProgress } from './relationsUi';
import { shortcutLabel } from './shortcuts';
import { tipRows } from './tipRows';
import { SyncBadge } from './SyncBadge';
import { OfflineBadge, OfflineLine } from './SpaceHost';
import { splitEnabled, splitSiblings, type SplitTitle } from './titles';
import { datedTitle, useLocMatcher, type DatedTitle } from './datedTitle';
import {
  AUTO_COLLAPSE,
  centerRow,
  collapseForExpand,
  collapseToBranch,
  createOpenScheduler,
  isPlainKey,
  isTreeKey,
  isTreeMoveKey,
  REVEAL_QUIET_MS,
  REVEAL_TTL_MS,
  revealRow,
  treeKeyAction,
  visibleRows,
} from './treeNav';
import { clearOpenedFromOverview, goToRow, sidebarEdge, sidebarStep, sidebarStepAround, TREE_AWAY_EVENT, TREE_GO_EVENT, type TreeGo } from './sidebarRows';

/** Llevar la fila a la vista: centrada con el colapso automático (treeNav.ts), si no, lo justo para que se vea. */
const showRow = AUTO_COLLAPSE ? centerRow : revealRow;
/** Un diálogo abierto (como `navHistory.ts`): ahí las flechas no son del árbol. */
const MODAL = '[aria-modal="true"], .modal-backdrop, .carrete, dialog[open]';

/** La clase del nombre de una locación (azul) o un decorado (violeta) en el árbol (D823); el resto, ninguna. */
function placeClass(kind: string): string {
  return kind === 'location' ? ' loc' : kind === 'set' ? ' set' : '';
}

const EXPANDED_KEY = 'shotdocs-expanded';

function readExpanded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

/** *Pages* plegada, por proyecto, en este dispositivo (como *Overview*, `shotdocs-overview-nav`). */
const PAGES_FOLD_KEY = 'shotdocs-pages-nav';

function readPagesFolded(): Record<string, boolean> {
  try {
    const all = JSON.parse(localStorage.getItem(PAGES_FOLD_KEY) ?? '{}') as unknown;
    return all && typeof all === 'object' && !Array.isArray(all) ? (all as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

type DropZone = 'before' | 'inside' | 'after';

/**
 * «Reading 340 of 921…» mientras el dispositivo lee muchas páginas del proyecto (la primera vez, o después de muchos
 * cambios): la búsqueda y las relaciones en vivo (Docs/Doc_Relaciones.md, sección 6). Un renglón chico después del
 * árbol, pegado al borde de abajo de lo que se desplaza (justo arriba del pie) mientras el árbol es más largo que la
 * pantalla: no salta, no se cierra y se va solo al terminar.
 */
function IndexProgress() {
  const tr = useT();
  const progress = useIndexProgress();
  const el = useRef<HTMLDivElement>(null);
  const shown = !!progress;
  // Al aparecer, si tapa la fila de la página abierta, el árbol se corre lo justo para que se vea (auditoría de E1, O8);
  // después, el árbol que sigue a la página ya lo cuenta (`scroll-padding-bottom` mientras se muestra, `revealRow`).
  useLayoutEffect(() => {
    const label = el.current;
    const nav = label?.closest<HTMLElement>('.sidebar-scroll');
    const row = nav?.querySelector<HTMLElement>('.tree-row.active');
    if (!label || !nav || !row) return;
    const r = row.getBoundingClientRect();
    const top = label.getBoundingClientRect().top;
    // Tapada: empieza antes del borde de abajo de la barra y termina debajo del renglón.
    if (r.bottom > top && r.top < nav.getBoundingClientRect().bottom) nav.scrollTop += r.bottom - top + 4;
  }, [shown]);
  if (!progress) return null;
  return (
    <div ref={el} className="index-progress" role="status" data-tip={tr('sidebar.readingTip')}>
      {tr('sidebar.reading', { ready: progress.ready.toLocaleString(), total: progress.total.toLocaleString() })}
    </div>
  );
}

/** Cuánto antes del borde derecho ya cuenta como estar sobre la barra de desplazamiento, y cuánto sigue a la vista después de desplazar. */
const SCROLLBAR_ZONE = 14;
const SCROLLBAR_LINGER_MS = 900;

/**
 * La barra de desplazamiento del árbol está escondida (styles.css, `.show-scrollbar`): aparece mientras el mouse está
 * en su franja y mientras se desplaza, y se va sola un rato después. Se toca la clase directamente: un mouse que se mueve
 * no redibuja la barra lateral.
 */
function useScrollbarReveal(ref: RefObject<HTMLDivElement | null>) {
  const near = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = (on: boolean) => ref.current?.classList.toggle('show-scrollbar', on);
  const hideLater = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => show(near.current), SCROLLBAR_LINGER_MS);
  };
  useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);
  return {
    scrolled: () => {
      show(true);
      hideLater();
    },
    moved: (e: MouseEvent<HTMLDivElement>) => {
      const was = near.current;
      near.current = e.clientX >= e.currentTarget.getBoundingClientRect().right - SCROLLBAR_ZONE;
      if (near.current) show(true);
      else if (was) hideLater();
    },
    left: () => {
      near.current = false;
      hideLater();
    },
  };
}

/**
 * `onBrowse` se llama justo antes de que el árbol abra la página `id` sin que la persona la haya elegido con un
 * clic ni con Enter (las flechas, o plegar una madre de la página abierta): en el teléfono, el cajón sigue
 * abierto para seguir recorriendo el árbol.
 */
export function Sidebar({ onBrowse }: { onBrowse?: (id: string) => void } = {}) {
  const tree = useTree();
  const perms = usePermissions();
  const { user } = useServices();
  const route = useRoute();
  const activeId = route.name === 'page' ? route.id : null;
  const projectId = useCurrentProject();
  const search = useSearchSession();
  const tr = useT();
  // Un punto en el "?" mientras haya una recorrida para ver y la ayuda nunca se haya abierto acá.
  const { expandSubpages } = usePrefs();

  const [expanded, setExpanded] = useState<Set<string>>(readExpanded);
  // Colapso automático (treeNav.ts): al abrir otra página, lo desplegado de su proyecto pasa a ser solo su rama. Se
  // calcula al dibujar, no en un efecto: el árbol no se pinta un cuadro con la rama vieja abierta, y la fila se centra
  // con lo que queda (abajo, `tryReveal`). Espera a que la página esté en el árbol (al cargar puede no haber llegado).
  // Una vista del *Overview* (el resumen de una escena, una locación o un decorado, una tabla) pliega todo *Pages*: la
  // barra es un solo árbol y queda abierto solo el camino a lo que se abrió (sidebarRows.ts, D806). Una página siempre
  // vive en *Pages*: abierta desde el *Overview* (un día), también se ve ahí, en su carpeta (D815).
  const [branchOf, setBranchOf] = useState<string | null>(null);
  const onMap = route.name === 'map';
  const branchKey = onMap ? `map:${route.tab}` : activeId;
  if (AUTO_COLLAPSE && branchKey && branchOf !== branchKey && (onMap || (tree.get(activeId!) && !tree.isTrashed(activeId!)))) {
    setBranchOf(branchKey);
    const fromOverview = onMap;
    const project = activeId ? tree.get(activeId)?.workspace_id : projectId;
    const branch = fromOverview || !activeId ? [] : tree.ancestors(activeId).map((p) => p.id);
    // Lo que no es de este proyecto, o no está en el árbol (otro workspace, algo que todavía no bajó), queda como estaba.
    const outside = (id: string) => tree.get(id)?.workspace_id !== project;
    // Si la fila ya se ve (sus madres están abiertas: las flechas, un clic en el árbol), no se pliega nada: el colapso
    // llega cuando algo se despliega (`expand`, D809). Un link o la búsqueda a una rama cerrada sí la deja sola.
    setExpanded((prev) =>
      !fromOverview && branch.every((id) => prev.has(id)) ? prev : collapseToBranch(prev, branch, fromOverview ? '' : activeId!, outside),
    );
  }
  // La fila hasta donde llegaron las flechas con la tecla apretada: se marca como la elegida enseguida, aunque la página
  // se abra recién al soltar (pedido de Lega).
  const [browsing, setBrowsing] = useState<string | null>(null);
  const shownActive = browsing ?? activeId;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; position: MenuPosition; anchor: HTMLElement } | null>(null);
  const [account, setAccount] = useState<MenuPosition | null>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  // "Google Drive" (menú de la cuenta). Al volver de conectar Drive, Google deja `?drive=<resultado>` en la
  // dirección: el diálogo se abre con el resultado.
  const [drive, setDrive] = useState<{ result: string | null } | null>(() => {
    const result = new URLSearchParams(location.search).get('drive');
    return result === null ? null : { result };
  });
  useEffect(() => {
    if (drive?.result && new URLSearchParams(location.search).has('drive')) {
      // La vieja prueba de media (`/media-test`, adonde vuelve un portero viejo) ya no existe: queda `/`.
      const path = location.pathname === '/media-test' ? '/' : location.pathname;
      history.replaceState(history.state, '', path + location.hash);
    }
  }, [drive]);
  const [moving, setMoving] = useState<string | null>(null);
  const [formatting, setFormatting] = useState<string | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  const [members, setMembers] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; zone: DropZone } | null>(null);
  // La fila con el foco del teclado mientras el foco está en el árbol (fuera del árbol, `null`).
  const [focusId, setFocusId] = useState<string | null>(null);
  const [pagesFolded, setPagesFolded] = useState(readPagesFolded);
  const pagesClosed = pagesFolded[projectId] === true;
  const foldPages = (closed: boolean, project = projectId) => {
    settle.current = null;
    const next = { ...readPagesFolded(), [project]: closed };
    if (!closed) delete next[project];
    setPagesFolded(next);
    try {
      localStorage.setItem(PAGES_FOLD_KEY, JSON.stringify(next));
    } catch {
      // Recordar lo plegado es solo una comodidad.
    }
  };
  const rowEls = useRef(new Map<string, HTMLDivElement>());
  const navEl = useRef<HTMLDivElement>(null);
  // La página que el árbol mismo está por abrir (un clic en su fila, Enter, las flechas, plegar una madre): esa
  // fila ya está a la vista y el árbol no se desplaza. Se anota la página, no un sí o no, como `keepNav` en
  // Workspace.tsx: si esa navegación no llega a cambiar la página, la marca no vale para la siguiente.
  const openedByTree = useRef<string | null>(null);
  // La página abierta cuya fila falta llevar a la vista (abierta por un link, una mención, la búsqueda, el breadcrumb,
  // atrás y adelante, la dirección, una página nueva): se lleva apenas su fila existe, después de abrir sus madres.
  // Vence a los `REVEAL_TTL_MS` (una página que no llega a aparecer en el árbol no se queda esperando para siempre).
  const reveal = useRef<{ id: string; at: number } | null>(null);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cuándo la persona desplazó el árbol por su cuenta (rueda, dedo, barra, teclado) por última vez, y hasta cuándo
  // un desplazamiento es nuestro (su evento `scroll` no cuenta como de la persona).
  const lastManualScroll = useRef(0);
  const ownScrollUntil = useRef(0);
  const ownTop = useRef(-1);
  const markOwn = () => {
    ownScrollUntil.current = Date.now() + 150;
    ownTop.current = navEl.current?.scrollTop ?? -1;
  };
  const scrollbar = useScrollbarReveal(navEl);

  // Abrir una página desde el árbol sin clic (flechas, plegar una madre de la abierta). Siempre la última
  // versión, para el temporizador de `opener`.
  const browse = useRef<(id: string) => void>(() => undefined);
  browse.current = (id: string) => {
    // Contra la página abierta, no contra la dirección: `/p/<id>/` (con barra al final) es la misma página.
    if (id === activeId || !tree.get(id) || tree.isTrashed(id)) return;
    onBrowse?.(id);
    openedByTree.current = id;
    clearOpenedFromOverview();
    navigate(pagePath(id));
  };
  const [opener] = useState(() => createOpenScheduler((id) => browse.current(id)));
  useEffect(() => () => opener.cancel(), [opener]);
  // Si la ruta cambia por otro camino (un link, la búsqueda, un clic, la papelera), lo que las flechas iban a
  // abrir ya no va. Lo mismo si el foco sale del árbol (el `onBlur` del árbol).
  useEffect(() => opener.cancel(), [route.name, activeId, opener]);

  useEffect(() => {
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]));
    } catch {
      // Recordar qué está abierto es solo una comodidad.
    }
  }, [expanded]);

  // La página abierta siempre se ve en el árbol: sus madres se abren cuando cambia la página abierta (un link,
  // la búsqueda, al cargar) o cuando el árbol llega o cambia (otro dispositivo). No cuando cambia `expanded`:
  // plegar una madre de la página abierta tiene que poder (`collapse` pasa la página abierta a esa madre).
  const revision = tree.getRevision();
  // Antes de pintar: el árbol no se dibuja un cuadro con la fila escondida y recién después abierto.
  useLayoutEffect(() => {
    if (!activeId) return;
    const ids = tree.ancestors(activeId).map((p) => p.id);
    setExpanded((prev) => (ids.every((id) => prev.has(id)) ? prev : new Set([...prev, ...ids])));
  }, [activeId, tree, revision]);

  // Con *Pages* plegada, abrir otra página (un link, la búsqueda, atrás) la despliega: la página abierta se ve en el
  // árbol. Solo cuando cambia la página abierta, no al arrancar (lo plegado se recuerda) ni con cada cambio del árbol.
  // Cambiar de proyecto abre su última página: eso no cuenta (lo plegado de cada proyecto se recuerda).
  const shownPage = useRef({ id: activeId, project: projectId });
  useLayoutEffect(() => {
    const before = shownPage.current;
    shownPage.current = { id: activeId, project: projectId };
    if (before.id === activeId) return;
    const project = activeId ? tree.get(activeId)?.workspace_id : undefined;
    if (project && project === before.project && pagesFolded[project] === true) foldPages(false, project);
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps
  // El tour y «Mostrame» señalan el árbol: plegado no se vería.
  useEffect(() => {
    const onAnchor = (e: Event) => {
      if ((e as CustomEvent<string>).detail === 'pages' && pagesFolded[projectId] === true) foldPages(false);
    };
    window.addEventListener(TOUR_ANCHOR_EVENT, onAnchor);
    return () => window.removeEventListener(TOUR_ANCHOR_EVENT, onAnchor);
  });

  // Lo que no abrió el árbol mismo deja su fila a la vista en el árbol (pedido de Lega, "el árbol sigue a la página");
  // con el colapso automático, también lo que abrió el árbol, y la fila va centrada (`showRow`). Antes de pintar
  // (`useLayoutEffect`). Sin el colapso, si la fila ya se ve, no se mueve nada (`revealRow`). Si todavía no
  // está (sus madres se abren en el efecto de arriba, o el árbol no llegó), se espera a la pasada en que aparece. Y si
  // la persona está desplazando el árbol a mano, se espera a que frene (`REVEAL_QUIET_MS`): no se le roba el desplazamiento.
  const tryReveal = () => {
    const req = reveal.current;
    if (!req) return;
    if (Date.now() - req.at > REVEAL_TTL_MS) {
      reveal.current = null;
      return;
    }
    const el = rowEls.current.get(req.id);
    const nav = navEl.current;
    if (!el || !nav) return;
    const wait = REVEAL_QUIET_MS - (Date.now() - lastManualScroll.current);
    if (wait > 0) {
      if (revealTimer.current) clearTimeout(revealTimer.current);
      revealTimer.current = setTimeout(tryReveal, wait);
      return;
    }
    reveal.current = null;
    // Su evento `scroll` llega enseguida: no es de la persona.
    if (showRow(el, nav)) markOwn();
    settle.current = { id: req.id, at: Date.now() };
  };
  // Al cargar, el *Overview* se arma después que el árbol y empuja la fila fuera de la vista: por `REVEAL_TTL_MS`,
  // cada vez que cambia el alto de lo que está en la barra, la fila vuelve a su lugar, salvo que la persona ya haya
  // desplazado a mano.
  const settle = useRef<{ id: string; at: number } | null>(null);
  useEffect(() => {
    const nav = navEl.current;
    if (!nav || typeof ResizeObserver === 'undefined' || typeof MutationObserver === 'undefined') return;
    const resized = new ResizeObserver(() => {
      const s = settle.current;
      if (!s) return;
      if (Date.now() - s.at > REVEAL_TTL_MS || lastManualScroll.current > s.at) {
        settle.current = null;
        return;
      }
      const el = rowEls.current.get(s.id);
      if (el && showRow(el, nav)) markOwn();
    });
    const watch = () => {
      resized.disconnect();
      for (const child of nav.children) resized.observe(child);
    };
    watch();
    const added = new MutationObserver(watch);
    added.observe(nav, { childList: true });
    return () => {
      resized.disconnect();
      added.disconnect();
    };
  }, []);
  useLayoutEffect(() => {
    if (revealTimer.current) clearTimeout(revealTimer.current);
    // Con el colapso automático, también la que abrió el árbol: el árbol cambió alrededor de su fila y va centrada.
    const follow = activeId && (AUTO_COLLAPSE || activeId !== openedByTree.current);
    reveal.current = follow ? { id: activeId, at: Date.now() } : null;
    openedByTree.current = null;
    settle.current = null;
    setBrowsing(null);
  }, [activeId]);
  useLayoutEffect(tryReveal);
  useEffect(() => () => (revealTimer.current ? clearTimeout(revealTimer.current) : undefined), []);

  const expand = (id: string) => {
    settle.current = null;
    if (!AUTO_COLLAPSE) {
      setExpanded((prev) => new Set(prev).add(id));
      return;
    }
    // Desplegar es lo que pliega lo demás de su proyecto (D809).
    const project = tree.get(id)?.workspace_id;
    const ancestors = tree.ancestors(id).map((p) => p.id);
    setExpanded((prev) =>
      collapseForExpand(prev, ancestors, id, (other) => tree.isDescendant(other, id), (other) => tree.get(other)?.workspace_id !== project),
    );
  };
  /** Elegir explícitamente una página abre sólo su nivel; las flechas y plegar siguen siendo manuales. */
  const openPage = (id: string) => {
    opener.cancel();
    if (expandSubpages === 'onClick' && tree.children(id).length > 0) expand(id);
    openedByTree.current = id;
    clearOpenedFromOverview();
    setBrowsing(null);
    navigate(pagePath(id));
  };
  /** Pliega `id`. Si la página abierta queda escondida adentro, la abierta pasa a ser `id` (pedido de Lega). */
  const collapse = (id: string) => {
    settle.current = null;
    // Lo que las flechas iban a abrir no se pierde: se abre ya (o `id`, si quedaba escondido adentro).
    const pending = opener.pending();
    opener.cancel();
    setExpanded((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (activeId && tree.isDescendant(activeId, id)) browse.current(id);
    else if (pending) browse.current(tree.isDescendant(pending, id) ? id : pending);
  };
  /** Pone el foco en la fila; si no, la trae a la vista con `showRow` (que cuenta las madres pegadas arriba). */
  const focusRow = (id: string, preventScroll = false) => {
    const el = rowEls.current.get(id);
    if (!el) return;
    el.focus({ preventScroll: true });
    const nav = navEl.current;
    if (!preventScroll && nav && showRow(el, nav)) markOwn();
  };

  async function newPage(parentId: string | null) {
    const id = await tree.create(parentId, '', projectId);
    if (parentId) expand(parentId);
    navigate(pagePath(id));
  }

  function canDrop(targetId: string): boolean {
    return !!dragging && dragging !== targetId && !tree.isDescendant(targetId, dragging);
  }

  /** Dónde queda la página si se suelta ahí: adentro de `page`, o al lado (con su padre). */
  function dropParent(page: PageRow, zone: DropZone): string | null {
    if (zone === 'inside') return page.id;
    return page.parent_id && tree.get(page.parent_id) ? page.parent_id : null;
  }

  /** Soltar ahí pide 4 en la página que se mueve y en el destino. */
  function allowedZone(page: PageRow, zone: DropZone): boolean {
    return !!dragging && perms.canMove(dragging, dropParent(page, zone));
  }

  function onDragOver(e: DragEvent, page: PageRow) {
    if (!canDrop(page.id)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    // Una madre pegada arriba (D771) no está en su lugar: antes o después de ella sería muy lejos de lo que se ve.
    // Ahí solo se suelta adentro.
    const home = e.currentTarget.parentElement?.getBoundingClientRect().top ?? rect.top;
    const stuck = rect.top - home > 1;
    const zone: DropZone = stuck ? 'inside' : y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside';
    if (!allowedZone(page, zone)) {
      if (drop?.id === page.id) setDrop(null);
      return;
    }
    e.preventDefault();
    if (drop?.id !== page.id || drop.zone !== zone) setDrop({ id: page.id, zone });
  }

  async function onDrop(e: DragEvent, page: PageRow) {
    e.preventDefault();
    const id = dragging;
    const zone = drop?.zone;
    setDragging(null);
    setDrop(null);
    if (!id || !zone || !canDrop(page.id) || !perms.canMove(id, dropParent(page, zone))) return;
    if (zone === 'inside') {
      await tree.move(id, page.id);
      expand(page.id);
    } else {
      const parentId = page.parent_id && tree.get(page.parent_id) ? page.parent_id : null;
      await tree.move(id, parentId, zone === 'before' ? { before: page.id } : { after: page.id });
    }
  }

  /** Las flechas, Inicio, Fin, Enter y Espacio en una fila (patrón de árbol de WAI-ARIA, treeNav.ts). */
  function onRowKey(e: KeyboardEvent<HTMLDivElement>, id: string) {
    // Solo con el foco en la fila misma (no en el renombrado ni en sus botones) y la tecla sola.
    if (e.target !== e.currentTarget || !isTreeKey(e.key) || !isPlainKey(e.nativeEvent)) return;
    e.preventDefault();
    // Inicio y Fin van al principio y al final de toda la barra, *Overview* incluido (D806).
    if (e.key === 'Home' || e.key === 'End') {
      const edge = sidebarEdge(e.currentTarget, e.key === 'End');
      if (edge && edge !== e.currentTarget) goToRow(edge, false);
      return;
    }
    const action = treeKeyAction(rows, id, e.key);
    if (action.type === 'go') {
      // El foco pasa ya; la página se abre al instante o, con la tecla apretada, al frenar (treeNav.ts).
      goTree(action.id, e.repeat);
    } else if (action.type === 'none' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      // Arriba de la primera fila (o abajo de la última) sigue el *Overview*: la barra es un solo recorrido (D806).
      const next = sidebarStep(e.currentTarget, e.key === 'ArrowDown' ? 1 : -1);
      if (next) goToRow(next, e.repeat);
    } else if (action.type === 'open') {
      openPage(action.id);
    } else if (action.type === 'expand') {
      expand(action.id);
    } else if (action.type === 'collapse') {
      collapse(action.id);
    }
  }

  // Qué es cada página (para el color del número de una escena, D773): un solo lector por dibujo, que recuerda lo
  // que ya leyó; uno por fila recorría las hermanas de cada escena (cientos de escenas: N² por dibujo).
  const kinds = kindReader(tree);
  const isLoc = useLocMatcher();

  /** Una lista de hermanas: si corresponde, con los títulos divididos y la columna del código alineada. */
  function renderList(parentId: string | null, pages: PageRow[], depth: number, role: 'tree' | 'group') {
    const splitOn = splitEnabled(tree, parentId);
    // Los días, scoutings, pruebas y planes con fecha van en su propia fila (D789) y no cuentan para la columna del
    // código: una fecha larga (`2025-11-05`) ya no apaga la división de la lista entera.
    const dated = new Map<string, DatedTitle>();
    /** En una semana de rodaje con planes al lado de sus reportes, qué es cada fila (D815): `plan` o `report`. */
    const stages = new Map<string, 'plan' | 'report'>();
    if (splitOn) {
      for (const page of pages) {
        const k = kinds.kindOf(page.id);
        if (k.kind !== 'day' && k.kind !== 'doc') continue;
        let d = datedTitle(page.title, isLoc);
        if (!d) continue;
        // Plan o reporte sale del tipo, no del título: un día con una parte «Plan» en el título la conserva en la nota.
        const isPlan = k.kind === 'doc' && k.doc === 'plan';
        if (d.plan && !isPlan) d = { ...d, plan: undefined, planNote: undefined, note: d.note ? `${d.note} · Plan` : 'Plan' };
        dated.set(page.id, d);
        if (isPlan) stages.set(page.id, 'plan');
        else if (k.kind === 'day') stages.set(page.id, 'report');
      }
      // Donde hay planes: en Rodaje (la carpeta de días o una semana adentro) cada fila dice si es plan o reporte, aunque
      // el reporte de ese plan todavía no exista; una semana sin planes, o una carpeta de planes fuera de Rodaje, se ve
      // como siempre.
      const both = new Set(stages.values());
      let inShoot = false;
      for (let id: string | null = parentId; id && !inShoot; id = tree.get(id)?.parent_id ?? null) inShoot = holdsOf(tree, id) === 'day';
      if (!both.has('plan') || (both.size < 2 && !inShoot)) stages.clear();
    }
    const split = splitOn ? splitSiblings(pages.filter((p) => !dated.has(p.id))) : null;
    // La columna de la jornada mide lo que la más larga de la lista (`D05`, `D100`), así la fecha queda alineada.
    const jornadaWidth = Math.max(0, ...[...dated.values()].map((d) => d.jornada?.length ?? 0));
    const jornadas = jornadaWidth > 0;
    const style = {
      ...(split ? { '--code-w': `${split.width}ch` } : {}),
      ...(jornadas ? { '--jor-w': `${jornadaWidth}ch` } : {}),
    } as CSSProperties;
    return (
      <ul
        className={role === 'tree' ? 'tree' : undefined}
        data-tour={role === 'tree' ? 'pages' : undefined}
        role={role}
        aria-label={role === 'tree' ? tr('sidebar.tree') : undefined}
        style={style}
        onBlur={
          role === 'tree'
            ? (e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                // El foco salió del árbol: al volver con Tab, entra por la página abierta, y lo que las
                // flechas iban a abrir ya no va (la página no cambia bajo el cursor).
                setFocusId(null);
                opener.cancel();
                setBrowsing(null);
              }
            : undefined
        }
      >
        {pages.map((page) => renderItem(page, depth, split?.titles.get(page.id) ?? null, dated.get(page.id) ?? null, jornadas, stages.get(page.id) ?? null))}
      </ul>
    );
  }

  function renderItem(page: PageRow, depth: number, split: SplitTitle | null, dated: DatedTitle | null, jornadas: boolean, stage: 'plan' | 'report' | null = null) {
    const children = tree.children(page.id);
    const open = expanded.has(page.id);
    const dropClass = drop?.id === page.id ? ` drop-${drop.zone}` : '';
    // Una sola fila del árbol en el orden de Tab (con sus botones): la del foco o, si no, la abierta.
    const tabIndex = page.id === tabStop ? 0 : -1;
    return (
      <li key={page.id} role="none">
        <div
          ref={(el) => {
            if (el) rowEls.current.set(page.id, el);
            else rowEls.current.delete(page.id);
          }}
          role="treeitem"
          aria-level={depth + 1}
          aria-expanded={children.length ? open : undefined}
          aria-label={page.title || tr('common.untitled')}
          data-page={page.id}
          className={`tree-row${children.length ? ' parent' : ''}${children.length && open ? ' sticky-head' : ''}${page.id === shownActive ? ' active' : ''}${menu?.id === page.id ? ' menu-open' : ''}${renaming === page.id ? ' renaming' : ''}${dropClass}`}
          style={{ paddingLeft: 4 + depth * 18, '--depth': depth } as CSSProperties}
          draggable={renaming !== page.id && perms.canManagePage(page.id)}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', page.id);
            setDragging(page.id);
          }}
          onDragEnd={() => {
            setDragging(null);
            setDrop(null);
          }}
          onDragOver={(e) => onDragOver(e, page)}
          onDragLeave={() => drop?.id === page.id && setDrop(null)}
          onDrop={(e) => onDrop(e, page)}
          onClick={(e) => {
            // Ctrl/⌘+clic: en un tab nuevo de fondo (en el navegador, en otra pestaña), como un link (D811). Con un link
            // público no se abre aparte: el clic hace lo de siempre.
            if (modPressed(e) && !e.altKey && !e.shiftKey && openInNewTab(pagePath(page.id))) return;
            // El foco queda en la fila (Safari no lo da solo): las flechas siguen desde acá.
            e.currentTarget.focus({ preventScroll: true });
            // Con «On click», otro clic en la página abierta y desplegada la pliega (pedido de Lega, D826). Cualquier clic
            // del mouse, también el segundo de un doble clic: en la Mac de Lega el doble clic dura 1,8 s, y dos clics en
            // el mismo lugar no plegaban (v0.311). Un clic sin mouse (`detail` 0) solo abre. Lo que las flechas iban a
            // abrir se cancela, como al abrir: el clic se queda acá.
            if (expandSubpages === 'onClick' && page.id === activeId && open && children.length > 0 && e.detail > 0) {
              opener.cancel();
              collapse(page.id);
            } else openPage(page.id);
          }}
          onMouseDown={(e) => {
            // La rueda no desplaza la barra con el autoscroll del navegador: abre la página aparte.
            if (e.button === 1) e.preventDefault();
          }}
          onAuxClick={(e) => {
            if (e.button !== 1) return;
            e.preventDefault();
            openInNewTab(pagePath(page.id));
          }}
          onFocus={() => setFocusId(page.id)}
          tabIndex={tabIndex}
          aria-current={page.id === activeId ? 'page' : undefined}
          onKeyDown={(e) => onRowKey(e, page.id)}
        >
          {children.length > 0 ? (
            <button
              className="toggle"
              aria-label={open ? tr('sidebar.collapse') : tr('sidebar.expand')}
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                focusRow(page.id, true);
                if (open) collapse(page.id);
                else expand(page.id);
              }}
            >
              {open ? <CollapseIcon size={14} /> : <ExpandIcon size={14} />}
            </button>
          ) : stage ? (
            // PLN o REP en el lugar del triángulo: queda alineado con el nombre de la semana (D816).
            <span className="toggle leaf stage-slot">
              <span className="tree-stage" data-stage={stage}>
                {tr(stage === 'plan' ? 'sidebar.stagePlan' : 'sidebar.stageReport')}
              </span>
            </span>
          ) : (
            <span className="toggle leaf" aria-hidden="true" />
          )}
          {renaming === page.id ? (
            <RenameInput
              initial={page.title}
              onDone={(title, byKey) => {
                setRenaming(null);
                if (title !== null) void tree.rename(page.id, title);
                // Con Enter o Esc el foco vuelve a la fila; si se fue con un clic a otro lado, no se lo saca.
                if (byKey) focusRow(page.id, true);
              }}
            />
          ) : dated ? (
            <span className="label dated">
              {/* La fecha y la jornada en el color de los días; el lugar en el azul de las locaciones solo si la app
                  lo reconoce (D774); la fila elegida no cambia esos colores (D789). */}
              {/* Plan o reporte con subpáginas: la etiqueta va después del triángulo. */}
              {stage && children.length > 0 && (
                <span className="tree-stage" data-stage={stage}>
                  {tr(stage === 'plan' ? 'sidebar.stagePlan' : 'sidebar.stageReport')}
                </span>
              )}
              {jornadas && <span className="code jornada">{dated.jornada ?? ''}</span>}
              <span className="code date">{dated.date}</span>
              {stage === 'plan' && dated.planNote ? (
                // Lo que distingue al plan de los otros del mismo día («Casa Rosada»); el lugar ya lo dice su reporte.
                <span className="title plan-note">{dated.planNote}</span>
              ) : (
                <>
                  {dated.place && <span className={`title place${isLoc(dated.place) ? ' loc' : ''}`}>{dated.place}</span>}
                  {dated.note && <span className="note">{dated.note}</span>}
                </>
              )}
            </span>
          ) : split ? (
            <span className="label">
              {/* El número de una escena va en el color de las escenas (D773); el de un episodio o una carpeta, no. */}
              <span className={kinds.kindOf(page.id).kind === 'scene' ? 'code scene' : 'code'}>{split.code}</span>
              <span className={`title${placeClass(kinds.kindOf(page.id).kind)}`}>{split.name}</span>
            </span>
          ) : (
            <span className="label">
              {/* Sin tooltip: el nombre ya se ve en la fila (D794). Una locación en su azul y un decorado en su violeta
                  (D823). */}
              <span className={`title${page.title ? placeClass(kinds.kindOf(page.id).kind) : ' untitled'}`}>{page.title || tr('common.untitled')}</span>
            </span>
          )}
          <HoldsTag pageId={page.id} />
          <MentionTreeDot pageId={page.id} collapsed={children.length > 0 && !open} />
          <LinkTreeIcon pageId={page.id} />
          <LinkAsideTreeIcon pageId={page.id} />
          <OfflineBadge kind="page" id={page.id} />
          <span className="row-actions">
            <button
              aria-label={tr('sidebar.moreActions')}
              tabIndex={tabIndex}
              onClick={(e) => {
                e.stopPropagation();
                const anchor = e.currentTarget;
                setMenu(menu?.id === page.id ? null : { id: page.id, position: menuBelow(anchor, PAGE_MENU_WIDTH), anchor });
              }}
            >
              <MoreIcon size={16} />
            </button>
            {perms.canManagePage(page.id) && (
              <button
                aria-label={tr('sidebar.addInside')}
                data-tip={tr('sidebar.addInside')}
                tabIndex={tabIndex}
                onClick={(e) => {
                  e.stopPropagation();
                  void newPage(page.id);
                }}
              >
                <PlusIcon size={16} />
              </button>
            )}
          </span>
        </div>
        {open && children.length > 0 && renderList(page.id, children, depth + 1, 'group')}
      </li>
    );
  }

  const roots = tree.roots(projectId);
  // Las filas que se ven, en orden: lo que recorren las flechas (ninguna con *Pages* plegada).
  const rows = pagesClosed ? [] : visibleRows(roots, (id) => tree.children(id), expanded);
  const visible = new Set(rows.map((r) => r.id));
  const tabStop =
    focusId && visible.has(focusId) ? focusId : activeId && visible.has(activeId) ? activeId : (rows[0]?.id ?? null);

  // Si la fila con el foco desaparece (otra persona la mandó a la papelera o la movió adentro de una cerrada),
  // el foco caería al documento y las flechas dejarían de responder: pasa a la fila visible que le seguía (o
  // a la anterior, si era la última). Solo si el foco estaba en el árbol y no se fue a otro lado.
  const shownBefore = useRef<string[]>([]);
  useEffect(() => {
    const before = shownBefore.current;
    shownBefore.current = rows.map((r) => r.id);
    if (!focusId || visible.has(focusId)) return;
    const at = before.indexOf(focusId);
    const lost = !document.activeElement || document.activeElement === document.body;
    const neighbor =
      at < 0 || !lost
        ? undefined
        : (before.slice(at + 1).find((id) => visible.has(id)) ?? before.slice(0, at).reverse().find((id) => visible.has(id)));
    if (neighbor) focusRow(neighbor, true);
    else setFocusId(null);
  });

  // ↑, ↓, Inicio y Fin siguen en el árbol aunque el foco no haya quedado en una fila (se fue al documento, o quedó en lo
  // que se desplaza), si lo último que se tocó fue el árbol: el navegador, si no, desplaza la barra. Arranca en la fila
  // del foco o en la de la página abierta (`tabStop`).
  /** Lleva el foco a la fila y la abre (al instante, o al soltar la tecla), con la marca de elegida ya puesta. */
  function goTree(id: string, repeat: boolean) {
    focusRow(id);
    setBrowsing(id);
    opener.request(id, repeat);
  }
  // Las flechas que llegan desde el *Overview* a una fila del árbol.
  const treeGo = useRef<(go: TreeGo) => void>(() => undefined);
  treeGo.current = (go) => goTree(go.id, go.repeat);
  useEffect(() => {
    const on = (e: Event) => treeGo.current((e as CustomEvent<TreeGo>).detail);
    window.addEventListener(TREE_GO_EVENT, on);
    // Y las que se van al *Overview*: ninguna fila del árbol queda marcada hasta que se abra algo.
    const away = () => setBrowsing('');
    window.addEventListener(TREE_AWAY_EVENT, away);
    return () => {
      window.removeEventListener(TREE_GO_EVENT, on);
      window.removeEventListener(TREE_AWAY_EVENT, away);
    };
  }, []);
  const lostKey = useRef<(e: globalThis.KeyboardEvent) => void>(() => undefined);
  lostKey.current = (e) => {
    if (!isTreeMoveKey(e.key) || !isPlainKey(e) || !tabStop) return;
    e.preventDefault();
    const action = treeKeyAction(rows, tabStop, e.key);
    if (action.type !== 'go') return;
    goTree(action.id, e.repeat);
  };
  useEffect(() => {
    let touchedTree = false;
    const onDown = (e: Event) => {
      const target = e.target instanceof Element ? e.target : null;
      touchedTree = !!target && !!navEl.current?.contains(target) && !!target.closest('[role="tree"]');
      if (target && navEl.current?.contains(target)) settle.current = null;
    };
    const onFocus = (e: FocusEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target && target !== document.body && target !== navEl.current && !target.closest('[role="tree"]')) touchedTree = false;
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!touchedTree || e.defaultPrevented || document.querySelector(MODAL)) return;
      const focus = document.activeElement;
      if (focus && focus !== document.body && focus !== navEl.current) return;
      lostKey.current(e);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus, true);
    return () => {
      document.removeEventListener('focusin', onFocus, true);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  // Con un link público: sin proyectos, papelera ni cuenta (Docs/Doc_Link_Publico.md, 3.5).
  const linkMode = useLinkMode();
  const canCreateRoot = perms.canCreateIn(null, projectId);

  return (
    <nav className="sidebar" aria-label={tr('sidebar.pages')}>
      {/* Arriba y abajo quedan fijos: solo el selector de proyectos y la cuenta. Lo demás, desde *All synced*, se desplaza
          en `.sidebar-scroll` (pedido de Lega, 2026-10-27, D802). */}
      <div className="sidebar-top">{linkMode ? <LinkHeader /> : <ProjectSwitcher />}</div>
      <div
        ref={navEl}
        className="sidebar-scroll"
        onScroll={() => {
          const nav = navEl.current;
          const mine = Date.now() <= ownScrollUntil.current || (!!nav && Math.abs(nav.scrollTop - ownTop.current) < 1);
          if (!mine) lastManualScroll.current = Date.now();
          scrollbar.scrolled();
        }}
        onMouseMove={scrollbar.moved}
        onMouseLeave={scrollbar.left}
      >
      <SyncBadge />
      <OfflineLine />
      {/* *Overview* (Docs/Doc_Relaciones.md, secciones 12 y 21; D772): locaciones, escenas, días y pendientes, armados con
          lo que dicen las páginas; solo en un proyecto con escenas, locaciones o días. */}
      {!linkMode && <OverviewNav />}

      {/* *Pages* en su propio bloque: su título (y cada madre abierta) queda arriba al bajar mientras se ve lo de
          adentro, y se va con el final del árbol (pedido de Lega, 2026-10-25). */}
      <div className="pages-section">
      <div className="section-title sticky-head" data-tour="pages">
        <button
          className="nav-title pages-head"
          aria-expanded={!pagesClosed}
          onClick={() => foldPages(!pagesClosed)}
          onKeyDown={(e) => {
            // Las flechas siguen por la barra desde el título (no la desplazan): ↓ a su primera fila, ↑ al *Overview*.
            if (!isPlainKey(e.nativeEvent)) return;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const next = sidebarStepAround(e.currentTarget, e.key === 'ArrowDown' ? 1 : -1);
              if (next) goToRow(next, e.repeat);
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.preventDefault();
          }}
        >
          <span className="nav-title-label">{tr('sidebar.pages')}</span>
          {pagesClosed ? <ExpandIcon size={14} /> : <CollapseIcon size={14} />}
        </button>
        <span className="section-actions">
          {/* Buscar en el proyecto (Docs/Doc_Buscar.md, sección 7): a la izquierda del "+", también para quien
              no puede crear páginas. */}
          <button
            className="search-button"
            aria-label={tr('sidebar.search', { shortcut: shortcutLabel('search') })}
            aria-haspopup="dialog"
            aria-expanded={search.isOpen()}
            data-tip={tipRows([{ shortcut: 'search', action: tr('sidebar.searchAct') }])}
            onClick={() => search.setOpen(true)}
          >
            <SearchIcon size={16} />
          </button>
          {canCreateRoot && (
            <button aria-label={tr('common.newPage')} data-tip={tr('common.newPage')} onClick={() => void newPage(null)}>
              <PlusIcon size={16} />
            </button>
          )}
        </span>
      </div>
      {!pagesClosed && renderList(null, roots, 0, 'tree')}
      {!pagesClosed && roots.length === 0 && canCreateRoot && (
        <button className="empty-new" onClick={() => void newPage(null)}>
          <PlusIcon size={16} /> {tr('common.newPage')}
        </button>
      )}
      </div>

      {!linkMode && <IndexProgress />}
      </div>
      {/* La cuenta y, solo en el teléfono, la ayuda a su derecha (en la computadora está en la barra de arriba, D801). La
          papelera está en el selector de proyectos (una sola, con proyectos, páginas y archivos). Con un link público no
          hay cuenta: el pie queda solo en el teléfono, con la ayuda. */}
      <div className={`sidebar-footer${linkMode ? ' only-mobile' : ''}`}>
        {!linkMode && <button
          ref={accountButton}
          className="account-button"
          aria-haspopup="dialog"
          aria-expanded={!!account}
          onClick={(e) => {
            if (account) return setAccount(null);
            const r = e.currentTarget.getBoundingClientRect();
            setAccount({ bottom: window.innerHeight - r.top + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 308)) });
          }}
        >
          <span className="avatar">{user.email.charAt(0) || '?'}</span>
          <span className="email">{user.email}</span>
          <AccountIcon size={16} />
        </button>}
        <HelpButton where="drawer" />
      </div>

      {account && (
        <AccountMenu
          position={account}
          anchor={accountButton.current}
          onClose={() => setAccount(null)}
          onDrive={() => setDrive({ result: null })}
          onMembers={() => setMembers(true)}
        />
      )}
      {members &&
        createPortal(
          <Part onClose={() => setMembers(false)}>
            <MembersDialog onClose={() => setMembers(false)} />
          </Part>,
          document.body,
        )}
      {sharing &&
        createPortal(
          <Part onClose={() => setSharing(null)}>
            <ShareDialog target={{ pageId: sharing }} onClose={() => setSharing(null)} />
          </Part>,
          document.body,
        )}
      {drive &&
        createPortal(
          <Part onClose={() => setDrive(null)}>
            <DriveDialogHost result={drive.result} onClose={() => setDrive(null)} />
          </Part>,
          document.body,
        )}
      {menu && (
        <PageMenu
          pageId={menu.id}
          position={menu.position}
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          onNewChild={() => void newPage(menu.id)}
          onRename={() => setRenaming(menu.id)}
          onMove={() => setMoving(menu.id)}
          onFormat={() => setFormatting(menu.id)}
          onShare={perms.canSharePage(menu.id) ? () => setSharing(menu.id) : undefined}
          onTrash={async () => {
            const id = menu.id;
            const wasOpen = !!activeId && (activeId === id || tree.isDescendant(activeId, id));
            // Primero se manda a la papelera y después se sale: si no, el inicio vuelve a la última página.
            await tree.trash(id);
            if (wasOpen) navigate('/');
          }}
        />
      )}
      {moving && <MoveDialog pageId={moving} onClose={() => setMoving(null)} />}
      {formatting && <PageFormatDialog pageId={formatting} onClose={() => setFormatting(null)} />}
    </nav>
  );
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (title: string | null, byKey: boolean) => void }) {
  const done = useRef(false);
  const finish = (value: string | null, byKey = false) => {
    if (done.current) return;
    done.current = true;
    onDone(value, byKey);
  };
  return (
    <input
      className="rename"
      autoFocus
      defaultValue={initial}
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => finish(e.currentTarget.value.trim())}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') finish(e.currentTarget.value.trim(), true);
        if (e.key === 'Escape') finish(null, true);
      }}
    />
  );
}
