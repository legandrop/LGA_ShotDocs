import { locale, useT, type Translate } from '../i18n';
import { ROLE_LABELS } from '../sync/access';
import type { AccessRequest } from '../sync/accessRequests';

// La fila de un pedido de acceso (P.30, entrega 2; Docs/Doc_Links_PDF.md, 5.3), en la campana y en *Share* de la página.
// Va con la campana, que está en la primera pantalla: lo de decidir (AccessRequests.tsx) se baja aparte.

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

/** «<correo> pide acceso a <archivo>» o, si pidió una página (entrega 3), «… a la página <título>». */
export function requestText(request: AccessRequest, tr: Translate): string {
  if (request.targetPageId) {
    return tr('requests.asksPage', { email: request.email, page: request.pages[0]?.title || tr('common.untitled') });
  }
  return tr('requests.asks', { email: request.email, file: request.fileName || tr('common.untitled') });
}

/** Una fila: quién pide qué, su rol, cuándo y cuántas veces, y *Review*. */
export function AccessRequestRow({ request, onReview }: { request: AccessRequest; onReview: () => void }) {
  const tr = useT();
  return (
    <li className="access-request">
      <span className="access-request-text">
        <span>{requestText(request, tr)}</span>
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
