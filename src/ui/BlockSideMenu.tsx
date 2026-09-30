import { SideMenuExtension, type BlockNoteEditor } from '@blocknote/core';
import { SideMenuController, useBlockNoteEditor, useComponentsContext, useExtension, useExtensionState } from '@blocknote/react';
import type { ComponentProps } from 'react';
import { useT } from '../i18n';
import '../i18n/lazy/editor';
import { selectWholeBlock } from './blockHandle';
import { handlePlace } from './gutterLayout';
import { BlockDotsIcon } from './icons';

// El menú lateral de cada bloque (pedido de Lega sobre v0.053/v0.054): solo tres puntos, sin el "+" de BlockNote
// ni su menú del tirador. Arrastrar los puntos mueve el bloque (lo de BlockNote, `blockDragStart`); un clic
// elige el bloque entero (blockHandle.ts), y con eso aparece la barra de formato entera: tipo de bloque ("Turn
// into"), negrita, colores, comentar… Borrar es Retroceso o Supr con el bloque elegido (ya no hay "Borrar" en un
// menú). En un título los puntos van a la izquierda del triángulo de colapsar: [puntos] [triángulo] [texto]
// (gutterLayout.ts).

type AnyEditor = BlockNoteEditor<any, any, any>;
type FloatingOptions = NonNullable<ComponentProps<typeof SideMenuController>['floatingUIOptions']>;

/** El elemento del bloque (`.bn-block`) en pantalla. */
function blockElement(editor: AnyEditor, id: string): Element | null {
  return editor.domElement?.querySelector(`[data-node-type="blockContainer"][data-id="${CSS.escape(id)}"]`) ?? null;
}

/** El dibujo del triángulo de ese título, si está en pantalla (CollapseToggles.tsx). */
function triangleOf(block: Element): Element | null {
  const id = block.getAttribute('data-id');
  const host = block.closest('.editor-host') ?? block.ownerDocument;
  return id ? host.querySelector(`.sd-collapse-toggle[data-id="${CSS.escape(id)}"] svg`) : null;
}

/**
 * Ubica los puntos (reemplaza el corrimiento fijo de BlockNote, pensado para sus tamaños de título): el borde
 * derecho a `GUTTER_GAP` del triángulo o del texto, y centrados en el primer renglón del bloque.
 */
const placeHandle = {
  name: 'sdPlaceHandle',
  fn(state: { x: number; y: number; rects: { reference: { x: number; y: number }; floating: { width: number; height: number } }; elements: { reference: unknown } }) {
    // BlockNote ubica con una referencia virtual (`contextElement` es el bloque en pantalla).
    const virtual = state.elements.reference as { contextElement?: unknown; getBoundingClientRect?: () => DOMRect } | null;
    const ref = virtual instanceof Element ? virtual : virtual?.contextElement;
    if (!(ref instanceof Element)) return {};
    // La referencia de BlockNote es el bloque (`.bn-block-outer` o `.bn-block`, según la versión).
    const container = '[data-node-type="blockContainer"]';
    const block = ref.matches(container) ? ref : (ref.querySelector(`:scope > ${container}`) ?? ref.closest(container));
    if (!block) return {};
    const place = handlePlace(block, triangleOf(block));
    if (!place) return {};
    const box = virtual?.getBoundingClientRect?.() ?? ref.getBoundingClientRect();
    const { reference, floating } = state.rects;
    return {
      x: reference.x + (place.right - box.left) - floating.width,
      y: reference.y + (place.centerY - box.top) - floating.height / 2,
    };
  },
};

const FLOATING: FloatingOptions = { useFloatingOptions: { middleware: [placeHandle as never] } };

/** Los tres puntos: arrastrar mueve el bloque; un clic lo elige (y aparece la barra de formato). */
function DotsHandle({ block }: { block: { id: string } }) {
  const editor = useBlockNoteEditor();
  const sideMenu = useExtension(SideMenuExtension);
  const tr = useT();
  return (
    <button
      type="button"
      className="sd-drag-handle"
      draggable
      aria-label={tr('block.handleLabel')}
      data-tip={`**${tr('block.handleClick')}**\n${tr('block.handleDrag')}`}
      onDragStart={(e) => sideMenu.blockDragStart(e, block as never)}
      onDragEnd={() => sideMenu.blockDragEnd()}
      onClick={() => {
        const view = editor.prosemirrorView;
        if (view) selectWholeBlock(view, block.id);
      }}
    >
      <BlockDotsIcon />
    </button>
  );
}

function BlockSideMenu() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor();
  const block = useExtensionState(SideMenuExtension, { editor, selector: (s) => s?.block });
  if (!block) return null;
  // En un título del teléfono no entran los puntos al lado del triángulo: va solo el triángulo.
  const el = blockElement(editor as AnyEditor, block.id);
  const place = el ? handlePlace(el, triangleOf(el)) : null;
  const room = !place || place.fits;
  return (
    <Components.SideMenu.Root className={`bn-side-menu sd-side-menu${room ? '' : ' sd-no-room'}`}>
      <DotsHandle block={block} />
    </Components.SideMenu.Root>
  );
}

/** El menú lateral del editor de la página: solo los puntos. */
export function BlockSideMenuController() {
  return <SideMenuController sideMenu={BlockSideMenu} floatingUIOptions={FLOATING} />;
}
