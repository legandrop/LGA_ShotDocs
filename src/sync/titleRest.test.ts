import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { codePointLength, DB_LIMITS, splitAtLimit, splitTitle } from '../lib/dbLimits';
import { checkPageLengths, checkProjectName, jsonbTextLength } from './lengthChecks';
import { CONTENT_FRAGMENT } from './structure';
import { FakeServer, makeDevice, type Device } from './testing';
import { prependRest, restParagraphs, watchTitleRests } from './titleRest';
import type { FailedOp, QueuedOp } from './types';

// El tope del título (500 caracteres, `pages_title_check`) y lo que sobra, que va al principio de la página
// (Docs/Doc_Sincronizacion.md, "Topes de largo"). Antes, un título más largo quedaba rechazado para siempre.

const devices: Device[] = [];
const stops: (() => void)[] = [];
async function device(server: FakeServer, dbName?: string): Promise<Device> {
  const d = await makeDevice(server, dbName);
  devices.push(d);
  return d;
}

afterEach(async () => {
  for (const stop of stops.splice(0)) stop();
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
});

/** Los textos de los bloques de primer nivel de la página, en orden. */
async function blocks(d: Device, pageId: string): Promise<string[]> {
  const doc = await d.docs.open(pageId);
  const group = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement | undefined;
  const out = (group?.toArray() ?? []).map((c) => ((c as Y.XmlElement).get(0) as Y.XmlElement).toArray().map((t) => t.toString()).join(''));
  d.docs.close(pageId);
  return out;
}

/** Arranca lo que escribe lo que sobra (como la app, services.ts) y espera a que termine. */
async function drain(d: Device, moved: string[] = []): Promise<void> {
  if (!stops.length) stops.push(watchTitleRests(d.tree, d.docs, (r) => moved.push(r.pageId)));
  for (let i = 0; i < 100 && d.tree.titleRests().length > 0; i++) await new Promise((r) => setTimeout(r, 10));
}

const words = (n: number) => Array.from({ length: n }, (_, i) => `palabra${i}`).join(' ');
const REJECTED = 'new row for relation "pages" violates check constraint "pages_title_check"';

describe('cortar por caracteres de la base', () => {
  it('cuenta puntos de código, no unidades de JS, y no parte un emoji en el borde', () => {
    expect(codePointLength('👍')).toBe(1);
    expect('👍'.length).toBe(2);
    // 499 letras y un emoji con tono de piel (dos puntos de código): no entra entero, no se parte.
    const text = `${'a'.repeat(499)}👍🏽fin`;
    const { head, rest } = splitAtLimit(text, 500);
    expect(head).toBe('a'.repeat(499));
    expect(rest).toBe('👍🏽fin');
    // 500 emojis entran (son 1000 unidades de JS, pero 500 caracteres de la base).
    const emojis = '😀'.repeat(500);
    expect(splitAtLimit(emojis, 500).rest).toBe('');
    expect(() => checkPageLengths({ title: emojis })).not.toThrow();
    expect(() => checkPageLengths({ title: `${emojis}x` })).toThrow(/pages_title_check/);
    // Una bandera (dos puntos de código) en el borde tampoco se parte.
    const flag = splitAtLimit(`${'a'.repeat(499)}🇦🇷`, 500);
    expect(flag.head).toBe('a'.repeat(499));
    expect(flag.rest).toBe('🇦🇷');
  });

  it('el título no corta una palabra al medio si hay un espacio cerca', () => {
    const text = `${'a'.repeat(490)} ${'palabralarga'.repeat(3)} y sigue`;
    const { head, rest } = splitTitle(text);
    expect(head).toBe('a'.repeat(490));
    expect(rest).toBe(` ${'palabralarga'.repeat(3)} y sigue`);
    expect(head + rest).toBe(text);
    // Con palabras comunes, nunca queda una partida entre el título y lo que sobra.
    const many = splitTitle(words(80));
    expect(codePointLength(many.head)).toBeLessThanOrEqual(500);
    expect(/\S$/.test(many.head) && /^\S/.test(many.rest)).toBe(false);
    // Si el corte cae justo en un espacio, el título no termina en ese espacio.
    expect(splitTitle(`${'a'.repeat(499)} bcd`)).toEqual({ head: 'a'.repeat(499), rest: ' bcd' });
    // Sin espacios cerca, corta justo en el tope.
    const solid = 'x'.repeat(800);
    expect(splitTitle(solid)).toEqual({ head: 'x'.repeat(500), rest: 'x'.repeat(300) });
  });

  it('los renglones de lo que sobra son párrafos, sin los vacíos', () => {
    expect(restParagraphs(' sigue el título\n\n  segundo   renglón \r\ntercero ')).toEqual(['sigue el título', 'segundo renglón', 'tercero']);
    expect(restParagraphs('  \n ')).toEqual([]);
  });
});

describe('el servidor falso aplica los check de largo de la base', () => {
  it('título, ícono, clave de orden, ajustes y nombre de proyecto', () => {
    expect(() => checkPageLengths({ title: 'x'.repeat(500) })).not.toThrow();
    expect(() => checkPageLengths({ title: 'x'.repeat(501) })).toThrow(/pages_title_check/);
    expect(() => checkPageLengths({ icon: 'x'.repeat(33) })).toThrow(/pages_icon_check/);
    expect(() => checkPageLengths({ sort_key: 'a'.repeat(129) })).toThrow(/pages_sort_key_length/);
    expect(() => checkPageLengths({ settings: { template: { description: 'x'.repeat(1990) } } })).toThrow(/pages_settings_shape/);
    expect(() => checkProjectName('x'.repeat(201))).toThrow(/workspaces_name_length/);
    // Como `length(settings::text)` de Postgres: `{"a": 1, "b": [1, 2]}`.
    expect(jsonbTextLength({ a: 1, b: [1, 2] })).toBe('{"a": 1, "b": [1, 2]}'.length);
  });

  it('rechaza para siempre un título largo que llega sin cortar (como la base)', async () => {
    const server = new FakeServer();
    const d = await device(server);
    const id = await d.tree.create(null, 'Algo');
    await d.engine.syncNow();
    await expect(d.remote.updatePage(id, { title: 'x'.repeat(501) })).rejects.toMatchObject({ permanent: true, code: '23514' });
  });
});

describe('lo que sobra del título va al principio de la página', () => {
  it('renombrar con 800 caracteres: el título queda en 500, sube, y lo demás es el primer párrafo', async () => {
    const server = new FakeServer();
    const d = await device(server);
    const id = await d.tree.create(null, 'Algo');
    await d.engine.syncNow();
    const long = words(90);
    await d.tree.rename(id, long);
    const title = d.tree.get(id)!.title;
    expect(codePointLength(title)).toBeLessThanOrEqual(DB_LIMITS.pageTitle);
    expect(long.startsWith(title)).toBe(true);
    const moved: string[] = [];
    await drain(d, moved);
    expect(moved).toEqual([id]);
    const rest = long.slice(title.length).trim();
    expect(await blocks(d, id)).toEqual([rest]);
    await d.engine.syncNow();
    expect(server.pages.get(id)?.title).toBe(title);
    expect(d.engine.getStatus().failedOps).toBe(0);
    expect(d.tree.titleRests()).toEqual([]);
    // Otro dispositivo ve el título y el párrafo.
    const other = await device(server);
    await other.engine.syncNow();
    expect(other.tree.get(id)?.title).toBe(title);
    expect(await blocks(other, id)).toEqual([rest]);
  });

  it('el párrafo va antes de lo que ya tenía la página', async () => {
    const server = new FakeServer();
    const d = await device(server);
    const id = await d.tree.create(null, 'Algo');
    const doc = await d.docs.open(id);
    prependRest(doc, { id: crypto.randomUUID(), text: 'lo que había' }, Symbol('test'));
    await d.docs.flush(id);
    d.docs.close(id);
    await d.tree.rename(id, `${'t'.repeat(500)}\nsegundo renglón\n\ntercero`);
    await drain(d);
    expect(await blocks(d, id)).toEqual(['segundo renglón', 'tercero', 'lo que había']);
  });

  it('crear una página con un título largo (plantillas, reporte del día, asistente, importar)', async () => {
    const server = new FakeServer();
    const d = await device(server);
    const id = await d.tree.create(null, `Reporte ${'y'.repeat(600)}`);
    expect(codePointLength(d.tree.get(id)!.title)).toBe(500);
    await drain(d);
    expect(await blocks(d, id)).toEqual(['y'.repeat(108)]);
    await d.engine.syncNow();
    expect(server.pages.has(id)).toBe(true);
    expect(d.engine.getStatus().failedOps).toBe(0);
  });

  it('un título que entra no anota nada, y volver a poner el mismo título cortado no repite el párrafo', async () => {
    const server = new FakeServer();
    const d = await device(server);
    const id = await d.tree.create(null, 'Algo');
    await d.tree.rename(id, 'x'.repeat(500));
    expect(d.tree.titleRests()).toEqual([]);
    await d.tree.rename(id, 'x'.repeat(700));
    await d.tree.rename(id, 'x'.repeat(500));
    expect(d.tree.titleRests()).toHaveLength(1);
  });

  it('lo anotado sobrevive a cerrar la app antes de escribirlo, y no se escribe dos veces', async () => {
    const server = new FakeServer();
    const name = crypto.randomUUID();
    const a = await device(server, name);
    const id = await a.tree.create(null, 'Algo');
    await a.tree.rename(id, 'z'.repeat(650));
    const [rest] = a.tree.titleRests();
    // Se escribió en la página pero la app se cortó antes de olvidarlo.
    const doc = await a.docs.open(id);
    expect(prependRest(doc, rest, Symbol('test'))).toBe(true);
    await a.docs.flush(id);
    a.docs.close(id);
    await a.engine.stop();
    a.db.close();
    devices.splice(devices.indexOf(a), 1);

    const b = await device(server, name);
    expect(b.tree.titleRests()).toHaveLength(1);
    await drain(b);
    expect(await blocks(b, id)).toEqual(['z'.repeat(150)]);
    expect(b.tree.titleRests()).toEqual([]);
  });

  it('una página sin nada todavía recibe su primer bloque', () => {
    const doc = new Y.Doc();
    expect(prependRest(doc, { id: 'r1', text: 'hola' })).toBe(true);
    expect(prependRest(doc, { id: 'r1', text: 'hola' })).toBe(false);
    expect(prependRest(doc, { id: 'r2', text: '  ' })).toBe(false);
    const group = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
    expect(group.nodeName).toBe('blockGroup');
    expect(group.length).toBe(1);
    expect((group.get(0) as Y.XmlElement).getAttribute('id')).toBe('r1');
  });
});

describe('la cola: lo que ya rechazó el servidor por el largo', () => {
  it('un cambio de título rechazado por pages_title_check vuelve a la cola cortado y sube (el caso de «Algo»)', async () => {
    const server = new FakeServer();
    const name = crypto.randomUUID();
    const a = await device(server, name);
    const id = await a.tree.create(null, 'Algo');
    await a.engine.syncNow();
    // Lo que dejó la versión anterior: el renombre largo ya rechazado, guardado en el dispositivo.
    const long = `${words(100)}\nfinal`;
    const failed: FailedOp = { op: { kind: 'update', id, patch: { title: long } }, opSeq: 999, error: REJECTED, failedAt: Date.now() };
    await a.db.add('failedOps', failed);
    await a.engine.stop();
    a.db.close();
    devices.splice(devices.indexOf(a), 1);

    const b = await device(server, name);
    expect(b.tree.failedOps()).toEqual([]);
    const queued = b.tree.pendingOps();
    expect(queued).toHaveLength(1);
    expect(queued[0].seq).toBe(999);
    const title = (queued[0].op as { patch: { title: string } }).patch.title;
    expect(codePointLength(title)).toBeLessThanOrEqual(500);
    expect(b.tree.get(id)?.title).toBe(title);
    await drain(b);
    await b.engine.syncNow();
    expect(server.pages.get(id)?.title).toBe(title);
    const status = b.engine.getStatus();
    expect(status.failedOps).toBe(0);
    expect(await blocks(b, id)).toEqual([long.slice(title.length).split('\n')[0].trim(), 'final']);
  });

  it('un cambio largo que una versión anterior dejó sin subir se corta al abrir', async () => {
    const server = new FakeServer();
    const name = crypto.randomUUID();
    const a = await device(server, name);
    const id = await a.tree.create(null, 'Algo');
    await a.engine.syncNow();
    const queued: QueuedOp = { opId: crypto.randomUUID(), op: { kind: 'update', id, patch: { title: 'q'.repeat(520) } }, createdAt: Date.now() };
    await a.db.add('ops', queued);
    const project: QueuedOp = { opId: crypto.randomUUID(), op: { kind: 'renameProject', id: server.workspaceId, name: 'P'.repeat(260) }, createdAt: Date.now() };
    await a.db.add('ops', project);
    await a.engine.stop();
    a.db.close();
    devices.splice(devices.indexOf(a), 1);

    const b = await device(server, name);
    await drain(b);
    await b.engine.syncNow();
    expect(server.pages.get(id)?.title).toBe('q'.repeat(500));
    expect(server.projects.get(server.workspaceId)?.name).toBe('P'.repeat(200));
    expect(b.engine.getStatus().failedOps).toBe(0);
    expect(await blocks(b, id)).toEqual(['q'.repeat(20)]);
  });

  it('si igual llega un rechazo por el largo, el cambio no pasa a rechazados: queda en la cola cortado', async () => {
    const server = new FakeServer();
    const d = await device(server);
    const id = await d.tree.create(null, 'Algo');
    await d.engine.syncNow();
    // Como otra pestaña con una versión anterior: el cambio entra a la base local sin pasar por el árbol.
    const op: QueuedOp = { opId: crypto.randomUUID(), op: { kind: 'update', id, patch: { title: 'w'.repeat(510) } }, createdAt: Date.now() };
    op.seq = await d.db.add('ops', op);
    await d.tree.failOp(op, REJECTED);
    expect(d.tree.failedOps()).toEqual([]);
    expect(d.tree.pendingOps().map((o) => o.seq)).toEqual([op.seq]);
    await drain(d);
    await d.engine.syncNow();
    expect(server.pages.get(id)?.title).toBe('w'.repeat(500));
    expect(await blocks(d, id)).toEqual(['w'.repeat(10)]);
  });
});

describe('otros topes del árbol', () => {
  it('el nombre de un proyecto se corta en 200 sin partir un emoji', async () => {
    const server = new FakeServer();
    const d = await device(server);
    const id = await d.tree.createProject(`${'n'.repeat(199)}🎬🎬`);
    expect(d.tree.project(id)?.name).toBe(`${'n'.repeat(199)}🎬`);
    await d.engine.syncNow();
    expect(server.projects.get(id)?.name).toBe(`${'n'.repeat(199)}🎬`);
  });

  it('cientos de páginas en el mismo hueco: las claves de orden se rehacen antes de pasar los 128 caracteres', async () => {
    const server = new FakeServer();
    const d = await device(server);
    const first = await d.tree.create(null, 'Primera');
    const last = await d.tree.create(null, 'Última');
    // Siempre justo antes de la última: la clave entre las dos vecinas crece con cada una.
    let maxKey = 0;
    for (let i = 0; i < 700; i++) {
      await d.tree.create(null, `p${i}`, undefined, { before: last });
      maxKey = Math.max(maxKey, ...d.tree.roots(server.workspaceId).map((p) => p.sort_key.length));
    }
    expect(maxKey).toBeLessThanOrEqual(DB_LIMITS.pageSortKey);
    const order = d.tree.roots(server.workspaceId).map((p) => p.title);
    expect(order[0]).toBe('Primera');
    expect(order.at(-1)).toBe('Última');
    expect(order.slice(1, 4)).toEqual(['p0', 'p1', 'p2']);
    expect(order).toHaveLength(702);
    expect(first).toBeTruthy();
    await d.engine.syncNow();
    expect(d.engine.getStatus().failedOps).toBe(0);
    expect(d.tree.pendingOps()).toEqual([]);
  }, 60_000);
});
