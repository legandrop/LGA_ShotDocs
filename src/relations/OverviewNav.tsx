import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { locale, useT } from '../i18n';
import { useLinkMode } from '../linkMode';
import { mapPath, navigate, pagePath, useRoute, useSearchParam, type MapTab } from '../router';
import { useServices, useTree } from '../services';
import { CollapseIcon, ExpandIcon } from '../ui/icons';
import { setNavOpen, useNavOpen } from '../ui/navStore';
import { useCurrentProject } from '../ui/project';
import { existingRelationsSession } from '../ui/relationsUi';
import { revealRow } from '../ui/treeNav';
import { dayList, dayShortLabel } from './dayLive';
import { mergeRows } from './merge';
import { scoutList } from './scoutList';
import { pendingSummary } from './projectMap';
import { mapPathFrom, sceneEpisodes, sceneMapPath } from './sceneMentions';
import { useSlashDraft } from './slashDraft';
import './mapNav.css';
import './scenesNav.css';

// *Overview* en la barra lateral (Docs/Doc_Relaciones.md, secciones 12 y 21; D772): un solo bloque que arma la app con
// lo que dicen las páginas, con sus partes adentro, las mismas pestañas de la vista del centro: *Locations*,
// *Scenes*, *Scouting* (los scoutings y pruebas por fecha, Plan_Estructura_Etapas.md), *Shoot days* y *Pending*. Reemplaza a la fila *Map* y a la sección *Scenes*, que eran hermanas aunque las
// escenas son una parte del mapa. Como en el árbol de páginas: clic en el nombre abre su vista (y despliega su lista);
// la flecha solo pliega o despliega. Una sola parte abierta a la vez (pedido de Lega): abrir una cierra las otras. Sale
// del registro de lo que la persona ve (no arma el mapa entero), aparece solo en un proyecto con escenas, locaciones o
// días, y lo plegado se recuerda por proyecto en este dispositivo. Con un link público no está.

const FOLD_KEY = 'shotdocs-overview-nav';
/** Cuántas filas de una lista se dibujan antes de «Show N more» (ERSO tiene episodios de 40 a 60). */
export const OVERVIEW_PAGE = 60;

type Part = 'locations' | 'scenes' | 'scouting' | 'days';
const PARTS: readonly Part[] = ['locations', 'scenes', 'scouting', 'days'];

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

/** Un clic común (no Ctrl/⌘, Shift ni la rueda, que abren otra pestaña como cualquier link). */
const plainClick = (e: MouseEvent) => !(e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0);

export function OverviewNav() {
  const link = useLinkMode();
  const services = useServices();
  const session = link ? null : existingRelationsSession(services);
  if (!session) return null;
  return <OverviewFor session={session} />;
}

function OverviewFor({ session }: { session: NonNullable<ReturnType<typeof existingRelationsSession>> }) {
  const tr = useT();
  const route = useRoute();
  const sceneQuery = useSearchParam('scene');
  const projectId = useCurrentProject();
  const tree = useTree();
  const revision = useSyncExternalStore(session.relations.subscribe, session.relations.getRevision);
  // Lo que se tipea en el menú `/` de escenas no cuenta mientras el menú está abierto (D568).
  useSlashDraft();
  const snap = session.relations.snapshot(projectId);
  const [fold, setFold] = useState<Fold>(() => readFold(projectId));
  // Cuántas se muestran de cada lista; no se recuerda.
  const [shown, setShown] = useState<Record<string, number>>({});
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
    const scoutings = scoutList({ snap, title, content: () => undefined });
    return { scenes, locations, days, scoutings };
  }, [snap, revision, tree, treeRevision]); // eslint-disable-line react-hooks/exhaustive-deps

  const tab: MapTab | null = route.name === 'map' ? route.tab : null;
  const activeScene = tab === 'scenes' ? sceneQuery : null;
  const activePage = route.name === 'page' ? route.id : null;
  const activeEp = activeScene && lists ? (lists.scenes.find((g) => g.scenes.some((s) => s.code === activeScene))?.ep ?? null) : null;

  /** Cuántas tiene cada parte: una parte vacía no se dibuja. */
  const sizes: Record<Part, number> = {
    locations: lists?.locations.length ?? 0,
    scenes: lists?.scenes.reduce((n, g) => n + g.scenes.length, 0) ?? 0,
    scouting: lists?.scoutings.length ?? 0,
    days: lists?.days.length ?? 0,
  };
  /** La parte que abre el título: la desplegada o, sin ninguna, la primera que tiene algo. */
  const headPart: Part = (fold.part && sizes[fold.part] > 0 ? fold.part : PARTS.find((p) => sizes[p] > 0)) ?? 'locations';

  // La vista del centro manda: al abrir una pestaña (desde acá, desde la vista o por la dirección) se despliega su parte
  // y se pliegan las otras; al abrir una escena, también su episodio. Después se puede plegar. Una pestaña vacía (un
  // proyecto sin locaciones en `/map`) no pliega lo que estaba: esa parte no se dibuja.
  useEffect(() => {
    if (!tab || tab === 'pending' || sizes[tab] === 0) return;
    const f = readFold(projectId);
    const eps = activeEp !== null ? [activeEp] : f.eps;
    if (f.part !== tab || eps.join() !== f.eps.join() || f.closed) update({ closed: false, part: tab, eps });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, activeScene, activeEp, projectId, sizes.locations, sizes.scenes, sizes.scouting, sizes.days]);

  // La fila de la escena abierta se lleva a la vista al abrirla y al abrir el cajón del teléfono, debajo de lo que queda
  // pegado arriba (`revealRow`, D771). Si su parte o su episodio estaban plegados, la fila aparece un dibujo después (el
  // efecto de arriba los despliega): queda pendiente hasta que exista.
  const navOpen = useNavOpen();
  const activeRow = useRef<HTMLAnchorElement | null>(null);
  const toReveal = useRef(false);
  useEffect(() => {
    toReveal.current = !!activeScene;
  }, [activeScene, navOpen]);
  useEffect(() => {
    const row = activeRow.current;
    const nav = row?.closest<HTMLElement>('.sidebar-scroll');
    if (!toReveal.current || !row || !nav) return;
    toReveal.current = false;
    revealRow(row, nav);
  }, [activeScene, navOpen, fold.part, fold.eps.join(), fold.closed]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!snap || !lists) return null;
  const typed =
    snap.registry.scenes.size > 0 ||
    snap.registry.locations.size > 0 ||
    [...snap.registration.roles.values()].some((r) => r.entity?.kind === 'day' && !r.excluded);
  if (!typed) return null;
  // El mismo número que la pestaña *Pending*: números que no existen, duplicadas, secciones sin número y lo que llegó
  // tarde a una página unida (E16).
  const pending = pendingSummary({ snap, title: (id) => tree.get(id)?.title }).total + mergeRows(tree, projectId).length;
  const counts = sizes;

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

  const openScene = (e: MouseEvent, code: string) => {
    if (!plainClick(e)) return;
    e.preventDefault();
    navigate(sceneMapPath(code));
    // En el teléfono se cierra el cajón: ya en el mapa, cambiar de escena no cambia la ruta (solo `?scene=`).
    setNavOpen(false);
  };
  const openPage = (e: MouseEvent, pageId: string) => {
    if (!plainClick(e)) return;
    e.preventDefault();
    navigate(pagePath(pageId));
  };

  const sceneList = (key: string, scenes: (typeof lists.scenes)[number]['scenes']) => {
    const { n, button } = more(`s:${key}`, scenes.length, activeScene ? scenes.findIndex((s) => s.code === activeScene) : -1);
    return (
      <ul className="scene-nav-list">
        {scenes.slice(0, n).map((s) => (
          <li key={s.code}>
            <a
              ref={s.code === activeScene ? activeRow : undefined}
              className={`scene-nav-row${s.code === activeScene ? ' active' : ''}`}
              href={sceneMapPath(s.code)}
              aria-current={s.code === activeScene ? 'page' : undefined}
              onClick={(e) => openScene(e, s.code)}
            >
              <span className="code">{s.code}</span>
              {/* Sin tooltip: el nombre ya se ve (D794). */}
              <span className="title">{s.title}</span>
            </a>
          </li>
        ))}
        {button}
      </ul>
    );
  };

  const scenesBody = () => {
    const flat = lists.scenes.length === 1;
    if (flat) return sceneList(lists.scenes[0].ep, lists.scenes[0].scenes);
    return (
      <ul className="scene-nav-eps">
        {lists.scenes.map((g) => {
          const isOpen = fold.eps.includes(g.ep);
          return (
            <li key={g.ep}>
              <button
                className={`scene-nav-ep${isOpen ? ' sticky-head' : ''}`}
                aria-expanded={isOpen}
                onClick={() => update({ ...fold, eps: isOpen ? [] : [g.ep] })}
              >
                {isOpen ? <CollapseIcon size={14} /> : <ExpandIcon size={14} />}
                <span className="label">{g.ep ? tr('live.episode', { ep: g.ep }) : tr('sidebar.scenesNoEpisode')}</span>
                <span className="scene-nav-n">{g.scenes.length}</span>
              </button>
              {isOpen && sceneList(g.ep, g.scenes)}
            </li>
          );
        })}
      </ul>
    );
  };

  const locationsBody = () => {
    const { n, button } = more('l', lists.locations.length, lists.locations.findIndex((l) => !!l.pageId && l.pageId === activePage));
    return (
      <ul className="scene-nav-list ov-list ov-locs">
        {lists.locations.slice(0, n).map((l) => {
          const on = !!l.pageId && l.pageId === activePage;
          return (
            <li key={l.name}>
              <a
                className={`scene-nav-row${on ? ' active' : ''}`}
                href={l.pageId ? pagePath(l.pageId) : mapPath('locations')}
                aria-current={on ? 'page' : undefined}
                onClick={(e) => (l.pageId ? openPage(e, l.pageId) : plainClick(e) && (e.preventDefault(), go('locations')))}
              >
                <span className="title">{l.name}</span>
              </a>
            </li>
          );
        })}
        {button}
      </ul>
    );
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

  const scoutingBody = () => {
    const { n, button } = more('sc', lists.scoutings.length, lists.scoutings.findIndex((s) => s.pageId === activePage));
    // La fecha corta (`29/01`) como el número de un día; sin fecha, nada.
    const labels = lists.scoutings.map((s) => (s.date ? `${s.date.slice(8, 10)}/${s.date.slice(5, 7)}` : ''));
    const width = Math.max(0, ...labels.map((l) => l.length));
    return (
      <ul className="scene-nav-list ov-list ov-days" style={{ '--code-w': `${width}ch` } as CSSProperties}>
        {lists.scoutings.slice(0, n).map((s, i) => {
          const on = s.pageId === activePage;
          const name = s.locs.join(' + ') || s.title;
          return (
            <li key={s.pageId}>
              <a className={`scene-nav-row${on ? ' active' : ''}`} href={pagePath(s.pageId)} aria-current={on ? 'page' : undefined} onClick={(e) => openPage(e, s.pageId)}>
                <span className="code">{labels[i]}</span>
                {/* El título del scouting solo cuando la fila muestra sus locaciones: ahí es un dato que no se ve (D794). */}
                <span className={s.locs.length ? 'title locs' : 'title'} data-tip={s.locs.length ? s.title || undefined : undefined} data-tip-plain>
                  {name}
                </span>
              </a>
            </li>
          );
        })}
        {button}
      </ul>
    );
  };

  /** El renglón de una parte: la flecha pliega o despliega; el resto de la fila abre su pestaña. */
  const partRow = (part: Part | 'pending', label: string, count: ReactNode, body: (() => ReactNode) | null, tip?: string) => {
    const open = part !== 'pending' && fold.part === part && !!body;
    const on = tab === part && !activeScene;
    const name = (
      <a
        className="ov-part-name"
        href={mapPath(part)}
        data-tip={tip}
        aria-current={on ? 'page' : undefined}
        onClick={(e) => {
          if (!plainClick(e)) return;
          e.preventDefault();
          e.stopPropagation();
          if (part === 'pending') go('pending');
          else openPart(part);
        }}
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
            if (part === 'pending') go('pending');
            else openPart(part);
          }}
        >
          {body ? (
            <button
              className="toggle"
              aria-expanded={open}
              aria-label={open ? tr('sidebar.collapse') : tr('sidebar.expand')}
              onClick={(e) => {
                e.stopPropagation();
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
        </div>
        {open && body!()}
      </li>
    );
  };

  const codeWidth = Math.max(0, ...lists.scenes.flatMap((g) => g.scenes.map((s) => s.code.length)));
  const parts: ReactNode[] = [];
  if (counts.locations) parts.push(partRow('locations', tr('sidebar.locations'), <span className="scene-nav-n">{counts.locations}</span>, locationsBody));
  if (counts.scenes) parts.push(partRow('scenes', tr('sidebar.scenes'), <span className="scene-nav-n">{counts.scenes}</span>, scenesBody, tr('sidebar.scenesTip')));
  if (counts.scouting) parts.push(partRow('scouting', tr('sidebar.scouting'), <span className="scene-nav-n">{counts.scouting}</span>, scoutingBody));
  if (counts.days) parts.push(partRow('days', tr('sidebar.days'), <span className="scene-nav-n">{counts.days}</span>, daysBody));
  if (pending > 0) parts.push(partRow('pending', tr('sidebar.pending'), <span className="map-nav-count">{pending}</span>, null));

  return (
    <div className="scene-nav ov-nav" style={{ '--code-w': `${codeWidth}ch` } as CSSProperties}>
      <div
        className="ov-head nav-title sticky-head"
        onClick={(e) => {
          if (!plainClick(e)) return;
          update({ ...fold, closed: false });
          go(headPart);
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
