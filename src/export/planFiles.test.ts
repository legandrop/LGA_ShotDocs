import * as Y from 'yjs';
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { MEDIA_SCHEME } from '../media/queue';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice } from '../sync/testing';
import { appArchiveMedia, type ArchiveMedia } from './exportZip';
import { planFiles } from './planFiles';

// Qué archivos llevan las páginas que se exportan (la ventana *Export* avisa de «sin conexión» solo si hay alguno).

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

function docWith(...ids: string[]): Y.Doc {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment(CONTENT_FRAGMENT);
  const group = new Y.XmlElement('blockGroup');
  fragment.insert(0, [group]);
  for (const id of ids) {
    const container = new Y.XmlElement('blockContainer');
    const image = new Y.XmlElement('image');
    image.setAttribute('url', MEDIA_SCHEME + id);
    container.insert(0, [image]);
    group.insert(group.length, [container]);
  }
  return doc;
}

const source = (pages: Record<string, Y.Doc | 'error'>) => ({
  snapshot: async (id: string) => {
    const doc = pages[id];
    if (!doc || doc === 'error') throw new Error('no se puede leer');
    return { doc, state: {} as never, dirty: false, supported: true };
  },
});

function media(files: Record<string, { kind: 'image' | 'video' | 'file'; deleted?: boolean; folder?: boolean; original?: boolean }>): ArchiveMedia {
  return {
    meta: async (id) => {
      const f = files[id];
      return f ? ({ name: id, mime: '', kind: f.kind, size: 1, created: null, deleted: !!f.deleted, folder: !!f.folder } as never) : null;
    },
    hasOriginal: async (id) => !!files[id]?.original,
    original: async () => null,
    preview: async () => null,
    pass: async () => '',
  };
}

describe('planFiles', () => {
  it.each([
    { name: 'no soportada', supported: false, state: {} },
    { name: 'ilegible', supported: true, state: { unreadable: true } },
  ])('una página $name conserva el aviso y los archivos que sí se pueden leer', async ({ supported, state }) => {
    const doc = docWith(A);
    const read = { snapshot: async () => ({ doc, supported, state }) };
    const destroy = vi.spyOn(doc, 'destroy');
    expect(await planFiles([{ id: 'p' }], read, media({ [A]: { kind: 'file' } }))).toEqual({ files: 1, photosWithoutOriginal: 0, unknown: true });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('un archivo desconocido se cuenta sin pedir metadatos a la red', async () => {
    const device = await makeDevice(new FakeServer());
    const fetch = vi.spyOn(device.remote, 'fetchMediaFiles');
    try {
      const found = await planFiles([{ id: 'p' }], source({ p: docWith(A) }), appArchiveMedia(device.media, device.mediaDb));
      expect(found.files).toBe(1);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await device.engine.stop();
      device.db.close();
      device.mediaDb.close();
      device.commentsDb.close();
    }
  });

  it('sin ningún archivo: nada (y sin tocar los archivos)', async () => {
    const found = await planFiles([{ id: 'p' }], source({ p: docWith() }), media({}));
    expect(found).toEqual({ files: 0, photosWithoutOriginal: 0, unknown: false });
  });

  it('cuenta los archivos distintos de todas las páginas, sin los borrados', async () => {
    const found = await planFiles(
      [{ id: 'p' }, { id: 'q' }],
      source({ p: docWith(A, B), q: docWith(B, C) }),
      media({ [A]: { kind: 'image', original: true }, [B]: { kind: 'file' }, [C]: { kind: 'image', deleted: true } }),
    );
    expect(found.files).toBe(1);
    expect(found.photosWithoutOriginal).toBe(0);
  });

  it('las fotos sin su original en el dispositivo; un adjunto o un video no cuentan como foto', async () => {
    const found = await planFiles(
      [{ id: 'p' }],
      source({ p: docWith(A, B, C) }),
      media({ [A]: { kind: 'image', original: false }, [B]: { kind: 'video', original: false }, [C]: { kind: 'file' } }),
    );
    expect(found).toEqual({ files: 2, photosWithoutOriginal: 1, unknown: false });
  });

  it('una página que no se puede leer deja la duda (los avisos salen por las dudas)', async () => {
    const found = await planFiles([{ id: 'p' }, { id: 'q' }], source({ p: docWith(), q: 'error' }), media({}));
    expect(found.unknown).toBe(true);
  });

  it('sin la base de archivos: lo que se sabe es la cantidad', async () => {
    expect((await planFiles([{ id: 'p' }], source({ p: docWith(A, B) }), null)).files).toBe(2);
  });
});
