import { describe, expect, it } from 'vitest';
import { fakePostgrest } from '../sync/fakePostgrest';
import type { LinkAsideRow } from '../sync/linkAdmitApi';
import { SupabaseRemote } from '../sync/remote';
import { RemoteError } from '../sync/types';
import { ASIDE_EVERY_MS, LinkAsideStore, type AsideEngine } from './linkAside';

// El store de lo apartado (entrega 2c): una consulta para Share, el árbol y el historial; sin red, sin la versión 20 de
// la base o para un invitado no pregunta nada; con las sincronizaciones, como mucho cada `ASIDE_EVERY_MS`.

function harness({ online = true, schemaVersion = 20, allowed = true } = {}) {
  let now = 1_000_000;
  const listeners = new Set<() => void>();
  const status = { online, schemaVersion };
  const engine: AsideEngine = {
    subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    getStatus: () => status,
  };
  const calls: number[] = [];
  let fail: Error | null = null;
  const row = { id: 'r1', page_id: 'p', link_id: 'l', link_page_id: 'p', author: 'Ana', created_at: '', decided_at: null, bytes: 1, reason: 'pending' } as LinkAsideRow;
  const remote = {
    linkAside: async () => {
      calls.push(now);
      if (fail) throw fail;
      return [row];
    },
    linkUpdateBytes: async () => new Uint8Array(),
  };
  const permitted = { value: allowed };
  const store = new LinkAsideStore(remote, engine, () => permitted.value, () => now);
  return {
    store, calls, status, permitted, listeners,
    tick: (ms: number) => (now += ms),
    sync: () => listeners.forEach((fn) => fn()),
    /** La consulta falla: sin red (`network`), o con un error que contestó la base. */
    failNext: (how: 'network' | 'base' | null) =>
      (fail = how === 'network' ? new RemoteError('Failed to fetch', false, undefined, true) : how === 'base' ? new RemoteError('boom', false, 'XX000') : null),
  };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('LinkAsideStore', () => {
  it('pregunta al suscribirse y después como mucho cada 2 minutos con las sincronizaciones; con force, ya', async () => {
    const h = harness();
    const off = h.store.subscribe(() => undefined);
    await flush();
    expect(h.calls).toHaveLength(1);
    expect(h.store.get()).toMatchObject({ ready: true, rows: [{ id: 'r1' }] });
    h.sync();
    h.tick(ASIDE_EVERY_MS - 1);
    h.sync();
    await flush();
    expect(h.calls).toHaveLength(1);
    h.tick(2);
    h.sync();
    await flush();
    expect(h.calls).toHaveLength(2);
    await h.store.refresh(true);
    expect(h.calls).toHaveLength(3);
    // Sin quien escuche, deja de mirar las sincronizaciones.
    off();
    expect(h.listeners.size).toBe(0);
  });

  it('sin red, sin la versión 20 o para un invitado no pregunta', async () => {
    for (const opts of [{ online: false }, { schemaVersion: 19 }, { allowed: false }]) {
      const h = harness(opts);
      h.store.subscribe(() => undefined);
      await h.store.refresh(true);
      expect(h.calls).toHaveLength(0);
      expect(h.store.get().ready).toBe(false);
    }
  });

  it('si la consulta falla por la red, queda lo de antes y la próxima sincronización vuelve a probar', async () => {
    const h = harness();
    h.store.subscribe(() => undefined);
    await flush();
    h.failNext('network');
    await h.store.refresh(true);
    expect(h.store.get().rows).toHaveLength(1);
    h.failNext(null);
    h.sync();
    await flush();
    expect(h.calls).toHaveLength(3);
  });

  it('si la base contesta un error, queda lo de antes y no vuelve a pedir en cada aviso del motor: espera lo de siempre', async () => {
    const h = harness();
    h.store.subscribe(() => undefined);
    await flush();
    h.failNext('base');
    await h.store.refresh(true);
    expect(h.store.get()).toMatchObject({ ready: true, rows: [{ id: 'r1' }] });
    // Cinco avisos del motor (los cambios de estado de una sincronización): ningún pedido más.
    for (let i = 0; i < 5; i++) {
      h.sync();
      await flush();
    }
    expect(h.calls).toHaveLength(2);
    h.tick(ASIDE_EVERY_MS + 1);
    h.sync();
    await flush();
    expect(h.calls).toHaveLength(3);
  });

  it('con más apartados que el tope de filas por pedido de fábrica, la lista llega con lo que entra (no vacía ni en error)', async () => {
    // 1200 apartados en 7 páginas (la función da hasta 200 por página, lo más nuevo primero) y el tope de 1000.
    const rows = Array.from({ length: 1200 }, (_, i) => ({ id: `id-${i}`, page_id: `p-${i % 7}`, link_id: 'l', link_page_id: 'p-0', author: 'Ana', created_at: '2026-10-01T10:00:00+00:00', decided_at: null, bytes: 10, reason: 'pending' }));
    const api = fakePostgrest({ functions: { public_link_aside: () => rows } });
    const remote = new SupabaseRemote(api.client, '0.224');
    expect(await remote.linkAside()).toHaveLength(1000);
    const listeners = new Set<() => void>();
    const engine: AsideEngine = { subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)), getStatus: () => ({ online: true, schemaVersion: 21 }) };
    const store = new LinkAsideStore(remote, engine, () => true);
    store.subscribe(() => undefined);
    await store.refresh(true);
    expect(store.get()).toMatchObject({ ready: true });
    expect(store.get().rows).toHaveLength(1000);
    const asked = api.requests.length;
    for (let i = 0; i < 5; i++) {
      listeners.forEach((fn) => fn());
      await flush();
    }
    expect(api.requests).toHaveLength(asked);
  });
});
