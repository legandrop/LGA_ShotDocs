import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { addShape, deleteShape, PHOTO_MARKUP_MAP, removePhotoMarkup } from '../media/markup';
import { FakeServer, makeDevice, type Device } from './testing';

// Anotar sobre las fotos, entrega 0 (Docs/Doc_Anotar_Fotos.md, secciones 3 y 6): con el motor de verdad y el servidor en
// memoria, quien solo ve la página (la base limpia de D14) recibe las anotaciones vivas y nunca el texto de una forma
// borrada ni el de una foto podada (AN11). Cada texto es una marca única (`<tN>`) que se busca en los bytes guardados en
// el dispositivo de quien ve.

// La mutante: armar la base sin GC y sin la comprobación de privacidad (la prueba tiene que verla).
const mut = vi.hoisted(() => ({ nogc: false }));
vi.mock('./clean', async (importOriginal) => {
  const real = await importOriginal<typeof import('./clean')>();
  return {
    ...real,
    buildCleanBase: (rows: Uint8Array[]) => {
      if (!mut.nogc) return real.buildCleanBase(rows);
      const doc = new Y.Doc({ gc: false });
      if (rows.length > 0) Y.applyUpdate(doc, Y.mergeUpdates(rows));
      return { base: Y.encodeStateAsUpdate(doc), doc };
    },
    checkCleanBase: (base: Uint8Array, source: Y.Doc) => (mut.nogc ? null : real.checkCleanBase(base, source)),
  };
});

const devices: Device[] = [];
async function device(server: FakeServer, id?: string): Promise<Device> {
  const d = await makeDevice(server, undefined, '0.112', {}, undefined, id ? { id } : {});
  devices.push(d);
  return d;
}

const swallow = (e: unknown) => {
  if (String(e).includes('closed') || String(e).includes('InvalidStateError')) return;
  throw e;
};
process.on('unhandledRejection', swallow);
afterAll(() => {
  process.off('unhandledRejection', swallow);
});
afterEach(async () => {
  mut.nogc = false;
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    try {
      d.db.close();
      d.mediaDb.close();
      d.commentsDb.close();
    } catch {
      // ya cerrada
    }
  }
});

const TOKEN = /<t\d+>/g;
function tokensInBytes(list: Uint8Array[]): Set<string> {
  const out = new Set<string>();
  for (const bytes of list) for (const m of Buffer.from(bytes).toString('latin1').match(TOKEN) ?? []) out.add(m);
  return out;
}
async function stored(d: Device, pageId: string): Promise<Uint8Array[]> {
  return (await d.db.getAllFromIndex('docUpdates', 'pageId', pageId)).map((r) => r.data);
}
async function markupOf(d: Device, pageId: string): Promise<Record<string, unknown>> {
  const doc = new Y.Doc();
  const rows = await stored(d, pageId);
  if (rows.length > 0) Y.applyUpdate(doc, Y.mergeUpdates(rows));
  const out = doc.getMap(PHOTO_MARKUP_MAP).toJSON();
  doc.destroy();
  return out;
}
async function edit(d: Device, pageId: string, fn: (doc: Y.Doc) => void): Promise<void> {
  const doc = await d.docs.open(pageId);
  fn(doc);
  await d.docs.flush(pageId);
  d.docs.close(pageId);
}

const F1 = '0f8fad5b-d9cb-469f-a165-708677289501';
const F2 = '0f8fad5b-d9cb-469f-a165-708677289502';
const FRAME = { w: 4000, h: 3000 };
const label = (text: string) => ({ type: 'text', posX: 10, posY: 10, text, fontSize: 60 });

async function scenario() {
  const server = new FakeServer();
  let clock = Date.parse('2026-10-02T10:00:00Z');
  server.now = () => clock;
  server.enableTeam();
  server.enableClean(0.1);
  const e1 = await device(server);
  const page = await e1.tree.create(null, 'P');
  await e1.engine.syncNow();
  await edit(e1, page, (doc) => {
    doc.getText('t').insert(0, 'reporte ');
    addShape(doc, F1, 'vive', label('<t1>'), FRAME);
    addShape(doc, F1, 'borrada', label('<t2>'));
    addShape(doc, F2, 'podada', label('<t3>'), FRAME);
  });
  await e1.engine.syncNow();
  await edit(e1, page, (doc) => {
    deleteShape(doc, F1, 'borrada');
    removePhotoMarkup(doc, F2);
  });
  await e1.engine.syncNow();
  server.addMember('v', 'member');
  expect(await e1.engine.uploadPagesFirst(e1.engine.branchOf(page))).toBe(true);
  await e1.remote.share('v', { pageId: page }, 'view');
  clock += 60_000;
  await e1.engine.syncNow();
  const v = await device(server, 'v');
  await v.engine.syncNow();
  return { server, e1, v, page };
}

describe('la base limpia y las anotaciones', () => {
  it('quien solo ve recibe las anotaciones vivas, sin el texto de lo borrado ni de la foto podada', async () => {
    const { server, e1, v, page } = await scenario();
    expect(server.cleanPushes.map((p) => p.result)).toEqual(['ok']);
    expect(tokensInBytes(await stored(v, page))).toEqual(new Set(['<t1>']));
    expect(await markupOf(v, page)).toEqual(await markupOf(e1, page));
    expect(Object.keys(await markupOf(v, page)).sort()).toEqual([F1, `${F1}/vive`]);
    // El editor sigue con todo en las filas (el historial lo devuelve).
    expect(tokensInBytes(await stored(e1, page))).toEqual(new Set(['<t1>', '<t2>', '<t3>']));
  });

  it('la mutante: una base armada sin GC le llevaría el texto borrado (la prueba de arriba lo ve)', async () => {
    mut.nogc = true;
    const { v, page } = await scenario();
    expect(tokensInBytes(await stored(v, page))).toEqual(new Set(['<t1>', '<t2>', '<t3>']));
  });
});
