import { useState } from 'react';
import type * as Y from 'yjs';
import { useT } from '../i18n';
import '../i18n/lazy/carrete';
import { AnnotatedDownload } from './AnnotatedDownload';
import { AnnotatedCopy } from './AnnotatedCopy';
import type { CarreteItem } from './carreteModel';
import type { CarreteLoader } from './carreteLoader';

/** Una sola preparación activa: cambiar de acción desmonta y cancela la anterior. */
export function PhotoAnnotatedExports({ item, map, loader, onClose }: { item: CarreteItem; map: Y.Map<unknown>; loader: CarreteLoader; onClose: () => void }) {
  const tr = useT(), [action, setAction] = useState<'download' | 'copy'>('download');
  return <>
    <div className="photo-export-selector" role="group" aria-label={tr('carrete.withAnnotations')}>
      <button aria-pressed={action === 'download'} onClick={() => setAction('download')}>{tr('carrete.download')}</button>
      <button aria-pressed={action === 'copy'} onClick={() => setAction('copy')}>{tr('carrete.copy.action')}</button>
    </div>
    {action === 'download'
      ? <AnnotatedDownload item={item} map={map} loader={loader} original={null} presentation="body" onDone={onClose} />
      : <AnnotatedCopy item={item} map={map} loader={loader} original={null} presentation="body" />}
  </>;
}
