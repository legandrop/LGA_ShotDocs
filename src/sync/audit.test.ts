import { afterEach, describe, expect, it } from 'vitest';
import { FileRejected } from './files';
import { FakeServer, makeDevice, type Device } from './testing';

// Casos que encontró la auditoría de cierre de la fase 1.

const devices: Device[] = [];
async function device(server: FakeServer, dbName?: string): Promise<Device> {
  const d = await makeDevice(server, dbName);
  devices.push(d);
  return d;
}

afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
  }
});

async function read(d: Device, pageId: string): Promise<string> {
  const doc = await d.docs.open(pageId);
  const text = doc.getText('t').toString();
  d.docs.close(pageId);
  return text;
}

describe('auditoría de la fase 1', () => {
  it('dos pestañas con la misma base: lo que escribe una no queda marcado como subido por la otra', async () => {
    const server = new FakeServer();
    const dbName = crypto.randomUUID();
    const tabA = await device(server, dbName);
    const pageId = await tabA.tree.create(null, 'P');
    const docA = await tabA.docs.open(pageId);
    docA.getText('t').insert(0, 'A1 ');
    await tabA.docs.flush(pageId);
    await tabA.engine.syncNow();

    const tabB = await device(server, dbName);
    const docB = await tabB.docs.open(pageId);
    docB.getText('t').insert(docB.getText('t').length, 'B-EDIT');
    await tabB.docs.flush(pageId);

    // La pestaña A sube sin tener en memoria lo que escribió B.
    await tabA.engine.syncNow();
    expect(tabA.engine.getStatus().pendingPages).toBe(0);

    const other = await device(server);
    await other.engine.syncNow();
    expect(await read(other, pageId)).toBe('A1 B-EDIT');
  });

  it('un ciclo en el árbol no cuelga la app ni esconde las páginas', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const now = new Date().toISOString();
    const row = (id: string, parent: string | null) => ({
      id,
      workspace_id: server.workspaceId,
      parent_id: parent,
      title: id,
      icon: null,
      sort_key: 'a0',
      update_seq: 0,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    });
    await a.tree.setSnapshot([row('root', null), row('X', 'Y'), row('Y', 'X'), row('hija', 'X')]);
    expect(a.tree.isTrashed('X')).toBe(false);
    expect(a.tree.children(null).map((p) => p.id).sort()).toEqual(['X', 'Y', 'root']);
    expect(a.tree.children('X').map((p) => p.id)).toEqual(['hija']);
  });

  it('si no se puede guardar en el dispositivo, avisa, no lo da por sincronizado y reintenta', async () => {
    const server = new FakeServer();
    const dbName = crypto.randomUUID();
    const a = await device(server, dbName);
    const pageId = await a.tree.create(null, 'P');
    await a.engine.syncNow();

    const realTransaction = a.db.transaction.bind(a.db);
    let failing = true;
    (a.db as { transaction: unknown }).transaction = ((stores: string | string[], mode?: IDBTransactionMode) => {
      const names = [stores].flat();
      // Así escribe una edición local; la carga al abrir usa otra transacción.
      if (failing && mode === 'readwrite' && names.includes('docUpdates') && names.includes('docState')) {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }
      return realTransaction(stores as never, mode);
    }) as never;

    const doc = await a.docs.open(pageId);
    doc.getText('t').insert(0, 'importante');
    await a.docs.flush(pageId);
    await a.engine.syncNow();
    expect(a.engine.getStatus().localError).toMatch(/Quota/);
    expect(a.engine.getStatus().pendingPages).toBe(1);
    a.docs.close(pageId);
    await new Promise((r) => setTimeout(r, 20));
    expect(a.docs.hasUnsavedEdits()).toBe(true);

    failing = false;
    const again = await a.docs.open(pageId);
    expect(again.getText('t').toString()).toBe('importante');
    again.getText('t').insert(again.getText('t').length, '!');
    await a.docs.flush(pageId);
    a.docs.close(pageId);
    expect(a.engine.getStatus().localError).toBeNull();
    await a.engine.syncNow();
    expect(a.engine.getStatus().pendingPages).toBe(0);

    const other = await device(server);
    await other.engine.syncNow();
    expect(await read(other, pageId)).toBe('importante!');
  });

  it('un contenido que el servidor rechaza para siempre se marca y no queda "reintentando"', async () => {
    const server = new FakeServer();
    server.maxUpdateBytes = 200;
    const a = await device(server);
    const pageId = await a.tree.create(null, 'P');
    const doc = await a.docs.open(pageId);
    doc.getText('t').insert(0, 'x'.repeat(500));
    await a.docs.flush(pageId);
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ rejectedPages: 1, pendingPages: 1 });
    expect(a.engine.getStatus().lastError).toBe('update_size_invalid');

    server.maxUpdateBytes = 8 * 1024 * 1024;
    await a.engine.retryRejected();
    expect(a.engine.getStatus()).toMatchObject({ rejectedPages: 0, pendingPages: 0 });
    a.docs.close(pageId);
  });

  it('una imagen que no sube no frena la subida del texto', async () => {
    const server = new FakeServer();
    server.failUploads = true;
    const a = await device(server);
    const pageId = await a.tree.create(null, 'P');
    await a.files.add(pageId, new Blob([new Uint8Array(10)], { type: 'image/jpeg' }));
    const doc = await a.docs.open(pageId);
    doc.getText('t').insert(0, 'texto del reporte');
    await a.docs.flush(pageId);
    await a.engine.syncNow();
    await a.engine.syncNow();
    expect(server.updates.get(pageId)?.length).toBeGreaterThan(0);
    expect(a.engine.getStatus()).toMatchObject({ pendingPages: 0, pendingFiles: 1 });
    a.docs.close(pageId);
  });

  it('solo acepta imágenes raster de hasta 25 MB', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const pageId = await a.tree.create(null, 'P');
    await expect(a.files.add(pageId, new Blob(['<svg/>'], { type: 'image/svg+xml' }))).rejects.toThrow(FileRejected);
    await expect(a.files.add(pageId, new Blob(['%PDF'], { type: 'application/pdf' }))).rejects.toThrow(FileRejected);
    const big = { type: 'image/jpeg', size: 26 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(0) };
    await expect(a.files.add(pageId, big as unknown as Blob)).rejects.toThrow(/25 MB/);
    expect(await a.files.pendingCount()).toBe(0);
  });
});
