import { useEffect, useRef, useState } from 'react';
import { t, useT, type Translate } from '../i18n';
import { formatSize } from '../media/fileTrash';
import type { FreeReport, MarkView, OwnSkip } from '../media/offline';
import { useOffline, useServices } from '../services';
import { OfflineMarkIcon } from './icons';
import { OfflineDialog, StorageDialog } from './lazyDialogs';
import { Part } from './lazyPart';
import { notify } from './notice';

// El espacio de la app en el dispositivo y "Available offline" (P.10, Docs/Doc_Copias_Locales.md): lo que está
// siempre montado. Las ventanas se abren desde cualquier menú con `openOffline` y `openStorage`, y se bajan aparte.

const OPEN = 'shotdocs:space';

/**
 * "Available offline" necesita Web Locks (una sola pestaña escribe la base: sección 2.1 del diseño). Sin eso
 * (Safari anterior a 15.4), la opción no aparece.
 */
export function offlineSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.locks;
}

type Request = { kind: 'offline'; target: 'page' | 'project'; id: string } | { kind: 'storage'; list?: boolean };

/** Abre la ventana "Available offline" de una página (con sus subpáginas) o de un proyecto. */
export function openOffline(target: 'page' | 'project', id: string): void {
  window.dispatchEvent(new CustomEvent<Request>(OPEN, { detail: { kind: 'offline', target, id } }));
}

/** Abre "Storage on this device". */
export function openStorage(): void {
  window.dispatchEvent(new CustomEvent<Request>(OPEN, { detail: { kind: 'storage' } }));
}

/** Por qué quedó un original propio, en el orden en que se dice. */
const SKIPS: [OwnSkip, Parameters<Translate>[0]][] = [
  ['offline', 'space.skip.offline'],
  ['server', 'space.skip.server'],
  ['notInDrive', 'space.skip.notInDrive'],
  ['trash', 'space.skip.trash'],
  ['mismatch', 'space.skip.mismatch'],
  ['changed', 'space.skip.changed'],
  ['noAnswer', 'space.skip.noAnswer'],
];

/**
 * Lo que dice *Free up* al terminar: cuánto se liberó y, si algún original agregado en este dispositivo quedó, cuántos y
 * por qué ("2 files stayed on this device: not in Drive (1), no connection (1).").
 */
export function freedText(report: FreeReport, tr: Translate): string {
  const freed = tr('space.freed', { size: formatSize(report.freed, tr.lang) });
  const count = SKIPS.reduce((n, [why]) => n + (report.skipped[why] ?? 0), 0);
  if (count === 0) return freed;
  const reasons = SKIPS.filter(([why]) => report.skipped[why])
    .map(([why, key]) => `${tr(key)} (${report.skipped[why]})`)
    .join(', ');
  return `${freed} ${tr('space.keptSome', { count, reasons })}`;
}

/**
 * Las ventanas, el aviso del tope (nunca se libera nada sin el sí: D-25) y el aviso de "listo para usar sin
 * conexión" cuando una marca termina con su ventana cerrada.
 */
export function SpaceHost() {
  const { offline } = useServices();
  const snapshot = useOffline();
  const tr = useT();
  const [open, setOpen] = useState<Request | null>(null);
  const [freeing, setFreeing] = useState(false);
  const states = useRef(new Map<string, MarkView['state']>());

  useEffect(() => {
    const onOpen = (e: Event) => setOpen((e as CustomEvent<Request>).detail);
    window.addEventListener(OPEN, onOpen);
    return () => window.removeEventListener(OPEN, onOpen);
  }, []);

  // "Listo" cuando termina de bajar (la ventana abierta ya lo dice).
  useEffect(() => {
    for (const mark of snapshot.marks) {
      const before = states.current.get(mark.id);
      const showing = open?.kind === 'offline' && open.id === mark.target;
      if (before === 'downloading' && mark.state === 'ready' && !showing) notify(t('space.readyNotice', { title: mark.title }));
      states.current.set(mark.id, mark.state);
    }
  }, [snapshot.marks, open]);

  const prompt = snapshot.prompt;
  async function free() {
    if (!prompt) return;
    setFreeing(true);
    try {
      await offline.freeUp(prompt.reason === 'limit' ? 'over' : prompt.reason === 'room' ? 'room' : 'all');
      const report = offline.getSnapshot().report;
      if (report) notify(freedText(report, tr));
    } finally {
      setFreeing(false);
    }
  }

  /** Un archivo nuevo que no entró: compartirlo (en el iPhone, "Guardar imagen") o bajarlo, así no se pierde. */
  async function saveUnsaved(index: number) {
    const file = offline.peekUnsaved(index);
    if (!file) return;
    const named = file instanceof File ? file : new File([file], file.name || 'file', { type: file.type });
    const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
    try {
      if (nav.canShare?.({ files: [named] }) && nav.share) {
        await nav.share({ files: [named] });
      } else {
        const url = URL.createObjectURL(named);
        const a = document.createElement('a');
        a.href = url;
        a.download = named.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      offline.takeUnsaved(index);
    } catch {
      // Se canceló la hoja de compartir: el archivo sigue en la lista.
    }
  }

  const close = () => setOpen(null);
  const unsaved = snapshot.unsaved[0];
  return (
    <>
      {unsaved && (
        <div className="notice space-notice unsaved-notice" role="alert">
          <span>
            {tr('space.unsaved', { name: unsaved.name || '—', size: formatSize(unsaved.size, tr.lang) })}
            {prompt?.reason === 'room' && (
              <>
                <br />
                {tr('space.promptRoomShort', { free: formatSize(prompt.free, tr.lang) })}
              </>
            )}
          </span>
          <span className="space-notice-actions">
            <button className="primary" onClick={() => void saveUnsaved(0)}>
              {tr('space.saveFile')}
            </button>
            {prompt?.reason === 'room' && (
              // Los originales agregados acá que ya están en Drive (nunca se liberan sin este sí: sección 5.7).
              <button className="secondary" style={{ whiteSpace: 'nowrap' }} disabled={freeing} onClick={() => void free()}>
                {tr('space.freeRoom', { size: formatSize(prompt.free, tr.lang) })}
              </button>
            )}
            <button className="link" onClick={() => offline.takeUnsaved(0)}>
              {tr('space.discardFile')}
            </button>
          </span>
        </div>
      )}
      {prompt && !open && !unsaved && (
        <div className="notice space-notice" role="status">
          <span>
            {prompt.first && prompt.limit !== null && (
              <>
                {tr('space.promptFirst', { limit: formatSize(prompt.limit, tr.lang) })}
                <br />
              </>
            )}
            {prompt.reason === 'limit' && prompt.limit !== null
              ? tr('space.promptLimit', {
                  kept: formatSize(prompt.kept, tr.lang),
                  limit: formatSize(prompt.limit, tr.lang),
                  free: formatSize(prompt.free, tr.lang),
                })
              : prompt.reason === 'room'
                ? tr('space.promptRoom', { free: formatSize(prompt.free, tr.lang) })
                : tr('space.promptMark', { free: formatSize(prompt.free, tr.lang) })}
          </span>
          <span className="space-notice-actions">
            <button className="primary" disabled={freeing} onClick={() => void free()}>
              {tr('space.freeUp')}
            </button>
            <button className="link" onClick={() => setOpen({ kind: 'storage', list: true })}>
              {tr('space.showWhat')}
            </button>
            <button className="link" onClick={() => void offline.snooze()}>
              {tr('space.notNow')}
            </button>
          </span>
        </div>
      )}
      {open?.kind === 'offline' && (
        <Part onClose={close}>
          <OfflineDialog kind={open.target} target={open.id} onClose={close} onStorage={() => setOpen({ kind: 'storage' })} />
        </Part>
      )}
      {open?.kind === 'storage' && (
        <Part onClose={close}>
          <StorageDialog
            onClose={close}
            onEdit={(m) => setOpen({ kind: 'offline', target: m.kind, id: m.target })}
            showList={open.list === true}
          />
        </Part>
      )}
    </>
  );
}

/** En la barra lateral, debajo del estado: "Downloading for offline: 340 of 620" mientras baja. */
export function OfflineLine() {
  const snapshot = useOffline();
  const tr = useT();
  const mark = snapshot.marks.find((m) => m.id === snapshot.active && m.total > 0);
  if (!mark) return null;
  return (
    <button className="offline-line" onClick={() => openOffline(mark.kind, mark.target)}>
      <OfflineMarkIcon size={14} />
      {tr('space.downloading', { done: mark.done, total: mark.total })}
    </button>
  );
}

/** El ícono de una página o un proyecto marcado, con su estado en el `data-tip`. */
export function OfflineBadge(props: { kind: 'page' | 'project'; id: string }) {
  const snapshot = useOffline();
  const tr = useT();
  const mark = snapshot.marks.find((m) => m.kind === props.kind && m.target === props.id);
  if (!mark) return null;
  const tip =
    mark.state === 'noSpace'
      ? tr('sidebar.offlineNoSpace')
      : mark.state === 'downloading' && mark.total > 0
        ? tr('space.downloading', { done: mark.done, total: mark.total })
        : mark.state === 'ready'
          ? tr('sidebar.offlineReady')
          : tr('sidebar.offlineWaiting');
  return (
    <span className={`offline-badge ${mark.state}`} data-tip={tip} aria-label={tip} role="img">
      <OfflineMarkIcon size={13} />
    </span>
  );
}
