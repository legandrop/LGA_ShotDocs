import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { PageHistory, versionBreaks, type HistoryRow } from './history';
import { HistoryCache, historyDbName } from './historyCache';
import { loadHistory, markRestoreLater, settleRestores } from './historyLoad';
import type { HistoryRemote, NamedVersionsRemote } from './remote';
import { CONTENT_FRAGMENT } from './structure';
import { FakeRemote, FakeServer, makeDevice, type Device } from './testing';

// El historial con la caché, los nombres de versión y las marcas de restauración (P.18, entrega 3;
// Docs/Doc_Historial.md, secciones 8, 9 y 10), contra el servidor en memoria con las reglas de
// 20261011120000_versiones_con_nombre.sql.

const devices: Device[] = [];
const caches: HistoryCache[] = [];
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
  for (const c of caches.splice(0)) c.close();
});

async function device(server: FakeServer, user?: { id: string; email: string }): Promise<Device> {
  const d = await makeDevice(server, undefined, '9.999', {}, undefined, user ?? {});
  devices.push(d);
  return d;
}

async function cacheFor(): Promise<HistoryCache> {
  const c = await HistoryCache.open(historyDbName(`test-${crypto.randomUUID()}`));
  caches.push(c);
  return c;
}

function block(id: string, text: string): Y.XmlElement {
  const bc = new Y.XmlElement('blockContainer');
  bc.setAttribute('id', id);
  const p = new Y.XmlElement('paragraph');
  const t = new Y.XmlText();
  t.insert(0, text);
  p.insert(0, [t]);
  bc.insert(0, [p]);
  return bc;
}

async function write(d: Device, pageId: string, id: string, text: string): Promise<void> {
  const doc = await d.docs.open(pageId);
  doc.transact(() => {
    const f = doc.getXmlFragment(CONTENT_FRAGMENT);
    if (f.length === 0) f.insert(0, [new Y.XmlElement('blockGroup')]);
    (f.get(0) as Y.XmlElement).insert(0, [block(id, text)]);
  }, 'test');
  await d.docs.flush(pageId);
  d.docs.close(pageId);
  await d.engine.syncNow();
}

/** Cuenta los pedidos de `page_history` y desde qué `seq`. */
function counting(remote: FakeRemote): HistoryRemote & NamedVersionsRemote & { calls: number[] } {
  const calls: number[] = [];
  return Object.assign(Object.create(remote) as FakeRemote, {
    calls,
    pageHistory: (p: string, after: number, limit: number) => {
      calls.push(after);
      return remote.pageHistory(p, after, limit);
    },
  });
}

async function setup(rows = 3) {
  const server = new FakeServer();
  let clock = Date.parse('2026-10-01T10:00:00Z');
  server.now = () => clock;
  const a = await device(server);
  const pageId = await a.tree.create(null, 'P');
  await a.engine.syncNow();
  for (let i = 0; i < rows; i++) {
    await write(a, pageId, `b${i}`, `texto ${i}`);
    clock += 60 * 60_000;
  }
  return { server, a, pageId, tick: (ms: number) => (clock += ms) };
}

const base = (remote: HistoryRemote & NamedVersionsRemote, pageId: string, cache: HistoryCache | null) => ({
  remote,
  pageId,
  cache,
  generation: 1,
  online: true,
  namedVersions: true,
});

describe('la caché del historial', () => {
  it('la primera vez baja todo y lo guarda; la segunda, solo lo nuevo (comprobando la última guardada)', async () => {
    const { server, a, pageId } = await setup(3);
    const cache = await cacheFor();
    const remote = counting(new FakeRemote(server));
    const first = await loadHistory(base(remote, pageId, cache));
    const total = first!.rows.length;
    expect(total).toBeGreaterThanOrEqual(3);
    expect(remote.calls).toEqual([0]);
    expect((await cache.read(pageId))?.rows.length).toBe(total);
    await write(a, pageId, 'nuevo', 'lo nuevo');
    remote.calls.length = 0;
    const second = await loadHistory(base(remote, pageId, cache));
    // Un solo pedido, desde la última guardada (que vuelve para comprobarla).
    expect(remote.calls).toEqual([first!.rows[total - 1].seq - 1]);
    expect(second!.rows.map((r) => r.seq)).toEqual((server.updates.get(pageId) ?? []).map((u) => u.seq));
    expect((await cache.read(pageId))?.rows.length).toBe(second!.rows.length);
    expect(second!.offlineAt).toBeNull();
  });

  it('sin red muestra lo guardado con cuándo se bajó; sin nada guardado, nada', async () => {
    const { server, pageId } = await setup(2);
    const cache = await cacheFor();
    const remote = new FakeRemote(server);
    await loadHistory({ ...base(remote, pageId, cache), now: () => 12345 });
    server.online = false;
    // El dispositivo sabe que no hay red.
    const offline = await loadHistory({ ...base(remote, pageId, cache), online: false });
    expect(offline?.offlineAt).toBe(12345);
    expect(offline?.rows.length).toBe((server.updates.get(pageId) ?? []).length);
    // El dispositivo cree que hay red pero el servidor no contesta: lo mismo.
    const unreachable = await loadHistory(base(remote, pageId, cache));
    expect(unreachable?.offlineAt).toBe(12345);
    expect(await loadHistory({ ...base(remote, pageId, await cacheFor()), online: false })).toBeNull();
    await expect(loadHistory(base(remote, pageId, await cacheFor()))).rejects.toThrow('Failed to fetch');
  });

  it('restauraron una copia de seguridad: los mismos seq son otras filas; lo guardado se tira y se baja todo', async () => {
    const { server, a, pageId } = await setup(2);
    const restore = server.backup();
    await write(a, pageId, 'despues', 'escrito después de la copia');
    const cache = await cacheFor();
    const remote = counting(new FakeRemote(server));
    await loadHistory(base(remote, pageId, cache));
    restore();
    // Otro dispositivo sube algo nuevo con los mismos seq.
    const b = await device(server);
    await b.engine.syncNow();
    await write(b, pageId, 'otro', 'otra cosa');
    remote.calls.length = 0;
    // Con la misma generación (no se enteró): la fila guardada ya no tiene ese id.
    const got = await loadHistory(base(remote, pageId, cache));
    expect(remote.calls[remote.calls.length - 1]).toBe(0);
    expect(got!.rows.map((r) => `${r.seq}:${r.id}`)).toEqual(
      (server.updates.get(pageId) ?? []).map((u) => `${u.seq}:${u.id}`),
    );
    // Con otra generación, lo guardado ni se mira.
    remote.calls.length = 0;
    await loadHistory({ ...base(remote, pageId, cache), generation: 99 });
    expect(remote.calls).toEqual([0]);
    expect((await cache.read(pageId))?.meta.generation).toBe(99);
  });

  it('si la base dice que ya no lo puede ver (sin permiso, en la papelera), se tira lo guardado', async () => {
    const { server, a, pageId } = await setup(1);
    const cache = await cacheFor();
    const remote = new FakeRemote(server);
    await loadHistory(base(remote, pageId, cache));
    expect(await cache.read(pageId)).not.toBeNull();
    await a.tree.trash(pageId);
    await a.engine.syncNow();
    await expect(loadHistory(base(remote, pageId, cache))).rejects.toThrow('page_in_trash');
    expect(await cache.read(pageId)).toBeNull();
  });
});

describe('versiones con nombre', () => {
  it('sin la migración (o con la base sin la función) no hay nombres, y el historial anda igual', async () => {
    const { server, pageId } = await setup(1);
    const remote = new FakeRemote(server);
    expect((await loadHistory({ ...base(remote, pageId, null), namedVersions: false }))?.versions).toBeNull();
    server.versionsMissing = true;
    const got = await loadHistory(base(remote, pageId, null));
    expect(got?.versions).toBeNull();
    expect(got?.rows.length).toBeGreaterThan(0);
  });

  it('nombrar, reintentar, renombrar y sacar; los cortes de las sesiones', async () => {
    const { server, a, pageId, tick } = await setup(1);
    const remote = new FakeRemote(server, '9.999');
    // Todo en una misma sesión (menos de 30 minutos entre filas).
    await write(a, pageId, 'x1', 'uno');
    tick(60_000);
    await write(a, pageId, 'x2', 'dos');
    tick(60_000);
    await write(a, pageId, 'x3', 'tres');
    const rows = (await loadHistory(base(remote, pageId, null)))!.rows;
    const mid = rows[rows.length - 2].seq;
    const v = await remote.namePageVersion('n1', pageId, mid, '  Antes   del cliente ');
    expect(v.label).toBe('Antes del cliente');
    expect((await remote.namePageVersion('n1', pageId, mid, 'otro')).label).toBe('Antes del cliente');
    await expect(remote.namePageVersion('n2', pageId, mid, 'otro')).rejects.toThrow('version_named');
    await expect(remote.namePageVersion('n1', pageId, mid - 1, 'x')).rejects.toThrow('version_conflict');
    await expect(remote.namePageVersion('n3', pageId, 9999, 'x')).rejects.toThrow('version_not_found');
    await expect(remote.namePageVersion('n3', pageId, mid, '  ')).rejects.toThrow('label_invalid');
    // La sesión se corta después del nombre: la versión con nombre es exactamente esa fila.
    const history = new PageHistory(rows, undefined, pageId);
    const before = history.sessions.length;
    const b = versionBreaks(await remote.listPageVersions(pageId));
    expect(history.setBreaks(b.after, b.before)).toBe(true);
    expect(history.setBreaks(b.after, b.before)).toBe(false);
    expect(history.sessions.length).toBe(before + 1);
    expect(history.sessions.some((s) => s.seq === mid)).toBe(true);
    // Lo que muestra esa versión es lo que había hasta el nombre (sin lo de después).
    const i = history.sessions.findIndex((s) => s.seq === mid);
    const doc = history.version(i);
    expect(JSON.stringify(doc.getXmlFragment(CONTENT_FRAGMENT).toJSON())).toContain('dos');
    expect(JSON.stringify(doc.getXmlFragment(CONTENT_FRAGMENT).toJSON())).not.toContain('tres');
    doc.destroy();
    history.destroy();
    expect((await remote.renamePageVersion('n1', 'Para el cliente')).label).toBe('Para el cliente');
    await remote.removePageVersion('n1');
    await remote.removePageVersion('n1');
    expect(await remote.listPageVersions(pageId)).toEqual([]);
    expect(server.versions.find((x) => x.id === 'n1')?.removedAt).not.toBeNull();
  });

  it('permisos: quien edita nombra; Ver, Comentar y un invitado con Editar no; renombrar, quien lo puso o nivel 4', async () => {
    const server = new FakeServer();
    server.enableTeam();
    server.writeVersionSince = 0.099;
    const owner = await device(server);
    const pageId = await owner.tree.create(null, 'P');
    await owner.engine.syncNow();
    await write(owner, pageId, 'x', 'hola');
    const seq = (server.updates.get(pageId) ?? []).at(-1)!.seq;
    for (const [id, role, level] of [
      ['ver', 'member', 'view'],
      ['comentar', 'member', 'comment'],
      ['editar', 'member', 'edit'],
      ['crear', 'member', 'edit_pages'],
      ['invitado', 'guest', 'edit'],
    ] as const) {
      server.addMember(id, role);
      server.grant(id, { projectId: server.workspaceId }, level);
    }
    const as = (id: string) => new FakeRemote(server, '9.999', id);
    for (const id of ['ver', 'comentar', 'invitado']) {
      await expect(as(id).namePageVersion(`v-${id}`, pageId, seq, 'x'), id).rejects.toThrow('page_not_found');
      await expect(as(id).listPageVersions(pageId), id).rejects.toThrow('page_not_found');
    }
    await as('editar').namePageVersion('de-editar', pageId, seq, 'De editar');
    await expect(as('crear').namePageVersion('otro', pageId, seq, 'x')).rejects.toThrow('version_named');
    await owner.engine.syncNow();
    // El dueño (nivel 4) y "Editar y crear" cambian uno ajeno; otro con Editar no.
    server.addMember('editar2', 'member');
    server.grant('editar2', { projectId: server.workspaceId }, 'edit');
    await expect(as('editar2').renamePageVersion('de-editar', 'x')).rejects.toThrow('not_allowed');
    await expect(as('editar2').removePageVersion('de-editar')).rejects.toThrow('not_allowed');
    expect((await as('crear').renamePageVersion('de-editar', 'Renombrada')).label).toBe('Renombrada');
    // La versión mínima (B.17): con la mínima en 0.099, una app sin header no escribe.
    server.settings = { ...server.settings!, minAppVersion: 0.099 };
    const old = as('editar');
    old.versionHeader = false;
    await expect(old.renamePageVersion('de-editar', 'Vieja')).rejects.toThrow('app_outdated');
    expect((await as('editar').listPageVersions(pageId))[0].label).toBe('Renombrada');
  });
});

describe('Restored from…', () => {
  it('después de restaurar, la primera fila propia que sube queda marcada; Undo antes de subir no la marca', async () => {
    const { server, a, pageId } = await setup(2);
    const remote = new FakeRemote(server, '9.999');
    const cache = await cacheFor();
    const rows = (await loadHistory(base(remote, pageId, cache)))!.rows;
    const fromSeq = rows[0].seq;
    const afterSeq = rows[rows.length - 1].seq;
    // Otra persona sube algo antes: no es la restauración.
    server.addMember('bea', 'member', 'bea@test');
    const b = await device(server, { id: 'bea', email: 'bea@test' });
    await b.engine.syncNow();
    await write(b, pageId, 'deb', 'de Bea');
    // "La restauración" (una edición propia), que sube con la sincronización que lanza la marca.
    const doc = await a.docs.open(pageId);
    doc.transact(() => ((doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement).insert(0, [block('r', 'restaurada')])), 'test');
    await a.docs.flush(pageId);
    a.docs.close(pageId);
    const pending = { id: 'm1', pageId, userId: server.ownerId, fromSeq, afterSeq, at: Date.now() };
    const mark = markRestoreLater({ remote, cache, engine: a.engine, docs: a.docs }, pending);
    await mark.done;
    const list = await remote.listPageVersions(pageId);
    expect(list.length).toBe(1);
    expect(list[0].kind).toBe('restore');
    expect(list[0].restoredFromSeq).toBe(fromSeq);
    const mine = (server.updates.get(pageId) ?? []).find((u) => u.seq > afterSeq && u.createdBy === server.ownerId)!;
    expect(list[0].seq).toBe(mine.seq);
    expect(await cache.restoresOf(pageId)).toEqual([]);
    // La sesión se corta antes de la restauración: la versión de antes sigue en la lista.
    const history = new PageHistory(await remote.pageHistory(pageId, 0, 500), undefined, pageId);
    const br = versionBreaks(list);
    history.setBreaks(br.after, br.before);
    expect(history.sessions.some((s) => history.rows[s.first].seq === mine.seq)).toBe(true);
    history.destroy();

    // Undo antes de que suba: no se marca.
    server.online = false;
    const doc2 = await a.docs.open(pageId);
    doc2.transact(() => ((doc2.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement).insert(0, [block('r2', 'otra')])), 'test');
    await a.docs.flush(pageId);
    a.docs.close(pageId);
    const last = (server.updates.get(pageId) ?? []).at(-1)!.seq;
    const second = markRestoreLater({ remote, cache, engine: a.engine, docs: a.docs }, { ...pending, id: 'm2', afterSeq: last });
    await new Promise((r) => setTimeout(r, 50));
    await second.cancel();
    server.online = true;
    await a.engine.syncNow();
    await settleRestores(remote, cache, pageId, await remote.pageHistory(pageId, 0, 500));
    expect((await remote.listPageVersions(pageId)).length).toBe(1);
  });

  it('una marca pendiente de antes (la app se cerró) se termina al abrir el historial; una ajena o imposible se deja', async () => {
    const { server, a, pageId } = await setup(2);
    const remote = new FakeRemote(server, '9.999');
    const cache = await cacheFor();
    const before = (server.updates.get(pageId) ?? []).at(-1)!.seq;
    await cache.addRestore({ id: 'p1', pageId, userId: server.ownerId, fromSeq: 1, afterSeq: before, at: Date.now() });
    // Una de otra persona (la fila no es suya): la base no la acepta y se deja de lado.
    await cache.addRestore({ id: 'p2', pageId, userId: 'nadie', fromSeq: 1, afterSeq: 0, at: Date.now() });
    await write(a, pageId, 'r', 'restaurada');
    const marked = await settleRestores(remote, cache, pageId, await remote.pageHistory(pageId, 0, 500));
    expect(marked.map((m) => m.id)).toEqual(['p1']);
    expect(await cache.restoresOf(pageId)).toEqual([
      expect.objectContaining({ id: 'p2' }),
    ]);
    // p2 sin fila propia sigue esperando hasta que pase una semana.
    await settleRestores(remote, cache, pageId, await remote.pageHistory(pageId, 0, 500), undefined, Date.now() + 8 * 24 * 3600_000);
    expect(await cache.restoresOf(pageId)).toEqual([]);
  });
});

describe('los cortes no cambian lo que hay', () => {
  it('cortar en cualquier fila da sesiones cuya versión es lo que tenía el servidor ahí', async () => {
    const { server, a, pageId, tick } = await setup(1);
    for (let i = 0; i < 6; i++) {
      await write(a, pageId, `c${i}`, `cambio ${i}`);
      tick(60_000);
    }
    const rows: HistoryRow[] = await new FakeRemote(server).pageHistory(pageId, 0, 500);
    const history = new PageHistory(rows, undefined, pageId);
    history.setBreaks(
      rows.filter((_, i) => i % 2 === 0).map((r) => r.seq),
      rows.filter((_, i) => i % 3 === 0).map((r) => r.seq),
    );
    for (let i = 0; i < history.sessions.length; i++) {
      const s = history.sessions[i];
      const ref = new Y.Doc();
      for (const r of rows.slice(0, s.last + 1)) Y.applyUpdate(ref, r.data);
      const doc = history.version(i);
      expect(JSON.stringify(doc.getXmlFragment(CONTENT_FRAGMENT).toJSON())).toBe(JSON.stringify(ref.getXmlFragment(CONTENT_FRAGMENT).toJSON()));
      doc.destroy();
      ref.destroy();
    }
    history.destroy();
  });
});
