import { cloneElement, isValidElement, useEffect, useRef, useState, type ReactNode } from 'react';
import type * as Y from 'yjs';
import { useT, type Key } from '../i18n';
import '../i18n/lazy/carrete';
import { useLinkMode } from '../linkMode';
import { prepareMarkupRaster, rasterLimits, rasterSnapshot, RasterError, type RasterFailure, type RasterResult } from '../media/markupRaster';
import { DownloadIcon } from './icons';
import { detectPlatform, isMobilePlatform } from './install';
import type { CarreteLoader } from './carreteLoader';
import type { CarreteItem } from './carreteModel';
import { canCopyImage, checkCopyPng, copyImage } from './clipboardImage';

type Scope = { url: string; id: CarreteItem['mediaId']; map: Y.Map<unknown>; loader: CarreteLoader; link: unknown };
type Ready = { result: RasterResult; isCurrent: () => boolean; revision: number; scope: Scope; denied?: boolean };
type State = { at: 'idle' | 'busy' | 'writing' | 'copied' } | { at: 'failed'; key: Key } | ({ at: 'ready' } & Ready);
const errorKey: Record<RasterFailure, Key> = {
  unsupported: 'carrete.copy.format', size: 'carrete.copy.size', annotations: 'carrete.copy.annotations',
  source: 'carrete.copy.source', encode: 'carrete.copy.encode',
};
const CopyIcon = ({ size }: { size: number }) => <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6.5 6.5h10v10h-10zM13.5 6.5v-3h-10v10h3" /></svg>;

/** Preparar no escribe: sólo Copy, con PNG listo, autoriza el envío externo. */
export function AnnotatedCopy({ item, map, loader, original }: { item: CarreteItem; map: Y.Map<unknown>; loader: CarreteLoader; original: ReactNode }) {
  const tr = useT(), link = useLinkMode();
  const [open, setOpen] = useState(false), [state, setState] = useState<State>({ at: 'idle' }), [, revised] = useState(0);
  const running = useRef<AbortController | null>(null), generation = useRef(0), revision = useRef(0), phase = useRef<State['at']>('idle');
  const current = useRef<Scope>({ url: item.url, id: item.mediaId, map, loader, link });
  current.current = { url: item.url, id: item.mediaId, map, loader, link };
  const matches = (s: Scope) => !current.current.link && current.current.url === s.url && current.current.id === s.id && current.current.map === s.map && current.current.loader === s.loader;
  const transition = (s: State) => { phase.current = s.at; setState(s); };
  useEffect(() => {
    const update = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
      const id = item.mediaId;
      const relevant = !!id && events.some((e) => e.path.length ? typeof e.path[0] === 'string' && (e.path[0] === id || e.path[0].startsWith(`${id}/`)) : [...e.changes.keys.keys()].some((k) => k === id || k.startsWith(`${id}/`)));
      if (relevant) {
        revision.current++;
        if (phase.current === 'busy' || phase.current === 'ready') {
          generation.current++; running.current?.abort(); running.current = null;
          phase.current = 'failed'; setState({ at: 'failed', key: 'carrete.copy.changed' });
        }
      }
      revised((n) => n + 1);
    };
    map.observeDeep(update);
    return () => map.unobserveDeep(update);
  }, [map, item.mediaId]);
  useEffect(() => {
    phase.current = 'idle'; setState({ at: 'idle' }); setOpen(false);
    return () => { generation.current++; running.current?.abort(); running.current = null; };
  }, [item.url, item.mediaId, map, loader, link]);
  const fileId = item.mediaId;
  if (link || !fileId || !loader.annotatedOriginal || ![...map.keys()].some((key) => key.startsWith(`${fileId}/`))) return null;

  const prepare = async () => {
    if (phase.current === 'busy' || phase.current === 'writing' || current.current.link || !loader.annotatedOriginal) return;
    setOpen(true);
    if (!canCopyImage()) { transition({ at: 'failed', key: 'carrete.copy.unsupported' }); return; }
    const token = ++generation.current, scope = current.current, atRevision = revision.current;
    const controller = new AbortController(); running.current = controller;
    const timeout = setTimeout(() => controller.abort(new RasterError('source')), 60_000);
    transition({ at: 'busy' });
    try {
      const photo = rasterSnapshot(map, fileId), mobile = isMobilePlatform(detectPlatform());
      const source = await loader.annotatedOriginal(item, controller.signal, rasterLimits(mobile).bytes);
      const result = await prepareMarkupRaster(source.blob, source.name, photo, mobile, controller.signal, 'png');
      await checkCopyPng(result.blob, result.width, result.height, controller.signal);
      controller.signal.throwIfAborted();
      if (token !== generation.current || !matches(scope)) return;
      if (atRevision !== revision.current) throw new RasterError('annotations');
      if (!source.isCurrent()) throw new RasterError('source');
      transition({ at: 'ready', result, isCurrent: source.isCurrent, revision: atRevision, scope });
    } catch (error) {
      if (token === generation.current && matches(scope) && (!controller.signal.aborted || controller.signal.reason instanceof RasterError)) transition({ at: 'failed', key: error instanceof RasterError ? errorKey[error.reason] : 'carrete.copy.source' });
    } finally { clearTimeout(timeout); if (running.current === controller) running.current = null; }
  };
  const close = () => { generation.current++; running.current?.abort(); running.current = null; transition({ at: 'idle' }); setOpen(false); };
  const copy = () => {
    if (phase.current !== 'ready' || state.at !== 'ready' || !matches(state.scope)) return;
    if (revision.current !== state.revision) { transition({ at: 'failed', key: 'carrete.copy.changed' }); return; }
    if (!state.isCurrent()) { transition({ at: 'failed', key: 'carrete.copy.source' }); return; }
    if (!canCopyImage()) { transition({ at: 'failed', key: 'carrete.copy.unsupported' }); return; }
    const token = generation.current, ready = state;
    transition({ at: 'writing' });
    // No await antes de write. Desde este punto Close no puede revocar el portapapeles.
    void copyImage(ready.result.blob).then(
      () => { if (token === generation.current && matches(ready.scope)) transition({ at: 'copied' }); },
      () => { if (token === generation.current && matches(ready.scope)) {
        if (revision.current !== ready.revision) transition({ at: 'failed', key: 'carrete.copy.changed' });
        else if (!ready.isCurrent()) transition({ at: 'failed', key: 'carrete.copy.source' });
        else transition({ ...ready, at: 'ready', denied: true });
      } },
    );
  };
  return <div className="annotated-download annotated-copy">
    <button className="carrete-btn" aria-label={tr('carrete.copy.withAnnotations')} aria-expanded={open} onClick={() => { if (open) close(); else void prepare(); }}><CopyIcon size={20} /><span className="carrete-btn-label">{tr('carrete.copy.withAnnotations')}</span></button>
    {open && <div className="annotated-download-menu" role="group" aria-label={tr('carrete.copy.withAnnotations')}>
      {state.at === 'busy' && <p role="status">{tr('common.preparing')}</p>}
      {state.at === 'writing' && <p role="status">{tr('carrete.copy.writing')}</p>}
      {state.at === 'copied' && <p role="status">{tr('carrete.copy.copied')}</p>}
      {state.at === 'failed' && <p role="alert">{tr(state.key)}</p>}
      {state.at === 'ready' && <><p>{state.result.name}<br />{state.result.width} × {state.result.height}</p>{state.denied && <p role="alert">{tr('carrete.copy.denied')}</p>}<button className="carrete-notice-btn" onClick={copy}>{tr('carrete.copy.action')}</button></>}
      {isValidElement<{ children?: ReactNode }>(original) ? cloneElement(original, { children: <><DownloadIcon size={20} />{tr('carrete.original')}</> }) : original}
      <button className="carrete-notice-btn" onClick={close}>{tr('common.close')}</button>
    </div>}
  </div>;
}
