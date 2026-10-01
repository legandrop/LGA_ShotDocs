import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { localize, useT } from '../i18n';
import '../i18n/lazy/folders';
import { formatSize } from '../media/fileTrash';
import { foldersFromList, summarize, withHidden, type FolderSource } from '../media/folderRead';
import type { FolderProgress, FolderUploads } from '../media/folderUpload';
import { useServices } from '../services';

// La ventana de las carpetas (P.9, Docs/Doc_Carpetas.md, sección 7): antes de subir, "esta carpeta, con todo
// esto" (cuántos archivos, en cuántas carpetas, cuánto pesan, por tipo, el árbol, lo salteado y los avisos);
// durante, cómo va, con pausar, seguir, reintentar y, si se cerró la pestaña, volver a elegir la carpeta.

/** Lo más que se dibuja del árbol (una carpeta de miles de archivos no traba la ventana). */
const TREE_MAX = 300;

/** Antes de subir: las carpetas soltadas y la casilla de los ocultos. */
export function FolderAskDialog({
  sources,
  onConfirm,
  onCancel,
}: {
  sources: FolderSource[];
  onConfirm: (sources: FolderSource[]) => void;
  onCancel: () => void;
}) {
  const tr = useT();
  const { media } = useServices();
  const [hidden, setHidden] = useState(false);
  // El portero tiene que saber de carpetas (uno anterior no): se pregunta al abrir la ventana.
  const [server, setServer] = useState<'checking' | 'ok' | 'old' | 'offline'>('checking');
  useEffect(() => {
    let alive = true;
    const portero = media.porteroClient() as { status?: () => Promise<{ features?: string[] }> } | null;
    if (!portero?.status) {
      setServer('old');
      return;
    }
    portero
      .status()
      .then((s) => alive && setServer(s.features?.includes('folders') ? 'ok' : 'old'))
      .catch(() => alive && setServer('offline'));
    return () => {
      alive = false;
    };
  }, [media]);
  useEscape(onCancel);

  const shown = useMemo(() => (hidden ? sources.map(withHidden) : sources), [sources, hidden]);
  const hasHidden = sources.some((s) => s.skipped.some((k) => k.reason !== 'unreadable'));

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal folder-dialog" role="dialog" aria-modal="true" aria-label={tr('folders.askTitle', { count: sources.length })} onClick={(e) => e.stopPropagation()}>
        <h2>{tr('folders.askTitle', { count: sources.length })}</h2>
        <div className="folder-dialog-body">
          {shown.map((source, i) => (
            <FolderSummaryRow key={i} source={source} />
          ))}
          {hasHidden && (
            <label className="folder-check">
              <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> {tr('folders.includeHidden')}
            </label>
          )}
          <p className="muted small">{tr('folders.where')}</p>
          <p className="muted small">{tr('folders.keepOpen')}</p>
          {server === 'old' && <p className="error">{tr('folders.oldServer')}</p>}
          {server === 'offline' && <p className="error">{tr('folders.offline')}</p>}
        </div>
        <div className="modal-actions folder-actions">
          <button className="button" onClick={onCancel}>
            {tr('common.cancel')}
          </button>
          <button className="button primary" disabled={server !== 'ok'} onClick={() => onConfirm(shown)}>
            {server === 'checking' ? tr('folders.checking') : tr('folders.upload')}
          </button>
        </div>
      </div>
    </div>
  );
}

function FolderSummaryRow({ source }: { source: FolderSource }) {
  const tr = useT();
  const sum = summarize(source);
  const skipped = source.skipped.filter((s) => s.reason !== 'unreadable').length;
  const unreadable = source.skipped.length - skipped;
  return (
    <section className="folder-summary">
      <div className="folder-summary-name">
        <FolderGlyph /> <strong>{source.name}</strong>
      </div>
      <p className="folder-summary-counts">
        {tr('folders.counts', {
          files: tr('folders.files', { count: sum.files }),
          dirs: tr('folders.dirs', { count: sum.dirs }),
          size: formatSize(sum.bytes),
        })}
      </p>
      <p className="muted small">
        {tr('folders.kinds', { images: sum.byKind.image, videos: sum.byKind.video, pdfs: sum.byKind.pdf, other: sum.byKind.other })}
      </p>
      {sum.files > 1000 && <p className="warn small">{tr('folders.manyFiles')}</p>}
      {sum.big > 0 && <p className="warn small">{tr('folders.bigFiles', { count: sum.big })}</p>}
      {skipped > 0 && (
        <details className="folder-skipped">
          <summary className="muted small">{tr('folders.skipped', { count: skipped })}</summary>
          <ul>
            {source.skipped
              .filter((s) => s.reason !== 'unreadable')
              .slice(0, TREE_MAX)
              .map((s) => (
                <li key={s.path}>{s.path}</li>
              ))}
          </ul>
        </details>
      )}
      {unreadable > 0 && <p className="warn small">{tr('folders.unreadable', { count: unreadable })}</p>}
      <details className="folder-tree">
        <summary className="small">{tr('folders.showTree')}</summary>
        <FolderTree source={source} />
      </details>
    </section>
  );
}

interface TreeNode {
  name: string;
  dirs: Map<string, TreeNode>;
  files: { name: string; size: number }[];
}

/** El árbol plegable: primero las carpetas, después los archivos, hasta `TREE_MAX` renglones. */
function FolderTree({ source }: { source: FolderSource }) {
  const tr = useT();
  const root = useMemo(() => {
    const top: TreeNode = { name: source.name, dirs: new Map(), files: [] };
    const nodeAt = (path: string): TreeNode => {
      let node = top;
      for (const part of path ? path.split('/') : []) {
        let next = node.dirs.get(part);
        if (!next) {
          next = { name: part, dirs: new Map(), files: [] };
          node.dirs.set(part, next);
        }
        node = next;
      }
      return node;
    };
    for (const d of source.dirs) nodeAt(d);
    for (const f of source.files) {
      const at = f.path.lastIndexOf('/');
      nodeAt(at < 0 ? '' : f.path.slice(0, at)).files.push({ name: f.path.slice(at + 1), size: f.file.size });
    }
    return top;
  }, [source]);
  let budget = TREE_MAX;
  const render = (node: TreeNode, depth: number): React.ReactNode[] => {
    const rows: React.ReactNode[] = [];
    for (const child of [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
      if (budget-- <= 0) break;
      rows.push(
        <li key={`d:${depth}:${child.name}`}>
          <details open={depth < 1}>
            <summary>
              <FolderGlyph /> {child.name}
            </summary>
            <ul>{render(child, depth + 1)}</ul>
          </details>
        </li>,
      );
    }
    for (const f of node.files) {
      if (budget-- <= 0) break;
      rows.push(
        <li key={`f:${f.name}`} className="folder-tree-file">
          {f.name} <span className="muted">{formatSize(f.size)}</span>
        </li>,
      );
    }
    return rows;
  };
  const rows = render(root, 0);
  const total = source.dirs.length + source.files.length;
  return (
    <ul className="folder-tree-list">
      {rows}
      {total > TREE_MAX && <li className="muted">{tr('folders.treeMore', { count: total - TREE_MAX })}</li>}
    </ul>
  );
}

/** Durante: cómo va la subida de una carpeta de este dispositivo. */
export function FolderProgressDialog({ id, onClose, onOpen }: { id: string; onClose: () => void; onOpen: () => void }) {
  const tr = useT();
  const { folders } = useServices();
  const progress = useFolderProgress(folders, id);
  const picker = useRef<HTMLInputElement>(null);
  const [matched, setMatched] = useState<string | null>(null);
  useEscape(onClose);
  if (!folders || !progress) return null;
  const p = progress;
  const pct = p.bytes > 0 ? Math.min(100, Math.round((p.doneBytes / p.bytes) * 100)) : p.files ? Math.round((p.doneFiles / p.files) * 100) : 100;

  const chosen = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const [source] = foldersFromList(list);
    const found = source ? folders.resumeWith(id, source) : 0;
    setMatched(found > 0 ? tr('folders.matched', { count: found }) : tr('folders.noMatch'));
  };

  let status: string;
  if (p.state === 'done') status = tr('folders.done');
  else if (p.state === 'paused') status = tr('folders.paused');
  else if (p.state === 'preparing') status = tr('folders.preparing');
  else if (p.state === 'waiting' && p.problem) status = tr('folders.waiting', { reason: localize(p.problem) });
  else if (p.state === 'missing') status = tr('folders.missing', { count: p.missing });
  else status = p.eta !== null ? tr('folders.eta', { time: duration(p.eta, tr) }) : '';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal folder-dialog" role="dialog" aria-modal="true" aria-label={tr('folders.uploadingTitle')} onClick={(e) => e.stopPropagation()}>
        <h2>
          <FolderGlyph /> {p.name}
        </h2>
        <p className="muted small">{tr('folders.uploadingTitle')}</p>
        <div className="folder-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div style={{ width: `${pct}%` }} />
        </div>
        <p className="small">
          {tr('folders.progress', { done: p.doneFiles, total: p.files, sent: formatSize(p.doneBytes), size: formatSize(p.bytes) })}
        </p>
        {status && <p className={p.state === 'missing' ? 'warn small' : 'muted small'}>{status}</p>}
        {p.problem && p.state !== 'waiting' && <p className="error small">{localize(p.problem)}</p>}
        {matched && <p className="muted small">{matched}</p>}
        {p.errors.length > 0 && (
          <details className="folder-errors" open={p.errors.length <= 5}>
            <summary className="error small">{tr('folders.errors', { count: p.errors.length })}</summary>
            <ul>
              {p.errors.slice(0, TREE_MAX).map((e) => (
                <li key={e.path}>
                  {e.path}: <span className="muted">{localize(e.error)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        <input
          ref={picker}
          type="file"
          hidden
          multiple
          {...({ webkitdirectory: '' } as Record<string, string>)}
          onChange={(e) => {
            chosen(e.target.files);
            e.target.value = '';
          }}
        />
        <div className="modal-actions folder-actions">
          {p.state === 'missing' && (
            <button className="button" onClick={() => picker.current?.click()}>
              {tr('folders.chooseAgain')}
            </button>
          )}
          {(p.errors.length > 0 || (p.problem && p.state !== 'waiting')) && (
            <button className="button" onClick={() => folders.retry(id)}>
              {tr('folders.retry')}
            </button>
          )}
          {p.state !== 'done' && p.state !== 'missing' && (
            p.state === 'paused' ? (
              <button className="button" onClick={() => folders.resume(id)}>
                {tr('folders.resume')}
              </button>
            ) : (
              <button className="button" onClick={() => folders.pause(id)}>
                {tr('folders.pause')}
              </button>
            )
          )}
          <button className="button" onClick={onOpen}>
            {tr('folders.openFolder')}
          </button>
          <button className="button primary" data-tip={p.state === 'done' ? undefined : tr('folders.closeTip')} onClick={onClose}>
            {tr('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Cómo va una carpeta, y se vuelve a dibujar con cada cambio. */
export function useFolderProgress(folders: FolderUploads | undefined, id: string): FolderProgress | null {
  useSyncExternalStore(folders?.subscribe ?? noSubscribe, folders?.getRevision ?? noRevision);
  return folders?.progress(id) ?? null;
}

const noSubscribe = () => () => undefined;
const noRevision = () => 0;

function duration(seconds: number, tr: ReturnType<typeof useT>): string {
  if (seconds < 90) return tr('folders.seconds', { count: Math.max(1, Math.round(seconds)) });
  return tr('folders.minutes', { count: Math.round(seconds / 60) });
}

function useEscape(onClose: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

export function FolderGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg className="folder-glyph" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1.5 4a1 1 0 0 1 1-1h3.6l1.4 1.5h6a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" fill="#e2bd5c" stroke="#b8923a" />
    </svg>
  );
}
