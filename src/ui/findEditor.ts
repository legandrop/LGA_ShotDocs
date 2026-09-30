import { createExtension } from '@blocknote/core';
import type { Mark, Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Mapping, StepMap } from '@tiptap/pm/transform';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, ySyncPluginKey, yUndoPluginKey } from '@y/prosemirror';
import * as Y from '@y/y';
import { unitsFromPM, unitPos, type PMUnit, type UnitField } from '../search/extract';
import { normalize, normalizeQuery, searchNormalized, type Normalized, type SearchOptions } from '../search/normalize';
import { FIND_REPLACE_META } from './editorMeta';

// Buscar y reemplazar en la página (Docs/Doc_Buscar.md, secciones 5 y 6, con las correcciones de las
// auditorías). Buscar no cambia el documento: las coincidencias se marcan con decoraciones, como las marcas de
// guion y las filas de fotos. Reemplazar es una edición común: se guarda y se sube como cualquier otra, y se
// deshace con Ctrl/⌘+Z (un solo paso para "Reemplazar todo", que escribe directo en el Y.Doc en una sola
// transacción).

// La marca de las transacciones de reemplazo y de su paso en la pila de deshacer (P.11 no abre secciones por
// ellas): la misma clave que usa el colapso, en `editorMeta.ts`.
export { FIND_REPLACE_META };
/** Más que esto no se marca ni se cuenta ("más de 1000"). */
export const MAX_MATCHES = 1000;
/** Espera para volver a buscar después de un cambio del documento. */
const REFRESH_MS = 150;
/** Escribiendo sin parar, se vuelve a buscar igual cada tanto. */
const MAX_WAIT_MS = 1000;

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
  /** Un cambio de otro tocó varios bloques: se vuelve a buscar ya, sin esperar. */
  urgent?: boolean;
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
  /** Si hay algo colapsado en la página (sin esto, se pregunta bloque por bloque). */
  anyHidden?(): boolean;
}

let collapseHooks: FindCollapseHooks | null = null;

/** Lo registra el editor cuando existe el colapso (P.11); `null` lo saca. */
export function setFindCollapseHooks(hooks: FindCollapseHooks | null): void {
  collapseHooks = hooks;
}

// --- Listas plegables de BlockNote ---------------------------------------------------------------------
//
// Una "Lista plegable" (`toggleListItem`, o un título plegable viejo) cerrada esconde sus hijos: BlockNote pone
// `data-show-children="false"` en su `.bn-toggle-wrapper` y guarda el estado en el navegador. Una coincidencia
// ahí adentro se cuenta como escondida y, al ir a ella, se abren las listas de arriba con su propio botón.

// Ids de BlockNote: uuid, o `initialBlockId` en la semilla.
const BLOCK_ID = /^[A-Za-z0-9_-]{1,128}$/;
const CONTAINER = '[data-node-type="blockContainer"]';

function blockElement(view: EditorView, blockId: string): HTMLElement | null {
  if (!BLOCK_ID.test(blockId)) return null;
  return view.dom.querySelector<HTMLElement>(`${CONTAINER}[data-id="${blockId}"]`);
}

/** Las listas plegables cerradas que esconden el bloque, de la de más afuera a la de más adentro. */
function closedToggles(view: EditorView, blockId: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  let parent = blockElement(view, blockId)?.parentElement?.closest<HTMLElement>(CONTAINER) ?? null;
  while (parent && view.dom.contains(parent)) {
    const wrapper = parent.querySelector<HTMLElement>(':scope > .bn-block-content .bn-toggle-wrapper');
    if (wrapper?.getAttribute('data-show-children') === 'false') out.unshift(wrapper);
    parent = parent.parentElement?.closest<HTMLElement>(CONTAINER) ?? null;
  }
  return out;
}

/**
 * Los bloques escondidos por listas plegables cerradas: una sola pasada por el DOM (nada si no hay ninguna
 * cerrada), y una clave que cambia cuando se abre o se cierra alguna.
 */
function closedToggleBlocks(view: EditorView): { ids: Set<string>; key: string } {
  const ids = new Set<string>();
  const keys: string[] = [];
  for (const wrapper of view.dom.querySelectorAll<HTMLElement>('.bn-toggle-wrapper[data-show-children="false"]')) {
    const container = wrapper.closest<HTMLElement>(CONTAINER);
    if (!container) continue;
    keys.push(container.dataset.id ?? '');
    for (const child of container.querySelectorAll<HTMLElement>(`:scope > .bn-block-group ${CONTAINER}`)) {
      if (child.dataset.id) ids.add(child.dataset.id);
    }
  }
  return { ids, key: keys.join(',') };
}

const hiddenMemo = new WeakMap<FindMatch[], { key: string; hooks: FindCollapseHooks | null; count: number }>();

/**
 * Cuántas coincidencias están escondidas: en listas plegables cerradas o en secciones colapsadas (P.11). Se
 * guarda por lista de coincidencias (la barra lo pide en cada dibujo) mientras no se abra ni se cierre nada.
 */
export function hiddenCount(matches: FindMatch[], view?: EditorView): number {
  const hooks = collapseHooks && collapseHooks.anyHidden?.() !== false ? collapseHooks : null;
  if (!hooks && !view) return 0;
  const toggles = view ? closedToggleBlocks(view) : { ids: new Set<string>(), key: '' };
  if (!hooks && toggles.ids.size === 0) return 0;
  const memo = hiddenMemo.get(matches);
  // Con P.11 lo colapsado puede cambiar sin que cambie el DOM que se mira acá: sin memoria.
  if (!hooks && memo && memo.key === toggles.key && memo.hooks === null) return memo.count;
  const seen = new Map<string, boolean>();
  let count = 0;
  for (const m of matches) {
    let hidden = seen.get(m.blockId);
    if (hidden === undefined) seen.set(m.blockId, (hidden = toggles.ids.has(m.blockId) || !!hooks?.isHidden(m.blockId)));
    if (hidden) count++;
  }
  hiddenMemo.set(matches, { key: toggles.key, hooks, count });
  return count;
}

/** Abre lo que esconde el bloque: las listas plegables de arriba y las secciones colapsadas (P.11). */
function revealBlock(view: EditorView, blockId: string): void {
  const toggles = closedToggles(view, blockId);
  const collapsed = !!collapseHooks?.isHidden(blockId);
  // Abrir cambia los altos: las marcas de hoja tienen que recalcular aunque en el mismo momento cambien los
  // resaltados (ver `takeFindOnlyChanges`).
  if (toggles.length > 0 || collapsed) docChanges++;
  for (const wrapper of toggles) wrapper.querySelector<HTMLElement>(':scope > .bn-toggle-button')?.click();
  if (collapsed) collapseHooks!.reveal(blockId);
}

// --- Buscar ------------------------------------------------------------------------------------------------

// El texto normalizado de cada bloque de texto: mientras el nodo de ProseMirror sea el mismo (no cambió), no se
// vuelve a normalizar al buscar otra vez.
const normalized = new WeakMap<PMNode, { exact?: Normalized; folded?: Normalized }>();

function normalizedUnit(unit: PMUnit, options: SearchOptions): Normalized {
  if (!unit.node) return normalize(unit.text, options);
  let entry = normalized.get(unit.node);
  if (!entry) normalized.set(unit.node, (entry = {}));
  if (options.matchCase) return (entry.exact ??= normalize(unit.text, options));
  return (entry.folded ??= normalize(unit.text, options));
}

/** Las coincidencias del documento, en orden, hasta `limit`. */
function collectMatches(doc: PMNode, query: string, options: SearchOptions, limit: number): { matches: FindMatch[]; truncated: boolean } {
  const matches: FindMatch[] = [];
  const q = normalizeQuery(query, options);
  if (!q) return { matches, truncated: false };
  for (const unit of unitsFromPM(doc)) {
    for (const [s, e] of searchNormalized(unit.text, normalizedUnit(unit, options), q, options)) {
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
  type: Y.Type;
  renderer: Y.AbstractRenderer | null;
}

/** Una transacción de ProseMirror que armó la vinculación con Yjs (un cambio que llegó del Y.Doc). */
function fromYjs(tr: Transaction): boolean {
  return !!tr.getMeta('y-sync-transaction');
}

/** Origen de Yjs de "Reemplazar todo": no puede ser el del plugin (la vinculación lo toma como su propio eco). */
const FIND_REPLACE_ORIGIN = { findReplace: true };

const anchors = new WeakMap<EditorView, { from: Y.RelativePosition; to: Y.RelativePosition } | null>();

function bindingOf(state: EditorState): Binding | null {
  const st = ySyncPluginKey.getState(state) as { ytype?: Y.Type | null; renderer?: Y.AbstractRenderer | null } | undefined;
  if (!st?.ytype?.doc) return null;
  return { doc: st.ytype.doc, type: st.ytype, renderer: st.renderer ?? null };
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
      from: absolutePositionToRelativePosition(view.state.doc.resolve(match.from), binding.type, binding.renderer),
      to: absolutePositionToRelativePosition(view.state.doc.resolve(match.to), binding.type, binding.renderer),
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
  const from = relativePositionToAbsolutePosition(anchor.from, binding.type, view.state.doc, binding.renderer);
  const to = relativePositionToAbsolutePosition(anchor.to, binding.type, view.state.doc, binding.renderer);
  return from === null || to === null ? null : { from, to };
}

/** El bloque (`blockContainer`) más cercano que contiene una posición, o -1. */
function containerAt(doc: PMNode, pos: number): number {
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type.name === 'blockContainer') return $pos.before(d);
  return -1;
}

/**
 * Si un cambio de otro dispositivo tocó más de un bloque (dos lugares lejanos en una misma transacción): corrido
 * por un solo tramo, lo que quedó en el medio se juntaría. Entonces se vuelve a buscar enseguida.
 */
function touchesSeveralBlocks(before: PMNode, after: PMNode): boolean {
  const start = before.content.findDiffStart(after.content);
  const end = start === null ? null : before.content.findDiffEnd(after.content);
  if (start === null || !end) return false;
  const last = Math.max(start, end.a);
  return containerAt(before, start) !== containerAt(before, last);
}

/**
 * Un cambio de otro dispositivo llega como "reemplazar el documento entero" (y-prosemirror): corrido por esa
 * transacción, todo resaltado se juntaría en un punto hasta volver a buscar. Se corre solo por lo que de verdad
 * cambió (desde la primera diferencia hasta la última).
 */
function narrowMapping(before: PMNode, after: PMNode): Mapping {
  const start = before.content.findDiffStart(after.content);
  if (start === null) return new Mapping();
  const end = before.content.findDiffEnd(after.content);
  if (!end) return new Mapping();
  let { a: endA, b: endB } = end;
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }
  return new Mapping([new StepMap([start, endA - start, endB - start])]);
}

const listeners = new WeakMap<EditorView, Set<() => void>>();

// Lo que cambió en el editor desde la última vez que preguntaron las marcas de hoja (SheetBreaks.tsx):
// resaltar parte y vuelve a unir los nodos de texto del DOM, pero no cambia ningún alto.
let docChanges = 0;
let highlightChanges = 0;

/**
 * Si, desde la última vez que se preguntó, en el editor solo cambiaron los resaltados de la búsqueda (no el
 * documento). Lo usan las marcas de hoja para no volver a paginar por eso.
 */
export function takeFindOnlyChanges(): boolean {
  const only = highlightChanges > 0 && docChanges === 0;
  docChanges = 0;
  highlightChanges = 0;
  return only;
}

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
        const remote = fromYjs(tr);
        const mapping = remote ? narrowMapping(tr.before, tr.doc) : tr.mapping;
        const matches = old.matches
          .map((m) => ({ ...m, from: mapping.map(m.from, 1), to: mapping.map(m.to, -1) }))
          .map((m) => ({ ...m, to: Math.max(m.from, m.to) }));
        const urgent = !!remote && touchesSeveralBlocks(tr.before, tr.doc);
        state = { ...old, matches, decorations: old.decorations.map(mapping, tr.doc), stale: true, urgent: old.urgent || urgent };
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
    /** Desde cuándo están corridas las marcas sin volver a buscar (para no esperar para siempre). */
    let staleSince = 0;
    // Se vuelve a buscar cuando se deja de escribir un momento (cada cambio corre la espera), pero nunca más de
    // `MAX_WAIT_MS` desde el primer cambio; y nunca en medio de una composición (acentos, IME).
    const schedule = (view: EditorView, delay: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        if (view.isDestroyed || !findKey.getState(view.state)?.stale) return;
        if (view.composing) schedule(view, REFRESH_MS);
        else refreshNow(view);
      }, delay);
    };
    return {
      update: (view, prev) => {
        const state = findKey.getState(view.state);
        if (view.state.doc !== prev.doc) docChanges++;
        else if (state?.decorations !== findKey.getState(prev)?.decorations) highlightChanges++;
        if (state !== findKey.getState(prev)) for (const fn of listeners.get(view) ?? []) fn();
        if (!state?.stale) {
          staleSince = 0;
          return;
        }
        if (view.state.doc === prev.doc) return;
        const now = Date.now();
        if (!staleSince) staleSince = now;
        if (state.urgent && !view.composing) schedule(view, 0);
        else schedule(view, Math.max(0, Math.min(REFRESH_MS, staleSince + MAX_WAIT_MS - now)));
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

/**
 * Lleva a la vista la coincidencia actual: si está escondida (una lista plegable cerrada, una sección
 * colapsada de P.11) primero la abre; después la centra, y si igual queda debajo de la barra, corre la barra.
 */
export function revealCurrent(view: EditorView): FindMatch | null {
  const state = getFindState(view.state);
  const match = state.matches[state.current];
  if (!match) return null;
  revealBlock(view, match.blockId);
  const scroll = () => {
    if (view.isDestroyed) return;
    const el = view.dom.querySelector<HTMLElement>('.sd-find-current, .sd-find-block-current');
    el?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    if (el) avoidBar(view, el);
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(scroll);
  else scroll();
  return match;
}

/** Si la barra de buscar tapa la coincidencia (arriba de todo, donde no se puede desplazar más), la baja. */
function avoidBar(view: EditorView, el: HTMLElement): void {
  const bar = (view.dom.closest('article') ?? document).querySelector<HTMLElement>('.find-bar');
  if (!bar) return;
  bar.style.removeProperty('transform');
  const r = el.getBoundingClientRect();
  const b = bar.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return;
  const overlaps = r.bottom > b.top && r.top < b.bottom && r.right > b.left && r.left < b.right;
  if (overlaps) bar.style.transform = `translateY(${Math.ceil(r.bottom - b.top + 8)}px)`;
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
  // "Reemplazar todo" escribe en el Y.Doc con su propio origen: tiene que entrar en la pila de deshacer.
  um.trackedOrigins.add(FIND_REPLACE_ORIGIN);
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

/**
 * Si una transacción de ProseMirror es de un reemplazo: la marcada con `FIND_REPLACE_META`, o la que arma
 * y-prosemirror mientras "Reemplazar todo" escribe en el Y.Doc (llega como un cambio del Y.Doc).
 */
export function isFindReplaceTransaction(tr: Transaction): boolean {
  if (tr.getMeta(FIND_REPLACE_META) === true) return true;
  return replacing && fromYjs(tr);
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
  if (!match || !place || match.from !== place.from || match.to !== place.to || match.from === match.to) {
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

/**
 * Reemplaza todas. Escribe directo en el Y.Doc, en una sola transacción de Yjs (de atrás para adelante, con el
 * origen del editor): y-prosemirror arma una sola transacción de ProseMirror, se guarda y se sube como
 * cualquier edición y queda un solo paso de deshacer. Cada coincidencia se vuelve a comprobar contra el texto
 * del Y.Doc antes de escribir. Si no se puede ubicar alguna en el Y.Doc, va por ProseMirror (una transacción
 * por coincidencia, igual en un solo paso).
 */
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
    else if (m.from === m.to) continue;
    else if (wouldDropLink(view.state.doc, m, text, firstMarks(view.state.doc, m.from))) result.skippedLinks++;
    else targets.push(m);
  }
  if (targets.length === 0) return result;
  const edits = yjsEdits(view, targets);
  if (edits) {
    result.undoItem = asOneStep(view, () =>
      bindingOf(view.state)!.doc.transact(() => {
        for (let i = edits.length - 1; i >= 0; i--) {
          const { ytext, index, length, attrs } = edits[i];
          ytext.delete(index, length);
          if (text) ytext.insert(index, text, { ...attrs });
        }
      }, FIND_REPLACE_ORIGIN),
    );
  } else {
    result.undoItem = asOneStep(view, () => {
      for (let i = targets.length - 1; i >= 0; i--) view.dispatch(replaceTr(view.state, targets[i], text));
    });
  }
  result.replaced = targets.length;
  refreshNow(view, 0);
  return result;
}

interface YEdit {
  /** El elemento del bloque de texto: en Yjs 14 el texto vive adentro (un carácter = un lugar). */
  ytext: Y.Type;
  index: number;
  length: number;
  attrs: Record<string, unknown>;
}

/** El id del bloque (`blockContainer`) que contiene un elemento del Y.Doc. */
function containerIdOf(type: Y.Type): string | null {
  let at: Y.Type | null = type;
  while (at) {
    if (at.name === 'blockContainer') return String(at.getAttr('id') ?? '');
    at = at.parent as Y.Type | null;
  }
  return null;
}

/** Dónde está cada coincidencia en el Y.Doc (el texto, el lugar y el formato de su primer carácter), o `null`. */
function yjsEdits(view: EditorView, targets: FindMatch[]): YEdit[] | null {
  const binding = bindingOf(view.state);
  if (!binding) return null;
  const deltas = new Map<Y.Type, { text: string; ops: { at: number; length: number; attrs: Record<string, unknown> }[] }>();
  const edits: YEdit[] = [];
  for (const m of targets) {
    let abs: Y.AbsolutePosition | null;
    try {
      // Desde adentro de la coincidencia (su primer carácter): el borde podría caer al final del texto de antes.
      const rel = absolutePositionToRelativePosition(view.state.doc.resolve(m.from + 1), binding.type, binding.renderer);
      abs = Y.createAbsolutePositionFromRelativePosition(rel, binding.doc);
    } catch {
      return null;
    }
    if (!abs || !(abs.type instanceof Y.Type) || abs.index < 1) return null;
    const ytext = abs.type;
    // Tiene que ser el texto del mismo bloque que encontró la búsqueda.
    if (containerIdOf(ytext) !== m.blockId) return null;
    const index = abs.index - 1;
    let delta = deltas.get(ytext);
    if (!delta) {
      delta = { text: '', ops: [] };
      for (const op of ytext.toDelta().children as Iterable<{ insert: unknown; format?: Record<string, unknown> | null }>) {
        const piece = typeof op.insert === 'string' ? op.insert : '\uFFFC'.repeat(Array.isArray(op.insert) ? op.insert.length : 1);
        delta.ops.push({ at: delta.text.length, length: piece.length, attrs: op.format ?? {} });
        delta.text += piece;
      }
      deltas.set(ytext, delta);
    }
    const length = m.to - m.from;
    // Lo que hay en el Y.Doc tiene que ser exactamente lo encontrado.
    if (delta.text.slice(index, index + length) !== view.state.doc.textBetween(m.from, m.to)) return null;
    const op = delta.ops.find((o) => index >= o.at && index < o.at + o.length);
    edits.push({ ytext, index, length, attrs: op?.attrs ?? {} });
  }
  return edits;
}

/** Deshace el reemplazo si todavía es lo último en la pila (el *Deshacer* del aviso). */
export function undoReplace(view: EditorView | undefined, item: unknown): boolean {
  if (!view || !canUndoReplace(view, item)) return false;
  undoManagerOf(view.state)?.undo();
  return true;
}
