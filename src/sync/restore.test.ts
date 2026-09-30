import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { FakeServer, makeDevice, type Device } from './testing';

const devices: Device[] = [];
async function device(server: FakeServer, dbName?: string, appVersion?: string): Promise<Device> {
  const d = await makeDevice(server, dbName, appVersion);
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

describe('restaurar una copia de seguridad', () => {
  it('lo hecho después de la copia vuelve al servidor desde los dispositivos', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const b = await device(server);

    const escena = await a.tree.create(null, 'Escena 64');
    await write(a, escena, (t) => t.insert(0, 'Antes de la copia.'));
    await a.engine.syncNow();
    await b.engine.syncNow();

    const restore = server.backup();

    // Después de la copia: A crea una página con una imagen, edita y renombra; B escribe en otra línea.
    const nueva = await a.tree.create(escena, 'Plano 3');
    await write(a, nueva, (t) => t.insert(0, 'Nueva.'));
    await write(a, escena, (t) => t.insert(t.length, ' A después.'));
    await a.tree.rename(escena, 'Escena 64 · Restaurante');
    const url = await a.files.add(nueva, new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
    await a.engine.syncNow();
    await b.engine.syncNow();
    await write(b, escena, (t) => t.insert(t.length, ' B después.'));
    await b.engine.syncNow();
    expect(server.pages.has(nueva)).toBe(true);

    restore();
    expect(server.pages.has(nueva)).toBe(false);
    expect(server.files.size).toBe(0);

    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow();

    expect(a.engine.getStatus().notice).toMatch(/restored from a backup/);
    expect(server.pages.get(nueva)?.parent_id).toBe(escena);
    expect(server.pages.get(escena)?.title).toBe('Escena 64 · Restaurante');
    expect(server.files.size).toBe(1);

    // Un dispositivo nuevo ve todo lo que se había hecho después de la copia.
    const c = await device(server);
    await c.engine.syncNow();
    expect(c.tree.get(nueva)?.title).toBe('Plano 3');
    expect(await read(c, nueva)).toBe('Nueva.');
    expect(await read(c, escena)).toBe('Antes de la copia. A después. B después.');
    expect(await c.files.resolve(url)).toMatch(/^blob:/);
    for (const d of [a, b, c]) {
      expect(d.engine.getStatus().pendingPages).toBe(0);
      expect(d.engine.getStatus().failedOps).toBe(0);
    }
  });

  it('un dispositivo que entra por primera vez no vuelve a subir nada', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const page = await a.tree.create(null, 'Escena');
    await write(a, page, (t) => t.insert(0, 'Texto.'));
    await a.engine.syncNow();
    const before = server.updates.get(page)?.length;

    const b = await device(server);
    await b.engine.syncNow();
    await b.engine.syncNow();
    expect(server.updates.get(page)?.length).toBe(before);
    expect(b.engine.getStatus().notice).toBeNull();
  });

  it('un dispositivo nuevo en un workspace ya restaurado no recupera ni avisa nada', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const page = await a.tree.create(null, 'Escena');
    await write(a, page, (t) => t.insert(0, 'Texto.'));
    await a.engine.syncNow();
    server.backup()();
    await a.engine.syncNow();
    const before = server.updates.get(page)?.length;

    const b = await device(server);
    await b.engine.syncNow();
    expect(b.engine.getStatus().notice).toBeNull();
    expect(server.updates.get(page)?.length).toBe(before);
    expect(await read(b, page)).toBe('Texto.');
  });

  it('un dispositivo que no sabía de generaciones igual se recupera al actualizar', async () => {
    const server = new FakeServer();
    const a = await device(server, 'viejo');
    const page = await a.tree.create(null, 'Escena');
    await a.engine.syncNow();
    const restore = server.backup();
    await write(a, page, (t) => t.insert(0, 'Después de la copia.'));
    await a.engine.syncNow();
    // Como una versión anterior: nunca guardó la generación.
    await a.db.delete('meta', 'generation');
    restore();

    a.engine.stop();
    const updated = await device(server, 'viejo');
    await updated.engine.syncNow();
    const c = await device(server);
    await c.engine.syncNow();
    expect(await read(c, page)).toBe('Después de la copia.');
  });

  it('lo que un dispositivo vio antes de la copia no pisa lo restaurado', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const b = await device(server);
    const page = await a.tree.create(null, 'Viejo');
    await a.engine.syncNow();
    await b.engine.syncNow();

    // B se queda sin red; A renombra, se hace la copia, y después se restaura.
    await a.tree.rename(page, 'Nuevo');
    await a.engine.syncNow();
    const restore = server.backup();
    restore();

    await b.engine.syncNow();
    expect(server.pages.get(page)?.title).toBe('Nuevo');
    expect(b.tree.get(page)?.title).toBe('Nuevo');
  });

  it('lo que estaba en la cola sin subir va después de lo recuperado', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const page = await a.tree.create(null, 'A');
    await a.engine.syncNow();
    const restore = server.backup();

    // Después de la copia, subido: un renombre y una página nueva.
    await a.tree.rename(page, 'B');
    const hija = await a.tree.create(null, 'Hija');
    await a.engine.syncNow();
    // Sin red: otro renombre, una página adentro de la nueva y un renombre de la nueva.
    server.online = false;
    await a.tree.rename(page, 'C');
    const nieta = await a.tree.create(hija, 'Nieta');
    await a.tree.rename(hija, 'Hija 2');
    await a.engine.syncNow();

    restore();
    server.online = true;
    // Lo recuperado queda antes en la cola, también en lo guardado en el dispositivo.
    await a.tree.recoverAfterRestore([...server.pages.values()], [...server.projects.values()]);
    const saved = (await a.db.getAll('ops')).map((o) => o.opId);
    expect(a.tree.pendingOps().map((o) => o.opId)).toEqual(saved);
    expect(a.tree.pendingOps()[0].op).toMatchObject({ kind: 'create', page: { id: hija } });

    await a.engine.syncNow();
    expect(server.pages.get(page)?.title).toBe('C');
    expect(server.pages.get(hija)?.title).toBe('Hija 2');
    expect(server.pages.get(nieta)?.parent_id).toBe(hija);
    expect(a.tree.failedOps()).toHaveLength(0);
  });

  it('una página vacía no manda un update vacío después de restaurar', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const page = await a.tree.create(null, 'Vacía');
    await a.engine.syncNow();
    await a.docs.resetForRestore();
    await a.engine.syncNow();
    expect(server.updates.get(page) ?? []).toHaveLength(0);
  });
});

describe('versión mínima del workspace', () => {
  it('una versión vieja guarda lo suyo en el dispositivo y lo sube después de actualizar', async () => {
    const server = new FakeServer();
    const a = await device(server, 'viejo', '0.020');
    const page = await a.tree.create(null, 'Escena');
    await a.engine.syncNow();

    server.settings = { ...server.settings!, minAppVersion: 0.021 };
    await write(a, page, (t) => t.insert(0, 'Hecho con la versión vieja.'));
    await a.engine.syncNow();
    expect(a.engine.getStatus().outdated).toBe(true);
    expect(a.engine.getStatus().pendingPages).toBe(1);
    expect(a.engine.getStatus().rejectedPages).toBe(0);
    expect(server.updates.get(page) ?? []).toHaveLength(0);

    // La misma base local, abierta por la versión nueva.
    a.engine.stop();
    const updated = await device(server, 'viejo', '0.021');
    await updated.engine.syncNow();
    expect(updated.engine.getStatus().outdated).toBe(false);
    expect(updated.engine.getStatus().pendingPages).toBe(0);
    const c = await device(server);
    await c.engine.syncNow();
    expect(await read(c, page)).toBe('Hecho con la versión vieja.');
  });

  it('una base sin la tabla de ajustes sigue sincronizando', async () => {
    const server = new FakeServer();
    server.settings = null;
    const a = await device(server);
    const page = await a.tree.create(null, 'Escena');
    await write(a, page, (t) => t.insert(0, 'Texto.'));
    await a.engine.syncNow();
    expect(a.engine.getStatus().pendingPages).toBe(0);
    expect(a.engine.getStatus().outdated).toBe(false);
  });
});
