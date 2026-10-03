import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { updateYFragment, yUndoPluginKey, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
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

/** El origen de la restauración sin editor: se guarda y sube como cualquier edición local (docs.ts). */
const RESTORE_IN_DOC = Symbol('restore-in-doc');

/**
 * Pasa el contenido de la página a `node` con el mismo algoritmo que usa el editor para pasar lo que cambia en
 * ProseMirror a Yjs (`updateYFragment` de y-prosemirror, con sus parches): conserva los elementos iguales y, en los
 * distintos, cambia solo atributos y texto donde puede. Así lo que otro escribió sin red o a la vez en un bloque, o un
 * bloque que agregó, sigue estando cuando llega, igual que restaurando por el editor (`restoreInEditor`). Sin
 * relación previa entre los elementos y los nodos (el editor no está), compara por contenido.
 */
function writeNode(doc: Y.Doc, node: PMNode, unchanged: readonly [number, number][] = []): void {
  const fragment = doc.getXmlFragment(CONTENT_FRAGMENT);
  const meta = { mapping: new Map<unknown, unknown>(), isOMark: new Map() };
  // Los bloques de arriba que ya se leen igual que en la versión: se anotan como ya emparejados con su nodo y
  // `updateYFragment` los salta. Sin eso compara cada elemento por sus atributos tal como están guardados, y un
  // bloque que no tiene escritos los de valor por defecto (uno de una versión anterior de la app, o de una
  // importación) los recibe todos, también el que no cambió: unos bytes de más por bloque y, en el historial, un
  // «formato cambiado» que nadie hizo. El editor tampoco toca lo que no cambió (R2 de la barrera).
  const group = fragment.length === 1 ? fragment.get(0) : null;
  const target = node.childCount === 1 ? node.child(0) : null;
  if (group instanceof Y.XmlElement && target) {
    const kids = group.toArray();
    for (const [y, p] of unchanged) if (kids[y] && p < target.childCount) meta.mapping.set(kids[y], target.child(p));
  }
  updateYFragment(doc, fragment, node as never, meta as never);
}

/** Un bloque de arriba como lo arma el editor, leído en una copia suelta (leer borra lo que no se puede armar), o `null`. */
function readBlock(el: Y.XmlElement, schema: Schema, probe: Y.Doc): PMNode | null {
  const fragment = probe.getXmlFragment(CONTENT_FRAGMENT);
  try {
    fragment.insert(0, [el.clone()]);
    const root = yXmlFragmentToProseMirrorRootNode(fragment, schema);
    return fragment.length === 1 && root.childCount === 1 ? root.child(0) : null;
  } catch {
    return null;
  } finally {
    if (fragment.length > 0) fragment.delete(0, fragment.length);
  }
}

/**
 * Los bloques de arriba de la página que ya son iguales a los de `node`, como pares (lugar en la página, lugar en
 * `node`), en orden. Lo que no se puede leer (una fila que el editor no arma) no entra: se reescribe. Se mira una copia,
 * nunca la página.
 */
function unchangedBlocks(doc: Y.Doc, node: PMNode, schema: Schema): [number, number][] {
  const fragment = doc.getXmlFragment(CONTENT_FRAGMENT);
  const group = fragment.length === 1 ? fragment.get(0) : null;
  const target = node.childCount === 1 ? node.child(0) : null;
  if (!(group instanceof Y.XmlElement) || !target || group.nodeName !== target.type.name) return [];
  const probe = new Y.Doc();
  try {
    const read: PMNode[] = [];
    const at: number[] = [];
    group.toArray().forEach((kid, i) => {
      const n = kid instanceof Y.XmlElement ? readBlock(kid, schema, probe) : null;
      if (n) {
        read.push(n);
        at.push(i);
      }
    });
    const want: PMNode[] = [];
    target.forEach((child) => want.push(child));
    return commonBlocks(read, want).map(([i, j]): [number, number] => [at[i], j]);
  } catch {
    return [];
  } finally {
    probe.destroy();
  }
}

/**
 * Restaura la versión **sin el editor**, sobre el documento de la página (la barrera de la página, ErrorBarrier.tsx:
 * el editor tiró un error con lo que hay y no se puede usar). Primero la misma ida y vuelta que `restoreInEditor`
 * (`versionNode`, con el esquema del editor que muestra la versión): lo que el editor no podría armar no se restaura.
 * Después se prueba en una copia en memoria del documento (`writeNode`, lo mismo que hace el editor al escribir) y,
 * solo si la copia queda igual a la versión, se hace lo mismo en el documento de la página, en una transacción: si algo
 * no da, no se escribe ni se sube nada. Es una edición nueva: lo de antes sigue en las filas de `page_updates` y en el
 * historial. El mapa de colapsar, el título y el formato no se tocan. No se deshace desde el aviso (`undoable: false`):
 * el editor que se monta después no tiene este paso en su deshacer; se vuelve atrás restaurando otra versión.
 */
export function restoreInDoc(doc: Y.Doc, version: Y.Doc, schema: Schema | null): RestoreOutcome {
  if (!schema) return { ok: false, reason: 'shape' };
  const { node, complete } = versionNode(version, schema);
  if (!node || !complete) return { ok: false, reason: 'shape' };
  // La prueba, en una copia del documento de la página: nada de esto se guarda. Lo que tiene que quedar (el XML) se
  // anota antes de leerla con y-prosemirror, que borra de su documento lo que no puede armar.
  let expected: string;
  const unchanged = unchangedBlocks(doc, node, schema);
  const scratch = new Y.Doc();
  try {
    Y.applyUpdate(scratch, Y.encodeStateAsUpdate(doc));
    scratch.transact(() => writeNode(scratch, node, unchanged));
    expected = scratch.getXmlFragment(CONTENT_FRAGMENT).toString();
    const read = yXmlFragmentToProseMirrorRootNode(scratch.getXmlFragment(CONTENT_FRAGMENT), schema);
    if (!read.eq(node) || scratch.getXmlFragment(CONTENT_FRAGMENT).toString() !== expected) return { ok: false, reason: 'failed' };
    if (!sameShape(yShape(scratch), pmShape(node))) return { ok: false, reason: 'failed' };
  } catch {
    return { ok: false, reason: 'failed' };
  } finally {
    scratch.destroy();
  }
  const fragment = doc.getXmlFragment(CONTENT_FRAGMENT);
  const undo = new Y.UndoManager(fragment, { trackedOrigins: new Set([RESTORE_IN_DOC]), captureTimeout: 0 });
  try {
    doc.transact(() => writeNode(doc, node, unchanged), RESTORE_IN_DOC);
    // Es el mismo estado que la copia, así que tiene que dar lo mismo; por las dudas, si no, se deshace.
    if (fragment.toString() !== expected) {
      while (undo.undoStack.length > 0) undo.undo();
      return { ok: false, reason: 'failed' };
    }
    const step = undo.undoStack[undo.undoStack.length - 1];
    const trace = step ? traceFromSets(step.insertions, step.deletions) : undefined;
    return { ok: true, undo: () => false, onEdit: () => () => undefined, trace, undoable: false };
  } catch {
    while (undo.undoStack.length > 0) undo.undo();
    return { ok: false, reason: 'failed' };
  } finally {
    undo.destroy();
  }
}
