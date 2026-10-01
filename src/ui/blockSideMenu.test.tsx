// @vitest-environment jsdom
import { BlockNoteEditor, SideMenuExtension } from '@blocknote/core';
import { BlockNoteView } from '@blocknote/mantine';
import { FormattingToolbarController } from '@blocknote/react';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import { ServicesContext } from '../services';
import { BlockSideMenuController } from './BlockSideMenu';
import { schema } from './editorSchema';
import { PageFormattingToolbar, pageToolbarItems } from './PageToolbar';

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

// La barra de la página (PageToolbar.tsx), la misma que usa PageEditor.tsx.
function Toolbar() {
  return <PageFormattingToolbar items={pageToolbarItems(editors[0].dictionary, t)} canComment={false} />;
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
      <ServicesContext.Provider value={{ media: {} } as never}>
        <BlockNoteView editor={editor} sideMenu={false} formattingToolbar={false} slashMenu={false}>
          <FormattingToolbarController formattingToolbar={Toolbar} />
          <BlockSideMenuController />
        </BlockNoteView>
      </ServicesContext.Provider>,
    );
  });
  await act(async () => {
    editor.replaceBlocks(editor.document, [
      { type: 'heading', props: { level: 2 }, content: 'Título' },
      { type: 'paragraph', props: { backgroundColor: 'blue', textColor: 'red' }, content: 'Un renglón' },
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

  it('con el bloque elegido: sin "Link" (BlockNote lo pondría sobre otra parte del texto) y con los colores del bloque', async () => {
    const editor = await mount();
    await hover(editor, 1);
    await act(async () => {
      sideMenu()!.querySelector<HTMLButtonElement>('.sd-drag-handle')!.click();
    });
    const toolbar = document.querySelector('.bn-formatting-toolbar')!;
    expect(toolbar).not.toBeNull();
    expect(toolbar.querySelector('[data-test="createLink"]')).toBeNull();
    const colors = toolbar.querySelector<HTMLButtonElement>('[data-test="blockColors"]');
    expect(colors).not.toBeNull();
    // El dibujo dice los colores que tiene el bloque.
    expect(colors!.querySelector('.bn-color-icon')!.getAttribute('data-background-color')).toBe('blue');
    expect(colors!.querySelector('.bn-color-icon')!.getAttribute('data-text-color')).toBe('red');
  });

  it('los colores del bloque se cambian y se sacan con "Default"; el bloque sigue elegido', async () => {
    const editor = await mount();
    await hover(editor, 1);
    await act(async () => {
      sideMenu()!.querySelector<HTMLButtonElement>('.sd-drag-handle')!.click();
    });
    const open = async () => {
      const trigger = document.querySelector<HTMLButtonElement>('[data-test="blockColors"]')!;
      await act(async () => {
        trigger.click();
        // El menú de Mantine se abre en el cuadro siguiente.
        await new Promise((r) => setTimeout(r, 50));
      });
    };
    const pick = async (test: string) => {
      await open();
      const item = document.querySelector<HTMLElement>(`[data-test="${test}"]`);
      expect(item, test).not.toBeNull();
      await act(async () => {
        item!.click();
      });
    };
    await pick('block-background-color-default');
    expect(editor.document[1].props).toMatchObject({ backgroundColor: 'default', textColor: 'red' });
    await pick('block-text-color-default');
    expect(editor.document[1].props).toMatchObject({ backgroundColor: 'default', textColor: 'default' });
    await pick('block-background-color-yellow');
    expect(editor.document[1].props).toMatchObject({ backgroundColor: 'yellow' });
    const sel = editor.prosemirrorState.selection;
    expect(sel).toBeInstanceOf(NodeSelection);
    expect((sel as NodeSelection).node.attrs.id).toBe(editor.document[1].id);
  });

  it('con texto elegido, la barra de siempre: "Link" sí, sin los colores del bloque', async () => {
    const editor = await mount();
    await act(async () => {
      editor.focus();
      const view = editor.prosemirrorView!;
      let from = -1;
      view.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === 'Un renglón') from = pos;
        return true;
      });
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, from + 2)));
    });
    const toolbar = document.querySelector('.bn-formatting-toolbar');
    expect(toolbar).not.toBeNull();
    expect(toolbar!.querySelector('[data-test="createLink"]')).not.toBeNull();
    expect(toolbar!.querySelector('[data-test="blockColors"]')).toBeNull();
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
