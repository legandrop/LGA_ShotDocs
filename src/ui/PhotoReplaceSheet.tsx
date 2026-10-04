import { useEffect, useRef, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../i18n';
import '../i18n/lazy/annotator';
import './photoReplaceSheet.css';

export interface PhotoReplacement {
  phase: 'measuring' | 'ready' | 'saving' | 'failed';
  canKeep: boolean;
  trigger: HTMLElement | null;
  choose: (keep: boolean) => void;
  cancel: () => void;
  canReturnFocus: () => boolean;
}
/** Hija real del editor; Cancel permanece enfocado cuando Yes/No desaparecen al guardar. */
export function PhotoReplaceSheet({ attempt }: { attempt: PhotoReplacement }) {
  const tr = useT(), root = useRef<HTMLDivElement>(null), cancel = useRef<HTMLButtonElement>(null);
  const busy = attempt.phase === 'measuring' || attempt.phase === 'saving';
  useEffect(() => {
    cancel.current?.focus();
    return () => { if (attempt.canReturnFocus() && attempt.trigger?.isConnected) attempt.trigger.focus(); };
  }, [attempt.cancel]);
  const keys = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.stopPropagation(); attempt.cancel(); }
    if (event.key !== 'Tab') return;
    const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    if (document.activeElement === (event.shiftKey ? buttons[0] : buttons.at(-1))) {
      event.preventDefault(); (event.shiftKey ? buttons.at(-1) : buttons[0])?.focus();
    }
  };
  const choose = (keep: boolean) => { cancel.current?.focus(); attempt.choose(keep); };
  return createPortal(<div className="photo-replace-backdrop" onClick={attempt.cancel}>
    <div ref={root} className="photo-replace-sheet" role="dialog" aria-modal="true" aria-label={tr('photoReplace.question')} onClick={(e) => e.stopPropagation()} onKeyDown={keys}>
      <h2>{tr('photoReplace.question')}</h2>
      <p role={busy ? 'status' : undefined}>{tr(busy ? 'common.preparing' : attempt.phase === 'failed' ? 'photoReplace.failed' : attempt.canKeep ? 'photoReplace.explain' : 'photoReplace.unavailable')}</p>
      {attempt.phase === 'saving' && <p>{tr('photoReplace.cancelSaving')}</p>}
      <footer>
        {!busy && attempt.phase === 'ready' && <>
          {attempt.canKeep && <button onClick={() => choose(true)}>{tr('photoReplace.yes')}</button>}
          <button onClick={() => choose(false)}>{tr(attempt.canKeep ? 'photoReplace.no' : 'photoReplace.without')}</button>
        </>}
        <button ref={cancel} onClick={attempt.cancel}>{tr('common.cancel')}</button>
      </footer>
    </div>
  </div>, document.body);
}
