// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import { LinkContext } from '../linkMode';
import { ServicesContext, type Services } from '../services';
import { AccessRequestsInbox } from '../sync/accessRequests';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { ShareRequests } from './AccessRequests';
import { MentionsBell } from './MentionsBell';
import { PageView } from './PageView';

// *Request access* para una página (P.30, entrega 3; Docs/Doc_Links_PDF.md, sección 18): la pantalla sin acceso de
// `/p/<id>` lo ofrece con la base en la 24 y es la misma exista o no la página; el pedido aparece en la campana y en
// *Share* de esa página (y de ninguna otra), y decidirlo da el permiso sobre ella, sin bajar nunca uno que ya existe.
// Contra el servidor en memoria.

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
  Element.prototype.scrollTo ??= function () {} as never;
});

const CLIENTA = '00000000-0000-4000-8000-0000000000a3';
const NOWHERE = '00000000-0000-4000-8000-0000000000ee';

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
  localStorage.clear();
});

/** Un cliente con `rpc` que va al servidor en memoria (solo lo que usa la pantalla sin acceso). */
function rpcTo(d: Device) {
  return vi.fn(async (fn: string, args: Record<string, unknown>) => {
    try {
      if (fn === 'request_page_access') return { data: await d.remote.requestPageAccess(args.p_page as string), error: null, status: 200 };
      if (fn === 'request_access') return { data: await d.remote.requestAccess(args.p_file as string), error: null, status: 200 };
      throw new Error(`rpc ${fn}`);
    } catch (err) {
      const e = err as { message: string; code?: string };
      return { data: null, error: { message: e.message, code: e.code }, status: 400 };
    }
  });
}

function services(d: Device, userId: string, accessRequests?: AccessRequestsInbox, rpc = rpcTo(d)): Services {
  const config = {
    url: 'https://znlvpuddswymxpffgvbz.supabase.co',
    publishableKey: 'sb_publishable_test',
    name: 'Wanka',
    localKey: WANKA_LOCAL_KEY,
    storage: legacyStorageNames(WANKA_LOCAL_KEY),
  };
  const client = { auth: { signOut: vi.fn() }, rpc } as never;
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

const wait = (ms = 60) => act(async () => new Promise((r) => setTimeout(r, ms)));

async function mount(value: Services, node: React.ReactNode, link: unknown = null): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      <LinkContext.Provider value={link as never}>
        <ServicesContext.Provider value={value}>{node}</ServicesContext.Provider>
      </LinkContext.Provider>,
    ),
  );
  await wait();
  return host;
}

function button(text: string, within: ParentNode = document): HTMLButtonElement {
  const b = [...within.querySelectorAll('button')].find((x) => x.textContent === text);
  if (!b) throw new Error(`falta el botón ${text}`);
  return b as HTMLButtonElement;
}

function hasButton(text: string, within: ParentNode = document): boolean {
  return [...within.querySelectorAll('button')].some((x) => x.textContent === text);
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => el.click());
  await wait();
}

/** El dueño con Escena 12 › Toma 1 y Reporte; una clienta (invitada) sin acceso, con la base en `schema`. */
async function setup(schema = 24) {
  const server = new FakeServer();
  server.enableMentions();
  server.settings = { ...server.settings!, schemaVersion: schema };
  server.addMember(CLIENTA, 'guest', 'clienta@cliente.com');
  const owner = await makeDevice(server);
  devices.push(owner);
  const scene = await owner.tree.create(null, 'Escena 12');
  const shot = await owner.tree.create(scene, 'Toma 1');
  const report = await owner.tree.create(null, 'Reporte');
  await owner.engine.syncNow();
  const guest = await makeDevice(server, undefined, undefined, undefined, undefined, { id: CLIENTA });
  devices.push(guest);
  await guest.engine.syncNow();
  const inbox = new AccessRequestsInbox(owner.remote.accessRequestsRemote(), { online: () => server.online });
  inboxes.push(inbox);
  inbox.setEnabled(true);
  return { server, owner, guest, scene, shot, report, inbox };
}

describe('la pantalla sin acceso de una página', () => {
  it('con la base en la 24: la misma pantalla exista o no la página, y Request access avisa antes de mandar', async () => {
    const { server, guest, scene } = await setup();
    const none = await mount(services(guest, CLIENTA), <PageView id={NOWHERE} />);
    const html = none.innerHTML;
    expect(none.textContent).toContain(t('page.notFound'));
    expect(hasButton(t('file.request'), none)).toBe(true);
    const real = await mount(services(guest, CLIENTA), <PageView id={scene} />);
    // Ni el título ni nada de la página: la misma pantalla.
    expect(real.innerHTML).toBe(html);
    expect(real.textContent).not.toContain('Escena 12');

    await click(button(t('file.request'), real));
    expect(real.textContent).toContain(t('page.requestNote'));
    expect(server.accessRequests).toEqual([]);
    await click(button(t('file.request'), real));
    expect(real.textContent).toContain(t('page.requestSent'));
    expect(server.accessRequests).toEqual([expect.objectContaining({ user_id: CLIENTA, file_id: null, target_page_id: scene, state: 'pending' })]);
    // La inexistente también responde «enviado» (y deja su fila, que no ve nadie).
    await click(button(t('file.request'), none));
    await click(button(t('file.request'), none));
    expect(none.textContent).toContain(t('page.requestSent'));
    expect(server.accessRequests.find((r) => r.target_page_id === NOWHERE)?.state).toBe('void');
  });

  it('el dispositivo recuerda cuándo lo pidió, por página', async () => {
    const { guest, scene, report } = await setup();
    const first = await mount(services(guest, CLIENTA), <PageView id={scene} />);
    await click(button(t('file.request'), first));
    await click(button(t('file.request'), first));
    const again = await mount(services(guest, CLIENTA), <PageView id={scene} />);
    expect(again.textContent).toMatch(t('file.requestedOn', { date: '' }).replace(/\.$/, ''));
    expect(hasButton(t('file.requestAgain'), again)).toBe(true);
    const other = await mount(services(guest, CLIENTA), <PageView id={report} />);
    expect(hasButton(t('file.request'), other)).toBe(true);
  });

  it('sin el botón: base en la 23, sin red, con un link público, o todavía buscando', async () => {
    const old = await setup(23);
    const host = await mount(services(old.guest, CLIENTA), <PageView id={old.scene} />);
    expect(host.textContent).toContain(t('page.notFound'));
    expect(hasButton(t('file.request'), host)).toBe(false);

    const { server, guest, scene } = await setup();
    const linked = await mount(services(guest, CLIENTA), <PageView id={scene} />, { entry: { localKey: WANKA_LOCAL_KEY } });
    expect(hasButton(t('file.request'), linked)).toBe(false);
    server.online = false;
    await act(async () => guest.engine.syncNow().catch(() => undefined));
    const offline = await mount(services(guest, CLIENTA), <PageView id={scene} />);
    expect(offline.textContent).toContain(t('page.notFound'));
    expect(hasButton(t('file.request'), offline)).toBe(false);
  });

  it('si ya tiene acceso (el árbol todavía no llegó), sincroniza en vez de pedir y la página se abre', async () => {
    const { server, guest, scene } = await setup();
    server.grant(CLIENTA, { pageId: scene }, 'view');
    const sync = vi.spyOn(guest.engine, 'syncNow');
    const host = await mount(services(guest, CLIENTA), <PageView id={scene} />);
    await click(button(t('file.request'), host));
    await click(button(t('file.request'), host));
    expect(sync).toHaveBeenCalled();
    expect(server.accessRequests).toEqual([]);
    await wait(200);
    expect(host.querySelector<HTMLTextAreaElement>('textarea.page-title')?.value).toBe('Escena 12');
  });

  it('el tope de pedidos por día lo dice', async () => {
    const { guest, scene } = await setup();
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'rate_limited', code: 'P0001' }, status: 400 }));
    const host = await mount(services(guest, CLIENTA, undefined, rpc), <PageView id={scene} />);
    await click(button(t('file.request'), host));
    await click(button(t('file.request'), host));
    expect(rpc).toHaveBeenCalledWith('request_page_access', { p_page: scene });
    expect(host.textContent).toContain(t('file.requestLimited'));
  });
});

describe('quien decide un pedido de página', () => {
  it('la campana lo muestra con la página; Give access da Ver sobre ella y nada más', async () => {
    const { server, owner, guest, scene, inbox } = await setup();
    expect(await guest.remote.requestPageAccess(scene)).toBe('sent');
    await act(async () => inbox.poll());
    const host = await mount(services(owner, server.ownerId, inbox), <MentionsBell />);
    const bell = host.querySelector<HTMLButtonElement>('.mentions-bell')!;
    expect(bell.querySelector('.mentions-count')?.textContent).toBe('1');
    await click(bell);
    const section = document.querySelector(`section[aria-label="${t('requests.title')}"]`)!;
    expect(section.textContent).toContain(t('requests.asksPage', { email: 'clienta@cliente.com', page: 'Escena 12' }));
    await click(button(t('requests.review'), section));
    const dialog = document.querySelector<HTMLElement>('.modal[role="dialog"]')!;
    // Una sola página: sin lista para elegir, solo el nivel.
    const selects = [...dialog.querySelectorAll('select')];
    expect(selects).toHaveLength(1);
    expect(selects[0].value).toBe('view');
    expect(dialog.querySelector('.access-request-page')?.textContent).toBe('Escena 12');
    await click(button(t('requests.give'), dialog));
    expect(server.grants.filter((g) => g.user_id === CLIENTA)).toEqual([expect.objectContaining({ page_id: scene, level: 'view' })]);
    expect(server.accessRequests[0]).toMatchObject({ state: 'accepted', page_id: scene, target_page_id: scene, level: 'view' });
    expect(bell.querySelector('.mentions-count')).toBeNull();
  });

  it('en Share solo de esa página (no de la de abajo ni de otra); Decline no da nada', async () => {
    const { server, owner, guest, scene, shot, report, inbox } = await setup();
    await guest.remote.requestPageAccess(scene);
    await act(async () => inbox.poll());
    const below = await mount(services(owner, server.ownerId, inbox), <ShareRequests pageId={shot} onDecided={() => undefined} />);
    expect(below.textContent).toBe('');
    const other = await mount(services(owner, server.ownerId, inbox), <ShareRequests pageId={report} onDecided={() => undefined} />);
    expect(other.textContent).toBe('');
    const decided = vi.fn();
    const host = await mount(services(owner, server.ownerId, inbox), <ShareRequests pageId={scene} onDecided={decided} />);
    expect(host.textContent).toContain(t('requests.onPage'));
    expect(host.textContent).toContain(t('requests.asksPage', { email: 'clienta@cliente.com', page: 'Escena 12' }));
    await click(button(t('requests.review'), host));
    await click(button(t('requests.decline'), host));
    expect(server.accessRequests[0]).toMatchObject({ state: 'declined', page_id: null });
    expect(server.grants.some((g) => g.user_id === CLIENTA)).toBe(false);
    expect(decided).toHaveBeenCalledTimes(1);
  });

  it('nunca baja: quien ya tenía Editar sigue con Editar', async () => {
    const { server, owner, guest, scene, inbox } = await setup();
    await guest.remote.requestPageAccess(scene);
    await act(async () => inbox.poll());
    const host = await mount(services(owner, server.ownerId, inbox), <ShareRequests pageId={scene} onDecided={() => undefined} />);
    await click(button(t('requests.review'), host));
    server.grant(CLIENTA, { pageId: scene }, 'edit');
    await click(button(t('requests.give'), host));
    expect(server.grants.find((g) => g.user_id === CLIENTA)).toMatchObject({ page_id: scene, level: 'edit' });
    expect(server.accessRequests[0].state).toBe('accepted');
  });

  it('lo que no vale no aparece: una página que no existe, una de la papelera, y quien ya la ve', async () => {
    const { server, owner, guest, report, inbox } = await setup();
    expect(await guest.remote.requestPageAccess(NOWHERE)).toBe('sent');
    server.pages.get(report)!.deleted_at = new Date().toISOString();
    expect(await guest.remote.requestPageAccess(report)).toBe('sent');
    expect(server.accessRequests.map((r) => r.state)).toEqual(['void', 'void']);
    expect(await owner.remote.requestPageAccess(report)).toBe('has_access');
    await act(async () => inbox.poll());
    expect(inbox.getSnapshot().items).toEqual([]);
  });
});
