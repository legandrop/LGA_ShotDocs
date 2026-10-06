import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { localize, t, useT } from '../i18n';
import '../i18n/lazy/exportPdf';
import '../i18n/lazy/exportZip';
import { appComments } from '../export/exportComments';
import { ExportCancelled, ExportEditor } from '../export/exportEditor';
import { exportPlan, type ExportPlanPage } from '../export/exportPages';
import {
  appArchiveMedia,
  buildZip,
  estimateZip,
  porteroCost,
  remoteOf,
  totalOf,
  zipAllowed,
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
import { dirTarget, freshFolder, memoryCap, pickers, type DirHandle, type FileHandle } from './FolderDownload';
import { porteroDownload } from './sharpImages';
import { saveBeforeExit } from './lazyPart';
import { Permissions } from '../sync/access';

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
  const services = useServices();
  const { docs, media, mediaDb } = services;
  const status = useSyncStatus();
  const online = status.online && (typeof navigator === 'undefined' || navigator.onLine !== false);
  const [include, setInclude] = useState<ZipInclude>(DEFAULT_INCLUDE);
  const [estimate, setEstimate] = useState<ZipEstimate | null>(null);
  const [phase, setPhase] = useState<Phase>({ at: 'choose' });
  const abort = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const ready = useRef<(() => boolean) | null>(null);
  const contextOf = (owner = services, chosen = props) => `${owner.user.id}|${owner.workspace.config.url}|${owner.workspace.config.localKey}|${location.pathname}|${location.search}|${chosen.kind}:${chosen.project?.id ?? chosen.plan[0]?.id ?? ''}`;
  const context = contextOf();
  const live = useRef({ services, tree, props, include, context });
  live.current = { services, tree, props, include, context };
  const selection = (plan: ExportPlanPage[], kind: string, project: string | undefined) => JSON.stringify([kind, project, plan.map((p) => [p.id, p.parent, p.depth, p.format.size, p.format.landscape])]);
  const { showSaveFilePicker, showDirectoryPicker } = pickers();
  const cap = memoryCap();
  const archiveMedia = useMemo(() => (media.enabled ? appArchiveMedia(media, mediaDb, porteroDownload(media)) : null), [media, mediaDb]);
  const busy = phase.at === 'working';

  useEffect(() => props.onBusy(busy), [busy]);
  useLayoutEffect(() => {
    mounted.current = true;
    setPhase({ at: 'choose' });
    ready.current = null;
    return () => { mounted.current = false; generation.current++; abort.current?.abort(); ready.current = null; };
  }, [services, context]);

  // Lo que pesa, al elegir el zip o cambiar qué se exporta.
  useEffect(() => {
    const ctrl = new AbortController();
    setEstimate(null);
    estimateZip(props.plan, docs, archiveMedia, ctrl.signal).then(
      (e) => !ctrl.signal.aborted && setEstimate(e),
      () => undefined,
    );
    return () => ctrl.abort();
  }, [props.plan, archiveMedia, docs, services, context]);

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

  /** El selector da sólo el handle en el gesto; el escritor y la carpeta se abren después de guardar. */
  const open = async (mode: Mode, handle: FileHandle | DirHandle | null, title: string): Promise<Opened> => {
    const crc = new CrcWorkerPool();
    const name = `${rootName(title)}.zip`;
    try {
      if (mode === 'file') {
        const file = handle as FileHandle;
        const writable = await file.createWritable();
        return {
          target: { kind: 'zip', sink: { write: (c) => writable.write(c) }, crc: () => crc.stream() },
          finish: () => writable.close(),
          discard: () => writable.abort().catch(() => undefined),
          saved: file.name,
          sink: null,
          crc,
        };
      }
      if (mode === 'dir') {
        const top: DirHandle = await freshFolder(handle as DirHandle, rootName(title));
        return { target: dirTarget(top), finish: async () => undefined, discard: async () => undefined, saved: top.name, sink: null, crc };
      }
      const sink = new BlobSink(cap);
      return { target: { kind: 'zip', sink, crc: () => crc.stream() }, finish: async () => undefined, discard: async () => undefined, saved: name, sink, crc };
    } catch (err) {
      crc.close();
      throw err;
    }
  };

  const run = async (mode: Mode) => {
    const token = ++generation.current;
    const initial = live.current;
    const ctrl = new AbortController();
    abort.current = ctrl;
    ready.current = null;
    setPhase({ at: 'working', mode, progress: null });
    const current = () => mounted.current && generation.current === token && live.current.services === initial.services && contextOf(live.current.services, live.current.props) === initial.context;
    const key = selection(initial.props.plan, initial.props.kind, initial.props.project?.id);
    let preparedKey: string | null = null;
    const pages = () => {
      const now = live.current;
      const ids = new Set(now.props.plan.map((p) => p.id));
      const target = now.props.kind === 'project' ? now.props.project?.id : now.props.plan[0]?.id;
      return target ? exportPlan(now.tree, now.props.kind, target).filter((p) => ids.has(p.id)) : [];
    };
    const metadata = () => JSON.stringify([live.current.props.project ? live.current.tree.project(live.current.props.project.id)?.name : null, pages().map((page) => [page.title, page.header])]);
    const titleReady = () => !initial.tree.titleRests().some((rest) => pages().some((page) => page.id === rest.pageId));
    const check = () => {
      if (!current() || ctrl.signal.aborted) throw new ExportCancelled();
      const now = live.current;
      if (selection(now.props.plan, now.props.kind, now.props.project?.id) !== key || selection(pages(), now.props.kind, now.props.project?.id) !== key) throw Error(t('exportZip.selectionChanged'));
      const permission = new Permissions(now.tree, now.services.access.get(), now.services.user.id);
      if (!zipAllowed(permission) || pages().some((page) => permission.pageLevel(page.id) < 1)) throw Error(t('exportDialog.empty'));
      if (preparedKey !== null && (metadata() !== preparedKey || !titleReady())) throw Error(t('exportZip.selectionChanged'));
    };
    let opened: Opened | null = null;
    let picked = false;
    let editor: ExportEditor | null = null;
    let last = 0;
    try {
      // Cesión del gesto: no hay ningún await antes de pedir el selector.
      const handle = mode === 'file' ? await showSaveFilePicker!({ suggestedName: zipName, types: [{ description: 'Zip', accept: { 'application/zip': ['.zip'] } }], id: 'shotdocs-export' }) : mode === 'dir' ? await showDirectoryPicker!({ mode: 'readwrite', id: 'shotdocs-export' }) : null;
      picked = true;
      check();
      const saved = await saveBeforeExit(initial.services, () => current() && !ctrl.signal.aborted, () => undefined, titleReady);
      check();
      if (!saved) { setPhase({ at: 'choose' }); return; }
      const now = live.current;
      const plan = pages();
      const permission = new Permissions(now.tree, now.services.access.get(), now.services.user.id);
      if (!plan.length || !zipAllowed(permission) || plan.some((page) => permission.pageLevel(page.id) < 1)) throw Error(t('exportDialog.empty'));
      const title = now.props.kind === 'project' ? (now.tree.project(now.props.project!.id)?.name ?? '') : (now.tree.get(plan[0].id)?.title ?? '');
      const project = now.props.project ? { id: now.props.project.id, name: title } : null;
      preparedKey = metadata();
      const { docs, media, mediaDb, comments, commentsDb, user, engine } = now.services;
      const include = { ...now.include };
      const online = engine.getStatus().online && navigator.onLine !== false;
      const archive = media.enabled ? appArchiveMedia(media, mediaDb, porteroDownload(media)) : null;
      const measured = await estimateZip(plan, docs, archive, ctrl.signal);
      check();
      const total = totalOf(measured, include);
      const bytes = total.bytes + plan.length * 40_000 + zipOverhead([], (plan.length * 4 + total.files * 2) * 2);
      if (mode === 'memory' && bytes > cap) throw new MemoryCapExceeded(cap);
      opened = await open(mode, handle, title);
      check();
      const target = opened.target.kind === 'zip'
        ? { ...opened.target, sink: { write: (chunk: Uint8Array) => { check(); return (opened!.target as Extract<DownloadTarget, { kind: 'zip' }>).sink.write(chunk); } } }
        : {
            ...opened.target,
            makeDir: async (path: string) => { check(); await (opened!.target as Extract<DownloadTarget, { kind: 'dir' }>).makeDir(path); check(); },
            makeFile: async (path: string) => {
              check();
              const writer = await (opened!.target as Extract<DownloadTarget, { kind: 'dir' }>).makeFile(path);
              try { check(); } catch (err) { await writer.abort(); throw err; }
              return { ...writer, write: (chunk: Uint8Array) => { check(); return writer.write(chunk); }, close: async () => { check(); await writer.close(); check(); } };
            },
          };
      const withMedia = media.enabled;
      editor = await ExportEditor.create({
        lang: tr.lang,
        resolveFileUrl: withMedia ? (url, pageId) => media.resolve(url, pageId) : undefined,
        media: withMedia ? media : null,
      });
      check();
      const states = await docs.states();
      check();
      const result = await buildZip({
        title,
        kind: now.props.kind,
        project,
        plan,
        rows: (id) => now.tree.get(id),
        source: docs,
        editor,
        media: archive,
        include,
        comments: include.comments ? appComments(comments, commentsDb, { id: user.id, email: user.email }) : null,
        me: { id: user.id, email: user.email },
        gap: (id) => {
          const row = now.tree.get(id);
          if (!row || now.tree.hasUnsentCreate(id)) return null;
          return now.tree.contentGap(row, states.get(id)?.cursor ?? 0);
        },
        online,
        target,
        expected: remoteOf(measured, include),
        appVersion: __APP_VERSION__,
        lastSync: engine.getStatus().lastSyncAt,
        signal: ctrl.signal,
        onProgress: (progress) => {
          if (!current() || ctrl.signal.aborted) return;
          // No más de 7 dibujos por segundo (miles de archivos).
          const now = Date.now();
          if (now - last < 150 && !progress.offline) return;
          last = now;
          setPhase({ at: 'working', mode, progress });
        },
      });
      check();
      await opened.finish();
      check();
      ready.current = () => { try { check(); return true; } catch { return false; } };
      setPhase({ at: 'done', mode, result, saved: opened.saved, blob: opened.sink ? opened.sink.blob() : null, zipName: `${rootName(title)}.zip` });
    } catch (err) {
      await opened?.discard();
      if (!current()) return;
      if (!picked && isAbort(err) && !ctrl.signal.aborted) { setPhase({ at: 'choose' }); return; }
      if (err instanceof ExportCancelled || isAbort(err) || ctrl.signal.aborted) setPhase({ at: 'cancelled', mode });
      else {
        console.warn('[exportar] no se pudo armar el zip', err);
        const reason = err instanceof MemoryCapExceeded ? t('exportZip.tooBig', { max: formatSize(err.cap) }) : localize(err instanceof Error ? err.message : String(err));
        setPhase({ at: 'failed', reason });
      }
    } finally {
      editor?.destroy();
      opened?.crc.close();
      if (abort.current === ctrl) abort.current = null;
    }
  };

  const save = (blob: Blob, fileName: string) => {
    if (!ready.current?.()) return;
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
            {!p ? tr('exportZip.preparingLocal') : p.step === 'comments'
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
          <button onClick={(e) => { if (e.detail >= 2) return; abort.current?.abort(); generation.current++; setPhase({ at: 'cancelled', mode: phase.mode }); }}>{tr('common.cancel')}</button>
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
              if (!ready.current?.()) return;
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
