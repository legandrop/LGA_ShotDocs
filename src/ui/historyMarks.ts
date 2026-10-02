import { createExtension, selectedFragmentToHTML, type BlockNoteEditor } from '@blocknote/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
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
      // El rótulo de un bloque con texto va al final de su renglón (no tapa nada ni se sale de la hoja); el de uno sin
      // texto (una imagen, una tabla), arriba a la derecha.
      const inline = !!look.label && node.isTextblock;
      decorations.push(
        Decoration.node(at, at + node.nodeSize, { ...attrs, class: cls, ...(look.label && !inline ? { 'data-hist-label': look.label } : {}) }),
      );
      if (inline) {
        const label = look.label!;
        decorations.push(
          Decoration.widget(
            at + node.nodeSize - 1,
            () => {
              const span = document.createElement('span');
              span.className = 'hist-label';
              span.contentEditable = 'false';
              span.setAttribute('style', `--hc: ${look.color}`);
              span.setAttribute('data-tip', look.tip);
              span.setAttribute('data-tip-plain', '');
              span.textContent = label;
              return span;
            },
            { side: 1, ignoreSelection: true, key: `hist-label:${at}:${label}` },
          ),
        );
      }
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

// --- Copiar con Show changes prendido -------------------------------------------------------------------------------
//
// Lo que se muestra es la unión: lo borrado es texto de verdad del documento, tachado solo por las decoraciones. Copiar
// tal cual se llevaría lo borrado (y el navegador, con un editor de solo lectura, copiaría los estilos de las marcas).
// Copiar (y cortar o arrastrar, que en solo lectura es lo mismo) entrega lo elegido SIN lo marcado como borrado: se arma
// un estado aparte, nunca despachado, sin esos tramos ni esos bloques, y se serializa como lo hace BlockNote.

/** Lo elegido en el editor: el rango de la selección del navegador si está adentro del editor; si no, el del editor. */
function chosenRange(view: EditorView): { from: number; to: number } | null {
  const sel = typeof window !== 'undefined' ? window.getSelection() : null;
  if (sel && !sel.isCollapsed && sel.anchorNode && sel.focusNode && view.dom.contains(sel.anchorNode) && view.dom.contains(sel.focusNode)) {
    try {
      const a = view.posAtDOM(sel.anchorNode, sel.anchorOffset);
      const b = view.posAtDOM(sel.focusNode, sel.focusOffset);
      if (a !== b) return { from: Math.min(a, b), to: Math.max(a, b) };
    } catch {
      // Una posición que el editor no conoce: se usa la suya.
    }
  }
  const { from, to } = view.state.selection;
  return from === to ? null : { from, to };
}

/** El estado del editor sin lo marcado como borrado, con lo elegido en el mismo lugar. `null` si no hay nada elegido. */
export function withoutDeleted(view: EditorView, input: HistoryMarksInput): EditorState | null {
  const state = view.state;
  const binding = (ySyncPluginKey.getState(state) as { binding?: Binding } | undefined)?.binding;
  const range = chosenRange(view);
  if (!binding || !range) return null;
  const doc = state.doc;
  const cuts: [number, number][] = [];
  for (const mark of input.marks) {
    if (mark.kind !== 'del') continue;
    if (mark.type === 'text') {
      const from = place(binding, mark.from);
      const to = place(binding, mark.to);
      if (from !== null && to !== null && to > from) cuts.push([from, to]);
      continue;
    }
    const at = place(binding, mark.at);
    const node = at === null ? null : doc.nodeAt(at);
    if (at === null || !node) continue;
    if (mark.block) {
      // El bloque entero, con sus hijos: el contenido está adentro de su `blockContainer`.
      const $at = doc.resolve(at);
      cuts.push($at.depth > 0 ? [$at.before(), $at.after()] : [at, at + node.nodeSize]);
    } else cuts.push([at, at + node.nodeSize]);
  }
  const tr = state.tr;
  // De atrás para adelante; lo que ya se fue con un bloque de afuera queda en cero.
  for (const [from, to] of cuts.sort((x, y) => y[0] - x[0])) {
    const a = tr.mapping.map(from, 1);
    const b = tr.mapping.map(to, -1);
    if (b > a) tr.deleteRange(a, b);
  }
  const from = tr.mapping.map(range.from, 1);
  const to = tr.mapping.map(range.to, -1);
  if (to <= from) return null;
  return EditorState.create({ doc: tr.doc, selection: TextSelection.between(tr.doc.resolve(from), tr.doc.resolve(to)) });
}

/** Lo que va al portapapeles (los mismos tres formatos que BlockNote), sin lo borrado. `null`: no hay nada elegido. */
export function cleanClipboard(editor: BlockNoteEditor<any, any, any>, view: EditorView, input: HistoryMarksInput) {
  const clean = withoutDeleted(view, input);
  if (!clean) return null;
  // El editor de verdad sirve para serializar; el estado (lo elegido y el documento) es el limpio.
  const shadow = new Proxy(view, {
    get(target, prop) {
      if (prop === 'state') return clean;
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  return selectedFragmentToHTML(shadow, editor);
}
