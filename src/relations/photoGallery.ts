import { dayShortLabel, type DayLive } from './dayLive';
import { fieldDate, fieldValues } from './fields';
import type { LiveSource, LocationLive, PhotoRef, Place, SceneLive } from './liveView';

// Las fotos por fuente de la cabecera viva (Docs/Doc_Relaciones.md, sección 13; maqueta S4 «D», «All N · by source»).
// Puro: sale de lo que ya armó la cabecera (`sceneLive`, `locationLive`, `dayLive`) y de la foto del índice, que solo
// tiene las páginas que la persona ve. Cada grupo es un lugar exacto (una ficha, una sección, un scouting, un día) y
// lleva ahí; cada foto sabe en qué bloque de qué página está, así el carrete de varias páginas puede ir a ella.
//
// Orden, como la maqueta: desglose (la escena y sus fichas) → scoutings (técnico y creativo por separado, C7 O7) →
// secciones de los reportes, día por día. En la locación: la locación misma → sus decorados → sus scoutings → sus días.
// En el día: lo general del día → cada sección, en el orden del reporte.

export type GroupKind = 'breakdown' | 'location' | 'set' | 'scout' | 'section' | 'day' | 'general';
export type ScoutKind = 'tech' | 'creative' | 'other';

export interface GalleryPhoto {
  id: string;
  /** El bloque de la página donde está la foto (sin `endBlockId`: se resalta solo ese bloque). */
  place: Place;
}

export interface PhotoGroup {
  /** Única en la galería. */
  key: string;
  kind: GroupKind;
  /** Un scouting: técnico, creativo o sin decir (del título de la página). */
  scout?: ScoutKind;
  /** Un scouting: su fecha «dd/mm» (del campo *Date* / *Fecha* o del título), o vacío. */
  date?: string;
  /** Una sección de un reporte en la escena: el día («Día 59», o la fecha corta si el título no tiene número). */
  day?: string;
  /** Lo que distingue al grupo de otro del mismo tipo: el título de la sección, el plano de una ficha, el decorado. */
  detail?: string;
  pageId: string;
  /** El título de la página de donde salen (para el tooltip y el carrete). */
  pageTitle: string;
  /** A dónde lleva el grupo: la sección entera (resaltada) o el primer bloque con fotos. */
  place: Place;
  photos: GalleryPhoto[];
}

export interface Gallery {
  groups: PhotoGroup[];
  /** Todas, sin repetir, en el orden de los grupos; cada una con el primer grupo que la tiene. */
  all: { photo: GalleryPhoto; group: PhotoGroup }[];
}

/** Los textos de los rótulos (de `i18n/relations.ts`; aparte para probar sin la interfaz). */
export interface GalleryWords {
  breakdown: string;
  location: string;
  general: string;
  techScout: string;
  creativeScout: string;
  scouting: string;
  /** El arte de un decorado («Art · Negocio de Telas»; la maqueta: «Art (sets)»). */
  art: string;
}

const short = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : text);

/** El rótulo de un grupo, como la maqueta: «Breakdown», «Tech scout 06/01», «Día 59 · Escena 105_027b», «General». */
export function groupLabel(g: PhotoGroup, w: GalleryWords): string {
  const detail = g.detail ? short(g.detail, 26) : '';
  switch (g.kind) {
    case 'breakdown':
      return detail ? `${w.breakdown} · ${detail}` : w.breakdown;
    case 'location':
      return w.location;
    case 'set':
      return detail ? `${w.art} · ${detail}` : w.art;
    case 'scout': {
      const name = g.scout === 'tech' ? w.techScout : g.scout === 'creative' ? w.creativeScout : w.scouting;
      const head = g.date ? `${name} ${g.date}` : name;
      return detail ? `${head} · ${detail}` : head;
    }
    case 'section':
      return g.day ? (detail ? `${g.day} · ${detail}` : g.day) : detail;
    case 'day':
      return g.day ?? detail;
    case 'general':
      return w.general;
  }
}

/**
 * El rótulo corto, para la miniatura (O1 de la auditoría de E8): una sección de un reporte en la escena dice solo su día
 * y un scouting su tipo y fecha; el rótulo entero queda para el selector de fuentes.
 */
export function groupCaption(g: PhotoGroup, w: GalleryWords): string {
  if (g.kind === 'section' && g.day) return g.day;
  if (g.kind === 'scout' || g.kind === 'breakdown' || g.kind === 'set') return groupLabel({ ...g, detail: undefined }, w);
  return groupLabel(g, w);
}

/**
 * Técnico o creativo, del título del scouting («260106 | Scouting técnico VFX», «Tech scout 06/01», «Creative scout»,
 * «Scouting con dirección»). Las plantillas *Tech scout* y *Creative scout* titulan así; si el título no lo dice, «other».
 */
export function scoutKindOf(title: string): ScoutKind {
  if (/creativ/i.test(title)) return 'creative';
  if (/t[eé]cnic|\btech\b/i.test(title)) return 'tech';
  if (/director|direcci[oó]n/i.test(title)) return 'creative';
  return 'other';
}

const valid = (m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31;
const ddmm = (m: number, d: number) => `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;

/**
 * La fecha de un scouting como «dd/mm»: el campo *Date* / *Fecha* de la página (la plantilla lo trae), o el principio del
 * título (`2026-01-06`, `260106`, `26.01.06`, las formas de ERSO), o un «06/01» en el título. Vacío si no dice.
 */
export function scoutDateOf(src: LiveSource, pageId: string, title: string): string {
  for (const f of fieldValues(src.snap.fields.get(pageId), ['date', 'fecha', 'fecha scouting', 'scout date'])) {
    const iso = fieldDate(f.text);
    if (iso) return ddmm(Number(iso.slice(5, 7)), Number(iso.slice(8, 10)));
  }
  const t = title.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?!\d)/.exec(t);
  if (iso && valid(Number(iso[2]), Number(iso[3]))) return ddmm(Number(iso[2]), Number(iso[3]));
  const compact = /^(\d{2})[.]?(\d{2})[.]?(\d{2})(?![\d.])/.exec(t);
  if (compact && valid(Number(compact[2]), Number(compact[3]))) return ddmm(Number(compact[2]), Number(compact[3]));
  const dm = /(?:^|[^\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/.exec(t);
  if (dm && valid(Number(dm[2]), Number(dm[1]))) return ddmm(Number(dm[2]), Number(dm[1]));
  return '';
}

/**
 * El bloque de una foto en su página (la foto en sí, para ir a ella): el primero con esa foto desde `from` (el título de
 * la sección), o el primero de la página. Si el índice no la tiene (no debería), el lugar del grupo.
 */
function photoPlace(src: LiveSource, pageId: string, id: string, fallback: Place): Place {
  const rel = src.snap.pages.get(pageId);
  if (!rel) return fallback;
  const start = fallback.endBlockId !== undefined ? (rel.sections.find((s) => s.blockId === fallback.blockId)?.block ?? 0) : 0;
  const hit = rel.media.find((m) => m.block >= start && m.ids.includes(id)) ?? rel.media.find((m) => m.ids.includes(id));
  return hit ? { pageId, blockId: hit.blockId } : fallback;
}

/** Las fotos de una página entera, cada una en su bloque, sin repetir. */
function pagePhotos(src: LiveSource, pageId: string): GalleryPhoto[] {
  const out: GalleryPhoto[] = [];
  const seen = new Set<string>();
  for (const m of src.snap.pages.get(pageId)?.media ?? []) {
    for (const id of m.ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, place: { pageId, blockId: m.blockId } });
    }
  }
  return out;
}

class Builder {
  readonly groups: PhotoGroup[] = [];
  constructor(
    private readonly src: LiveSource,
    private readonly skip?: (id: string) => boolean,
  ) {}

  /** Suma un grupo si la persona ve su página y tiene alguna foto (las que no van, como las carpetas, no cuentan). */
  add(g: Omit<PhotoGroup, 'photos' | 'pageTitle'> & { photos: GalleryPhoto[] }): void {
    const title = this.src.title(g.pageId);
    if (title === undefined) return;
    const seen = new Set<string>();
    const photos = g.photos.filter((p) => !this.skip?.(p.id) && !seen.has(p.id) && (seen.add(p.id), true));
    if (!photos.length) return;
    // Dos fuentes del mismo tipo con exactamente las mismas fotos (la misma imagen en dos fichas) son una sola: la
    // primera (O1 de la auditoría de E8).
    const ids = photos.map((p) => p.id).sort().join('|');
    if (this.groups.some((x) => x.kind === g.kind && x.photos.map((p) => p.id).sort().join('|') === ids)) return;
    let key = g.key;
    for (let i = 2; this.groups.some((x) => x.key === key); i++) key = `${g.key}#${i}`;
    this.groups.push({ ...g, key, pageTitle: title, photos });
  }

  /** Las fotos de un extracto (una sección), cada una en su bloque. */
  photosOf(list: PhotoRef[], place: Place): GalleryPhoto[] {
    return list.map((p) => ({ id: p.id, place: photoPlace(this.src, place.pageId, p.id, place) }));
  }

  done(): Gallery {
    const all: Gallery['all'] = [];
    const seen = new Set<string>();
    for (const group of this.groups) {
      for (const photo of group.photos) {
        if (seen.has(photo.id)) continue;
        seen.add(photo.id);
        all.push({ photo, group });
      }
    }
    return { groups: this.groups, all };
  }
}

/** Un lugar para un grupo de una página entera: el primer bloque con fotos. */
const firstPhoto = (pageId: string, photos: GalleryPhoto[]): Place => photos[0]?.place ?? { pageId, blockId: '' };

/** Si hay más de un grupo de un mismo tipo (o de una misma página), cada uno dice su detalle; si es uno solo, no. */
function trimDetails(groups: PhotoGroup[], sameKind: (a: PhotoGroup, b: PhotoGroup) => boolean): void {
  for (const g of groups) {
    if (!groups.some((o) => o !== g && sameKind(o, g))) delete g.detail;
  }
}

export function sceneGallery(src: LiveSource, v: SceneLive, skip?: (id: string) => boolean): Gallery {
  const b = new Builder(src, skip);
  // 1. Desglose: la página de la escena y cada ficha (o sección de otra página del desglose) con fotos.
  if (v.pageId) {
    const own = v.photos.filter((p) => p.sourceKind === 'breakdown' && p.place.pageId === v.pageId);
    const photos = own.map((p) => ({ id: p.id, place: p.place }));
    b.add({ key: `bd:${v.pageId}`, kind: 'breakdown', pageId: v.pageId, place: firstPhoto(v.pageId, photos), photos });
  }
  for (const ex of v.breakdown) {
    if (!ex.photos.length) continue;
    const photos = ex.kind === 'section' ? b.photosOf(ex.photos, ex.place) : ex.photos.map((p) => ({ id: p.id, place: p.place }));
    b.add({ key: `bd:${ex.pageId}:${ex.place.blockId}`, kind: 'breakdown', detail: ex.heading || ex.pageTitle, pageId: ex.pageId, place: ex.place, photos });
  }
  // 2. Scoutings que la nombran: una sección cada uno, rotulado técnico o creativo con su fecha.
  for (const ex of v.scouting) {
    if (!ex.photos.length) continue;
    b.add({
      key: `sc:${ex.pageId}:${ex.place.blockId}`,
      kind: 'scout',
      scout: scoutKindOf(ex.pageTitle),
      date: scoutDateOf(src, ex.pageId, ex.pageTitle),
      detail: ex.heading,
      pageId: ex.pageId,
      place: ex.place,
      photos: b.photosOf(ex.photos, ex.place),
    });
  }
  // 3. Rodaje: cada sección de cada día, en orden de fecha.
  for (const d of v.days) {
    for (const ex of d.sections) {
      if (!ex.photos.length) continue;
      b.add({ key: `sh:${ex.pageId}:${ex.place.blockId}`, kind: 'section', day: dayShortLabel(d.day), detail: ex.heading, pageId: ex.pageId, place: ex.place, photos: b.photosOf(ex.photos, ex.place) });
    }
  }
  trimDetails(b.groups.filter((g) => g.kind === 'breakdown'), () => true);
  trimDetails(b.groups.filter((g) => g.kind === 'scout'), (a, x) => a.pageId === x.pageId);
  return b.done();
}

export function locationGallery(src: LiveSource, v: LocationLive, skip?: (id: string) => boolean): Gallery {
  const b = new Builder(src, skip);
  // 1. La locación misma (fotos y arte de su página).
  if (v.pageId) {
    const photos = pagePhotos(src, v.pageId);
    b.add({ key: `loc:${v.pageId}`, kind: 'location', pageId: v.pageId, place: firstPhoto(v.pageId, photos), photos });
  }
  // 2. Sus decorados que son páginas (el arte de cada uno).
  for (const s of v.sets) {
    if (!s.pageId) continue;
    const photos = pagePhotos(src, s.pageId);
    b.add({ key: `set:${s.pageId}`, kind: 'set', detail: s.title, pageId: s.pageId, place: firstPhoto(s.pageId, photos), photos });
  }
  // 3. Sus scoutings, cada uno entero.
  for (const s of v.scouts) {
    const photos = pagePhotos(src, s.pageId);
    b.add({ key: `sc:${s.pageId}`, kind: 'scout', scout: scoutKindOf(s.title), date: scoutDateOf(src, s.pageId, s.title), pageId: s.pageId, place: firstPhoto(s.pageId, photos), photos });
  }
  // 4. Sus días: todas las fotos del reporte (el día es de esta locación por su título).
  for (const d of v.days) {
    const photos = pagePhotos(src, d.day.pageId);
    b.add({ key: `day:${d.day.pageId}`, kind: 'day', day: dayShortLabel(d.day), pageId: d.day.pageId, place: firstPhoto(d.day.pageId, photos), photos });
  }
  return b.done();
}

export function dayGallery(src: LiveSource, v: DayLive, skip?: (id: string) => boolean): Gallery {
  const b = new Builder(src, skip);
  const pageId = v.day.pageId;
  // Lo de `dayLive`: cada foto con su fuente (el título de su sección, o el día para lo general) y su lugar.
  const general: GalleryPhoto[] = [];
  const sections = new Map<string, { place: Place; heading: string; photos: GalleryPhoto[] }>();
  for (const p of v.photos) {
    if (p.source === v.day.label || p.place.endBlockId === undefined) {
      general.push({ id: p.id, place: p.place });
      continue;
    }
    const key = p.place.blockId;
    const entry = sections.get(key) ?? { place: p.place, heading: p.source, photos: [] };
    sections.set(key, entry);
    entry.photos.push({ id: p.id, place: photoPlace(src, pageId, p.id, p.place) });
  }
  b.add({ key: `gen:${pageId}`, kind: 'general', pageId, place: firstPhoto(pageId, general), photos: general });
  for (const [key, s] of sections) b.add({ key: `sec:${key}`, kind: 'section', detail: s.heading, pageId, place: s.place, photos: s.photos });
  return b.done();
}
