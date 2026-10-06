import { useLayoutEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { createMarkupSvg, drawMarkup } from './markupSvg';
import type { AnnotationComparison, AnnotationSide } from './historyAnnotations';

function Drawing({ side }: { side: AnnotationSide }) {
  const tr = useT();
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!host.current || !side.photo) return;
    const svg = createMarkupSvg();
    drawMarkup(svg, side.photo);
    host.current.replaceChildren(svg);
    return () => svg.remove();
  }, [side.photo]);
  if (!side.referenced) return <p className="muted">{tr('history.annotationsAbsent')}</p>;
  if (!side.photo) return <p className="muted">{tr(side.partial ? 'history.annotationsUnavailable' : 'history.annotationsEmpty')}</p>;
  return <div ref={host} className="history-annotation-drawing" style={{ aspectRatio: `${side.photo.frame.w}/${side.photo.frame.h}` }} />;
}

/** Los dibujos de las dos versiones, fuera del editor y de su portapapeles. */
export function HistoryAnnotationChanges({ comparison }: { comparison: AnnotationComparison }) {
  const tr = useT();
  const [opened, setOpened] = useState<string | null>(comparison.cards[0]?.fileId ?? null);
  return <section className="history-annotations" aria-label={tr('history.annotationsTitle')}>
    <h2>{tr('history.annotationsTitle')}</h2>
    <p className="muted">{tr('history.annotationsScope')}</p>
    {comparison.partial && <p className="banner">{tr('history.annotationsPartial')}</p>}
    {!comparison.cards.length && <p>{tr('history.annotationsUnchanged')}</p>}
    {comparison.cards.map((card) => {
      const fallback = tr('history.annotationsPhoto', { id: card.fileId });
      const beforeName = card.before.name ?? fallback, selectedName = card.selected.name ?? fallback;
      const name = beforeName === selectedName ? selectedName : `${beforeName} → ${selectedName}`;
      const expanded = opened === card.fileId;
      return <div className="history-annotation-card" key={card.fileId}>
        <button className="history-annotation-toggle" aria-expanded={expanded} onClick={() => setOpened(expanded ? null : card.fileId)}>
          <span>{name}</span><span aria-hidden="true">{expanded ? '−' : '+'}</span>
        </button>
        {expanded && <div className="history-annotation-content">
          {card.partial && <p className="banner">{tr('history.annotationsPartial')}</p>}
          {card.counts && <p>{tr('history.annotationsCounts', { added: card.added, removed: card.removed, changed: card.changed })}</p>}
          {card.frameChanged && <p className="muted">{tr('history.annotationsFrame')}</p>}
          <div className="history-annotation-pair">
            <div><h3>{tr('history.annotationsBefore')}</h3><Drawing side={card.before} /></div>
            <div><h3>{tr('history.annotationsSelected')}</h3><Drawing side={card.selected} /></div>
          </div>
        </div>}
      </div>;
    })}
  </section>;
}
