import { SEPARATOR, type BlockMeta, type SearchUnit } from '../search/extract';
import { scan, type Hit, type HitForm, type Registry } from './reader';

// Las relaciones de una página (Docs/Doc_Relaciones.md, sección 3): qué escenas y locaciones nombra cada bloque y qué
// secciones abre. Puro: recibe lo que la búsqueda ya leyó del documento (las unidades de texto y, por bloque, su nivel
// de título, sus links a páginas y sus fotos) y el registro de lo que existe.
//
// - **Mención:** una entidad nombrada en un bloque: en un título (`heading`), en el texto (`text`) o con un link a su
//   página (`link`, la señal más fuerte: los renglones «→ Escena 101_074» de un día).
// - **Sección:** cada título abre una sección hasta el próximo título de su nivel o mayor (o el final de la página).
//   Si el título nombra escenas, la sección es de esas escenas, y las fotos de adentro (también las de sus
//   subsecciones) son de ellas, no de la página entera.
// - Un link a una página tapa su texto: lo nombra el link, no lo que diga el texto.

export type MentionVia = 'heading' | 'text' | 'link';

export interface Mention {
  blockId: string;
  /** El orden del bloque en la página (0, 1, 2…). */
  block: number;
  kind: 'scene' | 'pending' | 'loc';
  ref: string;
  part: string;
  via: MentionVia;
  form: HitForm | 'link';
  /** La nombra sin dibujarse aparte (las del medio de un rango). */
  hidden: boolean;
  /** Las secciones abiertas en ese bloque (índices de `sections`), de la más externa a la más interna. */
  sections: number[];
}

export interface Section {
  blockId: string;
  block: number;
  /** El primer bloque que ya no es de la sección (`blocks` si llega al final). */
  end: number;
  /** El bloque que la cierra (un título), o `null` si llega al final de la página. */
  endBlockId: string | null;
  level: number;
  title: string;
  /** Las escenas (y pendientes) que nombra el título. */
  scenes: { kind: 'scene' | 'pending'; ref: string; part: string }[];
  /** Las fotos y archivos (`sdmedia://<id>`) de adentro, sin repetir, en orden. */
  media: string[];
}

export interface PageRelations {
  mentions: Mention[];
  sections: Section[];
  /** Las fotos de la página por bloque. */
  media: { blockId: string; block: number; ids: string[] }[];
  /** Cuántos bloques tiene la página (los que tienen texto, título, fotos o links). */
  blocks: number;
  /** Cuántas escenas y locaciones distintas nombra (más de `INDEX_PAGE_MIN`: una página índice). */
  entities: number;
}

/** Una página que nombra más que esto (escenas y locaciones distintas) es una página índice (regla de S1). */
export const INDEX_PAGE_MIN = 20;

/** A qué entidad lleva un link a otra página (si esa página es una escena o una locación). */
export type LinkTarget = (pageId: string) => { kind: 'scene' | 'loc'; ref: string } | null;

export interface PageReadContext {
  /** El episodio de la página (si es una escena o está adentro de una): «Esc 27». */
  ep?: string | null;
  /**
   * Lo reconocido en la lectura anterior de la misma página, por texto (`prev`), y dónde guardar lo de esta (`next`):
   * al releer la página abierta, solo se vuelve a leer lo que cambió. Vale mientras no cambie lo que existe.
   */
  scans?: { prev?: Map<string, Hit[]>; next: Map<string, Hit[]> };
  /**
   * Las unidades donde se espera un lugar: el valor de un campo de locación (*Locacion Real*, `placeUnits`, D530). Se
   * leen como el título de un día (con los alias de lugar); la mención sigue siendo de texto.
   */
  place?: ReadonlySet<number>;
}

interface Block {
  blockId: string;
  level: number;
  units: { unit: SearchUnit; index: number }[];
  meta: BlockMeta | null;
}

/** Los bloques de la página, en orden: los que tienen texto (de las unidades) y los que solo tienen nivel o fotos. */
export function blocksOf(units: readonly SearchUnit[], meta: readonly BlockMeta[]): Block[] {
  const out: Block[] = [];
  let ui = 0;
  let mi = 0;
  while (ui < units.length || mi < meta.length) {
    const m = mi < meta.length && meta[mi].at <= ui ? meta[mi] : null;
    if (m && units[ui]?.blockId !== m.blockId) {
      // Un bloque sin texto: un título vacío o fotos.
      out.push({ blockId: m.blockId, level: m.level, units: [], meta: m });
      mi++;
      continue;
    }
    const blockId = units[ui].blockId;
    const block: Block = { blockId, level: m ? m.level : 0, units: [], meta: m };
    if (m) mi++;
    while (ui < units.length && units[ui].blockId === blockId) {
      block.units.push({ unit: units[ui], index: ui });
      ui++;
    }
    out.push(block);
  }
  return out;
}

/** El texto de una unidad para leer: con los links tapados (los nombra el link) y los separadores como espacios. */
function readable(text: string, links: { start: number; end: number }[]): string {
  let t = text.includes(SEPARATOR) ? text.replaceAll(SEPARATOR, ' ') : text;
  for (const l of links) t = t.slice(0, l.start) + ' '.repeat(Math.max(0, l.end - l.start)) + t.slice(l.end);
  return t;
}

export function readPageRelations(
  R: Registry,
  units: readonly SearchUnit[],
  meta: readonly BlockMeta[],
  ctx: PageReadContext = {},
  linkTarget: LinkTarget = () => null,
): PageRelations {
  const blocks = blocksOf(units, meta);
  const mentions: Mention[] = [];
  const sections: Section[] = [];
  const media: PageRelations['media'] = [];
  const seenMedia: Set<string>[] = [];
  const stack: number[] = [];
  const distinct = new Set<string>();
  blocks.forEach((b, bi) => {
    const lvl = b.level;
    if (lvl) {
      while (stack.length && sections[stack[stack.length - 1]].level >= lvl) {
        const s = sections[stack.pop()!];
        s.end = bi;
        s.endBlockId = b.blockId;
      }
    }
    const found: (Omit<Mention, 'blockId' | 'block' | 'sections'>)[] = [];
    for (const { unit, index } of b.units) {
      // Los nombres de archivo no cuentan (IMG_1074.JPG); los pies de foto sí.
      if (unit.field === 'name') continue;
      const links = (b.meta?.links ?? []).filter((l) => l.unit === index);
      for (const l of links) {
        const target = linkTarget(l.pageId);
        if (target) found.push({ kind: target.kind, ref: target.ref, part: '', via: 'link', form: 'link', hidden: false });
      }
      const heading = lvl > 0 && unit.field === 'text';
      const place = !heading && unit.field === 'text' && !!ctx.place?.has(index);
      const text = readable(unit.text, links);
      // La clave separa el contexto: la misma frase en un título, en el texto o en un campo de lugar se lee distinto.
      const key = `${heading ? 'h' : place ? 'p' : 't'}\u0000${text}`;
      let hits = ctx.scans?.next.get(key) ?? ctx.scans?.prev?.get(key);
      if (!hits) hits = scan(R, text, place ? { heading, ep: ctx.ep ?? null, dayTitle: true } : { heading, ep: ctx.ep ?? null });
      ctx.scans?.next.set(key, hits);
      for (const h of hits) {
        found.push({ kind: h.kind, ref: h.ref, part: h.part, via: heading ? 'heading' : 'text', form: h.form, hidden: !!h.hidden });
      }
    }
    const ids = b.meta?.media ?? [];
    if (ids.length) {
      media.push({ blockId: b.blockId, block: bi, ids });
      for (const si of stack) {
        for (const id of ids) {
          if (seenMedia[si].has(id)) continue;
          seenMedia[si].add(id);
          sections[si].media.push(id);
        }
      }
    }
    if (lvl) {
      const owners = found.filter((x) => x.kind === 'scene' || x.kind === 'pending') as { kind: 'scene' | 'pending'; ref: string; part: string }[];
      const title = b.units.filter((u) => u.unit.field === 'text').map((u) => u.unit.text).join(' ').replaceAll(SEPARATOR, ' ').trim();
      sections.push({
        blockId: b.blockId,
        block: bi,
        end: blocks.length,
        endBlockId: null,
        level: lvl,
        title,
        scenes: owners.map((o) => ({ kind: o.kind, ref: o.ref, part: o.part })),
        media: [],
      });
      seenMedia.push(new Set());
      stack.push(sections.length - 1);
    }
    for (const x of found) {
      if (x.kind !== 'pending') distinct.add(`${x.kind}:${x.ref}`);
      mentions.push({ ...x, blockId: b.blockId, block: bi, sections: stack.slice() });
    }
  });
  return { mentions, sections, media, blocks: blocks.length, entities: distinct.size };
}
