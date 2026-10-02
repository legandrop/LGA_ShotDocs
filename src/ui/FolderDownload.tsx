import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { localize, useT } from '../i18n';
import '../i18n/lazy/folders';
import { formatSize } from '../media/fileTrash';
import {
  BlobSink,
  isAbort,
  planFolder,
  refreshPass,
  runDownload,
  type DownloadPlan,
  type DownloadProgress,
  type DownloadResult,
  type DownloadTarget,
  type FileOut,
  type FolderLister,
  type MissingItem,
  type PlanProgress,
} from '../media/folderZip';
import { CrcWorkerPool } from '../media/crc32';
import { zipOverhead } from '../media/zipWriter';
import { useServices, useSyncStatus } from '../services';
import { FolderGlyph } from './FolderDialog';
import { detectPlatform, isMobilePlatform } from './install';

// "Download all" de una carpeta (P.9, entrega 2, Docs/Doc_Carpetas.md, sección 9). Primero mira lo que hay adentro
// (todo el árbol, con `/folder/list`) y dice cuánto es; después, según el navegador:
// - Chrome y Edge de computadora (`showSaveFilePicker`): el zip se escribe en el archivo que se elige, a medida que
//   llega (sin tope). Y "Download to a folder…" (`showDirectoryPicker`): el árbol tal cual, sin zip.
// - Firefox, Safari y los teléfonos: el zip se arma en memoria con tope (1 GB; 500 MB en un teléfono, D24) y al
//   final se guarda con un clic (un gesto nuevo: Safari no deja bajar sin uno después de minutos de espera).

/** Lo más que se arma en memoria (sin `showSaveFilePicker`). */
export function memoryCap(mobile = isMobilePlatform(detectPlatform())): number {
  return mobile ? 500 * 1000 * 1000 : 1000 * 1000 * 1000;
}

// Lo que da Chrome y Edge (no está en los tipos de TypeScript).
type Writable = { write(data: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> };
type FileHandle = { name: string; createWritable(): Promise<Writable>; remove?: () => Promise<void> };
type DirHandle = {
  name: string;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandle>;
  removeEntry(name: string): Promise<void>;
};
type Pickers = {
  showSaveFilePicker?: (opts: unknown) => Promise<FileHandle>;
  showDirectoryPicker?: (opts: unknown) => Promise<DirHandle>;
};

function pickers(): Pickers {
  return typeof window === 'undefined' ? {} : (window as unknown as Pickers);
}

type Phase =
  | { at: 'listing'; seen: PlanProgress }
  | { at: 'ready'; plan: DownloadPlan }
  | { at: 'running'; plan: DownloadPlan; mode: Mode; progress: DownloadProgress | null }
  | { at: 'done'; plan: DownloadPlan; mode: Mode; result: DownloadResult; blob: Blob | null; saved: string }
  | { at: 'cancelled'; mode: Mode | null }
  | { at: 'failed'; reason: string };

type Mode = 'file' | 'dir' | 'memory';

export function FolderDownloadDialog({ fileId, name, onClose }: { fileId: string; name: string; onClose: () => void }) {
  const tr = useT();
  const { media } = useServices();
  const { online } = useSyncStatus();
  const [phase, setPhase] = useState<Phase>({ at: 'listing', seen: { folders: 0, files: 0, bytes: 0 } });
  const abort = useRef<AbortController | null>(null);
  const lister = media.porteroClient() as unknown as FolderLister | null;
  const { showSaveFilePicker, showDirectoryPicker } = pickers();
  const cap = memoryCap();

  // Mirar lo que hay adentro, al abrir.
  useEffect(() => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    if (!lister?.folderList) {
      setPhase({ at: 'failed', reason: tr('folders.oldServer') });
      return;
    }
    let last = 0;
    planFolder(lister, fileId, name, {
      signal: ctrl.signal,
      onProgress: (seen) => {
        // No más de 10 dibujos por segundo.
        const now = Date.now();
        if (now - last < 100) return;
        last = now;
        setPhase({ at: 'listing', seen });
      },
    }).then(
      (plan) => !ctrl.signal.aborted && setPhase({ at: 'ready', plan }),
      (err: unknown) => !ctrl.signal.aborted && setPhase({ at: 'failed', reason: reasonOf(err, tr) }),
    );
    return () => ctrl.abort();
  }, [fileId]);

  // Cerrar la ventana (o el visor) en el medio cancela lo que esté corriendo.
  useEffect(() => () => abort.current?.abort(), []);

  const running = phase.at === 'running';
  const close = useCallback(() => {
    abort.current?.abort();
    onClose();
  }, [onClose]);

  // Escape cierra antes de empezar y al terminar; mientras baja, se cancela con el botón.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Que no llegue al visor de abajo (lo cerraría).
      e.stopPropagation();
      if (phase.at !== 'running') close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close, phase.at]);

  const missingText = (plan: DownloadPlan) => (items: MissingItem[]) => {
    const lines = [tr('folders.missingHead', { name: plan.root, date: new Date().toLocaleString() }), ''];
    for (const item of items) {
      const why = {
        shortcut: tr('folders.missingShortcut'),
        google: tr('folders.missingGoogle'),
        folder: tr('folders.missingFolder'),
        failed: tr('folders.missingFailed'),
        incomplete: tr('folders.missingIncomplete'),
      }[item.reason];
      lines.push(`${item.path} — ${why}${item.detail ? ` (${item.detail})` : ''}`);
    }
    // Con BOM y fin de renglón de Windows: el Bloc de notas viejo también lo lee bien.
    return `﻿${lines.join('\r\n')}\r\n`;
  };

  const start = async (plan: DownloadPlan, mode: Mode) => {
    let target: DownloadTarget;
    let finish: () => Promise<void> = async () => undefined;
    let discard: () => Promise<void> = async () => undefined;
    let saved = plan.root;
    const crc = new CrcWorkerPool();
    let sink: BlobSink | null = null;
    try {
      if (mode === 'file') {
        const handle = await showSaveFilePicker!({
          suggestedName: `${plan.root}.zip`,
          types: [{ description: 'Zip', accept: { 'application/zip': ['.zip'] } }],
          id: 'shotdocs-download',
        });
        const writable = await handle.createWritable();
        saved = handle.name;
        target = { kind: 'zip', sink: { write: (c) => writable.write(c) }, crc: () => crc.stream() };
        finish = () => writable.close();
        discard = async () => {
          await writable.abort().catch(() => undefined);
          await handle.remove?.().catch(() => undefined);
        };
      } else if (mode === 'dir') {
        const parent = await showDirectoryPicker!({ mode: 'readwrite', id: 'shotdocs-download' });
        const top = await freshFolder(parent, plan.root);
        saved = top.name;
        target = dirTarget(top);
      } else {
        sink = new BlobSink();
        target = { kind: 'zip', sink, crc: () => crc.stream() };
      }
    } catch (err) {
      crc.close();
      // Cerró el selector sin elegir: sigue como estaba.
      if (isAbort(err)) return;
      setPhase({ at: 'failed', reason: reasonOf(err, tr) });
      return;
    }
    const ctrl = new AbortController();
    abort.current = ctrl;
    setPhase({ at: 'running', plan, mode, progress: null });
    let last = 0;
    try {
      const result = await runDownload(
        plan,
        target,
        { refresh: (file) => refreshPass(lister!, fileId, file), missingText: missingText(plan) },
        {
          signal: ctrl.signal,
          onProgress: (progress) => {
            const now = Date.now();
            if (now - last < 150 && progress.current && !progress.offline) return;
            last = now;
            setPhase({ at: 'running', plan, mode, progress });
          },
        },
      );
      await finish();
      setPhase({ at: 'done', plan, mode, result, blob: sink ? sink.blob() : null, saved });
    } catch (err) {
      await discard();
      if (isAbort(err)) setPhase({ at: 'cancelled', mode });
      else setPhase({ at: 'failed', reason: reasonOf(err, tr) });
    } finally {
      crc.close();
    }
  };

  const save = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.append(a);
    a.click();
    a.remove();
    // Un rato después: la descarga puede estar empezando.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  let body: ReactNode = null;
  let actions: ReactNode = null;
  if (phase.at === 'listing') {
    body = (
      <p className="muted small">
        {tr('folders.zipListing', {
          files: tr('folders.files', { count: phase.seen.files }),
          dirs: tr('folders.dirs', { count: phase.seen.folders + 1 }),
        })}
      </p>
    );
    actions = (
      <button className="button" onClick={close}>
        {tr('common.cancel')}
      </button>
    );
  } else if (phase.at === 'ready') {
    const { plan } = phase;
    const total = plan.bytes + zipOverhead(plan.files.map((f) => f.path), plan.dirs.length);
    const memory = !showSaveFilePicker;
    const tooBig = memory && total > cap;
    body = (
      <>
        <div className="folder-summary">
          <span className="folder-summary-counts">
            {tr('folders.counts', {
              files: tr('folders.files', { count: plan.files.length }),
              dirs: tr('folders.dirs', { count: plan.dirs.length + 1 }),
              size: formatSize(plan.bytes),
            })}
          </span>
        </div>
        {plan.files.length === 0 && <p className="muted small">{tr('folders.zipEmpty')}</p>}
        {plan.skipped.length > 0 && <p className="warn small">{tr('folders.zipSkipped', { count: plan.skipped.length })}</p>}
        {tooBig && <p className="warn small">{tr('folders.zipTooBig', { size: formatSize(total), max: formatSize(cap) })}</p>}
        {!online && <p className="muted small">{tr('folders.downloadAllOffline')}</p>}
      </>
    );
    const can = plan.files.length > 0 && online && !tooBig;
    actions = (
      <>
        <button className="button" onClick={close}>
          {tr('common.cancel')}
        </button>
        {can && showDirectoryPicker && (
          <button className="button" data-tip={tr('folders.zipToFolderTip')} onClick={() => void start(plan, 'dir')}>
            {tr('folders.zipToFolder')}
          </button>
        )}
        {can &&
          (memory ? (
            <button className="button primary" data-tip={tr('folders.zipInMemoryTip', { max: formatSize(cap) })} onClick={() => void start(plan, 'memory')}>
              {tr('folders.zipInMemory')}
            </button>
          ) : (
            <button className="button primary" data-tip={tr('folders.zipAsZipTip')} onClick={() => void start(plan, 'file')}>
              {tr('folders.zipAsZip')}
            </button>
          ))}
      </>
    );
  } else if (phase.at === 'running') {
    const p = phase.progress;
    const pct = p && p.bytes > 0 ? Math.min(100, Math.round((p.bytesDone / p.bytes) * 100)) : p && p.files ? Math.round((p.filesDone / p.files) * 100) : 0;
    body = (
      <>
        <div className="folder-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div style={{ width: `${pct}%` }} />
        </div>
        <p className="small">
          {tr('folders.progress', {
            done: p?.filesDone ?? 0,
            total: phase.plan.files.length,
            sent: formatSize(p?.bytesDone ?? 0),
            size: formatSize(phase.plan.bytes),
          })}
        </p>
        {p?.current && <p className="muted small folder-download-current">{p.current}</p>}
        {p?.offline && <p className="warn small">{tr('folders.zipWaitingOnline')}</p>}
        <p className="muted small">{tr('folders.zipKeepOpen')}</p>
      </>
    );
    actions = (
      <button className="button" onClick={() => abort.current?.abort()}>
        {tr('common.cancel')}
      </button>
    );
  } else if (phase.at === 'done') {
    const { result, mode, blob, saved, plan } = phase;
    const zipName = `${plan.root}.zip`;
    body = (
      <>
        <p className="small">
          {mode === 'memory' ? tr('folders.zipReady') : mode === 'dir' ? tr('folders.zipDoneDir', { name: saved }) : tr('folders.zipDoneFile', { name: saved })}
        </p>
        {result.missing.length > 0 && <p className="warn small">{tr('folders.zipMissing', { count: result.missing.length })}</p>}
      </>
    );
    actions = (
      <>
        <button className={blob ? 'button' : 'button primary'} onClick={close}>
          {tr('common.close')}
        </button>
        {blob && (
          <button className="button primary" onClick={() => save(blob, zipName)}>
            {tr('folders.zipSave', { name: zipName })}
          </button>
        )}
      </>
    );
  } else if (phase.at === 'cancelled') {
    body = <p className="small">{phase.mode === 'dir' ? tr('folders.zipCancelledDir') : tr('folders.zipCancelled')}</p>;
    actions = (
      <button className="button primary" onClick={close}>
        {tr('common.close')}
      </button>
    );
  } else {
    body = <p className="error small">{tr('folders.zipFailed', { reason: phase.reason })}</p>;
    actions = (
      <button className="button primary" onClick={close}>
        {tr('common.close')}
      </button>
    );
  }

  return (
    <div
      className="modal-backdrop folder-download-backdrop"
      onClick={(e) => {
        // El clic no llega al visor de abajo (lo cerraría); mientras baja, afuera no cierra.
        e.stopPropagation();
        if (!running) close();
      }}
    >
      <div className="modal folder-dialog folder-download" role="dialog" aria-modal="true" aria-label={tr('folders.downloadAll')} onClick={(e) => e.stopPropagation()}>
        <h2>
          <FolderGlyph /> {name}
        </h2>
        <p className="muted small">{tr('folders.downloadAll')}</p>
        <div className="folder-dialog-body">{body}</div>
        <div className="modal-actions folder-actions">{actions}</div>
      </div>
    </div>
  );
}

function reasonOf(err: unknown, tr: ReturnType<typeof useT>): string {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'not_found' || code === 'folder_gone') return tr('folders.notFound');
  if (code === 'not_ready') return tr('folders.notReady');
  if (code === 'rate') return tr('folders.slowDown');
  if ((err as { status?: number } | null)?.status === 0) return tr('folders.offlineList');
  return localize(err instanceof Error ? err.message : String(err));
}

/** Una carpeta nueva adentro de la elegida: `Referencias`, o `Referencias (2)` si ya hay una (nunca se mezcla). */
async function freshFolder(parent: DirHandle, name: string): Promise<DirHandle> {
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? name : `${name} (${n})`;
    const exists = await parent.getDirectoryHandle(candidate).then(
      () => true,
      () => false,
    );
    const isFile = !exists && (await parent.getFileHandle(candidate).then(
      () => true,
      () => false,
    ));
    if (!exists && !isFile) return parent.getDirectoryHandle(candidate, { create: true });
  }
  throw new Error('Could not create the folder.');
}

/** El árbol en una carpeta del disco: cada archivo se escribe aparte y, si no llega entero, se borra. */
export function dirTarget(top: DirHandle): DownloadTarget {
  const dirs = new Map<string, Promise<DirHandle>>([['', Promise.resolve(top)]]);
  const dirOf = (path: string): Promise<DirHandle> => {
    const known = dirs.get(path);
    if (known) return known;
    const cut = path.lastIndexOf('/');
    const made = dirOf(cut < 0 ? '' : path.slice(0, cut)).then((up) => up.getDirectoryHandle(path.slice(cut + 1), { create: true }));
    dirs.set(path, made);
    return made;
  };
  return {
    kind: 'dir',
    makeDir: async (path) => void (await dirOf(path)),
    makeFile: async (path): Promise<FileOut> => {
      const cut = path.lastIndexOf('/');
      const dir = await dirOf(cut < 0 ? '' : path.slice(0, cut));
      const fileName = path.slice(cut + 1);
      const handle = await dir.getFileHandle(fileName, { create: true });
      const writable = await handle.createWritable();
      return {
        write: (c) => writable.write(c),
        close: () => writable.close(),
        abort: async () => {
          await writable.abort().catch(() => undefined);
          await dir.removeEntry(fileName).catch(() => undefined);
        },
      };
    },
  };
}
