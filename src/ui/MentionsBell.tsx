import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { locale, useT } from '../i18n';
import { useLinkMode } from '../linkMode';
import { navigate, pagePath } from '../router';
import { useAccessRequests, useServices, useSyncStatus, useTree } from '../services';
import type { AccessRequest } from '../sync/accessRequests';
import { labelForEmail } from '../sync/comments';
import type { InboxSnapshot, MentionItem } from '../sync/mentions';
import { AccessRequestRow } from './AccessRequestRow';
import { lazyPart, Part } from './lazyPart';
import { showComments } from './commentsUi';
import { useFloating } from './menus';
import { mentionSegments, plainCoda } from './mentionText';
import { useCurrentProject } from './project';
import { setAppBadge, setTitleCount } from './titleBadge';

// La campana de las menciones (P.21, Docs/Doc_Menciones.md, 2.3): en la barra de arriba, a la derecha, con el número
// de menciones sin leer (1 a 9, y 9+). Al tocarla, la lista de la más nueva a la más vieja; abrir una lleva a la
// página con el hilo abierto y la marca leída. Sin red, lo guardado. No está con un link público ni con la base del
// workspace sin migrar.
//
// Los pedidos de acceso a un archivo (P.30, entrega 2, Docs/Doc_Links_PDF.md, 5.3): para quien puede decidirlos, una
// sección arriba de las menciones y su número sumado al de la campana. *Review* abre la ventana de decidir.

const EMPTY: InboxSnapshot = { ready: false, items: [], unread: 0, checkedAt: null, loaded: false };
const noSubscribe = () => () => undefined;
const emptySnapshot = () => EMPTY;

/** Lo de la campana; se vuelve a dibujar con cada cambio. Sin campana (link público, pruebas), vacío. */
export function useInbox(): InboxSnapshot {
  const { mentions } = useServices();
  return useSyncExternalStore(mentions?.subscribe ?? noSubscribe, mentions?.getSnapshot ?? emptySnapshot);
}

export function MentionsBell() {
  const { mentions } = useServices();
  const link = useLinkMode();
  const inbox = useInbox();
  const requests = useAccessRequests();
  const [open, setOpen] = useState(false);
  const [reviewing, setReviewing] = useState<AccessRequest | null>(null);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const tr = useT();
  const pending = requests.ready ? requests.items.length : 0;
  // El número también en el título de la pestaña y en el ícono de la app instalada (entrega 2).
  const shown = mentions && !link && inbox.ready ? inbox.unread + pending : 0;
  useEffect(() => {
    setTitleCount(shown);
    setAppBadge(shown);
  }, [shown]);
  useEffect(
    () => () => {
      // Al salir del workspace (o de la cuenta), sin número.
      setTitleCount(0);
      setAppBadge(0);
    },
    [],
  );
  if (!mentions || link || !inbox.ready) return null;
  const total = inbox.unread + pending;
  const count = total >= 10 ? '9+' : String(total);
  const parts = [tr('mentions.title')];
  if (inbox.unread > 0) parts.push(inbox.unread >= 10 ? tr('mentions.unreadMany') : tr('mentions.unread', { count: inbox.unread }));
  if (pending > 0) parts.push(tr('requests.count', { count: pending }));
  const label = parts.join(' · ');
  return (
    <>
      <button
        ref={setAnchor}
        className={`icon-button mentions-bell${total > 0 ? ' has-count' : ''}`}
        aria-label={label}
        data-tip={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
      >
        <BellIcon />
        {total > 0 && <span className="comments-toggle-count mentions-count">{count}</span>}
      </button>
      {/* Afuera de la barra de arriba: `.topbar` arma su propio apilado y el panel de comentarios lo taparía. */}
      {open &&
        createPortal(
          <MentionsPanel
            anchor={anchor}
            onClose={() => setOpen(false)}
            onReview={(r) => {
              setOpen(false);
              setReviewing(r);
            }}
          />,
          document.body,
        )}
      {reviewing &&
        createPortal(
          <Part onClose={() => setReviewing(null)}>
            <AccessRequestDialog request={reviewing} onClose={() => setReviewing(null)} />
          </Part>,
          document.body,
        )}
    </>
  );
}

// La ventana de decidir se baja la primera vez que se abre (lleva lo de compartir).
const AccessRequestDialog = lazyPart(() => import('./AccessRequests').then((m) => m.AccessRequestDialog));

function BellIcon({ size = 19 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5.25 13.75V9a4.75 4.75 0 0 1 9.5 0v4.75l1.25 1.5H4z" />
      <path d="M8.25 16.75a1.9 1.9 0 0 0 3.5 0" />
    </svg>
  );
}

function MentionsPanel({ anchor, onClose, onReview }: { anchor: HTMLElement | null; onClose: () => void; onReview: (r: AccessRequest) => void }) {
  const { mentions, user, comments, accessRequests } = useServices();
  const inbox = useInbox();
  const requests = useAccessRequests();
  const status = useSyncStatus();
  const tree = useTree();
  const project = useCurrentProject();
  const ref = useRef<HTMLDivElement>(null);
  const tr = useT();
  useFloating(ref, onClose, anchor, true, false);
  // Abrir la campana: lo cambiado y el índice liviano (sin volver a bajar los textos).
  useEffect(() => {
    void mentions?.open();
    void accessRequests?.poll();
  }, [mentions, accessRequests]);

  const r = anchor?.getBoundingClientRect();
  const style = r ? { top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) } : undefined;
  const time = inbox.checkedAt ? new Intl.DateTimeFormat(locale(tr.lang), { hour: 'numeric', minute: '2-digit' }).format(inbox.checkedAt) : null;

  const go = (item: MentionItem) => {
    onClose();
    void mentions?.markRead([item.id]);
    navigate(pagePath(item.pageId));
    // Si la página ya estaba abierta, sus comentarios se bajan cada ~10 s: se piden ya, así el hilo nuevo está.
    void comments.refresh(item.pageId);
    showComments({ kind: 'thread', threadId: item.threadId ?? item.commentId, resolved: item.resolved }, item.pageId);
  };

  return (
    <div ref={ref} className="mentions-panel" role="dialog" aria-label={tr('mentions.title')} style={style}>
      <header className="mentions-head">
        <h2>{tr('mentions.title')}</h2>
        {inbox.items.some((m) => !m.read) && (
          <button className="link" onClick={() => void mentions?.markAllRead()}>
            {tr('mentions.markAll')}
          </button>
        )}
      </header>
      {!status.online && <p className="comments-note">{time ? tr('mentions.offline', { time }) : tr('mentions.offlineNever')}</p>}
      {requests.ready && requests.items.length > 0 && (
        <section aria-label={tr('requests.title')}>
          <h3 className="access-requests-head">{tr('requests.title')}</h3>
          <ul className="access-requests">
            {requests.items.map((r) => (
              <AccessRequestRow key={r.id} request={r} onReview={() => onReview(r)} />
            ))}
          </ul>
        </section>
      )}
      {inbox.items.length === 0 ? (
        <p className="muted mentions-empty">{tr('mentions.empty')}</p>
      ) : (
        <ul className="mentions-list">
          {inbox.items.map((item) => {
            const who = item.mentionedByEmail ? labelForEmail(item.mentionedByEmail) : tr('mentions.someone');
            const other = item.projectId && item.projectId !== project ? tree.project(item.projectId)?.name : undefined;
            const page = tree.get(item.pageId);
            const title = (page?.title ?? item.pageTitle) || tr('common.untitled');
            return (
              <li key={item.id}>
                <button className={`mention-item${item.read ? '' : ' unread'}`} onClick={() => go(item)}>
                  <span className="mention-item-head">
                    <strong data-tip={item.mentionedByEmail ?? undefined} data-tip-plain>
                      {who}
                    </strong>
                    <span className="mention-item-page">{title}</span>
                    {other && <span className="muted">{other}</span>}
                    {!item.read && <span className="mention-dot" aria-label={tr('mentions.unreadDot')} />}
                  </span>
                  <span className="mention-item-text">
                    {mentionSegments(plainCoda(item.snippet), [{ userId: user.id, label: item.label }]).map((seg, i) =>
                      'mention' in seg ? (
                        <span key={i} className="mention me">
                          {seg.text}
                        </span>
                      ) : (
                        seg.text
                      ),
                    )}
                  </span>
                  <span className="mention-item-meta muted">
                    {ago(item.createdAt, tr.lang)}
                    {item.resolved && ` · ${tr('mentions.resolved')}`}
                    {tree.isTrashed(item.pageId) && ` · ${tr('mentions.inTrash')}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** "5 min ago", "hace 3 h", "Sep 30" (con el formato del idioma). */
function ago(iso: string, lang: Parameters<typeof locale>[0]): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Math.max(0, Date.now() - t);
  const rtf = new Intl.RelativeTimeFormat(locale(lang), { numeric: 'auto', style: 'short' });
  if (diff < 60_000) return rtf.format(0, 'minute');
  if (diff < 3_600_000) return rtf.format(-Math.floor(diff / 60_000), 'minute');
  if (diff < 86_400_000) return rtf.format(-Math.floor(diff / 3_600_000), 'hour');
  return new Intl.DateTimeFormat(locale(lang), { month: 'short', day: 'numeric' }).format(t);
}
