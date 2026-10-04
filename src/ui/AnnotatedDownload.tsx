import { cloneElement, isValidElement, useEffect, useRef, useState, type ReactNode } from 'react';
import type * as Y from 'yjs';
import { useT, type Key } from '../i18n';
import '../i18n/lazy/carrete';
import { useLinkMode } from '../linkMode';
import { prepareMarkupRaster, rasterLimits, rasterSnapshot, RasterError, type RasterFailure, type RasterResult } from '../media/markupRaster';
import { DownloadIcon } from './icons';
import { detectPlatform, isMobilePlatform } from './install';
import { startDownload, type CarreteLoader } from './carreteLoader';
import type { CarreteItem } from './carreteModel';

type State = { at: 'idle' } | { at: 'busy' } | { at: 'failed'; reason: RasterFailure } | { at: 'ready'; result: RasterResult; isCurrent: () => boolean };
const errorKey: Record<RasterFailure, Key> = {
  unsupported: 'carrete.raster.unsupported', size: 'carrete.raster.size', annotations: 'carrete.raster.annotations',
  source: 'carrete.raster.source', encode: 'carrete.raster.encode',
};
/** Menú del carrete: el último clic descarga un Blob ya listo, también en Safari. */
export function AnnotatedDownload({ item, map, loader, original }: { item: CarreteItem; map: Y.Map<unknown>; loader: CarreteLoader; original: ReactNode }) {
  const tr = useT(), link = useLinkMode();
  const [open, setOpen] = useState(false), [state, setState] = useState<State>({ at: 'idle' }), [, revised] = useState(0);
  const running = useRef<AbortController | null>(null), context = useRef(link);
  context.current = link;
  useEffect(() => {
    const update = () => revised((n) => n + 1);
    map.observeDeep(update);
    return () => map.unobserveDeep(update);
  }, [map]);
  useEffect(() => {
    setState({ at: 'idle' }); setOpen(false);
    return () => { running.current?.abort(); running.current = null; };
  }, [item.url, item.mediaId, loader, map, link]);
  const fileId = item.mediaId;
  const hasShapes = !!fileId && [...map.keys()].some((key) => key.startsWith(`${fileId}/`));
  if (link || !fileId || !hasShapes || !loader.annotatedOriginal) return <>{original}</>;
  let compatible = true;
  try { rasterSnapshot(map, fileId); } catch { compatible = false; }

  const prepare = async () => {
    if (context.current || running.current || !loader.annotatedOriginal) return;
    const controller = new AbortController(); running.current = controller;
    const timeout = setTimeout(() => controller.abort(new RasterError('source')), 60_000);
    setState({ at: 'busy' });
    try {
      const photo = rasterSnapshot(map, fileId);
      const mobile = isMobilePlatform(detectPlatform());
      const source = await loader.annotatedOriginal(item, controller.signal, rasterLimits(mobile).bytes);
      const result = await prepareMarkupRaster(source.blob, source.name, photo, mobile, controller.signal);
      controller.signal.throwIfAborted();
      if (context.current || running.current !== controller) return;
      if (!source.isCurrent()) throw new RasterError('source');
      setState({ at: 'ready', result, isCurrent: source.isCurrent });
    } catch (error) {
      if (running.current === controller && !context.current && (!controller.signal.aborted || controller.signal.reason instanceof RasterError)) setState({ at: 'failed', reason: error instanceof RasterError ? error.reason : 'source' });
    } finally { clearTimeout(timeout); if (running.current === controller) running.current = null; }
  };
  const cancel = () => { running.current?.abort(); running.current = null; setState({ at: 'idle' }); setOpen(false); };
  const download = () => {
    if (context.current || state.at !== 'ready') return;
    if (!state.isCurrent()) { setState({ at: 'failed', reason: 'source' }); return; }
    startDownload(state.result.blob, state.result.name);
    setState({ at: 'idle' }); setOpen(false);
  };
  return <div className="annotated-download">
    <button className="carrete-btn" aria-label={tr('carrete.download')} aria-expanded={open} onClick={() => open ? cancel() : setOpen(true)}><DownloadIcon size={20} /><span className="carrete-btn-label">{tr('carrete.download')} ▾</span></button>
    {open && <div className="annotated-download-menu" role="group" aria-label={tr('carrete.download')}>
      {isValidElement<{ children?: ReactNode }>(original) ? cloneElement(original, { children: <><DownloadIcon size={20} />{tr('carrete.original')}</> }) : original}
      <button className="carrete-notice-btn" onClick={() => void prepare()} disabled={!compatible || state.at === 'busy'}>{tr('carrete.withAnnotations')}</button>
      {!compatible && <p role="status">{tr('carrete.raster.annotations')}</p>}
      {state.at === 'busy' && <p role="status">{tr('common.preparing')}</p>}
      {state.at === 'failed' && <p role="alert">{tr(errorKey[state.reason])}</p>}
      {state.at === 'ready' && <><p>{state.result.name}<br />{state.result.width} × {state.result.height}</p><button className="carrete-notice-btn" onClick={download}>{tr('carrete.download')}</button></>}
      <button className="carrete-notice-btn" onClick={cancel}>{tr('common.close')}</button>
    </div>}
  </div>;
}
