import { emptyValue, FIELD_LABELS, normLabel, type FieldValue, type PageFields } from './fields';
import { pageBlocks, shotSections, type LiveSource, type Place } from './liveView';
import type { RelationSnapshot } from './relationIndex';

// *Overview › Shots* (D813, `Docs/Plan_Fichas_Cuaderno.md`, parte 3): la tabla de planos que reemplaza a `BD Main`. Una
// fila por plano de todas las escenas, armada con lo que el índice ya tiene en memoria: los planos escritos adentro de
// la página de la escena (un título 2 adentro del título 1 «Planos» / «Shots», D785, con su tabla de dos columnas) y las
// fichas que siguen siendo subpáginas de la escena. Solo lee: se escribe en la escena, no en la tabla.

export interface ShotRow {
  /** Único en la tabla (la página y el bloque). */
  key: string;
  /** El código de la escena (`105_027`). */
  scene: string;
  /** El nombre del plano: el título de su sección (el de D785, con su « · 2» si se repite) o el de su ficha. */
  shot: string;
  /** A dónde lleva la fila: la sección del plano en la página de la escena, o la ficha. */
  place: Place;
  /** El valor de cada columna (por rótulo normalizado), en un renglón. */
  values: Map<string, string>;
  /** El rótulo de cada columna como está escrito en este plano. */
  labels: Map<string, string>;
}

export interface ShotColumn {
  key: string;
  /** El rótulo como está escrito la primera vez que aparece. */
  label: string;
  /** En cuántos planos tiene algo. */
  filled: number;
}

export interface ShotsTable {
  columns: ShotColumn[];
  rows: ShotRow[];
  /** Las escenas con algún plano y las que no tienen ninguno. */
  scenes: number;
  withoutShots: number;
}

const SHOT_KEYS = new Set(FIELD_LABELS.shot.map(normLabel));
// Primero, las columnas que se buscan siempre; después, las demás por cuántos planos las tienen.
const FIRST = ['description', 'set', 'location', 'shootDate', 'intExt', 'openQuestion', 'vfxCat'] as const;
const firstOrder = new Map<string, number>();
FIRST.forEach((name, i) => {
  for (const label of FIELD_LABELS[name]) if (!firstOrder.has(normLabel(label))) firstOrder.set(normLabel(label), i);
});

/** Un valor en un renglón: los renglones separados por « / ». */
const oneLine = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' / ');

/** `105_027` antes que `105_027A` y que `105_028`; los números como números. */
export const byScene = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });

/** Un plano: su nombre y sus campos, sin la escena (la fila completa la arma `buildShotsTable`). */
function rowOf(scene: string, place: Place, fields: FieldValue[], shot: string): ShotRow {
  const values = new Map<string, string>();
  const labels = new Map<string, string>();
  for (const f of fields) {
    const text = oneLine(f.text);
    if (emptyValue(text)) continue;
    // El *Shot Name* que ya está en el nombre de la fila (`PRUEBA_105_029_010` en «PRUEBA_105_029_010 Ambulancia» o en
    // «… · 2») no es una columna; uno distinto sí (no se pierde nada).
    if (SHOT_KEYS.has(f.key) && normLabel(shot).includes(normLabel(text))) continue;
    // Un mismo rótulo dos veces en el mismo plano: se juntan.
    values.set(f.key, values.has(f.key) ? `${values.get(f.key)} / ${text}` : text);
    if (!labels.has(f.key)) labels.set(f.key, f.label.trim());
  }
  return { key: `${place.pageId}:${place.blockId}`, scene, shot, place, values, labels };
}

// Lo de cada página se guarda por sus objetos de contenido y de campos, que el índice conserva mientras la página no
// cambia (`relationIndex.ts`): con ~700 planos, una foto nueva rearma solo lo de las páginas que cambiaron.
const sceneMemo = new WeakMap<PageFields, { content: unknown; code: string; rows: ShotRow[] }>();
const cardMemo = new WeakMap<PageFields, { code: string; title: string; rows: ShotRow[] }>();

/** Los planos escritos adentro de la página de una escena (D785): un título 2 por plano adentro del título 1 «Planos». */
function sceneRows(src: LiveSource, code: string, pageId: string): ShotRow[] {
  const content = src.content(pageId);
  const pf = src.snap.fields.get(pageId) ?? EMPTY;
  const known = sceneMemo.get(pf);
  if (known && known.content === content && known.code === code) return known.rows;
  const pb = pageBlocks(content);
  const at = pb ? new Map(pb.ids.map((b, i) => [b, i])) : new Map<string, number>();
  const rows = shotSections(pb).map((s) => {
    const mine = pf.fields.filter((f) => {
      const i = at.get(f.blockId) ?? -1;
      return i > s.start && i < s.end;
    });
    return rowOf(code, { pageId, blockId: s.blockId, endBlockId: s.endBlockId }, mine, s.title || code);
  });
  if (pf !== EMPTY && content !== undefined) sceneMemo.set(pf, { content, code, rows });
  return rows;
}

/** Una ficha que todavía es subpágina de la escena: un plano, si tiene algo escrito en campos. */
function cardRows(src: LiveSource, code: string, id: string): ShotRow[] {
  const pf = src.snap.fields.get(id);
  // Una subpágina sin nada escrito en campos (una foto, un anexo) no es un plano.
  if (!pf?.fields.length) return [];
  const title = src.title(id) || code;
  const known = cardMemo.get(pf);
  if (known && known.code === code && known.title === title) return known.rows;
  const rows = [rowOf(code, { pageId: id, blockId: pf.fields[0].blockId }, pf.fields, title)];
  cardMemo.set(pf, { code, title, rows });
  return rows;
}

const EMPTY: PageFields = { fields: [], coords: null };
const cache = new WeakMap<RelationSnapshot, ShotsTable>();

/** La tabla de planos de la foto de relaciones (guardada por foto, como `setIndex`). */
export function shotsTable(src: LiveSource): ShotsTable {
  const known = cache.get(src.snap);
  if (known) return known;
  const table = buildShotsTable(src);
  cache.set(src.snap, table);
  return table;
}

export function buildShotsTable(src: LiveSource): ShotsTable {
  const { snap } = src;
  const rows: ShotRow[] = [];
  let scenes = 0;
  let withoutShots = 0;

  // Las fichas de cada escena: las subpáginas directas de su página que no son un documento (un scouting, una prueba o
  // un plan adentro de la escena no es un plano), como las que trae *Bring them into this page* (`FoldShots.tsx`).
  const cardsOf = new Map<string, string[]>();
  for (const [id, role] of snap.registration.roles) {
    const of = role.partOf;
    if (role.excluded || role.doc || of?.kind !== 'scene' || !of.ref || role.parent !== of.pageId || src.title(id) === undefined) continue;
    cardsOf.set(of.ref, [...(cardsOf.get(of.ref) ?? []), id]);
  }
  const order = new Map([...snap.pages.keys()].map((id, i) => [id, i]));
  // Una escena en dos páginas (D401: *Pending › Merge*): los planos de las dos, hasta que se unan.
  const twins = new Map(snap.registration.duplicates.map((d) => [d.code, d.pageIds]));

  for (const code of [...snap.registry.scenes.keys()].sort(byScene)) {
    const entry = snap.registry.scenes.get(code)!;
    const before = rows.length;
    const pages = [...new Set([entry.pageId, ...(twins.get(code) ?? [])])].filter((id): id is string => !!id && src.title(id) !== undefined);
    for (const pageId of pages) rows.push(...sceneRows(src, code, pageId));
    const cards = (cardsOf.get(code) ?? []).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    for (const id of cards) rows.push(...cardRows(src, code, id));
    if (rows.length > before) scenes++;
    else withoutShots++;
  }

  const columns = new Map<string, ShotColumn>();
  for (const r of rows) {
    for (const key of r.values.keys()) {
      const col = columns.get(key);
      if (col) col.filled++;
      else columns.set(key, { key, label: r.labels.get(key) ?? key, filled: 1 });
    }
  }
  const cols = [...columns.values()].sort((a, b) => {
    const fa = firstOrder.get(a.key) ?? Infinity;
    const fb = firstOrder.get(b.key) ?? Infinity;
    return fa !== fb ? fa - fb : b.filled - a.filled || a.label.localeCompare(b.label);
  });
  return { columns: cols, rows, scenes, withoutShots };
}

/** La tabla como texto separado por tabulaciones, para pegar en una planilla (presupuesto, vendors). */
export function shotsTsv(table: ShotsTable, rows: ShotRow[], headers: { scene: string; shot: string }): string {
  const clean = (text: string) => text.replace(/[\t\r\n]+/g, ' ');
  const head = [headers.scene, headers.shot, ...table.columns.map((c) => c.label)];
  const body = rows.map((r) => [r.scene, r.shot, ...table.columns.map((c) => r.values.get(c.key) ?? '')].map(clean).join('\t'));
  return [head.map(clean).join('\t'), ...body].join('\n');
}
