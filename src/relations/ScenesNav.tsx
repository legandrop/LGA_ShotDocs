import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent } from 'react';
import { useT } from '../i18n';
import { useLinkMode } from '../linkMode';
import { navigate, useRoute, useSearchParam } from '../router';
import { useServices, useTree } from '../services';
import { CollapseIcon, ExpandIcon } from '../ui/icons';
import { setNavOpen, useNavOpen } from '../ui/navStore';
import { useCurrentProject } from '../ui/project';
import { existingRelationsSession } from '../ui/relationsUi';
import { sceneEpisodes, sceneMapPath } from './sceneMentions';
import './scenesNav.css';

// La sección *Scenes* de la barra lateral (Docs/Doc_Relaciones.md, sección 21): automática, en todo proyecto con
// escenas. No es una página del árbol ni se guarda en ningún documento: sale del registro de lo que la persona ve, como
// el Mapa. Las escenas van por episodio (número y título en vivo); cada una abre la lista de todas las páginas que hablan
// de ella (`/map/scenes?scene=<código>`). Lo plegado se recuerda por proyecto en este dispositivo. Con un link público
// no hay sección.

const FOLD_KEY = 'shotdocs-scenes-nav';
/** Cuántas escenas de una lista se dibujan antes de «Show N more» (ERSO tiene episodios de 40 a 60). */
export const SCENES_PAGE = 60;

/**
 * Lo plegado de un proyecto: la sección entera y el episodio abierto (de fábrica, la sección abierta y los episodios
 * cerrados). Uno solo a la vez (D745): abrir otro cierra el anterior, así *Pages* no queda cientos de filas más abajo.
 */
interface Fold {
  closed: boolean;
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
  return { closed: f?.closed === true, eps: Array.isArray(f?.eps) ? f.eps.filter((x): x is string => typeof x === 'string') : [] };
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

export function ScenesNav() {
  const link = useLinkMode();
  const services = useServices();
  const session = link ? null : existingRelationsSession(services);
  if (!session) return null;
  return <ScenesNavFor session={session} />;
}

function ScenesNavFor({ session }: { session: NonNullable<ReturnType<typeof existingRelationsSession>> }) {
  const tr = useT();
  const route = useRoute();
  const sceneQuery = useSearchParam('scene');
  const projectId = useCurrentProject();
  const tree = useTree();
  const revision = useSyncExternalStore(session.relations.subscribe, session.relations.getRevision);
  const snap = session.relations.snapshot(projectId);
  const [fold, setFold] = useState<Fold>(() => readFold(projectId));
  // Cuántas se muestran de cada lista (por episodio); no se recuerda.
  const [shown, setShown] = useState<Record<string, number>>({});
  useEffect(() => {
    setFold(readFold(projectId));
    // Otro proyecto: las listas vuelven a su primera tanda.
    setShown({});
  }, [projectId]);
  const update = (next: Fold) => {
    setFold(next);
    writeFold(projectId, next);
  };

  // Solo el registro (no el mapa entero): cuesta lo mismo con 226 escenas que con 6.
  const groups = useMemo(
    () => (snap ? sceneEpisodes(snap.registry.scenes.values(), (id) => tree.get(id)?.title) : []),
    // Los títulos se leen del árbol en ese momento; la foto cambia con cada revisión.
    [snap, revision, tree, tree.getRevision()], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const active = route.name === 'map' && route.tab === 'scenes' ? sceneQuery : null;
  // Al abrir una escena (desde acá, la lupa o un link), su episodio se abre y queda abierto, como las madres de la página
  // abierta en el árbol; después se puede plegar.
  const activeEp = active ? (groups.find((g) => g.scenes.some((s) => s.code === active))?.ep ?? null) : null;
  useEffect(() => {
    if (activeEp === null) return;
    const f = readFold(projectId);
    if (f.eps.length !== 1 || f.eps[0] !== activeEp) update({ ...f, eps: [activeEp] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, activeEp, projectId]);
  // La fila de la escena abierta se lleva a la vista al abrirla y al abrir el cajón del teléfono (ahí la sección puede estar
  // muy abajo). Con llaves: en Chromium `scrollIntoView` puede devolver una promesa y React la tomaría como limpieza.
  const navOpen = useNavOpen();
  const activeRow = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    activeRow.current?.scrollIntoView?.({ block: 'nearest' });
  }, [active, navOpen]);
  if (!groups.length) return null;

  const total = groups.reduce((n, g) => n + g.scenes.length, 0);
  // La columna del número, alineada como la del árbol (`101_069A`).
  const codeWidth = Math.max(...groups.flatMap((g) => g.scenes.map((s) => s.code.length)));
  // Con un solo grupo (un largo, o un solo episodio) las escenas van directo, sin un renglón de episodio.
  const flat = groups.length === 1;

  const open = (e: MouseEvent, code: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(sceneMapPath(code));
    // En el teléfono se cierra el cajón: ya en el mapa, cambiar de escena no cambia la ruta (solo `?scene=`).
    setNavOpen(false);
  };

  const list = (key: string, scenes: (typeof groups)[number]['scenes']) => {
    const limit = shown[key] ?? SCENES_PAGE;
    // La escena abierta siempre se ve, aunque esté más abajo del límite.
    const at = active ? scenes.findIndex((s) => s.code === active) : -1;
    const n = Math.max(limit, at + 1);
    const rest = scenes.length - n;
    return (
      <ul className="scene-nav-list">
        {scenes.slice(0, n).map((s) => (
          <li key={s.code}>
            <a
              ref={s.code === active ? activeRow : undefined}
              className={`scene-nav-row${s.code === active ? ' active' : ''}`} href={sceneMapPath(s.code)} aria-current={s.code === active ? 'page' : undefined} onClick={(e) => open(e, s.code)}>
              <span className="code">{s.code}</span>
              <span className="title" data-tip={s.title || undefined} data-tip-plain data-tip-overflow>
                {s.title}
              </span>
            </a>
          </li>
        ))}
        {rest > 0 && (
          <li>
            <button className="scene-nav-more" onClick={() => setShown({ ...shown, [key]: n + SCENES_PAGE })}>
              {tr('sidebar.scenesMore', { count: Math.min(rest, SCENES_PAGE) })}
            </button>
          </li>
        )}
      </ul>
    );
  };

  return (
    <div className="scene-nav" style={{ '--code-w': `${codeWidth}ch` } as CSSProperties}>
      <button className="scene-nav-head nav-title" aria-expanded={!fold.closed} onClick={() => update({ ...fold, closed: !fold.closed })}>
        <span className="nav-title-label" data-tip={tr('sidebar.scenesTip')}>
          {tr('sidebar.scenes')}
        </span>
        {fold.closed ? <ExpandIcon size={14} /> : <CollapseIcon size={14} />}
        <span className="scene-nav-n">{total}</span>
      </button>
      {!fold.closed &&
        (flat ? (
          list(groups[0].ep, groups[0].scenes)
        ) : (
          <ul className="scene-nav-eps">
            {groups.map((g) => {
              const isOpen = fold.eps.includes(g.ep);
              return (
                <li key={g.ep}>
                  <button
                    className="scene-nav-ep"
                    aria-expanded={isOpen}
                    onClick={() => update({ ...fold, eps: isOpen ? [] : [g.ep] })}
                  >
                    {isOpen ? <CollapseIcon size={14} /> : <ExpandIcon size={14} />}
                    <span className="label">{g.ep ? tr('live.episode', { ep: g.ep }) : tr('sidebar.scenesNoEpisode')}</span>
                    <span className="scene-nav-n">{g.scenes.length}</span>
                  </button>
                  {isOpen && list(g.ep, g.scenes)}
                </li>
              );
            })}
          </ul>
        ))}
    </div>
  );
}
