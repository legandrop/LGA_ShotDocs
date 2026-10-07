// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { EditorView } from '@tiptap/pm/view';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { prefs } from '../prefs';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { mountEditor, typeAt, unmountAll } from '../ui/collabHarness';
import { IS_MAC } from '../ui/shortcuts';
import { isEmptyPage } from './apply';
import { blockedReason } from './TemplateHost';
import { BUILTIN_PREPRO, BUILTIN_SHOT, builtinBlocks } from './builtin';
// El editor de la página se carga aparte la primera vez que se muestra. Acá se arma antes de las pruebas: si no, la
// primera que monta una página pagaba ese armado (cientos de módulos) dentro de su plazo, y con la máquina cargada no
// le alcanzaba (y una prueba que se corta por tiempo deja a las que siguen en el archivo sin poder dibujar).
import '../ui/PageEditor';

// La tira *Start from a template*, la ventana *Templates* y *Apply template…* en la página de verdad (PageView con el
// editor, sobre el servidor en memoria): Docs/Doc_Plantillas.md, 4.1 y entrega 1.

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
const devices: Device[] = [];
afterEach(async () => {
  unmountAll();
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  document.body.innerHTML = '';
  act(() => prefs.set({ language: 'en' }));
});

const wait = (ms = 30) => act(async () => new Promise((r) => setTimeout(r, ms)));

function services(d: Device): Services {
  const config = { url: 'https://example.test', publishableKey: 'sb_publishable_test', name: 'Wanka', localKey: WANKA_LOCAL_KEY, storage: legacyStorageNames(WANKA_LOCAL_KEY) };
  const client = { auth: { signOut: vi.fn() } } as never;
  return {
    workspace: { config, client },
    client,
    user: { id: d.remote.userId, email: `${d.remote.userId}@test` },
    db: d.db,
    tree: d.tree,
    docs: d.docs,
    files: d.files,
    media: d.media,
    engine: d.engine,
    access: d.access,
    remote: d.remote as unknown as SupabaseRemote,
    dbName: 'test',
    mediaDb: d.mediaDb,
    comments: d.comments,
    commentsDb: d.commentsDb,
    sizes: d.sizes,
    offline: d.offline,
    shutdown: async () => undefined,
  };
}

async function setup() {
  const server = new FakeServer();
  const device = await makeDevice(server);
  devices.push(device);
  await device.engine.syncNow();
  return { server, device };
}

/** Monta la página abierta (la del árbol y su editor) y espera el editor. */
async function open(device: Device, pageId: string) {
  const { PageView } = await import('../ui/PageView');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <ServicesContext.Provider value={services(device)}>
        <main className="main">
          <PageView id={pageId} />
        </main>
      </ServicesContext.Provider>,
    ),
  );
  for (let i = 0; i < 100 && !host.querySelector('.bn-editor'); i++) await wait(50);
  await wait(100);
  expect(host.querySelector('.bn-editor')).not.toBeNull();
  return host;
}

/** El editor de la página abierta (Tiptap lo deja en su elemento). */
function pageView(host: HTMLElement): EditorView {
  const dom = host.querySelector('.ProseMirror') as (HTMLElement & { editor?: { view: EditorView } }) | null;
  expect(dom?.editor).toBeDefined();
  return dom!.editor!.view;
}

/** Fila y celda de la tabla donde está el cursor (null si no está en una tabla). */
function cellOfCursor(view: EditorView): { row: number; cell: number } | null {
  const $from = view.state.selection.$from;
  if ($from.parent.type.name !== 'tableParagraph') return null;
  for (let d = $from.depth; d > 1; d--) {
    const name = $from.node(d).type.name;
    if (name === 'tableCell' || name === 'tableHeader') return { row: $from.index(d - 2), cell: $from.index(d - 1) };
  }
  return null;
}

/** Una tecla en el elemento. */
function key(el: Element, k: string, init: KeyboardEventInit = {}) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
  });
}
/** Ctrl en Windows y Linux, ⌘ en la Mac. */
const mod = (init: KeyboardEventInit = {}): KeyboardEventInit => (IS_MAC ? { metaKey: true, ...init } : { ctrlKey: true, ...init });

/** Escribe en la página con otro editor sobre el mismo documento (como otra pestaña u otro dispositivo). */
async function writeElsewhere(device: Device, pageId: string, text: string) {
  const doc = await device.docs.open(pageId);
  const other = mountEditor(doc, 'otra');
  typeAt(other, 'initialBlockId', 'start', text);
  device.docs.close(pageId);
}

const stripButtons = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>('.template-strip button')].map((b) => b.textContent);
const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());

async function docOf(device: Device, pageId: string) {
  const doc = await device.docs.open(pageId);
  device.docs.close(pageId);
  return doc;
}

describe('la tira de la página vacía', () => {
  it('aparece en la página recién creada con "+", y elegir una la llena, anota la plantilla y lleva el foco al título', async () => {
    const { device } = await setup();
    const page = await device.tree.create(null, '');
    const host = await open(device, page);
    expect(stripButtons(host)).toEqual(['Pre-production Notes', 'On-Set Report', 'Shot Breakdown', 'More…']);
    expect(host.querySelector('.template-strip')?.getAttribute('aria-label')).toBe('Start from a template');

    click(host.querySelector('.template-strip [data-template="prepro"]'));
    await wait(100);
    const doc = await docOf(device, page);
    expect(isEmptyPage(doc)).toBe(false);
    expect(host.querySelectorAll('.bn-block-outer').length).toBeGreaterThanOrEqual(builtinBlocks('prepro', 'en').length);
    expect(host.querySelector('.template-strip')).toBeNull();
    expect(device.tree.get(page)?.template_id).toBe(BUILTIN_PREPRO);
    expect(device.tree.isFresh(page)).toBe(false);
    expect(document.activeElement?.classList.contains('page-title')).toBe(true);
  });

  it('escribir en la página la saca y deja de ofrecerla', async () => {
    const { device } = await setup();
    const page = await device.tree.create(null, '');
    const host = await open(device, page);
    expect(host.querySelector('.template-strip')).not.toBeNull();
    // Lo que escribe la persona en el renglón vacío (acá, con otro editor sobre el mismo documento, como otra pestaña).
    const doc = await device.docs.open(page);
    const other = mountEditor(doc, 'otra');
    act(() => typeAt(other, 'initialBlockId', 'start', 'Hola'));
    device.docs.close(page);
    await wait(100);
    expect(host.querySelector('.template-strip')).toBeNull();
    expect(device.tree.isFresh(page)).toBe(false);
  });

  it('no aparece en una página con título creada por otro camino, ni en una con subpáginas', async () => {
    const { device } = await setup();
    const titled = await device.tree.create(null, 'Escena 12');
    let host = await open(device, titled);
    expect(host.querySelector('.template-strip')).toBeNull();
    act(() => roots.pop()!.unmount());

    const folder = await device.tree.create(null, '');
    await device.tree.create(folder, 'Plano 1');
    host = await open(device, folder);
    expect(host.querySelector('.template-strip')).toBeNull();
  });

  it('Enter en el título lleva el cursor al primer dato de la ficha (no al renglón vacío del pie)', async () => {
    const { device } = await setup();
    const page = await device.tree.create(null, '');
    const host = await open(device, page);
    click(host.querySelector('.template-strip [data-template="prepro"]'));
    await wait(100);
    const title = host.querySelector('.page-title')!;
    expect(document.activeElement).toBe(title);
    key(title, 'Enter');
    await wait(50);
    expect(cellOfCursor(pageView(host))).toEqual({ row: 0, cell: 1 });
  });

  it('Ctrl/⌘+Z en el título recién elegida la plantilla la saca entera; Ctrl/⌘+Shift+Z la devuelve', async () => {
    const { device } = await setup();
    const page = await device.tree.create(null, '');
    const host = await open(device, page);
    click(host.querySelector('.template-strip [data-template="shot"]'));
    await wait(100);
    const doc = await device.docs.open(page);
    const title = host.querySelector<HTMLTextAreaElement>('.page-title')!;
    expect(document.activeElement).toBe(title);
    expect(isEmptyPage(doc)).toBe(false);

    key(title, 'z', mod());
    await wait(50);
    expect(isEmptyPage(doc)).toBe(true);
    expect(document.activeElement).toBe(title);
    key(title, 'z', mod({ shiftKey: true }));
    await wait(50);
    expect(isEmptyPage(doc)).toBe(false);

    // Rehacer deja el punto de escritura otra vez en el primer dato (no donde lo guardó el deshacer).
    expect(cellOfCursor(pageView(host))).toEqual({ row: 0, cell: 1 });

    // Después de salir del título, Ctrl/⌘+Z ahí vuelve a ser del título y no toca la página (undoGuard.ts).
    act(() => title.blur());
    act(() => title.focus());
    key(title, 'z', mod());
    await wait(50);
    expect(isEmptyPage(doc)).toBe(false);
    device.docs.close(page);
  });

  it('deshacer y rehacer desde el título, dos vueltas (con Ctrl/⌘+Shift+Z y con Ctrl/⌘+Y): Enter y escribir caen en el primer dato', async () => {
    for (const kind of ['shot', 'prepro'] as const) {
      const { device } = await setup();
      const page = await device.tree.create(null, '');
      const host = await open(device, page);
      click(host.querySelector(`.template-strip [data-template="${kind}"]`));
      await wait(100);
      const doc = await device.docs.open(page);
      const title = host.querySelector<HTMLTextAreaElement>('.page-title')!;
      for (const redo of [mod({ shiftKey: true, key: 'z' }), mod({ key: 'y' })]) {
        key(title, 'z', mod());
        await wait(50);
        expect(isEmptyPage(doc), kind).toBe(true);
        key(title, String(redo.key), redo);
        await wait(50);
        expect(isEmptyPage(doc), kind).toBe(false);
      }
      expect(document.activeElement).toBe(title);
      key(title, 'Enter');
      await wait(50);
      const view = pageView(host);
      expect(cellOfCursor(view), kind).toEqual({ row: 0, cell: 1 });
      // Lo escrito va al valor del primer dato, nunca al rótulo de la fila.
      act(() => view.dispatch(view.state.tr.insertText('XYZ')));
      await wait(50);
      const firstRow = view.state.doc.textBetween(0, view.state.doc.content.size, '|').split('|');
      expect(firstRow.some((t) => t.startsWith('XYZ') && t.length > 3), kind).toBe(false);
      expect(firstRow, kind).toContain('XYZ');
      device.docs.close(page);
      unmountAll();
      for (const r of roots.splice(0)) act(() => r.unmount());
    }
  });

  it('si llega texto justo al elegir, no agrega la plantilla (se vuelve a mirar si está vacía al aplicar)', async () => {
    const { device } = await setup();
    const page = await device.tree.create(null, '');
    const host = await open(device, page);
    const chip = host.querySelector('.template-strip [data-template="onset"]') as HTMLElement;
    const doc = await device.docs.open(page);
    const other = mountEditor(doc, 'otra');
    // El texto y el clic en la misma pasada: la tira todavía está a la vista y el botón todavía llama a aplicar.
    act(() => {
      typeAt(other, 'initialBlockId', 'start', 'Hola');
      chip.click();
    });
    await wait(100);
    expect(device.tree.get(page)?.template_id ?? null).toBeNull();
    expect(host.textContent).not.toContain('Camera package');
    expect(host.textContent).toContain('Hola');
    device.docs.close(page);
  });

  it('en castellano, con las de fábrica en castellano', async () => {
    const { device } = await setup();
    act(() => prefs.set({ language: 'es' }));
    const page = await device.tree.create(null, '');
    const host = await open(device, page);
    expect(stripButtons(host)).toEqual(['Notas de preproducción', 'Reporte de rodaje', 'Desglose de plano', 'Más…']);
    click(host.querySelector('.template-strip [data-template="shot"]'));
    await wait(100);
    expect(host.textContent).toContain('Cuadro de referencia');
    expect(device.tree.get(page)?.template_id).toBe(BUILTIN_SHOT);
  });
});

describe('la ventana Templates y Apply template…', () => {
  it('More… abre la ventana con las tres, su descripción y la vista previa; Use la agrega', async () => {
    const { device } = await setup();
    const page = await device.tree.create(null, '');
    const host = await open(device, page);
    click([...host.querySelectorAll('.template-strip button')].find((b) => b.textContent === 'More…'));
    const dialog = document.querySelector('.templates-dialog');
    expect(dialog).not.toBeNull();
    expect([...dialog!.querySelectorAll('li strong')].map((s) => s.textContent)).toEqual(['Pre-production Notes', 'On-Set Report', 'Shot Breakdown']);
    expect(dialog!.querySelectorAll('li .muted').length).toBe(3);
    click(dialog!.querySelector('[data-template="prepro"] button.primary'));
    await wait(100);
    expect(document.querySelector('.templates-dialog')).toBeNull();
    expect(device.tree.get(page)?.template_id).toBe(BUILTIN_PREPRO);
    expect(host.textContent).toContain('Elements to shoot');
  });

  it('con la ventana abierta llega texto de otro lado: los Use se apagan, dicen por qué y no agregan nada', async () => {
    const { device } = await setup();
    const page = await device.tree.create(null, '');
    const host = await open(device, page);
    click([...host.querySelectorAll('.template-strip button')].find((b) => b.textContent === 'More…'));
    const use = () => document.querySelector<HTMLButtonElement>('.templates-dialog [data-template="onset"] button.primary')!;
    expect(use().getAttribute('aria-disabled')).toBeNull();
    await act(async () => writeElsewhere(device, page, 'Escrito en el iPhone'));
    await wait(100);
    expect(use().getAttribute('aria-disabled')).toBe('true');
    expect(use().dataset.tip).toBe('Only on an empty page');
    click(use());
    await wait(100);
    expect(device.tree.get(page)?.template_id ?? null).toBeNull();
    expect(host.textContent).toContain('Escrito en el iPhone');
    expect(host.textContent).not.toContain('Camera package');
  });

  it('Preview abre la vista previa sin tocar la página', async () => {
    const { device } = await setup();
    const page = await device.tree.create(null, '');
    const host = await open(device, page);
    click([...host.querySelectorAll('.template-strip button')].find((b) => b.textContent === 'More…'));
    click(document.querySelector('.templates-dialog [data-template="onset"] button.link'));
    expect(location.pathname + location.search).toBe('/practice?template=on-set');
    expect(isEmptyPage(await docOf(device, page))).toBe(true);
    history.replaceState(null, '', '/');
  });

  it('Apply template… del menú: en la página vacía abre la ventana; con contenido queda apagado y dice por qué', async () => {
    const { device } = await setup();
    const page = await device.tree.create(null, 'Escena 3');
    const host = await open(device, page);
    const { PageMenu } = await import('../ui/menus');
    const menuHost = document.createElement('div');
    document.body.append(menuHost);
    const root = createRoot(menuHost);
    roots.push(root);
    const render = () =>
      act(() =>
        root.render(
          <ServicesContext.Provider value={services(device)}>
            <PageMenu
              pageId={page}
              position={{ top: 0, left: 0 }}
              anchor={null}
              onClose={() => undefined}
              onNewChild={() => undefined}
              onRename={() => undefined}
              onMove={() => undefined}
              onFormat={() => undefined}
              onTrash={() => undefined}
            />
          </ServicesContext.Provider>,
        ),
      );
    render();
    const item = () => [...menuHost.querySelectorAll('button')].find((b) => b.textContent?.includes('Apply template…'));
    expect(item()).toBeDefined();
    expect(item()!.getAttribute('aria-disabled')).toBeNull();
    click(item());
    expect(document.querySelector('.templates-dialog')).not.toBeNull();
    click(document.querySelector('.templates-dialog [data-template="shot"] button.primary'));
    await wait(100);
    expect(device.tree.get(page)?.template_id).toBe(BUILTIN_SHOT);
    // Una página con título no ofrece la tira, pero el menú sí: el título queda como estaba.
    expect(device.tree.get(page)?.title).toBe('Escena 3');
    expect(host.textContent).toContain('Reference frame');
    // Con título, el foco no va al título: va a la página, con el cursor en el primer dato de la ficha.
    expect(host.querySelector('.ProseMirror')!.contains(document.activeElement)).toBe(true);
    expect(cellOfCursor(pageView(host))).toEqual({ row: 0, cell: 1 });

    render();
    expect(item()!.getAttribute('aria-disabled')).toBe('true');
    expect(item()!.dataset.tip).toBe('Only on an empty page');
    click(item());
    expect(document.querySelector('.templates-dialog')).toBeNull();
  });

  it('Apply template… sobre una página que no está abierta la abre y muestra la ventana', async () => {
    const { device } = await setup();
    const page = await device.tree.create(null, 'Escena 4');
    const { requestTemplates } = await import('./templatesUi');
    requestTemplates(page);
    expect(location.pathname).toBe(`/p/${page}`);
    await open(device, page);
    expect(document.querySelector('.templates-dialog')).not.toBeNull();
    history.replaceState(null, '', '/');
  });

  it('Apply template… sobre una página no abierta y con texto: la abre y avisa por qué no, sin la ventana', async () => {
    const { device } = await setup();
    const page = await device.tree.create(null, 'Escena 5');
    await writeElsewhere(device, page, 'Ya escrito');
    const notices: unknown[] = [];
    const listen = (e: Event) => notices.push((e as CustomEvent).detail);
    window.addEventListener('shotdocs:notice', listen);
    try {
      const { requestTemplates } = await import('./templatesUi');
      requestTemplates(page);
      await open(device, page);
      await wait(50);
      expect(document.querySelector('.templates-dialog')).toBeNull();
      expect(notices).toContain('Only on an empty page');
    } finally {
      window.removeEventListener('shotdocs:notice', listen);
      history.replaceState(null, '', '/');
    }
  });

  it('por qué se apagan los Use: cargando, sin permiso, con contenido', () => {
    const tr = (k: string) => k;
    const base = { complete: true, editor: true, editable: true, empty: true };
    expect(blockedReason(base, tr)).toBeNull();
    expect(blockedReason({ ...base, complete: false, editable: false }, tr)).toBe('templates.loading');
    expect(blockedReason({ ...base, editor: false }, tr)).toBe('templates.loading');
    expect(blockedReason({ ...base, editable: false }, tr)).toBe('templates.readOnly');
    expect(blockedReason({ ...base, editable: false, editor: false }, tr)).toBe('templates.readOnly');
    expect(blockedReason({ ...base, empty: false }, tr)).toBe('pageMenu.applyTemplateEmpty');
  });
});
