import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeRemote, FakeServer, makeDevice, type Device } from '../sync/testing';
import { autoPurgeFiles, MEDIA_SCHEME, mediaIdOf } from './queue';
import { emptyFileTrash, loadFileTrash, sendToDriveTrash, type TrashOutcome } from './fileTrash';
import { mediaIdsInDoc } from './usage';
import { DELETED_LABEL } from './probe';

// Papelera de archivos (paso 11 de Docs/Plan_Workspaces.md): qué archivos usa cada página, la pestaña
// Archivos de la papelera y el borrado automático, armado y apagado. Con el servidor y el portero en memoria
// (src/sync/testing.ts), que siguen las reglas de supabase/migrations/20260930180000_papelera_archivos.sql.

const MB = 1024 * 1024;
const DAY = 86_400_000;
const devices: Device[] = [];

async function device(server: FakeServer, dbName?: string, user: { id?: string } = {}): Promise<Device> {
  const d = await makeDevice(server, dbName, '0.021', {}, undefined, user);
  devices.push(d);
  return d;
}

async function close(d: Device): Promise<void> {
  d.engine.stop();
  await d.engine.syncMedia();
  await d.docs.flush();
  d.db.close();
  d.mediaDb.close();
  d.commentsDb.close();
  devices.splice(devices.indexOf(d), 1);
}

afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
});

function photo(name = 'IMG_0001.JPG'): File {
  return new File([new Uint8Array(MB).fill(7)], name, { type: 'image/jpeg' });
}

/** El ciclo de siempre y la cola de archivos, dos veces (como en queue.test.ts). */
async function sync(d: Device): Promise<void> {
  await d.engine.syncNow();
  await d.engine.syncMedia();
  await d.engine.syncNow();
  await d.engine.syncMedia();
}

/** Agrega un bloque `image` con `sdmedia://<id>` al final de la página, como lo deja el editor. */
function insertImage(doc: Y.Doc, fileId: string): void {
  const fragment = doc.getXmlFragment(CONTENT_FRAGMENT);
  doc.transact(() => {
    if (fragment.length === 0) fragment.insert(0, [new Y.XmlElement('blockGroup')]);
    const group = fragment.get(0) as Y.XmlElement;
    const container = new Y.XmlElement('blockContainer');
    container.setAttribute('id', crypto.randomUUID());
    const image = new Y.XmlElement('image');
    image.setAttribute('url', MEDIA_SCHEME + fileId);
    container.insert(0, [image]);
    group.insert(group.length, [container]);
  });
}

/** Borra el bloque del archivo (como borrarlo o cortarlo en el editor). */
function removeImage(doc: Y.Doc, fileId: string): void {
  const group = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
  const at = group
    .toArray()
    .findIndex((c) => ((c as Y.XmlElement).get(0) as Y.XmlElement | undefined)?.getAttribute('url') === MEDIA_SCHEME + fileId);
  if (at >= 0) group.delete(at, 1);
}

/** Abre la página, hace el cambio y la cierra (lo guarda en el dispositivo). */
async function edit(d: Device, pageId: string, change: (doc: Y.Doc) => void): Promise<void> {
  const doc = await d.docs.open(pageId);
  change(doc);
  d.docs.close(pageId);
  await d.docs.flush();
}

/** Un proyecto con una página y una foto subida y usada en ella, desde el dispositivo del dueño. */
async function withPhoto(server: FakeServer): Promise<{ a: Device; page: string; id: string }> {
  server.enableTrash();
  const a = await device(server);
  await sync(a);
  const page = await a.tree.create(null, 'Día 1');
  await sync(a);
  const id = mediaIdOf(await a.media.add(page, photo()))!;
  await edit(a, page, (doc) => insertImage(doc, id));
  await sync(a);
  expect(server.pageFiles.has(`${page}:${id}`)).toBe(true);
  expect(server.mediaFiles.get(id)).toMatchObject({ trashed_at: null });
  return { a, page, id };
}

const calls = (server: FakeServer, name: string) => server.mediaCalls.filter((c) => c.startsWith(name));

describe('papelera de archivos: qué archivos usa cada página', () => {
  it('lee los sdmedia:// de cualquier bloque del documento', () => {
    const doc = new Y.Doc();
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    insertImage(doc, a);
    insertImage(doc, b);
    // Un bloque que esta versión no conoce, con una dirección: cuenta igual.
    const group = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
    const other = new Y.XmlElement('futureVideo');
    other.setAttribute('url', MEDIA_SCHEME + a.toUpperCase());
    group.insert(0, [other]);
    expect(mediaIdsInDoc(doc)).toEqual(new Set([a, b]));
  });

  it('quitar el bloque manda unlink_page_file y el archivo entra a la papelera; deshacer lo reactiva', async () => {
    const server = new FakeServer();
    const { a, page, id } = await withPhoto(server);

    const doc = await a.docs.open(page);
    const undo = new Y.UndoManager(doc.getXmlFragment(CONTENT_FRAGMENT));
    removeImage(doc, id);
    await a.docs.flush();
    await sync(a);
    expect(calls(server, 'unlink_page_file')).toEqual([`unlink_page_file ${page} ${id}`]);
    expect(server.pageFiles.has(`${page}:${id}`)).toBe(false);
    expect(server.removedPageFiles.has(`${page}:${id}`)).toBe(true);
    expect(server.mediaFiles.get(id)?.trashed_at).toBeTruthy();

    undo.undo();
    await a.docs.flush();
    await sync(a);
    expect(calls(server, 'link_page_file')).toEqual([`link_page_file ${page} ${id}`]);
    expect(server.pageFiles.has(`${page}:${id}`)).toBe(true);
    expect(server.mediaFiles.get(id)?.trashed_at).toBeNull();
    a.docs.close(page);

    // Sincronizar de nuevo no manda nada más.
    await sync(a);
    expect(calls(server, 'unlink_page_file')).toHaveLength(1);
    expect(calls(server, 'link_page_file')).toHaveLength(1);
    expect(a.engine.getStatus().pendingMedia).toBe(0);
  });

  it('borrar y deshacer antes de sincronizar no manda nada', async () => {
    const server = new FakeServer();
    const { a, page, id } = await withPhoto(server);
    const doc = await a.docs.open(page);
    const undo = new Y.UndoManager(doc.getXmlFragment(CONTENT_FRAGMENT));
    removeImage(doc, id);
    undo.undo();
    a.docs.close(page);
    await sync(a);
    expect(calls(server, 'unlink_page_file')).toEqual([]);
    expect(calls(server, 'link_page_file')).toEqual([]);
    expect(server.mediaFiles.get(id)?.trashed_at).toBeNull();
  });

  it('un deshacer que llega mientras viaja el unlink no se pisa: después se reactiva', async () => {
    const server = new FakeServer();
    const { a, page, id } = await withPhoto(server);
    await a.media.reconcilePage(page, new Set(), { unlink: true });
    // Mientras el pedido viaja, el editor vuelve a tener el archivo (deshacer).
    const original = a.remote.unlinkPageFile.bind(a.remote);
    a.remote.unlinkPageFile = async (p, f) => {
      await original(p, f);
      await a.media.ensureLinks(page, [id]);
    };
    await a.engine.syncMedia();
    expect(server.pageFiles.has(`${page}:${id}`)).toBe(false);
    expect(await a.mediaDb.get('links', `${page}:${id}`)).toMatchObject({ pending: 1, removed: false });

    await a.engine.syncMedia();
    expect(server.pageFiles.has(`${page}:${id}`)).toBe(true);
    expect(server.mediaFiles.get(id)?.trashed_at).toBeNull();
    expect(await a.mediaDb.get('links', `${page}:${id}`)).toMatchObject({ pending: 0, removed: false });
  });

  it('un archivo cortado de una página y pegado en otra: primero el link, después el unlink', async () => {
    const server = new FakeServer();
    const { a, page, id } = await withPhoto(server);
    const other = await a.tree.create(null, 'Día 2');
    await sync(a);
    await edit(a, page, (doc) => removeImage(doc, id));
    await edit(a, other, (doc) => insertImage(doc, id));
    await sync(a);
    const order = server.mediaCalls.filter((c) => c.includes('link_page_file'));
    expect(order).toEqual([`link_page_file ${other} ${id}`, `unlink_page_file ${page} ${id}`]);
    expect(server.mediaFiles.get(id)?.trashed_at).toBeNull();
  });

  it('una página a medio bajar nunca quita: solo con el documento completo y al día', async () => {
    const server = new FakeServer();
    const { a, page, id } = await withPhoto(server);
    const b = await device(server);
    await sync(b);
    expect(await b.mediaDb.get('links', `${page}:${id}`)).toMatchObject({ removed: false });

    // En `a` se borra la foto y se escribe algo más; `b` no puede bajar la página (se corta a la mitad) y en
    // su dispositivo el documento queda sin la foto por otro camino (un documento a medio armar).
    await edit(a, page, (doc) => removeImage(doc, id));
    a.engine.stop();
    await a.docs.pushPage(page, a.remote);
    const pull = b.remote.pullUpdates.bind(b.remote);
    b.remote.pullUpdates = async () => {
      throw new Error('Failed to fetch');
    };
    // Un documento local distinto del servidor: sin la foto, y con el cursor atrasado.
    const state = (await b.docs.states()).get(page)!;
    expect(server.pages.get(page)!.update_seq).toBeGreaterThan(state.cursor);
    await b.media.setUsageMarks({ [page]: 'nada' });
    await b.engine.syncNow();
    await b.engine.syncMedia();
    expect(calls(server, 'unlink_page_file')).toEqual([]);
    expect(await b.mediaDb.get('links', `${page}:${id}`)).toMatchObject({ removed: false });

    // Con el documento completo, se quita (una sola vez, aunque dos dispositivos lo vean).
    b.remote.pullUpdates = pull;
    await sync(b);
    expect(calls(server, 'unlink_page_file')).toEqual([`unlink_page_file ${page} ${id}`]);
    expect(server.mediaFiles.get(id)?.trashed_at).toBeTruthy();
  });

  it('con un documento que el servidor rechazó (sin subir) no quita nada', async () => {
    const server = new FakeServer();
    const { a, page, id } = await withPhoto(server);
    server.maxUpdateBytes = 1;
    await edit(a, page, (doc) => removeImage(doc, id));
    await sync(a);
    expect(a.engine.getStatus().rejectedPages).toBe(1);
    expect(calls(server, 'unlink_page_file')).toEqual([]);
    expect(server.mediaFiles.get(id)?.trashed_at).toBeNull();

    server.maxUpdateBytes = 8 * MB;
    await a.engine.retryRejected();
    await sync(a);
    expect(calls(server, 'unlink_page_file')).toHaveLength(1);
  });

  it('sin red: el cambio queda en el dispositivo, sobrevive a cerrar la app y se manda al volver', async () => {
    const server = new FakeServer();
    const dbName = crypto.randomUUID();
    server.enableTrash();
    let a = await device(server, dbName);
    const page = await a.tree.create(null, 'Rodaje');
    await sync(a);
    const id = mediaIdOf(await a.media.add(page, photo()))!;
    await edit(a, page, (doc) => insertImage(doc, id));
    await sync(a);

    server.online = false;
    await edit(a, page, (doc) => removeImage(doc, id));
    await sync(a);
    await close(a);
    a = await device(server, dbName);
    await sync(a);
    expect(calls(server, 'unlink_page_file')).toEqual([]);

    server.online = true;
    await sync(a);
    expect(calls(server, 'unlink_page_file')).toEqual([`unlink_page_file ${page} ${id}`]);
    expect(server.mediaFiles.get(id)?.trashed_at).toBeTruthy();
  });

  it('lo que ya está en la cola sin red se guarda en el dispositivo y es idempotente', async () => {
    const server = new FakeServer();
    const dbName = crypto.randomUUID();
    server.enableTrash();
    let a = await device(server, dbName);
    const page = await a.tree.create(null, 'Rodaje');
    await sync(a);
    const id = mediaIdOf(await a.media.add(page, photo()))!;
    await edit(a, page, (doc) => insertImage(doc, id));
    await sync(a);

    server.online = false;
    expect(await a.media.reconcilePage(page, new Set(), { unlink: true })).toBe(true);
    await a.engine.syncMedia();
    await a.engine.syncNow();
    expect(a.engine.getStatus().pendingMedia).toBe(1);
    await close(a);

    a = await device(server, dbName);
    server.online = true;
    // La respuesta se pierde: se repite sin cambiar nada.
    server.loseMediaResponse.add('unlink_page_file');
    await a.engine.syncMedia();
    await a.engine.syncMedia();
    expect(calls(server, 'unlink_page_file')).toHaveLength(2);
    expect(server.removedPageFiles.has(`${page}:${id}`)).toBe(true);
    await a.engine.syncNow();
    expect(a.engine.getStatus().pendingMedia).toBe(0);
  });

  it('con la base anterior a la papelera no manda unlink_page_file', async () => {
    const server = new FakeServer();
    const { a, page, id } = await withPhoto(server);
    server.settings = { ...server.settings!, schemaVersion: 5 };
    await edit(a, page, (doc) => removeImage(doc, id));
    await sync(a);
    expect(calls(server, 'unlink_page_file')).toEqual([]);
    expect(a.engine.getStatus().pendingMedia).toBe(0);
  });
});

describe('papelera de archivos: la pestaña', () => {
  /** Dueño, un admin con "View", un miembro con "Edit & create pages", uno con "Edit" y un invitado. */
  function team(server: FakeServer, page: string) {
    server.addMember('admin-1', 'admin');
    server.grant('admin-1', { projectId: server.workspaceId }, 'view');
    server.addMember('lead-1', 'member');
    server.grant('lead-1', { projectId: server.workspaceId }, 'edit_pages');
    server.addMember('editor-1', 'member');
    server.grant('editor-1', { projectId: server.workspaceId }, 'edit');
    server.addMember('guest-1', 'guest');
    server.grant('guest-1', { pageId: page }, 'edit_pages');
  }

  it('la ven el dueño, los admins y quien tiene "Edit & create pages" en el proyecto; el resto no', async () => {
    const server = new FakeServer();
    const { a, page, id } = await withPhoto(server);
    team(server, page);
    await edit(a, page, (doc) => removeImage(doc, id));
    await sync(a);

    const trashOf = (uid: string) => loadFileTrash(new FakeRemote(server, '', uid), server.workspaceId);
    const mine = await trashOf(server.ownerId);
    expect(mine).toHaveLength(1);
    expect(mine![0]).toMatchObject({ id, name: 'IMG_0001.JPG', mime: 'image/jpeg', size: MB, days_left: 30, purged_at: null });
    expect(mine![0].thumb_at).toBeTruthy();
    expect(await trashOf('admin-1')).toHaveLength(1);
    expect(await trashOf('lead-1')).toHaveLength(1);
    expect(await trashOf('editor-1')).toBeNull();
    expect(await trashOf('guest-1')).toBeNull();
    // Sin red no se esconde: tira, y la pestaña lo muestra.
    server.online = false;
    await expect(trashOf(server.ownerId)).rejects.toThrow(/Failed to fetch/);
  });

  it('mandar a la papelera de Drive: solo dueño y admins, y un 409 si una página lo volvió a usar', async () => {
    const server = new FakeServer();
    const { a, page, id } = await withPhoto(server);
    team(server, page);
    // Todavía en uso: 409.
    expect(await sendToDriveTrash((f) => a.media.trash(f), id)).toMatchObject({ status: 'in_use' });

    await edit(a, page, (doc) => removeImage(doc, id));
    await sync(a);
    const lead = await device(server, undefined, { id: 'lead-1' });
    await sync(lead);
    const denied = await sendToDriveTrash((f) => lead.media.trash(f), id);
    expect(denied).toMatchObject({ status: 'error' });
    expect((denied as { message: string }).message).toMatch(/owner or an admin/);
    expect(server.mediaFiles.get(id)?.purged_at ?? null).toBeNull();

    const admin = await device(server, undefined, { id: 'admin-1' });
    await sync(admin);
    expect(await sendToDriveTrash((f) => admin.media.trash(f), id)).toEqual({ status: 'done' });
    const row = server.mediaFiles.get(id)!;
    expect(row.purged_at).toBeTruthy();
    expect(row.drive_trashed_at).toBeTruthy();
    expect(server.portero.driveTrash.has(row.drive_id!)).toBe(true);
    // Nada se borra: la fila sigue, el archivo sigue en Drive (en su papelera).
    expect(server.portero.drive.has(row.drive_id!)).toBe(true);
    expect(await loadFileTrash(admin.remote, server.workspaceId)).toEqual([]);
  });

  it('"Empty" manda de a uno, avisa el avance y sigue si uno falla en el medio', async () => {
    const server = new FakeServer();
    const { a, page, id } = await withPhoto(server);
    const second = mediaIdOf(await a.media.add(page, photo('IMG_0002.JPG')))!;
    const third = mediaIdOf(await a.media.add(page, photo('IMG_0003.JPG')))!;
    await edit(a, page, (doc) => {
      insertImage(doc, second);
      insertImage(doc, third);
    });
    await sync(a);
    await edit(a, page, (doc) => {
      removeImage(doc, id);
      removeImage(doc, second);
      removeImage(doc, third);
    });
    await sync(a);
    const listed = (await loadFileTrash(a.remote, server.workspaceId))!;
    expect(listed.map((f) => f.id).sort()).toEqual([id, second, third].sort());

    server.portero.failTrash.add(second);
    const progress: [number, number, string, TrashOutcome['status']][] = [];
    const ids = [id, second, third];
    const results = await emptyFileTrash(
      (f) => a.media.trash(f),
      ids,
      (done, total, fileId, outcome) => progress.push([done, total, fileId, outcome.status]),
    );
    expect(progress).toEqual([
      [1, 3, id, 'done'],
      [2, 3, second, 'error'],
      [3, 3, third, 'done'],
    ]);
    expect(results.get(second)).toMatchObject({ status: 'error', message: expect.stringMatching(/Google Drive trash/) });
    expect(server.mediaFiles.get(id)?.drive_trashed_at).toBeTruthy();
    expect(server.mediaFiles.get(third)?.drive_trashed_at).toBeTruthy();
    // El que falló sigue en la lista, pedido y sin confirmar: se puede volver a pedir.
    const left = (await loadFileTrash(a.remote, server.workspaceId))!;
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ id: second, purged_at: expect.any(String) });

    server.portero.failTrash.clear();
    expect(await sendToDriveTrash((f) => a.media.trash(f), second)).toEqual({ status: 'done' });
    expect(await loadFileTrash(a.remote, server.workspaceId)).toEqual([]);
  });

  it('cuenta los días que faltan para los 30 desde que entró cada uno', async () => {
    const server = new FakeServer();
    const { a, page, id } = await withPhoto(server);
    await edit(a, page, (doc) => removeImage(doc, id));
    await sync(a);
    server.mediaFiles.get(id)!.trashed_at = new Date(Date.now() - 2 * DAY - 1000).toISOString();
    expect((await loadFileTrash(a.remote, server.workspaceId))![0].days_left).toBe(28);
    server.mediaFiles.get(id)!.trashed_at = new Date(Date.now() - 45 * DAY).toISOString();
    expect((await loadFileTrash(a.remote, server.workspaceId))![0].days_left).toBe(0);
  });
});

describe('papelera de archivos: en las páginas', () => {
  it('un archivo mandado a la papelera de Drive se muestra como borrado, con su miniatura', async () => {
    const server = new FakeServer();
    const { a, page, id } = await withPhoto(server);
    const b = await device(server);
    await sync(b);
    const before = await b.media.resolve(MEDIA_SCHEME + id);
    expect(before).toMatch(/^blob:/);

    await edit(a, page, (doc) => removeImage(doc, id));
    await sync(a);
    await a.media.trash(id);
    // Se vuelve a usar (se restauró una página, se pegó): sigue borrado para la app.
    await edit(a, page, (doc) => insertImage(doc, id));
    await sync(a);
    expect(server.mediaFiles.get(id)).toMatchObject({ trashed_at: expect.any(String), purged_at: expect.any(String) });

    // `b` ya lo había mostrado: se entera y avisa al editor para que lo vuelva a mostrar.
    const b2 = await device(server);
    await sync(b2);
    const changed = new Promise<string>((resolve) => b2.media.subscribeThumbs(resolve));
    await b2.media.resolve(MEDIA_SCHEME + id);
    expect(await changed).toBe(id);
    const after = decodeURIComponent(await b2.media.resolve(MEDIA_SCHEME + id));
    expect(after).toMatch(/^data:image\/svg\+xml/);
    expect(after).toContain(DELETED_LABEL);
    expect(after).toContain('data:image/jpeg;base64,');
    // En el dispositivo que lo mandó, también.
    expect(decodeURIComponent(await a.media.resolve(MEDIA_SCHEME + id))).toContain(DELETED_LABEL);
  });
});

describe('papelera de archivos: borrado automático (apagado)', () => {
  async function expired(): Promise<{ server: FakeServer; id: string }> {
    const server = new FakeServer();
    const { a, page, id } = await withPhoto(server);
    await edit(a, page, (doc) => removeImage(doc, id));
    await sync(a);
    server.mediaFiles.get(id)!.trashed_at = new Date(Date.now() - 40 * DAY).toISOString();
    return { server, id };
  }

  it('apagado, abrir la app como dueño no pregunta ni manda nada', async () => {
    const { server, id } = await expired();
    expect(server.settings?.autoPurgeFiles).toBe(false);
    server.mediaCalls.length = 0;
    server.portero.calls.length = 0;
    const owner = await device(server);
    await sync(owner);
    await new Promise((r) => setTimeout(r, 50));
    expect(owner.engine.getStatus().autoPurgeFiles).toBe(false);
    expect(calls(server, 'files_due_for_purge')).toEqual([]);
    expect(server.portero.calls.filter((c) => c.path === '/trash')).toEqual([]);
    expect(server.mediaFiles.get(id)).toMatchObject({ purged_at: null, drive_trashed_at: null });
  });

  it('la función apagada no llama a nada', async () => {
    const due = vi.fn(async () => [{ id: 'x', name: 'x', trashed_at: '' }]);
    const trash = vi.fn(async () => undefined);
    expect(await autoPurgeFiles({ enabled: false, projectIds: ['p'], due, trash })).toBe(0);
    expect(due).not.toHaveBeenCalled();
    expect(trash).not.toHaveBeenCalled();
    expect(await autoPurgeFiles({ enabled: true, projectIds: ['p'], due, trash })).toBe(1);
    expect(trash).toHaveBeenCalledWith('x');
  });

  it('prendido (armado para cuando Lega lo confirme), el dueño manda los vencidos al abrir la app', async () => {
    const { server, id } = await expired();
    server.settings = { ...server.settings!, autoPurgeFiles: true };
    // Un miembro sin permiso para mandar a Drive no pregunta.
    server.addMember('editor-1', 'member');
    server.grant('editor-1', { projectId: server.workspaceId }, 'edit');
    const editor = await device(server, undefined, { id: 'editor-1' });
    await sync(editor);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls(server, 'files_due_for_purge')).toEqual([]);

    const owner = await device(server);
    await sync(owner);
    await vi.waitFor(() => expect(server.mediaFiles.get(id)?.drive_trashed_at).toBeTruthy());
    expect(calls(server, 'files_due_for_purge')).toEqual([`files_due_for_purge ${server.workspaceId}`]);
  });
});
