// @vitest-environment jsdom
import { BlockNoteEditor, SideMenuExtension } from '@blocknote/core';
import { BlockNoteView } from '@blocknote/mantine';
import { FormattingToolbar, FormattingToolbarController, getFormattingToolbarItems } from '@blocknote/react';
import { NodeSelection } from '@tiptap/pm/state';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BlockSideMenuController } from './BlockSideMenu';
import { schema } from './editorSchema';

// El menú lateral de cada bloque (pedido de Lega): solo tres puntos, sin el "+"; un clic elige el bloque entero y
// abre la barra de formato entera (tipo de bloque, colores…), sin el menú del tirador de BlockNote ni "Borrar";
// arrastrar los puntos sigue siendo el arrastre de BlockNote.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as never;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Range.prototype.getClientRects ??= (() => []) as never;
  Range.prototype.getBoundingClientRect ??= (() => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 })) as never;
});

const roots: Root[] = [];
const editors: BlockNoteEditor[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  editors.splice(0);
  document.body.innerHTML = '';
});

function Toolbar() {
  return <FormattingToolbar>{getFormattingToolbarItems()}</FormattingToolbar>;
}

async function mount() {
  const editor = BlockNoteEditor.create({ schema }) as unknown as BlockNoteEditor;
  editors.push(editor);
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push(root);
  await act(async () => {
    root.render(
      <BlockNoteView editor={editor} sideMenu={false} formattingToolbar={false} slashMenu={false}>
        <FormattingToolbarController formattingToolbar={Toolbar} />
        <BlockSideMenuController />
      </BlockNoteView>,
    );
  });
  await act(async () => {
    editor.replaceBlocks(editor.document, [
      { type: 'heading', props: { level: 2 }, content: 'Título' },
      { type: 'paragraph', content: 'Un renglón' },
    ] as never);
  });
  return editor;
}

/** Muestra el menú lateral en un bloque (lo que hace BlockNote al pasar el mouse; jsdom no mide). */
async function hover(editor: BlockNoteEditor, index: number) {
  const ext = editor.getExtension(SideMenuExtension)!;
  await act(async () => {
    ext.store.setState({ show: true, block: editor.document[index], referencePos: new DOMRect(0, 0, 10, 10) } as never);
  });
  return ext;
}

const sideMenu = () => document.querySelector('.bn-side-menu');

describe('los puntos de cada bloque', () => {
  it('son tres puntos redondos y no hay "+"', async () => {
    const editor = await mount();
    await hover(editor, 1);
    const menu = sideMenu();
    expect(menu).not.toBeNull();
    const buttons = menu!.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    const handle = buttons[0];
    expect(handle.classList.contains('sd-drag-handle')).toBe(true);
    expect(handle.getAttribute('draggable')).toBe('true');
    expect(handle.querySelectorAll('svg circle')).toHaveLength(3);
    // Ni el "+" de BlockNote ni su tirador de seis puntos.
    expect(menu!.querySelector('[data-test="dragHandle"]')).toBeNull();
    expect(document.querySelector('[aria-label="Add block"], [aria-label="Agregar bloque"]')).toBeNull();
  });

  it('un clic elige el bloque entero y abre la barra de formato, sin el menú del tirador ni "Borrar"', async () => {
    const editor = await mount();
    await hover(editor, 0);
    const handle = sideMenu()!.querySelector<HTMLButtonElement>('.sd-drag-handle')!;
    await act(async () => {
      handle.click();
    });
    const sel = editor.prosemirrorState.selection;
    expect(sel).toBeInstanceOf(NodeSelection);
    expect((sel as NodeSelection).node.type.name).toBe('blockContainer');
    expect((sel as NodeSelection).node.attrs.id).toBe(editor.document[0].id);
    const toolbar = document.querySelector('.bn-formatting-toolbar');
    expect(toolbar).not.toBeNull();
    // El selector de tipo de bloque ("Turn into") dice qué es.
    expect(toolbar!.textContent).toContain('Heading 2');
    expect(document.querySelector('.bn-drag-handle-menu')).toBeNull();
    expect([...document.querySelectorAll('[role="menuitem"]')].map((m) => m.textContent)).not.toContain('Delete');
  });

  it('arrastrar los puntos es el arrastre de BlockNote (con el bloque de los puntos)', async () => {
    const editor = await mount();
    const ext = await hover(editor, 1);
    const start = vi.spyOn(ext, 'blockDragStart').mockImplementation(() => undefined);
    const end = vi.spyOn(ext, 'blockDragEnd').mockImplementation(() => undefined);
    const handle = sideMenu()!.querySelector<HTMLButtonElement>('.sd-drag-handle')!;
    await act(async () => {
      handle.dispatchEvent(new Event('dragstart', { bubbles: true }));
      handle.dispatchEvent(new Event('dragend', { bubbles: true }));
    });
    expect(start).toHaveBeenCalledTimes(1);
    expect((start.mock.calls[0][1] as { id: string }).id).toBe(editor.document[1].id);
    expect(end).toHaveBeenCalledTimes(1);
  });
});
