import { afterEach, describe, expect, it } from 'vitest';
import { stored, translate } from '../i18n';
import { mediaIdOf } from '../media/queue';
import { toRemoteError } from './remote';
import { FakeServer, makeDevice, type Device } from './testing';
import { RemoteError } from './types';

// Un "no existe" de la base (`P0002`: `page_not_found`, `comment_not_found`…) es también lo que contesta cuando la
// sesión dejó de ver o de poder editar la página, y eso se revierte: le devuelven el permiso, la página sale de la
// papelera, restauran el proyecto. Lo rechazado así se reintenta solo cuando el árbol vuelve a mostrar la página, una
// vez por cada vuelta del árbol de "no" a "sí": nunca una vez por ciclo, y nunca lo rechazado por otro motivo.

const ANA = '00000000-0000-4000-8000-0000000000a1';
const BETO = '00000000-0000-4000-8000-0000000000a2';
const MB = 1024 * 1024;

const devices: Device[] = [];
async function device(server: FakeServer, user?: { id: string }): Promise<Device> {
  const d = await makeDevice(server, undefined, undefined, undefined, undefined, user ?? {});
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

/** Un workspace con equipo, comentarios y archivos: la dueña tiene Brief y Notes; Ana (del equipo) edita Brief. */
async function workspace({ role = 'member' as 'member' | 'guest' } = {}) {
  const server = new FakeServer();
  server.enableMedia();
  server.enableMentions();
  server.addMember(ANA, role, 'ana@wanka.tv');
  server.addMember(BETO, 'member', 'beto@wanka.tv');
  const owner = await device(server);
  const brief = await owner.tree.create(null, 'Brief');
  const notes = await owner.tree.create(null, 'Notes');
  await owner.engine.syncNow();
  server.grant(ANA, { pageId: brief }, 'edit');
  const ana = await device(server, { id: ANA });
  await ana.engine.syncNow();
  return { server, owner, ana, brief, notes };
}

/** Le saca a alguien su permiso sobre la página (como quitarlo en Share). */
function ungrant(server: FakeServer, userId: string, pageId: string): void {
  const at = server.grants.findIndex((g) => g.user_id === userId && g.page_id === pageId);
  if (at >= 0) server.grants.splice(at, 1);
}

async function write(d: Device, pageId: string, text: string): Promise<void> {
  const doc = await d.docs.open(pageId);
  doc.getText('t').insert(0, text);
  await d.docs.flush(pageId);
  d.docs.close(pageId);
}

async function read(d: Device, pageId: string): Promise<string> {
  const doc = await d.docs.open(pageId);
  const text = doc.getText('t').toString();
  d.docs.close(pageId);
  return text;
}

/**
 * Cuenta las subidas de contenido que este dispositivo le pide al servidor por una página. Con `refuse`, la base
 * contesta que la página no existe tal como lo entrega PostgREST (estado 500 con el código `P0002`).
 */
function countPushes(d: Device, pageId: string): { n: number; refuse: boolean } {
  const counter = { n: 0, refuse: false };
  const push = d.remote.pushUpdate.bind(d.remote);
  d.remote.pushUpdate = async (id, clientUpdateId, update) => {
    if (id !== pageId) return push(id, clientUpdateId, update);
    counter.n++;
    if (counter.refuse) throw toRemoteError({ message: 'page_not_found', code: 'P0002' }, 500);
    return push(id, clientUpdateId, update);
  };
  return counter;
}

/** El ciclo de siempre y la cola de archivos, como en la app. */
async function sync(d: Device): Promise<void> {
  await d.engine.syncNow();
  await d.engine.syncMedia();
  await d.engine.syncNow();
}

function makeFile(size: number, name: string, type: string): File {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = i % 251;
  return new File([bytes], name, { type });
}

describe('el contenido rechazado por "no existe"', () => {
  it('sube solo cuando le devuelven el permiso de editar, sin Retry ni reabrir la app, y llega al otro dispositivo', async () => {
    const { server, owner, ana, brief } = await workspace();
    const pushes = countPushes(ana, brief);
    // Le bajan el permiso mientras escribe: la base rechaza la subida y lo escrito queda en el dispositivo.
    server.grant(ANA, { pageId: brief }, 'view');
    await write(ana, brief, 'la toma 12 va de noche');
    await ana.engine.syncNow();
    expect((await ana.docs.states()).get(brief)?.rejected).toBe('page_not_found');
    expect(ana.engine.getStatus().rejectedPages).toBe(1);
    expect(server.updates.get(brief) ?? []).toHaveLength(0);
    expect(pushes.n).toBe(1);

    // Mientras no pueda editar, ningún ciclo vuelve a pedirle nada a la base por esa página.
    for (let i = 0; i < 4; i++) await ana.engine.syncNow();
    expect(pushes.n).toBe(1);
    expect(await ana.docs.unsyncedPages()).toContain(brief);

    // Le devuelven el permiso: el árbol que baja el ciclo siguiente la muestra editable y sube.
    server.grant(ANA, { pageId: brief }, 'edit');
    await ana.engine.syncNow();
    expect(pushes.n).toBe(2);
    expect(server.updates.get(brief) ?? []).toHaveLength(1);
    expect(ana.engine.getStatus()).toMatchObject({ rejectedPages: 0, pendingPages: 0 });
    await owner.engine.syncNow();
    expect(await read(owner, brief)).toBe('la toma 12 va de noche');
  });

  it('el rechazo queda anotado en su mismo ciclo: si la app queda sin red hasta que vuelve el permiso, sube al volver', async () => {
    const { server, ana, brief } = await workspace();
    const pushes = countPushes(ana, brief);
    server.grant(ANA, { pageId: brief }, 'view');
    await write(ana, brief, 'escrito en el set');
    await ana.engine.syncNow();
    expect(pushes.n).toBe(1);
    // Sin red: ningún ciclo llega a bajar el árbol. Mientras tanto le devuelven el permiso.
    server.online = false;
    for (let i = 0; i < 3; i++) await ana.engine.syncNow();
    server.grant(ANA, { pageId: brief }, 'edit');
    server.online = true;
    await ana.engine.syncNow();
    expect(pushes.n).toBe(2);
    expect(server.updates.get(brief) ?? []).toHaveLength(1);
    expect(ana.engine.getStatus().rejectedPages).toBe(0);
  });

  it('si el ciclo se corta por la red justo después del rechazo, el "no" ya quedó anotado: sube sola cuando vuelven la red y el permiso', async () => {
    const { server, owner, ana, brief, notes } = await workspace();
    server.grant(ANA, { pageId: notes }, 'edit');
    await ana.engine.syncNow();
    // La dueña escribe en Notes: Ana tiene algo para bajar en el mismo ciclo del rechazo.
    await write(owner, notes, 'de la dueña');
    await owner.engine.syncNow();
    const pushes = countPushes(ana, brief);
    server.grant(ANA, { pageId: brief }, 'view');
    await write(ana, brief, 'escrito en el set');
    // La red se cae después de la subida rechazada, al bajar Notes: el ciclo se corta ahí.
    const { pullUpdates, pullContent } = ana.remote;
    const down = async (): Promise<never> => {
      throw new RemoteError('Failed to fetch', false, undefined, true);
    };
    ana.remote.pullUpdates = down;
    ana.remote.pullContent = down;
    await ana.engine.syncNow();
    expect((await ana.docs.states()).get(brief)?.rejected).toBe('page_not_found');
    expect(ana.engine.getStatus().online).toBe(false);
    expect(pushes.n).toBe(1);

    // Sigue sin red; mientras tanto le devuelven el permiso.
    server.online = false;
    await ana.engine.syncNow();
    ana.remote.pullUpdates = pullUpdates;
    ana.remote.pullContent = pullContent;
    server.grant(ANA, { pageId: brief }, 'edit');
    server.online = true;
    await ana.engine.syncNow();
    expect(pushes.n).toBe(2);
    expect(server.updates.get(brief) ?? []).toHaveLength(1);
    expect(ana.engine.getStatus().rejectedPages).toBe(0);
    expect(await read(ana, notes)).toBe('de la dueña');
  });

  it('no hay bucle: si el servidor vuelve a rechazarla, hay un solo reintento por cada vez que el árbol pasa de no a sí, y nada se pierde', async () => {
    const { server, ana, brief } = await workspace();
    const pushes = countPushes(ana, brief);
    server.grant(ANA, { pageId: brief }, 'view');
    await write(ana, brief, 'no se pierde');
    await ana.engine.syncNow();
    await ana.engine.syncNow();
    expect(pushes.n).toBe(1);

    // El árbol vuelve a decir que puede editar, pero la base sigue contestando que no existe.
    pushes.refuse = true;
    server.grant(ANA, { pageId: brief }, 'edit');
    for (let i = 0; i < 5; i++) await ana.engine.syncNow();
    // Un reintento, no uno por ciclo.
    expect(pushes.n).toBe(2);
    expect((await ana.docs.states()).get(brief)?.rejected).toBe('page_not_found');
    expect(await ana.docs.unsyncedPages()).toContain(brief);
    expect(await read(ana, brief)).toBe('no se pierde');

    // El árbol vuelve a "no" y otra vez a "sí": un reintento más, que ahora entra.
    pushes.refuse = false;
    server.grant(ANA, { pageId: brief }, 'view');
    await ana.engine.syncNow();
    expect(pushes.n).toBe(2);
    server.grant(ANA, { pageId: brief }, 'edit');
    for (let i = 0; i < 3; i++) await ana.engine.syncNow();
    expect(pushes.n).toBe(3);
    expect(server.updates.get(brief) ?? []).toHaveLength(1);
    expect(ana.engine.getStatus().rejectedPages).toBe(0);
  });

  it('si el árbol nunca mostró la página en "no" después del rechazo, no se reintenta sola: queda para Retry', async () => {
    const { server, ana, brief } = await workspace();
    const pushes = countPushes(ana, brief);
    // La base rechaza una vez aunque el árbol siempre dijo que puede editar.
    pushes.refuse = true;
    await write(ana, brief, 'texto');
    await ana.engine.syncNow();
    pushes.refuse = false;
    for (let i = 0; i < 4; i++) await ana.engine.syncNow();
    expect(pushes.n).toBe(1);
    expect(ana.engine.getStatus().rejectedPages).toBe(1);

    await ana.engine.retryRejected();
    expect(pushes.n).toBe(2);
    expect(server.updates.get(brief) ?? []).toHaveLength(1);
  });

  it('un rechazo de otra clase (el tope de tamaño) no se reintenta aunque el árbol vuelva a mostrar la página', async () => {
    const { server, ana, brief } = await workspace();
    const pushes = countPushes(ana, brief);
    server.maxUpdateBytes = 8;
    await write(ana, brief, 'un texto más largo que el tope de la base');
    await ana.engine.syncNow();
    expect((await ana.docs.states()).get(brief)?.rejected).toBe('update_size_invalid');
    expect(pushes.n).toBe(1);

    server.grant(ANA, { pageId: brief }, 'view');
    await ana.engine.syncNow();
    server.grant(ANA, { pageId: brief }, 'edit');
    for (let i = 0; i < 3; i++) await ana.engine.syncNow();
    expect(pushes.n).toBe(1);
    expect((await ana.docs.states()).get(brief)?.rejected).toBe('update_size_invalid');

    // Con Retry (y el tope de siempre) sube.
    server.maxUpdateBytes = 8 * MB;
    await ana.engine.retryRejected();
    expect(server.updates.get(brief) ?? []).toHaveLength(1);
  });

  it('una invitada que edita: la página va a la papelera y vuelve, y lo escrito mientras tanto sube solo', async () => {
    const { server, owner, ana, brief } = await workspace({ role: 'guest' });
    // La dueña la manda a la papelera: para una invitada deja de existir.
    await owner.tree.trash(brief);
    await owner.engine.syncNow();
    await write(ana, brief, 'escrito con la página en la papelera');
    await ana.engine.syncNow();
    expect(ana.tree.onServer(brief)).toBe(false);
    expect((await ana.docs.states()).get(brief)?.rejected).toBe('page_not_found');
    await ana.engine.syncNow();
    expect(server.updates.get(brief) ?? []).toHaveLength(0);

    await owner.tree.restore(brief);
    await owner.engine.syncNow();
    await ana.engine.syncNow();
    expect(server.updates.get(brief) ?? []).toHaveLength(1);
    expect(ana.engine.getStatus().rejectedPages).toBe(0);
    await owner.engine.syncNow();
    expect(await read(owner, brief)).toBe('escrito con la página en la papelera');
  });

  it('sin las reglas del equipo: borran el proyecto y lo restauran, y lo escrito mientras tanto sube solo', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const b = await device(server);
    const page = await a.tree.create(null, 'Día 1');
    await a.engine.syncNow();
    await b.engine.syncNow();
    const project = a.tree.get(page)!.workspace_id;

    server.deletedProjects.set(project, { at: new Date().toISOString(), by: server.ownerId });
    await write(b, page, 'escrito con el proyecto borrado');
    await b.engine.syncNow();
    expect((await b.docs.states()).get(page)?.rejected).toBe('page_not_found');
    await b.engine.syncNow();
    expect(server.updates.get(page) ?? []).toHaveLength(0);

    server.deletedProjects.delete(project);
    await b.engine.syncNow();
    expect(server.updates.get(page) ?? []).toHaveLength(1);
    await a.engine.syncNow();
    expect(await read(a, page)).toBe('escrito con el proyecto borrado');
  });
});

describe('los comentarios rechazados por "no existe"', () => {
  it('salen solos cuando la página vuelve a verse; los rechazados por otro motivo quedan a la vista', async () => {
    const { server, owner, ana, brief } = await workspace();
    const adds = () => server.commentCalls.filter((c) => c.startsWith('add ')).length;
    // Sin permiso de comentar: `comment_denied`, otra clase de rechazo.
    server.grant(ANA, { pageId: brief }, 'view');
    const denied = await ana.comments.add(brief, null, 'no puedo comentar acá');
    await ana.engine.syncNow();
    expect(ana.engine.getStatus().failedComments).toBe(1);
    // Le sacan la página: el comentario siguiente se rechaza porque la página "no existe".
    ungrant(server, ANA, brief);
    const lost = await ana.comments.add(brief, null, 'fijate la toma 12');
    await ana.engine.syncNow();
    expect(ana.engine.getStatus().failedComments).toBe(2);
    expect(ana.comments.notFoundPages()).toEqual([brief]);
    const before = adds();
    for (let i = 0; i < 3; i++) await ana.engine.syncNow();
    expect(adds()).toBe(before);

    // Vuelve a verla (con Comentar): sale el rechazado por "no existe"; el otro sigue rechazado, sin otro pedido.
    server.grant(ANA, { pageId: brief }, 'comment');
    await ana.engine.syncNow();
    expect(server.comments.has(lost)).toBe(true);
    expect(server.comments.has(denied)).toBe(false);
    expect(adds()).toBe(before + 1);
    expect(ana.engine.getStatus()).toMatchObject({ failedComments: 1, pendingComments: 0 });
    for (let i = 0; i < 3; i++) await ana.engine.syncNow();
    expect(adds()).toBe(before + 1);

    // Llega al otro dispositivo.
    const stop = owner.comments.watch(brief);
    await owner.engine.syncNow();
    expect(owner.comments.threads(brief).map((t) => t.root.body)).toEqual(['fijate la toma 12']);
    stop();
    // Y el otro sale con Retry, como siempre.
    await ana.engine.retryRejected();
    expect(server.comments.has(denied)).toBe(true);
  });

  it('si la página vuelve solo para ver, el comentario se reintenta una vez, queda rechazado por permiso y ya no sale solo', async () => {
    const { server, ana, brief } = await workspace();
    const adds = () => server.commentCalls.filter((c) => c.startsWith('add ')).length;
    ungrant(server, ANA, brief);
    const id = await ana.comments.add(brief, null, 'fijate la toma 12');
    await ana.engine.syncNow();
    expect(ana.comments.notFoundPages()).toEqual([brief]);
    const before = adds();

    // Vuelve a verla, sin Comentar: un pedido más, y el rechazo pasa a ser de otra clase.
    server.grant(ANA, { pageId: brief }, 'view');
    for (let i = 0; i < 3; i++) await ana.engine.syncNow();
    expect(adds()).toBe(before + 1);
    expect(ana.comments.notFoundPages()).toEqual([]);
    expect(ana.engine.getStatus().failedComments).toBe(1);
    // Cuando después le dan Comentar no sale solo: sigue a la vista, para Retry.
    server.grant(ANA, { pageId: brief }, 'comment');
    for (let i = 0; i < 3; i++) await ana.engine.syncNow();
    expect(adds()).toBe(before + 1);
    expect(server.comments.has(id)).toBe(false);
    expect(ana.comments.failures()).toMatchObject([{ kind: 'add', body: 'fijate la toma 12' }]);
    await ana.engine.retryRejected();
    expect(server.comments.has(id)).toBe(true);
  });
});

describe('si la base vuelve a rechazar lo que se reintentó', () => {
  it('un comentario y una foto se piden una sola vez más, siguen en el dispositivo y quedan a la vista como antes', async () => {
    const { server, ana, brief } = await workspace();
    ungrant(server, ANA, brief);
    const comment = await ana.comments.add(brief, null, 'fijate la toma 12');
    const photo = mediaIdOf(await ana.media.add(brief, makeFile(MB, 'IMG_0004.JPG', 'image/jpeg')))!;
    await sync(ana);
    expect(ana.engine.getStatus()).toMatchObject({ failedComments: 1, failedMedia: 1 });

    // El árbol vuelve a mostrar la página, pero la base sigue contestando que no existe (como PostgREST: 500).
    let adds = 0;
    let registers = 0;
    const refuse = (): never => {
      throw toRemoteError({ message: 'page_not_found', code: 'P0002' }, 500);
    };
    ana.remote.addComment = async () => {
      adds++;
      return refuse();
    };
    ana.remote.registerFile = async () => {
      registers++;
      return refuse();
    };
    server.grant(ANA, { pageId: brief }, 'edit');
    for (let i = 0; i < 4; i++) await sync(ana);
    expect(adds).toBe(1);
    expect(registers).toBe(1);
    expect(ana.engine.getStatus()).toMatchObject({ failedComments: 1, failedMedia: 1 });
    expect(ana.comments.failures()).toMatchObject([{ kind: 'add', body: 'fijate la toma 12' }]);
    expect(await ana.commentsDb.count('outbox')).toBe(1);
    expect((await ana.media.source(photo)).original?.size).toBe(MB);
    expect(server.comments.has(comment)).toBe(false);
  });
});

describe('los archivos detenidos por "no existe"', () => {
  it('una foto agregada sin poder editar la página se registra y sube sola cuando vuelve el permiso', async () => {
    const { server, ana, brief } = await workspace();
    const registers = () => server.mediaCalls.filter((c) => c.startsWith('register_file')).length;
    server.grant(ANA, { pageId: brief }, 'view');
    const id = mediaIdOf(await ana.media.add(brief, makeFile(MB, 'IMG_0001.JPG', 'image/jpeg')))!;
    await sync(ana);
    expect(server.mediaFiles.has(id)).toBe(false);
    expect(ana.engine.getStatus().failedMedia).toBe(1);
    expect(await ana.media.notFoundPages()).toEqual([brief]);
    const before = registers();
    for (let i = 0; i < 3; i++) await sync(ana);
    expect(registers()).toBe(before);

    server.grant(ANA, { pageId: brief }, 'edit');
    await sync(ana);
    expect(server.mediaFiles.get(id)?.drive_id).toBeTruthy();
    expect(ana.engine.getStatus()).toMatchObject({ failedMedia: 0, pendingMedia: 0 });
  });

  it('el uso de un archivo en una página que no se puede editar espera, y sale solo cuando vuelve el permiso', async () => {
    const { server, ana, brief, notes } = await workspace();
    const id = mediaIdOf(await ana.media.add(brief, makeFile(MB, 'IMG_0002.JPG', 'image/jpeg')))!;
    await sync(ana);
    // La dueña le comparte Notes para ver; Ana copia ahí el bloque de la foto.
    server.grant(ANA, { pageId: notes }, 'view');
    await sync(ana);
    await ana.media.ensureLinks(notes, [id]);
    await sync(ana);
    expect(server.pageFiles.has(`${notes}:${id}`)).toBe(false);
    expect(await ana.mediaDb.get('links', `${notes}:${id}`)).toMatchObject({ pending: 1, waiting: 'denied' });
    const links = () => server.mediaCalls.filter((c) => c.startsWith('link_page_file')).length;
    const before = links();
    for (let i = 0; i < 3; i++) await sync(ana);
    expect(links()).toBe(before);

    server.grant(ANA, { pageId: notes }, 'edit');
    await sync(ana);
    expect(server.pageFiles.has(`${notes}:${id}`)).toBe(true);
    expect(await ana.mediaDb.get('links', `${notes}:${id}`)).toMatchObject({ pending: 0, waiting: null });
  });

  it('una foto que la base rechaza después del ciclo queda anotada: sin red hasta que vuelve el permiso, sube sola al volver', async () => {
    const { server, ana, brief } = await workspace();
    server.grant(ANA, { pageId: brief }, 'view');
    const id = mediaIdOf(await ana.media.add(brief, makeFile(MB, 'IMG_0005.JPG', 'image/jpeg')))!;
    // Un ciclo y la vuelta de la cola de archivos, que corre después: ahí la base la rechaza.
    await ana.engine.syncNow();
    await ana.engine.syncMedia();
    expect(await ana.media.notFoundPages()).toEqual([brief]);
    expect(server.mediaFiles.has(id)).toBe(false);

    // Sin red: ningún ciclo llega a bajar el árbol. Mientras tanto le devuelven el permiso.
    server.online = false;
    for (let i = 0; i < 2; i++) await sync(ana);
    server.grant(ANA, { pageId: brief }, 'edit');
    server.online = true;
    await sync(ana);
    expect(server.mediaFiles.get(id)?.drive_id).toBeTruthy();
    expect(ana.engine.getStatus()).toMatchObject({ failedMedia: 0, pendingMedia: 0 });
  });

  it('un archivo detenido por otro motivo no se toca', async () => {
    const { server, ana, brief } = await workspace();
    const id = mediaIdOf(await ana.media.add(brief, makeFile(MB, 'IMG_0003.JPG', 'image/jpeg')))!;
    const record = (await ana.mediaDb.get('files', id))!;
    await ana.mediaDb.put('files', { ...record, blocked: true, error: 'Drive is full' });
    await ana.media.retryNotFound(new Set([brief]));
    expect(await ana.mediaDb.get('files', id)).toMatchObject({ blocked: true, error: 'Drive is full' });
    expect(await ana.media.notFoundPages()).toEqual([]);
    expect(server.mediaFiles.has(id)).toBe(false);
  });
});

describe('el estado de la sincronización con una página que la base no deja bajar o subir', () => {
  it('lo dice en palabras, no con el código de la base', async () => {
    const { server, owner, ana, brief } = await workspace();
    await write(owner, brief, 'contenido nuevo');
    await owner.engine.syncNow();
    // El árbol muestra la página, pero la base contesta que no existe al pedir su contenido (como PostgREST: 500).
    const failing = async (): Promise<never> => {
      throw toRemoteError({ message: 'page_not_found', code: 'P0002' }, 500);
    };
    const { pullUpdates, pullContent } = ana.remote;
    ana.remote.pullUpdates = failing;
    ana.remote.pullContent = failing;
    await ana.engine.syncNow();
    const seen = ana.engine.getStatus().lastError;
    expect(seen).toBe(stored('commentError.pageNotFound'));
    expect(seen).not.toContain('page_not_found');
    expect(translate('es', 'commentError.pageNotFound')).toBe('La página no está en el servidor, o ya no podés verla.');
    ana.remote.pullUpdates = pullUpdates;
    ana.remote.pullContent = pullContent;
    await ana.engine.syncNow();
    expect(ana.engine.getStatus().lastError).toBeNull();

    // Al subir: lo mismo, con el texto de no poder editarla.
    server.grant(ANA, { pageId: brief }, 'view');
    await write(ana, brief, 'x');
    await ana.engine.syncNow();
    expect(ana.engine.getStatus().lastError).toBe(stored('queue.pageNotFound'));
  });
});
