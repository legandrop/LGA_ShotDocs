import { afterEach, describe, expect, it } from 'vitest';
import { FakeServer, makeDevice, type Device } from './testing';
import { unsyncedSummary } from './unsynced';

// La papelera de páginas y quién la ve (decisión del 2026-10-02, supabase/migrations/20261009120000_papelera_lectores.sql): Ver,
// Comentar y los invitados no reciben una página en la papelera ni lo que cuelga de ella; quien edita (sin ser
// invitado) y el dueño sí. Lado de la app: la página sale del árbol sin errores, lo propio que faltaba subir no se
// pierde en silencio, y al restaurar todo vuelve.

const devices: Device[] = [];
async function device(server: FakeServer, user?: { id: string }): Promise<Device> {
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

/** Proyecto › A › A1, y B en la raíz, con contenido en A1 y B. */
async function workspace() {
  const server = new FakeServer();
  server.enableTeam();
  server.enableComments();
  const owner = await device(server);
  const a = await owner.tree.create(null, 'A');
  const a1 = await owner.tree.create(a, 'A1');
  const b = await owner.tree.create(null, 'B');
  await owner.engine.syncNow();
  await write(owner, a1, 'nota interna');
  await write(owner, b, 'público');
  await owner.engine.syncNow();
  expect(owner.tree.failedOps()).toEqual([]);
  return { server, owner, pages: { a, a1, b } };
}

async function write(d: Device, pageId: string, text: string): Promise<void> {
  const doc = await d.docs.open(pageId);
  doc.getText('t').insert(0, text);
  await d.docs.flush(pageId);
  d.docs.close(pageId);
}

describe('la papelera para quien solo ve', () => {
  it('Ver: la página y sus hijas salen del árbol sin errores, y vuelven al restaurar', async () => {
    const { server, owner, pages } = await workspace();
    server.addMember('vera', 'member');
    server.grant('vera', { projectId: server.workspaceId }, 'view');
    const vera = await device(server, { id: 'vera' });
    await vera.engine.syncNow();
    expect(vera.tree.get(pages.a1)?.title).toBe('A1');

    await owner.tree.trash(pages.a);
    await owner.engine.syncNow();
    await vera.engine.syncNow();

    expect(vera.tree.get(pages.a)).toBeUndefined();
    expect(vera.tree.get(pages.a1)).toBeUndefined();
    expect(vera.tree.get(pages.b)?.title).toBe('B');
    expect(vera.tree.trashed(server.workspaceId)).toEqual([]);
    const status = vera.engine.getStatus();
    expect(status.lastError).toBeNull();
    expect(status.failedOps).toBe(0);
    expect(status.rejectedPages).toBe(0);
    // El servidor tampoco le da el contenido, aunque lo pida por id.
    await expect(vera.remote.pullUpdates(pages.a1, 0, 100)).rejects.toMatchObject({ message: 'page_not_found' });

    await owner.tree.restore(pages.a);
    await owner.engine.syncNow();
    await vera.engine.syncNow();
    expect(vera.tree.get(pages.a1)?.title).toBe('A1');
    const doc = await vera.docs.open(pages.a1);
    expect(doc.getText('t').toString()).toBe('nota interna');
    vera.docs.close(pages.a1);
  });

  it('Editar (sin ser invitado) y el dueño la siguen viendo en la papelera', async () => {
    const { server, owner, pages } = await workspace();
    server.addMember('edu', 'member');
    server.grant('edu', { projectId: server.workspaceId }, 'edit');
    const edu = await device(server, { id: 'edu' });
    await owner.tree.trash(pages.a);
    await owner.engine.syncNow();
    await edu.engine.syncNow();
    expect(edu.tree.trashed(server.workspaceId).map((p) => p.title)).toEqual(['A']);
    expect(edu.tree.get(pages.a1)?.title).toBe('A1');
    expect(owner.tree.trashed(server.workspaceId).map((p) => p.title)).toEqual(['A']);
    expect(server.pageLevel('edu', pages.a1)).toBe(3);
  });

  it('un invitado con Editar no la ve; lo que escribió sin subir queda en el dispositivo y sube al restaurar', async () => {
    const { server, owner, pages } = await workspace();
    server.addMember('gina', 'guest');
    server.grant('gina', { projectId: server.workspaceId }, 'edit');
    const gina = await device(server, { id: 'gina' });
    await gina.engine.syncNow();
    await write(gina, pages.a1, 'del cliente ');

    // El dueño manda A a la papelera antes de que la invitada suba.
    await owner.tree.trash(pages.a);
    await owner.engine.syncNow();
    const before = server.updates.get(pages.a1)?.length ?? 0;
    await gina.engine.syncNow();

    expect(gina.tree.get(pages.a1)).toBeUndefined();
    expect(server.updates.get(pages.a1)?.length ?? 0).toBe(before);
    // No se pierde en silencio: queda rechazado, a la vista y en lo que se puede bajar como archivo.
    expect(gina.engine.getStatus().rejectedPages).toBe(1);
    expect((await unsyncedSummary(gina.db, gina.mediaDb)).pages).toBeGreaterThanOrEqual(1);

    await owner.tree.restore(pages.a);
    await owner.engine.syncNow();
    await gina.engine.retryRejected();
    await gina.engine.syncNow();
    expect(gina.engine.getStatus().rejectedPages).toBe(0);
    expect(server.updates.get(pages.a1)!.length).toBe(before + 1);
    await owner.engine.syncNow();
    const doc = await owner.docs.open(pages.a1);
    expect(doc.getText('t').toString()).toContain('del cliente');
    expect(doc.getText('t').toString()).toContain('nota interna');
    owner.docs.close(pages.a1);
  });

  it('Comentar: un comentario sin subir de una página que se fue a la papelera queda rechazado con su texto', async () => {
    const { server, owner, pages } = await workspace();
    server.addMember('coco', 'member');
    server.grant('coco', { pageId: pages.a }, 'comment');
    const coco = await device(server, { id: 'coco' });
    await coco.engine.syncNow();
    await coco.comments.add(pages.a1, null, '¿Esto va al cliente?');

    await owner.tree.trash(pages.a);
    await owner.engine.syncNow();
    await coco.engine.syncNow();

    expect(coco.tree.get(pages.a1)).toBeUndefined();
    expect(coco.engine.getStatus().lastError).toBeNull();
    expect(coco.comments.status()).toMatchObject({ pending: 0, failed: 1 });
    expect(coco.comments.failures()).toEqual([
      expect.objectContaining({ kind: 'add', pageId: pages.a1, body: '¿Esto va al cliente?', error: expect.stringContaining('can no longer see') }),
    ]);

    // Restaurada, se reintenta y llega.
    await owner.tree.restore(pages.a);
    await owner.engine.syncNow();
    await coco.comments.retryFailed();
    await coco.engine.syncNow();
    expect(coco.comments.status()).toMatchObject({ pending: 0, failed: 0 });
    expect([...server.comments.values()].filter((c) => c.page_id === pages.a1).map((c) => c.body)).toEqual(['¿Esto va al cliente?']);
  });

  it('un invitado con Editar y crear páginas manda una página a la papelera y deja de verla, sin errores', async () => {
    const { server, pages } = await workspace();
    server.addMember('gus', 'guest');
    server.grant('gus', { projectId: server.workspaceId }, 'edit_pages');
    const gus = await device(server, { id: 'gus' });
    await gus.engine.syncNow();
    await gus.tree.trash(pages.b);
    await gus.engine.syncNow();
    expect(server.pages.get(pages.b)?.deleted_at).not.toBeNull();
    expect(gus.tree.failedOps()).toEqual([]);
    expect(gus.tree.get(pages.b)).toBeUndefined();
    expect(gus.engine.getStatus().lastError).toBeNull();
  });
});

