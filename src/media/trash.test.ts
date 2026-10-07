import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeRemote, FakeServer, makeDevice, type Device } from '../sync/testing';
import { RemoteError } from '../sync/types';
import { exportUnsynced, unsyncedSummary } from '../sync/unsynced';
import { SupabaseRemote, unlinkIgnored } from '../sync/remote';
import { autoPurgeFiles, foreignPlaceholder, MEDIA_SCHEME, mediaIdOf } from './queue';
import { driveNotConnected, emptyFileTrash, loadFileTrash, sendToDriveTrash, type TrashOutcome } from './fileTrash';
import { mediaIdsInDoc } from './usage';
import { deletedLabel, requestedLabel } from './probe';

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

/** La marca de "ya mirada" que tendría la página con su documento de ahora. */
async function markOf(d: Device, pageId: string): Promise<string> {
  const state = (await d.docs.states()).get(pageId)!;
  return `${state.version}:${state.cursor}:1`;
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
    a.remote.unlinkPageFile = async (p, f, seen) => {
      const done = await original(p, f, seen);
      await a.media.ensureLinks(page, [id]);
      return done;
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
    server.enableTrash();
    const a = await device(server);
    const page = await a.tree.create(null, 'Día 1');
    await sync(a);
    const b = await device(server);
    await sync(b);

    // `a` agrega una foto a la página. `b` todavía no la puede bajar (se corta a la mitad), pero ya sabe que
    // la página usa el archivo (lo vio el editor).
    const id = mediaIdOf(await a.media.add(page, photo()))!;
    await edit(a, page, (doc) => insertImage(doc, id));
    await sync(a);
    const pull = b.remote.pullUpdates.bind(b.remote);
    b.remote.pullUpdates = async () => {
      throw new RemoteError('canceling statement due to statement timeout', true, '57014');
    };
    await b.media.ensureLinks(page, [id]);
    await sync(b);
    // Su documento no tiene la foto y el servidor tiene más: no dice que se quitó, dice que no llegó.
    expect(mediaIdsInDoc((await b.docs.snapshot(page)).doc).size).toBe(0);
    expect(server.pages.get(page)!.update_seq).toBeGreaterThan((await b.docs.states()).get(page)?.cursor ?? 0);
    expect(calls(server, 'unlink_page_file')).toEqual([]);
    expect(await b.mediaDb.get('links', `${page}:${id}`)).toMatchObject({ removed: false, pending: 0 });
    expect(server.mediaFiles.get(id)?.trashed_at).toBeNull();

    // Completo: tiene la foto, no quita nada.
    b.remote.pullUpdates = pull;
    await sync(b);
    expect(calls(server, 'unlink_page_file')).toEqual([]);

    // Se borra en `a`: con el documento completo y al día, sí. Cada dispositivo que lo vio lo manda; el
    // segundo no cambia nada (la fila ya estaba marcada).
    await edit(a, page, (doc) => removeImage(doc, id));
    await sync(a);
    await sync(b);
    expect(calls(server, 'unlink_page_file')).toEqual([`unlink_page_file ${page} ${id}`, `unlink_page_file ${page} ${id}`]);
    expect(await b.mediaDb.get('links', `${page}:${id}`)).toMatchObject({ removed: true, pending: 0 });
    expect(server.mediaFiles.get(id)?.trashed_at).toBeTruthy();
  });

  it('un documento que trae algo que esta versión no pudo leer nunca quita', async () => {
    const server = new FakeServer();
    const { a, page, id } = await withPhoto(server);
    // Llega del servidor un update que no se puede leer: al documento le puede faltar contenido.
    const seq = ++server.pages.get(page)!.update_seq;
    server.updates.get(page)!.push({ seq, clientUpdateId: crypto.randomUUID(), data: new Uint8Array([9, 9, 9]) });
    await sync(a);
    expect((await a.docs.states()).get(page)?.unreadable).toBe(true);
    // Aunque la página ya se hubiera comprobado antes (la marca de esta versión alcanza sola).
    await a.media.setVerified(page);
    await edit(a, page, (doc) => removeImage(doc, id));
    await sync(a);
    expect(calls(server, 'unlink_page_file')).toEqual([]);
    expect(server.mediaFiles.get(id)?.trashed_at).toBeNull();
    // No queda como "mirada": se vuelve a mirar en cada ciclo.
    expect(a.media.usageMark(page)).not.toBe(await markOf(a, page));
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
    expect(after).toContain(deletedLabel());
    expect(after).toContain('data:image/jpeg;base64,');
    // En el dispositivo que lo mandó, también.
    expect(decodeURIComponent(await a.media.resolve(MEDIA_SCHEME + id))).toContain(deletedLabel());
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

describe('papelera de archivos: correcciones de la auditoría', () => {
  /** Dos proyectos del dueño, con una página cada uno, y una foto en la del primero. */
  async function twoProjects(server: FakeServer) {
    const { a, page, id } = await withPhoto(server);
    const other = await a.tree.createProject('Otro rodaje');
    const foreign = await a.tree.create(null, 'Día 1 (otro)', other);
    await sync(a);
    return { a, page, id, foreign };
  }

  it('cortar de un proyecto y pegar en otro: avisa, la base guarda el uso ajeno y el archivo nunca entra a la papelera', async () => {
    const server = new FakeServer();
    const { a, page, id, foreign } = await twoProjects(server);
    const b = await device(server);
    await sync(b);
    await edit(a, page, (doc) => removeImage(doc, id));
    await edit(a, foreign, (doc) => insertImage(doc, id));
    // El editor, al pegarlo: avisa (sabe de qué proyecto es) y lo manda igual.
    await a.media.ensureLinks(foreign, [id]);
    expect(server.foreignNotices).toEqual(['IMG_0001.JPG']);
    await sync(a);
    expect(calls(server, 'link_page_file').filter((c) => c.includes(foreign))).toEqual([`link_page_file ${foreign} ${id}`]);
    expect(server.foreignPageFiles.has(`${foreign}:${id}`)).toBe(true);
    // Confirmado como uso ajeno: no queda pendiente ni frena nada, y el de la página original sale.
    expect(await a.mediaDb.get('links', `${foreign}:${id}`)).toMatchObject({ pending: 0, foreign: true, waiting: null });
    expect(calls(server, 'unlink_page_file')).toEqual([`unlink_page_file ${page} ${id}`]);
    expect(a.engine.getStatus()).toMatchObject({ pendingMedia: 0, failedMedia: 0 });
    expect(server.foreignNotices).toHaveLength(1);

    // El otro dispositivo sincroniza el proyecto de origen: también quita, y el archivo sigue sin entrar.
    await sync(b);
    await sync(a);
    expect(server.mediaFiles.get(id)?.trashed_at).toBeNull();

    // En la página del otro proyecto se ve el marcador, no la foto; en su proyecto, la foto.
    const shown = decodeURIComponent(await a.media.resolve(MEDIA_SCHEME + id, foreign));
    expect(shown).toContain(foreignPlaceholder());
    expect(await b.media.resolve(MEDIA_SCHEME + id, foreign).then(decodeURIComponent)).toContain(foreignPlaceholder());
    expect(await a.media.resolve(MEDIA_SCHEME + id, page)).toMatch(/^blob:/);

    // Se saca de la otra página: recién ahí entra a la papelera.
    await edit(a, foreign, (doc) => removeImage(doc, id));
    await sync(a);
    expect(server.foreignPageFiles.size).toBe(0);
    expect(server.mediaFiles.get(id)?.trashed_at).toBeTruthy();
  });

  it('en otro dispositivo que no sabía de qué proyecto era: la base guarda el uso ajeno, avisa y no reintenta', async () => {
    const server = new FakeServer();
    const { page, id, foreign } = await twoProjects(server);
    const b = await device(server);
    await sync(b);
    // `b` corta y pega (sin saber de qué proyecto es el archivo).
    await edit(b, page, (doc) => removeImage(doc, id));
    await edit(b, foreign, (doc) => insertImage(doc, id));
    await sync(b);
    expect(calls(server, 'link_page_file').filter((c) => c.includes(foreign))).toHaveLength(1);
    expect(server.foreignNotices).toEqual(['IMG_0001.JPG']);
    expect(await b.mediaDb.get('links', `${foreign}:${id}`)).toMatchObject({ pending: 0, foreign: true, blocked: false });
    expect(b.engine.getStatus()).toMatchObject({ pendingMedia: 0, failedMedia: 0 });
    // Reintentar lo rechazado no lo vuelve a mandar ni a avisar.
    await b.engine.retryRejected();
    await sync(b);
    expect(calls(server, 'link_page_file').filter((c) => c.includes(foreign))).toHaveLength(1);
    expect(server.foreignNotices).toHaveLength(1);
    expect(server.mediaFiles.get(id)?.trashed_at).toBeNull();
  });

  it('lo sin subir cuenta solo los usos por mandar, y el archivo exportado dice cuáles son quitados', async () => {
    const server = new FakeServer();
    const { a, page, id } = await withPhoto(server);
    const other = await a.tree.create(null, 'Día 2');
    await sync(a);
    a.remote.linkPageFile = async () => {
      throw new RemoteError('Internal Server Error', false, '500');
    };
    await edit(a, page, (doc) => removeImage(doc, id));
    await edit(a, other, (doc) => insertImage(doc, id));
    await sync(a);
    // El uso nuevo falta subir; el quitado espera a ese (no es un cambio sin subir).
    const summary = await unsyncedSummary(a.db, a.mediaDb);
    expect(summary.media).toBe(1);
    const out = (await exportUnsynced(a.db, a.mediaDb, {
      appVersion: '0.1',
      workspace: { url: 'u', localKey: 'k', name: 'n' },
      user: { id: 'u', email: 'e' },
      titleOf: () => undefined,
    })) as { mediaLinks: { pageId: string; fileId: string; removed: boolean }[] };
    expect(out.mediaLinks).toEqual(
      expect.arrayContaining([
        { pageId: other, fileId: id, removed: false },
        { pageId: page, fileId: id, removed: true },
      ]),
    );
  });

  it('mientras el uso nuevo no está confirmado, no quita el de la página original', async () => {
    const server = new FakeServer();
    const { a, page, id } = await withPhoto(server);
    const other = await a.tree.create(null, 'Día 2');
    await sync(a);
    const link = a.remote.linkPageFile.bind(a.remote);
    a.remote.linkPageFile = async () => {
      throw new RemoteError('Internal Server Error', false, '500');
    };
    await edit(a, page, (doc) => removeImage(doc, id));
    await edit(a, other, (doc) => insertImage(doc, id));
    await sync(a);
    expect(calls(server, 'unlink_page_file')).toEqual([]);
    expect(await a.mediaDb.get('links', `${page}:${id}`)).toMatchObject({ removed: true, waiting: 'held' });
    expect(server.mediaFiles.get(id)?.trashed_at).toBeNull();
    a.remote.linkPageFile = link;
    server.clockOffset += 60 * 60_000;
    await sync(a);
    expect(server.pageFiles.has(`${other}:${id}`)).toBe(true);
    expect(calls(server, 'unlink_page_file')).toEqual([`unlink_page_file ${page} ${id}`]);
    expect(server.mediaFiles.get(id)?.trashed_at).toBeNull();
  });

  it('manda el seq con el que decidió; si la página cambió después, la base lo ignora y se vuelve a comparar', async () => {
    const server = new FakeServer();
    const { a, page, id } = await withPhoto(server);
    const b = await device(server);
    await sync(b);
    await edit(a, page, (doc) => removeImage(doc, id));
    // Justo antes de que llegue el unlink, `b` escribe en la página (con la foto todavía, para `b`).
    const original = a.remote.unlinkPageFile.bind(a.remote);
    let first = true;
    a.remote.unlinkPageFile = async (p, f, seen) => {
      if (first) {
        first = false;
        await edit(b, page, (doc) => {
          const group = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
          group.insert(group.length, [new Y.XmlElement('blockContainer')]);
        });
        await b.docs.pushPage(page, b.remote);
      }
      return original(p, f, seen);
    };
    await sync(a);
    expect(server.seenSeqs.length).toBeGreaterThanOrEqual(2);
    const [ignored, applied] = server.seenSeqs;
    expect(ignored).toBeLessThan(server.pages.get(page)!.update_seq);
    expect(applied).toBe(server.pages.get(page)!.update_seq);
    expect(server.removedPageFiles.has(`${page}:${id}`)).toBe(true);
    expect(server.mediaFiles.get(id)?.trashed_at).toBeTruthy();
  });

  it('manda p_seen_seq siempre y solo `false` es "ignorado"', async () => {
    const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({ data: null, error: null, status: 200 }));
    const remote = new SupabaseRemote({ rpc } as never);
    expect(await remote.unlinkPageFile('p', 'f', 7)).toBe(true);
    expect(rpc.mock.calls[0][1]).toEqual({ p_page_id: 'p', p_file_id: 'f', p_seen_seq: 7, p_app_version: null });
    rpc.mockResolvedValueOnce({ data: false as never, error: null, status: 200 });
    expect(await remote.unlinkPageFile('p', 'f', 8)).toBe(false);
    expect(unlinkIgnored(null)).toBe(false);
    expect(unlinkIgnored(true)).toBe(false);
    expect(unlinkIgnored(false)).toBe(true);
    expect(unlinkIgnored('ignored')).toBe(false);
    expect(unlinkIgnored({ ignored: true })).toBe(false);
  });

  it('con ediciones que no se pudieron guardar en el dispositivo no quita nada', async () => {
    const server = new FakeServer();
    const { a, page, id } = await withPhoto(server);
    await edit(a, page, (doc) => removeImage(doc, id));
    const writeError = a.docs.getWriteError.bind(a.docs);
    a.docs.getWriteError = () => 'QuotaExceededError';
    await sync(a);
    expect(calls(server, 'unlink_page_file')).toEqual([]);
    a.docs.getWriteError = writeError;
    await sync(a);
    expect(calls(server, 'unlink_page_file')).toEqual([`unlink_page_file ${page} ${id}`]);
  });

  it('las páginas que la persona no puede editar no se miran (ni para sumar ni para quitar)', async () => {
    const server = new FakeServer();
    const { a, page, id } = await withPhoto(server);
    server.addMember('viewer-1', 'member');
    server.grant('viewer-1', { projectId: server.workspaceId }, 'view');
    const viewer = await device(server, undefined, { id: 'viewer-1' });
    const before = server.mediaCalls.length;
    await sync(viewer);
    await edit(a, page, (doc) => removeImage(doc, id));
    await sync(a);
    const afterOwner = server.mediaCalls.length;
    await sync(viewer);
    expect(server.mediaCalls.slice(before, afterOwner).filter((c) => c.includes('link_page_file'))).toEqual([
      `unlink_page_file ${page} ${id}`,
    ]);
    expect(server.mediaCalls.slice(afterOwner)).toEqual([]);
    expect(await viewer.mediaDb.count('links')).toBe(0);
  });

  it('si la comprobación del historial falla, espera cada vez más antes de volver a bajarlo', async () => {
    const server = new FakeServer();
    const { a, page, id } = await withPhoto(server);
    const pull = a.remote.pullUpdates.bind(a.remote);
    let fromStart = 0;
    a.remote.pullUpdates = async (p, after, limit) => {
      if (after === 0) {
        fromStart++;
        throw new RemoteError('Internal Server Error', false, '500');
      }
      return pull(p, after, limit);
    };
    await edit(a, page, (doc) => removeImage(doc, id));
    await a.engine.syncNow();
    expect(fromStart).toBe(1);
    await a.engine.syncNow();
    await a.engine.syncNow();
    expect(fromStart).toBe(1);
    expect(calls(server, 'unlink_page_file')).toEqual([]);
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 61_000);
    try {
      await a.engine.syncNow();
      expect(fromStart).toBe(2);
      // La segunda espera es más larga (2 minutos).
      clock.mockReturnValue(now + 61_000 + 90_000);
      await a.engine.syncNow();
      expect(fromStart).toBe(2);
      a.remote.pullUpdates = pull;
      clock.mockReturnValue(now + 61_000 + 121_000);
      await a.engine.syncNow();
      await a.engine.syncMedia();
      expect(calls(server, 'unlink_page_file')).toEqual([`unlink_page_file ${page} ${id}`]);
    } finally {
      clock.mockRestore();
    }
  });

  it('bajada a medias (el segundo lote falla después de aplicar el primero): no quita', async () => {
    const server = new FakeServer();
    const { a, page, id } = await withPhoto(server);
    const b = await device(server);
    await sync(b);
    // En `a`: se borra la foto y se deshace, en dos subidas.
    const doc = await a.docs.open(page);
    const undo = new Y.UndoManager(doc.getXmlFragment(CONTENT_FRAGMENT));
    removeImage(doc, id);
    await a.docs.flush();
    await a.docs.pushPage(page, a.remote);
    const removedAt = server.pages.get(page)!.update_seq;
    undo.undo();
    await a.docs.flush();
    await a.docs.pushPage(page, a.remote);
    a.docs.close(page);
    a.engine.stop();
    // `b` baja el borrado y se corta antes del deshacer.
    const pull = b.remote.pullUpdates.bind(b.remote);
    b.remote.pullUpdates = async (p, after, limit) => {
      if (after >= removedAt) throw new RemoteError('canceling statement due to statement timeout', true, '57014');
      return (await pull(p, after, limit)).filter((u) => u.seq <= removedAt);
    };
    await sync(b);
    expect(mediaIdsInDoc((await b.docs.snapshot(page)).doc).size).toBe(0);
    expect(calls(server, 'unlink_page_file')).toEqual([]);
    expect(server.mediaFiles.get(id)?.trashed_at).toBeNull();
  });

  it('un bloque que esta versión no conoce en el documento: no quita, y se vuelve a mirar', async () => {
    const server = new FakeServer();
    server.enableTrash();
    const hasFuture = (doc: Y.Doc) => {
      const stack: unknown[] = doc.getXmlFragment(CONTENT_FRAGMENT).toArray();
      while (stack.length) {
        const item = stack.pop();
        if (item instanceof Y.XmlElement) {
          if (item.nodeName === 'futureBlock') return true;
          stack.push(...item.toArray());
        }
      }
      return false;
    };
    const a = await makeDevice(server, undefined, '0.021', { supports: (doc) => !hasFuture(doc) });
    devices.push(a);
    const page = await a.tree.create(null, 'Día 1');
    await sync(a);
    const id = mediaIdOf(await a.media.add(page, photo()))!;
    await edit(a, page, (doc) => insertImage(doc, id));
    await sync(a);
    await edit(a, page, (doc) => {
      const group = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
      group.insert(group.length, [new Y.XmlElement('futureBlock')]);
      removeImage(doc, id);
    });
    await sync(a);
    expect(calls(server, 'unlink_page_file')).toEqual([]);
    expect(a.media.usageMark(page)).not.toBe(await markOf(a, page));
    await edit(a, page, (doc) => {
      const group = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
      group.delete(group.length - 1, 1);
    });
    await sync(a);
    expect(calls(server, 'unlink_page_file')).toEqual([`unlink_page_file ${page} ${id}`]);
  });

  it('el unlink de un archivo propio espera a que esté registrado', async () => {
    const server = new FakeServer();
    server.enableTrash();
    const a = await device(server);
    const page = await a.tree.create(null, 'Día 1');
    await sync(a);
    const register = a.remote.registerFile.bind(a.remote);
    a.remote.registerFile = async () => {
      server.mediaCalls.push('register_file (falla)');
      throw new RemoteError('Internal Server Error', false, '500');
    };
    const id = mediaIdOf(await a.media.add(page, photo()))!;
    await edit(a, page, (doc) => insertImage(doc, id));
    await sync(a);
    await edit(a, page, (doc) => removeImage(doc, id));
    await sync(a);
    expect(calls(server, 'unlink_page_file')).toEqual([]);
    expect(await a.mediaDb.get('links', `${page}:${id}`)).toMatchObject({ removed: true, pending: 1, waiting: 'held' });

    a.remote.registerFile = register;
    server.clockOffset += 60 * 60_000;
    await sync(a);
    const order = server.mediaCalls.filter((c) => c === `register_file ${id}` || c.startsWith('unlink_page_file'));
    expect(order).toEqual([`register_file ${id}`, `unlink_page_file ${page} ${id}`]);
    expect(server.mediaFiles.get(id)?.trashed_at).toBeTruthy();
  });

  it('antes de quitar por primera vez comprueba que todo el historial de la página se pueda leer', async () => {
    const server = new FakeServer();
    const { a, page, id } = await withPhoto(server);
    // Un update ilegible que una versión anterior descartó sin anotarlo: el cursor ya lo pasó.
    const seq = ++server.pages.get(page)!.update_seq;
    server.updates.get(page)!.push({ seq, clientUpdateId: crypto.randomUUID(), data: new Uint8Array([9, 9, 9]) });
    const state = (await a.docs.states()).get(page)!;
    await a.db.put('docState', { ...state, cursor: seq });
    await edit(a, page, (doc) => removeImage(doc, id));
    await sync(a);
    expect(calls(server, 'unlink_page_file')).toEqual([]);
    expect((await a.docs.states()).get(page)?.unreadable).toBe(true);
    expect(a.media.isVerified(page)).toBe(false);
  });

  it('un lote del historial más corto que lo pedido no lo da por comprobado: sigue hasta el cursor', async () => {
    const server = new FakeServer();
    const { a, page, id } = await withPhoto(server);
    const seq = ++server.pages.get(page)!.update_seq;
    server.updates.get(page)!.push({ seq, clientUpdateId: crypto.randomUUID(), data: new Uint8Array([9, 9, 9]) });
    const state = (await a.docs.states()).get(page)!;
    await a.db.put('docState', { ...state, cursor: seq });
    // La API entrega de a un update por pedido (su tope de filas), pida lo que pida el lote: el ilegible es el último.
    const pull = a.remote.pullUpdates.bind(a.remote);
    const asked: number[] = [];
    a.remote.pullUpdates = async (pageId, after, limit) => {
      asked.push(after);
      return (await pull(pageId, after, limit)).slice(0, 1);
    };
    await edit(a, page, (doc) => removeImage(doc, id));
    await sync(a);
    // Recorrió todo (un pedido por update) y encontró el ilegible: no quita nada.
    expect(asked.length).toBeGreaterThanOrEqual(seq);
    expect(calls(server, 'unlink_page_file')).toEqual([]);
    expect((await a.docs.states()).get(page)?.unreadable).toBe(true);
    expect(a.media.isVerified(page)).toBe(false);
  });

  it('con Drive sin conectar no marca nada y "Empty" para; "in_use" solo con ese código', async () => {
    const server = new FakeServer();
    const { a, page, id } = await withPhoto(server);
    const second = mediaIdOf(await a.media.add(page, photo('IMG_0002.JPG')))!;
    await edit(a, page, (doc) => insertImage(doc, second));
    await sync(a);
    await edit(a, page, (doc) => {
      removeImage(doc, id);
      removeImage(doc, second);
    });
    await sync(a);
    server.portero.driveDisconnected = true;
    const results = await emptyFileTrash((f) => a.media.trash(f), [id, second]);
    expect([...results.values()]).toEqual([{ status: 'not_connected', message: driveNotConnected() }]);
    expect(server.mediaFiles.get(id)?.purged_at ?? null).toBeNull();
    expect(server.portero.calls.filter((c) => c.path === '/trash')).toHaveLength(1);

    // Un 409 sin el código no es "en uso".
    server.portero.driveDisconnected = false;
    const plain409 = await sendToDriveTrash(async () => {
      const { PorteroError } = await import('./portero');
      throw new PorteroError('This file is not in the trash.', 409);
    }, id);
    expect(plain409).toEqual({ status: 'error', message: 'This file is not in the trash.' });
  });

  it('si Drive falló después de pedirlo, en las páginas dice que se pidió, no que está en la papelera de Drive', async () => {
    const server = new FakeServer();
    const { a, page, id } = await withPhoto(server);
    await edit(a, page, (doc) => removeImage(doc, id));
    await sync(a);
    server.portero.failTrash.add(id);
    expect(await sendToDriveTrash((f) => a.media.trash(f), id)).toMatchObject({ status: 'error' });
    const shown = decodeURIComponent(await a.media.resolve(MEDIA_SCHEME + id));
    expect(shown).toContain(requestedLabel());
    expect(shown).not.toContain(deletedLabel());
    server.portero.failTrash.clear();
    await a.media.trash(id);
    expect(decodeURIComponent(await a.media.resolve(MEDIA_SCHEME + id))).toContain(deletedLabel());
  });

  it('mandar a mano o automáticamente saltea un archivo con un uso de este dispositivo sin mandar', async () => {
    const server = new FakeServer();
    const { a, page, id } = await withPhoto(server);
    await edit(a, page, (doc) => removeImage(doc, id));
    await sync(a);
    // Se vuelve a pegar en otra página, pero el uso todavía no sale (el servidor falla un momento).
    const other = await a.tree.create(null, 'Día 2');
    await sync(a);
    a.remote.linkPageFile = async () => {
      throw new RemoteError('Internal Server Error', false, '500');
    };
    await edit(a, other, (doc) => insertImage(doc, id));
    await sync(a);
    expect(server.mediaFiles.get(id)?.trashed_at).toBeTruthy();
    expect(await sendToDriveTrash((f) => a.media.trash(f), id)).toMatchObject({ status: 'unsent_use' });
    expect(server.portero.calls.filter((c) => c.path === '/trash')).toEqual([]);

    // Automático (prendido para la prueba), al abrir la app: también lo saltea.
    server.mediaFiles.get(id)!.trashed_at = new Date(Date.now() - 40 * DAY).toISOString();
    server.settings = { ...server.settings!, autoPurgeFiles: true };
    const dbName = crypto.randomUUID();
    void dbName;
    expect(await a.media.autoPurge(true, [server.workspaceId])).toBe(0);
    expect(calls(server, 'files_due_for_purge')).toHaveLength(1);
    expect(server.portero.calls.filter((c) => c.path === '/trash')).toEqual([]);
    expect(server.mediaFiles.get(id)?.purged_at ?? null).toBeNull();
  });

  it('marca los que usa una página que está en la papelera de páginas', async () => {
    const server = new FakeServer();
    const { a, page, id } = await withPhoto(server);
    await a.tree.trash(page);
    await sync(a);
    const [row] = (await loadFileTrash(a.remote, server.workspaceId))!;
    expect(row).toMatchObject({ id, in_trashed_page: true, trashed_page_title: 'Día 1' });
  });
});

describe('dispositivo nuevo: los usos que el servidor ya tiene (B.14)', () => {
  /** Un proyecto con dos páginas y tres fotos, hecho en el dispositivo `a`. */
  async function bigger(server: FakeServer) {
    const { a, page, id } = await withPhoto(server);
    const other = await a.tree.create(null, 'Día 2');
    await sync(a);
    const ids = [mediaIdOf(await a.media.add(other, photo('IMG_0002.JPG')))!, mediaIdOf(await a.media.add(other, photo('IMG_0003.JPG')))!];
    await edit(a, other, (doc) => ids.forEach((x) => insertImage(doc, x)));
    await sync(a);
    return { a, page, id, other, ids };
  }

  it('abrir el proyecto en un dispositivo nuevo no cuenta ni manda los usos que el servidor ya tiene', async () => {
    const server = new FakeServer();
    const { page, id, other, ids } = await bigger(server);
    const sent = calls(server, 'link_page_file').length;
    const b = await device(server);
    // Apenas termina el ciclo (antes de la cola de archivos), el contador ya está en cero.
    await b.engine.syncNow();
    expect(b.engine.getStatus()).toMatchObject({ pendingMedia: 0, pendingPages: 0, pendingOps: 0, pendingFiles: 0 });
    await sync(b);
    expect(calls(server, 'link_page_file')).toHaveLength(sent);
    for (const [p, f] of [[page, id], [other, ids[0]], [other, ids[1]]]) {
      expect(await b.mediaDb.get('links', `${p}:${f}`)).toMatchObject({ pending: 0, removed: false });
    }
    // Lo confirmado así se comporta como lo mandado: quitar el bloque en `b` manda el unlink.
    await edit(b, page, (doc) => removeImage(doc, id));
    await sync(b);
    expect(calls(server, 'unlink_page_file')).toEqual([`unlink_page_file ${page} ${id}`]);
    expect(server.mediaFiles.get(id)?.trashed_at).toBeTruthy();
  });

  it('un uso que el servidor no tiene, o tiene quitado, se sigue mandando', async () => {
    const server = new FakeServer();
    const { page, id, other, ids } = await bigger(server);
    // Como si una versión vieja nunca lo hubiera registrado, y otro quitado en el servidor.
    server.pageFiles.delete(`${page}:${id}`);
    server.pageFiles.delete(`${other}:${ids[0]}`);
    server.removedPageFiles.add(`${other}:${ids[0]}`);
    const sent = calls(server, 'link_page_file').length;
    const b = await device(server);
    await b.engine.syncNow();
    expect(b.engine.getStatus().pendingMedia).toBe(2);
    await sync(b);
    expect(calls(server, 'link_page_file').slice(sent).sort()).toEqual(
      [`link_page_file ${page} ${id}`, `link_page_file ${other} ${ids[0]}`].sort(),
    );
    expect(server.pageFiles.has(`${page}:${id}`)).toBe(true);
    expect(server.pageFiles.has(`${other}:${ids[0]}`)).toBe(true);
    expect(b.engine.getStatus().pendingMedia).toBe(0);
  });

  it('si no se pueden leer los usos del servidor, se mandan como antes', async () => {
    const server = new FakeServer();
    const { page, id } = await withPhoto(server);
    const sent = calls(server, 'link_page_file').length;
    const b = await device(server);
    b.remote.fetchPageUses = async () => {
      throw new RemoteError('Internal Server Error', false, '500');
    };
    await sync(b);
    expect(calls(server, 'link_page_file').slice(sent)).toEqual([`link_page_file ${page} ${id}`]);
    expect(await b.mediaDb.get('links', `${page}:${id}`)).toMatchObject({ pending: 0 });
  });

  it('un uso ajeno ya guardado queda confirmado como ajeno, sin avisar de nuevo', async () => {
    const server = new FakeServer();
    const { a, page, id } = await withPhoto(server);
    const project = await a.tree.createProject('Otro rodaje');
    const foreign = await a.tree.create(null, 'Día 1 (otro)', project);
    await sync(a);
    await edit(a, foreign, (doc) => insertImage(doc, id));
    await sync(a);
    expect(server.foreignPageFiles.has(`${foreign}:${id}`)).toBe(true);
    const notices = server.foreignNotices.length;
    const sent = calls(server, 'link_page_file').length;
    const b = await device(server);
    await sync(b);
    expect(calls(server, 'link_page_file')).toHaveLength(sent);
    expect(await b.mediaDb.get('links', `${foreign}:${id}`)).toMatchObject({ pending: 0, foreign: true });
    expect(await b.mediaDb.get('links', `${page}:${id}`)).toMatchObject({ pending: 0 });
    expect(server.foreignNotices).toHaveLength(notices);
  });
});

describe('dispositivo nuevo: carreras entre la lectura de usos y el ciclo (auditoría de B.14)', () => {
  it('A1: A borra la foto (y manda el unlink) justo después de que B leyó los usos', async () => {
    const server = new FakeServer();
    const { a, page, id } = await withPhoto(server);
    const b = await device(server);
    const orig = b.docs.snapshot.bind(b.docs);
    let fired = false;
    b.docs.snapshot = (async (pid: string) => {
      if (!fired && pid === page) {
        fired = true;
        await edit(a, page, (doc) => removeImage(doc, id));
        await sync(a);
        expect(server.removedPageFiles.has(`${page}:${id}`)).toBe(true);
      }
      return orig(pid);
    }) as typeof b.docs.snapshot;
    const linksBefore = calls(server, 'link_page_file').length;
    await sync(b);
    await sync(b);
    // B no reactiva el uso que A quitó, y el archivo queda en la papelera.
    expect(calls(server, 'link_page_file').length - linksBefore).toBe(0);
    expect(server.pageFiles.has(`${page}:${id}`)).toBe(false);
    expect(server.removedPageFiles.has(`${page}:${id}`)).toBe(true);
    expect(server.mediaFiles.get(id)?.trashed_at).toBeTruthy();
    expect(await b.mediaDb.get('links', `${page}:${id}`)).toMatchObject({ removed: true, pending: 0 });
  });

  it('A2: B (nuevo) tiene una copia local de la foto sin pasar por el editor mientras A la borra', async () => {
    const server = new FakeServer();
    const { a, page, id } = await withPhoto(server);
    const b = await device(server);
    const orig = b.docs.snapshot.bind(b.docs);
    let fired = false;
    b.docs.snapshot = (async (pid: string) => {
      if (!fired && pid === page) {
        fired = true;
        // B pega una copia del mismo bloque (sin ensureLinks: import, plantilla, restaurar…)
        await edit(b, page, (doc) => insertImage(doc, id));
        await edit(a, page, (doc) => removeImage(doc, id));
        await sync(a);
      }
      return orig(pid);
    }) as typeof b.docs.snapshot;
    await sync(b);
    await sync(b);
    // El documento combinado tiene la copia de B.
    const merged = mediaIdsInDoc(await b.docs.open(page));
    b.docs.close(page);
    expect(merged.has(id)).toBe(true);
    // Antes de que A vuelva a sincronizar, el uso de B ya está activo: B no le creyó a la lectura vieja.
    expect(server.pageFiles.has(`${page}:${id}`)).toBe(true);
    expect(server.mediaFiles.get(id)?.trashed_at).toBeFalsy();
    await sync(a);
    expect(server.pageFiles.has(`${page}:${id}`)).toBe(true);
    expect(server.mediaFiles.get(id)?.trashed_at).toBeFalsy();
  });

  it('A3: B nuevo borra una foto y deshace: entra y sale de la papelera', async () => {
    const server = new FakeServer();
    const { page, id } = await withPhoto(server);
    const b = await device(server);
    await sync(b);
    const doc = await b.docs.open(page);
    const undo = new Y.UndoManager(doc.getXmlFragment(CONTENT_FRAGMENT));
    removeImage(doc, id);
    await b.docs.flush();
    await sync(b);
    expect(server.mediaFiles.get(id)?.trashed_at).toBeTruthy();
    undo.undo();
    await b.docs.flush();
    await sync(b);
    b.docs.close(page);
    expect(server.pageFiles.has(`${page}:${id}`)).toBe(true);
    expect(server.mediaFiles.get(id)?.trashed_at).toBeFalsy();
  });

  it('A4: 250 páginas nuevas: lecturas de usos y ningún link', async () => {
    const server = new FakeServer();
    const { a } = await withPhoto(server);
    for (let i = 0; i < 250; i++) {
      const p = await a.tree.create(null, `P${i}`);
      void p;
    }
    await sync(a);
    const b = await device(server);
    const before = calls(server, 'link_page_file').length;
    await sync(b);
    await sync(b);
    expect(calls(server, 'link_page_file').length).toBe(before);
  });
});
