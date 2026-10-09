import { createExtension } from '@blocknote/core';
import { Plugin } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { MouseGate } from './relUnderline';

// El fondo del subrayado al pasar el mouse, solo con el mouse movido de verdad (O9 de la auditoría de E6, D571).
//
// Medio segundo después de escribir, el subrayado nuevo puede dibujarse debajo del puntero quieto: con `:hover` solo, el
// navegador le ponía el fondo mientras se escribía (un cambio debajo de lo que se escribe). El adelanto ya esperaba un
// movimiento real (`MouseGate` de `relUnderline.ts`, D455); este mismo criterio decide el fondo: el contenedor del editor
// lleva `data-rel-mouse` mientras el mouse está armado (se movió a otro lugar desde la última tecla) y el CSS pide eso.
// Es solo vista: no toca el documento.

/** El atributo del contenedor del editor (`.editor`, el de BlockNoteView) con el mouse armado. */
export const MOUSE_ATTR = 'data-rel-mouse';

/** Teclas que solas no escriben (el principio de un atajo): no desarman. */
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock']);

/** Dónde poner el atributo: el contenedor `.editor` (React no lo maneja; ProseMirror rehace los atributos de su nodo). */
const hostOf = (view: EditorView): HTMLElement | null => (view.dom.closest?.('.editor') as HTMLElement | null) ?? view.dom.parentElement;

class GateView {
  private readonly gate = new MouseGate();
  private readonly win: Window | null;
  private readonly onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    this.gate.move(e.clientX, e.clientY);
    this.show();
  };
  private readonly onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') this.gate.place(e.clientX, e.clientY);
  };

  constructor(private readonly view: EditorView) {
    this.win = view.dom.ownerDocument?.defaultView ?? null;
    // En la fase de captura, como `relUnderline.ts`: dónde está el mouse en toda la ventana.
    this.win?.addEventListener('pointermove', this.onMove, true);
    this.win?.addEventListener('pointerdown', this.onDown, true);
  }

  /** Una tecla que escribe o mueve el cursor: hasta que el mouse se mueva, sin fondo. */
  key(): void {
    this.gate.key();
    this.show();
  }

  private show(): void {
    const host = hostOf(this.view);
    if (!host) return;
    if (this.gate.armed) host.setAttribute(MOUSE_ATTR, '');
    else host.removeAttribute(MOUSE_ATTR);
  }

  destroy(): void {
    this.win?.removeEventListener('pointermove', this.onMove, true);
    this.win?.removeEventListener('pointerdown', this.onDown, true);
    hostOf(this.view)?.removeAttribute(MOUSE_ATTR);
  }
}

export function hoverGateExtension() {
  const views = new WeakMap<EditorView, GateView>();
  const plugin = new Plugin({
    view: (view) => {
      const v = new GateView(view);
      views.set(view, v);
      return v;
    },
    props: {
      handleKeyDown: (view, event) => {
        if (!MODIFIERS.has(event.key)) views.get(view)?.key();
        return false;
      },
      // El teclado de un teléfono no siempre manda la tecla.
      handleTextInput: (view) => {
        views.get(view)?.key();
        return false;
      },
    },
  });
  return createExtension({ key: 'shotdocs-rel-hover-gate', prosemirrorPlugins: [plugin] });
}
