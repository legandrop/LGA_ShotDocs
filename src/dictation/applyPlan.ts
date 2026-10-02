import type { Mark, Node as PMNode, Schema } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { relativePositionToAbsolutePosition, ySyncPluginKey, yUndoPluginKey } from 'y-prosemirror';
import type * as Y from 'yjs';
import type { AssistantEditor } from '../assistant/assistantUi';
import { diffKeys, type Atom, type OldUnit } from '../assistant/markup';
import { BACKGROUND_META } from '../ui/editorMeta';
import { asOneUndoStep } from '../ui/undoGuard';
import { atomsPlain, newUnitsOf, oldKeys, type Change } from './answer';
import { labelKey, shotOfHeading, type PageMap, type Target } from './pageMap';

// Aplicar los cambios tildados de *Dictate to report* (Docs/Doc_Dictado.md, 5.5): primero la guarda de cada uno (lo que
// toca sigue como en la foto) y, si todo está igual, todos en UN paso de deshacer. Si algo cambió mientras el modelo
// pensaba, no se aplica nada.
//
// - El texto de una celda o de un renglón se reemplaza por diferencias (por palabras, como A1): lo que no cambia no se
//   toca, y lo que otro escribe a la vez en otra celda se conserva. En un renglón con rótulo, solo lo de después.
// - Una fila nueva se inserta como UN nodo (una sola inserción en Yjs), nunca rehaciendo la tabla entera: lo que otro
//   escribe sin red en otra fila queda.
// - Tildar es cambiar el atributo `checked`. La sección de un plano y un párrafo nuevo se agregan como bloques nuevos
//   con el editor (títulos, casillas y párrafos: tipos que la versión publicada conoce).

interface Binding {
  doc: Y.Doc;
  type: Y.XmlFragment;
  mapping: unknown;
}

function bindingOf(state: EditorState): Binding | null {
  return ((ySyncPluginKey.getState(state as never) as { binding?: Binding } | undefined)?.binding ?? null) as Binding | null;
}

function undoManagerOf(state: EditorState): Y.UndoManager | null {
  return (yUndoPluginKey.getState(state as never) as { undoManager?: Y.UndoManager } | undefined)?.undoManager ?? null;
}

/** El bloque (`blockContainer`) con ese id: su posición y el nodo. */
export function findBlock(doc: PMNode, id: string): { pos: number; node: PMNode } | null {
  let found: { pos: number; node: PMNode } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === 'blockContainer' && String(node.attrs.id ?? '') === id) {
      found = { pos, node };
      return false;
    }
    return node.type.name === 'doc' || node.type.name === 'blockGroup' || node.type.name === 'blockContainer';
  });
  return found;
}

interface Resolved {
  /** Dónde empieza el contenido del bloque de texto ahora. */
  start: number;
  node: PMNode;
  /** Dónde está el nodo del bloque de texto. */
  nodePos: number;
}

/**
 * Dónde está hoy el lugar de la foto (por su ancla, que sigue al elemento de Yjs), si es el mismo elemento: el bloque
 * con el mismo id o la celda de la misma tabla. `null` si ya no está.
 */
function locate(state: EditorState, t: Target): Resolved | null {
  const binding = bindingOf(state);
  let pos: number | null = t.start;
  if (binding && t.anchor) {
    try {
      pos = relativePositionToAbsolutePosition(binding.doc, binding.type, t.anchor, binding.mapping as never);
    } catch {
      pos = null;
    }
  }
  if (pos === null || pos < 0 || pos > state.doc.content.size) return null;
  const $pos = state.doc.resolve(pos);
  if (!$pos.parent.isTextblock || $pos.parent.type.name !== t.nodeType) return null;
  let owner = '';
  for (let d = $pos.depth - 1; d >= 0; d--) {
    const n = $pos.node(d);
    if (n.type.name === 'blockContainer') {
      owner = String(n.attrs.id ?? '');
      break;
    }
  }
  if (owner !== t.blockId) return null;
  return { start: $pos.start(), node: $pos.parent, nodePos: $pos.before() };
}

/** Lo que tiene que seguir igual para aplicar (5.5, la guarda por operación). */
function unchanged(state: EditorState, t: Target, checked?: boolean): Resolved | null {
  const r = locate(state, t);
  if (!r) return null;
  if (JSON.stringify(r.node.content.toJSON() ?? []) !== t.content) return null;
  if (checked !== undefined && !!r.node.attrs.checked !== checked) return null;
  return r;
}

/** Los nodos de unas letras nuevas, con las marcas (formato y colores) de la unidad que estaba en ese lugar. */
function buildNodes(schema: Schema, atoms: Atom[], carry: OldUnit | null, t: Target): PMNode[] {
  const base: Mark[] = carry && !carry.atom ? [...carry.carry, ...carry.marks.map((m) => schema.marks[m]?.create()).filter((m): m is Mark => !!m)] : [];
  const nodes: PMNode[] = [];
  for (const a of atoms) {
    if (a.t === 'photo') {
      const photo = t.photos.get(a.n);
      if (photo) nodes.push(photo);
      continue;
    }
    if (a.t === 'br') {
      const hb = schema.nodes.hardBreak;
      if (hb) nodes.push(hb.create());
      continue;
    }
    let marks: readonly Mark[] = [];
    for (const m of base) marks = m.addToSet(marks);
    if (a.link !== null) {
      const link = t.links.get(a.link);
      if (link) marks = link.addToSet(marks);
    }
    const prev = nodes[nodes.length - 1];
    if (prev?.isText && prev.marks.length === marks.length && prev.marks.every((m, i) => m.eq(marks[i]))) nodes[nodes.length - 1] = schema.text(prev.text! + a.ch, marks);
    else nodes.push(schema.text(a.ch, marks));
  }
  return nodes;
}

/** Escribe lo nuevo en un lugar por diferencias (del último tramo al primero). */
function writeText(view: EditorView, t: Target, atoms: Atom[], start: number): void {
  const shift = start - t.start;
  const old = t.units.slice(t.labelUnits);
  const textStart = t.labelUnits > 0 ? t.units[t.labelUnits - 1].to : t.start;
  const fresh = newUnitsOf(atoms);
  const hunks = diffKeys(
    oldKeys(t),
    fresh.map((u) => u.key),
  );
  for (const h of [...hunks].reverse()) {
    const from = (h.a0 < h.a1 ? old[h.a0].from : h.a0 > 0 ? old[h.a0 - 1].to : textStart) + shift;
    const to = h.a0 < h.a1 ? old[h.a1 - 1].to + shift : from;
    const carry = h.a0 < h.a1 ? old[h.a0] : h.a0 > 0 ? old[h.a0 - 1] : null;
    const nodes = buildNodes(view.state.schema, fresh.slice(h.b0, h.b1).flatMap((u) => u.atoms), carry, t);
    view.dispatch(view.state.tr.replaceWith(from, to, nodes).setMeta(BACKGROUND_META, true));
  }
}

/** La fila (posición y nodo) donde está la celda, y la tabla. */
function rowOf(state: EditorState, r: Resolved): { rowPos: number; row: PMNode; table: PMNode } | null {
  const $pos = state.doc.resolve(r.start);
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.name === 'tableRow') return { rowPos: $pos.before(d), row: $pos.node(d), table: $pos.node(d - 1) };
  }
  return null;
}

/** Una fila nueva, como UN nodo insertado después de la fila `after` (5.5). */
function insertRow(view: EditorView, change: Change, r: Resolved): boolean {
  const found = rowOf(view.state, r);
  if (!found) return false;
  const { schema } = view.state;
  const cellType = schema.nodes.tableCell;
  const paraType = schema.nodes.tableParagraph;
  if (!cellType || !paraType) return false;
  const values = change.cells ?? [];
  const count = Math.max(found.row.childCount, values.length);
  const cells: PMNode[] = [];
  for (let k = 0; k < count; k++) {
    const ref = k < found.row.childCount ? found.row.child(k) : null;
    const attrs = ref ? { ...ref.attrs, colspan: 1, rowspan: 1 } : null;
    const text = values[k] ?? '';
    cells.push(cellType.create(attrs, paraType.create(null, text ? schema.text(text) : undefined)));
  }
  const row = schema.nodes.tableRow.create(null, cells);
  view.dispatch(view.state.tr.insert(found.rowPos + found.row.nodeSize, row).setMeta(BACKGROUND_META, true));
  return true;
}

/** Los bloques de una sección (los que siguen a un título hasta el siguiente título del mismo nivel o mayor). */
function sectionBlocks(doc: PMNode, headingId: string): { id: string; node: PMNode }[] {
  const out: { id: string; node: PMNode }[] = [];
  const at = findBlock(doc, headingId);
  if (!at) return out;
  const level = Number(at.node.firstChild?.attrs.level) || 1;
  const $pos = doc.resolve(at.pos);
  const group = $pos.parent;
  for (let i = $pos.index() + 1; i < group.childCount; i++) {
    const child = group.child(i);
    const content = child.firstChild;
    if (content?.type.name === 'heading' && (Number(content.attrs.level) || 1) <= level) break;
    out.push({ id: String(child.attrs.id ?? ''), node: child });
  }
  return out;
}

/** El tipo del bloque que se agrega debajo de otro (un renglón más de la misma lista, o un párrafo). */
function siblingBlock(type: string, text: string): Record<string, unknown> {
  if (type === 'bulletListItem' || type === 'numberedListItem') return { type, content: text };
  if (type === 'checkListItem') return { type, props: { checked: false }, content: text };
  return { type: 'paragraph', content: text };
}

/**
 * Agrega un texto en un bloque (`appendText`, *Add to Summary*): si es un título, al final de su sección (en su primer
 * párrafo vacío, o en uno nuevo); si es un bloque vacío, adentro; si no, como un bloque nuevo debajo. `null` (sin
 * id): al final de la página. Devuelve si quedó.
 */
function appendIn(view: EditorView, editor: AssistantEditor, blockId: string | null, text: string): boolean {
  const { doc } = view.state;
  const before = view.state.doc;
  if (!blockId) {
    const last = editor.document[editor.document.length - 1];
    if (!last) return false;
    const lastNode = findBlock(doc, last.id);
    const empty = lastNode?.node.firstChild?.type.name === 'paragraph' && lastNode.node.firstChild.content.size === 0;
    if (empty && lastNode) view.dispatch(view.state.tr.insertText(text, lastNode.pos + 2).setMeta(BACKGROUND_META, true));
    else editor.insertBlocks([{ type: 'paragraph', content: text }], last.id, 'after');
    return !view.state.doc.eq(before);
  }
  const at = findBlock(doc, blockId);
  const content = at?.node.firstChild;
  if (!at || !content) return false;
  if (content.type.name === 'heading') {
    const blocks = sectionBlocks(doc, blockId);
    const emptyPara = blocks.find((b) => b.node.firstChild?.type.name === 'paragraph' && b.node.firstChild.content.size === 0 && b.node.childCount === 1);
    if (emptyPara) {
      const p = findBlock(doc, emptyPara.id)!;
      view.dispatch(view.state.tr.insertText(text, p.pos + 2).setMeta(BACKGROUND_META, true));
    } else {
      // Después del último bloque con algo de la sección (los vacíos del final quedan abajo).
      const filled = [...blocks].reverse().find((b) => (b.node.firstChild?.content.size ?? 0) > 0 || b.node.firstChild?.type.name !== 'paragraph');
      editor.insertBlocks([{ type: 'paragraph', content: text }], filled?.id ?? blockId, 'after');
    }
  } else if (content.isTextblock && content.content.size === 0) {
    view.dispatch(view.state.tr.insertText(text, at.pos + 2).setMeta(BACKGROUND_META, true));
  } else {
    editor.insertBlocks([siblingBlock(content.type.name, text)], blockId, 'after');
  }
  return !view.state.doc.eq(before);
}

/** Si la página ya tiene la sección de ese plano (mirando la página de ahora). */
function hasShot(doc: PMNode, name: string): boolean {
  let found = false;
  doc.descendants((node) => {
    if (found) return false;
    if (node.type.name === 'heading' && (Number(node.attrs.level) || 1) === 3) {
      const s = shotOfHeading(node.textContent);
      if (s?.name && labelKey(s.name) === labelKey(name)) found = true;
      return false;
    }
    return true;
  });
  return found;
}

export type ApplyResult =
  | { ok: true; changed: number; undo: UndoHandle | null }
  /** `changed`: algo de lo que toca cambió mientras pensaba (no se aplicó nada); `readOnly`: sin permiso. */
  | { ok: false; reason: 'changed' | 'readOnly' | 'failed' };

/** Para *Undo* de la hoja: el paso de deshacer que dejó *Apply* (si sigue siendo el último). */
export interface UndoHandle {
  depth: number;
  item: unknown;
}

interface Planned {
  change: Change;
  /** La posición de hoy, para aplicar del último lugar al primero. */
  order: number;
  run: () => boolean;
}

/**
 * Aplica los cambios tildados, si todo lo que tocan sigue igual (la guarda) y se puede editar. Un solo paso de deshacer:
 * un Ctrl/⌘+Z lo saca entero. Si algo falla a mitad, se deshace lo que haya quedado y no se aplica nada.
 */
export function applyChanges(
  view: EditorView,
  editor: AssistantEditor | null,
  map: PageMap,
  changes: Change[],
  canEdit: boolean,
  shotTemplate: { word: string; checks: string[] },
): ApplyResult {
  if (!canEdit || !view.editable) return { ok: false, reason: 'readOnly' };
  if (changes.length === 0) return { ok: true, changed: 0, undo: null };
  const state = view.state;
  const planned: Planned[] = [];
  for (const change of changes) {
    const t = change.target;
    switch (change.op) {
      case 'setCell':
      case 'setText': {
        const r = t && unchanged(state, t);
        if (!t || !r || !change.atoms) return { ok: false, reason: 'changed' };
        const atoms = change.atoms;
        planned.push({
          change,
          order: r.start,
          run: () => {
            const now = unchanged(view.state, t);
            if (!now) return false;
            writeText(view, t, atoms, now.start);
            return true;
          },
        });
        break;
      }
      case 'check':
      case 'uncheck': {
        const r = t && unchanged(state, t, t.checked);
        if (!t || !r) return { ok: false, reason: 'changed' };
        planned.push({
          change,
          order: r.start,
          run: () => {
            const now = unchanged(view.state, t, t.checked);
            if (!now) return false;
            view.dispatch(view.state.tr.setNodeMarkup(now.nodePos, undefined, { ...now.node.attrs, checked: change.op === 'check' }).setMeta(BACKGROUND_META, true));
            return true;
          },
        });
        break;
      }
      case 'appendText': {
        // Que el bloque exista (su texto puede haber cambiado).
        const at = t && findBlock(state.doc, t.blockId);
        if (!t || !at || !editor) return { ok: false, reason: 'changed' };
        const text = atomsPlain(change.atoms ?? []);
        planned.push({ change, order: at.pos + at.node.nodeSize, run: () => appendIn(view, editor, t.blockId, text) });
        break;
      }
      case 'addRow': {
        // La misma tabla y la fila de antes como el mismo elemento (su texto puede haber cambiado).
        const r = t && locate(state, t);
        if (!t || !r || !change.table) return { ok: false, reason: 'changed' };
        planned.push({
          change,
          order: r.start,
          run: () => {
            const now = locate(view.state, t);
            return !!now && insertRow(view, change, now);
          },
        });
        break;
      }
      case 'addShotSection': {
        // Que *VFX shots* siga y que el plano no tenga ya su sección.
        const vfxId = map.vfx?.blockId;
        const last = map.shots.length ? map.shots[map.shots.length - 1].lastBlockId : vfxId;
        const ref = last && findBlock(state.doc, last) ? last : vfxId;
        if (!vfxId || !ref || !findBlock(state.doc, vfxId) || !editor || hasShot(state.doc, change.shot ?? '')) return { ok: false, reason: 'changed' };
        const at = findBlock(state.doc, ref)!;
        const word = shotTemplate.word ? shotTemplate.word[0].toUpperCase() + shotTemplate.word.slice(1) : 'Shot';
        const blocks = [
          { type: 'heading', props: { level: 3 }, content: `${word} ${change.shot}` },
          ...shotTemplate.checks.map((c) => ({ type: 'checkListItem', props: { checked: (change.checks ?? []).includes(c) }, content: c })),
        ];
        planned.push({
          change,
          order: at.pos + at.node.nodeSize,
          run: () => {
            if (!findBlock(view.state.doc, ref)) return false;
            const before = view.state.doc;
            editor.insertBlocks(blocks, ref, 'after');
            return !view.state.doc.eq(before);
          },
        });
        break;
      }
    }
  }
  const undo = undoManagerOf(view.state);
  const before = undo?.undoStack.length ?? 0;
  // Del último lugar al primero: lo que se escribe abajo no corre lo de arriba.
  planned.sort((a, b) => b.order - a.order);
  let ok = true;
  try {
    asOneUndoStep(view.state, () => {
      for (const p of planned) {
        if (!p.run()) {
          ok = false;
          return;
        }
      }
    });
  } catch (err) {
    console.error('Dictado: no se pudo aplicar', err);
    ok = false;
  }
  // Un solo paso de deshacer (si no, algo se partió: se deshace todo).
  if (ok && undo && undo.undoStack.length !== before + 1) ok = false;
  if (!ok) {
    while (undo && undo.undoStack.length > before) undo.undo();
    return { ok: false, reason: 'failed' };
  }
  return { ok: true, changed: planned.length, undo: undo ? { depth: undo.undoStack.length, item: undo.undoStack[undo.undoStack.length - 1] } : null };
}

/** *Undo* de la hoja: deshace lo aplicado si sigue siendo lo último que se hizo en la página. */
export function undoApplied(view: EditorView | null, handle: UndoHandle | null): boolean {
  if (!view || !handle) return false;
  const undo = undoManagerOf(view.state);
  if (!undo || undo.undoStack.length !== handle.depth || undo.undoStack[handle.depth - 1] !== handle.item) return false;
  undo.undo();
  return true;
}

/**
 * *Add to Summary*: el texto como párrafo al final de *Summary* (o al final de la página, si no hay *Summary*), como
 * UNA edición del editor.
 */
export function addToSummary(view: EditorView | null, editor: AssistantEditor | null, summaryId: string | null, text: string, canEdit: boolean): boolean {
  if (!canEdit || !view?.editable || !editor || !text.trim()) return false;
  const id = summaryId && findBlock(view.state.doc, summaryId) ? summaryId : null;
  const undo = undoManagerOf(view.state);
  const before = undo?.undoStack.length ?? 0;
  try {
    let done = false;
    asOneUndoStep(view.state, () => {
      done = appendIn(view, editor, id, text.trim());
    });
    if (!done) while (undo && undo.undoStack.length > before) undo.undo();
    return done;
  } catch (err) {
    console.error('Dictado: no se pudo agregar al resumen', err);
    while (undo && undo.undoStack.length > before) undo.undo();
    return false;
  }
}
