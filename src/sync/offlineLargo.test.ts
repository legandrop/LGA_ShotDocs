// Volver después de mucho tiempo sin red (Docs/Doc_Sincronizacion.md, "Volver después de mucho tiempo sin red").
//
// El caso de Lega: se va dos semanas a un rodaje sin red con la v0.090 instalada y trabaja ahí (texto, renglones
// borrados, fotos, páginas nuevas, páginas movidas, comentarios). Mientras tanto otro dispositivo, con una versión
// más nueva, edita las mismas páginas y otras, y quizás se sube `min_app_version`. Cuando vuelve la red:
//
// 1. La v0.090 se conecta: tiene que avisar "actualizá", no subir el contenido, y no perder nada de lo suyo.
// 2. La app se actualiza: el código actual abre LA MISMA base local (IndexedDB) y sube todo.
// 3. Al final todos los dispositivos (y uno que entra recién) ven lo mismo, con todo lo de los dos.
//
// La versión vieja es la sincronización de la v0.090 de verdad (motor, contenido, árbol, base local e imágenes:
// `fixtures/v090/`, copias sin tocar). La cola de fotos y videos y la de comentarios son las de hoy: su base no cambió
// de versión desde la v0.090 (solo campos opcionales nuevos) y el freno por versión de la cola existe desde la v0.090.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { mediaDbName, openMediaDb, type MediaDb } from '../media/mediaDb';
import { Portero } from '../media/portero';
import { MediaQueue, mediaIdOf } from '../media/queue';
import { AccessStore, Permissions } from './access';
import { CommentQueue, commentsDbName, openCommentsDb, type CommentsDb } from './comments';
import { PageDocs } from './docs';
import { SyncEngine } from './engine';
import { PageFiles } from './files';
import { openLocalDb } from './localDb';
import { CONTENT_FRAGMENT, normalizeStructure, seedIfEmpty } from './structure';
import { FakeRemote, FakeServer, fakeProbe, fakeViewImage } from './testing';
import { PageTree } from './tree';
import { RemoteError, type PageRow } from './types';
import { PageDocs as PageDocs090 } from './fixtures/v090/docs';
import { SyncEngine as SyncEngine090 } from './fixtures/v090/engine';
import { PageFiles as PageFiles090 } from './fixtures/v090/files';
import { openLocalDb as openLocalDb090 } from './fixtures/v090/localDb';
import { PageTree as PageTree090 } from './fixtures/v090/tree';

const DAY = 24 * 60 * 60 * 1000;
const OLD = '0.090';
const NEW = '0.097';

/** La red de un dispositivo: con `down`, todo lo que pide (base, portero) falla como sin conexión. */
interface Net {
  down: boolean;
  /** Solo falla la bajada de contenido (una sesión que bajó el árbol y se cerró antes de bajar las páginas). */
  noPulls?: boolean;
}

/** Lo que las pruebas usan de un dispositivo, sea de la v0.090 o de la versión actual. */
interface Dev {
  kind: 'v090' | 'actual';
  version: string;
  dbName: string;
  net: Net;
  tree: Pick<PageTree, 'create' | 'move' | 'rename' | 'trash' | 'get' | 'pendingOps' | 'failedOps' | 'hasUnsentCreate'>;
  docs: Pick<PageDocs, 'open' | 'flush' | 'close' | 'unsyncedPages'>;
  engine: Pick<SyncEngine, 'syncNow' | 'syncMedia' | 'getStatus' | 'prefetchPage'>;
  media: MediaQueue;
  comments: CommentQueue;
  close(): Promise<void>;
}

const open: Dev[] = [];

afterEach(async () => {
  for (const d of open.splice(0)) await d.close().catch(() => undefined);
  vi.useRealTimers();
});

/** El servidor de la base, con un corte de red propio de este dispositivo. */
function cutRemote(remote: FakeRemote, net: Net): FakeRemote {
  return new Proxy(remote, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown;
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) =>
        net.down || (net.noPulls && prop === 'pullUpdates')
          ? Promise.reject(new RemoteError('Failed to fetch', false, undefined, true))
          : (value as (...a: unknown[]) => unknown).apply(target, args);
    },
  });
}

/** Lo común a las dos versiones: el servidor con su corte, los permisos, la cola de archivos y la de comentarios. */
async function common(server: FakeServer, dbName: string, version: string, net: Net) {
  const remote = cutRemote(new FakeRemote(server, version), net);
  const mediaDb: MediaDb = await openMediaDb(mediaDbName(dbName));
  const media = new MediaQueue(mediaDb, remote, {
    portero: (url) =>
      new Portero(url, {
        fetch: (input, init) => (net.down ? Promise.reject(new TypeError('Failed to fetch')) : server.portero.fetch(input, init)),
        send: (input, init) => (net.down ? Promise.reject(new TypeError('Failed to fetch')) : server.portero.send(input, init)),
        token: async () => `token:${remote.userId}`,
        wait: async () => undefined,
        now: () => Date.now() + server.clockOffset,
      }),
    probe: fakeProbe,
    preview: async () => null,
    playMark: async (thumb) => thumb,
    viewImage: fakeViewImage,
    convertHeic: (file) => server.convertHeic(file),
    offline: () => net.down,
    now: () => Date.now() + server.clockOffset,
  });
  await media.load();
  const commentsDb: CommentsDb = await openCommentsDb(commentsDbName(dbName));
  const comments = new CommentQueue(commentsDb, remote, remote.userId, {
    now: () => Date.now() + server.clockOffset,
  });
  await comments.load();
  return { remote, media, mediaDb, comments, commentsDb };
}

/** La app instalada en un dispositivo: la v0.090 o la versión actual, sobre la base local `dbName`. */
async function device(
  kind: 'v090' | 'actual',
  server: FakeServer,
  dbName: string,
  version: string,
  net: Net = { down: false },
): Promise<Dev> {
  const { remote, media, mediaDb, comments, commentsDb } = await common(server, dbName, version, net);
  const workspaceId = (await remote.ensureWorkspace().catch(() => null)) ?? server.workspaceId;
  let dev: Dev;
  if (kind === 'v090') {
    const db = await openLocalDb090(dbName);
    const access = new AccessStore(db, remote.userId);
    await access.load();
    const tree = new PageTree090(db, workspaceId);
    await tree.load();
    const docs = new PageDocs090(db, {
      normalize: normalizeStructure,
      seed: seedIfEmpty,
      canWrite: (pageId) => new Permissions(tree as unknown as PageTree, access.get(), remote.userId).canEditPage(pageId),
    });
    const files = new PageFiles090(db, remote);
    const engine = new SyncEngine090(remote, tree as unknown as PageTree, docs, files, { appVersion: version, media, access, comments });
    dev = {
      kind,
      version,
      dbName,
      net,
      tree: tree as unknown as Dev['tree'],
      docs: docs as unknown as Dev['docs'],
      engine: engine as unknown as Dev['engine'],
      media,
      comments,
      close: async () => {
        engine.stop();
        await engine.syncMedia().catch(() => undefined);
        docs.dispose();
        db.close();
        mediaDb.close();
        commentsDb.close();
      },
    };
  } else {
    const db = await openLocalDb(dbName);
    const access = new AccessStore(db, remote.userId);
    await access.load();
    const tree = new PageTree(db, workspaceId);
    await tree.load();
    const docs = new PageDocs(db, {
      normalize: normalizeStructure,
      seed: seedIfEmpty,
      canWrite: (pageId) => new Permissions(tree, access.get(), remote.userId).canEditPage(pageId),
    });
    const files = new PageFiles(db, remote);
    const engine = new SyncEngine(remote, tree, docs, files, {
      appVersion: version,
      media,
      access,
      comments,
    });
    dev = {
      kind,
      version,
      dbName,
      net,
      tree,
      docs,
      engine,
      media,
      comments,
      close: async () => {
        await engine.stop();
        await engine.syncMedia().catch(() => undefined);
        docs.dispose();
        db.close();
        mediaDb.close();
        commentsDb.close();
      },
    };
  }
  open.push(dev);
  return dev;
}

/** Cierra la app (el sistema la mata o se actualiza) y la abre de nuevo sobre la misma base local. */
async function reopen(d: Dev, server: FakeServer, kind: 'v090' | 'actual', version: string): Promise<Dev> {
  await d.close();
  open.splice(open.indexOf(d), 1);
  return device(kind, server, d.dbName, version, d.net);
}

/** Todo lo que haya: ciclos y la cola de archivos, varias vueltas. */
async function syncAll(...devs: Dev[]): Promise<void> {
  for (let round = 0; round < 4; round++) {
    for (const d of devs) {
      await d.engine.syncNow();
      await d.engine.syncMedia();
    }
  }
  for (const d of devs) await d.engine.syncNow();
}

// --- Contenido de una página, con la forma del editor (blockGroup > blockContainer > contenido) ---------------------

function rootOf(doc: Y.Doc): Y.XmlElement {
  const root = doc.getXmlFragment(CONTENT_FRAGMENT).get(0);
  if (!(root instanceof Y.XmlElement)) throw new Error('la página no tiene raíz');
  return root;
}

function block(content: Y.XmlElement): Y.XmlElement {
  const container = new Y.XmlElement('blockContainer');
  container.setAttribute('id', crypto.randomUUID());
  container.insert(0, [content]);
  return container;
}

function paragraph(text: string): Y.XmlElement {
  const p = new Y.XmlElement('paragraph');
  p.insert(0, [new Y.XmlText(text)]);
  return p;
}

function image(url: string): Y.XmlElement {
  const img = new Y.XmlElement('image');
  img.setAttribute('url', url);
  return img;
}

/** Cada bloque como texto: el del párrafo, o `[foto <id>]`. Los vacíos (la semilla) no cuentan. */
function linesOf(doc: Y.Doc): string[] {
  const out: string[] = [];
  // Una página sin contenido (una carpeta) no tiene raíz.
  if (doc.getXmlFragment(CONTENT_FRAGMENT).length === 0) return out;
  for (const container of rootOf(doc).toArray()) {
    if (!(container instanceof Y.XmlElement)) continue;
    const content = container.get(0);
    if (!(content instanceof Y.XmlElement)) continue;
    if (content.nodeName === 'image') out.push(`[foto ${mediaIdOf(content.getAttribute('url') as string)}]`);
    else {
      const text = content
        .toArray()
        .map((t) => (t instanceof Y.XmlText ? t.toString() : ''))
        .join('');
      if (text) out.push(text);
    }
  }
  return out;
}

/** El índice del bloque cuyo texto es `text` (o empieza con él). */
function findLine(root: Y.XmlElement, text: string): number {
  return root.toArray().findIndex((c) => {
    const content = c instanceof Y.XmlElement ? c.get(0) : null;
    return (
      content instanceof Y.XmlElement &&
      content.nodeName === 'paragraph' &&
      content.toArray().some((t) => t instanceof Y.XmlText && t.toString().startsWith(text))
    );
  });
}

type Edit = { add: string } | { photo: string } | { remove: string } | { append: [string, string] };

/** Edita una página como lo haría el editor (una edición por tecla, guardada en el dispositivo). */
async function edit(d: Dev, pageId: string, edits: Edit[]): Promise<void> {
  const doc = await d.docs.open(pageId, { seed: true });
  for (const e of edits) {
    const root = rootOf(doc);
    if ('add' in e) root.insert(root.length, [block(paragraph(e.add))]);
    else if ('photo' in e) root.insert(root.length, [block(image(e.photo))]);
    else if ('remove' in e) {
      const at = findLine(root, e.remove);
      if (at < 0) throw new Error(`no está el renglón ${e.remove}`);
      root.delete(at, 1);
    } else {
      const at = findLine(root, e.append[0]);
      const text = (root.get(at) as Y.XmlElement).get(0) as Y.XmlElement;
      const yText = text.get(0) as Y.XmlText;
      yText.insert(yText.length, e.append[1]);
    }
  }
  await d.docs.flush(pageId);
  d.docs.close(pageId);
}

async function readLines(d: Dev, pageId: string): Promise<string[]> {
  const doc = await d.docs.open(pageId);
  const lines = linesOf(doc);
  d.docs.close(pageId);
  return lines;
}

/** Lo que tiene el servidor de una página: todos sus updates juntos. */
function serverLines(server: FakeServer, pageId: string): string[] {
  const doc = new Y.Doc();
  for (const u of server.updates.get(pageId) ?? []) Y.applyUpdate(doc, u.data);
  return doc.getXmlFragment(CONTENT_FRAGMENT).length === 0 ? [] : linesOf(doc);
}

function photo(name: string, size = 64 * 1024): File {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 7 + name.length) % 251;
  return new File([bytes], name, { type: 'image/jpeg' });
}

/** Agrega una foto como el editor: primero a la cola del dispositivo, después el bloque con su dirección. */
async function addPhoto(d: Dev, pageId: string, name: string): Promise<string> {
  const url = await d.media.add(pageId, photo(name));
  await edit(d, pageId, [{ photo: url }]);
  return mediaIdOf(url)!;
}

/** El árbol como lo ve un dispositivo: título, padre y papelera de cada página que conoce el servidor. */
function treeView(d: Dev, ids: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of ids) {
    const row = d.tree.get(id) as PageRow | undefined;
    out[id] = row ? `${row.title} | ${row.parent_id ?? '-'} | ${row.deleted_at ? 'papelera' : 'viva'}` : '(no está)';
  }
  return out;
}

/** Sin nada por subir y sin nada rechazado. */
function clean(d: Dev): void {
  const s = d.engine.getStatus();
  expect({
    pendingOps: s.pendingOps,
    pendingPages: s.pendingPages,
    pendingMedia: s.pendingMedia,
    pendingComments: s.pendingComments,
    pendingFiles: s.pendingFiles,
    failedOps: s.failedOps,
    rejectedPages: s.rejectedPages,
    failedMedia: s.failedMedia,
    failedComments: s.failedComments,
    outdated: s.outdated,
  }).toEqual({
    pendingOps: 0,
    pendingPages: 0,
    pendingMedia: 0,
    pendingComments: 0,
    pendingFiles: 0,
    failedOps: 0,
    rejectedPages: 0,
    failedMedia: 0,
    failedComments: 0,
    outdated: false,
  });
}

/** Todos ven lo mismo: el árbol, cada página y lo que tiene el servidor. Devuelve las líneas de cada página. */
async function sameEverywhere(server: FakeServer, devs: Dev[]): Promise<Record<string, string[]>> {
  const ids = [...server.pages.keys()];
  const first = treeView(devs[0], ids);
  for (const d of devs.slice(1)) expect(treeView(d, ids)).toEqual(first);
  const pages: Record<string, string[]> = {};
  for (const id of ids) {
    const lines = await readLines(devs[0], id);
    for (const d of devs.slice(1)) expect(await readLines(d, id)).toEqual(lines);
    expect(serverLines(server, id)).toEqual(lines);
    pages[id] = lines;
  }
  return pages;
}

/** Cada renglón de `want` está una sola vez y ninguno de `gone` está. */
function expectLines(lines: string[], want: string[], gone: string[] = []): void {
  for (const w of want)
    expect(
      lines.filter((l) => l.includes(w)),
      `"${w}" en ${JSON.stringify(lines)}`,
    ).toHaveLength(1);
  for (const g of gone)
    expect(
      lines.some((l) => l.includes(g)),
      `"${g}" no debería estar`,
    ).toBe(false);
}

/** El workspace como el de Lega hoy: equipo, comentarios, portero y papelera de archivos. */
function workspace(): FakeServer {
  const server = new FakeServer();
  server.enableTrash();
  return server;
}

interface Scene {
  server: FakeServer;
  a: Dev;
  b: Dev;
  rodaje: string;
  escena12: string;
  escena14: string;
  notas: string;
  dia1: string;
}

/** Antes de irse: A (la versión vieja) y B al día, con un proyecto armado. */
async function before(server: FakeServer, aKind: 'v090' | 'actual', aVersion: string): Promise<Scene> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-01T09:00:00Z'));
  const a = await device(aKind, server, `a-${crypto.randomUUID()}`, aVersion);
  const b = await device('actual', server, `b-${crypto.randomUUID()}`, NEW);
  const rodaje = await a.tree.create(null, 'Rodaje');
  const escena12 = await a.tree.create(null, 'Escena 12');
  const escena14 = await a.tree.create(null, 'Escena 14');
  const notas = await a.tree.create(null, 'Notas generales');
  const dia1 = await a.tree.create(rodaje, 'Día 1');
  await edit(a, escena12, [
    { add: 'E12-1 plano general' },
    { add: 'E12-2 contraplano' },
    { add: 'E12-3 inserto' },
    { add: 'E12-4 grúa' },
    { add: 'E12-5 dron' },
  ]);
  await edit(a, escena14, [{ add: 'E14-1 interior auto' }, { add: 'E14-2 pantalla verde' }, { add: 'E14-3 reflejos' }]);
  await edit(a, notas, [{ add: 'N-1 lentes' }]);
  await edit(a, dia1, [{ add: 'D1-1 llamado 7 am' }]);
  await syncAll(a, b);
  clean(a);
  clean(b);
  return { server, a, b, rodaje, escena12, escena14, notas, dia1 };
}

/** Lo que hace cada uno durante las dos semanas. A sin red; B con red y la versión nueva. */
async function twoWeeks(s: Scene, { raiseMin }: { raiseMin: boolean }) {
  const { server, a, b } = s;
  a.net.down = true;
  const day = (n: number) => vi.setSystemTime(new Date(Date.parse('2026-10-01T09:00:00Z') + n * DAY));

  day(1);
  await edit(a, s.escena12, [{ add: 'A-E12 toma 3 buena' }, { append: ['E12-2', ' (A: cambiar lente)'] }, { remove: 'E12-4' }]);
  await edit(b, s.escena12, [{ add: 'B-E12 cambio de plan' }, { append: ['E12-2', ' (B: con steady)'] }, { remove: 'E12-5' }]);
  await syncAll(b);
  // A intenta sincronizar sin red: no pasa nada, nada se pierde.
  await a.engine.syncNow();
  expect(a.engine.getStatus().online).toBe(false);

  day(2);
  const dia2 = await a.tree.create(s.rodaje, 'Día 2');
  await edit(a, dia2, [{ add: 'A-D2 llamado 6 am' }, { add: 'A-D2 lluvia a la tarde' }]);
  const fotoDia2 = await addPhoto(a, dia2, 'IMG_2001.JPG');

  day(3);
  const fotoE12 = await addPhoto(a, s.escena12, 'IMG_3012.JPG');
  await a.engine.syncNow();
  await a.engine.syncMedia();

  day(4);
  await edit(b, s.escena14, [{ add: 'B-E14 agregar lluvia' }, { remove: 'E14-3' }]);
  const locaciones = await b.tree.create(null, 'Locaciones');
  await edit(b, locaciones, [{ add: 'B-L1 galpón Barracas' }]);
  const fotoB = await addPhoto(b, locaciones, 'IMG_4100.JPG');
  await syncAll(b);

  day(5);
  // A mueve la Escena 14 adentro de Rodaje y la edita.
  await a.tree.move(s.escena14, s.rodaje);
  await edit(a, s.escena14, [{ add: 'A-E14 reflejos resueltos en set' }, { remove: 'E14-1' }]);

  day(6);
  await a.tree.rename(s.notas, 'Notas generales (rodaje)');
  await a.comments.add(s.escena12, null, 'A: revisar el inserto con arte');

  day(7);
  await edit(b, s.notas, [{ add: 'B-N lentes alquilados' }]);
  await b.comments.add(s.escena12, null, 'B: el inserto ya está aprobado');
  await syncAll(b);
  if (raiseMin) server.settings = { ...server.settings!, minAppVersion: Number(NEW) };

  day(9);
  // El sistema mata la app de A (pasa en el iPhone): la vuelve a abrir, sin red, con la misma versión.
  s.a = await reopen(a, server, a.kind, a.version);
  await s.a.engine.syncNow();
  await edit(s.a, s.escena12, [{ add: 'A-E12 día 9 sin red' }]);

  day(13);
  await edit(s.a, dia2, [{ remove: 'A-D2 lluvia' }, { add: 'A-D2 se filmó todo' }]);
  await edit(b, s.escena12, [{ add: 'B-E12 día 13' }]);
  await syncAll(b);

  day(14);
  return { dia2, fotoDia2, fotoE12, locaciones, fotoB };
}

/** Lo que tiene que estar al final, de los dos. */
function expectEverything(s: Scene, w: Awaited<ReturnType<typeof twoWeeks>>, pages: Record<string, string[]>): void {
  expectLines(
    pages[s.escena12],
    [
      'E12-1',
      'E12-2 contraplano',
      ' (A: cambiar lente)',
      ' (B: con steady)',
      'E12-3',
      'A-E12 toma 3 buena',
      'B-E12 cambio de plan',
      'A-E12 día 9 sin red',
      'B-E12 día 13',
      `[foto ${w.fotoE12}]`,
    ],
    ['E12-4', 'E12-5'],
  );
  expectLines(pages[s.escena14], ['E14-2', 'B-E14 agregar lluvia', 'A-E14 reflejos resueltos'], ['E14-1', 'E14-3']);
  expectLines(pages[s.notas], ['N-1 lentes', 'B-N lentes alquilados']);
  expectLines(pages[w.dia2], ['A-D2 llamado 6 am', 'A-D2 se filmó todo', `[foto ${w.fotoDia2}]`], ['A-D2 lluvia']);
  expectLines(pages[w.locaciones], ['B-L1 galpón Barracas', `[foto ${w.fotoB}]`]);
  const { server } = s;
  // El árbol: la página nueva de A, el movimiento y el renombre.
  expect(server.pages.get(w.dia2)?.parent_id).toBe(s.rodaje);
  expect(server.pages.get(s.escena14)?.parent_id).toBe(s.rodaje);
  expect(server.pages.get(s.notas)?.title).toBe('Notas generales (rodaje)');
  // Las fotos: registradas, en el Drive con sus bytes y en uso en su página.
  for (const [id, pageId, name] of [
    [w.fotoDia2, w.dia2, 'IMG_2001.JPG'],
    [w.fotoE12, s.escena12, 'IMG_3012.JPG'],
    [w.fotoB, w.locaciones, 'IMG_4100.JPG'],
  ]) {
    expect(server.mediaFiles.get(id)?.drive_id, name).toBeTruthy();
    expect(server.mediaFiles.get(id)?.trashed_at ?? null, name).toBeNull();
    expect(server.pageFiles.has(`${pageId}:${id}`), name).toBe(true);
    const inDrive = [...server.portero.drive.values()].find((f) => f.file === id);
    expect(inDrive?.data.length, name).toBe(photo(name).size);
  }
  // Los comentarios de los dos.
  const bodies = [...server.comments.values()].filter((c) => !c.deleted_at).map((c) => c.body);
  expect(bodies).toEqual(expect.arrayContaining(['A: revisar el inserto con arte', 'B: el inserto ya está aprobado']));
}

/** Lo que tiene el servidor de A antes de actualizar: nada de su contenido ni de sus fotos. */
function nothingOfA(s: Scene, w: Awaited<ReturnType<typeof twoWeeks>>): void {
  const { server } = s;
  for (const id of [s.escena12, s.escena14, s.notas, w.dia2]) {
    expect(
      serverLines(server, id).filter((l) => l.startsWith('A-') || l.includes('(A:')),
      id,
    ).toEqual([]);
  }
  expect(server.updates.get(w.dia2) ?? []).toHaveLength(0);
  for (const id of [w.fotoDia2, w.fotoE12]) {
    expect(server.mediaFiles.has(id)).toBe(false);
    expect([...server.portero.drive.values()].some((f) => f.file === id)).toBe(false);
  }
}

/** Lo de A sigue entero en su dispositivo (con la versión que tenga). */
async function allOfAOnDevice(a: Dev, s: Scene, w: Awaited<ReturnType<typeof twoWeeks>>): Promise<void> {
  expectLines(
    await readLines(a, s.escena12),
    ['A-E12 toma 3 buena', ' (A: cambiar lente)', 'A-E12 día 9 sin red', `[foto ${w.fotoE12}]`],
    ['E12-4'],
  );
  expectLines(await readLines(a, s.escena14), ['A-E14 reflejos resueltos'], ['E14-1']);
  expectLines(await readLines(a, w.dia2), ['A-D2 llamado 6 am', 'A-D2 se filmó todo', `[foto ${w.fotoDia2}]`], ['A-D2 lluvia']);
  expect(a.tree.get(w.dia2)?.parent_id).toBe(s.rodaje);
  expect(a.tree.get(s.escena14)?.parent_id).toBe(s.rodaje);
  expect(a.tree.get(s.notas)?.title).toBe('Notas generales (rodaje)');
}

function commentBodies(server: FakeServer): (string | null)[] {
  return [...server.comments.values()].filter((c) => !c.deleted_at).map((c) => c.body);
}

describe('volver después de dos semanas sin red con la v0.090', () => {
  it('con la mínima subida: avisa, no sube contenido ni fotos, no pierde nada; al actualizar sube todo y quedan iguales', async () => {
    const s = await before(workspace(), 'v090', OLD);
    const w = await twoWeeks(s, { raiseMin: true });
    const { server, b } = s;
    nothingOfA(s, w);
    expect(server.pages.has(w.dia2)).toBe(false);

    // Vuelve la red, todavía con la v0.090.
    const a = s.a;
    a.net.down = false;
    await syncAll(a);
    const st = a.engine.getStatus();
    expect(st.online).toBe(true);
    expect(st.outdated).toBe(true);
    expect(st.failedOps + st.rejectedPages + st.failedMedia + st.failedComments).toBe(0);
    expect(st.pendingPages).toBe(3);
    expect(st.pendingMedia).toBeGreaterThanOrEqual(2);
    nothingOfA(s, w);
    // Lo que la v0.090 todavía hace aunque esté vieja (la versión actual ya no, ver la prueba de abajo): sube los
    // cambios del árbol y los comentarios (la base no los frena por versión) y baja el contenido nuevo de los demás.
    expect(server.pages.get(w.dia2)?.parent_id).toBe(s.rodaje);
    expect(commentBodies(server)).toContain('A: revisar el inserto con arte');
    expectLines(await readLines(a, s.escena12), ['B-E12 día 13']);
    await allOfAOnDevice(a, s, w);

    // Se actualiza: el código actual abre la misma base local.
    const updated = await reopen(a, server, 'actual', NEW);
    await allOfAOnDevice(updated, s, w);
    await syncAll(updated, b);
    clean(updated);
    clean(b);
    const c = await device('actual', server, `c-${crypto.randomUUID()}`, NEW);
    await syncAll(c);
    clean(c);
    expectEverything(s, w, await sameEverywhere(server, [updated, b, c]));
  });

  it('sin subir la mínima: la v0.090 sube todo directo al volver, sin pérdidas, y actualizar después no cambia nada', async () => {
    const s = await before(workspace(), 'v090', OLD);
    const w = await twoWeeks(s, { raiseMin: false });
    const { server, b } = s;
    nothingOfA(s, w);

    const a = s.a;
    a.net.down = false;
    await syncAll(a, b);
    clean(a);
    clean(b);
    const c = await device('actual', server, `c-${crypto.randomUUID()}`, NEW);
    await syncAll(c);
    const pages = await sameEverywhere(server, [a, b, c]);
    expectEverything(s, w, pages);

    const updated = await reopen(a, server, 'actual', NEW);
    await syncAll(updated, b, c);
    clean(updated);
    expect(await sameEverywhere(server, [updated, b, c])).toEqual(pages);
  });
});

describe('una versión actual que queda vieja (la mínima sube mientras está sin red)', () => {
  it('al volver no sube nada (ni árbol, ni contenido, ni fotos, ni comentarios) y no baja contenido; al actualizar sube todo', async () => {
    const s = await before(workspace(), 'actual', '0.095');
    const w = await twoWeeks(s, { raiseMin: true });
    const { server, b } = s;
    const a = s.a;
    const treeBefore = {
      escena14: server.pages.get(s.escena14)?.parent_id ?? null,
      notas: server.pages.get(s.notas)?.title,
    };
    const updatesBefore = new Map([...server.updates].map(([id, list]) => [id, list.length]));

    a.net.down = false;
    await syncAll(a);
    const st = a.engine.getStatus();
    expect(st.online).toBe(true);
    expect(st.outdated).toBe(true);
    expect(st.failedOps + st.rejectedPages + st.failedMedia + st.failedComments).toBe(0);
    expect(st.pendingOps).toBeGreaterThan(0);
    expect(st.pendingComments).toBe(1);
    nothingOfA(s, w);
    // Nada del árbol ni de los comentarios.
    expect(server.pages.has(w.dia2)).toBe(false);
    expect(server.pages.get(s.escena14)?.parent_id ?? null).toBe(treeBefore.escena14);
    expect(server.pages.get(s.notas)?.title).toBe(treeBefore.notas);
    expect(commentBodies(server)).not.toContain('A: revisar el inserto con arte');
    expect(new Map([...server.updates].map(([id, list]) => [id, list.length]))).toEqual(updatesBefore);
    // No bajó el contenido nuevo de B: ni en las páginas que ya tenía ni en la nueva (que sí ve en el árbol).
    expect((await readLines(a, s.escena12)).filter((l) => l.startsWith('B-E12 día 13'))).toEqual([]);
    expect(a.tree.get(w.locaciones)?.title).toBe('Locaciones');
    expect(await a.engine.prefetchPage(w.locaciones, 100)).toBe(false);
    expect(await readLines(a, w.locaciones)).toEqual([]);
    await allOfAOnDevice(a, s, w);

    // Lo suyo sigue editable mientras tanto.
    await edit(a, s.escena12, [{ add: 'A-E12 con aviso de actualizar' }]);
    await syncAll(a);
    nothingOfA(s, w);

    const updated = await reopen(a, server, 'actual', NEW);
    await syncAll(updated, b);
    clean(updated);
    clean(b);
    const c = await device('actual', server, `c-${crypto.randomUUID()}`, NEW);
    await syncAll(c);
    const pages = await sameEverywhere(server, [updated, b, c]);
    expectEverything(s, w, pages);
    expectLines(pages[s.escena12], ['A-E12 con aviso de actualizar']);
  });

  it('una página que se abre antes del primer ciclo no baja nada si la versión es vieja', async () => {
    const server = workspace();
    const b = await device('actual', server, `b-${crypto.randomUUID()}`, NEW);
    const page = await b.tree.create(null, 'Escena 30');
    await edit(b, page, [{ add: 'B-30 lo nuevo' }]);
    await syncAll(b);
    const first = await device('actual', server, `a-${crypto.randomUUID()}`, '0.095');
    await first.engine.syncNow();
    await edit(b, page, [{ add: 'B-30 más nuevo' }]);
    await syncAll(b);
    // La sesión anterior alcanzó a bajar el árbol (sabe que la página cambió) pero no el contenido.
    first.net.noPulls = true;
    await first.engine.syncNow();
    first.net.noPulls = false;
    server.settings = { ...server.settings!, minAppVersion: Number(NEW) };

    // La app se abre con red y la persona toca la página enseguida, antes de que termine el primer ciclo.
    const a = await reopen(first, server, 'actual', '0.095');
    let pulled = 0;
    const realPull = server.updates.get.bind(server.updates);
    server.updates.get = (id: string) => {
      if (id === page) pulled++;
      return realPull(id);
    };
    expect(await a.engine.prefetchPage(page, 200)).toBe(false);
    expect(a.engine.getStatus().outdated).toBe(true);
    expect(pulled).toBe(0);
    expect((await readLines(a, page)).filter((l) => l === 'B-30 más nuevo')).toEqual([]);
  });
});

// --- Variantes al azar ---------------------------------------------------------------------------------------------

function rng(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 2 ** 32;
  };
}

const SEEDS = Number(process.env.OFFLINE_LARGO_SEEDS ?? 6);
const FIRST_SEED = Number(process.env.OFFLINE_LARGO_FIRST ?? 1);

describe('variantes al azar: semanas sin red con la v0.090, con y sin la mínima', () => {
  for (let seed = FIRST_SEED; seed < FIRST_SEED + SEEDS; seed++) {
    it(`semilla ${seed}`, async () => {
      const r = rng(seed * 7919);
      const pick = <T>(list: T[]): T => list[Math.floor(r() * list.length)];
      const server = workspace();
      vi.useFakeTimers({ toFake: ['Date'] });
      const start = Date.parse('2026-10-01T09:00:00Z');
      vi.setSystemTime(start);
      let a = await device('v090', server, `a-${seed}-${crypto.randomUUID()}`, OLD);
      const b = await device('actual', server, `b-${seed}-${crypto.randomUUID()}`, NEW);
      const rodaje = await a.tree.create(null, 'Rodaje');
      const pages = [rodaje];
      for (let i = 0; i < 3; i++) pages.push(await a.tree.create(i === 0 ? rodaje : null, `Página ${i}`));
      const base = (p: string, i: number) => `base-${pages.indexOf(p)}-${i}`;
      for (const p of pages) await edit(a, p, [{ add: base(p, 1) }, { add: base(p, 2) }]);
      await syncAll(a, b);

      // Lo que tiene que quedar: renglones (texto único), agregados a renglones, fotos y páginas nuevas.
      const added = new Set<string>(pages.flatMap((p) => [base(p, 1), base(p, 2)]));
      const removed = new Set<string>();
      const appended: { line: string; token: string }[] = [];
      const photos: {
        id: string;
        pageId: string;
        name: string;
        who: 'A' | 'B';
      }[] = [];
      const created: string[] = [];
      let n = 0;
      const raiseAt = r() < 0.6 ? 1 + Math.floor(r() * 12) : -1;
      /** El renglón (de los que se siguen) que empieza un texto visto en una página. */
      const keyOf = (line: string) => [...added].find((t) => line === t || line.startsWith(`${t} `));

      a.net.down = true;
      const days = 6 + Math.floor(r() * 12);
      for (let day = 1; day <= days; day++) {
        vi.setSystemTime(start + day * DAY + Math.floor((r() * DAY) / 2));
        if (day === raiseAt) server.settings = { ...server.settings!, minAppVersion: Number(NEW) };
        for (const who of ['A', 'B'] as const) {
          const steps = Math.floor(r() * 4);
          for (let step = 0; step < steps; step++) {
            const d = who === 'A' ? a : b;
            // Cada uno toca solo lo que ve: B no ve las páginas que A creó sin red.
            const page = pick(pages.filter((p) => d.tree.get(p)));
            const roll = r();
            if (roll < 0.3) {
              const text = `${who}-${seed}-${++n}`;
              added.add(text);
              await edit(d, page, [{ add: text }]);
            } else if (roll < 0.6) {
              const lines = (await readLines(d, page)).filter((l) => !l.startsWith('[foto'));
              const key = lines.length > 0 ? keyOf(pick(lines)) : undefined;
              if (!key) continue;
              if (roll < 0.45) {
                removed.add(key);
                await edit(d, page, [{ remove: key }]);
              } else {
                const token = `+${who}${++n}`;
                appended.push({ line: key, token });
                await edit(d, page, [{ append: [key, ` ${token}`] }]);
              }
            } else if (roll < 0.7) {
              const name = `IMG_${seed}_${++n}.JPG`;
              photos.push({
                id: await addPhoto(d, page, name),
                pageId: page,
                name,
                who,
              });
            } else if (roll < 0.8) {
              const id = await d.tree.create(r() < 0.5 ? rodaje : null, `${who} nueva ${++n}`);
              pages.push(id);
              created.push(id);
              const text = `${who}-${seed}-${++n}`;
              added.add(text);
              await edit(d, id, [{ add: text }]);
            } else if (roll < 0.87) {
              await d.tree.rename(page, `${who} título ${++n}`);
            } else if (who === 'A' && roll < 0.93) {
              // Solo A mueve, y solo a la raíz o adentro de Rodaje (que nunca se mueve): no puede armar un ciclo.
              if (page !== rodaje) await a.tree.move(page, r() < 0.5 ? rodaje : null);
            } else if (who === 'A') {
              // El sistema mata la app sin red, o la app intenta sincronizar sin red.
              if (r() < 0.5) a = await reopen(a, server, 'v090', OLD);
              else {
                await a.engine.syncNow();
                await a.engine.syncMedia();
              }
            } else {
              await b.comments.add(page, null, `B comenta ${++n}`);
            }
          }
          if (who === 'B') await syncAll(b);
        }
      }

      // Vuelve la red con la v0.090.
      a.net.down = false;
      await syncAll(a);
      const outdated = raiseAt > 0 && raiseAt <= days;
      const st = a.engine.getStatus();
      expect(st.outdated).toBe(outdated);
      expect(st.failedOps + st.rejectedPages + st.failedMedia + st.failedComments).toBe(0);
      if (outdated) {
        // Nada del contenido ni de las fotos de A llegó al servidor.
        for (const p of pages) expect(serverLines(server, p).filter((l) => l.startsWith(`A-${seed}-`) || l.includes(' +A'))).toEqual([]);
        for (const ph of photos) if (ph.who === 'A') expect(server.mediaFiles.has(ph.id), ph.name).toBe(false);
      }

      // Se actualiza (sin la mínima, igual se actualiza después) y todos quedan iguales.
      a = await reopen(a, server, 'actual', NEW);
      await syncAll(a, b);
      clean(a);
      clean(b);
      const c = await device('actual', server, `c-${seed}-${crypto.randomUUID()}`, NEW);
      await syncAll(c);
      const final = await sameEverywhere(server, [a, b, c]);
      const all = Object.values(final).flat();
      for (const text of added) {
        const count = all.filter((l) => l === text || l.startsWith(`${text} `)).length;
        expect(count, `renglón ${text}`).toBe(removed.has(text) ? 0 : 1);
      }
      for (const { line, token } of appended) {
        const re = new RegExp(` \\${token}(?![0-9])`);
        expect(all.filter((l) => re.test(l)).length, `agregado ${token} a ${line}`).toBe(removed.has(line) ? 0 : 1);
      }
      for (const { id, pageId, name } of photos) {
        expect(final[pageId], name).toContain(`[foto ${id}]`);
        expect(server.mediaFiles.get(id)?.drive_id, name).toBeTruthy();
        expect(server.pageFiles.has(`${pageId}:${id}`), name).toBe(true);
      }
      for (const id of created) expect(server.pages.has(id), id).toBe(true);
    }, 120_000);
  }
});
