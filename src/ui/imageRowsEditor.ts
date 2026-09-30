import { createExtension, type BlockNoteEditor } from '@blocknote/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, Selection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { groupRows, pxToRowWidth, snapRowWidth } from './imageRows';

// Fotos en fila (Docs/Doc_Imagenes.md). Una fila NO es un bloque: son bloques `image` hermanos y seguidos
// con `rowWidth` (la parte del ancho que ocupa cada uno, entre 0 y 1; 0 = sin ancho propio, como antes).
// Este plugin calcula las filas con `groupRows` y las dibuja con decoraciones: el grupo con alguna fila
// lleva `img-rows` (el CSS lo pasa a flex), y cada foto `img-sized` con su parte (`--img-f`) y cuántas hay
// en su fila (`--row-n`). Nada de esto cambia el documento. También: los tiradores de BlockNote guardan un
// ancho en px al soltar, y acá se convierte en `rowWidth` (imantado a 1, 1/2, 1/3 o 1/4); y las flechas y
// Enter con una foto de una fila elegida.

export const ROW_WIDTH_PROP = 'rowWidth';

/** Lo que dura un arrastre de un tirador (lo empieza el `pointerdown` sobre `.bn-resize-handle`). */
interface Resizing {
  id: string;
  /** El ancho del área de texto del grupo, el espacio entre fotos y cuántas hay en su fila, al empezar. */
  width: number;
  gap: number;
  n: number;
  moved: boolean;
}

interface RowsState {
  decorations: DecorationSet;
  resizing: Resizing | null;
}

type RowsMeta = { start: Resizing } | { moved: true } | { end: true };

const rowsKey = new PluginKey<RowsState>('shotdocs-image-rows');

/** La parte del ancho de un bloque (`blockContainer`), o 0 si no es una foto con ancho propio. */
function fractionOf(container: PMNode): number {
  const content = container.firstChild;
  if (!content || content.type.name !== 'image') return 0;
  const f = Number(content.attrs[ROW_WIDTH_PROP]);
  return Number.isFinite(f) && f > 0 ? Math.min(1, f) : 0;
}

interface Sibling {
  node: PMNode;
  pos: number;
}

/** Los hijos de un grupo de bloques (`blockGroup`) con su posición. */
function siblingsOf(group: PMNode, groupPos: number): Sibling[] {
  const out: Sibling[] = [];
  group.forEach((node, offset) => out.push({ node, pos: groupPos + 1 + offset }));
  return out;
}

function decorate(doc: PMNode, resizingId: string | null): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    // Solo la estructura (grupos y bloques): el contenido de cada bloque no tiene filas adentro.
    if (node.type.name === 'blockContainer') return true;
    if (node.type.name !== 'blockGroup') return false;
    const kids = siblingsOf(node, pos);
    const fracs = kids.map((k) => fractionOf(k.node));
    const rows = groupRows(fracs);
    if (rows.length > 0) decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'img-rows' }));
    for (const row of rows) {
      const sum = row.reduce((s, i) => s + fracs[i], 0);
      const full = sum > 1 - 1e-3;
      const rowId = String(kids[row[0]].node.attrs.id ?? '');
      row.forEach((i, k) => {
        const { node: container, pos: at } = kids[i];
        const classes = ['img-sized'];
        if (k === 0) classes.push('img-row-first');
        if (k === row.length - 1 && full) classes.push('img-row-last');
        if (resizingId !== null && container.attrs.id === resizingId) classes.push('img-resizing');
        // Una foto sola que no llena el renglón respeta su alineación (centrada o a la derecha).
        const align = row.length === 1 && !full ? String(container.firstChild?.attrs.textAlignment ?? '') : '';
        if (align === 'center' || align === 'right') classes.push(`img-align-${align}`);
        decorations.push(
          Decoration.node(at, at + container.nodeSize, {
            class: classes.join(' '),
            style: `--img-f: ${fracs[i]}; --row-n: ${row.length}`,
            'data-img-row': rowId,
          }),
        );
      });
    }
    return true;
  });
  return DecorationSet.create(doc, decorations);
}

/** El `blockContainer` con ese id y su posición. */
function findContainer(doc: PMNode, id: string): Sibling | null {
  let found: Sibling | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === 'blockContainer' && node.attrs.id === id) {
      found = { node, pos };
      return false;
    }
    return true;
  });
  return found;
}

/**
 * Al soltar un tirador, BlockNote guarda `previewWidth` (px). Si fue un arrastre de este dispositivo (con
 * movimiento: un clic sin mover guardaría el ancho viejo), en la misma transacción se guarda `rowWidth` con
 * la inversa exacta del CSS, imantado. Los cambios que llegan de otros dispositivos no pasan por acá (no
 * hay arrastre abierto), así que dos pantallas de distinto ancho nunca se pisan.
 */
function convertResize(trs: readonly Transaction[], oldState: EditorState, newState: EditorState): Transaction | null {
  const session = rowsKey.getState(newState)?.resizing;
  if (!session?.moved || !trs.some((tr) => tr.docChanged)) return null;
  const now = findContainer(newState.doc, session.id);
  const content = now?.node.firstChild;
  if (!now || !content || content.type.name !== 'image') return null;
  const before = findContainer(oldState.doc, session.id)?.node.firstChild;
  const px = Number(content.attrs.previewWidth);
  if (!(px > 0) || px === Number(before?.attrs.previewWidth)) return null;
  const f = snapRowWidth(pxToRowWidth(px, session.width, session.gap, session.n));
  if (f === Number(content.attrs[ROW_WIDTH_PROP])) return null;
  return newState.tr.setNodeMarkup(now.pos + 1, undefined, { ...content.attrs, [ROW_WIDTH_PROP]: f });
}

/** Lo que hay que mover el tirador para que cuente como arrastre. */
const MOVE_THRESHOLD_PX = 3;

/** Mira el arrastre de un tirador: al apretar, fija el ancho real y avisa; al soltar, cierra. */
function watchResize(view: EditorView): { destroy: () => void } {
  const send = (meta: RowsMeta) => view.dispatch(view.state.tr.setMeta(rowsKey, meta));
  let stop: (() => void) | null = null;
  const onDown = (e: PointerEvent) => {
    const handle = (e.target as Element | null)?.closest?.('.bn-resize-handle');
    // Solo el botón principal: un clic derecho (en la Mac el `mouseup` puede no llegar) no abre un arrastre.
    if (!handle || !view.editable || e.button !== 0) return;
    const container = handle.closest<HTMLElement>('[data-node-type="blockContainer"][data-id]');
    const outer = handle.closest<HTMLElement>('.bn-block-outer');
    const group = outer?.parentElement;
    const wrapper = handle.closest<HTMLElement>('.bn-file-block-content-wrapper');
    if (!container || !outer || !group || !wrapper) return;
    const style = getComputedStyle(group);
    const width = group.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
    const gap = parseFloat(style.columnGap) || 0;
    const n = Number(outer.style.getPropertyValue('--row-n')) || 1;
    // El ancho que se ve, fijo en px: al sacar el ancho de la fila (`img-resizing`) la foto no salta.
    const before = wrapper.style.width;
    wrapper.style.width = `${wrapper.getBoundingClientRect().width}px`;
    send({ start: { id: container.dataset.id!, width, gap, n, moved: false } });
    stop?.();
    let moved = false;
    const startX = e.clientX;
    // Un temblor de la mano no cuenta: hace falta moverse unos píxeles (si no, un ancho que dejó "Acomodar
    // en filas" cambiaría apenas y la última foto de la fila bajaría al renglón siguiente).
    const onMove = (m: PointerEvent) => {
      if (moved || Math.abs(m.clientX - startX) < MOVE_THRESHOLD_PX) return;
      moved = true;
      send({ moved: true });
    };
    // BlockNote escucha el `mouseup` en `window` desde que se dibujó la foto: corre antes que este, así que
    // su `previewWidth` ya está guardado (y convertido) cuando se cierra el arrastre.
    const onUp = () => {
      stop?.();
      if (!moved) wrapper.style.width = before;
      send({ end: true });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
    window.addEventListener('pointercancel', onUp);
    stop = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchend', onUp);
      window.removeEventListener('pointercancel', onUp);
      stop = null;
    };
  };
  view.dom.addEventListener('pointerdown', onDown, true);
  return {
    destroy: () => {
      stop?.();
      view.dom.removeEventListener('pointerdown', onDown, true);
    },
  };
}

export const imageRowsPlugin = new Plugin<RowsState>({
  key: rowsKey,
  state: {
    init: (_, state) => ({ decorations: decorate(state.doc, null), resizing: null }),
    apply: (tr, old) => {
      const meta = tr.getMeta(rowsKey) as RowsMeta | undefined;
      let resizing = old.resizing;
      if (meta && 'start' in meta) resizing = meta.start;
      else if (meta && 'moved' in meta && resizing) resizing = { ...resizing, moved: true };
      else if (meta && 'end' in meta) resizing = null;
      const idChanged = (resizing?.id ?? null) !== (old.resizing?.id ?? null);
      if (!tr.docChanged && !idChanged) return resizing === old.resizing ? old : { ...old, resizing };
      return { decorations: decorate(tr.doc, resizing?.id ?? null), resizing };
    },
  },
  appendTransaction: convertResize,
  props: {
    decorations: (state) => rowsKey.getState(state)?.decorations,
  },
  view: watchResize,
});

// --- Teclado --------------------------------------------------------------------------------------------

interface RowAt {
  kids: Sibling[];
  row: number[];
  /** El lugar de la foto elegida en su fila. */
  k: number;
}

/** La fila de la foto elegida (una selección del bloque entero), o `null` si no hay foto elegida en una fila. */
function rowOfSelection(state: EditorState): RowAt | null {
  const sel = state.selection;
  if (!(sel instanceof NodeSelection) || sel.node.type.name !== 'image') return null;
  const $pos = state.doc.resolve(sel.from);
  const depth = $pos.depth - 1;
  if (depth < 0) return null;
  const group = $pos.node(depth);
  if (group.type.name !== 'blockGroup') return null;
  const kids = siblingsOf(group, $pos.before(depth));
  const index = $pos.index(depth);
  const row = groupRows(kids.map((k) => fractionOf(k.node))).find((r) => r.includes(index));
  return row ? { kids, row, k: row.indexOf(index) } : null;
}

/**
 * Elige un bloque: una foto de la fila entera; saliendo de la fila, lo primero que se puede elegir después
 * (hacia abajo) o antes (hacia arriba), sea texto, una foto o un separador, y hacia arriba el último hijo
 * del bloque de arriba si tiene.
 */
function selectBlock(state: EditorState, at: Sibling, end: boolean, leaving: boolean): Transaction {
  const content = at.node.firstChild;
  const tr = state.tr;
  if (!leaving && content && content.type.name === 'image') return tr.setSelection(NodeSelection.create(state.doc, at.pos + 1));
  const from = end ? at.pos + at.node.nodeSize : at.pos;
  const found = Selection.findFrom(state.doc.resolve(from), end ? -1 : 1);
  return found ? tr.setSelection(found) : tr;
}

type KeyContext = { editor: BlockNoteEditor<any, any, any> };

function move(
  editor: BlockNoteEditor<any, any, any>,
  pick: (at: RowAt) => { to: Sibling; end: boolean; leaving?: boolean } | null,
): boolean {
  const view = editor.prosemirrorView;
  if (!view) return false;
  const at = rowOfSelection(view.state);
  if (!at || at.row.length < 2) return false;
  const target = pick(at);
  if (!target) return false;
  view.dispatch(selectBlock(view.state, target.to, target.end, !!target.leaving).scrollIntoView());
  return true;
}

const first = (at: RowAt) => at.row[0];
const last = (at: RowAt) => at.row[at.row.length - 1];

export const imageRowsExtension = createExtension({
  key: 'shotdocs-image-rows',
  prosemirrorPlugins: [imageRowsPlugin],
  keyboardShortcuts: {
    // Entre las fotos de una fila, de una a otra (sin pasar por el cursor de hueco).
    ArrowRight: ({ editor }: KeyContext) =>
      move(editor, (at) => (at.k < at.row.length - 1 ? { to: at.kids[at.row[at.k + 1]], end: false } : null)),
    ArrowLeft: ({ editor }: KeyContext) =>
      move(editor, (at) => (at.k > 0 ? { to: at.kids[at.row[at.k - 1]], end: true } : null)),
    // Arriba y abajo salen de la fila entera.
    ArrowDown: ({ editor }: KeyContext) =>
      move(editor, (at) => (at.kids[last(at) + 1] ? { to: at.kids[last(at) + 1], end: false, leaving: true } : null)),
    ArrowUp: ({ editor }: KeyContext) =>
      move(editor, (at) => (at.kids[first(at) - 1] ? { to: at.kids[first(at) - 1], end: true, leaving: true } : null)),
    // Enter con una foto de una fila elegida: el párrafo nuevo va después de la fila, no en el medio.
    Enter: ({ editor }: KeyContext) => {
      const view = editor.prosemirrorView;
      const at = view ? rowOfSelection(view.state) : null;
      if (!at || at.row.length < 2) return false;
      const lastId = String(at.kids[last(at)].node.attrs.id);
      const [inserted] = editor.insertBlocks([{ type: 'paragraph' }], lastId, 'after');
      if (inserted) editor.setTextCursorPosition(inserted, 'start');
      return true;
    },
  },
});
