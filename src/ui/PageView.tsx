import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useT } from '../i18n';
import { usePrefs } from '../prefs';
import { navigate, pagePath } from '../router';
import { usePermissions, useSyncStatus, useTree } from '../services';
import { DayReportButton } from '../templates/dayReportUi';
import { disarmTitleUndo, titleUndoFor } from '../templates/templatesUi';
import { clearCommentsTarget, closeComments, useCommentsUi } from './commentsUi';
import { isLetter, modPressed } from './findUi';
import { CollapseIcon, HeaderIcon } from './icons';
import { lazyPart, Part } from './lazyPart';
import { useFloating } from './menus';
import { pageFormat, sheetSize, SHEET_MARGIN_MM, mm } from './pageFormat';
import { headerLevels, headerPages, ownHeader } from './titles';

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

export function PageView({ id }: { id: string }) {
  const tree = useTree();
  const status = useSyncStatus();
  const perms = usePermissions();
  const page = tree.get(id);
  const tr = useT();

  useEffect(() => {
    document.title = page ? `${page.title || tr('common.untitled')} · Shot Docs` : 'LGA Shot Docs';
  }, [page, tr]);

  if (!page) {
    return (
      <article className="page narrow">
        <p className="muted">
          {status.lastSyncAt === null ? tr('page.looking') : tr('page.notFound')}
        </p>
      </article>
    );
  }

  const trashedAt = tree.trashedAncestor(id);
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
            ? tr('page.inTrash')
            : tr('page.insideTrashed', { title: trashedAt.title || tr('common.untitled') })}
          {perms.canManagePage(trashedAt.id) && (
            <button className="link" onClick={() => void tree.restore(trashedAt.id)}>
              {trashedAt.id === id ? tr('trash.restore') : tr('page.restoreNamed', { title: trashedAt.title || tr('common.untitled') })}
            </button>
          )}
        </div>
      )}
      <PageHeader id={id} editable={perms.canEditPage(id)} />
      <TitleInput id={id} title={page.title} readOnly={!perms.canEditPage(id)} />
      <Part fallback={<EditorSkeleton />}>
        <PageEditor pageId={id} />
      </Part>
      <CommentsSlot pageId={id} />
    </article>
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
  useEffect(() => () => clearCommentsTarget(), [pageId]);
  if (!open) return null;
  return (
    <Part onClose={closeComments}>
      <CommentsPanel pageId={pageId} />
    </Part>
  );
}

function TitleInput({ id, title, readOnly }: { id: string; title: string; readOnly: boolean }) {
  const tree = useTree();
  const tr = useT();
  const [value, setValue] = useState(title);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Si el título cambia desde otro lado (otro dispositivo, la barra lateral), se muestra salvo que se
  // esté escribiendo acá.
  useEffect(() => {
    if (!focused.current) setValue(title);
  }, [title]);

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
    void tree.rename(id, next.replace(/\s+/g, ' ').trim());
  };

  // Un título escrito justo antes de cambiar de página o de cerrar la app no espera la pausa.
  useEffect(() => {
    const flushPending = () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      timer.current = null;
      void tree.rename(id, (ref.current?.value ?? '').replace(/\s+/g, ' ').trim());
    };
    const onHide = () => document.visibilityState === 'hidden' && flushPending();
    window.addEventListener('pagehide', flushPending);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', flushPending);
      document.removeEventListener('visibilitychange', onHide);
      flushPending();
    };
  }, [tree, id]);

  return (
    <textarea
      ref={ref}
      className="page-title"
      rows={1}
      value={value}
      placeholder={tr('common.untitled')}
      aria-label={tr('page.title')}
      readOnly={readOnly}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        disarmTitleUndo(id);
        if (!readOnly) commit(value);
      }}
      onChange={(e) => {
        disarmTitleUndo(id);
        setValue(e.target.value);
        if (timer.current) clearTimeout(timer.current);
        const next = e.target.value;
        timer.current = setTimeout(() => commit(next), 300);
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
          commit(value);
          window.dispatchEvent(new Event('shotdocs:focus-editor'));
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
