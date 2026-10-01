import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import { t, useT } from '../i18n';
import '../i18n/lazy/search';
import { navigate, pagePath } from '../router';
import { normalize } from '../search/normalize';
import { nameMatches, parseWords, rangesOf, titlesOnly, type PageHit, type SearchWord, type Snippet } from '../search/projectIndex';
import { usePermissions, useServices, useSyncStatus, useTree } from '../services';
import type { ProjectRow } from '../sync/types';
import { CloseIcon, ExpandIcon, PageIcon, PlusIcon, SearchIcon } from './icons';
import { notify } from './notice';
import { useCurrentProject, useSwitchProject } from './project';
import { Monogram } from './ProjectSwitcher';
import { ReplaceResults } from './ProjectReplace';
import { searchSession, type ResultRequest } from './projectSearchUi';
import { useReplaceSession } from './replaceUi';

// El panel de buscar en el proyecto (Docs/Doc_Buscar.md, secciones 7 y 8, y "Cómo quedó (entrega 2)"). Se abre
// con la lupa de la barra lateral o con Ctrl/⌘+K; en la computadora es una ventana arriba al centro y en el
// teléfono ocupa toda la pantalla. Busca en todas las páginas del proyecto abierto que la persona ve (títulos
// y texto, también pies de fotos y nombres de archivos), en el dispositivo; y muestra los otros proyectos
// cuyo nombre coincide (elegir uno cambia de proyecto) y, si no coincide ninguno, crear uno con ese nombre.

/** Espera al escribir antes de buscar. */
const TYPE_MS = 120;
/** "Buscando…" aparece solo si la lectura tarda más que esto (no parpadea con cada tecla). */
export const SEARCHING_NOTICE_MS = 300;
/** Páginas que se muestran de entrada (y cuántas más con "Mostrar más"). */
const PAGE_LIMIT = 50;
/** Proyectos que se muestran con algo escrito. */
const PROJECT_LIMIT = 5;
/** El largo máximo del nombre de un proyecto (la base: `workspaces_name_length`; el selector usa lo mismo). */
export const PROJECT_NAME_MAX = 200;

type Item =
  | { kind: 'project'; id: string; project: ProjectRow }
  | { kind: 'create'; id: string; name: string }
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

/** Lo encontrado en un nombre (un proyecto). */
function rangesIn(name: string, words: SearchWord[]): [number, number][] {
  return rangesOf(name, normalize(name), words);
}

export function ProjectSearch({ onClose, onGo }: { onClose: () => void; onGo?: () => void }) {
  const services = useServices();
  const session = searchSession(services);
  const index = session.index;
  const tree = useTree();
  const perms = usePermissions();
  const status = useSyncStatus();
  const projectId = useCurrentProject();
  const switchTo = useSwitchProject();
  const tr = useT();
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [limit, setLimit] = useState(PAGE_LIMIT);
  const [active, setActive] = useState(0);
  /** La persona se movió con las flechas desde la última búsqueda (Enter crea un proyecto solo así). */
  const [arrowed, setArrowed] = useState(false);
  const [slow, setSlow] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  /** Dónde estaba el foco al abrir: vuelve ahí al cerrar sin ir a ningún lado (también con Ctrl/⌘+K). */
  const opener = useRef<Element | null>(typeof document !== 'undefined' ? document.activeElement : null);
  /** Se eligió un resultado: el foco lo maneja la página (la barra de buscar). */
  const going = useRef(false);
  const indexRevision = useSyncExternalStore(index.subscribe, index.getRevision);
  const treeRevision = tree.getRevision();
  // Reemplazar en el proyecto (Docs/Doc_Buscar.md, "Reemplazar en el proyecto"): la flecha, solo con los permisos
  // conocidos y alguna página que se pueda editar (sin datos de permisos todo daría "puede": corrección 3).
  const { session: replace, ui: replaceUi } = useReplaceSession();
  const canReplace = perms.known && index.pagesOf(projectId).some((p) => perms.canEditPage(p.id));
  const replacing = canReplace && replaceUi.open;

  useEffect(() => {
    input.current?.focus();
    return () => {
      // Se cerró el panel: la lectura en curso se corta (sigue la próxima vez) y el foco vuelve.
      index.cancel();
      const back = opener.current;
      if (!going.current && back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
    };
  }, [index]);

  // Buscar mientras se escribe, con una espera corta.
  useEffect(() => {
    const timer = setTimeout(() => setSearched(query), query.trim() ? TYPE_MS : 0);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setActive(0);
    setArrowed(false);
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

  // "Buscando…" solo si la lectura tarda.
  useEffect(() => {
    if (!info.building) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), SEARCHING_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [info.building]);

  // Los proyectos: vacío, todos (el abierto marcado); con algo escrito, los otros que coinciden (el abierto no:
  // elegirlo solo cerraría el panel). Antes de la primera sincronización puede faltar el abierto. Los archivados
  // (P.14) salen de la lista de todos los días, pero se encuentran escribiendo su nombre (marcados), también sin red:
  // salen de la copia del dispositivo. El abierto, aunque esté archivado, siempre.
  const known = tree.projects().filter((p) => typed || !p.archived_at || p.id === projectId);
  const allProjects = known.some((p) => p.id === projectId)
    ? known
    : [{ id: projectId, name: tr('project.defaultName'), created_at: '' }, ...known];
  const projects = typed
    ? allProjects.filter((p) => p.id !== projectId && nameMatches(p.name, words)).slice(0, PROJECT_LIMIT)
    : allProjects;
  const projectName = tree.project(projectId)?.name ?? tr('project.defaultName');
  // Crear un proyecto con lo escrito, como en el selector: solo si la persona puede, si no coincide ningún
  // proyecto, y con los resultados al día (lo escrito ya se buscó, el índice no está leyendo y no faltan páginas
  // por bajar): crear de más obliga a borrarlo después (P.14, con la palabra), así que no se ofrece mientras podría
  // haber páginas que coinciden.
  const newName = [...query.trim()].slice(0, PROJECT_NAME_MAX).join('');
  const offerCreate =
    typed &&
    perms.canCreateProject &&
    newName.length > 0 &&
    query === searched &&
    !info.building &&
    info.missing === 0 &&
    !allProjects.some((p) => nameMatches(p.name, words));

  const items: Item[] = [];
  // Con el reemplazo desplegado, la lista es la de cambios (ProjectReplace.tsx), no estas opciones.
  if (!replacing) for (const p of projects) items.push({ kind: 'project', id: `search-project-${p.id}`, project: p });
  if (typed && !replacing) {
    for (const hit of results.hits) {
      items.push({ kind: 'page', id: `search-page-${hit.page.id}`, hit });
      hit.snippets.forEach((snippet, i) => items.push({ kind: 'snippet', id: `search-snippet-${hit.page.id}-${i}`, hit, snippet }));
    }
    if (results.total > results.hits.length) items.push({ kind: 'more', id: 'search-more' });
  }
  // Al final: con páginas que coinciden, Enter abre la primera y no crea nada.
  if (offerCreate && !replacing) items.push({ kind: 'create', id: 'search-create', name: newName });
  const current = items[Math.min(active, items.length - 1)];

  useEffect(() => {
    if (current) document.getElementById(current.id)?.scrollIntoView?.({ block: 'nearest' });
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (request: ResultRequest) => {
    going.current = true;
    session.requestResult({ ...request });
    onGo?.();
    onClose();
    // En la misma página `navigate` no hace nada: el editor, ya abierto, toma el pedido enseguida.
    navigate(pagePath(request.pageId));
  };

  const createProject = async (name: string) => {
    going.current = true;
    onGo?.();
    onClose();
    try {
      switchTo(await tree.createProject(name));
    } catch {
      notify(t('project.saveFailed'));
    }
  };

  const activate = (item: Item | undefined) => {
    if (!item) return;
    if (item.kind === 'project') {
      going.current = item.project.id !== projectId;
      onGo?.();
      onClose();
      if (item.project.id !== projectId) switchTo(item.project.id);
    } else if (item.kind === 'create') {
      void createProject(item.name);
    } else if (item.kind === 'more') {
      setLimit((n) => n + PAGE_LIMIT);
    } else if (item.kind === 'snippet') {
      const { snippet } = item;
      go({ pageId: item.hit.page.id, term: snippet.term, blockId: snippet.blockId, occurrence: snippet.occurrence });
    } else {
      // La página: arriba si lo encontrado está en el título; si no, en su mejor coincidencia.
      const first = item.hit.snippets[0];
      if (item.hit.titleRanges.length > 0 || !first) go({ pageId: item.hit.page.id, term: null });
      else go({ pageId: item.hit.page.id, term: first.term, blockId: first.blockId, occurrence: first.occurrence });
    }
  };

  const onInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length === 0) return;
      const from = Math.min(active, items.length - 1);
      setActive((from + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
      setArrowed(true);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Crear un proyecto es para siempre: con Enter, solo si la persona llegó a esa opción con las flechas
      // (nunca por ser la primera, ni con el mouse encima). Con un clic, sí.
      if (current?.kind === 'create' && !arrowed) return;
      activate(current);
    }
  };

  // En todo el panel: Esc cierra (con el foco donde sea) y Tab no sale del panel (es modal).
  const onPanelKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Tab' && panel.current) {
      const focusable = [...panel.current.querySelectorAll<HTMLElement>('input, button:not([disabled])')];
      if (focusable.length === 0) return;
      const at = focusable.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (at <= 0 ? focusable.length - 1 : at - 1) : at < 0 || at === focusable.length - 1 ? 0 : at + 1;
      e.preventDefault();
      focusable[next].focus();
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
  const itemOf = (test: (item: Item) => boolean) => items.find(test)!;

  const notices: string[] = [];
  if (typed && info.building && slow) notices.push(tr('search.searching'));
  if (info.missing > 0) notices.push(tr(status.online ? 'search.missingOnline' : 'search.missingOffline', { count: info.missing }));
  if (info.unreadable > 0) notices.push(tr('search.unreadable', { count: info.unreadable }));
  const onlyTitles = titlesOnly(words);

  return (
    <div
      className="search-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={panel} className="search-panel" role="dialog" aria-modal="true" aria-label={tr('search.label')} onKeyDown={onPanelKey}>
        <div className="search-field">
          {canReplace && (
            <button
              className={`find-button find-toggle search-replace-toggle${replacing ? ' on' : ''}`}
              aria-expanded={replacing}
              aria-label={tr(replacing ? 'replace.hide' : 'replace.show')}
              data-tip={tr(replacing ? 'replace.hide' : 'replace.show')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => replace.update({ open: !replaceUi.open })}
            >
              <ExpandIcon size={14} />
            </button>
          )}
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
            onKeyDown={onInputKey}
          />
          <button className="icon-button search-close" aria-label={tr('common.close')} onClick={onClose}>
            <CloseIcon size={16} />
          </button>
        </div>
        {replacing ? (
          <ReplaceResults index={index} projectId={projectId} searched={searched} indexRevision={indexRevision} onGo={go} />
        ) : (
        <div className="search-results">
          {/* Fuera de la lista: los avisos, la ayuda y la cantidad (anunciada a los lectores de pantalla). */}
          {notices.length > 0 && <p className="search-notice">{notices.join(' · ')}</p>}
          {!typed && <p className="search-hint muted">{tr('search.hint', { name: projectName })}</p>}
          {typed && onlyTitles && <p className="search-hint muted">{tr('search.titlesOnly')}</p>}
          <p className="sr-only" role="status" aria-live="polite">
            {typed ? tr('search.count', { count: results.total }) : ''}
          </p>
          <div id="search-results" role="listbox" aria-label={tr('search.label')}>
            {projects.length > 0 && (
              <div className="search-group" role="group" aria-label={tr('search.projects')}>
                <span className="mono-label search-section" aria-hidden="true">
                  {tr('search.projects')}
                </span>
                {projects.map((p) =>
                  option(
                    itemOf((i) => i.kind === 'project' && i.project.id === p.id),
                    'search-project',
                    <>
                      <Monogram name={p.name} size={22} />
                      <span className="search-project-name">
                        <Highlight text={p.name} ranges={typed ? rangesIn(p.name, words) : []} />
                      </span>
                      {p.id === projectId ? (
                        <span className="current-mark">{tr('project.open')}</span>
                      ) : (
                        p.archived_at && <span className="current-mark">{tr('project.archivedMark')}</span>
                      )}
                    </>,
                  ),
                )}
              </div>
            )}
            {typed && results.hits.length > 0 && (
              <span className="mono-label search-section" aria-hidden="true">
                {tr('search.pages')}
              </span>
            )}
            {typed &&
              results.hits.map((hit) => (
                <div key={hit.page.id} className="search-result" role="group" aria-label={hit.page.title || tr('common.untitled')}>
                  {option(
                    itemOf((i) => i.kind === 'page' && i.hit === hit),
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
                      itemOf((it) => it.kind === 'snippet' && it.hit === hit && it.snippet === snippet),
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
                  {hit.more > 0 && (
                    <p className="search-more-count muted" aria-hidden="true">
                      {tr('search.more', { count: hit.more })}
                    </p>
                  )}
                </div>
              ))}
            {typed &&
              results.total > results.hits.length &&
              option(itemOf((i) => i.kind === 'more'), 'search-show-more', tr('search.showMore', { count: results.total - results.hits.length }))}
            {offerCreate &&
              option(
                itemOf((i) => i.kind === 'create'),
                'search-create',
                <>
                  <PlusIcon size={16} />
                  <span className="search-project-name">{tr('project.newNamed', { name: newName })}</span>
                </>,
              )}
          </div>
          {typed && results.total === 0 && !info.building && <p className="search-empty muted">{tr('search.none')}</p>}
        </div>
        )}
        <p className="search-footer muted">{tr('search.keys')}</p>
      </div>
    </div>
  );
}
