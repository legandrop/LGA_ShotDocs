// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { EditorView } from '@tiptap/pm/view';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { navigate, pagePath } from '../router';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { undoTimelineFor } from './undoTimeline';
import { Shell } from './Workspace';

// Deshacer en el orden en que editaste (P.26, entrega 1) con la app de verdad en jsdom: el árbol, la base local, el
// editor real y los avisos. ⌘Z en otra página te lleva y lo deshace a la vista, con *Back*; manteniendo apretado no
// cruza; con el foco en el árbol también; en el título no (es del campo).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.setConfig({ testTimeout: 60_000 });

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
  const empty = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) });
  Range.prototype.getClientRects ??= (() => []) as never;
  Range.prototype.getBoundingClientRect ??= empty as never;
  Element.prototype.scrollIntoView ??= (() => undefined) as never;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

const roots: Root[] = [];
const devices: Device[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  await new Promise((r) => setTimeout(r, 30));
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  document.body.innerHTML = '';
  history.replaceState(null, '', '/');
});

const wait = (ms = 30) => act(async () => new Promise((r) => setTimeout(r, ms)));

async function until(check: () => unknown, what: string, tries = 250): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await check()) return;
    await wait(40);
  }
  throw new Error(`no llegó: ${what}`);
}

function key(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
}

function services(device: Device): Services {
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
  } as unknown as Services;
}

/** Una página con un párrafo con `text`. */
async function page(d: Device, title: string, id: string, text: string): Promise<string> {
  const pageId = await d.tree.create(null, title);
  const doc = await d.docs.open(pageId);
  const fragment = doc.getXmlFragment(CONTENT_FRAGMENT);
  doc.transact(() => {
    const group = new Y.XmlElement('blockGroup');
    fragment.insert(0, [group]);
    const container = new Y.XmlElement('blockContainer');
    container.setAttribute('id', id);
    const p = new Y.XmlElement('paragraph');
    const t = new Y.XmlText();
    p.insert(0, [t]);
    container.insert(0, [p]);
    group.insert(0, [container]);
    t.insert(0, text);
  });
  d.docs.close(pageId);
  await d.docs.flush();
  return pageId;
}

async function app() {
  const server = new FakeServer();
  const d = await makeDevice(server);
  devices.push(d);
  const a = await page(d, 'Shot 3', 'a1', 'plano');
  const b = await page(d, 'Shot 12', 'b1', 'toma');
  const c = await page(d, 'Shot 20', 'c1', 'nada');
  await d.engine.syncNow();
  history.replaceState(null, '', pagePath(a));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const svc = services(d);
  act(() =>
    root.render(
      <ServicesContext.Provider value={svc}>
        <Shell />
      </ServicesContext.Provider>,
    ),
  );
  await until(() => editorView(), 'el editor');
  return { host, d, a, b, c, svc };
}

const editorView = (): EditorView | null =>
  (document.querySelector('.bn-editor') as (HTMLElement & { editor?: { view?: EditorView } }) | null)?.editor?.view ?? null;

const text = () => editorView()?.state.doc.textContent ?? null;

/** Escribe al final del primer renglón y corta el paso. */
function typeText(s: string) {
  const v = editorView()!;
  let end = -1;
  v.state.doc.descendants((n, p) => {
    if (end >= 0) return false;
    if (n.isTextblock) {
      end = p + 1 + n.content.size;
      return false;
    }
    return true;
  });
  act(() => v.dispatch(v.state.tr.insertText(s, end)));
}

async function go(pageId: string, expected: string) {
  act(() => navigate(pagePath(pageId)));
  await until(() => editorView() && text()!.startsWith(expected), `la página ${expected}`);
  await wait(60);
}

const notice = () => document.querySelector('.notice, [role="status"]')?.textContent ?? '';

describe('⌘Z en el orden en que editaste, con la app', () => {
  it('va a la otra página, lo deshace a la vista y avisa con Back; ⌘⇧Z lo vuelve', async () => {
    const { a, b, c, svc } = await app();
    typeText(' general');
    await wait(600);
    await go(b, 'toma');
    typeText(' dos');
    await wait(600);
    await go(c, 'nada');
    // Desde C (sin escribir): ⌘Z va a B y saca " dos".
    key(editorView()!.dom, { key: 'z', ctrlKey: true });
    await until(() => location.pathname === pagePath(b) && text() === 'toma', 'deshecho en B');
    await until(() => notice().includes('Undone in “Shot 12”'), 'el aviso');
    const back = [...document.querySelectorAll('button')].find((el) => el.textContent === 'Back');
    expect(back).toBeTruthy();
    // ⌘Z otra vez: a A.
    key(editorView()!.dom, { key: 'z', ctrlKey: true });
    await until(() => location.pathname === pagePath(a) && text() === 'plano', 'deshecho en A');
    // ⌘⇧Z dos veces: A y después B.
    key(editorView()!.dom, { key: 'z', ctrlKey: true, shiftKey: true });
    await until(() => text() === 'plano general', 'rehecho en A');
    key(editorView()!.dom, { key: 'Z', ctrlKey: true, shiftKey: true });
    await until(() => location.pathname === pagePath(b) && text() === 'toma dos', 'rehecho en B');
    await until(() => notice().includes('Redone in “Shot 12”'), 'el aviso de rehacer');
    expect(undoTimelineFor(svc).retains(a)).toBe(true);
  });

  it('Back vuelve a la página donde estabas', async () => {
    const { a, b } = await app();
    typeText(' general');
    await wait(600);
    await go(b, 'toma');
    key(editorView()!.dom, { key: 'z', ctrlKey: true });
    await until(() => location.pathname === pagePath(a) && text() === 'plano', 'deshecho en A');
    const back = await (async () => {
      await until(() => [...document.querySelectorAll('button')].some((el) => el.textContent === 'Back'), 'Back');
      return [...document.querySelectorAll('button')].find((el) => el.textContent === 'Back')!;
    })();
    act(() => back.click());
    await until(() => location.pathname === pagePath(b) && editorView() && text() === 'toma', 'de vuelta en B');
  });

  it('manteniendo apretado no cruza de página', async () => {
    const { a, b } = await app();
    typeText(' general');
    await wait(600);
    await go(b, 'toma');
    const e = key(editorView()!.dom, { key: 'z', ctrlKey: true, repeat: true });
    expect(e.defaultPrevented).toBe(true);
    await wait(200);
    expect(location.pathname).toBe(pagePath(b));
    void a;
  });

  it('con el foco en el árbol también; en el título no (es del campo)', async () => {
    const { a, b } = await app();
    typeText(' general');
    await wait(600);
    await go(b, 'toma');
    const title = document.querySelector<HTMLTextAreaElement>('textarea.page-title')!;
    const inTitle = key(title, { key: 'z', ctrlKey: true });
    expect(inTitle.defaultPrevented).toBe(false);
    await wait(200);
    expect(location.pathname).toBe(pagePath(b));
    const treeButton = document.querySelector<HTMLElement>('.sidebar button, .sidebar [role="treeitem"]')!;
    expect(treeButton).toBeTruthy();
    key(treeButton, { key: 'z', ctrlKey: true });
    await until(() => location.pathname === pagePath(a) && text() === 'plano', 'deshecho en A desde el árbol');
  });

  it('sin una página abierta (la papelera) ⌘Z no es de la línea de tiempo', async () => {
    const { a } = await app();
    typeText(' general');
    await wait(600);
    act(() => navigate('/trash'));
    await wait(200);
    const e = key(document.body, { key: 'z', ctrlKey: true });
    expect(e.defaultPrevented).toBe(false);
    await wait(200);
    expect(location.pathname).toBe('/trash');
    void a;
  });

  it('fuera de la Mac, la tecla de Windows con Z no deshace (solo Ctrl)', async () => {
    const { b } = await app();
    typeText(' general');
    await wait(600);
    await go(b, 'toma');
    const e = key(editorView()!.dom, { key: 'z', metaKey: true });
    // En esta prueba la plataforma no es Mac: ⌘ no es el modificador.
    expect(e.defaultPrevented).toBe(false);
  });
});
