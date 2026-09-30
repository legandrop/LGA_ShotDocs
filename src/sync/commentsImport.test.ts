import { afterEach, describe, expect, it } from 'vitest';
import type { ImportedComment } from './comments';
import { FakeServer, makeDevice, type Device } from './testing';

// Comentarios importados de otra herramienta (Doc_Importar_Coda.md, "3. Comentarios"), del lado de la cola: la
// fecha original, el autor de afuera sin cuenta, lo propio a nombre de quien importa, esperar a que la página
// suba, reintentos sin duplicar y la base sin la función. El servidor en memoria sigue las reglas de
// supabase/migrations/20260930200000_comentarios_importados.sql. Nombres y correos inventados.

const devices: Device[] = [];
async function device(server: FakeServer, user?: { id: string; email?: string }): Promise<Device> {
  const d = await makeDevice(server, undefined, undefined, undefined, undefined, user ?? {});
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

const ROOT = '6f1c2a3b-0000-4000-8000-000000000001';
const REPLY = '6f1c2a3b-0000-4000-8000-000000000002';
const OTHER = '6f1c2a3b-0000-4000-8000-000000000003';
const BLOCK = 'b1d2c3e4-0000-4000-8000-000000000001';

function thread(pageId: string): ImportedComment[] {
  return [
    {
      id: ROOT,
      pageId,
      blockId: BLOCK,
      threadId: null,
      body: 'Es de noche.\n',
      createdAt: '2026-01-01T10:00:00.250Z',
      resolvedAt: '2026-01-01T10:30:00.000Z',
      source: 'coda',
      authorName: 'Persona Externa',
      authorEmail: 'Ext@Test.Invalid',
    },
    {
      id: REPLY,
      pageId,
      blockId: null,
      threadId: ROOT,
      body: 'Ok, anotado.',
      createdAt: '2026-01-01T10:30:00.000Z',
      resolvedAt: null,
      source: 'coda',
      authorName: null,
      authorEmail: null,
    },
  ];
}

async function workspace() {
  const server = new FakeServer();
  server.enableImportedComments();
  const owner = await device(server);
  const page = await owner.tree.create(null, 'Escena');
  await owner.engine.syncNow();
  return { server, owner, page };
}

describe('comentarios importados', () => {
  it('suben con la fecha original, el autor de afuera sin cuenta y lo propio a nombre de quien importa', async () => {
    const { server, owner, page } = await workspace();
    const stop = owner.comments.watch(page);
    expect(await owner.comments.importComments(thread(page))).toBe(2);

    // Antes de subir ya se ven, con su autor y su fecha.
    let [t] = owner.comments.threads(page);
    expect(t.root).toMatchObject({ importedAuthor: 'Persona Externa', importedFrom: 'coda', authorId: null, createdAt: '2026-01-01T10:00:00.250Z', pending: true });
    expect(t.resolved).toBe(true);
    expect(t.replies[0]).toMatchObject({ authorId: server.ownerId, importedAuthor: null, importedFrom: 'coda' });

    await owner.engine.syncNow();
    expect(server.comments.get(ROOT)).toMatchObject({
      author_id: null,
      imported_author: 'Persona Externa',
      imported_author_email: 'ext@test.invalid',
      imported_from: 'coda',
      imported_by: server.ownerId,
      created_at: '2026-01-01T10:00:00.250Z',
      resolved_at: '2026-01-01T10:30:00.000Z',
      resolved_by: null,
      block_id: BLOCK,
      body: 'Es de noche.',
    });
    expect(server.comments.get(REPLY)).toMatchObject({ author_id: server.ownerId, imported_author: null, block_id: BLOCK, thread_id: ROOT });
    expect(owner.engine.getStatus().pendingComments).toBe(0);
    [t] = owner.comments.threads(page);
    expect(t.root).toMatchObject({ importedAuthor: 'Persona Externa', importedAuthorEmail: 'ext@test.invalid', pending: false });
    stop();

    // Otra persona los baja con el autor de afuera y su correo.
    server.addMember('ana', 'member', 'ana@test');
    server.grant('ana', { pageId: page }, 'view');
    const ana = await device(server, { id: 'ana' });
    await ana.engine.syncNow();
    const stopAna = ana.comments.watch(page);
    await ana.engine.syncNow();
    [t] = ana.comments.threads(page);
    stopAna();
    expect(t.root).toMatchObject({ importedAuthor: 'Persona Externa', importedAuthorEmail: 'ext@test.invalid', authorId: null });
    expect(t.replies[0].authorId).toBe(server.ownerId);
  });

  it('esperan a que su página suba, y ponerlos de nuevo en la cola (una importación que se sigue) no duplica', async () => {
    const { server, owner } = await workspace();
    server.online = false;
    const page = await owner.tree.create(null, 'Sin red');
    await owner.comments.importComments(thread(page));
    await owner.comments.importComments(thread(page));
    expect(owner.engine.getStatus().pendingComments).toBe(2);
    server.online = true;
    await owner.engine.syncNow();
    await owner.engine.syncNow();
    expect([...server.comments.keys()].sort()).toEqual([ROOT, REPLY]);
    // Ya subidos: volver a importarlos no cambia nada en el servidor.
    await owner.comments.importComments(thread(page));
    await owner.engine.syncNow();
    expect(server.comments.size).toBe(2);
    expect(owner.engine.getStatus().pendingComments).toBe(0);
    expect(owner.engine.getStatus().failedComments).toBe(0);
  });

  it('una respuesta perdida se reintenta con el mismo id y no duplica', async () => {
    const { server, owner, page } = await workspace();
    server.loseCommentResponse.add('import');
    await owner.comments.importComments(thread(page));
    await owner.engine.syncNow();
    await owner.engine.syncNow();
    expect(server.comments.size).toBe(2);
    expect(owner.engine.getStatus().pendingComments).toBe(0);
    expect(owner.engine.getStatus().failedComments).toBe(0);
  });

  it('un texto vacío no entra (ni sus respuestas); uno demasiado largo se corta', async () => {
    const { server, owner, page } = await workspace();
    const [root, reply] = thread(page);
    const n = await owner.comments.importComments([
      { ...root, body: '  \n ' },
      reply,
      { ...root, id: OTHER, body: 'x'.repeat(12000), resolvedAt: null },
    ]);
    expect(n).toBe(1);
    await owner.engine.syncNow();
    expect([...server.comments.keys()]).toEqual([OTHER]);
    expect(server.comments.get(OTHER)!.body).toHaveLength(10000);
  });

  it('con la base sin import_comment, queda rechazado a la vista y se reintenta después de migrar', async () => {
    const { server, owner, page } = await workspace();
    server.importCommentsEnabled = false;
    await owner.comments.importComments(thread(page));
    await owner.engine.syncNow();
    expect(server.comments.size).toBe(0);
    expect(owner.engine.getStatus().failedComments).toBe(2);
    expect(owner.comments.failures().map((f) => f.kind)).toEqual(['import', 'import']);

    server.importCommentsEnabled = true;
    await owner.comments.retryFailed();
    await owner.engine.syncNow();
    expect(server.comments.size).toBe(2);
    expect(owner.engine.getStatus().failedComments).toBe(0);
  });

  it('pide editar la página: con comentar queda rechazado con su motivo', async () => {
    const { server, page } = await workspace();
    server.addMember('ana', 'member', 'ana@test');
    server.grant('ana', { pageId: page }, 'comment');
    const ana = await device(server, { id: 'ana' });
    await ana.engine.syncNow();
    await ana.comments.importComments(thread(page));
    await ana.engine.syncNow();
    expect(server.comments.size).toBe(0);
    expect(ana.comments.failures()[0].error).toContain('edit');
  });

  it('el autor de afuera no se edita (la base lo rechaza); quien importó edita lo suyo, y quien tiene editar y crear borra el de afuera', async () => {
    const { server, owner, page } = await workspace();
    await owner.comments.importComments(thread(page));
    await owner.engine.syncNow();
    await owner.comments.edit(page, ROOT, 'Otro texto');
    await owner.engine.syncNow();
    expect(server.comments.get(ROOT)!.body).toBe('Es de noche.');
    expect(owner.comments.failures().map((f) => f.kind)).toEqual(['edit']);
    await owner.comments.discard(owner.comments.failures()[0].seq);
    await owner.comments.edit(page, REPLY, 'Ok, anotado (editado).');
    await owner.engine.syncNow();
    expect(server.comments.get(REPLY)!.body).toBe('Ok, anotado (editado).');
    // La dueña tiene editar y crear páginas: borra el de afuera (queda marcado, con el texto en la base).
    await owner.comments.remove(page, ROOT);
    await owner.engine.syncNow();
    expect(server.comments.get(ROOT)).toMatchObject({ deleted_by: server.ownerId, body: 'Es de noche.' });
  });

  it('restaurar una copia de antes de importar: lo importado vuelve desde el dispositivo, con su autor y resuelto', async () => {
    const { server, owner, page } = await workspace();
    const restore = server.backup();
    const stop = owner.comments.watch(page);
    await owner.comments.importComments(thread(page));
    await owner.engine.syncNow();
    await owner.engine.syncNow();
    expect(server.comments.size).toBe(2);
    restore();
    expect(server.comments.size).toBe(0);
    await owner.engine.syncNow();
    await owner.engine.syncNow();
    stop();
    expect(owner.engine.getStatus().notice).toMatch(/restored from a backup/);
    expect(server.comments.get(ROOT)).toMatchObject({
      author_id: null,
      imported_author: 'Persona Externa',
      imported_author_email: 'ext@test.invalid',
      created_at: '2026-01-01T10:00:00.250Z',
      resolved_at: '2026-01-01T10:30:00.000Z',
    });
    expect(server.comments.get(REPLY)).toMatchObject({ author_id: server.ownerId, thread_id: ROOT, imported_from: 'coda' });
    expect(owner.engine.getStatus()).toMatchObject({ pendingComments: 0, failedComments: 0 });
  });

  it('si una versión vieja de la app los saca de la cola sin mandarlos, vuelven al abrir y suben', async () => {
    const { server, owner, page } = await workspace();
    server.online = false;
    await owner.comments.importComments(thread(page));
    // Lo que hace la versión vieja: los da por subidos y los borra de la cola (sin tocar `meta`).
    await owner.commentsDb.clear('outbox');
    await owner.comments.load();
    expect(owner.comments.status().pending).toBe(2);
    server.online = true;
    await owner.engine.syncNow();
    await owner.engine.syncNow();
    expect([...server.comments.keys()].sort()).toEqual([ROOT, REPLY]);
    // Confirmados: el respaldo se olvida y abrir de nuevo no los vuelve a poner.
    expect((await owner.commentsDb.getAllKeys('meta')).filter((k) => String(k).startsWith('import:'))).toEqual([]);
    await owner.comments.load();
    expect(owner.comments.status().pending).toBe(0);
  });

  it('un importado de afuera que se borra antes de subir no vuelve al abrir', async () => {
    const { server, owner, page } = await workspace();
    server.online = false;
    const [root] = thread(page);
    await owner.comments.importComments([{ ...root, resolvedAt: null }]);
    await owner.comments.remove(page, ROOT);
    await owner.comments.load();
    server.online = true;
    await owner.engine.syncNow();
    expect(server.comments.size).toBe(0);
    expect(owner.comments.status().pending).toBe(0);
  });
});
