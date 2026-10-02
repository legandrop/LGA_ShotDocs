import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { localize, t, useT } from '../i18n';
import '../i18n/lazy/exportPdf';
import '../i18n/lazy/exportZip';
import { appComments } from '../export/exportComments';
import { ExportCancelled, ExportEditor } from '../export/exportEditor';
import type { ExportPlanPage } from '../export/exportPages';
import {
  appArchiveMedia,
  buildZip,
  estimateZip,
  porteroCost,
  remoteOf,
  totalOf,
  type ZipEstimate,
  missingLine,
  type ZipInclude,
  type ZipProgress,
  type ZipResult,
} from '../export/exportZip';
import { rootFolderName as rootName } from '../export/zipLayout';
import { formatSize } from '../media/fileTrash';
import { BlobSink, isAbort, MemoryCapExceeded, type DownloadTarget } from '../media/folderZip';
import { CrcWorkerPool } from '../media/crc32';
import { zipOverhead } from '../media/zipWriter';
import { useServices, useSyncStatus, useTree } from '../services';
import { dirTarget, freshFolder, memoryCap, pickers, type DirHandle } from './FolderDownload';
import { porteroDownload } from './sharpImages';

// El zip de la ventana *Export* (P.22, Docs/Doc_Exportar.md, secciones 2.3 y 7; entrega 2). Antes de empezar dice cuánto
// pesa (por casilla: *Original photos*, *Attachments*, *Videos*; las vistas JPEG van siempre), cuántos pedidos al portero
// va a gastar y qué originales faltan sin red. Después, los destinos de *Download all* (Doc_Carpetas.md, D24): Chrome y
// Edge de computadora escriben el zip a medida que se arma (`showSaveFilePicker`) o el árbol en una carpeta
// (`showDirectoryPicker`); los demás lo arman en memoria con tope y lo guardan con un toque. Mientras trabaja, el avance
// y *Cancel* (Escape no cierra); al terminar, dónde quedó y lo que falta.

type Mode = 'file' | 'dir' | 'memory';

type Phase =
  | { at: 'choose' }
  | { at: 'working'; mode: Mode; progress: ZipProgress | null }
  | { at: 'done'; mode: Mode; result: ZipResult; saved: string; blob: Blob | null; zipName: string; blobSaved?: boolean; list?: boolean }
  | { at: 'cancelled'; mode: Mode }
  | { at: 'failed'; reason: string };

/** Adónde va, ya abierto (el selector elegido, la carpeta nueva o el zip en memoria). */
interface Opened {
  target: DownloadTarget;
  finish: () => Promise<void>;
  discard: () => Promise<void>;
  saved: string;
  sink: BlobSink | null;
  crc: CrcWorkerPool;
}

export interface ExportZipProps {
  plan: ExportPlanPage[];
  kind: 'page' | 'project';
  /** El proyecto (solo cuando se exporta entero: una rama no lo nombra). */
  project: { id: string; name: string } | null;
  /** El título de la raíz de lo exportado. */
  title: string;
  /** Trabajando: la ventana no se cierra con Escape ni tocando afuera. */
  onBusy: (busy: boolean) => void;
  onClose: () => void;
}

const DEFAULT_INCLUDE: ZipInclude = { originals: true, attachments: true, videos: true, comments: true };

export function ExportZipPanel(props: ExportZipProps) {
  const tr = useT();
  const tree = useTree();
  const { docs, media, mediaDb, comments, commentsDb, user, engine } = useServices();
  const status = useSyncStatus();
  const online = status.online && (typeof navigator === 'undefined' || navigator.onLine !== false);
  const [include, setInclude] = useState<ZipInclude>(DEFAULT_INCLUDE);
  const [estimate, setEstimate] = useState<ZipEstimate | null>(null);
  const [phase, setPhase] = useState<Phase>({ at: 'choose' });
  const abort = useRef<AbortController | null>(null);
  const { showSaveFilePicker, showDirectoryPicker } = pickers();
  const cap = memoryCap();
  const archiveMedia = useMemo(() => (media.enabled ? appArchiveMedia(media, mediaDb, porteroDownload(media)) : null), [media, mediaDb]);
  const busy = phase.at === 'working';

  useEffect(() => props.onBusy(busy), [busy]);
  // Cerrar la ventana en el medio cancela.
  useEffect(() => () => abort.current?.abort(), []);

  // Lo que pesa, al elegir el zip o cambiar qué se exporta.
  useEffect(() => {
    const ctrl = new AbortController();
    setEstimate(null);
    estimateZip(props.plan, docs, archiveMedia, ctrl.signal).then(
      (e) => !ctrl.signal.aborted && setEstimate(e),
      () => undefined,
    );
    return () => ctrl.abort();
  }, [props.plan, archiveMedia]);

  // Con un zip en curso, el navegador pide confirmar antes de cerrar la pestaña.
  useEffect(() => {
    if (!busy) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [busy]);

  const zipName = `${rootName(props.title)}.zip`;
  const remote = estimate ? remoteOf(estimate, include) : { files: 0, bytes: 0 };
  const total = estimate ? totalOf(estimate, include) : { files: 0, bytes: 0 };
  // Lo que suma el zip a los archivos: las páginas (`.html`, `.md`, JSON: unos 40 KB cada una, contado por arriba) y los
  // encabezados de cada entrada.
  const zipBytes = total.bytes + props.plan.length * 40_000 + zipOverhead([], (props.plan.length * 4 + total.files * 2) * 2);
  const memory = !showSaveFilePicker;
  const tooBig = memory && zipBytes > cap;

  /** Abre el destino (tiene que ser en el clic: el navegador no abre los selectores sin un gesto). */
  const open = async (mode: Mode): Promise<Opened | null> => {
    const crc = new CrcWorkerPool();
    try {
      if (mode === 'file') {
        const handle = await showSaveFilePicker!({
          suggestedName: zipName,
          types: [{ description: 'Zip', accept: { 'application/zip': ['.zip'] } }],
          id: 'shotdocs-export',
        });
        const writable = await handle.createWritable();
        return {
          target: { kind: 'zip', sink: { write: (c) => writable.write(c) }, crc: () => crc.stream() },
          finish: () => writable.close(),
          discard: async () => {
            await writable.abort().catch(() => undefined);
            await handle.remove?.().catch(() => undefined);
          },
          saved: handle.name,
          sink: null,
          crc,
        };
      }
      if (mode === 'dir') {
        const top: DirHandle = await freshFolder(await showDirectoryPicker!({ mode: 'readwrite', id: 'shotdocs-export' }), rootName(props.title));
        return { target: dirTarget(top), finish: async () => undefined, discard: async () => undefined, saved: top.name, sink: null, crc };
      }
      const sink = new BlobSink(cap);
      return { target: { kind: 'zip', sink, crc: () => crc.stream() }, finish: async () => undefined, discard: async () => undefined, saved: zipName, sink, crc };
    } catch (err) {
      crc.close();
      // Cerró el selector sin elegir: sigue como estaba.
      if (!isAbort(err)) setPhase({ at: 'failed', reason: localize(err instanceof Error ? err.message : String(err)) });
      return null;
    }
  };

  const run = async (mode: Mode) => {
    const opened = await open(mode);
    if (!opened) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setPhase({ at: 'working', mode, progress: null });
    let editor: ExportEditor | null = null;
    let last = 0;
    try {
      const withMedia = media.enabled;
      editor = await ExportEditor.create({
        lang: tr.lang,
        resolveFileUrl: withMedia ? (url, pageId) => media.resolve(url, pageId) : undefined,
        media: withMedia ? media : null,
      });
      const states = await docs.states();
      const result = await buildZip({
        title: props.title,
        kind: props.kind,
        project: props.project,
        plan: props.plan,
        rows: (id) => tree.get(id),
        source: docs,
        editor,
        media: archiveMedia,
        include,
        comments: include.comments ? appComments(comments, commentsDb, { id: user.id, email: user.email }) : null,
        me: { id: user.id, email: user.email },
        gap: (id) => {
          const row = tree.get(id);
          if (!row || tree.hasUnsentCreate(id)) return null;
          return tree.contentGap(row, states.get(id)?.cursor ?? 0);
        },
        online,
        target: opened.target,
        expected: remote,
        appVersion: __APP_VERSION__,
        lastSync: engine.getStatus().lastSyncAt,
        signal: ctrl.signal,
        onProgress: (progress) => {
          // No más de 7 dibujos por segundo (miles de archivos).
          const now = Date.now();
          if (now - last < 150 && !progress.offline) return;
          last = now;
          setPhase({ at: 'working', mode, progress });
        },
      });
      await opened.finish();
      setPhase({ at: 'done', mode, result, saved: opened.saved, blob: opened.sink ? opened.sink.blob() : null, zipName });
    } catch (err) {
      await opened.discard();
      if (err instanceof ExportCancelled || isAbort(err) || ctrl.signal.aborted) setPhase({ at: 'cancelled', mode });
      else {
        console.warn('[exportar] no se pudo armar el zip', err);
        const reason = err instanceof MemoryCapExceeded ? t('exportZip.tooBig', { max: formatSize(err.cap) }) : localize(err instanceof Error ? err.message : String(err));
        setPhase({ at: 'failed', reason });
      }
    } finally {
      editor?.destroy();
      opened.crc.close();
      if (abort.current === ctrl) abort.current = null;
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
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const weight = (kind: 'image' | 'video' | 'file') =>
    estimate ? tr('exportZip.weight', { count: estimate.byKind[kind].count, size: formatSize(estimate.byKind[kind].bytes) }) : '…';
  const box = (key: keyof ZipInclude, label: string, tip: string | null, extra: ReactNode = null) => (
    <label {...(tip ? { 'data-tip': tip } : {})}>
      <input type="checkbox" checked={include[key]} onChange={(e) => setInclude({ ...include, [key]: e.target.checked })} />
      <span>{label}</span>
      {extra}
    </label>
  );

  if (phase.at === 'choose' || phase.at === 'failed') {
    const cost = porteroCost(remote.files);
    return (
      <>
        <p className="export-format">
          <span className="muted">{tr('exportZip.zipNote')}</span>
        </p>
        <div className="export-options export-zip-options">
          {box('originals', tr('exportZip.originals'), tr('exportZip.originalsTip'), <span className="muted small">{weight('image')}</span>)}
          {box('attachments', tr('exportZip.attachments'), null, <span className="muted small">{weight('file')}</span>)}
          {box('videos', tr('exportZip.videos'), null, <span className="muted small">{weight('video')}</span>)}
          {box('comments', tr('exportDialog.comments'), tr('exportZip.commentsTip'))}
        </div>
        {estimate ? (
          <p className="small export-zip-summary">
            {tr('exportZip.summary', {
              pages: tr('exportZip.pages', { count: estimate.pages }),
              files: tr('exportZip.files', { count: total.files }),
              size: formatSize(total.bytes - estimate.previews),
              previews: formatSize(estimate.previews),
            })}
          </p>
        ) : (
          <p className="muted small">{tr('exportZip.counting')}</p>
        )}
        {online && remote.files > 0 && <p className="muted small">{tr('exportZip.requests', { count: cost.requests.toLocaleString(tr.lang), percent: cost.percent })}</p>}
        {!online && remote.files > 0 && <p className="warn small">{tr('exportZip.notHere', { count: remote.files })}</p>}
        {tooBig && (
          <p className="warn small">
            {tr('exportZip.tooBig', { max: formatSize(cap) })}{' '}
            {(include.originals || include.videos) && (
              <button className="link" data-tip={tr('exportZip.lighterTip')} onClick={() => setInclude({ ...include, originals: false, videos: false })}>
                {tr('exportZip.lighter')}
              </button>
            )}
          </p>
        )}
        {props.plan.length === 0 && <p className="error">{tr('exportDialog.empty')}</p>}
        {phase.at === 'failed' && <p className="error">{tr('exportZip.failed', { reason: phase.reason })}</p>}
        <div className="modal-actions">
          <button onClick={props.onClose}>{tr('common.cancel')}</button>
          {!memory && showDirectoryPicker && (
            <button disabled={props.plan.length === 0} data-tip={tr('exportZip.toFolderTip')} onClick={() => void run('dir')}>
              {tr('exportZip.toFolder')}
            </button>
          )}
          {memory ? (
            <button className="primary" disabled={props.plan.length === 0 || tooBig} data-tip={tr('exportZip.inMemoryTip', { max: formatSize(cap) })} onClick={() => void run('memory')}>
              {tr('exportZip.inMemory')}
            </button>
          ) : (
            <button className="primary" disabled={props.plan.length === 0} data-tip={tr('exportZip.asZipTip')} onClick={() => void run('file')}>
              {tr('exportZip.asZip')}
            </button>
          )}
        </div>
      </>
    );
  }

  if (phase.at === 'working') {
    const p = phase.progress;
    const files = p?.files;
    return (
      <>
        <div className="export-progress" role="status">
          <progress max={Math.max(1, p?.total ?? props.plan.length)} value={p?.done ?? 0} />
          <span>
            {p?.step === 'comments'
              ? tr('exportDialog.fetchingComments', { done: Math.min(p.done + 1, p.total), total: p.total })
              : tr('exportDialog.preparing', {
                  done: Math.min((p?.done ?? 0) + 1, p?.total ?? props.plan.length),
                  total: p?.total ?? props.plan.length,
                  title: (p ? p.title : (props.plan[0]?.title ?? '')).trim() || tr('common.untitled'),
                })}
          </span>
          {files && files.total > 0 && (
            <span className="muted">
              {tr('exportZip.downloading', {
                done: files.done,
                total: files.total,
                sent: formatSize(files.bytesDone),
                size: formatSize(files.bytes),
              })}
            </span>
          )}
          {p?.offline && <span className="warn">{tr('exportZip.waiting')}</span>}
          <span className="muted small">{tr('exportZip.keepOpen')}</span>
        </div>
        <div className="modal-actions">
          <button onClick={(e) => e.detail < 2 && abort.current?.abort()}>{tr('common.cancel')}</button>
        </div>
      </>
    );
  }

  if (phase.at === 'cancelled') {
    return (
      <>
        <p className="small">{phase.mode === 'dir' ? tr('exportZip.cancelledDir') : tr('exportZip.cancelled')}</p>
        <div className="modal-actions">
          <button onClick={() => setPhase({ at: 'choose' })}>{tr('common.back')}</button>
          <button className="primary" onClick={props.onClose}>
            {tr('common.close')}
          </button>
        </div>
      </>
    );
  }

  const done = phase;
  const missing = done.result.missing;
  return (
    <>
      <p className="small">
        {done.mode === 'memory' ? tr('exportZip.ready') : done.mode === 'dir' ? tr('exportZip.doneDir', { name: done.saved }) : tr('exportZip.doneFile', { name: done.saved })}
      </p>
      {missing.length > 0 && (
        <div className="export-zip-missing">
          <p className="warn small">
            {tr('exportZip.missing', { count: missing.length })}{' '}
            <button className="link" onClick={() => setPhase({ ...done, list: !done.list })}>
              {done.list ? tr('exportZip.hideList') : tr('exportZip.showList')}
            </button>
          </p>
          {done.list && (
            <ul className="small">
              {missing.map((m, i) => (
                <li key={i}>{missingLine(m, done.result.lastSync)}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="modal-actions">
        <button className={done.blob && !done.blobSaved ? '' : 'primary'} onClick={props.onClose}>
          {tr('common.close')}
        </button>
        {done.blob && (
          <button
            className={done.blobSaved ? '' : 'primary'}
            onClick={() => {
              save(done.blob!, done.zipName);
              setPhase({ ...done, blobSaved: true });
            }}
          >
            {tr('exportZip.save', { name: done.zipName })}
          </button>
        )}
      </div>
    </>
  );
}

