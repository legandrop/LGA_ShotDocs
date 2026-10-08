import { createExtension } from '@blocknote/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { collapseControlFor } from '../ui/collapseControl';
import { blockElement } from '../ui/commentsUi';
import { setBlockFlasher } from '../ui/flashControl';

// El resaltado pasajero de «ir al lugar exacto» (Docs/Doc_Relaciones.md, sección 10): una decoración de ProseMirror sobre
// los bloques de una sección, que se va sola. Es vista: no toca el documento ni el Y.Doc, no se sincroniza y no sale en
// el PDF. Una clase puesta a mano en el DOM del editor no sirve: ProseMirror vuelve a dibujar el bloque y la borra.

const key = new PluginKey<DecorationSet>('shotdocs-place-flash');
const CONTAINER = 'blockContainer';
/** Cuánto dura el resaltado. */
export const FLASH_MS = 2400;

/** Los editores abiertos (normalmente uno): `showPlace` busca el que tiene el bloque. */
const views = new Set<EditorView>();

/** Los bloques de una sección, en el orden del documento: del título hasta el que la cierra (o el final). */
export function sectionBlocks(doc: PMNode, startId: string, endId: string | null | undefined): { id: string; from: number; to: number }[] {
  const out: { id: string; from: number; to: number }[] = [];
  let on = false;
  let done = false;
  doc.descendants((node, pos) => {
    if (done) return false;
    if (node.type.name !== CONTAINER) return true;
    const id = String(node.attrs.id ?? '');
    if (!on && id === startId) on = true;
    else if (on && endId !== undefined && endId !== null && id === endId) {
      done = true;
      return false;
    }
    if (on) {
      out.push({ id, from: pos, to: pos + node.nodeSize });
      // Solo ese bloque (una mención): sin seguir.
      if (endId === undefined) done = true;
    }
    return true;
  });
  return out;
}

/** Cuántos resaltados lleva cada editor: el que vence solo borra si no llegó otro después. */
const generation = new WeakMap<EditorView, number>();

/**
 * Resalta una sección (o un bloque) en el editor que la tiene. Devuelve si la encontró. `cls`: la clase del resaltado
 * (`rel-flash` de la cabecera viva; `comment-flash` de «Ir al bloque» de los comentarios, con su duración).
 */
export function flashPlace(startId: string, endId: string | null | undefined, cls = 'rel-flash', ms = FLASH_MS): boolean {
  for (const view of views) {
    const blocks = sectionBlocks(view.state.doc, startId, endId);
    if (!blocks.length) continue;
    const decos = blocks.map((b, i) => Decoration.node(b.from, b.to, { class: i === 0 ? `${cls} ${cls}-first` : cls }));
    const n = (generation.get(view) ?? 0) + 1;
    generation.set(view, n);
    view.dispatch(view.state.tr.setMeta(key, DecorationSet.create(view.state.doc, decos)).setMeta('addToHistory', false));
    setTimeout(() => {
      if (views.has(view) && generation.get(view) === n) {
        view.dispatch(view.state.tr.setMeta(key, DecorationSet.empty).setMeta('addToHistory', false));
      }
    }, ms);
    return true;
  }
  return false;
}

const plugin = new Plugin<DecorationSet>({
  key,
  state: {
    init: () => DecorationSet.empty,
    apply: (tr, set) => {
      const next = tr.getMeta(key) as DecorationSet | undefined;
      if (next) return next;
      return tr.docChanged ? set.map(tr.mapping, tr.doc) : set;
    },
  },
  props: { decorations: (state) => key.getState(state) },
  view: (view) => {
    views.add(view);
    return { destroy: () => views.delete(view) };
  },
});

// «Ir al bloque» de los comentarios usa el mismo resaltado, con su estilo y su duración (ui/flashControl.ts).
setBlockFlasher((blockId) => flashPlace(blockId, undefined, 'comment-flash', 1800));

export const placeFlashExtension = createExtension({ key: 'shotdocs-place-flash', prosemirrorPlugins: [plugin] });

/**
 * Muestra un lugar de la página abierta: abre lo colapsado que lo esconde (y el título mismo, si está colapsado), lleva
 * la vista ahí y lo resalta. Si el editor todavía no dibujó la página, vuelve a probar un rato.
 */
export function showPlace(pageId: string, blockId: string, endBlockId: string | null | undefined, tries = 30): void {
  const attempt = (left: number) => {
    const control = collapseControlFor(pageId);
    if (control?.openSection) control.openSection(blockId);
    else control?.reveal(blockId);
    const el = blockElement(blockId);
    if (!el) {
      if (left > 0) setTimeout(() => attempt(left - 1), 60);
      return;
    }
    const block: ScrollLogicalPosition = endBlockId === undefined ? 'center' : 'start';
    el.scrollIntoView?.({ block, behavior: 'smooth' });
    flashPlace(blockId, endBlockId);
    keepInView(blockId, block);
  };
  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn: () => void) => setTimeout(fn, 0);
  raf(() => attempt(tries));
}

/** El contenedor que se desplaza (la columna de la página) o el documento. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let n = el.parentElement; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

/** Cuánto tiempo se sigue cuidando que el lugar quede a la vista mientras la página termina de medir y cargar. */
export const KEEP_IN_VIEW_MS = 6000;

/**
 * Mientras la página termina de dibujarse (las fotos de arriba se cargan y crecen), el lugar se corre para abajo: se
 * vuelve a ubicar cada vez que su posición en la página cambia, hasta que la persona toca, desplaza o escribe, o pasan
 * unos segundos (B3 de la auditoría de E5: en un día largo con fotos, ir a una sección quedaba miles de píxeles arriba).
 * Compara la posición dentro de lo que se desplaza, no en la pantalla: el desplazamiento suave no cuenta como cambio.
 */
function keepInView(blockId: string, block: ScrollLogicalPosition, ms = KEEP_IN_VIEW_MS): void {
  const first = blockElement(blockId);
  if (!first || typeof window === 'undefined') return;
  const scroller = scrollParent(first);
  const posOf = (el: HTMLElement) => {
    const top = el.getBoundingClientRect().top;
    return scroller ? top - scroller.getBoundingClientRect().top + scroller.scrollTop : top + window.scrollY;
  };
  let last = posOf(first);
  let stopped = false;
  const events = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
  const stop = () => {
    stopped = true;
    for (const e of events) window.removeEventListener(e, stop, true);
  };
  for (const e of events) window.addEventListener(e, stop, true);
  const start = Date.now();
  const tick = () => {
    if (stopped) return;
    const el = blockElement(blockId);
    if (!el || Date.now() - start > ms) {
      stop();
      return;
    }
    const now = posOf(el);
    if (Math.abs(now - last) > 2) {
      last = now;
      el.scrollIntoView?.({ block, behavior: 'auto' });
    }
    setTimeout(tick, 120);
  };
  setTimeout(tick, 120);
}
