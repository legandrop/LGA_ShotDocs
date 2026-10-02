import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { readPhotoMarkup, touchedFileIds } from '../media/markup';
import { minStrokeFor } from './markupOverlay';
import { drawMarkup } from './markupSvg';

// Las anotaciones en el carrete (P.20, entrega 1; Docs/Doc_Anotar_Fotos.md, sección 4): el mismo dibujo que en la
// página, en la caja de la foto (`.carrete-media`, que ya tiene la proporción de la foto y el zoom del carrete).

/** Si la foto tiene anotaciones que se dibujan (se vuelve a mirar cuando cambian las suyas). */
export function useHasMarkup(map: Y.Map<unknown> | null | undefined, fileId: string | null): boolean {
  const [has, setHas] = useState(() => !!(map && fileId && readPhotoMarkup(map, fileId)));
  useEffect(() => {
    if (!map || !fileId) {
      setHas(false);
      return;
    }
    const check = () => setHas(!!readPhotoMarkup(map, fileId));
    check();
    const onChange = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
      if (touchedFileIds(events, map).has(fileId)) check();
    };
    map.observeDeep(onChange);
    return () => map.unobserveDeep(onChange);
  }, [map, fileId]);
  return has;
}

/**
 * El `<svg>` de las anotaciones de una foto del carrete, del tamaño con que se dibuja la foto (`size`). Una foto sin
 * anotaciones no tiene `<svg>`.
 */
export function CarreteMarkup({ map, fileId, size }: { map: Y.Map<unknown>; fileId: string; size: { width: number; height: number } }) {
  const has = useHasMarkup(map, fileId);
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const paint = () => {
      const photo = readPhotoMarkup(map, fileId);
      if (photo) drawMarkup(svg, photo, { minStroke: minStrokeFor(photo.frame, size) });
      else svg.replaceChildren();
    };
    paint();
    const onChange = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
      if (touchedFileIds(events, map).has(fileId)) paint();
    };
    map.observeDeep(onChange);
    return () => map.unobserveDeep(onChange);
  }, [map, fileId, size.width, size.height, has]);
  return has ? <svg ref={ref} className="sd-markup" aria-hidden="true" focusable="false" /> : null;
}
