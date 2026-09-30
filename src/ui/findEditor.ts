import { createExtension } from '@blocknote/core';
import type { Mark, Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, ySyncPluginKey, yUndoPluginKey } from 'y-prosemirror';
import type * as Y from 'yjs';
import { unitsFromPM, unitPos, type UnitField } from '../search/extract';
import { searchText, type SearchOptions } from '../search/normalize';

// Buscar y reemplazar en la página (Docs/Doc_Buscar.md, secciones 5 y 6, con las correcciones de la
// auditoría). Buscar no cambia el documento: las coincidencias se marcan con decoraciones, como las marcas de
// guion y las filas de fotos. Reemplazar es una edición común: pasa por el editor, se guarda y se sube como
// cualquier otra, y se deshace con Ctrl/⌘+Z (un solo paso para "Reemplazar todo").

/** Marca de las transacciones de reemplazo, y de su paso en la pila de deshacer (P.11 no abre secciones por ellas). */
export const FIND_REPLACE_META = 'sd-find-replace';
/** Más que esto no se marca ni se cuenta ("más de 1000"). */
export const MAX_MATCHES = 1000;
/** Espera para volver a buscar después de un cambio del documento. */
const REFRESH_MS = 150;

export interface FindMatch {
  blockId: string;
  field: UnitField;
  from: number;
  to: number;
}

export interface FindState {
  query: string;
  options: SearchOptions;
  matches: FindMatch[];
  /** Hubo más de `MAX_MATCHES`. */
  truncated: boolean;
  /** La coincidencia actual (-1: ninguna). */
  current: number;
  decorations: DecorationSet;
  /** El documento cambió y las coincidencias son las de antes, corridas (se vuelve a buscar enseguida). */
  stale: boolean;
}

type FindMeta =
  | { kind: 'set'; query: string; options: SearchOptions; anchor: number }
  | { kind: 'refresh'; anchor?: number }
  | { kind: 'current'; index: number }
  | { kind: 'clear' };

export const findKey = new PluginKey<FindState>('shotdocs-find');

const EMPTY: FindState = {
  query: '',
  options: {},
  matches: [],
  truncated: false,
  current: -1,
  decorations: DecorationSet.empty,
  stale: false,
};

// --- Secciones colapsadas (P.11) ---------------------------------------------------------------------------

/**
 * Lo que la búsqueda le pide al colapso de secciones (P.11, Docs/Doc_Colapsar.md, sección 6). Sin P.11 no
 * hay nada registrado y todo se ve. `reveal` abre para la persona los títulos que esconden el bloque.
 */
export interface FindCollapseHooks {
  isHidden(blockId: string): boolean;
  reveal(blockId: string): void;
}

let collapseHooks: FindCollapseHooks | null = null;

/** Lo registra el editor cuando existe el colapso (P.11); `null` lo saca. */
export function setFindCollapseHooks(hooks: FindCollapseHooks | null): void {
  collapseHooks = hooks;
}

/** Cuántas coincidencias están en secciones colapsadas (0 sin P.11). */
export function hiddenCount(matches: FindMatch[]): number {
  if (!collapseHooks) return 0;
  const seen = new Map<string, boolean>();
  let n = 0;
  for (const m of matches) {
    let hidden = seen.get(m.blockId);
    if (hidden === undefined) seen.set(m.blockId, (hidden = collapseHooks.isHidden(m.blockId)));
    if (hidden) n++;
  }
  return n;
}

// --- Buscar ------------------------------------------------------------------------------------------------

/** Las coincidencias del documento, en orden, hasta `limit`. */
function collectMatches(doc: PMNode, query: string, options: SearchOptions, limit: number): { matches: FindMatch[]; truncated: boolean } {
  const matches: FindMatch[] = [];
  if (!query.trim()) return { matches, truncated: false };
  for (const unit of unitsFromPM(doc)) {
    for (const [s, e] of searchText(unit.text, query, options)) {
      if (matches.length >= limit) return { matches, truncated: true };
      if (unit.field === 'text') matches.push({ blockId: unit.blockId, field: 'text', from: unitPos(unit, s), to: unitPos(unit, e) });
      else matches.push({ blockId: unit.blockId, field: unit.field, from: unit.nodePos, to: unit.nodePos + unit.nodeSize });
    }
  }
  return { matches, truncated: false };
}

/** Las coincidencias que se marcan y se cuentan (hasta `MAX_MATCHES`). */
export function computeMatches(doc: PMNode, query: string, options: SearchOptions): { matches: FindMatch[]; truncated: boolean } {
  return collectMatches(doc, query, options, MAX_MATCHES);
}

function decorate(doc: PMNode, matches: FindMatch[], current: number): DecorationSet {
  const decorations: Decoration[] = [];
  const blocks = new Map<number, { to: number; current: boolean }>();
  matches.forEach((m, i) => {
    if (m.field === 'text') {
      decorations.push(Decoration.inline(m.from, m.to, { class: i === current ? 'sd-find-hit sd-find-current' : 'sd-find-hit' }));
    } else {
      // Un pie o un nombre: el bloque entero (el pie se subraya y la tarjeta del adjunto lleva un contorno).
      const prev = blocks.get(m.from);
      blocks.set(m.from, { to: m.to, current: (prev?.current ?? false) || i === current });
    }
  });
  for (const [from, { to, current: isCurrent }] of blocks) {
    decorations.push(Decoration.node(from, to, { class: isCurrent ? 'sd-find-block sd-find-block-current' : 'sd-find-block' }));
  }
  return DecorationSet.create(doc, decorations);
}

/** La primera coincidencia desde `anchor` (da la vuelta al final). */
function nearest(matches: FindMatch[], anchor: number): number {
  if (matches.length === 0) return -1;
  const at = matches.findIndex((m) => m.from >= anchor);
  return at < 0 ? 0 : at;
}

function build(doc: PMNode, query: string, options: SearchOptions, anchor: number): FindState {
  const { matches, truncated } = computeMatches(doc, query, options);
  const current = nearest(matches, anchor);
  return { query, options, matches, truncated, current, decorations: decorate(doc, matches, current), stale: false };
}

// --- La actual, anclada al Y.Doc ------------------------------------------------------------------------
//
// Un cambio que llega de otro dispositivo reemplaza el documento entero en ProseMirror (y-prosemirror): las
// posiciones corridas ya no sirven. La actual se guarda también como posición relativa de Yjs, que sigue al
// texto; así, después de un cambio de otro, se vuelve a buscar desde el mismo lugar y "Reemplazar" sabe si la
// coincidencia sigue siendo la misma.

interface Binding {
  doc: Y.Doc;
  type: Y.XmlFragment;
  mapping: unknown;
}

const anchors = new WeakMap<EditorView, { from: Y.RelativePosition; to: Y.RelativePosition } | null>();

function bindingOf(state: EditorState): Binding | null {
  return ((ySyncPluginKey.getState(state) as { binding?: Binding } | undefined)?.binding ?? null) as Binding | null;
}

/** Guarda dónde está la actual (después de cada cambio de la actual). */
function rememberCurrent(view: EditorView): void {
  const state = getFindState(view.state);
  const match = state.matches[state.current];
  const binding = bindingOf(view.state);
  if (!match || !binding || state.stale) {
    if (!match) anchors.set(view, null);
    return;
  }
  try {
    anchors.set(view, {
      from: absolutePositionToRelativePosition(match.from, binding.type, binding.mapping as never),
      to: absolutePositionToRelativePosition(match.to, binding.type, binding.mapping as never),
    });
  } catch {
    anchors.set(view, null);
  }
}

/** Dónde está ahora la actual que se guardó, o `null` si no se sabe. */
function currentPlace(view: EditorView): { from: number; to: number } | null {
  const anchor = anchors.get(view);
  const binding = bindingOf(view.state);
  if (!anchor || !binding) {
    const state = getFindState(view.state);
    const match = state.matches[state.current];
    return match ? { from: match.from, to: match.to } : null;
  }
  const from = relativePositionToAbsolutePosition(binding.doc, binding.type, anchor.from, binding.mapping as never);
  const to = relativePositionToAbsolutePosition(binding.doc, binding.type, anchor.to, binding.mapping as never);
  return from === null || to === null ? null : { from, to };
}

const listeners = new WeakMap<EditorView, Set<() => void>>();

/** Avisa cada vez que cambia la búsqueda de ese editor (coincidencias, la actual). */
export function subscribeFind(view: EditorView, fn: () => void): () => void {
  let set = listeners.get(view);
  if (!set) listeners.set(view, (set = new Set()));
  set.add(fn);
  return () => set.delete(fn);
}

export const findPlugin = new Plugin<FindState>({
  key: findKey,
  state: {
    init: () => EMPTY,
    apply: (tr, old) => {
      const meta = tr.getMeta(findKey) as FindMeta | undefined;
      if (meta?.kind === 'clear') return EMPTY;
      if (meta?.kind === 'set') return build(tr.doc, meta.query, meta.options, meta.anchor);
      if (!old.query) return old;
      if (meta?.kind === 'refresh') {
        const anchor = meta.anchor ?? old.matches[old.current]?.from ?? 0;
        return build(tr.doc, old.query, old.options, anchor);
      }
      let state = old;
      if (tr.docChanged) {
        // Se corren las que había (el resaltado sigue en su lugar) y se vuelve a buscar en un momento.
        const matches = old.matches
          .map((m) => ({ ...m, from: tr.mapping.map(m.from, 1), to: tr.mapping.map(m.to, -1) }))
          .map((m) => ({ ...m, to: Math.max(m.from, m.to) }));
        state = { ...old, matches, decorations: old.decorations.map(tr.mapping, tr.doc), stale: true };
      }
      if (meta?.kind === 'current' && state.matches.length > 0) {
        const current = ((meta.index % state.matches.length) + state.matches.length) % state.matches.length;
        state = { ...state, current, decorations: decorate(tr.doc, state.matches, current) };
      }
      return state;
    },
  },
  props: {
    decorations: (state) => findKey.getState(state)?.decorations,
  },
  view: () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return {
      update: (view, prev) => {
        const state = findKey.getState(view.state);
        if (state !== findKey.getState(prev)) for (const fn of listeners.get(view) ?? []) fn();
        if (!state?.stale || timer) return;
        timer = setTimeout(() => {
          timer = undefined;
          if (view.isDestroyed) return;
          if (findKey.getState(view.state)?.stale) refreshNow(view);
        }, REFRESH_MS);
      },
      destroy: () => clearTimeout(timer),
    };
  },
});

export const findExtension = createExtension({
  key: 'shotdocs-find',
  prosemirrorPlugins: [findPlugin],
});

export function getFindState(state: EditorState): FindState {
  return findKey.getState(state) ?? EMPTY;
}

/** Busca `query` en la página; la actual es la primera desde la selección. */
export function setFind(view: EditorView, query: string, options: SearchOptions): void {
  view.dispatch(view.state.tr.setMeta(findKey, { kind: 'set', query, options, anchor: view.state.selection.from } satisfies FindMeta));
  rememberCurrent(view);
}

/**
 * Vuelve a buscar ya. La actual queda en la coincidencia desde `anchor` o, sin él, desde donde estaba la
 * actual (siguiéndola aunque haya cambios de otros).
 */
function refreshNow(view: EditorView, anchor?: number): void {
  const at = anchor ?? currentPlace(view)?.from;
  view.dispatch(view.state.tr.setMeta(findKey, { kind: 'refresh', anchor: at } satisfies FindMeta));
  rememberCurrent(view);
}

/** Pasa a la siguiente (1) o a la anterior (-1), dando la vuelta, y la lleva a la vista. */
export function stepFind(view: EditorView, dir: 1 | -1): FindMatch | null {
  if (getFindState(view.state).stale) refreshNow(view);
  const state = getFindState(view.state);
  if (state.matches.length === 0) return null;
  view.dispatch(view.state.tr.setMeta(findKey, { kind: 'current', index: state.current + dir } satisfies FindMeta));
  rememberCurrent(view);
  return revealCurrent(view);
}

/** Lleva a la vista la coincidencia actual; si está en una sección colapsada, primero la abre (P.11). */
export function revealCurrent(view: EditorView): FindMatch | null {
  const state = getFindState(view.state);
  const match = state.matches[state.current];
  if (!match) return null;
  if (collapseHooks?.isHidden(match.blockId)) collapseHooks.reveal(match.blockId);
  const scroll = () => {
    const el = view.dom.querySelector<HTMLElement>('.sd-find-current, .sd-find-block-current');
    el?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(scroll);
  else scroll();
  return match;
}

/** Saca los resaltados (lo buscado quedó vacío), sin tocar la selección. */
export function clearFind(view: EditorView): void {
  if (getFindState(view.state).query) view.dispatch(view.state.tr.setMeta(findKey, { kind: 'clear' } satisfies FindMeta));
  anchors.set(view, null);
}

/**
 * Cierra la búsqueda. Con `select`, deja elegida la coincidencia actual (se puede escribir encima), como VS
 * Code.
 */
export function closeFind(view: EditorView, { select = true }: { select?: boolean } = {}): void {
  const state = getFindState(view.state);
  const match = state.matches[state.current];
  const tr = view.state.tr.setMeta(findKey, { kind: 'clear' } satisfies FindMeta);
  if (select && match?.field === 'text' && !state.stale) {
    try {
      tr.setSelection(TextSelection.create(tr.doc, match.from, match.to));
    } catch {
      // La posición ya no es de texto: la selección queda donde estaba.
    }
  }
  view.dispatch(tr);
}

// --- Reemplazar --------------------------------------------------------------------------------------------

export interface ReplaceResult {
  replaced: number;
  /** Coincidencias en pies y nombres de archivo: se encuentran pero no se reemplazan (todavía). */
  skippedFields: number;
  /** Coincidencias que borrarían un link entero (y romperían una tarjeta de Drive). */
  skippedLinks: number;
  /** No se pudo: sin permiso de edición, o la coincidencia ya no era la misma (se volvió a buscar). */
  blocked?: 'readonly' | 'changed';
  /** El paso de deshacer que dejó el reemplazo (para el *Deshacer* del aviso). */
  undoItem?: unknown;
}

interface EditorLike {
  prosemirrorView?: EditorView;
  isEditable: boolean;
}

type UndoManagerLike = Y.UndoManager & { currStackItem?: { meta: Map<unknown, unknown> } | null };

const tagging = new WeakSet<object>();
let replacing = false;

function undoManagerOf(state: EditorState): UndoManagerLike | null {
  return ((yUndoPluginKey.getState(state) as { undoManager?: UndoManagerLike } | undefined)?.undoManager ?? null) as UndoManagerLike | null;
}

/**
 * Marca en la pila de deshacer los pasos de un reemplazo, y los que salen de deshacerlos o rehacerlos (Yjs
 * arma un paso nuevo en la otra pila: se marca si el que se está aplicando estaba marcado).
 */
function ensureTagging(um: UndoManagerLike): void {
  if (tagging.has(um)) return;
  tagging.add(um);
  um.on('stack-item-added', ({ stackItem }: { stackItem: { meta: Map<unknown, unknown> } }) => {
    if (replacing || um.currStackItem?.meta.get(FIND_REPLACE_META) === true) stackItem.meta.set(FIND_REPLACE_META, true);
  });
}

/**
 * Si lo que se está aplicando ahora es deshacer o rehacer un reemplazo (para el colapso de secciones, P.11:
 * no abre lo escondido por eso).
 */
export function isFindReplaceUndo(state: EditorState): boolean {
  return undoManagerOf(state)?.currStackItem?.meta.get(FIND_REPLACE_META) === true;
}

/** Lo que dispara `fn` es un solo paso de deshacer, separado de lo que se escribió antes y después. */
function asOneStep(view: EditorView, fn: () => void): unknown {
  const um = undoManagerOf(view.state);
  if (um) ensureTagging(um);
  um?.stopCapturing();
  replacing = true;
  const before = um?.undoStack.length ?? 0;
  try {
    fn();
  } finally {
    replacing = false;
    um?.stopCapturing();
  }
  return um && um.undoStack.length > before ? um.undoStack[um.undoStack.length - 1] : undefined;
}

/** Si el *Deshacer* del aviso todavía corresponde (el último paso de la pila es ese reemplazo). */
export function canUndoReplace(view: EditorView | undefined, item: unknown): boolean {
  const um = view ? undoManagerOf(view.state) : null;
  return !!um && !!item && um.undoStack[um.undoStack.length - 1] === item;
}

function linkRanges(doc: PMNode, from: number, to: number): { from: number; to: number; mark: Mark }[] {
  const out: { from: number; to: number; mark: Mark }[] = [];
  const $from = doc.resolve(from);
  const parent = $from.parent;
  const start = $from.start();
  let open: { from: number; to: number; mark: Mark } | null = null;
  parent.forEach((child, offset) => {
    const link = child.isText ? child.marks.find((m) => m.type.name === 'link') : undefined;
    const at = start + offset;
    if (open && link && open.mark.eq(link)) {
      open.to = at + child.nodeSize;
      return;
    }
    if (open) out.push(open);
    open = link ? { from: at, to: at + child.nodeSize, mark: link } : null;
  });
  if (open) out.push(open);
  return out.filter((r) => r.to > from && r.from < to);
}

/**
 * Reemplazar borraría un link entero: la coincidencia lo cubre todo y el texto nuevo no lo lleva (vacío, o
 * la coincidencia empieza afuera del link). Una tarjeta de Drive se quedaría sin su `href`.
 */
function wouldDropLink(doc: PMNode, m: FindMatch, text: string, marks: readonly Mark[]): boolean {
  return linkRanges(doc, m.from, m.to).some(
    (r) => r.from >= m.from && r.to <= m.to && (text === '' || !marks.some((mk) => mk.eq(r.mark))),
  );
}

function firstMarks(doc: PMNode, pos: number): readonly Mark[] {
  return doc.nodeAt(pos)?.marks ?? [];
}

function replaceTr(state: EditorState, m: FindMatch, text: string): Transaction {
  const tr = text ? state.tr.replaceWith(m.from, m.to, state.schema.text(text, firstMarks(state.doc, m.from))) : state.tr.delete(m.from, m.to);
  return tr.setMeta(FIND_REPLACE_META, true);
}

/** Reemplaza la coincidencia actual y pasa a la siguiente. */
export function replaceCurrent(editor: EditorLike, text: string): ReplaceResult {
  const result: ReplaceResult = { replaced: 0, skippedFields: 0, skippedLinks: 0 };
  const view = editor.prosemirrorView;
  if (!view) return result;
  if (!editor.isEditable || !view.editable) return { ...result, blocked: 'readonly' };
  if (!getFindState(view.state).query) return result;
  // Alguien pudo cambiar el texto desde que se buscó: se busca de nuevo desde donde estaba la actual, y solo
  // se reemplaza si es exactamente la misma.
  const place = currentPlace(view);
  refreshNow(view, place?.from);
  const state = getFindState(view.state);
  const match = state.matches[state.current];
  if (!match || !place || match.from !== place.from || match.to !== place.to) {
    revealCurrent(view);
    return { ...result, blocked: 'changed' };
  }
  if (match.field !== 'text') {
    stepFind(view, 1);
    return { ...result, skippedFields: 1 };
  }
  if (wouldDropLink(view.state.doc, match, text, firstMarks(view.state.doc, match.from))) {
    stepFind(view, 1);
    return { ...result, skippedLinks: 1 };
  }
  const undoItem = asOneStep(view, () => view.dispatch(replaceTr(view.state, match, text)));
  refreshNow(view, match.from + text.length);
  revealCurrent(view);
  return { ...result, replaced: 1, undoItem };
}

/** Reemplaza todas: una transacción por coincidencia, de atrás para adelante, en un solo paso de deshacer. */
export function replaceAll(editor: EditorLike, text: string): ReplaceResult {
  const result: ReplaceResult = { replaced: 0, skippedFields: 0, skippedLinks: 0 };
  const view = editor.prosemirrorView;
  if (!view) return result;
  if (!editor.isEditable || !view.editable) return { ...result, blocked: 'readonly' };
  const state = getFindState(view.state);
  if (!state.query) return result;
  // Sin el tope de la vista: se reemplazan todas, también las que pasan de 1000.
  const all = collectMatches(view.state.doc, state.query, state.options, Infinity).matches;
  const targets: FindMatch[] = [];
  for (const m of all) {
    if (m.field !== 'text') result.skippedFields++;
    else if (wouldDropLink(view.state.doc, m, text, firstMarks(view.state.doc, m.from))) result.skippedLinks++;
    else targets.push(m);
  }
  if (targets.length === 0) return result;
  result.undoItem = asOneStep(view, () => {
    for (let i = targets.length - 1; i >= 0; i--) view.dispatch(replaceTr(view.state, targets[i], text));
  });
  result.replaced = targets.length;
  refreshNow(view, 0);
  return result;
}

/** Deshace el reemplazo si todavía es lo último en la pila (el *Deshacer* del aviso). */
export function undoReplace(view: EditorView | undefined, item: unknown): boolean {
  if (!view || !canUndoReplace(view, item)) return false;
  undoManagerOf(view.state)?.undo();
  return true;
}
