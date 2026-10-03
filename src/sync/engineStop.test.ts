import { afterEach, describe, expect, it } from 'vitest';
import { FakeServer, makeDevice, type Device } from './testing';

// Un motor detenido no consulta la base: al cerrar la sesión o cambiar de workspace se hace `stop()` y se cierra la
// base, y un conteo (`refreshCounts`) que quedó en vuelo (esperando las escrituras locales) no puede reventar contra
// la base ya cerrada ni dejar un error sin atender.

const rejections: unknown[] = [];
const onRejection = (e: unknown) => void rejections.push(e);
process.on('unhandledRejection', onRejection);

const devices: Device[] = [];
afterEach(async () => {
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  rejections.length = 0;
});

describe('motor detenido', () => {
  it('un conteo en vuelo cuando se cierra la base no deja ningún error sin atender', async () => {
    const d = await makeDevice(new FakeServer());
    devices.push(d);
    const pageId = await d.tree.create(null, 'Brief');
    await d.engine.syncNow();
    rejections.length = 0;

    // La base se cierra justo después de que la edición se guardó y el motor pidió contar (su `poke`): el conteo
    // sigue en vuelo (espera a las escrituras) y cuando sigue ya no hay base. Se registra después del motor, así
    // que corre en el mismo aviso, pegado a él.
    const off = d.docs.subscribeLocalChange(() => {
      void d.engine.stop();
      d.db.close();
    });
    const doc = await d.docs.open(pageId);
    doc.getText('t').insert(0, 'x');
    await d.docs.flush(pageId);
    off();
    d.docs.close(pageId);
    // Que terminen las promesas en vuelo y el recolector de rechazos sin atender.
    await new Promise((r) => setTimeout(r, 200));
    expect(rejections).toEqual([]);
  });
});
