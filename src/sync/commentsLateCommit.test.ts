import { afterEach, describe, expect, it, vi } from 'vitest';
import { CURSOR_MARGIN_MS, PULL_EVERY_MS, type CommentThread, type MentionRef } from './comments';
import { LinkCommentRemote } from './linkRemote';
import { addPublicLink, makeLinkDevice, type LinkDevice } from './linkTesting';
import { FakeServer, makeDevice, type Device } from './testing';

// El cursor de la bajada de comentarios (Docs/Doc_Sincronizacion.md, "Comentarios y preguntas", "El cursor y los
// cambios que confirman tarde"). El cursor es el `updated_at` más alto que llegó, y en Postgres esa es la hora en que
// empezó la transacción: un cambio que empezó antes que el último recibido y confirmó después de la bajada queda
// detrás del cursor. La cola pide desde un margen antes hasta que el cursor queda asentado (y eso se guarda con él), y
// funde lo que vuelve a llegar por id.

const ANA = '00000000-0000-4000-8000-0000000000a1';
const BETO = '00000000-0000-4000-8000-0000000000a2';
const uuid = (n: number) => `c0000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

const devices: (Device | LinkDevice)[] = [];
async function device(server: FakeServer, user?: { id: string }, dbName?: string): Promise<Device> {
  const d = await makeDevice(server, dbName, undefined, undefined, undefined, user ?? {});
  devices.push(d);
  return d;
}

function close(d: Device): void {
  d.engine.stop();
  d.mentions.stop();
  d.db.close();
  d.mediaDb.close();
  d.commentsDb.close();
}

afterEach(() => {
  for (const d of devices.splice(0)) {
    // El visitante de un link no tiene campana ni expone sus otras bases.
    if ('mentions' in d) close(d);
    else {
      d.engine.stop();
      d.db.close();
    }
  }
  vi.restoreAllMocks();
});

/** Cierra la app y la vuelve a abrir sobre lo guardado en el dispositivo: otra cola, la misma base local. */
async function reopen(server: FakeServer, d: Device, dbName: string): Promise<Device> {
  devices.splice(devices.indexOf(d), 1);
  close(d);
  return device(server, undefined, dbName);
}

/**
 * El dueño (con su base local en `dbName`) y Ana, con dos páginas, Brief y Notes; el dueño tiene Brief abierta. La base
 * tiene `list_comments` (bajar solo lo cambiado).
 */
async function workspace(options: { editBase?: boolean; mentions?: boolean } = {}) {
  const server = new FakeServer();
  if (options.mentions) server.enableMentions();
  else server.enableComments();
  server.listCommentsEnabled = true;
  server.editBaseEnabled = options.editBase ?? false;
  const dbName = `tarde-${crypto.randomUUID()}`;
  const owner = await device(server, undefined, dbName);
  const brief = await owner.tree.create(null, 'Brief');
  const notes = await owner.tree.create(null, 'Notes');
  await owner.engine.syncNow();
  server.addMember(ANA, 'member', 'ana@test');
  server.addMember(BETO, 'member', 'beto@test');
  for (const pageId of [brief, notes]) server.grant(ANA, { pageId }, 'comment');
  server.grant(BETO, { pageId: brief }, 'comment');
  const ana = await device(server, { id: ANA });
  await ana.engine.syncNow();
  owner.comments.watch(brief);
  return { server, owner, ana, brief, notes, dbName };
}

/** Pasa el tiempo entre dos bajadas (o `ms`) y el dispositivo sincroniza. */
async function pull(server: FakeServer, d: Device | LinkDevice, ms = PULL_EVERY_MS + 1000): Promise<void> {
  server.clockOffset += ms;
  await d.engine.syncNow();
}

/** Ana comenta y su comentario confirma enseguida. */
async function anaSays(ana: Device, pageId: string, body: string): Promise<void> {
  await ana.comments.add(pageId, null, body);
  await ana.engine.syncNow();
}

/** Pasa el plazo con la página abierta: la bajada que asienta el cursor (con margen) y una más, ya desde el cursor. */
async function settle(server: FakeServer, d: Device | LinkDevice): Promise<void> {
  await pull(server, d, CURSOR_MARGIN_MS);
  await pull(server, d);
}

/** Comentarios como los de una importación: muchos, todos en unos segundos de la base. */
function importInto(server: FakeServer, pageId: string, count: number): void {
  for (let i = 0; i < count; i++) {
    const at = new Date(Date.UTC(2026, 8, 30, 13) + i * 100).toISOString();
    server.comments.set(uuid(1000 + i), {
      id: uuid(1000 + i), page_id: pageId, block_id: null, thread_id: null, body: `Importado ${i}`, author_id: server.ownerId,
      created_at: at, updated_at: at, edited_at: null, resolved_at: null, resolved_by: null, deleted_at: null, deleted_by: null,
    });
  }
}

const bodies = (threads: CommentThread[]) => threads.map((t) => t.root.body);
const lastList = (server: FakeServer) => server.commentLists[server.commentLists.length - 1];
/** La fecha de cambio más alta de la base (de una página, si se dice): donde queda el cursor de quien bajó todo. */
const cursorOf = (server: FakeServer, pageId?: string) =>
  [...server.comments.values()].filter((c) => !pageId || c.page_id === pageId).map((c) => c.updated_at ?? c.created_at).sort().pop()!;
const marginOf = (cursor: string) => new Date(Date.parse(cursor) - CURSOR_MARGIN_MS).toISOString();
const savedCursor = (d: Device, pageId: string) => d.commentsDb.get('meta', `since:${pageId}`);
const savedSettled = (d: Device, pageId: string) => d.commentsDb.get('meta', `settled:${pageId}`);

describe('un cambio que confirma después de la bajada', () => {
  it('empieza A, baja el dispositivo, confirma A: A llega en la bajada siguiente aunque su fecha sea anterior al cursor', async () => {
    const { server, owner, ana, brief } = await workspace();
    // La transacción de A toma su hora y tarda 5 segundos en confirmar.
    const confirmA = server.beginComment({ id: uuid(1), pageId: brief, body: 'A, de otra persona', authorId: ANA }, 5);
    // Mientras tanto Ana comenta B, que confirma enseguida con una hora posterior a la de A.
    await anaSays(ana, brief, 'B');
    // El dispositivo baja: ve B (A todavía no existe para nadie) y su cursor queda en la hora de B.
    await pull(server, owner);
    expect(bodies(owner.comments.threads(brief))).toEqual(['B']);
    const cursor = cursorOf(server);
    confirmA();
    expect(server.comments.get(uuid(1))!.updated_at! < cursor).toBe(true);

    await pull(server, owner);
    // A llegó: se pidió desde un margen antes del cursor.
    expect(bodies(owner.comments.threads(brief)).sort()).toEqual(['A, de otra persona', 'B']);
    expect(lastList(server).since).toBe(marginOf(cursor));
    // Y queda guardado en el dispositivo, no solo a la vista.
    expect((await owner.commentsDb.getAll('comments')).map((r) => r.id)).toContain(uuid(1));
  });

  it('con el margen las filas ya vistas vuelven a llegar: no se duplican, y lo propio pendiente o apartado no se pisa', async () => {
    const { server, owner, ana, brief } = await workspace({ editBase: true });
    const mine = await owner.comments.add(brief, null, 'Mío');
    const aside = await owner.comments.add(brief, null, 'Otro mío');
    await owner.engine.syncNow();
    await anaSays(ana, brief, 'De Ana');
    await pull(server, owner);
    expect(bodies(owner.comments.threads(brief))).toEqual(['Mío', 'Otro mío', 'De Ana']);

    // Una edición propia que la base no aplica (el texto cambió desde otro lado): queda apartada, a la vista.
    server.comments.get(aside)!.body = 'Editado desde otro dispositivo';
    server.comments.get(aside)!.updated_at = server.commentNow();
    await owner.comments.edit(brief, aside, 'Mi versión');
    await owner.engine.syncNow();
    expect(owner.comments.threads(brief)[1].root).toMatchObject({ body: 'Editado desde otro dispositivo', conflict: { text: 'Mi versión' } });
    // Y otra que todavía no pudo salir: sigue en la cola.
    server.failCommentOnce.add('edit');
    await owner.comments.edit(brief, mine, 'Mío, editado sin subir');
    await owner.engine.syncNow();
    expect(owner.comments.status().pending).toBe(1);

    // Una bajada con margen: llegan de nuevo los tres, que el dispositivo ya tenía.
    const before = server.commentLists.length;
    await owner.comments.refresh(brief);
    expect(server.commentLists).toHaveLength(before + 1);
    expect(lastList(server)).toMatchObject({ rows: 3 });
    expect(lastList(server).since! < cursorOf(server)).toBe(true);
    const threads = owner.comments.threads(brief);
    expect(threads).toHaveLength(3);
    expect(threads[0].root).toMatchObject({ id: mine, body: 'Mío, editado sin subir', pending: true });
    expect(threads[1].root).toMatchObject({ id: aside, body: 'Editado desde otro dispositivo', conflict: { text: 'Mi versión' } });
    expect(await owner.commentsDb.count('comments')).toBe(3);
    // La edición pendiente sale después, como siempre.
    await pull(server, owner);
    expect(server.comments.get(mine)!.body).toBe('Mío, editado sin subir');
    expect(owner.comments.status()).toMatchObject({ pending: 0, failed: 1 });
  });

  it('la campana de menciones no se mueve por las filas que vuelven a llegar', async () => {
    const { server, ana, brief } = await workspace({ mentions: true });
    const beto: MentionRef = { userId: BETO, label: 'beto' };
    const stopAna = ana.comments.watch(brief);
    await ana.comments.add(brief, null, '@beto mirá esto', null, [beto]);
    await ana.engine.syncNow();
    await ana.engine.syncNow();
    stopAna();
    const betoDevice = await device(server, { id: BETO });
    await betoDevice.engine.syncNow();
    betoDevice.comments.watch(brief);
    await pull(server, betoDevice);
    await betoDevice.mentions.poll();
    expect(betoDevice.mentions.getSnapshot()).toMatchObject({ unread: 1 });
    const items = betoDevice.mentions.getSnapshot().items.length;
    const calls = server.commentCalls.length;
    const lists = server.commentLists.length;
    // Cinco bajadas con margen que traen de nuevo la misma fila: no piden nada más que la lista.
    for (let i = 0; i < 5; i++) await pull(server, betoDevice);
    expect(server.commentLists.slice(lists).map((l) => l.rows)).toEqual([1, 1, 1, 1, 1]);
    expect(server.commentCalls.slice(calls).every((c) => c.startsWith('list '))).toBe(true);
    expect(betoDevice.mentions.getSnapshot()).toMatchObject({ unread: 1 });
    expect(betoDevice.mentions.getSnapshot().items).toHaveLength(items);
    expect(betoDevice.comments.threads(brief)[0].root.mentions).toEqual([beto]);
  });

  it('el visitante de un link usa la misma cola: un comentario del equipo que confirma tarde le llega, y su cursor también se asienta', async () => {
    const server = new FakeServer();
    server.enableTeam();
    server.enableClean(0.1);
    const owner = await makeDevice(server, undefined, '0.101');
    devices.push(owner);
    const page = await owner.tree.create(null, 'Compartida');
    await owner.engine.syncNow();
    server.enableComments();
    await owner.engine.syncNow();
    const visitor = await makeLinkDevice(server, addPublicLink(server, page));
    devices.push(visitor);
    await visitor.engine.syncNow();
    visitor.comments.watch(page);
    const asked = vi.spyOn(LinkCommentRemote.prototype, 'listComments');

    const confirmA = server.beginComment({ id: uuid(1), pageId: page, body: 'A, del equipo', authorId: server.ownerId }, 2);
    await owner.comments.add(page, null, 'B');
    await owner.engine.syncNow();
    await pull(server, visitor);
    expect(bodies(visitor.comments.threads(page))).toEqual(['B']);
    confirmA();
    await pull(server, visitor);
    expect(bodies(visitor.comments.threads(page)).sort()).toEqual(['A, del equipo', 'B']);
    const cursor = cursorOf(server);
    expect(asked.mock.calls[asked.mock.calls.length - 1][1]).toBe(marginOf(cursor));
    await settle(server, visitor);
    expect(asked.mock.calls[asked.mock.calls.length - 1][1]).toBe(cursor);
  });
});

describe('el margen dura hasta que el cursor queda asentado', () => {
  it('pasado el plazo sin que el cursor se mueva vuelve a pedir desde el cursor; si se mueve, el plazo empieza de nuevo en esa bajada', async () => {
    const { server, owner, ana, brief } = await workspace();
    // Como una importación: muchos comentarios en pocos segundos.
    for (let i = 0; i < 6; i++) await ana.comments.add(brief, null, `Importado ${i}`);
    await ana.engine.syncNow();
    await pull(server, owner);
    const cursor = cursorOf(server);
    expect(await savedSettled(owner, brief)).toBeUndefined();

    // Dentro del plazo, con margen: llegan otra vez los seis.
    await pull(server, owner);
    expect(lastList(server)).toEqual({ since: marginOf(cursor), rows: 6 });
    expect(await savedSettled(owner, brief)).toBeUndefined();
    // La primera bajada hecha después del plazo todavía va con margen: es la que asienta el cursor, y lo deja escrito.
    await pull(server, owner, CURSOR_MARGIN_MS);
    expect(lastList(server)).toEqual({ since: marginOf(cursor), rows: 6 });
    expect(await savedSettled(owner, brief)).toBe(cursor);
    // Desde ahí, desde el cursor: solo la última fila, como antes.
    await pull(server, owner);
    expect(lastList(server)).toEqual({ since: cursor, rows: 1 });
    await pull(server, owner);
    expect(lastList(server)).toEqual({ since: cursor, rows: 1 });

    // Mucho después, un cambio nuevo mueve el cursor: esa bajada todavía pide desde el cursor viejo, y borra la marca.
    server.clockOffset += 10 * 60_000;
    await anaSays(ana, brief, 'Uno más');
    await pull(server, owner);
    expect(lastList(server)).toEqual({ since: cursor, rows: 2 });
    const moved = cursorOf(server);
    expect(await savedSettled(owner, brief)).toBeUndefined();
    // El plazo corre desde ESA bajada (no desde la primera de la sesión, ni desde la siguiente): a los 11 segundos no
    // asienta, a los 60 sí, y la que sigue ya pide desde el cursor.
    await pull(server, owner);
    expect(lastList(server).since).toBe(marginOf(moved));
    expect(await savedSettled(owner, brief)).toBeUndefined();
    await pull(server, owner, CURSOR_MARGIN_MS - (PULL_EVERY_MS + 1000));
    expect(lastList(server).since).toBe(marginOf(moved));
    expect(await savedSettled(owner, brief)).toBe(moved);
    await pull(server, owner);
    expect(lastList(server).since).toBe(moved);
    expect(bodies(owner.comments.threads(brief))).toHaveLength(7);
  });

  it('asentado hace rato, el cursor se mueve con A a medio confirmar y enseguida hay otra bajada: esa no asienta, y A llega', async () => {
    const { server, owner, ana, brief } = await workspace();
    await anaSays(ana, brief, 'viejo');
    await pull(server, owner);
    await settle(server, owner);
    expect(lastList(server).since).toBe(cursorOf(server));
    // Mucho después: A empieza, B confirma, el dispositivo baja B (el cursor se mueve), y enseguida vuelve a bajar.
    server.clockOffset += 10 * 60_000;
    const confirmA = server.beginComment({ id: uuid(1), pageId: brief, body: 'A', authorId: ANA }, 3);
    await anaSays(ana, brief, 'B');
    await pull(server, owner);
    const cursor = cursorOf(server);
    await owner.comments.refresh(brief);
    expect(lastList(server).since).toBe(marginOf(cursor));
    confirmA();
    await pull(server, owner);
    expect(lastList(server).since).toBe(marginOf(cursor));
    expect(bodies(owner.comments.threads(brief)).sort()).toEqual(['A', 'B', 'viejo']);
  });

  it('la bajada que tenía que asentar falla: no asienta ni deja la marca; la siguiente que sale va con margen y trae lo que faltaba', async () => {
    const { server, owner, ana, brief } = await workspace();
    const confirmA = server.beginComment({ id: uuid(1), pageId: brief, body: 'A', authorId: ANA }, 5);
    await anaSays(ana, brief, 'B');
    await pull(server, owner);
    const cursor = cursorOf(server);
    const lists = server.commentLists.length;
    server.online = false;
    await pull(server, owner, CURSOR_MARGIN_MS);
    expect(server.commentLists).toHaveLength(lists);
    expect(await savedSettled(owner, brief)).toBeUndefined();
    server.online = true;
    confirmA();
    await pull(server, owner);
    expect(lastList(server).since).toBe(marginOf(cursor));
    expect(bodies(owner.comments.threads(brief)).sort()).toEqual(['A', 'B']);
  });

  it('cada página con su cursor: una asentada no asienta a la otra, y cerrar una y volver no la da por asentada', async () => {
    const { server, owner, ana, brief, notes } = await workspace();
    const stopNotes = owner.comments.watch(notes);
    await anaSays(ana, brief, 'en Brief');
    await pull(server, owner);
    const briefCursor = cursorOf(server, brief);
    await settle(server, owner);
    expect(await savedSettled(owner, brief)).toBe(briefCursor);
    // Ahora un comentario en Notes, con otro a medio confirmar: su cursor es nuevo, y Brief sigue asentada.
    const confirmLate = server.beginComment({ id: uuid(9), pageId: notes, body: 'tarde en Notes', authorId: ANA }, 3);
    await anaSays(ana, notes, 'en Notes');
    const before = server.commentLists.length;
    await pull(server, owner);
    const notesCursor = cursorOf(server, notes);
    confirmLate();
    await pull(server, owner);
    const asked = server.commentLists.slice(before).map((l) => l.since);
    // Brief, las dos veces desde su cursor. Notes, la primera sin cursor (todo) y después con margen.
    expect(asked.filter((s) => s === briefCursor)).toHaveLength(2);
    expect(asked).toContain(marginOf(notesCursor));
    expect(await savedSettled(owner, notes)).toBeUndefined();
    expect(bodies(owner.comments.threads(notes)).sort()).toEqual(['en Notes', 'tarde en Notes']);
    // Cerrar Notes un rato largo y volver: va con margen (no se había asentado) y recién ahí asienta.
    stopNotes();
    server.clockOffset += 10 * 60_000;
    owner.comments.watch(notes);
    await pull(server, owner);
    expect(server.commentLists.slice(-2).map((l) => l.since).sort()).toEqual([marginOf(notesCursor), briefCursor].sort());
    await pull(server, owner);
    expect(server.commentLists.slice(-2).map((l) => l.since).sort()).toEqual([notesCursor, briefCursor].sort());
    expect(await savedSettled(owner, notes)).toBe(notesCursor);
    expect(await savedSettled(owner, brief)).toBe(briefCursor);
  });

  it('otra versión de la app movió el cursor sin tocar la marca: la marca no vale, el plazo empieza de nuevo y A llega', async () => {
    const { server, owner, ana, brief } = await workspace();
    await anaSays(ana, brief, 'viejo');
    await pull(server, owner);
    await settle(server, owner);
    const old = cursorOf(server);
    expect(await savedSettled(owner, brief)).toBe(old);
    // Diez minutos después: A empieza, B confirma, y una versión anterior de la app (que no conoce la marca) baja B y
    // deja el cursor en la fecha de B.
    server.clockOffset += 10 * 60_000;
    const confirmA = server.beginComment({ id: uuid(1), pageId: brief, body: 'A', authorId: ANA }, 3);
    await anaSays(ana, brief, 'B');
    const cursor = cursorOf(server);
    await owner.commentsDb.put('meta', cursor, `since:${brief}`);
    expect(await savedSettled(owner, brief)).toBe(old);

    // Esta versión vuelve a bajar: la marca es de otro cursor, así que va con margen; y de este cursor no sabe desde
    // cuándo está, así que esta bajada no lo asienta aunque la sesión lleve mucho más que el plazo.
    await pull(server, owner);
    expect(lastList(server).since).toBe(marginOf(cursor));
    expect(await savedSettled(owner, brief)).toBe(old);
    confirmA();
    await pull(server, owner);
    expect(lastList(server).since).toBe(marginOf(cursor));
    expect(bodies(owner.comments.threads(brief)).sort()).toEqual(['A', 'B', 'viejo']);
    // Pasado su propio plazo, ahora sí.
    await settle(server, owner);
    expect(lastList(server).since).toBe(cursor);
    expect(await savedSettled(owner, brief)).toBe(cursor);
  });
});

describe('el cursor asentado se guarda con el cursor', () => {
  it('sobrevive a cerrar y abrir la app: la primera bajada de la sesión ya pide desde el cursor (una fila)', async () => {
    const { server, owner, ana, brief, dbName } = await workspace();
    for (let i = 0; i < 6; i++) await ana.comments.add(brief, null, `Importado ${i}`);
    await ana.engine.syncNow();
    await pull(server, owner);
    await settle(server, owner);
    const cursor = cursorOf(server);
    expect(await savedCursor(owner, brief)).toBe(cursor);
    expect(await savedSettled(owner, brief)).toBe(cursor);

    const again = await reopen(server, owner, dbName);
    const before = server.commentLists.length;
    again.comments.watch(brief);
    await again.engine.syncNow();
    await pull(server, again);
    await pull(server, again);
    expect(server.commentLists.slice(before)).toEqual([{ since: cursor, rows: 1 }, { since: cursor, rows: 1 }, { since: cursor, rows: 1 }]);
    expect(bodies(again.comments.threads(brief))).toHaveLength(6);
  });

  it('si se cerró antes de asentar, al abrir no se sabe cuándo quedó el cursor: va con margen y el plazo corre desde esa bajada', async () => {
    const { server, owner, ana, brief, dbName } = await workspace();
    await anaSays(ana, brief, 'Antes de cerrar');
    await pull(server, owner);
    const cursor = cursorOf(server);
    expect(await savedSettled(owner, brief)).toBeUndefined();

    // Vuelve una hora después: no alcanza con que haya pasado el tiempo, hace falta una bajada con margen después de
    // un plazo medido en esta sesión.
    server.clockOffset += 60 * 60_000;
    const again = await reopen(server, owner, dbName);
    again.comments.watch(brief);
    await again.engine.syncNow();
    expect(lastList(server).since).toBe(marginOf(cursor));
    expect(await savedSettled(again, brief)).toBeUndefined();
    await pull(server, again, CURSOR_MARGIN_MS);
    expect(lastList(server).since).toBe(marginOf(cursor));
    expect(await savedSettled(again, brief)).toBe(cursor);
    await pull(server, again);
    expect(lastList(server).since).toBe(cursor);
  });

  it('asentado y guardado, el cursor se mueve en otra sesión con A a medio confirmar: la marca se va, vuelve el margen y A llega', async () => {
    const { server, owner, ana, brief, dbName } = await workspace();
    await anaSays(ana, brief, 'antes');
    await pull(server, owner);
    await settle(server, owner);
    const old = cursorOf(server);
    const again = await reopen(server, owner, dbName);
    again.comments.watch(brief);
    await again.engine.syncNow();
    expect(lastList(server)).toEqual({ since: old, rows: 1 });

    const confirmA = server.beginComment({ id: uuid(1), pageId: brief, body: 'A', authorId: ANA }, 3);
    await anaSays(ana, brief, 'B');
    await pull(server, again);
    // Esa bajada todavía pidió desde el cursor asentado (trae B, que es posterior); el cursor se movió.
    expect(lastList(server)).toEqual({ since: old, rows: 2 });
    const cursor = cursorOf(server);
    expect(await savedCursor(again, brief)).toBe(cursor);
    expect(await savedSettled(again, brief)).toBeUndefined();
    confirmA();
    await pull(server, again);
    expect(lastList(server).since).toBe(marginOf(cursor));
    expect(bodies(again.comments.threads(brief)).sort()).toEqual(['A', 'B', 'antes']);
  });

  it('restaurar una copia de la base borra los cursores: baja todo, eso deja la marca sin efecto y el plazo arranca de nuevo', async () => {
    const { server, owner, ana, brief } = await workspace();
    await anaSays(ana, brief, 'antes');
    await pull(server, owner);
    await settle(server, owner);
    const cursor = cursorOf(server);
    expect(await savedSettled(owner, brief)).toBe(cursor);
    const restore = server.backup();
    restore();
    const before = server.commentLists.length;
    await pull(server, owner);
    // Sin cursor: todo. La copia tiene lo mismo, así que el cursor vuelve al mismo valor, y ya no está asentado.
    expect(server.commentLists.slice(before).map((l) => l.since)).toContain(null);
    expect(await savedCursor(owner, brief)).toBe(cursor);
    expect(await savedSettled(owner, brief)).toBeUndefined();
    await pull(server, owner);
    expect(lastList(server).since).toBe(marginOf(cursor));
  });

  it('una página con 200 comentarios importados: lo que baja la primera sesión y lo que baja la segunda', async () => {
    const { server, owner, brief, dbName } = await workspace();
    importInto(server, brief, 200);
    /** Dos minutos con la página abierta, una bajada cada 10 segundos: cuántas bajadas y cuántas filas. */
    const twoMinutes = async (d: Device) => {
      const from = server.commentLists.length;
      for (let t = 0; t < 120; t += 10) await pull(server, d, 10_000);
      const lists = server.commentLists.slice(from);
      return { pulls: lists.length, rows: lists.reduce((n, l) => n + l.rows, 0) };
    };
    // La primera vez: todo (200), seis bajadas más con margen (200 cada una; la última asienta) y cinco de una fila.
    expect(await twoMinutes(owner)).toEqual({ pulls: 12, rows: 200 + 6 * 200 + 5 });
    // Al abrir de nuevo, el cursor ya está asentado: una fila por bajada, como antes del margen.
    const again = await reopen(server, owner, dbName);
    again.comments.watch(brief);
    expect(await twoMinutes(again)).toEqual({ pulls: 12, rows: 12 });
    expect(bodies(again.comments.threads(brief))).toHaveLength(200);
  });
});
