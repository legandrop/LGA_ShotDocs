import { useMemo, useState } from 'react';
import type { Translate } from '../i18n';
import { useServices } from '../services';
import { lazyPart, Part } from '../ui/lazyPart';
import type { CarreteEntry } from '../ui/carreteModel';
import { goToPlace } from './goToPlace';
import { Ic, Thumb } from './LiveHeader';
import { groupCaption, groupLabel, type Gallery, type GalleryWords, type PhotoGroup } from './photoGallery';

// Las fotos de la cabecera viva (Docs/Doc_Relaciones.md, sección 13; maqueta S4 «D»): una tira de 6 con su fuente y
// «All N · by source», que abre la galería por fuente (*All* y un botón por fuente con su cantidad). Tocar una foto, en
// la tira o en la galería, abre el carrete con todas las fotos de la galería, de varias páginas, empezando por esa
// (`GalleryCarrete`, que se baja aparte). Una fuente elegida lleva a su lugar exacto (la sección resaltada).

const GalleryCarrete = lazyPart(() => import('./GalleryCarrete').then((m) => m.GalleryCarrete));

/** Lo que entra en la grilla antes de «+N» (como la maqueta: 12, o 11 y el botón). */
const GRID_MAX = 12;
const STRIP_MAX = 6;

export function galleryWords(tr: Translate): GalleryWords {
  return {
    breakdown: tr('live.source.breakdown'),
    location: tr('live.source.location'),
    general: tr('gallery.general'),
    techScout: tr('gallery.techScout'),
    creativeScout: tr('gallery.creativeScout'),
    scouting: tr('live.scouting'),
    art: tr('gallery.art'),
  };
}

export function PhotoSources({ gallery, complete, unread, here, tr }: { gallery: Gallery; complete: boolean; unread: number; here: string; tr: Translate }) {
  const services = useServices();
  const { media } = services;
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string>('all');
  const [viewing, setViewing] = useState<number | null>(null);
  const words = galleryWords(tr);
  // Las carpetas no van (tienen su visor); de lo que todavía no se sabe qué es, se decide al abrir el carrete.
  const all = gallery.all.filter((x) => !media.isFolder(x.photo.id));
  const labels = new Map(gallery.groups.map((g) => [g.key, groupLabel(g, words)]));
  const labelOf = (g: PhotoGroup) => labels.get(g.key) ?? '';
  /** En la miniatura, el rótulo corto (el día; la sección queda para el selector, O1 de la auditoría). */
  const captionOf = (g: PhotoGroup) => groupCaption(g, words);
  /** El título de la página de una fuente, solo si agrega algo (no es esta página ni lo dice el rótulo). */
  const tipOf = (g: PhotoGroup) => (g.pageId === here || g.pageTitle === labelOf(g) ? undefined : g.pageTitle);
  // La lista del carrete, la misma mientras no cambien sus fotos ni sus rótulos (O4: si no, se rearmaba en cada dibujo).
  const entryKey = all.map(({ photo, group }) => `${photo.id}|${photo.place.pageId}|${photo.place.blockId}|${labelOf(group)}|${group.pageTitle}`).join(' ¦ ');
  const entries: CarreteEntry[] = useMemo(
    () =>
      all.map(({ photo, group }) => ({
        mediaId: photo.id,
        origin: { pageId: photo.place.pageId, pageTitle: group.pageTitle, label: labelOf(group), blockId: photo.place.blockId },
      })),
    [entryKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const viewAt = (id: string) => {
    const at = all.findIndex((x) => x.photo.id === id);
    if (at >= 0) setViewing(at);
  };
  // Lo que falta leer o bajar: puede haber más fotos (sin red o con páginas que no están en el dispositivo).
  const more = complete ? null : <span className="lh-via lh-gal-more">{unread ? tr('gallery.unread', { count: unread }) : tr('gallery.incomplete')}</span>;
  const carrete = viewing !== null && (
    <Part onClose={() => setViewing(null)}>
      <GalleryCarrete entries={entries} start={viewing} onClose={() => setViewing(null)} />
    </Part>
  );

  if (!all.length) {
    return (
      <div className="lh-gal">
        <div className="lh-gal-h">
          <span className="lbl">{tr('live.photos')}</span>
          <span className="lh-via">{complete ? tr('live.noPhotos') : tr('live.reading')}</span>
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="lh-gal">
        <div className="lh-gal-h">
          <span className="lbl">{tr('live.photos')}</span>
          {more}
          <button className="lh-tbtn lh-gal-toggle" aria-expanded={false} onClick={() => setOpen(true)}>
            {tr('gallery.allBySource', { count: all.length })}
            <Ic name="down" small />
          </button>
        </div>
        <div className="lh-strip">
          {all.slice(0, STRIP_MAX).map(({ photo, group }) => (
            <button key={photo.id} className="lh-fig" onClick={() => viewAt(photo.id)}>
              <Thumb id={photo.id} />
              <span className="cap">{captionOf(group)}</span>
            </button>
          ))}
        </div>
        {carrete}
      </div>
    );
  }

  const groups = gallery.groups.map((g) => ({ g, photos: g.photos.filter((p) => !media.isFolder(p.id)) })).filter((x) => x.photos.length);
  const cur = sel === 'all' ? null : (groups.find((x) => x.g.key === sel) ?? null);
  const cells = cur ? cur.photos.map((photo) => ({ photo, group: cur.g })) : all;
  const max = cells.length > GRID_MAX ? GRID_MAX - 1 : GRID_MAX;
  return (
    <div className="lh-gal open">
      <div className="lh-gal-h">
        <span className="lbl">
          {tr('live.photos')}
          <small>{tr('gallery.bySource')}</small>
        </span>
        {more}
        <button className="lh-tbtn lh-gal-toggle" aria-expanded={true} onClick={() => setOpen(false)}>
          <Ic name="up" small />
          {tr('gallery.less')}
        </button>
        <span className="lh-seg">
          <button className={sel === 'all' ? 'on' : ''} aria-pressed={sel === 'all'} onClick={() => setSel('all')}>
            {tr('gallery.all')}
            <i>{all.length}</i>
          </button>
          {groups.map(({ g, photos }) => (
            <button key={g.key} className={sel === g.key ? 'on' : ''} aria-pressed={sel === g.key} onClick={() => setSel(g.key)} data-tip={tipOf(g)} data-tip-plain>
              {labelOf(g)}
              <i>{photos.length}</i>
            </button>
          ))}
        </span>
      </div>
      <div className="lh-grid">
        {cells.slice(0, max).map(({ photo, group }) => (
          <button key={photo.id} className="lh-fig" onClick={() => viewAt(photo.id)}>
            <Thumb id={photo.id} />
            <span className="cap">{captionOf(group)}</span>
          </button>
        ))}
        {cells.length > max && (
          <button className="lh-grid-more" onClick={() => viewAt(cells[max].photo.id)} aria-label={tr('gallery.moreAria', { count: cells.length - max })}>
            +{cells.length - max}
          </button>
        )}
      </div>
      {cur && (
        <div className="lh-gal-go">
          {/* Una fuente de página entera va a su primera foto (puede estar en un párrafo con otras, B1). */}
          <button className="lh-sec" onClick={() => goToPlace(services, cur.g.place, cur.g.place.endBlockId === undefined ? cur.photos[0]?.id : undefined)}>
            {tr(cur.g.place.endBlockId !== undefined ? 'gallery.goSection' : 'gallery.goPage')}
            <Ic name="go" small />
          </button>
          <span className="lh-via">{cur.g.pageTitle}</span>
        </div>
      )}
      {carrete}
    </div>
  );
}
