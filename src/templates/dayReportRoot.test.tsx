// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { EditorView } from '@tiptap/pm/view';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { prefs } from '../prefs';
import { ServicesContext, type Services } from '../services';
import { Permissions } from '../sync/access';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { unmountAll } from '../ui/collabHarness';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { isEmptyPage } from './apply';
import { BUILTIN_ONSET } from './builtinIds';
import { dayReportsMark, isDayReportFolder, localDate } from './dayReport';
import { createDayReport, folderTemplateId, planDayReport } from './dayReportCreate';
import { createReportFolder, reportFolderOptions } from './dayReportRoot';
import { customizeBuiltin } from './ownCopy';
import { requestTemplates } from './templatesUi';

// *On-Set Report* en la raíz del proyecto (Docs/Doc_Plantillas.md, 6.2, D82, Lega 2026-10-02): no se crea un reporte sin
// carpeta. La app ofrece una carpeta de reportes (la que ya hay, o una nueva con nombre editable), mueve ahí la página
// vacía y la llena como el reporte del día. Con la página de verdad (PageView sobre el servidor en memoria): la tira, la
// ventana *Templates*, plantillas propias, sin red, otro dispositivo, permisos y los casos de carrera.

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
  // Lo que quedó escribiéndose (el contenido de la página, el recuento de pendientes) termina antes de cerrar la base.
  await act(async () => new Promise((r) => setTimeout(r, 150)));
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
async function waitFor<T>(fn: () => T | null | undefined | false, tries = 100): Promise<NonNullable<T>> {
  for (let i = 0; i < tries; i++) {
    const v = fn();
    if (v) return v as NonNullable<T>;
    await wait(30);
  }
  throw new Error('waitFor: no llegó');
}

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

async function setup(team = false) {
  const server = new FakeServer();
  if (team) server.enableTeam();
  const device = await makeDevice(server);
  devices.push(device);
  await device.engine.syncNow();
  return { server, device };
}

const deps = (d: Device) => ({ tree: d.tree, docs: d.docs, engine: d.engine });

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
  await waitFor(() => host.querySelector('.bn-editor'), 100);
  await wait(100);
  return host;
}

function pageView(host: HTMLElement): EditorView {
  const dom = host.querySelector('.ProseMirror') as (HTMLElement & { editor?: { view: EditorView } }) | null;
  return dom!.editor!.view;
}

/** El título de sección de arriba del cursor (`Summary` si el reporte se abrió con el cursor donde va). */
function blockBeforeCursor(view: EditorView): string {
  const $from = view.state.selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'blockContainer') {
      const before = view.state.doc.resolve($from.before(d));
      return before.index() > 0 ? before.parent.child(before.index() - 1).textContent : '';
    }
  }
  return '';
}

const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
const dialogEl = () => document.querySelector<HTMLFormElement>('.root-report-dialog');
const field = (name: string) => dialogEl()?.querySelector<HTMLInputElement & HTMLSelectElement>(`[data-root-report="${name}"]`) ?? null;
const confirmButton = () => dialogEl()!.querySelector<HTMLButtonElement>('[data-root-report="confirm"]')!;

function setInput(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function setSelect(el: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const submit = () => act(() => dialogEl()!.requestSubmit());

/** Los avisos que muestra la app mientras corre `run`. */
async function withNotices<T>(run: (notices: unknown[]) => Promise<T>): Promise<T> {
  const notices: unknown[] = [];
  const listen = (e: Event) => notices.push((e as CustomEvent).detail);
  window.addEventListener('shotdocs:notice', listen);
  try {
    return await run(notices);
  } finally {
    window.removeEventListener('shotdocs:notice', listen);
  }
}

describe('On-Set Report en la raíz: la tira', () => {
  it('abre la ventana sin escribir nada; Enter crea la carpeta marcada y el reporte adentro, con el cursor en Summary', async () => {
    const { device } = await setup();
    const project = device.tree.workspaceId;
    const before = await device.tree.create(null, 'Escena 1');
    const page = await device.tree.create(null, '');
    const after = await device.tree.create(null, 'Escena 2');
    const host = await open(device, page);
    click(host.querySelector('.template-strip [data-template="onset"]'));
    await waitFor(dialogEl);
    // Todavía no se tocó nada: la página sigue vacía y en la raíz, y no hay carpeta nueva.
    expect(device.tree.get(page)?.parent_id).toBeNull();
    expect(device.tree.roots(project).map((p) => p.title)).toEqual(['Escena 1', '', 'Escena 2']);
    expect(dialogEl()!.textContent).toContain('Day reports go in a folder');
    // Sin carpeta de reportes en el proyecto: solo el nombre (editable, ya elegido) y el botón principal.
    expect(field('folder')).toBeNull();
    expect(field('name')!.value).toBe('On-Set Reports');
    expect(confirmButton().textContent).toBe('Create folder and report');
    expect(document.activeElement).toBe(field('name'));

    submit();
    await waitFor(() => device.tree.get(page)?.title);
    await wait(100);
    const folder = device.tree.get(page)!.parent_id!;
    expect(folder).toBeTruthy();
    expect(device.tree.get(folder)?.title).toBe('On-Set Reports');
    expect(device.tree.get(folder)?.parent_id).toBeNull();
    expect(dayReportsMark(device.tree.get(folder))).toBe('on');
    expect(isDayReportFolder(device.tree, folder)).toBe(true);
    // La carpeta quedó donde estaba la página, y la raíz no tiene ninguna página vacía de más.
    expect(device.tree.roots(project).map((p) => p.id)).toEqual([before, folder, after]);
    expect(device.tree.children(folder).map((p) => p.id)).toEqual([page]);
    const today = localDate();
    expect(device.tree.get(page)?.title).toBe(`${today} | Day 01`);
    expect(device.tree.get(page)?.template_id).toBe(BUILTIN_ONSET);
    expect(dialogEl()).toBeNull();
    expect(host.textContent).toContain(`${today} · `);
    expect(host.querySelector('.template-strip')).toBeNull();
    expect(host.querySelector('.ProseMirror')!.contains(document.activeElement)).toBe(true);
    expect(blockBeforeCursor(pageView(host))).toBe('Summary');
    expect(host.querySelector('.day-report-button')).not.toBeNull();
  });

  it('el nombre de la carpeta se puede cambiar; vacío vuelve al de siempre', async () => {
    const { device } = await setup();
    const a = await device.tree.create(null, '');
    let host = await open(device, a);
    click(host.querySelector('.template-strip [data-template="onset"]'));
    await waitFor(dialogEl);
    setInput(field('name')!, '  Reportes   ERSO  ');
    submit();
    await waitFor(() => device.tree.get(a)?.title);
    expect(device.tree.get(device.tree.get(a)!.parent_id!)?.title).toBe('Reportes ERSO');
    unmountAll();
    for (const r of roots.splice(0)) act(() => r.unmount());

    const b = await device.tree.create(null, '');
    host = await open(device, b);
    click(host.querySelector('.template-strip [data-template="onset"]'));
    await waitFor(dialogEl);
    // Ahora hay una carpeta de reportes: se propone usarla; la nueva se elige a propósito y sin nombre se llama como siempre.
    setSelect(field('folder')!, '');
    await waitFor(() => field('name'));
    setInput(field('name')!, '   ');
    submit();
    await waitFor(() => device.tree.get(b)?.title);
    expect(device.tree.get(device.tree.get(b)!.parent_id!)?.title).toBe('On-Set Reports');
  });

  it('con una carpeta de reportes en el proyecto la propone: el reporte sale como el siguiente día y no se crea otra carpeta', async () => {
    const { device } = await setup();
    const project = device.tree.workspaceId;
    const folder = await device.tree.create(null, 'Reportes');
    const plan = await planDayReport(deps(device), { parentId: folder, projectId: project });
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    await createDayReport(deps(device), plan, { ...plan.suggestion, date: localDate(yesterday), location: 'Estancia La Paz' }, 'en', { canMark: true });
    const page = await device.tree.create(null, '');
    const rootsBefore = device.tree.roots(project).length;
    const host = await open(device, page);
    click(host.querySelector('.template-strip [data-template="onset"]'));
    await waitFor(dialogEl);
    expect([...field('folder')!.options].map((o) => o.textContent)).toEqual(['Reportes', 'New folder…']);
    expect(field('folder')!.value).toBe(folder);
    expect(field('name')).toBeNull();
    // El botón principal ya tiene el foco: un Enter alcanza.
    expect(confirmButton().textContent).toBe('Create report in folder');
    expect(document.activeElement).toBe(confirmButton());
    submit();
    await waitFor(() => device.tree.get(page)?.title);
    await wait(100);
    expect(device.tree.get(page)?.parent_id).toBe(folder);
    expect(device.tree.get(page)?.title).toBe(`${localDate()} | Day 02`);
    // Quedó al final de la carpeta y la raíz perdió la página (ninguna carpeta nueva).
    expect(device.tree.children(folder).at(-1)?.id).toBe(page);
    expect(device.tree.roots(project).length).toBe(rootsBefore - 1);
    // Con lo de ayer: la locación.
    expect(host.textContent).toContain('Estancia La Paz');
  });

  it('con una carpeta ya hecha, "New folder…" crea otra a propósito', async () => {
    const { device } = await setup();
    const project = device.tree.workspaceId;
    const existing = await device.tree.create(null, 'Reportes');
    await device.tree.setSetting(existing, 'dayReports', {});
    const page = await device.tree.create(null, '');
    const host = await open(device, page);
    click(host.querySelector('.template-strip [data-template="onset"]'));
    await waitFor(dialogEl);
    setSelect(field('folder')!, '');
    await waitFor(() => field('name'));
    setInput(field('name')!, 'Segunda unidad');
    submit();
    await waitFor(() => device.tree.get(page)?.title);
    const made = device.tree.get(page)!.parent_id!;
    expect(made).not.toBe(existing);
    expect(device.tree.get(made)?.title).toBe('Segunda unidad');
    expect(device.tree.roots(project).filter((p) => isDayReportFolder(device.tree, p.id)).length).toBe(2);
    expect(device.tree.children(existing).length).toBe(0);
  });

  it('Cancel y Escape no cambian nada: la página sigue vacía en la raíz y la tira sigue ahí', async () => {
    const { device } = await setup();
    const project = device.tree.workspaceId;
    const page = await device.tree.create(null, '');
    const host = await open(device, page);
    const pagesBefore = device.tree.roots(project).length;
    click(host.querySelector('.template-strip [data-template="onset"]'));
    await waitFor(dialogEl);
    click([...dialogEl()!.querySelectorAll('button')].find((b) => b.textContent === 'Cancel'));
    expect(dialogEl()).toBeNull();
    click(host.querySelector('.template-strip [data-template="onset"]'));
    await waitFor(dialogEl);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(dialogEl()).toBeNull();
    expect(device.tree.roots(project).length).toBe(pagesBefore);
    expect(device.tree.get(page)?.parent_id).toBeNull();
    expect(device.tree.get(page)?.template_id ?? null).toBeNull();
    expect(device.tree.get(page)?.title).toBe('');
    expect(host.querySelector('.template-strip')).not.toBeNull();
    const doc = await device.docs.open(page);
    expect(isEmptyPage(doc)).toBe(true);
    device.docs.close(page);
  });

  it('las otras dos plantillas de fábrica siguen creándose en la raíz, sin ventana', async () => {
    const { device } = await setup();
    const page = await device.tree.create(null, '');
    const host = await open(device, page);
    click(host.querySelector('.template-strip [data-template="shot"]'));
    await wait(100);
    expect(dialogEl()).toBeNull();
    expect(device.tree.get(page)?.parent_id).toBeNull();
    expect(device.tree.get(page)?.template_id).not.toBeNull();
  });

  it('adentro de una carpeta sigue como antes: sin ventana, el reporte en la misma carpeta', async () => {
    const { device } = await setup();
    const folder = await device.tree.create(null, 'Reportes');
    const page = await device.tree.create(folder, '');
    const host = await open(device, page);
    click(host.querySelector('.template-strip [data-template="onset"]'));
    await waitFor(() => device.tree.get(page)?.title);
    expect(dialogEl()).toBeNull();
    expect(device.tree.get(page)?.parent_id).toBe(folder);
  });
});

describe('On-Set Report en la raíz: Apply template… y las propias', () => {
  it('Apply template… sobre una página con título de la raíz: la ventana Templates se cierra y sale la de la carpeta; el título queda', async () => {
    const { device } = await setup();
    const page = await device.tree.create(null, 'Jueves');
    const host = await open(device, page);
    act(() => requestTemplates(page));
    await waitFor(() => document.querySelector('.templates-dialog'));
    click(document.querySelector('.templates-dialog [data-template="onset"] button.primary'));
    await waitFor(dialogEl);
    expect(document.querySelector('.templates-dialog')).toBeNull();
    submit();
    await waitFor(() => device.tree.get(page)?.parent_id);
    await wait(100);
    const folder = device.tree.get(page)!.parent_id!;
    expect(dayReportsMark(device.tree.get(folder))).toBe('on');
    // Tenía título: se respeta (nunca se pisa lo que escribió la persona).
    expect(device.tree.get(page)?.title).toBe('Jueves');
    expect(device.tree.get(page)?.template_id).toBe(BUILTIN_ONSET);
    expect(host.textContent).toContain(`${localDate()} · `);
  });

  it('una plantilla propia con Use for day reports en la raíz: la misma ventana, y la carpeta queda con esa plantilla', async () => {
    const { device } = await setup();
    const home = device.tree.workspaceId;
    const tpl = await customizeBuiltin(deps(device), 'onset', home, 'en');
    await device.tree.rename(tpl, 'ERSO report');
    const page = await device.tree.create(null, '');
    const host = await open(device, page);
    click([...host.querySelectorAll('.template-chip')].find((b) => b.textContent === 'More…'));
    await waitFor(() => document.querySelector('.templates-dialog'));
    click([...document.querySelectorAll(`.templates-dialog [data-template-page="${tpl}"] button`)].find((b) => b.textContent === 'Use'));
    await waitFor(dialogEl);
    // Nada se copió todavía.
    expect(device.tree.get(page)?.template_id ?? null).toBeNull();
    submit();
    await waitFor(() => device.tree.get(page)?.template_id === tpl);
    await wait(100);
    const folder = device.tree.get(page)!.parent_id!;
    expect(folder).toBeTruthy();
    expect(folderTemplateId(device.tree, folder)).toBe(tpl);
    expect(device.tree.get(page)?.title).toBe(`${localDate()} | Day 01`);
    expect(host.textContent).toContain(`${localDate()} · `);
  });
});

describe('On-Set Report en la raíz: sin red y con dos dispositivos', () => {
  it('sin red crea la carpeta y el reporte igual; al volver la red sube todo una vez y otro dispositivo lo ve entero', async () => {
    const { server, device } = await setup();
    const other = await makeDevice(server);
    devices.push(other);
    await other.engine.syncNow();
    const page = await device.tree.create(null, '');
    await device.engine.syncNow();
    server.online = false;
    const host = await open(device, page);
    click(host.querySelector('.template-strip [data-template="onset"]'));
    await waitFor(dialogEl);
    submit();
    await waitFor(() => device.tree.get(page)?.title);
    await wait(100);
    const folder = device.tree.get(page)!.parent_id!;
    expect(folder).toBeTruthy();
    await device.engine.syncNow();
    expect(device.tree.pendingOps().length).toBeGreaterThan(0);

    server.online = true;
    for (let i = 0; i < 3; i++) {
      await device.engine.syncNow();
      await other.engine.syncNow();
    }
    expect(device.tree.pendingOps().length).toBe(0);
    expect(other.tree.get(folder)?.title).toBe('On-Set Reports');
    expect(dayReportsMark(other.tree.get(folder))).toBe('on');
    expect(other.tree.get(page)?.parent_id).toBe(folder);
    expect(other.tree.get(page)?.title).toBe(`${localDate()} | Day 01`);
    // Una sola carpeta y ninguna página vacía en la raíz del otro dispositivo.
    expect(other.tree.roots(other.tree.workspaceId).map((p) => p.id)).toEqual([folder]);
    const doc = await other.docs.open(page);
    expect(isEmptyPage(doc)).toBe(false);
    other.docs.close(page);
  });

  it('si otro dispositivo ya movió la página a una carpeta mientras la ventana estaba abierta, no se crea otra: es un reporte de esa carpeta', async () => {
    const { device } = await setup();
    const project = device.tree.workspaceId;
    const folder = await device.tree.create(null, 'Reportes');
    const page = await device.tree.create(null, '');
    const host = await open(device, page);
    click(host.querySelector('.template-strip [data-template="onset"]'));
    await waitFor(dialogEl);
    await device.tree.move(page, folder);
    const rootsBefore = device.tree.roots(project).length;
    submit();
    await waitFor(() => device.tree.get(page)?.title);
    expect(device.tree.get(page)?.parent_id).toBe(folder);
    expect(device.tree.roots(project).length).toBe(rootsBefore);
    expect(dayReportsMark(device.tree.get(folder))).toBe('on');
  });

  it('si llegó texto a la página mientras la ventana estaba abierta, no crea carpeta ni mueve nada', async () => {
    const { device } = await setup();
    const project = device.tree.workspaceId;
    const page = await device.tree.create(null, '');
    const host = await open(device, page);
    click(host.querySelector('.template-strip [data-template="onset"]'));
    await waitFor(dialogEl);
    const { mountEditor, typeAt } = await import('../ui/collabHarness');
    const doc = await device.docs.open(page);
    const other = mountEditor(doc, 'otra');
    act(() => typeAt(other, 'initialBlockId', 'start', 'Hola'));
    device.docs.close(page);
    await wait(50);
    const rootsBefore = device.tree.roots(project).length;
    await withNotices(async (notices) => {
      submit();
      await wait(100);
      expect(notices).toContain('Only on an empty page');
    });
    expect(dialogEl()).toBeNull();
    expect(device.tree.roots(project).length).toBe(rootsBefore);
    expect(device.tree.get(page)?.parent_id).toBeNull();
  });
});

describe('On-Set Report en la raíz: la carpeta elegida ya tiene el reporte de hoy', () => {
  const existsLine = () => dialogEl()?.querySelector('[data-root-report="exists"]') ?? null;
  const anotherButton = () => dialogEl()?.querySelector<HTMLButtonElement>('[data-root-report="another"]') ?? null;

  /** Una carpeta de reportes con el reporte de hoy adentro. */
  async function folderWithToday(device: Device) {
    const folder = await device.tree.create(null, 'Reportes');
    const plan = await planDayReport(deps(device), { parentId: folder, projectId: device.tree.workspaceId });
    const first = await createDayReport(deps(device), plan, { ...plan.suggestion, location: 'Estancia La Paz' }, 'en', { canMark: true });
    return { folder, first };
  }

  it('lo dice antes de crear otro: Enter abre el de hoy y la página de la raíz queda como estaba', async () => {
    const { device } = await setup();
    const { folder, first } = await folderWithToday(device);
    const page = await device.tree.create(null, '');
    const host = await open(device, page);
    click(host.querySelector('.template-strip [data-template="onset"]'));
    await waitFor(existsLine);
    expect(existsLine()!.textContent).toBe(`Day 01 · ${localDate()} already exists`);
    expect(confirmButton().textContent).toBe('Open');
    expect(anotherButton()!.textContent).toBe('Create another');
    submit();
    await waitFor(() => location.pathname === `/p/${first}`);
    expect(dialogEl()).toBeNull();
    // Nada se movió ni se creó: la carpeta sigue con un solo reporte y la página, vacía en la raíz.
    expect(device.tree.children(folder).map((p) => p.id)).toEqual([first]);
    expect(device.tree.get(page)?.parent_id).toBeNull();
    expect(device.tree.get(page)?.template_id ?? null).toBeNull();
    expect(device.tree.get(page)?.title).toBe('');
  });

  it('Create another crea a propósito otro del mismo día en esa carpeta', async () => {
    const { device } = await setup();
    const { folder, first } = await folderWithToday(device);
    const page = await device.tree.create(null, '');
    const host = await open(device, page);
    click(host.querySelector('.template-strip [data-template="onset"]'));
    await waitFor(anotherButton);
    click(anotherButton());
    await waitFor(() => device.tree.get(page)?.title);
    await wait(100);
    expect(device.tree.children(folder).map((p) => p.id)).toEqual([first, page]);
    expect(device.tree.get(page)?.title.startsWith(`${localDate()} | Day `)).toBe(true);
    expect(device.tree.get(page)?.template_id).toBe(BUILTIN_ONSET);
    expect(location.pathname).not.toBe(`/p/${first}`);
  });

  it('Enter mientras se lee la carpeta se recuerda: abre el de hoy en vez de crear otro', async () => {
    const { device } = await setup();
    const { folder, first } = await folderWithToday(device);
    const page = await device.tree.create(null, '');
    const host = await open(device, page);
    // La lectura de los reportes queda frenada hasta soltarla.
    const realSnapshot = device.docs.snapshot.bind(device.docs);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    device.docs.snapshot = (async (id: string) => {
      await gate;
      return realSnapshot(id);
    }) as typeof device.docs.snapshot;
    click(host.querySelector('.template-strip [data-template="onset"]'));
    await waitFor(dialogEl);
    expect(confirmButton().textContent).toBe('Create report in folder');
    submit();
    await wait(80);
    // Todavía no se sabe qué hay en la carpeta: no se creó ni se movió nada.
    expect(device.tree.get(page)?.parent_id).toBeNull();
    expect(dialogEl()).not.toBeNull();
    release();
    await waitFor(() => location.pathname === `/p/${first}`);
    expect(device.tree.children(folder).map((p) => p.id)).toEqual([first]);
    expect(device.tree.get(page)?.parent_id).toBeNull();
  });

  it('un Enter recordado se olvida si antes de terminar de leer se elige otra carpeta', async () => {
    const { device } = await setup();
    const { first } = await folderWithToday(device);
    const project = device.tree.workspaceId;
    const page = await device.tree.create(null, '');
    const host = await open(device, page);
    const realSnapshot = device.docs.snapshot.bind(device.docs);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    device.docs.snapshot = (async (id: string) => {
      await gate;
      return realSnapshot(id);
    }) as typeof device.docs.snapshot;
    click(host.querySelector('.template-strip [data-template="onset"]'));
    await waitFor(dialogEl);
    const rootsBefore = device.tree.roots(project).length;
    submit();
    await wait(50);
    setSelect(field('folder')!, '');
    await waitFor(() => field('name'));
    release();
    await wait(300);
    // La ventana sigue abierta esperando una decisión: ni se abrió el de hoy ni se creó una carpeta nueva.
    expect(dialogEl()).not.toBeNull();
    expect(device.tree.roots(project).length).toBe(rootsBefore);
    expect(device.tree.get(page)?.parent_id).toBeNull();
    expect(location.pathname).not.toBe(`/p/${first}`);
  });

  it('el reporte de hoy en la papelera no cuenta, y con "New folder…" no se avisa', async () => {
    const { device } = await setup();
    const { folder, first } = await folderWithToday(device);
    const page = await device.tree.create(null, '');
    const host = await open(device, page);
    click(host.querySelector('.template-strip [data-template="onset"]'));
    await waitFor(existsLine);
    setSelect(field('folder')!, '');
    await waitFor(() => field('name'));
    expect(existsLine()).toBeNull();
    expect(confirmButton().textContent).toBe('Create folder and report');
    click([...dialogEl()!.querySelectorAll('button')].find((b) => b.textContent === 'Cancel'));

    await device.tree.trash(first);
    click(host.querySelector('.template-strip [data-template="onset"]'));
    await waitFor(dialogEl);
    await wait(300);
    expect(field('folder')!.value).toBe(folder);
    expect(existsLine()).toBeNull();
    expect(confirmButton().textContent).toBe('Create report in folder');
  });

  it('una página con subpáginas: la ventana dice que se mueven con ella, y se mueven', async () => {
    const { device } = await setup();
    const page = await device.tree.create(null, 'Jueves');
    const child = await device.tree.create(page, 'Fotos');
    await open(device, page);
    act(() => requestTemplates(page));
    await waitFor(() => document.querySelector('.templates-dialog'));
    click(document.querySelector('.templates-dialog [data-template="onset"] button.primary'));
    await waitFor(dialogEl);
    expect(dialogEl()!.textContent).toContain('This page goes inside it. Its subpages move with it.');
    submit();
    await waitFor(() => device.tree.get(page)?.parent_id);
    expect(device.tree.get(child)?.parent_id).toBe(page);
  });

  it('sin subpáginas la ventana no las nombra', async () => {
    const { device } = await setup();
    const page = await device.tree.create(null, '');
    const host = await open(device, page);
    click(host.querySelector('.template-strip [data-template="onset"]'));
    await waitFor(dialogEl);
    expect(dialogEl()!.textContent).toContain('This page goes inside it.');
    expect(dialogEl()!.textContent).not.toContain('subpages');
  });
});

describe('On-Set Report en la raíz: cuando algo falla', () => {
  it('si mover la página falla, avisa en la ventana y el reintento (aun con otro nombre) usa la carpeta que ya quedó: una sola carpeta', async () => {
    const { device } = await setup();
    const project = device.tree.workspaceId;
    const page = await device.tree.create(null, '');
    const host = await open(device, page);
    const realMove = device.tree.move.bind(device.tree);
    let fail = true;
    device.tree.move = (async (...args: Parameters<typeof realMove>) => {
      if (fail) {
        fail = false;
        throw new Error('boom');
      }
      return realMove(...args);
    }) as typeof device.tree.move;
    click(host.querySelector('.template-strip [data-template="onset"]'));
    await waitFor(dialogEl);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    submit();
    await waitFor(() => dialogEl()?.querySelector('[role="alert"]'));
    err.mockRestore();
    expect(dialogEl()!.querySelector('[role="alert"]')!.textContent).toContain("The day report couldn't be created");
    // La página sigue vacía y en la raíz; quedó una carpeta marcada y vacía.
    expect(device.tree.get(page)?.parent_id).toBeNull();
    const folders = device.tree.roots(project).filter((p) => isDayReportFolder(device.tree, p.id));
    expect(folders.length).toBe(1);
    expect(device.tree.children(folders[0].id).length).toBe(0);
    // Reintentar (con otro nombre): la ventana sigue abierta y se usa la carpeta que ya quedó, no se crea otra.
    expect(confirmButton().disabled).toBe(false);
    setInput(field('name')!, 'Reportes del rodaje');
    submit();
    await waitFor(() => device.tree.get(page)?.title);
    await wait(100);
    expect(device.tree.get(page)?.parent_id).toBe(folders[0].id);
    const after = device.tree.roots(project).filter((p) => isDayReportFolder(device.tree, p.id));
    expect(after.map((f) => f.id)).toEqual([folders[0].id]);
    expect(after[0].title).toBe('Reportes del rodaje');
    // Ninguna carpeta vacía de más: la raíz es la carpeta con el reporte y nada más.
    expect(device.tree.roots(project).map((p) => p.id)).toEqual([folders[0].id]);
    expect(device.tree.children(folders[0].id).map((p) => p.id)).toEqual([page]);
  });

  it('sin permiso para crear en la raíz ni carpeta de reportes adonde ir: avisa y no escribe nada', async () => {
    const { server, device } = await setup(true);
    const project = device.tree.workspaceId;
    const shared = await device.tree.create(null, '');
    const other = await device.tree.create(null, 'Otra');
    await device.engine.syncNow();
    server.addMember('ana', 'member', 'ana@test');
    server.grant('ana', { pageId: shared }, 'edit');
    server.grant('ana', { pageId: other }, 'edit');
    const ana = await makeDevice(server, undefined, undefined, undefined, undefined, { id: 'ana', email: 'ana@test' });
    devices.push(ana);
    await ana.engine.syncNow();
    const svc = services(ana, 'ana');
    const host = await open(ana, shared, svc);
    await withNotices(async (notices) => {
      act(() => requestTemplates(shared));
      await waitFor(() => document.querySelector('.templates-dialog'));
      click(document.querySelector('.templates-dialog [data-template="onset"] button.primary'));
      await waitFor(() => notices.length);
      expect(notices).toContain("Day reports go inside a folder, and you can't create one here. Put this page inside a folder first.");
    });
    expect(dialogEl()).toBeNull();
    expect(ana.tree.get(shared)?.parent_id).toBeNull();
    expect(ana.tree.get(shared)?.template_id ?? null).toBeNull();
    expect(host.textContent).not.toContain('Camera package');
    expect(ana.tree.roots(project).length).toBe(2);
  });
});

describe('reportFolderOptions', () => {
  it('lista las carpetas de reportes del proyecto con su camino, sin la página, lo de adentro, la papelera ni lo que no se puede', async () => {
    const { device } = await setup();
    const project = device.tree.workspaceId;
    const tree = device.tree;
    const perms = new Permissions(tree, null, device.remote.userId);
    const page = await tree.create(null, '');
    // La propia página, aunque esté marcada (se la usó para reportes a mano): no se ofrece mover una página adentro de sí misma.
    await tree.setSetting(page, 'dayReports', {});
    const inside = await tree.create(page, 'Adentro de la página');
    await tree.setSetting(inside, 'dayReports', {});
    const plain = await tree.create(null, 'Escenas');
    const nested = await tree.create(plain, 'Reportes B');
    await tree.setSetting(nested, 'dayReports', {});
    const top = await tree.create(null, 'Reportes A');
    await tree.setSetting(top, 'dayReports', {});
    const off = await tree.create(null, 'Dejada');
    await tree.setSetting(off, 'dayReports', false);
    const trashed = await tree.create(null, 'Borrada');
    await tree.setSetting(trashed, 'dayReports', {});
    await tree.trash(trashed);
    // Una carpeta que se deduce por el reporte de adentro (la marca se perdió).
    const deduced = await tree.create(null, 'Deducida');
    await createDayReport(deps(device), await planDayReport(deps(device), { parentId: deduced, projectId: project }), { date: localDate(), day: 1, location: '' }, 'en', {
      canMark: false,
    });
    expect(dayReportsMark(tree.get(deduced))).toBeNull();
    const list = reportFolderOptions(tree, perms, project, page);
    expect(list.map((f) => [f.title, f.parents])).toEqual([
      ['Reportes B', 'Escenas'],
      ['Reportes A', ''],
      ['Deducida', ''],
    ]);
    // Sin permiso para mover la página ahí: no se ofrece.
    const none = { canMove: () => false } as unknown as Permissions;
    expect(reportFolderOptions(tree, none, project, page)).toEqual([]);
  });

  it('createReportFolder con reuse: usa la carpeta del intento anterior si sigue vacía y marcada en la raíz; si no, crea otra', async () => {
    const { device } = await setup();
    const project = device.tree.workspaceId;
    const page = await device.tree.create(null, '');
    const first = await createReportFolder(device.tree, 'Reportes', project, page, 'On-Set Reports');
    // Se reusa (con el nombre nuevo).
    expect(await createReportFolder(device.tree, 'Otro nombre', project, page, 'On-Set Reports', first)).toBe(first);
    expect(device.tree.get(first)?.title).toBe('Otro nombre');
    expect(device.tree.roots(project).filter((p) => isDayReportFolder(device.tree, p.id)).length).toBe(1);
    // Con algo adentro, o en la papelera, o sin la marca: no se reusa.
    const kid = await device.tree.create(first, 'Algo');
    const second = await createReportFolder(device.tree, 'Reportes', project, page, 'On-Set Reports', first);
    expect(second).not.toBe(first);
    await device.tree.trash(kid);
    await device.tree.trash(second);
    expect(await createReportFolder(device.tree, 'Reportes', project, page, 'On-Set Reports', second)).not.toBe(second);
    await device.tree.setSetting(first, 'dayReports', false);
    await device.tree.restore(kid).catch(() => undefined);
    expect(await createReportFolder(device.tree, 'Reportes', project, page, 'On-Set Reports', first)).not.toBe(first);
  });

  it('createReportFolder: marcada, justo donde está la página, con nombre limpio y de respaldo si queda vacío', async () => {
    const { device } = await setup();
    const project = device.tree.workspaceId;
    const a = await device.tree.create(null, 'A');
    const page = await device.tree.create(null, '');
    const b = await device.tree.create(null, 'B');
    const id = await createReportFolder(device.tree, '  Mis   reportes ', project, page, 'On-Set Reports');
    expect(device.tree.get(id)?.title).toBe('Mis reportes');
    expect(device.tree.roots(project).map((p) => p.id)).toEqual([a, id, page, b]);
    expect(dayReportsMark(device.tree.get(id))).toBe('on');
    // No es una página "recién creada": la tira no se ofrece en ella.
    expect(device.tree.isFresh(id)).toBe(false);
    const named = await createReportFolder(device.tree, '   ', project, page, 'On-Set Reports');
    expect(device.tree.get(named)?.title).toBe('On-Set Reports');
  });
});
