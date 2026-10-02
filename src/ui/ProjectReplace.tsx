import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { t, useT, type Key } from '../i18n';
import '../i18n/lazy/search';
import type { ProjectIndex, PhraseHit, PhraseMatch } from '../search/projectIndex';
import type { OpHeader, PageBlock, ReplaceRequest, RunResult, Summary, UndoResult } from '../search/projectReplace';
import { usePermissions, useTree } from '../services';
import { CloseIcon, PageIcon } from './icons';
import { notify } from './notice';
import type { ResultRequest } from './projectSearchUi';
import { useReplaceSession, type ReplaceSession } from './replaceUi';

// Reemplazar en todo el proyecto (Docs/Doc_Buscar.md, "Reemplazar en el proyecto (diseño)" y "Cómo quedó (entrega
// 3)"): el renglón del reemplazo (campo, *Aa*, palabra entera, *Replace all*), la lista de cambios por página con
// la vista previa, reemplazar una, la página o todas (con confirmación), el avance con *Stop*, el aviso con *Undo* y
// los últimos reemplazos. Lo dibuja el panel de Ctrl/⌘+K (ProjectSearch.tsx) con la flecha desplegada. Escribir lo
// hace el motor (search/projectReplace.ts), que sigue aunque se cierre el panel.

/** Coincidencias por página en la lista; las demás cambian igual con la página. */
const MATCHES_PER_PAGE = 20;
/** Páginas en la lista (y cuántas más con "Mostrar más"). */
const PAGE_LIMIT = 50;
/** Lo que se ve de cada lado de lo encontrado en la vista previa. */
const CONTEXT = 40;

/** El texto de cada motivo para no tocar una página. */
const BLOCK_TEXT: Record<PageBlock, Key> = {
  gone: 'replace.block.gone',
  trash: 'replace.block.trash',
  permsUnknown: 'replace.block.permsUnknown',
  viewOnly: 'replace.block.viewOnly',
  missing: 'replace.block.missing',
  unreadable: 'replace.block.unreadable',
  rejected: 'replace.block.rejected',
  unsupported: 'replace.block.unsupported',
  changing: 'replace.block.changing',
  error: 'replace.block.error',
};

function blockText(block: PageBlock): string {
  return t(BLOCK_TEXT[block]);
}

function preview(match: PhraseMatch): {
  before: string;
  found: string;
  after: string;
} {
  const start = Math.max(0, match.start - CONTEXT);
  const end = Math.min(match.text.length, match.end + CONTEXT);
  const clean = (s: string) => s.replaceAll('￼', ' ');
  return {
    before: (start > 0 ? '…' : '') + clean(match.text.slice(start, match.start)),
    found: match.text.slice(match.start, match.end),
    after: clean(match.text.slice(match.end, end)) + (end < match.text.length ? '…' : ''),
  };
}

/** El aviso del resultado de reemplazar, con *Undo* si quedó algo para deshacer. */
export function reportRun(session: ReplaceSession, result: RunResult): void {
  const parts: string[] = [];
  if (result.unsaved) parts.push(t('replace.unsaved'));
  parts.push(t('replace.done', { count: result.replaced, pages: t('replace.pages', { count: result.pages }) }));
  if (result.stopped) parts.push(t('replace.stopped'));
  if (result.hidden > 0) parts.push(t('replace.wereHidden', { count: result.hidden }));
  // Nada cambió: por qué (un link entero, el borde de una foto, ya era igual).
  if (result.replaced === 0) {
    const s = result.skipped;
    if (s.link) parts.push(t('replace.skip.link', { count: s.link }));
    if (s.boundary) parts.push(t('replace.skip.boundary', { count: s.boundary }));
    if (s.same) parts.push(t('replace.skip.same', { count: s.same }));
    if (s.hidden) parts.push(t('replace.skip.hidden', { count: s.hidden }));
  }
  const notTouched = Object.values(result.blocked).reduce((n, v) => n + (v ?? 0), 0);
  if (notTouched > 0) parts.push(t('replace.pagesSkipped', { count: notTouched }));
  const opId = result.opId;
  notify(parts.join(' · '), opId && result.replaced > 0 ? { label: t('replace.undo'), run: () => void undoOp(session, opId) } : undefined);
}

/** Deshace un reemplazo y avisa cómo quedó. */
export async function undoOp(session: ReplaceSession, opId: string): Promise<UndoResult> {
  const result = await session.engine.undo(opId);
  const parts = [t('replace.undone', { count: result.undone })];
  if (result.changed > 0) parts.push(t('replace.undoChanged', { count: result.changed }));
  if (result.remaining > 0) parts.push(t('replace.undoRemaining', { count: result.remaining }));
  if (result.unsaved) parts.push(t('replace.unsaved'));
  notify(parts.join(' · '));
  return result;
}

interface Props {
  index: ProjectIndex;
  projectId: string;
  /** Lo buscado (ya con la espera al escribir). */
  searched: string;
  indexRevision: number;
  onGo: (request: ResultRequest) => void;
}

/** El renglón del reemplazo: debajo del campo de buscar. */
export function ReplaceRow({ count, onReplaceAll, busy }: { count: number; onReplaceAll: () => void; busy: boolean }) {
  const { session, ui } = useReplaceSession();
  const tr = useT();
  return (
    <div className="replace-row">
      <input
        className="replace-input"
        type="text"
        autoComplete="off"
        spellCheck={false}
        placeholder={tr('replace.placeholder')}
        aria-label={tr('replace.placeholder')}
        value={ui.replacement}
        onChange={(e) => session.update({ replacement: e.target.value })}
      />
      <button
        className={`find-button find-option${ui.matchCase ? ' on' : ''}`}
        aria-pressed={ui.matchCase}
        aria-label={tr('replace.matchCase')}
        data-tip={tr('replace.matchCase')}
        onClick={() => {
          session.update({ matchCase: !ui.matchCase });
          session.clearExcluded();
        }}
      >
        Aa
      </button>
      <button
        className={`find-button find-option find-word${ui.wholeWord ? ' on' : ''}`}
        aria-pressed={ui.wholeWord}
        aria-label={tr('replace.wholeWord')}
        data-tip={tr('replace.wholeWord')}
        onClick={() => {
          session.update({ wholeWord: !ui.wholeWord });
          session.clearExcluded();
        }}
      >
        ab
      </button>
      <button className="find-text-button replace-all" disabled={busy || count === 0} onClick={onReplaceAll}>
        {tr('replace.all', { count })}
      </button>
    </div>
  );
}

/** Los resultados con el reemplazo desplegado: la lista de cambios, la confirmación, el avance y los últimos. */
export function ReplaceResults({ index, projectId, searched, indexRevision, onGo }: Props) {
  const { session, ui } = useReplaceSession();
  const engine = session.engine;
  const tree = useTree();
  const perms = usePermissions();
  const tr = useT();
  const options = useMemo(() => ({ matchCase: ui.matchCase, wholeWord: ui.wholeWord }), [ui.matchCase, ui.wholeWord]);
  const [limit, setLimit] = useState(PAGE_LIMIT);
  const progress = useSyncExternalStore(engine.subscribe, () => engine.getProgress());
  const [phase, setPhase] = useState<'idle' | 'checking'>('idle');
  const [confirm, setConfirm] = useState<{
    request: ReplaceRequest;
    summary: Summary;
  } | null>(null);
  const [deleteHidden, setDeleteHidden] = useState(false);
  const [recent, setRecent] = useState<OpHeader[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [blocks, setBlocks] = useState<Map<string, PageBlock | null>>(new Map());
  /** Los bloques escondidos en secciones colapsadas de cada página de la lista (se marcan en sus renglones). */
  const [hiddenBlocks, setHiddenBlocks] = useState<Map<string, Set<string>>>(new Map());
  /** Los ids de cada coincidencia de las páginas con algo sacado de la lista (para esconder esos renglones). */
  const [keys, setKeys] = useState<Map<string, Map<string, string>>>(new Map());
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Lo sacado de la lista vale para esta búsqueda.
  const signature = `${searched}\u0000${ui.matchCase}\u0000${ui.wholeWord}`;
  const lastSignature = useRef(signature);
  useEffect(() => {
    if (lastSignature.current !== signature) session.clearExcluded();
    lastSignature.current = signature;
    setLimit(PAGE_LIMIT);
  }, [signature, session]);

  // Mientras corre un reemplazo (o su deshacer), la lista no se recalcula con cada página escrita: cada cambio del
  // índice volvería a buscar y a revisar hasta 50 páginas en IndexedDB (con el panel abierto tardaba el triple). Al
  // terminar, se recalcula una vez.
  const running = progress !== null;
  const frozen = useRef({ index: indexRevision, tree: tree.getRevision() });
  if (!running) frozen.current = { index: indexRevision, tree: tree.getRevision() };
  const listRevision = frozen.current.index;
  const listTreeRevision = frozen.current.tree;

  const hits: PhraseHit[] = useMemo(
    () => (searched.trim() ? index.phrase(projectId, searched, options).filter((h) => !ui.excludedPages.has(h.page.id)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index, listRevision, listTreeRevision, projectId, searched, options, ui.excludedPages],
  );
  const shown = hits.slice(0, limit);

  // Por qué no se toca cada página de la lista (se pide al motor: mira el estado guardado).
  const pageIdsKey = shown.map((h) => h.page.id).join(',');
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = new Map<string, PageBlock | null>();
      const hidden = new Map<string, Set<string>>();
      for (const h of shown) {
        next.set(h.page.id, await engine.blockOf(h.page.id, projectId).catch(() => 'error' as const));
        hidden.set(h.page.id, await engine.hiddenOf(h.page.id).catch(() => new Set<string>()));
      }
      if (!cancelled) {
        setBlocks(next);
        setHiddenBlocks(hidden);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIdsKey, projectId, engine, listRevision, listTreeRevision, perms.known, running]);

  // Los ids de las coincidencias de las páginas con algo sacado: así un renglón sacado sigue afuera aunque otro
  // agregue una antes (se identifica por sus caracteres, no por su número).
  const excludedKey = [...ui.excluded.keys()].join(',');
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = new Map<string, Map<string, string>>();
      for (const pageId of ui.excluded.keys()) {
        const matches = await engine.matchesOf(pageId, searched, options).catch(() => []);
        next.set(pageId, new Map(matches.map((m) => [`${m.blockId}#${m.occurrence}`, m.key])));
      }
      if (!cancelled) setKeys(next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excludedKey, listRevision, searched, options, engine]);

  // Los últimos reemplazos del proyecto.
  useEffect(() => {
    let cancelled = false;
    void engine.list(projectId).then((list) => {
      if (!cancelled) setRecent(list);
    });
    return () => {
      cancelled = true;
    };
  }, [engine, projectId, running]);

  const isExcluded = (pageId: string, m: PhraseMatch) => {
    const key = keys.get(pageId)?.get(`${m.blockId}#${m.occurrence}`);
    return !!key && !!ui.excluded.get(pageId)?.has(key);
  };
  const visible = (h: PhraseHit) => h.matches.filter((m) => !isExcluded(h.page.id, m));
  const replaceable = (h: PhraseHit) => (blocks.get(h.page.id) ? [] : visible(h).filter((m) => m.field === 'text'));
  const total = hits.reduce((n, h) => n + replaceable(h).length, 0);
  const excludedSet = (pageId?: string): Set<string> => {
    const out = new Set<string>();
    for (const [p, set] of ui.excluded) if (!pageId || p === pageId) for (const k of set) out.add(k);
    return out;
  };
  const baseRequest = (pageIds: string[], extra: Partial<ReplaceRequest> = {}): ReplaceRequest => ({
    projectId,
    pageIds,
    query: searched,
    replacement: ui.replacement,
    options,
    exclude: excludedSet(),
    ...extra,
  });
  const busy = progress !== null || phase !== 'idle';

  const run = async (request: ReplaceRequest) => {
    reportRun(session, await engine.run(request));
  };

  /** Una coincidencia: se identifica por sus caracteres en el documento de ahora (no por su número). */
  const keyFor = async (pageId: string, m: PhraseMatch): Promise<string | null> => {
    const matches = await engine.matchesOf(pageId, searched, options);
    const found = matches.find((x) => x.blockId === m.blockId && x.occurrence === m.occurrence && x.field === 'text');
    return found && found.text === m.text.slice(m.start, m.end) && found.key ? found.key : null;
  };

  const replaceOne = async (pageId: string, m: PhraseMatch) => {
    const key = await keyFor(pageId, m);
    if (!key) return notify(tr('replace.changed'));
    // La eligió en la lista: se cambia aunque esté escondida (también con el reemplazo vacío).
    await run(baseRequest([pageId], { only: new Set([key]), exclude: undefined, scope: 'some', deleteHidden: true }));
  };

  const exclude = async (pageId: string, m: PhraseMatch) => {
    const key = await keyFor(pageId, m);
    if (!key) return;
    const next = new Map(ui.excluded);
    next.set(pageId, new Set([...(next.get(pageId) ?? []), key]));
    session.update({ excluded: next });
  };

  const replaceAll = async () => {
    setPhase('checking');
    try {
      const request = baseRequest(hits.map((h) => h.page.id));
      const summary = await engine.prepare(request);
      setDeleteHidden(false);
      setConfirm({ request, summary });
    } finally {
      setPhase('idle');
    }
  };

  useEffect(() => {
    if (confirm) cancelRef.current?.focus();
  }, [confirm]);

  /** Cierra la confirmación y deja el foco en el campo del reemplazo (si no, quedaría en la página y Esc no cerraría el panel). */
  const closeConfirm = () => {
    setConfirm(null);
    document.querySelector<HTMLInputElement>('.search-panel .replace-input')?.focus();
  };

  const latest = recent[0];
  const older = recent.slice(1);
  const recentLine = (op: OpHeader) => (
    <li key={op.id} className="replace-recent-item">
      <span>
        {tr('replace.recent', {
          query: op.query,
          replacement: op.replacement,
          count: op.replaced,
          pages: tr('replace.pages', { count: op.pages.length }),
        })}
        {op.status === 'stopped' && ` · ${tr('replace.recentStopped', { done: op.pages.length, total: op.planned })}`}
        {op.status === 'partial' && ` · ${tr('replace.recentPartial')}`}
      </span>
      <button className="link" disabled={busy} onClick={() => void undoOp(session, op.id)}>
        {op.status === 'partial' ? tr('replace.undoRest') : tr('replace.undo')}
      </button>
    </li>
  );

  const skippedParts = (summary: Summary): string[] => {
    const parts: string[] = [];
    const s = summary.skipped;
    if (s.caption || s.name) parts.push(tr('replace.skip.fields', { count: (s.caption ?? 0) + (s.name ?? 0) }));
    if (s.link) parts.push(tr('replace.skip.link', { count: s.link }));
    if (s.boundary) parts.push(tr('replace.skip.boundary', { count: s.boundary }));
    if (summary.blocked) parts.push(tr('replace.skip.pages', { count: summary.blocked }));
    return parts;
  };

  return (
    <>
      <ReplaceRow count={total} busy={busy} onReplaceAll={() => void replaceAll()} />
      <div className="search-results replace-area">
        {progress && (
          <div className="replace-progress" role="status">
            <span>
              {tr(progress.kind === 'undo' ? 'replace.undoing' : 'replace.progress', { done: progress.done, total: progress.total })}
            </span>
            {progress.kind === 'replace' && (
              <button className="link" onClick={() => engine.stop()}>
                {tr('replace.stop')}
              </button>
            )}
          </div>
        )}
        {phase === 'checking' && (
          <p className="search-notice" role="status">
            {tr('replace.checking')}
          </p>
        )}
        {latest && (
          <ul className="replace-recent">
            {recentLine(latest)}
            {showAll && older.map(recentLine)}
            {older.length > 0 && !showAll && (
              <li>
                <button className="link" onClick={() => setShowAll(true)}>
                  {tr('replace.more', { count: older.length })}
                </button>
              </li>
            )}
          </ul>
        )}
        {searched.trim() && hits.length === 0 && <p className="search-empty muted">{tr('search.none')}</p>}
        {searched.trim() && hits.length > 0 && (
          <p className="replace-summary muted" role="status">
            {tr('replace.summary', {
              count: total,
              pages: tr('replace.pages', { count: hits.filter((h) => replaceable(h).length > 0).length }),
            })}
          </p>
        )}
        <div className="replace-list">
          {shown.map((hit) => {
            const block = blocks.get(hit.page.id) ?? null;
            const matches = visible(hit);
            const canDo = !block && matches.some((m) => m.field === 'text');
            return (
              <section key={hit.page.id} className="replace-page" aria-label={hit.page.title || tr('common.untitled')}>
                <div className="replace-page-head">
                  <button className="replace-page-go" onClick={() => onGo({ pageId: hit.page.id, term: null })}>
                    <PageIcon size={16} />
                    <span className="search-page-text">
                      <span className="search-title">{hit.page.title || tr('common.untitled')}</span>
                      {hit.path.length > 0 && (
                        <span className="search-path">{hit.path.map((p) => p.title || tr('common.untitled')).join(' › ')}</span>
                      )}
                    </span>
                  </button>
                  <span className="replace-count">{matches.length}</span>
                  {block && <span className="replace-block muted">{blockText(block)}</span>}
                  {canDo && (
                    <button
                      className="find-text-button"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          baseRequest([hit.page.id], {
                            exclude: excludedSet(hit.page.id),
                            scope: 'some',
                          }),
                        )
                      }
                    >
                      {tr('replace.page')}
                    </button>
                  )}
                  <button
                    className="find-button"
                    aria-label={tr('replace.leaveOutPage')}
                    data-tip={tr('replace.leaveOutPage')}
                    onClick={() =>
                      session.update({
                        excludedPages: new Set([...ui.excludedPages, hit.page.id]),
                      })
                    }
                  >
                    <CloseIcon size={14} />
                  </button>
                </div>
                <ul className="replace-matches">
                  {matches.slice(0, MATCHES_PER_PAGE).map((m) => {
                    const p = preview(m);
                    const field = m.field !== 'text';
                    return (
                      <li key={`${m.blockId}#${m.occurrence}`} className="replace-match">
                        <button
                          className="replace-match-go"
                          onClick={() =>
                            onGo({
                              pageId: hit.page.id,
                              term: searched,
                              blockId: m.blockId,
                              occurrence: m.occurrence,
                              options,
                            })
                          }
                        >
                          {field && (
                            <span className="search-field-label">{tr(m.field === 'caption' ? 'search.inCaption' : 'search.inName')} </span>
                          )}
                          {p.before}
                          <del className="replace-old">{p.found}</del>
                          {!field && !block && ui.replacement && <ins className="replace-new">{ui.replacement}</ins>}
                          {p.after}
                          {hiddenBlocks.get(hit.page.id)?.has(m.blockId) && (
                            <span className="replace-hidden-mark muted"> · {tr('replace.inCollapsed')}</span>
                          )}
                        </button>
                        {field ? (
                          <span className="replace-block muted">{tr('replace.fieldNotReplaced')}</span>
                        ) : (
                          !block && (
                            <>
                              <button
                                className="find-text-button"
                                disabled={busy}
                                data-tip={tr('replace.oneTip')}
                                onClick={() => void replaceOne(hit.page.id, m)}
                              >
                                {tr('replace.one')}
                              </button>
                              <button
                                className="find-button"
                                aria-label={tr('replace.leaveOut')}
                                data-tip={tr('replace.leaveOut')}
                                onClick={() => void exclude(hit.page.id, m)}
                              >
                                <CloseIcon size={13} />
                              </button>
                            </>
                          )
                        )}
                      </li>
                    );
                  })}
                  {matches.length > MATCHES_PER_PAGE && (
                    <li className="replace-more muted">
                      {tr('replace.moreInPage', {
                        count: matches.length - MATCHES_PER_PAGE,
                      })}
                    </li>
                  )}
                </ul>
              </section>
            );
          })}
          {hits.length > shown.length && (
            <button className="link replace-show-more" onClick={() => setLimit((n) => n + PAGE_LIMIT)}>
              {tr('search.showMore', { count: hits.length - shown.length })}
            </button>
          )}
        </div>
      </div>
      {confirm && (
        <div
          className="replace-confirm-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeConfirm();
          }}
        >
          <div
            className="modal replace-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="replace-confirm-title"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closeConfirm();
              }
            }}
          >
            {(() => {
              const { summary, request } = confirm;
              const deleting = request.replacement === '';
              const count = summary.count + (deleting && deleteHidden ? summary.hidden : 0);
              const skipped = skippedParts(summary);
              return (
                <>
                  <h2 id="replace-confirm-title">
                    {count === 0
                      ? tr('replace.confirmNone')
                      : tr(deleting ? 'replace.confirmDelete' : 'replace.confirmTitle', { count, pages: tr('replace.pages', { count: summary.pageCount }) })}
                  </h2>
                  <p className="replace-confirm-what">
                    “{request.query}” → {deleting ? tr('replace.nothing') : `“${request.replacement}”`}
                  </p>
                  {summary.hidden > 0 && !deleting && <p>{tr('replace.confirmHidden', { count: summary.hidden })}</p>}
                  {summary.hidden > 0 && deleting && (
                    <label className="replace-confirm-check">
                      <input type="checkbox" checked={deleteHidden} onChange={(e) => setDeleteHidden(e.target.checked)} />
                      {tr('replace.deleteHidden', { count: summary.hidden })}
                    </label>
                  )}
                  {skipped.length > 0 && <p className="muted">{tr('replace.wontChange', { list: skipped.join(', ') })}</p>}
                  {summary.offline && <p className="muted">{tr('replace.offline')}</p>}
                  <p className="muted">{tr('replace.canUndo')}</p>
                  <div className="modal-actions">
                    <button ref={cancelRef} onClick={() => closeConfirm()}>
                      {tr('common.cancel')}
                    </button>
                    <button
                      className={`primary${deleting ? ' danger' : ''}`}
                      disabled={count === 0}
                      onClick={() => {
                        closeConfirm();
                        void run({
                          ...request,
                          deleteHidden: deleting && deleteHidden,
                        });
                      }}
                    >
                      {tr(deleting ? 'replace.confirmDeleteButton' : 'replace.confirmButton', { count })}
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </>
  );
}
