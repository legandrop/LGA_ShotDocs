import { fieldDate, fieldValues, normLabel, emptyValue, type FieldValue, type PageFields } from './fields';
import { INDEX_PAGE_MIN, type LinkTarget, type Section } from './pageRelations';
import { cardFields, findFields } from './relationIndex';
import { dayRef, GENERAL_SECTION, pageBlocks, sectionText, type DayRef, type LiveSource, type PageChip, type PhotoRef, type Place } from './liveView';

// Lo que muestra la cabecera viva de un día de rodaje y su tarjeta *Tomorrow* (Docs/Doc_Relaciones.md, sección 11;
// diseño S4 «D», `c_dia.html`). Puro: todo sale de la foto del índice de relaciones y de lo que la búsqueda ya leyó de
// cada página. Nada se guarda: lo escrito en el reporte manda, y la cabecera lo vuelve a leer cuando cambia.
//
// - **Las escenas del día** salen de los títulos de sección del reporte (la más externa de cada escena): «shot» si
//   tiene algo escrito o fotos, «prepared» si está vacía (la dejó *Prepare* o alguien que todavía no escribió), y
//   «shot · not in plan» si el plan del día existe y no la nombra. Las escenas del plan sin sección: «planned · no
//   section». Las secciones de arriba sin número y con fotos («Plates ambulancia») van con su aviso.
// - **El plan de un día**: lo de adentro del día que no es el reporte (la página *Plan*, D400) → si no hay, las fichas
//   del desglose cuyo campo *Fecha Rodaje* es esa fecha → si no, nada (se suma a mano en la tarjeta).
// - **Tomorrow**: el día siguiente (por fecha, y en el orden de la barra si dos tienen la misma) con su plan y qué
//   escenas ya tienen sección ahí.

export type DayStatus = 'shot' | 'prepared' | 'notInPlan';

export type DayRow =
  | {
      kind: 'scene';
      code: string;
      part: string;
      scenePageId: string | null;
      /** El título de la escena sin su número («La ambulancia empieza a zigzaguear»), en vivo. */
      sceneTitle: string;
      heading: string;
      place: Place;
      photos: number;
      status: DayStatus;
    }
  | { kind: 'pending'; code: string; heading: string; place: Place }
  | { kind: 'unnumbered'; heading: string; place: Place; photos: number }
  | { kind: 'planned'; code: string; scenePageId: string | null; sceneTitle: string };

export type PlanSource = 'plan' | 'breakdown' | 'none';

export interface DayPlan {
  /** Las escenas planeadas, en el orden del plan (o por número, si salen del desglose). */
  codes: string[];
  /** Páginas adentro del día que no nombran ninguna escena (un plan vacío, O5 de la auditoría). */
  empty?: PageChip[];
  source: PlanSource;
  /** Las páginas de adentro del día que las nombran (el plan). */
  pages: PageChip[];
  /** El rótulo del campo de fecha como está escrito en las fichas («Fecha Rodaje»), si salen del desglose. */
  label: string;
}

export interface DayQuestion {
  /** Las escenas del día que la tienen. */
  codes: string[];
  /** El primer renglón. */
  text: string;
  /** La ficha (o la escena) de donde sale, para ir ahí. */
  place: Place;
  /** El nombre corto de la ficha (su *Shot Name*), o vacío si es de la página de la escena. */
  shot: string;
  /** La categoría de la pregunta (campo *Consultas Cat*), si la tiene. */
  cat: string;
}

export interface TomorrowScene {
  code: string;
  scenePageId: string | null;
  sceneTitle: string;
  /** El reporte de mañana ya tiene una sección con esta escena en el título. */
  has: boolean;
}

export interface DayLive {
  day: DayRef;
  prev: DayRef | null;
  next: DayRef | null;
  rows: DayRow[];
  plan: DayPlan;
  questions: DayQuestion[];
  /** Escenas nombradas en el texto del reporte (fuera de una sección suya), sin repetir. */
  named: { code: string; scenePageId: string | null; place: Place }[];
  photos: PhotoRef[];
  /** Cuántas escenas distintas tiene el día (con sección o planeadas). */
  scenes: number;
  tomorrow: {
    day: DayRef;
    plan: DayPlan;
    scenes: TomorrowScene[];
    /** Escenas con más de una sección en el reporte de mañana y alguna vacía (preparado en dos dispositivos a la vez). */
    repeated: string[];
  } | null;
  complete: boolean;
}

/** Las palabras que van antes del número en un título de sección («Escena 105_029»), en el orden del proyecto. */
const SCENE_WORD = /^\s*(escena|esc\.?|scene|sc\.?)\s/i;

/** El título de una escena sin su número: «027 | La ambulancia…» → «La ambulancia…». */
export function sceneTitleOf(title: string | undefined): string {
  if (!title) return '';
  const parts = title.split('|').map((p) => p.trim()).filter(Boolean);
  // Sin el número de adelante («027 |») ni el código entero al final («| 105_027», la forma de ERSO; O3 de la auditoría).
  const rest = parts.filter((p, i) => !(i === 0 && /^\d/.test(p) && parts.length > 1) && !/^\d{3}[_-]\d{2,3}[A-Za-z]{0,2}$/.test(p));
  return rest.length ? rest.join(' | ') : title.trim();
}

/**
 * El rótulo corto de un día para un botón («Día 59»); si el título no tiene número de día, su fecha corta («15/03») o
 * el principio del título. El título entero va en el tooltip (B2 de la auditoría: «2026-03-15 | Sin reporte | …»).
 */
export function dayShortLabel(day: DayRef): string {
  if (/(?:^|\s)(?:day|d[ií]a)\s*\d/i.test(day.label)) return day.label;
  if (day.date) return `${day.date.slice(8, 10)}/${day.date.slice(5, 7)}`;
  return day.label.length > 18 ? `${day.label.slice(0, 17).trimEnd()}…` : day.label;
}



/** El pie de una foto del día: el título de su sección sin «Escena» («105_027b»). */
const sourceLabel = (heading: string) => heading.replace(SCENE_WORD, '').trim();

/** Los días que la persona ve, en orden de fecha (y en el de la barra lateral si dos tienen la misma). */
export function dayList(src: LiveSource): DayRef[] {
  const out: { ref: DayRef; i: number }[] = [];
  let i = 0;
  for (const [id, role] of src.snap.registration.roles) {
    i++;
    if (role.excluded || role.entity?.kind !== 'day' || src.title(id) === undefined) continue;
    out.push({ ref: dayRef(src, id), i });
  }
  return out
    .sort((a, b) => {
      const x = a.ref.date ?? '9999';
      const y = b.ref.date ?? '9999';
      return x < y ? -1 : x > y ? 1 : a.i - b.i;
    })
    .map((x) => x.ref);
}

/** Las fichas de cada escena (lo de adentro de su página), para leer sus campos. */
function cardsByScene(src: LiveSource): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [id, role] of src.snap.registration.roles) {
    if (role.excluded || role.partOf?.kind !== 'scene' || !role.partOf.ref) continue;
    if (src.title(id) === undefined) continue;
    const list = out.get(role.partOf.ref) ?? [];
    list.push(id);
    out.set(role.partOf.ref, list);
  }
  return out;
}

/** El plan de un día (D400 y §5 de la propuesta): su página *Plan* → las fichas con esa fecha → nada. */
export function planOf(src: LiveSource, day: DayRef): DayPlan {
  const { snap } = src;
  // 1. Lo de adentro del día (el plan, una hoja de llamado): las escenas que nombra, en el orden en que las nombra.
  const codes: string[] = [];
  const pages: PageChip[] = [];
  const empty: PageChip[] = [];
  for (const [pageId, rel] of snap.pages) {
    const role = snap.registration.roles.get(pageId);
    if (role?.partOf?.kind !== 'day' || role.partOf.pageId !== day.pageId || rel.entities > INDEX_PAGE_MIN) continue;
    let named = false;
    for (const m of rel.mentions) {
      if (m.kind !== 'scene') continue;
      named = true;
      if (!codes.includes(m.ref)) codes.push(m.ref);
    }
    (named ? pages : empty).push({ pageId, title: src.title(pageId) ?? '' });
  }
  if (codes.length) return { codes, source: 'plan', pages, label: '' };
  // 2. Las fichas del desglose cuya fecha de rodaje es ese día. Solo la escena y lo de adentro de una escena: las copias
  //    de fichas pegadas en el plan de otro día (adentro de un día, como en ERSO) no cuentan.
  if (day.date) {
    const found = new Set<string>();
    let label = '';
    // Las fichas (`cardFields`, sin las copias pegadas en los planes) y la página de la escena misma, si tiene la fecha.
    const dated = [
      ...cardFields(snap, 'shootDate').map((x) => ({ code: x.scene, field: x.field })),
      ...findFields(snap, 'shootDate').flatMap(({ pageId, field }) => {
        const role = snap.registration.roles.get(pageId);
        return role?.entity?.kind === 'scene' && role.entity.ref && !role.excluded ? [{ code: role.entity.ref, field }] : [];
      }),
    ];
    for (const { code, field } of dated) {
      if (fieldDate(field.text) !== day.date) continue;
      found.add(code);
      label ||= field.label;
    }
    if (found.size) return { codes: [...found].sort(), source: 'breakdown', pages: [], label };
  }
  return { codes: [], source: 'none', pages: [], label: '', empty };
}

const valued = (list: FieldValue[]) => list.filter((f) => !emptyValue(f.text));
const firstLine = (text: string) => (text.split('\n')[0] ?? '').trim();
const CAT_LABELS = ['Consultas Cat', 'Consulta Cat', 'Question category', 'Questions category'] as const;

/** El nombre corto de una ficha: su *Shot Name*, o lo primero del título si es un código. */
function shotName(fields: PageFields | undefined, title: string): string {
  const shot = valued(fieldValues(fields, 'shot'))[0];
  if (shot) return firstLine(shot.text);
  const head = title.split(/\s+/)[0] ?? '';
  return /\d{2,}[_-]\d/.test(head) ? head : title;
}

/**
 * Las preguntas abiertas del desglose de unas escenas (su página y sus fichas), agrupadas por su primer renglón, en el
 * orden de las escenas. La usa la cabecera del día y lo que muestra el editor debajo de una sección preparada.
 */
export function openQuestions(src: LiveSource, codes: readonly string[], cards = cardsByScene(src)): DayQuestion[] {
  const out: DayQuestion[] = [];
  for (const code of codes) {
    const scenePage = src.snap.registry.scenes.get(code)?.pageId ?? null;
    const own = [...(scenePage && src.title(scenePage) !== undefined ? [scenePage] : []), ...(cards.get(code) ?? [])];
    for (const pageId of own) {
      const pf = src.snap.fields.get(pageId);
      if (!pf) continue;
      for (const f of valued(fieldValues(pf, 'openQuestion'))) {
        const text = firstLine(f.text);
        const key = normLabel(text);
        if (!key) continue;
        const known = out.find((q) => normLabel(q.text) === key);
        if (known) {
          if (!known.codes.includes(code)) known.codes.push(code);
          continue;
        }
        const place: Place = f.via === 'heading' ? { pageId, blockId: f.blockId, endBlockId: f.endBlockId ?? null } : { pageId, blockId: f.blockId };
        const cat = valued(fieldValues(pf, CAT_LABELS))[0];
        out.push({ codes: [code], text, place, shot: pageId === scenePage ? '' : shotName(pf, src.title(pageId) ?? ''), cat: cat ? firstLine(cat.text) : '' });
      }
    }
  }
  return out;
}

/** Las secciones de una página que son de una escena (la más externa de cada una) y las de arriba sin número. */
function outerSections(sections: Section[]): { s: Section; scenes: Section['scenes'] }[] {
  const out: { s: Section; scenes: Section['scenes'] }[] = [];
  sections.forEach((s, i) => {
    const inside = (pred: (o: Section) => boolean) => sections.some((o, j) => j < i && o.block < s.block && o.end >= s.end && pred(o));
    if (s.scenes.length) {
      // Las escenas que una sección de afuera ya cuenta no se repiten («Escena 105_027b» › «105_027b plano 1»).
      const own = s.scenes.filter((x) => !inside((o) => o.scenes.some((y) => y.kind === x.kind && y.ref === x.ref)));
      if (own.length) out.push({ s, scenes: own });
    } else if (!inside(() => true)) {
      out.push({ s, scenes: [] });
    }
  });
  return out;
}

/** Qué escenas tienen sección (en el título) en un reporte. */
export function sectionScenes(src: LiveSource, pageId: string): Set<string> {
  const rel = src.snap.pages.get(pageId);
  return new Set((rel?.sections ?? []).flatMap((s) => s.scenes.filter((x) => x.kind === 'scene').map((x) => x.ref)));
}

export function dayLive(src: LiveSource, pageId: string): DayLive {
  const { snap } = src;
  const day = dayRef(src, pageId);
  const days = dayList(src);
  const at = days.findIndex((d) => d.pageId === day.pageId);
  const prev = at > 0 ? days[at - 1] : null;
  const next = at >= 0 && at < days.length - 1 ? days[at + 1] : null;
  const plan = planOf(src, day);
  const rel = snap.pages.get(day.pageId);
  const pb = pageBlocks(src.content(day.pageId));
  const sceneTitle = (code: string) => {
    const id = snap.registry.scenes.get(code)?.pageId;
    return id ? sceneTitleOf(src.title(id)) : '';
  };
  const scenePage = (code: string) => {
    const id = snap.registry.scenes.get(code)?.pageId ?? null;
    return id && src.title(id) !== undefined ? id : null;
  };

  const rows: DayRow[] = [];
  const photos: PhotoRef[] = [];
  const seenPhotos = new Set<string>();
  const inRows = new Set<string>();
  let firstUnnumbered = true;
  for (const { s, scenes } of outerSections(rel?.sections ?? [])) {
    const place: Place = { pageId: day.pageId, blockId: s.blockId, endBlockId: s.endBlockId };
    const empty = !s.media.length && !sectionText(pb, s);
    // La sección general del día no es una «sin número de escena»: sus fotos son del día (como la maqueta).
    if (!scenes.length) {
      const general = firstUnnumbered || GENERAL_SECTION.test(s.title);
      firstUnnumbered = false;
      if (general) continue;
    }
    for (const x of scenes) {
      if (x.kind === 'pending') {
        rows.push({ kind: 'pending', code: x.ref, heading: s.title, place });
        continue;
      }
      // Dos secciones vacías de la misma escena (preparadas en dos dispositivos a la vez) son una sola fila.
      if (empty && rows.some((r) => r.kind === 'scene' && r.code === x.ref && r.part === x.part && r.status === 'prepared')) continue;
      inRows.add(x.ref);
      const status: DayStatus = empty ? 'prepared' : plan.codes.length && !plan.codes.includes(x.ref) ? 'notInPlan' : 'shot';
      rows.push({ kind: 'scene', code: x.ref, part: x.part, scenePageId: scenePage(x.ref), sceneTitle: sceneTitle(x.ref), heading: s.title, place, photos: s.media.length, status });
    }
    if (!scenes.length && s.media.length) rows.push({ kind: 'unnumbered', heading: s.title, place, photos: s.media.length });
    if (scenes.length || s.media.length) {
      const label = scenes.length ? sourceLabel(s.title) : s.title;
      for (const id of s.media) {
        if (seenPhotos.has(id)) continue;
        seenPhotos.add(id);
        photos.push({ id, place, source: label, sourceKind: 'title' });
      }
    }
  }
  // Las fotos que no están en una sección de escena ni en una de arriba con fotos: del día en general.
  for (const m of rel?.media ?? []) {
    for (const id of m.ids) {
      if (seenPhotos.has(id)) continue;
      seenPhotos.add(id);
      photos.push({ id, place: { pageId: day.pageId, blockId: m.blockId }, source: day.label, sourceKind: 'title' });
    }
  }
  // Las fotos del día en general (la sección general, lo suelto) van primero, como la maqueta.
  photos.sort((a, b) => Number(a.source !== day.label) - Number(b.source !== day.label));
  for (const code of plan.codes) {
    if (inRows.has(code)) continue;
    rows.push({ kind: 'planned', code, scenePageId: scenePage(code), sceneTitle: sceneTitle(code) });
  }

  // Nombradas en el texto (no en un título), fuera de una sección suya.
  const named: DayLive['named'] = [];
  for (const m of rel?.mentions ?? []) {
    if (m.kind !== 'scene' || m.via === 'heading' || m.hidden || named.some((x) => x.code === m.ref)) continue;
    const owned = m.sections.some((si) => rel!.sections[si]?.scenes.some((y) => y.kind === 'scene' && y.ref === m.ref));
    if (owned) continue;
    named.push({ code: m.ref, scenePageId: scenePage(m.ref), place: { pageId: day.pageId, blockId: m.blockId } });
  }

  const cards = cardsByScene(src);
  const dayScenes = [...new Set([...rows.flatMap((r) => (r.kind === 'scene' || r.kind === 'planned' ? [r.code] : [])), ...plan.codes])];
  const questions = openQuestions(src, dayScenes, cards);

  let tomorrow: DayLive['tomorrow'] = null;
  if (next) {
    const nextPlan = planOf(src, next);
    const has = sectionScenes(src, next.pageId);
    tomorrow = {
      day: next,
      plan: nextPlan,
      scenes: nextPlan.codes.map((code) => ({ code, scenePageId: scenePage(code), sceneTitle: sceneTitle(code), has: has.has(code) })),
      repeated: repeatedScenes(src, next.pageId),
    };
  }

  return { day, prev, next, rows, plan, questions, named, photos, scenes: dayScenes.length, tomorrow, complete: snap.complete };
}

/**
 * Las escenas con dos o más títulos con la forma de *Prepare* («Escena» + el número como link) en un reporte, alguno
 * vacío: lo que dejan dos dispositivos que preparan a la vez (D436). Una sección escrita a mano («Escena 105_029a») no
 * cuenta (B4 de la auditoría).
 */
function repeatedScenes(src: LiveSource, pageId: string): string[] {
  const rel = src.snap.pages.get(pageId);
  if (!rel) return [];
  const pb = pageBlocks(src.content(pageId));
  const by = new Map<string, boolean[]>();
  for (const { s, scenes } of outerSections(rel.sections)) {
    if (scenes.length !== 1 || scenes[0].kind !== 'scene' || !PREPARED_TITLE.test(s.title)) continue;
    const code = scenes[0].ref;
    if (!rel.mentions.some((m) => m.blockId === s.blockId && m.via === 'link' && m.kind === 'scene' && m.ref === code)) continue;
    const empty = !s.media.length && !sectionText(pb, s);
    by.set(code, [...(by.get(code) ?? []), empty]);
  }
  return [...by].filter(([, list]) => list.length > 1 && list.some(Boolean)).map(([code]) => code);
}

/** La forma del título que agrega *Prepare*: una palabra y el número. */
const PREPARED_TITLE = /^\s*[\p{L}.]+\s+\S+\s*$/u;

/** A qué escena o locación lleva un link a una página (para leer los títulos con link, como el índice). */
export function linkTargetOf(src: LiveSource): LinkTarget {
  const map = new Map<string, { kind: 'scene' | 'loc'; ref: string }>();
  for (const e of src.snap.registry.scenes.values()) if (e.pageId) map.set(e.pageId, { kind: 'scene', ref: e.code });
  for (const e of src.snap.registry.locations.values()) if (e.pageId) map.set(e.pageId, { kind: 'loc', ref: e.name });
  return (pageId) => map.get(pageId) ?? null;
}

/**
 * Cómo escribe el proyecto el título de la sección de una escena en un reporte («Escena» en un título 1, como ERSO): el
 * de mañana, el de hoy y los días de antes, el más cercano primero. Si ninguno tiene, la palabra del idioma de la app
 * y el nivel de los títulos de mañana (o 1).
 */
export function headingStyleFor(src: LiveSource, dayPageId: string, lang: string): { word: string; level: 1 | 2 | 3 } {
  const days = dayList(src);
  const at = days.findIndex((d) => d.pageId === dayPageId);
  const order = [...(at >= 0 && days[at + 1] ? [days[at + 1].pageId] : []), dayPageId, ...days.slice(0, Math.max(0, at)).reverse().map((d) => d.pageId)];
  const clamp = (n: number) => (Math.min(3, Math.max(1, n)) as 1 | 2 | 3);
  for (const id of order) {
    const rel = src.snap.pages.get(id);
    for (const s of [...(rel?.sections ?? [])].reverse()) {
      if (!s.scenes.some((x) => x.kind === 'scene')) continue;
      const m = SCENE_WORD.exec(s.title);
      if (m) return { word: m[1], level: clamp(s.level) };
    }
  }
  const next = order[0] ? src.snap.pages.get(order[0]) : undefined;
  const levels = (next?.sections ?? []).map((s) => s.level);
  return { word: lang === 'es' ? 'Escena' : 'Scene', level: clamp(levels.length ? Math.min(...levels) : 1) };
}
