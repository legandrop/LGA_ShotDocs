import { afterEach, describe, expect, it } from 'vitest';
import { LEVEL_EDIT, Permissions } from './access';
import { CommentInvalid, LEVEL_COMMENT, unsyncedComments, type CommentThread } from './comments';
import { FakeServer, makeDevice, type Device } from './testing';

// Paso 10, lado de la app: la cola de comentarios sin red, sus reintentos, el orden, los errores a la vista y
// los niveles. El servidor en memoria sigue las reglas de supabase/migrations/20260930170000_comentarios.sql.

const devices: Device[] = [];
async function device(server: FakeServer, user?: { id: string; email?: string }, dbName?: string): Promise<Device> {
  const d = await makeDevice(server, dbName, undefined, undefined, undefined, user ?? {});
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

/** Un workspace con comentarios (base en la versión 5) y dos páginas: Brief (con un bloque) y Notas. */
async function workspace() {
  const server = new FakeServer();
  server.enableComments();
  const owner = await device(server);
  const brief = await owner.tree.create(null, 'Brief');
  const notes = await owner.tree.create(null, 'Notes');
  await owner.engine.syncNow();
  return { server, owner, brief, notes };
}

const BLOCK = 'b1d2c3e4-0000-4000-8000-000000000001';

function texts(threads: CommentThread[]): string[][] {
  return threads.map((t) => [t.root.deleted ? '(deleted)' : t.root.body, ...t.replies.map((r) => r.body)]);
}

async function watchAndSync(d: Device, pageId: string): Promise<CommentThread[]> {
  const stop = d.comments.watch(pageId);
  await d.engine.syncNow();
  const threads = d.comments.threads(pageId);
  stop();
  return threads;
}

function perms(d: Device): Permissions {
  return new Permissions(d.tree, d.access.get(), d.remote.userId);
}

describe('cola sin red', () => {
  it('guarda primero en el dispositivo, cuenta como pendiente y sube al volver la red', async () => {
    const { server, owner, brief } = await workspace();
    server.online = false;
    const stop = owner.comments.watch(brief);
    const id = await owner.comments.add(brief, BLOCK, '  ¿Qué lente usaron?  ');
    await owner.engine.syncNow();

    expect(server.comments.size).toBe(0);
    expect(owner.engine.getStatus().pendingComments).toBe(1);
    const [thread] = owner.comments.threads(brief);
    expect(thread.root).toMatchObject({ id, body: '  ¿Qué lente usaron?', blockId: BLOCK, local: true, pending: true });
    expect(owner.comments.openCounts(brief).get(BLOCK)).toBe(1);

    server.online = true;
    await owner.engine.syncNow();
    expect(server.comments.get(id)).toMatchObject({ body: '  ¿Qué lente usaron?', block_id: BLOCK, author_id: server.ownerId });
    expect(owner.engine.getStatus().pendingComments).toBe(0);
    expect(owner.comments.threads(brief)[0].root).toMatchObject({ id, local: false, pending: false });
    stop();

    // Otro dispositivo de otra persona lo baja al abrir la página.
    server.addMember('ana', 'member', 'ana@test');
    server.grant('ana', { pageId: brief }, 'view');
    const ana = await device(server, { id: 'ana' });
    await ana.engine.syncNow();
    expect(texts(await watchAndSync(ana, brief))).toEqual([['  ¿Qué lente usaron?']]);
    expect(ana.comments.emailOf(server.ownerId)).toBe('owner@test');
  });

  it('lo bajado queda guardado y se ve sin red al volver a abrir la app', async () => {
    const { server, owner, brief } = await workspace();
    await owner.comments.add(brief, null, 'Comentario de la página');
    await owner.engine.syncNow();

    const name = crypto.randomUUID();
    const first = await device(server, undefined, name);
    await first.engine.syncNow();
    expect(texts(await watchAndSync(first, brief))).toEqual([['Comentario de la página']]);
    first.engine.stop();
    first.db.close();
    first.mediaDb.close();
    first.commentsDb.close();

    server.online = false;
    const again = await device(server, undefined, name);
    const stop = again.comments.watch(brief);
    await new Promise((r) => setTimeout(r, 20));
    expect(texts(again.comments.threads(brief))).toEqual([['Comentario de la página']]);
    expect(again.comments.emailOf(server.ownerId)).toBe('owner@test');
    stop();
  });

  it('una respuesta perdida se reintenta con el mismo id y no duplica nada', async () => {
    const { server, owner, brief } = await workspace();
    server.loseCommentResponse.add('add');
    const id = await owner.comments.add(brief, BLOCK, 'Hola');
    await owner.engine.syncNow();
    // El servidor lo tiene, pero el dispositivo no se enteró: sigue pendiente.
    expect(server.comments.size).toBe(1);
    expect(owner.engine.getStatus().pendingComments).toBe(1);

    await owner.engine.syncNow();
    expect(server.commentCalls).toEqual([`add ${id}`, `add ${id}`]);
    expect(server.comments.size).toBe(1);
    expect(owner.engine.getStatus()).toMatchObject({ pendingComments: 0, failedComments: 0 });
  });

  it('una edición sin red de un comentario que no subió se funde en el alta', async () => {
    const { server, owner, brief } = await workspace();
    server.online = false;
    const id = await owner.comments.add(brief, BLOCK, 'Primera versión');
    await owner.comments.edit(brief, id, 'Segunda versión');
    await owner.comments.edit(brief, id, 'Tercera versión');
    expect(owner.comments.status().pending).toBe(1);
    server.online = true;
    await owner.engine.syncNow();
    expect(server.commentCalls).toEqual([`add ${id}`]);
    expect(server.comments.get(id)).toMatchObject({ body: 'Tercera versión', edited_at: null });
  });

  it('si el alta ya salió (respuesta perdida), la edición va aparte y no da comment_conflict', async () => {
    const { server, owner, brief } = await workspace();
    server.loseCommentResponse.add('add');
    const id = await owner.comments.add(brief, BLOCK, 'Antes');
    await owner.engine.syncNow();
    await owner.comments.edit(brief, id, 'Después');
    await owner.engine.syncNow();
    expect(server.commentCalls).toEqual([`add ${id}`, `add ${id}`, `edit ${id}`]);
    expect(server.comments.get(id)?.body).toBe('Después');
    expect(owner.engine.getStatus()).toMatchObject({ pendingComments: 0, failedComments: 0 });
  });

  it('sube en el orden en que se hizo: hilo, respuesta, edición, resolución y borrado', async () => {
    const { server, owner, brief } = await workspace();
    const stop = owner.comments.watch(brief);
    server.online = false;
    const root = await owner.comments.add(brief, BLOCK, 'Raíz');
    await owner.engine.syncNow();
    server.online = true;
    // La raíz ya salió una vez (sin red): lo que sigue va en la cola, detrás.
    server.online = false;
    const reply = await owner.comments.add(brief, null, 'Respuesta', root);
    await owner.comments.resolve(brief, root, true);
    await owner.comments.resolve(brief, root, false);
    await owner.comments.resolve(brief, root, true);
    const other = await owner.comments.add(brief, BLOCK, 'Otro hilo');
    await owner.comments.remove(brief, other);
    expect(texts(owner.comments.threads(brief))).toEqual([['Raíz', 'Respuesta']]);
    expect(owner.comments.threads(brief)[0].resolved).toBe(true);

    server.online = true;
    await owner.engine.syncNow();
    // Resolver y reabrir sin mandar se queda con lo último; el hilo borrado antes de subir no viaja.
    expect(server.commentCalls).toEqual([`add ${root}`, `add ${reply}`, `resolve ${root} true`]);
    expect(server.comments.get(reply)).toMatchObject({ thread_id: root, block_id: BLOCK });
    expect(server.comments.get(root)?.resolved_by).toBe(server.ownerId);
    expect(server.comments.has(other)).toBe(false);
    const [thread] = owner.comments.threads(brief);
    expect(thread).toMatchObject({ resolved: true, pending: false, count: 2 });
    stop();
  });

  it('borrar un comentario que ya subió lo marca en el servidor, sin borrar el texto de la base', async () => {
    const { server, owner, brief } = await workspace();
    const stop = owner.comments.watch(brief);
    const root = await owner.comments.add(brief, BLOCK, 'Raíz');
    const reply = await owner.comments.add(brief, BLOCK, 'Respuesta', root);
    await owner.engine.syncNow();
    await owner.comments.remove(brief, root);
    await owner.engine.syncNow();
    expect(server.comments.get(root)).toMatchObject({ body: 'Raíz', deleted_by: server.ownerId });
    // El hilo sigue por la respuesta, con la raíz borrada.
    expect(texts(owner.comments.threads(brief))).toEqual([['(deleted)', 'Respuesta']]);
    await owner.comments.remove(brief, reply);
    await owner.engine.syncNow();
    expect(owner.comments.threads(brief)).toEqual([]);
    stop();
  });

  it('los comentarios de una página creada sin red esperan a que la página suba', async () => {
    const { server, owner } = await workspace();
    server.online = false;
    const page = await owner.tree.create(null, 'Nueva');
    await owner.comments.add(page, null, 'En una página nueva');
    server.online = true;
    await owner.engine.syncNow();
    expect(server.pages.has(page)).toBe(true);
    expect([...server.comments.values()].map((c) => c.page_id)).toEqual([page]);
  });

  it('con la base anterior a la versión 5, espera sin llamar al servidor', async () => {
    const server = new FakeServer();
    server.enableTeam();
    const owner = await device(server);
    const page = await owner.tree.create(null, 'Brief');
    await owner.engine.syncNow();
    await owner.comments.add(page, null, 'Todavía no');
    await owner.engine.syncNow();
    expect(server.commentCalls).toEqual([]);
    expect(owner.engine.getStatus()).toMatchObject({ pendingComments: 1, failedComments: 0 });
    server.enableComments();
    await owner.engine.syncNow();
    expect(server.comments.size).toBe(1);
    expect(owner.engine.getStatus().pendingComments).toBe(0);
  });

  it('valida el texto antes de guardarlo', async () => {
    const { owner, brief } = await workspace();
    await expect(owner.comments.add(brief, BLOCK, '   \n ')).rejects.toBeInstanceOf(CommentInvalid);
    await expect(owner.comments.add(brief, BLOCK, 'x'.repeat(10_001))).rejects.toBeInstanceOf(CommentInvalid);
    await expect(owner.comments.add(brief, 'no válido', 'hola')).rejects.toBeInstanceOf(CommentInvalid);
    expect(owner.comments.status().pending).toBe(0);
  });
});

describe('errores a la vista', () => {
  it('un 500 se reintenta solo, con el error a la vista mientras tanto', async () => {
    const { server, owner, brief } = await workspace();
    server.commentsServerError = true;
    await owner.comments.add(brief, null, 'Hola');
    await owner.engine.syncNow();
    expect(owner.engine.getStatus()).toMatchObject({ pendingComments: 1, failedComments: 0, commentError: 'Internal Server Error' });
    // El resto del ciclo anduvo igual.
    expect(owner.engine.getStatus().lastError).toBeNull();
    server.commentsServerError = false;
    await owner.engine.syncNow();
    expect(owner.engine.getStatus()).toMatchObject({ pendingComments: 0, commentError: null });
  });

  it('un rechazo queda en el dispositivo con su motivo, no frena lo demás y no se descarta solo', async () => {
    const { server, brief, notes } = await workspace();
    server.addMember('cli', 'guest', 'cliente@test');
    server.grant('cli', { pageId: brief }, 'comment');
    server.grant('cli', { pageId: notes }, 'view');
    const cli = await device(server, { id: 'cli' });
    await cli.engine.syncNow();

    const stop = cli.comments.watch(notes);
    // Una versión con permisos viejos (o un cambio de permisos sin red) manda algo que ya no puede.
    const denied = await cli.comments.add(notes, null, 'No debería poder');
    const ok = await cli.comments.add(brief, null, 'Esto sí');
    await cli.engine.syncNow();
    expect(server.comments.has(ok)).toBe(true);
    expect(server.comments.has(denied)).toBe(false);
    expect(cli.engine.getStatus()).toMatchObject({ pendingComments: 0, failedComments: 1 });
    const [thread] = cli.comments.threads(notes);
    expect(thread.root.body).toBe('No debería poder');
    expect(thread.error).toBe('You can view this page but not comment on it.');
    expect(cli.comments.failures()).toEqual([
      expect.objectContaining({ kind: 'add', pageId: notes, body: 'No debería poder' }),
    ]);

    // Varias sincronizaciones después sigue ahí.
    await cli.engine.syncNow();
    await cli.engine.syncNow();
    expect(cli.engine.getStatus().failedComments).toBe(1);
    expect(await unsyncedComments(cli.commentsDb)).toBe(1);

    // Con el permiso arreglado, "Retry" lo sube.
    server.grant('cli', { pageId: notes }, 'comment');
    await cli.engine.retryRejected();
    expect(server.comments.get(denied)?.author_id).toBe('cli');
    expect(cli.engine.getStatus().failedComments).toBe(0);
    stop();
  });

  it('descartar a mano un alta rechazada se lleva lo que depende de ella', async () => {
    const { server, notes } = await workspace();
    server.addMember('cli', 'guest', 'cliente@test');
    server.grant('cli', { pageId: notes }, 'view');
    const cli = await device(server, { id: 'cli' });
    await cli.engine.syncNow();
    const root = await cli.comments.add(notes, null, 'Raíz');
    await cli.comments.add(notes, null, 'Respuesta', root);
    await cli.engine.syncNow();
    expect(cli.engine.getStatus().failedComments).toBe(2);
    const [first] = cli.comments.failures();
    await cli.comments.discard(first.seq);
    expect(cli.comments.status()).toMatchObject({ pending: 0, failed: 0 });
    expect(cli.comments.threads(notes)).toEqual([]);
  });
});

describe('niveles', () => {
  it('ver no comenta; comentar sí, aunque no edite la página', async () => {
    const { server, owner, brief, notes } = await workspace();
    const block = await owner.comments.add(brief, BLOCK, 'Del dueño');
    await owner.engine.syncNow();
    server.addMember('cli', 'guest', 'cliente@test');
    server.grant('cli', { pageId: brief }, 'comment');
    server.grant('cli', { pageId: notes }, 'view');
    const cli = await device(server, { id: 'cli', email: 'cliente@test' });
    await cli.engine.syncNow();

    const p = perms(cli);
    expect(p.pageLevel(notes)).toBeLessThan(LEVEL_COMMENT);
    expect(p.pageLevel(brief)).toBe(LEVEL_COMMENT);
    expect(p.pageLevel(brief)).toBeLessThan(LEVEL_EDIT);
    expect(p.canEditPage(brief)).toBe(false);

    const stop = cli.comments.watch(brief);
    await cli.engine.syncNow();
    const reply = await cli.comments.add(brief, null, 'Respuesta del cliente', block);
    await cli.comments.resolve(brief, block, true);
    await cli.engine.syncNow();
    expect(server.comments.get(reply)).toMatchObject({ author_id: 'cli', thread_id: block, block_id: BLOCK });
    expect(server.comments.get(block)?.resolved_by).toBe('cli');
    expect(cli.engine.getStatus().failedComments).toBe(0);

    // Edita lo suyo, pero no lo ajeno ni lo borra.
    await cli.comments.edit(brief, reply, 'Respuesta corregida');
    await cli.comments.edit(brief, block, 'Cambio ajeno');
    await cli.engine.syncNow();
    await cli.comments.remove(brief, block);
    await cli.engine.syncNow();
    expect(server.comments.get(reply)?.body).toBe('Respuesta corregida');
    expect(server.comments.get(block)).toMatchObject({ body: 'Del dueño', deleted_at: null });
    expect(cli.comments.failures().map((f) => [f.kind, f.error])).toEqual([
      ['edit', 'Only the author can edit this comment.'],
      ['delete', 'Only the author, or someone who can edit and create pages here, can delete this comment.'],
    ]);
    stop();

    // Quien tiene editar y crear páginas borra lo ajeno.
    const ownerStop = owner.comments.watch(brief);
    await owner.comments.remove(brief, reply);
    await owner.engine.syncNow();
    expect(server.comments.get(reply)).toMatchObject({ deleted_by: server.ownerId, body: 'Respuesta corregida' });
    // Los nombres: el correo de quien escribió.
    expect(owner.comments.emailOf('cli')).toBe('cliente@test');
    ownerStop();
  });

  it('un invitado con Comentar contesta una pregunta con un hilo en su bloque', async () => {
    const { server, brief } = await workspace();
    server.addMember('cli', 'guest', 'cliente@test');
    server.grant('cli', { pageId: brief }, 'comment');
    const cli = await device(server, { id: 'cli' });
    await cli.engine.syncNow();
    const question = 'question-block-1';
    const stop = cli.comments.watch(brief);
    await cli.comments.add(brief, question, 'Sí, se filma de noche.');
    await cli.engine.syncNow();
    expect([...server.comments.values()]).toEqual([expect.objectContaining({ block_id: question, author_id: 'cli' })]);
    expect(cli.comments.openCounts(brief).get(question)).toBe(1);
    stop();
  });
});
