// Copia de src/ui/editorSchema.ts de la versión publicada (árbol de 3dda6a7). Las pruebas la usan para comprobar
// que lo nuevo degrada en la versión que hoy puede estar abierta en otro dispositivo. No se edita a mano: la escribe
// scripts/esquema-publicado.mjs (`npm run esquema:publicado`) y cambian solo los imports ('./x' pasa a '../x'). Los
// módulos que importa (driveCard, imageRowsEditor, inlinePhoto, shortcuts, cellThumbs, quietImage) son los de hoy, así que
// los atributos que vienen de ellos los fija la firma (fixtures/editorSchemaMain.firma.ts), no este archivo. Lo de versiones
// más viejas queda en editorSchemaAnterior.ts (v0.083 a v0.092, antes del salto de hoja) y editorSchemaSoloScript.ts
// (hasta v0.040, solo Script).

import {
  addDefaultPropsExternalHTML,
  BlockNoteSchema,
  createBlockSpec,
  type BlockNoteEditor,
  createExtension,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultProps,
  getBlockInfoFromSelection,
  insertOrUpdateBlockForSlashMenu,
  parseDefaultProps,
} from '@blocknote/core';
import type { Node as PMNode, Slice } from '@tiptap/pm/model';
import { type EditorState, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { cellThumbsExtension, DEFAULT_THUMB_HEIGHT, THUMB_HEIGHT_PROP } from '../cellThumbs';
import { createDriveCardView, DRIVE_CARD_PROP, driveLinkInContent } from '../driveCard';
import { imageRowsExtension, ROW_WIDTH_PROP } from '../imageRowsEditor';
import { quietExternalHtml } from '../quietImage';
import { photoSpec } from '../inlinePhoto';
import { shortcutKeys } from '../shortcuts';

// --- Script (guion) ----------------------------------------------------------------------------------
//
// Texto con la tipografía de los guiones. En los encabezados de escena se marcan con un color de fondo
// INT/EXT, el momento del día (DÍA/DAY en amarillo, NOCHE/NIGHT en azul) y las luces de transición
// (AMANECER, ATARDECER, DAWN, DUSK… en naranja). Solo en mayúsculas, como se escriben los encabezados: "un
// día" en una acción no se marca.
//
// Script NO es un tipo de bloque nuevo: es un párrafo con `script: true`. Una versión de la app que no lo
// conoce descarta el atributo y lo muestra como párrafo común. Un tipo de bloque desconocido, en cambio,
// se borra del documento compartido al abrir la página (y-prosemirror elimina los nodos que el esquema no
// acepta) y ese borrado llega a todos los dispositivos. Regla: todo lo nuevo en el editor tiene que
// degradar así en una versión vieja.

export const SCRIPT_PROP = 'script';

// --- Preguntas ---------------------------------------------------------------------------------------
//
// Un párrafo marcado como pregunta (paso 10 de Docs/Plan_Workspaces.md): se ve con un ícono de pregunta y
// un color suave, y su respuesta es un hilo de comentarios de ese bloque (ver sync/comments.ts), así un
// invitado con el permiso Comentar contesta sin escribir la página. Igual que Script, NO es un tipo de
// bloque nuevo sino un párrafo con `question: true`: una versión de la app que no lo conoce lo muestra
// como párrafo común, y si alguien edita esa línea en la versión vieja se pierde solo la marca (el texto
// queda, y los comentarios siguen anclados al id del bloque). Script y pregunta no van juntos.

export const QUESTION_PROP = 'question';

// --- Tarjetas de Drive -------------------------------------------------------------------------------
//
// Un link de Drive que se ve como tarjeta con el reproductor (paso 13): un párrafo con el link y
// `driveCard: true` (ver driveCard.ts). Si se pierde la propiedad, queda el párrafo con el link. No va
// junto con Script ni con pregunta.

export { DRIVE_CARD_PROP };

// --- Salto de hoja -----------------------------------------------------------------------------------
//
// Un párrafo con `pageBreak: true` (Docs/Doc_Hojas_PDF.md, "Salto de hoja"): lo que sigue empieza en una hoja
// nueva, en las marcas del editor y en el PDF. Se ve como una línea con "Page break". Puede tener texto (si
// alguien escribe ahí, se ve y se imprime como un párrafo común, y la hoja nueva empieza después); vacío, en el
// papel no ocupa lugar. Igual que Script, NO es un tipo de bloque nuevo: una versión que no lo conoce ve un
// párrafo (vacío o con su texto) y, si lo edita, pierde solo el salto.

export const PAGE_BREAK_PROP = 'pageBreak';
/** El atajo del salto de hoja: Ctrl+Enter (⌘↩ en la Mac), del registro de atajos. */
export const PAGE_BREAK_SHORTCUT = shortcutKeys('pageBreak')[0];
/** El atajo de las preguntas (en el formato de ProseMirror): Ctrl/⌘+Alt+P, del registro de atajos. */
export const QUESTION_SHORTCUT = shortcutKeys('question')[0];

/** Una "Í" pegada desde macOS puede venir descompuesta (I + tilde combinada). */
const I_ACUTE = '(?:Í|I\\u0301)';
const BEFORE = '(?<![\\p{L}\\p{N}])';
const AFTER = '(?![\\p{L}\\p{N}\\u0300-\\u036f])';

export const SCRIPT_MARKS: { kind: 'place' | 'day' | 'night' | 'golden'; pattern: RegExp }[] = [
  {
    kind: 'place',
    pattern: new RegExp(
      `${BEFORE}(?:INT\\.?\\s?\\/\\s?EXT\\.?|EXT\\.?\\s?\\/\\s?INT\\.?|I\\/E\\.?|INT\\.?|EXT\\.?)${AFTER}`,
      'gu',
    ),
  },
  { kind: 'day', pattern: new RegExp(`${BEFORE}(?:D${I_ACUTE}A|DIA|DAY)${AFTER}`, 'gu') },
  { kind: 'night', pattern: new RegExp(`${BEFORE}(?:NOCHE|NIGHT)${AFTER}`, 'gu') },
  {
    kind: 'golden',
    pattern: new RegExp(`${BEFORE}(?:AMANECER|ATARDECER|ANOCHECER|DAWN|DUSK|SUNRISE|SUNSET)${AFTER}`, 'gu'),
  },
];

/** Las marcas de un texto: `[inicio, fin, tipo]`. */
export function scriptMarks(text: string): [number, number, string][] {
  const out: [number, number, string][] = [];
  for (const { kind, pattern } of SCRIPT_MARKS) {
    pattern.lastIndex = 0;
    for (const m of text.matchAll(pattern)) out.push([m.index, m.index + m[0].length, kind]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

const isScript = (node: PMNode) =>
  node.type.name === 'paragraph' && node.attrs[SCRIPT_PROP] === true && node.attrs[QUESTION_PROP] !== true;

function decorate(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (!isScript(node)) return false;
    // El texto del bloque entero, para que una palabra con partes en negrita igual se marque. Cada
    // elemento que no es texto (un salto de línea) ocupa una posición, igual que en el documento.
    let text = '';
    node.forEach((child) => {
      text += child.isText ? child.text : '￼'.repeat(child.nodeSize);
    });
    for (const [from, to, kind] of scriptMarks(text)) {
      decorations.push(Decoration.inline(pos + 1 + from, pos + 1 + to, { class: `script-mark script-${kind}` }));
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

const scriptMarksKey = new PluginKey<DecorationSet>('shotdocs-script-marks');

const scriptMarksPlugin = new Plugin<DecorationSet>({
  key: scriptMarksKey,
  state: {
    init: (_, state) => decorate(state.doc),
    apply: (tr, old) => (tr.docChanged ? decorate(tr.doc) : old),
  },
  props: {
    decorations: (state) => scriptMarksKey.getState(state),
  },
});

/**
 * Lo que traía cada bloque de lo pegado (los de primer nivel, en orden): `true` si era un salto. Lo anota
 * `transformPasted` con el estado de antes de pegar, y lo lee `appendTransaction` (su `oldState` es ese mismo estado).
 */
const pastedBreaks = new WeakMap<EditorState, boolean[]>();

function breaksInSlice(slice: Slice): boolean[] {
  const out: boolean[] = [];
  slice.content.descendants((node) => {
    if (node.type.name !== 'blockContainer') return true;
    const first = node.firstChild;
    out.push(first?.type.name === 'paragraph' && first.attrs[PAGE_BREAK_PROP] === true);
    return false;
  });
  return out;
}

/**
 * Pegar adentro de un salto de hoja (vacío, o sobre su texto elegido): ProseMirror reemplaza el bloque por lo pegado,
 * con las propiedades de fábrica, y el salto se perdía (el texto no). Después de pegar, el salto donde se pegó queda
 * una sola vez, en el último bloque pegado: lo pegado va arriba de la línea y la hoja nueva empieza después, como si
 * se hubiera escrito ahí. Si lo último pegado no es un párrafo (un título, una lista), el salto va en un párrafo vacío
 * debajo; también si es Script o una pregunta, que no van junto con el salto. Los saltos que venían en lo pegado se
 * conservan; los demás bloques quedan como venían (el primero puede haber heredado el salto del renglón donde se pegó,
 * y ese se le saca).
 */
const pageBreakPastePlugin = new Plugin({
  props: {
    transformPasted: (slice, view) => {
      pastedBreaks.set(view.state, breaksInSlice(slice));
      return slice;
    },
  },
  appendTransaction: (trs, oldState, newState) => {
    if (!trs.some((tr) => tr.getMeta('uiEvent') === 'paste')) return null;
    const fromSlice = pastedBreaks.get(oldState);
    pastedBreaks.delete(oldState);
    const { $from, $to } = oldState.selection;
    const content = $from.parent;
    if (content.type.name !== 'paragraph' || content.attrs[PAGE_BREAK_PROP] !== true || !$from.sameParent($to)) return null;
    if ($from.depth < 2 || $from.node($from.depth - 1).type.name !== 'blockContainer') return null;
    // El bloque del salto, seguido por los cambios: lo pegado quedó entre `from` y `to`.
    let from = $from.before($from.depth - 1);
    let to = $from.after($from.depth - 1);
    for (const tr of trs) {
      from = tr.mapping.map(from, -1);
      to = tr.mapping.map(to, 1);
    }
    if (!(from >= 0 && to <= newState.doc.content.size && from < to)) return null;
    const $start = newState.doc.resolve(from);
    const group = $start.parent;
    const blocks: { pos: number; node: PMNode }[] = [];
    for (let i = $start.index(), pos = from; i < group.childCount && pos < to; i++) {
      const node = group.child(i);
      if (node.type.name === 'blockContainer') blocks.push({ pos, node });
      pos += node.nodeSize;
    }
    const last = blocks[blocks.length - 1];
    if (!last) return null;
    const tr = newState.tr;
    // Los bloques de antes del último, como venían en lo pegado (cada bloque pegado, uno de primer nivel de lo
    // copiado). Si no se puede saber cuál es cuál, ninguno: el salto queda uno solo, nunca de más.
    const kept = fromSlice && fromSlice.length === blocks.length ? fromSlice : [];
    blocks.slice(0, -1).forEach((b, i) => {
      const first = b.node.firstChild;
      if (first?.type.name !== 'paragraph') return;
      const want = kept[i] === true;
      if ((first.attrs[PAGE_BREAK_PROP] === true) !== want) tr.setNodeAttribute(b.pos + 1, PAGE_BREAK_PROP, want);
    });
    const lastFirst = last.node.firstChild;
    // Script o pregunta no van junto con el salto (`paragraphProps`): como un título, el salto va en un renglón debajo.
    const plain = lastFirst?.type.name === 'paragraph' && lastFirst.attrs[SCRIPT_PROP] !== true && lastFirst.attrs[QUESTION_PROP] !== true;
    if (plain) {
      if (lastFirst.attrs[PAGE_BREAK_PROP] !== true) tr.setNodeAttribute(last.pos + 1, PAGE_BREAK_PROP, true);
    } else {
      // Un Script o una pregunta que quedó con el salto lo suelta: el salto va una sola vez, en el renglón de abajo.
      if (lastFirst?.type.name === 'paragraph' && lastFirst.attrs[PAGE_BREAK_PROP] === true) tr.setNodeAttribute(last.pos + 1, PAGE_BREAK_PROP, false);
      const schema = newState.schema;
      const marker = schema.nodes.paragraph.create({ [PAGE_BREAK_PROP]: true });
      tr.insert(last.pos + last.node.nodeSize, schema.nodes.blockContainer.create({ id: newBlockId() }, marker));
    }
    return tr.docChanged ? tr : null;
  },
});

function newBlockId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

// El párrafo de BlockNote, con una propiedad más.
const createParagraph = createBlockSpec(
  {
    type: 'paragraph',
    propSchema: {
      ...defaultProps,
      [SCRIPT_PROP]: { default: false },
      [QUESTION_PROP]: { default: false },
      [DRIVE_CARD_PROP]: { default: false },
      [PAGE_BREAK_PROP]: { default: false },
    },
    content: 'inline',
  },
  {
    meta: { isolating: false },
    parse: (element) => {
      if (element.tagName !== 'P') return undefined;
      // Un salto de hoja se reconoce aunque esté vacío (copiado de la app, o de un programa que lo marca así).
      const pageBreak = isPageBreakElement(element);
      if (!pageBreak && !element.textContent?.trim()) return undefined;
      const question = !pageBreak && element.classList.contains('question-line');
      const script = !pageBreak && !question && element.classList.contains('script-line');
      return {
        ...parseDefaultProps(element),
        [SCRIPT_PROP]: script,
        [QUESTION_PROP]: question,
        [DRIVE_CARD_PROP]: !pageBreak && !question && !script && element.classList.contains('drive-card-line'),
        [PAGE_BREAK_PROP]: pageBreak,
      };
    },
    render: function (block, editor) {
      // La tarjeta de Drive, solo en el editor y con un link de Drive válido; si no, un párrafo común.
      const ctx = this as { renderType?: string; props?: { node: PMNode; view: EditorView; getPos: () => number | undefined } };
      const link = isDriveCard(block.props) ? driveLinkInContent(block.content) : null;
      if (link && ctx.renderType === 'nodeView' && ctx.props) {
        return createDriveCardView({ link, node: ctx.props.node, editor, view: ctx.props.view, getPos: ctx.props.getPos });
      }
      const dom = document.createElement('p');
      if (block.props[QUESTION_PROP]) dom.className = 'question-line';
      else if (block.props[SCRIPT_PROP]) dom.className = 'script-line';
      // La línea del salto la dibuja styles.css sobre `.bn-block-content[data-page-break]` (lo pone BlockNote).
      else if (block.props[PAGE_BREAK_PROP]) dom.className = 'page-break-line';
      return { dom, contentDOM: dom };
    },
    toExternalHTML: (block) => {
      const dom = document.createElement('p');
      addDefaultPropsExternalHTML(block.props, dom);
      if (block.props[PAGE_BREAK_PROP]) {
        // Afuera de la app, el salto como lo escriben los procesadores de texto; la clase la reconoce al pegar.
        dom.className = 'page-break-line';
        dom.style.setProperty('break-after', 'page');
        dom.style.setProperty('page-break-after', 'always');
      } else if (block.props[QUESTION_PROP]) {
        dom.className = 'question-line';
      } else if (block.props[SCRIPT_PROP]) {
        dom.className = 'script-line';
        dom.style.fontFamily = "'Courier Prime', 'Courier New', Courier, monospace";
      } else if (isDriveCard(block.props)) {
        // Afuera de la app (copiar a otro programa) va el link; la clase la reconoce al pegar en la app.
        dom.className = 'drive-card-line';
      }
      return { dom, contentDOM: dom };
    },
    runsBefore: ['default', 'heading'],
  },
  [
    createExtension({
      key: 'shotdocs-paragraph',
      prosemirrorPlugins: [scriptMarksPlugin, pageBreakPastePlugin],
      keyboardShortcuts: {
        // Las teclas salen del registro de atajos (shortcuts.ts), como las de la ayuda.
        [shortcutKeys('paragraph')[0]]: ({ editor }) => setParagraph(editor, 'paragraph'),
        // Ctrl/⌘+Alt+S convierte el bloque en Script.
        [shortcutKeys('script')[0]]: ({ editor }) => setParagraph(editor, 'script'),
        // Ctrl/⌘+Alt+P, en una pregunta (Ctrl/⌘+Alt+Q ya es la cita del editor; con AltGr, Q y E escriben
        // "@" y "€" en los teclados en castellano).
        [QUESTION_SHORTCUT]: ({ editor }) => setParagraph(editor, 'question'),
        // Como en un procesador de guiones: Enter en una línea de guion con texto sigue en Script; en una
        // línea vacía sale a un párrafo común.
        Enter: ({ editor }) =>
          editor.transact((tr) => {
            const info = getBlockInfoFromSelection(tr);
            if (!info.isBlockContainer || !isScript(info.blockContent.node)) return false;
            // Una selección que sale del bloque (por ejemplo, hasta una tabla) la maneja el editor.
            if (!tr.selection.empty && !tr.selection.$from.sameParent(tr.selection.$to)) return false;
            if (tr.selection.empty && info.blockContent.node.childCount === 0) {
              tr.setNodeAttribute(info.blockContent.beforePos, SCRIPT_PROP, false);
              return true;
            }
            if (!tr.selection.empty) tr.deleteSelection();
            const pos = tr.selection.from;
            tr.split(pos, 2, [
              { type: info.bnBlock.node.type, attrs: {} },
              { type: info.blockContent.node.type, attrs: { ...info.blockContent.node.attrs } },
            ]);
            tr.setSelection(TextSelection.create(tr.doc, pos + 4));
            tr.scrollIntoView();
            return true;
          }),
      },
    }),
  ],
);

/** Un párrafo que se ve como tarjeta de Drive (nunca Script ni pregunta a la vez). */
function isDriveCard(props: Record<string, unknown>): boolean {
  return props[DRIVE_CARD_PROP] === true && props[QUESTION_PROP] !== true && props[SCRIPT_PROP] !== true;
}

/**
 * Las propiedades de cada variante del párrafo: común, Script, pregunta o tarjeta de Drive (nunca dos a la
 * vez). Pasar una tarjeta a párrafo, Script o pregunta le saca la tarjeta (queda el link).
 */
export function paragraphProps(kind: 'paragraph' | 'script' | 'question' | 'driveCard' | 'pageBreak'): Record<string, boolean> {
  return {
    [SCRIPT_PROP]: kind === 'script',
    [QUESTION_PROP]: kind === 'question',
    [DRIVE_CARD_PROP]: kind === 'driveCard',
    [PAGE_BREAK_PROP]: kind === 'pageBreak',
  };
}

/** Un `<p>` pegado que es un salto de hoja: el de la app (`page-break-line`) o uno con `break-after: page`. */
function isPageBreakElement(element: HTMLElement): boolean {
  if (element.classList.contains('page-break-line')) return true;
  const after = `${element.style.getPropertyValue('break-after')} ${element.style.getPropertyValue('page-break-after')}`;
  // Valores enteros: `avoid-page` (no cortar) no es un salto.
  return after.split(/\s+/).some((v) => ['page', 'always', 'left', 'right', 'recto', 'verso'].includes(v.trim().toLowerCase()));
}

type AnyBlock = { id: string; type: string; props: Record<string, unknown>; content?: unknown; children?: unknown[] };

/** Un párrafo de salto de hoja (con texto o sin). */
export function isPageBreakBlock(block: AnyBlock | undefined): boolean {
  return !!block && block.type === 'paragraph' && block.props[PAGE_BREAK_PROP] === true;
}

const isEmptyContent = (block: AnyBlock) => Array.isArray(block.content) && block.content.length === 0;

/**
 * Pone un salto de hoja en el cursor (Ctrl/⌘+Enter). En un párrafo vacío, ese párrafo pasa a ser el salto; al
 * principio de un bloque con texto, el salto va antes; en el medio de un párrafo, lo parte y el salto queda entre
 * las dos partes; al final (o en otro bloque de texto), va después. Si el cursor no queda en un bloque que sigue,
 * se agrega un párrafo vacío para seguir escribiendo en la hoja nueva. Todo en un solo paso de deshacer. En una
 * tabla o una imagen no hace nada, y en un bloque de código no lo toma (queda lo que ya hacía el editor).
 */
export function insertPageBreak(editor: BlockNoteEditor<any, any, any>): boolean {
  const { block } = editor.getTextCursorPosition() as unknown as { block: AnyBlock };
  if (editor.schema.blockSchema[block.type]?.content !== 'inline' || block.type === 'codeBlock') return false;
  if (isPageBreakBlock(block)) return true;
  const marker = { type: 'paragraph', props: paragraphProps('pageBreak') };
  const selection = editor.prosemirrorState.selection;
  const $from = selection.$from;
  const atStart = selection.empty && $from.parentOffset === 0;
  const atEnd = $from.parentOffset === $from.parent.content.size;
  if (!atStart && !atEnd && selection.empty && block.type === 'paragraph' && !isEmptyContent(block)) {
    // En el medio de un párrafo: se parte en el cursor (la segunda parte, con las mismas propiedades: Script sigue
    // Script) y el salto va antes de la segunda. Partir va en su propio paso para que la parte nueva tenga su id;
    // deshacer lo junta con el salto (los dos pasos van juntos, dentro de la pausa del historial).
    editor.transact((tr) => {
      const info = getBlockInfoFromSelection(tr);
      if (!info.isBlockContainer) return;
      tr.split(tr.selection.from, 2, [
        { type: info.bnBlock.node.type, attrs: {} },
        { type: info.blockContent.node.type, attrs: { ...info.blockContent.node.attrs } },
      ]);
    });
    const second = (editor.getTextCursorPosition() as unknown as { block: AnyBlock }).block;
    editor.transact(() => {
      editor.insertBlocks([marker as never], second.id, 'before');
      editor.setTextCursorPosition(second.id, 'start');
    });
    return true;
  }
  editor.transact(() => {
    if (block.type === 'paragraph' && isEmptyContent(block)) {
      editor.updateBlock(block.id, marker as never);
      followWithParagraph(editor, block.id);
    } else if (atStart) {
      editor.insertBlocks([marker as never], block.id, 'before');
      editor.setTextCursorPosition(block.id, 'start');
    } else {
      const [inserted] = editor.insertBlocks([marker as never], block.id, 'after') as unknown as AnyBlock[];
      followWithParagraph(editor, inserted.id);
    }
  });
  return true;
}

/** El menú "/": el renglón del "/" pasa a ser el salto (o, si tiene texto, el salto va abajo) y se sigue abajo. */
export function insertPageBreakForSlashMenu(editor: BlockNoteEditor<any, any, any>): void {
  editor.transact(() => {
    const marker = insertOrUpdateBlockForSlashMenu(editor, { type: 'paragraph', props: paragraphProps('pageBreak') } as never) as unknown as AnyBlock;
    followWithParagraph(editor, marker.id);
  });
}

/**
 * El cursor está en el texto propio del bloque (su contenido en línea), no en una celda de una tabla: ahí el
 * principio del renglón es el de la celda, no el del bloque.
 */
function inOwnContent(editor: BlockNoteEditor<any, any, any>): boolean {
  const state = editor.prosemirrorState;
  const info = getBlockInfoFromSelection(state);
  return info.isBlockContainer && info.blockContent.node === state.selection.$from.parent;
}

/**
 * Enter al principio de un salto con texto: un renglón común arriba y el salto queda uno solo (BlockNote copiaba el
 * salto al renglón nuevo: dos saltos y la nota sola en una hoja).
 */
export function enterAtBreakStart(editor: BlockNoteEditor<any, any, any>): boolean {
  const selection = editor.prosemirrorState.selection;
  if (!selection.empty || selection.$from.parentOffset !== 0 || !inOwnContent(editor)) return false;
  const { block } = editor.getTextCursorPosition() as unknown as { block: AnyBlock };
  if (!isPageBreakBlock(block) || isEmptyContent(block)) return false;
  editor.transact(() => {
    editor.insertBlocks([{ type: 'paragraph', props: paragraphProps('paragraph') } as never], block.id, 'before');
    editor.setTextCursorPosition(block.id, 'start');
  });
  return true;
}

/**
 * Supr en un salto vacío: saca el salto (como en Word), en vez de subir el renglón de abajo adentro del salto. El
 * cursor pasa al bloque que sigue en el documento, que no se mueve: el de abajo en el mismo nivel o, si el salto es el
 * último hijo de un bloque, el que sigue afuera. Si no hay nada después, el renglón queda como párrafo común vacío
 * (sin el salto). Con bloques adentro no hace nada distinto (los dejaría sueltos).
 */
export function deleteEmptyBreak(editor: BlockNoteEditor<any, any, any>): boolean {
  const selection = editor.prosemirrorState.selection;
  if (!selection.empty || !inOwnContent(editor)) return false;
  const position = editor.getTextCursorPosition() as unknown as { block: AnyBlock; nextBlock?: AnyBlock };
  const { block } = position;
  if (!isPageBreakBlock(block) || !isEmptyContent(block) || block.children?.length) return false;
  let next = position.nextBlock;
  for (let up: AnyBlock | undefined = block; !next && up; ) {
    up = editor.getParentBlock(up.id) as AnyBlock | undefined;
    if (up) next = editor.getNextBlock(up.id) as AnyBlock | undefined;
  }
  editor.transact(() => {
    if (!next) {
      editor.updateBlock(block.id, { props: { [PAGE_BREAK_PROP]: false } } as never);
      return;
    }
    editor.removeBlocks([block.id]);
    editor.setTextCursorPosition(next.id, 'start');
  });
  return true;
}

/** Deja el cursor en un párrafo vacío nuevo después de `id` (un salto recién puesto). */
function followWithParagraph(editor: BlockNoteEditor<any, any, any>, id: string): void {
  const [next] = editor.insertBlocks([{ type: 'paragraph', props: paragraphProps('paragraph') } as never], id, 'after') as unknown as AnyBlock[];
  editor.setTextCursorPosition(next.id, 'start');
}

/**
 * Retroceso con el cursor al principio de un bloque cuyo anterior es un salto de hoja: saca el salto. Vacío (y sin
 * bloques adentro), se borra el párrafo; con texto, queda como párrafo común (el texto nunca se borra). Sin esto,
 * el bloque se juntaría con el salto y su texto pasaría arriba de la línea.
 */
export function removeBreakBefore(editor: BlockNoteEditor<any, any, any>): boolean {
  const selection = editor.prosemirrorState.selection;
  if (!selection.empty || selection.$from.parentOffset !== 0 || !inOwnContent(editor)) return false;
  let position: { block: AnyBlock; prevBlock?: AnyBlock };
  try {
    position = editor.getTextCursorPosition() as unknown as typeof position;
  } catch {
    return false;
  }
  const prev = position.prevBlock;
  if (!prev || !isPageBreakBlock(prev) || isPageBreakBlock(position.block)) return false;
  editor.transact(() => {
    if (isEmptyContent(prev) && !prev.children?.length) editor.removeBlocks([prev.id]);
    else editor.updateBlock(prev.id, { props: { [PAGE_BREAK_PROP]: false } } as never);
  });
  return true;
}

function setParagraph(editor: BlockNoteEditor<any, any, any>, kind: 'paragraph' | 'script' | 'question'): boolean {
  const { block } = editor.getTextCursorPosition();
  if (editor.schema.blockSchema[block.type]?.content !== 'inline') return false;
  editor.updateBlock(block, { type: 'paragraph', props: paragraphProps(kind) });
  return true;
}

// Sin bloques de archivo, video ni audio: una versión vieja de la app los borraría (no están en su
// esquema). Las fotos y los videos que van al Drive del dueño son un bloque `image` con la dirección
// `sdmedia://<id>` (ver media/queue.ts); la app mira el tipo del archivo y muestra foto o video.
const { audio: _audio, file: _file, video: _video, ...blockSpecs } = defaultBlockSpecs;

// Lo que ofrece el bloque `image` al elegir un archivo (*Upload*, *Replace*). Con portero, cualquier archivo
// (fotos, videos y adjuntos: Docs/Doc_Adjuntos.md); sin portero, solo imágenes, como antes (ver
// `setVideosAccepted`). Pegar y soltar archivos no pasan por acá (fileDrop.ts). Es solo lo que ofrece el
// selector: el bloque guardado es el mismo de siempre.
const imageAccept: string[] = ['image/*'];
//
// Y una propiedad más, `rowWidth` (Docs/Doc_Imagenes.md): la parte del ancho de la página que ocupa la foto
// (0 = sin ancho propio, como antes). Fotos seguidas con `rowWidth` se ven en fila (imageRowsEditor.ts).
// El tipo sigue siendo `image`: una versión vieja muestra la foto con su `previewWidth` (px), una debajo
// de otra, y si edita ese bloque o uno vecino pierde solo `rowWidth`.
const image = {
  ...blockSpecs.image,
  config: {
    ...blockSpecs.image.config,
    propSchema: { ...blockSpecs.image.config.propSchema, [ROW_WIDTH_PROP]: { default: 0 } },
  },
  implementation: {
    ...blockSpecs.image.implementation,
    // Copiar o arrastrar una foto del Drive no pide su `sdmedia://` al navegador (quietImage.ts, B.24).
    toExternalHTML: quietExternalHtml(blockSpecs.image.implementation.toExternalHTML as never) as never,
    meta: { ...blockSpecs.image.implementation.meta, fileBlockAccept: imageAccept },
  },
  extensions: [...(blockSpecs.image.extensions ?? []), imageRowsExtension],
};

// La tabla, con una propiedad más: `thumbHeight` (cellThumbs.ts, Docs/Doc_Fotos_En_Linea.md, "Alto de las miniaturas
// (D27 → B)"), el alto en px de las miniaturas de sus celdas (64, 96 o 160; de fábrica 96). El tipo sigue siendo
// `table`: una versión vieja la ignora y muestra 96, y si edita la tabla pierde solo el alto (vuelve a 96).
const table = {
  ...blockSpecs.table,
  config: {
    ...blockSpecs.table.config,
    propSchema: { ...blockSpecs.table.config.propSchema, [THUMB_HEIGHT_PROP]: { default: DEFAULT_THUMB_HEIGHT as number } },
  },
  extensions: [...(blockSpecs.table.extensions ?? []), cellThumbsExtension],
};

/** El workspace tiene portero: el bloque `image` ofrece también videos y cualquier archivo. Lo llama el editor al abrirse. */
export function setVideosAccepted(on: boolean): void {
  imageAccept.splice(0, imageAccept.length, ...(on ? ['image/*', 'video/*', '*/*'] : ['image/*']));
}

/** Los bloques de la app (sin el contenido en línea: una prueba arma con ellos el esquema de la versión anterior). */
export const appBlockSpecs = { ...blockSpecs, image, table, paragraph: createParagraph() };

// El contenido en línea: el de BlockNote (texto y link) más la foto en línea (inlinePhoto.ts), el único tipo
// de nodo que se sumó después de la regla "nada de tipos nuevos". Lo cubre el resguardo de `unknownContent.ts`.
// Sus filas, la marca de la selección y su teclado (inlinePhotoEditor.ts) los suma el editor de la página
// (PageEditor.tsx): BlockNote no registra las extensiones de un contenido en línea.
export const schema = BlockNoteSchema.create({
  blockSpecs: appBlockSpecs,
  inlineContentSpecs: { ...defaultInlineContentSpecs, photo: photoSpec },
});

/**
 * Las opciones del editor que cambian qué nodos y marcas tiene su esquema: las usa el editor de la app
 * (PageEditor.tsx) y la prueba que compara los nombres de `unknownContent.ts` con el esquema real.
 */
export const editorSchemaOptions = {
  schema,
  tables: { splitCells: true, cellBackgroundColor: true, cellTextColor: true, headers: true },
};
