import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { FakeServer, makeDevice, type Device } from './testing';

// Roadmap B.15: cada subida de contenido llevaba todos los borrados de la página (el "delete set" de Yjs).
// Lo que se sube tiene que crecer con lo nuevo, no con la historia de la página.

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

/** Bytes de cada subida de la página, en orden. */
function uploadSizes(server: FakeServer, pageId: string): number[] {
  return (server.updates.get(pageId) ?? []).map((u) => u.data.length);
}

const average = (list: number[]): number => list.reduce((a, b) => a + b, 0) / list.length;

describe('B.15: cada subida lleva solo los borrados nuevos', () => {
  it('200 ediciones con borrados: lo subido no crece con la historia', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const pageId = await a.tree.create(null, 'P');
    await write(a, pageId, (t) => t.insert(0, 'Plano general de la calle, de noche, con lluvia. '.repeat(4)));
    await a.engine.syncNow();

    const EDITS = 200;
    for (let i = 0; i < EDITS; i++) {
      // Cada edición abre la página (un autor de Yjs nuevo, como cada sesión de la app), escribe y borra.
      await write(a, pageId, (t) => {
        t.insert((i * 7) % t.length, `toma ${i} `);
        t.delete((i * 13) % (t.length - 4), 3);
      });
      await a.engine.syncNow();
    }

    const sizes = uploadSizes(server, pageId).slice(1);
    expect(sizes).toHaveLength(EDITS);
    const first = average(sizes.slice(0, 20));
    const last = average(sizes.slice(-20));
    console.log(
      `B.15 subidas: primeras 20 ${first.toFixed(0)} B, últimas 20 ${last.toFixed(0)} B, total ${sizes.reduce((x, y) => x + y, 0)} B`,
    );
    // Lo de cada edición (una palabra, un borrado y un autor nuevo) pesa unas decenas de bytes. Con los
    // borrados repetidos, la subida 200 lleva los 200 borrados anteriores (más de 2 KB).
    expect(last).toBeLessThan(first * 1.5);
    expect(last).toBeLessThan(120);

    // Y no se perdió nada: un dispositivo nuevo arma lo mismo que el que escribió.
    const c = await device(server);
    await c.engine.syncNow();
    const docA = await a.docs.open(pageId);
    const docC = await c.docs.open(pageId);
    expect(docC.getText('t').toString()).toBe(docA.getText('t').toString());
    a.docs.close(pageId);
    c.docs.close(pageId);
  });
});
