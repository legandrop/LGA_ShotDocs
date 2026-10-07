import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { usePermissions, useServices, useSyncStatus, useTree } from '../services';
import { LEVEL_EDIT } from '../sync/access';
import { canAdmit, LINK_EDIT_SCHEMA_VERSION, type LinkUpdateRow } from '../sync/linkAdmitApi';
import { asideReasonText, downloadLinkChanges } from './linkAside';

// En la página, para quien la edita y ve lo borrado (Docs/Doc_Link_Publico.md, E2.8): si algo que mandó un link
// público no pudo entrar (quedó apartado por la prueba de admisión o porque el link se revocó), un aviso con el motivo y
// *Download it* (la fila tal cual, para no perder nada). Lo retenido (el link dejó de editar esta página por algo que
// puede volver) se cuenta en una línea. Se pide al abrir la página y después de cada sincronización, como mucho una
// vez por minuto (`linkUpdatesOf`): todo, por clave, con `public_link_updates_page`; con una base anterior a esa función,
// las primeras 500 filas, con `public_link_updates_of`.

const EVERY_MS = 60_000;

export function LinkAsideNotice({ pageId }: { pageId: string }) {
  const tr = useT();
  const { remote } = useServices();
  const status = useSyncStatus();
  const perms = usePermissions();
  const tree = useTree();
  const [rows, setRows] = useState<LinkUpdateRow[]>([]);
  const askedAt = useRef(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const sees = perms.pageLevel(pageId) >= LEVEL_EDIT && perms.role !== 'guest';
  const supported = (status.schemaVersion ?? 0) >= LINK_EDIT_SCHEMA_VERSION && canAdmit(remote);

  // La página que se muestra ahora (una respuesta de otra página que llega tarde no se usa).
  const shown = useRef(pageId);
  useEffect(() => {
    shown.current = pageId;
    setRows([]);
    askedAt.current = 0;
    return () => {
      shown.current = '';
    };
  }, [pageId]);

  useEffect(() => {
    if (!sees || !supported || !canAdmit(remote) || !status.online) return;
    if (askedAt.current > 0 && Date.now() - askedAt.current < EVERY_MS) return;
    askedAt.current = Date.now();
    remote.linkUpdatesOf(pageId).then(
      (list) => shown.current === pageId && setRows(list),
      () => undefined,
    );
    // `lastSyncAt`: después de cada sincronización (con el tope de una vez por minuto).
  }, [pageId, sees, supported, remote, status.online, status.lastSyncAt]);

  const aside = rows.filter((r) => r.state === 'aside');
  const held = rows.filter((r) => r.state === 'held');
  if (!sees || (aside.length === 0 && held.length === 0)) return null;
  const reasons = [...new Set(aside.map((r) => asideReasonText(tr, r.reason)))].join('; ');

  const download = async () => {
    if (!canAdmit(remote)) return;
    await downloadLinkChanges(remote, [...aside, ...held], { pageId, title: tree.get(pageId)?.title ?? null });
  };

  return (
    <div className="banner link-aside-notice" role="status">
      {aside.length > 0 && (
        <p>
          <strong>{tr('link.aside.title', { count: aside.length })}</strong> {tr('link.aside.detail', { reason: reasons })}{' '}
          <button
            className="link"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setFailed(false);
              void download()
                .catch(() => setFailed(true))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? tr('common.preparing') : tr('link.aside.download')}
          </button>
        </p>
      )}
      {held.length > 0 && <p className="muted small">{tr('link.aside.held', { count: held.length })}</p>}
      {failed && <p className="error">{tr('sync.downloadFailed')}</p>}
    </div>
  );
}
