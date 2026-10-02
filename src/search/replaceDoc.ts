import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { SEPARATOR } from './extract';
import { searchText, type SearchOptions } from './normalize';

// Reemplazar en el Y.Doc de una página, sin editor (Docs/Doc_Buscar.md, "Reemplazar en el proyecto (diseño)",
// secciones 2.3 y 3, con la auditoría). Puro: no guarda nada ni abre nada; quien llama lo hace adentro del candado de
// la página y escribe con `PageDocs.applyLocal`.
//
// - **El plan:** recorre los bloques con la misma regla que `unitsFromYDoc` (extract.ts), así "la coincidencia N de
//   este bloque" es la misma que cuentan la búsqueda del proyecto y la barra de la página. El texto de un bloque de
//   texto tiene un tramo por cada `Y.XmlText` (los seguidos se leen como uno, como el editor con los huecos
//   estables); lo que no es texto (un salto de línea, una foto en línea, la marca del renglón, un "\n") separa.
// - **Cada coincidencia** se identifica por los ids de Yjs de su primer y su último carácter (no por su número: si
//   otro agrega una antes, la número N es otra). Una que cruza el borde entre dos `Y.XmlText` (un renglón al que le
//   borraron una foto) no se escribe.
// - **Escribir:** `delete` + `insert` en el `Y.XmlText`, con el formato del primer carácter, de atrás para adelante.
//   Nunca crea ni borra elementos. Las pegadas (el final de una es el principio de la otra) van en un solo cambio, así
//   las anclas quedan afuera.
// - **El registro** de cada cambio: lo de antes por partes con su formato, lo nuevo, y dos anclas
//   (`RelativePosition` del carácter de la izquierda y del de la derecha). Deshacer pone lo de antes solo si entre
//   las anclas está exactamente lo que se puso; con un borrado, además, los dos vecinos vivos y pegados.

export type Attrs = Record<string, unknown>;

export interface Run {
  text: string;
  attrs: Attrs;
}

/** Por qué una coincidencia no se cambia. */
export type SkipReason =
  /** En un pie de foto o en el nombre de un archivo (decisión 7). */
  | 'caption'
  | 'name'
  /** Borraría un link entero (una tarjeta de Drive se quedaría sin `href`). */
  | 'link'
  /** Cruza el borde entre dos textos de un renglón (una foto borrada). */
  | 'boundary'
  /** Ya es exactamente el reemplazo. */
  | 'same'
  /** Escondida en una sección colapsada y el reemplazo la borraría (pregunta 4: solo con la casilla). */
  | 'hidden'
  /** La persona la sacó de la lista. */
  | 'excluded';

export interface PlannedMatch {
  blockId: string;
  field: 'text' | 'caption' | 'name';
  /** Cuál de las coincidencias de su bloque es (en el orden de la búsqueda del proyecto). */
  occurrence: number;
  /** Los ids del primer y el último carácter (`client:clock-client:clock`); vacío en pies y nombres. */
  key: string;
  /** El texto encontrado. */
  text: string;
  /** En una sección colapsada (para vos o para todos). */
  hidden: boolean;
  skip?: SkipReason;
}

/** Un cambio guardado en el registro (JSON). */
export interface EditRecord {
  blockId: string;
  /** Cuántas coincidencias junta (las pegadas van juntas). */
  count: number;
  oldRuns: Run[];
  newRuns: Run[];
  /** `RelativePosition` como JSON: el carácter de la izquierda (`assoc -1`) y el de la derecha (`assoc 0`). */
  left: unknown;
  right: unknown;
  /** Los ids de las coincidencias que junta. */
  keys: string[];
}

interface Edit extends EditRecord {
  ytext: Y.XmlText;
  index: number;
  length: number;
}

export interface Plan {
  matches: PlannedMatch[];
  edits: Edit[];
}

export interface PlanOptions extends SearchOptions {
  /** Los bloques escondidos en secciones colapsadas (`hiddenBlocks`). */
  hidden?: ReadonlySet<string>;
  /** Con el reemplazo vacío, borrar también las escondidas (la casilla de la confirmación). */
  deleteHidden?: boolean;
  /** Ids de coincidencias que no se cambian (sacadas de la lista). */
  exclude?: ReadonlySet<string>;
  /** Solo estas (reemplazar una). */
  only?: ReadonlySet<string>;
}

const NESTED = 'blockGroup';
const CONTAINER = 'blockContainer';

interface Delta {
  text: string;
  ops: { at: number; len: number; attrs: Attrs }[];
}

function deltaOf(t: Y.XmlText): Delta {
  let text = '';
  const ops: Delta['ops'] = [];
  for (const op of t.toDelta() as { insert: unknown; attributes?: Attrs }[]) {
    // Un embebido cuenta uno en Yjs, como el separador.
    const piece = typeof op.insert === 'string' ? op.insert : SEPARATOR;
    ops.push({ at: text.length, len: piece.length, attrs: op.attributes ?? {} });
    text += piece;
  }
  return { text, ops };
}

function runsBetween(d: Delta, from: number, to: number): Run[] {
  const out: Run[] = [];
  for (const op of d.ops) {
    const s = Math.max(from, op.at);
    const e = Math.min(to, op.at + op.len);
    if (s < e) out.push({ text: d.text.slice(s, e), attrs: op.attrs });
  }
  return out;
}

function idOf(rel: Y.RelativePosition): string {
  const item = rel.item;
  return item ? `${item.client}:${item.clock}` : '';
}

/** Los ids del primer y el último carácter de un tramo. */
function keyOf(t: Y.XmlText, index: number, length: number): string {
  return `${idOf(Y.createRelativePositionFromTypeIndex(t, index, 0))}-${idOf(Y.createRelativePositionFromTypeIndex(t, index + length - 1, 0))}`;
}

const sameAttrs = (a: Attrs, b: Attrs) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

/** Junta las partes seguidas con el mismo formato (como las da Yjs). */
function joined(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    const prev = out[out.length - 1];
    if (prev && sameAttrs(prev.attrs, r.attrs)) prev.text += r.text;
    else if (r.text) out.push({ text: r.text, attrs: r.attrs });
  }
  return out;
}

function sameRuns(a: Run[], b: Run[]): boolean {
  const x = joined(a);
  const y = joined(b);
  return x.length === y.length && x.every((r, i) => r.text === y[i].text && sameAttrs(r.attrs, y[i].attrs));
}

/** Un elemento es un bloque de texto si tiene texto adentro, o si no tiene ningún elemento hijo (como extract.ts). */
function isYTextblock(el: Y.XmlElement): boolean {
  const kids = el.toArray();
  return kids.some((k) => k instanceof Y.XmlText) || kids.every((k) => !(k instanceof Y.XmlElement) || isInlineLeaf(k));
}

function isInlineLeaf(el: Y.XmlElement): boolean {
  return el.length === 0 && el.nodeName !== NESTED && el.nodeName !== CONTAINER;
}

interface Segment {
  t: Y.XmlText;
  /** Dónde empieza en el texto del bloque. */
  at: number;
  d: Delta;
}

/**
 * Planea el reemplazo de `query` por `replacement` en el documento (no escribe nada). `matches` son todas las
 * coincidencias en orden, también las que no se cambian (con su motivo); `edits`, lo que se escribe.
 */
export function planReplace(doc: Y.Doc, query: string, replacement: string, options: PlanOptions = {}): Plan {
  const plan: Plan = { matches: [], edits: [] };
  if (!query) return plan;
  const search: SearchOptions = { matchCase: options.matchCase, wholeWord: options.wholeWord };
  const occurrences = new Map<string, number>();
  const nextOccurrence = (blockId: string) => {
    const n = occurrences.get(blockId) ?? 0;
    occurrences.set(blockId, n + 1);
    return n;
  };

  const textblock = (el: Y.XmlElement, blockId: string) => {
    let text = '';
    const segs: Segment[] = [];
    for (const child of el.toArray()) {
      if (child instanceof Y.XmlText) {
        const d = deltaOf(child);
        segs.push({ t: child, at: text.length, d });
        text += d.text.includes('\n') ? d.text.replaceAll('\n', SEPARATOR) : d.text;
      } else {
        text += SEPARATOR;
      }
    }
    if (!text.split(SEPARATOR).join('').trim()) return;
    const hidden = options.hidden?.has(blockId) ?? false;
    const accepted: { seg: Segment; index: number; length: number; newAttrs: Attrs; key: string }[] = [];
    for (const [s, e] of searchText(text, query, search)) {
      const occurrence = nextOccurrence(blockId);
      const found = text.slice(s, e);
      const seg = segs.find((g) => s >= g.at && s < g.at + g.d.text.length);
      const match: PlannedMatch = { blockId, field: 'text', occurrence, key: '', text: found, hidden };
      plan.matches.push(match);
      if (!seg || e > seg.at + seg.d.text.length) {
        match.skip = 'boundary';
        continue;
      }
      const index = s - seg.at;
      const length = e - s;
      match.key = keyOf(seg.t, index, length);
      const oldRuns = runsBetween(seg.d, index, index + length);
      const newAttrs = oldRuns[0]?.attrs ?? {};
      // Se borraría un link entero: la coincidencia lo cubre y lo nuevo no lo lleva (vacío, o empieza afuera).
      const drops = seg.d.ops.some(
        (o) =>
          o.attrs.link !== undefined &&
          o.at >= index &&
          o.at + o.len <= index + length &&
          (replacement === '' || JSON.stringify(newAttrs.link) !== JSON.stringify(o.attrs.link)),
      );
      if (options.only && !options.only.has(match.key)) match.skip = 'excluded';
      else if (options.exclude?.has(match.key)) match.skip = 'excluded';
      else if (drops) match.skip = 'link';
      else if (oldRuns.length === 1 && oldRuns[0].text === replacement) match.skip = 'same';
      else if (hidden && replacement === '' && !options.deleteHidden) match.skip = 'hidden';
      if (match.skip) continue;
      accepted.push({ seg, index, length, newAttrs, key: match.key });
    }
    // Las pegadas (en el mismo texto, sin nada entre ellas) van en un solo cambio: las anclas quedan afuera.
    for (let i = 0; i < accepted.length; ) {
      let j = i;
      while (j + 1 < accepted.length && accepted[j + 1].seg === accepted[i].seg && accepted[j + 1].index === accepted[j].index + accepted[j].length) j++;
      const first = accepted[i];
      const last = accepted[j];
      const index = first.index;
      const length = last.index + last.length - index;
      const group = accepted.slice(i, j + 1);
      plan.edits.push({
        blockId,
        count: group.length,
        oldRuns: runsBetween(first.seg.d, index, index + length),
        newRuns: replacement ? group.map((g) => ({ text: replacement, attrs: g.newAttrs })) : [],
        left: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(first.seg.t, index, -1)),
        right: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(first.seg.t, index + length, 0)),
        keys: group.map((g) => g.key),
        ytext: first.seg.t,
        index,
        length,
      });
      i = j + 1;
    }
  };

  const collect = (el: Y.XmlElement, blockId: string) => {
    if (isYTextblock(el)) return textblock(el, blockId);
    for (const child of el.toArray()) {
      if (child instanceof Y.XmlElement && child.nodeName !== NESTED && child.nodeName !== CONTAINER) collect(child, blockId);
    }
  };

  const visit = (node: unknown) => {
    if (!(node instanceof Y.XmlElement)) return;
    if (node.nodeName === NESTED) {
      for (const child of node.toArray()) visit(child);
      return;
    }
    if (node.nodeName !== CONTAINER) return;
    const blockId = String(node.getAttribute('id') ?? '');
    let nested: Y.XmlElement | null = null;
    for (const child of node.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue;
      if (child.nodeName === NESTED) {
        nested = child;
        continue;
      }
      collect(child, blockId);
      for (const field of ['caption', 'name'] as const) {
        const value = child.getAttribute(field) as unknown;
        if (typeof value !== 'string' || !value.split(SEPARATOR).join('').trim()) continue;
        for (const [s, e] of searchText(value, query, search)) {
          plan.matches.push({
            blockId,
            field,
            occurrence: nextOccurrence(blockId),
            key: '',
            text: value.slice(s, e),
            hidden: options.hidden?.has(blockId) ?? false,
            skip: field,
          });
        }
      }
    }
    if (nested) visit(nested);
  };
  for (const child of doc.getXmlFragment(CONTENT_FRAGMENT).toArray()) visit(child);
  return plan;
}

/** Cuántas coincidencias cambia el plan. */
export function planCount(plan: Plan): number {
  return plan.edits.reduce((n, e) => n + e.count, 0);
}

/** Lo que se guarda en el registro (sin los objetos de Yjs). */
export function recordsOf(plan: Plan): EditRecord[] {
  return plan.edits.map(({ blockId, count, oldRuns, newRuns, left, right, keys }) => ({ blockId, count, oldRuns, newRuns, left, right, keys }));
}

/** Si dos registros dicen lo mismo (las anclas, lo de antes y lo nuevo; no los índices). */
export function sameRecords(a: EditRecord[], b: EditRecord[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Escribe el plan (adentro de una transacción de quien llama), de atrás para adelante en cada texto. */
export function applyPlan(plan: Plan): void {
  const byText = new Map<Y.XmlText, Edit[]>();
  for (const e of plan.edits) {
    const list = byText.get(e.ytext) ?? [];
    list.push(e);
    byText.set(e.ytext, list);
  }
  for (const [ytext, edits] of byText) {
    edits.sort((a, b) => b.index - a.index);
    for (const e of edits) {
      ytext.delete(e.index, e.length);
      let at = e.index;
      for (const run of e.newRuns) {
        ytext.insert(at, run.text, { ...run.attrs });
        at += run.text.length;
      }
    }
  }
}

type IdJson = { client: number; clock: number } | null | undefined;

const sameId = (x: IdJson, y: IdJson) => (!x && !y) || (!!x && !!y && x.client === y.client && x.clock === y.clock);

export type UndoOutcome = 'undone' | 'changed' | 'notApplied';

interface UndoStep {
  outcome: UndoOutcome;
  run?: () => void;
}

function undoStep(doc: Y.Doc, record: EditRecord): UndoStep {
  let left: Y.AbsolutePosition | null;
  let right: Y.AbsolutePosition | null;
  try {
    left = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(record.left), doc);
    right = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(record.right), doc);
  } catch {
    return { outcome: 'changed' };
  }
  // El texto ya no está (el bloque se rehízo, se borró, o lo copió una reparación): no se toca.
  if (!left || !right || left.type !== right.type || !(left.type instanceof Y.XmlText) || left.type._item?.deleted) return { outcome: 'changed' };
  const t = left.type;
  const a = left.index;
  const b = right.index;
  if (b < a) return { outcome: 'changed' };
  const span = runsBetween(deltaOf(t), a, b);
  const isNew = record.newRuns.length > 0 ? sameRuns(span, record.newRuns) : a === b;
  if (!isNew) return { outcome: sameRuns(span, record.oldRuns) ? 'notApplied' : 'changed' };
  if (record.newRuns.length === 0) {
    // Un borrado: los vecinos tienen que seguir vivos y pegados (si no, se resucitaría algo en medio de lo que otro
    // borró).
    const leftNow = a > 0 ? (Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(t, a, -1)) as { item?: IdJson }).item : null;
    const rightNow = b < t.length ? (Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(t, b, 0)) as { item?: IdJson }).item : null;
    if (!sameId(leftNow, (record.left as { item?: IdJson }).item ?? null) || !sameId(rightNow, (record.right as { item?: IdJson }).item ?? null)) {
      return { outcome: 'changed' };
    }
  }
  return {
    outcome: 'undone',
    run: () => {
      t.delete(a, b - a);
      let at = a;
      for (const run of record.oldRuns) {
        t.insert(at, run.text, { ...run.attrs });
        at += run.text.length;
      }
    },
  };
}

/**
 * Mira qué se puede deshacer (sin escribir) y devuelve, por cambio, el resultado y una función que lo escribe. Se
 * escribe de atrás para adelante: las anclas se ubican antes de tocar nada.
 */
export function planUndo(doc: Y.Doc, records: EditRecord[]): { outcomes: UndoOutcome[]; apply: () => void } {
  const steps = records.map((r) => undoStep(doc, r));
  return {
    outcomes: steps.map((s) => s.outcome),
    apply: () => {
      for (let i = steps.length - 1; i >= 0; i--) steps[i].run?.();
    },
  };
}

// --- Lo escondido ---------------------------------------------------------------------------------------------

/** El mapa de la página con lo colapsado para todos (el mismo nombre que `SHARED_COLLAPSE_MAP` de collapseEditor.ts). */
export const SHARED_COLLAPSE_MAP_NAME = 'collapsedHeadings';

/** Lo colapsado para vos de un título (`HeadingRecord` de collapse.ts, lo que hace falta acá). */
export interface CollapseRecord {
  c: boolean;
  e?: string;
}

function contentOf(container: Y.XmlElement): Y.XmlElement | null {
  const first = container.get(0);
  return first instanceof Y.XmlElement && first.nodeName !== NESTED ? first : null;
}

function levelOf(container: Y.XmlElement): number | null {
  const content = contentOf(container);
  if (!content || content.nodeName !== 'heading') return null;
  const level = Number(content.getAttribute('level'));
  return Number.isFinite(level) && level > 0 ? level : 1;
}

function groupOf(container: Y.XmlElement): Y.XmlElement | null {
  const last = container.get(container.length - 1);
  return container.length > 1 && last instanceof Y.XmlElement && last.nodeName === NESTED ? last : null;
}

function isEmptyParagraph(container: Y.XmlElement): boolean {
  const content = contentOf(container);
  if (!content || content.nodeName !== 'paragraph' || groupOf(container)) return false;
  return content.toArray().every((k) => k instanceof Y.XmlText && k.length === 0);
}

/**
 * Los bloques escondidos en secciones colapsadas, como los calcula el editor (`analyze` de collapse.ts) pero sobre
 * el Y.Doc: lo tuyo (`personal`) si lo hay; si no, lo colapsado para todos (el mapa del documento).
 */
export function hiddenBlocks(doc: Y.Doc, personal: ReadonlyMap<string, CollapseRecord> = new Map()): Set<string> {
  const hidden = new Set<string>();
  const shared = new Set<string>();
  const map = doc.share.has(SHARED_COLLAPSE_MAP_NAME) ? doc.getMap<unknown>(SHARED_COLLAPSE_MAP_NAME) : null;
  map?.forEach((value, key) => {
    if (value === true) shared.add(key);
  });
  const recordOf = (id: string): CollapseRecord | undefined => personal.get(id) ?? (shared.has(id) ? { c: true } : undefined);
  if (personal.size === 0 && shared.size === 0) return hidden;
  const root = doc.getXmlFragment(CONTENT_FRAGMENT).get(0);
  if (!(root instanceof Y.XmlElement) || root.nodeName !== NESTED) return hidden;

  const walk = (group: Y.XmlElement, hiddenBy: boolean, isRoot: boolean) => {
    const kids = group.toArray().filter((k): k is Y.XmlElement => k instanceof Y.XmlElement && k.nodeName === CONTAINER);
    let until = -1;
    for (let i = 0; i < kids.length; i++) {
      const kid = kids[i];
      const id = String(kid.getAttribute('id') ?? '');
      const here = hiddenBy || i < until;
      if (here && id) hidden.add(id);
      const level = levelOf(kid);
      const record = id ? recordOf(id) : undefined;
      const collapsed = level !== null && record?.c === true;
      if (collapsed && !here) {
        until = kids.length;
        for (let k = i + 1; k < kids.length; k++) {
          const l = levelOf(kids[k]);
          if (l !== null && l <= level) {
            until = k;
            break;
          }
          if (record?.e !== undefined && kids[k].getAttribute('id') === record.e) {
            until = k;
            break;
          }
          if (isRoot && k === kids.length - 1 && isEmptyParagraph(kids[k])) {
            until = k;
            break;
          }
        }
      }
      const children = groupOf(kid);
      if (children) walk(children, here || collapsed, false);
    }
  };
  walk(root, false, true);
  return hidden;
}
