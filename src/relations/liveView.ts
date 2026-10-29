import { SEPARATOR, type SearchUnit } from '../search/extract';
import type { IndexedContent } from '../search/projectIndex';
import { dateAtStart, dayInTitle } from '../templates/dayReport';
import { coordsIn, emptyValue, fieldValues, normLabel, openQuestionText, type FieldValue, type PageFields } from './fields';
import { blocksOf, INDEX_PAGE_MIN, type Mention, type PageRelations, type Section } from './pageRelations';
import { fold, scan, sceneCode as canonicalCode, type Registry } from './reader';
import { entityRelations, type EntityPage, type RelationSnapshot } from './relationIndex';
import { planDayOf } from './planDay';

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
  /** Una ficha: el primer renglón de su pregunta abierta (campo *Consultas* / *Open question*), si tiene. */
  question?: string;
}

/** Un decorado: una página (si la persona la ve) o el texto del campo. */
export interface SetRef {
  title: string;
  pageId: string | null;
}

/** Una pregunta abierta del desglose (campo *Consultas* / *Open question*), con las fichas que la tienen. */
export interface OpenQuestion {
  text: string;
  /** El campo, para ir ahí. */
  place: Place;
  /** Las fichas que la tienen (el nombre del plano o el título); vacío si es de la página de la escena. */
  cards: { pageId: string; shot: string }[];
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

/** Un plano de la escena: una ficha (subpágina) o un título 2 de la sección «Planos» de su página (D785). */
export interface ShotRef {
  title: string;
  pageId: string;
  /** Adentro de la página de la escena: su título y lo de abajo. Una ficha: su primer bloque. */
  place: Place;
}

export interface SceneLive {
  code: string;
  pageId: string | null;
  episode: string | null;
  /** Otras formas en que está escrita en el proyecto (`5027`, `105_027b`). */
  aliases: string[];
  /** Las páginas de adentro (fichas). */
  cards: PageChip[];
  /** Sus planos: los de la sección «Planos» de su página y las fichas que siguen siendo subpáginas, en ese orden. */
  shots: ShotRef[];
  /** Los planes de jornada (y lo de adentro de un día que no es el reporte) que la nombran, por día: también de un día filmado. */
  plans: { day: DayRef; items: Excerpt[] }[];
  /** Los documentos de prueba que la nombran (D778); `scoutPages` no los tiene. */
  testPages: PageChip[];
  /** Locaciones que nombra su desglose (la escena y sus fichas) o que la nombran en el campo *Escenas* de su página (D818). */
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
  /** Las preguntas abiertas de su desglose (la escena y sus fichas), sin repetir, en orden. */
  questions: OpenQuestion[];
  /** Sus decorados: el campo *Locacion Guion* / *Sets* de la escena y de sus fichas. */
  sets: SetRef[];
  /** INT/EXT de su desglose, sin repetir («INT-EXT/NOCHE»). */
  intExt: string[];
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
  /**
   * Los nombres escritos en su «Otros nombres» que no cuentan (D534): los escribió también otra locación (`shared`) o
   * son el nombre de otra (`name`). Con las otras locaciones, para ir ahí.
   */
  aliasNotes: { alias: string; kind: 'shared' | 'name'; others: { name: string; pageId: string | null }[] }[];
  /**
   * Escenas cuyo desglose nombra esta locación, o que nombra el campo *Escenas* de su página (D818), con los días en que
   * tienen sección.
   */
  planned: { code: string; pageId: string | null; title: string; days: DayRef[] }[];
  /** Las páginas de adentro (scoutings), con su cantidad de fotos. */
  scouts: (PageChip & { photos: number })[];
  scouting: Excerpt[];
  days: LocationDay[];
  /** Escenas planeadas acá sin sección en ningún reporte. */
  noReport: string[];
  /**
   * Sus decorados: el campo *Sets* de la locación, las páginas sueltas cuyo campo *Locacion Real* la nombra y los
   * decorados de adentro de su página (D818).
   */
  sets: SetRef[];
  /** Dónde queda: las primeras coordenadas de la locación o de sus scoutings. */
  where: { text: string; place: Place; pageTitle: string } | null;
  also: PageChip[];
  indexPages: PageChip[];
  photos: PhotoRef[];
  complete: boolean;
}

// --- Ayudantes -----------------------------------------------------------------------------------------------

const EXCERPT_CHARS = 280;
const flat = (text: string) => text.replaceAll(SEPARATOR, ' ').replace(/\s+/g, ' ').trim();

/** Lo de una página por bloque (para los extractos): el texto de cada bloque, en orden, como lo cuenta `Section.block`. */
export interface PageBlocks {
  ids: string[];
  levels: number[];
  texts: string[];
}

export function pageBlocks(content: IndexedContent | undefined): PageBlocks | null {
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
export function sectionText(pb: PageBlocks | null, s: Section): string {
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

/** Un plano escrito adentro de la página de la escena: un título 2 de la sección «Planos» (D785). */
export interface ShotSection {
  title: string;
  blockId: string;
  /** El bloque que lo cierra (`null`, hasta el final). */
  endBlockId: string | null;
  /** Índices de bloque (los de `PageBlocks`): el título y el primero de afuera. */
  start: number;
  end: number;
}

/** Los títulos 1 que abren la sección de los planos (los escribe *Bring shots into this page*, D785, o la persona). */
export const SHOTS_HEADINGS = new Set(['planos', 'shots']);

/**
 * Los planos de una página de escena: cada título 2 adentro de un título 1 «Planos» / «Shots», hasta el próximo título de
 * nivel 2 o 1. Lo de abajo es del plano (sus campos, su pregunta abierta, su «No VFX»).
 */
export function shotSections(pb: PageBlocks | null): ShotSection[] {
  if (!pb) return [];
  const out: ShotSection[] = [];
  const n = pb.ids.length;
  for (let i = 0; i < n; i++) {
    if (pb.levels[i] !== 1 || !SHOTS_HEADINGS.has(normLabel(pb.texts[i]))) continue;
    let end = n;
    for (let j = i + 1; j < n; j++) {
      if (pb.levels[j] === 1) {
        end = j;
        break;
      }
    }
    for (let k = i + 1; k < end; k++) {
      if (pb.levels[k] !== 2) continue;
      let e = end;
      for (let j = k + 1; j < end; j++) {
        if (pb.levels[j] && pb.levels[j] <= 2) {
          e = j;
          break;
        }
      }
      out.push({ title: pb.texts[k], blockId: pb.ids[k], endBlockId: e < n ? pb.ids[e] : null, start: k, end: e });
    }
    i = end - 1;
  }
  return out;
}

/** El plano de la página que tiene ese bloque, o `null`. */
const shotAt = (pb: PageBlocks | null, shots: ShotSection[], blockId: string): ShotSection | null => {
  const at = pb ? pb.ids.indexOf(blockId) : -1;
  return at < 0 ? null : (shots.find((s) => at >= s.start && at < s.end) ?? null);
};

/** El principio de una página (una ficha, un scouting): sus primeros renglones. */
function pageText(pb: PageBlocks | null): string {
  if (!pb) return '';
  return clip(pb.texts.filter((t, i) => t && !pb.levels[i]).slice(0, 4).join(' · '));
}

/**
 * El día de una página: ella misma si es un día, el de arriba si está adentro de uno, el de un plan por su puntero, su
 * campo o su fecha (`planDay.ts`); si no, `null`.
 */
export function dayIdOf(src: LiveSource, pageId: string): string | null {
  const role = src.snap.registration.roles.get(pageId);
  if (role?.entity?.kind === 'day') return pageId;
  if (role?.partOf?.kind === 'day') return role.partOf.pageId;
  if (role?.doc === 'plan') return planDayOf(src, pageId);
  return null;
}

/** El día de una página de rodaje: el título del día (o de la página de día que la contiene, o el día de un plan). */
export function dayRef(src: LiveSource, pageId: string): DayRef {
  const dayId = dayIdOf(src, pageId) ?? pageId;
  const title = src.title(dayId) ?? '';
  const n = dayInTitle(title);
  const part = title.split('|').map((p) => p.trim()).find((p) => /(?:^|\s)(?:day|d[ií]a)\s*\d/i.test(p));
  const label = part ?? (n ? `Day ${String(n).padStart(2, '0')}` : title);
  const locs = scan(src.snap.registry, title, { heading: true, dayTitle: true }).filter((h) => h.kind === 'loc');
  const names = [...new Set(locs.map((h) => h.ref))];
  return { pageId: dayId, label: label || title, date: dateAtStart(title), loc: names[0] ?? null, locs: names };
}

/** El título de la sección general de un reporte («Info general:», «General notes»): no es de ninguna escena. */
export const GENERAL_SECTION = /^\s*(?:info(?:rmaci[oó]n)?\s+general|general(?:\s+info)?|general\s+notes?)(?![\p{L}\p{N}])/iu;

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

// --- Campos del desglose (Docs/Doc_Relaciones.md, sección 3, «Campos») -----------------------------------------------

const fieldsOf = (src: LiveSource, pageId: string | null | undefined): PageFields | undefined => (pageId ? src.snap.fields.get(pageId) : undefined);
/** Los valores que dicen algo (no «—» ni vacíos), o que llevan a una página. */
const valued = (list: FieldValue[]) => list.filter((f) => !emptyValue(f.text) || f.links.length > 0);
const firstLine = (text: string) => text.split('\n')[0] ?? '';

/** El nombre corto de una ficha: su campo *Shot Name*, o lo primero del título si es un código, o el título. */
function shotOf(src: LiveSource, pageId: string, title: string): string {
  const shot = valued(fieldValues(fieldsOf(src, pageId), 'shot'))[0];
  if (shot) return firstLine(shot.text);
  const head = title.split(/\s+/)[0] ?? '';
  return /\d{2,}[_-]\d/.test(head) ? head : shortTitle(title, 28);
}

/**
 * Los decorados de unos campos: cada link a una página (con su título si la persona la ve; si no, el texto del link,
 * que está en una página que sí ve) o cada renglón de texto. Sin repetir.
 */
function setsOf(src: LiveSource, list: FieldValue[], into: SetRef[]): void {
  const keyOf = (s: SetRef) => s.pageId ?? `t:${normLabel(s.title)}`;
  const seen = new Set(into.map(keyOf));
  const add = (ref: SetRef) => {
    if (!ref.title || seen.has(keyOf(ref))) return;
    seen.add(keyOf(ref));
    into.push(ref);
  };
  for (const f of valued(list)) {
    if (f.links.length) {
      for (const l of f.links) {
        const title = src.title(l.pageId);
        add(title === undefined ? { title: l.text, pageId: null } : { title: title || l.text, pageId: l.pageId });
      }
      continue;
    }
    for (const piece of f.text.split('\n')) {
      // El valor entero que nombra un decorado (su título o uno de sus otros nombres, D804) lleva a su página.
      const id = setIndex(src).named(piece.trim());
      add(id ? { title: src.title(id) || piece.trim(), pageId: id } : { title: piece.trim(), pageId: null });
    }
  }
}

/**
 * La locación escrita en el campo *Location* de una escena que todavía no es una locación del proyecto (ni su nombre ni
 * otro de sus nombres, y sin página): va a `planned` sin página, como texto, para que la cabecera de la escena ofrezca
 * crearla (D818). Se lee como el resto de la app lee el campo (`placesIn`): un valor que es o contiene una locación ya
 * reconocida («Estación Vieja, andén 2», «Estudio | Autos» de «Estudio Autos») no se repite, un link lleva a su página y
 * «N/A» o «—» no son un lugar. Solo el campo de la escena misma: el de sus fichas (planos importados de Coda) dice dónde
 * se filmó cada plano, no una locación para crear.
 */
function unknownLocations(registry: Registry, fields: FieldValue[], planned: Map<string, PageChip>): void {
  const seen = () => [...planned.values()].map((p) => fold(p.title).trim()).filter(Boolean);
  for (const f of fields) {
    for (const place of placesIn(registry, f, new Map())) {
      if (place.known) continue;
      const piece = place.name.trim();
      const fp = fold(piece).trim();
      if (!fp || planned.has(piece) || seen().some((k) => fp === k || fp.includes(k))) continue;
      planned.set(piece, { pageId: '', title: piece, blockId: f.blockId });
    }
  }
}

/** Un pedazo del campo *Escenas* que empieza con un número: `027`, `27b`, `105_027`, `105-27`, `Escena 27 | El vuelco`. */
const SCENE_PIECE = /^(?:(?:escenas?|esc|scenes?|sc)\.?\s*)?(\d{3}\s?[-_]\s?\d{1,3}[A-Za-z]?|\d{1,3}[A-Za-z]?)(?![\p{L}\p{N}])/iu;

/**
 * Las escenas que nombra el campo *Escenas* de una página (la de una locación, D818), con el bloque del campo: sus links a
 * una escena y cada número que existe, también sin «Escena» delante («027, 031» en un largo). Uno con letra que no
 * existe cuenta como su base. El texto suelto de la página no cuenta.
 */
function fieldScenes(src: LiveSource, pageId: string | null): Map<string, string> {
  const R = src.snap.registry;
  const roles = src.snap.registration.roles;
  const out = new Map<string, string>();
  for (const f of valued(fieldValues(fieldsOf(src, pageId), 'scenes'))) {
    const add = (code: string | null) => {
      const known = code && (R.scenes.has(code) ? code : R.scenes.has(code.replace(/[A-Z]+$/, '')) ? code.replace(/[A-Z]+$/, '') : null);
      if (known && !out.has(known)) out.set(known, f.blockId);
    };
    for (const l of f.links) {
      const e = roles.get(l.pageId)?.entity;
      add(e?.kind === 'scene' ? e.ref : null);
    }
    // shortcut: un rango («027-029») no se abre en sus escenas; si hiciera falta, con `scan` y su contexto.
    for (const piece of f.text.split(/\n|[,;·]|\s+(?:y|and|&)\s+/)) {
      const m = SCENE_PIECE.exec(piece.trim());
      add(m ? canonicalCode(m[1]) : null);
    }
  }
  return out;
}

/** Lo de `scenesByLocation`, una vez por foto. */
const fieldScenesMemo = new WeakMap<RelationSnapshot, Map<string, { name: string; pageId: string; blockId: string }[]>>();

/** Por escena, las locaciones cuya página la nombra en su campo *Escenas* (D818). */
function scenesByLocation(src: LiveSource): Map<string, { name: string; pageId: string; blockId: string }[]> {
  let memo = fieldScenesMemo.get(src.snap);
  if (memo) return memo;
  fieldScenesMemo.set(src.snap, (memo = new Map()));
  for (const l of src.snap.registry.locations.values()) {
    if (!l.pageId || src.title(l.pageId) === undefined) continue;
    for (const [code, blockId] of fieldScenes(src, l.pageId)) {
      const list = memo.get(code) ?? [];
      list.push({ name: l.name, pageId: l.pageId, blockId });
      memo.set(code, list);
    }
  }
  return memo;
}

/** Los nombres de las locaciones por `normLabel`, una vez por registro (`locationOf` se llama por cada título de sección). */
const labelMemo = new WeakMap<Registry, Map<string, string>>();

/**
 * La locación que dice el valor entero de un campo de lugar (*Locacion Real*: «CENADE», «Lübben»), según el registro: su
 * nombre, o un alias que el registro reconoce para el lugar (`locDayTitleAlias`: los de siempre más el nombre de una
 * palabra sin paréntesis que vale en el título de un día, D417; sin los genéricos como «Europa») y que no comparte otra
 * locación. Un alias de varias, ninguna (B1 de la auditoría de E3b: «Europa» no es de ninguna de las seis
 * «… (Europa)»). Un campo de lugar dice dónde se filma, como el título de un día (D424). No mira títulos de páginas.
 */
export function locationOf(R: Registry, text: string): string | null {
  const key = normLabel(text);
  if (!key) return null;
  let byLabel = labelMemo.get(R);
  if (!byLabel) {
    byLabel = new Map();
    for (const l of R.locations.values()) {
      const k = normLabel(l.name);
      if (!byLabel.has(k)) byLabel.set(k, l.name);
    }
    labelMemo.set(R, byLabel);
  }
  const named = byLabel.get(key);
  if (named) return named;
  // «Europa ?»: lo de después de un nombre que solo duda no lo cambia (D531).
  const f = fold(text).replace(/[\s?!.]+$/, '').replace(/\s+/g, ' ').trim();
  const names = new Set(R.locDayTitleAlias.filter((a) => a.f === f).map((a) => a.name));
  return names.size === 1 ? [...names][0] : null;
}

/**
 * Las locaciones de un scouting o una prueba (Docs/Plan_Estructura_Etapas.md, sección 5). Adentro de una locación, esa
 * (lo de antes: ES2). Un documento de scouting o de prueba, además, por su contenido, esté donde esté: un link o el valor de su
 * campo *Locación*, las que nombra su título y los títulos de sección que son exactamente una locación (un recorrido
 * visita varias). Cualquier otra página, ninguna.
 */
export function scoutLocations(src: LiveSource, pageId: string): string[] {
  let memo = scoutMemo.get(src.snap);
  if (!memo) scoutMemo.set(src.snap, (memo = new Map()));
  let value = memo.get(pageId);
  if (!value) memo.set(pageId, (value = readScoutLocations(src, pageId)));
  return value;
}

/** Lo de `scoutLocations`, una vez por foto (la foto no cambia: cada revisión es otra). */
const scoutMemo = new WeakMap<RelationSnapshot, Map<string, string[]>>();

function readScoutLocations(src: LiveSource, pageId: string): string[] {
  const { snap } = src;
  const role = snap.registration.roles.get(pageId);
  if (!role || role.excluded) return [];
  const out = new Set<string>();
  if (role.partOf?.kind === 'location' && role.partOf.ref) out.add(role.partOf.ref);
  if (role.doc !== 'scouting' && role.doc !== 'test') return [...out];
  const R = snap.registry;
  const place = (text: string) => {
    const line = text.replace(/\n/g, ' ');
    const whole = locationOf(R, line);
    if (whole) out.add(whole);
    else for (const h of scan(R, line, { heading: true, dayTitle: true })) if (h.kind === 'loc') out.add(h.ref);
  };
  for (const f of valued(fieldValues(fieldsOf(src, pageId), 'location'))) {
    for (const l of f.links) for (const e of R.locations.values()) if (e.pageId === l.pageId) out.add(e.name);
    place(f.text);
  }
  for (const h of scan(R, src.title(pageId) ?? '', { heading: true, dayTitle: true })) if (h.kind === 'loc') out.add(h.ref);
  // Una página índice (un resumen que nombra muchas) no es de cada locación que tiene como título de sección.
  const rel = snap.pages.get(pageId);
  if (rel && rel.entities <= INDEX_PAGE_MIN) {
    for (const s of rel.sections) {
      const name = locationOf(R, s.title);
      if (name) out.add(name);
    }
  }
  return [...out];
}

/** El texto de una ficha para su extracto: su *Descripción* si la tiene; si no, sus primeros renglones sin las tablas. */
function cardText(src: LiveSource, pageId: string, pb: PageBlocks | null): string {
  const desc = valued(fieldValues(fieldsOf(src, pageId), 'description'))[0];
  if (desc) return clip(desc.text.replace(/\n/g, ' '));
  if (!pb) return '';
  const tables = new Set((src.content(pageId)?.meta ?? []).filter((m) => m.cells).map((m) => m.blockId));
  return clip(pb.texts.filter((t, i) => t && !pb.levels[i] && !tables.has(pb.ids[i])).slice(0, 4).join(' · '));
}

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
  // Los planos escritos adentro de la página de la escena (D785): cada uno cuenta como una ficha.
  const scenePb = rel.pageId ? pageBlocks(src.content(rel.pageId)) : null;
  const inPage = shotSections(scenePb);

  // Locaciones que nombra su desglose, y las que la nombran en el campo *Escenas* de su página (D818); y si dice «No VFX»
  // (la escena, o cada ficha con texto).
  const planned = new Map<string, PageChip>();
  const byField = scenesByLocation(src).get(code) ?? [];
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
    if (id === rel.pageId && inPage.length && content && scenePb) {
      // Con planos adentro, cada uno es como una ficha: un «No VFX» en un plano no marca la escena entera; lo de afuera sí.
      const at = new Map(scenePb.ids.map((b, i) => [b, i]));
      const per = new Map<ShotSection, boolean>();
      for (const u of content.units) {
        if (u.field !== 'text') continue;
        const i = at.get(u.blockId) ?? -1;
        const shot = inPage.find((s) => i >= s.start && i < s.end);
        const no = NO_VFX.test(flat(u.text));
        if (!shot) sceneNoVfx ||= no;
        else if (i !== shot.start) per.set(shot, (per.get(shot) ?? false) || no);
      }
      for (const no of per.values()) {
        noVfxCards.of++;
        if (no) noVfxCards.no++;
      }
    } else if (id === rel.pageId) {
      sceneNoVfx = says;
    } else if (content?.units.some((u) => u.field === 'text')) {
      noVfxCards.of++;
      if (says) noVfxCards.no++;
    }
  }
  for (const l of byField) if (!planned.has(l.name)) planned.set(l.name, { pageId: l.pageId, title: l.name, blockId: l.blockId });
  const noVfx = sceneNoVfx || (noVfxCards.of > 0 && noVfxCards.no === noVfxCards.of);

  const breakdown: Excerpt[] = [];
  const scouting: Excerpt[] = [];
  const shoot: Excerpt[] = [];
  const scoutPages: PageChip[] = [];
  const testPages: PageChip[] = [];
  const also: PageChip[] = [];
  const indexPagesList: PageChip[] = [];
  const dayMap = new Map<string, SceneDay>();
  const planMap = new Map<string, { day: DayRef; items: Excerpt[] }>();
  const bdPhotos: PhotoRef[] = [];
  const scoutPhotos: PhotoRef[] = [];

  // Los campos de su desglose (la escena y sus fichas): preguntas abiertas, decorados, INT/EXT.
  const questions: OpenQuestion[] = [];
  const sets: SetRef[] = [];
  const intExt: string[] = [];
  const own = [...(rel.pageId ? [{ pageId: rel.pageId, title: title(rel.pageId), card: false }] : []), ...cards.map((c) => ({ ...c, card: true }))];
  for (const o of own) {
    const pf = fieldsOf(src, o.pageId);
    if (!pf) continue;
    for (const f of valued(fieldValues(pf, 'openQuestion'))) {
      // Sin los rótulos vacíos («Director: » de la plantilla): una pregunta sin nada escrito no está abierta (O11).
      const text = openQuestionText(f.text);
      // Dos fichas con la misma pregunta (su primer renglón, lo que se muestra) son una sola, «in 2 cards».
      const key = normLabel(firstLine(text));
      if (!key) continue;
      // De qué plano es: una ficha, o un plano de la sección «Planos» de la página de la escena (D785).
      const inShot = o.card ? null : shotAt(scenePb, inPage, f.blockId);
      const card = o.card ? { pageId: o.pageId, shot: shotOf(src, o.pageId, o.title) } : inShot ? { pageId: o.pageId, shot: inShot.title } : null;
      const known = questions.find((q) => normLabel(firstLine(q.text)) === key);
      if (known) {
        if (card && !known.cards.some((x) => x.pageId === card.pageId && x.shot === card.shot)) known.cards.push(card);
        continue;
      }
      const place: Place = f.via === 'heading' ? { pageId: o.pageId, blockId: f.blockId, endBlockId: f.endBlockId ?? null } : { pageId: o.pageId, blockId: f.blockId };
      questions.push({ text, place, cards: card ? [card] : [] });
    }
    setsOf(src, fieldValues(pf, 'set'), sets);
    for (const f of valued(fieldValues(pf, 'intExt'))) {
      const v = firstLine(f.text).trim();
      if (v && !intExt.some((x) => normLabel(x) === normLabel(v))) intExt.push(v);
    }
    if (!o.card) unknownLocations(snap.registry, valued(fieldValues(pf, 'location')), planned);
  }
  // Los decorados cuya página nombra la escena (o que la nombran desde otra ficha): también en su renglón (D804).
  for (const id of setIndex(src).ofScene.get(code) ?? []) if (!sets.some((s) => s.pageId === id)) sets.push({ title: title(id), pageId: id });

  // Las fichas: un extracto cada una, con sus fotos (todas son de la escena) y su pregunta abierta.
  for (const c of cards) {
    const pr = snap.pages.get(c.pageId);
    const photos = photosOfPage(pr, c.pageId, BREAKDOWN);
    bdPhotos.push(...photos);
    const pb = pageBlocks(src.content(c.pageId));
    const q = questions.find((x) => x.cards.some((y) => y.pageId === c.pageId));
    // Con un campo *Shot Name*, el extracto se titula con el plano (como la maqueta); si no, con el título de la ficha.
    const shot = valued(fieldValues(fieldsOf(src, c.pageId), 'shot'))[0];
    breakdown.push({
      place: { pageId: c.pageId, blockId: pb?.ids[0] ?? '' },
      pageId: c.pageId,
      pageTitle: c.title,
      day: null,
      heading: shot ? firstLine(shot.text) : '',
      text: cardText(src, c.pageId, pb),
      part: '',
      shared: [],
      photos,
      kind: 'card',
      ...(q ? { question: firstLine(q.text) } : {}),
    });
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
      // Una prueba (D778) tiene su propio renglón; lo que escribe sigue contando como scouting.
      (roles.get(p.pageId)?.doc === 'test' ? testPages : scoutPages).push({ pageId: p.pageId, title: pageTitle, blockId: p.sections[0]?.blockId ?? p.mentions[0]?.blockId });
      for (const s of p.sections) {
        const ex = sectionEx(s, null, source);
        scouting.push(ex);
        scoutPhotos.push(...ex.photos);
      }
      for (const m of looseMentions(p)) scouting.push(mentionEx(m, null));
    } else if (p.stage === 'breakdown') {
      for (const s of p.sections) breakdown.push(sectionEx(s, null, BREAKDOWN));
      for (const m of looseMentions(p)) breakdown.push(mentionEx(m, null));
    } else if (byField.some((l) => l.pageId === p.pageId)) {
      // La locación que la nombra en su campo *Escenas* ya está en su renglón *Location* (D818).
    } else if (!sets.some((s) => s.pageId === p.pageId || (roles.get(p.pageId)?.partOf?.kind === 'set' && roles.get(p.pageId)?.partOf?.pageId === s.pageId))) {
      // Un decorado que la nombra (o una página suya) ya está en su renglón *Set* (D804).
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
    for (const id of shotLocs.size ? roles.keys() : []) {
      const loc = scoutLocations(src, id).find((l) => shotLocs.has(l));
      if (!loc) continue;
      if (!snap.pages.has(id) && src.title(id) === undefined) continue;
      scoutsVia.push({ pageId: id, title: title(id), loc });
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
    shots: [
      ...inPage.map((s) => ({ title: s.title, pageId: rel.pageId!, place: { pageId: rel.pageId!, blockId: s.blockId, endBlockId: s.endBlockId } })),
      ...cards.map((c) => ({ title: shotOf(src, c.pageId, c.title), pageId: c.pageId, place: { pageId: c.pageId, blockId: pageBlocks(src.content(c.pageId))?.ids[0] ?? '' } })),
    ],
    plans: [...planMap.values()].sort((a, b) => byDay(a.day, b.day, order)),
    testPages,
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
    questions,
    sets,
    intExt,
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
  const locPage = entry?.pageId ?? rel.pageId;

  // Sus decorados: el campo de la locación misma y las páginas sueltas (no escenas, fichas, días, locaciones ni
  // scoutings) cuyo campo *Locacion Real* la nombra (la tabla «Decorados» de Coda), y los decorados (D804) cuyo campo
  // la nombra: la misma regla que `setIndex`.
  const sets: SetRef[] = [];
  setsOf(src, fieldValues(fieldsOf(src, locPage), 'set'), sets);
  const setPages = new Set<string>();
  for (const [pageId, pf] of snap.fields) {
    const role = roles.get(pageId);
    if (pageId === locPage || role?.excluded || (role?.entity && role.entity.kind !== 'set') || role?.partOf || role?.doc) continue;
    if ((snap.pages.get(pageId)?.entities ?? 0) > INDEX_PAGE_MIN || src.title(pageId) === undefined) continue;
    const here = valued(fieldValues(pf, 'location')).some(
      (f) =>
        (!!locPage && f.links.some((l) => l.pageId === locPage)) ||
        locationOf(snap.registry, f.text) === name ||
        scan(snap.registry, f.text.replace(/\n/g, ' '), { heading: true, dayTitle: true }).some((h) => {
          const raw = f.text.replace(/\n/g, ' ').slice(h.s, h.e);
          return h.kind === 'loc' && h.ref === name && locationOf(snap.registry, raw) === name;
        }),
    );
    if (!here) continue;
    setPages.add(pageId);
    if (!sets.some((x) => x.pageId === pageId)) sets.push({ title: title(pageId), pageId });
  }
  // Y lo que el decorado dice de sí (también lo de sus páginas de adentro): las dos cabeceras dicen lo mismo.
  for (const row of setIndex(src).rows) {
    if (row.locs.some((l) => l.name === name) && !sets.some((x) => x.pageId === row.pageId)) sets.push({ title: title(row.pageId), pageId: row.pageId });
  }

  // Escenas cuyo desglose (la escena o sus fichas) la nombra, y las que nombra el campo *Escenas* de su página (D818).
  const plannedCodes = new Map<string, true>();
  for (const code of fieldScenes(src, locPage).keys()) plannedCodes.set(code, true);
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
    const inSet = (id: string) => sets.some((x) => x.pageId === id);
    if (p.own || setPages.has(p.pageId) || inSet(p.pageId) || (role?.partOf?.kind === 'set' && inSet(role.partOf.pageId)) || scoutLocations(src, p.pageId).includes(name)) continue;
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

  // Sus scoutings y pruebas: lo de adentro de la locación, o los que la nombran (`scoutLocations`).
  const scouts: LocationLive['scouts'] = [];
  const scouting: Excerpt[] = [];
  const scoutPhotos: PhotoRef[] = [];
  for (const id of roles.keys()) {
    if (!scoutLocations(src, id).includes(name)) continue;
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
    let firstUnnumbered = true;
    pr.sections.forEach((s, i) => {
      const outer = !pr.sections.some((o, j) => j < i && o.block < s.block && o.end >= s.end);
      // La sección general del día («Info general», o la primera de arriba sin número) no es «sin número de escena».
      if (outer && !s.scenes.length) {
        const general = firstUnnumbered || GENERAL_SECTION.test(s.title);
        firstUnnumbered = false;
        if (general) return;
      }
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

  // Dónde queda: las coordenadas de la locación o, si no, las del primer scouting que las tenga.
  let where: LocationLive['where'] = null;
  for (const id of [locPage, ...scouts.map((s) => s.pageId)]) {
    const pf = fieldsOf(src, id);
    if (!id || !pf) continue;
    // Un campo «Coordenadas» cuenta solo si dice una coordenada (no «Ubicación: Ruta 205 km 40»).
    const field = valued(fieldValues(pf, 'coords'))
      .map((f) => ({ text: coordsIn(f.text, true), blockId: f.blockId }))
      .find((f) => f.text);
    const at = pf.coords ?? (field ? { text: field.text!, blockId: field.blockId } : null);
    if (at) {
      where = { text: at.text, place: { pageId: id, blockId: at.blockId }, pageTitle: title(id) };
      break;
    }
  }

  return {
    name,
    pageId: entry?.pageId ?? rel.pageId,
    aliases: (entry?.aliases ?? []).filter((a) => a !== name),
    aliasNotes: snap.registry.aliasNotes
      .filter((n) => n.loc === name)
      .map((n) => ({ alias: n.alias, kind: n.kind, others: n.others.map((o) => ({ name: o, pageId: snap.registry.locations.get(o)?.pageId ?? null })) })),
    planned,
    scouts,
    scouting,
    days,
    noReport: planned.filter((s) => !s.days.length).map((s) => s.code),
    sets,
    where,
    also,
    indexPages: indexPagesList,
    photos: uniquePhotos([...ownPhotos, ...scoutPhotos, ...days.flatMap((d) => d.photos)]),
    complete: rel.complete,
  };
}

// --- Decorado ------------------------------------------------------------------------------------------------------

/**
 * Un decorado (el lugar de la historia; Plan_Estructura_Etapas.md, parte 4, D804) y lo que se sabe de él: sus locaciones
 * (su campo *Locación*: un link a la locación o su nombre, con la regla de D424), sus escenas (las que lo nombran en su
 * campo *Decorado* / *Locacion Guion*, ellas o sus fichas, y las que nombra su propia página) y las demás páginas que lo
 * nombran en ese campo. Un decorado se nombra solo por campo o por link, con el valor entero igual a su título o a uno de
 * sus otros nombres (decisión 6 del plan): «Comedor» o «Auto Rubio» sueltos en un texto no lo nombran.
 */
export interface SetRow {
  pageId: string;
  name: string;
  /** Lo escrito en su campo «Otros nombres» (sin su nombre). */
  aliases: string[];
  /**
   * Sus locaciones: la de arriba si está adentro de una (D818) y las de su campo *Locación*; con su página si es una
   * locación del proyecto; si no, el texto del campo.
   */
  locs: { name: string; pageId: string | null }[];
  scenes: string[];
  /** Las páginas que lo nombran en su campo y no son de una escena (un día, una nota). */
  also: string[];
}

export interface SetIndex {
  /** En el orden de la barra lateral. */
  rows: SetRow[];
  byPage: Map<string, SetRow>;
  /** Los decorados de cada escena (por código): sus páginas. */
  ofScene: Map<string, string[]>;
  /** El decorado que nombra un valor entero (su título o uno de sus otros nombres, de un solo decorado), o `null`. */
  named(text: string): string | null;
}

/** Cómo se separan los otros nombres escritos en un renglón: «Ambulancia, Ambu · La ambulancia». */
const ALIAS_SPLIT = /\s*(?:\n|,|;|·)\s*/;

/** Lo de `setIndex`, una vez por foto (la foto no cambia: cada revisión es otra). */
const setMemo = new WeakMap<RelationSnapshot, SetIndex>();

/** Los decorados del proyecto que la persona ve, con sus relaciones. */
export function setIndex(src: LiveSource): SetIndex {
  let memo = setMemo.get(src.snap);
  if (!memo) setMemo.set(src.snap, (memo = readSetIndex(src)));
  return memo;
}

/**
 * Las locaciones que dice un valor de un campo de lugar, como en D424: sus links a una locación; si no, el valor entero
 * (`locationOf`) o las locaciones que nombra enteras adentro («CENADE, Pista 2»). Lo que no es ninguna queda como texto.
 */
export function placesIn(R: Registry, f: FieldValue, locByPage: Map<string, string>): { name: string; known: boolean }[] {
  const linked = f.links.map((l) => locByPage.get(l.pageId)).filter((n): n is string => !!n);
  if (linked.length) return linked.map((name) => ({ name, known: true }));
  const out: { name: string; known: boolean }[] = [];
  for (const line of f.text.split('\n')) {
    const text = line.trim();
    if (!text || emptyValue(text)) continue;
    const whole = locationOf(R, text);
    if (whole) {
      out.push({ name: whole, known: true });
      continue;
    }
    const inside = scan(R, text, { heading: true, dayTitle: true }).filter((h) => h.kind === 'loc' && locationOf(R, text.slice(h.s, h.e)) === h.ref);
    if (inside.length) for (const h of inside) out.push({ name: h.ref, known: true });
    else out.push({ name: text, known: false });
  }
  return out;
}

function readSetIndex(src: LiveSource): SetIndex {
  const { snap } = src;
  const roles = snap.registration.roles;
  const R = snap.registry;
  const rows: SetRow[] = [];
  const byPage = new Map<string, SetRow>();
  const byName = new Map<string, Set<string>>();
  const note = (text: string, pageId: string) => {
    const key = normLabel(text);
    if (!key) return;
    const ids = byName.get(key) ?? new Set<string>();
    ids.add(pageId);
    byName.set(key, ids);
  };
  for (const s of snap.registration.sets) {
    if (byPage.has(s.pageId) || src.title(s.pageId) === undefined) continue;
    const aliases = valued(fieldValues(fieldsOf(src, s.pageId), 'aliases'))
      .flatMap((f) => f.text.split(ALIAS_SPLIT))
      .map((a) => a.trim())
      .filter((a) => a && !emptyValue(a) && normLabel(a) !== normLabel(s.name));
    const row: SetRow = { pageId: s.pageId, name: s.name, aliases: [...new Set(aliases)], locs: [], scenes: [], also: [] };
    rows.push(row);
    byPage.set(s.pageId, row);
    note(s.name, s.pageId);
    for (const a of row.aliases) note(a, s.pageId);
  }
  // Un nombre que escribieron dos decorados no es de ninguno.
  const named = (text: string): string | null => {
    const ids = byName.get(normLabel(text));
    return ids && ids.size === 1 ? [...ids][0] : null;
  };
  /** Los decorados que nombra un valor: sus links a un decorado o, sin links, cada renglón entero. */
  const setsIn = (f: FieldValue): string[] =>
    f.links.length
      ? f.links.map((l) => l.pageId).filter((id) => byPage.has(id))
      : f.text
          .split('\n')
          .map((t) => named(t.trim()))
          .filter((id): id is string => !!id);
  const addLoc = (row: SetRow, name: string, pageId: string | null) => {
    if (!row.locs.some((l) => normLabel(l.name) === normLabel(name))) row.locs.push({ name, pageId });
  };
  const ofScene = new Map<string, string[]>();
  const addScene = (row: SetRow, code: string) => {
    if (!row.scenes.includes(code)) row.scenes.push(code);
    const list = ofScene.get(code) ?? [];
    if (!list.includes(row.pageId)) list.push(row.pageId);
    ofScene.set(code, list);
  };

  // Lo que dicen los campos de las demás páginas: una escena o su ficha (es de esa escena), una locación (el decorado
  // está ahí, D424) o cualquier otra (*Also named in*). Las páginas índice sueltas no cuentan; una escena o una locación
  // que nombra muchas cosas sí (lo dice en su campo, como lo lee su cabecera).
  for (const [pageId, pf] of snap.fields) {
    const role = roles.get(pageId);
    if (!role || role.excluded || byPage.has(pageId) || role.partOf?.kind === 'set') continue;
    if (src.title(pageId) === undefined) continue;
    const loose = !role.entity && role.partOf?.kind !== 'scene';
    if (loose && (snap.pages.get(pageId)?.entities ?? 0) > INDEX_PAGE_MIN) continue;
    const ids = new Set(valued(fieldValues(pf, 'set')).flatMap(setsIn));
    if (!ids.size) continue;
    const scene = role.entity?.kind === 'scene' ? role.entity.ref : role.partOf?.kind === 'scene' ? role.partOf.ref : null;
    for (const id of ids) {
      const row = byPage.get(id)!;
      if (scene) addScene(row, scene);
      else if (role.entity?.kind === 'location' && role.entity.ref) addLoc(row, role.entity.ref, pageId);
      else if (!row.also.includes(pageId)) row.also.push(pageId);
    }
  }

  // Lo de cada decorado y lo de adentro: su campo de lugar y las escenas que nombra.
  const inside = new Map<string, string[]>();
  for (const [id, r] of roles) {
    if (r.excluded || r.partOf?.kind !== 'set' || !byPage.has(r.partOf.pageId)) continue;
    const list = inside.get(r.partOf.pageId) ?? [];
    list.push(id);
    inside.set(r.partOf.pageId, list);
  }
  const locByPage = new Map<string, string>();
  for (const l of R.locations.values()) if (l.pageId) locByPage.set(l.pageId, l.name);
  for (const row of rows) {
    // Adentro de una locación (la entidad más cercana arriba): se filma ahí (D818).
    const seen = new Set<string>([row.pageId]);
    for (let p = roles.get(row.pageId)?.parent; p && !seen.has(p); p = roles.get(p)?.parent) {
      seen.add(p);
      const up = roles.get(p)?.entity;
      if (!up) continue;
      const name = up.kind === 'location' ? locByPage.get(p) : undefined;
      if (name) addLoc(row, name, p);
      break;
    }
    for (const id of [row.pageId, ...(inside.get(row.pageId) ?? [])]) {
      for (const f of valued(fieldValues(fieldsOf(src, id), 'location'))) {
        for (const p of placesIn(R, f, locByPage)) addLoc(row, p.name, p.known ? (R.locations.get(p.name)?.pageId ?? null) : null);
      }
      const pr = snap.pages.get(id);
      if (!pr || pr.entities > INDEX_PAGE_MIN) continue;
      for (const m of pr.mentions) if (m.kind === 'scene') addScene(row, m.ref);
    }
  }
  for (const row of rows) row.scenes.sort();
  return { rows, byPage, ofScene, named };
}

export interface SetLive {
  pageId: string;
  name: string;
  aliases: string[];
  locs: { name: string; pageId: string | null }[];
  /** Sus escenas, con los días en que tienen sección en un reporte. */
  scenes: { code: string; pageId: string | null; title: string; days: DayRef[] }[];
  /** Los días en que se filmó alguna de sus escenas, en orden, con cuáles. */
  days: { day: DayRef; scenes: { code: string; pageId: string | null }[] }[];
  also: PageChip[];
  complete: boolean;
}

/** La cabecera de la página de un decorado (D804). */
export function setLive(src: LiveSource, pageId: string): SetLive {
  const { snap } = src;
  const row = setIndex(src).byPage.get(pageId);
  const order = pageOrder(snap);
  const title = (id: string) => src.title(id) ?? '';
  const shotDays = sceneDays(src);
  const scenes = (row?.scenes ?? []).map((code) => {
    const e = snap.registry.scenes.get(code);
    return { code, pageId: e?.pageId ?? null, title: e?.pageId ? title(e.pageId) : '', days: (shotDays.get(code) ?? []).slice().sort((a, b) => byDay(a, b, order)) };
  });
  const days = new Map<string, SetLive['days'][number]>();
  for (const s of scenes) {
    for (const d of s.days) {
      const entry = days.get(d.pageId) ?? { day: d, scenes: [] };
      entry.scenes.push({ code: s.code, pageId: s.pageId });
      days.set(d.pageId, entry);
    }
  }
  return {
    pageId,
    name: row?.name ?? title(pageId),
    aliases: row?.aliases ?? [],
    locs: row?.locs ?? [],
    scenes,
    days: [...days.values()].sort((a, b) => byDay(a.day, b.day, order)),
    also: [...(row?.also ?? [])].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)).map((id) => ({ pageId: id, title: title(id) })),
    complete: snap.complete,
  };
}
