import { createExtension } from '@blocknote/core';
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { PHOTO } from './inlinePhoto';

// El alto de las miniaturas de las fotos en las celdas de una tabla (Docs/Doc_Fotos_En_Linea.md, "Alto de las
// miniaturas (D27 → B)"). Uno por tabla: 64, 96 (de fábrica) o 160 px. Una foto con ancho propio (`w > 0`) no es una
// miniatura y no cambia.
//
// Se guarda como una propiedad más de la tabla (`thumbHeight`, en px), no como un tipo nuevo: una versión que no la
// conoce abre la página sin escribir nada y muestra 96; si edita esa tabla, y-prosemirror le saca la propiedad y la
// tabla vuelve a 96, con todas sus fotos y su texto.

export const THUMB_HEIGHT_PROP = 'thumbHeight';
export const THUMB_HEIGHTS = [64, 96, 160] as const;
export type ThumbHeight = (typeof THUMB_HEIGHTS)[number];
export const DEFAULT_THUMB_HEIGHT: ThumbHeight = 96;
/** El atributo del HTML (copiar y pegar) y del bloque en pantalla, que lee styles.css. */
export const THUMB_HEIGHT_ATTR = 'data-thumb-height';

/** Un alto guardado, como uno de los tres. Lo que no es 64, 96 ni 160 (una versión futura, un valor a mano) es 96. */
export function thumbHeightOf(value: unknown): ThumbHeight {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return (THUMB_HEIGHTS as readonly unknown[]).includes(n) ? (n as ThumbHeight) : DEFAULT_THUMB_HEIGHT;
}

/**
 * El atributo del nodo `table`. BlockNote no lo crea desde la lista de propiedades de la tabla (el color del texto lo
 * agrega una extensión global aparte), así que va igual que el color. En el HTML va sobre el bloque de la tabla (donde
 * BlockNote pone sus atributos) y solo si no es el de fábrica; al pegar se busca en la tabla o en su bloque.
 */
const thumbHeightAttribute = Extension.create({
  name: 'shotdocsTableThumbHeight',
  addGlobalAttributes() {
    return [
      {
        types: ['table'],
        attributes: {
          [THUMB_HEIGHT_PROP]: {
            default: DEFAULT_THUMB_HEIGHT,
            parseHTML: (element: HTMLElement) => {
              const holder = element.hasAttribute(THUMB_HEIGHT_ATTR) ? element : element.closest(`[data-content-type="table"]`);
              return thumbHeightOf(holder?.getAttribute(THUMB_HEIGHT_ATTR));
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              const h = thumbHeightOf(attributes[THUMB_HEIGHT_PROP]);
              return h === DEFAULT_THUMB_HEIGHT ? {} : { [THUMB_HEIGHT_ATTR]: String(h) };
            },
          },
        },
      },
    ];
  },
});

/**
 * El alto en la pantalla. El nodo de la tabla de BlockNote (`TableView`) no vuelve a dibujar sus atributos cuando
 * cambian (solo el color del texto): el alto llega con una decoración del nodo, que ProseMirror sí actualiza, sobre el
 * bloque de la tabla. styles.css cambia ahí `--sd-cell-photo-h`.
 */
function decorate(doc: PMNode): DecorationSet {
  const out: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'table') {
      const h = thumbHeightOf(node.attrs[THUMB_HEIGHT_PROP]);
      if (h !== DEFAULT_THUMB_HEIGHT) out.push(Decoration.node(pos, pos + node.nodeSize, { [THUMB_HEIGHT_ATTR]: String(h) }));
      return false;
    }
    // El texto de un bloque no tiene tablas adentro.
    return !node.isTextblock;
  });
  return DecorationSet.create(doc, out);
}

const cellThumbsKey = new PluginKey<DecorationSet>('shotdocs-cell-thumbs');

const cellThumbsPlugin = new Plugin<DecorationSet>({
  key: cellThumbsKey,
  state: {
    init: (_, state) => decorate(state.doc),
    apply: (tr, old) => (tr.docChanged ? decorate(tr.doc) : old),
  },
  props: {
    decorations: (state) => cellThumbsKey.getState(state),
  },
});

/** El atributo y el alto en pantalla: va con el bloque de la tabla (editorSchema.ts), en cualquier editor de la app. */
export const cellThumbsExtension = createExtension({
  key: 'shotdocs-cell-thumbs',
  tiptapExtensions: [thumbHeightAttribute],
  prosemirrorPlugins: [cellThumbsPlugin],
});

/** La posición de la tabla que tiene `pos` (una foto de una celda), o `null`. */
export function tableAt(doc: PMNode, pos: number): number | null {
  const $pos = doc.resolve(pos);
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.name === 'table') return $pos.before(d);
  }
  return null;
}

/** Las tablas (sin repetir, en orden) de las fotos en esas posiciones. */
export function tablesOf(doc: PMNode, positions: readonly number[]): number[] {
  const found = new Set<number>();
  for (const p of positions) {
    const t = tableAt(doc, p);
    if (t !== null) found.add(t);
  }
  return [...found].sort((a, b) => a - b);
}

/** El alto de esas tablas, si es el mismo en todas; si no, `null`. */
export function thumbHeightOfTables(doc: PMNode, tables: readonly number[]): ThumbHeight | null {
  const heights = new Set(tables.map((t) => thumbHeightOf(doc.nodeAt(t)?.attrs[THUMB_HEIGHT_PROP])));
  return heights.size === 1 ? [...heights][0] : null;
}

/** La tabla tiene alguna foto en sus celdas. */
export function tableHasPhotos(table: PMNode): boolean {
  let found = false;
  table.descendants((n) => {
    if (n.type.name === PHOTO) found = true;
    return !found;
  });
  return found;
}

/** Cambia el alto de las miniaturas de esas tablas, en un solo paso de deshacer. Las fotos no se tocan. */
export function setThumbHeight(view: EditorView, tables: readonly number[], height: ThumbHeight): boolean {
  const tr = setThumbHeightTr(view.state, tables, height);
  if (!tr) return false;
  view.dispatch(tr);
  return true;
}

export function setThumbHeightTr(state: EditorState, tables: readonly number[], height: ThumbHeight) {
  const tr = state.tr;
  for (const t of tables) {
    const node = tr.doc.nodeAt(t);
    if (node?.type.name !== 'table' || !(THUMB_HEIGHT_PROP in node.attrs)) continue;
    if (node.attrs[THUMB_HEIGHT_PROP] !== height) tr.setNodeAttribute(t, THUMB_HEIGHT_PROP, height);
  }
  return tr.docChanged ? tr : null;
}
