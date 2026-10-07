import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { codePointLength, DB_LIMITS, splitAtLimit, splitTitle } from '../lib/dbLimits';
import { checkPageLengths, checkProjectName, jsonbTextLength } from './lengthChecks';
import { CONTENT_FRAGMENT } from './structure';
import { FakeServer, makeDevice, type Device } from './testing';
import { onlyTitleRests, prependRest, restParagraphs, TITLE_REST_PREFIX, watchTitleRests } from './titleRest';
import { keyBetween, rekeyWindow, sameInstant } from './tree';
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

/** Cómo quedó guardado el rechazo: el de esta versión, o el de v0.152 (sin cómo estaba la fila). */
type Format = 'nuevo' | 'v0.152';
const FORMATS: Format[] = ['nuevo', 'v0.152'];

/**
 * El servidor rechaza un renombre largo de `id`. `nuevo`: por `failOp`, que guarda cómo estaba la fila (reloj del
 * servidor). `v0.152`: el registro tal cual lo dejó esa versión en la IndexedDB (se lee al abrir la próxima vez).
 */
async function rejectLong(d: Device, id: string, title: string, format: Format, error = REJECTED): Promise<void> {
  if (format === 'nuevo') {
    const op: QueuedOp = { opId: crypto.randomUUID(), op: { kind: 'update', id, patch: { title } }, createdAt: Date.now() };
    op.seq = await d.db.add('ops', op);
    await d.tree.failOp(op, error);
  } else {
    await d.db.add('failedOps', { op: { kind: 'update', id, patch: { title } }, opSeq: 1, error, failedAt: Date.now() } as FailedOp);
  }
}

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
    expect((group.get(0) as Y.XmlElement).getAttribute('id')).toBe(`${TITLE_REST_PREFIX}r1`);
    // Una página con solo eso (y renglones vacíos) cuenta como vacía para escribirle su contenido.
    expect(onlyTitleRests(doc)).toBe(true);
    expect(onlyTitleRests(new Y.Doc())).toBe(false);
    const other = new Y.Doc();
    prependRest(other, { id: 'x', text: 'algo' });
    prependRest(other, { id: 'y', text: 'más' });
    expect(onlyTitleRests(other)).toBe(true);
    ((other.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement).get(0) as Y.XmlElement).setAttribute('id', 'escrito');
    expect(onlyTitleRests(other)).toBe(false);
  });

  it('lo anotado no se olvida mientras la página no quedó guardada en el dispositivo', async () => {
    const server = new FakeServer();
    const d = await device(server);
    const id = await d.tree.create(null, 'Algo');
    let saved = false;
    // Como IndexedDB fallando: lo escrito queda en memoria y `isSaved` dice que no.
    const docs = { ...d.docs, edit: d.docs.edit.bind(d.docs), applyLocal: d.docs.applyLocal.bind(d.docs), flush: d.docs.flush.bind(d.docs), isSaved: () => saved };
    stops.push(watchTitleRests(d.tree, docs));
    await d.tree.rename(id, 'v'.repeat(530));
    await new Promise((r) => setTimeout(r, 100));
    expect(d.tree.titleRests()).toHaveLength(1);
    saved = true;
    d.tree.onTitleRest?.();
    for (let i = 0; i < 100 && d.tree.titleRests().length > 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(d.tree.titleRests()).toEqual([]);
    // Y no se escribió dos veces.
    expect(await blocks(d, id)).toEqual(['v'.repeat(30)]);
  });
});

describe('la cola: lo que ya rechazó el servidor por el largo', () => {
  it('un cambio de título rechazado por pages_title_check vuelve a la cola cortado y sube (el caso de «Algo»)', async () => {
    const server = new FakeServer();
    const name = crypto.randomUUID();
    const a = await device(server, name);
    const id = await a.tree.create(null, 'Algo');
    await a.engine.syncNow();
    // El rechazo guarda cómo estaba la fila (reloj del servidor) y sobrevive a cerrar la app.
    const long = `${words(100)}\nfinal`;
    const op: QueuedOp = { opId: crypto.randomUUID(), op: { kind: 'update', id, patch: { title: long } }, createdAt: Date.now() };
    op.seq = await a.db.add('ops', op);
    await a.tree.failOp(op, REJECTED);
    expect(a.tree.failedOps()[0].rowUpdatedAt).toBe(server.pages.get(id)!.updated_at);
    await a.engine.stop();
    a.db.close();
    devices.splice(devices.indexOf(a), 1);

    const b = await device(server, name);
    // Se arregla con el árbol del servidor a la vista (la primera sincronización): ahí se sabe si el título cambió.
    expect(b.tree.failedOps()).toHaveLength(1);
    expect(b.tree.failedOps()[0].rowUpdatedAt).toBe(server.pages.get(id)!.updated_at);
    await b.engine.syncNow();
    expect(b.tree.failedOps()).toEqual([]);
    const queued = b.tree.pendingOps();
    expect(queued).toHaveLength(1);
    expect(queued[0].seq).toBe(op.seq);
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

  it('un rechazo que guardó una versión anterior (sin cómo estaba la fila): el título queda y el texto va entero a la página', async () => {
    const server = new FakeServer();
    const name = crypto.randomUUID();
    const a = await device(server, name);
    const id = await a.tree.create(null, 'Algo');
    await a.engine.syncNow();
    // Tal cual lo deja v0.152 en la IndexedDB: `{ op, opSeq, error, failedAt }` y la clave.
    const long = `${words(100)}\nfinal`;
    await a.db.add('failedOps', { op: { kind: 'update', id, patch: { title: long } }, opSeq: 7, error: REJECTED, failedAt: Date.now() } as FailedOp);
    await a.engine.stop();
    a.db.close();
    devices.splice(devices.indexOf(a), 1);

    const b = await device(server, name);
    expect(b.tree.failedOps()).toHaveLength(1);
    expect(b.tree.failedOps()[0].rowUpdatedAt).toBeUndefined();
    await b.engine.syncNow();
    expect(b.tree.failedOps()).toEqual([]);
    expect(b.tree.pendingOps()).toEqual([]);
    await drain(b);
    await b.engine.syncNow();
    // Sin un dato del reloj del servidor no se sabe si «Algo» es más nuevo que el rechazo: no se pisa.
    expect(server.pages.get(id)?.title).toBe('Algo');
    expect(b.engine.getStatus().failedOps).toBe(0);
    expect(await blocks(b, id)).toEqual([words(100), 'final']);
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

  it('si igual llega un rechazo por el largo, se arregla con el árbol que baja en la misma vuelta', async () => {
    const server = new FakeServer();
    const d = await device(server);
    const id = await d.tree.create(null, 'Algo');
    await d.engine.syncNow();
    // Como otra pestaña con una versión anterior: el cambio entra a la base local sin pasar por el árbol.
    const op: QueuedOp = { opId: crypto.randomUUID(), op: { kind: 'update', id, patch: { title: 'w'.repeat(510) } }, createdAt: Date.now() };
    op.seq = await d.db.add('ops', op);
    await d.tree.failOp(op, REJECTED);
    expect(d.tree.failedOps()).toHaveLength(1);
    await d.engine.syncNow();
    expect(d.tree.failedOps()).toEqual([]);
    await drain(d);
    await d.engine.syncNow();
    expect(server.pages.get(id)?.title).toBe('w'.repeat(500));
    expect(await blocks(d, id)).toEqual(['w'.repeat(10)]);
  });

  /**
   * «Algo» en el servidor y su renombre largo rechazado. `nuevo`: el rechazo de esta versión (`failOp`, guarda cómo
   * estaba la fila). `v0.152`: lo que dejó una versión anterior en la IndexedDB, sin ese dato.
   */
  async function rejectedLongRename(server: FakeServer, name: string, { error = REJECTED, format = 'nuevo' as Format } = {}) {
    const a = await device(server, name);
    const id = await a.tree.create(null, 'Algo');
    await a.engine.syncNow();
    const long = words(100);
    await rejectLong(a, id, long, format, error);
    // Lo que pase después del rechazo tiene un `updated_at` posterior en el servidor.
    await new Promise((r) => setTimeout(r, 5));
    return { a, id, long };
  }

  for (const format of FORMATS) {
    it(`si después del rechazo la persona renombró la página, su título queda y el texto largo va entero a la página (${format})`, async () => {
      const server = new FakeServer();
      const name = crypto.randomUUID();
      const { a, id, long } = await rejectedLongRename(server, name, { format });
      // Al ver el rechazo, lo arregló a mano y subió.
      await a.tree.rename(id, 'Lo arreglé a mano');
      await a.engine.syncNow();
      await a.engine.stop();
      a.db.close();
      devices.splice(devices.indexOf(a), 1);

      const b = await device(server, name);
      await b.engine.syncNow();
      await drain(b);
      await b.engine.syncNow();
      expect(server.pages.get(id)?.title).toBe('Lo arreglé a mano');
      expect(b.tree.failedOps()).toEqual([]);
      expect(b.tree.pendingOps()).toEqual([]);
      expect(await blocks(b, id)).toEqual([long]);
    });

    it(`si después del rechazo otro dispositivo renombró la página, tampoco se pisa (${format})`, async () => {
      const server = new FakeServer();
      const name = crypto.randomUUID();
      const { a, id, long } = await rejectedLongRename(server, name, { format });
      await a.engine.stop();
      a.db.close();
      devices.splice(devices.indexOf(a), 1);
      const other = await device(server);
      await other.engine.syncNow();
      await other.tree.rename(id, 'Título del otro');
      await other.engine.syncNow();

      const b = await device(server, name);
      await b.engine.syncNow();
      await drain(b);
      await b.engine.syncNow();
      expect(server.pages.get(id)?.title).toBe('Título del otro');
      expect(await blocks(b, id)).toEqual([long]);
      await other.engine.syncNow();
      expect(await blocks(other, id)).toEqual([long]);
    });

    it(`un renombre posterior en la cola de este dispositivo también gana (${format})`, async () => {
      const server = new FakeServer();
      const name = crypto.randomUUID();
      const { a, id, long } = await rejectedLongRename(server, name, { format });
      server.online = false;
      await a.tree.rename(id, 'Corto, sin red');
      await a.engine.stop();
      a.db.close();
      devices.splice(devices.indexOf(a), 1);
      server.online = true;

      const b = await device(server, name);
      await b.engine.syncNow();
      await drain(b);
      await b.engine.syncNow();
      expect(server.pages.get(id)?.title).toBe('Corto, sin red');
      expect(await blocks(b, id)).toEqual([long]);
    });
  }

  it('con la app desactualizada (la cola no sube), el renombre que espera en la cola no lo pisa la reparación', async () => {
    const server = new FakeServer();
    const name = crypto.randomUUID();
    const { a, id, long } = await rejectedLongRename(server, name);
    await a.engine.stop();
    a.db.close();
    devices.splice(devices.indexOf(a), 1);
    // `min_app_version` más nueva: el árbol baja (y se repara) pero la cola no sale; la fila del servidor no cambió.
    server.settings = { ...server.settings!, minAppVersion: 999 };
    const b = await device(server, name);
    await b.tree.rename(id, 'Corto, en la cola');
    await b.engine.syncNow();
    expect(b.engine.getStatus().outdated).toBe(true);
    expect(b.tree.failedOps()).toEqual([]);
    expect(b.tree.pendingOps().map((o) => o.op)).toEqual([{ kind: 'update', id, patch: { title: 'Corto, en la cola' } }]);
    await drain(b);
    expect(await blocks(b, id)).toEqual([long]);
    server.settings = { ...server.settings!, minAppVersion: null };
    await b.engine.syncNow();
    expect(server.pages.get(id)?.title).toBe('Corto, en la cola');
    expect(b.engine.getStatus().failedOps).toBe(0);
  });

  it('dos rechazos largos de la misma página: el más nuevo vuelve cortado y el otro va entero a la página', async () => {
    const server = new FakeServer();
    const d = await device(server);
    const id = await d.tree.create(null, 'Algo');
    await d.engine.syncNow();
    const first = `primero ${'x'.repeat(520)}`;
    const second = words(100);
    await rejectLong(d, id, first, 'nuevo');
    await rejectLong(d, id, second, 'nuevo');
    await d.engine.syncNow();
    await drain(d);
    await d.engine.syncNow();
    const title = server.pages.get(id)!.title;
    expect(second.startsWith(title)).toBe(true);
    expect(codePointLength(title)).toBeLessThanOrEqual(500);
    expect((await blocks(d, id)).sort()).toEqual([first, second.slice(title.length).trim()].sort());
    expect(d.engine.getStatus().failedOps).toBe(0);
  });

  it('un rechazo por otra causa (permisos) no se toca, aunque el título sea largo', async () => {
    const server = new FakeServer();
    const name = crypto.randomUUID();
    const RLS = 'new row violates row-level security policy for table "pages"';
    for (const format of FORMATS) {
      const { a, id } = await rejectedLongRename(server, `${name}-${format}`, { error: RLS, format });
      await a.engine.stop();
      a.db.close();
      devices.splice(devices.indexOf(a), 1);
      const b = await device(server, `${name}-${format}`);
      await b.engine.syncNow();
      expect(b.tree.failedOps().map((f) => f.error)).toEqual([RLS]);
      expect(b.tree.pendingOps()).toEqual([]);
      expect(b.tree.titleRests()).toEqual([]);
      expect(server.pages.get(id)?.title).toBe('Algo');
    }
  });

  it('Retry no lo vuelve a mandar largo, y «Hide» no descarta un rechazo por el largo', async () => {
    const server = new FakeServer();
    const name = crypto.randomUUID();
    const { a, id } = await rejectedLongRename(server, name);
    await a.engine.stop();
    a.db.close();
    devices.splice(devices.indexOf(a), 1);
    server.online = false;
    const b = await device(server, name);
    await b.tree.dismissFailed();
    expect(b.tree.failedOps()).toHaveLength(1);
    await b.tree.retryFailed();
    expect(b.tree.failedOps()).toHaveLength(1);
    expect(b.tree.pendingOps()).toEqual([]);
    server.online = true;
    await b.engine.syncNow();
    await drain(b);
    await b.engine.syncNow();
    expect(codePointLength(server.pages.get(id)!.title)).toBeLessThanOrEqual(500);
    expect(server.pages.get(id)!.title).not.toBe('Algo');
    expect(b.tree.failedOps()).toEqual([]);
  });
});

describe('el reloj del dispositivo no decide si el título cambió', () => {
  const HOUR = 3_600_000;
  it('compara dos updated_at del servidor por el momento, no por el texto; sin el dato, no son el mismo', () => {
    expect(sameInstant('2026-10-03T12:00:00.123456+00:00', '2026-10-03T12:00:00.123456+00:00')).toBe(true);
    expect(sameInstant('2026-10-03T12:00:00.123+00:00', '2026-10-03T12:00:00.123Z')).toBe(true);
    expect(sameInstant('2026-10-03T12:00:00.123+00:00', '2026-10-03T12:00:00.124Z')).toBe(false);
    expect(sameInstant(undefined, '2026-10-03T12:00:00Z')).toBe(false);
    expect(sameInstant(null, '2026-10-03T12:00:00Z')).toBe(false);
    expect(sameInstant('cualquier cosa', 'otra')).toBe(false);
  });

  // `skew`: cuánto va adelantado el reloj del dispositivo contra el de la base (negativo: atrasado).
  for (const skew of [3 * HOUR, 30 * HOUR, -3 * HOUR]) {
    for (const format of FORMATS) {
      for (const renamed of [true, false]) {
        const clock = `reloj ${skew > 0 ? 'adelantado' : 'atrasado'} ${Math.abs(skew) / HOUR} h`;
        it(`${clock}, rechazo ${format}, ${renamed ? 'renombrada después' : 'sin cambios después'}`, async () => {
          const server = new FakeServer();
          server.treeClock = () => Date.now() - skew;
          const name = crypto.randomUUID();
          const a = await device(server, name);
          const id = await a.tree.create(null, 'Algo');
          await a.engine.syncNow();
          const long = words(100);
          await rejectLong(a, id, long, format);
          await a.engine.stop();
          a.db.close();
          devices.splice(devices.indexOf(a), 1);
          if (renamed) {
            // Unos segundos después del rechazo, desde otro dispositivo: con el reloj adelantado, «antes» del rechazo.
            const other = await device(server);
            await other.engine.syncNow();
            await other.tree.rename(id, 'Título nuevo');
            await other.engine.syncNow();
          }

          const b = await device(server, name);
          await b.engine.syncNow();
          await drain(b);
          await b.engine.syncNow();
          expect(b.engine.getStatus().failedOps).toBe(0);
          expect(b.tree.pendingOps()).toEqual([]);
          const title = server.pages.get(id)!.title;
          if (renamed) {
            expect(title).toBe('Título nuevo');
            expect(await blocks(b, id)).toEqual([long]);
          } else if (format === 'nuevo') {
            expect(long.startsWith(title) && codePointLength(title) <= 500 && title !== 'Algo').toBe(true);
            expect(await blocks(b, id)).toEqual([long.slice(title.length).trim()]);
          } else {
            expect(title).toBe('Algo');
            expect(await blocks(b, id)).toEqual([long]);
          }
        });
      }
    }
  }
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
  });

  it('al rehacer las claves se tocan solo las páginas amontonadas en el hueco, no las demás hermanas', async () => {
    const server = new FakeServer();
    const d = await device(server);
    const spread: string[] = [];
    for (let i = 0; i < 200; i++) spread.push(await d.tree.create(null, `h${i}`));
    const keysBefore = new Map(spread.map((id) => [id, d.tree.get(id)!.sort_key]));
    const wall = spread[100];
    const piled = new Set<string>();
    for (let i = 0; i < 650; i++) piled.add(await d.tree.create(null, `n${i}`, undefined, { before: wall }));
    const rekeyed = d.tree
      .pendingOps()
      .flatMap((o) => (o.op.kind === 'update' && Object.keys(o.op.patch).join() === 'sort_key' ? [o.op.id] : []));
    // Hubo que rehacer claves, pero solo de las amontonadas, y no de todas: las otras 200 conservan la suya.
    expect(rekeyed.length).toBeGreaterThan(0);
    expect(rekeyed.every((id) => piled.has(id))).toBe(true);
    expect(new Set(rekeyed).size).toBeLessThan(piled.size);
    // Y las claves que escribió el rehecho quedan en la mitad del tope, no en el borde.
    const written = d.tree
      .pendingOps()
      .flatMap((o) => (o.op.kind === 'update' && o.op.patch.sort_key !== undefined ? [o.op.patch.sort_key] : []));
    expect(written.length).toBeGreaterThan(0);
    expect(Math.max(...written.map((k) => k.length))).toBeLessThanOrEqual(DB_LIMITS.pageSortKey / 2);
    for (const id of spread) expect(d.tree.get(id)!.sort_key).toBe(keysBefore.get(id));
    const order = d.tree.roots(server.workspaceId).map((p) => p.title);
    expect(order.slice(0, 100)).toEqual(Array.from({ length: 100 }, (_, i) => `h${i}`));
    expect(order.slice(100, 750)).toEqual(Array.from({ length: 650 }, (_, i) => `n${i}`));
    expect(order.slice(750)).toEqual(Array.from({ length: 100 }, (_, i) => `h${i + 100}`));
    expect(Math.max(...d.tree.roots(server.workspaceId).map((p) => p.sort_key.length))).toBeLessThanOrEqual(DB_LIMITS.pageSortKey);
    await d.engine.syncNow();
    expect(d.engine.getStatus().failedOps).toBe(0);
    expect(d.tree.pendingOps()).toEqual([]);
  });

  it('la ventana de claves nuevas: vecinas que quedan afuera intactas, orden estricto, y con claves repetidas igual sale', () => {
    const keys = (list: string[]) => list.map((sort_key) => ({ sort_key }));
    // Sin vecinas o con vecinas cortas, alcanza con la clave del hueco.
    expect(rekeyWindow([], 0)).toEqual({ from: 0, keys: [expect.any(String)] });
    // Una vecina larga a la izquierda: la ventana crece hacia ese lado, no hacia la derecha.
    const long = `a0${'V'.repeat(120)}`;
    const left = keys(['a0', `a0${'V'.repeat(100)}`, long, 'a1', 'a2']);
    const w = rekeyWindow(left, 3);
    expect(w.from + w.keys.length - 1).toBe(3);
    expect(w.keys.every((k) => k.length <= DB_LIMITS.pageSortKey / 2)).toBe(true);
    const lower = left[w.from - 1]?.sort_key ?? '';
    expect([lower, ...w.keys, 'a1'].every((k, i, all) => i === 0 || all[i - 1] < k)).toBe(true);
    // Dos vecinas con la misma clave: no se cuelga ni tira, y el resultado sigue ordenado.
    const twins = keys(['a0', 'a1', 'a1', 'a2']);
    const t = rekeyWindow(twins, 2);
    expect(t.keys.every((k, i, all) => i === 0 || all[i - 1] < k)).toBe(true);
  });

  it('el objetivo de la ventana es la mitad del tope: las claves nuevas no pasan de 64, ni se rehace de más', () => {
    // Muchas páginas puestas siempre en el mismo hueco, antes de la última: la clave entre las dos vecinas crece.
    const grow = (until: number): { sort_key: string }[] => {
      const keys = ['a0', 'a1'];
      while (keys[keys.length - 2].length < until) keys.splice(keys.length - 1, 0, keyBetween(keys[keys.length - 2], 'a1'));
      return keys.map((sort_key) => ({ sort_key }));
    };
    const roomy = DB_LIMITS.pageSortKey / 2;
    // Con la clave del hueco entre 65 y 128 (entra en la base, pero pasa la mitad): la ventana crece hasta que las
    // claves nuevas quedan en 64 o menos. Con un objetivo de 128 devolvería de una vez la clave larga.
    const piled = grow(100);
    const at = piled.length - 1;
    const direct = keyBetween(piled[at - 1].sort_key, piled[at].sort_key).length;
    expect(direct).toBeGreaterThan(roomy);
    expect(direct).toBeLessThanOrEqual(DB_LIMITS.pageSortKey);
    const w = rekeyWindow(piled, at);
    expect(w.from).toBeLessThan(at);
    expect(Math.max(...w.keys.map((k) => k.length))).toBeLessThanOrEqual(roomy);
    // Lo que queda afuera de la ventana no se toca y el orden es estricto.
    const chain = [piled[w.from - 1]?.sort_key ?? '', ...w.keys, piled[w.from + w.keys.length - 1]?.sort_key ?? '~'];
    expect(chain.every((k, i) => i === 0 || chain[i - 1] < k)).toBe(true);
    // Con la clave del hueco por debajo de 64 no hay nada que rehacer de más: la ventana es solo el hueco.
    const shallow = grow(roomy - 12);
    const s = rekeyWindow(shallow, shallow.length - 1);
    expect(s.from).toBe(shallow.length - 1);
    expect(s.keys).toHaveLength(1);
    // Cada profundidad de 40 a 120 caracteres, una por una (incluido el borde: 64 sí se queda, 65 no): la ventana es solo el
    // hueco si la clave directa mide 64 o menos; si mide más, crece y las claves nuevas quedan en 64 o menos.
    const lengths = new Set<number>();
    for (let until = 40; until <= 120; until++) {
      const list = grow(until);
      const hole = list.length - 1;
      const directLength = keyBetween(list[hole - 1].sort_key, list[hole].sort_key).length;
      lengths.add(directLength);
      const win = rekeyWindow(list, hole);
      if (directLength <= roomy) expect(win.from, `directa de ${directLength}`).toBe(hole);
      else {
        expect(win.from, `directa de ${directLength}`).toBeLessThan(hole);
        expect(Math.max(...win.keys.map((k) => k.length)), `directa de ${directLength}`).toBeLessThanOrEqual(roomy);
      }
    }
    // El barrido tiene que pasar justo por los dos lados del borde.
    expect(lengths.has(roomy)).toBe(true);
    expect(lengths.has(roomy + 1)).toBe(true);
  });
});
