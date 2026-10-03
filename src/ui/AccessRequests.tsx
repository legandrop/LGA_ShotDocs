import { useEffect, useRef, useState } from 'react';
import { locale, useT } from '../i18n';
import { useAccessRequests, useServices, useSyncStatus } from '../services';
import { GRANT_LEVELS, LEVEL_LABELS, ROLE_LABELS, type GrantLevel } from '../sync/access';
import type { AccessRequest } from '../sync/accessRequests';
import { ShareGateNotes, useShareGate } from './shareGate';
import { teamErrorText } from './teamText';

// Los pedidos de acceso a un archivo (P.30, entrega 2; Docs/Doc_Links_PDF.md, 5.3): la fila de cada pedido (en la campana
// y en *Share* de la página) y lo que se decide. Dar acceso es un permiso de los de siempre sobre una página que usa el
// archivo (la primera donde se agregó, por defecto), *View* por defecto, con el mismo paso previo que *Share* para quien
// no ve lo borrado (useShareGate). Rechazar es un botón aparte (LF20). Decidir pide red.

/** "5 min ago", "hace 3 h", "Sep 30" (con el formato del idioma). */
export function agoText(iso: string, lang: Parameters<typeof locale>[0], now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Math.max(0, now - t);
  const rtf = new Intl.RelativeTimeFormat(locale(lang), { numeric: 'auto', style: 'short' });
  if (diff < 60_000) return rtf.format(0, 'minute');
  if (diff < 3_600_000) return rtf.format(-Math.floor(diff / 60_000), 'minute');
  if (diff < 86_400_000) return rtf.format(-Math.floor(diff / 3_600_000), 'hour');
  return new Intl.DateTimeFormat(locale(lang), { month: 'short', day: 'numeric' }).format(t);
}

/** Una fila: quién pide qué, su rol, cuándo y cuántas veces, y *Review*. */
export function AccessRequestRow({ request, onReview }: { request: AccessRequest; onReview: () => void }) {
  const tr = useT();
  return (
    <li className="access-request">
      <span className="access-request-text">
        <span>{tr('requests.asks', { email: request.email, file: request.fileName || tr('common.untitled') })}</span>
        <span className="muted small">
          {tr(ROLE_LABELS[request.role])} · {agoText(request.askedAt, tr.lang)}
          {request.times > 1 ? ` · ${tr('requests.times', { count: request.times })}` : ''}
        </span>
      </span>
      <button type="button" className="link" onClick={onReview}>
        {tr('requests.review')}
      </button>
    </li>
  );
}

/**
 * Decidir un pedido. `pageId`: la página donde se abrió (*Share*), elegida si el archivo está ahí. `onDone`: decidido
 * (o ya no estaba); `onCancel`: sin decidir.
 */
export function AccessRequestForm({
  request,
  pageId,
  onDone,
  onCancel,
}: {
  request: AccessRequest;
  pageId?: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const tr = useT();
  const { accessRequests } = useServices();
  const status = useSyncStatus();
  const gate = useShareGate();
  const first = request.pages.some((p) => p.pageId === pageId) ? pageId! : request.pages[0].pageId;
  const [page, setPage] = useState(first);
  const [level, setLevel] = useState<GrantLevel>('view');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const give = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    give.current?.focus({ preventScroll: true });
  }, []);

  /** Quien recibe Ver o Comentar, o es invitado, no ve lo borrado: lo pendiente de la página sube antes. */
  const reader = level === 'view' || level === 'comment' || request.role === 'guest';

  async function decide(accept: boolean, anyway = false) {
    if (!accessRequests || busy) return;
    setBusy(true);
    setError(null);
    if (anyway) gate.clearBlocked();
    const scope = { pageId: page };
    try {
      if (accept && !anyway && !(await gate.ready(scope, reader, () => void decide(true), () => void decide(true, true)))) return;
      await accessRequests.decide(request.id, accept, accept ? page : null, level);
      if (accept) gate.after(scope, reader, request.email);
      onDone();
    } catch (err) {
      // Ya decidido por otro o sin red: queda la ventana con el motivo (la lista ya lo sacó si no estaba).
      setError(teamErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  const offline = !status.online;
  return (
    <div className="access-request-form" role="group" aria-label={tr('requests.title')}>
      <p>
        <strong>{tr('requests.asks', { email: request.email, file: request.fileName || tr('common.untitled') })}</strong>
      </p>
      <p className="muted small">
        {tr(ROLE_LABELS[request.role])} · {agoText(request.askedAt, tr.lang)}
      </p>
      <div className="access-request-fields">
        {request.pages.length > 1 ? (
          <label>
            <span className="pref-label">{tr('requests.page')}</span>
            <select value={page} disabled={busy} onChange={(e) => setPage(e.target.value)}>
              {request.pages.map((p) => (
                <option key={p.pageId} value={p.pageId}>
                  {p.title || tr('common.untitled')}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="small">
            <span className="pref-label">{tr('requests.page')}</span> {request.pages[0].title || tr('common.untitled')}
          </p>
        )}
        <label>
          <span className="pref-label">{tr('requests.level')}</span>
          <select value={level} disabled={busy} onChange={(e) => setLevel(e.target.value as GrantLevel)}>
            {GRANT_LEVELS.map((l) => (
              <option key={l} value={l}>
                {tr(LEVEL_LABELS[l])}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted small">{tr('requests.scope')}</p>
      <ShareGateNotes gate={gate} reader={reader} />
      {offline && <p className="muted small">{tr('requests.offline')}</p>}
      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        <button type="button" disabled={busy} onClick={onCancel}>
          {tr('common.cancel')}
        </button>
        <button type="button" className="danger" disabled={busy || offline} onClick={() => void decide(false)}>
          {tr('requests.decline')}
        </button>
        <button ref={give} type="button" className="primary" disabled={busy || offline} onClick={() => void decide(true)}>
          {tr('requests.give')}
        </button>
      </div>
    </div>
  );
}

/**
 * En *Share* de una página: los pedidos de archivos de esa página que la persona puede decidir, arriba (LF12). *Review*
 * abre la decisión ahí mismo, con esta página elegida. `onDecided`: para volver a leer quién tiene acceso.
 */
export function ShareRequests({ pageId, onDecided }: { pageId: string; onDecided: () => void }) {
  const tr = useT();
  const { accessRequests } = useServices();
  const requests = useAccessRequests();
  const [reviewing, setReviewing] = useState<AccessRequest | null>(null);
  useEffect(() => {
    void accessRequests?.poll();
  }, [accessRequests]);
  const here = requests.ready ? requests.items.filter((r) => r.pages.some((p) => p.pageId === pageId)) : [];
  if (!reviewing && here.length === 0) return null;
  return (
    <section className="share-requests" aria-label={tr('requests.onPage')}>
      {reviewing ? (
        <AccessRequestForm
          request={reviewing}
          pageId={pageId}
          onDone={() => {
            setReviewing(null);
            onDecided();
          }}
          onCancel={() => setReviewing(null)}
        />
      ) : (
        <>
          <span className="pref-label">{tr('requests.onPage')}</span>
          <ul className="access-requests">
            {here.map((r) => (
              <AccessRequestRow key={r.id} request={r} onReview={() => setReviewing(r)} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** La ventana de decidir, desde la campana. Esc o tocar afuera cierran sin decidir. */
export function AccessRequestDialog({ request, onClose }: { request: AccessRequest; onClose: () => void }) {
  const tr = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal team-dialog" role="dialog" aria-label={tr('requests.title')} onClick={(e) => e.stopPropagation()}>
        <h2>{tr('requests.title')}</h2>
        <AccessRequestForm request={request} onDone={onClose} onCancel={onClose} />
      </div>
    </div>
  );
}
