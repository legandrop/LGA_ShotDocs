// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LinkContext, type LinkInfo } from '../linkMode';
import { ServicesContext, type Services } from '../services';
import type { PublicLinkInfo } from '../sync/publicLinks';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { LINK_PAGE_CONFIRM_MS, LINK_PAGES_EVERY_MS, LINK_PAGES_PER_ROUND, LinkPagesStore, type LinkPagesPerms } from './linkPages';
import { LinkShare } from './LinkShare';
import { LinkTreeIcon } from './LinkTreeIcon';

// El ícono del árbol de las páginas con un link público propio (Docs/Doc_Link_Publico.md, 3.11): quién lo ve lo decide
// la base (`get_public_link` contesta solo a quien puede compartir la página), y del link no se guarda el token.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const devices: Device[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
  }
  document.body.innerHTML = '';
});

function info(over: Partial<NonNullable<PublicLinkInfo['link']>> = {}): PublicLinkInfo {
  return {
    clean_on: true,
    above: null,
    link: {
      id: 'l1', page_id: 'p', level: 'comment', created_at: '2026-10-02T10:00:00Z', expires_at: null, created_by_name: 'lega',
      token: 'sdl_' + 's'.repeat(43), alive: true, usage_today: {}, limited: false, comments: 0, ...over,
    },
  };
}

/** La base, en memoria: qué páginas lista `public_link_pages` y qué contesta `get_public_link` de cada una. */
function fakeApi(listed: string[], answers: Record<string, PublicLinkInfo | null>) {
  const asked: string[] = [];
  return {
    asked,
    listed,
    answers,
    pages: async () => {
      asked.push('pages');
      return [...listed];
    },
    link: async (pageId: string): Promise<PublicLinkInfo | null> => {
      asked.push(pageId);
      return answers[pageId] ?? null;
    },
  };
}

const engine = (online = true, schemaVersion = 14) => ({ subscribe: () => () => undefined, getStatus: () => ({ online, schemaVersion }) });
const perms = (over: Partial<LinkPagesPerms> = {}): (() => LinkPagesPerms) => () => ({ known: true, role: 'owner', canSharePage: () => true, ...over });

describe('las páginas con un link público propio (el ícono del árbol)', () => {
  it('marca solo la página que la base confirma a quien la comparte: una listada cuyo Share no contesta queda sin marca', async () => {
    const api = fakeApi(['a', 'b'], { a: info({ level: 'edit' }), b: null });
    const store = new LinkPagesStore(api, engine(), perms());
    await store.refresh();
    expect([...store.get().keys()]).toEqual(['a']);
    expect(store.get().get('a')).toEqual({ level: 'edit', createdBy: 'lega', alive: true });
    expect(api.asked).toEqual(['pages', 'a', 'b']);
  });

  it('del link guarda el nivel, quién lo creó y si anda: nunca el token', async () => {
    const api = fakeApi(['a'], { a: info({ alive: false, created_by_name: null }) });
    const store = new LinkPagesStore(api, engine(), perms());
    await store.refresh();
    expect(store.get().get('a')).toEqual({ level: 'comment', createdBy: null, alive: false });
    expect(JSON.stringify([...store.get()])).not.toContain('sdl_');
  });

  it('sin saber los permisos, para un invitado, sin red o con una base anterior a los links no pregunta nada', async () => {
    for (const [e, p] of [
      [engine(), perms({ known: false })],
      [engine(), perms({ role: 'guest' })],
      [engine(), perms({ role: null })],
      [engine(false), perms()],
      [engine(true, 13), perms()],
    ] as const) {
      const api = fakeApi(['a'], { a: info() });
      const store = new LinkPagesStore(api, e, p);
      await store.refresh();
      expect(api.asked).toEqual([]);
      expect(store.get().size).toBe(0);
    }
  });

  it('una página que la app sabe que la persona no puede compartir no se pregunta ni se marca', async () => {
    const api = fakeApi(['a', 'b'], { a: info(), b: info() });
    const store = new LinkPagesStore(api, engine(), perms({ canSharePage: (id) => id === 'a' }));
    await store.refresh();
    expect(api.asked).toEqual(['pages', 'a']);
    expect([...store.get().keys()]).toEqual(['a']);
  });

  it('pide la lista como mucho cada dos minutos y vuelve a confirmar cada página cada diez; una que ya no tiene link pierde la marca', async () => {
    let now = 1_000_000;
    const api = fakeApi(['a', 'b'], { a: info(), b: info() });
    const store = new LinkPagesStore(api, engine(), perms(), () => now);
    await store.refresh();
    expect(api.asked).toEqual(['pages', 'a', 'b']);
    now += LINK_PAGES_EVERY_MS - 1;
    await store.refresh();
    expect(api.asked).toHaveLength(3);
    // Pasado el plazo: la lista sí, las páginas ya confirmadas todavía no; la que salió de la lista se va.
    now += 1;
    api.listed.splice(1, 1);
    await store.refresh();
    expect(api.asked.slice(3)).toEqual(['pages']);
    expect([...store.get().keys()]).toEqual(['a']);
    // A los diez minutos de confirmada se vuelve a preguntar: si la base ya no contesta (dejó de poder compartirla), se va.
    now += LINK_PAGE_CONFIRM_MS;
    api.answers.a = null;
    await store.refresh();
    expect(api.asked.slice(4)).toEqual(['pages', 'a']);
    expect(store.get().size).toBe(0);
  });

  it('con muchas páginas confirma de a tandas y sigue en la vuelta siguiente sin esperar el plazo', async () => {
    const ids = Array.from({ length: LINK_PAGES_PER_ROUND + 3 }, (_, i) => `p${i}`);
    const api = fakeApi(ids, Object.fromEntries(ids.map((id) => [id, info()])));
    const store = new LinkPagesStore(api, engine(), perms());
    await store.refresh();
    expect(store.get().size).toBe(LINK_PAGES_PER_ROUND);
    await store.refresh();
    expect(store.get().size).toBe(ids.length);
    expect(api.asked.filter((a) => a !== 'pages')).toHaveLength(ids.length);
  });

  it('lo que Share acaba de leer cambia la marca en el acto, y avisa a quien la mira', async () => {
    const api = fakeApi([], {});
    const store = new LinkPagesStore(api, engine(), perms());
    const seen = vi.fn();
    const stop = store.subscribe(seen);
    await store.refresh();
    seen.mockClear();
    store.learn('a', info({ level: 'edit' }));
    expect(store.get().get('a')?.level).toBe('edit');
    expect(seen).toHaveBeenCalledTimes(1);
    store.learn('a', { clean_on: true, link: null, above: null });
    expect(store.get().has('a')).toBe(false);
    // `null`: la base dice que esta sesión no puede compartir la página.
    store.learn('a', info());
    store.learn('a', null);
    expect(store.get().has('a')).toBe(false);
    stop();
  });

  it('un pedido que falla a mitad de la vuelta deja lo ya confirmado, y se reintenta recién pasado el plazo', async () => {
    let now = 1_000_000;
    const api = fakeApi(['a', 'b'], { a: info(), b: info() });
    const link = api.link;
    api.link = async (id: string) => {
      if (id === 'b') throw new TypeError('Failed to fetch');
      return link(id);
    };
    const store = new LinkPagesStore(api, engine(), perms(), () => now);
    await store.refresh();
    expect([...store.get().keys()]).toEqual(['a']);
    api.link = link;
    const asked = api.asked.length;
    now += LINK_PAGES_EVERY_MS - 1;
    await store.refresh();
    expect(api.asked).toHaveLength(asked);
    now += 1;
    await store.refresh();
    expect([...store.get().keys()]).toEqual(['a', 'b']);
  });

  it('si la lista no llega (sin red, el servidor caído), cada aviso de la sincronización no repite el pedido: espera el plazo', async () => {
    let now = 1_000_000;
    const api = fakeApi(['a'], { a: info() });
    const pages = api.pages;
    let failures = 0;
    api.pages = async () => {
      failures += 1;
      throw new TypeError('Failed to fetch');
    };
    const store = new LinkPagesStore(api, engine(), perms(), () => now);
    for (let i = 0; i < 5; i++) await store.refresh();
    expect(failures).toBe(1);
    now += LINK_PAGES_EVERY_MS - 1;
    await store.refresh();
    expect(failures).toBe(1);
    now += 1;
    api.pages = pages;
    await store.refresh();
    expect([...store.get().keys()]).toEqual(['a']);
  });

  it('un link vencido no lleva marca, ni por la lista ni por lo que lee Share; uno sin vencer que no anda, sí (de aviso)', async () => {
    const now = Date.parse('2026-10-06T12:00:00Z');
    const past = '2026-10-05T23:59:59Z';
    const future = '2026-10-20T23:59:59Z';
    const api = fakeApi(['a', 'b', 'c'], { a: info({ expires_at: past, alive: false }), b: info({ expires_at: future }), c: info({ expires_at: null, alive: false }) });
    const store = new LinkPagesStore(api, engine(), perms(), () => now);
    await store.refresh();
    expect([...store.get().keys()]).toEqual(['b', 'c']);
    expect(store.get().get('c')?.alive).toBe(false);
    // Abrir Share de una página con el link vencido no hace aparecer el ícono.
    store.learn('d', info({ expires_at: past, alive: false }));
    expect(store.get().has('d')).toBe(false);
    // Y si el que estaba marcado venció, al leerlo se va.
    store.learn('b', info({ expires_at: past, alive: false }));
    expect(store.get().has('b')).toBe(false);
  });

  it('si el rol baja a invitado (o sacan a la persona) con la app abierta, se vacía todo en el acto y una vuelta en viaje no escribe nada', async () => {
    const api = fakeApi(['a', 'b'], { a: info(), b: info() });
    let role: LinkPagesPerms['role'] = 'admin';
    let permsChanged: () => void = () => undefined;
    const store = new LinkPagesStore(api, engine(), () => ({ known: true, role, canSharePage: () => true }), Date.now, (fn) => {
      permsChanged = fn;
      return () => undefined;
    });
    const seen = vi.fn();
    const stop = store.subscribe(seen);
    await store.refresh();
    expect(store.get().size).toBe(2);
    seen.mockClear();
    role = 'guest';
    permsChanged();
    expect(store.get().size).toBe(0);
    expect(seen).toHaveBeenCalledTimes(1);
    // Vuelve a ser admin y arranca una vuelta; a mitad de camino lo sacan: lo que contesta la base después no se guarda.
    role = 'admin';
    let release: () => void = () => undefined;
    const pages = api.pages;
    api.pages = async () => {
      await new Promise<void>((r) => (release = r));
      return pages();
    };
    const round = store.refresh();
    role = null;
    permsChanged();
    release();
    await round;
    expect(store.get().size).toBe(0);
    stop();
  });
});

// --- Montado en el árbol ---------------------------------------------------------------------------------------------

function services(d: Device, client: unknown): Services {
  const config = { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_testtesttest', name: 'Wanka', localKey: WANKA_LOCAL_KEY, storage: legacyStorageNames(WANKA_LOCAL_KEY) };
  return {
    workspace: { config, client: client as never },
    client: client as never,
    user: { id: (d.remote as unknown as { userId: string }).userId, email: 'owner@test' },
    db: d.db, tree: d.tree, docs: d.docs, files: d.files, media: d.media, engine: d.engine, access: d.access,
    remote: d.remote as unknown as SupabaseRemote, dbName: 'test', mediaDb: d.mediaDb, comments: d.comments,
    commentsDb: d.commentsDb, sizes: d.sizes, offline: d.offline, shutdown: async () => undefined,
  };
}

async function mount(value: Services, node: React.ReactNode): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<ServicesContext.Provider value={value}>{node}</ServicesContext.Provider>));
  await act(async () => new Promise((r) => setTimeout(r, 30)));
  return host;
}

async function device() {
  const server = new FakeServer();
  server.enableTeam();
  server.settings = { ...server.settings!, schemaVersion: 14 };
  const d = await makeDevice(server);
  devices.push(d);
  const withLink = await d.tree.create(null, 'Brief');
  const plain = await d.tree.create(null, 'Notas');
  const notMine = await d.tree.create(null, 'Otra');
  await d.engine.syncNow();
  return { server, d, withLink, plain, notMine };
}

/** Un cliente que contesta las dos funciones como la base: la lista, y el detalle solo de lo que la sesión comparte. */
function fakeClient(listed: string[], shareable: Record<string, PublicLinkInfo>) {
  const calls: string[] = [];
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    calls.push(fn);
    if (fn === 'public_link_pages') return { data: listed.map((page_id) => ({ page_id })), error: null, status: 200 };
    if (fn === 'get_public_link') return { data: shareable[String(args.p_page)] ?? null, error: null, status: 200 };
    return { data: null, error: { message: 'unexpected ' + fn, code: '42501' }, status: 401 };
  };
  return { client: { rpc }, calls };
}

describe('el ícono del árbol de una página con link', () => {
  it('se ve en la página con link que la persona comparte, con lo que el link deja hacer y quién lo creó; en las demás, no', async () => {
    const { d, withLink, plain, notMine } = await device();
    // La base lista dos páginas con link, pero el detalle de `notMine` no se lo da a esta sesión.
    const f = fakeClient([withLink, notMine], { [withLink]: info({ level: 'edit' }) });
    const host = await mount(
      services(d, f.client),
      <>
        <span data-row="with"><LinkTreeIcon pageId={withLink} /></span>
        <span data-row="plain"><LinkTreeIcon pageId={plain} /></span>
        <span data-row="other"><LinkTreeIcon pageId={notMine} /></span>
      </>,
    );
    const icon = host.querySelector('[data-row="with"] .tree-link')!;
    expect(icon.getAttribute('data-tip')).toBe('Anyone with the link can edit · created by lega');
    expect(icon.getAttribute('aria-label')).toBe(icon.getAttribute('data-tip'));
    expect(icon.hasAttribute('title')).toBe(false);
    expect(host.querySelector('[data-row="plain"] .tree-link')).toBeNull();
    expect(host.querySelector('[data-row="other"] .tree-link')).toBeNull();
    expect(host.innerHTML).not.toContain('sdl_');
  });

  it('un link que no anda se marca distinto y manda a Share; sin quién lo creó, no lo inventa', async () => {
    const { d, withLink } = await device();
    const f = fakeClient([withLink], { [withLink]: info({ alive: false, created_by_name: null }) });
    const host = await mount(services(d, f.client), <LinkTreeIcon pageId={withLink} />);
    const icon = host.querySelector('.tree-link')!;
    expect(icon.className).toContain('off');
    expect(icon.getAttribute('data-tip')).toBe("This page's link isn't working: see Share");
  });

  it('abrir Share de la página pone el ícono en el acto, con lo que la base le acaba de decir (sin esperar la próxima lista)', async () => {
    const { d, withLink } = await device();
    // La lista todavía no trae la página (el link se acaba de crear en otro dispositivo); `get_public_link` sí.
    const f = fakeClient([], { [withLink]: info() });
    const host = await mount(
      services(d, f.client),
      <>
        <LinkTreeIcon pageId={withLink} />
        <LinkShare pageId={withLink} onClose={() => undefined} />
      </>,
    );
    expect(host.querySelector('.tree-link')?.getAttribute('data-tip')).toBe('Anyone with the link can view and comment · created by lega');
  });

  it('otra cuenta que entra en la misma pestaña (el mismo cliente del workspace) no ve el ícono ni recibe nada de la anterior', async () => {
    const { server, d: owner, withLink } = await device();
    server.addMember('cli', 'guest', 'cliente@test');
    server.grant('cli', { pageId: withLink }, 'view');
    const guest = await makeDevice(server, undefined, undefined, undefined, undefined, { id: 'cli', email: 'cliente@test' });
    devices.push(guest);
    await guest.engine.syncNow();
    // El cliente es uno por workspace durante toda la vida de la pestaña: salir y entrar con otra cuenta no lo cambia.
    const f = fakeClient([withLink], { [withLink]: info({ level: 'edit' }) });
    const a = await mount(services(owner, f.client), <LinkTreeIcon pageId={withLink} />);
    expect(a.querySelector('.tree-link')?.getAttribute('data-tip')).toBe('Anyone with the link can edit · created by lega');
    act(() => roots.pop()!.unmount());
    await owner.engine.stop();

    f.calls.length = 0;
    const b = await mount(services(guest, f.client), <LinkTreeIcon pageId={withLink} />);
    await guest.engine.syncNow();
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    expect(b.querySelector('.tree-link')).toBeNull();
    expect(b.innerHTML).not.toContain('lega');
    // Un invitado ni pregunta.
    expect(f.calls).toEqual([]);
  });

  it('con los servicios armados de nuevo para la misma cuenta, el ícono sigue al día (pregunta de nuevo, con el motor nuevo)', async () => {
    const { server, d: first, withLink } = await device();
    const shareable = { [withLink]: info({ level: 'edit' }) };
    const f = fakeClient([withLink], shareable);
    const a = await mount(services(first, f.client), <LinkTreeIcon pageId={withLink} />);
    expect(a.querySelector('.tree-link')?.getAttribute('data-tip')).toBe('Anyone with the link can edit · created by lega');
    act(() => roots.pop()!.unmount());
    await first.engine.stop();

    // La pestaña retoma: servicios nuevos (otro motor), la misma cuenta y el mismo cliente. Mientras tanto el link cambió.
    const again = await makeDevice(server);
    devices.push(again);
    await again.engine.syncNow();
    shareable[withLink] = info({ level: 'comment' });
    f.calls.length = 0;
    const b = await mount(services(again, f.client), <LinkTreeIcon pageId={withLink} />);
    expect(f.calls).toEqual(['public_link_pages', 'get_public_link']);
    expect(b.querySelector('.tree-link')?.getAttribute('data-tip')).toBe('Anyone with the link can view and comment · created by lega');
  });

  it('a quien le bajan el rol a invitado con la app abierta se le va el ícono en la sincronización siguiente', async () => {
    const { server, d: owner, withLink } = await device();
    server.addMember('adm', 'admin', 'adm@test');
    server.grant('adm', { projectId: owner.tree.get(withLink)!.workspace_id }, 'edit_pages');
    const admin = await makeDevice(server, undefined, undefined, undefined, undefined, { id: 'adm', email: 'adm@test' });
    devices.push(admin);
    await admin.engine.syncNow();
    const f = fakeClient([withLink], { [withLink]: info() });
    const host = await mount(services(admin, f.client), <LinkTreeIcon pageId={withLink} />);
    expect(host.querySelector('.tree-link')).not.toBeNull();

    server.members.get('adm')!.role = 'guest';
    await act(async () => {
      await admin.engine.syncNow();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(host.querySelector('.tree-link')).toBeNull();
  });

  it('con la app abierta por un link no se pregunta nada ni se muestra', async () => {
    const { d, withLink } = await device();
    const f = fakeClient([withLink], { [withLink]: info() });
    const link = { entry: {}, domain: 'example.supabase.co', linkId: 'l1', pageId: withLink } as unknown as LinkInfo;
    const host = await mount(services(d, f.client), <LinkContext.Provider value={link}><LinkTreeIcon pageId={withLink} /></LinkContext.Provider>);
    expect(host.querySelector('.tree-link')).toBeNull();
    expect(f.calls).toEqual([]);
  });
});
