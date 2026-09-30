import { useEffect, useMemo, useState } from 'react';
import { localize, useT, type Key } from '../i18n';
import '../i18n/lazy/drive';
import { pickFolder } from '../media/picker';
import { Portero, sessionToken, type DriveStatus } from '../media/portero';
import { useServices, useSyncStatus } from '../services';

// "Google Drive" en el menú de la cuenta (solo el dueño): la conexión con su Drive y dónde va la carpeta
// `LGA_ShotDocs` (paso 8 del plan). Elegirla usa el selector de carpetas de Google; sin la clave
// (`GOOGLE_API_KEY` en el portero) va a la raíz de My Drive. Ver Docs/Doc_Portero.md.

const RESULTS: Record<string, Key> = {
  connected: 'drive.connected',
  'drive-permission-missing': 'drive.permissionMissing',
};

/**
 * El diálogo, solo para el dueño del workspace (con portero). Al volver de Google con `?drive=` se espera a
 * saber quién es el dueño; a cualquier otra persona no se le muestra nada.
 */
export function DriveDialogHost({ result, onClose }: { result: string | null; onClose: () => void }) {
  const { user } = useServices();
  const { mediaUrl, ownerId } = useSyncStatus();
  if (!mediaUrl || !ownerId || ownerId !== user.id) return null;
  return <DriveDialog result={result} onClose={onClose} />;
}

export function DriveDialog({ result, onClose }: { result: string | null; onClose: () => void }) {
  const { media, client } = useServices();
  const url = media.mediaUrl;
  const portero = useMemo(() => (url ? new Portero(url, { token: sessionToken(client) }) : null), [url, client]);
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Mientras está abierto el selector de Google, este diálogo se oculta para no taparlo.
  const [picking, setPicking] = useState(false);
  const [checking, setChecking] = useState(0);
  const tr = useT();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !picking && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, picking]);

  useEffect(() => {
    if (!portero) return;
    let live = true;
    setError(null);
    portero.status().then(
      (s) => live && setStatus(s),
      (err: unknown) => live && setError(message(err)),
    );
    return () => {
      live = false;
    };
  }, [portero, checking]);

  async function run(label: string, work: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
      setPicking(false);
    }
  }

  const connect = () =>
    run('connect', async () => {
      // Google vuelve a esta misma pantalla con `?drive=<resultado>` y el diálogo se abre de nuevo.
      location.href = await portero!.connect(location.pathname);
    });

  const choose = () =>
    run('choose', async () => {
      const config = await portero!.picker();
      setPicking(true);
      const picked = await pickFolder(config);
      setPicking(false);
      if (!picked) return;
      const folder = await portero!.setFolder(picked.id);
      setStatus((s) => s && { ...s, folder });
    });

  const useRoot = () =>
    run('root', async () => {
      await portero!.setFolder(null);
      setStatus((s) => s && { ...s, folder: null });
    });

  const connection = !status
    ? error
      ? tr('drive.unreachable')
      : tr('login.checking')
    : status.connected
      ? status.email
        ? tr('drive.connectedAs', { email: status.email })
        : tr('drive.connectedShort')
      : status.broken
        ? tr('drive.needsReconnect')
        : tr('drive.notConnected');
  // Lo dice el portero con la sesión de la persona: solo el dueño conecta Drive y elige la carpeta.
  const owner = status?.isOwner === true;
  const place = status?.folder ? `“${status.folder.name || tr('drive.aFolder')}”` : tr('drive.root');

  return (
    <div className="modal-backdrop" onClick={onClose} style={picking ? { display: 'none' } : undefined}>
      <div className="modal drive-dialog" role="dialog" aria-modal="true" aria-label="Google Drive" onClick={(e) => e.stopPropagation()}>
        <h2>Google Drive</h2>
        <p className="muted">{tr('drive.intro')}</p>
        {result && (
          <p className={result === 'connected' ? 'media-ok' : 'error'}>
            {Object.hasOwn(RESULTS, result) ? tr(RESULTS[result]) : tr('drive.notConnectedReason', { reason: result })}
          </p>
        )}
        {!portero ? (
          <p className="error">{tr('drive.noServer')}</p>
        ) : (
          <>
            <dl className="media-facts">
              <dt className="mono-label">{tr('drive.status')}</dt>
              <dd className={status?.connected ? 'media-ok' : undefined}>{connection}</dd>
              {status?.broken && (
                <>
                  <dt className="mono-label">{tr('drive.problem')}</dt>
                  <dd>{status.broken}</dd>
                </>
              )}
              {status?.connected && (
                <>
                  <dt className="mono-label">{tr('drive.folder')}</dt>
                  <dd>{tr.rich('drive.folderText', { folder: <code>LGA_ShotDocs</code>, place })}</dd>
                </>
              )}
            </dl>
            {status?.connected && status.picker === false && (
              <p className="muted drive-note">{tr.rich('drive.noPicker', { key: <code>GOOGLE_API_KEY</code> })}</p>
            )}
            {error && <p className="error">{error}</p>}
            {status && !owner && <p className="muted">{tr('drive.ownerOnly')}</p>}
            <div className="media-actions">
              {owner && !status.connected && (
                <button className="primary" disabled={!!busy} onClick={() => void connect()}>
                  {status.broken ? tr('drive.reconnectDrive') : tr('drive.connect')}
                </button>
              )}
              {owner && status.connected && status.picker && (
                <button
                  className="primary"
                  disabled={!!busy}
                  data-tip={tr('drive.chooseTip')}
                  onClick={() => void choose()}
                >
                  {busy === 'choose' ? tr('drive.choosing') : tr('drive.choose')}
                </button>
              )}
              {owner && status.connected && status.folder && (
                <button disabled={!!busy} data-tip={tr('drive.useRootTip')} onClick={() => void useRoot()}>
                  {tr('drive.useRoot')}
                </button>
              )}
              {owner && status.connected && (
                <button
                  disabled={!!busy}
                  data-tip={tr('drive.reconnectTip')}
                  onClick={() => void connect()}
                >
                  {tr('drive.reconnect')}
                </button>
              )}
            </div>
          </>
        )}
        <div className="modal-actions">
          <button className="link" onClick={() => setChecking((n) => n + 1)} disabled={!portero || !!busy}>
            {tr('drive.checkAgain')}
          </button>
          <button className="link" autoFocus onClick={onClose}>
            {tr('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

function message(err: unknown): string {
  return localize(err instanceof Error ? err.message : String(err));
}
