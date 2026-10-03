import { afterAll, afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { linkMemory, rememberLink } from '../linkMode';
import type { KeyValueStore } from '../workspaces';
import { LOCAL_CHANGED, PageDocs } from './docs';
import { block, group } from './historyTesting';
import { LinkRemote } from './linkRemote';
import { startOverFromTeam, TEAM_VERSION_NOT_READY, type StartOverDeps } from './linkStartOver';
import { addPublicLink, fakeLinkClient, makeLinkDevice, resetPublicLink, type LinkDevice } from './linkTesting';
import { startedOverKey } from './localDb';
import { keepLateWriting, pendingCount } from './startedOver';
import { normalizeStructure, seedIfEmpty } from './structure';
import { CONTENT_FRAGMENT } from './structure';
import { FakeServer, makeDevice, type Device } from './testing';
import { exportUnsyncedBlob } from './unsynced';

// Lo apartado a la vista, entrega 2c (Docs/Doc_Link_Publico.md, "Cómo quedó la 2c"), con el motor de verdad contra el
// servidor en memoria: la lista de lo apartado (`public_link_aside`), el orden de la admisión por dispositivo (O3), lo que
// recuerda el visitante de lo mandado (O9) y volver a la página como la ve el equipo **sin perder nada**: sin haber bajado
// la copia, sin red, con algo escrito en el medio y con dos pestañas. Cada texto es una marca única (`<tN>`).

const TOKEN_RE = /<t\d+>/g;
const devices: Device[] = [];
const visitors: LinkDevice[] = [];
const extraDocs: PageDocs[] = [];
const swallow = (e: unknown) => {
  if (String(e).includes('closed') || String(e).includes('InvalidStateError')) return;
  throw e;
};
process.on('unhandledRejection', swallow);
afterAll(() => {
  process.off('unhandledRejection', swallow);
});
afterEach(async () => {
  for (const d of extraDocs.splice(0)) d.dispose();
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

function tokens(list: Uint8Array[]): Set<string> {
  const out = new Set<string>();
  for (const bytes of list) for (const m of Buffer.from(bytes).toString('latin1').match(TOKEN_RE) ?? []) out.add(m);
  return out;
}
const serverTokens = (server: FakeServer, pageId: string) => tokens((server.updates.get(pageId) ?? []).map((u) => u.data));
const stored = async (v: LinkDevice, pageId: string) => tokens((await v.db.getAllFromIndex('docUpdates', 'pageId', pageId)).map((r) => r.data));
const textTokens = (text: string) => new Set(text.match(TOKEN_RE) ?? []);

async function write(d: { docs: PageDocs }, pageId: string, tok: string): Promise<void> {
  const doc = await d.docs.open(pageId);
  doc.transact(() => group(doc).push([block(tok.replace(/\W/g, '') + Math.random().toString(36).slice(2, 6), `${tok} `)]), 'test');
  await d.docs.flush(pageId);
  d.docs.close(pageId);
}
function docTokens(doc: Y.Doc): Set<string> {
  return tokens([new TextEncoder().encode(JSON.stringify(doc.getXmlFragment(CONTENT_FRAGMENT).toJSON()))]);
}
async function visible(d: { docs: PageDocs }, pageId: string): Promise<Set<string>> {
  const doc = await d.docs.open(pageId);
  const out = docTokens(doc);
  d.docs.close(pageId);
  return out;
}

async function setup() {
  const server = new FakeServer();
  let clock = Date.parse('2026-10-03T10:00:00Z');
  server.now = () => clock;
  server.enableTeam();
  server.enableClean(0.1);
  server.enableLinkEdit(0.1);
  server.enableLinkAside();
  const e1 = await makeDevice(server, undefined, '0.200');
  devices.push(e1);
  const r = await e1.tree.create(null, 'R');
  const s = await e1.tree.create(r, 'S');
  const h = await e1.tree.create(s, 'H');
  await e1.engine.syncNow();
  await write(e1, s, '<t1>');
  await e1.engine.syncNow();
  return { server, e1, r, s, h, tick: (ms: number) => (clock += ms) };
}

async function visitor(server: FakeServer, token: string, opts: { device?: string; version?: string } = {}): Promise<LinkDevice> {
  const v = await makeLinkDevice(server, token, opts.device, opts.version ?? '0.200', 'Ana');
  visitors.push(v);
  return v;
}

async function editorRound(e: Device, tick: (ms: number) => void, pageIds: string[]): Promise<void> {
  await e.engine.syncNow();
  tick(25_000);
  await e.engine.syncNow();
  await e.engine.prepareBases(pageIds);
}

/**
 * Un visitante con algo apartado en S: `<t3>` entró, `<t4>` lo apartó otro editor y `<t5>` (escrito después en la misma
 * sesión) quedó apartado en cadena; `<t6>` quedó sin mandar en el dispositivo.
 */
async function visitorWithAside() {
  const base = await setup();
  const { server, e1, s, tick } = base;
  const token = addPublicLink(server, s, server.ownerId, 'edit');
  await e1.engine.prepareBases([s]);
  const v = await visitor(server, token);
  await v.engine.syncNow();
  await v.engine.prefetchPage(s);
  await write(v, s, '<t3>');
  await v.engine.syncNow();
  await editorRound(e1, tick, [s]);
  await write(v, s, '<t4>');
  await v.engine.syncNow();
  const t4 = server.linkRoom.at(-1)!;
  server.admit(server.ownerId, '0.200', s, [{ id: t4.id, ok: false, reason: 'bad_shape' }]);
  await write(v, s, '<t5>');
  await v.engine.syncNow();
  await editorRound(e1, tick, [s]);
  await e1.engine.prepareBases([s]);
  await v.engine.syncNow();
  server.online = false;
  await write(v, s, '<t6>');
  await v.engine.syncNow();
  server.online = true;
  await v.remote.refreshEdits(true);
  expect(server.linkRoom.map((r) => r.decision)).toEqual(['admitted', 'aside', 'aside']);
  expect(v.remote.linkEdits().aside).toEqual([s]);
  expect(serverTokens(server, s)).toEqual(new Set(['<t1>', '<t3>']));
  return { ...base, token, v };
}

/** Lo que baja el visitante (lo de este navegador de la página, entero, como `linkPagesBlob`). */
async function copyOf(v: LinkDevice, pageId: string): Promise<{ text: string; before: string | null }> {
  const blob = await exportUnsyncedBlob(v.db, null, {
    appVersion: '0.200',
    workspace: { url: 'x', localKey: 'k', name: '' },
    user: { id: 'link:x', email: '' },
    titleOf: () => undefined,
    alsoPages: [pageId],
  });
  const json = JSON.parse(await blob.text()) as { pages: { pageId: string; yjsFullState: string; beforeStartingOver?: { text: string } }[] };
  const page = json.pages.find((p) => p.pageId === pageId)!;
  const doc = new Y.Doc({ gc: false });
  Y.applyUpdate(doc, Buffer.from(page.yjsFullState, 'base64'));
  const text = [...docTokens(doc)].join(' ');
  doc.destroy();
  return { text, before: page.beforeStartingOver?.text ?? null };
}

function deps(v: LinkDevice, server: FakeServer, over: Partial<StartOverDeps> = {}): StartOverDeps & { downloads: string[] } {
  const downloads: string[] = [];
  return {
    docs: v.docs,
    remote: v.remote,
    download: async (pageId) => {
      downloads.push((await copyOf(v, pageId)).text);
    },
    hasContent: (pageId) => (server.pages.get(pageId)?.update_seq ?? 0) > 0,
    ...over,
    downloads,
  };
}

describe('lo apartado de los links (public_link_aside)', () => {
  it('la lista trae lo apartado de todos los links de la página (también del reseteado), con su raíz, sin bytes; solo para quien ve lo borrado', async () => {
    const { server, e1, s, h, token, v } = await visitorWithAside();
    // Algo apartado en H, por el link de S.
    await v.engine.prefetchPage(h);
    await write(v, h, '<t7>');
    await v.engine.syncNow();
    const t7 = server.linkRoom.find((r) => r.pageId === h)!;
    server.admit(server.ownerId, '0.200', h, [{ id: t7.id, ok: false, reason: 'external_url' }]);
    // Reset: lo que espera (nada) queda apartado; lo apartado de antes sigue con la raíz S.
    resetPublicLink(server, token);
    const rows = await e1.remote.linkAside();
    // `<t6>` (sin mandar hasta el ciclo de H) esperaba al resetear: queda apartado con `link_revoked`.
    expect(rows.map((r) => [r.page_id === h ? 'H' : 'S', r.link_page_id === s, r.reason]).sort()).toEqual([
      ['H', true, 'external_url'],
      ['S', true, 'bad_shape'],
      ['S', true, 'link_revoked'],
      ['S', true, 'pending'],
    ]);
    // De la más nueva a la más vieja.
    expect(rows.map((r) => server.linkRoom.findIndex((x) => x.id === r.id))).toEqual([...rows.map((r) => server.linkRoom.findIndex((x) => x.id === r.id))].sort((a, b) => b - a));
    expect(rows.every((r) => !('data' in r) && r.author === 'Ana')).toBe(true);
    // Quien solo comenta no ve nada.
    const reader = await makeDevice(server, undefined, '0.200', {}, undefined, { id: 'lector' });
    devices.push(reader);
    server.addMember('lector', 'member');
    server.grant('lector', { pageId: s }, 'comment');
    await reader.engine.syncNow();
    expect(await reader.remote.linkAside()).toEqual([]);
    // Con la base en la versión 19 (sin la 2c), nada.
    server.settings = { ...server.settings!, schemaVersion: 19 };
    expect(await e1.remote.linkAside()).toEqual([]);
  });
});

describe('O3: el orden de la admisión es por dispositivo', () => {
  it('una fila con una versión inventada traba solo lo de su dispositivo: lo de otro visitante del mismo link entra', async () => {
    const { server, e1, s, tick } = await setup();
    const token = addPublicLink(server, s, server.ownerId, 'edit');
    await e1.engine.prepareBases([s]);
    const x = await visitor(server, token, { device: 'devX-' + 'x'.repeat(20), version: '9999' });
    await x.engine.syncNow();
    await x.engine.prefetchPage(s);
    await write(x, s, '<t3>');
    await x.engine.syncNow();
    expect(server.linkRoom.at(-1)!.appVersion).toBe(9999);
    const y = await visitor(server, token, { device: 'devY-' + 'y'.repeat(20) });
    await y.engine.syncNow();
    await y.engine.prefetchPage(s);
    await write(y, s, '<t4>');
    await y.engine.syncNow();
    await editorRound(e1, tick, [s]);
    expect(serverTokens(server, s).has('<t4>')).toBe(true);
    expect(server.linkRoom.map((r) => r.decision)).toEqual([null, 'admitted']);
    // Lo que sigue de X queda trabado detrás de su fila (su orden).
    await write(x, s, '<t5>');
    await x.engine.syncNow();
    await editorRound(e1, tick, [s]);
    expect(server.linkRoom.map((r) => r.decision)).toEqual([null, 'admitted', null]);
    expect(serverTokens(server, s).has('<t5>')).toBe(false);
  });
});

describe('volver a la página como la ve el equipo (sin perder nada)', () => {
  it('baja la copia, cambia lo guardado por la base del equipo, guarda lo de antes y lo nuevo vuelve a entrar', async () => {
    const { server, e1, s, tick, v } = await visitorWithAside();
    const d = deps(v, server);
    await startOverFromTeam(d, s);
    // La copia se bajó antes y trae todo lo de este navegador (lo apartado y lo sin mandar).
    expect(textTokens(d.downloads[0])).toEqual(new Set(['<t1>', '<t3>', '<t4>', '<t5>', '<t6>']));
    // La página es la del equipo.
    expect(await visible(v, s)).toEqual(new Set(['<t1>', '<t3>']));
    expect(await v.docs.unsyncedPages()).toEqual([]);
    // Lo de antes queda guardado en el navegador y sale en la próxima copia.
    const kept = (await v.db.get('meta', startedOverKey(s))) as Uint8Array;
    expect(tokens([kept])).toEqual(new Set(['<t1>', '<t3>', '<t4>', '<t5>', '<t6>']));
    expect(textTokens((await copyOf(v, s)).before!)).toEqual(new Set(['<t1>', '<t3>', '<t4>', '<t5>', '<t6>']));
    // El aviso se va (y no vuelve con el estado siguiente).
    expect(v.remote.linkEdits().aside).toEqual([]);
    await v.remote.refreshEdits(true);
    expect(v.remote.linkEdits().aside).toEqual([]);
    // Lo que escribe ahora entra (otro autor de Yjs: no cuelga de lo apartado).
    await write(v, s, '<t8>');
    await v.engine.syncNow();
    await editorRound(e1, tick, [s]);
    expect(server.linkRoom.at(-1)!.decision).toBe('admitted');
    expect(serverTokens(server, s).has('<t8>')).toBe(true);
    // Si después se aparta algo más, el aviso vuelve.
    await write(v, s, '<t9>');
    await v.engine.syncNow();
    server.admit(server.ownerId, '0.200', s, [{ id: server.linkRoom.at(-1)!.id, ok: false, reason: 'bad_shape' }]);
    await v.remote.refreshEdits(true);
    expect(v.remote.linkEdits().aside).toEqual([s]);
    // Una segunda vuelta junta lo de las dos: nada se pisa.
    await startOverFromTeam(deps(v, server), s);
    const kept2 = (await v.db.get('meta', startedOverKey(s))) as Uint8Array;
    expect(tokens([kept2])).toEqual(new Set(['<t1>', '<t3>', '<t4>', '<t5>', '<t6>', '<t8>', '<t9>']));
  });

  it('sin haber bajado la copia (falla la descarga) no toca nada', async () => {
    const { server, s, v } = await visitorWithAside();
    const before = await stored(v, s);
    const d = deps(v, server, { download: async () => Promise.reject(new Error('no download')) });
    await expect(startOverFromTeam(d, s)).rejects.toThrow('no download');
    expect(await stored(v, s)).toEqual(before);
    expect(await visible(v, s)).toEqual(new Set(['<t1>', '<t3>', '<t4>', '<t5>', '<t6>']));
    expect(await v.db.get('meta', startedOverKey(s))).toBeUndefined();
    expect(v.remote.linkEdits().aside).toEqual([s]);
    expect(await v.docs.unsyncedPages()).toEqual([s]);
  });

  it('con la red caída no toca nada (la copia sí se bajó)', async () => {
    const { server, s, v } = await visitorWithAside();
    const before = await stored(v, s);
    const d = deps(v, server);
    server.online = false;
    await expect(startOverFromTeam(d, s)).rejects.toThrow();
    expect(d.downloads).toHaveLength(1);
    expect(await stored(v, s)).toEqual(before);
    expect(await v.db.get('meta', startedOverKey(s))).toBeUndefined();
    expect(v.remote.linkEdits().aside).toEqual([s]);
  });

  it('sin base del equipo todavía (la página tiene contenido) no toca nada', async () => {
    const { server, s, v } = await visitorWithAside();
    const before = await stored(v, s);
    const d = deps(v, server, { remote: { pullContent: async () => [], refreshEdits: async () => undefined, acknowledgeAside: () => undefined } });
    await expect(startOverFromTeam(d, s)).rejects.toThrow(TEAM_VERSION_NOT_READY);
    expect(await stored(v, s)).toEqual(before);
  });

  it('si se escribe algo mientras se baja la copia, no se reemplaza nada y lo escrito queda', async () => {
    const { server, s, v } = await visitorWithAside();
    const d = deps(v, server, {
      download: async (pageId) => {
        // Una tecla justo después de mirar cómo estaba guardada la página.
        await write(v, pageId, '<t7>');
      },
    });
    await expect(startOverFromTeam(d, s)).rejects.toThrow(LOCAL_CHANGED);
    expect(await stored(v, s)).toEqual(new Set(['<t1>', '<t3>', '<t4>', '<t5>', '<t6>', '<t7>']));
    expect(await v.db.get('meta', startedOverKey(s))).toBeUndefined();
  });

  it('con dos pestañas: la otra vuelve a armar la página desde lo guardado; la abierta acá también', async () => {
    const { server, s, v } = await visitorWithAside();
    // La otra pestaña: otro PageDocs sobre la misma base local, con la página abierta.
    const other = new PageDocs(v.db, { normalize: normalizeStructure, seed: seedIfEmpty });
    extraDocs.push(other);
    const docB = await other.open(s);
    expect(docTokens(docB)).toEqual(new Set(['<t1>', '<t3>', '<t4>', '<t5>', '<t6>']));
    let reopenB = 0;
    other.subscribeUnsupported((id) => id === s && reopenB++);
    // Y acá también abierta (el editor de la página).
    const docA = await v.docs.open(s);
    let reopenA = 0;
    v.docs.subscribeUnsupported((id) => id === s && reopenA++);
    await startOverFromTeam(deps(v, server, { broadcast: (id) => other.reloadFromSaved(id) }), s);
    expect(reopenA).toBe(1);
    expect(reopenB).toBe(1);
    // Las dos se cierran y se vuelven a abrir (como PageEditor): las dos ven la del equipo.
    v.docs.close(s);
    other.close(s);
    await v.docs.flush(s);
    expect(docTokens(await v.docs.open(s))).toEqual(new Set(['<t1>', '<t3>']));
    v.docs.close(s);
    expect(docTokens(await other.open(s))).toEqual(new Set(['<t1>', '<t3>']));
    other.close(s);
    expect(docA).not.toBe(await v.docs.open(s));
    v.docs.close(s);
    // Y lo de antes, entero, guardado.
    expect(tokens([(await v.db.get('meta', startedOverKey(s))) as Uint8Array])).toEqual(new Set(['<t1>', '<t3>', '<t4>', '<t5>', '<t6>']));
  });
});

describe('correcciones de la auditoría de la 2c', () => {
  it('O1: lo que otra pestaña teclea en su documento viejo después del reemplazo pasa a lo de antes, sale en la copia y se avisa', async () => {
    const { server, s, v } = await visitorWithAside();
    const other = new PageDocs(v.db, { normalize: normalizeStructure, seed: seedIfEmpty });
    extraDocs.push(other);
    const docB = await other.open(s);
    let lateB = 0;
    other.subscribeStartedOverLate((id) => id === s && lateB++);
    // El aviso del BroadcastChannel todavía no llegó a B.
    await startOverFromTeam(deps(v, server, { broadcast: () => undefined }), s);
    docB.transact(() => group(docB).push([block('late20', '<t20> ')]), 'test');
    await other.flush(s);
    other.reloadFromSaved(s);
    other.close(s);
    const reopened = await other.open(s);
    other.close(s);
    // No está en la página (es de lo de antes), pero sí en lo de antes y en la copia, y se avisa.
    expect(docTokens(reopened).has('<t20>')).toBe(false);
    expect(tokens([(await v.db.get('meta', startedOverKey(s))) as Uint8Array]).has('<t20>')).toBe(true);
    expect(textTokens((await copyOf(v, s)).before!).has('<t20>')).toBe(true);
    expect(lateB).toBe(1);
    expect(await v.docs.startedOverLate(s)).toBe(1);
    // En las filas no queda nada pendiente: la página sigue siendo la del equipo.
    expect(await visible(v, s)).toEqual(new Set(['<t1>', '<t3>']));
    // Cerrar el aviso no toca lo guardado.
    await v.docs.dismissStartedOverLate(s);
    expect(await v.docs.startedOverLate(s)).toBe(0);
    expect(tokens([(await v.db.get('meta', startedOverKey(s))) as Uint8Array]).has('<t20>')).toBe(true);
  });

  it('O1: lo que esta pestaña teclea en el documento abierto justo después del reemplazo, también', async () => {
    const { server, s, v } = await visitorWithAside();
    const docA = await v.docs.open(s);
    let late = 0;
    v.docs.subscribeStartedOverLate((id) => id === s && late++);
    await startOverFromTeam(deps(v, server), s);
    docA.transact(() => group(docA).push([block('late21', '<t21> ')]), 'test');
    v.docs.close(s);
    expect(await visible(v, s)).toEqual(new Set(['<t1>', '<t3>']));
    expect(tokens([(await v.db.get('meta', startedOverKey(s))) as Uint8Array]).has('<t21>')).toBe(true);
    expect(textTokens((await copyOf(v, s)).before!).has('<t21>')).toBe(true);
    expect(late).toBe(1);
  });

  it('O1: sin volver a abrir la página, la próxima sincronización lo pasa a lo de antes y avisa; la copia también lo busca', async () => {
    const { server, s, v } = await visitorWithAside();
    const other = new PageDocs(v.db, { normalize: normalizeStructure, seed: seedIfEmpty });
    extraDocs.push(other);
    const docB = await other.open(s);
    await startOverFromTeam(deps(v, server, { broadcast: () => undefined }), s);
    docB.transact(() => group(docB).push([block('late22', '<t22> ')]), 'test');
    await other.flush(s);
    // La copia (sin abrir nada) ya lo trae.
    expect(textTokens((await copyOf(v, s)).before!).has('<t22>')).toBe(true);
    expect(await v.docs.startedOverLate(s)).toBe(1);
    // Otra tecla tarde: la sincronización (subir) la pasa sin abrir la página.
    docB.transact(() => group(docB).push([block('late23', '<t23> ')]), 'test');
    await other.flush(s);
    let late = 0;
    v.docs.subscribeStartedOverLate((id) => id === s && late++);
    await v.engine.syncNow();
    expect(late).toBe(1);
    expect(tokens([(await v.db.get('meta', startedOverKey(s))) as Uint8Array]).has('<t23>')).toBe(true);
    expect(await v.docs.startedOverLate(s)).toBe(2);
    other.close(s);
  });

  it('lo pendiente de Yjs se lee en su formato (2): cuenta lo que trae', () => {
    const src = new Y.Doc();
    group(src).push([block('p0', 'base')]);
    const sv = Y.encodeStateVector(src);
    group(src).push([block('p1', 'uno'), block('p2', 'dos')]);
    const late = Y.encodeStateAsUpdate(src, sv);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, late);
    expect(doc.store.pendingStructs).not.toBeNull();
    const expected = Y.decodeUpdate(late).structs.length;
    expect(pendingCount(doc.store.pendingStructs!.update)).toBe(expected);
  });

  it('O1: algo pendiente que no se arma sobre lo de antes no es de antes: no se toca', async () => {
    const { server, s, v } = await visitorWithAside();
    await startOverFromTeam(deps(v, server), s);
    // Una fila que cuelga de algo que no está en ningún lado (ni en las filas ni en lo de antes).
    const ghost = new Y.Doc();
    group(ghost).push([block('g0', '<t30> ')]);
    const sv = Y.encodeStateVector(ghost);
    group(ghost).push([block('g1', '<t31> ')]);
    const orphan = Y.encodeStateAsUpdate(ghost, sv);
    await v.db.add('docUpdates', { pageId: s, data: orphan });
    const before = (await v.db.getAllFromIndex('docUpdates', 'pageId', s)).length;
    const kept = (await v.db.get('meta', startedOverKey(s))) as Uint8Array;
    expect(await keepLateWriting(v.db, s)).toBe(0);
    expect((await v.db.getAllFromIndex('docUpdates', 'pageId', s)).length).toBe(before);
    expect(tokens([(await v.db.get('meta', startedOverKey(s))) as Uint8Array])).toEqual(tokens([kept]));
    expect(await v.docs.startedOverLate(s)).toBe(0);
  });

  it('ON1: teclas tarde en la otra pestaña y algo nuevo en esta: lo nuevo entra y lo tarde va a la copia', async () => {
    const { server, e1, s, tick, v } = await visitorWithAside();
    const other = new PageDocs(v.db, { normalize: normalizeStructure, seed: seedIfEmpty });
    extraDocs.push(other);
    const docB = await other.open(s);
    await startOverFromTeam(deps(v, server, { broadcast: () => undefined }), s);
    await write(v, s, '<t300>');
    docB.transact(() => group(docB).push([block('Lx1', '<t301> ')]), 'test');
    await other.flush(s);
    docB.transact(() => group(docB).push([block('Lx2', '<t302> ')]), 'test');
    await other.flush(s);
    await v.engine.syncNow();
    await editorRound(e1, tick, [s]);
    expect(serverTokens(server, s).has('<t300>')).toBe(true);
    expect(serverTokens(server, s).has('<t301>')).toBe(false);
    const before = textTokens((await copyOf(v, s)).before!);
    expect(before.has('<t301>') && before.has('<t302>')).toBe(true);
    expect(await v.docs.startedOverLate(s)).toBeGreaterThan(0);
    other.close(s);
  });

  it('O2: lo que esperaba al volver y después entra no tapa un apartado nuevo', async () => {
    const { server, e1, s, tick, v } = await visitorWithAside();
    await v.engine.syncNow();
    // Otra sesión escribe arriba de todo, sin colgar de lo apartado: espera en la sala al volver.
    const other = new PageDocs(v.db, { normalize: normalizeStructure, seed: seedIfEmpty });
    extraDocs.push(other);
    const docB = await other.open(s);
    docB.transact(() => group(docB).insert(0, [block('ind7', '<t7> ')]), 'test');
    await other.flush(s);
    other.close(s);
    await v.engine.syncNow();
    await v.remote.refreshEdits(true);
    expect(server.linkRoom.filter((r) => r.decidedAt === null).length).toBeGreaterThan(0);
    await startOverFromTeam(deps(v, server), s);
    expect(v.remote.linkEdits().aside).toEqual([]);
    await editorRound(e1, tick, [s]);
    // Después de volver, algo nuevo se aparta: el aviso vuelve.
    await write(v, s, '<t8>');
    await v.engine.syncNow();
    server.admit(server.ownerId, '0.200', s, [{ id: server.linkRoom.at(-1)!.id, ok: false, reason: 'bad_shape' }]);
    await v.remote.refreshEdits(true);
    expect(v.remote.linkEdits().aside).toEqual([s]);
  });
});

describe('O9: el visitante recuerda dónde mandó algo', () => {
  function memoryStore(): KeyValueStore {
    const m = new Map<string, string>();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, val) => void m.set(k, val), removeItem: (k) => void m.delete(k) };
  }

  it('lo mandado sigue a la vista después de recargar (otro LinkRemote con la misma memoria); lo que entró se olvida', async () => {
    const { server, e1, s, h, tick } = await setup();
    const token = addPublicLink(server, s, server.ownerId, 'edit');
    await e1.engine.prepareBases([s]);
    const store = memoryStore();
    const entry = rememberLink({ u: 'https://x.supabase.co', k: 'sb_publishable_x', l: 'k', t: token }, store);
    const v = await visitor(server, token);
    // El LinkRemote del visitante, con la memoria guardada con el link.
    const remote = new LinkRemote(fakeLinkClient(server, { 'x-shotdocs-link': token, 'x-shotdocs-device': 'dev-' + 'x'.repeat(20) }), '0.200', () => undefined, () => 'Ana', linkMemory(entry.id, store));
    await v.engine.syncNow();
    await v.engine.prefetchPage(s);
    await v.engine.prefetchPage(h);
    await write(v, s, '<t3>');
    await write(v, h, '<t4>');
    // Sube por este remote (el del motor es otro objeto con el mismo dispositivo).
    for (const page of [s, h]) await v.docs.pushPage(page, remote);
    expect(server.linkRoom).toHaveLength(2);
    // "Recargar": otro LinkRemote con la misma memoria sabe dónde mandó.
    const again = new LinkRemote(fakeLinkClient(server, { 'x-shotdocs-link': token }), '0.200', () => undefined, () => 'Ana', linkMemory(entry.id, store));
    expect(new Set(again.sentPages())).toEqual(new Set([s, h]));
    // Entra lo de S: al preguntar el estado, S se olvida y H (que espera) sigue.
    server.admit(server.ownerId, '0.200', s, [{ id: server.linkRoom[0].id, ok: true }]);
    await remote.refreshEdits(true);
    expect(again.sentPages()).toEqual([h]);
    void tick;
  });
});
