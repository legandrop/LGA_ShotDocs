import { useEffect, useRef } from 'react';
import { useServices, type Services } from '../services';
import { readMediaUrl } from '../media/portero';
import { readKey } from './keyStore';
import { ProviderError, type CompletionRequest, type ProviderConfig } from './providers';
import { nvidiaEvents, nvidiaFrame, NvidiaProtocolError, NVIDIA_PROTOCOL, NVIDIA_CATALOG_LIMIT, type NvidiaKind, type NvidiaUsage } from './nvidiaProtocol';
import { NvidiaControl, type NvidiaHandle, type NvidiaStopState } from './nvidiaControl';

export interface NvidiaContext {
  check: () => void;
  prepare: () => Promise<{ base: string; token: string; handle: NvidiaHandle }>;
  control: NvidiaControl;
  close: () => Promise<void>;
  pageId?: string;
}
const workspaceError = (code: string) => new ProviderError('workspace', code);

/** Captura la isla ANTES de descifrar. Los awaits nunca reutilizan el contexto de otra página/cuenta. */
export function useNvidiaTransport(pageId?: string) {
  const services = useServices();
  const current = useRef({ services, pageId });
  current.current = { services, pageId };
  const active = useRef(new Set<AbortController>());
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; for (const c of active.current) c.abort(); active.current.clear(); }; }, [services.client, services.user?.id, services.workspace?.config.localKey, pageId]);
  return (config: ProviderConfig, controller: AbortController, onStop?: (state: NvidiaStopState) => void): NvidiaContext | undefined => {
    if (config.provider !== 'nvidia') return;
    if (!services.client || !services.user?.id || !services.workspace?.config) throw workspaceError('no_portero');
    active.current.add(controller);
    const captured = { client: services.client, userId: services.user.id, workspaceKey: services.workspace.config.localKey, pageId: current.current.pageId };
    const check = () => {
      const now = current.current;
      if (controller.signal.aborted || now.services.client !== captured.client || now.services.user.id !== captured.userId ||
          now.services.workspace.config.localKey !== captured.workspaceKey || now.pageId !== captured.pageId) {
        controller.abort(); throw new ProviderError('aborted', 'Stopped');
      }
    };
    const context = createNvidiaContext({ client: captured.client }, check, captured.pageId, { signal: controller.signal, onStop: (state) => {
      const now = current.current;
      if (live.current && active.current.has(controller) && now.services.client === captured.client && now.services.user.id === captured.userId && now.services.workspace.config.localKey === captured.workspaceKey && now.pageId === captured.pageId) onStop?.(state);
    } });
    const close = context.close;
    context.close = async () => { try { await close(); } finally { active.current.delete(controller); } };
    return context;
  };
}

export function createNvidiaContext(services: Pick<Services, 'client'>, check: () => void, pageId?: string, options: { signal?: AbortSignal; kind?: NvidiaKind; http?: typeof fetch; onStop?: (state: NvidiaStopState) => void } = {}): NvidiaContext {
  let preparing: Promise<{ base: string; token: string }> | undefined;
  const workspace = () => {
    check();
    preparing ??= (async () => {
      let base: string | null;
      try { base = await readMediaUrl(services.client); } catch { throw workspaceError('workspace_unavailable'); }
      check();
      if (!base) throw workspaceError('no_portero');
      let url: URL;
      try { url = new URL(base); } catch { throw workspaceError('no_portero'); }
      if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(import.meta.env.DEV && url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) throw workspaceError('no_portero');
      const token = (await services.client.auth.getSession()).data.session?.access_token;
      check();
      if (!token) throw workspaceError('workspace_session');
      return { base: base.replace(/\/+$/, ''), token };
    })();
    return preparing.then((ready) => { check(); return ready; });
  };
  const control = new NvidiaControl(options.signal ?? new AbortController().signal, workspace, check, options.kind ?? (pageId ? 'chat' : 'models'), options.http, options.onStop);
  return { pageId, check: () => { check(); control.checkStopped(); }, control, close: () => control.close(), async prepare() {
    const handle = await control.prepare(); const ready = await workspace(); check(); return { ...ready, handle };
  } };
}

export async function readRequestKey(config: ProviderConfig, email: string, context?: NvidiaContext): Promise<string> {
  if (config.provider === 'nvidia') { if (!context) throw workspaceError('no_portero'); await context.prepare(); context.check(); }
  const key = await readKey(email, config);
  context?.check();
  return key;
}

/** No usa el cliente de archivos: aquel tiene reintentos apropiados para subidas, no para inferencia. */
export async function nvidiaRequest(context: NvidiaContext | undefined, key: string, kind: 'models' | 'chat/completions', request?: CompletionRequest & { model: string }, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<Response> {
  if (!context) throw workspaceError('no_portero');
  const { base, token, handle } = await context.prepare();
  context.check();
  if (signal?.aborted) throw new ProviderError('aborted', 'Stopped');
  if (kind !== 'models' && !context.pageId) throw workspaceError('workspace_page');
  let res: Response;
  try { res = await fetcher(`${base}/assistant/nvidia/${kind}`, {
    method: kind === 'models' ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'x-shotdocs-nvidia-key': key, 'x-shotdocs-nvidia-control': '1', 'x-shotdocs-nvidia-owner': handle.id, 'x-shotdocs-nvidia-capability': handle.capability, ...(kind === 'models' ? {} : { 'Content-Type': 'application/json' }) },
    ...(kind === 'models' ? {} : { body: JSON.stringify({ ...request, pageId: context.pageId }) }),
    signal, redirect: 'error', cache: 'no-store',
  }); } catch { if (signal?.aborted) throw new ProviderError('aborted', 'Stopped'); throw new ProviderError('network', 'The connection was interrupted'); }
  try { context.check(); } catch (err) { await res.body?.cancel().catch(() => undefined); throw err; }
  if (!res.ok) {
    const json = await readNvidiaJson(res, 8192, signal).catch(() => null) as { code?: string } | null;
    const code = json?.code;
    if (res.status === 499 && code === 'workspace_stopped') throw new ProviderError('aborted', 'Stopped');
    if (res.status === 428 || code?.startsWith('control_')) throw workspaceError(code === 'control_required' || !code ? 'gateway_outdated' : code);
    if (code && /^(workspace_|gateway_|no_portero|nvidia_pending)/.test(code)) throw workspaceError(code);
    if (res.status === 404 && code !== 'nvidia_model') throw workspaceError('gateway_outdated');
    return new Response(JSON.stringify({ error: { message: 'NVIDIA did not complete the request' } }), { status: res.status, headers: { 'Content-Type': 'application/json', ...(res.headers.get('Retry-After') ? { 'Retry-After': res.headers.get('Retry-After')! } : {}) } });
  }
  return res;
}

/** La respuesta200 sigue pendiente: sólo terminal + EOF limpio permiten comprometer el resultado. */
export async function readNvidiaChannel(res: Response, kind: NvidiaKind, context: NvidiaContext, signal?: AbortSignal, onText?: (text: string) => void): Promise<{
  text: string; cut: boolean; usage: NvidiaUsage; models: { id: string }[];
}> {
  if (res.headers.get(NVIDIA_PROTOCOL) !== '1' || res.headers.get('Content-Type')?.split(';')[0].trim() !== 'text/event-stream') {
    await res.body?.cancel().catch(() => undefined); throw workspaceError('gateway_outdated');
  }
  let ready = false, terminal = false, hasModels = false, text = '', cut = true;
  let models: { id: string }[] = [];
  let usage: NvidiaUsage = { input: null, output: null };
  const check = () => { if (signal?.aborted) throw new ProviderError('aborted', 'Stopped'); context.check(); };
  try {
    for await (const { event, data } of nvidiaEvents(res.body, { signal, check, ...(kind === 'models' ? { total: NVIDIA_CATALOG_LIMIT, eventLimit: NVIDIA_CATALOG_LIMIT } : {}) })) {
      check();
      const frame = nvidiaFrame(event, data);
      if (terminal || !ready && frame.event !== 'sd.ready') throw new NvidiaProtocolError('invalid');
      if (frame.event === 'sd.ready') {
        if (ready || frame.value.kind !== kind) throw new NvidiaProtocolError('invalid');
        ready = true;
      } else if (frame.event === 'sd.delta') {
        if (kind !== 'chat' || text.length + frame.value.text.length > 128 * 1024) throw new NvidiaProtocolError('invalid');
        text += frame.value.text; check(); onText?.(text);
      } else if (frame.event === 'sd.models') {
        if (kind !== 'models' || hasModels) throw new NvidiaProtocolError('invalid');
        models = frame.value.data; hasModels = true;
      } else if (frame.event === 'sd.done') {
        if (kind === 'models' && (!hasModels || frame.value.cut || frame.value.usage.input !== null || frame.value.usage.output !== null)) throw new NvidiaProtocolError('invalid');
        cut = frame.value.cut; usage = frame.value.usage; terminal = true;
      } else {
        const { status, code, retryAfter } = frame.value;
        if (status === 499 && code === 'workspace_stopped') throw new ProviderError('aborted', 'Stopped');
        if (code.startsWith('workspace_') || code === 'gateway_timeout' || code === 'nvidia_pending') throw new ProviderError('workspace', code, status);
        throw new ProviderError(status === 401 ? 'auth' : status === 403 ? 'forbidden' : status === 404 ? 'model' : status === 429 ? 'rateLimit' : status >= 500 ? 'server' : 'badRequest', 'NVIDIA did not complete the request', status, retryAfter);
      }
    }
    check();
    if (!ready || !terminal) throw new NvidiaProtocolError('invalid');
    context.control.terminal();
    return { text, cut, usage, models };
  } catch (err) {
    check();
    if (err instanceof ProviderError) throw err;
    if (kind === 'chat') return { text, cut: true, usage, models: [] };
    throw new ProviderError('server', 'Invalid model catalogue');
  }
}

export async function readNvidiaJson(res: Response, max = 1024 * 1024, signal?: AbortSignal): Promise<unknown> {
  const reader = res.body?.getReader();
  if (!reader) throw new ProviderError('server', 'Invalid response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  let cancellation: Promise<void> | undefined;
  const stop = () => { cancellation ??= reader.cancel().catch(() => undefined); };
  signal?.addEventListener('abort', stop, { once: true });
  try {
    for (;;) {
      if (signal?.aborted) throw new ProviderError('aborted', 'Stopped');
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) throw new ProviderError('server', 'Response too large');
      chunks.push(value);
    }
    if (signal?.aborted) throw new ProviderError('aborted', 'Stopped');
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { signal?.removeEventListener('abort', stop); await (cancellation ?? reader.cancel().catch(() => undefined)); reader.releaseLock(); }
}
