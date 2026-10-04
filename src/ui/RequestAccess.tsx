import { useState } from 'react';
import { locale, useT } from '../i18n';
import type { SupabaseClient } from '@supabase/supabase-js';
import { askedAt, askedScope, rememberAsked, requestAccess, requestPageAccess, type AccessTarget } from '../sync/accessRequests';
import { errorMessage, isNetworkError } from '../sync/types';
import { useWorkspaceList } from '../workspaces';

// *Request access* (P.30; Docs/Doc_Links_PDF.md, 5.2): en la pantalla sin acceso de un archivo (`/f/`, entrega 2) y de una
// página (`/p/<id>`, entrega 3). Antes de mandar dice quién va a ver el pedido (LF19). La respuesta de la base es la misma
// exista o no lo pedido, así que la pantalla nunca dice nada de él; el dispositivo anota cuándo se pidió (la base no deja
// listar los pedidos propios).

export function RequestAccess({
  client,
  userId,
  localKey,
  target,
  onHasAccess,
}: {
  /** El cliente del workspace con la sesión de quien pide (con o sin la sincronización abierta: O2, sin proyectos). */
  client: SupabaseClient;
  userId: string;
  localKey: string;
  target: AccessTarget;
  /** La base dice que ya lo ve: la pantalla vuelve a preguntar (el archivo) o sincroniza el árbol (la página). */
  onHasAccess: () => void;
}) {
  const tr = useT();
  const scope = askedScope(localKey, userId);
  const [asked, setAsked] = useState(() => askedAt(scope, target));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const page = target.kind === 'page';

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const res = page ? await requestPageAccess(client, target.id) : await requestAccess(client, target.id);
      if (res === 'has_access') return onHasAccess();
      rememberAsked(scope, target);
      setAsked(askedAt(scope, target) ?? new Date().toISOString());
      setSent(true);
      setConfirming(false);
    } catch (err) {
      setError(
        isNetworkError(err)
          ? tr('file.requestOffline')
          : errorMessage(err) === 'rate_limited'
            ? tr('file.requestLimited')
            : tr('file.requestFailed'),
      );
    } finally {
      setBusy(false);
    }
  }

  const day = asked ? new Intl.DateTimeFormat(locale(tr.lang), { month: 'short', day: 'numeric' }).format(Date.parse(asked)) : null;
  return (
    <div className="file-request">
      {sent ? (
        <p>{tr(page ? 'page.requestSent' : 'file.requestSent')}</p>
      ) : day ? (
        <p className="muted">{tr('file.requestedOn', { date: day })}</p>
      ) : null}
      {!sent && !day && <p className="muted">{tr(page ? 'page.requestHint' : 'file.requestHint')}</p>}
      {confirming ? (
        <>
          <p className="muted small">{tr(page ? 'page.requestNote' : 'file.requestNote')}</p>
          <div className="file-request-actions">
            <button className="primary" disabled={busy} onClick={() => void send()}>
              {tr('file.request')}
            </button>
            <button disabled={busy} onClick={() => setConfirming(false)}>
              {tr('common.cancel')}
            </button>
          </div>
        </>
      ) : (
        !sent && (
          <button className="primary" onClick={() => setConfirming(true)}>
            {day ? tr('file.requestAgain') : tr('file.request')}
          </button>
        )
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/**
 * Si se sabe de qué workspace es una dirección de página (`/p/<id>`, sección 19 de Doc_Links_PDF.md, O1): la dirección
 * no lo dice, así que solo se sabe con un solo workspace en el dispositivo. Con más de uno, *Request access* de una página
 * no se ofrece (el pedido iría a la base del que está abierto). La dirección de un archivo (`/f/<clave local>/<id>`) sí
 * lo dice y no pasa por acá.
 */
export function usePageWorkspaceKnown(): boolean {
  return useWorkspaceList().workspaces.length <= 1;
}
