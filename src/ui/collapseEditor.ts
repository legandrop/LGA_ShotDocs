import { createExtension, type BlockNoteEditor, type ExtensionOptions } from '@blocknote/core';
import { Fragment, Slice, type Node as PMNode, type ResolvedPos } from '@tiptap/pm/model';
import { AddMarkStep, RemoveMarkStep, ReplaceStep, type Mappable } from '@tiptap/pm/transform';
import { NodeSelection, Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { ySyncPluginKey, yUndoPluginKey } from 'y-prosemirror';
import { t } from '../i18n';
import '../i18n/lazy/editor';
import {
  analyze,
  headingLevel,
  headingsOf,
  headingTextEnd,
  hidesSomething,
  isCollapsed,
  sectionAt,
  type Analysis,
  type BlockAt,
  type HeadingRecord,
} from './collapse';
import { hiddenInDom } from './collapseDom';
import { BACKGROUND_META, FIND_REPLACE_META } from './editorMeta';
import { isFindReplaceTransaction, setFindCollapseHooks, type FindCollapseHooks } from './findEditor';
import { notify } from './notice';

// Colapsar secciones por sus títulos (P.11, Docs/Doc_Colapsar.md), en el editor. Como las filas de fotos
// (imageRowsEditor.ts): un plugin de ProseMirror que calcula qué se esconde (collapse.ts) y lo dibuja con
// decoraciones. Nunca cambia el documento por colapsar o abrir; sí cuida lo que se edita al lado de lo
// escondido:
// - Borrar un título colapsado (el bloque entero) borra su sección entera, de una vez (corrección 1).
// - Nada que se veía queda escondido sin querer: si pasa (propio o de otro), se abre para vos (corrección 2).
// - Un cambio propio (también deshacer) en algo escondido lo abre; uno de otro, no (corrección 3).
// - Si la selección queda en algo escondido: por un cambio del documento, se abre; si solo se movió, pasa al
//   final del título.
// - Enter al final de un título colapsado crea un renglón después de lo escondido, sin abrirlo (corrección
//   19); Supr ahí no hace nada; ↓ y → saltan lo escondido.
// Lo colapsado es de cada persona y dispositivo (collapseStore.ts): el plugin lo recibe al crear el editor y
// avisa cada cambio con `save`.

export interface CollapseState {
  records: ReadonlyMap<string, HeadingRecord>;
  analysis: Analysis;
  decorations: DecorationSet;
}

interface CollapseMeta {
  /** Lo guardado de cada título, entero (lo arma quien despacha). */
  records: ReadonlyMap<string, HeadingRecord>;
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export const collapseKey = new PluginKey<CollapseState>('shotdocs-collapse');

export interface CollapseOptions {
  /** Lo guardado en el dispositivo para esta página (se lee antes de crear el editor: no hay parpadeo). */
  initial?: ReadonlyMap<string, HeadingRecord>;
  /** Cada cambio de lo colapsado, para guardarlo. */
  save?: (records: ReadonlyMap<string, HeadingRecord>) => void;
}

export function collapseState(state: EditorState): CollapseState | undefined {
  return collapseKey.getState(state);
}

function decorate(doc: PMNode, analysis: Analysis): DecorationSet {
  const decorations: Decoration[] = [];
  for (const id of analysis.collapsed) {
    const at = analysis.blocks.get(id);
    if (at) decorations.push(Decoration.node(at.pos, at.pos + at.node.nodeSize, { class: 'sd-collapsed', 'data-sd-collapsed': 'true' }));
  }
  for (const top of analysis.top) {
    decorations.push(Decoration.node(top.pos, top.pos + top.size, { class: 'sd-collapsed-hidden', 'data-sd-hider': top.hider }));
  }
  return DecorationSet.create(doc, decorations);
}

function build(doc: PMNode, records: ReadonlyMap<string, HeadingRecord>): CollapseState {
  const analysis = analyze(doc, records);
  return { records, analysis, decorations: decorate(doc, analysis) };
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
  if (records.size === 0) return records;
  const ids = blockIds(tr.doc);
  const local = !yjsOrigin(tr).fromYjs;
  let out: Map<string, HeadingRecord> | null = null;
  const edit = () => (out ??= new Map(records));
  for (const [id, record] of records) {
    if (ids.has(id) || !local) continue;
    const was = old.analysis.blocks.get(id);
    if (!was) continue;
    // El texto del título sigue (no se borró): el bloque es el mismo, con otro id.
    if (tr.mapping.mapResult(was.pos + 2).deletedAcross) continue;
    const node = tr.doc.nodeAt(tr.mapping.map(was.pos));
    const renamed = node?.type.name === 'blockContainer' ? String(node.attrs.id ?? '') : '';
    if (!renamed || renamed === id || old.analysis.blocks.has(renamed) || headingLevel(node!) === null) continue;
    edit().delete(id);
    edit().set(renamed, record);
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
function openRecord(doc: PMNode, records: Map<string, HeadingRecord>, analysis: Analysis, id: string): void {
  const record = records.get(id);
  records.delete(id);
  if (!record?.e) return;
  for (const [inner, hider] of analysis.hidden) {
    if (hider !== id || !analysis.collapsed.has(inner)) continue;
    const at = analysis.blocks.get(inner);
    const innerRecord = records.get(inner);
    if (!at || !innerRecord || innerRecord.e) continue;
    // Su sección llega hasta el fin del de afuera (o más): corta ahí.
    const section = sectionAt(doc, at.pos, innerRecord);
    if (section?.siblings.some((s) => s.node.attrs.id === record.e)) records.set(inner, { ...innerRecord, e: record.e });
  }
}

/** Abre, para vos, todos los títulos que esconden `blockId` (de afuera hacia adentro). */
function revealIn(doc: PMNode, records: Map<string, HeadingRecord>, blockId: string): Analysis {
  let analysis = analyze(doc, records);
  for (let guard = 0; guard < 64 && analysis.hidden.has(blockId); guard++) {
    openRecord(doc, records, analysis, analysis.hidden.get(blockId)!);
    analysis = analyze(doc, records);
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
 * Si una transacción propia sacó entero el bloque que estaba en `[from, to)`: sus dos bordes y el texto de
 * adentro. No cuenta juntarlo con otro (su texto queda) ni cambiarle solo los atributos, como el id
 * (auditoría, punto 2).
 */
function removedWhole(trs: readonly Transaction[], plain: ReadonlySet<Transaction>, from: number, to: number): boolean {
  let a = from;
  let b = to;
  let inside = from + 2;
  for (const tr of trs) {
    if (plain.has(tr)) {
      const start = tr.mapping.mapResult(a, 1);
      const end = tr.mapping.mapResult(b, -1);
      if (start.deletedAfter && end.deletedBefore && tr.mapping.mapResult(inside).deletedAcross) return true;
    }
    a = tr.mapping.map(a, 1);
    b = tr.mapping.map(b, -1);
    inside = tr.mapping.map(inside);
    if (b <= a) return false;
  }
  return false;
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
  const ownAction = trs.some((tr) => tr.getMeta(collapseKey));
  if (!docChanged && !ownAction && !trs.some((tr) => tr.selectionSet)) return null;

  // Qué transacciones son de la persona (no de otro por Yjs; deshacer sí cuenta) y cuáles no abren nada.
  const plain = new Set<Transaction>();
  let local = false;
  let untagged = false;
  let pasted = false;
  for (const tr of trs) {
    if (!tr.docChanged) continue;
    const { fromYjs, undo } = yjsOrigin(tr);
    // Los reemplazos de la búsqueda ("Reemplazar todo" escribe en el Y.Doc y llega como de Yjs) y su deshacer no
    // abren nada (corrección 18); tampoco lo que hace la app sola (corrección 10).
    if (isFindReplaceTransaction(tr) || tr.getMeta(BACKGROUND_META) || (undo && taggedUndo(newState))) continue;
    untagged = true;
    if (!fromYjs) plain.add(tr);
    if (!fromYjs || undo) local = true;
    const ui = tr.getMeta('uiEvent');
    if (tr.getMeta('paste') || ui === 'paste' || ui === 'drop') pasted = true;
  }

  const tr = newState.tr;
  const records = new Map(after.records);

  // Escribir en un renglón (lo más común) no saca ni mueve bloques: no hay nada que borrar ni avisar.
  const structural = [...plain].some((t) => !textOnly(t));

  // 1. Un título colapsado sacado entero: se va su sección entera, en la misma pasada (un solo Ctrl+Z).
  const doomed = new Set<string>();
  if (structural) {
    for (const id of before.analysis.collapsed) {
      // Solo un título que se veía: lo que esconde uno escondido lo decide el de afuera.
      if (before.analysis.hidden.has(id) || after.analysis.blocks.has(id)) continue;
      const at = before.analysis.blocks.get(id);
      if (!at || !removedWhole(trs, plain, at.pos, at.pos + at.node.nodeSize)) continue;
      // Solo lo que ese título escondía (nunca algo que se veía, aunque sea de su sección: el fin).
      for (const [sid, hider] of before.analysis.hidden) {
        if (hider === id && after.analysis.blocks.has(sid)) doomed.add(sid);
      }
    }
    deleteBlocks(tr, doomed);
  }

  let analysis = tr.docChanged ? analyze(tr.doc, records) : after.analysis;
  const reveal = new Set<string>();

  if (docChanged && !ownAction) {
    // 2. Lo que se veía y quedó escondido (propio o de otro) abre lo que lo esconde.
    if (untagged) {
      for (const [id, hider] of analysis.hidden) {
        if (!before.analysis.blocks.has(id) || before.analysis.hidden.has(id)) continue;
        // El último renglón vacío de la página, justo después de una sección colapsada, al escribirle: pasa a
        // ser el fin de ese título, como con Enter (auditoría, punto 5).
        if (wasTrailingLine(oldState.doc, id) && records.has(hider) && !records.get(hider)!.e) {
          records.set(hider, { ...records.get(hider)!, e: id });
          analysis = analyze(tr.doc, records);
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
    if (gone) notify(t('collapse.deletedHidden', { shortcut: IS_MAC ? '⌘Z' : 'Ctrl+Z' }));
  }

  for (const id of reveal) {
    if (analysis.hidden.has(id)) analysis = revealIn(tr.doc, records, id);
  }

  // La selección no queda en algo escondido: si fue por un cambio del documento, se abre; si no, pasa al final
  // del título que lo esconde.
  const sel = tr.selection;
  if (!(sel instanceof SectionSelection) && (sel.toJSON() as { type?: string }).type !== 'multiple-node') {
    const inside = hiddenInSelection(analysis, sel);
    if (inside.head || inside.anchor) {
      if (docChanged && local) {
        for (const id of [inside.head, inside.anchor]) if (id && analysis.hidden.has(id)) analysis = revealIn(tr.doc, records, id);
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
    else if (records.has(id)) openRecord(view.state.doc, records, state.analysis, id);
  }
  if (!sameRecords(records, state.records)) dispatchRecords(view, records);
}

export function toggleCollapsed(view: EditorView, id: string): void {
  const state = collapseKey.getState(view.state);
  if (!state) return;
  setCollapsed(view, [id], !isCollapsed(state.records.get(id)));
}

/** Colapsa o abre todos los títulos de la página (para vos). */
export function setAllCollapsed(view: EditorView, collapsed: boolean): void {
  const state = collapseKey.getState(view.state);
  if (!state) return;
  if (!collapsed) return setCollapsed(view, [...state.records.keys()], false);
  setCollapsed(
    view,
    headingsOf(view.state.doc).map((h) => h.id),
    true,
  );
}

/** Abre, para vos, lo que esconde un bloque. Devuelve si estaba escondido. */
export function revealBlock(view: EditorView, blockId: string): boolean {
  const state = collapseKey.getState(view.state);
  if (!state?.analysis.hidden.has(blockId)) return false;
  const records = new Map(state.records);
  revealIn(view.state.doc, records, blockId);
  dispatchRecords(view, records);
  return true;
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

// --- Teclado ---------------------------------------------------------------------------------------------

/** El título colapsado donde está la selección (de texto). */
function collapsedHeadingAt(state: EditorState): { at: BlockAt; record: HeadingRecord; text: PMNode; offset: number } | null {
  const s = collapseKey.getState(state);
  const sel = state.selection;
  if (!s || !(sel instanceof TextSelection)) return null;
  const $head = sel.$head;
  const text = $head.parent;
  if (text.type.name !== 'heading' || $head.depth < 2) return null;
  const container = $head.node($head.depth - 1);
  const id = String(container.attrs.id ?? '');
  const record = s.records.get(id);
  if (!s.analysis.collapsed.has(id) || !record) return null;
  const at = { node: container, pos: $head.before($head.depth - 1) };
  return { at, record, text, offset: $head.parentOffset };
}

/** Enter al final de un título colapsado: un renglón nuevo después de lo escondido, sin abrirlo. */
function enterAfter(view: EditorView): boolean {
  const state = view.state;
  const found = collapsedHeadingAt(state);
  if (!found || !state.selection.empty) return false;
  const { at, record, text, offset } = found;
  const tr = state.tr;
  if (offset === 0 && text.content.size > 0) {
    // Al principio (con texto): un renglón vacío arriba del título, que sigue colapsado.
    const schema = state.schema;
    tr.insert(at.pos, schema.nodes.blockContainer.create({ id: newBlockId() }, schema.nodes.paragraph.create()));
    view.dispatch(tr.scrollIntoView());
    return true;
  }
  if (offset !== text.content.size) return false;
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

/** Supr al final de un título colapsado no une lo escondido al título. */
function deleteAtEnd(view: EditorView): boolean {
  const found = collapsedHeadingAt(view.state);
  if (!found || !view.state.selection.empty || found.offset !== found.text.content.size) return false;
  return hidesSomething(sectionAt(view.state.doc, found.at.pos, found.record));
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
  const prev = $head.node(groupDepth).child(index - 1);
  const prevId = String(prev.attrs.id ?? '');
  const hiderId = s.analysis.hidden.get(prevId) ?? (s.analysis.collapsed.has(prevId) && prev.childCount > 1 ? prevId : null);
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

/** Ctrl/⌘+Alt+Enter: colapsa o abre el título de la sección donde está la selección. */
function toggleAtSelection(view: EditorView): boolean {
  const id = headingOfSelection(view.state);
  if (!id) return false;
  toggleCollapsed(view, id);
  return true;
}

/** Cortar o copiar el título colapsado elegido entero lleva su sección entera (corrección 1). */
function widenForClipboard(view: EditorView): boolean {
  const state = view.state;
  const sel = state.selection;
  if (!(sel instanceof NodeSelection)) return false;
  const s = collapseKey.getState(state);
  let container = sel.node;
  let pos = sel.from;
  if (container.type.name === 'heading') {
    const $pos = state.doc.resolve(sel.from);
    container = $pos.parent;
    pos = $pos.before();
  }
  const id = String(container.attrs.id ?? '');
  if (container.type.name !== 'blockContainer' || !s?.analysis.collapsed.has(id)) return false;
  const section = sectionAt(state.doc, pos, s.records.get(id));
  if (!section || section.siblings.length === 0) return false;
  view.dispatch(state.tr.setSelection(SectionSelection.create(state.doc, pos, section.after)));
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
  if (yjsOrigin(tr).fromYjs) return false;
  for (let i = 0; i < tr.steps.length; i++) {
    const step = tr.steps[i];
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) continue;
    if (!(step instanceof ReplaceStep)) return false;
    const { from, to, slice } = step as unknown as { from: number; to: number; slice: Slice };
    if (slice.openStart !== 0 || slice.openEnd !== 0) return false;
    let inline = true;
    slice.content.forEach((node) => {
      if (!node.isInline) inline = false;
    });
    if (!inline) return false;
    const doc = tr.docs[i];
    const $from = doc.resolve(from);
    const $to = doc.resolve(to);
    if (!$from.parent.isTextblock || !$from.sameParent($to) || $from.depth < 2) return false;
    const root = doc.firstChild;
    if (!root || $from.index(1) === root.childCount - 1) return false;
  }
  return true;
}

/** Lo calculado, con las posiciones corridas y los nodos de ahora (lo escondido es lo mismo). */
function mapAnalysis(analysis: Analysis, tr: Transaction): Analysis {
  if (analysis.blocks.size === 0) return analysis;
  const blocks = new Map<string, BlockAt>();
  for (const [id, at] of analysis.blocks) {
    const pos = tr.mapping.map(at.pos);
    blocks.set(id, { node: tr.doc.nodeAt(pos) ?? at.node, pos });
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

function createCollapsePlugin(options: CollapseOptions): Plugin<CollapseState> {
  return new Plugin<CollapseState>({
    key: collapseKey,
    state: {
      init: (_, state) => build(state.doc, new Map(options.initial ?? [])),
      apply: (tr, old) => {
        const meta = tr.getMeta(collapseKey) as CollapseMeta | undefined;
        // Escribir en un renglón no cambia qué se esconde: se corren las posiciones y las decoraciones, sin
        // volver a calcular todo en cada tecla (auditoría, punto 7).
        if (!meta && tr.docChanged && textOnly(tr)) {
          return { records: old.records, analysis: mapAnalysis(old.analysis, tr), decorations: old.decorations.map(tr.mapping, tr.doc) };
        }
        let records = tr.docChanged ? remapRecords(tr, old, old.records) : old.records;
        if (meta) records = meta.records;
        if (!tr.docChanged && records === old.records) return old;
        if (!tr.docChanged && sameRecords(records, old.records)) return old;
        const next = build(tr.doc, records);
        // Si lo escondido quedó igual, se conservan los mismos objetos (así nadie vuelve a medir de más).
        if (sameStructure(next.analysis, old.analysis)) {
          next.analysis = { ...next.analysis, hidden: old.analysis.hidden, collapsed: old.analysis.collapsed };
        }
        return next;
      },
    },
    appendTransaction: appendCollapse,
    props: {
      decorations: (state) => collapseKey.getState(state)?.decorations,
      handleDOMEvents: {
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
        cut: (view) => {
          widenForClipboard(view);
          return false;
        },
      },
    },
    view: (editorView) => {
      let paused = new WeakSet<HTMLIFrameElement>();
      // La búsqueda en la página (Docs/Doc_Buscar.md) cuenta lo que está en secciones colapsadas y, al ir ahí, lo
      // abre para vos. Lo registra el editor abierto.
      const hooks: FindCollapseHooks = {
        isHidden: (blockId) => !!collapseKey.getState(editorView.state)?.analysis.hidden.has(blockId),
        reveal: (blockId) => void revealBlock(editorView, blockId),
        anyHidden: () => (collapseKey.getState(editorView.state)?.analysis.hidden.size ?? 0) > 0,
      };
      setFindCollapseHooks(hooks);
      findHooksOwner = hooks;
      return {
        destroy: () => {
          if (findHooksOwner === hooks) {
            setFindCollapseHooks(null);
            findHooksOwner = null;
          }
        },
        update: (view, prev) => {
          const now = collapseKey.getState(view.state);
          const was = collapseKey.getState(prev);
          if (!now || now === was) return;
          if (!was || !sameRecords(now.records, was.records)) options.save?.(now.records);
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
          if (structural || !sameRecords(now.records, was!.records)) for (const fn of listeners.get(view) ?? []) fn();
        },
      };
    },
  });
}

/** Los enganches de la búsqueda que están registrados (los del último editor abierto). */
let findHooksOwner: FindCollapseHooks | null = null;

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
    'Mod-Alt-Enter': withView(toggleAtSelection),
    // Para todos (entrega 2); por ahora, igual que sin Shift.
    'Shift-Mod-Alt-Enter': withView(toggleAtSelection),
    Enter: withView(enterAfter),
    Delete: withView(deleteAtEnd),
    Backspace: withView(backspaceAfter),
    ArrowDown: withView((view) => skipForward(view, 'down', false)),
    'Shift-ArrowDown': withView((view) => skipForward(view, 'down', true)),
    ArrowRight: withView((view) => skipForward(view, 'right', false)),
    'Shift-ArrowRight': withView((view) => skipForward(view, 'right', true)),
  },
}));

/** El atajo, como se ve en los tooltips. */
export const COLLAPSE_SHORTCUT_LABEL = IS_MAC ? '⌘⌥↩' : 'Ctrl+Alt+Enter';
