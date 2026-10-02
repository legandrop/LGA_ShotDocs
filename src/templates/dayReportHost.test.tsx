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
import { unmountAll } from '../ui/collabHarness';
import { IS_MAC } from '../ui/shortcuts';
import { BUILTIN_ONSET } from './builtinIds';
import { dayReportsMark, localDate } from './dayReport';
import { createDayReport, planDayReport } from './dayReportCreate';

// El reporte del día en la página de verdad (PageView con el editor, sobre el servidor en memoria): la tira con *On-Set
// Report* adentro de una carpeta, el botón *New day report* y su globito, "ya existe", el atajo con AltGr y `code`, los
// permisos y el menú de la página (Docs/Doc_Plantillas.md, sección 6 y entrega 2).

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
  history.replaceState(null, '', '/');
  act(() => prefs.set({ language: 'en' }));
});

const wait = (ms = 30) => act(async () => new Promise((r) => setTimeout(r, ms)));

function services(d: Device, userId = d.remote.userId): Services {
  const config = { url: 'https://example.test', publishableKey: 'sb_publishable_test', name: 'Wanka', localKey: WANKA_LOCAL_KEY, storage: legacyStorageNames(WANKA_LOCAL_KEY) };
  const client = { auth: { signOut: vi.fn() } } as never;
  return {
    workspace: { config, client },
    client,
    user: { id: userId, email: `${userId}@test` },
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

/** Monta la página abierta y espera su editor. */
async function open(device: Device, pageId: string, svc = services(device)) {
  const { PageView } = await import('../ui/PageView');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <ServicesContext.Provider value={svc}>
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

function pageView(host: HTMLElement): EditorView {
  const dom = host.querySelector('.ProseMirror') as (HTMLElement & { editor?: { view: EditorView } }) | null;
  return dom!.editor!.view;
}

/** El texto del bloque donde está el cursor y el del título de sección de arriba. */
function cursorBlock(view: EditorView): { type: string; text: string; after: string } {
  const $from = view.state.selection.$from;
  let after = '';
  let pos = -1;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'blockContainer') {
      pos = $from.before(d);
      break;
    }
  }
  const before = view.state.doc.resolve(pos);
  const index = before.index();
  if (index > 0) after = before.parent.child(index - 1).textContent;
  return { type: $from.parent.type.name, text: $from.parent.textContent, after };
}

const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
const popover = () => document.querySelector<HTMLFormElement>('.day-report-popover');
const inputs = () => [...popover()!.querySelectorAll('input')] as HTMLInputElement[];

function setInput(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Espera a que el globito haya leído la carpeta (el botón principal se habilita). */
async function popoverReady() {
  for (let i = 0; i < 60 && (!popover() || popover()!.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled); i++) await wait(30);
  expect(popover()!.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
}

function shortcut(init: KeyboardEventInit & { altGr?: boolean } = {}) {
  const { altGr, ...rest } = init;
  const e = new KeyboardEvent('keydown', {
    key: 'N',
    code: 'KeyN',
    altKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
    ...(IS_MAC ? { metaKey: true } : { ctrlKey: true }),
    ...rest,
  });
  if (altGr) Object.defineProperty(e, 'getModifierState', { value: (k: string) => k === 'AltGraph' });
  act(() => {
    window.dispatchEvent(e);
  });
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + days, 12));
}

describe('el primero desde la tira', () => {
  it('On-Set Report en una página nueva adentro de una carpeta: Day 01 con la fecha, la carpeta marcada y el cursor en Summary', async () => {
    const { device } = await setup();
    const folder = await device.tree.create(null, 'Reportes');
    const page = await device.tree.create(folder, '');
    const host = await open(device, page);
    expect(host.querySelector('.day-report-button')).toBeNull();
    click(host.querySelector('.template-strip [data-template="onset"]'));
    for (let i = 0; i < 40 && !device.tree.get(page)?.title; i++) await wait(30);
    await wait(50);
    const today = localDate();
    expect(device.tree.get(page)?.title).toBe(`${today} | Day 01`);
    expect(device.tree.get(page)?.template_id).toBe(BUILTIN_ONSET);
    expect(dayReportsMark(device.tree.get(folder))).toBe('on');
    // La ficha trae la fecha y el día.
    expect(host.textContent).toContain(`${today} · `);
    // El cursor, con el foco, en el párrafo de Summary.
    expect(host.querySelector('.ProseMirror')!.contains(document.activeElement)).toBe(true);
    expect(cursorBlock(pageView(host))).toEqual({ type: 'paragraph', text: '', after: 'Summary' });
    // Ya es un reporte: tiene el botón.
    expect(host.querySelector('.day-report-button')).not.toBeNull();
  });

  it('en la raíz del proyecto queda como una plantilla común y avisa dónde ponerla', async () => {
    const { device } = await setup();
    const page = await device.tree.create(null, '');
    const notices: unknown[] = [];
    const listen = (e: Event) => notices.push((e as CustomEvent).detail);
    window.addEventListener('shotdocs:notice', listen);
    try {
      const host = await open(device, page);
      click(host.querySelector('.template-strip [data-template="onset"]'));
      await wait(100);
      expect(device.tree.get(page)?.title).toBe('');
      expect(device.tree.get(page)?.template_id).toBe(BUILTIN_ONSET);
      expect(notices).toContain('Put day reports inside a folder to get New day report');
      expect(host.querySelector('.day-report-button')).toBeNull();
    } finally {
      window.removeEventListener('shotdocs:notice', listen);
    }
  });
});

describe('el botón New day report y su globito', () => {
  async function withReport(team = false) {
    const server = new FakeServer();
    if (team) server.enableTeam();
    const device = await makeDevice(server);
    devices.push(device);
    await device.engine.syncNow();
    const folder = await device.tree.create(null, 'Reportes');
    const deps = { tree: device.tree, docs: device.docs, engine: device.engine };
    const plan = await planDayReport(deps, { parentId: folder, projectId: device.tree.workspaceId });
    const first = await createDayReport(deps, plan, { ...plan.suggestion, location: 'Estancia La Paz' }, 'en', { canMark: true });
    return { server, device, folder, first };
  }

  it('propone hoy, el día siguiente y la locación de ayer; Enter crea el reporte y lo abre', async () => {
    const { device, folder, first } = await withReport();
    const host = await open(device, first);
    const button = host.querySelector<HTMLButtonElement>('.day-report-button')!;
    expect(button.textContent).toBe('New day report');
    // El tooltip no repite el nombre: dice el atajo.
    expect(button.dataset.tip).toBe(IS_MAC ? '⌘⌥⇧N' : 'Ctrl+Alt+Shift+N');
    click(button);
    await popoverReady();
    const [date, day, place] = inputs();
    expect(date.value).toBe(localDate());
    // Hoy ya existe (el primero se creó hoy): Enter lo abriría.
    expect(popover()!.textContent).toContain(`Day 01 · ${localDate()} already exists`);
    expect(popover()!.querySelector('button[type="submit"]')!.textContent).toBe('Open');
    // Mañana: se crea.
    const tomorrow = addDays(localDate(), 1);
    setInput(date, tomorrow);
    expect(popover()!.textContent).not.toContain('already exists');
    expect(day.value).toBe('2');
    expect(place.value).toBe('Estancia La Paz');
    setInput(place, 'Galpón 2');
    expect(document.activeElement?.tagName).toBe('INPUT');
    act(() => popover()!.requestSubmit());
    for (let i = 0; i < 60 && location.pathname === '/'; i++) await wait(30);
    const made = device.tree.children(folder).at(-1)!;
    expect(made.title).toBe(`${tomorrow} | Day 02`);
    expect(location.pathname).toBe(`/p/${made.id}`);
    expect(popover()).toBeNull();
  });

  it('ya existe: Enter abre el de hoy y Create another hace otro', async () => {
    const { device, folder, first } = await withReport();
    const host = await open(device, folder);
    click(host.querySelector('.day-report-button'));
    await popoverReady();
    expect(popover()!.querySelector('button[type="submit"]')!.textContent).toBe('Open');
    act(() => popover()!.requestSubmit());
    await wait(30);
    expect(location.pathname).toBe(`/p/${first}`);
    expect(device.tree.children(folder).length).toBe(1);

    click(host.querySelector('.day-report-button'));
    await popoverReady();
    click([...popover()!.querySelectorAll('button')].find((b) => b.textContent === 'Create another'));
    for (let i = 0; i < 40 && device.tree.children(folder).length < 2; i++) await wait(30);
    expect(device.tree.children(folder).map((p) => p.title)).toEqual([`${localDate()} | Day 01`, `${localDate()} | Day 02`]);
  });

  it('el atajo abre y cierra el globito (también por la posición de la tecla); con AltGr no', async () => {
    const { device, first } = await withReport();
    await open(device, first);
    shortcut({ altGr: true, key: 'Ń' });
    await wait(30);
    expect(popover()).toBeNull();
    // En la Mac, ⌥ cambia la letra: vale por `code`.
    shortcut({ key: '˜' });
    await wait(30);
    expect(popover()).not.toBeNull();
    shortcut();
    await wait(30);
    expect(popover()).toBeNull();
    // Sin Shift no (⌘⌥N es de Chrome en la Mac).
    shortcut({ shiftKey: false });
    await wait(30);
    expect(popover()).toBeNull();
  });

  it('sin red: crea el reporte igual (todo en el dispositivo)', async () => {
    const { server, device, folder, first } = await withReport();
    server.online = false;
    const host = await open(device, first);
    click(host.querySelector('.day-report-button'));
    await popoverReady();
    setInput(inputs()[0], addDays(localDate(), 1));
    act(() => popover()!.requestSubmit());
    for (let i = 0; i < 40 && device.tree.children(folder).length < 2; i++) await wait(30);
    expect(device.tree.children(folder).length).toBe(2);
    await device.engine.syncNow();
    expect(device.tree.pendingOps().length).toBeGreaterThan(0);
  });

  it('solo con permiso para crear en la carpeta: con Edit no hay botón, con Edit pages sí', async () => {
    const { server, device, folder, first } = await withReport(true);
    await device.engine.syncNow();
    server.addMember('ana', 'member', 'ana@test');
    server.grant('ana', { pageId: folder }, 'edit');
    const ana = await makeDevice(server, undefined, undefined, undefined, undefined, { id: 'ana', email: 'ana@test' });
    devices.push(ana);
    await ana.engine.syncNow();
    let host = await open(ana, first, services(ana, 'ana'));
    expect(host.querySelector('.day-report-button')).toBeNull();
    for (const r of roots.splice(0)) act(() => r.unmount());
    server.grant('ana', { pageId: folder }, 'edit_pages');
    await ana.engine.syncNow();
    host = await open(ana, first, services(ana, 'ana'));
    expect(host.querySelector('.day-report-button')).not.toBeNull();
  });
});

describe('el menú de la página', () => {
  async function menuFor(device: Device, pageId: string) {
    const { PageMenu } = await import('../ui/menus');
    const menuHost = document.createElement('div');
    document.body.append(menuHost);
    const root = createRoot(menuHost);
    roots.push(root);
    act(() =>
      root.render(
        <ServicesContext.Provider value={services(device)}>
          <PageMenu
            pageId={pageId}
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
    return (label: string) => [...menuHost.querySelectorAll('button')].find((b) => b.textContent?.includes(label));
  }

  it('Use for day reports marca la página; Stop using la deja (y gana sobre lo deducido)', async () => {
    const { device } = await setup();
    const folder = await device.tree.create(null, 'Unidad 2');
    let item = await menuFor(device, folder);
    expect(item('New day report')).toBeUndefined();
    click(item('Use for day reports'));
    await wait(30);
    expect(dayReportsMark(device.tree.get(folder))).toBe('on');
    for (const r of roots.splice(0)) act(() => r.unmount());
    item = await menuFor(device, folder);
    expect(item('New day report')).toBeDefined();
    click(item('Stop using for day reports'));
    await wait(30);
    expect(device.tree.get(folder)?.settings?.dayReports).toBe(false);
  });

  it('New day report sobre una carpeta que no está abierta la abre y muestra el globito', async () => {
    const { device } = await setup();
    const folder = await device.tree.create(null, 'Reportes');
    await device.tree.setSetting(folder, 'dayReports', {});
    const item = await menuFor(device, folder);
    click(item('New day report'));
    expect(location.pathname).toBe(`/p/${folder}`);
    await open(device, folder);
    await popoverReady();
    expect(inputs()[1].value).toBe('1');
  });
});
