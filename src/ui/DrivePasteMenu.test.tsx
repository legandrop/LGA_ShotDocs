// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createDrivePaste, type DrivePaste } from './drivePaste';
import { DRIVE_CARD_PROP, schema } from './editorSchema';
import { DrivePasteMenu } from './DrivePasteMenu';

// El menú al pegar un link de Drive (paso 13): aparece junto al cursor sin llevarse el foco; Escape, tocar
// afuera o seguir escribiendo lo cierran (queda el link); las flechas y Enter eligen.

const URL_FILE = 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom no trae ClipboardEvent (ProseMirror lo usa al pegar).
  const g = globalThis as { ClipboardEvent?: unknown };
  g.ClipboardEvent ??= class extends Event {
    clipboardData: unknown = null;
  };
});

let root: Root | null = null;
let editor: BlockNoteEditor | null = null;
afterEach(() => {
  act(() => root?.unmount());
  editor?.unmount();
  root = null;
  editor = null;
  document.body.replaceChildren();
});

function setup(): { paste: DrivePaste; editor: BlockNoteEditor } {
  const paste = createDrivePaste();
  const e = BlockNoteEditor.create({ schema, pasteHandler: paste.pasteHandler }) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  e.mount(el);
  e.replaceBlocks(e.document, [{ type: 'paragraph', content: 'Mirá ' }]);
  e.setTextCursorPosition(e.document[0], 'end');
  editor = e;
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<DrivePasteMenu paste={paste} editor={e} />));
  return { paste, editor: e };
}

function pasteLink(e: BlockNoteEditor) {
  const ev = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clipboardData', { value: { types: ['text/plain'], getData: () => URL_FILE, files: [] } });
  act(() => {
    e.prosemirrorView!.dom.dispatchEvent(ev);
  });
}

const menu = () => document.querySelector('.drive-paste-menu');
const key = (k: string) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });
const linked = (e: BlockNoteEditor) => (e.document[0].content as { type: string }[]).some((c) => c.type === 'link');

describe('menú al pegar un link de Drive', () => {
  it('aparece con Link, Text y Card, y Escape lo cierra dejando el link', () => {
    const { editor: e } = setup();
    expect(menu()).toBeNull();
    pasteLink(e);
    expect([...menu()!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Link', 'Text', 'Card']);
    expect(menu()!.querySelector('button.is-active')?.textContent).toBe('Link');
    // Un tooltip propio (nunca `title=`) explica la tarjeta.
    expect(menu()!.querySelector('[title]')).toBeNull();
    expect(menu()!.querySelectorAll('button')[2].getAttribute('data-tip')).toMatch(/Drive player/);
    key('Escape');
    expect(menu()).toBeNull();
    expect(linked(e)).toBe(true);
  });

  it('seguir escribiendo lo cierra', () => {
    const { editor: e } = setup();
    pasteLink(e);
    key('Shift');
    expect(menu()).not.toBeNull();
    key('a');
    expect(menu()).toBeNull();
    expect(linked(e)).toBe(true);
  });

  it('tocar afuera lo cierra', () => {
    const { editor: e } = setup();
    pasteLink(e);
    act(() => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(menu()).toBeNull();
  });

  it('con las flechas y Enter se elige (Text saca el link)', () => {
    const { editor: e } = setup();
    pasteLink(e);
    key('ArrowDown');
    expect(menu()!.querySelector('button.is-active')?.textContent).toBe('Text');
    key('Enter');
    expect(menu()).toBeNull();
    expect(linked(e)).toBe(false);
  });

  it('un clic en Card arma la tarjeta', () => {
    const { editor: e } = setup();
    pasteLink(e);
    act(() => menu()!.querySelectorAll('button')[2].click());
    expect(menu()).toBeNull();
    expect(e.document.some((b) => (b.props as Record<string, unknown>)[DRIVE_CARD_PROP] === true)).toBe(true);
  });
});
