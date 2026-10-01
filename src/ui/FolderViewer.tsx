import { useCallback, useEffect, useMemo, useState } from 'react';
import { localize, useT } from '../i18n';
import '../i18n/lazy/folders';
import { fileKind, inlineType } from '../media/attachments';
import { formatSize } from '../media/fileTrash';
import type { FolderEntry, FolderListing } from '../media/portero';
import { PorteroError } from '../media/portero';
import { useServices, useSyncStatus } from '../services';
import type { CarreteItem } from './carreteModel';
import { forceDownload, type CarreteLoader, type Full, type Preview } from './carreteLoader';
import { downloadNow, openInNewTab } from './attachmentOpen';
import { FolderGlyph, useFolderProgress } from './FolderDialog';
import { lazyPart, Part } from './lazyPart';

// El visor de una carpeta (P.9, Docs/Doc_Carpetas.md, sección 8): lo que hay ahora en la carpeta de Drive,
// servido por el portero con los mismos pases que las fotos. Las migas de pan empiezan en la carpeta (nunca más
// arriba); primero las subcarpetas y después los archivos. Una foto o un video abre el carrete con las fotos y
// videos de esa subcarpeta; un PDF se abre en otra pestaña; lo demás se baja.

const Carrete = lazyPart(() => import('./Carrete').then((m) => m.Carrete));

type FolderLister = { folderList: (file: string, dir?: string | null, pageToken?: string | null) => Promise<FolderListing> };

interface Level {
  id: string | null;
  name: string;
}

export function FolderViewer({ fileId, name, onClose, onShowUpload }: { fileId: string; name: string; onClose: () => void; onShowUpload?: () => void }) {
  const tr = useT();
  const { media, folders } = useServices();
  const { online } = useSyncStatus();
  const [path, setPath] = useState<Level[]>([{ id: null, name }]);
  const [entries, setEntries] = useState<FolderEntry[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [carrete, setCarrete] = useState<{ items: CarreteItem[]; start: number; loader: CarreteLoader } | null>(null);
  const upload = useFolderProgress(folders, fileId);
  const here = path[path.length - 1]!;

  const lister = media.porteroClient() as unknown as FolderLister | null;

  const load = useCallback(
    async (dir: string | null, token: string | null) => {
      if (!lister?.folderList) {
        setError(tr('folders.oldServer'));
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const page = await lister.folderList(fileId, dir, token);
        setEntries((prev) => (token && prev ? [...prev, ...page.entries] : page.entries));
        setNext(page.nextPageToken);
      } catch (err) {
        if (!token) setEntries(null);
        if (err instanceof PorteroError && err.code === 'not_ready') setError(tr('folders.notReady'));
        else if (err instanceof PorteroError && err.status === 404 && !err.code) setError(tr('folders.oldServer'));
        else if (err instanceof PorteroError && err.status === 0) setError(tr('folders.offlineList'));
        else setError(tr('folders.listFailed', { reason: localize(err instanceof Error ? err.message : String(err)) }));
      } finally {
        setLoading(false);
      }
    },
    [lister, fileId, tr],
  );

  useEffect(() => {
    setEntries(null);
    void load(here.id, null);
  }, [here.id, load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || carrete) return;
      if (path.length > 1) setPath((p) => p.slice(0, -1));
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, path.length, carrete]);

  // Las fotos y videos de esta subcarpeta, en el orden de la lista, para el carrete.
  const viewable = useMemo(
    () => (entries ?? []).filter((e): e is Extract<FolderEntry, { type: 'file' }> => e.type === 'file' && fileKind(e.mime, e.name) !== 'file'),
    [entries],
  );

  const openFile = (entry: Extract<FolderEntry, { type: 'file' }>) => {
    const at = viewable.indexOf(entry);
    if (at >= 0) {
      setCarrete({ items: viewable.map(toItem), start: at, loader: folderLoader(viewable) });
      return;
    }
    if (inlineType(entry.mime)) openInNewTab(entry.url);
    else download(entry);
  };

  const download = (entry: Extract<FolderEntry, { type: 'file' }>) =>
    downloadNow({ url: forceDownload(entry.url), name: entry.name, release: () => undefined });

  return (
    <div className="modal-backdrop folder-viewer-backdrop" onClick={onClose}>
      <div className="modal folder-viewer" role="dialog" aria-modal="true" aria-label={name} onClick={(e) => e.stopPropagation()}>
        <header className="folder-viewer-head">
          <nav className="folder-crumbs" aria-label={tr('folders.breadcrumb')}>
            {path.map((level, i) => (
              <span key={`${level.id ?? 'root'}:${i}`}>
                {i > 0 && <span className="folder-crumb-sep">›</span>}
                {i < path.length - 1 ? (
                  <button className="link" onClick={() => setPath((p) => p.slice(0, i + 1))}>
                    {i === 0 && <FolderGlyph />} {level.name}
                  </button>
                ) : (
                  <strong>
                    {i === 0 && <FolderGlyph />} {level.name}
                  </strong>
                )}
              </span>
            ))}
          </nav>
          <button className="button" onClick={onClose}>
            {tr('common.close')}
          </button>
        </header>
        {upload && upload.state !== 'done' && (
          <p className="folder-upload-strip small">
            {tr('folders.uploadHere')}: {upload.doneFiles} / {upload.files}
            {onShowUpload && (
              <button className="link" onClick={onShowUpload}>
                {tr('folders.showUpload')}
              </button>
            )}
          </p>
        )}
        {error && <p className={online ? 'error small' : 'muted small'}>{error}</p>}
        {entries === null && loading && <p className="muted small">{tr('folders.loading')}</p>}
        {entries && entries.length === 0 && !loading && <p className="muted small">{tr('folders.viewerEmpty')}</p>}
        {entries && entries.length > 0 && (
          <ul className="folder-list">
            {entries.map((entry, i) => (
              <li key={'id' in entry ? entry.id : `${entry.type}:${entry.name}:${i}`} className={`folder-row folder-row-${entry.type}`}>
                {entry.type === 'folder' && (
                  <button className="folder-row-main" onClick={() => setPath((p) => [...p, { id: entry.id, name: entry.name }])}>
                    <span className="folder-row-icon">
                      <FolderGlyph size={20} />
                    </span>
                    <span className="folder-row-name">{entry.name}</span>
                  </button>
                )}
                {entry.type === 'file' && (
                  <>
                    <button className="folder-row-main" onClick={() => openFile(entry)}>
                      <span className="folder-row-icon">
                        {entry.thumb ? <img src={entry.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <FileGlyph />}
                      </span>
                      <span className="folder-row-name">{entry.name}</span>
                      <span className="folder-row-size muted">{formatSize(entry.size)}</span>
                    </button>
                    <button className="button folder-row-download" aria-label={`${tr('folders.download')} ${entry.name}`} onClick={() => download(entry)}>
                      {tr('folders.download')}
                    </button>
                  </>
                )}
                {(entry.type === 'shortcut' || entry.type === 'google') && (
                  <div className="folder-row-main folder-row-off">
                    <span className="folder-row-icon">
                      <FileGlyph />
                    </span>
                    <span className="folder-row-name">{entry.name}</span>
                    <span className="folder-row-size muted">{entry.type === 'shortcut' ? tr('folders.shortcut') : tr('folders.googleDoc')}</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {next && (
          <button className="button" disabled={loading} onClick={() => void load(here.id, next)}>
            {loading ? tr('folders.loading') : tr('folders.loadMore')}
          </button>
        )}
      </div>
      {carrete && (
        <Part onClose={() => setCarrete(null)}>
          <Carrete {...carrete} online={online} onClose={() => setCarrete(null)} />
        </Part>
      )}
    </div>
  );
}

/** Un archivo de la carpeta como elemento del carrete (sin bloque: lo que ve sale del pase de la lista). */
function toItem(entry: Extract<FolderEntry, { type: 'file' }>): CarreteItem {
  return { key: entry.id, blockId: entry.id, at: null, url: entry.url, source: 'web', mediaId: null, name: entry.name, caption: '' };
}

/** El carrete de una carpeta: la miniatura de Drive mientras carga y el archivo por su pase. */
function folderLoader(entries: Extract<FolderEntry, { type: 'file' }>[]): CarreteLoader {
  const byKey = new Map(entries.map((e) => [e.id, e]));
  return {
    preview: async (item): Promise<Preview> => {
      const entry = byKey.get(item.key);
      const kind = entry ? fileKind(entry.mime, entry.name) : null;
      return { kind: kind === 'file' ? null : kind, name: entry?.name ?? item.name, preview: entry?.thumb ?? null };
    },
    full: async (item): Promise<Full> => ({ url: byKey.get(item.key)?.url ?? item.url, local: false, portero: true }),
    retry: () => undefined,
    dispose: () => undefined,
  };
}

function FileGlyph() {
  return (
    <svg width="18" height="20" viewBox="0 0 18 20" aria-hidden="true">
      <path d="M3 1h8l5 5v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z" fill="#fff" stroke="#b9b4ae" />
      <path d="M11 1v5h5" fill="#e3dfda" stroke="#b9b4ae" />
    </svg>
  );
}
