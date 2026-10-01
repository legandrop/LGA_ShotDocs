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
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { createDriveCardView, DRIVE_CARD_PROP, driveLinkInContent } from './driveCard';
import { imageRowsExtension, ROW_WIDTH_PROP } from './imageRowsEditor';
import { photoSpec } from './inlinePhoto';
import { shortcutKeys } from './shortcuts';

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
 * Pegar en un salto de hoja vacío: ProseMirror reemplaza el párrafo vacío por el pegado, con las propiedades de
 * fábrica, y el salto se perdía (el texto no). Si donde estaba quedó un párrafo, se le devuelve el salto: lo pegado
 * queda arriba de la línea y la hoja nueva empieza después, como si se hubiera escrito ahí. Si lo pegado empieza con
 * otra cosa (un título, una lista), el salto se pierde como antes; el contenido, nunca.
 */
const pageBreakPastePlugin = new Plugin({
  appendTransaction: (trs, oldState, newState) => {
    if (!trs.some((tr) => tr.getMeta('uiEvent') === 'paste')) return null;
    const { $from } = oldState.selection;
    const content = $from.parent;
    if (content.type.name !== 'paragraph' || content.attrs[PAGE_BREAK_PROP] !== true || content.content.size !== 0) return null;
    // Donde estaba el párrafo vacío, seguido por los cambios: ahí queda el primer bloque pegado.
    // BlockNote cambia el bloque entero (el contenedor): el párrafo es el primer hijo del que quedó ahí.
    let pos = $from.before($from.depth - 1);
    for (const tr of trs) pos = tr.mapping.map(pos, -1);
    const container = pos >= 0 && pos < newState.doc.content.size ? newState.doc.nodeAt(pos) : null;
    if (container?.type.name !== 'blockContainer') return null;
    pos += 1;
    const node = container.firstChild;
    if (node?.type.name !== 'paragraph' || node.attrs[PAGE_BREAK_PROP] === true) return null;
    return newState.tr.setNodeAttribute(pos, PAGE_BREAK_PROP, true);
  },
});

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
 * tabla o una imagen no hace nada, y en un bloque de código deja lo que hace el editor (sale del bloque).
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
 * El teclado del salto de hoja, antes que el de BlockNote (si no, su Retroceso junta el bloque con el salto antes de
 * que lleguemos). Va en las extensiones del editor de la página (editorExtensions.ts).
 */
export const pageBreakExtension = createExtension({
  key: 'shotdocs-page-break',
  runsBefore: ['default'],
  keyboardShortcuts: {
    // Ctrl+Enter (⌘↩ en la Mac): un salto de hoja donde está el cursor, como en los procesadores de texto.
    [PAGE_BREAK_SHORTCUT]: ({ editor }) => insertPageBreak(editor),
    // Retroceso al principio del bloque que sigue a un salto: saca el salto (no junta el texto con él).
    Backspace: ({ editor }) => removeBreakBefore(editor),
  },
});

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
  if (!selection.empty || selection.$from.parentOffset !== 0) return false;
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
    meta: { ...blockSpecs.image.implementation.meta, fileBlockAccept: imageAccept },
  },
  extensions: [...(blockSpecs.image.extensions ?? []), imageRowsExtension],
};

/** El workspace tiene portero: el bloque `image` ofrece también videos y cualquier archivo. Lo llama el editor al abrirse. */
export function setVideosAccepted(on: boolean): void {
  imageAccept.splice(0, imageAccept.length, ...(on ? ['image/*', 'video/*', '*/*'] : ['image/*']));
}

/** Los bloques de la app (sin el contenido en línea: una prueba arma con ellos el esquema de la versión anterior). */
export const appBlockSpecs = { ...blockSpecs, image, paragraph: createParagraph() };

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
