import { describe, expect, it } from 'vitest';
import type { LinkAsideRow } from '../sync/linkAdmitApi';
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
  let fail = false;
  const row = { id: 'r1', page_id: 'p', link_id: 'l', link_page_id: 'p', author: 'Ana', created_at: '', decided_at: null, bytes: 1, reason: 'pending' } as LinkAsideRow;
  const remote = {
    linkAside: async () => {
      calls.push(now);
      if (fail) throw new Error('offline');
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
    failNext: (on: boolean) => (fail = on),
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

  it('si la consulta falla, queda lo de antes y la próxima sincronización vuelve a probar', async () => {
    const h = harness();
    h.store.subscribe(() => undefined);
    await flush();
    h.failNext(true);
    await h.store.refresh(true);
    expect(h.store.get().rows).toHaveLength(1);
    h.failNext(false);
    h.sync();
    await flush();
    expect(h.calls).toHaveLength(3);
  });
});
