import { useEffect, useMemo, useRef, useState } from 'react';
import { locale, useT } from '../i18n';
import { fileKind, isFolderMime } from '../media/attachments';
import { useLinkMode } from '../linkMode';
import { fileReturnPath, navigate } from '../router';
import { useServices, useSyncStatus } from '../services';
import { ACCESS_REQUESTS_SCHEMA_VERSION, askedAt, rememberAsked, requestAccess } from '../sync/accessRequests';
import { errorMessage, isNetworkError } from '../sync/types';
import { AttachmentSheet } from './AttachmentSheet';
import { createCarreteLoader } from './carreteLoader';
import type { CarreteItem } from './carreteModel';
import { FolderViewer } from './FolderViewer';
import { lazyPart, Part } from './lazyPart';

// La dirección fija de un archivo (P.30, Docs/Doc_Links_PDF.md, 2.3): `/f/<clave local>/<id>`, la que lleva cada tarjeta
// y cada video del PDF. Quien decide si se ve es la base, siempre con la misma función que el portero para el pase
// (`media_file`, con sesión; `plink_media_files`, con un link público): nunca lo que el dispositivo sabe de antes (O4).
// "No existe", "sin acceso", "en la papelera" y "proyecto borrado" dan la misma pantalla, sin el nombre del archivo, del
// proyecto ni de la página (LF4).
//
// Entrega 2 (5.2): con la base del workspace en la versión 22 y una cuenta, la pantalla sin acceso ofrece *Request
// access*, que antes dice quién va a ver el pedido (LF19); el dispositivo recuerda cuándo se pidió. Mientras está a la
// vista vuelve a preguntar cada 60 segundos, sin parpadear: si le dieron acceso, abre el archivo.

const Carrete = lazyPart(() => import('./Carrete').then((m) => m.Carrete));

type State =
  | { name: 'loading' }
  | { name: 'none' }
  | { name: 'offline' }
  | { name: 'failed' }
  | { name: 'otherWorkspace' }
  | { name: 'ready'; fileName: string; mime: string; deleted: boolean };

/** Lo que dice la base del archivo: `null` si no se ve (o no existe: lo mismo). */
type FileRow = { name?: unknown; mime?: unknown; trashed_at?: unknown; purged_at?: unknown; drive_trashed_at?: unknown } | null;

function readRow(row: FileRow): State {
  if (!row || typeof row !== 'object') return { name: 'none' };
  return {
    name: 'ready',
    fileName: typeof row.name === 'string' ? row.name : '',
    mime: typeof row.mime === 'string' ? row.mime : '',
    deleted: !!(row.trashed_at || row.purged_at || row.drive_trashed_at),
  };
}

/** Cada cuánto vuelve a preguntar la pantalla sin acceso mientras está a la vista (5.3). */
export const NO_ACCESS_RECHECK_MS = 60_000;

export function FileScreen({ localKey, id }: { localKey: string; id: string }) {
  const tr = useT();
  const { client, media, files, workspace } = useServices();
  const { online, schemaVersion } = useSyncStatus();
  const link = useLinkMode();
  const ownKey = link ? link.entry.localKey : workspace.config.localKey;
  const [state, setState] = useState<State>({ name: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // Una pregunta de fondo (cada 60 s) no muestra "Opening…" ni cambia la pantalla si falla.
  const quiet = useRef(false);
  const current = useRef(state.name);
  current.current = state.name;

  useEffect(() => {
    // La dirección es de otro workspace (no debería pasar: el arranque elige el workspace por la clave del camino).
    if (localKey !== ownKey) {
      setState({ name: 'otherWorkspace' });
      return;
    }
    let live = true;
    const background = quiet.current;
    quiet.current = false;
    const offline = !online || (typeof navigator !== 'undefined' && navigator.onLine === false);
    if (offline) {
      if (background) return;
      // Sin red: solo lo que ya está en el dispositivo; nunca "sin acceso" por estar sin red.
      const info = media.fileInfo(id);
      setState(info?.local ? { name: 'ready', fileName: info.name, mime: info.mime, deleted: false } : { name: 'offline' });
      return;
    }
    if (!background) setState({ name: 'loading' });
    const ask = link
      ? client.rpc('plink_media_files', { p_ids: [id] }).then(({ data, error }) => {
          if (error) throw error;
          return (Array.isArray(data) ? (data[0] as FileRow) : null) ?? null;
        })
      : client.rpc('media_file', { p_file_id: id }).then(({ data, error }) => {
          if (error) throw error;
          return (data as FileRow) ?? null;
        });
    ask.then(
      (row) => live && setState(readRow(row)),
      (err: unknown) => {
        console.warn('[archivo] no se pudo preguntar por el archivo', err);
        if (live && !background) setState({ name: 'failed' });
      },
    );
    return () => {
      live = false;
    };
  }, [client, media, id, localKey, ownKey, link, online, attempt]);

  // Sin acceso y a la vista: vuelve a preguntar cada 60 s (5.3). Sin red o con un error: al volver la red (O7).
  useEffect(() => {
    const again = (background: boolean) => {
      quiet.current = background;
      setAttempt((n) => n + 1);
    };
    const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
    const timer = setInterval(() => {
      if (current.current === 'none' && visible()) again(true);
    }, NO_ACCESS_RECHECK_MS);
    const onOnline = () => {
      if (current.current === 'offline' || current.current === 'failed') again(false);
    };
    window.addEventListener('online', onOnline);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  // Vuelve a donde estaba si llegó desde la app; si no, al inicio del workspace (O7).
  const close = () => navigate(fileReturnPath());
  const canRequest = !link && (schemaVersion ?? 0) >= ACCESS_REQUESTS_SCHEMA_VERSION;

  if (state.name === 'ready' && !state.deleted) {
    if (isFolderMime(state.mime)) return <FolderViewer fileId={id} name={state.fileName} onClose={close} />;
    const kind = fileKind(state.mime, state.fileName);
    if (kind === 'image' || kind === 'video') return <OneInCarrete id={id} name={state.fileName} online={online} onClose={close} files={files} />;
    return <AttachmentSheet fileId={id} onClose={close} />;
  }

  return (
    <main className="center-screen file-screen">
      <div className="card">
        {state.name === 'loading' && <p className="muted">{tr('file.opening')}</p>}
        {state.name === 'none' && (
          <>
            <h1>{tr('file.noAccess.title')}</h1>
            {canRequest ? (
              <RequestAccess localKey={localKey} id={id} onHasAccess={() => setAttempt((n) => n + 1)} />
            ) : (
              <p className="muted">{tr('file.noAccess.text')}</p>
            )}
          </>
        )}
        {state.name === 'otherWorkspace' && <p className="muted">{tr('file.incomplete')}</p>}
        {state.name === 'offline' && <p className="muted">{tr('file.offline')}</p>}
        {state.name === 'ready' && state.deleted && <p className="muted">{tr('file.deleted')}</p>}
        {state.name === 'failed' && (
          <>
            <p className="error">{tr('file.failed')}</p>
            <button className="primary" onClick={() => setAttempt((n) => n + 1)}>
              {tr('common.tryAgain')}
            </button>
          </>
        )}
        {state.name !== 'loading' && (
          <button className="link" onClick={close}>
            {tr('file.home')}
          </button>
        )}
      </div>
    </main>
  );
}

/**
 * *Request access* (5.2): antes de mandar dice quién va a ver el pedido (LF19). La respuesta de la base es la misma
 * exista o no el archivo; el dispositivo anota cuándo se pidió (la base no deja listar los pedidos propios).
 */
function RequestAccess({ localKey, id, onHasAccess }: { localKey: string; id: string; onHasAccess: () => void }) {
  const tr = useT();
  const { client } = useServices();
  const [asked, setAsked] = useState(() => askedAt(localKey, id));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const res = await requestAccess(client, id);
      if (res === 'has_access') return onHasAccess();
      rememberAsked(localKey, id);
      setAsked(askedAt(localKey, id) ?? new Date().toISOString());
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
      {sent ? <p>{tr('file.requestSent')}</p> : day ? <p className="muted">{tr('file.requestedOn', { date: day })}</p> : null}
      {!sent && !day && <p className="muted">{tr('file.requestHint')}</p>}
      {confirming ? (
        <>
          <p className="muted small">{tr('file.requestNote')}</p>
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

/** Una foto o un video solo, en el carrete (reproduce por el pase del portero, como desde la página). */
function OneInCarrete({ id, name, online, onClose, files }: { id: string; name: string; online: boolean; onClose: () => void; files: ReturnType<typeof useServices>['files'] }) {
  const { media } = useServices();
  const loader = useMemo(() => createCarreteLoader({ media, files }), [media, files]);
  useEffect(() => () => loader.dispose(), [loader]);
  const items = useMemo<CarreteItem[]>(
    () => [{ key: id, blockId: id, at: null, url: `sdmedia://${id}`, source: 'media', mediaId: id, name, caption: '' }],
    [id, name],
  );
  return (
    <Part onClose={onClose}>
      <Carrete items={items} start={0} loader={loader} online={online} onClose={onClose} />
    </Part>
  );
}
