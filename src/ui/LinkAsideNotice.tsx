import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { toBase64 } from '../lib/base64';
import { usePermissions, useServices, useSyncStatus, useTree } from '../services';
import { LEVEL_EDIT } from '../sync/access';
import { insertedText } from '../sync/admit';
import { canAdmit, LINK_EDIT_SCHEMA_VERSION, type LinkUpdateRow } from '../sync/linkAdmitApi';
import { saveBlob } from './unsyncedDownload';

// En la página, para quien la edita y ve lo borrado (Docs/Doc_Link_Publico.md, E2.8): si algo que mandó un link
// público no pudo entrar (quedó apartado por la prueba de admisión o porque el link se revocó), un aviso con el motivo y
// *Download it* (la fila tal cual, para no perder nada). Lo retenido (el link dejó de editar esta página por algo que
// puede volver) se cuenta en una línea. Lo pide `public_link_updates_of` al abrir la página y después de cada
// sincronización, como mucho una vez por minuto.

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
  const reasons = [...new Set(aside.map((r) => r.reason ?? 'unspecified'))].join(', ');

  const download = async () => {
    if (!canAdmit(remote)) return;
    const out: unknown[] = [];
    for (const r of [...aside, ...held]) {
      const bytes = await remote.linkUpdateBytes(r.id);
      // El texto que trae, para leerlo sin la app (O8), y los bytes tal cual.
      out.push({ id: r.id, author: r.author, createdAt: r.created_at, state: r.state, reason: r.reason, text: insertedText(bytes), yjsUpdate: toBase64(bytes) });
    }
    const blob = new Blob(
      [
        JSON.stringify({
          kind: 'lga-shotdocs-link-changes',
          formatVersion: 1,
          exportedAt: new Date().toISOString(),
          appVersion: __APP_VERSION__,
          pageId,
          title: tree.get(pageId)?.title ?? null,
          changes: out,
        }),
      ],
      { type: 'application/json' },
    );
    saveBlob(blob, `shotdocs-link-changes-${new Date().toISOString().slice(0, 10)}.json`);
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
