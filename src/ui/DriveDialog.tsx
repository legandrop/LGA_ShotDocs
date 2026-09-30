import { useEffect, useMemo, useState } from 'react';
import { pickFolder } from '../media/picker';
import { Portero, sessionToken, type DriveStatus } from '../media/portero';
import { useServices, useSyncStatus } from '../services';

// "Google Drive" en el menú de la cuenta (solo el dueño): la conexión con su Drive y dónde va la carpeta
// `LGA_ShotDocs` (paso 8 del plan). Elegirla usa el selector de carpetas de Google; sin la clave
// (`GOOGLE_API_KEY` en el portero) va a la raíz de My Drive. Ver Docs/Doc_Portero.md.

const RESULTS: Record<string, string> = {
  connected: 'Google Drive connected.',
  'drive-permission-missing': 'Google Drive was not connected: the Drive permission was left unchecked. Connect again and keep it checked.',
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
      ? 'Could not reach the media server'
      : 'Checking…'
    : status.connected
      ? `Connected${status.email ? ` as ${status.email}` : ''}`
      : status.broken
        ? 'Needs reconnecting'
        : 'Not connected';
  // Lo dice el portero con la sesión de la persona: solo el dueño conecta Drive y elige la carpeta.
  const owner = status?.isOwner === true;
  const place = status?.folder ? `“${status.folder.name || 'a folder'}”` : 'My Drive (the root)';

  return (
    <div className="modal-backdrop" onClick={onClose} style={picking ? { display: 'none' } : undefined}>
      <div className="modal drive-dialog" role="dialog" aria-modal="true" aria-label="Google Drive" onClick={(e) => e.stopPropagation()}>
        <h2>Google Drive</h2>
        <p className="muted">Photos and videos added to pages are stored in the workspace owner's Google Drive.</p>
        {result && (
          <p className={result === 'connected' ? 'media-ok' : 'error'}>
            {RESULTS[result] ?? `Google Drive was not connected (${result}).`}
          </p>
        )}
        {!portero ? (
          <p className="error">This workspace has no media server yet (see Docs/Doc_Portero.md).</p>
        ) : (
          <>
            <dl className="media-facts">
              <dt className="mono-label">Status</dt>
              <dd className={status?.connected ? 'media-ok' : undefined}>{connection}</dd>
              {status?.broken && (
                <>
                  <dt className="mono-label">Problem</dt>
                  <dd>{status.broken}</dd>
                </>
              )}
              {status?.connected && (
                <>
                  <dt className="mono-label">Folder</dt>
                  <dd>
                    <code>LGA_ShotDocs</code> is in {place}. Inside it: one folder per project, and one per day.
                  </dd>
                </>
              )}
            </dl>
            {status?.connected && status.picker === false && (
              <p className="muted drive-note">
                The folder goes to the root of My Drive. To choose another folder, the media server needs a Google API
                key (<code>GOOGLE_API_KEY</code>, step 2b of the media server guide, Docs/Doc_Portero.md).
              </p>
            )}
            {error && <p className="error">{error}</p>}
            {status && !owner && <p className="muted">Only the owner of the workspace can change this.</p>}
            <div className="media-actions">
              {owner && !status.connected && (
                <button className="primary" disabled={!!busy} onClick={() => void connect()}>
                  {status.broken ? 'Reconnect Google Drive' : 'Connect Google Drive'}
                </button>
              )}
              {owner && status.connected && status.picker && (
                <button
                  className="primary"
                  disabled={!!busy}
                  data-tip="Opens Google's folder picker. The LGA_ShotDocs folder moves there with everything in it."
                  onClick={() => void choose()}
                >
                  {busy === 'choose' ? 'Choosing…' : 'Choose folder…'}
                </button>
              )}
              {owner && status.connected && status.folder && (
                <button disabled={!!busy} data-tip="Moves the LGA_ShotDocs folder back to the root of My Drive" onClick={() => void useRoot()}>
                  Use My Drive root
                </button>
              )}
              {owner && status.connected && (
                <button
                  disabled={!!busy}
                  data-tip="Authorize Google Drive again, with the same Google account"
                  onClick={() => void connect()}
                >
                  Reconnect
                </button>
              )}
            </div>
          </>
        )}
        <div className="modal-actions">
          <button className="link" onClick={() => setChecking((n) => n + 1)} disabled={!portero || !!busy}>
            Check again
          </button>
          <button className="link" autoFocus onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
