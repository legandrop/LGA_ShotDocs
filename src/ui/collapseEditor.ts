import { createExtension, type BlockNoteEditor, type ExtensionOptions } from '@blocknote/core';
import { Fragment, Slice, type Node as PMNode, type ResolvedPos } from '@tiptap/pm/model';
import { AddMarkStep, RemoveMarkStep, ReplaceStep, dropPoint, type Mappable } from '@tiptap/pm/transform';
import { AllSelection, NodeSelection, Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { ySyncPluginKey, yUndoPluginKey } from 'y-prosemirror';
import type * as Y from 'yjs';
import { t } from '../i18n';
import '../i18n/lazy/editor';
import {
  analyze,
  effective,
  headingLevel,
  headingsOf,
  headingTextEnd,
  hidesSomething,
  isCollapsed,
  preserveHidden,
  sectionAt,
  type Analysis,
  type BlockAt,
  type HeadingRecord,
  type Records,
  type Shared,
} from './collapse';
import { blockPos } from './blockHandle';
import { buildMove, dispatchMove, movingBlocks, recreatedRange, type BlockMove } from './blockMove';
import { IS_MAC, shortcutKeys, shortcutLabel } from './shortcuts';
import { hiddenInDom } from './collapseDom';
import { BACKGROUND_META, FIND_REPLACE_META } from './editorMeta';
import { isFindReplaceTransaction, setFindCollapseHooks, type FindCollapseHooks } from './findEditor';
import { isLetter, modPressed } from './findUi';
import { notify } from './notice';
import { PAGE_BREAK_PROP } from './editorSchema';
import { dropTarget, movedSelection, planKeyboardMove, planSectionDrag } from './sectionMove';

// Colapsar secciones por sus títulos (P.11, Docs/Doc_Colapsar.md), en el editor. Como las filas de fotos
// (imageRowsEditor.ts): un plugin de ProseMirror que calcula qué se esconde (collapse.ts) y lo dibuja con
// decoraciones. Nunca cambia el documento por colapsar o abrir; sí cuida lo que se edita al lado de lo
// escondido:
// - Lo escondido se borra solo a propósito (verificación de cbed5dc): (A) el título elegido entero (clic en los
//   puntos, o la sección, varios bloques, todo) y borrar, cortar, pegar o escribir encima: se va su sección entera, de
//   una vez (corrección 1); (B) una selección de texto que cruza la sección entera (empieza arriba del título y
//   termina después de lo escondido). Cualquier otra edición que borraría algo escondido no se hace: la sección
//   se abre y la tecla no hace nada.
// - Nada que se veía queda escondido sin querer: si pasa (propio o de otro), se abre para vos (corrección 2).
// - Un cambio propio (también deshacer) en algo escondido lo abre; uno de otro, no (corrección 3).
// - Si la selección queda en algo escondido: por un cambio del documento, se abre; si solo se movió, pasa al
//   final del título.
// - Enter al final de un título colapsado crea un renglón después de lo escondido, sin abrirlo (corrección
//   19); Supr ahí no hace nada; ↓ y → saltan lo escondido.
// Lo colapsado es de cada persona y dispositivo (collapseStore.ts): el plugin lo recibe al crear el editor y
// avisa cada cambio con `save`.

export interface CollapseState {
  /** Lo tuyo (de esta persona en este dispositivo). */
  records: ReadonlyMap<string, HeadingRecord>;
  /** Colapsado para todos (el mapa de la página, entrega 2). */
  shared: Shared;
  /** Lo que vale para vos: lo tuyo si lo hay; si no, lo de todos (`effective`). */
  merged: Records;
  analysis: Analysis;
  decorations: DecorationSet;
  /** La selección de ahora es la de Ctrl+A (la eligió el navegador justo después de la tecla). */
  selectAll?: boolean;
}

interface CollapseMeta {
  /** Lo guardado de cada título, entero (lo arma quien despacha). */
  records?: ReadonlyMap<string, HeadingRecord>;
  /** Colapsado para todos, entero (cambió el mapa de la página). */
  shared?: Shared;
}

export const collapseKey = new PluginKey<CollapseState>('shotdocs-collapse');

export interface CollapseOptions {
  /** Lo guardado en el dispositivo para esta página (se lee antes de crear el editor: no hay parpadeo). */
  initial?: ReadonlyMap<string, HeadingRecord>;
  /** Cada cambio de lo colapsado, para guardarlo. */
  save?: (records: ReadonlyMap<string, HeadingRecord>) => void;
  /**
   * Lo colapsado para todos (entrega 2): el mapa de la página, en el mismo Y.Doc que el contenido
   * (`SHARED_COLLAPSE_MAP`). Sin él, no hay "para todos".
   */
  shared?: Y.Map<unknown>;
  /** Si esta persona puede escribir el mapa: con permiso de editar la página, y los permisos conocidos. */
  canShare?: () => boolean;
}

export function collapseState(state: EditorState): CollapseState | undefined {
  return collapseKey.getState(state);
}

/**
 * Las decoraciones van en el contenido de cada bloque (`.bn-block-content`), no en el bloque: con cientos de
 * bloques escondidos, ProseMirror corre y dibuja las del bloque (todas en el mismo grupo) con un costo que crece
 * con el cuadrado (verificación, punto 3). El CSS esconde el bloque entero con `:has()`.
 */
function decorate(doc: PMNode, analysis: Analysis): DecorationSet {
  const decorations: Decoration[] = [];
  eachDecoration(analysis, (key, from, to, attrs) => decorations.push(Decoration.node(from, to, attrs, { key })));
  return DecorationSet.create(doc, decorations);
}

function build(doc: PMNode, records: ReadonlyMap<string, HeadingRecord>, shared: Shared): CollapseState {
  const merged = effective(records, shared);
  const analysis = analyze(doc, merged);
  return { records, shared, merged, analysis, decorations: decorate(doc, analysis) };
}

/** Cada decoración que corresponde a lo calculado, con una clave (el bloque, y quién lo esconde). */
function eachDecoration(analysis: Analysis, fn: (key: string, from: number, to: number, attrs: Record<string, string>) => void): void {
  const onContent = (at: BlockAt | undefined, key: string, attrs: Record<string, string>) => {
    const content = at?.node.firstChild;
    if (at && content) fn(key, at.pos + 1, at.pos + 1 + content.nodeSize, attrs);
  };
  for (const id of analysis.collapsed) onContent(analysis.blocks.get(id), `c:${id}`, { class: 'sd-collapsed', 'data-sd-collapsed': 'true' });
  for (const top of analysis.top) onContent(analysis.blocks.get(top.id), `h:${top.id}:${top.hider}`, { class: 'sd-collapsed-hidden', 'data-sd-hider': top.hider });
}

/**
 * Las decoraciones de antes, corridas con la transacción, con solo lo que cambió sacado o agregado (verificación
 * de cbed5dc, punto 6): rearmarlas todas costaba decenas de milisegundos por Enter en una página grande
 * colapsada.
 */
function redecorate(old: DecorationSet, tr: Transaction, analysis: Analysis): DecorationSet {
  const mapped = tr.docChanged ? old.map(tr.mapping, tr.doc) : old;
  const present = new Map<string, Decoration>();
  for (const d of mapped.find()) present.set((d.spec as { key: string }).key, d);
  const remove: Decoration[] = [];
  const add: Decoration[] = [];
  const wanted = new Set<string>();
  eachDecoration(analysis, (key, from, to, attrs) => {
    wanted.add(key);
    const d = present.get(key);
    if (d && d.from === from && d.to === to) return;
    if (d) remove.push(d);
    add.push(Decoration.node(from, to, attrs, { key }));
  });
  for (const [key, d] of present) if (!wanted.has(key)) remove.push(d);
  let out = remove.length ? mapped.remove(remove) : mapped;
  if (add.length) out = out.add(tr.doc, add);
  return out;
}

/** Lo que dice y-prosemirror de una transacción: si vino de Yjs (de otro, o deshacer) y si es deshacer. */
function yjsOrigin(tr: Transaction): { fromYjs: boolean; undo: boolean } {
  const meta = tr.getMeta(ySyncPluginKey as never) as { isChangeOrigin?: boolean; isUndoRedoOperation?: boolean } | undefined;
  const fromYjs = !!meta?.isChangeOrigin;
  return { fromYjs, undo: fromYjs && !!meta?.isUndoRedoOperation };
}

/** Deshacer o rehacer una entrada de la pila marcada por la búsqueda (corrección 18). */
function taggedUndo(state: EditorState): boolean {
  const undo = yUndoPluginKey.getState(state as never) as { undoManager?: { currStackItem?: { meta?: Map<unknown, unknown> } | null } } | undefined;
  return !!undo?.undoManager?.currStackItem?.meta?.get(FIND_REPLACE_META);
}

/** Si lo colapsado cambió entre dos mapas (para no guardar ni avisar de más). */
function sameRecords(a: ReadonlyMap<string, HeadingRecord>, b: ReadonlyMap<string, HeadingRecord>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [id, r] of a) {
    const o = b.get(id);
    if (!o || o.c !== r.c || o.g !== r.g || o.e !== r.e) return false;
  }
  return true;
}

/**
 * Después de un cambio propio (no de Yjs) en la estructura:
 * - un título al que se le cambió el id (BlockNote lo hace al juntar ids repetidos) conserva lo colapsado con el
 *   id nuevo (auditoría, punto 2);
 * - el fin de un título colapsado que se borró pasa al bloque que quedó en su lugar (corrección 19). Si no hay
 *   ninguno, o el cambio vino de Yjs (deshacer, otro), el fin se queda con su id: deshacer y rehacer lo trae de
 *   vuelta (auditoría, punto 4).
 */
function remapRecords(tr: Transaction, old: CollapseState, records: ReadonlyMap<string, HeadingRecord>): ReadonlyMap<string, HeadingRecord> {
  if (records.size === 0 && old.shared.size === 0) return records;
  const ids = blockIds(tr.doc);
  const local = !yjsOrigin(tr).fromYjs;
  let out: Map<string, HeadingRecord> | null = null;
  const edit = () => (out ??= new Map(records));
  // También un título colapsado solo para todos: con el id nuevo pasa a ser tuyo (el mapa no se toca).
  for (const [id, record] of effective(records, old.shared)) {
    if (ids.has(id) || !local) continue;
    const was = old.analysis.blocks.get(id);
    if (!was) continue;
    // El texto del título sigue (no se borró): el bloque es el mismo, con otro id.
    if (tr.mapping.mapResult(was.pos + 2).deletedAcross) continue;
    const node = tr.doc.nodeAt(tr.mapping.map(was.pos));
    const renamed = node?.type.name === 'blockContainer' ? String(node.attrs.id ?? '') : '';
    if (!renamed || renamed === id || old.analysis.blocks.has(renamed) || headingLevel(node!) === null) continue;
    edit().delete(id);
    edit().set(renamed, { ...record });
  }
  for (const [id, record] of out ?? records) {
    if (!record.e || ids.has(record.e) || !local) continue;
    const was = old.analysis.blocks.get(record.e);
    if (!was) continue;
    const node = tr.doc.nodeAt(tr.mapping.map(was.pos));
    if (node?.type.name !== 'blockContainer' || !node.attrs.id) continue;
    edit().set(id, { ...record, e: String(node.attrs.id) });
  }
  return out ?? records;
}

function blockIds(doc: PMNode): Set<string> {
  const ids = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name === 'blockContainer') {
      if (node.attrs.id) ids.add(String(node.attrs.id));
      return true;
    }
    return node.type.name === 'blockGroup' || node.type.name === 'doc';
  });
  return ids;
}

/** El bloque escondido donde cae una posición (el de más adentro), o `null`. */
function hiddenBlockAt(analysis: Analysis, $pos: ResolvedPos): string | null {
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.name !== 'blockContainer') continue;
    const id = String(node.attrs.id ?? '');
    if (analysis.hidden.has(id)) return id;
  }
  return null;
}

/** Los bloques escondidos donde cae la selección (una selección de bloque entero cuenta ese bloque). */
function hiddenInSelection(analysis: Analysis, sel: Selection): { head: string | null; anchor: string | null } {
  if (sel instanceof NodeSelection) {
    const node = sel.node.type.name === 'blockContainer' ? sel.node : null;
    const own = node ? String(node.attrs.id ?? '') : '';
    const id = own && analysis.hidden.has(own) ? own : hiddenBlockAt(analysis, sel.$from);
    return { head: id, anchor: id };
  }
  return { head: hiddenBlockAt(analysis, sel.$head), anchor: hiddenBlockAt(analysis, sel.$anchor) };
}

/**
 * Abre, para vos, un título colapsado. Si tenía un fin (Enter después de él), los títulos colapsados de adentro
 * que llegarían más allá lo heredan: lo que se veía después del fin se sigue viendo (auditoría, punto 3).
 */
function openRecord(doc: PMNode, records: Map<string, HeadingRecord>, analysis: Analysis, id: string, shared: Shared, explicit = false): void {
  const record = records.get(id) ?? (shared.has(id) ? { c: true, g: null } : undefined);
  // Abrir con un clic queda como tuyo, aunque después cambie lo de todos (decisión 17). Lo que se abre solo (una
  // edición, "Ir al bloque", la búsqueda) borra lo tuyo, salvo que esté colapsado para todos.
  if (explicit || shared.has(id)) records.set(id, { c: false, g: null });
  else records.delete(id);
  if (!record?.e) return;
  for (const [inner, hider] of analysis.hidden) {
    if (hider !== id || !analysis.collapsed.has(inner)) continue;
    const at = analysis.blocks.get(inner);
    const innerRecord = records.get(inner) ?? (shared.has(inner) ? { c: true, g: null } : undefined);
    if (!at || !innerRecord || innerRecord.e) continue;
    // Su sección llega hasta el fin del de afuera (o más): corta ahí.
    const section = sectionAt(doc, at.pos, innerRecord);
    if (section?.siblings.some((s) => s.node.attrs.id === record.e)) records.set(inner, { ...innerRecord, e: record.e });
  }
}

/** Abre, para vos, todos los títulos que esconden `blockId` (de afuera hacia adentro). */
function revealIn(doc: PMNode, records: Map<string, HeadingRecord>, blockId: string, shared: Shared): Analysis {
  let analysis = analyze(doc, effective(records, shared));
  for (let guard = 0; guard < 64 && analysis.hidden.has(blockId); guard++) {
    openRecord(doc, records, analysis, analysis.hidden.get(blockId)!, shared);
    analysis = analyze(doc, effective(records, shared));
  }
  return analysis;
}

/** Borra bloques por id (los de más afuera); un grupo que queda vacío se saca, y la página, si queda sin nada, queda con un párrafo vacío. */
function deleteBlocks(tr: Transaction, ids: ReadonlySet<string>): void {
  if (ids.size === 0) return;
  const ranges: { from: number; to: number }[] = [];
  const visit = (group: PMNode, groupPos: number, root: boolean) => {
    let pos = groupPos + 1;
    const doomed: { from: number; to: number }[] = [];
    group.forEach((kid) => {
      const from = pos;
      pos += kid.nodeSize;
      if (ids.has(String(kid.attrs.id ?? ''))) {
        doomed.push({ from, to: pos });
        return;
      }
      const children = kid.childCount > 1 ? kid.lastChild : null;
      if (children?.type.name === 'blockGroup') visit(children, from + 1 + kid.firstChild!.nodeSize, false);
    });
    if (doomed.length === 0) return;
    if (doomed.length === group.childCount) {
      if (root) ranges.push({ from: -1, to: -1 });
      else ranges.push({ from: groupPos, to: groupPos + group.nodeSize });
    } else ranges.push(...doomed);
  };
  const root = tr.doc.firstChild;
  if (!root) return;
  visit(root, 0, true);
  if (ranges.some((r) => r.from < 0)) {
    // La página entera: queda un párrafo vacío (BlockNote necesita al menos un bloque).
    const schema = tr.doc.type.schema;
    const empty = schema.nodes.blockContainer.create({ id: newBlockId() }, schema.nodes.paragraph.create());
    tr.replaceWith(1, 1 + root.content.size, empty);
    return;
  }
  ranges.sort((a, b) => b.from - a.from);
  for (const r of ranges) tr.delete(r.from, r.to);
}

function newBlockId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Si una transacción propia (no de Yjs) borró el texto del título que empezaba en `textStart`: el bloque se fue
 * con su texto. No cuenta juntarlo con el de arriba (el texto queda) ni cambiarle solo el id.
 */
function textDeleted(trs: readonly Transaction[], plain: ReadonlySet<Transaction>, textStart: number): boolean {
  let at = textStart;
  for (const tr of trs) {
    const result = tr.mapping.mapResult(at);
    if (plain.has(tr) && result.deletedAcross) return true;
    at = result.pos;
  }
  return false;
}

/**
 * Una selección de bloques enteros (el bloque elegido, la sección, varios bloques, todo): lo que abarca. BlockNote
 * elige el contenido del bloque (el `heading`), no el bloque: cuenta el bloque.
 */
function blockRange(sel: Selection): { from: number; to: number } | null {
  if (sel instanceof AllSelection) return { from: 0, to: sel.$from.doc.content.size };
  if (sel instanceof NodeSelection) {
    if (sel.node.type.name === 'blockContainer') return { from: sel.from, to: sel.to };
    const $from = sel.$from;
    return $from.parent.type.name === 'blockContainer' ? { from: $from.before(), to: $from.after() } : null;
  }
  if (sel instanceof SectionSelection || (sel.toJSON() as { type?: string }).type === 'multiple-node') return { from: sel.from, to: sel.to };
  return null;
}

/**
 * Si la selección es la página entera de Ctrl+A: el navegador elige todo y ProseMirror lo toma como texto, así que
 * se mira además que la selección haya llegado justo después de la tecla (`selectAll`, verificación de fbaef68).
 * Elegir de punta a punta con el mouse o con Shift+flechas no cuenta: si borraría algo escondido sin cruzar la
 * sección entera, no se hace.
 */
function selectsAll(sel: Selection, state: EditorState): boolean {
  if (sel instanceof AllSelection) return true;
  if (sel.empty || !collapseKey.getState(state)?.selectAll) return false;
  const doc = sel.$from.doc;
  return sel.from <= Selection.atStart(doc).from && sel.to >= Selection.atEnd(doc).to;
}

const covers = (range: { from: number; to: number }, at: BlockAt) => range.from <= at.pos && range.to >= at.pos + at.node.nodeSize;

/**
 * (A) Si la persona quiso borrar el título entero: la selección de antes de la edición abarcaba el bloque entero
 * (el bloque elegido con los puntos, la sección elegida para cortar, varios bloques, todo). Una
 * selección de texto nunca: si cruza la sección entera (B), lo escondido ya se borró con ella; si no, lo
 * escondido queda y se abre (verificación de cbed5dc, puntos 2 y 3).
 */
function meantToDelete(at: BlockAt, selection: Selection): boolean {
  const range = blockRange(selection);
  return !!range && covers(range, at);
}

/**
 * Los bloques escondidos que una transacción propia borraría sin que la persona lo haya querido (verificación de
 * cbed5dc). Se pueden borrar solo (A) con una selección de bloques enteros que abarca el título que los esconde
 * (o el bloque mismo) o toda la página; (B) con una selección de texto que empieza antes del título
 * (en un bloque de arriba) y termina en un bloque después de todo lo que esconde. No cuentan los cambios de Yjs
 * (de otro, deshacer), la búsqueda, lo que hace la app sola, lo que agregan los plugins, ni mover bloques (el id
 * queda).
 */
function hiddenLost(tr: Transaction, state: EditorState): string[] {
  const s = collapseKey.getState(state);
  if (!s || s.analysis.hidden.size === 0 || !tr.docChanged) return [];
  if (tr.getMeta(ySyncPluginKey as never) || tr.getMeta('appendedTransaction') || isFindReplaceTransaction(tr)) return [];
  if (tr.getMeta(BACKGROUND_META) || tr.getMeta(collapseKey) || textOnly(tr)) return [];
  const ids = blockIds(tr.doc);
  const lost = [...s.analysis.hidden.keys()].filter((id) => !ids.has(id));
  if (lost.length === 0) return [];
  const sel = state.selection;
  if (selectsAll(sel, state)) return [];
  const range = blockRange(sel);
  const ends = new Map<string, number>();
  /** Dónde termina lo que esconde un título (él con sus hijos, y sus hermanos escondidos). */
  const hiddenEnd = (hider: string, at: BlockAt) => {
    let end = ends.get(hider);
    if (end === undefined) {
      end = at.pos + at.node.nodeSize;
      for (const top of s.analysis.top) if (top.hider === hider) end = Math.max(end, top.pos + top.size);
      ends.set(hider, end);
    }
    return end;
  };
  return lost.filter((id) => {
    const hider = s.analysis.hidden.get(id)!;
    const at = s.analysis.blocks.get(hider);
    const own = s.analysis.blocks.get(id);
    if (!at) return false;
    if (range) return !(covers(range, at) || (own && covers(range, own)));
    if (!(sel instanceof TextSelection)) return true;
    return !(sel.from < at.pos && sel.to > hiddenEnd(hider, at));
  });
}

/**
 * Una edición que no se hizo: abre, para vos, lo que escondía cada uno de estos bloques y deja la selección vacía
 * al principio de lo elegido, en la misma transacción. Así una composición del teclado (una tecla muerta, el
 * teclado del teléfono) no sigue sobre la misma selección, ahora a la vista (verificación de fbaef68, punto B1).
 */
function revealAndCollapse(view: EditorView, ids: readonly string[]): void {
  const state = collapseKey.getState(view.state);
  if (!state) return;
  const records = new Map(state.records);
  let analysis = state.analysis;
  for (const id of ids) if (analysis.hidden.has(id)) analysis = revealIn(view.state.doc, records, id, state.shared);
  const tr = view.state.tr;
  if (!sameRecords(records, state.records)) tr.setMeta(collapseKey, { records } satisfies CollapseMeta);
  const sel = view.state.selection;
  if (!sel.empty) tr.setSelection(Selection.near(view.state.doc.resolve(sel.from)));
  if (tr.selectionSet || tr.getMeta(collapseKey)) view.dispatch(tr);
}

/**
 * Los bloques recién abiertos por una edición que no se hizo, que por un rato (un segundo, o mientras dure la
 * composición del teclado) no se pueden borrar con lo que llega de la pantalla en medio de una composición: el
 * navegador puede volver a aplicar la composición sobre la selección de antes (verificación de fbaef68, B1).
 */
interface Guard {
  ids: Set<string>;
  until: number;
}

function guardedLost(guard: Guard, view: EditorView | null, tr: Transaction, state: EditorState): string[] {
  if (!tr.docChanged || tr.getMeta(ySyncPluginKey as never) || tr.getMeta('appendedTransaction')) return [];
  if (tr.getMeta('composition') === undefined && !view?.composing) return [];
  const now = blockIds(tr.doc);
  const before = blockIds(state.doc);
  return [...guard.ids].filter((id) => before.has(id) && !now.has(id));
}

/**
 * Si un bloque escondido cambió de verdad. No cuenta que la app le ponga la dirección a una foto al terminar de
 * guardarla (el bloque `image` con otra `url` o `name` y nada más; auditoría, punto 9).
 */
function changedByPerson(before: PMNode, after: PMNode): boolean {
  if (before === after || before.eq(after)) return false;
  const a = before.firstChild;
  const b = after.firstChild;
  if (!a || !b || a.type.name !== 'image' || b.type.name !== 'image' || before.childCount !== after.childCount) return true;
  if (before.childCount > 1 && !before.lastChild!.eq(after.lastChild!)) return true;
  const strip = (attrs: Record<string, unknown>) => {
    const { url: _u, name: _n, ...rest } = attrs;
    return JSON.stringify(rest);
  };
  return strip(a.attrs) !== strip(b.attrs) || JSON.stringify(before.attrs) !== JSON.stringify(after.attrs);
}

function appendCollapse(trs: readonly Transaction[], oldState: EditorState, newState: EditorState): Transaction | null {
  const before = collapseKey.getState(oldState);
  const after = collapseKey.getState(newState);
  if (!before || !after) return null;
  const docChanged = trs.some((tr) => tr.docChanged);
  // Deshacer o rehacer un mover de la 1b: se esconde lo mismo que antes (el fin de cada título se ajusta), como
  // al mover; si no se puede, manda lo de siempre (lo que quedó escondido se abre).
  const preserved =
    docChanged && !trs.some((tr) => tr.getMeta(collapseKey)) && trs.some((tr) => yjsOrigin(tr).undo) && taggedMoveUndo(newState)
      ? preserveHidden(newState.doc, after.records, after.shared, before.analysis.hidden)
      : null;
  const ownAction = trs.some((tr) => tr.getMeta(collapseKey)) || preserved !== null;
  if (!docChanged && !ownAction && !trs.some((tr) => tr.selectionSet)) return null;

  // Qué transacciones son de la persona (no de otro por Yjs; deshacer sí cuenta) y cuáles no abren nada.
  const plain = new Set<Transaction>();
  let local = false;
  let untagged = false;
  let pasted = false;
  for (const tr of trs) {
    if (!tr.docChanged) continue;
    // Lo que agrega otro plugin (UniqueID arregla ids repetidos) es como lo que lo causó: de Yjs, de la búsqueda.
    const origin = (tr.getMeta('appendedTransaction') as Transaction | undefined) ?? tr;
    const { fromYjs, undo } = yjsOrigin(origin);
    // Los reemplazos de la búsqueda ("Reemplazar todo" escribe en el Y.Doc y llega como de Yjs) y su deshacer no
    // abren nada (corrección 18); tampoco lo que hace la app sola (corrección 10).
    if (isFindReplaceTransaction(origin) || origin.getMeta(BACKGROUND_META) || (undo && taggedUndo(newState))) continue;
    untagged = true;
    if (!fromYjs) plain.add(tr);
    if (!fromYjs || undo) local = true;
    const ui = origin.getMeta('uiEvent');
    if (origin.getMeta('paste') || ui === 'paste' || ui === 'drop') pasted = true;
  }

  const tr = newState.tr;
  const records = new Map(preserved ?? after.records);
  const shared = after.shared;
  const seen = () => effective(records, shared);

  // Escribir en un renglón (lo más común) no saca ni mueve bloques: no hay nada que borrar ni avisar.
  const structural = [...plain].some((t) => !textOnly(t));

  // 1. Un título colapsado que la persona borró a propósito (con su texto): se va su sección entera, en la
  // misma pasada (un solo Ctrl+Z). Si el título se fue de otra manera (se juntó con otro bloque, una selección
  // tomó solo parte de su texto), lo que escondía no se borra nunca: se abre.
  const doomed = new Set<string>();
  const orphaned = new Set<string>();
  if (structural) {
    for (const id of before.analysis.collapsed) {
      // Solo un título que se veía: lo que esconde uno escondido lo decide el de afuera.
      // Un título al que solo se le cambió el id (su estado pasó al id nuevo) no se borró.
      if (before.analysis.hidden.has(id) || after.analysis.blocks.has(id) || !after.merged.has(id)) continue;
      const at = before.analysis.blocks.get(id);
      if (!at) continue;
      const meant = textDeleted(trs, plain, at.pos + 2) && meantToDelete(at, oldState.selection);
      // Solo lo que ese título escondía (nunca algo que se veía, aunque sea de su sección: el fin).
      for (const [sid, hider] of before.analysis.hidden) {
        if (hider === id && after.analysis.blocks.has(sid)) (meant ? doomed : orphaned).add(sid);
      }
    }
    deleteBlocks(tr, doomed);
  }

  let analysis = tr.docChanged || preserved ? analyze(tr.doc, seen()) : after.analysis;
  const reveal = new Set<string>(orphaned);

  if (docChanged && !ownAction) {
    // 2. Lo que se veía y quedó escondido (propio o de otro) abre lo que lo esconde.
    if (untagged) {
      for (const [id, hider] of analysis.hidden) {
        if (!before.analysis.blocks.has(id)) continue;
        if (before.analysis.hidden.has(id)) continue;
        // El último renglón vacío de la página, justo después de una sección colapsada, al escribirle: pasa a
        // ser el fin de ese título, como con Enter (auditoría, punto 5).
        const hiderRecord = seen().get(hider);
        if (wasTrailingLine(oldState.doc, id) && hiderRecord && !hiderRecord.e) {
          records.set(hider, { ...hiderRecord, e: id });
          analysis = analyze(tr.doc, seen());
          continue;
        }
        reveal.add(id);
      }
    }
    // 3. Un cambio propio (también deshacer) en algo escondido lo abre.
    if (local) {
      for (const [id, at] of before.analysis.blocks) {
        if (!before.analysis.hidden.has(id)) continue;
        const now = after.analysis.blocks.get(id);
        if (now && changedByPerson(at.node, now.node)) reveal.add(id);
      }
    }
  }

  // Lo escondido que se borró con una edición propia: un aviso (se deshace con Ctrl+Z).
  if (structural) {
    const gone = [...before.analysis.hidden.keys()].some((id) => !analysis.blocks.has(id));
    if (gone) notify(t('collapse.deletedHidden', { shortcut: shortcutLabel('undo') }));
  }

  for (const id of reveal) {
    if (analysis.hidden.has(id)) analysis = revealIn(tr.doc, records, id, shared);
  }
  // Lo que escondía un título que sigue colapsado a la vista y ahora esconde otro título que ya se veía (se movió
  // el título, con el tirador o con Shift+Ctrl+flechas) se ve: hasta la entrega 1b, que mueve la sección entera
  // (verificación de cbed5dc, punto 5). Se abre lo que lo esconde ahora, hasta que se vea o lo esconda de nuevo el
  // de antes. Un título de adentro que queda a la vista (estaba escondido) conserva lo suyo.
  if (docChanged && !ownAction && untagged) {
    for (const [id, now] of [...analysis.hidden]) {
      const was = before.analysis.hidden.get(id);
      if (was === undefined || was === now || before.analysis.hidden.has(now)) continue;
      if (!analysis.collapsed.has(was) || analysis.hidden.has(was)) continue;
      for (let guard = 0; guard < 64; guard++) {
        const hider = analysis.hidden.get(id);
        if (!hider || hider === was) break;
        openRecord(tr.doc, records, analysis, hider, shared);
        analysis = analyze(tr.doc, seen());
      }
    }
  }

  // La selección no queda en algo escondido: si fue por un cambio del documento, se abre; si no, pasa al final
  // del título que lo esconde.
  const sel = tr.selection;
  // Ni la sección elegida, ni varios bloques, ni la página entera (Ctrl+A, que llega hasta lo escondido del final).
  if (!(sel instanceof SectionSelection) && (sel.toJSON() as { type?: string }).type !== 'multiple-node' && !selectsAll(sel, newState)) {
    const inside = hiddenInSelection(analysis, sel);
    if (inside.head || inside.anchor) {
      if (docChanged && local) {
        for (const id of [inside.head, inside.anchor]) if (id && analysis.hidden.has(id)) analysis = revealIn(tr.doc, records, id, shared);
      } else {
        const target = (id: string | null, fallback: number) => {
          const hider = id ? analysis.hidden.get(id) : undefined;
          const at = hider ? analysis.blocks.get(hider) : undefined;
          return at ? headingTextEnd(at) : fallback;
        };
        const anchor = target(inside.anchor, sel.anchor);
        const head = target(inside.head, sel.head);
        tr.setSelection(TextSelection.create(tr.doc, anchor, head));
      }
    }
  }

  // Un título plegable de BlockNote pegado (`<details><summary><hN>`) queda como título común (corrección 16).
  if (pasted) normalizeToggles(tr, blockIds(oldState.doc));

  const recordsChanged = !sameRecords(records, after.records);
  if (recordsChanged) tr.setMeta(collapseKey, { records } satisfies CollapseMeta);
  return tr.docChanged || recordsChanged || tr.selectionSet ? tr : null;
}

/** Si el bloque era el último de la página y un párrafo vacío (el lugar para seguir escribiendo). */
function wasTrailingLine(doc: PMNode, id: string): boolean {
  const last = doc.firstChild?.lastChild;
  const content = last?.firstChild;
  return !!last && last.attrs.id === id && last.childCount === 1 && content?.type.name === 'paragraph' && content.content.size === 0;
}

function normalizeToggles(tr: Transaction, existing: ReadonlySet<string>): void {
  tr.doc.descendants((node, pos) => {
    if (node.type.name === 'blockContainer') {
      const content = node.firstChild;
      if (content?.type.name === 'heading' && content.attrs.isToggleable === true && !existing.has(String(node.attrs.id ?? ''))) {
        tr.setNodeAttribute(pos + 1, 'isToggleable', false);
      }
      return true;
    }
    return node.type.name === 'blockGroup' || node.type.name === 'doc';
  });
}

// --- Acciones (el triángulo, el atajo, el menú de la página, "Ir al bloque") -------------------------------

function dispatchRecords(view: EditorView, records: Map<string, HeadingRecord>): void {
  view.dispatch(view.state.tr.setMeta(collapseKey, { records } satisfies CollapseMeta));
}

/** Colapsa o abre, para vos, estos títulos. Colapsar empieza de cero (sin el fin de un Enter anterior). */
export function setCollapsed(view: EditorView, ids: readonly string[], collapsed: boolean): void {
  const state = collapseKey.getState(view.state);
  if (!state) return;
  const records = new Map(state.records);
  for (const id of ids) {
    if (collapsed) records.set(id, { c: true, g: null });
    else openRecord(view.state.doc, records, state.analysis, id, state.shared, true);
  }
  if (!sameRecords(records, state.records)) dispatchRecords(view, records);
}

export function toggleCollapsed(view: EditorView, id: string): void {
  const state = collapseKey.getState(view.state);
  if (!state) return;
  setCollapsed(view, [id], !isCollapsed(state.merged.get(id)));
}

/** Colapsa o abre todos los títulos de la página (para vos). */
export function setAllCollapsed(view: EditorView, collapsed: boolean): void {
  const state = collapseKey.getState(view.state);
  if (!state) return;
  // Lo tuyo en todos los títulos (Doc_Colapsar.md §4): un cambio de otro para todos no los mueve.
  setCollapsed(
    view,
    headingsOf(view.state.doc).map((h) => h.id),
    collapsed,
  );
}

/** Abre, para vos, lo que esconde un bloque. Devuelve si estaba escondido. */
export function revealBlock(view: EditorView, blockId: string): boolean {
  const state = collapseKey.getState(view.state);
  if (!state?.analysis.hidden.has(blockId)) return false;
  const records = new Map(state.records);
  revealIn(view.state.doc, records, blockId, state.shared);
  dispatchRecords(view, records);
  return true;
}

// --- Abrir por la búsqueda (decisión D11 de Lega, 2026-10-02; Docs/Doc_Buscar.md) ----------------------------
//
// Al buscar en la página, las secciones colapsadas que esconden coincidencias se abren para que se vean, solo en
// este dispositivo y solo a la vista: lo que se abre así es de la persona (nunca se escribe el mapa "para todos") y
// no se guarda en el dispositivo; al terminar la búsqueda (o si lo buscado ya no está ahí) se vuelve a lo de antes.
// Lo que la persona toca mientras tanto (el triángulo, o dejar la selección adentro) pasa a ser suyo y no se vuelve
// a cerrar. Va por los mismos `records` que el resto del colapso (así todas las reglas de edición valen igual); la
// sesión recuerda qué cambió cada apertura (`prev`, lo de antes; `set`, lo que quedó) para devolverlo.

interface Held {
  /** Lo que había antes de abrir (`undefined`: nada tuyo). */
  prev: HeadingRecord | undefined;
  /** Lo que quedó al abrir: si ya no es este mismo objeto, la persona lo tocó. */
  set: HeadingRecord | undefined;
}

interface SearchSession {
  held: Map<string, Held>;
  /** Títulos que la persona tocó durante esta búsqueda: la búsqueda no los vuelve a abrir (salvo al ir a una coincidencia). */
  touched: Set<string>;
  /** Los bloques con coincidencias de la última vez. */
  wanted: ReadonlySet<string>;
  /** Lo colapsado justo después del último paso: lo que cambie después, lo cambió la persona. */
  seen: ReadonlyMap<string, HeadingRecord>;
  /** Los títulos que abrió la última vez (el aviso cuenta los que siguen abiertos por ella). */
  openedIds: ReadonlySet<string>;
  /** Lo colapsado para todos justo después del último paso: si cambia, el título pasó a ser de la persona (Shift+clic). */
  seenShared: Shared;
}

const sessions = new WeakMap<EditorView, SearchSession>();

/**
 * Lo que se guarda en el dispositivo: lo tuyo sin lo que abrió la búsqueda y nadie tocó (si la ventana se cierra
 * en medio de una búsqueda, la página no vuelve a abrirse con eso abierto).
 */
function persistable(view: EditorView, records: ReadonlyMap<string, HeadingRecord>, shared?: Shared): ReadonlyMap<string, HeadingRecord> {
  const session = sessions.get(view);
  if (!session || session.held.size === 0) return records;
  const out = new Map(records);
  for (const [id, h] of session.held) {
    // Un Shift+clic (colapsar o abrir para todos) deja sin registro tuyo, igual que lo que abrió la búsqueda: no es
    // "nadie lo tocó".
    if (out.get(id) !== h.set || (shared && session.seenShared.has(id) !== shared.has(id))) continue;
    if (h.prev) out.set(id, h.prev);
    else out.delete(id);
  }
  return out;
}

/**
 * Cuántas secciones tiene abiertas ahora la búsqueda (para el aviso de la barra): las que abrió y siguen como las dejó
 * (si la persona las colapsó, las abrió ella o las pasó a "para todos", ya no cuentan).
 */
export function searchOpenedCount(view: EditorView): number {
  const session = sessions.get(view);
  const state = collapseKey.getState(view.state);
  if (!session || !state) return 0;
  let n = 0;
  for (const id of session.openedIds) {
    const h = session.held.get(id);
    if (h && state.records.get(id) === h.set && session.seenShared.has(id) === state.shared.has(id) && !isCollapsed(state.merged.get(id))) n++;
  }
  return n;
}

/**
 * Deja abiertas, para vos, las secciones que esconden estos bloques (las coincidencias de la búsqueda) y vuelve
 * a como estaban las que abrió antes y ya no hacen falta, salvo las que la persona tocó o donde está la selección.
 * Con `end` termina la búsqueda: todo vuelve (menos lo tocado). `force`: bloques que se muestran aunque la persona
 * haya cerrado lo que los esconde (ir a una coincidencia con Enter). Devuelve si cambió algo y cuántas abrió.
 */
export function syncSearchOpen(
  view: EditorView,
  wanted: ReadonlySet<string>,
  { end = false, force }: { end?: boolean; force?: ReadonlySet<string> } = {},
): { changed: boolean; opened: number } {
  const state = collapseKey.getState(view.state);
  let session = sessions.get(view);
  if (!state || (!session && (end || wanted.size === 0))) return { changed: false, opened: 0 };
  if (!session) sessions.set(view, (session = { held: new Map(), touched: new Set(), wanted, seen: state.records, openedIds: new Set(), seenShared: state.shared }));
  const doc = view.state.doc;
  const current = state.records;
  const shared = state.shared;

  // 0. Lo que cambió desde el último paso lo cambió la persona (el triángulo, Colapsar todo...): es suyo.
  if (current !== session.seen) {
    for (const id of new Set([...current.keys(), ...session.seen.keys()])) {
      const a = current.get(id);
      const b = session.seen.get(id);
      if (a !== b && !(a && b && a.c === b.c && a.e === b.e)) session.touched.add(id);
    }
  }

  // 1. Lo que abrió la búsqueda y nadie tocó vuelve a lo de antes; lo tocado pasa a ser de la persona.
  const base = new Map(current);
  const heldBefore = [...session.held.keys()];
  for (const [id, h] of session.held) {
    if (base.get(id) !== h.set || session.seenShared.has(id) !== shared.has(id)) {
      session.touched.add(id);
      continue;
    }
    if (h.prev) base.set(id, h.prev);
    else base.delete(id);
  }
  session.held.clear();

  // 2. La selección no queda en algo que se vuelve a esconder: ese título se queda abierto (es de la persona).
  if (base.size !== current.size || [...base].some(([id, r]) => current.get(id) !== r)) {
    let analysis = analyze(doc, effective(base, shared));
    for (let guard = 0; guard < 64; guard++) {
      const inside = hiddenInSelection(analysis, view.state.selection);
      const id = inside.head ?? inside.anchor;
      const hider = id ? analysis.hidden.get(id) : undefined;
      if (!hider) break;
      const kept = current.get(hider);
      if (kept) base.set(hider, kept);
      else base.delete(hider);
      session.touched.add(hider);
      analysis = analyze(doc, effective(base, shared));
    }
  }
  const restored = new Map(base);

  // 3. Se abre lo que esconde cada coincidencia (de afuera hacia adentro), menos lo que la persona cerró.
  const openedNow = new Set<string>();
  if (!end) {
    let analysis = analyze(doc, effective(base, shared));
    for (const id of wanted) {
      for (let guard = 0; guard < 64; guard++) {
        const hider = analysis.hidden.get(id);
        if (!hider) break;
        if (session.touched.has(hider)) {
          if (!force?.has(id)) break;
          session.touched.delete(hider);
        }
        openRecord(doc, base, analysis, hider, shared);
        openedNow.add(hider);
        analysis = analyze(doc, effective(base, shared));
      }
    }
  }
  for (const id of new Set([...restored.keys(), ...base.keys()])) {
    if (restored.get(id) !== base.get(id)) session.held.set(id, { prev: restored.get(id), set: base.get(id) });
  }
  const changed = !sameRecords(base, current);
  // Sin cambios de valor se conservan los objetos de ahora (así la próxima vez se sabe que nadie los tocó).
  if (!changed) for (const [id, h] of session.held) h.set = current.get(id);
  session.wanted = wanted;
  session.seen = changed ? base : current;
  session.seenShared = shared;
  session.openedIds = openedNow;
  if (changed) dispatchRecords(view, base);
  // Lo que pasó a ser de la persona (la selección quedó adentro, un Shift+clic) sin cambiar ningún registro tampoco
  // dispara el guardado del plugin: se guarda acá, o el dispositivo conservaría lo colapsado de antes.
  else if (heldBefore.some((id) => !session!.held.has(id))) optionsOf.get(view)?.save?.(persistable(view, current, shared));
  if (end) sessions.delete(view);
  return { changed, opened: openedNow.size };
}

/** Cuántos títulos tiene la página y cuántos están colapsados. */
export function headingCounts(state: EditorState): { headings: number; collapsed: number } {
  const s = collapseKey.getState(state);
  if (!s) return { headings: 0, collapsed: 0 };
  return { headings: headingsOf(state.doc).length, collapsed: s.analysis.collapsed.size };
}

const listeners = new WeakMap<EditorView, Set<() => void>>();

/** Avisa cada vez que cambia lo colapsado o lo escondido. */
export function onCollapseChange(view: EditorView, fn: () => void): () => void {
  let set = listeners.get(view);
  if (!set) listeners.set(view, (set = new Set()));
  set.add(fn);
  return () => set!.delete(fn);
}

// --- Para todos (entrega 2, Doc_Colapsar.md §4) ---------------------------------------------------------

/** El mapa de la página con lo colapsado para todos: clave, el id del título; valor, `true`. */
export const SHARED_COLLAPSE_MAP = 'collapsedHeadings';
/** El origen de lo que se escribe en el mapa: se guarda y se sube como cualquier edición de la página. */
export const ORIGIN_SHARED_COLLAPSE = Symbol('shared-collapse');

/** Lo colapsado para todos que dice el mapa. */
export function readShared(map: Y.Map<unknown> | undefined): Shared {
  const out = new Set<string>();
  map?.forEach((value, key) => {
    if (value === true) out.add(key);
  });
  return out;
}

/** Las opciones de cada editor (para saber, desde afuera del plugin, si hay "para todos" y si se puede). */
const optionsOf = new WeakMap<EditorView, CollapseOptions>();
/** Los mapas que está escribiendo este editor (su propio aviso de cambio no hace falta). */
const writing = new WeakSet<Y.Map<unknown>>();

/**
 * Si esta persona puede colapsar o abrir para todos en este editor: con el mapa, con el editor editable (permiso de
 * editar y la página completa) y con los permisos conocidos (corrección 9).
 */
export function canShareCollapse(view: EditorView): boolean {
  const options = optionsOf.get(view);
  return !!options?.shared && view.editable && (options.canShare?.() ?? false);
}

export interface HeadingCollapse {
  /** Lo que se ve. */
  collapsed: boolean;
  /** Colapsado para todos (el mapa). */
  forAll: boolean;
  /** Lo que ves es solo tuyo (distinto de lo de todos). */
  onlyYou: boolean;
}

/** Cómo está un título para esta persona (para el tooltip del triángulo). */
export function headingCollapse(state: EditorState, id: string): HeadingCollapse {
  const s = collapseKey.getState(state);
  const collapsed = !!s?.analysis.collapsed.has(id);
  const forAll = !!s?.shared.has(id);
  return { collapsed, forAll, onlyYou: collapsed !== forAll };
}

/**
 * Shift+clic (o el atajo con Shift), quien puede editar: si lo que ves es solo tuyo, pasa a ser de todos; si no,
 * colapsa o abre para todos. Lo tuyo en ese título se borra (ves lo de todos). Sin permiso, no hace nada (`false`).
 */
export function toggleShared(view: EditorView, id: string): boolean {
  const s = collapseKey.getState(view.state);
  const options = optionsOf.get(view);
  const map = options?.shared;
  if (!s || !map || !canShareCollapse(view)) return false;
  const seen = isCollapsed(s.merged.get(id));
  const forAll = s.shared.has(id);
  const next = s.records.has(id) && seen !== forAll ? seen : !seen;
  const records = new Map(s.records);
  const shared = new Set(s.shared);
  if (next) shared.add(id);
  else shared.delete(id);
  // Abrir para todos lo que tenía un fin tuyo: los de adentro lo heredan, como al abrir para vos.
  if (!next) openRecord(view.state.doc, records, s.analysis, id, shared);
  const mine = records.get(id);
  // Pasar a todos lo que tenía un fin tuyo (Enter después del título): el fin queda tuyo, así no se esconde el
  // renglón que se veía (auditoría de la 1b, I-2). Los demás ven la sección entera colapsada.
  if (next && mine?.c && mine.e) records.set(id, { c: true, g: null, e: mine.e });
  else records.delete(id);
  writing.add(map);
  try {
    const write = () => (next ? map.set(id, true) : map.delete(id));
    if (map.doc) map.doc.transact(write, ORIGIN_SHARED_COLLAPSE);
    else write();
  } finally {
    writing.delete(map);
  }
  view.dispatch(view.state.tr.setMeta(collapseKey, { records, shared } satisfies CollapseMeta));
  return true;
}

/**
 * Llegó un cambio del mapa (de otro, o de otra parte de la app). Lo que otro colapsa para todos y escondería tu
 * selección queda abierto para vos (guardado como tuyo), con un aviso (corrección 5); lo tuyo nunca cambia.
 */
function sharedChanged(view: EditorView, map: Y.Map<unknown>, event: Y.YMapEvent<unknown>): void {
  const changed = [...event.keysChanged];
  // Lo que escribe este editor no llega acá (`writing`): todo lo demás es de otro, también lo que baja por el camino
  // de la reparación (que Yjs marca como local; auditoría de la 1b, M-4).
  const remote = event.transaction.origin !== ORIGIN_SHARED_COLLAPSE;
  // Después de que Yjs termine de avisar: si el mismo cambio trae contenido, y-prosemirror lo dibuja en su propio
  // aviso; despachar antes haría que el editor, todavía con lo de antes, lo escribiera encima en Yjs.
  queueMicrotask(() => applyShared(view, map, changed, remote));
}

function applyShared(view: EditorView, map: Y.Map<unknown>, changed: readonly string[], remote: boolean): void {
  const s = collapseKey.getState(view.state);
  if (!s || view.isDestroyed) return;
  const shared = readShared(map);
  const records = new Map(s.records);
  let kept = false;
  if (remote) {
    for (const id of changed) {
      if (!shared.has(id) || s.shared.has(id) || records.has(id)) continue;
      const alone = new Set(s.shared).add(id);
      const inside = hiddenInSelection(analyze(view.state.doc, effective(records, alone)), view.state.selection);
      if (!inside.head && !inside.anchor) continue;
      records.set(id, { c: false, g: null });
      kept = true;
    }
  }
  view.dispatch(view.state.tr.setMeta(collapseKey, { records, shared } satisfies CollapseMeta));
  if (kept) notify(t('collapse.keptOpen'));
}

// --- Mover la sección entera (1b, Doc_Colapsar.md "Mover la sección entera") ------------------------------

/** La marca del mover en su transacción y en su paso de deshacer (al deshacerlo se esconde lo mismo). */
export const SECTION_MOVE_META = 'sd-section-move';

function undoManagerOf(state: EditorState): Y.UndoManager | null {
  return (yUndoPluginKey.getState(state as never) as { undoManager?: Y.UndoManager } | undefined)?.undoManager ?? null;
}

/** Deshacer o rehacer un mover de la 1b. */
function taggedMoveUndo(state: EditorState): boolean {
  return undoManagerOf(state)?.currStackItem?.meta.get(SECTION_MOVE_META) === true;
}

const taggedManagers = new WeakSet<Y.UndoManager>();

/** Marca en la pila de deshacer los pasos de un mover (y los de deshacerlo, para rehacer). */
function tagMoves(state: EditorState): void {
  const um = undoManagerOf(state);
  if (!um || taggedManagers.has(um)) return;
  taggedManagers.add(um);
  um.on('stack-item-added', ({ stackItem }: { stackItem: { meta: Map<unknown, unknown> } }) => {
    if (movingBlocks() || um.currStackItem?.meta.get(SECTION_MOVE_META) === true) stackItem.meta.set(SECTION_MOVE_META, true);
  });
}

/**
 * Despacha un mover: la transacción con los mismos nodos, lo colapsado ajustado para que se esconda lo mismo que
 * antes (si no se puede, manda la corrección 2: se abre lo que quedó escondido) y, en Yjs, las dos pasadas
 * (blockMove.ts). `select`: la selección de antes corrida con lo movido, o un cursor en el primer bloque movido.
 */
export function dispatchSectionMove(view: EditorView, move: BlockMove, select: 'keep' | 'first' = 'keep'): void {
  const s = collapseKey.getState(view.state);
  if (!s) return;
  const { tr, at } = buildMove(view.state, move);
  const kept = preserveHidden(tr.doc, s.records, s.shared, s.analysis.hidden);
  if (kept) tr.setMeta(collapseKey, { records: kept } satisfies CollapseMeta);
  if (select === 'keep') tr.setSelection(movedSelection(view.state.selection, move, tr, at));
  else {
    const content = tr.doc.nodeAt(at)?.firstChild;
    tr.setSelection(
      content?.isTextblock ? TextSelection.create(tr.doc, at + 2 + content.content.size) : Selection.near(tr.doc.resolve(Math.min(at + 1, tr.doc.content.size))),
    );
  }
  tr.setMeta(SECTION_MOVE_META, true).scrollIntoView();
  dispatchMove(view, tr, recreatedRange(view.state.doc, move));
}

/**
 * Shift+⌘/Ctrl+↑/↓ (corrección 4): un título colapsado se mueve con su sección, y los demás bloques saltan una
 * sección colapsada como si fuera un bloque. Sin nada colapsado en juego, mueve BlockNote. En solo lectura no se
 * mueve nada (BlockNote movía igual y la subida se rechazaba).
 */
function moveByKeyboard(view: EditorView, dir: 'up' | 'down'): boolean {
  if (!view.editable) return true;
  const s = collapseKey.getState(view.state);
  if (!s) return false;
  const plan = planKeyboardMove(view.state.doc, view.state.selection, s.analysis, s.merged, dir);
  if (plan === null) return false;
  if (plan !== 'stay') dispatchSectionMove(view, plan);
  return true;
}

/** Lo que se está arrastrando: una sección colapsada (del primer bloque al último, por id). */
const drags = new WeakMap<EditorView, { first: string; last: string }>();

/**
 * Al empezar a arrastrar los puntos de un bloque (después del `blockDragStart` de BlockNote, que ya eligió el
 * bloque o los bloques): si hay un título colapsado, se arrastra su sección entera (corrección 7). Devuelve si
 * tomó el arrastre.
 */
export function startSectionDrag(view: EditorView, dataTransfer: DataTransfer | null): boolean {
  drags.delete(view);
  const s = collapseKey.getState(view.state);
  if (!s || !view.editable) return false;
  const range = planSectionDrag(view.state.doc, view.state.selection, s.analysis, s.merged);
  if (!range) return false;
  const sel = SectionSelection.create(view.state.doc, range.from, range.to);
  const nodes = sel.nodes;
  if (nodes.length === 0) return false;
  // La selección no se toca (queda el bloque que eligió BlockNote): cambiarla en medio del `dragstart` hace que
  // Chromium cancele el arrastre (lo encontró el recorrido de punta a punta). Lo que se suelta es `view.dragging`.
  const slice = sel.content();
  // Lo que ProseMirror va a soltar (BlockNote lo arma desde el HTML solo si no está puesto).
  (view as unknown as { dragging: unknown }).dragging = { slice, move: true };
  try {
    if (dataTransfer) {
      const html = view.serializeForClipboard(slice).dom.innerHTML;
      dataTransfer.setData('blocknote/html', html);
      dataTransfer.setData('text/html', html);
      dataTransfer.setData('text/plain', slice.content.textBetween(0, slice.content.size, '\n\n'));
    }
  } catch {
    // El portapapeles del arrastre es para soltar en otro lado; acá se usa `view.dragging`.
  }
  drags.set(view, { first: String(nodes[0].attrs.id ?? ''), last: String(nodes[nodes.length - 1].attrs.id ?? '') });
  return true;
}

/** Terminó el arrastre (se soltó o se canceló). */
export function endSectionDrag(view: EditorView): void {
  drags.delete(view);
}

/**
 * Suelta la sección que se arrastra cerca de `pos` (el lugar entre bloques más cercano, como ProseMirror). Soltarla
 * en su mismo lugar no hace nada. Devuelve si había una sección arrastrándose.
 */
export function dropSection(view: EditorView, pos: number): boolean {
  const drag = drags.get(view);
  drags.delete(view);
  if (!drag) return false;
  const doc = view.state.doc;
  const first = blockPos(view, drag.first);
  const last = blockPos(view, drag.last);
  if (first < 0 || last < first || doc.resolve(first).parent !== doc.resolve(last).parent) return true;
  const to = last + doc.nodeAt(last)!.nodeSize;
  const slice = doc.slice(first, to);
  const point = dropPoint(doc, Math.max(0, Math.min(pos, doc.content.size)), slice);
  if (point === null || point === undefined) return true;
  // Justo debajo de un título colapsado (o entre lo que esconde): después de su sección entera.
  const s = collapseKey.getState(view.state);
  const insertAt = s ? dropTarget(doc, point, s.analysis, s.merged) : point;
  if (insertAt >= first && insertAt <= to) return true;
  if (doc.resolve(insertAt).parent.type.name !== 'blockGroup') return true;
  dispatchSectionMove(view, { from: first, to, insertAt }, 'first');
  return true;
}

// --- Teclado ---------------------------------------------------------------------------------------------

/** El título colapsado donde está la selección (de texto): su cabeza o, con `fromStart`, su principio. */
function collapsedHeadingAt(state: EditorState, fromStart = false): { at: BlockAt; record: HeadingRecord; text: PMNode; offset: number } | null {
  const s = collapseKey.getState(state);
  const sel = state.selection;
  if (!s || !(sel instanceof TextSelection)) return null;
  const $head = fromStart ? sel.$from : sel.$head;
  const text = $head.parent;
  if (text.type.name !== 'heading' || $head.depth < 2) return null;
  const container = $head.node($head.depth - 1);
  const id = String(container.attrs.id ?? '');
  const record = s.merged.get(id);
  if (!s.analysis.collapsed.has(id) || !record) return null;
  const at = { node: container, pos: $head.before($head.depth - 1) };
  return { at, record, text, offset: $head.parentOffset };
}

/**
 * Enter al final de un título colapsado: un renglón nuevo después de lo escondido, sin abrirlo. Con `anywhere`, lo
 * mismo con el cursor en cualquier lugar del título salvo el principio, o con una selección que empieza en el título
 * (aunque siga en los bloques de abajo): no lo parte ni borra nada.
 */
function enterAfter(view: EditorView, anywhere = false): boolean {
  const state = view.state;
  const found = collapsedHeadingAt(state, anywhere);
  if (!found || (!anywhere && !state.selection.empty)) return false;
  const { at, record, text, offset } = found;
  const tr = state.tr;
  if (anywhere) {
    if (state.selection.empty && offset === 0 && text.content.size > 0) return false;
  } else if (offset === 0 && text.content.size > 0) {
    // Al principio (con texto): un renglón vacío arriba del título, que sigue colapsado.
    const schema = state.schema;
    tr.insert(at.pos, schema.nodes.blockContainer.create({ id: newBlockId() }, schema.nodes.paragraph.create()));
    view.dispatch(tr.scrollIntoView());
    return true;
  } else if (offset !== text.content.size) return false;
  const section = sectionAt(state.doc, at.pos, record)!;
  const next = section.group.maybeChild(section.end);
  const s = collapseKey.getState(state)!;
  if (next && next.firstChild?.type.name === 'paragraph' && next.firstChild.content.size === 0 && next.childCount === 1) {
    const nextId = String(next.attrs.id ?? '');
    if (!s.analysis.hidden.has(nextId)) {
      view.dispatch(tr.setSelection(TextSelection.create(tr.doc, section.after + 2)).scrollIntoView());
      return true;
    }
  }
  const id = newBlockId();
  const schema = state.schema;
  tr.insert(section.after, schema.nodes.blockContainer.create({ id }, schema.nodes.paragraph.create()));
  tr.setSelection(TextSelection.create(tr.doc, section.after + 2));
  const records = new Map(s.records);
  records.set(at.node.attrs.id as string, { ...record, e: id });
  tr.setMeta(collapseKey, { records } satisfies CollapseMeta);
  view.dispatch(tr.scrollIntoView());
  return true;
}

/**
 * Lo que hace Enter al final de un título colapsado (un renglón después de lo escondido, sin abrir la sección), para
 * otra tecla que quiere lo mismo: Ctrl/⌘+Enter, que después convierte ese renglón en un salto de hoja
 * (editorExtensions.ts). Vale con el cursor en cualquier lugar del título (también en el medio, o con una selección
 * que empieza en el título, aunque siga abajo): partirlo abriría la sección, así que no se parte. `false` si no está en un título colapsado, o si está
 * al principio de su texto (ahí el salto va antes del título, sin tocar la sección).
 */
export function enterAfterCollapsedHeading(view: EditorView): boolean {
  return enterAfter(view, true);
}

/**
 * Supr al final de un renglón:
 * - en un título colapsado, no une lo escondido al título;
 * - si lo que sigue (el primer hijo, o el bloque de abajo) es un título colapsado que esconde algo: un renglón
 *   vacío se borra y la selección va al principio del título; uno con texto no hace nada (BlockNote uniría el
 *   título al renglón y lo escondido quedaría suelto; verificación, punto 1).
 */
function deleteAtEnd(view: EditorView): boolean {
  const state = view.state;
  const sel = state.selection;
  if (!(sel instanceof TextSelection) || !sel.empty || sel.$head.parentOffset !== sel.$head.parent.content.size) return false;
  // Un salto de hoja vacío lo saca su propio Supr (deleteEmptyBreak, editorSchema.ts), que deja lo de abajo donde está.
  if (sel.$head.parent.content.size === 0 && sel.$head.parent.attrs[PAGE_BREAK_PROP] === true) return false;
  const found = collapsedHeadingAt(state);
  if (found) return hidesSomething(sectionAt(state.doc, found.at.pos, found.record));
  const s = collapseKey.getState(state);
  if (!s || s.analysis.collapsed.size === 0 || sel.$head.depth < 2) return false;
  const containerDepth = sel.$head.depth - 1;
  const container = sel.$head.node(containerDepth);
  const next = nextBlock(state.doc, sel.$head.before(containerDepth), container);
  if (!next) return false;
  const nextId = String(next.node.attrs.id ?? '');
  if (!s.analysis.collapsed.has(nextId) || s.analysis.hidden.has(nextId)) return false;
  if (!hidesSomething(sectionAt(state.doc, next.pos, s.merged.get(nextId)))) return false;
  const empty = sel.$head.parent.content.size === 0 && container.childCount === 1;
  if (!empty) return true;
  const from = sel.$head.before(containerDepth);
  const tr = state.tr.delete(from, from + container.nodeSize);
  tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(next.pos) + 2));
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** El bloque que sigue en el orden del documento: el primer hijo, o el de abajo (subiendo si hace falta). */
function nextBlock(doc: PMNode, pos: number, container: PMNode): BlockAt | null {
  const children = container.childCount > 1 ? container.lastChild : null;
  if (children?.type.name === 'blockGroup' && children.firstChild) {
    return { node: children.firstChild, pos: pos + 1 + container.firstChild!.nodeSize + 1 };
  }
  let $pos = doc.resolve(pos + container.nodeSize);
  for (;;) {
    const after = $pos.nodeAfter;
    if (after?.type.name === 'blockContainer') return { node: after, pos: $pos.pos };
    // Al final de un grupo: se sube al bloque de afuera.
    if ($pos.depth < 2) return null;
    $pos = doc.resolve($pos.after($pos.depth - 1));
  }
}

/** ↓ o → al final de un título colapsado: al primer bloque que se ve después (con Shift, extiende). */
function skipForward(view: EditorView, key: 'down' | 'right', extend: boolean): boolean {
  const state = view.state;
  const found = collapsedHeadingAt(state);
  if (!found) return false;
  const atEnd = found.offset === found.text.content.size;
  if (key === 'right' ? !atEnd : !(atEnd || lastLine(view))) return false;
  const section = sectionAt(state.doc, found.at.pos, found.record)!;
  if (!hidesSomething(section)) return false;
  const target = Selection.findFrom(state.doc.resolve(section.after), 1, extend);
  if (!target) return true;
  const next = extend ? TextSelection.create(state.doc, state.selection.anchor, target.head) : target;
  view.dispatch(state.tr.setSelection(next).scrollIntoView());
  return true;
}

/** Si la selección está en el último renglón de su bloque (sin medir, en jsdom: no). */
function lastLine(view: EditorView): boolean {
  try {
    return view.endOfTextblock('down');
  } catch {
    return false;
  }
}

/** El título de la sección donde está la selección: el bloque mismo, o el título de arriba que lo abarca. */
function headingOfSelection(state: EditorState): string | null {
  const $head = state.selection.$head;
  const hidden = collapseKey.getState(state)?.analysis.hidden;
  for (let d = $head.depth; d > 0; d--) {
    const node = $head.node(d);
    if (node.type.name !== 'blockContainer') continue;
    if (headingLevel(node) !== null) return String(node.attrs.id);
    // Los hermanos de arriba, del más cercano al más lejano: el primer título que se ve abarca este bloque
    // (uno escondido no: auditoría, punto 3).
    const group = $head.node(d - 1);
    const index = $head.index(d - 1);
    for (let k = index - 1; k >= 0; k--) {
      const prev = group.child(k);
      if (headingLevel(prev) !== null && !hidden?.has(String(prev.attrs.id))) return String(prev.attrs.id);
    }
  }
  return null;
}

/**
 * Retroceso al principio de un título "sube la línea", como un párrafo (Lega, 2026-09-30): BlockNote lo pasaría
 * a párrafo. Hace lo mismo que BlockNote con un párrafo (`KeyboardShortcutsExtension`, verificación de fbaef68):
 * - justo después de una regla ("## "), la deshace (lo hace BlockNote);
 * - anidado, sale un nivel (como hijo que sea);
 * - sin nada arriba (el primer bloque de la página), no hace nada;
 * - si arriba (el último descendiente del bloque de arriba) hay un renglón con texto, el título se le une y sus
 *   hijos quedan en su nivel, después;
 * - vacío, se borra (sus hijos quedan en su lugar) y la selección va arriba;
 * - si arriba hay un bloque sin texto (una foto, un renglón vacío), el título ocupa su lugar;
 * - después de una tabla, no hace nada.
 * Si ese renglón de arriba está escondido, el título se une al título colapsado que lo esconde, que es el
 * renglón que se ve. Un título colapsado que se une deja de existir: lo que escondía se ve (nunca se borra).
 */
function headingBackspace(view: EditorView, editor: BlockNoteEditor<any, any, any>): boolean {
  const state = view.state;
  const sel = state.selection;
  if (!(sel instanceof TextSelection) || !sel.empty) return false;
  const $head = sel.$head;
  if ($head.parentOffset !== 0 || $head.parent.type.name !== 'heading' || $head.depth < 2) return false;
  // Justo después de una regla de escritura ("## "): Retroceso la deshace (lo primero que hace BlockNote).
  if (state.plugins.some((pl) => (pl.spec as { isInputRules?: boolean }).isInputRules && pl.getState(state))) return false;
  const containerDepth = $head.depth - 1;
  const container = $head.node(containerDepth);
  const pos = $head.before(containerDepth);
  const groupDepth = containerDepth - 1;
  const index = $head.index(groupDepth);
  // Anidado: sale un nivel.
  if (groupDepth > 1) {
    if (editor.canUnnestBlock()) editor.unnestBlock();
    return true;
  }
  if (index === 0) return true;
  const s = collapseKey.getState(state);
  const text = $head.parent;
  const tr = state.tr;
  const kids = container.childCount > 1 ? container.lastChild! : null;
  // El último descendiente del bloque de arriba (con qué lo uniría BlockNote).
  let prev = $head.node(groupDepth).child(index - 1);
  let prevPos = pos - prev.nodeSize;
  while (prev.childCount > 1 && prev.lastChild?.type.name === 'blockGroup' && prev.lastChild.lastChild) {
    const group = prev.lastChild;
    prevPos = prevPos + prev.nodeSize - 2 - group.lastChild!.nodeSize;
    prev = group.lastChild!;
  }
  const prevContent = prev.firstChild!;
  const prevInline = prevContent.type.spec.content === 'inline*';
  const hider = s?.analysis.hidden.get(String(prev.attrs.id ?? ''));
  const done = () => {
    view.dispatch(tr.scrollIntoView());
    return true;
  };
  /** El título sin su bloque: sus hijos quedan en su lugar. */
  const removeKeepingKids = () => {
    if (kids) tr.replaceWith(pos, pos + container.nodeSize, kids.content);
    else tr.delete(pos, pos + container.nodeSize);
  };
  if (hider) {
    // El de arriba está escondido: el texto va al final del título colapsado que se ve (el renglón de arriba en
    // la pantalla), y el bloque del título se reemplaza por sus hijos.
    const at = s!.analysis.blocks.get(hider);
    if (!at) return true;
    const joinAt = headingTextEnd(at);
    removeKeepingKids();
    if (text.content.size) tr.insert(joinAt, text.content);
    tr.setSelection(TextSelection.create(tr.doc, joinAt));
    return done();
  }
  if (prevInline && prevContent.content.size > 0) {
    // Se une al renglón de arriba; sus hijos suben a su nivel (después), como con un párrafo.
    if (kids) {
      const range = tr.doc.resolve(pos + 1 + text.nodeSize + 1).blockRange(tr.doc.resolve(pos + 1 + text.nodeSize + kids.nodeSize - 1));
      if (range) tr.lift(range, tr.doc.resolve(pos).depth);
    }
    const joinAt = prevPos + 2 + prevContent.content.size;
    tr.delete(joinAt, tr.mapping.map(pos + 2));
    tr.setSelection(TextSelection.create(tr.doc, joinAt));
    return done();
  }
  if (text.content.size === 0) {
    // Vacío: se borra y la selección va arriba (a la foto, elegida entera).
    removeKeepingKids();
    if (prevContent.type.spec.content === '') tr.setSelection(NodeSelection.create(tr.doc, prevPos + 1));
    else if (prevInline) tr.setSelection(TextSelection.create(tr.doc, prevPos + 2 + prevContent.content.size));
    else tr.setSelection(Selection.near(tr.doc.resolve(prevPos + prev.nodeSize), -1));
    return done();
  }
  if (prevContent.type.spec.content === '' || prevInline) {
    // Arriba, un bloque sin texto (una foto, un renglón vacío): el título ocupa su lugar.
    tr.delete(pos, pos + container.nodeSize);
    tr.replaceWith(prevPos, prevPos + prev.nodeSize, container);
    tr.setSelection(TextSelection.create(tr.doc, prevPos + 2));
    return done();
  }
  // Después de una tabla: nada.
  return true;
}

/**
 * Retroceso al principio de un párrafo que viene justo después de lo escondido (auditoría, punto 6): BlockNote
 * lo uniría al último bloque escondido y la sección se abriría. Si está vacío, se borra y la selección vuelve
 * al final del título; si tiene texto, la selección pasa al final del título sin unir nada.
 */
function backspaceAfter(view: EditorView): boolean {
  const state = view.state;
  const s = collapseKey.getState(state);
  const sel = state.selection;
  if (!s || s.analysis.collapsed.size === 0 || !(sel instanceof TextSelection) || !sel.empty) return false;
  const $head = sel.$head;
  if ($head.parentOffset !== 0 || $head.parent.type.name !== 'paragraph' || $head.depth < 2) return false;
  const container = $head.node($head.depth - 1);
  const groupDepth = $head.depth - 2;
  const index = $head.index(groupDepth);
  if (index === 0) return false;
  // El bloque al que BlockNote uniría este: el último descendiente del de arriba (verificación, punto 2).
  let prev = $head.node(groupDepth).child(index - 1);
  while (prev.childCount > 1 && prev.lastChild?.type.name === 'blockGroup' && prev.lastChild.lastChild) prev = prev.lastChild.lastChild;
  const hiderId = s.analysis.hidden.get(String(prev.attrs.id ?? '')) ?? null;
  if (!hiderId || s.analysis.hidden.has(String(container.attrs.id ?? ''))) return false;
  const heading = s.analysis.blocks.get(hiderId);
  if (!heading) return false;
  const tr = state.tr;
  const empty = $head.parent.content.size === 0 && container.childCount === 1;
  if (empty) {
    const pos = $head.before($head.depth - 1);
    tr.delete(pos, pos + container.nodeSize);
  }
  tr.setSelection(TextSelection.create(tr.doc, headingTextEnd({ node: tr.doc.nodeAt(tr.mapping.map(heading.pos))!, pos: tr.mapping.map(heading.pos) })));
  view.dispatch(tr.scrollIntoView());
  return true;
}

/**
 * Ctrl/⌘+Alt+Enter: colapsa o abre el título de la sección donde está la selección. Con Shift, para todos (si se
 * puede editar; si no, para vos, como sin Shift).
 */
function toggleAtSelection(view: EditorView, forAll = false): boolean {
  const id = headingOfSelection(view.state);
  if (!id) return false;
  if (forAll && toggleShared(view, id)) return true;
  toggleCollapsed(view, id);
  return true;
}

/**
 * Cortar o copiar bloques enteros elegidos (el bloque, varios) con un título colapsado lleva su sección entera
 * (corrección 1): lo que se corta es lo que se borra (verificación de cbed5dc, punto 1).
 */
function widenForClipboard(view: EditorView): boolean {
  const state = view.state;
  const sel = state.selection;
  if (sel instanceof SectionSelection || sel instanceof AllSelection) return false;
  const range = blockRange(sel);
  const s = collapseKey.getState(state);
  if (!range || !s || s.analysis.collapsed.size === 0) return false;
  let to = range.to;
  for (const id of s.analysis.collapsed) {
    const at = s.analysis.blocks.get(id);
    if (!at || s.analysis.hidden.has(id) || !covers(range, at)) continue;
    const section = sectionAt(state.doc, at.pos, s.merged.get(id));
    if (section && section.after > to) to = section.after;
  }
  if (to === range.to) return false;
  view.dispatch(state.tr.setSelection(SectionSelection.create(state.doc, range.from, to)));
  return true;
}

/**
 * Una selección de bloques enteros, de `anchor` (antes del primero) a `head` (después del último), en el mismo
 * grupo: el título colapsado con lo que esconde, para copiar y cortar la sección entera. Como la
 * `MultipleNodeSelection` de BlockNote (que no se exporta y no se puede armar desde JSON).
 */
export class SectionSelection extends Selection {
  static create(doc: PMNode, from: number, to: number): SectionSelection {
    return new SectionSelection(doc.resolve(from), doc.resolve(to));
  }

  static fromJSON(doc: PMNode, json: { anchor: number; head: number }): SectionSelection {
    return SectionSelection.create(doc, json.anchor, json.head);
  }

  get nodes(): PMNode[] {
    const out: PMNode[] = [];
    this.$from.doc.nodesBetween(this.from, this.to, (node, pos) => {
      if (pos >= this.from && pos + node.nodeSize <= this.to && node.type.name === 'blockContainer') {
        out.push(node);
        return false;
      }
      return true;
    });
    return out;
  }

  content(): Slice {
    return new Slice(Fragment.from(this.nodes), 0, 0);
  }

  eq(other: Selection): boolean {
    return other instanceof SectionSelection && other.from === this.from && other.to === this.to;
  }

  map(doc: PMNode, mapping: Mappable): Selection {
    const from = mapping.mapResult(this.from);
    const to = mapping.mapResult(this.to);
    if (from.deleted || to.deleted || to.pos <= from.pos) return Selection.near(doc.resolve(from.pos));
    return new SectionSelection(doc.resolve(from.pos), doc.resolve(to.pos));
  }

  toJSON(): { type: string; anchor: number; head: number } {
    return { type: 'sd-section', anchor: this.anchor, head: this.head };
  }
}
try {
  Selection.jsonID('sd-section', SectionSelection);
} catch {
  // Ya estaba (el módulo se volvió a cargar en desarrollo).
}

// --- Rapidez: escribir no recalcula lo escondido --------------------------------------------------------

/**
 * Si la transacción solo cambia texto adentro de renglones (tipear, borrar letras, marcas), sin tocar bloques
 * ni el último bloque de la página (la regla del párrafo vacío). Las de Yjs no: vienen como un reemplazo de
 * todo el documento.
 */
function textOnly(tr: Transaction): boolean {
  return editedPoints(tr) !== null;
}

/**
 * Si la transacción solo cambia texto adentro de renglones, los lugares tocados (en el documento de antes);
 * si no, `null`.
 */
function editedPoints(tr: Transaction): number[] | null {
  if (yjsOrigin(tr).fromYjs) return null;
  const points: number[] = [];
  for (let i = 0; i < tr.steps.length; i++) {
    const step = tr.steps[i];
    const { from, to } = step as unknown as { from: number; to: number };
    if (step instanceof ReplaceStep) {
      const { slice } = step as unknown as { slice: Slice };
      if (slice.openStart !== 0 || slice.openEnd !== 0) return null;
      let inline = true;
      slice.content.forEach((node) => {
        if (!node.isInline) inline = false;
      });
      if (!inline) return null;
    } else if (!(step instanceof AddMarkStep || step instanceof RemoveMarkStep)) return null;
    const doc = tr.docs[i];
    const $from = doc.resolve(from);
    const $to = doc.resolve(to);
    if (!$from.parent.isTextblock || !$from.sameParent($to) || $from.depth < 2) return null;
    const root = doc.firstChild;
    if (!root || $from.index(1) === root.childCount - 1) return null;
    points.push(i === 0 ? from : tr.mapping.slice(0, i).invert().map(from));
  }
  return points;
}

/**
 * Lo calculado, con las posiciones corridas (lo escondido es lo mismo). Solo los bloques que contienen lo
 * editado (el renglón y los de afuera) cambian de nodo; los demás son los mismos (una sola pasada).
 */
function mapAnalysis(analysis: Analysis, tr: Transaction): Analysis {
  if (analysis.blocks.size === 0) return analysis;
  const points = editedPoints(tr) ?? [];
  const blocks = new Map<string, BlockAt>();
  for (const [id, at] of analysis.blocks) {
    const pos = tr.mapping.map(at.pos);
    const end = at.pos + at.node.nodeSize;
    const touched = points.some((p) => p > at.pos && p < end);
    blocks.set(id, { node: touched ? (tr.doc.nodeAt(pos) ?? at.node) : at.node, pos });
  }
  const top = analysis.top.map((t) => {
    const at = blocks.get(t.id);
    return at ? { ...t, pos: at.pos, size: at.node.nodeSize } : t;
  });
  return { blocks, hidden: analysis.hidden, collapsed: analysis.collapsed, top };
}

function sameStructure(a: Analysis, b: Analysis): boolean {
  if (a.hidden.size !== b.hidden.size || a.collapsed.size !== b.collapsed.size) return false;
  for (const [id, hider] of a.hidden) if (b.hidden.get(id) !== hider) return false;
  for (const id of a.collapsed) if (!b.collapsed.has(id)) return false;
  return true;
}

// --- El plugin -------------------------------------------------------------------------------------------

/** Lo nuevo del plugin después de una transacción (sin la marca de Ctrl+A). */
function applyCollapse(tr: Transaction, old: CollapseState): CollapseState {
  const meta = tr.getMeta(collapseKey) as CollapseMeta | undefined;
  // Escribir en un renglón no cambia qué se esconde: se corren las posiciones y las decoraciones, sin
  // volver a calcular todo en cada tecla (auditoría, punto 7).
  if (!meta && tr.docChanged && textOnly(tr)) {
    return { ...old, selectAll: undefined, analysis: mapAnalysis(old.analysis, tr), decorations: old.decorations.map(tr.mapping, tr.doc) };
  }
  let records = tr.docChanged ? remapRecords(tr, old, old.records) : old.records;
  if (meta?.records) records = meta.records;
  const shared = meta?.shared ?? old.shared;
  if (!tr.docChanged && shared === old.shared && (records === old.records || sameRecords(records, old.records))) return old;
  const merged = effective(records, shared);
  const analysis = analyze(tr.doc, merged);
  const next: CollapseState = { records, shared, merged, analysis, decorations: redecorate(old.decorations, tr, analysis) };
  // Si lo escondido quedó igual, se conservan los mismos objetos (así nadie vuelve a medir de más).
  if (sameStructure(next.analysis, old.analysis)) {
    next.analysis = { ...next.analysis, hidden: old.analysis.hidden, collapsed: old.analysis.collapsed };
  }
  return next;
}

function createCollapsePlugin(options: CollapseOptions): Plugin<CollapseState> {
  let pluginView: EditorView | null = null;
  /** Se apretó Ctrl/⌘+A: la próxima selección que ponga la persona es la de todo. */
  let pendingAll = false;
  let guard: Guard | null = null;
  const armGuard = (ids: readonly string[]) => {
    const until = Date.now() + 1000;
    if (guard && guard.until >= Date.now()) {
      for (const id of ids) guard.ids.add(id);
      guard.until = until;
    } else guard = { ids: new Set(ids), until };
  };
  /**
   * Lo que haría una edición con esta selección (componer, escribir encima), mirado antes de que el navegador
   * cambie la pantalla: si borraría algo escondido, se abre y la selección queda vacía.
   */
  const refuseAhead = (view: EditorView): boolean => {
    if (view.state.selection.empty) return false;
    const lost = hiddenLost(view.state.tr.deleteSelection(), view.state);
    if (lost.length === 0) return false;
    armGuard(lost);
    revealAndCollapse(view, lost);
    return true;
  };
  /** La marca de Ctrl+A: la pone la primera selección de la persona después de la tecla; la saca la siguiente. */
  const selectAllAfter = (tr: Transaction, old: boolean): boolean => {
    if (!tr.selectionSet) return old;
    if (tr.getMeta(ySyncPluginKey as never) || tr.getMeta('appendedTransaction')) return old;
    const on = pendingAll;
    pendingAll = false;
    return on;
  };
  return new Plugin<CollapseState>({
    key: collapseKey,
    state: {
      init: (_, state) => build(state.doc, new Map(options.initial ?? []), readShared(options.shared)),
      apply: (tr, old) => {
        const next = applyCollapse(tr, old);
        const selectAll = selectAllAfter(tr, !!old.selectAll);
        return !!next.selectAll === selectAll ? next : { ...next, selectAll };
      },
    },
    appendTransaction: appendCollapse,
    // Lo que borraría algo escondido sin que la persona lo haya querido no se hace: la sección se abre y la
    // selección queda vacía (después, porque adentro de un despacho no se puede despachar otro); la tecla no hace
    // nada. Por un rato, lo que llega de una composición tampoco borra lo recién abierto (`Guard`).
    filterTransaction: (tr, state) => {
      let lost = hiddenLost(tr, state);
      if (lost.length === 0 && guard) {
        if (Date.now() > guard.until && !pluginView?.composing) guard = null;
        else lost = guardedLost(guard, pluginView, tr, state);
      }
      if (lost.length === 0) return true;
      armGuard(lost);
      const view = pluginView;
      if (view) queueMicrotask(() => !view.isDestroyed && revealAndCollapse(view, lost));
      return false;
    },
    props: {
      decorations: (state) => collapseKey.getState(state)?.decorations,
      // Soltar una sección colapsada que se arrastra (startSectionDrag): se mueve entera.
      handleDrop: (view, event, _slice, moved) => {
        if (!moved || !drags.has(view)) return false;
        const e = event as DragEvent;
        const at = view.posAtCoords({ left: e.clientX, top: e.clientY });
        if (!at) {
          drags.delete(view);
          return true;
        }
        return dropSection(view, at.pos);
      },
      handleKeyDown: (_view, event) => {
        pendingAll = isSelectAllKey(event);
        return false;
      },
      handleDOMEvents: {
        // Empezar a componer (una tecla muerta, el teclado del teléfono) o escribir encima de una selección que
        // borraría algo escondido: se abre y la selección queda vacía antes de que el navegador toque la pantalla.
        // Un arrastre que empieza en el texto del editor no es el de una sección (auditoría de la 1b, M-3).
        dragstart: (view) => {
          drags.delete(view);
          return false;
        },
        compositionstart: (view) => {
          refuseAhead(view);
          return false;
        },
        beforeinput: (view, event) => {
          const input = event as InputEvent;
          const type = input.inputType ?? '';
          if (!/^(insert|delete)/.test(type)) return false;
          // Se rechazó: queda manejado aunque no se pueda cancelar (si no, en Android ProseMirror mandaría su
          // propio Retroceso sobre la selección ya vacía; verificación de 6f47844).
          if (refuseAhead(view)) {
            if (event.cancelable) event.preventDefault();
            return true;
          }
          // Ctrl+A y un texto que no pasa por el teclado (el dictado, los emojis): el navegador reemplazaría solo lo
          // que ve; se escribe sobre la selección de ProseMirror, que llega hasta lo escondido del final.
          const text = input.data ?? input.dataTransfer?.getData('text/plain') ?? '';
          const sel = view.state.selection;
          if (!event.cancelable || !text || !/^insert(Text|ReplacementText)$/.test(type)) return false;
          if (!(sel instanceof TextSelection) || !selectsAll(sel, view.state)) return false;
          event.preventDefault();
          view.dispatch(view.state.tr.insertText(text).scrollIntoView());
          return true;
        },
        copy: (view) => {
          // Copiar no cambia la selección: después de copiar, vuelve la de antes (auditoría, punto 10).
          const previous = view.state.selection;
          if (widenForClipboard(view)) {
            setTimeout(() => {
              if (view.state.selection instanceof SectionSelection && view.state.doc.eq(previous.$anchor.doc)) {
                view.dispatch(view.state.tr.setSelection(previous.map(view.state.doc, view.state.tr.mapping)));
              }
            });
          }
          return false;
        },
        cut: (view, event) => {
          if (widenForClipboard(view)) return false;
          // Cortar algo que no se puede borrar (ver `hiddenLost`) no lleva nada: abre la sección.
          const lost = hiddenLost(view.state.tr.deleteSelection().setMeta('uiEvent', 'cut'), view.state);
          if (lost.length === 0) return false;
          event.preventDefault();
          armGuard(lost);
          revealAndCollapse(view, lost);
          return true;
        },
      },
    },
    view: (editorView) => {
      pluginView = editorView;
      optionsOf.set(editorView, options);
      tagMoves(editorView.state);
      // Lo colapsado para todos: cada cambio del mapa (de otro, o de otra pestaña de la misma página).
      const map = options.shared;
      const onShared = (event: Y.YMapEvent<unknown>) => {
        if (map && !writing.has(map)) sharedChanged(editorView, map, event);
      };
      map?.observe(onShared);
      let paused = new WeakSet<HTMLIFrameElement>();
      // La búsqueda en la página (Docs/Doc_Buscar.md) cuenta lo que está en secciones colapsadas y, al ir ahí, lo
      // abre para vos. Cada editor registra los suyos (por vista).
      const hooks: FindCollapseHooks = {
        isHidden: (blockId) => !!collapseKey.getState(editorView.state)?.analysis.hidden.has(blockId),
        // Ir a una coincidencia: la sección se abre solo por la búsqueda (se vuelve a cerrar al terminar), también si la
        // persona la había cerrado.
        reveal: (blockId) => {
          const wanted = new Set(sessions.get(editorView)?.wanted ?? []).add(blockId);
          syncSearchOpen(editorView, wanted, { force: new Set([blockId]) });
        },
        anyHidden: () => (collapseKey.getState(editorView.state)?.analysis.hidden.size ?? 0) > 0,
        syncSearch: (wanted, end) => syncSearchOpen(editorView, wanted, { end }),
        searchOpened: () => searchOpenedCount(editorView),
      };
      setFindCollapseHooks(editorView, hooks);
      return {
        destroy: () => {
          map?.unobserve(onShared);
          optionsOf.delete(editorView);
          setFindCollapseHooks(editorView, null);
          if (pluginView === editorView) pluginView = null;
        },
        update: (view, prev) => {
          const now = collapseKey.getState(view.state);
          const was = collapseKey.getState(prev);
          if (!now || now === was) return;
          if (!was || !sameRecords(now.records, was.records)) options.save?.(persistable(view, now.records, now.shared));
          const structural = !was || was.analysis.hidden !== now.analysis.hidden || was.analysis.collapsed !== now.analysis.collapsed;
          if (structural) {
            // Un reproductor de Drive que queda escondido se para (se vuelve a cargar).
            const next = new WeakSet<HTMLIFrameElement>();
            for (const frame of view.dom.querySelectorAll<HTMLIFrameElement>('iframe.drive-card-player')) {
              if (!hiddenInDom(frame)) continue;
              if (!paused.has(frame)) frame.src = frame.src;
              next.add(frame);
            }
            paused = next;
          }
          if (structural || now.shared !== was!.shared || !sameRecords(now.records, was!.records)) for (const fn of listeners.get(view) ?? []) fn();
        },
      };
    },
  });
}

type KeyContext = { editor: BlockNoteEditor<any, any, any> };
const withView = (fn: (view: EditorView) => boolean) => ({ editor }: KeyContext) => {
  const view = editor.prosemirrorView;
  return view ? fn(view) : false;
};

/** La extensión del editor: una por editor, con lo guardado de la página. */
export const collapseExtension = createExtension(({ options }: ExtensionOptions<CollapseOptions>) => ({
  key: 'shotdocs-collapse',
  runsBefore: ['default'],
  prosemirrorPlugins: [createCollapsePlugin(options ?? {})],
  keyboardShortcuts: {
    // Las teclas salen del registro de atajos (shortcuts.ts).
    [shortcutKeys('collapse')[0]]: withView((view) => toggleAtSelection(view)),
    // Para todos (entrega 2), si se puede editar.
    [shortcutKeys('collapseEveryone')[0]]: withView((view) => toggleAtSelection(view, true)),
    // Mover la sección entera (1b); sin nada colapsado en juego, el de BlockNote.
    [shortcutKeys('moveUp')[0]]: withView((view) => moveByKeyboard(view, 'up')),
    [shortcutKeys('moveDown')[0]]: withView((view) => moveByKeyboard(view, 'down')),
    Enter: withView((view) => enterAfter(view)),
    Delete: withView(deleteAtEnd),
    Backspace: withView(backspaceAfter),
    ArrowDown: withView((view) => skipForward(view, 'down', false)),
    'Shift-ArrowDown': withView((view) => skipForward(view, 'down', true)),
    ArrowRight: withView((view) => skipForward(view, 'right', false)),
    'Shift-ArrowRight': withView((view) => skipForward(view, 'right', true)),
  },
}));

/**
 * Retroceso al principio de un título "sube la línea" (`headingBackspace`): una extensión aparte, que va siempre,
 * también en un navegador que no puede colapsar (verificación de fbaef68, punto M5), así editar es igual en todos.
 */
export const headingBackspaceExtension = createExtension({
  key: 'shotdocs-heading-backspace',
  runsBefore: ['default'],
  keyboardShortcuts: {
    Backspace: ({ editor }: KeyContext) => {
      const view = editor.prosemirrorView;
      return !!view && headingBackspace(view, editor);
    },
  },
});

/**
 * Si el navegador puede esconder lo colapsado: el CSS usa `:has()` (Chrome 105, Safari e iOS 15.4, Firefox 121).
 * Sin eso no se colapsa nada: ni triángulos, ni nada escondido, y lo guardado no se usa (verificación de
 * cbed5dc, punto 7). Sin `CSS.supports` (jsdom), se da por bueno.
 */
export function collapseSupported(): boolean {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return true;
  try {
    return CSS.supports('selector(:has(*))');
  } catch {
    return false;
  }
}

/**
 * Si la tecla es la de elegir todo: ⌘+A en la Mac (Ctrl+A no), Ctrl+A en las demás; la letra que escribe la
 * tecla, o la posición de la A si no da una letra latina (verificación de 6f47844).
 */
export function isSelectAllKey(event: KeyboardEvent, mac = IS_MAC): boolean {
  return modPressed(event, mac) && !event.altKey && !event.shiftKey && isLetter(event, 'a');
}

