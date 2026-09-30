import {
  addDefaultPropsExternalHTML,
  BlockNoteSchema,
  createBlockSpec,
  type BlockNoteEditor,
  createExtension,
  defaultBlockSpecs,
  defaultProps,
  getBlockInfoFromSelection,
  parseDefaultProps,
} from '@blocknote/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { createDriveCardView, DRIVE_CARD_PROP, driveLinkInContent } from './driveCard';

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
/** El atajo de las preguntas (en el formato de ProseMirror): Ctrl/⌘+Alt+P. */
export const QUESTION_SHORTCUT = 'Mod-Alt-p';

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

// El párrafo de BlockNote, con una propiedad más.
const createParagraph = createBlockSpec(
  {
    type: 'paragraph',
    propSchema: {
      ...defaultProps,
      [SCRIPT_PROP]: { default: false },
      [QUESTION_PROP]: { default: false },
      [DRIVE_CARD_PROP]: { default: false },
    },
    content: 'inline',
  },
  {
    meta: { isolating: false },
    parse: (element) => {
      if (element.tagName !== 'P' || !element.textContent?.trim()) return undefined;
      const question = element.classList.contains('question-line');
      const script = !question && element.classList.contains('script-line');
      return {
        ...parseDefaultProps(element),
        [SCRIPT_PROP]: script,
        [QUESTION_PROP]: question,
        [DRIVE_CARD_PROP]: !question && !script && element.classList.contains('drive-card-line'),
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
      return { dom, contentDOM: dom };
    },
    toExternalHTML: (block) => {
      const dom = document.createElement('p');
      addDefaultPropsExternalHTML(block.props, dom);
      if (block.props[QUESTION_PROP]) {
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
      prosemirrorPlugins: [scriptMarksPlugin],
      keyboardShortcuts: {
        'Mod-Alt-0': ({ editor }) => setParagraph(editor, 'paragraph'),
        // Ctrl/⌘+Alt+S convierte el bloque en Script.
        'Mod-Alt-s': ({ editor }) => setParagraph(editor, 'script'),
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
export function paragraphProps(kind: 'paragraph' | 'script' | 'question' | 'driveCard'): Record<string, boolean> {
  return { [SCRIPT_PROP]: kind === 'script', [QUESTION_PROP]: kind === 'question', [DRIVE_CARD_PROP]: kind === 'driveCard' };
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

// Lo que ofrece el bloque `image` al elegir, pegar o soltar un archivo. Con portero acepta también
// videos (sin esto, BlockNote buscaría un bloque `video`); sin portero, solo imágenes, como antes (ver
// `setVideosAccepted`). Es solo lo que ofrece el selector: el bloque guardado es el mismo de siempre.
const imageAccept: string[] = ['image/*'];
const image = {
  ...blockSpecs.image,
  implementation: {
    ...blockSpecs.image.implementation,
    meta: { ...blockSpecs.image.implementation.meta, fileBlockAccept: imageAccept },
  },
};

/** El workspace tiene portero: el bloque `image` ofrece también videos. Lo llama el editor al abrirse. */
export function setVideosAccepted(on: boolean): void {
  imageAccept.splice(0, imageAccept.length, ...(on ? ['image/*', 'video/*'] : ['image/*']));
}

export const schema = BlockNoteSchema.create({
  blockSpecs: { ...blockSpecs, image, paragraph: createParagraph() },
});

/**
 * Las opciones del editor que cambian qué nodos y marcas tiene su esquema: las usa el editor de la app
 * (PageEditor.tsx) y la prueba que compara los nombres de `unknownContent.ts` con el esquema real.
 */
export const editorSchemaOptions = {
  schema,
  tables: { splitCells: true, cellBackgroundColor: true, cellTextColor: true, headers: true },
};
