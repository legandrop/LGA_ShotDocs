import { SEPARATOR, type SearchUnit } from '../search/extract';
import type { IndexedContent } from '../search/projectIndex';
import { dateAtStart, dayInTitle } from '../templates/dayReport';
import { blocksOf, INDEX_PAGE_MIN, type Mention, type PageRelations, type Section } from './pageRelations';
import { scan } from './reader';
import { entityRelations, type EntityPage, type RelationSnapshot } from './relationIndex';

// Lo que muestra la cabecera viva de una escena o una locación (Docs/Doc_Relaciones.md, sección 10). Puro: todo sale de
// la foto del índice de relaciones (`RelationSnapshot`) y de lo que la búsqueda ya leyó de cada página (para los
// extractos). Nada se guarda: si una mención se borra, la próxima foto ya no la tiene y la cabecera tampoco.
//
// Reglas que vienen del diseño aprobado (S4 «D», auditorías C7 y C8):
// - «Filmada en» sale de las secciones de los reportes cuyo título nombra la escena, y la locación de ese día, del
//   **título del día** (se rotula así: «per the day title»). Nunca se afirma «no se filmó»: sin sección, «No report
//   section».
// - Las páginas índice (más de 20 escenas y locaciones) no aportan extractos ni fotos: van plegadas en un grupo.
// - Las páginas con `graph: false` ya no están en la foto (las saca el índice).
// - Lo que no se ve (otra rama sin permiso) tampoco está en la foto: un invitado ve solo lo suyo.

export interface LiveSource {
  snap: RelationSnapshot;
  /** El título de una página que la persona ve (o `undefined`). */
  title(pageId: string): string | undefined;
  /** Lo leído de una página (para los extractos). */
  content(pageId: string): IndexedContent | undefined;
}

/** Un lugar exacto de una página: una sección entera (hasta `endBlockId`) o un bloque. */
export interface Place {
  pageId: string;
  blockId: string;
  /** Sección: el bloque que la cierra (`null`, hasta el final). Sin la clave: solo ese bloque. */
  endBlockId?: string | null;
}

export interface PhotoRef {
  id: string;
  /** Dónde está (al tocarla, se va ahí). */
  place: Place;
  /** De dónde viene, para el rótulo: el título del scouting o el día; vacío para el desglose y la locación misma. */
  source: string;
  sourceKind: 'breakdown' | 'location' | 'title';
}

export interface DayRef {
  pageId: string;
  /** «Día 59» (del título) o el título. */
  label: string;
  /** `AAAA-MM-DD` del principio del título, o `null`. */
  date: string | null;
  /** La primera locación que nombra el título del día, si nombra una. */
  loc: string | null;
  /** Todas las locaciones que nombra el título («CENADE + La Arenera»), en el orden del título. */
  locs: string[];
}

export interface Excerpt {
  place: Place;
  pageId: string;
  /** El título de la página de donde sale. */
  pageTitle: string;
  /** El día, si sale de un día. */
  day: DayRef | null;
  /** El título de la sección (o vacío si es una mención suelta). */
  heading: string;
  /** Unos renglones de lo escrito. */
  text: string;
  /** La letra de la parte (`105_027b` → `B`). */
  part: string;
  /** Otras escenas que nombra el mismo título. */
  shared: string[];
  photos: PhotoRef[];
  kind: 'section' | 'mention' | 'card' | 'page';
}

export interface PageChip {
  pageId: string;
  title: string;
  /** Dónde la nombra (para ir al lugar), si es una mención. */
  blockId?: string;
}

export interface SceneDay {
  day: DayRef;
  /** Secciones del reporte de ese día que son de esta escena. */
  sections: Excerpt[];
  /** Menciones en el texto de ese día (sin sección propia). */
  mentions: Excerpt[];
  photos: PhotoRef[];
}

export interface SceneLive {
  code: string;
  pageId: string | null;
  episode: string | null;
  /** Otras formas en que está escrita en el proyecto (`5027`, `105_027b`). */
  aliases: string[];
  /** Las páginas de adentro (fichas). */
  cards: PageChip[];
  /** Locaciones que nombra su desglose (la escena y sus fichas). */
  plannedAt: PageChip[];
  /** Páginas de scouting que la nombran. */
  scoutPages: PageChip[];
  /** Si ningún scouting la nombra: los de las locaciones donde se filmó. */
  scoutsVia: (PageChip & { loc: string })[];
  breakdown: Excerpt[];
  scouting: Excerpt[];
  shoot: Excerpt[];
  days: SceneDay[];
  /**
   * Lo de adentro de un día que no es el reporte (un plan, una hoja de llamado) y la nombra: planeada para ese día,
   * nunca filmada (D400).
   */
  plannedDays: { day: DayRef; items: Excerpt[] }[];
  also: PageChip[];
  indexPages: PageChip[];
  photos: PhotoRef[];
  /**
   * «No VFX» de la escena entera: lo dice la página de la escena, o todas sus fichas con texto (D395). Una ficha con
   * DMP o CG al lado de otra «No VFX» no la marca.
   */
  noVfx: boolean;
  /** Cuántas de sus fichas con texto dicen «No VFX» (`no`) y cuántas fichas con texto tiene (`of`). */
  noVfxCards: { no: number; of: number };
  complete: boolean;
}

export interface LocationDay {
  day: DayRef;
  /** Escenas con sección en ese día. */
  scenes: { code: string; pageId: string | null }[];
  /** Secciones de nivel de arriba sin número de escena, con fotos («Plates ambulancia»). */
  unresolved: Excerpt[];
  sections: Excerpt[];
  photos: PhotoRef[];
}

export interface LocationLive {
  name: string;
  pageId: string | null;
  aliases: string[];
  /** Escenas cuyo desglose nombra esta locación, con los días en que tienen sección. */
  planned: { code: string; pageId: string | null; title: string; days: DayRef[] }[];
  /** Las páginas de adentro (scoutings), con su cantidad de fotos. */
  scouts: (PageChip & { photos: number })[];
  scouting: Excerpt[];
  days: LocationDay[];
  /** Escenas planeadas acá sin sección en ningún reporte. */
  noReport: string[];
  also: PageChip[];
  indexPages: PageChip[];
  photos: PhotoRef[];
  complete: boolean;
}

// --- Ayudantes -----------------------------------------------------------------------------------------------

const EXCERPT_CHARS = 280;
const flat = (text: string) => text.replaceAll(SEPARATOR, ' ').replace(/\s+/g, ' ').trim();

/** Lo de una página por bloque (para los extractos): el texto de cada bloque, en orden, como lo cuenta `Section.block`. */
interface PageBlocks {
  ids: string[];
  levels: number[];
  texts: string[];
}

function pageBlocks(content: IndexedContent | undefined): PageBlocks | null {
  if (!content) return null;
  const blocks = blocksOf(content.units, content.meta);
  return {
    ids: blocks.map((b) => b.blockId),
    levels: blocks.map((b) => b.level),
    texts: blocks.map((b) => flat(b.units.filter((u) => u.unit.field !== 'name').map((u: { unit: SearchUnit }) => u.unit.text).join(' '))),
  };
}

const clip = (text: string) => (text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS - 1).replace(/\s+\S*$/, '')}…` : text);

/** Lo escrito debajo de un título, hasta el final de su sección (sin los subtítulos). */
function sectionText(pb: PageBlocks | null, s: Section): string {
  if (!pb) return '';
  const out: string[] = [];
  let n = 0;
  for (let i = s.block + 1; i < s.end && i < pb.texts.length && n < EXCERPT_CHARS; i++) {
    if (pb.levels[i] || !pb.texts[i]) continue;
    out.push(pb.texts[i]);
    n += pb.texts[i].length;
  }
  return clip(out.join(' · '));
}

function blockText(pb: PageBlocks | null, blockId: string): string {
  if (!pb) return '';
  const i = pb.ids.indexOf(blockId);
  return i < 0 ? '' : clip(pb.texts[i]);
}

/** El principio de una página (una ficha, un scouting): sus primeros renglones. */
function pageText(pb: PageBlocks | null): string {
  if (!pb) return '';
  return clip(pb.texts.filter((t, i) => t && !pb.levels[i]).slice(0, 4).join(' · '));
}

/** El día de una página de rodaje: el título del día (o de la página de día que la contiene). */
export function dayRef(src: LiveSource, pageId: string): DayRef {
  const role = src.snap.registration.roles.get(pageId);
  const dayId = role?.entity?.kind === 'day' ? pageId : role?.partOf?.kind === 'day' ? role.partOf.pageId : pageId;
  const title = src.title(dayId) ?? '';
  const n = dayInTitle(title);
  const part = title.split('|').map((p) => p.trim()).find((p) => /(?:^|\s)(?:day|d[ií]a)\s*\d/i.test(p));
  const label = part ?? (n ? `Day ${String(n).padStart(2, '0')}` : title);
  const locs = scan(src.snap.registry, title, { heading: true, dayTitle: true }).filter((h) => h.kind === 'loc');
  const names = [...new Set(locs.map((h) => h.ref))];
  return { pageId: dayId, label: label || title, date: dateAtStart(title), loc: names[0] ?? null, locs: names };
}

const byDay = (a: DayRef, b: DayRef, order: Map<string, number>) =>
  (a.date ?? '9999') < (b.date ?? '9999') ? -1 : (a.date ?? '9999') > (b.date ?? '9999') ? 1 : (order.get(a.pageId) ?? 0) - (order.get(b.pageId) ?? 0);

function pageOrder(snap: RelationSnapshot): Map<string, number> {
  const order = new Map<string, number>();
  let i = 0;
  for (const id of snap.pages.keys()) order.set(id, i++);
  return order;
}

/** El campo «No VFX» de una ficha: la unidad entera es «No VFX» o «VFX…: No VFX» (no una frase que lo diga de pasada). */
const NO_VFX = /^(?:vfx[\p{L}\s]*[:|·]\s*)?no[\s-]+vfx\.?$/iu;

function sectionPlace(pageId: string, s: Section): Place {
  return { pageId, blockId: s.blockId, endBlockId: s.endBlockId };
}

type Source = string | 'breakdown' | 'location';
const sourceOf = (source: Source): Pick<PhotoRef, 'source' | 'sourceKind'> =>
  source === BREAKDOWN || source === LOCATION ? { source: '', sourceKind: source === BREAKDOWN ? 'breakdown' : 'location' } : { source, sourceKind: 'title' };
const BREAKDOWN = '\u0000breakdown';
const LOCATION = '\u0000location';

function photosOfSection(pageId: string, s: Section, source: Source): PhotoRef[] {
  return s.media.map((id) => ({ id, place: sectionPlace(pageId, s), ...sourceOf(source) }));
}

function photosOfPage(rel: PageRelations | undefined, pageId: string, source: Source): PhotoRef[] {
  if (!rel) return [];
  const out: PhotoRef[] = [];
  for (const m of rel.media) for (const id of m.ids) out.push({ id, place: { pageId, blockId: m.blockId }, ...sourceOf(source) });
  return out;
}

function uniquePhotos(list: PhotoRef[]): PhotoRef[] {
  const seen = new Set<string>();
  return list.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}

/** Las menciones que no caen adentro de una sección de la misma entidad (las que la sección ya cuenta no se repiten). */
function looseMentions(p: EntityPage): Mention[] {
  const seen = new Set<string>();
  return p.mentions.filter((m) => {
    if (m.hidden || seen.has(m.blockId)) return false;
    if (p.sections.some((s) => m.block >= s.block && m.block < s.end)) return false;
    seen.add(m.blockId);
    return true;
  });
}

const shortTitle = (title: string, n = 34) => (title.length > n ? `${title.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : title);

// --- Escena --------------------------------------------------------------------------------------------------------

/** Las formas en que el proyecto escribe una escena, sin la canónica (máximo `max`, las más usadas primero). */
function sceneAliases(src: LiveSource, pages: EntityPage[], code: string, max = 5): string[] {
  const counts = new Map<string, number>();
  let looked = 0;
  for (const p of pages) {
    if (p.indexPage) continue;
    const content = src.content(p.pageId);
    if (!content) continue;
    const ep = src.snap.registration.roles.get(p.pageId)?.ep ?? null;
    const blocks = new Set(p.mentions.filter((m) => m.via !== 'link' && !m.hidden).map((m) => `${m.via}:${m.blockId}`));
    for (const key of blocks) {
      if (++looked > 80) break;
      const [via, blockId] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
      for (const u of content.units) {
        if (u.blockId !== blockId || u.field === 'name') continue;
        const text = u.text.replaceAll(SEPARATOR, ' ');
        for (const h of scan(src.snap.registry, text, { heading: via === 'heading', ep })) {
          if (h.kind !== 'scene' || h.ref !== code || h.hidden) continue;
          const raw = text.slice(h.s, h.e).trim();
          if (!raw || raw === code) continue;
          counts.set(raw, (counts.get(raw) ?? 0) + 1);
        }
      }
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, max).map(([raw]) => raw);
}

export function sceneLive(src: LiveSource, code: string): SceneLive {
  const { snap } = src;
  const rel = entityRelations(snap, 'scene', code);
  const roles = snap.registration.roles;
  const order = pageOrder(snap);
  const title = (id: string) => src.title(id) ?? '';
  const entry = snap.registry.scenes.get(code);

  // Sus fichas: lo de adentro de la escena (vistas, no excluidas), estén leídas o no.
  const cards: PageChip[] = [];
  for (const [id, role] of roles) {
    if (role.excluded || role.partOf?.kind !== 'scene' || role.partOf.ref !== code) continue;
    if (src.title(id) === undefined) continue;
    cards.push({ pageId: id, title: title(id) });
  }
  cards.sort((a, b) => (order.get(a.pageId) ?? 0) - (order.get(b.pageId) ?? 0));
  const ownIds = new Set<string>([...(rel.pageId ? [rel.pageId] : []), ...cards.map((c) => c.pageId)]);

  // Locaciones que nombra su desglose; y si dice «No VFX» (la escena, o cada ficha con texto).
  const planned = new Map<string, PageChip>();
  let sceneNoVfx = false;
  const noVfxCards = { no: 0, of: 0 };
  for (const id of ownIds) {
    const pr = snap.pages.get(id);
    for (const m of pr?.mentions ?? []) {
      if (m.kind !== 'loc' || planned.has(m.ref)) continue;
      const loc = snap.registry.locations.get(m.ref);
      planned.set(m.ref, { pageId: loc?.pageId ?? '', title: m.ref, blockId: m.blockId });
    }
    const content = src.content(id);
    const says = !!content?.units.some((u) => u.field === 'text' && NO_VFX.test(flat(u.text)));
    if (id === rel.pageId) {
      sceneNoVfx = says;
    } else if (content?.units.some((u) => u.field === 'text')) {
      noVfxCards.of++;
      if (says) noVfxCards.no++;
    }
  }
  const noVfx = sceneNoVfx || (noVfxCards.of > 0 && noVfxCards.no === noVfxCards.of);

  const breakdown: Excerpt[] = [];
  const scouting: Excerpt[] = [];
  const shoot: Excerpt[] = [];
  const scoutPages: PageChip[] = [];
  const also: PageChip[] = [];
  const indexPagesList: PageChip[] = [];
  const dayMap = new Map<string, SceneDay>();
  const planMap = new Map<string, { day: DayRef; items: Excerpt[] }>();
  const bdPhotos: PhotoRef[] = [];
  const scoutPhotos: PhotoRef[] = [];

  // Las fichas: un extracto cada una, con sus fotos (todas son de la escena).
  for (const c of cards) {
    const pr = snap.pages.get(c.pageId);
    const photos = photosOfPage(pr, c.pageId, BREAKDOWN);
    bdPhotos.push(...photos);
    const pb = pageBlocks(src.content(c.pageId));
    breakdown.push({ place: { pageId: c.pageId, blockId: pb?.ids[0] ?? '' }, pageId: c.pageId, pageTitle: c.title, day: null, heading: '', text: pageText(pb), part: '', shared: [], photos, kind: 'card' });
  }
  // Las fotos de la página de la escena misma también son del desglose.
  if (rel.pageId) bdPhotos.unshift(...photosOfPage(snap.pages.get(rel.pageId), rel.pageId, BREAKDOWN));

  for (const p of rel.pages) {
    const pageTitle = title(p.pageId);
    if (p.indexPage) {
      indexPagesList.push({ pageId: p.pageId, title: pageTitle, blockId: p.mentions[0]?.blockId });
      continue;
    }
    if (p.own) continue;
    const pb = pageBlocks(src.content(p.pageId));
    const sectionEx = (s: Section, day: DayRef | null, source: string): Excerpt => {
      const mine = s.scenes.find((x) => x.kind === 'scene' && x.ref === code);
      return {
        place: sectionPlace(p.pageId, s),
        pageId: p.pageId,
        pageTitle,
        day,
        heading: s.title,
        text: sectionText(pb, s),
        part: mine?.part ?? '',
        shared: s.scenes.filter((x) => x.kind === 'scene' && x.ref !== code).map((x) => x.ref),
        photos: photosOfSection(p.pageId, s, source),
        kind: 'section',
      };
    };
    const mentionEx = (m: Mention, day: DayRef | null): Excerpt => ({
      place: { pageId: p.pageId, blockId: m.blockId },
      pageId: p.pageId,
      pageTitle,
      day,
      heading: '',
      text: blockText(pb, m.blockId),
      part: m.part,
      shared: [],
      photos: [],
      kind: 'mention',
    });
    if (p.stage === 'shoot' && roles.get(p.pageId)?.entity?.kind !== 'day') {
      // Adentro de un día, pero no el reporte (el plan del día): planeada, no filmada (D400).
      const day = dayRef(src, p.pageId);
      const entry = planMap.get(day.pageId) ?? { day, items: [] };
      planMap.set(day.pageId, entry);
      for (const s of p.sections) entry.items.push(sectionEx(s, day, day.label));
      for (const m of looseMentions(p)) entry.items.push(mentionEx(m, day));
    } else if (p.stage === 'shoot') {
      const day = dayRef(src, p.pageId);
      const entry = dayMap.get(day.pageId) ?? { day, sections: [], mentions: [], photos: [] };
      dayMap.set(day.pageId, entry);
      for (const s of p.sections) {
        const ex = sectionEx(s, day, day.label);
        entry.sections.push(ex);
        entry.photos.push(...ex.photos);
      }
      for (const m of looseMentions(p)) entry.mentions.push(mentionEx(m, day));
    } else if (p.stage === 'scouting') {
      const source = shortTitle(pageTitle, 24);
      scoutPages.push({ pageId: p.pageId, title: pageTitle, blockId: p.sections[0]?.blockId ?? p.mentions[0]?.blockId });
      for (const s of p.sections) {
        const ex = sectionEx(s, null, source);
        scouting.push(ex);
        scoutPhotos.push(...ex.photos);
      }
      for (const m of looseMentions(p)) scouting.push(mentionEx(m, null));
    } else if (p.stage === 'breakdown') {
      for (const s of p.sections) breakdown.push(sectionEx(s, null, BREAKDOWN));
      for (const m of looseMentions(p)) breakdown.push(mentionEx(m, null));
    } else {
      const first = p.sections[0]?.blockId ?? p.mentions.find((m) => !m.hidden)?.blockId ?? p.mentions[0]?.blockId;
      also.push({ pageId: p.pageId, title: pageTitle, blockId: first });
    }
  }

  const days = [...dayMap.values()].sort((a, b) => byDay(a.day, b.day, order));
  for (const d of days) {
    d.photos = uniquePhotos(d.photos);
    shoot.push(...d.sections, ...d.mentions);
  }

  // Si ningún scouting la nombra: los scoutings de las locaciones donde se filmó (por el título del día).
  const scoutsVia: SceneLive['scoutsVia'] = [];
  if (!scoutPages.length) {
    const shotLocs = new Set(days.filter((d) => d.sections.length).flatMap((d) => d.day.locs));
    for (const [id, role] of roles) {
      if (role.excluded || role.partOf?.kind !== 'location' || !role.partOf.ref || !shotLocs.has(role.partOf.ref)) continue;
      if (!snap.pages.has(id) && src.title(id) === undefined) continue;
      scoutsVia.push({ pageId: id, title: title(id), loc: role.partOf.ref });
    }
    scoutsVia.sort((a, b) => (order.get(a.pageId) ?? 0) - (order.get(b.pageId) ?? 0));
  }

  const shootPhotos = days.flatMap((d) => d.photos);
  return {
    code,
    pageId: entry?.pageId ?? rel.pageId,
    episode: entry?.ep || null,
    aliases: sceneAliases(src, rel.pages, code),
    cards,
    plannedAt: [...planned.values()],
    scoutPages,
    scoutsVia,
    breakdown,
    scouting,
    shoot,
    days,
    // Un día que ya tiene una sección de la escena no se repite como «planeada» (O3 de la auditoría).
    plannedDays: [...planMap.values()].filter((p) => !days.some((d) => d.day.pageId === p.day.pageId && d.sections.length)).sort((a, b) => byDay(a.day, b.day, order)),
    also,
    indexPages: indexPagesList,
    photos: uniquePhotos([...bdPhotos, ...scoutPhotos, ...shootPhotos]),
    noVfx,
    noVfxCards,
    complete: rel.complete,
  };
}

/** Las escenas filmadas por día: en una sola pasada por los días (para la locación y sus escenas planeadas). */
function sceneDays(src: LiveSource): Map<string, DayRef[]> {
  const out = new Map<string, DayRef[]>();
  for (const [pageId, rel] of src.snap.pages) {
    const role = src.snap.registration.roles.get(pageId);
    // Solo el reporte del día: lo de adentro (el plan) no dice que se filmó (D400).
    if (!role || role.entity?.kind !== 'day' || rel.entities > INDEX_PAGE_MIN) continue;
    let day: DayRef | null = null;
    for (const s of rel.sections) {
      for (const x of s.scenes) {
        if (x.kind !== 'scene') continue;
        day ??= dayRef(src, pageId);
        const list = out.get(x.ref) ?? [];
        if (!list.some((d) => d.pageId === day!.pageId)) list.push(day);
        out.set(x.ref, list);
      }
    }
  }
  return out;
}

// --- Locación ------------------------------------------------------------------------------------------------------

export function locationLive(src: LiveSource, name: string): LocationLive {
  const { snap } = src;
  const rel = entityRelations(snap, 'loc', name);
  const roles = snap.registration.roles;
  const order = pageOrder(snap);
  const title = (id: string) => src.title(id) ?? '';
  const entry = snap.registry.locations.get(name);
  const shotDays = sceneDays(src);

  // Escenas cuyo desglose (la escena o sus fichas) la nombra.
  const plannedCodes = new Map<string, true>();
  const also: PageChip[] = [];
  const indexPagesList: PageChip[] = [];
  for (const p of rel.pages) {
    if (p.indexPage) {
      indexPagesList.push({ pageId: p.pageId, title: title(p.pageId), blockId: p.mentions[0]?.blockId });
      continue;
    }
    const role = roles.get(p.pageId);
    const scene = role?.entity?.kind === 'scene' ? role.entity.ref : role?.partOf?.kind === 'scene' ? role.partOf.ref : null;
    if (scene) {
      plannedCodes.set(scene, true);
      continue;
    }
    if (p.own) continue;
    // Los días cuyo título la nombra se muestran aparte (columna Rodaje).
    if (p.stage === 'shoot' && dayRef(src, p.pageId).locs.includes(name)) continue;
    also.push({ pageId: p.pageId, title: title(p.pageId), blockId: p.mentions.find((m) => !m.hidden)?.blockId });
  }
  const planned = [...plannedCodes.keys()]
    .sort()
    .map((code) => {
      const e = snap.registry.scenes.get(code);
      return { code, pageId: e?.pageId ?? null, title: e?.pageId ? title(e.pageId) : '', days: (shotDays.get(code) ?? []).slice().sort((a, b) => byDay(a, b, order)) };
    });

  // Sus scoutings: lo de adentro de la locación.
  const scouts: LocationLive['scouts'] = [];
  const scouting: Excerpt[] = [];
  const scoutPhotos: PhotoRef[] = [];
  for (const [id, role] of roles) {
    if (role.excluded || role.partOf?.kind !== 'location' || role.partOf.ref !== name) continue;
    if (src.title(id) === undefined) continue;
    const pr = snap.pages.get(id);
    const source = shortTitle(title(id), 24);
    const photos = photosOfPage(pr, id, source);
    scouts.push({ pageId: id, title: title(id), photos: new Set(photos.map((x) => x.id)).size });
    scoutPhotos.push(...photos);
    const pb = pageBlocks(src.content(id));
    scouting.push({ place: { pageId: id, blockId: pb?.ids[0] ?? '' }, pageId: id, pageTitle: title(id), day: null, heading: '', text: pageText(pb), part: '', shared: [], photos, kind: 'page' });
  }
  scouts.sort((a, b) => (order.get(a.pageId) ?? 0) - (order.get(b.pageId) ?? 0));
  const ownPhotos = rel.pageId ? photosOfPage(snap.pages.get(rel.pageId), rel.pageId, LOCATION) : [];

  // Sus días: los que la nombran en el título («per the day title»).
  const days: LocationDay[] = [];
  for (const [pageId, pr] of snap.pages) {
    const role = roles.get(pageId);
    if (role?.entity?.kind !== 'day' || pr.entities > INDEX_PAGE_MIN) continue;
    const day = dayRef(src, pageId);
    if (!day.locs.includes(name)) continue;
    const pb = pageBlocks(src.content(pageId));
    const scenes: LocationDay['scenes'] = [];
    const unresolved: Excerpt[] = [];
    const sections: Excerpt[] = [];
    pr.sections.forEach((s, i) => {
      const outer = !pr.sections.some((o, j) => j < i && o.block < s.block && o.end >= s.end);
      const own = s.scenes.filter((x) => x.kind === 'scene');
      const ex: Excerpt = {
        place: sectionPlace(pageId, s),
        pageId,
        pageTitle: title(pageId),
        day,
        heading: s.title,
        text: sectionText(pb, s),
        part: '',
        shared: own.map((x) => x.ref),
        photos: photosOfSection(pageId, s, day.label),
        kind: 'section',
      };
      if (own.length) {
        for (const x of own) if (!scenes.some((y) => y.code === x.ref)) scenes.push({ code: x.ref, pageId: snap.registry.scenes.get(x.ref)?.pageId ?? null });
        if (!pr.sections.some((o, j) => j < i && o.block < s.block && o.end >= s.end && o.scenes.some((y) => y.kind === 'scene'))) sections.push(ex);
      } else if (outer && s.media.length) {
        unresolved.push(ex);
        sections.push(ex);
      }
    });
    days.push({ day, scenes, unresolved, sections, photos: uniquePhotos(photosOfPage(pr, pageId, day.label)) });
  }
  days.sort((a, b) => byDay(a.day, b.day, order));

  return {
    name,
    pageId: entry?.pageId ?? rel.pageId,
    aliases: (entry?.aliases ?? []).filter((a) => a !== name),
    planned,
    scouts,
    scouting,
    days,
    noReport: planned.filter((s) => !s.days.length).map((s) => s.code),
    also,
    indexPages: indexPagesList,
    photos: uniquePhotos([...ownPhotos, ...scoutPhotos, ...days.flatMap((d) => d.photos)]),
    complete: rel.complete,
  };
}
