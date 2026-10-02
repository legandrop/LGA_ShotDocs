import type { EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { yUndoPluginKey } from 'y-prosemirror';
import type * as Y from 'yjs';
import { asOneUndoStep } from '../ui/undoGuard';
import { snapshotOf, unchangedShift, type ApplyOutcome, type Snapshot } from './apply';
import type { AssistantEditor } from './assistantUi';
import { collectBetween, plainKey, WORD, type Atom, type Piece, type TextPiece } from './markup';
import { atomKeys, inlineContent, parseShape, toPartialBlocks, type MdBlock, type Restore, type ShapeError } from './mdBlocks';

// *Format as…* (Docs/Doc_Asistente.md, entrega A2, 6.3): los mismos datos de los bloques elegidos con otra forma
// (viñetas, casillas, tabla o títulos), solo con los tipos de bloque que ya existen. Trabaja sobre bloques enteros: lo
// elegido se estira al principio del primer bloque y al final del último.
//
// Al aplicar, lo menos posible:
// - `type`: la respuesta trae los mismos bloques con el mismo texto → solo cambia el tipo de cada uno (su id, sus hijos,
//   sus colores y su texto quedan; `updateBlock` sin contenido).
// - `update`: los mismos bloques con otro texto → cada uno conserva su id y sus hijos y cambia tipo y texto.
// - `replace`: otra cantidad de bloques (un párrafo partido en viñetas, una tabla) → se sacan los bloques elegidos y se
//   ponen los nuevos, en la misma edición; un bloque que no es texto (una foto, una tabla) vuelve tal cual, con su id.
//   Si un bloque elegido tiene bloques adentro (anidados), no se hace: se perderían.
//
// En los tres casos Yjs rehace el texto de los bloques que cambian de tipo (el nombre de un elemento de Yjs no cambia):
// lo que otro escribe SIN RED dentro de esos bloques y llega después queda en el historial, no en la página (6.5). La
// vista previa lo avisa. La guarda de "cambió mientras pensaba" es la de A1, más el tipo y las propiedades de cada bloque.

export type FormatTarget = 'bullets' | 'checklist' | 'table' | 'headings';

export const FORMATS: FormatTarget[] = ['bullets', 'checklist', 'table', 'headings'];

export interface FormatSnapshot {
  snapshot: Snapshot;
  /** Los bloques elegidos, en orden (sin repetir). */
  ids: string[];
  /** El tipo y las propiedades de cada uno al pedir (la guarda). */
  shapes: Map<string, string>;
  /** Lo que vuelve a armar las marcas (las fotos, los links y los bloques que no son texto). */
  restore: Restore;
}

export type FormatSnapError = 'empty' | 'tooLong' | 'inTable';

/** La celda de tabla de una posición, o -1. */
function cellOf(state: EditorState, pos: number): number {
  const $pos = state.doc.resolve(pos);
  for (let d = $pos.depth; d > 0; d--) {
    const name = $pos.node(d).type.name;
    if (name === 'tableCell' || name === 'tableHeader') return $pos.before(d);
  }
  return -1;
}

const shapeOf = (b: { type: string; props: Record<string, unknown> } | undefined) => (b ? JSON.stringify({ type: b.type, props: b.props }) : '');

/** Toma los bloques elegidos (enteros). Sin editor de BlockNote, `empty`: no hay cómo aplicar. */
export function takeFormatSnapshot(state: EditorState, editor: AssistantEditor | null): FormatSnapshot | FormatSnapError {
  if (!editor) return 'empty';
  const sel = state.selection;
  const cell = cellOf(state, sel.from);
  if (cell >= 0 && cell === cellOf(state, sel.to)) return 'inTable';
  const $from = state.doc.resolve(sel.from);
  const $to = state.doc.resolve(sel.to);
  const from = $from.parent.isTextblock ? $from.start() : sel.from;
  const to = $to.parent.isTextblock ? $to.end() : sel.to;
  const snapshot = snapshotOf(state, collectBetween(state.doc, from, to));
  if (typeof snapshot === 'string') return snapshot;
  return formatSnapshotFrom(snapshot, editor) ?? 'empty';
}

/**
 * Los bloques de una foto ya tomada (también la de *Try again* después de "cambió mientras pensaba", sobre lo que hay
 * hoy entre las anclas): sus ids, su forma para la guarda y lo que vuelve a armar las marcas. `null` sin editor.
 */
export function formatSnapshotFrom(snapshot: Snapshot, editor: AssistantEditor | null): FormatSnapshot | null {
  if (!editor) return null;
  const ids = [...new Set(snapshot.selected.pieces.map((p) => p.blockId).filter(Boolean))];
  const shapes = new Map(ids.map((id) => [id, shapeOf(editor.getBlock(id))]));
  const blocks = new Map<number, unknown>();
  for (const p of snapshot.selected.pieces) {
    if (p.kind !== 'block') continue;
    const b = editor.getBlock(p.blockId);
    if (b) blocks.set(p.marker, JSON.parse(JSON.stringify(b)));
  }
  return { snapshot, ids, shapes, restore: { photos: snapshot.selected.photos, links: snapshot.selected.links, blocks } };
}

export interface FormatPlan {
  mode: 'type' | 'update' | 'replace';
  blocks: MdBlock[];
  linksRemoved: boolean;
  /** Las letras de las palabras que la respuesta agrega (no estaban en lo elegido): la vista previa las marca. */
  added: Set<Atom>;
}

/** La respuesta dejó afuera palabras de lo elegido: no se aplica (6.4; "los mismos datos con otra forma"). */
export interface LostText {
  lost: string[];
}

const sameKeys = (a: string[], b: string[]) => a.length === b.length && a.every((k, i) => k === b[i]);

/**
 * Las conjunciones que se pueden caer al partir un renglón en ítems ("lente, T2.8 e ISO 800" → tres viñetas). Ninguna
 * otra palabra: un nombre, un número o una preposición que falta es texto perdido.
 */
const CONNECTORS = new Set(['y', 'e', 'o', 'u', 'ni', 'and', 'or', 'nor', 'et', 'ou', 'ed', 'und', 'oder', 'i']);

const norm = (w: string) => w.normalize('NFC').toLocaleLowerCase();

/** Las palabras de unas letras (con las mismas reglas que la diferencia de A1), con las letras de cada una. */
function wordsOf(atoms: Atom[]): { word: string; atoms: Atom[] }[] {
  const out: { word: string; atoms: Atom[] }[] = [];
  let cur: { word: string; atoms: Atom[] } | null = null;
  for (const a of atoms) {
    if (a.t === 'char' && WORD.test(a.ch)) {
      cur ??= { word: '', atoms: [] };
      cur.word += a.ch;
      cur.atoms.push(a);
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Las letras de todos los bloques nuevos (también las celdas de una tabla), en orden. */
function atomsOfBlocks(blocks: MdBlock[]): Atom[][] {
  return blocks.flatMap((b) => (b.kind === 'text' ? [b.atoms] : b.kind === 'table' ? b.rows.flatMap((r) => r) : []));
}

/**
 * Compara las palabras de lo elegido con las de la respuesta (sin formato, puntuación ni mayúsculas): las que faltan
 * (menos las conjunciones de `CONNECTORS`) y las letras de las que sobran. Con `presence` (una tabla) cuenta que cada
 * palabra aparezca, no cuántas veces: "Toma 1: 35 mm / Toma 2: 50 mm" pasa a una columna *Toma* con un solo rótulo.
 */
export function compareWords(fs: FormatSnapshot, blocks: MdBlock[], presence = false): { lost: string[]; added: Set<Atom> } {
  const before = new Map<string, number>();
  const shown = new Map<string, string>();
  for (const p of fs.snapshot.selected.pieces) {
    if (p.kind !== 'text') continue;
    for (const u of p.units) {
      if (u.atom || !WORD.test(u.text)) continue;
      // Una unidad de A1 puede juntar varias palabras con formato distinto: se parte igual que la respuesta.
      for (const w of u.text.split(/[^\p{L}\p{N}\p{M}_'’]+/u).filter(Boolean)) {
        const k = norm(w);
        before.set(k, (before.get(k) ?? 0) + 1);
        if (!shown.has(k)) shown.set(k, w);
      }
    }
  }
  const added = new Set<Atom>();
  const used = new Set<string>();
  for (const atoms of atomsOfBlocks(blocks)) {
    for (const w of wordsOf(atoms)) {
      const k = norm(w.word);
      const left = before.get(k) ?? 0;
      used.add(k);
      if (left > 0) before.set(k, left - 1);
      else for (const a of w.atoms) added.add(a);
    }
  }
  const lost: string[] = [];
  for (const [k, n] of before) {
    if (n <= 0 || CONNECTORS.has(k)) continue;
    if (presence && used.has(k)) continue;
    for (let i = 0; i < n; i++) lost.push(shown.get(k) ?? k);
  }
  return { lost, added };
}

/** La respuesta convertida y validada, con el modo de aplicar (el de menos cambios que alcanza). */
export function planFormat(answer: string, fs: FormatSnapshot, target?: FormatTarget): FormatPlan | ShapeError | LostText {
  const { pieces } = fs.snapshot.selected;
  const known = {
    photos: new Set(fs.snapshot.selected.photos.keys()),
    links: new Set(fs.snapshot.selected.links.keys()),
    blocks: new Set(pieces.flatMap((p) => (p.kind === 'block' ? [p.marker] : []))),
  };
  const parsed = parseShape(answer, known);
  if (typeof parsed === 'string') return parsed;
  const { blocks } = parsed;
  const sameShape =
    blocks.length === pieces.length &&
    blocks.every((b, i) => {
      const p: Piece = pieces[i];
      return p.kind === 'block' ? b.kind === 'marker' && b.n === p.marker : b.kind === 'text';
    });
  // Los mismos datos con otra forma: si falta una palabra (un renglón, una fila, un nombre), no se aplica.
  const words = compareWords(fs, blocks, target === 'table');
  if (words.lost.length > 0) return { lost: words.lost };
  let mode: FormatPlan['mode'] = 'replace';
  if (sameShape) {
    const sameText = blocks.every((b, i) => b.kind !== 'text' || sameKeys(atomKeys(b.atoms), (pieces[i] as TextPiece).units.map((u) => plainKey(u.key))));
    mode = sameText ? 'type' : 'update';
  }
  return { mode, blocks, linksRemoved: parsed.linksRemoved, added: words.added };
}

export type FormatOutcome = ApplyOutcome | { ok: false; reason: 'nested' };

/** Las propiedades del tipo nuevo (las demás, como el color, quedan las del bloque). */
function propsOf(b: Extract<MdBlock, { kind: 'text' }>): Record<string, unknown> {
  if (b.type === 'heading') return { level: b.level ?? 2 };
  if (b.type === 'checkListItem') return { checked: !!b.checked };
  return {};
}

/**
 * Aplica la forma nueva como UNA edición del editor (un Ctrl/⌘+Z la saca), si lo elegido sigue igual (texto, tipo y
 * propiedades de cada bloque) y se puede editar. Si algo falla en el medio, se deshace lo que haya quedado.
 */
export function applyFormat(editor: AssistantEditor | null, view: EditorView | null, fs: FormatSnapshot, plan: FormatPlan, canEdit: boolean): FormatOutcome {
  if (!canEdit || !editor || !view?.editable) return { ok: false, reason: 'readOnly' };
  if (unchangedShift(view.state, fs.snapshot) === null) return { ok: false, reason: 'changed' };
  for (const id of fs.ids) if (shapeOf(editor.getBlock(id)) !== fs.shapes.get(id)) return { ok: false, reason: 'changed' };
  const { pieces } = fs.snapshot.selected;
  if (plan.mode === 'replace' && fs.ids.some((id) => (editor.getBlock(id)?.children.length ?? 0) > 0)) return { ok: false, reason: 'nested' };
  const undo = (yUndoPluginKey.getState(view.state as never) as { undoManager?: Y.UndoManager } | undefined)?.undoManager ?? null;
  const before = undo?.undoStack.length ?? 0;
  const docBefore = view.state.doc;
  let changed = 0;
  try {
    asOneUndoStep(view.state, () => {
      if (plan.mode === 'replace') {
        editor.replaceBlocks(fs.ids, toPartialBlocks(plan.blocks, fs.restore));
        changed = plan.blocks.length;
        return;
      }
      plan.blocks.forEach((b, i) => {
        const piece = pieces[i];
        if (b.kind !== 'text' || piece.kind !== 'text') return;
        const current = editor.getBlock(piece.blockId);
        const props = propsOf(b);
        const sameType = current?.type === b.type && Object.entries(props).every(([k, v]) => current.props[k] === v);
        if (plan.mode === 'type' && sameType) return;
        const update: Record<string, unknown> = { type: b.type, props };
        if (plan.mode === 'update') update.content = inlineContent(b.atoms, fs.restore);
        editor.updateBlock(piece.blockId, update);
        changed++;
      });
    });
  } catch (err) {
    console.error('Asistente: no se pudo cambiar la forma', err);
    while (undo && undo.undoStack.length > before) undo.undo();
    return { ok: false, reason: 'failed' };
  }
  if (changed === 0) return { ok: true, changed: 0 };
  // Comprobación: cambió algo, fue un solo paso de deshacer y, al cambiar solo el tipo, cada bloque tiene el pedido.
  let ok = !view.state.doc.eq(docBefore) && (!undo || undo.undoStack.length === before + 1);
  if (ok && plan.mode !== 'replace') {
    ok = plan.blocks.every((b, i) => {
      const piece = pieces[i];
      if (b.kind !== 'text' || piece.kind !== 'text') return true;
      return editor.getBlock(piece.blockId)?.type === b.type;
    });
  }
  if (!ok) {
    while (undo && undo.undoStack.length > before) undo.undo();
    return { ok: false, reason: 'failed' };
  }
  return { ok: true, changed };
}
