import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { PageDocs as V100PageDocs } from './fixtures/v100/docs';
import { openLocalDb, type LocalDb } from './localDb';
import { mergeRootGroups, seedIfEmpty } from './structure';
import { FakeRemote, FakeServer, makeDevice, type Device } from './testing';

// La privacidad de lo borrado (Docs/Doc_Privacidad_Borrado.md, prueba 1 de la sección 9): quien no ve lo borrado
// (Ver, Comentar, invitados) recibe solo la última base limpia que arma el dispositivo de un editor, y nunca filas.
// Con el motor de verdad (`SyncEngine`, `PageDocs`, IndexedDB en memoria) y el servidor en memoria con las reglas de
// 20261010120000_privacidad_borrado.sql. Cada texto es una marca única (`<tN>`) para saber qué viajó: se busca en los
// bytes guardados en el dispositivo, no en la pantalla.

// La mutante del dispositivo: armar sin GC y sin la comprobación de privacidad.
const mut = vi.hoisted(() => ({ nogc: false }));
vi.mock('./clean', async (importOriginal) => {
  const real = await importOriginal<typeof import('./clean')>();
  return {
    ...real,
    buildCleanBase: (rows: Uint8Array[]) => {
      if (!mut.nogc) return real.buildCleanBase(rows);
      const doc = new Y.Doc({ gc: false });
      if (rows.length > 0) Y.applyUpdate(doc, Y.mergeUpdates(rows));
      return { base: Y.encodeStateAsUpdate(doc), doc };
    },
    checkCleanBase: (base: Uint8Array, source: Y.Doc) => (mut.nogc ? null : real.checkCleanBase(base, source)),
  };
});

const devices: Device[] = [];
const extraDbs: LocalDb[] = [];
async function device(server: FakeServer, id?: string): Promise<Device> {
  const d = await makeDevice(server, undefined, '0.101', {}, undefined, id ? { id } : {});
  devices.push(d);
  return d;
}

const swallow = (e: unknown) => {
  if (String(e).includes('closed') || String(e).includes('InvalidStateError')) return;
  throw e;
};
process.on('unhandledRejection', swallow);
afterAll(() => {
  process.off('unhandledRejection', swallow);
});
afterEach(async () => {
  mut.nogc = false;
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
  for (const db of extraDbs.splice(0)) db.close();
});

const TOKEN = /<t\d+>/g;
/** Las marcas que aparecen en los bytes (también las borradas que viajan con su texto). */
function tokensInBytes(list: Uint8Array[]): Set<string> {
  const out = new Set<string>();
  for (const bytes of list) for (const m of Buffer.from(bytes).toString('latin1').match(TOKEN) ?? []) out.add(m);
  return out;
}
/** Las marcas visibles del documento que arman esos bytes. */
function visibleTokens(list: Uint8Array[]): Set<string> {
  const doc = new Y.Doc();
  if (list.length > 0) Y.applyUpdate(doc, Y.mergeUpdates(list));
  const out = new Set(doc.getText('t').toString().match(TOKEN) ?? []);
  doc.destroy();
  return out;
}
const subset = (a: Set<string>, b: Set<string>) => [...a].filter((x) => !b.has(x));

/** Lo guardado de la página en el dispositivo. */
async function stored(d: Device, pageId: string): Promise<Uint8Array[]> {
  return (await d.db.getAllFromIndex('docUpdates', 'pageId', pageId)).map((r) => r.data);
}
async function text(d: Device, pageId: string): Promise<string> {
  const doc = new Y.Doc();
  const rows = await stored(d, pageId);
  if (rows.length > 0) Y.applyUpdate(doc, Y.mergeUpdates(rows));
  const t = doc.getText('t').toString();
  doc.destroy();
  return t;
}
async function edit(d: Device, pageId: string, fn: (t: Y.Text) => void): Promise<void> {
  const doc = await d.docs.open(pageId);
  doc.transact(() => fn(doc.getText('t')), 'test');
  await d.docs.flush(pageId);
  d.docs.close(pageId);
}
const add = (tok: string) => (t: Y.Text) => t.insert(t.length, `${tok} `);
const addFirst = (tok: string) => (t: Y.Text) => t.insert(0, `${tok} `);
const del = (tok: string) => (t: Y.Text) => {
  const i = t.toString().indexOf(`${tok} `);
  if (i >= 0) t.delete(i, tok.length + 1);
};

/** Lo que el dispositivo baja del servidor (cada respuesta de `pull_page_updates`). */
function recordPulls(d: Device): { all: Uint8Array[]; since: (mark: number) => Uint8Array[] } {
  const all: Uint8Array[] = [];
  const orig = d.remote.pullUpdates.bind(d.remote);
  d.remote.pullUpdates = async (pageId, after, limit) => {
    const got = await orig(pageId, after, limit);
    for (const u of got) all.push(u.data);
    return got;
  };
  return { all, since: (mark) => all.slice(mark) };
}

/** Un workspace con equipo y el interruptor prendido; el dueño (e1) tiene una página. */
async function setup({ clean = true }: { clean?: boolean } = {}) {
  const server = new FakeServer();
  let clock = Date.parse('2026-10-02T10:00:00Z');
  server.now = () => clock;
  server.enableTeam();
  if (clean) server.enableClean(0.1);
  const e1 = await device(server);
  const page = await e1.tree.create(null, 'P');
  await e1.engine.syncNow();
  return { server, e1, page, tick: (ms: number) => (clock += ms) };
}

/** Comparte como la app (ShareDialog): sube antes lo pendiente y después comparte. */
async function share(from: Device, server: FakeServer, uid: string, role: 'member' | 'guest', target: { pageId: string } | { projectId: string }, level: 'view' | 'comment' | 'edit') {
  if (!server.members.has(uid)) server.addMember(uid, role);
  const pages = 'pageId' in target ? from.engine.branchOf(target.pageId) : [];
  expect(await from.engine.uploadPagesFirst(pages)).toBe(true);
  await from.remote.share(uid, target, level);
}

describe('la base limpia: quién recibe qué', () => {
  it('quien solo ve recibe la base, sin lo escrito y borrado; sin base, la página está "en preparación"', async () => {
    const { server, e1, page } = await setup();
    await edit(e1, page, add('<t1>'));
    await edit(e1, page, add('<t2>'));
    await e1.engine.syncNow();
    await edit(e1, page, del('<t2>'));
    await e1.engine.syncNow();
    await share(e1, server, 'v', 'member', { pageId: page }, 'view');

    const v = await device(server, 'v');
    const pulls = recordPulls(v);
    await v.engine.syncNow();
    expect(await v.engine.contentGap(page)).toBe('preparing');
    expect(await v.engine.isMissingContent(page)).toBe(true);
    expect(pulls.all).toEqual([]);

    // El editor sincroniza: la página no tiene base y tiene un lector, así que la arma enseguida.
    await e1.engine.syncNow();
    expect(server.cleanPushes.map((p) => p.result)).toEqual(['ok']);
    await v.engine.syncNow();
    expect(await v.engine.contentGap(page)).toBe(null);
    expect(tokensInBytes(await stored(v, page))).toEqual(new Set(['<t1>']));
    expect(await text(v, page)).toBe(await text(e1, page));
    // El editor sigue bajando y teniendo las filas (con lo borrado).
    expect(tokensInBytes(await stored(e1, page)).has('<t2>')).toBe(true);
    // Lo guardado en el dispositivo del lector es la base sola, y una base nueva la reemplaza.
    expect((await stored(v, page)).length).toBe(1);
  });

  it('la cadencia: 20 s sin escribir, 2 minutos escribiendo; lo que dura menos no llega', async () => {
    const { server, e1, page, tick } = await setup();
    await edit(e1, page, add('<t1>'));
    await share(e1, server, 'v', 'member', { pageId: page }, 'view');
    await e1.engine.syncNow();
    const v = await device(server, 'v');
    const pulls = recordPulls(v);
    await v.engine.syncNow();
    expect(visibleTokens(await stored(v, page))).toEqual(new Set(['<t1>']));

    // Se escribe: recién subido, no se arma (ni la pausa ni los 2 minutos).
    await edit(e1, page, add('<t3>'));
    await e1.engine.syncNow();
    let mark = pulls.all.length;
    await v.engine.syncNow();
    expect(pulls.since(mark)).toEqual([]);
    // 25 s sin escribir: se arma.
    tick(25_000);
    await e1.engine.syncNow();
    await v.engine.syncNow();
    expect(visibleTokens(await stored(v, page))).toEqual(new Set(['<t1>', '<t3>']));

    // Algo que dura 10 s mientras se escribe no llega nunca.
    await edit(e1, page, add('<t4>'));
    await e1.engine.syncNow();
    tick(5_000);
    await edit(e1, page, del('<t4>'));
    await e1.engine.syncNow();
    tick(25_000);
    await e1.engine.syncNow();
    mark = pulls.all.length;
    await v.engine.syncNow();
    expect(pulls.since(mark).length).toBe(1);
    expect(tokensInBytes(pulls.all).has('<t4>')).toBe(false);

    // Escribiendo sin parar cada 10 s: a los 2 minutos se arma igual (con lo que está en ese momento).
    mark = pulls.all.length;
    for (let i = 0; i < 14; i++) {
      tick(10_000);
      await edit(e1, page, add(`<t${100 + i}>`));
      await e1.engine.syncNow();
      await v.engine.syncNow();
    }
    expect(pulls.since(mark).length).toBeGreaterThanOrEqual(1);
    for (const base of pulls.all) expect(subset(tokensInBytes([base]), visibleTokens([base]))).toEqual([]);
  });

  it('un invitado con Editar escribe sobre la base, sube lo suyo y nunca recibe lo borrado de los demás', async () => {
    const { server, e1, page, tick } = await setup();
    await edit(e1, page, add('<t1>'));
    await e1.engine.syncNow();
    await share(e1, server, 'g', 'guest', { pageId: page }, 'edit');
    await e1.engine.syncNow();
    const g = await device(server, 'g');
    const pulls = recordPulls(g);
    await g.engine.syncNow();
    expect(await text(g, page)).toBe(await text(e1, page));

    // El invitado escribe y sube: su cursor queda por delante de la base (no baja nada hasta una más nueva).
    await edit(g, page, add('<t2>'));
    await g.engine.syncNow();
    expect(server.updates.get(page)!.at(-1)!.createdBy).toBe('g');
    // Ningún invitado arma bases.
    expect(server.cleanPushes.every((p) => p.by !== 'g')).toBe(true);
    // El editor escribe un secreto y lo borra enseguida; después escribe algo que queda.
    await e1.engine.syncNow();
    await edit(e1, page, add('<t3>'));
    await e1.engine.syncNow();
    await edit(e1, page, del('<t3>'));
    await edit(e1, page, addFirst('<t4>'));
    await e1.engine.syncNow();
    await g.engine.syncNow();
    tick(25_000);
    await e1.engine.syncNow();
    await g.engine.syncNow();
    const mine = new Set(['<t2>']);
    const allowed = new Set([...pulls.all.flatMap((b) => [...visibleTokens([b])]), ...mine]);
    expect(subset(tokensInBytes(await stored(g, page)), allowed)).toEqual([]);
    expect(tokensInBytes(await stored(g, page)).has('<t3>')).toBe(false);
    expect(await text(g, page)).toBe(await text(e1, page));
  });

  it('un lector que pasa a editor baja las filas desde su base (ve lo borrado, como el historial) y puede armar', async () => {
    const { server, e1, page, tick } = await setup();
    await edit(e1, page, add('<t1>'));
    await edit(e1, page, add('<t2>'));
    await e1.engine.syncNow();
    await edit(e1, page, del('<t2>'));
    await share(e1, server, 'v', 'member', { pageId: page }, 'view');
    await e1.engine.syncNow();
    const v = await device(server, 'v');
    await v.engine.syncNow();
    expect(tokensInBytes(await stored(v, page)).has('<t2>')).toBe(false);
    // Le dan Editar: baja las filas siguientes a su base; con eso arma, porque hay otro lector.
    await share(e1, server, 'v', 'member', { pageId: page }, 'edit');
    await share(e1, server, 'c', 'member', { pageId: page }, 'comment');
    await edit(e1, page, add('<t3>'));
    await e1.engine.syncNow();
    await v.engine.syncNow();
    expect(await text(v, page)).toBe(await text(e1, page));
    tick(25_000);
    const before = server.cleanPushes.length;
    await v.engine.syncNow();
    expect(server.cleanPushes.slice(before).map((p) => [p.by, p.result])).toEqual([['v', 'ok']]);
  });

  it('un editor que pasa a invitado recibe solo bases desde entonces', async () => {
    const { server, e1, page, tick } = await setup();
    server.addMember('e2', 'member');
    server.grant('e2', { pageId: page }, 'edit');
    await edit(e1, page, add('<t1>'));
    await share(e1, server, 'v', 'member', { pageId: page }, 'view');
    await e1.engine.syncNow();
    const e2 = await device(server, 'e2');
    const pulls = recordPulls(e2);
    await e2.engine.syncNow();
    server.members.get('e2')!.role = 'guest';
    await e2.engine.syncNow();
    const mark = pulls.all.length;
    await edit(e1, page, add('<t2>'));
    await e1.engine.syncNow();
    await edit(e1, page, del('<t2>'));
    await e1.engine.syncNow();
    await e2.engine.syncNow();
    tick(25_000);
    await e1.engine.syncNow();
    await e2.engine.syncNow();
    const after = pulls.since(mark);
    expect(after.length).toBeGreaterThan(0);
    expect(tokensInBytes(after).has('<t2>')).toBe(false);
    for (const b of after) expect(subset(tokensInBytes([b]), visibleTokens([b]))).toEqual([]);
  });

  it('dos editores que arman a la vez no se pisan: gana una, la otra es clean_old', async () => {
    const { server, e1, page } = await setup();
    server.addMember('e2', 'member');
    server.grant('e2', { pageId: page }, 'edit');
    await edit(e1, page, add('<t1>'));
    await e1.engine.syncNow();
    const e2 = await device(server, 'e2');
    await e2.engine.syncNow();
    await share(e1, server, 'v', 'member', { pageId: page }, 'view');
    await Promise.all([e1.engine.prepareBases([page]), e2.engine.prepareBases([page])]);
    expect(server.cleanPushes.map((p) => p.result).sort()).toEqual(['clean_old', 'ok']);
    expect(server.currentBase(page)?.toSeq).toBe(server.pages.get(page)!.update_seq);
  });

  it('preparar después de compartir arma todas las páginas, también más de las 50 que da clean_work por pedido', async () => {
    const { server, e1, page } = await setup();
    const pages = [page];
    for (let i = 0; i < 120; i++) pages.push(await e1.tree.create(null, `P${i}`));
    for (const p of pages) await edit(e1, p, add('<t1>'));
    await e1.engine.syncNow();
    await share(e1, server, 'v', 'member', { projectId: server.workspaceId }, 'view');
    const seen: Array<[number, number]> = [];
    await e1.engine.prepareBases(pages, (d, t) => seen.push([d, t]));
    expect(pages.filter((p) => !server.currentBase(p))).toEqual([]);
    // (La vuelta de sincronización del principio ya arma algunas: el progreso cuenta las demás.)
    const [lastDone, lastTotal] = seen.at(-1)!;
    expect(lastDone).toBe(lastTotal);
    expect(lastDone).toBeGreaterThan(0);
    // El progreso nunca retrocede.
    for (let i = 1; i < seen.length; i++) expect(seen[i][0]).toBeGreaterThanOrEqual(seen[i - 1][0]);
  });

  it('una vista atrasada no arma; una base anterior a compartir se rechaza (clean_stale)', async () => {
    const { server, e1, page } = await setup();
    server.addMember('e2', 'member');
    server.grant('e2', { pageId: page }, 'edit');
    await edit(e1, page, add('<t1>'));
    await e1.engine.syncNow();
    const e2 = await device(server, 'e2');
    await e2.engine.syncNow();
    const seq = server.pages.get(page)!.update_seq;
    // e1 escribe una nota y la borra; e2 no bajó nada de eso.
    await edit(e1, page, add('<t2>'));
    await e1.engine.syncNow();
    await edit(e1, page, del('<t2>'));
    await e1.engine.syncNow();
    await share(e1, server, 'v', 'member', { pageId: page }, 'view');
    // Con el árbol atrasado (no bajó las filas nuevas), su dispositivo no la arma.
    expect(await e2.docs.buildCleanBase(page, server.pages.get(page)!.update_seq)).toEqual({ skip: 'not current' });
    // Armada a mano con su vista (anterior a compartir), la base la rechaza.
    const built = await e2.docs.buildCleanBase(page, seq);
    expect('base' in built).toBe(true);
    const { sha256Hex } = await import('./clean');
    const state = (built as { base: Uint8Array }).base;
    const row = server.updates.get(page)!.find((u) => u.seq === seq)!;
    expect(
      await e2.remote.pushCleanBase({ id: crypto.randomUUID(), pageId: page, toSeq: seq, lastUpdateId: row.id!, state, sha256: await sha256Hex(state) }),
    ).toBe('clean_stale');
    // Al sincronizar, e2 baja lo que falta y recién ahí arma (a la altura del reinicio, sin la nota).
    await e2.engine.syncNow();
    const v = await device(server, 'v');
    await v.engine.syncNow();
    expect(tokensInBytes(await stored(v, page)).has('<t2>')).toBe(false);
    expect(await text(v, page)).toBe(await text(e1, page));
  });

  it('sin red no se arma ni se baja nada; al volver, sí', async () => {
    const { server, e1, page } = await setup();
    await edit(e1, page, add('<t1>'));
    await e1.engine.syncNow();
    await share(e1, server, 'v', 'member', { pageId: page }, 'view');
    const v = await device(server, 'v');
    await v.engine.syncNow();
    server.online = false;
    await e1.engine.syncNow();
    await v.engine.syncNow();
    expect(server.cleanPushes).toEqual([]);
    expect(await v.engine.contentGap(page)).toBe('preparing');
    server.online = true;
    await e1.engine.syncNow();
    await v.engine.syncNow();
    expect(await text(v, page)).toBe(await text(e1, page));
  });

  it('una copia restaurada: con el script, las bases se vacían y se vuelven a armar; sin él, la del id viejo no se sirve', async () => {
    for (const keep of [false, true]) {
      const { server, e1, page, tick } = await setup();
      await edit(e1, page, add('<t1>'));
      await share(e1, server, 'v', 'member', { pageId: page }, 'view');
      await e1.engine.syncNow();
      const restore = server.backup();
      await edit(e1, page, add('<t2>'));
      await e1.engine.syncNow();
      tick(25_000);
      await e1.engine.syncNow();
      const v = await device(server, 'v');
      await v.engine.syncNow();
      expect(visibleTokens(await stored(v, page))).toEqual(new Set(['<t1>', '<t2>']));
      server.keepCleanBasesOnRestore = keep;
      restore();
      if (keep) {
        // La base vigente nombra una fila (`last_update_id`) que la copia no tiene: no se sirve.
        expect(server.currentBase(page)).toBe(null);
      }
      // Todos vuelven a subir lo suyo; el editor arma de nuevo y el lector termina igual.
      await e1.engine.syncNow();
      await v.engine.syncNow();
      tick(25_000);
      await e1.engine.syncNow();
      await v.engine.syncNow();
      expect(await text(v, page)).toBe(await text(e1, page));
    }
  });

  it('al pasar a segundo plano se arma enseguida; si la app se corta antes, el teléfono nuevo recibe la base anterior', async () => {
    for (const cut of [false, true]) {
      const { server, e1, page, tick } = await setup();
      await edit(e1, page, add('<t1>'));
      await share(e1, server, 'v', 'member', { pageId: page }, 'view');
      await e1.engine.syncNow();
      // Un secreto que queda más de 20 s: entra en una base.
      await edit(e1, page, add('<t2>'));
      await e1.engine.syncNow();
      tick(25_000);
      await e1.engine.syncNow();
      expect(visibleTokens([server.currentBase(page)!.state]).has('<t2>')).toBe(true);
      // Lo borra y cierra la app.
      await edit(e1, page, del('<t2>'));
      if (!cut) await e1.engine.appHidden();
      else await e1.engine.stop();
      const v = await device(server, 'v');
      await v.engine.syncNow();
      expect(tokensInBytes(await stored(v, page)).has('<t2>')).toBe(cut);
    }
  });
});

describe('compartir, invitar y mover', () => {
  it('compartir sube antes lo pendiente (R1): la nota borrada en la cola de quien comparte no llega', async () => {
    for (const first of [true, false]) {
      const { server, e1, page } = await setup();
      server.addMember('e2', 'member');
      server.grant('e2', { pageId: page }, 'edit');
      await edit(e1, page, add('<t1>'));
      await edit(e1, page, add('<t2>'));
      await e1.engine.syncNow();
      const e2 = await device(server, 'e2');
      await e2.engine.syncNow();
      // e1 borra la nota; el borrado queda en su cola (sin red un rato, o una subida lenta).
      await edit(e1, page, del('<t2>'));
      server.addMember('v', 'member');
      if (first) expect(await e1.engine.uploadPagesFirst([page])).toBe(true);
      await e1.remote.share('v', { pageId: page }, 'view');
      // Otro editor al día con el servidor arma la base.
      await e2.engine.syncNow();
      const v = await device(server, 'v');
      await v.engine.syncNow();
      // Con la subida antes, la base no tiene la nota; sin ella (la mutante), el lector la recibe.
      expect(tokensInBytes(await stored(v, page)).has('<t2>')).toBe(!first);
    }
  });

  it.each([null, 'noreset', 'noshare'] as const)(
    'compartir reinicia: una base de antes (con una nota que ya se borró) no le llega al nuevo lector (mutante %s)',
    async (which) => {
      const { server, e1, page, tick } = await setup();
      server.cleanMutant = which;
      server.addMember('w', 'member');
      server.grant('w', { pageId: page }, 'view');
      // Con un lector (w), la nota entra en una base y después se borra.
      await edit(e1, page, add('<t1>'));
      await edit(e1, page, add('<t2>'));
      await e1.engine.syncNow();
      expect(visibleTokens([server.currentBase(page)!.state]).has('<t2>')).toBe(true);
      await edit(e1, page, del('<t2>'));
      await e1.engine.syncNow();
      // Se comparte con v enseguida, antes de la próxima base.
      await share(e1, server, 'v', 'member', { pageId: page }, 'view');
      const v = await device(server, 'v');
      await v.engine.syncNow();
      // Lo que guarda la app y lo que da la API pedido a mano desde el principio (una versión vieja, otro cliente).
      const direct = (await new FakeRemote(server, '0.101', 'v').pullUpdates(page, 0, 500)).map((u) => u.data);
      expect(tokensInBytes([...(await stored(v, page)), ...direct]).has('<t2>')).toBe(which !== null);
      tick(25_000);
      await e1.engine.syncNow();
      await v.engine.syncNow();
      expect(await text(v, page)).toBe(await text(e1, page));
    },
  );

  it('sin poder subir lo pendiente, compartir avisa (uploadPagesFirst da false)', async () => {
    const { server, e1, page } = await setup();
    await edit(e1, page, add('<t1>'));
    server.online = false;
    expect(await e1.engine.uploadPagesFirst([page])).toBe(false);
    server.online = true;
    expect(await e1.engine.uploadPagesFirst([page])).toBe(true);
  });

  it('invitar a un invitado reinicia al invitar; mover una página a una rama con lectores la reinicia después de subir lo suyo', async () => {
    const { server, e1, page } = await setup();
    const other = await e1.tree.create(null, 'Q');
    await edit(e1, page, add('<t1>'));
    await edit(e1, other, add('<t2>'));
    await edit(e1, other, add('<t3>'));
    await e1.engine.syncNow();
    await e1.remote.createInvitation('cliente@test', 'guest', [{ page_id: page, level: 'view' }]);
    expect(server.meta(page).reset).toBe(server.pages.get(page)!.update_seq);
    expect(server.meta(other).reset).toBe(0);
    server.addMember('v', 'member');
    server.grant('v', { pageId: page }, 'view');
    // La nota de Q se borra y Q se mueve adentro de P sin sincronizar en el medio: el borrado sube antes que el movimiento.
    await edit(e1, other, del('<t3>'));
    await e1.tree.move(other, page);
    await e1.engine.syncNow();
    expect(server.meta(other).reset).toBe(server.pages.get(other)!.update_seq);
    const v = await device(server, 'v');
    await v.engine.syncNow();
    await e1.engine.syncNow();
    await v.engine.syncNow();
    expect(tokensInBytes(await stored(v, other)).has('<t3>')).toBe(false);
    expect(visibleTokens(await stored(v, other))).toEqual(new Set(['<t2>']));
  });

  it('los usos sacados de un archivo no se listan a quien no ve lo borrado', async () => {
    const { server, e1, page } = await setup();
    server.enableMedia();
    server.enableClean(0.1);
    server.pageFiles.add(`${page}:f-activo`);
    server.removedPageFiles.add(`${page}:f-sacado`);
    server.addMember('v', 'member');
    server.grant('v', { pageId: page }, 'view');
    const ids = async (r: FakeRemote) => (await r.fetchPageUses([page])).map((u) => u.file_id).sort();
    expect(await ids(e1.remote)).toEqual(['f-activo', 'f-sacado']);
    expect(await ids(new FakeRemote(server, '0.101', 'v'))).toEqual(['f-activo']);
  });
});

describe('las cuentas (clean.ts) y lo guardado en el dispositivo', () => {
  it('la comprobación de privacidad rechaza una base sin GC y la de contenido una que no es la del documento', async () => {
    const { buildCleanBase, checkCleanBase, coversLocal, contentGap, serverSeqFor } = await import('./clean');
    const src = new Y.Doc({ gc: false });
    src.getText('t').insert(0, '<t1> <t2> ');
    const rows = [Y.encodeStateAsUpdate(src)];
    src.getText('t').delete(5, 5);
    rows.push(Y.encodeStateAsUpdate(src));
    const good = buildCleanBase(rows);
    expect(checkCleanBase(good.base, good.doc)).toBe(null);
    expect(tokensInBytes([good.base])).toEqual(new Set(['<t1>']));
    // Sin GC: el texto borrado viaja en la base.
    expect(checkCleanBase(Y.encodeStateAsUpdate(src), good.doc)).toBe('deleted content');
    // Otra página: no es la del documento.
    const other = new Y.Doc();
    other.getText('t').insert(0, 'otra');
    expect(checkCleanBase(Y.encodeStateAsUpdate(other), good.doc)).toBe('different');
    // Una base cubre lo guardado si tiene todo lo de cada autor y sus borrados; una fila suelta, no.
    expect(coversLocal(rows, good.base)).toBe(true);
    const more = new Y.Doc();
    Y.applyUpdate(more, good.base);
    more.getText('t').insert(0, '<t3> ');
    expect(coversLocal([Y.encodeStateAsUpdate(more)], good.base)).toBe(false);
    // "Al día" para quien recibe bases: `clean_seq`; "en preparación" solo sin nada guardado.
    expect(serverSeqFor({ update_seq: 9, clean_seq: 4 }, true)).toBe(4);
    expect(serverSeqFor({ update_seq: 9, clean_seq: 4 }, false)).toBe(9);
    expect(contentGap({ update_seq: 9, clean_seq: 0 }, true, 0)).toBe('preparing');
    expect(contentGap({ update_seq: 9, clean_seq: 0 }, true, 4)).toBe(null);
    expect(contentGap({ update_seq: 9, clean_seq: 4 }, true, 3)).toBe('missing');
    expect(contentGap({ update_seq: 0, clean_seq: 0 }, true, 0)).toBe(null);
    good.doc.destroy();
  });

  it('una base no cubre lo guardado si lo guardado tiene piezas pendientes (que esperan algo que no llegó)', async () => {
    const { buildCleanBase, coversLocal } = await import('./clean');
    // A escribe; B, con lo de A, sigue escribiendo. Lo guardado tiene solo la fila de B: sus piezas cuelgan de las de
    // A, que no están, y quedan pendientes (no cuentan en el vector de estado ni en los borrados).
    const a = new Y.Doc();
    a.getText('t').insert(0, '<t1> ');
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const before = Y.encodeStateVector(b);
    b.getText('t').insert(5, '<t2> ');
    const onlyB = Y.encodeStateAsUpdate(b, before);
    const probe = new Y.Doc();
    Y.applyUpdate(probe, onlyB);
    expect(probe.store.pendingStructs).not.toBe(null);
    probe.destroy();
    // Una base con otra cosa, entera: no tiene lo de B. Reemplazar lo guardado tiraría <t2> (que se armaría al llegar
    // lo de A): no lo cubre.
    const other = new Y.Doc();
    other.getText('t').insert(0, '<t3> ');
    const base = buildCleanBase([Y.encodeStateAsUpdate(other)]);
    expect(coversLocal([onlyB], base.base)).toBe(false);
    // Con lo de A guardado también, ya no hay nada pendiente y la cuenta es la de siempre.
    expect(coversLocal([Y.encodeStateAsUpdate(a), onlyB], base.base)).toBe(false);
    const full = buildCleanBase([Y.encodeStateAsUpdate(a), onlyB]);
    expect(coversLocal([Y.encodeStateAsUpdate(a), onlyB], full.base)).toBe(true);
    base.doc.destroy();
    full.doc.destroy();
  });

  it('una base no reemplaza lo guardado de un invitado con algo sin subir: se suma y no se pierde nada', async () => {
    const { server, e1, page, tick } = await setup();
    await edit(e1, page, add('<t1>'));
    await share(e1, server, 'g', 'guest', { pageId: page }, 'edit');
    await e1.engine.syncNow();
    const g = await device(server, 'g');
    await g.engine.syncNow();
    // El invitado escribe sin red: queda sin subir.
    server.online = false;
    await edit(g, page, add('<t2>'));
    await g.engine.syncNow();
    server.online = true;
    // Llega una base nueva (bajada a mano, sin subir lo suyo antes).
    await edit(e1, page, add('<t3>'));
    await e1.engine.syncNow();
    tick(25_000);
    await e1.engine.syncNow();
    const before = (await stored(g, page)).length;
    await g.docs.pullPage(page, g.remote);
    expect((await stored(g, page)).length).toBe(before + 1);
    expect(visibleTokens(await stored(g, page))).toEqual(new Set(['<t1>', '<t2>', '<t3>']));
    // Sube lo suyo (su cursor queda por delante de la base: espera una más nueva); la próxima lo reemplaza todo.
    await g.engine.syncNow();
    await e1.engine.syncNow();
    await edit(e1, page, add('<t4>'));
    await e1.engine.syncNow();
    tick(25_000);
    await e1.engine.syncNow();
    await g.engine.syncNow();
    expect((await stored(g, page)).length).toBe(1);
    expect(await text(g, page)).toBe(await text(e1, page));
  });

  it('un lector: la búsqueda del proyecto y "Available offline" cuentan "en preparación" como sin bajar', async () => {
    const { server, e1, page } = await setup();
    await edit(e1, page, add('<t1>'));
    await e1.engine.syncNow();
    await share(e1, server, 'v', 'member', { pageId: page }, 'view');
    const v = await device(server, 'v');
    await v.engine.syncNow();
    const row = v.tree.get(page)!;
    expect(v.tree.serverSeq(row)).toBe(0);
    expect(v.tree.contentGap(row, 0)).toBe('preparing');
    await e1.engine.syncNow();
    await v.engine.syncNow();
    const after = v.tree.get(page)!;
    expect(v.tree.serverSeq(after)).toBe(after.clean_seq);
    expect(v.tree.contentGap(after, (await v.docs.stateOf(page))!.cursor)).toBe(null);
    // El editor sigue con `update_seq`.
    expect(e1.tree.serverSeq(e1.tree.get(page)!)).toBe(e1.tree.get(page)!.update_seq);
  });
});

describe('versiones y el interruptor', () => {
  it('apagado: todos bajan las filas como hoy y nadie arma nada', async () => {
    const { server, e1, page } = await setup({ clean: false });
    await edit(e1, page, add('<t1>'));
    await edit(e1, page, add('<t2>'));
    await e1.engine.syncNow();
    await edit(e1, page, del('<t2>'));
    await e1.engine.syncNow();
    await share(e1, server, 'v', 'member', { pageId: page }, 'view');
    const v = await device(server, 'v');
    await v.engine.syncNow();
    await e1.engine.syncNow();
    expect(server.cleanPushes).toEqual([]);
    expect(e1.engine.getStatus().cleanOn).toBe(false);
    // Como hoy: el lector recibe las filas, con lo borrado.
    expect(tokensInBytes(await stored(v, page)).has('<t2>')).toBe(true);
    expect(await v.engine.contentGap(page)).toBe(null);
  });

  it('la versión publicada (v0.100) sigue andando: con el interruptor apagado baja filas; prendido, como editora sube filas y otro arma', async () => {
    for (const on of [false, true]) {
      const { server, e1, page, tick } = await setup({ clean: on });
      server.addMember('old', 'member');
      server.grant('old', { pageId: page }, 'edit');
      await edit(e1, page, add('<t1>'));
      await e1.engine.syncNow();
      // La versión publicada, editora, con su propia base local.
      const db = await openLocalDb(crypto.randomUUID());
      extraDbs.push(db);
      const old = new V100PageDocs(db, { normalize: mergeRootGroups, seed: seedIfEmpty });
      const remote = new FakeRemote(server, '0.100', 'old');
      await old.pullPage(page, remote);
      const doc = await old.open(page);
      doc.getText('t').insert(doc.getText('t').length, '<t2> ');
      await old.flush(page);
      await old.pushPage(page, remote);
      doc.getText('t').delete(doc.getText('t').toString().indexOf('<t2> '), 5);
      doc.getText('t').insert(doc.getText('t').length, '<t3> ');
      await old.flush(page);
      await old.pushPage(page, remote);
      old.close(page);
      await share(e1, server, 'v', 'member', { pageId: page }, 'view');
      await e1.engine.syncNow();
      tick(25_000);
      await e1.engine.syncNow();
      const v = await device(server, 'v');
      await v.engine.syncNow();
      expect(visibleTokens(await stored(v, page))).toEqual(new Set(['<t1>', '<t3>']));
      // Apagado, el lector recibe las filas (con lo borrado, como hoy); prendido, solo la base.
      expect(tokensInBytes(await stored(v, page)).has('<t2>')).toBe(!on);
      // La versión publicada como lectora con el interruptor apagado: las filas, como siempre.
      if (!on) {
        const db2 = await openLocalDb(crypto.randomUUID());
        extraDbs.push(db2);
        const reader = new V100PageDocs(db2, { normalize: mergeRootGroups, seed: seedIfEmpty });
        expect(await reader.pullPage(page, new FakeRemote(server, '0.100', 'v'))).toBe(server.updates.get(page)!.length);
      }
    }
  });

  it('una versión más vieja que el interruptor no arma (la base la rechazaría)', async () => {
    const { server, e1, page } = await setup();
    server.enableClean(0.2);
    const old = await makeDevice(server, undefined, '0.150');
    devices.push(old);
    await edit(e1, page, add('<t1>'));
    await e1.engine.syncNow();
    server.addMember('v', 'member');
    server.grant('v', { pageId: page }, 'view');
    await old.engine.syncNow();
    expect(server.cleanPushes).toEqual([]);
  });
});

/**
 * Al azar, como P7 del doc: dos editores escriben notas y las borran antes de compartir; se comparte (subiendo antes
 * lo pendiente); después escriben y borran, un lector y un invitado con Editar sincronizan, el invitado escribe, un
 * lector pasa a editor a mitad y un editor pasa a invitado a dos tercios; el reloj avanza al azar. En cada paso: lo
 * que guardó quien no ve lo borrado estuvo visible en alguna base que recibió (más lo que escribió él); al final todos
 * iguales y un teléfono nuevo del lector recibe solo lo visible. Devuelve las fugas.
 */
async function randomRun(seed: number, steps: number): Promise<{ leaks: number; preShare: number; phoneLeaks: number; equal: boolean; bases: number; deleted: number }> {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const { server, e1, page, tick } = await setup();
  server.addMember('e2', 'member');
  server.grant('e2', { pageId: page }, 'edit');
  server.addMember('w', 'member');
  server.grant('w', { pageId: page }, 'view');
  const e2 = await device(server, 'e2');
  let n = 0;
  const preShare = new Set<string>();
  // Antes de compartir: notas que se escriben y se borran. Cuentan las borradas por quien comparte (aunque el borrado
  // siga en su cola: compartir lo sube antes) y las que otro editor ya subió borradas. Un borrado que otro editor
  // todavía tiene en su cola al compartir no lo puede saber nadie (Docs/Doc_Privacidad_Borrado.md, sección 6).
  for (let i = 0; i < 4; i++) {
    const d = rnd() < 0.5 ? e1 : e2;
    const tok = `<t${++n}>`;
    await edit(d, page, add(tok));
    await d.engine.syncNow();
    await edit(d, page, del(tok));
    const synced = rnd() < 0.5;
    if (synced) await d.engine.syncNow();
    if (d === e1 || synced) preShare.add(tok);
  }
  await edit(e1, page, add(`<t${++n}>`));
  await share(e1, server, 'v', 'member', { pageId: page }, 'view');
  await share(e1, server, 'g', 'guest', { pageId: page }, 'edit');
  const v = await device(server, 'v');
  const g = await device(server, 'g');
  const vPulls = recordPulls(v);
  const gPulls = recordPulls(g);
  const ePulls = recordPulls(e2);
  const own = new Set<string>();
  let demotedAt: number | null = null;
  let leaks = 0;
  const check = async () => {
    const vAllowed = new Set(vPulls.all.flatMap((b) => [...visibleTokens([b])]));
    leaks += subset(tokensInBytes(await stored(v, page)), vAllowed).length;
    const gAllowed = new Set([...gPulls.all.flatMap((b) => [...visibleTokens([b])]), ...own]);
    leaks += subset(tokensInBytes(await stored(g, page)), gAllowed).length;
    if (demotedAt !== null) {
      const after = ePulls.since(demotedAt);
      for (const b of after) leaks += subset(tokensInBytes([b]), visibleTokens([b])).length;
    }
  };
  for (let step = 0; step < steps; step++) {
    if (step === Math.floor(steps / 2)) server.grant('w', { pageId: page }, 'edit');
    if (step === Math.floor((2 * steps) / 3) && demotedAt === null) {
      server.members.get('e2')!.role = 'guest';
      demotedAt = ePulls.all.length;
    }
    const r = rnd();
    const editor = rnd() < 0.5 ? e1 : e2;
    tick(Math.floor(rnd() * 30_000));
    if (r < 0.3) await edit(editor, page, rnd() < 0.5 ? add(`<t${++n}>`) : addFirst(`<t${++n}>`));
    else if (r < 0.5) {
      const visible = [...(await text(editor, page)).matchAll(TOKEN)].map((m) => m[0]);
      if (visible.length > 0) await edit(editor, page, del(visible[Math.floor(rnd() * visible.length)]));
    } else if (r < 0.7) await editor.engine.syncNow();
    else if (r < 0.8) {
      await v.engine.syncNow();
      await check();
    } else if (r < 0.9) {
      if (rnd() < 0.5) {
        const tok = `<t${++n}>`;
        own.add(tok);
        await edit(g, page, add(tok));
      }
      await g.engine.syncNow();
      await check();
    } else await editor.engine.appHidden();
  }
  // Al final: todos sincronizan, el reloj pasa, un editor arma, los demás bajan.
  for (let round = 0; round < 3; round++) {
    for (const d of [e1, g, e2]) await d.engine.syncNow();
    tick(130_000);
    await e1.engine.syncNow();
    for (const d of [v, g, e2]) await d.engine.syncNow();
  }
  await check();
  const final = await text(e1, page);
  const equal = (await text(v, page)) === final && (await text(g, page)) === final && (await text(e2, page)) === final;
  const seen = tokensInBytes([...(await stored(v, page)), ...(await stored(g, page)), ...vPulls.all, ...gPulls.all]);
  const preLeaks = [...preShare].filter((t) => seen.has(t)).length;
  // El teléfono nuevo del lector: solo lo visible.
  const phone = await device(server, 'v');
  await phone.engine.syncNow();
  const phoneBytes = await stored(phone, page);
  const phoneLeaks = subset(tokensInBytes(phoneBytes), new Set(final.match(TOKEN) ?? [])).length;
  // Para saber que la corrida probó algo: cuántas bases recibió el lector y cuántas marcas borradas hay en las filas.
  const deleted = subset(tokensInBytes(server.updates.get(page)!.map((u) => u.data)), new Set(final.match(TOKEN) ?? [])).length;
  return { leaks, preShare: preLeaks, phoneLeaks, equal: equal && (await text(phone, page)) === final, bases: vPulls.all.length, deleted };
}

describe('al azar (P7)', () => {
  const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
  it('sin fugas y todos iguales', async () => {
    let bases = 0;
    let deleted = 0;
    for (const seed of SEEDS) {
      const r = await randomRun(seed, 80);
      expect({ ...r, bases: 0, deleted: 0 }, `semilla ${seed}`).toEqual({ leaks: 0, preShare: 0, phoneLeaks: 0, equal: true, bases: 0, deleted: 0 });
      bases += r.bases;
      deleted += r.deleted;
    }
    // Las corridas tuvieron bases y texto borrado de verdad (si no, no probarían nada).
    expect(bases).toBeGreaterThan(SEEDS.length * 3);
    expect(deleted).toBeGreaterThan(SEEDS.length * 3);
  }, 300_000);

  it.each([
    { which: 'raw' as const, what: 'el servidor le sirve filas a quien no ve lo borrado' },
    { which: 'nogc' as const, what: 'el dispositivo arma sin GC y sin la comprobación' },
  ])('la mutante $which ($what) da fugas', async ({ which }) => {
    let leaks = 0;
    for (const seed of SEEDS.slice(0, 3)) {
      if (which === 'nogc') mut.nogc = true;
      // Las del servidor se prenden en el servidor de cada corrida (ver abajo).
      serverMutant.which = which === 'nogc' ? null : which;
      const r = await randomRun(seed, 80);
      leaks += r.leaks + r.preShare + r.phoneLeaks;
    }
    serverMutant.which = null;
    expect(leaks).toBeGreaterThan(0);
  }, 120_000);
});

/** La mutante del servidor se prende al crear el servidor de cada corrida. */
const serverMutant: { which: FakeServer['cleanMutant'] } = { which: null };
const realEnableClean = FakeServer.prototype.enableClean;
FakeServer.prototype.enableClean = function (this: FakeServer, min?: number) {
  realEnableClean.call(this, min);
  this.cleanMutant = serverMutant.which;
};
