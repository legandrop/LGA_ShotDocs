// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inviteLink } from '../invite';
import { workspaceHash } from '../fileLink';
import { createLinkClient, publicLinkUrl, rememberLink, setTabLink } from '../linkMode';
import { writeWorkspaces, type DeviceWorkspace } from '../workspaces';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const A: DeviceWorkspace = { id: 'isla_a', localKey: 'isla_a', url: 'https://aaaaaaaaaa.supabase.co', publishableKey: 'sb_publishable_aaaaaaaa', name: 'A' };
const B: DeviceWorkspace = { id: 'isla_b', localKey: 'isla_b', url: 'https://bbbbbbbbbb.supabase.co', publishableKey: 'sb_publishable_bbbbbbbb', name: 'B' };
const opened = vi.hoisted(() => vi.fn());
vi.mock('../workspace', async (original) => {
  const actual = await original<typeof import('../workspace')>();
  return { ...actual, createWorkspaceClient: (config: Parameters<typeof actual.createWorkspaceClient>[0]) => {
    opened(config); return actual.createWorkspaceClient(config);
  } };
});
let requests: { url: string; headers: Headers }[];
beforeEach(() => {
  vi.resetModules(); opened.mockClear(); localStorage.clear(); sessionStorage.clear();
  requests = []; vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), headers: new Headers(init?.headers) });
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  });
  history.replaceState(null, '', '/');
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function app() { return import('./App'); }
async function arrive(path: string, navigation: string | null = 'reload') {
  history.replaceState(null, '', path);
  const links = await import('../linkMode'); links.resetLinkHashForTests();
  const files = await import('../fileLink'); files.resetWorkspaceHashForTests();
  vi.spyOn(performance, 'getEntriesByType').mockReturnValue(navigation === null ? [] : [{ type: navigation } as PerformanceNavigationTiming]);
}
function dormant() {
  const entry = rememberLink({ u: A.url, k: A.publishableKey, l: A.localKey, t: 'sdl_' + 'T'.repeat(43) });
  setTabLink(entry.id); return entry;
}

describe('arranque y autoridad de página', () => {
  it.each(['navigate', 'prerender', 'reload', 'back_forward', null])('w=B gana al link dormido con navegación %s', async (navigation) => {
    writeWorkspaces({ active: A.id, workspaces: [A, B] }); dormant();
    await arrive(`/p/${ID}?keep=1&w=isla_b#part`, navigation);
    const { computeStart, createOpenedWorkspace } = await app();
    const start = computeStart(); expect(start).toEqual({ kind: 'open', entry: B });
    if (start.kind !== 'open') throw new Error('Sin cuenta B');
    const active = createOpenedWorkspace(start.entry);
    expect(opened).toHaveBeenCalledOnce(); expect(opened.mock.calls[0][0].localKey).toBe('isla_b');
    expect(active.config.storage.db('usuarioB')).toContain('isla_b');
    await active.client.from('pages').select('id'); await active.client.auth.stopAutoRefresh();
    expect(requests[0].url).toContain('bbbbbbbbbb.supabase.co');
    expect(requests[0].headers.has('x-shotdocs-link')).toBe(false);
    expect(requests[0].headers.get('authorization')).toBe(`Bearer ${B.publishableKey}`);
    expect(location.search).toBe('?keep=1&w=isla_b'); expect(location.hash).toBe('#part');
    const router = await import('../router'); router.navigate(`/p/${ID}?next=1#other`);
    expect(location.search).toBe('?next=1&w=isla_b'); expect(location.hash).toBe('#other');
  });

  it.each(['?w=', '?w=bad.', '?w=isla_a&w=isla_a', '?w=missing_1', '?w=pending.1'])('w rechazada %s no cae a link ni cliente', async (query) => {
    writeWorkspaces({ active: A.id, workspaces: [A, B, { ...B, id: 'pending.1', localKey: '', pending: true }] }); dormant();
    await arrive(`/p/${ID}${query}`);
    expect((await app()).computeStart()).toEqual({ kind: 'welcome' });
    expect(opened).not.toHaveBeenCalled(); expect(requests).toHaveLength(0);
    expect((await import('../invite')).takeArrivalNotice()).toContain('workspace');
    expect((await import('../router')).documentPageOrigin()).toBeNull();
  });

  it('hash público prioritario quita sólo w y conserva cliente/headers públicos sin binding', async () => {
    writeWorkspaces({ active: B.id, workspaces: [A, B] });
    const payload = { u: A.url, k: A.publishableKey, l: A.localKey, t: 'sdl_' + 'T'.repeat(43) };
    const hash = new URL(publicLinkUrl(location.origin, payload)).hash;
    await arrive(`/p/${ID}?keep=1&w=isla_b${hash}`);
    const start = (await app()).computeStart(); expect(start.kind).toBe('link');
    expect(location.search).toBe('?keep=1'); expect(location.hash).toBe(''); expect(opened).not.toHaveBeenCalled();
    const router = await import('../router'); expect(router.documentPageOrigin()).toBeNull();
    if (start.kind !== 'link') throw new Error('Sin link');
    const client = createLinkClient(start.link, '0.205', fetch);
    await client.from('pages').select('id');
    expect(requests[0].headers.get('x-shotdocs-link')).toBe(payload.t);
    expect(requests[0].headers.get('x-shotdocs-device')).toBe(start.link.device);
    await expect(client.auth.getSession()).resolves.toMatchObject({ data: { session: null } });
    router.navigate(`/p/${ID}?other=1`); expect(location.search).toBe('?other=1');
    await arrive(`/p/${ID}`, 'back_forward');
    expect((await app()).computeStart().kind).toBe('link');
  });

  it('invitación y archivo preceden w/link dormido', async () => {
    writeWorkspaces({ active: A.id, workspaces: [A, B] }); dormant();
    const hash = new URL(inviteLink(location.origin, { u: B.url, k: B.publishableKey, l: B.localKey })).hash;
    await arrive(`/p/${ID}?w=isla_a${hash}`);
    expect((await app()).computeStart()).toEqual({ kind: 'open', entry: B });
    await arrive(`/f/isla_b/${ID}?w=isla_a${workspaceHash({ u: B.url, k: B.publishableKey, l: B.localKey })}`);
    expect((await app()).computeStart()).toEqual({ kind: 'open', entry: B });
  });

  it('binding copia/freeze, segunda identidad y pending tras A nunca crean otro cliente', async () => {
    await arrive(`/p/${ID}?keep=1`);
    const { createOpenedWorkspace } = await app();
    const router = await import('../router');
    const caller = { appOrigin: location.origin, localKey: A.localKey }; router.bindPageNavigationOrigin(caller); caller.localKey = B.localKey;
    const active = createOpenedWorkspace(A); await active.client.auth.stopAutoRefresh();
    expect(router.documentPageOrigin()?.localKey).toBe(A.localKey); expect(Object.isFrozen(router.documentPageOrigin())).toBe(true);
    expect(() => createOpenedWorkspace(B)).toThrow();
    expect(() => createOpenedWorkspace({ ...B, id: 'pending.1', localKey: '', pending: true })).toThrow();
    expect(() => createOpenedWorkspace({ ...B, localKey: 'bad.' })).toThrow();
    expect(opened).toHaveBeenCalledOnce(); expect(router.documentPageOrigin()?.localKey).toBe(A.localKey);
    expect(() => router.navigate(`/p/${ID}?w=isla_b`)).toThrow();
  });
});
