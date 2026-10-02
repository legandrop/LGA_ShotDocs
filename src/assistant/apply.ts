import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, ySyncPluginKey, yUndoPluginKey } from 'y-prosemirror';
import type * as Y from 'yjs';
import { BACKGROUND_META } from '../ui/editorMeta';
import { asOneUndoStep } from '../ui/undoGuard';
import { buildNodes, collectBetween, collectSelection, diffKeys, plainKey, type NewUnit, type Parsed, type Selected, type TextPiece } from './markup';

// Aplicar una sugerencia del asistente (Docs/Doc_Asistente.md, 6.1 pasos 2 y 6, y 6.5): la foto de lo elegido al
// pedir, la guarda de "cambió mientras pensaba" al aplicar y el reemplazo como UNA edición del editor que se deshace
// con Ctrl/⌘+Z en un paso. Cada tramo que cambió va en su propia transacción (como restaurar una versión,
// historyRestore.ts): y-prosemirror pasa cada una a Yjs comparando con lo que hay, así lo que no cambió (las palabras
// iguales, las fotos en línea que siguen en su lugar) no se borra ni se vuelve a crear, y lo que otro escribe a la vez
// en otra parte del bloque se conserva.

interface Binding {
  doc: Y.Doc;
  type: Y.XmlFragment;
  mapping: unknown;
}

function bindingOf(state: EditorState): Binding | null {
  return ((ySyncPluginKey.getState(state as never) as { binding?: Binding } | undefined)?.binding ?? null) as Binding | null;
}

/** La foto de lo elegido al pedir: qué había, dónde (con anclas que siguen al texto) y qué se mandó. */
export interface Snapshot {
  selected: Selected;
  /** El contenido de lo elegido tal cual (JSON del pedazo del documento), para compararlo al aplicar. */
  content: string;
  anchors: { from: Y.RelativePosition; to: Y.RelativePosition } | null;
}

const sliceJson = (doc: PMNode, from: number, to: number) => JSON.stringify(doc.slice(from, to).toJSON());

/** Toma lo elegido en el editor. `'empty'` o `'tooLong'` si no se puede pedir. */
export function takeSnapshot(state: EditorState): Snapshot | 'empty' | 'tooLong' {
  return snapshotOf(state, collectSelection(state));
}

/**
 * *Try again* después de "cambió mientras pensaba": una foto nueva del mismo lugar (lo que hay hoy entre las anclas),
 * no de donde quedó el cursor. `'empty'` si ya no está.
 */
export function retakeSnapshot(state: EditorState, previous: Snapshot): Snapshot | 'empty' | 'tooLong' {
  const range = currentRange(state, previous);
  if (!range) return 'empty';
  return snapshotOf(state, collectBetween(state.doc, range.from, range.to));
}

/** La foto de unos pedazos ya juntados (lo elegido, la página entera o los bloques de *Format as…*). */
export function snapshotOf(state: EditorState, selected: Selected | 'empty' | 'tooLong'): Snapshot | 'empty' | 'tooLong' {
  if (typeof selected === 'string') return selected;
  const binding = bindingOf(state);
  let anchors: Snapshot['anchors'] = null;
  if (binding) {
    try {
      anchors = {
        from: absolutePositionToRelativePosition(selected.from, binding.type, binding.mapping as never),
        to: absolutePositionToRelativePosition(selected.to, binding.type, binding.mapping as never),
      };
    } catch {
      anchors = null;
    }
  }
  return { selected, content: sliceJson(state.doc, selected.from, selected.to), anchors };
}

/** Dónde está ahora lo elegido (por las anclas), o `null` si ya no está. Sin Yjs (pruebas), donde estaba. */
function currentRange(state: EditorState, snapshot: Snapshot): { from: number; to: number } | null {
  const binding = bindingOf(state);
  if (!snapshot.anchors || !binding) return { from: snapshot.selected.from, to: snapshot.selected.to };
  try {
    const from = relativePositionToAbsolutePosition(binding.doc, binding.type, snapshot.anchors.from, binding.mapping as never);
    const to = relativePositionToAbsolutePosition(binding.doc, binding.type, snapshot.anchors.to, binding.mapping as never);
    if (from === null || to === null || to < from || to > state.doc.content.size) return null;
    return { from, to };
  } catch {
    return null;
  }
}

/**
 * La guarda (6.1, paso 6): lo que hay hoy entre las anclas tiene que ser exactamente la foto. Devuelve cuánto se corrió
 * lo elegido (lo de antes cambió de largo) o `null` si cambió algo adentro (o ya no está).
 */
export function unchangedShift(state: EditorState, snapshot: Snapshot): number | null {
  const range = currentRange(state, snapshot);
  if (!range) return null;
  if (range.to - range.from !== snapshot.selected.to - snapshot.selected.from) return null;
  if (sliceJson(state.doc, range.from, range.to) !== snapshot.content) return null;
  return range.from - snapshot.selected.from;
}

export type ApplyOutcome =
  | { ok: true; changed: number }
  /** `changed`: lo elegido cambió mientras el modelo pensaba; `readOnly`: sin permiso de editar; `failed`: no quedó. */
  | { ok: false; reason: 'changed' | 'readOnly' | 'failed' };

interface Step {
  from: number;
  to: number;
  nodes: PMNode[];
}

/** Los reemplazos de un pedazo, del último al primero (así las posiciones de los anteriores no se corren). */
function pieceSteps(state: EditorState, piece: TextPiece, units: NewUnit[], selected: Selected, shift: number): Step[] {
  const a = piece.units;
  const hunks = diffKeys(
    a.map((u) => u.key),
    units.map((u) => u.key),
  );
  const steps: Step[] = [];
  for (const h of hunks) {
    const from = (h.a0 < h.a1 ? a[h.a0].from : h.a0 > 0 ? a[h.a0 - 1].to : piece.from) + shift;
    const to = (h.a0 < h.a1 ? a[h.a1 - 1].to : from - shift) + shift;
    // Lo que se escribe hereda los colores de lo que había en ese lugar (o de lo de antes, si solo se agrega).
    const carryFrom = h.a0 < h.a1 ? a[h.a0] : h.a0 > 0 ? a[h.a0 - 1] : a[0];
    const carry = carryFrom && !carryFrom.atom ? carryFrom.carry : [];
    steps.push({ from, to, nodes: buildNodes(state.schema, units.slice(h.b0, h.b1), selected, carry) });
  }
  return steps.reverse();
}

/** Las claves de lo que hay entre dos posiciones (sin los números de las marcas). */
function keysBetween(doc: PMNode, from: number, to: number): string[] {
  const sel = collectBetween(doc, from, to);
  if (typeof sel === 'string') return [];
  return sel.pieces.flatMap((p) => (p.kind === 'text' ? p.units.map((u) => plainKey(u.key)) : []));
}

/**
 * Aplica lo nuevo en el editor, si lo elegido sigue igual y se puede editar. Una sola edición: un Ctrl/⌘+Z la saca
 * entera. Si al final la página no quedó como se pidió, se deshace lo que haya quedado y no se aplica nada.
 */
export function applySuggestion(view: EditorView, snapshot: Snapshot, parsed: Parsed, canEdit: boolean): ApplyOutcome {
  if (!canEdit || !view.editable) return { ok: false, reason: 'readOnly' };
  const shift = unchangedShift(view.state, snapshot);
  if (shift === null) return { ok: false, reason: 'changed' };
  const { selected } = snapshot;
  const plan: { piece: TextPiece; units: NewUnit[]; steps: Step[]; delta: number }[] = [];
  for (const [i, piece] of selected.pieces.entries()) {
    const units = parsed.blocks[i];
    if (piece.kind !== 'text' || !units) continue;
    const steps = pieceSteps(view.state, piece, units, selected, shift);
    const delta = steps.reduce((sum, s) => sum + s.nodes.reduce((n, node) => n + node.nodeSize, 0) - (s.to - s.from), 0);
    plan.push({ piece, units, steps, delta });
  }
  const changed = plan.reduce((n, p) => n + p.steps.length, 0);
  if (changed === 0) return { ok: true, changed: 0 };
  const undo = (yUndoPluginKey.getState(view.state as never) as { undoManager?: Y.UndoManager } | undefined)?.undoManager ?? null;
  const before = undo?.undoStack.length ?? 0;
  try {
    asOneUndoStep(view.state, () => {
      // Del último pedazo al primero, y adentro de cada uno del último tramo al primero.
      for (const p of [...plan].reverse()) {
        for (const step of p.steps) {
          const tr = view.state.tr.replaceWith(step.from, step.to, step.nodes).setMeta(BACKGROUND_META, true);
          view.dispatch(tr);
        }
      }
    });
  } catch {
    while (undo && undo.undoStack.length > before) undo.undo();
    return { ok: false, reason: 'failed' };
  }
  // Comprobación: cada pedazo dice lo pedido, y fue un solo paso de deshacer.
  let moved = 0;
  let ok = !undo || undo.undoStack.length === before + 1;
  for (const p of plan) {
    if (!ok) break;
    const from = p.piece.from + shift + moved;
    const to = p.piece.to + shift + moved + p.delta;
    const want = p.units.map((u) => plainKey(u.key));
    const got = keysBetween(view.state.doc, from, to);
    // Un pedazo que quedó vacío no se lee (no hay texto): vale si lo pedido tampoco tenía texto.
    if (got.join('\u0002') !== want.join('\u0002') && !(got.length === 0 && want.every((k) => /^\s/.test(k) || k.startsWith('\u0001')))) ok = false;
    moved += p.delta;
  }
  if (!ok) {
    while (undo && undo.undoStack.length > before) undo.undo();
    return { ok: false, reason: 'failed' };
  }
  return { ok: true, changed };
}

/**
 * Lo nuevo aplicado sobre una copia del documento, sin editor ni Yjs (la transacción no se despacha): la subpágina
 * traducida de *Translate page* (entrega A2). `null` si lo elegido cambió desde que se pidió (la misma guarda que aplicar).
 */
export function appliedDoc(state: EditorState, snapshot: Snapshot, parsed: Parsed): PMNode | null {
  const shift = unchangedShift(state, snapshot);
  if (shift === null) return null;
  const tr = state.tr;
  const { selected } = snapshot;
  for (const [i, piece] of [...selected.pieces.entries()].reverse()) {
    const units = parsed.blocks[i];
    if (piece.kind !== 'text' || !units) continue;
    for (const step of pieceSteps(state, piece, units, selected, shift)) tr.replaceWith(step.from, step.to, step.nodes);
  }
  return tr.doc;
}
