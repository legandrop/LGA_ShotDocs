import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { useServices, useTree } from '../services';
import { insertedText } from '../sync/admit';
import { canListAside, type LinkAsideRow } from '../sync/linkAdmitApi';
import { errorMessage } from '../sync/types';
import { asideReasonText, downloadLinkChanges } from './linkAside';

// En el historial de una página, una entrada *Set aside (via link)* elegida (Docs/Doc_Link_Publico.md, entrega 2c): lo
// que un visitante mandó con un link y no entró a la página. No es una versión: no se aplica ni se restaura. Se muestra
// el texto que trae (leído de los bytes, sin aplicarlos a nada), el motivo y *Download it*.
export function HistoryAside({ row }: { row: LinkAsideRow }) {
  const tr = useT();
  const { remote } = useServices();
  const tree = useTree();
  const [text, setText] = useState<{ id: string; value: string | null; error: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!canListAside(remote)) return;
    let live = true;
    remote.linkUpdateBytes(row.id).then(
      (bytes) => live && setText({ id: row.id, value: insertedText(bytes), error: null }),
      (err: unknown) => live && setText({ id: row.id, value: null, error: errorMessage(err) }),
    );
    return () => {
      live = false;
    };
  }, [remote, row.id]);
  const shown = text && text.id === row.id ? text : null;

  return (
    <div className="history-aside" role="region" aria-label={tr('history.aside')}>
      <p className="history-aside-who">{tr('history.asideTitle', { name: row.author })}</p>
      <p className="muted">{tr('history.asideText', { reason: asideReasonText(tr, row.reason) })}</p>
      {shown?.value !== undefined && shown?.value !== null && (
        <>
          <p className="muted small">{shown.value ? tr('history.asideTyped') : tr('history.asideEmpty')}</p>
          {shown.value && <blockquote className="history-aside-text">{shown.value}</blockquote>}
        </>
      )}
      {shown?.error && <p className="error">{shown.error}</p>}
      <button
        className="link"
        disabled={busy || !canListAside(remote)}
        onClick={() => {
          if (!canListAside(remote)) return;
          setBusy(true);
          setFailed(false);
          void downloadLinkChanges(remote, [row], { pageId: row.page_id, title: tree.get(row.page_id)?.title ?? null })
            .catch(() => setFailed(true))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? tr('common.preparing') : tr('link.aside.download')}
      </button>
      {failed && <p className="error">{tr('sync.downloadFailed')}</p>}
    </div>
  );
}
