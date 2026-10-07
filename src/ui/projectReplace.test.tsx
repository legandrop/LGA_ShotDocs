// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { settled } from '../test/settle';
import * as Y from 'yjs';
import { navigate, pagePath } from '../router';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { saveCollapse } from './collapseStore';
import { closeFindBar, updateFindUi } from './findUi';
import { replaceBlocksLeaving, replaceSession, showChanged } from './replaceUi';
import { Shell } from './Workspace';
// El editor de la página se carga aparte la primera vez que se muestra. Acá se arma antes de las pruebas: si no, la
// primera que monta una página pagaba ese armado (cientos de módulos) dentro de su plazo, y con la máquina cargada no
// le alcanzaba (y una prueba que se corta por tiempo deja a las que siguen en el archivo sin poder dibujar).
import './PageEditor';

// Reemplazar en todo el proyecto, con la app de verdad (el árbol, la base local, el editor y el panel de Ctrl/⌘+K
// en jsdom): la flecha solo para quien puede, la vista previa, la confirmación, reemplazar una y dejar afuera, el
// aviso con *Undo*, y la página abierta con una sección colapsada que recibe el cambio sin abrirse.

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
  const empty = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) });
  Range.prototype.getClientRects ??= (() => []) as never;
  Range.prototype.getBoundingClientRect ??= empty as never;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

const roots: Root[] = [];
const devices: Device[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
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
  history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

// El rato pedido y, después, a que termine lo que quedó en marcha (src/test/settle.ts).
const wait = (ms = 30) => act(() => settled(ms));

async function until(check: () => unknown, what: string, tries = 250): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await check()) return;
    await wait(40);
  }
  throw new Error(`no llegó: ${what}`);
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

type Block = { id: string; text: string; heading?: number };

async function edit(d: Device, pageId: string, blocks: Block[]): Promise<void> {
  const doc = await d.docs.open(pageId);
  const fragment = doc.getXmlFragment(CONTENT_FRAGMENT);
  const fills: (() => void)[] = [];
  doc.transact(() => {
    if (fragment.length === 0) fragment.insert(0, [new Y.XmlElement('blockGroup')]);
    const group = fragment.get(0) as Y.XmlElement;
    for (const b of blocks) {
      const container = new Y.XmlElement('blockContainer');
      container.setAttribute('id', b.id);
      const p = new Y.XmlElement(b.heading ? 'heading' : 'paragraph');
      if (b.heading) p.setAttribute('level', b.heading as never);
      const t = new Y.XmlText();
      p.insert(0, [t]);
      container.insert(0, [p]);
      group.insert(group.length, [container]);
      fills.push(() => t.insert(0, b.text));
    }
    for (const f of fills) f();
  });
  d.docs.close(pageId);
  await d.docs.flush();
}

async function textOf(d: Device, pageId: string): Promise<string> {
  const { doc } = await d.docs.indexSnapshot(pageId);
  const out = doc.getXmlFragment(CONTENT_FRAGMENT).toString().replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');
  doc.destroy();
  return out;
}

/** La app abierta en la página A (con una sección colapsada), con los permisos del equipo conocidos (o no). */
async function app({ team = true } = {}) {
  const server = new FakeServer();
  if (team) server.enableTeam();
  const d = await makeDevice(server);
  devices.push(d);
  const a = await d.tree.create(null, 'Escena 1');
  await edit(d, a, [
    { id: 'h1', text: 'Planta', heading: 1 },
    { id: 'a1', text: 'la cámara escondida' },
    { id: 'h2', text: 'Afuera', heading: 1 },
    { id: 'a2', text: 'otra cámara a la vista' },
  ]);
  await saveCollapse(d.db, a, new Map([['h1', { c: true, g: null }]]));
  const b = await d.tree.create(null, 'Escena 2');
  await edit(d, b, [
    { id: 'b1', text: 'sin nada' },
    { id: 'b2', text: 'dos cámaras en B y una cámara más' },
  ]);
  await d.engine.syncNow();
  history.replaceState(null, '', pagePath(a));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <ServicesContext.Provider value={services(d)}>
        <Shell />
      </ServicesContext.Provider>,
    ),
  );
  await until(() => host.querySelector('.bn-editor'), 'el editor');
  return { host, d, a, b };
}

const panel = () => document.querySelector<HTMLElement>('.search-panel');
const searchInput = () => panel()!.querySelector<HTMLInputElement>('.search-field input')!;
const toggle = () => panel()!.querySelector<HTMLButtonElement>('.search-replace-toggle');
const replaceInput = () => panel()!.querySelector<HTMLInputElement>('.replace-input')!;
const replaceAllButton = () => panel()!.querySelector<HTMLButtonElement>('.replace-all')!;

async function openReplace(query: string, replacement: string) {
  key(document.body, { key: 'k', ctrlKey: true });
  await until(panel, 'el panel');
  await until(toggle, 'la flecha');
  act(() => toggle()!.click());
  await until(() => panel()!.querySelector('.replace-input'), 'el renglón del reemplazo');
  type(searchInput(), query);
  type(replaceInput(), replacement);
  await until(() => panel()!.querySelectorAll('.replace-match').length > 0, 'la lista');
  await wait(80);
}

/** Las páginas con el editor colapsando (jsdom no sabe `:has()`: se hace de cuenta que sí). */
function stubCss() {
  const realCSS = globalThis.CSS;
  vi.stubGlobal('CSS', {
    escape: (v: string) => realCSS.escape(v),
    supports: (q: string, v?: string) => (q.includes(':has(') ? true : v === undefined ? realCSS.supports(q) : realCSS.supports(q, v)),
  });
}

describe('la flecha', () => {
  it('sin los permisos conocidos no aparece', async () => {
    await app({ team: false });
    key(document.body, { key: 'k', ctrlKey: true });
    await until(panel, 'el panel');
    await wait(100);
    expect(toggle()).toBeNull();
  });
});

describe('reemplazar', () => {
  it('la vista previa, Replace all con confirmación (Cancel elegido), la página abierta lo recibe sin abrir la sección, y Undo', async () => {
    stubCss();
    const { host, d, a, b } = await app();
    await until(() => host.querySelector('.bn-block-content.sd-collapsed-hidden'), 'la sección colapsada');
    await openReplace('camara', 'Camera');
    // La vista previa: lo de antes tachado y lo nuevo al lado.
    const first = panel()!.querySelector('.replace-match')!;
    expect(first.querySelector('del')!.textContent).toBe('cámara');
    expect(first.querySelector('ins')!.textContent).toBe('Camera');
    expect(replaceAllButton().textContent).toBe('Replace all (4)');
    // La escondida en la sección colapsada está marcada en su renglón.
    await until(() => panel()!.querySelector('.replace-hidden-mark'), 'la marca de escondida');
    const marked = [...panel()!.querySelectorAll('.replace-match')].filter((r) => r.querySelector('.replace-hidden-mark'));
    expect(marked.map((r) => r.textContent)).toEqual([expect.stringContaining('escondida · in a collapsed section')]);
    // Enter en el campo de reemplazo no reemplaza nada.
    key(replaceInput(), { key: 'Enter' });
    await wait(60);
    expect(await textOf(d, b)).toContain('cámaras');
    act(() => replaceAllButton().click());
    await until(() => panel()!.querySelector('.replace-confirm'), 'la confirmación');
    const dialog = panel()!.querySelector<HTMLElement>('.replace-confirm')!;
    expect(dialog.querySelector('h2')!.textContent).toBe('Replace 4 matches in 2 pages?');
    expect(dialog.textContent).toContain('1 is in a collapsed section.');
    expect(document.activeElement?.textContent).toBe('Cancel');
    // Esc cierra la confirmación, no el panel.
    key(dialog, { key: 'Escape' });
    expect(panel()!.querySelector('.replace-confirm')).toBeNull();
    expect(panel()).not.toBeNull();
    act(() => replaceAllButton().click());
    await until(() => panel()!.querySelector('.replace-confirm'), 'la confirmación otra vez');
    const confirmButton = [...panel()!.querySelectorAll<HTMLButtonElement>('.replace-confirm button')].find((x) => x.textContent === 'Replace 4')!;
    act(() => confirmButton.click());
    await until(() => document.querySelector('.notice')?.textContent?.includes('4 replacements in 2 pages'), 'el aviso');
    expect(document.querySelector('.notice')!.textContent).toContain('1 was in a collapsed section');
    expect(await textOf(d, b)).toBe('|sin nada|dos Cameras en B y una Camera más|');
    // La página abierta lo muestra, con la sección todavía colapsada.
    await until(() => host.querySelector('.bn-editor')!.textContent!.includes('otra Camera a la vista'), 'el editor al día');
    expect(host.querySelector('.bn-block-content.sd-collapsed-hidden')).not.toBeNull();
    // Undo, en el aviso.
    const undo = [...document.querySelectorAll<HTMLButtonElement>('.notice button')].find((x) => x.textContent === 'Undo')!;
    act(() => undo.click());
    await until(async () => (await textOf(d, b)).includes('cámaras'), 'deshecho');
    // Es lo último que hiciste: como ⌘Z (P.26, entrega 2), con *Redo*.
    await until(() => document.querySelector('.notice')?.textContent?.includes('Undid “camara” → “Camera” in 2 pages'), 'el aviso de deshacer');
    expect(await textOf(d, a)).toBe('|Planta|la cámara escondida|Afuera|otra cámara a la vista|');
    expect(replaceSession(services(d)).engine.isRunning()).toBe(false);
    const redo = [...document.querySelectorAll<HTMLButtonElement>('.notice button')].find((x) => x.textContent === 'Redo')!;
    act(() => redo.click());
    await until(async () => (await textOf(d, b)) === '|sin nada|dos Cameras en B y una Camera más|', 'rehecho');
    await until(() => document.querySelector('.notice')?.textContent?.includes('Redid “camara” → “Camera” in 2 pages'), 'el aviso de rehacer');
    expect(await textOf(d, a)).toBe('|Planta|la Camera escondida|Afuera|otra Camera a la vista|');
  });

  it('DH9: recién reemplazado, Ctrl+Z en el panel deshace el reemplazo y Ctrl+Shift+Z lo rehace; escribir en un campo lo devuelve al campo', async () => {
    const { d, b } = await app();
    await openReplace('camara', 'Camera');
    act(() => replaceAllButton().click());
    await until(() => panel()!.querySelector('.replace-confirm'), 'la confirmación');
    const confirmButton = [...panel()!.querySelectorAll<HTMLButtonElement>('.replace-confirm button')].find((x) => x.textContent === 'Replace 4')!;
    act(() => confirmButton.click());
    await until(() => document.querySelector('.notice')?.textContent?.includes('4 replacements in 2 pages'), 'reemplazado');
    // El foco queda en el campo del reemplazo.
    expect(document.activeElement).toBe(replaceInput());
    const undo = key(replaceInput(), { key: 'z', code: 'KeyZ', ctrlKey: true });
    expect(undo.defaultPrevented).toBe(true);
    await until(async () => (await textOf(d, b)).includes('cámaras'), 'deshecho desde el panel');
    await until(() => document.querySelector('.notice')?.textContent?.includes('Undid “camara” → “Camera” in 2 pages'), 'el aviso');
    // Mantener apretado no hace nada de más.
    key(replaceInput(), { key: 'z', code: 'KeyZ', ctrlKey: true, repeat: true });
    key(replaceInput(), { key: 'z', code: 'KeyZ', ctrlKey: true, shiftKey: true });
    await until(async () => (await textOf(d, b)).includes('Cameras'), 'rehecho desde el panel');
    // Rehacer sigue un paso más después de que el texto cambió (vuelve a guardar su registro): se espera su aviso.
    await until(() => document.querySelector('.notice')?.textContent?.includes('Redid “camara” → “Camera” in 2 pages'), 'el aviso de rehacer');
    // Escribir en el campo: Ctrl+Z vuelve a ser del campo (no toca las páginas).
    type(replaceInput(), 'Camara');
    const again = key(replaceInput(), { key: 'z', code: 'KeyZ', ctrlKey: true });
    expect(again.defaultPrevented).toBe(false);
    await wait(100);
    expect(await textOf(d, b)).toBe('|sin nada|dos Cameras en B y una Camera más|');
  });

  it('DH9: escribir en el campo de buscar también devuelve Ctrl+Z al campo', async () => {
    const { d, b } = await app();
    await openReplace('camara', 'Camera');
    act(() => replaceAllButton().click());
    await until(() => panel()!.querySelector('.replace-confirm'), 'la confirmación');
    const confirmButton = [...panel()!.querySelectorAll<HTMLButtonElement>('.replace-confirm button')].find((x) => x.textContent === 'Replace 4')!;
    act(() => confirmButton.click());
    await until(() => document.querySelector('.notice')?.textContent?.includes('4 replacements in 2 pages'), 'reemplazado');
    type(searchInput(), 'Camera');
    const e = key(searchInput(), { key: 'z', code: 'KeyZ', ctrlKey: true });
    expect(e.defaultPrevented).toBe(false);
    await wait(100);
    expect(await textOf(d, b)).toBe('|sin nada|dos Cameras en B y una Camera más|');
  });

  it('reemplazar una y dejar otra afuera (por sus caracteres)', async () => {
    const { d, b } = await app();
    await openReplace('camara', 'X');
    const rows = () => [...panel()!.querySelectorAll<HTMLElement>('.replace-match')];
    const inB = () => rows().filter((r) => r.textContent!.includes('en B'));
    expect(inB()).toHaveLength(2);
    // Dejar afuera la segunda de B.
    act(() => inB()[1].querySelector<HTMLButtonElement>('button[aria-label="Leave out of this replacement"]')!.click());
    await until(() => inB().length === 1, 'la sacada');
    // Reemplazar solo la primera de B.
    act(() => inB()[0].querySelector<HTMLButtonElement>('.find-text-button')!.click());
    await until(async () => (await textOf(d, b)).includes('dos Xs'), 'la una');
    expect(await textOf(d, b)).toBe('|sin nada|dos Xs en B y una cámara más|');
    // El reemplazo todavía no terminó cuando el texto ya cambió (le queda ordenar su registro): se espera su aviso.
    // Sin eso la prueba cerraba la base con ese final en marcha, y el rechazo aparecía suelto en la prueba siguiente.
    await until(() => document.querySelector('.notice')?.textContent?.includes('1 replacement'), 'el aviso');
  });

  it('borrar: las escondidas quedan afuera salvo con la casilla', async () => {
    const { d, a } = await app();
    await openReplace('camara', '');
    act(() => replaceAllButton().click());
    await until(() => panel()!.querySelector('.replace-confirm'), 'la confirmación');
    const dialog = panel()!.querySelector<HTMLElement>('.replace-confirm')!;
    expect(dialog.querySelector('h2')!.textContent).toBe('Delete 3 matches in 2 pages?');
    const check = dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(check.checked).toBe(false);
    act(() => check.click());
    expect(dialog.querySelector('h2')!.textContent).toBe('Delete 4 matches in 2 pages?');
    act(() => check.click());
    const del = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.textContent === 'Delete 3')!;
    act(() => del.click());
    await until(() => document.querySelector('.notice')?.textContent?.includes('3 replacements'), 'el aviso');
    expect(await textOf(d, a)).toBe('|Planta|la cámara escondida|Afuera|otra  a la vista|');
  });

  it('la lista de los últimos, con Undo, sigue en el panel', async () => {
    const { d, b } = await app();
    await openReplace('camara', 'Z');
    act(() => replaceAllButton().click());
    await until(() => panel()!.querySelector('.replace-confirm'), 'la confirmación');
    const ok = [...panel()!.querySelectorAll<HTMLButtonElement>('.replace-confirm button')].find((x) => x.textContent === 'Replace 4')!;
    act(() => ok.click());
    // Mientras corre no aparece entre los últimos (sus cuentas estarían a medias): se espera a que termine.
    await until(() => document.querySelector('.notice')?.textContent?.includes('4 replacements in 2 pages'), 'el aviso');
    await until(() => panel()!.querySelector('.replace-recent')?.textContent?.includes('4 in 2 pages'), 'los últimos');
    expect(panel()!.querySelector('.replace-recent')!.textContent).toContain('Last: “camara” → “Z”, 4 in 2 pages');
    // Con el mouse, el foco queda en el botón (que se va con el renglón).
    const last = panel()!.querySelector<HTMLButtonElement>('.replace-recent button')!;
    act(() => {
      last.focus();
      last.click();
    });
    await until(async () => (await textOf(d, b)).includes('cámaras'), 'deshecho desde el panel');
    // Deshacer sigue un paso más después de que el texto cambió (saca su registro): se espera su aviso.
    await until(() => document.querySelector('.notice')?.textContent?.includes('Undid “camara” → “Z” in 2 pages'), 'el aviso de deshacer');
    // El foco sigue en el panel (el renglón se fue): Esc lo cierra (P.26, pendiente de la entrega 2).
    await until(() => panel()!.contains(document.activeElement), 'el foco en el panel');
    key(document.activeElement!, { key: 'Escape' });
    expect(panel()).toBeNull();
    act(() => navigate('/'));
  });

  it('Show en el aviso de deshacer, si una página había cambiado: lleva a ese bloque', async () => {
    const { d, a, b } = await app();
    await openReplace('camara', 'Camera');
    act(() => replaceAllButton().click());
    await until(() => panel()!.querySelector('.replace-confirm'), 'la confirmación');
    const ok = [...panel()!.querySelectorAll<HTMLButtonElement>('.replace-confirm button')].find((x) => x.textContent === 'Replace 4')!;
    act(() => ok.click());
    await until(() => document.querySelector('.notice')?.textContent?.includes('4 replacements in 2 pages'), 'el aviso');
    // Otra persona escribe adentro de lo reemplazado en B (la página no está abierta: van las anclas).
    const doc = await d.docs.open(b);
    doc.transact(() => {
      const walk = (n: Y.XmlElement | Y.XmlFragment | Y.XmlText): void => {
        if (n instanceof Y.XmlText) {
          const at = n.toString().indexOf('Cameras');
          if (at >= 0) n.insert(at + 3, 'XX');
        } else n.toArray().forEach((c) => walk(c as never));
      };
      walk(doc.getXmlFragment(CONTENT_FRAGMENT));
    }, 'otra-persona');
    d.docs.close(b);
    await d.docs.flush();
    const undo = [...document.querySelectorAll<HTMLButtonElement>('.notice button')].find((x) => x.textContent === 'Undo')!;
    act(() => undo.click());
    await until(() => document.querySelector('.notice')?.textContent?.includes('had changed'), 'el aviso de deshacer');
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.notice button')].map((x) => x.textContent);
    expect(buttons).toEqual(['Redo', 'Show', 'OK']);
    expect(location.pathname).toBe(pagePath(a));
    act(() => [...document.querySelectorAll<HTMLButtonElement>('.notice button')].find((x) => x.textContent === 'Show')!.click());
    await until(() => location.pathname === pagePath(b), 'la página que cambió');
    // El bloque, a la vista (`showChanged` con sus partes, abajo).
    await until(() => document.querySelector('.editor [data-id="b2"]'), 'el bloque');
    act(() => navigate('/'));
  });
});

describe('mientras corre', () => {
  it('con el panel cerrado se ve el avance con Stop, y cerrar sesión espera', async () => {
    const { d, b } = await app();
    const engine = replaceSession(services(d)).engine;
    const alerts: string[] = [];
    vi.stubGlobal('alert', (m: string) => alerts.push(m));
    let sawBar = false;
    let blocked = false;
    const unsub = engine.subscribe(() => {
      if (engine.getProgress()?.done === 1 && !blocked) {
        blocked = replaceBlocksLeaving();
        sawBar = !!document.querySelector('.replace-progress-bar');
      }
    });
    const { a } = { a: d.tree.roots(d.tree.workspaceId)[0].id };
    await act(async () => {
      await engine.run({ projectId: d.tree.workspaceId, pageIds: [a, b], query: 'camara', replacement: 'Z', options: {} });
    });
    unsub();
    expect(blocked).toBe(true);
    expect(alerts[0]).toContain('still running');
    expect(sawBar).toBe(true);
    // Terminado: ya no frena.
    expect(replaceBlocksLeaving()).toBe(false);
    expect(document.querySelector('.replace-progress-bar')).toBeNull();
  });
});

describe('Show (deshacer un reemplazo con lugares que habían cambiado)', () => {
  it('va al primero, espera a que el bloque esté y, con más de uno, ofrece Next hasta el último', async () => {
    const went: string[] = [];
    const notes: { message: string; next?: () => void }[] = [];
    let ready = 0;
    const revealed: string[] = [];
    const deps = {
      go: (id: string) => void went.push(id),
      // El bloque aparece al tercer intento (la página tarda en abrir).
      reveal: (block: string) => (++ready >= 3 ? (revealed.push(block), true) : false),
      notify: (message: string, action?: { run: () => void }) => void notes.push({ message, next: action?.run }),
      waitMs: 2000,
    };
    showChanged(
      [
        { pageId: 'P1', blockId: 'x' },
        { pageId: 'P1', blockId: 'x' },
        { pageId: 'P2', blockId: 'y' },
      ],
      deps,
    );
    expect(went).toEqual(['P1']);
    // El bloque aparece al tercer intento: se espera a que aparezca, no un rato fijo.
    await until(() => revealed.length > 0, 'el bloque');
    expect(revealed).toEqual(['x']);
    expect(notes.map((n) => n.message)).toEqual(['Changed after the replace, left as it is (1 of 2)']);
    notes[0].next!();
    expect(went).toEqual(['P1', 'P2']);
    await until(() => revealed.length > 1, 'el segundo bloque');
    expect(revealed).toEqual(['x', 'y']);
    expect(notes[1]).toEqual({ message: 'Changed after the replace, left as it is (2 of 2)', next: undefined });
  });
});
