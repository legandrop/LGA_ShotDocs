import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useT } from '../i18n';
import { usePrefs } from '../prefs';
import { navigate, pagePath } from '../router';
import { useLinkMode } from '../linkMode';
import { usePermissions, useServices, useSyncStatus, useTree } from '../services';
import { ACCESS_REQUESTS_PAGES_SCHEMA_VERSION } from '../sync/accessRequests';
import { LiveHeader } from '../relations/LiveHeader';
import { mergedTarget, restorePage } from '../relations/merge';
import { cededMark } from '../relations/cededCopy';
import { DayReportButton } from '../templates/dayReportUi';
import { TemplateBanner } from '../templates/ownTemplatesUi';
import { disarmTitleUndo, titleUndoFor } from '../templates/templatesUi';
import { clearCommentsTarget, closeComments, useCommentsUi } from './commentsUi';
import { isLetter, modPressed } from './findUi';
import { codePointLength, DB_LIMITS, splitTitle } from '../lib/dbLimits';
import { notify } from './notice';
import { PageBarrier } from './ErrorBarrier';
import { RequestAccess, usePageWorkspaceKnown } from './RequestAccess';
import { CollapseIcon, HeaderIcon } from './icons';
import { lazyPart, Part } from './lazyPart';
import { LinkAsideNotice } from './LinkAsideNotice';
import { LinkVisitorAsideNotice } from './LinkVisitorAsideNotice';
import { useFloating } from './menus';
import { pageFormat, sheetSize, SHEET_MARGIN_MM, mm } from './pageFormat';
import { headerLevels, headerPages, ownHeader } from './titles';
import { setDocumentTitle } from './titleBadge';

export interface TitlePreparation {
  id: string;
  tree: ReturnType<typeof useTree>;
  unsaved: () => boolean;
  prepare: () => Promise<void>;
  stamp: () => object;
}
type RegisterTitle = (title: TitlePreparation) => () => void;

const FOCUS_TITLE = 'shotdocs:focus-title';

// El editor (BlockNote con ProseMirror, Tiptap y los estilos de texto) y el panel de comentarios se bajan
// aparte (roadmap B.4): la barra lateral y el árbol salen sin esperarlos. El título y el encabezado de la
// página se ven enseguida; el cuerpo muestra un esqueleto hasta que el editor está.
const PageEditor = lazyPart(() => import('./PageEditor').then((m) => m.PageEditor));
const CommentsPanel = lazyPart(() => import('./CommentsPanel').then((m) => m.CommentsPanel));

/** Empieza a bajar el editor y el panel de comentarios (la app lo pide apenas está libre). */
export function preloadPageParts(): void {
  PageEditor.preload();
  CommentsPanel.preload();
}

/** Lleva el foco al título de la página abierta (renombrar desde la barra de arriba). */
export function focusTitle(): void {
  window.dispatchEvent(new Event(FOCUS_TITLE));
}

export function PageView({ id, registerTitle }: { id: string; registerTitle?: RegisterTitle }) {
  const tree = useTree();
  const status = useSyncStatus();
  const perms = usePermissions();
  const page = tree.get(id);
  const tr = useT();

  useEffect(() => {
    // Con el número de menciones sin leer adelante, si hay (titleBadge.ts).
    setDocumentTitle(page ? `${page.title || tr('common.untitled')} · Shot Docs` : 'LGA Shot Docs');
  }, [page, tr]);

  if (!page) {
    return (
      <article className="page narrow">
        <p className="muted">
          {status.lastSyncAt === null ? tr('page.looking') : tr('page.notFound')}
        </p>
        {status.lastSyncAt !== null && <RequestPage id={id} />}
      </article>
    );
  }

  const trashedAt = tree.trashedAncestor(id);
  // Una página unida a otra (*Merge*, E16): está en la papelera y su contenido, copiado al final de esa otra.
  const mergedInto = trashedAt?.id === id ? mergedTarget(tree, id) : null;
  const ceded = trashedAt?.id === id ? cededMark(trashedAt) : null;
  const cededTo = ceded && tree.get(ceded.to) && !tree.isTrashed(ceded.to) ? tree.get(ceded.to)! : null;
  const format = pageFormat(tree, id);
  const sheet = sheetSize(format);
  return (
    <article
      className={`page${sheet ? ' sheet' : ''}`}
      style={
        sheet
          ? ({
              '--sheet-width': `${sheet.width}px`,
              '--sheet-height': `${sheet.height}px`,
              '--gutter': `${mm(SHEET_MARGIN_MM)}px`,
            } as CSSProperties)
          : undefined
      }
      data-format={format.size}
      data-page-id={id}
    >
      {trashedAt && (
        <div className="banner">
          {trashedAt.id === id
            ? tr(ceded ? 'page.cededTrash' : 'page.inTrash')
            : tr('page.insideTrashed', { title: trashedAt.title || tr('common.untitled') })}
          {mergedInto && (
            <>
              {' '}
              {tr('merge.mergedInto', { title: tree.get(mergedInto)?.title || tr('common.untitled') })}
              <button className="link" onClick={() => navigate(pagePath(mergedInto))}>
                {tr('merge.openInto', { title: tree.get(mergedInto)?.title || tr('common.untitled') })}
              </button>
            </>
          )}
          {/* La copia que cedió (D628): a la que quedó, si se ve. */}
          {cededTo && (
            <button className="link" onClick={() => navigate(pagePath(cededTo.id))}>
              {tr('page.cededOpen', { title: cededTo.title || tr('common.untitled') })}
            </button>
          )}
          {perms.canManagePage(trashedAt.id) && (
            <button className="link" onClick={() => void restorePage(tree, trashedAt.id)}>
              {trashedAt.id === id ? tr('trash.restore') : tr('page.restoreNamed', { title: trashedAt.title || tr('common.untitled') })}
            </button>
          )}
        </div>
      )}
      {/* Una plantilla propia (Docs/Doc_Plantillas.md, 5.2): qué es y sus ajustes. */}
      <TemplateBanner pageId={id} />
      <LinkAsideNotice pageId={id} />
      <LinkVisitorAsideNotice pageId={id} />
      <PageHeader id={id} editable={perms.canEditRow(id)} />
      <TitleInput id={id} title={page.title} readOnly={!perms.canEditRow(id)} registerTitle={registerTitle} />
      {/* La cabecera viva de una escena o una locación (Docs/Doc_Relaciones.md, 10): interfaz, fuera del documento. */}
      <LiveHeader pageId={id} />
      {/* Si el editor tira un error con lo que tiene la página, falla solo la página (ErrorBarrier.tsx). */}
      <PageBarrier pageId={id}>
        <Part fallback={<EditorSkeleton />}>
          <PageEditor pageId={id} />
        </Part>
      </PageBarrier>
      <CommentsSlot pageId={id} />
    </article>
  );
}

/**
 * *Request access* para una página que no está en el árbol (Doc_Links_PDF.md, entrega 3): «no existe» y «sin acceso» son
 * la misma pantalla y la base responde lo mismo, así que no dice nada de la página. Solo con cuenta (con un link público
 * no se pide, LF3), con red y con la base del workspace en la 24. Si alguien da acceso, la página llega con la próxima
 * sincronización del árbol (cada 10 s) y se abre sola.
 *
 * `/p/<id>` no dice de qué workspace es (sección 19, O1): con más de uno en el dispositivo, el pedido iría a la base del
 * que está abierto aunque la página sea de otro, y nadie lo recibiría. Ahí no se ofrece: la pantalla dice que cambie al
 * workspace del link y lo abra de nuevo.
 */
function RequestPage({ id }: { id: string }) {
  const { workspace, engine, client, user } = useServices();
  const { online, schemaVersion } = useSyncStatus();
  const link = useLinkMode();
  const known = usePageWorkspaceKnown();
  const tr = useT();
  if (link) return null;
  if (!known) return <p className="muted">{tr('page.otherWorkspace')}</p>;
  if (!online || (schemaVersion ?? 0) < ACCESS_REQUESTS_PAGES_SCHEMA_VERSION) return null;
  return (
    <RequestAccess
      key={id}
      client={client}
      userId={user.id}
      localKey={workspace.config.localKey}
      target={{ kind: 'page', id }}
      onHasAccess={() => void engine.syncNow()}
    />
  );
}

/** Lo que ocupa el cuerpo de la página mientras baja el editor (aparece solo si tarda, ver styles.css). */
function EditorSkeleton() {
  const tr = useT();
  return (
    <div className="editor-skeleton" aria-busy="true" aria-label={tr('page.loadingEditor')}>
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}

/** El panel de comentarios se baja recién cuando se abre (o antes, cuando la app está libre). */
function CommentsSlot({ pageId }: { pageId: string }) {
  const { open } = useCommentsUi();
  useEffect(() => CommentsPanel.preload(), []);
  // Al salir de la página, lo pedido para ella no sigue (también con el panel cerrado).
  useEffect(() => () => clearCommentsTarget(pageId), [pageId]);
  if (!open) return null;
  return (
    <Part onClose={closeComments}>
      <CommentsPanel pageId={pageId} />
    </Part>
  );
}

function TitleInput({ id, title, readOnly, registerTitle }: { id: string; title: string; readOnly: boolean; registerTitle?: RegisterTitle }) {
  const tree = useTree();
  const tr = useT();
  const [value, setValue] = useState(() => tree.pendingTitleDraft(id)?.fullText ?? title);
  const [busy, setBusy] = useState(() => !!tree.pendingTitleDraft(id)?.busy);
  const scope = useMemo(() => ({ active: true }), [tree, id]);
  const attempt = useRef<{ scope: typeof scope; promise: Promise<void> } | null>(null);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  /** Lo que viene llegó pegado o soltado (no tecleado): si pasa el tope, lo que sobra va a la página. */
  const bulk = useRef(false);
  const localTitle = useRef<string | null>(tree.pendingTitleDraft(id)?.fullText ?? null);
  const titleStamp = useRef<object>({});

  // Si el título cambia desde otro lado (otro dispositivo, la barra lateral), se muestra salvo que se
  // esté escribiendo acá.
  useEffect(() => {
    const pending = tree.pendingTitleDraft(id);
    if (pending) setValue(pending.fullText);
    else if (!focused.current && localTitle.current === null) setValue(title);
  }, [title, tree, id]);

  useEffect(() => {
    scope.active = true;
    const pending = tree.pendingTitleDraft(id);
    localTitle.current = pending?.fullText ?? null;
    setValue(localTitle.current ?? title);
    setBusy(!!pending?.busy);
    if (pending?.busy) void commit(pending.fullText).catch(() => undefined);
    return () => { scope.active = false; };
  }, [tree, id, scope]);

  useEffect(() => {
    const onFocus = () => {
      ref.current?.focus();
      ref.current?.select();
    };
    window.addEventListener(FOCUS_TITLE, onFocus);
    return () => window.removeEventListener(FOCUS_TITLE, onFocus);
  }, []);

  // El alto del título sigue al texto, pero también al ancho (ventana, barra lateral, tamaño de hoja) y a
  // la fuente (Editorial, o una fuente que termina de cargar después): sin eso, un título de dos renglones
  // queda cortado hasta que se escribe algo.
  const prefsNow = usePrefs();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    let width = el.clientWidth;
    const resize = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit();
    });
    resize.observe(el);
    document.fonts?.addEventListener('loadingdone', fit);
    void document.fonts?.ready.then(fit);
    return () => {
      resize.disconnect();
      document.fonts?.removeEventListener('loadingdone', fit);
    };
  }, [value, prefsNow.font, prefsNow.textSize]);

  const commit = (next: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (attempt.current?.scope === scope) return attempt.current.promise;
    const full = next;
    if (scope.active) setBusy(true);
    const promise = tree.saveTitleDraft(id, full).then(() => {
      if (!scope.active) return;
      if (localTitle.current === full) {
        localTitle.current = null;
        // El campo se recorta recién después del recibo durable de título y sobrante.
        if (codePointLength(full) > DB_LIMITS.pageTitle) setValue(splitTitle(full).head);
      }
    }, (err: unknown) => {
      if (scope.active) notify(tr('leave.unsaved'));
      throw err;
    }).finally(() => {
      if (attempt.current?.promise === promise) attempt.current = null;
      if (scope.active) setBusy(false);
    });
    attempt.current = { scope, promise };
    return promise;
  };

  useEffect(() => {
    titleStamp.current = {};
    return registerTitle?.({
      id, tree,
      stamp: () => titleStamp.current,
      unsaved: () => !!tree.pendingTitleDraft(id) || (localTitle.current !== null &&
        localTitle.current.replace(/\s+/g, ' ').trim() !== tree.get(id)?.title),
      prepare: () => {
        const pending = localTitle.current ?? tree.pendingTitleDraft(id)?.fullText ?? null;
        if (pending === null) return Promise.resolve();
        if (readOnly) return Promise.reject(new Error('Título sin permiso de edición'));
        // Cambiar de página confirma el título: recién ahí cuenta para la marca de tipo (src/relations/entitySync.ts).
        return commit(pending).then(() => tree.titleConfirmed(id));
      },
    });
  }, [id, tree, readOnly, registerTitle]);

  // Un título escrito justo antes de cambiar de página o de cerrar la app no espera la pausa.
  useEffect(() => {
    const flushPending = () => {
      const pending = localTitle.current ?? tree.pendingTitleDraft(id)?.fullText ?? null;
      if (pending !== null && !readOnly) void commit(pending).then(() => tree.titleConfirmed(id)).catch(() => undefined);
    };
    const onHide = () => document.visibilityState === 'hidden' && flushPending();
    window.addEventListener('pagehide', flushPending);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', flushPending);
      document.removeEventListener('visibilitychange', onHide);
      flushPending();
    };
  }, [tree, id, readOnly, scope]);

  return (
    <textarea
      ref={ref}
      className="page-title"
      rows={1}
      value={value}
      placeholder={tr('common.untitled')}
      aria-label={tr('page.title')}
      readOnly={readOnly || busy}
      aria-busy={busy || undefined}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        disarmTitleUndo(id);
        // Salir del campo confirma el título (la pausa de 300 ms no: src/relations/entitySync.ts).
        if (!readOnly) void commit(value).then(() => tree.titleConfirmed(id)).catch(() => undefined);
      }}
      onPaste={() => (bulk.current = true)}
      onDrop={() => (bulk.current = true)}
      onChange={(e) => {
        if (readOnly || attempt.current?.scope === scope || tree.pendingTitleDraft(id)?.busy) return;
        disarmTitleUndo(id);
        const next = e.target.value;
        const pasted = bulk.current;
        bulk.current = false;
        // El tope de la base (500 caracteres, `pages_title_check`): sin él, el cambio quedaba rechazado para siempre.
        if (codePointLength(next) > DB_LIMITS.pageTitle) {
          const native = e.nativeEvent as Partial<InputEvent>;
          const typed =
            !pasted &&
            typeof native.inputType === 'string' &&
            /^insert(Text|CompositionText)$/.test(native.inputType) &&
            codePointLength(native.data ?? '') <= 4;
          if (typed) {
            // Tecleado: no entra (el campo vuelve a lo que tenía) y se avisa.
            notify(tr('page.titleTooLong', { max: DB_LIMITS.pageTitle }));
            return;
          }
          // Pegado, soltado o dictado: el título queda en el tope y lo que sobra va al principio de la página
          // (el aviso lo da sync/titleRest.ts al escribirlo).
          setValue(next);
          localTitle.current = next;
          titleStamp.current = {};
          if (timer.current) clearTimeout(timer.current);
          timer.current = null;
          void commit(next).catch(() => undefined);
          return;
        }
        setValue(next);
        localTitle.current = next;
        titleStamp.current = {};
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void commit(next).catch(() => undefined), 300);
      }}
      onKeyDown={(e) => {
        // Recién elegida una plantilla, el título no tiene nada para deshacer: Ctrl/⌘+Z saca la plantilla y
        // Ctrl/⌘+Shift+Z (o Ctrl/⌘+Y) la devuelve (templatesUi.ts).
        const pageUndo = titleUndoFor(id);
        if (pageUndo && modPressed(e) && !e.altKey && (isLetter(e, 'z') || (!e.shiftKey && isLetter(e, 'y')))) {
          e.preventDefault();
          pageUndo(e.shiftKey || isLetter(e, 'y'));
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          if (readOnly) return;
          void commit(value).then(() => {
            void tree.titleConfirmed(id);
            if (scope.active) window.dispatchEvent(new Event('shotdocs:focus-editor'));
          }).catch(() => undefined);
        }
      }}
    />
  );
}

const LEVEL_CHOICES: { value: number | null; label: string }[] = [
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: null, label: 'all' },
];

/**
 * Encabezado arriba del título con las páginas que contienen a esta ("MGTZD | Brief · Uruguay"). Cuántos
 * niveles muestra, o si se oculta, se guarda en una página y vale para todas las de adentro.
 */
function PageHeader({ id, editable }: { id: string; editable: boolean }) {
  const tree = useTree();
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const pages = headerPages(tree, id);
  const hasAncestors = tree.ancestors(id).length > 0;
  const tr = useT();

  return (
    <div className="page-header">
      {pages.map((p, i) => (
        <span key={p.id} style={{ display: 'contents' }}>
          {i > 0 && (
            <span className="dot" aria-hidden="true">
              ·
            </span>
          )}
          <button
            className={`ancestor${i === pages.length - 1 ? ' nearest' : ''}`}
            onClick={() => navigate(pagePath(p.id))}
            data-tip={p.title || undefined}
            data-tip-plain
            data-tip-overflow
          >
            {p.title || tr('common.untitled')}
          </button>
        </span>
      ))}
      {editable && (
        <button
          ref={toggle}
          className={`header-toggle${pages.length ? '' : ' labelled'}`}
          aria-label={pages.length ? tr('header.options') : undefined}
          data-tip={pages.length ? tr('header.optionsTip') : undefined}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {pages.length ? (
            <CollapseIcon size={14} />
          ) : (
            <>
              <HeaderIcon size={14} /> {hasAncestors ? tr('header.title') : tr('header.forInside')}
            </>
          )}
        </button>
      )}
      {open && editable && <HeaderOptions id={id} anchor={toggle.current} onClose={() => setOpen(false)} />}
      {/* *New day report*, a la derecha (Docs/Doc_Plantillas.md, 6.1): en la carpeta de reportes y en sus reportes. */}
      <DayReportButton pageId={id} />
    </div>
  );
}

function HeaderOptions({ id, anchor, onClose }: { id: string; anchor: HTMLElement | null; onClose: () => void }) {
  const tree = useTree();
  const ref = useRef<HTMLDivElement>(null);
  useFloating(ref, onClose, anchor);
  const { levels, last, from } = headerLevels(tree, id);
  // Dónde se puede guardar: esta página o un contenedor, pero no más arriba de la página que ya define el
  // ajuste que se ve (guardarlo ahí no cambiaría nada acá). Por defecto, en la que lo define.
  const chain = [tree.get(id), ...tree.ancestors(id).reverse()].filter((p): p is NonNullable<typeof p> => !!p);
  const branch = from ? chain.slice(0, chain.findIndex((p) => p.id === from.id) + 1) : chain;
  const [chosen, setTarget] = useState(from?.id ?? id);
  // Si mientras está abierto cambia dónde se define (otro dispositivo), la elección vieja puede quedar
  // fuera de la rama: vuelve a la de por defecto.
  const target = branch.some((p) => p.id === chosen) ? chosen : (from?.id ?? id);
  const shown = headerPages(tree, id);
  const own = ownHeader(tree, id);
  const visible = levels !== 0;
  const tr = useT();

  const save = (next: number | null) =>
    void tree.setSetting(target, 'header', next === 0 ? { levels: 0, last } : { levels: next });

  return (
    <div ref={ref} className="header-popover" role="dialog" aria-label={tr('header.title')}>
      <div className="switch-row">
        <span id="header-show">{tr('header.show')}</span>
        <button
          className="switch"
          role="switch"
          aria-checked={visible}
          aria-labelledby="header-show"
          onClick={() => save(visible ? 0 : last)}
        />
      </div>
      {visible && (
        <div className="pref">
          <span className="pref-label" id="header-levels">
            {tr('header.levels')}
          </span>
          <div className="segmented" role="group" aria-labelledby="header-levels">
            {LEVEL_CHOICES.map((c) => (
              <button key={c.label} aria-pressed={levels === c.value} onClick={() => save(c.value)}>
                {c.value === null ? tr('header.all') : c.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {branch.length > 1 && (
        <div className="pref">
          <label className="pref-label" htmlFor="header-target">
            {tr('pageFormat.saveFor')}
          </label>
          <select id="header-target" value={target} onChange={(e) => setTarget(e.target.value)}>
            {branch.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === id ? tr('pageFormat.thisBranch') : tr('pageFormat.branch', { title: p.title || tr('common.untitled') })}
              </option>
            ))}
          </select>
        </div>
      )}
      <p>
        {visible && shown.length > 0 ? (
          <>{tr.rich('header.startsAt', { title: <strong>{shown[0].title || tr('common.untitled')}</strong> })} </>
        ) : null}
        {from ? (
          tr.rich('header.setOn', {
            where: <strong>{from.id === id ? tr('header.thisPage') : from.title || tr('common.untitled')}</strong>,
          })
        ) : (
          tr('header.notSet')
        )}
      </p>
      {own && (
        <button className="link" onClick={() => void tree.setSetting(id, 'header', undefined)}>
          {tr('header.inherit')}
        </button>
      )}
    </div>
  );
}
