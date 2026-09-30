import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import { useT } from '../i18n';
import '../i18n/lazy/search';
import { navigate, pagePath } from '../router';
import { normalize } from '../search/normalize';
import { nameMatches, parseWords, rangesOf, type PageHit, type SearchWord, type Snippet } from '../search/projectIndex';
import { useServices, useSyncStatus, useTree } from '../services';
import type { ProjectRow } from '../sync/types';
import { CloseIcon, PageIcon, SearchIcon } from './icons';
import { useCurrentProject, useSwitchProject } from './project';
import { Monogram } from './ProjectSwitcher';
import { searchSession, type ResultRequest } from './projectSearchUi';

// El panel de buscar en el proyecto (Docs/Doc_Buscar.md, secciones 7 y 8, y "Cómo quedó (entrega 2)"). Se abre
// con la lupa de la barra lateral o con Ctrl/⌘+K; en la computadora es una ventana arriba al centro y en el
// teléfono ocupa toda la pantalla. Busca en todas las páginas del proyecto abierto que la persona ve (títulos
// y texto, también pies de fotos y nombres de archivos), en el dispositivo; y muestra los proyectos cuyo
// nombre coincide (elegir uno cambia de proyecto, como hacía Ctrl/⌘+K antes).

/** Espera al escribir antes de buscar. */
const TYPE_MS = 120;
/** Páginas que se muestran de entrada (y cuántas más con "Mostrar más"). */
const PAGE_LIMIT = 50;
/** Proyectos que se muestran con algo escrito. */
const PROJECT_LIMIT = 5;

type Item =
  | { kind: 'project'; id: string; project: ProjectRow }
  | { kind: 'page'; id: string; hit: PageHit }
  | { kind: 'snippet'; id: string; hit: PageHit; snippet: Snippet }
  | { kind: 'more'; id: string };

/** El texto con lo encontrado resaltado. */
function Highlight({ text, ranges }: { text: string; ranges: [number, number][] }) {
  const parts: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([s, e], i) => {
    if (s > at) parts.push(text.slice(at, s));
    parts.push(
      <mark key={i} className="search-hit">
        {text.slice(s, e)}
      </mark>,
    );
    at = e;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

export function ProjectSearch({ onClose, onGo }: { onClose: () => void; onGo?: () => void }) {
  const services = useServices();
  const session = searchSession(services);
  const index = session.index;
  const tree = useTree();
  const status = useSyncStatus();
  const projectId = useCurrentProject();
  const switchTo = useSwitchProject();
  const tr = useT();
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [limit, setLimit] = useState(PAGE_LIMIT);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  /** Dónde estaba el foco al abrir: vuelve ahí al cerrar sin ir a ningún lado. */
  const opener = useRef<Element | null>(typeof document !== 'undefined' ? document.activeElement : null);
  const indexRevision = useSyncExternalStore(index.subscribe, index.getRevision);
  const treeRevision = tree.getRevision();

  useEffect(() => {
    input.current?.focus();
  }, []);

  // Buscar mientras se escribe, con una espera corta.
  useEffect(() => {
    const timer = setTimeout(() => setSearched(query), query.trim() ? TYPE_MS : 0);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setActive(0);
    setLimit(PAGE_LIMIT);
  }, [searched]);

  // Leer lo que falte o haya cambiado: al abrir, con cada búsqueda, al terminar cada sincronización y cuando
  // cambia el árbol. Lo que ya está leído y no cambió no se vuelve a leer.
  useEffect(() => {
    void index.refresh(projectId);
  }, [index, projectId, searched, status.lastSyncAt, treeRevision]);

  const results = useMemo(
    () => index.query(projectId, searched, { limit }),
    // Los permisos y la papelera se miran al buscar: se vuelve a buscar con cada cambio del árbol.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index, indexRevision, treeRevision, projectId, searched, limit],
  );
  const info = index.info(projectId);
  const words = parseWords(searched);
  const typed = words.length > 0;

  // Los proyectos (antes de la primera sincronización puede faltar el abierto).
  const known = tree.projects();
  const allProjects = known.some((p) => p.id === projectId)
    ? known
    : [{ id: projectId, name: tr('project.defaultName'), created_at: '' }, ...known];
  const matchingProjects = allProjects.filter((p) => nameMatches(p.name, words));
  const projects = typed ? matchingProjects.slice(0, PROJECT_LIMIT) : matchingProjects;
  const projectName = tree.project(projectId)?.name ?? tr('project.defaultName');

  const items: Item[] = [];
  for (const p of projects) items.push({ kind: 'project', id: `search-project-${p.id}`, project: p });
  if (typed) {
    for (const hit of results.hits) {
      items.push({ kind: 'page', id: `search-page-${hit.page.id}`, hit });
      hit.snippets.forEach((snippet, i) => items.push({ kind: 'snippet', id: `search-snippet-${hit.page.id}-${i}`, hit, snippet }));
    }
    if (results.total > results.hits.length) items.push({ kind: 'more', id: 'search-more' });
  }
  const current = items[Math.min(active, items.length - 1)];

  useEffect(() => {
    if (current) document.getElementById(current.id)?.scrollIntoView?.({ block: 'nearest' });
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    onClose();
    const back = opener.current;
    if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
  };

  const go = (request: ResultRequest) => {
    session.requestResult({ ...request });
    onGo?.();
    onClose();
    // En la misma página `navigate` no hace nada: el editor, ya abierto, toma el pedido enseguida.
    navigate(pagePath(request.pageId));
  };

  const activate = (item: Item | undefined) => {
    if (!item) return;
    if (item.kind === 'project') {
      onGo?.();
      onClose();
      if (item.project.id !== projectId) switchTo(item.project.id);
    } else if (item.kind === 'more') {
      setLimit((n) => n + PAGE_LIMIT);
    } else if (item.kind === 'snippet') {
      const { snippet } = item;
      go({ pageId: item.hit.page.id, term: snippet.term, blockId: snippet.blockId, occurrence: snippet.occurrence });
    } else {
      // La página: arriba si lo encontrado está en el título; si no, en su primera coincidencia.
      const first = item.hit.snippets[0];
      if (item.hit.titleRanges.length > 0 || !first) go({ pageId: item.hit.page.id, term: null });
      else go({ pageId: item.hit.page.id, term: first.term, blockId: first.blockId, occurrence: first.occurrence });
    }
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length === 0) return;
      const from = Math.min(active, items.length - 1);
      setActive((from + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      activate(current);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  const option = (item: Item, className: string, children: ReactNode) => (
    <div
      key={item.id}
      id={item.id}
      role="option"
      aria-selected={item === current}
      className={`search-option ${className}${item === current ? ' active' : ''}`}
      // El foco se queda en el campo (así siguen andando las flechas y Enter).
      onMouseDown={(e) => e.preventDefault()}
      onMouseMove={() => {
        const i = items.indexOf(item);
        if (i !== active) setActive(i);
      }}
      onClick={() => activate(item)}
    >
      {children}
    </div>
  );

  const notices: string[] = [];
  if (typed && info.building) notices.push(tr('search.searching'));
  if (info.missing > 0) notices.push(tr(status.online ? 'search.missingOnline' : 'search.missingOffline', { count: info.missing }));
  if (info.unreadable > 0) notices.push(tr('search.unreadable', { count: info.unreadable }));

  return (
    <div
      className="search-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="search-panel" role="dialog" aria-modal="true" aria-label={tr('search.label')}>
        <div className="search-field">
          <SearchIcon size={18} />
          <input
            ref={input}
            // Texto y no "search": el navegador no suma su propia cruz al lado de la de cerrar.
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="search-results"
            aria-autocomplete="list"
            aria-activedescendant={current?.id}
            aria-label={tr('search.placeholder', { name: projectName })}
            placeholder={tr('search.placeholder', { name: projectName })}
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
          />
          <button className="icon-button search-close" aria-label={tr('common.close')} onClick={close}>
            <CloseIcon size={16} />
          </button>
        </div>
        <div className="search-results" id="search-results" role="listbox" aria-label={tr('search.label')}>
          {notices.length > 0 && (
            <p className="search-notice" role="status">
              {notices.join(' · ')}
            </p>
          )}
          {!typed && <p className="search-hint muted">{tr('search.hint', { name: projectName })}</p>}
          {projects.length > 0 && (
            <div className="search-group" role="group" aria-label={tr('search.projects')}>
              <span className="mono-label search-section">{tr('search.projects')}</span>
              {projects.map((p) =>
                option(
                  items.find((i) => i.kind === 'project' && i.project.id === p.id)!,
                  'search-project',
                  <>
                    <Monogram name={p.name} size={22} />
                    <span className="search-project-name">
                      <Highlight text={p.name} ranges={typed ? rangesIn(p.name, words) : []} />
                    </span>
                    {p.id === projectId && <span className="current-mark">{tr('project.open')}</span>}
                  </>,
                ),
              )}
            </div>
          )}
          {typed && results.hits.length > 0 && (
            <div className="search-group" role="group" aria-label={tr('search.pages')}>
              <span className="mono-label search-section">{tr('search.pages')}</span>
              {results.hits.map((hit) => (
                <div key={hit.page.id} className="search-result">
                  {option(
                    items.find((i) => i.kind === 'page' && i.hit === hit)!,
                    'search-page',
                    <>
                      <PageIcon size={16} />
                      <span className="search-page-text">
                        <span className="search-title">
                          {hit.page.title ? <Highlight text={hit.page.title} ranges={hit.titleRanges} /> : tr('common.untitled')}
                        </span>
                        {hit.path.length > 0 && (
                          <span className="search-path">{hit.path.map((p) => p.title || tr('common.untitled')).join(' › ')}</span>
                        )}
                      </span>
                    </>,
                  )}
                  {hit.snippets.map((snippet) =>
                    option(
                      items.find((it) => it.kind === 'snippet' && it.hit === hit && it.snippet === snippet)!,
                      'search-snippet',
                      <span className="search-snippet-text">
                        {snippet.field !== 'text' && (
                          <span className="search-field-label">{tr(snippet.field === 'caption' ? 'search.inCaption' : 'search.inName')} </span>
                        )}
                        {snippet.cutStart && '…'}
                        <Highlight text={snippet.text} ranges={snippet.ranges} />
                        {snippet.cutEnd && '…'}
                      </span>,
                    ),
                  )}
                  {hit.more > 0 && <p className="search-more-count muted">{tr('search.more', { count: hit.more })}</p>}
                </div>
              ))}
              {results.total > results.hits.length &&
                option(items[items.length - 1], 'search-show-more', tr('search.showMore', { count: results.total - results.hits.length }))}
            </div>
          )}
          {typed && results.total === 0 && !info.building && <p className="search-empty muted">{tr('search.none')}</p>}
        </div>
        <p className="search-footer muted">{tr('search.keys')}</p>
      </div>
    </div>
  );
}

/** Lo encontrado en un nombre (un proyecto). */
function rangesIn(name: string, words: SearchWord[]): [number, number][] {
  return rangesOf(name, normalize(name), words);
}
