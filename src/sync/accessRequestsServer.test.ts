import { afterEach, describe, expect, it } from 'vitest';
import { ACCESS_REQUESTS_PER_DAY, FakeServer, makeDevice, type Device } from './testing';

// El servidor en memoria con las reglas de tiempo de los pedidos de acceso (P.30, Docs/Doc_Links_PDF.md, sección 19,
// O9 de la auditoría de E2): el tope de 20 filas nuevas por persona y día (archivos y páginas juntos), renovar como mucho
// una vez por hora, las 24 horas de un rechazo y de un `void`, los 30 días de la lista y de decidir (con el borde: 30 días
// y 1 hora ya no; 29 días y 23 horas sí) y el archivo en la papelera de Drive. Las mismas que
// supabase/migrations/20261031120000_access_requests.sql y 20261102120000_access_requests_paginas.sql, así las pruebas de
// la interfaz reciben del servidor lo mismo que de la base.

const CLIENTA = '00000000-0000-4000-8000-0000000000a3';
const FILE = '00000000-0000-4000-8000-0000000000f1';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const devices: Device[] = [];
afterEach(async () => {
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.mentions.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
});

/** El dueño con Escena 12 (que usa un archivo) y Reporte; una clienta invitada sin acceso. El reloj del servidor se mueve. */
async function setup() {
  const server = new FakeServer();
  let offset = 0;
  const start = Date.now();
  server.now = () => start + offset;
  const later = (ms: number) => {
    offset += ms;
  };
  // Los miembros con su rol (las menciones prenden `members`, como en las otras pruebas de los pedidos).
  server.enableMentions();
  server.addMember(CLIENTA, 'guest', 'clienta@cliente.com');
  const owner = await makeDevice(server);
  devices.push(owner);
  const scene = await owner.tree.create(null, 'Escena 12');
  const report = await owner.tree.create(null, 'Reporte');
  await owner.engine.syncNow();
  server.mediaFiles.set(FILE, {
    id: FILE,
    name: 'plano.pdf',
    mime: 'application/pdf',
    width: null,
    height: null,
    duration: null,
    thumb_at: null,
    drive_id: 'd1',
    project_id: server.pages.get(scene)!.workspace_id,
    size: 10,
  });
  server.pageFiles.add(`${scene}:${FILE}`);
  const guest = await makeDevice(server, undefined, undefined, undefined, undefined, { id: CLIENTA });
  devices.push(guest);
  const decide = owner.remote.accessRequestsRemote();
  return { server, owner, guest, scene, report, later, decide };
}

const random = () => crypto.randomUUID();

describe('el servidor en memoria: el tope de pedidos por día', () => {
  it('20 filas nuevas por persona y día, archivos y páginas juntos; repetir uno abierto no cuenta; al otro día, sí', async () => {
    const { server, guest, scene, later } = await setup();
    expect(ACCESS_REQUESTS_PER_DAY).toBe(20);
    expect(await guest.remote.requestPageAccess(scene)).toBe('sent');
    for (let i = 0; i < 9; i++) expect(await guest.remote.requestPageAccess(random())).toBe('sent');
    for (let i = 0; i < 10; i++) expect(await guest.remote.requestAccess(random())).toBe('sent');
    expect(server.accessRequests).toHaveLength(20);
    // El 21 no entra, sea archivo o página, exista o no.
    await expect(guest.remote.requestAccess(FILE)).rejects.toMatchObject({ message: 'rate_limited', code: 'P0001' });
    await expect(guest.remote.requestPageAccess(random())).rejects.toMatchObject({ message: 'rate_limited' });
    // Repetir uno abierto sigue respondiendo «enviado», sin fila nueva.
    expect(await guest.remote.requestPageAccess(scene)).toBe('sent');
    expect(server.accessRequests).toHaveLength(20);
    // Las 24 horas corren desde la primera vez de cada fila.
    later(DAY - HOUR);
    await expect(guest.remote.requestAccess(FILE)).rejects.toMatchObject({ message: 'rate_limited' });
    later(2 * HOUR);
    expect(await guest.remote.requestAccess(FILE)).toBe('sent');
    expect(server.accessRequests).toHaveLength(21);
  });

  it('el tope es por persona: otra no se entera', async () => {
    const { server, guest } = await setup();
    const other = '00000000-0000-4000-8000-0000000000a4';
    server.addMember(other, 'member', 'otro@wanka.tv');
    const second = await makeDevice(server, undefined, undefined, undefined, undefined, { id: other });
    devices.push(second);
    for (let i = 0; i < 20; i++) await guest.remote.requestAccess(random());
    await expect(guest.remote.requestAccess(random())).rejects.toMatchObject({ message: 'rate_limited' });
    expect(await second.remote.requestAccess(FILE)).toBe('sent');
  });
});

describe('el servidor en memoria: las horas', () => {
  it('renovar suma una vez por hora y mueve la hora del pedido solo entonces', async () => {
    const { server, guest, scene, later } = await setup();
    await guest.remote.requestPageAccess(scene);
    const first = server.accessRequests[0].asked_at;
    later(30 * 60_000);
    await guest.remote.requestPageAccess(scene);
    expect(server.accessRequests[0]).toMatchObject({ times: 1, asked_at: first });
    later(31 * 60_000);
    await guest.remote.requestPageAccess(scene);
    expect(server.accessRequests[0].times).toBe(2);
    expect(Date.parse(server.accessRequests[0].asked_at)).toBe(server.now());
  });

  it('rechazado hace menos de 24 horas: pedir de nuevo queda void; pasado el día, vuelve a valer', async () => {
    const { server, guest, scene, later, decide } = await setup();
    await guest.remote.requestPageAccess(scene);
    expect(await decide.decide(server.accessRequests[0].id, false, null, 'view')).toBe('declined');
    later(HOUR);
    expect(await guest.remote.requestPageAccess(scene)).toBe('sent');
    expect(server.accessRequests.map((r) => r.state)).toEqual(['declined', 'void']);
    expect(await decide.pending()).toEqual([]);
    // Renovarlo antes del día no lo cambia; con el rechazo y la fila de más de 24 horas, se vuelve a mirar y vale.
    later(2 * HOUR);
    await guest.remote.requestPageAccess(scene);
    expect(server.accessRequests[1].state).toBe('void');
    later(DAY);
    await guest.remote.requestPageAccess(scene);
    expect(server.accessRequests[1].state).toBe('pending');
    expect((await decide.pending()).map((r) => r.targetPageId)).toEqual([scene]);
  });

  it('un archivo rechazado: lo mismo, con su propio rechazo (no el de otro archivo)', async () => {
    const { server, guest, later, decide } = await setup();
    await guest.remote.requestAccess(FILE);
    await decide.decide(server.accessRequests[0].id, false, null, 'view');
    later(HOUR);
    await guest.remote.requestAccess(FILE);
    expect(server.accessRequests[1].state).toBe('void');
    later(DAY + HOUR);
    await guest.remote.requestAccess(FILE);
    expect(server.accessRequests[1].state).toBe('pending');
  });

  it('un void de una página de la papelera: restaurada, se vuelve a mirar recién pasado el día', async () => {
    const { server, guest, report, later } = await setup();
    server.pages.get(report)!.deleted_at = new Date(server.now()).toISOString();
    await guest.remote.requestPageAccess(report);
    expect(server.accessRequests[0].state).toBe('void');
    server.pages.get(report)!.deleted_at = null;
    later(2 * HOUR);
    await guest.remote.requestPageAccess(report);
    expect(server.accessRequests[0].state).toBe('void');
    later(DAY);
    await guest.remote.requestPageAccess(report);
    expect(server.accessRequests[0].state).toBe('pending');
  });
});

describe('el servidor en memoria: los 30 días (LF14; O2 de la auditoría de E2)', () => {
  it('29 días y 23 horas se lista y se decide; 30 días y 1 hora ni se lista ni se decide; renovar lo trae', async () => {
    const { server, guest, scene, later, decide } = await setup();
    await guest.remote.requestAccess(FILE);
    await guest.remote.requestPageAccess(scene);
    const [file, page] = server.accessRequests;
    later(29 * DAY + 23 * HOUR);
    expect((await decide.pending()).map((r) => r.id).sort()).toEqual([file.id, page.id].sort());
    later(2 * HOUR);
    expect(await decide.pending()).toEqual([]);
    for (const r of [file, page]) {
      await expect(decide.decide(r.id, true, scene, 'view')).rejects.toMatchObject({ message: 'request_not_found' });
      await expect(decide.decide(r.id, false, null, 'view')).rejects.toMatchObject({ message: 'request_not_found' });
    }
    expect(server.accessRequests.map((r) => r.state)).toEqual(['pending', 'pending']);
    expect(server.grants.some((g) => g.user_id === CLIENTA)).toBe(false);
    // Pedir de nuevo lo renueva (más de una hora) y vuelve a la lista con la hora nueva.
    await guest.remote.requestPageAccess(scene);
    expect((await decide.pending()).map((r) => r.id)).toEqual([page.id]);
    expect(await decide.decide(page.id, true, scene, 'view')).toBe('accepted');
  });
});

describe('el servidor en memoria: un archivo en la papelera de Drive', () => {
  it('pedirlo deja un void; uno pendiente que se manda a Drive sale de la lista y no se decide', async () => {
    const { server, guest, scene, decide } = await setup();
    await guest.remote.requestAccess(FILE);
    expect(server.accessRequests[0].state).toBe('pending');
    const f = server.mediaFiles.get(FILE)!;
    Object.assign(f, { trashed_at: new Date().toISOString(), purged_at: new Date().toISOString() });
    expect(await decide.pending()).toEqual([]);
    await expect(decide.decide(server.accessRequests[0].id, true, scene, 'view')).rejects.toMatchObject({ message: 'request_not_found' });
    const other = '00000000-0000-4000-8000-0000000000a4';
    server.addMember(other, 'member', 'otro@wanka.tv');
    const second = await makeDevice(server, undefined, undefined, undefined, undefined, { id: other });
    devices.push(second);
    expect(await second.remote.requestAccess(FILE)).toBe('sent');
    expect(server.accessRequests[1].state).toBe('void');
    Object.assign(f, { trashed_at: null, purged_at: null });
    expect((await decide.pending()).map((r) => r.userId)).toEqual([CLIENTA]);
  });
});
