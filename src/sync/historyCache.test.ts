import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { HistoryRow, PageVersionRow } from './history';
import { deleteHistoryCache, HistoryCache, historyCacheFor, historyDbName } from './historyCache';

// La caché del historial (P.18, entrega 3; Docs/Doc_Historial.md, sección 8): por página, las filas bajadas, los
// correos y los nombres; se escriben solo las filas nuevas, otra generación la tira, el tope libera lo menos abierto y
// se borra entera con la base.

const row = (seq: number, bytes = 10, id = seq + 1000): HistoryRow => ({
  id,
  seq,
  createdBy: 'u1',
  createdAt: new Date(Date.UTC(2026, 9, 1, 10, seq)).toISOString(),
  data: new Uint8Array(bytes).fill(seq % 255),
});

const rows = (n: number, bytes = 10) => Array.from({ length: n }, (_, i) => row(i + 1, bytes));

const version = (seq: number, label: string): PageVersionRow => ({
  id: `v-${seq}`,
  seq,
  kind: 'named',
  label,
  restoredFromSeq: null,
  createdBy: 'u1',
  createdAt: new Date(0).toISOString(),
});

async function fresh(): Promise<HistoryCache> {
  return HistoryCache.open(historyDbName(`test-${crypto.randomUUID()}`));
}

describe('la caché del historial', () => {
  it('guarda las filas, los correos y los nombres, y los devuelve en orden', async () => {
    const cache = await fresh();
    await cache.save('p1', { rows: rows(5), emails: new Map([['u1', 'a@test']]), versions: [version(3, 'Rodaje')], generation: 7 }, 1000);
    const got = await cache.read('p1');
    expect(got?.rows.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(got?.rows[2].data).toEqual(row(3).data);
    expect(got?.meta.emails).toEqual([['u1', 'a@test']]);
    expect(got?.meta.versions?.[0].label).toBe('Rodaje');
    expect(got?.meta.generation).toBe(7);
    expect(got?.meta.savedAt).toBe(1000);
    expect(await cache.read('otra')).toBeNull();
    cache.close();
  });

  it('la próxima vez escribe solo las filas nuevas; con reset u otra generación tira lo de antes', async () => {
    const cache = await fresh();
    await cache.save('p1', { rows: rows(3), emails: new Map(), versions: null, generation: 1 });
    // Una fila guardada distinta a la del servidor no se reescribe (solo se suman las posteriores): la comprobación de
    // la última la hace loadPageHistory.
    const more = [...rows(3).map((r) => ({ ...r, createdBy: 'otro' })), row(4), row(5)];
    await cache.save('p1', { rows: more, emails: new Map(), versions: null, generation: 1 });
    let got = await cache.read('p1');
    expect(got?.rows.map((r) => `${r.seq}:${r.createdBy}`)).toEqual(['1:u1', '2:u1', '3:u1', '4:u1', '5:u1']);
    expect(got?.meta.count).toBe(5);
    // reset: se escribe todo de nuevo.
    await cache.save('p1', { rows: more.slice(0, 2), emails: new Map(), versions: null, generation: 1, reset: true });
    got = await cache.read('p1');
    expect(got?.rows.map((r) => `${r.seq}:${r.createdBy}`)).toEqual(['1:otro', '2:otro']);
    // Otra generación (restauraron una copia): también.
    await cache.save('p1', { rows: [row(1, 10, 99)], emails: new Map(), versions: null, generation: 2 });
    got = await cache.read('p1');
    expect(got?.rows.map((r) => r.id)).toEqual([99]);
    expect(got?.meta.generation).toBe(2);
    cache.close();
  });

  it('si lo guardado no cuadra (se cortó a medio guardar), lo tira', async () => {
    const name = historyDbName(`test-${crypto.randomUUID()}`);
    const cache = await HistoryCache.open(name);
    await cache.save('p1', { rows: rows(3), emails: new Map(), versions: null, generation: 1 });
    // Se borra una fila por debajo, como un guardado cortado.
    const raw = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve) => {
      const tx = raw.transaction('rows', 'readwrite');
      tx.objectStore('rows').delete(['p1', 2]);
      tx.oncomplete = () => resolve();
    });
    raw.close();
    expect(await cache.read('p1')).toBeNull();
    expect(await cache.totalBytes()).toBe(0);
    cache.close();
  });

  it('con el tope, libera las páginas abiertas hace más tiempo; la recién guardada va última', async () => {
    const cache = await fresh();
    const page = 3 * (1000 + 96);
    await cache.save('vieja', { rows: rows(3, 1000), emails: new Map(), versions: null, generation: 1 }, 1, page * 10);
    await cache.save('media', { rows: rows(3, 1000), emails: new Map(), versions: null, generation: 1 }, 2, page * 10);
    await cache.save('nueva', { rows: rows(3, 1000), emails: new Map(), versions: null, generation: 1 }, 3, page * 10);
    // Abrir la vieja la pone al día.
    await cache.touch('vieja', 4);
    // Con lugar para dos: se va la abierta hace más tiempo (media).
    await cache.save('otra', { rows: rows(3, 1000), emails: new Map(), versions: null, generation: 1 }, 5, page * 3);
    expect(await cache.read('media')).toBeNull();
    expect(await cache.read('vieja')).not.toBeNull();
    expect(await cache.read('otra')).not.toBeNull();
    expect(await cache.totalBytes()).toBeLessThanOrEqual(page * 3);
    // Una página que sola pasa el tope no se guarda.
    await cache.save('enorme', { rows: rows(3, 5000), emails: new Map(), versions: null, generation: 1 }, 6, page * 3);
    expect(await cache.read('enorme')).toBeNull();
    expect(await cache.read('otra')).not.toBeNull();
    cache.close();
  });

  it('los nombres se cambian solos; una página se tira; las restauraciones pendientes', async () => {
    const cache = await fresh();
    await cache.save('p1', { rows: rows(2), emails: new Map(), versions: [], generation: 1 });
    await cache.saveVersions('p1', [version(2, 'Final')]);
    expect((await cache.read('p1'))?.meta.versions?.map((v) => v.label)).toEqual(['Final']);
    await cache.drop('p1');
    expect(await cache.read('p1')).toBeNull();
    await cache.addRestore({ id: 'r2', pageId: 'p1', userId: 'u1', fromSeq: 1, afterSeq: 5, at: 20 });
    await cache.addRestore({ id: 'r1', pageId: 'p1', userId: 'u1', fromSeq: 1, afterSeq: 3, at: 10 });
    await cache.addRestore({ id: 'r3', pageId: 'p2', userId: 'u1', fromSeq: 1, afterSeq: 3, at: 10 });
    expect((await cache.restoresOf('p1')).map((r) => r.id)).toEqual(['r1', 'r2']);
    await cache.removeRestore('r1');
    expect(await cache.hasRestore('r1')).toBe(false);
    expect(await cache.hasRestore('r2')).toBe(true);
    cache.close();
  });

  it('se borra entera con la base (también con la conexión de esta pestaña abierta); sin base local no hay caché', async () => {
    const local = `test-${crypto.randomUUID()}`;
    const cache = await historyCacheFor(local);
    expect(cache).not.toBeNull();
    expect(await historyCacheFor(local)).toBe(cache);
    await cache!.save('p1', { rows: rows(2), emails: new Map(), versions: null, generation: 1 });
    await deleteHistoryCache(local);
    const names = (await indexedDB.databases()).map((d) => d.name);
    expect(names).not.toContain(historyDbName(local));
    // Abrirla otra vez da una vacía.
    const again = await historyCacheFor(local);
    expect(again).not.toBe(cache);
    expect(await again!.read('p1')).toBeNull();
    await deleteHistoryCache(local);
    expect(await historyCacheFor('')).toBeNull();
  });
});
