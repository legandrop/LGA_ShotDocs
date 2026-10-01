import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { OfflineManager } from './offline';
import { canMakeSharp, estimateSharp, needsSharp, wanted, weigh, type FileFacts } from './offlinePlan';
import {
  ATTACHMENT_MAX_BYTES,
  cleanOrphans,
  DEFAULT_OPTIONS,
  dropCopy,
  getCopy,
  listMarks,
  markGone,
  offviewKey,
  partKey,
  protects,
  readCopy,
} from './offlineStore';
import { MEDIA_SCHEME, mediaIdOf, VIEW_PREFIX } from './queue';
import { createCarreteLoader } from '../ui/carreteLoader';
import { collectCarrete } from '../ui/carreteModel';
import { FileRejected } from '../sync/files';

// "Available offline" y el tope del espacio en el dispositivo (Docs/Doc_Copias_Locales.md, entrega 1), con el
// servidor y el portero en memoria (src/sync/testing.ts).

const MB = 1024 * 1024;
const devices: Device[] = [];

afterEach(() => {
  for (const d of devices.splice(0)) {
    d.offline.stop();
    d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  vi.restoreAllMocks();
});

async function device(server: FakeServer, dbName?: string): Promise<Device> {
  const d = await makeDevice(server, dbName);
  devices.push(d);
  return d;
}

async function sync(d: Device): Promise<void> {
  await d.engine.syncNow();
  await d.engine.syncMedia();
  await d.engine.syncNow();
  await d.engine.syncMedia();
}

/** Bytes que se distinguen (para comprobar que la copia es el archivo). */
function bytes(size: number, seed = 1): Uint8Array<ArrayBuffer> {
  return Uint8Array.from({ length: size }, (_, i) => (i * 31 + seed * 7 + (i >> 9)) % 256);
}

const file = (size: number, name: string, type: string, seed = 1) => new File([bytes(size, seed)], name, { type });

function insert(doc: Y.Doc, fileId: string): void {
  const fragment = doc.getXmlFragment(CONTENT_FRAGMENT);
  doc.transact(() => {
    if (fragment.length === 0) fragment.insert(0, [new Y.XmlElement('blockGroup')]);
    const group = fragment.get(0) as Y.XmlElement;
    const container = new Y.XmlElement('blockContainer');
    container.setAttribute('id', crypto.randomUUID());
    const image = new Y.XmlElement('image');
    image.setAttribute('url', MEDIA_SCHEME + fileId);
    container.insert(0, [image]);
    group.insert(group.length, [container]);
  });
}

function remove(doc: Y.Doc, fileId: string): void {
  const group = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
  const at = group
    .toArray()
    .findIndex((c) => ((c as Y.XmlElement).get(0) as Y.XmlElement | undefined)?.getAttribute('url') === MEDIA_SCHEME + fileId);
  if (at >= 0) group.delete(at, 1);
}

async function edit(d: Device, pageId: string, change: (doc: Y.Doc) => void): Promise<void> {
  const doc = await d.docs.open(pageId);
  change(doc);
  d.docs.close(pageId);
  await d.docs.flush();
}

/**
 * El dueño agrega en su dispositivo una página con una foto, un video y un PDF, y otra subpágina con otra foto; otro
 * dispositivo (de la misma persona) los ve sin tener los originales.
 */
async function setup(options: { videoSize?: number } = {}) {
  const server = new FakeServer();
  server.enableTrash();
  const a = await device(server);
  await sync(a);
  const page = await a.tree.create(null, 'Escena 12');
  const child = await a.tree.create(page, 'Plano 3');
  await sync(a);
  const photo = mediaIdOf(await a.media.add(page, file(2 * MB, 'IMG_0001.JPG', 'image/jpeg', 1)))!;
  const video = mediaIdOf(await a.media.add(page, file(options.videoSize ?? MB, 'IMG_0002.MOV', 'video/quicktime', 2)))!;
  const pdf = mediaIdOf(await a.media.add(page, file(300 * 1024, 'guion.pdf', 'application/pdf', 3)))!;
  const photo2 = mediaIdOf(await a.media.add(child, file(MB, 'IMG_0003.JPG', 'image/jpeg', 4)))!;
  await edit(a, page, (doc) => {
    insert(doc, photo);
    insert(doc, video);
    insert(doc, pdf);
  });
  await edit(a, child, (doc) => insert(doc, photo2));
  await sync(a);
  const b = await device(server);
  await sync(b);
  return { server, a, b, page, child, photo, video, pdf, photo2 };
}

async function markAndWait(d: Device, kind: 'page' | 'project', target: string, options = DEFAULT_OPTIONS): Promise<string> {
  const id = await d.offline.mark(kind, target, options);
  await d.offline.idle();
  return id;
}

describe('los pesos (sin tocar nada)', () => {
  const photo = (over: Partial<FileFacts> = {}): FileFacts => ({
    id: 'p',
    kind: 'image',
    mime: 'image/jpeg',
    size: 2_400_000,
    width: 4032,
    height: 3024,
    inDrive: true,
    deleted: false,
    ownBlob: false,
    copy: false,
    offview: false,
    view2048: false,
    thumb: true,
    thumbAt: true,
    ...over,
  });

  it('la nítida estimada: por píxeles, nunca más que el original; un JPEG chico que ya entra, tal cual', () => {
    expect(estimateSharp(photo(), false)).toBe(Math.round((2048 * 1536 * 0.9) / 8));
    expect(estimateSharp(photo(), true)).toBe(Math.round((2048 * 1536 * 1.5) / 8));
    expect(estimateSharp(photo({ size: 100_000 }), false)).toBe(100_000);
    expect(estimateSharp(photo({ width: 1600, height: 1200, size: 500_000 }), false)).toBe(500_000);
    expect(estimateSharp(photo({ width: null, height: null }), false)).toBe(400 * 1024);
    expect(needsSharp(photo({ width: 500, height: 400 }))).toBe(false);
    expect(canMakeSharp(photo({ mime: 'image/heic' }))).toBe(false);
  });

  it('todas las filas pesan, también lo destildado; un adjunto de más de 50 MB va aparte', () => {
    const facts: FileFacts[] = [
      photo(),
      photo({ id: 'own', ownBlob: true }),
      photo({ id: 'heic', mime: 'image/heic' }),
      { ...photo({ id: 'v' }), kind: 'video', mime: 'video/quicktime', size: 50 * MB },
      { ...photo({ id: 'pdf' }), kind: 'file', mime: 'application/pdf', size: 3 * MB, thumb: false, thumbAt: false },
      { ...photo({ id: 'big' }), kind: 'file', mime: 'application/zip', size: ATTACHMENT_MAX_BYTES + 1 },
    ];
    const w = weigh(facts, 2, false);
    expect(w.rows.sharp.count).toBe(3);
    expect(w.rows.sharp.cantLarge).toBe(1);
    // La foto propia se reduce acá: ocupa, pero no se baja.
    expect(w.rows.sharp.network).toBe(2_400_000);
    expect(w.rows.originals.count).toBe(3);
    expect(w.rows.originals.own).toEqual({ count: 1, bytes: 2_400_000 });
    expect(w.rows.originals.present).toBe(2_400_000);
    expect(w.rows.videos.missing).toBe(50 * MB);
    expect(w.rows.attachments.count).toBe(1);
    expect(w.rows.attachments.over).toEqual({ count: 1, bytes: ATTACHMENT_MAX_BYTES + 1 });
    expect(w.extras.older).toBe(2);
    // Lo que pide cada casilla.
    expect(wanted(photo(), DEFAULT_OPTIONS)).toEqual({ orig: false, view: true });
    expect(wanted(photo(), { ...DEFAULT_OPTIONS, originals: true })).toEqual({ orig: true, view: false });
    expect(wanted({ ...photo(), kind: 'file', size: ATTACHMENT_MAX_BYTES + 1 }, DEFAULT_OPTIONS)).toEqual({ orig: false, view: false });
  });
});

describe('Available offline', { timeout: 30_000 }, () => {
  it('de fábrica: las nítidas de 2048 y las miniaturas de toda la rama; sin red se ven igual', async () => {
    const { server, b, page, photo, photo2, video } = await setup();
    const planned: number[] = [];
    const plan = await b.offline.plan('page', page, (s) => planned.push(s.weights.rows.sharp.count));
    expect(plan.pages).toBe(2);
    expect(plan.remote).toBe(true);
    expect(planned.length).toBe(2);
    expect(plan.weights.rows.videos.missing).toBe(MB);

    await markAndWait(b, 'page', page);
    for (const id of [photo, photo2]) {
      expect(await b.mediaDb.get('thumbs', offviewKey(id))).toBeInstanceOf(Blob);
      // El original no se guarda (solo con *Original photos*).
      expect(await readCopy(b.mediaDb, id)).toBeNull();
    }
    expect(await b.mediaDb.get('thumbs', video)).toBeInstanceOf(Blob);
    const [mark] = await listMarks(b.mediaDb);
    expect(mark.state).toBe('ready');

    // Sin red, la página muestra la nítida de la marca sin bajar nada.
    server.online = false;
    const download = vi.fn(async () => new Blob());
    expect((await b.media.view(photo, { download }))?.side).toBe(2048);
    expect(download).not.toHaveBeenCalled();
    // Un `clearViews` (falta lugar, o una versión vieja) no la toca: no está en `viewIndex`.
    await b.media.clearViews();
    expect(await b.mediaDb.get('thumbs', offviewKey(photo))).toBeInstanceOf(Blob);
  });

  it('*Original photos*, *Videos* y adjuntos: copias enteras por partes, y el carrete las abre sin red', async () => {
    const { server, b, page, photo, video, pdf } = await setup();
    await markAndWait(b, 'page', page, { ...DEFAULT_OPTIONS, originals: true, videos: true });
    expect(new Uint8Array(await (await readCopy(b.mediaDb, photo))!.arrayBuffer())).toEqual(bytes(2 * MB, 1));
    expect((await readCopy(b.mediaDb, video))?.size).toBe(MB);
    expect(new Uint8Array(await (await readCopy(b.mediaDb, pdf))!.arrayBuffer())).toEqual(bytes(300 * 1024, 3));
    server.online = false;
    expect((await b.media.source(video)).original?.size).toBe(MB);
    expect((await b.media.localImage(photo))?.size).toBe(2 * MB);
    expect((await b.media.localOriginal(pdf))?.type).toBe('application/pdf');
    // Las partes se pidieron con `?offline=1`.
    const gets = server.portero.calls.filter((c) => c.method === 'GET' && c.path.startsWith('/m/'));
    expect(gets.length).toBeGreaterThan(0);
  });

  it('con un portero viejo que corta las partes (caché del arranque), avanza por el Content-Range real', { timeout: 60_000 }, async () => {
    const { server, b, page, video } = await setup({ videoSize: 3 * MB + 123 });
    server.portero.oldOffline = true;
    server.portero.shortParts = 254 * 1024;
    await markAndWait(b, 'page', page, { ...DEFAULT_OPTIONS, videos: true });
    const copy = await readCopy(b.mediaDb, video);
    expect(copy?.size).toBe(3 * MB + 123);
    expect(new Uint8Array(await copy!.arrayBuffer())).toEqual(bytes(3 * MB + 123, 2));
    expect((await getCopy(b.mediaDb, video))!.orig!.parts.length).toBeGreaterThan(10);
  });

  it('una página a medio bajar solo suma; con la página completa, quita (y "listo" espera a todas)', async () => {
    const { b, page, child, photo2 } = await setup();
    await markAndWait(b, 'page', page);
    const markOf = async () => (await listMarks(b.mediaDb))[0];
    expect((await markOf()).files[photo2]).toBeDefined();

    // En este dispositivo el documento ya no usa la foto, pero el servidor tiene contenido que todavía no bajó.
    await edit(b, child, (doc) => remove(doc, photo2));
    const rows = [...b.tree.children(page), b.tree.get(page)!].map((r) => (r.id === child ? { ...r, update_seq: r.update_seq + 5 } : r));
    await b.tree.setSnapshot([...rows], b.tree.projects());
    await b.offline.maintain();
    await b.offline.idle();
    expect((await markOf()).files[photo2]).toBeDefined();
    expect(protects(await listMarks(b.mediaDb), photo2).view).toBe(true);
    expect((await markOf()).state).toBe('waiting');
    expect(b.offline.getSnapshot().marks[0].waitingPages).toBe(1);

    // Con la página completa, sale del conjunto.
    const cursor = (await b.docs.states()).get(child)!.cursor;
    await b.tree.setSnapshot(rows.map((r) => (r.id === child ? { ...r, update_seq: cursor } : r)), b.tree.projects());
    await b.offline.maintain();
    await b.offline.idle();
    expect((await markOf()).files[photo2]).toBeUndefined();
    expect((await markOf()).state).toBe('ready');
  });

  it('desmarcar borra lo suyo, no lo que pide otra marca, y nunca un original propio', async () => {
    const { a, b, page, photo } = await setup();
    const project = b.tree.get(page)!.workspace_id;
    const pageMark = await markAndWait(b, 'page', page, { ...DEFAULT_OPTIONS, originals: true });
    const projectMark = await markAndWait(b, 'project', project, { ...DEFAULT_OPTIONS, originals: true });
    await b.offline.unmark(pageMark, true);
    expect(await readCopy(b.mediaDb, photo)).not.toBeNull();
    await b.offline.unmark(projectMark, true);
    expect(await readCopy(b.mediaDb, photo)).toBeNull();
    expect(await b.mediaDb.getAllKeys('blobs')).toEqual([]);

    // En el dispositivo que agregó la foto: marcar, desmarcar y liberar todo deja el original propio.
    const own = await markAndWait(a, 'page', page);
    expect(await a.mediaDb.get('thumbs', offviewKey(photo))).toBeInstanceOf(Blob);
    await a.offline.unmark(own, true);
    await a.offline.setLimit(1);
    await a.offline.freeUp('all');
    expect(await a.mediaDb.get('blobs', photo)).toBeInstanceOf(Blob);
  });

  it('las claves de las copias nunca alcanzan un original propio', async () => {
    const { a, photo } = await setup();
    expect(partKey(photo, 0).startsWith('off:')).toBe(true);
    expect(await dropCopy(a.mediaDb, photo, { ignoreMarks: true, allowGone: true })).toBe(0);
    await a.mediaDb.put('blobs', new Blob(['huérfana']), partKey('off:raro', 3));
    await a.mediaDb.put('thumbs', new Blob(['huérfana']), offviewKey(photo));
    expect(await cleanOrphans(a.mediaDb)).toBe(2);
    expect(await a.mediaDb.get('blobs', photo)).toBeInstanceOf(Blob);
    expect(await a.mediaDb.get('thumbs', photo)).toBeInstanceOf(Blob);
  });

  it('el tope avisa y no borra nada sin el sí; con el sí, libera lo no marcado y nunca lo marcado', async () => {
    const { b, page, photo, video } = await setup();
    const mark = await markAndWait(b, 'page', page, { ...DEFAULT_OPTIONS, originals: true, videos: true });
    await b.offline.setLimit(1);
    // Lo marcado no cuenta: no hay aviso.
    expect(b.offline.getSnapshot().prompt).toBeNull();
    // Desmarcado sin borrar: pasa a contar y el aviso lo ofrece, pero no se borra solo.
    await b.offline.unmark(mark, false);
    const prompt = b.offline.getSnapshot().prompt;
    expect(prompt?.reason).toBe('limit');
    expect(prompt?.free).toBeGreaterThan(0);
    expect(await readCopy(b.mediaDb, photo)).not.toBeNull();
    await b.offline.maintain();
    expect(await readCopy(b.mediaDb, photo)).not.toBeNull();

    // *Not now*: se calla.
    await b.offline.snooze();
    await b.offline.refresh();
    expect(b.offline.getSnapshot().prompt).toBeNull();

    // Con el sí.
    const freed = await b.offline.freeUp('over');
    expect(freed).toBeGreaterThan(0);
    expect(await readCopy(b.mediaDb, photo)).toBeNull();
    expect(await readCopy(b.mediaDb, video)).toBeNull();
  });

  it('lo abierto en esta sesión no se libera', async () => {
    const { b, page, video } = await setup();
    const mark = await markAndWait(b, 'page', page, { ...DEFAULT_OPTIONS, videos: true });
    await b.offline.unmark(mark, false);
    b.offline.used(video, 'open');
    await b.offline.freeUp('all');
    expect(await readCopy(b.mediaDb, video)).not.toBeNull();
  });

  it('Drive ya no lo tiene: al liberar, /verify lo confirma y la copia queda como la única (nada la borra sola)', async () => {
    const { server, b, page, video } = await setup();
    const mark = await markAndWait(b, 'page', page, { ...DEFAULT_OPTIONS, videos: true });
    await b.offline.unmark(mark, false);
    server.portero.drive.delete(server.mediaFiles.get(video)!.drive_id!);
    await b.offline.freeUp('all');
    expect(await readCopy(b.mediaDb, video)).not.toBeNull();
    expect((await getCopy(b.mediaDb, video))?.gone).toBeTypeOf('number');
    const usage = await b.offline.usage();
    expect(usage.gone.ids).toEqual([video]);
    // A mano, con el aviso: sí.
    await b.offline.removeGone([video]);
    expect(await readCopy(b.mediaDb, video)).toBeNull();
  });

  it('permiso quitado: se borra solo con la página fuera del árbol y el portero diciendo not_found', async () => {
    const { server, b, page, child, photo, photo2 } = await setup();
    const mark = await markAndWait(b, 'page', child, { ...DEFAULT_OPTIONS, originals: true });
    expect(await readCopy(b.mediaDb, photo2)).not.toBeNull();
    // `not_found` con la página todavía en el árbol: nada.
    server.portero.hidden.add(photo2);
    await b.offline.maintain();
    expect(await readCopy(b.mediaDb, photo2)).not.toBeNull();
    // Fuera del árbol pero el portero todavía la da: la marca se va (vuelve como online), la copia queda.
    server.portero.hidden.delete(photo2);
    const rows = [b.tree.get(page)!];
    await b.tree.setSnapshot(rows, b.tree.projects());
    await b.offline.maintain();
    expect((await listMarks(b.mediaDb)).find((m) => m.id === mark)).toBeUndefined();
    expect(await readCopy(b.mediaDb, photo2)).not.toBeNull();
    // Las dos señales: se borra (la foto de la página, ahora marcada).
    await markAndWait(b, 'page', page, { ...DEFAULT_OPTIONS, originals: true });
    expect(await readCopy(b.mediaDb, photo)).not.toBeNull();
    server.portero.hidden.add(photo);
    await b.tree.setSnapshot([], b.tree.projects());
    await b.offline.maintain();
    expect(await listMarks(b.mediaDb)).toEqual([]);
    expect(await readCopy(b.mediaDb, photo)).toBeNull();
  });

  it('subir le gana a bajar: con algo que se puede subir, no baja; después, sí', async () => {
    const { server, b, page, photo } = await setup();
    server.online = true;
    // Algo nuevo para subir en este dispositivo.
    await b.media.add(page, file(MB, 'IMG_0099.JPG', 'image/jpeg', 9));
    expect(await b.media.hasUploadableNow()).toBe(true);
    await markAndWait(b, 'page', page);
    expect(await b.mediaDb.get('thumbs', offviewKey(photo))).toBeUndefined();
    await sync(b);
    expect(await b.media.hasUploadableNow()).toBe(false);
    await b.offline.update((await listMarks(b.mediaDb))[0].id);
    await b.offline.idle();
    expect(await b.mediaDb.get('thumbs', offviewKey(photo))).toBeInstanceOf(Blob);
  });

  it('sin lugar (la reserva para fotos nuevas): la marca se detiene sin bajar ni borrar nada', async () => {
    const { server, b, page, photo } = await setup();
    const GB = 1024 * MB;
    server.storage = {
      estimate: async () => ({ quota: 4 * GB, usage: 3.5 * GB }),
      persist: async () => true,
      persisted: async () => true,
    };
    await markAndWait(b, 'page', page);
    expect((await listMarks(b.mediaDb))[0].state).toBe('noSpace');
    expect(await b.mediaDb.get('thumbs', offviewKey(photo))).toBeUndefined();
  });

  it('sin lugar al escribir una parte: se borran las partes de ese archivo y la marca se detiene', async () => {
    const { b, page, video } = await setup({ videoSize: 20 * MB });
    const real = IDBObjectStore.prototype.put;
    let parts = 0;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (typeof key === 'string' && key.startsWith('off:') && ++parts > 1) throw new DOMException('full', 'QuotaExceededError');
      return real.call(this, value, key);
    });
    await markAndWait(b, 'page', page, { ...DEFAULT_OPTIONS, videos: true });
    vi.restoreAllMocks();
    expect((await listMarks(b.mediaDb))[0].state).toBe('noSpace');
    expect(await getCopy(b.mediaDb, video)).toBeUndefined();
    // El PDF (de fábrica) se bajó antes y queda; del video no queda ninguna parte.
    expect((await b.mediaDb.getAllKeys('blobs')).filter((k) => String(k).includes(video))).toEqual([]);
  });

  it('en el iPhone, el total marcado del dispositivo tiene un tope fijo', async () => {
    const { server, b, page } = await setup();
    const store = new Map<string, string>([['sd:offline:otro', String(5 * 1024 * MB)]]);
    const local = {
      get length() {
        return store.size;
      },
      key: (i: number) => [...store.keys()][i] ?? null,
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    b.offline.stop();
    const ios = new OfflineManager({
      db: b.mediaDb,
      media: b.media,
      tree: b.tree,
      docs: b.docs,
      remote: b.remote,
      online: () => server.online,
      fetch: (url, init) => server.portero.fetch(url, init),
      ios: true,
      dbName: 'este',
      local,
    });
    await ios.load();
    await ios.mark('page', page);
    await ios.idle();
    ios.stop();
    const [mark] = await listMarks(b.mediaDb);
    expect(mark.state).toBe('noSpace');
    expect(mark.error).toContain('iPhone');
  });

  it('una foto de la página ya nítida (view:) pasa a la marca sin bajar nada', async () => {
    const { server, b, page, photo } = await setup();
    void server;
    await b.mediaDb.put('thumbs', new Blob(['nitida'], { type: 'image/jpeg' }), VIEW_PREFIX + photo);
    await markAndWait(b, 'page', page);
    expect(await (await b.mediaDb.get('thumbs', offviewKey(photo)))!.text()).toBe('nitida');
    expect(await b.mediaDb.get('thumbs', VIEW_PREFIX + photo)).toBeUndefined();
    // El original de esa foto no se pidió.
    const driveId = server.mediaFiles.get(photo)!.drive_id!;
    expect(server.portero.calls.some((c) => c.path === `/m/${driveId}`)).toBe(false);
  });
});

describe('después de la auditoría de la implementación', { timeout: 60_000 }, () => {
  /** Un `localStorage` en memoria, con lo marcado en otro workspace del mismo iPhone. */
  function fakeLocal(other: number) {
    const store = new Map<string, string>([['sd:offline:otro', String(other)]]);
    return {
      get length() {
        return store.size;
      },
      key: (i: number) => [...store.keys()][i] ?? null,
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  }

  function iosManager(server: FakeServer, b: Device, local: ReturnType<typeof fakeLocal>): OfflineManager {
    b.offline.stop();
    return new OfflineManager({
      db: b.mediaDb,
      media: b.media,
      tree: b.tree,
      docs: b.docs,
      remote: b.remote,
      online: () => server.online,
      fetch: (url, init) => server.portero.fetch(url, init),
      ios: true,
      dbName: 'este',
      local,
    });
  }

  async function offBytes(d: Device): Promise<number> {
    let total = 0;
    for (const k of await d.mediaDb.getAllKeys('blobs')) if (String(k).startsWith('off:')) total += (await d.mediaDb.get('blobs', k))!.size;
    return total;
  }

  it('I1: el tope del iPhone suma lo bajado en la misma vuelta (al marcar)', async () => {
    const { server, b, page } = await setup();
    const ios = iosManager(server, b, fakeLocal(5 * 1024 * MB - 2.5 * MB));
    await ios.load();
    // Quedan 2,5 MB: la foto (2 MB), el video (1 MB) y el PDF (0,3 MB) enteros no entran todos.
    await ios.mark('page', page, { ...DEFAULT_OPTIONS, originals: true, videos: true });
    await ios.idle();
    ios.stop();
    expect(await offBytes(b)).toBeLessThanOrEqual(2.5 * MB);
    expect((await listMarks(b.mediaDb))[0].state).toBe('noSpace');
  });

  it('I1: el tope del iPhone también al mantener al día (lo nuevo no pasa el tope)', async () => {
    const { server, a, b, page } = await setup();
    const ios = iosManager(server, b, fakeLocal(5 * 1024 * MB - 2.7 * MB));
    await ios.load();
    await ios.mark('page', page, { ...DEFAULT_OPTIONS, attachments: true, sharp: false });
    await ios.idle();
    expect((await listMarks(b.mediaDb))[0].state).toBe('ready');
    // Llegan dos PDFs nuevos de 1,5 MB: entra uno solo.
    const extra: string[] = [];
    for (const n of [1, 2]) extra.push(mediaIdOf(await a.media.add(page, file(1.5 * MB, `anexo${n}.pdf`, 'application/pdf', 20 + n)))!);
    await edit(a, page, (doc) => extra.forEach((id) => insert(doc, id)));
    await sync(a);
    await sync(b);
    await ios.maintain();
    await ios.idle();
    ios.stop();
    const got = await Promise.all(extra.map(async (id) => (await readCopy(b.mediaDb, id)) !== null));
    expect(got.filter(Boolean).length).toBe(1);
    expect((await listMarks(b.mediaDb))[0].state).toBe('noSpace');
  });

  it('una copia "completa" a la que le falta una parte se vuelve a bajar con Update now', async () => {
    const { b, page, video } = await setup({ videoSize: 20 * MB });
    const mark = await markAndWait(b, 'page', page, { ...DEFAULT_OPTIONS, videos: true });
    const entry = (await getCopy(b.mediaDb, video))!;
    expect(entry.orig!.parts.length).toBe(2);
    await b.mediaDb.delete('blobs', partKey(video, entry.orig!.parts[1].n));
    expect(await readCopy(b.mediaDb, video)).toBeNull();
    await b.offline.update(mark);
    await b.offline.idle();
    expect((await readCopy(b.mediaDb, video))?.size).toBe(20 * MB);
  });

  it('cleanOrphans, en una transacción: borra lo suelto y no toca una copia completa', async () => {
    const { b, page, video } = await setup({ videoSize: 20 * MB });
    await markAndWait(b, 'page', page, { ...DEFAULT_OPTIONS, videos: true });
    await b.mediaDb.put('blobs', new Blob(['huérfana']), partKey(video, 99));
    expect(await cleanOrphans(b.mediaDb)).toBe(1);
    expect((await readCopy(b.mediaDb, video))?.size).toBe(20 * MB);
  });

  it('una foto nueva que no entra: primero se hace lugar y se vuelve a probar; si igual no, se ofrece guardarla', async () => {
    const { b, page, photo } = await setup();
    const mark = await markAndWait(b, 'page', page, { ...DEFAULT_OPTIONS, originals: true });
    await b.offline.unmark(mark, false);
    expect(await readCopy(b.mediaDb, photo)).not.toBeNull();
    const real = IDBObjectStore.prototype.put;
    let full = 1;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (this.name === 'blobs' && typeof key === 'string' && !key.startsWith('off:') && full-- > 0) {
        throw new DOMException('full', 'QuotaExceededError');
      }
      return real.call(this, value, key);
    });
    // Entra al segundo intento, después de liberar la copia bajada que nadie pide.
    const added = await b.media.add(page, file(MB, 'IMG_0200.JPG', 'image/jpeg', 30));
    expect(added.startsWith(MEDIA_SCHEME)).toBe(true);
    expect(await readCopy(b.mediaDb, photo)).toBeNull();

    // Sin nada para liberar: se rechaza y queda para guardarla.
    full = 10;
    await expect(b.media.add(page, file(MB, 'IMG_0201.JPG', 'image/jpeg', 31))).rejects.toBeInstanceOf(FileRejected);
    vi.restoreAllMocks();
    expect(b.offline.getSnapshot().unsaved).toEqual([{ name: 'IMG_0201.JPG', size: MB }]);
    const kept = b.offline.takeUnsaved(0)!;
    expect(new Uint8Array(await kept.arrayBuffer())).toEqual(bytes(MB, 31));
    expect(b.offline.getSnapshot().unsaved).toEqual([]);
  });

  it('hacer lugar para una foto nueva (sin preguntar) libera solo copias bajadas que siguen en Drive', async () => {
    const { server, a, b, page, child, photo, video, pdf, photo2 } = await setup();
    // Copias enteras de todo; después la página deja de estar marcada (sin borrar) y queda marcada solo la subpágina.
    const mark = await markAndWait(b, 'page', page, { ...DEFAULT_OPTIONS, originals: true, videos: true });
    await b.offline.unmark(mark, false);
    await markAndWait(b, 'page', child, { ...DEFAULT_OPTIONS, originals: true });
    // El video: Drive ya no lo tiene (puede ser la única copia). El PDF: en la papelera de la app.
    await markGone(b.mediaDb, video, Date.now());
    server.mediaFiles.get(pdf)!.trashed_at = new Date().toISOString();
    // Una foto agregada en este dispositivo y todavía sin subir.
    const unsent = mediaIdOf(await b.media.add(page, file(MB, 'IMG_0300.JPG', 'image/jpeg', 40)))!;
    expect((await b.mediaDb.get('files', unsent))!.pending).toBe(1);

    // Con red: pide más de lo que hay, para que libere todo lo que puede.
    await b.offline.makeRoom(10 * 1024 * MB);
    expect(await readCopy(b.mediaDb, photo)).toBeNull();
    expect(await readCopy(b.mediaDb, photo2)).not.toBeNull();
    expect(await readCopy(b.mediaDb, video)).not.toBeNull();
    expect(await readCopy(b.mediaDb, pdf)).not.toBeNull();
    expect(new Uint8Array(await (await b.mediaDb.get('blobs', unsent))!.arrayBuffer())).toEqual(bytes(MB, 40));

    // Sin red: lo mismo, con lo último que se supo de la base.
    server.online = false;
    await b.offline.makeRoom(10 * 1024 * MB);
    expect(await readCopy(b.mediaDb, photo2)).not.toBeNull();
    expect(await readCopy(b.mediaDb, video)).not.toBeNull();
    expect(await readCopy(b.mediaDb, pdf)).not.toBeNull();
    expect(await b.mediaDb.get('blobs', unsent)).toBeInstanceOf(Blob);
    server.online = true;

    // En el dispositivo que los agregó (ya subidos): los originales propios nunca se liberan para hacer lugar.
    await a.offline.makeRoom(10 * 1024 * MB);
    for (const id of [photo, video, pdf, photo2]) expect(await a.mediaDb.get('blobs', id)).toBeInstanceOf(Blob);
  });

  it('AUD1 sin red: una copia de algo en la papelera de la app no se libera para hacer lugar', async () => {
    const { server, b, page, pdf } = await setup();
    const mark = await markAndWait(b, 'page', page, { ...DEFAULT_OPTIONS, originals: true, videos: true });
    await b.offline.unmark(mark, false);
    expect(await readCopy(b.mediaDb, pdf)).not.toBeNull();
    // Otro dispositivo lo manda a la papelera de la app; este se entera (como al mirar la base) y queda sin red.
    server.mediaFiles.get(pdf)!.trashed_at = new Date().toISOString();
    await b.media.learn([server.mediaFiles.get(pdf)!]);
    server.online = false;
    await b.offline.makeRoom(10 * 1024 * MB);
    server.online = true;
    expect(await readCopy(b.mediaDb, pdf)).not.toBeNull();
  });

  it('AUD2 una nítida de marca (sin copia entera) se libera solo si el original sigue en Drive', async () => {
    const { server, b, page, photo, photo2 } = await setup();
    const mark = await markAndWait(b, 'page', page);
    await b.offline.unmark(mark, false);
    for (const id of [photo, photo2]) {
      const entry = await getCopy(b.mediaDb, id);
      expect(entry?.view).toBeTruthy();
      expect(entry?.orig).toBeFalsy();
    }
    // El original de una ya no está en Drive (purgado): su 2048 puede ser lo mejor que queda de la foto.
    server.mediaFiles.get(photo)!.purged_at = new Date().toISOString();
    await b.offline.makeRoom(10 * 1024 * MB);
    expect((await getCopy(b.mediaDb, photo))?.view).toBeTruthy();
    expect(await b.mediaDb.get('thumbs', offviewKey(photo))).toBeInstanceOf(Blob);
    // La otra sigue en Drive: se rehace sola, se libera.
    expect((await getCopy(b.mediaDb, photo2))?.view ?? null).toBeNull();
  });

  it('AUD3 mientras una carpeta sube, no se baja nada; al terminar, si', async () => {
    const { b, page, photo } = await setup();
    let busy = true;
    (b.offline as unknown as { deps: { uploadsBusy: () => boolean } }).deps.uploadsBusy = () => busy;
    await markAndWait(b, 'page', page, { ...DEFAULT_OPTIONS, originals: true });
    expect(await readCopy(b.mediaDb, photo)).toBeNull();
    busy = false;
    const [m] = await listMarks(b.mediaDb);
    await b.offline.update(m.id);
    await b.offline.idle();
    expect(await readCopy(b.mediaDb, photo)).not.toBeNull();
  });

  it('una carpeta que empieza a subir a mitad de una marca corta la bajada; al terminar, sigue', async () => {
    const { b, page, photo, video, pdf } = await setup();
    let busy = false;
    let fetched = 0;
    const deps = (b.offline as unknown as { deps: { uploadsBusy: () => boolean; fetch: (u: string, i?: RequestInit) => Promise<Response> } }).deps;
    deps.uploadsBusy = () => busy;
    const real = deps.fetch;
    deps.fetch = async (url, init) => {
      // La primera bajada termina y en ese momento empieza a subir una carpeta.
      if (url.includes('/m/') && ++fetched === 1) busy = true;
      return real(url, init);
    };
    await markAndWait(b, 'page', page, { ...DEFAULT_OPTIONS, originals: true, videos: true });
    const got = async () => (await Promise.all([photo, video, pdf].map((id) => readCopy(b.mediaDb, id)))).filter(Boolean).length;
    expect(await got()).toBeLessThan(3);
    expect((await listMarks(b.mediaDb))[0].state).not.toBe('ready');
    busy = false;
    const [m] = await listMarks(b.mediaDb);
    await b.offline.update(m.id);
    await b.offline.idle();
    expect(await got()).toBe(3);
  });

  it('el tope del iPhone: lo bajado mientras se cuenta no se pierde de vista', async () => {
    const { b } = await setup();
    const manager = b.offline as unknown as { written: number; usage: () => Promise<unknown> };
    manager.written = 5 * MB;
    const real = manager.usage.bind(b.offline);
    vi.spyOn(manager, 'usage').mockImplementation(async () => {
      const usage = await real();
      // Un archivo terminó de bajarse mientras se contaba (no está en `usage`).
      manager.written += 2 * MB;
      return usage;
    });
    await b.offline.refresh();
    expect(manager.written).toBe(2 * MB);
  });

  it('AUD4 Drive lo tiene en su papelera (la base no se entero): no se libera para hacer lugar', async () => {
    const { server, b, page, video } = await setup();
    const mark = await markAndWait(b, 'page', page, { ...DEFAULT_OPTIONS, videos: true });
    await b.offline.unmark(mark, false);
    server.portero.driveTrash.add(server.mediaFiles.get(video)!.drive_id!);
    await b.offline.makeRoom(10 * 1024 * MB);
    expect(await readCopy(b.mediaDb, video)).not.toBeNull();
  });

  it('AUD5 sin red: lo que la base dijo que esta en la papelera de Drive no se libera', async () => {
    const { server, b, page, pdf } = await setup();
    const mark = await markAndWait(b, 'page', page, { ...DEFAULT_OPTIONS, originals: true });
    await b.offline.unmark(mark, false);
    server.mediaFiles.get(pdf)!.drive_trashed_at = new Date().toISOString();
    await b.media.learn([server.mediaFiles.get(pdf)!]);
    server.online = false;
    await b.offline.makeRoom(10 * 1024 * MB);
    server.online = true;
    expect(await readCopy(b.mediaDb, pdf)).not.toBeNull();
  });

  it('una carpeta de Drive (P.9) en la página no se baja ni pesa: la marca llega a "listo"', async () => {
    const { server, a, b, page, pdf } = await setup();
    const folder = await a.media.addFolder(page, 'Referencias', 5 * MB);
    // Ya creada en Drive (`/folder/prepare` le pone su id de Drive).
    server.mediaFiles.get(folder.id)!.drive_id = 'carpetaDrivexxxx';
    await edit(a, page, (doc) => insert(doc, folder.id));
    await sync(a);
    await sync(b);
    const plan = await b.offline.plan('page', page, () => undefined);
    expect(plan.weights.rows.attachments.count).toBe(1);
    await markAndWait(b, 'page', page);
    const [mark] = await listMarks(b.mediaDb);
    expect(mark.state).toBe('ready');
    expect(mark.error).toBeNull();
    expect(b.offline.getSnapshot().marks[0]).toMatchObject({ state: 'ready' });
    expect(await readCopy(b.mediaDb, pdf)).not.toBeNull();
    expect(await getCopy(b.mediaDb, folder.id)).toBeUndefined();
  });

  it('el carrete sin red muestra la de 2048 guardada aunque la página no la haya procesado', async () => {
    const { server, b, page, photo } = await setup();
    await markAndWait(b, 'page', page);
    server.online = false;
    const item = collectCarrete([{ id: 'x', type: 'image', props: { url: MEDIA_SCHEME + photo, name: '' } }])[0];
    const preview = await createCarreteLoader({ media: b.media, files: b.files }).preview(item);
    expect(preview.preview).toBe(b.media.viewUrl(photo));
    // El aviso sin red dice "versión grande", no "miniatura".
    expect(preview.large).toBe(true);
    expect(b.media.viewOf(photo)?.side).toBe(2048);
  });

  it('mantener al día no vuelve a consultar una marca lista y sin cambios', async () => {
    const { b, page } = await setup();
    await markAndWait(b, 'page', page);
    const spy = vi.spyOn(b.remote, 'fetchMediaFiles');
    await b.offline.maintain();
    await b.offline.idle();
    await b.offline.maintain();
    await b.offline.idle();
    expect(spy).not.toHaveBeenCalled();
  });
});
