import { afterEach, describe, expect, it, vi } from 'vitest';
import { NvidiaControl } from './nvidiaControl';
import { createNvidiaContext, readRequestKey } from './nvidiaTransport';
import { readKey } from './keyStore';
import { complete, listModels } from './providers';
import type { Services } from '../services';
import { errorText } from './errorText';
import { translate, type Translate } from '../i18n';
vi.mock('./keyStore', async (load) => ({ ...await load<typeof import('./keyStore')>(), readKey: vi.fn(async () => 'nvapi-SENUELO-descifrado') }));

const destination = { base: 'https://isla-antigua.example', token: 'sesion-de-prueba' };
const handle = { v: 1 as const, id: 'a'.repeat(64), capability: 'C'.repeat(43), prepareExpiresAt: 30000, retentionExpiresAt: 600000 };
const ack = { v: 1, id: handle.id, state: 'stopped', rootAborted: true, cleanupJoined: true };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };
const config = { provider: 'nvidia' as const, model: 'qwen/qwen3.5-122b-a10b' };
const page = '00112233-4455-6677-8899-aabbccddeeff';
const request = { system: 'instrucciones', user: 'texto', maxTokens: 1 };
const stream = (kind: 'models' | 'chat', terminal = true) => new Response(`event: sd.ready\ndata: {"v":1,"kind":"${kind}"}\n\n` + (kind === 'chat' ? 'event: sd.delta\ndata: {"text":"parte"}\n\n' : `event: sd.models\ndata: {"data":[{"id":"${config.model}"}]}\n\n`) + (terminal ? 'event: sd.done\ndata: {"cut":false,"usage":{"input":null,"output":null}}\n\n' : ''), { headers: { 'Content-Type': 'text/event-stream', 'X-Shotdocs-Nvidia-Protocol': '1' } });
afterEach(() => { vi.useRealTimers(); vi.mocked(readKey).mockClear(); });

describe('control explícito NVIDIA unido al consumidor', () => {
  it('Prepare y Stop invocan fetch sin adoptar el control como receiver', async () => {
    const paths: string[] = [];
    const http: typeof fetch = function (this: unknown, url) {
      expect(this).toBeUndefined(); paths.push(String(url).split('/').at(-1)!);
      return Promise.resolve(String(url).endsWith('/prepare') ? json(handle, 201) : json(ack));
    };
    const control = new NvidiaControl(new AbortController().signal, async () => destination, () => {}, 'models', http);
    await control.prepare(); expect(await control.stop()).toBe('confirmed'); await control.close();
    expect(paths).toEqual(['prepare', 'stop']);
  });
  it('prepare permite validar la sesión durante más de tres segundos antes de leer la clave', async () => {
    vi.useFakeTimers();
    const http = vi.fn<typeof fetch>((url, init) => String(url).endsWith('/models') ? Promise.resolve(stream('models')) : new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(json(handle, 201)), 4000);
      init!.signal!.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('timeout')); }, { once: true });
    }));
    const context = fakeContext(http, 'models');
    const reading = readRequestKey(config, 'sintetico@example.invalid', context).catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(3001);
    expect(readKey).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(999);
    expect(await reading).toBe('nvapi-SENUELO-descifrado');
    expect(http).toHaveBeenCalledTimes(1);
    expect(await listModels(config, 'clave-senuelo', http, undefined, context)).toHaveLength(1);
    expect(http.mock.calls.map(([url]) => String(url).split('/').at(-1))).toEqual(['prepare', 'models']);
    await context.close();
  });
  it('prepare sin respuesta vence a los quince segundos sin leer clave ni enviar start', async () => {
    vi.useFakeTimers();
    const http = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
    }));
    const context = fakeContext(http, 'models');
    const reading = readRequestKey(config, 'sintetico@example.invalid', context).catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(15000);
    const err = await reading;
    expect(err).toMatchObject({ kind: 'workspace', message: 'prepare_timeout' });
    for (const lang of ['en', 'es'] as const) {
      const tr = ((key, params) => translate(lang, key, params)) as Translate;
      expect(errorText(err, 'NVIDIA', tr)).toBe(translate(lang, 'assistant.nvidia.prepareTimeout'));
    }
    await context.close(); expect(readKey).not.toHaveBeenCalled(); expect(http).toHaveBeenCalledTimes(1);
  });
  it('Stop durante prepare lento espera su handle y lo cierra sin clave ni start tardío', async () => {
    vi.useFakeTimers(); const controller = new AbortController(), states: string[] = [];
    const http = vi.fn<typeof fetch>(async (url) => String(url).endsWith('/prepare')
      ? new Promise<Response>((resolve) => setTimeout(() => resolve(json(handle, 201)), 4000)) : json(ack));
    const control = new NvidiaControl(controller.signal, async () => destination, () => {}, 'models', http, (state) => states.push(state));
    const prepared = control.prepare().catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(5); controller.abort();
    await vi.advanceTimersByTimeAsync(3995); await control.close();
    expect(await prepared).toMatchObject({ kind: 'aborted' });
    expect(states).toEqual(['stopping', 'confirmed']);
    expect(http.mock.calls.map(([url]) => String(url).split('/').at(-1))).toEqual(['prepare', 'stop']);
    expect(readKey).not.toHaveBeenCalled();
  });
  it('una conexión fallida de prepare se atribuye al portero sin leer la clave', async () => {
    const context = fakeContext(async () => { throw new TypeError('Failed to fetch'); }, 'models');
    const err = await context.prepare().catch((error: unknown) => error);
    expect(err).toMatchObject({ kind: 'workspace', message: 'prepare_unavailable' });
    const tr = ((key, params) => translate('en', key, params)) as Translate;
    expect(errorText(err, 'NVIDIA', tr)).toBe(translate('en', 'assistant.nvidia.network'));
    await context.close(); expect(readKey).not.toHaveBeenCalled();
  });
  it('readRequestKey no descifra antes del handle admitido', async () => {
    const entered = deferred<void>(), prepared = deferred<Response>();
    const http: typeof fetch = async (url) => { if (String(url).endsWith('/prepare')) { entered.resolve(); return prepared.promise; } return json({ ...ack, rootAborted: false }); };
    const context = fakeContext(http), reading = readRequestKey(config, 'sintetico@example.invalid', context);
    await entered.promise; expect(readKey).not.toHaveBeenCalled();
    prepared.resolve(json(handle, 201)); expect(await reading).toBe('nvapi-SENUELO-descifrado');
    expect(readKey).toHaveBeenCalledTimes(1); await context.close();
  });
  it('rechazo de prepare no lee la clave guardada ni envía start', async () => {
    const http = vi.fn<typeof fetch>(async () => json({ code: 'workspace_session' }, 401));
    const context = fakeContext(http);
    await expect(readRequestKey(config, 'sintetico@example.invalid', context)).rejects.toMatchObject({ kind: 'workspace' });
    await context.close(); expect(readKey).not.toHaveBeenCalled(); expect(http).toHaveBeenCalledTimes(1);
  });
  it('espera prepare pendiente, envía Stop capturado y nunca autoriza start', async () => {
    const pending = deferred<Response>(), entered = deferred<void>(), stopPending = deferred<Response>();
    const signal = new AbortController(), states: string[] = [];
    const http = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).endsWith('/prepare')) { entered.resolve(); return pending.promise; }
      expect(String(input)).toBe(destination.base + '/assistant/nvidia/stop');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer ' + destination.token);
      expect(JSON.parse(init!.body as string)).toEqual({ v: 1, id: handle.id, capability: handle.capability });
      expect(init?.signal?.aborted).toBe(false);
      return stopPending.promise;
    });
    const control = new NvidiaControl(signal.signal, async () => destination, () => {}, 'chat', http, (state) => states.push(state));
    const prepared = control.prepare().catch((err: unknown) => err);
    await entered.promise; signal.abort(); pending.resolve(json(handle, 201));
    let joined = false; const closed = control.close().then(() => { joined = true; });
    await vi.waitFor(() => expect(http).toHaveBeenCalledTimes(2));
    expect(joined).toBe(false); expect(states).toEqual(['stopping']);
    stopPending.resolve(json(ack)); await closed;
    expect(await prepared).toMatchObject({ kind: 'aborted' }); expect(states).toEqual(['stopping', 'confirmed']);
    expect(http.mock.calls.map(([url]) => String(url).split('/').at(-1))).toEqual(['prepare', 'stop']);
  });
  it('Stop antes de preparar no asigna ni transmite una clave', async () => {
    const signal = new AbortController(), http = vi.fn<typeof fetch>();
    const control = new NvidiaControl(signal.signal, async () => destination, () => {}, 'models', http);
    signal.abort(); await expect(control.prepare()).rejects.toMatchObject({ kind: 'aborted' }); await control.close();
    expect(http).not.toHaveBeenCalled();
  });
  it.each([
    { ...ack, id: 'b'.repeat(64) }, { ...ack, cleanupJoined: false }, { ...ack, state: 'abandoned' },
    { ...ack, state: 'already_terminal', rootAborted: true }, { ...ack, extra: 'invalido' },
  ])('ACK inválido nunca confirma cierre: %j', async (bad) => {
    const signal = new AbortController(), states: string[] = [];
    const http: typeof fetch = async (url) => String(url).endsWith('/prepare') ? json(handle, 201) : json(bad);
    const control = new NvidiaControl(signal.signal, async () => destination, () => {}, 'chat', http, (state) => states.push(state));
    await control.prepare(); signal.abort(); await control.close(); expect(states).toEqual(['stopping', 'unconfirmed']);
  });
  it('un terminal previo honesto confirma únicamente el cierre anterior', async () => {
    const controller = new AbortController();
    const control = new NvidiaControl(controller.signal, async () => destination, () => {}, 'chat', async (url) => String(url).endsWith('/prepare') ? json(handle, 201) : json({ ...ack, state: 'already_terminal', rootAborted: false }));
    await control.prepare(); expect(await control.stop()).toBe('confirmed'); await control.close();
  });
  it('timeout del control deja cancelación sin confirmar y close unido', async () => {
    vi.useFakeTimers(); const controller = new AbortController(), stopEntered = deferred<void>();
    const control = new NvidiaControl(controller.signal, async () => destination, () => {}, 'chat', async (url, init) => {
      if (String(url).endsWith('/prepare')) return json(handle, 201);
      stopEntered.resolve(); return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('timeout')), { once: true }));
    });
    await control.prepare(); const stopped = control.stop(); await stopEntered.promise;
    await vi.advanceTimersByTimeAsync(3000); expect(await stopped).toBe('unconfirmed'); await control.close();
  });
  it('prepare sin protocolo nuevo falla y nunca hace start ni fallback', async () => {
    const http = vi.fn<typeof fetch>(async () => json({ error: 'antiguo' }, 404));
    const context = fakeContext(http);
    await expect(complete(config, 'clave-senuelo', request, { nvidia: context, fetcher: http })).rejects.toMatchObject({ kind: 'workspace', message: 'gateway_outdated' });
    expect(http).toHaveBeenCalledTimes(1); expect(String(http.mock.calls[0][0])).toMatch(/\/prepare$/);
  });
  it.each(['chat', 'models'] as const)('el consumidor %s conserva EOF estricto y une Stop ante incompleto', async (kind) => {
    const paths: string[] = [], http: typeof fetch = async (url, init) => {
      paths.push(String(url).split('/').at(-1)!);
      if (String(url).endsWith('/prepare')) { expect(new Headers(init?.headers).has('x-shotdocs-nvidia-key')).toBe(false); return json(handle, 201); }
      if (String(url).endsWith('/stop')) return json(ack);
      expect(new Headers(init?.headers).get('x-shotdocs-nvidia-owner')).toBe(handle.id);
      return stream(kind, false);
    };
    const context = fakeContext(http, kind);
    if (kind === 'chat') expect(await complete(config, 'clave-senuelo', request, { nvidia: context, fetcher: http })).toMatchObject({ cut: true, text: 'parte' });
    else await expect(listModels(config, 'clave-senuelo', http, undefined, context)).rejects.toMatchObject({ kind: 'server' });
    expect(paths).toEqual(['prepare', kind === 'chat' ? 'completions' : 'models', 'stop']);
  });
  it.each(['chat', 'models'] as const)('terminal más EOF del consumidor %s no añade otro Stop', async (kind) => {
    const http = vi.fn<typeof fetch>(async (url) => String(url).endsWith('/prepare') ? json(handle, 201) : stream(kind));
    const context = fakeContext(http, kind);
    if (kind === 'chat') expect(await complete(config, 'clave-senuelo', request, { nvidia: context, fetcher: http })).toMatchObject({ cut: false });
    else expect(await listModels(config, 'clave-senuelo', http, undefined, context)).toHaveLength(1);
    await context.close(); expect(http).toHaveBeenCalledTimes(2);
  });
  it('Stop explícito con canal de datos intacto convierte 499 fijo en aborted', async () => {
    const http: typeof fetch = async (url) => String(url).endsWith('/prepare') ? json(handle, 201) : new Response('event: sd.ready\ndata: {"v":1,"kind":"chat"}\n\nevent: sd.error\ndata: {"status":499,"code":"workspace_stopped","retryAfter":null}\n\n', { headers: { 'Content-Type': 'text/event-stream', 'X-Shotdocs-Nvidia-Protocol': '1' } });
    const context = fakeContext(http);
    await expect(complete(config, 'clave-senuelo', request, { nvidia: context, fetcher: http })).rejects.toMatchObject({ kind: 'aborted' });
  });
});
function fakeContext(http: typeof fetch, kind: 'chat' | 'models' = 'chat') {
  const client = { from: () => ({ select: () => ({ maybeSingle: async () => ({ data: { media_url: destination.base }, error: null }) }) }), auth: { getSession: async () => ({ data: { session: { access_token: destination.token } } }) } } as unknown as Services['client'];
  return createNvidiaContext({ client }, () => {}, kind === 'chat' ? page : undefined, { kind, http });
}
