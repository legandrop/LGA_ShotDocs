// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useAuth } from '../auth';
import { ServicesContext, type Services } from '../services';
import { NAMED_VERSIONS_SCHEMA_VERSION } from '../sync/history';
import { deleteHistoryCache, historyCacheFor, historyDbName } from '../sync/historyCache';
import { FakeServer, makeDevice } from '../sync/testing';
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
