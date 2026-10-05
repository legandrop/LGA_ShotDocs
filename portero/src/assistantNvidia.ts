import { tokenClientId } from './mcp';
import type { Env } from './core';
import { nvidiaProfile } from '../../src/assistant/nvidiaModels';
import { encodeNvidiaFrame, nvidiaEvents, NVIDIA_PROTOCOL, NVIDIA_STREAM_LIMIT, NVIDIA_EVENT_LIMIT, type NvidiaFrame, type NvidiaUsage } from '../../src/assistant/nvidiaProtocol';

const ROOT = 'https://integrate.api.nvidia.com/v1';
const CHAT = '/assistant/nvidia/chat/completions';
const MODELS = '/assistant/nvidia/models';
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export interface NvidiaWho { auth: string; role?: string; link?: string }
type Who = NvidiaWho;
export interface NvidiaCycle {
  controller: AbortController;
  check(): void;
  attach(operation: { stop(): void; join(): Promise<void>; seal(): void }): void;
  finished(): Promise<void>;
}
export class NvidiaDenied extends Error { constructor(readonly status: number, readonly code: string) { super(code); } }
const Denied = NvidiaDenied;
function fail(status: number, code: string): never { throw new Denied(status, code); }
export const allowedNvidiaOrigin = (req: Request, env: Env) => {
  const origin = req.headers.get('Origin');
  return !origin || env.APP_ORIGINS.split(',').some((v) => v.trim().replace(/\/+$/, '').toLowerCase() === origin.toLowerCase());
};
function headers(req: Request) {
  return {
    'Cache-Control': 'no-store', Vary: 'Origin',
    ...(req.headers.get('Origin') ? { 'Access-Control-Allow-Origin': req.headers.get('Origin')! } : {}),
    'Access-Control-Expose-Headers': `Retry-After, ${NVIDIA_PROTOCOL}`,
  };
}
export function nvidiaAnswer(req: Request, status: number, code: string, retryAfter?: string) {
  return new Response(JSON.stringify({ error: { message: code }, code }), {
    status, headers: { ...headers(req), 'Content-Type': 'application/json', ...(retryAfter ? { 'Retry-After': retryAfter } : {}) },
  });
}
export async function nvidiaBytes(body: ReadableStream<Uint8Array> | null, limit: number, signal: AbortSignal, track: (reader: ReadableStreamDefaultReader<Uint8Array>, add: boolean) => void = () => {}): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  track(reader, true);
  let cancelling: Promise<void> | undefined;
  const stop = () => { cancelling ??= reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', stop, { once: true });
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      if (signal.aborted) fail(499, 'workspace_stopped');
      const { done, value } = await reader.read();
      if (signal.aborted) fail(499, 'workspace_stopped');
      if (done) break;
      size += value.length;
      if (size > limit) fail(413, 'nvidia_too_large');
      parts.push(value);
    }
    if (signal.aborted) fail(499, 'workspace_stopped');
    const all = new Uint8Array(size);
    let offset = 0;
    for (const p of parts) { all.set(p, offset); offset += p.length; }
    return all;
  } finally {
    signal.removeEventListener('abort', stop);
    await (cancelling ?? reader.cancel().catch(() => undefined));
    track(reader, false);
    reader.releaseLock();
  }
}
function parseJson(raw: Uint8Array): unknown {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { return fail(422, 'nvidia_bad_request'); }
}
function chatBody(value: unknown): { pageId: string; body: unknown } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(422, 'nvidia_bad_request');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((k) => !['pageId','model','system','user','maxTokens','image'].includes(k))) fail(422, 'nvidia_bad_request');
  const profile = typeof v.model === 'string' ? nvidiaProfile(v.model) : null;
  if (!profile) fail(422, 'nvidia_model');
  if (typeof v.pageId !== 'string' || !UUID.test(v.pageId)) fail(422, 'nvidia_bad_request');
  if (typeof v.system !== 'string' || typeof v.user !== 'string' || v.system.length + v.user.length > 128 * 1024) fail(413, 'nvidia_too_large');
  if (!Number.isInteger(v.maxTokens) || (v.maxTokens as number) < 1 || (v.maxTokens as number) > profile.tokens) fail(422, 'nvidia_bad_request');
  let content: unknown = v.user;
  if (v.image !== undefined) {
    if (!profile.vision) fail(422, 'nvidia_no_vision');
    const image = v.image as Record<string, unknown> | null;
    if (!image || image.mime !== 'image/jpeg' || typeof image.data !== 'string' || Object.keys(image).some((k) => !['mime','data'].includes(k))) fail(422, 'nvidia_bad_image');
    if (image.data.length > Math.ceil(1024 * 1024 / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.data)) fail(413, 'nvidia_too_large');
    let decoded: string;
    try { decoded = atob(image.data); } catch { return fail(422, 'nvidia_bad_image'); }
    if (decoded.length > 1024 * 1024 || !decoded.startsWith('\xff\xd8\xff')) fail(422, 'nvidia_bad_image');
    content = [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image.data}` } }, { type: 'text', text: v.user }];
  }
  return { pageId: v.pageId, body: { model: v.model, messages: [{ role: 'system', content: v.system }, { role: 'user', content }], max_tokens: v.maxTokens, stream: true,
    ...(profile.vision ? { chat_template_kwargs: { enable_thinking: false } } : {}) } };
}
function retry(value: string | null): string | undefined {
  if (!value) return;
  const seconds = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - Date.now()) / 1000);
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= 86400 ? String(seconds) : undefined;
}

/** El cuerpo temprano posee auth/policy/page/vendor; HTTP200 no confirma ninguno de esos pasos. */
const answer = nvidiaAnswer, bytes = nvidiaBytes;
export async function handleNvidia(req: Request, env: Env, http: typeof fetch, authenticate: (signal: AbortSignal) => Promise<Who>, owner?: NvidiaCycle): Promise<Response> {
  const url = new URL(req.url);
  if (!allowedNvidiaOrigin(req, env)) return new Response(null, { status: 403 });
  if (url.search || ![MODELS, CHAT].includes(url.pathname)) return answer(req, 404, 'nvidia_route');
  const models = url.pathname === MODELS;
  if (req.method !== (models ? 'GET' : 'POST')) return answer(req, 405, 'nvidia_method');
  if (req.headers.has('x-shotdocs-link')) return answer(req, 403, 'workspace_session');
  const key = req.headers.get('x-shotdocs-nvidia-key') ?? '';
  if (!/^[\x21-\x7e]{1,512}$/.test(key)) return answer(req, 422, 'nvidia_key');
  if (!models && req.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') return answer(req, 422, 'nvidia_bad_request');
  if (req.signal.aborted) return answer(req, 499, 'workspace_stopped');

  const root = owner?.controller ?? new AbortController();
  let activePull: Promise<void> | undefined, outputController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();
  const cancellations: Promise<void>[] = [];
  let stopped: NvidiaDenied | undefined, disconnected = false, terminal = false;
  let initialized = false, catalog: { id: string }[] | undefined, sentModels = false;
  let upstream: AsyncGenerator<{ event: string; data: string }> | undefined;
  let upstreamReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let finishReason: string | undefined, vendorDone = false, written = 0, outputText = 0;
  const usage: NvidiaUsage = { input: null, output: null };
  const track = (reader: ReadableStreamDefaultReader<Uint8Array>, add: boolean) => { if (add) readers.add(reader); else readers.delete(reader); };
  const detach = () => { clearTimeout(timer); req.signal.removeEventListener('abort', onRequestAbort); root.signal.removeEventListener('abort', onRootAbort); };
  const stop = (reason: NvidiaDenied) => {
    if (stopped) return;
    if (!stopped) stopped = reason;
    root.abort();
    detach();
    for (const reader of readers) cancellations.push(reader.cancel().catch(() => undefined));
  };
  const onRequestAbort = () => { disconnected = true; stop(new Denied(499, 'workspace_stopped')); };
  const rootReason = () => root.signal.reason instanceof Denied ? root.signal.reason : new Denied(499, 'workspace_stopped');
  const onRootAbort = () => stop(rootReason());
  const timer = setTimeout(() => stop(new Denied(504, 'gateway_timeout')), 180000);
  req.signal.addEventListener('abort', onRequestAbort, { once: true });
  root.signal.addEventListener('abort', onRootAbort, { once: true });
  const guard = () => { owner?.check(); if (stopped || root.signal.aborted) throw stopped ?? new Denied(499, 'workspace_stopped'); };
  const cleanup = async () => {
    detach(); await Promise.all(cancellations);
    if (root.signal.aborted && upstreamReader) { upstreamReader.releaseLock(); track(upstreamReader, false); upstreamReader = null; }
  };
  const timed = async <T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    guard();
    const child = new AbortController(); let expired = false;
    const abort = () => child.abort();
    root.signal.addEventListener('abort', abort, { once: true });
    const deadline = setTimeout(() => { expired = true; child.abort(); }, 10000);
    try {
      const result = await operation(child.signal);
      guard();
      if (expired) fail(504, 'gateway_timeout');
      return result;
    } catch (err) {
      guard();
      if (expired) fail(504, 'gateway_timeout');
      throw err;
    } finally { clearTimeout(deadline); root.signal.removeEventListener('abort', abort); }
  };
  const query = (path: string, who: Who) => timed(async (signal) => {
    try {
    guard();
    const res = await http(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/${path}`, {
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: who.auth }, signal, redirect: 'manual', cache: 'no-store',
    });
    if (root.signal.aborted || signal.aborted || !res.ok) {
      await res.body?.cancel().catch(() => undefined);
      guard();
      if (signal.aborted) fail(504, 'gateway_timeout');
      fail(res.status === 401 ? 401 : 502, res.status === 401 ? 'workspace_session' : 'workspace_unavailable');
    }
    guard();
    const raw = await bytes(res.body, 64 * 1024, signal, track);
    guard();
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
    catch { fail(502, 'workspace_unavailable'); }
    } catch (err) {
      guard();
      if (signal.aborted) fail(504, 'gateway_timeout');
      if (err instanceof Denied && err.code === 'workspace_session') throw err;
      fail(502, 'workspace_unavailable');
    }
  });
  const initialize = async () => {
    guard();
    const who = await timed(authenticate);
    guard();
    if (!who.role || !['owner','admin','member','guest'].includes(who.role) || who.link) fail(403, 'workspace_session');
    const policy = await query('workspace_settings?select=assistant_policy', who);
    guard();
    if (!Array.isArray(policy) || policy.length !== 1 || policy[0]?.assistant_policy !== 'on') fail(403, 'workspace_policy');
    let body: unknown;
    if (!models) {
      guard();
      const raw = await bytes(req.body, 2 * 1024 * 1024, root.signal, track);
      guard();
      const chat = chatBody(parseJson(raw));
      const pages = await query(`pages?select=id&id=eq.${chat.pageId}&deleted_at=is.null`, who);
      guard();
      if (!Array.isArray(pages) || pages.length !== 1 || pages[0]?.id !== chat.pageId) fail(403, 'workspace_page');
      body = chat.body;
    }
    guard();
    const res = await http(`${ROOT}/${models ? 'models' : 'chat/completions'}`, {
      method: models ? 'GET' : 'POST', headers: { Authorization: `Bearer ${key}`, Accept: models ? 'application/json' : 'text/event-stream', ...(models ? {} : { 'Content-Type': 'application/json' }) },
      ...(models ? {} : { body: JSON.stringify(body) }), signal: root.signal, redirect: 'manual', cache: 'no-store',
    });
    if (root.signal.aborted || res.status !== 200) {
      await res.body?.cancel().catch(() => undefined);
      guard();
      const code = res.status === 401 ? 'nvidia_auth' : res.status === 403 ? 'nvidia_forbidden' : res.status === 404 ? 'nvidia_model' : res.status === 429 ? 'nvidia_rate_limit' : res.status === 202 ? 'nvidia_pending' : 'nvidia_unavailable';
      const denied = new Denied(res.status >= 400 && res.status <= 599 ? res.status : 502, code);
      if (code === 'nvidia_rate_limit') retryAfter = Number(retry(res.headers.get('Retry-After')) ?? NaN);
      throw denied;
    }
    guard();
    if (models) {
      const raw = await bytes(res.body, 1024 * 1024, root.signal, track);
      guard();
      let data: { data?: { id?: unknown }[] } | null;
      try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { fail(502, 'nvidia_catalog'); }
      if (!data || !Array.isArray(data.data) || data.data.some((m) => !m || typeof m.id !== 'string')) fail(502, 'nvidia_catalog');
      catalog = data.data.filter((m) => nvidiaProfile(m.id as string)).map((m) => ({ id: m.id as string }));
    } else {
      if (!res.body || res.headers.get('Content-Type')?.split(';')[0].trim() !== 'text/event-stream') {
        await res.body?.cancel().catch(() => undefined); fail(502, 'nvidia_stream');
      }
      upstreamReader = res.body.getReader();
      track(upstreamReader, true);
      upstream = nvidiaEvents(res.body, { signal: root.signal, check: guard, lockedReader: upstreamReader, reader(reader) {
        if (upstreamReader) track(upstreamReader, false);
        upstreamReader = reader;
        if (reader) track(reader, true);
      } });
    }
    initialized = true;
  };
  let retryAfter = NaN;
  const seal = () => {
    if (terminal || disconnected || !outputController) return;
    terminal = true;
    const reason = stopped ?? rootReason();
    outputController.enqueue(encodeNvidiaFrame({ event: 'sd.error', value: { status: reason.status, code: reason.code, retryAfter: null } }));
    outputController.close();
  };
  owner?.attach({ stop: () => stop(rootReason()), async join() {
    const pending = activePull;
    if (pending) await pending.catch(() => undefined);
    await cleanup();
  }, seal });
  const send = (output: ReadableStreamDefaultController<Uint8Array>, frame: NvidiaFrame) => {
    guard();
    const data = encodeNvidiaFrame(frame);
    written += data.byteLength;
    if (written > NVIDIA_STREAM_LIMIT || data.byteLength > (models ? 1024 * 1024 : NVIDIA_EVENT_LIMIT)) fail(413, 'nvidia_too_large');
    output.enqueue(data);
  };
  const stream = new ReadableStream<Uint8Array>({
    start(output) {
      outputController = output;
      const ready = encodeNvidiaFrame({ event: 'sd.ready', value: { v: 1, kind: models ? 'models' : 'chat' } });
      written = ready.byteLength; output.enqueue(ready);
    },
    pull(output) {
      const produce = async () => {
      try {
        guard();
        if (!initialized) await initialize();
        guard();
        if (models) {
          if (!sentModels) { send(output, { event: 'sd.models', value: { data: catalog! } }); sentModels = true; return; }
        } else {
          for (;;) {
            guard();
            const next = await upstream!.next();
            guard();
            if (next.done) { if (!finishReason || !vendorDone) fail(502, 'nvidia_stream'); break; }
            const { data } = next.value;
            if (data === '[DONE]') { if (vendorDone || !finishReason) fail(502, 'nvidia_stream'); vendorDone = true; continue; }
            if (vendorDone) fail(502, 'nvidia_stream');
            let ev: { choices?: { delta?: { content?: unknown; tool_calls?: unknown }; finish_reason?: unknown }[]; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown }; error?: unknown };
            try { ev = JSON.parse(data); } catch { fail(502, 'nvidia_stream'); }
            if (!ev || typeof ev !== 'object' || Array.isArray(ev) || ev.error || ev.choices !== undefined && !Array.isArray(ev.choices)) fail(502, 'nvidia_stream');
            const choice = ev.choices?.[0];
            if (choice != null && (typeof choice !== 'object' || Array.isArray(choice)) || choice?.delta != null && (typeof choice.delta !== 'object' || Array.isArray(choice.delta)) || ev.usage != null && (typeof ev.usage !== 'object' || Array.isArray(ev.usage))) fail(502, 'nvidia_stream');
            const content = choice?.delta?.content;
            if (choice?.delta?.tool_calls || content !== undefined && content !== null && typeof content !== 'string' || finishReason && (content || choice?.finish_reason)) fail(502, 'nvidia_stream');
            if (choice?.finish_reason != null) {
              if (!['stop','length','content_filter'].includes(choice.finish_reason as string)) fail(502, 'nvidia_stream');
              finishReason = choice.finish_reason as string;
            }
            if (ev.usage) for (const [target, source] of [['input','prompt_tokens'],['output','completion_tokens']] as const) {
              const value = ev.usage[source];
              if (value != null) { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail(502, 'nvidia_stream'); usage[target] = value; }
            }
            if (content) {
              outputText += (content as string).length;
              if (outputText > 128 * 1024) fail(413, 'nvidia_too_large');
              send(output, { event: 'sd.delta', value: { text: content as string } }); return;
            }
          }
        }
        await cleanup(); await owner?.finished();
        send(output, { event: 'sd.done', value: { cut: !models && finishReason !== 'stop', usage } });
        terminal = true; output.close();
      } catch (err) {
        const denied = stopped ?? (err instanceof Denied ? err : new Denied(502, initialized && !models ? 'nvidia_stream' : 'nvidia_unavailable'));
        stop(denied);
        await cleanup();
        await owner?.finished();
        if (terminal || disconnected) return;
        terminal = true;
        const error = encodeNvidiaFrame({ event: 'sd.error', value: { status: denied.status, code: denied.code, retryAfter: denied.code === 'nvidia_rate_limit' && Number.isFinite(retryAfter) ? retryAfter : null } });
        if (written + error.byteLength > NVIDIA_STREAM_LIMIT) { output.error(new Error('Incomplete response')); return; }
        output.enqueue(error);
        output.close();
      }
      };
      const pending = produce();
      activePull = pending;
      return pending.finally(() => { if (activePull === pending) activePull = undefined; });
    },
    async cancel() {
      disconnected = true; terminal = true;
      stop(new Denied(499, 'workspace_stopped'));
      await cleanup();
      await owner?.finished();
    },
  }, { highWaterMark: 0 });
  return new Response(stream, { headers: { ...headers(req), 'Content-Type': 'text/event-stream', [NVIDIA_PROTOCOL]: '1' } });
}

export const PREFIX = '/assistant/nvidia/';
type Control = { v: 1; id: string; capability: string };
export const denied = (status: number, code: string): never => { throw new NvidiaDenied(status, code); };
export const session = (req: Request) => {
  const auth = req.headers.get('Authorization') ?? '';
  if (req.headers.has('x-shotdocs-link') || !/^Bearer [\x21-\x7e]{1,8192}$/.test(auth) || tokenClientId(auth) !== null) denied(403, 'control_rejected');
  return auth;
};
export const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), (b) => b.toString(16).padStart(2, '0')).join('');
export const same = (a: string, b: string) => { let diff = a.length ^ b.length; for (let i = 0; i < 64; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return diff === 0; };
export const control = (value: unknown): Control => {
  const v = value as Control | null;
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join(',') !== 'capability,id,v' || v.v !== 1 || !/^[a-f0-9]{64}$/.test(v.id) || !/^[A-Za-z0-9_-]{43}$/.test(v.capability)) denied(403, 'control_rejected');
  return v!;
};
export const json = (req: Request, value: unknown, status = 200) => {
  const res = nvidiaAnswer(req, status, '');
  return new Response(JSON.stringify(value), { status, headers: res.headers });
};
export async function body(req: Request, limit: number): Promise<unknown> {
  if (req.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') denied(422, 'nvidia_bad_request');
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await nvidiaBytes(req.body, limit, req.signal))); }
  catch (err) { if (err instanceof NvidiaDenied) throw err; return denied(422, 'nvidia_bad_request'); }
}

/** El Worker sólo asigna el dueño después de acreditar sesión y rol en su isla. */
export async function routeNvidiaOwner(req: Request, env: Env, authenticate: (signal: AbortSignal) => Promise<NvidiaWho>): Promise<Response> {
  const path = new URL(req.url);
  if (!allowedNvidiaOrigin(req, env)) return new Response(null, { status: 403 });
  if (path.search || !['prepare','stop','status','models','chat/completions'].some((p) => path.pathname === PREFIX + p)) return nvidiaAnswer(req, 404, 'nvidia_route');
  const action = path.pathname.slice(PREFIX.length);
  if (req.method !== (action === 'models' ? 'GET' : 'POST')) return nvidiaAnswer(req, 405, 'nvidia_method');
  try {
    const namespace = env.NVIDIA_REQUESTS;
    if (!namespace) return nvidiaAnswer(req, 503, 'gateway_outdated');
    session(req);
    if (action === 'prepare') {
      if (req.headers.has('x-shotdocs-nvidia-key')) denied(422, 'nvidia_bad_request');
      const value = await body(req, 256) as { v: number; kind: string } | null;
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'kind,v' || value.v !== 1 || !['chat','models'].includes(value.kind)) denied(422, 'nvidia_bad_request');
      const controller = new AbortController();
      const abort = () => controller.abort();
      req.signal.addEventListener('abort', abort, { once: true });
      let expired = false;
      const timer = setTimeout(() => { expired = true; controller.abort(); }, 10000);
      try {
        if (req.signal.aborted) denied(499, 'workspace_stopped');
        const who = await authenticate(controller.signal);
        if (expired) denied(504, 'gateway_timeout');
        if (controller.signal.aborted) denied(499, 'workspace_stopped');
        if (who.link || !who.role || !['owner','admin','member','guest'].includes(who.role)) denied(403, 'workspace_session');
        const id = namespace.newUniqueId();
        return await namespace.get(id).fetch(new Request('https://nvidia-owner.invalid/prepare', { method: 'POST', headers: { Authorization: session(req), 'Content-Type': 'application/json', ...(req.headers.get('Origin') ? { Origin: req.headers.get('Origin')! } : {}) }, body: JSON.stringify(value) }));
      } catch (err) { if (expired) denied(504, 'gateway_timeout'); throw err; }
      finally { clearTimeout(timer); req.signal.removeEventListener('abort', abort); }
    }
    let handle: Control;
    if (action === 'stop' || action === 'status') handle = control(await body(req, 512));
    else {
      if (req.headers.get('x-shotdocs-nvidia-control') !== '1') denied(428, 'control_required');
      handle = control({ v: 1, id: req.headers.get('x-shotdocs-nvidia-owner'), capability: req.headers.get('x-shotdocs-nvidia-capability') });
    }
    let id: ReturnType<NonNullable<Env['NVIDIA_REQUESTS']>['idFromString']>;
    try { id = namespace.idFromString(handle.id); } catch { return nvidiaAnswer(req, 403, 'control_rejected'); }
    const headers = new Headers(req.headers);
    headers.set('x-shotdocs-nvidia-owner', handle.id); headers.set('x-shotdocs-nvidia-capability', handle.capability);
    if (action === 'stop' || action === 'status') headers.delete('Content-Length');
    const target = action === 'stop' || action === 'status' ? `https://nvidia-owner.invalid/${action}` : req.url;
    return await namespace.get(id).fetch(new Request(target, { method: req.method, headers, ...(req.method === 'GET' ? {} : { body: action === 'stop' || action === 'status' ? JSON.stringify(handle) : req.body, duplex: 'half' } as RequestInit) }));
  } catch (err) { return nvidiaAnswer(req, err instanceof NvidiaDenied ? err.status : 502, err instanceof NvidiaDenied ? err.code : 'workspace_unavailable'); }
}
