// @vitest-environment jsdom
// La barra de los links (Edit link, Open in new tab, Remove link) con el tooltip de la app (D226, roadmap B.25 c;
// toolbarTips.tsx): el nombre en `data-tip` en los botones de ícono, ninguno en el de texto (repetiría «Edit link») y sin
// el globo de BlockNote; cada botón sigue haciendo lo suyo.
import { BlockNoteEditor } from '@blocknote/core';
import { BlockNoteView } from '@blocknote/mantine';
import { TextSelection } from '@tiptap/pm/state';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, roots, screen, setupDom } from './formatToolbarHarness';
import { editorSchemaOptions } from './editorSchema';
import { linkToolbarTip, PageLinkToolbarController } from './toolbarTips';

beforeAll(setupDom);
afterEach(cleanup);

async function mountWithLink(coarse = false) {
  screen(coarse);
  const editor = BlockNoteEditor.create({ ...editorSchemaOptions }) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push(root);
  await act(async () => {
    root.render(
      <BlockNoteView editor={editor} sideMenu={false} formattingToolbar={false} linkToolbar={false} slashMenu={false}>
        <PageLinkToolbarController />
      </BlockNoteView>,
    );
  });
  await act(async () => {
    editor.replaceBlocks(editor.document, [
      { id: 'a', type: 'paragraph', content: [{ type: 'text', text: 'ver ', styles: {} }, { type: 'link', href: 'https://example.com/', content: 'el sitio' }] },
    ] as never);
  });
  // El cursor adentro del link: la barra de los links se abre sola.
  await act(async () => {
    editor.focus();
    const v = editor.prosemirrorView!;
    let at = -1;
    v.state.doc.descendants((n, pos) => {
      if (n.isText && n.text === 'el sitio') at = pos + 3;
      return at < 0;
    });
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, at)));
  });
  await act(async () => new Promise((r) => setTimeout(r, 100)));
  return editor;
}

const bar = () => document.querySelector('.bn-link-toolbar');
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('.bn-link-toolbar button')];

describe('la barra de los links con los tooltips de la app (D226)', () => {
  it('Open in new tab y Remove link con su nombre en data-tip, Edit link sin tooltip, ninguno con title', async () => {
    await mountWithLink();
    expect(bar()).not.toBeNull();
    const all = buttons();
    expect(all).toHaveLength(3);
    const byLabel = Object.fromEntries(all.map((b) => [b.getAttribute('aria-label') ?? b.textContent, b.getAttribute('data-tip')]));
    expect(byLabel).toEqual({ 'Edit link': null, 'Open in new tab': 'Open in new tab', 'Remove link': 'Remove link' });
    for (const b of all) expect(b.hasAttribute('title')).toBe(false);
  });

  it('el globo de BlockNote ya no aparece al pasar el mouse', async () => {
    await mountWithLink();
    for (const b of buttons()) {
      await act(async () => {
        for (const type of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter']) b.dispatchEvent(new MouseEvent(type, { bubbles: type.endsWith('over') }));
      });
    }
    await act(async () => new Promise((r) => setTimeout(r, 300)));
    expect(document.querySelector('.bn-tooltip, [role="tooltip"]')).toBeNull();
  });

  it('cada botón hace lo de antes: Open abre el link en otra pestaña; Remove saca el link y deja el texto', async () => {
    const editor = await mountWithLink();
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const openBtn = buttons().find((b) => b.getAttribute('aria-label') === 'Open in new tab')!;
    await act(async () => {
      openBtn.click();
    });
    expect(open).toHaveBeenCalledWith('https://example.com/', '_blank');
    const remove = buttons().find((b) => b.getAttribute('aria-label') === 'Remove link')!;
    await act(async () => {
      remove.click();
    });
    const content = editor.getBlock('a')!.content as { type: string; text?: string }[];
    expect(content.some((c) => c.type === 'link')).toBe(false);
    expect(content.map((c) => c.text ?? '').join('')).toBe('ver el sitio');
  });

  it('Edit link sigue abriendo su formulario', async () => {
    await mountWithLink();
    const edit = buttons().find((b) => b.textContent === 'Edit link')!;
    await act(async () => {
      edit.click();
    });
    await act(async () => new Promise((r) => setTimeout(r, 200)));
    expect(document.querySelector('.bn-form-popover input')).not.toBeNull();
  });
});

describe('linkToolbarTip', () => {
  it('el nombre del botón de ícono; nada en el de texto; el data-tip propio queda', () => {
    expect(linkToolbarTip({ mainTooltip: 'Open in new tab', label: 'Open in new tab' })).toBe('Open in new tab');
    expect(linkToolbarTip({ label: 'Remove link' })).toBe('Remove link');
    expect(linkToolbarTip({ mainTooltip: 'Edit', children: 'Edit link' })).toBeUndefined();
    expect(linkToolbarTip({ 'data-tip': 'x', mainTooltip: 'Edit' })).toBe('x');
  });
});
