import type { MediaDb, MediaRecord } from './mediaDb';
import type { MediaRemote } from '../sync/remote';
import type { MediaFileRow } from '../sync/types';
import { HEIC_HEAD_BYTES, heicFailure, isHeicSignature, jpegName, JPEG_TYPE } from './heic';
import { fileKind } from './attachments';
import { md5Blob } from './md5';

// Un HEIC viejo sin marca puede haberse registrado con respuesta perdida. Nunca reemplazarlo por una consulta vacía.
type FileProof = { name: string; mime: string; size: number; md5: string; width?: number | null; height?: number | null };
export interface HeicRecovery {
  rev: string;
  state: 'waiting' | 'prepared' | 'promoted' | 'heic' | 'failed';
  original: FileProof;
  jpeg?: FileProof;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const proof = (p: FileProof | undefined): p is FileProof => !!p && typeof p.name === 'string' && typeof p.mime === 'string' && Number.isSafeInteger(p.size) && p.size > 0 && /^[a-f0-9]{32}$/.test(p.md5);
export const hasRecovery = (r: MediaRecord): boolean => Object.hasOwn(r, 'heicRecovery') && r.heicRecovery !== undefined;
export function recoveryKeys(r: MediaRecord): string[] {
  const h = r.heicRecovery;
  return h && UUID.test(r.id) && UUID.test(h.rev) && proof(h.original)
    ? [`heic-original:${r.id}:${h.rev}`, `heic-candidate:${r.id}:${h.rev}`] : [];
}
export function validRecovery(r: MediaRecord): boolean {
  const h = r.heicRecovery;
  return recoveryKeys(r).length === 2 && !!h && ['waiting','prepared','promoted','heic','failed'].includes(h.state)
    && (h.state !== 'prepared' && h.state !== 'promoted' || proof(h.jpeg));
}
export function recoveryActive(r: MediaRecord): boolean {
  return hasRecovery(r) && (!validRecovery(r) || !['promoted','heic','failed'].includes(r.heicRecovery!.state));
}
export async function recoveryBytes(db: MediaDb, r: MediaRecord): Promise<number> {
  let bytes = 0;
  for (const key of recoveryKeys(r)) bytes += (await db.get('blobs', key))?.size ?? 0;
  return bytes;
}
/** Las copias sin una revisión actualmente referenciada también ocupan espacio; se cuentan, nunca se liberan por barrido. */
export async function unreferencedRecoveryBytes(db: MediaDb, referenced: ReadonlySet<string>): Promise<number> {
  let bytes = 0;
  for (const key of await db.getAllKeys('blobs', IDBKeyRange.bound('heic-', 'heic-￿'))) {
    const parts = key.split(':');
    if (parts.length === 3 && ['heic-original','heic-candidate'].includes(parts[0]) && UUID.test(parts[1]) && UUID.test(parts[2]) && !referenced.has(key))
      bytes += (await db.get('blobs', key))?.size ?? 0;
  }
  return bytes;
}
/** Mantiene la transacción viva solo mientras se comprueban bytes; otra escritura no se intercala entre hash y commit. */
export async function keepAlive<T>(read: () => Promise<unknown>, work: () => Promise<T>): Promise<T> {
  let ended = false;
  const ticking = (async () => { while (!ended) await read(); })();
  try { return await work(); } finally { ended = true; await ticking; }
}
function metadata(r: { name: string; mime: string; size?: number | null }, p: FileProof): boolean {
  return r.name === p.name && r.mime === p.mime && r.size === p.size;
}
function matches(row: MediaFileRow | undefined, r: MediaRecord, p: FileProof): boolean {
  return !!row && row.id === r.id && row.project_id === r.projectId && metadata(row, p)
    && !row.trashed_at && !row.purged_at && !row.drive_trashed_at;
}
function eligible(r: MediaRecord): boolean {
  return !hasRecovery(r) && !r.heic && r.pending === 1 && !r.registered && !r.freedAt
    && !r.uploadId && !r.sent && !r.driveId && !!r.projectId && fileKind(r.mime, r.name) === 'image';
}
type Deps = {
  db: MediaDb; remote: Pick<MediaRemote, 'fetchMediaFiles'|'registerFile'>;
  convert(blob: Blob): Promise<Blob>; stopped(): boolean; offline(): boolean; now(): number;
  measure?(blob: Blob): Promise<{ width: number | null; height: number | null }>;
  tries: number; retry: readonly number[];
};

/** undefined: camino previo; null: conserva bytes y espera; registro: recuperación reconciliada para continuar. */
export async function recoverHeic(id: string, deps: Deps): Promise<MediaRecord | null | undefined> {
  const { db, remote, stopped, offline } = deps;
  let r = await db.get('files', id);
  if (!r || stopped()) return null;
  if (!hasRecovery(r)) {
    if (!eligible(r)) return undefined;
    const blob = await db.get('blobs', id);
    if (!blob || blob.size !== r.size || !isHeicSignature(new Uint8Array(await blob.slice(0, HEIC_HEAD_BYTES).arrayBuffer()))) return undefined;
    const original = { name: r.name, mime: r.mime, size: blob.size, md5: await md5Blob(blob) };
    if (stopped()) return null;
    const h: HeicRecovery = { rev: crypto.randomUUID(), state: 'waiting', original };
    const tx = db.transaction(['files','blobs'], 'readwrite');
    void tx.done.catch(() => undefined);
    const current = await tx.objectStore('files').get(id);
    const present = await tx.objectStore('blobs').get(id);
    if (current && eligible(current) && metadata(current, original) && present?.size === original.size
      && await keepAlive(() => tx.objectStore('files').get(id), () => md5Blob(present)) === original.md5 && !stopped()) {
      r = { ...current, heicRecovery: h };
      await tx.objectStore('blobs').put(present, recoveryKeys(r)[0]);
      await tx.objectStore('files').put(r);
    } else r = current;
    if (stopped()) { tx.abort(); await tx.done.catch(() => undefined); return null; }
    await tx.done;
  }
  if (!r?.heicRecovery || stopped()) return null;
  if (!validRecovery(r)) return null;
  if (!recoveryActive(r)) {
    const expected = r.heicRecovery.state === 'promoted' ? r.heicRecovery.jpeg! : r.heicRecovery.original;
    const primary = await db.get('blobs', id);
    if (!primary && r.freedAt) return r;
    return primary && metadata(r, expected) && primary.size === expected.size && await md5Blob(primary) === expected.md5 && !stopped() ? r : null;
  }
  const h = r.heicRecovery;
  const [originalKey, candidateKey] = recoveryKeys(r);
  const source = await db.get('blobs', originalKey);
  if (!source || source.size !== h.original.size || await md5Blob(source) !== h.original.md5 || stopped()) return null;

  // Toda escritura exige la misma revisión, estado y bytes principales, además de no haberse registrado en otra pestaña.
  const change = async (next: HeicRecovery, jpeg?: Blob, promote = false): Promise<MediaRecord | null> => {
    const tx = db.transaction(['files','blobs','thumbs'], 'readwrite');
    void tx.done.catch(() => undefined);
    const files = tx.objectStore('files'); const blobs = tx.objectStore('blobs');
    const current = await files.get(id); const primary = await blobs.get(id);
    let out: MediaRecord | null = null;
    if (current && !current.registered && !current.freedAt && !current.uploadId && !current.sent && !current.driveId && validRecovery(current) && current.heicRecovery!.rev === h.rev
      && current.heicRecovery!.state === h.state && metadata(current, h.original) && primary?.size === h.original.size
      && await keepAlive(() => files.get(id), () => md5Blob(primary)) === h.original.md5 && !stopped()) {
      out = { ...current, heicRecovery: next };
      if (jpeg) await blobs.put(jpeg, candidateKey);
      if (promote) {
        const candidate = await blobs.get(candidateKey);
        const saved = await blobs.get(originalKey);
        if (!candidate || !saved || !next.jpeg || candidate.size !== next.jpeg.size
          || await keepAlive(() => files.get(id), () => md5Blob(candidate)) !== next.jpeg.md5
          || await keepAlive(() => files.get(id), () => md5Blob(saved)) !== h.original.md5 || stopped()) {
          await tx.done; return null;
        }
        out = { ...out, name: next.jpeg.name, mime: JPEG_TYPE, size: candidate.size, registered: true,
          width: null, height: null, thumb: 'none', probed: false, thumbError: null, md5: next.jpeg.md5 };
        delete out.heic; delete out.heicMisses;
        await blobs.put(new File([candidate], next.jpeg.name, { type: JPEG_TYPE }), id);
        // El candidato pasa a la clave principal; la copia HEIC sigue protegida hasta liberar propios.
        await blobs.delete(candidateKey);
        await tx.objectStore('thumbs').delete(id);
      } else if (next.state === 'heic' || next.state === 'failed') out.heic = 'failed';
      if (stopped()) { tx.abort(); await tx.done.catch(() => undefined); return null; }
      await files.put(out);
    }
    if (stopped()) { tx.abort(); await tx.done.catch(() => undefined); return null; }
    await tx.done; return out;
  };
  let row: MediaFileRow | undefined;
  if (!offline()) {
    try { row = (await remote.fetchMediaFiles([id])).find(f => f.id === id); } catch { return null; }
    if (stopped()) return null;
    if (matches(row, r, h.original)) return change({ ...h, state: 'heic' });
    if (row && (!h.jpeg || !matches(row, r, h.jpeg))) return null;
    if (row && h.jpeg) return change({ ...h, state: 'promoted' }, undefined, true);
  }
  if (h.state === 'waiting') {
    let jpeg: Blob;
    try { jpeg = await deps.convert(source); } catch (err) {
      if (stopped()) return null;
      if (heicFailure(err) !== 'unavailable') return change({ ...h, state: 'failed' });
      if (!offline()) {
        const misses = (r.heicMisses ?? 0) + 1;
        const updated = await change(misses >= deps.tries ? { ...h, state: 'failed' } : h);
        if (updated && !stopped()) {
          const tx = db.transaction('files','readwrite'); const current = await tx.store.get(id);
          if (current?.heicRecovery?.rev === h.rev && current.heicRecovery.state === updated.heicRecovery!.state && !stopped())
            await tx.store.put({ ...current, heicMisses: misses, retryAt: misses < deps.tries ? deps.now() + deps.retry[Math.min(misses, deps.retry.length)-1] : 0 });
          await tx.done;
        }
        return updated?.heicRecovery?.state === 'failed' ? updated : null;
      }
      return null;
    }
    if (stopped()) return null;
    if (!jpeg.size) return change({ ...h, state: 'failed' });
    const measured = await deps.measure?.(jpeg);
    const candidate = { name: jpegName(h.original.name), mime: JPEG_TYPE, size: jpeg.size, md5: await md5Blob(jpeg), width: measured?.width ?? null, height: measured?.height ?? null };
    if (stopped()) return null;
    // El candidato durable nunca reemplaza el HEIC antes de un registro remoto confirmado por lectura positiva.
    const prepared = await change({ ...h, state: 'prepared', jpeg: candidate }, jpeg);
    if (!prepared || stopped()) return null;
    return recoverHeic(id, deps);
  }
  if (offline()) return null;
  const candidate = await db.get('blobs', candidateKey);
  if (!candidate || !h.jpeg || candidate.size !== h.jpeg.size || await md5Blob(candidate) !== h.jpeg.md5 || stopped()) return null;
  const current = await db.get('files', id);
  if (!current || current.registered || current.heicRecovery?.rev !== h.rev || current.heicRecovery.state !== h.state || !metadata(current, h.original) || stopped()) return null;
  // La consulta vacía no decide: el RPC conserva al ganador; luego se exige metadata visible exacta.
  await remote.registerFile({ id, pageId: r.pageId, ...h.jpeg, width: h.jpeg.width ?? null, height: h.jpeg.height ?? null, duration: null });
  if (stopped()) return null;
  try { row = (await remote.fetchMediaFiles([id])).find(f => f.id === id); } catch { return null; }
  if (stopped()) return null;
  if (matches(row, r, h.original)) return change({ ...h, state: 'heic' });
  return matches(row, r, h.jpeg) ? change({ ...h, state: 'promoted' }, undefined, true) : null;
}
