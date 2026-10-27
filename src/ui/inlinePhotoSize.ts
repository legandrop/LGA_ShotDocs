import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, TextSelection, type EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { arrangeRows } from './imageRows';
import { PHOTO, photoLine } from './inlinePhoto';
import { thumbSize } from './sharpMarks';
import { asOneUndoStep } from './undoGuard';

// El tamaño de las fotos en línea elegidas y "Arrange in rows" sobre ellas (Docs/Doc_Fotos_En_Linea.md, entrega 2).
// `w` es la parte del renglón, como `rowWidth` de las fotos-bloque (imageRows.ts): los mismos tamaños rápidos y el
// mismo `arrangeRows`. Cada cambio es un atributo del nodo (no lo recrea: editar a la vez no pierde nada, medido en
// la entrega 1) y todo va en un solo cambio (un solo deshacer).

/** Las fotos en línea de la selección: la elegida, o las que abarca una selección de texto (posiciones, en orden). */
export function selectedPhotos(state: EditorState): number[] {
  const sel = state.selection;
  if (sel instanceof NodeSelection) return sel.node.type.name === PHOTO ? [sel.from] : [];
  if (!(sel instanceof TextSelection) || sel.empty) return [];
  const out: number[] = [];
  state.doc.nodesBetween(sel.from, sel.to, (node, pos) => {
    if (node.type.name === PHOTO && pos >= sel.from && pos + node.nodeSize <= sel.to) out.push(pos);
    return true;
  });
  return out;
}

/** La selección es solo de fotos (sin letras): la que BlockNote no acompaña con su barra. */
export function onlyPhotosSelected(state: EditorState): boolean {
  const sel = state.selection;
  if (sel instanceof NodeSelection) return sel.node.type.name === PHOTO;
  if (!(sel instanceof TextSelection) || sel.empty) return false;
  return selectedPhotos(state).length > 0 && state.doc.textBetween(sel.from, sel.to, '', '').length === 0;
}

/** Las fotos en línea seguidas (sin nada en el medio) del texto de un bloque que incluye a `pos`, en orden. */
export function runAround(doc: PMNode, pos: number): number[] {
  const $pos = doc.resolve(pos);
  const parent = $pos.parent;
  const start = $pos.start();
  const kids: { pos: number; photo: boolean }[] = [];
  parent.forEach((child, offset) => kids.push({ pos: start + offset, photo: child.type.name === PHOTO }));
  const at = kids.findIndex((k) => k.pos === pos);
  if (at < 0 || !kids[at].photo) return [];
  let from = at;
  let to = at;
  while (from > 0 && kids[from - 1].photo) from--;
  while (to < kids.length - 1 && kids[to + 1].photo) to++;
  return kids.slice(from, to + 1).map((k) => k.pos);
}

/** Las fotos están seguidas en el mismo renglón, sin letras en el medio (lo que pide acomodarlas en filas). */
export function areAdjacent(doc: PMNode, positions: readonly number[]): boolean {
  if (positions.length < 2) return positions.length === 1;
  const run = runAround(doc, positions[0]);
  const first = run.indexOf(positions[0]);
  return first >= 0 && positions.every((p, i) => run[first + i] === p);
}

/** Un relleno entre dos fotos de renglones contiguos: un salto de renglón (Shift+Enter) o un texto de solo espacios. */
function isFiller(node: PMNode): boolean {
  return node.type.name === 'hardBreak' || (node.isText && !node.text!.trim());
}

/** Todo el contenido de `parent` entre los desplazamientos `from` y `to` es relleno. */
function fillerBetween(parent: PMNode, from: number, to: number): boolean {
  let ok = true;
  parent.forEach((child, offset) => {
    if (offset + child.nodeSize > from && offset < to && !isFiller(child)) ok = false;
  });
  return ok;
}

/** Dónde está la foto `pos`: su párrafo, el bloque (`blockContainer`) y el grupo de bloques que lo tiene. */
function photoPlace(doc: PMNode, pos: number) {
  const $pos = doc.resolve(pos);
  if ($pos.depth < 2 || $pos.parent.type.name !== 'paragraph') return null;
  const block = $pos.node($pos.depth - 1);
  if (block.type.name !== 'blockContainer' || block.childCount !== 1) return null;
  return { $pos, offset: $pos.parentOffset, groupStart: $pos.start($pos.depth - 2), index: $pos.index($pos.depth - 2) };
}

/**
 * Las fotos elegidas están en renglones contiguos (Lega, 2026-10-27, D799): entre una y la siguiente solo hay saltos de
 * renglón, espacios o el borde entre dos párrafos seguidos (también párrafos vacíos en el medio). "Arrange in rows"
 * las junta en un solo renglón. Solo párrafos hermanos sin bloques anidados, y fuera de una tabla: lo demás no se junta.
 */
export function joinable(doc: PMNode, positions: readonly number[]): boolean {
  if (positions.length < 2) return false;
  if (!positions.every((p) => doc.nodeAt(p)?.type.name === PHOTO)) return false;
  for (let i = 1; i < positions.length; i++) {
    const a = photoPlace(doc, positions[i - 1]);
    const b = photoPlace(doc, positions[i]);
    if (!a || !b || a.groupStart !== b.groupStart || positions[i] <= positions[i - 1]) return false;
    if (a.index === b.index) {
      if (!fillerBetween(a.$pos.parent, a.offset + 1, b.offset)) return false;
      continue;
    }
    if (!fillerBetween(a.$pos.parent, a.offset + 1, a.$pos.parent.content.size)) return false;
    if (!fillerBetween(b.$pos.parent, 0, b.offset)) return false;
    const group = a.$pos.node(a.$pos.depth - 2);
    for (let k = a.index + 1; k < b.index; k++) {
      const block = group.child(k);
      const text = block.firstChild;
      if (block.childCount !== 1 || text?.type.name !== 'paragraph' || !fillerBetween(text, 0, text.content.size)) return false;
      // Un salto de hoja, una pregunta, un Script o una tarjeta vacíos en el medio no son renglones vacíos: no se cruzan.
      if (['pageBreak', 'question', 'script', 'driveCard'].some((k) => text.attrs[k] === true)) return false;
    }
  }
  return true;
}

/**
 * Lo que acomoda "Arrange in rows": con una foto elegida, las fotos seguidas de su renglón; con varias, esas (si
 * están seguidas, o en renglones contiguos: `join`, D799). `null` si no hay qué acomodar (una sola). `adjacent`
 * falso: hay letras u otras cosas en el medio y no se puede.
 */
export function arrangeTarget(state: EditorState): { positions: number[]; adjacent: boolean; join: boolean } | null {
  const chosen = selectedPhotos(state);
  if (chosen.length === 0) return null;
  if (chosen.length === 1) {
    const run = runAround(state.doc, chosen[0]);
    return run.length > 1 ? { positions: run, adjacent: true, join: false } : null;
  }
  if (areAdjacent(state.doc, chosen)) return { positions: chosen, adjacent: true, join: false };
  const join = joinable(state.doc, chosen);
  return { positions: chosen, adjacent: join, join };
}

/** Pone el mismo ancho a todas esas fotos, en un solo cambio. */
export function setPhotoWidths(view: EditorView, positions: readonly number[], w: number): void {
  const tr = view.state.tr;
  for (const pos of positions) {
    if (tr.doc.nodeAt(pos)?.type.name === PHOTO) tr.setNodeAttribute(pos, 'w', w);
  }
  if (tr.docChanged) view.dispatch(tr);
}

/** Lo que cambia "Arrange in rows" en una foto: su ancho y si empieza fila. */
export interface Arranged {
  w?: number;
  rowStart: true | null;
}

/**
 * "Arrange in rows" de las fotos `positions` (seguidas, parte de la tanda `run` de su renglón): SOLO las elegidas
 * (pedido de Lega; auditoría de la entrega 2). Los anchos salen de `arrangeRows` con sus proporciones. Para que
 * queden en filas propias dentro de una tanda más larga (las filas las arma `groupRows` de a una, mientras entren),
 * la primera elegida empieza fila (`rowStart`), y también la foto que sigue a la última, si la hay (solo esa marca:
 * su ancho no cambia). Las de antes quedan como estaban (si su fila no llena el renglón, el margen de la fila lo
 * completa). La última fila no se estira: con la altura que le da `arrangeRows` (como mucho la de la anterior, o
 * MAX), como en la foto-bloque.
 */
export function arrangeWidths(
  doc: PMNode,
  positions: readonly number[],
  aspectOf: (pos: number) => number,
  gapRatio: number,
): Map<number, Arranged> {
  const run = runAround(doc, positions[0]);
  // Una proporción desconocida cuenta como 3:2, como en `arrangeRows`.
  const aspect = (p: number) => {
    const a = aspectOf(p);
    return Number.isFinite(a) && a > 0 ? a : 1.5;
  };
  const fracs = arrangeRows(positions.map(aspect), { gapRatio });
  const out = new Map<number, Arranged>();
  positions.forEach((p, i) => out.set(p, { w: fracs[i], rowStart: i === 0 ? true : null }));
  const after = run[run.indexOf(positions[positions.length - 1]) + 1];
  if (after !== undefined) out.set(after, { rowStart: true });
  return out;
}

/**
 * La proporción (ancho / alto) de lo que se ve de la foto en `pos` (la miniatura, aunque ya esté la nítida). `null`
 * mientras carga; 0 si no se sabe (sin imagen, rota o el marcador: cuenta como 3:2).
 */
export function aspectAt(view: EditorView, pos: number): number | null {
  const dom = view.nodeDOM(pos);
  const img = dom instanceof HTMLElement ? dom.querySelector<HTMLImageElement>(':scope > img.bn-visual-media') : null;
  if (!img || !img.getAttribute('src')) return 0;
  if (!img.complete) return null;
  if (img.src.startsWith('data:image/svg')) return 0;
  const { width, height } = thumbSize(img);
  return width > 0 && height > 0 ? width / height : 0;
}

/** El espacio entre fotos (`--img-gap`) sobre el ancho del renglón de la foto en `pos`, o `null` sin medidas. */
export function gapRatioAt(view: EditorView, pos: number): number | null {
  const dom = view.nodeDOM(pos);
  const line = dom instanceof HTMLElement ? photoLine(dom) : null;
  if (!line) return null;
  const width = line.clientWidth;
  if (!(width > 0)) return null;
  const gap = parseFloat(getComputedStyle(line).getPropertyValue('--img-gap')) || 8;
  return gap / width;
}

/** Acomoda en filas lo que corresponde a la selección (`arrangeTarget`), en un solo cambio. Devuelve si lo hizo. */
export function arrangeSelected(view: EditorView): boolean {
  const target = arrangeTarget(view.state);
  if (!target || !target.adjacent) return false;
  if (target.join) return joinAndArrange(view, target.positions);
  const aspects = new Map<number, number | null>();
  const run = runAround(view.state.doc, target.positions[0]);
  for (const p of run) aspects.set(p, aspectAt(view, p));
  const gap = gapRatioAt(view, target.positions[0]);
  if (gap === null || target.positions.some((p) => aspects.get(p) === null)) return false;
  const widths = arrangeWidths(view.state.doc, target.positions, (p) => aspects.get(p) ?? 0, gap);
  const tr = view.state.tr;
  for (const [pos, change] of widths) {
    if (change.w !== undefined) tr.setNodeAttribute(pos, 'w', change.w);
    if ((tr.doc.nodeAt(pos)?.attrs.rowStart ?? null) !== change.rowStart) tr.setNodeAttribute(pos, 'rowStart', change.rowStart);
  }
  if (tr.docChanged) view.dispatch(tr);
  return tr.docChanged;
}

/**
 * Junta en un renglón las fotos de renglones contiguos (`joinable`) y las acomoda en filas (D799). Quedan elegidas,
 * como después de acomodar fotos seguidas.
 */
export function joinAndArrange(view: EditorView, positions: readonly number[]): boolean {
  if (!joinable(view.state.doc, positions)) return false;
  const aspects = positions.map((p) => aspectAt(view, p));
  const gap = gapRatioAt(view, positions[0]);
  if (gap === null || aspects.some((a) => a === null)) return false;
  return joinPhotos(view, positions, aspects as number[], gap);
}

/**
 * El cambio de `joinAndArrange`, con las proporciones (en el orden de `positions`) ya medidas. Va en pasos chicos, cada
 * uno su propia transacción (`asOneUndoStep` los junta en un paso de deshacer), porque con otro dispositivo editando a la vez un
 * cambio grande perdía cosas (auditoría de D799):
 *   1. las fotos de los otros párrafos se copian, en orden, pegadas a la última elegida del primero;
 *   2. las originales salen de sus párrafos junto con los saltos y espacios que las rodean. **Ningún bloque se borra**
 *      (un párrafo que queda vacío, queda): lo que otro dispositivo escriba sin red en él, o un comentario anclado a él,
 *      no se pierde, y el texto que seguía a una foto se queda con el formato de su párrafo;
 *   3. en el primer párrafo se sacan solo los saltos y espacios entre las elegidas (las fotos no se recrean: un cambio
 *      que otro dispositivo les haga a la vez se conserva), y lo que quedó de relleno al final, si se movieron fotos;
 *   4. los anchos de "Arrange in rows".
 */
export function joinPhotos(view: EditorView, positions: readonly number[], aspects: readonly number[], gap: number): boolean {
  if (!joinable(view.state.doc, positions)) return false;
  // Un solo paso de deshacer, separado de lo que se hizo justo antes (sin esto, el medio segundo en que Yjs agrupa los
  // cambios pegaba la unión a lo último que se escribió: auditoría de D799).
  return asOneUndoStep(view.state, () => joinSteps(view, positions, aspects, gap));
}

function joinSteps(view: EditorView, positions: readonly number[], aspects: readonly number[], gap: number): boolean {
  const doc0 = view.state.doc;
  const $first = doc0.resolve(positions[0]);
  const firstEnd = $first.end();
  const inFirst = positions.filter((p) => p < firstEnd);
  const later = positions.slice(inFirst.length);
  let group = [...inFirst];
  if (later.length) {
    // 1. Las copias, pegadas a la última del primer párrafo.
    const at = inFirst[inFirst.length - 1] + 1;
    const tr1 = view.state.tr.insert(at, later.map((p) => doc0.nodeAt(p)!));
    view.dispatch(tr1);
    group = [...inFirst, ...later.map((_, i) => at + i)];
    // 2. Las originales y su relleno salen de sus párrafos; los párrafos quedan.
    const tr2 = view.state.tr;
    const moved = later.map((p) => tr1.mapping.map(p));
    const ranges: [number, number][] = [];
    for (let i = 0; i < moved.length; ) {
      const $p = tr2.doc.resolve(moved[i]);
      const end = $p.end();
      let j = i;
      while (j + 1 < moved.length && moved[j + 1] < end) j++;
      let to = moved[j] + 1;
      for (let n = tr2.doc.nodeAt(to); to < end && n && isFiller(n); n = tr2.doc.nodeAt(to)) to += n.nodeSize;
      ranges.push([$p.start(), to]);
      i = j + 1;
    }
    for (const [from, to] of ranges.reverse()) tr2.delete(from, to);
    view.dispatch(tr2);
    group = group.map((p) => tr2.mapping.map(p));
  }
  // 3. El relleno entre las elegidas del primer párrafo (y el del final, si se movieron fotos).
  const tr3 = view.state.tr;
  const cuts: [number, number][] = [];
  for (let k = 1; k < group.length; k++) if (group[k] > group[k - 1] + 1) cuts.push([group[k - 1] + 1, group[k]]);
  if (later.length) {
    const last = group[group.length - 1] + 1;
    const end = tr3.doc.resolve(last).end();
    if (last < end && fillerBetween(tr3.doc.resolve(last).parent, last - tr3.doc.resolve(last).start(), end - tr3.doc.resolve(last).start())) cuts.push([last, end]);
  }
  for (const [from, to] of cuts.reverse()) tr3.delete(from, to);
  if (tr3.docChanged) view.dispatch(tr3);
  group = group.map((p) => tr3.mapping.map(p));
  // 4. Los anchos.
  const doc = view.state.doc;
  if (!group.every((p, i) => p === group[0] + i && doc.nodeAt(p)?.type.name === PHOTO)) return true;
  const widths = arrangeWidths(doc, group, (p) => aspects[p - group[0]] ?? 0, gap);
  const tr4 = view.state.tr;
  for (const [pos, change] of widths) {
    if (change.w !== undefined) tr4.setNodeAttribute(pos, 'w', change.w);
    if ((tr4.doc.nodeAt(pos)?.attrs.rowStart ?? null) !== change.rowStart) tr4.setNodeAttribute(pos, 'rowStart', change.rowStart);
  }
  tr4.setSelection(TextSelection.create(tr4.doc, group[0], group[0] + group.length));
  view.dispatch(tr4);
  return true;
}
