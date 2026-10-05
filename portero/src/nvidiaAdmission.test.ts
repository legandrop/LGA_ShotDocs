import { afterEach, describe, expect, it, vi } from 'vitest';
import { Portero, type Env, type Store } from './core';

const origin = 'https://app.example';
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const request = (value: unknown = { v: 1, kind: 'chat' }, extra: Record<string,string> = {}, signal?: AbortSignal, path = 'prepare') => new Request('https://gateway.example/assistant/nvidia/' + path, {
  method: 'POST', headers: { Origin: origin, Authorization: 'Bearer sesion-propia', 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(value), signal,
});
function harness(http: typeof fetch) {
  const id = { toString: () => 'a'.repeat(64) };
  const dispatch = vi.fn(async (_req: Request) => json({ admitted: true }, 201));
  const namespace = { newUniqueId: vi.fn(() => id), idFromString: vi.fn(() => id), get: vi.fn(() => ({ fetch: dispatch })) };
  const store = { get: vi.fn(), put: vi.fn(), delete: vi.fn() } as Store;
  const env = { NVIDIA_REQUESTS: namespace, SUPABASE_URL: 'https://isla.example', SUPABASE_PUBLISHABLE_KEY: 'publicable', APP_ORIGINS: origin } as Env;
  return { portero: new Portero(env, store, http), namespace, dispatch, store };
}
afterEach(() => vi.useRealTimers());
describe('admisión de la app antes de asignar propietario NVIDIA', () => {
  it.each(['owner','admin','member','guest'])('sesión y rol %s admitidos asignan una sola raíz sin clave', async (role) => {
    const http = vi.fn<typeof fetch>(async () => json({ user_id: 'usuario', is_owner: role === 'owner', role }));
    const h = harness(http), result = await h.portero.handle(request());
    expect(result.status).toBe(201); expect(h.namespace.newUniqueId).toHaveBeenCalledTimes(1);
    expect(h.dispatch).toHaveBeenCalledTimes(1); const [forwarded] = h.dispatch.mock.calls[0];
    expect(await forwarded.json()).toEqual({ v: 1, kind: 'chat' }); expect(forwarded.headers.has('x-shotdocs-nvidia-key')).toBe(false);
    expect(http).toHaveBeenCalledTimes(1); expect(String(http.mock.calls[0][0])).toBe('https://isla.example/rest/v1/rpc/media_whoami');
    expect(h.store.put).not.toHaveBeenCalled();
  });
  it.each([
    { user_id: null, is_owner: false, role: 'member' }, { user_id: 'revocado', is_owner: false, role: 'removed' },
    { user_id: 'usuario', is_owner: false }, { user_id: 'usuario', is_owner: false, role: 'password' },
  ])('identidad/rol no admitidos no asignan propietario ni acceso al stub: %j', async (who) => {
    const h = harness(async () => json(who)), result = await h.portero.handle(request());
    expect([401,403]).toContain(result.status); expect(h.namespace.newUniqueId).not.toHaveBeenCalled(); expect(h.namespace.get).not.toHaveBeenCalled();
  });
  it.each([401,403,307,429,500])('rechazo de autenticación %i cierra body y deja asignaciones en cero', async (status) => {
    let cancelled = 0;
    const h = harness(async () => new Response(new ReadableStream({ cancel() { cancelled++; } }), { status, headers: { Location: 'https://ajeno.example' } }));
    const result = await h.portero.handle(request());
    expect(result.status).toBe(status === 401 || status === 403 ? 401 : 502);
    expect(cancelled).toBe(1); expect(h.namespace.newUniqueId).not.toHaveBeenCalled(); expect(h.namespace.get).not.toHaveBeenCalled();
    expect(await result.text()).not.toContain('ajeno.example');
  });
  it.each([
    { Authorization: 'Bearer token-sintactico-invalido', 'x-shotdocs-link': 'link' },
    { Authorization: 'Bearer x.' + btoa(JSON.stringify({ client_id: 'mcp' })) + '.x' },
    { Authorization: 'no-sesion' }, { 'x-shotdocs-nvidia-key': 'clave-senuelo' }, { Origin: 'https://ajeno.example' },
  ])('rechazo local antes de HTTP/asignación: %j', async (headers) => {
    const http = vi.fn<typeof fetch>(), h = harness(http);
    expect((await h.portero.handle(request(undefined, headers))).status).toBeGreaterThanOrEqual(400);
    expect(http).not.toHaveBeenCalled(); expect(h.namespace.newUniqueId).not.toHaveBeenCalled(); expect(h.namespace.get).not.toHaveBeenCalled();
  });
  it.each([{ v: 2, kind: 'chat' }, { v: 1, kind: 'audio' }, { v: 1, kind: 'chat', key: 'no' }, { v: 1, kind: 'chat', more: 'x'.repeat(300) }])('prepare inválido no asigna: %j', async (value) => {
    const http = vi.fn<typeof fetch>(), h = harness(http); expect((await h.portero.handle(request(value))).status).toBeGreaterThanOrEqual(400);
    expect(http).not.toHaveBeenCalled(); expect(h.namespace.newUniqueId).not.toHaveBeenCalled();
  });
  it('Stop durante admisión pendiente no admite la respuesta tardía', async () => {
    let finish!: (res: Response) => void, entered!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; }), signal = new AbortController();
    const http: typeof fetch = async () => { entered(); return new Promise<Response>((resolve) => { finish = resolve; }); };
    const h = harness(http), running = h.portero.handle(request(undefined, {}, signal.signal));
    await ready; signal.abort(); finish(json({ user_id: 'usuario', is_owner: false, role: 'member' }));
    expect((await running).status).toBe(502); expect(h.namespace.newUniqueId).not.toHaveBeenCalled(); expect(h.namespace.get).not.toHaveBeenCalled();
  });
  it('timeout de admisión conserva asignaciones en cero', async () => {
    vi.useFakeTimers(); let entered!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const h = harness(async (_url, init) => { entered(); return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('timeout')), { once: true })); });
    const running = h.portero.handle(request()); await ready; await vi.advanceTimersByTimeAsync(10000);
    expect((await running).status).toBe(504); expect(h.namespace.newUniqueId).not.toHaveBeenCalled(); expect(h.namespace.get).not.toHaveBeenCalled();
  });
  it('start sin control falla antes del namespace y sin autenticación', async () => {
    const http = vi.fn<typeof fetch>(), h = harness(http);
    expect((await h.portero.handle(request({}, { 'x-shotdocs-nvidia-key': 'senuelo' }, undefined, 'chat/completions'))).status).toBe(428);
    expect(h.namespace.get).not.toHaveBeenCalled(); expect(http).not.toHaveBeenCalled();
  });
  it('Stop local conserva el propietario y no espera otro RPC remoto', async () => {
    const http = vi.fn<typeof fetch>(), h = harness(http), value = { v: 1, id: 'b'.repeat(64), capability: 'c'.repeat(43) };
    await h.portero.handle(request(value, {}, undefined, 'stop'));
    expect(h.namespace.idFromString).toHaveBeenCalledWith(value.id); expect(h.namespace.newUniqueId).not.toHaveBeenCalled(); expect(http).not.toHaveBeenCalled();
    expect(h.dispatch.mock.calls[0][0].url).toBe('https://nvidia-owner.invalid/stop');
  });
});
