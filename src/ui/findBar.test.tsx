// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { schema } from './editorSchema';
import { FindBar } from './FindBar';
import { findExtension, getFindState } from './findEditor';
import { closeFindBar, getFindUi, isFindShortcut, openFindBar, takesFindShortcut, updateFindUi } from './findUi';

// La barra de buscar y reemplazar (Docs/Doc_Buscar.md): el atajo, la cuenta, reemplazar solo si se puede
// editar, y Ctrl/⌘+F en la página (la segunda vez, al navegador).

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
});

const roots: Root[] = [];
const editors: BlockNoteEditor[] = [];
const devices: Device[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const e of editors.splice(0)) e.unmount();
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  act(() => {
    closeFindBar();
    updateFindUi({ query: '', replacement: '', expanded: false, matchCase: false, wholeWord: false });
  });
  document.body.innerHTML = '';
});

const wait = (ms = 30) => act(async () => new Promise((r) => setTimeout(r, ms)));

function mountEditor(content: string[]): BlockNoteEditor {
  const editor = BlockNoteEditor.create(
    withCollaboration({
      schema,
      extensions: [findExtension],
      collaboration: { fragment: new Y.Doc().getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
    }),
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  el.className = 'editor';
  document.body.appendChild(el);
  editor.mount(el);
  editors.push(editor);
  editor.replaceBlocks(editor.document, content.map((text) => ({ type: 'paragraph' as const, content: text })));
  return editor;
}

function render(node: React.ReactNode): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(node));
  return host;
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function key(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
}

describe('el atajo', () => {
  it('Ctrl+F (⌘F en la Mac), sin Alt ni Shift', () => {
    expect(isFindShortcut({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: 'f' })).toBe(true);
    expect(isFindShortcut({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: true, key: 'F' })).toBe(false);
    expect(isFindShortcut({ ctrlKey: true, metaKey: false, altKey: true, shiftKey: false, key: 'f' })).toBe(false);
    expect(isFindShortcut({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, key: 'f' })).toBe(false);
  });

  it('se deja pasar al navegador en la barra, en otro campo y con un diálogo abierto', () => {
    const editor = document.createElement('div');
    editor.className = 'bn-editor';
    editor.contentEditable = 'true';
    const bar = document.createElement('div');
    bar.className = 'find-bar';
    const barInput = document.createElement('input');
    bar.append(barInput);
    const title = document.createElement('textarea');
    document.body.append(editor, bar, title);
    expect(takesFindShortcut(editor)).toBe(true);
    expect(takesFindShortcut(document.body)).toBe(true);
    expect(takesFindShortcut(barInput)).toBe(false);
    expect(takesFindShortcut(title)).toBe(false);
    const dialog = document.createElement('div');
    dialog.setAttribute('aria-modal', 'true');
    document.body.append(dialog);
    expect(takesFindShortcut(editor)).toBe(false);
  });
});

describe('la barra', () => {
  it('busca mientras se escribe, cuenta "1 de 3" y va con Enter y Shift+Enter', async () => {
    const editor = mountEditor(['uno dos uno', 'tres uno']);
    act(() => openFindBar());
    const host = render(<FindBar editor={editor} editable />);
    const input = host.querySelector<HTMLInputElement>('.find-input')!;
    expect(document.activeElement).toBe(input);
    type(input, 'UNO');
    await wait(150);
    expect(host.querySelector('.find-count')?.textContent).toBe('1 of 3');
    expect(editor.prosemirrorView!.dom.querySelectorAll('.sd-find-hit').length).toBe(3);
    key(input, { key: 'Enter' });
    expect(host.querySelector('.find-count')?.textContent).toBe('2 of 3');
    key(input, { key: 'Enter', shiftKey: true });
    key(input, { key: 'Enter', shiftKey: true });
    expect(host.querySelector('.find-count')?.textContent).toBe('3 of 3');
    type(input, 'nada');
    await wait(150);
    expect(host.querySelector('.find-count')?.textContent).toBe('No results');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('Esc cierra, saca los resaltados y deja elegida la coincidencia', async () => {
    const editor = mountEditor(['uno dos']);
    act(() => openFindBar());
    const host = render(<FindBar editor={editor} editable />);
    const input = host.querySelector<HTMLInputElement>('.find-input')!;
    type(input, 'dos');
    await wait(150);
    key(input, { key: 'Escape' });
    expect(getFindUi().open).toBe(false);
    expect(host.querySelector('.find-bar')).toBeNull();
    expect(editor.prosemirrorView!.dom.querySelectorAll('.sd-find-hit').length).toBe(0);
    const { from, to } = editor.prosemirrorView!.state.selection;
    expect(editor.prosemirrorView!.state.doc.textBetween(from, to)).toBe('dos');
  });

  it('toma lo elegido en el editor al abrir', async () => {
    const editor = mountEditor(['uno dos tres']);
    editor.setTextCursorPosition(editor.document[0], 'start');
    const view = editor.prosemirrorView!;
    const { TextSelection } = await import('@tiptap/pm/state');
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 7, 10)));
    act(() => openFindBar());
    const host = render(<FindBar editor={editor} editable />);
    expect(host.querySelector<HTMLInputElement>('.find-input')?.value).toBe('dos');
  });

  it('quien no puede editar no ve la flecha de reemplazar', () => {
    const editor = mountEditor(['uno']);
    act(() => {
      openFindBar();
      updateFindUi({ expanded: true });
    });
    const host = render(<FindBar editor={editor} editable={false} />);
    expect(host.querySelector('.find-toggle')).toBeNull();
    expect(host.querySelector('.find-replace-row')).toBeNull();
  });

  it('reemplazar todo avisa cuántos y ofrece deshacer', async () => {
    const editor = mountEditor(['uno dos uno']);
    act(() => openFindBar());
    const host = render(<FindBar editor={editor} editable />);
    act(() => host.querySelector<HTMLButtonElement>('.find-toggle')!.click());
    const [find, replace] = host.querySelectorAll<HTMLInputElement>('.find-input');
    type(find, 'uno');
    await wait(150);
    type(replace, '1');
    const replaceAll = [...host.querySelectorAll<HTMLButtonElement>('.find-text-button')].find((b) => b.textContent === 'Replace all')!;
    act(() => replaceAll.click());
    expect(editor.prosemirrorView!.state.doc.textContent).toBe('1 dos 1');
    expect(host.querySelector('.find-status')?.textContent).toContain('2 replaced');
    const undo = host.querySelector<HTMLButtonElement>('.find-status button')!;
    act(() => undo.click());
    expect(editor.prosemirrorView!.state.doc.textContent).toBe('uno dos uno');
  });

  it('sigue buscando cuando el editor se vuelve a montar', async () => {
    const first = mountEditor(['uno uno']);
    act(() => openFindBar());
    const host = render(<FindBar editor={first} editable />);
    type(host.querySelector<HTMLInputElement>('.find-input')!, 'uno');
    await wait(150);
    const second = mountEditor(['uno uno uno']);
    act(() => roots[0].render(<FindBar editor={second} editable />));
    await wait(150);
    expect(getFindState(second.prosemirrorView!.state).matches.length).toBe(3);
    expect(host.querySelector('.find-count')?.textContent).toBe('1 of 3');
  });
});

describe('Ctrl/⌘+F en la página', () => {
  it('abre la barra de la app; con el foco en la barra, pasa al navegador', async () => {
    const server = new FakeServer();
    const device = await makeDevice(server);
    devices.push(device);
    const page = await device.tree.create(null, 'Escena 64');
    await device.engine.syncNow();
    const services = {
      workspace: { config: { url: 'https://x.supabase.co', publishableKey: 'k', name: 'W', localKey: WANKA_LOCAL_KEY, storage: legacyStorageNames(WANKA_LOCAL_KEY) }, client: {} },
      client: { auth: { signOut: vi.fn() } },
      user: { id: device.remote.userId, email: 'a@test' },
      db: device.db,
      tree: device.tree,
      docs: device.docs,
      files: device.files,
      media: device.media,
      engine: device.engine,
      access: device.access,
      remote: device.remote as unknown as SupabaseRemote,
      dbName: 'test',
      mediaDb: device.mediaDb,
      comments: device.comments,
      commentsDb: device.commentsDb,
      sizes: device.sizes,
      shutdown: async () => undefined,
    } as unknown as Services;
    const { PageView } = await import('./PageView');
    const host = render(
      <ServicesContext.Provider value={services}>
        <main className="main">
          <PageView id={page} />
        </main>
      </ServicesContext.Provider>,
    );
    for (let i = 0; i < 100 && !host.querySelector('.bn-editor'); i++) await wait(50);
    const first = key(host.querySelector('.bn-editor')!, { key: 'f', ctrlKey: true });
    expect(first.defaultPrevented).toBe(true);
    const input = host.querySelector<HTMLInputElement>('.find-bar .find-input')!;
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    // La segunda vez, con el foco en la barra: la del navegador.
    const second = key(input, { key: 'f', ctrlKey: true });
    expect(second.defaultPrevented).toBe(false);
    // En el título, también la del navegador.
    const title = key(host.querySelector('.page-title')!, { key: 'f', ctrlKey: true });
    expect(title.defaultPrevented).toBe(false);
    key(input, { key: 'Escape' });
    expect(host.querySelector('.find-bar')).toBeNull();
  });
});
