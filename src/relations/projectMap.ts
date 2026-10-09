import { SEPARATOR } from '../search/extract';
import { dayList, planOf, sceneTitleOf, type PlanSource } from './dayLive';
import { GENERAL_SECTION, type LiveSource } from './liveView';
import { INDEX_PAGE_MIN, type MentionVia, type Section } from './pageRelations';
import { fold } from './reader';
import { pendingRelations } from './relationIndex';
import { withoutDraft } from './slashDraft';
import type { Stage } from './register';

// El mapa del proyecto (Docs/Doc_Relaciones.md, sección 12; diseño S4 «D», `e_mapa.html`): locaciones en el tiempo,
// escenas, días y pendientes, armados en una sola pasada por la foto del índice de relaciones. Puro: nada se guarda; lo
// que dice sale de lo que la persona ve (la foto ya no tiene lo que no ve). Con las mismas reglas que la cabecera viva:
// «filmada» solo por una sección de un reporte (la locación, la del título del día, D398), «planeada en» por lo que
// nombra su desglose (D393), y nunca «no se filmó».
//
// También arma lo que se copia para un asistente (`mapJson`, formato estable y documentado; `mapText`, legible).

export interface MapSectionRef {
  blockId: string;
  /** El bloque que la cierra (`null`: hasta el final de la página). */
  endBlockId: string | null;
  title: string;
  photos: number;
}

export interface MapDaySection extends MapSectionRef {
  /** Las escenas que nombra el título (la más externa de cada una). */
  scenes: string[];
  /** Escenas nombradas que no existen. */
  pending: string[];
}

export interface MapDay {
  pageId: string;
  title: string;
  /** «Día 59», o el título. */
  label: string;
  date: string | null;
  /** Las locaciones que nombra el título del día (D398). */
  locs: string[];
  /** El reporte tiene algo escrito (un renglón que no es un título) o fotos. */
  written: boolean;
  sections: MapDaySection[];
  /** Escenas con una sección en el reporte. */
  scenes: string[];
  /** El plan del día (su página *Plan*, o las fichas con esa fecha; D430). */
  planned: string[];
  planSource: PlanSource;
  /** Secciones de arriba sin número de escena y con fotos («Plates ambulancia»), sin la general. */
  unnumbered: MapSectionRef[];
}

/** Dónde nombra una página a una entidad. */
export interface MapMention {
  pageId: string;
  stage: Stage;
  /** La página es la entidad o parte de ella (una ficha, un scouting). */
  own: boolean;
  /** Una página índice (nombra más de 20 escenas y locaciones). */
  index: boolean;
  via: MentionVia[];
  /** Los bloques que la nombran, en orden y sin repetir. */
  blockIds: string[];
  /** Las secciones de esa página que son de la escena (la más externa de cada tramo). */
  sections: MapSectionRef[];
}

export interface MapSceneShot {
  dayId: string;
  label: string;
  date: string | null;
  locs: string[];
  sections: MapSectionRef[];
}

export interface MapScene {
  code: string;
  pageId: string | null;
  /** Su título sin el número. */
  title: string;
  episode: string | null;
  /** Locaciones que nombra su desglose (la escena y sus fichas, D393). */
  plannedAt: string[];
  /** Días cuyo reporte tiene una sección suya, en orden de fecha. */
  shot: MapSceneShot[];
  /** Días cuyo plan la nombra. */
  plannedDays: string[];
  /** Sus fichas (lo de adentro). */
  cards: string[];
  mentions: MapMention[];
}

export interface MapLocation {
  name: string;
  pageId: string | null;
  aliases: string[];
  /** Los días cuyo título la nombra, en orden de fecha. */
  days: string[];
  /** Escenas cuyo desglose la nombra. */
  planned: string[];
  /** Escenas con sección en el reporte de uno de sus días. */
  shot: string[];
  /** Lo de adentro de la locación (los scoutings). */
  scouts: string[];
  mentions: MapMention[];
}

export interface MapPending {
  code: string;
  mentions: { pageId: string; blockIds: string[] }[];
}

export interface MapPage {
  title: string;
  stage: Stage;
  kind: 'scene' | 'location' | 'day' | 'part' | 'page';
}

export interface ProjectMapData {
  scenes: MapScene[];
  locations: MapLocation[];
  days: MapDay[];
  pending: MapPending[];
  /**
   * Escenas con el mismo código en dos páginas o más que la persona ve (las relaciones usan la primera del árbol) y, con
   * `kind: 'day'`, reportes del día con el mismo título (dos dispositivos que crearon el mismo día a la vez, D580).
   */
  duplicates: { code: string; pageIds: string[]; kind?: 'day' }[];
  /** Las secciones sin número con fotos de todos los días. */
  unnumbered: (MapSectionRef & { dayId: string })[];
  /** Las páginas que se nombran en el mapa, con su título. */
  pages: Map<string, MapPage>;
  /** Todo leído y nada por bajar (si es `false`, lo que falta puede aparecer: no se afirman ceros, D402). */
  complete: boolean;
}

const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Las secciones de una página que nombran escenas (la más externa de cada una) y las de arriba sin número. */
function outerSections(sections: Section[]): { s: Section; scenes: Section['scenes'] }[] {
  // Igual que en `dayLive.ts`: una escena que ya cuenta una sección de afuera no se repite en la de adentro.
  const out: { s: Section; scenes: Section['scenes'] }[] = [];
  sections.forEach((s, i) => {
    const inside = (pred: (o: Section) => boolean) => sections.some((o, j) => j < i && o.block < s.block && o.end >= s.end && pred(o));
    if (s.scenes.length) {
      const own = s.scenes.filter((x) => !inside((o) => o.scenes.some((y) => y.kind === x.kind && y.ref === x.ref)));
      if (own.length) out.push({ s, scenes: own });
    } else if (!inside(() => true)) {
      out.push({ s, scenes: [] });
    }
  });
  return out;
}

const sectionRef = (s: Section): MapSectionRef => ({ blockId: s.blockId, endBlockId: s.endBlockId, title: s.title, photos: s.media.length });

/**
 * Las secciones de un reporte: las de escena (la más externa de cada una) y las de arriba sin número y con fotos, sin la
 * general («Info general», o la primera de arriba sin número: es del día, D429).
 */
function daySections(sections: Section[]): { scenes: { s: Section; named: Section['scenes'] }[]; unnumbered: Section[] } {
  const scenes: { s: Section; named: Section['scenes'] }[] = [];
  const unnumbered: Section[] = [];
  let firstUnnumbered = true;
  for (const { s, scenes: named } of outerSections(sections)) {
    if (named.length) {
      scenes.push({ s, named });
      continue;
    }
    const general = firstUnnumbered || GENERAL_SECTION.test(s.title);
    firstUnnumbered = false;
    if (!general && s.media.length) unnumbered.push(s);
  }
  return { scenes, unnumbered };
}

/**
 * Lo que espera en *Map › Pending*, contado sin armar el mapa entero (para la fila *Map* de la barra lateral): números
 * nombrados que no existen (o que la persona no ve), escenas en dos páginas y secciones con fotos sin número.
 */
export function pendingSummary(src: Pick<LiveSource, 'snap' | 'title'>): { pending: number; duplicates: number; unnumbered: number; total: number } {
  const { snap } = src;
  let unnumbered = 0;
  for (const [pageId, rel] of snap.pages) {
    const role = snap.registration.roles.get(pageId);
    if (role?.excluded || role?.entity?.kind !== 'day' || rel.entities > INDEX_PAGE_MIN || src.title(pageId) === undefined) continue;
    unnumbered += daySections(rel.sections).unnumbered.length;
  }
  // Sin lo que se está tipeando en el menú `/` de escenas (D568).
  const pending = withoutDraft(pendingRelations(snap)).length;
  const duplicates = snap.registration.duplicates.filter((d) => d.pageIds.filter((id) => src.title(id) !== undefined).length > 1).length + dayTwins(src).length;
  return { pending, duplicates, unnumbered, total: pending + duplicates + unnumbered };
}

/**
 * Los días de rodaje con el mismo título (con su fecha) en dos páginas o más que la persona ve: lo que dejan dos
 * dispositivos que crean el reporte de mañana a la vez (D580). Una segunda unidad con el mismo título también sale: la
 * persona decide (el renglón de ayuda lo dice). Nada se borra solo.
 */
export function dayTwins(src: Pick<LiveSource, 'snap' | 'title'>): { code: string; pageIds: string[]; kind: 'day' }[] {
  const by = new Map<string, string[]>();
  for (const d of dayList(src as LiveSource)) {
    if (!d.date) continue;
    const title = (src.title(d.pageId) ?? '').replace(/\s+/g, ' ').trim();
    const list = by.get(title) ?? [];
    list.push(d.pageId);
    by.set(title, list);
  }
  return [...by].filter(([, ids]) => ids.length > 1).map(([code, pageIds]) => ({ code, pageIds, kind: 'day' as const }));
}

/** Si un reporte tiene algo escrito: un renglón con texto que no es un título, o fotos. */
function written(src: LiveSource, pageId: string, media: number): boolean {
  if (media > 0) return true;
  const content = src.content(pageId);
  if (!content) return false;
  const headings = new Set(content.meta.filter((m) => m.level > 0).map((m) => m.blockId));
  return content.units.some((u) => u.field === 'text' && !headings.has(u.blockId) && u.text.replaceAll(SEPARATOR, ' ').trim().length > 0);
}

/** El mapa entero, en una pasada por la foto del índice. */
export function projectMap(src: LiveSource): ProjectMapData {
  const { snap } = src;
  const roles = snap.registration.roles;
  const pages = new Map<string, MapPage>();
  const notePage = (pageId: string) => {
    if (pages.has(pageId)) return;
    const role = roles.get(pageId);
    const kind: MapPage['kind'] = role?.entity ? (role.entity.kind === 'location' ? 'location' : role.entity.kind) : role?.partOf ? 'part' : 'page';
    pages.set(pageId, { title: src.title(pageId) ?? '', stage: role?.stage ?? 'other', kind });
  };

  // 1. Los días: en orden de fecha, con sus secciones, su plan y si tienen algo escrito.
  const days: MapDay[] = [];
  const unnumbered: ProjectMapData['unnumbered'] = [];
  for (const ref of dayList(src)) {
    const rel = snap.pages.get(ref.pageId);
    const sections: MapDaySection[] = [];
    const dayUnnumbered: MapSectionRef[] = [];
    const scenes: string[] = [];
    if (rel && rel.entities <= INDEX_PAGE_MIN) {
      const parts = daySections(rel.sections);
      for (const s of parts.unnumbered) {
        const r = sectionRef(s);
        dayUnnumbered.push(r);
        unnumbered.push({ ...r, dayId: ref.pageId });
      }
      for (const { s, named } of parts.scenes) {
        const codes = named.filter((x) => x.kind === 'scene').map((x) => x.ref);
        for (const c of codes) if (!scenes.includes(c)) scenes.push(c);
        sections.push({ ...sectionRef(s), scenes: codes, pending: named.filter((x) => x.kind === 'pending').map((x) => x.ref) });
      }
    }
    const plan = planOf(src, ref);
    days.push({
      pageId: ref.pageId,
      title: src.title(ref.pageId) ?? '',
      label: ref.label,
      date: ref.date,
      locs: ref.locs,
      written: written(src, ref.pageId, rel?.media.reduce((n, m) => n + m.ids.length, 0) ?? 0),
      sections,
      scenes,
      planned: plan.codes,
      planSource: plan.source,
      unnumbered: dayUnnumbered,
    });
    notePage(ref.pageId);
  }
  const dayById = new Map(days.map((d) => [d.pageId, d]));

  // 2. Las menciones de cada escena y locación, en una pasada por las páginas (en el orden de la barra lateral).
  const sceneMentions = new Map<string, MapMention[]>();
  const locMentions = new Map<string, MapMention[]>();
  for (const [pageId, rel] of snap.pages) {
    const role = roles.get(pageId);
    const index = rel.entities > INDEX_PAGE_MIN;
    const by = new Map<string, MapMention>();
    const entry = (kind: 'scene' | 'loc', ref: string): MapMention => {
      const key = `${kind}:${ref}`;
      let m = by.get(key);
      if (!m) {
        const k = kind === 'loc' ? 'location' : 'scene';
        const own = (role?.entity?.kind === k && role.entity.ref === ref) || (role?.partOf?.kind === k && role.partOf.ref === ref);
        m = { pageId, stage: role?.stage ?? 'other', own, index, via: [], blockIds: [], sections: [] };
        by.set(key, m);
        const list = (kind === 'scene' ? sceneMentions : locMentions).get(ref) ?? [];
        list.push(m);
        (kind === 'scene' ? sceneMentions : locMentions).set(ref, list);
      }
      return m;
    };
    for (const men of rel.mentions) {
      if (men.kind === 'pending') continue;
      const m = entry(men.kind, men.ref);
      if (!m.via.includes(men.via)) m.via.push(men.via);
      if (!m.blockIds.includes(men.blockId)) m.blockIds.push(men.blockId);
    }
    for (const { s, scenes } of outerSections(rel.sections)) {
      for (const x of scenes) if (x.kind === 'scene') entry('scene', x.ref).sections.push(sectionRef(s));
    }
    if (by.size) notePage(pageId);
  }

  // 3. Las escenas, por código.
  const planByScene = new Map<string, string[]>();
  for (const d of days) for (const c of d.planned) planByScene.set(c, [...(planByScene.get(c) ?? []), d.pageId]);
  const cardsOf = new Map<string, string[]>();
  for (const [id, role] of roles) {
    if (role.excluded || role.partOf?.kind !== 'scene' || !role.partOf.ref || src.title(id) === undefined) continue;
    cardsOf.set(role.partOf.ref, [...(cardsOf.get(role.partOf.ref) ?? []), id]);
  }
  const scenes: MapScene[] = [];
  for (const entry of [...snap.registry.scenes.values()].sort((a, b) => byCode(a.code, b.code))) {
    const code = entry.code;
    const mentions = sceneMentions.get(code) ?? [];
    // «Planeada en»: las locaciones que nombran la escena y sus fichas (no las páginas índice).
    const ownIds = new Set([...(entry.pageId ? [entry.pageId] : []), ...(cardsOf.get(code) ?? [])]);
    const plannedAt: string[] = [];
    for (const id of ownIds) {
      const rel = snap.pages.get(id);
      if (!rel || rel.entities > INDEX_PAGE_MIN) continue;
      for (const m of rel.mentions) if (m.kind === 'loc' && !plannedAt.includes(m.ref)) plannedAt.push(m.ref);
    }
    const shot: MapSceneShot[] = [];
    for (const m of mentions) {
      const d = dayById.get(m.pageId);
      if (!d || roles.get(m.pageId)?.entity?.kind !== 'day' || !m.sections.length || m.index) continue;
      shot.push({ dayId: d.pageId, label: d.label, date: d.date, locs: d.locs, sections: m.sections });
    }
    shot.sort((a, b) => (a.date ?? '9999') < (b.date ?? '9999') ? -1 : (a.date ?? '9999') > (b.date ?? '9999') ? 1 : 0);
    if (entry.pageId) notePage(entry.pageId);
    scenes.push({
      code,
      pageId: entry.pageId && src.title(entry.pageId) !== undefined ? entry.pageId : null,
      title: entry.pageId ? sceneTitleOf(src.title(entry.pageId)) : '',
      episode: entry.ep || null,
      plannedAt,
      shot,
      plannedDays: (planByScene.get(code) ?? []).filter((id) => !shot.some((s) => s.dayId === id)),
      cards: (cardsOf.get(code) ?? []).map((id) => (notePage(id), id)),
      mentions,
    });
  }

  // 4. Las locaciones, por su primer día (las que no tienen días, al final, por nombre).
  const locations: MapLocation[] = [];
  for (const entry of snap.registry.locations.values()) {
    const name = entry.name;
    const its = days.filter((d) => d.locs.includes(name));
    const planned = scenes.filter((s) => s.plannedAt.includes(name)).map((s) => s.code);
    const shotSet = new Set<string>();
    for (const d of its) for (const c of d.scenes) shotSet.add(c);
    const scouts: string[] = [];
    for (const [id, role] of roles) {
      if (role.excluded || role.partOf?.kind !== 'location' || role.partOf.ref !== name || src.title(id) === undefined) continue;
      scouts.push(id);
      notePage(id);
    }
    if (entry.pageId) notePage(entry.pageId);
    locations.push({
      name,
      pageId: entry.pageId && src.title(entry.pageId) !== undefined ? entry.pageId : null,
      aliases: entry.aliases.filter((a) => a !== name),
      days: its.map((d) => d.pageId),
      planned,
      shot: [...shotSet].sort(byCode),
      scouts,
      mentions: locMentions.get(name) ?? [],
    });
  }
  const firstDate = (l: MapLocation) => dayById.get(l.days[0] ?? '')?.date ?? null;
  locations.sort((a, b) => {
    const x = firstDate(a);
    const y = firstDate(b);
    if (x !== y) return x === null ? 1 : y === null ? -1 : x < y ? -1 : 1;
    if (!!a.days.length !== !!b.days.length) return a.days.length ? -1 : 1;
    return fold(a.name) < fold(b.name) ? -1 : fold(a.name) > fold(b.name) ? 1 : 0;
  });

  const pending: MapPending[] = withoutDraft(pendingRelations(snap)).map((p) => ({ code: p.ref, mentions: p.pages }));
  for (const p of pending) for (const m of p.mentions) notePage(m.pageId);
  const duplicates = snap.registration.duplicates
    .map((d) => ({ code: d.code, pageIds: d.pageIds.filter((id) => src.title(id) !== undefined) }))
    .filter((d) => d.pageIds.length > 1);
  const allDuplicates = [...duplicates, ...dayTwins(src)];
  for (const d of allDuplicates) for (const id of d.pageIds) notePage(id);
  return { scenes, locations, days, pending, duplicates: allDuplicates, unnumbered, pages, complete: snap.complete };
}

/**
 * Los números del mapa. `pending`, `duplicates` y `unnumbered` van separados (en el JSON, cada uno es el largo de su
 * lista); `toResolve` es la suma, el número de la pestaña *Pending* y de la fila *Map* de la barra lateral.
 */
export function mapCounts(m: ProjectMapData): { scenes: number; locations: number; days: number; pending: number; duplicates: number; unnumbered: number; toResolve: number } {
  const pending = m.pending.length;
  const duplicates = m.duplicates.length;
  const unnumbered = m.unnumbered.length;
  return { scenes: m.scenes.length, locations: m.locations.length, days: m.days.length, pending, duplicates, unnumbered, toResolve: pending + duplicates + unnumbered };
}

// --- Lo que se copia para un asistente ---------------------------------------------------------------------------

/** El formato del JSON del mapa: `shotdocs.map`, versión 1 (Docs/Doc_Relaciones.md, sección 12). */
export const MAP_FORMAT = 'shotdocs.map';
export const MAP_VERSION = 1;

export interface MapMeta {
  project: { id: string; name: string };
  /** La dirección de la app (`https://shotdocs.lega.com.ar`): con ella cada página lleva su link. */
  origin: string;
  /** Quien copia ve solo una parte del proyecto (un invitado a una rama). */
  partial: boolean;
  builtAt: string;
}

const sec = (s: MapSectionRef) => ({ block: s.blockId, end: s.endBlockId, title: s.title, photos: s.photos });
const men = (m: MapMention) => ({
  page: m.pageId,
  stage: m.stage,
  ...(m.own ? { own: true } : {}),
  ...(m.index ? { index: true } : {}),
  via: m.via,
  blocks: m.blockIds,
  ...(m.sections.length ? { sections: m.sections.map(sec) } : {}),
});

/**
 * El mapa como JSON para un asistente (y el MCP que venga): un objeto con forma fija. Las páginas van una vez, en
 * `pages` (id → título, link, tipo, etapa); todo lo demás las nombra por su id. Solo lo que la persona ve.
 */
export function mapJson(m: ProjectMapData, meta: MapMeta): unknown {
  const pages: Record<string, unknown> = {};
  for (const [id, p] of m.pages) pages[id] = { title: p.title, kind: p.kind, stage: p.stage };
  return {
    format: MAP_FORMAT,
    version: MAP_VERSION,
    project: meta.project,
    // El link de una página: `pageUrl` con `{id}` reemplazado (no se repite en cada página: el mapa de ERSO pesa menos).
    pageUrl: `${meta.origin}/p/{id}`,
    builtAt: meta.builtAt,
    complete: m.complete,
    scope: meta.partial ? 'visible' : 'project',
    counts: (({ toResolve: _t, ...c }) => c)(mapCounts(m)),
    scenes: m.scenes.map((s) => ({
      code: s.code,
      page: s.pageId,
      title: s.title,
      episode: s.episode,
      plannedAt: s.plannedAt,
      shot: s.shot.map((x) => ({ day: x.dayId, date: x.date, locations: x.locs, sections: x.sections.map(sec) })),
      plannedDays: s.plannedDays,
      cards: s.cards,
      mentions: s.mentions.map(men),
    })),
    locations: m.locations.map((l) => ({
      name: l.name,
      page: l.pageId,
      aliases: l.aliases,
      days: l.days,
      planned: l.planned,
      shot: l.shot,
      scouts: l.scouts,
      mentions: l.mentions.map(men),
    })),
    days: m.days.map((d) => ({
      page: d.pageId,
      label: d.label,
      date: d.date,
      locations: d.locs,
      written: d.written,
      plan: { source: d.planSource, scenes: d.planned },
      sections: d.sections.map((s) => ({ ...sec(s), scenes: s.scenes, ...(s.pending.length ? { pending: s.pending } : {}) })),
      ...(d.unnumbered.length ? { unnumbered: d.unnumbered.map(sec) } : {}),
    })),
    pending: m.pending.map((p) => ({ code: p.code, mentions: p.mentions.map((x) => ({ page: x.pageId, blocks: x.blockIds })) })),
    duplicates: m.duplicates.map((d) => ({ code: d.code, pages: d.pageIds })),
    pages,
  };
}

const plural = (n: number, one: string, other: string) => `${n} ${n === 1 ? one : other}`;
const list = (xs: string[], max = 12) => (xs.length > max ? `${xs.slice(0, max).join(', ')} +${xs.length - max}` : xs.join(', '));

/** El mapa como texto, para pegarlo en un chat o un documento: lo mismo que el JSON, sin ids. */
export function mapText(m: ProjectMapData, meta: MapMeta): string {
  const c = mapCounts(m);
  const title = (id: string) => m.pages.get(id)?.title ?? id;
  const day = (id: string) => {
    const d = m.days.find((x) => x.pageId === id);
    // «Día 59 (2026-02-19)»; un día sin número en el título («2026-03-15 | Sin reporte | …») va con su título solo.
    return d ? (d.date && !d.label.startsWith(d.date) ? `${d.label} (${d.date})` : d.label) : title(id);
  };
  const out: string[] = [];
  out.push(`# ${meta.project.name} — map`);
  out.push(
    `Built on this device on ${meta.builtAt.slice(0, 16).replace('T', ' ')} (UTC) from ${meta.partial ? 'the pages I can see (part of the project)' : 'every page of the project'}` +
      `${m.complete ? '' : ' (still reading: something may be missing)'}. ${plural(c.scenes, 'scene', 'scenes')} · ${plural(c.locations, 'location', 'locations')} · ${plural(c.days, 'shoot day', 'shoot days')}.`,
  );
  if (c.toResolve) {
    const parts = [
      c.pending ? `${c.pending} scene ${c.pending === 1 ? 'number' : 'numbers'} named ${meta.partial ? 'that are not in the pages I can see' : 'that don’t exist'}` : '',
      c.duplicates ? plural(c.duplicates, 'scene in more than one page', 'scenes in more than one page') : '',
      c.unnumbered ? plural(c.unnumbered, 'report section with photos and no scene number', 'report sections with photos and no scene number') : '',
    ].filter(Boolean);
    out.push(`To resolve: ${parts.join(' · ')}.`);
  }
  out.push('"Shot" means a day report has a section titled with the scene; the location of a day comes from its title.');
  out.push('');
  out.push('## Locations');
  for (const l of m.locations) {
    const scenes = [...new Set([...l.planned, ...l.shot])].sort(byCode);
    const parts = [plural(scenes.length, 'scene', 'scenes'), plural(l.days.length, 'day', 'days')];
    out.push(`- ${l.name}${l.aliases.length ? ` (also ${l.aliases.join(', ')})` : ''}: ${parts.join(' · ')}`);
    if (l.days.length) out.push(`  days: ${l.days.map(day).join(', ')}`);
    if (l.shot.length) out.push(`  shot here: ${list(l.shot)}`);
    const plannedOnly = l.planned.filter((s) => !l.shot.includes(s));
    if (plannedOnly.length) out.push(`  planned here (breakdown), no report section here: ${list(plannedOnly)}`);
    if (l.scouts.length) out.push(`  scouting: ${l.scouts.map(title).join(', ')}`);
  }
  out.push('');
  out.push('## Scenes');
  for (const s of m.scenes) {
    const bits: string[] = [];
    if (s.plannedAt.length) bits.push(`planned at ${s.plannedAt.join(', ')}`);
    if (s.shot.length) bits.push(`shot ${s.shot.map((x) => `${x.label}${x.locs.length ? ` at ${x.locs.join(' + ')}` : ''} (§ ${x.sections.map((y) => y.title).join(', ')})`).join('; ')}`);
    else bits.push('no report section');
    if (s.plannedDays.length) bits.push(`in the plan of ${s.plannedDays.map(day).join(', ')}`);
    const others = s.mentions.filter((x) => !x.own && !x.index && !s.shot.some((y) => y.dayId === x.pageId)).length;
    if (others) bits.push(`named in ${others} other ${others === 1 ? 'page' : 'pages'}`);
    out.push(`- ${s.code}${s.title ? ` ${s.title}` : ''}: ${bits.join(' · ')}`);
  }
  out.push('');
  out.push('## Shoot days');
  for (const d of m.days) {
    const bits = [d.locs.length ? d.locs.join(' + ') : 'no location in the title'];
    if (d.scenes.length) bits.push(`sections: ${d.scenes.join(', ')}`);
    else bits.push(d.written ? 'no scene section' : 'nothing written');
    if (d.planned.length) bits.push(`plan (${d.planSource === 'plan' ? 'Plan page' : 'breakdown date'}): ${list(d.planned)}`);
    if (d.unnumbered.length) bits.push(`without a scene number: ${d.unnumbered.map((u) => `«${u.title}»`).join(', ')}`);
    // El título ya empieza con la fecha en la forma de los reportes («2026-02-19 | Día 59 | Cenade»): no se repite.
    const t = title(d.pageId);
    out.push(`- ${d.date && !t.startsWith(d.date) ? `${d.date} ` : ''}${t}: ${bits.join(' · ')}`);
  }
  if (m.pending.length) {
    out.push('');
    // Quien ve una parte del proyecto no puede saber si la escena existe en una página que no ve (D401).
    out.push(meta.partial ? '## Scene numbers named that are not in the pages I can see (they may exist elsewhere)' : '## Pending (named, not created)');
    for (const p of m.pending) out.push(`- ${p.code}: named in ${p.mentions.map((x) => title(x.pageId)).join(', ')}`);
  }
  if (m.duplicates.length) {
    out.push('');
    out.push('## Scenes in more than one page');
    for (const d of m.duplicates) out.push(`- ${d.code}: ${d.pageIds.map(title).join(' / ')} (the first one counts)`);
  }
  return out.join('\n') + '\n';
}

/**
 * Lo que dice el título de un día además de la fecha y el número de día («Frente Ruso Villarino» en «2025-11-05 | Día 05 |
 * Frente Ruso Villarino»), para mostrarlo apagado cuando no nombra una locación que existe. Vacío si el rótulo del día
 * ya es el título entero.
 */
export function titlePlace(d: Pick<MapDay, 'title' | 'label' | 'date'>): string {
  if (!d.title || d.label === d.title) return '';
  return d.title
    .split('|')
    .map((p) => p.trim())
    .filter((p) => p && p !== d.date && p !== d.label && !/^\d{4}-\d{2}-\d{2}$/.test(p))
    .join(' | ');
}

/** Para pruebas y el filtro del mapa: el texto de una escena con sus otras formas sin separador (`105_027` → `105027 5027`). */
export function sceneFilterText(s: MapScene): string {
  const [ep, n] = s.code.includes('_') ? s.code.split('_') : ['', s.code];
  return fold(
    `${s.code} ${s.code.replace('_', '-')} ${ep}${n} ${ep ? ep.slice(-1) + n : ''} ${s.title} ${s.plannedAt.join(' ')} ${s.shot.flatMap((x) => [...x.locs, x.label, x.date ?? '']).join(' ')}`,
  );
}
