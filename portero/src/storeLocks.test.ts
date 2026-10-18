import { describe, expect, it, vi } from 'vitest';

// El candado entre instancias guardado en el almacenamiento del Durable Object (`Store` de index.ts, v0.264,
// Docs/Doc_Portero.md, «Candado entre instancias del Worker»), con una API KV sincrónica fingida como la de SQLite.
vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    protected ctx: unknown;
    constructor(ctx: unknown) {
      this.ctx = ctx;
    }
  },
}));

const { Store } = await import('./index');

/** Lo mínimo del almacenamiento de un objeto: la API KV sincrónica sobre un mapa (el mismo mapa = el mismo disco). */
function fakeStorage(rows = new Map<string, unknown>()) {
  const kv = {
    get: (key: string) => structuredClone(rows.get(key)),
    put: (key: string, value: unknown) => void rows.set(key, structuredClone(value)),
    delete: (key: string) => rows.delete(key),
    list: (options?: { prefix?: string }) =>
      [...rows.entries()]
        .filter(([key]) => key.startsWith(options?.prefix ?? ''))
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, value]) => [key, structuredClone(value)] as [string, unknown]),
  };
  return { rows, ctx: { storage: { kv } } };
}

const newStore = (ctx: unknown) => new Store(ctx as never, {} as never);

describe('Store: el candado en el almacenamiento del objeto', () => {
  it('un candado tomado se ve desde un objeto nuevo sobre el mismo almacenamiento (hibernar, desalojar o publicar no lo pierde)', async () => {
    const { ctx } = fakeStorage();
    expect(await newStore(ctx).claim('folder:proyecto', 'A', 30_000)).toBe(true);
    // Cloudflare recrea el objeto: memoria nueva, el mismo disco.
    const again = newStore(ctx);
    expect(await again.claim('folder:proyecto', 'B', 30_000)).toBe(false);
    // Solo su dueño lo suelta.
    await again.release('folder:proyecto', 'B');
    expect(await newStore(ctx).claim('folder:proyecto', 'B', 30_000)).toBe(false);
    await newStore(ctx).release('folder:proyecto', 'A');
    expect(await newStore(ctx).claim('folder:proyecto', 'B', 30_000)).toBe(true);
  });

  it('las claves llevan el prefijo `candado:` y no chocan con las demás del almacenamiento', async () => {
    const now = Date.now();
    const { rows, ctx } = fakeStorage(
      new Map<string, unknown>([
        // Claves del portero (o cualquier otra) que justo tienen la forma de un candado vigente de otro.
        ['folder:proyecto', { holder: 'X', at: now, stale: 120_000 }],
        ['upload:abc', { holder: 'X', at: 0, stale: 1_000 }],
        ['file:abc', { holder: 'X', at: 0, stale: 1_000 }],
      ]),
    );
    const store = newStore(ctx);
    expect(await store.claim('folder:proyecto', 'A', 30_000)).toBe(true);
    expect(rows.get('candado:folder:proyecto')).toMatchObject({ holder: 'A' });
    await store.release('folder:proyecto', 'A');
    expect(rows.has('candado:folder:proyecto')).toBe(false);
    // Lo demás, intacto (aunque «parezca» vencido: no es un candado).
    expect(rows.get('folder:proyecto')).toEqual({ holder: 'X', at: now, stale: 120_000 });
    expect(rows.has('upload:abc')).toBe(true);
    expect(rows.has('file:abc')).toBe(true);
  });

  it('los candados vencidos se borran del almacenamiento al dar uno nuevo (listar devuelve las claves sin el prefijo)', async () => {
    const now = Date.now();
    const { rows, ctx } = fakeStorage(
      new Map<string, unknown>([
        ['candado:folder:viejo', { holder: 'Z', at: now - 60_000, stale: 30_000 }],
        ['candado:folder:vigente', { holder: 'Z', at: now, stale: 30_000 }],
      ]),
    );
    expect(await newStore(ctx).claim('folder:nuevo', 'A', 30_000)).toBe(true);
    expect(rows.has('candado:folder:viejo')).toBe(false);
    expect(rows.has('candado:folder:vigente')).toBe(true);
    expect(rows.has('candado:folder:nuevo')).toBe(true);
    expect([...rows.keys()].filter((k) => k.startsWith('candado:candado:'))).toEqual([]);
  });
});
