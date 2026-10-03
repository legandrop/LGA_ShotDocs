// La barra de formato de la página montada en jsdom, para las pruebas de sus tooltips (formatToolbarTips.test.tsx y
// formatToolbarTipsMac.test.tsx). No lo usa la app.
import { BlockNoteEditor } from '@blocknote/core';
import { BlockNoteView } from '@blocknote/mantine';
import { TextSelection } from '@tiptap/pm/state';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { vi } from 'vitest';
import { t } from '../i18n';
import { ServicesContext } from '../services';
import { editorSchemaOptions } from './editorSchema';
import { PageFormattingToolbar, PageFormattingToolbarController, pageToolbarItems } from './PageToolbar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** `coarse`: la pantalla táctil (`(pointer: coarse)`). */
export function screen(coarse: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: coarse && query.includes('coarse'),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

/** Lo que jsdom no trae y BlockNote usa. */
export function setupDom() {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Range.prototype.getClientRects ??= (() => []) as never;
  Range.prototype.getBoundingClientRect ??= (() => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 })) as never;
}

export const roots: Root[] = [];

/** Desmonta lo montado (va en el `afterEach` de cada prueba). */
export function cleanup() {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
}

const editorRef: { current: BlockNoteEditor | null } = { current: null };
function Toolbar() {
  return <PageFormattingToolbar items={pageToolbarItems(editorRef.current!.dictionary, t)} canComment />;
}

/** El editor con dos párrafos y "hola" del segundo elegido: la barra de formato abierta. */
export async function mount({ coarse = false } = {}) {
  screen(coarse);
  const editor = BlockNoteEditor.create({ ...editorSchemaOptions }) as unknown as BlockNoteEditor;
  editorRef.current = editor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push(root);
  await act(async () => {
    root.render(
      <ServicesContext.Provider value={{ media: { fileInfo: () => null } } as never}>
        <BlockNoteView editor={editor} sideMenu={false} formattingToolbar={false} slashMenu={false}>
          <PageFormattingToolbarController formattingToolbar={Toolbar} />
        </BlockNoteView>
      </ServicesContext.Provider>,
    );
  });
  await act(async () => {
    editor.replaceBlocks(editor.document, [
      { id: 'a', type: 'paragraph', content: 'primero' },
      { id: 'b', type: 'paragraph', content: 'hola mundo' },
    ] as never);
  });
  await act(async () => {
    editor.focus();
    const v = editor.prosemirrorView!;
    let from = -1;
    v.state.doc.descendants((n, pos) => {
      if (n.isText && n.text === 'hola mundo') from = pos;
      return from < 0;
    });
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, from, from + 4)));
  });
  await act(async () => {
    document.dispatchEvent(new FocusEvent('focusin'));
  });
  return editor;
}

export const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('.bn-formatting-toolbar button')];
export const button = (test: string) => document.querySelector<HTMLButtonElement>(`.bn-formatting-toolbar button[data-test="${test}"]`);
/** El tooltip de cada botón de la barra con ícono, por su `data-test` (o su nombre, si no tiene). */
export const tips = () => Object.fromEntries(buttons().filter((b) => b.hasAttribute('aria-label')).map((b) => [b.getAttribute('data-test') || b.getAttribute('aria-label')!, b.getAttribute('data-tip')]));
