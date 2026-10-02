import { describe, expect, it } from 'vitest';
import { FakeServer, makeDevice } from '../sync/testing';
import { mediaIdOf } from './queue';

// La medida de un archivo para el marco de la primera anotación (Docs/Doc_Anotar_Fotos.md, auditoría B1 de la entrega
// 2): la del registro del dispositivo, también sin red, o la de la base; nunca la de la vista previa.

describe('la medida del archivo', () => {
  it('la del registro de quien la agregó (sin red también); otro dispositivo la pide a la base y después la sabe sin red', async () => {
    const server = new FakeServer();
    server.enableMedia();
    const a = await makeDevice(server);
    await a.engine.syncNow();
    const page = await a.tree.create(null, 'Día 3');
    await a.engine.syncNow();
    const url = await a.media.add(page, new File([new Uint8Array([0xff, 0xd8, 0xff, 1])], 'IMG_0001.JPG', { type: 'image/jpeg' }));
    await a.media.idle();
    const id = mediaIdOf(url)!;
    server.online = false;
    expect(await a.media.dimensions(id)).toEqual({ width: 4032, height: 3024 });
    server.online = true;
    for (let i = 0; i < 3; i++) await a.engine.syncMedia();
    const b = await makeDevice(server);
    await b.engine.syncNow();
    expect(await b.media.dimensions(id)).toEqual({ width: 4032, height: 3024 });
    server.online = false;
    expect(await b.media.dimensions(id)).toEqual({ width: 4032, height: 3024 });
    // Uno que nadie conoce: no se sabe.
    expect(await b.media.dimensions('0f8fad5b-d9cb-469f-a165-708677289599')).toBeNull();
  });
});
