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
import { findExtension, getFindState, landOnOccurrence, setFind } from './findEditor';
import { isKeepingInView, stopKeepingInView } from './findScroll';
import { closeFindBar, getFindUi, hasFindTarget, isFindShortcut, isStepShortcut, openFindBar, openFindBarAt, takesFindShortcut, takesStepShortcut, updateFindUi } from './findUi';

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
afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const e of editors.splice(0)) e.unmount();
  for (const d of devices.splice(0)) {
    await d.engine.stop();
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

function mountEditor(content: string[], parent: HTMLElement = document.body): BlockNoteEditor {
  const editor = BlockNoteEditor.create(
    withCollaboration({
      schema,
      extensions: [findExtension],
      collaboration: { fragment: new Y.Doc().getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
    }),
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  el.className = 'editor';
  parent.appendChild(el);
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

  it('en la Mac, ⌘F sí y Ctrl+F no; en el resto, al revés', () => {
    const cmd = { ctrlKey: false, metaKey: true, altKey: false, shiftKey: false, key: 'f' };
    const ctrl = { ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: 'f' };
    expect(isFindShortcut(cmd, true)).toBe(true);
    expect(isFindShortcut(ctrl, true)).toBe(false);
    expect(isFindShortcut(cmd, false)).toBe(false);
    expect(isFindShortcut(ctrl, false)).toBe(true);
    expect(isStepShortcut({ ...cmd, key: 'g' }, true)).toBe(true);
    expect(isStepShortcut({ ...ctrl, key: 'g' }, true)).toBe(false);
  });

  it('se mira la letra, no la posición: con Dvorak, Ctrl+U (donde está la F) y Ctrl+I (la G) no son buscar', () => {
    const ctrl = { ctrlKey: true, metaKey: false, altKey: false, shiftKey: false };
    expect(isFindShortcut({ ...ctrl, key: 'u', code: 'KeyF' }, false)).toBe(false);
    expect(isFindShortcut({ ...ctrl, key: 'f', code: 'KeyY' }, false)).toBe(true);
    expect(isStepShortcut({ ...ctrl, key: 'i', code: 'KeyG' }, false)).toBe(false);
    // Un teclado que no da letras latinas (ruso): la posición.
    expect(isFindShortcut({ ...ctrl, key: 'а', code: 'KeyF' }, false)).toBe(true);
    expect(isStepShortcut({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: true, key: 'F3' }, false)).toBe(true);
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
    dialog.remove();
    // Un diálogo sin `aria-modal` (mover, compartir, miembros).
    const modal = document.createElement('div');
    modal.className = 'modal';
    document.body.append(modal);
    expect(takesFindShortcut(editor)).toBe(false);
    expect(takesStepShortcut(editor)).toBe(false);
    modal.remove();
    expect(takesStepShortcut(barInput)).toBe(true);
    expect(takesStepShortcut(title)).toBe(false);
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

  it('al volver a montarse no le roba el foco a nadie y conserva el aviso del reemplazo', async () => {
    const editor = mountEditor(['uno dos uno']);
    act(() => openFindBar());
    const host = render(<FindBar editor={editor} editable />);
    act(() => host.querySelector<HTMLButtonElement>('.find-toggle')!.click());
    type(host.querySelector<HTMLInputElement>('.find-input')!, 'uno');
    await wait(150);
    act(() => [...host.querySelectorAll<HTMLButtonElement>('.find-text-button')].find((b) => b.textContent === 'Replace all')!.click());
    expect(host.querySelector('.find-status')?.textContent).toContain('2 replaced');
    // Alguien escribe en el panel de comentarios; el editor se vuelve a abrir (la barra se desmonta un momento).
    const comment = document.createElement('textarea');
    document.body.append(comment);
    comment.focus();
    act(() => roots[0].render(<></>));
    act(() => roots[0].render(<FindBar editor={editor} editable />));
    await wait(150);
    expect(document.activeElement).toBe(comment);
    expect(host.querySelector('.find-status')?.textContent).toContain('2 replaced');
  });

  it('Enter con un IME a medio escribir no va a la siguiente', async () => {
    const editor = mountEditor(['uno uno']);
    act(() => openFindBar());
    const host = render(<FindBar editor={editor} editable />);
    const input = host.querySelector<HTMLInputElement>('.find-input')!;
    type(input, 'uno');
    await wait(150);
    key(input, { key: 'Enter', isComposing: true });
    expect(host.querySelector('.find-count')?.textContent).toBe('1 of 2');
    key(input, { key: 'Escape', isComposing: true });
    expect(getFindUi().open).toBe(true);
  });
});

function pageServices(device: Device, overrides: Partial<Services> = {}): Services {
  return {
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
    ...overrides,
  } as unknown as Services;
}

async function openPage(services: (device: Device, page: string) => Services = (d) => pageServices(d)) {
  const server = new FakeServer();
  const device = await makeDevice(server);
  devices.push(device);
  const page = await device.tree.create(null, 'Escena 64');
  await device.engine.syncNow();
  const { PageView } = await import('./PageView');
  const host = render(
    <ServicesContext.Provider value={services(device, page)}>
      <main className="main">
        <PageView id={page} />
      </main>
    </ServicesContext.Provider>,
  );
  for (let i = 0; i < 100 && !host.querySelector('.bn-editor'); i++) await wait(50);
  return { host, device, page };
}

describe('ir a un resultado del proyecto (v0.057)', () => {
  it('si el documento todavía no tiene la coincidencia (se está dibujando), espera a que aparezca y va a la pedida', async () => {
    const editor = mountEditor(['nada por ahora']);
    const view = editor.prosemirrorView!;
    act(() => setFind(view, 'zanahoria', {}));
    expect(getFindState(view.state).matches).toHaveLength(0);
    act(() => landOnOccurrence(view, { blockId: 'b2', occurrence: 1 }));
    act(() => {
      editor.replaceBlocks(editor.document, [
        { id: 'b1', type: 'paragraph', content: 'una zanahoria' },
        { id: 'b2', type: 'paragraph', content: 'zanahoria y otra zanahoria' },
      ]);
    });
    await wait(400);
    const state = getFindState(view.state);
    expect(state.matches).toHaveLength(3);
    // La segunda del bloque b2: la tercera de la página.
    expect(state.current).toBe(2);
  });

  it('si mientras espera se busca otra cosa, no salta a la pedida', async () => {
    const editor = mountEditor(['nada']);
    const view = editor.prosemirrorView!;
    act(() => setFind(view, 'zanahoria', {}));
    act(() => landOnOccurrence(view, { blockId: 'b2', occurrence: 0 }));
    act(() => setFind(view, 'nada', {}));
    act(() => {
      editor.replaceBlocks(editor.document, [
        { id: 'b1', type: 'paragraph', content: 'nada zanahoria' },
        { id: 'b2', type: 'paragraph', content: 'zanahoria nada' },
      ]);
    });
    await wait(400);
    const state = getFindState(view.state);
    expect(state.query).toBe('nada');
    expect(state.current).toBe(0);
  });

  it('la barra no pasa del ancho que se ve de la página que se desplaza (una hoja A3 en una ventana angosta)', async () => {
    const main = document.createElement('main');
    main.style.overflowY = 'auto';
    main.style.paddingRight = '40px';
    Object.defineProperty(main, 'clientWidth', { value: 700 });
    const article = document.createElement('article');
    main.append(article);
    document.body.append(main);
    const editor = mountEditor(['uno']);
    act(() => openFindBar());
    const root = createRoot(article);
    roots.push(root);
    act(() => root.render(<FindBar editor={editor} editable />));
    const anchorEl = article.querySelector<HTMLElement>('.find-anchor')!;
    // 700 de ancho visible menos los 40 que tapa el panel de comentarios.
    expect(anchorEl.style.getPropertyValue('--find-visible-width')).toBe('660px');
  });
});

/**
 * Un `.main` que se desplaza (800 de alto) y una coincidencia actual a 3000 px en el contenido: así se ve si
 * algo la centró (`scrollTop` deja de ser 0).
 */
function scroller(): HTMLElement {
  const main = document.createElement('main');
  main.style.overflowY = 'auto';
  document.body.append(main);
  let top = 0;
  Object.defineProperty(main, 'scrollTop', { get: () => top, set: (v: number) => (top = Math.max(0, v)) });
  Object.defineProperty(main, 'clientHeight', { value: 800 });
  Object.defineProperty(main, 'clientWidth', { value: 900 });
  main.getBoundingClientRect = () => ({ top: 0, left: 0, right: 900, bottom: 800, width: 900, height: 800 }) as DOMRect;
  const real = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this === main) return main.getBoundingClientRect();
    if (this.classList.contains('sd-find-current')) return { top: 3000 - top, bottom: 3020 - top, left: 100, right: 180, width: 80, height: 20 } as DOMRect;
    return real.call(this);
  });
  return main;
}

const userInputs = {
  wheel: (main: HTMLElement) => main.dispatchEvent(new Event('wheel', { bubbles: true })),
  pointerdown: (main: HTMLElement) => main.dispatchEvent(new Event('pointerdown', { bubbles: true })),
  keydown: () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' })),
  drop: (main: HTMLElement) => main.dispatchEvent(new Event('drop', { bubbles: true })),
};

describe('sin pelearse con la persona (auditoría de v0.057)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('mientras espera a que aparezca la coincidencia, desplazar, un clic, una tecla o soltar algo lo corta', async () => {
    for (const [name, input] of Object.entries(userInputs)) {
      const main = scroller();
      const editor = mountEditor(['nada por ahora'], main);
      const view = editor.prosemirrorView!;
      act(() => setFind(view, 'zanahoria', {}));
      const onUser = vi.fn();
      act(() => landOnOccurrence(view, { blockId: 'b2', occurrence: 1 }, { onUser }));
      expect(isKeepingInView(view.dom), name).toBe(true);
      act(() => void input(main));
      expect(onUser, name).toHaveBeenCalled();
      expect(isKeepingInView(view.dom), name).toBe(false);
      act(() => {
        editor.replaceBlocks(editor.document, [
          { id: 'b1', type: 'paragraph', content: 'una zanahoria' },
          { id: 'b2', type: 'paragraph', content: 'zanahoria y otra zanahoria' },
        ]);
      });
      await wait(400);
      expect(getFindState(view.state).current, name).toBe(0);
      expect(main.scrollTop, name).toBe(0);
      main.remove();
      vi.restoreAllMocks();
    }
  });

  it('una segunda llegada corta la espera de la primera, y cerrar la barra corta la que queda', async () => {
    const main = scroller();
    const editor = mountEditor(['nada'], main);
    const view = editor.prosemirrorView!;
    act(() => setFind(view, 'zanahoria', {}));
    const onFirst = vi.fn();
    act(() => landOnOccurrence(view, { blockId: 'b2', occurrence: 1 }, { onUser: onFirst }));
    act(() => landOnOccurrence(view, { blockId: 'b2', occurrence: 1 }));
    act(() => stopKeepingInView(view.dom));
    act(() => void userInputs.wheel(main));
    expect(onFirst).not.toHaveBeenCalled();
    act(() => {
      editor.replaceBlocks(editor.document, [
        { id: 'b1', type: 'paragraph', content: 'una zanahoria' },
        { id: 'b2', type: 'paragraph', content: 'zanahoria y otra zanahoria' },
      ]);
    });
    await wait(400);
    expect(getFindState(view.state).current).toBe(0);
    expect(main.scrollTop).toBe(0);
  });

  it('después de llegar, desplazar corta el centrado y avisa (onUser)', async () => {
    const main = scroller();
    const editor = mountEditor(['una zanahoria'], main);
    const view = editor.prosemirrorView!;
    act(() => setFind(view, 'zanahoria', {}));
    const onUser = vi.fn();
    act(() => landOnOccurrence(view, null, { onUser }));
    await wait(50);
    expect(main.scrollTop).toBeGreaterThan(0);
    expect(isKeepingInView(view.dom)).toBe(true);
    act(() => void userInputs.wheel(main));
    expect(onUser).toHaveBeenCalledTimes(1);
    expect(isKeepingInView(view.dom)).toBe(false);
  });

  it('una página a medio bajar: si la persona se fue a otro lado, al completarse no vuelve a la coincidencia', async () => {
    const main = scroller();
    const content = [
      { id: 'b1', type: 'paragraph' as const, content: 'una zanahoria' },
      { id: 'b2', type: 'paragraph' as const, content: 'otra zanahoria' },
    ];
    const first = mountEditor(['x'], main);
    act(() => first.replaceBlocks(first.document, content));
    act(() => openFindBarAt('zanahoria', { pageId: 'p1', blockId: 'b2', occurrence: 0 }, { focus: false }));
    const host = render(<FindBar editor={first} editable={false} complete={false} pageId="p1" />);
    await wait(80);
    expect(main.scrollTop).toBeGreaterThan(0);
    expect(hasFindTarget('p1')).toBe(true);
    // La persona desplaza a otro lado.
    act(() => void userInputs.wheel(main));
    main.scrollTop = 0;
    expect(hasFindTarget('p1')).toBe(false);
    // Termina de bajar: el editor se vuelve a montar.
    const second = mountEditor(['x'], main);
    act(() => second.replaceBlocks(second.document, content));
    act(() => roots[roots.length - 1].render(<FindBar editor={second} editable complete pageId="p1" />));
    await wait(200);
    expect(getFindState(second.prosemirrorView!.state).matches).toHaveLength(2);
    expect(host.querySelector('.find-count')?.textContent).not.toBe('');
    expect(main.scrollTop).toBe(0);
  });

  it('al desmontarse la barra deja de acomodar (suelta los escuchas y el ResizeObserver)', async () => {
    const main = scroller();
    const editor = mountEditor(['una zanahoria'], main);
    const disconnect = vi.spyOn(globalThis.ResizeObserver.prototype, 'disconnect');
    const removed = vi.spyOn(main, 'removeEventListener');
    act(() => openFindBarAt('zanahoria', { pageId: 'p2', blockId: 'x', occurrence: 0 }, { focus: false }));
    render(<FindBar editor={editor} editable pageId="p2" />);
    await wait(80);
    expect(isKeepingInView(editor.prosemirrorView!.dom)).toBe(true);
    act(() => roots[roots.length - 1].unmount());
    roots.pop();
    expect(isKeepingInView(editor.prosemirrorView!.dom)).toBe(false);
    expect(disconnect).toHaveBeenCalled();
    expect(removed.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['wheel', 'pointerdown', 'touchstart', 'drop']));
  });
});

describe('Ctrl/⌘+F en la página', () => {
  it('abre la barra de la app; con el foco en la barra, pasa al navegador', async () => {
    const { host } = await openPage();
    const first = key(host.querySelector('.bn-editor')!, { key: 'f', ctrlKey: true });
    expect(first.defaultPrevented).toBe(true);
    const input = host.querySelector<HTMLInputElement>('.find-bar .find-input')!;
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    // Quien puede editar ve la flecha de reemplazar.
    expect(host.querySelector('.find-toggle')).not.toBeNull();
    // La segunda vez, con el foco en la barra: la del navegador.
    const second = key(input, { key: 'f', ctrlKey: true });
    expect(second.defaultPrevented).toBe(false);
    // En el título, también la del navegador.
    const title = key(host.querySelector('.page-title')!, { key: 'f', ctrlKey: true });
    expect(title.defaultPrevented).toBe(false);
    key(input, { key: 'Escape' });
    expect(host.querySelector('.find-bar')).toBeNull();
  });

  it('quien solo ve la página busca, pero no tiene la flecha de reemplazar', async () => {
    const { host } = await openPage((device) => {
      const snapshot = { member: { role: 'member', removed_at: null }, grants: [{ id: 'g', project_id: device.tree.workspaceId, page_id: null, level: 'view' }], fetchedAt: Date.now() };
      const access = { get: () => snapshot, subscribe: () => () => undefined, getRevision: () => 1, removed: false, userId: 'viewer' };
      return pageServices(device, { user: { id: 'viewer', email: 'v@test' }, access } as never);
    });
    expect(host.querySelector('.bn-editor')?.getAttribute('contenteditable')).toBe('false');
    expect(key(host.querySelector('.bn-editor')!, { key: 'f', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(host.querySelector('.find-bar')).not.toBeNull();
    expect(host.querySelector('.find-toggle')).toBeNull();
  });

  it('con la página a medio bajar (solo lectura), sin la flecha de reemplazar', async () => {
    const { host } = await openPage((device) => {
      device.engine.prefetchPage = async () => false;
      device.engine.isMissingContent = async () => true;
      return pageServices(device);
    });
    expect(host.querySelector('.editor-missing')).not.toBeNull();
    key(host.querySelector('.bn-editor')!, { key: 'f', ctrlKey: true });
    expect(host.querySelector('.find-bar')).not.toBeNull();
    expect(host.querySelector('.find-toggle')).toBeNull();
  });
});
