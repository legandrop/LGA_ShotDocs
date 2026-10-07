import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { getPublicLinkPages, type ListedLinkPage, type PublicLinkInfo } from '../sync/publicLinks';
import { LINK_PAGES_EVERY_MS, LinkPagesStore, type LinkPagesPerms } from './linkPages';

// El ícono del árbol con la base que ya decide (supabase/migrations/20261107120000_link_paginas_quien_comparte.sql):
// `public_link_pages` lista solo lo que la sesión puede compartir y trae el nivel, quién creó el link y si anda. Un
// pedido alcanza. Con una base anterior (solo ids), cada página se sigue confirmando con `get_public_link`: está en
// linkPages.test.tsx.

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

const marked = (pageId: string, level: 'comment' | 'edit' = 'comment', createdBy: string | null = 'lega', alive = true): ListedLinkPage => ({
  pageId,
  mark: { level, createdBy, alive },
});

/** La base, en memoria: lo que lista y lo que contesta *Share* de cada página. `gate`: la lista espera hasta soltarla. */
function fakeApi(listed: ListedLinkPage[], answers: Record<string, PublicLinkInfo | null> = {}) {
  const asked: string[] = [];
  const api = {
    asked,
    listed,
    gate: null as Promise<void> | null,
    pages: async () => {
      asked.push('pages');
      const now = [...api.listed];
      if (api.gate) await api.gate;
      return now;
    },
    link: async (pageId: string): Promise<PublicLinkInfo | null> => {
      asked.push(pageId);
      return answers[pageId] ?? null;
    },
  };
  return api;
}

const engine = (online = true, schemaVersion = 25) => ({ subscribe: () => () => undefined, getStatus: () => ({ online, schemaVersion }) });
const perms = (over: Partial<LinkPagesPerms> = {}): (() => LinkPagesPerms) => () => ({ known: true, role: 'owner', canSharePage: () => true, ...over });

describe('el ícono del árbol con la base que ya decide quién comparte', () => {
  it('marca cada página con lo que trae la lista, sin pedir el link de ninguna', async () => {
    const api = fakeApi([marked('a', 'edit', 'lega'), marked('b', 'comment', null, false)]);
    const store = new LinkPagesStore(api, engine(), perms());
    await store.refresh();
    expect(api.asked).toEqual(['pages']);
    expect(store.get().get('a')).toEqual({ level: 'edit', createdBy: 'lega', alive: true });
    expect(store.get().get('b')).toEqual({ level: 'comment', createdBy: null, alive: false });
  });

  it('en una misma lista, las que llegan con marca no se confirman y las que llegan solo con el id, sí', async () => {
    const api = fakeApi([marked('a'), 'b', 'c'], { b: info({ level: 'edit' }), c: null });
    const store = new LinkPagesStore(api, engine(), perms());
    await store.refresh();
    expect(api.asked).toEqual(['pages', 'b', 'c']);
    expect([...store.get().keys()].sort()).toEqual(['a', 'b']);
  });

  it('una página que la app sabe que la persona no puede compartir no se marca aunque la lista la traiga', async () => {
    const api = fakeApi([marked('a'), marked('b')]);
    const store = new LinkPagesStore(api, engine(), perms({ canSharePage: (id) => id === 'a' }));
    await store.refresh();
    expect([...store.get().keys()]).toEqual(['a']);
  });

  it('para un invitado no pregunta nada ni marca', async () => {
    const api = fakeApi([marked('a')]);
    const store = new LinkPagesStore(api, engine(), perms({ role: 'guest' }));
    await store.refresh();
    expect(api.asked).toEqual([]);
    expect(store.get().size).toBe(0);
  });

  it('lo que cambia en la base llega con la lista siguiente (a los dos minutos): el nivel, si anda, y la página que deja de estar', async () => {
    let now = 1_000_000;
    const api = fakeApi([marked('a'), marked('b')]);
    const store = new LinkPagesStore(api, engine(), perms(), () => now);
    let notified = 0;
    const stop = store.subscribe(() => notified++);
    await store.refresh();
    expect(notified).toBe(1);

    // La misma lista no avisa ni cambia lo guardado.
    const same = store.get();
    now += LINK_PAGES_EVERY_MS;
    await store.refresh();
    expect(store.get()).toBe(same);
    expect(notified).toBe(1);

    // Antes del plazo, nada.
    api.listed = [marked('a', 'edit', 'lega', false)];
    now += LINK_PAGES_EVERY_MS - 1;
    await store.refresh();
    expect(store.get()).toBe(same);

    now += 1;
    await store.refresh();
    expect([...store.get()]).toEqual([['a', { level: 'edit', createdBy: 'lega', alive: false }]]);
    expect(notified).toBe(2);
    expect(api.asked.filter((c) => c !== 'pages')).toEqual([]);
    stop();
  });

  it('lo que Share leyó mientras la lista viajaba gana: un link recién apagado no vuelve y uno recién creado no se pisa', async () => {
    let now = 1_000_000;
    const api = fakeApi([marked('a')]);
    const store = new LinkPagesStore(api, engine(), perms(), () => now);
    await store.refresh();
    expect(store.get().has('a')).toBe(true);

    // La lista sale (todavía con `a`, sin `b`) y, mientras viaja, Share apaga el de `a` y crea uno Can edit en `b`.
    now += LINK_PAGES_EVERY_MS;
    let release = () => undefined as void;
    api.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    api.listed = [marked('a'), marked('c')];
    const round = store.refresh();
    now += 5;
    store.learn('a', { clean_on: true, above: null, link: null });
    store.learn('b', info({ level: 'edit', created_by_name: 'otra' }));
    release();
    await round;
    expect(store.get().has('a')).toBe(false);
    expect(store.get().get('b')).toEqual({ level: 'edit', createdBy: 'otra', alive: true });
    expect(store.get().has('c')).toBe(true);
    expect(api.asked.filter((c) => c !== 'pages')).toEqual([]);

    // La lista siguiente ya salió después de lo que leyó Share: manda ella.
    api.gate = null;
    api.listed = [marked('b', 'comment', 'otra')];
    now += LINK_PAGES_EVERY_MS;
    await store.refresh();
    expect([...store.get()]).toEqual([['b', { level: 'comment', createdBy: 'otra', alive: true }]]);
  });
});

describe('la lista de páginas con link, como la da cada base', () => {
  const client = (rows: unknown) => ({ rpc: async () => ({ data: rows, error: null, status: 200 }) }) as unknown as SupabaseClient;

  it('con las columnas del ícono, cada fila llega con su marca y nada más (ni un token que viniera de más)', async () => {
    const pages = await getPublicLinkPages(
      client([
        { page_id: 'a', level: 'edit', created_by_name: 'lega', alive: true },
        { page_id: 'b', level: 'comment', created_by_name: null, alive: false, token: 'sdl_' + 'x'.repeat(43) },
        { page_id: 'c', level: 'otro', created_by_name: '', alive: null },
      ]),
    );
    expect(pages).toEqual([
      { pageId: 'a', mark: { level: 'edit', createdBy: 'lega', alive: true } },
      { pageId: 'b', mark: { level: 'comment', createdBy: null, alive: false } },
      { pageId: 'c', mark: { level: 'comment', createdBy: null, alive: true } },
    ]);
    expect(JSON.stringify(pages)).not.toContain('sdl_');
  });

  it('sin esas columnas (una base anterior), solo el id: hay que confirmar cada página', async () => {
    expect(await getPublicLinkPages(client([{ page_id: 'a' }, { page_id: 'b' }]))).toEqual(['a', 'b']);
    expect(await getPublicLinkPages(client(null))).toEqual([]);
  });
});
