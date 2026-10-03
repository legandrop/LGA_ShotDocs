// @vitest-environment jsdom
// Los botones de BlockNote en la barra de formato con el tooltip de la app (D226, roadmap B.25a; toolbarTips.tsx): un
// renglón «**atajo**: acción» con el atajo del registro, o el nombre si no tiene atajo; sin el globo de BlockNote, y cada
// botón con lo que hacía (aplicar el formato, marcado y apagado).
import { BlockNoteEditor } from '@blocknote/core';
import { BlockNoteView } from '@blocknote/mantine';
import { TextSelection } from '@tiptap/pm/state';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import { ServicesContext } from '../services';
import { editorSchemaOptions } from './editorSchema';
import { PageFormattingToolbarController, PageFormattingToolbar, pageToolbarItems } from './PageToolbar';
import { shortcutLabel } from './shortcuts';
import { defaultDataTest, TOOLBAR_SHORTCUTS, toolbarTip } from './toolbarTips';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** `coarse`: la pantalla táctil (`(pointer: coarse)`). */
function screen(coarse: boolean) {
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

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Range.prototype.getClientRects ??= (() => []) as never;
  Range.prototype.getBoundingClientRect ??= (() => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 })) as never;
});

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const editorRef: { current: BlockNoteEditor | null } = { current: null };
function Toolbar() {
  return <PageFormattingToolbar items={pageToolbarItems(editorRef.current!.dictionary, t)} canComment />;
}

/** El editor con dos párrafos y "hola mundo" del segundo elegido: la barra de formato abierta. */
async function mount({ coarse = false } = {}) {
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

const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('.bn-formatting-toolbar button')];
const button = (test: string) => document.querySelector<HTMLButtonElement>(`.bn-formatting-toolbar button[data-test="${test}"]`);

describe('la barra de formato: los botones de BlockNote con el tooltip de la app (D226)', () => {
  it('cada botón con su data-tip: «**atajo**: acción» con el atajo del registro, o el nombre; nunca title', async () => {
    await mount();
    const all = buttons();
    console.log(all.map((b) => [b.getAttribute('data-test'), b.getAttribute('aria-label'), b.getAttribute('data-tip'), b.disabled].join(' / ')).join('\n'));
    expect(all.length).toBeGreaterThan(8);
    for (const b of all) {
      expect(b.hasAttribute('title')).toBe(false);
      // Todos los botones con ícono (los que tienen nombre); el selector del tipo de bloque dice su texto.
      if (b.hasAttribute('aria-label')) expect(b.getAttribute('data-tip'), b.getAttribute('aria-label')!).toBeTruthy();
    }
    expect(all.filter((b) => b.hasAttribute('aria-label')).length).toBeGreaterThanOrEqual(12);
    // Los de BlockNote con atajo: el atajo es exactamente el del registro (Ctrl en jsdom, que no es una Mac).
    const shown: Record<string, string> = {
      bold: 'bold',
      italic: 'italic',
      underline: 'underline',
      strike: 'strike',
      createLink: 'create link',
      nestBlock: 'nest block',
      unnestBlock: 'unnest block',
    };
    for (const [test, action] of Object.entries(shown)) {
      expect(button(test)?.getAttribute('data-tip'), test).toBe(`**${shortcutLabel(TOOLBAR_SHORTCUTS[test], false)}**: ${action}`);
    }
    expect(button('bold')!.getAttribute('data-tip')).toBe('**Ctrl+B**: bold');
    // Sin atajo: el nombre (es un ícono).
    expect(button('alignTextLeft')!.getAttribute('data-tip')).toBe('Align text left');
    expect(button('colors')!.getAttribute('data-tip')).toBe('Colors');
    // Los de la app, como estaban.
    const comment = all.find((b) => b.getAttribute('aria-label') === 'Comment')!;
    expect(comment.getAttribute('data-tip')).toBe(`**${shortcutLabel('comment', false)}**: comment`);
  });

  it('el globo de BlockNote ya no aparece al pasar el mouse', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await mount();
      for (const b of buttons()) {
        act(() => {
          for (const type of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'focus']) b.dispatchEvent(new MouseEvent(type, { bubbles: type.endsWith('over') }));
        });
        act(() => vi.advanceTimersByTime(1500));
      }
      expect(document.querySelector('.bn-tooltip, [role="tooltip"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cada botón hace lo de antes: Bold pone negrita y queda marcado; Nest se apaga donde no se puede', async () => {
    const editor = await mount();
    const bold = button('bold')!;
    expect(bold.getAttribute('aria-pressed')).toBe('false');
    await act(async () => {
      bold.click();
    });
    expect(editor.getActiveStyles()).toMatchObject({ bold: true });
    expect(button('bold')!.getAttribute('aria-pressed')).toBe('true');
    // Un renglón de arriba de todo no se puede desanidar: el botón sigue apagado; anidar, prendido y anida.
    expect(button('unnestBlock')!.disabled).toBe(true);
    expect(button('nestBlock')!.disabled).toBe(false);
    // Alinear al centro sigue alineando, y queda marcado.
    await act(async () => {
      button('alignTextCenter')!.click();
    });
    expect((editor.getBlock('b')!.props as { textAlignment: string }).textAlignment).toBe('center');
    expect(button('alignTextCenter')!.getAttribute('aria-pressed')).toBe('true');
    await act(async () => {
      button('nestBlock')!.click();
    });
    expect(editor.getBlock('a')!.children.map((c) => c.id)).toEqual(['b']);
  });

  it('en una pantalla táctil, sin atajos: el botón con atajo se queda sin tooltip; el de solo nombre lo conserva', async () => {
    await mount({ coarse: true });
    expect(button('bold')!.hasAttribute('data-tip')).toBe(false);
    expect(button('alignTextLeft')!.getAttribute('data-tip')).toBe('Align text left');
  });
});

describe('toolbarTip', () => {
  const env = { touch: false, mac: true, lang: 'en' as const };
  it('con atajo, el renglón; en la Mac con ⌘', () => {
    expect(toolbarTip({ 'data-test': 'bold', mainTooltip: 'Bold', secondaryTooltip: 'Ctrl+B' }, env)).toBe('**⌘B**: bold');
    expect(toolbarTip({ 'data-test': 'createLink', mainTooltip: 'Create link' }, env)).toBe('**⌘K**: create link');
    expect(toolbarTip({ 'data-test': 'unnestBlock', mainTooltip: 'Unnest block' }, { ...env, mac: false })).toBe('**Shift+Tab**: unnest block');
  });
  it('sin atajo, el nombre; el data-tip de un botón de la app queda como está', () => {
    expect(toolbarTip({ 'data-test': 'mergeCells', mainTooltip: 'Merge cells' }, env)).toBe('Merge cells');
    expect(toolbarTip({ label: 'Colors' }, env)).toBe('Colors');
    expect(toolbarTip({ 'data-tip': 'x', mainTooltip: 'Bold', 'data-test': 'bold' }, env)).toBe('x');
    expect(toolbarTip({}, env)).toBeUndefined();
  });
  it('el data-test que BlockNote saca del nombre se conserva', () => {
    expect(defaultDataTest('Merge cells')).toBe('mergecells');
  });
  it('cada atajo de la tabla existe en el registro', () => {
    for (const id of Object.values(TOOLBAR_SHORTCUTS)) expect(() => shortcutLabel(id)).not.toThrow();
  });
});
