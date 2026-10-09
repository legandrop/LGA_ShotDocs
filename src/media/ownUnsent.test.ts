import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { t } from '../i18n';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { RemoteError } from '../sync/types';
import { syncTone } from '../ui/SyncBadge';
import { MediaQueue as PublishedMediaQueue } from './fixtures/v247/queue';
import { MEDIA_SCHEME, mediaIdOf, UNCONFIRMED_SCAN_FROM } from './queue';
import { linkOnOpen, mediaIdsInDoc } from './usage';

// Roadmap 28 (v0.252). Escribir en una página durante la primera bajada de un dispositivo nuevo (lo típico en el set):
// la comparación ya no descarta entera la lectura de usos del servidor por tener algo propio sin subir, sino solo para
// las fotos que trae lo propio (D611). Y la pastilla dice «Uploading…» mientras la cola de archivos manda (D612), la
// lectura de filas sin confirmar en lote (D614) y una página con un archivo propio en espera no queda mirada (D615).
// Con el servidor en memoria (src/sync/testing.ts), como openBaseline.test.ts.

const MB = 1024 * 1024;
const MIN = 60_000;
const devices: Device[] = [];

async function device(server: FakeServer, version = '0.021', compact?: unknown): Promise<Device> {
  const d = await makeDevice(server, undefined, version, {}, undefined, {}, compact as never);
  devices.push(d);
  return d;
}

afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
});

const photo = (name: string) => new File([new Uint8Array(MB).fill(7)], name, { type: 'image/jpeg' });

async function sync(d: Device): Promise<void> {
  await d.engine.syncNow();
  await d.engine.syncMedia();
  await d.engine.syncNow();
  await d.engine.syncMedia();
}

function insertImage(doc: Y.Doc, fileId: string): void {
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

function removeImage(doc: Y.Doc, fileId: string): void {
  const group = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
  const at = group
    .toArray()
    .findIndex((c) => ((c as Y.XmlElement).get(0) as Y.XmlElement | undefined)?.getAttribute('url') === MEDIA_SCHEME + fileId);
  if (at >= 0) group.delete(at, 1);
}

/** Una letra, como un párrafo nuevo (lo propio sin subir que no trae ninguna foto). */
function typeLetter(doc: Y.Doc): void {
  const fragment = doc.getXmlFragment(CONTENT_FRAGMENT);
  if (fragment.length === 0) fragment.insert(0, [new Y.XmlElement('blockGroup')]);
  const group = fragment.get(0) as Y.XmlElement;
  const container = new Y.XmlElement('blockContainer');
  container.setAttribute('id', crypto.randomUUID());
  const p = new Y.XmlElement('paragraph');
  p.insert(0, [new Y.XmlText('a')]);
  container.insert(0, [p]);
  group.insert(group.length, [container]);
}

async function edit(d: Device, pageId: string, change: (doc: Y.Doc) => void): Promise<void> {
  const doc = await d.docs.open(pageId);
  change(doc);
  d.docs.close(pageId);
  await d.docs.flush();
}

const calls = (server: FakeServer, name: string) => server.mediaCalls.filter((c) => c.startsWith(name));
const link = (d: Device, pageId: string, fileId: string) => d.mediaDb.get('links', `${pageId}:${fileId}`);
const pendingSum = (d: Device) => {
  const s = d.engine.getStatus();
  return s.pendingOps + s.pendingPages + s.pendingFiles + s.pendingMedia + s.pendingComments;
};
/** El texto de la pastilla para el estado de ahora (`SyncBadge`, sin React). */
const badge = (d: Device) => syncTone(d.engine.getStatus(), pendingSum(d), false, t).text;

/** «Día 59» con `n` fotos y «Día 60» con dos, hechas y subidas en `a`. */
async function project(server: FakeServer, n: number) {
  server.enableTrash();
  const a = await device(server);
  await sync(a);
  const page = await a.tree.create(null, 'Día 59');
  const other = await a.tree.create(null, 'Día 60');
  await sync(a);
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(mediaIdOf(await a.media.add(page, photo(`IMG_${i}.JPG`)))!);
  const others = [mediaIdOf(await a.media.add(other, photo('OTRA_1.JPG')))!, mediaIdOf(await a.media.add(other, photo('OTRA_2.JPG')))!];
  await edit(a, page, (doc) => ids.forEach((x) => insertImage(doc, x)));
  await edit(a, other, (doc) => others.forEach((x) => insertImage(doc, x)));
  await sync(a);
  expect(server.pageFiles.size).toBe(n + 2);
  return { a, page, ids, other, others };
}

/**
 * Lo que hace la persona apenas baja la página, durante la primera bajada de `d`: después de la subida del ciclo y antes
 * de la comparación, así lo que escribe llega a la comparación sin subir (el caso del set).
 */
function duringPull(d: Device, pageId: string, act: () => Promise<void>): () => boolean {
  const orig = d.docs.pullPage.bind(d.docs);
  let done = false;
  d.docs.pullPage = (async (pid, remote, opts) => {
    const n = await orig(pid, remote, opts);
    if (!done && pid === pageId) {
      done = true;
      await act();
    }
    return n;
  }) as typeof d.docs.pullPage;
  return () => done;
}

/** Un ciclo sin que arranque la cola de archivos al final: lo encolado queda a la vista. */
async function cycleWithoutQueue(d: Device): Promise<void> {
  const engine = d.engine as unknown as { syncMedia?: () => Promise<void> };
  engine.syncMedia = async () => undefined;
  try {
    await d.engine.syncNow();
  } finally {
    delete engine.syncMedia;
  }
}

/** Algo que pasa entre la lectura de usos y la comparación de esa página (como A1 y A2 de trash.test.ts). */
function beforeCompare(d: Device, pageId: string, act: () => Promise<void>): () => boolean {
  const orig = d.docs.snapshot.bind(d.docs);
  let done = false;
  d.docs.snapshot = (async (pid: string) => {
    if (!done && pid === pageId) {
      done = true;
      await act();
    }
    return orig(pid);
  }) as typeof d.docs.snapshot;
  return () => done;
}

/** Abre la página como el editor (`linkOnOpen`) y escribe una letra. */
async function openAndType(d: Device, pageId: string, more?: (doc: Y.Doc) => Promise<void> | void): Promise<void> {
  const doc = await d.docs.open(pageId);
  await linkOnOpen(d, pageId, [...mediaIdsInDoc(doc)]);
  typeLetter(doc);
  await more?.(doc);
  d.docs.close(pageId);
  await d.docs.flush();
}

/** Los usos activos del servidor de una página, contra las fotos de su documento en `d`. */
async function usesMatchDoc(server: FakeServer, d: Device, pageId: string): Promise<void> {
  const doc = await d.docs.open(pageId);
  const inDoc = [...mediaIdsInDoc(doc)].sort();
  d.docs.close(pageId);
  const active = [...server.pageFiles.keys()].filter((k) => k.startsWith(`${pageId}:`)).map((k) => k.slice(pageId.length + 1));
  expect(active.sort()).toEqual(inDoc);
  for (const f of inDoc) expect(server.mediaFiles.get(f)?.trashed_at ?? null).toBeNull();
}

describe('escribir durante la primera bajada (D611)', () => {
  it('una letra en una página abierta no cuenta ni manda sus fotos', async () => {
    const server = new FakeServer();
    const { page, ids } = await project(server, 8);
    const before = calls(server, 'link_page_file').length;
    const b = await device(server);
    const typed = duringPull(b, page, () => openAndType(b, page));
    await cycleWithoutQueue(b);
    expect(typed()).toBe(true);
    // La pastilla: la letra, nada más (antes, 9: la letra y las 8 fotos).
    expect(b.engine.getStatus()).toMatchObject({ pendingMedia: 0, pendingPages: 1 });
    expect(badge(b)).toBe(t('sync.notUploaded', { changes: t('sync.changes', { count: 1 }) }));
    await sync(b);
    expect(calls(server, 'link_page_file').length - before).toBe(0);
    for (const f of ids) expect(await link(b, page, f)).toMatchObject({ pending: 0, removed: false, unconfirmed: false });
    expect(b.engine.getStatus().pendingMedia).toBe(0);
    await usesMatchDoc(server, b, page);
  });

  it('escrito sin el editor (sin filas) durante la bajada: tampoco', async () => {
    const server = new FakeServer();
    const { page, ids } = await project(server, 5);
    const before = calls(server, 'link_page_file').length;
    const b = await device(server);
    duringPull(b, page, () => edit(b, page, typeLetter));
    await cycleWithoutQueue(b);
    expect(b.engine.getStatus()).toMatchObject({ pendingMedia: 0, pendingPages: 1 });
    await sync(b);
    expect(calls(server, 'link_page_file').length - before).toBe(0);
    for (const f of ids) expect(await link(b, page, f)).toMatchObject({ pending: 0, removed: false });
  });

  it('lo que trae lo propio sí sale: una foto pegada con el editor y una copia sin el editor', async () => {
    const server = new FakeServer();
    const { page, others } = await project(server, 4);
    const before = calls(server, 'link_page_file').length;
    const b = await device(server);
    duringPull(b, page, () =>
      openAndType(b, page, async (doc) => {
        // Pegada con el editor: su `onChange` llama a `ensureLinks`.
        insertImage(doc, others[0]);
        await b.media.ensureLinks(page, [others[0]]);
        // Una copia que entró sin el editor (Assign, repartir por escenas…).
        insertImage(doc, others[1]);
      }),
    );
    await cycleWithoutQueue(b);
    expect(b.engine.getStatus()).toMatchObject({ pendingMedia: 2, pendingPages: 1 });
    await sync(b);
    expect(calls(server, 'link_page_file').slice(before).sort()).toEqual(
      [`link_page_file ${page} ${others[0]}`, `link_page_file ${page} ${others[1]}`].sort(),
    );
    await usesMatchDoc(server, b, page);
  });

  it('A2 con la página abierta: una copia sin el editor de una foto que otro dispositivo quita mientras tanto se manda', async () => {
    const server = new FakeServer();
    const { a, page, ids } = await project(server, 3);
    const id = ids[0];
    const b = await device(server);
    duringPull(b, page, () => openAndType(b, page));
    // Después de la lectura de usos (que todavía tiene `id`): B copia el bloque sin el editor y A lo quita.
    // (Lo que se mira adentro del gancho se anota y se comprueba afuera: el motor ataja los errores de la comparación.)
    let removedByA = false;
    const fired = beforeCompare(b, page, async () => {
      await edit(b, page, (doc) => insertImage(doc, id));
      await edit(a, page, (doc) => removeImage(doc, id));
      await sync(a);
      removedByA = !server.pageFiles.has(`${page}:${id}`);
    });
    await sync(b);
    await sync(b);
    expect(fired()).toBe(true);
    expect(removedByA).toBe(true);
    const merged = mediaIdsInDoc(await b.docs.open(page));
    b.docs.close(page);
    expect(merged.has(id)).toBe(true);
    // B no le creyó a la lectura vieja para la copia: el uso está activo y el archivo no está en la papelera.
    expect(server.pageFiles.has(`${page}:${id}`)).toBe(true);
    expect(server.mediaFiles.get(id)?.trashed_at ?? null).toBeNull();
  });

  it('A2 con deshacer: B borra y deshace sin subir mientras A quita la foto y manda el unlink', async () => {
    const server = new FakeServer();
    const { a, page, ids } = await project(server, 2);
    const id = ids[0];
    const b = await device(server);
    let trashedByA = false;
    const fired = beforeCompare(b, page, async () => {
      const doc = await b.docs.open(page);
      const undo = new Y.UndoManager(doc.getXmlFragment(CONTENT_FRAGMENT));
      removeImage(doc, id);
      undo.stopCapturing();
      undo.undo();
      b.docs.close(page);
      await b.docs.flush();
      await edit(a, page, (d) => removeImage(d, id));
      await sync(a);
      trashedByA = !!server.mediaFiles.get(id)?.trashed_at;
    });
    await sync(b);
    await sync(b);
    expect(fired()).toBe(true);
    expect(trashedByA).toBe(true);
    const merged = mediaIdsInDoc(await b.docs.open(page));
    b.docs.close(page);
    expect(merged.has(id)).toBe(true);
    expect(server.pageFiles.has(`${page}:${id}`)).toBe(true);
    expect(server.mediaFiles.get(id)?.trashed_at ?? null).toBeNull();
  });

  it('dos dispositivos a la vez: B escribe, pega y copia durante su bajada mientras A quita fotos; nada queda sin uso', async () => {
    const server = new FakeServer();
    const { a, page, ids, other, others } = await project(server, 6);
    const b = await device(server);
    // Durante la bajada de B: abre, escribe, pega una foto de otra página y copia (sin el editor) una de esta.
    duringPull(b, page, () =>
      openAndType(b, page, async (doc) => {
        insertImage(doc, others[0]);
        await b.media.ensureLinks(page, [others[0]]);
        insertImage(doc, ids[0]);
      }),
    );
    // Entre la lectura y la comparación de B, A quita dos fotos (una es la que B copió) y una de la otra página.
    beforeCompare(b, page, async () => {
      await edit(a, page, (doc) => {
        removeImage(doc, ids[0]);
        removeImage(doc, ids[1]);
      });
      await edit(a, other, (doc) => removeImage(doc, others[1]));
      await sync(a);
    });
    await sync(b);
    await sync(b);
    // Antes de que A vuelva a sincronizar (y pueda curarlo al ver la copia): el uso de la copia de B ya está activo.
    expect(server.pageFiles.has(`${page}:${ids[0]}`)).toBe(true);
    expect(server.mediaFiles.get(ids[0])?.trashed_at ?? null).toBeNull();
    for (let i = 0; i < 3; i++) {
      await sync(a);
      await sync(b);
    }
    // Los dos documentos convergen y los usos activos del servidor son exactamente sus fotos.
    for (const d of [a, b]) {
      await usesMatchDoc(server, d, page);
      await usesMatchDoc(server, d, other);
    }
    // Lo que nadie tiene ya en ningún documento, a la papelera; lo que B copió, no.
    expect(server.mediaFiles.get(ids[1])?.trashed_at).toBeTruthy();
    expect(server.mediaFiles.get(others[1])?.trashed_at).toBeTruthy();
    // La copia de B y la que pegó siguen en uso.
    expect(server.pageFiles.has(`${page}:${ids[0]}`)).toBe(true);
    expect(server.pageFiles.has(`${page}:${others[0]}`)).toBe(true);
  });

  it('borrar una foto durante la bajada con algo propio: sale el unlink y llega a la papelera', async () => {
    const server = new FakeServer();
    const { page, ids } = await project(server, 3);
    const f = ids[1];
    const b = await device(server);
    duringPull(b, page, () => openAndType(b, page, (doc) => removeImage(doc, f)));
    await cycleWithoutQueue(b);
    // La línea base sin confirmar sigue ahí hasta que lo propio sube.
    expect(await link(b, page, f)).toMatchObject({ pending: 0, unconfirmed: true, removed: false });
    await sync(b);
    await sync(b);
    expect(server.pageFiles.has(`${page}:${f}`)).toBe(false);
    expect(server.mediaFiles.get(f)?.trashed_at).toBeTruthy();
    await usesMatchDoc(server, b, page);
  });

  it('sin saber qué es propio (sin syncedSV) o sin poder leer los usos, se manda todo', async () => {
    for (const how of ['sin syncedSV', 'lectura que falla'] as const) {
      const server = new FakeServer();
      const { page, ids } = await project(server, 3);
      const before = calls(server, 'link_page_file').length;
      const b = await device(server);
      duringPull(b, page, () => openAndType(b, page));
      if (how === 'sin syncedSV') {
        const orig = b.docs.snapshot.bind(b.docs);
        b.docs.snapshot = (async (pid: string) => {
          const snap = await orig(pid);
          return { ...snap, state: { ...snap.state, syncedSV: undefined } };
        }) as typeof b.docs.snapshot;
      } else {
        b.remote.fetchPageUses = async () => {
          throw new RemoteError('Internal Server Error', false, '500');
        };
      }
      await cycleWithoutQueue(b);
      for (const f of ids) expect(await link(b, page, f), how).toMatchObject({ pending: 1 });
      await sync(b);
      const sent = calls(server, 'link_page_file').slice(before).filter((c) => c.includes(page));
      expect(sent, how).toHaveLength(ids.length);
    }
  });

  it('C1: si calcular lo propio falla en una página, se manda todo en esa y se compara también la siguiente', async () => {
    const server = new FakeServer();
    const { page, other, others, ids } = await project(server, 2);
    const third = mediaIdOf(await (devices[0].media.add(other, photo('OTRA_3.JPG'))))!;
    await sync(devices[0]);
    void third;
    const b = await device(server);
    // B copia sin el editor una foto de la otra página en cada una (usos nuevos de verdad), durante la bajada.
    duringPull(b, other, async () => {
      await edit(b, page, (doc) => {
        typeLetter(doc);
        insertImage(doc, others[0]);
      });
      await edit(b, other, (doc) => {
        typeLetter(doc);
        insertImage(doc, ids[0]);
      });
    });
    // La primera página que se compara trae un vector de estado roto: calcular lo propio tira.
    const orig = b.docs.snapshot.bind(b.docs);
    let broken: string | null = null;
    b.docs.snapshot = (async (pid: string) => {
      const snap = await orig(pid);
      if (broken === null && (pid === page || pid === other)) broken = pid;
      return pid === broken ? { ...snap, state: { ...snap.state, syncedSV: new Uint8Array([0xff]) } } : snap;
    }) as typeof b.docs.snapshot;
    await cycleWithoutQueue(b);
    expect(broken).not.toBeNull();
    // En el mismo ciclo: las dos páginas comparadas y los dos usos nuevos por mandar.
    expect(await link(b, page, others[0])).toMatchObject({ pending: 1 });
    expect(await link(b, other, ids[0])).toMatchObject({ pending: 1 });
    await b.engine.syncMedia();
    expect(server.pageFiles.has(`${page}:${others[0]}`)).toBe(true);
    expect(server.pageFiles.has(`${other}:${ids[0]}`)).toBe(true);
  });

  it('abrir una página con algo propio escrito sin el editor: sin confirmar lo del servidor, por mandar lo propio', async () => {
    const server = new FakeServer();
    const { page, ids, others } = await project(server, 4);
    const before = calls(server, 'link_page_file').length;
    const b = await device(server);
    let seen: unknown = null;
    duringPull(b, page, async () => {
      await edit(b, page, (doc) => insertImage(doc, others[0]));
      const own = await b.docs.hasOwnUnsent(page);
      const doc = await b.docs.open(page);
      await linkOnOpen(b, page, [...mediaIdsInDoc(doc)]);
      b.docs.close(page);
      seen = {
        own,
        server: await Promise.all(ids.map(async (f) => ({ ...(await link(b, page, f)) }))),
        pasted: { ...(await link(b, page, others[0])) },
        pending: (await b.media.status()).pending,
      };
    });
    await sync(b);
    expect(seen).toMatchObject({
      own: true,
      server: ids.map(() => ({ pending: 0, unconfirmed: true })),
      pasted: { pending: 1 },
      pending: 1,
    });
    expect(calls(server, 'link_page_file').slice(before)).toEqual([`link_page_file ${page} ${others[0]}`]);
    await usesMatchDoc(server, b, page);
  });

  it('compactada: un dispositivo nuevo que baja un snapshot y escribe durante la bajada no manda nada de más', async () => {
    const server = new FakeServer();
    server.snapshotMinRows = 5;
    server.snapshotMinTailBytes = 1;
    const COMPACT = { minRows: 5, fullCheckEvery: 1 };
    server.enableTrash();
    server.enableSnapshots();
    const a = await device(server, '1.000', COMPACT);
    await sync(a);
    const page = await a.tree.create(null, 'Día 59');
    await sync(a);
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push(mediaIdOf(await a.media.add(page, photo(`IMG_${i}.JPG`)))!);
    for (const x of ids) {
      await edit(a, page, (doc) => insertImage(doc, x));
      await sync(a);
    }
    for (let i = 0; i < 6; i++) {
      await edit(a, page, typeLetter);
      await a.engine.syncNow();
    }
    await sync(a);
    expect(server.snapshots.length).toBeGreaterThan(0);
    const before = calls(server, 'link_page_file').length;
    const b = await device(server, '1.000', COMPACT);
    duringPull(b, page, () => openAndType(b, page));
    await cycleWithoutQueue(b);
    expect(b.engine.getStatus().pendingMedia).toBe(0);
    await sync(b);
    expect(calls(server, 'link_page_file').length - before).toBe(0);
  });

  it('la versión anterior sobre la base que deja la nueva en una página con algo propio', async () => {
    const server = new FakeServer();
    const { page, ids, others } = await project(server, 3);
    const before = calls(server, 'link_page_file').length;
    const b = await device(server);
    // Escrito sin el editor (trae una foto de otra página) y después abierta: lo del servidor sin confirmar.
    duringPull(b, page, async () => {
      await edit(b, page, (doc) => {
        typeLetter(doc);
        insertImage(doc, others[0]);
      });
      const doc = await b.docs.open(page);
      await linkOnOpen(b, page, [...mediaIdsInDoc(doc)]);
      b.docs.close(page);
    });
    // Un ciclo sin comparación y sin vuelta de la cola: lo deja como lo encuentra la versión anterior.
    const engine = b.engine as unknown as { reconcileMedia?: () => Promise<void>; syncMedia?: () => Promise<void> };
    engine.reconcileMedia = async () => undefined;
    engine.syncMedia = async () => undefined;
    await cycleWithoutQueue(b);
    delete engine.reconcileMedia;
    delete engine.syncMedia;
    // La misma base, abierta por la versión publicada antes de D601 (la que peor lee las filas sin confirmar).
    const old = new PublishedMediaQueue(b.mediaDb, b.remote, {
      portero: (b.media as unknown as { options: { portero: ConstructorParameters<typeof PublishedMediaQueue>[2]['portero'] } }).options.portero,
      offline: () => !server.online,
    });
    await old.load();
    // Cuenta solo lo propio, su `ensureLinks` no toca lo del servidor y su comparación no lo quita mientras está.
    expect((await old.status()).pending).toBe(1);
    await old.ensureLinks(page, ids);
    expect((await old.status()).pending).toBe(1);
    const docIds = mediaIdsInDoc(await b.docs.open(page));
    b.docs.close(page);
    await old.reconcilePage(page, docIds, { unlink: false });
    await old.run();
    expect(calls(server, 'link_page_file').slice(before)).toEqual([`link_page_file ${page} ${others[0]}`]);
    for (const f of ids) expect(server.pageFiles.has(`${page}:${f}`)).toBe(true);
    // La versión nueva vuelve: confirma lo del servidor sin mandar nada.
    await sync(b);
    expect(calls(server, 'link_page_file').slice(before)).toEqual([`link_page_file ${page} ${others[0]}`]);
    for (const f of ids) expect(await link(b, page, f)).toMatchObject({ pending: 0, unconfirmed: false });
    await usesMatchDoc(server, b, page);
  });
});

describe('la guarda hasUnsentCreate en el arnés (D613)', () => {
  it('una página creada acá con una foto de otra: su uso por mandar frena el unlink de la original hasta crearse', async () => {
    const server = new FakeServer();
    const { page, ids } = await project(server, 2);
    const id = ids[0];
    const b = await device(server);
    await sync(b);
    server.online = false;
    const copy = await b.tree.create(null, 'Copia');
    await edit(b, copy, (doc) => insertImage(doc, id));
    expect(b.tree.hasUnsentCreate(copy)).toBe(true);
    const doc = await b.docs.open(copy);
    await linkOnOpen(b, copy, [...mediaIdsInDoc(doc)]);
    b.docs.close(copy);
    expect(await link(b, copy, id)).toMatchObject({ pending: 1 });
    expect((await link(b, copy, id))?.unconfirmed).toBeFalsy();
    // Se quita de la página original (cortar y pegar) y la cola corre con red pero sin la página creada todavía.
    await edit(b, page, (d) => removeImage(d, id));
    server.online = true;
    expect(await b.media.reconcilePage(page, new Set(ids.slice(1)), { unlink: true })).toBe(true);
    await b.media.run((pageId) => b.tree.hasUnsentCreate(pageId));
    expect(calls(server, 'unlink_page_file')).toEqual([]);
    expect(await link(b, page, id)).toMatchObject({ removed: true, waiting: 'held' });
    expect(server.mediaFiles.get(id)?.trashed_at ?? null).toBeNull();
    // Se crea la página: primero su uso, después el unlink; el archivo nunca pasó por la papelera.
    server.clockOffset += 60 * MIN;
    await sync(b);
    await sync(b);
    expect(server.pageFiles.has(`${copy}:${id}`)).toBe(true);
    expect(server.pageFiles.has(`${page}:${id}`)).toBe(false);
    expect(server.mediaFiles.get(id)?.trashed_at ?? null).toBeNull();
  });
});

describe('filas sin confirmar en lote (D614)', () => {
  it('pocas o muchas páginas: el mismo resultado', async () => {
    const server = new FakeServer();
    server.enableTrash();
    const a = await device(server);
    await sync(a);
    const pages: string[] = [];
    for (let i = 0; i < UNCONFIRMED_SCAN_FROM + 8; i++) pages.push(await a.tree.create(null, `P${i}`));
    await sync(a);
    const f = mediaIdOf(await a.media.add(pages[0], photo('X.JPG')))!;
    await sync(a);
    // Filas sin confirmar en una de cada tres páginas, confirmadas en otras.
    const expected = new Set<string>();
    for (const [i, p] of pages.entries()) {
      if (i === 0) continue;
      if (i % 3 === 0) {
        await a.media.ensureLinks(p, [f], { unconfirmed: true });
        expected.add(p);
      } else if (i % 3 === 1) {
        await a.mediaDb.put('links', { key: `${p}:${f}`, pageId: p, fileId: f, pending: 0, removed: false, rev: 0 } as never);
      }
    }
    const many = await a.media.pagesWithUnconfirmed(pages);
    expect(pages.length).toBeGreaterThan(UNCONFIRMED_SCAN_FROM);
    expect([...many].sort()).toEqual([...expected].sort());
    const few = new Set<string>();
    for (let i = 0; i < pages.length; i += UNCONFIRMED_SCAN_FROM) {
      for (const p of await a.media.pagesWithUnconfirmed(pages.slice(i, i + UNCONFIRMED_SCAN_FROM))) few.add(p);
    }
    expect([...few].sort()).toEqual([...expected].sort());
    // Una página por página, como antes.
    for (const p of pages) expect(await a.media.hasUnconfirmed(p)).toBe(expected.has(p));
  });
});

describe('un archivo propio que el documento nunca mostró (D615)', () => {
  it('comparada dentro de la espera, la página se vuelve a mirar y el archivo llega a la papelera sin otro cambio', async () => {
    const server = new FakeServer();
    server.enableTrash();
    const a = await device(server);
    await sync(a);
    const page = await a.tree.create(null, 'Día 1');
    await sync(a);
    // Se guardó y registró, pero el editor no llegó a ponerlo (la página se cerró antes).
    const f = mediaIdOf(await a.media.add(page, photo('NO_PUESTA.JPG')))!;
    await edit(a, page, typeLetter);
    await sync(a);
    expect(server.pageFiles.has(`${page}:${f}`)).toBe(true);
    expect(a.media.usageMark(page)).toBeUndefined();
    // Pasada la espera, sin ningún cambio en el documento.
    server.clockOffset += 6 * MIN;
    await sync(a);
    expect(calls(server, 'unlink_page_file')).toEqual([`unlink_page_file ${page} ${f}`]);
    expect(server.mediaFiles.get(f)?.trashed_at).toBeTruthy();
    expect(a.media.usageMark(page)).toBeDefined();
  });

  it('un archivo propio que sí está en el documento no frena la marca', async () => {
    const server = new FakeServer();
    server.enableTrash();
    const a = await device(server);
    await sync(a);
    const page = await a.tree.create(null, 'Día 1');
    await sync(a);
    const f = mediaIdOf(await a.media.add(page, photo('PUESTA.JPG')))!;
    await edit(a, page, (doc) => insertImage(doc, f));
    await sync(a);
    expect(a.media.usageMark(page)).toBeDefined();
  });

  it('C5: movido a otra página antes de llegar al documento, nunca va a la papelera', async () => {
    const server = new FakeServer();
    server.enableTrash();
    const a = await device(server);
    await sync(a);
    const page = await a.tree.create(null, 'Día 1');
    const other = await a.tree.create(null, 'Día 2');
    await sync(a);
    const f = mediaIdOf(await a.media.add(page, photo('MOVIDA.JPG')))!;
    // El bloque terminó en la otra página; su uso todavía no se confirma (el servidor falla un rato).
    const linkPageFile = a.remote.linkPageFile.bind(a.remote);
    a.remote.linkPageFile = async () => {
      throw new RemoteError('Internal Server Error', false, '500');
    };
    await edit(a, other, (doc) => insertImage(doc, f));
    await edit(a, page, typeLetter);
    await sync(a);
    server.clockOffset += 6 * MIN;
    await sync(a);
    // Pasada la espera, el unlink de la página original espera al uso de la otra.
    expect(calls(server, 'unlink_page_file')).toEqual([]);
    expect(await link(a, page, f)).toMatchObject({ removed: true, waiting: 'held' });
    expect(server.mediaFiles.get(f)?.trashed_at ?? null).toBeNull();
    a.remote.linkPageFile = linkPageFile;
    server.clockOffset += 60 * MIN;
    await sync(a);
    await sync(a);
    expect(server.pageFiles.has(`${other}:${f}`)).toBe(true);
    expect(server.pageFiles.has(`${page}:${f}`)).toBe(false);
    expect(server.mediaFiles.get(f)?.trashed_at ?? null).toBeNull();
  });
});

describe('la pastilla mientras la cola de archivos manda (D612)', () => {
  /** B con un uso de verdad por mandar (una foto de otra página en una página nueva ya creada). */
  async function withUse() {
    const server = new FakeServer();
    const { ids } = await project(server, 1);
    const b = await device(server);
    await sync(b);
    const p2 = await b.tree.create(null, 'Copia');
    await b.engine.syncNow();
    // Sin que el ciclo arranque la cola: el uso queda por mandar para la prueba.
    const engine = b.engine as unknown as { syncMedia?: () => Promise<void> };
    engine.syncMedia = async () => undefined;
    await edit(b, p2, (doc) => insertImage(doc, ids[0]));
    await b.media.ensureLinks(p2, [ids[0]]);
    await b.engine.syncNow();
    delete engine.syncMedia;
    expect(b.engine.getStatus().pendingMedia).toBe(1);
    return { server, b, id: ids[0], p2 };
  }

  /** Frena `linkPageFile` en vuelo, mira el estado y la pastilla, y lo suelta. */
  async function midFlight(b: Device, answer: (...args: unknown[]) => Promise<unknown>) {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let reached!: () => void;
    const inFlight = new Promise<void>((r) => (reached = r));
    b.remote.linkPageFile = (async (...args: unknown[]) => {
      reached();
      await gate;
      return answer(...args);
    }) as typeof b.remote.linkPageFile;
    const run = b.engine.syncMedia();
    await inFlight;
    // El conteo que dispara el arranque de la vuelta.
    await new Promise((r) => setTimeout(r, 50));
    const during = { ...b.engine.getStatus(), text: badge(b) };
    release();
    await run;
    await new Promise((r) => setTimeout(r, 50));
    return { during, after: { ...b.engine.getStatus(), text: badge(b) } };
  }

  it('dice «Uploading» mientras manda y «All synced» al terminar', async () => {
    const { b, server } = await withUse();
    const link = b.remote.linkPageFile.bind(b.remote);
    const { during, after } = await midFlight(b, (...args) => link(...(args as Parameters<typeof link>)));
    expect(server.pageFiles.size).toBeGreaterThan(0);
    expect(during).toMatchObject({ syncing: false, mediaSending: true, pendingMedia: 1 });
    expect(during.text).toBe(t('sync.uploading', { changes: t('sync.changes', { count: 1 }) }));
    expect(after.mediaSending).toBe(false);
    expect(after.text).not.toBe(during.text);
  });

  it('con un error de red al mandar: al terminar la vuelta no dice «Uploading»', async () => {
    const { b } = await withUse();
    const { during, after } = await midFlight(b, () => Promise.reject(new TypeError('Failed to fetch')));
    expect(during.mediaSending).toBe(true);
    expect(after).toMatchObject({ mediaSending: false, pendingMedia: 1 });
    expect(after.text).not.toBe(t('sync.uploading', { changes: t('sync.changes', { count: 1 }) }));
  });

  it('sin red: «Offline», aunque la cola esté corriendo', async () => {
    const { b, server } = await withUse();
    server.online = false;
    await b.engine.syncNow();
    const run = b.engine.syncMedia();
    await new Promise((r) => setTimeout(r, 20));
    expect(badge(b)).toBe(t('sync.offlinePending', { count: pendingSum(b) }));
    await run;
    await new Promise((r) => setTimeout(r, 20));
    expect(b.engine.getStatus().mediaSending).toBe(false);
    expect(badge(b)).toBe(t('sync.offlinePending', { count: pendingSum(b) }));
  });

  it('con la app vieja para el workspace: no sale nada y no dice «Uploading»', async () => {
    const { b, server } = await withUse();
    server.settings = { ...(server.settings ?? { generation: 1, mediaUrl: null, schemaVersion: 1 }), minAppVersion: '9.000' } as never;
    await b.engine.syncNow();
    expect(b.engine.getStatus().outdated).toBe(true);
    const sent = calls(server, 'link_page_file').length;
    await b.engine.syncMedia();
    await new Promise((r) => setTimeout(r, 20));
    expect(calls(server, 'link_page_file')).toHaveLength(sent);
    expect(b.engine.getStatus().mediaSending).toBe(false);
    expect(badge(b)).toBe(t('sync.updatePending', { changes: t('sync.changes', { count: pendingSum(b) }) }));
  });

  it('con el Drive sin conectar (409): «not uploaded · retrying», como antes', async () => {
    const server = new FakeServer();
    server.enableTrash();
    const a = await device(server);
    await sync(a);
    const page = await a.tree.create(null, 'Día 1');
    await sync(a);
    server.portero.disconnected = true;
    await a.media.add(page, photo('SIN_DRIVE.JPG'));
    await a.engine.syncNow();
    await a.engine.syncMedia();
    await new Promise((r) => setTimeout(r, 20));
    const s = a.engine.getStatus();
    expect(s.mediaSending).toBe(false);
    expect(s.pendingMedia).toBeGreaterThan(0);
    expect(s.mediaError).toBeTruthy();
    expect(badge(a)).toBe(t('sync.notUploadedRetrying', { changes: t('sync.changes', { count: pendingSum(a) }) }));
  });

  it('con la cola en curso, los avisos de sin red, app vieja y error de la cola ganan sobre «Uploading»', async () => {
    const { b } = await withUse();
    const base = { ...b.engine.getStatus(), mediaSending: true, syncing: false, uploading: null };
    const changes = t('sync.changes', { count: 1 });
    expect(syncTone(base, 1, false, t).text).toBe(t('sync.uploading', { changes }));
    expect(syncTone({ ...base, online: false }, 1, false, t)).toMatchObject({ tone: 'offline', text: t('sync.offlinePending', { count: 1 }) });
    expect(syncTone({ ...base, outdated: true }, 1, false, t)).toMatchObject({ tone: 'warn', text: t('sync.updatePending', { changes }) });
    expect(syncTone({ ...base, mediaError: 'Google Drive is not connected.' }, 1, false, t)).toMatchObject({
      tone: 'warn',
      text: t('sync.notUploadedRetrying', { changes }),
    });
  });

  it('un conteo que empezó con la vuelta en curso y termina después no deja un «Uploading» viejo', async () => {
    const { b } = await withUse();
    const link = b.remote.linkPageFile.bind(b.remote);
    // Un conteo lento: el que arranca mientras el pedido está en vuelo termina después de que la vuelta cerró.
    const unsynced = b.docs.unsyncedPages.bind(b.docs);
    let slow: (() => void) | null = null;
    let armed = false;
    b.docs.unsyncedPages = (async () => {
      const out = await unsynced();
      if (armed) {
        armed = false;
        await new Promise<void>((r) => (slow = r));
      }
      return out;
    }) as typeof b.docs.unsyncedPages;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    b.remote.linkPageFile = (async (...args: Parameters<typeof link>) => {
      armed = true;
      // Un conteo cualquiera mientras manda (cualquier cambio en la cola lo dispara).
      void (b.engine as unknown as { refreshCounts: () => Promise<void> }).refreshCounts();
      await gate;
      return link(...args);
    }) as typeof b.remote.linkPageFile;
    const run = b.engine.syncMedia();
    await new Promise((r) => setTimeout(r, 30));
    release();
    await run;
    await new Promise((r) => setTimeout(r, 30));
    expect(slow).not.toBeNull();
    // Termina el conteo viejo, el último en publicar.
    slow!();
    await new Promise((r) => setTimeout(r, 30));
    expect(b.engine.getStatus().mediaSending).toBe(false);
    expect(badge(b)).not.toBe(t('sync.uploading', { changes: t('sync.changes', { count: pendingSum(b) }) }));
  });
});
