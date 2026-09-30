import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openLocalDb, type LocalDb } from '../sync/localDb';
import type { HeadingRecord } from './collapse';
import { COLLAPSE_PREFIX, collapseSaver, loadCollapse, MAX_PAGES, saveCollapse } from './collapseStore';

// Lo colapsado de cada persona se guarda en la base local del dispositivo (Docs/Doc_Colapsar.md, corrección 6).

const dbs: LocalDb[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  vi.useRealTimers();
});

async function freshDb(): Promise<LocalDb> {
  const db = await openLocalDb(`collapse-${crypto.randomUUID()}`);
  dbs.push(db);
  return db;
}

const records = (entries: [string, HeadingRecord][]) => new Map(entries);

describe('lo colapsado en el dispositivo', () => {
  it('se guarda por página y se vuelve a leer igual, con el fin', async () => {
    const db = await freshDb();
    await saveCollapse(db, 'p1', records([['h1', { c: true, g: null }], ['h2', { c: true, g: null, e: 'b9' }]]));
    expect(await loadCollapse(db, 'p1')).toEqual(records([['h1', { c: true, g: null }], ['h2', { c: true, g: null, e: 'b9' }]]));
    expect(await loadCollapse(db, 'p2')).toEqual(new Map());
  });

  it('abrir la página la cuenta como usada (se conservan las usadas más recientemente)', async () => {
    const db = await freshDb();
    await saveCollapse(db, 'p1', records([['h1', { c: true, g: null }]]), 1000);
    await loadCollapse(db, 'p1', 9000);
    await new Promise((r) => setTimeout(r, 20));
    expect(((await db.get('meta', `${COLLAPSE_PREFIX}p1`)) as { used: number }).used).toBe(9000);
  });

  it('nada colapsado borra la clave', async () => {
    const db = await freshDb();
    await saveCollapse(db, 'p1', records([['h1', { c: true, g: null }]]));
    await saveCollapse(db, 'p1', new Map());
    expect(await db.get('meta', `${COLLAPSE_PREFIX}p1`)).toBeUndefined();
  });

  it('algo dañado se descarta sin romper nada; sin base, vacío', async () => {
    const db = await freshDb();
    await db.put('meta', { used: 1, h: { ok: { c: true, g: null }, roto: 'x', raro: { c: 'si' }, sinG: { c: true } } }, `${COLLAPSE_PREFIX}p1`);
    expect(await loadCollapse(db, 'p1')).toEqual(records([['ok', { c: true, g: null }], ['sinG', { c: true, g: null }]]));
    await db.put('meta', 'basura', `${COLLAPSE_PREFIX}p2`);
    expect(await loadCollapse(db, 'p2')).toEqual(new Map());
    expect(await loadCollapse(null, 'p1')).toEqual(new Map());
    await expect(saveCollapse(null, 'p1', records([['h', { c: true, g: null }]]))).resolves.toBeUndefined();
  });

  it(`deja las ${MAX_PAGES} páginas usadas más recientemente`, async () => {
    const db = await freshDb();
    for (let i = 0; i < MAX_PAGES; i++) {
      await db.put('meta', { used: 1000 + i, h: { h: { c: true, g: null } } }, `${COLLAPSE_PREFIX}old-${i}`);
    }
    await saveCollapse(db, 'nueva', records([['h', { c: true, g: null }]]), 5000);
    const keys = await db.getAllKeys('meta');
    const pages = keys.filter((k) => String(k).startsWith(COLLAPSE_PREFIX));
    expect(pages).toHaveLength(MAX_PAGES);
    expect(pages).toContain(`${COLLAPSE_PREFIX}nueva`);
    expect(pages).not.toContain(`${COLLAPSE_PREFIX}old-0`);
  });

  it('guarda con una pausa (una vez) y lo pendiente se escribe al cerrar', async () => {
    const db = await freshDb();
    const saver = collapseSaver(db, 'p1', 10_000);
    saver.save(records([['a', { c: true, g: null }]]));
    saver.save(records([['b', { c: true, g: null }]]));
    expect(await loadCollapse(db, 'p1')).toEqual(new Map());
    await saver.flush();
    expect(await loadCollapse(db, 'p1')).toEqual(records([['b', { c: true, g: null }]]));
  });
});
