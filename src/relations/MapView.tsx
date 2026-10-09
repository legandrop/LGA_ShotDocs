import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { locale, useT } from '../i18n';
import '../i18n/lazy/map';
import { mapPath, navigate, pagePath, type MapTab } from '../router';
import { SEPARATOR } from '../search/extract';
import { usePermissions, useServices, useTree } from '../services';
import { copyText } from '../ui/commentsUi';
import { notify } from '../ui/notice';
import { useCurrentProject } from '../ui/project';
import { existingRelationsSession, useIndexProgress } from '../ui/relationsUi';
import { goToPlace } from './goToPlace';
import type { Place } from './liveView';
import { fold, type Registry } from './reader';
import { mapCounts, mapJson, mapText, projectMap, sceneFilterText, titlePlace, type MapDay, type MapLocation, type MapScene, type ProjectMapData } from './projectMap';
import { searchScenes } from './sceneSearch';
import { useSlashDraft } from './slashDraft';
import { AssignButton, CreateEntityButton } from './EntityActions';
import { titleFragment } from './aliasAction';
import { LinkLocationButton } from './LinkLocation';
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

  // La consulta abierta del `/` no cuenta como pendiente (D568): al abrirse o cerrarse, se vuelve a armar.
  const draft = useSlashDraft();
  const data = useMemo(() => {
    if (!snap) return null;
    return projectMap({ snap, title: (id) => tree.get(id)?.title, content: (id) => session.index.content(id) });
    // La foto cambia con cada revisión; los títulos se leen del árbol en ese momento.
  }, [snap, revision, tree, session, draft]); // eslint-disable-line react-hooks/exhaustive-deps

  // Quien no ve el proyecto entero (un invitado a una rama) no puede saber qué falta (D401).
  const partial = perms.known && perms.role !== 'owner' && perms.role !== 'admin' && perms.projectLevel(projectId) === 0;
  const complete = !!data?.complete;
  const counts = data ? mapCounts(data) : { scenes: 0, locations: 0, days: 0, pending: 0, duplicates: 0, unnumbered: 0, toResolve: 0 };
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
    { id: 'days', icon: 'day', label: tr('map.tabDays'), n: counts.days },
    { id: 'pending', icon: 'warn', label: tr('map.tabPending'), n: counts.toResolve },
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
                    navigate(mapPath(x.id), true);
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
            {tab !== 'pending' && (
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
          ) : tab === 'scenes' ? (
            <Scenes data={data} fq={fq} codes={codes} complete={complete} partial={partial} />
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

function Scenes({ data, fq, codes, complete, partial }: { data: ProjectMapData; fq: string; codes: Set<string> | null; complete: boolean; partial: boolean }) {
  const tr = useT();
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
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// --- Shoot days ----------------------------------------------------------------------------------------------------

function Days({ data, fq, codes, registry }: { data: ProjectMapData; fq: string; codes: Set<string> | null; registry: Registry | null }) {
  const tr = useT();
  const rows = data.days.filter(
    (d) => !fq || (codes ? [...d.scenes, ...d.planned].some((c) => codes.has(c)) : fold(`${d.date ?? ''} ${d.title} ${d.locs.join(' ')} ${d.scenes.join(' ')}`).includes(fq)),
  );
  if (!rows.length) return <p className="mp-empty">{fq ? tr('map.noMatch') : tr('live.reading')}</p>;
  return (
    <div className="mp-grid mp-days" role="table">
      <div className="mp-drow head" role="row">
        <span role="columnheader">{tr('map.colDate')}</span>
        <span role="columnheader">{tr('map.colDay')}</span>
        <span role="columnheader">{tr('map.colLocation')}</span>
        <span role="columnheader">{tr('map.colScenes')}</span>
      </div>
      {rows.map((d) => {
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
                  <span className="mp-none" data-tip={tr('map.noLocationTip')}>
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
  const nothing = !data.pending.length && !data.unnumbered.length && !data.duplicates.length;
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
                  {src && places.length > 0 && <AssignButton src={src} target={{ kind: 'everywhere', pending: p.code, places }} near={nearOf(p.code)} ep={p.code.includes('_') ? p.code.slice(0, 3) : null} className="mp-btn" />}
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
          {data.duplicates.map((d) => (
            <PendingRow
              key={`dup:${d.code}`}
              head={
                <>
                  <span className="mp-chip mono">
                    <Ic name={d.kind === 'day' ? 'day' : 'scene'} small />
                    {d.code}
                  </span>
                  <span>{tr('map.duplicate', { code: d.code, count: d.pageIds.length })}</span>
                </>
              }
            >
              <div className="mp-pw">
                {d.pageIds.map((id, i) => (
                  <span key={id}>
                    {i > 0 && ' · '}
                    <PageLink pageId={id} className="mp-plink">
                      {title(id)}
                    </PageLink>
                  </span>
                ))}
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
        </div>
      )}
      <p className="mp-foot2">{tr(partial ? 'map.pendingFootSeen' : 'map.pendingFoot')}</p>
    </>
  );
}
