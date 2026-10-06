import { afterEach, describe, expect, it } from 'vitest';
import { CommentQueue, commentsDbName, openCommentsDb, type MentionRef } from './comments';
import * as Comments098 from './fixtures/v098/comments';
import { MentionsInbox } from './mentions';
import { toRemoteError } from './remote';
import { FakeRemote, FakeServer, makeDevice, type Device } from './testing';
import { RemoteError } from './types';

// Menciones en comentarios (P.21, entrega 1; Docs/Doc_Menciones.md): la operación `mentions` en la cola (detrás del
// alta, junta con la anterior sin mandar, reintentos, descartes, una versión vieja que la saca de la cola) y la
// campana (el número con tope, lo guardado sin red, leídas, lo que deja de verse). El servidor en memoria sigue las
// reglas de supabase/migrations/20261015120000_menciones.sql (las de permisos están probadas en
// supabase/tests/menciones_permisos.sql).

const ANA = '00000000-0000-4000-8000-0000000000a1';
const BETO = '00000000-0000-4000-8000-0000000000a2';
const CLIENTA = '00000000-0000-4000-8000-0000000000a3';
const NADIE = '00000000-0000-4000-8000-0000000000a4';
const CLIENTA2 = '00000000-0000-4000-8000-0000000000a5';

const devices: Device[] = [];
async function device(server: FakeServer, user?: { id: string }, dbName?: string): Promise<Device> {
  const d = await makeDevice(server, dbName, undefined, undefined, undefined, user ?? {});
  devices.push(d);
  return d;
}

afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.mentions.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
});

/** Un workspace con menciones (base en la versión 15): Ana y Beto (equipo) comentan en Brief; una clienta lo ve. */
async function workspace(options: { mentions?: boolean } = {}) {
  const server = new FakeServer();
  if (options.mentions === false) server.enableImportedComments();
  else server.enableMentions();
  server.addMember(ANA, 'member', 'ana@wanka.tv');
  server.addMember(BETO, 'member', 'beto@wanka.tv');
  server.addMember(CLIENTA, 'guest', 'clienta@cliente.com');
  server.addMember(NADIE, 'member', 'nadie@wanka.tv');
  const owner = await device(server);
  const brief = await owner.tree.create(null, 'Brief');
  const notes = await owner.tree.create(null, 'Notes');
  await owner.engine.syncNow();
  server.grant(ANA, { pageId: brief }, 'comment');
  server.grant(BETO, { pageId: brief }, 'comment');
  server.grant(CLIENTA, { pageId: brief }, 'comment');
  const ana = await device(server, { id: ANA });
  await ana.engine.syncNow();
  return { server, owner, ana, brief, notes };
}

/** Le saca a alguien su permiso sobre la página: deja de verla. */
function ungrant(server: FakeServer, userId: string, pageId: string): void {
  const at = server.grants.findIndex((g) => g.user_id === userId && g.page_id === pageId);
  if (at >= 0) server.grants.splice(at, 1);
}

const beto: MentionRef = { userId: BETO, label: 'beto' };
const nadie: MentionRef = { userId: NADIE, label: 'nadie' };

async function inboxOf(server: FakeServer, id: string): Promise<Device> {
  const d = await device(server, { id });
  await d.engine.syncNow();
  await d.mentions.poll();
  return d;
}

describe('la cola', () => {
  it('las menciones salen detrás del alta, cuentan como pendientes y llegan a la campana de la mencionada', async () => {
    const { server, ana, brief } = await workspace();
    server.online = false;
    const stop = ana.comments.watch(brief);
    const id = await ana.comments.add(brief, null, '@beto fijate la toma 12', null, [beto]);
    await ana.engine.syncNow();
    expect(ana.engine.getStatus().pendingComments).toBe(2);
    expect(ana.comments.threads(brief)[0].root.mentions).toEqual([beto]);

    server.online = true;
    await ana.engine.syncNow();
    expect(server.commentCalls.filter((c) => c.startsWith('add') || c.startsWith('set_'))).toEqual([`add ${id}`, `set_comment_mentions ${id}`]);
    expect(server.mentions).toMatchObject([{ comment_id: id, user_id: BETO, mentioned_by: ANA, label: 'beto' }]);
    expect(ana.engine.getStatus().pendingComments).toBe(0);
    expect(ana.comments.threads(brief)[0].root).toMatchObject({ mentions: [beto], unnotified: [], pending: false });
    stop();

    const b = await inboxOf(server, BETO);
    const snap = b.mentions.getSnapshot();
    expect(snap).toMatchObject({ ready: true, unread: 1 });
    expect(snap.items[0]).toMatchObject({ commentId: id, pageId: brief, snippet: '@beto fijate la toma 12', pageTitle: 'Brief', label: 'beto', mentionedByEmail: 'ana@wanka.tv', read: false });
    expect(b.mentions.unreadOn(brief)).toBe(true);
  });

  it('unas menciones sin mandar se juntan con las nuevas (queda la última) y una edición con las mismas no manda nada', async () => {
    const { server, ana, brief } = await workspace();
    server.online = false;
    const id = await ana.comments.add(brief, null, '@beto y @nadie', null, [beto, nadie]);
    await ana.comments.edit(brief, id, '@beto solo', [beto]);
    await ana.engine.syncNow();
    expect(ana.engine.getStatus().pendingComments).toBe(2); // el alta (con el texto nuevo) y unas menciones
    server.online = true;
    await ana.engine.syncNow();
    expect(server.commentCalls.filter((c) => c.startsWith('set_comment_mentions'))).toHaveLength(1);
    expect(server.mentions.map((m) => m.user_id)).toEqual([BETO]);

    const stop = ana.comments.watch(brief);
    await ana.engine.syncNow();
    await ana.comments.edit(brief, id, '@beto solo, editado', [beto]);
    await ana.engine.syncNow();
    expect(server.commentCalls.filter((c) => c.startsWith('set_comment_mentions'))).toHaveLength(1);
    stop();
  });

  it('una respuesta perdida se reintenta sin duplicar; sacar a alguien al editar lo marca sacado', async () => {
    const { server, ana, brief } = await workspace();
    server.loseCommentResponse.add('mentions');
    const stop = ana.comments.watch(brief);
    const id = await ana.comments.add(brief, null, '@beto', null, [beto]);
    await ana.engine.syncNow();
    expect(ana.engine.getStatus().pendingComments).toBe(1);
    await ana.engine.syncNow();
    expect(ana.engine.getStatus().pendingComments).toBe(0);
    expect(server.mentions).toHaveLength(1);

    await ana.comments.edit(brief, id, 'sin nadie', []);
    await ana.engine.syncNow();
    expect(server.mentions[0].removed_at).not.toBeNull();
    expect(ana.comments.threads(brief)[0].root.mentions).toEqual([]);
    stop();
  });

  it('a quien la base no avisó lo ve solo quien escribió, sin error ni rechazo', async () => {
    const { owner, ana, brief } = await workspace();
    const stop = ana.comments.watch(brief);
    // Nadie no ve Brief: la base lo descarta.
    const id = await ana.comments.add(brief, null, '@beto y @nadie', null, [beto, nadie]);
    await ana.engine.syncNow();
    expect(ana.engine.getStatus()).toMatchObject({ pendingComments: 0, failedComments: 0 });
    expect(ana.comments.threads(brief)[0].root).toMatchObject({ mentions: [beto], unnotified: ['nadie'] });
    stop();
    // Queda en `meta` (se ve también después de volver a abrir la app).
    expect(await ana.commentsDb.get('meta', `unnotified:${id}`)).toEqual(['nadie']);
    // La dueña ve la mención de Beto pero no el aviso de "no se avisó".
    const s2 = owner.comments.watch(brief);
    await owner.engine.syncNow();
    expect(owner.comments.threads(brief).find((t) => t.id === id)?.root).toMatchObject({ mentions: [beto], unnotified: [] });
    s2();
  });

  it('borrar un comentario sin subir se lleva sus menciones y su copia en meta', async () => {
    const { server, ana, brief } = await workspace();
    server.online = false;
    const id = await ana.comments.add(brief, null, '@beto', null, [beto]);
    expect(await ana.commentsDb.get('meta', `mentions:${id}`)).toBeTruthy();
    await ana.comments.remove(brief, id);
    expect(await ana.commentsDb.count('outbox')).toBe(0);
    expect(await ana.commentsDb.get('meta', `mentions:${id}`)).toBeUndefined();
    server.online = true;
    await ana.engine.syncNow();
    expect(server.commentCalls.some((c) => c.startsWith('set_comment_mentions'))).toBe(false);
  });

  it('comment_deleted y comment_not_found sobre unas menciones se descartan en silencio', async () => {
    const { server, owner, ana, brief } = await workspace();
    // El alta llega pero su respuesta se pierde: las menciones quedan en la cola.
    server.loseCommentResponse.add('add');
    const id = await ana.comments.add(brief, null, '@beto', null, [beto]);
    await ana.engine.syncNow();
    expect(server.comments.has(id)).toBe(true);
    expect(ana.engine.getStatus().pendingComments).toBe(2);
    // Mientras tanto, la dueña lo borra.
    const stop = owner.comments.watch(brief);
    await owner.engine.syncNow();
    await owner.comments.remove(brief, id);
    stop();
    await owner.engine.syncNow();
    expect(server.comments.get(id)?.deleted_at).not.toBeNull();
    await ana.engine.syncNow();
    expect(ana.engine.getStatus()).toMatchObject({ pendingComments: 0, failedComments: 0 });
    expect(await ana.commentsDb.get('meta', `mentions:${id}`)).toBeUndefined();
    expect(server.mentions).toHaveLength(0);
  });

  it('las menciones de una edición hecha mientras la página no se ve no se olvidan: quedan con la edición y salen cuando la página vuelve', async () => {
    const { server, owner, ana, brief } = await workspace();
    const stop = ana.comments.watch(brief);
    const id = await ana.comments.add(brief, null, 'fijate la toma 12');
    await ana.engine.syncNow();
    // Le sacan la página: la base contesta `comment_not_found` por la edición y también por las menciones.
    ungrant(server, ANA, brief);
    await ana.comments.edit(brief, id, '@beto fijate la toma 12', [beto]);
    await ana.engine.syncNow();
    expect(ana.comments.failures().map((f) => f.kind)).toEqual(['edit', 'mentions']);
    expect(ana.engine.getStatus()).toMatchObject({ failedComments: 2, pendingComments: 0 });
    // Siguen en el dispositivo: en la cola y en su copia.
    expect(await ana.commentsDb.count('outbox')).toBe(2);
    expect(await ana.commentsDb.get('meta', `mentions:${id}`)).toBeTruthy();
    expect(server.mentions).toHaveLength(0);
    // Mientras no la vea, no se vuelve a pedir nada.
    const calls = server.commentCalls.length;
    await ana.engine.syncNow();
    expect(server.commentCalls.filter((c) => c.startsWith('set_') || c.startsWith('edit')).length).toBe(
      server.commentCalls.slice(0, calls).filter((c) => c.startsWith('set_') || c.startsWith('edit')).length,
    );

    // Vuelve a verla: salen la edición y, detrás, las menciones. Beto se entera.
    server.grant(ANA, { pageId: brief }, 'comment');
    await ana.engine.syncNow();
    expect(ana.engine.getStatus()).toMatchObject({ failedComments: 0, pendingComments: 0 });
    expect(server.comments.get(id)?.body).toBe('@beto fijate la toma 12');
    expect(server.mentions).toMatchObject([{ comment_id: id, user_id: BETO, label: 'beto' }]);
    expect(await ana.commentsDb.get('meta', `mentions:${id}`)).toBeUndefined();
    stop();
    const s2 = owner.comments.watch(brief);
    await owner.engine.syncNow();
    expect(owner.comments.threads(brief)[0].root).toMatchObject({ body: '@beto fijate la toma 12', mentions: [beto] });
    s2();
    const b = await inboxOf(server, BETO);
    expect(b.mentions.getSnapshot()).toMatchObject({ unread: 1 });
  });

  it('unas menciones que salen solas mientras la página no se ve (la edición ya había entrado) quedan a la vista y salen con Retry', async () => {
    const { server, ana, brief } = await workspace();
    const id = await ana.comments.add(brief, null, 'fijate la toma 12');
    await ana.engine.syncNow();
    // La edición entra y, antes de que salgan las menciones, le sacan la página.
    const edit = ana.remote.editComment.bind(ana.remote);
    ana.remote.editComment = async (commentId, body) => {
      await edit(commentId, body);
      ungrant(server, ANA, brief);
    };
    await ana.comments.edit(brief, id, '@beto fijate la toma 12', [beto]);
    await ana.engine.syncNow();
    expect(server.comments.get(id)?.body).toBe('@beto fijate la toma 12');
    expect(ana.comments.failures()).toMatchObject([{ kind: 'mentions', pageId: brief }]);
    expect(await ana.commentsDb.get('meta', `mentions:${id}`)).toBeTruthy();
    expect(server.mentions).toHaveLength(0);

    server.grant(ANA, { pageId: brief }, 'comment');
    await ana.comments.retryFailed();
    await ana.engine.syncNow();
    expect(ana.engine.getStatus()).toMatchObject({ failedComments: 0, pendingComments: 0 });
    expect(server.mentions).toMatchObject([{ comment_id: id, user_id: BETO }]);
  });

  it('si el comentario no está en la base y su página se ve, las menciones se descartan en silencio: lo dice la lista de la página', async () => {
    const { server, ana, brief } = await workspace();
    const id = await ana.comments.add(brief, null, '@beto', null, [beto]);
    // El alta llega y su respuesta se pierde; después la fila desaparece de la base (no hay nada que arreglar a mano).
    server.loseCommentResponse.add('add');
    await ana.engine.syncNow();
    expect(ana.engine.getStatus().pendingComments).toBe(2);
    const row = server.comments.get(id)!;
    server.comments.delete(id);
    // El alta vuelve a entrar (es idempotente) y la fila se va otra vez antes de las menciones.
    const add = ana.remote.addComment.bind(ana.remote);
    ana.remote.addComment = async (c) => {
      server.comments.set(id, row);
      await add(c);
      server.comments.delete(id);
    };
    await ana.engine.syncNow();
    expect(server.commentCalls.filter((c) => c.startsWith('set_comment_mentions'))).toHaveLength(1);
    expect(server.commentCalls).toContain('list all');
    expect(ana.engine.getStatus()).toMatchObject({ pendingComments: 0, failedComments: 0 });
    expect(await ana.commentsDb.get('meta', `mentions:${id}`)).toBeUndefined();
  });

  it('si la página volvió a verse entre el rechazo y la pregunta, las menciones se mandan otra vez y entran', async () => {
    const { server, ana, brief } = await workspace();
    const id = await ana.comments.add(brief, null, 'fijate la toma 12');
    await ana.engine.syncNow();
    // La primera vez, la base contesta que no existe (como PostgREST: 500 con `P0002`); la página ya se ve de nuevo.
    const set = ana.remote.setCommentMentions.bind(ana.remote);
    let refused = 0;
    ana.remote.setCommentMentions = async (commentId, mentions) => {
      if (refused++ === 0) throw toRemoteError({ message: 'comment_not_found', code: 'P0002' }, 500);
      return set(commentId, mentions);
    };
    await ana.comments.edit(brief, id, '@beto fijate la toma 12', [beto]);
    await ana.engine.syncNow();
    expect(refused).toBe(2);
    expect(server.mentions).toMatchObject([{ comment_id: id, user_id: BETO }]);
    expect(ana.engine.getStatus()).toMatchObject({ failedComments: 0, pendingComments: 0 });
  });

  it('si no se puede preguntar por la página (una falla pasajera), las menciones esperan en la cola sin rechazo ni olvido', async () => {
    const { server, ana, brief } = await workspace();
    const id = await ana.comments.add(brief, null, 'fijate la toma 12');
    await ana.engine.syncNow();
    const edit = ana.remote.editComment.bind(ana.remote);
    ana.remote.editComment = async (commentId, body) => {
      await edit(commentId, body);
      ungrant(server, ANA, brief);
    };
    const list = ana.remote.listComments.bind(ana.remote);
    ana.remote.listComments = async () => {
      throw new RemoteError('Internal Server Error', false, '500');
    };
    await ana.comments.edit(brief, id, '@beto fijate la toma 12', [beto]);
    await ana.engine.syncNow();
    expect(ana.engine.getStatus()).toMatchObject({ failedComments: 0, pendingComments: 1 });
    expect(await ana.commentsDb.get('meta', `mentions:${id}`)).toBeTruthy();

    ana.remote.listComments = list;
    server.grant(ANA, { pageId: brief }, 'comment');
    await ana.engine.syncNow();
    expect(server.mentions).toMatchObject([{ comment_id: id, user_id: BETO }]);
    expect(ana.engine.getStatus()).toMatchObject({ failedComments: 0, pendingComments: 0 });
  });

  it('una mención que la persona sacó en una edición posterior no revive cuando vuelve la página', async () => {
    const { server, ana, brief } = await workspace();
    const stop = ana.comments.watch(brief);
    const id = await ana.comments.add(brief, null, 'fijate la toma 12');
    await ana.engine.syncNow();
    // Con la página sin verse: una edición nombra a Beto y queda rechazada, con sus menciones.
    ungrant(server, ANA, brief);
    await ana.comments.edit(brief, id, '@beto fijate la toma 12', [beto]);
    await ana.engine.syncNow();
    expect(ana.comments.failures().map((f) => f.kind)).toEqual(['edit', 'mentions']);
    // La edición siguiente lo saca: las menciones rechazadas salen de la cola, con su copia.
    await ana.comments.edit(brief, id, 'fijate la toma 12, de noche', []);
    expect(ana.comments.failures().map((f) => f.kind)).toEqual(['edit']);
    expect(await ana.commentsDb.get('meta', `mentions:${id}`)).toBeUndefined();
    expect(ana.comments.threads(brief)[0].root.mentions).toEqual([]);
    await ana.engine.syncNow();
    const sets = () => server.commentCalls.filter((c) => c.startsWith('set_comment_mentions')).length;
    const asked = sets();

    // Vuelve la página: queda el texto de la última edición y nadie nombrado. A Beto no le llega nada.
    server.grant(ANA, { pageId: brief }, 'comment');
    await ana.engine.syncNow();
    expect(ana.engine.getStatus()).toMatchObject({ failedComments: 0, pendingComments: 0 });
    expect(server.comments.get(id)?.body).toBe('fijate la toma 12, de noche');
    expect(server.mentions.filter((m) => !m.removed_at)).toEqual([]);
    expect(sets()).toBe(asked);
    stop();
    const b = await inboxOf(server, BETO);
    expect(b.mentions.getSnapshot()).toMatchObject({ unread: 0 });
    // Sin copia guardada, al abrir la app de nuevo tampoco vuelven a la cola.
    expect(await ana.commentsDb.get('meta', `mentions:${id}`)).toBeUndefined();
    expect(await ana.commentsDb.count('outbox')).toBe(0);
  });

  it('una mención que la persona sacó y volvió a poner sigue puesta cuando vuelve la página', async () => {
    const { server, ana, brief } = await workspace();
    const stop = ana.comments.watch(brief);
    const id = await ana.comments.add(brief, null, '@beto fijate la toma 12', null, [beto]);
    await ana.engine.syncNow();
    expect(server.mentions.filter((m) => !m.removed_at)).toMatchObject([{ user_id: BETO }]);
    ungrant(server, ANA, brief);
    // La saca (rechazado) y después la vuelve a poner: lo que vale es lo último.
    await ana.comments.edit(brief, id, 'fijate la toma 12', []);
    await ana.engine.syncNow();
    expect(ana.comments.failures().map((f) => f.kind)).toEqual(['edit', 'mentions']);
    await ana.comments.edit(brief, id, '@beto fijate la toma 12, de noche', [beto]);
    expect(ana.comments.failures().map((f) => f.kind)).toEqual(['edit']);
    await ana.engine.syncNow();

    server.grant(ANA, { pageId: brief }, 'comment');
    await ana.engine.syncNow();
    expect(ana.engine.getStatus()).toMatchObject({ failedComments: 0, pendingComments: 0 });
    expect(server.comments.get(id)?.body).toBe('@beto fijate la toma 12, de noche');
    expect(server.mentions.filter((m) => !m.removed_at)).toMatchObject([{ comment_id: id, user_id: BETO }]);
    stop();
  });

  it('al sacar unas menciones rechazadas, la copia guardada pasa a ser la de las que siguen esperando', async () => {
    const { server, ana, brief } = await workspace();
    const stop = ana.comments.watch(brief);
    const id = await ana.comments.add(brief, null, 'fijate la toma 12');
    await ana.engine.syncNow();
    server.online = false;
    // Una cola de una versión anterior: unas menciones que esperan y, detrás, otras rechazadas con su copia guardada.
    const at = new Date().toISOString();
    const waiting = { kind: 'mentions' as const, id, pageId: brief, mentions: [beto], at };
    const rejected = { kind: 'mentions' as const, id, pageId: brief, mentions: [nadie], at };
    await ana.commentsDb.add('outbox', { op: waiting, attempted: true, failed: false, error: null, queuedAt: 1 });
    await ana.commentsDb.add('outbox', { op: rejected, attempted: true, failed: true, error: 'comment_denied', queuedAt: 2 });
    await ana.commentsDb.put('meta', rejected, `mentions:${id}`);
    await ana.comments.load();
    // Una edición con el conjunto que ya espera: no entra nada nuevo, y lo rechazado sale.
    await ana.comments.edit(brief, id, '@beto fijate la toma 12', [beto]);
    const queued = (await ana.commentsDb.getAll('outbox')).filter((e) => e.op.kind === 'mentions');
    expect(queued).toMatchObject([{ failed: false, op: { mentions: [beto] } }]);
    expect(await ana.commentsDb.get('meta', `mentions:${id}`)).toMatchObject({ mentions: [beto] });
    server.online = true;
    await ana.engine.syncNow();
    expect(server.mentions.filter((m) => !m.removed_at)).toMatchObject([{ comment_id: id, user_id: BETO }]);
    expect(await ana.commentsDb.get('meta', `mentions:${id}`)).toBeUndefined();
    stop();
  });

  it('si la base sigue contestando que el comentario no existe aunque la lista lo trae, las menciones se piden dos veces y quedan rechazadas', async () => {
    const { ana, brief } = await workspace();
    const id = await ana.comments.add(brief, null, 'fijate la toma 12');
    await ana.engine.syncNow();
    let asked = 0;
    ana.remote.setCommentMentions = async () => {
      asked++;
      throw toRemoteError({ message: 'comment_not_found', code: 'P0002' }, 500);
    };
    await ana.comments.edit(brief, id, '@beto fijate la toma 12', [beto]);
    await ana.engine.syncNow();
    // El pedido, la pregunta por la página (que trae el comentario) y un solo pedido más.
    expect(asked).toBe(2);
    expect(ana.comments.failures()).toMatchObject([{ kind: 'mentions', pageId: brief }]);
    expect(ana.engine.getStatus()).toMatchObject({ failedComments: 1, pendingComments: 0 });
    expect(await ana.commentsDb.get('meta', `mentions:${id}`)).toBeTruthy();
    // Rechazadas, no se vuelven a pedir solas.
    for (let i = 0; i < 3; i++) await ana.engine.syncNow();
    expect(asked).toBe(2);
  });

  it('varias menciones de páginas que no se ven cuestan una sola pregunta por página en cada pasada', async () => {
    const { server, ana, brief, notes } = await workspace();
    server.grant(ANA, { pageId: notes }, 'comment');
    await ana.engine.syncNow();
    const ids: [string, string][] = [];
    for (const pageId of [brief, brief, brief, notes, notes]) ids.push([pageId, await ana.comments.add(pageId, null, 'fijate la toma 12')]);
    await ana.engine.syncNow();
    ungrant(server, ANA, brief);
    ungrant(server, ANA, notes);
    for (const [pageId, id] of ids) await ana.comments.edit(pageId, id, '@beto fijate la toma 12', [beto]);
    const lists = () => server.commentCalls.filter((c) => c === 'list all').length;
    const sets = () => server.commentCalls.filter((c) => c.startsWith('set_comment_mentions')).length;
    const before = lists();
    await ana.engine.syncNow();
    expect(sets()).toBe(5);
    expect(lists() - before).toBe(2);
    expect(ana.engine.getStatus()).toMatchObject({ failedComments: 10, pendingComments: 0 });
    // Otra pasada (Retry): otra vez una por página, no una por mención.
    await ana.comments.retryFailed();
    await ana.engine.syncNow();
    expect(sets()).toBe(10);
    expect(lists() - before).toBe(4);
    expect(ana.engine.getStatus()).toMatchObject({ failedComments: 10, pendingComments: 0 });
  });

  it('la confirmación de unas menciones no borra la copia en meta de otras más nuevas del mismo comentario (O3)', async () => {
    const { server, ana, brief } = await workspace();
    server.addMember(CLIENTA2, 'member', 'carla@wanka.tv');
    server.grant(CLIENTA2, { pageId: brief }, 'comment');
    const stop = ana.comments.watch(brief);
    // La respuesta de las primeras menciones se pierde: quedan en la cola, ya intentadas.
    server.loseCommentResponse.add('mentions');
    const id = await ana.comments.add(brief, null, '@beto', null, [beto]);
    await ana.engine.syncNow();
    // Una edición suma a Carla: unas menciones nuevas, con su copia en meta.
    await ana.comments.edit(brief, id, '@beto y @carla', [beto, { userId: CLIENTA2, label: 'carla' }]);
    // Se confirman las primeras y la edición falla (pasajero): las nuevas no salen en esta vuelta.
    server.failCommentOnce.add('edit');
    await ana.engine.syncNow();
    const copy = (await ana.commentsDb.get('meta', `mentions:${id}`)) as { mentions: MentionRef[] } | undefined;
    expect(copy?.mentions.map((m) => m.label)).toEqual(['beto', 'carla']);
    await ana.engine.syncNow();
    expect(server.mentions.filter((m) => !m.removed_at).map((m) => m.user_id).sort()).toEqual([BETO, CLIENTA2].sort());
    expect(await ana.commentsDb.get('meta', `mentions:${id}`)).toBeUndefined();
    stop();
  });

  it('PGRST202 con la base en la versión 15 es pasajero: las menciones esperan y salen cuando la API ve la función (O4)', async () => {
    const { server, ana, brief } = await workspace();
    // La base ya dice 15 pero la API todavía no recargó su caché.
    server.mentionsEnabled = false;
    await ana.comments.add(brief, null, '@beto', null, [beto]);
    await ana.engine.syncNow();
    expect(ana.engine.getStatus()).toMatchObject({ pendingComments: 1, failedComments: 0 });
    server.mentionsEnabled = true;
    await ana.engine.syncNow();
    expect(ana.engine.getStatus()).toMatchObject({ pendingComments: 0, failedComments: 0 });
    expect(server.mentions).toMatchObject([{ user_id: BETO }]);
  });

  it('las menciones de un alta rechazada esperan con ella y salen al reintentar', async () => {
    const { server, ana, brief } = await workspace();
    // Ana pierde Comentar: el alta se rechaza (comment_denied) y queda a la vista.
    server.grant(ANA, { pageId: brief }, 'view');
    const id = await ana.comments.add(brief, null, '@beto', null, [beto]);
    await ana.engine.syncNow();
    expect(ana.engine.getStatus()).toMatchObject({ failedComments: 1, pendingComments: 1 });
    expect(server.commentCalls.some((c) => c.startsWith('set_comment_mentions'))).toBe(false);
    server.grant(ANA, { pageId: brief }, 'comment');
    await ana.comments.retryFailed();
    await ana.engine.syncNow();
    expect(ana.engine.getStatus()).toMatchObject({ failedComments: 0, pendingComments: 0 });
    expect(server.mentions).toMatchObject([{ comment_id: id, user_id: BETO }]);
  });

  it('con la base sin migrar (versión 14) el @ es texto: no sale ninguna operación ni pregunta la campana', async () => {
    const { server, ana, brief } = await workspace({ mentions: false });
    expect(ana.comments.mentionsReady).toBe(false);
    const id = await ana.comments.add(brief, null, '@beto', null, [beto]);
    await ana.engine.syncNow();
    expect(server.comments.get(id)?.body).toBe('@beto');
    expect(server.commentCalls.some((c) => c.startsWith('set_comment_mentions'))).toBe(false);
    await ana.mentions.poll();
    expect(ana.mentions.getSnapshot().ready).toBe(false);
    expect(server.commentCalls.some((c) => c.startsWith('mentions_inbox'))).toBe(false);
  });

  it('una versión vieja (v0.098) que toma la cola saca las menciones sin mandarlas: la nueva las recupera de meta', async () => {
    const { server, brief } = await workspace();
    const dbName = `menciones-${crypto.randomUUID()}`;
    const remote = new FakeRemote(server, '0.120', ANA);
    // La versión de hoy escribe sin red.
    let db = await openCommentsDb(commentsDbName(dbName));
    let queue = new CommentQueue(db, remote, ANA);
    await queue.load();
    queue.configure(15, 1);
    const id = await queue.add(brief, null, '@beto mirá', null, [beto]);
    queue.stop();
    db.close();

    // La v0.098 abre la misma base con red: sube el alta y da por subidas las menciones (no las conoce).
    const old = new FakeRemote(server, '0.098', ANA);
    const db098 = await Comments098.openCommentsDb(Comments098.commentsDbName(dbName));
    const v098 = new Comments098.CommentQueue(db098 as never, old as never, ANA);
    await v098.load();
    v098.configure(15, 1);
    await v098.run();
    expect(v098.status()).toMatchObject({ pending: 0, failed: 0 });
    expect(server.comments.get(id)?.body).toBe('@beto mirá');
    expect(server.mentions).toHaveLength(0);
    v098.stop();
    db098.close();

    // La de hoy vuelve a abrir: las menciones vuelven a la cola desde `meta` y suben.
    db = await openCommentsDb(commentsDbName(dbName));
    queue = new CommentQueue(db, remote, ANA);
    await queue.load();
    queue.configure(15, 1);
    expect(queue.status().pending).toBe(1);
    await queue.run();
    expect(server.mentions).toMatchObject([{ comment_id: id, user_id: BETO }]);
    expect(await db.get('meta', `mentions:${id}`)).toBeUndefined();
    queue.stop();
    db.close();

    // Abrir otra vez no las vuelve a poner (ya bajaron o ya se confirmaron).
    db = await openCommentsDb(commentsDbName(dbName));
    queue = new CommentQueue(db, remote, ANA);
    await queue.load();
    expect(queue.status().pending).toBe(0);
    queue.stop();
    db.close();
  });
});

describe('la campana', () => {
  it('cuenta hasta 10, guarda la lista para verla sin red y no vuelve a bajar los textos al abrirla', async () => {
    const { server, ana, brief } = await workspace();
    for (let i = 0; i < 12; i++) await ana.comments.add(brief, null, `@beto ${i}`, null, [beto]);
    await ana.engine.syncNow();
    const name = crypto.randomUUID();
    const b = await device(server, { id: BETO }, name);
    await b.engine.syncNow();
    await b.mentions.poll();
    expect(b.mentions.getSnapshot()).toMatchObject({ unread: 10 });
    expect(b.mentions.getSnapshot().items).toHaveLength(12);

    // Abrir la campana sin novedades: pide lo cambiado (con fecha) y el índice, no la lista entera.
    server.commentCalls.length = 0;
    await b.mentions.open();
    expect(server.commentCalls).toEqual(['mentions_inbox', 'mentions_index']);

    // Sin red, la app vuelta a abrir muestra lo guardado.
    b.engine.stop();
    b.mentions.stop();
    b.db.close();
    b.mediaDb.close();
    b.commentsDb.close();
    devices.splice(devices.indexOf(b), 1);
    server.online = false;
    const again = await device(server, { id: BETO }, name);
    expect(again.mentions.getSnapshot()).toMatchObject({ unread: 10, loaded: true });
    expect(again.mentions.getSnapshot().items).toHaveLength(12);
    expect(again.mentions.getSnapshot().checkedAt).not.toBeNull();
  });

  it('leer sin red se guarda en el dispositivo, no cuenta como cambio sin subir y sale al volver la red', async () => {
    const { server, ana, brief } = await workspace();
    await ana.comments.add(brief, null, '@beto uno', null, [beto]);
    await ana.comments.add(brief, null, '@beto dos', null, [beto]);
    await ana.engine.syncNow();
    const b = await inboxOf(server, BETO);
    const [first] = b.mentions.getSnapshot().items;
    server.online = false;
    await b.mentions.markRead([first.id]);
    expect(b.mentions.getSnapshot().unread).toBe(1);
    await b.engine.syncNow();
    expect(b.engine.getStatus().pendingComments).toBe(0);
    expect(server.mentions.filter((m) => m.read_at)).toHaveLength(0);

    await b.mentions.markAllRead();
    expect(b.mentions.getSnapshot().unread).toBe(0);
    server.online = true;
    await b.mentions.poll();
    expect(server.mentions.every((m) => m.read_at)).toBe(true);
    expect(await b.commentsDb.get('meta', 'inbox:read')).toBeUndefined();
    expect(b.mentions.getSnapshot().unread).toBe(0);
  });

  it('ver los hilos en el panel marca leídas las de esos hilos', async () => {
    const { server, ana, brief, notes } = await workspace();
    server.grant(BETO, { pageId: notes }, 'view');
    const stop = ana.comments.watch(brief);
    const t1 = await ana.comments.add(brief, null, '@beto hilo', null, [beto]);
    await ana.engine.syncNow();
    await ana.comments.add(brief, null, '@beto respuesta', t1, [beto]);
    await ana.engine.syncNow();
    const b = await inboxOf(server, BETO);
    expect(b.mentions.getSnapshot().unread).toBe(2);
    await b.mentions.markThreadsRead(notes, new Set([t1]));
    expect(b.mentions.getSnapshot().unread).toBe(2);
    await b.mentions.markThreadsRead(brief, new Set([t1]));
    expect(b.mentions.getSnapshot().unread).toBe(0);
    expect(server.mentions.every((m) => m.read_at)).toBe(true);
    stop();
  });

  it('lo que deja de verse sale de la lista sin mostrar el texto (el índice concilia)', async () => {
    const { server, ana, brief, notes } = await workspace();
    server.grant(ANA, { pageId: notes }, 'comment');
    const notesGrant = server.grant(BETO, { pageId: notes }, 'view');
    await ana.engine.syncNow();
    await ana.comments.add(notes, null, '@beto secreto', null, [beto]);
    await ana.engine.syncNow();
    // Pasa el tiempo y llega otra, más nueva: la vieja ya no entra en el margen de cada pregunta.
    for (let i = 0; i < 30; i++) server.commentNow();
    await ana.comments.add(brief, null, '@beto otra', null, [beto]);
    await ana.engine.syncNow();
    const b = await inboxOf(server, BETO);
    expect(b.mentions.getSnapshot().items).toHaveLength(2);
    // Le sacan Notes a Beto: la fila de esa mención no cambia, pero el número de la base sí (1 contra 2).
    server.grants.splice(server.grants.findIndex((g) => g.id === notesGrant), 1);
    server.commentCalls.length = 0;
    await b.mentions.poll();
    expect(server.commentCalls).toContain('mentions_index');
    expect(b.mentions.getSnapshot()).toMatchObject({ unread: 1 });
    expect(b.mentions.getSnapshot().items.map((m) => m.snippet)).toEqual(['@beto otra']);
  });

  it('una mención sacada del comentario llega gone y sale de la lista', async () => {
    const { server, ana, brief } = await workspace();
    const stop = ana.comments.watch(brief);
    const id = await ana.comments.add(brief, null, '@beto', null, [beto]);
    await ana.engine.syncNow();
    const b = await inboxOf(server, BETO);
    expect(b.mentions.getSnapshot().items).toHaveLength(1);
    await ana.comments.edit(brief, id, 'ya no', []);
    await ana.engine.syncNow();
    await b.mentions.poll();
    expect(b.mentions.getSnapshot().items).toHaveLength(0);
    stop();
  });

  it('a quien sacan del workspace la campana le queda vacía', async () => {
    const { server, ana, brief } = await workspace();
    await ana.comments.add(brief, null, '@beto', null, [beto]);
    await ana.engine.syncNow();
    const b = await inboxOf(server, BETO);
    server.members.get(BETO)!.removed_at = new Date().toISOString();
    await b.mentions.poll();
    expect(b.mentions.getSnapshot()).toMatchObject({ unread: 0, items: [] });
  });
});

describe('la lista del @', () => {
  it('pide la lista con red, la guarda y la usa sin red; sin lista guardada, los autores conocidos', async () => {
    const { server, ana, brief, notes } = await workspace();
    const fallback = () => [{ userId: 'x', email: 'x@y', label: 'x' }];
    // La primera vez, sin lista guardada: lo de respaldo; al abrir el campo la pide.
    expect(ana.mentions.candidatesFor(brief, fallback)).toEqual(fallback());
    await ana.mentions.refreshIfStale(brief);
    const list = ana.mentions.candidatesFor(brief, fallback);
    // Ana (miembro) ve a la dueña y a Beto; la clienta no comentó y Nadie no ve la página.
    expect(list.map((c) => c.email).sort()).toEqual(['beto@wanka.tv', 'owner@test']);
    expect(list.find((c) => c.userId === BETO)?.label).toBe('beto');

    server.online = false;
    expect(ana.mentions.candidatesFor(brief, fallback).map((c) => c.userId).sort()).toEqual([BETO, server.ownerId].sort());
    expect(ana.mentions.candidatesFor(notes, fallback)).toEqual(fallback());
  });

  it('una invitada ve solo a quienes participan y a quien le compartió', async () => {
    const { server, ana, brief } = await workspace();
    server.grants.find((g) => g.user_id === CLIENTA)!.granted_by = BETO;
    await ana.comments.add(brief, null, 'hola');
    await ana.engine.syncNow();
    const c = await device(server, { id: CLIENTA });
    await c.engine.syncNow();
    const list = await c.remote.mentionCandidates(brief);
    expect(list.map((x) => x.userId).sort()).toEqual([ANA, BETO].sort());
  });
});

describe('MentionsInbox sin base del dispositivo', () => {
  it('anda en memoria (la base de comentarios no se pudo abrir)', async () => {
    const { server, ana, brief } = await workspace();
    await ana.comments.add(brief, null, '@beto', null, [beto]);
    await ana.engine.syncNow();
    const b = await device(server, { id: BETO });
    await b.engine.syncNow();
    const inbox = new MentionsInbox(null, b.remote, b.comments);
    await inbox.load();
    await inbox.poll();
    expect(inbox.getSnapshot().unread).toBe(1);
    inbox.stop();
  });
});
