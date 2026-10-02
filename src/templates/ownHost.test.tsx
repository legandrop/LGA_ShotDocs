// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { addShape, PHOTO_MARKUP_MAP } from '../media/markup';
import { PHOTO_MARKUP_CAP } from '../media/markupLimits';
import { prefs } from '../prefs';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { unmountAll } from '../ui/collabHarness';
import { BUILTIN_IDS } from './builtin';
import { BUILTIN_ONSET } from './builtinIds';
import { createDayReport, folderTemplateId, planDayReport, writeNewPage } from './dayReportCreate';
import { isTemplatePage, templateInfo, templatesFolderOf } from './own';
import { customizeBuiltin } from './ownCopy';

// Las plantillas propias en la página de verdad (PageView con el editor, sobre el servidor en memoria; Docs/Doc_Plantillas.md,
// entrega 3): *Save as template…* del menú y su ventana, la franja de una plantilla con *Template settings…* y *Stop using
// as template*, la ventana *Templates* con las del proyecto y las de otros (fotos que no se copian), *Customize*, una
// plantilla a medio bajar (*Use built-in*) y el selector de plantilla del globito del reporte del día.

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
const notices: string[] = [];
const onNotice = (e: Event) => {
  const detail = (e as CustomEvent<string | { message: string }>).detail;
  notices.push(typeof detail === 'string' ? detail : detail.message);
};
window.addEventListener('shotdocs:notice', onNotice);
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
  notices.length = 0;
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

async function setup(team = false) {
  const server = new FakeServer();
  if (team) server.enableTeam();
  const device = await makeDevice(server);
  devices.push(device);
  await device.engine.syncNow();
  return { server, device };
}

const deps = (d: Device) => ({ tree: d.tree, docs: d.docs, engine: d.engine });

/** Monta la página abierta (con el lugar que abre las ventanas de las plantillas) y espera su editor. */
async function open(device: Device, pageId: string, svc = services(device)) {
  const { PageView } = await import('../ui/PageView');
  const { OwnTemplatesHost } = await import('./ownTemplatesUi');
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
        <OwnTemplatesHost />
      </ServicesContext.Provider>,
    ),
  );
  for (let i = 0; i < 100 && !host.querySelector('.bn-editor'); i++) await wait(50);
  await wait(100);
  expect(host.querySelector('.bn-editor')).not.toBeNull();
  return host;
}

/** El menú ⋯ de la página (con el lugar que abre las ventanas). Devuelve cómo buscar un renglón por su texto. */
async function menuFor(device: Device, pageId: string, svc = services(device)) {
  const { PageMenu } = await import('../ui/menus');
  const { OwnTemplatesHost } = await import('./ownTemplatesUi');
  const menuHost = document.createElement('div');
  document.body.append(menuHost);
  const root = createRoot(menuHost);
  roots.push(root);
  act(() =>
    root.render(
      <ServicesContext.Provider value={svc}>
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
        <OwnTemplatesHost />
      </ServicesContext.Provider>,
    ),
  );
  return (label: string) => [...menuHost.querySelectorAll<HTMLButtonElement>('.menu button')].find((b) => b.textContent === label);
}

const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
const dialog = (label: string) => document.querySelector<HTMLElement>(`[role="dialog"][aria-label="${label}"]`);

async function waitFor(check: () => unknown, tries = 80) {
  for (let i = 0; i < tries && !check(); i++) await wait(30);
  expect(check()).toBeTruthy();
}

function setValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

async function pageText(device: Device, pageId: string): Promise<string> {
  const doc = await device.docs.open(pageId);
  try {
    return JSON.stringify(doc.getXmlFragment('document-store').toJSON());
  } finally {
    device.docs.close(pageId);
  }
}

describe('Save as template… (5.1)', () => {
  it('el menú abre la ventana; Save copia la página a Templates (creada), la página no cambia, y avisa', async () => {
    const { device } = await setup();
    const page = await device.tree.create(null, 'Escena 12');
    await writeNewPage(device.docs, page, [{ type: 'paragraph', content: 'Plano de la cocina' }, { type: 'checkListItem', props: { checked: true }, content: 'clean plate' }] as never);
    const before = await pageText(device, page);
    const item = await menuFor(device, page);
    const save = item('Save as template…')!;
    expect(save).toBeDefined();
    expect(save.getAttribute('aria-disabled')).toBeNull();
    click(save);
    await waitFor(() => dialog('Save as template'));
    const form = dialog('Save as template')!;
    const [name, description] = [...form.querySelectorAll('input[type="text"]')] as HTMLInputElement[];
    expect(name.value).toBe('Escena 12');
    setValue(name, 'Scene notes');
    setValue(description, 'One per scene');
    const checks = [...form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    // *Use for day reports* apagada (no está en una carpeta de reportes); *Clear filled-in values* prendida.
    expect(checks.map((c) => c.checked)).toEqual([false, true]);
    // Los tooltips no repiten el rótulo.
    expect(form.querySelector('[data-tip]')!.getAttribute('data-tip')).not.toBe('Use for day reports');
    act(() => (form as HTMLFormElement).requestSubmit());
    await waitFor(() => !dialog('Save as template'));
    expect(notices).toContain('Saved as template');
    const folder = templatesFolderOf(device.tree, device.tree.workspaceId)!;
    const [tpl] = device.tree.children(folder.id);
    expect(tpl.title).toBe('Scene notes');
    expect(templateInfo(tpl)).toEqual({ description: 'One per scene', dayReport: false });
    expect(await pageText(device, page)).toBe(before);
    const saved = await pageText(device, tpl.id);
    expect(saved).toContain('Plano de la cocina');
    expect(saved).not.toContain('"checked":true');
  });

  it('no se ofrece en una plantilla ni en Templates; una plantilla dejada ofrece Use as template', async () => {
    const { device } = await setup();
    const tpl = await customizeBuiltin(deps(device), 'shot', device.tree.workspaceId, 'en');
    const folder = device.tree.get(tpl)!.parent_id!;
    let item = await menuFor(device, tpl);
    expect(item('Save as template…')).toBeUndefined();
    for (const r of roots.splice(0)) act(() => r.unmount());
    item = await menuFor(device, folder);
    expect(item('Save as template…')).toBeUndefined();
    for (const r of roots.splice(0)) act(() => r.unmount());
    await device.tree.setSetting(tpl, 'template', false);
    item = await menuFor(device, tpl);
    expect(item('Save as template…')).toBeDefined();
    click(item('Use as template'));
    await wait(30);
    expect(isTemplatePage(device.tree, tpl)).toBe(true);
  });

  it('sin permiso para crear en Templates queda apagado y dice por qué', async () => {
    const { server, device } = await setup(true);
    const page = await device.tree.create(null, 'Escena 12');
    await device.engine.syncNow();
    server.addMember('ana', 'member', 'ana@test');
    server.grant('ana', { pageId: page }, 'edit');
    const ana = await makeDevice(server, undefined, undefined, undefined, undefined, { id: 'ana', email: 'ana@test' });
    devices.push(ana);
    await ana.engine.syncNow();
    const item = await menuFor(ana, page, services(ana, 'ana'));
    const save = item('Save as template…')!;
    expect(save.getAttribute('aria-disabled')).toBe('true');
    expect(save.dataset.tip).toBe('Needs permission to create pages in Templates');
    click(save);
    await wait(30);
    expect(dialog('Save as template')).toBeNull();
  });
});

describe('la franja de una plantilla (5.2)', () => {
  it('dice que es una plantilla; Template settings cambia la descripción y la marca; Stop using la vuelve una página común', async () => {
    const { device } = await setup();
    const tpl = await customizeBuiltin(deps(device), 'onset', device.tree.workspaceId, 'en');
    const host = await open(device, tpl);
    const banner = host.querySelector('.template-banner')!;
    expect(banner.textContent).toContain("Template — new pages get a copy; pages already created don't change.");
    expect(banner.textContent).toContain('Day reports');
    click([...banner.querySelectorAll('button')].find((b) => b.textContent === 'Template settings…'));
    await waitFor(() => dialog('Template settings'));
    const form = dialog('Template settings') as HTMLFormElement;
    setValue(form.querySelector('input[type="text"]') as HTMLInputElement, 'Ours, with drone');
    click(form.querySelector('input[type="checkbox"]'));
    act(() => form.requestSubmit());
    await waitFor(() => !dialog('Template settings'));
    expect(templateInfo(device.tree.get(tpl))).toEqual({ description: 'Ours, with drone', dayReport: false });
    await wait(30);
    expect(host.querySelector('.template-banner')!.textContent).toContain('Ours, with drone');
    click([...host.querySelectorAll('.template-banner button')].find((b) => b.textContent === 'Stop using as template'));
    await wait(30);
    expect(isTemplatePage(device.tree, tpl)).toBe(false);
    expect(host.querySelector('.template-banner')).toBeNull();
    // La página y su contenido quedan.
    expect(device.tree.get(tpl)).toBeDefined();
    expect(await pageText(device, tpl)).toContain('Camera package');
  });

  it('no sale en una página común', async () => {
    const { device } = await setup();
    const page = await device.tree.create(null, 'Escena 12');
    const host = await open(device, page);
    expect(host.querySelector('.template-banner')).toBeNull();
  });
});

describe('la ventana Templates con las propias (4.1 y 4.2)', () => {
  it('lista las del proyecto y las de otros; Use copia la propia; la de otro proyecto avisa las fotos que no copió', async () => {
    const { device } = await setup();
    const home = device.tree.workspaceId;
    const ours = await customizeBuiltin(deps(device), 'shot', home, 'en');
    await device.tree.rename(ours, 'ERSO shot sheet');
    const other = await device.tree.createProject('MGTZD');
    const theirs = await customizeBuiltin(deps(device), 'prepro', other, 'en');
    expect(templateInfo(device.tree.get(theirs)).description).not.toBe('');
    // Otra plantilla del otro proyecto, con una foto.
    const otherPage = await device.tree.create(null, 'Photo page', other);
    await writeNewPage(device.docs, otherPage, [{ type: 'image', props: { url: 'sdmedia://0f8fad5b-d9cb-469f-a165-708677289501', name: 'a.jpg' } }, { type: 'paragraph', content: 'With photo' }] as never);
    await device.tree.setSetting(otherPage, 'template', { description: 'Has a photo' });

    const page = await device.tree.create(null, '');
    const host = await open(device, page);
    click([...host.querySelectorAll('.template-chip')].find((b) => b.textContent === 'More…'));
    await waitFor(() => dialog('Templates'));
    const win = dialog('Templates')!;
    const labels = [...win.querySelectorAll('.menu-label')].map((l) => l.textContent);
    expect(labels).toEqual(['Built-in', 'This project', 'Other projects']);
    expect(win.querySelector('.templates-project-name')!.textContent).toBe('MGTZD');
    expect(win.querySelector(`[data-template-page="${ours}"]`)!.textContent).toContain('ERSO shot sheet');
    expect(win.querySelector(`[data-template-page="${otherPage}"]`)!.textContent).toContain('Has a photo');
    // Use en la del otro proyecto: se copia sin la foto, y se avisa.
    click([...win.querySelectorAll(`[data-template-page="${otherPage}"] button`)].find((b) => b.textContent === 'Use'));
    await waitFor(() => device.tree.get(page)?.template_id === otherPage);
    await wait(50);
    expect(dialog('Templates')).toBeNull();
    expect(notices).toContain("1 photo or file wasn't copied: it belongs to another project.");
    const text = await pageText(device, page);
    expect(text).toContain('With photo');
    expect(text).not.toContain('sdmedia');
    // El foco va al título vacío, como con las de fábrica.
    expect(document.activeElement?.tagName).toBe('TEXTAREA');
  });

  /** Una plantilla propia con una foto anotada (P.20): la foto `...01` con una flecha. */
  async function templateWithAnnotatedPhoto(device: Device, projectId: string, long = 0): Promise<string> {
    const tpl = await device.tree.create(null, 'Annotated', projectId);
    await writeNewPage(device.docs, tpl, [{ type: 'image', props: { url: 'sdmedia://0f8fad5b-d9cb-469f-a165-708677289501', name: 'a.jpg' } }, { type: 'paragraph', content: 'Body' }] as never);
    const doc = await device.docs.open(tpl);
    addShape(doc, '0f8fad5b-d9cb-469f-a165-708677289501', 'flecha', { type: 'arrow', zValue: 1, posX: 10, posY: 10, startX: 0, startY: 0, endX: 50, endY: 50 }, { w: 4000, h: 3000 });
    if (long) addShape(doc, '0f8fad5b-d9cb-469f-a165-708677289501', 'larga', { type: 'text', zValue: 2, text: 'x'.repeat(long) }, { w: 4000, h: 3000 });
    await device.docs.flush(tpl);
    device.docs.close(tpl);
    await device.tree.setSetting(tpl, 'template', { description: 'Has arrows' });
    return tpl;
  }

  async function pageMarkup(device: Device, pageId: string): Promise<string[]> {
    const doc = await device.docs.open(pageId);
    try {
      return Object.keys(doc.getMap(PHOTO_MARKUP_MAP).toJSON()).sort();
    } finally {
      device.docs.close(pageId);
    }
  }

  it('Use en una del mismo proyecto lleva las anotaciones de sus fotos; la de otro proyecto no (ni la foto)', async () => {
    const { device } = await setup();
    const home = device.tree.workspaceId;
    const ours = await templateWithAnnotatedPhoto(device, home);
    const other = await device.tree.createProject('MGTZD');
    const theirs = await templateWithAnnotatedPhoto(device, other);
    const photo = '0f8fad5b-d9cb-469f-a165-708677289501';

    const page = await device.tree.create(null, '');
    const host = await open(device, page);
    click([...host.querySelectorAll('.template-chip')].find((b) => b.textContent === 'More…'));
    await waitFor(() => dialog('Templates'));
    click([...dialog('Templates')!.querySelectorAll(`[data-template-page="${ours}"] button`)].find((b) => b.textContent === 'Use'));
    await waitFor(() => device.tree.get(page)?.template_id === ours);
    await wait(80);
    expect(await pageMarkup(device, page)).toEqual([photo, `${photo}/flecha`]);
    expect(notices).toEqual([]);

    // Otra página, de la de otro proyecto: sin foto y sin anotaciones.
    const page2 = await device.tree.create(null, '');
    unmountAll();
    for (const r of roots.splice(0)) act(() => r.unmount());
    document.body.innerHTML = '';
    const host2 = await open(device, page2);
    click([...host2.querySelectorAll('.template-chip')].find((b) => b.textContent === 'More…'));
    await waitFor(() => dialog('Templates'));
    click([...dialog('Templates')!.querySelectorAll(`[data-template-page="${theirs}"] button`)].find((b) => b.textContent === 'Use'));
    await waitFor(() => device.tree.get(page2)?.template_id === theirs);
    await wait(80);
    expect(await pageMarkup(device, page2)).toEqual([]);
    expect(await pageText(device, page2)).not.toContain('sdmedia');
  });

  it('si las anotaciones no entran por los topes de la página, la foto llega limpia y se avisa', async () => {
    const { device } = await setup();
    const tpl = await templateWithAnnotatedPhoto(device, device.tree.workspaceId, PHOTO_MARKUP_CAP + 10);
    const page = await device.tree.create(null, '');
    const host = await open(device, page);
    click([...host.querySelectorAll('.template-chip')].find((b) => b.textContent === 'More…'));
    await waitFor(() => dialog('Templates'));
    click([...dialog('Templates')!.querySelectorAll(`[data-template-page="${tpl}"] button`)].find((b) => b.textContent === 'Use'));
    await waitFor(() => device.tree.get(page)?.template_id === tpl);
    await wait(80);
    expect(notices).toContain('Some photos came without their annotations: this page already has too many.');
    expect(await pageMarkup(device, page)).toEqual([]);
    expect(await pageText(device, page)).toContain('sdmedia://0f8fad5b-d9cb-469f-a165-708677289501');
  });

  it('Customize hace la copia en Templates y la abre; sin permiso para crear, apagado con el porqué', async () => {
    const { device } = await setup();
    const page = await device.tree.create(null, '');
    const host = await open(device, page);
    click([...host.querySelectorAll('.template-chip')].find((b) => b.textContent === 'More…'));
    await waitFor(() => dialog('Templates'));
    const customize = dialog('Templates')!.querySelector<HTMLButtonElement>('[data-customize="shot"]')!;
    expect(customize.dataset.tip).toBe("Makes your own copy in this project's Templates folder, to change it");
    click(customize);
    await waitFor(() => location.pathname !== '/');
    const folder = templatesFolderOf(device.tree, device.tree.workspaceId)!;
    const [made] = device.tree.children(folder.id);
    expect(location.pathname).toBe(`/p/${made.id}`);
    expect(made.title).toBe('Shot Breakdown');
    expect(made.template_id).toBe(BUILTIN_IDS.shot);
    // La página de antes quedó como estaba.
    expect(device.tree.get(page)?.template_id ?? null).toBeNull();
  });

  it('una propia a medio bajar no se copia: avisa con Wait y Use built-in (que usa la de fábrica de la que salió)', async () => {
    const { device } = await setup();
    const tpl = await customizeBuiltin(deps(device), 'shot', device.tree.workspaceId, 'en');
    // El motor dice que a la plantilla le falta algo del servidor y no se puede bajar ahora (sin red).
    const engine = Object.create(device.engine) as Device['engine'];
    engine.isMissingContent = async (id: string) => (id === tpl ? true : device.engine.isMissingContent(id));
    engine.prefetchPage = async (id: string, ms?: number) => (id === tpl ? false : device.engine.prefetchPage(id, ms));
    const svc = { ...services(device), engine };
    const page = await device.tree.create(null, '');
    const host = await open(device, page, svc);
    click([...host.querySelectorAll('.template-chip')].find((b) => b.textContent === 'More…'));
    await waitFor(() => dialog('Templates'));
    click([...dialog('Templates')!.querySelectorAll(`[data-template-page="${tpl}"] button`)].find((b) => b.textContent === 'Use'));
    await waitFor(() => dialog('Templates')?.querySelector('.templates-waiting'));
    const waiting = dialog('Templates')!.querySelector('.templates-waiting')!;
    expect(waiting.textContent).toContain("This template hasn't finished downloading.");
    // Nada se copió.
    expect(device.tree.get(page)?.template_id ?? null).toBeNull();
    click([...waiting.querySelectorAll('button')].find((b) => b.textContent === 'Wait'));
    await wait(30);
    expect(dialog('Templates')!.querySelector('.templates-waiting')!.textContent).toContain('Waiting for the template to download');
    // Mientras espera, se elige la de fábrica.
    const builtinUse = [...dialog('Templates')!.querySelectorAll('[data-template="shot"] button')].find((b) => b.textContent === 'Use');
    click(builtinUse);
    await waitFor(() => device.tree.get(page)?.template_id === BUILTIN_IDS.shot);
  });
});

describe('el globito del reporte del día con plantillas propias (6.3)', () => {
  it('con una de reporte propia sale el selector; elegirla crea el reporte con ella y la carpeta la anota', async () => {
    const { device } = await setup();
    const home = device.tree.workspaceId;
    const folder = await device.tree.create(null, 'Reportes');
    const plan = await planDayReport(deps(device), { parentId: folder, projectId: home });
    const first = await createDayReport(deps(device), plan, { ...plan.suggestion, location: 'Estancia' }, 'en', { canMark: true });
    const tpl = await customizeBuiltin(deps(device), 'onset', home, 'en');
    await device.tree.rename(tpl, 'ERSO report');
    const host = await open(device, first);
    click(host.querySelector('.day-report-button'));
    const popover = () => document.querySelector<HTMLFormElement>('.day-report-popover');
    await waitFor(() => popover()?.querySelector('select'));
    const select = popover()!.querySelector('select')!;
    expect([...select.options].map((o) => o.textContent)).toEqual(['On-Set Report', 'ERSO report']);
    expect(select.value).toBe('');
    setValue(select, tpl);
    await waitFor(() => !select.disabled);
    // Mañana (hoy ya tiene uno).
    const date = popover()!.querySelector<HTMLInputElement>('input[type="date"]')!;
    const [y, m, d] = date.value.split('-').map(Number);
    const next = new Date(y, m - 1, d + 1, 12);
    setValue(date, `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`);
    act(() => popover()!.requestSubmit());
    await waitFor(() => device.tree.children(folder).length === 2);
    const made = device.tree.children(folder).at(-1)!;
    expect(made.template_id).toBe(tpl);
    expect(folderTemplateId(device.tree, folder)).toBe(tpl);
    expect(await pageText(device, made.id)).toContain('Estancia');
  });

  it('sin plantillas propias no hay selector; si la de la carpeta no se ve, avisa y usa la de fábrica', async () => {
    const { device } = await setup();
    const home = device.tree.workspaceId;
    const folder = await device.tree.create(null, 'Reportes');
    const plan = await planDayReport(deps(device), { parentId: folder, projectId: home });
    const first = await createDayReport(deps(device), plan, plan.suggestion, 'en', { canMark: true });
    await device.tree.setSetting(folder, 'dayReports', { template: crypto.randomUUID() });
    const host = await open(device, first);
    click(host.querySelector('.day-report-button'));
    const popover = () => document.querySelector<HTMLFormElement>('.day-report-popover');
    await waitFor(() => popover() && !popover()!.textContent!.includes('Reading the previous report'));
    expect(popover()!.querySelector('select')).toBeNull();
    expect(popover()!.textContent).toContain("The report template isn't shared with you; using On-Set Report");
    expect(device.tree.get(first)?.template_id).toBe(BUILTIN_ONSET);
  });
});
