import { createClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FILE_DOWNLOAD_TIMEOUT_MS,
  FILE_IDLE_MS,
  MAX_REQUEST_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  storageTimeout,
  SupabaseRemote,
  THUMB_DOWNLOAD_TIMEOUT_MS,
  thumbUploadLimit,
  timed,
  timeoutFor,
  within,
} from './remote';
import { MAX_FILE_BYTES } from './files';
import { FakeServer, makeDevice, type Device } from './testing';
import { isNetworkError, isPermanent, isTimeout, REQUEST_TIMEOUT, RemoteError } from './types';
import * as Y from 'yjs';

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

// Las miniaturas van a Storage, que no pasa por `timed`: sin tope, un Storage que no contestaba dejaba
// esperando para siempre a la cola de archivos. El tope es proporcional al tamaño (`within` con `timeoutFor`).
describe('tope de tiempo de las miniaturas (Storage)', () => {
  const KB = 1024;
  const jpeg = (bytes: number) => new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
  const stored = () => new Response(JSON.stringify({ Id: '1', Key: 'thumbs/f.jpg' }), { status: 200, headers: { 'content-type': 'application/json' } });

  /** El cliente de verdad contra un Storage de mentira, con el reloj simulado. */
  function remoteWith(storage: typeof fetch): SupabaseRemote {
    (AbortSignal as { timeout: unknown }).timeout = undefined;
    vi.useFakeTimers();
    const client = createClient('https://example.supabase.co', 'sb_publishable_test', {
      global: { fetch: storage },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    return new SupabaseRemote(client, '0.070');
  }

  /** Lo que da el pedido cuando se lo deja correr `ms`: `null` si todavía no terminó. */
  async function after<T>(request: Promise<T>, ms: number): Promise<{ value?: T; error?: unknown } | null> {
    let settled: { value?: T; error?: unknown } | null = null;
    void request.then(
      (value) => (settled = { value }),
      (error: unknown) => (settled = { error }),
    );
    await vi.advanceTimersByTimeAsync(ms);
    return settled;
  }

  it('subir a un Storage que no contesta vuelve como error de red al vencer el tope, que crece con el tamaño, y el pedido se corta', async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    // Nunca contesta. `upload` no acepta una señal, pero el pedido sale por el `fetch` del cliente, que la lleva.
    const remote = remoteWith((_input, init) => {
      signals.push(init?.signal);
      return new Promise(() => undefined);
    });
    // 160 KB a 16 KB/s son 10 s más que los 30 de base.
    const thumb = jpeg(160 * KB);
    expect(timeoutFor(thumb.size)).toBe(40_000);
    const request = remote.uploadThumb('f', thumb);
    expect(await after(request, 39_000)).toBeNull();
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);
    const done = await after(request, 2000);
    // Al vencer, el navegador corta la subida: no queda suelta.
    expect(signals[0]?.aborted).toBe(true);
    expect(done?.error).toBeInstanceOf(RemoteError);
    expect(isNetworkError(done?.error)).toBe(true);
    expect(isTimeout(done?.error)).toBe(true);
    expect(isPermanent(done?.error)).toBe(false);
  });

  it('bajar de un Storage que no contesta vuelve como error de red al vencer el tope, y el pedido se corta', async () => {
    let aborted = 0;
    const remote = remoteWith((input, init) => {
      init?.signal?.addEventListener('abort', () => aborted++);
      return hanging(input, init);
    });
    // Lo que tardaría la miniatura más pesada que acepta el bucket (512 KB): 30 s + 32 s.
    expect(THUMB_DOWNLOAD_TIMEOUT_MS).toBe(62_000);
    const request = remote.downloadThumb('f');
    expect(await after(request, THUMB_DOWNLOAD_TIMEOUT_MS - 1000)).toBeNull();
    expect(aborted).toBe(0);
    const done = await after(request, 2000);
    expect(aborted).toBe(1);
    expect(isNetworkError(done?.error)).toBe(true);
    expect(isTimeout(done?.error)).toBe(true);
    expect(isPermanent(done?.error)).toBe(false);
  });

  it('una miniatura lenta pero sana no se corta, ni al subir ni al bajar', async () => {
    // Storage contesta bien, pero tarde: más que los 30 s de una consulta y menos que el tope de la miniatura.
    let delay = 0;
    const remote = remoteWith(
      (_input, init) =>
        new Promise((resolve) => {
          const answer = init?.method === 'POST' ? stored() : new Response(jpeg(40 * KB));
          setTimeout(() => resolve(answer), delay);
        }),
    );
    delay = 45_000;
    const up = remote.uploadThumb('f', jpeg(320 * KB));
    expect(await after(up, 44_000)).toBeNull();
    expect(await after(up, 2000)).toEqual({ value: undefined });

    delay = 55_000;
    const down = remote.downloadThumb('f');
    expect(await after(down, 54_000)).toBeNull();
    expect((await after(down, 2000))?.value?.size).toBe(40 * KB);
  });

  it('la subida que quedó suelta puede terminar sola: el reintento la encuentra y la da por hecha', async () => {
    const bucket = new Set<string>();
    let delay = 50_000;
    const remote = remoteWith(
      (input, _init) =>
        new Promise((resolve) => {
          const path = String(input);
          setTimeout(() => {
            // Sin reemplazar (`x-upsert: false`): si ya está, Storage lo dice.
            if (bucket.has(path)) {
              resolve(new Response(JSON.stringify({ statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }), { status: 400 }));
              return;
            }
            bucket.add(path);
            resolve(stored());
          }, delay);
        }),
    );
    // El tope (30 s y monedas) vence antes de que Storage conteste (50 s)...
    const first = remote.uploadThumb('f', jpeg(8 * KB));
    expect(isTimeout((await after(first, 31_000))?.error)).toBe(true);
    expect(bucket.size).toBe(0);
    // ...y el pedido, que nadie espera ya, termina igual.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(bucket.size).toBe(1);
    // El reintento no la pisa ni falla: ya está.
    delay = 1000;
    expect(await after(remote.uploadThumb('f', jpeg(8 * KB)), 2000)).toEqual({ value: undefined });
    expect(bucket.size).toBe(1);
  });

  it('el tope de la subida crece con las fallas seguidas, hasta lo que tardaría a 2 KB/s', () => {
    // 500 KB: 30 s más 31 s a 16 KB/s; después el doble, el triple... y el techo, 30 s más 250 s a 2 KB/s.
    const bytes = 500 * KB;
    expect(thumbUploadLimit(bytes)).toBe(timeoutFor(bytes));
    expect(thumbUploadLimit(bytes, 1)).toBe(2 * timeoutFor(bytes));
    expect(thumbUploadLimit(bytes, 2)).toBe(3 * timeoutFor(bytes));
    expect(thumbUploadLimit(bytes, 50)).toBe(REQUEST_TIMEOUT_MS + 250_000);
    // Una miniatura chica (casi todo es la espera fija) crece hasta cuatro veces el tope de siempre.
    expect(thumbUploadLimit(KB)).toBe(timeoutFor(KB));
    expect(thumbUploadLimit(KB, 1)).toBe(2 * timeoutFor(KB));
    expect(thumbUploadLimit(KB, 50)).toBe(4 * timeoutFor(KB));
  });

  it('la subida usa el tope que corresponde a sus fallas seguidas', async () => {
    let aborted = 0;
    const remote = remoteWith((input, init) => {
      init?.signal?.addEventListener('abort', () => aborted++);
      return hanging(input, init);
    });
    const thumb = jpeg(160 * KB);
    const request = remote.uploadThumb('f', thumb, 1);
    expect(await after(request, 2 * timeoutFor(thumb.size) - 1000)).toBeNull();
    const done = await after(request, 2000);
    expect(aborted).toBe(1);
    expect(isTimeout(done?.error)).toBe(true);
  });

  it('`within` deja pasar el resultado y el error del pedido, y no espera de más', async () => {
    (AbortSignal as { timeout: unknown }).timeout = undefined;
    vi.useFakeTimers();
    await expect(within(1000, async () => 7)).resolves.toBe(7);
    await expect(within(1000, async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(within(1000, () => { throw new Error('antes de pedir'); })).rejects.toThrow('antes de pedir');
  });
});

// Las imágenes del bucket `page-files` (un workspace sin portero) tampoco tenían tope: con Storage colgado, el
// ciclo de sincronización entero quedaba esperando (las sube antes de los comentarios y de la cola de archivos).
describe('tope de tiempo de las imágenes de `page-files` (un workspace sin portero)', () => {
  const MB = 1024 * 1024;

  function remoteWith(storage: typeof fetch): SupabaseRemote {
    (AbortSignal as { timeout: unknown }).timeout = undefined;
    vi.useFakeTimers();
    const client = createClient('https://example.supabase.co', 'sb_publishable_test', {
      global: { fetch: storage },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    return new SupabaseRemote(client, '0.070');
  }

  async function after<T>(request: Promise<T>, ms: number): Promise<{ value?: T; error?: unknown } | null> {
    let settled: { value?: T; error?: unknown } | null = null;
    void request.then(
      (value) => (settled = { value }),
      (error: unknown) => (settled = { error }),
    );
    await vi.advanceTimersByTimeAsync(ms);
    return settled;
  }

  it('subir y bajar de un Storage que no contesta vuelve como error de red al vencer el tope, y el pedido se corta', async () => {
    let aborted = 0;
    const remote = remoteWith((input, init) => {
      init?.signal?.addEventListener('abort', () => aborted++);
      return hanging(input, init);
    });
    // 2 MB: 30 s más lo que tardan a 16 KB/s (128 s).
    const data = new ArrayBuffer(2 * MB);
    expect(storageTimeout(data.byteLength)).toBe(REQUEST_TIMEOUT_MS + 128_000);
    const up = remote.uploadFile('page/x.png', data, 'image/png');
    expect(await after(up, storageTimeout(data.byteLength) - 1000)).toBeNull();
    const upDone = await after(up, 2000);
    expect(aborted).toBe(1);
    expect(isTimeout(upDone?.error)).toBe(true);
    expect(isNetworkError(upDone?.error)).toBe(true);

    // La bajada no sabe cuánto llega: su tope total es el de la más pesada que acepta el bucket (25 MB, 27 minutos),
    // pero sin que llegue nada se corta a los 30 s (antes esperaba los 27 minutos aunque la imagen fuera chica).
    expect(FILE_DOWNLOAD_TIMEOUT_MS).toBe(storageTimeout(MAX_FILE_BYTES));
    const down = remote.downloadFile('page/x.png');
    expect(await after(down, FILE_IDLE_MS - 1000)).toBeNull();
    const downDone = await after(down, 2000);
    expect(aborted).toBe(2);
    expect(isTimeout(downDone?.error)).toBe(true);
    expect(isNetworkError(downDone?.error)).toBe(true);
  });

  /** Una respuesta de Storage que manda `chunks` pedazos, uno cada `every` ms, y después se queda quieta o termina. */
  function trickle(chunks: number, every: number, end: boolean): { fetch: typeof fetch; aborted: () => number } {
    let aborted = 0;
    const fetcher = ((_input: RequestInfo | URL, init?: RequestInit) => {
      init?.signal?.addEventListener('abort', () => aborted++);
      let sent = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            controller.error(init.signal!.reason ?? new DOMException('aborted', 'AbortError'));
          });
          const next = () => {
            if (sent === chunks) {
              if (end) controller.close();
              return;
            }
            controller.enqueue(new Uint8Array([sent++]));
            timer = setTimeout(next, every);
          };
          timer = setTimeout(next, every);
        },
      });
      return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'image/png' } }));
    }) as typeof fetch;
    return { fetch: fetcher, aborted: () => aborted };
  }

  it('bajar: una imagen lenta que sigue llegando no se corta, aunque tarde más que el tope sin movimiento', async () => {
    // 8 pedazos, uno cada 20 s, y el final 20 s después: 180 s en total, seis veces FILE_IDLE_MS.
    const slow = trickle(8, 20_000, true);
    const remote = remoteWith(slow.fetch);
    const down = remote.downloadFile('page/x.png');
    const done = await after(down, 9 * 20_000 + 1000);
    expect(done?.error).toBeUndefined();
    expect((done?.value as Blob).size).toBe(8);
    expect(slow.aborted()).toBe(0);
  });

  it('bajar: una imagen que deja de llegar a mitad se corta a los 30 s del último pedazo', async () => {
    const stuck = trickle(3, 5_000, false);
    const remote = remoteWith(stuck.fetch);
    const down = remote.downloadFile('page/x.png');
    // El último pedazo llega a los 15 s: hasta los 45 s sigue esperando.
    expect(await after(down, 15_000 + FILE_IDLE_MS - 1000)).toBeNull();
    const done = await after(down, 2000);
    expect(isTimeout(done?.error)).toBe(true);
    expect(stuck.aborted()).toBe(1);
  });

  it('una imagen grande en una red lenta no se corta: el tope no tiene el techo de las consultas', async () => {
    // 20 MB a 16 KB/s: 21 minutos, más que el tope más largo de una consulta.
    const data = new ArrayBuffer(20 * MB);
    expect(storageTimeout(data.byteLength)).toBeGreaterThan(MAX_REQUEST_TIMEOUT_MS);
    const remote = remoteWith(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve(new Response(JSON.stringify({ Id: '1', Key: 'page-files/page/x.png' }), { status: 200, headers: { 'content-type': 'application/json' } })),
            21 * 60_000,
          ),
        ),
    );
    const up = remote.uploadFile('page/x.png', data, 'image/png');
    expect(await after(up, 21 * 60_000 + 1000)).toEqual({ value: undefined });
  });

  it('una imagen que vence el tope no frena a las demás; dos seguidas cortan la pasada', async () => {
    const server = new FakeServer();
    const d = await makeDevice(server);
    devices.push(d);
    const page = await d.tree.create(null, 'Día 1');
    await d.engine.syncNow();
    const png = (n: number) => new File([new Uint8Array([n, 1, 2, 3])], `${n}.png`, { type: 'image/png' });
    const urls = [await d.files.add(page, png(1)), await d.files.add(page, png(2)), await d.files.add(page, png(3))];
    const paths = urls.map((u) => u.slice('sdfile://'.length));
    const hung = new Set<string>();
    const tried: string[] = [];
    const upload = d.remote.uploadFile.bind(d.remote);
    d.remote.uploadFile = async (path, data, mime) => {
      tried.push(path);
      if (hung.has(path)) throw new RemoteError(REQUEST_TIMEOUT, false, REQUEST_TIMEOUT, true);
      return upload(path, data, mime);
    };
    const order = (await d.db.getAllFromIndex('files', 'uploaded', 0)).map((f) => f.path);

    // La primera (en el orden en que se suben) no contesta: las otras suben igual.
    hung.add(order[0]);
    expect(await d.files.pushPending(() => false)).toBe(REQUEST_TIMEOUT);
    expect(tried).toEqual(order);
    for (const path of order.slice(1)) expect(server.files.has(path)).toBe(true);
    expect(server.files.has(order[0])).toBe(false);
    expect(await d.files.pendingCount()).toBe(1);

    // Con Storage colgado para todas, a la segunda seguida se deja para la próxima pasada.
    const more = [await d.files.add(page, png(4)), await d.files.add(page, png(5)), await d.files.add(page, png(6))];
    for (const url of more) hung.add(url.slice('sdfile://'.length));
    tried.length = 0;
    await d.files.pushPending(() => false);
    expect(tried).toHaveLength(2);
    expect(await d.files.pendingCount()).toBe(4);
    // Nada se pierde: siguen en el dispositivo.
    for (const path of [...paths, ...more.map((u) => u.slice('sdfile://'.length))]) expect(await d.db.get('files', path)).toBeTruthy();
  });

  it('dos imágenes colgadas solo para ellas no dejan sin subir a las demás: las que vencieron van después', async () => {
    const server = new FakeServer();
    const d = await makeDevice(server);
    devices.push(d);
    const page = await d.tree.create(null, 'Día 1');
    await d.engine.syncNow();
    const png = (n: number) => new File([new Uint8Array([n, 1, 2, 3])], `${n}.png`, { type: 'image/png' });
    for (const n of [1, 2, 3]) await d.files.add(page, png(n));
    const order = (await d.db.getAllFromIndex('files', 'uploaded', 0)).map((f) => f.path);
    const hung = new Set(order.slice(0, 2));
    const tried: string[] = [];
    const upload = d.remote.uploadFile.bind(d.remote);
    d.remote.uploadFile = async (path, data, mime) => {
      tried.push(path);
      if (hung.has(path)) throw new RemoteError(REQUEST_TIMEOUT, false, REQUEST_TIMEOUT, true);
      return upload(path, data, mime);
    };
    // Primera pasada: las dos primeras vencen y la pasada termina sin probar la tercera.
    await d.files.pushPending(() => false);
    expect(tried).toEqual(order.slice(0, 2));
    // Segunda (pasada la espera que dejó la primera; acá, como si volviera la red): la tercera va primero y sube.
    d.files.networkBack();
    tried.length = 0;
    await d.files.pushPending(() => false);
    expect(tried[0]).toBe(order[2]);
    expect(server.files.has(order[2])).toBe(true);
  });
});

describe('page-files con Storage colgado para todas: las pasadas siguientes esperan', () => {
  it('después de cortar una pasada, las siguientes no prueban hasta la espera (10 s, 20 s…); subir una la vuelve a cero', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const server = new FakeServer();
    const d = await makeDevice(server);
    devices.push(d);
    const page = await d.tree.create(null, 'Día 1');
    await d.engine.syncNow();
    const png = (n: number) => new File([new Uint8Array([n, 1, 2, 3])], `${n}.png`, { type: 'image/png' });
    for (const n of [1, 2, 3]) await d.files.add(page, png(n));
    let hung = true;
    let tried = 0;
    const upload = d.remote.uploadFile.bind(d.remote);
    d.remote.uploadFile = async (path, data, mime) => {
      tried++;
      if (hung) throw new RemoteError(REQUEST_TIMEOUT, false, REQUEST_TIMEOUT, true);
      return upload(path, data, mime);
    };
    // Primera pasada: dos seguidas vencen y se corta.
    expect(await d.files.pushPending(() => false)).toBe(REQUEST_TIMEOUT);
    expect(tried).toBe(2);
    // Enseguida (otro ciclo del motor): no prueba nada, y el error sigue a la vista.
    expect(await d.files.pushPending(() => false)).toBe(REQUEST_TIMEOUT);
    expect(tried).toBe(2);
    // Pasados 10 s vuelve a probar; sigue colgado: la próxima espera es de 20 s.
    vi.setSystemTime(Date.now() + 10_001);
    await d.files.pushPending(() => false);
    expect(tried).toBe(4);
    vi.setSystemTime(Date.now() + 10_001);
    await d.files.pushPending(() => false);
    expect(tried).toBe(4);
    // Volvió la red: prueba enseguida.
    d.files.networkBack();
    await d.files.pushPending(() => false);
    expect(tried).toBe(6);
    // Una imagen nueva acorta la espera a la más corta (10 s), no a cero.
    await d.files.add(page, png(4));
    await d.files.pushPending(() => false);
    expect(tried).toBe(6);
    vi.setSystemTime(Date.now() + 10_001);
    // Storage volvió: suben todas y la cuenta vuelve a cero.
    hung = false;
    expect(await d.files.pushPending(() => false)).toBeNull();
    expect(await d.files.pendingCount()).toBe(0);
    expect(server.files.size).toBeGreaterThanOrEqual(4);
  });
});

describe('page-files: el motor le avisa cuando vuelve la red', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('con el evento online del navegador', async () => {
    const server = new FakeServer();
    const d = await makeDevice(server);
    // Como en el navegador: el motor escucha "online" en window (en las pruebas no hay window).
    const win = new EventTarget();
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'hidden' }));
    const back = vi.spyOn(d.files, 'networkBack');
    d.engine.start();
    win.dispatchEvent(new Event('online'));
    expect(back).toHaveBeenCalledTimes(1);
    // Se para con window todavía puesto (sus avisos se sacan de window).
    d.engine.stop();
    d.db.close();
  });

  it('cuando la base contesta después de un ciclo sin conexión', async () => {
    const server = new FakeServer();
    const d = await makeDevice(server);
    devices.push(d);
    await d.engine.syncNow();
    const back = vi.spyOn(d.files, 'networkBack');
    server.online = false;
    await d.engine.syncNow();
    expect(d.engine.getStatus().online).toBe(false);
    expect(back).not.toHaveBeenCalled();
    server.online = true;
    await d.engine.syncNow();
    expect(back).toHaveBeenCalledTimes(1);
    // Con red de corrido, no se vuelve a avisar.
    await d.engine.syncNow();
    expect(back).toHaveBeenCalledTimes(1);
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
      doc.getText('t').insert(doc.getText('t').length, `${i} `);
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
    expect(opened.getText('t').toString()).toBe(doc.getText('t').toString());
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
      doc.getText('t').insert(0, text);
      await a.docs.flush(p);
      a.docs.close(p);
    }
    const docB = await b.docs.open(small);
    docB.getText('t').insert(0, 'de B ');
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
    for (const text of [serverDoc.getText('t').toString(), opened.getText('t').toString()]) {
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

