import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { yUndoPluginKey, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import * as Y from 'yjs';
import { sameShape, traceFromSets, yShape, type ContentShape } from '../sync/history';
import { CONTENT_FRAGMENT } from '../sync/structure';
import type { RestoreOutcome } from './historyUi';
import { asOneUndoStep } from './undoGuard';
import { BACKGROUND_META } from './editorMeta';
import { subscribeStepPopped } from './undoTimeline';

// Restaurar una versión del historial (P.18, Docs/Doc_Historial.md, sección 6): una edición nueva POR EL EDITOR, la
// misma vía que escribir. Una sola transacción de ProseMirror reemplaza el contenido de la página; y-prosemirror (con
// sus parches) la pasa a Yjs comparando con lo que hay, así lo que no cambió queda igual (los ids de los bloques, y
// con ellos los comentarios), se deshace con Ctrl/⌘+Z en un paso y sube como cualquier edición. Nunca borra historia:
// lo de antes sigue en las filas de `page_updates`. El mapa de colapsar, el título y el formato no se tocan.

/** La forma del nodo de ProseMirror (la misma cuenta que `yShape`: bloques, texto y nodos). */
export function pmShape(doc: PMNode): ContentShape {
  const ids: string[] = [];
  let text = 0;
  let nodes = 0;
  doc.descendants((node) => {
    if (node.isText) {
      text += node.text?.length ?? 0;
      return false;
    }
    nodes++;
    if (node.type.name === 'blockContainer') ids.push(String(node.attrs.id ?? ''));
    return true;
  });
  return { ids, text, nodes };
}

/**
 * Le da un id nuevo a cada bloque cuyo id ya apareció antes (en el orden del documento de Yjs): dos dispositivos que
 * rehacen el mismo bloque a la vez (cambiar el tipo, sangrar) dejan dos con el mismo id. El editor no acepta ids
 * repetidos (los cambia al recibir la edición), así que una versión así, restaurada tal cual, no quedaba igual a la
 * versión y la restauración se deshacía sola. El primero conserva el suyo (los comentarios siguen anclados). Se llama
 * solo sobre una copia en memoria. Devuelve cuántos cambió.
 */
export function uniqueBlockIds(doc: Y.Doc): number {
  const seen = new Set<string>();
  const repeated: Y.XmlElement[] = [];
  const walk = (t: Y.XmlFragment | Y.XmlElement) => {
    for (const child of t.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue;
      if (child.nodeName === 'blockContainer') {
        const id = child.getAttribute('id');
        if (typeof id === 'string' && id) {
          if (seen.has(id)) repeated.push(child);
          else seen.add(id);
        }
      }
      walk(child);
    }
  };
  walk(doc.getXmlFragment(CONTENT_FRAGMENT));
  if (repeated.length === 0) return 0;
  doc.transact(() => {
    for (const el of repeated) {
      let id = crypto.randomUUID();
      while (seen.has(id)) id = crypto.randomUUID();
      seen.add(id);
      el.setAttribute('id', id);
    }
  });
  return repeated.length;
}

/**
 * El nodo de ProseMirror de una versión, y si pasó la ida y vuelta. y-prosemirror, cuando no puede armar un bloque, lo
 * borra de su documento y sigue sin avisar: por eso se arma sobre una copia y se compara la forma (ids, texto, nodos)
 * con la de la versión en Yjs. Si no coincide, algo se perdería: no se muestra como completa ni se restaura. En la copia,
 * los ids repetidos ya cambiados (`uniqueBlockIds`).
 */
export function versionNode(version: Y.Doc, schema: Schema): { node: PMNode | null; complete: boolean } {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(version));
  uniqueBlockIds(copy);
  const expected = yShape(copy);
  try {
    const node = yXmlFragmentToProseMirrorRootNode(copy.getXmlFragment(CONTENT_FRAGMENT), schema);
    return { node, complete: sameShape(expected, pmShape(node)) };
  } catch {
    return { node: null, complete: false };
  } finally {
    copy.destroy();
  }
}

/** Los pares (i, j) de bloques iguales que se conservan, en orden (la subsecuencia común más larga). */
function commonBlocks(a: readonly PMNode[], b: readonly PMNode[]): [number, number][] {
  // Lo igual al principio y al final, sin cuenta; la tabla, solo para el medio.
  let start = 0;
  while (start < a.length && start < b.length && a[start].eq(b[start])) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1].eq(b[endB - 1])) {
    endA--;
    endB--;
  }
  const pairs: [number, number][] = [];
  for (let i = 0; i < start; i++) pairs.push([i, i]);
  const n = endA - start;
  const m = endB - start;
  if (n > 0 && m > 0 && n * m <= 4_000_000) {
    const len: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        len[i][j] = a[start + i].eq(b[start + j]) ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[start + i].eq(b[start + j])) {
        pairs.push([start + i, start + j]);
        i++;
        j++;
      } else if (len[i + 1][j] >= len[i][j + 1]) i++;
      else j++;
    }
  }
  for (let k = 0; k < a.length - endA; k++) pairs.push([endA + k, endB + k]);
  return pairs;
}

/** Un tramo de la página que se reemplaza: los bloques `[from, to)` por `blocks`. */
export interface RestoreStep {
  from: number;
  to: number;
  blocks: PMNode[];
}

/**
 * Los reemplazos que dejan la página como la versión cambiando solo los bloques distintos, del último al primero (así
 * las posiciones de los anteriores no se corren). Cada uno va en su propia transacción: y-prosemirror, al pasar un
 * cambio a Yjs, conserva el elemento de cada bloque solo al principio y al final de lo que cambió; con un único
 * reemplazo de todo, rehacía los bloques iguales que quedaban en el medio (y lo que otra persona escribiera a la vez
 * en ellos se perdía). `null`: la página no tiene la forma de siempre (un grupo de bloques): se reemplaza todo.
 */
export function restoreSteps(current: PMNode, target: PMNode): RestoreStep[] | null {
  const curGroup = current.childCount === 1 ? current.firstChild : null;
  const tgtGroup = target.childCount === 1 ? target.firstChild : null;
  if (!curGroup || !tgtGroup || curGroup.type !== tgtGroup.type) return null;
  const a: PMNode[] = [];
  const b: PMNode[] = [];
  curGroup.forEach((n) => a.push(n));
  tgtGroup.forEach((n) => b.push(n));
  // Dónde empieza cada bloque de la página (adentro del grupo, que empieza en 1).
  const starts: number[] = [];
  let pos = 1;
  for (const n of a) {
    starts.push(pos);
    pos += n.nodeSize;
  }
  starts.push(pos);
  const steps: RestoreStep[] = [];
  let prevA = 0;
  let prevB = 0;
  for (const [i, j] of [...commonBlocks(a, b), [a.length, b.length] as [number, number]]) {
    if (i > prevA || j > prevB) steps.push({ from: starts[prevA], to: starts[i], blocks: b.slice(prevB, j) });
    prevA = i + 1;
    prevB = j + 1;
  }
  return steps.reverse();
}

interface UndoState {
  undoManager?: Y.UndoManager;
}

/** El deshacer de y-prosemirror del editor (el mismo de Ctrl/⌘+Z). */
export function editorUndo(view: EditorView): Y.UndoManager | null {
  return (yUndoPluginKey.getState(view.state as never) as UndoState | undefined)?.undoManager ?? null;
}

/** Restaura la versión en el editor (editable) de la página. `onEdit` avisa la próxima edición (para el **Undo**). */
export function restoreInEditor(
  view: EditorView,
  version: Y.Doc,
  onEdit: (fn: () => void) => () => void = () => () => undefined,
): RestoreOutcome {
  if (!view.editable) return { ok: false, reason: 'notEditable' };
  const { node, complete } = versionNode(version, view.state.schema);
  if (!node || !complete) return { ok: false, reason: 'shape' };
  const undo = editorUndo(view);
  try {
    // Un paso propio de deshacer: ni se junta con lo escrito antes ni con lo que se escriba después.
    const before = undo?.undoStack.length ?? 0;
    const steps = restoreSteps(view.state.doc, node);
    if (steps && steps.length === 0) return { ok: true, undo: () => false, onEdit };
    asOneUndoStep(view.state, () => {
      if (!steps) view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, node.content).setMeta(BACKGROUND_META, true));
      else for (const step of steps) view.dispatch(view.state.tr.replaceWith(step.from, step.to, step.blocks).setMeta(BACKGROUND_META, true));
    });
    // Al final la página tiene que ser la versión, con un solo paso de deshacer. Si no (un plugin descartó parte, por
    // ejemplo), se deshace lo que haya quedado y no se avisa "restaurada".
    if (!view.state.doc.eq(node) || (undo && undo.undoStack.length !== before + 1)) {
      while (undo && undo.undoStack.length > before) undo.undo();
      return { ok: false, reason: 'failed' };
    }
  } catch {
    return { ok: false, reason: 'failed' };
  }
  const size = undo?.undoStack.length ?? 0;
  // La huella de la restauración (su paso de deshacer): con ella se reconoce la fila que la sube (*Restored from…*).
  const step = undo?.undoStack[size - 1];
  const trace = step ? traceFromSets(step.insertions, step.deletions) : undefined;
  return { ok: true, undo: () => undoRestore(view, size), onEdit, onUndone: (fn) => onStepUndone(undo, step, fn), trace };
}

interface PoppedEvent {
  stackItem: unknown;
  type: 'undo' | 'redo';
}

/**
 * Avisa (una vez) cuando se deshace ese paso: el **Undo** del aviso o Ctrl/⌘+Z, que es el mismo deshacer de Yjs. Así
 * la marca *Restored from…* se deja de lado también con el teclado. Devuelve cómo dejar de mirar.
 */
function onStepUndone(undo: Y.UndoManager | null, step: unknown, fn: () => void): () => void {
  if (!undo || !step) return () => undefined;
  let done = false;
  const handler = (e: PoppedEvent) => {
    if (done || e.type !== 'undo' || e.stackItem !== step) return;
    done = true;
    off();
    fn();
  };
  // El paso puede deshacerse con otro editor de la misma página (se fue y volvió: la línea de tiempo le pasó la pila,
  // P.26): se escucha también a la línea de tiempo, que avisa lo deshecho por cualquier editor de página.
  const offTimeline = subscribeStepPopped((stackItem, type) => handler({ stackItem, type }));
  const off = () => {
    undo.off('stack-item-popped', handler as never);
    offTimeline();
  };
  undo.on('stack-item-popped', handler as never);
  return off;
}

/** Deshace la restauración (el aviso con **Undo**): solo si lo último del deshacer sigue siendo ella. */
export function undoRestore(view: EditorView, stackSize: number): boolean {
  const undo = editorUndo(view);
  if (!undo || undo.undoStack.length !== stackSize) return false;
  undo.undo();
  return true;
}
