import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { locale, useT } from '../i18n';
import { useLinkMode } from '../linkMode';
import { usePrefs } from '../prefs';
import { mapPath, navigate, pagePath, useRoute, useSearchParam, type MapTab } from '../router';
import { usePermissions, useServices, useTree } from '../services';
import { CollapseIcon, ExpandIcon, MoreIcon, PlusIcon } from '../ui/icons';
import { setNavOpen, useNavOpen } from '../ui/navStore';
import { useCurrentProject } from '../ui/project';
import { existingRelationsSession } from '../ui/relationsUi';
import type { SplitTitle } from '../ui/titles';
import { AUTO_COLLAPSE, isPlainKey, revealRow } from '../ui/treeNav';
import { clickedByKeys, goToRow, markOpenedFromOverview, openedFromOverview, OVERVIEW_ROW, overviewParent, overviewTarget, sidebarEdge, sidebarStep, sidebarStepAround } from '../ui/sidebarRows';
import { dayList, dayShortLabel } from './dayLive';
import { setIndex } from './liveView';
import { mergeRows } from './merge';
import { fichaOf, folderPlace, useOverviewPlaces, type FichaPart } from './overviewPlaces';
import { NewFicha } from './OverviewNew';
import { pendingSummary } from './projectMap';
import { mapPathFrom, sceneEpisodes } from './sceneMentions';
import { useSlashDraft } from './slashDraft';
import './mapNav.css';
import './scenesNav.css';

// *Overview* en la barra lateral (Docs/Doc_Relaciones.md, secciones 12 y 21; D772): un solo bloque que arma la app con
// lo que dicen las páginas, con sus partes adentro, las mismas pestañas de la vista del centro: *Locations*, *Sets*,
// *Scenes*, *Shoot days*, *Shots* (D813: solo la vista, sin lista, como *Pending*) y *Pending*. Reemplaza a la fila *Map* y a la sección *Scenes*, que eran hermanas aunque las
// escenas son una parte del mapa. Como en el árbol de páginas: clic en el nombre abre su vista (y despliega su lista);
// la flecha solo pliega o despliega. Una sola parte abierta a la vez (pedido de Lega): abrir una cierra las otras. Sale
// del registro de lo que la persona ve (no arma el mapa entero), aparece solo en un proyecto con escenas, locaciones o
// días, y lo plegado se recuerda por proyecto en este dispositivo. Con un link público no está.
//
// Las filas de *Scenes*, *Locations* y *Sets* son las fichas (Plan_Fichas_Cuaderno.md, parte 1; D813): cada una es su
// página, con las mismas filas del árbol de *Pages* (`FichaRows`, las dibuja `Sidebar`), y *Pages* no las dibuja. La
// parte *Scouting* se sacó: repetía `2 | Scouting Reports` uno a uno (los scoutings viven en *Pages*).

const FOLD_KEY = 'shotdocs-overview-nav';
/** Cuántas filas de una lista se dibujan antes de «Show N more» (ERSO tiene episodios de 40 a 60). */
export const OVERVIEW_PAGE = 60;

type Part = 'locations' | 'sets' | 'scenes' | 'days';
/** Las partes que son solo una vista del centro, sin lista en la barra. */
type ViewPart = 'shots' | 'pending';
const isViewPart = (part: string): part is ViewPart => part === 'shots' || part === 'pending';
const PARTS: readonly Part[] = ['locations', 'sets', 'scenes', 'days'];

/** Las filas de las fichas: las del árbol de *Pages*, con su menú, su «+», el arrastre y el teclado (`Sidebar.tsx`). */
export interface FichaRows {
  /** La fila de la página (y lo desplegado adentro), o `null` si no está en el árbol. `label`: el número y el nombre. */
  row(pageId: string, depth: number, label: SplitTitle | null): ReactNode;
  /** Lo que hace el árbol de *Pages* cuando el foco se va de una lista. */
  onBlur(e: FocusEvent<HTMLUListElement>): void;
  /** Abre el menú ⋯ de una página (la carpeta escondida de una parte o de un episodio) debajo de `anchor`. */
  menu(pageId: string, anchor: HTMLElement): void;
}

/**
 * Lo plegado de un proyecto: el bloque entero, la parte abierta (una sola) y el episodio abierto de *Scenes* (uno solo,
 * D745). De fábrica, el bloque abierto con *Scenes* desplegada y sus episodios cerrados, como era la sección *Scenes*.
 */
interface Fold {
  closed: boolean;
  part: Part | null;
  eps: string[];
}

function readAll(): Record<string, Partial<Fold>> {
  try {
    const all = JSON.parse(localStorage.getItem(FOLD_KEY) ?? '{}') as unknown;
    return all && typeof all === 'object' && !Array.isArray(all) ? (all as Record<string, Partial<Fold>>) : {};
  } catch {
    return {};
  }
}

export function readFold(projectId: string): Fold {
  const f = readAll()[projectId];
  return {
    closed: f?.closed === true,
    part: f && 'part' in f ? (PARTS.includes(f.part as Part) ? (f.part as Part) : null) : 'scenes',
    eps: Array.isArray(f?.eps) ? f.eps.filter((x): x is string => typeof x === 'string') : [],
  };
}

function writeFold(projectId: string, fold: Fold): void {
  try {
    const all = readAll();
    all[projectId] = fold;
    localStorage.setItem(FOLD_KEY, JSON.stringify(all));
  } catch {
    // Recordar lo plegado es solo una comodidad.
  }
}

/** Las partes con fichas, que tienen su «+» (D813), y lo que dice ese «+». */
const fichaPart = (part: string): part is FichaPart => part === 'scenes' || part === 'locations' || part === 'sets';
const NEW_LABEL = { scenes: 'sidebar.newScene', locations: 'sidebar.newLocation', sets: 'sidebar.newSet' } as const;

/** Un clic común (no Ctrl/⌘, Shift ni la rueda, que abren otra pestaña como cualquier link). */
const plainClick = (e: MouseEvent) => !(e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0);

export function OverviewNav({ fichaRows }: { fichaRows: FichaRows }) {
  const link = useLinkMode();
  const services = useServices();
  const session = link ? null : existingRelationsSession(services);
  if (!session) return null;
  return <OverviewFor session={session} fichaRows={fichaRows} />;
}

function OverviewFor({ session, fichaRows }: { session: NonNullable<ReturnType<typeof existingRelationsSession>>; fichaRows: FichaRows }) {
  const tr = useT();
  const route = useRoute();
  const sceneQuery = useSearchParam('scene');
  const projectId = useCurrentProject();
  // Un clic en una parte la despliega solo con *Expand subpages: On click*, como una carpeta de *Pages* (D737).
  const { expandSubpages } = usePrefs();
  const tree = useTree();
  const revision = useSyncExternalStore(session.relations.subscribe, session.relations.getRevision);
  // Lo que se tipea en el menú `/` de escenas no cuenta mientras el menú está abierto (D568).
  useSlashDraft();
  const snap = session.relations.snapshot(projectId);
  const [fold, setFold] = useState<Fold>(() => readFold(projectId));
  // Cuántas se muestran de cada lista; no se recuerda.
  const [shown, setShown] = useState<Record<string, number>>({});
  // La parte donde se está creando una ficha con su «+».
  /** Dónde está abierto el campo de una ficha nueva: una parte (`scenes`) o un episodio (`ep:105`). */
  const [adding, setAdding] = useState<string | null>(null);
  const perms = usePermissions();
  useEffect(() => {
    setFold(readFold(projectId));
    setShown({});
  }, [projectId]);
  const update = (next: Fold) => {
    setFold(next);
    writeFold(projectId, next);
  };

  const treeRevision = tree.getRevision();
  // Solo el registro (no el mapa entero): cuesta lo mismo con 226 escenas que con 6. Los títulos, del árbol.
  const lists = useMemo(() => {
    if (!snap) return null;
    const title = (id: string) => tree.get(id)?.title;
    const scenes = sceneEpisodes(snap.registry.scenes.values(), title);
    const locations = [...snap.registry.locations.values()].sort((a, b) => a.name.localeCompare(b.name, locale()));
    const days = dayList({ snap, title, content: () => undefined });
    const sets = [...setIndex({ snap, title, content: () => undefined }).rows].sort((a, b) => a.name.localeCompare(b.name, locale()));
    return { scenes, locations, sets, days };
  }, [snap, revision, tree, treeRevision]); // eslint-disable-line react-hooks/exhaustive-deps

  const tab: MapTab | null = route.name === 'map' ? route.tab : null;
  const activeScene = tab === 'scenes' ? sceneQuery : null;
  const activePage = route.name === 'page' ? route.id : null;
  // La ficha abierta (o la que tiene adentro la página abierta): su parte y su episodio se despliegan, se abra como se abra.
  const places = useOverviewPlaces();
  const activeFicha = fichaOf(places, tree, activePage);
  const fichaInfo = activeFicha ? (places?.fichas.get(activeFicha) ?? null) : null;
  // La carpeta escondida de una parte o de un episodio, abierta por la búsqueda o un link: se marca su parte o su episodio.
  const folderInfo = folderPlace(places, activePage);
  const homeInfo = fichaInfo ?? folderInfo;
  const activeEp = activeScene && lists ? (lists.scenes.find((g) => g.scenes.some((s) => s.code === activeScene))?.ep ?? null) : null;

  /** Cuántas tiene cada parte: una parte vacía no se dibuja. */
  const sizes: Record<Part, number> = {
    locations: lists?.locations.length ?? 0,
    sets: lists?.sets.length ?? 0,
    scenes: lists?.scenes.reduce((n, g) => n + g.scenes.length, 0) ?? 0,
    days: lists?.days.length ?? 0,
  };
  /** La parte que abre el título: la desplegada o, sin ninguna, la primera que tiene algo. */
  const headPart: Part = (fold.part && sizes[fold.part] > 0 ? fold.part : PARTS.find((p) => sizes[p] > 0)) ?? 'locations';

  // La vista del centro manda: al abrir una pestaña (desde acá, desde la vista o por la dirección) se despliega su parte
  // y se pliegan las otras; al abrir una escena, también su episodio. Después se puede plegar. Una pestaña vacía (un
  // proyecto sin locaciones en `/map`) no pliega lo que estaba: esa parte no se dibuja.
  // La parte a la que se llegó con las flechas: su vista se abre sin desplegarla (`browsePart`).
  const browsedPart = useRef<MapTab | null>(null);
  useEffect(() => {
    if (browsedPart.current && browsedPart.current === tab && !activeScene) {
      browsedPart.current = null;
      return;
    }
    browsedPart.current = null;
    if (!tab || tab === 'pending' || tab === 'shots' || tab === 'scouting' || sizes[tab] === 0) return;
    const f = readFold(projectId);
    const eps = activeEp !== null ? [activeEp] : f.eps;
    if (f.part !== tab || eps.join() !== f.eps.join() || f.closed) update({ closed: false, part: tab, eps });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, activeScene, activeEp, projectId, sizes.locations, sizes.sets, sizes.scenes, sizes.days]);

  // La fila de la escena abierta se lleva a la vista al abrirla y al abrir el cajón del teléfono, debajo de lo que queda
  // pegado arriba (`revealRow`, D771). Si su parte o su episodio estaban plegados, la fila aparece un dibujo después (el
  // efecto de arriba los despliega): queda pendiente hasta que exista.
  // El teclado, igual que en el árbol de *Pages* (pedido de Lega, D806; `sidebarRows.ts`): ↑/↓ recorren la barra entera,
  // *Pages* incluido, y abren lo anterior o lo siguiente (con la tecla apretada, al soltar); → despliega o pasa al
  // primer hijo; ← pliega o sube a la madre. Las partes y los episodios son las carpetas; las filas, las hojas.
  const onRowsKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!isPlainKey(e.nativeEvent)) return;
    const from = e.target instanceof Element ? e.target.closest<HTMLElement>(OVERVIEW_ROW) : null;
    if (!from) {
      // El título, su botón de plegar o sus pendientes: ↓ entra a la primera fila; ← → no hacen nada (no desplazan).
      if (!(e.target instanceof Element) || !e.target.closest('.ov-head, .ov-fold')) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = sidebarStepAround(e.target, e.key === 'ArrowDown' ? 1 : -1);
        if (next) goToRow(next, e.repeat);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.preventDefault();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = sidebarStep(from, e.key === 'ArrowDown' ? 1 : -1);
      if (next) goToRow(next, e.repeat);
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const edge = sidebarEdge(from, e.key === 'End');
      if (edge && edge !== from) goToRow(edge, false);
      return;
    }
    // Espacio abre como Enter (un link solo se abre con Enter).
    if (e.key === ' ' && from instanceof HTMLAnchorElement) {
      e.preventDefault();
      from.click();
      return;
    }
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const right = e.key === 'ArrowRight';
    const toChild = () => {
      const next = sidebarStep(from, 1);
      if (next) goToRow(next, false);
    };
    const toParent = () => {
      const up = overviewParent(from);
      if (up) goToRow(up, false);
    };
    // Plegar lo que tiene adentro lo abierto lo lleva a lo plegado, como plegar una madre de la página abierta en *Pages*:
    // se abre la vista de la parte (sin volver a desplegarla).
    const holdsOpen = () => !!from.closest('li')?.querySelector('a.scene-nav-row.active, .tree-row.active');
    const part = from.dataset.part as Part | ViewPart | undefined;
    const ep = from.dataset.ep;
    if (part) {
      if (isViewPart(part)) return;
      const open = fold.part === part;
      if (right) {
        if (open) toChild();
        else update({ ...fold, closed: false, part });
      } else if (open) {
        const inside = holdsOpen();
        update({ ...fold, part: null });
        if (inside) browsePart(part);
      }
    } else if (ep !== undefined) {
      const open = fold.eps.includes(ep);
      if (right) {
        if (open) toChild();
        else update({ ...fold, eps: [ep] });
      } else if (open) {
        const inside = holdsOpen();
        update({ ...fold, eps: [] });
        if (inside) browsePart('scenes');
      } else {
        toParent();
      }
    } else if (!right) {
      toParent();
    }
  };
  // Lo que se abre desde acá lo dice (`markOpenedFromOverview`): *Pages* se pliega y no se mueve.
  const onRowsClick = (e: MouseEvent) => {
    const link = e.target instanceof Element ? e.target.closest('a') : null;
    if (link && plainClick(e)) markOpenedFromOverview(overviewTarget(link.getAttribute('href') ?? ''));
  };
  // Una ficha abierta (o algo adentro de una), se abra como se abra, despliega su parte y su episodio: su fila se ve y
  // queda marcada (D813; la lleva a la vista `Sidebar`, como en *Pages*). Una página abierta por otro camino (el árbol,
  // un link, la búsqueda, atrás) pliega lo de acá (colapso automático).
  useEffect(() => {
    if (!activePage) return;
    const f = readFold(projectId);
    if (homeInfo) {
      const eps = homeInfo.ep !== null ? [homeInfo.ep] : f.eps;
      if (f.closed || f.part !== homeInfo.part || eps.join() !== f.eps.join()) update({ closed: false, part: homeInfo.part, eps });
      return;
    }
    if (!AUTO_COLLAPSE || openedFromOverview(activePage)) return;
    if (f.part !== null || f.eps.length) update({ ...f, part: null, eps: [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage, projectId, homeInfo?.part, homeInfo?.ep]);

  // La escena abierta en el mapa (`/map/scenes?scene=…`): su fila se lleva a la vista al abrirla y al abrir el cajón
  // del teléfono, debajo de lo que queda pegado arriba (`revealRow`, D771). Si su parte o su episodio estaban plegados,
  // la fila aparece un dibujo después (el efecto de arriba los despliega): queda pendiente hasta que exista.
  const navOpen = useNavOpen();
  const toReveal = useRef(false);
  const mapScenePage = activeScene && lists ? (lists.scenes.flatMap((g) => g.scenes).find((s) => s.code === activeScene)?.pageId ?? null) : null;
  useEffect(() => {
    toReveal.current = !!mapScenePage;
  }, [mapScenePage, navOpen]);
  useEffect(() => {
    const row = mapScenePage ? document.querySelector<HTMLElement>(`.ov-nav .tree-row[data-page="${CSS.escape(mapScenePage)}"]`) : null;
    const nav = row?.closest<HTMLElement>('.sidebar-scroll');
    if (!toReveal.current || !row || !nav) return;
    toReveal.current = false;
    revealRow(row, nav);
  }, [mapScenePage, navOpen, fold.part, fold.eps.join(), fold.closed]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!snap || !lists) return null;
  const typed =
    snap.registry.scenes.size > 0 ||
    snap.registry.locations.size > 0 ||
    snap.registration.sets.length > 0 ||
    [...snap.registration.roles.values()].some((r) => r.entity?.kind === 'day' && !r.excluded);
  if (!typed) return null;
  // El mismo número que la pestaña *Pending*: números que no existen, duplicadas, secciones sin número y lo que llegó
  // tarde a una página unida (E16).
  const pending = pendingSummary({ snap, title: (id) => tree.get(id)?.title }).total + mergeRows(tree, projectId).length;
  const counts = sizes;
  // Crear una ficha pide poder crear en el proyecto (las guardas de `createEntity.ts` miran el resto).
  const canCreate = perms.canCreateIn(null, projectId);

  /**
   * Abre una pestaña del mapa (en la vista de una escena, la misma ruta: con `mapPathFrom`, D746). Como una página, el
   * nombre cierra el cajón del teléfono, también de una pestaña a otra (ahí la ruta no cambia de nombre y el cajón no se
   * cerraría solo); para ver la lista en el cajón está la flecha.
   */
  const go = (to: MapTab) => {
    navigate(mapPathFrom(mapPath(to), location));
    setNavOpen(false);
  };
  const openPart = (part: Part) => {
    update({ ...fold, closed: false, part });
    go(part);
  };
  /**
   * Llegar a una parte con las flechas: abre su vista sin desplegarla y pliega las demás, como una carpeta de *Pages*
   * (la que ya estaba desplegada sigue así).
   */
  const browsePart = (part: Part) => {
    const f = readFold(projectId);
    if (f.part !== null && f.part !== part) update({ ...f, part: null, eps: [] });
    if (tab === part && !activeScene) return;
    browsedPart.current = part;
    go(part);
  };
  // *Shots* y *Pending* no tienen lista: llegar ahí (con las flechas o un clic) pliega la parte desplegada, como las demás
  // partes.
  const openView = (part: ViewPart) => {
    const f = readFold(projectId);
    if (f.part !== null) update({ ...f, part: null, eps: [] });
    go(part);
  };
  const togglePart = (part: Part) => update({ ...fold, part: fold.part === part ? null : part });

  /** Una lista con «Show N more»; `keep` es la fila que tiene que verse aunque esté más abajo (la abierta). */
  const more = (key: string, total: number, keep: number) => {
    const n = Math.max(shown[key] ?? OVERVIEW_PAGE, keep + 1);
    const rest = total - n;
    return {
      n,
      button:
        rest > 0 ? (
          <li>
            <button className="scene-nav-more" onClick={() => setShown({ ...shown, [key]: n + OVERVIEW_PAGE })}>
              {tr('sidebar.scenesMore', { count: Math.min(rest, OVERVIEW_PAGE) })}
            </button>
          </li>
        ) : null,
    };
  };

  const openPage = (e: MouseEvent, pageId: string) => {
    if (!plainClick(e)) return;
    e.preventDefault();
    navigate(pagePath(pageId));
  };

  /** Una lista de fichas: un árbol de WAI-ARIA con las filas de *Pages* (`FichaRows`). */
  const fichaList = (className: string, label: string, rows: ReactNode, button: ReactNode) => (
    <ul className={`scene-nav-list ov-fichas ${className}`} role="tree" aria-label={label} onBlur={fichaRows.onBlur}>
      {rows}
      {button}
    </ul>
  );

  const sceneList = (key: string, scenes: (typeof lists.scenes)[number]['scenes']) => {
    const keep = scenes.findIndex((s) => (activeFicha ? s.pageId === activeFicha : s.code === activeScene));
    const { n, button } = more(`s:${key}`, scenes.length, keep);
    // El número de la escena (el canónico: `105_027`) y su nombre, como en la cabecera de la escena.
    const rows = scenes.slice(0, n).map((s) => (s.pageId ? fichaRows.row(s.pageId, 0, { code: s.code, name: s.title }) : null));
    return fichaList('ov-scenes', tr('sidebar.scenes'), rows, button);
  };

  const scenesBody = () => {
    // Un solo grupo va sin el renglón del episodio, salvo que el episodio tenga su carpeta: esa carpeta no está en *Pages*
    // y su ⋯ es el único camino a *Share*, *Type* y *Move to…* (auditoría final de D813).
    const flat = lists.scenes.length === 1 && !places?.episodes.get(lists.scenes[0].ep);
    if (flat) return sceneList(lists.scenes[0].ep, lists.scenes[0].scenes);
    return (
      <ul className="scene-nav-eps">
        {lists.scenes.map((g) => {
          const isOpen = fold.eps.includes(g.ep);
          const folder = places?.episodes.get(g.ep);
          const on = !!folder && folderInfo?.ep === g.ep;
          const addKey = `ep:${g.ep}`;
          return (
            <li key={g.ep} className="ov-ep">
              <button
                className={`scene-nav-ep${isOpen ? ' sticky-head' : ''}${on ? ' on' : ''}`}
                data-ep={g.ep}
                aria-expanded={isOpen}
                aria-current={on ? 'page' : undefined}
                onClick={() => update({ ...fold, eps: isOpen ? [] : [g.ep] })}
              >
                {isOpen ? <CollapseIcon size={14} /> : <ExpandIcon size={14} />}
                <span className="label">{g.ep ? tr('live.episode', { ep: g.ep }) : tr('sidebar.scenesNoEpisode')}</span>
                <span className="scene-nav-n">{g.scenes.length}</span>
              </button>
              {folder && (
                // El menú de la carpeta del episodio, que en *Pages* ya no está (D813).
                <button
                  className="ov-ep-more"
                  aria-label={tr('sidebar.folderActions')}
                  data-tip={tr('sidebar.folderActionsTip', { title: tree.get(folder)?.title ?? '' })}
                  tabIndex={-1}
                  onClick={(e) => fichaRows.menu(folder, e.currentTarget)}
                >
                  <MoreIcon size={14} />
                </button>
              )}
              {canCreate && g.ep && (
                // Una escena de este episodio: alcanza con su número (`27` → `105_027`).
                <button
                  className={`ov-ep-add${folder ? '' : ' alone'}`}
                  aria-label={tr('sidebar.newSceneIn', { ep: g.ep })}
                  data-tip={tr('sidebar.newSceneIn', { ep: g.ep })}
                  tabIndex={-1}
                  onClick={() => {
                    if (!isOpen) update({ ...fold, eps: [g.ep] });
                    setAdding(addKey);
                  }}
                >
                  <PlusIcon size={14} />
                </button>
              )}
              {adding === addKey && (
                <ul className="scene-nav-list ov-fichas">
                  <NewFicha part="scenes" ep={g.ep} projectId={projectId} onDone={() => setAdding(null)} />
                </ul>
              )}
              {isOpen && sceneList(g.ep, g.scenes)}
            </li>
          );
        })}
      </ul>
    );
  };

  const locationsBody = () => {
    const { n, button } = more('l', lists.locations.length, lists.locations.findIndex((l) => !!l.pageId && l.pageId === activeFicha));
    const rows = lists.locations.slice(0, n).map((l) =>
      l.pageId ? (
        fichaRows.row(l.pageId, 0, null)
      ) : (
        // Una locación sin página (solo nombrada): lleva a su pestaña del mapa.
        <li key={l.name} role="none">
          <a
            className="scene-nav-row"
            role="treeitem"
            href={mapPath('locations')}
            onClick={(e) => plainClick(e) && (e.preventDefault(), go('locations'))}
          >
            <span className="title">{l.name}</span>
          </a>
        </li>
      ),
    );
    return fichaList('ov-locs', tr('sidebar.locations'), rows, button);
  };

  const setsBody = () => {
    const { n, button } = more('st', lists.sets.length, lists.sets.findIndex((s) => s.pageId === activeFicha));
    const rows = lists.sets.slice(0, n).map((s) => fichaRows.row(s.pageId, 0, null));
    return fichaList('ov-sets', tr('sidebar.sets'), rows, button);
  };

  const daysBody = () => {
    const { n, button } = more('d', lists.days.length, lists.days.findIndex((d) => d.pageId === activePage));
    const labels = lists.days.map((d) => dayShortLabel(d));
    const width = Math.max(0, ...labels.map((l) => l.length));
    return (
      <ul className="scene-nav-list ov-list ov-days" style={{ '--code-w': `${width}ch` } as CSSProperties}>
        {lists.days.slice(0, n).map((d, i) => {
          const on = d.pageId === activePage;
          const title = tree.get(d.pageId)?.title ?? '';
          return (
            <li key={d.pageId}>
              <a
                className={`scene-nav-row${on ? ' active' : ''}`}
                href={pagePath(d.pageId)}
                aria-current={on ? 'page' : undefined}
                onClick={(e) => openPage(e, d.pageId)}
              >
                <span className="code">{labels[i]}</span>
                <span className={d.locs.length ? 'title locs' : 'title'}>{d.locs.join(' + ') || title}</span>
              </a>
            </li>
          );
        })}
        {button}
      </ul>
    );
  };

  /** El renglón de una parte: la flecha pliega o despliega; el resto de la fila abre su pestaña. */
  const partRow = (part: Part | ViewPart, label: string, count: ReactNode, body: (() => ReactNode) | null) => {
    const open = !isViewPart(part) && fold.part === part && !!body;
    // La vista de la parte, o su carpeta escondida abierta (D813).
    const on = (tab === part && !activeScene) || (!!folderInfo && folderInfo.part === part && folderInfo.ep === null);
    const name = (
      <a
        className="ov-part-name"
        href={mapPath(part)}
        aria-current={on ? 'page' : undefined}
        onClick={(e) => {
          if (!plainClick(e)) return;
          e.preventDefault();
          e.stopPropagation();
          if (isViewPart(part)) openView(part);
          else if (clickedByKeys() || expandSubpages !== 'onClick') browsePart(part);
          else openPart(part);
        }}
        data-part={part}
      >
        {label}
      </a>
    );
    return (
      <li key={part}>
        <div
          className={`ov-part${open ? ' sticky-head' : ''}${on ? ' on' : ''}`}
          onClick={(e) => {
            if (!plainClick(e)) return;
            // El foco queda en la parte, como en una fila de *Pages*: las flechas siguen desde acá.
            e.currentTarget.querySelector<HTMLElement>('a.ov-part-name')?.focus({ preventScroll: true });
            if (isViewPart(part)) openView(part);
            else if (expandSubpages !== 'onClick') browsePart(part);
            else openPart(part);
          }}
        >
          {body ? (
            <button
              className="toggle"
              aria-expanded={open}
              aria-label={open ? tr('sidebar.collapse') : tr('sidebar.expand')}
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                e.currentTarget.closest('.ov-part')?.querySelector<HTMLElement>('a.ov-part-name')?.focus({ preventScroll: true });
                togglePart(part as Part);
              }}
            >
              {open ? <CollapseIcon size={14} /> : <ExpandIcon size={14} />}
            </button>
          ) : (
            <span className="toggle-space" />
          )}
          {name}
          {count}
          {fichaPart(part) && places?.folders.get(part)?.[0] && (
            // El menú de la carpeta de la parte (*Type*, *Share*, *Leave out of relations*): en *Pages* ya no está (D813).
            <button
              className="ov-more"
              aria-label={tr('sidebar.folderActions')}
              data-tip={tr('sidebar.folderActionsTip', { title: tree.get(places.folders.get(part)![0])?.title ?? '' })}
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                fichaRows.menu(places.folders.get(part)![0], e.currentTarget);
              }}
            >
              <MoreIcon size={14} />
            </button>
          )}
          {fichaPart(part) && canCreate && (
            <button
              className="ov-add"
              aria-label={tr(NEW_LABEL[part])}
              data-tip={tr(NEW_LABEL[part])}
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                if (!open) update({ ...fold, closed: false, part });
                setAdding(part);
              }}
            >
              <PlusIcon size={14} />
            </button>
          )}
        </div>
        {(open || !body) && adding === part && (
          <ul className="scene-nav-list ov-fichas">
            <NewFicha part={part as FichaPart} projectId={projectId} onDone={() => setAdding(null)} />
          </ul>
        )}
        {open && body!()}
      </li>
    );
  };

  const codeWidth = Math.max(0, ...lists.scenes.flatMap((g) => g.scenes.map((s) => s.code.length)));
  const parts: ReactNode[] = [];
  // Una parte de fichas vacía aparece igual para quien puede crear, sin número ni flecha: su «+» crea la primera (D813).
  const fichaPartRow = (part: FichaPart, label: string, n: number, body: () => ReactNode) =>
    (n || canCreate) && parts.push(partRow(part, label, n ? <span className="scene-nav-n">{n}</span> : null, n ? body : null));
  fichaPartRow('locations', tr('sidebar.locations'), counts.locations, locationsBody);
  fichaPartRow('sets', tr('sidebar.sets'), counts.sets, setsBody);
  fichaPartRow('scenes', tr('sidebar.scenes'), counts.scenes, scenesBody);
  if (counts.days) parts.push(partRow('days', tr('sidebar.days'), <span className="scene-nav-n">{counts.days}</span>, daysBody));
  // La tabla de planos (D813): solo la vista del centro, como *Pending* (la barra no tiene el contenido de las páginas).
  if (counts.scenes) parts.push(partRow('shots', tr('sidebar.shots'), null, null));
  if (pending > 0) parts.push(partRow('pending', tr('sidebar.pending'), <span className="map-nav-count">{pending}</span>, null));

  return (
    <div className="scene-nav ov-nav" style={{ '--code-w': `${codeWidth}ch` } as CSSProperties} onKeyDown={onRowsKey} onClickCapture={onRowsClick}>
      <div
        className="ov-head nav-title sticky-head"
        onClick={(e) => {
          if (!plainClick(e)) return;
          update({ ...fold, closed: false });
          go(headPart);
          // El *Overview* está arriba de todo: con la barra desplazada, lo que se abre quedaría fuera de la vista.
          e.currentTarget.closest('.sidebar-scroll')?.scrollTo?.({ top: 0 });
        }}
      >
        <a
          className="nav-title-label"
          href={mapPath(headPart)}
          data-tip={tr('sidebar.mapTip')}
          onClick={(e) => {
            if (!plainClick(e)) return;
            e.preventDefault();
          }}
        >
          {tr('sidebar.map')}
        </a>
        <span className="ov-auto">{tr('sidebar.auto')}</span>
        <button
          className="ov-fold"
          aria-expanded={!fold.closed}
          aria-label={fold.closed ? tr('sidebar.expand') : tr('sidebar.collapse')}
          onClick={(e) => {
            e.stopPropagation();
            update({ ...fold, closed: !fold.closed });
          }}
        >
          {fold.closed ? <ExpandIcon size={14} /> : <CollapseIcon size={14} />}
        </button>
        {pending > 0 && (
          <a
            className="map-nav-count"
            href={mapPath('pending')}
            onClick={(e) => {
              e.stopPropagation();
              if (!plainClick(e)) return;
              e.preventDefault();
              go('pending');
            }}
          >
            {tr('sidebar.mapPending', { count: pending })}
          </a>
        )}
      </div>
      {!fold.closed && <ul className="ov-parts">{parts}</ul>}
    </div>
  );
}
