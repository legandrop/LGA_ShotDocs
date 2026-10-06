import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeServer, makeDevice, type Device } from './testing';
import { PageTree, type TitleRest } from './tree';

const devices: Device[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.docs.dispose();
    d.db.close(); d.mediaDb.close(); d.commentsDb.close();
  }
});
async function setup() {
  const d = await makeDevice(new FakeServer());
  devices.push(d);
  const page = await d.tree.create(null, 'Anterior');
  await d.engine.syncNow();
  return { d, page };
}
const full = 'H'.repeat(500) + 'R'.repeat(245);
const durable = async (d: Device) => (await d.db.get('meta', 'titleRests') ?? []) as TitleRest[];

describe('borrador completo del título y recibo local', () => {
  it('un aborto real después de add conserva el texto; un solo retry confirma título y resto una vez', async () => {
    const { d, page } = await setup();
    const original = IDBObjectStore.prototype.put;
    const abort = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      const request = original.call(this, value, key!);
      if (this.name === 'meta' && key === 'titleRests') this.transaction.abort();
      return request;
    });
    const first = d.tree.saveTitleDraft(page, full);
    expect(d.tree.saveTitleDraft(page, full)).toBe(first);
    expect(d.tree.hasUnsavedWrites()).toBe(true);
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(d.tree.pendingTitleDraft(page)).toMatchObject({ fullText: full, busy: false });
    expect(d.tree.get(page)?.title).toBe('Anterior');
    expect(await d.db.getAll('ops')).toEqual([]);
    expect(await durable(d)).toEqual([]);
    abort.mockRestore();
    const retry = d.tree.saveTitleDraft(page, full);
    expect(d.tree.saveTitleDraft(page, full)).toBe(retry);
    await retry;
    expect(d.tree.pendingTitleDraft(page)).toBeUndefined();
    expect(d.tree.hasUnsavedWrites()).toBe(false);
    expect((await durable(d)).map((r) => r.text)).toEqual(['R'.repeat(245)]);
    expect((await d.db.getAll('ops')).length).toBe(1);
    expect(d.tree.get(page)?.title).toBe('H'.repeat(500));
  });

  it('el aviso posterior no convierte una TX confirmada en otro sobrante', async () => {
    const { d, page } = await setup();
    d.tree.onTitleRest = () => { throw new Error('Aviso fallido'); };
    await expect(d.tree.saveTitleDraft(page, full)).resolves.toBeUndefined();
    expect(await durable(d)).toHaveLength(1);
    expect(d.tree.pendingTitleDraft(page)).toBeUndefined();
    expect(await d.db.getAll('ops')).toHaveLength(1);
  });

  it('done(A) encolado detrás de una TX de B relee y no borra B con la caché anterior', async () => {
    const { d, page } = await setup();
    await d.tree.rename(page, 'Título A', { rest: 'resto A' });
    const a = (await durable(d))[0];
    const b = new PageTree(d.db, d.tree.workspaceId);
    await b.load();
    // B toma primero la exclusión real ops+meta; A todavía ve sólo su propia caché.
    const writing = b.rename(page, 'Título B', { rest: 'resto B' });
    const removing = d.tree.doneTitleRest(a.id);
    await Promise.all([writing, removing]);
    expect((await durable(d)).map((r) => r.text)).toEqual(['resto B']);
    expect(d.tree.titleRests().map((r) => r.text)).toEqual(['resto B']);
  });

  it('dos adiciones desde cachés distintas conservan ambas; cada retiro usa sólo su id', async () => {
    const { d, page } = await setup();
    const b = new PageTree(d.db, d.tree.workspaceId);
    await b.load();
    await Promise.all([
      d.tree.rename(page, 'A', { rest: 'uno' }),
      b.rename(page, 'B', { rest: 'dos' }),
    ]);
    const rests = await durable(d);
    expect(rests.map((r) => r.text)).toEqual(['uno', 'dos']);
    await b.doneTitleRest(rests[0].id);
    expect((await durable(d)).map((r) => r.text)).toEqual(['dos']);
  });

  it('el buffer pertenece a ese árbol y página; otra isla con el mismo UUID no lo recupera', async () => {
    const { d, page } = await setup();
    const fail = vi.spyOn(d.db, 'transaction').mockImplementationOnce(() => { throw new Error('Sin almacenamiento'); });
    await expect(d.tree.saveTitleDraft(page, full)).rejects.toThrow('Sin almacenamiento');
    fail.mockRestore();
    const other = await makeDevice(new FakeServer());
    devices.push(other);
    expect(other.tree.pendingTitleDraft(page)).toBeUndefined();
    expect(d.tree.pendingTitleDraft('otra-página')).toBeUndefined();
    expect(d.tree.pendingTitleDraft(page)?.fullText).toBe(full);
    await d.tree.saveTitleDraft(page, 'Elegido después');
    expect(d.tree.get(page)?.title).toBe('Elegido después');
    expect(await durable(d)).toEqual([]);
  });
});
