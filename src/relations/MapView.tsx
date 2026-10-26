import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { locale, useT } from '../i18n';
import '../i18n/lazy/map';
import { mapPath, navigate, pagePath, useSearchParam, type MapTab } from '../router';
import { SEPARATOR } from '../search/extract';
import { usePermissions, useServices, useTree } from '../services';
import { copyText } from '../ui/commentsUi';
import { notify } from '../ui/notice';
import { openExportPages } from '../ui/ExportHost';
import { useCurrentProject } from '../ui/project';
import { existingRelationsSession, useIndexProgress } from '../ui/relationsUi';
import { goToPlace } from './goToPlace';
import type { Place } from './liveView';
import { fold, type Registry } from './reader';
import { mapCounts, mapJson, mapText, projectMap, sceneFilterText, titlePlace, type MapDay, type MapLocation, type MapScene, type ProjectMapData } from './projectMap';
import { searchScenes } from './sceneSearch';
import { useSlashDraft } from './slashDraft';
import { AssignButton, CreateEntityButton } from './EntityActions';
import { titleFragment, titleFragmentWhy } from './aliasAction';
import { LinkLocationButton } from './LinkLocation';
import { MergeButton, MergePendingRows, useMergeRows } from './MergeAction';
import { FoldPendingRow } from './FoldShots';
import { contentCounts } from './merge';
import { twinLabels } from './twinNames';
import { mapPathFrom, sceneLinks, sceneMentions, scenePageCount, type SceneLinks } from './sceneMentions';
import { sceneLive, type LiveSource, type PageChip, type SceneLive } from './liveView';
import { sceneStageRows, stagePageIds } from './sceneStageRows';
import { SceneStages } from './SceneStages';
import type { SceneMentionList } from './sceneMentions';
import './liveHeader.css';
import './map.css';

// El mapa del proyecto (Docs/Doc_Relaciones.md, sección 12; maqueta S4 «D», `e_mapa.html`): Locations en el tiempo,
// Scenes, Shoot days y Pending, armados en el dispositivo con la foto del índice de relaciones (nada guardado). Cada
// fila lleva a su página o al lugar exacto. Mientras el índice lee, dice «Reading…» y no afirma ceros (D402); quien ve
// solo una parte del proyecto lee «you can see» (D401). *Copy map* y *Copy JSON* copian lo mismo para un asistente.

type Session = NonNullable<ReturnType<typeof existingRelationsSession>>;

export function MapView({ tab }: { tab: MapTab }) {
  const tr = useT();
  const services = useServices();
  const session = existingRelationsSession(services);
  if (!session)
    return (
      <div className="mp">
        <p className="mp-empty">{tr('map.unavailable')}</p>
      </div>
    );
  return <MapBody tab={tab} session={session} />;
}

const ICONS = {
  loc: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  scene: 'M3 7h18v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l3-4h4l-3 4M10 7l3-4h4l-3 4',
  day: 'M5.5 5h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3.5 10h17M8 3v4M16 3v4',
  warn: 'M21.7 18l-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3M12 9v4M12 17h.01',
  scout: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15.5 8.5l-2 5-5 2 2-5z',
  copy: 'M9 9h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  code: 'm8 8-4 4 4 4M16 8l4 4-4 4',
  filter: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5',
} as const;

function Ic({ name, small }: { name: keyof typeof ICONS; small?: boolean }) {
  return (
    <svg className={`mp-i${small ? ' s' : ''}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

/** Un link a una página que navega adentro de la app (con ⌘/Ctrl o el botón del medio, el navegador lo abre aparte). */
function PageLink({ pageId, className, children, tip, style }: { pageId: string; className?: string; children: ReactNode; tip?: string; style?: CSSProperties }) {
  return (
    <a
      className={className}
      href={pagePath(pageId)}
      style={style}
      data-tip={tip}
      onClick={(e: MouseEvent) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        navigate(pagePath(pageId));
      }}
    >
      {children}
    </a>
  );
}

const dayMs = (date: string) => Date.parse(`${date}T12:00:00Z`);

/** Cerca, en la línea de tiempo, sin medir el ancho: menos de esto (en % del ancho) entre dos días, y van juntos. */
export const DOT_GAP = 3;
/** Lo que ocupa un punto con su separación, en píxeles. */
const DOT_PX = 13;

/** El espacio de un punto en % de una línea de `width` píxeles (sin medida, `DOT_GAP`). */
export function dotGap(width: number): number {
  return width > 0 ? (DOT_PX / width) * 100 : DOT_GAP;
}

/** Los días en grupos de días cercanos (en orden de fecha), para dibujarlos uno al lado del otro. Un grupo se dibuja
 *  desde su primer día y ocupa un punto por día: el día siguiente se suma si cae antes de donde termina el grupo ya
 *  dibujado (no solo cerca del día anterior), si no un grupo largo pisa al de al lado (O3, teléfono). */
export function groupDots<T extends { date: string | null }>(list: T[], pos: (date: string) => number, gap = DOT_GAP): T[][] {
  const out: T[][] = [];
  let end = -Infinity;
  for (const d of [...list].sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0))) {
    const at = pos(d.date!);
    if (out.length && at < end) {
      out[out.length - 1].push(d);
      end += gap;
    } else {
      out.push([d]);
      end = at + gap;
    }
  }
  return out;
}

function MapBody({ tab, session }: { tab: MapTab; session: Session }) {
  const tr = useT();
  const services = useServices();
  const tree = useTree();
  const perms = usePermissions();
  const projectId = useCurrentProject();
  const progress = useIndexProgress();
  const revision = useSyncExternalStore(session.relations.subscribe, session.relations.getRevision);
  const snap = session.relations.snapshot(projectId);
  const [filter, setFilter] = useState('');
  useEffect(() => setFilter(''), [tab]);
  // Una escena abierta en *Scenes* (`/map/scenes?scene=105_027`, desde la sección *Scenes* de la barra lateral): la lista
  // de las páginas que hablan de ella (Docs/Doc_Relaciones.md, sección 21).
  const sceneQuery = useSearchParam('scene');
  const sceneCode = tab === 'scenes' && sceneQuery ? sceneQuery : null;

  // La consulta abierta del `/` no cuenta como pendiente (D568): al abrirse o cerrarse, se vuelve a armar.
  const draft = useSlashDraft();
  const data = useMemo(() => {
    if (!snap) return null;
    return projectMap({ snap, title: (id) => tree.get(id)?.title, content: (id) => session.index.content(id) });
    // La foto cambia con cada revisión; los títulos se leen del árbol en ese momento.
  }, [snap, revision, tree, session, draft]); // eslint-disable-line react-hooks/exhaustive-deps
  // Lo que necesita la lista de una escena: la foto (los roles), los títulos del árbol (una página que entra solo por un
  // link no está en el mapa) y lo leído de cada página (los extractos).
  const src = useMemo(
    () => (snap ? { snap, title: (id: string) => tree.get(id)?.title, content: (id: string) => session.index.content(id) } : null),
    [snap, session, tree],
  );
  // Quién linkea cada escena (una ficha, otra página de la escena), una vez por foto: lo usan la columna *Pages* y la lista.
  const links = useMemo(() => (src ? sceneLinks(src) : null), [src, revision]); // eslint-disable-line react-hooks/exhaustive-deps
  // El número de la dirección leído con el mismo lector que la lupa (`105_055a`, `101-012`, `5055`): la escena exacta.
  const resolve = (q: string): string | null => {
    if (!snap) return null;
    if (snap.registry.scenes.has(q)) return q;
    return searchScenes({ snap, title: (id) => tree.get(id)?.title }, q, { loose: false, limit: 1 })[0]?.code ?? null;
  };

  // Quien no ve el proyecto entero (un invitado a una rama) no puede saber qué falta (D401).
  const partial = perms.known && perms.role !== 'owner' && perms.role !== 'admin' && perms.projectLevel(projectId) === 0;
  const complete = !!data?.complete;
  const counts = data ? mapCounts(data) : { scenes: 0, locations: 0, days: 0, scoutings: 0, pending: 0, duplicates: 0, unnumbered: 0, toResolve: 0 };
  // Lo que llegó tarde a una página unida (E16) también espera en *Pending*.
  const merges = useMergeRows().length;
  const projectName = tree.project(projectId)?.name ?? tr('project.defaultName');
  // Un número solo si es cierto: mientras lee, un cero no se afirma (D402).
  const num = (n: number) => (n > 0 || complete ? n : null);

  const copy = async (kind: 'text' | 'json') => {
    if (!data) return;
    const meta = { project: { id: projectId, name: projectName }, origin: location.origin, partial, builtAt: new Date().toISOString() };
    const text = kind === 'json' ? JSON.stringify(mapJson(data, meta)) : mapText(data, meta);
    const ok = await copyText(text);
    if (!ok) return notify(tr('map.copyFailed'));
    notify(complete ? tr('map.copied', { scenes: tr('map.scenes', { count: counts.scenes }), locations: tr('map.locations', { count: counts.locations }) }) : tr('map.copiedReading'));
  };

  const fq = fold(filter.trim());
  // El filtro entiende cualquier forma del número, con el mismo lector que la lupa («Escena 27», `105_027b`, `5027`;
  // O6 de la auditoría). Si lo escrito nombra escenas, filtra por ellas; si no, por el texto.
  const codes = useMemo(() => {
    if (!snap || !filter.trim()) return null;
    const list = searchScenes({ snap, title: (id) => tree.get(id)?.title }, filter, { loose: false, limit: 50 });
    return list.length ? new Set(list.map((s) => s.code)) : null;
  }, [snap, filter, tree]);
  const tabs: { id: MapTab; icon: keyof typeof ICONS; label: string; n: number }[] = [
    { id: 'locations', icon: 'loc', label: tr('map.tabLocations'), n: counts.locations },
    { id: 'scenes', icon: 'scene', label: tr('map.tabScenes'), n: counts.scenes },
    { id: 'scouting', icon: 'scout', label: tr('map.tabScouting'), n: counts.scoutings },
    { id: 'days', icon: 'day', label: tr('map.tabDays'), n: counts.days },
    { id: 'pending', icon: 'warn', label: tr('map.tabPending'), n: counts.toResolve + merges },
  ];
  const empty = !!data && complete && counts.scenes === 0 && counts.locations === 0 && counts.days === 0;

  return (
    <div className="mp">
      <h1 className="mp-title">{tr('map.title')}</h1>
      <p className="mp-lede">
        {tr(partial ? 'map.ledePartial' : 'map.lede')}
        {data && (
          <>
            {num(counts.scenes) !== null && <> · {tr('map.scenes', { count: counts.scenes })}</>}
            {num(counts.locations) !== null && <> · {tr('map.locations', { count: counts.locations })}</>}
            {num(counts.days) !== null && <> · {tr('map.days', { count: counts.days })}</>}
          </>
        )}
        {!complete && (
          <span className="mp-reading" data-tip={tr('live.readingTip')}>
            <i aria-hidden="true" />
            {progress ? tr('map.reading', { ready: progress.ready, total: progress.total }) : tr('live.reading')}
          </span>
        )}
      </p>
      {empty ? (
        <p className="mp-empty">{tr('map.empty')}</p>
      ) : (
        <>
          <div className="mp-bar">
            <nav className="mp-tabs" aria-label={tr('map.title')}>
              {tabs.map((x) => (
                <a
                  key={x.id}
                  className={`mp-tab${tab === x.id ? ' on' : ''}`}
                  href={mapPath(x.id)}
                  aria-current={tab === x.id ? 'page' : undefined}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                    e.preventDefault();
                    // Desde la vista de una escena (`?scene=`), la misma ruta: vuelve a la lista (D746).
                    navigate(mapPathFrom(mapPath(x.id), location), true);
                  }}
                >
                  <Ic name={x.icon} small />
                  {x.label}
                  {num(x.n) !== null && <b>{x.n}</b>}
                </a>
              ))}
            </nav>
            <span className="mp-actions">
              <button className="mp-btn" disabled={!data} data-tip={tr('map.copyTip')} onClick={() => void copy('text')}>
                <Ic name="copy" small />
                {tr('map.copy')}
              </button>
              <button className="mp-btn" disabled={!data} data-tip={tr('map.copyJsonTip')} onClick={() => void copy('json')}>
                <Ic name="code" small />
                {tr('map.copyJson')}
              </button>
            </span>
            {tab !== 'pending' && !sceneCode && (
              <label className="mp-filter">
                <Ic name="filter" small />
                <input type="text" value={filter} placeholder={tr('map.filter')} aria-label={tr('map.filter')} spellCheck={false} onChange={(e) => setFilter(e.target.value)} />
              </label>
            )}
          </div>
          {!data ? (
            <p className="mp-empty">{tr('live.reading')}</p>
          ) : tab === 'locations' ? (
            <Locations data={data} fq={fq} complete={complete} />
          ) : tab === 'scenes' && sceneCode && src ? (
            <SceneDetail key={sceneCode} code={resolve(sceneCode) ?? sceneCode} data={data} src={src} links={links} complete={complete} partial={partial} />
          ) : tab === 'scenes' ? (
            <Scenes data={data} fq={fq} codes={codes} complete={complete} partial={partial} src={src} links={links} />
          ) : tab === 'scouting' ? (
            <Scoutings data={data} fq={fq} />
          ) : tab === 'days' ? (
            <Days data={data} fq={fq} codes={codes} registry={snap?.registry ?? null} />
          ) : (
            <Pending data={data} complete={complete} partial={partial} session={session} snap={snap} projectId={projectId} onPlace={(p) => goToPlace(services, p)} />
          )}
        </>
      )}
    </div>
  );
}

// --- Locations: en el tiempo ---------------------------------------------------------------------------------------

function locFilter(l: MapLocation, days: Map<string, MapDay>): string {
  return fold(`${l.name} ${l.aliases.join(' ')} ${l.days.map((id) => `${days.get(id)?.date ?? ''} ${days.get(id)?.label ?? ''}`).join(' ')}`);
}

function Locations({ data, fq, complete }: { data: ProjectMapData; fq: string; complete: boolean }) {
  const tr = useT();
  // El ancho de la línea de tiempo (la de la primera fila; todas miden lo mismo), para juntar los días que se tocarían.
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const measured = useRef<Element | null>(null);
  const measure = useCallback((el: HTMLElement | null) => {
    if (!el || measured.current?.isConnected) return;
    measured.current = el;
    observer.current?.disconnect();
    if (typeof ResizeObserver === 'undefined') return;
    observer.current = new ResizeObserver(() => setWidth(el.getBoundingClientRect().width));
    observer.current.observe(el);
    setWidth(el.getBoundingClientRect().width);
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  const days = useMemo(() => new Map(data.days.map((d) => [d.pageId, d])), [data]);
  const dated = data.days.filter((d) => d.date).map((d) => d.date!);
  const t0 = dated.length ? dayMs(dated[0]) - 4 * 86400e3 : 0;
  const t1 = dated.length ? dayMs(dated[dated.length - 1]) + 4 * 86400e3 : 1;
  const pos = (date: string) => ((dayMs(date) - t0) / Math.max(1, t1 - t0)) * 100;
  const x = (date: string) => `${pos(date).toFixed(2)}%`;
  // Las marcas de cada mes entre el primer día y el último.
  const months: { at: string; label: string }[] = [];
  if (dated.length) {
    const first = new Date(t0);
    let m = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1, 12));
    const fmt = new Intl.DateTimeFormat(locale(), { month: 'short', timeZone: 'UTC' });
    while (m.getTime() < t1) {
      months.push({ at: m.toISOString().slice(0, 10), label: fmt.format(m).replace('.', '') });
      m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1, 12));
    }
  }
  const match = (l: MapLocation) => !fq || locFilter(l, days).includes(fq);
  const withDays = data.locations.filter((l) => l.days.length && match(l));
  const without = data.locations.filter((l) => !l.days.length && match(l));
  const ticks = months.map((mo) => <span key={mo.at} className="mp-tick" style={{ left: x(mo.at) }} />);
  // Dos días se juntan si sus puntos se tocarían con el ancho que tiene la línea ahora (cambia con la ventana).
  const gap = dotGap(width);
  if (!withDays.length && !without.length) return <p className="mp-empty">{fq ? tr('map.noMatch') : complete ? tr('map.nothingPending') : tr('live.reading')}</p>;
  return (
    <>
      <div className="mp-legend" aria-hidden="true">
        <span>
          <i className="mp-dot" />
          {tr('map.legendWritten')}
        </span>
        <span>
          <i className="mp-dot e" />
          {tr('map.legendEmpty')}
        </span>
        <span>
          <Ic name="scout" small />
          {tr('map.legendScouting')}
        </span>
      </div>
      {withDays.length > 0 && (
        <div className="mp-grid mp-locs" role="table">
          <div className="mp-lrow head" role="row">
            <span role="columnheader">{tr('map.colLocation')}</span>
            <span role="columnheader" data-tip={tr('map.colFromPagesTip')}>
              {tr('map.colFromPages')}
            </span>
            <span className="mp-months" role="columnheader">
              {months.map((mo) => (
                <span key={mo.at} style={{ left: x(mo.at) }}>
                  {mo.label}
                </span>
              ))}
            </span>
          </div>
          {withDays.map((l) => {
            const scenes = new Set([...l.planned, ...l.shot]).size;
            return (
              <div key={l.name} className="mp-lrow" role="row">
                <span className="mp-nm" role="cell">
                  <Ic name="loc" small />
                  {l.pageId ? (
                    <PageLink pageId={l.pageId} className="mp-link">
                      {l.name}
                    </PageLink>
                  ) : (
                    <span>{l.name}</span>
                  )}
                  {l.scouts.length > 0 && (
                    <span className="mp-sc" aria-label={tr('map.legendScouting')}>
                      <Ic name="scout" small />
                    </span>
                  )}
                </span>
                <span className="mp-ct" role="cell">
                  {scenes > 0 && (
                    <>
                      <b>{tr('map.scenes', { count: scenes })}</b> ·{' '}
                    </>
                  )}
                  {tr('map.dayCount', { count: l.days.length })}
                </span>
                <span className="mp-tl" role="cell" ref={measure}>
                  {ticks}
                  {/* Un punto por día (los días sin fecha en el título no tienen lugar en la línea). Los días muy cerca
                      van juntos, uno al lado del otro desde el primero: encimados, el de arriba tapaba el clic del
                      otro (O3 de la auditoría). */}
                  {groupDots(l.days.flatMap((id) => (days.get(id)?.date ? [days.get(id)!] : [])), pos, gap).map((g) => (
                    <span key={g[0].pageId} className="mp-dots" style={{ left: `${pos(g[0].date!).toFixed(2)}%` }}>
                      {g.map((d) => (
                        <PageLink key={d.pageId} pageId={d.pageId} className={`mp-dot${d.written ? '' : ' e'}`} tip={d.title}>
                          <span className="sr-only">{d.title}</span>
                        </PageLink>
                      ))}
                    </span>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {without.length > 0 && (
        <div className="mp-foot">
          <span>{tr('map.noShootDays')}:</span>
          {without.map((l) => {
            const scenes = new Set([...l.planned, ...l.shot]).size;
            const body = (
              <>
                {l.name}
                {scenes > 0 && <span className="n">{scenes}</span>}
              </>
            );
            return l.pageId ? (
              <PageLink key={l.name} pageId={l.pageId} className="mp-chip loc">
                {body}
              </PageLink>
            ) : (
              <span key={l.name} className="mp-chip loc">
                {body}
              </span>
            );
          })}
        </div>
      )}
    </>
  );
}

// --- Scenes: por episodio ------------------------------------------------------------------------------------------

type SceneSrc = Parameters<typeof sceneMentions>[2];

function Scenes({
  data,
  fq,
  codes,
  complete,
  partial,
  src,
  links,
}: {
  data: ProjectMapData;
  fq: string;
  codes: Set<string> | null;
  complete: boolean;
  partial: boolean;
  src: SceneSrc | null;
  links: SceneLinks | null;
}) {
  const tr = useT();
  // Las escenas con «N pages» desplegado (la lista se arma recién al desplegar: lee los extractos).
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (code: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(code)) next.add(code);
      return next;
    });
  const rows = data.scenes.filter((s) => !fq || (codes ? codes.has(s.code) : sceneFilterText(s).includes(fq)));
  const groups = new Map<string, MapScene[]>();
  for (const s of rows) groups.set(s.episode ?? '', [...(groups.get(s.episode ?? '') ?? []), s]);
  if (!rows.length) return <p className="mp-empty">{fq ? tr('map.noMatch') : complete ? tr('map.noReportSection') : tr('live.reading')}</p>;
  return (
    <div className="mp-grid mp-scenes" role="table">
      <div className="mp-srow head" role="row">
        <span role="columnheader">{tr('map.colScene')}</span>
        <span role="columnheader">{tr('map.colTitle')}</span>
        <span role="columnheader" data-tip={tr('map.colWhereTip')}>
          {tr('map.colWhere')}
        </span>
        <span role="columnheader">{tr('map.colDays')}</span>
        <span role="columnheader" data-tip={tr('map.colPagesTip')}>
          {tr('map.colPages')}
        </span>
      </div>
      {[...groups].map(([ep, list]) => (
        <div key={ep} role="rowgroup" className="mp-group">
          {groups.size > 1 || ep ? (
            <div className="mp-ghead" role="row">
              <span role="cell">
                {ep ? tr('live.episode', { ep }) : tr('map.noEpisode')} · {tr('map.episodeScenes', { count: list.length })}
              </span>
            </div>
          ) : null}
          {list.map((s) => {
            const shotLocs = [...new Set(s.shot.flatMap((x) => x.locs))];
            const plannedOnly = s.plannedAt.filter((l) => !shotLocs.includes(l));
            const pages = links ? scenePageCount(data, s.code, links) : 1;
            const expanded = open.has(s.code);
            const list = expanded && src && links ? sceneMentions(data, s.code, src, { links }) : null;
            return (
              <div key={s.code} className="mp-srow" role="row">
                <span className="mp-code mono" role="cell">
                  {s.pageId ? (
                    <PageLink pageId={s.pageId} className="mp-link">
                      {s.code}
                    </PageLink>
                  ) : (
                    s.code
                  )}
                </span>
                <span className="mp-st" role="cell">
                  {s.title}
                </span>
                <span className="mp-ls" role="cell">
                  {shotLocs.map((l) => (
                    <span key={`s${l}`} className="mp-lt shot">
                      {l} <i>· {tr('map.inReport')}</i>
                    </span>
                  ))}
                  {plannedOnly.map((l) => (
                    <span key={`p${l}`} className="mp-lt">
                      {l} <i>· {tr('map.inPlan')}</i>
                    </span>
                  ))}
                  {!shotLocs.length && !plannedOnly.length && <span className="mp-none">—</span>}
                </span>
                <span className="mp-dd" role="cell">
                  {s.shot.length ? (
                    s.shot.map((x, i) => (
                      <span key={x.dayId}>
                        {i > 0 && ', '}
                        <PageLink pageId={x.dayId} className="mp-link" tip={data.pages.get(x.dayId)?.title}>
                          {x.label}
                        </PageLink>
                      </span>
                    ))
                  ) : s.plannedDays.length ? (
                    <span className="mp-none">{tr('map.dayPlanned')}</span>
                  ) : complete ? (
                    <span className="mp-none">{tr(partial ? 'map.noReportSeen' : 'map.noReportSection')}</span>
                  ) : (
                    <span className="mp-none">{tr('live.reading')}</span>
                  )}
                </span>
                <span className="mp-pg" role="cell">
                  {/* Un número solo si es cierto: mientras lee, sin «1 page» que después son 12 (D402). */}
                  {complete || pages > 1 ? (
                    <button className={`mp-pages${expanded ? ' on' : ''}`} aria-expanded={expanded} onClick={() => toggle(s.code)}>
                      {tr('map.pagesN', { count: pages })}
                      <svg className="mp-i s" viewBox="0 0 24 24" aria-hidden="true">
                        <path d={expanded ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
                      </svg>
                    </button>
                  ) : (
                    <span className="mp-none">{tr('live.reading')}</span>
                  )}
                </span>
                {list && (
                  <div className="mp-sexp" role="cell">
                    <SceneStagesFor code={s.code} src={src!} list={list} partial={partial} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// --- Una escena: todas las páginas que hablan de ella -----------------------------------------------------------

function SceneDetail({
  code,
  data,
  src,
  links,
  complete,
  partial,
}: {
  code: string;
  data: ProjectMapData;
  src: SceneSrc;
  links: SceneLinks | null;
  complete: boolean;
  partial: boolean;
}) {
  const tr = useT();
  const top = useRef<HTMLDivElement>(null);
  // Al abrir otra escena (desde la barra lateral, ya en el mapa), la vista vuelve arriba, con las pestañas a la vista.
  // Con llaves y sin `scrollIntoView`/`scrollTo`: en Chromium pueden devolver una promesa, y React tomaría lo devuelto
  // por el efecto como su limpieza (la app caía al salir de la vista).
  useEffect(() => {
    const main = top.current?.closest<HTMLElement>('.main');
    if (main) main.scrollTop = 0;
  }, [code]);
  const scene = data.scenes.find((s) => s.code === code) ?? null;
  const list = useMemo(() => (scene && links ? sceneMentions(data, code, src, { links }) : null), [data, code, src, scene, links]);
  // Lo que dicen los renglones por etapa (D783): la vista viva de la escena, la misma de su cabecera.
  const live = useMemo(() => (scene ? sceneLive(src as LiveSource, code) : null), [src, code, scene, data]);
  // Lo que se exporta: las páginas de la lista en el orden en que se ven, sin las páginas índice.
  const exportIds = useMemo(() => (list ? list.groups.filter((g) => g.id !== 'index').flatMap((g) => g.pages.map((p) => p.pageId)) : []), [list]);
  return (
    <div className="mp-scene" ref={top}>
      <a
        className="mp-back"
        href={mapPath('scenes')}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          navigate(mapPathFrom(mapPath('scenes'), location));
        }}
      >
        <svg className="mp-i s" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M19 12H5M11 6l-6 6 6 6" />
        </svg>
        {tr('map.allScenes')}
      </a>
      {!scene || !list ? (
        // Quien ve una parte del proyecto no puede saber si existe en una página que no ve (D401).
        <p className="mp-empty">{complete ? tr(partial ? 'map.sceneUnknownSeen' : 'map.sceneUnknown', { code }) : tr('live.reading')}</p>
      ) : (
        <>
          <h2 className="mp-sh">
            <span className="mp-chip mono">
              <Ic name="scene" small />
              {scene.code}
            </span>
            {scene.pageId ? (
              <PageLink pageId={scene.pageId} className="mp-link">
                {scene.title || scene.code}
              </PageLink>
            ) : (
              <span>{scene.title}</span>
            )}
          </h2>
          <div className="mp-sbar">
            <p className="mp-smeta">{metaOf(tr, live, scene.episode)}</p>
            {/* Todas las páginas de la lista en un PDF o un zip, sin las páginas índice (nombran decenas de escenas). Mientras el
                índice lee, apagado: la lista todavía puede crecer y la ventana se lleva la de ese momento. */}
            <button className="mp-btn" data-tip={tr('map.sceneExportTip')} disabled={!complete || exportIds.length === 0} onClick={() => openExportPages(`scene:${scene.code}`, tr('map.sceneExportTitle', { code: scene.code }), exportIds)}>
              <svg className="mp-i s" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
              </svg>
              {tr('map.sceneExport')}
            </button>
          </div>
          {list.scenePages > 1 && (
            // La escena está en dos páginas o más: las relaciones usan la primera; se resuelve en Pending (D747).
            <p className="mp-smtwins">
              {tr('map.sceneTwins', { count: list.scenePages })}{' '}
              <PageLinkTo href={mapPath('pending')}>{tr('map.sceneTwinsGo')}</PageLinkTo>
            </p>
          )}
          <SceneStagesFor code={scene.code} src={src} list={list} partial={partial} live={live} />
        </>
      )}
    </div>
  );
}

/** Los renglones «Etapa | Tipo: links» de una escena (D783): en su vista y en la fila desplegada de *Scenes*. */
function SceneStagesFor({ code, src, list, partial, live }: { code: string; src: SceneSrc; list: SceneMentionList; partial: boolean; live?: SceneLive | null }) {
  const v = useMemo(() => live ?? sceneLive(src as LiveSource, code), [live, src, code]);
  const rows = useMemo(() => {
    // Lo que nombra la escena y no está en ninguna etapa (una página suelta, un link), y las páginas índice, plegadas.
    const inRows = stagePageIds(v);
    const others: PageChip[] = [];
    const index: PageChip[] = [];
    for (const g of list.groups) {
      for (const p of g.pages) {
        if (p.self) continue;
        const chip: PageChip = { pageId: p.pageId, title: p.title, ...(p.places[0] ? { blockId: p.places[0].blockId } : {}) };
        if (g.id === 'index') index.push(chip);
        else if (!inRows.has(p.pageId)) others.push(chip);
      }
    }
    return sceneStageRows(v, { self: false, title: (id) => src.title(id) ?? '', locPage: (n) => src.snap.registry.locations.get(n)?.pageId ?? null, others, index });
  }, [v, list, src]);
  return <SceneStages rows={rows} partial={partial} />;
}

/** «Episodio 101 · INT/DÍA · 3 planos · filmada en 2 días» (solo lo que se sabe: mientras lee, sin ceros). */
function metaOf(tr: ReturnType<typeof useT>, v: SceneLive | null, episode: string | null): string {
  const shot = v ? v.days.filter((d) => d.sections.length).length : 0;
  return [
    episode ? tr('live.episode', { ep: episode }) : '',
    v?.intExt.slice(0, 2).join(', ') ?? '',
    v && v.shots.length ? tr('stages.shots', { count: v.shots.length }) : '',
    shot ? tr('stages.shotOnDays', { count: shot }) : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Un link de la app dentro del texto (con ⌘/Ctrl, aparte). */
function PageLinkTo({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      className="mp-plink"
      href={href}
      onClick={(e: MouseEvent) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}

// --- Shoot days ----------------------------------------------------------------------------------------------------

function Days({ data, fq, codes, registry }: { data: ProjectMapData; fq: string; codes: Set<string> | null; registry: Registry | null }) {
  const tr = useT();
  const rows = data.days.filter(
    (d) => !fq || (codes ? [...d.scenes, ...d.planned].some((c) => codes.has(c)) : fold(`${d.date ?? ''} ${d.title} ${d.locs.join(' ')} ${d.scenes.join(' ')}`).includes(fq)),
  );
  // Las fechas que solo tienen plan (se planea antes de filmar): en su lugar por fecha, apagadas.
  const planned = data.plannedDates.filter((p) => !fq || (codes ? p.scenes.some((c) => codes.has(c)) : fold(`${p.date} ${p.plans.map((id) => data.pages.get(id)?.title ?? '').join(' ')} ${p.scenes.join(' ')}`).includes(fq)));
  if (!rows.length && !planned.length) return <p className="mp-empty">{fq ? tr('map.noMatch') : tr('live.reading')}</p>;
  type Row = { kind: 'day'; d: MapDay } | { kind: 'plan'; p: (typeof planned)[number] };
  const all: Row[] = [...rows.map((d) => ({ kind: 'day' as const, d })), ...planned.map((p) => ({ kind: 'plan' as const, p }))].sort((a, b) => {
    const x = a.kind === 'day' ? (a.d.date ?? '9999') : a.p.date;
    const y = b.kind === 'day' ? (b.d.date ?? '9999') : b.p.date;
    return x < y ? -1 : x > y ? 1 : a.kind === b.kind ? 0 : a.kind === 'day' ? -1 : 1;
  });
  return (
    <div className="mp-grid mp-days" role="table">
      <div className="mp-drow head" role="row">
        <span role="columnheader">{tr('map.colDate')}</span>
        <span role="columnheader">{tr('map.colDay')}</span>
        <span role="columnheader">{tr('map.colLocation')}</span>
        <span role="columnheader">{tr('map.colScenes')}</span>
      </div>
      {all.map((row) => {
        if (row.kind === 'plan') {
          const p = row.p;
          return (
            <div key={`plan:${p.date}`} className="mp-drow planned" role="row">
              <span className="mp-date mono" role="cell">
                {p.date}
              </span>
              <span className="mp-dt" role="cell">
                {p.plans.map((id, i) => (
                  <span key={id}>
                    {i > 0 && ' · '}
                    <PageLink pageId={id} className="mp-link" tip={data.pages.get(id)?.title}>
                      {data.pages.get(id)?.title ?? ''}
                    </PageLink>
                  </span>
                ))}
              </span>
              <span className="mp-ls" role="cell">
                <span className="mp-tag">{tr('map.plannedOnly')}</span>
              </span>
              <span className="mp-dd" role="cell">
                {p.scenes.length ? tr('map.plannedN', { count: p.scenes.length }) : <span className="mp-none">—</span>}
              </span>
            </div>
          );
        }
        const d = row.d;
        const plannedOnly = d.planned.filter((c) => !d.scenes.includes(c)).length;
        return (
          <div key={d.pageId} className="mp-drow" role="row">
            <span className="mp-date mono" role="cell">
              {d.date ?? '—'}
            </span>
            <span className="mp-dt" role="cell">
              <PageLink pageId={d.pageId} className="mp-link" tip={d.title}>
                {d.label}
              </PageLink>
              {!d.written && <span className="mp-tag">{tr('map.nothingWritten')}</span>}
            </span>
            <span className="mp-ls" role="cell">
              {d.locs.length ? (
                d.locs.join(', ')
              ) : titlePlace(d) ? (
                // Lo que dice el título, apagado: no nombra una locación que exista (O7 de la auditoría). Y escribirlo en una
                // locación (D539).
                <>
                  <span className="mp-none" data-tip={tr(titleFragmentWhy(d) === 'several' ? 'linkLoc.severalTip' : titleFragmentWhy(d) === 'unusable' ? 'linkLoc.unusableTip' : 'map.noLocationTip')}>
                    {titlePlace(d)}
                  </span>
                  {registry && <LinkLocationButton R={registry} fragment={titleFragment(d)} className="mp-linkloc" />}
                </>
              ) : (
                <span className="mp-none">{tr('map.noLocation')}</span>
              )}
            </span>
            <span className="mp-dd" role="cell">
              {d.scenes.length > 0 && tr('map.withSection', { count: d.scenes.length })}
              {d.scenes.length > 0 && plannedOnly > 0 && ' · '}
              {plannedOnly > 0 && tr('map.plannedN', { count: plannedOnly })}
              {!d.scenes.length && !plannedOnly && <span className="mp-none">—</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// --- Scouting: los scoutings y pruebas por fecha (Plan_Estructura_Etapas.md) -------------------------------------------

function Scoutings({ data, fq }: { data: ProjectMapData; fq: string }) {
  const tr = useT();
  if (!data.scoutings.length) return <p className="mp-empty">{tr('map.noScoutings')}</p>;
  const rows = data.scoutings.filter((s) => !fq || fold(`${s.date ?? ''} ${s.title} ${s.locs.join(' ')}`).includes(fq));
  if (!rows.length) return <p className="mp-empty">{tr('map.noMatch')}</p>;
  return (
    <div className="mp-grid mp-days mp-scouts" role="table">
      <div className="mp-drow head" role="row">
        <span role="columnheader">{tr('map.colDate')}</span>
        <span role="columnheader">{tr('map.colReport')}</span>
        <span role="columnheader">{tr('map.colLocation')}</span>
        <span role="columnheader" />
      </div>
      {rows.map((s) => (
        <div key={s.pageId} className="mp-drow" role="row">
          <span className="mp-date mono" role="cell">
            {s.date ?? '—'}
          </span>
          <span className="mp-dt" role="cell">
            <PageLink pageId={s.pageId} className="mp-link" tip={s.title}>
              {s.title}
            </PageLink>
          </span>
          <span className="mp-ls" role="cell">
            {s.locs.length ? s.locs.join(', ') : <span className="mp-none">{tr('map.noLocationNamed')}</span>}
          </span>
          <span className="mp-dd" role="cell">
            {s.doc === 'test' && <span className="mp-tag">{tr('map.test')}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

// --- Pending -------------------------------------------------------------------------------------------------------

/** El texto de un bloque de una página (lo que leyó la búsqueda), corto. */
function blockText(session: Session, pageId: string, blockId: string): string {
  const units = session.index.content(pageId)?.units ?? [];
  const text = units
    .filter((u) => u.blockId === blockId && u.field !== 'name')
    .map((u) => u.text.replaceAll(SEPARATOR, ' '))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 90 ? `${text.slice(0, 89).replace(/\s+\S*$/, '')}…` : text;
}

/**
 * Una fila de *Pending*. `actions` es el lugar de los botones de cada fila: *Create* (con sus guardas) en los números que
 * no existen y *Assign* en las secciones sin número (E7, `EntityActions.tsx`).
 */
export function PendingRow({ head, children, actions }: { head: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mp-pcard">
      <div className="mp-ph">
        {head}
        <span className="mp-pact">{actions}</span>
      </div>
      {children}
    </div>
  );
}

/**
 * Las páginas repetidas de una fila (D706): si se llaman igual, «· 1» y «· 2» (el orden del árbol, como en el adelanto de
 * *Merge*) y, de cada una, cuánto tiene escrito, así se sabe cuál es cuál y dónde está lo de más.
 */
function TwinPages({ ids, title, session }: { ids: string[]; title: (id: string) => string; session: Session }) {
  const tr = useT();
  const { label, numbered } = twinLabels(ids, title);
  return (
    <>
      {ids.map((id, i) => {
        const content = session.index.content(id);
        const c = contentCounts(content);
        return (
          <span key={id}>
            {i > 0 && ' / '}
            <PageLink pageId={id} className="mp-plink" tip={numbered ? tr('merge.twinNumberTip') : undefined}>
              {label(id)}
            </PageLink>
            {content && <span className="mp-q"> ({[tr('merge.blocks', { count: c.blocks }), c.photos ? tr('merge.photos', { count: c.photos }) : ''].filter(Boolean).join(' · ')})</span>}
          </span>
        );
      })}
    </>
  );
}

function Pending({
  data,
  complete,
  partial,
  session,
  snap,
  projectId,
  onPlace,
}: {
  data: ProjectMapData;
  complete: boolean;
  partial: boolean;
  session: Session;
  snap: ReturnType<Session['relations']['snapshot']>;
  projectId: string;
  onPlace: (place: Place) => void;
}) {
  const tr = useT();
  const perms = usePermissions();
  const tree = useTree();
  // *Assign* necesita la foto (para elegir la escena) y permiso de editar el día (E7).
  const src = snap ? { snap, title: (id: string) => tree.get(id)?.title } : null;
  const title = (id: string) => data.pages.get(id)?.title ?? '';
  const merges = useMergeRows();
  const nothing = !data.pending.length && !data.unnumbered.length && !data.duplicates.length && !data.plans.length && !merges.length;
  // En el selector de *Assign* de un número, primero las escenas que nombran las páginas donde está escrito.
  const nearOf = (code: string): string[] => {
    const out = new Set<string>();
    for (const m of data.pending.find((x) => x.code === code)?.mentions ?? []) {
      for (const x of snap?.pages.get(m.pageId)?.mentions ?? []) if (x.kind === 'scene') out.add(x.ref);
    }
    return [...out];
  };
  return (
    <>
      {nothing ? (
        <p className="mp-empty">{!complete ? tr('live.reading') : tr(partial ? 'map.nothingPendingSeen' : 'map.nothingPending')}</p>
      ) : (
        <div className="mp-pend">
          {data.pending.map((p) => {
            // *Assign* sobre el número (D567): en cada lugar que lo nombra y la persona puede editar.
            const places = p.mentions
              .filter((m) => perms.canEditPage(m.pageId))
              .map((m) => ({ pageId: m.pageId, blockIds: m.blockIds, ep: snap?.registration.roles.get(m.pageId)?.ep ?? null }));
            return (
            <PendingRow
              key={p.code}
              actions={
                <>
                  <CreateEntityButton want={{ kind: 'scene', code: p.code }} projectId={projectId} className="mp-btn" />
                  {src && places.length > 0 && <AssignButton src={src} target={{ kind: 'everywhere', pending: p.code, places, locked: p.mentions.filter((m) => !perms.canEditPage(m.pageId)).map((m) => m.pageId) }} near={nearOf(p.code)} ep={p.code.includes('_') ? p.code.slice(0, 3) : null} className="mp-btn" />}
                </>
              }
              head={
                <>
                  <span className="mp-chip out mono">
                    <Ic name="scene" small />
                    {p.code}
                  </span>
                  {/* Quien ve una parte del proyecto no puede saber si existe en una página que no ve (D401, O1). */}
                  <span>{tr(partial ? 'map.pendingSceneSeen' : 'map.pendingScene', { code: p.code })}</span>
                </>
              }
            >
              <div className="mp-pw">
                {tr('map.namedIn')}{' '}
                {p.mentions.map((m, i) => {
                  const text = m.blockIds[0] ? blockText(session, m.pageId, m.blockIds[0]) : '';
                  return (
                    <span key={m.pageId}>
                      {i > 0 && ' · '}
                      <button className="mp-plink" onClick={() => onPlace({ pageId: m.pageId, blockId: m.blockIds[0] })}>
                        {title(m.pageId)}
                      </button>
                      {text && <span className="mp-q">: «{text}»</span>}
                    </span>
                  );
                })}
              </div>
              <div className="mp-pnote">{tr(partial ? 'map.pendingSeenNote' : 'map.createLater')}</div>
            </PendingRow>
            );
          })}
          <MergePendingRows />
          <FoldPendingRow />
          {data.duplicates.map((d) => (
            <PendingRow
              key={`dup:${d.code}`}
              actions={<MergeButton pair={d} className="mp-btn" />}
              head={
                <>
                  <span className={`mp-chip mono${d.kind === 'day' ? ' day' : ''}`}>
                    <Ic name={d.kind === 'day' ? 'day' : 'scene'} small />
                    {d.code}
                  </span>
                  <span>{tr('map.duplicate', { code: d.code, count: d.pageIds.length })}</span>
                </>
              }
            >
              <div className="mp-pw">
                <TwinPages ids={d.pageIds} title={title} session={session} />
              </div>
              <div className="mp-pnote">{tr(d.kind === 'day' ? 'map.duplicateDayHint' : 'map.duplicateHint')}</div>
            </PendingRow>
          ))}
          {data.unnumbered.map((u) => (
            <PendingRow
              key={`${u.dayId}:${u.blockId}`}
              head={
                <>
                  <span className="mp-warn">
                    <Ic name="warn" small />
                  </span>
                  <span>{tr('map.unnumbered', { title: u.title })}</span>
                </>
              }
              actions={
                <>
                  {src && perms.canEditPage(u.dayId) && <AssignButton src={src} pageId={u.dayId} target={{ kind: 'heading', blockId: u.blockId, text: u.title }} className="mp-btn" />}
                  <button className="mp-btn" onClick={() => onPlace({ pageId: u.dayId, blockId: u.blockId, endBlockId: u.endBlockId })}>
                    {tr('map.openSection')}
                  </button>
                </>
              }
            >
              <div className="mp-pw">
                {data.days.find((d) => d.pageId === u.dayId)?.label ?? title(u.dayId)} · {tr('map.photos', { count: u.photos })} · {tr('map.unnumberedHint')}
              </div>
            </PendingRow>
          ))}
          {data.plans.map((p) => (
            <PendingRow
              key={`plan:${p.pageId}`}
              head={
                <>
                  <span className="mp-chip day mono">
                    <Ic name="day" small />
                    {tr('map.planChip')}
                  </span>
                  <span>{tr(p.why === 'conflict' ? 'map.planConflict' : 'map.planTie', { title: title(p.pageId) })}</span>
                </>
              }
              actions={
                <button className="mp-btn" onClick={() => navigate(pagePath(p.pageId))}>
                  {tr('map.openPlan')}
                </button>
              }
            >
              {p.candidates.length > 0 && (
                <div className="mp-pw">
                  {tr('map.planCandidates')}{' '}
                  {p.candidates.map((id, i) => (
                    <span key={id}>
                      {i > 0 && ' · '}
                      <button className="mp-plink" onClick={() => navigate(pagePath(id))}>
                        {data.days.find((d) => d.pageId === id)?.title ?? title(id)}
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="mp-pnote">{tr('map.planHint')}</div>
            </PendingRow>
          ))}
        </div>
      )}
      <p className="mp-foot2">{tr(partial ? 'map.pendingFootSeen' : 'map.pendingFoot')}</p>
    </>
  );
}
