import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { t } from '../i18n';
import { syncTone } from '../ui/SyncBadge';
import type { SyncStatus } from './engine';
import { CONTENT_FRAGMENT } from './structure';
import { FakeServer, makeDevice, type Device } from './testing';

// D791: la pastilla dice «Downloading N pages…» mientras el dispositivo baja lo que cambió en otro, si la bajada tarda.
// Antes no decía nada (o «Uploading…» por lo que la comparación de fotos ponía en la cola, D790). Con el servidor en
// memoria, como offlineLargo.test.ts.

const devices: Device[] = [];

async function device(server: FakeServer): Promise<Device> {
  const d = await makeDevice(server);
  devices.push(d);
  return d;
}

afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
});

async function write(d: Device, pageId: string, text: string): Promise<void> {
  const doc = await d.docs.open(pageId);
  const fragment = doc.getXmlFragment(CONTENT_FRAGMENT);
  const paragraph = new Y.XmlElement('paragraph');
  paragraph.insert(0, [new Y.XmlText(text)]);
  fragment.insert(fragment.length, [paragraph]);
  d.docs.close(pageId);
  await d.docs.flush();
}

/** Tres páginas hechas y escritas en `a`; `b` ya bajó el árbol y las tres, y después `a` las vuelve a escribir. */
async function threeChanged(server: FakeServer) {
  const a = await device(server);
  await a.engine.syncNow();
  const pages = [await a.tree.create(null, 'Día 1'), await a.tree.create(null, 'Día 2'), await a.tree.create(null, 'Día 3')];
  for (const p of pages) await write(a, p, 'primero');
  await a.engine.syncNow();
  const b = await device(server);
  await b.engine.syncNow();
  for (const p of pages) await write(a, p, 'después');
  await a.engine.syncNow();
  return { a, b, pages };
}

/** Lo que va diciendo la pastilla de `d` mientras corre `run`. */
async function badgeDuring(d: Device, run: () => Promise<void>): Promise<string[]> {
  const seen: string[] = [];
  const off = d.engine.subscribe(() => {
    const text = syncTone(d.engine.getStatus(), 0, false, t).text;
    if (seen.at(-1) !== text) seen.push(text);
  });
  try {
    await run();
  } finally {
    off();
  }
  return seen;
}

describe('«Downloading…» en la pastilla (D791)', () => {
  it('una bajada lenta dice cuántas páginas faltan, y al terminar vuelve a 0', async () => {
    const server = new FakeServer();
    const { b } = await threeChanged(server);
    // Cada página tarda en bajar: la bajada entera pasa del umbral.
    const slow = b.remote.pullContent!.bind(b.remote);
    b.remote.pullContent = async (...args) => {
      await new Promise((r) => setTimeout(r, 1000));
      return slow(...args);
    };
    const seen = await badgeDuring(b, () => b.engine.syncNow());
    expect(seen).toContain(t('sync.downloading', { count: 3 }));
    expect(b.engine.getStatus().downloading ?? 0).toBe(0);
    expect(syncTone(b.engine.getStatus(), 0, false, t).text).toBe(t('sync.allSynced'));
  });

  it('si la bajada se corta por un error, la pastilla deja de decir «Downloading»', async () => {
    const server = new FakeServer();
    const { b, pages } = await threeChanged(server);
    const slow = b.remote.pullContent!.bind(b.remote);
    b.remote.pullContent = async (pageId, ...rest) => {
      await new Promise((r) => setTimeout(r, 1000));
      if (pageId === pages[0]) throw new TypeError('Failed to fetch');
      return slow(pageId, ...rest);
    };
    const seen = await badgeDuring(b, () => b.engine.syncNow());
    expect(seen).toContain(t('sync.downloading', { count: 3 }));
    expect(b.engine.getStatus().downloading ?? 0).toBe(0);
    // Las otras dos terminan de bajar después del error: no vuelven a poner la cuenta.
    await new Promise((r) => setTimeout(r, 50));
    expect(b.engine.getStatus().downloading ?? 0).toBe(0);
  });

  it('una bajada rápida no hace parpadear la pastilla', async () => {
    const server = new FakeServer();
    const { b } = await threeChanged(server);
    const seen = await badgeDuring(b, () => b.engine.syncNow());
    expect(seen.some((s) => s.startsWith(t('sync.downloading', { count: 3 }).split(' ')[0]))).toBe(false);
    expect(b.engine.getStatus().downloading ?? 0).toBe(0);
  });

  it('lo propio por subir gana sobre «Downloading»; el ícono baja solo con la bajada', () => {
    const base = { ...SYNCED, downloading: 12 };
    expect(syncTone(base, 0, false, t)).toMatchObject({ tone: 'busy', text: t('sync.downloading', { count: 12 }), down: true });
    expect(syncTone({ ...base, downloading: 1 }, 0, false, t).text).toBe(t('sync.downloading', { count: 1 }));
    const changes = t('sync.changes', { count: 2 });
    expect(syncTone({ ...base, syncing: true }, 2, false, t)).toMatchObject({ text: t('sync.uploading', { changes }), down: false });
    expect(syncTone({ ...base, online: false }, 0, false, t)).toMatchObject({ tone: 'offline', down: false });
  });
});

/** Un estado del motor ya sincronizado, para probar `syncTone` sin dispositivo. */
const SYNCED: SyncStatus = {
  online: true,
  syncing: false,
  pendingOps: 0,
  pendingPages: 0,
  pendingFiles: 0,
  pendingMedia: 0,
  failedMedia: 0,
  mediaError: null,
  uploading: null,
  mediaSending: false,
  pendingComments: 0,
  failedComments: 0,
  commentError: null,
  mediaUrl: null,
  ownerId: null,
  workspaceName: null,
  workspaceLocalKey: null,
  autoPurgeFiles: false,
  failedOps: 0,
  rejectedPages: 0,
  localError: null,
  warning: null,
  mediaWarning: null,
  notice: null,
  outdated: false,
  schemaBehind: null,
  schemaVersion: null,
  cleanOn: false,
  lastError: null,
  lastSyncAt: 1,
};
