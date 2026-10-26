import { mapPath } from '../router';
import { SEPARATOR, type BlockMeta, type SearchUnit } from '../search/extract';
import { sceneTitleOf } from './dayLive';
import { dayIdOf, type LiveSource } from './liveView';
import { INDEX_PAGE_MIN } from './pageRelations';
import type { MapMention, MapSectionRef, ProjectMapData } from './projectMap';
import { scan, type SceneEntry } from './reader';
import type { Stage } from './register';

// La sección *Scenes* (Docs/Doc_Relaciones.md, sección 21): todas las páginas que hablan de una escena, agrupadas por
// etapa, cada una con los lugares exactos (la sección de la escena, el bloque que la nombra o el que la linkea) y un
// extracto corto. Puro: sale del mapa (`projectMap`) y de la foto del índice (lo que la persona ve). Nada se guarda ni se
// escribe.

/** El grupo de una página en la lista de una escena, en este orden; las páginas índice van aparte, al final. */
export type SceneGroupId = 'scene' | 'location' | 'shoot' | 'other' | 'index';
export const SCENE_GROUPS: readonly SceneGroupId[] = ['scene', 'location', 'shoot', 'other', 'index'];

/** Un lugar exacto de una página: la sección de la escena (del título hasta `endBlockId`) o un bloque que la nombra. */
export interface ScenePlace {
  blockId: string;
  /** Sección: el bloque que la cierra (`null`, hasta el final). Sin la clave: un bloque. */
  endBlockId?: string | null;
  /** El título de la sección (vacío en un bloque). */
  label: string;
  /** Lo que dice: el bloque que la nombra o el primer renglón de la sección, corto. */
  quote: string;
  /** Fotos de la sección. */
  photos: number;
}

export interface ScenePage {
  pageId: string;
  title: string;
  /** «Día 59» en un día de rodaje; si no, el título. */
  label: string;
  /** La fecha del día (de un reporte o de lo de adentro de un día), para ordenar. */
  date: string | null;
  stage: Stage;
  group: SceneGroupId;
  /** La página es la escena misma (la primera del árbol, o una repetida: `twin`). */
  self: boolean;
  /** Otra página con el mismo número de escena (las relaciones usan la primera; se resuelve en *Map › Pending*). */
  twin: boolean;
  /** La página es la escena o parte de ella (una ficha). */
  own: boolean;
  places: ScenePlace[];
}

export interface SceneMentionList {
  code: string;
  /** Las páginas por grupo, en el orden de `SCENE_GROUPS` (sin los grupos vacíos). */
  groups: { id: SceneGroupId; pages: ScenePage[] }[];
  /** Cuántas páginas hablan de ella, sin las páginas índice. */
  count: number;
  /** Cuántas páginas índice la nombran. */
  indexCount: number;
  /** Cuántas páginas tienen el número de la escena (más de una: repetida, D747). */
  scenePages: number;
}

const groupOf = (stage: Stage, index: boolean): SceneGroupId =>
  index ? 'index' : stage === 'breakdown' ? 'scene' : stage === 'scouting' || stage === 'location' ? 'location' : stage === 'shoot' ? 'shoot' : 'other';

const plain = (text: string) => text.replaceAll(SEPARATOR, ' ');

/**
 * Un extracto de `max` caracteres alrededor de la posición `at` del texto (donde el lector encontró la escena o el link
 * que lleva a ella; sin posición, desde el principio), cortado en palabras enteras.
 */
export function sceneSnippet(text: string, at = -1, max = 110): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  // La posición en el texto ya sin espacios repetidos.
  const a = at < 0 ? 0 : text.slice(0, at).replace(/\s+/g, ' ').trimStart().length;
  let start = a > 40 ? a - 40 : 0;
  if (start > 0) {
    const space = t.indexOf(' ', start);
    start = space >= 0 && space < a ? space + 1 : start;
  }
  let end = Math.min(t.length, start + max);
  if (end < t.length) {
    const space = t.lastIndexOf(' ', end);
    if (space > Math.max(start + 20, a)) end = space;
  }
  return `${start > 0 ? '…' : ''}${t.slice(start, end)}${end < t.length ? '…' : ''}`;
}

/** Dónde nombra o linkea la escena una unidad (posición en su texto), o -1. */
type Locate = (unit: number, text: string, heading: boolean) => number;

/**
 * Lo que dice un bloque que nombra la escena, centrado donde la nombra. En una tabla (una ficha: «Shot Name |
 * ERSO_101_074_010»), solo la fila que la nombra, «rótulo: valor»; la tabla entera es un renglón ilegible.
 */
function blockQuote(units: readonly SearchUnit[], meta: readonly BlockMeta[], blockId: string, locate: Locate): string {
  const bm = meta.find((x) => x.blockId === blockId);
  const idx: number[] = [];
  units.forEach((u, i) => {
    if (u.blockId === blockId && u.field !== 'name') idx.push(i);
  });
  let hit = -1;
  let off = -1;
  for (const i of idx) {
    const o = locate(i, plain(units[i].text), (bm?.level ?? 0) > 0 && units[i].field === 'text');
    if (o >= 0) {
      hit = i;
      off = o;
      break;
    }
  }
  const join = (list: number[], sep: string) => {
    let text = '';
    let at = -1;
    list.forEach((i, k) => {
      if (k) text += sep;
      if (i === hit) at = text.length + off;
      text += plain(units[i].text);
    });
    return sceneSnippet(text, at);
  };
  const row = hit >= 0 ? bm?.cells?.find((c) => c.unit === hit)?.row : undefined;
  if (row !== undefined) {
    const list = bm!
      .cells!.filter((c) => c.row === row)
      .sort((a, b) => a.col - b.col)
      .map((c) => c.unit)
      .filter((i) => plain(units[i].text).trim());
    return join(list, list.length === 2 ? ': ' : ' · ');
  }
  return join(idx, ' ');
}

/** Lo que se sabe de una página para la escena: su mención (secciones y bloques) y los bloques que la linkean. */
interface Where {
  sections: MapSectionRef[];
  blockIds: string[];
}

/** Los lugares de una página: sus secciones de la escena y los bloques fuera de ellas, en el orden de la página. */
function placesOf(w: Where, content: { units: readonly SearchUnit[]; meta: readonly BlockMeta[] } | null, locate: Locate): ScenePlace[] {
  const units = content?.units;
  if (!content || !units) {
    // Sin lo leído (no debería pasar: la mención sale de ahí), el primer lugar sin extracto.
    const s = w.sections[0];
    if (s) return [{ blockId: s.blockId, endBlockId: s.endBlockId, label: s.title, quote: '', photos: s.photos }];
    return w.blockIds[0] ? [{ blockId: w.blockIds[0], label: '', quote: '', photos: 0 }] : [];
  }
  const at = new Map<string, number>();
  units.forEach((u, i) => {
    if (!at.has(u.blockId)) at.set(u.blockId, i);
  });
  const pos = (id: string | null) => (id === null ? Infinity : (at.get(id) ?? Infinity));
  const out: (ScenePlace & { at: number })[] = [];
  const ranges: [number, number][] = [];
  for (const s of w.sections) {
    const from = pos(s.blockId);
    const to = pos(s.endBlockId);
    ranges.push([from, to]);
    // El primer renglón de la sección que no es su título.
    const first = units.find((u, i) => i > from && i < to && u.blockId !== s.blockId && u.field !== 'name' && plain(u.text).trim());
    const quote = first ? blockQuote(units, content.meta, first.blockId, locate) : '';
    out.push({ blockId: s.blockId, endBlockId: s.endBlockId, label: s.title, quote, photos: s.photos, at: from });
  }
  for (const id of new Set(w.blockIds)) {
    const p = pos(id);
    // Lo que nombra la escena adentro de una sección suya ya lo cubre la sección.
    if (ranges.some(([a, b]) => p >= a && p < b)) continue;
    out.push({ blockId: id, label: '', quote: blockQuote(units, content.meta, id, locate), photos: 0, at: p });
  }
  return out.sort((a, b) => a.at - b.at).map(({ at: _at, ...p }) => p);
}

/** A qué escena lleva un link a una página: la escena (cualquiera de sus páginas) o lo de adentro (una ficha). */
function sceneOfPage(src: Pick<LiveSource, 'snap'>, pageId: string): string | null {
  const role = src.snap.registration.roles.get(pageId);
  if (!role || role.excluded) return null;
  if (role.entity?.kind === 'scene') return role.entity.ref;
  if (role.partOf?.kind === 'scene') return role.partOf.ref;
  return null;
}

/**
 * Las páginas que linkean cada escena: un link a la escena, a otra página con su número o a lo de adentro (una ficha:
 * el índice tapa el texto de un link con su destino, y una ficha no es una entidad, así que esos links no son menciones).
 * Y las páginas que, contando esas escenas además de lo que nombran, pasan de `INDEX_PAGE_MIN` (una tabla de decorados
 * con links a las fichas): son páginas índice. Se arma una vez por foto.
 */
export interface SceneLinks {
  /** escena → página que la linkea → los bloques del link, en orden. */
  byScene: Map<string, Map<string, string[]>>;
  index: Set<string>;
}

export function sceneLinks(src: Pick<LiveSource, 'snap' | 'content'>): SceneLinks {
  const byScene = new Map<string, Map<string, string[]>>();
  const index = new Set<string>();
  for (const [pageId, rel] of src.snap.pages) {
    const meta = src.content(pageId)?.meta;
    if (!meta) continue;
    const reached = new Set<string>();
    for (const b of meta) {
      for (const l of b.links ?? []) {
        if (l.pageId === pageId) continue;
        const code = sceneOfPage(src, l.pageId);
        if (!code) continue;
        reached.add(code);
        let pages = byScene.get(code);
        if (!pages) byScene.set(code, (pages = new Map()));
        const blocks = pages.get(pageId) ?? [];
        if (!blocks.includes(b.blockId)) blocks.push(b.blockId);
        pages.set(pageId, blocks);
      }
    }
    if (!reached.size) continue;
    const named = new Set(rel.mentions.filter((x) => x.kind === 'scene').map((x) => x.ref));
    let more = 0;
    for (const c of reached) if (!named.has(c)) more++;
    if (rel.entities + more > INDEX_PAGE_MIN) index.add(pageId);
  }
  return { byScene, index };
}

/** Las páginas de la escena, sin extractos: lo que comparten la lista y la cuenta. */
function collect(m: ProjectMapData, code: string, links: SceneLinks) {
  const scene = m.scenes.find((s) => s.code === code);
  if (!scene) return null;
  // Todas las páginas con su número (la primera del árbol es la de las relaciones; las otras, repetidas).
  const twins = m.duplicates.find((d) => d.kind !== 'day' && d.code === code)?.pageIds ?? [];
  const selfIds = [...new Set([...(scene.pageId ? [scene.pageId] : []), ...twins])];
  const entries = new Map<string, { mention: MapMention | null; linked: string[] }>();
  const at = (id: string) => {
    let e = entries.get(id);
    if (!e) entries.set(id, (e = { mention: null, linked: [] }));
    return e;
  };
  for (const id of selfIds) at(id);
  for (const id of scene.cards) at(id);
  for (const men of scene.mentions) at(men.pageId).mention = men;
  for (const [id, blocks] of links.byScene.get(code) ?? []) at(id).linked.push(...blocks);
  const own = (id: string, men: MapMention | null) => selfIds.includes(id) || scene.cards.includes(id) || !!men?.own;
  const isIndex = (id: string, men: MapMention | null) => !own(id, men) && (!!men?.index || links.index.has(id));
  return { scene, selfIds, entries, own, isIndex };
}

/**
 * Cuántas páginas hablan de una escena, sin las páginas índice: lo mismo que `sceneMentions(…).count`, sin leer el
 * texto (para la columna *Pages* de *Map › Scenes*, una vez por escena).
 */
export function scenePageCount(m: ProjectMapData, code: string, links: SceneLinks): number {
  const c = collect(m, code, links);
  if (!c) return 0;
  let n = 0;
  for (const [id, e] of c.entries) if (!c.isIndex(id, e.mention)) n++;
  return n;
}

/**
 * Todas las páginas que hablan de la escena `code`, por grupo: la escena y su desglose (sus páginas primero, también una
 * repetida, después sus fichas y las demás del desglose que la nombran o la linkean), locaciones y scoutings, días de
 * rodaje (por fecha) y otras páginas; las páginas índice (más de 20 escenas y locaciones, contando los links) al final,
 * aparte. La escena y sus fichas están aunque no la nombren en el texto. Con `excerpts: false` no lee el texto.
 */
export function sceneMentions(
  m: ProjectMapData,
  code: string,
  src: Pick<LiveSource, 'snap' | 'content' | 'title'>,
  opts: { excerpts?: boolean; links?: SceneLinks } = {},
): SceneMentionList | null {
  const c = collect(m, code, opts.links ?? sceneLinks(src));
  if (!c) return null;
  const { scene, selfIds, entries } = c;
  const roles = src.snap.registration.roles;
  const R = src.snap.registry;
  const days = new Map(m.days.map((d) => [d.pageId, d]));
  const pages: ScenePage[] = [];
  for (const [pageId, { mention, linked }] of entries) {
    const info = m.pages.get(pageId);
    const role = roles.get(pageId);
    const stage = mention?.stage ?? role?.stage ?? info?.stage ?? 'other';
    const dayId = dayIdOf(src, pageId);
    const day = dayId ? days.get(dayId) : undefined;
    // El mapa anota solo las páginas que nombran escenas o locaciones; una que entra solo por un link a una ficha (un
    // decorado, una lista de assets) no está ahí: su título sale del árbol, como en `projectMap`.
    const title = info?.title ?? src.title(pageId) ?? '';
    const self = selfIds.includes(pageId);
    const content = opts.excerpts === false ? null : (src.content(pageId) ?? null);
    // Dónde la nombra el lector o dónde la linkea, para centrar el extracto (nunca en el número de otra escena).
    const ctxEp = role?.ep ?? null;
    const locate: Locate = (unit, text, heading) => {
      const meta = content?.meta;
      if (meta) {
        for (const b of meta) for (const l of b.links ?? []) if (l.unit === unit && sceneOfPage(src, l.pageId) === code) return l.start;
      }
      const hit = scan(R, text, { heading, ep: ctxEp }).find((h) => h.kind === 'scene' && h.ref === code);
      return hit ? hit.s : -1;
    };
    pages.push({
      pageId,
      title,
      label: dayId === pageId && day ? day.label : title,
      date: day?.date ?? null,
      stage,
      group: groupOf(stage, c.isIndex(pageId, mention)),
      self,
      twin: self && pageId !== scene.pageId,
      own: c.own(pageId, mention),
      places:
        opts.excerpts === false || (!mention && !linked.length)
          ? []
          : placesOf({ sections: mention?.sections ?? [], blockIds: [...(mention?.blockIds ?? []), ...linked] }, content, locate),
    });
  }

  const groups = new Map<SceneGroupId, ScenePage[]>();
  for (const p of pages) groups.set(p.group, [...(groups.get(p.group) ?? []), p]);
  // La escena primero (la de las relaciones, después la repetida) y sus fichas después, en el orden de la barra lateral;
  // los días por fecha.
  const rank = (p: ScenePage) => (p.self && !p.twin ? 0 : p.twin ? 1 : p.own ? 2 : 3);
  groups.get('scene')?.sort((a, b) => rank(a) - rank(b));
  groups.get('shoot')?.sort((a, b) => ((a.date ?? '9999') < (b.date ?? '9999') ? -1 : (a.date ?? '9999') > (b.date ?? '9999') ? 1 : 0));
  const list = SCENE_GROUPS.filter((g) => groups.has(g)).map((id) => ({ id, pages: groups.get(id)! }));
  const indexCount = groups.get('index')?.length ?? 0;
  return { code, groups: list, count: pages.length - indexCount, indexCount, scenePages: selfIds.length };
}

// --- La sección de la barra lateral --------------------------------------------------------------------------------

export interface SceneNavItem {
  code: string;
  title: string;
  pageId: string | null;
}

/** Las escenas por episodio (en orden de número), con su título en vivo, para la sección *Scenes* de la barra lateral. */
export function sceneEpisodes(scenes: Iterable<SceneEntry>, title: (pageId: string) => string | undefined): { ep: string; scenes: SceneNavItem[] }[] {
  const list = [...scenes].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  const out: { ep: string; scenes: SceneNavItem[] }[] = [];
  for (const s of list) {
    const ep = s.ep ?? '';
    let group = out[out.length - 1];
    if (!group || group.ep !== ep) out.push((group = { ep, scenes: [] }));
    group.scenes.push({ code: s.code, title: s.pageId ? sceneTitleOf(title(s.pageId)) : '', pageId: s.pageId });
  }
  return out;
}

/**
 * Una dirección del mapa a la que `navigate` sí va. `navigate` no hace nada si la ruta es la misma sin mirar lo de
 * después del «?» (`/map/scenes?scene=…` → `/map/scenes`): entonces va con la barra final, que es la misma pantalla
 * (D746). Sirve para «All scenes», la pestaña *Scenes* y la fila *Map* desde la vista de una escena.
 */
export function mapPathFrom(path: string, here: { pathname: string; search: string }): string {
  return here.search && here.pathname === path ? `${path}/` : path;
}

/** La dirección de una escena en el mapa: la lista de las páginas que hablan de ella (`/map/scenes?scene=105_027`). */
export function sceneMapPath(code: string): string {
  return `${mapPath('scenes')}?scene=${encodeURIComponent(code)}`;
}
