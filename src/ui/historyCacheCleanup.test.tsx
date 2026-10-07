// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { useAuth } from '../auth';
import { ServicesContext, type Services } from '../services';
import { NAMED_VERSIONS_SCHEMA_VERSION, traceFromSets, type RestoreTrace } from '../sync/history';
import { deleteHistoryCache, historyCacheFor, historyDbName } from '../sync/historyCache';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { useHistoryCachePruning } from './historyCachePrune';
import { storageNamesFor, type WorkspaceConfig } from '../workspace';
import { deleteWorkspaceDatabases } from './RemovedScreen';

// La caché del historial de versiones (P.18, entrega 3) no queda en el dispositivo: se borra al salir de la cuenta
// (la base local no: puede tener cambios sin subir) y con las bases del workspace al sacarlo del dispositivo.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const names = async () => (await indexedDB.databases()).map((d) => d.name);
const wait = (ms = 50) => act(async () => new Promise((r) => setTimeout(r, ms)));

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

async function withCache(localDb: string): Promise<void> {
  const cache = await historyCacheFor(localDb);
  await cache!.save('p1', {
    rows: [{ id: 1, seq: 1, createdBy: 'u', createdAt: new Date(0).toISOString(), data: new Uint8Array([1]) }],
    emails: new Map([['u', 'u@test']]),
    versions: null,
    generation: 1,
  });
  expect(await names()).toContain(historyDbName(localDb));
}

describe('la caché del historial se va del dispositivo', () => {
  it('al salir de la cuenta (SIGNED_OUT), con la conexión abierta; la base local queda', async () => {
    const localKey = `k${crypto.randomUUID().slice(0, 8)}`;
    const ws = { url: 'https://x.supabase.co', publishableKey: 'k', name: 'W', localKey, storage: storageNamesFor(localKey) } as WorkspaceConfig;
    const user = { id: 'user-1', email: 'u@test' };
    const localDb = ws.storage.db(user.id);
    // La base local de siempre (no se toca) y la caché.
    await new Promise<void>((resolve) => {
      const req = indexedDB.open(localDb);
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
    });
    await withCache(localDb);
    localStorage.setItem(ws.storage.lastUser, JSON.stringify(user));
    let emit: (event: string, session: unknown) => void = () => undefined;
    const client = {
      auth: {
        onAuthStateChange: (fn: (event: string, session: unknown) => void) => {
          emit = fn;
          return { data: { subscription: { unsubscribe: () => undefined } } };
        },
      },
    };
    const states: string[] = [];
    function Probe() {
      states.push(useAuth(ws, client as never).status);
      return null;
    }
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<Probe />));
    // Supabase ya borró la sesión cuando avisa.
    await act(async () => emit('SIGNED_OUT', null));
    await wait(100);
    expect(states.at(-1)).toBe('signedOut');
    expect(await names()).not.toContain(historyDbName(localDb));
    expect(await names()).toContain(localDb);
    act(() => root.unmount());
  });

  it('con las bases del workspace al sacarlo del dispositivo', async () => {
    const localDb = `shotdocs:test:${crypto.randomUUID()}`;
    await withCache(localDb);
    await deleteWorkspaceDatabases(localDb);
    expect(await names()).not.toContain(historyDbName(localDb));
  });
});

describe('al perder el permiso (D13)', () => {
  it('lo guardado de una página cuyo historial ya no se ve se tira sin abrir el historial; pasar a invitada tira todo', async () => {
    const server = new FakeServer();
    server.enableTeam();
    server.settings = { ...server.settings!, schemaVersion: NAMED_VERSIONS_SCHEMA_VERSION };
    const owner = await makeDevice(server);
    const p = await owner.tree.create(null, 'P');
    const q = await owner.tree.create(null, 'Q');
    await owner.engine.syncNow();
    server.addMember('ana', 'member', 'ana@test');
    server.grant('ana', { pageId: p }, 'edit');
    const onQ = server.grant('ana', { pageId: q }, 'edit');
    const ana = await makeDevice(server, undefined, '9.999', {}, NAMED_VERSIONS_SCHEMA_VERSION, { id: 'ana', email: 'ana@test' });
    await ana.engine.syncNow();
    const dbName = `test-${crypto.randomUUID()}`;
    const cache = await historyCacheFor(dbName);
    for (const id of [p, q]) {
      await cache!.save(id, {
        rows: [{ id: 1, seq: 1, createdBy: 'ana', createdAt: new Date(0).toISOString(), data: new Uint8Array([1]) }],
        emails: new Map(),
        versions: null,
        generation: 1,
      });
    }
    const value = {
      workspace: { config: {}, client: {} },
      user: { id: 'ana', email: 'ana@test' },
      tree: ana.tree,
      access: ana.access,
      engine: ana.engine,
      dbName,
    } as unknown as Services;
    function Probe() {
      useHistoryCachePruning(10);
      return null;
    }
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<ServicesContext.Provider value={value}><Probe /></ServicesContext.Provider>));
    await wait(150);
    expect((await cache!.pages()).sort()).toEqual([p, q].sort());
    // Le sacan el permiso sobre Q.
    server.grants.splice(server.grants.findIndex((g) => g.id === onQ), 1);
    await act(async () => ana.engine.syncNow());
    await wait(150);
    expect(await cache!.pages()).toEqual([p]);
    // Pasa a invitada: ni P.
    server.members.get('ana')!.role = 'guest';
    await act(async () => ana.engine.syncNow());
    await wait(150);
    expect(await cache!.pages()).toEqual([]);
    act(() => root.unmount());
    for (const d of [owner, ana]) {
      await d.engine.stop();
      d.db.close();
      d.mediaDb.close();
    }
    await deleteHistoryCache(dbName);
  });
});

describe('Restored from… pendiente (la app se cerró antes de que la restauración subiera)', () => {
  /** Agrega un párrafo a la página (como el editor) y devuelve la huella de esa edición. */
  async function edit(d: Device, pageId: string, id: string, text: string): Promise<RestoreTrace> {
    const doc = await d.docs.open(pageId);
    let trace: RestoreTrace = { ins: [], del: [] };
    const on = (tr: Y.Transaction) => {
      const ins = new Map<number, { clock: number; len: number }[]>();
      for (const [client, after] of tr.afterState) {
        const before = tr.beforeState.get(client) ?? 0;
        if (after > before) ins.set(client, [{ clock: before, len: after - before }]);
      }
      trace = traceFromSets({ clients: ins }, tr.deleteSet as unknown as { clients: Map<number, { clock: number; len: number }[]> });
    };
    doc.on('afterTransaction', on);
    doc.transact(() => {
      const fragment = doc.getXmlFragment(CONTENT_FRAGMENT);
      if (fragment.length === 0) fragment.insert(0, [new Y.XmlElement('blockGroup')]);
      const block = new Y.XmlElement('blockContainer');
      block.setAttribute('id', id);
      const paragraph = new Y.XmlElement('paragraph');
      const content = new Y.XmlText();
      content.insert(0, text);
      paragraph.insert(0, [content]);
      block.insert(0, [paragraph]);
      (fragment.get(0) as Y.XmlElement).insert(0, [block]);
    }, 'test');
    doc.off('afterTransaction', on);
    await d.docs.flush(pageId);
    d.docs.close(pageId);
    return trace;
  }

  it('al volver a abrir la app se marca sola después de sincronizar, sin abrir el historial de esa página', async () => {
    const server = new FakeServer();
    server.settings = { ...server.settings!, schemaVersion: NAMED_VERSIONS_SCHEMA_VERSION };
    const d = await makeDevice(server, undefined, '9.999', {}, NAMED_VERSIONS_SCHEMA_VERSION);
    const pageId = await d.tree.create(null, 'P');
    await d.engine.syncNow();
    await edit(d, pageId, 'a', 'uno');
    await d.engine.syncNow();
    await edit(d, pageId, 'b', 'dos');
    await d.engine.syncNow();
    const rows = server.updates.get(pageId) ?? [];
    const dbName = `test-${crypto.randomUUID()}`;
    const cache = (await historyCacheFor(dbName))!;
    // Se restaura sin red y la app se cierra: la restauración queda en el dispositivo y su marca, pendiente.
    server.online = false;
    const trace = await edit(d, pageId, 'r', 'restaurada');
    const id = crypto.randomUUID();
    await cache.addRestore({ id, pageId, userId: server.ownerId, fromSeq: rows[0].seq, afterSeq: rows.at(-1)!.seq, at: Date.now(), trace });
    // La app otra vez abierta, sin el historial a la vista.
    const value = {
      workspace: { config: {}, client: {} },
      user: { id: server.ownerId, email: 'owner@test' },
      tree: d.tree,
      access: d.access,
      engine: d.engine,
      remote: d.remote,
      docs: d.docs,
      dbName,
    } as unknown as Services;
    function Probe() {
      useHistoryCachePruning(10);
      return null;
    }
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<ServicesContext.Provider value={value}><Probe /></ServicesContext.Provider>));
    await wait(100);
    expect(server.versions).toEqual([]);
    expect((await cache.allRestores()).map((p) => p.id)).toEqual([id]);
    // Vuelve la red: sube la restauración y, sin que nadie abra ese historial, queda marcada en su fila.
    server.online = true;
    await act(async () => d.engine.syncNow());
    await act(() => vi.waitFor(() => expect(server.versions.map((v) => [v.id, v.kind])).toEqual([[id, 'restore']])));
    expect(server.versions[0].seq).toBe((server.updates.get(pageId) ?? []).at(-1)!.seq);
    await act(() => vi.waitFor(async () => expect(await cache.allRestores()).toEqual([])));
    act(() => root.unmount());
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    await deleteHistoryCache(dbName);
  });

  const closers: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const close of closers.splice(0)) await close();
  });

  /**
   * Una restauración que ya subió y cuya marca quedó pendiente (la app se cerró justo antes de marcarla), y la app otra
   * vez abierta sin el historial a la vista (`open`). Cada prueba pone antes al workspace en el estado que mira.
   */
  async function unmarked({ appVersion = '9.999', withCache = true } = {}) {
    const server = new FakeServer();
    server.settings = { ...server.settings!, schemaVersion: NAMED_VERSIONS_SCHEMA_VERSION };
    const d = await makeDevice(server, undefined, appVersion, {}, NAMED_VERSIONS_SCHEMA_VERSION);
    const pageId = await d.tree.create(null, 'P');
    await d.engine.syncNow();
    await edit(d, pageId, 'a', 'uno');
    await d.engine.syncNow();
    await edit(d, pageId, 'b', 'dos');
    await d.engine.syncNow();
    const rows = [...(server.updates.get(pageId) ?? [])];
    const trace = await edit(d, pageId, 'r', 'restaurada');
    await d.engine.syncNow();
    expect(await d.docs.unsyncedPages()).not.toContain(pageId);
    const dbName = `test-${crypto.randomUUID()}`;
    const id = crypto.randomUUID();
    const cache = withCache ? (await historyCacheFor(dbName))! : null;
    await cache?.addRestore({ id, pageId, userId: server.ownerId, fromSeq: rows[0].seq, afterSeq: rows.at(-1)!.seq, at: Date.now(), trace });
    // Lo que el enganche le pide al servidor: el historial de la página, para buscar la fila de la restauración.
    const asked = vi.spyOn(d.remote, 'pageHistory');
    let root: ReturnType<typeof createRoot> | null = null;
    closers.push(async () => {
      if (root) act(() => root!.unmount());
      await d.engine.stop();
      d.db.close();
      d.mediaDb.close();
      await deleteHistoryCache(dbName);
    });
    const open = async () => {
      const value = { workspace: { config: {}, client: {} }, user: { id: server.ownerId, email: 'owner@test' }, tree: d.tree, access: d.access, engine: d.engine, remote: d.remote, docs: d.docs, dbName } as unknown as Services;
      function Probe() {
        useHistoryCachePruning(10);
        return null;
      }
      const host = document.createElement('div');
      document.body.append(host);
      root = createRoot(host);
      await act(async () => root!.render(<ServicesContext.Provider value={value}><Probe /></ServicesContext.Provider>));
      await wait(150);
    };
    const sync = async () => {
      await act(async () => d.engine.syncNow());
      await wait(150);
    };
    const marked = () => act(() => vi.waitFor(() => expect(server.versions.map((v) => [v.id, v.kind])).toEqual([[id, 'restore']])));
    const pending = async () => ((await cache?.allRestores()) ?? []).map((p) => p.id);
    return { server, d, pageId, dbName, id, asked, open, sync, marked, pending };
  }

  it('con la app más vieja que la versión mínima del workspace no se intenta y la marca no se pierde: se pone cuando deja de serlo', async () => {
    const s = await unmarked({ appVersion: '0.200' });
    // El workspace sube su versión mínima por encima de la de esta app: la base rechazaría la marca.
    s.server.settings = { ...s.server.settings!, minAppVersion: 0.3 };
    await s.sync();
    expect(s.d.engine.getStatus().outdated).toBe(true);
    expect(s.d.engine.getStatus().lastSyncAt).not.toBeNull();
    await s.open();
    await s.sync();
    expect(s.asked).not.toHaveBeenCalled();
    expect(s.server.versions).toEqual([]);
    expect(await s.pending()).toEqual([s.id]);
    // Ya no es vieja (acá baja la mínima; en la app, al actualizarse): la marca seguía ahí y se pone.
    s.server.settings = { ...s.server.settings!, minAppVersion: null };
    await s.sync();
    await s.marked();
    await act(() => vi.waitFor(async () => expect(await s.pending()).toEqual([])));
  });

  it('con la base anterior a las versiones con nombre no pide nada; cuando la base se actualiza, la marca', async () => {
    const s = await unmarked();
    s.server.settings = { ...s.server.settings!, schemaVersion: NAMED_VERSIONS_SCHEMA_VERSION - 1 };
    await s.sync();
    expect(s.d.engine.getStatus().schemaVersion).toBe(NAMED_VERSIONS_SCHEMA_VERSION - 1);
    await s.open();
    await s.sync();
    expect(s.asked).not.toHaveBeenCalled();
    expect(await s.pending()).toEqual([s.id]);
    s.server.settings = { ...s.server.settings!, schemaVersion: NAMED_VERSIONS_SCHEMA_VERSION };
    await s.sync();
    await s.marked();
  });

  it('sin red no pide nada; cuando vuelve, la marca', async () => {
    const s = await unmarked();
    s.server.online = false;
    await s.sync();
    expect(s.d.engine.getStatus().online).toBe(false);
    await s.open();
    expect(s.asked).not.toHaveBeenCalled();
    expect(await s.pending()).toEqual([s.id]);
    s.server.online = true;
    await s.sync();
    await s.marked();
  });

  it('a quien nunca abrió el historial en este dispositivo no le crea la caché ni pide nada', async () => {
    const s = await unmarked({ withCache: false });
    await s.open();
    await s.sync();
    expect(s.asked).not.toHaveBeenCalled();
    expect(await names()).not.toContain(historyDbName(s.dbName));
  });
});
