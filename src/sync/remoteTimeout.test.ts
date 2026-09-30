import { createClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_REQUEST_TIMEOUT_MS, REQUEST_TIMEOUT_MS, SupabaseRemote, timed, timeoutFor } from './remote';
import { FakeServer, makeDevice, type Device } from './testing';
import { isNetworkError, isPermanent, isTimeout, REQUEST_TIMEOUT, RemoteError } from './types';
import * as Y from '@y/y';

// Roadmap B.5: una consulta que no responde nunca dejaba colgado para siempre el ciclo de sincronización
// (con `syncing` prendido y el estado en "All synced"). Ahora cada consulta a la base tiene un tope.

/**
 * Un `fetch` que nunca responde: solo termina si se lo corta, y rechaza como el del navegador, con el motivo
 * de la señal (`TimeoutError` si venció `AbortSignal.timeout`, `AbortError` si se cortó a mano).
 */
const hanging: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    const signal = init?.signal;
    signal?.addEventListener('abort', () =>
      reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')),
    );
  });

const realTimeout = AbortSignal.timeout;

const devices: Device[] = [];

afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
  }
  vi.useRealTimers();
  (AbortSignal as { timeout: unknown }).timeout = realTimeout;
});

describe('tope de tiempo de las consultas', () => {
  it('reconoce como tope el TimeoutError que da AbortSignal.timeout real (no solo AbortError)', async () => {
    const client = createClient('https://example.supabase.co', 'sb_publishable_test', {
      global: { fetch: hanging },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error, status } = await client.rpc('pull_page_updates', {}).abortSignal(AbortSignal.timeout(20));
    expect(status).toBe(0);
    expect(error?.message).toMatch(/^TimeoutError\b/);
    // El mismo `AbortSignal.timeout` del navegador, pero de 20 ms, para no esperar el tope de verdad.
    (AbortSignal as { timeout: unknown }).timeout = () => realTimeout.call(AbortSignal, 20);
    const remote = new SupabaseRemote(client, '0.041');
    const err = await remote.pullUpdates('00000000-0000-4000-8000-000000000001', 0, 10).catch((e) => e);
    expect(isTimeout(err)).toBe(true);
    expect(isPermanent(err)).toBe(false);
  });

  it('una consulta que no responde vuelve como error de red (que se reintenta) al vencer el tope', async () => {
    // El tope con `setTimeout` (el que se usa si el navegador no tiene `AbortSignal.timeout`), para poder
    // adelantar el reloj.
    (AbortSignal as { timeout: unknown }).timeout = undefined;
    vi.useFakeTimers();
    const client = createClient('https://example.supabase.co', 'sb_publishable_test', {
      global: { fetch: hanging },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const remote = new SupabaseRemote(client, '0.031');
    for (const call of [
      () => remote.pullUpdates('p', 0, 10),
      () => remote.pushUpdate('p', 'id', new Uint8Array([1, 2])),
      () => remote.fetchTree(['w']),
    ]) {
      const caught = call().then(
        () => null,
        (err: unknown) => err,
      );
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1000);
      let settled = false;
      void caught.then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(2000);
      const err = await caught;
      expect(err).toBeInstanceOf(RemoteError);
      expect(isNetworkError(err)).toBe(true);
      expect(isPermanent(err)).toBe(false);
    }
  });

  it('un cliente sin `abortSignal` (el de algunas pruebas) queda igual', () => {
    const plain = { then: undefined, value: 1 };
    expect(timed(plain)).toBe(plain);
    const signals: AbortSignal[] = [];
    const builder = { abortSignal: (s: AbortSignal) => (signals.push(s), builder) };
    expect(timed(builder)).toBe(builder);
    expect(signals).toHaveLength(1);
  });

  it('el tope crece con lo que se manda: una subida grande en una red lenta termina', async () => {
    expect(timeoutFor(0)).toBe(REQUEST_TIMEOUT_MS);
    expect(timeoutFor(16 * 1024 * 10)).toBe(REQUEST_TIMEOUT_MS + 10_000);
    expect(timeoutFor(1e12)).toBe(MAX_REQUEST_TIMEOUT_MS);
    expect(MAX_REQUEST_TIMEOUT_MS).toBeLessThan(15 * 60_000);

    (AbortSignal as { timeout: unknown }).timeout = undefined;
    vi.useFakeTimers();
    // El servidor responde bien, pero la subida tarda 45 s (2 MB a unos 45 KB/s).
    const slow: typeof fetch = (_input, init) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(new Response('7', { status: 200, headers: { 'content-type': 'application/json' } })), 45_000);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    const client = createClient('https://example.supabase.co', 'sb_publishable_test', {
      global: { fetch: slow },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const remote = new SupabaseRemote(client, '0.031');
    const result = remote.pushUpdate('p', 'id', new Uint8Array(2_000_000)).then(
      (seq) => `ok ${seq}`,
      (err: unknown) => `error ${(err as Error).message}`,
    );
    await vi.advanceTimersByTimeAsync(50_000);
    expect(await result).toBe('ok 7');
  });
});

describe('una página que vence el tope no traba al resto', () => {
  it('la bajada achica el lote si vence el tope, hasta de a uno', async () => {
    const server = new FakeServer();
    const a = await makeDevice(server);
    devices.push(a);
    const pageId = await a.tree.create(null, 'P');
    await a.engine.syncNow();
    const doc = new Y.Doc();
    for (let i = 0; i < 12; i++) {
      const before = Y.encodeStateVector(doc);
      doc.get('t').insert(doc.get('t').length, `${i} `);
      await a.remote.pushUpdate(pageId, crypto.randomUUID(), Y.encodeStateAsUpdate(doc, before));
    }
    // Como una red lenta: un lote de más de uno vence el tope.
    const pull = a.remote.pullUpdates.bind(a.remote);
    const limits: number[] = [];
    a.remote.pullUpdates = async (id, after, limit) => {
      limits.push(limit);
      if (limit > 1) throw new RemoteError(REQUEST_TIMEOUT, false, REQUEST_TIMEOUT, true);
      return pull(id, after, limit);
    };
    expect(await a.docs.pullPage(pageId, a.remote)).toBe(12);
    expect(limits.slice(0, 4)).toEqual([500, 50, 5, 1]);
    const opened = await a.docs.open(pageId);
    expect(opened.get('t').toString()).toBe(doc.get('t').toString());
    a.docs.close(pageId);
  });

  it('si la subida de una página vence siempre el tope, las demás suben y bajan igual, y se avisa sin rechazarla', async () => {
    const server = new FakeServer();
    const a = await makeDevice(server);
    const b = await makeDevice(server);
    devices.push(a, b);
    const big = await a.tree.create(null, 'Grande');
    const small = await a.tree.create(null, 'Chica');
    await a.engine.syncNow();
    await b.engine.syncNow();
    for (const [p, text] of [[big, 'mucho texto'], [small, 'una línea']] as const) {
      const doc = await a.docs.open(p);
      doc.get('t').insert(0, text);
      await a.docs.flush(p);
      a.docs.close(p);
    }
    const docB = await b.docs.open(small);
    docB.get('t').insert(0, 'de B ');
    await b.docs.flush(small);
    b.docs.close(small);
    await b.engine.syncNow();
    // La subida de la página grande vence el tope siempre (como el cliente de Supabase al cortarla).
    const real = a.remote.pushUpdate.bind(a.remote);
    a.remote.pushUpdate = async (pageId, id, update) => {
      if (pageId === big) throw new RemoteError('AbortError: signal timed out', false, '20', true);
      return real(pageId, id, update);
    };
    await a.engine.syncNow();
    const serverDoc = new Y.Doc();
    Y.applyUpdate(serverDoc, Y.mergeUpdates(server.updates.get(small)!.map((u) => u.data)));
    const opened = await a.docs.open(small);
    for (const text of [serverDoc.get('t').toString(), opened.get('t').toString()]) {
      expect(text).toContain('de B ');
      expect(text).toContain('una línea');
    }
    a.docs.close(small);
    expect(a.engine.getStatus()).toMatchObject({ online: true, lastError: REQUEST_TIMEOUT, rejectedPages: 0, pendingPages: 1 });
    // Cuando la red vuelve a alcanzar, sube.
    a.remote.pushUpdate = real;
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ lastError: null, pendingPages: 0 });
  });

  it('una consulta cortada por el tope se reconoce como tal', () => {
    expect(isTimeout(new RemoteError(REQUEST_TIMEOUT, false, REQUEST_TIMEOUT, true))).toBe(true);
    expect(isTimeout(new RemoteError('AbortError: signal timed out', false, '20', true))).toBe(true);
    expect(isTimeout(new RemoteError('Failed to fetch', false, undefined, true))).toBe(false);
  });
});

