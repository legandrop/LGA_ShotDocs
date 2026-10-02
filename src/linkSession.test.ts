// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanVisitorName, createLinkClient, leaveLinks, readLinks, rememberLink, setTabLink, tabLink, updateLink } from './linkMode';
import { legacyStorageNames, storageNamesFor } from './workspace';
import type { KeyValueStore } from './workspaces';

// El visitante de un link y la cuenta del mismo navegador (Docs/Doc_Link_Publico.md, 6.2): el cliente del modo link
// nunca manda el `Authorization` de una cuenta aunque el navegador tenga una sesión guardada, y recargar la página del
// link sigue en el link.

const URL_ = 'https://abcdefghijklmnopqrst.supabase.co';
const KEY = 'sb_publishable_abcdefghij';
const T = 'sdl_' + 'A'.repeat(43);

function memoryStore(): KeyValueStore {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

afterEach(() => localStorage.clear());

describe('el cliente del link nunca usa la sesión de una cuenta', () => {
  it('con sesiones guardadas en este navegador (la del workspace, la de siempre y la de supabase-js), ningún pedido las lleva y no las toca', async () => {
    const entry = rememberLink({ u: URL_, k: KEY, l: 'wanka_1', t: T }, memoryStore());
    const session = JSON.stringify({
      access_token: 'ACCOUNT.JWT.TOKEN',
      refresh_token: 'ACCOUNT-REFRESH',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', email: 'owner@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
    });
    const keys = [storageNamesFor('wanka_1').auth, legacyStorageNames('wanka_1').auth, 'sb-abcdefghijklmnopqrst-auth-token'];
    for (const k of keys) localStorage.setItem(k, session);

    const seen: { url: string; headers: Headers }[] = [];
    const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), headers: new Headers(init?.headers) });
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const client = createLinkClient(entry, '0.200', fetchStub as unknown as typeof fetch);
    await client.rpc('plink_open', {});
    await client.rpc('plink_tree', { p_sig: null });
    await client.storage.from('thumbs').download('a.jpg');
    await client.storage.from('thumbs').createSignedUrls(['a.jpg'], 60);

    expect(seen.length).toBeGreaterThanOrEqual(4);
    for (const { url, headers } of seen) {
      const auth = headers.get('authorization');
      expect(auth === null || auth === `Bearer ${KEY}`, `Authorization de ${url}: ${auth}`).toBe(true);
      expect(`${[...headers.entries()].join('|')} ${url}`).not.toContain('ACCOUNT');
      expect(headers.get('x-shotdocs-link')).toBe(T);
    }
    expect((await client.auth.getSession()).data.session).toBeNull();
    // Y lo del navegador queda como estaba: ni lo lee para renovarlo ni lo borra ni escribe otra cosa.
    expect(Object.keys(localStorage).sort()).toEqual([...keys].sort());
    for (const k of keys) expect(localStorage.getItem(k)).toBe(session);
  });
});

describe('recargar la página del link sigue en el link', () => {
  it('la pestaña recuerda su link; una pestaña nueva, o escribir la dirección, no', () => {
    const list = memoryStore();
    const a = rememberLink({ u: URL_, k: KEY, l: 'wanka_1', t: T }, list);
    const b = rememberLink({ u: URL_, k: KEY, l: 'wanka_1', t: 'sdl_' + 'B'.repeat(43) }, list);
    const tab = memoryStore();
    const links = readLinks(list);
    expect(tabLink(links, tab, 'reload')).toBeNull();
    setTabLink(a.id, tab);
    expect(tabLink(links, tab, 'reload')?.id).toBe(a.id);
    expect(tabLink(links, tab, 'back_forward')?.id).toBe(a.id);
    expect(tabLink(links, tab, null)?.id).toBe(a.id);
    // Escribir la dirección de la app en esa pestaña abre la cuenta, como siempre.
    expect(tabLink(links, tab, 'navigate')).toBeNull();
    // Un link que ya no está guardado no se abre.
    setTabLink('no-existe-123', tab);
    expect(tabLink(links, tab, 'reload')).toBeNull();
    setTabLink(b.id, tab);
    expect(tabLink(links, tab, 'reload')?.id).toBe(b.id);
    // Salir del link (o sin almacenamiento de pestaña) no lo recuerda.
    setTabLink(null, tab);
    expect(tabLink(links, tab, 'reload')).toBeNull();
    expect(tabLink(links, null, 'reload')).toBeNull();
  });

  it('leaveLinks borra el link de la pestaña (la de verdad: sessionStorage)', () => {
    const entry = rememberLink({ u: URL_, k: KEY, l: 'wanka_1', t: T }, localStorage as KeyValueStore);
    setTabLink(entry.id);
    expect(tabLink(readLinks(localStorage as KeyValueStore), undefined, 'reload')?.id).toBe(entry.id);
    leaveLinks(localStorage as KeyValueStore);
    expect(tabLink(readLinks(localStorage as KeyValueStore), undefined, 'reload')).toBeNull();
    sessionStorage.clear();
  });

  it('lo guardado al abrir (id del link y de la página) sobrevive a releer la lista', () => {
    const store = memoryStore();
    const entry = rememberLink({ u: URL_, k: KEY, l: 'wanka_1', t: T }, store);
    expect(entry.linkId).toBe('');
    updateLink(entry.id, { linkId: 'link-1', pageId: 'page-1' }, store);
    expect(readLinks(store).links[0]).toMatchObject({ linkId: 'link-1', pageId: 'page-1' });
    // Una lista guardada por una versión anterior (sin esos campos) se lee con vacíos.
    const old = memoryStore();
    old.setItem('shotdocs-links', JSON.stringify({ active: entry.id, links: [{ ...entry, linkId: undefined, pageId: undefined }] }));
    expect(readLinks(old).links[0]).toMatchObject({ linkId: '', pageId: '' });
  });
});

describe('el nombre del visitante', () => {
  it('saca las mismas marcas que la base y el portero (U+061C, U+2028, U+2029)', () => {
    for (const bad of ['؜', ' ', ' ', '‮', '​']) expect(cleanVisitorName(`Ana${bad}Z`)).toBe('AnaZ');
  });
});
