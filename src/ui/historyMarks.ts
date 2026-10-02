import { createExtension } from '@blocknote/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { relativePositionToAbsolutePosition, ySyncPluginKey } from 'y-prosemirror';
import * as Y from 'yjs';
import type { HistoryMark } from '../sync/historyDiff';

// Las marcas de "Show changes" en la versión del historial (P.18, Docs/Doc_Historial.md, entrega 2): DECORACIONES de
// ProseMirror sobre el editor de solo lectura que muestra la unión de dos versiones. No tocan el esquema (nada de
// marcas ni tipos de bloque nuevos) ni el documento: una versión vieja de la app no se entera de nada, y lo que se ve
// sale solo de esta pantalla.
//
// Cada marca llega con su lugar en el documento de la unión (una posición relativa de Yjs) y se ubica en el editor con
// el mapa de y-prosemirror (el mismo que usa buscar). Lo agregado, subrayado con un fondo suave del color de quien lo
// escribió; lo borrado, tachado en el color de quien lo borró; un bloque entero, una barra de su color a la izquierda
// (y el borrado, atenuado); un bloque que cambió de tipo o de formato, su rótulo. Al pasar el mouse, quién y cuándo.

/** Cómo se ve una marca: el color de la persona, el tooltip (quién y cuándo) y el rótulo de un bloque que cambió. */
export interface MarkLook {
  color: string;
  tip: string;
  label?: string;
}

export interface HistoryMarksInput {
  marks: readonly HistoryMark[];
  look: (mark: HistoryMark) => MarkLook;
}

interface Binding {
  doc: Y.Doc;
  type: Y.XmlFragment;
  mapping: Map<unknown, unknown>;
}

const key = new PluginKey<null>('shotdocs-history-marks');

/** La posición en el editor de una posición de la unión, o `null` si ya no está (o el editor no la armó). */
function place(binding: Binding, json: Record<string, unknown>): number | null {
  try {
    return relativePositionToAbsolutePosition(binding.doc, binding.type, Y.createRelativePositionFromJSON(json), binding.mapping as never);
  } catch {
    return null;
  }
}

/** Las decoraciones de las marcas sobre ese estado del editor (vacías hasta que y-prosemirror dibujó la unión). */
export function markDecorations(state: EditorState, input: HistoryMarksInput): DecorationSet {
  const binding = (ySyncPluginKey.getState(state) as { binding?: Binding } | undefined)?.binding;
  if (!binding || binding.mapping.size === 0) return DecorationSet.empty;
  const doc: PMNode = state.doc;
  const decorations: Decoration[] = [];
  for (const mark of input.marks) {
    const look = input.look(mark);
    const attrs: Record<string, string> = { style: `--hc: ${look.color}`, 'data-tip': look.tip, 'data-tip-plain': '' };
    if (mark.type === 'text') {
      const from = place(binding, mark.from);
      const to = place(binding, mark.to);
      if (from === null || to === null || to <= from || to > doc.content.size) continue;
      decorations.push(Decoration.inline(from, to, { ...attrs, class: `hist-${mark.kind}` }));
    } else {
      const at = place(binding, mark.at);
      const node = at === null ? null : doc.nodeAt(at);
      if (at === null || !node) continue;
      const cls = `hist-node hist-node-${mark.kind}${mark.block ? ' hist-block' : ''}`;
      decorations.push(Decoration.node(at, at + node.nodeSize, { ...attrs, class: cls, ...(look.label ? { 'data-hist-label': look.label } : {}) }));
    }
  }
  return DecorationSet.create(doc, decorations);
}

/** La extensión del editor de la versión con sus marcas (solo la usa el historial). */
export function historyMarksExtension(input: HistoryMarksInput) {
  // Las decoraciones se calculan una vez por documento (el editor es de solo lectura: cambia solo cuando
  // y-prosemirror dibuja la unión).
  let cache: { doc: PMNode; ready: boolean; set: DecorationSet } | null = null;
  const plugin = new Plugin<null>({
    key,
    props: {
      decorations: (state) => {
        const binding = (ySyncPluginKey.getState(state) as { binding?: Binding } | undefined)?.binding;
        const ready = !!binding && binding.mapping.size > 0;
        if (cache?.doc !== state.doc || cache.ready !== ready) cache = { doc: state.doc, ready, set: markDecorations(state, input) };
        return cache.set;
      },
    },
  });
  return createExtension({ key: 'shotdocs-history-marks', prosemirrorPlugins: [plugin] });
}
