// Lo común de las mediciones de exportar (bench.tsx y pdf.tsx): un dispositivo como el de las pruebas sobre el
// servidor en memoria (src/sync/testing.ts), con las miniaturas reales del navegador, fotos hechas en un canvas y el
// hash de lo guardado de una página. Solo para desarrollo: el build no lo incluye.
import * as Y from 'yjs';
import { mediaDbName, openMediaDb } from '../../media/mediaDb';
import { Portero } from '../../media/portero';
import { probeMedia, viewImage, withPlayMark } from '../../media/probe';
import { ProjectSizes } from '../../media/projectSizes';
import { MediaQueue } from '../../media/queue';
import type { Services } from '../../services';
import { AccessStore, Permissions } from '../../sync/access';
import { CommentQueue, commentsDbName, openCommentsDb } from '../../sync/comments';
import { PageDocs } from '../../sync/docs';
import { SyncEngine } from '../../sync/engine';
import { PageFiles } from '../../sync/files';
import { openLocalDb } from '../../sync/localDb';
import type { SupabaseRemote } from '../../sync/remote';
import { normalizeStructure, seedIfEmpty } from '../../sync/structure';
import { FakeRemote, type FakeServer } from '../../sync/testing';
import { PageTree } from '../../sync/tree';

/** Un dispositivo como el de las pruebas, con la medición y las miniaturas reales del navegador. */
export async function makeDevice(server: FakeServer) {
  const dbName = crypto.randomUUID();
  const db = await openLocalDb(dbName);
  const remote = new FakeRemote(server, '0.999');
  const access = new AccessStore(db, remote.userId);
  await access.load();
  const tree = new PageTree(db, server.workspaceId);
  await tree.load();
  const docs = new PageDocs(db, {
    normalize: normalizeStructure,
    seed: seedIfEmpty,
    canWrite: (pageId) => new Permissions(tree, access.get(), remote.userId).canEditPage(pageId),
  });
  const files = new PageFiles(db, remote);
  const mediaDb = await openMediaDb(mediaDbName(dbName));
  const media = new MediaQueue(mediaDb, remote, {
    portero: (url) =>
      new Portero(url, {
        fetch: server.portero.fetch,
        send: server.portero.send,
        token: async () => `token:${remote.userId}`,
        wait: async () => undefined,
      }),
    projectOf: (pageId) => tree.get(pageId)?.workspace_id,
    probe: probeMedia,
    playMark: withPlayMark,
    viewImage,
  });
  await media.load();
  const commentsDb = await openCommentsDb(commentsDbName(dbName));
  const comments = new CommentQueue(commentsDb, remote, remote.userId);
  await comments.load();
  const sizes = new ProjectSizes(db, { projectSizes: async () => null });
  await sizes.load();
  const engine = new SyncEngine(remote, tree, docs, files, { appVersion: '0.999', media, access, comments, sizes });
  return { db, tree, docs, files, media, mediaDb, engine, remote, access, comments, commentsDb, sizes };
}
export type Device = Awaited<ReturnType<typeof makeDevice>>;

export function servicesOf(d: Device): Services {
  const config = { url: 'https://bench.test', publishableKey: 'sb_publishable_test', name: 'Bench', localKey: 'bench', storage: {} };
  const client = { auth: { signOut: async () => undefined } } as never;
  return {
    workspace: { config, client } as never,
    client,
    user: { id: d.remote.userId, email: `${d.remote.userId}@test` } as never,
    db: d.db,
    tree: d.tree,
    docs: d.docs,
    files: d.files,
    media: d.media,
    engine: d.engine,
    access: d.access,
    remote: d.remote as unknown as SupabaseRemote,
    dbName: 'bench',
    mediaDb: d.mediaDb,
    comments: d.comments,
    commentsDb: d.commentsDb,
    sizes: d.sizes,
    shutdown: async () => undefined,
    // Sin "Available offline" (la página lo tolera: `useOffline`).
  } as unknown as Services;
}

/** Una foto distinta para cada número: un JPEG de 1600 × 1200 (o vertical) hecho en un canvas. */
export async function photoFile(n: number): Promise<File> {
  const landscape = n % 4 !== 3;
  const canvas = document.createElement('canvas');
  canvas.width = landscape ? 1600 : 1200;
  canvas.height = landscape ? 1200 : 1600;
  const ctx = canvas.getContext('2d')!;
  const hue = (n * 47) % 360;
  const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  grad.addColorStop(0, `hsl(${hue} 60% 55%)`);
  grad.addColorStop(1, `hsl(${(hue + 120) % 360} 50% 30%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = 'bold 260px sans-serif';
  ctx.fillText(String(n), 80, canvas.height / 2);
  for (let i = 0; i < 30; i++) {
    ctx.fillStyle = `hsl(${(hue + i * 13) % 360} 70% ${30 + (i % 5) * 10}%)`;
    ctx.fillRect((i * 151 + n * 31) % canvas.width, (i * 97 + n * 17) % canvas.height, 120, 80);
  }
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.85));
  return new File([blob], `IMG_${String(n).padStart(4, '0')}.jpg`, { type: 'image/jpeg' });
}

/** Cambia en los bloques cada `bench://<n>` por la dirección que dio la cola. */
export function withUrls(blocks: unknown, urls: Map<string, string>): unknown {
  if (Array.isArray(blocks)) return blocks.map((b) => withUrls(b, urls));
  if (blocks && typeof blocks === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(blocks)) out[k] = k === 'url' && typeof v === 'string' && urls.has(v) ? urls.get(v) : withUrls(v, urls);
    return out;
  }
  return blocks;
}

export function placeholders(blocks: unknown, out: string[] = []): string[] {
  if (Array.isArray(blocks)) blocks.forEach((b) => placeholders(b, out));
  else if (blocks && typeof blocks === 'object') {
    for (const [k, v] of Object.entries(blocks)) {
      if (k === 'url' && typeof v === 'string' && v.startsWith('bench://')) out.push(v);
      else placeholders(v, out);
    }
  }
  return out;
}

export async function sha256(parts: Uint8Array[]): Promise<string> {
  let size = 0;
  for (const p of parts) size += p.length + 4;
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    new DataView(all.buffer).setUint32(at, p.length);
    all.set(p, at + 4);
    at += p.length + 4;
  }
  const hash = await crypto.subtle.digest('SHA-256', all);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Lo guardado de una página: sus filas, su estado y el documento armado, en un hash. */
export async function storedHash(d: Device, pageId: string): Promise<string> {
  const rows = await d.db.getAllFromIndex('docUpdates', 'pageId', pageId);
  const state = await d.db.get('docState', pageId);
  const snap = await d.docs.snapshot(pageId);
  const full = Y.encodeStateAsUpdate(snap.doc);
  snap.doc.destroy();
  return sha256([...rows.map((r) => r.data), new TextEncoder().encode(JSON.stringify(state ?? null)), full]);
}
