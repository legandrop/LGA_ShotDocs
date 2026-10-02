// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseLinkHash } from '../linkMode';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { endOfDay, LinkShare } from './LinkShare';

// *General access* en Share (Docs/Doc_Link_Publico.md, 3.11): montado de verdad, con un cliente que contesta las
// funciones de quien comparte como la migración (20261012120000_link_publico.sql), simplificadas.

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
  vi.unstubAllGlobals();
});

type Link = { id: string; page_id: string; token: string; level: string; expires_at: string | null; revoked: boolean };

/** Las funciones de quien comparte, en memoria. `canShare`: lo que diría `can_share`. */
function fakeClient(opts: { cleanOn: boolean; canShare: boolean }) {
  const links: Link[] = [];
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  let n = 0;
  const json = (l: Link) => ({
    id: l.id, page_id: l.page_id, level: l.level, created_at: '2026-10-02T10:00:00Z', expires_at: l.expires_at,
    created_by_name: 'owner', token: l.token, alive: true, usage_today: { open: { n: 4, bytes: 0 }, comment: { n: 1, bytes: 30 } },
    limited: false, comments: 1,
  });
  const live = (page: unknown) => links.find((l) => l.page_id === page && !l.revoked);
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    const ok = (data: unknown) => ({ data, error: null, status: 200 });
    if (fn === 'get_public_link') {
      if (!opts.canShare) return ok(null);
      const l = live(args.p_page);
      return ok({ clean_on: opts.cleanOn, link: l ? json(l) : null, above: null });
    }
    if (fn === 'create_public_link' || fn === 'reset_public_link') {
      if (!opts.cleanOn) return { data: null, error: { message: 'clean_off', code: 'P0001' }, status: 400 };
      if (fn === 'reset_public_link') live(args.p_page)!.revoked = true;
      const l: Link = { id: String(args.p_id ?? args.p_new_id), page_id: String(args.p_page), token: 'sdl_' + String(++n).padStart(43, 'x'), level: 'comment', expires_at: (args.p_expires as string | null) ?? null, revoked: false };
      links.push(l);
      return ok(json(l));
    }
    if (fn === 'set_public_link') {
      const l = live(args.p_page)!;
      l.expires_at = (args.p_expires as string | null) ?? null;
      return ok(json(l));
    }
    if (fn === 'revoke_public_link') {
      for (const l of links) if (l.page_id === args.p_page) l.revoked = true;
      return ok(null);
    }
    return { data: null, error: { message: 'unexpected ' + fn, code: '42501' }, status: 401 };
  };
  return { client: { rpc, auth: { signOut: vi.fn() } }, calls, links };
}

function services(d: Device, client: unknown): Services {
  const config = {
    url: 'https://znlvpuddswymxpffgvbz.supabase.co',
    publishableKey: 'sb_publishable_testtesttest',
    name: 'Wanka',
    localKey: WANKA_LOCAL_KEY,
    storage: legacyStorageNames(WANKA_LOCAL_KEY),
  };
  return {
    workspace: { config, client: client as never },
    client: client as never,
    user: { id: 'owner', email: 'owner@test' },
    db: d.db, tree: d.tree, docs: d.docs, files: d.files, media: d.media, engine: d.engine, access: d.access,
    remote: d.remote as unknown as SupabaseRemote, dbName: 'test', mediaDb: d.mediaDb, comments: d.comments,
    commentsDb: d.commentsDb, sizes: d.sizes, offline: d.offline, shutdown: async () => undefined,
  };
}

async function setup({ schema = 14, clean = true }: { schema?: number; clean?: boolean } = {}) {
  const server = new FakeServer();
  server.enableTeam();
  if (clean) server.enableClean(0.001);
  server.settings = { ...server.settings!, schemaVersion: schema };
  const d = await makeDevice(server);
  devices.push(d);
  const page = await d.tree.create(null, 'Brief');
  await d.engine.syncNow();
  return { server, d, page };
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

const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));

function pick(host: HTMLElement, label: string, value: string) {
  const select = host.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('General access (Share)', () => {
  it('con una base anterior a los links, o para quien no comparte, no aparece', async () => {
    const old = await setup({ schema: 13 });
    const a = fakeClient({ cleanOn: true, canShare: true });
    const host = await mount(services(old.d, a.client), <LinkShare pageId={old.page} onClose={() => undefined} />);
    expect(host.textContent).toBe('');
    expect(a.calls).toEqual([]);
    act(() => roots.pop()!.unmount());

    const now = await setup();
    const b = fakeClient({ cleanOn: true, canShare: false });
    const host2 = await mount(services(now.d, b.client), <LinkShare pageId={now.page} onClose={() => undefined} />);
    expect(host2.textContent).toBe('');
    expect(b.calls.map((c) => c.fn)).toEqual(['get_public_link']);
  });

  it('con el interruptor de D14 apagado, Anyone with the link se ve apagado con la línea que lo explica (D33)', async () => {
    const { d, page } = await setup({ clean: false });
    const f = fakeClient({ cleanOn: false, canShare: true });
    const host = await mount(services(d, f.client), <LinkShare pageId={page} onClose={() => undefined} />);
    expect((host.querySelector('select[aria-label="General access"]') as HTMLSelectElement).disabled).toBe(true);
    expect(host.textContent).toContain('Links need the workspace setting');
    expect(f.calls.map((c) => c.fn)).toEqual(['get_public_link']);
  });

  it('crear (Never por defecto, D30), copiar el link, cambiar el vencimiento, Reset link y apagarlo', async () => {
    const { d, page } = await setup();
    const writes: string[] = [];
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async (t: string) => void writes.push(t) } });
    vi.stubGlobal('confirm', () => true);
    const f = fakeClient({ cleanOn: true, canShare: true });
    const host = await mount(services(d, f.client), <LinkShare pageId={page} onClose={() => undefined} />);
    expect(host.textContent).toContain('Restricted');
    pick(host, 'General access', 'anyone');
    await settle();
    const create = f.calls.find((c) => c.fn === 'create_public_link')!;
    expect(create.args).toMatchObject({ p_page: page, p_level: 'comment', p_expires: null });
    // Se copió el link: la dirección de la app con el token después del #, nunca en la dirección.
    expect(writes).toHaveLength(1);
    const url = new URL(writes[0]);
    expect(url.pathname).toBe('/');
    expect(url.search).toBe('');
    expect(parseLinkHash(url.hash)).toMatchObject({ u: 'https://znlvpuddswymxpffgvbz.supabase.co', k: 'sb_publishable_testtesttest', t: f.links[0].token });
    expect(host.textContent).toContain('Copy link');
    expect(host.textContent).toContain('opened 4 times');
    // Vence en 7 días.
    pick(host, 'Expires', '7');
    await settle();
    const set = f.calls.find((c) => c.fn === 'set_public_link')!;
    expect(Date.parse(String(set.args.p_expires)) - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    // Reset link: otro token.
    const reset = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Reset link')!;
    await act(async () => reset.click());
    await settle();
    expect(f.calls.some((c) => c.fn === 'reset_public_link')).toBe(true);
    expect(f.links.filter((l) => !l.revoked)).toHaveLength(1);
    expect(f.links[0].revoked).toBe(true);
    // Restricted: lo apaga.
    pick(host, 'General access', 'restricted');
    await settle();
    expect(f.links.every((l) => l.revoked)).toBe(true);
    expect(host.textContent).toContain('Restricted');
  });

  it('una fecha de vencimiento: el fin de ese día, y nunca una del pasado', () => {
    const now = Date.parse('2026-10-02T12:00:00');
    expect(endOfDay('2026-10-05', now)).toBe(new Date(2026, 9, 5, 23, 59, 59).toISOString());
    expect(endOfDay('2026-10-01', now)).toBeNull();
    expect(endOfDay('5/10/2026', now)).toBeNull();
  });
});
