import { createClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it } from 'vitest';
import { CommentInvalid, CommentQueue, exportComments, openCommentsDb, unsyncedComments, type CommentThread, type MentionRef } from './comments';
import { SupabaseCommentRemote } from './commentsRemote';
import * as Comments098 from './fixtures/v098/comments';
import { FakeRemote, FakeServer, makeDevice, type Device } from './testing';
import { RemoteError } from './types';

// Dos ediciones del mismo comentario desde dos dispositivos de la misma persona (Docs/Doc_Sincronizacion.md,
// "Dos ediciones del mismo comentario"). La base guardaba la última que llegaba, aunque se hubiera escrito antes: un
// teléfono que estuvo sin red pisaba en silencio lo que se editó después en la computadora. Con
// `edit_comment(p_id, p_body, p_base)` (20261115120000_comentario_edicion_base.sql) la edición lleva el texto del que
// partió; si la base ya tiene otro, no pisa, y la app deja lo propio apartado, a la vista, hasta que la persona decida.
// El servidor en memoria sigue las reglas de la migración (las de permisos están en
// supabase/tests/comentario_edicion_base_permisos.sql).

const ANA = '00000000-0000-4000-8000-0000000000a1';
const BETO = '00000000-0000-4000-8000-0000000000a2';
const CARO = '00000000-0000-4000-8000-0000000000a3';
const beto: MentionRef = { userId: BETO, label: 'beto' };
const caro: MentionRef = { userId: CARO, label: 'caro' };
const BLOCK = 'b1d2c3e4-0000-4000-8000-000000000001';

const devices: Device[] = [];
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
  for (const d of devices.splice(0)) close(d);
});

/**
 * La misma persona con dos dispositivos, el teléfono y la computadora, mirando Brief, con un comentario suyo ya subido
 * y bajado en los dos. `migrated`: la base tiene la firma con `p_base`.
 */
async function twoDevices(options: { migrated?: boolean; mentions?: boolean } = {}) {
  const server = new FakeServer();
  if (options.mentions) {
    server.enableMentions();
    server.addMember(ANA, 'member', 'ana@wanka.tv');
    server.addMember(BETO, 'member', 'beto@wanka.tv');
    server.addMember(CARO, 'member', 'caro@wanka.tv');
  } else {
    server.enableComments();
  }
  server.editBaseEnabled = options.migrated ?? true;
  const owner = options.mentions ? await device(server) : null;
  const who = options.mentions ? { id: ANA } : undefined;
  const first = owner ?? (await device(server));
  const brief = await first.tree.create(null, 'Brief');
  await first.engine.syncNow();
  if (options.mentions) {
    server.grant(ANA, { pageId: brief }, 'comment');
    server.grant(BETO, { pageId: brief }, 'comment');
    server.grant(CARO, { pageId: brief }, 'comment');
  }
  const phone = options.mentions ? await device(server, who) : first;
  const desk = await device(server, who);
  await phone.engine.syncNow();
  await desk.engine.syncNow();
  phone.comments.watch(brief);
  desk.comments.watch(brief);
  const id = await phone.comments.add(brief, BLOCK, 'Original');
  await phone.engine.syncNow();
  await pull(server, desk);
  expect(body(desk, brief)).toBe('Original');
  return { server, phone, desk, brief, id };
}

/** Pasan los 10 segundos entre bajadas y el dispositivo sincroniza. */
async function pull(server: FakeServer, d: Device): Promise<void> {
  server.clockOffset += 11_000;
  await d.engine.syncNow();
}

function root(d: Device, pageId: string): CommentThread['root'] {
  return d.comments.threads(pageId)[0].root;
}

function body(d: Device, pageId: string): string {
  return root(d, pageId).body;
}

/** Las ediciones que llegaron a la base, con su base (`undefined`: la firma de dos argumentos). */
function edits(server: FakeServer): [string, string | undefined][] {
  return server.commentEdits.map((e) => [e.body, e.base]);
}

describe('el problema: una edición vieja que sube tarde', () => {
  it('con la base sin migrar se sigue guardando lo último que llega (como la app publicada): lo de la computadora se pierde', async () => {
    const { server, phone, desk, brief, id } = await twoDevices({ migrated: false });
    // El teléfono edita sin red (todavía no sincroniza); después la computadora edita y sube.
    await phone.comments.edit(brief, id, 'Del teléfono, a las 10');
    await desk.comments.edit(brief, id, 'De la computadora, a las 11');
    await desk.engine.syncNow();
    expect(server.comments.get(id)?.body).toBe('De la computadora, a las 11');
    // El teléfono recupera la red: su edición, escrita antes, pisa la posterior. Nadie se entera.
    await phone.engine.syncNow();
    expect(server.comments.get(id)?.body).toBe('Del teléfono, a las 10');
    expect(phone.comments.status()).toMatchObject({ pending: 0, failed: 0 });
    await pull(server, desk);
    expect(body(desk, brief)).toBe('Del teléfono, a las 10');
    expect(desk.comments.status()).toMatchObject({ pending: 0, failed: 0 });
    // Se mandaron con la firma de dos argumentos: sin base.
    expect(edits(server)).toEqual([['De la computadora, a las 11', undefined], ['Del teléfono, a las 10', undefined]]);
  });

  it('con la base migrada no pisa: queda lo de la computadora, y lo del teléfono apartado en el teléfono, a la vista', async () => {
    const { server, phone, desk, brief, id } = await twoDevices();
    await phone.comments.edit(brief, id, 'Del teléfono, a las 10');
    await desk.comments.edit(brief, id, 'De la computadora, a las 11');
    await desk.engine.syncNow();
    await phone.engine.syncNow();

    // La base conserva la edición posterior.
    expect(server.comments.get(id)?.body).toBe('De la computadora, a las 11');
    expect(edits(server)).toEqual([['De la computadora, a las 11', 'Original'], ['Del teléfono, a las 10', 'Original']]);
    // El teléfono ve lo guardado y, al lado, lo que escribió ahí. No está en la cola: cuenta con lo rechazado.
    expect(root(phone, brief)).toMatchObject({ body: 'De la computadora, a las 11', conflict: { text: 'Del teléfono, a las 10' }, error: null });
    expect(phone.comments.status()).toMatchObject({ pending: 0, failed: 1, error: null });
    expect(phone.engine.getStatus()).toMatchObject({ pendingComments: 0, failedComments: 1 });
    expect(phone.comments.failures()).toMatchObject([{ kind: 'edit', pageId: brief, body: 'Del teléfono, a las 10', conflictOf: id }]);
    expect(phone.comments.pendingPageIds()).toEqual([brief]);
    expect(await unsyncedComments(phone.commentsDb)).toBe(1);
    expect(await exportComments(phone.commentsDb)).toMatchObject([{ kind: 'edit', id, pageId: brief, body: 'Del teléfono, a las 10' }]);
    // La computadora no se entera de nada: su texto es el que quedó.
    await pull(server, desk);
    expect(root(desk, brief)).toMatchObject({ body: 'De la computadora, a las 11' });
    expect(root(desk, brief).conflict ?? null).toBeNull();
    expect(desk.comments.status()).toMatchObject({ pending: 0, failed: 0 });
  });

  it('si la vieja llega primero, la que pierde el turno es la otra: tampoco pisa, y queda apartada en su dispositivo', async () => {
    const { server, phone, desk, brief, id } = await twoDevices();
    await phone.comments.edit(brief, id, 'Del teléfono, a las 10');
    await desk.comments.edit(brief, id, 'De la computadora, a las 11');
    await phone.engine.syncNow();
    await desk.engine.syncNow();
    expect(server.comments.get(id)?.body).toBe('Del teléfono, a las 10');
    expect(root(desk, brief)).toMatchObject({ body: 'Del teléfono, a las 10', conflict: { text: 'De la computadora, a las 11' } });
    expect(root(phone, brief).conflict ?? null).toBeNull();
  });
});

describe('las dos salidas', () => {
  async function conflicted() {
    const w = await twoDevices();
    await w.phone.comments.edit(w.brief, w.id, 'Del teléfono');
    await w.desk.comments.edit(w.brief, w.id, 'De la computadora');
    await w.desk.engine.syncNow();
    await w.phone.engine.syncNow();
    expect(root(w.phone, w.brief).conflict).toEqual({ text: 'Del teléfono' });
    return w;
  }

  it('quedarse con la propia la manda sobre lo guardado, con la base de ahora, y la otra computadora la baja', async () => {
    const { server, phone, desk, brief, id } = await conflicted();
    await phone.comments.keepMine(id);
    // Ya no espera decisión: es un cambio más de la cola.
    expect(root(phone, brief)).toMatchObject({ body: 'Del teléfono', pending: true });
    expect(root(phone, brief).conflict ?? null).toBeNull();
    expect(phone.comments.status()).toMatchObject({ pending: 1, failed: 0 });
    expect(await phone.commentsDb.get('meta', `editConflict:${id}`)).toBeUndefined();
    await phone.engine.syncNow();
    expect(server.comments.get(id)?.body).toBe('Del teléfono');
    expect(edits(server).at(-1)).toEqual(['Del teléfono', 'De la computadora']);
    expect(phone.comments.status()).toMatchObject({ pending: 0, failed: 0 });
    await pull(server, desk);
    expect(body(desk, brief)).toBe('Del teléfono');
  });

  it('descartar la propia deja lo guardado y no manda nada', async () => {
    const { server, phone, brief, id } = await conflicted();
    const calls = server.commentEdits.length;
    await phone.comments.discardMine(id);
    expect(root(phone, brief)).toMatchObject({ body: 'De la computadora', pending: false });
    expect(root(phone, brief).conflict ?? null).toBeNull();
    expect(phone.comments.status()).toMatchObject({ pending: 0, failed: 0 });
    expect(await phone.commentsDb.get('meta', `editConflict:${id}`)).toBeUndefined();
    await phone.engine.syncNow();
    expect(server.commentEdits).toHaveLength(calls);
    expect(server.comments.get(id)?.body).toBe('De la computadora');
  });

  it('si la base volvió a cambiar antes de quedarse con la propia, vuelve a quedar apartada: nunca pisa lo que la persona no vio', async () => {
    const { server, phone, desk, brief, id } = await conflicted();
    // La computadora edita otra vez; el teléfono todavía muestra la versión anterior al decidir.
    await pull(server, desk);
    await desk.comments.edit(brief, id, 'De la computadora, corregido');
    await desk.engine.syncNow();
    await phone.comments.keepMine(id);
    await phone.engine.syncNow();
    expect(server.comments.get(id)?.body).toBe('De la computadora, corregido');
    expect(root(phone, brief)).toMatchObject({ body: 'De la computadora, corregido', conflict: { text: 'Del teléfono' } });
    // Con lo nuevo a la vista, ahora sí.
    await phone.comments.keepMine(id);
    await phone.engine.syncNow();
    expect(server.comments.get(id)?.body).toBe('Del teléfono');
    expect(phone.comments.status()).toMatchObject({ pending: 0, failed: 0 });
  });

  it('si la base termina teniendo el mismo texto (se eligió lo mismo desde otro lado), no queda nada que decidir', async () => {
    const { server, phone, desk, brief, id } = await conflicted();
    await pull(server, desk);
    await desk.comments.edit(brief, id, 'Del teléfono');
    await desk.engine.syncNow();
    await pull(server, phone);
    expect(root(phone, brief)).toMatchObject({ body: 'Del teléfono', pending: false });
    expect(root(phone, brief).conflict ?? null).toBeNull();
    expect(phone.comments.status()).toMatchObject({ pending: 0, failed: 0 });
    expect(await phone.commentsDb.get('meta', `editConflict:${id}`)).toBeUndefined();
  });
});

describe('el conflicto no frena la cola ni se reintenta solo', () => {
  it('lo demás de la cola sube en la misma vuelta, y ni otra sincronización, ni Retry, ni volver a abrir la app lo mandan de nuevo', async () => {
    const server = new FakeServer();
    server.enableComments();
    server.editBaseEnabled = true;
    const dbName = crypto.randomUUID();
    let phone = await device(server, undefined, dbName);
    const brief = await phone.tree.create(null, 'Brief');
    await phone.engine.syncNow();
    const desk = await device(server);
    await desk.engine.syncNow();
    phone.comments.watch(brief);
    desk.comments.watch(brief);
    const id = await phone.comments.add(brief, BLOCK, 'Original');
    await phone.engine.syncNow();
    await pull(server, desk);

    await phone.comments.edit(brief, id, 'Del teléfono');
    const other = await phone.comments.add(brief, BLOCK, 'Otro hilo, escrito después');
    await desk.comments.edit(brief, id, 'De la computadora');
    await desk.engine.syncNow();
    await phone.engine.syncNow();
    // El otro comentario subió en la misma vuelta.
    expect(server.comments.get(other)?.body).toBe('Otro hilo, escrito después');
    expect(phone.comments.status()).toMatchObject({ pending: 0, failed: 1 });
    const sent = server.commentEdits.length;

    await pull(server, phone);
    await phone.comments.retryFailed();
    await phone.engine.retryRejected();
    expect(server.commentEdits).toHaveLength(sent);
    expect(server.comments.get(id)?.body).toBe('De la computadora');

    // Se cierra y se vuelve a abrir la app (que reintenta lo rechazado al abrir): sigue apartada, sin mandarse.
    devices.splice(devices.indexOf(phone), 1);
    close(phone);
    phone = await device(server, undefined, dbName);
    phone.comments.watch(brief);
    await phone.comments.retryFailed();
    await phone.engine.syncNow();
    expect(server.commentEdits).toHaveLength(sent);
    const mine = phone.comments.threads(brief).find((t) => t.id === id)!.root;
    expect(mine).toMatchObject({ body: 'De la computadora', conflict: { text: 'Del teléfono' } });
    expect(phone.comments.status()).toMatchObject({ pending: 0, failed: 1 });
  });

  it('una versión anterior de la app que abre la misma base no la manda ni la borra', async () => {
    const { server, phone, desk, brief, id } = await twoDevices();
    await phone.comments.edit(brief, id, 'Del teléfono');
    await desk.comments.edit(brief, id, 'De la computadora');
    await desk.engine.syncNow();
    await phone.engine.syncNow();
    const sent = server.commentEdits.length;
    const dbName = phone.commentsDb.name;

    // La v0.098 con la misma base: no conoce lo apartado (no está en la cola) y no tiene nada que subir.
    const db098 = await Comments098.openCommentsDb(dbName);
    const v098 = new Comments098.CommentQueue(db098 as never, new FakeRemote(server, '0.098') as never, server.ownerId);
    await v098.load();
    v098.configure(5, 1);
    await v098.retryFailed();
    await v098.run();
    expect(v098.status()).toMatchObject({ pending: 0, failed: 0 });
    v098.stop();
    db098.close();
    expect(server.commentEdits).toHaveLength(sent);
    expect(server.comments.get(id)?.body).toBe('De la computadora');

    // La de hoy la sigue teniendo.
    const db = await openCommentsDb(dbName);
    const queue = new CommentQueue(db, new FakeRemote(server, '9.999'), server.ownerId);
    await queue.load();
    expect(queue.status()).toMatchObject({ pending: 0, failed: 1 });
    expect(queue.failures()).toMatchObject([{ body: 'Del teléfono', conflictOf: id }]);
    queue.stop();
    db.close();
  });
});

describe('qué cuenta como la misma base', () => {
  it('un comentario nunca editado se edita sin conflicto, y la base que viaja es su texto', async () => {
    const { server, phone, brief, id } = await twoDevices();
    expect(server.comments.get(id)?.edited_at).toBeNull();
    await phone.comments.edit(brief, id, 'Primera edición');
    await phone.engine.syncNow();
    expect(server.comments.get(id)?.body).toBe('Primera edición');
    expect(edits(server)).toEqual([['Primera edición', 'Original']]);
    expect(phone.comments.status()).toMatchObject({ pending: 0, failed: 0 });
  });

  it('dos ediciones seguidas sin subir se juntan y conservan la base de la primera: no chocan consigo mismas', async () => {
    const { server, phone, brief, id } = await twoDevices();
    await phone.comments.edit(brief, id, 'Uno');
    await phone.comments.edit(brief, id, 'Dos');
    expect(phone.comments.status().pending).toBe(1);
    await phone.engine.syncNow();
    expect(edits(server)).toEqual([['Dos', 'Original']]);
    expect(server.comments.get(id)?.body).toBe('Dos');
    expect(phone.comments.status()).toMatchObject({ pending: 0, failed: 0 });
  });

  it('una edición hecha con la anterior ya en viaje va aparte y se basa en ella: entra cuando la primera llegó', async () => {
    const { server, phone, brief, id } = await twoDevices();
    await phone.comments.edit(brief, id, 'Uno');
    // La primera llega y su respuesta se pierde: queda en la cola, ya intentada.
    server.loseCommentResponse.add('edit');
    await phone.engine.syncNow();
    expect(server.comments.get(id)?.body).toBe('Uno');
    await phone.comments.edit(brief, id, 'Dos');
    expect(phone.comments.status().pending).toBe(2);
    await phone.engine.syncNow();
    // El reintento de la primera encuentra su mismo texto (da bien, sin conflicto) y la segunda parte de él.
    expect(edits(server)).toEqual([['Uno', 'Original'], ['Uno', 'Original'], ['Dos', 'Uno']]);
    expect(server.comments.get(id)?.body).toBe('Dos');
    expect(phone.comments.status()).toMatchObject({ pending: 0, failed: 0 });
    expect(root(phone, brief).conflict ?? null).toBeNull();
  });

  it('si la primera de dos ediciones en viaje choca, la segunda no se manda: lo apartado es el último texto de la persona', async () => {
    const { server, phone, desk, brief, id } = await twoDevices();
    await phone.comments.edit(brief, id, 'Uno');
    // La primera sale y falla de un modo pasajero: queda intentada, y la segunda va aparte.
    server.failCommentOnce.add('edit');
    await phone.engine.syncNow();
    await phone.comments.edit(brief, id, 'Dos');
    expect(phone.comments.status().pending).toBe(2);
    await desk.comments.edit(brief, id, 'De la computadora');
    await desk.engine.syncNow();
    const sent = server.commentEdits.length;
    await phone.engine.syncNow();
    expect(server.commentEdits.slice(sent).map((e) => e.body)).toEqual(['Uno']);
    expect(server.comments.get(id)?.body).toBe('De la computadora');
    expect(root(phone, brief)).toMatchObject({ body: 'De la computadora', conflict: { text: 'Dos' } });
    expect(phone.comments.status()).toMatchObject({ pending: 0, failed: 1 });
  });

  it('la base es el texto que la persona tenía delante al empezar: lo que llegó mientras escribía no se pisa', async () => {
    const { server, phone, desk, brief, id } = await twoDevices();
    // El teléfono abre el cuadro con «Original» (el panel le pasa ese texto a `edit`). Mientras escribe, la computadora
    // edita y el teléfono lo baja.
    const seen = body(phone, brief);
    await desk.comments.edit(brief, id, 'De la computadora');
    await desk.engine.syncNow();
    await pull(server, phone);
    expect(body(phone, brief)).toBe('De la computadora');
    await phone.comments.edit(brief, id, 'Del teléfono', undefined, seen);
    await phone.engine.syncNow();
    expect(server.comments.get(id)?.body).toBe('De la computadora');
    expect(root(phone, brief)).toMatchObject({ body: 'De la computadora', conflict: { text: 'Del teléfono' } });
  });

  /** Una edición como la deja en la cola una versión anterior de la app: sin base. */
  const oldEdit = (pageId: string, id: string, text: string, extra: Record<string, unknown> = {}) => ({
    op: { kind: 'edit' as const, id, pageId, body: text, at: new Date().toISOString(), ...extra },
    attempted: false, failed: false, error: null, queuedAt: Date.now(),
  });

  it('una edición que dejó en la cola una versión anterior (sin base) toma de base, al abrir, el texto guardado en el dispositivo', async () => {
    const { server, phone, desk, brief, id } = await twoDevices();
    // Dos seguidas, las dos sin base: la segunda parte de la primera.
    await phone.commentsDb.add('outbox', oldEdit(brief, id, 'Vieja 1'));
    await phone.commentsDb.add('outbox', oldEdit(brief, id, 'Vieja 2'));
    // Mientras el teléfono estaba sin red, la computadora editó.
    await desk.comments.edit(brief, id, 'De la computadora');
    await desk.engine.syncNow();
    // Se actualiza la app y abre: el teléfono todavía tiene guardado «Original».
    await phone.comments.load();
    await phone.engine.syncNow();
    // Ya no pisa: la primera choca, y lo apartado es el último texto.
    expect(edits(server).at(-1)).toEqual(['Vieja 1', 'Original']);
    expect(server.comments.get(id)?.body).toBe('De la computadora');
    expect(root(phone, brief)).toMatchObject({ body: 'De la computadora', conflict: { text: 'Vieja 2' } });
  });

  it('sin choque, esa edición vieja entra; una sola vez se le busca la base, y la que va sin base a propósito no se toca', async () => {
    const { server, phone, brief, id } = await twoDevices();
    const other = await phone.comments.add(brief, BLOCK, 'Otro');
    await phone.engine.syncNow();
    await phone.commentsDb.add('outbox', oldEdit(brief, id, 'De la versión anterior'));
    // Sin base a propósito (lo que vuelve después de restaurar una copia), y una de un comentario que el dispositivo no tiene.
    await phone.commentsDb.add('outbox', oldEdit(brief, other, 'Vuelve tras restaurar', { unchecked: true }));
    await phone.commentsDb.add('outbox', oldEdit(brief, crypto.randomUUID(), 'De un comentario que no está'));
    await phone.comments.load();
    const queued = (await phone.commentsDb.getAll('outbox')).map((e) => (e.op.kind === 'edit' ? [e.op.body, e.op.base, e.op.unchecked] : null));
    expect(queued).toEqual([['De la versión anterior', 'Original', undefined], ['Vuelve tras restaurar', undefined, true], ['De un comentario que no está', undefined, true]]);
    // Abrir otra vez no cambia nada (ya tienen base, o quedaron marcadas), aunque lo guardado sea otro.
    await phone.commentsDb.put('comments', { ...(await phone.commentsDb.get('comments', id))!, body: 'Otra cosa guardada' });
    await phone.comments.load();
    expect((await phone.commentsDb.getAll('outbox')).map((e) => (e.op.kind === 'edit' ? e.op.base : null))).toEqual(['Original', undefined, undefined]);
    await phone.engine.syncNow();
    expect(edits(server).slice(0, 2)).toEqual([['De la versión anterior', 'Original'], ['Vuelve tras restaurar', undefined]]);
    expect(server.comments.get(id)?.body).toBe('De la versión anterior');
    expect(server.comments.get(other)?.body).toBe('Vuelve tras restaurar');
  });

  it('después de restaurar una copia, la edición propia que vuelve va sin base a propósito, también si la app se reabre antes de mandarla', async () => {
    const { server, phone, brief, id } = await twoDevices();
    const restore = server.backup();
    await phone.comments.edit(brief, id, 'Editado después de la copia');
    await phone.engine.syncNow();
    restore();
    expect(server.comments.get(id)?.body).toBe('Original');
    // La edición vuelve a la cola; su primer intento falla de un modo pasajero y la app se cierra y se abre.
    server.failCommentOnce.add('edit');
    await pull(server, phone);
    expect(phone.comments.status().pending).toBe(1);
    await phone.comments.load();
    await pull(server, phone);
    // No se le buscó una base (daría un conflicto con la copia restaurada, que es justo lo que viene a pisar).
    expect(edits(server).at(-1)).toEqual(['Editado después de la copia', undefined]);
    expect(server.comments.get(id)?.body).toBe('Editado después de la copia');
    expect(phone.comments.status()).toMatchObject({ pending: 0, failed: 0 });
  });

  it('un comentario que se borró mientras tanto: la edición queda rechazada con su texto, como siempre', async () => {
    const { server, phone, desk, brief, id } = await twoDevices();
    await phone.comments.edit(brief, id, 'Del teléfono');
    await desk.comments.remove(brief, id);
    await desk.engine.syncNow();
    await phone.engine.syncNow();
    expect(server.comments.get(id)).toMatchObject({ body: 'Original' });
    expect(server.comments.get(id)?.deleted_at).toBeTruthy();
    expect(phone.comments.failures()).toMatchObject([{ kind: 'edit', body: 'Del teléfono', error: 'The comment was deleted.' }]);
    expect(phone.comments.failures()[0].conflictOf).toBeUndefined();
  });

  it('un hilo que se resolvió mientras tanto no es un conflicto: resolver no cambia el texto', async () => {
    const { server, phone, desk, brief, id } = await twoDevices();
    await phone.comments.edit(brief, id, 'Del teléfono');
    await desk.comments.resolve(brief, id, true);
    await desk.engine.syncNow();
    await phone.engine.syncNow();
    expect(server.comments.get(id)).toMatchObject({ body: 'Del teléfono' });
    expect(server.comments.get(id)?.resolved_at).toBeTruthy();
    expect(phone.comments.status()).toMatchObject({ pending: 0, failed: 0 });
  });

  it('un comentario que se borra después de una edición que chocó: lo apartado sigue a la vista en el comentario borrado', async () => {
    const { server, phone, desk, brief, id } = await twoDevices();
    // Una respuesta propia, con otra respuesta al lado (así el hilo sigue a la vista).
    const reply = await phone.comments.add(brief, null, 'Una respuesta', id);
    const other = await phone.comments.add(brief, null, 'Otra respuesta', id);
    await phone.engine.syncNow();
    await pull(server, desk);
    await phone.comments.edit(brief, reply, 'Del teléfono');
    await desk.comments.edit(brief, reply, 'De la computadora');
    await desk.engine.syncNow();
    await phone.engine.syncNow();
    expect(phone.comments.threads(brief)[0].replies[0]).toMatchObject({ id: reply, body: 'De la computadora', conflict: { text: 'Del teléfono' } });
    // La computadora la borra.
    await pull(server, desk);
    await desk.comments.remove(brief, reply);
    await desk.engine.syncNow();
    await pull(server, phone);
    expect(server.comments.get(reply)?.deleted_at).toBeTruthy();
    const thread = phone.comments.threads(brief)[0];
    expect(thread.replies.map((r) => r.id)).toEqual([reply, other]);
    expect(thread.replies[0]).toMatchObject({ deleted: true, conflict: { text: 'Del teléfono' } });
    // No hay sobre qué quedarse con lo propio: queda descartarlo a mano (o copiarlo antes).
    await expect(phone.comments.keepMine(reply)).rejects.toThrow('The comment was deleted.');
    expect(phone.comments.status().failed).toBe(1);
    await phone.comments.discardMine(reply);
    expect(phone.comments.status()).toMatchObject({ pending: 0, failed: 0 });
    expect(phone.comments.threads(brief)[0].replies.map((r) => r.id)).toEqual([other]);
  });

  it('lo guardado se ve al lado de lo propio aunque la página no se vuelva a bajar', async () => {
    const server = new FakeServer();
    server.enableComments();
    server.editBaseEnabled = true;
    const phone = await device(server);
    const brief = await phone.tree.create(null, 'Brief');
    await phone.engine.syncNow();
    const desk = await device(server);
    await desk.engine.syncNow();
    const stop = phone.comments.watch(brief);
    desk.comments.watch(brief);
    const id = await phone.comments.add(brief, BLOCK, 'Original');
    await phone.engine.syncNow();
    await pull(server, desk);
    await phone.comments.edit(brief, id, 'Del teléfono');
    await desk.comments.edit(brief, id, 'De la computadora');
    await desk.engine.syncNow();
    // El teléfono cierra la página (ya no se baja) y sincroniza: el texto de la base llega con el conflicto.
    stop();
    const lists = server.commentCalls.length;
    await phone.engine.syncNow();
    expect(server.commentCalls.slice(lists)).toEqual([`edit ${id}`]);
    expect(root(phone, brief)).toMatchObject({ body: 'De la computadora', conflict: { text: 'Del teléfono' } });
    expect((await phone.commentsDb.get('comments', id))?.body).toBe('De la computadora');
  });
});

describe('un solo texto apartado por comentario: nada lo reemplaza sin que la persona lo haya visto', () => {
  const draftOf = (d: Device, id: string) => d.commentsDb.get('meta', `editConflict:${id}`) as Promise<{ body: string } | undefined>;
  const queuedEdits = async (d: Device) => (await d.commentsDb.getAll('outbox')).map((e) => (e.op.kind === 'edit' ? [e.op.body, e.op.base, e.failed] : [e.op.kind, null, e.failed]));

  it('una edición rechazada vieja que se reintenta y también choca no pisa lo apartado: quedan los dos textos', async () => {
    const { server, phone, desk, brief, id } = await twoDevices({ mentions: true });
    // El teléfono edita y, antes de que suba, le bajan el permiso a ver: la edición (y sus menciones) quedan rechazadas.
    await phone.comments.edit(brief, id, '@beto TEL-1', [beto]);
    server.grant(ANA, { pageId: brief }, 'view');
    await phone.engine.syncNow();
    expect(phone.comments.failures().map((f) => f.kind)).toEqual(['edit', 'mentions']);
    // Le devuelven el permiso y edita otra vez (el panel ofrece *Edit*: un rechazo no lo esconde). La computadora
    // edita y sube; el teléfono sincroniza: «TEL-2» queda apartada.
    // (Sin pasar menciones: las rechazadas de la edición anterior siguen en la cola, detrás de ella.)
    server.grant(ANA, { pageId: brief }, 'comment');
    await phone.comments.edit(brief, id, 'TEL-2');
    expect(phone.comments.failures().map((f) => f.kind)).toEqual(['edit', 'mentions']);
    await desk.comments.edit(brief, id, 'PC', []);
    await desk.engine.syncNow();
    await phone.engine.syncNow();
    expect((await draftOf(phone, id))?.body).toBe('TEL-2');
    // Se reabre la app (o se toca *Retry*): lo rechazado se reintenta y también choca.
    const calls = server.commentCalls.length;
    await phone.comments.retryFailed();
    await phone.engine.syncNow();
    expect(server.comments.get(id)?.body).toBe('PC');
    // Lo último que escribió sigue apartado, y la vieja sigue en la cola, rechazada, con su texto.
    expect((await draftOf(phone, id))?.body).toBe('TEL-2');
    expect(await queuedEdits(phone)).toEqual([['@beto TEL-1', 'Original', true]]);
    expect(root(phone, brief)).toMatchObject({ body: 'PC', conflict: { text: 'TEL-2' }, rejectedText: '@beto TEL-1', failedKinds: ['edit'] });
    expect(root(phone, brief).error).toContain('another edit of yours on it is waiting');
    expect(phone.comments.status()).toMatchObject({ pending: 0, failed: 2 });
    expect((await exportComments(phone.commentsDb)).map((c) => (c as { body: string }).body).sort()).toEqual(['@beto TEL-1', 'TEL-2']);
    // Sus menciones no se mandaron sobre el texto de la computadora, ni vuelven a la cola al abrir.
    expect(server.commentCalls.slice(calls).filter((c) => c.startsWith('set_comment_mentions'))).toEqual([]);
    expect(server.mentions).toHaveLength(0);
    expect(await phone.commentsDb.get('meta', `mentions:${id}`)).toBeUndefined();
    // Reintentar de nuevo no cambia nada.
    await phone.comments.retryFailed();
    await phone.engine.syncNow();
    expect((await draftOf(phone, id))?.body).toBe('TEL-2');
    expect(phone.comments.status()).toMatchObject({ pending: 0, failed: 2 });
    // Decidida la apartada, la vieja que se reintenta pasa a ser la que espera decisión: tampoco se pierde.
    await phone.comments.keepMine(id);
    await phone.engine.syncNow();
    expect(server.comments.get(id)?.body).toBe('TEL-2');
    await phone.comments.retryFailed();
    await phone.engine.syncNow();
    expect(server.comments.get(id)?.body).toBe('TEL-2');
    expect(root(phone, brief)).toMatchObject({ body: 'TEL-2', conflict: { text: '@beto TEL-1' }, error: null });
    expect(phone.comments.status()).toMatchObject({ pending: 0, failed: 1 });
  });

  it('una edición posterior que no partía de la que choca no se va con ella: quedan las dos', async () => {
    const { server, phone, desk, brief, id } = await twoDevices({ mentions: true });
    await phone.comments.edit(brief, id, 'TEL-1');
    server.grant(ANA, { pageId: brief }, 'view');
    await phone.engine.syncNow();
    server.grant(ANA, { pageId: brief }, 'comment');
    // «TEL-2» se escribe sobre lo guardado («Original»), con «TEL-1» rechazada a la vista: no parte de ella.
    await phone.comments.edit(brief, id, 'TEL-2');
    await desk.comments.edit(brief, id, 'PC');
    await desk.engine.syncNow();
    // Se reabre la app antes de que «TEL-2» suba: la rechazada vuelve a la cola, adelante.
    await phone.comments.retryFailed();
    expect(await queuedEdits(phone)).toEqual([['TEL-1', 'Original', false], ['TEL-2', 'Original', false]]);
    await phone.engine.syncNow();
    expect(server.comments.get(id)?.body).toBe('PC');
    const texts = [(await draftOf(phone, id))?.body, ...(await queuedEdits(phone)).map((e) => e[0])];
    expect(texts.sort()).toEqual(['TEL-1', 'TEL-2']);
    expect(root(phone, brief)).toMatchObject({ body: 'PC', conflict: { text: 'TEL-1' }, rejectedText: 'TEL-2' });
  });

  it('con una apartada, guardar otro texto que partía de ella lo vuelve lo apartado (no entra a la cola); *Keep mine* manda ese', async () => {
    const { server, phone, desk, brief, id } = await twoDevices();
    await phone.comments.edit(brief, id, 'TEL-1');
    await desk.comments.edit(brief, id, 'PC');
    await desk.engine.syncNow();
    await phone.engine.syncNow();
    expect(root(phone, brief)).toMatchObject({ body: 'PC', conflict: { text: 'TEL-1' } });
    // El cuadro estaba abierto con «TEL-1» (la base que tomó el panel) y la persona guarda «TEL-2».
    await phone.comments.edit(brief, id, 'TEL-2', undefined, 'TEL-1');
    expect(await queuedEdits(phone)).toEqual([]);
    expect((await draftOf(phone, id))?.body).toBe('TEL-2');
    // Lo guardado sigue siendo lo de la computadora, y lo propio es el último texto.
    expect(root(phone, brief)).toMatchObject({ body: 'PC', conflict: { text: 'TEL-2' } });
    expect(phone.comments.status()).toMatchObject({ pending: 0, failed: 1 });
    await phone.comments.keepMine(id);
    await phone.engine.syncNow();
    expect(edits(server).at(-1)).toEqual(['TEL-2', 'PC']);
    expect(server.comments.get(id)?.body).toBe('TEL-2');
    expect(phone.comments.status()).toMatchObject({ pending: 0, failed: 0 });
  });

  it('con una apartada, un texto que no partía de ella no la reemplaza ni entra a la cola: se rechaza al guardar', async () => {
    const { phone, desk, brief, id } = await twoDevices();
    await phone.comments.edit(brief, id, 'TEL-1');
    await desk.comments.edit(brief, id, 'PC');
    await desk.engine.syncNow();
    await phone.engine.syncNow();
    await expect(phone.comments.edit(brief, id, 'TEL-3')).rejects.toThrow('waiting for you to choose which text stays');
    await expect(phone.comments.edit(brief, id, 'TEL-3', undefined, 'PC')).rejects.toThrow(CommentInvalid);
    expect(await queuedEdits(phone)).toEqual([]);
    expect((await draftOf(phone, id))?.body).toBe('TEL-1');
    expect(root(phone, brief)).toMatchObject({ body: 'PC', conflict: { text: 'TEL-1' } });
  });

  it('apartar una edición no se lleva las de otros comentarios ni lo rechazado del mismo', async () => {
    const { server, phone, desk, brief, id } = await twoDevices();
    // El otro comentario dice justo lo que el teléfono va a escribir en el primero: su edición parte de ese mismo
    // texto, y la cola no las puede confundir por el texto.
    const other = await phone.comments.add(brief, BLOCK, 'TEL');
    await phone.engine.syncNow();
    await pull(server, desk);
    // Dos comentarios con una edición sin subir cada uno; la computadora edita solo el primero.
    await phone.comments.edit(brief, id, 'TEL');
    await phone.comments.edit(brief, other, 'Otro, del teléfono');
    // Y algo ya rechazado del primero, más atrás en la cola (unas menciones que la base no aceptó).
    const rejected = { kind: 'mentions' as const, id, pageId: brief, mentions: [beto], at: new Date().toISOString() };
    await phone.commentsDb.add('outbox', { op: rejected, attempted: true, failed: true, error: 'The mentions in this comment are not valid.', queuedAt: Date.now() });
    await phone.comments.load();
    await desk.comments.edit(brief, id, 'PC');
    await desk.engine.syncNow();
    await phone.engine.syncNow();
    // El primero queda apartado; la edición del otro subió, y lo rechazado sigue en la cola.
    expect((await draftOf(phone, id))?.body).toBe('TEL');
    expect(server.comments.get(other)?.body).toBe('Otro, del teléfono');
    expect(phone.comments.threads(brief).map((t) => [t.root.body, t.root.conflict?.text ?? null])).toEqual([['PC', 'TEL'], ['Otro, del teléfono', null]]);
    expect(phone.comments.failures().map((f) => [f.kind, f.conflictOf ?? null])).toEqual([['mentions', null], ['edit', id]]);
  });

  it('después de apartar, la página se baja en esa misma vuelta aunque no le tocara', async () => {
    const { server, phone, desk, brief, id } = await twoDevices();
    // El teléfono bajó recién (no le toca hasta dentro de 10 segundos). La computadora edita y suma otro comentario.
    await pull(server, phone);
    await phone.comments.edit(brief, id, 'TEL');
    await desk.comments.edit(brief, id, 'PC');
    const extra = await desk.comments.add(brief, BLOCK, 'Otro, de la computadora');
    await desk.engine.syncNow();
    await phone.engine.syncNow();
    expect(root(phone, brief).conflict).toEqual({ text: 'TEL' });
    expect(phone.comments.threads(brief).map((t) => t.id)).toContain(extra);
  });

  it('dos pestañas: si una descartó lo apartado, *Keep mine* en la otra no lo manda', async () => {
    const { server, phone, desk, brief, id } = await twoDevices();
    await phone.comments.edit(brief, id, 'TEL');
    await desk.comments.edit(brief, id, 'PC');
    await desk.engine.syncNow();
    await phone.engine.syncNow();
    // Otra pestaña del mismo dispositivo (otra cola sobre la misma base) lo descarta.
    const db = await openCommentsDb(phone.commentsDb.name);
    const tab = new CommentQueue(db, new FakeRemote(server, '9.999'), server.ownerId);
    await tab.load();
    expect(tab.status().failed).toBe(1);
    await tab.discardMine(id);
    tab.stop();
    db.close();
    // La primera todavía lo tenía en memoria.
    const sent = server.commentEdits.length;
    await phone.comments.keepMine(id);
    await phone.engine.syncNow();
    expect(server.commentEdits).toHaveLength(sent);
    expect(server.comments.get(id)?.body).toBe('PC');
    expect(root(phone, brief).conflict ?? null).toBeNull();
    expect(phone.comments.status()).toMatchObject({ pending: 0, failed: 0 });
  });
});

describe('las menciones de una edición que choca', () => {
  it('las menciones de una segunda edición van detrás de ella, nunca antes: no avisan por un texto que después choca', async () => {
    const { server, phone, desk, brief, id } = await twoDevices({ mentions: true });
    await phone.comments.edit(brief, id, 'UNO @beto', [beto]);
    // La primera edición sale y falla de un modo pasajero: queda intentada, con sus menciones sin intentar.
    server.failCommentOnce.add('edit');
    await phone.engine.syncNow();
    await phone.comments.edit(brief, id, 'DOS @caro', [caro], 'UNO @beto');
    const queue = (await phone.commentsDb.getAll('outbox')).map((e) => (e.op.kind === 'mentions' ? e.op.mentions.map((m) => m.label).join() : e.op.kind === 'edit' ? e.op.body : e.op.kind));
    expect(queue).toEqual(['UNO @beto', 'DOS @caro', 'caro']);
    expect(await phone.commentsDb.get('meta', `mentions:${id}`)).toMatchObject({ mentions: [caro] });
    // Vuelve la red un instante: la primera entra y la segunda se corta.
    const real = phone.remote.editComment.bind(phone.remote);
    let cut = true;
    phone.remote.editComment = async (commentId: string, text: string, base?: string) => {
      if (text === 'DOS @caro' && cut) {
        cut = false;
        throw new RemoteError('Failed to fetch', false, undefined, true);
      }
      return real(commentId, text, base);
    };
    await phone.engine.syncNow();
    expect(server.comments.get(id)?.body).toBe('UNO @beto');
    // En esa ventana la computadora baja y edita.
    await pull(server, desk);
    await desk.comments.edit(brief, id, 'PC', []);
    await desk.engine.syncNow();
    await phone.engine.syncNow();
    // La segunda choca y queda apartada; a Caro no se la avisó nunca.
    expect(server.comments.get(id)?.body).toBe('PC');
    expect(root(phone, brief)).toMatchObject({ body: 'PC', conflict: { text: 'DOS @caro' } });
    expect(server.mentions.filter((m) => m.user_id === CARO)).toEqual([]);
    expect(phone.comments.status()).toMatchObject({ pending: 0, failed: 1 });
    // Si se queda con lo suyo, ahí sí.
    await phone.comments.keepMine(id);
    await phone.engine.syncNow();
    expect(server.comments.get(id)?.body).toBe('DOS @caro');
    expect(server.mentions.filter((m) => !m.removed_at).map((m) => m.user_id)).toEqual([CARO]);
  });

  it('no se mandan sobre el texto de otro; al quedarse con la propia salen detrás de ella', async () => {
    const { server, phone, desk, brief, id } = await twoDevices({ mentions: true });
    await phone.comments.edit(brief, id, '@beto mirá esto', [beto]);
    expect(phone.comments.status().pending).toBe(2);
    await desk.comments.edit(brief, id, 'De la computadora');
    await desk.engine.syncNow();
    await phone.engine.syncNow();
    // Ni la edición ni sus menciones llegaron, y la copia de las menciones no vuelve a la cola al abrir.
    expect(server.comments.get(id)?.body).toBe('De la computadora');
    expect(server.mentions).toHaveLength(0);
    expect(server.commentCalls.filter((c) => c.startsWith('set_comment_mentions'))).toHaveLength(0);
    expect(phone.comments.status()).toMatchObject({ pending: 0, failed: 1 });
    expect(await phone.commentsDb.get('meta', `mentions:${id}`)).toBeUndefined();
    expect(root(phone, brief)).toMatchObject({ body: 'De la computadora', mentions: [], conflict: { text: '@beto mirá esto' } });

    await phone.comments.keepMine(id);
    expect(phone.comments.status()).toMatchObject({ pending: 2, failed: 0 });
    await phone.engine.syncNow();
    expect(server.comments.get(id)?.body).toBe('@beto mirá esto');
    expect(server.mentions).toMatchObject([{ comment_id: id, user_id: BETO }]);
    expect(phone.comments.status()).toMatchObject({ pending: 0, failed: 0 });
  });

  it('una edición que no cambiaba las menciones las conserva al quedarse con la propia, aunque la otra las haya sacado', async () => {
    const { server, phone, desk, brief, id } = await twoDevices({ mentions: true });
    await phone.comments.edit(brief, id, '@beto mirá', [beto]);
    await phone.engine.syncNow();
    await pull(server, desk);
    expect(server.mentions.filter((m) => !m.removed_at)).toMatchObject([{ user_id: BETO }]);
    // El teléfono corrige el texto sin tocar a quién nombra; la computadora saca la mención y llega primero.
    await phone.comments.edit(brief, id, '@beto mirá esto', [beto]);
    expect(phone.comments.status().pending).toBe(1);
    await desk.comments.edit(brief, id, 'Sin nombrar a nadie', []);
    await desk.engine.syncNow();
    expect(server.mentions.filter((m) => !m.removed_at)).toHaveLength(0);
    await phone.engine.syncNow();
    await pull(server, phone);
    expect(root(phone, brief)).toMatchObject({ body: 'Sin nombrar a nadie', mentions: [], conflict: { text: '@beto mirá esto' } });
    await phone.comments.keepMine(id);
    await phone.engine.syncNow();
    expect(server.comments.get(id)?.body).toBe('@beto mirá esto');
    expect(server.mentions.filter((m) => !m.removed_at)).toMatchObject([{ comment_id: id, user_id: BETO }]);
  });
});

describe('las llamadas a la base', () => {
  const ID = '00000000-0000-4000-8000-00000000c0de';

  type Answer = { status: number; body: unknown };
  const OLD = 'p_body,p_id';
  const NEW = 'p_base,p_body,p_id';

  /**
   * La API de la base en el nivel de los pedidos, con el cliente de verdad. Como PostgREST, elige la función **por los
   * nombres de los argumentos del pedido**: cada firma de `edit_comment` que la base tiene va por sus nombres, y un
   * pedido con nombres que ninguna firma tiene contesta `PGRST202` (404).
   */
  function api(signatures: Record<string, (args: Record<string, unknown>) => Answer>) {
    const requests: { names: string; args: Record<string, unknown> }[] = [];
    const client = createClient('https://base.test', 'clave-publica', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: async (input, init) => {
          const args = JSON.parse(String(init?.body)) as Record<string, unknown>;
          const names = Object.keys(args).sort().join(',');
          expect(String(input instanceof Request ? input.url : input)).toBe('https://base.test/rest/v1/rpc/edit_comment');
          requests.push({ names, args });
          const answer = signatures[names]?.(args) ?? {
            status: 404,
            body: { code: 'PGRST202', message: `Could not find the function public.edit_comment(${names.replace(/,/g, ', ')}) in the schema cache`, details: null, hint: null },
          };
          // Una función que devuelve `void` contesta 204 sin cuerpo.
          return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
            status: answer.status,
            headers: { 'content-type': 'application/json' },
          });
        },
      },
    });
    return { remote: new SupabaseCommentRemote(client), requests };
  }

  it('con base manda los tres argumentos y entiende el conflicto; sin base, los dos de siempre', async () => {
    let answer: unknown = { conflict: false };
    const { remote, requests } = api({ [OLD]: () => ({ status: 204, body: undefined }), [NEW]: () => ({ status: 200, body: answer }) });
    expect(await remote.editComment(ID, 'nuevo', 'viejo')).toBeUndefined();
    expect(requests.at(-1)).toEqual({ names: NEW, args: { p_id: ID, p_body: 'nuevo', p_base: 'viejo' } });
    answer = { conflict: true, body: 'el de la base', edited_at: '2026-10-07T12:00:00.123456+00:00' };
    expect(await remote.editComment(ID, 'nuevo', 'viejo')).toEqual({ conflict: true, body: 'el de la base', editedAt: '2026-10-07T12:00:00.123456+00:00' });
    // Sin base (una edición guardada por una versión anterior): exactamente el pedido de la app publicada.
    expect(await remote.editComment(ID, 'nuevo')).toBeUndefined();
    expect(requests.at(-1)).toEqual({ names: OLD, args: { p_id: ID, p_body: 'nuevo' } });
    expect(requests).toHaveLength(3);
  });

  it('con una base sin la firma nueva (PGRST202) cae a la de dos argumentos y no vuelve a probar enseguida', async () => {
    const { remote, requests } = api({ [OLD]: () => ({ status: 204, body: undefined }) });
    expect(await remote.editComment(ID, 'nuevo', 'viejo')).toBeUndefined();
    expect(requests.map((r) => r.names)).toEqual([NEW, OLD]);
    expect(requests[1].args).toEqual({ p_id: ID, p_body: 'nuevo' });
    // La siguiente va directo a la de siempre.
    await remote.editComment(ID, 'otro', 'nuevo');
    expect(requests.map((r) => r.names)).toEqual([NEW, OLD, OLD]);
  });

  it('un error de la firma nueva que no es «no existe» no cae a la de dos argumentos (pisaría)', async () => {
    const denied = { status: 403, body: { code: '42501', message: 'comment_denied', details: null, hint: null } };
    const { remote, requests } = api({ [OLD]: () => ({ status: 204, body: undefined }), [NEW]: () => denied });
    await expect(remote.editComment(ID, 'nuevo', 'viejo')).rejects.toMatchObject({ message: 'comment_denied', permanent: true });
    // Tampoco una falla pasajera: la edición espera en la cola y se reintenta con su base.
    const { remote: flaky, requests: tries } = api({ [OLD]: () => ({ status: 204, body: undefined }), [NEW]: () => ({ status: 503, body: { message: 'upstream' } }) });
    await expect(flaky.editComment(ID, 'nuevo', 'viejo')).rejects.toMatchObject({ permanent: false });
    expect([requests.map((r) => r.names), tries.map((r) => r.names)]).toEqual([[NEW], [NEW]]);
  });
});
