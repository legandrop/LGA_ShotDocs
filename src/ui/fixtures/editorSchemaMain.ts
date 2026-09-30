// Copia TAL CUAL de src/ui/editorSchema.ts en la rama main (la versión publicada), para probar que una
// app con el editor anterior no borra lo nuevo. No se toca: se reemplaza por la de main al publicar.

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
import { Decoration, DecorationSet } from '@tiptap/pm/view';

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

const isScript = (node: PMNode) => node.type.name === 'paragraph' && node.attrs[SCRIPT_PROP] === true;

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
    propSchema: { ...defaultProps, [SCRIPT_PROP]: { default: false } },
    content: 'inline',
  },
  {
    meta: { isolating: false },
    parse: (element) => {
      if (element.tagName !== 'P' || !element.textContent?.trim()) return undefined;
      return { ...parseDefaultProps(element), [SCRIPT_PROP]: element.classList.contains('script-line') };
    },
    render: (block) => {
      const dom = document.createElement('p');
      if (block.props[SCRIPT_PROP]) dom.className = 'script-line';
      return { dom, contentDOM: dom };
    },
    toExternalHTML: (block) => {
      const dom = document.createElement('p');
      addDefaultPropsExternalHTML(block.props, dom);
      if (block.props[SCRIPT_PROP]) {
        dom.className = 'script-line';
        dom.style.fontFamily = "'Courier Prime', 'Courier New', Courier, monospace";
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
        'Mod-Alt-0': ({ editor }) => setParagraph(editor, false),
        // Ctrl/⌘+Alt+S convierte el bloque en Script.
        'Mod-Alt-s': ({ editor }) => setParagraph(editor, true),
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

function setParagraph(editor: BlockNoteEditor<any, any, any>, script: boolean): boolean {
  const { block } = editor.getTextCursorPosition();
  if (editor.schema.blockSchema[block.type]?.content !== 'inline') return false;
  editor.updateBlock(block, { type: 'paragraph', props: { [SCRIPT_PROP]: script } });
  return true;
}

// En la fase 1 solo se guardan imágenes (el bucket no acepta otros archivos): sin bloques de archivo,
// video ni audio.
const { audio: _audio, file: _file, video: _video, ...blockSpecs } = defaultBlockSpecs;

export const schema = BlockNoteSchema.create({
  blockSpecs: { ...blockSpecs, paragraph: createParagraph() },
});
