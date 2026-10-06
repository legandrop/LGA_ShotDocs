import * as Y from 'yjs';
import type { ImportedComment } from '../sync/comments';
import type { LocalDb } from '../sync/localDb';
import { ImportPending, exactValue, plainRecord, validUuid, matchesProjectIdentity, projectReceiptKey, projectOwnerKey } from '../sync/importIdentity';
export { ImportPending, exactValue } from '../sync/importIdentity';

export interface ImportNote { key: string; args?: Record<string, string | number> }
export interface ImportCommit {
  phase: 'planned' | 'confirmed';
  planReady: true;
  targetUpdate: Uint8Array;
  notes: ImportNote[];
  commentsPlan: ImportedComment[];
}


// N4: sólo se normalizan copias. El raw guardado y el documento abierto quedan intactos.
export function normalizeImport(update: Uint8Array): Uint8Array {
  if (!(update instanceof Uint8Array) || !update.length || update.length > 8 * 1024 * 1024) throw new ImportPending('invalid');
  const ds = Y.decodeUpdate(update).ds;
  const copy = new Y.Doc({ gc: true });
  try {
    Y.applyUpdate(copy, update);
    if (!Y.equalDeleteSets(ds, Y.snapshot(copy).ds)) throw new ImportPending('invalid');
    const result = Y.encodeStateAsUpdate(copy);
    if (result.length > 8 * 1024 * 1024 || !Y.equalDeleteSets(ds, Y.decodeUpdate(result).ds)) throw new ImportPending('invalid');
    if (Y.decodeUpdate(Y.diffUpdate(update, Y.encodeStateVector(copy))).structs.length) throw new ImportPending('invalid');
    return result;
  } finally { copy.destroy(); }
}


export function matchesImport(doc: Y.Doc, commit: ImportCommit): boolean {
  return exactValue(normalizeImport(Y.encodeStateAsUpdate(doc)), normalizeImport(commit.targetUpdate));
}

export function validCommit(raw: unknown): raw is ImportCommit {
  if (!raw || typeof raw !== 'object') return false;
  const c = raw as ImportCommit;
  if (c.planReady !== true || !['planned', 'confirmed'].includes(c.phase) || !Array.isArray(c.notes) || !Array.isArray(c.commentsPlan)
    || !c.notes.every((n) => n && typeof n.key === 'string') || !c.commentsPlan.every((p) => p && typeof p.id === 'string' && typeof p.pageId === 'string' && typeof p.body === 'string' && typeof p.createdAt === 'string' && typeof p.source === 'string')) return false;
  try { normalizeImport(c.targetUpdate); return true; } catch { return false; }
}

export interface RecoveryJournal {
  recoveryVersion: 2;
  projectId: string;
  projectName: string;
  pages: Record<string, { pageId: string; commit?: ImportCommit; done?: boolean }>;
  media: Record<string, unknown>;
}

export interface RecoveryStore<T> {
  get(key: string): Promise<T | undefined>;
  put(journal: T, expected?: T): Promise<void>;
  remove(key: string, expected?: T): Promise<void>;
  loadState?: GenerationStore<T>['loadState'];
  reserveNew?: GenerationStore<T>['reserveNew'];
  adoptV2?: GenerationStore<T>['adoptV2'];
  saveGeneration?: GenerationStore<T>['saveGeneration'];
  completeGeneration?: GenerationStore<T>['completeGeneration'];
  readGeneration?: GenerationStore<T>['readGeneration'];
}

export interface ImportReservation {
  generationId: string; projectId: string; projectOperationId: string | null;
  projectName: string; sourceKey: string; retainedGenerationId: string;
}
export interface ImportGeneration<T> {
  reservation: ImportReservation; phase: 'reserved' | 'ready' | 'complete'; journal?: T; adoptedV2?: true;
}
export interface ImportEnvelope<T> {
  recoveryVersion: 3; revision: number; activeGenerationId: string; generations: Record<string, ImportGeneration<T>>;
}
export interface ImportSnapshot<T> { sourceKey: string; raw: T | ImportEnvelope<T> | undefined }
export interface GenerationStore<T> extends RecoveryStore<T> {
  loadState(key: string): Promise<ImportSnapshot<T>>;
  reserveNew(expected: ImportSnapshot<T>, reservation: ImportReservation): Promise<ImportSnapshot<T>>;
  adoptV2(expected: ImportSnapshot<T>, generationId: string): Promise<ImportSnapshot<T>>;
  saveGeneration(expected: ImportSnapshot<T>, generationId: string, journal: T): Promise<ImportSnapshot<T>>;
  completeGeneration(expected: ImportSnapshot<T>, generationId: string): Promise<ImportSnapshot<T>>;
  readGeneration(key: string, generationId: string): Promise<ImportGeneration<T> | undefined>;
}
export const newImportReservation = (sourceKey: string, projectName: string): ImportReservation => ({
  sourceKey, projectName, generationId: crypto.randomUUID(), projectId: crypto.randomUUID(),
  projectOperationId: crypto.randomUUID(), retainedGenerationId: crypto.randomUUID(),
});
type ImportAttempt = { running: boolean; reservation?: ImportReservation; sourceKey?: string; intent?: ImportRunOptions['intent'] };
const attempts = new WeakMap<object, ImportAttempt>();
export function importAttemptFor(job: object): ImportAttempt {
  let attempt = attempts.get(job);
  if (!attempt) {
    attempt = { running: false };
    attempts.set(job, attempt);
  }
  return attempt;
}
export const envelope = <T>(raw: T | ImportEnvelope<T> | undefined): raw is ImportEnvelope<T> => plainRecord(raw) && raw.recoveryVersion === 3;
export function generationStore<T>(store: RecoveryStore<T>): GenerationStore<T> {
  if (typeof store.loadState !== 'function' || typeof store.reserveNew !== 'function' || typeof store.adoptV2 !== 'function'
    || typeof store.saveGeneration !== 'function' || typeof store.completeGeneration !== 'function') throw new ImportPending('invalid');
  return store as GenerationStore<T>;
}

export interface ImportRunOptions {
  intent?: 'initial' | 'resume' | 'new'; resume?: boolean; reservation?: ImportReservation; generationId?: string;
}
export async function beginImportGeneration<T extends RecoveryJournal>(store: GenerationStore<T>, key: string, name: string, options: ImportRunOptions,
  tree: { createProject(name: string, reserved?: { projectId: string; operationId: string }): Promise<string>; project(id: string): unknown },
  makeJournal: (projectId: string, projectName: string) => T): Promise<{ snapshot: ImportSnapshot<T>; generationId: string; journal: T }> {
  let snapshot = await store.loadState(key);
  const intent = options.intent ?? (options.resume ? 'resume' : 'initial');
  if (intent === 'initial' && snapshot.raw !== undefined && (!options.reservation || !envelope<T>(snapshot.raw)
    || snapshot.raw.activeGenerationId !== options.reservation.generationId
    || !exactValue(snapshot.raw.generations[options.reservation.generationId]?.reservation, options.reservation))) throw new ImportPending('changed');
  if (intent === 'new' || intent === 'initial') {
    const reservation = options.reservation ?? newImportReservation(key, name);
    try {
      snapshot = await store.reserveNew(snapshot, reservation);
    }
    catch (error) {
      const read = await store.loadState(key);
      if (!envelope<T>(read.raw) || read.raw.activeGenerationId !== reservation.generationId
        || !exactValue(read.raw.generations[reservation.generationId]?.reservation, reservation)) throw error;
      snapshot = read;
    }
  } else if (!envelope<T>(snapshot.raw)) {
    if (!snapshot.raw || !tree.project(snapshot.raw.projectId)) throw new ImportPending('changed');
    snapshot = await store.adoptV2(snapshot, options.generationId ?? crypto.randomUUID());
  }
  if (!envelope<T>(snapshot.raw)) throw new ImportPending('invalid');
  const generationId = snapshot.raw.activeGenerationId;
  let g = snapshot.raw.generations[generationId];
  if (g.phase === 'complete') throw new ImportPending('changed');
  if (g.phase === 'reserved') {
    const r = g.reservation;
    if (!r.projectOperationId) throw new ImportPending('invalid');
    await tree.createProject(r.projectName, { projectId: r.projectId, operationId: r.projectOperationId });
    snapshot = await store.saveGeneration(snapshot, generationId, makeJournal(r.projectId, r.projectName));
    g = (snapshot.raw as ImportEnvelope<T>).generations[generationId];
  }
  if (!g.journal || !tree.project(g.journal.projectId)) throw new ImportPending('changed');
  return { snapshot, generationId, journal: structuredClone(g.journal) };
}

export async function pendingImport<T extends RecoveryJournal>(store: RecoveryStore<T>, key: string): Promise<{ journal?: T; reservation?: ImportReservation; complete?: boolean }> {
  if (!store.loadState) return { journal: await store.get(key) };
  const state = await store.loadState(key);
  if (!envelope<T>(state.raw)) return { journal: state.raw };
  const g = state.raw.generations[state.raw.activeGenerationId];
  return { journal: g.journal, reservation: g.reservation, complete: g.phase === 'complete' };
}

export function recoveryStore<T extends RecoveryJournal>(db: Pick<LocalDb, 'transaction'>, prefix: string, keyOf: (j: T) => string): GenerationStore<T> {
  const record = (raw: unknown): raw is Record<string, unknown> => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const proto = Object.getPrototypeOf(raw);
    if (proto === null) return true;
    if (Object.getPrototypeOf(proto) !== null) return false;
    const ctor = Object.getOwnPropertyDescriptor(proto, 'constructor')?.value;
    return typeof ctor === 'function' && ctor.prototype === proto
      && Function.prototype.toString.call(ctor) === Function.prototype.toString.call(Object);
  };
  const valid = (v: unknown): v is T => {
    if (!record(v)) return false;
    const j = v as T;
    return j.recoveryVersion === 2 && typeof j.projectId === 'string' && typeof j.projectName === 'string'
      && record(j.media) && record(j.pages) && Object.values(j.pages).every((p) => record(p) && typeof p.pageId === 'string'
        && !Object.hasOwn(p, 'written') && !Object.hasOwn(p, 'expected')
        && (!Object.hasOwn(p, 'commit') || validCommit(p.commit))
        && (!Object.hasOwn(p, 'done') || typeof p.done === 'boolean')
        && (p.done !== true || p.commit?.phase === 'confirmed'));
  };
  const operation = async (key: string, action: 'get' | 'put' | 'remove', next?: T, expected?: T): Promise<T | undefined> => {
    const tx = db.transaction('meta', 'readwrite');
    try {
      const oldKey = `${prefix}:${key}`, newKey = `${prefix}2:${key}`;
      const [legacy, current] = await Promise.all([tx.store.get(oldKey), tx.store.get(newKey)]);
      if (legacy !== undefined && current !== undefined) throw new ImportPending('namespaceConflict', { legacy, current });
      if (legacy !== undefined) {
        if (action !== 'get') throw new ImportPending('legacy', legacy);
        await tx.store.put({ recoveryVersion: 2, legacy }, newKey);
        await tx.store.delete(oldKey);
        await tx.done;
        throw new ImportPending('legacy', legacy);
      }
      if (current !== undefined && !valid(current)) throw new ImportPending('invalid', current);
      if (action !== 'get' && !exactValue(current, expected)) throw new ImportPending('changed', current);
      if (action === 'put') {
        if (!valid(next)) throw new ImportPending('invalid', next);
        await tx.store.put(next, newKey);
      } else if (action === 'remove') await tx.store.delete(newKey);
      await tx.done;
      return current as T | undefined;
    } catch (err) {
      try { tx.abort(); } catch { /* Puede haberse confirmado el traslado legacy. */ }
      await tx.done.catch(() => undefined);
      throw err;
    }
  };
  const validReservation = (r: unknown, adopted = false): r is ImportReservation => plainRecord(r)
    && ['generationId', 'projectId', 'projectOperationId', 'projectName', 'sourceKey', 'retainedGenerationId'].every(k => Object.hasOwn(r, k))
    && validUuid(r.generationId) && validUuid(r.retainedGenerationId) && typeof r.sourceKey === 'string' && !!r.sourceKey
    && typeof r.projectName === 'string' && typeof r.projectId === 'string'
    && (adopted ? r.projectOperationId === null : validUuid(r.projectId) && validUuid(r.projectOperationId));
  const validEnvelope = (v: unknown, key: string): v is ImportEnvelope<T> => plainRecord(v) && v.recoveryVersion === 3
    && ['recoveryVersion', 'revision', 'activeGenerationId', 'generations'].every(k => Object.hasOwn(v, k))
    && Number.isSafeInteger(v.revision) && (v.revision as number) > 0 && validUuid(v.activeGenerationId)
    && plainRecord(v.generations) && Object.hasOwn(v.generations, v.activeGenerationId)
    && Object.entries(v.generations).every(([id, g]) => plainRecord(g) && Object.hasOwn(g, 'reservation') && Object.hasOwn(g, 'phase')
      && (!Object.hasOwn(g, 'adoptedV2') || g.adoptedV2 === true) && validReservation(g.reservation, g.adoptedV2 === true)
      && g.reservation.generationId === id && g.reservation.sourceKey === key
      && ['reserved', 'ready', 'complete'].includes(g.phase as string)
      && (g.phase === 'reserved' ? !Object.hasOwn(g, 'journal') && g.adoptedV2 !== true
        : Object.hasOwn(g, 'journal') && valid(g.journal) && keyOf(g.journal) === key
          && g.journal.projectId === g.reservation.projectId && g.journal.projectName === g.reservation.projectName));
  const update = async (expected: ImportSnapshot<T>, action: 'load' | 'reserve' | 'adopt' | 'save' | 'complete', value?: ImportReservation | string, journal?: T): Promise<ImportSnapshot<T>> => {
    const key = expected.sourceKey;
    const tx = db.transaction(['meta', 'ops'], 'readwrite');
    void tx.done.catch(() => undefined);
    try {
      const meta = tx.objectStore('meta');
      const [legacy, current] = await Promise.all([meta.get(`${prefix}:${key}`), meta.get(`${prefix}2:${key}`)]);
      if (legacy !== undefined && current !== undefined) throw new ImportPending('namespaceConflict', { legacy, current });
      if (legacy !== undefined || plainRecord(current) && Object.hasOwn(current, 'legacy')) throw new ImportPending('legacy', legacy ?? current);
      if (current !== undefined && !(valid(current) && keyOf(current) === key) && !validEnvelope(current, key)) throw new ImportPending('invalid', current);
      if (action === 'load') {
        await tx.done;
        return { sourceKey: key, raw: structuredClone(current) };
      }
      if (!exactValue(current, expected.raw)) throw new ImportPending('changed', current);
      let next: ImportEnvelope<T>;
      if (action === 'reserve') {
        const reservation = value as ImportReservation;
        if (!validReservation(reservation) || reservation.sourceKey !== key) throw new ImportPending('invalid');
        next = envelope<T>(current) ? structuredClone(current) : { recoveryVersion: 3, revision: 0, activeGenerationId: reservation.generationId, generations: {} };
        if (Object.hasOwn(next.generations, reservation.generationId) || reservation.generationId === reservation.retainedGenerationId
          || Object.values(next.generations).some(g => g.reservation.projectId === reservation.projectId || g.reservation.projectOperationId === reservation.projectOperationId)) throw new ImportPending('changed');
        if (current !== undefined && !envelope<T>(current)) {
          const old = current as T;
          next.generations[reservation.retainedGenerationId] = { adoptedV2: true, phase: 'ready', journal: structuredClone(old),
            reservation: { ...reservation, generationId: reservation.retainedGenerationId, projectId: old.projectId, projectName: old.projectName, projectOperationId: null } };
          if (old.projectId === reservation.projectId) throw new ImportPending('changed');
        }
        next.generations[reservation.generationId] = { phase: 'reserved', reservation: structuredClone(reservation) };
        next.activeGenerationId = reservation.generationId;
      } else if (action === 'adopt') {
        if (!valid(current) || !validUuid(value)) throw new ImportPending('changed');
        const projects = await meta.get('projects') as { id: string }[] | undefined;
        const ops = await tx.objectStore('ops').getAll();
        if (!projects?.some(p => p.id === current.projectId) && !ops.some(q => q.op.kind === 'createProject' && q.op.project.id === current.projectId)) throw new ImportPending('changed');
        const reservation = { ...newImportReservation(key, current.projectName), generationId: value, projectId: current.projectId, projectOperationId: null };
        next = { recoveryVersion: 3, revision: 0, activeGenerationId: value, generations: { [value]: { adoptedV2: true, reservation, phase: 'ready', journal: structuredClone(current) } } };
      } else {
        if (!envelope<T>(current) || current.activeGenerationId !== value) throw new ImportPending('changed');
        next = structuredClone(current);
        const g = next.generations[value as string];
        if (g.phase === 'complete') throw new ImportPending('changed');
        if (action === 'save') {
          if (!valid(journal) || keyOf(journal) !== key || journal.projectId !== g.reservation.projectId || journal.projectName !== g.reservation.projectName) throw new ImportPending('invalid');
          if (g.phase === 'reserved') {
            if (Object.keys(journal.pages).length || Object.keys(journal.media).length || !g.reservation.projectOperationId) throw new ImportPending('invalid');
            const receipt = await meta.get(projectReceiptKey(g.reservation.projectOperationId));
            const owner = await meta.get(projectOwnerKey(g.reservation.projectId));
            if (!matchesProjectIdentity(receipt, owner, { projectId: g.reservation.projectId, operationId: g.reservation.projectOperationId, projectName: g.reservation.projectName })) throw new ImportPending('changed');
          }
          g.journal = structuredClone(journal);
          g.phase = 'ready';
        } else {
          if (g.phase !== 'ready' || !g.journal || Object.values(g.journal.pages).some(p => p.done !== true || p.commit?.phase !== 'confirmed')) throw new ImportPending('invalid');
          g.phase = 'complete';
        }
      }
      if (!Number.isSafeInteger(next.revision) || next.revision >= Number.MAX_SAFE_INTEGER) throw new ImportPending('changed');
      next.revision++;
      if (!validEnvelope(next, key)) throw new ImportPending('invalid');
      await meta.put(next, `${prefix}2:${key}`);
      await tx.done;
      return { sourceKey: key, raw: structuredClone(next) };
    } catch (error) {
      try {
        tx.abort();
      } catch { /* Puede haberse cerrado la TX. */
      }
      await tx.done.catch(() => undefined);
      throw error;
    }
  };
  const loadState = (key: string) => update({ sourceKey: key, raw: undefined }, 'load');
  return { get: (key) => operation(key, 'get'), put: async (j, expected) => {
    await operation(keyOf(j), 'put', j, expected);
  }, remove: async (key, expected) => {
    await operation(key, 'remove', undefined, expected);
  },
    loadState, reserveNew: (expected, reservation) => update(expected, 'reserve', reservation), adoptV2: (expected, id) => update(expected, 'adopt', id),
    saveGeneration: (expected, id, journal) => update(expected, 'save', id, journal), completeGeneration: (expected, id) => update(expected, 'complete', id),
    readGeneration: async (key, id) => {
    const state = await loadState(key);
    return envelope<T>(state.raw) ? structuredClone(state.raw.generations[id]) : undefined;
  },
  };
}
