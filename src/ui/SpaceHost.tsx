import { useEffect, useRef, useState } from 'react';
import { t, useT } from '../i18n';
import { formatSize } from '../media/fileTrash';
import type { MarkView } from '../media/offline';
import { useOffline, useServices } from '../services';
import { OfflineMarkIcon } from './icons';
import { OfflineDialog, StorageDialog } from './lazyDialogs';
import { Part } from './lazyPart';
import { notify } from './notice';

// El espacio de la app en el dispositivo y "Available offline" (P.10, Docs/Doc_Copias_Locales.md): lo que está
// siempre montado. Las ventanas se abren desde cualquier menú con `openOffline` y `openStorage`, y se bajan aparte.

const OPEN = 'shotdocs:space';

type Request = { kind: 'offline'; target: 'page' | 'project'; id: string } | { kind: 'storage' };

/** Abre la ventana "Available offline" de una página (con sus subpáginas) o de un proyecto. */
export function openOffline(target: 'page' | 'project', id: string): void {
  window.dispatchEvent(new CustomEvent<Request>(OPEN, { detail: { kind: 'offline', target, id } }));
}

/** Abre "Storage on this device". */
export function openStorage(): void {
  window.dispatchEvent(new CustomEvent<Request>(OPEN, { detail: { kind: 'storage' } }));
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
      const freed = await offline.freeUp(prompt.reason === 'room' ? 'room' : prompt.reason === 'limit' ? 'over' : 'all');
      notify(t('space.freed', { size: formatSize(freed, tr.lang) }));
    } finally {
      setFreeing(false);
    }
  }

  const close = () => setOpen(null);
  return (
    <>
      {prompt && !open && (
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
                ? tr('space.promptRoom', { needed: formatSize(prompt.needed, tr.lang), free: formatSize(prompt.free, tr.lang) })
                : tr('space.promptMark', { free: formatSize(prompt.free, tr.lang) })}
          </span>
          <span className="space-notice-actions">
            <button className="primary" disabled={freeing} onClick={() => void free()}>
              {tr('space.freeUp')}
            </button>
            <button className="link" onClick={() => setOpen({ kind: 'storage' })}>
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
          <StorageDialog onClose={close} onEdit={(m) => setOpen({ kind: 'offline', target: m.kind, id: m.target })} />
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
