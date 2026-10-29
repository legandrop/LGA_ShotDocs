import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useT, type Translate } from '../i18n';
import '../i18n/lazy/help';
import './help.css';
import { usePermissions, useServices, useSyncStatus } from '../services';
import { inTourDocument, launchTour } from '../tutorial/tourState';
import { isPhoneLayout } from '../ui/commentsUi';
import { openInstallDialog, useInstallState } from '../ui/install';
import { ChevronRightIcon, CloseIcon, SearchIcon } from '../ui/icons';
import { IS_MAC, shortcutLabel, SHORTCUT_PLACES, SHORTCUTS } from '../ui/shortcuts';
import { HELP_ENTRIES, HELP_SECTIONS, type HelpEntry, type HelpWhen } from './entries';
import { isNewer, latestOf, markHelpNewsSeen, versionValue } from './news';
import { searchHelp } from './search';
import { PLACE_TEXTS, SHORTCUT_TEXTS } from './shortcutTexts';
import { useThinScroll } from './thinScroll';
import { ToursTab } from './ToursTab';

// La ayuda (Docs/Doc_Tutorial.md, sección 5; Docs/Plan_Proyecto_Desde_Cero.md, sección 5): como en las demás apps LGA,
// arriba el nombre de la app con su versión, quién la hizo y su página; debajo, tres pestañas:
// - *Tours*: los recorridos con capítulos (ToursTab.tsx). Abre en esta, salvo que haya novedades (*Topics*, donde están)
//   o que se pida una sección.
// - *Topics*: las entradas (entries.ts) plegadas: se ve el título y un clic despliega el texto. La búsqueda despliega lo
//   que encuentra; las novedades van arriba, desplegadas.
// - *Shortcuts*: la tabla de atajos, con los rótulos del registro (shortcuts.ts) para la plataforma de este dispositivo.
// La ventana se agranda desde la esquina y recuerda el tamaño en el dispositivo; en el teléfono va a pantalla completa.
// Se baja aparte (lazyDialogs).

export interface HelpDialogProps {
  /** La sección donde abre (`keys`: la pestaña de atajos). */
  section?: string | null;
  onClose: () => void;
  /** "Ver la recorrida" (sin esto, la entrada no ofrece el botón). */
  onTour?: () => void;
  /** "Practicar": abre la página de práctica, o la arma de nuevo. */
  onPractice?: () => void;
  /** "Mostrame" (entrega 3): la práctica con el paso de la recorrida de la entrada (`showMe`), y vuelta. */
  onShowMe?: (step: string) => void;
  /** Las novedades: lo que la persona había visto al abrir (`HelpUiState.news`); `null`, sin novedades. */
  news?: string | null;
}

type Tab = 'tours' | 'topics' | 'keys';
const TABS: { id: Tab; label: 'help.tab.tours' | 'help.tab.topics' | 'help.tab.keys' }[] = [
  { id: 'tours', label: 'help.tab.tours' },
  { id: 'topics', label: 'help.tab.topics' },
  { id: 'keys', label: 'help.tab.keys' },
];

const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export function HelpDialog({ section = null, onClose, onTour, onPractice, onShowMe, news = null }: HelpDialogProps) {
  const tr = useT();
  const dialog = useRef<HTMLDivElement>(null);
  const phone = isPhoneLayout();
  // En el documento de práctica de los recorridos no se ofrecen la práctica ni «Show me» (son de la app).
  const practiceDoc = inTourDocument();
  const actions = {
    tour: onTour,
    practice: practiceDoc ? undefined : onPractice,
    install: () => {
      onClose();
      openInstallDialog();
    },
  };
  const isNew = (entry: HelpEntry) => news !== null && isNewer(entry.since, news);
  // Las entradas con botón solo si el botón existe (antes de la recorrida, no se ofrecen).
  const visible = HELP_ENTRIES.filter((e) => !e.action || actions[e.action]);
  // Las novedades, arriba de todo: lo más nuevo primero (las de la misma versión, en el orden de la ayuda).
  const fresh = visible
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => isNew(e))
    .sort((a, b) => versionValue(b.e.since) - versionValue(a.e.since) || a.i - b.i)
    .map(({ e }) => e);
  const [tab, setTab] = useState<Tab>(() => (section === 'keys' ? 'keys' : section || fresh.length > 0 ? 'topics' : 'tours'));
  const size = useHelpSize(phone);

  // El foco entra al diálogo (en *Topics*, al campo de buscar: en un táctil no, que el teclado taparía la ayuda).
  useLayoutEffect(() => {
    dialog.current?.focus({ preventScroll: true });
  }, []);

  // Al abrir, las novedades quedan vistas: el punto del "?" se va (la lista sigue mientras la ayuda está abierta).
  useEffect(() => {
    markHelpNewsSeen(latestOf(HELP_ENTRIES.map((e) => e.since)), __APP_VERSION__);
  }, []);

  // Esc cierra; Tab queda adentro (es modal); ← y → cambian de pestaña con el foco en una.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !dialog.current) return;
    const items = [...dialog.current.querySelectorAll<HTMLElement>('input, button:not(:disabled), [href]')];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length].id;
    setTab(next);
    dialog.current?.querySelector<HTMLElement>(`[data-help-tab="${next}"]`)?.focus();
  };

  return (
    <div className="modal-backdrop help-backdrop" onClick={onClose}>
      <div
        ref={dialog}
        className="help-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={tr('help.title')}
        tabIndex={-1}
        style={phone ? undefined : { width: size.width, height: size.height }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <header className="help-head">
          <div className="help-brand">
            <h2 className="help-app">
              LGA Shot Docs
              {__APP_VERSION__ && <span className="help-version">v{__APP_VERSION__}</span>}
            </h2>
            <span className="help-developed">{tr('help.developedBy')}</span>
            <a className="help-link" href="https://lega.com.ar" target="_blank" rel="noopener noreferrer">
              lega.com.ar
            </a>
          </div>
          <button className="icon-button help-close" aria-label={tr('common.close')} onClick={onClose}>
            <CloseIcon size={18} />
          </button>
        </header>
        <div className="help-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              id={`help-tab-${t.id}`}
              data-help-tab={t.id}
              aria-selected={tab === t.id}
              aria-controls="help-panel"
              tabIndex={tab === t.id ? 0 : -1}
              className={`help-tab${tab === t.id ? ' selected' : ''}`}
              // El foco va a la pestaña: lo que lo tenía (el campo de buscar de *Topics*) se va con la pestaña de antes, y
              // con el foco afuera del diálogo Esc ya no lo cerraría (Safari no enfoca un botón al hacer clic).
              onClick={(e) => {
                e.currentTarget.focus({ preventScroll: true });
                setTab(t.id);
              }}
              onKeyDown={onTabKey}
            >
              {tr(t.label)}
              {t.id === 'topics' && fresh.length > 0 && <span className="help-tab-dot" aria-hidden="true" />}
            </button>
          ))}
        </div>
        <div className="help-body" id="help-panel" role="tabpanel" aria-labelledby={`help-tab-${tab}`}>
          {tab === 'tours' && (
            <ToursTab
              onLaunch={(tour, chapter, step) => {
                onClose();
                launchTour(tour, chapter, step);
              }}
            />
          )}
          {tab === 'topics' && <Topics tr={tr} section={section} visible={visible} fresh={fresh} isNew={isNew} actions={actions} onShowMe={practiceDoc ? undefined : onShowMe} />}
          {tab === 'keys' && <Keys tr={tr} phone={phone} intro={visible.filter((e) => e.section === 'keys')} />}
        </div>
        {!phone && <div className="help-resize" aria-hidden="true" onPointerDown={size.start} />}
      </div>
    </div>
  );
}

// --- El tamaño de la ventana -------------------------------------------------------------------------------

const SIZE_KEY = 'shotdocs-help-size';
const MIN = { width: 520, height: 380 };

/** Entre el mínimo y lo que deja la ventana (arriba queda el aire del fondo: `help-backdrop`). */
function clampSize(s: { width: number; height: number }): { width: number; height: number } {
  const maxW = Math.max(MIN.width, window.innerWidth - 32);
  const maxH = Math.max(MIN.height, window.innerHeight * 0.92 - 16);
  return { width: Math.round(Math.min(Math.max(s.width, MIN.width), maxW)), height: Math.round(Math.min(Math.max(s.height, MIN.height), maxH)) };
}

/**
 * El tamaño de la ayuda: el guardado en el dispositivo (o 760 × 640), dentro de la ventana. La esquina de abajo a la
 * derecha lo cambia: el ancho crece a los dos lados (la ventana va centrada), así la esquina sigue al puntero.
 */
function useHelpSize(phone: boolean) {
  const [size, setSize] = useState(() => {
    let saved: { width?: unknown; height?: unknown } | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(SIZE_KEY) ?? 'null');
    } catch {
      // Sin almacenamiento, el de fábrica.
    }
    const ok = saved && typeof saved.width === 'number' && typeof saved.height === 'number';
    return clampSize(ok ? (saved as { width: number; height: number }) : { width: 760, height: Math.min(640, window.innerHeight * 0.84) });
  });
  useEffect(() => {
    if (phone) return;
    const fit = () => setSize((s) => clampSize(s));
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [phone]);
  const start = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const from = size;
    let last = from;
    const target = e.currentTarget;
    target.setPointerCapture?.(e.pointerId);
    const move = (ev: PointerEvent) => {
      last = clampSize({ width: from.width + 2 * (ev.clientX - x0), height: from.height + (ev.clientY - y0) });
      setSize(last);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      try {
        localStorage.setItem(SIZE_KEY, JSON.stringify(last));
      } catch {
        // Sin almacenamiento, el tamaño dura lo que la ayuda abierta.
      }
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };
  return { ...size, start };
}

// --- Topics ------------------------------------------------------------------------------------------------

function Topics({
  tr,
  section,
  visible,
  fresh,
  isNew,
  actions,
  onShowMe,
}: {
  tr: Translate;
  section: string | null;
  visible: HelpEntry[];
  fresh: HelpEntry[];
  isNew: (e: HelpEntry) => boolean;
  actions: Partial<Record<NonNullable<HelpEntry['action']>, (() => void) | undefined>>;
  onShowMe?: (step: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const content = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const scroll = useThinScroll();
  const unavailable = useUnavailable();
  const hits = useMemo(() => searchHelp(HELP_ENTRIES, query, tr.lang), [query, tr.lang]);
  const sections = HELP_SECTIONS.filter((s) => s.id !== 'keys' && visible.some((e) => e.section === s.id));

  useLayoutEffect(() => {
    if (!coarse()) search.current?.focus({ preventScroll: true });
  }, []);

  // Abre en la sección pedida (desplegada).
  useEffect(() => {
    if (!section) return;
    setOpen(new Set(visible.filter((e) => e.section === section).map((e) => e.id)));
    requestAnimationFrame(() => {
      const root = content.current;
      const target = root?.querySelector<HTMLElement>(`[data-help-section="${section}"]`);
      if (root && target) root.scrollTo({ top: target.offsetTop - root.offsetTop });
    });
  }, [section]);

  const toggle = (id: string) =>
    setOpen((old) => {
      const next = new Set(old);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const renderEntry = (entry: HelpEntry, { withSection = false, key = entry.id, expanded = false } = {}) => (
    <HelpEntryView
      key={key}
      entry={entry}
      tr={tr}
      expanded={expanded || open.has(key)}
      onToggle={expanded ? undefined : () => toggle(key)}
      reason={entry.when ? unavailable(entry.when) : null}
      sectionLabel={withSection ? tr(HELP_SECTIONS.find((s) => s.id === entry.section)!.title) : null}
      onAction={entry.action ? actions[entry.action] : undefined}
      onShowMe={entry.showMe && onShowMe ? () => onShowMe(entry.showMe!) : undefined}
      fresh={isNew(entry)}
    />
  );

  return (
    <div className="help-topics">
      <label className="help-search">
        <SearchIcon size={16} />
        <input ref={search} type="search" value={query} placeholder={tr('help.search')} aria-label={tr('help.search')} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div ref={content} className="help-content help-scroll" {...scroll}>
        {query ? (
          hits.length > 0 ? (
            <div className="help-results" aria-live="polite">
              {hits.map((h) => renderEntry(h.entry, { withSection: true, expanded: true }))}
            </div>
          ) : (
            <p className="muted help-empty" aria-live="polite">
              {tr('help.noResults')}
            </p>
          )
        ) : (
          <>
            {fresh.length > 0 && (
              <section className="help-section help-news" data-help-section="news" aria-labelledby="help-sec-news">
                <h3 id="help-sec-news">{tr('help.section.news')}</h3>
                <p className="muted help-news-intro">{tr('help.newsIntro')}</p>
                {fresh.map((e) => renderEntry(e, { withSection: true, key: `news-${e.id}`, expanded: true }))}
              </section>
            )}
            {sections.map((s) => (
              <section key={s.id} className="help-section" data-help-section={s.id} aria-labelledby={`help-sec-${s.id}`}>
                <h3 id={`help-sec-${s.id}`}>{tr(s.title)}</h3>
                {visible.filter((e) => e.section === s.id).map((e) => renderEntry(e))}
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/** Para quién no es una función (`when`): el motivo, o `null` si la persona la puede usar. */
function useUnavailable(): (when: HelpWhen) => string | null {
  const { media, user } = useServices();
  const status = useSyncStatus();
  const { installed } = useInstallState();
  const perms = usePermissions();
  const tr = useT();
  return (when) => {
    if (when === 'portero') return media.enabled ? null : tr('help.when.portero');
    if (when === 'admin') return perms.canManageMembers ? null : tr('help.when.admin');
    if (when === 'notInstalled') return installed ? tr('help.installed') : null;
    return status.ownerId && status.ownerId === user.id ? null : tr('help.when.owner');
  };
}

function HelpEntryView({
  entry,
  tr,
  expanded,
  onToggle,
  reason,
  sectionLabel,
  onAction,
  onShowMe,
  fresh,
}: {
  entry: HelpEntry;
  tr: Translate;
  expanded: boolean;
  /** Sin esto, la entrada va siempre desplegada (un resultado de la búsqueda, una novedad). */
  onToggle?: () => void;
  reason: string | null;
  sectionLabel: string | null;
  onAction?: () => void;
  onShowMe?: () => void;
  /** Novedad desde la última vez que la persona abrió la ayuda. */
  fresh: boolean;
}) {
  const params: Record<string, ReactNode> = {};
  for (const [name, id] of Object.entries(entry.keys ?? {})) params[name] = <kbd>{shortcutLabel(id, IS_MAC, tr.lang)}</kbd>;
  const action = onAction && !reason;
  const showMe = onShowMe && !reason;
  const title = (
    <>
      {tr(entry.title)}
      {fresh && <span className="help-new">{tr('help.new')}</span>}
    </>
  );
  return (
    <article className={`help-entry${reason ? ' off' : ''}${fresh ? ' fresh' : ''}${expanded ? ' open' : ''}`} data-help-id={entry.id}>
      {sectionLabel && <span className="mono-label help-entry-section">{sectionLabel}</span>}
      {onToggle ? (
        <h4>
          <button className="help-entry-toggle" aria-expanded={expanded} onClick={onToggle}>
            <span className="help-chevron">
              <ChevronRightIcon size={14} />
            </span>
            <span>{title}</span>
          </button>
        </h4>
      ) : (
        <h4>{title}</h4>
      )}
      {expanded && (
        <div className="help-entry-body">
          <p>{tr.rich(entry.textTouch && coarse() ? entry.textTouch : entry.text, params)}</p>
          {reason && <p className="help-reason">{entry.when === 'notInstalled' ? reason : tr('help.unavailable', { reason })}</p>}
          {(action || showMe) && (
            <div className="help-buttons">
              {action && (
                <button className="secondary help-action" onClick={onAction}>
                  {entry.action === 'tour' ? tr('help.tour.action') : entry.action === 'install' ? tr('help.install.action') : tr('help.practice.action')}
                </button>
              )}
              {showMe && (
                <button className="secondary help-show-me" onClick={onShowMe}>
                  {tr('help.showMe.action')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

// --- Shortcuts ---------------------------------------------------------------------------------------------

/** La tabla de todos los atajos, por lugar, con los rótulos de esta plataforma. */
function Keys({ tr, phone, intro }: { tr: Translate; phone: boolean; intro: HelpEntry[] }) {
  const scroll = useThinScroll();
  return (
    <div className="help-content help-scroll" data-help-section="keys" {...scroll}>
      {intro.map((e) => (
        <HelpEntryView key={e.id} entry={e} tr={tr} expanded reason={null} sectionLabel={null} fresh={false} />
      ))}
      <div className="help-keys">
        {phone && <p className="muted">{tr('help.keysPhone')}</p>}
        {SHORTCUT_PLACES.map((place) => {
          const rows = SHORTCUTS.filter((s) => s.place === place);
          if (rows.length === 0) return null;
          return (
            <div key={place} className="help-keys-group">
              <h4>{tr(PLACE_TEXTS[place])}</h4>
              <table>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id} data-shortcut={s.id}>
                      <td className="help-keys-label">
                        {s.source === 'typed' ? (
                          s.keys.map((k) => <code key={k}>{k.trim()}</code>)
                        ) : (
                          <kbd>{shortcutLabel(s.id, IS_MAC, tr.lang)}</kbd>
                        )}
                      </td>
                      <td>{tr(SHORTCUT_TEXTS[s.id])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
