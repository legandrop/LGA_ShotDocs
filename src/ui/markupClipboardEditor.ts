import { createExtension } from '@blocknote/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { yUndoPluginKey } from 'y-prosemirror';
import type * as Y from 'yjs';
import { PHOTO_MARKUP_MAP } from '../media/markup';
import {
  carryMarkup,
  clipKey,
  MARKUP_PASTE_ORIGIN,
  mediaIdsInText,
  snapshotMarkup,
  type CarryResult,
  type CopiedPhoto,
  type MarkupClip,
} from '../media/markupClipboard';
import { mediaCountsInDoc } from '../media/usage';
import { asOneUndoStep } from './undoGuard';

// Copiar y pegar una foto con sus anotaciones (D46, Docs/Doc_Anotar_Fotos.md, "Copiar y pegar con las anotaciones"): lo
// que une el modelo (`media/markupClipboard.ts`) con el editor de la página.
//
// - Copiar y cortar: DESPUÉS de que el editor puso lo suyo en el portapapeles (un oyente en el mismo elemento, puesto
//   después que los de ProseMirror), se lee eso, se buscan las fotos que nombra y se guarda en memoria una copia de sus
//   anotaciones. Al portapapeles no se agrega nada. Si lo copiado no tiene fotos anotadas, se olvida la copia anterior.
// - Las otras pestañas abiertas de la app reciben la misma copia (un `BroadcastChannel`, solo dentro del mismo origen
//   y del mismo navegador): copiar en una ventana y pegar en otra también lleva las flechas. Nunca se guarda en disco.
// - Pegar: si el portapapeles trae justo lo copiado y la página es del mismo workspace y proyecto, el pegado y la
//   escritura de las anotaciones son UN solo paso de deshacer de la página (⌘/Ctrl+Z saca la foto y sus flechas).

/** La última copia con fotos anotadas (de esta pestaña o de otra de la app). */
let current: MarkupClip | null = null;
let channel: BroadcastChannel | null | undefined;
const CHANNEL = 'sd-markup-clip';

/** Una copia que llega de otra pestaña: solo si tiene la forma esperada (lo demás se ignora). */
function validClip(value: unknown): MarkupClip | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<MarkupClip>;
  if (typeof v.key !== 'string' || typeof v.scope !== 'string' || !Array.isArray(v.photos)) return null;
  const photos = v.photos.filter(
    (p): p is CopiedPhoto =>
      !!p &&
      typeof p === 'object' &&
      typeof p.fileId === 'string' &&
      !!p.frame &&
      typeof p.frame === 'object' &&
      Array.isArray(p.shapes) &&
      p.shapes.every((s) => Array.isArray(s) && typeof s[0] === 'string' && !!s[1] && typeof s[1] === 'object'),
  );
  return photos.length > 0 ? { key: v.key, scope: v.scope, photos } : null;
}

/** El canal con las otras pestañas (se abre con el primer editor de página; sin `BroadcastChannel`, solo esta). */
function openChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  try {
    channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : null;
  } catch {
    channel = null;
  }
  channel?.addEventListener('message', (event: MessageEvent) => {
    current = event.data === null ? null : validClip(event.data);
  });
  return channel;
}

/** Guarda la copia (o la olvida, con `null`) acá y en las otras pestañas. */
export function rememberClip(clip: MarkupClip | null): void {
  current = clip;
  try {
    openChannel()?.postMessage(clip);
  } catch {
    // Sin canal (o una copia que no se puede mandar): queda solo en esta pestaña.
  }
}

/** La copia guardada, si lo que se pega es justo eso y va al mismo workspace y proyecto. */
export function clipFor(data: Pick<DataTransfer, 'getData'> | null | undefined, scope: string): MarkupClip | null {
  if (!current || !scope || current.scope !== scope) return null;
  const key = clipKey(data);
  return key && key === current.key ? current : null;
}

/** Para las pruebas: olvida la copia y cierra el canal. */
export function resetMarkupClipboard(): void {
  current = null;
  channel?.close();
  channel = undefined;
}

export interface MarkupClipboardOptions {
  /** El documento de la página (su mapa `photoMarkup`). */
  doc: Y.Doc;
  /** El workspace y el proyecto de la página ahora (`clipScope`); vacío: nada viaja. */
  scope: () => string;
}

/** Lo que pasa al copiar o cortar en el editor: guarda las anotaciones de las fotos copiadas, o olvida la copia anterior. */
export function recordCopy(event: ClipboardEvent, options: MarkupClipboardOptions): void {
  const data = event.clipboardData;
  const key = clipKey(data);
  const scope = options.scope();
  if (!data || !key || !scope) {
    rememberClip(null);
    return;
  }
  const html = data.getData('blocknote/html') || data.getData('text/html');
  const photos = snapshotMarkup(options.doc.getMap<unknown>(PHOTO_MARKUP_MAP), mediaIdsInText(html));
  rememberClip(photos.length > 0 ? { key, scope, photos } : null);
}

const pluginKey = new PluginKey('shotdocs-markup-clipboard');

/** Va en el editor de la página (PageEditor.tsx): escucha copiar y cortar después del editor. */
export function markupClipboardExtension(options: MarkupClipboardOptions) {
  openChannel();
  const plugin = new Plugin({
    key: pluginKey,
    view(view: EditorView) {
      // En el mismo elemento que ProseMirror y después: el editor ya puso lo suyo en el portapapeles (y, al cortar, ya
      // sacó la foto; las anotaciones siguen en el mapa hasta la poda).
      const onCopy = (event: Event) => recordCopy(event as ClipboardEvent, options);
      view.dom.addEventListener('copy', onCopy);
      view.dom.addEventListener('cut', onCopy);
      return {
        destroy() {
          view.dom.removeEventListener('copy', onCopy);
          view.dom.removeEventListener('cut', onCopy);
        },
      };
    },
  });
  return createExtension({ key: 'shotdocs-markup-clipboard', prosemirrorPlugins: [plugin] });
}

function undoManagerOf(state: EditorState): Y.UndoManager | null {
  return (yUndoPluginKey.getState(state as never) as { undoManager?: Y.UndoManager } | undefined)?.undoManager ?? null;
}

/**
 * Hace que el deshacer de la página (⌘/Ctrl+Z) siga también el mapa de las anotaciones, pero solo lo escrito con el origen
 * de `carryMarkup` (el anotador y la poda tienen los suyos y no entran). Lo usan el pegado y las plantillas (que escriben
 * las anotaciones junto con el contenido, en un solo paso).
 */
export function trackMarkupInUndo(state: EditorState, doc: Y.Doc): void {
  const um = undoManagerOf(state);
  if (!um) return;
  um.addToScope(doc.getMap<unknown>(PHOTO_MARKUP_MAP));
  um.trackedOrigins.add(MARKUP_PASTE_ORIGIN);
}

export interface PasteWithMarkup {
  data: Pick<DataTransfer, 'getData'> | null | undefined;
  view: EditorView | null | undefined;
  doc: Y.Doc;
  scope: string;
  /** El pegado de siempre (devuelve si lo manejó). */
  run: () => boolean | undefined;
  /** Se llama si alguna foto llegó sin sus anotaciones por los topes. */
  onLimit?: () => void;
}

/**
 * Pega con `run` y, si lo pegado es una copia con fotos anotadas del mismo workspace y proyecto, escribe sus anotaciones
 * en la página: las dos cosas en un solo paso de deshacer de la página (su `Y.UndoManager` sigue también el mapa y el
 * origen de lo pegado; el anotador y la poda tienen sus orígenes propios y no entran).
 */
export function pasteWithMarkup(p: PasteWithMarkup): boolean | undefined {
  const clip = p.view ? clipFor(p.data, p.scope) : null;
  if (!clip || !p.view) return p.run();
  trackMarkupInUndo(p.view.state, p.doc);
  let result: CarryResult | null = null;
  const before = mediaCountsInDoc(p.doc);
  const handled = asOneUndoStep(p.view.state, () => {
    const out = p.run();
    // Solo las fotos que trajo de verdad el pegado: las que ahora aparecen más veces que antes (auditoría O1). Si la
    // foto no entró (pegada como texto en un bloque de código), no se lleva nada, tampoco a la misma foto que ya
    // estaba en la página. Si algo falla, el pegado ya está hecho: la foto queda limpia, nunca se corta el pegado.
    try {
      const after = mediaCountsInDoc(p.doc);
      const pasted = new Set([...after].filter(([id, n]) => n > (before.get(id) ?? 0)).map(([id]) => id));
      result = carryMarkup(p.doc, clip.photos, pasted);
    } catch (err) {
      console.warn('[anotaciones] no se pudieron pegar las anotaciones', err);
    }
    return out;
  });
  if ((result as CarryResult | null)?.skipped.some((s) => s.reason === 'limit')) p.onLimit?.();
  return handled;
}
