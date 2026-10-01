import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, TextSelection, type EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { arrangeRows, groupRows } from './imageRows';
import { PHOTO, photoWidth } from './inlinePhoto';
import { thumbSize } from './sharpMarks';

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

/**
 * Lo que acomoda "Arrange in rows": con una foto elegida, las fotos seguidas de su renglón; con varias, esas (si
 * están seguidas). `null` si no hay qué acomodar (una sola, o con letras en el medio: `adjacent` falso).
 */
export function arrangeTarget(state: EditorState): { positions: number[]; adjacent: boolean } | null {
  const chosen = selectedPhotos(state);
  if (chosen.length === 0) return null;
  if (chosen.length === 1) {
    const run = runAround(state.doc, chosen[0]);
    return run.length > 1 ? { positions: run, adjacent: true } : null;
  }
  return { positions: chosen, adjacent: areAdjacent(state.doc, chosen) };
}

/** Pone el mismo ancho a todas esas fotos, en un solo cambio. */
export function setPhotoWidths(view: EditorView, positions: readonly number[], w: number): void {
  const tr = view.state.tr;
  for (const pos of positions) {
    if (tr.doc.nodeAt(pos)?.type.name === PHOTO) tr.setNodeAttribute(pos, 'w', w);
  }
  if (tr.docChanged) view.dispatch(tr);
}

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

/**
 * Los anchos para acomodar `positions` (seguidas, parte de la tanda `run`) en filas: `arrangeRows` con sus
 * proporciones, y que queden en filas propias dentro de la tanda (las filas las arma `groupRows` desde el principio
 * de la tanda, de a una y mientras entren). Por eso:
 * - si la fila de antes de la primera no está llena, la primera subiría a esa fila: entran en el acomodo también
 *   las fotos de esa fila (las que se ven en el mismo renglón), y así hasta una fila llena o el principio;
 * - si después de la última sigue otra foto y la última fila no llena el renglón, esa foto subiría: la última fila
 *   se llena.
 * Devuelve los anchos nuevos por posición (las que no están, quedan como estaban).
 */
export function arrangeWidths(
  doc: PMNode,
  positions: readonly number[],
  aspectOf: (pos: number) => number,
  gapRatio: number,
): Map<number, number> {
  const run = runAround(doc, positions[0]);
  const widthAt = (p: number) => photoWidth(doc.nodeAt(p)?.attrs.w);
  // Una proporción desconocida cuenta como 3:2, como en `arrangeRows`.
  const aspect = (p: number) => {
    const a = aspectOf(p);
    return Number.isFinite(a) && a > 0 ? a : 1.5;
  };
  const before = run.map(widthAt);
  let first = run.indexOf(positions[0]);
  const last = run.indexOf(positions[positions.length - 1]);
  const result = new Map<number, number>();
  for (let guard = 0; guard <= run.length; guard++) {
    const chosen = run.slice(first, last + 1);
    const fracs = arrangeRows(chosen.map(aspect), { gapRatio });
    const next = before.slice();
    chosen.forEach((_, i) => (next[first + i] = fracs[i]));
    const rows = groupRows(next);
    const startsRow = rows.some((r) => r[0] === first);
    if (!startsRow && first > 0) {
      // La primera no empieza fila: suma la fila (de antes del cambio) de la foto anterior.
      const prevRow = groupRows(before).find((r) => r.includes(first - 1));
      first = prevRow ? prevRow[0] : first - 1;
      continue;
    }
    // La última fila, llena si después sigue una foto que entraría en ella.
    const lastRow = rows.find((r) => r.includes(last));
    if (lastRow && last + 1 < run.length && lastRow[lastRow.length - 1] !== last) {
      const inRow = lastRow.filter((k) => k >= first && k <= last);
      const sum = inRow.reduce((s, k) => s + aspect(run[k]), 0);
      let others = 0;
      inRow.forEach((k, i) => {
        if (i < inRow.length - 1) {
          next[k] = Math.max(1e-4, round4(aspect(run[k]) / sum));
          others += next[k];
        } else next[k] = round4(1 - others);
      });
    }
    for (let k = first; k <= last; k++) result.set(run[k], next[k]);
    return result;
  }
  return result;
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
  const line = dom instanceof HTMLElement ? dom.closest<HTMLElement>('.bn-inline-content') : null;
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
  const aspects = new Map<number, number | null>();
  const run = runAround(view.state.doc, target.positions[0]);
  for (const p of run) aspects.set(p, aspectAt(view, p));
  const gap = gapRatioAt(view, target.positions[0]);
  if (gap === null || target.positions.some((p) => aspects.get(p) === null)) return false;
  const widths = arrangeWidths(view.state.doc, target.positions, (p) => aspects.get(p) ?? 0, gap);
  const tr = view.state.tr;
  for (const [pos, w] of widths) tr.setNodeAttribute(pos, 'w', w);
  if (tr.docChanged) view.dispatch(tr);
  return tr.docChanged;
}
