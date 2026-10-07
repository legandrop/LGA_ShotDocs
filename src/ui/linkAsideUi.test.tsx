// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { settled } from '../test/settle';
import { shown } from '../test/shown';
import * as Y from 'yjs';
import { LinkContext, linkDomain, type LinkEntry } from '../linkMode';
import { prefs } from '../prefs';
import { ServicesContext, type Services } from '../services';
import { block, group } from '../sync/historyTesting';
import { addPublicLink, makeLinkDevice, type LinkDevice } from '../sync/linkTesting';
import type { SupabaseRemote } from '../sync/remote';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { startedOverLateKey } from '../sync/startedOver';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { HistoryPanel } from './HistoryPanel';
import { LinkAsideTreeIcon } from './LinkAsideTreeIcon';
import { LinkShare } from './LinkShare';
import { LinkVisitorAsideNotice } from './LinkVisitorAsideNotice';

// Lo apartado a la vista, entrega 2c (Docs/Doc_Link_Publico.md), montado de verdad: la lista de *Share* (también lo de un
// link anterior) con *Download all*, la entrada *Set aside (via link)* del historial (se ve sin aplicarse), el ícono del
// árbol, y el aviso del visitante con *Show the team's version*.

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
const visitors: LinkDevice[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
  }
  for (const v of visitors.splice(0)) {
    await v.engine.stop();
    v.db.close();
  }
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const config = {
  url: 'https://znlvpuddswymxpffgvbz.supabase.co',
  publishableKey: 'sb_publishable_testtesttest',
  name: 'Wanka',
  localKey: WANKA_LOCAL_KEY,
  storage: legacyStorageNames(WANKA_LOCAL_KEY),
};

function services(d: Device, client: unknown = { rpc: async () => ({ data: null, error: null, status: 200 }), auth: {} }): Services {
  return {
    workspace: { config, client: client as never },
    client: client as never,
    user: { id: d.remote.userId, email: `${d.remote.userId}@test` },
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
  await settle();
  return host;
}
// El rato pedido y, después, a que termine lo que quedó en marcha (src/test/settle.ts).
const settle = (ms = 40) => act(() => settled(ms));
const buttonNamed = (host: HTMLElement, text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === text)!;

function shareClient(linkId: string) {
  const rpc = async (fn: string) => {
    if (fn === 'get_public_link') {
      return {
        data: {
          clean_on: true, edit_on: true, above: null,
          link: {
            id: linkId, page_id: 'x', level: 'edit', created_at: '2026-10-03T10:00:00Z', expires_at: null, created_by_name: 'owner',
            token: 'sdl_' + 'x'.repeat(43), alive: true, usage_today: {}, limited: false, comments: 0,
            edits: { waiting: 0, held: 0, aside: 1, admitted_today: 0, push_bytes_total: 10 },
          },
        },
        error: null,
        status: 200,
      };
    }
    return { data: null, error: { message: 'unexpected ' + fn, code: '42501' }, status: 401 };
  };
  return { rpc, auth: { signOut: vi.fn() } };
}

/** Un workspace con lo apartado: en Brief, una fila del link de hoy y una de un link anterior; en Notes (adentro), una. */
async function teamWithAside() {
  const server = new FakeServer();
  let clock = Date.parse('2026-10-03T10:00:00Z');
  server.now = () => clock;
  server.enableTeam();
  server.enableClean(0.001);
  server.enableLinkEdit(0.001);
  server.enableLinkAside();
  const d = await makeDevice(server);
  devices.push(d);
  const page = await d.tree.create(null, 'Brief');
  const child = await d.tree.create(page, 'Notes');
  const other = await d.tree.create(null, 'Other');
  await d.engine.syncNow();
  const doc = await d.docs.open(page);
  doc.transact(() => group(doc).push([block('b0', 'del equipo')]), 'test');
  await d.docs.flush(page);
  d.docs.close(page);
  await d.engine.syncNow();
  server.publicLinks.set('sdl_' + 'a'.repeat(43), { id: 'link-0', pageId: page, createdBy: server.ownerId, level: 'edit', revoked: true });
  server.publicLinks.set('sdl_' + 'b'.repeat(43), { id: 'link-1', pageId: page, createdBy: server.ownerId, level: 'edit' });
  const visitor = new Y.Doc();
  for (const u of server.updates.get(page)!) Y.applyUpdate(visitor, u.data);
  const sv = Y.encodeStateVector(visitor);
  group(visitor).push([block('v0', 'lo que escribió Ana')]);
  const row = Y.encodeStateAsUpdate(visitor, sv);
  const base = { author: 'Ana', device: null, appVersion: 0.01, createdAt: clock, decidedBy: null, admittedSeq: null };
  server.linkRoom.push({ ...base, id: 'r0', n: 1, linkId: 'link-0', pageId: page, clientUpdateId: 'c0', data: new Uint8Array([9]), bytes: 1, decidedAt: clock, decision: 'aside', reason: 'link_revoked' });
  server.linkRoom.push({ ...base, id: 'r1', n: 2, linkId: 'link-1', pageId: page, clientUpdateId: 'c1', data: row, bytes: row.length, decidedAt: clock, decision: 'aside', reason: 'bad_shape' });
  server.linkRoom.push({ ...base, id: 'r2', n: 3, linkId: 'link-1', pageId: child, clientUpdateId: 'c2', data: new Uint8Array([8]), bytes: 1, decidedAt: clock, decision: 'aside', reason: 'external_url' });
  clock += 60_000;
  await d.engine.syncNow();
  return { server, d, page, child, other };
}

describe('lo apartado para el equipo', () => {
  it('Share lista lo apartado de los links de la página (también del anterior) y lo baja; el árbol lo marca', async () => {
    prefs.set({ language: 'en' });
    const { d, page, child, other } = await teamWithAside();
    const saved: Blob[] = [];
    vi.stubGlobal('URL', { ...URL, createObjectURL: (b: Blob) => (saved.push(b), 'blob:x'), revokeObjectURL: () => undefined });
    const host = await mount(services(d, shareClient('link-1')), <LinkShare pageId={page} onClose={() => undefined} />);
    await settle();
    expect(host.textContent).toContain("3 changes sent through this page's link were set aside");
    const rows = [...host.querySelectorAll('.link-aside-row')].map((r) => r.textContent);
    expect(rows).toHaveLength(3);
    expect(rows.filter((t) => t!.includes('Notes'))).toHaveLength(1);
    expect(rows.find((t) => t!.includes('Notes'))).toContain('it uses a photo or an image from outside the shared pages');
    expect(rows.filter((t) => t!.includes('earlier link'))).toHaveLength(1);
    expect(rows.find((t) => t!.includes('earlier link'))).toContain('the link was reset or turned off before it was added');
    expect(rows.every((t) => t!.includes('Ana (via link)'))).toBe(true);
    await act(async () => buttonNamed(host, 'Download all').click());
    await settle();
    expect(saved).toHaveLength(1);
    const file = JSON.parse(await saved[0].text()) as { kind: string; changes: { id: string; pageTitle: string; reason: string; text: string }[] };
    expect(file.kind).toBe('lga-shotdocs-link-changes');
    expect(file.changes.map((c) => [c.id, c.pageTitle, c.reason]).sort()).toEqual([
      ['r0', 'Brief', 'link_revoked'],
      ['r1', 'Brief', 'bad_shape'],
      ['r2', 'Notes', 'external_url'],
    ]);
    expect(file.changes.find((c) => c.id === 'r1')!.text).toContain('lo que escribió Ana');
    act(() => roots.pop()!.unmount());

    // El árbol: el ícono en las páginas con algo apartado, y en ninguna otra.
    const icons = await mount(
      services(d),
      <>
        <LinkAsideTreeIcon pageId={page} />
        <LinkAsideTreeIcon pageId={child} />
        <LinkAsideTreeIcon pageId={other} />
      </>,
    );
    await settle();
    expect(icons.querySelectorAll('.tree-link-aside')).toHaveLength(2);
    expect(icons.querySelector('.tree-link-aside')!.getAttribute('data-tip')).toBe('Changes sent through a link were set aside here');
  });

  it('Share de una página sin nada apartado de sus links no muestra la lista', async () => {
    prefs.set({ language: 'en' });
    const { d, other } = await teamWithAside();
    const host = await mount(services(d, shareClient('link-9')), <LinkShare pageId={other} onClose={() => undefined} />);
    await settle();
    expect(host.querySelector('.link-aside-list')).toBeNull();
  });

  it('el historial muestra lo apartado como "Set aside (via link)" y lo deja leer sin aplicarlo', async () => {
    prefs.set({ language: 'en' });
    const { d, page, server } = await teamWithAside();
    const before = server.updates.get(page)!.length;
    const host = await mount(services(d), <HistoryPanel pageId={page} />);
    await settle(300);
    const entries = [...host.querySelectorAll('.history-aside-row')];
    expect(entries).toHaveLength(2);
    expect(entries[0].textContent).toContain('Set aside (via link)');
    expect(entries[0].textContent).toContain('Ana (via link)');
    // La de "bad_shape" (la que trae texto): se eligen de a una hasta encontrarla.
    for (const b of entries.map((e) => e.querySelector('button')!)) {
      await act(async () => b.click());
      await settle(60);
      if (host.querySelector('.history-aside-text')) break;
    }
    expect(host.querySelector('.history-aside')!.textContent).toContain("A change Ana sent through a link that couldn't be added");
    expect(host.querySelector('.history-aside-text')!.textContent).toContain('lo que escribió Ana');
    // No se ofrece restaurar lo apartado, y la página no cambió.
    expect(host.querySelector('.history-restore')).toBeNull();
    expect(server.updates.get(page)!.length).toBe(before);
  });
});

describe('el visitante vuelve a la versión del equipo', () => {
  it('el aviso de la página baja la copia y muestra la versión del equipo; lo nuevo ya no se avisa', async () => {
    prefs.set({ language: 'en' });
    const server = new FakeServer();
    let clock = Date.parse('2026-10-03T10:00:00Z');
    server.now = () => clock;
    server.enableTeam();
    server.enableClean(0.1);
    server.enableLinkEdit(0.1);
    const e1 = await makeDevice(server, undefined, '0.200');
    devices.push(e1);
    const s = await e1.tree.create(null, 'S');
    await e1.engine.syncNow();
    const doc = await e1.docs.open(s);
    doc.transact(() => group(doc).push([block('b0', 'equipo')]), 'test');
    await e1.docs.flush(s);
    e1.docs.close(s);
    await e1.engine.syncNow();
    const token = addPublicLink(server, s, server.ownerId, 'edit');
    await e1.engine.prepareBases([s]);
    const v = await makeLinkDevice(server, token, undefined, '0.200', 'Ana');
    visitors.push(v);
    await v.engine.syncNow();
    await v.engine.prefetchPage(s);
    const vdoc = await v.docs.open(s);
    vdoc.transact(() => group(vdoc).push([block('v1', 'apartado')]), 'test');
    await v.docs.flush(s);
    v.docs.close(s);
    await v.engine.syncNow();
    server.admit(server.ownerId, '0.200', s, [{ id: server.linkRoom[0].id, ok: false, reason: 'bad_shape' }]);
    clock += 60_000;
    await v.remote.refreshEdits(true);

    const entry: LinkEntry = {
      id: 'linkentry1', url: config.url, publishableKey: config.publishableKey, localKey: 'k', token, device: 'dev-' + 'x'.repeat(20),
      name: 'Ana', title: 'S', linkId: v.remote.opened!.link_id, pageId: s, openedAt: 0,
    };
    const value = {
      tree: v.tree, docs: v.docs, engine: v.engine, access: v.access, remote: v.remote as unknown as SupabaseRemote,
    } as unknown as Services;
    const saved: Blob[] = [];
    vi.stubGlobal('URL', { ...URL, createObjectURL: (b: Blob) => (saved.push(b), 'blob:x'), revokeObjectURL: () => undefined });
    vi.stubGlobal('confirm', () => true);
    const host = await mount(
      value,
      <LinkContext.Provider value={{ entry, domain: linkDomain(entry), linkId: entry.linkId, pageId: s }}>
        <LinkVisitorAsideNotice pageId={s} />
      </LinkContext.Provider>,
    );
    expect(host.textContent).toContain("Some of your changes on this page couldn't be added.");
    await act(async () => buttonNamed(host, "Show the team's version").click());
    await settle(200);
    // Bajó la copia primero, y la página es la del equipo. (Armar la copia tarda lo que tarde: se espera a que esté.)
    await shown(() => expect(saved.length).toBeGreaterThan(0));
    await shown(() => expect(host.querySelector('.link-visitor-aside')).toBeNull());
    expect(saved).toHaveLength(1);
    const now = await v.docs.open(s);
    expect(JSON.stringify(now.getXmlFragment(CONTENT_FRAGMENT).toJSON())).not.toContain('apartado');
    expect(JSON.stringify(now.getXmlFragment(CONTENT_FRAGMENT).toJSON())).toContain('equipo');
    v.docs.close(s);
    // El aviso se fue.
    expect(host.querySelector('.link-visitor-aside')).toBeNull();

    // Algo tecleado tarde pasó a lo de antes (O1 de la auditoría): el aviso lo dice hasta que se cierra.
    await v.db.put('meta', 1, startedOverLateKey(s));
    act(() => roots.pop()!.unmount());
    const again = await mount(
      value,
      <LinkContext.Provider value={{ entry, domain: linkDomain(entry), linkId: entry.linkId, pageId: s }}>
        <LinkVisitorAsideNotice pageId={s} />
      </LinkContext.Provider>,
    );
    expect(again.textContent).toContain("Something you typed while this page changed to the team's version wasn't added.");
    await act(async () => buttonNamed(again, 'Got it').click());
    await settle();
    expect(again.querySelector('.link-visitor-aside')).toBeNull();
    expect(await v.docs.startedOverLate(s)).toBe(0);
  });
});
