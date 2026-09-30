import { createClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REQUEST_TIMEOUT_MS, SupabaseRemote, timed } from './remote';
import { isNetworkError, isPermanent, RemoteError } from './types';

// Roadmap B.5: una consulta que no responde nunca dejaba colgado para siempre el ciclo de sincronización
// (con `syncing` prendido y el estado en "All synced"). Ahora cada consulta a la base tiene un tope.

/** Un `fetch` que nunca responde: solo termina si se lo corta. */
const hanging: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
  });

const realTimeout = AbortSignal.timeout;

afterEach(() => {
  vi.useRealTimers();
  (AbortSignal as { timeout: unknown }).timeout = realTimeout;
});

describe('tope de tiempo de las consultas', () => {
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
});
