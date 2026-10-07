// @vitest-environment jsdom
// Abortos reales de transacción en la importación.
//
// Por cada etapa (reserva de la generación, recibo del proyecto, dueño del proyecto) se aborta de verdad la
// transacción de IndexedDB en el `put` de esa etapa y se comprueba:
//   1. que el interceptor entró para la clave esperada (cuántas veces y con qué clave);
//   2. qué transacción se abortó (el mismo objeto que abrió el producto, sus tablas y su modo);
//   3. con qué error rechazó la operación pública;
//   4. el evento `abort` de ESA transacción, esperado con una promesa y un tope de 2 s: exactamente uno;
//   5. que, ya sin transacciones activas, TODAS las filas de las tres bases del dispositivo son las de antes.
// Cada etapa lleva sus controles: antes, la misma operación con otra reserva y sin abortar sí escribe (el volcado
// detecta cambios y la clave interceptada es la real); después, la MISMA operación con la MISMA reserva termina bien.
//
// Dos momentos del aborto: «pendiente» (el `put` está pedido y todavía no se aplicó) y «aplicado» (el `put` ya dio
// `success`, así que la fila estaba escrita adentro de la transacción y el aborto la tiene que deshacer).
import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { Blob as NodeBlob, File as NodeFile, Buffer } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { IDBDatabase, IDBObjectStore } from 'fake-indexeddb';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { newImportReservation, type ImportSnapshot } from './importCommit';
import { metaJournal, type ImportJournal } from './codaImport';
import { ImportPending, exactValue, projectOwnerKey, projectReceiptKey } from '../sync/importIdentity';

type Stage = 'reserve' | 'receipt' | 'owner';
type Moment = 'pendiente' | 'aplicado';
type Dump = Record<string, [unknown, unknown][]>;

// --- Registro de transacciones: toda transacción que abre el producto queda numerada y se sabe cómo terminó.
interface TxInfo { id: number; db: string; stores: string[]; mode: string; end: 'activa' | 'complete' | 'abort' }
const txInfo = new Map<IDBTransaction, TxInfo>();
const created: IDBTransaction[] = [];
const active = new Set<IDBTransaction>();
const nativeTransaction = IDBDatabase.prototype.transaction;
const nativePut = IDBObjectStore.prototype.put;
const nativeAdd = IDBObjectStore.prototype.add;
IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...args: Parameters<typeof nativeTransaction>) {
  const tx = nativeTransaction.apply(this, args);
  const info: TxInfo = { id: created.length + 1, db: this.name, stores: Array.from(tx.objectStoreNames), mode: tx.mode, end: 'activa' };
  txInfo.set(tx, info);
  created.push(tx);
  active.add(tx);
  for (const type of ['complete', 'abort'] as const) {
    tx.addEventListener(type, () => {
      info.end = type;
      active.delete(tx);
    }, { once: true });
  }
  return tx;
};

const devices = new Set<Device>();

beforeAll(() => {
  // El mismo entorno que las pruebas de importación con pantalla (jsdom): los tipos binarios y `crypto` de Node.
  vi.stubGlobal('Uint8Array', Object.getPrototypeOf(Buffer.prototype).constructor);
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('File', NodeFile);
  vi.stubGlobal('crypto', webcrypto);
});
afterEach(async () => {
  restore();
  for (const d of [...devices]) await close(d);
});
afterAll(() => {
  expect(active.size).toBe(0);
  expect(devices.size).toBe(0);
  IDBDatabase.prototype.transaction = nativeTransaction;
  vi.unstubAllGlobals();
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Deja correr `n` tareas (IndexedDB avanza por tareas, no por microtareas). */
async function tasks(n = 10) {
  for (let i = 0; i < n; i++) await sleep(0);
}
/** Espera con tope: `undefined` si no llegó a tiempo. */
async function capped<T>(promise: Promise<T>, ms: number): Promise<{ value: T } | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  try {
    return await Promise.race([promise.then((value) => ({ value })), late]);
  } finally {
    clearTimeout(timer);
  }
}
/** Sin transacciones activas en ninguna base (tope 2 s). */
async function idle() {
  await vi.waitFor(() => expect(active.size).toBe(0), { timeout: 2000, interval: 5 });
}

async function device(server: FakeServer) {
  const d = await makeDevice(server, undefined, '0.206');
  devices.add(d);
  await d.engine.syncNow();
  server.online = false;
  await idle();
  return d;
}
async function close(d: Device) {
  d.offline.stop();
  await d.engine.stop();
  await d.docs.flush();
  d.docs.dispose();
  d.media.dispose();
  d.db.close();
  d.mediaDb.close();
  d.commentsDb.close();
  devices.delete(d);
  await idle();
}

// --- Volcado completo: todas las filas (clave y valor) de todas las tablas de las tres bases del dispositivo.
async function serial(value: any): Promise<any> {
  if (value === undefined) return { type: 'undefined' };
  if (typeof value === 'number' && !Number.isFinite(value)) return { type: 'number', value: String(value) };
  if (value instanceof NodeFile) return { type: 'File', name: value.name, modified: value.lastModified, mime: value.type, bytes: Buffer.from(await value.arrayBuffer()).toString('base64') };
  if (value instanceof NodeBlob) return { type: 'Blob', mime: value.type, bytes: Buffer.from(await value.arrayBuffer()).toString('base64') };
  if (ArrayBuffer.isView(value)) return { type: value.constructor.name, bytes: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64') };
  if (Object.prototype.toString.call(value) === '[object ArrayBuffer]') return { type: 'ArrayBuffer', bytes: Buffer.from(value).toString('base64') };
  if (value instanceof Date) return { type: 'Date', value: value.toISOString() };
  if (value instanceof Map) return { type: 'Map', rows: await Promise.all([...value].map(async ([k, v]) => [await serial(k), await serial(v)])) };
  if (value instanceof Set) return { type: 'Set', values: await Promise.all([...value].map(serial)) };
  if (Array.isArray(value)) return Promise.all(value.map(serial));
  if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.keys(value).map(async (k) => [k, await serial(value[k])])));
  return value;
}
async function dump(d: Device): Promise<Dump> {
  const result: Dump = {};
  for (const [index, db] of [d.db, d.mediaDb, d.commentsDb].entries()) {
    for (const name of Array.from(db.objectStoreNames as unknown as string[])) {
      const tx = (db as any).transaction(name, 'readonly');
      const [keys, values] = await Promise.all([tx.store.getAllKeys(), tx.store.getAll()]);
      await tx.done;
      result[`${index}:${name}`] = await Promise.all(keys.map(async (key: unknown, i: number) => [await serial(key), await serial(values[i])] as [unknown, unknown]));
    }
  }
  return result;
}
/** Las filas que cambian entre dos volcados: `+` nueva, `-` borrada, `~` con otro valor. */
function diff(a: Dump, b: Dump): string[] {
  const out: string[] = [];
  for (const store of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const before = new Map((a[store] ?? []).map(([k, v]) => [JSON.stringify(k), JSON.stringify(v)]));
    const after = new Map((b[store] ?? []).map(([k, v]) => [JSON.stringify(k), JSON.stringify(v)]));
    for (const [k, v] of after) {
      if (!before.has(k)) out.push(`+ ${store} ${k}`);
      else if (before.get(k) !== v) out.push(`~ ${store} ${k}`);
    }
    for (const k of before.keys()) if (!after.has(k)) out.push(`- ${store} ${k}`);
  }
  return out.sort();
}

// --- Interceptor de `put` y `add`: anota cada pedido y, si hay objetivo, aborta la transacción de ese `put`.
interface Call { method: 'put' | 'add'; store: string; key: unknown; tx: IDBTransaction }
interface Probe {
  calls: Call[];
  hits: Call[];
  abortEvents: number;
  abortSeen: Promise<void>;
}
function instrument(target?: { key: string; moment: Moment }): Probe {
  let seen!: () => void;
  const probe: Probe = {
    calls: [], hits: [], abortEvents: 0,
    abortSeen: new Promise<void>((resolve) => {
      seen = resolve;
    }),
  };
  const wrap = (method: 'put' | 'add', native: typeof nativePut) => function (this: IDBObjectStore, ...args: Parameters<typeof nativePut>) {
    const key = args[1], tx = this.transaction;
    const call: Call = { method, store: this.name, key, tx };
    probe.calls.push(call);
    const request = native.apply(this, args);
    if (target && method === 'put' && key === target.key) {
      probe.hits.push(call);
      tx.addEventListener('abort', () => {
        probe.abortEvents++;
        seen();
      });
      const abort = () => tx.abort();
      if (target.moment === 'pendiente') abort();
      else request.addEventListener('success', abort, { once: true });
    }
    return request;
  };
  IDBObjectStore.prototype.put = wrap('put', nativePut) as typeof nativePut;
  IDBObjectStore.prototype.add = wrap('add', nativeAdd) as typeof nativeAdd;
  return probe;
}
function restore() {
  IDBObjectStore.prototype.put = nativePut;
  IDBObjectStore.prototype.add = nativeAdd;
}
const metaPuts = (probe: Probe) => probe.calls.filter((c) => c.method === 'put' && c.store === 'meta').map((c) => c.key);

const cases: { stage: Stage; moment: Moment; existing?: true }[] = [
  { stage: 'reserve', moment: 'pendiente' },
  { stage: 'reserve', moment: 'aplicado' },
  { stage: 'receipt', moment: 'pendiente' },
  { stage: 'receipt', moment: 'aplicado' },
  { stage: 'owner', moment: 'pendiente' },
  { stage: 'owner', moment: 'aplicado' },
  // La reserva sobre una fila que ya existe: el aborto tiene que devolver el valor anterior, no solo quitar la fila.
  { stage: 'reserve', moment: 'aplicado', existing: true },
];

const stageName: Record<Stage, string> = { reserve: 'la reserva de la importación', receipt: 'el recibo del proyecto', owner: 'el dueño del proyecto' };
for (const { stage, moment, existing } of cases) {
  it(`si la transacción se aborta al guardar ${stageName[stage]} (guardado ${moment}${existing ? ', sobre una fila que ya existe' : ''}), no queda nada escrito y la misma operación, repetida, termina bien`, async () => {
    const server = new FakeServer();
    const d = await device(server);
    const store = metaJournal(d.db);
    const names = [d.db.name, d.mediaDb.name, d.commentsDb.name];
    const databases = async () => (await indexedDB.databases()).map((i) => i.name).filter((n) => !!n && n.includes(d.db.name)).sort();
    const bases = await databases();

    // === Control previo: la misma operación, con otra reserva y sin abortar, escribe. De acá sale la clave real.
    const rc = newImportReservation(`CONTROL-${stage}-${moment}-${crypto.randomUUID()}`, 'Control');
    const snapC = await store.loadState!(rc.sourceKey);
    await idle();
    const d0 = await dump(d);
    let passive = instrument();
    try {
      await store.reserveNew!(snapC, rc);
    } finally {
      restore();
    }
    await idle();
    const d1 = await dump(d);
    const controlReservePuts = metaPuts(passive);
    passive = instrument();
    try {
      await d.tree.createProject(rc.projectName, { projectId: rc.projectId, operationId: rc.projectOperationId! });
    } finally {
      restore();
    }
    await idle();
    const d2 = await dump(d);
    const controlProjectPuts = metaPuts(passive);
    const controlKey = String(controlReservePuts[0]);
    const namespace = controlKey.slice(0, -rc.sourceKey.length);
    expect(bases).toEqual([...names].sort());
    expect(controlReservePuts).toHaveLength(1);
    expect(controlKey.endsWith(rc.sourceKey)).toBe(true);
    expect(diff(d0, d1)).toEqual([`+ 0:meta ${JSON.stringify(controlKey)}`]);
    expect(controlProjectPuts).toEqual([projectReceiptKey(rc.projectOperationId!), projectOwnerKey(rc.projectId)]);
    expect(diff(d1, d2)).toEqual(expect.arrayContaining([
      `+ 0:meta ${JSON.stringify(projectReceiptKey(rc.projectOperationId!))}`,
      `+ 0:meta ${JSON.stringify(projectOwnerKey(rc.projectId))}`,
    ]));
    expect(diff(d1, d2).filter((row) => row.startsWith('+ 0:ops '))).toHaveLength(1);

    // === Preparación de la etapa: todo lo que el producto hace ANTES del put que se va a abortar, sin interceptor.
    const r = newImportReservation(existing ? rc.sourceKey : `ABORTO-${stage}-${moment}-${crypto.randomUUID()}`, 'Aborto');
    let snapshot: ImportSnapshot<ImportJournal> | undefined;
    if (stage === 'reserve') snapshot = await store.loadState!(r.sourceKey);
    else await store.reserveNew!(await store.loadState!(r.sourceKey), r);
    const targetKey = stage === 'reserve' ? namespace + r.sourceKey : stage === 'receipt' ? projectReceiptKey(r.projectOperationId!) : projectOwnerKey(r.projectId);
    const run = (): Promise<unknown> => stage === 'reserve'
      ? store.reserveNew!(snapshot!, r)
      : d.tree.createProject(r.projectName, { projectId: r.projectId, operationId: r.projectOperationId! });
    await idle();
    const before = await dump(d);
    const pendingBefore = d.tree.pendingOps().length;
    const txMark = created.length;

    // === El aborto.
    const probe = instrument({ key: targetKey, moment });
    let outcome: { value: { kind: 'resolvió'; value: unknown } | { kind: 'rechazó'; error: any } } | undefined;
    try {
      outcome = await capped(run().then(
        (value) => ({ kind: 'resolvió' as const, value }),
        (error) => ({ kind: 'rechazó' as const, error }),
      ), 5000);
    } finally {
      restore();
    }
    // El evento `abort` de esa transacción, esperado de forma explícita con tope de 2 s.
    const abortArrived = (await capped(probe.abortSeen, 2000)) !== undefined;
    await idle();
    await tasks();
    const after = await dump(d);
    const hit = probe.hits[0];
    // Las transacciones que se abrieron desde que arrancó la operación hasta la del put interceptado, inclusive.
    const during = hit ? created.slice(txMark, created.indexOf(hit.tx) + 1) : created.slice(txMark);
    const error = outcome?.value.kind === 'rechazó' ? outcome.value.error : undefined;
    const basesAfter = await databases();

    // 1. El interceptor entró, una vez, para la clave esperada.
    expect(probe.hits).toHaveLength(1);
    expect(hit.key).toBe(targetKey);
    expect(hit.store).toBe('meta');
    // 2. La transacción abortada es la que abrió el producto para esta operación: la base local, lectura y escritura.
    expect(created.slice(txMark)).toContain(hit.tx);
    expect(during).toHaveLength(1);
    expect(txInfo.get(hit.tx)).toMatchObject({ db: d.db.name, mode: 'readwrite', stores: ['meta', 'ops'], end: 'abort' });
    // 3. La operación pública rechazó, y por el aborto: no por una validación del producto anterior al put.
    expect(outcome?.value.kind).toBe('rechazó');
    // (Sin `instanceof Error`: en jsdom el `Error` global es de otro contexto que el del DOMException de IndexedDB.)
    expect(error).not.toBeInstanceOf(ImportPending);
    expect(error?.reason).toBeUndefined();
    expect(['AbortError', 'TransactionInactiveError', 'InvalidStateError']).toContain(error.name);
    // 4. Exactamente un evento `abort` de esa transacción.
    expect(abortArrived).toBe(true);
    expect(probe.abortEvents).toBe(1);
    // 5. Sin transacciones activas, todas las filas de las tres bases son las de antes.
    expect(active.size).toBe(0);
    expect(diff(before, after)).toEqual([]);
    expect(after).toEqual(before);
    expect(basesAfter).toEqual(bases);
    // Lo mismo, dicho fila por fila y en la memoria del árbol.
    if (stage === 'reserve') {
      expect(exactValue((await store.loadState!(r.sourceKey)).raw, snapshot!.raw)).toBe(true);
      if (!existing) expect(await d.db.get('meta', targetKey)).toBeUndefined();
    }
    expect(await d.db.get('meta', projectReceiptKey(r.projectOperationId!))).toBeUndefined();
    expect(await d.db.get('meta', projectOwnerKey(r.projectId))).toBeUndefined();
    expect((await d.db.getAll('ops')).filter((q) => q.opId === r.projectOperationId || (q.op.kind === 'createProject' && q.op.project.id === r.projectId))).toEqual([]);
    expect(d.tree.project(r.projectId)).toBeUndefined();
    expect(d.tree.pendingOps()).toHaveLength(pendingBefore);
    await idle();
    expect(await dump(d)).toEqual(before);

    // === Control posterior: la MISMA operación con la MISMA reserva, sin abortar, escribe la clave interceptada.
    passive = instrument();
    let value: unknown;
    try {
      value = await run();
    } finally {
      restore();
    }
    await idle();
    const final = await dump(d);
    expect(metaPuts(passive)).toContain(targetKey);
    expect(final).not.toEqual(before);
    if (stage === 'reserve') {
      expect(diff(before, final)).toEqual([`${existing ? '~' : '+'} 0:meta ${JSON.stringify(targetKey)}`]);
      expect((value as { raw: { activeGenerationId: string } }).raw.activeGenerationId).toBe(r.generationId);
    } else {
      expect(value).toBe(r.projectId);
      expect(diff(before, final)).toEqual(expect.arrayContaining([
        `+ 0:meta ${JSON.stringify(projectReceiptKey(r.projectOperationId!))}`,
        `+ 0:meta ${JSON.stringify(projectOwnerKey(r.projectId))}`,
      ]));
      expect((await d.db.getAll('ops')).filter((q) => q.opId === r.projectOperationId)).toHaveLength(1);
      expect(d.tree.project(r.projectId)).toBeDefined();
    }
  });
}
