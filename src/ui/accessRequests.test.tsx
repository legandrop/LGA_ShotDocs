// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { settled } from '../test/settle';
import { t } from '../i18n';
import { prefs } from '../prefs';
import { ServicesContext, type Services } from '../services';
import { AccessRequestsInbox } from '../sync/accessRequests';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { ShareRequests } from './AccessRequests';
import { MentionsBell } from './MentionsBell';
import { resetTitleBadge } from './titleBadge';

// Los pedidos de acceso en la interfaz (P.30, entrega 2; Docs/Doc_Links_PDF.md, 5.3): la sección de la campana con su
// número, la ventana de decidir (la página donde se agregó primero y Ver por defecto; rechazar es otro botón, LF20) y
// los pedidos en *Share* de la página, con esa página elegida. Contra el servidor en memoria.

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
});

const CLIENTA = '00000000-0000-4000-8000-0000000000a3';
const FILE = '00000000-0000-4000-8000-0000000000f1';

const roots: Root[] = [];
const devices: Device[] = [];
const inboxes: AccessRequestsInbox[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const i of inboxes.splice(0)) i.stop();
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.mentions.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  document.body.innerHTML = '';
});

function services(d: Device, userId: string, accessRequests?: AccessRequestsInbox): Services {
  const config = {
    url: 'https://znlvpuddswymxpffgvbz.supabase.co',
    publishableKey: 'sb_publishable_test',
    name: 'Wanka',
    localKey: WANKA_LOCAL_KEY,
    storage: legacyStorageNames(WANKA_LOCAL_KEY),
  };
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
    mentions: d.mentions,
    accessRequests,
    sizes: d.sizes,
    offline: d.offline,
    shutdown: async () => undefined,
  };
}

// El rato pedido y, después, a que termine lo que quedó en marcha (src/test/settle.ts).
const wait = (ms = 60) => act(() => settled(ms));

async function mount(value: Services, node: React.ReactNode): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<ServicesContext.Provider value={value}>{node}</ServicesContext.Provider>));
  await wait();
  return host;
}

function button(text: string, within: ParentNode = document): HTMLButtonElement {
  const b = [...within.querySelectorAll('button')].find((x) => x.textContent === text);
  if (!b) throw new Error(`falta el botón ${text}`);
  return b as HTMLButtonElement;
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => el.click());
  await wait();
}

/** El dueño con dos páginas (Escena 12 y Reporte, en ese orden) que usan el mismo archivo, y una clienta que lo pide. */
async function setup(options: { clean?: boolean } = {}) {
  const server = new FakeServer();
  server.enableMentions();
  if (options.clean) server.enableClean();
  server.addMember(CLIENTA, 'guest', 'clienta@cliente.com');
  const owner = await makeDevice(server);
  devices.push(owner);
  const scene = await owner.tree.create(null, 'Escena 12');
  const report = await owner.tree.create(null, 'Reporte');
  await owner.engine.syncNow();
  const project = server.pages.get(scene)!.workspace_id;
  server.mediaFiles.set(FILE, {
    id: FILE,
    name: 'plano.pdf',
    mime: 'application/pdf',
    width: null,
    height: null,
    duration: null,
    thumb_at: null,
    drive_id: 'd1',
    project_id: project,
    size: 10,
  });
  server.pageFiles.add(`${scene}:${FILE}`);
  server.pageFiles.add(`${report}:${FILE}`);
  const guest = await makeDevice(server, undefined, undefined, undefined, undefined, { id: CLIENTA });
  devices.push(guest);
  expect(await guest.remote.requestAccess(FILE)).toBe('sent');
  const inbox = new AccessRequestsInbox(owner.remote.accessRequestsRemote(), { online: () => server.online });
  inboxes.push(inbox);
  inbox.setEnabled(true);
  await act(async () => inbox.poll());
  return { server, owner, guest, scene, report, inbox };
}

describe('la campana con pedidos de acceso', () => {
  it('suma el pedido al número; Review abre la ventana y Give access da Ver en la primera página', async () => {
    const { server, owner, scene, inbox } = await setup();
    const host = await mount(services(owner, server.ownerId, inbox), <MentionsBell />);
    const bell = host.querySelector<HTMLButtonElement>('.mentions-bell')!;
    expect(bell.querySelector('.mentions-count')?.textContent).toBe('1');
    expect(bell.getAttribute('data-tip')).toBe(`${t('mentions.title')} · ${t('requests.count', { count: 1 })}`);
    await click(bell);
    const section = document.querySelector(`section[aria-label="${t('requests.title')}"]`)!;
    expect(section.textContent).toContain(t('requests.asks', { email: 'clienta@cliente.com', file: 'plano.pdf' }));
    expect(section.textContent).toContain(t('role.guest'));
    await click(button(t('requests.review'), section));
    // La campana se cierra y queda la ventana de decidir.
    expect(document.querySelector('.mentions-panel')).toBeNull();
    const dialog = document.querySelector<HTMLElement>('.modal[role="dialog"]')!;
    const [page, level] = [...dialog.querySelectorAll('select')];
    expect(page.value).toBe(scene);
    expect([...page.options].map((o) => o.textContent)).toEqual(['Escena 12', 'Reporte']);
    expect(level.value).toBe('view');
    expect(dialog.textContent).toContain(t('requests.scope'));
    await click(button(t('requests.give'), dialog));
    expect(server.grants.find((g) => g.user_id === CLIENTA)).toMatchObject({ page_id: scene, level: 'view' });
    expect(server.accessRequests[0]).toMatchObject({ state: 'accepted', page_id: scene, level: 'view', decided_by: server.ownerId });
    expect(document.querySelector('.modal[role="dialog"]')).toBeNull();
    expect(bell.querySelector('.mentions-count')).toBeNull();
    expect(inbox.getSnapshot().items).toEqual([]);
  });

  it('Decline rechaza sin dar nada; Cancel no decide', async () => {
    const { server, owner, inbox } = await setup();
    const host = await mount(services(owner, server.ownerId, inbox), <MentionsBell />);
    await click(host.querySelector<HTMLButtonElement>('.mentions-bell')!);
    await click(button(t('requests.review')));
    await click(button(t('common.cancel'), document.querySelector('.modal')!));
    expect(server.accessRequests[0].state).toBe('pending');
    await click(host.querySelector<HTMLButtonElement>('.mentions-bell')!);
    await click(button(t('requests.review')));
    await click(button(t('requests.decline'), document.querySelector('.modal')!));
    expect(server.accessRequests[0]).toMatchObject({ state: 'declined', page_id: null });
    expect(server.grants.some((g) => g.user_id === CLIENTA)).toBe(false);
  });

  it('ya decidido por otro: lo dice y sale de la lista', async () => {
    const { server, owner, inbox } = await setup();
    const host = await mount(services(owner, server.ownerId, inbox), <MentionsBell />);
    await click(host.querySelector<HTMLButtonElement>('.mentions-bell')!);
    await click(button(t('requests.review')));
    server.accessRequests[0].state = 'declined';
    await click(button(t('requests.give'), document.querySelector('.modal')!));
    expect(document.querySelector('.modal')?.textContent).toContain(t('teamError.requestNotFound'));
    expect(server.grants.some((g) => g.user_id === CLIENTA)).toBe(false);
    expect(inbox.getSnapshot().items).toEqual([]);
  });

  it('sin red no se decide', async () => {
    const { server, owner, inbox } = await setup();
    const host = await mount(services(owner, server.ownerId, inbox), <MentionsBell />);
    await click(host.querySelector<HTMLButtonElement>('.mentions-bell')!);
    await click(button(t('requests.review')));
    server.online = false;
    await act(async () => owner.engine.syncNow().catch(() => undefined));
    await wait();
    const dialog = document.querySelector('.modal')!;
    expect(dialog.textContent).toContain(t('requests.offline'));
    expect(button(t('requests.give'), dialog).disabled).toBe(true);
    expect(button(t('requests.decline'), dialog).disabled).toBe(true);
  });

  it('sin la lista (base vieja, invitado, link): la campana es la de siempre', async () => {
    const { server, owner } = await setup();
    const host = await mount(services(owner, server.ownerId, undefined), <MentionsBell />);
    const bell = host.querySelector<HTMLButtonElement>('.mentions-bell')!;
    expect(bell.querySelector('.mentions-count')).toBeNull();
    await click(bell);
    expect(document.querySelector(`section[aria-label="${t('requests.title')}"]`)).toBeNull();
    // Solo menciones: el título de siempre y sin rótulos por parte.
    const panel = document.querySelector<HTMLElement>('.mentions-panel')!;
    expect(panel.getAttribute('aria-label')).toBe(t('mentions.title'));
    expect(panel.querySelector('h2')?.textContent).toBe(t('mentions.title'));
    expect(panel.querySelectorAll('h3')).toHaveLength(0);
  });

  it('con pedidos arriba, el panel se titula con las dos cosas y cada parte lleva su rótulo (restos, sección 19)', async () => {
    const { server, owner, inbox } = await setup();
    const host = await mount(services(owner, server.ownerId, inbox), <MentionsBell />);
    await click(host.querySelector<HTMLButtonElement>('.mentions-bell')!);
    const panel = document.querySelector<HTMLElement>('.mentions-panel')!;
    expect(panel.getAttribute('aria-label')).toBe(t('mentions.titleWithRequests'));
    expect(panel.querySelector('h2')?.textContent).toBe('Access requests and mentions');
    expect([...panel.querySelectorAll('h3')].map((h) => h.textContent)).toEqual([t('requests.title'), t('mentions.title')]);
    act(() => prefs.set({ language: 'es' }));
    try {
      expect(panel.querySelector('h2')?.textContent).toBe('Pedidos de acceso y menciones');
    } finally {
      act(() => prefs.set({ language: 'en' }));
    }
  });
});

describe('el número fuera de la app (O3 b de la auditoría)', () => {
  it('el título de la pestaña suma los pedidos', async () => {
    resetTitleBadge();
    document.title = 'Shot Docs';
    const { server, owner, inbox } = await setup();
    await mount(services(owner, server.ownerId, inbox), <MentionsBell />);
    expect(document.title).toBe('(1) Shot Docs');
    resetTitleBadge();
  });
});

describe('dar acceso con la privacidad de lo borrado prendida (useShareGate, D14; O3 a de la auditoría)', () => {
  it('no se pudo subir lo pendiente: avisa con Retry y Share anyway y no da acceso; Share anyway lo da', async () => {
    const { server, owner, scene, inbox } = await setup({ clean: true });
    expect(owner.engine.getStatus().cleanOn).toBe(true);
    const upload = vi.spyOn(owner.engine, 'uploadPagesFirst').mockResolvedValue(false);
    const host = await mount(services(owner, server.ownerId, inbox), <ShareRequests pageId={scene} onDecided={() => undefined} />);
    await click(button(t('requests.review'), host));
    await click(button(t('requests.give'), host));
    const warn = host.querySelector('[role="alert"]')!;
    expect(warn.textContent).toContain('Retry');
    expect(warn.textContent).toContain('Share anyway');
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][0]).toContain(scene);
    expect(server.grants.some((g) => g.user_id === CLIENTA)).toBe(false);
    expect(server.accessRequests[0].state).toBe('pending');
    await click(button('Share anyway', warn));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(server.grants.find((g) => g.user_id === CLIENTA)).toMatchObject({ page_id: scene, level: 'view' });
  });

  it('una invitada no ve lo borrado aunque reciba Editar: también pasa por el paso previo, y después se arman las bases', async () => {
    const { server, owner, scene, inbox } = await setup({ clean: true });
    const upload = vi.spyOn(owner.engine, 'uploadPagesFirst').mockResolvedValue(true);
    const prepare = vi.spyOn(owner.engine, 'prepareBases').mockResolvedValue(undefined as never);
    const host = await mount(services(owner, server.ownerId, inbox), <ShareRequests pageId={scene} onDecided={() => undefined} />);
    await click(button(t('requests.review'), host));
    const level = host.querySelectorAll('select')[1];
    await act(async () => {
      level.value = 'edit';
      level.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await click(button(t('requests.give'), host));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(server.grants.find((g) => g.user_id === CLIENTA)).toMatchObject({ page_id: scene, level: 'edit' });
  });
});

describe('los pedidos en Share de la página', () => {
  it('solo los de archivos de esa página, con esa página elegida; Give access con Comentar', async () => {
    const { server, owner, report, inbox } = await setup();
    const decided = vi.fn();
    const host = await mount(services(owner, server.ownerId, inbox), <ShareRequests pageId={report} onDecided={decided} />);
    expect(host.textContent).toContain(t('requests.onPage'));
    await click(button(t('requests.review'), host));
    const [page, level] = [...host.querySelectorAll('select')];
    expect(page.value).toBe(report);
    await act(async () => {
      level.value = 'comment';
      level.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await click(button(t('requests.give'), host));
    expect(server.grants.find((g) => g.user_id === CLIENTA)).toMatchObject({ page_id: report, level: 'comment' });
    expect(decided).toHaveBeenCalledTimes(1);
    expect(host.textContent).toBe('');
  });

  it('una página que no usa el archivo no muestra nada', async () => {
    const { server, owner, inbox } = await setup();
    const other = await owner.tree.create(null, 'Otra');
    await owner.engine.syncNow();
    const host = await mount(services(owner, server.ownerId, inbox), <ShareRequests pageId={other} onDecided={() => undefined} />);
    expect(host.textContent).toBe('');
  });

  it('nunca baja: quien ya tenía Editar sigue con Editar', async () => {
    const { server, owner, scene, inbox } = await setup();
    const host = await mount(services(owner, server.ownerId, inbox), <ShareRequests pageId={scene} onDecided={() => undefined} />);
    await click(button(t('requests.review'), host));
    // Mientras tanto, alguien le dio Editar por Share.
    server.grant(CLIENTA, { pageId: scene }, 'edit');
    await click(button(t('requests.give'), host));
    expect(server.grants.find((g) => g.user_id === CLIENTA)).toMatchObject({ page_id: scene, level: 'edit' });
    expect(server.accessRequests[0].state).toBe('accepted');
  });
});
