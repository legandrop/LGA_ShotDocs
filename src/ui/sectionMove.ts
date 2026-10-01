import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model';
import { NodeSelection, Selection, TextSelection, type Transaction } from '@tiptap/pm/state';
import type { BlockMove } from './blockMove';
import { hidesSomething, sectionAt, type Analysis, type Records } from './collapse';

// Mover una sección colapsada como una unidad (P.11, entrega 1b; Docs/Doc_Colapsar.md, "Mover la sección entera"):
// qué se mueve y adónde, con el teclado (Shift+⌘/Ctrl+↑/↓) y al arrastrar. Cálculo puro sobre el documento; quien
// despacha es collapseEditor.ts (con blockMove.ts, que escribe el mover en Yjs sin tocar lo que no se mueve).
//
// - Un título colapsado que se ve, con lo que esconde, es un bloque: lo que se mueve se agranda hasta el final de
//   su sección, y lo que salta es la sección colapsada entera.
// - Si no hay nada colapsado en juego, no se toca: mueve BlockNote, como siempre.

/** Un tramo de bloques hermanos: el grupo (y su profundidad) y los índices del primero y el último. */
interface Run {
  group: PMNode;
  /** El `ResolvedPos` de una posición adentro del grupo (para sus posiciones). */
  $in: ResolvedPos;
  depth: number;
  first: number;
  last: number;
}

/** La posición antes del hijo `index` de un grupo. */
function childPos($in: ResolvedPos, depth: number, index: number): number {
  let pos = $in.start(depth);
  for (let i = 0; i < index; i++) pos += $in.node(depth).child(i).nodeSize;
  return pos;
}

/** Los bloques (hermanos) que abarca una selección: el bloque del cursor, el elegido, o de un bloque a otro. */
export function selectedRun(doc: PMNode, sel: Selection): Run | null {
  const from = sel.from;
  // Una selección que termina justo después de un bloque (de bloques enteros) no abarca el de abajo.
  const to = Math.max(from, sel instanceof TextSelection ? sel.to : sel.to - 1);
  const $from = doc.resolve(from);
  let depth = $from.sharedDepth(to);
  while (depth > 0 && $from.node(depth).type.name !== 'blockGroup') depth--;
  if (depth < 1 || $from.node(depth).type.name !== 'blockGroup') return null;
  const group = $from.node(depth);
  const $to = doc.resolve(to);
  const first = $from.index(depth);
  const last = Math.min($to.index(depth), group.childCount - 1);
  if (first > last || first >= group.childCount) return null;
  return { group, $in: $from, depth, first, last };
}

/** El título colapsado que se ve y esconde algo, en el índice `index` del tramo: hasta dónde llega (sin incluir). */
function sectionEnd(doc: PMNode, run: Run, index: number, analysis: Analysis, merged: Records): number | null {
  const node = run.group.child(index);
  const id = String(node.attrs.id ?? '');
  if (!analysis.collapsed.has(id) || analysis.hidden.has(id)) return null;
  const section = sectionAt(doc, childPos(run.$in, run.depth, index), merged.get(id));
  return section && hidesSomething(section) ? section.end : null;
}

/** El tramo, agrandado hasta el final de la sección de cada título colapsado que tiene adentro. */
function widen(doc: PMNode, run: Run, analysis: Analysis, merged: Records): { last: number; widened: boolean } {
  let last = run.last;
  let widened = false;
  for (let i = run.first; i <= last; i++) {
    const end = sectionEnd(doc, run, i, analysis, merged);
    if (end !== null) {
      widened = true;
      if (end - 1 > last) last = end - 1;
    }
  }
  return { last, widened };
}

export type KeyboardPlan = BlockMove | 'stay' | null;

/**
 * Shift+⌘/Ctrl+↑/↓ con algo colapsado en juego: qué se mueve y adónde. `null`: no hay nada colapsado en juego
 * (mueve BlockNote). `'stay'`: está en juego pero no hay adónde (arriba o abajo de todo): no se hace nada.
 * Adónde, como BlockNote, salvo lo colapsado: si lo de al lado tiene hijos, entra en ellos; al principio o al
 * final de un grupo, sale al de afuera.
 */
export function planKeyboardMove(doc: PMNode, sel: Selection, analysis: Analysis, merged: Records, dir: 'up' | 'down'): KeyboardPlan {
  if (analysis.collapsed.size === 0) return null;
  const run = selectedRun(doc, sel);
  if (!run) return null;
  for (let i = run.first; i <= run.last; i++) if (analysis.hidden.has(String(run.group.child(i).attrs.id ?? ''))) return null;
  const { last, widened } = widen(doc, run, analysis, merged);
  const from = childPos(run.$in, run.depth, run.first);
  const to = childPos(run.$in, run.depth, last + 1);
  const nested = run.depth > 1;
  if (dir === 'down') {
    const next = last + 1;
    if (next >= run.group.childCount) {
      if (!widened) return null;
      return nested ? { from, to, insertAt: run.$in.after(run.depth - 1) } : 'stay';
    }
    const end = sectionEnd(doc, run, next, analysis, merged);
    if (end !== null) return { from, to, insertAt: childPos(run.$in, run.depth, end) };
    if (!widened) return null;
    const node = run.group.child(next);
    const nextPos = childPos(run.$in, run.depth, next);
    // Con hijos: entra adelante del primero (como BlockNote).
    if (node.childCount > 1 && node.lastChild?.type.name === 'blockGroup') return { from, to, insertAt: nextPos + 1 + node.firstChild!.nodeSize + 1 };
    return { from, to, insertAt: nextPos + node.nodeSize };
  }
  const prev = run.first - 1;
  if (prev < 0) {
    if (!widened) return null;
    return nested ? { from, to, insertAt: run.$in.before(run.depth - 1) } : 'stay';
  }
  const prevNode = run.group.child(prev);
  const prevId = String(prevNode.attrs.id ?? '');
  const hider = analysis.hidden.get(prevId);
  if (hider) {
    // Lo de arriba está escondido: salta la sección colapsada entera (su título es un hermano de este grupo).
    for (let i = prev; i >= 0; i--) {
      if (String(run.group.child(i).attrs.id ?? '') === hider) return { from, to, insertAt: childPos(run.$in, run.depth, i) };
    }
    return 'stay';
  }
  const prevPos = childPos(run.$in, run.depth, prev);
  // Un título colapsado que esconde sus hijos: se salta entero.
  if (sectionEnd(doc, run, prev, analysis, merged) !== null) return { from, to, insertAt: prevPos };
  if (!widened) return null;
  // Con hijos: entra después del último (como BlockNote).
  if (prevNode.childCount > 1 && prevNode.lastChild?.type.name === 'blockGroup') return { from, to, insertAt: prevPos + prevNode.nodeSize - 2 };
  return { from, to, insertAt: prevPos };
}

/**
 * El tramo que se arrastra (la selección que dejó BlockNote al empezar: el bloque, o varios), agrandado hasta el
 * final de cada sección colapsada; `null` si no hay ninguna (arrastra BlockNote, como siempre).
 */
export function planSectionDrag(doc: PMNode, sel: Selection, analysis: Analysis, merged: Records): { from: number; to: number } | null {
  if (analysis.collapsed.size === 0) return null;
  const run = sel instanceof NodeSelection && sel.node.type.name === 'blockContainer' ? selectedRun(doc, TextSelection.create(doc, sel.from + 2)) : selectedRun(doc, sel);
  if (!run) return null;
  const { last, widened } = widen(doc, run, analysis, merged);
  if (!widened) return null;
  return { from: childPos(run.$in, run.depth, run.first), to: childPos(run.$in, run.depth, last + 1) };
}

/**
 * La selección de antes, en el documento de después: lo de adentro de lo que se movió, corrido con él; lo de
 * afuera, como lo corre la transacción.
 */
export function movedSelection(sel: Selection, move: BlockMove, tr: Transaction, insertedAt: number): Selection {
  const doc = tr.doc;
  const place = (pos: number) => (pos >= move.from && pos <= move.to ? pos - move.from + insertedAt : tr.mapping.map(pos));
  try {
    if (sel instanceof NodeSelection) return NodeSelection.create(doc, place(sel.from));
    if (sel instanceof TextSelection) return TextSelection.create(doc, place(sel.anchor), place(sel.head));
    // La sección elegida (para copiar); otra selección de varios bloques (la de BlockNote no se puede armar desde
    // JSON: se llama a sí misma sin fin) queda como un cursor al principio de lo movido.
    const json = sel.toJSON() as { type: string; anchor: number; head: number };
    if (json.type === 'sd-section') return Selection.fromJSON(doc, { ...json, anchor: place(sel.anchor), head: place(sel.head) });
  } catch {
    // Abajo.
  }
  try {
    return Selection.near(doc.resolve(Math.min(insertedAt + 2, doc.content.size)));
  } catch {
    return Selection.atStart(doc);
  }
}
