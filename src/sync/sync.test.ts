import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { FILE_SCHEME } from './files';
import { FakeServer, makeDevice, type Device } from './testing';

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

async function write(d: Device, pageId: string, fn: (text: Y.Text) => void): Promise<void> {
  const doc = await d.docs.open(pageId);
  fn(doc.getText('t'));
  await d.docs.flush(pageId);
  d.docs.close(pageId);
}

async function read(d: Device, pageId: string): Promise<string> {
  const doc = await d.docs.open(pageId);
  const text = doc.getText('t').toString();
  d.docs.close(pageId);
  return text;
}

describe('sincronización', () => {
  it('fusiona ediciones offline de dos dispositivos sobre la misma página', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const b = await device(server);

    const pageId = await a.tree.create(null, 'Escena 64');
    await write(a, pageId, (t) => t.insert(0, 'Guion.'));
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(b.tree.get(pageId)?.title).toBe('Escena 64');
    expect(await read(b, pageId)).toBe('Guion.');

    server.online = false;
    await write(a, pageId, (t) => t.insert(0, 'A: '));
    await write(b, pageId, (t) => t.insert(t.length, ' B.'));
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(a.engine.getStatus().online).toBe(false);
    expect(a.engine.getStatus().pendingPages).toBe(1);

    server.online = true;
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow();

    expect(await read(a, pageId)).toBe('A: Guion. B.');
    expect(await read(b, pageId)).toBe('A: Guion. B.');
    expect(a.engine.getStatus()).toMatchObject({ pendingPages: 0, pendingOps: 0, online: true });
    expect(b.engine.getStatus()).toMatchObject({ pendingPages: 0, pendingOps: 0, online: true });
  });

  it('reintentar después de perder la respuesta no duplica el update', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const pageId = await a.tree.create(null, 'P');
    await a.engine.syncNow();

    await write(a, pageId, (t) => t.insert(0, 'hola'));
    server.loseNextPushResponse = true;
    await a.engine.syncNow();
    expect(a.engine.getStatus().pendingPages).toBe(1);
    expect(server.updates.get(pageId)).toHaveLength(1);

    await a.engine.syncNow();
    expect(a.engine.getStatus().pendingPages).toBe(0);
    expect(server.updates.get(pageId)).toHaveLength(1);
  });

  it('lo editado antes de cerrar la app se sube al volver a abrirla', async () => {
    const server = new FakeServer();
    const dbName = crypto.randomUUID();
    const first = await device(server, dbName);
    const pageId = await first.tree.create(null, 'P');
    server.online = false;
    await write(first, pageId, (t) => t.insert(0, 'sin red'));
    first.engine.stop();
    first.db.close();

    server.online = true;
    const reopened = await device(server, dbName);
    expect(reopened.tree.get(pageId)?.title).toBe('P');
    await reopened.engine.syncNow();

    const other = await device(server);
    await other.engine.syncNow();
    expect(await read(other, pageId)).toBe('sin red');
  });

  it('una página creada offline se crea en el servidor antes de subir su contenido', async () => {
    const server = new FakeServer();
    const a = await device(server);
    server.online = false;
    const parent = await a.tree.create(null, 'Show');
    const child = await a.tree.create(parent, 'Escena 1');
    await write(a, child, (t) => t.insert(0, 'notas'));
    await a.engine.syncNow();
    expect(a.tree.children(parent).map((p) => p.id)).toEqual([child]);

    server.online = true;
    await a.engine.syncNow();
    expect(server.pages.get(child)?.parent_id).toBe(parent);
    expect(server.updates.get(child)).toHaveLength(1);
    expect(a.engine.getStatus()).toMatchObject({ pendingOps: 0, pendingPages: 0 });
  });

  it('un movimiento que arma un ciclo se rechaza y la página queda donde estaba', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const b = await device(server);
    const x = await a.tree.create(null, 'X');
    const y = await a.tree.create(null, 'Y');
    await a.engine.syncNow();
    await b.engine.syncNow();

    // Offline, cada movimiento es válido por separado; juntos arman un ciclo.
    server.online = false;
    await a.tree.move(x, y);
    await b.tree.move(y, x);
    server.online = true;
    await a.engine.syncNow();
    await b.engine.syncNow();

    expect(b.tree.failedOps()).toHaveLength(1);
    expect(b.tree.failedOps()[0].error).toBe('page_cycle');
    expect(server.pages.get(x)?.parent_id).toBe(y);
    expect(server.pages.get(y)?.parent_id).toBeNull();
    expect(b.tree.get(y)?.parent_id).toBeNull();
    expect(b.tree.get(x)?.parent_id).toBe(y);
    expect(b.engine.getStatus().failedOps).toBe(1);
  });

  it('una creación rechazada no esconde la página ni su contenido, y reintentar la sube', async () => {
    const server = new FakeServer();
    const a = await device(server);
    server.rejectCreates = true;
    const pageId = await a.tree.create(null, 'Rechazada');
    await write(a, pageId, (t) => t.insert(0, 'contenido valioso'));
    await a.tree.rename(pageId, 'Rechazada y renombrada');
    await a.engine.syncNow();

    expect(a.tree.failedOps().map((f) => f.op.kind)).toEqual(['create', 'update']);
    expect(a.tree.children(null).map((p) => p.id)).toEqual([pageId]);
    expect(await read(a, pageId)).toBe('contenido valioso');
    expect(server.updates.get(pageId)).toBeUndefined();

    expect(a.tree.get(pageId)?.title).toBe('Rechazada y renombrada');

    // Ocultar no descarta nada que pertenezca a una página que todavía no está en el servidor.
    await a.tree.dismissFailed();
    expect(a.tree.failedOps().map((f) => f.op.kind)).toEqual(['create', 'update']);
    expect(a.tree.get(pageId)?.title).toBe('Rechazada y renombrada');

    server.rejectCreates = false;
    await a.tree.rename(pageId, 'Aceptada');
    await a.tree.retryFailed();
    await a.engine.syncNow();
    expect(a.tree.failedOps()).toHaveLength(0);
    expect(server.pages.get(pageId)?.title).toBe('Aceptada');
    expect(server.updates.get(pageId)).toHaveLength(1);
    expect(a.engine.getStatus()).toMatchObject({ pendingOps: 0, pendingPages: 0 });
  });

  it('baja el contenido de páginas que nunca se abrieron en el dispositivo', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const id = await a.tree.create(null, `P${i}`);
      await write(a, id, (t) => t.insert(0, `contenido ${i}`));
      ids.push(id);
    }
    await a.engine.syncNow();

    const b = await device(server);
    await b.engine.syncNow();
    server.online = false;
    for (const [i, id] of ids.entries()) expect(await read(b, id)).toBe(`contenido ${i}`);
  });

  it('las ediciones rápidas se guardan juntas, sin fila de escrituras pendientes', async () => {
    const server = new FakeServer();
    const dbName = crypto.randomUUID();
    const a = await device(server, dbName);
    const pageId = await a.tree.create(null, 'P');
    const doc = await a.docs.open(pageId);
    const text = 'Escrito sin conexión.';
    for (const [i, ch] of [...text].entries()) doc.getText('t').insert(i, ch);
    await a.docs.flush(pageId);
    expect(await a.db.countFromIndex('docUpdates', 'pageId', pageId)).toBeLessThanOrEqual(2);
    a.docs.close(pageId);
    a.engine.stop();
    a.db.close();

    const reopened = await device(server, dbName);
    expect(await read(reopened, pageId)).toBe(text);
  });

  it('compactar los updates guardados no cambia el contenido', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const pageId = await a.tree.create(null, 'P');
    const doc = await a.docs.open(pageId);
    for (let i = 0; i < 100; i++) {
      doc.getText('t').insert(i, 'x');
      await a.docs.flush(pageId);
    }
    a.docs.close(pageId);
    expect(await a.db.countFromIndex('docUpdates', 'pageId', pageId)).toBe(100);

    expect(await read(a, pageId)).toBe('x'.repeat(100));
    expect(await a.db.countFromIndex('docUpdates', 'pageId', pageId)).toBe(1);
    expect(await read(a, pageId)).toBe('x'.repeat(100));
    await a.engine.syncNow();
    expect(a.engine.getStatus().pendingPages).toBe(0);
  });

  it('las imágenes se guardan en el dispositivo y se suben cuando hay red', async () => {
    const server = new FakeServer();
    const a = await device(server);
    server.online = false;
    const pageId = await a.tree.create(null, 'Fotos');
    const url = await a.files.add(pageId, new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
    expect(url.startsWith(FILE_SCHEME)).toBe(true);
    expect(await a.files.resolve(url)).toMatch(/^blob:/);
    await a.engine.syncNow();
    expect(a.engine.getStatus().pendingFiles).toBe(1);

    server.online = true;
    await a.engine.syncNow();
    expect(a.engine.getStatus().pendingFiles).toBe(0);
    expect(server.files.size).toBe(1);

    const b = await device(server);
    await b.engine.syncNow();
    expect(await b.files.resolve(url)).toMatch(/^blob:/);
    server.online = false;
    const again = await makeDevice(server);
    devices.push(again);
    await expect(again.files.resolve(url)).rejects.toThrow();
  });

  it('la papelera oculta la página y todo lo que tiene adentro, y restaurar la devuelve', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const p = await a.tree.create(null, 'P');
    const c = await a.tree.create(p, 'C');
    await a.tree.trash(p);
    expect(a.tree.children(null)).toHaveLength(0);
    expect(a.tree.isTrashed(c)).toBe(true);
    expect(a.tree.trashed().map((x) => x.id)).toEqual([p]);
    await a.engine.syncNow();
    expect(server.pages.get(p)?.deleted_at).not.toBeNull();

    await a.tree.restore(p);
    await a.engine.syncNow();
    expect(a.tree.children(null).map((x) => x.id)).toEqual([p]);
    expect(a.tree.children(p).map((x) => x.id)).toEqual([c]);
  });
});

describe('detener la sincronización', () => {
  it('stop() espera al ciclo en curso: después se puede cerrar la base sin errores sueltos', async () => {
    const server = new FakeServer();
    const a = await device(server);
    await a.tree.create(null, 'P');
    await a.engine.syncNow();

    // El ciclo queda esperando al servidor a la mitad.
    let release!: () => void;
    const fetchTree = a.remote.fetchTree.bind(a.remote);
    a.remote.fetchTree = async (ids) => {
      await new Promise<void>((r) => (release = r));
      return fetchTree(ids);
    };
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      // Como la app: nadie espera al ciclo.
      void a.engine.syncNow();
      await new Promise((r) => setTimeout(r, 10));
      expect(a.engine.getStatus().syncing).toBe(true);

      let stopped = false;
      const stopping = a.engine.stop().then(() => (stopped = true));
      await new Promise((r) => setTimeout(r, 10));
      expect(stopped).toBe(false);

      release();
      await stopping;
      expect(a.engine.getStatus().syncing).toBe(false);
      a.db.close();
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
