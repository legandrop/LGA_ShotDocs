import { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { fileKind, isFolderMime } from '../media/attachments';
import { useLinkMode } from '../linkMode';
import { navigate } from '../router';
import { useServices, useSyncStatus } from '../services';
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

export function FileScreen({ localKey, id }: { localKey: string; id: string }) {
  const tr = useT();
  const { client, media, files, workspace } = useServices();
  const { online } = useSyncStatus();
  const link = useLinkMode();
  const ownKey = link ? link.entry.localKey : workspace.config.localKey;
  const [state, setState] = useState<State>({ name: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // La dirección es de otro workspace (no debería pasar: el arranque elige el workspace por la clave del camino).
    if (localKey !== ownKey) {
      setState({ name: 'otherWorkspace' });
      return;
    }
    let live = true;
    const offline = !online || (typeof navigator !== 'undefined' && navigator.onLine === false);
    if (offline) {
      // Sin red: solo lo que ya está en el dispositivo; nunca "sin acceso" por estar sin red.
      const info = media.fileInfo(id);
      setState(info?.local ? { name: 'ready', fileName: info.name, mime: info.mime, deleted: false } : { name: 'offline' });
      return;
    }
    setState({ name: 'loading' });
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
        if (live) setState({ name: 'failed' });
      },
    );
    return () => {
      live = false;
    };
  }, [client, media, id, localKey, ownKey, link, online, attempt]);

  const close = () => navigate('/');

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
            <p className="muted">{tr('file.noAccess.text')}</p>
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
