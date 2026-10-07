import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { Permissions } from './access';
import { linkAuthorName } from './history';
import { block, group } from './historyTesting';
import { LINK_PUSH_MAX_BYTES } from './linkRemote';
import { addPublicLink, makeLinkDevice, resetPublicLink, type LinkDevice } from './linkTesting';
import { CONTENT_FRAGMENT } from './structure';
import { FakeServer, makeDevice, type Device } from './testing';

// El link público con *Can edit*, entrega 2a (Docs/Doc_Link_Publico.md, E2.14.3): el visitante y los editores con el
// motor de verdad (`SyncEngine`, `PageDocs`, IndexedDB en memoria) contra el servidor en memoria con las reglas de
// 20261028120000_link_editar.sql: lo que escribe el link espera en la sala, un editor que arma bases lo prueba y lo
// admite, y el visitante lo recibe con la base siguiente. Cada texto es una marca única (`<tN>`): se busca en los bytes.

const TOKEN_RE = /<t\d+>/g;

const devices: Device[] = [];
const visitors: LinkDevice[] = [];
const swallow = (e: unknown) => {
  if (String(e).includes('closed') || String(e).includes('InvalidStateError')) return;
  throw e;
};
process.on('unhandledRejection', swallow);
afterAll(() => {
  process.off('unhandledRejection', swallow);
});
afterEach(async () => {
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    try {
      d.db.close();
      d.mediaDb.close();
      d.commentsDb.close();
    } catch {
      // ya cerrada
    }
  }
  for (const v of visitors.splice(0)) {
    await v.engine.stop();
    try {
      v.db.close();
    } catch {
      // ya cerrada
    }
  }
});

async function stored(db: Device['db'], pageId: string): Promise<Uint8Array[]> {
  return (await db.getAllFromIndex('docUpdates', 'pageId', pageId)).map((r) => r.data);
}
function tokens(list: Uint8Array[]): Set<string> {
  const out = new Set<string>();
  for (const bytes of list) for (const m of Buffer.from(bytes).toString('latin1').match(TOKEN_RE) ?? []) out.add(m);
  return out;
}
/** Lo que hay en el servidor (las filas de la página), como texto. */
function serverTokens(server: FakeServer, pageId: string): Set<string> {
  return tokens((server.updates.get(pageId) ?? []).map((u) => u.data));
}

/** Escribe en la página como el editor: un párrafo nuevo con la marca, al final. */
async function write(d: { docs: Device['docs'] }, pageId: string, tok: string, id = tok.replace(/\W/g, '')): Promise<void> {
  const doc = await d.docs.open(pageId);
  doc.transact(() => group(doc).push([block(id, `${tok} `)]), 'test');
  await d.docs.flush(pageId);
  d.docs.close(pageId);
}
/** Borra el párrafo con la marca. */
async function erase(d: { docs: Device['docs'] }, pageId: string, tok: string): Promise<void> {
  const doc = await d.docs.open(pageId);
  doc.transact(() => {
    const g = group(doc);
    for (let i = 0; i < g.length; i++) {
      if (JSON.stringify((g.get(i) as Y.XmlElement).toJSON()).includes(tok)) {
        g.delete(i, 1);
        return;
      }
    }
  }, 'test');
  await d.docs.flush(pageId);
  d.docs.close(pageId);
}
/** Lo que el visitante tiene en la página (su documento). */
async function visible(v: LinkDevice, pageId: string): Promise<Set<string>> {
  const doc = await v.docs.open(pageId);
  const out = tokens([new TextEncoder().encode(JSON.stringify(doc.getXmlFragment(CONTENT_FRAGMENT).toJSON()))]);
  v.docs.close(pageId);
  return out;
}

/** Un workspace con equipo, D14 y Can edit prendidos: el dueño tiene R › S › H, con contenido en S y H. */
async function setup({ editMin = 0.1 }: { editMin?: number } = {}) {
  const server = new FakeServer();
  let clock = Date.parse('2026-10-03T10:00:00Z');
  server.now = () => clock;
  server.enableTeam();
  server.enableClean(0.1);
  server.enableLinkEdit(editMin);
  const e1 = await makeDevice(server, undefined, '0.200');
  devices.push(e1);
  const r = await e1.tree.create(null, 'R');
  const s = await e1.tree.create(r, 'S');
  const h = await e1.tree.create(s, 'H');
  await e1.engine.syncNow();
  await write(e1, s, '<t1>');
  await write(e1, h, '<t2>');
  await e1.engine.syncNow();
  return { server, e1, r, s, h, tick: (ms: number) => (clock += ms) };
}

async function visitor(server: FakeServer, token: string, opts: { device?: string; version?: string; name?: string } = {}): Promise<LinkDevice> {
  const v = await makeLinkDevice(server, token, opts.device, opts.version ?? '0.200', opts.name ?? 'Ana');
  visitors.push(v);
  return v;
}

/** Un ciclo del editor que admite y arma bases sin esperar la cadencia (la fila admitida tiene la hora de la admisión). */
async function editorRound(e: Device, tick: (ms: number) => void, pageIds: string[]): Promise<void> {
  await e.engine.syncNow();
  tick(25_000);
  await e.engine.syncNow();
  await e.engine.prepareBases(pageIds);
}

describe('Can edit por un link, con el motor de verdad', () => {
  it('el visitante escribe sin red y con red; espera en la sala; un editor lo admite; el equipo lo ve como del link y él lo recibe en la base', async () => {
    const { server, e1, s, tick } = await setup();
    const token = addPublicLink(server, s, server.ownerId, 'edit');
    await e1.engine.syncNow();
    await e1.engine.prepareBases([s]);
    const v = await visitor(server, token);
    await v.engine.syncNow();
    expect(v.remote.opened?.level).toBe('edit');
    expect(await v.engine.prefetchPage(s)).toBe(true);
    // Sin red: queda en el dispositivo.
    server.online = false;
    await write(v, s, '<t3>');
    await v.engine.syncNow();
    expect(await v.docs.unsyncedPages()).toEqual([s]);
    expect(server.linkRoom).toHaveLength(0);
    // Con red: a la sala, nunca a la página.
    server.online = true;
    const before = server.updates.get(s)!.length;
    await v.engine.syncNow();
    expect(await v.docs.unsyncedPages()).toEqual([]);
    expect(server.linkRoom).toHaveLength(1);
    expect(server.linkRoom[0]).toMatchObject({ pageId: s, author: 'Ana', decidedAt: null });
    expect(server.updates.get(s)!.length).toBe(before);
    expect(serverTokens(server, s).has('<t3>')).toBe(false);
    // El visitante sabe que espera.
    await v.remote.refreshEdits(true);
    expect(v.remote.linkEdits().waiting).toEqual([s]);

    // El editor lo admite: entra a la página con el nombre del visitante y sin cuenta.
    await editorRound(e1, tick, [s]);
    expect(server.linkRoom[0]).toMatchObject({ decision: 'admitted', data: null });
    const row = server.updates.get(s)!.at(-1)!;
    expect(row).toMatchObject({ createdBy: null, plinkAuthor: 'Ana' });
    expect(serverTokens(server, s).has('<t3>')).toBe(true);
    // El historial lo muestra como del link.
    const history = await e1.remote.pageHistory(s, 0, 100);
    expect(linkAuthorName(history.at(-1)!.createdBy)).toBe('Ana');
    // El editor lo baja y arma la base; el visitante la recibe (Yjs no duplica nada).
    await e1.engine.syncNow();
    expect(tokens(await stored(e1.db, s)).has('<t3>')).toBe(true);
    await e1.engine.prepareBases([s]);
    await v.engine.syncNow();
    expect(await visible(v, s)).toEqual(new Set(['<t1>', '<t3>']));
    await v.remote.refreshEdits(true);
    expect(v.remote.linkEdits()).toMatchObject({ waiting: [], aside: [] });
    // Lo pedido por el visitante fue solo plink_* (nunca la admisión).
    expect(v.calls.every((c) => c.fn.startsWith('plink_'))).toBe(true);
  });

  it('con una rama más grande que el tope de la API y un pedido del árbol que falla a mitad: lo que el visitante escribió sin subir sigue en su dispositivo y sube después', async () => {
    const { server, e1, s, h } = await setup();
    const token = addPublicLink(server, s, server.ownerId, 'edit');
    await e1.engine.syncNow();
    await e1.engine.prepareBases([s]);
    const v = await visitor(server, token);
    await v.engine.syncNow();
    expect(await v.engine.prefetchPage(s)).toBe(true);
    await write(v, s, '<t3>');
    // La rama crece a 302 páginas y la API entrega de a 137: el segundo pedido del árbol de esta vuelta no llega.
    for (let i = 0; i < 300; i++) {
      const id = `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`;
      server.pages.set(id, { ...server.pages.get(h)!, id, title: `Hija ${i}` });
    }
    server.linkMaxRows = 137;
    const whole = server.branch.bind(server);
    let asked = 0;
    server.branch = (id) => {
      if (++asked === 2) throw new TypeError('Failed to fetch');
      return whole(id);
    };
    await v.engine.syncNow();
    expect(asked).toBe(2);
    // El árbol que tenía (S y H, ni una de más) y lo escrito, todavía sin subir.
    expect(v.tree.children(s).map((p) => p.id)).toEqual([h]);
    expect(await visible(v, s)).toEqual(new Set(['<t1>', '<t3>']));
    expect(await v.docs.unsyncedPages()).toEqual([s]);
    // La vuelta siguiente: la rama entera y lo escrito en la sala.
    await v.engine.syncNow();
    expect(v.tree.children(s)).toHaveLength(301);
    expect(await v.docs.unsyncedPages()).toEqual([]);
    expect(server.linkRoom).toMatchObject([{ pageId: s, author: 'Ana' }]);
    expect(await visible(v, s)).toEqual(new Set(['<t1>', '<t3>']));
  });

  it('mientras la rama no deja de cambiar (y no entra en una respuesta), lo que el visitante escribe sube igual, con el árbol que tenía', async () => {
    const { server, e1, s, h } = await setup();
    const token = addPublicLink(server, s, server.ownerId, 'edit');
    await e1.engine.syncNow();
    await e1.engine.prepareBases([s]);
    const v = await visitor(server, token);
    await v.engine.syncNow();
    expect(await v.engine.prefetchPage(s)).toBe(true);
    await write(v, s, '<t3>');
    // Dos páginas y la API entrega de a una; entre dos pedidos del árbol siempre cambia algo (un título).
    server.linkMaxRows = 1;
    const whole = server.branch.bind(server);
    let asked = 0;
    server.branch = (id) => {
      server.pages.set(h, { ...server.pages.get(h)!, title: `H ${++asked}` });
      return whole(id);
    };
    await v.engine.syncNow();
    expect(asked).toBeGreaterThan(1);
    expect(v.engine.getStatus().lastError).toBeNull();
    expect(v.tree.get(h)?.title).toBe('H');
    expect(await v.docs.unsyncedPages()).toEqual([]);
    expect(server.linkRoom).toMatchObject([{ pageId: s, author: 'Ana' }]);
    // La rama se queda quieta: después de la espera, el árbol nuevo.
    server.branch = whole;
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 60_000);
    try {
      await v.engine.syncNow();
    } finally {
      clock.mockRestore();
    }
    expect(v.tree.get(h)?.title).toBe(`H ${asked}`);
  });

  it('el visitante escribe solo el contenido: ni el título, ni los ajustes, ni el asistente, ni reemplazar en el proyecto', async () => {
    const { server, e1, s, h } = await setup();
    const token = addPublicLink(server, s, server.ownerId, 'edit');
    await e1.engine.prepareBases([s, h]);
    const v = await visitor(server, token);
    await v.engine.syncNow();
    const perms = new Permissions(v.tree, v.access.get(), v.access.userId);
    expect(perms.canEditPage(s)).toBe(true);
    expect(perms.canEditPage(h)).toBe(true);
    expect(perms.canEditRow(s)).toBe(false);
    expect(perms.canManagePage(s)).toBe(false);
    expect(perms.viaLink).toBe(true);
    // El equipo, como siempre.
    const team = new Permissions(e1.tree, e1.access.get(), e1.access.userId);
    expect(team.canEditRow(s)).toBe(true);
    expect(team.viaLink).toBe(false);
  });

  it('las filas para probar son solo las del servidor: con algo propio sin subir, no hay (savedRows)', async () => {
    const { server, e1, s } = await setup();
    const seq = server.pages.get(s)!.update_seq;
    expect('rows' in (await e1.docs.savedRows(s, seq))).toBe(true);
    server.online = false;
    await write(e1, s, '<t9>');
    expect(await e1.docs.savedRows(s, seq)).toEqual({ skip: 'unsynced' });
    expect(await e1.docs.savedRows(s, seq + 1)).toEqual({ skip: 'not current' });
    server.online = true;
    await e1.engine.syncNow();
    const after = await e1.docs.savedRows(s, server.pages.get(s)!.update_seq);
    expect('rows' in after && tokens(after.rows).has('<t9>')).toBe(true);
  });

  it('dos editores admiten a la vez: una sola decisión, sin filas repetidas', async () => {
    const { server, e1, s, tick } = await setup();
    server.addMember('ed2', 'member');
    server.grant('ed2', { pageId: s }, 'edit');
    const e2 = await makeDevice(server, undefined, '0.200', {}, undefined, { id: 'ed2' });
    devices.push(e2);
    const token = addPublicLink(server, s, server.ownerId, 'edit');
    await e1.engine.prepareBases([s]);
    const v = await visitor(server, token);
    await v.engine.syncNow();
    await v.engine.prefetchPage(s);
    await write(v, s, '<t3>');
    await write(v, s, '<t4>');
    await v.engine.syncNow();
    await e2.engine.syncNow();
    await e1.engine.syncNow();
    tick(25_000);
    await Promise.all([e1.engine.syncNow(), e2.engine.syncNow()]);
    const linkRows = server.updates.get(s)!.filter((u) => u.plinkAuthor);
    expect(linkRows.length).toBe(server.linkRoom.filter((r) => r.decision === 'admitted').length);
    expect(new Set(linkRows.map((u) => u.clientUpdateId)).size).toBe(linkRows.length);
    expect(server.linkRoom.every((r) => r.decision === 'admitted')).toBe(true);
  });

  it('un editor con una versión más vieja que la fila no la decide; uno más nuevo sí', async () => {
    const { server, e1, s, tick } = await setup();
    const token = addPublicLink(server, s, server.ownerId, 'edit');
    await e1.engine.prepareBases([s]);
    const v = await visitor(server, token, { version: '0.300' });
    await v.engine.syncNow();
    await v.engine.prefetchPage(s);
    await write(v, s, '<t3>');
    await v.engine.syncNow();
    await editorRound(e1, tick, [s]);
    expect(server.linkRoom[0].decidedAt).toBeNull();
    expect(server.admitCalls.some((c) => c.startsWith('work:'))).toBe(false);
    const e3 = await makeDevice(server, undefined, '0.300');
    devices.push(e3);
    await editorRound(e3, tick, [s]);
    expect(server.linkRoom[0].decision).toBe('admitted');
  });

  it('Reset link con filas esperando: quedan apartadas (link_revoked); el visitante ve que el link no anda y no pierde nada', async () => {
    const { server, e1, s, tick } = await setup();
    const token = addPublicLink(server, s, server.ownerId, 'edit');
    await e1.engine.prepareBases([s]);
    const v = await visitor(server, token);
    await v.engine.syncNow();
    await v.engine.prefetchPage(s);
    await write(v, s, '<t3>');
    await v.engine.syncNow();
    resetPublicLink(server, token);
    expect(server.linkRoom[0]).toMatchObject({ decision: 'aside', reason: 'link_revoked' });
    expect(server.linkRoom[0].data).not.toBeNull();
    await editorRound(e1, tick, [s]);
    expect(serverTokens(server, s).has('<t3>')).toBe(false);
    // El visitante escribe algo más: el link no anda; lo suyo sigue en el dispositivo.
    await write(v, s, '<t4>');
    await v.engine.syncNow();
    expect(v.problems).toContain('link_not_found');
    expect(await v.docs.unsyncedPages()).toEqual([s]);
    expect(await visible(v, s)).toEqual(new Set(['<t1>', '<t3>', '<t4>']));
  });

  it('vencer con filas esperando: quedan retenidas (no traban a nadie) y entran si se le saca el vencimiento', async () => {
    const { server, e1, s, h, tick } = await setup();
    const token = addPublicLink(server, s, server.ownerId, 'edit');
    await e1.engine.prepareBases([s, h]);
    const v = await visitor(server, token);
    await v.engine.syncNow();
    await v.engine.prefetchPage(s);
    await write(v, s, '<t3>');
    await v.engine.syncNow();
    server.publicLinks.get(token)!.expired = true;
    await editorRound(e1, tick, [s]);
    expect(server.linkRoom[0].decidedAt).toBeNull();
    expect((await e1.remote.linkUpdatesOf(s)).map((u) => u.state)).toEqual(['held']);
    server.publicLinks.get(token)!.expired = false;
    await editorRound(e1, tick, [s]);
    expect(server.linkRoom[0].decision).toBe('admitted');
  });

  it('una página en la que el editor está escribiendo espera la pausa (20 s) sin bajar sus bytes; las demás no', async () => {
    const { server, e1, s, h, tick } = await setup();
    const token = addPublicLink(server, s, server.ownerId, 'edit');
    await e1.engine.prepareBases([s, h]);
    const v = await visitor(server, token);
    await v.engine.syncNow();
    await v.engine.prefetchPage(s);
    await v.engine.prefetchPage(h);
    await write(v, s, '<t3>');
    await write(v, h, '<t4>');
    await v.engine.syncNow();
    // El editor escribe en S (en H escribió hace rato) y la tiene al día: la saltea solo por la pausa.
    tick(25_000);
    await write(e1, s, '<t5>');
    await e1.engine.syncNow();
    await e1.engine.syncNow();
    expect((await e1.docs.stateOf(s))?.cursor).toBe(server.pages.get(s)!.update_seq);
    const works = server.admitCalls.filter((c) => c.startsWith('work:'));
    expect(works.length).toBeGreaterThan(0);
    for (const w of works) expect(w.includes(s)).toBe(false);
    expect(server.linkRoom.find((r) => r.pageId === h)?.decision).toBe('admitted');
    expect(server.linkRoom.find((r) => r.pageId === s)?.decidedAt).toBeNull();
    // Después de la pausa, S también.
    tick(25_000);
    await e1.engine.syncNow();
    expect(server.linkRoom.find((r) => r.pageId === s)?.decision).toBe('admitted');
  });

  it('una página que el editor no tiene como el servidor (algo propio rechazado) no baja sus bytes', async () => {
    const { server, e1, s, h, tick } = await setup();
    const token = addPublicLink(server, s, server.ownerId, 'edit');
    await e1.engine.prepareBases([s, h]);
    const v = await visitor(server, token);
    await v.engine.syncNow();
    await v.engine.prefetchPage(s);
    await v.engine.prefetchPage(h);
    await write(v, s, '<t3>');
    await write(v, h, '<t4>');
    await v.engine.syncNow();
    // El editor escribió en S algo que el servidor rechaza (queda sin subir): pasada la pausa, S sigue sin estar lista.
    server.maxUpdateBytes = 50;
    await write(e1, s, `<t5>${'x'.repeat(200)}`);
    tick(25_000);
    await e1.engine.syncNow();
    await e1.engine.syncNow();
    expect((await e1.docs.stateOf(s))?.rejected).toBe('update_size_invalid');
    const works = server.admitCalls.filter((c) => c.startsWith('work:'));
    expect(works.length).toBeGreaterThan(0);
    for (const w of works) expect(w.includes(s)).toBe(false);
    expect(server.linkRoom.find((r) => r.pageId === h)?.decision).toBe('admitted');
    expect(server.linkRoom.find((r) => r.pageId === s)?.decidedAt).toBeNull();
  });

  it('dos editores con decisiones distintas: el segundo corta esa página y la vuelve a probar en el ciclo siguiente', async () => {
    const { server, e1, s, tick } = await setup();
    const token = addPublicLink(server, s, server.ownerId, 'edit');
    await e1.engine.prepareBases([s]);
    const v = await visitor(server, token);
    await v.engine.syncNow();
    await v.engine.prefetchPage(s);
    await write(v, s, '<t3>');
    await v.engine.syncNow();
    await write(v, s, '<t4>');
    await v.engine.syncNow();
    expect(server.linkRoom).toHaveLength(2);
    // Otro editor (con otra versión) apartó la primera antes.
    server.admit(server.ownerId, '0.200', s, [{ id: server.linkRoom[0].id, ok: false, reason: 'bad_shape' }]);
    await editorRound(e1, tick, [s]);
    // La segunda dependía de la primera (el mismo autor de Yjs): en la vuelta siguiente queda apartada como pendiente.
    expect(server.linkRoom.map((r) => r.decision)).toEqual(['aside', 'aside']);
    expect(server.linkRoom[1].reason).toBe('pending');
    expect(serverTokens(server, s).has('<t4>')).toBe(false);
    // El visitante lo ve apartado.
    await v.remote.refreshEdits(true);
    expect(v.remote.linkEdits().aside).toEqual([s]);
  });

  it('una subida de más de 1 MB no se manda (R1); deshacer el pegado la destraba sin reabrir la app', async () => {
    const { server, e1, s } = await setup();
    const token = addPublicLink(server, s, server.ownerId, 'edit');
    await e1.engine.prepareBases([s]);
    const v = await visitor(server, token);
    await v.engine.syncNow();
    await v.engine.prefetchPage(s);
    // Un pegado enorme: se arma con GC (LE13) y pasa igual el tope.
    await write(v, s, `<t3>${'x'.repeat(LINK_PUSH_MAX_BYTES + 10)}`, 'big');
    await v.engine.syncNow();
    expect(server.linkRoom).toHaveLength(0);
    expect(v.calls.some((c) => c.fn === 'plink_push_page_update')).toBe(false);
    expect((await v.docs.stateOf(s))?.rejected).toBe('update_size_invalid');
    // Seguir escribiendo sin deshacer: tampoco manda nada.
    await v.engine.syncNow();
    expect(v.calls.some((c) => c.fn === 'plink_push_page_update')).toBe(false);
    // Deshacer (borrar el pegado) y seguir: la primera edición guardada saca el rechazo y sube con GC.
    await erase(v, s, '<t3>');
    await write(v, s, '<t4>');
    await v.engine.syncNow();
    await v.engine.syncNow();
    expect((await v.docs.stateOf(s))?.rejected).toBeUndefined();
    expect(server.linkRoom.length).toBeGreaterThan(0);
    for (const r of server.linkRoom) expect(r.bytes).toBeLessThan(LINK_PUSH_MAX_BYTES);
  });

  it('si el link deja de andar entre bajar el árbol y subir, lo escrito queda rechazado en el dispositivo y sube con la edición guardada siguiente', async () => {
    const { server, e1, s } = await setup();
    const token = addPublicLink(server, s, server.ownerId, 'edit');
    await e1.engine.prepareBases([s]);
    const v = await visitor(server, token);
    await v.engine.syncNow();
    await v.engine.prefetchPage(s);
    // El link vence con el árbol de este ciclo ya bajado: la base contesta `link_not_found` recién a la subida.
    const link = server.publicLinks.get(token)!;
    const push = v.remote.pushUpdate.bind(v.remote);
    v.remote.pushUpdate = async (pageId, clientUpdateId, update) => {
      link.expired = true;
      return push(pageId, clientUpdateId, update);
    };
    await write(v, s, '<t3>');
    await v.engine.syncNow();
    expect((await v.docs.stateOf(s))?.rejected).toBe('link_not_found');
    expect(server.linkRoom).toHaveLength(0);
    // Lo escrito sigue en el dispositivo.
    expect(await v.docs.unsyncedPages()).toContain(s);
    expect((await visible(v, s)).has('<t3>')).toBe(true);

    // Le extienden el vencimiento: el link vuelve a andar. Sin una edición nueva, la página sigue rechazada.
    v.remote.pushUpdate = push;
    link.expired = false;
    await v.engine.syncNow();
    expect((await v.docs.stateOf(s))?.rejected).toBe('link_not_found');
    expect(server.linkRoom).toHaveLength(0);
    // La edición guardada siguiente saca el rechazo y sube todo: lo de antes y lo nuevo.
    await write(v, s, '<t4>');
    await v.engine.syncNow();
    await v.engine.syncNow();
    expect((await v.docs.stateOf(s))?.rejected).toBeUndefined();
    expect(tokens(server.linkRoom.flatMap((r) => (r.data ? [r.data] : [])))).toEqual(new Set(['<t3>', '<t4>']));
    expect(await v.docs.unsyncedPages()).not.toContain(s);
  });

  it('dos visitantes en la misma página: entra lo de los dos', async () => {
    const { server, e1, s, tick } = await setup();
    const token = addPublicLink(server, s, server.ownerId, 'edit');
    await e1.engine.prepareBases([s]);
    const a = await visitor(server, token, { device: 'dev-a-xxxxxxxxxxxxxxxxxx', name: 'Ana' });
    const b = await visitor(server, token, { device: 'dev-b-xxxxxxxxxxxxxxxxxx', name: 'Beto' });
    for (const x of [a, b]) {
      await x.engine.syncNow();
      await x.engine.prefetchPage(s);
    }
    await write(a, s, '<t3>');
    await write(b, s, '<t4>');
    await a.engine.syncNow();
    await b.engine.syncNow();
    await editorRound(e1, tick, [s]);
    expect(server.updates.get(s)!.filter((u) => u.plinkAuthor).map((u) => u.plinkAuthor).sort()).toEqual(['Ana', 'Beto']);
    await e1.engine.syncNow();
    await e1.engine.prepareBases([s]);
    await a.engine.syncNow();
    expect(await visible(a, s)).toEqual(new Set(['<t1>', '<t3>', '<t4>']));
  });

  it('sin el nombre no sube (queda en el dispositivo, el ciclo sigue); con el nombre, sí', async () => {
    const { server, e1, s } = await setup();
    const token = addPublicLink(server, s, server.ownerId, 'edit');
    await e1.engine.prepareBases([s]);
    const v = await visitor(server, token, { name: '' });
    await v.engine.syncNow();
    await v.engine.prefetchPage(s);
    await write(v, s, '<t3>');
    await v.engine.syncNow();
    expect(server.linkRoom).toHaveLength(0);
    expect(v.remote.linkEdits().needName).toBe(true);
    expect(v.engine.getStatus().lastError).toBeNull();
    v.name.value = 'Ana';
    v.remote.nameChanged();
    expect(v.remote.linkEdits().needName).toBe(false);
    await v.engine.syncNow();
    expect(server.linkRoom).toHaveLength(1);
  });

  it('una versión que no admite (como la publicada) no ve nada de la sala: sus filas son las de siempre', async () => {
    const { server, e1, s, tick } = await setup({ editMin: 0.25 });
    const token = addPublicLink(server, s, server.ownerId, 'edit');
    await e1.engine.prepareBases([s]);
    const v = await visitor(server, token, { version: '0.300' });
    await v.engine.syncNow();
    await v.engine.prefetchPage(s);
    await write(v, s, '<t3>');
    await v.engine.syncNow();
    // El editor de 0.200 (más vieja que el interruptor): ni pregunta.
    await editorRound(e1, tick, [s]);
    expect(server.admitCalls).toEqual([]);
    expect(tokens(await stored(e1.db, s)).has('<t3>')).toBe(false);
    // Un visitante con una app más vieja que el interruptor: Can view (no escribe).
    const old = await visitor(server, token, { version: '0.200', device: 'dev-old-xxxxxxxxxxxxxxxx' });
    await old.engine.syncNow();
    expect(old.remote.opened?.level).toBe('comment');
  });

  it('una foto de afuera de la rama: la base la aparta aunque el editor diga que sí', async () => {
    const { server, e1, r, s, tick } = await setup();
    const token = addPublicLink(server, s, server.ownerId, 'edit');
    await e1.engine.prepareBases([s]);
    // Una foto que usa R (arriba de la rama).
    const foreign = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    server.pageFiles.add(`${r}:${foreign}`);
    const v = await visitor(server, token);
    await v.engine.syncNow();
    await v.engine.prefetchPage(s);
    const doc = await v.docs.open(s);
    doc.transact(() => group(doc).push([block('ph', '', 'image', { url: `sdmedia://${foreign}` })]), 'test');
    await v.docs.flush(s);
    v.docs.close(s);
    await v.engine.syncNow();
    await editorRound(e1, tick, [s]);
    expect(server.linkRoom[0]).toMatchObject({ decision: 'aside', reason: 'foreign_media' });
    expect((await e1.remote.linkUpdatesOf(s)).map((u) => u.state)).toEqual(['aside']);
  });

  it('D14 con un visitante que escribe: lo que recibe un lector (otro link, Can view) estuvo visible en una base', async () => {
    const { server, e1, s, h, tick } = await setup();
    const editToken = addPublicLink(server, s, server.ownerId, 'edit');
    const viewToken = addPublicLink(server, h, server.ownerId, 'comment');
    await e1.engine.prepareBases([s, h]);
    const v = await visitor(server, editToken);
    const reader = await visitor(server, viewToken, { device: 'dev-r-xxxxxxxxxxxxxxxxxx' });
    await v.engine.syncNow();
    await v.engine.prefetchPage(h);
    await write(v, h, '<t3>');
    await v.engine.syncNow();
    // El editor borra su propio <t2> antes de cualquier base nueva.
    await erase(e1, h, '<t2>');
    await editorRound(e1, tick, [h]);
    await e1.engine.syncNow();
    await e1.engine.prepareBases([h]);
    await reader.engine.syncNow();
    await reader.engine.prefetchPage(h);
    // El lector abre H por primera vez después de la base nueva: recibe lo del visitante (admitido) y nunca lo que el
    // editor borró antes de esa base; lo que tiene es exactamente lo de la base vigente.
    const got = tokens(await stored(reader.db, h));
    expect(got).toEqual(new Set(['<t3>']));
    expect(tokens([server.cleanBases.get(h)!.state])).toEqual(got);
  });
});
