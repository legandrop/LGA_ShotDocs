import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useT, type Translate } from '../i18n';
import '../i18n/lazy/help';
import { usePermissions, useServices, useSyncStatus } from '../services';
import { isPhoneLayout } from '../ui/commentsUi';
import { openInstallDialog, useInstallState } from '../ui/install';
import { CloseIcon, SearchIcon } from '../ui/icons';
import { IS_MAC, shortcutLabel, SHORTCUT_PLACES, SHORTCUTS } from '../ui/shortcuts';
import { HELP_ENTRIES, HELP_SECTIONS, type HelpEntry, type HelpWhen } from './entries';
import { isNewer, latestOf, markHelpNewsSeen, versionValue } from './news';
import { searchHelp } from './search';
import { PLACE_TEXTS, SHORTCUT_TEXTS } from './shortcutTexts';

// La ayuda (Docs/Doc_Tutorial.md, sección 5): un diálogo grande con el índice a la izquierda (en el teléfono,
// pantalla completa con el índice arriba), una búsqueda y las secciones. Se baja aparte (lazyDialogs). Los
// rótulos de los atajos salen del registro (shortcuts.ts) con la plataforma de este dispositivo.

export interface HelpDialogProps {
  /** La sección donde abre. */
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

const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export function HelpDialog({ section = null, onClose, onTour, onPractice, onShowMe, news = null }: HelpDialogProps) {
  const tr = useT();
  const [query, setQuery] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const unavailable = useUnavailable();
  const hits = useMemo(() => searchHelp(HELP_ENTRIES, query, tr.lang), [query, tr.lang]);
  const phone = isPhoneLayout();

  // El foco entra al diálogo: al campo de buscar (en un táctil no, que el teclado taparía la ayuda).
  useLayoutEffect(() => {
    if (coarse()) dialog.current?.focus({ preventScroll: true });
    else search.current?.focus({ preventScroll: true });
  }, []);

  // Al abrir, las novedades quedan vistas: el punto del "?" se va (la lista sigue mientras la ayuda está abierta).
  useEffect(() => {
    markHelpNewsSeen(latestOf(HELP_ENTRIES.map((e) => e.since)), __APP_VERSION__);
  }, []);

  // Abre en la sección pedida.
  useEffect(() => {
    if (section) goTo(section, false);
  }, [section]);

  function goTo(id: string, smooth = true) {
    const root = content.current;
    const target = root?.querySelector<HTMLElement>(`[data-help-section="${id}"]`);
    if (!root || !target) return;
    root.scrollTo({ top: target.offsetTop - root.offsetTop, behavior: smooth ? 'smooth' : 'auto' });
  }

  // Esc cierra; Tab queda adentro (es modal).
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

  const actions = {
    tour: onTour,
    practice: onPractice,
    install: () => {
      onClose();
      openInstallDialog();
    },
  };
  const isNew = (entry: HelpEntry) => news !== null && isNewer(entry.since, news);
  const renderEntry = (entry: HelpEntry, withSection = false, key = entry.id) => (
    <HelpEntryView
      key={key}
      entry={entry}
      tr={tr}
      reason={entry.when ? unavailable(entry.when) : null}
      sectionLabel={withSection ? tr(HELP_SECTIONS.find((s) => s.id === entry.section)!.title) : null}
      onAction={entry.action ? actions[entry.action] : undefined}
      onShowMe={entry.showMe && onShowMe ? () => onShowMe(entry.showMe!) : undefined}
      fresh={isNew(entry)}
    />
  );
  // Las entradas con botón solo si el botón existe (antes de la recorrida, no se ofrecen).
  const visible = HELP_ENTRIES.filter((e) => !e.action || actions[e.action]);
  const sections = HELP_SECTIONS.filter((s) => s.id === 'keys' || visible.some((e) => e.section === s.id));
  // Las novedades, arriba de todo: lo más nuevo primero (las de la misma versión, en el orden de la ayuda).
  const fresh = visible
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => isNew(e))
    .sort((a, b) => versionValue(b.e.since) - versionValue(a.e.since) || a.i - b.i)
    .map(({ e }) => e);

  return (
    <div className="modal-backdrop help-backdrop" onClick={onClose}>
      <div
        ref={dialog}
        className="help-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <header className="help-head">
          <h2 id="help-title">{tr('help.title')}</h2>
          <label className="help-search">
            <SearchIcon size={16} />
            <input
              ref={search}
              type="search"
              value={query}
              placeholder={tr('help.search')}
              aria-label={tr('help.search')}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <button className="icon-button help-close" aria-label={tr('common.close')} onClick={onClose}>
            <CloseIcon size={18} />
          </button>
        </header>
        <div className="help-body">
          {!query && (
            <nav className="help-index" aria-label={tr('help.index')}>
              {fresh.length > 0 && (
                <button className="help-index-news" onClick={() => goTo('news')}>
                  {tr('help.section.news')}
                </button>
              )}
              {sections.map((s) => (
                <button key={s.id} onClick={() => goTo(s.id)}>
                  {tr(s.title)}
                </button>
              ))}
            </nav>
          )}
          <div ref={content} className="help-content">
            {query ? (
              hits.length > 0 ? (
                <div className="help-results" aria-live="polite">
                  {hits.map((h) => renderEntry(h.entry, true))}
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
                    {fresh.map((e) => renderEntry(e, true, `news-${e.id}`))}
                  </section>
                )}
                {sections.map((s) => (
                  <section key={s.id} className="help-section" data-help-section={s.id} aria-labelledby={`help-sec-${s.id}`}>
                    <h3 id={`help-sec-${s.id}`}>{tr(s.title)}</h3>
                    {visible.filter((e) => e.section === s.id).map((e) => renderEntry(e))}
                    {s.id === 'keys' && <ShortcutTable tr={tr} phone={phone} />}
                  </section>
                ))}
              </>
            )}
          </div>
        </div>
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
  reason,
  sectionLabel,
  onAction,
  onShowMe,
  fresh,
}: {
  entry: HelpEntry;
  tr: Translate;
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
  return (
    <article className={`help-entry${reason ? ' off' : ''}${fresh ? ' fresh' : ''}`} data-help-id={entry.id}>
      {sectionLabel && <span className="mono-label help-entry-section">{sectionLabel}</span>}
      <h4>
        {tr(entry.title)}
        {fresh && <span className="help-new">{tr('help.new')}</span>}
      </h4>
      <p>{tr.rich(entry.text, params)}</p>
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
    </article>
  );
}

/** La tabla de todos los atajos, por lugar, con los rótulos de esta plataforma. */
function ShortcutTable({ tr, phone }: { tr: Translate; phone: boolean }) {
  return (
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
  );
}
