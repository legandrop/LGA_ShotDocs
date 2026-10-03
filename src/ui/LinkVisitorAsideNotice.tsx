import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { useLinkMode } from '../linkMode';
import { useServices } from '../services';
import { LOCAL_CHANGED } from '../sync/docs';
import { LinkRemote } from '../sync/linkRemote';
import { startOverChannel, startOverFromTeam, TEAM_VERSION_NOT_READY } from '../sync/linkStartOver';
import { errorMessage, isNetworkError } from '../sync/types';
import { downloadLinkPages, useLinkEdits } from './LinkEditBar';
import { notify } from './notice';

// En la página, para quien escribe con un link *Can edit* (Docs/Doc_Link_Publico.md, entrega 2c): si algo suyo en esta
// página quedó apartado, lo que siga escribiendo acá tampoco llega (D235, "en cadena"). El aviso lo dice, baja lo suyo y
// ofrece volver a la página como la ve el equipo (después de bajar la copia; `startOverFromTeam`). También escucha a las
// otras pestañas del mismo link: si una volvió a la versión del equipo, la página se vuelve a armar acá.

/** Esta pestaña (sus propios avisos no se vuelven a aplicar acá). */
const TAB = crypto.randomUUID();

export function LinkVisitorAsideNotice({ pageId }: { pageId: string }) {
  const link = useLinkMode();
  const services = useServices();
  const remote = services.remote instanceof LinkRemote ? services.remote : null;
  const { docs, tree } = services;
  const tr = useT();
  const edits = useLinkEdits(remote);
  const [busy, setBusy] = useState<'download' | 'start' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const entryId = link?.entry.id ?? null;

  // Otra pestaña del mismo link volvió a la versión del equipo: la página se arma de nuevo desde lo guardado.
  useEffect(() => {
    if (!entryId || !remote) return;
    const channel = startOverChannel(entryId);
    if (!channel) return;
    channel.onmessage = (e: MessageEvent<{ pageId?: unknown; from?: unknown }>) => {
      const id = typeof e.data?.pageId === 'string' ? e.data.pageId : null;
      if (!id || e.data.from === TAB) return;
      docs.reloadFromSaved(id);
      remote.recheckAside();
    };
    return () => channel.close();
  }, [entryId, remote, docs]);

  useEffect(() => setError(null), [pageId]);

  // Algo tecleado mientras la página volvía a la versión del equipo pasó a lo de antes (O1 de la auditoría de la 2c): no
  // está en la página pero sí en la copia. Se dice hasta que el visitante cierra el aviso.
  const [late, setLate] = useState(0);
  useEffect(() => {
    if (!link) return;
    let live = true;
    const read = () => void docs.startedOverLate(pageId).then((n) => live && setLate(n), () => undefined);
    read();
    const off = docs.subscribeStartedOverLate((id) => id === pageId && read());
    return () => {
      live = false;
      off();
    };
  }, [link, docs, pageId]);

  if (!link || !remote) return null;

  const download = () => downloadLinkPages(link.entry, [pageId]);

  if (!edits.aside.includes(pageId)) {
    if (late === 0) return null;
    return (
      <div className="banner link-visitor-aside" role="status">
        <p>
          <strong>{tr('link.startOver.lateTitle')}</strong> {tr('link.startOver.lateText')}
        </p>
        <p className="link-visitor-aside-actions">
          <button
            className="link"
            disabled={busy !== null}
            onClick={() => {
              setBusy('download');
              setError(null);
              void download()
                .catch(() => setError(tr('sync.downloadFailed')))
                .finally(() => setBusy(null));
            }}
          >
            {busy === 'download' ? tr('common.preparing') : tr('link.edit.downloadThem')}
          </button>
          <button className="link" disabled={busy !== null} onClick={() => void docs.dismissStartedOverLate(pageId).then(() => setLate(0))}>
            {tr('link.startOver.lateDismiss')}
          </button>
        </p>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  const startOver = async () => {
    if (!confirm(tr('link.startOver.confirm'))) return;
    setBusy('start');
    setError(null);
    try {
      await startOverFromTeam(
        {
          docs,
          remote,
          download,
          hasContent: (id) => (tree.get(id)?.update_seq ?? 0) > 0,
          broadcast: (id) => {
            const channel = startOverChannel(link.entry.id);
            channel?.postMessage({ pageId: id, from: TAB });
            channel?.close();
          },
        },
        pageId,
      );
      notify(tr('link.startOver.done'));
    } catch (err) {
      const message = errorMessage(err);
      setError(
        message === LOCAL_CHANGED
          ? tr('link.startOver.changed')
          : message === TEAM_VERSION_NOT_READY
            ? tr('link.startOver.notReady')
            : isNetworkError(err)
              ? tr('link.startOver.offline')
              : tr('link.startOver.failed', { reason: message }),
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="banner link-visitor-aside" role="status">
      <p>
        <strong>{tr('link.startOver.title')}</strong> {tr('link.startOver.text')}
      </p>
      <p className="link-visitor-aside-actions">
        <button
          className="link"
          disabled={busy !== null}
          onClick={() => {
            setBusy('download');
            setError(null);
            void download()
              .catch(() => setError(tr('sync.downloadFailed')))
              .finally(() => setBusy(null));
          }}
        >
          {busy === 'download' ? tr('common.preparing') : tr('link.edit.downloadThem')}
        </button>
        <button className="link" disabled={busy !== null} data-tip={tr('link.startOver.tip')} onClick={() => void startOver()}>
          {busy === 'start' ? tr('common.preparing') : tr('link.startOver.button')}
        </button>
      </p>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
