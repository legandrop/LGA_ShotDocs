import { afterEach, describe, expect, it } from 'vitest';
import { LEVEL_EDIT, Permissions } from './access';
import { CommentInvalid, LEVEL_COMMENT, unsyncedComments, type CommentThread } from './comments';
import { FakeServer, makeDevice, type Device } from './testing';
import { RemoteError } from './types';

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

  it('la bajada de una página al abrirla que falló y después sale bien limpia su error del estado; el de otra página, no', async () => {
    const { owner, brief, notes } = await workspace();
    const list = owner.remote.listComments.bind(owner.remote);
    owner.remote.listComments = async () => {
      throw new RemoteError('Internal Server Error', false, '500');
    };
    await owner.comments.refresh(brief);
    expect(owner.comments.status().error).toBe('Internal Server Error');
    owner.remote.listComments = list;
    // Otra página que baja bien no limpia un error que no es el suyo.
    await owner.comments.refresh(notes);
    expect(owner.comments.status().error).toBe('Internal Server Error');
    await owner.comments.refresh(brief);
    expect(owner.comments.status().error).toBeNull();
  });

  it('el error que dejó la vuelta de la sincronización al bajar la página abierta lo limpia la bajada de esa página que sale bien', async () => {
    const { server, owner, brief } = await workspace();
    owner.comments.watch(brief);
    await owner.engine.syncNow();
    expect(owner.comments.status().error).toBeNull();
    const list = owner.remote.listComments.bind(owner.remote);
    owner.remote.listComments = async () => {
      throw new RemoteError('Internal Server Error', false, '500');
    };
    // Pasan los 10 segundos y la vuelta (`run`, no `refresh`) baja la página abierta: falla, y el error es de bajada.
    server.clockOffset += 11_000;
    await owner.comments.run(() => false);
    expect(owner.comments.status().error).toBe('Internal Server Error');
    owner.remote.listComments = list;
    await owner.comments.refresh(brief);
    expect(owner.comments.status().error).toBeNull();
  });

  it('la bajada que sale bien no limpia un error que también es el de otra página, ni uno igual que vino de una subida', async () => {
    const { server, owner, brief, notes } = await workspace();
    const list = owner.remote.listComments.bind(owner.remote);
    const down = async () => {
      throw new RemoteError('Internal Server Error', false, '500');
    };
    // Las dos páginas fallan igual: que baje una no limpia el error, que sigue siendo el de la otra.
    owner.remote.listComments = down;
    await owner.comments.refresh(brief);
    await owner.comments.refresh(notes);
    owner.remote.listComments = list;
    await owner.comments.refresh(brief);
    expect(owner.comments.status().error).toBe('Internal Server Error');
    await owner.comments.refresh(notes);
    expect(owner.comments.status().error).toBeNull();
    // Una subida que falla con el mismo texto: la bajada de una página, que falla y después sale bien, no lo limpia.
    server.commentsServerError = true;
    await owner.comments.add(brief, null, 'Hola');
    await owner.comments.run(() => false);
    expect(owner.comments.status()).toMatchObject({ pending: 1, error: 'Internal Server Error' });
    owner.remote.listComments = down;
    await owner.comments.refresh(brief);
    owner.remote.listComments = list;
    await owner.comments.refresh(brief);
    expect(owner.comments.status().error).toBe('Internal Server Error');
    server.commentsServerError = false;
    await owner.comments.run(() => false);
    expect(owner.comments.status()).toMatchObject({ pending: 0, error: null });
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

describe('rechazos que no traban nada (auditoría)', () => {
  /** El dueño y un invitado con Comentar en Brief. */
  async function withGuest() {
    const base = await workspace();
    base.server.addMember('cli', 'guest', 'cliente@test');
    base.server.grant('cli', { pageId: base.brief }, 'comment');
    const cli = await device(base.server, { id: 'cli', email: 'cliente@test' });
    await cli.engine.syncNow();
    return { ...base, cli };
  }

  it('una edición sin red de un comentario que otro borró: se ve borrado, con el motivo y el texto para copiar', async () => {
    const { server, owner, brief, cli } = await withGuest();
    const stopCli = cli.comments.watch(brief);
    const id = await cli.comments.add(brief, BLOCK, 'Original');
    await cli.engine.syncNow();
    const stopOwner = owner.comments.watch(brief);
    await owner.engine.syncNow();
    await owner.comments.remove(brief, id);
    await owner.engine.syncNow();

    server.online = false;
    await cli.comments.edit(brief, id, 'Corregido sin red');
    server.online = true;
    server.clockOffset += 11_000;
    await cli.engine.syncNow();
    expect(cli.engine.getStatus().failedComments).toBe(1);
    const [thread] = cli.comments.threads(brief);
    expect(thread.root).toMatchObject({ deleted: true, error: 'The comment was deleted.', rejectedText: 'Corregido sin red' });
    expect(cli.comments.describeDiscard(thread.root.failedSeqs)).toEqual({
      message: 'Discarding the edit: the comment comes back as it is on the server.',
      text: 'Corregido sin red',
    });
    await cli.comments.discard(thread.root.failedSeqs[0]);
    expect(cli.comments.status().failed).toBe(0);
    expect(cli.comments.threads(brief)).toEqual([]);
    stopCli();
    stopOwner();
  });

  it('un borrado rechazado (not_allowed) no esconde el comentario: se ve con el motivo y se puede descartar', async () => {
    const { owner, brief, cli } = await withGuest();
    const id = await owner.comments.add(brief, BLOCK, 'Del dueño');
    await owner.engine.syncNow();
    const stop = cli.comments.watch(brief);
    await cli.engine.syncNow();
    await cli.comments.remove(brief, id);
    await cli.engine.syncNow();

    const [thread] = cli.comments.threads(brief);
    expect(thread.root).toMatchObject({
      deleted: false,
      body: 'Del dueño',
      error: 'Only the author, or someone who can edit and create pages here, can delete this comment.',
    });
    expect(thread.count).toBe(1);
    expect(cli.comments.describeDiscard(thread.root.failedSeqs).message).toBe('Discarding the delete: the comment comes back.');
    await cli.comments.discard(thread.root.failedSeqs[0]);
    expect(cli.comments.threads(brief)[0].root).toMatchObject({ deleted: false, error: null, pending: false });
    stop();
  });

  it('borrar un comentario propio cuya alta fue rechazada lo saca de la cola sin mandar nada', async () => {
    const { server, notes, cli } = await withGuest().then(async (w) => {
      w.server.grant('cli', { pageId: w.notes }, 'view');
      await w.cli.engine.syncNow();
      return w;
    });
    const stop = cli.comments.watch(notes);
    const root = await cli.comments.add(notes, null, 'No puedo comentar acá');
    await cli.comments.add(notes, null, 'Ni responder', root);
    await cli.engine.syncNow();
    expect(cli.comments.status().failed).toBe(2);
    expect(cli.comments.describeDiscard(cli.comments.failures().map((f) => f.seq).slice(0, 1)).message).toBe(
      'This comment was never uploaded: discarding removes it from this device, and also discards 1 reply to it.',
    );
    const calls = server.commentCalls.length;
    await cli.comments.remove(notes, root);
    await cli.engine.syncNow();
    expect(cli.comments.status()).toMatchObject({ pending: 0, failed: 0 });
    expect(cli.comments.threads(notes)).toEqual([]);
    expect(server.commentCalls.slice(calls).filter((c) => c.startsWith('delete'))).toEqual([]);
    stop();
  });

  it('una página que dejó de estar compartida: el rechazo queda, se puede bajar y descartar, y no corta las demás', async () => {
    const { server, owner, brief, notes, cli } = await withGuest().then(async (w) => {
      w.server.grant('cli', { pageId: w.notes }, 'comment');
      await w.cli.engine.syncNow();
      return w;
    });
    server.listCommentsEnabled = true;
    const stopNotes = cli.comments.watch(notes);
    const stopBrief = cli.comments.watch(brief);
    await cli.engine.syncNow();
    server.online = false;
    await cli.comments.add(notes, null, 'Escrito sin red');
    // Mientras tanto, a la persona le sacan Notes.
    server.grants.splice(server.grants.findIndex((g) => g.user_id === 'cli' && g.page_id === notes), 1);
    server.online = true;
    server.clockOffset += 11_000;
    await cli.engine.syncNow();

    expect(cli.engine.getStatus()).toMatchObject({ failedComments: 1, commentError: null });
    const [failure] = cli.comments.failures();
    expect(failure).toMatchObject({ pageId: notes, body: 'Escrito sin red', error: 'The page is not on the server, or you can no longer see it.' });
    // Se puede bajar (va en el archivo de lo no subido)...
    const { exportComments } = await import('./comments');
    expect(await exportComments(cli.commentsDb)).toEqual([expect.objectContaining({ body: 'Escrito sin red', rejected: failure.error })]);
    // ...y la otra página abierta se sigue bajando.
    await owner.comments.add(brief, null, 'Nuevo en Brief');
    await owner.engine.syncNow();
    server.clockOffset += 11_000;
    await cli.engine.syncNow();
    expect(texts(cli.comments.threads(brief))).toEqual([['Nuevo en Brief']]);

    expect(cli.comments.describeDiscard([failure.seq]).text).toBe('Escrito sin red');
    await cli.comments.discard(failure.seq);
    expect(cli.comments.status().failed).toBe(0);
    stopNotes();
    stopBrief();
  });
});

describe('bajar sin de más (auditoría)', () => {
  it('la página abierta se baja como mucho cada 10 s, solo lo cambiado, y los correos solo si hay alguien nuevo', async () => {
    const { server, owner, brief } = await workspace();
    server.listCommentsEnabled = true;
    server.addMember('ana', 'member', 'ana@test');
    server.grant('ana', { pageId: brief }, 'comment');
    const ana = await device(server, { id: 'ana' });
    await ana.engine.syncNow();
    await ana.comments.add(brief, null, 'De Ana');
    await ana.engine.syncNow();

    const stop = owner.comments.watch(brief);
    await owner.engine.syncNow();
    const first = server.commentCalls.filter((c) => c.startsWith('list') || c === 'authors');
    expect(first).toEqual(['list all', 'authors']);
    expect(owner.comments.emailOf('ana')).toBe('ana@test');

    // Otro ciclo enseguida: no se vuelve a bajar.
    await owner.engine.syncNow();
    await owner.engine.syncNow();
    expect(server.commentCalls.filter((c) => c.startsWith('list')).length).toBe(1);

    // Pasados 10 s, solo lo cambiado desde la última vez; sin autores nuevos, no se piden correos.
    server.clockOffset += 11_000;
    await owner.engine.syncNow();
    const lists = server.commentCalls.filter((c) => c.startsWith('list'));
    expect(lists).toHaveLength(2);
    expect(lists[1]).not.toBe('list all');
    expect(server.commentCalls.filter((c) => c === 'authors')).toHaveLength(1);

    // Si se subió algo de la página, se baja en la misma vuelta.
    await owner.comments.add(brief, null, 'Del dueño');
    await owner.engine.syncNow();
    expect(server.commentCalls.filter((c) => c.startsWith('list'))).toHaveLength(3);
    expect(texts(owner.comments.threads(brief))).toEqual([['De Ana'], ['Del dueño']]);
    stop();
  });

  it('sin list_comments en la base, sigue con la vista entera', async () => {
    const { server, owner, brief } = await workspace();
    await owner.comments.add(brief, null, 'Hola');
    await owner.engine.syncNow();
    const stop = owner.comments.watch(brief);
    await owner.engine.syncNow();
    expect(server.commentCalls.some((c) => c.startsWith('list'))).toBe(false);
    expect(texts(owner.comments.threads(brief))).toEqual([['Hola']]);
    stop();
  });
});

describe('restaurar una copia (auditoría)', () => {
  it('vuelve a subir lo propio comentado después de la copia, con sus ediciones, borrados y resoluciones', async () => {
    const { server, owner, brief } = await workspace();
    server.addMember('ana', 'member', 'ana@test');
    server.grant('ana', { pageId: brief }, 'comment');
    const ana = await device(server, { id: 'ana' });
    await ana.engine.syncNow();
    const anaOld = await ana.comments.add(brief, null, 'De Ana, antes de la copia');
    const before = await owner.comments.add(brief, BLOCK, 'Antes de la copia');
    await ana.engine.syncNow();
    await owner.engine.syncNow();
    const restore = server.backup();

    const stop = owner.comments.watch(brief);
    await owner.engine.syncNow();
    const root = await owner.comments.add(brief, BLOCK, 'Después de la copia');
    const reply = await owner.comments.add(brief, null, 'Respuesta después', root);
    await owner.comments.edit(brief, before, 'Antes, editado después');
    await owner.comments.resolve(brief, root, true);
    await owner.comments.remove(brief, anaOld);
    const anaNew = await ana.comments.add(brief, null, 'De Ana, después');
    await owner.engine.syncNow();
    await ana.engine.syncNow();
    expect(server.comments.size).toBe(5);
    stop();

    restore();
    expect(server.comments.size).toBe(2);
    const again = owner.comments.watch(brief);
    await owner.engine.syncNow();
    expect(owner.engine.getStatus().notice).toMatch(/restored from a backup/);
    expect(server.comments.get(root)).toMatchObject({ body: 'Después de la copia', resolved_by: server.ownerId });
    expect(server.comments.get(reply)).toMatchObject({ thread_id: root, block_id: BLOCK });
    expect(server.comments.get(before)?.body).toBe('Antes, editado después');
    expect(server.comments.get(anaOld)?.deleted_by).toBe(server.ownerId);
    // Lo de Ana lo recupera su dispositivo, no el del dueño.
    expect(server.comments.has(anaNew)).toBe(false);
    expect(owner.engine.getStatus()).toMatchObject({ pendingComments: 0, failedComments: 0 });
    await ana.engine.syncNow();
    expect(server.comments.get(anaNew)?.author_id).toBe('ana');
    again();
  });
});
