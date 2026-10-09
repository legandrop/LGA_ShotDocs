import { createExtension } from '@blocknote/core';
import { PluginKey, type EditorState } from '@tiptap/pm/state';
import type { DecorationSet, EditorView } from '@tiptap/pm/view';
import { t } from '../i18n';
import { notify } from '../ui/notice';
import { shortcutKeys } from '../ui/shortcuts';
import { asOneUndoStep } from '../ui/undoGuard';

// Volver link un subrayado (Docs/Doc_Relaciones.md, sección 14): la marca `link` de siempre, hacia la página de la escena o
// la locación (`/p/<id>`, el formato de los links internos de la app), sobre el mismo texto, en un solo paso de deshacer.
// El texto no cambia («1074C» sigue diciendo «1074C»); nada de tipos ni marcas nuevas: una versión vieja ve un link común.
//
// Va aparte del subrayado (relUnderline.ts) y es chico: el atajo vive en las extensiones de la página
// (editorExtensions.ts), así la prueba de atajos lo ve en el editor real. Sin el subrayado (la exportación, la página de
// práctica) no encuentra nada y deja pasar la tecla.

/** Lo que dice cada subrayado (en `spec.rel` de su decoración). */
export interface UnderlineSpec {
  kind: 'scene' | 'loc' | 'pending';
  ref: string;
  /** La letra de una parte (`1074C` sin escena `101_074C`): `C`. */
  part: string;
  /** La página de la escena o la locación (`null` para un pendiente o sin página que la persona vea). */
  pageId: string | null;
}

export interface UnderlineState {
  set: DecorationSet;
  /** Lo dibujado, para no volver a despachar lo mismo (vacío mientras solo se fue corriendo con las ediciones). */
  sig: string;
}

export const underlineKey = new PluginKey<UnderlineState>('shotdocs-rel-underline');

/** Pedido de rearmar el subrayado en la misma transacción (después de volver link un subrayado). */
export const UNDERLINE_NOW = 'now';

/** Ctrl+Alt+K (⌘⌥K en la Mac): la K del link (⌘K), con ⌥ para «lo reconocido acá». */
export const REL_LINK_SHORTCUT = shortcutKeys('relLink')[0];

/**
 * El subrayado que toca esa posición (o, sin posición, la selección: el cursor adentro o pegado a un borde, o una parte
 * elegida que cae adentro de un solo subrayado).
 */
export function underlineAt(state: EditorState, pos?: number): { from: number; to: number; spec: UnderlineSpec } | null {
  const st = underlineKey.getState(state);
  if (!st) return null;
  const lo = pos ?? state.selection.from;
  const hi = pos ?? state.selection.to;
  for (const d of st.set.find(Math.max(0, lo - 1), hi + 1)) {
    const spec = (d.spec as { rel?: UnderlineSpec }).rel;
    if (!spec || d.from > lo || d.to < hi) continue;
    return { from: d.from, to: d.to, spec };
  }
  return null;
}

/**
 * Dónde está un subrayado de un modo que aguanta lo que llega de otro dispositivo mientras el adelanto está abierto: el
 * bloque (por su id) y el lugar adentro. Una posición suelta se corre con cualquier cosa escrita más arriba, y *Make it a
 * link* no encontraba nada (O8 de la auditoría de E6).
 */
export interface UnderlineAnchor {
  blockId: string | null;
  offset: number;
  from: number;
  ref: string;
}

export function anchorOf(state: EditorState, from: number, ref: string): UnderlineAnchor {
  const $pos = state.doc.resolve(Math.max(0, Math.min(from, state.doc.content.size)));
  for (let d = $pos.depth; d > 0; d--) {
    const id = $pos.node(d).attrs?.id;
    if (typeof id === 'string' && id) return { blockId: id, offset: from - $pos.start(d), from, ref };
  }
  return { blockId: null, offset: 0, from, ref };
}

/**
 * Dónde está ahora el subrayado anclado: en su bloque, el de la misma referencia en ese lugar o el más cercano; sin
 * bloque, el más cercano del documento. `null` si ya no está (se borró el bloque o dejó de decir eso).
 */
export function locateUnderline(state: EditorState, a: UnderlineAnchor): number | null {
  const st = underlineKey.getState(state);
  if (!st) return null;
  let lo = 0;
  let hi = state.doc.content.size;
  let guess = a.from;
  if (a.blockId) {
    let block: { start: number; end: number } | null = null;
    state.doc.descendants((node, pos) => {
      if (block) return false;
      if (node.attrs?.id === a.blockId) {
        block = { start: pos + 1, end: pos + node.nodeSize - 1 };
        return false;
      }
      return true;
    });
    if (!block) return null;
    ({ start: lo, end: hi } = block);
    guess = lo + a.offset;
  }
  let best: number | null = null;
  let dist = Infinity;
  for (const d of st.set.find(lo, hi)) {
    const spec = (d.spec as { rel?: UnderlineSpec }).rel;
    if (!spec || spec.ref !== a.ref || d.from === d.to) continue;
    const away = d.from <= guess && guess <= d.to ? 0 : Math.min(Math.abs(d.from - guess), Math.abs(d.to - guess));
    if (away < dist) {
      dist = away;
      best = d.from;
    }
  }
  return best;
}

/**
 * Vuelve link el subrayado de esa posición (por defecto, el del cursor). Solo escenas y locaciones con página, y con la
 * página editable; con `to`, también un pendiente, hacia esa página (*Assign*). Devuelve si lo hizo (si no, la tecla sigue
 * su camino).
 */
export function makeLinkAt(view: EditorView, pos?: number, ref?: string, to?: { pageId: string }): boolean {
  if (!view.editable) return false;
  const found = underlineAt(view.state, pos);
  // Con `to` (*Assign* de un pendiente, E7: D522), el link va a esa página: el texto escrito no cambia.
  const pageId = to?.pageId ?? found?.spec.pageId;
  if (!found || !pageId || (!to && found.spec.kind === 'pending')) return false;
  if (ref && found.spec.ref !== ref) return false;
  const linkType = view.state.schema.marks.link;
  if (!linkType) return false;
  // Un pedazo ya con link (llegó uno de otro dispositivo en el medio): no se pisa.
  let linked = false;
  view.state.doc.nodesBetween(found.from, found.to, (node) => {
    if (node.isText && node.marks.some((m) => m.type === linkType)) linked = true;
  });
  if (linked) return false;
  const tr = view.state.tr.addMark(found.from, found.to, linkType.create({ href: `/p/${pageId}` }));
  tr.setMeta(underlineKey, UNDERLINE_NOW);
  // Un solo paso de deshacer, aparte de lo escrito justo antes.
  asOneUndoStep(view.state, () => view.dispatch(tr));
  return true;
}

/**
 * Por qué no hay nada para volver link donde está el cursor: un pendiente (no tiene página), algo que ya es link (una
 * ficha) o nada reconocido.
 */
export function noLinkReason(state: EditorState): { kind: 'pending'; ref: string } | { kind: 'link' } | { kind: 'nothing' } {
  const found = underlineAt(state);
  if (found?.spec.kind === 'pending') return { kind: 'pending', ref: found.spec.ref };
  const st = underlineKey.getState(state);
  const { from, to } = state.selection;
  const chip = st?.set.find(Math.max(0, from - 1), to + 1).some((d) => (d.spec as { chip?: unknown }).chip && d.from <= from && d.to >= to);
  return chip ? { kind: 'link' } : { kind: 'nothing' };
}

/**
 * El atajo, en las extensiones de la página (lo ve la prueba de atajos con el editor real). Donde no hay nada para volver
 * link, un aviso corto que dice por qué (O3 de la auditoría de E6), solo en una página editable con el subrayado: sin él
 * (la exportación, la práctica) o en solo lectura, la tecla sigue su camino sin decir nada.
 */
export const relLinkKeyExtension = createExtension({
  key: 'shotdocs-rel-link',
  keyboardShortcuts: {
    [REL_LINK_SHORTCUT]: ({ editor }) => {
      const view = editor.prosemirrorView;
      if (!view) return false;
      if (makeLinkAt(view)) return true;
      if (!view.editable || !underlineKey.getState(view.state)) return false;
      const why = noLinkReason(view.state);
      notify(why.kind === 'pending' ? t('peek.pendingNoLink', { ref: why.ref }) : why.kind === 'link' ? t('peek.alreadyLink') : t('peek.nothingToLink'));
      return true;
    },
  },
});

/**
 * Vuelve link un texto recién escrito en un bloque (crear desde el `/`, E7: el número se escribe enseguida y queda link
 * cuando la página existe). Busca en ese bloque, por su id, la aparición de `text` sin link más cercana al lugar donde se
 * escribió; si el bloque ya no está o el texto cambió, no hace nada. Su propio paso de deshacer.
 */
export function linkTextInBlock(view: EditorView, at: { blockId: string; offset: number }, text: string, href: string): boolean {
  const linkType = view.state.schema.marks.link;
  if (!linkType || !text) return false;
  let block: { start: number; node: import('@tiptap/pm/model').Node } | null = null;
  view.state.doc.descendants((node, pos) => {
    if (block) return false;
    if (node.attrs?.id === at.blockId) {
      block = { start: pos + 1, node };
      return false;
    }
    return true;
  });
  if (!block) return false;
  const { start, node } = block as { start: number; node: import('@tiptap/pm/model').Node };
  let best: number | null = null;
  let dist = Infinity;
  node.descendants((child, rel) => {
    if (!child.isText || !child.text) return true;
    if (child.marks.some((m) => m.type === linkType)) return false;
    for (let i = child.text.indexOf(text); i >= 0; i = child.text.indexOf(text, i + 1)) {
      const from = start + rel + i;
      const away = Math.abs(from - (start + at.offset));
      if (away < dist) {
        dist = away;
        best = from;
      }
    }
    return false;
  });
  if (best === null) return false;
  const from: number = best;
  const tr = view.state.tr.addMark(from, from + text.length, linkType.create({ href }));
  tr.setMeta(underlineKey, UNDERLINE_NOW);
  asOneUndoStep(view.state, () => view.dispatch(tr));
  return true;
}
