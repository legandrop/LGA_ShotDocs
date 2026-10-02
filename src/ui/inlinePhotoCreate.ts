import { createExtension } from '@blocknote/core';
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, ySyncPluginKey } from 'y-prosemirror';
import * as Y from 'yjs';
import { t } from '../i18n';
import '../i18n/lazy/editor';
import { PHOTO } from './inlinePhoto';
import { notify } from './notice';

// Crear fotos en línea (Docs/Doc_Fotos_En_Linea.md, entrega 2): pegar, soltar, elegir archivos desde el menú "/".
// Las fotos y los videos entran EN EL RENGLÓN, donde está el cursor o donde se soltaron; los adjuntos (PDF, zip…)
// siguen siendo un bloque debajo (fileDrop.ts). Las fotos-bloque que ya existen no se tocan (convertirlas es la
// entrega 3).
//
// La foto se inserta cuando el archivo ya está guardado en el dispositivo (`uploadFile`: `media.add` con portero),
// con su dirección definitiva: no hay marcador en el documento ni "la subida fallida saca la foto". Mientras se
// guarda, el lugar se sigue con el mapeo de ProseMirror (lo que se escribe o se borra antes lo corre) y se ve una
// marca de espera que no es parte del documento (una decoración). Todas las fotos de una vez entran juntas, en su
// orden, en un solo cambio (un solo deshacer).

/**
 * Con qué ancho entran las fotos nuevas (`w`, la parte del renglón; 0: su ancho natural, con tope en el renglón,
 * como entraba un bloque). Propuesta del diseño mientras Lega no responda ("Preguntas para Lega", 3): una sola,
 * con su ancho natural; varias a la vez, a 1/3 cada una (filas de tres), y se acomodan a pedido.
 */
export const NEW_PHOTO_WIDTH = { single: 0, several: 1 / 3 } as const;

export function newPhotoWidth(count: number): number {
  return count > 1 ? NEW_PHOTO_WIDTH.several : NEW_PHOTO_WIDTH.single;
}

export interface NewPhoto {
  url: string;
  name: string;
}

// --- Dónde puede ir una foto en línea -------------------------------------------------------------------

/**
 * Una foto en línea puede ir en el texto de un párrafo, un título, un ítem de lista, una cita o una celda de tabla
 * (entrega 5: la celda es texto en línea); no en un bloque de código (solo texto).
 */
export function canHostPhoto($pos: ResolvedPos): boolean {
  const parent = $pos.parent;
  const type = parent.type.schema.nodes[PHOTO];
  return !!type && parent.isTextblock && parent.canReplaceWith($pos.index(), $pos.index(), type);
}

/** La posición está en una celda de una tabla (ahí las fotos entran como miniaturas: `CELL_PHOTO_WIDTH`). */
export function inTableCell($pos: ResolvedPos): boolean {
  for (let d = $pos.depth; d > 0; d--) {
    const name = $pos.node(d).type.name;
    if (name === 'tableCell' || name === 'tableHeader') return true;
  }
  return false;
}

/**
 * Con qué ancho entran en una celda: 0 (su ancho natural), siempre, también varias juntas. En una celda, una foto sin
 * ancho propio es una miniatura con el alto de una fila (styles.css, "Fotos en las celdas"): las de una celda quedan
 * una al lado de la otra, a la misma altura. Un tercio de una celda angosta sería una estampilla.
 */
export const CELL_PHOTO_WIDTH = 0;

/** El id del bloque (`blockContainer`) que contiene la posición, o `null`. */
export function blockIdAt($pos: ResolvedPos): string | null {
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === 'blockContainer') return String(node.attrs.id ?? '') || null;
  }
  return null;
}

/**
 * Dónde entra lo que se pega con esta selección: con el cursor, ahí; con una foto en línea elegida, después de ella
 * (como una letra); con texto elegido, donde empieza (lo elegido se borra antes, como al pegar texto). `null` si
 * ahí no puede ir una foto en línea (un bloque elegido entero, código, una selección de celdas): entonces va en un
 * renglón nuevo después del bloque (`blockIdAt`).
 */
export function pasteSpot(state: EditorState): number | null {
  const sel = state.selection;
  if (sel instanceof NodeSelection) {
    if (sel.node.type.name !== PHOTO) return null;
    return canHostPhoto(state.doc.resolve(sel.to)) ? sel.to : null;
  }
  if (!(sel instanceof TextSelection)) return null;
  return canHostPhoto(sel.$from) && (sel.empty || canHostPhoto(sel.$to)) ? sel.from : null;
}

// --- El lugar mientras se guardan los archivos ------------------------------------------------------------

interface Spot {
  id: number;
  pos: number;
  /** Se ve la marca de espera (no, mientras el selector de archivos está abierto). */
  waiting: boolean;
  /** El mismo lugar en el documento compartido (con un editor de Yjs), que sobrevive a los cambios de otros. */
  rel: Y.RelativePosition | null;
}

interface Binding {
  doc: Y.Doc;
  type: Y.XmlFragment;
  mapping: Map<unknown, unknown>;
}

const bindingOf = (state: EditorState): Binding | null =>
  (ySyncPluginKey.getState(state) as { binding?: Binding | null } | undefined)?.binding ?? null;

/**
 * La posición `pos` como posición de Yjs, pegada a lo que tiene a la IZQUIERDA (lo que se escribe justo ahí queda a la
 * derecha de las fotos, como con el mapeo de ProseMirror). Un cambio que llega de otro dispositivo (o deshacer)
 * reescribe todo el documento del editor, y ahí el mapeo de ProseMirror ya no sirve: la posición de Yjs sí.
 */
function relativeOf(state: EditorState, pos: number): Y.RelativePosition | null {
  const binding = bindingOf(state);
  if (!binding) return null;
  try {
    const rel = absolutePositionToRelativePosition(pos, binding.type, binding.mapping as never);
    const abs = Y.createAbsolutePositionFromRelativePosition(rel, binding.doc);
    return abs ? Y.createRelativePositionFromTypeIndex(abs.type, abs.index, -1) : rel;
  } catch {
    return null;
  }
}

function absoluteOf(state: EditorState, rel: Y.RelativePosition | null): number | null {
  const binding = bindingOf(state);
  if (!binding || !rel) return null;
  try {
    return relativePositionToAbsolutePosition(binding.doc, binding.type, rel, binding.mapping as never);
  } catch {
    return null;
  }
}

type SpotMeta = { add: Spot } | { wait: number } | { remove: number };

const spotsKey = new PluginKey<Spot[]>('shotdocs-photo-spots');

const spotsPlugin = new Plugin<Spot[]>({
  key: spotsKey,
  state: {
    init: () => [],
    apply(tr: Transaction, spots: Spot[], _old: EditorState, state: EditorState) {
      // Lo que se escribe justo en el lugar queda después de las fotos (el lugar no se corre a la derecha). Un
      // cambio de otro dispositivo o un deshacer reescriben el documento entero: ahí vale la posición de Yjs.
      const fromYjs = (tr.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined)?.isChangeOrigin === true;
      let next = tr.docChanged
        ? spots.map((s) => ({ ...s, pos: (fromYjs ? absoluteOf(state, s.rel) : null) ?? tr.mapping.map(s.pos, -1) }))
        : spots;
      const meta = tr.getMeta(spotsKey) as SpotMeta | undefined;
      if (meta && 'add' in meta) next = [...next, meta.add];
      else if (meta && 'wait' in meta) next = next.map((s) => (s.id === meta.wait ? { ...s, waiting: true } : s));
      else if (meta && 'remove' in meta) next = next.filter((s) => s.id !== meta.remove);
      return next;
    },
  },
  props: {
    decorations(state) {
      const spots = spotsKey.getState(state) ?? [];
      const marks = spots
        .filter((s) => s.waiting && s.pos >= 0 && s.pos <= state.doc.content.size)
        .map((s) =>
          Decoration.widget(
            s.pos,
            () => {
              const el = document.createElement('span');
              el.className = 'sd-photo-pending';
              el.setAttribute('aria-hidden', 'true');
              return el;
            },
            { side: -1, key: `spot-${s.id}` },
          ),
        );
      return marks.length ? DecorationSet.create(state.doc, marks) : null;
    },
  },
});

/** Sigue el lugar y la marca de espera de las fotos que se están guardando. */
export const inlinePhotoSpotsExtension = createExtension({
  key: 'shotdocs-photo-spots',
  prosemirrorPlugins: [spotsPlugin],
});

let nextSpot = 1;

/** Empieza a seguir una posición; devuelve su id. */
export function trackSpot(view: EditorView, pos: number, waiting = true): number {
  const id = nextSpot++;
  const rel = relativeOf(view.state, pos);
  view.dispatch(view.state.tr.setMeta(spotsKey, { add: { id, pos, waiting, rel } } satisfies SpotMeta).setMeta('addToHistory', false));
  return id;
}

/** Muestra la marca de espera de un lugar (ya se eligieron los archivos). */
export function showSpot(view: EditorView, id: number): void {
  view.dispatch(view.state.tr.setMeta(spotsKey, { wait: id } satisfies SpotMeta).setMeta('addToHistory', false));
}

/** Dónde está ahora el lugar `id` (y deja de seguirlo), o `null` si ya no está. */
export function takeSpot(view: EditorView, id: number): number | null {
  const spot = (spotsKey.getState(view.state) ?? []).find((s) => s.id === id);
  if (view.isDestroyed) return spot?.pos ?? null;
  view.dispatch(view.state.tr.setMeta(spotsKey, { remove: id } satisfies SpotMeta).setMeta('addToHistory', false));
  return spot ? spot.pos : null;
}

/** Los lugares que se están siguiendo (pruebas). */
export function spotsOf(state: EditorState): readonly { id: number; pos: number; waiting: boolean }[] {
  return spotsKey.getState(state) ?? [];
}

// --- Poner las fotos ------------------------------------------------------------------------------------

/** Lo que usa del editor de BlockNote para el renglón nuevo, cuando la foto no puede ir en el lugar. */
export interface PhotoEditor {
  prosemirrorView: EditorView | undefined;
  getTextCursorPosition(): { block: { id: string } };
  insertBlocks(blocks: unknown[], ref: string, placement: 'before' | 'after'): { id: string }[];
}

/** Los nodos de las fotos, con el ancho de cuántas son (en una celda, miniaturas). */
function photoNodes(state: EditorState, photos: readonly NewPhoto[], inCell: boolean): PMNode[] {
  const w = inCell ? CELL_PHOTO_WIDTH : newPhotoWidth(photos.length);
  return photos.map((p) => state.schema.nodes[PHOTO].create({ url: p.url, name: p.name, w }));
}

/**
 * Pone las fotos en `pos`, juntas y en orden, en un solo cambio. Si ahí no puede ir una foto en línea (o el
 * lugar ya no existe), van en un párrafo nuevo después del bloque `fallback` (o del bloque del cursor), también
 * con `placement: 'before'`. Si el cursor estaba en el lugar, queda después de la última foto. Devuelve si se
 * pusieron.
 */
export function placePhotos(
  editor: PhotoEditor,
  photos: readonly NewPhoto[],
  pos: number | null,
  fallback: { blockId: string; placement: 'before' | 'after' } | null,
): boolean {
  const view = editor.prosemirrorView;
  if (!view || photos.length === 0) return false;
  const { state } = view;
  if (pos !== null && pos >= 0 && pos <= state.doc.content.size && canHostPhoto(state.doc.resolve(pos))) {
    const nodes = photoNodes(state, photos, inTableCell(state.doc.resolve(pos)));
    const tr = state.tr.insert(pos, nodes);
    const sel = state.selection;
    if (sel.empty && sel.from === pos) tr.setSelection(TextSelection.create(tr.doc, pos + nodes.length));
    view.dispatch(tr.scrollIntoView());
    return true;
  }
  let ref = fallback;
  if (!ref || !blockExists(state.doc, ref.blockId)) {
    const at = pos !== null && pos >= 0 && pos <= state.doc.content.size ? blockIdAt(state.doc.resolve(pos)) : null;
    ref = { blockId: at ?? editor.getTextCursorPosition().block.id, placement: 'after' };
  }
  const w = newPhotoWidth(photos.length);
  editor.insertBlocks(
    [{ type: 'paragraph', content: photos.map((p) => ({ type: PHOTO, props: { url: p.url, name: p.name, w } })) }],
    ref.blockId,
    ref.placement,
  );
  return true;
}

function blockExists(doc: PMNode, id: string): boolean {
  let found = false;
  doc.descendants((n) => {
    if (found) return false;
    if (n.type.name === 'blockContainer' && n.attrs.id === id) found = true;
    return !found;
  });
  return found;
}

/**
 * La vista del editor, si sigue en la página (no se salió de la página ni se desmontó el editor), o `null`. Desmontado,
 * el editor de Tiptap da una vista que falla al tocarla.
 */
export function liveView(editor: PhotoEditor): EditorView | null {
  try {
    const view = editor.prosemirrorView;
    return view && !view.isDestroyed && view.dom.isConnected ? view : null;
  } catch {
    return null;
  }
}

/**
 * Guarda los archivos (`store`, con el aviso de error que corresponda) y pone los que se guardaron en el lugar
 * `spot` (seguido desde que se pegaron o soltaron), o, sin lugar (`null`), en un renglón nuevo junto a `fallback`. Los que fallan no cortan los demás. Devuelve las direcciones
 * puestas.
 */
export async function storeAndPlace(
  editor: PhotoEditor,
  files: readonly File[],
  spot: number | null,
  fallback: { blockId: string; placement: 'before' | 'after' } | null,
  store: (file: File) => Promise<string>,
): Promise<string[]> {
  const results = await Promise.allSettled(files.map((f) => store(f)));
  const photos: NewPhoto[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && typeof r.value === 'string' && r.value) photos.push({ url: r.value, name: files[i].name || 'image' });
  });
  const view = liveView(editor);
  if (!view) {
    // Se salió de la página (o el editor se volvió a montar) mientras se guardaban: el lugar ya no existe. Que no
    // quede un archivo guardado que no aparece sin que nadie se entere (auditoría de la entrega 2).
    if (photos.length > 0) notify(t('photoCreate.notPlaced', { count: photos.length }));
    return [];
  }
  const pos = spot === null ? null : takeSpot(view, spot);
  if (photos.length === 0) return [];
  return placePhotos(editor, photos, pos, fallback) ? photos.map((p) => p.url) : [];
}

// --- Pegar, soltar o elegir archivos ---------------------------------------------------------------------

export interface AddFilesOptions {
  /** Si el archivo entra en el renglón (fotos y videos) o es un adjunto (un bloque debajo). */
  isInline: (file: File) => boolean;
  /** Guarda un archivo (con su aviso si falla) y da su dirección. */
  store: (file: File) => Promise<string>;
  /** Los adjuntos: un bloque por archivo, en orden, en ese lugar (fileDrop.ts, `insertFiles`). */
  insertAttachments: (files: File[], at: { blockId: string; placement: 'before' | 'after' } | null) => unknown;
}

/**
 * Pegar, soltar o elegir archivos. `where`: la posición donde se soltaron (o `null`: la selección, como al pegar),
 * y el bloque de al lado para lo que no va en el renglón. Las fotos y videos van al renglón (o a un párrafo nuevo
 * al lado de ese bloque, si ahí no pueden ir); los adjuntos, como bloques después del bloque del lugar.
 */
export function addFiles(
  editor: PhotoEditor,
  files: readonly File[],
  where: { pos: number | null; block: { blockId: string; placement: 'before' | 'after' } | null } | null,
  opts: AddFilesOptions,
): Promise<string[]> {
  const view = editor.prosemirrorView;
  const inline = files.filter((f) => opts.isInline(f));
  const attachments = files.filter((f) => !opts.isInline(f));
  if (!view || inline.length === 0) {
    if (attachments.length) opts.insertAttachments(attachments, where?.block ?? null);
    return Promise.resolve([]);
  }
  let pos: number | null;
  if (where) {
    pos = where.pos !== null && canHostPhoto(view.state.doc.resolve(where.pos)) ? where.pos : null;
  } else {
    // Al pegar, lo elegido se reemplaza (como al pegar texto); una foto elegida queda (lo pegado va después).
    const sel = view.state.selection;
    if (sel instanceof TextSelection && !sel.empty && pasteSpot(view.state) !== null) view.dispatch(view.state.tr.deleteSelection());
    pos = pasteSpot(view.state);
  }
  const $at = pos !== null ? view.state.doc.resolve(pos) : view.state.selection.$to;
  const blockId = blockIdAt($at) ?? editor.getTextCursorPosition().block.id;
  const fallback = pos === null ? (where?.block ?? { blockId, placement: 'after' as const }) : null;
  // Sin lugar en un renglón, no hay nada que seguir: van en un renglón nuevo junto al bloque.
  const spot = pos === null ? null : trackSpot(view, pos);
  // Los adjuntos, como hasta ahora: un bloque cada uno, después del bloque del lugar.
  if (attachments.length) opts.insertAttachments(attachments, where?.block ?? { blockId, placement: 'after' });
  return storeAndPlace(editor, inline, spot, fallback, opts.store);
}

/**
 * El menú "/" (Image): abre el selector de archivos del sistema y pone lo elegido donde estaba el cursor. Se llama
 * dentro del clic o la tecla (el iPhone no abre el selector fuera de un toque).
 */
export function pickFiles(editor: PhotoEditor, accept: string, opts: AddFilesOptions): void {
  const view = editor.prosemirrorView;
  if (!view) return;
  const pos = pasteSpot(view.state);
  const $at = pos !== null ? view.state.doc.resolve(pos) : view.state.selection.$to;
  const blockId = blockIdAt($at) ?? editor.getTextCursorPosition().block.id;
  // Mientras el selector está abierto, el lugar se sigue sin marca de espera.
  const spot = pos === null ? null : trackSpot(view, pos, false);
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = accept;
  let done = false;
  const finish = (files: File[]) => {
    if (done) return;
    done = true;
    input.remove();
    if (view.isDestroyed) return;
    const inline = files.filter((f) => opts.isInline(f));
    const attachments = files.filter((f) => !opts.isInline(f));
    if (attachments.length) opts.insertAttachments(attachments, { blockId, placement: 'after' });
    if (inline.length === 0) {
      if (spot !== null) takeSpot(view, spot);
      return;
    }
    if (spot !== null) showSpot(view, spot);
    void storeAndPlace(editor, inline, spot, pos === null ? { blockId, placement: 'after' } : null, opts.store);
  };
  input.addEventListener('change', () => finish(Array.from(input.files ?? [])));
  input.addEventListener('cancel', () => finish([]));
  input.style.display = 'none';
  document.body.append(input);
  input.click();
}

/** El final del último texto de la celda que empieza en `cellPos`, o `null` si no tiene texto. */
export function cellTextEnd(cell: PMNode, cellPos: number): number | null {
  let end: number | null = null;
  cell.descendants((child, offset) => {
    if (child.isTextblock) end = cellPos + 1 + offset + child.nodeSize - 1;
    return !child.isTextblock;
  });
  return end;
}

/**
 * La posición entre letras donde se soltó, o `null` si se soltó sobre algo que no es un renglón (una foto-bloque, una
 * tarjeta, el borde de una tabla): ProseMirror da igual la posición de texto más cercana, que puede ser la de otro
 * bloque. Sobre el texto de una celda, la posición en la celda.
 */
export function dropPos(view: EditorView | undefined, x: number, y: number): number | null {
  const at = view?.posAtCoords({ left: x, top: y });
  if (!view || !at) return null;
  if (at.inside >= 0) {
    const node = view.state.doc.nodeAt(at.inside);
    // En el relleno de una celda (alrededor de su texto, o abajo en una fila alta por una miniatura): ProseMirror da la
    // posición entre el cierre del texto y el de la celda, donde no entra nada en línea. Va al final del texto de esa
    // celda (auditoría de la entrega 5: sin esto, la foto terminaba debajo de la tabla).
    if (node && (node.type.name === 'tableCell' || node.type.name === 'tableHeader')) {
      if (at.pos <= at.inside || at.pos >= at.inside + node.nodeSize) return null;
      return view.state.doc.resolve(at.pos).parent.isTextblock ? at.pos : cellTextEnd(node, at.inside);
    }
    if (node && !node.isTextblock && !node.isInline && node.type.name !== 'blockContainer') return null;
  }
  return at.pos;
}
