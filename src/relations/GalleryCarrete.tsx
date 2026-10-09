import { useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { PHOTO_MARKUP_MAP } from '../media/markup';
import { useServices, useSyncStatus } from '../services';
import { Carrete } from '../ui/Carrete';
import { createCarreteLoader } from '../ui/carreteLoader';
import { carreteItemsOfEntries, itemsOfEntries, type CarreteEntry, type CarreteItem } from '../ui/carreteModel';
import { goToPlace } from './goToPlace';

// El carrete de las fotos por fuente de la cabecera viva (Docs/Doc_Carrete.md, «Varias páginas»): todas las fotos de la
// galería, de varias páginas, en el orden de la galería, empezando por la tocada. Se baja aparte (con el carrete): la
// cabecera solo trae `PhotoSources`.
//
// - Cada foto dice de dónde viene («From Tech scout 06/01») y *Go to place* lleva a su bloque en su página.
// - Las anotaciones de cada foto salen del mapa de **su** página: la abierta, el documento vivo; las otras, una copia
//   de lo guardado en el dispositivo (`indexSnapshot`, solo para leer; se suelta al cerrar). No se anota desde acá:
//   anotar va en la página (necesita el editor).
// - Sin red se ve lo que hay en el dispositivo (la miniatura o la versión grande); lo que falta lo dice el carrete.

export interface GalleryCarreteProps {
  entries: CarreteEntry[];
  /** El índice de la foto tocada en `entries`. */
  start: number;
  onClose: () => void;
}

export function GalleryCarrete({ entries, start, onClose }: GalleryCarreteProps) {
  const services = useServices();
  const { media, files, docs } = services;
  const { online } = useSyncStatus();
  const loader = useMemo(() => createCarreteLoader({ media, files }), [media, files]);
  useEffect(() => () => loader.dispose(), [loader]);

  // Primero lo que ya se sabe (casi siempre todo): abre en el acto. Si de algún archivo no se sabe qué es (una carpeta
  // de otro dispositivo), se averigua y la lista se actualiza con el carrete abierto.
  const startKey = useMemo(() => {
    const e = entries[start];
    return e ? `${e.origin.pageId}/${e.mediaId}` : null;
  }, [entries, start]);
  const [items, setItems] = useState<CarreteItem[]>(() => itemsOfEntries(entries, (id) => media.isFolder(id)));
  useEffect(() => {
    let live = true;
    void carreteItemsOfEntries(entries, media, { onLate: (next) => live && setItems(next) }).then((next) => live && setItems(next));
    return () => {
      live = false;
    };
  }, [entries, media]);
  const [first] = useState(() => Math.max(0, items.findIndex((i) => i.key === startKey)));

  // Las anotaciones, por página: se piden cuando se ve una foto de esa página (y la de al lado).
  const [maps, setMaps] = useState<Map<string, Y.Map<unknown> | null>>(() => new Map());
  const asked = useRef(new Set<string>());
  const copies = useRef<Y.Doc[]>([]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const d of copies.current.splice(0)) d.destroy();
    };
  }, []);
  const markupFor = (pageId: string) => {
    if (asked.current.has(pageId)) return;
    asked.current.add(pageId);
    const open = docs.peek(pageId);
    if (open) {
      setMaps((m) => new Map(m).set(pageId, open.getMap<unknown>(PHOTO_MARKUP_MAP)));
      return;
    }
    void docs
      .indexSnapshot(pageId)
      .then(({ doc }) => {
        // Llegó con el carrete ya cerrado: se suelta en el acto (O5 de la auditoría).
        if (!alive.current) {
          doc.destroy();
          return;
        }
        copies.current.push(doc);
        setMaps((m) => new Map(m).set(pageId, doc.getMap<unknown>(PHOTO_MARKUP_MAP)));
      })
      .catch(() => {
        // Sin la copia, la foto se ve sin anotaciones; la próxima vez se vuelve a pedir.
        asked.current.delete(pageId);
      });
  };
  const onShow = (item: CarreteItem) => {
    const at = items.findIndex((i) => i.key === item.key);
    for (const it of [items[at], items[at + 1], items[at - 1]]) if (it?.origin) markupFor(it.origin.pageId);
  };

  // Si no quedó nada para mostrar (eran todas carpetas), se cierra solo.
  const empty = items.length === 0;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (empty) closeRef.current();
  }, [empty]);

  if (empty) return null;
  return (
    <Carrete
      items={items}
      start={first}
      loader={loader}
      online={online}
      onClose={onClose}
      markupOf={(it) => (it.origin ? (maps.get(it.origin.pageId) ?? null) : null)}
      onShow={onShow}
      onGoTo={(it) => it.origin && goToPlace(services, { pageId: it.origin.pageId, blockId: it.origin.blockId }, it.mediaId ?? undefined)}
    />
  );
}
